// The grass they press flat, one value per blade's cell of the meadow round them (0 flat … 1 standing): the same for
// every frame, so worked out once (c_press.wgsl) into a small table the grass reads (c_ground.wgsl), instead of their
// outline's eighteen capsules for every blade a ray passes, which was most of the meadow's cost up close.
#include "figproxy.wgsl"

const GRASS_CS = 0.011;                 // a blade's cell (m)
const PRESS_PAD = 0.06;                 // how far round their box the grass is pressed (m)
// the table's first cell, and its size (cells; what they cover falls back to their outline)
const PRESS_G0 = vec2i(floor((FIG_LO.xz - PRESS_PAD) / GRASS_CS));
const PRESS_N = vec2i(256, 128);

fn pressOf(g: vec2f) -> f32 {
  let bp = (g + 0.5) * GRASS_CS;
  return ss(0.0, 0.05, figPrint(bp));
}
