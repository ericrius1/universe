// The east's water (round 6, B3e), laid as the canal's (its claims: water/canal, tank, sluice, gate, cascade, plain-…),
// and the pieces the east's builders share (the palace, the rim, the pools). The water leaves the palace's back and
// runs east through the point to the tip: the canal (CHANNEL.canal) from a paved landing at the palace's back terrace
// (the canal-head port) down a flight of water steps, eight metres of it between cream copings on broad quays with
// cypress in planters and lamps along them; the tank (CHANNEL.tank: the last of POOLS), an ellipse ninety metres long
// in a coping with a paved promenade round it, the canal and the sluice coming to it under the promenade's causeways;
// the sluice on east between its quays to the water gate (rim.ts: its towers), where the sluice's gate hangs raised
// in its grooves from a beam over the walk across the water (the water-gate port), and on to a weir at the cliff's lip
// (the quays' ends a balcony over it). There it falls in three cascades down the east chute (CASCADES: the lip, then
// the two benches the land cuts at CHANNEL.cascade's middle levels, a stone basin on each, then the plain), into a
// plunge pool at the cliff's foot, and away across the plain in a channel between stone kerbs (CHANNEL.plain) six
// kilometres to the horizon. All of it at CHANNEL.level on its bed (CHANNEL.bed: the land cuts it there; the
// tank's bed is the land's pool bed at -2.4) as WaterBody entries in the city's part, each a pool's outline so they
// meet without overlapping (the water's sheets laid twice would fight).
import type { ArchBuilder } from '../arch/builder';
import { offsetPath } from '../arch/builder';
import { MAT, type Mat, type V3 } from '../arch/types';
import { balustrade, type BalusterKind, type Detail } from '../arch/parts';
import { CHANNEL, FLOOR_Y, GATE, PLAIN_Y, POOLS, sdStar, starReach, type V2 } from '../world/layout';
import type { City, Collide } from './ctx';
import { planter } from './props';

// ------------------------------------------------------------------------------------------------- what's shared

/** the floor the east's squares, quays and walks are paved at: 3 cm over the town's floor (PROUD over the ground, and
 *  within a port's 5 cm of its height) */
export const PAVE = FLOOR_Y + 0.03;

/** a plan rectangle's outline */
export const rect = (x0: number, z0: number, x1: number, z1: number): V2[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

/** a regular n-gon round (cx, cz) whose faces stand `apothem` from its middle, a face square to +x (an octagon's flat
 *  sides along the axes) */
export function ngonAt(cx: number, cz: number, apothem: number, n = 8): V2[] {
  const R = apothem / Math.cos(Math.PI / n);
  return Array.from({ length: n }, (_, i) => { const a = ((i + 0.5) / n) * Math.PI * 2; return [cx + Math.cos(a) * R, cz + Math.sin(a) * R] as V2; });
}

/** a polygon's outline moved out by d (convex, any winding) */
export function grow(p: V2[], d: number): V2[] {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  // (offsetPath moves to the left of travel: a positive-area loop here runs with its outside on the left)
  return offsetPath(p, a > 0 ? d : -d, true);
}

/** where the ray from c at angle a leaves a convex polygon round c */
function rayOut(p: V2[], c: V2, a: number): V2 {
  const dx = Math.cos(a), dz = Math.sin(a);
  let best = Infinity;
  for (let i = 0; i < p.length; i++) {
    const q = p[i], r = p[(i + 1) % p.length], ex = r[0] - q[0], ez = r[1] - q[1], den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((q[0] - c[0]) * ez - (q[1] - c[1]) * ex) / den, u = Math.abs(ex) > Math.abs(ez) ? (c[0] + dx * t - q[0]) / ex : (c[1] + dz * t - q[1]) / ez;
    if (t > 0 && u > -1e-9 && u < 1 + 1e-9) best = Math.min(best, t);
  }
  return [c[0] + dx * best, c[1] + dz * best];
}

/** the flat ring between a convex outline and a convex hole in it (both round c), facing up at y (or down): a quad
 *  between each pair of the two outlines' corners taken in turn round c, so it meets both exactly (a square's paving
 *  round a basin, an entablature's top round a drum). `also`: more points whose ways from c it breaks at too, so two
 *  rings laid against each other (a border round a field) share every corner along the edge between them (no corner
 *  of one lying along the other's edge: rotated into the world, the two would part or overlap by a hair along it) */
export function between(b: ArchBuilder, outer: V2[], inner: V2[], c: V2, y: number, mat: Mat, down = false, also: V2[] = []) {
  const ang = (q: V2) => { const a = Math.atan2(q[1] - c[1], q[0] - c[0]); return a < 0 ? a + Math.PI * 2 : a; };
  const as = [...new Set([...outer, ...inner, ...also].map((q) => Math.round(ang(q) * 1e9) / 1e9))].sort((p, q) => p - q);
  for (let i = 0; i < as.length; i++) {
    const a0 = as[i], a1 = i + 1 < as.length ? as[i + 1] : as[0] + Math.PI * 2;
    const o0 = rayOut(outer, c, a0), o1 = rayOut(outer, c, a1), i0 = rayOut(inner, c, a0), i1 = rayOut(inner, c, a1);
    // (with z south, (i0 o0 o1 i1) turning with the angle runs clockwise seen from above: up is its other way round)
    const P = (q: V2): [number, number, number] => [q[0], y, q[1]];
    if (down) b.quad(P(i0), P(o0), P(o1), P(i1), mat);
    else b.quad(P(i1), P(o1), P(o0), P(i0), mat);
  }
}

/** a balustrade from a to z (local plan) standing on y, its balusters drawn instanced (parts/protos.ts 'baluster-…'):
 *  its newels, plinth and rail laid, h tall to its rail's top (0.94: the instanced baluster's own 0.68 between them) */
export function balustradeRun(c: City, a: V2, z: V2, y: number, o: { kind?: BalusterKind; post?: number; detail?: Detail; seed?: number } = {}) {
  const b = c.b, dx = z[0] - a[0], dz = z[1] - a[1], L = Math.hypot(dx, dz);
  if (L < 0.5) return;
  const kind = o.kind ?? 'turned';
  b.group(() => {
    b.at((a[0] + z[0]) / 2, y, (a[1] + z[1]) / 2, Math.atan2(-dz, dx));
    // (mid: the newels' turned balls left off, a third of a long run's triangles)
    const r = balustrade(b, { len: L, h: 0.94, kind, post: o.post ?? 2.6, placesOnly: true, detail: o.detail ?? 'mid', seed: o.seed });
    for (const x of r.at) b.place(`baluster-${kind}`, [x, r.y, 0]);
  });
}

/** what a collider's boxes are laid through: Collide's own calls */
export type Col = Pick<Collide, 'solid' | 'floor' | 'stair'>;
/** a collider whose frame is the current one moved to (x, z) — its origin there, inside the claims it serves (each
 *  district's budget counts the colliders whose origins it holds) — taking points in the current frame */
export function collideAt(c: City, name: string, x: number, z: number): Col {
  let col!: Collide;
  c.b.group(() => { c.b.at(x, 0, z); col = c.collide(name); });
  const k: Col = {
    solid: (x0, z0, x1, z1, y0, y1) => { col.solid(x0 - x, z0 - z, x1 - x, z1 - z, y0, y1); return col; },
    floor: (x0, z0, x1, z1, h, open) => { col.floor(x0 - x, z0 - z, x1 - x, z1 - z, h, open); return col; },
    stair: (x0, z0, x1, z1, base, rise, axis, sign) => { col.stair(x0 - x, z0 - z, x1 - x, z1 - z, base, rise, axis, sign); return col; },
  };
  return k;
}

/** a lamp post drawn instanced at a local point (on the floor it stands on) */
export const lampAt = (b: ArchBuilder, x: number, y: number, z: number, scale = 1) => b.place('lantern-post', [x, y, z], { scale });

/** a flight's treads and risers only (no sides: it runs between walls), from the bottom edge's middle a to the top
 *  edge's middle z, `width` wide, in n steps */
export function treads(b: ArchBuilder, a: V3, z: V3, width: number, n: number, mat: Mat) {
  const dx = z[0] - a[0], dz = z[2] - a[2], run = Math.hypot(dx, dz) || 1;
  const rx = (-dz / run) * width / 2, rz = (dx / run) * width / 2;
  for (let k = 0; k < n; k++) {
    const ta = k / n, tb = (k + 1) / n, ya = a[1] + (z[1] - a[1]) * ta, yb = a[1] + (z[1] - a[1]) * tb;
    const ax = a[0] + dx * ta, az = a[2] + dz * ta, bx = a[0] + dx * tb, bz = a[2] + dz * tb;
    b.quad([ax - rx, ya, az - rz], [ax + rx, ya, az + rz], [ax + rx, yb, az + rz], [ax - rx, yb, az - rz], mat);
    b.quad([ax + rx, yb, az + rz], [bx + rx, yb, bz + rz], [bx - rx, yb, bz - rz], [ax - rx, yb, az - rz], mat);
  }
}

/** a vertical face from plan point a to z between y0 and y1, facing to the left of the way a -> z as seen from above
 *  (z south: walking south, the face looks east) */
export function face(b: ArchBuilder, a: V2, z: V2, y0: number, y1: number, mat: Mat) {
  b.quad([z[0], y0, z[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [z[0], y1, z[1]], mat);
}

// ------------------------------------------------------------------------------------------------- the water

/** the water's half-width (the canal's, the sluice's), its level and its bed */
const W = CHANNEL.width / 2, LEVEL = CHANNEL.level, BED = CHANNEL.bed;
/** the copings along the water (a raised kerb W to W + w out, h high), the quays' outer edge (the claims') */
const COPE = { w: 0.6, h: 0.3 }, QUAY = 12;
/** the canal's head: its landing (from the canal-head port), its water steps down to the bed */
const HEAD = { x: CHANNEL.canal[0][0], landing: 4, steps: 3.5, n: 8 };
/** the tank (the last of the pools) and its promenade: the coping's width round its water, the promenade's outer edge
 *  out from it (inside its claim's 4 m), the promenade's floor a step over the quays' */
const TANK = POOLS[POOLS.length - 1];
const PROM = { cope: 0.6, out: 3.8, y: PAVE + 0.03 };
/** the water gate's claims along the sluice (its towers either side, the gate's water between) */
const GATE_X0 = GATE.x - 15, GATE_X1 = GATE.x + 15;
/** the walk across the sluice at the water gate (the water-gate port: its floor at the town's), the sluice's posts */
const WALK = { x0: GATE.x - 1.5, x1: GATE.x + 1.5, post: 0.6 };
/** the cliff's lip on the east axis, where the weir is and the first cascade falls */
const LIP = starReach(0);
/** the quays' balcony out to the lip either side of the weir: how far out across them it reaches */
const BALCONY = 6;

/** the cascades down the east chute: each one's line across the chute (x) — the lip, then the ends of the two benches
 *  the land cuts in the chute at CHANNEL.cascade's middle levels (14 m and 16 m deep, as land/blockout.ts cuts them) —
 *  each bench's basin (its water `over` its floor), and the plain's water the last one falls into */
export const CASCADES = {
  x: [LIP, LIP + 14, LIP + 30],
  bench: [CHANNEL.cascade[1], CHANNEL.cascade[2]],
  over: 0.62,
  plain: CHANNEL.plain.level,
};

/** the east's water (see the header), under 'canal' */
export function buildWater(c: City) {
  c.b.owner('canal', () => {
    c.b.owner('canal', () => canal(c));
    c.b.owner('tank', () => tank(c));
    c.b.owner('sluice', () => sluice(c));
    c.b.owner('cascades', () => cascades(c));
    c.b.owner('plain', () => plain(c));
  });
}

// ---- the tank's rings: ellipses round it d out from its water, their points at one set of turns (the same for every
// ring, with the turns where the outermost crosses the quays' lines added, so the quays end on its points)
const TURNS: number[] = (() => {
  const bz = TANK.rz + PROM.out, out: number[] = [];
  for (const zz of [W, W + COPE.w, QUAY]) { const t = Math.asin(zz / bz); out.push(t, -t, Math.PI - t, Math.PI + t); }
  const n = 72;
  for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; if (out.every((q) => Math.abs(((q - t + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) > 0.02)) out.push(t); }
  return out.map((t) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).sort((p, q) => p - q);
})();
/** a ring of the tank d out (its points turning from east toward south: clockwise seen from above) */
const ell = (d: number): V2[] => TURNS.map((t) => [TANK.x + (TANK.rx + d) * Math.cos(t), TANK.z + (TANK.rz + d) * Math.sin(t)] as V2);
/** where a ring d out crosses the line z on the west (side -1) or the east (+1) */
const ringX = (d: number, side: -1 | 1, z: number) => TANK.x + side * (TANK.rx + d) * Math.sqrt(Math.max(0, 1 - ((z - TANK.z) / (TANK.rz + d)) ** 2));
/** a ring's points on one side between z0 and z1 (inclusive, a hair's slack), by z rising */
const ringSide = (d: number, side: -1 | 1, z0: number, z1: number): V2[] =>
  ell(d).filter(([x, z]) => Math.sign(x - TANK.x) === side && z >= z0 - 1e-6 && z <= z1 + 1e-6).sort((p, q) => p[1] - q[1]);

/** the warm stone of the quays and the promenade (tints) */
const QUAY_TINT: V3 = [1.04, 0.92, 0.8], PROM_TINT: V3 = [1.08, 0.96, 0.84];

/** the canal: the landing at its head, its water steps, its walls and copings, its quays, its bed, its water */
function canal(c: City) {
  const b = c.b, x0 = HEAD.x, xs = x0 + HEAD.landing, xb = xs + HEAD.steps, cw = W + COPE.w;
  const xe = (z: number) => ringX(PROM.out, -1, z);
  const col = collideAt(c, 'city/canal', (x0 + TANK.x - TANK.rx) / 2, 0);
  // the landing and the quays, one outline round the head of the water and its copings
  const quays: V2[] = [[x0, -QUAY], ...ringSide(PROM.out, -1, -QUAY, -cw), [xs, -cw], [xs, cw], ...ringSide(PROM.out, -1, cw, QUAY), [x0, QUAY]];
  b.with({ tint: QUAY_TINT }, () => b.slab(quays, PAVE, MAT.PAVING));
  col.floor(x0, -QUAY, xs, QUAY, PAVE);
  quayFloors(col, xs, (z) => xe(z), cw);
  // the water steps from the landing down to the bed between the canal's walls
  treads(b, [xb, BED + 0.03, 0], [xs, PAVE, 0], 2 * W, HEAD.n, MAT.ASHLAR);
  col.stair(xs, -W, xb, W, BED + 0.03, PAVE - BED - 0.03, 0, -1);
  // the walls and copings either side, from the steps to the tank's promenade
  for (const s of [-1, 1] as const) copingRun(c, col, s, [xs, xs], [xe(s * W), xe(s * cw)], true, { start: PAVE, end: PROM.y });
  // the bed and the water, from the steps (the water from their top) to the promenade's causeway
  const end = ringSide(PROM.out, -1, -W, W);
  b.slab([[xb, -W], ...end, [xb, W]], BED + 0.03, MAT.POOL);
  c.pool([[xs, -W], ...end, [xs, W]], LEVEL, LEVEL - BED);
  // cypress in planters down the quays, lamps between them by the water
  for (let k = 0; k < 7; k++) for (const s of [-1, 1]) {
    const x = xs + 7 + k * 7.6, z = s * 9.4;
    planter(c, x, z, 1.0, 0.6, 'cypress', PAVE);
    col.solid(x - 1.0, z - 1.0, x + 1.0, z + 1.0, 0, 0.72);
    if (k % 2 === 0 && k < 6) lampAt(b, x + 3.8, PAVE, s * (cw + 1.0));
  }
}

/** a quay's floors from x0 out to where a curve xEnd(z) ends it (the tank's promenade), |z| from zIn to QUAY, both
 *  sides: strips a metre deep, each to the nearer end of its strip */
function quayFloors(col: Col, x0: number, xEnd: (z: number) => number, zIn: number) {
  for (const s of [-1, 1]) for (let z = zIn; z < QUAY - 1e-6; z += 1) {
    const z1 = Math.min(QUAY, z + 1), xa = Math.min(xEnd(s * z), xEnd(s * z1));
    col.floor(Math.min(x0, xa), s * z, Math.max(x0, xa), s * z1, PAVE);
  }
}

/** a run of the water's wall and its coping on side s (-1 north, 1 south) from x0 to x1 (each [where the wall's line
 *  at |z| W is, where the coping's outer edge is]: an end along the tank's promenade isn't square): the wall's face
 *  to the water from the bed to the coping's top, the coping's top and its face onto the quay, its ends where a floor
 *  is given for them to stand on (`raised`: a kerb COPE.h high; else flush with the quay, a cream edge in its paving) */
function copingRun(c: City, col: Col, s: -1 | 1, x0: [number, number], x1: [number, number], raised: boolean, ends: { start?: number; end?: number } = {}) {
  const b = c.b, zi = s * W, zo = s * (W + COPE.w), top = raised ? COPE.h : PAVE;
  const I0: V2 = [x0[0], zi], O0: V2 = [x0[1], zo], I1: V2 = [x1[0], zi], O1: V2 = [x1[1], zo];
  // (a face looks to the left of its way seen from above: along the north side westward it looks south, at the water)
  if (s > 0) face(b, I0, I1, BED, top, MAT.ASHLAR); else face(b, I1, I0, BED, top, MAT.ASHLAR);
  b.slab([I0, I1, O1, O0], top, MAT.CREAM);
  if (!raised) return;
  if (s > 0) face(b, O1, O0, PAVE, top, MAT.CREAM); else face(b, O0, O1, PAVE, top, MAT.CREAM);
  // its ends: the start looking west, the end east (each from the floor before it)
  if (ends.start !== undefined) { if (s > 0) face(b, O0, I0, ends.start, top, MAT.CREAM); else face(b, I0, O0, ends.start, top, MAT.CREAM); }
  if (ends.end !== undefined) { if (s > 0) face(b, I1, O1, ends.end, top, MAT.CREAM); else face(b, O1, I1, ends.end, top, MAT.CREAM); }
  col.solid(Math.min(x0[0], x0[1]), Math.min(zi, zo), Math.max(x1[0], x1[1]), Math.max(zi, zo), 0, top);
}

/** the tank: its coping (its face to the water, its top, its face onto the promenade), the promenade round it (a step
 *  up from the quays; over the canal's and the sluice's mouths a causeway, its face to the water down to the bed),
 *  lamps round it, its water */
function tank(c: City) {
  const b = c.b, ctr: V2 = [TANK.x, TANK.z], PT = ell(0), PI = ell(PROM.cope), PO = ell(PROM.out), n = PT.length;
  const col = collideAt(c, 'city/tank', TANK.x, TANK.z);
  between(b, PI, PT, ctr, COPE.h, MAT.CREAM);
  b.with({ tint: PROM_TINT }, () => between(b, PO, PI, ctr, PROM.y, MAT.PAVING));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // (the rings run clockwise seen from above: a face along them looks out, the other way round in)
    face(b, PT[j], PT[i], LEVEL - 0.55, COPE.h, MAT.ASHLAR);
    face(b, PI[i], PI[j], PROM.y, COPE.h, MAT.CREAM);
    const mouth = Math.abs((PO[i][1] + PO[j][1]) / 2 - TANK.z) < W;
    face(b, PO[i], PO[j], mouth ? BED : FLOOR_Y - 0.05, PROM.y, mouth ? MAT.ASHLAR : MAT.CREAM);
  }
  // the causeways' floors over the mouths (elsewhere the promenade lies on the town's floor)
  for (const s of [-1, 1] as const) col.floor(Math.min(ringX(PROM.out, s, 0), ringX(PROM.cope, s, 0)), -W - COPE.w, Math.max(ringX(PROM.out, s, 0), ringX(PROM.cope, s, 0)), W + COPE.w, PROM.y);
  c.pool(PT, LEVEL, LEVEL + 2.4);
  for (let k = 0; k < 12; k++) {
    const t = ((k + 0.5) / 12) * Math.PI * 2;
    lampAt(b, TANK.x + (TANK.rx + PROM.out - 0.8) * Math.cos(t), PROM.y, TANK.z + (TANK.rz + PROM.out - 0.8) * Math.sin(t));
  }
}

/** the sluice: on from the tank's promenade between its copings and quays to the water gate, through the gate between
 *  flush edges and its narrow quays, across the walk under its raised gate, to the weir at the lip and the balcony
 *  over it */
function sluice(c: City) {
  const b = c.b, cw = W + COPE.w, xe = (z: number) => ringX(PROM.out, 1, z), wx = LIP - 0.6;
  const col = collideAt(c, 'city/sluice', (GATE_X0 + ringX(PROM.out, 1, 0)) / 2, 0);
  // the quays from the promenade to the gate's claims
  b.with({ tint: QUAY_TINT }, () => {
    for (const s of [-1, 1] as const) {
      const arc = ringSide(PROM.out, 1, s < 0 ? -QUAY : cw, s < 0 ? -cw : QUAY);
      b.slab(s < 0 ? [...arc, [GATE_X0, -cw], [GATE_X0, -QUAY]] : [...arc, [GATE_X0, QUAY], [GATE_X0, cw]], PAVE, MAT.PAVING);
    }
  });
  for (const s of [-1, 1]) for (let z = cw; z < QUAY - 1e-6; z += 1) {
    const z1 = Math.min(QUAY, z + 1), xa = Math.max(xe(s * z), xe(s * z1));
    col.floor(xa, s * z, GATE_X0, s * z1, PAVE);
  }
  for (const s of [-1, 1] as const) copingRun(c, col, s, [xe(s * W), xe(s * cw)], [GATE_X0, GATE_X0], true, { start: PROM.y, end: PAVE });
  // through the gate and out to the balcony: the walls flush with the quays, a cream edge, the quays' paving (broken
  // where the walk crosses, so each piece shares its corners), the balcony's
  const xs = [GATE_X0, WALK.x0, WALK.x1, GATE_X1, wx];
  for (const s of [-1, 1] as const) {
    for (let i = 0; i + 1 < xs.length; i++) {
      const a = xs[i], z1 = xs[i + 1], out = z1 > GATE_X1 + 1e-6 ? BALCONY : GATE.width / 2 - 1.5;
      copingRun(c, col, s, [a, a], [z1, z1], false);
      b.with({ tint: QUAY_TINT }, () => b.slab(rect(a, s < 0 ? -out : cw, z1, s < 0 ? -cw : out), PAVE, MAT.PAVING));
      col.floor(a, s * W, z1, s * out, PAVE);
    }
    // the balcony's balustrade along the water and across its end over the cascade
    const xb = wx - 0.3;
    // (the end's first newel clear of the side's last: two laid in one place would fight)
    balustradeRun(c, [GATE_X1, s * (W + 0.3)], [xb, s * (W + 0.3)], PAVE, { seed: 11 });
    balustradeRun(c, [xb, s * (W + 0.7)], [xb, s * (BALCONY - 0.2)], PAVE, { seed: 12 });
    col.solid(GATE_X1, s * W, xb + 0.2, s * (W + 0.5), 0, 0.94).solid(xb - 0.2, s * W, xb + 0.2, s * BALCONY, 0, 0.94);
  }
  // the bed and the water from the promenade to the weir (the water to the lip, over the weir's sill)
  const start = ringSide(PROM.out, 1, -W, W).reverse();
  b.slab([...start, [wx, -W], [wx, W]], BED + 0.03, MAT.POOL);
  c.pool([...start, [LIP, -W], [LIP, W]], LEVEL, LEVEL - BED);
  // the weir: a sill across the lip the water slips over to the first cascade
  b.box(wx, BED, -W, LIP, LEVEL - 0.05, W, MAT.CREAM, { skip: ['bottom', 'n', 's'] });
  sluiceGate(c, col);
  // palms down the quays, lamps by the water
  for (let k = 0; k < 5; k++) for (const s of [-1, 1]) {
    const x = 700 + k * 9.5, z = s * 9.4;
    planter(c, x, z, 1.2, 0.6, 'palms', PAVE);
    col.solid(x - 1.2, z - 1.2, x + 1.2, z + 1.2, 0, 0.72);
    if (k % 2 === 1) lampAt(b, x, PAVE, s * (cw + 1.0));
  }
}

/** the sluice's gate at the water gate: the walk across the water (a slab over it, its top the town's floor); just
 *  upstream of it, clear of the walk, two posts in grooves against the walls, the beam across them, the gate's two
 *  leaves raised under it */
function sluiceGate(c: City, col: Col) {
  const b = c.b, x = WALK.x0 - 0.5, p = WALK.post / 2, beam = 3.6;
  b.box(WALK.x0, -0.25, -W, WALK.x1, PAVE, W, MAT.ASHLAR, { top: MAT.PAVING, skip: ['n', 's'] });
  col.floor(WALK.x0, -W, WALK.x1, W, PAVE);
  for (const s of [-1, 1]) {
    const z0 = s * (W - 0.6), z1 = s * W;
    b.box(x - p, BED, Math.min(z0, z1), x + p, beam, Math.max(z0, z1), MAT.CREAM, { skip: ['bottom', 'top', s < 0 ? 'n' : 's'] });
    col.solid(x - p, Math.min(z0, z1), x + p, Math.max(z0, z1), -2, beam);
  }
  b.box(x - 0.36, beam, -W - 0.2, x + 0.36, beam + 0.45, W + 0.2, MAT.WOOD);
  b.box(x - 0.12, 2.3, -(W - 0.6), x + 0.12, beam, W - 0.6, MAT.WOOD, { skip: ['top', 'n', 's'] });
}

/** the three cascades down the chute and the basins on its benches: each basin's floor, its walls along the chute, its
 *  lip the water spills over, its water; the cascades' sheets just out from the lips they fall from */
function cascades(c: City) {
  // (the basins' walls inside the chute's narrowest, the blockout's 11 m: the land's metre texels there still read
  // the bench's floor)
  const b = c.b, X = CASCADES.x, wb = W, tops: number[] = [LEVEL];
  for (let i = 0; i < 2; i++) {
    const y = CASCADES.bench[i], x0 = X[i], x1 = X[i + 1], lip = x1 - 0.6, water = y + CASCADES.over;
    b.slab(rect(x0, -wb, lip, wb), y + 0.04, MAT.POOL);
    for (const s of [-1, 1]) b.box(x0, y - 0.3, s < 0 ? -wb - 0.5 : wb, lip, water + 0.25, s < 0 ? -wb : wb + 0.5, MAT.ASHLAR, { top: MAT.CREAM, skip: ['bottom', 'w'] });
    b.box(lip, y - 0.3, -wb - 0.5, x1, water - 0.02, wb + 0.5, MAT.CREAM, { skip: ['bottom'] });
    c.pool(rect(x0, -wb, lip, wb), water, water - y - 0.04);
    tops.push(water);
  }
  for (let i = 0; i < 3; i++) c.water.push({ kind: 'cascade', a: [X[i] + 0.15, -W], b: [X[i] + 0.15, W], top: tops[i] + 0.04, bottom: i < 2 ? tops[i + 1] : CASCADES.plain });
}

/** the channel across the plain: the plunge pool at the cliff's foot and the water on along the plain's path, between
 *  stone kerbs from the cliff's foot to its end, each reach's kerbs stopping short of the bends (the claims run
 *  straight along each reach: a mitred corner would stand outside them), the water running on round them */
function plain(c: City) {
  const b = c.b, P = CHANNEL.plain, hw = P.halfWidth, kw = 0.6, path: V2[] = [[CASCADES.x[2], 0], ...P.path];
  const water = [...offsetPath(path, hw), ...offsetPath(path, -hw).reverse()];
  c.pool(water, P.level, P.level - P.bed);
  // (the kerbs from where the cliff's foot, a 2.4:1 slope from the lip's 6 m, has come down to the plain beside them)
  let x0 = LIP;
  while (sdStar(x0, hw + kw) < (6 - PLAIN_Y) / 2.4 + 1) x0 += 0.5;
  const kerb: V2[] = [[x0, 0], ...P.path.filter(([x]) => x > x0 + 1)];
  const dir = (i: number): V2 => { const a = kerb[i], z = kerb[i + 1], L = Math.hypot(z[0] - a[0], z[1] - a[1]); return [(z[0] - a[0]) / L, (z[1] - a[1]) / L]; };
  const short = (i: number) => {
    if (i <= 0 || i >= kerb.length - 1) return 0;
    const p = dir(i - 1), q = dir(i), turn = Math.acos(Math.min(1, p[0] * q[0] + p[1] * q[1]));
    return (hw + kw) * Math.tan(turn / 2) + 0.3;
  };
  for (let i = 0; i + 1 < kerb.length; i++) {
    const d = dir(i), a0 = short(i), a1 = short(i + 1);
    const A: V2 = [kerb[i][0] + d[0] * a0, kerb[i][1] + d[1] * a0], Z: V2 = [kerb[i + 1][0] - d[0] * a1, kerb[i + 1][1] - d[1] * a1];
    for (const s of [-1, 1]) {
      const n: V2 = [-d[1] * s * (hw + kw / 2), d[0] * s * (hw + kw / 2)];
      b.wall([[A[0] + n[0], A[1] + n[1]], [Z[0] + n[0], Z[1] + n[1]]], P.bed - 0.1, PLAIN_Y + 0.3, kw, MAT.ASHLAR, { cap: MAT.CREAM, capH: 0.12, capOut: 0.05 });
    }
  }
}
