// From light to a picture. The scene is rendered in HDR; this spreads its highlights, rolls it off the way film
// would, and puts the whole thing in the register the page is in — a near-white field with the cells glowing out of
// it, or a black one with only the stains.
#include "./instrument"
#include "weft/output"

@group(1) @binding(5) var hdr: texture_2d<f32>;
@group(1) @binding(6) var bloom: texture_2d<f32>;

struct PostU {
  bloomAmount: f32, grain: f32, vignette: f32, chroma: f32,
  flash: f32, fade: f32, sharpen: f32, spare: f32,
}
@group(1) @binding(7) var<uniform> PU: PostU;

override HDR: bool = false;
override P3: bool = false;

// a filmic roll-off that desaturates toward white as it clips, rather than hard-clipping a channel and shifting hue
fn film(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return sat3((x * (a * x + b)) / (x * (c * x + d) + e));
}

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  var uv = surfaceWarp(i.uv);
  var c = textureSampleLevel(hdr, samp_linear, uv, 0.0).rgb;
  if (PU.chroma > 0.0) {
    // a whisper of lateral colour toward the corners, as a lens has
    let d = (uv - 0.5) * PU.chroma * 0.004;
    c.r = textureSampleLevel(hdr, samp_linear, uv + d, 0.0).r;
    c.b = textureSampleLevel(hdr, samp_linear, uv - d, 0.0).b;
  }
  let b = textureSampleLevel(bloom, samp_linear, uv, 0.0).rgb;
  // the instrument's picture where it's the look (instrument.wgsl): its own light, with none of the scene's bloom
  let w = G.optics.x;
  let bl = PU.bloomAmount * (1.0 - w);
  c = mix(c, b, bl * (0.4 + 0.6 * G.mode));
  c += b * bl * 0.5;
  if (w > 0.001) {
    let px = vec2i(clamp(uv, vec2f(0.0), vec2f(0.9999)) * frame.res);
    c = mix(c, instrumentAt(px, uv) / max(G.exposure, 0.01), w);
  }
  c += vec3f(0.30, 0.27, 0.27) * G.optics.w * G.optics.w / max(G.exposure, 0.01);

  c *= G.exposure;
  var col = film(c * 1.05);
  // a touch more colour than the transform leaves (none for the instrument's grey)
  let l = luma(col);
  col = clamp(mix(vec3f(l), col, 1.0 + 0.1 * (1.0 - G.mode) * (1.0 - w)), vec3f(0.0), vec3f(1.0));

  // the whiteout the dive goes through, and the fade the page opens on
  col = mix(col, vec3f(1.0, 0.996, 0.99), sat(PU.flash) * (1.0 - G.mode));
  col = mix(col, vec3f(0.85, 0.9, 1.0) * 0.9, sat(PU.flash) * G.mode);

  let d = length((i.uv - 0.5) * vec2f(frame.aspect, 1.0));
  col *= 1.0 - PU.vignette * smoothstep(0.42, 1.25, d) * (0.35 + 0.65 * G.mode);

  let g = (hash21(i.uv * frame.res + frame.time) - 0.5) * PU.grain;
  col += vec3f(g);
  col = mix(col, select(vec3f(1.0), vec3f(0.0), G.mode > 0.5), sat(PU.fade));

  return vec4f(canvasEncode(sat3(col), P3), 1.0);
}
