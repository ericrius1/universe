// A big part's mesh cut into regions of the ground, to be baked side by side (arch.ts: a bake worker each, their packs
// made one again: chunks.ts mergePacked) — the city's one bake was nearly five seconds of the load, on one core. Whole
// islands of connected triangles (each face as the builder made it) are kept together, so the refine judges each as it
// would have whole (bake.ts: a small face left whole, a thin band cut across, an edge split alike from both sides); the
// islands in order of their middles along the part's longer side, cut into runs of about as many triangles each. Run
// where the part is built (world/build.worker.ts), so the main thread copies nothing.
import type { ArchMesh, V3 } from './types';

/** `m` in at most `k` regions (fewer if it hasn't the triangles for them); the arrays are new, `m`'s left as they were */
export function splitMesh(m: ArchMesh, k: number): ArchMesh[] {
  const nV = m.pos.length / 3, nT = m.idx.length / 3, I = m.idx;
  k = Math.min(k, Math.floor(nT / 20000));
  if (k <= 1) return [m];
  // the islands: vertices joined by the triangles they share (a union-find, its paths halved)
  const up = new Int32Array(nV);
  for (let v = 0; v < nV; v++) up[v] = v;
  const root = (v: number) => { while (up[v] !== v) { up[v] = up[up[v]]; v = up[v]; } return v; };
  const join = (a: number, b: number) => { const ra = root(a), rb = root(b); if (ra !== rb) up[ra] = rb; };
  for (let t = 0; t < nT; t++) { join(I[t * 3], I[t * 3 + 1]); join(I[t * 3], I[t * 3 + 2]); }
  // each island's middle along the longer side (the mean of its triangles' middles) and its triangles
  const [lo, hi] = m.bounds, ax = hi[0] - lo[0] >= hi[2] - lo[2] ? 0 : 2;
  const sum = new Float64Array(nV), tris = new Int32Array(nV);
  for (let t = 0; t < nT; t++) {
    const a = I[t * 3], r = root(a);
    sum[r] += (m.pos[a * 3 + ax] + m.pos[I[t * 3 + 1] * 3 + ax] + m.pos[I[t * 3 + 2] * 3 + ax]) / 3;
    tris[r]++;
  }
  // the islands by their middles (each one's middle, in cm from the part's edge, and its root in one number: a typed
  // array's own sort), then the regions: runs of them, about nT / k triangles each
  let n = 0;
  for (let v = 0; v < nV; v++) if (up[v] === v && tris[v] > 0) n++;
  const keys = new Float64Array(n);
  n = 0;
  for (let v = 0; v < nV; v++) if (up[v] === v && tris[v] > 0) keys[n++] = Math.round((sum[v] / tris[v] - lo[ax]) * 100) * 33554432 + v;
  keys.sort();
  const regionOf = new Int8Array(nV);
  let acc = 0;
  for (let i = 0; i < n; i++) { const r = keys[i] % 33554432; regionOf[r] = Math.min(k - 1, Math.floor((acc / nT) * k)); acc += tris[r]; }
  // each vertex's region and its index there; each region's counts
  const region = new Int8Array(nV).fill(-1), local = new Int32Array(nV), nv = new Int32Array(k), nt = new Int32Array(k);
  for (let t = 0; t < nT; t++) {
    const g = regionOf[root(I[t * 3])];
    nt[g]++;
    for (let j = 0; j < 3; j++) { const v = I[t * 3 + j]; if (region[v] < 0) { region[v] = g; local[v] = nv[g]++; } }
  }
  // the regions' arrays: every per-vertex array by its own stride (one loop, each array copied by a line of its own)
  const sP = m.pos.length / nV, sN = m.nrm.length / nV, sU = m.uv.length / nV, sM = m.mat.length / nV, sT = m.tint.length / nV, sA = m.ao.length / nV, sG = m.glow.length / nV;
  const pos = Array.from({ length: k }, (_, g) => new Float32Array(nv[g] * sP)), nrm = Array.from({ length: k }, (_, g) => new Float32Array(nv[g] * sN));
  const uv = Array.from({ length: k }, (_, g) => new Float32Array(nv[g] * sU)), mat = Array.from({ length: k }, (_, g) => new Uint8Array(nv[g] * sM));
  const tint = Array.from({ length: k }, (_, g) => new Uint8Array(nv[g] * sT)), ao = Array.from({ length: k }, (_, g) => new Uint8Array(nv[g] * sA));
  const glow = Array.from({ length: k }, (_, g) => new Uint8Array(nv[g] * sG));
  for (let v = 0; v < nV; v++) {
    const g = region[v];
    if (g < 0) continue;
    const l = local[v];
    for (let j = 0; j < sP; j++) pos[g][l * sP + j] = m.pos[v * sP + j];
    for (let j = 0; j < sN; j++) nrm[g][l * sN + j] = m.nrm[v * sN + j];
    for (let j = 0; j < sU; j++) uv[g][l * sU + j] = m.uv[v * sU + j];
    for (let j = 0; j < sM; j++) mat[g][l * sM + j] = m.mat[v * sM + j];
    for (let j = 0; j < sT; j++) tint[g][l * sT + j] = m.tint[v * sT + j];
    for (let j = 0; j < sA; j++) ao[g][l * sA + j] = m.ao[v * sA + j];
    for (let j = 0; j < sG; j++) glow[g][l * sG + j] = m.glow[v * sG + j];
  }
  const idx = Array.from({ length: k }, (_, g) => new Uint32Array(nt[g] * 3)), at = new Int32Array(k);
  for (let t = 0; t < nT; t++) {
    const g = region[I[t * 3]], o = at[g];
    idx[g][o] = local[I[t * 3]]; idx[g][o + 1] = local[I[t * 3 + 1]]; idx[g][o + 2] = local[I[t * 3 + 2]];
    at[g] = o + 3;
  }
  const out: ArchMesh[] = [];
  for (let g = 0; g < k; g++) {
    if (!nt[g]) continue;
    const p = pos[g], b: [V3, V3] = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
    for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { b[0][a] = Math.min(b[0][a], p[i + a]); b[1][a] = Math.max(b[1][a], p[i + a]); }
    out.push({ pos: p, nrm: nrm[g], uv: uv[g], mat: mat[g], tint: tint[g], ao: ao[g], glow: glow[g], idx: idx[g], bounds: b });
  }
  return out;
}
