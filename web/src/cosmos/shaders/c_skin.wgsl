// The back of the hand, close (millimetres; y out of the skin): the diamond net of creases at two sizes, sweat pores,
// a few fine hairs curving out of their follicles' pits, and — at a tenth of a millimetre — the flattened dead cells of the
// stratum corneum, plates 30 µm across with lifting edges, where the cell takes over. Marched as a height field.
// L.a: exposure, sun intensity, detail.
#include "cosmos.wgsl"
#include "weft/fullscreen"

fn cell2(p: vec2f, s: f32, seed: f32) -> vec3f {
  // 2D cellular: (edge distance F2 − F1, F1, the cell's hash)
  let q = p / s;
  let i = floor(q);
  var d1 = 9.0; var d2 = 9.0; var id = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let g = i + vec2f(f32(x), f32(y));
      let h = hash3i(vec3i(i32(g.x), i32(g.y), i32(seed)));
      let c = g + 0.5 + (h.xy - 0.5) * 0.85;
      let d = length(q - c);
      if (d < d1) { d2 = d1; d1 = d; id = h.z; } else if (d < d2) { d2 = d; }
    }
  }
  return vec3f((d2 - d1) * s, d1 * s, id);
}

struct SkinH { h: f32, plate: f32, pore: f32 }
// the surface's height (mm) at (x, z); `fine`: how much of the cell-scale detail to include
fn skinH(p: vec2f, fine: f32) -> SkinH {
  var o: SkinH;
  // primary creases (a lozenge net ~1.5 mm) and secondary (~0.4 mm)
  let a = cell2(p * vec2f(1.0, 1.6), 1.5, 3.0);
  let b = cell2(p * vec2f(1.3, 1.0) + 7.0, 0.42, 5.0);
  var h = -0.07 * exp(-a.x * a.x / 0.0016) - 0.025 * exp(-b.x * b.x / 0.0004);
  // each plateau between creases slightly domed
  h += 0.02 * (1.0 - a.y / 1.2) + 0.006 * (1.0 - b.y / 0.4);
  // pores
  let pc = cell2(p + 13.0, 0.9, 11.0);
  let pore = exp(-pc.y * pc.y / 0.0009) * step(0.6, pc.z);
  h -= 0.03 * pore;
  o.pore = pore;
  // the hairs' follicles: a small pit round each
  let fb = follicle(floor(p / HAIR_CELL));
  if (fb.w > 0.0) {
    let fd = length(p - fb.xz);
    h -= 0.035 * exp(-fd * fd / 0.0016);
    o.pore = max(o.pore, exp(-fd * fd / 0.0025) * 0.8);
  }
  // the stratum corneum: overlapping plates ~30 µm, edges lifted
  if (fine > 0.0) {
    let c = cell2(p + vec2f(fbm(vec3f(p * 12.0, 1.0), 2) * 0.006), 0.032, 17.0);
    let edge = exp(-c.x * c.x / 0.000004);
    let lift = (c.z - 0.5) * 0.004 + (1.0 - c.y / 0.03) * 0.0018;
    h += fine * (lift - edge * 0.0025);
    o.plate = c.z;
  }
  o.h = h;
  return o;
}

// hairs: a few from follicles on a 3 mm lattice, each a fine tapered strand rising out of its pit and curving over to
// lie along the skin, all combed roughly one way (toward the wrist), some dark and some fine and fair
const HAIR_CELL = 3.0;
// the follicle in a lattice cell: (x, -, z, 1) or w 0 for none
fn follicle(g: vec2f) -> vec4f {
  let h = hash3i(vec3i(i32(g.x), i32(g.y), 41));
  if (h.z > 0.2) { return vec4f(0.0); }
  return vec4f((g.x + 0.15 + h.x * 0.7) * HAIR_CELL, 0.0, (g.y + 0.15 + h.y * 0.7) * HAIR_CELL, 1.0);
}
// the ray's nearest approach to a segment a..b: (t along the ray, s along the segment, distance)
fn rayToSeg(ro: vec3f, rd: vec3f, a: vec3f, b: vec3f) -> vec3f {
  let ba = b - a; let oa = ro - a;
  let bb = dot(ba, ba); let br = dot(ba, rd); let bo = dot(ba, oa); let ro_ = dot(rd, oa);
  let den = max(bb - br * br, 1e-9);
  let s = clamp((bo - br * ro_) / den, 0.0, 1.0);
  let q = a + ba * s;
  let t = dot(q - ro, rd);
  return vec3f(t, s, length(ro + rd * t - q));
}
struct Hair { t: f32, along: f32, cover: f32, fair: f32 }
fn hairs(ro: vec3f, rd: vec3f, px: f32) -> Hair {
  var o: Hair; o.t = 1e9; o.cover = 0.0;
  let c0 = floor((ro.xz + rd.xz * max(-ro.y / min(rd.y, -1e-3), 0.0)) / HAIR_CELL);
  for (var j = -2; j <= 2; j++) {
    for (var i = -2; i <= 2; i++) {
      let g = c0 + vec2f(f32(i), f32(j));
      let f = follicle(g);
      if (f.w == 0.0) { continue; }
      let h = hash3i(vec3i(i32(g.x), i32(g.y), 43));
      let len = 2.2 + h.x * 3.8;
      let fair = step(0.55, h.y);
      // combed toward -x, give or take 30°, rising steeply from the pit then lying over
      let az = -1.9 + (h.z - 0.5) * 1.0;
      let curl = (h.y - 0.5) * 0.5;
      var a = vec3f(f.x, -0.03, f.z);
      for (var k = 0; k < 3; k++) {
        let fk = f32(k);
        let el = mix(0.75, 0.0, fk / 2.0) - h.x * 0.15;
        let azk = az + curl * fk;
        let b = a + vec3f(cos(azk) * cos(el), sin(el), sin(azk) * cos(el)) * (len / 3.0);
        let r = rayToSeg(ro, rd, a, b);
        // tapering from the follicle to a fine point
        let u = (fk + r.y) / 3.0;
        let rad = mix(select(0.042, 0.026, fair > 0.5), 0.006, u * u);
        // (no thinner than most of a pixel, fainter instead, so a far hair stays a line and doesn't break up)
        let w = max(r.x * px, 1e-5);
        let re = max(rad, w * 0.7);
        let cov = ss(re + w * 0.5, max(re - w * 0.5, 0.0), r.z) * sqrt(rad / re);
        if (cov > 0.01 && r.x > 0.0 && r.x < o.t) { o.t = r.x; o.along = u; o.cover = cov; o.fair = fair; }
        a = b;
      }
    }
  }
  return o;
}

// beneath the dead plates, the living epidermis: rounded cells ~25 µm, packed, each with its purple nucleus — the
// tissue the cell's world opens on. Marched a little way down from the surface.
fn epidermis(p0: vec3f, rd: vec3f, jit: f32) -> vec4f {
  var col = vec3f(0.0);
  var T = 1.0;
  let n = 34;
  let dt = 0.06 / f32(n);
  for (var i = 0; i < n; i++) {
    let q = p0 + rd * ((f32(i) + jit) * dt);
    let c = cellular(q / 0.014 + vec3f(3.1, 0.0, 1.7), 0.8);
    // membranes between the cells, the cytoplasm clear and pale, the nucleus dense and purple
    let wall = exp(-(c.d2 - c.d1) * (c.d2 - c.d1) / 0.006);
    let nuc = 1.0 - ss(0.17, 0.24, c.d1 * (0.9 + 0.25 * c.id.x));
    let sCyt = 22.0; let sWall = 220.0 * wall; let sNuc = 700.0 * nuc;
    let sig = sCyt + sWall + sNuc;
    let deep = exp(-f32(i) * dt * 14.0);
    let cc = (vec3f(0.62, 0.32, 0.3) * sCyt + vec3f(1.25, 0.95, 0.88) * sWall + vec3f(0.26, 0.1, 0.45) * sNuc) / sig * (0.4 + 0.6 * deep);
    let a = 1.0 - exp(-sig * dt);
    col += T * a * cc;
    T *= 1.0 - a;
    if (T < 0.02) { break; }
  }
  return vec4f(col, 1.0 - T);
}

// a hair over what's behind it, by how much of the pixel it covers: dark brown or fair, glossy along its length
fn hairOver(c: vec3f, hr: Hair, behind: f32, rd: vec3f, sun: vec3f, sunI: f32) -> vec3f {
  if (hr.cover <= 0.0 || hr.t > behind) { return c; }
  // (into the haze with the skin behind them)
  let fog = 1.0 - exp(-max(hr.t - L.scale, 0.0) / (L.scale * 2.5));
  let base = mix(vec3f(0.07, 0.045, 0.03), vec3f(0.36, 0.25, 0.16), hr.fair) * (0.5 + 0.5 * hr.along);
  let hc = base * sunI * 0.45 + vec3f(1.0, 0.95, 0.9) * sunI * 0.08 * pow(1.0 - abs(dot(rd, sun)), 8.0);
  return mix(c, hc, hr.cover * (1.0 - fog));
}

@fragment fn fs(in: FullscreenOut) -> @location(0) vec4f {
  let rd = rayDir(in.uv);
  let ro = L.eye + L.origin;
  let sun = L.sun;
  let sunI = L.a.y;
  let fine = L.a.z;
  var col = vec3f(0.0);
  // march the height field (it lies within −0.12..0.03 mm of the plane)
  var t = 0.0;
  // (looking up from the skin, at a dome's zenith: the warm haze, as far off)
  let haze = vec3f(0.42, 0.25, 0.21) * sunI * 0.45;
  if (ro.y > 0.05) {
    if (rd.y >= 0.0) { return vec4f(haze * L.a.x * L.weight, L.weight); }
    t = (0.05 - ro.y) / rd.y;
  }
  var hitT = -1.0;
  var sh: SkinH;
  let px = L.pxAngle;
  for (var i = 0; i < 60; i++) {
    let p = ro + rd * t;
    sh = skinH(p.xz, fine);
    let dy = p.y - sh.h;
    if (dy < max(0.00003, t * px * 0.5)) { hitT = t; break; }
    t += max(dy * 0.75, t * px * 1.5);
    if (p.y < -0.2) { hitT = t; break; }
  }
  let hr = hairs(ro, rd, px);
  // the far skin fades into a warm haze (no edge of the world below a millimetre)
  let fogC = vec3f(0.42, 0.25, 0.21) * sunI * 0.45;
  if (hitT < 0.0) { return vec4f(hairOver(fogC, hr, 1e9, rd, sun, sunI) * L.a.x * L.weight, L.weight); }
  let p = ro + rd * hitT;
  let fog = 1.0 - exp(-max(hitT - L.scale, 0.0) / (L.scale * 5.0));
  let e = max(0.0008, hitT * px * 1.5);
  let h0 = skinH(p.xz, fine).h;
  let n = normalize(vec3f(h0 - skinH(p.xz + vec2f(e, 0.0), fine).h, e, h0 - skinH(p.xz + vec2f(0.0, e), fine).h));
  // skin: warm, translucent; the creases deeper and redder, the plates' edges whiter
  var alb = vec3f(0.56, 0.35, 0.27);
  alb = mix(alb, vec3f(0.5, 0.27, 0.22), ss(-0.02, -0.07, sh.h));
  alb *= 1.0 - sh.pore * 0.35;
  alb = mix(alb, alb * (0.9 + 0.25 * sh.plate), fine);
  let lam = dot(n, sun);
  let wrap = max((lam + 0.6) / 1.6, 0.0);
  let sss = vec3f(1.0, 0.42, 0.3) * wrap * 0.45;
  let diff = max(lam, 0.0);
  let h = normalize(sun - rd);
  let spec = pow(max(dot(n, h), 0.0), 60.0) * 0.12 + pow(max(dot(n, h), 0.0), 8.0) * 0.03;
  col = alb * sunI * (diff * 0.8 + sss) + vec3f(spec) * sunI + alb * vec3f(0.35, 0.45, 0.6) * sunI * 0.12;
  // diving in: the plates turn to glass over the living cells below
  let reveal = L.a.w;
  if (reveal > 0.0) {
    let jit = hash3u(vec3u(vec2u(in.pos.xy), frame.frame % 16u)).x;
    let e = epidermis(p + rd * 0.004, rd, jit);
    let lit = sunI * (0.55 + 0.45 * max(-rd.y, 0.0));
    col = mix(col, e.rgb * lit * 0.2 + col * 0.06 * (1.0 - e.a), reveal);
  }
  col = mix(col, fogC, fog);
  col = hairOver(col, hr, hitT, rd, sun, sunI);
  return vec4f(col * L.a.x * L.weight, L.weight);
}
