// A physically based atmosphere after Hillaire, "A Scalable and Production Ready Sky and Atmosphere Rendering
// Technique" (EGSR 2020): Rayleigh, Mie and ozone over a spherical earth, four lookup tables.
//   transmittance   256x64   to the top of the atmosphere, per altitude and zenith cosine (once)
//   multiScat       32x32    the infinite series of higher scattering orders as one isotropic term (once)
//   skyView         192x216  the sky seen from the camera's altitude, latitude-warped toward the horizon (per frame):
//                            two skies, the sun's (top half) and the moon's (bottom), each in its own light's frame
//   aerial          32^3     in-scattering and transmittance over the view frustum to 128 km (per frame), both lights
// plus the sky's irradiance as L1 spherical harmonics for every lit surface's ambient term. Both lights are always in
// (the sun's twilight glow fading as the moon's light takes over), each table already scaled by its light's strength.
// The Seven Havens' air (AL.air, AL.dust): Rayleigh scattering that takes the greens nearly as much as the blues (a
// teal sky, its sunsets the reds the long way through it leaves), and the desert's dust pooled over the canyon floor —
// warm in the light it scatters, golden toward a low sun, a cream band along the horizon. The moon's sky is taken as
// the eye takes it (AL.night: navy and indigo, not a dim teal day). And the sky is painted: the dome brighter than the
// air would make it and leaned toward the show's teal-green (AL.paint), luminous and pastel over the red rock — the sky
// itself and what reflects it, the far air going to it with distance — while its light on the land stays near the
// air's own, leaned toward lavender (AL.shade: the shadows on the red rock go violet, not teal).
#include "./world.wgsl"

struct AtmoLights {
  sun: vec4f,       // xyz the direction, w its strength (0: left out)
  moon: vec4f,
  air: vec4f,       // x the sky's havens-ness (0 the earth's blue .. 1 sea green), y the dust over the canyon floor (/km),
                    // z its scale height (km), w -
  dust: vec4f,      // rgb the dust's single-scattering albedo (its colour), w -
  night: vec4f,     // rgb the moon's sky (its light in the air and on the land) as the eye takes it, w -
  paint: vec4f,     // rgb the sun's sky as painted (the dome's gain by channel: the far air goes to it with distance), w how
                    // far off (km) the far air has most of it
  shade: vec4f,     // rgb the sun's sky's light on the land (the ambient's gain by channel), w -
  haze: vec4f,      // rgb the haze over the land (the gain on the sun's light scattered in the air between the eye and a
                    // surface: the aerial table alone), w -
}
@group(2) @binding(0) var tLut: texture_2d<f32>;
@group(2) @binding(1) var msLut: texture_2d<f32>;
@group(2) @binding(2) var svLut: texture_2d<f32>;
@group(2) @binding(3) var outTex: texture_storage_2d<rgba16float, write>;
@group(2) @binding(4) var outVol: texture_storage_3d<rgba16float, write>;
@group(2) @binding(5) var<storage, read_write> shOut: array<vec4f, 4>;
@group(2) @binding(6) var<uniform> AL: AtmoLights;

// (the canyon's red sandstone and sand: the light it bounces up into the air and onto everything's underside)
const GROUND_ALBEDO = vec3f(0.36, 0.22, 0.15);
const MIE_G = 0.78;

struct Medium { scat: vec3f, ext: vec3f, ray: vec3f, mie: vec3f }

fn medium(hKm: f32) -> Medium {
  var m: Medium;
  let h = max(hKm, 0.0);
  let rd = exp(-h / 8.0);
  // (aerosols: the haze near the ground, and the thin stratospheric layer some 20 km up that holds the twilight's glow
  // over the western horizon after the sun has set)
  let md = exp(-h / 1.2) + 0.04 * exp(-(h - 20.0) * (h - 20.0) / 36.0);
  let od = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
  // (the earth's Rayleigh coefficients toward the other Boulder's, which scatter the greens nearly as much as the blues)
  m.ray = mix(vec3f(5.802, 13.558, 33.1), vec3f(3.4, 20.5, 19.0), AL.air.x) * 1e-3 * rd * world.haze.y;
  // the dust: as dense as it is over the canyon floor anywhere lower, thinning above it; it takes more of the blue than
  // it sends on (its albedo), so what it scatters is warm and what comes through it yellows
  let dd = AL.air.y * exp(-max(h - world.site.x, 0.0) / max(AL.air.z, 0.05));
  m.mie = (vec3f(7.99e-3) * md + AL.dust.rgb * dd) * world.haze.x;
  let mieExt = (vec3f(8.8e-3) * md + vec3f(dd)) * world.haze.x;
  // (ozone's Chappuis band peaks near 600 nm, inside the red channel as much as the green: absorbing red as well as
  // green keeps the twilight zenith blue and its glow orange rather than magenta)
  let ozone = vec3f(1.9, 1.881, 0.085) * 1e-3 * od;
  m.scat = m.ray + m.mie;
  m.ext = m.ray + mieExt + ozone;
  return m;
}

fn rayleighPhase(c: f32) -> f32 { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
fn miePhase(c: f32) -> f32 {
  let g = MIE_G;
  let k = 3.0 / (8.0 * PI) * (1.0 - g * g) / (2.0 + g * g);
  return k * (1.0 + c * c) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
}

// nearest positive hit of a ray with a sphere at the origin (-1: none)
fn raySphere(ro: vec3f, rd: vec3f, r: f32) -> f32 {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - r * r;
  let d = b * b - c;
  if (d < 0.0) { return -1.0; }
  let s = sqrt(d);
  let t0 = -b - s;
  let t1 = -b + s;
  if (t0 >= 0.0) { return t0; }
  if (t1 >= 0.0) { return t1; }
  return -1.0;
}

fn tLookup(r: f32, mu: f32) -> vec3f {
  return textureSampleLevel(tLut, samp_linear, transmittanceUv(r, mu), 0.0).rgb;
}
fn msLookup(r: f32, mu: f32) -> vec3f {
  let uv = vec2f(saturate(mu * 0.5 + 0.5), saturate((r - R_BOTTOM) / (R_TOP - R_BOTTOM)));
  let s = 32.0;
  return textureSampleLevel(msLut, samp_linear, (uv * (s - 1.0) + 0.5) / s, 0.0).rgb;
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
  let tMax = raySphere(ro, rd, R_TOP);
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
  let tGround = raySphere(ro, rd, R_BOTTOM);
  let tTop = raySphere(ro, rd, R_TOP);
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
    let up = p / pr;
    let mu = dot(up, sun);
    let sunT = tLookup(pr, mu) * select(1.0, 0.0, raySphere(p, sun, R_BOTTOM) > 0.0);
    let S = m.scat * uniformPhase * sunT;
    let Sint = (S - S * st) / max(m.ext, vec3f(1e-6));
    L += T * Sint;
    let Fint = (m.scat - m.scat * st) / max(m.ext, vec3f(1e-6));
    F += T * Fint;
    T *= st;
  }
  if (tGround > 0.0) {
    let p = ro + rd * tGround;
    let up = normalize(p);
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
  if (li == 0u) {
    let ms = wgL[0] / (1.0 - wgF[0]);
    textureStore(outTex, wg.xy, vec4f(ms, 1.0));
  }
}

// ------------------------------------------------------------------ scattering along a ray (sky view, aerial)
struct Scat { L: vec3f, T: vec3f }

fn integrate(ro: vec3f, rd: vec3f, tMax: f32, n: i32, sun: vec3f) -> Scat {
  var s: Scat;
  s.L = vec3f(0.0);
  s.T = vec3f(1.0);
  let c = dot(rd, sun);
  let pr = rayleighPhase(c);
  let pm = miePhase(c);
  var tPrev = 0.0;
  for (var k = 0; k < n; k++) {
    // denser near the camera
    let f = (f32(k) + 0.3) / f32(n);
    let t = tMax * f * f;
    let dt = t - tPrev;
    tPrev = t;
    let p = ro + rd * t;
    let r = length(p);
    let m = medium(r - R_BOTTOM);
    let st = exp(-m.ext * dt);
    let up = p / r;
    let mu = dot(up, sun);
    let earth = select(1.0, 0.0, raySphere(p, sun, R_BOTTOM) > 0.0);
    let sunT = tLookup(r, mu) * earth;
    let ms = msLookup(r, mu);
    let S = sunT * (m.ray * pr + m.mie * pm) + ms * m.scat;
    let Sint = (S - S * st) / max(m.ext, vec3f(1e-6));
    s.L += s.T * Sint;
    s.T *= st;
  }
  return s;
}

fn viewHeight() -> f32 { return R_BOTTOM + max(altitudeKm(frame.camPos), 0.01); }

@compute @workgroup_size(8, 8) fn skyView(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2u(192u, 108u);
  if (id.x >= size.x || id.y >= size.y * 2u) { return; }
  // (the top half the sun's sky, the bottom the moon's)
  let moonHalf = id.y >= size.y;
  let light = select(AL.sun, AL.moon, moonHalf);
  // (a light that's out, or far below the horizon — the true one, however high the camera — lights no sky)
  if (light.w <= 0.0 || light.y < -0.36 + horizonDrop()) { textureStore(outTex, id.xy, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let uv = (vec2f(f32(id.x), f32(id.y % size.y)) + 0.5) / vec2f(size);
  let vh = viewHeight();
  let vHorizon = sqrt(max(0.0, vh * vh - R_BOTTOM * R_BOTTOM));
  let cosBeta = vHorizon / vh;
  let beta = acos(cosBeta);
  let zenithHorizon = PI - beta;
  var zenith: f32;
  if (uv.y < 0.5) {
    var c = 1.0 - 2.0 * uv.y;
    c = 1.0 - c * c;
    zenith = zenithHorizon * c;
  } else {
    var c = uv.y * 2.0 - 1.0;
    c = c * c;
    zenith = zenithHorizon + beta * c;
  }
  var lc = uv.x;
  lc = lc * lc;
  let lightViewCos = -(lc * 2.0 - 1.0);
  let phi = acos(clamp(lightViewCos, -1.0, 1.0));
  let rd = vec3f(sin(zenith) * cos(phi), cos(zenith), sin(zenith) * sin(phi));
  let sunC = clamp(light.y, -1.0, 1.0);
  let sun = vec3f(sqrt(max(0.0, 1.0 - sunC * sunC)), sunC, 0.0);
  let ro = vec3f(0.0, vh, 0.0);
  let tGround = raySphere(ro, rd, R_BOTTOM);
  let tTop = raySphere(ro, rd, R_TOP);
  let tMax = select(tTop, tGround, tGround > 0.0);
  let s = integrate(ro, rd, max(tMax, 0.0), 30, sun);
  // (the moon's sky navy overhead, toward indigo low down)
  let night = AL.night.rgb * mix(vec3f(1.2, 0.85, 1.0), vec3f(1.0), smoothstep(0.0, 0.5, rd.y));
  textureStore(outTex, id.xy, vec4f(s.L * light.w * select(AL.paint.rgb, night, moonHalf), 1.0));
}

// what a light (direction, strength) scatters toward the viewer at a point (radius r, up its zenith) in a medium
fn inScatter(p: vec3f, r: f32, m: Medium, light: vec4f, pr: f32, pm: f32) -> vec3f {
  if (light.w <= 0.0) { return vec3f(0.0); }
  let up = p / length(p);
  let mu = dot(up, light.xyz);
  let earth = select(1.0, 0.0, raySphere(up * r, light.xyz, R_BOTTOM) > 0.0);
  return (tLookup(r, mu) * earth * (m.ray * pr + m.mie * pm) + msLookup(r, mu) * m.scat) * light.w;
}

@compute @workgroup_size(8, 8) fn aerialVolume(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= vec2u(32u))) { return; }
  let uv = (vec2f(id.xy) + 0.5) / 32.0;
  let rd = viewRay(uv);
  let ro = vec3f(0.0, viewHeight(), 0.0);
  var L = vec3f(0.0);
  var T = vec3f(1.0);
  var tPrev = 0.0;
  let cs = dot(rd, AL.sun.xyz);
  let cm = dot(rd, AL.moon.xyz);
  let prs = rayleighPhase(cs); let pms = miePhase(cs);
  let prm = rayleighPhase(cm); let pmm = miePhase(cm);
  let tGround = raySphere(ro, rd, R_BOTTOM);
  for (var k = 0u; k < 32u; k++) {
    let w = (f32(k) + 0.5) / 32.0;
    let tSlice = AP_MAX_KM * w * w;
    // two steps per slice
    for (var j = 0; j < 2; j++) {
      let t = mix(tPrev, tSlice, (f32(j) + 0.5) / 2.0);
      let dt = (tSlice - tPrev) * 0.5;
      var p = ro + rd * t;
      if (tGround > 0.0 && t > tGround) { p = ro + rd * tGround; }
      let r = max(length(p), R_BOTTOM + 0.001);
      let m = medium(r - R_BOTTOM);
      let st = exp(-m.ext * dt);
      // (the sun's share painted brighter with distance, as the dome is)
      let far = 1.0 + (AL.paint.rgb - 1.0) * (1.0 - exp(-t / max(AL.paint.w, 0.1)));
      let S = inScatter(p, r, m, AL.sun, prs, pms) * far * AL.haze.rgb + inScatter(p, r, m, AL.moon, prm, pmm) * AL.night.rgb;
      L += T * (S - S * st) / max(m.ext, vec3f(1e-6));
      T *= st;
    }
    tPrev = tSlice;
    textureStore(outVol, vec3u(id.xy, k), vec4f(L, dot(T, vec3f(1.0 / 3.0))));
  }
}

// ------------------------------------------------------------------ the sky's irradiance (L1 SH)
fn skyHalfFrom(lut: texture_2d<f32>, rd: vec3f, light: vec3f, moonHalf: f32) -> vec3f {
  let vh = viewHeight();
  let ro = vec3f(0.0, vh, 0.0);
  let ground = raySphere(ro, rd, R_BOTTOM) > 0.0;
  let lh = normalize(vec2f(light.x, light.z) + vec2f(1e-6, 0.0));
  let rh = vec2f(rd.x, rd.z);
  let rl = length(rh);
  let lightViewCos = select(1.0, dot(rh / max(rl, 1e-6), lh), rl > 1e-5);
  return textureSampleLevel(lut, samp_linear, skyViewUv(vh, rd.y, lightViewCos, ground, moonHalf), 0.0).rgb;
}
// (the light on the land: the sun's sky at the ambient's gain rather than the dome's)
fn skyRadianceFrom(lut: texture_2d<f32>, rd: vec3f) -> vec3f {
  return skyHalfFrom(lut, rd, AL.sun.xyz, 0.0) * AL.shade.rgb / max(AL.paint.rgb, vec3f(1e-3)) + skyHalfFrom(lut, rd, AL.moon.xyz, 1.0);
}

// the ground's light below the horizon: the terrain's albedo under a light and the sky it makes
fn groundUnder(light: vec4f) -> vec3f {
  if (light.w <= 0.0) { return vec3f(0.0); }
  let T = tLookup(viewHeight(), light.y) * light.w;
  return T * saturate(light.y) + vec3f(0.06, 0.08, 0.11) * saturate(light.y + 0.1) * 2.0 * light.w;
}

var<workgroup> wgSh: array<array<vec3f, 4>, 64>;

@compute @workgroup_size(64) fn irradiance(@builtin(local_invocation_index) li: u32) {
  var acc = array<vec3f, 4>(vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0));
  let N = 1024u;
  // ground light below the horizon: the terrain's albedo under the sun, the moon and the sky they make
  let groundL = GROUND_ALBEDO / PI * (groundUnder(AL.sun) + groundUnder(AL.moon) * AL.night.rgb);
  // (the horizon where it truly is from the camera's height)
  let drop = horizonDrop();
  for (var k = li; k < N; k += 64u) {
    // fibonacci sphere
    let fi = f32(k) + 0.5;
    let z = 1.0 - 2.0 * fi / f32(N);
    let r = sqrt(max(0.0, 1.0 - z * z));
    let a = fi * 2.39996323;
    let d = vec3f(r * cos(a), z, r * sin(a));
    var L: vec3f;
    if (d.y > -0.02 + drop) { L = skyRadianceFrom(svLut, normalize(vec3f(d.x, max(d.y, drop), d.z))); }
    else { L = groundL; }
    acc[0] += L * 0.282095;
    acc[1] += L * 0.488603 * d.y;
    acc[2] += L * 0.488603 * d.z;
    acc[3] += L * 0.488603 * d.x;
  }
  wgSh[li] = acc;
  workgroupBarrier();
  var s = 32u;
  while (s > 0u) {
    if (li < s) { for (var c = 0; c < 4; c++) { wgSh[li][c] += wgSh[li + s][c]; } }
    workgroupBarrier();
    s = s / 2u;
  }
  if (li == 0u) {
    let w = 4.0 * PI / f32(N);
    // irradiance / pi: A0 = pi, A1 = 2 pi / 3, each times its basis constant
    shOut[0] = vec4f(wgSh[0][0] * w * 0.282095, 0.0);
    shOut[1] = vec4f(wgSh[0][1] * w * 0.488603 * (2.0 / 3.0), 0.0);
    shOut[2] = vec4f(wgSh[0][2] * w * 0.488603 * (2.0 / 3.0), 0.0);
    shOut[3] = vec4f(wgSh[0][3] * w * 0.488603 * (2.0 / 3.0), 0.0);
  }
}
