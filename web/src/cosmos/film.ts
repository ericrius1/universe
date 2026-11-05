// The film's settings (loom/film: the film, its settings, mixFilm and filmFields, loom's render/film) for each part
// of the dive: the cosmos's own (COSMOS_FILM: as its frames have always been graded), the keepers' world past it, the
// cell's laid in under it (CELL_FILM); a host's for what it lays into the frame (Universe's gardens: Seven Havens' look)
// mixed in as the dive goes from one to the other. The renderer packs the one in force into its uniform each frame.
import type { Film } from '@ericrius1/loom/render/film';

export type { Film };
export { mixFilm, filmFields } from '@ericrius1/loom/render/film';

/** the bloom chain's levels (renderer.ts) */
export const BLOOM_LEVELS = 6;

/** the cosmos's frames, as graded before there was a shared film (c_post.wgsl's) */
export const COSMOS_FILM: Film = {
  exposure: 1, bloomShare: 0, bloomAdd: 0.012, bloomNorm: 1 / 6, bloomWeight: 1, bloomEven: 0, knee: 0, kneeLo: 1.1, kneeHi: 3.2,
  glow: 0, glowFrom: 1, halation: 0,
  warmth: 0, punch: 0, saturation: 1, saturationAfter: 1.08,
  contrast: 1.08, toe: 1, power: 1 / 2.2,
  vignette: 0.45, vignetteQ: 0, dither: 0, grain: 0.004, grainMids: 0,
  grade: 0, split: 0, rich: 0, golden: 0, dusk: 0, noon: 0, night: 0, cover: 0,
};

/** the keepers' world past the edge of the universe (levels/beyond.ts): AgX's own curve, not the cosmos's lifted one
 *  (its frames are dark round sparse lights; theirs are lit), a little punch, the glow and halation of a lens round its
 *  marbles and threads, film's grain */
export const BEYOND_FILM: Film = {
  ...COSMOS_FILM,
  exposure: 1.15, bloomShare: 0.04, bloomAdd: 0.03, glow: 0.22, glowFrom: 0.9, halation: 0.12,
  punch: 0.35, saturation: 1.05, saturationAfter: 1.06, contrast: 1.1, toe: 1, power: 1,
  vignette: 0.55, vignetteQ: 0.15, dither: 0.6, grain: 0.022, grainMids: 0.6,
};

/** the cell's frames (src/engine/renderer.ts, laid into this film), as they were graded with their own: only what's
 *  bright blooms, added; its exposure, AgX with more saturation after it, a straight contrast, its vignette and grain */
export const CELL_FILM: Film = {
  ...COSMOS_FILM,
  exposure: 0.85, bloomShare: 0, bloomAdd: 0.22, bloomEven: 1, knee: 1, kneeLo: 1.1, kneeHi: 3.2,
  saturationAfter: 1.12, contrast: 1.14, toe: 0, power: 1 / 2.2,
  vignette: 0.55, vignetteQ: 0, dither: 0, grain: 0.012, grainMids: 0,
};
