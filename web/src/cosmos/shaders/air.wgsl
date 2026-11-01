// The Earth's air, as Boulder has it (world/atmosphere.wgsl and world.wgsl, after Hillaire 2020): the medium, its
// tables (airlut.wgsl makes them) and their sampling, for the levels that look through it (the Earth from space, the
// ground). The tables are in the camera's own frame (y its zenith, kilometres from the planet's centre); `AV` tells a
// level how its axes sit in that frame, so any level (km, m) can ask for the sky along its own view ray.
const R_BOTTOM = 6360.0;
const R_TOP = 6460.0;
/** the planet's surface seen from high up (km above the sea), just under the plains: the sky-view table's ground */
const PLANET_KM = 1.35;

struct AirView {
  ax: vec4f, ay: vec4f, az: vec4f,   // the camera's frame (east-ish, zenith, …) in the level's axes
  cam: vec4f,                        // x the camera's radius (km), y km per level unit, z the haze (Mie), w -
  center: vec4f,                     // the planet's centre relative to the level's origin (level units)
  sun: vec4f,                        // the sun in the camera's frame
}
@group(2) @binding(10) var tLut: texture_2d<f32>;
@group(2) @binding(11) var msLut: texture_2d<f32>;
@group(2) @binding(12) var svLut: texture_2d<f32>;
@group(2) @binding(13) var<uniform> AV: AirView;

struct Medium { scat: vec3f, ext: vec3f, ray: vec3f, mie: vec3f }
struct Scat { L: vec3f, T: vec3f }

fn medium(hKm: f32) -> Medium {
  var m: Medium;
  let h = max(hKm, 0.0);
  let rd = exp(-h / 8.0);
  // (aerosols: the haze near the ground, and a thin stratospheric layer that holds the twilight's glow)
  let md = exp(-h / 1.2) + 0.04 * exp(-(h - 20.0) * (h - 20.0) / 36.0);
  let od = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
  m.ray = vec3f(5.802, 13.558, 33.1) * 1e-3 * rd;
  m.mie = vec3f(3.996e-3) * md;
  let mieExt = vec3f(4.40e-3) * md;
  // (ozone: absorbing red as well as green keeps the twilight zenith blue and its glow orange)
  let ozone = vec3f(1.9, 1.881, 0.085) * 1e-3 * od;
  m.scat = m.ray + m.mie;
  m.ext = m.ray + mieExt + ozone;
  return m;
}
fn rayleighPhase(c: f32) -> f32 { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
fn miePhase(c: f32) -> f32 {
  let g = 0.78;
  let k = 3.0 / (8.0 * PI) * (1.0 - g * g) / (2.0 + g * g);
  return k * (1.0 + c * c) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
}

fn transmittanceUv(r: f32, mu: f32) -> vec2f {
  let H = sqrt(R_TOP * R_TOP - R_BOTTOM * R_BOTTOM);
  let rho = sqrt(max(0.0, r * r - R_BOTTOM * R_BOTTOM));
  let disc = r * r * (mu * mu - 1.0) + R_TOP * R_TOP;
  let d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  return vec2f((d - (R_TOP - r)) / (rho + H - (R_TOP - r)), rho / H);
}
fn tLookup(r: f32, mu: f32) -> vec3f { return textureSampleLevel(tLut, samp_linear, transmittanceUv(r, mu), 0.0).rgb; }
fn msLookup(r: f32, mu: f32) -> vec3f {
  let uv = vec2f(saturate(mu * 0.5 + 0.5), saturate((r - R_BOTTOM) / (R_TOP - R_BOTTOM)));
  return textureSampleLevel(msLut, samp_linear, (uv * 31.0 + 0.5) / 32.0, 0.0).rgb;
}
// the zenith angle of the atmosphere's upper edge from a radius (km) above it (0 inside)
fn skyTopZenith(vh: f32) -> f32 { return select(0.0, PI - asin(min(R_TOP / vh, 1.0)), vh > R_TOP); }

// transmittance from a point at an altitude (km) toward a zenith cosine, to space
fn transmittanceToSpace(altKm: f32, mu: f32) -> vec3f {
  let r = R_BOTTOM + max(altKm, 0.001);
  if (r > R_TOP) {
    // (from above the air: a ray clear of it keeps everything; one dipping in loses twice what its lowest point does)
    let rp = r * sqrt(max(0.0, 1.0 - mu * mu));
    if (mu >= 0.0 || rp >= R_TOP) { return vec3f(1.0); }
    let t = tLookup(max(rp, R_BOTTOM + 0.001), 0.0);
    return t * t;
  }
  return tLookup(r, mu);
}
// how much of the sun's disc stands above the earth's horizon from an altitude (km)
fn earthShadow(altKm: f32, mu: f32) -> f32 {
  let k = R_BOTTOM / (R_BOTTOM + max(altKm, 0.001));
  let horizon = -sqrt(max(0.0, 1.0 - k * k));
  return smoothstep(horizon - 0.0045, horizon + 0.0045, mu);
}

// a direction in the level's axes into the camera's frame
fn airLocal(d: vec3f) -> vec3f { return vec3f(dot(d, AV.ax.xyz), dot(d, AV.ay.xyz), dot(d, AV.az.xyz)); }
fn camAltKm() -> f32 { return AV.cam.x - R_BOTTOM; }

// the sky-view table's coordinates for a view (its zenith cosine, its azimuth's cosine from the sun's)
fn skyViewUv(vh: f32, viewZenithCos: f32, lightViewCos: f32, ground: bool) -> vec2f {
  let beta = acos(sqrt(max(0.0, vh * vh - R_BOTTOM * R_BOTTOM)) / vh);
  let zenithHorizon = PI - beta;
  var uv: vec2f;
  if (!ground) {
    let zTop = skyTopZenith(vh);
    var c = max(acos(clamp(viewZenithCos, -1.0, 1.0)) - zTop, 0.0) / (zenithHorizon - zTop);
    c = 1.0 - sqrt(max(1.0 - c, 0.0));
    uv.y = c * 0.5;
  } else {
    let c = (acos(clamp(viewZenithCos, -1.0, 1.0)) - zenithHorizon) / beta;
    uv.y = sqrt(max(c, 0.0)) * 0.5 + 0.5;
  }
  uv.x = sqrt(saturate(-lightViewCos * 0.5 + 0.5));
  let size = vec2f(192.0, 108.0);
  return (uv * (size - 1.0) + 0.5) / size;
}

// the air's light along a view ray from the camera (level axes): the sky, or, for a ray down to the planet, the air
// between the camera and its surface
fn skyAt(rdLevel: vec3f) -> vec3f {
  let rd = airLocal(rdLevel);
  let vh = AV.cam.x;
  let b = vh * rd.y;
  let ground = rd.y < 0.0 && (b * b - (vh * vh - R_BOTTOM * R_BOTTOM)) >= 0.0;
  let lh = normalize(AV.sun.xz + vec2f(1e-6, 0.0));
  let rh = rd.xz;
  let rl = length(rh);
  let lightViewCos = select(1.0, dot(rh / max(rl, 1e-6), lh), rl > 1e-5);
  return textureSampleLevel(svLut, samp_linear, skyViewUv(vh, rd.y, lightViewCos, ground), 0.0).rgb;
}

// what of a ground point's light (n: the planet's up there) reaches the camera along rd: from the ground up to space,
// over what's left of it from the camera up
fn groundToCamera(n: vec3f, rdLevel: vec3f) -> vec3f {
  let tg = transmittanceToSpace(PLANET_KM, max(dot(n, -rdLevel), 0.0));
  let tc = transmittanceToSpace(camAltKm(), -airLocal(rdLevel).y);
  return clamp(tg / max(tc, vec3f(1e-5)), vec3f(0.0), vec3f(1.0));
}
// a ground point's light as seen from high up, through the air (the sky-view table's light along the ray, its ground
// meeting this one)
fn throughAir(c: vec3f, n: vec3f, rdLevel: vec3f) -> vec3f { return skyAt(rdLevel) + groundToCamera(n, rdLevel) * c; }

// sunlight reaching a point at an altitude (km), its zenith toward the sun at cosine muS (sun illuminance 1 above)
fn sunAt(altKm: f32, muS: f32) -> vec3f { return transmittanceToSpace(altKm, muS) * earthShadow(altKm, muS); }

// the air between the camera and a point `tKm` along a view ray (level axes), for things near enough that the sky
// table's ground isn't theirs (the terrain): marched in a few steps through the tables
fn airSpan(rdLevel: vec3f, tKm: f32, n: i32) -> Scat {
  var s: Scat;
  s.L = vec3f(0.0);
  s.T = vec3f(1.0);
  let rd = airLocal(rdLevel);
  let sun = AV.sun.xyz;
  let ro = vec3f(0.0, AV.cam.x, 0.0);
  let c = dot(rd, sun);
  let pr = rayleighPhase(c);
  let pm = miePhase(c);
  var tPrev = 0.0;
  for (var k = 0; k < n; k++) {
    let f = f32(k + 1) / f32(n);
    let t = tKm * f * f;
    let dt = t - tPrev;
    let p = ro + rd * ((t + tPrev) * 0.5);
    tPrev = t;
    let r = length(p);
    let m = medium(r - R_BOTTOM);
    let st = exp(-m.ext * dt);
    let mu = dot(p / r, sun);
    let S = tLookup(r, mu) * earthShadow(r - R_BOTTOM, mu) * (m.ray * pr + m.mie * pm) + msLookup(r, mu) * m.scat;
    s.L += s.T * (S - S * st) / max(m.ext, vec3f(1e-6));
    s.T *= st;
  }
  return s;
}
