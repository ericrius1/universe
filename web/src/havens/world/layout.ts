// Where everything is: the one shared plan of the world that the land, the town, the temple and its gardens, the
// water and the flora all build from, so they meet. Metres; x east, y up, z south (boulder's frame). The origin is the
// star's centre: the citadel, the temple standing on it. The sun sets in the west (-x) and the aurora hangs in the north
// (-z).
//
// The show's town from above: one great eight-point star of a mesa (STAR) on open yellow-orange desert (the plain at
// PLAIN_Y), its top the town's floor (FLOOR_Y). A raised plateau of cracked red-rock slabs (PLATEAU) stands at its
// centre with the golden citadel on it (TEMPLE, the gardens' wedges GARDENS) and gold spokes radiating from it; a ring
// road runs round its foot. The town spreads out into the star's points, a district in each (POINTS: the south civic,
// the east the palace's, the west the market's, the other five homes), parted by branching red-rock ridges (RIDGES)
// with turquoise pools (POOLS) between them. The grand stair runs down the south spoke to the stair square and the
// plaza; a water channel (CHANNEL) leaves the east point through the water gate (GATE) and cascades to the plain.
//
//                                   N (-z)
//                          nw ╲      n       ╱ ne
//                               ╲   ┆   ╱          a ridge's trunk out of every notch,
//                     west ─── market ┆ citadel ┆ palace ─── east  ══ canal ══ gate ⟶ the plain
//                               ╱   ┆   ╲          its branches into the points beside it
//                          sw ╱  stair, plaza ╲ se
//                                  hall
//                                 south (+z)
//
// Every district's builders lay their triangles under their own claims (CLAIMS: world/claims.ts says how), meet their
// neighbours at the ports (PORTS) and keep to their budgets (BUDGETS). tools/layout-map.ts draws all of it and checks
// the clearances; tools/geo-check.ts holds the built world to the claims.

import type { Budget, Claim, Port } from './claims';

export type V2 = [number, number];

const DEG = Math.PI / 180;

// ------------------------------------------------------------------------------------------------- heights and star

/** the plain round the mesa: the strata table's base (land/strata.ts), so every key height below sits on a bench top */
export const PLAIN_Y = -73.5;

/** the town's floor: the mesa's top, a bench top 73.5 m above the plain; flat wherever the town stands */
export const FLOOR_Y = 0;

/** the star mesa: its centre, its eight points' tips (radius rTip) and the notches between them (rIn), turned by rot
 *  (degrees: 0 puts a tip due east, the tips every 45°). tipRound and notchRound are how wide the smooth max and min
 *  that round the tips and the notches are (m, sdStar); wander is the land's own wobble of the cliff's edge (± m, over
 *  about 140 m: not in sdStar, which stays exact) */
export const STAR = { cx: 0, cz: 0, points: 8, rTip: 800, rIn: 540, rot: 0, tipRound: 40, notchRound: 60, wander: 12 };

/** the rim: the crest band inside the cliff's edge (w m wide, its crest 8-13 m over the floor) and the town's building
 *  line, `building` m inside the edge (sdStar < -building) */
export const RIM = { w: 32, crest: [8, 13] as const, building: 36 };

/** the plateau at the star's centre: its top's edge (r, wobbling by `wander`), its foot (the stepped cliff from the top
 *  at topY down to FLOOR_Y between r and foot), and the ring road round the foot (its centre line r, its width) */
export const PLATEAU = { cx: 0, cz: 0, r: 300, wander: 16, foot: 318, topY: 31.1, ring: { r: 327, width: 18 } };

/** the citadel's mesa (the name kept from when it was a promontory): the plateau's top */
export const MESA = { cx: PLATEAU.cx, cz: PLATEAU.cz, topY: PLATEAU.topY, r: PLATEAU.r };

// ------------------------------------------------------------------------------------------------- the citadel

/** the temple on the plateau's centre (its centre; the colonnaded base's radius; the petals; the needle: its top at
 *  y + baseH + petalH + needleH ≈ 243 m) */
export const TEMPLE = { x: PLATEAU.cx, z: PLATEAU.cz, y: PLATEAU.topY, baseR: 64, baseH: 26, petals: 6, petalH: 58, needleH: 128 };

/** the eight spokes out of the citadel, along the star's tips (degrees, 0 east, 90 south): the causeways down to the
 *  ring road, the avenues on to the tips. The south one (90) is the grand stair */
export const SPOKES = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => a + STAR.rot);

/** The terraced gardens: wedges radiating from the temple's base, between the spokes, like the sepals of the lotus.
 *  Each wedge spans [a0, a1] (radians, 0 = +x/east, π/2 = +z/south) between radii r0 and r1 from the temple's centre,
 *  and steps down in `steps` terraces from the top (MESA.topY) by `drop` metres each. A 'flank' wedge steps all the way
 *  down to the ring road (floors 31.1 … 5.1); a 'top' wedge is sunken courts on the plateau's top (31.1, 27.1, 23.1),
 *  the plateau's slabs beyond it. Between the wedges run the causeways (the spokes); the south gap is the grand
 *  stair's. */
export interface GardenWedge { kind: 'flank' | 'top'; a0: number; a1: number; r0: number; r1: number; steps: number; drop: number }
const top = (a0: number, a1: number): GardenWedge => ({ kind: 'top', a0: (a0 + STAR.rot) * DEG, a1: (a1 + STAR.rot) * DEG, r0: 92, r1: 170, steps: 3, drop: 4.0 });
const flank = (a0: number, a1: number): GardenWedge => ({ kind: 'flank', a0: (a0 + STAR.rot) * DEG, a1: (a1 + STAR.rot) * DEG, r0: 92, r1: PLATEAU.r, steps: 6, drop: 5.2 });
export const GARDENS: { wedges: GardenWedge[]; rampWidth: number; wallCap: number } = {
  rampWidth: 6,
  wallCap: 0.55,
  wedges: [top(4, 41), flank(49, 83), top(97, 131), flank(139, 176), top(184, 221), flank(229, 266), top(274, 311), flank(319, 356)],
};
/** a causeway's half-width over its parapets (haven/plan.ts CAUSEWAY_H): the wedges reach sideways to it */
export const CAUSEWAY_HALF = GARDENS.rampWidth / 2 + 0.55;

/** the grand stair straight down the south spoke from the temple's ring to the ring road: its width, and its landings
 *  bottom first (each [x, z, y]; flights run straight between consecutive ones). Landing k (1-6) stands level with the
 *  south-south-east flank wedge's band 6-k, 0.6 of the way across it; L0 is on the ring road */
const SSE = GARDENS.wedges[1];
const landingZ = (k: number) => SSE.r0 + ((SSE.r1 - SSE.r0) / SSE.steps) * (SSE.steps + 0.6 - k);
const S_AXIS = (90 + STAR.rot) * DEG;
const onSouth = (r: number, y: number): [number, number, number] => [Math.round(Math.cos(S_AXIS) * r * 10) / 10, Math.round(Math.sin(S_AXIS) * r * 10) / 10, y];
export const STAIR = {
  width: 14,
  landings: [
    onSouth(PLATEAU.ring.r - 1, FLOOR_Y),
    ...[1, 2, 3, 4, 5, 6].map((k) => onSouth(landingZ(k), Math.round((PLATEAU.topY - SSE.drop * (6 - k)) * 10) / 10)),
  ] as [number, number, number][],
};

/** the crystal caverns under the citadel: a disc of halls (r round its centre, between floorY and ceilY: at least 8 m of
 *  rock over the ceiling everywhere) reached from the portal in the plateau's south-south-west flank (its angle in
 *  degrees, its radius, its floor) */
export const CAVERNS = { x: PLATEAU.cx, z: PLATEAU.cz, floorY: -24, ceilY: 14, r: 110, portal: { angle: 112.5 + STAR.rot, r: 304, y: FLOOR_Y } };

/** the girls' room: in the dwelling on the west wall of the stair's notch at landing 2 (built in that frontage's own
 *  frame: u along the face, v into the rock, y from its floor) */
export const ROOM_DWELLING = { landing: 2, side: 'west' as const };

/** the stair's notch, cut into the plateau down the south spoke: its walls' x either side, from the top landing's far
 *  edge to the plateau's foot */
export const NOTCH = { half: 11, z0: STAIR.landings[STAIR.landings.length - 1][1] - 10, z1: PLATEAU.foot };

// ------------------------------------------------------------------------------------------------- the town's places

/** the plaza at the south point's heart (its centre, its ring's radius; paved out to `paved`) and the square at the
 *  stair's foot north of it (spanning the ring road: the ring road's paving runs through it, the square's own ground
 *  starts at the road's outer edge) */
export const PLAZA = { x: 0, z: 462, r: 72, paved: 92 };
export const STAIR_SQUARE = { x0: -38, x1: 38, z0: PLATEAU.foot, z1: 372 };

/** a landmark's close: a rectangle in its own frame (+z its front, as ArchBuilder.at(x, y, z, yaw) turns it) */
export interface Close { x0: number; x1: number; z0: number; z1: number }

/** the grand hall (ref 1) on the plaza's south side, facing north onto it; its close round it (its own frame) */
export const GRAND_HALL = { x: 0, z: 580, yaw: Math.PI, width: 64, depth: 46, height: 38, close: { x0: -58, x1: 58, z0: -66, z1: 54 } as Close };

/** the palace with its X-braced lattice spire (ref 2) in the east point, facing west down its avenue to the citadel;
 *  its precinct (its own frame: the court before it, the gardens behind) */
export const PALACE = { x: 470, z: 0, yaw: -Math.PI / 2, width: 90, depth: 70, height: 30, spireH: 95, close: { x0: -90, x1: 74, z0: -64, z1: 80 } as Close };

/** the market (ref 2): its square an ellipse in the west point, stalls and awnings filling it */
export const MARKET = { x: -500, z: 0, rx: 110, rz: 100 };
/** the market's claim: a 16-gon round its ellipse (so its reach along the west point's axis is rx·MARKET_K) */
const MARKET_K = 1 / Math.cos(Math.PI / 16);

/** the water gate at the east tip: the channel out between two domed towers (its centre, the opening's width) */
export const GATE = { x: 760, z: 0, width: 14, towerR: 7.5, towerH: 34 };

/** the water out of the east point: the canal from the palace's back, the tank, the sluice through the water gate, the
 *  cascades down the cliff's two benches to the plain, and the channel across the plain (polylines x, z; levels and beds
 *  world y) */
export const CHANNEL = {
  canal: [[534, 0], [600, 0]] as V2[],
  tank: { x: 645, z: 0, rx: 45, rz: 18 },
  sluice: [[690, 0], [762, 0]] as V2[],
  width: 8, level: -0.45, bed: -1.6,
  cascade: [-0.45, -23.0, -48.9, -74.3],
  plain: {
    path: [[830, 0], [1150, 25], [1600, -15], [2300, 40], [3200, 0], [4400, 60], [6000, 20]] as V2[],
    halfWidth: 7, level: PLAIN_Y - 0.8, bed: PLAIN_Y - 2,
  },
};

/** the ways round and out of the citadel: the ring road (between its inner and outer edges), the spoke avenues (their
 *  width) out from a square at each spoke's foot (its half-size, its centre's radius) to a square at each tip (its
 *  half-size, its centre's distance out), and the lookout tower behind it on the rim (its distance out, its radius) */
export const WAYS = {
  ring: { r0: PLATEAU.ring.r - PLATEAU.ring.width / 2, r1: PLATEAU.ring.r + PLATEAU.ring.width / 2 },
  avenue: 16,
  foot: { half: 18, r: PLATEAU.ring.r + PLATEAU.ring.width / 2 + 18 },
  tip: { half: 22, r: 690 },
  lookout: { r: 728, radius: 10 },
};
/** the ring road's outline vertices (degrees): the town's radials meet it there (each spoke, ±9° and ±16° beside it,
 *  each notch), so a block's inner edge is one chord of it */
export const RING_ANGLES: number[] = SPOKES.flatMap((s) => [0, 9, 16, 22.5, 29, 36].map((d) => s + d));

/** where you begin: on the plaza north of the fountain, facing north (yaw 0 looks toward -z) up the stair to the citadel */
export const SPAWN = { x: PLAZA.x, z: PLAZA.z + 38, yaw: 0, as: 'katara' as const };

// ------------------------------------------------------------------------------------------------- the districts

export type PointName = 'east' | 'se' | 'south' | 'sw' | 'west' | 'nw' | 'n' | 'ne';
export interface StarPoint {
  /** its district's name (the compass's way it points) */
  name: PointName;
  /** its tip's angle (degrees) */
  tip: number;
  role: 'civic' | 'palace' | 'market' | 'homes';
}
const COMPASS: PointName[] = ['east', 'se', 'south', 'sw', 'west', 'nw', 'n', 'ne'];
/** the star's points, from the east tip clockwise on the map (south is +z) */
export const POINTS: StarPoint[] = SPOKES.map((tip) => {
  const name = COMPASS[Math.round((((tip % 360) + 360) % 360) / 45) % 8];
  return { name, tip, role: name === 'south' ? 'civic' : name === 'east' ? 'palace' : name === 'west' ? 'market' : 'homes' };
});
/** the districts: the citadel (the plateau, the Haven, the caverns, the room), each point's, the town-wide ways (the
 *  ring road, the spoke avenues), the water (the pools, the canal and its cascades, the plain's channel) and the land
 *  (the ridges: terrain, held clear of everything built) */
export const DISTRICTS = ['citadel', ...POINTS.map((p) => p.name), 'ways', 'water', 'land'] as const;

// ------------------------------------------------------------------------------------------------- helpers

/** a point at radius r and angle a (degrees, 0 east, 90 south) round the star's centre */
export function polar(r: number, a: number): V2 {
  return [STAR.cx + r * Math.cos(a * DEG), STAR.cz + r * Math.sin(a * DEG)];
}

/** a point given in a star point's own frame (u out along its axis from the centre, v across it toward larger angles) */
export function inPoint(p: StarPoint, u: number, v: number): V2 {
  const c = Math.cos(p.tip * DEG), s = Math.sin(p.tip * DEG);
  return [STAR.cx + c * u - s * v, STAR.cz + s * u + c * v];
}
/** a world point in a star point's frame (u, v) */
export function pointFrame(p: StarPoint, x: number, z: number): V2 {
  const c = Math.cos(p.tip * DEG), s = Math.sin(p.tip * DEG), dx = x - STAR.cx, dz = z - STAR.cz;
  return [c * dx + s * dz, -s * dx + c * dz];
}

/** a smooth minimum (land/noise.ts smin, canyon.wgsl cnSmin) and maximum */
function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

// the star's half point, folded into: the tip T on +x, the notch N at π/8; the edge T -> N's outward unit normal (EA),
// the same edge mirrored across the x axis (EB: the tip's other side) and across the notch's line (EC: the next point's
// edge), each as a point on it and its normal
if (STAR.points !== 8) throw new Error('layout: sdStar folds an eight-point star');
const HALF_A = Math.PI / STAR.points;
const MC = Math.cos(HALF_A), MS = Math.sin(HALF_A);
const ROT_C = Math.cos(-STAR.rot * DEG), ROT_S = Math.sin(-STAR.rot * DEG);
const TX = STAR.rTip, NX = STAR.rIn * MC, NZ = STAR.rIn * MS;
const EA = (() => { const dx = NX - TX, dz = NZ, L = Math.hypot(dx, dz); return [dz / L, -dx / L] as V2; })();
/** EA mirrored across the notch's line (the next point's edge, through N) */
const EC: V2 = (() => { const d = -EA[0] * MS + EA[1] * MC; return [EA[0] + 2 * d * MS, EA[1] - 2 * d * MC]; })();

/** The signed distance (m) from the star's edge (negative inside), on the plan. Folded by reflections — |x|, |z|, the
 *  45° mirror, the notch's line — into the half point between a tip and a notch, never by atan2, so canyon.wgsl can
 *  make the same numbers: there the distance to the point's edge, its tip rounded by a smooth max with the edge's
 *  mirror across the tip's axis (STAR.tipRound wide) and its notch by a smooth min with the next point's edge
 *  (STAR.notchRound). The distance is exact along the edges and good to a few metres round the tips and notches. */
export function sdStar(x: number, z: number): number {
  let px = x - STAR.cx, pz = z - STAR.cz;
  const rx = ROT_C * px - ROT_S * pz;
  pz = ROT_S * px + ROT_C * pz;
  px = Math.abs(rx); pz = Math.abs(pz);
  if (pz > px) { const t = px; px = pz; pz = t; }
  const d = -px * MS + pz * MC;
  if (d > 0) { px += 2 * d * MS; pz -= 2 * d * MC; }
  const dA = (px - TX) * EA[0] + pz * EA[1];
  const dB = (px - TX) * EA[0] - pz * EA[1];
  const dC = (px - NX) * EC[0] + (pz - NZ) * EC[1];
  return smin(smax(dA, dB, STAR.tipRound), dC, STAR.notchRound);
}

/** how far out from the star's centre along angle a (degrees) its edge is, or the line `inset` m inside it
 *  (sdStar = -inset; RIM.building: the town's building line) */
export function starReach(a: number, inset = 0): number {
  const c = Math.cos(a * DEG), s = Math.sin(a * DEG);
  let lo = 0, hi = STAR.rTip + 100;
  for (let i = 0; i < 48; i++) {
    const m = (lo + hi) / 2;
    if (sdStar(STAR.cx + c * m, STAR.cz + s * m) < -inset) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

/** the star's outline, or the line `inset` m inside it, as a polygon (a vertex every `step` degrees, the tips' and the
 *  notches' among them) */
export function starPoly(inset = 0, step = 1.5): V2[] {
  const n = Math.round(360 / step), out: V2[] = [];
  for (let i = 0; i < n; i++) { const a = STAR.rot + (i * 360) / n; out.push(polar(starReach(a, inset), a)); }
  return out;
}

/** a landmark's close in the world (its corners, ArchBuilder's turn: local +z faces (sin yaw, cos yaw)) */
export function closePoly(anchor: { x: number; z: number; yaw: number; close: Close }): V2[] {
  const { x0, x1, z0, z1 } = anchor.close, c = Math.cos(anchor.yaw), s = Math.sin(anchor.yaw);
  return ([[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as V2[]).map(([u, v]) => [anchor.x + c * u + s * v, anchor.z - s * u + c * v]);
}

/** a deterministic random stream (mulberry32, as haven/plan.ts's) */
function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const range = (r: () => number, a: number, b: number) => a + (b - a) * r();

// ------------------------------------------------------------------------------------------------- the ridges

/** A red-rock ridge on the town's floor (the land raises it: B1b). Its centre line runs from its root (pts[0]) to its
 *  end; its half-width and its crest (m over the floor) go linearly from root to end along it. A trunk runs out of each
 *  notch from the plateau's foot to the rim, parting two districts; a branch forks off a trunk into the point beside
 *  it; a twig is a short spur off a branch toward the rim. */
export interface Ridge {
  kind: 'trunk' | 'branch' | 'twig';
  pts: V2[];
  hw: [number, number];
  crest: [number, number];
  /** the ridge it grows from (-1 for a trunk) */
  parent: number;
  /** the district it stands in ('land' for a trunk, which parts two) */
  district: string;
}
/** the keep-out round a ridge: nothing built within 1.3 × its half-width + 4 m of its centre line */
export const ridgeKeep = (hw: number) => 1.3 * hw + 4;

/** where a branch of the south, east and west points runs (in the point's frame, from its fork on the trunk at r = fork:
 *  its bend and its end, v on the side toward larger angles; mirrored for the other side), so the plaza and the hall,
 *  the palace and the market fit between them; the homes' branches converge on the spoke avenue behind a flank strip of
 *  pools by the rim */
const BRANCH_PLAN: Record<StarPoint['role'], { fork: number; pts: V2[] }> = {
  civic: { fork: 470, pts: [[500, 138], [562, 100]] },
  palace: { fork: 470, pts: [[520, 128], [588, 92]] },
  market: { fork: 470, pts: [[500, 146], [546, 120]] },
  homes: { fork: 420, pts: [[500, 100], [600, 40]] },
};

function makeRidges(): Ridge[] {
  const rng = rngOf(0x51a7);
  const out: Ridge[] = [];
  const trunkOf: number[] = [];
  // the trunks, out of each notch: jittered at the root, the notch itself at the end
  for (let k = 0; k < 8; k++) {
    const a = STAR.rot + 22.5 + 45 * k, j = range(rng, -3, 3);
    trunkOf.push(out.length);
    out.push({
      kind: 'trunk', parent: -1, district: 'land', hw: [20, 14], crest: [14, 9],
      pts: [polar(PLATEAU.foot, a + j), polar(430, a + j * 0.4 + range(rng, -1, 1)), polar(STAR.rIn + 6, a)],
    });
  }
  // the branches off the trunks either side of each point, and a twig off each
  for (const p of POINTS) {
    const plan = BRANCH_PLAN[p.role];
    for (const side of [-1, 1]) {
      // (trunk k runs out of the notch at 22.5 + 45k: the one on this side of the point)
      const k = (((Math.round((p.tip - STAR.rot) / 45) + (side > 0 ? 0 : -1)) % 8) + 8) % 8;
      const trunk = out[trunkOf[k]];
      const fork = alongTrunk(trunk.pts, plan.fork);
      const jig = () => range(rng, -4, 4);
      const pts: V2[] = [fork, ...plan.pts.map(([u, v]) => inPoint(p, u + jig(), side * (v + jig())))];
      const bi = out.length;
      out.push({ kind: 'branch', parent: trunkOf[k], district: p.name, hw: [12, 7], crest: [9, 4], pts });
      // the twig: off the branch 0.62 of the way along, turned 55° toward the rim, 50 m (the landmarks' points' a
      // shorter spur off the end, out into the rim)
      const homes = p.role === 'homes';
      const t = homes ? 0.62 : 0.94, at = pointAlong(pts, t), dir = dirAlong(pts, t);
      const turn = side * 55 * DEG * (homes ? 1 : 1.15), c = Math.cos(turn), s = Math.sin(turn);
      const [fu, fv] = [dir[0] * c - dir[1] * s, dir[0] * s + dir[1] * c];
      // (toward the rim: away from the point's axis)
      const [au, av] = pointFrame(p, at[0], at[1]);
      const [du, dv] = pointFrame(p, at[0] + fu, at[1] + fv);
      const outward = Math.sign(av) * (dv - av) > 0 ? 1 : -1;
      const L = homes ? 50 : 34;
      const end = inPoint(p, au + (du - au) * L * outward, av + (dv - av) * L * outward);
      out.push({ kind: 'twig', parent: bi, district: p.name, hw: [7, 4], crest: [5, 2], pts: [at, end] });
    }
  }
  return out;
}
function alongTrunk(pts: V2[], r: number): V2 {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], ra = Math.hypot(a[0] - STAR.cx, a[1] - STAR.cz), rb = Math.hypot(b[0] - STAR.cx, b[1] - STAR.cz);
    if ((r - ra) * (r - rb) <= 0) { const t = (r - ra) / (rb - ra); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  }
  return pts[pts.length - 1];
}
/** a polyline's length, a point a fraction t along it by length, its direction there */
export function polyLength(pts: V2[]) { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; }
function segAt(pts: V2[], t: number): [number, number] {
  const L = polyLength(pts) * t;
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (s + l >= L || i === pts.length - 1) return [i - 1, Math.min(1, (L - s) / l)];
    s += l;
  }
  return [0, 0];
}
export function pointAlong(pts: V2[], t: number): V2 {
  const [i, u] = segAt(pts, t), a = pts[i], b = pts[i + 1];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}
function dirAlong(pts: V2[], t: number): V2 {
  const [i] = segAt(pts, t), a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
}

/** the ridges, generated from a fixed seed: 8 trunks (one per notch), 16 branches, 16 twigs */
export const RIDGES: Ridge[] = makeRidges();

/** where the ridges are cut down to the floor for a way through: every trunk where the ring road crosses it (22 m, the
 *  ring road's 18 and a margin) and every branch half way along it for a street (12 m). `along`: metres from the
 *  ridge's root to the cut's middle; `at`: the cut's middle */
export interface RidgeCut { ridge: number; along: number; at: V2; width: number }
export const RIDGE_CUTS: RidgeCut[] = RIDGES.flatMap((r, i): RidgeCut[] => {
  if (r.kind === 'trunk') {
    const at = alongTrunk(r.pts, PLATEAU.ring.r);
    return [{ ridge: i, along: Math.hypot(at[0] - r.pts[0][0], at[1] - r.pts[0][1]), at, width: 22 }];
  }
  if (r.kind === 'branch') {
    const t = 0.36;
    return [{ ridge: i, along: polyLength(r.pts) * t, at: pointAlong(r.pts, t), width: 12 }];
  }
  return [];
});

/** the half-width of ridge i at a fraction t (by length) of the way from its root */
export const ridgeHalfWidth = (i: number, t: number) => RIDGES[i].hw[0] + (RIDGES[i].hw[1] - RIDGES[i].hw[0]) * t;

/** the keep-out round ridge i (its whole length, cuts and all): an outline (convex per segment, unioned) */
export function ridgeKeepOut(i: number, margin = 0): V2[] {
  const r = RIDGES[i], L = polyLength(r.pts);
  // (the offset outline: left side out, a cap round the end, right side back, a cap round the root)
  const left: V2[] = [], right: V2[] = [];
  let s = 0;
  for (let k = 0; k < r.pts.length; k++) {
    if (k > 0) s += Math.hypot(r.pts[k][0] - r.pts[k - 1][0], r.pts[k][1] - r.pts[k - 1][1]);
    const a = r.pts[Math.max(0, k - 1)], b = r.pts[Math.min(r.pts.length - 1, k + 1)], dl = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / dl, nz = (b[0] - a[0]) / dl, w = ridgeKeep(ridgeHalfWidth(i, s / L)) + margin;
    left.push([r.pts[k][0] + nx * w, r.pts[k][1] + nz * w]);
    right.push([r.pts[k][0] - nx * w, r.pts[k][1] - nz * w]);
  }
  const cap = (c: V2, from: V2, w: number): V2[] => {
    const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]);
    return [1, 2, 3, 4, 5].map((j) => [c[0] + Math.cos(a0 - (j * Math.PI) / 6) * w, c[1] + Math.sin(a0 - (j * Math.PI) / 6) * w] as V2);
  };
  const end = r.pts[r.pts.length - 1], root = r.pts[0];
  return [...left, ...cap(end, left[left.length - 1], ridgeKeep(r.hw[1]) + margin), ...right.reverse(), ...cap(root, right[right.length - 1] ?? right[0], ridgeKeep(r.hw[0]) + margin)];
}

/** how far a point is from ridge i's keep-out (negative inside it) */
export function ridgeDistance(i: number, x: number, z: number): number {
  const r = RIDGES[i], L = polyLength(r.pts);
  let best = Infinity, s = 0;
  for (let k = 0; k < r.pts.length - 1; k++) {
    const a = r.pts[k], b = r.pts[k + 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz, l = Math.sqrt(l2);
    const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
    const d = Math.hypot(a[0] + dx * u - x, a[1] + dz * u - z) - ridgeKeep(ridgeHalfWidth(i, (s + u * l) / L));
    best = Math.min(best, d);
    s += l;
  }
  return best;
}

// ------------------------------------------------------------------------------------------------- plan geometry

/** a polygon's signed area (positive: clockwise on a north-up map, as city/geom.ts winds them) */
export function polyArea(p: V2[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return a / 2;
}
export function polyBox(p: V2[]): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return [x0, z0, x1, z1];
}
const boxesMeet = (a: number[], b: number[], m = 0) => a[0] < b[2] + m && b[0] < a[2] + m && a[1] < b[3] + m && b[1] < a[3] + m;
/** a convex polygon (positive area) cut to the side of the line a -> b that the polygon's own interior lies on (keep
 *  `inside`: the side to the right of a -> b for a positive-area outline, the side its interior is on) or the other */
function clipLine(p: V2[], a: V2, b: V2, keepInside: boolean): V2[] {
  const out: V2[] = [];
  const side = (q: V2) => { const s = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]); return keepInside ? s : -s; };
  for (let i = 0; i < p.length; i++) {
    const c = p[i], d = p[(i + 1) % p.length], sc = side(c), sd = side(d);
    if (sc >= 0) out.push(c);
    if ((sc >= 0) !== (sd >= 0)) { const t = sc / (sc - sd); out.push([c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t]); }
  }
  return out;
}
const wound = (p: V2[]) => (polyArea(p) >= 0 ? p : [...p].reverse());
/** the part of convex polygon p inside convex polygon q */
export function intersectConvex(p: V2[], q: V2[]): V2[] {
  let out = wound(p);
  const Q = wound(q);
  for (let i = 0; i < Q.length && out.length >= 3; i++) out = clipLine(out, Q[i], Q[(i + 1) % Q.length], true);
  return out.length >= 3 ? out : [];
}
/** convex polygon p less convex polygon q: convex pieces */
export function subtractConvex(p: V2[], q: V2[]): V2[][] {
  if (!boxesMeet(polyBox(p), polyBox(q))) return [p];
  if (Math.abs(polyArea(intersectConvex(p, q))) < 1e-6) return [p];
  const out: V2[][] = [];
  let rest = wound(p);
  const Q = wound(q);
  for (let i = 0; i < Q.length && rest.length >= 3; i++) {
    const a = Q[i], b = Q[(i + 1) % Q.length];
    const outside = clipLine(rest, a, b, false);
    if (outside.length >= 3 && Math.abs(polyArea(outside)) > 1e-6) out.push(outside);
    rest = clipLine(rest, a, b, true);
  }
  return out;
}
/** the convex hull of points (positive area) */
export function convexHull(pts: V2[]): V2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: V2[] = [], hi: V2[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return wound([...lo.slice(0, -1), ...hi.slice(0, -1)]);
}
const disc = (c: V2, r: number, n = 16, rot = 0): V2[] => Array.from({ length: n }, (_, i) => [c[0] + Math.cos(rot + (i / n) * Math.PI * 2) * r, c[1] + Math.sin(rot + (i / n) * Math.PI * 2) * r] as V2);
/** a regular n-gon round a circle (the circle inside it): a claim's few-sided outline that still holds all of it */
const around = (c: V2, r: number, n = 8, rot = 0): V2[] => disc(c, r / Math.cos(Math.PI / n), n, rot);
/** a rectangle along a -> b, `half` m either side */
function strip(a: V2, b: V2, half: number): V2[] {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), nx = (-dz / L) * half, nz = (dx / L) * half;
  return wound([[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]]);
}
/** a rectangle in a star point's frame (u0..u1 out, v0..v1 across) */
const pointRect = (p: StarPoint, u0: number, u1: number, v0: number, v1: number): V2[] => wound([inPoint(p, u0, v0), inPoint(p, u1, v0), inPoint(p, u1, v1), inPoint(p, u0, v1)]);

/** a ray in plan: from o along unit d (the side of a wedge, a causeway, the notch's wall) */
interface Ray { o: V2; d: V2 }
/** the ray out along spoke angle a (degrees) from the centre, moved sideways by `off` m (+: toward larger angles) */
function sideRay(a: number, off: number): Ray {
  const c = Math.cos(a * DEG), s = Math.sin(a * DEG);
  return { o: [STAR.cx - s * off, STAR.cz + c * off], d: [c, s] };
}
/** the notch's walls (x = ±NOTCH.half, running south: the stair's spoke is +z with STAR.rot 0) */
const notchWall = (x: number): Ray => ({ o: [x, STAR.cz], d: [0, 1] });

/** a polygonal ring round the star's centre at radius r, its vertices at `grid`'s angles (degrees): the claims bounded
 *  by the same ring share its edge exactly. Its vertices strictly between angles a0 < a1 (unwrapped) */
function ringBetween(r: number, a0: number, a1: number, grid: number[]): V2[] {
  const out: number[] = [];
  for (const g of grid) for (let k = Math.floor(a0 / 360) - 1; k <= Math.ceil(a1 / 360) + 1; k++) {
    const a = g + 360 * k;
    if (a > a0 + 1e-7 && a < a1 - 1e-7) out.push(a);
  }
  return [...new Set(out)].sort((p, q) => p - q).map((a) => polar(r, a));
}
/** where a ray from inside first meets the ring of radius r with vertices at `grid` */
function meetRing(ray: Ray, r: number, grid: number[]): V2 {
  const g = [...new Set(grid.map((a) => ((a % 360) + 360) % 360))].sort((p, q) => p - q);
  let best: V2 | null = null, bt = Infinity;
  for (let i = 0; i < g.length; i++) {
    const p = polar(r, g[i]), q = polar(r, i + 1 < g.length ? g[i + 1] : g[0] + 360);
    const ex = q[0] - p[0], ez = q[1] - p[1], den = ray.d[0] * ez - ray.d[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((p[0] - ray.o[0]) * ez - (p[1] - ray.o[1]) * ex) / den;
    const u = Math.abs(ex) > Math.abs(ez) ? (ray.o[0] + ray.d[0] * t - p[0]) / ex : (ray.o[1] + ray.d[1] * t - p[1]) / ez;
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9 && t < bt) { bt = t; best = [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t]; }
  }
  if (!best) throw new Error('layout: a ray missed a ring');
  return best;
}
const angleOf = (p: V2) => Math.atan2(p[1] - STAR.cz, p[0] - STAR.cx) / DEG;
/** the band between rings r0 and r1 (their vertices at gridIn's and gridOut's angles) and between two rays, lo on the
 *  side of smaller angles: its outline, every corner exactly on the rings' edges */
function sector(r0: number, r1: number, lo: Ray, hi: Ray, gridIn: number[], gridOut: number[]): V2[] {
  const iLo = meetRing(lo, r0, gridIn), iHi = meetRing(hi, r0, gridIn), oLo = meetRing(lo, r1, gridOut), oHi = meetRing(hi, r1, gridOut);
  const span = (a: V2, b: V2): [number, number] => { const x = angleOf(a); let y = angleOf(b); while (y < x) y += 360; return [x, y]; };
  const [ai0, ai1] = span(iLo, iHi), [ao0, ao1] = span(oLo, oHi);
  return [iLo, ...ringBetween(r0, ai0, ai1, gridIn), iHi, oHi, ...ringBetween(r1, ao0, ao1, gridOut).reverse(), oLo];
}
/** the fine ring the citadel's claims share inside the ring road (a vertex every 2.5°) */
const FINE = Array.from({ length: 144 }, (_, i) => STAR.rot + i * 2.5);
/** z on a polyline running east-west (by x) */
function chordZ(e: V2[], x: number): number {
  for (let i = 0; i < e.length - 1; i++) {
    const p = e[i], q = e[i + 1];
    if ((x - p[0]) * (x - q[0]) <= 0 && p[0] !== q[0]) return p[1] + ((x - p[0]) / (q[0] - p[0])) * (q[1] - p[1]);
  }
  throw new Error('layout: off the chord');
}
/** the ring road's inner (r0) or outer (r1) edge south of the citadel (its chords between 60° and 120°, east to west) */
const southEdge = (r: number) => [polar(r, 60), ...ringBetween(r, 60, 120, RING_ANGLES), polar(r, 120)];

// ------------------------------------------------------------------------------------------------- the pools

/** a town pool: an ellipse (centre, radii, turn in radians) — its bed the land's (B1b: 2.4 m down, a 1.5 m bank inside
 *  the outline so the coping stands on flat ground), its coping, steps, lamps and water the water's (B3e). The tank on
 *  the canal is one too, kind 'tank' */
export interface Pool { x: number; z: number; rx: number; rz: number; rot: number; kind: 'pool' | 'tank'; district: string }
/** a pool's outline, `outset` m outside it (24 points) */
export function poolPoly(i: number, outset = 0, pools: Pool[] = POOLS): V2[] {
  const q = pools[i], c = Math.cos(q.rot), s = Math.sin(q.rot), n = 24;
  return Array.from({ length: n }, (_, k) => {
    const t = (k / n) * Math.PI * 2, u = Math.cos(t) * (q.rx + outset), v = Math.sin(t) * (q.rz + outset);
    return [q.x + c * u - s * v, q.z + s * u + c * v] as V2;
  });
}

// ------------------------------------------------------------------------------------------------- the claims

const Y_TOWN: [number, number] = [-3, 45];
const Y_WAY: [number, number] = [-3, 16];
const claim = (id: string, district: string, owner: string, kind: Claim['kind'], poly: V2[], y: [number, number]): Claim => ({ id, district, owner, kind, poly, y });

/** the citadel's rings: the temple's (its claim's edge), where the inner parts of everything round it end (inside it
 *  all stands over the rock kept above the caverns), the slab sectors' rock skin, the ring road's inner edge */
const R_TEMPLE = 92, R_INNER = 118, R_SKIN = PLATEAU.r - 4, R_FOOT = WAYS.ring.r0;
/** the dwellings in the notch's west wall: how deep into the rock, from where (north of L4, clear of the sunken court's
 *  end wall beside the notch) to the foot */
const NOTCH_DWELL = { depth: 24, z0: STAIR.landings[4][1] - 11 };
/** half the caverns' tunnel's and portal's width */
const PORTAL_HALF = 8;
/** the girls' room's box in the notch's west wall at L2 (plan x, z; floor to roof) */
function roomBox() {
  const L = STAIR.landings[ROOM_DWELLING.landing], floor = L[2] + 0.6 + 0.3;
  return { x0: -NOTCH.half - 8.5, z0: L[1] - 4.5, z1: L[1] + 4.5, y0: floor - 1.2, y1: floor + 5.5 };
}
const isStairSpoke = (a: number) => Math.abs(angleDiff(a, 90 + STAR.rot)) < 1;
function angleDiff(a: number, b: number) { let d = (a - b) % 360; if (d > 180) d -= 360; if (d <= -180) d += 360; return d; }
const angleIn = (a: number, lo: number, hi: number) => { const d = angleDiff(a, lo), w = angleDiff(hi, lo); return d >= 0 && d <= (w < 0 ? w + 360 : w); };
const midAngle = (a: number, b: number) => { let d = b - a; while (d < 0) d += 360; return a + d / 2; };
/** L0's forecourt on the ring road (the stair's), in two convex halves: the ring road's inner chords to its south edge */
function stairFoot(): V2[][] {
  const e = southEdge(R_FOOT), z1 = STAIR.landings[0][1] + 18;
  return [wound([[-18, chordZ(e, -18)], [0, chordZ(e, 0)], [0, z1], [-18, z1]]), wound([[0, chordZ(e, 0)], [18, chordZ(e, 18)], [18, z1], [0, z1]])];
}

/** the citadel's claims: the temple on its ring, the eight wedges' terraces (the slab sectors' gold inlays theirs too),
 *  the seven causeways and the grand stair (ways), the dwellings in the slab sectors' rock skin and in the notch's west
 *  wall, the girls' room in the dwelling at L2 west, the caverns under it all and the rock kept over them. Inside
 *  R_INNER everything stands on the rock kept over the caverns (y from 22) */
function citadelClaims(): Claim[] {
  const out: Claim[] = [];
  const C = 'citadel', TOP = PLATEAU.topY, cv = CAVERNS;
  // (a top wedge's courts step down to 23.1 and their walls reach FOOT (6 m) below that; out past the caverns' rock)
  const yIn: [number, number] = [cv.ceilY + 8, TOP + 14], yFull: [number, number] = [-3, TOP + 14], yTopWedge: [number, number] = [cv.ceilY + 1, TOP + 14];
  out.push(claim('citadel/temple', C, 'temple', 'build', FINE.map((a) => polar(R_TEMPLE, a)), [cv.ceilY + 8, TOP + 215]));
  // the spokes: the stair down the notch (between its walls), a causeway down each of the others
  const spokeSides = (s: number): [Ray, Ray] => (isStairSpoke(s) ? [notchWall(NOTCH.half), notchWall(-NOTCH.half)] : [sideRay(s, -CAUSEWAY_HALF), sideRay(s, CAUSEWAY_HALF)]);
  for (const s of SPOKES) {
    const [lo, hi] = spokeSides(s), stair = isStairSpoke(s);
    const owner = stair ? 'stair' : 'causeways', id = stair ? 'citadel/stair' : `citadel/causeway-${Math.round(s)}`;
    out.push(claim(`${id}-in`, C, owner, 'way', sector(R_TEMPLE, R_INNER, lo, hi, FINE, FINE), yIn));
    out.push(claim(id, C, owner, 'way', sector(R_INNER, R_FOOT, lo, hi, FINE, RING_ANGLES), yFull));
  }
  stairFoot().forEach((q, i) => out.push(claim(`citadel/stair-foot-${i}`, C, 'stair', 'way', q, [-3, 12])));
  // the wedges, between the spokes' sides
  const wedges = GARDENS.wedges.map((w) => ({ w, a0: w.a0 / DEG, a1: w.a1 / DEG }));
  wedges.forEach(({ w, a0, a1 }, i) => {
    const prev = wedges[(i + wedges.length - 1) % wedges.length], next = wedges[(i + 1) % wedges.length];
    const lo = spokeSides(midAngle(prev.a1, a0))[1], hi = spokeSides(midAngle(a1, next.a0))[0];
    out.push(claim(`citadel/terraces-${i}-in`, C, 'terraces', 'build', sector(R_TEMPLE, R_INNER, lo, hi, FINE, FINE), yIn));
    if (w.kind === 'flank') {
      out.push(claim(`citadel/terraces-${i}`, C, 'terraces', 'build', sector(R_INNER, R_FOOT, lo, hi, FINE, RING_ANGLES), yFull));
      return;
    }
    // a top wedge: its courts and its slab sector out to the rock skin; the one by the stair gives the notch's west wall
    // (from L4 down) to the dwellings
    let body = sector(R_INNER, R_SKIN, lo, hi, FINE, FINE);
    if (lo.o[0] === -NOTCH.half && lo.d[0] === 0) {
      const xw = -NOTCH.half - NOTCH_DWELL.depth;
      // (the outline: the inner ring, the far side, the skin back toward the notch as far as x = xw, then round the
      // dwellings' corner to the notch's wall)
      const skinMeet = meetRing(notchWall(xw), R_SKIN, FINE);
      const iHiAt = body.findIndex((p, j) => j > 0 && Math.hypot(p[0], p[1]) > R_INNER + 1);
      const inner = body.slice(0, iHiAt), outer = body.slice(iHiAt).filter((p) => p[0] < xw - 1e-6);
      body = [...inner, ...outer, skinMeet, [xw, NOTCH_DWELL.z0], [-NOTCH.half, NOTCH_DWELL.z0]];
    }
    out.push(claim(`citadel/terraces-${i}`, C, 'terraces', 'build', body, yTopWedge));
    // the rock skin under the slab sector's edge (the dwellings' frontages on the ring road and on a ledge over it), the
    // caverns' portal cut through the south-south-west's
    const pa = cv.portal.angle;
    if (angleIn(pa, a0, a1)) {
      const pLo = sideRay(pa, -PORTAL_HALF), pHi = sideRay(pa, PORTAL_HALF);
      out.push(claim(`citadel/dwellings-skin-${i}-a`, C, 'dwellings', 'build', sector(R_SKIN, R_FOOT, lo, pLo, FINE, RING_ANGLES), [-3, TOP + 4]));
      out.push(claim(`citadel/dwellings-skin-${i}-b`, C, 'dwellings', 'build', sector(R_SKIN, R_FOOT, pHi, hi, FINE, RING_ANGLES), [-3, TOP + 4]));
      // (its gate rises to the plateau's top, closing the dig behind it: the land is one height over the tunnel)
      out.push(claim('citadel/caverns-portal', C, 'caverns', 'build', sector(R_SKIN, R_FOOT, pLo, pHi, FINE, RING_ANGLES), [-3, TOP + 4]));
      out.push(claim('citadel/caverns-tunnel', C, 'caverns', 'build', sector(cv.r - 10, R_SKIN, pLo, pHi, FINE, FINE), [cv.floorY - 3, 6]));
      out.push(claim('citadel/caverns-tunnel-rock', C, 'caverns', 'keep', sector(cv.r + 2, R_SKIN, pLo, pHi, FINE, FINE), [6, cv.ceilY]));
    } else out.push(claim(`citadel/dwellings-skin-${i}`, C, 'dwellings', 'build', sector(R_SKIN, R_FOOT, lo, hi, FINE, RING_ANGLES), [-3, TOP + 4]));
  });
  // the dwellings in the notch's west wall (L1-L4's doors) round the girls' room in the one at L2
  const room = roomBox(), e = southEdge(R_FOOT);
  const x0 = -NOTCH.half - NOTCH_DWELL.depth, x1 = -NOTCH.half;
  const box = (za: number, zb: number, xa = x0, xb = x1): V2[] => [[xa, za], [xb, za], [xb, zb], [xa, zb]];
  out.push(claim('citadel/dwellings-notch-n', C, 'dwellings', 'build', box(NOTCH_DWELL.z0, room.z0), [-3, TOP + 4]));
  out.push(claim('citadel/dwellings-notch-s', C, 'dwellings', 'build', [[x0, room.z1], [x1, room.z1], [x1, chordZ(e, x1)], ...ringBetween(R_FOOT, angleOf([x1, chordZ(e, x1)]), angleOf([x0, chordZ(e, x0)]), RING_ANGLES), [x0, chordZ(e, x0)]], [-3, TOP + 4]));
  out.push(claim('citadel/dwellings-notch-under', C, 'dwellings', 'build', box(room.z0, room.z1), [-3, room.y0]));
  out.push(claim('citadel/dwellings-notch-over', C, 'dwellings', 'build', box(room.z0, room.z1), [room.y1, TOP + 4]));
  out.push(claim('citadel/dwellings-notch-behind', C, 'dwellings', 'build', box(room.z0, room.z1, x0, room.x0), [room.y0, room.y1]));
  out.push(claim('citadel/room', C, 'room', 'build', box(room.z0, room.z1, room.x0, x1), [room.y0, room.y1]));
  // the caverns' halls, and the rock kept over them (no court, foundation or wall's foot within 8 m of their ceiling)
  out.push(claim('citadel/caverns', C, 'caverns', 'build', disc([cv.x, cv.z], cv.r, 48), [cv.floorY - 3, cv.ceilY]));
  out.push(claim('citadel/caverns-rock', C, 'caverns', 'keep', disc([cv.x, cv.z], cv.r + 2, 48), [cv.ceilY, cv.ceilY + 8]));
  return out;
}

/** the landmarks', the ways', the rims' and the water's claims, each a convex outline (the town's fabric is what's left
 *  round them) */
function townClaims(pools: Pool[]): Claim[] {
  const out: Claim[] = [];
  const E = POINTS.find((p) => p.role === 'palace')!, W = POINTS.find((p) => p.role === 'market')!;
  const uOf = (p: StarPoint, x: number, z: number) => pointFrame(p, x, z)[0];
  // ---- the ways: the ring road (round L0's forecourt), the squares at the spokes' feet, the avenues out to the tips
  const g = [...RING_ANGLES].sort((a, b) => a - b), foot = stairFoot();
  let n = 0;
  for (let i = 0; i < g.length; i++) {
    const a0 = g[i], a1 = i + 1 < g.length ? g[i + 1] : g[0] + 360;
    let pieces = [wound([polar(WAYS.ring.r0, a0), polar(WAYS.ring.r0, a1), polar(WAYS.ring.r1, a1), polar(WAYS.ring.r1, a0)])];
    for (const f of foot) pieces = pieces.flatMap((q) => subtractConvex(q, f));
    for (const q of pieces) out.push(claim(`ways/ring-${n++}`, 'ways', 'streets', 'way', q, Y_WAY));
  }
  const f = WAYS.foot, t = WAYS.tip, half = WAYS.avenue / 2;
  const mu = uOf(W, MARKET.x, MARKET.z);
  for (const p of POINTS) {
    if (p.role === 'civic') continue;
    out.push(claim(`ways/foot-${p.name}`, 'ways', 'streets', 'way', pointRect(p, f.r - f.half, f.r + f.half, -f.half, f.half), Y_WAY));
    const runs: [number, number][] = p.role === 'palace' ? [[f.r + f.half, closeFront(PALACE)]]
      : p.role === 'market' ? [[f.r + f.half, mu - MARKET.rx * MARKET_K], [mu + MARKET.rx * MARKET_K, t.r - t.half]] : [[f.r + f.half, t.r - t.half]];
    runs.forEach(([u0, u1], k) => out.push(claim(`ways/avenue-${p.name}${k ? '-out' : ''}`, 'ways', 'streets', 'way', pointRect(p, u0, u1, -half, half), Y_WAY)));
  }
  // ---- the south: the plaza (to the hall's front), the stair square (round L0's forecourt, from the ring road), the hall
  const hall = closePoly(GRAND_HALL), hallFront = Math.min(...hall.map((q) => q[1]));
  out.push(claim('south/plaza', 'south', 'plaza', 'build', clipLine(wound(around([PLAZA.x, PLAZA.z], PLAZA.paved, 16, Math.PI / 16)), [1, hallFront], [0, hallFront], true), [-3, 22]));
  const e = southEdge(WAYS.ring.r1), sq = STAIR_SQUARE, fz = STAIR.landings[0][1] + 18;
  out.push(claim('south/stair-square-w', 'south', 'plaza', 'build', wound([[-18, chordZ(e, -18)], [sq.x0, chordZ(e, sq.x0)], [sq.x0, sq.z1], [-18, sq.z1]]), [-3, 22]));
  out.push(claim('south/stair-square-m', 'south', 'plaza', 'build', wound([[-18, fz], [18, fz], [18, sq.z1], [-18, sq.z1]]), [-3, 22]));
  out.push(claim('south/stair-square-e', 'south', 'plaza', 'build', wound([[sq.x1, chordZ(e, sq.x1)], [18, chordZ(e, 18)], [18, sq.z1], [sq.x1, sq.z1]]), [-3, 22]));
  out.push(claim('south/hall', 'south', 'hall', 'build', wound(hall), [-3, GRAND_HALL.height + 10]));
  // ---- the east: the palace's precinct, the water gate's two towers either side of the sluice
  out.push(claim('east/palace', 'east', 'palace', 'build', wound(closePoly(PALACE)), [-3, PALACE.spireH + 8]));
  // (the towers' battered feet reach in over the channel's quays: the canal keeps the channel and a metre and a half)
  const gw = CHANNEL.width / 2 + 1.5, gr = GATE.towerR + (GATE.width / 2 - gw), gu = uOf(E, GATE.x, GATE.z);
  out.push(claim('east/gate-n', 'east', 'gate', 'build', pointRect(E, gu - 15, gu + 15, -gw - 2 * gr - 0.5, -gw), [-5, 60]));
  out.push(claim('east/gate-s', 'east', 'gate', 'build', pointRect(E, gu - 15, gu + 15, gw, gw + 2 * gr + 0.5), [-5, 60]));
  // ---- the west: the market's square
  out.push(claim('west/market', 'west', 'market', 'build', wound(ellipsePoly(MARKET.x, MARKET.z, MARKET.rx * MARKET_K, MARKET.rz * MARKET_K, 16)), [-3, 25]));
  // ---- the rim: a square at each tip but the east's, its lookout tower behind it out on the rim
  for (const p of POINTS) {
    if (p.role === 'palace') continue;
    const l = WAYS.lookout;
    out.push(claim(`${p.name}/rim`, p.name, 'rim', 'build', convexHull([...pointRect(p, t.r - t.half, t.r + t.half, -t.half, t.half), ...around(inPoint(p, l.r, 0), l.radius, 8)]), [-5, 60]));
  }
  // ---- the water: the town's pools; the canal, the tank, the sluice and the gate's channel, the cascades down the
  // cliff, the channel across the plain
  pools.forEach((q, i) => { if (q.kind === 'pool') out.push(claim(`water/pool-${i}`, 'water', 'pools', 'build', poolClaim(q), [-4, 8])); });
  const tank = pools.findIndex((q) => q.kind === 'tank'), T = pools[tank], cw = 12, tu = uOf(E, T.x, T.z);
  out.push(claim('water/canal', 'water', 'canal', 'build', pointRect(E, uOf(E, ...CHANNEL.canal[0]), tu - T.rx + 4, -cw, cw), [-4, 10]));
  out.push(claim('water/tank', 'water', 'canal', 'build', poolClaim(T), [-4, 10]));
  out.push(claim('water/sluice', 'water', 'canal', 'build', pointRect(E, tu + T.rx - 4, gu - 15, -cw, cw), [-4, 10]));
  out.push(claim('water/gate', 'water', 'canal', 'build', pointRect(E, gu - 15, gu + 15, -gw, gw), [-4, 10]));
  out.push(claim('water/cascade', 'water', 'canal', 'build', pointRect(E, gu + 15, uOf(E, ...CHANNEL.plain.path[0]) + 10, -cw, cw), [PLAIN_Y - 5, 14]));
  const P = CHANNEL.plain;
  for (let i = 0; i < P.path.length - 1; i++) out.push(claim(`water/plain-${i}`, 'water', 'canal', 'build', strip(P.path[i], P.path[i + 1], P.halfWidth + 6), [PLAIN_Y - 5, PLAIN_Y + 10]));
  return out;
}
/** a pool's claim reaches this far past its water (its coping, steps and lamps): a 12-gon round that */
const POOL_RIM = 4;
function poolClaim(q: Pool): V2[] {
  const n = 12, k = 1 / Math.cos(Math.PI / n), c = Math.cos(q.rot), s = Math.sin(q.rot);
  return wound(Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2, u = Math.cos(t) * (q.rx + POOL_RIM) * k, v = Math.sin(t) * (q.rz + POOL_RIM) * k;
    return [q.x + c * u - s * v, q.z + s * u + c * v] as V2;
  }));
}
/** how far out its point's axis the front of a landmark's close is */
const closeFront = (a: typeof PALACE) => {
  const p = POINTS.reduce((b, q) => (Math.abs(angleDiff(q.tip, angleOf([a.x, a.z]))) < Math.abs(angleDiff(b.tip, angleOf([a.x, a.z]))) ? q : b));
  return Math.min(...closePoly(a).map(([x, z]) => pointFrame(p, x, z)[0]));
};
const ellipsePoly = (cx: number, cz: number, rx: number, rz: number, n: number): V2[] => Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * rx, cz + Math.sin((i / n) * Math.PI * 2) * rz] as V2);

/** the ridges' keep-outs (district 'land', owner 'ridges': the land's to raise, nothing built in them), a convex piece
 *  per segment: a trunk's from the ring road's outer edge out (its root runs under the ring road), a branch's open
 *  across its cut */
function ridgeClaims(): Claim[] {
  const out: Claim[] = [];
  RIDGES.forEach((r, i) => {
    const L = polyLength(r.pts);
    let s = 0;
    for (let k = 0; k < r.pts.length - 1; k++) {
      const a = r.pts[k], b = r.pts[k + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]), d: V2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      const ka = ridgeKeep(ridgeHalfWidth(i, s / L)), kb = ridgeKeep(ridgeHalfWidth(i, (s + l) / L));
      let pieces: V2[][] = [convexHull([...around(a, ka, 8, Math.PI / 8), ...around(b, kb, 8, Math.PI / 8)])];
      if (r.kind === 'trunk') {
        // (square to the trunk WAYS.ring.r1 + 2 out from the centre: everything nearer is the ring road's or the citadel's)
        const at = (u: number): V2 => [STAR.cx + d[0] * u, STAR.cz + d[1] * u];
        const o = at(WAYS.ring.r1 + 2), n: V2 = [-d[1], d[0]];
        pieces = pieces.map((q) => clipLine(q, [o[0] - n[0], o[1] - n[1]], [o[0] + n[0], o[1] + n[1]], false)).filter((q) => q.length >= 3);
      }
      for (const c of RIDGE_CUTS.filter((c) => c.ridge === i && r.kind !== 'trunk')) {
        // (the cut: a band across the ridge, square to it, `width` wide)
        const cd = dirAlong(r.pts, c.along / L), n: V2 = [-cd[1], cd[0]], h = c.width / 2, far = 400;
        const band = wound([[c.at[0] - cd[0] * h + n[0] * far, c.at[1] - cd[1] * h + n[1] * far], [c.at[0] + cd[0] * h + n[0] * far, c.at[1] + cd[1] * h + n[1] * far],
          [c.at[0] + cd[0] * h - n[0] * far, c.at[1] + cd[1] * h - n[1] * far], [c.at[0] - cd[0] * h - n[0] * far, c.at[1] - cd[1] * h - n[1] * far]]);
        pieces = pieces.flatMap((q) => subtractConvex(q, band));
      }
      pieces.forEach((q, j) => out.push(claim(`land/${r.kind}-${i}-${k}${pieces.length > 1 ? `-${j}` : ''}`, 'land', 'ridges', 'keep', wound(q), [-3, 40])));
      s += l;
    }
  });
  return out;
}

/** the town's fabric (owner 'town': its floor, its streets, its lots and houses, its gardens and local squares nested
 *  under it): each point's ground inside the building line and out past the ring road, less every other claim on it,
 *  in convex pieces. A piece runs between two of the ring road's angles, from the road's outer edge to the building
 *  line (the point's edge, RIM.building in: straight, so inside the rounded tips' line; the rounded notches' falls
 *  outside it), no further out than the middle of the tip square */
function fabricClaims(others: Claim[]): Claim[] {
  const out: Claim[] = [];
  const holes = others.filter((c) => c.district !== 'citadel' || c.id.startsWith('citadel/stair-foot'));
  for (const c of holes) if (!isConvex(c.poly)) throw new Error(`layout: ${c.id} must be convex to be cut out of the town`);
  for (const p of POINTS) {
    let pieces: V2[][] = [];
    const angs = RING_ANGLES.filter((a) => Math.abs(angleDiff(a, p.tip)) <= 22.5 + 1e-6).map((a) => p.tip + angleDiff(a, p.tip)).sort((a, b) => a - b);
    for (let i = 0; i < angs.length - 1; i++) {
      const a0 = angs[i], a1 = angs[i + 1];
      const q = clipLine(wound([polar(WAYS.ring.r1, a0), polar(WAYS.ring.r1, a1), buildingLine(p, a1), buildingLine(p, a0)]),
        inPoint(p, WAYS.tip.r, -1), inPoint(p, WAYS.tip.r, 1), true);
      if (q.length >= 3) pieces.push(wound(q));
    }
    for (const c of holes) {
      const box = polyBox(c.poly);
      pieces = pieces.flatMap((q) => (boxesMeet(polyBox(q), box) ? subtractConvex(q, c.poly) : [q]));
    }
    mergeConvex(pieces.filter((q) => Math.abs(polyArea(q)) > 1e-3)).filter((q) => Math.abs(polyArea(q)) > 12)
      .forEach((q, i) => out.push(claim(`${p.name}/town-${i}`, p.name, 'town', 'build', q, Y_TOWN)));
  }
  return out;
}
/** convex pieces that meet merged wherever two make one convex piece (their hull no bigger than the two): the cuts
 *  round the holes leave many slivers that go back together */
function mergeConvex(pieces: V2[][]): V2[][] {
  const P = pieces.map((q) => ({ q, a: Math.abs(polyArea(q)), box: polyBox(q), alive: true }));
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < P.length; i++) {
      if (!P[i].alive) continue;
      for (let j = i + 1; j < P.length; j++) {
        if (!P[j].alive || !boxesMeet(P[i].box, P[j].box, 1e-6)) continue;
        const h = convexHull([...P[i].q, ...P[j].q]), ha = Math.abs(polyArea(h));
        if (ha <= (P[i].a + P[j].a) * (1 + 1e-9) + 1e-6) {
          P[i] = { q: simplifyHull(h), a: ha, box: polyBox(h), alive: true };
          P[j].alive = false;
          changed = true;
        }
      }
    }
  }
  return P.filter((e) => e.alive).map((e) => e.q);
}
/** a hull's nearly collinear vertices dropped */
function simplifyHull(p: V2[]): V2[] {
  const out = p.filter((b, i) => {
    const a = p[(i - 1 + p.length) % p.length], c = p[(i + 1) % p.length];
    const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    return Math.abs(cr) > 1e-6 * (1 + Math.hypot(c[0] - a[0], c[1] - a[1]) ** 2);
  });
  return out.length >= 3 ? out : p;
}
/** where the building line (the point's edge on that side of its axis, RIM.building in, straight) crosses the ray at
 *  angle a */
function buildingLine(p: StarPoint, a: number): V2 {
  const side = angleDiff(a, p.tip) >= 0 ? 1 : -1;
  const T = polar(STAR.rTip, p.tip), N = polar(STAR.rIn, p.tip + side * 22.5);
  const dx = N[0] - T[0], dz = N[1] - T[1], L = Math.hypot(dx, dz);
  let nx = dz / L, nz = -dx / L;
  // (the normal toward the centre)
  if (nx * (STAR.cx - T[0]) + nz * (STAR.cz - T[1]) < 0) { nx = -nx; nz = -nz; }
  const b = RIM.building, A: V2 = [T[0] + nx * b, T[1] + nz * b];
  const ray = sideRay(a, 0), den = ray.d[0] * dz - ray.d[1] * dx;
  const t = ((A[0] - ray.o[0]) * dz - (A[1] - ray.o[1]) * dx) / den;
  return [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t];
}
/** how far out along angle a (degrees) the town's building line is, straight (RIM.building inside the point's edge on
 *  that side of its axis): the town's blocks reach to it; near a tip, where the rounded line falls inside it, the tip's
 *  square holds the ground */
export function buildingReach(a: number): number {
  const p = POINTS.reduce((b, q) => (Math.abs(angleDiff(q.tip, a)) < Math.abs(angleDiff(b.tip, a)) ? q : b));
  const q = buildingLine(p, p.tip + angleDiff(a, p.tip));
  return Math.hypot(q[0] - STAR.cx, q[1] - STAR.cz);
}
function isConvex(p: V2[]): boolean {
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 1e-7 * (1 + Math.hypot(c[0] - a[0], c[1] - a[1]) ** 2)) continue;
    if (sign === 0) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) return false;
  }
  return true;
}

// ------------------------------------------------------------------------------------------------- pools placed

/** the pools, placed where they clear everything by POOL_CLEAR: four in each homes point's flank strips (between its
 *  branches and the rim), one by each homes point's tip square, two at each trunk's root by the ring road, a few round
 *  the landmarks of the south, east and west, and the east's tank */
const POOL_CLEAR = 8;
function makePools(hard: Claim[]): Pool[] {
  const rng = rngOf(0x9001);
  const pools: Pool[] = [];
  const blocked = hard.filter((c) => c.district !== 'citadel').map((c) => ({ poly: c.poly, box: polyBox(c.poly) }));
  const ok = (q: Pool) => {
    // (the cheap tests on its middle first: a ridge whose keep-out is farther than the pool's reach needs no more)
    const reach = Math.max(q.rx, q.rz) + POOL_CLEAR;
    if (sdStar(q.x, q.z) > -RIM.building - Math.min(q.rx, q.rz) - POOL_CLEAR) return false;
    if (Math.hypot(q.x - STAR.cx, q.z - STAR.cz) < WAYS.ring.r1 + Math.min(q.rx, q.rz) + POOL_CLEAR) return false;
    const near: number[] = [];
    for (let i = 0; i < RIDGES.length; i++) {
      const d = ridgeDistance(i, q.x, q.z);
      if (d < Math.min(q.rx, q.rz) + POOL_CLEAR) return false;
      if (d < reach) near.push(i);
    }
    const mine = poolPoly(0, POOL_CLEAR, [q]), box = polyBox(mine);
    for (const [x, z] of mine) {
      if (sdStar(x, z) > -RIM.building) return false;
      if (Math.hypot(x - STAR.cx, z - STAR.cz) < WAYS.ring.r1) return false;
      for (const i of near) if (ridgeDistance(i, x, z) < 0) return false;
    }
    for (const c of blocked) if (boxesMeet(box, c.box) && overlapArea(mine, c.poly) > 0.01) return false;
    for (const o of pools) if (overlapArea(mine, poolClaim(o)) > 0.01) return false;
    return true;
  };
  // try a pool near (u, v) in point p's frame, spiralling out up to `search` m for a place that clears
  const place = (p: StarPoint, u: number, v: number, rx: number, rz: number, search = 40) => {
    const rot = (p.tip + range(rng, -30, 30)) * DEG;
    for (let r = 0; r <= search; r += 4) {
      const n = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 6), a0 = rng() * Math.PI * 2;
      for (let k = 0; k < n; k++) {
        const a = a0 + (k / n) * Math.PI * 2, [x, z] = inPoint(p, u + Math.cos(a) * r, v + Math.sin(a) * r);
        const q: Pool = { x, z, rx, rz, rot, kind: 'pool', district: p.name };
        if (ok(q)) { pools.push(q); return true; }
      }
    }
    return false;
  };
  for (const p of POINTS) {
    if (p.role === 'homes') {
      for (const s of [-1, 1]) {
        place(p, 486, s * 150, range(rng, 11, 15), range(rng, 8, 10));
        place(p, 574, s * 104, range(rng, 10, 13), range(rng, 7, 9));
      }
      place(p, 646, (rng() < 0.5 ? -1 : 1) * 32, range(rng, 9, 11), range(rng, 6, 8));
    } else if (p.role === 'civic') {
      for (const s of [-1, 1]) { place(p, 440, s * 150, 13, 9, 50); place(p, 596, s * 96, 10, 7, 30); }
    } else if (p.role === 'palace') {
      for (const s of [-1, 1]) { place(p, 450, s * 140, 13, 9, 50); place(p, 600, s * 70, 11, 8, 30); }
    } else {
      for (const s of [-1, 1]) { place(p, 440, s * 150, 13, 9, 50); place(p, 600, s * 70, 10, 7, 30); }
      place(p, 646, (rng() < 0.5 ? -1 : 1) * 32, 10, 7);
    }
  }
  // two at each trunk's root, either side of it just out from the ring road
  for (let k = 0; k < 8; k++) {
    const a = STAR.rot + 22.5 + 45 * k;
    for (const s of [-1, 1]) {
      const p = POINTS.find((q) => Math.abs(angleDiff(q.tip, a + s * 22.5)) < 1)!;
      const at = polar(368, a + s * 9.5), [u, v] = pointFrame(p, at[0], at[1]);
      place(p, u, v, range(rng, 9, 11), range(rng, 6.5, 8), 24);
    }
  }
  const T = CHANNEL.tank;
  pools.push({ x: T.x, z: T.z, rx: T.rx, rz: T.rz, rot: 0, kind: 'tank', district: 'water' });
  return pools;
}
/** the area two polygons share (convex both: exactly; else sampled on a half-metre grid) */
export function overlapArea(a: V2[], b: V2[]): number {
  if (!boxesMeet(polyBox(a), polyBox(b))) return 0;
  if (isConvex(a) && isConvex(b)) return Math.abs(polyArea(intersectConvex(a, b)));
  const [ax0, az0, ax1, az1] = polyBox(a), [bx0, bz0, bx1, bz1] = polyBox(b);
  const x0 = Math.max(ax0, bx0), x1 = Math.min(ax1, bx1), z0 = Math.max(az0, bz0), z1 = Math.min(az1, bz1), h = 0.5;
  let n = 0;
  for (let x = x0 + h / 2; x < x1; x += h) for (let z = z0 + h / 2; z < z1; z += h) if (pointIn(a, x, z) && pointIn(b, x, z)) n++;
  return n * h * h;
}
/** a point in a plan polygon (even-odd; claims.ts inPoly's rule) */
export function pointIn(p: V2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ------------------------------------------------------------------------------------------------- the plan's lists

/** the pools (POOLS[i]; the tank last) */
export const POOLS: Pool[] = makePools(townClaims([{ ...CHANNEL.tank, rot: 0, kind: 'tank', district: 'water' }]));

/** an array made when it's first read (the claims: the tools and the checks read them, the game never does, and
 *  cutting the town's fabric round everything takes a moment every worker needn't pay) */
function lazy<T>(make: () => T[]): T[] {
  const target: T[] = [];
  let made = false;
  const fill = () => { if (!made) { made = true; target.push(...make()); } return target; };
  return new Proxy(target, {
    get: (_, k) => { const t = fill(); const v = Reflect.get(t, k, t); return typeof v === 'function' ? v.bind(t) : v; },
    has: (_, k) => Reflect.has(fill(), k),
    ownKeys: () => Reflect.ownKeys(fill()),
    getOwnPropertyDescriptor: (_, k) => Reflect.getOwnPropertyDescriptor(fill(), k),
  });
}

/** Every claim on the world's ground (world/claims.ts: owners' 'build' claims never overlap one another; a 'way' may
 *  cross another 'way'; a 'keep' is held empty; claims abut exactly along shared edges, so an overlap test goes by
 *  area, not by touching). Owners: the citadel's 'temple', 'terraces', 'causeways', 'stair', 'dwellings', 'room',
 *  'caverns'; the south's 'plaza' (the plaza and the stair square) and 'hall'; the east's 'palace' and 'gate'; the
 *  west's 'market'; every tip's 'rim' (its square and lookout tower); 'streets' (the ring road, the spokes' feet and
 *  avenues); 'pools' and 'canal' (the water); 'ridges' (the land's keep-outs); 'town' (each point's fabric). */
export const CLAIMS: Claim[] = lazy(() => {
  const built = [...citadelClaims(), ...townClaims(POOLS), ...ridgeClaims()];
  return [...built, ...fabricClaims(built)];
});

/** the ports: where two districts' ways meet, their floor's height exact, each side building its way to it */
export const PORTS: Port[] = (() => {
  const out: Port[] = [];
  const port = (id: string, between: [string, string], p: V2, y: number, width: number, dir: V2) => {
    const L = Math.hypot(dir[0], dir[1]);
    out.push({ id, between, p: [p[0], y, p[1]], width, dir: [dir[0] / L, dir[1] / L] });
  };
  const radial = (a: number): V2 => [Math.cos(a * DEG), Math.sin(a * DEG)];
  const tangent = (a: number): V2 => [-Math.sin(a * DEG), Math.cos(a * DEG)];
  // the ring road over each trunk's cutting, between the two points the trunk parts (the land's floor at 0 there)
  for (let k = 0; k < 8; k++) {
    const a = STAR.rot + 22.5 + 45 * k;
    const lo = POINTS.find((p) => Math.abs(angleDiff(p.tip, a - 22.5)) < 1)!, hi = POINTS.find((p) => Math.abs(angleDiff(p.tip, a + 22.5)) < 1)!;
    const cut = RIDGE_CUTS.find((c) => c.ridge === k)!;
    port(`cut/${lo.name}-${hi.name}`, [lo.name, hi.name], cut.at, FLOOR_Y, PLATEAU.ring.width, tangent(a));
  }
  // each causeway's foot on the ring road
  for (const s of SPOKES) if (!isStairSpoke(s)) port(`citadel/spoke-${Math.round(s)}`, ['citadel', 'ways'], meetRing(sideRay(s, 0), R_FOOT, RING_ANGLES), FLOOR_Y, 2 * CAUSEWAY_HALF, radial(s));
  // the grand stair: L0's forecourt on the ring road (the road either side of it) and its foot on the stair square
  const fz = STAIR.landings[0][1] + 18;
  port('citadel/stair-ring-w', ['citadel', 'ways'], [-18, PLATEAU.ring.r], FLOOR_Y, PLATEAU.ring.width, [-1, 0]);
  port('citadel/stair-ring-e', ['citadel', 'ways'], [18, PLATEAU.ring.r], FLOOR_Y, PLATEAU.ring.width, [1, 0]);
  port('citadel/stair-foot', ['citadel', 'south'], [0, fz], FLOOR_Y, 36, [0, 1]);
  // the stair square's sides on the ring road
  const e = southEdge(WAYS.ring.r1);
  port('south/ring-w', ['ways', 'south'], [-28, chordZ(e, -28)], FLOOR_Y, 20, [0, 1]);
  port('south/ring-e', ['ways', 'south'], [28, chordZ(e, 28)], FLOOR_Y, 20, [0, 1]);
  // the caverns' portal (its apron's outer edge on the ring road)
  const pa = CAVERNS.portal.angle;
  port('citadel/portal', ['ways', 'citadel'], meetRing(sideRay(pa, 0), R_FOOT, RING_ANGLES), CAVERNS.portal.y, 2 * PORTAL_HALF, [-Math.cos(pa * DEG), -Math.sin(pa * DEG)]);
  // the girls' room's door, on the notch's west wall over L2's bridge (its floor a step up from the landing's walk): the
  // mouth of the loggia beside her room, at the north end of its box (haven/plan.ts ROOM_BOX.door)
  const L2 = STAIR.landings[ROOM_DWELLING.landing];
  port('citadel/room-door', ['citadel', 'citadel'], [-NOTCH.half, L2[1] - 3.3], roomBox().y0 + 1.2, 1.6, [-1, 0]);
  // the east: the avenue onto the palace's court, the canal's head at the palace's back, the water gate
  const E = POINTS.find((p) => p.role === 'palace')!, W = POINTS.find((p) => p.role === 'market')!;
  port('east/palace-front', ['ways', 'east'], inPoint(E, closeFront(PALACE), 0), FLOOR_Y, WAYS.avenue, radial(E.tip));
  port('east/canal-head', ['east', 'water'], inPoint(E, CHANNEL.canal[0][0], 0), FLOOR_Y, 24, radial(E.tip));
  port('east/water-gate', ['east', 'water'], [GATE.x, GATE.z], FLOOR_Y, GATE.width, radial(E.tip));
  // the west: the avenue into the market and out of it
  const mu = pointFrame(W, MARKET.x, MARKET.z)[0];
  port('west/market-in', ['ways', 'west'], inPoint(W, mu - MARKET.rx * MARKET_K, 0), FLOOR_Y, WAYS.avenue, radial(W.tip));
  port('west/market-out', ['west', 'ways'], inPoint(W, mu + MARKET.rx * MARKET_K, 0), FLOOR_Y, WAYS.avenue, radial(W.tip));
  // the avenues' ends at the tip squares
  for (const p of POINTS) if (p.role === 'homes' || p.role === 'market') port(`${p.name}/tip`, ['ways', p.name], inPoint(p, WAYS.tip.r - WAYS.tip.half, 0), FLOOR_Y, WAYS.avenue, radial(p.tip));
  return out;
})();

/** each district's budget: triangles as handed over, lights, colliders, summing to about the world's as it was built
 *  (the city 1.29 M triangles, 2,454 lights, 322 colliders; the Haven 0.67 M, 494, 266) so the phone's gate holds */
export const BUDGETS: Budget[] = [
  { district: 'citadel', triangles: 720_000, lights: 520, colliders: 290 },
  { district: 'south', triangles: 150_000, lights: 330, colliders: 45 },
  { district: 'east', triangles: 130_000, lights: 300, colliders: 40 },
  { district: 'west', triangles: 170_000, lights: 330, colliders: 45 },
  ...POINTS.filter((p) => p.role === 'homes').map((p) => ({ district: p.name, triangles: 115_000, lights: 250, colliders: 30 })),
  { district: 'ways', triangles: 70_000, lights: 150, colliders: 20 },
  { district: 'water', triangles: 110_000, lights: 120, colliders: 75 },
  { district: 'land', triangles: 0, lights: 0, colliders: 0 },
];

/** is (x, z) on the town's ground: inside the building line, out past the ring road, clear of the ridges' keep-outs and
 *  the pools (by `margin` m) */
export function inTown(x: number, z: number, margin = 0): boolean {
  if (sdStar(x, z) > -RIM.building - margin) return false;
  if (Math.hypot(x - STAR.cx, z - STAR.cz) < WAYS.ring.r1 + margin) return false;
  for (let i = 0; i < RIDGES.length; i++) if (ridgeDistance(i, x, z) < margin) return false;
  for (const q of POOLS) {
    const c = Math.cos(-q.rot), s = Math.sin(-q.rot), dx = x - q.x, dz = z - q.z, u = c * dx - s * dz, v = s * dx + c * dz;
    if ((u / (q.rx + POOL_RIM + margin)) ** 2 + (v / (q.rz + POOL_RIM + margin)) ** 2 < 1) return false;
  }
  return true;
}
