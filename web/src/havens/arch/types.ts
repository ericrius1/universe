// What a built thing hands the game: its mesh (in world metres, with a material per vertex), the boxes, floors and stairs
// you walk on and bump into (boulder's HouseCollision, per structure, with its own plan -> world map), the lights it
// carries at night, the water it holds and the beds its plants grow in. The city, the temple and its gardens all build
// these with ArchBuilder (builder.ts); the arch renderer draws them, the collision set walks them, the flora and the
// water read their beds and pools.
import type { V2 } from '../world/layout';

export type V3 = [number, number, number];

/** materials (arch.wgsl keeps their colours, textures and roughness in the same order) */
export const MAT = {
  PLASTER: 0,        // terracotta lime plaster (city walls, houses)
  PLASTER_WARM: 1,   // the orange plaster of the richer houses
  ASHLAR: 2,         // cut cream sandstone blocks (trims, caps, the temple's base)
  CREAM: 3,          // smooth cream stone (cornices, copings, columns' capitals)
  PAVING: 4,         // plaza and terrace paving
  GOLD: 5,           // gold leaf (the petals, the needle, ornament)
  DOME: 6,           // glazed blue dome tiles
  LAVENDER: 7,       // lavender panels (ref 1)
  TEAL: 8,           // teal frieze bands (ref 1)
  RED: 9,            // the deep red of the pillars (ref 1)
  WOOD: 10,          // doors, beams, stalls
  CLOTH: 11,         // awnings and banners (striped in the shader)
  SOIL: 12,          // planting beds' earth
  LAWN: 13,          // the gardens' lawns (the flora draws the grass over it)
  POOL: 14,          // pool and channel floors (mosaic) — the water surface is drawn by the water
  WINDOW: 15,        // dark glazing / openings; glows at night by the vertex's glow
  ROCK: 16,          // raw sandstone (cut faces of the mesa, the cliff dwellings' walls)
  INTERIOR: 17,      // the dim inside of an opening (doorways, the colonnade's depth)
  // glazed tile (zellige), drawn in the shader from a palette (TILE_PAL, carried in the glow byte: they never glow)
  TILE: 18,          // a field of eight-point stars and crosses, whole tiles fitted to each face (dados, spandrels)
  TILE_BAND: 19,     // a band of interlaced eight-point stars along each face (friezes, a basin's rim)
  TILE_BORDER: 20,   // a border of diamonds and chevrons along each face (a panel's frame, step risers, thresholds)
  LATTICE: 21,       // double doors: a gold lattice of bars, diamonds and chevrons over dark wood, a boss where they meet
  CAVE: 22,          // the caverns' dark teal stone blocks (caverns/: walls, ceilings)
  CAVE_TRIM: 23,     // their pillars, lintels, plinths and frames: a paler teal in smaller blocks
  CAVE_FLOOR: 24,    // their paving
  CRYSTAL: 25,       // the caverns' crystals: lit from within (arch.wgsl's own glow, day and night)
  GLOWATER: 26,      // the glowing green water: the waterfall's sheet (streaks falling) and its pool (rings)
  CAVE_ROCK: 27,     // the grotto's raw rock and the waterfall's wet alcove
  PAINT: 28,         // painted wood and plaster, cloth, glaze: the tint is its colour (the walk-in room's furnishings)
} as const;
export type Mat = (typeof MAT)[keyof typeof MAT];

/** the tiles' palettes (materials.ts PALETTES: the ground, two field colours, the ink of the lines, the gold) */
export const TILE_PAL = { HALL: 0, PALACE: 1, HOUSE: 2, TEMPLE: 3, FOUNTAIN: 4, HOUSE_BLUE: 5 } as const;
/** the materials whose glow byte carries a palette instead (arch.wgsl draws them from it) */
export const isTiled = (m: number) => m >= MAT.TILE && m <= MAT.LATTICE;

/** a mesh in world metres: per vertex a position, a normal, uv in metres along the surface (textures tile at their
 *  physical size), a material, a tint (rgb multipliers ×128: 128 is 1.0), an ambient term (0..255) and a night glow
 *  (0..255: windows, lanterns; on the tiles and lattice doors their palette); triangles by index, counter-clockwise
 *  from outside */
export interface ArchMesh {
  pos: Float32Array;
  nrm: Float32Array;
  uv: Float32Array;
  mat: Uint8Array;
  tint: Uint8Array;
  ao: Uint8Array;
  glow: Uint8Array;
  idx: Uint32Array;
  /** world bounds [min, max] */
  bounds: [V3, V3];
  /** who made each triangle (ArchBuilder.owner): an index into `owners` per triangle ('' for no one's; nested owners
   *  'hall/roof'). What geo-check names a fault by and checks against the world's claims; the bake leaves it behind */
  owner?: Uint16Array;
  owners?: string[];
}

/** boulder's HouseCollision (house/collider.ts), in the structure's own plan units (metres here):
 *  solids [x0, y0, x1, y1, z0, z1] (z = height above the plan's base), floors [x0, y0, x1, y1, h, open?],
 *  stairs [x0, y0, x1, y1, base, rise, axis (0 x / 1 y), sign], doors [x0, y0, x1, y1, h] */
export interface Collision { solids: number[][]; floors: number[][]; stairs: number[][]; doors: number[][] }

/** one structure's collision and where it stands: plan (x, y) -> world (x, z) by a yaw about its origin, plan height h
 *  -> world y = base + h (planToWorld for HouseCollider: column-major 4x4) */
export interface StructureCollider {
  name: string; collision: Collision; origin: V3; yaw: number;
  /** its storeys (HouseCollider's levels: a floor's plan height and its ceiling's height over it), for a structure
   *  that's a room and not open ground — no flight in it, jumps stopped at its ceiling, the camera kept under it */
  levels?: Record<string, { height: number; ceiling: number }>;
}

/** a light it carries (lantern, window, brazier): world position, colour (linear), strength (candela), when it's lit
 *  ('night': from dusk to dawn, 'always', 'fire': only once lit by firebending, 'under': underground — lit day and
 *  night and held as the night holds the lamps, since no daylight reaches it: the caverns' crystals) */
export interface LightSpot { p: V3; color: V3; candela: number; when: 'night' | 'always' | 'fire' | 'under'; radius?: number }

/** water it holds: a pool (polygon at a level), a channel (a polyline at a level, its width), a cascade (a sheet falling
 *  from an edge [a, b] at `top` to `bottom`) */
export type WaterBody =
  | { kind: 'pool'; poly: V2[]; level: number; depth: number }
  | { kind: 'channel'; path: V2[]; level: number; width: number; depth: number }
  | { kind: 'cascade'; a: V2; b: V2; top: number; bottom: number };

/** a bed the flora plants: a polygon at a height, what grows there, how dense (0..1) */
export interface GardenBed {
  poly: V2[];
  y: number;
  kind: 'lawn' | 'flowers' | 'shrubs' | 'trees' | 'cypress' | 'blossom' | 'vines' | 'lotus' | 'palms' | 'scrub';
  density: number;
  /** flower colour family for 'flowers' */
  palette?: 'pink' | 'white' | 'gold' | 'purple' | 'mixed';
}

/** a small part drawn instanced (parts/protos.ts): which (a PROTOS name: 'merlon-stepped', 'lantern-wall'), where its
 *  origin stands (world), its yaw, its size (scale over its default; positive), its tint (rgb multipliers, 1 is 1.0). It
 *  isn't in the mesh, so geo-check doesn't see it: placed to the builder rules by hand (a merlon's foot on its wall's
 *  top, a bracket's back on its wall); its lamp's light is added to the part's lights by the world, not the builder */
export interface PartPlacement {
  proto: string; p: V3; yaw?: number; scale?: number; tint?: V3;
  /** who placed it (ArchBuilder.owner: what the claims and budgets go by) */
  owner?: string;
}

/** everything one builder hands over */
export interface ArchPart {
  name: string;
  mesh: ArchMesh;
  /** the mesh cut into regions of the ground to bake side by side (split.ts; world/build.worker.ts cuts the big parts),
   *  every triangle in one of them: `mesh` then holds none */
  regions?: ArchMesh[];
  colliders: StructureCollider[];
  lights: LightSpot[];
  water: WaterBody[];
  beds: GardenBed[];
  /** its small repeated parts, drawn instanced (the world makes the prototypes they name once) */
  instances?: PartPlacement[];
}
