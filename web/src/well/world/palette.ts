// The colours. Taken from the register Axiom's own imagery sits in: a near-white field, hepatocyte bodies in warm
// orange, nuclei in violet, the junctional rim a pale yellow-green, the other cells cooler and bluer, and injury
// moving everything toward a desaturated red. Linear RGB, because that is what the shaders want.

export type RGB = [number, number, number];

const srgb = (hex: string): RGB => {
  const n = parseInt(hex.replace('#', ''), 16);
  const f = (x: number) => {
    const c = x / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
};

export const PAL = {
  paper: srgb('#fbfbfb'),
  ink: srgb('#2e2d2c'),
  accent: srgb('#afb3f1'),

  /** the cell body, healthy */
  cyto: srgb('#f3a67c'),
  cytoDeep: srgb('#e8794b'),
  /** the junctional rim between cells */
  rim: srgb('#f2eda4'),
  /** nucleus */
  nucleus: srgb('#9b8ad4'),
  nucleolus: srgb('#7a66c4'),
  /** mitochondria, polarised */
  mito: srgb('#f0784a'),
  /** mitochondria, depolarised: the dye has washed out */
  mitoDead: srgb('#b9a9a4'),
  /** endoplasmic reticulum */
  er: srgb('#f5c79a'),
  golgi: srgb('#e9a9c6'),
  lysosome: srgb('#c79ae0'),
  lamellar: srgb('#dcd0f2'),
  peroxisome: srgb('#a8d8c8'),
  lipid: srgb('#f7e08a'),
  glycogen: srgb('#f0cfae'),
  /** bile canaliculus, filled */
  bile: srgb('#8ee6b8'),
  bileStuck: srgb('#d8c06a'),
  /** the other cells in the well */
  feeder: srgb('#9fb6e6'),
  feederDeep: srgb('#7a93d4'),
  /** the collagen floor */
  floor: srgb('#efe9e4'),
  /** injury */
  harm: srgb('#d4524a'),
  dead: srgb('#a9a4ae'),
  dna: srgb('#6ee8e0'),

  /** the background of the bright register, and the fog it fades to */
  air: srgb('#fdfcfb'),
  airWarm: srgb('#fdf4ec'),
  airCool: srgb('#f2f4fd'),

  /** the plate */
  plastic: srgb('#f4f4f6'),
  plasticEdge: srgb('#dcdce2'),
} as const;

/** the channel each fluorescence stain shows, for the stain register */
export const CHANNELS = [
  { key: 'hoechst', name: 'Hoechst', shows: 'nuclei', color: srgb('#6a8cff') },
  { key: 'tmrm', name: 'TMRM', shows: 'mitochondrial potential', color: srgb('#ff8a3d') },
  { key: 'lipid', name: 'BODIPY', shows: 'neutral lipid', color: srgb('#8dff6a') },
  { key: 'pld', name: 'LipidTOX PLD', shows: 'phospholipidosis', color: srgb('#ff5ccd') },
  { key: 'cdf', name: 'CDF', shows: 'canalicular efflux', color: srgb('#4dffc3') },
  { key: 'rox', name: 'CellROX', shows: 'oxidative stress', color: srgb('#ffe14d') },
  { key: 'pi', name: 'PI', shows: 'dead cells', color: srgb('#ff4d6a') },
] as const;

export type ChannelKey = (typeof CHANNELS)[number]['key'];
