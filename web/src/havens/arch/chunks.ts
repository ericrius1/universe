// A baked mesh cut into the pieces the renderer culls, and packed for the GPU. Each triangle goes to the CELL-metre
// square its middle stands in; a square with more vertices than a 16-bit index reaches is cut into several pieces.
// Each piece's vertices sit on a STEP-metre lattice counted from its own corner — three u16s, with its material and its
// glow in the fourth (8 bytes: all the shadow passes read); a position two pieces share lands on the very same world
// point in both (the lattice is the world's), so no crack opens between them. The rest (20 bytes): the normal
// (octahedral, two snorm16s), the uv (two halves: each island of connected faces moved back by whole PERIODs so the
// numbers stay small and keep their precision — or, on the lavender panels and the teal friezes, refitted so whole
// panels fill each face, on windows 0..1 over each pane, on the tiles whole tiles or motifs across each face, on a
// lattice door its columns from the middle), the tint and the ambient (bytes), the night's light
// (RGBM bytes) and the fires' (the nearest fire's index, a half for the strength, its sign bit set on the fire's own
// body). Each piece's triangles of OCCLUDER_AREA or more come first in its indices: the GPU cull's occluders draw
// only those (cull.ts: the walls, floors and roofs that hide what's behind them — a quarter of the city's triangles,
// nine tenths of its surface — and not the window frames, tiles and trim, nor the light's refinement round the lamps).
import type { ArchMesh } from './types';
import { MAT } from './types';
import { MATERIALS, MAP, PERIOD, FRIEZE_ASPECT, LATTICE_PITCH, LATTICE_BOSS } from './materials';
import type { VertexLight } from './bake';

/** the cull's square (m) */
export const CELL = 64;
/** the position lattice (m): 1/512, about 2 mm */
export const STEP = 1 / 512;
/** the night's light's RGBM range (candela over m², as bake.ts sums it) */
export const RGBM_RANGE = 4096;
/** a vertex's bytes: the position stream's, the rest's */
export const POS_BYTES = 8;
export const ATTR_BYTES = 20;
/** a triangle big enough to be an occluder (m²) */
export const OCCLUDER_AREA = 0.5;

export interface Packed {
  /** 4 u16 per vertex: the lattice position, material | glow << 8 */
  pos: Uint16Array;
  /** 5 words per vertex: normal, uv, tint and ambient, the night's light, the fire's */
  attr: Uint32Array;
  /** each piece's triangles, by its own vertices (u16; padded to whole words) */
  idx: Uint16Array;
  /** 4 per piece: its lattice's origin (world m) and step */
  chunks: Float32Array;
  /** 6 per piece: its bounding box (min x, y, z, max x, y, z) */
  boxes: Float32Array;
  /** 3 per piece: its first index, its index count, its first vertex */
  draws: Uint32Array;
  /** per piece: the index count of its occluders (its first triangles: OCCLUDER_AREA or more) */
  solid: Uint32Array;
  /** 1 per piece: the square it holds (its key: (cx + 4096) * 8192 + cz + 4096) */
  cells: Int32Array;
  vertices: number;
  triangles: number;
}

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
/** a float as a half's bits */
function half(v: number) {
  f32[0] = v;
  const x = u32[0], s = (x >>> 16) & 0x8000, m = x & 0x7fffff;
  const e = ((x >>> 23) & 0xff) - 112;
  if (e <= 0) {
    if (e < -10) return s;
    return s | (((m | 0x800000) >> (1 - e)) + 0x1000) >> 13;
  }
  if (e >= 31) return s | 0x7c00;
  return s | ((e << 10) + ((m + 0x1000) >> 13));
}

/** a colour's RGBM bytes in one word (r, g, b, then the multiplier's square root) */
function rgbm(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b);
  if (!(mx > 1e-6)) return 0;
  const a = Math.ceil(Math.min(1, Math.sqrt(mx / RGBM_RANGE)) * 255) / 255;
  const M = a * a * RGBM_RANGE;
  const q = (x: number) => Math.min(255, Math.round((x / M) * 255));
  return (q(r) | (q(g) << 8) | (q(b) << 16) | (Math.round(a * 255) << 24)) >>> 0;
}

/** a unit normal as two snorm16s in one word (octahedral) */
function oct(x: number, y: number, z: number) {
  const l = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let u = x / l, v = y / l;
  if (z < 0) { const t = (1 - Math.abs(v)) * (u >= 0 ? 1 : -1); v = (1 - Math.abs(u)) * (v >= 0 ? 1 : -1); u = t; }
  return ((Math.round(u * 32767) & 0xffff) | ((Math.round(v * 32767) & 0xffff) << 16)) >>> 0;
}

/** the uv each vertex is drawn with: its island's moved back by whole periods, or fitted to the face (panels,
 *  friezes, window panes, the tiles, a lattice door, cut blocks) */
function islandUv(m: ArchMesh): Float32Array {
  const n = m.mat.length, idx = m.idx;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(idx[t]), b = find(idx[t + 1]), c = find(idx[t + 2]);
    parent[b] = a; parent[find(c)] = a;
  }
  const lo = new Float32Array(n * 2).fill(Infinity), hi = new Float32Array(n * 2).fill(-Infinity);
  // (and whether each island is flat: a pane's glazing is drawn on flat ones only, not on a brazier's coals)
  const U = m.uv, N = m.nrm, curved = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = find(i);
    lo[r * 2] = Math.min(lo[r * 2], U[i * 2]); lo[r * 2 + 1] = Math.min(lo[r * 2 + 1], U[i * 2 + 1]);
    hi[r * 2] = Math.max(hi[r * 2], U[i * 2]); hi[r * 2 + 1] = Math.max(hi[r * 2 + 1], U[i * 2 + 1]);
    if (N[i * 3] * N[r * 3] + N[i * 3 + 1] * N[r * 3 + 1] + N[i * 3 + 2] * N[r * 3 + 2] < 0.98) curved[r] = 1;
  }
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const r = find(i), mat = MATERIALS[m.mat[i]] ?? MATERIALS[MAT.PLASTER];
    const u0 = lo[r * 2], v0 = lo[r * 2 + 1], W = hi[r * 2] - u0, H = hi[r * 2 + 1] - v0;
    const u = U[i * 2], v = U[i * 2 + 1];
    if (mat.map === MAP.PANE) {
      // the pane 0..1 across and up (a curved island: -1, no glazing drawn)
      out[i * 2] = curved[r] ? -1 : W > 1e-6 ? (u - u0) / W : 0;
      out[i * 2 + 1] = curved[r] ? -1 : H > 1e-6 ? (v - v0) / H : 0;
    } else if (mat.map === MAP.PANEL || mat.map === MAP.FRIEZE) {
      // whole panels across the face (or bands up it, each as long as its picture is for its height)
      const nV = Math.max(1, Math.round(H / mat.size));
      const across = mat.map === MAP.PANEL ? mat.size : (H / nV) * FRIEZE_ASPECT;
      const nU = Math.max(1, Math.round(W / across));
      out[i * 2] = W > 1e-6 ? ((u - u0) / W) * nU : 0;
      out[i * 2 + 1] = H > 1e-6 ? ((v - v0) / H) * nV : 0;
    } else if (mat.map === MAP.TILE) {
      // whole tiles across the face and up it (a star on each corner)
      const nU = Math.max(1, Math.round(W / mat.size)), nV = Math.max(1, Math.round(H / mat.size));
      out[i * 2] = W > 1e-6 ? ((u - u0) / W) * nU : 0;
      out[i * 2 + 1] = H > 1e-6 ? ((v - v0) / H) * nV : 0;
    } else if (mat.map === MAP.BAND || mat.map === MAP.BORDER) {
      // a band (or a whole number of them) along the face's longer side, whole square motifs along it: x along, y across
      const up = H > W * 1.25, along = up ? H : W, across = up ? W : H;
      const nA = Math.max(1, Math.round(across / mat.size)), nL = Math.max(1, Math.round(along / (across / nA)));
      const a = up ? v - v0 : u - u0, c = up ? u - u0 : v - v0;
      out[i * 2] = along > 1e-6 ? (a / along) * nL : 0;
      out[i * 2 + 1] = across > 1e-6 ? (c / across) * nA : 0;
    } else if (mat.map === MAP.LATTICE) {
      // columns from the door's middle (the leaves' meeting), a whole number to each edge so a bar ends it; y from the
      // boss (a whole number of columns over the sill: at a hand's height, or on a great door below its middle), in
      // columns
      const half = W / 2, pitch = half / Math.max(1, Math.round(half / Math.max(LATTICE_PITCH, W / 11)));
      const boss = Math.max(1, Math.round((H > 3.6 ? H * 0.42 : Math.min(LATTICE_BOSS, H * 0.45)) / pitch));
      out[i * 2] = (u - u0 - half) / pitch;
      out[i * 2 + 1] = (v - v0) / pitch - boss;
    } else if (mat.map === MAP.BLOCKS) {
      // cut stone (a coping, a cornice, a jamb, a column's drums): whole blocks along the face's longer side (`blocks`
      // m long along a band, courses half that up a tall face), x in blocks counted from a whole number of its own (so
      // no two faces' blocks take the same tones), y 0..1 across it
      const up = H > W * 1.25, along = up ? H : W, across = up ? W : H;
      const n = Math.max(1, Math.round(along / (up ? mat.blocks / 2 : mat.blocks))), o = (Math.imul(r, 0x9e3779b1) >>> 29);
      const a = up ? v - v0 : u - u0, c = up ? u - u0 : v - v0;
      out[i * 2] = o + (along > 1e-6 ? (a / along) * n : 0);
      out[i * 2 + 1] = across > 1e-6 ? c / across : 0;
    } else {
      out[i * 2] = u - Math.floor(u0 / PERIOD) * PERIOD;
      out[i * 2 + 1] = v - Math.floor(v0 / PERIOD) * PERIOD;
    }
  }
  return out;
}

/** cut and pack a baked mesh (see the header) */
export function pack(m: ArchMesh, light: VertexLight, cell = CELL): Packed {
  const n = m.mat.length, nt = m.idx.length / 3, idx = m.idx, P = m.pos;
  const uv = islandUv(m);
  // the triangles in order of the square their middle stands in
  const order = new Float64Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    const cx = Math.floor((P[a * 3] + P[b * 3] + P[c * 3]) / 3 / cell), cz = Math.floor((P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3 / cell);
    order[t] = ((cx + 4096) * 8192 + (cz + 4096)) * 16777216 + t;
  }
  order.sort();
  // the triangles big enough to occlude
  const big = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    big[t] = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) * 0.5 >= OCCLUDER_AREA ? 1 : 0;
  }
  // the output, grown as the pieces come (a vertex shared between pieces is written once in each)
  let cap = Math.ceil(n * 1.1) + 1024;
  let pos = new Uint16Array(cap * 4), attr = new Uint32Array(cap * 5);
  const ib = new Uint16Array(idx.length + 2);
  const chunks: number[] = [], boxes: number[] = [], draws: number[] = [], solid: number[] = [], cells: number[] = [];
  const local = new Int32Array(n).fill(-1);
  const used: number[] = [], tris: number[] = [];
  let nv = 0, ni = 0;

  const close = () => {
    if (!used.length) return;
    // the piece's box, its lattice (2 mm, or coarser if it's too big for 16 bits), its vertices on it
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const v of used) {
      x0 = Math.min(x0, P[v * 3]); y0 = Math.min(y0, P[v * 3 + 1]); z0 = Math.min(z0, P[v * 3 + 2]);
      x1 = Math.max(x1, P[v * 3]); y1 = Math.max(y1, P[v * 3 + 1]); z1 = Math.max(z1, P[v * 3 + 2]);
    }
    let step = STEP;
    while (Math.max(x1 - x0, y1 - y0, z1 - z0) / step > 65000) step *= 2;
    const qx = Math.floor(x0 / step), qy = Math.floor(y0 / step), qz = Math.floor(z0 / step);
    if (nv + used.length > cap) {
      cap = Math.max(cap * 2, nv + used.length);
      const p2 = new Uint16Array(cap * 4); p2.set(pos); pos = p2;
      const a2 = new Uint32Array(cap * 5); a2.set(attr); attr = a2;
    }
    const base = nv;
    const L = light.night, F = light.fire, FO = light.fireOf, FB = light.fireBody, N = m.nrm, T = m.tint;
    for (const v of used) {
      const q = (x: number, o: number) => Math.max(0, Math.min(65535, Math.round(x / step) - o));
      pos[nv * 4] = q(P[v * 3], qx); pos[nv * 4 + 1] = q(P[v * 3 + 1], qy); pos[nv * 4 + 2] = q(P[v * 3 + 2], qz);
      pos[nv * 4 + 3] = (m.mat[v] & 0xff) | (m.glow[v] << 8);
      const w = nv * 5;
      attr[w] = oct(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
      attr[w + 1] = (half(uv[v * 2]) | (half(uv[v * 2 + 1]) << 16)) >>> 0;
      attr[w + 2] = (T[v * 3] | (T[v * 3 + 1] << 8) | (T[v * 3 + 2] << 16) | (m.ao[v] << 24)) >>> 0;
      attr[w + 3] = rgbm(L[v * 3], L[v * 3 + 1], L[v * 3 + 2]);
      attr[w + 4] = ((FO[v] < 0 ? 0xffff : FO[v] & 0xffff) | ((half(Math.min(F[v], 65000)) | (FB[v] ? 0x8000 : 0)) << 16)) >>> 0;
      nv++;
    }
    // its triangles, the occluders first (each part in the order they came)
    const first = ni;
    for (const want of [1, 0]) {
      for (const t of tris) if (big[t] === want) for (let j = 0; j < 3; j++) ib[ni++] = local[idx[t * 3 + j]];
      if (want) solid.push(ni - first);
    }
    chunks.push(qx * step, qy * step, qz * step, step);
    boxes.push(x0, y0, z0, x1, y1, z1);
    draws.push(first, ni - first, base);
    cells.push(lastCell);
    for (const v of used) local[v] = -1;
    used.length = 0;
    tris.length = 0;
  };

  let lastCell = -1;
  for (let k = 0; k < nt; k++) {
    const key = Math.floor(order[k] / 16777216), t = order[k] - key * 16777216;
    // (a new square, or this one's vertices about to overflow 16 bits: a new piece)
    if (key !== lastCell || used.length > 65532) { close(); lastCell = key; }
    tris.push(t);
    for (let j = 0; j < 3; j++) {
      const v = idx[t * 3 + j];
      if (local[v] < 0) { local[v] = used.length; used.push(v); }
    }
  }
  close();
  return {
    pos: pos.slice(0, nv * 4), attr: attr.slice(0, nv * 5), idx: ni % 2 ? ib.slice(0, ni + 1) : ib.slice(0, ni),
    chunks: new Float32Array(chunks), boxes: new Float32Array(boxes), draws: new Uint32Array(draws), solid: new Uint32Array(solid), cells: new Int32Array(cells), vertices: nv, triangles: nt,
  };
}

/** the packs of one part's regions (split.ts, baked side by side) made one, as its own pack would have made it: each
 *  square's pieces merged back into one, their vertices rebased onto the lowest corner of their lattices (whole steps
 *  of the world's lattice, so not a vertex moves) and their indices onto the merged vertices — so the regions draw no
 *  more pieces than the part whole did. A square's pieces on different lattices, or that together would outgrow 16
 *  bits, stay apart */
export function mergePacked(packs: Packed[]): Packed {
  if (packs.length === 1) return packs[0];
  // every piece, by its square (then its lattice; regions and places in order within that)
  type Piece = { p: Packed; i: number; cell: number; step: number };
  const all: Piece[] = [];
  for (const p of packs) for (let i = 0; i < p.cells.length; i++) all.push({ p, i, cell: p.cells[i], step: p.chunks[i * 4 + 3] });
  all.sort((a, b) => a.cell - b.cell || a.step - b.step);
  const lo = ({ p, i, step }: Piece) => [0, 1, 2].map((a) => Math.round(p.chunks[i * 4 + a] / step));
  const hi = ({ p, i, step }: Piece) => [0, 1, 2].map((a) => Math.floor(p.boxes[i * 6 + 3 + a] / step) + 1);
  // the merged pieces: runs of one square on one lattice, cut where they'd outgrow 16 bits (vertices or lattice)
  const groups: Piece[][] = [];
  let run: Piece[] = [], nvRun = 0, q0 = [0, 0, 0], q1 = [0, 0, 0];
  for (const e of all) {
    const nv = pieceVerts(e.p, e.i), l = lo(e), h = hi(e);
    const fits = run.length > 0 && run[0].cell === e.cell && run[0].step === e.step && nvRun + nv <= 65532
      && [0, 1, 2].every((a) => Math.max(q1[a], h[a]) - Math.min(q0[a], l[a]) <= 65535);
    if (!fits) { if (run.length) groups.push(run); run = []; nvRun = 0; q0 = l; q1 = h; }
    run.push(e); nvRun += nv;
    q0 = q0.map((v, a) => Math.min(v, l[a])); q1 = q1.map((v, a) => Math.max(v, h[a]));
  }
  if (run.length) groups.push(run);
  let V = 0, Ni = 0;
  for (const p of packs) { V += p.vertices; for (let k = 1; k < p.draws.length; k += 3) Ni += p.draws[k]; }
  const pos = new Uint16Array(V * 4), attr = new Uint32Array(V * 5), idx = new Uint16Array(Ni + (Ni % 2));
  const chunks = new Float32Array(groups.length * 4), boxes = new Float32Array(groups.length * 6), draws = new Uint32Array(groups.length * 3), cells = new Int32Array(groups.length);
  const solid = new Uint32Array(groups.length);
  let nv = 0, ni = 0;
  groups.forEach((g, gi) => {
    const step = g[0].step, base = nv, first = ni;
    const q = [0, 1, 2].map((a) => Math.min(...g.map((e) => lo(e)[a])));
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const at: number[] = [];
    for (const e of g) {
      const { p, i } = e, n = pieceVerts(p, i), v0 = p.draws[i * 3 + 2];
      const l = lo(e), d0 = l[0] - q[0], d1 = l[1] - q[1], d2 = l[2] - q[2];
      at.push(nv - base);
      for (let v = 0; v < n; v++) {
        const s = (v0 + v) * 4, o = (nv + v) * 4;
        pos[o] = p.pos[s] + d0; pos[o + 1] = p.pos[s + 1] + d1; pos[o + 2] = p.pos[s + 2] + d2; pos[o + 3] = p.pos[s + 3];
      }
      attr.set(p.attr.subarray(v0 * 5, (v0 + n) * 5), nv * 5);
      nv += n;
      for (let a = 0; a < 3; a++) { box[a] = Math.min(box[a], p.boxes[i * 6 + a]); box[a + 3] = Math.max(box[a + 3], p.boxes[i * 6 + 3 + a]); }
    }
    // (the merged piece's triangles as each of its own were: every one's occluders first, the GPU's cull draws those
    // alone for the occlusion's depth, then the rest)
    for (const occ of [true, false]) {
      g.forEach((e, k) => {
        const { p, i } = e, i0 = p.draws[i * 3], ic = p.draws[i * 3 + 1], so = p.solid[i];
        for (let t = occ ? 0 : so; t < (occ ? so : ic); t++) idx[ni++] = p.idx[i0 + t] + at[k];
      });
      if (occ) solid[gi] = ni - first;
    }
    chunks.set([q[0] * step, q[1] * step, q[2] * step, step], gi * 4);
    boxes.set(box, gi * 6);
    draws.set([first, ni - first, base], gi * 3);
    cells[gi] = g[0].cell;
  });
  return { pos, attr, idx, chunks, boxes, draws, solid, cells, vertices: nv, triangles: packs.reduce((n, p) => n + p.triangles, 0) };
}

/** how many vertices piece i of a pack has (up to the next piece's first, or the pack's end) */
function pieceVerts(p: Packed, i: number) {
  return (i + 1 < p.cells.length ? p.draws[(i + 1) * 3 + 2] : p.vertices) - p.draws[i * 3 + 2];
}
