// The nested height levels the canyon is filled into. Boulder's terrain reads square levels from one r32float
// texture_2d_array (every layer the same pixel size), the finest holding a point winning, each handed over to the next
// coarser in its outer 15% (world.wgsl terrainHeight). Five levels (world.wgsl's TERRAIN_LEVELS), 3072 px each, all
// centred on the star's centre (the origin):
//   0  0.5 m  1536 m square: the plateau, every garden terrace, the stair, the town to its points' outer halves (the
//             gardens' 0.5 m retaining-wall steps need it)
//   1  1 m    3 km: the whole star, its tips and its cliffs, the plain round it, the hoodoos, the east cascade
//   2  4 m    12 km: the plain's channel's first reaches, the outcrops
//   3  16 m   49 km: the far desert and its mesas
//   4  42.7 m 131 km: out to the horizon (±65 km)
// A level's centre (cx, cz) needn't be the origin: the terrain's level lookup adds it (uv = (xz - c + half) / (2 half),
// and the hand-over measured from c). GPU memory: heights 5 x 3072² x 4 B =
// 189 MB; the ground's material (fill.wgsl `info`, rgba8 every other texel) 5 x 1536² x 4 B = 47 MB; with boulder's
// r8 heightfield shadow at 2048² (21 MB) about 257 MB. The CPU's copy as boulder keeps it (u16 per texel) is 94 MB.
// A phone's (util/tier.ts) are 2048 px: the same 0.5 m over the plateau and its gardens (1 km square), 1.5 m over the
// whole star, then 4 m, 16 m and 64 m — 84 MB of heights, not 189.

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

export const LEVELS: HeightLevelSpec[] = tier.phone ? [
  { half: 512, px: LEVEL_PX, cx: 0, cz: 0 },
  { half: 1536, px: LEVEL_PX, cx: 0, cz: 0 },
  { half: 4096, px: LEVEL_PX, cx: 0, cz: 0 },
  { half: 16384, px: LEVEL_PX, cx: 0, cz: 0 },
  { half: 65536, px: LEVEL_PX, cx: 0, cz: 0 },
] : [
  { half: 768, px: LEVEL_PX, cx: 0, cz: 0 },
  { half: 1536, px: LEVEL_PX, cx: 0, cz: 0 },
  { half: 6144, px: LEVEL_PX, cx: 0, cz: 0 },
  { half: 24576, px: LEVEL_PX, cx: 0, cz: 0 },
  { half: 65536, px: LEVEL_PX, cx: 0, cz: 0 },
];

/** the levels for a phone that only looks at the land (embed.ts: Universe's dive), never walks it: 1536 px, under
 *  0.6 m over the plateau, its ring and its gardens (896 m square round the temple), 2 m over the star, 8 m to ±6 km,
 *  32 m to ±25 km, 85 m to the horizon — 47 MB of heights */
export const VIEW_LEVELS: HeightLevelSpec[] = [
  { half: 448, px: 1536, cx: 0, cz: 0 },
  { half: 1536, px: 1536, cx: 0, cz: 0 },
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
