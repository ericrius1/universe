// Points of light: galaxies in the cosmic web, the Milky Way's stars, the Sun's neighbours, the asteroids. Each is a
// screen-facing quad. A star is a flux: its luminosity over its distance squared, times the level's gain and the
// camera's exposure (L.exposure, the zoom's keyframe, and the meter's stops, renderer.ts), through the one
// point-spread function every star shares — a tight Moffat core and a faint r⁻² aureole, in pixels. A bright star looks
// bigger because more of its wings clear the floor, not because its quad is scaled: the quad is only made big enough to
// hold what clears it. A galaxy is an extended glow once it's wider than a pixel, a faint smudge before.
// L.a: brightness gain, mode (0 star, 1 extended), the nearest it may come to the eye (its units), a size gain.
#include "cosmos.wgsl"
#include "weft/fullscreen"

struct Pt { pos: vec3f, size: f32, color: vec3f, lum: f32 }
@group(2) @binding(1) var<storage, read> pts: array<Pt>;
// the meter (renderer.ts): r the stops the exposure is eased by this frame (0, or below when something bright fills it)
@group(2) @binding(2) var meterTex: texture_2d<f32>;

// the point-spread function (pixels): the Moffat core's width and power, the aureole's knee and share of the light,
// and the floor below which nothing is drawn (subtracted, so a star's edge comes down to it smoothly)
const PSF_ALPHA = 1.4;
const PSF_BETA = 3.0;
const AUR_R = 1.6;
const AUR = 0.0035;
const FLOOR = 0.0015;
// a star's flux as it was drawn before the shared PSF (the galaxy's stars, the belts: their gains were set for that),
// to the light the PSF spreads
const FLUX_K = 6.0;

fn moffat0() -> f32 { return (PSF_BETA - 1.0) / (PI * PSF_ALPHA * PSF_ALPHA); }
// the light per unit flux at r pixels from a star's centre
fn psf(r: f32) -> f32 {
  let q = r * r;
  return moffat0() * pow(1.0 + q / (PSF_ALPHA * PSF_ALPHA), -PSF_BETA) + AUR / (1.0 + q / (AUR_R * AUR_R));
}
// how far (px) a star of this flux clears the floor
fn psfReach(f: f32) -> f32 {
  let core = PSF_ALPHA * sqrt(max(pow(f * moffat0() / FLOOR, 1.0 / PSF_BETA) - 1.0, 0.0));
  let wing = AUR_R * sqrt(max(f * AUR / FLOOR - 1.0, 0.0));
  return max(core, wing);
}
/** the camera's exposure this frame: the zoom's keyframe and the meter's stops */
fn camExposure() -> f32 { return L.exposure * exp2(textureLoad(meterTex, vec2i(0, 0), 0).r); }

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
  @location(2) core: f32,
  @location(3) reach: f32,
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
  var nearFade = ss(L.a.z, L.a.z * 4.0, d);
  var rpx: f32; var core: f32; var col: vec3f;
  if (L.a.y < 0.5) {
    // a star: its own nearest too, if it has one (the Sun, seen as a star from parsecs out)
    if (p.size > 0.0) { nearFade *= ss(p.size, p.size * 4.0, d); }
    let f = p.lum / (d * d) * L.a.x * nearFade * camExposure() * FLUX_K * L.weight;
    if (f * psf(0.0) < FLOOR * 1.05) { return out; }
    rpx = min(psfReach(f) + 1.0, 160.0);
    core = f;
    col = p.color;
  } else {
    // a galaxy: wider than a pixel, its glow spread over its disc
    let apparent = p.lum / (d * d) * L.a.x * nearFade * camExposure();
    let px = p.size / (d * L.pxAngle) * L.a.w;                  // its own radius in pixels
    rpx = max(px * 2.5, 1.4);
    core = clamp(px / 4.0, 0.0, 1.0);
    col = p.color * apparent * min(1.0, 1.0 / max(px * px * 0.08, 1.0)) * 1.5 * L.weight;
    if (max(col.r, max(col.g, col.b)) < 1e-4) { return out; }
  }
  let k = CORNERS[vi % 6u];
  out.pos = quadCorner(c, k, rpx);
  out.uv = k;
  out.color = col;
  out.core = core;
  out.reach = rpx;
  return out;
}

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  if (L.a.y < 0.5) {
    // the star's flux through the shared PSF, less the floor
    let i = in.core * psf(sqrt(r2) * in.reach) - FLOOR;
    if (i <= 0.0) { discard; }
    return vec4f(in.color * i, 0.0);
  }
  let i = mix(exp(-r2 * 6.0), exp(-r2 * 3.0) * (1.0 - r2), in.core);
  return vec4f(in.color * i, 0.0);
}
