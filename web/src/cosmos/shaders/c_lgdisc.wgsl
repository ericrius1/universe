// The Local Group's big galaxies as small soft sprites (levels/localgroup.ts): each a disc laid in its own plane (its
// inclination and position angle on our sky, turned into the cosmos frame), so Andromeda is the long tilted oval it is
// from here and a round one seen from above. A spiral is an exponential disc round a warm bulge with a trace of two
// arms; an irregular (the Magellanic Clouds) a lumpy, barred cloud of young blue light. Additive; its surface
// brightness its luminosity over its area, so it stays as bright as it is near or far, and once it's smaller than a few
// pixels it's held at that size and dimmed to keep its light. L.c: x the Milky Way's own (faded as its volume takes
// over), y the sprites' gain.
#include "cosmos.wgsl"

// pos and radius (Mpc); e1, e2 the disc's axes (unit, the cosmos frame), its luminosity and kind (0 spiral, 1
// irregular); its colour and whether it's the Milky Way
struct Disc { pos: vec3f, radius: f32, e1: vec3f, lum: f32, e2: vec3f, kind: f32, color: vec3f, mw: f32 }
@group(2) @binding(1) var<storage, read> discs: array<Disc>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
  @location(2) @interpolate(flat) kind: f32,
}

const EXTENT = 1.3;   // the quad's half-size in the disc's radius

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var out: VOut;
  out.pos = vec4f(0.0, 0.0, -2.0, 1.0);
  let g = discs[ii];
  if (g.lum <= 0.0) { return out; }
  let rel = (g.pos - L.origin) - L.eye;
  let d = length(rel);
  // (not from inside it, nor behind the eye)
  if (dot(rel, L.fwd) <= g.radius * EXTENT * 1.5 || d < g.radius * 3.0) { return out; }
  // held at a few pixels across once it's smaller, its light kept
  let rpx = g.radius / (d * L.pxAngle);
  let grow = max(1.0, 3.0 / max(rpx, 1e-3));
  var col = g.color * g.lum * L.c.y / (g.radius * g.radius) / (grow * grow) * L.weight;
  col *= select(1.0, L.c.x, g.mw > 0.5);
  if (max(col.r, max(col.g, col.b)) < 1e-5) { return out; }
  let k = CORNERS[vi % 6u];
  let p = rel + (g.e1 * k.x + g.e2 * k.y) * (g.radius * EXTENT * grow);
  out.pos = clipOf(p);
  out.uv = k * EXTENT;
  out.color = col;
  out.kind = g.kind;
  return out;
}

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let r = length(in.uv);
  if (r > EXTENT) { discard; }
  // (no edge: everything falls to nothing by the quad's rim)
  let rim = 1.0 - ss(0.85, EXTENT, r);
  var c: vec3f;
  if (in.kind < 0.5) {
    // a spiral: exponential disc, a trace of two arms, a warm bulge
    let th = atan2(in.uv.y, in.uv.x);
    let arms = 1.0 + 0.35 * cos(2.0 * (th - log(max(r, 0.05)) * 2.6)) * ss(0.12, 0.35, r);
    c = in.color * exp(-r / 0.27) * arms * 1.6 + vec3f(1.0, 0.82, 0.58) * dot(in.color, vec3f(0.333)) * exp(-(r * r) / (0.07 * 0.07)) * 3.0;
  } else {
    // an irregular: a lumpy cloud round a bar, young and blue
    let n = clamp(vnoise(vec3f(in.uv * 3.0, in.color.r * 17.0)) * 0.5 + 0.5, 0.0, 1.0) * 0.6 + clamp(vnoise(vec3f(in.uv * 9.0, 5.0)) * 0.5 + 0.5, 0.0, 1.0) * 0.4;
    let lump = 0.15 + 2.2 * n * n;
    let bar = exp(-(in.uv.x * in.uv.x) / (0.4 * 0.4) - (in.uv.y * in.uv.y) / (0.1 * 0.1));
    c = in.color * (exp(-r / 0.33) * lump * 1.6 + bar * 1.2);
  }
  return vec4f(c * rim, 0.0);
}
