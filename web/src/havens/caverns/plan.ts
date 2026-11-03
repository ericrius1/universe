// The crystal caverns under the citadel: their plan, all of it in a frame of its own laid along the tunnel in from the
// portal (CAVERNS: in the plateau's south-south-west flank on the ring road) to the halls under the temple, so the
// caverns move with the layout. The portal's gate stands at the back of an alcove cut into the plateau's skin; the
// tunnel runs in under the plateau, a long gallery stepping down in flights between level stretches, to the colonnade;
// through its far door the crystal hall under the temple, the glowing waterfall at its far end; off the hall's one side
// the grotto, a step down, and off its other the shrine, a step up. Plan (u, v): v along the tunnel inward (the portal
// at v -PORTAL.face, the temple's centre at v 0), u across it (the tunnel's axis at u U0); heights are metres above
// (below) the caverns' datum, BASE (world y = BASE + dy), so the halls lie deep in the rock (CAVERNS: floorY..ceilY,
// eight metres of rock kept over them).
//
//             portal (v -PORTAL.face, on the ring road; its alcove out to the ring road's edge)
//                 │ the tunnel, u 15.5..24.5: a gallery stepping down in four flights
//           ┌─────┴─────┐  colonnade (v -52.9..-31.5)
//  grotto ──┤   hall    ├── shrine        hall: u 2..38, v -29.5..6, floor 24 m down, 15 m high
//           └───────────┘  the waterfall in an alcove in its far wall
//
// What the rest of the world asks of it: cavernGround (the land's carve under all of it: world/build.worker.ts: the
// halls' pit and the tunnel's trench under the citadel's floors and the lane over them, the portal's alcove at the ring
// road's level), CAVE_UNIFORM (the boxes world.wgsl's underground() tests: no sun and no sky inside, and
// terrainSunVisibility's way out of the carve), inCaverns (the same test on the CPU, for the tools), and the rooms the
// builder (build.ts) walls.
import { CAVERNS, FLOOR_Y, TEMPLE, type V2 } from '../world/layout';

/** the caverns' datum (world y): their heights are measured from it */
export const BASE = 8;
/** (kept name: the halls' heights were measured from the mesa's top) */
export const TOP = BASE;
/** the plan's axes in the world: u across the tunnel, v along it inward from the portal (a turn of the old plan's east
 *  and south), the tunnel's axis on the line from the temple's centre out to the portal */
const PA = (CAVERNS.portal.angle * Math.PI) / 180;
export const TH = PA + Math.PI / 2;
const EU: V2 = [Math.cos(TH), Math.sin(TH)], EV: V2 = [-Math.sin(TH), Math.cos(TH)];
/** the tunnel's axis (u) */
export const U0 = 20;
/** plan (u, v) -> world (x, z) */
export const at = (u: number, v: number): V2 => [TEMPLE.x + EU[0] * (u - U0) + EV[0] * v, TEMPLE.z + EU[1] * (u - U0) + EV[1] * v];
/** world (x, z) -> plan (u, v) */
export const plan = (x: number, z: number): V2 => { const dx = x - TEMPLE.x, dz = z - TEMPLE.z; return [U0 + dx * EU[0] + dz * EU[1], dx * EV[0] + dz * EV[1]]; };
/** a height relative to the datum -> world y */
export const Y = (dy: number) => BASE + dy;

/** the halls' floor (m below the datum), the walls' thickness behind their faces */
export const HF = -24;
export const WALL_T = 1.6;
/** the portal: its gate's face (v), its alcove's mouth on the ring road's edge, its half-width (the claim's), the floor
 *  there (the ring road's, a hand's breadth over the town's floor) */
export const PORTAL = { face: -CAVERNS.portal.r + 4, back: -CAVERNS.portal.r + 8, mouth: -CAVERNS.portal.r - 14, half: 8, floor: FLOOR_Y + 0.02 - BASE };
/** the tunnel: its width (u), its mouth at the gate, its flights down (each [v where it starts, v where it ends], from
 *  the floor before to the floor after), its foot at the colonnade's door; its ceiling over its floor */
const DROP = (HF - PORTAL.floor) / 4;
export const STAIR = {
  u0: 15.5, u1: 24.5,
  top: PORTAL.mouth, portal: PORTAL.back,
  flights: [-282, -232, -182, -132].map((v, k) => ({ v0: v, v1: v + 8.5, y0: PORTAL.floor + k * DROP, y1: PORTAL.floor + (k + 1) * DROP })),
  foot: -54.5, ceil: 5.4,
};
/** the stair's axis (kept name) */

/** the tunnel's floor at v: level at the portal, down each flight, level between, the halls' floor past the last */
export function treadY(v: number): number {
  let y = PORTAL.floor;
  for (const f of STAIR.flights) {
    if (v <= f.v0) return y;
    if (v <= f.v1) return f.y0 + ((f.y1 - f.y0) * (v - f.v0)) / (f.v1 - f.v0);
    y = f.y1;
  }
  return y;
}

/** the portal's alcove (kept name: the views frame it as they framed the old pavilion) */
export const PAVILION = { u0: U0 - PORTAL.half, u1: U0 + PORTAL.half, v0: PORTAL.mouth, v1: PORTAL.back };

export interface Rect { u0: number; u1: number; v0: number; v1: number }
export interface Room extends Rect { name: string; floor: number; ceil: number }

/** the rooms (their inner faces: the walls stand WALL_T behind them) */
export const COLONNADE: Room = { name: 'colonnade', u0: 10, u1: 30, v0: -52.9, v1: -31.5, floor: HF, ceil: HF + 11 };
export const HALL: Room = { name: 'hall', u0: 2, u1: 38, v0: -29.5, v1: 6, floor: HF, ceil: HF + 15 };
export const GROTTO: Room = { name: 'grotto', u0: -28, u1: -4, v0: -26, v1: 2, floor: HF - 1.5, ceil: HF + 9.5 };
export const SHRINE: Room = { name: 'shrine', u0: 44, u1: 56, v0: -20, v1: -4, floor: HF + 1.2, ceil: HF + 10.5 };
export const ROOMS = [COLONNADE, HALL, GROTTO, SHRINE];

/** the waterfall's alcove in the hall's south wall, and the pool before it (its rim's outline, its water's level) */
export const FALL = { u0: U0 - 4, u1: U0 + 4, v1: HALL.v1 + 3.6, lip: HF + 12.6, width: 3.2 };
export const POOL = { u0: U0 - 8, u1: U0 + 8, v0: HALL.v1 - 8.5, v1: HALL.v1, floor: HF - 1.0, level: HF - 0.3 };

/** the ways between them: a doorway through the walls (u0..u1 across, v0..v1 along, or the other way about), its
 *  floor at each end and its head */
export interface Way extends Rect { name: string; axis: 'u' | 'v'; y0: number; y1: number; head: number }
export const WAYS: Way[] = [
  // the stair's foot through the colonnade's north wall
  { name: 'stairfoot', axis: 'v', u0: STAIR.u0, u1: STAIR.u1, v0: STAIR.foot, v1: COLONNADE.v0, y0: HF, y1: HF, head: HF + 8.4 },
  // the colonnade into the hall
  { name: 'halldoor', axis: 'v', u0: U0 - 5, u1: U0 + 5, v0: COLONNADE.v1, v1: HALL.v0, y0: HF, y1: HF, head: HF + 8.4 },
  // the hall down into the grotto (west)
  { name: 'grottoway', axis: 'u', u0: GROTTO.u1, u1: HALL.u0, v0: -16, v1: -8, y0: GROTTO.floor, y1: HALL.floor, head: HF + 6 },
  // the hall up into the shrine (east)
  { name: 'shrineway', axis: 'u', u0: HALL.u1, u1: SHRINE.u0, v0: -16, v1: -8, y0: HALL.floor, y1: SHRINE.floor, head: HF + 6.5 },
];

/** the zone's boxes (plan and heights): the rooms' (hard all round, reaching well past every wall, the shrine's niche
 *  and the waterfall's alcove behind theirs) and the tunnel's (open toward the portal: the light fading out down the
 *  gallery to the gate) */
const MARGIN = 2.5;
const ROOMS_BOX = { u0: GROTTO.u0 - WALL_T - MARGIN, u1: SHRINE.u1 + WALL_T + MARGIN, v0: COLONNADE.v0 - WALL_T - MARGIN, v1: FALL.v1 + WALL_T + 2, y0: HF - 4, y1: HF + 18 };
/** (the tunnel's from a little way in: its box is the world's axes', round the turned tunnel, and nearer the gate it
 *  would take in the ring road's dwellings beside the portal; the gallery's light fades out toward the gate over its
 *  first stretch) */
const STAIR_BOX = { u0: STAIR.u0 - 2, u1: STAIR.u1 + 2, v0: STAIR.flights[0].v0 + 12, v1: STAIR.foot + 4, y0: HF - 4, y1: PORTAL.floor + STAIR.ceil + 1, fade: 24 };
/** the land's carve: under the rooms' box (and a metre round it, so the ground's slope up out of the dug pit stays in the
 *  rock behind every face) to below the lowest floor; under the tunnel to below its floor, the trench's edges inside
 *  its walls' rock; the portal's alcove at the ring road's level */
const CARVE_ROOMS: Rect = { u0: ROOMS_BOX.u0 - 1, u1: ROOMS_BOX.u1 + 1, v0: ROOMS_BOX.v0 - 1, v1: ROOMS_BOX.v1 + 1 };
export const TRENCH = PORTAL.half - 0.8;
const CARVE_STAIR: Rect = { u0: U0 - TRENCH, u1: U0 + TRENCH, v0: PORTAL.back - 0.5, v1: COLONNADE.v0 };
const CARVE_ALCOVE: Rect = { u0: U0 - TRENCH, u1: U0 + TRENCH, v0: PORTAL.mouth - 3, v1: PORTAL.back - 0.5 };
const CARVE_DEPTH = Math.min(...ROOMS.map((r) => r.floor), POOL.floor) - 0.8;

const inRect = (r: Rect, u: number, v: number) => u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1;

/** the height the land should be carved to under the caverns at world (x, z) (or null where they leave it): below the
 *  lowest floor under the rooms, below the floor under the tunnel, the town's floor in the portal's alcove. The surface
 *  over it all is built: the temple's ring and podium, the terraces' and the courts' floors, the lane laid over the
 *  tunnel across the slab sector, the gate's own top */
export function cavernGround(x: number, z: number): number | null {
  const [u, v] = plan(x, z);
  if (inRect(CARVE_ALCOVE, u, v)) return FLOOR_Y;
  let h = Infinity;
  if (inRect(CARVE_ROOMS, u, v)) h = Math.min(h, Y(CARVE_DEPTH));
  if (inRect(CARVE_STAIR, u, v)) h = Math.min(h, Y(Math.min(treadY(v), treadY(v + 4), treadY(v - 4)) - 0.6));
  return h < Infinity ? h : null;
}

/** is a world point inside the caverns (the zone's boxes, their fades ignored)? */
export function inCaverns(x: number, y: number, z: number): boolean {
  const [u, v] = plan(x, z), h = y - BASE;
  const inBox = (b: { u0: number; u1: number; v0: number; v1: number; y0: number; y1: number }) => u >= b.u0 && u <= b.u1 && v >= b.v0 && v <= b.v1 && h >= b.y0 && h <= b.y1;
  return inBox(ROOMS_BOX) || inBox(STAIR_BOX);
}

/** how near the caverns a world point is, in plan (m; 0 inside the zone's footprint) */
export function cavernsDistance(x: number, z: number): number {
  const [u, v] = plan(x, z);
  const d = (b: Rect) => Math.hypot(Math.max(b.u0 - u, 0, u - b.u1), Math.max(b.v0 - v, 0, v - b.v1));
  return Math.min(d(ROOMS_BOX), d(STAIR_BOX));
}

/** world.wgsl's World.cave: per box four vec4s — its low corner and the open face's fade (m), its high corner and 1
 *  (used), the open face's outward normal, the land's carve under it (x0, z0, x1, z1). The shader's boxes are the world's
 *  axes': each the box round the plan's turned one (the rooms' deep under everything; the tunnel's top under the
 *  plateau's floors, its open face toward the portal) */
export function caveUniform(): [number, number, number, number][] {
  const aabb = (r: Rect) => {
    const ps = [at(r.u0, r.v0), at(r.u1, r.v0), at(r.u1, r.v1), at(r.u0, r.v1)];
    return [Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1]))];
  };
  const box = (b: typeof ROOMS_BOX, fade: number, dir: [number, number, number], c: Rect): [number, number, number, number][] => {
    const [x0, z0, x1, z1] = aabb(b), [cx0, cz0, cx1, cz1] = aabb(c);
    return [[x0, Y(b.y0), z0, fade], [x1, Y(b.y1), z1, 1], [...dir, 0], [cx0, cz0, cx1, cz1]];
  };
  return [...box(ROOMS_BOX, 0, [0, 0, 0], CARVE_ROOMS), ...box(STAIR_BOX, STAIR_BOX.fade, [-EV[0], 0, -EV[1]], CARVE_STAIR)];
}
