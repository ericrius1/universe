// Where every plant goes: the gardens' beds (GardenBed polygons from the haven and the city) planted the way a gardener
// would, the bougainvillea strung along the walls' tops, urns at the corners, and the canyon's wild plants scattered by
// its ground. Everything is deterministic: each bed is seeded from its own outline, so adding or moving one bed never
// reshuffles another. Big things are planted first (trees, cypress, palms, shrubs) into one occupancy grid shared by
// all the beds; flowers and lawn fill round them.
//
// The beds by kind:
//   lawn     tiles of blades on a jittered grid, mown in faint stripes along the bed
//   flowers  a designed border: drifts of one kind and one colour (3-9 plants), tall at the back (a wall, or the bed's
//            middle when it's an island), mid in the body, low cushions spilling along the front edge; a clipped mound
//            here and there for structure
//   shrubs   a parterre: box hedge round the edge (or one line down a strip), clipped balls and cones on a grid, low
//            flowers between
//   trees    olives and pomegranates in a quincunx, lawn under them, loose mounds round their feet
//   cypress  a row down the bed's length (a pair or one in a small bed)
//   blossom  blossom trees a good way apart, lawn under them and a ring of low flowers round each trunk
//   vines    bougainvillea over the wall the bed's strip runs along (or use vinesAlong with the walls themselves)
//   lotus    clumps on the pool, gathered toward its edges and corners, open water in its middle for the reflections
//   palms    date palms in a row (staggered when wide), agaves and bunchgrass at their feet
//   scrub    a desert garden: drifts of scrub, bunchgrass and agaves
import type { GardenBed } from '../arch/types';
import type { V2 } from '../world/layout';
import { hash, hex, rng, type Rng, type V3 } from './mesh';
import { BLOOMS, BLOSSOM, BOUGAINVILLEA, LOTUS, type Family } from './palette';
import { SPECIES, SPECIES_ID } from './species';
import { LAWN_STEP } from './species/lawn';
import { VINE_DROPS, VINE_WIDTH } from './species/vines';

/** one plant: where, turned (yaw about +y, as ArchBuilder's: local +x to world (cos, -sin)), how big (its scale on the
 *  mesh, and an extra vertical stretch: a vine's drop), which species and variant, its bloom colour (linear rgb: the
 *  petals and bracts take it) and its leaves' brightness (about 1) */
export interface FloraInstance {
  x: number; y: number; z: number; yaw: number; scale: number; stretch: number;
  species: number; variant: number; bloom: V3; leaf: number;
}

/** each species' variants' own heights (m: their LOD0 meshes' heights, or a vine's drop), by species id */
export type Heights = number[][];

/** a wall the vines hang over: its top outer edge as a plan polyline, the coping's top (m), the ground at its foot on
 *  the side they hang down (m), and that side: +1 the right of the line looking along it (x east, z south: going
 *  east, the right is south), -1 the left */
export interface WallLine { path: V2[]; top: number; foot: number; side: 1 | -1 }

export interface ScatterContext {
  /** the mesh heights (meshHeights(growFlora())) */
  heights: Heights;
  /** the ground's height (used to find which way a 'vines' bed's wall drops and how far) */
  ground?: (x: number, z: number) => number;
  /** walls near the beds: a flower border's back is the edge along one */
  walls?: WallLine[];
  /** how full the planting is overall (multiplies every bed's density) */
  fullness?: number;
}

// ------------------------------------------------------------------ plane geometry
const area = (p: V2[]) => Math.abs(p.reduce((s, [x, z], i) => { const [x2, z2] = p[(i + 1) % p.length]; return s + x * z2 - x2 * z; }, 0)) / 2;
export function inside(p: V2, poly: V2[]): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) r = !r;
  }
  return r;
}
function segDist(p: V2, a: V2, b: V2): number {
  const ex = b[0] - a[0], ez = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / (ex * ex + ez * ez || 1)));
  return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ez * t);
}
/** distance to the polygon's outline */
export function edgeDist(p: V2, poly: V2[]): number {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segDist(p, poly[j], poly[i]));
  return d;
}
function bbox(poly: V2[]) {
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}
/** the polygon's long axis (unit, from its second moments) and its centroid */
function axisOf(poly: V2[]): { c: V2; u: V2; v: V2; len: number; wid: number } {
  const n = poly.length;
  let cx = 0, cz = 0;
  for (const [x, z] of poly) { cx += x / n; cz += z / n; }
  let xx = 0, xz = 0, zz = 0;
  // (the outline sampled densely along its edges, so long edges weigh as much as they're long)
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 0; s < L; s += 0.25) {
      const x = a[0] + (b[0] - a[0]) * s / L - cx, z = a[1] + (b[1] - a[1]) * s / L - cz;
      xx += x * x; xz += x * z; zz += z * z;
    }
  }
  const ang = 0.5 * Math.atan2(2 * xz, xx - zz);
  const u: V2 = [Math.cos(ang), Math.sin(ang)], v: V2 = [-u[1], u[0]];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of poly) {
    const a = (x - cx) * u[0] + (z - cz) * u[1], b = (x - cx) * v[0] + (z - cz) * v[1];
    u0 = Math.min(u0, a); u1 = Math.max(u1, a); v0 = Math.min(v0, b); v1 = Math.max(v1, b);
  }
  return { c: [cx + u[0] * (u0 + u1) / 2 + v[0] * (v0 + v1) / 2, cz + u[1] * (u0 + u1) / 2 + v[1] * (v0 + v1) / 2], u, v, len: u1 - u0, wid: v1 - v0 };
}
/** a seed from a bed's outline and kind */
const bedSeed = (b: GardenBed) => hash(...b.poly.flat(), b.y, b.kind.length, b.kind.charCodeAt(0));

// ------------------------------------------------------------------ occupancy
/** a spatial hash of the planted footprints (centre, radius), so things keep their distance */
class Occupancy {
  private cells = new Map<string, { x: number; z: number; r: number }[]>();
  private key = (i: number, j: number) => `${i},${j}`;
  constructor(private cell = 1.5) {}
  free(x: number, z: number, r: number, slack = 1): boolean {
    const i0 = Math.floor((x - r - 4) / this.cell), i1 = Math.floor((x + r + 4) / this.cell);
    const j0 = Math.floor((z - r - 4) / this.cell), j1 = Math.floor((z + r + 4) / this.cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      for (const q of this.cells.get(this.key(i, j)) ?? []) if (Math.hypot(q.x - x, q.z - z) < (q.r + r) * slack) return false;
    }
    return true;
  }
  add(x: number, z: number, r: number) {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    const l = this.cells.get(k);
    if (l) l.push({ x, z, r }); else this.cells.set(k, [{ x, z, r }]);
  }
}

// ------------------------------------------------------------------ planting
/** sizes, footprints and how they're picked, per species */
const PLANT: Record<string, { r: number; h?: [number, number] }> = {
  lawn: { r: 0 }, daisy: { r: 0.24 }, lily: { r: 0.24 }, tulip: { r: 0.19 }, starflower: { r: 0.26 }, spire: { r: 0.21 },
  boxball: { r: 0.45 }, hedge: { r: 0.3 }, cypress: { r: 0.55 }, blossom: { r: 2.2 }, olive: { r: 1.6 }, pomegranate: { r: 1.2 },
  datepalm: { r: 1.2 }, bougainvillea: { r: 0 }, lotus: { r: 0.5 }, scrub: { r: 0.45 }, bunchgrass: { r: 0.22 }, agave: { r: 0.35 }, urn: { r: 0.35 },
};

class Planter {
  out: FloraInstance[] = [];
  occ = new Occupancy();
  constructor(private ctx: ScatterContext) {}
  /** plant a species at (x, y, z) at a height (m) within its range (t: 0..1 into it, or an explicit height) */
  put(name: string, x: number, y: number, z: number, r: Rng, o: { yaw?: number; t?: number; height?: number; variant?: number; bloom?: V3; leaf?: number; stretch?: number } = {}) {
    const id = SPECIES_ID[name];
    const def = SPECIES[id];
    const variant = o.variant ?? r.int(0, def.variants - 1);
    const meshH = this.ctx.heights[id]?.[variant] ?? 1;
    const h = o.height ?? def.size[0] + (def.size[1] - def.size[0]) * (o.t ?? r.next());
    this.out.push({ x, y, z, yaw: o.yaw ?? r.next() * Math.PI * 2, scale: def.scaled ? h : h / meshH, stretch: o.stretch ?? 1, species: id, variant, bloom: o.bloom ?? [1, 1, 1], leaf: o.leaf ?? r.range(0.92, 1.08) });
  }
}

/** a bloom from a family (each a little varied) */
function bloomOf(family: Family, r: Rng): V3 {
  const fam: Exclude<Family, 'mixed'> = family === 'mixed' ? r.pick(['pink', 'white', 'gold', 'purple'] as const) : family;
  return jitter(hex(r.pick(BLOOMS[fam])), r);
}
const jitter = (c: V3, r: Rng, k = 0.06): V3 => [c[0] * r.range(1 - k, 1 + k), c[1] * r.range(1 - k, 1 + k), c[2] * r.range(1 - k, 1 + k)];

/** darts inside a polygon at a spacing (Poisson-ish), optionally weighted (0..1: the chance a dart stays) */
function darts(poly: V2[], spacing: number, r: Rng, inset = 0, weight?: (p: V2) => number): V2[] {
  const b = bbox(poly);
  const out: V2[] = [];
  const cell = spacing / Math.SQRT2;
  const grid = new Map<string, V2>();
  const tries = Math.ceil((area(poly) / (spacing * spacing)) * 6) + 8;
  for (let t = 0; t < tries; t++) {
    const p: V2 = [b.x0 + (b.x1 - b.x0) * r.next(), b.z0 + (b.z1 - b.z0) * r.next()];
    if (!inside(p, poly) || edgeDist(p, poly) < inset) continue;
    if (weight && r.next() > weight(p)) continue;
    const gi = Math.floor(p[0] / cell), gj = Math.floor(p[1] / cell);
    let ok = true;
    for (let i = gi - 2; i <= gi + 2 && ok; i++) for (let j = gj - 2; j <= gj + 2 && ok; j++) {
      const q = grid.get(`${i},${j}`);
      if (q && Math.hypot(q[0] - p[0], q[1] - p[1]) < spacing) ok = false;
    }
    if (!ok) continue;
    grid.set(`${gi},${gj}`, p);
    out.push(p);
  }
  return out;
}

// ------------------------------------------------------------------ the beds
/** a lawn: tiles on a jittered grid, mown in stripes; none where another bed lies over it (an island of flowers) */
function lawnBed(P: Planter, b: GardenBed, r: Rng, density: number, over: V2[][] = []) {
  const ax = axisOf(b.poly);
  const step = LAWN_STEP / Math.sqrt(Math.max(0.3, density));
  const bb = bbox(b.poly);
  for (let x = bb.x0 + step / 2; x < bb.x1; x += step) for (let z = bb.z0 + step / 2; z < bb.z1; z += step) {
    const p: V2 = [x + r.range(-0.35, 0.35) * step, z + r.range(-0.35, 0.35) * step];
    if (!inside(p, b.poly) || edgeDist(p, b.poly) < 0.08 || over.some((q) => inside(p, q))) continue;
    // mown stripes along the bed: faint bands of lighter and darker grass
    const along = (p[0] - ax.c[0]) * ax.v[0] + (p[1] - ax.c[1]) * ax.v[1];
    const stripe = Math.sin((along / 1.4) * Math.PI) > 0 ? 1.05 : 0.95;
    P.put('lawn', p[0], b.y, p[1], r, { t: r.range(0.3, 0.8), leaf: stripe * r.range(0.97, 1.03) });
  }
}

/** a flower border: drifts by height class (tall at the back, low at the front), each one kind in one colour */
function flowerBed(P: Planter, b: GardenBed, r: Rng, density: number, walls: WallLine[]) {
  const family = b.palette ?? 'mixed';
  // how far a point is from the bed's front (its outline, less the edges along a wall: those are its back)
  const backEdges: [V2, V2][] = [];
  for (let i = 0; i < b.poly.length; i++) {
    const a = b.poly[i], c = b.poly[(i + 1) % b.poly.length];
    const mid: V2 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    // (a wall is the bed's back when the bed stands at its foot; a bed on its top has it for a front)
    if (walls.some((w) => b.y < w.top - 0.5 && w.path.some((_, k) => k > 0 && segDist(mid, w.path[k - 1], w.path[k]) < 1.0))) backEdges.push([a, c]);
  }
  const frontDist = (p: V2) => {
    let d = Infinity;
    for (let i = 0; i < b.poly.length; i++) {
      const a = b.poly[i], c = b.poly[(i + 1) % b.poly.length];
      if (backEdges.some(([x, y]) => x === a && y === c)) continue;
      d = Math.min(d, segDist(p, a, c));
    }
    return d;
  };
  const backDist = (p: V2) => (backEdges.length ? Math.min(...backEdges.map(([a, c]) => segDist(p, a, c))) : Infinity);
  const ax = axisOf(b.poly);
  // the depth: 0 at the front edge, 1 at the back (a wall, or the middle of an island bed)
  const depthAt = (p: V2) => {
    const f = frontDist(p), k = backDist(p);
    return k < Infinity ? f / Math.max(f + k, 1e-3) : Math.min(1, f / Math.max(0.6, ax.wid / 2));
  };
  // drifts: patches a metre or two across, each its kind by its depth, its colour from the family (no two neighbours
  // alike in a mixed bed)
  type Drift = { p: V2; kind: string; variant: number; bloom: V3; fam: string };
  const drifts: Drift[] = [];
  for (const p of darts(b.poly, 1.25 + r.next() * 0.3, r)) {
    const d = depthAt(p);
    const kind = d > 0.68 ? r.pick(['spire', 'lily', 'lily', 'daisy', 'spire', 'daisy']) : d > 0.3 ? r.pick(['daisy', 'tulip', 'lily', 'daisy', 'tulip', 'daisy']) : r.pick(['starflower', 'tulip', 'daisy', 'starflower']);
    let fam: Family = family;
    if (family === 'mixed') {
      const near = drifts.filter((q) => Math.hypot(q.p[0] - p[0], q.p[1] - p[1]) < 2.2).map((q) => q.fam);
      const free = (['pink', 'white', 'gold', 'purple'] as const).filter((f) => !near.includes(f));
      fam = r.pick(free.length ? free : (['pink', 'white', 'gold', 'purple'] as const));
    }
    const def = SPECIES[SPECIES_ID[kind]];
    drifts.push({ p, kind, variant: r.int(0, def.variants - 1), bloom: hex(r.pick(BLOOMS[fam as Exclude<Family, 'mixed'>])), fam });
  }
  if (!drifts.length) return;
  // the low edging: cushions of stars along the front edge, a hand in from it, spilling over
  for (let i = 0; i < b.poly.length; i++) {
    const a = b.poly[i], c = b.poly[(i + 1) % b.poly.length];
    if (backEdges.some(([x, y]) => x === a && y === c)) continue;
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (L < 0.8) continue;
    const ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L;
    const edgeBloom = family === 'mixed' ? hex(r.pick(BLOOMS.white)) : bloomOf(family, r);
    for (let s = 0.3; s < L - 0.2; s += 0.42 / Math.sqrt(density)) {
      // (inward: whichever side of the edge lies in the bed)
      for (const sgn of [1, -1]) {
        const p: V2 = [a[0] + ux * s - uz * 0.24 * sgn, a[1] + uz * s + ux * 0.24 * sgn];
        if (!inside(p, b.poly)) continue;
        if (!P.occ.free(p[0], p[1], 0.18, 0.9)) break;
        P.put('starflower', p[0] + r.range(-0.04, 0.04), b.y, p[1] + r.range(-0.04, 0.04), r, { bloom: jitter(edgeBloom, r), t: r.range(0.4, 1) });
        P.occ.add(p[0], p[1], 0.18);
        break;
      }
    }
  }
  // structure: a loose clipped mound now and then down a big bed's middle
  if (ax.len > 6 && ax.wid > 1.6) {
    for (let s = -ax.len / 2 + 2.5; s < ax.len / 2 - 2; s += r.range(3.5, 5)) {
      const p: V2 = [ax.c[0] + ax.u[0] * s + ax.v[0] * r.range(-0.2, 0.2) * ax.wid, ax.c[1] + ax.u[1] * s + ax.v[1] * r.range(-0.2, 0.2) * ax.wid];
      if (inside(p, b.poly) && edgeDist(p, b.poly) > 0.6 && P.occ.free(p[0], p[1], 0.5)) {
        P.put('boxball', p[0], b.y, p[1], r, { variant: 2, t: r.range(0.1, 0.4) });
        P.occ.add(p[0], p[1], 0.5);
      }
    }
  }
  // the body: plants a spacing apart, each its nearest drift's kind and colour, its height a little by its depth
  for (const p of darts(b.poly, 0.4 / Math.sqrt(density), r, 0.2)) {
    const d = drifts.reduce((a, q) => (Math.hypot(q.p[0] - p[0], q.p[1] - p[1]) < Math.hypot(a.p[0] - p[0], a.p[1] - p[1]) ? q : a));
    const fr = PLANT[d.kind].r * 0.8;
    if (!P.occ.free(p[0], p[1], fr, 0.75)) continue;
    P.put(d.kind, p[0], b.y, p[1], r, { variant: d.variant, bloom: jitter(d.bloom, r), t: Math.min(1, 0.25 + 0.6 * depthAt(p) + r.range(-0.15, 0.15)) });
    P.occ.add(p[0], p[1], fr);
  }
}

/** a parterre: hedge round the edge (or one line down a strip), balls and cones on a grid, low flowers between */
function shrubBed(P: Planter, b: GardenBed, r: Rng, density: number) {
  const ax = axisOf(b.poly);
  const strip = ax.wid < 1.3;
  const hedgeAlong = (a: V2, c: V2, inset: number) => {
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (L < 0.9) return;
    const ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L;
    const n = Math.max(1, Math.round(L / 1.0));
    for (let k = 0; k < n; k++) {
      const s = (k + 0.5) * (L / n);
      for (const sgn of [1, -1]) {
        const p: V2 = [a[0] + ux * s - uz * inset * sgn, a[1] + uz * s + ux * inset * sgn];
        if (inset > 0 && !inside(p, b.poly)) continue;
        // (the segment's long axis along the edge: local +x to world (cos yaw, -sin yaw))
        P.put('hedge', p[0], b.y, p[1], r, { yaw: Math.atan2(-uz, ux) + r.range(-0.02, 0.02), variant: 0, t: 0.25, leaf: r.range(0.97, 1.03) });
        P.occ.add(p[0], p[1], 0.35);
        break;
      }
    }
  };
  if (strip) {
    hedgeAlong([ax.c[0] - ax.u[0] * ax.len / 2, ax.c[1] - ax.u[1] * ax.len / 2], [ax.c[0] + ax.u[0] * ax.len / 2, ax.c[1] + ax.u[1] * ax.len / 2], 0);
    return;
  }
  for (let i = 0; i < b.poly.length; i++) hedgeAlong(b.poly[i], b.poly[(i + 1) % b.poly.length], 0.35);
  // the corners: a clipped ball at each
  for (const q of b.poly) {
    const c: V2 = [ax.c[0] + (q[0] - ax.c[0]) * 0.9, ax.c[1] + (q[1] - ax.c[1]) * 0.9];
    const p: V2 = [q[0] + (c[0] - q[0]) * Math.min(1, 0.55 / Math.max(0.01, Math.hypot(c[0] - q[0], c[1] - q[1]))), q[1] + (c[1] - q[1]) * Math.min(1, 0.55 / Math.max(0.01, Math.hypot(c[0] - q[0], c[1] - q[1])))];
    if (inside(p, b.poly)) { P.put('boxball', p[0], b.y, p[1], r, { variant: 0, t: 0.55 }); P.occ.add(p[0], p[1], 0.5); }
  }
  // the grid of balls and cones down its middle, aligned with it
  const gap = 1.7 / Math.sqrt(density);
  for (let s = -ax.len / 2 + gap; s <= ax.len / 2 - gap * 0.7; s += gap) for (let t = -ax.wid / 2 + gap * 0.8; t <= ax.wid / 2 - gap * 0.6; t += gap) {
    const p: V2 = [ax.c[0] + ax.u[0] * s + ax.v[0] * t, ax.c[1] + ax.u[1] * s + ax.v[1] * t];
    if (!inside(p, b.poly) || edgeDist(p, b.poly) < 0.7 || !P.occ.free(p[0], p[1], 0.45)) continue;
    const k = Math.round(s / gap) + Math.round(t / gap);
    P.put('boxball', p[0], b.y, p[1], r, { variant: k % 3 === 0 ? 1 : 0, t: k % 3 === 0 ? 0.7 : 0.35 });
    P.occ.add(p[0], p[1], 0.45);
  }
  // low flowers between, in the bed's colour
  const bloom = bloomOf(b.palette ?? 'white', r);
  for (const p of darts(b.poly, 0.42 / Math.sqrt(density), r, 0.55)) {
    if (!P.occ.free(p[0], p[1], 0.16, 0.8)) continue;
    P.put(r.next() < 0.6 ? 'starflower' : 'tulip', p[0], b.y, p[1], r, { bloom: jitter(bloom, r) });
    P.occ.add(p[0], p[1], 0.16);
  }
}

/** trees down the bed (a quincunx), and what grows under them */
function treeBed(P: Planter, b: GardenBed, r: Rng, density: number, kinds: string[], gap: number, under: (p: V2, tree: V2 | null) => void): V2[] {
  const ax = axisOf(b.poly);
  const g = gap / Math.sqrt(Math.max(0.4, density));
  const trees: V2[] = [];
  const rows = Math.max(1, Math.floor(ax.wid / g) + 1);
  const n = Math.max(1, Math.floor(ax.len / g) + 1);
  for (let j = 0; j < rows; j++) for (let i = 0; i < n; i++) {
    const s = (n === 1 ? 0 : -ax.len / 2 + g * 0.5 + i * (ax.len - g) / Math.max(1, n - 1)) + ((j % 2) * g * 0.5) * (rows > 1 ? 1 : 0);
    const t = rows === 1 ? 0 : -ax.wid / 2 + g * 0.5 + j * (ax.wid - g) / Math.max(1, rows - 1);
    const p: V2 = [ax.c[0] + ax.u[0] * s + ax.v[0] * t + r.range(-0.3, 0.3), ax.c[1] + ax.u[1] * s + ax.v[1] * t + r.range(-0.3, 0.3)];
    const kind = r.pick(kinds);
    if (!inside(p, b.poly) || !P.occ.free(p[0], p[1], PLANT[kind].r, 0.8)) continue;
    P.put(kind, p[0], b.y, p[1], r, { bloom: kind === 'blossom' ? blossomBloom(b, r) : kind === 'pomegranate' ? hex(r.pick(SPECIES[SPECIES_ID.pomegranate].blooms!)) : undefined, t: r.range(0.3, 1) });
    P.occ.add(p[0], p[1], PLANT[kind].r * 0.6);
    trees.push(p);
  }
  for (const p of darts(b.poly, 0.5, r, 0.15)) under(p, trees.length ? trees.reduce((a, q) => (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(a[0] - p[0], a[1] - p[1]) ? q : a)) : null);
  return trees;
}
/** a blossom tree's bloom: the bed's family when it's white or pink, else either */
function blossomBloom(b: GardenBed, r: Rng): V3 {
  const pal = b.palette === 'white' ? BLOSSOM.white : b.palette === 'pink' ? BLOSSOM.pink : r.next() < 0.7 ? BLOSSOM.pink : BLOSSOM.white;
  return jitter(hex(r.pick(pal)), r, 0.04);
}

function cypressBed(P: Planter, b: GardenBed, r: Rng, density: number) {
  const ax = axisOf(b.poly);
  const g = 2.6 / Math.sqrt(Math.max(0.4, density));
  const n = Math.max(1, Math.floor(ax.len / g) + 1);
  const tall = r.range(0.4, 0.9);
  for (let i = 0; i < n; i++) {
    const s = n === 1 ? 0 : -ax.len / 2 + 0.6 + i * (ax.len - 1.2) / (n - 1);
    const p: V2 = [ax.c[0] + ax.u[0] * s, ax.c[1] + ax.u[1] * s];
    if (!inside(p, b.poly) || !P.occ.free(p[0], p[1], 0.5, 0.9)) continue;
    // (a row stands nearly level, a little ragged)
    P.put('cypress', p[0], b.y, p[1], r, { t: Math.min(1, Math.max(0, tall + r.range(-0.15, 0.15))) });
    P.occ.add(p[0], p[1], 0.55);
  }
}

function lotusBed(P: Planter, b: GardenBed, r: Rng, density: number) {
  const ax = axisOf(b.poly);
  // gathered toward the edges and the corners; the middle left open
  const weight = (p: V2) => {
    const d = edgeDist(p, b.poly);
    return Math.min(1, 0.15 + 1.1 * Math.max(0, 1 - d / Math.max(0.8, Math.min(1.8, ax.wid * 0.35)))) * density;
  };
  for (const p of darts(b.poly, 0.75, r, 0.4, weight)) {
    const u = r.next();
    P.put('lotus', p[0], b.y, p[1], r, { variant: u < 0.5 ? 0 : u < 0.85 ? 1 : 2, bloom: jitter(hex(r.pick(LOTUS)), r, 0.04), t: r.range(0.2, 1) });
  }
}

function palmBed(P: Planter, b: GardenBed, r: Rng, density: number) {
  treeBed(P, b, r, density, ['datepalm'], 7, (p, tree) => {
    if (tree && Math.hypot(tree[0] - p[0], tree[1] - p[1]) < 1.6 && r.next() < 0.5 && P.occ.free(p[0], p[1], 0.35, 0.8)) {
      P.put(r.next() < 0.5 ? 'agave' : 'bunchgrass', p[0], b.y, p[1], r);
      P.occ.add(p[0], p[1], 0.35);
    }
  });
}

function scrubBed(P: Planter, b: GardenBed, r: Rng, density: number) {
  for (const p of darts(b.poly, 0.9 / Math.sqrt(density), r, 0.3)) {
    const u = r.next();
    const kind = u < 0.45 ? 'scrub' : u < 0.8 ? 'bunchgrass' : 'agave';
    if (!P.occ.free(p[0], p[1], PLANT[kind].r, 0.9)) continue;
    P.put(kind, p[0], b.y, p[1], r);
    P.occ.add(p[0], p[1], PLANT[kind].r);
  }
}

// ------------------------------------------------------------------ vines
/** bougainvillea along walls' tops: clumps of one to three cascades with stretches of bare wall between, each cascade
 *  as deep as the wall lets it hang (and no deeper than its foot) */
export function vinesAlong(walls: WallLine[], heights: Heights, density = 0.7, seed = 1): FloraInstance[] {
  const out: FloraInstance[] = [];
  const id = SPECIES_ID.bougainvillea;
  for (const w of walls) {
    const r = rng(hash(...w.path.flat(), w.top, seed));
    const maxDrop = Math.max(0, (w.top - w.foot) * 0.88);
    if (maxDrop < 0.8) continue;
    for (let i = 1; i < w.path.length; i++) {
      const a = w.path[i - 1], c = w.path[i];
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (L < VINE_WIDTH * 0.7) continue;
      const ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L;
      // outward: the hanging side's normal (the right of the line is (-uz, ux) with z south)
      const nx = -uz * w.side, nz = ux * w.side;
      const yaw = Math.atan2(nx, nz);
      let s = VINE_WIDTH * 0.45 + r.range(0, 1.5) * (1 - density);
      while (s < L - VINE_WIDTH * 0.45) {
        const run = r.int(1, density > 0.6 ? 3 : 2);
        for (let k = 0; k < run && s < L - VINE_WIDTH * 0.45; k++) {
          const drop = maxDrop * r.range(0.45, 0.95);
          // the variant whose drop is nearest (never more than the wall allows), stretched the rest of the way
          let v = 0;
          for (let j = 0; j < VINE_DROPS.length; j++) if (VINE_DROPS[j] <= drop * 1.15) v = j;
          const scale = r.range(0.85, 1.1);
          const meshDrop = heights[id]?.[v] ?? VINE_DROPS[v];
          out.push({ x: a[0] + ux * s, y: w.top, z: a[1] + uz * s, yaw: yaw + r.range(-0.04, 0.04), scale, stretch: Math.min(1.35, Math.max(0.6, drop / (meshDrop * scale))), species: id, variant: v, bloom: jitter(hex(r.pick(BOUGAINVILLEA)), r, 0.05), leaf: r.range(0.92, 1.08) });
          s += VINE_WIDTH * r.range(0.55, 0.8) * scale;
        }
        s += r.range(0.6, 3.5) * (1.2 - density);
      }
    }
  }
  return out;
}

/** a 'vines' bed's wall: its strip's long middle line, at the bed's height; which side drops and how far, from the
 *  ground on either side (3 m down its right without a ground) */
function wallOfBed(b: GardenBed, ground?: (x: number, z: number) => number): WallLine {
  const ax = axisOf(b.poly);
  const a: V2 = [ax.c[0] - ax.u[0] * ax.len / 2, ax.c[1] - ax.u[1] * ax.len / 2], c: V2 = [ax.c[0] + ax.u[0] * ax.len / 2, ax.c[1] + ax.u[1] * ax.len / 2];
  if (!ground) return { path: [a, c], top: b.y, foot: b.y - 3, side: 1 };
  const off = ax.wid / 2 + 0.8;
  const right = ground(ax.c[0] - ax.u[1] * off, ax.c[1] + ax.u[0] * off), left = ground(ax.c[0] + ax.u[1] * off, ax.c[1] - ax.u[0] * off);
  return right <= left ? { path: [a, c], top: b.y, foot: right, side: 1 } : { path: [a, c], top: b.y, foot: left, side: -1 };
}

/** urns at given points (corners, stair heads, pool sides) */
export function urnsAt(points: V3[], heights: Heights, seed = 3): FloraInstance[] {
  const P = new Planter({ heights });
  points.forEach((q, i) => {
    const r = rng(hash(q[0], q[1], q[2], seed, i));
    P.put('urn', q[0], q[1], q[2], r, { variant: i % 3, bloom: hex(r.pick(SPECIES[SPECIES_ID.urn].blooms!)), t: r.range(0.3, 0.7) });
  });
  return P.out;
}

// ------------------------------------------------------------------ all the beds
/** every bed planted (big things first, across all beds, then the rest) */
export function scatterBeds(beds: GardenBed[], ctx: ScatterContext): FloraInstance[] {
  const P = new Planter(ctx);
  const full = ctx.fullness ?? 1;
  const walls = [...(ctx.walls ?? [])];
  const order: GardenBed['kind'][] = ['cypress', 'palms', 'blossom', 'trees', 'shrubs', 'vines', 'lotus', 'scrub', 'flowers', 'lawn'];
  const vineWalls: WallLine[] = [];
  // (each bed's box, so a lawn looks for the beds laid over it only among those that reach it)
  const box = new Map(beds.map((q) => [q, bbox(q.poly)]));
  const meets = (p: ReturnType<typeof bbox>, q: ReturnType<typeof bbox>) => p.x0 <= q.x1 && q.x0 <= p.x1 && p.z0 <= q.z1 && q.z0 <= p.z1;
  for (const kind of order) for (const b of beds.filter((q) => q.kind === kind)) {
    const r = rng(bedSeed(b));
    const d = Math.max(0.15, Math.min(1.5, b.density * full));
    switch (kind) {
      case 'lawn': lawnBed(P, b, r, d, beds.filter((q) => q.kind !== 'lawn' && Math.abs(q.y - b.y) < 0.5 && meets(box.get(q)!, box.get(b)!)).map((q) => q.poly)); break;
      case 'flowers': flowerBed(P, b, r, d, walls); break;
      case 'shrubs': shrubBed(P, b, r, d); break;
      case 'cypress': cypressBed(P, b, r, d); break;
      case 'lotus': lotusBed(P, b, r, d); break;
      case 'palms': palmBed(P, b, r, d); break;
      case 'scrub': scrubBed(P, b, r, d); break;
      case 'vines': vineWalls.push(wallOfBed(b, ctx.ground)); break;
      case 'trees':
        treeBed(P, b, r, d, ['olive', 'olive', 'pomegranate'], 4.8, (p, tree) => {
          const nearTree = tree && Math.hypot(tree[0] - p[0], tree[1] - p[1]) < 1.3;
          if (nearTree && r.next() < 0.35 && P.occ.free(p[0], p[1], 0.4, 0.8)) { P.put('boxball', p[0], b.y, p[1], r, { variant: 2, t: r.range(0, 0.4) }); P.occ.add(p[0], p[1], 0.4); }
          else if (!nearTree || r.next() < 0.5) lawnBed(P, { ...b, poly: square(p, 0.25) }, r, 1);
        });
        break;
      case 'blossom': {
        const bloom = b.palette === 'white' || b.palette === 'pink' ? b.palette : 'mixed';
        const ringBloom = bloomOf(bloom === 'mixed' ? 'white' : bloom === 'pink' ? 'white' : 'pink', r);
        const trees = treeBed(P, b, r, d, ['blossom'], 6.5, (p, tree) => {
          const dt = tree ? Math.hypot(tree[0] - p[0], tree[1] - p[1]) : 9;
          if (dt >= 1.55) lawnBed(P, { ...b, poly: square(p, 0.25) }, r, 1);
        });
        // a ring of low flowers round each trunk: cushions inside, daisies outside them
        for (const t of trees) for (const [rad, kind, gap] of [[0.75, 'starflower', 0.42], [1.2, 'daisy', 0.45]] as const) {
          const n = Math.round((2 * Math.PI * rad) / gap);
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2 + r.range(-0.08, 0.08);
            const p: V2 = [t[0] + Math.cos(a) * rad * r.range(0.95, 1.05), t[1] + Math.sin(a) * rad * r.range(0.95, 1.05)];
            if (!inside(p, b.poly)) continue;
            P.put(kind, p[0], b.y, p[1], r, { bloom: jitter(ringBloom, r), t: r.range(0.4, 0.9) });
          }
        }
        break;
      }
    }
  }
  return [...P.out, ...vinesAlong(vineWalls, ctx.heights, Math.min(1, beds.find((q) => q.kind === 'vines')?.density ?? 0.7))];
}
const square = (p: V2, h: number): V2[] => [[p[0] - h, p[1] - h], [p[0] + h, p[1] - h], [p[0] + h, p[1] + h], [p[0] - h, p[1] + h]];

// ------------------------------------------------------------------ the wild
/** the canyon's own plants over a region, by its ground: `sample` gives a point's height, slope (0 flat .. 1 sheer)
 *  and wetness (0..1, by the river), or null where nothing grows (paving, buildings, water). Scrub and bunchgrass on
 *  the flats and benches, agaves on the dry slopes and the rim, the grasses greener and thicker by the water; all in
 *  loose drifts (a noise field gathers them), thinning on steep ground. `density` ~ plants per 10 m² at best. */
export function scatterWild(region: { x0: number; z0: number; x1: number; z1: number }, sample: (x: number, z: number) => { y: number; slope: number; wet?: number } | null, heights: Heights, o: { density?: number; seed?: number } = {}): FloraInstance[] {
  const P = new Planter({ heights });
  const r = rng(hash(region.x0, region.z0, region.x1, region.z1, o.seed ?? 11));
  const dens = o.density ?? 1;
  const spacing = 1.6 / Math.sqrt(dens);
  // a cheap value noise for the drifts
  const vn = (x: number, z: number) => {
    const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
    const h = (i: number, j: number) => (hash(i, j, o.seed ?? 11) % 1000) / 1000;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    return (h(xi, zi) * (1 - sx) + h(xi + 1, zi) * sx) * (1 - sz) + (h(xi, zi + 1) * (1 - sx) + h(xi + 1, zi + 1) * sx) * sz;
  };
  const poly: V2[] = [[region.x0, region.z0], [region.x1, region.z0], [region.x1, region.z1], [region.x0, region.z1]];
  for (const p of darts(poly, spacing, r)) {
    const g = sample(p[0], p[1]);
    if (!g || g.slope > 0.75) continue;
    const drift = vn(p[0] / 14, p[1] / 14);
    const keep = (0.25 + 0.95 * drift) * (1 - g.slope * 1.1) + (g.wet ?? 0) * 0.5;
    if (r.next() > keep) continue;
    const u = r.next();
    const wet = g.wet ?? 0;
    const kind = g.slope > 0.35 ? (u < 0.55 ? 'agave' : u < 0.8 ? 'bunchgrass' : 'scrub') : wet > 0.4 ? (u < 0.75 ? 'bunchgrass' : 'scrub') : u < 0.45 ? 'scrub' : u < 0.85 ? 'bunchgrass' : 'agave';
    if (!P.occ.free(p[0], p[1], PLANT[kind].r, 0.9)) continue;
    P.put(kind, p[0], g.y - 0.03, p[1], r, { leaf: wet > 0.4 ? r.range(1.05, 1.2) : r.range(0.88, 1.05), t: Math.min(1, r.next() * (0.7 + 0.5 * drift)) });
    P.occ.add(p[0], p[1], PLANT[kind].r);
  }
  return P.out;
}

// ------------------------------------------------------------------ for the GPU
/** the instance record flora.wgsl reads (FloraInst, 32 bytes): pos xyz, yaw, scale, stretch, species | variant << 8,
 *  bloom rgb8 (sRGB) | leaf << 24 (leaf 0.5..1.5 as 0..255) */
export const INSTANCE_BYTES = 32;
export function packInstances(list: FloraInstance[]): ArrayBuffer {
  const buf = new ArrayBuffer(list.length * INSTANCE_BYTES);
  const f = new Float32Array(buf), u = new Uint32Array(buf);
  const enc = (x: number) => Math.round(Math.max(0, Math.min(1, x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)) * 255);
  list.forEach((p, i) => {
    const o = i * 8;
    f[o] = p.x; f[o + 1] = p.y; f[o + 2] = p.z; f[o + 3] = p.yaw; f[o + 4] = p.scale; f[o + 5] = p.stretch;
    u[o + 6] = (p.species & 255) | ((p.variant & 255) << 8);
    u[o + 7] = (enc(p.bloom[0]) | (enc(p.bloom[1]) << 8) | (enc(p.bloom[2]) << 16) | (Math.round(Math.max(0, Math.min(1, p.leaf - 0.5)) * 255) << 24)) >>> 0;
  });
  return buf;
}

/** how many of each species a list has (for the reports) */
export function census(list: FloraInstance[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of list) { const n = SPECIES[p.species].name; out[n] = (out[n] ?? 0) + 1; }
  return out;
}

/** the mesh heights of grown species (for the scatter's scales) */
export function meshHeights(grown: { def: { name: string }; variants: { height: number }[][] }[]): Heights {
  const h: Heights = SPECIES.map(() => []);
  for (const g of grown) h[SPECIES_ID[g.def.name]] = g.variants.map((v) => v[0].height);
  return h;
}
