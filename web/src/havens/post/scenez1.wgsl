// scenez.wgsl for the scene drawn without MSAA (util/tier.ts msaa): its one depth sample a pixel, as all four
#include "weft/frame"
#include "weft/fullscreen"

@group(2) @binding(0) var depth: texture_depth_2d;

fn dist(d: f32) -> f32 { return select(frame.near / d, 1e9, d <= 0.0); }

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  return vec4f(dist(textureLoad(depth, vec2i(i.pos.xy), 0)));
}
