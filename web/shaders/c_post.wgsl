// The film above the cell: bloom from a mip chain and the grade (the cell's AgX-style curve, a vignette, a touch of
// grain). Its alpha lays the frame over the cell's while the two hand over.
#include "weft/frame"
#include "weft/fullscreen"
#include "noise.wgsl"

struct CPost { bloom: f32, exposure: f32, vignette: f32, grain: f32, saturation: f32, contrast: f32, alpha: f32, pad: f32 }
@group(2) @binding(0) var<uniform> P: CPost;
@group(2) @binding(1) var srcTex: texture_2d<f32>;
@group(2) @binding(2) var bloomTex: texture_2d<f32>;
struct Lvl { texel: vec2f, mip: f32, last: f32 }
@group(2) @binding(3) var<uniform> B: Lvl;

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
  if (B.mip < 0.5) { o = o / (1.0 + dot(o, vec3f(0.2126, 0.7152, 0.0722)) * 0.25); }
  return vec4f(o, 1.0);
}
@fragment fn fs_up(in: FullscreenOut) -> @location(0) vec4f {
  let t = B.texel;
  var o = textureSampleLevel(srcTex, samp_linear, in.uv, 0.0).rgb * 4.0;
  o += (textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(-t.x, 0.0), 0.0).rgb + textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(t.x, 0.0), 0.0).rgb
      + textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(0.0, -t.y), 0.0).rgb + textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(0.0, t.y), 0.0).rgb) * 2.0;
  o += textureSampleLevel(srcTex, samp_linear, in.uv - t, 0.0).rgb + textureSampleLevel(srcTex, samp_linear, in.uv + t, 0.0).rgb
     + textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(t.x, -t.y), 0.0).rgb + textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(-t.x, t.y), 0.0).rgb;
  return vec4f(o / 16.0, 1.0);
}

fn agx(c0: vec3f) -> vec3f {
  let m = mat3x3f(vec3f(0.842, 0.0423, 0.0424), vec3f(0.0784, 0.878, 0.0784), vec3f(0.0792, 0.0792, 0.879));
  let mi = mat3x3f(vec3f(1.197, -0.0528, -0.0529), vec3f(-0.098, 1.152, -0.098), vec3f(-0.099, -0.099, 1.152));
  var c = m * max(c0, vec3f(1e-10));
  c = clamp(log2(c), vec3f(-12.47), vec3f(4.03));
  c = (c + 12.47) / 16.5;
  let x2 = c * c; let x4 = x2 * x2;
  c = 15.5 * x4 * x2 - 40.14 * x4 * c + 31.96 * x4 - 6.868 * x2 * c + 0.4298 * x2 + 0.1191 * c - 0.00232;
  return clamp(mi * c, vec3f(0.0), vec3f(1.0));
}

@fragment fn fs_final(in: FullscreenOut) -> @location(0) vec4f {
  var c = textureSampleLevel(srcTex, samp_linear, in.uv, 0.0).rgb;
  c += textureSampleLevel(bloomTex, samp_linear, in.uv, 0.0).rgb * P.bloom;
  c *= P.exposure;
  var g = agx(c);
  let l = dot(g, vec3f(0.2126, 0.7152, 0.0722));
  g = mix(vec3f(l), g, P.saturation);
  g = clamp((g - 0.5) * P.contrast + 0.5, vec3f(0.0), vec3f(1.0));
  let dc = in.uv - 0.5;
  g *= 1.0 - P.vignette * smoothstep(0.25, 0.95, length(dc * vec2f(frame.aspect, 1.0)) / max(frame.aspect, 1.0) * 1.5);
  g += (hash3u(vec3u(vec2u(in.pos.xy), frame.frame)).x - 0.5) * P.grain;
  return vec4f(pow(max(g, vec3f(0.0)), vec3f(1.0 / 2.2)), P.alpha);
}
