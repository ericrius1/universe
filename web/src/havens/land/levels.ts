// The nested height levels the canyon is filled into. Boulder's terrain reads square levels from one r32float
// texture_2d_array (every layer the same pixel size), the finest holding a point winning, each handed over to the next
// coarser in its outer 15% (world.wgsl terrainHeight). Five levels (world.wgsl's TERRAIN_LEVELS), 3072 px each:
//   0  0.5 m  1536 m square, centred between the city and the temple: the promontory, every garden terrace, the stair,
//             the arms and the city's north two-thirds (the gardens' 0.5 m retaining-wall steps need it)
//   1  1 m    3 km: the whole bowl and city, the ridge to the river, the north rim, the slots' first kilometre
//   2  4 m    12 km: the slots to their ends, the river's canyon, the south canyon
//   3  16 m   49 km: the near desert and its mesas
//   4  42.7 m 131 km: out to the horizon (±65 km)
// Unlike boulder's, levels 0 and 1 are not centred on the origin (cx, cz): the terrain's level lookup must add the
// centre (uv = (xz - c + half) / (2 half), and the hand-over measured from c). GPU memory: heights 5 x 3072² x 4 B =
// 189 MB; the ground's material (fill.wgsl `info`, rgba8 every other texel) 5 x 1536² x 4 B = 47 MB; with boulder's
// r8 heightfield shadow at 2048² (21 MB) about 257 MB. The CPU's copy as boulder keeps it (u16 per texel) is 94 MB.

import { tier } from '../util/tier';

export interface HeightLevelSpec {
  /** half extent (m) */
  half: number;
  /** texels per side */
  px: number;
  /** centre (m) */
  cx: number;
  cz: number;
}

export const LEVEL_PX = tier.phone ? 2048 : 3072;

// (a phone's (util/tier.ts): 2048 px levels, 112 MB of heights not 252, the same texels where it's walked — 0.5 m over
// the promontory, its gardens and the stair's top (1 km square), 1 m over the bowl and the city (2 km) — and coarser
// beyond: 4 m to ±4 km, 16 m to ±16 km, 64 m to the horizon)
export const LEVELS: HeightLevelSpec[] = tier.phone ? [
  { half: 512, px: LEVEL_PX, cx: 0, cz: -620 },
  { half: 1024, px: LEVEL_PX, cx: 0, cz: -300 },
  { half: 4096, px: LEVEL_PX, cx: 0, cz: 0 },
  { half: 16384, px: LEVEL_PX, cx: 0, cz: 0 },
  { half: 65536, px: LEVEL_PX, cx: 0, cz: 0 },
] : [
  { half: 768, px: LEVEL_PX, cx: 0, cz: -560 },
  { half: 1536, px: LEVEL_PX, cx: 0, cz: -300 },
  { half: 6144, px: LEVEL_PX, cx: 0, cz: 0 },
  { half: 24576, px: LEVEL_PX, cx: 0, cz: 0 },
  { half: 65536, px: LEVEL_PX, cx: 0, cz: 0 },
];

/** the levels for a phone that only looks at the canyon (embed.ts: Universe's dive), never walks it: 1536 px, 0.5 m
 *  over the whole promontory and its gardens (768 m square round the temple), 2 m over the bowl and the city, 8 m to
 *  ±6 km, 32 m to ±25 km, 85 m to the horizon — 63 MB of heights, not 112 */
export const VIEW_LEVELS: HeightLevelSpec[] = [
  { half: 384, px: 1536, cx: 0, cz: -760 },
  { half: 1536, px: 1536, cx: 0, cz: -300 },
  { half: 6144, px: 1536, cx: 0, cz: 0 },
  { half: 24576, px: 1536, cx: 0, cz: 0 },
  { half: 65536, px: 1536, cx: 0, cz: 0 },
];

/** height texels per material texel (fill.wgsl `info`): 2, so the material grid is 1536² per level */
export const INFO_STEP = 2;

/** a level's texel (m) */
export function texelOf(L: HeightLevelSpec): number { return (2 * L.half) / L.px; }

/** where texel (i, j) of a level is (its centre: x, z), in exactly the f32 steps fill.wgsl takes (for a texel that
 *  isn't a power of two, the GPU's centres are a few millimetres off the true ones: the CPU's fill uses the same) */
export function texelCentre(L: HeightLevelSpec, i: number, j: number): [number, number] {
  const f = Math.fround, t = f(texelOf(L));
  return [f(f(L.cx - L.half) + f(f(i + 0.5) * t)), f(f(L.cz - L.half) + f(f(j + 0.5) * t))];
}
