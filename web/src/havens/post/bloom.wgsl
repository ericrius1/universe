// Bloom: a chain of half-resolution levels, filtered down with the 13-tap pattern (Jimenez, "Next Generation Post
// Processing in Call of Duty: Advanced Warfare"; the first level weights by luminance against fireflies) and back up
// with a 3x3 tent added onto each level.
#include "weft/frame"
#include "weft/fullscreen"

struct BloomU { texel: vec4f }   // xy source texel size, z first level (karis), w threshold
@group(2) @binding(0) var<uniform> B: BloomU;
@group(2) @binding(1) var src: texture_2d<f32>;

fn karis(c: vec3f) -> f32 { return 1.0 / (1.0 + dot(c, vec3f(0.2126, 0.7152, 0.0722)) * 0.25); }

fn tap(uv: vec2f) -> vec3f { return textureSampleLevel(src, samp_linear, uv, 0.0).rgb; }

@fragment fn down(i: FullscreenOut) -> @location(0) vec4f {
  let t = B.texel.xy;
  let uv = i.uv;
  let a = tap(uv + t * vec2f(-2.0, -2.0)); let b = tap(uv + t * vec2f(0.0, -2.0)); let c = tap(uv + t * vec2f(2.0, -2.0));
  let d = tap(uv + t * vec2f(-2.0, 0.0)); let e = tap(uv); let f = tap(uv + t * vec2f(2.0, 0.0));
  let g = tap(uv + t * vec2f(-2.0, 2.0)); let h = tap(uv + t * vec2f(0.0, 2.0)); let k = tap(uv + t * vec2f(2.0, 2.0));
  let j = tap(uv + t * vec2f(-1.0, -1.0)); let l = tap(uv + t * vec2f(1.0, -1.0));
  let m = tap(uv + t * vec2f(-1.0, 1.0)); let n = tap(uv + t * vec2f(1.0, 1.0));
  var o: vec3f;
  if (B.texel.z > 0.5) {
    // groups weighted by their own brightness (one bright pixel can't light up a whole block)
    let g0 = (a + b + d + e) * 0.25; let g1 = (b + c + e + f) * 0.25; let g2 = (d + e + g + h) * 0.25; let g3 = (e + f + h + k) * 0.25;
    let g4 = (j + l + m + n) * 0.25;
    let w0 = karis(g0) * 0.125; let w1 = karis(g1) * 0.125; let w2 = karis(g2) * 0.125; let w3 = karis(g3) * 0.125; let w4 = karis(g4) * 0.5;
    o = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
    o = max(o - vec3f(B.texel.w), vec3f(0.0));
  } else {
    o = e * 0.125 + (a + c + g + k) * 0.03125 + (b + d + f + h) * 0.0625 + (j + l + m + n) * 0.125;
  }
  return vec4f(o, 1.0);
}

@fragment fn up(i: FullscreenOut) -> @location(0) vec4f {
  let t = B.texel.xy;
  let uv = i.uv;
  var o = tap(uv) * 4.0;
  o += (tap(uv + vec2f(-t.x, 0.0)) + tap(uv + vec2f(t.x, 0.0)) + tap(uv + vec2f(0.0, -t.y)) + tap(uv + vec2f(0.0, t.y))) * 2.0;
  o += tap(uv - t) + tap(uv + t) + tap(uv + vec2f(-t.x, t.y)) + tap(uv + vec2f(t.x, -t.y));
  // (each wider level weighted: z, set by post/fx.ts — a tight or a wide glow)
  return vec4f(o / 16.0 * select(1.0, B.texel.z, B.texel.z > 0.0), 1.0);
}
