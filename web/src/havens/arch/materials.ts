// What each material of the builders' (types.ts MAT) is made of, in arch.wgsl's terms: its colour (from the art
// bible's palette), the painted texture it's drawn with (one layer of the arch's texture array: public/assets/tex,
// 1024² with mips) and that texture's size on the surface (m: it tiles at its real size), whether the texture's own
// colours show or only its detail under the base colour, how rough and how metal it is, how much the painted wander
// moves it, how its uv are mapped (by the metre; a designed panel or frieze fitted whole to each face; striped cloth;
// the tiles' patterns and the lattice doors, drawn in the shader from a palette, PALETTES; cut blocks), the light it
// gives when it glows at night (windows, doorways, lanterns), and its painted detail (arch.wgsl's: the texture's light
// and dark as relief, cut blocks' joints, the wear of the years, the plaster's own marks). The texture sizes all divide
// PERIOD, so a face's uv can be moved back by whole periods (chunks.ts) without a seam.
import { MAT } from './types';

/** the texture array's layers, in order (public/assets/tex/<name>.webp) */
export const TEXTURES = [
  'plaster_terracotta', 'cream_ashlar', 'paving_slabs', 'gold_leaf', 'dome_tiles', 'ornament_panel', 'frieze_band',
  'weathered_wood', 'pool_mosaic', 'garden_grass', 'sandstone_strata', 'canyon_floor',
] as const;
type Tex = (typeof TEXTURES)[number];

/** how a material's uv become texture coordinates: by the metre; a designed panel or a frieze band fitted whole to each
 *  face; striped cloth; a window pane (each flat face fitted to 0..1 for its glazing bars and its light); and the
 *  shader's own patterns (arch.wgsl): a tile field (whole tiles fitted to each face), a tile band and a tile border
 *  (one band, or a whole number, along each face's longer side, whole square motifs along it), a lattice door (columns
 *  from its middle, whole ones to its edges, y from the boss); and cut stone in whole blocks (x in blocks along each
 *  face's longer side, `blocks` m long along a band, courses half that up a tall face; y 0..1 across it: arch.wgsl
 *  draws the joints and wears the arrises) */
export const MAP = { METRES: 0, PANEL: 1, FRIEZE: 2, STRIPES: 3, PANE: 4, TILE: 5, BAND: 6, BORDER: 7, LATTICE: 8, BLOCKS: 9 } as const;

/** every texture size here divides it (m): uv moved back by whole periods keep their pattern */
export const PERIOD = 24;
/** the frieze band's picture: width over height */
export const FRIEZE_ASPECT = 2048 / 870;
/** a lattice door's column (m) at the least (wider doors' grow to keep about eleven across), and the height of the
 *  boss where its leaves meet on a door of a house's height (m, at most): arch.wgsl's LATTICE_PITCH is about the
 *  first */
export const LATTICE_PITCH = 0.27;
export const LATTICE_BOSS = 1.15;

export interface Material {
  /** its colour (sRGB): the texture's own colours are multiplied by it, or it takes the texture's detail */
  base: string;
  tex: Tex | null;
  /** the texture's size on the surface (m); a panel's or a frieze band's height to aim for when fitted to a face */
  size: number;
  /** 1: the texture's own colours; 0: the base colour with the texture's light and dark */
  own: number;
  /** how strongly the texture shows (0 flat .. 1 all of it) */
  detail: number;
  rough: number;
  metal: number;
  /** the specular reflectance of a dielectric (glaze, glass ~0.05; stone 0.04) */
  f0: number;
  /** how far the painted wander moves its colour */
  wander: number;
  map: number;
  /** the light it gives when it glows (sRGB, at full glow), and how much of its own colour shows in it (0 the light's
   *  colour times the tint: a window; 1 the material's colour lit through: paper, cloth) */
  glow: string;
  glowOwn: number;
  /** its painted detail (arch.wgsl's), each 0 for none: `relief` how deep its texture's light and dark read as relief
   *  (1: a cut joint's soft bevel, a centimetre or two of it); `blocks` a cut block's length along a band (m: the
   *  BLOCKS map's, courses half that up a tall face); `wear` how much of the years' wear it takes (grime low and in
   *  the creases, streaks, dust on what faces up, the sun's fading); `plaster` the plaster's own marks (the dado, the
   *  trowel's strokes, patches made good, hairline cracks) */
  relief: number;
  blocks: number;
  wear: number;
  plaster: number;
}

const m = (o: Partial<Material> & Pick<Material, 'base'>): Material => ({
  tex: null, size: 3, own: 1, detail: 1, rough: 0.8, metal: 0, f0: 0.04, wander: 1, map: MAP.METRES, glow: '#000000', glowOwn: 0,
  relief: 0, blocks: 0, wear: 0, plaster: 0, ...o,
});

const WARM = '#FF9F45';

export const MATERIALS: Material[] = [];
MATERIALS[MAT.PLASTER] = m({ base: '#FFFFFF', tex: 'plaster_terracotta', size: 4, detail: 0.85, rough: 0.85, relief: 0.5, wear: 1, plaster: 1 });
MATERIALS[MAT.PLASTER_WARM] = m({ base: '#D9733F', tex: 'plaster_terracotta', size: 4, own: 0, detail: 0.8, rough: 0.85, relief: 0.5, wear: 1, plaster: 1 });
MATERIALS[MAT.ASHLAR] = m({ base: '#FFFFFF', tex: 'cream_ashlar', size: 2.4, detail: 0.9, rough: 0.8, wander: 0.7, relief: 1, wear: 0.8 });
MATERIALS[MAT.CREAM] = m({ base: '#E8C98A', tex: 'plaster_terracotta', size: 3, own: 0, detail: 0.35, rough: 0.7, wander: 0.6, map: MAP.BLOCKS, blocks: 1.2, relief: 0.4, wear: 0.7 });
MATERIALS[MAT.PAVING] = m({ base: '#F4E6D0', tex: 'paving_slabs', size: 3, detail: 0.9, rough: 0.85, wander: 0.8, relief: 0.8, wear: 0.2 });
MATERIALS[MAT.GOLD] = m({ base: '#FFFFFF', tex: 'gold_leaf', size: 2, detail: 0.7, rough: 0.32, metal: 0.75, wander: 0.4, wear: 0.15 });
MATERIALS[MAT.DOME] = m({ base: '#FFFFFF', tex: 'dome_tiles', size: 1.5, detail: 0.9, rough: 0.2, f0: 0.05, wander: 0.5, relief: 0.5, wear: 0.25 });
MATERIALS[MAT.LAVENDER] = m({ base: '#FFFFFF', tex: 'ornament_panel', size: 2.4, rough: 0.5, map: MAP.PANEL, wander: 0.4, glow: '#E6D2FF', glowOwn: 1, relief: 0.35, wear: 0.4 });
MATERIALS[MAT.TEAL] = m({ base: '#FFFFFF', tex: 'frieze_band', size: 1.2, rough: 0.55, map: MAP.FRIEZE, wander: 0.4, relief: 0.35, wear: 0.4 });
MATERIALS[MAT.RED] = m({ base: '#B5432C', tex: 'plaster_terracotta', size: 3, own: 0, detail: 0.55, rough: 0.6, relief: 0.4, wear: 0.8, plaster: 0.5 });
MATERIALS[MAT.WOOD] = m({ base: '#FFFFFF', tex: 'weathered_wood', size: 2, detail: 0.85, rough: 0.75, relief: 0.6, wear: 0.6 });
MATERIALS[MAT.CLOTH] = m({ base: '#EADCC0', size: 0.6, rough: 0.9, map: MAP.STRIPES, wander: 0.5, glow: WARM, glowOwn: 1 });
MATERIALS[MAT.SOIL] = m({ base: '#5E3A24', tex: 'canyon_floor', size: 3, own: 0, detail: 0.6, rough: 0.95, wander: 0.6, relief: 0.5 });
// (the lawn the bible's green with the grass texture's light and dark: past the flora's own grass, and under it)
MATERIALS[MAT.LAWN] = m({ base: '#7DAA4A', tex: 'garden_grass', size: 3, own: 0, detail: 0.45, rough: 0.95, wander: 0.6 });
MATERIALS[MAT.POOL] = m({ base: '#FFFFFF', tex: 'pool_mosaic', size: 2, detail: 0.9, rough: 0.45, f0: 0.04, wander: 0.3, relief: 0.4 });
MATERIALS[MAT.WINDOW] = m({ base: '#141A24', rough: 0.08, f0: 0.05, wander: 0.2, map: MAP.PANE, glow: WARM });
MATERIALS[MAT.ROCK] = m({ base: '#FFFFFF', tex: 'sandstone_strata', size: 12, detail: 0.9, rough: 0.9, relief: 1.2, wear: 0.6 });
MATERIALS[MAT.INTERIOR] = m({ base: '#1C120D', rough: 0.9, wander: 0.3, glow: '#FF9850' });
// the tiles: glazed (smooth, a dielectric's sheen), their colours the palette's (base white), `size` a tile's or a band's
// height to fit whole to each face; the lattice door's wood (its texture `size` in lattice columns), its gold the palette's
MATERIALS[MAT.TILE] = m({ base: '#FFFFFF', size: 0.46, rough: 0.2, f0: 0.05, wander: 0.3, map: MAP.TILE, wear: 0.35 });
MATERIALS[MAT.TILE_BAND] = m({ base: '#FFFFFF', size: 0.5, rough: 0.2, f0: 0.05, wander: 0.3, map: MAP.BAND, wear: 0.35 });
MATERIALS[MAT.TILE_BORDER] = m({ base: '#FFFFFF', size: 0.3, rough: 0.2, f0: 0.05, wander: 0.3, map: MAP.BORDER, wear: 0.35 });
MATERIALS[MAT.LATTICE] = m({ base: '#4A2716', tex: 'weathered_wood', size: 5, own: 0, detail: 0.7, rough: 0.7, wander: 0.3, map: MAP.LATTICE, wear: 0.3 });

/** the tiles' palettes (types.ts TILE_PAL), five colours each (sRGB): the ground (the crosses, a border's triangles),
 *  two field colours (the stars by turns, a band's stars and its ground), the ink of the lines, the gold (rosettes, an
 *  interlace's strap, a lattice's metal) */
export const PALETTES: string[][] = [
  // the grand hall: teal and terracotta on cream, as its frieze is
  ['#EAD5AA', '#17827C', '#B0452A', '#2A1822', '#DDA53C'],
  // the palace: turquoise and cobalt on cream
  ['#EEE0C2', '#2FA8A2', '#1F3F8A', '#1E1630', '#E2AC44'],
  // a rich house: cream and teal on terracotta
  ['#BF5E38', '#EBD8B0', '#18736F', '#2A1822', '#DDA53C'],
  // the temple: lavender and teal on cream, gold
  ['#F0E2C4', '#8F7CC4', '#238A84', '#2A1A38', '#E3B04A'],
  // the fountain: turquoise and cobalt on white
  ['#F2EAD8', '#2AAAB0', '#1B4796', '#132650', '#DDA53C'],
  // a rich house in blue: cobalt and terracotta on cream
  ['#ECDAB4', '#27498F', '#B4492C', '#22182A', '#DDA53C'],
];

// the caverns (caverns/): dark teal stone in big cut blocks (the ashlar's light and dark under the teal), paler trims in
// smaller ones, teal paving, the grotto's raw rock; the crystals and the glowing water are arch.wgsl's own glows (their
// colours here are what the debug views show)
MATERIALS[MAT.CAVE] = m({ base: '#2A6A60', tex: 'cream_ashlar', size: 4.8, own: 0, detail: 0.8, rough: 0.8, wander: 0.6, relief: 1, wear: 0.8 });
MATERIALS[MAT.CAVE_TRIM] = m({ base: '#3C8476', tex: 'cream_ashlar', size: 2.4, own: 0, detail: 0.65, rough: 0.7, wander: 0.4, relief: 1, wear: 0.7 });
MATERIALS[MAT.CAVE_FLOOR] = m({ base: '#2B5F57', tex: 'paving_slabs', size: 3, own: 0, detail: 0.75, rough: 0.6, wander: 0.5, relief: 0.8, wear: 0.2 });
MATERIALS[MAT.CRYSTAL] = m({ base: '#7DF5C8', rough: 0.2, wander: 0 });
MATERIALS[MAT.GLOWATER] = m({ base: '#3FE09A', rough: 0.1, wander: 0 });
MATERIALS[MAT.CAVE_ROCK] = m({ base: '#22564C', tex: 'sandstone_strata', size: 12, own: 0, detail: 0.85, rough: 0.9, wander: 0.8, relief: 1, wear: 0.5 });

// (white under the plaster's light and dark, faint: the vertex tint is the colour — a teal pillar, a pink blanket, a
// book's spine, a glazed jug)
MATERIALS[MAT.PAINT] = m({ base: '#FFFFFF', tex: 'plaster_terracotta', size: 1.5, own: 0, detail: 0.3, rough: 0.62, wander: 0.25, glow: '#FFB070', glowOwn: 1 });

/** an sRGB hex colour, linear */
export function linear(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  const c = (x: number) => { const s = x / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return [c((v >> 16) & 255), c((v >> 8) & 255), c(v & 255)];
}

/** the palettes as arch.wgsl's ArchU.pal takes them (linear, five rows each) */
export function paletteRows(): [number, number, number, number][] {
  return PALETTES.flatMap((p) => p.map((h) => [...linear(h), 0] as [number, number, number, number]));
}

/** the table as arch.wgsl's ArchU.mats takes it */
export function materialRows() {
  return MATERIALS.map((x) => ({
    base: [...linear(x.base), x.rough],
    tex: [x.tex ? TEXTURES.indexOf(x.tex) : -1, x.size, x.own, x.detail],
    look: [x.metal, x.f0, x.wander, x.map],
    glow: [...linear(x.glow), x.glowOwn],
    paint: [x.relief, x.blocks, x.wear, x.plaster],
  }));
}
