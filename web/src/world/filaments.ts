// The filaments on the GPU: every polyline from layout.ts smoothed (Catmull–Rom) into short segments, one storage
// buffer of them, drawn as traced capsules (wide enough to see) and as soft hairlines (thinner than a pixel).
import type { Kit } from '@ericrius1/weft';
import { vec3, type Vec3 } from 'math';
import filamentShader from '../../shaders/filament.wgsl';
import type { Renderer } from '../engine/renderer';
import { type World, FilKind } from './layout';

/** segment length each kind is smoothed to (nm) */
const STEP: Record<FilKind, number> = { [FilKind.Microtubule]: 70, [FilKind.Actin]: 60, [FilKind.Intermediate]: 80, [FilKind.Chromatin]: 30, [FilKind.Collagen]: 250 };
const SEG_FLOATS = 12;

const _fil_p = vec3.create();

function catmull(out: Vec3, p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t, t3 = t2 * t;
  for (let k = 0; k < 3; k++) {
    out[k] = 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
  }
  return out;
}

export interface FilamentSet { data: Float32Array; count: number; /** first segment of each filament */ starts: number[] }

export function buildFilaments(world: World): FilamentSet {
  let n = 0;
  for (const f of world.filaments) {
    let L = 0;
    for (let i = 1; i < f.points.length; i++) L += vec3.distance(f.points[i - 1] as Vec3, f.points[i] as Vec3);
    n += Math.ceil(L / STEP[f.kind]) + f.points.length;
  }
  const data = new Float32Array(n * SEG_FLOATS);
  const u32 = new Uint32Array(data.buffer);
  const starts: number[] = [];
  let count = 0;
  world.filaments.forEach((f, fi) => {
    starts.push(count);
    const P = f.points as Vec3[];
    const prev = vec3.clone(P[0]);
    let s0 = 0;
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
      const steps = Math.max(1, Math.round(vec3.distance(p1, p2) / STEP[f.kind]));
      for (let k = 1; k <= steps; k++) {
        catmull(_fil_p, p0, p1, p2, p3, k / steps);
        const len = vec3.distance(prev, _fil_p);
        const o = count * SEG_FLOATS;
        data[o] = prev[0]; data[o + 1] = prev[1]; data[o + 2] = prev[2]; data[o + 3] = f.radius;
        data[o + 4] = _fil_p[0]; data[o + 5] = _fil_p[1]; data[o + 6] = _fil_p[2]; data[o + 7] = f.radius;
        u32[o + 8] = f.kind; u32[o + 9] = fi; data[o + 10] = s0; data[o + 11] = len;
        s0 += len;
        vec3.copy(prev, _fil_p);
        count++;
      }
    }
  });
  return { data: data.subarray(0, count * SEG_FLOATS), count, starts };
}

export class Filaments {
  set: FilamentSet;
  constructor(kit: Kit, r: Renderer, world: World) {
    this.set = buildFilaments(world);
    const segs = kit.storage({ label: 'filaments', data: this.set.data, stride: SEG_FLOATS * 4 });
    const count = this.set.count * 6;
    r.scene.draw(filamentShader, { label: 'filaments', vertex: 'vs_tube', fragment: 'fs_tube', bind: { segs }, count, cull: 'none' });
    const add: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
    const keep: GPUBlendState = { color: { srcFactor: 'zero', dstFactor: 'one-minus-src' }, alpha: { srcFactor: 'zero', dstFactor: 'one-minus-src' } };
    r.glass.draw(filamentShader, { label: 'filaments.thin', vertex: 'vs_thin', fragment: 'fs_thin', bind: { segs }, count, cull: 'none', blend: [add, keep], depthWrite: false });
    console.log(`filaments: ${world.filaments.length} (${(this.set.count / 1000).toFixed(0)}k segments)`);
  }
}
