// A place's introduction, over the flight there and a while after: its scale, its name (letter by letter out of a
// blur), what it is, and a clear, inviting solarpunk "Learn more" trigger right below it to go deeper and bring the
// place's landmarks into focus. It drifts away a while after arrival (pausing while hovered), sooner if you wander off;
// the place's card in the dock brings it back.
import type { Place } from './places';
import { STORY, chapterAt } from './story';

/** each place's scale (the places above the cell add theirs: app.ts) */
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

const HOLD = 9;

/** bespoke solarpunk botanical-astrolabe emblem: a golden compass ring framing a sprouting four-petal star */
export const LEARN_ICON = `<svg class="learn-ic" viewBox="0 0 24 24" aria-hidden="true">
  <circle class="li-ring" cx="12" cy="12" r="9.2" />
  <path class="li-arc" d="M12 2.8A9.2 9.2 0 0 1 21.2 12" />
  <path class="li-star" d="M12 5.2c.9 3.6 3.2 5.9 6.8 6.8-3.6.9-5.9 3.2-6.8 6.8-.9-3.6-3.2-5.9-6.8-6.8 3.6-.9 5.9-3.2 6.8-6.8Z" />
  <circle class="li-core" cx="12" cy="12" r="1.7" />
</svg>`;

const h = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

export class Intro {
  private el = h('div', 'intro');
  /** the place it's introducing */
  place: string | null = null;
  private phase: 'off' | 'travel' | 'here' = 'off';
  private left = 0;
  private gone = 0;
  private hovering = false;
  /** clicked "Learn more" on this place */
  onMore: (placeId: string) => void = () => {};

  constructor(parent: HTMLElement) { parent.append(this.el); }

  /** whether an introduction is currently on screen */
  get showing() { return this.phase !== 'off'; }

  show(p: Place) {
    const size = SIZE[p.id];
    if (!size) return;
    clearTimeout(this.gone);
    this.place = p.id;
    this.phase = 'travel';
    this.hovering = false;
    // the name a letter at a time (each word kept whole, so it wraps between words)
    let n = 0;
    const name = p.name.split(' ').map((w) => `<span class="intro-w">${[...w].map((ch) => `<span class="ch" style="--i:${n++}">${ch}</span>`).join('')}</span>`).join(' ');
    const ci = chapterAt(p.id);
    const ch = ci >= 0 ? STORY[ci] : null;
    const spots = ch ? ch.look.filter((l) => l.spot?.length).length : 0;
    const hint = spots > 0 ? `<small>${spots} to focus</small>` : '';
    this.el.className = 'intro';
    this.el.innerHTML = `
      <div class="intro-size"><i></i><span>${size}</span><i></i></div>
      <h2 class="intro-name">${name}</h2>
      <p class="intro-line">${p.line}</p>
      ${ch ? `<div class="intro-cta"><button class="intro-more" type="button" aria-label="Deep dive into ${p.name}">${LEARN_ICON}<span>Deep dive</span>${hint}<em class="intro-arr" aria-hidden="true">↗</em></button></div>` : ''}`;
    const btn = this.el.querySelector<HTMLButtonElement>('.intro-more');
    if (btn) {
      btn.addEventListener('pointerenter', () => { this.hovering = true; });
      btn.addEventListener('pointerleave', () => { this.hovering = false; });
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.onMore(p.id); });
    }
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
    this.hovering = false;
    this.el.classList.add('leaving');
    this.el.classList.toggle('quick', quick);
    clearTimeout(this.gone);
    this.gone = window.setTimeout(() => { this.el.className = 'intro'; this.el.innerHTML = ''; }, quick ? 600 : 2600);
  }

  /** `flying`: the camera's still on its way; `near`: the view is still at the place */
  update(dt: number, flying: boolean, near: boolean) {
    if (this.phase === 'travel' && !flying) { if (near) this.arrive(); else this.hide(); }
    if (this.phase !== 'here') return;
    // keep alive while the visitor hovers the "Learn more" pill
    if (this.hovering) { this.left = Math.max(this.left, 2.5); return; }
    // wandered off: it goes soon
    if (!near) this.left = Math.min(this.left, 1.2);
    this.left -= dt;
    if (this.left <= 0) this.hide();
  }
}
