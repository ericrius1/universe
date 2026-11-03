// The night's light, baked into the vertices: every lantern, window and brazier a part carries (types.ts LightSpot)
// lights the surfaces within its reach — its candela over the square of the distance, eased to nothing at the reach,
// times the surface's facing (a light behind a surface's plane gives it nothing: the cheap test for the far side of a
// wall) — each vertex asking only the lights listed in its cell of a grid over them; and a light behind one of the
// part's walls (its colliders' solids) lights nothing past it: each vertex's way to each light is tested against the
// solids near that light — those wide enough, seen from it, for the mesh round it to show their shadow (a post, a
// pole, a column throws only a thin wedge of shade: sampled at vertices metres apart it came out as a few big dark
// triangles fanned at random round the lamp, so it throws none). A builder's faces are big (a wall is one quad, a
// street one polygon) and light pools are small, so first the mesh is refined where light falls on it: an edge is
// split while it is longer than a light in front of it lets it be — a fraction of its distance to the light, the
// smaller the brighter the light is there (linear interpolation's error grows with the light and the square of the
// edge over the distance), asked at the edge's point nearest each light — decided per edge so both triangles sharing
// one split it alike (no cracks), a few rounds, nothing done where no light reaches. A face too small to show a pool
// is left whole; a thin band (a cornice, a plinth) is cut across instead, as finely as the lights along it ask. The
// night's lights ('night', 'always') sum to one colour per vertex; the braziers ('fire': lit by firebending) to a
// strength of their own with the nearest of them, which the renderer lights and flickers by its index. Run off the
// main thread (bake.worker.ts).
import type { ArchMesh, LightSpot, StructureCollider } from './types';
import { CellGrid } from '../util/cellgrid';

export interface BakeOptions {
  /** a light's reach when it gives none (m) */
  reach: number;
  /** an edge in a light's reach is split while it's longer than its distance to that light times sqrt(tau / E) (E the
   *  light's irradiance there, candela over m²: tau the error let stand), that fraction kept within [lo, hi]; never
   *  below `minEdge` (m); at most `rounds` rounds */
  tau: number;
  lo: number;
  hi: number;
  minEdge: number;
  rounds: number;
  /** a face (an island of connected triangles) smaller than this across is left whole (m): a sill or a jamb shows no
   *  pool of light of its own; a four-cornered one narrower than `thin` (its area over its length: a cornice, a plinth,
   *  a coping) is cut across into segments along it */
  small: number;
  thin: number;
  /** the nearest a light counts as to a surface (m): no burning spot where a lantern touches its wall */
  near: number;
  /** a solid narrower than this seen from a light (the angle its plan spans there, radians) shades nothing from it: its
   *  wedge of shade is narrower than the mesh's triangles out there (an edge is a third to more than its distance to
   *  the light), so a few vertices that happened to fall in it darkened whole triangles */
  narrow: number;
}
export const BAKE: BakeOptions = { reach: 30, tau: 0.6, lo: 0.3, hi: 1.2, minEdge: 0.6, rounds: 8, small: 1.5, thin: 0.5, near: 0.3, narrow: 0.5 };

/** the light grid's cell (m) */
const LCELL = 8;
/** vertex ids fit under this (edge keys: lo * KEY + hi) */
const KEY = 67108864;

/** a part's lights, gridded by where they reach: the night's and the always-lit, and the fires (each with its index
 *  among the fires) */
export class LightGrid {
  readonly n: number;
  readonly p: Float32Array;
  readonly r2: Float32Array;
  readonly rgb: Float32Array;
  readonly cd: Float32Array;
  /** the fire's index among the part's fires, or -1 for a night light */
  readonly fire: Int32Array;
  readonly grid: CellGrid;

  constructor(lights: LightSpot[], o: BakeOptions = BAKE) {
    const n = this.n = lights.length;
    this.p = new Float32Array(n * 3);
    this.r2 = new Float32Array(n);
    this.rgb = new Float32Array(n * 3);
    this.cd = new Float32Array(n);
    this.fire = new Int32Array(n);
    let fires = 0;
    lights.forEach((l, i) => {
      this.p.set(l.p, i * 3);
      const r = l.radius ?? o.reach;
      this.r2[i] = r * r;
      this.rgb.set(l.color, i * 3);
      this.cd[i] = l.candela;
      this.fire[i] = l.when === 'fire' ? fires++ : -1;
    });
    this.grid = CellGrid.boxes(LCELL, n, (i, out) => {
      const r = Math.sqrt(this.r2[i]);
      out[0] = this.p[i * 3] - r; out[1] = this.p[i * 3 + 2] - r; out[2] = this.p[i * 3] + r; out[3] = this.p[i * 3 + 2] + r;
    });
  }
}

/** a mesh's vertices as it grows (the midpoints refinement adds) */
class Grow {
  n: number;
  pos: Float32Array; nrm: Float32Array; uv: Float32Array; mat: Uint8Array; tint: Uint8Array; ao: Uint8Array; glow: Uint8Array;
  constructor(m: ArchMesh) {
    this.n = m.mat.length;
    const cap = Math.max(1024, Math.ceil(this.n * 1.5));
    this.pos = grown(m.pos, cap * 3); this.nrm = grown(m.nrm, cap * 3); this.uv = grown(m.uv, cap * 2);
    this.mat = grown(m.mat, cap); this.tint = grown(m.tint, cap * 3); this.ao = grown(m.ao, cap); this.glow = grown(m.glow, cap);
  }
  /** a new vertex t of the way from a to b (its normal renormalised, its material a's) */
  lerp(a: number, b: number, t: number) {
    if (this.n >= KEY - 1) return -1;
    if (this.n >= this.mat.length) {
      const cap = this.mat.length * 2;
      this.pos = grown(this.pos, cap * 3); this.nrm = grown(this.nrm, cap * 3); this.uv = grown(this.uv, cap * 2);
      this.mat = grown(this.mat, cap); this.tint = grown(this.tint, cap * 3); this.ao = grown(this.ao, cap); this.glow = grown(this.glow, cap);
    }
    const v = this.n++, s = 1 - t;
    const P = this.pos, N = this.nrm, U = this.uv, T = this.tint;
    for (let k = 0; k < 3; k++) { P[v * 3 + k] = P[a * 3 + k] * s + P[b * 3 + k] * t; T[v * 3 + k] = Math.round(T[a * 3 + k] * s + T[b * 3 + k] * t); }
    let nx = N[a * 3] * s + N[b * 3] * t, ny = N[a * 3 + 1] * s + N[b * 3 + 1] * t, nz = N[a * 3 + 2] * s + N[b * 3 + 2] * t;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-6) { nx = N[a * 3]; ny = N[a * 3 + 1]; nz = N[a * 3 + 2]; } else { nx /= l; ny /= l; nz /= l; }
    N[v * 3] = nx; N[v * 3 + 1] = ny; N[v * 3 + 2] = nz;
    U[v * 2] = U[a * 2] * s + U[b * 2] * t; U[v * 2 + 1] = U[a * 2 + 1] * s + U[b * 2 + 1] * t;
    this.mat[v] = this.mat[a];
    this.ao[v] = Math.round(this.ao[a] * s + this.ao[b] * t);
    this.glow[v] = Math.round(this.glow[a] * s + this.glow[b] * t);
    return v;
  }
  finish(idx: Uint32Array, bounds: ArchMesh['bounds']): ArchMesh {
    const n = this.n;
    return {
      pos: this.pos.slice(0, n * 3), nrm: this.nrm.slice(0, n * 3), uv: this.uv.slice(0, n * 2), mat: this.mat.slice(0, n),
      tint: this.tint.slice(0, n * 3), ao: this.ao.slice(0, n), glow: this.glow.slice(0, n), idx, bounds,
    };
  }
}

function grown<T extends Float32Array | Uint8Array>(a: T, size: number): T {
  if (a.length >= size) return a;
  const b = new (a.constructor as { new(n: number): T })(size);
  b.set(a);
  return b;
}

/** indices as they grow, each triangle with a flag (1: to be refined; 0: left as it is) */
class Tris {
  a: Uint32Array;
  f: Uint8Array;
  n = 0;
  constructor(cap: number) { this.a = new Uint32Array(Math.max(48, cap)); this.f = new Uint8Array(this.a.length / 3); }
  push(x: number, y: number, z: number, flag: number) {
    if (this.n + 3 > this.a.length) {
      const b = new Uint32Array(this.a.length * 2); b.set(this.a); this.a = b;
      const g = new Uint8Array(this.a.length / 3); g.set(this.f); this.f = g;
    }
    this.f[this.n / 3] = flag;
    this.a[this.n++] = x; this.a[this.n++] = y; this.a[this.n++] = z;
  }
}

/** the edge length (squared) the lights along a way on a surface ask for (from a to b, the surface's normal n there):
 *  for each light reaching any of it from in front, at the way's point nearest that light (where it asks the most), its
 *  distance times sqrt(tau / E) (kept within [lo, hi]); Infinity where none does. Asked at an edge's middle alone (as
 *  it was), an edge whose end stood under a lamp and whose middle was out of the lamp's reach was never split, and the
 *  light at that end was carried the edge's whole length — on a square's big faces tens of metres: a long bright
 *  wedge fanned out from under every lamp, the dark ones between them, and a lamp over the middle of a long sliver of
 *  the plaza's paving had no pool at all */
function wanted(L: LightGrid, o: BakeOptions) {
  const g = L.grid, LP = L.p, R2 = L.r2, near2 = o.near * o.near;
  // (a light listed in several of the cells the way crosses asked once: the way's stamp)
  const seen = new Uint32Array(L.n);
  let stamp = 0;
  // (`under`: the caller asks only whether it's under that, so the first light that asks for less settles it)
  return (ax: number, ay: number, az: number, bx: number, by: number, bz: number, nx: number, ny: number, nz: number, under = 0) => {
    stamp++;
    const ex = bx - ax, ey = by - ay, ez = bz - az, e2 = Math.max(ex * ex + ey * ey + ez * ez, 1e-12);
    const cx1 = Math.floor(Math.max(ax, bx) / LCELL), cz0 = Math.floor(Math.min(az, bz) / LCELL), cz1 = Math.floor(Math.max(az, bz) / LCELL);
    let want2 = Infinity;
    for (let cx = Math.floor(Math.min(ax, bx) / LCELL); cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      for (let k = g.at(cx, cz), e = g.end; k < e; k++) {
        const l = g.items[k];
        if (seen[l] === stamp) continue;
        seen[l] = stamp;
        const lx = LP[l * 3], ly = LP[l * 3 + 1], lz = LP[l * 3 + 2];
        const t = Math.min(1, Math.max(0, ((lx - ax) * ex + (ly - ay) * ey + (lz - az) * ez) / e2));
        const dx = lx - (ax + ex * t), dy = ly - (ay + ey * t), dz = lz - (az + ez * t), d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= R2[l]) continue;
        // (a light behind the surface lights none of it; one nearly in its plane still grazes it)
        const cos = (dx * nx + dy * ny + dz * nz) / Math.sqrt(Math.max(d2, 1e-8));
        if (cos < -0.1) continue;
        const w = 1 - d2 / R2[l], E = (L.cd[l] * Math.max(cos, 0.1) * w * w) / Math.max(d2, near2);
        const f = Math.min(o.hi, Math.max(o.lo, Math.sqrt(o.tau / Math.max(E, 1e-6))));
        want2 = Math.min(want2, f * f * d2);
        if (want2 < under) return want2;
      }
    }
    return want2;
  };
}

/** The triangles sorted by what refinement does with them, by the island (connected triangles: a builder's face) they
 *  belong to: a small one (under `small` across) is left whole; a thin four-cornered one (narrower than `thin`: a
 *  cornice, a plinth, a coping, a column's flute) is cut across into segments as short as the lights along it ask (its
 *  width is under an edge's anyway: only its length needs the light's detail), and left so; any other is refined
 *  (flag 1) */
function prepare(m: ArchMesh, V: Grow, L: LightGrid, o: BakeOptions, want: ReturnType<typeof wanted>): Tris {
  const n = m.mat.length, idx = m.idx, P = m.pos, nt = idx.length / 3;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(idx[t]), b = find(idx[t + 1]);
    parent[b] = a;
    parent[find(idx[t + 2])] = a;
  }
  const lo = new Float32Array(n * 3).fill(Infinity), hi = new Float32Array(n * 3).fill(-Infinity), verts = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = find(i);
    verts[r]++;
    for (let k = 0; k < 3; k++) { lo[r * 3 + k] = Math.min(lo[r * 3 + k], P[i * 3 + k]); hi[r * 3 + k] = Math.max(hi[r * 3 + k], P[i * 3 + k]); }
  }
  const area = new Float32Array(n), tris = new Int32Array(n), second = new Int32Array(n).fill(-1);
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3, r = find(idx[t * 3]);
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    area[r] += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    if (tris[r]++ === 1) second[r] = t;
  }
  const out = new Tris(idx.length + 64);
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2], r = find(a);
    const across = Math.hypot(hi[r * 3] - lo[r * 3], hi[r * 3 + 1] - lo[r * 3 + 1], hi[r * 3 + 2] - lo[r * 3 + 2]);
    if (across < o.small) { out.push(a, b, c, 0); continue; }
    if (area[r] / across >= o.thin || verts[r] !== 4 || tris[r] !== 2) { out.push(a, b, c, 1); continue; }
    // (a strip: both its triangles when its first comes, cut across if a light reaches either)
    if (second[r] === t) continue;
    const t2 = second[r], d = idx[t2 * 3], e = idx[t2 * 3 + 1], f = idx[t2 * 3 + 2];
    if ((nearLight(P, a, b, c, L) || nearLight(P, d, e, f, L)) && cutStrip(V, [a, b, c], [d, e, f], o, want, out)) continue;
    out.push(a, b, c, 0);
    out.push(d, e, f, 0);
  }
  return out;
}

/** a strip of two triangles (its corners round it in their winding: the long sides q0 q1 and q2 q3) cut across where
 *  the lights along it ask, into out; false if the two aren't a four-cornered loop */
function cutStrip(V: Grow, t1: number[], t2: number[], o: BakeOptions, want: ReturnType<typeof wanted>, out: Tris): boolean {
  const E = [[t1[0], t1[1]], [t1[1], t1[2]], [t1[2], t1[0]], [t2[0], t2[1]], [t2[1], t2[2]], [t2[2], t2[0]]];
  const bound = E.filter(([u, v]) => !E.some(([x, y]) => x === v && y === u));
  if (bound.length !== 4) return false;
  const next = new Map(bound.map(([u, v]) => [u, v]));
  let q = [bound[0][0]];
  for (let k = 0; k < 3; k++) q.push(next.get(q[k]) ?? -1);
  if (next.get(q[3]) !== q[0] || q.some((x) => x < 0)) return false;
  const P = V.pos, N = V.nrm;
  const len = (a: number, b: number) => Math.hypot(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]);
  if (len(q[1], q[2]) + len(q[3], q[0]) > len(q[0], q[1]) + len(q[2], q[3])) q = [q[1], q[2], q[3], q[0]];
  const [q0, q1, q2, q3] = q, L = len(q0, q1);
  // the cuts: from one end, each step as long as the lights along the strip's middle line from it to the next cut let it
  // be — tried the whole way on first, then as far as that way asked for (a shorter way asks no more of it, so a few
  // tries settle it). (Asked at its start and its middle alone, a step past a lamp between them ran the strip's whole
  // length: a cornice or a lantern's cord lit from one end to the other.)
  const nx = N[q0 * 3] + N[q1 * 3], ny = N[q0 * 3 + 1] + N[q1 * 3 + 1], nz = N[q0 * 3 + 2] + N[q1 * 3 + 2], nl = Math.hypot(nx, ny, nz) || 1;
  const m = (t: number, k: number) => ((P[q0 * 3 + k] * (1 - t) + P[q1 * 3 + k] * t) + (P[q3 * 3 + k] * (1 - t) + P[q2 * 3 + k] * t)) / 2;
  const ts = [0];
  for (let t = 0, guard = 0; t < 1 && guard < 4096; guard++) {
    let step = 1 - t;
    for (let k = 0; k < 8; k++) {
      const u = t + step, w = Math.sqrt(want(m(t, 0), m(t, 1), m(t, 2), m(u, 0), m(u, 1), m(u, 2), nx / nl, ny / nl, nz / nl));
      const ok = Math.max(o.minEdge, w) / L;
      if (step <= ok) break;
      step = ok;
    }
    t = t + step > 0.999 ? 1 : t + step;
    ts.push(t);
  }
  if (ts.length === 2) { out.push(t1[0], t1[1], t1[2], 0); out.push(t2[0], t2[1], t2[2], 0); return true; }
  const B = ts.map((t) => (t === 0 ? q0 : t === 1 ? q1 : V.lerp(q0, q1, t)));
  const T = ts.map((t) => (t === 0 ? q3 : t === 1 ? q2 : V.lerp(q3, q2, t)));
  if (B.includes(-1) || T.includes(-1)) return false;
  for (let k = 0; k + 1 < ts.length; k++) { out.push(B[k], B[k + 1], T[k + 1], 0); out.push(B[k], T[k + 1], T[k], 0); }
  return true;
}

/** the mesh refined where the lights fall on it (see the header); the mesh itself where none reach it. Each round
 *  takes only the triangles still being refined: one none of whose edges split is done (an edge's split hangs on its
 *  own ends alone, so it never will be) */
export function refine(m: ArchMesh, L: LightGrid, o: BakeOptions = BAKE): ArchMesh {
  if (!L.n || !m.idx.length) return m;
  const V = new Grow(m), want = wanted(L, o);
  const first = prepare(m, V, L, o, want);
  const done = new Tris(m.idx.length * 2);
  let active = new Tris(1024);
  for (let t = 0; t < first.n; t += 3) (first.f[t / 3] ? active : done).push(first.a[t], first.a[t + 1], first.a[t + 2], first.f[t / 3]);
  const min2 = o.minEdge * o.minEdge;
  for (let round = 0; round < o.rounds && active.n; round++) {
    const mids = new Map<number, number>();
    const P = V.pos, N = V.nrm;
    // an edge split or not: the shortest any light along it asks for (still a matter of its own two ends alone)
    const decide = (a: number, b: number) => {
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
      const ex = bx - ax, ey = by - ay, ez = bz - az, len2 = ex * ex + ey * ey + ez * ez;
      if (len2 <= min2) return false;
      const nx = N[a * 3] + N[b * 3], ny = N[a * 3 + 1] + N[b * 3 + 1], nz = N[a * 3 + 2] + N[b * 3 + 2], nl = Math.hypot(nx, ny, nz) || 1;
      const w2 = want(ax, ay, az, bx, by, bz, nx / nl, ny / nl, nz / nl, len2);
      return w2 < Infinity && len2 > Math.max(min2, w2);
    };
    const edge = (a: number, b: number) => {
      const lo = a < b ? a : b, hi = a < b ? b : a, key = lo * KEY + hi;
      let v = mids.get(key);
      if (v === undefined) { v = decide(lo, hi) ? V.lerp(lo, hi, 0.5) : -1; mids.set(key, v); }
      return v;
    };
    const next = new Tris(active.n * 2);
    const A = active.a;
    for (let t = 0; t < active.n; t += 3) {
      const a = A[t], b = A[t + 1], c = A[t + 2];
      if (!nearLight(V.pos, a, b, c, L)) { done.push(a, b, c, 0); continue; }
      const ab = edge(a, b), bc = edge(b, c), ca = edge(c, a);
      const k = (ab >= 0 ? 1 : 0) | (bc >= 0 ? 2 : 0) | (ca >= 0 ? 4 : 0);
      switch (k) {
        case 0: done.push(a, b, c, 0); break;
        case 1: next.push(a, ab, c, 1); next.push(ab, b, c, 1); break;
        case 2: next.push(a, b, bc, 1); next.push(a, bc, c, 1); break;
        case 4: next.push(a, b, ca, 1); next.push(ca, b, c, 1); break;
        case 3: next.push(ab, b, bc, 1); next.push(a, ab, bc, 1); next.push(a, bc, c, 1); break;
        case 6: next.push(ca, bc, c, 1); next.push(a, b, bc, 1); next.push(a, bc, ca, 1); break;
        case 5: next.push(a, ab, ca, 1); next.push(ab, b, c, 1); next.push(ab, c, ca, 1); break;
        default: next.push(a, ab, ca, 1); next.push(ab, b, bc, 1); next.push(ca, bc, c, 1); next.push(ab, bc, ca, 1);
      }
    }
    active = next;
  }
  for (let t = 0; t < active.n; t += 3) done.push(active.a[t], active.a[t + 1], active.a[t + 2], 0);
  return V.finish(done.a.slice(0, done.n), m.bounds);
}

/** is any light within reach of a triangle's box (so it's worth asking its edges)? */
function nearLight(P: Float32Array, a: number, b: number, c: number, L: LightGrid) {
  const x0 = Math.min(P[a * 3], P[b * 3], P[c * 3]), x1 = Math.max(P[a * 3], P[b * 3], P[c * 3]);
  const y0 = Math.min(P[a * 3 + 1], P[b * 3 + 1], P[c * 3 + 1]), y1 = Math.max(P[a * 3 + 1], P[b * 3 + 1], P[c * 3 + 1]);
  const z0 = Math.min(P[a * 3 + 2], P[b * 3 + 2], P[c * 3 + 2]), z1 = Math.max(P[a * 3 + 2], P[b * 3 + 2], P[c * 3 + 2]);
  const g = L.grid, LP = L.p;
  for (let cx = Math.floor(x0 / LCELL); cx <= Math.floor(x1 / LCELL); cx++) for (let cz = Math.floor(z0 / LCELL); cz <= Math.floor(z1 / LCELL); cz++) {
    for (let k = g.at(cx, cz), e = g.end; k < e; k++) {
      const l = g.items[k];
      const lx = LP[l * 3], ly = LP[l * 3 + 1], lz = LP[l * 3 + 2];
      const dx = Math.max(x0 - lx, 0, lx - x1), dy = Math.max(y0 - ly, 0, ly - y1), dz = Math.max(z0 - lz, 0, lz - z1);
      if (dx * dx + dy * dy + dz * dz < L.r2[l]) return true;
    }
  }
  return false;
}

/** the part's solids (its colliders' wall boxes, each in its structure's plan: origin, yaw), gridded by their world
 *  footprints: what stands between a light and a surface */
export class Occluders {
  /** per box: the plan box (x0, h0, y0, x1, h1, y1), its frame (origin x, y, z, cos, sin), its plan corners in the
   *  world (x, z four times, round it) */
  private box: Float32Array;
  private frame: Float32Array;
  private corner: Float32Array;
  private grid: CellGrid;
  readonly n: number;

  constructor(structures: StructureCollider[]) {
    const boxes: number[] = [], frames: number[] = [], foot: number[] = [], corners: number[] = [];
    for (const sc of structures) {
      const c = Math.cos(sc.yaw), s = Math.sin(sc.yaw), [ox, oy, oz] = sc.origin;
      for (const b of sc.collision.solids) {
        boxes.push(b[0], b[4], b[1], b[2], b[5], b[3]);
        frames.push(ox, oy, oz, c, s);
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const [px, py] of [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]) {
          const wx = ox + c * px + s * py, wz = oz - s * px + c * py;
          x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); z0 = Math.min(z0, wz); z1 = Math.max(z1, wz);
          corners.push(wx, wz);
        }
        foot.push(x0, z0, x1, z1);
      }
    }
    this.box = new Float32Array(boxes);
    this.frame = new Float32Array(frames);
    this.corner = new Float32Array(corners);
    this.n = foot.length / 4;
    this.grid = CellGrid.boxes(LCELL, this.n, (i, out) => { out[0] = foot[i * 4]; out[1] = foot[i * 4 + 1]; out[2] = foot[i * 4 + 2]; out[3] = foot[i * 4 + 3]; });
  }

  /** the boxes that might stand between a light at p and the surfaces within r of it: none it's inside of, none
   *  narrower seen from it than `narrow` (radians; see BakeOptions) */
  near(p: ArrayLike<number>, r: number, narrow = 0): Int32Array {
    const out: number[] = [], seen = new Set<number>(), g = this.grid;
    for (let cx = Math.floor((p[0] - r) / LCELL); cx <= Math.floor((p[0] + r) / LCELL); cx++) for (let cz = Math.floor((p[2] - r) / LCELL); cz <= Math.floor((p[2] + r) / LCELL); cz++) {
      for (let k = g.at(cx, cz), e = g.end; k < e; k++) {
        const i = g.items[k];
        if (seen.has(i)) continue;
        seen.add(i);
        if (this.cut(i, p[0], p[1], p[2], p[0], p[1], p[2], true)) continue;
        if (narrow > 0 && this.span(i, p[0], p[2]) < narrow) continue;
        out.push(i);
      }
    }
    return new Int32Array(out);
  }

  /** the angle box i's plan spans seen from (x, z) (radians; a full turn from over or under it) */
  private span(i: number, x: number, z: number): number {
    const C = this.corner, o = i * 8;
    // (each corner's bearing from the box's middle's, so none wraps round)
    const ref = Math.atan2((C[o + 1] + C[o + 5]) / 2 - z, (C[o] + C[o + 4]) / 2 - x);
    let lo = 0, hi = 0, inside = true;
    for (let k = 0; k < 4; k++) {
      const cx = C[o + k * 2], cz = C[o + k * 2 + 1], nx = C[o + ((k + 1) % 4) * 2], nz = C[o + ((k + 1) % 4) * 2 + 1];
      if ((nx - cx) * (z - cz) - (nz - cz) * (x - cx) < 0) inside = false;
      let a = Math.atan2(cz - z, cx - x) - ref;
      a -= Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
      lo = Math.min(lo, a); hi = Math.max(hi, a);
    }
    return inside ? 2 * Math.PI : hi - lo;
  }

  /** does the segment from a to l cross box i (entering it between them)? `inside`: is a in it */
  cut(i: number, ax: number, ay: number, az: number, lx: number, ly: number, lz: number, inside = false): boolean {
    const F = this.frame, B = this.box, o = i * 5, b = i * 6;
    const c = F[o + 3], s = F[o + 4];
    const px = ax - F[o], ph = ay - F[o + 1], pz = az - F[o + 2];
    const P0 = c * px - s * pz, P1 = ph, P2 = s * px + c * pz;
    if (inside) return P0 > B[b] && P0 < B[b + 3] && P1 > B[b + 1] && P1 < B[b + 4] && P2 > B[b + 2] && P2 < B[b + 5];
    const qx = lx - F[o], qh = ly - F[o + 1], qz = lz - F[o + 2];
    const D0 = c * qx - s * qz - P0, D1 = qh - P1, D2 = s * qx + c * qz - P2;
    let t0 = 0, t1 = 1;
    const P = [P0, P1, P2], D = [D0, D1, D2];
    for (let k = 0; k < 3; k++) {
      const lo = B[b + k], hi = B[b + 3 + k];
      if (Math.abs(D[k]) < 1e-9) { if (P[k] <= lo || P[k] >= hi) return false; continue; }
      let u = (lo - P[k]) / D[k], v = (hi - P[k]) / D[k];
      if (u > v) { const w = u; u = v; v = w; }
      t0 = Math.max(t0, u); t1 = Math.min(t1, v);
      if (t0 >= t1) return false;
    }
    // (entered on the way, not started inside: a surface on the box's own face looks out of it)
    return t0 > 1e-4 && t0 < 0.999;
  }
}

/** a vertex this near a fire is the fire's own (its bowl, its coals): it glows only while that fire is lit (m) */
const FIRE_BODY = 1.2;

/** each vertex's light: the night's lights (rgb, candela over m²), the fires' together (a strength) and the nearest
 *  fire's index among them (-1: none reaches), and whether the vertex is that fire's own body */
export interface VertexLight { night: Float32Array; fire: Float32Array; fireOf: Int32Array; fireBody: Uint8Array }

export function bakeLight(m: ArchMesh, L: LightGrid, occ: Occluders | null, o: BakeOptions = BAKE): VertexLight {
  const n = m.mat.length;
  const night = new Float32Array(n * 3), fire = new Float32Array(n), fireOf = new Int32Array(n).fill(-1), fireBody = new Uint8Array(n);
  if (!L.n) return { night, fire, fireOf, fireBody };
  const g = L.grid, LP = L.p, P = m.pos, N = m.nrm, near2 = o.near * o.near, body2 = FIRE_BODY * FIRE_BODY;
  // (each light's walls, found once: those wide enough from it to shade what the mesh can show)
  const walls = occ?.n ? Array.from({ length: L.n }, (_, l) => occ.near(LP.subarray(l * 3, l * 3 + 3), Math.sqrt(L.r2[l]), o.narrow)) : null;
  for (let v = 0; v < n; v++) {
    const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2], nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
    let r = 0, gg = 0, b = 0, f = 0, top = 0, topI = -1, body = false;
    for (let k = g.at(Math.floor(px / LCELL), Math.floor(pz / LCELL)), e = g.end; k < e; k++) {
      const l = g.items[k];
      const dx = LP[l * 3] - px, dy = LP[l * 3 + 1] - py, dz = LP[l * 3 + 2] - pz, d2 = dx * dx + dy * dy + dz * dz;
      const R2 = L.r2[l];
      if (d2 >= R2) continue;
      const fi = L.fire[l];
      // (a fire's own body takes its index whichever way it faces)
      if (fi >= 0 && d2 < body2 && !body) { body = true; top = Infinity; topI = fi; }
      const cos = (dx * nx + dy * ny + dz * nz) / Math.sqrt(Math.max(d2, 1e-8));
      if (cos <= 0) continue;
      if (walls && blocked(occ!, walls[l], px + nx * 0.05, py + ny * 0.05, pz + nz * 0.05, LP[l * 3], LP[l * 3 + 1], LP[l * 3 + 2])) continue;
      const w = 1 - d2 / R2, E = (L.cd[l] * cos * w * w) / Math.max(d2, near2);
      if (fi < 0) { r += L.rgb[l * 3] * E; gg += L.rgb[l * 3 + 1] * E; b += L.rgb[l * 3 + 2] * E; }
      else { f += E; if (E > top) { top = E; topI = fi; } }
    }
    night[v * 3] = r; night[v * 3 + 1] = gg; night[v * 3 + 2] = b;
    fire[v] = f; fireOf[v] = topI; fireBody[v] = body ? 1 : 0;
  }
  return { night, fire, fireOf, fireBody };
}

/** is a wall between a point and a light (any of the light's own boxes the way crosses)? */
function blocked(occ: Occluders, boxes: Int32Array, ax: number, ay: number, az: number, lx: number, ly: number, lz: number) {
  for (let k = 0; k < boxes.length; k++) if (occ.cut(boxes[k], ax, ay, az, lx, ly, lz)) return true;
  return false;
}
