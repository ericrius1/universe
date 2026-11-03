// The land's height on the GPU: canyon.ts (and noise.ts, strata.ts, layout.ts's sdStar) line for line, with the same
// integer hashes, gradient noise, strata, star and designed places, so a level filled here agrees with the CPU's
// canyonHeight within millimetres (tools/land-parity.ts checks). Binding-free: include it anywhere; tables.wgsl (generated from
// canyon.ts by tools/land-tables.ts) holds the numbers, fill.wgsl runs it over a level. Its names start with cn (the
// entry points canyonHeight and canyonSample excepted), so it sits beside world.wgsl's own hashes and noise.
#include "./tables.wgsl"

// ------------------------------------------------------------------ noise (noise.ts)
fn cnHashU(ix: i32, iz: i32, s: u32) -> u32 {
  var h = (u32(ix) * 0x27d4eb2fu) ^ (u32(iz) * 0x165667b1u) ^ (s * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  return h ^ (h >> 16u);
}
fn cnHashF(ix: i32, iz: i32, s: u32) -> f32 { return f32(cnHashU(ix, iz, s) >> 8u) / 16777216.0; }
fn cnGrad(h: u32, dx: f32, dz: f32) -> f32 {
  return (f32(h & 0xffffu) / 32768.0 - 1.0) * dx + (f32(h >> 16u) / 32768.0 - 1.0) * dz;
}
/** gradient noise at (x, z) metres with wavelength `wave` (its lattice cell and the fraction across it found from the
 *  metres themselves, as noise.ts does: precise at 60 km) */
fn cnNoise(x: f32, z: f32, wave: f32, s: u32) -> f32 {
  let x0 = floor(x / wave);
  let z0 = floor(z / wave);
  let ix = i32(x0);
  let iz = i32(z0);
  let fx = (x - x0 * wave) / wave;
  let fz = (z - z0 * wave) / wave;
  let u = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0);
  let v = fz * fz * fz * (fz * (fz * 6.0 - 15.0) + 10.0);
  let n00 = cnGrad(cnHashU(ix, iz, s), fx, fz);
  let n10 = cnGrad(cnHashU(ix + 1, iz, s), fx - 1.0, fz);
  let n01 = cnGrad(cnHashU(ix, iz + 1, s), fx, fz - 1.0);
  let n11 = cnGrad(cnHashU(ix + 1, iz + 1, s), fx - 1.0, fz - 1.0);
  return n00 + u * (n10 - n00) + v * (n01 - n00) + u * v * (n00 - n10 - n01 + n11);
}
/** the derivative of the last cnNoise1, per wavelength */
var<private> cnNoise1D: f32;
fn cnNoise1(t: f32, wave: f32, s: u32) -> f32 {
  let i0 = floor(t / wave);
  let i = i32(i0);
  let f = (t - i0 * wave) / wave;
  let g0 = f32(cnHashU(i, 0, s) >> 8u) / 8388608.0 - 1.0;
  let g1 = f32(cnHashU(i + 1, 0, s) >> 8u) / 8388608.0 - 1.0;
  let n0 = g0 * f;
  let n1 = g1 * (f - 1.0);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f - 1.0) * (f - 1.0);
  cnNoise1D = g0 + du * (n1 - n0) + u * (g1 - g0);
  return n0 + u * (n1 - n0);
}
/** smoothstep that also runs backwards (a > b), as noise.ts's does */
fn cnSmooth(a: f32, b: f32, x: f32) -> f32 {
  let t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
fn cnFbm(x: f32, z: f32, wave: f32, oct: i32, s: u32, minWave: f32) -> f32 {
  var a = 0.5;
  var sum = 0.0;
  var w = wave;
  for (var i = 0; i < oct; i++) {
    let o = f32(i);
    sum += a * cnNoise(x + o * 0.37 * w, z - o * 0.61 * w, w, s + u32(i)) * cnSmooth(minWave, 2.0 * minWave, w);
    a *= 0.5;
    w *= 0.5;
  }
  return sum;
}
fn cnSmin(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
fn cnSmax(a: f32, b: f32, k: f32) -> f32 { return -cnSmin(-a, -b, k); }

// ------------------------------------------------------------------ the strata (strata.ts)
var<private> cnTerraceKind: i32;
var<private> cnTerraceAlong: f32;
fn cnTerrace(H: f32) -> f32 {
  if (H <= 0.0) { cnTerraceKind = -1; return H; }
  let top = cnStrataF(u32(CN_STRATA_N - 1));
  if (H >= top) { cnTerraceKind = -1; return cnStrataY(u32(CN_STRATA_N - 1)) + (H - top); }
  var lo = 0;
  var hi = CN_STRATA_N - 2;
  loop {
    if (lo >= hi) { break; }
    let m = (lo + hi + 1) / 2;
    if (cnStrataF(u32(m)) <= H) { lo = m; } else { hi = m - 1; }
  }
  let t = (H - cnStrataF(u32(lo))) / (cnStrataF(u32(lo + 1)) - cnStrataF(u32(lo)));
  cnTerraceKind = i32(cnStrataK(u32(lo)));
  cnTerraceAlong = t;
  return cnStrataY(u32(lo)) + (cnStrataY(u32(lo + 1)) - cnStrataY(u32(lo))) * t;
}
fn cnUnterrace(Y: f32) -> f32 {
  if (Y <= 0.0) { return Y; }
  let top = cnStrataY(u32(CN_STRATA_N - 1));
  if (Y >= top) { return cnStrataF(u32(CN_STRATA_N - 1)) + (Y - top); }
  var lo = 0;
  var hi = CN_STRATA_N - 2;
  loop {
    if (lo >= hi) { break; }
    let m = (lo + hi + 1) / 2;
    if (cnStrataY(u32(m)) <= Y) { lo = m; } else { hi = m - 1; }
  }
  let t = (Y - cnStrataY(u32(lo))) / (cnStrataY(u32(lo + 1)) - cnStrataY(u32(lo)));
  return cnStrataF(u32(lo)) + (cnStrataF(u32(lo + 1)) - cnStrataF(u32(lo))) * t;
}

// ------------------------------------------------------------------ the star (layout.ts sdStar)
/** the signed distance (m) from the star's edge (negative inside), folded by reflections into the half point between
 *  a tip and a notch — |x|, |z|, the 45° mirror, the notch's line — never by atan2; its tip rounded by a smooth max
 *  with the edge's mirror across the tip's axis, its notch by a smooth min with the next point's edge */
fn cnSdStar(x: f32, z: f32) -> f32 {
  var px = x - CN_STAR_C.x;
  var pz = z - CN_STAR_C.y;
  let rx = CN_STAR_ROT.x * px - CN_STAR_ROT.y * pz;
  pz = CN_STAR_ROT.y * px + CN_STAR_ROT.x * pz;
  px = abs(rx);
  pz = abs(pz);
  if (pz > px) {
    let t = px;
    px = pz;
    pz = t;
  }
  let d = -px * CN_STAR_M.y + pz * CN_STAR_M.x;
  if (d > 0.0) {
    px += 2.0 * d * CN_STAR_M.y;
    pz -= 2.0 * d * CN_STAR_M.x;
  }
  let dA = (px - CN_STAR_TIP) * CN_STAR_EA.x + pz * CN_STAR_EA.y;
  let dB = (px - CN_STAR_TIP) * CN_STAR_EA.x - pz * CN_STAR_EA.y;
  let dC = (px - CN_STAR_N.x) * CN_STAR_EC.x + (pz - CN_STAR_N.y) * CN_STAR_EC.y;
  return cnSmin(cnSmax(dA, dB, CN_STAR_TIPR), dC, CN_STAR_NOTCHR);
}

// ------------------------------------------------------------------ small shapes
fn cnEllipse(px: f32, pz: f32, rx: f32, rz: f32) -> f32 {
  let ax = px / rx;
  let az = pz / rz;
  let bx = px / (rx * rx);
  let bz = pz / (rz * rz);
  let k0 = sqrt(ax * ax + az * az);
  let k1 = sqrt(bx * bx + bz * bz);
  if (k1 < 1e-9) { return -min(rx, rz); }
  return (k0 * (k0 - 1.0)) / k1;
}

/** the slope of the last cnChannelZ */
var<private> cnCurveD: f32;
/** the plain's channel's line: z at x (cubic Hermite through its knots, flat past its ends) */
fn cnChannelZ(x: f32) -> f32 {
  let last = CN_CHAN_N - 1;
  if (x <= cnChanT(u32(0))) {
    cnCurveD = 0.0;
    return cnChanV(u32(0));
  }
  if (x >= cnChanT(u32(last))) {
    cnCurveD = 0.0;
    return cnChanV(u32(last));
  }
  var i = 0;
  loop {
    if (i >= last - 1 || x < cnChanT(u32(i + 1))) { break; }
    i++;
  }
  let h = cnChanT(u32(i + 1)) - cnChanT(u32(i));
  let s = (x - cnChanT(u32(i))) / h;
  let s2 = s * s;
  let s3 = s2 * s;
  let v0 = cnChanV(u32(i));
  let v1 = cnChanV(u32(i + 1));
  let m0 = cnChanM(u32(i));
  let m1 = cnChanM(u32(i + 1));
  cnCurveD = ((6.0 * s2 - 6.0 * s) * (v0 - v1)) / h + (3.0 * s2 - 4.0 * s + 1.0) * m0 + (3.0 * s2 - 2.0 * s) * m1;
  return (2.0 * s3 - 3.0 * s2 + 1.0) * v0 + (s3 - 2.0 * s2 + s) * h * m0 + (-2.0 * s3 + 3.0 * s2) * v1 + (s3 - s2) * h * m1;
}

// ------------------------------------------------------------------ the star's points (a table per point)
fn cnSectorOf(x: f32, z: f32) -> u32 {
  let dx = x - CN_STAR_C.x;
  let dz = z - CN_STAR_C.y;
  var k = 0u;
  var best = -1e30;
  for (var i = 0u; i < 8u; i++) {
    let d = cnTip(u32(i)).x * dx + cnTip(u32(i)).y * dz;
    if (d > best) {
      best = d;
      k = i;
    }
  }
  let r2 = dx * dx + dz * dz;
  return k * 3u + select(select(2u, 1u, r2 < CN_BANDS.y * CN_BANDS.y), 0u, r2 < CN_BANDS.x * CN_BANDS.x);
}

// ------------------------------------------------------------------ the ridges
fn cnRidgeReach(hw: f32, wander: f32) -> f32 { return min(1.15 * hw * (1.0 + wander), CN_KEEP_A + CN_KEEP_B * hw - 0.5); }
fn cnRidgesAt(x: f32, z: f32, minWave: f32) -> f32 {
  let k = cnSectorOf(x, z);
  var nw = 0.0;
  var nc = 0.0;
  var rough = 0.0;
  var noised = false;
  var H = 0.0;
  for (var j = cnRidgeOff(u32(k)); j < cnRidgeOff(u32(k + 1u)); j++) {
    let g = cnRidge(u32(cnRidgeIdx(u32(j))));
    let ex = g.a.z - g.a.x;
    let ez = g.a.w - g.a.y;
    let u = clamp(((x - g.a.x) * ex + (z - g.a.y) * ez) / (g.b.x * g.b.x), 0.0, 1.0);
    let qx = g.a.x + ex * u - x;
    let qz = g.a.y + ez * u - z;
    let d = sqrt(qx * qx + qz * qz);
    if (d >= cnRidgeReach(max(g.c.x, g.c.y), 0.25)) { continue; }
    if (!noised) {
      noised = true;
      let kr = cnSmooth(minWave, 2.0 * minWave, 30.0);
      nw = 0.17 * clamp(cnNoise(x, z, 90.0, CN_S_RIDGE) / 0.45, -1.0, 1.0) + 0.08 * kr * clamp(cnNoise(x, z, 30.0, CN_S_RIDGE + 3u) / 0.45, -1.0, 1.0);
      nc = 0.17 * clamp(cnNoise(x, z, 60.0, CN_S_RIDGE + 1u) / 0.45, -1.0, 1.0) + 0.08 * kr * clamp(cnNoise(x, z, 24.0, CN_S_RIDGE + 4u) / 0.45, -1.0, 1.0);
      rough = cnFbm(x, z, 26.0, 2, CN_S_RIDGE + 2u, minWave);
    }
    let s = g.b.y + u * g.b.x;
    let t = s / g.b.z;
    let reach = cnRidgeReach(g.c.x + (g.c.y - g.c.x) * t, nw);
    if (d >= reach) { continue; }
    let xr = d / reach;
    let skirt = cnSmooth(1.0, 0.62, xr);
    let spine = cnSmooth(0.0, 1.0, clamp(1.0 - xr / 0.56, 0.0, 1.0));
    let crest = (g.c.z + (g.c.w - g.c.z) * t) * (1.0 + nc);
    let B = cnUnterrace(CN_FLOOR_Y - CN_PLAIN_Y + crest) - CN_F_FLOOR;
    let Bs = min(B, CN_RIDGE_SKIRT);
    let p = clamp(skirt + 2.0 * rough * skirt * (1.0 - skirt), 0.0, 1.0) * Bs + clamp(spine + 1.5 * rough * spine * (1.0 - spine), 0.0, 1.0) * (B - Bs);
    var cut = 1.0;
    if (g.h > 0.0) { cut = cnSmooth(g.h, g.h + 6.0, abs(s - g.b.w)); }
    H = max(H, p * cut);
  }
  return H;
}

// ------------------------------------------------------------------ the water's beds
fn cnPoolsAt(x: f32, z: f32) -> f32 {
  let k = cnSectorOf(x, z);
  var low = 0.0;
  for (var j = cnPoolOff(u32(k)); j < cnPoolOff(u32(k + 1u)); j++) {
    let q = cnPool(u32(cnPoolIdx(u32(j))));
    let dx = x - q.p.x;
    let dz = z - q.p.y;
    if (abs(dx) > q.q.z || abs(dz) > q.q.z) { continue; }
    let d = cnEllipse(q.q.x * dx + q.q.y * dz, -q.q.y * dx + q.q.x * dz, q.p.z, q.p.w);
    if (d < 0.0) { low = min(low, -CN_POOL_BED * cnSmooth(0.0, CN_BANK, -d)); }
  }
  return low;
}
fn cnCanalAt(x: f32, z: f32) -> f32 {
  let u = x - CN_CHUTE_X;
  let v = abs(z - CN_CANAL_Z);
  if (u < CN_CANAL_X0 - 1.0 || u > CN_CHUTE_ENDS.x || v > CN_CANAL_HALF) { return 0.0; }
  return CN_CANAL_BED * cnSmooth(0.0, CN_BANK, min(CN_CANAL_HALF - v, u - CN_CANAL_X0));
}
fn cnChuteBed(u: f32) -> f32 {
  let e = CN_CHUTE_ENDS;
  let L = CN_CHUTE_LEVELS;
  let b = CN_CHUTE_BASIN;
  let sl = CN_CHUTE_SILL;
  var y = CN_CANAL_BED;
  y = mix(y, L.y - b, cnSmooth(e.x, e.x + 0.5, u));
  y = mix(y, L.z - b, cnSmooth(e.y, e.y + 0.5, u));
  y = mix(y, CN_CHUTE_POOL, cnSmooth(e.z, e.z + 0.5, u));
  y += b * (cnSmooth(e.y - sl, e.y, u) * (1.0 - cnSmooth(e.y, e.y + 0.5, u)) + cnSmooth(e.z - sl, e.z, u) * (1.0 - cnSmooth(e.z, e.z + 0.5, u)));
  return mix(y, CN_CHANNEL_BED, cnSmooth(e.w - 4.0, e.w, u));
}
fn cnButtress(x: f32, z: f32) -> f32 {
  let u = x - CN_CHUTE_X;
  let v = abs(z - CN_CHUTE_Z);
  let e = CN_CHUTE_ENDS;
  let L = CN_CHUTE_LEVELS;
  if (u < e.x - 10.0 || u > e.z + CN_WALL_OUT + 10.0 || v > CN_CHUTE_HALF + CN_WALL_W + 45.0) { return -1e9; }
  var y = CN_FLOOR_Y;
  y = mix(y, L.y + CN_WALL_OVER, cnSmooth(e.x + CN_WALL_OUT, e.x + CN_WALL_OUT + 0.5, u));
  y = mix(y, L.z + CN_WALL_OVER, cnSmooth(e.y + CN_WALL_OUT, e.y + CN_WALL_OUT + 0.5, u));
  y = mix(y, CN_PLAIN_Y, cnSmooth(e.z + CN_WALL_OUT, e.z + CN_WALL_OUT + 0.5, u));
  return cnUnterrace(y - CN_PLAIN_Y) - CN_MESA_G * max(v - CN_CHUTE_HALF - CN_WALL_W, 0.0);
}
fn cnChannelDistance(x: f32, z: f32) -> f32 {
  let zc = cnChannelZ(x);
  let sl = cnCurveD;
  return abs(z - zc) / sqrt(1.0 + sl * sl) + max(max(cnChanT(u32(0)) - x, x - cnChanT(u32(CN_CHAN_N - 1))), 0.0);
}
fn cnChannelBed(dc: f32) -> f32 {
  return CN_CHANNEL_BED + (CN_PLAIN_Y - CN_CHANNEL_BED) * cnSmooth(CN_CHANNEL_HW - 3.0, CN_CHANNEL_HW + 6.0, dc) + max(dc - CN_CHANNEL_HW - 6.0, 0.0) * 3.0;
}

// ------------------------------------------------------------------ the plateau and its gardens
var<private> cnGardenZone: i32;
fn cnSteps(t: f32, e: f32) -> f32 {
  let u = t + e / 2.0;
  let k = floor(u);
  return k - 1.0 + min((u - k) / e, 1.0);
}
fn cnGardenFloor(r: f32, w: CnWedge) -> f32 {
  let bw = (w.r1 - w.r0) / w.steps;
  return CN_TOP - w.drop * clamp(cnSteps((r - w.r0) / bw, 0.5 / bw), 0.0, w.steps - 1.0);
}
fn cnGardenSurface(x: f32, z: f32) -> f32 {
  let dx = x - CN_PLAT_C.x;
  let dz = z - CN_PLAT_C.y;
  let r = sqrt(dx * dx + dz * dz);
  let top = CN_TOP;
  var gap = top;
  var inS = top;
  var inW = 0.0;
  for (var i = 0; i < CN_WEDGE_N; i++) {
    let w = cnWedge(u32(i));
    let c0 = w.d0.x * dz - w.d0.y * dx;
    let c1 = dx * w.d1.y - dz * w.d1.x;
    let lat = min(c0, c1);
    let t = (r - w.r0) / w.w;
    let line = top - w.drop * clamp(t, 0.0, w.steps);
    var near = 1.0 - cnSmooth(0.17 * r, 0.22 * r + 0.01, -lat);
    if (w.short > 0.5) { near *= 1.0 - cnSmooth(w.r1, w.r1 + 0.5, r); }
    gap = min(gap, mix(top, line, near));
    var wi = clamp(lat / 0.5 + 0.5, 0.0, 1.0) * clamp((r - w.r0) / 0.5 + 0.5, 0.0, 1.0);
    if (w.short > 0.5) { wi *= clamp((w.r1 - r) / 0.5 + 0.5, 0.0, 1.0); }
    if (wi > 0.0) {
      inW = wi;
      inS = cnGardenFloor(r, w);
    }
  }
  cnGardenZone = select(select(5, 3, gap < top - 0.05), 4, inW > 0.5);
  return max(mix(gap, inS, inW), CN_FLOOR_Y);
}
fn cnSdPlat(x: f32, z: f32) -> f32 {
  let dx = x - CN_PLAT_C.x;
  let dz = z - CN_PLAT_C.y;
  let r = sqrt(dx * dx + dz * dz);
  var slab = 0.0;
  for (var i = 0; i < CN_WEDGE_N; i++) {
    let w = cnWedge(u32(i));
    if (w.short < 0.5) { continue; }
    slab = max(slab, cnSmooth(8.0, 40.0, min(w.d0.x * dz - w.d0.y * dx, dx * w.d1.y - dz * w.d1.x)));
  }
  return r - CN_PLAT_R + CN_PLAT_IN * slab * cnSmooth(-0.4, 0.4, cnNoise(x, z, 120.0, CN_S_PROM));
}
var<private> cnSlabZone: i32;
fn cnSlabs(x: f32, z: f32, S: f32, texel: f32) -> f32 {
  let dx = x - CN_PLAT_C.x;
  let dz = z - CN_PLAT_C.y;
  let r = sqrt(dx * dx + dz * dz);
  var slab = 0.0;
  for (var i = 0; i < CN_WEDGE_N; i++) {
    let w = cnWedge(u32(i));
    if (w.short < 0.5) { continue; }
    let lat = min(w.d0.x * dz - w.d0.y * dx, dx * w.d1.y - dz * w.d1.x);
    slab = max(slab, cnSmooth(20.0, 34.0, lat) * cnSmooth(w.r1 + 4.0, w.r1 + 18.0, r));
  }
  cnSlabZone = 5;
  if (slab <= 0.0) { return S; }
  let C = CN_SLAB_CELL;
  let ix = i32(floor(x / C));
  let iz = i32(floor(z / C));
  var f1 = 1e9;
  var f2 = 1e9;
  var sx = 0.0;
  var sz = 0.0;
  var cx1 = 0;
  var cz1 = 0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let cx = ix + i;
      let cz = iz + j;
      let px = (f32(cx) + 0.15 + 0.7 * cnHashF(cx, cz, CN_S_SLAB)) * C;
      let pz = (f32(cz) + 0.15 + 0.7 * cnHashF(cx, cz, CN_S_SLAB + 1u)) * C;
      let ddx = x - px;
      let ddz = z - pz;
      let d = sqrt(ddx * ddx + ddz * ddz);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        sx = px;
        sz = pz;
        cx1 = cx;
        cz1 = cz;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  let sink = CN_SLAB_STEP * floor(cnHashF(cx1, cz1, CN_S_SLAB + 2u) * 3.0);
  let gx = (cnHashF(cx1, cz1, CN_S_SLAB + 3u) - 0.5) * 0.028;
  let gz = (cnHashF(cx1, cz1, CN_S_SLAB + 4u) - 0.5) * 0.028;
  let top = S - slab * (sink - gx * (x - sx) - gz * (z - sz));
  let w = 3.0 + 3.0 * cnSmooth(-0.4, 0.4, cnNoise(x, z, 90.0, CN_S_FISSURE));
  let e = f2 - f1;
  if (e < 0.8 * w && slab > 0.5) { cnSlabZone = 9; }
  let k = 1.0 - cnSmooth(0.45 * w, w, e);
  return mix(top, CN_TOP - CN_FISSURE_DEEP, k * slab * (1.0 - cnSmooth(1.5, 3.0, texel)));
}
var<private> cnPlatZone: i32;
var<private> cnPlatKind: i32;
var<private> cnPlatIn: bool;
fn cnPlateau(x: f32, z: f32, wn: f32, texel: f32) -> f32 {
  let ox = x - CN_PLAT_C.x;
  let oz = z - CN_PLAT_C.y;
  cnPlatIn = false;
  if (ox * ox + oz * oz > (CN_PLAT_R + 21.0) * (CN_PLAT_R + 21.0)) {
    cnPlatZone = 0;
    return -1e9;
  }
  let d = cnSdPlat(x, z);
  cnPlatIn = d <= 0.0;
  if (d > 20.0) {
    cnPlatZone = 0;
    return -1e9;
  }
  let S = cnSlabs(x, z, cnGardenSurface(x, z), texel);
  if (d <= 0.0) {
    cnPlatZone = select(cnGardenZone, cnSlabZone, cnSlabZone != 5);
    cnPlatKind = -1;
    return S;
  }
  cnPlatZone = 0;
  let out = max(d + wn * cnSmooth(0.5, 8.0, d), 0.75 * d);
  let h = max(cnTerrace(cnUnterrace(S - CN_PLAIN_Y) - CN_PLAT_G * out) + CN_PLAIN_Y, CN_FLOOR_Y);
  cnPlatKind = cnTerraceKind;
  return h;
}

// ------------------------------------------------------------------ the grand stair's corridor
fn cnStairProfile(z: f32) -> f32 {
  if (z <= cnStairZ(u32(0)).x) { return cnStairZ(u32(0)).y; }
  if (z >= cnStairZ(u32(CN_STAIR_N - 1)).x) { return cnStairZ(u32(CN_STAIR_N - 1)).y; }
  var i = 0;
  loop {
    if (i >= CN_STAIR_N - 2 || z < cnStairZ(u32(i + 1)).x) { break; }
    i++;
  }
  let a = cnStairZ(u32(i));
  let b = cnStairZ(u32(i + 1));
  return a.y + ((z - a.x) / (b.x - a.x)) * (b.y - a.y);
}
fn cnCorridorTarget(x: f32, z: f32) -> f32 {
  var y = 1e9;
  for (var i = 0; i < CN_STAIR_N - 1; i++) {
    let a = cnLanding(u32(i));
    let b = cnLanding(u32(i + 1));
    let ex = b.x - a.x;
    let ez = b.y - a.y;
    let len = sqrt(ex * ex + ez * ez);
    let tu = ((x - a.x) * ex + (z - a.y) * ez) / (len * len);
    let t = clamp(tu, 0.0, 1.0);
    let lat = abs((x - a.x) * ez - (z - a.y) * ex) / len;
    let over = max(max(-tu, tu - 1.0), 0.0) * len;
    y = min(y, a.z + (b.z - a.z) * t + (max(lat - (CN_STAIR_W / 2.0 + 2.0), 0.0) + over) * 4.0);
  }
  for (var i = 0; i < CN_STAIR_N; i++) {
    let L = cnLanding(u32(i));
    let dx = x - L.x;
    let dz = z - L.y;
    y = min(y, L.z + max(sqrt(dx * dx + dz * dz) - CN_LANDING_R, 0.0) * 4.0);
  }
  return max(y - CN_STAIR_SINK, CN_FLOOR_Y);
}
var<private> cnCorridorZone: bool;
fn cnCorridor(x: f32, z: f32, h: f32) -> f32 {
  cnCorridorZone = false;
  let dx = x - CN_PLAT_C.x;
  let dz = z - CN_PLAT_C.y;
  let r = sqrt(dx * dx + dz * dz);
  let gap = min(min(CN_GAP_A.x * dz - CN_GAP_A.y * dx, dx * CN_GAP_B.y - dz * CN_GAP_B.x), CN_CLEFT_R - r);
  var zig = 1e9;
  for (var i = 0; i < CN_STAIR_N - 1; i++) {
    let a = cnLanding(u32(i));
    let b = cnLanding(u32(i + 1));
    let ex = b.x - a.x;
    let ez = b.y - a.y;
    let t = clamp(((x - a.x) * ex + (z - a.y) * ez) / (ex * ex + ez * ez), 0.0, 1.0);
    let qx = x - a.x - ex * t;
    let qz = z - a.y - ez * t;
    zig = min(zig, sqrt(qx * qx + qz * qz));
  }
  let foot = CN_STAIR_W / 2.0 + 2.0 - zig;
  let inside = min(max(gap, foot), z - (cnStairZ(u32(0)).x - 8.0));
  if (inside < -200.0) { return h; }
  let goal = cnCorridorTarget(x, z);
  let below = 2.0 + 5.0 * cnSmooth(0.0, 20.0, -foot) + 1.5 * cnNoise(x, z, 23.0, CN_S_STAIR);
  let ravine = max(3.0 * cnSteps((cnStairProfile(z) - below) / 3.0, 0.2), CN_FLOOR_Y);
  let surf = mix(goal, min(ravine, goal), cnSmooth(0.0, 4.0, -foot));
  let o = max(-inside, 0.0);
  cnCorridorZone = inside >= 0.0;
  return clamp(h, surf - o * 0.7, surf + o * 120.0);
}

// ------------------------------------------------------------------ the natural land (a base height, from the plain)
var<private> cnWx: f32;
var<private> cnWz: f32;
var<private> cnWn: f32;
var<private> cnWarped: bool;
fn cnWarpOnce(x: f32, z: f32, minWave: f32) {
  if (!cnWarped) {
    cnWarped = true;
    cnWarp(x, z, minWave);
  }
}
fn cnWarp(x: f32, z: f32, minWave: f32) {
  let k2 = cnSmooth(minWave, 2.0 * minWave, 130.0);
  let k3 = cnSmooth(minWave, 2.0 * minWave, 16.0);
  cnWx = 95.0 * cnNoise(x, z, 520.0, CN_S_WARP) + 26.0 * k2 * cnNoise(x, z, 130.0, CN_S_WARP + 2u) + 1.8 * k3 * cnNoise(x, z, 16.0, CN_S_WARP + 4u);
  cnWz = 95.0 * cnNoise(x, z, 520.0, CN_S_WARP + 1u) + 26.0 * k2 * cnNoise(x, z, 130.0, CN_S_WARP + 3u) + 1.8 * k3 * cnNoise(x, z, 16.0, CN_S_WARP + 5u);
  let k4 = cnSmooth(minWave, 2.0 * minWave, 30.0);
  cnWn = 26.0 * k2 * cnNoise(x, z, 85.0, CN_S_WARP + 6u) + 9.0 * k4 * cnNoise(x, z, 28.0, CN_S_WARP + 8u) + 1.8 * k3 * cnNoise(x, z, 16.0, CN_S_WARP + 7u);
}

fn cnEastTip(x: f32, z: f32) -> f32 {
  return cnSmooth(620.0, 680.0, x - CN_STAR_C.x) * (1.0 - cnSmooth(40.0, 80.0, abs(z - CN_STAR_C.y)));
}
fn cnSdBastion(x: f32, z: f32) -> f32 {
  let qx = abs(x - CN_BASTION.x) - CN_BASTION.z;
  let qz = abs(z - CN_BASTION.y) - CN_BASTION.w;
  let ox = max(qx, 0.0);
  let oz = max(qz, 0.0);
  return sqrt(ox * ox + oz * oz) + min(max(qx, qz), 0.0) - CN_BASTION_R;
}
fn cnEdgeOut(x: f32, z: f32, minWave: f32) -> f32 {
  let k = cnSmooth(minWave, 2.0 * minWave, 40.0);
  let w = 0.75 * cnSmooth(-0.4, 0.4, cnNoise(x, z, 140.0, CN_S_EDGE)) + 0.25 * k * cnSmooth(-0.35, 0.35, cnNoise(x, z, 40.0, CN_S_EDGE + 1u));
  return CN_STAR_WANDER * w * (1.0 - cnEastTip(x, z));
}
fn cnCrestBase(x: f32, z: f32, t: f32, minWave: f32) -> f32 {
  if (t >= CN_RIM_W) { return 0.0; }
  let gate = cnSmooth(CN_GATE_X - 60.0, CN_GATE_X - 30.0, x) * (1.0 - cnSmooth(CN_GATE_REACH + 4.0, CN_GATE_REACH + 20.0, abs(z - CN_GATE_Z)));
  if (gate >= 1.0) { return 0.0; }
  let c = CN_RIM_C0 + (CN_RIM_C1 - CN_RIM_C0) * cnSmooth(-0.4, 0.4, cnNoise(x, z, 260.0, CN_S_CREST));
  let p = 6.0 + 4.0 * cnSmooth(-0.4, 0.4, cnNoise(x, z, 190.0, CN_S_CREST + 1u));
  let B = cnUnterrace(CN_FLOOR_Y - CN_PLAIN_Y + c) - CN_F_FLOOR;
  let f = select(1.0 - cnSmooth(p, CN_RIM_W, t), CN_LIP + (1.0 - CN_LIP) * cnSmooth(0.0, p, t), t < p);
  let k = cnSmooth(minWave, 2.0 * minWave, 35.0);
  return B * f * (1.0 + 0.18 * k * cnNoise(x, z, 35.0, CN_S_CREST + 2u)) * (1.0 - gate);
}

var<private> cnUMin: f32;
fn cnMesa(x: f32, z: f32, qx: f32, qz: f32, dE: f32, minWave: f32) -> f32 {
  if (dE <= 0.0) {
    cnUMin = 9.0;
    return CN_F_FLOOR + cnCrestBase(x, z, -dE, minWave);
  }
  let lip = CN_F_FLOOR + cnCrestBase(x, z, 0.0, minWave);
  let out = max(dE + cnWn * cnSmooth(0.5, 8.0, dE), 0.5 * dE);
  var c = clamp((CN_MESA_G * out) / lip, 0.0, 1.0);
  cnUMin = 1.0 - (CN_MESA_G * out) / lip;
  let wall = 4.0 * c * (1.0 - c);
  let g = abs(cnFbm(qx, qz, 150.0, 2, CN_S_GULLY, minWave));
  c = clamp(c + wall * (0.3 * (1.0 - cnSmooth(0.015, 0.09, g)) - 0.1 * cnSmooth(0.18, 0.4, g)), 0.0, 1.0);
  return lip * (1.0 - c);
}

fn cnFarness(x: f32, z: f32) -> f32 {
  let r = sqrt(x * x + z * z);
  if (r < 2000.0) { return 0.0; }
  return cnSmooth(2800.0, 6000.0, r + 900.0 * cnNoise(x, z, 5000.0, CN_S_FAR + 11u));
}

fn cnNatural(x: f32, z: f32, dE: f32, far: f32, minWave: f32, texel: f32) -> f32 {
  cnUMin = 9.0;
  var H = 0.0;
  if (far > 0.0) { H = max(max(far * 40.0 * cnFbm(x, z, 9000.0, 2, CN_S_PLAT + 5u, minWave), cnMesas(x, z, far, minWave)), 0.0); }
  if (dE < 110.0) {
    if (dE > 0.0) { cnWarpOnce(x, z, minWave); }
    H = max(max(H, cnMesa(x, z, x + cnWx, z + cnWz, dE, minWave)), cnButtress(x, z));
  }
  if (dE > 150.0) { H = max(H, cnOutcrops(x, z, minWave)); }
  if (texel < 3.0 && dE > 140.0 && dE < 640.0) { H += cnHoodoos(x, z, texel); }
  return H;
}

fn cnOutcrops(x: f32, z: f32, minWave: f32) -> f32 {
  let C = CN_OUTCROP_CELL;
  let cx = i32(floor(x / C));
  let cz = i32(floor(z / C));
  if (cnHashF(cx, cz, CN_S_BUTTE) > 0.18) { return -1e9; }
  let bx = (f32(cx) + 0.2 + 0.6 * cnHashF(cx, cz, CN_S_BUTTE + 1u)) * C;
  let bz = (f32(cz) + 0.2 + 0.6 * cnHashF(cx, cz, CN_S_BUTTE + 2u)) * C;
  let rad = 20.0 + 50.0 * cnHashF(cx, cz, CN_S_BUTTE + 3u);
  if (abs(x - bx) > rad + 40.0 || abs(z - bz) > rad + 40.0) { return -1e9; }
  cnWarpOnce(x, z, minWave);
  let ddx = x + 0.35 * cnWx - bx;
  let ddz = z + 0.35 * cnWz - bz;
  let d = sqrt(ddx * ddx + ddz * ddz);
  if (d > rad) { return -1e9; }
  let clear = cnSmooth(rad + 250.0, rad + 290.0, cnSdStar(bx, bz)) * cnSmooth(rad + 120.0, rad + 160.0, cnChannelDistance(bx, bz));
  if (clear <= 0.0) { return -1e9; }
  let e = cnHashF(cx, cz, CN_S_BUTTE + 4u);
  return cnUnterrace(10.0 + 35.0 * e * e) * (1.0 - cnSmooth(rad * 0.5, rad, d)) * clear;
}

fn cnMesas(x: f32, z: f32, far: f32, minWave: f32) -> f32 {
  let lx = x + 900.0 * cnNoise(x, z, 3000.0, CN_S_MESA + 7u);
  let lz = z + 900.0 * cnNoise(x, z, 3000.0, CN_S_MESA + 8u);
  let d = (cnFbm(lx, lz, 4200.0, 3, CN_S_MESA, minWave) - 0.1) * 5200.0;
  if (d <= 0.0) { return -1e9; }
  let top = 110.0 + 290.0 * clamp(0.5 + cnFbm(x, z, 16000.0, 2, CN_S_MESA + 3u, minWave), 0.0, 1.0);
  return cnUnterrace(top) * cnSmooth(0.0, 260.0, d) * far;
}

/** cell (cx, cz)'s hoodoo height over the plain (0: none there) */
fn cnHoodooHeight(cx: i32, cz: i32) -> f32 {
  let C = CN_HOODOO_CELL;
  let x = (f32(cx) + 0.2 + 0.6 * cnHashF(cx, cz, CN_S_HOODOO + 1u)) * C;
  let z = (f32(cz) + 0.2 + 0.6 * cnHashF(cx, cz, CN_S_HOODOO + 2u)) * C;
  let foot = cnSdStar(x, z) - 40.0;
  let k = cnSmooth(0.1, 0.14, cnFbm(x, z, 340.0, 2, CN_S_HOODOO + 5u, 0.001)) * cnSmooth(150.0, 180.0, foot) * (1.0 - cnSmooth(520.0, 550.0, foot))
    * (1.0 - cnSmooth(1250.0, 1350.0, max(abs(x - CN_STAR_C.x), abs(z - CN_STAR_C.y)))) * cnSmooth(50.0, 80.0, cnChannelDistance(x, z));
  if (k <= 0.0) { return 0.0; }
  let e = cnHashF(cx, cz, CN_S_HOODOO + 4u);
  return (10.0 + 24.0 * e * e) * k;
}

fn cnHoodoos(x: f32, z: f32, texel: f32) -> f32 {
  let C = CN_HOODOO_CELL;
  let ix = i32(floor(x / C));
  let iz = i32(floor(z / C));
  var H = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let cx = ix + i;
      let cz = iz + j;
      if (cnHashF(cx, cz, CN_S_HOODOO) > 0.38) { continue; }
      let hx = (f32(cx) + 0.2 + 0.6 * cnHashF(cx, cz, CN_S_HOODOO + 1u)) * C;
      let hz = (f32(cz) + 0.2 + 0.6 * cnHashF(cx, cz, CN_S_HOODOO + 2u)) * C;
      let r = 6.0 + 8.0 * cnHashF(cx, cz, CN_S_HOODOO + 3u);
      let ddx = x - hx;
      let ddz = z - hz;
      let d = sqrt(ddx * ddx + ddz * ddz);
      if (d > r * 1.9) { continue; }
      let height = cnHoodooHeight(cx, cz);
      if (height <= 0.0) { continue; }
      let lod = cnSmooth(2.0 * texel, 4.0 * texel, r);
      let prof = min((1.0 - cnSmooth(0.62, 1.0, d / r)) + 0.35 * (1.0 - cnSmooth(1.0, 1.9, d / r)), 1.0);
      H = max(H, cnUnterrace(height) * prof * lod);
    }
  }
  return H;
}

fn cnDunes(x: f32, z: f32, minWave: f32) -> f32 {
  let erg = cnSmooth(-0.12, 0.12, cnFbm(x, z, 14000.0, 2, CN_S_DUNE, minWave));
  if (erg <= 0.0) { return 0.0; }
  let u = (x * 0.92 + z * 0.38) / 170.0 + 2.2 * cnNoise(x, z, 700.0, CN_S_DUNE + 3u) + 0.6 * cnNoise(x, z, 230.0, CN_S_DUNE + 4u);
  let f = u - floor(u);
  let crest = cnSmooth(0.0, 0.72, f) * (1.0 - cnSmooth(0.72, 1.0, f));
  return erg * 4.0 * crest * cnSmooth(minWave, 2.0 * minWave, 170.0);
}

// ------------------------------------------------------------------ the whole
/** a sample of the ground: its height and what it was (canyon.ts HINT): the strata segment it landed on (-1 none,
 *  0 bench, 1 scree, 2 cliff) and how far along it, the designed zone (0 the plain and the mesa's walls, 1 the town's
 *  floor, 2 the stair's corridor, 3 a spoke gap's slope, 4 a garden terrace, 5 the plateau's top, 6 a water's bed,
 *  7 a ridge, 8 the rim, 9 a fissure), the distance from the water's channel (m), the place on the mesa's wall */
struct CanyonSample { h: f32, kind: i32, along: f32, zone: i32, river: f32, u: f32 }

fn canyonSample(x: f32, z: f32, texel: f32) -> CanyonSample {
  var o: CanyonSample;
  let minWave = 3.0 * texel;
  cnWarped = false;
  let d0 = cnSdStar(x, z);
  var dw = d0;
  if (d0 > -CN_RIM_W - 2.0 && d0 < 400.0) { dw = d0 - cnEdgeOut(x, z, minWave); }
  let dE = cnSmin(dw, cnSdBastion(x, z), 12.0);
  let far = cnFarness(x, z);
  let H0 = cnNatural(x, z, dE, far, minWave, texel);
  var h = cnTerrace(H0) + CN_PLAIN_Y;
  o.kind = cnTerraceKind;
  o.along = cnTerraceAlong;
  o.u = cnUMin;
  o.zone = select(select(1, 8, -dE < CN_RIM_W), 0, dE > 0.0);
  let ux = x - CN_CHUTE_X;
  let onChannel = ux > CN_CHUTE_ENDS.z && ux < 6600.0 && abs(z - CN_CHUTE_Z) < 700.0;
  var dc = CN_NO_CHANNEL;
  if (onChannel) { dc = cnChannelDistance(x, z); }
  o.river = min(dc, CN_NO_CHANNEL);
  if (dE > 0.0) {
    let drift = cnSmooth(-0.35, 0.0, cnUMin) * (1.0 - cnSmooth(0.0, 0.12, cnUMin));
    if (drift > 0.0) { h += 2.6 * drift * (0.55 + 0.45 * cnNoise(x, z, 45.0, CN_S_SAND)); }
    var bench = 0.0;
    if (cnTerraceKind == 0) { bench = cnSmooth(0.0, 0.15, cnTerraceAlong) * (1.0 - cnSmooth(0.85, 1.0, cnTerraceAlong)) * far; }
    let flats = max(bench, 1.0 - cnSmooth(0.0, 10.0, H0)) * cnSmooth(40.0, 100.0, dE);
    let calm = cnSmooth(40.0, 90.0, dc - CN_CHANNEL_HW);
    if (flats > 0.0) { h += flats * (1.6 * cnFbm(x, z, 1100.0, 3, CN_S_PLAT, minWave) + cnSmooth(190.0, 340.0, dE) * calm * cnDunes(x, z, minWave)); }
  }
  let pox = x - CN_PLAT_C.x;
  let poz = z - CN_PLAT_C.y;
  if (pox * pox + poz * poz < (CN_PLAT_R + 21.0) * (CN_PLAT_R + 21.0)) { cnWarpOnce(x, z, minWave); }
  let hp = cnPlateau(x, z, cnWn, texel);
  if (hp > h || cnPlatIn) {
    h = hp;
    o.zone = cnPlatZone;
    o.kind = cnPlatKind;
  }
  if (abs(x - CN_PLAT_C.x) < 120.0 && z - CN_PLAT_C.y > 60.0 && z - CN_PLAT_C.y < CN_CLEFT_R + 30.0) {
    h = cnCorridor(x, z, h);
    if (cnCorridorZone) { o.zone = 2; }
  }
  let dx = x - CN_PLAT_C.x;
  let dz = z - CN_PLAT_C.y;
  let out = dx * dx + dz * dz > (CN_PLAT_FOOT - 2.0) * (CN_PLAT_FOOT - 2.0);
  if (-dE >= CN_RIM_W && dx * dx + dz * dz > CN_PLAT_FOOT * CN_PLAT_FOOT) {
    h = CN_FLOOR_Y;
    o.zone = 1;
    o.kind = 0;
  }
  if (dE < 0.0 && out) {
    let Hr = CN_F_FLOOR + cnRidgesAt(x, z, minWave);
    if (Hr > H0 && Hr > CN_F_FLOOR) {
      h = cnTerrace(Hr) + CN_PLAIN_Y;
      o.zone = 7;
      o.kind = cnTerraceKind;
      o.along = cnTerraceAlong;
    }
    let low = min(cnPoolsAt(x, z), cnCanalAt(x, z));
    if (low < 0.0) {
      h = CN_FLOOR_Y + low;
      if (low < -0.05) { o.zone = 6; }
      o.kind = 0;
    }
  }
  let v = abs(z - CN_CHUTE_Z);
  if (ux > CN_CHUTE_ENDS.x && ux < CN_CHUTE_ENDS.w && v < CN_CHUTE_HALF) {
    h = mix(cnChuteBed(ux), h, cnSmooth(CN_CHUTE_HALF - 1.0, CN_CHUTE_HALF, v));
    if (v < CN_CHUTE_HALF - 0.5) {
      o.zone = 6;
      o.kind = 0;
    }
  }
  if (onChannel) {
    let c = cnChannelBed(dc);
    if (c < h) {
      h = c;
      if (dc < CN_CHANNEL_HW) {
        o.zone = 6;
        o.kind = -1;
      }
    }
  }
  o.h = h;
  return o;
}

/** the ground's height (m) at (x, z), as a level of texel spacing `texel` (m) holds it */
fn canyonHeight(x: f32, z: f32, texel: f32) -> f32 { return canyonSample(x, z, texel).h; }
