// The stone's and the crystals' look: the defaults of rocks.wgsl's RockU and crystal.wgsl's CrystalU (rocks.ts sets
// them; the '/' panel may tweak them; tools/rocks/look.ts renders with the same).
export const ROCK_LOOK = {
  /** rgb over the palette; w how strongly the textures' brushwork shows */
  tint: [1, 1, 1, 0.7],
  /** the textures' tiles (m): strata, flutes, sand; w the bump */
  tile: [6.5, 13, 7, 0.06],
  /** the shade's lean (lavender); w the canyon's warm bounce */
  shade: [0.98, 0.92, 1.12, 0.35],
  /** varnish streaks, dust on tops, the terminator's softness, the sand stain's height (m) */
  look: [0.55, 0.38, 0.6, 1.4],
};

export const CRYSTAL_LOOK = {
  /** thin crystal's teal (linear); w absorption per metre */
  core: [0.21, 0.77, 0.74, 0.5],
  /** thick crystal's blue; w the path (m) at which it is all deep */
  deep: [0.27, 0.46, 1.0, 3.0],
  /** the night glow (on screen), its pulse (per s), the facets' glints, the rim's fresnel boost */
  glow: [0.55, 0.11, 1.4, 0.5],
  /** the warm ground seen through and below; w how clear (0 painted .. 1 clear) */
  ground: [0.66, 0.35, 0.21, 0.55],
};
