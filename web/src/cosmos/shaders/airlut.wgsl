// The Earth's air as tables, after Boulder's (world/atmosphere.wgsl, itself after Hillaire, "A Scalable and Production
// Ready Sky and Atmosphere Rendering Technique", EGSR 2020): Rayleigh, Mie and ozone over a spherical earth (km).
//   transmittance   256x64   to the top of the atmosphere, per altitude and zenith cosine (once)
//   multiScat       32x32    the higher orders of scattering as one isotropic term (once)
//   skyView         192x108  the sky seen from the camera's height, warped toward the horizon (each frame): its rays
//                            end on the planet's surface (PLANET_KM up), so a view down meets the ground's light there
// The tables live in the camera's own frame (y its zenith); air.wgsl samples them from any level's axes.
#include "weft/frame"
#include "air.wgsl"

const PI = 3.14159265;

struct AirLut { sun: vec4f, cam: vec4f }   // sun: its direction in the camera's frame; cam.x the camera's radius (km)
@group(2) @binding(0) var outTex: texture_storage_2d<rgba16float, write>;
@group(2) @binding(1) var<uniform> AL: AirLut;

const GROUND_ALBEDO = vec3f(0.22, 0.19, 0.14);

// nearest positive hit of a ray with a sphere at the origin (-1: none)
fn hitSphere(ro: vec3f, rd: vec3f, r: f32) -> f32 {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - r * r;
  let d = b * b - c;
  if (d < 0.0) { return -1.0; }
  let s = sqrt(d);
  if (-b - s >= 0.0) { return -b - s; }
  if (-b + s >= 0.0) { return -b + s; }
  return -1.0;
}

// ------------------------------------------------------------------ transmittance
@compute @workgroup_size(8, 8) fn transmittance(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2u(256u, 64u);
  if (any(id.xy >= size)) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
  let H = sqrt(R_TOP * R_TOP - R_BOTTOM * R_BOTTOM);
  let rho = H * uv.y;
  let r = sqrt(rho * rho + R_BOTTOM * R_BOTTOM);
  let dMin = R_TOP - r;
  let dMax = rho + H;
  let d = dMin + uv.x * (dMax - dMin);
  var mu = 1.0;
  if (d > 0.0) { mu = clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0); }
  let ro = vec3f(0.0, r, 0.0);
  let rd = vec3f(sqrt(1.0 - mu * mu), mu, 0.0);
  let tMax = hitSphere(ro, rd, R_TOP);
  var od = vec3f(0.0);
  let n = 40;
  let dt = tMax / f32(n);
  for (var i = 0; i < n; i++) {
    let p = ro + rd * (f32(i) + 0.5) * dt;
    od += medium(length(p) - R_BOTTOM).ext * dt;
  }
  textureStore(outTex, id.xy, vec4f(exp(-od), 1.0));
}

// ------------------------------------------------------------------ multiple scattering
var<workgroup> wgL: array<vec3f, 64>;
var<workgroup> wgF: array<vec3f, 64>;

@compute @workgroup_size(64) fn multiScat(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let uv = (vec2f(wg.xy) + 0.5) / 32.0;
  let cosSun = uv.x * 2.0 - 1.0;
  let r = R_BOTTOM + clamp(uv.y, 0.0005, 0.9995) * (R_TOP - R_BOTTOM);
  let ro = vec3f(0.0, r, 0.0);
  let sun = vec3f(sqrt(max(0.0, 1.0 - cosSun * cosSun)), cosSun, 0.0);
  // one direction per thread: an 8x8 equal-area grid over the sphere
  let i = f32(li % 8u);
  let j = f32(li / 8u);
  let phi = 2.0 * PI * (i + 0.5) / 8.0;
  let cosT = 1.0 - 2.0 * (j + 0.5) / 8.0;
  let sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
  let rd = vec3f(sinT * cos(phi), cosT, sinT * sin(phi));
  let tGround = hitSphere(ro, rd, R_BOTTOM);
  let tTop = hitSphere(ro, rd, R_TOP);
  let tMax = select(tTop, tGround, tGround > 0.0);
  let n = 20;
  let dt = tMax / f32(n);
  var L = vec3f(0.0);
  var F = vec3f(0.0);
  var T = vec3f(1.0);
  let uniformPhase = 1.0 / (4.0 * PI);
  for (var k = 0; k < n; k++) {
    let p = ro + rd * (f32(k) + 0.5) * dt;
    let pr = length(p);
    let m = medium(pr - R_BOTTOM);
    let st = exp(-m.ext * dt);
    let mu = dot(p / pr, sun);
    let sunT = tLookup(pr, mu) * select(1.0, 0.0, hitSphere(p, sun, R_BOTTOM) > 0.0);
    let S = m.scat * uniformPhase * sunT;
    L += T * (S - S * st) / max(m.ext, vec3f(1e-6));
    F += T * (m.scat - m.scat * st) / max(m.ext, vec3f(1e-6));
    T *= st;
  }
  if (tGround > 0.0) {
    let up = normalize(ro + rd * tGround);
    L += T * tLookup(R_BOTTOM, dot(up, sun)) * saturate(dot(up, sun)) * GROUND_ALBEDO / PI;
  }
  wgL[li] = L / 64.0;
  wgF[li] = F / 64.0;
  workgroupBarrier();
  var s = 32u;
  while (s > 0u) {
    if (li < s) { wgL[li] += wgL[li + s]; wgF[li] += wgF[li + s]; }
    workgroupBarrier();
    s = s / 2u;
  }
  if (li == 0u) { textureStore(outTex, wg.xy, vec4f(wgL[0] / (1.0 - wgF[0]), 1.0)); }
}

// ------------------------------------------------------------------ the sky from the camera
// along a stretch [t0, t1] of a ray, its samples crowded toward the stretch's end (toEnd) or its start
fn span(ro: vec3f, rd: vec3f, t0: f32, t1: f32, n: i32, sun: vec3f, toEnd: bool) -> Scat {
  var s: Scat;
  s.L = vec3f(0.0);
  s.T = vec3f(1.0);
  let c = dot(rd, sun);
  let pr = rayleighPhase(c);
  let pm = miePhase(c);
  var wPrev = 0.0;
  for (var k = 0; k < n; k++) {
    let f = f32(k + 1) / f32(n);
    let w = select(f * f, 1.0 - (1.0 - f) * (1.0 - f), toEnd);
    let dt = (t1 - t0) * (w - wPrev);
    let p = ro + rd * (t0 + (t1 - t0) * (w + wPrev) * 0.5);
    wPrev = w;
    let r = length(p);
    let m = medium(r - R_BOTTOM);
    let st = exp(-m.ext * dt);
    let mu = dot(p / r, sun);
    let earth = select(1.0, 0.0, hitSphere(p, sun, R_BOTTOM) > 0.0);
    let S = tLookup(r, mu) * earth * (m.ray * pr + m.mie * pm) + msLookup(r, mu) * m.scat;
    s.L += s.T * (S - S * st) / max(m.ext, vec3f(1e-6));
    s.T *= st;
  }
  return s;
}

@compute @workgroup_size(8, 8) fn skyView(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2u(192u, 108u);
  if (any(id.xy >= size)) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
  let vh = AL.cam.x;
  let beta = acos(sqrt(max(0.0, vh * vh - R_BOTTOM * R_BOTTOM)) / vh);
  let zenithHorizon = PI - beta;
  let zTop = skyTopZenith(vh);
  var zenith: f32;
  if (uv.y < 0.5) {
    var c = 1.0 - 2.0 * uv.y;
    c = 1.0 - c * c;
    zenith = zTop + (zenithHorizon - zTop) * c;
  } else {
    var c = uv.y * 2.0 - 1.0;
    c = c * c;
    zenith = zenithHorizon + beta * c;
  }
  let lc = uv.x * uv.x;
  let phi = acos(clamp(-(lc * 2.0 - 1.0), -1.0, 1.0));
  let rd = vec3f(sin(zenith) * cos(phi), cos(zenith), sin(zenith) * sin(phi));
  let sunC = clamp(AL.sun.y, -1.0, 1.0);
  let sun = vec3f(sqrt(max(0.0, 1.0 - sunC * sunC)), sunC, 0.0);
  let ro = vec3f(0.0, vh, 0.0);
  let rG = R_BOTTOM + PLANET_KM;
  let tGround = hitSphere(ro, rd, rG);
  var s: Scat;
  s.L = vec3f(0.0);
  if (vh > R_TOP) {
    // (from above the air: in at its edge, then down to the ground or through the limb and out)
    let b = dot(ro, rd);
    let disc = b * b - dot(ro, ro) + R_TOP * R_TOP;
    if (b < 0.0 && disc > 0.0) {
      let t0 = -b - sqrt(disc);
      if (tGround > 0.0) { s = span(ro, rd, t0, tGround, 32, sun, true); }
      else {
        let a = span(ro, rd, t0, -b, 24, sun, true);
        let z = span(ro, rd, -b, -b + sqrt(disc), 24, sun, false);
        s.L = a.L + a.T * z.L;
      }
    }
  } else if (tGround > 0.0) {
    s = span(ro, rd, 0.0, tGround, 32, sun, true);
  } else {
    s = span(ro, rd, 0.0, max(hitSphere(ro, rd, R_TOP), 0.0), 30, sun, false);
  }
  textureStore(outTex, id.xy, vec4f(s.L, 1.0));
}
