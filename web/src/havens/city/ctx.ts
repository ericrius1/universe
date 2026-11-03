// What the city's builders share while they work: the one ArchBuilder the whole city's mesh grows in, and the lists the
// city hands over beside it (colliders, lights, water, beds). Collide gathers one structure's walkable boxes in the frame
// its geometry was laid in — plan x and y are the frame's local x and z, heights are above its origin — and turns them
// into a StructureCollider (boulder's HouseCollision) with that frame's origin and yaw.
import { ArchBuilder } from '../arch/builder';
import type { GardenBed, LightSpot, StructureCollider, V3, WaterBody } from '../arch/types';
import type { V2 } from '../world/layout';

/** warm lantern light and firelight (linear rgb) */
const LANTERN: V3 = [1.0, 0.58, 0.26];
export const FIRE: V3 = [1.0, 0.46, 0.16];

export class City {
  readonly b = new ArchBuilder();
  readonly colliders: StructureCollider[] = [];
  readonly lights: LightSpot[] = [];
  readonly water: WaterBody[] = [];
  readonly beds: GardenBed[] = [];
  /** the colliders begun and not yet sealed */
  private pending: Collide[] = [];

  /** a light at a local point of the builder's current frame */
  light(p: V3, candela: number, o: { color?: V3; when?: LightSpot['when']; radius?: number } = {}) {
    this.lights.push({ p: this.b.xf(p), color: o.color ?? LANTERN, candela, when: o.when ?? 'night', radius: o.radius });
  }
  /** a bed at local plan points of the builder's current frame, at local height y */
  bed(poly: V2[], y: number, kind: GardenBed['kind'], density: number, palette?: GardenBed['palette']) {
    const w = poly.map(([x, z]) => { const p = this.b.xf([x, y, z]); return [p[0], p[2]] as V2; });
    this.beds.push({ poly: w, y: this.b.xf([0, y, 0])[1], kind, density, ...(palette ? { palette } : {}) });
  }
  /** a pool at local plan points (its water level and depth in the local frame) */
  pool(poly: V2[], level: number, depth: number) {
    const w = poly.map(([x, z]) => { const p = this.b.xf([x, level, z]); return [p[0], p[2]] as V2; });
    this.water.push({ kind: 'pool', poly: w, level: this.b.xf([0, level, 0])[1], depth });
  }
  /** a collider in the builder's current frame */
  collide(name: string): Collide {
    const o = this.b.xf([0, 0, 0]), d = this.b.xd([1, 0, 0]);
    const c = new Collide(name, o, Math.atan2(-d[2], d[0]));
    this.pending.push(c);
    return c;
  }
  /** close every collider that has boxes into the list */
  sealColliders() {
    for (const c of this.pending) if (c.size) this.colliders.push(c.done());
    this.pending = [];
  }
}

/** one structure's walkable boxes, in its frame (plan x, y = local x, z; heights above the frame's origin) */
export class Collide {
  private solids: number[][] = [];
  private floors: number[][] = [];
  private stairs: number[][] = [];
  private doors: number[][] = [];

  constructor(readonly name: string, readonly origin: V3, readonly yaw: number) {}

  get size() { return this.solids.length + this.floors.length + this.stairs.length; }

  /** a solid box: plan rectangle (x0, z0)-(x1, z1), heights y0..y1 */
  solid(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number) {
    this.solids.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), y0, y1].map(r3));
    return this;
  }
  /** a floor to stand on (open: under the sky, flight allowed) */
  floor(x0: number, z0: number, x1: number, z1: number, h: number, open = true) {
    this.floors.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), h, open ? 1 : 0].map(r3));
    return this;
  }
  /** a flight of stairs over a plan rectangle rising `rise` from `base` along x (axis 0) or z (axis 1), toward +
   *  (sign 1) or - (sign -1) */
  stair(x0: number, z0: number, x1: number, z1: number, base: number, rise: number, axis: 0 | 1, sign: 1 | -1) {
    this.stairs.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), base, rise, axis, sign].map(r3));
    return this;
  }
  door(x0: number, z0: number, x1: number, z1: number, h: number) {
    this.doors.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), h].map(r3));
    return this;
  }
  /** a box laid in another frame (the builder's current one: an arch over an alley, a lamp post turned to its road) as
   *  this collider's box round it: its corners through `b` to the world, then into this one's frame (exact where the
   *  two frames are square to each other, a little bigger where they aren't) */
  solidIn(b: ArchBuilder, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number) {
    const r = this.boxIn(b, x0, z0, x1, z1, y0, y1);
    return this.solid(r[0], r[1], r[2], r[3], r[4], r[5]);
  }
  floorIn(b: ArchBuilder, x0: number, z0: number, x1: number, z1: number, h: number) {
    const r = this.boxIn(b, x0, z0, x1, z1, h, h);
    return this.floor(r[0], r[1], r[2], r[3], r[4]);
  }
  private boxIn(b: ArchBuilder, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number): number[] {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw), [ox, oy, oz] = this.origin;
    const r = [Infinity, Infinity, -Infinity, -Infinity, Infinity, -Infinity];
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
      const w0 = b.xf([x, y0, z]), w1 = b.xf([x, y1, z]), dx = w0[0] - ox, dz = w0[2] - oz;
      // (world -> this frame: the inverse of ArchBuilder's turn)
      const lx = c * dx - s * dz, lz = s * dx + c * dz;
      r[0] = Math.min(r[0], lx); r[1] = Math.min(r[1], lz); r[2] = Math.max(r[2], lx); r[3] = Math.max(r[3], lz);
      r[4] = Math.min(r[4], w0[1] - oy); r[5] = Math.max(r[5], w1[1] - oy);
    }
    return r;
  }
  /** a convex plan polygon as boxes: one where its sides are square to the frame, strips (≤ step wide, each as tall as
   *  the polygon at its middle) where they slant */
  polySolid(p: V2[], y0: number, y1: number, step = 1.5) { for (const r of rects(p, step)) this.solid(r[0], r[1], r[2], r[3], y0, y1); return this; }
  polyFloor(p: V2[], h: number, step = 1.5) { for (const r of rects(p, step)) this.floor(r[0], r[1], r[2], r[3], h); return this; }

  done(): StructureCollider {
    return {
      name: this.name, origin: this.origin.map(r3) as V3, yaw: this.yaw,
      collision: { solids: this.solids, floors: this.floors, stairs: this.stairs, doors: this.doors },
    };
  }
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** a convex polygon as plan rectangles [x0, z0, x1, z1]: strips across x between its corners, split finer where its
 *  top or bottom slants */
function rects(p: V2[], step: number): number[][] {
  const xs = [...new Set(p.map(([x]) => Math.round(x * 1000) / 1000))].sort((a, b) => a - b);
  const out: number[][] = [];
  const span = (x: number): [number, number] | null => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      if ((a[0] - x) * (b[0] - x) > 0) continue;
      if (Math.abs(b[0] - a[0]) < 1e-9) { lo = Math.min(lo, a[1], b[1]); hi = Math.max(hi, a[1], b[1]); continue; }
      const z = a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
      lo = Math.min(lo, z); hi = Math.max(hi, z);
    }
    return lo < hi ? [lo, hi] : null;
  };
  for (let i = 0; i < xs.length - 1; i++) {
    const xa = xs[i], xb = xs[i + 1];
    if (xb - xa < 0.05) continue;
    const e = 0.001;
    const sa = span(xa + e), sb = span(xb - e);
    if (!sa || !sb) continue;
    const flat = Math.abs(sa[0] - sb[0]) < 0.02 && Math.abs(sa[1] - sb[1]) < 0.02;
    const n = flat ? 1 : Math.max(1, Math.ceil((xb - xa) / step));
    for (let k = 0; k < n; k++) {
      const x0 = xa + ((xb - xa) * k) / n, x1 = xa + ((xb - xa) * (k + 1)) / n;
      const s = span((x0 + x1) / 2);
      if (s && s[1] - s[0] > 0.05) out.push([x0, s[0], x1, s[1]]);
    }
  }
  return out;
}

/** a collider's world bounds [x0, y0, z0, x1, y1, z1] (its boxes, floors and stairs through its frame): for a
 *  broadphase before asking a HouseCollider anything */
export function colliderBounds(sc: StructureCollider): [number, number, number, number, number, number] {
  const c = Math.cos(sc.yaw), s = Math.sin(sc.yaw), [ox, oy, oz] = sc.origin;
  const b: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const add = (px: number, py: number, h0: number, h1: number) => {
    const x = ox + c * px + s * py, z = oz - s * px + c * py;
    b[0] = Math.min(b[0], x); b[2] = Math.min(b[2], z); b[3] = Math.max(b[3], x); b[5] = Math.max(b[5], z);
    b[1] = Math.min(b[1], oy + h0); b[4] = Math.max(b[4], oy + h1);
  };
  const { solids, floors, stairs } = sc.collision;
  for (const r of solids) for (const [px, py] of [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]) add(px, py, r[4], r[5]);
  for (const r of floors) for (const [px, py] of [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]) add(px, py, r[4], r[4]);
  for (const r of stairs) for (const [px, py] of [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]) add(px, py, r[4], r[4] + r[5]);
  return b;
}
