// Iroh drawn as the show draws him, by Katara's shader (hero/hero.wgsl, its ink and paint): his colour model per palette
// slot (the lit fill and its shade, display sRGB) for each of his outfits — the travelling robe (olive green-brown, its
// bands and sash dark brown, a tan under-robe; the user's reference sheet's first panel, the default), the tea shop's
// (green, gold bands and sash, a cream under-robe) and the Fire Nation's (deep red, gold bands, maroon sash, a gold
// under-robe) and the joyful one the visitors' joy ray puts on him (raspberry, gold bands, a turquoise sash, a sunny
// under-robe, violet trousers) — the same garments recoloured; his face: small amber eyes under heavy lids, his own bushy brows (hair,
// iroh_groom.py), crow's feet and lines across the forehead, a wide smile that opens into a laugh; his skirt kept
// outside his legs as Katara's is.
import type { CastLook } from '../hero/hero';
import type { V3 } from '../hero/math';

export type IrohOutfit = 'travelling' | 'teashop' | 'fire' | 'joy';
export const OUTFITS: Record<IrohOutfit, string> = { travelling: 'Travelling robe', teashop: 'Tea shop robe', fire: 'Fire Nation robe', joy: 'Joyful robe' };

// fill, shade multiplier (per slot): 0 skin, 1 robe, 2 trousers, 3 hair, 4 boots, 5 the robe's bands, 6 ears (skin),
// 7 sash, 8 under-robe, 9 tea, 12 the cup and the teapot
const SKIN: [V3, V3] = [[0.93, 0.77, 0.61], [0.78, 0.72, 0.72]];
const COOL: V3 = [0.7, 0.71, 0.8];
const BASE: Record<number, [V3, V3]> = {
  0: SKIN, 2: [[0.29, 0.3, 0.21], COOL], 3: [[0.6, 0.6, 0.6], [0.78, 0.77, 0.84]], 4: [[0.47, 0.32, 0.22], [0.66, 0.66, 0.76]], 6: SKIN,
  9: [[0.6, 0.39, 0.14], [0.72, 0.68, 0.74]], 12: [[0.86, 0.82, 0.7], [0.72, 0.74, 0.84]],
};
const ROBES: Record<IrohOutfit, Record<number, [V3, V3]>> = {
  travelling: { 1: [[0.57, 0.53, 0.33], COOL], 5: [[0.34, 0.24, 0.16], COOL], 7: [[0.37, 0.26, 0.18], COOL], 8: [[0.78, 0.68, 0.45], COOL] },
  teashop: { 1: [[0.32, 0.47, 0.27], COOL], 2: [[0.25, 0.32, 0.2], COOL], 5: [[0.88, 0.74, 0.38], [0.74, 0.7, 0.72]], 7: [[0.86, 0.71, 0.34], [0.74, 0.7, 0.72]], 8: [[0.93, 0.9, 0.8], [0.76, 0.76, 0.84]] },
  fire: { 1: [[0.62, 0.18, 0.13], [0.66, 0.68, 0.8]], 2: [[0.33, 0.13, 0.11], COOL], 5: [[0.88, 0.72, 0.33], [0.74, 0.7, 0.72]], 7: [[0.43, 0.13, 0.11], COOL], 8: [[0.9, 0.78, 0.42], [0.74, 0.7, 0.72]] },
  // (its shades a violet's, so even his folds are glad)
  joy: { 1: [[0.74, 0.22, 0.46], [0.7, 0.62, 0.86]], 2: [[0.36, 0.22, 0.62], [0.68, 0.68, 0.88]], 5: [[0.93, 0.74, 0.3], [0.74, 0.68, 0.78]], 7: [[0.1, 0.58, 0.58], [0.66, 0.72, 0.86]], 8: [[0.98, 0.86, 0.46], [0.76, 0.7, 0.8]] },
};

export function irohLook(outfit: IrohOutfit = 'travelling'): CastLook {
  const M = { ...BASE, ...ROBES[outfit] };
  const cel: number[][] = [], shade: number[][] = [];
  for (let i = 0; i < 16; i++) {
    const m = M[i];
    cel.push(m ? [...m[0], 1] : [0, 0, 0, 0]);
    shade.push(m ? [...m[1], 1] : [0, 0, 0, 0]);
  }
  const none = Array.from({ length: 6 }, () => [0, 0, 0, 0]);
  // (the eyes much smaller than hers, almond, not round, heavy-lidded; golden amber; the mouth wide, its smile deep, a laugh open; his
  // loose robe posed far from its bind pose — seated, its occlusion baked standing would blotch the skirt — so very
  // little of it, a little more of him lit, lit or shaded as one)
  return {
    cast: [-0.3, 0, 0, 0], iris: [0.8, 0.56, 0.16, 1], mouth: [1.3, 1.4, 1, 1], shading: [0.1, 0.16, 1, 1], age: [1, 1, 1, 1],
    cel, shade, mark: none, legs: true,
  };
}
