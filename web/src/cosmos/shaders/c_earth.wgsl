// The Earth from space (kilometres; L.b.xyz its centre relative to the level's origin, which is the meadow outside
// Boulder): continents where they really are (soft blobs at their real latitudes and longitudes, broken up by noise),
// biomes by latitude and wetness, ice caps, oceans with the Sun's glint, two decks of cloud drifting, city lights on
// the night side, and the air over all of it (atmo.wgsl). Close in, the land round Boulder is the meadow level's own
// (front.wgsl), and the sky over it is clear, so the two agree as one hands over to the other. The Moon where it is
// today. L.a: exposure, sun intensity, how near (0..1).
#include "cosmos.wgsl"
#include "atmo.wgsl"
#include "front.wgsl"
#include "weft/fullscreen"

// lat, lon, angular radius (deg), weight
const LANDS = array<vec4f, 30>(
  vec4f(45.0, -100.0, 20.0, 1.0), vec4f(60.0, -112.0, 16.0, 1.0), vec4f(36.0, -86.0, 12.0, 0.9), vec4f(22.0, -102.0, 8.0, 0.9),
  vec4f(66.0, -75.0, 10.0, 0.8), vec4f(73.0, -40.0, 10.0, 1.0), vec4f(64.0, -150.0, 9.0, 0.9),
  vec4f(-8.0, -58.0, 15.0, 1.0), vec4f(-30.0, -64.0, 10.0, 1.0), vec4f(5.0, -68.0, 8.0, 0.9), vec4f(-45.0, -70.0, 5.0, 0.9),
  vec4f(49.0, 12.0, 11.0, 1.0), vec4f(60.0, 35.0, 14.0, 1.0), vec4f(64.0, 16.0, 7.0, 0.9), vec4f(40.0, -4.0, 5.0, 0.9),
  vec4f(58.0, 90.0, 24.0, 1.0), vec4f(38.0, 100.0, 16.0, 1.0), vec4f(22.0, 79.0, 9.0, 1.0), vec4f(15.0, 103.0, 6.0, 0.9),
  vec4f(45.0, 128.0, 8.0, 0.9), vec4f(66.0, 150.0, 12.0, 0.9),
  vec4f(10.0, 20.0, 17.0, 1.0), vec4f(-12.0, 26.0, 13.0, 1.0), vec4f(24.0, 12.0, 15.0, 1.0), vec4f(-27.0, 25.0, 8.0, 1.0),
  vec4f(25.0, 46.0, 9.0, 0.9), vec4f(-25.0, 134.0, 13.0, 1.0), vec4f(-3.0, 115.0, 5.0, 0.7), vec4f(36.0, 138.0, 3.5, 0.8),
  vec4f(54.0, -2.0, 3.5, 0.8),
);

fn llDir(lat: f32, lon: f32) -> vec3f {
  let a = radians(lat); let o = radians(lon);
  return vec3f(cos(a) * cos(o), sin(a), -cos(a) * sin(o));
}

// the land (x: < 0 is sea; y: how mountainous) at a direction in the Earth's own axes; `near` adds finer detail
fn elevation(n: vec3f, near: f32) -> vec2f {
  var base = 0.0;
  for (var i = 0; i < 30; i++) {
    let l = LANDS[i];
    let c = llDir(l.x, l.y);
    let ang = acos(clamp(dot(n, c), -1.0, 1.0));
    let s = radians(l.z);
    base = max(base, l.w * exp(-(ang * ang) / (s * s)));
  }
  // Antarctica
  base = max(base, ss(-0.83, -0.95, n.y));
  // coasts broken up at every size down to what's seen
  var e = base - 0.42 + fbm(n * 3.1, 6) * 0.32 + fbm(n * 11.0 + 3.0, 5) * 0.12;
  e += near * (fbm(n * 60.0, 5) * 0.05 + fbm(n * 400.0, 4) * 0.015);
  // the Rockies, the Andes, the Himalaya, the Alps: ridged
  let rid = 1.0 - abs(fbm(n * 26.0, 5) * 2.0);
  let rock = exp(-pow(acos(clamp(dot(n, llDir(42.0, -110.0)), -1.0, 1.0)) / radians(9.0), 2.0));
  let andes = exp(-pow(abs(acos(clamp(dot(n, llDir(-20.0, -69.0)), -1.0, 1.0))) / radians(6.0), 2.0));
  let him = exp(-pow(acos(clamp(dot(n, llDir(31.0, 85.0)), -1.0, 1.0)) / radians(7.0), 2.0));
  let alps = exp(-pow(acos(clamp(dot(n, llDir(46.0, 10.0)), -1.0, 1.0)) / radians(2.5), 2.0));
  let mtn = (rock + andes + him + alps) * (0.35 + 0.65 * rid * rid) * ss(0.0, 0.06, e);
  return vec2f(e, mtn);
}

// (clear: 0..1, how clear the sky is kept here)
fn clouds(n: vec3f, t: f32, clear: f32) -> f32 {
  // two decks: a large swirl and cumulus, drifting east and west with latitude; finer cells close in
  let lat = n.y;
  let drift = vec3f(cos(t * 0.004 * (1.0 - lat * lat)), 0.0, sin(t * 0.004 * (1.0 - lat * lat)));
  let q = n * 3.3 + drift * 0.3;
  var w = fbm(q + fbm(q * 1.7, 3) * 0.8, 6) + fbm(n * 40.0 + drift, 4) * 0.12 * L.a.z;
  w += (fbm(n * 170.0 + drift * 3.0, 4) * 0.07) * L.a.z - clear * 0.45;
  let band = 0.08 + 0.18 * ss(0.15, 0.5, abs(lat)) * (1.0 - ss(0.8, 0.95, abs(lat)));
  return ss(0.25 - band, 0.42 - band, w) * 0.85;
}

// the surface's colour (lit), n the sphere's normal; g the point in the meadow's frame (m) and how much of the
// meadow's own land shows (gw), px a pixel's size there (km)
fn surface(n: vec3f, sun: vec3f, v: vec3f, near: f32, g: vec3f, gw: f32, t: f32, E: vec3f, S: vec3f) -> vec3f {
  let px = t * L.pxAngle;
  let el = elevation(n, near);
  let e = el.x;
  let lat = abs(n.y);
  var alb: vec3f;
  var spec = 0.0;
  // relief: ridges and valleys, shading the land as its slopes face the Sun (as many octaves as the pixels hold)
  var nn = n;
  if (e > 0.0) {
    let oct = i32(clamp(log2(6371.0 / (2.0 * max(px, 0.05)) / 160.0) + 1.0, 1.0, 6.0));
    let amp = (0.25 + 2.2 * el.y) * near / 6371.0;
    if (amp > 0.0) {
      let eps = max(px, 0.4) / 6371.0;
      let r0 = ridged(n * 160.0, oct);
      let rx = ridged((n + E * eps) * 160.0, oct);
      let rz = ridged((n + S * eps) * 160.0, oct);
      nn = normalize(n - (E * (rx - r0) + S * (rz - r0)) * (amp / eps) * ss(0.0, 0.02, e));
    }
  }
  if (e < 0.0) {
    alb = mix(vec3f(0.004, 0.02, 0.06), vec3f(0.015, 0.075, 0.11), ss(-0.12, 0.0, e));
    spec = 1.0;
  } else {
    // wet forest and grassland, dry steppe and desert in the subtropics, tundra, ice
    let wet = fbm(n * 5.0 + 9.0, 5) * 0.5 + 0.5;
    let dryBelt = ss(0.2, 0.0, abs(lat - 0.4)) * 0.8;
    // (and the high plains in the Rockies' rain shadow)
    let lon = degrees(atan2(-n.z, n.x));
    let shadow = exp(-pow((lon + 99.0) / 6.0, 2.0)) * ss(0.42, 0.55, n.y) * ss(0.82, 0.72, n.y);
    let dry = clamp(dryBelt + shadow * 0.7 + (0.45 - wet) * 1.2, 0.0, 1.0);
    alb = mix(vec3f(0.045, 0.075, 0.028), vec3f(0.11, 0.12, 0.05), ss(0.35, 0.7, wet));
    alb = mix(alb, vec3f(0.22, 0.17, 0.095), ss(0.3, 0.6, dry));
    alb = mix(alb, vec3f(0.42, 0.32, 0.2), ss(0.6, 0.9, dry));
    // fields, forest and scrub down to what the pixels hold
    let fo = i32(clamp(log2(6371.0 / (2.0 * max(px, 0.05)) / 700.0) + 1.0, 0.0, 5.0));
    var fine = fbm(n * 90.0, 4) * 0.3;
    if (fo > 0) { fine += fbm(n * 700.0 + 5.0, fo) * 0.45; }
    alb *= 0.85 + fine * near;
    // the mountains: conifers on their flanks, bare rock on the ridges, snow on the highest
    let crest = ss(0.0, 0.35, el.y * (0.6 + 0.4 * ridged(n * 900.0, 3)));
    alb = mix(alb, vec3f(0.035, 0.055, 0.025), ss(0.15, 0.4, el.y) * (1.0 - dry * 0.6));
    alb = mix(alb, vec3f(0.17, 0.15, 0.13), ss(0.55, 0.85, crest) * ss(0.4, 0.7, el.y));
    alb = mix(alb, vec3f(0.8, 0.82, 0.86), ss(0.85, 1.05, el.y + lat * 0.25));
    alb = mix(alb, vec3f(0.12, 0.11, 0.08), ss(0.72, 0.8, lat));
  }
  alb = mix(alb, vec3f(0.85, 0.88, 0.92), ss(0.9, 0.95, lat) + ss(-0.86, -0.9, n.y));
  // round Boulder: the meadow's own land, its own relief
  if (gw > 0.0) {
    // (as the meadow's level would draw it from here)
    let pm = px * 1000.0;
    let lod = log2(max(t * 1000.0, 1.0) / 400.0);
    let ln = terrainNormal(g.x, g.z, max(pm, 30.0), lod);
    let h = terrain(g.x, g.z, lod);
    let fa = landColor(vec3f(g.x, h, g.z), ln, t * 1000.0, pm);
    alb = mix(alb, fa, gw);
    nn = normalize(mix(nn, normalize(E * ln.x + n * ln.y + S * ln.z), gw));
  }
  let lam = dot(n, sun);
  var c = alb * max(dot(nn, sun), 0.0) * ss(-0.05, 0.1, lam);
  if (spec > 0.0) {
    let h = normalize(sun + v);
    c += vec3f(1.0, 0.9, 0.75) * pow(max(dot(n, h), 0.0), 220.0) * 2.0 * step(0.0, lam);
  }
  // the cities, on the night side
  if (e > 0.0 && el.y < 0.5) {
    let city = pow(max(vnoise(n * 220.0) * 0.5 + 0.5 - 0.55, 0.0) * 2.2, 3.0) * ss(0.1, 0.45, fbm(n * 14.0, 3) + 0.2);
    c += vec3f(1.0, 0.62, 0.3) * city * 0.12 * ss(0.05, -0.15, lam) * (1.0 - ss(0.75, 0.85, lat));
  }
  return c;
}

@fragment fn fs(in: FullscreenOut) -> @location(0) vec4f {
  let rd = rayDir(in.uv);
  let ro = L.eye;
  let c = L.b.xyz;
  let sun = L.sun;
  let sunI = L.a.y;
  var col = vec3f(0.0);
  var alpha = 0.0;
  let hp = raySphere(ro, rd, c, RP);
  // the Moon
  let mh = sphereHit(ro, rd, L.c.xyz, 1737.4);
  let tHit = select(1e9, hp.x, hp.x > 0.0 && hp.x < 1e8);
  if (mh.x > 0.0 && mh.x < tHit) {
    let n = normalize(ro + rd * mh.x - L.c.xyz);
    let cr = cellular(n * 9.0, 1.0);
    let mare = ss(0.1, 0.45, fbm(n * 2.0 + 5.0, 4));
    let alb = mix(0.32, 0.14, mare) * (0.85 + 0.15 * ss(0.0, 0.25, cr.d1)) * (0.9 + 0.2 * fbm(n * 30.0, 3));
    col = vec3f(alb) * max(dot(n, sun), 0.0) * sunI;
    return vec4f(col * L.a.x * L.weight, L.weight);
  }
  var trans = vec3f(1.0);
  if (hp.x > 0.0 && hp.x < 1e8) {
    let p = ro + rd * hp.x;
    let n = normalize(p - c);
    let sunL = sunlightAt(p + n * 0.5, c, sun);
    // Boulder's frame (its zenith, east and south) and how far from it (km)
    let up0 = normalize(-c);
    let E = normalize(cross(vec3f(0.0, 1.0, 0.0), up0));
    let S = cross(E, up0);
    let dB = length(p);
    let gw = ss(650.0, 220.0, dB) * L.a.z;
    col = surface(n, sun, -rd, L.a.z, vec3f(dot(p, E), dot(p, up0), dot(p, S)) * 1000.0, gw, hp.x, E, S) * sunL * sunI;
    // the clouds over it, and their shadows (a clear day over the Front Range)
    let clear = ss(380.0, 120.0, dB);
    let cl = clouds(n, L.time, clear);
    let cs = clouds(normalize(n + sun * 0.004), L.time, clear);
    col *= 1.0 - cs * 0.6;
    let lam = max(dot(n, sun), 0.0);
    col = mix(col, vec3f(0.8) * (lam * 0.9 + 0.02) * sunL * sunI, cl);
    let a = air(ro, rd, hp.x, c, sun, sunI, 12);
    col = overLand(col, a);
    alpha = 1.0;
  } else {
    let a = air(ro, rd, 1e9, c, sun, sunI, 12);
    col = a.light;
    trans = a.trans;
    // (the air's glow is light; it hides little)
    alpha = 0.0;
  }
  return vec4f(col * L.a.x * L.weight, alpha * L.weight);
}
