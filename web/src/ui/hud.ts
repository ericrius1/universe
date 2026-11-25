// The interface over the world: where you are (breadcrumb), how big things are (the powers-of-ten ladder, a scale bar,
// how much time has slowed), what's under the cursor (a tag) and what you chose (a card), the places to fly to, the
// buttons (tour, the guide, fly, play, cutaway, microscope, sound, help), the tour's captions, and the way back to ericlevin.dev
// (home.ts, its mark before the name). Plain DOM, written only when a value changes.
import { home } from './home';
import { LEARN_ICON } from './intro';
import type { Card } from './info';
import type { Place } from './places';

// (lengths are nanometres here, all the way up: 1e36 nm is the observable universe)
const RUNGS: [number, string, string][] = [
  [1e36, '100 billion ly', 'the observable universe'],
  [1e33, '100 million ly', 'the cosmic web'],
  [1e30, '100,000 ly', 'the Milky Way'],
  [1e26, '10 light-years', 'the nearest stars'],
  [1e22, '70 AU', 'the solar system'],
  [1e16, '10,000 km', 'the Earth'],
  [1e13, '10 km', 'a town'],
  [1e9, '1 m', 'a person'],
  [1e6, '1 mm', 'the creases of skin'],
  [1e4, '10 µm', 'a cell'],
  [1e2, '100 nm', 'viruses, nuclear pores'],
  [1e0, '1 nm', 'DNA\'s width, a lipid'],
];
/** the ladder's ends (log10 nm), round its first rung and its last: the window's (setRange) */
const TOP_PAD = 0.2, BOTTOM_PAD = 0.3;

const LYR = 9.4607e24, AU_NM = 1.495978707e20;
const num = (x: number) => { const p = +x.toPrecision(2); return p >= 1e4 ? p.toLocaleString('en') : String(p); };
export function fmtLength(nm: number): string {
  if (nm >= LYR * 1e9) return `${num(nm / (LYR * 1e9))} billion ly`;
  if (nm >= LYR * 1e6) return `${num(nm / (LYR * 1e6))} million ly`;
  if (nm >= LYR * 0.1) return `${num(nm / LYR)} light-years`;
  if (nm >= AU_NM * 0.05) return `${num(nm / AU_NM)} AU`;
  if (nm >= 1e12) return `${num(nm / 1e12)} km`;
  if (nm >= 1e9) return `${num(nm / 1e9)} m`;
  if (nm >= 1e7) return `${num(nm / 1e7)} cm`;
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
  /** the window's name, under the brand, and the one way out to everything (setWindow) */
  private windowEl = h('div', 'window');
  private widen = h('button', 'widen', 'Let it out to everything ↗') as HTMLButtonElement;
  /** let a narrower window out to the whole universe */
  onWiden: () => void = () => {};
  /** the ladder's rungs, each its length (log10 nm), and the ends the dot moves between */
  private rungs: [HTMLElement, number][] = [];
  private top = 36 + TOP_PAD;
  private bottom = 0 - BOTTOM_PAD;
  private base: string;

  private brand!: HTMLElement;
  private topbar!: HTMLElement;
  private scaleBox!: HTMLElement;
  private chromeEls: HTMLElement[] = [];
  private ro: ResizeObserver | null = null;
  private layoutRaf = 0;
  private rungY: number[] = [];
  private ladderH = 0;
  private dotT = 0;

  constructor(parent: HTMLElement, places: Place[], base: string) {
    this.root = parent;
    this.base = base;
    const brand = this.brand = h('div', 'brand', '<div class="brand-name">Universe</div>');
    brand.append(this.crumbs);
    this.widen.title = 'Open the whole zoom, from the edge of everything to a molecule';
    this.widen.addEventListener('click', (e) => { e.stopPropagation(); this.onWiden(); });
    this.windowEl.style.display = 'none';
    brand.append(this.windowEl);
    home({ mount: brand, before: brand.firstElementChild, mark: true });
    const top = this.topbar = h('div', 'topbar');
    const btn = (id: string, label: string, title: string, extra = '') => {
      const b = h('button', extra ? `btn ${extra}` : 'btn', label) as HTMLButtonElement;
      b.title = title;
      b.addEventListener('click', (e) => { e.stopPropagation(); this.onButton(id); });
      this.buttons[id] = b;
      top.append(b);
    };
    btn('tour', '<b>▶</b> Tour', 'A guided fall (T)');
    btn('guide', `${LEARN_ICON}<span>Deep dive</span>`, 'Deep dive: explore details and bring landmarks into focus (I)', 'btn-deep');
    btn('fly', '<b>✈&#xFE0E;</b> Fly', 'Fly it yourself (F)');
    btn('play', '✦ Play', 'Become part of the cell (P)');
    btn('cut', '◐ Cutaway', 'Open or close the cell (C)');
    btn('fluo', '◉ Microscope', 'Under the microscope (M)');
    btn('sound', '♪', 'Sound on/off (S)');
    btn('help', '?', 'How to move (H)');

    // the ladder of scales
    for (const [nm, label, what] of RUNGS) {
      const r = h('div', 'rung', `<span class="rung-l">${label}</span><span class="rung-w">${what}</span>`);
      this.ladder.append(r);
      this.rungs.push([r, Math.log10(nm)]);
    }
    this.ladder.append(this.ladderDot);
    this.ladderDot.append(this.ladderVal);
    this.bar.append(this.barLine, this.barText);
    const scaleBox = this.scaleBox = h('div', 'scalebox');
    scaleBox.append(this.bar, this.timeText);

    this.setPlaces(places);
    this.help.innerHTML = `
      <div class="help-in">
        <h2>Getting around</h2>
        <div class="help-grid">
          <div><b>Zoom</b><span>scroll, pinch, or + / −, toward whatever's under the cursor. Keep going.</span></div>
          <div><b>Look round</b><span>drag. Right-drag or two fingers to pan.</span></div>
          <div><b>Go to</b><span>double-click anything, or pick a place below.</span></div>
          <div><b>Fly</b><span>F: the mouse looks, W A S D and Q / E fly, Shift is faster, scroll sets the speed, Esc lands. On a phone, left thumb flies, drag looks.</span></div>
          <div><b>Deep dive</b><span>click Deep dive (or press I) for scale facts, visual highlights, and planet/molecule focus; [ and ] step chapters.</span></div>
          <div><b>Time</b><span>slows as you shrink: 100× slower among the molecules.</span></div>
        </div>
        <p class="help-foot">The planets and the Moon are where they are today. Molecules from the RCSB Protein Data Bank.
          <a href="${base}footage/" target="_blank" rel="noopener">Watch the film ↗</a></p>
        <button class="btn help-close">Close</button>
      </div>`;
    this.help.addEventListener('click', () => this.toggleHelp(false));
    this.card.addEventListener('click', (e) => e.stopPropagation());
    parent.append(brand, top, this.ladder, scaleBox, this.tag, this.card, this.caption, this.dock, this.help, this.toastEl);
    this.ro = new ResizeObserver(() => this.scheduleLayout());
    for (const el of [brand, top, this.dock, scaleBox, this.ladder]) this.ro.observe(el);
    addEventListener('resize', () => this.scheduleLayout());
    document.fonts?.ready.then(() => this.scheduleLayout());
    this.scheduleLayout();
  }

  /** watch floating top-right chrome (controls toggle, camera button) so the topbar and panels stay clear of them */
  observeChrome(...els: (HTMLElement | null | undefined)[]) {
    for (const el of els) {
      if (!el || this.chromeEls.includes(el)) continue;
      this.chromeEls.push(el);
      this.ro?.observe(el);
    }
    this.scheduleLayout();
  }

  private scheduleLayout() {
    if (this.layoutRaf) return;
    this.layoutRaf = requestAnimationFrame(() => {
      this.layoutRaf = 0;
      this.syncLayout();
    });
  }

  /** measure live HUD edges into CSS custom properties so topbar, camera/toggle, brand, crumbs, dock and panels never overlap */
  syncLayout() {
    const doc = document.documentElement.style;
    const W = innerWidth, H = innerHeight;
    const desktop = W > 760;

    // right-corner floating chrome (.ctl-toggle + .pic-button): keep .topbar 8px clear of whichever sits furthest left
    let minLeft = W - 16;
    let chromeBottom = 0;
    for (const el of this.chromeEls) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) {
        minLeft = Math.min(minLeft, r.left);
        chromeBottom = Math.max(chromeBottom, r.bottom);
      }
    }
    const ctlW = Math.max(0, Math.ceil(W - minLeft - 16 + 8));
    if (ctlW > 0) doc.setProperty('--ctl-w', `${ctlW}px`);

    // top-left brand row 1 (home mark, title, contact pill) so .topbar never collides horizontally with it
    let brandRowRight = 0;
    for (const sel of ['.home-link', '.brand-name', '.home-contact']) {
      const r = this.brand.querySelector<HTMLElement>(sel)?.getBoundingClientRect();
      if (r && r.width > 0) brandRowRight = Math.max(brandRowRight, r.right);
    }
    if (brandRowRight > 0) doc.setProperty('--brand-w', `${Math.ceil(brandRowRight)}px`);

    const brandRect = this.brand.getBoundingClientRect();
    if (brandRect.height > 0) doc.setProperty('--brand-bottom', `${Math.ceil(brandRect.bottom)}px`);

    const topRect = this.topbar.getBoundingClientRect();
    if (desktop) {
      const topBottom = Math.ceil(Math.max(topRect.bottom, chromeBottom, 50));
      doc.setProperty('--top-bottom', `${topBottom}px`);
      // when .topbar wraps to a second row on narrow desktops, keep .crumbs strictly to its left
      const crumbsRect = this.crumbs.getBoundingClientRect();
      if (topRect.height > 46 && crumbsRect.width > 0 && topRect.left > crumbsRect.left + 80) {
        doc.setProperty('--crumbs-max', `${Math.floor(topRect.left - crumbsRect.left - 16)}px`);
      } else {
        doc.setProperty('--crumbs-max', '52vw');
      }
    }

    const scaleRect = this.scaleBox.getBoundingClientRect();
    if (scaleRect.height > 0) doc.setProperty('--scalebox-bottom', `${Math.ceil(scaleRect.bottom)}px`);

    const dockRect = this.dock.getBoundingClientRect();
    if (dockRect.height > 0) doc.setProperty('--dock-top', `${Math.ceil(H - dockRect.top)}px`);

    // cache ladder rung vertical centers so update() can softly clear whichever rung sits under the scale pill
    this.ladderH = this.ladder.clientHeight;
    this.rungY = this.rungs.map(([el]) => (el.style.display === 'none' ? -1e4 : el.offsetTop + el.offsetHeight * 0.5));
    this.maskRungs();
  }

  private maskRungs() {
    if (!this.ladderH) return;
    const dotY = this.dotT * this.ladderH;
    this.rungs.forEach(([el], i) => {
      el.classList.toggle('covered', Math.abs(this.rungY[i] - dotY) < 17);
    });
  }

  /** the dock's places (the window's: they change as it's let out and its realms come in) */
  setPlaces(places: Place[]) {
    const ids = places.map((p) => p.id).join();
    if (this.last.places === ids) return;
    this.last.places = ids;
    for (const p of places) {
      if (this.placeEls.has(p.id)) continue;
      // (the places above the cell have no picture yet: no request for one)
      const img = p.art ? `<img alt="" src="${this.base}art/${p.art}.webp" onerror="this.style.visibility='hidden'">` : '<img alt="" style="visibility:hidden">';
      const c = h('button', 'place', `${img}<span>${p.name}</span>`) as HTMLButtonElement;
      c.title = p.line;
      c.addEventListener('click', (e) => { e.stopPropagation(); this.onPlace(p.id); });
      this.placeEls.set(p.id, c);
    }
    const keep = new Set(places.map((p) => p.id));
    for (const [id, el] of this.placeEls) if (!keep.has(id)) el.remove();
    this.dock.append(...places.map((p) => this.placeEls.get(p.id)!));
    this.last.here = '';
    this.scheduleLayout();
  }

  /** a window narrower than everything (null: the whole universe): its name under the brand, the way out to everything,
   *  and the ladder kept to its stretch (`top`, `bottom`: its ends as fields of view, log10 nm) */
  setWindow(w: { name: string; line: string; top: number; bottom: number } | null) {
    if (w) {
      this.windowEl.innerHTML = '';
      const name = h('span', 'window-name');
      name.textContent = w.name;
      name.title = w.line;
      this.windowEl.append(name, this.widen);
      this.windowEl.style.display = '';
    } else this.windowEl.style.display = 'none';
    document.body.classList.toggle('windowed', !!w);
    this.setRange(w ? w.top : Infinity, w ? w.bottom : -Infinity);
    this.scheduleLayout();
  }
  /** the ladder's rungs within a stretch (log10 nm; one rung past each end kept, so the dot's always between two) */
  private setRange(top: number, bottom: number) {
    const L = this.rungs.map(([, l]) => l);
    let i0 = 0, i1 = L.length - 1;
    while (i0 < L.length - 1 && L[i0 + 1] >= top) i0++;
    while (i1 > i0 + 1 && L[i1 - 1] <= bottom) i1--;
    this.rungs.forEach(([el], i) => { el.style.display = i >= i0 && i <= i1 ? '' : 'none'; });
    this.top = L[i0] + TOP_PAD;
    this.bottom = L[i1] - BOTTOM_PAD;
    this.last.dot = '';
    this.scheduleLayout();
  }
  /** the cell's buttons (fly, play, the cutaway, the microscope): only where the window has the cell */
  setCell(on: boolean) { for (const id of ['fly', 'play', 'cut', 'fluo']) this.show(id, on); }
  /** a button shown or not */
  show(id: string, on: boolean) { const b = this.buttons[id]; if (b) { b.style.display = on ? '' : 'none'; this.scheduleLayout(); } }

  private set(key: string, el: HTMLElement, v: string, prop: 'html' | 'text' | 'style' = 'text', styleKey = '') {
    if (this.last[key] === v) return;
    this.last[key] = v;
    if (prop === 'html') el.innerHTML = v;
    else if (prop === 'text') el.textContent = v;
    else (el.style as unknown as Record<string, string>)[styleKey] = v;
  }

  update(s: HudState) {
    // (on a phone the address keeps its last two steps, so it stays one line)
    const crumbs = s.crumbs.length > 2 && innerWidth <= 760 ? ['…', ...s.crumbs.slice(-2)] : s.crumbs;
    this.set('crumbs', this.crumbs, crumbs.map((c, i) => `<span${i === crumbs.length - 1 ? ' class="here"' : ''}>${c}</span>`).join('<i>›</i>'), 'html');
    // ladder: from the observable universe to a nanometre; the dot sits at log10 of the field of view
    const t = Math.max(0, Math.min(1, (this.top - Math.log10(Math.max(s.fov, 1e-3))) / (this.top - this.bottom)));
    const dotPct = `${(t * 100).toFixed(2)}%`;
    if (this.last.dot !== dotPct) {
      this.dotT = t;
      this.set('dot', this.ladderDot, dotPct, 'style', 'top');
      this.maskRungs();
    }
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
