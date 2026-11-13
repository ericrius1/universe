// The film of the whole dive: bloom from a mip chain, and the film (loom/film: the exposure, AgX and its look, the grade,
// the vignette and the grain) to the screen — the cosmos's frame, a host's laid into it (the cell's), or both as the two
// hand over. (Its alpha lays it over a frame already on the screen, for a host that grades its own.)
#include "weft/frame"
#include "weft/fullscreen"
#include "noise.wgsl"
#include "loom/film"

@group(2) @binding(0) var<uniform> F: FilmU;
@group(2) @binding(1) var srcTex: texture_2d<f32>;
@group(2) @binding(2) var bloomTex: texture_2d<f32>;
// going up, the wider level's weight (the film's bloomWeight); from the scene, x of `first`: the taps' groups averaged
// weighted by their brightness (1: Jimenez's — an even field kept as it is, Seven Havens'), or the average compressed (0:
// the cosmos's); w how much only what's bright is kept, its soft knee from y to z (the cell's)
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
    if (B.first.w > 0.0) { o *= mix(1.0, smoothstep(B.first.y, B.first.z, max(o.r, max(o.g, o.b))), B.first.w); }
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

// the meter (renderer.ts): the frame's log-average light, weighted to the middle (where the zoom's target is, and the
// body it's about), from the bloom's smallest level; the stops it takes off the stars when something bright fills the
// frame, eased in time by the share `rate` this frame keeps (the blend: 1 on a film or a dome, so their frames are the
// same however they're reached). M.a: x rate, y the meter's say (the zoom's keyframe), z the log-average a dark sky
// stays under, w stops per unit over it; M.b: x the most it takes off, y the light the log is taken over (its floor)
struct MeterU { a: vec4f, b: vec4f }
@group(2) @binding(4) var<uniform> M: MeterU;

@fragment fn fs_meter(in: FullscreenOut) -> @location(0) vec4f {
  let n = vec2i(textureDimensions(srcTex));
  let m = min(n, vec2i(64));
  var sum = 0.0; var wsum = 0.0;
  for (var y = 0; y < m.y; y++) {
    for (var x = 0; x < m.x; x++) {
      let p = (vec2f(f32(x), f32(y)) + 0.5) / vec2f(m);
      let c = textureLoad(srcTex, vec2i(p * vec2f(n)), 0).rgb;
      // (the bloom's first level keeps its light compressed, l / (1 + l / 4): undone)
      let yc = dot(c, vec3f(0.2126, 0.7152, 0.0722));
      let l = yc / max(1.0 - yc * 0.25, 0.02);
      let q = (p - 0.5) * vec2f(f32(n.x) / f32(n.y), 1.0);
      let w = exp(-dot(q, q) / (2.0 * 0.3 * 0.3));
      sum += w * log2(1.0 + l / M.b.y);
      wsum += w;
    }
  }
  let avg = sum / max(wsum, 1e-6);
  let stops = -clamp((avg - M.a.z) * M.a.w, 0.0, M.b.x) * M.a.y;
  return vec4f(stops, avg, 0.0, M.a.x);
}

@fragment fn fs_final(in: FullscreenOut) -> @location(0) vec4f {
  if (F.out.z > 0.5 && length(in.uv - 0.5) > 0.5) { return vec4f(0.0, 0.0, 0.0, F.out.x); }
  let c = textureSampleLevel(srcTex, samp_linear, in.uv, 0.0).rgb;
  let b = textureSampleLevel(bloomTex, samp_linear, in.uv, 0.0).rgb;
  let px = vec2u(in.pos.xy);
  let d = filmFinish(F, filmCurve(F, c, b), in.uv, in.pos.xy, frame.aspect, hash3u(vec3u(px, 7u)).x, hash3u(vec3u(px, frame.frame)).x);
  return vec4f(d, F.out.x);
}
