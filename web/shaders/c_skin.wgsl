// The back of the hand, close (millimetres; y out of the skin): the diamond net of creases at two sizes, sweat pores,
// a few fine hairs leaning out of their follicles, and — at a tenth of a millimetre — the flattened dead cells of the
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

// hairs: from follicles on a 2.4 mm lattice, leaning out at ~25°
fn hairs(ro: vec3f, rd: vec3f) -> vec2f {
  var best = 1e9; var shade = 0.0;
  let cs = 2.4;
  let c0 = floor((ro.xz + rd.xz * max(-ro.y / min(rd.y, -1e-3), 0.0)) / cs);
  for (var j = -2; j <= 2; j++) {
    for (var i = -2; i <= 2; i++) {
      let g = c0 + vec2f(f32(i), f32(j));
      let h = hash3i(vec3i(i32(g.x), i32(g.y), 41));
      if (h.z > 0.55) { continue; }
      let base = vec3f((g.x + h.x) * cs, -0.02, (g.y + h.y) * cs);
      let dir = normalize(vec3f(-0.9 + h.y * 0.3, 0.45, 0.25 - h.x * 0.5));
      let tip = base + dir * (2.5 + h.z * 4.0);
      // ray–capsule, approximately: the closest approach of the ray to the segment
      let r = 0.022 * (1.0 + 0.0);
      let ba = tip - base; let oa = ro - base;
      let baba = dot(ba, ba); let bard = dot(ba, rd); let baoa = dot(ba, oa); let rdoa = dot(rd, oa); let oaoa = dot(oa, oa);
      let a = baba - bard * bard;
      let b = baba * rdoa - baoa * bard;
      let c = baba * oaoa - baoa * baoa - r * r * baba;
      let hh = b * b - a * c;
      if (hh >= 0.0) {
        let t = (-b - sqrt(hh)) / a;
        let y = baoa + t * bard;
        if (y > 0.0 && y < baba && t > 0.0 && t < best) { best = t; shade = y / baba; }
      }
    }
  }
  return vec2f(best, shade);
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
  if (ro.y > 0.05) {
    if (rd.y >= 0.0) { return vec4f(0.0); }
    t = (0.05 - ro.y) / rd.y;
  }
  var hitT = -1.0;
  var sh: SkinH;
  let px = L.pxAngle;
  for (var i = 0; i < 90; i++) {
    let p = ro + rd * t;
    sh = skinH(p.xz, fine);
    let dy = p.y - sh.h;
    if (dy < max(0.00003, t * px * 0.5)) { hitT = t; break; }
    t += max(dy * 0.6, t * px);
    if (p.y < -0.2) { hitT = t; break; }
  }
  let hr = hairs(ro, rd);
  if (hr.x < 1e8 && (hitT < 0.0 || hr.x < hitT)) {
    // a hair: dark, glossy along its length
    let c = vec3f(0.11, 0.07, 0.045) * (0.4 + 0.6 * hr.y);
    col = c * sunI * 0.35 + vec3f(1.0, 0.95, 0.9) * sunI * 0.08 * pow(1.0 - abs(dot(rd, sun)), 8.0);
    return vec4f(col * L.a.x * L.weight, L.weight);
  }
  if (hitT < 0.0) { return vec4f(0.0); }
  let p = ro + rd * hitT;
  let e = max(0.0008, hitT * px * 1.5);
  let h0 = skinH(p.xz, fine).h;
  let n = normalize(vec3f(h0 - skinH(p.xz + vec2f(e, 0.0), fine).h, e, h0 - skinH(p.xz + vec2f(0.0, e), fine).h));
  // skin: warm, translucent; the creases deeper and redder, the plates' edges whiter
  var alb = vec3f(0.64, 0.43, 0.34);
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
  return vec4f(col * L.a.x * L.weight, L.weight);
}
