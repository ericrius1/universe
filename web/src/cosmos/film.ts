// The film's settings (shaders/film.wgsl), by name: the cosmos's own (COSMOS_FILM: as its frames have always been
// graded), a host's for what it lays into the frame (Universe's gardens: Seven Havens' look), and the mix of the two
// as the dive goes from one to the other (mixFilm). The renderer packs the one in force into its uniform each frame.

export interface Film {
  /** exposure; bloom's share mixed in, bloom added, bloom's normaliser (1 / the chain's summed level weights) */
  exposure: number; bloomShare: number; bloomAdd: number; bloomNorm: number;
  /** the glow on what's brighter than its knee (film units), film's red halation round highlights */
  glow: number; glowFrom: number; halation: number;
  /** white balance (+ warm), AgX's punch (0 base .. 1 punchy), saturation in the look and after it */
  warmth: number; punch: number; saturation: number; saturationAfter: number;
  /** contrast round mid-grey and its toe (0 straight, 1 soft); the screen's power (1/2.2, or 1: AgX's own curve) */
  contrast: number; toe: number; power: number;
  /** vignettes (round, quadratic), the fixed dither (255ths), grain */
  vignette: number; vignetteQ: number; dither: number; grain: number;
  /** the time-of-day grade: strength, the warm-cool split, the reds' richness; where the sun is (0..1 each: golden hour,
   *  dusk, noon, night) and the cloud cover */
  grade: number; split: number; rich: number; golden: number; dusk: number; noon: number; night: number; cover: number;
}

/** the cosmos's frames, as graded before there was a shared film (c_post.wgsl's) */
export const COSMOS_FILM: Film = {
  exposure: 1, bloomShare: 0, bloomAdd: 0.012, bloomNorm: 1 / 6,
  glow: 0, glowFrom: 1, halation: 0,
  warmth: 0, punch: 0, saturation: 1, saturationAfter: 1.08,
  contrast: 1.08, toe: 1, power: 1 / 2.2,
  vignette: 0.45, vignetteQ: 0, dither: 0, grain: 0.004,
  grade: 0, split: 0, rich: 0, golden: 0, dusk: 0, noon: 0, night: 0, cover: 0,
};

/** a's settings toward b's by t (0..1) */
export function mixFilm(a: Film, b: Film, t: number): Film {
  const o = { ...a };
  for (const k of Object.keys(a) as (keyof Film)[]) o[k] = a[k] + (b[k] - a[k]) * t;
  return o;
}

/** the film uniform's fields (film.wgsl FilmU) for these settings, `alpha` and the target's kind */
export function filmFields(f: Film, alpha: number, encode: boolean, disc: boolean) {
  return {
    a: [f.exposure, f.bloomShare, f.bloomAdd, f.bloomNorm], glow: [f.glow, f.glowFrom, f.halation, 0],
    look: [f.warmth, f.punch, f.saturation, f.saturationAfter], tone: [f.contrast, f.toe, f.power, f.grain],
    vig: [f.vignette, f.vignetteQ, f.dither, 0], grade: [f.grade, f.split, f.rich, f.night],
    sun: [f.golden, f.dusk, f.noon, f.cover], out: [alpha, encode ? 1 : 0, disc ? 1 : 0, 0],
  };
}
