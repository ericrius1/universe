// The star mesa's land as one deterministic height function, canyonHeight(x, z) (metres; x east, z south, y up; the
// origin the star's centre, where the citadel stands), and canyonInfo(x, z) with what the ground is made of there. It
// builds what layout.ts lays out:
//   - the plain round the mesa at PLAIN_Y, open desert: low swells, dunes in broad ergs, small outcrops standing well
//     off the mesa, patches of hoodoos nearer its foot, and towards the horizon (3-6 km out) big mesas on broad
//     stepped rises
//   - the star mesa: its cliff following the star's outline (layout.ts sdStar, the edge wandering only outward, so the
//     rim never reaches the town's building line), its walls stepped by the strata, notched by gullies with buttresses
//     standing out between them and its face wandering into spurs and bays below the lip, sand drifted at its foot;
//     inside the edge the rim's crest (parted at the east tip for the water gate, on a bastion), and inside that the
//     town's floor, exactly flat at FLOOR_Y
//   - on the floor the red-rock ridges (layout.ts RIDGES: trunks out of the notches, their branches and twigs), stepped
//     by the strata, cut down to the floor where the ways cross them, never past their keep-outs; the pools' beds and
//     the canal's and the sluice's, sunk into the floor inside their outlines
//   - the citadel's plateau at the centre (the old promontory's code on PLATEAU): its top flat at PLATEAU.topY, each
//     garden wedge's terrace floors (the shared formula gardenFloor), the spokes' slopes down the gaps between the
//     wedges, past the top wedges' courts the slab sectors' cracked slabs and their fissures, and past its edge a
//     stepped cliff from the edge's own height down to the floor
//   - the grand stair's corridor down the south spoke
//   - the east chute: the channel's fall from the sluice down the east tip's cliff over two ledges into a plunge pool,
//     cut in a buttress of the cliff (CHUTE), and the channel across the plain from it
//   - all of it as a smooth "base height" measured from the plain, which the strata (strata.ts) step into benches,
//     scree and cliffs: h = terrace(H) + PLAIN_Y, the town's floor and the plateau's top each a bench's top
// canyon.wgsl is the same function on the GPU (tables.wgsl, generated from here by tools/land-tables.ts, holds the
// numbers), agreeing within millimetres. `texel` is the sample spacing of the level being filled: detail too fine
// for it is left out rather than aliased. (The file keeps the canyon's name: the land is imported by it everywhere.)
import {
  CHANNEL, FLOOR_Y, GARDENS, GATE, PLAIN_Y, PLATEAU, POINTS, POOLS, RIDGES, RIDGE_CUTS, RIM, STAIR, STAR, WAYS, polyLength, ridgeKeep,
  sdStar, type V2,
} from '../world/layout';
import { clamp, fbm, hashF, mix, noise, smin, smoothstep } from './noise';
import { STRATA_K, STRATA_Y, terrace, terraceAlong, terraceKind, unterrace } from './strata';

// the town's floor and the plateau's top each stand on a bench's top in the strata (so the walls under them step
// cleanly from the plain, and the shader's colour bands line up with them)
const benchTop = (y: number) => STRATA_Y.some((v, i) => i > 0 && STRATA_K[i - 1] === 0 && Math.abs(v - y) < 1e-4);
for (const [what, y] of [["the town's floor", FLOOR_Y - PLAIN_Y], ["the plateau's top", PLATEAU.topY - PLAIN_Y]] as const) {
  if (!benchTop(y)) throw new Error(`strata: ${what}, ${y} m over the plain, is not a bench's top`);
}

const f32 = Math.fround;

// seeds of the noises (the WGSL copy uses the same)
const S_WARP = 11, S_PLAT = 31, S_EDGE = 41, S_FISSURE = 51, S_CREST = 61, S_FAR = 71, S_BUTTE = 81, S_MESA = 91;
const S_HOODOO = 101, S_SAND = 111, S_DUNE = 121, S_RIDGE = 131, S_PROM = 141, S_STAIR = 151, S_GULLY = 161, S_SLAB = 171;

// ------------------------------------------------------------------ the designed places, as numbers
/** the town's floor as a base height (from the plain): a knot of the strata, so terrace() gives it back exactly */
const F_FLOOR = f32(unterrace(FLOOR_Y - PLAIN_Y));
/** the mesa's walls: base height lost per metre out from the edge (steep: the strata make cliffs and benches of it,
 *  some 40 m from the lip to the plain) */
const MESA_G = 2.4;
/** the rim's lip at the edge, as a share of its crest (the crest peaks a few metres in) */
const LIP = 0.62;
/** the plateau's cliffs: base height lost per metre out from its edge (its 31 m from the top to the floor in ~10 m, and
 *  never more than ~14: the ring road's inner chords sag to r 317) */
const PLAT_G = 3.0;
/** how far in the plateau's edge may wander where its slab sectors are (never out) */
const PLAT_IN = PLATEAU.wander * 0.6;
/** the outcrops' and the hoodoos' cells (m) */
const OUTCROP_CELL = 700, HOODOO_CELL = 48;

// the star's outline folded as layout.ts sdStar folds it (the numbers canyon.wgsl's copy reads): the tip T on +x, the
// notch N, the edge T -> N's outward normal (EA) and the next point's edge's (EC), the turn
const HALF_A = Math.PI / STAR.points;
const STAR_M: V2 = [Math.cos(HALF_A), Math.sin(HALF_A)];
const STAR_ROT: V2 = [Math.cos((-STAR.rot * Math.PI) / 180), Math.sin((-STAR.rot * Math.PI) / 180)];
const STAR_N: V2 = [STAR.rIn * STAR_M[0], STAR.rIn * STAR_M[1]];
const STAR_EA: V2 = (() => { const dx = STAR_N[0] - STAR.rTip, dz = STAR_N[1], L = Math.hypot(dx, dz); return [dz / L, -dx / L]; })();
const STAR_EC: V2 = (() => { const d = -STAR_EA[0] * STAR_M[1] + STAR_EA[1] * STAR_M[0]; return [STAR_EA[0] + 2 * d * STAR_M[1], STAR_EA[1] - 2 * d * STAR_M[0]]; })();

/** the grand stair's landings' (z, y), north to south (down) */
const STAIR_Z = [...STAIR.landings].sort((a, b) => a[1] - b[1]).map((l) => [f32(l[1]), f32(l[2])]);
/** the stair's cleft runs out to its foot landing on the ring road (r) */
const CLEFT_R = Math.hypot(STAIR.landings[0][0] - PLATEAU.cx, STAIR.landings[0][1] - PLATEAU.cz);

/** each garden wedge with its sides' directions (from the plateau's centre) and its band width */
const WEDGES = GARDENS.wedges.map((w) => ({
  ...w, w: (w.r1 - w.r0) / w.steps,
  d0: [f32(Math.cos(w.a0)), f32(Math.sin(w.a0))], d1: [f32(Math.cos(w.a1)), f32(Math.sin(w.a1))],
  // (a wedge that ends on the top, short of the edge — a top wedge's sunken courts, its slab sector beyond — lets its
  // ramp line fade past its end)
  short: w.r1 < PLATEAU.r - 30,
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

// ------------------------------------------------------------------ the star's points (a table per point)
/** the points' tips' directions: a point of the mesa's top is in the point whose tip it faces most, and in one of three
 *  bands out from the centre (its sector: 3 a point) */
const TIPS: V2[] = POINTS.map((p) => [f32(Math.cos((p.tip * Math.PI) / 180)), f32(Math.sin((p.tip * Math.PI) / 180))]);
const BANDS: V2 = [430, 560];
const SECTORS = TIPS.length * 3;
function sectorOf(x: number, z: number): number {
  const dx = x - STAR.cx, dz = z - STAR.cz;
  let k = 0, best = -Infinity;
  for (let i = 0; i < TIPS.length; i++) {
    const d = TIPS[i][0] * dx + TIPS[i][1] * dz;
    if (d > best) { best = d; k = i; }
  }
  const r2 = dx * dx + dz * dz;
  return k * 3 + (r2 < BANDS[0] * BANDS[0] ? 0 : r2 < BANDS[1] * BANDS[1] ? 1 : 2);
}
/** things sorted by the sectors they reach into (each listed in every sector any of its ground reaches, with a margin, so
 *  which sector a point on a boundary is given never matters): their indices, and each sector's first (SECTORS + 1
 *  offsets) */
function bySector(n: number, reaches: (i: number) => V2[]): { idx: number[]; off: number[] } {
  const lists: number[][] = Array.from({ length: SECTORS }, () => []);
  for (let i = 0; i < n; i++) {
    const seen = new Set<number>();
    for (const [x, z] of reaches(i)) seen.add(sectorOf(x, z));
    for (const k of seen) lists[k].push(i);
  }
  const off = [0];
  for (const l of lists) off.push(off[off.length - 1] + l.length);
  return { idx: lists.flat(), off };
}
/** the points round a disc (its centre and 24 round its edge) */
const discPoints = (x: number, z: number, r: number): V2[] => [[x, z], ...Array.from({ length: 24 }, (_, k) => [x + r * Math.cos((k * Math.PI) / 12), z + r * Math.sin((k * Math.PI) / 12)] as V2)];

// ------------------------------------------------------------------ the ridges
/** each ridge's segments, with where along its ridge each starts, the ridge's length, its half-width and crest at the
 *  root and the end, and its cut (how far along the ridge its middle is, half its width; 0 none) */
interface RidgeSeg { ax: number; az: number; bx: number; bz: number; len: number; s0: number; L: number; hw0: number; hw1: number; c0: number; c1: number; cut: number; cutHalf: number }
const RIDGE_SEGS: RidgeSeg[] = RIDGES.flatMap((r, i) => {
  const L = polyLength(r.pts), c = RIDGE_CUTS.find((q) => q.ridge === i);
  let cut = c?.along ?? 0, cutHalf = c ? c.width / 2 : 0;
  if (r.kind === 'trunk') {
    // (a trunk's root runs under the ring road: down to the floor from its root out to its cut's far side, and on to
    // where its keep-out begins, square to its first stretch WAYS.ring.r1 + 2 out from the centre — layout.ts's
    // ridgeClaims — so nothing of it rises under the town's claims there)
    const [a, b] = r.pts, l = Math.hypot(b[0] - a[0], b[1] - a[1]), d = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    const keep = WAYS.ring.r1 + 2 - ((a[0] - STAR.cx) * d[0] + (a[1] - STAR.cz) * d[1]);
    const s1 = Math.max(cut + cutHalf, keep), s0 = Math.min(cut - cutHalf, -10);
    cut = (s0 + s1) / 2; cutHalf = (s1 - s0) / 2;
  }
  let s = 0;
  return r.pts.slice(0, -1).map((a, k) => {
    const b = r.pts[k + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const g = { ax: a[0], az: a[1], bx: b[0], bz: b[1], len, s0: s, L, hw0: r.hw[0], hw1: r.hw[1], c0: r.crest[0], c1: r.crest[1], cut, cutHalf };
    s += len;
    return g;
  });
});
/** how far a ridge's flanks reach out from its line, half-width hw and its wander (a share, ±0.25) given: never past
 *  its keep-out (layout.ts ridgeKeep: a + b·hw) */
const KEEP_A = ridgeKeep(0), KEEP_B = ridgeKeep(1) - KEEP_A;
const ridgeReach = (hw: number, wander: number) => Math.min(1.15 * hw * (1 + wander), KEEP_A + KEEP_B * hw - 0.5);
const RIDGE_SECTORS = bySector(RIDGE_SEGS.length, (i) => {
  const g = RIDGE_SEGS[i], R = ridgeReach(Math.max(g.hw0, g.hw1), 0.25) + 2, n = Math.ceil(g.len / 2), out: V2[] = [];
  for (let k = 0; k <= n; k++) out.push(...discPoints(g.ax + ((g.bx - g.ax) * k) / n, g.az + ((g.bz - g.az) * k) / n, R));
  return out;
});

/** the first scree bed's top over the floor, as a base height over the floor's: a ridge's skirt rises to it, its rock
 *  spine stands over it */
const RIDGE_SKIRT = unterrace(FLOOR_Y - PLAIN_Y + 6.5) - F_FLOOR;
/** the ridges' height over the floor at (x, z), as a base height over the floor's (the strata step them): each a skirt
 *  of scree over its outer third and a spine of rock along its middle half up to its crest, its half-width and crest falling
 *  root to end, both wandering ±25% along it (broadly, and in buttresses and knobs over ~30 m), its flanks gullied; down
 *  to the floor across its cut; nothing past its reach (inside its keep-out) */
function ridgesAt(x: number, z: number, minWave: number): number {
  const k = sectorOf(x, z);
  // (the wander's noises only once a ridge is in reach: most of the floor is far from any)
  let nw = 0, nc = 0, rough = 0, noised = false;
  let H = 0;
  for (let j = RIDGE_SECTORS.off[k]; j < RIDGE_SECTORS.off[k + 1]; j++) {
    const g = RIDGE_SEGS[RIDGE_SECTORS.idx[j]];
    const ex = g.bx - g.ax, ez = g.bz - g.az;
    const u = clamp(((x - g.ax) * ex + (z - g.az) * ez) / (g.len * g.len), 0, 1);
    const qx = g.ax + ex * u - x, qz = g.az + ez * u - z;
    const d = Math.sqrt(qx * qx + qz * qz);
    if (d >= ridgeReach(Math.max(g.hw0, g.hw1), 0.25)) continue;
    if (!noised) {
      noised = true;
      const kr = smoothstep(minWave, 2 * minWave, 30);
      nw = 0.17 * clamp(noise(x, z, 90, S_RIDGE) / 0.45, -1, 1) + 0.08 * kr * clamp(noise(x, z, 30, S_RIDGE + 3) / 0.45, -1, 1);
      nc = 0.17 * clamp(noise(x, z, 60, S_RIDGE + 1) / 0.45, -1, 1) + 0.08 * kr * clamp(noise(x, z, 24, S_RIDGE + 4) / 0.45, -1, 1);
      rough = fbm(x, z, 26, 2, S_RIDGE + 2, minWave);
    }
    const s = g.s0 + u * g.len, t = s / g.L;
    const reach = ridgeReach(g.hw0 + (g.hw1 - g.hw0) * t, nw);
    if (d >= reach) continue;
    // (the skirt rising over the outer third or so, the spine over the middle half, both roughened most half way up)
    const xr = d / reach;
    const skirt = smoothstep(1, 0.62, xr), spine = smoothstep(0, 1, clamp(1 - xr / 0.56, 0, 1));
    const crest = (g.c0 + (g.c1 - g.c0) * t) * (1 + nc);
    const B = unterrace(FLOOR_Y - PLAIN_Y + crest) - F_FLOOR, Bs = Math.min(B, RIDGE_SKIRT);
    const p = clamp(skirt + 2 * rough * skirt * (1 - skirt), 0, 1) * Bs + clamp(spine + 1.5 * rough * spine * (1 - spine), 0, 1) * (B - Bs);
    const cut = g.cutHalf > 0 ? smoothstep(g.cutHalf, g.cutHalf + 6, Math.abs(s - g.cut)) : 1;
    H = Math.max(H, p * cut);
  }
  return H;
}

// ------------------------------------------------------------------ the water's beds
/** a bed's bank: it rises to the floor over this, inside the water's outline (so the coping stands on flat ground) */
const BANK = 1.5;
/** the pools' beds, this far under the floor */
const POOL_BED = 2.4;
/** the pools as their beds take them (the tank last): centre, radii, turn, reach */
const POOL_T = POOLS.map((q) => ({ x: q.x, z: q.z, rx: q.rx, rz: q.rz, c: f32(Math.cos(q.rot)), s: f32(Math.sin(q.rot)), R: Math.max(q.rx, q.rz) }));
const POOL_SECTORS = bySector(POOL_T.length, (i) => discPoints(POOL_T[i].x, POOL_T[i].z, POOL_T[i].R + 2));

/** the pools' beds at (x, z): how far under the floor (0 outside them) */
function poolsAt(x: number, z: number): number {
  const k = sectorOf(x, z);
  let low = 0;
  for (let j = POOL_SECTORS.off[k]; j < POOL_SECTORS.off[k + 1]; j++) {
    const q = POOL_T[POOL_SECTORS.idx[j]];
    const dx = x - q.x, dz = z - q.z;
    if (Math.abs(dx) > q.R || Math.abs(dz) > q.R) continue;
    const d = sdEllipse(q.c * dx + q.s * dz, -q.s * dx + q.c * dz, q.rx, q.rz);
    if (d < 0) low = Math.min(low, -POOL_BED * smoothstep(0, BANK, -d));
  }
  return low;
}

/** the canal's and the sluice's bed cut in the floor along the east axis, from the palace's back to the chute's lip: its
 *  start (x), the axis (z), half its width, its bed */
const CANAL = { x0: CHANNEL.canal[0][0], z: CHANNEL.canal[0][1], half: CHANNEL.width / 2, bed: CHANNEL.bed };

/** The east chute: the channel's fall down the east tip's cliff from the sluice, cut CHUTE.half either side of the axis
 *  into a buttress of the cliff, in three falls — onto two ledges at the cliff's benches (CHANNEL.cascade's levels: the
 *  water stands there in a basin behind a sill at each ledge's outer end) and into a plunge pool at its foot, which the
 *  plain's channel leaves. `ends`: where (x) the lip is and each ledge and the pool end; `levels`: the water's on the
 *  sluice, each ledge and the pool; the basins' depth under them and the sills' length; the pool's bed. The buttress's
 *  walls stand `over` the water beside each ledge, step down `out` past each fall, and are `w` wide either side. The
 *  water's builder lays its cascades on these */
export const CHUTE = {
  x: STAR.cx, z: GATE.z, half: 7, ends: [782, 796, 812, CHANNEL.plain.path[0][0]] as const, levels: CHANNEL.cascade,
  basin: 0.6, sill: 1.5, poolBed: CHANNEL.plain.level - 2, wall: { over: 4, out: 3, w: 5 },
};

/** the canal's bed at (x, z) (0 off it) */
function canalAt(x: number, z: number): number {
  const u = x - CHUTE.x, v = Math.abs(z - CANAL.z);
  if (u < CANAL.x0 - 1 || u > CHUTE.ends[0] || v > CANAL.half) return 0;
  return CANAL.bed * smoothstep(0, BANK, Math.min(CANAL.half - v, u - CANAL.x0));
}

/** the chute's bed u metres out along the east axis (its falls half a metre wide: sheer, but never a jump) */
function chuteBed(u: number): number {
  const [lip, e1, e2, e3] = CHUTE.ends, L = CHUTE.levels, b = CHUTE.basin, sl = CHUTE.sill;
  let y = CANAL.bed;
  y = mix(y, L[1] - b, smoothstep(lip, lip + 0.5, u));
  y = mix(y, L[2] - b, smoothstep(e1, e1 + 0.5, u));
  y = mix(y, CHUTE.poolBed, smoothstep(e2, e2 + 0.5, u));
  // (each ledge's sill, up to its water's level; the pool's far bank up to the plain's channel's bed)
  y += b * (smoothstep(e1 - sl, e1, u) * (1 - smoothstep(e1, e1 + 0.5, u)) + smoothstep(e2 - sl, e2, u) * (1 - smoothstep(e2, e2 + 0.5, u)));
  return mix(y, CHANNEL.plain.bed, smoothstep(e3 - 4, e3, u));
}

/** the buttress the chute is cut in, as a base height (nothing off it): its walls' tops the floor to just past the lip,
 *  then a little over each ledge's water, stepping down just past each fall to the plain; falling away either side as the
 *  mesa's cliff does */
function buttress(x: number, z: number): number {
  const u = x - CHUTE.x, v = Math.abs(z - CHUTE.z), W = CHUTE.wall, [lip, e1, e2] = CHUTE.ends, L = CHUTE.levels;
  if (u < lip - 10 || u > e2 + W.out + 10 || v > CHUTE.half + W.w + 45) return -1e9;
  let y = FLOOR_Y;
  y = mix(y, L[1] + W.over, smoothstep(lip + W.out, lip + W.out + 0.5, u));
  y = mix(y, L[2] + W.over, smoothstep(e1 + W.out, e1 + W.out + 0.5, u));
  y = mix(y, PLAIN_Y, smoothstep(e2 + W.out, e2 + W.out + 0.5, u));
  return unterrace(y - PLAIN_Y) - MESA_G * Math.max(v - CHUTE.half - W.w, 0);
}

/** the plain's channel's line (z of x): CHANNEL.plain.path, smooth through its points */
const CHANNEL_CURVE = makeCurve(CHANNEL.plain.path);
/** distance (m) from the plain's channel's line, and past its ends along it */
export function channelDistance(x: number, z: number): number {
  const c = CHANNEL_CURVE, n = c.t.length;
  const zc = curveAt(c, x), sl = curveD;
  return Math.abs(z - zc) / Math.sqrt(1 + sl * sl) + Math.max(c.t[0] - x, x - c.t[n - 1], 0);
}
/** the plain's channel's line as a polyline every `step` m (the water builds along it) */
export function channelLine(step = 10): V2[] {
  const c = CHANNEL_CURVE, out: V2[] = [];
  for (let x = c.t[0]; x < c.t[c.t.length - 1]; x += step) out.push([x, curveAt(c, x)]);
  out.push([c.t[c.t.length - 1], c.v[c.v.length - 1]]);
  return out;
}
/** the channel's bed at distance dc from its line: its bed, its banks rising to the plain, steeper out past them */
function channelBed(dc: number): number {
  const P = CHANNEL.plain;
  return P.bed + (PLAIN_Y - P.bed) * smoothstep(P.halfWidth - 3, P.halfWidth + 6, dc) + Math.max(dc - P.halfWidth - 6, 0) * 3;
}

// ------------------------------------------------------------------ the plateau and its gardens
/** what the plateau's surface is at the last gardenSurface: 4 a terrace, 3 a spoke gap's slope, 5 the plain top */
let gardenZone = 5;

/** a continuous staircase: t rounded down to whole numbers, each riser spread over the width e centred on the whole
 *  number (so a floor never jumps: the GPU and the CPU never land on different steps) */
export function steps(t: number, e: number): number {
  const u = t + e / 2, k = Math.floor(u);
  return k - 1 + Math.min((u - k) / e, 1);
}

/** the terrace floor's height at a point inside a wedge: band k (r0 + k·w .. r0 + (k+1)·w from the temple) is
 *  PLATEAU.topY - k·drop; stepped over 0.5 m centred on each band's boundary (the retaining wall stands there). The
 *  garden builder uses the same formula, so its planters sit on this ground. Points before r0 are the top; past r1 the
 *  last. */
export function gardenFloor(r: number, w: { r0: number; r1: number; steps: number; drop: number }): number {
  const bw = (w.r1 - w.r0) / w.steps;
  return PLATEAU.topY - w.drop * clamp(steps((r - w.r0) / bw, 0.5 / bw), 0, w.steps - 1);
}

/** the plateau's surface at a point, extended past its edge (radially constant there): the top, the wedges' terraces,
 *  and between neighbouring wedges the spokes' slopes (the line through a flank wedge's terraces' inner corners, so a
 *  terrace stands up to a drop above it: the causeways are built on it) */
function gardenSurface(x: number, z: number): number {
  const dx = x - PLATEAU.cx, dz = z - PLATEAU.cz;
  const r = Math.sqrt(dx * dx + dz * dz);
  const top = PLATEAU.topY;
  let gap = top, inS = top, inW = 0;
  for (let i = 0; i < WEDGES.length; i++) {
    const w = WEDGES[i];
    // metres inside the wedge's two radial sides (negative outside)
    const c0 = w.d0[0] * dz - w.d0[1] * dx, c1 = dx * w.d1[1] - dz * w.d1[0];
    const lat = Math.min(c0, c1);
    const t = (r - w.r0) / w.w;
    const line = top - w.drop * clamp(t, 0, w.steps);
    // (the ramp's line reaches ~10 degrees out from the wedge's sides; a short wedge's fades just past its end)
    let near = 1 - smoothstep(0.17 * r, 0.22 * r + 0.01, -lat);
    if (w.short) near *= 1 - smoothstep(w.r1, w.r1 + 0.5, r);
    gap = Math.min(gap, mix(top, line, near));
    let wi = clamp(lat / 0.5 + 0.5, 0, 1) * clamp((r - w.r0) / 0.5 + 0.5, 0, 1);
    if (w.short) wi *= clamp((w.r1 - r) / 0.5 + 0.5, 0, 1);
    if (wi > 0) { inW = wi; inS = gardenFloor(r, w); }
  }
  gardenZone = inW > 0.5 ? 4 : gap < top - 0.05 ? 3 : 5;
  // (never under the town's floor: a flank wedge's slope reaches it right at the plateau's edge)
  return Math.max(mix(gap, inS, inW), FLOOR_Y);
}

/** signed distance to the plateau's footprint: a disc round the citadel, its edge drawn in by up to PLAT_IN over its
 *  slab sectors (past the top wedges' courts), never out — its cliff's foot stays inside the ring road — and exact where
 *  a flank wedge's terraces or a spoke come to it */
function sdPlat(x: number, z: number): number {
  const dx = x - PLATEAU.cx, dz = z - PLATEAU.cz;
  const r = Math.sqrt(dx * dx + dz * dz);
  let slab = 0;
  for (let i = 0; i < WEDGES.length; i++) {
    const w = WEDGES[i];
    if (!w.short) continue;
    slab = Math.max(slab, smoothstep(8, 40, Math.min(w.d0[0] * dz - w.d0[1] * dx, dx * w.d1[1] - dz * w.d1[0])));
  }
  return r - PLATEAU.r + PLAT_IN * slab * smoothstep(-0.4, 0.4, noise(x, z, 120, S_PROM));
}

/** the plateau's slabs (its top's cracked red rock, past the top wedges' courts): Voronoi cells of 45-80 m (a jittered
 *  62 m lattice), each sunk 0, 1.2 or 2.4 m under the top and tilted under 2%, parted by fissures 3-6 m wide and
 *  FISSURE_DEEP deep (their floor the same on both sides, so it never matters which cell is nearest on an edge; only
 *  where a level's texels can hold them, fading out past 1.5 m texels, though their zone still marks them for the
 *  shader's crease); 20 m clear of the spokes' gaps the top stays whole. S is the surface they're cut in; sets slabZone */
const SLAB_CELL = 62, SLAB_STEP = 1.2, FISSURE_DEEP = 6;
let slabZone = 5;
function slabs(x: number, z: number, S: number, texel: number): number {
  const dx = x - PLATEAU.cx, dz = z - PLATEAU.cz;
  const r = Math.sqrt(dx * dx + dz * dz);
  let slab = 0;
  for (let i = 0; i < WEDGES.length; i++) {
    const w = WEDGES[i];
    if (!w.short) continue;
    const lat = Math.min(w.d0[0] * dz - w.d0[1] * dx, dx * w.d1[1] - dz * w.d1[0]);
    slab = Math.max(slab, smoothstep(20, 34, lat) * smoothstep(w.r1 + 4, w.r1 + 18, r));
  }
  slabZone = 5;
  if (slab <= 0) return S;
  const C = SLAB_CELL, ix = Math.floor(x / C), iz = Math.floor(z / C);
  let f1 = 1e9, f2 = 1e9, sx = 0, sz = 0, cx1 = 0, cz1 = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cz = iz + j;
    const px = (cx + 0.15 + 0.7 * hashF(cx, cz, S_SLAB)) * C, pz = (cz + 0.15 + 0.7 * hashF(cx, cz, S_SLAB + 1)) * C;
    const ddx = x - px, ddz = z - pz, d = Math.sqrt(ddx * ddx + ddz * ddz);
    if (d < f1) { f2 = f1; f1 = d; sx = px; sz = pz; cx1 = cx; cz1 = cz; } else if (d < f2) f2 = d;
  }
  // (the nearest cell's slab: its sinking and its tilt about its site)
  const sink = SLAB_STEP * Math.floor(hashF(cx1, cz1, S_SLAB + 2) * 3);
  const gx = (hashF(cx1, cz1, S_SLAB + 3) - 0.5) * 0.028, gz = (hashF(cx1, cz1, S_SLAB + 4) - 0.5) * 0.028;
  const top = S - slab * (sink - gx * (x - sx) - gz * (z - sz));
  const w = 3 + 3 * smoothstep(-0.4, 0.4, noise(x, z, 90, S_FISSURE));
  const e = f2 - f1;
  if (e < 0.8 * w && slab > 0.5) slabZone = 9;
  const k = 1 - smoothstep(0.45 * w, w, e);
  return mix(top, PLATEAU.topY - FISSURE_DEEP, k * slab * (1 - smoothstep(1.5, 3, texel)));
}

/** the plateau: its surface over its footprint (its slab sectors' slabs and fissures in it), and past the edge a stepped
 *  cliff falling from the edge's height to the floor (base heights lost at PLAT_G per metre, stepped by the same strata as every wall; the cliff's face wanders a
 *  little below the edge, which stays exact). Its zone, its strata segment, and whether the point is on its top, in
 *  platZone, platKind, platIn */
let platZone = 0, platKind = -1, platIn = false;
function plateau(x: number, z: number, wn: number, texel: number): number {
  // (its edge only ever wanders in: past PLATEAU.r + 20 there's nothing of it)
  const ox = x - PLATEAU.cx, oz = z - PLATEAU.cz;
  platIn = false;
  if (ox * ox + oz * oz > (PLATEAU.r + 21) * (PLATEAU.r + 21)) { platZone = 0; return -1e9; }
  const d = sdPlat(x, z);
  platIn = d <= 0;
  if (d > 20) { platZone = 0; return -1e9; }
  // (the slabs and their fissures run out to the edge, and the cliff falls from them: the fissures notch its lip)
  const S = slabs(x, z, gardenSurface(x, z), texel);
  if (d <= 0) { platZone = slabZone !== 5 ? slabZone : gardenZone; platKind = -1; return S; }
  platZone = 0;
  // (buttresses and bays below the edge, the ground past the edge still always falling away: at least three quarters
  // as steep as the cliff's own slope, so its foot stays within ~14 m)
  const out = Math.max(d + wn * smoothstep(0.5, 8, d), 0.75 * d);
  const h = Math.max(terrace(unterrace(S - PLAIN_Y) - PLAT_G * out) + PLAIN_Y, FLOOR_Y);
  platKind = terraceKind;
  return h;
}

// ------------------------------------------------------------------ the grand stair's corridor
/** the stair's height going south (z), through the landings: the flights are straight between them, so along a
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
const STAIR_SINK = 0.3, LANDING_R = 11;
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
 *  few metres lower, never under the town's floor (the stair stands on its own retaining walls there); the cleft's
 *  sides are cut sheer (the wedges' retaining walls, the notch's walls). Sets the zone to 2 inside */
let corridorZone = false;
function corridor(x: number, z: number, h: number): number {
  corridorZone = false;
  const dx = x - PLATEAU.cx, dz = z - PLATEAU.cz;
  const r = Math.sqrt(dx * dx + dz * dz);
  // (the cleft runs out through the plateau's cliff to the stair's foot on the ring road)
  const gap = Math.min(GAP_A[0] * dz - GAP_A[1] * dx, dx * GAP_B[1] - dz * GAP_B[0], CLEFT_R - r);
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
  // (the cleft's floor follows the stair's run south, a few metres under it, in rock ledges)
  const below = 2 + 5 * smoothstep(0, 20, -foot) + 1.5 * noise(x, z, 23, S_STAIR);
  const ravine = Math.max(3 * steps((stairProfile(z) - below) / 3, 0.2), FLOOR_Y);
  const surf = mix(target, Math.min(ravine, target), smoothstep(0, 4, -foot));
  const o = Math.max(-inside, 0);
  corridorZone = inside >= 0;
  return clamp(h, surf - o * 0.7, surf + o * 120);
}

// ------------------------------------------------------------------ the natural land (a base height, from the plain)
/** the domain warp of the last warpAt (m): ragged outcrops, gullies' wandering lines; and a scalar one (wn) for the
 *  faces that wander out into buttresses and back into bays below an edge that stays exact (the mesa's, the plateau's).
 *  Made only where something needs it (warp(): once a sample) */
let wx = 0, wz = 0, wn = 0, warped = false;
function warp(x: number, z: number, minWave: number): void {
  if (!warped) { warped = true; warpAt(x, z, minWave); }
}
function warpAt(x: number, z: number, minWave: number): void {
  const k2 = smoothstep(minWave, 2 * minWave, 130), k3 = smoothstep(minWave, 2 * minWave, 16);
  wx = 95 * noise(x, z, 520, S_WARP) + 26 * k2 * noise(x, z, 130, S_WARP + 2) + 1.8 * k3 * noise(x, z, 16, S_WARP + 4);
  wz = 95 * noise(x, z, 520, S_WARP + 1) + 26 * k2 * noise(x, z, 130, S_WARP + 3) + 1.8 * k3 * noise(x, z, 16, S_WARP + 5);
  const k4 = smoothstep(minWave, 2 * minWave, 30);
  wn = 26 * k2 * noise(x, z, 85, S_WARP + 6) + 9 * k4 * noise(x, z, 28, S_WARP + 8) + 1.8 * k3 * noise(x, z, 16, S_WARP + 7);
}

/** the east tip, where the channel leaves the mesa through the rim (its edge held exact there) */
function eastTip(x: number, z: number): number {
  return smoothstep(620, 680, x - STAR.cx) * (1 - smoothstep(40, 80, Math.abs(z - STAR.cz)));
}

/** the water gate's bastion at the east tip: a rounded box (centre x, z, half extents, corner radius) the mesa's edge
 *  is pushed out to hold, so the gate's towers (their claims reach 24 m either side of the sluice, where the tip is
 *  narrower than that) stand on the floor and the chute falls from its face */
const BASTION = { cx: GATE.x - 20, cz: GATE.z, hx: 40, hz: 27, r: 6 };
function sdBastion(x: number, z: number): number {
  const qx = Math.abs(x - BASTION.cx) - BASTION.hx + BASTION.r, qz = Math.abs(z - BASTION.cz) - BASTION.hz + BASTION.r;
  const ox = Math.max(qx, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(qx, qz), 0) - BASTION.r;
}

/** how far out the cliff's edge stands from the star's exact outline: 0 .. STAR.wander, never in (so the rim's crest
 *  never reaches the town's building line), wandering over ~140 m and ragged over ~40; none at the east tip */
function edgeOut(x: number, z: number, minWave: number): number {
  const k = smoothstep(minWave, 2 * minWave, 40);
  const w = 0.75 * smoothstep(-0.4, 0.4, noise(x, z, 140, S_EDGE)) + 0.25 * k * smoothstep(-0.35, 0.35, noise(x, z, 40, S_EDGE + 1));
  return STAR.wander * w * (1 - eastTip(x, z));
}

/** the rim's crest over the floor, t metres in from the edge (a base height over the floor's): from its lip at the edge
 *  up to its peak 6-10 m in, down to nothing RIM.w in; its peak RIM.crest's 8-13 m over the floor, how high and where
 *  wandering along the rim, its line notched and knobbed (the strata make it scree under a steep lip). At the east tip
 *  it parts for the water gate: its towers and the sluice between them stand on the floor, the cliff's lip there too */
function crestBase(x: number, z: number, t: number, minWave: number): number {
  if (t >= RIM.w) return 0;
  const reach = GATE.width / 2 + 2 * GATE.towerR;
  const gate = smoothstep(GATE.x - 60, GATE.x - 30, x) * (1 - smoothstep(reach + 4, reach + 20, Math.abs(z - GATE.z)));
  if (gate >= 1) return 0;
  const c = RIM.crest[0] + (RIM.crest[1] - RIM.crest[0]) * smoothstep(-0.4, 0.4, noise(x, z, 260, S_CREST));
  const p = 6 + 4 * smoothstep(-0.4, 0.4, noise(x, z, 190, S_CREST + 1));
  const B = unterrace(FLOOR_Y - PLAIN_Y + c) - F_FLOOR;
  const f = t < p ? LIP + (1 - LIP) * smoothstep(0, p, t) : 1 - smoothstep(p, RIM.w, t);
  const k = smoothstep(minWave, 2 * minWave, 35);
  return B * f * (1 + 0.18 * k * noise(x, z, 35, S_CREST + 2)) * (1 - gate);
}

/** the normalized place on the mesa's wall of the last mesa() (0 at its foot, 1 at its lip, negative out on the plain,
 *  9 on the mesa's top): sand drifts where it's near 0 */
let uMin = 9;
/** the star mesa as a base height at (x, z), dE metres out from its edge (negative inside): the floor, the rim's crest
 *  inside the edge, and outside it the cliff down to the plain — its face wandering out into buttresses and back into
 *  bays below the lip (wn), gullies notched down it and spurs standing out between them (only on the wall: the lip and
 *  the foot stay where they are) */
function mesa(x: number, z: number, qx: number, qz: number, dE: number, minWave: number): number {
  if (dE <= 0) { uMin = 9; return F_FLOOR + crestBase(x, z, -dE, minWave); }
  const lip = F_FLOOR + crestBase(x, z, 0, minWave);
  const out = Math.max(dE + wn * smoothstep(0.5, 8, dE), 0.5 * dE);
  // (the share of the wall's drop above the point)
  let c = clamp((MESA_G * out) / lip, 0, 1);
  uMin = 1 - (MESA_G * out) / lip;
  const wall = 4 * c * (1 - c);
  const g = Math.abs(fbm(qx, qz, 150, 2, S_GULLY, minWave));
  c = clamp(c + wall * (0.3 * (1 - smoothstep(0.015, 0.09, g)) - 0.1 * smoothstep(0.18, 0.4, g)), 0, 1);
  return lip * (1 - c);
}

/** the far land's reach: none of it within ~3 km of the star, all of it past ~6 (a wandering edge, not a ring; within
 *  2 km its wander can't reach) */
function farness(x: number, z: number): number {
  const r = Math.sqrt(x * x + z * z);
  return r < 2000 ? 0 : smoothstep(2800, 6000, r + 900 * noise(x, z, 5000, S_FAR + 11));
}

/** the land as a base height at (x, z), dE metres out from the mesa's edge, `far` its farness */
function natural(x: number, z: number, dE: number, far: number, minWave: number, texel: number): number {
  uMin = 9;
  // the plain: flat near the mesa; far out, broad stepped rises and the mesas standing on them
  let H = 0;
  if (far > 0) H = Math.max(far * 40 * fbm(x, z, 9000, 2, S_PLAT + 5, minWave), mesas(x, z, far, minWave), 0);
  // the star mesa (its walls end some 40 m out, a little more where a buttress stands), and at its east tip the
  // buttress the chute falls down
  if (dE < 110) {
    // (its walls wander and are gullied by the warp; its top needs none)
    if (dE > 0) warp(x, z, minWave);
    H = Math.max(H, mesa(x, z, x + wx, z + wz, dE, minWave), buttress(x, z));
  }
  // small outcrops on the plain, in 700 m cells, well off the mesa
  if (dE > 150) H = Math.max(H, outcrops(x, z, minWave));
  // hoodoos nearer the mesa's foot
  if (texel < 3 && dE > 140 && dE < 640) H += hoodoos(x, z, texel);
  return H;
}

/** the outcrops' base height at (x, z), their outlines read at the point a little warped (ragged): each 700 m cell may
 *  hold one (20-70 m across, 10-45 m tall), 250 m clear of the star and 120 m of the channel (it stands well inside its
 *  cell, more than its reach and the warp's from its edges, so only the point's own cell can reach it) */
function outcrops(x: number, z: number, minWave: number): number {
  const C = OUTCROP_CELL;
  const cx = Math.floor(x / C), cz = Math.floor(z / C);
  if (hashF(cx, cz, S_BUTTE) > 0.18) return -1e9;
  const bx = (cx + 0.2 + 0.6 * hashF(cx, cz, S_BUTTE + 1)) * C, bz = (cz + 0.2 + 0.6 * hashF(cx, cz, S_BUTTE + 2)) * C;
  const rad = 20 + 50 * hashF(cx, cz, S_BUTTE + 3);
  // (the warp moves a point at most ~34 m)
  if (Math.abs(x - bx) > rad + 40 || Math.abs(z - bz) > rad + 40) return -1e9;
  warp(x, z, minWave);
  const ddx = x + 0.35 * wx - bx, ddz = z + 0.35 * wz - bz;
  const d = Math.sqrt(ddx * ddx + ddz * ddz);
  if (d > rad) return -1e9;
  const clear = smoothstep(rad + 250, rad + 290, sdStar(bx, bz)) * smoothstep(rad + 120, rad + 160, channelDistance(bx, bz));
  if (clear <= 0) return -1e9;
  const e = hashF(cx, cz, S_BUTTE + 4);
  return unterrace(10 + 35 * e * e) * (1 - smoothstep(rad * 0.5, rad, d)) * clear;
}

/** the far mesas' base height (or nothing where there's none): lobed tables where a warped broad noise rises past a
 *  threshold, 110-400 m over the plain */
function mesas(x: number, z: number, far: number, minWave: number): number {
  const lx = x + 900 * noise(x, z, 3000, S_MESA + 7), lz = z + 900 * noise(x, z, 3000, S_MESA + 8);
  const d = (fbm(lx, lz, 4200, 3, S_MESA, minWave) - 0.1) * 5200;
  if (d <= 0) return -1e9;
  const top = 110 + 290 * clamp(0.5 + fbm(x, z, 16000, 2, S_MESA + 3, minWave), 0, 1);
  return unterrace(top) * smoothstep(0, 260, d) * far;
}

/** a hoodoo: where it stands, how wide, how tall over the plain */
export interface Hoodoo { x: number; z: number; r: number; height: number }

/** cell (cx, cz)'s hoodoo: where it stands, how wide and tall (or null: the cell has none); in patches on the plain
 *  150-550 m out from the mesa's foot (clear of the channel), its height easing to nothing at the patches' and the band's edges (continuous, so
 *  the CPU and the GPU never disagree about a whole pillar) */
function hoodooOf(cx: number, cz: number): Hoodoo | null {
  const C = HOODOO_CELL;
  if (hashF(cx, cz, S_HOODOO) > 0.38) return null;
  const x = (cx + 0.2 + 0.6 * hashF(cx, cz, S_HOODOO + 1)) * C, z = (cz + 0.2 + 0.6 * hashF(cx, cz, S_HOODOO + 2)) * C;
  const foot = sdStar(x, z) - 40;
  const k = smoothstep(0.1, 0.14, fbm(x, z, 340, 2, S_HOODOO + 5, 0.001)) * smoothstep(150, 180, foot) * (1 - smoothstep(520, 550, foot))
    * (1 - smoothstep(1250, 1350, Math.max(Math.abs(x - STAR.cx), Math.abs(z - STAR.cz)))) * smoothstep(50, 80, channelDistance(x, z));
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
    H = Math.max(H, unterrace(ho.height) * prof * lod);
  }
  return H;
}

/** transverse dunes (crests across a wind from the west-north-west), wandering, in broad ergs */
function dunes(x: number, z: number, minWave: number): number {
  const erg = smoothstep(-0.12, 0.12, fbm(x, z, 14000, 2, S_DUNE, minWave));
  if (erg <= 0) return 0;
  const u = (x * 0.92 + z * 0.38) / 170 + 2.2 * noise(x, z, 700, S_DUNE + 3) + 0.6 * noise(x, z, 230, S_DUNE + 4);
  const f = u - Math.floor(u);
  const crest = smoothstep(0, 0.72, f) * (1 - smoothstep(0.72, 1, f));
  return erg * 4 * crest * smoothstep(minWave, 2 * minWave, 170);
}

// ------------------------------------------------------------------ the whole
/** what the last sample was (for canyonInfo): the strata segment the ground landed on and how far along it, the
 *  designed zone (0 the plain and the mesa's walls, 1 the town's floor, 2 the stair's corridor, 3 a spoke gap's slope,
 *  4 a garden terrace, 5 the plateau's top, 6 a water's bed, 7 a ridge, 8 the rim, 9 a fissure in the plateau's
 *  slabs), the distance from the water's channel (m), the place on the mesa's wall (uMin), on the plateau or not */
export const HINT = { kind: -1, along: 0, zone: 0, river: 0, u: 9, prom: false };

/** how far the water's channel is (m), where it's farther than the hints hold (16 bits of centimetres) */
const NO_CHANNEL = 655;

function sample(x: number, z: number, texel: number): number {
  // (an octave shorter than ~6 samples would alias: it fades out between 3 and 6)
  const minWave = 3 * texel;
  warped = false;
  // the mesa's edge, wandering out from the star's outline (where it can matter: deep in the floor and past 400 m out
  // on the plain nothing's measured from it closer than its wander), out round the water gate's bastion
  const d0 = sdStar(x, z);
  const dE = smin(d0 > -RIM.w - 2 && d0 < 400 ? d0 - edgeOut(x, z, minWave) : d0, sdBastion(x, z), 12);
  const far = farness(x, z);
  const H0 = natural(x, z, dE, far, minWave, texel);
  let h = terrace(H0) + PLAIN_Y;
  HINT.kind = terraceKind; HINT.along = terraceAlong; HINT.u = uMin; HINT.prom = false;
  HINT.zone = dE > 0 ? 0 : -dE < RIM.w ? 8 : 1;
  // (the plain's channel, out from the east tip's foot)
  const ux = x - CHUTE.x, onChannel = ux > CHUTE.ends[2] && ux < 6600 && Math.abs(z - CHUTE.z) < 700;
  const dc = onChannel ? channelDistance(x, z) : NO_CHANNEL;
  HINT.river = Math.min(dc, NO_CHANNEL);
  if (dE > 0) {
    // sand drifted against the mesa's foot
    const drift = smoothstep(-0.35, 0, uMin) * (1 - smoothstep(0, 0.12, uMin));
    if (drift > 0) h += 2.6 * drift * (0.55 + 0.45 * noise(x, z, 45, S_SAND));
    // on the plain's flats (and far out the benches' middles: nowhere a seam) its low swells, and its dunes past
    // 150 m out from the mesa's foot
    const bench = terraceKind === 0 ? smoothstep(0, 0.15, terraceAlong) * (1 - smoothstep(0.85, 1, terraceAlong)) * far : 0;
    const flats = Math.max(bench, 1 - smoothstep(0, 10, H0)) * smoothstep(40, 100, dE);
    const calm = smoothstep(40, 90, dc - CHANNEL.plain.halfWidth);
    if (flats > 0) h += flats * (1.6 * fbm(x, z, 1100, 3, S_PLAT, minWave) + smoothstep(190, 340, dE) * calm * dunes(x, z, minWave));
  }
  // the plateau stands over the town's floor
  const ox = x - PLATEAU.cx, oz = z - PLATEAU.cz;
  if (ox * ox + oz * oz < (PLATEAU.r + 21) * (PLATEAU.r + 21)) warp(x, z, minWave);
  const hp = plateau(x, z, wn, texel);
  if (hp > h || platIn) { h = hp; HINT.zone = platZone; HINT.kind = platKind; HINT.prom = true; }
  // the stair's corridor down the south spoke
  if (Math.abs(x - PLATEAU.cx) < 120 && z - PLATEAU.cz > 60 && z - PLATEAU.cz < CLEFT_R + 30) {
    h = corridor(x, z, h);
    if (corridorZone) HINT.zone = 2;
  }
  // the town's floor, exactly flat from the plateau's foot to the rim
  const dx = x - PLATEAU.cx, dz = z - PLATEAU.cz, out = dx * dx + dz * dz > (PLATEAU.foot - 2) * (PLATEAU.foot - 2);
  if (-dE >= RIM.w && dx * dx + dz * dz > PLATEAU.foot * PLATEAU.foot) { h = FLOOR_Y; HINT.zone = 1; HINT.kind = 0; }
  if (dE < 0 && out) {
    // the ridges on the floor (their crests stepped by the strata; where one meets the rim the higher holds)
    const Hr = F_FLOOR + ridgesAt(x, z, minWave);
    if (Hr > H0 && Hr > F_FLOOR) { h = terrace(Hr) + PLAIN_Y; HINT.zone = 7; HINT.kind = terraceKind; HINT.along = terraceAlong; }
    // the pools' beds, the canal's and the sluice's
    const low = Math.min(poolsAt(x, z), canalAt(x, z));
    if (low < 0) { h = FLOOR_Y + low; HINT.zone = low < -0.05 ? 6 : HINT.zone; HINT.kind = 0; }
  }
  // the chute down the east tip's cliff, cut in its buttress
  const v = Math.abs(z - CHUTE.z);
  if (ux > CHUTE.ends[0] && ux < CHUTE.ends[3] && v < CHUTE.half) {
    h = mix(chuteBed(ux), h, smoothstep(CHUTE.half - 1, CHUTE.half, v));
    if (v < CHUTE.half - 0.5) { HINT.zone = 6; HINT.kind = 0; }
  }
  // the channel across the plain, soft-banked
  if (onChannel) {
    const c = channelBed(dc);
    if (c < h) { h = c; if (dc < CHANNEL.plain.halfWidth) { HINT.zone = 6; HINT.kind = -1; } }
  }
  return h;
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
  /** distance from the water's channel (m) */
  river: number;
  /** damp ground by the channel, 1 at the water's edge .. 0 some 70 m off */
  damp: number;
  /** loose scree at a cliff's foot, 0..1 */
  talus: number;
  /** the designed zone (see HINT) */
  zone: number;
  /** a garden terrace's floor (the garden builder's planters stand here) */
  garden: boolean;
}

/** the channel's half-width (the damp banks are measured from it) */
const CHANNEL_HW = CHANNEL.plain.halfWidth;

/** the ground at (x, z) as a level of texel `texel` (m) has it: its height and what covers it (sand on the flats and
 *  in hollows, rock on the steep, scree at the cliffs' feet, the channel's damp banks) */
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
  // (sand settles deep on the plain, less on the benches and the town's floor, least on the slickrock; in broad soft
  // patches and in every hollow; none on the gardens' soil or in the water, a little on the rock of the plateau, the
  // ridges and the rim)
  const settles = HINT.kind === -1 ? 0.62 : HINT.kind === 0 ? 0.2 : 0.08;
  let sand = clamp(flat * (settles + 0.55 * fbm(x, z, 140, 3, S_SAND + 1, 0.001)) + hollow * 0.5 - talus * 0.3, 0, 1);
  const z0 = HINT.zone;
  if (z0 === 4 || z0 === 6) sand = 0;
  else if (z0 === 5 || z0 === 7 || z0 === 8 || z0 === 9) sand = Math.min(sand, 0.15);
  const damp = 1 - smoothstep(CHANNEL_HW, CHANNEL_HW + 70, HINT.river);
  return { h, sand, rock: 1 - Math.max(sand, talus * 0.6), cliff, river: HINT.river, damp, talus, zone: z0, garden: z0 === 4 };
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

/** every number canyon.wgsl needs (f32-rounded where it matters), for tools/land-tables.ts to write tables.wgsl from */
export const TABLES = {
  scalars: {
    PLAIN_Y, FLOOR_Y, F_FLOOR, KEEP_A, KEEP_B, RIDGE_SKIRT, BANK, POOL_BED, SLAB_CELL, SLAB_STEP, FISSURE_DEEP,
    CANAL_X0: CANAL.x0, CANAL_Z: CANAL.z, CANAL_HALF: CANAL.half, CANAL_BED: CANAL.bed,
    CHUTE_X: CHUTE.x, CHUTE_Z: CHUTE.z, CHUTE_HALF: CHUTE.half, CHUTE_BASIN: CHUTE.basin, CHUTE_SILL: CHUTE.sill, CHUTE_POOL: CHUTE.poolBed,
    WALL_OVER: CHUTE.wall.over, WALL_OUT: CHUTE.wall.out, WALL_W: CHUTE.wall.w, CHANNEL_BED: CHANNEL.plain.bed, TOP: PLATEAU.topY, PLAT_R: PLATEAU.r, PLAT_FOOT: PLATEAU.foot, PLAT_IN, PLAT_G, MESA_G, LIP,
    STAR_TIP: STAR.rTip, STAR_TIPR: STAR.tipRound, STAR_NOTCHR: STAR.notchRound, STAR_WANDER: STAR.wander,
    RIM_W: RIM.w, RIM_C0: RIM.crest[0], RIM_C1: RIM.crest[1], CHANNEL_HW, NO_CHANNEL,
    GATE_X: GATE.x, GATE_Z: GATE.z, GATE_REACH: GATE.width / 2 + 2 * GATE.towerR, BASTION_R: BASTION.r,
    STAIR_W: STAIR.width, STAIR_SINK, LANDING_R, CLEFT_R, OUTCROP_CELL, HOODOO_CELL,
  },
  vectors: {
    BASTION: [BASTION.cx, BASTION.cz, BASTION.hx - BASTION.r, BASTION.hz - BASTION.r], CHUTE_ENDS: [...CHUTE.ends], CHUTE_LEVELS: [...CHUTE.levels],
    PLAT_C: [PLATEAU.cx, PLATEAU.cz], STAR_C: [STAR.cx, STAR.cz], STAR_ROT, STAR_M, STAR_N, STAR_EA, STAR_EC, GAP_A, GAP_B,
  },
  seeds: { S_WARP, S_PLAT, S_EDGE, S_FISSURE, S_CREST, S_FAR, S_BUTTE, S_MESA, S_HOODOO, S_SAND, S_DUNE, S_RIDGE, S_PROM, S_STAIR, S_GULLY, S_SLAB },
  tips: TIPS, bands: BANDS,
  ridges: RIDGE_SEGS, ridgeSectors: RIDGE_SECTORS,
  pools: POOL_T, poolSectors: POOL_SECTORS,
  channel: CHANNEL_CURVE,
  stairZ: STAIR_Z,
  landings: STAIR.landings.map(([x, z, y]) => [x, z, y]),
  wedges: WEDGES.map((w) => ({ d0: w.d0, d1: w.d1, r0: w.r0, r1: w.r1, steps: w.steps, drop: w.drop, w: w.w, short: w.short ? 1 : 0 })),
};
