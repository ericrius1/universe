// The constellations' figures (levels/local.ts): thin quiet lines joining the real stars where they are in space
// (parsecs, the galaxy's axes), not on a sphere — so they're true from the Sun and come apart as the view leaves it.
// Each line is drawn in pieces (FIG_PIECES, so a dome's fisheye bends it as it bends the sky), a little short of the
// stars at its ends, as a screen-facing strip a pixel or so wide with soft edges, its light added. It goes out with
// the stars when the meter takes their exposure down (renderer.ts).
// L.a: x the lines' light, y the gap at each star (px), z their width (px).
#include "cosmos.wgsl"

struct Seg { a: vec4f, b: vec4f }
@group(2) @binding(1) var<storage, read> segs: array<Seg>;
@group(2) @binding(2) var meterTex: texture_2d<f32>;

const FIG_PIECES = 6u;
const FIG_COLOR = vec3f(0.42, 0.55, 0.85);

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) across: f32,
  @location(1) light: f32,
}

// a point relative to the eye in pixels on the target (and whether it's in front)
fn toPx(rel: vec3f) -> vec3f {
  let c = clipOf(rel);
  if (c.w <= 0.0) { return vec3f(0.0, 0.0, -1.0); }
  return vec3f(c.xy / c.w * 0.5 / L.view.xy, 1.0);
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var out: VOut;
  out.pos = vec4f(0.0, 0.0, -2.0, 1.0);
  let s = segs[ii / FIG_PIECES];
  let k = ii % FIG_PIECES;
  let A = (s.a.xyz - L.origin) - L.eye;
  let B = (s.b.xyz - L.origin) - L.eye;
  // the line's length on the screen (its angle over a pixel's), for the gap round its stars
  let ang = acos(clamp(dot(normalize(A), normalize(B)), -1.0, 1.0));
  let g = clamp(L.a.y / max(ang / L.pxAngle, 1.0), 0.0, 0.45);
  var t0 = mix(g, 1.0 - g, f32(k) / f32(FIG_PIECES));
  var t1 = mix(g, 1.0 - g, f32(k + 1u) / f32(FIG_PIECES));
  // (not behind the eye: the piece cut at a plane just in front of it)
  if (!isDome()) {
    let near = 1e-6 * max(length(A), length(B));
    let za = dot(A, L.fwd); let zb = dot(B, L.fwd);
    let z0 = mix(za, zb, t0); let z1 = mix(za, zb, t1);
    if (z0 <= near && z1 <= near) { return out; }
    let tc = (near - za) / (zb - za);
    if (z0 <= near) { t0 = tc; }
    if (z1 <= near) { t1 = tc; }
  }
  let p0 = toPx(mix(A, B, t0));
  let p1 = toPx(mix(A, B, t1));
  if (p0.z < 0.0 || p1.z < 0.0) { return out; }
  let d = p1.xy - p0.xy;
  let len = length(d);
  if (len < 1e-3) { return out; }
  let light = L.a.x * L.weight * L.exposure * exp2(textureLoad(meterTex, vec2i(0, 0), 0).r);
  if (light < 1e-5) { return out; }
  let dir = d / len;
  let n = vec2f(-dir.y, dir.x);
  let corner = CORNERS[vi % 6u];
  let hw = L.a.z * 0.5 + 1.0;
  let q = select(p0.xy, p1.xy, corner.x > 0.0) + n * corner.y * hw;
  out.pos = vec4f(q * 2.0 * L.view.xy, 0.0, 1.0);
  out.across = corner.y * hw;
  out.light = light;
  return out;
}

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let cover = clamp(L.a.z * 0.5 + 0.5 - abs(in.across), 0.0, 1.0);
  if (cover <= 0.0) { discard; }
  return vec4f(FIG_COLOR * in.light * cover, 0.0);
}
