// The rocks as the GPU reads them (rockdata.wgsl): every prototype's levels of detail in one vertex array (20 bytes a
// vertex: position f32 x3; normal snorm8 x3 and ambient unorm8; bed id u16, fraction u8, flags u8 — a crystal's id is
// its index in the crystal records) and one index array (each level's indices local, its base vertex beside them), the
// crystal records (foot and radius, axis and length), and the placed rocks as instances (a 3x4 transform; seed, glow,
// ground) with their bounding spheres for culling. Pure arrays, so a worker or a tool can build them.
import type { Catalog } from './catalog';
import { matrixOf, type Rock } from './place';

export interface Range { first: number; count: number; base: number }

export interface Packed {
  verts: ArrayBuffer;
  idx: Uint32Array;
  /** per prototype, per level: its index range and base vertex */
  ranges: Range[][];
  isCrystal: boolean[];
  /** crystal records: per crystal two vec4s (foot xyz and radius; axis xyz and length), in prototype metres */
  recs: Float32Array;
  /** per rock 16 floats: the transform's three rows, then seed, glow, ground, 0 */
  insts: Float32Array;
  /** per rock its bounding sphere: centre xyz, radius */
  sphere: Float32Array;
  protoOf: Uint16Array;
}

const VERTEX_BYTES = 20;

export function packRocks(cat: Catalog, rocks: Rock[]): Packed {
  const P = cat.protos;
  const isCrystal = P.map((p) => p.kind === 'crystal');
  // the crystals' records, each cluster's after the last
  const crystalBase: number[] = [];
  const recs: number[] = [];
  for (const p of P) {
    crystalBase.push(recs.length / 8);
    for (const c of p.crystals ?? []) recs.push(c.base[0], c.base[1], c.base[2], c.r, c.axis[0], c.axis[1], c.axis[2], c.len);
  }
  // every level of every prototype into one vertex array and one index array
  let nv = 0, ni = 0;
  for (const p of P) for (const m of p.lods) { nv += m.pos.length / 3; ni += m.idx.length; }
  const verts = new ArrayBuffer(nv * VERTEX_BYTES), vf = new Float32Array(verts), vu = new Uint32Array(verts);
  const idx = new Uint32Array(ni);
  const sn = (x: number) => Math.round(Math.max(-1, Math.min(1, x)) * 127) & 0xff;
  let v0 = 0, i0 = 0;
  const ranges = P.map((p, pi) => p.lods.map((m) => {
    const n = m.pos.length / 3;
    for (let i = 0; i < n; i++) {
      const o = (v0 + i) * 5;
      vf[o] = m.pos[i * 3]; vf[o + 1] = m.pos[i * 3 + 1]; vf[o + 2] = m.pos[i * 3 + 2];
      vu[o + 3] = (sn(m.nrm[i * 3]) | (sn(m.nrm[i * 3 + 1]) << 8) | (sn(m.nrm[i * 3 + 2]) << 16) | (Math.round(Math.max(0, Math.min(1, m.ao[i])) * 255) << 24)) >>> 0;
      const bed = m.bed[i], id = Math.floor(bed) + (isCrystal[pi] ? crystalBase[pi] : 0);
      vu[o + 4] = ((id & 0xffff) | (Math.round((bed - Math.floor(bed)) * 255) << 16) | (m.flags[i] << 24)) >>> 0;
    }
    idx.set(m.idx, i0);
    const r: Range = { first: i0, count: m.idx.length, base: v0 };
    v0 += n; i0 += m.idx.length;
    return r;
  }));
  // the instances: their transforms, seeds, glow and ground; their bounding spheres
  const N = rocks.length;
  const insts = new Float32Array(Math.max(1, N) * 16);
  const sphere = new Float32Array(N * 4);
  const protoOf = new Uint16Array(N);
  rocks.forEach((k, i) => {
    insts.set(matrixOf(k), i * 16);
    insts[i * 16 + 12] = k.seed; insts[i * 16 + 13] = k.glow; insts[i * 16 + 14] = k.ground;
    const p = P[k.proto];
    sphere[i * 4] = k.x; sphere[i * 4 + 1] = k.y + p.height * k.scale * 0.5; sphere[i * 4 + 2] = k.z;
    sphere[i * 4 + 3] = Math.hypot(p.radius, p.height * 0.5) * k.scale;
    protoOf[i] = k.proto;
  });
  return { verts, idx, ranges, isCrystal, recs: new Float32Array(recs.length ? recs : [0, 0, 0, 0, 0, 1, 0, 0]), insts, sphere, protoOf };
}
