// A meadow outside Boulder (metres; x east, y up, z south; the level's origin is the back of a hand lying in the
// grass): the Front Range round it (front.wgsl: the plains, the Flatirons, the Indian Peaks, on a curved Earth); grass
// blades up close; the hand; the sky and the haze from atmo.wgsl.
// L.a: exposure, sun intensity, night (0..1), grass detail (0..1).
#include "cosmos.wgsl"
#include "atmo.wgsl"
#include "front.wgsl"
#include "weft/fullscreen"

// ---------------------------------------------------------------- the hand
fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
  let pa = p - a; let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
fn sdRoundBox(p: vec3f, b: vec3f, r: f32) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
fn smin(a: f32, b: f32, k: f32) -> f32 { let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

// a capsule whose radius runs from ra at a to rb at b
fn sdCone(p: vec3f, a: vec3f, b: vec3f, ra: f32, rb: f32) -> f32 {
  let pa = p - a; let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}
fn hand(p: vec3f) -> f32 {
  // the palm, a little domed, then the forearm tapering to the wrist
  // (a soft dome, lower on the little finger's side)
  let pp = p - vec3f(0.0, 0.022 + p.z * 0.06, 0.0);
  var d = sdRoundBox(pp, vec3f(0.036, 0.004, 0.032), 0.016) - 0.003 * (1.0 - clamp(length(pp.xz) / 0.05, 0.0, 1.0));
  d = smin(d, sdCone(p, vec3f(0.05, 0.026, 0.004), vec3f(0.34, 0.036, 0.075), 0.021, 0.034), 0.02);
  // four fingers, relaxed: three bones each, curling down to the grass; kept apart (a hard union between them)
  var f = 1e9;
  for (var i = 0; i < 4; i++) {
    let zf = -0.03 + f32(i) * 0.0205;
    let len = select(0.074, 0.086, i == 1 || i == 2) - select(0.0, 0.014, i == 3);
    let r = select(0.0082, 0.0074, i == 3);
    let a = vec3f(-0.044, 0.028, zf);
    let m1 = vec3f(-0.044 - len * 0.45, 0.026, zf * 1.08);
    let m2 = vec3f(-0.044 - len * 0.78, 0.018, zf * 1.12);
    let b = vec3f(-0.044 - len, 0.008, zf * 1.15);
    f = min(f, min(sdCapsule(p, a, m1, r), min(sdCone(p, m1, m2, r * 0.95, r * 0.86), sdCone(p, m2, b, r * 0.86, r * 0.72))));
  }
  d = smin(d, f, 0.004);
  d = smin(d, min(sdCone(p, vec3f(0.014, 0.022, -0.038), vec3f(-0.018, 0.017, -0.064), 0.0115, 0.0098), sdCone(p, vec3f(-0.018, 0.017, -0.064), vec3f(-0.042, 0.012, -0.078), 0.0098, 0.0082)), 0.01);
  // the knuckles
  for (var i = 0; i < 4; i++) { d = smin(d, length(p - vec3f(-0.043, 0.033, -0.03 + f32(i) * 0.0205)) - 0.0075, 0.006); }
  return d;
}
fn handNormal(p: vec3f) -> vec3f {
  let e = vec2f(0.0004, 0.0);
  return normalize(vec3f(hand(p + e.xyy) - hand(p - e.xyy), hand(p + e.yxy) - hand(p - e.yxy), hand(p + e.yyx) - hand(p - e.yyx)));
}

// the hand's footprint on the grass (x, z): its distance, roughly (the palm, the fingers together, the thumb, the
// forearm), cheap enough for every blade near it to ask
fn sd2Box(p: vec2f, c: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p - c) - b;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}
fn sd2Seg(p: vec2f, a: vec2f, b: vec2f, ra: f32, rb: f32) -> f32 {
  let pa = p - a; let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}
fn handPrint(p: vec2f) -> f32 {
  var d = sd2Box(p, vec2f(0.0, 0.0), vec2f(0.036, 0.032), 0.012);
  d = min(d, sd2Box(p, vec2f(-0.087, 0.0), vec2f(0.04, 0.034), 0.007));
  d = min(d, sd2Seg(p, vec2f(0.014, -0.038), vec2f(-0.042, -0.078), 0.009, 0.007));
  d = min(d, sd2Seg(p, vec2f(0.05, 0.004), vec2f(0.34, 0.075), 0.018, 0.03));
  return d;
}

// ---------------------------------------------------------------- grass
const GH = 0.11;
// a blade near (x, z) at height y: distance to it, and its tint
fn blade(p: vec3f) -> vec2f {
  let cs = 0.011;
  let c = floor(p.xz / cs);
  var best = 1.0; var tint = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let g = c + vec2f(f32(i), f32(j));
      let h = hash3i(vec3i(i32(g.x), i32(g.y), 31));
      // (flattened under the hand and round its edge)
      let bp = vec3f((g.x + 0.5) * cs, 0.0, (g.y + 0.5) * cs);
      var press = 1.0;
      if (abs(bp.x - 0.1) < 0.3 && abs(bp.z) < 0.15) { press = ss(0.0, 0.03, handPrint(bp.xz)); }
      let hgt = GH * (0.45 + 0.55 * h.z) * mix(0.15, 1.0, press);
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

struct Hit { t: f32, kind: i32, tint: f32 }

@fragment fn fs(in: FullscreenOut) -> @location(0) vec4f {
  let rd = rayDir(in.uv);
  let ro = L.eye + L.origin;      // (ground coordinates: small, the origin is a few cm above the Boulder point)
  let sun = L.sun;
  let sunI = L.a.y;
  let center = vec3f(0.0, -RP, 0.0) - ro * 0.001;   // km, relative to the eye
  let eyeKm = vec3f(0.0);
  var hit: Hit; hit.t = -1.0; hit.kind = 0;
  let tMax = 400000.0;
  // the hand (and its bounds), close in
  let hb = sphereHit(ro, rd, vec3f(0.1, 0.03, 0.0), 0.3);
  var tHand = 1e9;
  if (hb.y > 0.0) {
    var t = max(hb.x, 0.0);
    for (var i = 0; i < 64; i++) {
      let d = hand(ro + rd * t);
      if (d < max(0.00004, t * 0.0004)) { tHand = t; break; }
      t += d;
      if (t > hb.y) { break; }
    }
  }
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
  let tNear = min(tHand, tGrass);
  if (rd.y < 0.35 || ro.y > 3000.0) {
    var t = 0.0;
    let tTop = select(1e9, (4500.0 - ro.y) / rd.y, rd.y < 0.0 && ro.y > 4500.0);
    if (tTop < 1e9) { t = tTop; }
    for (var i = 0; i < 160; i++) {
      let p = ro + rd * t;
      let lod = log2(max(t, 1.0) / 400.0);
      let h = terrain(p.x, p.z, lod);
      let dy = p.y - h;
      if (dy < max(0.002, t * 0.0008)) { tLand = t; break; }
      t += max(dy * 0.5, 0.01 + t * 0.006);
      // (no further than the hand or a blade already found)
      if (t > tMax || t > tNear || (rd.y > 0.0 && p.y > 5000.0)) { break; }
    }
  }
  var col = vec3f(0.0);
  var alpha = 1.0;
  let tSurf = min(tHand, min(tGrass, tLand));
  let sunCol = sunlightAt(vec3f(0.0, RP + max(ro.y, 0.0) * 0.001 + 0.05, 0.0), vec3f(0.0), sun) * sunI;
  let ambient = vec3f(0.35, 0.45, 0.6) * 0.12 * sunI * max(sun.y + 0.15, 0.02);
  if (tSurf < 1e8) {
    let p = ro + rd * tSurf;
    var n: vec3f; var alb: vec3f; var sss = 0.0;
    if (tSurf == tHand) {
      n = handNormal(p);
      // skin: warm, with the knuckles' creases and a little mottle
      alb = vec3f(0.62, 0.41, 0.32) * (0.92 + 0.12 * fbm(p * 300.0, 3));
      sss = 1.0;
    } else if (tSurf == tGrass) {
      let u = clamp(p.y / GH, 0.0, 1.0);
      n = normalize(vec3f(-rd.x, 0.6, -rd.z));
      alb = grassColor(gTint, u) * (0.8 + 0.5 * meadow(p, tSurf).g * 3.0);
      sss = 0.6;
    } else {
      let lod = log2(max(tSurf, 1.0) / 400.0);
      n = terrainNormal(p.x, p.z, max(0.05, tSurf * 0.002), lod);
      alb = landColor(p, n, tSurf, tSurf * L.pxAngle);
      // near: soil and old stems under the blades
      alb = mix(alb, vec3f(0.06, 0.05, 0.03), L.a.w * ss(3.0, 0.5, tSurf) * 0.6);
    }
    let lam = dot(n, sun);
    var diff = max(lam, 0.0);
    // the hand's shadow on the grass
    if (tSurf != tHand) {
      var t = 0.002; var sh = 1.0;
      let hs = sphereHit(p, sun, vec3f(0.1, 0.03, 0.0), 0.3);
      if (hs.y > 0.0) {
        t = max(hs.x, 0.002);
        for (var i = 0; i < 20; i++) {
          let d = hand(p + sun * t);
          sh = min(sh, 12.0 * d / t);
          t += max(d, 0.003);
          if (sh < 0.01 || t > hs.y) { break; }
        }
      }
      diff *= clamp(sh, 0.0, 1.0);
    }
    let wrap = max((lam + 0.5) / 1.5, 0.0) * sss * vec3f(1.0, 0.45, 0.3) * 0.5;
    // occlusion: the ground under and round the hand, the hand's creases
    var ao = 1.0;
    if (abs(p.x - 0.1) < 0.4 && abs(p.z) < 0.25) {
      if (tSurf == tHand) { ao = clamp(0.4 + hand(p + n * 0.006) / 0.006 * 0.6, 0.3, 1.0); }
      else { ao = mix(0.35, 1.0, ss(0.0, 0.035, hand(p))); }
    }
    col = alb * (sunCol * (diff + wrap) + ambient) * ao;
    if (tSurf == tHand) {
      let h = normalize(sun - rd);
      col += sunCol * pow(max(dot(n, h), 0.0), 40.0) * 0.06 * diff;
    }
    // the haze between (none to speak of within a couple of hundred metres)
    if (tSurf > 150.0) {
      let a = air(eyeKm, rd, tSurf * 0.001, center, sun, sunI, 6);
      col = overLand(col, a);
    }
  } else {
    // (the sky only where it's seen)
    let sky = air(eyeKm, rd, 1e9, center, sun, sunI, 10);
    col = sky.light;
    // the Sun's disc
    let mu = dot(rd, sun);
    col += sunCol * ss(0.99996, 0.999985, mu) * 30.0;
    // (by night the sky is clear glass: the stars behind show through)
    alpha = clamp(dot(sky.light, vec3f(0.3, 0.5, 0.2)) * 4.0, 0.0, 1.0);
  }
  return vec4f(col * L.a.x * L.weight, alpha * L.weight);
}
