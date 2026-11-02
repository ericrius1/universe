// A place's introduction, over the flight there and a while after: its scale, its name (letter by letter out of a
// blur) and what it is. It drifts away a while after arrival, sooner if you wander off; the place's card in the dock
// brings it back.
import type { Place } from './places';

/** each place's scale (the places above the cell add theirs: main.ts) */
export const SIZE: Record<string, string> = {
  tissue: '100 µm',
  cell: '20 µm',
  nucleus: '7 µm',
  pore: '120 nm',
  dna: '20 nm',
  mito: '2 µm',
  atp: '50 nm',
  er: '300 nm',
  golgi: '1 µm',
  mt: '100 nm',
  membrane: '50 nm',
};

const HOLD = 8;

const h = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

export class Intro {
  private el = h('div', 'intro');
  /** the place it's introducing */
  place: string | null = null;
  private phase: 'off' | 'travel' | 'here' = 'off';
  private left = 0;
  private gone = 0;

  constructor(parent: HTMLElement) { parent.append(this.el); }

  show(p: Place) {
    const size = SIZE[p.id];
    if (!size) return;
    clearTimeout(this.gone);
    this.place = p.id;
    this.phase = 'travel';
    // the name a letter at a time (each word kept whole, so it wraps between words)
    let n = 0;
    const name = p.name.split(' ').map((w) => `<span class="intro-w">${[...w].map((ch) => `<span class="ch" style="--i:${n++}">${ch}</span>`).join('')}</span>`).join(' ');
    this.el.className = 'intro';
    this.el.innerHTML = `
      <div class="intro-size"><i></i><span>${size}</span><i></i></div>
      <h2 class="intro-name">${name}</h2>
      <p class="intro-line">${p.line}</p>`;
    // (a frame in its resting state first, so everything transitions in)
    void this.el.offsetWidth;
    this.el.classList.add('on');
  }

  /** there: the hold starts */
  private arrive() {
    this.phase = 'here';
    this.left = HOLD;
  }

  hide(quick = false) {
    if (this.phase === 'off') return;
    this.phase = 'off';
    this.place = null;
    this.el.classList.add('leaving');
    this.el.classList.toggle('quick', quick);
    clearTimeout(this.gone);
    this.gone = window.setTimeout(() => { this.el.className = 'intro'; this.el.innerHTML = ''; }, quick ? 600 : 2600);
  }

  /** `flying`: the camera's still on its way; `near`: the view is still at the place */
  update(dt: number, flying: boolean, near: boolean) {
    if (this.phase === 'travel' && !flying) { if (near) this.arrive(); else this.hide(); }
    if (this.phase !== 'here') return;
    // wandered off: it goes soon
    if (!near) this.left = Math.min(this.left, 1.2);
    this.left -= dt;
    if (this.left <= 0) this.hide();
  }
}
