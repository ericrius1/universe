// The scene's distances for the passes after it (the clouds, the ambient occlusion, the shafts, the depth of field):
// each of the multisampled depth's four samples as metres along the camera's axis (reversed-Z, infinite far plane),
// 1e9 where nothing was drawn (the sky). In a half-float target (util/tier.ts sceneDepthFormat) that 1e9 is held as
// 65504, so what reads it takes 6e4 and beyond as the sky (60 km: past the farthest terrain that matters to it).
#include "weft/frame"
#include "weft/fullscreen"

@group(2) @binding(0) var depth: texture_depth_multisampled_2d;

fn dist(d: f32) -> f32 { return select(frame.near / d, 1e9, d <= 0.0); }

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let px = vec2i(i.pos.xy);
  return vec4f(dist(textureLoad(depth, px, 0)), dist(textureLoad(depth, px, 1)), dist(textureLoad(depth, px, 2)), dist(textureLoad(depth, px, 3)));
}
