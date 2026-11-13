// The guide: one story told in chapters from the edge of the observable universe down into a cell (story.ts), each at
// its place: what it is, its scale against something to hand, things to look for that light up in the view, something
// to know, how we know it, and an instrument where there is one. Or, in the cell, the card of a thing that was tapped,
// with the way back to the chapter and the chapter that thing works in. A window shows only its own chapters.
//
// Quiet by default: it opens from its button (or I) and never by itself, so someone who only wants to fly never has it
// in the way. On a laptop it's a panel on the right; on a phone a sheet over the bottom that folds down to its heading
// while you move round the world. Written from Cell's guide (ui/guide.ts there).
import type { Card } from './info';
import { STORY, type Chapter, type Look } from './story';

const h = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** the first sentence as the lead, the rest after it */
const paragraphs = (text: string) => {
  const [lead, ...rest] = text.split(/(?<=[.:])\s+(?=[A-Z])/);
  return `<p class="g-lead">${esc(lead)}</p>${rest.length ? `<p class="g-text">${esc(rest.join(' '))}</p>` : ''}`;
};
/** a title a letter at a time out of a blur (each word kept whole, so it wraps between words) */
const letters = (s: string) => { let n = 0; return s.split(' ').map((w) => `<span class="g-w">${[...w].map((ch) => `<span class="ch" style="--i:${n++}">${esc(ch)}</span>`).join('')}</span>`).join(' '); };

export class Guide {
  readonly el = h('section', 'guide');
  /** the chapter showing (an index into STORY), or the one a thing's card goes back to (-1: none) */
  chapter = -1;
  mode: 'off' | 'chapter' | 'thing' = 'off';
  /** the chapters this window tells, in order (indices into STORY) */
  order: number[] = STORY.map((_, i) => i);
  onStep: (i: number) => void = () => {};
  onLook: (look: Look, k: number) => void = () => {};
  onAct: (act: string) => void = () => {};
  onInstrument: (c: Chapter) => void = () => {};
  onFlyCloser: () => void = () => {};
  onClose: () => void = () => {};

  constructor(parent: HTMLElement, readonly phone: boolean) {
    this.el.setAttribute('aria-live', 'polite');
    this.el.setAttribute('aria-label', 'Guide');
    this.el.addEventListener('click', (e) => e.stopPropagation());
    parent.append(this.el);
    // (on a phone, folded, the buttons ride just above it: style.css reads its height)
    new ResizeObserver(() => document.documentElement.style.setProperty('--guide-h', `${this.el.offsetHeight}px`)).observe(this.el);
  }

  /** a chapter of the story (`folded`: on a phone, just its heading) */
  showChapter(i: number, folded = false) {
    const c = STORY[i];
    if (!c) return;
    this.chapter = i;
    this.mode = 'chapter';
    const at = this.order.indexOf(i);
    const prev = at > 0 ? STORY[this.order[at - 1]] : null, next = at >= 0 && at < this.order.length - 1 ? STORY[this.order[at + 1]] : null;
    const n = this.order.length;
    this.render(`
      <div class="g-head">
        <div class="g-part">${at >= 0 ? `<b>${at + 1}</b> of ${n} · ` : ''}${esc(c.part)}</div>
        <h2 class="g-title">${letters(c.title)}</h2>
        <div class="g-scale"><span>${esc(c.scale)}</span>${esc(c.like)}</div>
      </div>
      <div class="g-body">
        ${paragraphs(c.text)}
        ${c.look.length ? `<div class="g-look"><div class="g-h">Look for</div>${c.look.map((l, k) => l.spot?.length
          ? `<button class="g-spot" data-k="${k}"><i></i><span>${esc(l.t)}</span></button>`
          : `<p class="g-note"><span>${esc(l.t)}</span></p>`).join('')}</div>` : ''}
        ${c.know ? `<p class="g-know">${esc(c.know)}</p>` : ''}
        ${c.instrument ? `<button class="g-inst"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 16.5h14M5 16V9M9 16V5M13 16v-5M17 16V7.5"/></svg><span><b>${esc(c.instrument.label)}</b><small>${esc(c.instrument.about)}</small></span></button>` : ''}
        ${c.how ? `<div class="g-how"><div class="g-h">How we know</div><p>${esc(c.how)}</p></div>` : ''}
        ${c.act ? `<button class="btn btn-play g-act" data-act="${c.act.act}">${esc(c.act.label)}</button>` : ''}
      </div>
      <nav class="g-nav">
        <button class="g-prev"${prev ? '' : ' disabled'}>${prev ? `‹ ${esc(prev.short)}` : ''}</button>
        <button class="g-next">${next ? `Next: ${esc(next.short)} ›` : '↺ From the top'}</button>
      </nav>`, folded);
    const q = <T extends HTMLElement>(s: string) => this.el.querySelector<T>(s);
    q('.g-prev')?.addEventListener('click', () => { if (prev) this.onStep(this.order[at - 1]); });
    q('.g-next')?.addEventListener('click', () => this.onStep(next ? this.order[at + 1] : this.order[0]));
    for (const b of this.el.querySelectorAll<HTMLElement>('.g-spot')) b.addEventListener('click', () => { const k = Number(b.dataset.k); this.onLook(c.look[k], k); });
    q('.g-act')?.addEventListener('click', (e) => this.onAct((e.currentTarget as HTMLElement).dataset.act!));
    q('.g-inst')?.addEventListener('click', () => this.onInstrument(c));
  }

  /** a thing that was tapped: what it is, and the chapter it works in (`works`, -1 for none) */
  showThing(card: Card, works: number) {
    this.mode = 'thing';
    const meta = [card.size, card.count].filter(Boolean).join(' · ');
    const w = this.order.includes(works) ? STORY[works] : null;
    const back = STORY[this.chapter];
    this.render(`
      <div class="g-head">
        <div class="g-meta">${meta ? esc(meta) : 'In the cell'}</div>
        <h2 class="g-title">${letters(card.title)}</h2>
      </div>
      <div class="g-body">
        <p class="g-text">${esc(card.text)}</p>
        ${card.pdb ? `<a class="g-pdb" href="https://www.rcsb.org/structure/${card.pdb}" target="_blank" rel="noopener">Its real structure: PDB ${card.pdb} ↗</a>` : ''}
        <div class="g-acts"><button class="btn g-fly">Fly closer</button></div>
        ${w && works !== this.chapter ? `<button class="g-works">Where it works in the story <b>${esc(w.part)} ›</b></button>` : ''}
      </div>
      ${back ? `<nav class="g-nav"><button class="g-prev">‹ Back to ${esc(back.title)}</button></nav>` : ''}`);
    const q = <T extends HTMLElement>(s: string) => this.el.querySelector<T>(s);
    q('.g-fly')?.addEventListener('click', () => this.onFlyCloser());
    q('.g-works')?.addEventListener('click', () => this.onStep(works));
    q('.g-prev')?.addEventListener('click', () => this.showChapter(this.chapter));
  }

  private render(html: string, folded = false) {
    this.el.innerHTML = `${this.phone ? '<button class="g-grip" aria-label="Fold or unfold"></button>' : ''}<button class="g-x" aria-label="Close the guide">×</button>${html}`;
    this.el.querySelector('.g-x')!.addEventListener('click', () => this.close());
    // (on a phone the heading or the grip folds it down and back up)
    if (this.phone) for (const s of ['.g-grip', '.g-head']) this.el.querySelector(s)?.addEventListener('click', () => this.fold(!this.folded));
    this.el.classList.remove('lit-title');
    this.setFolded(folded && this.phone);
    this.el.classList.add('on');
    document.body.classList.add('guiding');
    this.el.querySelector('.g-body')?.scrollTo(0, 0);
    // (a frame in its resting state first, so the title rises in)
    void this.el.offsetWidth;
    this.el.classList.add('lit-title');
  }

  get folded() { return this.el.classList.contains('folded'); }
  get open() { return this.mode !== 'off'; }
  /** on a phone, down to its heading (while you move round the world) or back up */
  fold(on: boolean) { if (this.phone && this.open) this.setFolded(on); }
  private setFolded(on: boolean) {
    this.el.classList.toggle('folded', on);
    document.body.classList.toggle('guide-folded', on);
  }

  /** a look-for item lit or not (-1: none) */
  setLit(k: number) { for (const b of this.el.querySelectorAll<HTMLElement>('.g-spot')) b.classList.toggle('lit', Number(b.dataset.k) === k); }
  /** a look-for item that has nothing to light yet, or nothing in view: said under it a moment */
  setMissing(k: number, why: string) {
    const b = this.el.querySelector<HTMLElement>(`.g-spot[data-k="${k}"]`);
    if (!b) return;
    b.querySelector('em')?.remove();
    const e = h('em', 'g-miss');
    e.textContent = why;
    b.querySelector('span')!.append(e);
    setTimeout(() => e.remove(), 3200);
  }

  close() {
    if (!this.open) return;
    this.mode = 'off';
    this.el.classList.remove('on');
    this.setFolded(false);
    document.body.classList.remove('guiding');
    this.onClose();
  }
}
