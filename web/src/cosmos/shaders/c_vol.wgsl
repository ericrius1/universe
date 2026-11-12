// A picture drawn at a fraction of the resolution, laid into the scene upsampled: its light and coverage
// premultiplied, as it would have been drawn there. fs: one bilinear tap (levels/beyond.ts, the keepers' world).
// fs_tent: the volumes (renderer.ts volume()), four bilinear taps half a texel off the pixel each way, a tent over the
// texels round it: the march's per-pixel dither averaged out rather than blown up into blocks.
#include "weft/frame"
#include "weft/fullscreen"

@group(2) @binding(0) var volTex: texture_2d<f32>;

@fragment fn fs(in: FullscreenOut) -> @location(0) vec4f { return textureSampleLevel(volTex, samp_linear, in.uv, 0.0); }

@fragment fn fs_tent(in: FullscreenOut) -> @location(0) vec4f {
  let o = 0.5 / vec2f(textureDimensions(volTex));
  return 0.25 * (textureSampleLevel(volTex, samp_linear, in.uv + vec2f(-o.x, -o.y), 0.0)
    + textureSampleLevel(volTex, samp_linear, in.uv + vec2f(o.x, -o.y), 0.0)
    + textureSampleLevel(volTex, samp_linear, in.uv + vec2f(-o.x, o.y), 0.0)
    + textureSampleLevel(volTex, samp_linear, in.uv + vec2f(o.x, o.y), 0.0));
}
