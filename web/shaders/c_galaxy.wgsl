// The Milky Way as a volume (kiloparsecs, its centre at the frame's origin): an exponential disc of old stars, two
// major and two minor logarithmic spiral arms of young blue stars with pink HII regions along them, a bar and a bulge,
// and dark dust lanes on the arms' inner edges. Marched through its slab; from the Sun's place in it the same march
// draws the band of the Milky Way across the sky. L.a: emission gain, dust gain, steps.
#include "cosmos.wgsl"
#include "weft/fullscreen"

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
  let wob = fbm(p * 0.45, 3) * 1.4;
  let a2 = pow(0.5 + 0.5 * cos(2.0 * ph + wob), 5.0);
  let a4 = pow(0.5 + 0.5 * cos(2.0 * ph + 3.14159 + wob * 1.3), 7.0) * 0.55;
  let arms = (a2 + a4) * ss(2.2, 4.5, r) * exp(-r / 6.0) * exp(-z / 0.16);
  // the bar and the bulge
  let cb = cos(BAR); let sb = sin(BAR);
  let q = vec2f(p.x * cb + p.z * sb, -p.x * sb + p.z * cb);
  let bar = exp(-(q.x * q.x) / (3.4 * 3.4) - (q.y * q.y) / (1.0 * 1.0)) * exp(-z / 0.35);
  let bulge = exp(-length(p * vec3f(1.0, 1.45, 1.0)) / 0.55);
  // knots of star formation strung along the arms
  let knots = pow(max(vnoise(p * 2.6) * 0.5 + 0.5 - 0.62, 0.0) * 3.0, 3.0) * arms * 6.0;
  g.glow = vec3f(1.0, 0.78, 0.52) * (bulge * 9.0 + bar * 3.2)
         + vec3f(1.0, 0.86, 0.72) * disc * 1.6
         + vec3f(0.58, 0.72, 1.0) * arms * 2.6
         + vec3f(1.0, 0.35, 0.55) * knots;
  // dust: a thin layer, thickest just inside the arms
  let dph = pow(0.5 + 0.5 * cos(2.0 * ph + 0.55 + wob), 4.0) + 0.5 * pow(0.5 + 0.5 * cos(2.0 * ph + 3.69 + wob * 1.3), 6.0);
  g.dust = (dph * 0.85 + 0.15) * exp(-r / 4.5) * exp(-z / 0.09) * ss(0.8, 2.6, r) * (0.55 + 0.9 * max(fbm(p * 1.7 + 11.0, 4), 0.0));
  return g;
}

@fragment fn fs(in: FullscreenOut) -> @location(0) vec4f {
  let rd = rayDir(in.uv);
  let ro = L.eye + L.origin;
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
  let jit = hash3u(vec3u(vec2u(in.pos.xy), frame.frame % 64u)).x;
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
  return vec4f(col * L.weight, (1.0 - T) * L.weight);
}
