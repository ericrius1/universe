// Points of light (shaders/c_points.wgsl): a buffer of { position, radius, colour, luminosity } drawn as quads into the
// cosmos pass while their level shows.
import type { Kit, StorageBuffer } from '@ericrius1/weft';
import pointShader from '../shaders/c_points.wgsl';
import type { CosmosRenderer, Level } from '../renderer';

export const PT_FLOATS = 8;

export class PointSet {
  readonly data: Float32Array;
  count = 0;
  constructor(readonly max: number) { this.data = new Float32Array(max * PT_FLOATS); }
  push(x: number, y: number, z: number, size: number, r: number, g: number, b: number, lum: number) {
    if (this.count >= this.max) return;
    this.data.set([x, y, z, size, r, g, b, lum], this.count++ * PT_FLOATS);
  }
}

/** draw a point set for a level: `extended` for galaxies (a glow over their disc), else stars */
export function drawPoints(kit: Kit, R: CosmosRenderer, lv: Level, set: PointSet, label: string, on = lv.on): StorageBuffer {
  const pts = kit.storage({ label: `${label}.pts`, data: set.data.subarray(0, Math.max(1, set.count) * PT_FLOATS), stride: PT_FLOATS * 4 });
  R.scene.draw(pointShader, { label, vertex: 'vs', fragment: 'fs', bind: { L: lv.L, pts }, count: 6, instances: set.count, blend: 'premultiplied', cull: 'none', enabled: on });
  return pts;
}

/** a seeded random source */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const gauss = () => { const u = Math.max(1e-9, next()), v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return { next, gauss };
}
