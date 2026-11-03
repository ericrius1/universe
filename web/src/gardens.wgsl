// Seven Havens' gardens laid over the frame (gardens.ts): the canyon's picture, through its own post chain (as the
// screen takes it), with whoever lies there (figure.wgsl, drawn in display colours for it) laid in where they're
// nearer than what the canyon drew (its distances along the view axis, Seven Havens' sceneZ: the nearest of a pixel's
// samples) — the flowers in front of them in front — and the whole blended over what the cosmos drew by how much the
// gardens show (HV.a.x). Read at the frame's own uv: the canyon's targets are the render's size, the screen the
// canvas's.
#include "./cosmos/shaders/cosmos.wgsl"
#include "weft/fullscreen"

struct HavenU { a: vec4f }    // x how much shows (0..1)
@group(2) @binding(1) var<uniform> HV: HavenU;
@group(2) @binding(2) var havenTex: texture_2d<f32>;
@group(2) @binding(3) var sceneZ: texture_2d<f32>;
@group(2) @binding(4) var figCol: texture_2d<f32>;
@group(2) @binding(5) var figDist: texture_2d<f32>;

@fragment fn fs(in: FullscreenOut) -> @location(0) vec4f {
  var c = textureSampleLevel(havenTex, samp_linear, in.uv, 0.0).rgb;
  let px = vec2i(in.uv * vec2f(textureDimensions(figCol)));
  let fc = textureLoad(figCol, px, 0);
  let cov = fc.a;
  if (cov > 0.004) {
    let rd = rayDir(in.uv);
    let tFig = cov / max(textureLoad(figDist, px, 0).r, 1e-12);
    let z = textureLoad(sceneZ, vec2i(in.uv * vec2f(textureDimensions(sceneZ))), 0);
    let tScene = min(min(z.x, z.y), min(z.z, z.w)) / max(dot(rd, L.fwd), 1e-4);
    // (premultiplied: the figure's samples resolved over a clear target)
    if (tFig < tScene * 1.002) { c = fc.rgb + c * (1.0 - cov); }
  }
  return vec4f(c, HV.a.x);
}
