// A place's introduction, over the flight there and a while after: while you travel its scale, its name (letter by
// letter out of a blur) and what it is; on arrival a few things to look for or try, the ones that can do something
// (play here, the microscope, the next place down) as buttons. It drifts away after a while, sooner if you wander
// off, and waits while the pointer rests on it; the place's card in the dock brings it back.
import type { Place } from './places';

/** `act`: 'play:<game>', 'place:<id>', or a button's id (hud.ts) */
export interface Tip { k: string; t: string; act?: string }

export const INTRO: Record<string, { size: string; tips: Tip[] }> = {
  tissue: { size: '100 µm', tips: [
    { k: 'Look', t: 'Each rounded shape is one cell; the dark core inside is its nucleus.' },
    { k: 'Look', t: 'The wavy mat underneath is collagen, the rope that holds tissue together.' },
    { k: 'Try', t: 'Scroll toward a cell and keep going, straight through its membrane.' },
  ] },
  cell: { size: '20 µm', tips: [
    { k: 'Look', t: 'The big round body is the nucleus; the folded sheets round it are the ER.' },
    { k: 'Try', t: 'Hover anything for its name, click it for its story.' },
    { k: 'See', t: 'Stain it the way a lab would: DNA, mitochondria, the cytoskeleton.', act: 'fluo' },
  ] },
  nucleus: { size: '7 µm', tips: [
    { k: 'Look', t: 'The cut face shows chromatin, and the dense nucleolus where ribosomes are built.' },
    { k: 'Look', t: 'Its skin is two membranes, pierced by thousands of pores.' },
    { k: 'Go', t: 'Down to a nuclear pore', act: 'place:pore' },
  ] },
  pore: { size: '120 nm', tips: [
    { k: 'Look', t: 'Each ring is one pore: about a thousand proteins in eight-fold symmetry.' },
    { k: 'Look', t: 'Its channel is a mesh of loose threads: small molecules slip through, big ones are escorted.' },
    { k: 'Try', t: 'Scroll into a pore to pass through the envelope.' },
  ] },
  dna: { size: '20 nm', tips: [
    { k: 'Look', t: 'Each bead is a nucleosome: DNA wound 1.65 times round eight histones.' },
    { k: 'Look', t: 'Between the beads, the bare double helix, a base pair every 0.34 nm.' },
    { k: 'Play', t: 'Become RNA polymerase and copy a gene', act: 'play:polymerase' },
  ] },
  mito: { size: '2 µm', tips: [
    { k: 'Look', t: 'A smooth outer membrane, and an inner one folded into cristae.' },
    { k: 'Know', t: 'Once a free-living bacterium, it still keeps a small genome of its own.' },
    { k: 'Go', t: 'Into a crista, to its motors', act: 'place:atp' },
  ] },
  atp: { size: '50 nm', tips: [
    { k: 'Look', t: 'Each mushroom is a motor: a rotor in the membrane, a head that makes ATP.' },
    { k: 'Look', t: 'The L-shaped giants are Complex I, where the respiratory chain begins.' },
    { k: 'Play', t: 'Become ATP synthase and spin', act: 'play:atp' },
  ] },
  er: { size: '300 nm', tips: [
    { k: 'Look', t: 'Each knob on the sheet is a ribosome, threading a new protein into the ER.' },
    { k: 'Know', t: 'A cell has about ten million ribosomes, each adding five amino acids a second.' },
    { k: 'Play', t: 'Become a ribosome and read the code', act: 'play:ribosome' },
  ] },
  golgi: { size: '1 µm', tips: [
    { k: 'Look', t: 'Proteins from the ER enter one face of the stack and leave the other, finished.' },
    { k: 'Look', t: 'The bubbles crowding round it are vesicles, carrying that cargo away.' },
    { k: 'Try', t: 'Double-click a sac to dive into it.' },
  ] },
  mt: { size: '100 nm', tips: [
    { k: 'Look', t: 'Thirteen rows of tubulin make each tube\'s wall.' },
    { k: 'Look', t: 'Find a kinesin: two heads stepping 8 nm at a time, cargo in tow.' },
    { k: 'Play', t: 'Become kinesin and walk the track', act: 'play:kinesin' },
  ] },
  membrane: { size: '50 nm', tips: [
    { k: 'Look', t: 'The branching threads rising from it are its sugar coat, the glycocalyx.' },
    { k: 'Try', t: 'Hover the proteins set in it: pumps, receptors, glucose gates.' },
    { k: 'Try', t: 'Scroll down through the bilayer, into the cell.' },
  ] },
};

const HOLD = 8, PER_TIP = 2;

const h = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

export class Intro {
  private el = h('div', 'intro');
  /** the place it's introducing */
  place: string | null = null;
  private phase: 'off' | 'travel' | 'here' = 'off';
  private left = 0;
  private resting = false;
  private gone = 0;
  onAct: (act: string) => void = () => {};

  constructor(parent: HTMLElement) { parent.append(this.el); }

  show(p: Place) {
    const text = INTRO[p.id];
    if (!text) return;
    clearTimeout(this.gone);
    this.place = p.id;
    this.phase = 'travel';
    this.resting = false;
    // the name a letter at a time (each word kept whole, so it wraps between words)
    let n = 0;
    const name = p.name.split(' ').map((w) => `<span class="intro-w">${[...w].map((ch) => `<span class="ch" style="--i:${n++}">${ch}</span>`).join('')}</span>`).join(' ');
    this.el.className = 'intro';
    this.el.innerHTML = `
      <div class="intro-size"><i></i><span>${text.size}</span><i></i></div>
      <h2 class="intro-name">${name}</h2>
      <p class="intro-line">${p.line}</p>
      <div class="intro-tips">${text.tips.map((t, i) => {
        const tag = t.act ? 'button' : 'div';
        return `<${tag} class="intro-tip" style="--i:${i}"${t.act ? ` data-act="${t.act}"` : ''}><b>${t.k}</b><span>${t.t}${t.act ? ' →' : ''}</span></${tag}>`;
      }).join('')}</div>`;
    for (const t of this.el.querySelectorAll<HTMLElement>('.intro-tip')) {
      t.addEventListener('pointerenter', () => { this.resting = true; });
      t.addEventListener('pointerleave', () => { this.resting = false; });
      if (t.dataset.act) t.addEventListener('click', (e) => { e.stopPropagation(); this.hide(true); this.onAct(t.dataset.act!); });
    }
    // (a frame in its resting state first, so everything transitions in)
    void this.el.offsetWidth;
    this.el.classList.add('on');
  }

  /** there: the tips come in, and the hold starts */
  private arrive() {
    this.phase = 'here';
    this.left = HOLD + PER_TIP * (INTRO[this.place!]?.tips.length ?? 0);
    this.el.classList.add('arrived');
  }

  hide(quick = false) {
    if (this.phase === 'off') return;
    this.phase = 'off';
    this.place = null;
    this.resting = false;
    this.el.classList.add('leaving');
    this.el.classList.toggle('quick', quick);
    clearTimeout(this.gone);
    this.gone = window.setTimeout(() => { this.el.className = 'intro'; this.el.innerHTML = ''; }, quick ? 600 : 2600);
  }

  /** `flying`: the camera's still on its way; `near`: the view is still at the place */
  update(dt: number, flying: boolean, near: boolean) {
    if (this.phase === 'travel' && !flying) { if (near) this.arrive(); else this.hide(); }
    if (this.phase !== 'here') return;
    // wandered off: it goes soon, even while read
    if (!near) this.left = Math.min(this.left, 1.2);
    else if (this.resting) return;
    this.left -= dt;
    if (this.left <= 0) this.hide();
  }
}
