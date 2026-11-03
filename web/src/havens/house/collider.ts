// Walking inside the house: its floors, stair ramps and doorways are the ground (not the terrain — the lower storey is
// dug into the slope), its wall and window boxes are solid, and so is the furniture (interior.ts gives each piece's
// footprint). Everything is tested in plan feet (pipeline/house.py exports the boxes and the plan -> world map), where
// the walls are axis-aligned: the body is a circle there, moved in short steps and pushed out of every box it overlaps
// after each, so it slides along walls and rounds door jambs and table corners instead of catching on them. A stair is
// a ramp to stand on and, where it's higher than a step, a block to walk round.
import type { V3 } from '@ericrius1/weft';

export interface HouseCollision {
  /** wall and window boxes [x0, y0, x1, y1, z0, z1] (plan ft; z = height above the main floor, ft) */
  solids: number[][];
  /** walkable floors [x0, y0, x1, y1, h] */
  floors: number[][];
  /** stairs [x0, y0, x1, y1, base, rise, axis (0 x / 1 y), sign] */
  stairs: number[][];
  /** doorways out: the sill and an apron [x0, y0, x1, y1, h] */
  doors: number[][];
}

/** the body: its radius, the step it climbs without noticing (a wall's foot, a sill), its height (m) */
const RADIUS = 0.25, STEP = 0.35, HEIGHT = 1.85;
/** furniture lower than this is walked over (a rug, a bath mat) */
const PROP_STEP = 0.1;
/** how far the feet reach from the body's centre (m), for the floor under them */
const FEET = 0.12;

export class HouseCollider {
  private A: number[];      // plan -> world (column-major 3x3) and its translation
  private b: V3;
  private inv: number[];    // world -> plan
  /** metres per plan foot, horizontally and vertically */
  readonly kh: number;
  readonly kv: number;
  /** the walls' boxes with their height bands merged (a wall's pieces between window sills and heads are one box) */
  private walls: number[][];
  /** the furniture's footprints [x0, y0, x1, y1, z0, z1] (plan ft, as the solids) */
  props: number[][] = [];
  /** the doors' leaves and the sliders' panels where they stand now (home/doors.ts keeps it current): solid as walls */
  moving: number[][] = [];
  /** each stair: 1 out under the sky (down a deck to a terrace, off the terrace to the meadow), 0 in a stairwell (its
   *  middle over a storey's floor) */
  private stairOpen: number[];

  constructor(readonly c: HouseCollision, planToWorld: number[], readonly levels: Record<string, { height: number; ceiling: number }> = {}) {
    const m = planToWorld;
    this.A = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
    this.b = [m[12], m[13], m[14]];
    const [a, b, c2, d, e, f, g, h, i] = this.A;   // columns: (a b c) (d e f) (g h i)
    // inverse of the 3x3 with columns c0 = (a, b, c2), c1 = (d, e, f), c2 = (g, h, i)
    const det = a * (e * i - h * f) - d * (b * i - h * c2) + g * (b * f - e * c2);
    this.inv = [
      (e * i - h * f) / det, -(b * i - h * c2) / det, (b * f - e * c2) / det,
      -(d * i - g * f) / det, (a * i - g * c2) / det, -(a * f - d * c2) / det,
      (d * h - g * e) / det, -(a * h - g * b) / det, (a * e - d * b) / det,
    ];
    // (`inv` is the inverse, column-major)
    this.kh = Math.hypot(m[0], m[2]);
    this.kv = m[5];
    this.walls = mergeBands(c.solids);
    this.stairOpen = c.stairs.map(([x0, y0, x1, y1]) => {
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      return c.floors.some((f) => !f[5] && mx >= f[0] && mx <= f[2] && my >= f[1] && my <= f[3]) ? 0 : 1;
    });
  }

  /** world -> plan (x ft, height ft above the main floor, y ft) */
  toPlan(x: number, y: number, z: number): V3 {
    const p = [x - this.b[0], y - this.b[1], z - this.b[2]];
    const n = this.inv;
    return [n[0] * p[0] + n[3] * p[1] + n[6] * p[2], n[1] * p[0] + n[4] * p[1] + n[7] * p[2], n[2] * p[0] + n[5] * p[1] + n[8] * p[2]];
  }

  /** plan -> world */
  toWorld(px: number, h: number, py: number): V3 {
    const A = this.A;
    return [A[0] * px + A[3] * h + A[6] * py + this.b[0], A[1] * px + A[4] * h + A[7] * py + this.b[1], A[2] * px + A[5] * h + A[8] * py + this.b[2]];
  }

  /** the walkable heights (plan ft) under a plan point: floors, doorways, stair ramps; `kind` 0 floor, 1 door, 2 stair;
   *  the third number 1 where it's open to the sky (a terrace, a deck, the roof, an outdoor stair) */
  private surfaces(px: number, py: number): [number, number, number][] {
    const out: [number, number, number][] = [];
    for (const f of this.c.floors) if (px >= f[0] && px <= f[2] && py >= f[1] && py <= f[3]) out.push([f[4], 0, f[5] ?? 0]);
    for (const f of this.c.doors) if (px >= f[0] && px <= f[2] && py >= f[1] && py <= f[3]) out.push([f[4], 1, 0]);
    this.c.stairs.forEach((s, i) => {
      const [x0, y0, x1, y1, b0, rise, axis, sign] = s;
      if (px < x0 || px > x1 || py < y0 || py > y1) return;
      const lo = axis ? y0 : x0, hi = axis ? y1 : x1, v = axis ? py : px;
      const t = Math.min(1, Math.max(0, sign > 0 ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo)));
      out.push([b0 + rise * t, 2, this.stairOpen[i]]);
    });
    return out;
  }

  /** the surface under feet at plan height h (the highest within a step above them), or null */
  private standing(px: number, py: number, h: number, step: number): [number, number, number] | null {
    let top: [number, number, number] | null = null;
    for (const s of this.surfaces(px, py)) if (s[0] <= h + step / this.kv && (!top || s[0] > top[0])) top = s;
    return top;
  }

  /** the world height of the floor under the feet (within a step of them), or null outside the house: the highest
   *  under the feet's spread (a hand's width round the centre), so a sliver between a stair and a floor isn't a hole */
  floorAt(x: number, z: number, feetY: number, step = 0.45): number | null {
    const [px, h, py] = this.toPlan(x, feetY, z);
    const e = FEET / this.kh;
    let top: [number, number, number] | null = null;
    for (const [dx, dy] of [[0, 0], [e, 0], [-e, 0], [0, e], [0, -e]]) {
      const s = this.standing(px + dx, py + dy, h, step);
      if (s && (!top || s[0] > top[0])) top = s;
    }
    // (a floor far below — the storey under a hole — still counts: you fall to it)
    return top ? this.toWorld(px, top[0], py)[1] : null;
  }

  /** the highest floor open to the sky (a terrace, a deck, a flat roof) under a point at height y (world), or null:
   *  what a paraglider can land on */
  openFloorAt(x: number, z: number, y: number): number | null {
    const [px, h, py] = this.toPlan(x, y, z);
    let top: number | null = null;
    for (const s of this.surfaces(px, py)) if (s[1] === 0 && s[2] === 1 && s[0] <= h + 0.3 / this.kv && (top === null || s[0] > top)) top = s[0];
    return top === null ? null : this.toWorld(px, top, py)[1];
  }

  /** the world height of the ceiling over someone here, feet at feetY — standing, or in the air over the floor they
   *  jumped from (null where nothing's overhead): the storey's ceiling over its floor (the top storey's over a stair),
   *  and anywhere — a stair's foot, a deck, a doorway, under the eaves — no higher than the underside of a floor, a
   *  roof or a flight of stairs over the head */
  ceilingAt(x: number, z: number, feetY: number): number | null {
    const [px, h, py] = this.toPlan(x, feetY, z);
    const lim = h + 0.45 / this.kv;
    const all = this.surfaces(px, py);
    let ceil = this.storeyCeiling(h, all);
    // the floors and flights overhead are slabs (a jump never rises through one onto the storey above)
    for (const s of all) {
      if (s[0] <= lim || s[1] === 1) continue;
      const u = this.underside(s[0], s[1] === 2);
      if (u > h && (ceil === null || u < ceil)) ceil = u;
    }
    return ceil === null ? null : this.toWorld(px, ceil, py)[1];
  }

  /** in a room: feet (standing, or in the air over the floor they jumped from) over a storey's floor or a stairwell's
   *  flight, under that storey's ceiling. Not on a terrace, a deck, the roof, an outdoor stair or in a doorway, whatever
   *  hangs over them there (a deck above, the eaves): flight is for anywhere but in here */
  indoors(x: number, z: number, feetY: number): boolean {
    const [px, h, py] = this.toPlan(x, feetY, z);
    return this.storeyCeiling(h, this.surfaces(px, py)) !== null;
  }

  /** the ceiling (plan ft) of the storey whose floor is under feet at plan height h, or null out under the sky */
  private storeyCeiling(h: number, all: [number, number, number][]): number | null {
    const ls = Object.values(this.levels);
    // the surface under the feet, however far below (mid-jump it's still the floor they left)
    let top: [number, number, number] | null = null;
    for (const s of all) if (s[0] <= h + 0.45 / this.kv && (!top || s[0] > top[0])) top = s;
    // (nothing overhead on a terrace, a deck, the roof or an outdoor stair, though one lies level with a storey's floor)
    if (!top || !ls.length || top[1] === 1 || top[2] === 1) return null;
    let ceil: number | null = null;
    if (top[1] === 2) ceil = Math.max(...ls.map((l) => l.height + l.ceiling));
    else {
      const level = ls.find((l) => Math.abs(l.height - top![0]) < 0.6);
      if (level) ceil = level.height + level.ceiling;   // (else a roof or a deck: open sky)
    }
    // (feet above it are over that storey — on its roof, the terrain over the dug-in one — not in it)
    return ceil !== null && h > ceil ? null : ceil;
  }

  /** the underside of a walkable surface at plan height s: of a floor, the ceiling of the storey under it where one
   *  ends just below it (else a foot under it); of a stair's flight, a foot under its treads */
  private underside(s: number, stair: boolean): number {
    if (stair) return s - 1;
    let u: number | null = null;
    for (const l of Object.values(this.levels)) {
      const c = l.height + l.ceiling;
      if (c <= s + 0.05 && c > s - 2.5 && (u === null || c > u)) u = c;
    }
    return u ?? s - 1;
  }

  /** does a door's leaf or a slider's panel, where it stands now, cross the line between two world points? (Lines of
   *  sight: the interior's voxels have the walls but not these.) */
  sightBlocked(a: V3, b: V3): boolean {
    if (!this.moving.length) return false;
    const p = this.toPlan(a[0], a[1], a[2]), q = this.toPlan(b[0], b[1], b[2]);
    const v = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    for (const s of this.moving) {
      let t0 = 0, t1 = 1;
      for (const [k, lo, hi] of [[0, s[0], s[2]], [2, s[1], s[3]], [1, s[4], s[5]]]) {
        if (Math.abs(v[k]) < 1e-9) { if (p[k] < lo || p[k] > hi) t0 = 2; continue; }
        const u0 = (lo - p[k]) / v[k], u1 = (hi - p[k]) / v[k];
        t0 = Math.max(t0, Math.min(u0, u1));
        t1 = Math.min(t1, Math.max(u0, u1));
      }
      if (t0 <= t1) return true;
    }
    return false;
  }

  /** the boxes a body standing at plan height h meets within `reach` (plan ft) of a plan point: walls above its step,
   *  furniture above the ankle, anything below the top of its head */
  private near(px: number, py: number, h: number, reach: number): number[][] {
    const lo = h + STEP / this.kv, loProp = h + PROP_STEP / this.kv, hi = h + HEIGHT / this.kv;
    const out: number[][] = [];
    const add = (s: number[], bottom: number) => {
      if (s[5] <= bottom || s[4] >= hi) return;
      if (s[0] > px + reach || s[2] < px - reach || s[1] > py + reach || s[3] < py - reach) return;
      out.push(s);
    };
    for (const s of this.walls) add(s, lo);
    for (const s of this.moving) add(s, lo);
    for (const s of this.props) add(s, loProp);
    // a stair's mass (its treads are solid down to its foot) where it rises more than a step over the feet: walked
    // onto from its foot, not into from the side or underneath
    for (const [x0, y0, x1, y1, b0, rise, axis, sign] of this.c.stairs) {
      const t = Math.max(0, (lo - b0) / rise);
      if (t >= 1) continue;
      const a = axis ? y0 : x0, b = axis ? y1 : x1, v = sign > 0 ? a + (b - a) * t : b - (b - a) * t;
      const [c0, c1] = sign > 0 ? [v, b] : [a, v];
      add(axis ? [x0, c0, x1, c1, b0, b0 + rise] : [c0, y0, c1, y1, b0, b0 + rise], lo);
    }
    return out;
  }

  /** is a body (from the feet + a step up to the head) at a world point inside a wall or a piece of furniture? */
  blocked(p: V3, feetY: number, radius = RADIUS): boolean {
    const [px, h, py] = this.toPlan(p[0], feetY, p[2]);
    const r = radius / this.kh;
    for (const s of this.near(px, py, h, r)) {
      const dx = Math.max(s[0] - px, 0, px - s[2]), dy = Math.max(s[1] - py, 0, py - s[3]);
      if (dx * dx + dy * dy < r * r - 1e-9) return true;
    }
    return false;
  }

  /** a step from `from` to `to` (camera positions; feet `eye` below `from`), slid along whatever it meets: returns the
   *  position reached, at `to`'s height */
  move(from: V3, to: V3, eye: number, radius = RADIUS): V3 {
    const a = this.toPlan(from[0], from[1] - eye, from[2]), b = this.toPlan(to[0], from[1] - eye, to[2]);
    const r = radius / this.kh;
    const dx = b[0] - a[0], dy = b[2] - a[2], len = Math.hypot(dx, dy);
    const boxes = this.near(a[0], a[2], a[1], len + r + 0.5);
    if (!boxes.length) return to;
    // steps shorter than the body's radius, so nothing is crossed between two of them
    const n = Math.max(1, Math.ceil(len / (r * 0.4)));
    const p: [number, number] = [a[0], a[2]];
    for (let i = 0; i < n; i++) {
      p[0] += dx / n; p[1] += dy / n;
      pushOut(p, r, boxes);
    }
    const w = this.toWorld(p[0], a[1], p[1]);
    return [w[0], to[1], w[2]];
  }

  /** how freely a body standing at a world point (its feet) can walk off: of eight ways round, how many take it most
   *  of `reach` (m), slid along whatever it meets; 0 when it's inside something */
  freedom(feet: V3, reach = 0.6, radius = RADIUS): number {
    if (this.blocked(feet, feet[1], radius)) return 0;
    let n = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const q = this.move(feet, [feet[0] + Math.cos(a) * reach, feet[1], feet[2] + Math.sin(a) * reach], 0, radius);
      if (Math.hypot(q[0] - feet[0], q[2] - feet[2]) > reach * 0.75) n++;
    }
    return n;
  }

  /** the way a body standing here (its feet) has the longest walk straight ahead, as a yaw (weft's: 0 faces -z, + turns
   *  left): of 24 headings, the one that gets furthest along itself within `reach` (m), those within 100° of `prefer`
   *  first and, of those, nearer it */
  openHeading(feet: V3, prefer: number, reach = 3, radius = RADIUS): number {
    let best = prefer, most = -Infinity;
    for (let i = -11; i <= 12; i++) {
      const off = (i / 24) * Math.PI * 2, yaw = prefer + off;
      const score = this.walkAhead(feet, yaw, reach, radius) - Math.abs(off) * 0.15 - (Math.abs(off) > 1.75 ? 1.5 : 0);
      if (score > most) { most = score; best = yaw; }
    }
    return best;
  }

  /** how far (m, up to `reach`) a body standing here walks straight ahead along a yaw, slid along what it meets */
  walkAhead(feet: V3, yaw: number, reach = 3, radius = RADIUS): number {
    const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    const q = this.move(feet, [feet[0] + dx * reach, feet[1], feet[2] + dz * reach], 0, radius);
    return (q[0] - feet[0]) * dx + (q[2] - feet[2]) * dz;
  }
}

/** move a circle (centre p, radius r) out of the boxes it overlaps: off the nearest point of each, a few rounds so a
 *  corner between two settles */
function pushOut(p: [number, number], r: number, boxes: number[][]) {
  for (let round = 0; round < 4; round++) {
    let moved = false;
    for (const s of boxes) {
      const dx = p[0] - Math.min(Math.max(p[0], s[0]), s[2]), dy = p[1] - Math.min(Math.max(p[1], s[1]), s[3]);
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2), k = (r - d) / d;
        p[0] += dx * k; p[1] += dy * k;
      } else {
        // the centre inside the box: out through its nearest side
        const e = [p[0] - s[0], s[2] - p[0], p[1] - s[1], s[3] - p[1]], m = Math.min(...e);
        if (m === e[0]) p[0] = s[0] - r; else if (m === e[1]) p[0] = s[2] + r; else if (m === e[2]) p[1] = s[1] - r; else p[1] = s[3] + r;
      }
      moved = true;
    }
    if (!moved) return;
  }
}

/** boxes with the same plan rectangle and touching height bands, merged into one */
function mergeBands(solids: number[][]): number[][] {
  const by = new Map<string, number[][]>();
  for (const s of solids) {
    const k = s.slice(0, 4).map((v) => v.toFixed(3)).join(',');
    let g = by.get(k);
    if (!g) by.set(k, (g = []));
    g.push(s);
  }
  const out: number[][] = [];
  for (const g of by.values()) {
    g.sort((p, q) => p[4] - q[4]);
    let cur = g[0].slice();
    for (const s of g.slice(1)) {
      if (s[4] <= cur[5] + 0.01) cur[5] = Math.max(cur[5], s[5]);
      else { out.push(cur); cur = s.slice(); }
    }
    out.push(cur);
  }
  return out;
}
