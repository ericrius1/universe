// The instruments: one small panel per chapter that has one (cosmos/story.ts Instrument), drawn in 2D from the same
// data the view draws. Each is a chunk of its own, fetched (with its data) only when it's opened; it draws on a canvas
// when it opens, when the panel changes size and when what it shows changes, never every frame. A panel opens from its
// chapter and closes out of the way: beside the guide on a laptop, over it on a phone.
import type { Kit } from '@ericrius1/weft';
import type { Cosmos } from '../../cosmos';
import type { Instrument } from '../../cosmos/story';

/** what an instrument can read */
export interface InstrumentCtx {
  base: string;
  cosmos: Cosmos;
  kit: Kit;
  /** the view's zoom (log10 m), when the cosmos has the camera */
  logS: () => number | null;
}
/** an instrument, open: drawn into its panel's canvas; `tick` (while it's open) redraws only if what it shows moved */
export interface View { draw(): void; tick?(): void; close?(): void }
export type Make = (p: Plot, ctx: InstrumentCtx) => Promise<View>;

const MAKERS: Record<Instrument['id'], () => Promise<{ default: Make }>> = {
  hr: () => import('./hr'),
  kepler: () => import('./kepler'),
  rotation: () => import('./rotation'),
  lookback: () => import('./lookback'),
  cmb: () => import('./cmb'),
  moon: () => import('./moon'),
  altitude: () => import('./altitude'),
};

/** the page's type and ink, for a canvas */
export const INK = { ink: '#f4ede6', dim: 'rgba(244,237,230,0.62)', faint: 'rgba(244,237,230,0.34)', line: 'rgba(255,230,210,0.16)', accent: '#ffb38a', violet: '#b3a6ff' };
export const FONT = { sans: '"Inter", system-ui, sans-serif', mono: '"JetBrains Mono", ui-monospace, monospace', serif: '"Fraunces", Georgia, serif' };

/** a canvas sized to its box at the screen's pixel ratio, and the room in it to draw (css px) */
export class Plot {
  readonly canvas = document.createElement('canvas');
  readonly g: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  /** a line of words under the plot that the instrument writes (a readout) */
  readonly out = document.createElement('div');
  /** a row of controls under it, if the instrument has any */
  readonly row = document.createElement('div');
  onResize: () => void = () => {};
  private ro: ResizeObserver;

  constructor(parent: HTMLElement, aspect: number) {
    this.canvas.className = 'in-plot';
    this.canvas.style.aspectRatio = String(aspect);
    this.out.className = 'in-out';
    this.row.className = 'in-row';
    parent.append(this.canvas, this.out, this.row);
    this.g = this.canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => { if (this.fit()) this.onResize(); });
    this.ro.observe(this.canvas);
    this.fit();
  }
  /** match the canvas's pixels to its box (true if they changed) */
  fit() {
    const r = this.canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (W === this.canvas.width && H === this.canvas.height) return false;
    this.canvas.width = W; this.canvas.height = H;
    this.w = r.width; this.h = r.height;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }
  clear() { this.g.clearRect(0, 0, this.w, this.h); }
  text(s: string, x: number, y: number, o: { size?: number; color?: string; align?: CanvasTextAlign; base?: CanvasTextBaseline; font?: 'sans' | 'mono' | 'serif'; weight?: number } = {}) {
    const g = this.g;
    g.font = `${o.weight ?? 500} ${o.size ?? 11}px ${FONT[o.font ?? 'sans']}`;
    g.fillStyle = o.color ?? INK.dim;
    g.textAlign = o.align ?? 'left';
    g.textBaseline = o.base ?? 'alphabetic';
    g.fillText(s, x, y);
  }
  button(label: string, on: () => void) {
    const b = document.createElement('button');
    b.className = 'in-btn';
    b.textContent = label;
    b.addEventListener('click', (e) => { e.stopPropagation(); on(); });
    this.row.append(b);
    return b;
  }
  dispose() { this.ro.disconnect(); }
}

/** log axes' ticks: the powers of ten (and 2, 5 between, if `fine`) in [a, b] */
export function logTicks(a: number, b: number, fine = false) {
  const t: number[] = [];
  for (let e = Math.floor(Math.log10(a)); e <= Math.ceil(Math.log10(b)); e++) for (const m of fine ? [1, 2, 5] : [1]) { const v = m * 10 ** e; if (v >= a * 0.999 && v <= b * 1.001) t.push(v); }
  return t;
}
export const fmtNum = (x: number) => (x >= 1000 ? Math.round(x).toLocaleString('en') : x >= 10 ? String(Math.round(x)) : x >= 1 ? String(+x.toFixed(1)) : String(+x.toPrecision(2)));

/** the instruments' panel: its title, what it shows, the plot, where it's from, and the way to close it */
export class Instruments {
  readonly el = document.createElement('section');
  /** the one open (its id), or null */
  open: Instrument['id'] | null = null;
  private view: View | null = null;
  private plot: Plot | null = null;
  private seq = 0;
  onClose: () => void = () => {};

  constructor(parent: HTMLElement, private ctx: InstrumentCtx) {
    this.el.className = 'instr';
    this.el.setAttribute('aria-live', 'polite');
    this.el.addEventListener('click', (e) => e.stopPropagation());
    parent.append(this.el);
  }

  async show(inst: Instrument) {
    if (this.open === inst.id) { this.close(); return; }
    this.close(false);
    const seq = ++this.seq;
    this.open = inst.id;
    const src = inst.from.startsWith('model:') ? `${inst.from.slice(6).trim().replace(/^./, (c) => c.toUpperCase())}.` : `From ${inst.from.startsWith('the ') ? inst.from : `data/${inst.from}`}`;
    this.el.innerHTML = `
      <button class="in-x" aria-label="Close the instrument">×</button>
      <div class="in-head"><div class="in-k">Instrument</div><h3>${inst.label}</h3></div>
      <p class="in-about">${inst.about}</p>
      <div class="in-body"><div class="in-wait">Fetching the data…</div></div>
      <p class="in-src">${src}</p>`;
    this.el.querySelector('.in-x')!.addEventListener('click', () => this.close());
    this.el.classList.add('on');
    document.body.classList.add('instrumenting');
    const body = this.el.querySelector<HTMLElement>('.in-body')!;
    try {
      const make = (await MAKERS[inst.id]()).default;
      if (seq !== this.seq) return;
      body.innerHTML = '';
      const plot = new Plot(body, inst.id === 'altitude' ? 0.9 : inst.id === 'moon' ? 1.7 : 1.45);
      const view = await make(plot, this.ctx);
      if (seq !== this.seq) { plot.dispose(); return; }
      this.plot = plot;
      this.view = view;
      plot.onResize = () => view.draw();
      plot.fit();
      view.draw();
    } catch (e) {
      console.warn('instrument failed', e);
      if (seq === this.seq) body.innerHTML = '<div class="in-wait">It couldn\'t be drawn: its data didn\'t come.</div>';
    }
  }
  /** each frame while one's open: it redraws itself only if what it shows has moved */
  tick() { this.view?.tick?.(); }
  close(say = true) {
    if (!this.open) return;
    this.seq++;
    this.open = null;
    this.view?.close?.();
    this.plot?.dispose();
    this.view = null;
    this.plot = null;
    this.el.classList.remove('on');
    document.body.classList.remove('instrumenting');
    if (say) this.onClose();
  }
}
