// The Milky Way as a volume (kiloparsecs, its centre at the frame's origin): an exponential disc of old stars, two
// major and two minor logarithmic spiral arms of young blue stars with pink HII regions along them, a bar and a bulge,
// and dark dust lanes on the arms' inner edges. Marched through its slab; from the Sun's place in it the same march
// draws the band of the Milky Way across the sky, until the band is the real one: the sky's picture (NASA's Deep Star
// Maps), with the march's steps falling away as it takes over. L.a: emission gain, dust gain, steps, how far inside the
// disc; L.d: y the band's gain, z 1 once the picture is in. Its noise is baked (noisetex.wgsl).
#include "cosmos.wgsl"
#include "noisetex.wgsl"
#include "weft/fullscreen"

// the sky (levels/galaxy.ts, data/sky/milkyway.webp): celestial J2000 plate carrée, right ascension 0 at the centre
// increasing to the left, declination +90° at the top, each channel stored as its cube root
@group(2) @binding(3) var milkyTex: texture_2d<f32>;

const PITCH = 0.22;          // the arms' pitch angle (rad, ~12.6°)
const BAR = 0.44;            // the bar's angle

struct Gal { glow: vec3f, dust: f32 }

fn armPhase(p: vec3f, r: f32) -> f32 {
  let th = atan2(p.z, p.x);
  return th - log(max(r, 0.3)) / tan(PITCH);
}

fn galaxy(p: vec3f) -> Gal {
  var g: Gal;
  let r = length(p.xz);
  let z = abs(p.y);
  // the thin and thick discs
  let disc = exp(-r / 2.8) * (exp(-z / 0.28) + 0.12 * exp(-z / 0.9));
  // the arms: two strong, two weak, with a wobble so they aren't ruled lines
  let ph = armPhase(p, r);
  let wob = valTap(p * 0.45).r * 1.4;
  let a2 = pow(0.5 + 0.5 * cos(2.0 * ph + wob), 5.0);
  let a4 = pow(0.5 + 0.5 * cos(2.0 * ph + 3.14159 + wob * 1.3), 7.0) * 0.55;
  let arms = (a2 + a4) * ss(2.2, 4.5, r) * exp(-r / 6.0) * exp(-z / 0.16);
  // the bar and the bulge
  let cb = cos(BAR); let sb = sin(BAR);
  let q = vec2f(p.x * cb + p.z * sb, -p.x * sb + p.z * cb);
  let bar = exp(-(q.x * q.x) / (3.4 * 3.4) - (q.y * q.y) / (1.0 * 1.0)) * exp(-z / 0.35);
  let bulge = exp(-length(p * vec3f(1.0, 1.45, 1.0)) / 0.55);
  // knots of star formation strung along the arms
  let knots = pow(max(valTap(p * 2.6).b * 0.5 + 0.5 - 0.62, 0.0) * 3.0, 3.0) * arms * 6.0;
  g.glow = vec3f(1.0, 0.66, 0.32) * (bulge * 9.0 + bar * 3.2)
         + vec3f(1.0, 0.8, 0.6) * disc * 1.4
         + vec3f(0.42, 0.6, 1.0) * arms * 3.0
         + vec3f(1.0, 0.25, 0.5) * knots * 1.6;
  // dust: a thin layer, thickest just inside the arms
  let dph = pow(0.5 + 0.5 * cos(2.0 * ph + 0.55 + wob), 4.0) + 0.5 * pow(0.5 + 0.5 * cos(2.0 * ph + 3.69 + wob * 1.3), 6.0);
  g.dust = (dph * 0.85 + 0.15) * exp(-r / 4.5) * exp(-z / 0.09) * ss(0.8, 2.6, r) * (0.55 + 0.9 * max(valTap(p * 1.7 + 11.0).g, 0.0));
  return g;
}

// the Milky Way as the Sun sees it: a band along the galactic plane, broad and warm toward the centre (in
// Sagittarius, along −x, where it swells round the bulge), knotted into star clouds, split by dark lanes of dust (the
// Great Rift), its edges fading softly into the sky
fn milkyWay(rd: vec3f) -> vec3f {
  let b = asin(clamp(rd.y, -1.0, 1.0));
  let l = atan2(rd.z, -rd.x);                       // 0 toward the centre
  let toC = 0.5 + 0.5 * cos(l);                     // 1 toward the centre, 0 away
  let width = 0.07 + 0.09 * toC * toC;
  // a bright core across the plane, and wide soft wings fading off it (no edge to it)
  let band = exp(-pow(abs(b) / width, 1.4)) * 0.75 + exp(-pow(abs(b) / (width + 0.22), 1.2)) * 0.25 * (0.6 + 0.4 * toC);
  // the bulge round Sagittarius: brighter, and a broad glow round it
  let bulge = exp(-(l * l + b * b * 4.0) / 0.12) * 2.2 + exp(-(l * l + b * b * 5.0) / 0.5) * 0.25;
  let dir = vec3f(cos(l), sin(l), b * 3.0);
  // (the star clouds knot the core; the wings stay smooth)
  let clouds = 0.55 + (0.9 * max(fbm(dir * 6.0, 5), -0.3) + 0.5 * max(fbm(dir * 22.0 + 3.0, 4), -0.2)) * ss(2.6, 0.8, abs(b) / width);
  // the dust: thin dark lanes hugging the plane, strongest toward the centre
  let lane = exp(-pow((b - 0.012 * sin(l * 3.0) - 0.02 * fbm(dir * 9.0, 3)) / (0.018 + 0.03 * toC), 2.0));
  let rift = clamp(lane * (0.5 + 0.8 * max(fbm(dir * 14.0 + 7.0, 4) + 0.3, 0.0)) * (0.35 + 0.65 * toC), 0.0, 0.95);
  let c = mix(vec3f(0.7, 0.75, 0.95), vec3f(1.0, 0.82, 0.62), min(toC * 0.8 + bulge * 0.2, 1.0));
  return c * (band * clouds + bulge) * (1.0 - rift) + vec3f(0.02, 0.022, 0.03) * band;
}

// the galaxy's axes (−x toward the centre, y the north galactic pole, z toward l = 90°) in equatorial ones (J2000:
// x toward right ascension 0, z the north celestial pole): the centre, l = 90° and the pole, as the IAU's matrix has them
const GAL_C = vec3f(-0.0548755604, -0.8734370902, -0.4838350155);
const GAL_L90 = vec3f(0.4941094279, -0.4448296300, 0.7469822445);
const GAL_NP = vec3f(-0.8676661490, -0.1980763734, 0.4559837762);
// the picture's light against the band it replaces
const SKY_GAIN = 2.2;

// the real Milky Way in the direction rd (the galaxy's axes): one tap of the sky's picture
fn skyPicture(rd: vec3f) -> vec3f {
  let e = -rd.x * GAL_C + rd.z * GAL_L90 + rd.y * GAL_NP;
  let ra = atan2(e.y, e.x);
  let dec = asin(clamp(e.z, -1.0, 1.0));
  let uv = vec2f(fract(0.5 - ra / (2.0 * PI)), 0.5 - dec / PI);
  // (its level from a pixel's size on the sky, the march's pixel being two of the frame's: no seam where it wraps)
  let lod = max(log2(L.pxAngle * 2.0 * 4096.0 / (2.0 * PI)), 0.0);
  let c = textureSampleLevel(milkyTex, samp_repeat, uv, lod).rgb;
  return c * c * c * SKY_GAIN;
}

// the band: the picture once it's in, the drawn one till then
fn band(rd: vec3f) -> vec3f {
  if (L.d.z > 0.5) { return skyPicture(rd); }
  return milkyWay(rd);
}

@fragment fn fs(in: FullscreenOut) -> @location(0) vec4f {
  let rd = rayDir(in.uv);
  let ro = L.eye + L.origin;
  // from inside the disc, near the Sun, the sky's band (L.a.w: how far inside)
  if (L.a.w >= 0.999) { return vec4f(band(rd) * L.d.y * L.weight, 0.0); }
  // the slab |y| < 2.2 within r < 22 (a cylinder)
  var t0 = 0.0; var t1 = 1e9;
  if (abs(rd.y) > 1e-6) {
    let ta = (2.2 - ro.y) / rd.y; let tb = (-2.2 - ro.y) / rd.y;
    t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb));
  } else if (abs(ro.y) > 2.2) { return vec4f(0.0); }
  let a = dot(rd.xz, rd.xz);
  let b = dot(ro.xz, rd.xz);
  let c = dot(ro.xz, ro.xz) - 22.0 * 22.0;
  let h = b * b - a * c;
  if (h < 0.0) { return vec4f(0.0); }
  let sh = sqrt(h);
  t0 = max(t0, (-b - sh) / max(a, 1e-9)); t1 = min(t1, (-b + sh) / max(a, 1e-9));
  if (t1 <= t0) { return vec4f(0.0); }
  let steps = i32(L.a.z);
  // (steps cluster near the eye: from inside the disc the nearby kiloparsec matters most)
  let jit = ign(in.pos.xy);
  var T = 1.0;
  var col = vec3f(0.0);
  let span = t1 - t0;
  var tPrev = t0;
  for (var i = 0; i < steps; i++) {
    let u = (f32(i) + jit) / f32(steps);
    let t = t0 + span * u * u;
    let dt = t - tPrev;
    tPrev = t;
    let g = galaxy(ro + rd * t);
    let tau = g.dust * L.a.y * dt;
    col += T * g.glow * L.a.x * dt * exp(-tau * 0.5);
    T *= exp(-tau);
    if (T < 0.01) { break; }
  }
  col = mix(col, band(rd) * L.d.y, L.a.w);
  return vec4f(col * L.weight, mix(1.0 - T, 0.0, L.a.w) * L.weight);
}
