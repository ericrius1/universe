// The film above the cell: bloom from a mip chain, and the film (film.wgsl: the exposure, AgX and its look, the grade,
// the vignette and the grain) to the screen. Its alpha lays the frame over the cell's while the two hand over.
#include "weft/frame"
#include "weft/fullscreen"
#include "noise.wgsl"
#include "film.wgsl"

@group(2) @binding(0) var<uniform> F: FilmU;
@group(2) @binding(1) var srcTex: texture_2d<f32>;
@group(2) @binding(2) var bloomTex: texture_2d<f32>;
// going up, the wider level's weight (the film's bloomWeight); from the scene, x of `first`: the taps' groups averaged
// weighted by their brightness (1: Jimenez's — an even field kept as it is, Seven Havens'), or the average compressed (0:
// the cosmos's)
struct Lvl { texel: vec2f, mip: f32, weight: f32, first: vec4f }
@group(2) @binding(3) var<uniform> B: Lvl;

fn karis(c: vec3f) -> f32 { return 1.0 / (1.0 + dot(c, vec3f(0.2126, 0.7152, 0.0722)) * 0.25); }

// 13-tap downsample (Jimenez), the first level's taps weighted against fireflies
@fragment fn fs_down(in: FullscreenOut) -> @location(0) vec4f {
  let t = B.texel;
  let uv = in.uv;
  let s = textureSampleLevel(srcTex, samp_linear, uv, 0.0).rgb;
  let a = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(-2.0, -2.0), 0.0).rgb;
  let b = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(0.0, -2.0), 0.0).rgb;
  let c = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(2.0, -2.0), 0.0).rgb;
  let d = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(-2.0, 0.0), 0.0).rgb;
  let f = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(2.0, 0.0), 0.0).rgb;
  let g = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(-2.0, 2.0), 0.0).rgb;
  let h = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(0.0, 2.0), 0.0).rgb;
  let i = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(2.0, 2.0), 0.0).rgb;
  let j = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(-1.0, -1.0), 0.0).rgb;
  let k = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(1.0, -1.0), 0.0).rgb;
  let l = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(-1.0, 1.0), 0.0).rgb;
  let m = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(1.0, 1.0), 0.0).rgb;
  var o = s * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  if (B.mip < 0.5) {
    let g0 = (a + b + d + s) * 0.25; let g1 = (b + c + s + f) * 0.25; let g2 = (d + s + g + h) * 0.25; let g3 = (s + f + h + i) * 0.25;
    let g4 = (j + k + l + m) * 0.25;
    let w0 = karis(g0) * 0.125; let w1 = karis(g1) * 0.125; let w2 = karis(g2) * 0.125; let w3 = karis(g3) * 0.125; let w4 = karis(g4) * 0.5;
    let even = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
    o = mix(o / (1.0 + dot(o, vec3f(0.2126, 0.7152, 0.0722)) * 0.25), even, B.first.x);
  }
  return vec4f(o, 1.0);
}
@fragment fn fs_up(in: FullscreenOut) -> @location(0) vec4f {
  let t = B.texel;
  var o = textureSampleLevel(srcTex, samp_linear, in.uv, 0.0).rgb * 4.0;
  o += (textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(-t.x, 0.0), 0.0).rgb + textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(t.x, 0.0), 0.0).rgb
      + textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(0.0, -t.y), 0.0).rgb + textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(0.0, t.y), 0.0).rgb) * 2.0;
  o += textureSampleLevel(srcTex, samp_linear, in.uv - t, 0.0).rgb + textureSampleLevel(srcTex, samp_linear, in.uv + t, 0.0).rgb
     + textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(t.x, -t.y), 0.0).rgb + textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(-t.x, t.y), 0.0).rgb;
  return vec4f(o / 16.0 * B.weight, 1.0);
}

@fragment fn fs_final(in: FullscreenOut) -> @location(0) vec4f {
  if (F.out.z > 0.5 && length(in.uv - 0.5) > 0.5) { return vec4f(0.0, 0.0, 0.0, F.out.x); }
  let c = textureSampleLevel(srcTex, samp_linear, in.uv, 0.0).rgb;
  let b = textureSampleLevel(bloomTex, samp_linear, in.uv, 0.0).rgb;
  let px = vec2u(in.pos.xy);
  let d = filmFinish(F, filmCurve(F, c, b), in.uv, in.pos.xy, frame.aspect, hash3u(vec3u(px, 7u)).x, hash3u(vec3u(px, frame.frame)).x);
  return vec4f(d, F.out.x);
}
