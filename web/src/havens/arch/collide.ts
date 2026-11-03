// What every structure the builders hand over is walked and bumped as (types.ts StructureCollider: boulder's
// HouseCollision in the structure's own plan, with its origin and yaw), as one set: each turned into a HouseCollider
// with its plan -> world map, bucketed on a grid by its world footprint, so the player's world (hero/world.ts
// moreNear) asks only the few near where she is — a few thousand structures cost no more per frame than one. And a
// ray against them all (the solids, the floors, the stairs' treads): where it first hits and the face's normal there,
// for what lands on walls and floors (Iroh's fire, its scorch marks).
import { HouseCollider } from '../house/collider';
import { CellGrid } from '../util/cellgrid';
import type { StructureCollider, V3 } from './types';

/** the grid's cell (m): a structure is listed in every cell its footprint touches */
const CELL = 16;
/** a floor's (and a doorway's sill's) thickness to a ray (m) */
const SLAB = 0.1;

export interface RayHit {
  /** where (world), the face's outward normal there, how far along the ray (m) */
  p: V3;
  n: V3;
  t: number;
  /** the structure hit, and what of it */
  structure: string;
  kind: 'solid' | 'floor' | 'stair' | 'door';
}

/** a structure's plan -> world map as HouseCollider takes it (column-major 4x4): plan (x, h, y) goes to world
 *  origin + (cos·x + sin·y, h, -sin·x + cos·y), ArchBuilder.at's turn by the yaw */
export function planToWorld(sc: StructureCollider): number[] {
  const c = Math.cos(sc.yaw), s = Math.sin(sc.yaw);
  const [ox, oy, oz] = sc.origin;
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, ox, oy, oz, 1];
}

export class CollisionSet {
  readonly colliders: HouseCollider[] = [];
  readonly structures: StructureCollider[] = [];
  /** each collider's world bounds: x0, z0, x1, z1, y0, y1 */
  private bounds = new Float64Array(0);
  private grid: CellGrid | null = null;
  /** (which colliders a query has already met: a stamp per collider, the query's own) */
  private stamp = new Uint32Array(0);
  private gen = 0;
  private found: HouseCollider[] = [];

  get size() { return this.colliders.length; }

  /** more structures (a part's): walkable from now on */
  add(list: StructureCollider[]) {
    if (!list.length) return;
    const n0 = this.colliders.length, n = n0 + list.length;
    const b = new Float64Array(n * 6);
    b.set(this.bounds);
    list.forEach((sc, k) => {
      this.structures.push(sc);
      this.colliders.push(new HouseCollider(sc.collision, planToWorld(sc)));
      worldBounds(sc, b, (n0 + k) * 6);
    });
    this.bounds = b;
    this.stamp = new Uint32Array(n);
    this.gen = 0;
    this.grid = CellGrid.boxes(CELL, n, (i, out) => { out[0] = b[i * 6]; out[1] = b[i * 6 + 1]; out[2] = b[i * 6 + 2]; out[3] = b[i * 6 + 3]; });
  }

  /** a fresh stamp for a query (every collider unmet) */
  private fresh() {
    if (++this.gen === 0xffffffff) { this.stamp.fill(0); this.gen = 1; }
    return this.gen;
  }

  /** the structures whose footprints come within r of (x, z). The array is reused by the next query: walk it before
   *  asking again */
  near(x: number, z: number, r: number): readonly HouseCollider[] {
    const out = this.found;
    out.length = 0;
    const g = this.grid;
    if (!g) return out;
    const gen = this.fresh(), B = this.bounds, S = this.stamp;
    const cx0 = Math.floor((x - r) / CELL), cx1 = Math.floor((x + r) / CELL), cz0 = Math.floor((z - r) / CELL), cz1 = Math.floor((z + r) / CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      for (let k = g.at(cx, cz), e = g.end; k < e; k++) {
        const i = g.items[k];
        if (S[i] === gen) continue;
        S[i] = gen;
        const o = i * 6;
        if (B[o] > x + r || B[o + 2] < x - r || B[o + 1] > z + r || B[o + 3] < z - r) continue;
        out.push(this.colliders[i]);
      }
    }
    return out;
  }

  /** the first solid, floor, doorway or stair a ray meets within `max` m: where, the face's normal, the structure.
   *  The grid's cells are walked along the ray in order, so it stops as soon as a hit is nearer than the next cell */
  raycast(o: V3, dir: V3, max = 200): RayHit | null {
    const g = this.grid;
    const dl = Math.hypot(dir[0], dir[1], dir[2]);
    if (!g || dl < 1e-9) return null;
    const d: V3 = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
    const gen = this.fresh(), S = this.stamp, B = this.bounds;
    let best: RayHit | null = null, bestT = max;
    const test = (cx: number, cz: number) => {
      for (let k = g.at(cx, cz), e = g.end; k < e; k++) {
        const i = g.items[k];
        if (S[i] === gen) continue;
        S[i] = gen;
        // (its bounds first: the box of its footprint and heights)
        const ob = i * 6;
        if (slab(o, d, B[ob], B[ob + 4], B[ob + 1], B[ob + 2], B[ob + 5], B[ob + 3], bestT) < 0) continue;
        const h = this.hitOne(i, o, d, bestT);
        if (h) { best = h; bestT = h.t; }
      }
    };
    // the cells along the ray's way over the plan (Amanatides & Woo), each entered at tc
    let cx = Math.floor(o[0] / CELL), cz = Math.floor(o[2] / CELL);
    const sx = d[0] > 0 ? 1 : -1, sz = d[2] > 0 ? 1 : -1;
    const ax = Math.abs(d[0]) > 1e-9, az = Math.abs(d[2]) > 1e-9;
    let tx = ax ? ((sx > 0 ? (cx + 1) * CELL : cx * CELL) - o[0]) / d[0] : Infinity;
    let tz = az ? ((sz > 0 ? (cz + 1) * CELL : cz * CELL) - o[2]) / d[2] : Infinity;
    const dx = ax ? CELL / Math.abs(d[0]) : Infinity, dz = az ? CELL / Math.abs(d[2]) : Infinity;
    let tc = 0;
    for (let guard = 0; guard < 100000 && tc <= bestT; guard++) {
      test(cx, cz);
      if (tx < tz) { tc = tx; tx += dx; cx += sx; } else { tc = tz; tz += dz; cz += sz; }
      if (!ax && !az) break;
    }
    return best;
  }

  /** a ray against one structure's boxes, in its plan: the nearest hit before tMax */
  private hitOne(i: number, o: V3, d: V3, tMax: number): RayHit | null {
    const h = this.colliders[i], sc = this.structures[i];
    const P = h.toPlan(o[0], o[1], o[2]);
    const Q = h.toPlan(o[0] + d[0], o[1] + d[1], o[2] + d[2]);
    const D: V3 = [Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]];
    const c = sc.collision;
    let best = tMax, kind: RayHit['kind'] = 'solid', axis = -1, sign = 0, nPlan: V3 | null = null;
    const box = (x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, k: RayHit['kind']) => {
      // (plan axes: x, height, y)
      const t = slabAxis(P, D, x0, z0, y0, x1, z1, y1, best);
      if (t !== null && t[0] < best) { best = t[0]; axis = t[1]; sign = t[2]; kind = k; nPlan = null; }
    };
    for (const s of c.solids) box(s[0], s[1], s[2], s[3], s[4], s[5], 'solid');
    for (const f of c.floors) box(f[0], f[1], f[2], f[3], f[4] - SLAB, f[4], 'floor');
    for (const f of c.doors) box(f[0], f[1], f[2], f[3], f[4] - SLAB, f[4], 'door');
    for (const st of c.stairs) {
      // the treads as the ramp over their rectangle: h = base + rise · u, u along the axis toward the top
      const [x0, y0, x1, y1, b0, rise, ax, sg] = st;
      const lo = ax ? y0 : x0, hi = ax ? y1 : x1, run = Math.max(hi - lo, 1e-6);
      const k = (sg > 0 ? rise : -rise) / run;
      // the plane: h - b0 - rise·u(v) = 0 with u = (v - lo)/run (sign > 0) or (hi - v)/run
      const base = sg > 0 ? b0 - k * lo : b0 - k * hi;
      const pv = ax ? P[2] : P[0], dv = ax ? D[2] : D[0];
      const den = D[1] - k * dv;
      if (Math.abs(den) < 1e-9) continue;
      const t = (base + k * pv - P[1]) / den;
      if (t < 0 || t >= best) continue;
      const hx = P[0] + D[0] * t, hy = P[2] + D[2] * t;
      if (hx < x0 || hx > x1 || hy < y0 || hy > y1) continue;
      best = t; kind = 'stair'; axis = -1;
      const nl = Math.hypot(k, 1);
      nPlan = ax ? [0, 1 / nl, -k / nl] : [-k / nl, 1 / nl, 0];
      // (seen from below, the underside)
      if (D[1] * nPlan[1] + D[0] * nPlan[0] + D[2] * nPlan[2] > 0) nPlan = [-nPlan[0], -nPlan[1], -nPlan[2]];
    }
    if (best >= tMax) return null;
    let n: V3;
    if (nPlan) n = nPlan;
    else { n = [0, 0, 0]; n[axis] = sign; }
    // plan (x, h, y) -> world: the yaw's turn
    const cy = Math.cos(sc.yaw), sy = Math.sin(sc.yaw);
    const nw: V3 = [cy * n[0] + sy * n[2], n[1], -sy * n[0] + cy * n[2]];
    return { p: [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best], n: nw, t: best, structure: sc.name, kind };
  }
}

/** a structure's world bounds (x0, z0, x1, z1, y0, y1) into b at o: its boxes' plan extent, turned */
function worldBounds(sc: StructureCollider, b: Float64Array, o: number) {
  const c = sc.collision;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, h0 = Infinity, h1 = -Infinity;
  const rect = (r: number[], lo: number, hi: number) => {
    x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]); x1 = Math.max(x1, r[2]); y1 = Math.max(y1, r[3]);
    h0 = Math.min(h0, lo); h1 = Math.max(h1, hi);
  };
  for (const s of c.solids) rect(s, s[4], s[5]);
  for (const f of c.floors) rect(f, f[4] - SLAB, f[4]);
  for (const f of c.doors) rect(f, f[4] - SLAB, f[4]);
  for (const s of c.stairs) rect(s, Math.min(s[4], s[4] + s[5]), Math.max(s[4], s[4] + s[5]));
  if (x0 === Infinity) { b.set([sc.origin[0], sc.origin[2], sc.origin[0], sc.origin[2], sc.origin[1], sc.origin[1]], o); return; }
  const cy = Math.cos(sc.yaw), sy = Math.sin(sc.yaw);
  let wx0 = Infinity, wz0 = Infinity, wx1 = -Infinity, wz1 = -Infinity;
  for (const [px, py] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    const wx = sc.origin[0] + cy * px + sy * py, wz = sc.origin[2] - sy * px + cy * py;
    wx0 = Math.min(wx0, wx); wx1 = Math.max(wx1, wx); wz0 = Math.min(wz0, wz); wz1 = Math.max(wz1, wz);
  }
  b.set([wx0, wz0, wx1, wz1, sc.origin[1] + h0, sc.origin[1] + h1], o);
}

/** where a ray (o + t·d) enters an axis-aligned box (lo x, y, z .. hi x, y, z) within [0, tMax], or -1 */
function slab(o: V3, d: V3, lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, tMax: number) {
  let t0 = 0, t1 = tMax;
  const lo = [lx, ly, lz], hi = [hx, hy, hz];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) { if (o[k] < lo[k] || o[k] > hi[k]) return -1; continue; }
    let a = (lo[k] - o[k]) / d[k], b = (hi[k] - o[k]) / d[k];
    if (a > b) { const s = a; a = b; b = s; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return -1;
  }
  return t0;
}

/** where a ray enters a box (plan: lo x, h, y .. hi x, h, y) from outside within tMax, and through which face: [t, axis,
 *  the face normal's sign along it]; null if it misses (or starts inside it) */
function slabAxis(o: V3, d: V3, lx: number, lh: number, ly: number, hx: number, hh: number, hy: number, tMax: number): [number, number, number] | null {
  let t0 = -Infinity, t1 = tMax, axis = -1, sign = 0;
  const lo = [lx, lh, ly], hi = [hx, hh, hy];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) { if (o[k] < lo[k] || o[k] > hi[k]) return null; continue; }
    const a = (lo[k] - o[k]) / d[k], b = (hi[k] - o[k]) / d[k];
    const near = Math.min(a, b), far = Math.max(a, b);
    if (near > t0) { t0 = near; axis = k; sign = d[k] > 0 ? -1 : 1; }
    t1 = Math.min(t1, far);
    if (t0 > t1) return null;
  }
  return t0 >= 0 && axis >= 0 ? [t0, axis, sign] : null;
}
