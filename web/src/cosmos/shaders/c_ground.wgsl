// The meadow at Chautauqua in Boulder (metres; x east, y up, z south; the level's origin is the eye of someone lying
// on their back in the grass, looking up), on the real ground: Boulder's own heights and aerial pictures in two windows round the spot
// (earthdata.ts: 8 km across at 16 m, 120 km at 117 m) — the Flatirons and Green Mountain over the meadow, the town
// below, the plains, the Indian Peaks — on a curved Earth; Boulder's air (air.wgsl) for the sky and the haze; grass
// blades up close and Eli lying in them (drawn before, figure.wgsl: laid in here, the blades in front of them in
// front; their shadow and the grass they press from figproxy.wgsl), which are this level's own.
// L.a: exposure, -, night (0..1), grass detail (0..1).
#include "cosmos.wgsl"
#include "air.wgsl"
#include "figpress.wgsl"
#include "weft/fullscreen"

struct GroundU {
  near: vec4f,      // the near window: x its half (m), y z its heights' range (m), w -
  far: vec4f,       // the far one
  spot: vec4f,      // x the spot's height above the sea (km), y the Earth's radius there (m)
}
@group(2) @binding(1) var nearH: texture_2d<f32>;
@group(2) @binding(2) var nearC: texture_2d<f32>;
@group(2) @binding(3) var farH: texture_2d<f32>;
@group(2) @binding(4) var farC: texture_2d<f32>;
@group(2) @binding(5) var<uniform> G: GroundU;
@group(2) @binding(6) var figCol: texture_2d<f32>;
@group(2) @binding(7) var figDist: texture_2d<f32>;
@group(2) @binding(8) var pressTex: texture_2d<f32>;

fn srgbIn(c: vec3f) -> vec3f { return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045)); }
fn winUv(xz: vec2f, half: f32) -> vec2f { return clamp((xz + half) / (2.0 * half), vec2f(0.0), vec2f(1.0)); }

// the land's height at (x, z) (relative to the spot's ground); `lod` keeps the micro relief to near the eye
fn terrain(x: f32, z: f32, lod: f32) -> f32 {
  let xz = vec2f(x, z);
  // (past the far window, the plains' level: the planet's view of what's further is the Earth level's)
  let ef = max(abs(x), abs(z)) / G.far.x;
  var h = mix(G.far.y, G.far.z, bilinear(farH, winUv(xz, G.far.x))) * (1.0 - ss(0.92, 1.0, ef));
  let en = max(abs(x), abs(z)) / G.near.x;
  if (en < 1.0) {
    let hn = mix(G.near.y, G.near.z, bilinear(nearH, winUv(xz, G.near.x)));
    h = mix(hn, h, ss(0.8, 1.0, en));
  }
  // the meadow levelled where they lie, its own small swells close by (finer than the data's 16 m)
  let r = length(xz);
  h *= ss(3.0, 40.0, r);
  if (r < 300.0 && lod < 3.0) { h += fbm(vec3f(x, 0.0, z) / 9.0, 3) * 0.35 * ss(300.0, 60.0, r) * ss(1.5, 8.0, r); }
  // the Earth curves away
  return h - (x * x + z * z) / (2.0 * G.spot.y);
}

// ---------------------------------------------------------------- grass
const GH = 0.11;
// a blade near (x, z) at height y: distance to it, and its tint
fn blade(p: vec3f) -> vec2f {
  let cs = GRASS_CS;
  let c = floor(p.xz / cs);
  var best = 1.0; var tint = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let g = c + vec2f(f32(i), f32(j));
      let h = hash3i(vec3i(i32(g.x), i32(g.y), 31));
      // (above it even standing: pressing only lowers it)
      let stand = GH * (0.45 + 0.55 * h.z);
      if (p.y > stand) { continue; }
      // (flattened under them and round their edge)
      let bp = vec3f((g.x + 0.5) * cs, 0.0, (g.y + 0.5) * cs);
      var press = 1.0;
      if (all(bp.xz > FIG_LO.xz - PRESS_PAD) && all(bp.xz < FIG_HI.xz + PRESS_PAD)) {
        let k = vec2i(g) - PRESS_G0;
        if (all(k >= vec2i(0)) && all(k < PRESS_N)) { press = textureLoad(pressTex, k, 0).r; } else { press = pressOf(g); }
      }
      let hgt = stand * mix(0.15, 1.0, press);
      let u = p.y / hgt;
      if (u > 1.0) { continue; }
      // bent by its lean and the wind, more toward the tip
      let lean = (h.xy - 0.5) * 0.05 + vec2f(sin(L.time * 1.3 + g.x * 0.4) * 0.008, 0.0);
      let base = (g + 0.2 + h.xy * 0.6) * cs;
      let at = base + lean * u * u;
      let r = 0.0016 * (1.0 - u * 0.85);
      let d = length(p.xz - at) - r;
      if (d < best) { best = d; tint = h.z; }
    }
  }
  return vec2f(best, tint);
}

fn grassColor(t: f32, u: f32) -> vec3f {
  let base = mix(vec3f(0.05, 0.09, 0.02), vec3f(0.16, 0.22, 0.05), u);
  return mix(base, vec3f(0.42, 0.36, 0.14) * (0.5 + u), ss(0.55, 0.95, t) * 0.7);
}

fn meadow(p: vec3f, dist: f32) -> vec3f {
  let q = vec3f(p.x, 0.0, p.z);
  let patchy = fbm(q / 18.0, 4) * 0.5 + 0.5;
  var c = mix(vec3f(0.09, 0.12, 0.04), vec3f(0.28, 0.25, 0.1), ss(0.35, 0.75, patchy));
  c *= 0.8 + 0.4 * fbm(q * 3.0, 3) * ss(60.0, 5.0, dist);
  return c;
}

// the pictures as the planet grades them (c_earth.wgsl regionAlbedo: the hand-over between them can't be seen)
fn regionAlbedo(c: vec3f) -> vec3f {
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  return clamp(mix(vec3f(l), c, 0.8) * vec3f(1.05, 1.02, 0.96), vec3f(0.0), vec3f(0.9));
}

// the land's colour: the near window's picture (8 m), the far one's beyond (117 m), at the mip a pixel's footprint
// there wants (fp, m); close in, the meadow's own texture over it
fn landColor(p: vec3f, n: vec3f, dist: f32, fp: f32) -> vec3f {
  let xz = p.xz;
  let cf = srgbIn(textureSampleLevel(farC, samp_linear, winUv(xz, G.far.x), max(log2(fp / (2.0 * G.far.x / 1024.0)), 0.0)).rgb);
  // (past the far window: the window's own average, its last mip)
  var c = mix(cf, srgbIn(textureSampleLevel(farC, samp_linear, vec2f(0.5), 10.0).rgb), ss(0.92, 1.0, max(abs(xz.x), abs(xz.y)) / G.far.x));
  let en = max(abs(xz.x), abs(xz.y)) / G.near.x;
  if (en < 1.0) {
    let cn = srgbIn(textureSampleLevel(nearC, samp_linear, winUv(xz, G.near.x), max(log2(fp / (2.0 * G.near.x / 1024.0)), 0.0)).rgb);
    c = mix(cn, cf, ss(0.8, 1.0, en));
  }
  c = regionAlbedo(c);
  // (within a couple of hundred metres, finer than the picture: the meadow's grass in its colour)
  let k = ss(220.0, 40.0, length(xz));
  return mix(c, c * meadow(p, dist) / vec3f(0.18, 0.18, 0.07) * 0.9, k * 0.6);
}

fn terrainNormal(x: f32, z: f32, e: f32, lod: f32) -> vec3f {
  let h0 = terrain(x, z, lod);
  return normalize(vec3f(h0 - terrain(x + e, z, lod), e, h0 - terrain(x, z + e, lod)));
}

struct Hit { t: f32, kind: i32, tint: f32 }

@fragment fn fs(in: FullscreenOut) -> @location(0) vec4f {
  let rd = rayDir(in.uv);
  let ro = L.eye + L.origin;      // (ground coordinates: small, the origin is a few cm above the Boulder point)
  let sun = L.sun;
  var hit: Hit; hit.t = -1.0; hit.kind = 0;
  let tMax = 400000.0;
  // Eli, as drawn: their colour, how much of the pixel they cover, how far (where they cover it all, nothing behind
  // them need be found)
  let px = vec2i(in.pos.xy);
  let fc = textureLoad(figCol, px, 0);
  let cov = fc.a;
  let tFig = select(1e9, cov / max(textureLoad(figDist, px, 0).r, 1e-12), cov > 0.004);
  let whole = cov > 0.996;
  let tHand = select(1e9, tFig, whole);
  // the grass layer near the eye (when it's fine enough to see)
  var tGrass = 1e9; var gTint = 0.0;
  if (L.a.w > 0.01 && rd.y < 0.0) {
    let tTop = (GH - ro.y) / rd.y;
    let tBot = (0.0 - ro.y) / rd.y;
    let t0 = max(tTop, 0.0);
    let t1 = min(tBot, min(t0 + 3.0, tHand));
    if (t1 > t0 && t0 < 12.0) {
      let n = 26;
      let dt = (t1 - t0) / f32(n);
      let jit = hash3u(vec3u(vec2u(in.pos.xy), frame.frame % 32u)).x;
      for (var i = 0; i < n; i++) {
        let t = t0 + (f32(i) + jit) * dt;
        let b = blade(ro + rd * t);
        if (b.x < 0.0) { tGrass = t; gTint = b.y; break; }
      }
    }
  }
  // the land
  var tLand = 1e9;
  if ((rd.y < 0.35 || ro.y > 3000.0) && !whole) {
    var t = 0.0;
    let tTop = select(1e9, (4500.0 - ro.y) / rd.y, rd.y < 0.0 && ro.y > 4500.0);
    if (tTop < 1e9) { t = tTop; }
    // (no further than a blade or the hand already found nearer)
    let tStop = min(tMax, min(tGrass, tHand));
    var ran = true;
    for (var i = 0; i < 160; i++) {
      let p = ro + rd * t;
      let lod = log2(max(t, 1.0) / 400.0);
      let h = terrain(p.x, p.z, lod);
      let dy = p.y - h;
      if (dy < max(0.002, t * 0.0008)) { tLand = t; ran = false; break; }
      t += max(dy * 0.5, 0.02 + t * 0.012);
      if (t > tStop || (rd.y > 0.0 && p.y > 5000.0)) { ran = false; break; }
    }
    // (a ray that grazed the land all the way, out of steps still just above it, has met it: not the sky)
    if (ran && rd.y < 0.02) { tLand = t; }
  }
  var col = vec3f(0.0);
  var alpha = 1.0;
  let tSurf = min(tGrass, tLand);
  // the sun through the air to the meadow (its illuminance 1 above the air, as Boulder's), the sky's blue light
  let sunCol = sunAt(G.spot.x + max(ro.y, 0.0) * 0.001, sun.y) / PI;
  let ambient = vec3f(0.025, 0.036, 0.058) * (0.8 * saturate(sun.y) + 0.2 * ss(-0.18, 0.12, sun.y));
  if (tSurf < 1e8) {
    let p = ro + rd * tSurf;
    var n: vec3f; var alb: vec3f; var sss = 0.0;
    if (tSurf == tGrass) {
      let u = clamp(p.y / GH, 0.0, 1.0);
      n = normalize(vec3f(-rd.x, 0.6, -rd.z));
      alb = grassColor(gTint, u) * (0.8 + 0.5 * meadow(p, tSurf).g * 3.0);
      sss = 0.6;
    } else {
      let lod = log2(max(tSurf, 1.0) / 400.0);
      n = terrainNormal(p.x, p.z, max(0.05, tSurf * 0.002), lod);
      alb = landColor(p, n, tSurf, tSurf * L.pxAngle / max(dot(n, -rd), 0.15));
      // near: soil and old stems under the blades
      alb = mix(alb, vec3f(0.06, 0.05, 0.03), L.a.w * ss(3.0, 0.5, tSurf) * 0.6);
    }
    let lam = dot(n, sun);
    var diff = max(lam, 0.0);
    // their shadow on the grass
    {
      let hs = figSpan(p + sun * 0.002, sun);
      if (hs.y > hs.x && length(p.xz - vec2f(0.75, 0.0)) < 3.5) {
        var t = max(hs.x, 0.002); var sh = 1.0;
        for (var i = 0; i < 28; i++) {
          let d = figSdf(p + sun * t);
          sh = min(sh, 10.0 * d / t);
          t += max(d, 0.004);
          if (sh < 0.01 || t > hs.y) { break; }
        }
        diff *= clamp(sh, 0.0, 1.0);
      }
    }
    let wrap = max((lam + 0.5) / 1.5, 0.0) * sss * vec3f(1.0, 0.45, 0.3) * 0.5;
    // occlusion: the grass under and round them
    var ao = 1.0;
    if (all(p > FIG_LO - 0.15) && all(p < FIG_HI + 0.15)) { ao = mix(0.3, 1.0, ss(0.0, 0.06, figSdf(p))); }
    col = alb * (sunCol * (diff + wrap) + ambient) * ao;
    // the haze between (none to speak of within a couple of hundred metres)
    if (tSurf > 150.0) {
      let a = airSpan(rd, tSurf * 0.001, 6);
      col = col * a.T + a.L;
    }
  } else {
    // (the sky only where it's seen)
    let sky = skyAt(rd);
    col = sky;
    // the Sun's disc
    let mu = dot(rd, sun);
    col += sunCol * ss(0.99996, 0.999985, mu) * 4000.0;
    // (by night the sky is clear glass: the stars behind show through)
    alpha = clamp(dot(sky, vec3f(0.3, 0.5, 0.2)) * 60.0, 0.0, 1.0);
  }
  // Eli over what's behind them, unless a blade is nearer
  if (cov > 0.004 && tGrass > tFig) {
    col = fc.rgb + col * (1.0 - cov);
    alpha = cov + alpha * (1.0 - cov);
  }
  return vec4f(col * L.a.x * L.weight, alpha * L.weight);
}
