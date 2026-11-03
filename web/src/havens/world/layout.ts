// Where everything is: the one shared plan of the Haven that the land, the city, the temple and its gardens, the water
// and the flora all build from, so they meet. Metres; x east, y up, z south (boulder's frame); the origin is the
// centre of the city's plaza, on the canyon floor. The sun sets in the west (-x) and the aurora hangs in the north (-z),
// so from the city the temple stands between you and the aurora.
//
//              N (-z)       plateau rim, hoodoos, crystal fields (y ≈ RIM_Y)
//        ╭───────── the Haven promontory (its top at MESA.topY) ─────────╮
//        │          the temple at TEMPLE.centre; the gardens step down    │
//        │          its east, west and south flanks (GARDENS)             │
//        ╰─────────────── the grand stair (STAIR) down its south face ────╯
//          canyon floor (y ≈ 0)
//        ╭──────────── the walled city in the basin (BASIN, WALL) ────────╮
//        │   plaza at the origin, grand hall on its north side            │
//        ╰────────────────── south gate (GATE) ───────────────────────────╯
//          the river meanders west to east south of the city (RIVER)
//              S (+z)

export type V2 = [number, number];

/** the plateau the canyon is cut into (m above the canyon floor) */
export const RIM_Y = 175;

/** the canyon floor round the city: flat, a little sand drifted against the walls */
export const FLOOR_Y = 0;

/** the basin the city fills: an ellipse of flat floor, cliffs rising beyond it */
export const BASIN = { cx: 0, cz: 40, rx: 640, rz: 470 };

/** the city wall: an ellipse just inside the basin floor's edge (centre, radii, height, thickness) */
export const WALL = { cx: 0, cz: 60, rx: 560, rz: 380, height: 16, thick: 4.5 };

/** the south gate in the wall, between two domed towers (its centre on the wall, the way it faces: +z) */
export const GATE = { x: 0, z: WALL.cz + WALL.rz, width: 14, towerR: 7.5, towerH: 34 };

/** the plaza at the city's heart (circle) and the main avenue from the gate to the grand stair */
export const PLAZA = { x: 0, z: 0, r: 72 };
export const AVENUE = { x: 0, z0: GATE.z, z1: -300, width: 22 };

/** the grand hall (ref 1) on the plaza's north side, facing south onto it */
export const GRAND_HALL = { x: 0, z: -118, width: 64, depth: 46, height: 38 };

/** the palace with its X-braced lattice spire (ref 2), east of the plaza on its own court */
export const PALACE = { x: 230, z: -40, width: 90, depth: 70, height: 30, spireH: 95 };

/** the market (ref 2): stalls and awnings filling the streets west of the plaza */
export const MARKET = { x: -190, z: 30, rx: 120, rz: 90 };

/** the Haven promontory: a mesa jutting south from the north rim into the canyon. Its top is a rounded tongue, flat
 *  at topY, whose south tip ends at tipZ; its flanks are cliffs and, where the gardens are, terraces. */
export const MESA = { cx: 0, cz: -820, topY: 172, halfWidth: 330, tipZ: -470, neckZ: -1200 };

/** the temple on the promontory's top (its centre; the colonnaded base's radius; the petals; the needle) */
export const TEMPLE = { x: 0, z: -760, y: MESA.topY, baseR: 64, baseH: 26, petals: 6, petalH: 58, needleH: 128 };

/** the grand stair from the city's avenue up the promontory's south face: flights between landings, switching back
 *  (each [x, z, y] a landing's centre; flights run straight between consecutive landings) */
export const STAIR = {
  width: 14,
  landings: [
    [0, -300, 0], [0, -392, 22], [-52, -420, 40], [-52, -468, 62], [0, -490, 84], [52, -520, 106], [52, -560, 128],
    [0, -588, 150], [0, -640, MESA.topY],
  ] as [number, number, number][],
};

/** The terraced gardens: wedges radiating from the temple's base out over the promontory's edge and down its flanks,
 *  like the sepals of the lotus. Each wedge spans [a0, a1] (radians, 0 = +x/east, π/2 = +z/south) between radii r0
 *  and r1 from the temple centre, and steps down in `steps` terraces from the top (MESA.topY) by `drop` metres each;
 *  between the wedges run the ramps (raised walkways) down to the edge. The south wedge is split by the grand stair. */
export interface GardenWedge { a0: number; a1: number; r0: number; r1: number; steps: number; drop: number }
const deg = Math.PI / 180;
export const GARDENS: { wedges: GardenWedge[]; rampWidth: number; wallCap: number } = {
  rampWidth: 6,
  wallCap: 0.55,
  wedges: [
    { a0: -10 * deg, a1: 26 * deg, r0: 92, r1: 330, steps: 7, drop: 7.5 },     // east-southeast, down the east flank
    { a0: 34 * deg, a1: 78 * deg, r0: 92, r1: 330, steps: 8, drop: 8.0 },      // south-southeast, over the tip
    { a0: 102 * deg, a1: 146 * deg, r0: 92, r1: 330, steps: 8, drop: 8.0 },    // south-southwest, over the tip
    { a0: 154 * deg, a1: 190 * deg, r0: 92, r1: 330, steps: 7, drop: 7.5 },    // west-southwest, down the west flank
    { a0: 200 * deg, a1: 236 * deg, r0: 92, r1: 200, steps: 4, drop: 5.0 },    // northwest, on the top
    { a0: 304 * deg, a1: 340 * deg, r0: 92, r1: 200, steps: 4, drop: 5.0 },    // northeast, on the top
  ],
};

/** the river: a polyline (x, z) along the canyon floor, west to east, south of the city; its half-width (m) */
export const RIVER = {
  halfWidth: 16,
  path: [
    [-4200, 900], [-3000, 1150], [-2100, 820], [-1300, 980], [-700, 760], [0, 820], [650, 690], [1250, 980], [2000, 760],
    [2900, 1060], [4200, 880],
  ] as V2[],
};

/** the side canyons that open off the basin (centrelines from the basin outward; half-widths of floor) for flying
 *  through: slots to the west and east, a wide one south past the river */
export const SIDE_CANYONS: { path: V2[]; halfWidth: number; depth: number }[] = [
  { path: [[-600, 120], [-1100, 60], [-1600, 240], [-2300, 140], [-3200, 380]], halfWidth: 38, depth: RIM_Y },
  { path: [[620, 100], [1150, -80], [1700, 60], [2400, -160], [3300, 40]], halfWidth: 30, depth: RIM_Y },
  { path: [[0, 520], [-120, 1100], [220, 1700], [-60, 2500], [300, 3400]], halfWidth: 120, depth: RIM_Y },
];

/** where you begin: on the plaza, facing north (yaw 0 looks toward -z in weft and boulder) at the grand hall and the promontory beyond it */
export const SPAWN = { x: 0, z: 38, yaw: 0, as: 'katara' as const };
