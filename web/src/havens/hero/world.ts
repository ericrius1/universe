// What the player stands on and bumps into, and what the camera behind them mustn't pass through (boulder's): the
// terrain (ground wherever it's within a step of the feet, so a floor buried under it is no hole); a house (its floors,
// the stairs' actual treads for the feet, its walls; floor and ceiling slabs for the camera) and more buildings like it
// (`more`, each its own HouseCollider from arch/types.ts Collision; the temple's and the city's thousands asked for by
// where they are: `moreNear`, arch/collide.ts); tree trunks (bucketed on a grid, and any asked for; only big trees': the
// body goes through bushes and small trees); the water waded in and the ice frozen onto it; solid blocks — their roofs
// to land and walk on, their walls to go round; more tops to stand on (the rocks' caps, ledges and boulders: `tops`).
import type { V3 } from './math';
import type { HouseCollider } from '../house/collider';
import { CellGrid } from '../util/cellgrid';

/** a trunk this tall (m) or taller is solid: smaller trees and bushes are walked through */
const SOLID_H = 7.5;

/** where there's water to wade, swim and skim over: its surface's height at (x, z), or null where there's none */
export interface WaterLevels { levelAt(x: number, z: number): number | null }

export interface Ground { heightAt(x: number, z: number): number }
export interface Trunks { x: Float32Array; z: Float32Array; y: Float32Array; h: Float32Array }
/** more trunks within r of (x, z): the first n of the arrays, each with its radius */
export type TrunkQuery = (x: number, z: number, r: number) => Trunks & { n: number; trunk: Float32Array };

const CELL = 4;

export class HeroWorld {
  /** camera blockers in plan feet: [x0, y0, x1, y1, z0, z1] (walls, floor slabs, ceilings over the storeys) */
  private boxes: number[][] = [];
  private moreBoxes = new WeakMap<HouseCollider, number[][]>();
  private grid: CellGrid | null = null;
  /** the procedural trees' trunks (trees.proceduralNear) */
  moreTrunks: TrunkQuery | null = null;
  /** more posts she goes round whatever their height (Aang's cushion: not a tree, so not under trees/solid.ts's rule) */
  morePosts: TrunkQuery | null = null;
  /** more buildings with a walking collider like the house's (the garage): floors, roofs and decks, walls */
  more: HouseCollider[] = [];
  /** more buildings found near a point rather than listed: the city's and the Haven's thousands of structures
   *  (arch/collide.ts CollisionSet.near), those whose footprints come within r of (x, z) */
  moreNear: ((x: number, z: number, r: number) => readonly HouseCollider[]) | null = null;
  private nearBuf: HouseCollider[] = [];
  /** solid blocks she stands on and goes round (the City's buildings): their top over (x, z), or null off them */
  solids: { roofAt(x: number, z: number): number | null } | null = null;
  /** ice frozen onto the water (the bending's floes): its top over (x, z) where the ground is at g, else null */
  ice: ((x: number, z: number, g: number) => number | null) | null = null;
  /** more tops to stand on (the rocks'): the highest over (x, z) no more than `step` above feet at y, else null */
  tops: ((x: number, z: number, y: number, step: number) => number | null) | null = null;

  constructor(readonly terrain: Ground, readonly house: HouseCollider | null, readonly trunks: Trunks | null, readonly water: WaterLevels) {
    if (house) this.boxes = cameraBoxes(house);
    if (trunks) this.grid = CellGrid.points(CELL, trunks.x, trunks.z, (i) => trunks.h[i] >= SOLID_H);
  }

  /** the trunks round (x, z): position, foot, height and radius (the crowns stand on trunks this thick) */
  private trunksNear(x: number, z: number, r: number, fn: (tx: number, tz: number, ty: number, th: number, tr: number) => void) {
    const c = this.trunks, g = this.grid;
    if (c && g) {
      const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        for (let k = g.at(cx, cz), e = g.end; k < e; k++) { const i = g.items[k]; fn(c.x[i], c.z[i], c.y[i], c.h[i], 0.3 + c.h[i] * 0.022); }
      }
    }
    const t = this.moreTrunks?.(x, z, r);
    if (t) for (let i = 0; i < t.n; i++) if (t.h[i] >= SOLID_H) fn(t.x[i], t.z[i], t.y[i], t.h[i], t.trunk[i]);
    const o = this.morePosts?.(x, z, r);
    if (o) for (let i = 0; i < o.n; i++) fn(o.x[i], o.z[i], o.y[i], o.h[i], o.trunk[i]);
  }

  /** the buildings with a collider that may be within r of (x, z): all of `more`, and moreNear's (walked before the
   *  next ask: moreNear's list is reused) */
  private around(x: number, z: number, r: number): readonly HouseCollider[] {
    const q = this.moreNear?.(x, z, r);
    if (!q?.length) return this.more;
    if (!this.more.length) return q;
    const b = this.nearBuf;
    b.length = 0;
    for (const c of this.more) b.push(c);
    for (const c of q) b.push(c);
    return b;
  }

  /** the ground under (x, z) for feet at height y: the highest of a house floor or stair tread within a step of them
   *  (the storey's, the treads where the stair is; the garage's the same), the terrain within a step of them (a floor
   *  buried under the ground — a storey dug into the slope, a part set into the hill — is no hole in it: walked over,
   *  the ground is the ground), a building's roof within a step of them; the terrain wherever nothing else is */
  groundAt(x: number, z: number, y: number, step = 0.5): number {
    let g = -Infinity;
    if (this.house) g = this.floorOf(this.house, x, z, y, step);
    for (const c of this.around(x, z, 0.5)) g = Math.max(g, this.floorOf(c, x, z, y, step));
    const t = this.terrain.heightAt(x, z);
    if (g === -Infinity || t <= y + step) g = Math.max(g, this.onIce(x, z, y, t, step));
    g = Math.max(g, this.tops?.(x, z, y, step) ?? -Infinity);
    const r = this.solids?.roofAt(x, z) ?? null;
    return r !== null && r <= y + step ? Math.max(g, r) : g;
  }

  /** a house's floor or stair tread under (x, z) within a step of feet at y (world height), or -Infinity */
  private floorOf(h: HouseCollider, x: number, z: number, y: number, step: number): number {
    const [px, ph, py] = h.toPlan(x, y, z);
    let best = -Infinity;
    const lim = ph + step / h.kv;
    for (const f of h.c.floors) if (px >= f[0] && px <= f[2] && py >= f[1] && py <= f[3] && f[4] <= lim) best = Math.max(best, f[4]);
    for (const f of h.c.doors) if (px >= f[0] && px <= f[2] && py >= f[1] && py <= f[3] && f[4] <= lim) best = Math.max(best, f[4]);
    for (const s of h.c.stairs) {
      const [x0, y0, x1, y1, b0, rise, axis, sign] = s;
      if (px < x0 || px > x1 || py < y0 || py > y1) continue;
      // the treads (pipeline/floorplan: n of them, each a riser up, the first a riser above the stair's foot; risers of
      // about 0.18 m whatever the plan's units — boulder's feet, the builders' metres)
      const n = Math.max(2, Math.round((Math.abs(rise) * h.kv) / 0.18));
      const lo = axis ? y0 : x0, hi = axis ? y1 : x1, v = axis ? py : px;
      const u = Math.min(0.9999, Math.max(0, sign > 0 ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo)));
      const top = b0 + (Math.floor(u * n) + 1) * rise / n;
      if (top <= lim) best = Math.max(best, top);
    }
    return best === -Infinity ? best : h.toWorld(px, best, py)[1];
  }

  /** the ramp's height (the collider's smooth stairs) for the body itself: no steps to jolt over; the terrain within a
   *  step as in groundAt; a building's roof wherever she is over it (solid: walked into from the street it's a wall,
   *  the player's cliff rule) */
  bodyGround(x: number, z: number, y: number): number {
    let f: number | null = this.house?.floorAt(x, z, y) ?? null;
    for (const c of this.around(x, z, 0.5)) { const q = c.floorAt(x, z, y); if (q !== null && (f === null || q > f)) f = q; }
    const t = this.terrain.heightAt(x, z);
    const under = f === null || t <= y + 0.5 ? Math.max(f ?? -Infinity, this.onIce(x, z, y, t, 0.5)) : f;
    const g = Math.max(under, this.tops?.(x, z, y, 0.5) ?? -Infinity);
    const r = this.solids?.roofAt(x, z) ?? null;
    return r !== null ? Math.max(g, r) : g;
  }

  /** the ground at g, or the ice over it if there's ice within a step of feet at y */
  private onIce(x: number, z: number, y: number, g: number, step: number) {
    const i = this.ice?.(x, z, g) ?? null;
    return i !== null && i <= y + step ? Math.max(g, i) : g;
  }

  /** the ceiling over someone standing at (x, z, y) (null under the sky) */
  ceilingAt(x: number, z: number, y: number): number | null {
    let c = this.house?.ceilingAt(x, z, y) ?? null;
    for (const h of this.around(x, z, 0.5)) { const q = h.ceilingAt(x, z, y); if (q !== null && (c === null || q < c)) c = q; }
    return c;
  }

  /** in a room of the house or another building (feet at (x, z, y)): not out on a deck or a terrace, under a balcony */
  indoors(x: number, z: number, y: number): boolean {
    return !!this.house?.indoors(x, z, y) || this.around(x, z, 0.5).some((h) => h.indoors(x, z, y));
  }

  /** a body (radius r) moving from `from` to `to` (feet points): slid along the house's walls and round its furniture
   *  as the walker is (and pushed out of any it's already in: set down there, or a door shut on her), pushed out of
   *  trunks */
  move(from: V3, to: V3, r = 0.24): V3 {
    let m = this.house ? this.house.move(from, to, 0, r) : to;
    const reach = Math.hypot(to[0] - from[0], to[2] - from[2]) / 2 + r + 0.5;
    for (const c of this.around((from[0] + to[0]) / 2, (from[2] + to[2]) / 2, reach)) {
      // (wedged between two of a building's boxes closer than her body, she slips out thinner)
      const want = Math.hypot(m[0] - from[0], m[2] - from[2]);
      const q = c.move(from, m, 0, r);
      m = want > 0.01 && Math.hypot(q[0] - from[0], q[2] - from[2]) < want * 0.05 && c.blocked(from, from[1], r) ? c.move(from, m, 0, r * 0.4) : q;
    }
    // (a building's walls: not into its block below its roof — along the wall instead, by one axis or the other. The
    // sweep matters in fast flight: an endpoint beyond a narrow building is clear again. If the city streamed in with
    // her already inside a footprint, do not imprison her there: movement out stays free.)
    if (this.solids) {
      const roof = this.solids.roofAt(from[0], from[2]);
      const startedInside = roof !== null && from[1] < roof - 0.45;
      if (!startedInside) {
        const stop = (b: V3) => {
          const t = this.clearOfSolids(from, b, r * 0.5, 1, 0.45);
          return [from[0] + (b[0] - from[0]) * t, b[1], from[2] + (b[2] - from[2]) * t] as V3;
        };
        const direct = stop(m);
        if (Math.hypot(direct[0] - m[0], direct[2] - m[2]) > 1e-4) {
          // Try each component on its own: whichever travels farther is the slide along the wall.
          const alongX = stop([m[0], m[1], from[2]]), alongZ = stop([from[0], m[1], m[2]]);
          const dx = Math.hypot(alongX[0] - from[0], alongX[2] - from[2]);
          const dz = Math.hypot(alongZ[0] - from[0], alongZ[2] - from[2]);
          m = dx > dz && dx > 1e-4 ? alongX : dz > 1e-4 ? alongZ : direct;
        }
      }
    }
    const q: V3 = [m[0], m[1], m[2]];
    this.trunksNear(q[0], q[2], 2, (tx, tz, ty, th, tr) => {
      // (feet at its top or over it pass: standing on a rock's cap, whose post ends where the cap's top is, isn't being
      // inside the post)
      if (q[1] >= ty + th * 0.6 - 0.05 || q[1] < ty - 2) return;
      const dx = q[0] - tx, dz = q[2] - tz;
      const R = tr + r * 0.5;
      const d = Math.hypot(dx, dz);
      if (d < R) { q[0] = tx + (dx / Math.max(d, 1e-4)) * R; q[2] = tz + (dz / Math.max(d, 1e-4)) * R; }
    });
    return q;
  }

  /** how far (0..1) along the segment a to b a camera of radius `margin` can go before meeting the house, a trunk or
   *  the ground */
  clearAlong(a: V3, b: V3, margin = 0.22): number {
    const h = this.house;
    let t = h ? clearOf(h, this.boxes, a, b, margin, 1) : 1;
    // (the other buildings with a collider: theirs made the first time the camera's near one)
    const reach = Math.hypot(b[0] - a[0], b[2] - a[2]) / 2 + margin + 0.5;
    for (const c of this.around((a[0] + b[0]) / 2, (a[2] + b[2]) / 2, reach)) {
      let bx = this.moreBoxes.get(c);
      if (!bx) this.moreBoxes.set(c, (bx = cameraBoxes(c)));
      t = clearOf(c, bx, a, b, margin, t, true);
    }
    // Downtown's buildings are solid for the follow camera too. Without this the takeoff transition can pull the
    // lens backward through a Pearl Street storefront even while the body remains correctly out on the mall.
    t = this.clearOfSolids(a, b, margin, t);
    // trunks: circles in the plane, between their foot and most of their height
    const mx = (a[0] + b[0]) / 2, mz = (a[2] + b[2]) / 2, rr = Math.hypot(b[0] - a[0], b[2] - a[2]) / 2 + 2;
    const dx = b[0] - a[0], dz = b[2] - a[2], dd = dx * dx + dz * dz;
    this.trunksNear(mx, mz, rr, (tx, tz, ty, th, tr) => {
      const R = tr * 0.8 + margin;
      const ox = a[0] - tx, oz = a[2] - tz;
      const B = ox * dx + oz * dz, C = ox * ox + oz * oz - R * R;
      if (C < 0 || dd < 1e-9) return;
      const disc = B * B - dd * C;
      if (disc < 0) return;
      const u = (-B - Math.sqrt(disc)) / dd;
      if (u < 0 || u > t) return;
      const y = a[1] + (b[1] - a[1]) * u;
      if (y < ty + th * 0.55 && y > ty - 1) t = u;
    });
    // the ground: marched (the terrain and the house's floors)
    const n = 12;
    for (let k = 1; k <= n; k++) {
      const u = (k / n) * t;
      const x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u, z = a[2] + (b[2] - a[2]) * u;
      // (inside the house its own slabs are the ground: the lower storey is dug in below the terrain)
      if (h && h.floorAt(x, z, y + 0.3) !== null) continue;
      if (y < this.terrain.heightAt(x, z) + margin) { t = Math.max(0, u - 1 / n); break; }
    }
    return t;
  }

  /** How far along a segment remains outside the City's solid building volumes. `roofAt` is a point query, so march
   *  closely enough not to tunnel through a narrow part; stop one radius before the first hit. Starting inside is a
   *  recovery case (streaming or an old save): it may leave the volume instead of being pinned in it. */
  private clearOfSolids(a: V3, b: V3, margin: number, limit = 1, roofSlack = -margin): number {
    const s = this.solids;
    if (!s || limit <= 0) return limit;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const fullSpan = Math.hypot(dx, dy, dz), span = fullSpan * limit;
    if (span < 1e-5) return limit;
    const inside = (u: number) => {
      const x = a[0] + dx * u, y = a[1] + dy * u, z = a[2] + dz * u;
      const roof = s.roofAt(x, z);
      return roof !== null && y < roof - roofSlack;
    };
    const startedInside = inside(0);
    let leftStart = !startedInside;
    let prev = 0;
    const n = Math.max(1, Math.ceil(span / 0.35));
    for (let k = 1; k <= n; k++) {
      const u = (k / n) * limit, hit = inside(u);
      if (!leftStart) { if (!hit) { leftStart = true; prev = u; } continue; }
      if (hit) {
        // Refine the face between the last clear sample and this hit, then leave the body's/lens's radius before it.
        let lo = prev, hi = u;
        for (let j = 0; j < 6; j++) { const mid = (lo + hi) / 2; if (inside(mid)) hi = mid; else lo = mid; }
        return Math.max(0, hi - margin / fullSpan);
      }
      prev = u;
    }
    return limit;
  }

  /** the water at (x, z): its level, or null */
  waterLevel(x: number, z: number): number | null { return this.water.levelAt(x, z); }
}

/** a building's camera blockers in its plan units: its walls, its floors' slabs and the ceilings over its storeys */
function cameraBoxes(h: HouseCollider): number[][] {
  const out = [...h.c.solids];
  const levels = Object.values(h.levels);
  for (const f of h.c.floors) {
    out.push([f[0], f[1], f[2], f[3], f[4] - 1.2, f[4] - 0.05]);
    // (a floor that's a storey's — not a deck — has that storey's ceiling over it)
    const L = levels.find((l) => Math.abs(l.height - f[4]) < 0.6);
    if (L) out.push([f[0], f[1], f[2], f[3], L.height + L.ceiling, L.height + L.ceiling + 1.5]);
  }
  return out;
}

/** how far (0..t) along the segment a to b a camera of radius `margin` gets before entering one of a building's boxes
 *  (plan axes: x, height, y; the boxes are [x0, y0, x1, y1, z0 (height), z1]). A box she's inside of at the start
 *  doesn't stop it; `strict`: one she's only within the margin of (up by a ceiling) stops it at its face */
function clearOf(h: HouseCollider, boxes: number[][], a: V3, b: V3, margin: number, t: number, strict = false): number {
  const pa = h.toPlan(a[0], a[1], a[2]), pb = h.toPlan(b[0], b[1], b[2]);
  const d = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
  const mh = margin / h.kh, mv = margin / h.kv;
  const lo = [0, 0, 0], hi = [0, 0, 0];
  // (where along the segment it enters a box grown by (gh, gv), or -1)
  const enter = (bx: number[], gh: number, gv: number, tMax: number) => {
    lo[0] = bx[0] - gh; hi[0] = bx[2] + gh;
    lo[1] = bx[4] - gv; hi[1] = bx[5] + gv;
    lo[2] = bx[1] - gh; hi[2] = bx[3] + gh;
    let t0 = 0, t1 = tMax;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-9) { if (pa[k] < lo[k] || pa[k] > hi[k]) return -1; continue; }
      let u0 = (lo[k] - pa[k]) / d[k], u1 = (hi[k] - pa[k]) / d[k];
      if (u0 > u1) { const s = u0; u0 = u1; u1 = s; }
      t0 = Math.max(t0, u0); t1 = Math.min(t1, u1);
      if (t0 > t1) return -1;
    }
    return t0;
  };
  for (const bx of boxes) {
    const t0 = enter(bx, mh, mv, t);
    if (t0 > 0) t = Math.min(t, t0);
    else if (t0 === 0 && strict) {
      const tf = enter(bx, 0, 0, t);
      if (tf > 0) t = Math.min(t, tf);
    }
  }
  return t;
}
