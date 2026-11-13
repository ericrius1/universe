// The Earth from space (kilometres; L.b.xyz its centre relative to the level's origin), as it is (data/globe/): NASA's
// Blue Marble by day, the Black Marble's city lights faded in across the terminator, a real day's clouds casting their
// shadows (the cloud map looked up again along the Sun's way down), the relief catching the low sun, the sea from the
// sea mask with the Sun's glint on it and never on land — and round the spot the dive ends on the real thing: the aerial
// picture and the relief of a window 120 km across (the same the ground level stands on, so the one hands over to the
// other). Lit and seen through the air (air.wgsl). The Moon from its colour and height maps, lit by the Sun and, on its
// night side, by the Earth.
// L.a: exposure, -, how near (finer detail), day of the year. L.c: the Moon's centre; w 1: it's more than a speck.
#include "cosmos.wgsl"
#include "air.wgsl"
#include "weft/fullscreen"

struct EarthU {
  gx: vec4f, gy: vec4f, gz: vec4f,   // the ground's axes (east, up, south) at the spot, in the Earth's
  spot: vec4f,                       // the spot relative to the level's origin (km); w the window's half (km)
  hr: vec4f,                         // the window's heights: x min, y max (m, relative to the spot); z 1: its data's in;
                                     // w 1: the Earth is more than a speck
  mx: vec4f,                         // the Moon's near side (unit, the Earth's axes); w 1: its maps are in
  mz: vec4f,                         // its pole; w the Earth's light on it (earthshine, the Sun's 1)
}
@group(2) @binding(1) var dayMap: texture_2d<f32>;      // Blue Marble (sRGB, sampled linear)
@group(2) @binding(2) var regionMap: texture_2d<f32>;   // the window's aerial picture (sRGB)
@group(2) @binding(3) var regionH: texture_2d<f32>;     // its heights (0..1 between hr.x and hr.y)
@group(2) @binding(4) var<uniform> E: EarthU;
@group(2) @binding(5) var nightMap: texture_2d<f32>;    // the city lights (sRGB-encoded grey)
@group(2) @binding(6) var cloudMap: texture_2d<f32>;    // a day's clouds (0 clear)
@group(2) @binding(7) var reliefMap: texture_2d<f32>;   // 0..0.5 the sea's depth (0.5 the shore), 0.5..1 the land's height
@group(2) @binding(8) var seaMask: texture_2d<f32>;     // 1 land, 0 sea
@group(2) @binding(9) var moonColor: texture_2d<f32>;   // LROC WAC (sRGB)
@group(2) @binding(14) var moonHeight: texture_2d<f32>; // LOLA, km above 1737.4

const PLANET_R = R_BOTTOM + PLANET_KM;
const MOON_R = 1737.4;
/** the clouds' shell above the ground (km): where they're looked up for the limb's parallax and their shadows */
const CLOUD_KM = 8.0;
/** the relief map's land heights as km: NASA's greyscale isn't metres; this takes its top as the highest summits */
const RELIEF_KM = 7.0;

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
fn clampLen(d: vec2f, most: f32) -> vec2f { return d * min(1.0, most / max(length(d), 1e-12)); }
fn unwrapLon(d: vec2f) -> vec2f { return vec2f(d.x - 2.0 * PI * round(d.x / (2.0 * PI)), d.y); }
fn srgbIn(c: vec3f) -> vec3f { return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045)); }
fn lum(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

// a point on the globe (unit, the Earth's axes: x Greenwich, y north) to the maps' plate carrée (globe.json)
fn globeUv(n: vec3f) -> vec2f {
  let lat = asin(clamp(n.y, -1.0, 1.0));
  let lon = atan2(-n.z, n.x);
  return vec2f(fract(lon / (2.0 * PI) + 0.5), 0.5 - lat / PI);
}
// a map's mip for a footprint on the ground (km) at a latitude (its texels narrow toward the poles)
fn mapLod(t: texture_2d<f32>, foot: f32, cosLat: f32) -> f32 {
  let w = f32(textureDimensions(t).x);
  return log2(max(foot / (2.0 * PI * PLANET_R / w * max(cosLat, 0.05)), 1.0));
}

// the land's fine texture past what the map holds: the window's own picture laid over the globe in tiles, each turned its
// own way, two lattices half a tile apart blended (Boulder's landDetail); only its fine part
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

// the clouds' cover at a point of their shell (unit), at a footprint (km): the map's grey has a floor over clear sea
fn cloudAt(n: vec3f, foot: f32) -> f32 {
  let uv = globeUv(n);
  let v = textureSampleLevel(cloudMap, samp_repeat, uv, mapLod(cloudMap, foot, sqrt(max(1.0 - n.y * n.y, 0.0)))).r;
  return pow(saturate((v - 0.12) / 0.78), 1.2);
}

// ---------------------------------------------------------------- the Moon
fn moonShade(ro: vec3f, rd: vec3f, t: f32) -> vec3f {
  let mc = L.c.xyz;
  let n = normalize(ro + rd * t - mc);
  let px = E.mx.xyz;
  let pz = E.mz.xyz;
  let east = cross(pz, px);   // (selenographic east: on the right of the near side seen from the Earth, north up)
  let lat = asin(clamp(dot(n, pz), -1.0, 1.0));
  let lon = atan2(dot(n, east), dot(n, px));
  let uv = vec2f(fract(lon / (2.0 * PI) + 0.5), 0.5 - lat / PI);
  let v = -rd;
  let mu = max(dot(n, v), 1e-3);
  let foot = t * L.pxAngle / max(mu, 0.15);
  var alb = vec3f(0.11);
  var nr = n;
  if (E.mx.w > 0.5) {
    let cl = cos(lat);
    // (LROC's colour map is reflectance stretched for display, its mean 0.33: brought to the Moon's own albedo, 0.12)
    alb = textureSampleLevel(moonColor, samp_repeat, uv, mapLod(moonColor, foot * PLANET_R / MOON_R, cl)).rgb * 0.36;
    // the relief from LOLA's heights: their slopes east and north over a step the footprint can hold
    let hd = vec2f(textureDimensions(moonHeight));
    let st = max(1.0 / hd.x, foot / (2.0 * PI * MOON_R));
    let lod = log2(max(st * hd.x, 1.0));
    let du = vec2f(st / max(cl, 0.1), 0.0);
    let dv = vec2f(0.0, st);
    let hE = textureSampleLevel(moonHeight, samp_repeat, uv + du, lod).r - textureSampleLevel(moonHeight, samp_repeat, uv - du, lod).r;
    let hN = textureSampleLevel(moonHeight, samp_repeat, uv - dv, lod).r - textureSampleLevel(moonHeight, samp_repeat, uv + dv, lod).r;
    let span = 2.0 * st * 2.0 * PI * MOON_R;
    let north = normalize(pz - n * dot(pz, n));
    let e = cross(north, n);
    nr = normalize(n - (e * hE + north * hN * 2.0) / span);
  }
  // Lommel–Seeliger, as the regolith sends light back (the full Moon's disc as bright at its edge as its middle),
  // darkening into the terminator as its roughness shadows itself
  let s = L.sun;
  let mu0 = dot(nr, s);
  var lit = 0.0;
  if (mu0 > 0.0) { lit = 2.0 * mu0 / (mu0 + mu) * mix(0.55, 1.0, saturate(dot(n, s) * 4.0)); }
  // the Earth's shadow on it (an eclipse): the Sun's way from here passing through the Earth
  let es = sphereHit(ro + rd * t, s, L.b.xyz, PLANET_R + 30.0);
  if (es.y > 0.0) { lit = 0.0; }
  // earthshine: the Earth's light from its direction, as faint as it is
  let toE = normalize(L.b.xyz - (ro + rd * t));
  let shine = E.mz.w * saturate(dot(nr, toE)) * vec3f(0.85, 0.92, 1.0);
  // (π: the albedo's Lambertian radiance is albedo · μ0 / π under a sun of 1; the Earth's ground is lit so too)
  return alb * (lit + shine) / PI;
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
  let region = E.hr.z > 0.5;
  // the Moon
  let mh = sphereHit(ro, rd, L.c.xyz, MOON_R);
  let tHit = select(1e9, hp.x, hp.x > 0.0 && E.hr.w > 0.5);
  if (L.c.w > 0.5 && mh.x > 0.0 && mh.x < tHit) {
    return vec4f(moonShade(ro, rd, mh.x) * exposure * L.weight, L.weight);
  }
  if (E.hr.w < 0.5) { discard; }
  if (hp.x <= 0.0) {
    // the air round the limb (from inside it, the sky): light, hiding nothing behind it
    return vec4f(skyAt(rd) * exposure * L.weight, 0.0);
  }
  let t = hp.x;
  let v = -rd;
  let muV = max(dot(n, v), 0.0);
  let pix = t * L.pxAngle / max(muV, 0.06);
  let cl = cos(lat);
  let uv = vec2f(fract(lon / (2.0 * PI) + 0.5), 0.5 - lat / PI);
  let s = L.sun;
  let muS = dot(n, s);

  // the land and the sea: the mask, its edge as soft as a pixel's footprint
  let land = textureSampleLevel(seaMask, samp_repeat, uv, mapLod(seaMask, pix, cl)).r;
  var day = textureSampleLevel(dayMap, samp_repeat, uv, mapLod(dayMap, pix, cl)).rgb;
  // the relief: the land's slopes from its heights, so ranges catch a low sun (the day map's own shading is a high one)
  let rd2 = vec2f(textureDimensions(reliefMap));
  let rl = mapLod(reliefMap, pix, cl);
  let step = max(1.0, exp2(rl)) / rd2;
  let du = vec2f(step.x, 0.0);
  let dv = vec2f(0.0, step.y);
  let hc = textureSampleLevel(reliefMap, samp_repeat, uv, rl).r;
  let hE = max(textureSampleLevel(reliefMap, samp_repeat, uv + du, rl).r - 0.5, 0.0) - max(textureSampleLevel(reliefMap, samp_repeat, uv - du, rl).r - 0.5, 0.0);
  let hN = max(textureSampleLevel(reliefMap, samp_repeat, uv - dv, rl).r - 0.5, 0.0) - max(textureSampleLevel(reliefMap, samp_repeat, uv + dv, rl).r - 0.5, 0.0);
  let spanE = 2.0 * step.x * 2.0 * PI * PLANET_R * max(cl, 0.05);
  let spanN = 2.0 * step.y * PI * PLANET_R;
  let northV = normalize(vec3f(0.0, 1.0, 0.0) - n * n.y + vec3f(1e-6));
  let eastT = cross(northV, n);
  let k = RELIEF_KM * 2.0;
  var nr = normalize(n - (eastT * hE * k / spanE + northV * hN * k / spanN) * land);

  // the window round the spot: its own picture and relief, handed over across its edge
  let e2 = max(abs(xz.x), abs(xz.y)) / half;
  var albedo = day;
  // (the map's own grain runs out within a few km: past it, the window's picture's fine texture over it)
  let texel = 2.0 * PI * PLANET_R / f32(textureDimensions(dayMap).x);
  let magnified = 1.0 - smoothstep(0.25, 1.0, pix / texel);
  if (region && magnified > 0.0) {
    let fine = landDetail(ll, lx, ly, 1.0, 5.5) * mix(1.0, landDetail(ll + 0.37, lx, ly, 8.0, 8.5), 0.45);
    albedo *= mix(1.0, fine, 0.8 * magnified * land);
  }
  // (round, inside and out: its colours a soft region fading into the planet's, not the window's square)
  let er = length(xz) / half;
  if (region && er < 3.5) {
    let ruvC = clamp((xz + half) / (2.0 * half), vec2f(0.0), vec2f(1.0));
    let near = srgbIn(textureSampleLevel(regionMap, samp_linear, ruvC, mix(8.0, 10.0, smoothstep(1.0, 2.5, er))).rgb);
    albedo = mix(albedo, regionAlbedo(near), 0.85 * (1.0 - smoothstep(0.9, 3.5, er)));
  }
  if (region && e2 < 1.0) {
    let rc = srgbIn(textureSampleGrad(regionMap, samp_linear, ruv, rx, ry).rgb);
    let tn = regionNormal(xz, clamp(t * 0.002, 0.07, 0.4));
    let inside = (1.0 - smoothstep(0.85, 1.0, e2)) * (1.0 - smoothstep(0.55, 1.0, er));
    nr = normalize(mix(nr, normalize(E.gx.xyz * tn.x + E.gy.xyz * tn.y + E.gz.xyz * tn.z), inside));
    albedo = mix(albedo, regionAlbedo(rc), inside);
  }

  // the clouds over this point, and their shadow on it: the cloud map looked up again where the Sun's way down crosses
  // their shell. A clear sky over the spot (the gardens' own sky is what's seen there)
  let fromSpot = length(xz);
  let clear = select(1.0, smoothstep(180.0, 500.0, fromSpot), region);
  let hc2 = sphereHit(ro, rd, c, PLANET_R + CLOUD_KM);
  let nc = normalize(ro + rd * max(hc2.x, 0.0) - c);
  let cloud = cloudAt(nc, pix) * clear;
  let shadowAt = normalize(n * (PLANET_R + CLOUD_KM) + s * (CLOUD_KM / max(muS, 0.08)));
  let shadow = 1.0 - 0.8 * cloudAt(shadowAt, max(pix, 6.0)) * clear * ss(-0.05, 0.1, muS);

  // the ground: the land lit through the air and under the clouds' shadows
  var col = albedo * groundLight(n, nr) * land * shadow;

  // the sea: its own dark colour (not the map's shaded bathymetry, which no satellite sees), teal over the shelves,
  // sea ice where the day map is white; the Sun's glint and the sky's sheen toward the limb
  if (land < 1.0) {
    let shelf = smoothstep(0.42, 0.495, hc);
    let ice = smoothstep(0.12, 0.35, lum(day));
    let sea = mix(mix(vec3f(0.006, 0.018, 0.042), vec3f(0.018, 0.060, 0.072), shelf), day, ice);
    let glint = ggxSpec(n, v, s, 0.22) * sunAt(PLANET_KM, muS) * (1.0 - ice) * shadow;
    let fres = 0.02 + 0.98 * pow(1.0 - muV, 5.0);
    let sheen = vec3f(0.05, 0.08, 0.13) * smoothstep(-0.1, 0.3, muS) * fres * (1.0 - ice);
    col += (sea * groundLight(n, n) * shadow + glint + sheen) * (1.0 - land);
  }

  // the clouds themselves, lit through the air above them
  if (cloud > 0.0) {
    let up = smoothstep(-0.25, 0.1, muS);
    let sunC = sunAt(CLOUD_KM, muS);
    let cl2 = 0.82 * (sunC * (0.15 + 0.85 * saturate(muS + 0.05)) / PI + vec3f(0.03, 0.04, 0.06) * up);
    col = mix(col, cl2, cloud);
  }
  // the cities' lights where the sun has set: faded in across the terminator over 8° (from the sun 2° up to 6° down),
  // dimmed through the clouds
  let dusk = 1.0 - smoothstep(-0.105, 0.035, muS);
  if (dusk > 0.0) {
    let lights = srgbIn(vec3f(textureSampleLevel(nightMap, samp_repeat, uv, mapLod(nightMap, pix, cl)).r)).r;
    col += vec3f(1.0, 0.7, 0.42) * lights * 0.06 * dusk * (1.0 - 0.85 * cloud);
  }
  return vec4f(throughAir(col, n, rd) * exposure * L.weight, L.weight);
}
