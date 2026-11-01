// Who can lie in the meadow: Boulder's cast, each drawn by figure.wgsl from their colour model (as Boulder's
// town/looks.ts gives it: per palette slot the lit fill, display sRGB, and its shade as a multiple), their face (the
// eyes' size and roundness, the drawn iris, the mouth), how their figure takes the light, the slots not drawn here (a
// prop of the town's) and their face at rest. pose.ts says which of them it is (tools/figure-pose.mjs --who).
type V3 = [number, number, number];
export interface Cast {
  /** their mesh under data/figure/ */
  file: string;
  model: Record<number, [V3, V3]>;
  /** the eyes larger by (x), round (y), thinner brows (z); the drawn iris (display rgb, w 1); the mouth; the shading */
  cast: number[]; iris: number[]; mouth: number[]; shading: number[];
  /** palette slots left out (up to four) */
  hide: number[];
  /** the face at rest (Boulder's cast/face.ts): smile, upper lids (-1 wide .. 1 heavy), lower lids, blush */
  smile: number; lidUp: number; lidLow: number; blush: number;
}

const COOL: V3 = [0.68, 0.7, 0.8], WHITE_SH: V3 = [0.74, 0.75, 0.85];

// Eli, the runner (town/looks.ts ELI; their mesh isn't shipped here: Boulder's town/eli_hi.bin.gz as eli.bin.gz): 0 skin, 1 the teal singlet, 2 black shorts, 3 sandy hair, 4 grey trail shoes,
// 5 socks and soles, 6 ears, 7 the red cap, 9 the flasks' water, 13 the orange vest, 14 black (straps, watch,
// sunglasses); 8 the cup and 12 its tea not here
const ELI_SKIN: [V3, V3] = [[0.94, 0.68, 0.52], [0.78, 0.68, 0.68]];
export const ELI: Cast = {
  file: 'eli.bin.gz',
  model: {
    0: ELI_SKIN, 1: [[0.16, 0.62, 0.64], COOL], 2: [[0.21, 0.22, 0.23], COOL], 3: [[0.8, 0.62, 0.38], [0.66, 0.62, 0.68]],
    4: [[0.76, 0.75, 0.74], COOL], 5: [[0.94, 0.93, 0.9], WHITE_SH], 6: ELI_SKIN, 7: [[0.8, 0.25, 0.2], COOL],
    9: [[0.45, 0.6, 0.86], COOL], 13: [[0.86, 0.38, 0.18], [0.7, 0.66, 0.76]], 14: [[0.15, 0.15, 0.16], COOL],
  },
  cast: [0.05, 0.4, 0.2, 0], iris: [0.45, 0.6, 0.72, 1], mouth: [1.2, 1.45, 1, 0.5], shading: [0.2, 0.1, 1, 1],
  hide: [8, 12], smile: 0.35, lidUp: 0.12, lidLow: 0.08, blush: 0.3,
};

// Lyra (Boulder's pipeline, people/lyra.py): early twenties, long platinum hair with a braid at each temple, gently
// pointed ears, purple-blue eyes; an ivory linen blouse tucked under a verdigris sash, wide moss trousers, gold at her
// brow and throat, barefoot. 0 skin, 1 the blouse, 2 the trousers, 3 hair (its shade a cool lilac: silver), 6 ears,
// 7 the sash, 12 gold (circlet, necklace, sun disc)
const LYRA_SKIN: [V3, V3] = [[0.97, 0.82, 0.74], [0.8, 0.68, 0.72]];
export const LYRA: Cast = {
  file: 'lyra.bin.gz',
  model: {
    0: LYRA_SKIN, 1: [[0.95, 0.92, 0.84], WHITE_SH], 2: [[0.42, 0.52, 0.34], COOL], 3: [[0.93, 0.91, 0.84], [0.7, 0.7, 0.84]],
    6: LYRA_SKIN, 7: [[0.36, 0.62, 0.56], COOL], 12: [[0.9, 0.72, 0.36], [0.72, 0.66, 0.66]],
  },
  cast: [0.12, 0.25, 0.5, 0], iris: [0.52, 0.42, 0.92, 1], mouth: [1.05, 1.15, 1, 0.3], shading: [0.25, 0.12, 1, 1],
  hide: [], smile: 0.3, lidUp: 0.08, lidLow: 0.05, blush: 0.2,
};

export const CAST: Record<string, Cast> = { eli: ELI, lyra: LYRA };
