// Points of light: galaxies in the cosmic web, the Milky Way's stars, the Sun's neighbours, the asteroids. Each is a
// screen-facing quad; a star is a point source (a sharp core and a soft halo, its size from its brightness, never
// less than a pixel), a galaxy an extended glow once it's wider than a pixel, a faint smudge before.
// L.a: brightness gain, mode (0 star, 1 extended), the nearest it may come to the eye (its units), a size gain.
#include "cosmos.wgsl"
#include "weft/fullscreen"

struct Pt { pos: vec3f, size: f32, color: vec3f, lum: f32 }
@group(2) @binding(1) var<storage, read> pts: array<Pt>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
  @location(2) core: f32,
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var out: VOut;
  out.pos = vec4f(0.0, 0.0, -2.0, 1.0);
  let p = pts[ii];
  // (stored absolute, rebased before anything else)
  let rel = (p.pos - L.origin) - L.eye;
  let d = length(rel);
  let c = clipOf(rel);
  if (c.w <= 0.0 || d < L.a.z) { return out; }
  // fade what comes too near, so a neighbour doesn't fill the screen
  let nearFade = ss(L.a.z, L.a.z * 4.0, d);
  let apparent = p.lum / (d * d) * L.a.x * nearFade;          // flux
  let px = p.size / (d * L.pxAngle) * L.a.w;                  // its own radius in pixels
  var rpx: f32; var core: f32; var col: vec3f;
  if (L.a.y < 0.5) {
    // a star: the eye sees a point, brighter is wider
    // (the eye's response compressed: the brightest are wider and whiter, not blinding discs)
    rpx = clamp(1.4 + 2.0 * log2(1.0 + apparent * 3.0), 1.4, 13.0);
    core = 1.0;
    col = p.color * apparent / (1.0 + apparent * 0.3);
  } else {
    // a galaxy: wider than a pixel, its glow spread over its disc
    rpx = max(px * 2.5, 1.4);
    core = clamp(px / 4.0, 0.0, 1.0);
    col = p.color * apparent * min(1.0, 1.0 / max(px * px * 0.08, 1.0)) * 1.5;
  }
  col *= L.weight;
  if (max(col.r, max(col.g, col.b)) < 1e-4) { return out; }
  let k = CORNERS[vi % 6u];
  out.pos = quadCorner(c, k, rpx);
  out.uv = k;
  out.color = col;
  out.core = core;
  return out;
}

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  var i: f32;
  if (L.a.y < 0.5) {
    // a tight core and a wide faint halo
    i = exp(-r2 * 28.0) * 1.6 + exp(-r2 * 6.0) * 0.25 + (1.0 - r2) * 0.02;
  } else {
    i = mix(exp(-r2 * 6.0), exp(-r2 * 3.0) * (1.0 - r2), in.core);
  }
  return vec4f(in.color * i, 0.0);
}
