// Ice floes frozen onto the water (floes.wgsl), ported from the waterbending app: walk-on-water platforms the bending
// makes. The list and its moves are the app's (its bending and its player kept them): `addFloe` (merging into a close
// one), `grow` (held), `melt` (shrinking away over a second), `standingAt` (what's underfoot). Each floe keeps its own
// water's level. Drawn opaque into the scene (and wherever else it's registered: the water's under-pass) and into the
// two nearer shadow cascades; `onDisturb` gives the water its ripples as one forms or melts.
import type { Kit, RenderPass, StorageBuffer } from '@ericrius1/weft';
import shader from './floes.wgsl';

const MAX_FLOES = 64;
const SEG = 40;

/** a floe: its middle (x, z), radius (m) and the level of the water it's frozen onto */
export interface Floe { x: number; z: number; r: number; level: number }

export class Floes {
  /** the floes (the bending may change them as it likes: a floe's look is kept by the object) */
  list: Floe[] = [];
  /** ripples where one forms or melts: a disturbance at (x, z) over r (m), amount (m) */
  onDisturb?: (x: number, z: number, r: number, amount: number) => void;
  private buf: StorageBuffer;
  private data = new Float32Array(MAX_FLOES * 8);
  private n = 0;
  private seeds = new WeakMap<Floe, number>();
  /** floes melting away -> seconds left */
  private melting = new Map<Floe, number>();

  constructor(readonly kit: Kit) {
    this.buf = kit.storage({ label: 'floes', size: this.data.byteLength });
  }

  /** a floe at (x, z) on water at `level`, or a close one grown to this size: its index */
  addFloe(x: number, z: number, r: number, level: number) {
    const fl = this.list;
    // merge with a close floe instead of stacking
    for (let i = 0; i < fl.length; i++) if (Math.hypot(fl[i].x - x, fl[i].z - z) < fl[i].r * 0.5) { fl[i].r = Math.max(fl[i].r, r); return i; }
    fl.push({ x, z, r, level });
    if (fl.length > MAX_FLOES) fl.shift();
    this.onDisturb?.(x, z, r, 0.004);
    return fl.length - 1;
  }

  /** a floe held growing (the freeze kept on it) */
  grow(i: number, dt: number) {
    const f = this.list[i];
    if (f) f.r = Math.min(f.r + dt * 1.4, 4.2);
  }

  /** the floes near (x, z) melt away (shrinking over a second) */
  melt(x: number, z: number, reach = 1.5) {
    for (const f of this.list) if (Math.hypot(f.x - x, f.z - z) < f.r + reach && !this.melting.has(f)) this.melting.set(f, 1);
  }

  /** the top of a floe at (x, z), if there's one there over water (`ground` the ground's height there), else null */
  standingAt(x: number, z: number, ground: number): number | null {
    for (const f of this.list) if (Math.hypot(x - f.x, z - f.z) < f.r * 0.92 && f.level > ground) return f.level + 0.13;
    return null;
  }

  /** every frame: the melting, and the list for the GPU */
  update(dt: number) {
    for (const [f, left] of this.melting) {
      const k = left - dt;
      f.r *= Math.max(0, 1 - dt * 2.2);
      if (Math.random() < dt * 8) this.onDisturb?.(f.x + (Math.random() - 0.5) * f.r, f.z + (Math.random() - 0.5) * f.r, 0.5, 0.006);
      if (k <= 0 || f.r < 0.2) { this.melting.delete(f); this.list = this.list.filter((x) => x !== f); }
      else this.melting.set(f, k);
    }
    this.n = Math.min(this.list.length, MAX_FLOES);
    for (let i = 0; i < this.n; i++) {
      const f = this.list[i];
      let s = this.seeds.get(f);
      if (s === undefined) { s = Math.random() * 100; this.seeds.set(f, s); }
      this.data.set([f.x, f.z, f.r, s, f.level, 0, 0, 0], i * 8);
    }
    if (this.n) this.buf.write(this.data.subarray(0, this.n * 8));
  }

  /** opaque, into the scene (or the water's under-pass) */
  draw(pass: RenderPass) {
    pass.draw(shader, {
      label: `${pass.label}.floes`, vertex: 'vsFloe', fragment: 'fsFloe', count: SEG * 9, instances: () => this.n, cull: 'none',
      bind: { FL: this.buf }, enabled: () => this.n > 0,
    });
  }

  /** small things: the two nearer cascades only */
  drawShadow(pass: RenderPass, cascade: number) {
    if (cascade > 1) return;
    pass.draw(shader, {
      label: `${pass.label}.floes`, vertex: 'vsFloeShadow', fragment: null, count: SEG * 9, instances: () => this.n, cull: 'none',
      bind: { FL: this.buf }, enabled: () => this.n > 0,
    });
  }
}
