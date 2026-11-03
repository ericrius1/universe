// The scene's distances (scenez.wgsl) from a depth buffer without multisampling (a phone's): the one sample in all
// four channels.
#include "weft/frame"
#include "weft/fullscreen"

@group(2) @binding(0) var depth: texture_depth_2d;

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let d = textureLoad(depth, vec2i(i.pos.xy), 0);
  return vec4f(select(frame.near / d, 1e9, d <= 0.0));
}
