// A volume drawn at a fraction of the resolution (renderer.ts volume()), laid into the scene upsampled: its light and
// coverage premultiplied, as it would have been drawn there.
#include "weft/frame"
#include "weft/fullscreen"

@group(2) @binding(0) var volTex: texture_2d<f32>;

@fragment fn fs(in: FullscreenOut) -> @location(0) vec4f { return textureSampleLevel(volTex, samp_linear, in.uv, 0.0); }
