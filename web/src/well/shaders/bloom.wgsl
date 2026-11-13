// Bloom: the scene's own light spread wider. Down a short chain with a thirteen-tap filter, back up with a tent,
// added rather than piled on — so a bright mitochondrion has a halo and the white field stays white.
#include "weft/frame"
#include "weft/fullscreen"

@group(1) @binding(8) var src: texture_2d<f32>;

struct BloomU { texel: vec2f, threshold: f32, radius: f32 }
@group(1) @binding(10) var<uniform> B: BloomU;

override FIRST: bool = false;

fn tap(uv: vec2f, o: vec2f) -> vec3f { return textureSampleLevel(src, samp_linear, uv + o * B.texel, 0.0).rgb; }

@fragment fn fs_down(i: FullscreenOut) -> @location(0) vec4f {
  let uv = i.uv;
  var a = tap(uv, vec2f(-2, 2)) + tap(uv, vec2f(0, 2)) * 2.0 + tap(uv, vec2f(2, 2));
  a += tap(uv, vec2f(-2, 0)) * 2.0 + tap(uv, vec2f(0, 0)) * 4.0 + tap(uv, vec2f(2, 0)) * 2.0;
  a += tap(uv, vec2f(-2, -2)) + tap(uv, vec2f(0, -2)) * 2.0 + tap(uv, vec2f(2, -2));
  a /= 16.0;
  var b = tap(uv, vec2f(-1, 1)) + tap(uv, vec2f(1, 1)) + tap(uv, vec2f(-1, -1)) + tap(uv, vec2f(1, -1));
  b /= 4.0;
  var c = a * 0.5 + b * 0.5;
  // a backstop: nothing that is not a finite, sensible colour goes into the chain, because the blur would spread
  // one bad texel over a whole block of the picture
  c = clamp(c, vec3f(0.0), vec3f(60.0));
  if (FIRST) {
    // only what is actually bright blooms, and a single hot pixel is averaged so it cannot sparkle
    let l = max(max(c.r, c.g), c.b);
    c *= max(0.0, l - B.threshold) / max(l, 1e-4);
  }
  return vec4f(c, 1.0);
}

@fragment fn fs_up(i: FullscreenOut) -> @location(0) vec4f {
  let uv = i.uv;
  let r = B.radius;
  var c = tap(uv, vec2f(-1, 1) * r) + tap(uv, vec2f(0, 1) * r) * 2.0 + tap(uv, vec2f(1, 1) * r);
  c += tap(uv, vec2f(-1, 0) * r) * 2.0 + tap(uv, vec2f(0, 0) * r) * 4.0 + tap(uv, vec2f(1, 0) * r) * 2.0;
  c += tap(uv, vec2f(-1, -1) * r) + tap(uv, vec2f(0, -1) * r) * 2.0 + tap(uv, vec2f(1, -1) * r);
  return vec4f(c / 16.0, 1.0);
}
