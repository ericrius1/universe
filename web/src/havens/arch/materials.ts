// What each material of the builders' (types.ts MAT) is made of, in arch.wgsl's terms: its colour (from the art
// bible's palette), the painted texture it's drawn with (one layer of the arch's texture array: public/assets/tex,
// 1024² with mips) and that texture's size on the surface (m: it tiles at its real size), whether the texture's own
// colours show or only its detail under the base colour, how rough and how metal it is, how much the painted wander
// moves it, how its uv are mapped (by the metre; a designed panel or frieze fitted whole to each face; striped cloth),
// and the light it gives when it glows at night (windows, doorways, lanterns). The texture sizes all divide PERIOD, so
// a face's uv can be moved back by whole periods (chunks.ts) without a seam.
import { MAT } from './types';

/** the texture array's layers, in order (public/assets/tex/<name>.webp) */
export const TEXTURES = [
  'plaster_terracotta', 'cream_ashlar', 'paving_slabs', 'gold_leaf', 'dome_tiles', 'ornament_panel', 'frieze_band',
  'weathered_wood', 'pool_mosaic', 'garden_grass', 'sandstone_strata', 'canyon_floor',
] as const;
type Tex = (typeof TEXTURES)[number];

/** how a material's uv become texture coordinates: by the metre; a designed panel or a frieze band fitted whole to each
 *  face; striped cloth; a window pane (each flat face fitted to 0..1 for its glazing bars and its light) */
export const MAP = { METRES: 0, PANEL: 1, FRIEZE: 2, STRIPES: 3, PANE: 4 } as const;

/** every texture size here divides it (m): uv moved back by whole periods keep their pattern */
export const PERIOD = 24;
/** the frieze band's picture: width over height */
export const FRIEZE_ASPECT = 2048 / 870;

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
}

const m = (o: Partial<Material> & Pick<Material, 'base'>): Material => ({
  tex: null, size: 3, own: 1, detail: 1, rough: 0.8, metal: 0, f0: 0.04, wander: 1, map: MAP.METRES, glow: '#000000', glowOwn: 0, ...o,
});

const WARM = '#FF9F45';

export const MATERIALS: Material[] = [];
MATERIALS[MAT.PLASTER] = m({ base: '#FFFFFF', tex: 'plaster_terracotta', size: 4, detail: 0.85, rough: 0.85 });
MATERIALS[MAT.PLASTER_WARM] = m({ base: '#D9733F', tex: 'plaster_terracotta', size: 4, own: 0, detail: 0.8, rough: 0.85 });
MATERIALS[MAT.ASHLAR] = m({ base: '#FFFFFF', tex: 'cream_ashlar', size: 2.4, detail: 0.9, rough: 0.8, wander: 0.7 });
MATERIALS[MAT.CREAM] = m({ base: '#E8C98A', tex: 'plaster_terracotta', size: 3, own: 0, detail: 0.35, rough: 0.7, wander: 0.6 });
MATERIALS[MAT.PAVING] = m({ base: '#F4E6D0', tex: 'paving_slabs', size: 3, detail: 0.9, rough: 0.85, wander: 0.8 });
MATERIALS[MAT.GOLD] = m({ base: '#FFFFFF', tex: 'gold_leaf', size: 2, detail: 0.7, rough: 0.32, metal: 0.75, wander: 0.4 });
MATERIALS[MAT.DOME] = m({ base: '#FFFFFF', tex: 'dome_tiles', size: 1.5, detail: 0.9, rough: 0.2, f0: 0.05, wander: 0.5 });
MATERIALS[MAT.LAVENDER] = m({ base: '#FFFFFF', tex: 'ornament_panel', size: 2.4, rough: 0.5, map: MAP.PANEL, wander: 0.4, glow: '#E6D2FF', glowOwn: 1 });
MATERIALS[MAT.TEAL] = m({ base: '#FFFFFF', tex: 'frieze_band', size: 1.2, rough: 0.55, map: MAP.FRIEZE, wander: 0.4 });
MATERIALS[MAT.RED] = m({ base: '#B5432C', tex: 'plaster_terracotta', size: 3, own: 0, detail: 0.55, rough: 0.6 });
MATERIALS[MAT.WOOD] = m({ base: '#FFFFFF', tex: 'weathered_wood', size: 2, detail: 0.85, rough: 0.75 });
MATERIALS[MAT.CLOTH] = m({ base: '#EADCC0', size: 0.6, rough: 0.9, map: MAP.STRIPES, wander: 0.5, glow: WARM, glowOwn: 1 });
MATERIALS[MAT.SOIL] = m({ base: '#5E3A24', tex: 'canyon_floor', size: 3, own: 0, detail: 0.6, rough: 0.95, wander: 0.6 });
// (the lawn the bible's green with the grass texture's light and dark: past the flora's own grass, and under it)
MATERIALS[MAT.LAWN] = m({ base: '#7DAA4A', tex: 'garden_grass', size: 3, own: 0, detail: 0.45, rough: 0.95, wander: 0.6 });
MATERIALS[MAT.POOL] = m({ base: '#FFFFFF', tex: 'pool_mosaic', size: 2, detail: 0.9, rough: 0.45, f0: 0.04, wander: 0.3 });
MATERIALS[MAT.WINDOW] = m({ base: '#141A24', rough: 0.08, f0: 0.05, wander: 0.2, map: MAP.PANE, glow: WARM });
MATERIALS[MAT.ROCK] = m({ base: '#FFFFFF', tex: 'sandstone_strata', size: 12, detail: 0.9, rough: 0.9 });
MATERIALS[MAT.INTERIOR] = m({ base: '#1C120D', rough: 0.9, wander: 0.3, glow: '#FF9850' });

/** an sRGB hex colour, linear */
export function linear(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  const c = (x: number) => { const s = x / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return [c((v >> 16) & 255), c((v >> 8) & 255), c(v & 255)];
}

/** the table as arch.wgsl's ArchU.mats takes it */
export function materialRows() {
  return MATERIALS.map((x) => ({
    base: [...linear(x.base), x.rough],
    tex: [x.tex ? TEXTURES.indexOf(x.tex) : -1, x.size, x.own, x.detail],
    look: [x.metal, x.f0, x.wander, x.map],
    glow: [...linear(x.glow), x.glowOwn],
  }));
}
