// The town's street plan, in two dimensions, on the star mesa. Round the citadel's foot runs the ring road (the ways':
// layout.ts WAYS, its chords between RING_ANGLES); out of it along each tip runs a spoke avenue from the square at its
// foot to the square at its tip (the ways' too). The town fills each point between them: radial streets out of the
// ring road 9° and 16° either side of each spoke (the notches between the points are the ridges' trunks: never a street,
// never paved, never lit), ring streets round the citadel at k 0.32 and 0.64 of the way from the ring road to the
// building line (geom.ts ring), and a rim street along the building line itself, inside it. A street crosses each
// branch ridge where the land cuts it down (layout.ts RIDGE_CUTS: a pass through the cutting, square to the ridge,
// out to the nearest street either side), and every point has its local squares where a radial meets a ring street
// (two in each homes point, one in the others), each a fountain or a great tree, a shrine and lamps.
//
// Between the streets lie superblocks, each in a frame of its own (x along its best street front): every other claim
// on the town's ground is cut out of it (layout.ts CLAIMS: the landmarks' precincts, the ways, the rims' tip squares,
// the pools, the canal, the ridges' keep-outs), grown by MARGIN, so that whatever stands out of a house's front — an
// awning, a balcony, a corner tower's bulge — stays on the town's own ground; what's left of it, in convex pieces, is
// split first into blocks with alleys between them and then into lots, all square to the superblock's frame. So a
// superblock's buildings share one collision frame (one collider: the district's budget is a few dozen). Every lot
// keeps which of its edges face a party wall, an alley, a street or a grand front (the ring road, an avenue, a square, a
// landmark), how rich its place is (wealthAt: richest at the citadel's foot and round the plaza, the hall and the
// palace, humble toward the rim), and what it is: a house, a courtyard no street reaches, or a garden (near the pools
// and toward the rim). The ring road and the avenues are the ways' (owner 'streets'): `ways` here, beside the town's
// own streets.
import type { V2 } from '../world/layout';
import {
  CLAIMS, GRAND_HALL, MARKET, PALACE, PLATEAU, PLAZA, POINTS, POOLS, RIDGES, RIDGE_CUTS, RING_ANGLES, STAR,
  STAIR_SQUARE as STAIR_SQUARE_, WAYS, convexHull, inPoint, pointFrame, polyLength, ridgeHalfWidth, ridgeKeep, subtractConvex, type PointName,
} from '../world/layout';
import { Rng } from './rng';
import {
  type Front, type Poly, area, bbox, centroid, clipHalf, distanceTo, grow, inset, ngon, rayHit, ring, ringK, split, strip,
  subtract, toLocal, toWorld, wind,
} from './geom';

const deg = Math.PI / 180;

export interface Lot {
  /** the lot in its block's frame */
  poly: Poly;
  wealth: number;
  /** a house; an open courtyard (no street reaches it); a garden (a lawn in a curb, trees) */
  kind: 'house' | 'court' | 'garden';
  seed: number;
}

/** a convex piece of a superblock (in the superblock's frame) and its lots */
export interface Piece { id: number; poly: Poly; lots: Lot[] }

/** an alley between two blocks of a piece (its centre line in the superblock's frame) */
export interface Alley { a: V2; b: V2; width: number }

/** a superblock: its frame (origin, yaw as ArchBuilder.at), its point, its pieces and the alleys between their blocks.
 *  Everything built in it shares the frame (and one collider) */
export interface Block { id: number; point: PointName; o: V2; yaw: number; pieces: Piece[]; alleys: Alley[] }

/** a street's centre line (world plan) and width: for street life (lantern strings, washing) and the probes */
export interface Street { a: V2; b: V2; width: number; rank: Front }

export interface Square { poly: V2[]; kind: 'plaza' | 'hall' | 'palace' | 'market' | 'gate' | 'stair' | 'local' | 'foot' | 'tip' | 'hole'; point?: PointName }

/** the plan: its superblocks, the town's streets, the ways (the ring road and the spoke avenues: owner 'streets'), the
 *  squares and holes cut out of it, and the town's floor (its claims: paved, all of it) */
export interface CityPlan { blocks: Block[]; streets: Street[]; ways: Street[]; squares: Square[]; floor: V2[][] }

/** the ring streets (k between the ring road and the building line) and their widths; the radials', the rim street's
 *  (along the building line, inside it), a pass's through a ridge's cutting */
const RINGS = [0.32, 0.64], RING_W = 7, RADIAL_W = 8, RIM_W = 7, PASS_W = 7, LANE_W = 6;
/** how far the town's lots keep back from every claim that isn't the town's (m): what stands out of a house's front (an
 *  awning 1.8 m, a corner tower's bulge, a door's step, a balcony) stays on the town's own ground */
export const MARGIN = 2.2;
/** a local square's radius (its octagon's, to its corners) */
const SQUARE_R = 15;

/** a close given in its own frame, as the world sees it unturned (hall.ts and palace.ts build their closes from it,
 *  measured from their centres: city.ts turns them about their centres to face as the layout says) */
const unturned = (a: { x: number; z: number; close: { x0: number; x1: number; z0: number; z1: number } }) =>
  ({ x0: a.x + a.close.x0, x1: a.x + a.close.x1, z0: a.z + a.close.z0, z1: a.z + a.close.z1 });
/** the grand hall's close, the palace's precinct (their builders' frames, unturned) */
export const HALL_CLOSE = unturned(GRAND_HALL);
export const PALACE_CLOSE = unturned(PALACE);
/** @deprecated the old south gate's square (the star has no south gate) */
export const GATE_SQUARE = { x0: -46, x1: 46, z0: 382, z1: 440 };
/** the square at the stair's foot */
export const STAIR_SQUARE = STAIR_SQUARE_;
/** the market square: the market's ellipse a little inside the layout's */
export const MARKET_SQUARE = { x: MARKET.x, z: MARKET.z, rx: MARKET.rx * 0.9, rz: MARKET.rz * 0.86 };

/** how rich a place is (0 humble .. 1 grand): richest at the citadel's foot (falling off over 220 m out from the ring
 *  road), round the plaza, the hall, the palace and the market; humble out toward the rim */
export function wealthAt(p: V2, rng?: Rng): number {
  const r = Math.hypot(p[0] - STAR.cx, p[1] - STAR.cz);
  const d = (x: number, z: number) => Math.hypot(p[0] - x, p[1] - z);
  let w = Math.max(0.9 - (r - PLATEAU.ring.r) / 220, 1.1 - d(PLAZA.x, PLAZA.z) / 300, 0.9 - d(PALACE.x, PALACE.z) / 200,
    0.95 - d(GRAND_HALL.x, GRAND_HALL.z) / 200, 0.75 - d(MARKET.x, MARKET.z) / 260);
  w -= Math.max(0, ringK(p) - 0.7) * 1.2;
  if (rng) w += rng.range(-0.12, 0.12);
  return Math.max(0, Math.min(1, w));
}

/** how near a pool a place is (1 on its rim, 0 from 50 m out) */
function nearPool(p: V2): number {
  let best = 0;
  for (const q of POOLS) {
    const d = Math.hypot(p[0] - q.x, p[1] - q.z) - (q.rx + q.rz) / 2;
    best = Math.max(best, 1 - Math.max(0, d) / 50);
  }
  return best;
}
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** the odds a lot is a garden: near a pool, out toward the rim, and round the palace (its gardens spill out into the
 *  town about it) */
const gardenOdds = (p: V2) => Math.min(0.6, 0.06 + 0.45 * nearPool(p) + 0.3 * smoothstep(0.55, 0.95, ringK(p)) + 0.25 * (1 - smoothstep(120, 220, Math.hypot(p[0] - PALACE.x, p[1] - PALACE.z))));

/** the front a lot shows to a claim cut out of the town: a grand front to the ways, the landmarks, the tip squares; a
 *  street's to a pool's promenade or the canal; an alley's (small windows, no door) to a ridge's rock; its back (a party
 *  wall) to the plaza, whose riwaq's outer face is a plain wall 12 m tall half a metre inside its claim */
function frontOf(c: { owner: string; id: string }): Front {
  return c.id === PLAZA_CLAIM ? 0 : c.owner === 'ridges' ? 1 : c.owner === 'pools' || c.owner === 'canal' ? 2 : 3;
}
/** the plaza's own claim (its riwaq round it: the houses back onto it, nothing standing out of them, so they keep only
 *  a hand's breadth back from it) */
const PLAZA_CLAIM = 'south/plaza';
const marginOf = (c: { id: string }) => (c.id === PLAZA_CLAIM ? 0.05 : MARGIN);

/** The plaza's way out into the town (plaza.ts, B3s): its riwaq's four gate mouths (east, west, north-east, north-west,
 *  5.4 m passages on its outline's edges, PLAZA.paved + 1 out), each a lane straight out from the plaza's middle to the
 *  town's nearest street; its two south corners left open onto the hall's close (a forecourt each between the plaza's
 *  corner, the close's and 18 m on, nothing built in it); and the two little triangles of ground between the plaza and
 *  the stair square's wings left open, the way from the one into the other */
/** the market's north and south gates (market/plan.ts GATES: open onto the town), on its claim's outline on its
 *  axis across the point */
const MARKET_GATES: V2[] = [-1, 1].map((s) => [MARKET.x, MARKET.z + s * (MARKET.rz / Math.cos(Math.PI / 16) - 0.4)] as V2);
const PLAZA_GATES = [0, 180, -45, -135].map((a) => [PLAZA.x + Math.cos(a * deg) * (PLAZA.paved + 1), PLAZA.z + Math.sin(a * deg) * (PLAZA.paved + 1)] as V2);
function plazaOpenings(): V2[][] {
  const plaza = CLAIMS.find((c) => c.id === PLAZA_CLAIM)?.poly, hall = CLAIMS.find((c) => c.id === 'south/hall')?.poly;
  const out: V2[][] = [];
  if (plaza && hall) for (const s of [-1, 1]) {
    // (the plaza's outline where it meets the hall's front, on this side; the close's corner there)
    const front = Math.min(...hall.map((q) => q[1]));
    const edge = plaza.filter(([x, z]) => s * (x - PLAZA.x) > 40 && z > front - 14);
    const corner = hall.reduce((m, q) => (Math.abs(q[1] - front) < 0.5 && s * q[0] > s * m[0] ? q : m), [PLAZA.x, front] as V2);
    if (!edge.length) continue;
    const far = edge.reduce((m, q) => (s * q[0] > s * m[0] ? q : m));
    out.push(convexHull([...edge, corner, [corner[0], front + 18], [far[0] + s * 6, front + 18], [far[0] + s * 8, far[1]]]));
  }
  const sq = STAIR_SQUARE_;
  for (const s of [-1, 1]) {
    const xs = [s * 18, s * (sq.x1 + 4)];
    out.push(wound([[Math.min(...xs), sq.z1 - 4], [Math.max(...xs), sq.z1 - 4], [Math.max(...xs), sq.z1 + 14], [Math.min(...xs), sq.z1 + 14]]));
  }
  return out;
}
const wound = (p: V2[]): V2[] => (area(p) >= 0 ? p : [...p].reverse());

/** the parts of segment a -> b outside every convex hole */
function clipStreet(a: V2, b: V2, holes: V2[][]): [V2, V2][] {
  let spans: [number, number][] = [[0, 1]];
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const [sx0, sz0, sx1, sz1] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  for (const h of holes) {
    const hb = bbox(h);
    if (hb[0] > sx1 || hb[2] < sx0 || hb[1] > sz1 || hb[3] < sz0) continue;
    // (the span of t inside the hole: Cyrus-Beck against each of its edges)
    let t0 = 0, t1 = 1;
    const hw = area(h) >= 0 ? h : [...h].reverse();
    for (let i = 0; i < hw.length && t0 <= t1; i++) {
      const p = hw[i], q = hw[(i + 1) % hw.length], nx = q[1] - p[1], nz = -(q[0] - p[0]);
      // (inside: n·(x - p) <= 0 for a positive-area outline's outward normal)
      const num = nx * (a[0] - p[0]) + nz * (a[1] - p[1]), den = nx * dx + nz * dz;
      if (Math.abs(den) < 1e-12) { if (num > 0) t1 = -1; continue; }
      const t = -num / den;
      if (den > 0) t1 = Math.min(t1, t); else t0 = Math.max(t0, t);
    }
    if (t0 >= t1) continue;
    spans = spans.flatMap(([s0, s1]): [number, number][] => [[s0, Math.min(s1, t0)], [Math.max(s0, t1), s1]].filter(([u, v]) => v - u > 1e-6) as [number, number][]);
  }
  const at = (t: number): V2 => [a[0] + dx * t, a[1] + dz * t];
  return spans.filter(([s0, s1]) => (s1 - s0) * Math.hypot(dx, dz) > 4).map(([s0, s1]) => [at(s0), at(s1)]);
}

export function planCity(seed: number): CityPlan {
  const rng = new Rng(seed);
  const streets: Street[] = [];
  const ways: Street[] = [];
  const squares: Square[] = [];
  const angles = [...RING_ANGLES].sort((a, b) => a - b);
  // what's a radial street at each of the ring's angles: the spokes are the ways' avenues (16 m), the notches are the
  // ridges' trunks (no street), the rest the town's radials
  const spoke = (a: number) => POINTS.some((p) => Math.abs((((a - p.tip) % 360) + 540) % 360 - 180) < 1e-6);
  const notch = (a: number) => Math.abs((((a - STAR.rot - 22.5) % 45) + 45) % 45) < 1e-6;
  const widthAt = (a: number) => (spoke(a) ? WAYS.avenue : notch(a) ? 0 : RADIAL_W);

  // the holes: every claim on the town's ground that isn't the town's (the landmarks, the ways, the rims, the pools, the
  // canal, the ridges' keep-outs; the stair's forecourt on the ring road); the fences the lots keep behind, MARGIN out
  // from them
  const others = CLAIMS.filter((c) => c.owner !== 'town' && (c.district !== 'citadel' || c.id.startsWith('citadel/stair-foot')));
  const holes = others.map((c) => c.poly);
  const fences = others.map((c) => ({ poly: grow(c.poly, marginOf(c)), front: frontOf(c), box: bbox(grow(c.poly, marginOf(c))) }));
  for (const c of others) {
    const kind: Square['kind'] = c.owner === 'plaza' ? (c.id.includes('stair') ? 'stair' : 'plaza') : c.owner === 'hall' ? 'hall'
      : c.owner === 'palace' ? 'palace' : c.owner === 'market' ? 'market' : c.id.startsWith('ways/foot') ? 'foot' : c.owner === 'rim' ? 'tip' : 'hole';
    squares.push({ poly: c.poly, kind, point: POINTS.find((p) => p.name === c.district)?.name });
  }
  // the town's floor: its own claims, paved
  const floor = CLAIMS.filter((c) => c.owner === 'town').map((c) => c.poly);

  // the ways: the ring road's centre line in chords, the spoke avenues (as the layout's 'streets' claims run)
  for (let i = 0; i < angles.length; i++) {
    const a0 = angles[i], a1 = i + 1 < angles.length ? angles[i + 1] : angles[0] + 360, r = PLATEAU.ring.r;
    ways.push({ a: [STAR.cx + Math.cos(a0 * deg) * r, STAR.cz + Math.sin(a0 * deg) * r], b: [STAR.cx + Math.cos(a1 * deg) * r, STAR.cz + Math.sin(a1 * deg) * r], width: PLATEAU.ring.width, rank: 3 });
  }
  for (const c of CLAIMS.filter((c) => c.id.startsWith('ways/avenue-'))) {
    const p = POINTS.find((q) => c.id === `ways/avenue-${q.name}` || c.id === `ways/avenue-${q.name}-out`)!;
    const us = c.poly.map(([x, z]) => pointFrame(p, x, z)[0]);
    ways.push({ a: inPoint(p, Math.min(...us), 0), b: inPoint(p, Math.max(...us), 0), width: WAYS.avenue, rank: 3 });
  }

  // the local squares: where a radial meets a ring street, clear of everything (two in each homes point, one in the
  // others: the inner ring first, either side of the axis in turn)
  const local: V2[][] = [];
  for (const p of POINTS) {
    const want = p.role === 'homes' ? 2 : 1, got: { c: V2; side: number }[] = [];
    const tries: { c: V2; a: number; side: number }[] = [];
    for (const k of RINGS) for (const off of [9, 16]) for (const s of [-1, 1]) tries.push({ c: ring((p.tip + s * off) * deg, k), a: p.tip + s * off, side: s });
    const clear = (c: V2) => !holes.some((h) => distanceTo(h, c) < SQUARE_R + MARGIN + 3) && got.every((g) => Math.hypot(g.c[0] - c[0], g.c[1] - c[1]) > 90);
    for (let n = 0; n < want; n++) {
      // (the first that clears; the next on the other side of the axis if one there clears)
      const t = tries.find((t) => clear(t.c) && got.every((g) => g.side !== t.side)) ?? tries.find((t) => clear(t.c));
      if (!t) break;
      got.push(t);
      const poly = ngon(t.c[0], t.c[1], SQUARE_R, 8, t.a * deg + Math.PI / 8);
      local.push(poly);
      squares.push({ poly, kind: 'local', point: p.name });
    }
  }

  // the town's streets as centre lines, clipped where they meet a hole or open into a square: the radials, the ring
  // streets, the rim street
  const ks = [0, ...RINGS, 1], stops = [...holes, ...local];
  for (const a of angles) {
    const w = widthAt(a);
    if (w === 0 || spoke(a)) continue;
    for (let i = 0; i < ks.length - 1; i++) {
      for (const [p, q] of clipStreet(ring(a * deg, ks[i]), ring(a * deg, ks[i + 1]), stops)) streets.push({ a: p, b: q, width: w, rank: 2 });
    }
  }
  for (const k of [...RINGS, 1]) for (let i = 0; i < angles.length; i++) {
    const a0 = angles[i], a1 = i + 1 < angles.length ? angles[i + 1] : angles[0] + 360;
    let p = ring(a0 * deg, k), q = ring(a1 * deg, k);
    if (k === 1) {
      // (the rim street inside the building line: its chord moved in by half its width)
      const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz), nx = dz / L, nz = -dx / L;
      const m: V2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], s = Math.sign(nx * (STAR.cx - m[0]) + nz * (STAR.cz - m[1])) * (RIM_W / 2);
      p = [p[0] + nx * s, p[1] + nz * s]; q = [q[0] + nx * s, q[1] + nz * s];
    }
    for (const [u, v] of clipStreet(p, q, stops)) streets.push({ a: u, b: v, width: k === 1 ? RIM_W : RING_W, rank: 2 });
  }

  // the passes through the branch ridges' cuttings: square to the ridge, out either side to the nearest street (or a
  // way, or a hole) beyond its keep-out, or 30 m on into the town if none is near
  const passes: V2[][] = [];
  for (const cut of RIDGE_CUTS) {
    const r = RIDGES[cut.ridge];
    if (r.kind !== 'branch') continue;
    const L = polyLength(r.pts);
    let s = 0, dir: V2 = [1, 0];
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (s + l >= cut.along || i === r.pts.length - 2) { dir = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; break; }
      s += l;
    }
    const n: V2 = [-dir[1], dir[0]], keep = ridgeKeep(ridgeHalfWidth(cut.ridge, cut.along / L));
    const ends: V2[] = [];
    for (const sg of [-1, 1]) {
      const u: V2 = [n[0] * sg, n[1] * sg], from = keep + MARGIN;
      let best = keep + 30;
      for (const st of streets) {
        const t = rayHit(cut.at, u, st.a, st.b);
        if (t > from && t < keep + 70 && t < best) best = t;
      }
      // (into a hole that isn't this ridge's: the pass ends at its edge)
      for (const c of others) {
        if (c.owner === 'ridges' && c.id.startsWith(`land/branch-${cut.ridge}-`)) continue;
        for (let i = 0; i < c.poly.length; i++) {
          const t = rayHit(cut.at, u, c.poly[i], c.poly[(i + 1) % c.poly.length]);
          if (t > from && t < best) best = t;
        }
      }
      ends.push([cut.at[0] + u[0] * best, cut.at[1] + u[1] * best]);
    }
    passes.push(strip(ends[0], ends[1], PASS_W / 2));
    streets.push({ a: ends[0], b: ends[1], width: PASS_W, rank: 2 });
  }

  // the lanes out of the plaza's gates and the market's north and south ones: straight out from its middle to the
  // nearest street (or a hole) past 2 m, or 25 m
  const lanes: V2[][] = [];
  const gates: [V2, V2][] = [...PLAZA_GATES.map((g) => [g, [PLAZA.x, PLAZA.z]] as [V2, V2]), ...MARKET_GATES.map((g) => [g, [MARKET.x, MARKET.z]] as [V2, V2])];
  for (const [g, from] of gates) {
    const L = Math.hypot(g[0] - from[0], g[1] - from[1]), u: V2 = [(g[0] - from[0]) / L, (g[1] - from[1]) / L];
    let best = 25;
    for (const st of streets) { const t = rayHit(g, u, st.a, st.b); if (t > 2 && t < 60 && t < best) best = t; }
    for (const c of others) {
      if (c.id === PLAZA_CLAIM || c.owner === 'market') continue;
      for (let i = 0; i < c.poly.length; i++) { const t = rayHit(g, u, c.poly[i], c.poly[(i + 1) % c.poly.length]); if (t > 2 && t < best) best = t; }
    }
    const a: V2 = [g[0] - u[0] * 1.5, g[1] - u[1] * 1.5], b: V2 = [g[0] + u[0] * best, g[1] + u[1] * best];
    lanes.push(strip(a, b, LANE_W / 2));
    streets.push({ a: g, b, width: LANE_W, rank: 2 });
  }
  const openings = plazaOpenings();

  // the superblocks between neighbouring angles and rings, each in its own frame, every hole cut out of it, split into
  // blocks and lots
  const blocks: Block[] = [];
  let pieceId = 0;
  for (const p of POINTS) {
    const angs = angles.map((a) => p.tip + ((((a - p.tip) % 360) + 540) % 360 - 180)).filter((a) => Math.abs(a - p.tip) <= 22.5 + 1e-6).sort((a, b) => a - b);
    for (let i = 0; i < angs.length - 1; i++) for (let j = 0; j < ks.length - 1; j++) {
      const a0 = angs[i], a1 = angs[i + 1], k0 = ks[j], k1 = ks[j + 1];
      let q = superblock(a0 * deg, a1 * deg, k0, k1, widthAt(((a0 % 360) + 360) % 360), widthAt(((a1 % 360) + 360) % 360));
      if (q.p.length < 3) continue;
      // no further out the point's axis than its tip square's middle (as the town's claims)
      const nx = Math.cos(p.tip * deg), nz = Math.sin(p.tip * deg);
      q = wind(clipHalf(q, nx, nz, nx * STAR.cx + nz * STAR.cz + WAYS.tip.r - MARGIN, 3));
      if (q.p.length < 3 || area(q.p) < 120) continue;
      // the frame: x along the longest of the best-ranked edges
      let best = 0, bestScore = -1;
      for (let e = 0; e < q.p.length; e++) {
        const a = q.p[e], b = q.p[(e + 1) % q.p.length];
        const sc = Math.hypot(b[0] - a[0], b[1] - a[1]) * (1 + q.f[e]);
        if (sc > bestScore) { bestScore = sc; best = e; }
      }
      const ea = q.p[best], eb = q.p[(best + 1) % q.p.length];
      const yaw = Math.atan2(-(eb[1] - ea[1]), eb[0] - ea[0]);
      // every hole cut out: the fences round the others' claims, the local squares, the passes
      let pieces: Poly[] = [q];
      const cutOut = (hole: V2[], front: Front, hb = bbox(hole)) => {
        const next: Poly[] = [];
        for (const pc of pieces) {
          const [x0, z0, x1, z1] = bbox(pc.p);
          if (!(x0 < hb[2] && hb[0] < x1 && z0 < hb[3] && hb[1] < z1)) { next.push(pc); continue; }
          next.push(...subtract(pc, hole, front).map(wind));
        }
        pieces = next;
      };
      for (const f of fences) cutOut(f.poly, f.front, f.box);
      // (and round what nobody claims: the slivers the layout leaves between the claims, too small to be the town's)
      for (const g of unclaimed(q.p)) cutOut(grow(g, MARGIN), 1);
      for (const sq of local) cutOut(sq, 3);
      for (const ps of passes) cutOut(ps, 2);
      for (const ln of lanes) cutOut(ln, 2);
      for (const op of openings) cutOut(op, 2);
      pieces = neighbours(pieces).filter((pc) => pc.p.length >= 3 && area(pc.p) >= 120);
      if (!pieces.length) continue;
      // (the frame's origin in the largest piece: the block's collider counts where it stands)
      const big = pieces.reduce((m, pc) => (area(pc.p) > area(m.p) ? pc : m));
      const o = centroid(big.p);
      const block: Block = { id: blocks.length, point: p.name, o, yaw, pieces: [], alleys: [] };
      const prng = rng.fork(1000 + block.id);
      for (const pc of pieces.map((q) => tidy(q))) {
        const localPoly = wind({ p: pc.p.map((pt) => toLocal(pt, o, yaw)), f: pc.f });
        const lots: Lot[] = [];
        divide(localPoly, prng, (pt) => toWorld(pt, o, yaw), lots, block.alleys, 0, false);
        block.pieces.push({ id: pieceId++, poly: localPoly, lots });
      }
      for (const al of block.alleys) streets.push({ a: toWorld(al.a, o, yaw), b: toWorld(al.b, o, yaw), width: al.width, rank: 1 });
      blocks.push(block);
    }
  }
  return { blocks, streets, ways, squares, floor };
}

/** a convex outline without its hair-short edges (where two cuts met at a corner, a few centimetres of one of them, its
 *  front taken for a whole corner's: a cornice wrapped round it out over the neighbour's ground): each one's first
 *  corner dropped, the edge before it run on to its end with its own front (the outline only shrinks) */
function tidy(q: Poly, min = 0.3): Poly {
  const p = [...q.p], f = [...q.f];
  for (let guard = 0; guard < 32 && p.length > 3; guard++) {
    let k = -1, best = min;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < best) { best = l; k = i; }
    }
    if (k < 0) break;
    p.splice(k, 1); f.splice(k, 1);
  }
  return { p, f };
}

/** the parts of a convex polygon no claim holds (the layout drops the town's slivers under 12 m²): what the town's lots
 *  keep back from as from anyone's */
function unclaimed(p: V2[]): V2[][] {
  const box = bbox(p);
  let left: V2[][] = [p];
  for (const c of CLAIMS) {
    if (!left.length) break;
    const cb = bbox(c.poly);
    if (cb[0] > box[2] || cb[2] < box[0] || cb[1] > box[3] || cb[3] < box[1]) continue;
    left = left.flatMap((q) => subtractConvex(q, c.poly));
  }
  return left.filter((q) => Math.abs(area(q)) > 1e-3);
}

/** Pieces cut round a hole (geom.ts subtract) meet one another along the lines of the hole's edges, and each takes the
 *  whole of its edge on such a line for the hole's front, though only a part of it looks onto the hole: past the
 *  hole's corner it looks onto the next piece, and a house there would put its door, its balcony and its outside stair
 *  into its neighbour's. So each piece's fronts are split where another piece's corner lies on them, and every part
 *  that looks onto another piece is a party wall (front 0) */
function neighbours(pieces: Poly[]): Poly[] {
  const boxes = pieces.map((q) => bbox(q.p));
  return pieces.map((pc, i) => {
    const n = pc.p.length, p: V2[] = [], f: Front[] = [];
    const others = pieces.filter((_, j) => j !== i && boxes[j][0] <= boxes[i][2] + 0.01 && boxes[i][0] <= boxes[j][2] + 0.01 && boxes[j][1] <= boxes[i][3] + 0.01 && boxes[i][1] <= boxes[j][3] + 0.01);
    for (let e = 0; e < n; e++) {
      const a = pc.p[e], b = pc.p[(e + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz, L = Math.sqrt(L2);
      if (pc.f[e] === 0 || !others.length || L < 1e-6) { p.push(a); f.push(pc.f[e]); continue; }
      // (where the other pieces' corners lie along this edge)
      const ts = [0, 1];
      for (const q of others) for (const v of q.p) {
        const t = ((v[0] - a[0]) * dx + (v[1] - a[1]) * dz) / L2, off = Math.abs((v[0] - a[0]) * dz - (v[1] - a[1]) * dx) / L;
        if (t > 1e-6 && t < 1 - 1e-6 && off < 1e-4) ts.push(t);
      }
      ts.sort((x, y) => x - y);
      const nx = dz / L, nz = -dx / L;
      let last: Front | -1 = -1;
      for (let k = 0; k < ts.length - 1; k++) {
        if (ts[k + 1] - ts[k] < 1e-6) continue;
        const tm = (ts[k] + ts[k + 1]) / 2, m: V2 = [a[0] + dx * tm + nx * 0.05, a[1] + dz * tm + nz * 0.05];
        const fr: Front = others.some((q) => insideConvex(m, q.p)) ? 0 : pc.f[e];
        // (a run of one front stays one edge)
        if (fr !== last) { p.push([a[0] + dx * ts[k], a[1] + dz * ts[k]]); f.push(fr); last = fr; }
      }
    }
    return { p, f };
  });
}

function insideConvex(pt: V2, p: V2[]): boolean {
  const s = area(p) >= 0 ? 1 : -1;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    // (outward along (dz, -dx) for a positive-area outline)
    if (s * ((b[1] - a[1]) * (pt[0] - a[0]) - (b[0] - a[0]) * (pt[1] - a[1])) > 1e-9) return false;
  }
  return true;
}

/** the polygon between two radials (angles a0 < a1, widths w0 w1: 0 where there's no street) and two rings k0 < k1, its
 *  edges along the rings single chords (the building line is straight within a half point), so it stays convex. Its
 *  inner edge on the ring road keeps MARGIN back from it, its outer edge leaves the rim street inside the building
 *  line, its edges on the avenues keep MARGIN back from them */
function superblock(a0: number, a1: number, k0: number, k1: number, w0: number, w1: number): Poly {
  const radial = (w: number): Front => (w === 0 ? 0 : w >= WAYS.avenue ? 3 : 2);
  const side = (w: number) => (w >= WAYS.avenue ? w / 2 + MARGIN : w / 2);
  const pts: V2[] = [ring(a0, k0), ring(a1, k0), ring(a1, k1), ring(a0, k1)];
  const fronts: Front[] = [k0 === 0 ? 3 : 2, radial(w1), 2, radial(w0)];
  return wind(inset({ p: pts, f: fronts }, [k0 === 0 ? MARGIN : RING_W / 2, side(w1), k1 === 1 ? RIM_W : RING_W / 2, side(w0)]));
}

/** split a piece (in its superblock's frame) into blocks with alleys, then lots: houses, courtyards no street reaches,
 *  gardens (a whole block of them now and then, near the pools and out toward the rim) */
function divide(q: Poly, rng: Rng, world: (p: V2) => V2, lots: Lot[], alleys: Alley[], depth: number, garden: boolean) {
  if (q.p.length < 3) return;
  const A = area(q.p);
  if (A < 30) return;
  const [x0, z0, x1, z1] = bbox(q.p);
  const w = x1 - x0, h = z1 - z0;
  const c = centroid(q.p), cw = world(c);
  const wl = wealthAt(cw);
  // lot sizes by wealth: frontage along x, depth along z (the frame's x runs along the street)
  const F = 7.5 + wl * 9, D = 10 + wl * 7;
  const BLOCK = 46 + wl * 22;
  const isBlock = w > BLOCK || h > BLOCK * 0.9;
  // (a block of lots, the first time one isn't to be split by alleys: now and then all of it a garden)
  if (!isBlock && !garden && depth > 0 && Math.max(...q.f) < 3 && rng.chance(gardenOdds(cw) * 0.45)) garden = true;
  if (!isBlock && ((w <= F * 1.45 && h <= D * 1.5) || A < F * D * 1.25)) {
    // (slivers left where a frame meets a slanted street stay open ground)
    if (A < 26 || A / perimeter(q.p) ** 2 < 0.028) return;
    const front = Math.max(...q.f) as Front;
    const seedN = Math.floor(rng.next() * 1e9), wealth = Math.max(0, Math.min(1, wl + rng.range(-0.1, 0.1)));
    // (a lot no street reaches: an open courtyard now and then, mostly a house behind its neighbours, reached through
    // them, its roof among theirs)
    const kind: Lot['kind'] = front === 0 ? (garden || rng.chance(0.35) ? 'court' : 'house') : front < 3 && (garden || rng.chance(gardenOdds(cw) * 0.4)) && A > 40 ? 'garden' : 'house';
    lots.push({ poly: q, wealth, kind, seed: seedN });
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
    if (zs) alleys.push({ a: cutX ? [at, zs[0]] : [zs[0], at], b: cutX ? [at, zs[1]] : [zs[1], at], width: gap });
  }
  divide(wind(lo), rng, world, lots, alleys, depth + 1, garden);
  divide(wind(hi), rng, world, lots, alleys, depth + 1, garden);
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
