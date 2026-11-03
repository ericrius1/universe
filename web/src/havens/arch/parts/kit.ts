// The parts library's common ground (parts/README.md): the detail levels every part is laid at, the seeded randomness
// that keeps a street of them from being one copy, the town's colours as tints, what a part hands back (its lights, its
// top, the hole it wants in its wall, what's walked), and the few shapes ArchBuilder doesn't lay itself — a smooth
// sheet over a grid of points (a dome's or a capital's surface, lobed or ribbed as it turns), a flat ring, a polygon
// on a face fitted whole. Every part is laid at the builder's current frame (b.at / b.group): a free-standing one with
// its foot's middle at the origin and y up; one on a wall with x along the wall (its middle at 0), y up and z out of
// the wall's face (the face at z 0). Anything laid on a surface stands PROUD off it; a cap takes the place of what it
// caps; no face is laid where nothing can see it; no two faces share a plane where they overlap.
import type { ArchBuilder } from '../builder';
import { PROUD, triangulate } from '../builder';
import type { ArchMesh, LightSpot, Mat, V3 } from '../types';
import { isTiled } from '../types';
import type { V2 } from '../../world/layout';

/** how far anything laid on a surface stands off it (m): the builder's own (builder.ts), the one geo-check holds to */
export { PROUD };

/** a part's detail: near (looked at close: every moulding, louvre and bar), mid (across a street: the shapes, not the
 *  trim's trim), far (across the town: a few triangles that keep its outline and its colours) */
export type Detail = 'near' | 'mid' | 'far';
export const DETAILS: readonly Detail[] = ['near', 'mid', 'far'];
/** a value by detail level */
export const byDetail = <T>(d: Detail, near: T, mid: T, far: T): T => (d === 'near' ? near : d === 'mid' ? mid : far);

/** what every part takes beside its own options: its detail and its seed (the variation a street of them has) */
export interface PartOpts { detail?: Detail; seed?: number }

/** what a part hands back: the lights it carries (world), its top (local height), the outline of the hole an opening
 *  wants left in its wall (x along the face, y up it: the caller's wall leaves it open), and what's walked on it in its
 *  own frame (as types.ts Collision: solids [x0, z0, x1, z1, y0, y1], floors [x0, z0, x1, z1, h, open], stairs
 *  [x0, z0, x1, z1, base, rise, axis, sign]) */
export interface Laid {
  lights: LightSpot[];
  top: number;
  hole?: V2[];
  walk?: { solids: number[][]; floors: number[][]; stairs: number[][] };
}

/** the warm light of a lamp, a window, a lantern (linear rgb) */
export const LAMP: V3 = [1.0, 0.58, 0.26];

/** the town's colours as tints (×1 is the material's own): cloths for awnings and paper lanterns, glazes for domes,
 *  paints for shutters and doors (the same as city/props.ts's), and the lanterns' glass */
export const CLOTHS: V3[] = [
  [1.15, 0.62, 0.22], [0.28, 0.78, 0.72], [1.2, 1.05, 0.78], [1.05, 0.3, 0.2], [0.9, 0.42, 0.7], [1.15, 0.86, 0.3], [0.45, 0.55, 1.0],
];
export const GLAZES: V3[] = [[1, 1, 1], [1.9, 1.75, 0.95], [0.72, 0.78, 1.08]];
export const PAINTS: V3[] = [[0.45, 1.05, 1.0], [0.5, 0.75, 1.25], [0.6, 1.1, 0.6], [1.3, 1.0, 0.55], [1.2, 0.6, 0.45], [1, 1, 1]];
export const GLASS: V3[] = [[1.3, 0.75, 0.4], [1.25, 0.95, 0.55], [1.2, 0.55, 0.45], [0.9, 0.95, 1.2]];

/** a part's seeded randomness (mulberry32, as the city's Rng): the same seed always lays the same part */
export class Rand {
  private s: number;
  constructor(seed = 1) { this.s = (Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0) || 1; }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  int(a: number, b: number) { return a + Math.floor(this.next() * (b - a + 1)); }
  chance(p: number) { return this.next() < p; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
  /** a tint moved a little each way (a painter's hand: no two the same) */
  vary(t: V3, k = 0.05): V3 { const v = 1 + this.range(-k, k), w = this.range(-k, k) * 0.6; return [t[0] * v * (1 + w), t[1] * v, t[2] * v * (1 - w)]; }
}

/** a part's detail (near if not given) and its randomness from its seed */
export function begin(o: PartOpts) { return { d: o.detail ?? 'near', rng: new Rand(o.seed ?? 1) }; }

const norm3 = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]); return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0]; };
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dist3 = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** a smooth sheet over a grid of local points — rows[j][i], j up the surface (v), i across it (u) — its normals taken
 *  from its neighbours (so a lobed dome or a fluted bell shades round), its uv in metres (u along the first row, v up
 *  the first column), laid into b as one island with b's style. Wound so its normal is (up the surface) × (across it):
 *  with i turning from +x toward +z (ArchBuilder.lathe's way) and j rising, it faces out. `closeU`: the last column
 *  is the first again (a full turn: its normals wrap); `fallback` the normal where the grid closes to a point */
export function sheet(b: ArchBuilder, rows: V3[][], mat: Mat, o: { closeU?: boolean; fallback?: V3 } = {}) {
  const J = rows.length, I = rows[0]?.length ?? 0;
  if (J < 2 || I < 2) return;
  const n = J * I, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const U: number[] = [0];
  for (let i = 1; i < I; i++) U.push(U[i - 1] + dist3(rows[0][i], rows[0][i - 1]));
  const V: number[] = [0];
  for (let j = 1; j < J; j++) V.push(V[j - 1] + dist3(rows[j][0], rows[j - 1][0]));
  const fb = o.fallback ?? [0, 1, 0];
  let last: V3 = fb;
  for (let j = 0; j < J; j++) {
    for (let i = 0; i < I; i++) {
      let i0 = i - 1, i1 = i + 1;
      if (o.closeU) { if (i0 < 0) i0 = I - 2; if (i1 > I - 1) i1 = 1; } else { i0 = Math.max(0, i0); i1 = Math.min(I - 1, i1); }
      const du = sub3(rows[j][i1], rows[j][i0]);
      const dv = sub3(rows[Math.min(J - 1, j + 1)][i], rows[Math.max(0, j - 1)][i]);
      let nn = norm3(cross3(dv, du));
      if (nn[0] === 0 && nn[1] === 0 && nn[2] === 0) {
        // (where the row closes to a point: the row below's, or the fallback's)
        nn = j > 0 ? [nrm[((j - 1) * I + i) * 3], nrm[((j - 1) * I + i) * 3 + 1], nrm[((j - 1) * I + i) * 3 + 2]] : last;
        if (j === J - 1 && Math.hypot(rows[j][i0][0] - rows[j][i1][0], rows[j][i0][2] - rows[j][i1][2]) < 1e-6) nn = fb;
      }
      last = nn;
      const k = j * I + i, P = b.xf(rows[j][i]), N = b.xd(nn);
      pos.set(P, k * 3);
      nrm.set(N, k * 3);
      uv[k * 2] = U[i]; uv[k * 2 + 1] = V[j];
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < J - 1; j++) for (let i = 0; i < I - 1; i++) {
    const a = j * I + i, c = a + I;
    // (a quad closed to a point at the tip: one triangle)
    if (dist3(rows[j + 1][i], rows[j + 1][i + 1]) < 1e-7) idx.push(a, c, a + 1);
    else if (dist3(rows[j][i], rows[j][i + 1]) < 1e-7) idx.push(a, c, c + 1);
    else idx.push(a, c, a + 1, a + 1, c, c + 1);
  }
  b.merge(meshOf(b, pos, nrm, uv, mat, idx));
}

/** a surface of revolution about local (cx, cz) from y: profile [radius, height] from the bottom up, in `sides`; its
 *  radius times `lobe(angle)` as it turns (a melon dome's gores, a lotus capital's petals), smooth */
export function revolve(b: ArchBuilder, cx: number, y: number, cz: number, prof: [number, number][], sides: number, mat: Mat,
  o: { lobe?: (a: number) => number; phase?: number; fallback?: V3 } = {}) {
  const ph = o.phase ?? 0;
  const rows = prof.map(([r, h]) => Array.from({ length: sides + 1 }, (_, i) => {
    const a = ((i % sides) / sides) * Math.PI * 2 + ph, k = o.lobe ? o.lobe(a) : 1;
    return [cx + Math.cos(a) * r * k, y + h, cz + Math.sin(a) * r * k] as V3;
  }));
  sheet(b, rows, mat, { closeU: true, fallback: o.fallback });
}

/** an ArchMesh of world positions and normals, uv and triangles, in b's current style (what ArchBuilder.vert gives) */
function meshOf(b: ArchBuilder, pos: Float32Array, nrm: Float32Array, uv: Float32Array, mat: Mat, idx: number[]): ArchMesh {
  const n = pos.length / 3, st = b.style;
  const tint = new Uint8Array(n * 3), ao = new Uint8Array(n), glow = new Uint8Array(n), mats = new Uint8Array(n).fill(mat);
  const t = st.tint.map((x) => Math.round(Math.min(255, x * 128)));
  for (let i = 0; i < n; i++) tint.set(t, i * 3);
  ao.fill(Math.round(Math.max(0, Math.min(1, st.ao)) * 255));
  glow.fill(isTiled(mat) ? st.pal : Math.round(Math.max(0, Math.min(1, st.glow)) * 255));
  return { pos, nrm, uv, mat: mats, tint, ao, glow, idx: new Uint32Array(idx), bounds: [[0, 0, 0], [0, 0, 0]] };
}

/** a flat ring facing up (or down) from radius r0 out to r1 at height y round local (cx, cz), in `sides` (those of
 *  what it caps, `phase` turned as they are) */
export function annulus(b: ArchBuilder, cx: number, cz: number, r0: number, r1: number, y: number, sides: number, mat: Mat, down = false, phase = 0) {
  const at = (a: number, r: number): V3 => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2 + phase, a1 = ((i + 1) / sides) * Math.PI * 2 + phase;
    if (r0 < 1e-5) { if (down) b.poly([at(a0, r1), at(a1, r1), at(a0, 0)], mat); else b.poly([at(a1, r1), at(a0, r1), at(a0, 0)], mat); continue; }
    if (down) b.quad(at(a0, r0), at(a0, r1), at(a1, r1), at(a1, r0), mat);
    else b.quad(at(a1, r0), at(a1, r1), at(a0, r1), at(a0, r0), mat);
  }
}

/** an n-sided shaft about local (cx, cz) from y0 (radius r0, to its corners) to y1 (r1), its faces flat, turned by
 *  `phase` (π/n puts a face square to +x); no caps (the ring helpers or what stands on it close it) */
export function facets(b: ArchBuilder, cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, n: number, mat: Mat, phase = 0) {
  const at = (i: number, r: number, y: number): V3 => { const a = (i / n) * Math.PI * 2 + phase; return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]; };
  for (let i = 0; i < n; i++) b.quad(at(i + 1, r0, y0), at(i, r0, y0), at(i, r1, y1), at(i + 1, r1, y1), mat);
}

/** an n-sided ring's flat top (or bottom) between two of `facets`' outlines (r0 in, r1 out; r0 0: the whole polygon) */
export function facetRing(b: ArchBuilder, cx: number, cz: number, r0: number, r1: number, y: number, n: number, mat: Mat, down = false, phase = 0) {
  annulus(b, cx, cz, r0, r1, y, n, mat, down, phase);
}

/** a polygon on a plane of the current frame — its outline in (u, v) on the plane through `o` spanned by `ua` and
 *  `va`, facing `out` — laid as one island (a panel's picture, a tile field, fitted whole across it), its texture's
 *  u along `uDir` (ua: a face seen from behind wants -ua, to keep its picture upright) */
export function region(b: ArchBuilder, pts: V2[], o: V3, ua: V3, va: V3, out: V3, mat: Mat, uDir: V3 = ua) {
  // (a point repeated where two edges meet in line: dropped, the ear clipping wants none)
  const q: V2[] = [];
  for (const p of pts) { const l = q[q.length - 1]; if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 1e-6) q.push(p); }
  while (q.length > 2 && Math.hypot(q[0][0] - q[q.length - 1][0], q[0][1] - q[q.length - 1][1]) < 1e-6) q.pop();
  if (q.length < 3) return;
  const P = q.map(([u, v]) => [o[0] + ua[0] * u + va[0] * v, o[1] + ua[1] * u + va[1] * v, o[2] + ua[2] * u + va[2] * v] as V3);
  const tris = triangulate(q);
  // (an outline the ear clipping couldn't finish — one that touches or crosses itself — leaves a hole in a wall: said
  // once, loudly, rather than found in a shot)
  if (tris.length / 3 < q.length - 2 && !warned) { warned = true; console.warn(`parts: an outline of ${q.length} points was left part open (it touches or crosses itself)`); }
  b.patch(P, tris, mat, out, uDir);
}
let warned = false;

/** a rectangle on the plane `region` takes (u0..u1, v0..v1) */
export function rectOn(b: ArchBuilder, u0: number, v0: number, u1: number, v1: number, o: V3, ua: V3, va: V3, out: V3, mat: Mat, uDir: V3 = ua) {
  if (u1 - u0 < 1e-5 || v1 - v0 < 1e-5) return;
  region(b, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], o, ua, va, out, mat, uDir);
}

/** a box in the current frame with only the faces asked for: 'top' 'bottom' 'n' (-z) 's' (+z) 'e' (+x) 'w' (-x) */
export function faces(b: ArchBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Mat, keep: string, o: { top?: Mat } = {}) {
  const all = ['top', 'bottom', 'n', 's', 'e', 'w'];
  b.box(x0, y0, z0, x1, y1, z1, mat, { top: o.top, skip: all.filter((f) => !keep.split(' ').includes(f)) });
}

/** a slab standing out of the wall (z 0) to z1: its front, its sides; its back on the wall left off (and its top or
 *  bottom too, where something sits on it or it sits on something: `skip`) */
export function proud(b: ArchBuilder, x0: number, y0: number, x1: number, y1: number, z1: number, mat: Mat, skip: string[] = [], z0 = 0, o: { top?: Mat } = {}) {
  b.box(x0, y0, z0, x1, y1, z1, mat, { top: o.top, skip: ['n', ...skip] });
}

/** a light at a local point (world in the list) */
export function lightAt(b: ArchBuilder, p: V3, candela: number, o: { color?: V3; when?: LightSpot['when']; radius?: number } = {}): LightSpot {
  return { p: b.xf(p), color: o.color ?? LAMP, candela, when: o.when ?? 'night', radius: o.radius ?? 9 };
}
