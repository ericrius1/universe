// The interface over the world: where you are (breadcrumb), how big things are (the powers-of-ten ladder, a scale bar,
// how much time has slowed), what's under the cursor (a tag) and what you chose (a card), the places to fly to, the
// buttons (tour, fly, play, cutaway, microscope, sound, help) and the tour's captions. Plain DOM, written only when a
// value changes.
import type { Card } from './info';
import type { Place } from './places';

const RUNGS: [number, string, string][] = [
  [1e5, '100 µm', 'a hair is about this wide'],
  [1e4, '10 µm', 'a cell'],
  [1e3, '1 µm', 'mitochondria, bacteria'],
  [1e2, '100 nm', 'viruses, nuclear pores'],
  [1e1, '10 nm', 'proteins, ribosomes'],
  [1e0, '1 nm', 'DNA\'s width, a lipid'],
];

export function fmtLength(nm: number): string {
  if (nm >= 1e6) return `${+(nm / 1e6).toPrecision(2)} mm`;
  if (nm >= 1e3) return `${+(nm / 1e3).toPrecision(2)} µm`;
  if (nm >= 1) return `${+nm.toPrecision(2)} nm`;
  return `${+(nm * 10).toPrecision(2)} Å`;
}

const h = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

export interface HudState {
  /** field of view across the screen, nm */
  fov: number;
  /** nm per css pixel at the focus */
  nmPerPx: number;
  timeScale: number;
  crumbs: string[];
  hover: Card | null;
  mouse: [number, number];
}

export class Hud {
  root: HTMLElement;
  private crumbs = h('div', 'crumbs');
  private ladder = h('div', 'ladder');
  private ladderDot = h('div', 'ladder-dot');
  private ladderVal = h('div', 'ladder-val');
  private bar = h('div', 'scalebar');
  private barLine = h('i');
  private barText = h('span');
  private timeText = h('div', 'timescale');
  private tag = h('div', 'tag');
  private card = h('div', 'card');
  private dock = h('div', 'dock');
  private caption = h('div', 'caption');
  private help = h('div', 'help');
  private toastEl = h('div', 'toast');
  private placeEls = new Map<string, HTMLElement>();
  private last: Record<string, string> = {};
  buttons: Record<string, HTMLButtonElement> = {};
  onPlace: (id: string) => void = () => {};
  onButton: (id: string) => void = () => {};
  onPlay: (game: string) => void = () => {};
  onCardFly: (() => void) | null = null;
  private toastTimer = 0;

  constructor(parent: HTMLElement, places: Place[], base: string) {
    this.root = parent;
    const brand = h('div', 'brand', '<div class="brand-name">Cell</div>');
    brand.append(this.crumbs);
    const top = h('div', 'topbar');
    const btn = (id: string, label: string, title: string) => {
      const b = h('button', 'btn', label) as HTMLButtonElement;
      b.title = title;
      b.addEventListener('click', (e) => { e.stopPropagation(); this.onButton(id); });
      this.buttons[id] = b;
      top.append(b);
    };
    btn('tour', '<b>▶</b> Tour', 'A guided journey from tissue to atoms (T)');
    btn('fly', '<b>✈&#xFE0E;</b> Fly', 'Fly through it yourself, first person (F)');
    btn('play', '✦ Play', 'Become part of the cell (P)');
    btn('cut', '◐ Cutaway', 'Open or close the cell (C)');
    btn('fluo', '◉ Microscope', 'See it as a fluorescence microscope does (M)');
    btn('sound', '♪', 'Sound on/off (S)');
    btn('help', '?', 'How to move (H)');

    // the ladder of scales
    for (const [, label, what] of RUNGS) {
      const r = h('div', 'rung', `<span class="rung-l">${label}</span><span class="rung-w">${what}</span>`);
      this.ladder.append(r);
    }
    this.ladder.append(this.ladderDot);
    this.ladderDot.append(this.ladderVal);
    this.bar.append(this.barLine, this.barText);
    const scaleBox = h('div', 'scalebox');
    scaleBox.append(this.bar, this.timeText);

    for (const p of places) {
      const c = h('button', 'place', `<img alt="" src="${base}art/${p.art}.webp" onerror="this.style.visibility='hidden'"><span>${p.name}</span>`) as HTMLButtonElement;
      c.title = p.line;
      c.addEventListener('click', (e) => { e.stopPropagation(); this.onPlace(p.id); });
      this.placeEls.set(p.id, c);
      this.dock.append(c);
    }
    this.help.innerHTML = `
      <div class="help-in">
        <h2>Moving through the cell</h2>
        <div class="help-grid">
          <div><b>Zoom</b><span>scroll, pinch, or + / −. You zoom toward what's under the cursor — keep going and you pass through membranes.</span></div>
          <div><b>Look round</b><span>drag (it turns round whatever you grabbed). Right-drag or two fingers to pan.</span></div>
          <div><b>Go to</b><span>double-click anything, or pick a place below.</span></div>
          <div><b>Fly</b><span>F (or ✈&#xFE0E; Fly) for first person: the mouse looks, W A S D and Q / E fly, Shift is faster, scroll sets the speed, Esc lands. On a phone your left thumb flies and a drag looks. The speed follows the scale.</span></div>
          <div><b>Learn</b><span>hover anything for its name, click for its story. Every protein is a real structure from the Protein Data Bank.</span></div>
          <div><b>Time</b><span>biology is too fast to see up close, so time slows as you zoom in: about 100× slower among the molecules.</span></div>
        </div>
        <p class="help-foot">Structures: RCSB PDB (1KX5, 4UG0, 6ZPO, 5FLM, 1JFF, …). Rendered live on your GPU with WebGPU.
          <a href="${base}film/cell-trailer.mp4" target="_blank" rel="noopener">Watch the one-minute film ↗</a></p>
        <button class="btn help-close">Close</button>
      </div>`;
    this.help.addEventListener('click', () => this.toggleHelp(false));
    this.card.addEventListener('click', (e) => e.stopPropagation());
    parent.append(brand, top, this.ladder, scaleBox, this.tag, this.card, this.caption, this.dock, this.help, this.toastEl);
  }

  private set(key: string, el: HTMLElement, v: string, prop: 'html' | 'text' | 'style' = 'text', styleKey = '') {
    if (this.last[key] === v) return;
    this.last[key] = v;
    if (prop === 'html') el.innerHTML = v;
    else if (prop === 'text') el.textContent = v;
    else (el.style as unknown as Record<string, string>)[styleKey] = v;
  }

  update(s: HudState) {
    this.set('crumbs', this.crumbs, s.crumbs.map((c, i) => `<span${i === s.crumbs.length - 1 ? ' class="here"' : ''}>${c}</span>`).join('<i>›</i>'), 'html');
    // ladder: rungs are a decade apart, top 100 µm; the dot sits at log10 of the field of view
    const t = Math.max(0, Math.min(1, (5 - Math.log10(Math.max(s.fov, 1))) / 5));
    this.set('dot', this.ladderDot, `${(t * 100).toFixed(2)}%`, 'style', 'top');
    this.set('dotv', this.ladderVal, fmtLength(s.fov));
    // a round length about a sixth of the screen
    const target = s.nmPerPx * 140;
    const p10 = Math.pow(10, Math.floor(Math.log10(target)));
    const L = [1, 2, 5, 10].map((k) => k * p10).filter((x) => x <= target).pop() ?? p10;
    this.set('barw', this.barLine, `${(L / s.nmPerPx).toFixed(1)}px`, 'style', 'width');
    this.set('bart', this.barText, fmtLength(L));
    const ts = s.timeScale;
    this.set('time', this.timeText, ts > 0.98 ? 'time: real' : `time: ${Math.round(1 / ts)}× slower`);
    // the tag follows the cursor
    const tag = s.hover ? s.hover.title : '';
    this.set('tag', this.tag, tag);
    this.tag.style.opacity = tag ? '1' : '0';
    this.tag.style.transform = `translate(${s.mouse[0] + 16}px, ${s.mouse[1] + 14}px)`;
  }

  showCard(c: Card | null, extra = '') {
    if (!c) { this.card.classList.remove('on'); return; }
    const meta = [c.size, c.count].filter(Boolean).join(' · ');
    this.card.innerHTML = `
      <button class="card-x" aria-label="close">×</button>
      <h3>${c.title}</h3>
      ${meta ? `<div class="card-meta">${meta}</div>` : ''}
      <p>${c.text}</p>
      ${c.pdb ? `<a class="card-pdb" href="https://www.rcsb.org/structure/${c.pdb}" target="_blank" rel="noopener">Structure: PDB ${c.pdb} ↗</a>` : ''}
      ${extra}
      <div class="card-acts">
        <button class="btn card-fly">Fly closer</button>
        ${c.play ? `<button class="btn btn-play card-play">✦ Play as this</button>` : ''}
      </div>`;
    this.card.querySelector('.card-x')!.addEventListener('click', () => this.showCard(null));
    this.card.querySelector('.card-fly')!.addEventListener('click', () => this.onCardFly?.());
    this.card.querySelector('.card-play')?.addEventListener('click', () => this.onPlay(c.play!));
    this.card.classList.add('on');
  }

  setCaption(text: string) {
    if (this.last.caption === text) return;
    this.last.caption = text;
    this.caption.classList.remove('on');
    if (!text) return;
    setTimeout(() => { this.caption.innerHTML = text; this.caption.classList.add('on'); }, 260);
  }

  /** light the card of the place the view is at */
  setHere(id: string | null) {
    const v = id ?? '';
    if (this.last.here === v) return;
    this.placeEls.get(this.last.here ?? '')?.classList.remove('here');
    this.last.here = v;
    this.placeEls.get(v)?.classList.add('here');
  }
  toggleHelp(on?: boolean) { this.help.classList.toggle('on', on ?? !this.help.classList.contains('on')); }
  setActive(id: string, on: boolean) { this.buttons[id]?.classList.toggle('active', on); }
  toast(msg: string, ms = 2400) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), ms);
  }
  hideToast() { clearTimeout(this.toastTimer); this.toastEl.classList.remove('on'); }
  /** hide the chrome (films, games that want the screen) */
  setChrome(on: boolean) { document.body.classList.toggle('nochrome', !on); }
}
