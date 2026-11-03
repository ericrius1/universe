// The cloud layers' shapes (src/world/clouds.ts fills CL), shared by the composite (cloudlayers.wgsl), the shadow map
// (cloudshade.wgsl) and the puffs (cloudpuffs.wgsl, which take the shade of any deck above them). Up to four decks —
// low, mid, high and the chinook's wave deck — each a slab between two shells round the earth, its density a few
// taps of the baked noise (cloudnoise.wgsl) in the wind's frame, drifting with it. And how the clouds are painted
// (CL.paint, CL.belly: world/daylight.ts): brighter than the air would light them, as the dome is, the sides and
// bellies away from the light lavender rather than grey.
#include "./world.wgsl"

struct Layer {
  a: vec4f,   // x base (m above the site), y thickness (m), z cover (0..1), w optical depth at full density
  b: vec4f,   // x the noise's tile (m), y lumpy (0 sheet .. 1 cells), z streak (fibres), w a 22-degree halo
  c: vec4f,   // xy the drift so far (m, in the wind's frame, wrapped to the tile), z the band's western edge (x, m), w its feather (0: no band)
  d: vec4f,   // x drawn after the puffs (1) or before, y the layer's own offset into the noise, z diffuse brightness scale, w -
}
struct CloudLayers {
  L: array<Layer, 4>,
  wind: vec4f,      // xy the wind's direction (unit, x east, z south), zw the drift since the puffs were listed (m)
  misc: vec4f,      // x the cities' glow on cloud bases, y the pixel's angular size (rad), z where a deck the eye is in begins (m: past the walls indoors), w -
  paint: vec4f,     // the clouds as painted: x the lit side's gain, y the shaded side's and the belly's, zw -
  belly: vec4f,     // rgb the shaded side's and the belly's tint (lavender), w -
}

// the light on a cloud as painted: the side the key light reaches (lit), the side it doesn't and the belly (shade)
fn cloudPaint(lit: vec3f, shade: vec3f) -> vec3f { return lit * CL.paint.x + shade * CL.belly.rgb * CL.paint.y; }
@group(2) @binding(0) var<uniform> CL: CloudLayers;
@group(2) @binding(1) var cloudNoise: texture_2d<f32>;

const EARTH_M = 6371000.0;

// u along the wind, v across it
fn windFrame(xz: vec2f) -> vec2f {
  let w = CL.wind.xy;
  return vec2f(dot(xz, w), w.x * xz.y - w.y * xz.x);
}

fn hg(c: f32, g: f32) -> f32 { return (1.0 - g * g) / (4.0 * PI * pow(max(1.0 + g * g - 2.0 * g * c, 1e-4), 1.5)); }

// the key light reaching a point high up: the air's transmittance there, nothing once the earth is in the way
fn keyAt(p: vec3f) -> vec3f {
  let h = altitudeKm(p);
  let r = R_BOTTOM + max(h, 0.0);
  let horizon = -sqrt(max(0.0, 1.0 - (R_BOTTOM * R_BOTTOM) / (r * r)));
  let mu = world.sunDir.y;
  return transmittanceToSpace(h, max(mu, horizon + 0.002)) * world.haze.w * smoothstep(horizon - 0.012, horizon + 0.006, mu) * keyTint();
}

fn layerOn(k: i32) -> bool { return CL.L[k].a.z > 0.001 && CL.L[k].a.w > 0.0; }

// the layer's density (0 clear .. ~1.8 its thickest) over a world point's xz; lod: the noise's mip
fn layerDensity(k: i32, xz: vec2f, lod: f32, fine: bool) -> f32 {
  let f = CL.L[k].b.x * exp2(lod) / 512.0;
  return layerDensityG(k, xz, vec2f(f, 0.0), vec2f(0.0, f), fine);
}

// ... with the pixel's footprint on the deck as two axes (m, world xz): seen edge-on toward the horizon the footprint
// is many times longer along the view than across it, and the sampler's anisotropic filtering keeps the cells there
// from aliasing into streaks without blurring them across
fn layerDensityG(k: i32, xz: vec2f, gx: vec2f, gy: vec2f, fine: bool) -> f32 {
  let l = CL.L[k];
  let q = (windFrame(xz) - l.c.xy) / l.b.x + vec2f(l.d.y, l.d.y * 0.61);
  // (the wind's frame is a rotation: the footprint turns with it)
  let dx = windFrame(gx) / l.b.x;
  let dy = windFrame(gy) / l.b.x;
  let n = textureSampleGrad(cloudNoise, samp_repeat, q, dx, dy);
  // (patches: a slow field breaks a partial cover into stretches of cloud and open sky)
  let big = textureSampleGrad(cloudNoise, samp_repeat, q * 0.23 + vec2f(0.5, 0.17), dx * 0.23, dy * 0.23).r;
  var s = mix(n.r, n.g, l.b.y);
  if (l.b.z > 0.0) {
    // fibres: long fine streaks along the wind, bent by the billows (the hooks of mares' tails), gathered into the
    // billows' patches
    let qf = vec2f(q.x * 0.55, q.y * 3.4 + (n.r - 0.5) * 0.16 + (n.b - 0.5) * 0.05);
    let fs = vec2f(0.55, 3.4);
    let f1 = textureSampleGrad(cloudNoise, samp_repeat, qf + vec2f(0.21, 0.6), dx * fs, dy * fs).a;
    let fs2 = fs * vec2f(1.7, 2.3);
    let f2 = textureSampleGrad(cloudNoise, samp_repeat, qf * vec2f(1.7, 2.3) + vec2f(0.63, 0.12), dx * fs2, dy * fs2).a;
    let clump = smoothstep(0.3, 0.8, n.r) * (0.5 + big);
    s = mix(s, clump * (f1 * 0.85 + f2 * 0.35) * 1.1, l.b.z);
  }
  if (fine) {
    let dn = textureSampleGrad(cloudNoise, samp_repeat, q * 5.3 + vec2f(0.31, 0.77), dx * 5.3, dy * 5.3).b;
    s += (dn - 0.5) * mix(0.32, 0.12, l.b.z);
  }
  // (a full cover leaves no holes; a partial one comes and goes with the patches)
  var cov = mix(l.a.z * (0.4 + 1.2 * big), l.a.z, smoothstep(0.85, 1.0, l.a.z));
  // the chinook arch: the deck only east of its edge, the clear slot over the mountains west of it
  if (l.c.w > 0.0) { cov *= smoothstep(l.c.z - l.c.w, l.c.z + l.c.w, xz.x + (big - 0.5) * l.c.w * 2.0); }
  let th = 1.0 - cov * 1.1;
  let d = smoothstep(th, th + mix(0.3, 0.6, l.b.z), s);
  // (cells thick in the middle, thin at their edges)
  return d * mix(0.55 + 0.9 * saturate(s), 0.12 + 1.7 * saturate(s) * saturate(s), l.b.y * 0.85);
}

// a ray from the camera through the shells at heights h (m above the site): the distance to the first crossing and the
// second (-1: none). The earth is curved round the camera as the terrain is (centre straight below it).
fn shellHits(ro: vec3f, rd: vec3f, h: f32) -> vec2f {
  let r0 = EARTH_M + ro.y;
  let r = EARTH_M + h;
  let b = r0 * rd.y;
  // (c factored: no cancellation between two numbers the size of the earth)
  let c = (ro.y - h) * (r0 + r);
  let disc = b * b - c;
  if (disc < 0.0) { return vec2f(-1.0); }
  let s = sqrt(disc);
  let q = -(b + select(-s, s, b >= 0.0));
  var t0 = q;
  var t1 = c / q;
  if (t0 > t1) { let t = t0; t0 = t1; t1 = t; }
  return vec2f(t0, t1);
}

// the stretch of the ray inside a layer's slab: (enter, leave), leave < enter when it misses
fn slabSpan(k: i32, ro: vec3f, rd: vec3f) -> vec2f {
  let l = CL.L[k];
  let lo = shellHits(ro, rd, l.a.x);
  let hi = shellHits(ro, rd, l.a.x + l.a.y);
  if (ro.y < l.a.x) {
    // below: in through the base, out through the top
    if (lo.y <= 0.0) { return vec2f(1.0, 0.0); }
    let enter = select(lo.x, lo.y, lo.x <= 0.0);
    return vec2f(enter, select(hi.x, hi.y, hi.x <= 0.0));
  }
  if (ro.y > l.a.x + l.a.y) {
    // above: in through the top (looking down), out through the base or the top again
    if (hi.x <= 0.0) { return vec2f(1.0, 0.0); }
    return vec2f(hi.x, select(hi.y, lo.x, lo.x > 0.0));
  }
  // inside
  return vec2f(0.0, select(hi.y, lo.x, lo.x > 0.0));
}

// the key light through every deck above a point but `skip`: x what comes straight through (delta-scaled), y all that
// comes through, scattered or not (two-stream) — the light a lower cloud's top gets under a veil. The ray climbs round
// the earth (the shells' centre straight below the camera): however low the sun, it reaches a deck above within a few
// hundred km, crossing it at a slant that averages the deck's cells along a long path (a sunset's shadows of a veil
// on the deck below are long soft bands that glide, never racing blots).
fn decksOver(p: vec3f, skip: i32) -> vec2f {
  let L = world.sunDir;
  let P = vec3f(p.x - frame.camPos.x, p.y + EARTH_M, p.z - frame.camPos.z);
  let rp = length(P);
  let b = dot(P, L);
  var t = vec2f(1.0);
  for (var k = 0; k < 4; k++) {
    if (k == skip || !layerOn(k)) { continue; }
    let l = CL.L[k];
    let dh = l.a.x + l.a.y * 0.5 - (rp - EARTH_M);
    if (dh <= 0.0) { continue; }
    // (the distance to the deck's mid-shell, and the ray's sine to the shell's horizon there)
    let c = dh * (2.0 * rp + dh);
    let s = sqrt(b * b + c);
    let d = select(s - b, c / (s + b), b > 0.0);
    let q = p + L * d;
    let mu = max(s / (rp + dh), 0.02);
    // (blurred: a deck's shadow on a cloud is soft, its fibres lost in it; more so the longer the slant through it)
    let lod = clamp(log2(512.0 * l.a.y * sqrt(max(1.0 - mu * mu, 1e-6)) / (mu * l.b.x)), 4.5, 9.0);
    let tau = layerDensity(k, q.xz, lod, false) * l.a.w;
    t *= vec2f(exp(-0.28 * tau / mu), 1.0 / (1.0 + 0.113 * tau));
  }
  return t;
}
