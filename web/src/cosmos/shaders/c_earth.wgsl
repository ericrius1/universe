// The Earth from space (kilometres; L.b.xyz its centre relative to the level's origin, the meadow at Chautauqua in
// Boulder): Boulder's planet (space/planet.wgsl), on the coastlines its map traces (levels/continents.ts) — land by
// latitude, dryness and season, mountains, ice, the sea with the sun's glint, clouds in bands by latitude drifting with
// their winds, the cities' lights by night — and round the spot the real thing: the aerial picture and the relief of a
// window 120 km across (the same the ground level stands on, so the one hands over to the other). Lit and seen through
// Boulder's air (air.wgsl). The Moon where it is today.
// L.a: exposure, -, how near (finer detail), day of the year.
#include "cosmos.wgsl"
#include "air.wgsl"
#include "weft/fullscreen"

struct EarthU {
  gx: vec4f, gy: vec4f, gz: vec4f,   // the ground's axes (east, up, south) at the spot, in the Earth's
  spot: vec4f,                       // the spot relative to the level's origin (km); w the window's half (km)
  hr: vec4f,                         // the window's heights: x min, y max (m, relative to the spot)
}
@group(2) @binding(1) var earthMap: texture_2d<f32>;     // r land, g dry, b the cities' light, a ice or mountains
@group(2) @binding(2) var regionMap: texture_2d<f32>;    // the window's aerial picture (sRGB)
@group(2) @binding(3) var regionH: texture_2d<f32>;      // its heights (0..1 between hr.x and hr.y)
@group(2) @binding(4) var<uniform> E: EarthU;

const PLANET_R = R_BOTTOM + PLANET_KM;

fn hash31(p: vec3f) -> f32 {
  var q = fract(p * 0.1031);
  q += dot(q, q.zyx + 31.32);
  return fract((q.x + q.y) * q.z);
}
fn hash22(p: vec2f) -> vec2f {
  var q = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
fn noise3(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = mix(mix(hash31(i), hash31(i + vec3f(1.0, 0.0, 0.0)), u.x), mix(hash31(i + vec3f(0.0, 1.0, 0.0)), hash31(i + vec3f(1.0, 1.0, 0.0)), u.x), u.y);
  let b = mix(mix(hash31(i + vec3f(0.0, 0.0, 1.0)), hash31(i + vec3f(1.0, 0.0, 1.0)), u.x), mix(hash31(i + vec3f(0.0, 1.0, 1.0)), hash31(i + vec3f(1.0, 1.0, 1.0)), u.x), u.y);
  return mix(a, b, u.z);
}
// octaves, each turned against the last, as many as a pixel's footprint can hold
fn fbm3(p0: vec3f, n: i32, gain: f32) -> f32 {
  let m = mat3x3f(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
  var p = p0;
  var a = 0.5; var s = 0.0; var w = 0.0;
  for (var k = 0; k < 6; k++) {
    if (k >= n) { break; }
    s += a * noise3(p);
    w += a;
    p = m * p * 2.03;
    a *= gain;
  }
  return s / w;
}
fn octaves(cell: f32, pix: f32) -> i32 { return clamp(i32(ceil(log2(cell / max(pix, 1e-3)))), 1, 5); }
fn clampLen(d: vec2f, most: f32) -> vec2f { return d * min(1.0, most / max(length(d), 1e-12)); }
fn unwrapLon(d: vec2f) -> vec2f { return vec2f(d.x - 2.0 * PI * round(d.x / (2.0 * PI)), d.y); }
fn srgbIn(c: vec3f) -> vec3f { return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045)); }

// the land's fine texture away from the window: the window's own picture laid over the globe in tiles, each turned
// its own way, two lattices half a tile apart blended (Boulder's landDetail); only its fine part
fn landDetail(ll: vec2f, dx: vec2f, dy: vec2f, size: f32, coarse: f32) -> f32 {
  let lw = vec3f(0.2126, 0.7152, 0.0722);
  let k0 = PLANET_R / (2.0 * E.spot.w * 0.7 * size);
  var s = 0.0; var w = 0.0;
  for (var k = 0; k < 2; k++) {
    let o = f32(k) * 0.5;
    let row = floor(ll.y * k0 + o);
    let sx = cos((row + 0.5 - o) / k0) * k0;
    let q = vec2f(ll.x * sx + o, ll.y * k0 + o);
    let c = floor(q);
    let f = q - c;
    let h = hash22(c + f32(k) * 17.0);
    let a = h.x * 6.2831853;
    let r = mat2x2f(cos(a), sin(a), -sin(a), cos(a)) * 0.7;
    let wt = max((1.0 - abs(f.x - 0.5) * 2.0) * (1.0 - abs(f.y - 0.5) * 2.0), 1e-3);
    let g = vec2f(sx, k0);
    let uv = r * (f - 0.5) + 0.5;
    let fine = dot(textureSampleGrad(regionMap, samp_repeat, uv, r * (dx * g), r * (dy * g)).rgb, lw);
    s += fine / max(dot(textureSampleLevel(regionMap, samp_repeat, uv, coarse).rgb, lw), 1e-3) * wt;
    w += wt;
  }
  return s / w;
}

// the land's colour from its latitude (deg), dryness, high ground and the noise's variation (Boulder's landAlbedo)
fn landAlbedo(lat: f32, dry: f32, high: f32, v: f32, w: f32) -> vec3f {
  let a = abs(lat);
  let doy = L.a.w;
  let summerN = 0.5 - 0.5 * cos(6.2831853 * (doy - 15.0) / 365.0);
  let summer = select(1.0 - summerN, summerN, lat >= 0.0);
  let rain = vec3f(0.040, 0.075, 0.030);
  let temperate = mix(vec3f(0.15, 0.13, 0.10), vec3f(0.08, 0.12, 0.05), summer);
  let boreal = mix(vec3f(0.06, 0.065, 0.055), vec3f(0.045, 0.07, 0.04), summer);
  let tundra = vec3f(0.14, 0.13, 0.10);
  var c = mix(rain, mix(vec3f(0.17, 0.15, 0.08), temperate, smoothstep(22.0, 32.0, a)), smoothstep(8.0, 18.0, a));
  c = mix(c, boreal, smoothstep(48.0, 56.0, a));
  c = mix(c, tundra, smoothstep(62.0, 70.0, a));
  let sand = mix(vec3f(0.55, 0.40, 0.24), vec3f(0.36, 0.25, 0.16), smoothstep(0.35, 0.75, v));
  let steppe = vec3f(0.28, 0.22, 0.14);
  c = mix(c, steppe, smoothstep(0.15, 0.5, dry));
  c = mix(c, sand, smoothstep(0.55, 0.95, dry));
  let cover = smoothstep(0.44, 0.6, v);
  let other = c * mix(vec3f(0.74, 0.86, 0.7), vec3f(1.12, 1.04, 0.96), smoothstep(0.2, 0.6, dry));
  c = mix(other, c * 1.06, cover) * (0.75 + 0.5 * w) * (0.88 + 0.24 * v);
  let mount = smoothstep(0.12, 0.3, high) * (1.0 - smoothstep(0.5, 0.65, high));
  let range = mix(vec3f(0.045, 0.058, 0.042), vec3f(0.17, 0.15, 0.13), smoothstep(0.35, 0.75, v + 0.4 * dry));
  c = mix(c, range, mount * smoothstep(0.1, 0.4, v + 0.3 * mount));
  let snowLat = 55.0 - 17.0 * cos(6.2831853 * (doy - 15.0) / 365.0) * select(-1.0, 1.0, lat >= 0.0);
  let snow = smoothstep(snowLat - 3.0, snowLat + 6.0, a + (v - 0.5) * 8.0 + mount * (2.0 + 12.0 * v * v)) * (1.0 - 0.6 * dry * (1.0 - mount));
  return mix(c, vec3f(0.8, 0.83, 0.88), max(smoothstep(0.6, 0.85, high), snow * 0.85));
}

// the window's picture as the ground grades it (shared with c_ground.wgsl's look, so the hand-over doesn't show)
fn regionAlbedo(c: vec3f) -> vec3f {
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  return clamp(mix(vec3f(l), c, 0.8) * vec3f(1.05, 1.02, 0.96), vec3f(0.0), vec3f(0.9));
}
// the window's relief: its normal (ground axes) at (x, z) km, over a step `eps` km
fn regionNormal(xz: vec2f, eps: f32) -> vec3f {
  let half = E.spot.w;
  let hs = (E.hr.y - E.hr.x) * 0.001;
  let u0 = (xz + half) / (2.0 * half);
  let du = eps / (2.0 * half);
  let hx = (bilinear(regionH, u0 + vec2f(du, 0.0)) - bilinear(regionH, u0 - vec2f(du, 0.0))) * hs;
  let hz = (bilinear(regionH, u0 + vec2f(0.0, du)) - bilinear(regionH, u0 - vec2f(0.0, du))) * hs;
  return normalize(vec3f(-hx, 2.0 * eps, -hz));
}

// the light on the ground at a point of the planet (n) on a surface facing nr: the sun through the air, the sky's blue
fn groundLight(n: vec3f, nr: vec3f) -> vec3f {
  let s = L.sun;
  let muS = dot(n, s);
  let sun = sunAt(PLANET_KM, muS) * saturate(dot(nr, s)) / PI;
  let sky = vec3f(0.025, 0.036, 0.058) * (0.8 * saturate(muS) + 0.2 * smoothstep(-0.18, 0.12, muS));
  return sun + sky + vec3f(0.0004, 0.00045, 0.0006);
}

fn ggxSpec(n: vec3f, v: vec3f, l: vec3f, rough: f32) -> f32 {
  let h = normalize(v + l);
  let a2 = rough * rough * rough * rough;
  let nh = saturate(dot(n, h));
  let d = a2 / (PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
  let f = 0.02 + 0.98 * pow(1.0 - saturate(dot(h, v)), 5.0);
  return d * f * saturate(dot(n, l)) / max(4.0 * saturate(dot(n, v)), 0.1);
}

@fragment fn fs(in: FullscreenOut) -> @location(0) vec4f {
  let rd = rayDir(in.uv);
  let ro = L.eye;
  let c = L.b.xyz;
  let exposure = L.a.x;
  // where the ray meets the planet (or, missing it, passes nearest), and where that is on the globe and in the window,
  // with their change across a pixel: for every pixel first, as derivatives must be (and Boulder's planet does)
  let hp = sphereHit(ro, rd, c, PLANET_R);
  let tt = select(max(dot(c - ro, rd), 0.0), hp.x, hp.x > 0.0);
  let p = ro + rd * tt;
  let n = normalize(p - c);
  let lat = asin(clamp(n.y, -1.0, 1.0));
  let lon = atan2(-n.z, n.x);
  let ll = vec2f(lon, lat);
  let lx = clampLen(unwrapLon(dpdx(ll)), 0.01);
  let ly = clampLen(unwrapLon(dpdy(ll)), 0.01);
  let dsp = p - E.spot.xyz;
  let xz = vec2f(dot(dsp, E.gx.xyz), dot(dsp, E.gz.xyz));
  let half = E.spot.w;
  let ruv = (xz + half) / (2.0 * half);
  let rx = clampLen(dpdx(ruv), 0.5);
  let ry = clampLen(dpdy(ruv), 0.5);
  // the Moon
  let mh = sphereHit(ro, rd, L.c.xyz, 1737.4);
  let tHit = select(1e9, hp.x, hp.x > 0.0);
  if (mh.x > 0.0 && mh.x < tHit) {
    let n = normalize(ro + rd * mh.x - L.c.xyz);
    let cr = cellular(n * 9.0, 1.0);
    let mare = ss(0.1, 0.45, fbm(n * 2.0 + 5.0, 4));
    let alb = mix(0.32, 0.14, mare) * (0.85 + 0.15 * ss(0.0, 0.25, cr.d1)) * (0.9 + 0.2 * fbm(n * 30.0, 3));
    return vec4f(vec3f(alb) * max(dot(n, L.sun), 0.0) / PI * exposure * L.weight, L.weight);
  }
  if (hp.x <= 0.0) {
    // the air round the limb (from inside it, the sky): light, hiding nothing behind it
    return vec4f(skyAt(rd) * exposure * L.weight, 0.0);
  }
  let t = hp.x;
  let v = -rd;
  let muV = max(dot(n, v), 0.0);
  let pix = t * L.pxAngle / max(muV, 0.06);
  let dim = vec2f(textureDimensions(earthMap));
  let uv = vec2f(fract(lon / (2.0 * PI) + 0.5), clamp(0.5 - lat / PI, 0.5 / dim.y, 1.0 - 0.5 / dim.y));
  let texel = 2.0 * PI * PLANET_R / dim.x;
  let m = textureSampleLevel(earthMap, samp_repeat, uv, max(log2(pix / texel), 0.0));
  let latD = lat * 180.0 / PI;
  let e3 = n;
  let detail = fbm3(e3 * 110.0, octaves(60.0, pix), 0.68);
  let broad = fbm3(e3 * 23.0 + 5.1, 2, 0.5);
  let fine = landDetail(ll, lx, ly, 1.0, 5.5) * mix(1.0, landDetail(ll + 0.37, lx, ly, 8.0, 8.5), 0.45);
  let aa = clamp(pix / texel * 0.35, 0.03, 0.5);
  let land = smoothstep(0.5 - aa, 0.5 + aa, m.r + (detail - 0.5) * 0.5);
  let s = L.sun;
  let muS = dot(n, s);

  // the window round the spot: its own picture and relief, handed over across its edge
  let e2 = max(abs(xz.x), abs(xz.y)) / half;
  var nr = n;
  var albedo = landAlbedo(latD, m.g, m.a, detail, broad) * mix(1.0, fine, 0.8 * (1.0 - smoothstep(0.6, 0.85, m.a)));
  if (e2 < 3.0) {
    let ruvC = clamp((xz + half) / (2.0 * half), vec2f(0.0), vec2f(1.0));
    let near = srgbIn(textureSampleLevel(regionMap, samp_linear, ruvC, mix(8.0, 10.0, smoothstep(1.0, 2.5, e2))).rgb) * fine;
    albedo = mix(albedo, regionAlbedo(near), 0.85 * (1.0 - smoothstep(1.0, 3.0, e2)));
  }
  if (e2 < 1.0) {
    let rc = srgbIn(textureSampleGrad(regionMap, samp_linear, ruv, rx, ry).rgb);
    let tn = regionNormal(xz, clamp(t * 0.002, 0.07, 0.4));
    let inside = 1.0 - smoothstep(0.85, 1.0, e2);
    nr = normalize(mix(n, normalize(E.gx.xyz * tn.x + E.gy.xyz * tn.y + E.gz.xyz * tn.z), inside));
    albedo = mix(albedo, regionAlbedo(rc), inside);
  }
  var col = albedo * groundLight(n, nr) * land;

  // the sea: deep, teal over the shelves, the sun's glint, the sky's sheen toward the limb
  if (land < 1.0) {
    let shelf = smoothstep(0.12, 0.45, m.r + (detail - 0.5) * 0.3);
    let sea = mix(vec3f(0.006, 0.018, 0.042), vec3f(0.018, 0.060, 0.072), shelf);
    let glint = ggxSpec(n, v, s, 0.22) * sunAt(PLANET_KM, muS);
    let fres = 0.02 + 0.98 * pow(1.0 - muV, 5.0);
    let sheen = vec3f(0.05, 0.08, 0.13) * smoothstep(-0.1, 0.3, muS) * fres;
    col += (sea * groundLight(n, n) + glint + sheen) * (1.0 - land);
  }

  // the clouds: a cover by latitude (the doldrums, the subtropics' clear belts, the storm tracks), less over the
  // deserts, drifting with their latitude's winds; a clear day over the spot
  let fromSpot = length(xz);
  let clear = smoothstep(180.0, 500.0, fromSpot);
  var cloud = 0.0;
  if (clear > 0.0) {
    let a = abs(latD);
    var cover = 0.42 + 0.28 * exp(-latD * latD / 60.0) - 0.3 * exp(-(a - 24.0) * (a - 24.0) / 70.0) + 0.18 * smoothstep(38.0, 55.0, a);
    cover -= 0.35 * m.g * land;
    let wind = mix(-0.6, 1.0, smoothstep(18.0, 32.0, a)) * mix(1.0, 0.4, smoothstep(60.0, 75.0, a));
    let ang = L.time * 2e-4 * wind;
    let q = vec3f(e3.x * cos(ang) + e3.z * sin(ang), e3.y, -e3.x * sin(ang) + e3.z * cos(ang));
    let w = vec3f(noise3(q * 3.1), noise3(q * 3.1 + 17.3), noise3(q * 3.1 + 41.7)) - 0.5;
    let f = fbm3(q * 7.0 + w * 1.4, octaves(900.0, pix), 0.55);
    let dens = smoothstep(1.0 - cover, 1.25 - cover, f) * clear;
    cloud = dens;
    if (dens > 0.0) {
      let up = smoothstep(-0.25, 0.1, muS);
      let sunC = sunAt(8.0, muS);
      let cl = 0.82 * (sunC * (0.15 + 0.85 * saturate(muS + 0.05)) / PI + vec3f(0.03, 0.04, 0.06) * up);
      col = mix(col, cl, dens);
    }
  }
  // the cities' lights where the sun has set
  let dusk = 1.0 - smoothstep(-0.14, 0.02, muS);
  if (dusk > 0.0 && m.b > 0.002) {
    let f = fbm3(e3 * 2600.0, octaves(2.5, pix), 0.62);
    let lit = smoothstep(1.0 - m.b * 1.6, 1.12 - m.b * 1.6, f) * (0.4 + 0.6 * m.b);
    col += vec3f(1.0, 0.66, 0.36) * lit * 0.05 * dusk * land * (1.0 - 0.8 * cloud);
  }
  return vec4f(throughAir(col, n, rd) * exposure * L.weight, L.weight);
}
