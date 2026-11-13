// The crowd's density round the focus (shaders/volume.wgsl): a grid of N³ cells, 4 S across (S the camera's distance
// to the focus), the molecules the field made this frame splatted into it, smoothed, with a short mip chain. Shading
// reads it through the shared world group (world.wgsl crowdLight) for occlusion and a soft shadow toward the key light.
// The grid stays put in the world while the view does — its corner on a lattice of its own cells, its cell size
// stepped by quarter-octaves — so a still view's light is still under the upscaler's jitter and history.
import type { Kit, RunEntry, StorageBuffer, Texture, UniformBuffer } from '@ericrius1/weft';
import volShader from '../../shaders/volume.wgsl';
import { origin } from './origin';

const MIPS = 4;

export class CrowdVolume {
  readonly tex: Texture;
  /** where it is, for the shading (world.wgsl Vol): set each frame */
  readonly V: UniformBuffer<any>;
  private VS: UniformBuffer<any>;
  private acc: StorageBuffer;
  private items: RunEntry[] = [];
  private on = false;

  constructor(private kit: Kit, readonly n: number, V: UniformBuffer<any>) {
    const k = kit;
    this.V = V;
    this.tex = k.texture({ label: 'crowd.volume', format: 'rgba16float', size: [n, n, n], dimension: '3d', mips: MIPS, usage: ['sample', 'storage'] });
    this.VS = k.uniforms(volShader.structs.VolSplat, 'crowd.splat');
    this.acc = k.storage({ label: 'crowd.acc', size: n * n * n * 4 });
  }

  /** the field's instances (field.ts) to splat each frame */
  attach(o: { types: StorageBuffer; insts: StorageBuffer; counts: StorageBuffer; maxInst: number }) {
    const k = this.kit, n = this.n;
    const on = () => this.on;
    const clear = k.raw((enc) => { if (this.on) enc.clearBuffer(this.acc.gpu); }, 'crowd.clear');
    const splat = k.compute(volShader, { label: 'crowd.splat', entry: 'splat', bind: { types: o.types, insts: o.insts, counts: o.counts, acc: this.acc, VS: this.VS }, threads: [o.maxInst], enabled: on });
    const resolve = k.compute(volShader, { label: 'crowd.resolve', entry: 'resolve', bind: { accRead: this.acc, VS: this.VS, accIn: this.tex.mip(0) }, threads: [n, n, n], enabled: on });
    const downs = [];
    for (let m = 1; m < MIPS; m++) {
      const s = n >> m;
      downs.push(k.compute(volShader, { label: `crowd.mip${m}`, entry: 'down', bind: { srcMip: this.tex.mip(m - 1), accIn: this.tex.mip(m) }, threads: [s, s, s], enabled: on }));
    }
    this.items = [clear, splat, resolve, ...downs];
    this.VS.set({ maxInst: o.maxInst, n });
  }

  /** place the grid round the focus (relative to the origin) at the camera's distance `scale`; `strength` 0 leaves it
   *  out (the crowd's resting, or none made) */
  update(focus: ArrayLike<number>, scale: number, strength: number) {
    this.on = this.items.length > 0 && strength > 0;
    if (!this.on) { this.V.set({ on: 0 }); return; }
    const n = this.n;
    // (a cell's size by quarter-octaves of the zoom, the corner on a lattice of cells in absolute space)
    const voxel = Math.pow(2, Math.round(Math.log2((4 * scale) / n) * 4) / 4);
    const corner = [0, 1, 2].map((i) => Math.floor((focus[i] + origin[i]) / voxel - n / 2) * voxel - origin[i]);
    this.VS.set({ corner, voxel });
    this.V.set({ corner, voxel, n, on: strength });
  }

  work(): RunEntry[] { return this.items; }
}
