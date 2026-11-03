// The city's street plan, in two dimensions. Radial streets leave the plaza and ring streets follow the wall's ellipse
// scaled about the plaza (a core ring round the civic heart, a middle ring, and the pomoerium street inside the wall);
// between them lie superblocks. The precincts (the plaza, the grand hall's close, the palace and its court, the market
// square, the gate and stair squares, a few neighbourhood squares) are cut out of them, and what is left is split, each
// piece in its own frame (its x along its best street front), first into blocks with alleys between them and then into
// lots. Every lot keeps which of its edges face a party wall, an alley, a street or a grand front, and how rich its
// district is, for the houses to build from. All cuts inside a piece are square to its frame, so a piece's buildings
// share one collision frame.
import type { V2 } from '../world/layout';
import { AVENUE, GATE, GRAND_HALL, MARKET, PALACE, PLAZA, STAIR } from '../world/layout';
import { Rng } from './rng';
import {
  type Front, type Poly, area, bbox, centroid, inset, ngon, ring, ringK, split, subtract, toLocal, toWorld, wallReach, wind,
} from './geom';

const deg = Math.PI / 180;

export interface Lot {
  /** the lot in its piece's frame */
  poly: Poly;
  wealth: number;
  /** a house, or an open courtyard (no street reaches it) */
  kind: 'house' | 'court';
  seed: number;
}

/** a piece of a superblock: its frame (origin, yaw as ArchBuilder.at) and its lots */
export interface Piece { id: number; o: V2; yaw: number; poly: Poly; lots: Lot[] }

/** a street's centre line (world plan) and width: for paving, lanterns and the alleys' arches */
export interface Street { a: V2; b: V2; width: number; rank: Front }

export interface Square { poly: V2[]; kind: 'plaza' | 'hall' | 'palace' | 'market' | 'gate' | 'stair' | 'local' }

export interface CityPlan { pieces: Piece[]; streets: Street[]; squares: Square[] }

/** the ring streets: k is the scale of the wall's ellipse about the plaza */
const CORE_K = 0.58, MID_K = 0.79;
const CORE_W = 12, MID_W = 9;
/** the building line's distance inside the wall's centre line (half the wall, the pomoerium street) */
const POMOERIUM = 12;

/** the radials (angle from the plaza in degrees, 0 east, 90 south; width): inside the core ring (from the plaza),
 *  between the core and middle rings, and outside the middle ring. A zone's superblocks span every angle any zone uses,
 *  so the rings' chords match on both sides; where a zone has no radial at an angle its blocks just meet there. */
const INNER = [[0, 18], [38, 11], [90, AVENUE.width], [142, 11], [180, 16], [226, 11], [314, 11]];
const MIDDLE = [[0, 12], [38, 10], [58, 9], [90, AVENUE.width], [106, 9], [142, 10], [160, 9], [180, 14], [226, 10], [248, 9], [270, AVENUE.width], [314, 10], [336, 9]];
const OUTER = [[0, 12], [18, 9], [38, 10], [74, 9], [90, AVENUE.width], [124, 9], [142, 10], [180, 14], [200, 9], [226, 10], [270, AVENUE.width], [292, 9], [314, 10]];
const ALL = [...new Set([...INNER, ...MIDDLE, ...OUTER].map(([a]) => a))].sort((a, b) => a - b);
/** the plaza side of the inner blocks: their corners on this circle */
const PLAZA_EDGE = 86;

/** the grand hall's close: the hall, its steps and pillars, the streets either side of it, the yard behind */
export const HALL_CLOSE = { x0: -58, x1: 58, z0: -184, z1: -64 };
/** the palace's precinct: the palace, its court toward the plaza, its gardens */
export const PALACE_CLOSE = { x0: 140, x1: 304, z0: -104, z1: 40 };
/** the squares inside the south gate and at the stair's foot */
export const GATE_SQUARE = { x0: -46, x1: 46, z0: GATE.z - 58, z1: GATE.z };
export const STAIR_SQUARE = { x0: -38, x1: 38, z0: STAIR.landings[0][1] - 26, z1: STAIR.landings[0][1] + 34 };
/** the market square: the market's ellipse a little inside the layout's */
export const MARKET_SQUARE = { x: MARKET.x, z: MARKET.z, rx: MARKET.rx * 0.9, rz: MARKET.rz * 0.86 };
/** the neighbourhood squares: (angle, ring scale, radius) */
const LOCAL = [[58, MID_K, 20], [142, MID_K, 22], [226, MID_K, 21], [314, MID_K, 19], [106, CORE_K, 17], [248, CORE_K, 18], [18, 0.9, 16], [200, 0.9, 17], [124, 0.9, 16]];

const rect = (r: { x0: number; x1: number; z0: number; z1: number }): V2[] => [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]];
const ellipse = (cx: number, cz: number, rx: number, rz: number, n: number): V2[] =>
  Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * rx, cz + Math.sin((i / n) * Math.PI * 2) * rz] as V2);

/** how rich a place is (0 humble, by the walls .. 1 grand, on the plaza and the avenue) */
function wealthAt(p: V2, rng?: Rng): number {
  const dPlaza = Math.hypot(p[0] - PLAZA.x, p[1] - PLAZA.z);
  const dPalace = Math.hypot(p[0] - PALACE.x, p[1] - PALACE.z);
  const dHall = Math.hypot(p[0] - GRAND_HALL.x, p[1] - GRAND_HALL.z);
  const avenue = p[1] > AVENUE.z1 && p[1] < AVENUE.z0 ? 1.0 - Math.abs(p[0] - AVENUE.x) / 95 : 0;
  let w = Math.max(1.15 - dPlaza / 380, avenue, 1.0 - dPalace / 240, 0.95 - dHall / 230);
  const k = ringK(p);
  w -= Math.max(0, k - 0.82) * 1.6;
  if (rng) w += rng.range(-0.12, 0.12);
  return Math.max(0, Math.min(1, w));
}

/** the polygon between two radials (angles a0 < a1, widths w0 w1: 0 where there's no street) and two rings: its inner
 *  edge one chord (k0 = 0: facing the plaza), its outer edge the ring's chords through every angle in `mids` (seen from
 *  inside a ring is convex, so the block stays convex) or, for k1 = 1, the building line inside the wall as an arc */
function superblock(a0: number, a1: number, mids: number[], k0: number, k1: number, w0: number, w1: number, wIn: number, wOut: number): Poly {
  const pts: V2[] = [], fronts: Front[] = [];
  const inset0: number[] = [];
  const radialFront = (w: number): Front => (w === 0 ? 0 : w >= 16 ? 3 : 2);
  if (k0 === 0) {
    const r = PLAZA_EDGE / Math.cos(Math.min(a1 - a0, 1.2) / 2);
    pts.push([Math.cos(a0) * r, Math.sin(a0) * r], [Math.cos(a1) * r, Math.sin(a1) * r]);
  } else pts.push(ring(a0, k0), ring(a1, k0));
  fronts.push(k0 === 0 ? 3 : 2); inset0.push(wIn / 2);
  // out along radial a1
  fronts.push(radialFront(w1)); inset0.push(w1 / 2);
  if (k1 >= 1) {
    const n = Math.max(2, Math.ceil(((a1 - a0) * wallReach((a0 + a1) / 2)) / 24));
    for (let i = 0; i <= n; i++) {
      const a = a1 - ((a1 - a0) * i) / n;
      const t = wallReach(a) - POMOERIUM;
      pts.push([Math.cos(a) * t, Math.sin(a) * t]);
      if (i < n) { fronts.push(2); inset0.push(0); }
    }
  } else {
    const outer = [a1, ...mids.filter((a) => a > a0 && a < a1).sort((x, y) => y - x), a0];
    outer.forEach((a, i) => {
      pts.push(ring(a, k1));
      if (i < outer.length - 1) { fronts.push(2); inset0.push(wOut / 2); }
    });
  }
  // back in along radial a0
  fronts.push(radialFront(w0)); inset0.push(w0 / 2);
  return wind(inset({ p: pts, f: fronts }, inset0));
}

export function planCity(seed: number): CityPlan {
  const rng = new Rng(seed);
  const streets: Street[] = [];
  const squares: Square[] = [];
  const supers: Poly[] = [];
  const angles = (set: number[][]) => set.map(([a]) => a);
  // the angles where streets meet each ring: the core ring the middle set's (which hold the inner set's), the middle
  // ring the middle and outer sets' together
  const atCore = angles(MIDDLE), atMid = ALL;

  // radials and ring streets as centre lines
  const radialStreets = (set: number[][], k0: number, k1: number) => {
    for (const [a, w] of set) {
      const r0 = k0 === 0 ? PLAZA_EDGE - 6 : wallReach(a * deg) * k0;
      const r1 = k1 >= 1 ? wallReach(a * deg) - POMOERIUM * 0.5 : wallReach(a * deg) * k1;
      streets.push({ a: [Math.cos(a * deg) * r0, Math.sin(a * deg) * r0], b: [Math.cos(a * deg) * r1, Math.sin(a * deg) * r1], width: w, rank: w >= 16 ? 3 : 2 });
    }
  };
  radialStreets(INNER, 0, CORE_K);
  radialStreets(MIDDLE, CORE_K, MID_K);
  radialStreets(OUTER, MID_K, 1);
  const ringStreets = (at: number[], k: number, w: number) => {
    for (let i = 0; i < at.length; i++) {
      const a0 = at[i] * deg, a1 = (i + 1 < at.length ? at[i + 1] : at[0] + 360) * deg;
      streets.push({ a: ring(a0, k), b: ring(a1, k), width: w, rank: 2 });
    }
  };
  ringStreets(atCore, CORE_K, CORE_W);
  ringStreets(atMid, MID_K, MID_W);

  // superblocks: each zone's between neighbouring angles of `span` (its inner edge one chord of the ring inside it)
  const zone = (set: number[][], span: number[], mids: number[], k0: number, k1: number, wIn: number, wOut: number) => {
    const width = (a: number) => set.find(([d]) => d === a % 360)?.[1] ?? 0;
    for (let i = 0; i < span.length; i++) {
      const d0 = span[i], d1 = i + 1 < span.length ? span[i + 1] : span[0] + 360;
      const m = mids.flatMap((a) => [a, a + 360]).map((a) => a * deg);
      supers.push(superblock(d0 * deg, d1 * deg, m, k0, k1, width(d0), width(d1), wIn, wOut));
    }
  };
  zone(INNER, angles(INNER), atCore, 0, CORE_K, 0, CORE_W);
  zone(MIDDLE, angles(MIDDLE), atMid, CORE_K, MID_K, CORE_W, MID_W);
  zone(OUTER, atMid, [], MID_K, 1, MID_W, 0);

  // the precincts cut out of them
  // (few-sided, so the blocks round them are cut into few pieces: a many-sided hole fans them into slivers)
  const plazaPoly = ngon(PLAZA.x, PLAZA.z, PLAZA_EDGE - 7, 16);
  const marketPoly = ellipse(MARKET_SQUARE.x, MARKET_SQUARE.z, MARKET_SQUARE.rx, MARKET_SQUARE.rz, 8);
  squares.push({ poly: plazaPoly, kind: 'plaza' }, { poly: rect(HALL_CLOSE), kind: 'hall' }, { poly: rect(PALACE_CLOSE), kind: 'palace' },
    { poly: marketPoly, kind: 'market' }, { poly: rect(GATE_SQUARE), kind: 'gate' }, { poly: rect(STAIR_SQUARE), kind: 'stair' });
  for (const [a, k, r] of LOCAL) {
    const c = ring(a * deg, k);
    squares.push({ poly: ngon(c[0], c[1], r, 8, rng.range(0, Math.PI / 4)), kind: 'local' });
  }
  let pieces: Poly[] = supers;
  for (const sq of squares) {
    const next: Poly[] = [];
    for (const q of pieces) {
      if (!overlaps(q.p, sq.poly)) { next.push(q); continue; }
      next.push(...subtract(q, sq.poly, sq.kind === 'local' ? 2 : 3).map(wind));
    }
    pieces = next;
  }

  // each piece in its own frame, split into blocks and lots
  const out: Piece[] = [];
  pieces.forEach((q, id) => {
    if (area(q.p) < 120) return;
    const prng = rng.fork(1000 + id);
    // the frame: x along the longest of the best-ranked edges
    let best = 0, bestScore = -1;
    for (let i = 0; i < q.p.length; i++) {
      const a = q.p[i], b = q.p[(i + 1) % q.p.length];
      const s = Math.hypot(b[0] - a[0], b[1] - a[1]) * (1 + q.f[i]);
      if (s > bestScore) { bestScore = s; best = i; }
    }
    const a = q.p[best], b = q.p[(best + 1) % q.p.length];
    const yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    const o = centroid(q.p);
    const local = wind({ p: q.p.map((pt) => toLocal(pt, o, yaw)), f: q.f });
    const lots: Lot[] = [];
    const alleys: [V2, V2, number][] = [];
    divide(local, prng, (pt) => wealthAt(toWorld(pt, o, yaw)), lots, alleys, 0);
    for (const [la, lb, w] of alleys) streets.push({ a: toWorld(la, o, yaw), b: toWorld(lb, o, yaw), width: w, rank: 1 });
    out.push({ id, o, yaw, poly: local, lots });
  });

  return { pieces: out, streets, squares };
}

/** do two convex polygons' bounding boxes and areas meet (a cheap test before cutting) */
function overlaps(a: V2[], b: V2[]): boolean {
  const [ax0, az0, ax1, az1] = bbox(a), [bx0, bz0, bx1, bz1] = bbox(b);
  return ax0 < bx1 && bx0 < ax1 && az0 < bz1 && bz0 < az1;
}

/** split a piece (its frame's local plan) into blocks with alleys, then lots */
function divide(q: Poly, rng: Rng, wealth: (p: V2) => number, lots: Lot[], alleys: [V2, V2, number][], depth: number) {
  if (q.p.length < 3) return;
  const A = area(q.p);
  if (A < 30) return;
  const [x0, z0, x1, z1] = bbox(q.p);
  const w = x1 - x0, h = z1 - z0;
  const c = centroid(q.p);
  const wl = wealth(c);
  // lot sizes by wealth: frontage along x, depth along z (the frame's x runs along the street)
  const F = 7.5 + wl * 9, D = 10 + wl * 7;
  const BLOCK = 46 + wl * 22;
  const isBlock = w > BLOCK || h > BLOCK * 0.9;
  if (!isBlock && ((w <= F * 1.45 && h <= D * 1.5) || A < F * D * 1.25)) {
    // (slivers left where a frame meets a slanted street stay open ground)
    if (A < 26 || A / perimeter(q.p) ** 2 < 0.028) return;
    const front = Math.max(...q.f) as Front;
    lots.push({ poly: q, wealth: Math.max(0, Math.min(1, wl + rng.range(-0.1, 0.1))), kind: front > 0 ? 'house' : 'court', seed: Math.floor(rng.next() * 1e9) });
    return;
  }
  // cut across the longer side (measured in lots), off-centre
  const cutX = isBlock ? w / BLOCK >= h / (BLOCK * 0.9) : w / F >= h / D;
  const span = cutX ? w : h;
  const t = isBlock ? rng.range(0.36, 0.64) : rng.range(0.42, 0.58);
  const at = (cutX ? x0 : z0) + span * t;
  // blocks are parted by alleys (≥ 4 m); lots share party walls
  const gap = isBlock && rng.chance(0.86) ? rng.range(4.2, 6.5) : 0;
  const [lo, hi] = cutX ? split(q, 1, 0, at, gap, gap > 0 ? 1 : 0) : split(q, 0, 1, at, gap, gap > 0 ? 1 : 0);
  if (gap > 0) {
    // the alley's centre line across the piece
    const zs = crossing(q.p, cutX, at);
    if (zs) alleys.push([cutX ? [at, zs[0]] : [zs[0], at], cutX ? [at, zs[1]] : [zs[1], at], gap]);
  }
  divide(wind(lo), rng, wealth, lots, alleys, depth + 1);
  divide(wind(hi), rng, wealth, lots, alleys, depth + 1);
}

function perimeter(p: V2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += Math.hypot(p[(i + 1) % p.length][0] - p[i][0], p[(i + 1) % p.length][1] - p[i][1]);
  return s;
}

/** where the line x = at (or z = at) crosses a convex polygon: the range of the other coordinate */
function crossing(p: V2[], alongX: boolean, at: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const ua = alongX ? a[0] : a[1], ub = alongX ? b[0] : b[1];
    if ((ua - at) * (ub - at) > 0 || ua === ub) continue;
    const t = (at - ua) / (ub - ua);
    const v = alongX ? a[1] + (b[1] - a[1]) * t : a[0] + (b[0] - a[0]) * t;
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  return lo < hi ? [lo, hi] : null;
}
