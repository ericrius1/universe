// The canyon land as one deterministic height function, canyonHeight(x, z) (metres; x east, z south, y up; the
// plaza at the origin on the canyon floor), and canyonInfo(x, z) with what the ground is made of there. It builds
// what layout.ts lays out:
//   - a plateau at RIM_Y, cut by canyons: the bowl (the city's basin and two arms round the promontory), the river's
//     canyon west to east, the wide canyon south from the gate, the slot canyons west and east (looping out to the
//     river), and further out a maze of side canyons; buttes stand in them and on the plateau, hoodoos near the rims,
//     big mesas towards the horizon (out to ±65 km)
//   - all of it as a smooth "base height" that the strata (strata.ts) step into benches, scree and cliffs
//   - the Haven promontory forced exactly: its top flat at MESA.topY, each garden wedge's terrace floors (the shared
//     formula gardenFloor), the ramps' slopes between the wedges, and below its edge a stepped cliff that starts at the
//     edge's own height
//   - the grand stair's corridor, the city's floor kept flat round its wall, the river's channel
// canyon.wgsl is the same function on the GPU (tables.wgsl, generated from here by tools/land-tables.ts, holds the
// numbers), agreeing within millimetres. `texel` is the sample spacing of the level being filled: detail too fine
// for it is left out rather than aliased.
import { BASIN, FLOOR_Y, GARDENS, MESA, RIM_Y, RIVER, SIDE_CANYONS, STAIR, TEMPLE, WALL, type V2 } from '../world/layout';
import { clamp, fbm, hashF, mix, noise, noise1, noise1D, smax, smin, smoothstep } from './noise';
import { STRATA_RIM, terrace, terraceAlong, terraceKind, unterrace } from './strata';

if (Math.abs(STRATA_RIM - RIM_Y) > 1e-6) throw new Error(`strata: the beds add up to ${STRATA_RIM} m, not the rim's ${RIM_Y}`);

const f32 = Math.fround;

// seeds of the noises (the WGSL copy uses the same)
const S_WARP = 11, S_PLAT = 31, S_RIVER = 41, S_SLOT = 51, S_SOUTH = 61, S_FAR = 71, S_BUTTE = 81, S_MESA = 91;
const S_HOODOO = 101, S_SAND = 111, S_DUNE = 121, S_TRIB = 131, S_PROM = 141, S_STAIR = 151, S_GULLY = 161;

// ------------------------------------------------------------------ the designed places, as numbers
/** the bowl: the basin's ellipse and the arms' ellipse round the promontory (centre x, z, radii) */
export const ARMS = { cx: 0, cz: -790, rx: 620, rz: 400 };
/** wall widths (m from a canyon floor's edge to the plateau) */
const W_BOWL = 260, W_RIVER = 300, W_SOUTH = 190, W_SLOT = 40, W_FAR = 260;
/** how round the ridges between two canyons' walls are (in plateau heights) */
const K_RIDGE = 0.18;
/** the promontory's footprint: a disc round the temple (the gardens' edge plus a parapet's margin) and the tongue back
 *  to the north rim */
export const PROM = { r: Math.max(...GARDENS.wedges.map((w) => w.r1)) + 4, halfWidth: MESA.halfWidth, north: -1250 };
/** where the promontory's top climbs from MESA.topY to the rim (z, north of the gardens), and where north of that the
 *  land itself is left uncut (the tongue joins the plateau) */
const TONGUE_RISE = [-980, -1080], TONGUE_SOLID = [-1040, -1240];
/** the promontory's cliffs: base height lost per metre out from its edge (steep: the gardens end in sheer walls) */
const PROM_G = 3.0;

// a curve through knots, one coordinate a smooth function of the other (cubic Hermite, flat past its ends)
interface Curve { t: number[]; v: number[]; m: number[] }
function makeCurve(pts: V2[]): Curve {
  const t = pts.map((p) => f32(p[0])), v = pts.map((p) => f32(p[1])), n = t.length;
  const m = t.map((_, i) => (i === 0 || i === n - 1 ? 0
    : f32(((v[i + 1] - v[i]) / (t[i + 1] - t[i]) + (v[i] - v[i - 1]) / (t[i] - t[i - 1])) / 2)));
  return { t, v, m };
}
/** the slope of the last curveAt */
let curveD = 0;
function curveAt(c: Curve, x: number): number {
  const { t, v, m } = c, n = t.length;
  if (x <= t[0]) { curveD = 0; return v[0]; }
  if (x >= t[n - 1]) { curveD = 0; return v[n - 1]; }
  let i = 0;
  while (i < n - 2 && x >= t[i + 1]) i++;
  const h = t[i + 1] - t[i], s = (x - t[i]) / h, s2 = s * s, s3 = s2 * s;
  curveD = ((6 * s2 - 6 * s) * (v[i] - v[i + 1])) / h + (3 * s2 - 4 * s + 1) * m[i] + (3 * s2 - 2 * s) * m[i + 1];
  return (2 * s3 - 3 * s2 + 1) * v[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * v[i + 1] + (s3 - s2) * h * m[i + 1];
}

/** the river (z of x): RIVER.path, held flat out to ±9 km, then wandering on to the horizon */
export const RIVER_CURVE = makeCurve([[-9000, 950], ...RIVER.path, [9000, 850]]);
const sides = SIDE_CANYONS;
/** the west slot (z of x), from the basin out past the layout's last point to the river */
export const WEST_CURVE = makeCurve([[-3900, 820], ...[...sides[0].path].reverse(), [-450, 120]]);
/** the east slot (z of x), likewise to the river's east reach */
export const EAST_CURVE = makeCurve([[450, 100], ...sides[1].path, [3900, 650], [4150, 860]]);
/** the wide south canyon (x of z) from the gate past the river, then on to its head */
export const SOUTH_CURVE = makeCurve([[380, 0], ...sides[2].path.map(([x, z]) => [z, x] as V2), [4600, -150], [6200, 350]]);

/** the grand stair's landings' (z, y), north to south */
const STAIR_Z = [...STAIR.landings].sort((a, b) => a[1] - b[1]).map((l) => [f32(l[1]), f32(l[2])]);

/** each garden wedge with its sides' directions (from the temple) and its band width */
const WEDGES = GARDENS.wedges.map((w) => ({
  ...w, w: (w.r1 - w.r0) / w.steps,
  d0: [f32(Math.cos(w.a0)), f32(Math.sin(w.a0))], d1: [f32(Math.cos(w.a1)), f32(Math.sin(w.a1))],
  // (a wedge that ends on the top, short of the edge, lets its ramp line fade past its end)
  short: w.r1 < PROM.r - 30,
}));
/** the stair's cleft between the two south wedges (the wedges either side of the south, +z) */
const SOUTHMOST = [...WEDGES].filter((w) => w.a1 <= Math.PI / 2).sort((a, b) => b.a1 - a.a1)[0];
const SOUTHWEST = [...WEDGES].filter((w) => w.a0 >= Math.PI / 2).sort((a, b) => a.a0 - b.a0)[0];
const GAP_A = [f32(Math.cos(SOUTHMOST.a1)), f32(Math.sin(SOUTHMOST.a1))];
const GAP_B = [f32(Math.cos(SOUTHWEST.a0)), f32(Math.sin(SOUTHWEST.a0))];

// ------------------------------------------------------------------ small shapes
/** signed distance to an ellipse (approximate, exact on the axes; negative inside) */
function sdEllipse(px: number, pz: number, rx: number, rz: number): number {
  const ax = px / rx, az = pz / rz, bx = px / (rx * rx), bz = pz / (rz * rz);
  const k0 = Math.sqrt(ax * ax + az * az), k1 = Math.sqrt(bx * bx + bz * bz);
  return k1 < 1e-9 ? -Math.min(rx, rz) : (k0 * (k0 - 1)) / k1;
}

/** a canyon wall's rise: 0 on the floor's edge, 1 on the plateau, straight between with rounded ends */
function ramp(u: number): number { return smax(0, smin(u, 1, 0.15), 0.15); }

/** distance (m) across a curve's line (z of x) wandering off it by `wander` (with slope `wanderD`), and how far past
 *  its ends (along it) in alongOut */
let alongOut = 0;
function acrossCurve(c: Curve, along: number, across: number, wander: number, wanderD: number): number {
  const mid = curveAt(c, along) + wander;
  const slope = curveD + wanderD;
  const n = c.t.length;
  alongOut = Math.max(c.t[0] - along, along - c.t[n - 1], 0);
  return Math.abs(across - mid) / Math.sqrt(1 + slope * slope);
}
let meanderD = 0;
/** a slot's or a canyon's wandering off its line: amplitude a (m) at wavelength l (m), and its slope (meanderD) */
function meander(t: number, l: number, a: number, s: number): number {
  const v = noise1(t, l, s);
  meanderD = (a * noise1D) / l;
  return a * v;
}

// ------------------------------------------------------------------ the river
/** the river's centre line: z at x (the channel and its canyon follow it; the water builds along it) */
export function riverZ(x: number): number {
  const z = curveAt(RIVER_CURVE, x);
  const d = curveD;
  const a = 700 * smoothstep(4200, 9000, Math.abs(x));
  const v = noise1(x, 2600, S_RIVER);
  riverSlope = d + (a * noise1D) / 2600;
  return z + a * v;
}
/** the slope dz/dx of the river at the last riverZ */
export let riverSlope = 0;
/** distance (m) from the river's centre line */
export function riverDistance(x: number, z: number): number {
  const zr = riverZ(x);
  return Math.abs(z - zr) / Math.sqrt(1 + riverSlope * riverSlope);
}
/** the river canyon's floor half-width at x */
function riverFloor(x: number): number {
  const w = 175 + 55 * noise1(x, 1400, S_RIVER + 1);
  return mix(130, w, smoothstep(700, 1700, Math.abs(x)));
}

// ------------------------------------------------------------------ the promontory and its gardens
/** what the promontory's surface is at the last gardenSurface: 4 a terrace, 3 a ramp's slope, 5 the plain top */
let gardenZone = 5;

/** a continuous staircase: t rounded down to whole numbers, each riser spread over the width e centred on the whole
 *  number (so a floor never jumps: the GPU and the CPU never land on different steps) */
export function steps(t: number, e: number): number {
  const u = t + e / 2, k = Math.floor(u);
  return k - 1 + Math.min((u - k) / e, 1);
}

/** the terrace floor's height at a point inside a wedge: band k (r0 + k·w .. r0 + (k+1)·w from the temple) is
 *  MESA.topY - k·drop; stepped over 0.5 m centred on each band's boundary (the retaining wall stands there). The garden
 *  builder uses the same formula, so its planters sit on this ground. Points before r0 are the top; past r1 the last. */
export function gardenFloor(r: number, w: { r0: number; r1: number; steps: number; drop: number }): number {
  const bw = (w.r1 - w.r0) / w.steps;
  return MESA.topY - w.drop * clamp(steps((r - w.r0) / bw, 0.5 / bw), 0, w.steps - 1);
}

/** the promontory's surface at a point, extended past its edge (radially constant there): the top, the wedges'
 *  terraces, and between neighbouring wedges the ramps' slopes (the line through the terraces' inner corners, so a
 *  terrace stands up to a drop above its ramp: the raised walkways are built on it) */
function gardenSurface(x: number, z: number): number {
  const dx = x - TEMPLE.x, dz = z - TEMPLE.z;
  const r = Math.sqrt(dx * dx + dz * dz);
  // (the top is flat at MESA.topY round the temple and its gardens, and climbs the last metres to the rim's caprock
  // towards the neck, where the tongue meets the plateau)
  const top = MESA.topY + (RIM_Y - MESA.topY) * smoothstep(TONGUE_RISE[0], TONGUE_RISE[1], z);
  let gap = top, inS = top, inW = 0;
  for (let i = 0; i < WEDGES.length; i++) {
    const w = WEDGES[i];
    // metres inside the wedge's two radial sides (negative outside)
    const c0 = w.d0[0] * dz - w.d0[1] * dx, c1 = dx * w.d1[1] - dz * w.d1[0];
    const lat = Math.min(c0, c1);
    const t = (r - w.r0) / w.w;
    const line = MESA.topY - w.drop * clamp(t, 0, w.steps);
    // (the ramp's line reaches ~10 degrees out from the wedge's sides; a short wedge's fades just past its end)
    let near = 1 - smoothstep(0.17 * r, 0.22 * r + 0.01, -lat);
    if (w.short) near *= 1 - smoothstep(w.r1, w.r1 + 0.5, r);
    gap = Math.min(gap, mix(top, line, near));
    let wi = clamp(lat / 0.5 + 0.5, 0, 1) * clamp((r - w.r0) / 0.5 + 0.5, 0, 1);
    if (w.short) wi *= clamp((w.r1 - r) / 0.5 + 0.5, 0, 1);
    if (wi > 0) { inW = wi; inS = gardenFloor(r, w); }
  }
  gardenZone = inW > 0.5 ? 4 : gap < top - 0.05 ? 3 : 5;
  return mix(gap, inS, inW);
}

/** signed distance to the tongue: the promontory's neck back from the temple to `north`, its sides wandering once
 *  past the gardens */
function sdTongue(x: number, z: number, north: number): number {
  const cz = (TEMPLE.z + north) / 2, hz = (TEMPLE.z - north) / 2;
  const hw = PROM.halfWidth + 90 * noise1(z, 260, S_PROM) * smoothstep(-880, -1000, z);
  const qx = Math.abs(x - TEMPLE.x) - hw, qz = Math.abs(z - cz) - hz;
  const ox = Math.max(qx, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(qx, qz), 0);
}

/** signed distance to the promontory's footprint (the disc round the temple and the tongue to the north rim) */
function sdProm(x: number, z: number): number {
  const dx = x - TEMPLE.x, dz = z - TEMPLE.z;
  // (the disc only on the gardens' side: north of that the tongue's own sides)
  const disc = Math.max(Math.sqrt(dx * dx + dz * dz) - PROM.r, -dz - 70);
  return Math.min(disc, sdTongue(x, z, PROM.north));
}

/** the promontory: its surface over its footprint, and past the edge a stepped cliff falling from the edge's height
 *  (base heights lost at PROM_G per metre, stepped by the same strata as every wall; the cliff's face wanders a
 *  little below the edge, which stays exact) */
let promZone = 0, promKind = -1;
function promontory(x: number, z: number, wn: number): number {
  const d = sdProm(x, z);
  if (d > 160) { promZone = 0; return -1e9; }
  const S = gardenSurface(x, z);
  if (d <= 0) { promZone = gardenZone; promKind = -1; return S; }
  promZone = 0;
  // (the face wanders out into buttresses and back into bays from just below the edge; the ground past the edge still
  // always falls away)
  const out = Math.max(d + wn * smoothstep(0.5, 8, d), 0.5 * d);
  const h = terrace(unterrace(S) - PROM_G * out);
  promKind = terraceKind;
  return h;
}

// ------------------------------------------------------------------ the grand stair's corridor
/** the stair's height going north (z), through the landings: the flights are straight between them, so along a
 *  flight its height is exactly this */
function stairProfile(z: number): number {
  const n = STAIR_Z.length;
  if (z <= STAIR_Z[0][0]) return STAIR_Z[0][1];
  if (z >= STAIR_Z[n - 1][0]) return STAIR_Z[n - 1][1];
  let i = 0;
  while (i < n - 2 && z >= STAIR_Z[i + 1][0]) i++;
  const [z0, y0] = STAIR_Z[i], [z1, y1] = STAIR_Z[i + 1];
  return y0 + ((z - z0) / (z1 - z0)) * (y1 - y0);
}

/** the stair's own height under (x, z), less a hand's breadth: on a flight's footprint (a rectangle, its width and
 *  2 m either side) its height there (a flight is level across its width), on a landing's platform the landing's,
 *  rising steeply away from both (so the lowest flight near a point decides, and nothing between two flights jumps).
 *  Where a platform and a flight overlap the lower wins: the layout leaves open how they meet */
const STAIR_SINK = 0.3, LANDING_R = 11, CLEFT_OUT = 60;
function corridorTarget(x: number, z: number): number {
  let y = 1e9;
  for (let i = 0; i < STAIR.landings.length - 1; i++) {
    const a = STAIR.landings[i], b = STAIR.landings[i + 1];
    const ex = b[0] - a[0], ez = b[1] - a[1], len = Math.sqrt(ex * ex + ez * ez);
    const tu = ((x - a[0]) * ex + (z - a[1]) * ez) / (len * len), t = clamp(tu, 0, 1);
    const lat = Math.abs((x - a[0]) * ez - (z - a[1]) * ex) / len, over = Math.max(-tu, tu - 1, 0) * len;
    y = Math.min(y, a[2] + (b[2] - a[2]) * t + (Math.max(lat - (STAIR.width / 2 + 2), 0) + over) * 4);
  }
  for (let i = 0; i < STAIR.landings.length; i++) {
    const L = STAIR.landings[i];
    const dx = x - L[0], dz = z - L[1];
    y = Math.min(y, L[2] + Math.max(Math.sqrt(dx * dx + dz * dz) - LANDING_R, 0) * 4);
  }
  return Math.max(y - STAIR_SINK, FLOOR_Y);
}

/** the stair's corridor at (x, z) over ground h: under the flights' footprint the ground is exactly the stair's less a
 *  hand's breadth (corridorTarget); beside them, within the cleft between the south wedges, a floor of rock ledges a
 *  few metres lower (the stair stands on its own retaining walls there); the cleft's sides are cut sheer (the wedges'
 *  retaining walls); below the promontory's tip the flights stand on a ridge of debris sloping off at the angle of
 *  repose. Sets the zone to 2 inside */
let corridorZone = false;
function corridor(x: number, z: number, h: number): number {
  corridorZone = false;
  const dx = x - TEMPLE.x, dz = z - TEMPLE.z;
  const r = Math.sqrt(dx * dx + dz * dz);
  // (the cleft runs out through the promontory's cliff to its foot, its mouth opening on the debris below)
  const gap = Math.min(GAP_A[0] * dz - GAP_A[1] * dx, dx * GAP_B[1] - dz * GAP_B[0], PROM.r + CLEFT_OUT - r);
  let zig = 1e9;
  for (let i = 0; i < STAIR.landings.length - 1; i++) {
    const a = STAIR.landings[i], b = STAIR.landings[i + 1];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const t = clamp(((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez), 0, 1);
    const qx = x - a[0] - ex * t, qz = z - a[1] - ez * t;
    zig = Math.min(zig, Math.sqrt(qx * qx + qz * qz));
  }
  const foot = STAIR.width / 2 + 2 - zig;
  const inside = Math.min(Math.max(gap, foot), z - (STAIR_Z[0][0] - 8));
  if (inside < -200) return h;
  const target = corridorTarget(x, z);
  // (the cleft's floor follows the stair's run north, a few metres under it, in rock ledges)
  const below = 2 + 5 * smoothstep(0, 20, -foot) + 1.5 * noise(x, z, 23, S_STAIR);
  const ravine = 3 * steps((stairProfile(z) - below) / 3, 0.2);
  const surf = mix(target, Math.min(ravine, target), smoothstep(0, 4, -foot));
  const o = Math.max(-inside, 0);
  corridorZone = inside >= 0;
  return clamp(h, surf - o * 0.7, surf + o * 120);
}

// ------------------------------------------------------------------ where buttes and hoodoos may not stand
/** how clear a feature of radius `rad` at (x, z) keeps of the designed places (the city's floor, the promontory and
 *  its stair, the river, the slots' and the south canyon's floors, the arms): 0 in the way .. 1 clear, eased over
 *  40 m so the CPU and the GPU never disagree about a whole butte */
function clearance(x: number, z: number, rad: number): number {
  let c = smoothstep(rad + 180, rad + 220, sdEllipse(x - BASIN.cx, z - BASIN.cz, BASIN.rx, BASIN.rz));
  c = Math.min(c, smoothstep(rad + 60, rad + 100, sdEllipse(x - ARMS.cx, z - ARMS.cz, ARMS.rx, ARMS.rz)));
  c = Math.min(c, smoothstep(rad + 200, rad + 240, sdProm(x, z)));
  c = Math.min(c, smoothstep(rad + 60, rad + 100, riverDistance(x, z) - riverFloor(x)));
  c = Math.min(c, smoothstep(rad + 40, rad + 80, acrossCurve(WEST_CURVE, x, z, 0, 0) + alongOut - sides[0].halfWidth * 1.3));
  c = Math.min(c, smoothstep(rad + 40, rad + 80, acrossCurve(EAST_CURVE, x, z, 0, 0) + alongOut - sides[1].halfWidth * 1.3));
  return Math.min(c, smoothstep(rad + 60, rad + 100, acrossCurve(SOUTH_CURVE, z, x, 0, 0) + alongOut - sides[2].halfWidth * 1.2));
}

// ------------------------------------------------------------------ the natural land (a base height)
/** the domain warp of the last warpAt (m): crenellated rims, spurs and alcoves, fluted faces */
let wx = 0, wz = 0, wn = 0;
function warpAt(x: number, z: number, minWave: number): void {
  const k2 = smoothstep(minWave, 2 * minWave, 130), k3 = smoothstep(minWave, 2 * minWave, 16);
  wx = 95 * noise(x, z, 520, S_WARP) + 26 * k2 * noise(x, z, 130, S_WARP + 2) + 1.8 * k3 * noise(x, z, 16, S_WARP + 4);
  wz = 95 * noise(x, z, 520, S_WARP + 1) + 26 * k2 * noise(x, z, 130, S_WARP + 3) + 1.8 * k3 * noise(x, z, 16, S_WARP + 5);
  // (a scalar one for faces that are not warped through the canyon fields, the promontory's cliffs: buttresses and
  // bays below the gardens' edge, and flutes)
  const k4 = smoothstep(minWave, 2 * minWave, 30);
  wn = 26 * k2 * noise(x, z, 85, S_WARP + 6) + 9 * k4 * noise(x, z, 28, S_WARP + 8) + 1.8 * k3 * noise(x, z, 16, S_WARP + 7);
}

/** the normalized distance (wall widths) out from the nearest canyon floor, and how much of a wall (not a floor, not
 *  the plateau) the point is on, at the last natural() */
let uMin = 9, wallness = 0;
/** how deep a canyon has cut at distance d from its centre (floor half-width hw, wall width W): 1 on its floor, 0 on
 *  the plateau; the nearest floor kept in uMin, the wall in wallness, each as much as the canyon is there (`k`: a canyon
 *  fading in leaves them fading in too, never jumping) */
function cut(d: number, hw: number, W: number, k = 1): number {
  const u = (d - hw) / W;
  uMin = Math.min(uMin, u + 9 * (1 - k));
  const c = 1 - ramp(u);
  wallness = Math.max(wallness, 4 * c * (1 - c) * k);
  return c;
}
/** the deeper of two cuts (fractions of the plateau's height), rounded where two walls meet in a ridge but exact on
 *  the plateau (0) and on a floor (1), so neither sinks where canyons overlap */
function deeper(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k, m = Math.max(a, b);
  return Math.min(m + h * h * k * m * (1 - m), 1);
}

/** the far land's reach: none of it within ~3 km of the city (its canyons are the designed ones), all of it past ~6
 *  (a wandering edge, not a ring) */
function farness(x: number, z: number): number {
  const dz = z - 300;
  return smoothstep(2800, 6000, Math.sqrt(x * x + dz * dz) + 900 * noise(x, z, 5000, S_FAR + 11));
}

/** the plateau and its canyons as a base height at (x, z), the canyon fields read at the warped (qx, qz) */
function natural(x: number, z: number, qx: number, qz: number, minWave: number, texel: number): number {
  uMin = 9; wallness = 0;
  const far = farness(x, z);
  // the plateau: flat at the rim, here and there a low stepped rise; broader swells far out
  const calm = smoothstep(100, 500, sdProm(x, z));
  const relief = calm * (2 + 62 * fbm(x, z, 1600, 3, S_PLAT, minWave)) + far * 40 * fbm(x, z, 9000, 2, S_PLAT + 5, minWave);
  let plat = RIM_Y + Math.max(relief, 0);
  // far out, mesas stand over the plateau (the canyons cut through them as through the plateau)
  if (far > 0) plat = Math.max(plat, mesas(x, z, far, minWave));
  // (the walls' width wanders: here broad stepped amphitheatres, there tighter cliffs; between the basin and the river
  // they stand steep, so the ridge between them stays high)
  const wide = 1 + 0.38 * noise(x, z, 900, S_PLAT + 9) * 2;
  const ridge = (1 - smoothstep(700, 1500, Math.abs(x))) * smoothstep(150, 420, z) * (1 - smoothstep(900, 1100, z));
  // the bowl (never reaching in towards the city's wall: the basin's floor only grows)
  const raw = sdEllipse(x - BASIN.cx, z - BASIN.cz, BASIN.rx, BASIN.rz);
  let dBowl = smin(sdEllipse(qx - BASIN.cx, qz - BASIN.cz, BASIN.rx, BASIN.rz), sdEllipse(qx - ARMS.cx, qz - ARMS.cz, ARMS.rx, ARMS.rz), 120);
  dBowl = Math.min(dBowl, raw + 12);
  let e = cut(dBowl, 0, W_BOWL * wide * (1 - 0.5 * ridge));
  // the river's canyon
  const dr = riverDistance(qx, qz);
  e = deeper(e, cut(dr, riverFloor(qx), W_RIVER * wide * (1 - 0.45 * ridge)), K_RIDGE);
  // the slots: narrow, wandering, sheer
  if (qx < 0) {
    const m = meander(qx, 260, 34 * smoothstep(-800, -1400, qx), S_SLOT);
    const d = acrossCurve(WEST_CURVE, qx, qz, m, meanderD) + alongOut;
    const hw = sides[0].halfWidth * (1 + 0.28 * noise1(qx, 330, S_SLOT + 2) * 2);
    e = deeper(e, cut(d, hw, W_SLOT), K_RIDGE);
  } else {
    const m = meander(qx, 240, 30 * smoothstep(800, 1400, qx), S_SLOT + 1);
    const d = acrossCurve(EAST_CURVE, qx, qz, m, meanderD) + alongOut;
    const hw = sides[1].halfWidth * (1 + 0.28 * noise1(qx, 310, S_SLOT + 3) * 2);
    e = deeper(e, cut(d, hw, W_SLOT), K_RIDGE);
  }
  // the wide canyon south
  {
    const m = meander(qz, 420, 40 * smoothstep(700, 1300, qz), S_SOUTH);
    const d = acrossCurve(SOUTH_CURVE, qz, qx, m, meanderD) + alongOut;
    const hw = sides[2].halfWidth * (1 + 0.15 * noise1(qz, 600, S_SOUTH + 1) * 2);
    e = deeper(e, cut(d, hw, W_SOUTH * wide), K_RIDGE);
  }
  // far out, big canyons wander between the mesas (where a broad noise crosses zero), some cut to the floor, some
  // hanging higher
  if (far > 0) {
    const n = fbm(qx, qz, 9000, 3, S_FAR, minWave);
    const d = (Math.abs(n) * 9000) / 1.6;
    const hw = 60 + 80 * (0.5 + fbm(x, z, 5000, 2, S_FAR + 7, minWave));
    const depth = clamp(0.55 + 0.9 * fbm(x, z, 14000, 2, S_FAR + 9, minWave), 0.35, 1);
    e = deeper(e, far * depth * cut(d, hw, W_FAR * wide, far), K_RIDGE);
  }
  // gullies notched down the walls, buttresses standing out between them (only where a wall is: never on the plateau or
  // a floor)
  {
    const g = Math.abs(fbm(qx, qz, 150, 2, S_GULLY, minWave));
    const gully = 1 - smoothstep(0.015, 0.09, g), spur = smoothstep(0.18, 0.4, g);
    e = clamp(e + wallness * (0.3 * gully - 0.1 * spur), 0, 1);
  }
  // side canyons cut back into the plateau from every canyon's walls, their floors climbing as they go and hanging
  // over the canyon they feed (lines where a noise crosses zero, within ~2.5 wall widths of a canyon; not through the
  // ridge between the basin and the river)
  const reach = (1 - smoothstep(0.15, 2.4, uMin)) * (1 - ridge) * (1 - 0.75 * far);
  if (reach > 0) {
    const n = fbm(qx, qz, 1250, 2, S_TRIB, minWave);
    const d = (Math.abs(n) * 1250) / 1.5;
    const u0 = uMin;
    e = deeper(e, 0.8 * reach * cut(d, 6 + 16 * reach, 45, reach), K_RIDGE);
    uMin = Math.min(u0, uMin + 0.5);
  }
  // north of the neck the tongue is the plateau itself, uncut (the promontory's cliffs and the bowl's walls meet it)
  e *= 1 - (1 - smoothstep(-50, 10, sdTongue(x, z, -2400))) * smoothstep(TONGUE_SOLID[0], TONGUE_SOLID[1], z);
  let H = plat - (plat - FLOOR_Y) * e;
  // buttes, in the canyons and on the plateau (in 900 m cells)
  H = Math.max(H, buttes(qx, qz, x, z));
  // hoodoos near the rims
  if (texel < 3 && Math.abs(x) < 4500 && Math.abs(z) < 4500) H += hoodoos(x, z, texel);
  return H;
}

/** the buttes' base height at (qx, qz) (warped: ragged outlines) for the unwarped point (x, z): each 900 m cell may
 *  hold one, clear of the designed places */
function buttes(qx: number, qz: number, x: number, z: number): number {
  const C = 900;
  const ix = Math.floor(x / C), iz = Math.floor(z / C);
  let H = -1e9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cz = iz + j;
    if (hashF(cx, cz, S_BUTTE) > 0.28) continue;
    const bx = (cx + 0.25 + 0.5 * hashF(cx, cz, S_BUTTE + 1)) * C, bz = (cz + 0.25 + 0.5 * hashF(cx, cz, S_BUTTE + 2)) * C;
    const rad = 55 + 150 * hashF(cx, cz, S_BUTTE + 3);
    const ddx = qx - bx, ddz = qz - bz;
    const d = Math.sqrt(ddx * ddx + ddz * ddz);
    if (d > rad) continue;
    const clear = clearance(bx, bz, rad);
    if (clear <= 0) continue;
    const e = hashF(cx, cz, S_BUTTE + 4);
    const top = RIM_Y - 25 + 190 * e * e;
    H = Math.max(H, unterrace(top) * (1 - smoothstep(rad * 0.5, rad, d)) * clear);
  }
  return H;
}

/** the far mesas' base height (or the plateau's where there's none): lobed tables where a warped broad noise rises
 *  past a threshold, 70-370 m over the plateau, stepping down towards the river */
function mesas(x: number, z: number, far: number, minWave: number): number {
  const lx = x + 900 * noise(x, z, 3000, S_MESA + 7), lz = z + 900 * noise(x, z, 3000, S_MESA + 8);
  const d = (fbm(lx, lz, 4200, 3, S_MESA, minWave) - 0.1) * 5200;
  if (d <= 0) return -1e9;
  const top = RIM_Y + 70 + 300 * clamp(0.5 + fbm(x, z, 16000, 2, S_MESA + 3, minWave), 0, 1);
  const river = smoothstep(W_RIVER + 250, W_RIVER + 900, riverDistance(x, z));
  return RIM_Y + (unterrace(top) - RIM_Y) * smoothstep(0, 260, d) * far * river;
}

/** a hoodoo: where it stands, how wide, how tall over the plateau */
export interface Hoodoo { x: number; z: number; r: number; height: number }

const HOODOO_CELL = 48;
/** cell (cx, cz)'s hoodoo: where it stands, how wide and tall (or null: the cell has none); in patches on the plateau a
 *  little back from the rims, its height easing to nothing at the patches' and the band's edges (continuous, so the
 *  CPU and the GPU never disagree about a whole pillar) */
function hoodooOf(cx: number, cz: number): Hoodoo | null {
  const C = HOODOO_CELL;
  if (hashF(cx, cz, S_HOODOO) > 0.38) return null;
  const x = (cx + 0.2 + 0.6 * hashF(cx, cz, S_HOODOO + 1)) * C, z = (cz + 0.2 + 0.6 * hashF(cx, cz, S_HOODOO + 2)) * C;
  const dB = smin(sdEllipse(x - BASIN.cx, z - BASIN.cz, BASIN.rx, BASIN.rz), sdEllipse(x - ARMS.cx, z - ARMS.cz, ARMS.rx, ARMS.rz), 120);
  const near = Math.min(dB - W_BOWL, riverDistance(x, z) - riverFloor(x) - W_RIVER);
  const k = smoothstep(0.1, 0.14, fbm(x, z, 340, 2, S_HOODOO + 5, 0.001)) * smoothstep(90, 120, near) * (1 - smoothstep(370, 400, near))
    * smoothstep(160, 190, sdProm(x, z));
  if (k <= 0) return null;
  const e = hashF(cx, cz, S_HOODOO + 4);
  return { x, z, r: 6 + 8 * hashF(cx, cz, S_HOODOO + 3), height: (10 + 24 * e * e) * k };
}

/** the hoodoos' base height added at (x, z): stout columns on a broad flared foot */
function hoodoos(x: number, z: number, texel: number): number {
  const C = HOODOO_CELL;
  const ix = Math.floor(x / C), iz = Math.floor(z / C);
  let H = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cz = iz + j;
    if (hashF(cx, cz, S_HOODOO) > 0.38) continue;
    const hx = (cx + 0.2 + 0.6 * hashF(cx, cz, S_HOODOO + 1)) * C, hz = (cz + 0.2 + 0.6 * hashF(cx, cz, S_HOODOO + 2)) * C;
    const r = 6 + 8 * hashF(cx, cz, S_HOODOO + 3);
    const ddx = x - hx, ddz = z - hz;
    const d = Math.sqrt(ddx * ddx + ddz * ddz);
    if (d > r * 1.9) continue;
    const ho = hoodooOf(cx, cz);
    if (!ho) continue;
    const lod = smoothstep(2 * texel, 4 * texel, r);
    const prof = Math.min((1 - smoothstep(0.62, 1.0, d / r)) + 0.35 * (1 - smoothstep(1.0, 1.9, d / r)), 1);
    H = Math.max(H, (unterrace(RIM_Y + ho.height) - RIM_Y) * prof * lod);
  }
  return H;
}

// ------------------------------------------------------------------ the whole
/** what the last sample was (for canyonInfo): the strata segment the natural ground landed on and how far along it,
 *  the designed zone (0 natural, 1 the city's floor, 2 the stair's corridor, 3 a ramp's slope, 4 a garden terrace,
 *  5 the promontory's top, 6 the river's channel), the river's distance, the normalized distance from a canyon floor */
export const HINT = { kind: -1, along: 0, zone: 0, river: 0, u: 9, prom: false };

function sample(x: number, z: number, texel: number): number {
  // (an octave shorter than ~6 samples would alias: it fades out between 3 and 6)
  const minWave = 3 * texel;
  warpAt(x, z, minWave);
  const H0 = natural(x, z, x + wx, z + wz, minWave, texel);
  let h = terrace(H0);
  HINT.kind = terraceKind; HINT.along = terraceAlong; HINT.u = uMin; HINT.zone = 0; HINT.prom = false;
  // sand drifted against the walls' feet, on every canyon floor
  const lobes = 0.55 + 0.45 * noise(x, z, 45, S_SAND);
  h += 2.6 * smoothstep(-0.35, 0, uMin) * (1 - smoothstep(0, 0.12, uMin)) * lobes;
  // dunes on the far floors and benches (eased in over the floor's foot and out at a bench's edges: nowhere a seam)
  const far = farness(x, z);
  if (far > 0) {
    const bench = terraceKind === 0 ? smoothstep(0, 0.15, terraceAlong) * (1 - smoothstep(0.85, 1, terraceAlong)) : 0;
    const flats = Math.max(bench, 1 - smoothstep(0, 10, H0));
    if (flats > 0) h += far * dunes(x, z, minWave) * flats;
  }
  // the promontory stands over the bowl's floor (and meets the north rim)
  const hp = promontory(x, z, wn);
  if (hp >= h) { h = hp; HINT.zone = promZone; HINT.kind = promKind; HINT.prom = true; }
  // the stair's corridor: cut down through the gardens' cleft, built up as a ridge over the basin's floor
  if (Math.abs(x) < 320 && z > -700 && z < -260) {
    h = corridor(x, z, h);
    if (corridorZone) HINT.zone = 2;
  }
  // the city's floor, flat round its wall
  const dW = sdEllipse(x - WALL.cx, z - WALL.cz, WALL.rx, WALL.rz);
  if (dW < 55) { h = mix(FLOOR_Y, h, smoothstep(30, 55, dW)); if (dW < 30) HINT.zone = 1; }
  // the river's channel, soft-banked
  const dr = riverDistance(x, z);
  HINT.river = dr;
  const chan = FLOOR_Y - 2.5 + 2.5 * smoothstep(RIVER.halfWidth - 5, RIVER.halfWidth + 10, dr) + Math.max(dr - RIVER.halfWidth - 10, 0) * 3;
  if (chan < h) { h = chan; if (dr < RIVER.halfWidth) HINT.zone = 6; }
  return h;
}

/** transverse dunes (crests across a wind from the west-north-west), wandering, in patches */
function dunes(x: number, z: number, minWave: number): number {
  const erg = smoothstep(0.05, 0.25, fbm(x, z, 14000, 2, S_DUNE, minWave));
  if (erg <= 0) return 0;
  const u = (x * 0.92 + z * 0.38) / 170 + 2.2 * noise(x, z, 700, S_DUNE + 3) + 0.6 * noise(x, z, 230, S_DUNE + 4);
  const f = u - Math.floor(u);
  const crest = smoothstep(0, 0.72, f) * (1 - smoothstep(0.72, 1, f));
  return erg * 4 * crest * smoothstep(minWave, 2 * minWave, 170);
}

/** the ground's height (m) at (x, z), as a level of texel spacing `texel` (m) holds it */
export function canyonHeight(x: number, z: number, texel = 0.5): number {
  return sample(x, z, texel);
}

/** what the ground is at a point, for the ground's shading and for placing things (the GPU's fill.wgsl `info` makes
 *  the same from a filled level: sand, damp, talus and zone are what ground.wgsl reads) */
export interface CanyonInfo {
  /** height (m) */
  h: number;
  /** sand lying on it, 0..1 */
  sand: number;
  /** bare rock showing, 0..1 */
  rock: number;
  /** steepness, 0 flat .. 1 sheer */
  cliff: number;
  /** distance from the river's centre line (m) */
  river: number;
  /** damp ground by the river, 1 at the water's edge .. 0 some 70 m off */
  damp: number;
  /** loose scree at a cliff's foot, 0..1 */
  talus: number;
  /** the designed zone (see HINT) */
  zone: number;
  /** a garden terrace's floor (the garden builder's planters stand here) */
  garden: boolean;
}

/** the ground at (x, z) as a level of texel `texel` (m) has it: its height and what covers it (sand on the flats and
 *  in hollows, rock on the steep, scree at the cliffs' feet, the river's damp banks) */
export function canyonInfo(x: number, z: number, texel = 0.5): CanyonInfo {
  const hx0 = sample(x - texel, z, texel), hx1 = sample(x + texel, z, texel);
  const hz0 = sample(x, z - texel, texel), hz1 = sample(x, z + texel, texel);
  // (a wider ring for hollows: sand gathers where the ground is lower than round it)
  const R = Math.max(Math.round(12 / texel), 1) * texel;
  const ring = (sample(x - R, z, texel) + sample(x + R, z, texel) + sample(x, z - R, texel) + sample(x, z + R, texel)) / 4;
  const h = sample(x, z, texel);
  const gx = (hx1 - hx0) / (2 * texel), gz = (hz1 - hz0) / (2 * texel);
  const slope = Math.sqrt(gx * gx + gz * gz);
  const cliff = smoothstep(0.5, 2.5, slope);
  const hollow = clamp((ring - h) / 3, -1, 1);
  const flat = 1 - smoothstep(0.12, 0.6, slope);
  const talus = HINT.kind === 1 ? smoothstep(0.1, 0.5, slope) * (1 - cliff) : 0;
  // (sand settles on the canyons' floors, less on the benches, least on the plateau's slickrock; in broad soft patches
  // and in every hollow)
  const settles = HINT.kind === -1 ? 0.62 : HINT.kind === 0 ? 0.2 : 0.08;
  let sand = clamp(flat * (settles + 0.55 * fbm(x, z, 140, 3, S_SAND + 1, 0.001)) + hollow * 0.5 - talus * 0.3, 0, 1);
  if (HINT.zone === 4 || HINT.zone === 6) sand = 0;
  const damp = 1 - smoothstep(RIVER.halfWidth, RIVER.halfWidth + 70, HINT.river);
  return { h, sand, rock: 1 - Math.max(sand, talus * 0.6), cliff, river: HINT.river, damp, talus, zone: HINT.zone, garden: HINT.zone === 4 };
}

/** the hoodoos standing in a box (x0, z0)-(x1, z1), with their foot and their top (the rocks put caps on them) */
export function hoodoosIn(x0: number, z0: number, x1: number, z1: number): (Hoodoo & { base: number; top: number })[] {
  const C = HOODOO_CELL, out: (Hoodoo & { base: number; top: number })[] = [];
  for (let cz = Math.floor(z0 / C); cz <= Math.floor(z1 / C); cz++) for (let cx = Math.floor(x0 / C); cx <= Math.floor(x1 / C); cx++) {
    const ho = hoodooOf(cx, cz);
    if (!ho || ho.height < 4 || ho.x < x0 || ho.x > x1 || ho.z < z0 || ho.z > z1) continue;
    let base = Infinity;
    for (let k = 0; k < 8; k++) base = Math.min(base, canyonHeight(ho.x + Math.cos(k * 0.785) * ho.r * 2, ho.z + Math.sin(k * 0.785) * ho.r * 2));
    out.push({ ...ho, base, top: canyonHeight(ho.x, ho.z) });
  }
  return out;
}

/** the canyons' centre lines as polylines every `step` m (the river's is the channel's: the water builds along it;
 *  the slots' and the south canyon's wander as their floors do) */
export function centreLines(step = 20): { river: V2[]; west: V2[]; east: V2[]; south: V2[] } {
  const line = (t0: number, t1: number, at: (t: number) => V2) => {
    const out: V2[] = [];
    for (let t = t0; t <= t1; t += step) out.push(at(t));
    return out;
  };
  return {
    river: line(-12000, 12000, (x) => [x, riverZ(x)]),
    west: line(WEST_CURVE.t[0], WEST_CURVE.t[WEST_CURVE.t.length - 1], (x) => [x, curveAt(WEST_CURVE, x) + meander(x, 260, 34 * smoothstep(-800, -1400, x), S_SLOT)]),
    east: line(EAST_CURVE.t[0], EAST_CURVE.t[EAST_CURVE.t.length - 1], (x) => [x, curveAt(EAST_CURVE, x) + meander(x, 240, 30 * smoothstep(800, 1400, x), S_SLOT + 1)]),
    south: line(SOUTH_CURVE.t[0], SOUTH_CURVE.t[SOUTH_CURVE.t.length - 1], (z) => [curveAt(SOUTH_CURVE, z) + meander(z, 420, 40 * smoothstep(700, 1300, z), S_SOUTH), z]),
  };
}

/** every number canyon.wgsl needs (f32-rounded where it matters), for tools/land-tables.ts to write tables.wgsl from */
export const TABLES = {
  scalars: {
    RIM_Y, FLOOR_Y, MESA_TOP: MESA.topY, TEMPLE_X: TEMPLE.x, TEMPLE_Z: TEMPLE.z, PROM_R: PROM.r, PROM_HW: PROM.halfWidth,
    PROM_NORTH: PROM.north, PROM_G, W_BOWL, W_RIVER, W_SOUTH, W_SLOT, W_FAR, K_RIDGE, RIVER_HW: RIVER.halfWidth,
    STAIR_W: STAIR.width, STAIR_SINK, LANDING_R, CLEFT_OUT, HOODOO_CELL,
  },
  vectors: {
    BASIN: [BASIN.cx, BASIN.cz, BASIN.rx, BASIN.rz], ARMS: [ARMS.cx, ARMS.cz, ARMS.rx, ARMS.rz],
    WALL: [WALL.cx, WALL.cz, WALL.rx, WALL.rz], TONGUE_RISE, TONGUE_SOLID, GAP_A, GAP_B,
    SIDE_HW: sides.map((c) => c.halfWidth),
  },
  seeds: { S_WARP, S_PLAT, S_RIVER, S_SLOT, S_SOUTH, S_FAR, S_BUTTE, S_MESA, S_HOODOO, S_SAND, S_DUNE, S_TRIB, S_PROM, S_STAIR, S_GULLY },
  curves: [RIVER_CURVE, WEST_CURVE, EAST_CURVE, SOUTH_CURVE],
  stairZ: STAIR_Z,
  landings: STAIR.landings.map(([x, z, y]) => [x, z, y]),
  wedges: WEDGES.map((w) => ({ d0: w.d0, d1: w.d1, r0: w.r0, r1: w.r1, steps: w.steps, drop: w.drop, w: w.w, short: w.short ? 1 : 0 })),
};
