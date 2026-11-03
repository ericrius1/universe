// The Haven's own plan, derived from the world layout (TEMPLE, MESA, GARDENS, STAIR): the garden wedges as radial bands
// (band k of a wedge lies between radii R_k and R_k+1 round the temple and its floor is MESA.topY - k·drop), the gaps
// between the wedges and what fills each (a descending blade ramp, a level promenade, the grand stair's notch, or the
// open forecourt to the north), each band's angular reach at a radius (wedges reach sideways to the causeway or the
// notch beside them, so their edges are straight lines, not radii), the ramps' deck profile, the stair's flights and
// the floor of the notch it climbs and the garden courts between its flights, and havenGround: the height the land
// should carve the ground to under all of it. Everything here is a pure function of the layout; the builders read it.
import { GARDENS, MESA, STAIR, TEMPLE, type GardenWedge, type V2 } from '../world/layout';

export { GARDENS };

/** the temple's centre in plan, and the gardens' top level */
export const C: V2 = [TEMPLE.x, TEMPLE.z];
export const TOP = MESA.topY;
/** walks stand this far above the carved floor (their slabs hide the terrain); planting beds and pool floors lie lower */
export const WALK = 0.6;
export const BED = 0.25;
export const POOL_FLOOR = 0.15;
export const WATER = 0.45;
export const COPING = 0.75;
/** a retaining wall's top (its planter trough's rims) above the floor of the terrace it edges, and its span about the
 *  band radius R: [R - WALL_IN, R + WALL_OUT] */
export const PARAPET = 1.3;
export const WALL_IN = 0.8;
export const WALL_OUT = 0.4;
/** how far walls reach below the floor they stand on, to meet whatever the land leaves lower */
export const FOOT = 6;
/** a causeway's (ramp's, promenade's) half-width over its parapets */
export const CAUSEWAY_H = GARDENS.rampWidth / 2 + 0.55;

export const DEG = Math.PI / 180;
export const polar = (r: number, a: number): V2 => [C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)];
export const radius = (x: number, z: number) => Math.hypot(x - C[0], z - C[1]);
export const angle = (x: number, z: number) => Math.atan2(z - C[1], x - C[0]);
/** the signed difference a - b wrapped into (-π, π] */
export const adiff = (a: number, b: number) => { let d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d <= -Math.PI) d += 2 * Math.PI; return d; };

export interface Band { k: number; r0: number; r1: number; floor: number; walk: number }

/** what bounds a wedge on one side: its own radial edge, a causeway (ramp or promenade) along a gap, or the notch */
export interface Side { kind: 'radial' | 'ramp' | 'promenade' | 'stair'; line: V2[] }

export interface Wedge {
  i: number;
  w: GardenWedge;
  /** the spine's angle (the wedge's middle) */
  am: number;
  kind: 'flank' | 'top';
  bands: Band[];
  lo: Side;
  hi: Side;
}

export interface Gap {
  lo: Wedge;
  hi: Wedge;
  /** the gap's centre line */
  a: number;
  kind: 'ramp' | 'promenade' | 'stair' | 'open';
}

/** the stair's landings (walk level) and flights between them: a flight from landing i to i+1 starts where its sides
 *  leave landing i's round platform and ends where they meet the next */
export const LANDING_R = 10;
export interface Flight { i: number; a: V2; b: V2; ya: number; yb: number; dir: V2; len: number }

const landings = STAIR.landings.map(([x, z, y]) => [x, z, y + WALK] as [number, number, number]);
const flightInset = Math.sqrt(LANDING_R * LANDING_R - (STAIR.width / 2) ** 2);
export const LANDINGS = landings;
export const FLIGHTS: Flight[] = landings.slice(0, -1).map((p, i) => {
  const q = landings[i + 1];
  const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz);
  const dir: V2 = [dx / L, dz / L];
  return {
    i, dir, ya: p[2], yb: q[2], len: L - 2 * flightInset,
    a: [p[0] + dir[0] * flightInset, p[1] + dir[1] * flightInset],
    b: [q[0] - dir[0] * flightInset, q[1] - dir[1] * flightInset],
  };
});

/** the landings with a dwelling's door in the notch's wall beside them: the landing, which wall, how many storeys */
export const LANDING_DOORS: [number, 'east' | 'west', number][] = [[3, 'west', 3], [5, 'east', 3], [6, 'east', 3], [7, 'west', 1]];

/** the courts in the notch: the spaces the stair's zig-zag leaves between its flights, each a terrace level with the
 *  landing it opens off (outline counter-clockwise on a north-up map, x then z; beds as [x0, z0, x1, z1]) */
export interface Court { poly: V2[]; floor: number; landing: number; beds: [number, number, number, number][] }
const lv = (i: number) => STAIR.landings[i][2];
/** an outline turned to run counter-clockwise on a north-up map (z south) */
export function ccwMap(p: V2[]): V2[] {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; }
  return a < 0 ? p : [...p].reverse();
}
export const COURTS: Court[] = [
  { poly: ccwMap([[-41.5, -436], [-3.5, -436], [-3.5, -480.0], [-41.5, -463.9]]), floor: lv(3), landing: 3, beds: [[-36, -458, -24, -444], [-20, -468, -9, -444]] },
  { poly: ccwMap([[-2.5, -478.9], [7.5, -481.2], [10.2, -486.7], [49.6, -508.6], [63, -511], [63, -436], [-2.5, -436]]), floor: lv(4), landing: 4, beds: [[4, -472, 22, -446], [28, -490, 46, -446], [50, -500, 58, -446]] },
  { poly: ccwMap([[-11, -537.5], [41.5, -537.5], [41.5, -523.2], [2.2, -500.6], [-11, -503]]), floor: lv(5), landing: 5, beds: [[-6, -532, 8, -512], [14, -534, 34, -524]] },
  { poly: ccwMap([[-11, -577.5], [2.5, -577.5], [41.5, -556.5], [41.5, -538.5], [-11, -538.5]]), floor: lv(6), landing: 6, beds: [[-6, -572, 8, -544], [14, -556, 32, -544]] },
];
/** the court holding a point, or null */
export function courtAt(x: number, z: number): Court | null {
  for (const c of COURTS) if (pointIn(c.poly, x, z)) return c;
  return null;
}
export function pointIn(p: V2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  }
  return c;
}
/** a court whose outline passes within d of a point (its edge band, where the carve takes the lower side) */
export function courtNear(x: number, z: number, d: number): Court | null {
  for (const c of COURTS) for (let i = 0; i < c.poly.length; i++) {
    const p = c.poly[i], q = c.poly[(i + 1) % c.poly.length], dx = q[0] - p[0], dz = q[1] - p[1];
    const t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (z - p[1]) * dz) / (dx * dx + dz * dz)));
    if (Math.hypot(p[0] + dx * t - x, p[1] + dz * t - z) < d) return c;
  }
  return null;
}
/** where a court is reached from its landing: the nearest point of its outline to the landing's centre */
export function courtDoor(c: Court): V2 {
  const [lx, lz] = STAIR.landings[c.landing];
  let best: V2 = c.poly[0], bd = Infinity;
  for (let i = 0; i < c.poly.length; i++) {
    const p = c.poly[i], q = c.poly[(i + 1) % c.poly.length];
    const dx = q[0] - p[0], dz = q[1] - p[1];
    const t = Math.max(0, Math.min(1, ((lx - p[0]) * dx + (lz - p[1]) * dz) / (dx * dx + dz * dz)));
    const r: V2 = [p[0] + dx * t, p[1] + dz * t], d = Math.hypot(r[0] - lx, r[1] - lz);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

/** the notch the upper stair climbs through, cut between the two south wedges: its east and west edges (south from the
 *  temple's ring to the cliff), hugging the zig-zag of the flights with a few metres to spare. Its floor slopes up the
 *  ravine under the flights (notchFloor). */
const NOTCH_MOUTH = -430;
export const NOTCH_EAST: V2[] = [[11, -720], [11, -600], [63, -572], [63, NOTCH_MOUTH], [63, -300]];
export const NOTCH_WEST: V2[] = [[-11, -720], [-11, -503], [-63, -480], [-63, NOTCH_MOUTH], [-63, -300]];
/** the notch's north end (the top landing's far edge): north of it the gap is the processional way at the top level */
export const NOTCH_TOP = landings[landings.length - 1][1] - 10;
export const NOTCH_SOUTH = NOTCH_MOUTH;

const sorted = [...GARDENS.wedges].map((w, i) => ({ w, i })).sort((p, q) => p.w.a0 - q.w.a0);
const stairAngle = Math.atan2(landings[landings.length - 1][1] - C[1], landings[landings.length - 1][0] - C[0]);

const isFlank = (w: GardenWedge) => w.r1 >= 300;

export const WEDGES: Wedge[] = [];
export const GAPS: Gap[] = [];
{
  const n = sorted.length;
  const ws: Wedge[] = sorted.map(({ w, i }) => {
    const bands: Band[] = [];
    for (let k = 0; k < w.steps; k++) {
      const floor = TOP - k * w.drop;
      bands.push({ k, r0: w.r0 + (k * (w.r1 - w.r0)) / w.steps, r1: w.r0 + ((k + 1) * (w.r1 - w.r0)) / w.steps, floor, walk: floor + WALK });
    }
    const side: Side = { kind: 'radial', line: [] };
    return { i, w, am: (w.a0 + w.a1) / 2, kind: isFlank(w) ? 'flank' : 'top', bands, lo: { ...side }, hi: { ...side } };
  });
  for (let j = 0; j < n; j++) {
    const lo = ws[j], hi = ws[(j + 1) % n];
    let a1 = hi.w.a0;
    while (a1 < lo.w.a1) a1 += 2 * Math.PI;
    const width = a1 - lo.w.a1, a = lo.w.a1 + width / 2;
    const kind: Gap['kind'] = Math.abs(adiff(stairAngle, a)) < width / 2 ? 'stair'
      : width > 30 * DEG ? 'open'
        : lo.kind === 'flank' && hi.kind === 'flank' ? 'ramp' : 'promenade';
    GAPS.push({ lo, hi, a, kind });
    // each wedge reaches across to the gap's causeway (its side line), to the notch's edge, or stops at its own edge
    if (kind === 'open') {
      lo.hi = { kind: 'radial', line: [polar(0, lo.w.a1), polar(600, lo.w.a1)] };
      hi.lo = { kind: 'radial', line: [polar(0, hi.w.a0), polar(600, hi.w.a0)] };
    } else if (kind === 'stair') {
      // (the wedge on the east of the stair has the larger angle on its side toward it; the notch edges are in x, z)
      const eastIsLo = Math.cos(lo.am) > 0;
      lo.hi = { kind: 'stair', line: eastIsLo ? NOTCH_EAST : NOTCH_WEST };
      hi.lo = { kind: 'stair', line: eastIsLo ? NOTCH_WEST : NOTCH_EAST };
    } else {
      const k: Side['kind'] = kind === 'ramp' ? 'ramp' : 'promenade';
      lo.hi = { kind: k, line: offsetRay(a, -CAUSEWAY_H) };
      hi.lo = { kind: k, line: offsetRay(a, CAUSEWAY_H) };
    }
  }
  WEDGES.push(...ws);
}

/** a ray from the temple's centre along angle a, moved sideways by h (toward larger angles when h > 0) */
function offsetRay(a: number, h: number): V2[] {
  const nx = -Math.sin(a) * h, nz = Math.cos(a) * h;
  return [[C[0] + nx, C[1] + nz], [C[0] + nx + Math.cos(a) * 600, C[1] + nz + Math.sin(a) * 600]];
}

/** where the circle of radius r round the temple crosses a polyline: the angles of the crossings */
function crossings(line: V2[], r: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const p = line[i], q = line[i + 1];
    const dx = q[0] - p[0], dz = q[1] - p[1], fx = p[0] - C[0], fz = p[1] - C[1];
    const A = dx * dx + dz * dz, B = 2 * (fx * dx + fz * dz), Cc = fx * fx + fz * fz - r * r;
    const disc = B * B - 4 * A * Cc;
    if (disc < 0 || A < 1e-9) continue;
    for (const s of [-1, 1]) {
      const t = (-B + s * Math.sqrt(disc)) / (2 * A);
      if (t >= 0 && t <= 1) out.push(Math.atan2(fz + t * dz, fx + t * dx));
    }
  }
  return out;
}

/** a wedge's angular reach at radius r: [lo, hi] as angles (unwrapped about its spine), its sides inset by `inset`
 *  metres of arc */
export function reach(wd: Wedge, r: number, inset = 0): [number, number] {
  const side = (s: Side, sign: number, fallback: number) => {
    if (s.kind === 'radial') return fallback;
    let best: number | null = null;
    for (const a of crossings(s.line, r)) {
      const d = adiff(a, wd.am);
      if (d * sign > 0 && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
    return best ?? fallback;
  };
  const lo = side(wd.lo, -1, wd.w.a0 - wd.am), hi = side(wd.hi, 1, wd.w.a1 - wd.am);
  return [wd.am + lo + inset / r, wd.am + hi - inset / r];
}

/** the band of a wedge holding radius r (or null) */
export function bandAt(wd: Wedge, r: number): Band | null {
  for (const b of wd.bands) if (r >= b.r0 && r < b.r1) return b;
  return null;
}

/** the floor of the terraces round the temple at a point: of the wedge reaching over it (with its sideways reach),
 *  or null. `shift` moves each band's start inward (the carve's steps hide inside the walls), and the last band reaches
 *  `beyond` past the wedge's end (under its outer wall) */
export function terraceFloor(x: number, z: number, shift = 0, beyond = 0): number | null {
  const r = radius(x, z), a = angle(x, z);
  for (const wd of WEDGES) {
    const last = wd.bands[wd.bands.length - 1];
    const b = bandAt(wd, r + shift) ?? (r >= last.r1 - shift && r < last.r1 + beyond ? last : null);
    if (!b) continue;
    const [lo, hi] = reach(wd, r);
    const d = wd.am + adiff(a, wd.am);
    if (d >= lo && d <= hi) return b.floor;
  }
  return null;
}

/** a ramp's deck (walk level) at radius r: level with the top from the temple's ring until the upper wedge's first wall,
 *  then straight down so it passes level with each of that wedge's outer promenades (RAMP_MEET short of each band's
 *  outer edge) to its last, and level beyond to its end */
export const RAMP_MEET = 3.4;
export function rampDeck(g: Gap, r: number): number {
  const u = rampUpper(g);
  const b = u.bands, n = b.length;
  const ra = b[1].r0 - RAMP_MEET, rb = b[n - 1].r1 - RAMP_MEET;
  const ya = TOP + WALK, yb = b[n - 1].walk;
  if (r <= ra) return ya;
  if (r >= rb) return yb;
  return ya + ((r - ra) / (rb - ra)) * (yb - ya);
}
/** the wedge beside a ramp whose terraces end higher (the deck meets its promenades) */
export function rampUpper(g: Gap): Wedge {
  const last = (w: Wedge) => w.bands[w.bands.length - 1].floor;
  return last(g.lo) >= last(g.hi) ? g.lo : g.hi;
}
/** a causeway's outer end (its belvedere's far edge) */
export const causewayEnd = (g: Gap) => Math.max(g.lo.w.r1, g.hi.w.r1) + 7;

/** the floor of the stair's notch: the ravine bottom under the flights, a metre and a half under the lowest tread at
 *  each z (z south; sampled every metre between the notch's top and mouth) */
const NF0 = Math.floor(NOTCH_TOP), NF1 = Math.ceil(NOTCH_SOUTH);
const notchFloorSamples: number[] = (() => {
  const out: number[] = [];
  const lowest: number[] = [];
  for (let z = NF0; z <= NF1; z++) lowest.push(Infinity);
  const mark = (z: number, y: number) => { const i = Math.round(z) - NF0; if (i >= 0 && i < lowest.length) lowest[i] = Math.min(lowest[i], y); };
  for (const [, z, y] of landings) for (let dz = -LANDING_R; dz <= LANDING_R; dz += 0.5) mark(z + dz, y);
  for (const f of FLIGHTS) {
    for (let t = 0; t <= 1; t += 0.005) for (let s = -1; s <= 1; s += 0.25) {
      const z = f.a[1] + (f.b[1] - f.a[1]) * t + f.dir[0] * s * (STAIR.width / 2);
      mark(z, f.ya + (f.yb - f.ya) * t);
    }
  }
  // (the landings' x doesn't matter: the floor is a function of z alone, under every tread at that z)
  let last = TOP;
  for (let i = 0; i < lowest.length; i++) {
    if (Number.isFinite(lowest[i])) last = lowest[i];
    out.push(last - 1.5);
  }
  // a running minimum southward keeps the floor falling toward the mouth
  for (let i = 1; i < out.length; i++) out[i] = Math.min(out[i], out[i - 1]);
  return out;
})();
export function notchFloor(z: number): number {
  const t = Math.min(NF1, Math.max(NF0, z)) - NF0, i = Math.floor(t), f = t - i;
  const a = notchFloorSamples[Math.min(i, notchFloorSamples.length - 1)], b = notchFloorSamples[Math.min(i + 1, notchFloorSamples.length - 1)];
  return a + (b - a) * f;
}

/** the notch's width at z: [west x, east x] (its edges are functions of z) */
export function notchSpan(z: number): [number, number] {
  const at = (line: V2[]) => {
    for (let i = 0; i < line.length - 1; i++) {
      const p = line[i], q = line[i + 1];
      if ((z - p[1]) * (z - q[1]) <= 0 && p[1] !== q[1]) return p[0] + ((z - p[1]) / (q[1] - p[1])) * (q[0] - p[0]);
    }
    return line[line.length - 1][0];
  };
  return [at(NOTCH_WEST), at(NOTCH_EAST)];
}
export const inNotch = (x: number, z: number, margin = 0) => {
  if (z < NOTCH_TOP || z > NOTCH_SOUTH) return false;
  const [w, e] = notchSpan(z);
  return x > w - margin && x < e + margin;
};

/** the avenue north from the temple's north portal across the forecourt */
export const AVENUE_N = { half: 7, r1: 210 };
/** the processional way south from the temple's ring to the stair's top landing: half its width, and where it ends (the
 *  top landing's middle: paved at the top level across its width that far, so the landing's mouth opens onto it) */
export const WAY = { half: 11, z1: landings[landings.length - 1][1] };

/** the height the land should carve the ground to under the Haven (or null where the Haven leaves it alone): the top
 *  level round the temple, each terrace's floor across its wedge's full reach (to the causeways and the notch), under
 *  each causeway the lower of the floors beside it, the notch's ravine floor and its courts' floors, the processional
 *  way and the north avenue at the top level. Walls reach FOOT metres below these, so ground anywhere in
 *  [h - FOOT, h] meets them; h is best. The steps sit where a heightfield's slope across them (a texel or so either
 *  side) stays hidden: each band starts a metre inside the wall that holds the band above (CARVE_SHIFT), a terrace
 *  runs on under its outer wall, the notch's floor reaches under the cut's parapets, and round each court's edge the
 *  lower of the court and the notch's floor holds (CARVE_NOTCH). */
export const CARVE_SHIFT = WALL_IN + 1.0;
/** how far under a flight's treads its ground is laid (m) */
const FLIGHT_SINK = 0.3;
/** how far past a north court's edge line the top's ground is laid beside its promenade (m) */
const PROMENADE_FILL = 16;
export const CARVE_NOTCH = 1.6;
export function havenGround(x: number, z: number): number | null {
  const r = radius(x, z);
  if (r <= GARDENS.wedges[0].r0) return TOP;
  // the grand stair's flights: a hand's breadth under the line of each one's treads, across its width (the land's
  // corridor runs each flight from landing middle to landing middle, but the flights run between the landings' edges,
  // steeper: by a flight's foot its ground stood over the treads)
  for (const f of FLIGHTS) {
    const u = (x - f.a[0]) * f.dir[0] + (z - f.a[1]) * f.dir[1], v = -(x - f.a[0]) * f.dir[1] + (z - f.a[1]) * f.dir[0];
    if (u >= 0 && u <= f.len && Math.abs(v) <= STAIR.width / 2) return f.ya + ((f.yb - f.ya) * u) / f.len - FLIGHT_SINK;
  }
  // the processional way from the temple's ring to the top landing, and the north avenue
  if (Math.abs(x - C[0]) <= WAY.half && z > C[1] && z < WAY.z1) return TOP;
  if (Math.abs(x - C[0]) <= AVENUE_N.half + 2 && z < C[1] && r <= AVENUE_N.r1) return TOP;
  const court = courtAt(x, z), near = inNotch(x, z) ? courtNear(x, z, CARVE_NOTCH) : null;
  if (near) return Math.min(near.floor, notchFloor(z));
  if (court) return court.floor;
  if (inNotch(x, z, CARVE_NOTCH)) return notchFloor(z);
  const f = terraceFloor(x, z, CARVE_SHIFT, WALL_OUT + 0.2);
  if (f !== null) return f;
  const a = angle(x, z);
  for (const g of GAPS) {
    if (g.kind !== 'ramp' && g.kind !== 'promenade') continue;
    const side = Math.sin(a - g.a) * r;
    const along = Math.cos(a - g.a) * r;
    if (along < 0 || along > causewayEnd(g)) continue;
    if (Math.abs(side) <= CAUSEWAY_H) {
      const fl = (w: Wedge) => { const b = bandAt(w, along + CARVE_SHIFT); return b ? b.floor : null; };
      const lo = fl(g.lo), hi = fl(g.hi);
      if (lo === null && hi === null) return null;
      return Math.min(lo ?? Infinity, hi ?? Infinity);
    }
    // beside a promenade, past the end of the short wedge on its one side (the north courts stop at r1 = 200): the
    // top's level ground up to the promenade, across the gap and on past that wedge's edge line as far as the land's
    // ramp down the gap reaches (the land cuts one down every gap, which a level promenade would hang over)
    if (g.kind === 'promenade') {
      const lo = g.lo.w.r1 < g.hi.w.r1, short = lo ? g.lo : g.hi;
      const toward = lo ? -1 : 1, edge = lo ? short.w.a1 : short.w.a0;
      if (side * toward > 0 && along > short.w.r1 && adiff(a, edge) * -toward * r > -PROMENADE_FILL) return TOP;
    }
  }
  return null;
}

/** a deterministic random stream (mulberry32) seeded by any integers */
export function rng(...seed: number[]): () => number {
  let h = 0x9e3779b9;
  for (const s of seed) { h ^= Math.imul((s | 0) + 0x7f4a7c15, 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16; }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
