// The world every lit pass sees: the app globals (group 0, binding 1) and the shared environment (group 3: env.ts
// WORLD_GROUP, clear of a host's own group 1 — Universe's): the atmosphere's lookup tables, the sun's cascaded shadow
// map, the sky's irradiance, the terrain's heights, the clouds' shadow (cloudsky.wgsl), the aurora's dome map (its
// light in reflections and on the ground), and the weather's lightning and wet ground (weather/weather.wgsl). Ported
// from boulder; the canyon's own things (the layout, the stone) live with the parts that draw them.
// Units: metres in the world (x east, y up above the plaza's ground, z south), kilometres in the atmosphere.
#include "weft/frame"

struct World {
  sunDir: vec3f, sunCos: f32,          // unit vector toward the key light (the sun, or the moon by night); its height
  moonDir: vec3f, exposure: f32,
  wind: vec4f,                          // xy direction, z strength (m/s), w gust phase
  cascades: array<mat4x4f, 4>,          // world -> light clip, per shadow cascade
  splits: vec4f,                        // far distance of each cascade (m)
  shadowParams: vec4f,                  // x texel size of cascade 0 (m), y bias, z normal offset, w cascade count
  site: vec4f,                          // x ground elevation of the origin (km above sea level), y earth radius (km), z time (s), w day fraction
  haze: vec4f,                          // x mie density scale, y rayleigh scale, z ambient boost, w sun scale
  terrainLevels: array<vec4f, 5>,       // per height level: half extent (m), texel (m), centre x, centre z (m)
  ground: vec4f,                        // x the highest ground anywhere (m), y the lowest, zw -
  sunTrue: vec4f,                       // xyz the sun's direction (always the sun), w night (0 day .. 1 full night)
  moon: vec4f,                          // x illuminated fraction, y angular radius (rad), z the moon is the key light, w disc radiance
  night: vec4f,                         // x star brightness, y milky way, z airglow + the city's glow, w night ambient
  eqX: vec4f, eqY: vec4f, eqZ: vec4f,   // equatorial unit vectors -> world (local sidereal time)
  aurora0: vec4f,                       // x brightness (on screen: strength x glow / exposure), y reach, z height scale, w its clock (s)
  aurora1: vec4f,                       // rgb the body's colour (~100-180 km), w ray density
  aurora2: vec4f,                       // rgb the crown's (above ~200 km), w folds
  aurora3: vec4f,                       // rgb the hem's flare (the lower edge), w curtain thickness (km)
  lamps: array<vec4f, 16>,              // up to 8 lamps (fire, lanterns), 2 each: xyz where, w strength (scene
                                        // illuminance at 1 m: candela x level / 128000); rgb colour, w the wall it's on
                                        // (its outward facing, an angle from +x toward +z) or 9 (all round)
  glow: vec4f,                          // the city's glow on the night sky: xz the unit way toward it (level), y how much it's
                                        // that way (0 all round: inside it), w its strength
}
@group(0) @binding(1) var<uniform> world: World;

@group(3) @binding(0) var transmittanceLut: texture_2d<f32>;
@group(3) @binding(1) var multiScatLut: texture_2d<f32>;
@group(3) @binding(2) var skyViewLut: texture_2d<f32>;
@group(3) @binding(3) var aerialLut: texture_3d<f32>;
@group(3) @binding(4) var shadowMap: texture_depth_2d_array;
@group(3) @binding(5) var<storage, read> skyIrradiance: array<vec4f, 4>;   // L1 spherical harmonics, rgb + pad
@group(3) @binding(6) var heights: texture_2d_array<f32>;                 // r32float, one layer per level
@group(3) @binding(7) var terrainShadow: texture_2d_array<f32>;           // sun visibility per level (r8)
@group(3) @binding(10) var auroraDome: texture_2d<f32>;                   // the aurora over the sky, polar (aurora.wgsl)

const PI = 3.14159265359;
// the terrain's nested height levels, finest first, each a square round its own centre (world/terrain.ts)
const TERRAIN_LEVELS = 5;

// ------------------------------------------------------------------ atmosphere (Hillaire 2020), km
const R_BOTTOM = 6360.0;
const R_TOP = 6460.0;
const AP_MAX_KM = 128.0;
// the horizon's zenith cosine from 3 km up: the gates set for the sky seen from the ground stay put up to there
const HORIZON_LOW = -0.0307;

fn altitudeKm(p: vec3f) -> f32 { return world.site.x + p.y * 0.001; }

// the zenith cosine of the earth's limb (the sea-level sphere) seen from an altitude (km)
fn horizonCos(altKm: f32) -> f32 {
  let k = R_BOTTOM / (R_BOTTOM + max(altKm, 0.001));
  return -sqrt(max(0.0, 1.0 - k * k));
}

// how far the camera's horizon has sunk below where it is from the ground (a zenith cosine, 0 up to 3 km): what's
// hidden below the horizon is hidden below the true one, however high
fn horizonDrop() -> f32 { return min(0.0, horizonCos(altitudeKm(frame.camPos)) - HORIZON_LOW); }

fn transmittanceUv(r: f32, mu: f32) -> vec2f {
  let H = sqrt(R_TOP * R_TOP - R_BOTTOM * R_BOTTOM);
  let rho = sqrt(max(0.0, r * r - R_BOTTOM * R_BOTTOM));
  let disc = r * r * (mu * mu - 1.0) + R_TOP * R_TOP;
  let d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  let dMin = R_TOP - r;
  let dMax = rho + H;
  return vec2f((d - dMin) / (dMax - dMin), rho / H);
}

// transmittance from a point at altitude (km) toward a direction with cosine mu from its zenith, to space
fn transmittanceToSpace(altKm: f32, mu: f32) -> vec3f {
  let r = R_BOTTOM + max(altKm, 0.001);
  // (from above the air: a ray clear of it keeps everything; one that dips into it loses twice what it would from its
  // lowest point, by symmetry; the table's own rays all start inside)
  if (r > R_TOP) {
    let rp = r * sqrt(max(0.0, 1.0 - mu * mu));
    if (mu >= 0.0 || rp >= R_TOP) { return vec3f(1.0); }
    let t = textureSampleLevel(transmittanceLut, samp_linear, transmittanceUv(max(rp, R_BOTTOM + 0.001), 0.0), 0.0).rgb;
    return t * t;
  }
  return textureSampleLevel(transmittanceLut, samp_linear, transmittanceUv(r, mu), 0.0).rgb;
}

// how much of the key light's disc stands above the earth's horizon from an altitude (km)
fn earthShadow(altKm: f32, mu: f32) -> f32 {
  let k = R_BOTTOM / (R_BOTTOM + max(altKm, 0.001));
  let horizon = -sqrt(max(0.0, 1.0 - k * k));
  return smoothstep(horizon - 0.0045, horizon + 0.0045, mu);
}

// the key light's colour beyond the air's: white for the sun; the moon's as the eye takes it at night, cool and a
// little violet (the Seven Havens' moonlight)
const MOON_TINT = vec3f(0.46, 0.66, 1.55);
fn keyTint() -> vec3f { return mix(vec3f(1.0), MOON_TINT, world.moon.z); }

// the sun's light arriving at a world point (sun illuminance 1 outside the atmosphere)
fn sunLight(p: vec3f) -> vec3f {
  let h = altitudeKm(p);
  return transmittanceToSpace(h, world.sunDir.y) * world.haze.w * earthShadow(h, world.sunDir.y) * cloudShadow(p) * keyTint();
}

// where a direction falls on the aurora's dome map: the zenith in the middle, the horizon round the edge
fn auroraDomeUv(d: vec3f) -> vec2f {
  let r = min(acos(clamp(d.y, -1.0, 1.0)) / (PI * 0.5), 1.0);
  return vec2f(0.5) + 0.5 * normalize(vec2f(d.x, d.z) + vec2f(1e-6, 0.0)) * r;
}

// the aurora's light on a surface facing n (irradiance over pi, as skyAmbient): the whole dome's mean (its last level:
// the arcs low in the north light a level patch too) and a coarse level round the part of the sky the surface faces,
// mostly its core's teal-green (the magenta and violet tops spread over much of the sky but carry little of the light
// that reaches the ground), strong enough to tint the land on a bright night (by night: the day's veil lights nothing)
fn auroraLight(n: vec3f) -> vec3f {
  if (world.aurora0.x <= 0.0) { return vec3f(0.0); }
  let d = normalize(n * 0.8 + vec3f(0.0, 0.6, 0.0));
  let mean = textureSampleLevel(auroraDome, samp_linear, vec2f(0.5), 9.0).rgb * (4.0 / PI);
  let face = textureSampleLevel(auroraDome, samp_linear, auroraDomeUv(d), 6.0).rgb;
  let c = (mean * 0.6 + face * 0.4) * (0.4 + 0.6 * saturate(0.5 + 0.5 * n.y)) * 7.0 * world.sunTrue.w;
  let luma = vec3f(0.2126, 0.7152, 0.0722);
  let g = world.aurora1.rgb / max(dot(world.aurora1.rgb, luma), 1e-3);
  return mix(c, dot(c, luma) * g, 0.65);
}

// L1 spherical harmonics irradiance (already convolved with the cosine lobe, divided by pi), plus at night the glow of
// a moonless sky (airglow, starlight, the city's light) and the aurora's light, and a lightning flash's
fn skyAmbient(n: vec3f) -> vec3f {
  let c0 = skyIrradiance[0].rgb;
  let c1 = skyIrradiance[1].rgb;
  let c2 = skyIrradiance[2].rgb;
  let c3 = skyIrradiance[3].rgb;
  let up = 0.5 + 0.5 * n.y;
  let nightGlow = (vec3f(0.55, 0.62, 0.85) * up + vec3f(0.5, 0.36, 0.22) * 0.25) * world.night.w;
  let clear = max(vec3f(0.0), c0 + c1 * n.y + c2 * n.z + c3 * n.x) * world.haze.z;
  return cloudAmbient(n, clear, max(vec3f(0.0), c0 + c1) * world.haze.z) + nightGlow + auroraLight(n) + flashAmbient(n);
}

// aerial perspective: in-scattered light (rgb) and mean transmittance (a) between the camera and a world point
fn aerial(p: vec3f) -> vec4f {
  let clip = frame.viewProj * vec4f(p, 1.0);
  let ndc = clip.xy / max(clip.w, 1e-4);
  let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  let dKm = length(p - frame.camPos) * 0.001;
  let w = sqrt(clamp(dKm / AP_MAX_KM, 0.0, 1.0));
  var ap = textureSampleLevel(aerialLut, samp_linear, vec3f(clamp(uv, vec2f(0.0), vec2f(1.0)), w), 0.0);
  // the first slice starts at zero distance: fade in over it
  let s0 = 0.5 / 32.0;
  let k = saturate(w / s0);
  ap = vec4f(ap.rgb * k, mix(1.0, ap.a, k));
  return ap;
}

// the lamps on a surface (irradiance): fire held or thrown, lanterns (main.ts fills world.lamps); a wall lantern lights
// the half of the world before its wall, washing the wall itself at a graze; each falls to nothing by ~14 m
fn outdoorLamps(p: vec3f, n: vec3f) -> vec3f {
  var e = vec3f(0.0);
  for (var i = 0u; i < 8u; i++) {
    let a = world.lamps[i * 2u];
    if (a.w <= 0.0) { continue; }
    let b = world.lamps[i * 2u + 1u];
    let d = a.xyz - p;
    let d2 = max(dot(d, d), 0.04);
    let l = d * inverseSqrt(d2);
    var face = 1.0;
    var cosT = saturate(dot(n, l));
    if (b.w < 8.0) {
      let ax = vec3f(cos(b.w), 0.0, sin(b.w));
      face = smoothstep(-0.35, 0.15, dot(-l, ax));
      // (its glass glows to the sides too: the wall it hangs on washed round it)
      cosT = max(cosT, 0.45 * saturate(dot(n, ax)) * exp(-d2 * 0.6));
    }
    let win = saturate(1.0 - d2 / 196.0);
    e += b.rgb * a.w * face * cosT * win * win / d2;
  }
  return e;
}

// both faces of thin geometry at once (a blade of grass: half its light from each side), as outdoorLamps(p, n) * 0.5 +
// outdoorLamps(p, -n) * 0.5 exactly, each lamp's distance, falloff and facing worked out once for both
fn outdoorLampsBoth(p: vec3f, n: vec3f) -> vec3f {
  var e = vec3f(0.0);
  for (var i = 0u; i < 8u; i++) {
    let a = world.lamps[i * 2u];
    if (a.w <= 0.0) { continue; }
    let b = world.lamps[i * 2u + 1u];
    let d = a.xyz - p;
    let d2 = max(dot(d, d), 0.04);
    let l = d * inverseSqrt(d2);
    var face = 1.0;
    let nl = dot(n, l);
    var cosF = saturate(nl);
    var cosB = saturate(-nl);
    if (b.w < 8.0) {
      let ax = vec3f(cos(b.w), 0.0, sin(b.w));
      face = smoothstep(-0.35, 0.15, dot(-l, ax));
      let wash = 0.45 * exp(-d2 * 0.6);
      let na = dot(n, ax);
      cosF = max(cosF, wash * saturate(na));
      cosB = max(cosB, wash * saturate(-na));
    }
    let win = saturate(1.0 - d2 / 196.0);
    e += b.rgb * a.w * face * (cosF + cosB) * 0.5 * win * win / d2;
  }
  return e;
}

// the same lamps' light arriving at a point from every side (for what scatters it: smoke, steam): no surface's cosine
fn outdoorLampsAround(p: vec3f) -> vec3f {
  var e = vec3f(0.0);
  for (var i = 0u; i < 8u; i++) {
    let a = world.lamps[i * 2u];
    if (a.w <= 0.0) { continue; }
    let b = world.lamps[i * 2u + 1u];
    let d = a.xyz - p;
    let d2 = max(dot(d, d), 0.04);
    var face = 1.0;
    if (b.w < 8.0) { face = smoothstep(-0.35, 0.15, dot(-d * inverseSqrt(d2), vec3f(cos(b.w), 0.0, sin(b.w)))); }
    let win = saturate(1.0 - d2 / 196.0);
    e += b.rgb * a.w * face * win * win / d2;
  }
  return e;
}

fn applyAerial(c: vec3f, p: vec3f) -> vec3f {
  let ap = aerial(p);
  return c * ap.a + ap.rgb;
}

// the sky-view table's coordinates for a view direction (zenith cosine, cosine of its azimuth from the light's) in one
// of its two skies (moonHalf 0: the sun's, 1: the moon's)
fn skyViewUv(vh: f32, viewZenithCos: f32, lightViewCos: f32, ground: bool, moonHalf: f32) -> vec2f {
  let vHorizon = sqrt(max(0.0, vh * vh - R_BOTTOM * R_BOTTOM));
  let cosBeta = vHorizon / vh;
  let beta = acos(cosBeta);
  let zenithHorizon = PI - beta;
  var uv: vec2f;
  if (!ground) {
    var c = max(acos(clamp(viewZenithCos, -1.0, 1.0)), 0.0) / zenithHorizon;
    c = 1.0 - c;
    c = sqrt(max(c, 0.0));
    c = 1.0 - c;
    uv.y = c * 0.5;
  } else {
    var c = (acos(clamp(viewZenithCos, -1.0, 1.0)) - zenithHorizon) / beta;
    c = sqrt(max(c, 0.0));
    uv.y = c * 0.5 + 0.5;
  }
  uv.x = sqrt(saturate(-lightViewCos * 0.5 + 0.5));
  let size = vec2f(192.0, 108.0);
  let t = (uv * (size - 1.0) + 0.5) / size;
  return vec2f(t.x, (t.y + moonHalf) * 0.5);
}

// one light's sky in a direction, from the camera
fn skyFrom(rd: vec3f, light: vec3f, moonHalf: f32) -> vec3f {
  let vh = R_BOTTOM + max(altitudeKm(frame.camPos), 0.01);
  let b = vh * rd.y;
  let ground = rd.y < 0.0 && (b * b - (vh * vh - R_BOTTOM * R_BOTTOM)) >= 0.0;
  let lh = normalize(vec2f(light.x, light.z) + vec2f(1e-6, 0.0));
  let rh = vec2f(rd.x, rd.z);
  let rl = length(rh);
  let lightViewCos = select(1.0, dot(rh / max(rl, 1e-6), lh), rl > 1e-5);
  return textureSampleLevel(skyViewLut, samp_linear, skyViewUv(vh, rd.y, lightViewCos, ground, moonHalf), 0.0).rgb;
}

// the atmosphere's radiance in a direction, from the camera: the sun's sky (its day and its twilight) and the moon's
fn skyAtmosphere(rd: vec3f) -> vec3f {
  return skyFrom(rd, world.sunTrue.xyz, 0.0) + skyFrom(rd, world.moonDir, 1.0);
}

// the sky's radiance in a direction, for reflections and the like: the atmosphere and the aurora over it (the sky
// pass draws the aurora itself, finer)
fn skyRadiance(rd: vec3f) -> vec3f {
  var c = skyAtmosphere(rd);
  if (world.aurora0.x > 0.0) { c += textureSampleLevel(auroraDome, samp_linear, auroraDomeUv(rd), 0.0).rgb * smoothstep(-0.01, 0.03, rd.y); }
  return c;
}

// ------------------------------------------------------------------ shadows
fn cascadeOf(viewDist: f32) -> i32 {
  let n = i32(world.shadowParams.w);
  for (var i = 0; i < n; i++) { if (viewDist < world.splits[i]) { return i; } }
  return -1;
}

fn shadowTap(c: i32, p: vec3f) -> f32 {
  let lc = world.cascades[c] * vec4f(p, 1.0);
  let uv = vec2f(lc.x * 0.5 + 0.5, 0.5 - lc.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || lc.z < 0.0 || lc.z > 1.0) { return 1.0; }
  // reversed depth in the light view: nearer the sun = larger; a PCF with the hardware compare
  let dim = vec2f(textureDimensions(shadowMap));
  var s = 0.0;
  var w = 0.0;
  // (the far cascades a 5x5 tent: a small caster a few texels across, rasterized a little differently as its shadow
  // slides over the texel grid, blinked under a 3x3)
  let R = select(1, 2, c >= 2);
  for (var y = -R; y <= R; y++) {
    for (var x = -R; x <= R; x++) {
      let k = f32(R + 1 - abs(x)) * f32(R + 1 - abs(y));
      s += k * textureSampleCompareLevel(shadowMap, samp_shadow, uv + vec2f(f32(x), f32(y)) / dim, c, lc.z + world.shadowParams.y);
      w += k;
    }
  }
  return s / w;
}

// one hardware-filtered tap (2x2 PCF): for far or small things (grass, distant crowns, impostors)
fn fastTap(c: i32, p: vec3f, n: vec3f) -> f32 {
  let texel = world.shadowParams.x * (world.splits[c] / world.splits[0]);
  let q = p + n * texel * world.shadowParams.z;
  let lc = world.cascades[c] * vec4f(q, 1.0);
  let uv = vec2f(lc.x * 0.5 + 0.5, 0.5 - lc.y * 0.5);
  if (all(uv > vec2f(0.0)) && all(uv < vec2f(1.0)) && lc.z >= 0.0 && lc.z <= 1.0) {
    return textureSampleCompareLevel(shadowMap, samp_shadow, uv, c, lc.z + world.shadowParams.y);
  }
  return 1.0;
}
fn sunShadowFast(p: vec3f, n: vec3f) -> f32 {
  let d = dot(p - frame.camPos, frame.camFwd);
  let c = cascadeOf(d);
  var vis = 1.0;
  if (c >= 0) {
    vis = fastTap(c, p, n);
    // blended into the next cascade over the last tenth of this one, as sunShadow is: a crown walked toward doesn't
    // brighten or darken at a cascade's edge all at once (its self-shadowing differs between them)
    let edge = world.splits[c] * 0.9;
    if (d > edge && c + 1 < i32(world.shadowParams.w)) { vis = mix(vis, fastTap(c + 1, p, n), (d - edge) / (world.splits[c] - edge)); }
  }
  return vis * terrainSunVisibility(p);
}

// sun visibility at a world point with a geometric normal (normal offset scaled to the cascade's texel)
fn sunShadow(p: vec3f, n: vec3f) -> f32 {
  let d = dot(p - frame.camPos, frame.camFwd);
  let c = cascadeOf(d);
  var vis = 1.0;
  if (c >= 0) {
    let texel = world.shadowParams.x * pow(world.splits[c] / world.splits[0], 1.0);
    let off = n * texel * world.shadowParams.z * (1.0 - abs(dot(n, world.sunDir)) * 0.5);
    vis = shadowTap(c, p + off);
    // blend into the next cascade over the last tenth of this one
    let edge = world.splits[c] * 0.9;
    if (d > edge && c + 1 < i32(world.shadowParams.w)) {
      let texel2 = world.shadowParams.x * (world.splits[c + 1] / world.splits[0]);
      vis = mix(vis, shadowTap(c + 1, p + n * texel2 * world.shadowParams.z), (d - edge) / (world.splits[c] - edge));
    }
  }
  return vis * terrainSunVisibility(p);
}

// ------------------------------------------------------------------ terrain heights
// level i covers its centre +- half; texel centres at centre + (k + 0.5) * texel - half
fn levelUv(i: i32, xz: vec2f) -> vec2f {
  let L = world.terrainLevels[i];
  return (xz - L.zw + L.x) / (2.0 * L.x);
}

// how far out in level i a point is (1 at its edge)
fn levelE(i: i32, xz: vec2f) -> f32 {
  let L = world.terrainLevels[i];
  let d = abs(xz - L.zw);
  return max(d.x, d.y) / L.x;
}

fn heightAtLevel(i: i32, xz: vec2f) -> f32 {
  let uv = levelUv(i, xz);
  return textureSampleLevel(heights, samp_linear, uv, i, 0.0).r;
}

// the finest level holding a point, with a smooth hand-over in the outer 15% of each level
fn terrainHeight(xz: vec2f) -> f32 {
  var h = heightAtLevel(TERRAIN_LEVELS - 1, xz);
  for (var i = TERRAIN_LEVELS - 2; i >= 0; i--) {
    let e = levelE(i, xz);
    if (e < 1.0) {
      let t = smoothstep(0.85, 0.98, e);
      h = mix(heightAtLevel(i, xz), h, t);
    }
  }
  return h;
}

fn terrainNormal(xz: vec2f, eps: f32) -> vec3f {
  let hx = terrainHeight(xz + vec2f(eps, 0.0)) - terrainHeight(xz - vec2f(eps, 0.0));
  let hz = terrainHeight(xz + vec2f(0.0, eps)) - terrainHeight(xz - vec2f(0.0, eps));
  return normalize(vec3f(-hx, 2.0 * eps, -hz));
}

// the heights smoothed to a spacing (m), as a patch of that spacing should stand: each level read at the mip whose
// texels are that wide (its own when they're finer), handed over between levels as terrainHeight does (a far cliff a
// smooth slope, not a staircase of the texels it skips)
fn terrainHeightAt(xz: vec2f, spacing: f32) -> f32 {
  let last = TERRAIN_LEVELS - 1;
  var h = textureSampleLevel(heights, samp_linear, levelUv(last, xz), last, max(0.0, log2(spacing / world.terrainLevels[last].y))).r;
  for (var i = TERRAIN_LEVELS - 2; i >= 0; i--) {
    let e = levelE(i, xz);
    if (e < 1.0) {
      let mip = max(0.0, log2(spacing / world.terrainLevels[i].y));
      h = mix(textureSampleLevel(heights, samp_linear, levelUv(i, xz), i, mip).r, h, smoothstep(0.85, 0.98, e));
    }
  }
  return h;
}

// the normal of the heights smoothed to a spacing (terrainHeightAt), over +-eps
fn terrainNormalAt(xz: vec2f, eps: f32, spacing: f32) -> vec3f {
  let hx = terrainHeightAt(xz + vec2f(eps, 0.0), spacing) - terrainHeightAt(xz - vec2f(eps, 0.0), spacing);
  let hz = terrainHeightAt(xz + vec2f(0.0, eps), spacing) - terrainHeightAt(xz - vec2f(0.0, eps), spacing);
  return normalize(vec3f(-hx, 2.0 * eps, -hz));
}

// the heightfield's own shadow (ray-marched toward the sun per texel when the sun moves), from the finest level holding
// the point
fn terrainSunVisibility(p: vec3f) -> f32 {
  var v = textureSampleLevel(terrainShadow, samp_linear, levelUv(TERRAIN_LEVELS - 1, p.xz), TERRAIN_LEVELS - 1, 0.0).r;
  for (var i = TERRAIN_LEVELS - 2; i >= 0; i--) {
    let e = levelE(i, p.xz);
    if (e < 1.0) {
      v = mix(textureSampleLevel(terrainShadow, samp_linear, levelUv(i, p.xz), i, 0.0).r, v, smoothstep(0.85, 0.98, e));
    }
  }
  return v;
}

// ------------------------------------------------------------------ misc
fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn hash22(p: vec2f) -> vec2f {
  var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
fn hash11(n: f32) -> f32 { return fract(sin(n) * 43758.5453123); }
fn hashU(x0: u32) -> u32 {
  var x = x0;
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return x;
}
fn hashF(x: u32) -> f32 { return f32(hashU(x)) / 4294967296.0; }

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2f(1.0, 0.0)), u.x), mix(hash12(i + vec2f(0.0, 1.0)), hash12(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn fbm2(p0: vec2f, oct: i32) -> f32 {
  var p = p0;
  var a = 0.5;
  var s = 0.0;
  for (var i = 0; i < oct; i++) { s += a * noise2(p); p = mat2x2f(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; }
  return s;
}

fn srgbToLinear3(c: vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}

// Lambert with a wrap and a sheen for foliage-ish surfaces; standard GGX for the rest
fn ggx(n: vec3f, v: vec3f, l: vec3f, rough: f32, f0: vec3f) -> vec3f {
  let h = normalize(v + l);
  let nh = saturate(dot(n, h));
  let nl = saturate(dot(n, l));
  let nv = max(dot(n, v), 1e-3);
  let a = rough * rough;
  let a2 = a * a;
  let d = a2 / (PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
  let k = a * 0.5;
  let g = (nl / (nl * (1.0 - k) + k)) * (nv / (nv * (1.0 - k) + k));
  let f = f0 + (1.0 - f0) * pow(1.0 - saturate(dot(h, v)), 5.0);
  return d * g * f / max(4.0 * nl * nv, 1e-3) * nl;
}

#include "./cloudsky.wgsl"
#include "./../weather/weather.wgsl"
