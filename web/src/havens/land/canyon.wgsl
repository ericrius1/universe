// The canyon's height on the GPU: canyon.ts (and noise.ts, strata.ts) line for line, with the same integer hashes,
// gradient noise, curves, strata and designed places, so a level filled here agrees with the CPU's canyonHeight within
// millimetres (tools/land-parity.mjs checks). Binding-free: include it anywhere; tables.wgsl (generated from
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
  let top = CN_STRATA_F[CN_STRATA_N - 1];
  if (H >= top) { cnTerraceKind = -1; return CN_STRATA_Y[CN_STRATA_N - 1] + (H - top); }
  var lo = 0;
  var hi = CN_STRATA_N - 2;
  loop {
    if (lo >= hi) { break; }
    let m = (lo + hi + 1) / 2;
    if (CN_STRATA_F[m] <= H) { lo = m; } else { hi = m - 1; }
  }
  let t = (H - CN_STRATA_F[lo]) / (CN_STRATA_F[lo + 1] - CN_STRATA_F[lo]);
  cnTerraceKind = i32(CN_STRATA_K[lo]);
  cnTerraceAlong = t;
  return CN_STRATA_Y[lo] + (CN_STRATA_Y[lo + 1] - CN_STRATA_Y[lo]) * t;
}
fn cnUnterrace(Y: f32) -> f32 {
  if (Y <= 0.0) { return Y; }
  let top = CN_STRATA_Y[CN_STRATA_N - 1];
  if (Y >= top) { return CN_STRATA_F[CN_STRATA_N - 1] + (Y - top); }
  var lo = 0;
  var hi = CN_STRATA_N - 2;
  loop {
    if (lo >= hi) { break; }
    let m = (lo + hi + 1) / 2;
    if (CN_STRATA_Y[m] <= Y) { lo = m; } else { hi = m - 1; }
  }
  let t = (Y - CN_STRATA_Y[lo]) / (CN_STRATA_Y[lo + 1] - CN_STRATA_Y[lo]);
  return CN_STRATA_F[lo] + (CN_STRATA_F[lo + 1] - CN_STRATA_F[lo]) * t;
}

// ------------------------------------------------------------------ curves and small shapes
const CN_RIVER = 0u;
const CN_WEST = 1u;
const CN_EAST = 2u;
const CN_SOUTH = 3u;
/** the slope of the last cnCurve */
var<private> cnCurveD: f32;
fn cnCurve(c: u32, x: f32) -> f32 {
  let i0 = CN_CURVE_OFF[c];
  let last = CN_CURVE_OFF[c + 1u] - 1u;
  if (x <= CN_CURVE_T[i0]) { cnCurveD = 0.0; return CN_CURVE_V[i0]; }
  if (x >= CN_CURVE_T[last]) { cnCurveD = 0.0; return CN_CURVE_V[last]; }
  var i = i0;
  loop {
    if (i >= last - 1u || x < CN_CURVE_T[i + 1u]) { break; }
    i++;
  }
  let h = CN_CURVE_T[i + 1u] - CN_CURVE_T[i];
  let s = (x - CN_CURVE_T[i]) / h;
  let s2 = s * s;
  let s3 = s2 * s;
  let v0 = CN_CURVE_V[i];
  let v1 = CN_CURVE_V[i + 1u];
  let m0 = CN_CURVE_M[i];
  let m1 = CN_CURVE_M[i + 1u];
  cnCurveD = ((6.0 * s2 - 6.0 * s) * (v0 - v1)) / h + (3.0 * s2 - 4.0 * s + 1.0) * m0 + (3.0 * s2 - 2.0 * s) * m1;
  return (2.0 * s3 - 3.0 * s2 + 1.0) * v0 + (s3 - 2.0 * s2 + s) * h * m0 + (-2.0 * s3 + 3.0 * s2) * v1 + (s3 - s2) * h * m1;
}

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

fn cnRamp(u: f32) -> f32 { return cnSmax(0.0, cnSmin(u, 1.0, 0.15), 0.15); }

var<private> cnAlongOut: f32;
fn cnAcross(c: u32, along: f32, across: f32, wander: f32, wanderD: f32) -> f32 {
  let mid = cnCurve(c, along) + wander;
  let slope = cnCurveD + wanderD;
  cnAlongOut = max(max(CN_CURVE_T[CN_CURVE_OFF[c]] - along, along - CN_CURVE_T[CN_CURVE_OFF[c + 1u] - 1u]), 0.0);
  return abs(across - mid) / sqrt(1.0 + slope * slope);
}
var<private> cnMeanderD: f32;
fn cnMeander(t: f32, l: f32, a: f32, s: u32) -> f32 {
  let v = cnNoise1(t, l, s);
  cnMeanderD = (a * cnNoise1D) / l;
  return a * v;
}

// ------------------------------------------------------------------ the river
var<private> cnRiverSlope: f32;
fn cnRiverZ(x: f32) -> f32 {
  let z = cnCurve(CN_RIVER, x);
  let d = cnCurveD;
  let a = 700.0 * cnSmooth(4200.0, 9000.0, abs(x));
  let v = cnNoise1(x, 2600.0, CN_S_RIVER);
  cnRiverSlope = d + (a * cnNoise1D) / 2600.0;
  return z + a * v;
}
fn cnRiverDistance(x: f32, z: f32) -> f32 {
  let zr = cnRiverZ(x);
  return abs(z - zr) / sqrt(1.0 + cnRiverSlope * cnRiverSlope);
}
fn cnRiverFloor(x: f32) -> f32 {
  let w = 175.0 + 55.0 * cnNoise1(x, 1400.0, CN_S_RIVER + 1u);
  return mix(130.0, w, cnSmooth(700.0, 1700.0, abs(x)));
}

// ------------------------------------------------------------------ the promontory and its gardens
var<private> cnGardenZone: i32;
fn cnSteps(t: f32, e: f32) -> f32 {
  let u = t + e / 2.0;
  let k = floor(u);
  return k - 1.0 + min((u - k) / e, 1.0);
}
fn cnGardenFloor(r: f32, w: CnWedge) -> f32 {
  let bw = (w.r1 - w.r0) / w.steps;
  return CN_MESA_TOP - w.drop * clamp(cnSteps((r - w.r0) / bw, 0.5 / bw), 0.0, w.steps - 1.0);
}
fn cnGardenSurface(x: f32, z: f32) -> f32 {
  let dx = x - CN_TEMPLE_X;
  let dz = z - CN_TEMPLE_Z;
  let r = sqrt(dx * dx + dz * dz);
  let top = CN_MESA_TOP + (CN_RIM_Y - CN_MESA_TOP) * cnSmooth(CN_TONGUE_RISE.x, CN_TONGUE_RISE.y, z);
  var gap = top;
  var inS = top;
  var inW = 0.0;
  for (var i = 0; i < CN_WEDGE_N; i++) {
    let w = CN_WEDGES[i];
    let c0 = w.d0.x * dz - w.d0.y * dx;
    let c1 = dx * w.d1.y - dz * w.d1.x;
    let lat = min(c0, c1);
    let t = (r - w.r0) / w.w;
    let line = CN_MESA_TOP - w.drop * clamp(t, 0.0, w.steps);
    var near = 1.0 - cnSmooth(0.17 * r, 0.22 * r + 0.01, -lat);
    if (w.short > 0.5) { near *= 1.0 - cnSmooth(w.r1, w.r1 + 0.5, r); }
    gap = min(gap, mix(top, line, near));
    var wi = clamp(lat / 0.5 + 0.5, 0.0, 1.0) * clamp((r - w.r0) / 0.5 + 0.5, 0.0, 1.0);
    if (w.short > 0.5) { wi *= clamp((w.r1 - r) / 0.5 + 0.5, 0.0, 1.0); }
    if (wi > 0.0) { inW = wi; inS = cnGardenFloor(r, w); }
  }
  cnGardenZone = select(select(5, 3, gap < top - 0.05), 4, inW > 0.5);
  return mix(gap, inS, inW);
}
fn cnTongue(x: f32, z: f32, north: f32) -> f32 {
  let cz = (CN_TEMPLE_Z + north) / 2.0;
  let hz = (CN_TEMPLE_Z - north) / 2.0;
  let hw = CN_PROM_HW + 90.0 * cnNoise1(z, 260.0, CN_S_PROM) * cnSmooth(-880.0, -1000.0, z);
  let qx = abs(x - CN_TEMPLE_X) - hw;
  let qz = abs(z - cz) - hz;
  let ox = max(qx, 0.0);
  let oz = max(qz, 0.0);
  return sqrt(ox * ox + oz * oz) + min(max(qx, qz), 0.0);
}
fn cnProm(x: f32, z: f32) -> f32 {
  let dx = x - CN_TEMPLE_X;
  let dz = z - CN_TEMPLE_Z;
  let disc = max(sqrt(dx * dx + dz * dz) - CN_PROM_R, -dz - 70.0);
  return min(disc, cnTongue(x, z, CN_PROM_NORTH));
}
var<private> cnPromZone: i32;
var<private> cnPromKind: i32;
fn cnPromontory(x: f32, z: f32, wn: f32) -> f32 {
  let d = cnProm(x, z);
  if (d > 160.0) { cnPromZone = 0; return -1e9; }
  let S = cnGardenSurface(x, z);
  if (d <= 0.0) { cnPromZone = cnGardenZone; cnPromKind = -1; return S; }
  cnPromZone = 0;
  let out = max(d + wn * cnSmooth(0.5, 8.0, d), 0.5 * d);
  let h = cnTerrace(cnUnterrace(S) - CN_PROM_G * out);
  cnPromKind = cnTerraceKind;
  return h;
}

// ------------------------------------------------------------------ the grand stair's corridor
fn cnStairProfile(z: f32) -> f32 {
  if (z <= CN_STAIR_Z[0].x) { return CN_STAIR_Z[0].y; }
  if (z >= CN_STAIR_Z[CN_STAIR_N - 1].x) { return CN_STAIR_Z[CN_STAIR_N - 1].y; }
  var i = 0;
  loop {
    if (i >= CN_STAIR_N - 2 || z < CN_STAIR_Z[i + 1].x) { break; }
    i++;
  }
  let a = CN_STAIR_Z[i];
  let b = CN_STAIR_Z[i + 1];
  return a.y + ((z - a.x) / (b.x - a.x)) * (b.y - a.y);
}
fn cnCorridorTarget(x: f32, z: f32) -> f32 {
  var y = 1e9;
  for (var i = 0; i < CN_STAIR_N - 1; i++) {
    let a = CN_LANDINGS[i];
    let b = CN_LANDINGS[i + 1];
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
    let L = CN_LANDINGS[i];
    let dx = x - L.x;
    let dz = z - L.y;
    y = min(y, L.z + max(sqrt(dx * dx + dz * dz) - CN_LANDING_R, 0.0) * 4.0);
  }
  return max(y - CN_STAIR_SINK, CN_FLOOR_Y);
}
var<private> cnCorridorZone: bool;
fn cnCorridor(x: f32, z: f32, h: f32) -> f32 {
  cnCorridorZone = false;
  let dx = x - CN_TEMPLE_X;
  let dz = z - CN_TEMPLE_Z;
  let r = sqrt(dx * dx + dz * dz);
  let gap = min(min(CN_GAP_A.x * dz - CN_GAP_A.y * dx, dx * CN_GAP_B.y - dz * CN_GAP_B.x), CN_PROM_R + CN_CLEFT_OUT - r);
  var zig = 1e9;
  for (var i = 0; i < CN_STAIR_N - 1; i++) {
    let a = CN_LANDINGS[i];
    let b = CN_LANDINGS[i + 1];
    let ex = b.x - a.x;
    let ez = b.y - a.y;
    let t = clamp(((x - a.x) * ex + (z - a.y) * ez) / (ex * ex + ez * ez), 0.0, 1.0);
    let qx = x - a.x - ex * t;
    let qz = z - a.y - ez * t;
    zig = min(zig, sqrt(qx * qx + qz * qz));
  }
  let foot = CN_STAIR_W / 2.0 + 2.0 - zig;
  let inside = min(max(gap, foot), z - (CN_STAIR_Z[0].x - 8.0));
  if (inside < -200.0) { return h; }
  let goal = cnCorridorTarget(x, z);
  let below = 2.0 + 5.0 * cnSmooth(0.0, 20.0, -foot) + 1.5 * cnNoise(x, z, 23.0, CN_S_STAIR);
  let ravine = 3.0 * cnSteps((cnStairProfile(z) - below) / 3.0, 0.2);
  let surf = mix(goal, min(ravine, goal), cnSmooth(0.0, 4.0, -foot));
  let o = max(-inside, 0.0);
  cnCorridorZone = inside >= 0.0;
  return clamp(h, surf - o * 0.7, surf + o * 120.0);
}

// ------------------------------------------------------------------ where buttes and hoodoos may not stand
fn cnClearance(x: f32, z: f32, rad: f32) -> f32 {
  var c = cnSmooth(rad + 180.0, rad + 220.0, cnEllipse(x - CN_BASIN.x, z - CN_BASIN.y, CN_BASIN.z, CN_BASIN.w));
  c = min(c, cnSmooth(rad + 60.0, rad + 100.0, cnEllipse(x - CN_ARMS.x, z - CN_ARMS.y, CN_ARMS.z, CN_ARMS.w)));
  c = min(c, cnSmooth(rad + 200.0, rad + 240.0, cnProm(x, z)));
  c = min(c, cnSmooth(rad + 60.0, rad + 100.0, cnRiverDistance(x, z) - cnRiverFloor(x)));
  // (each distance read before its alongOut: the side output must not race the sum)
  let dw = cnAcross(CN_WEST, x, z, 0.0, 0.0);
  c = min(c, cnSmooth(rad + 40.0, rad + 80.0, dw + cnAlongOut - CN_SIDE_HW.x * 1.3));
  let de = cnAcross(CN_EAST, x, z, 0.0, 0.0);
  c = min(c, cnSmooth(rad + 40.0, rad + 80.0, de + cnAlongOut - CN_SIDE_HW.y * 1.3));
  let ds = cnAcross(CN_SOUTH, z, x, 0.0, 0.0);
  return min(c, cnSmooth(rad + 60.0, rad + 100.0, ds + cnAlongOut - CN_SIDE_HW.z * 1.2));
}

// ------------------------------------------------------------------ the natural land (a base height)
var<private> cnWx: f32;
var<private> cnWz: f32;
var<private> cnWn: f32;
fn cnWarp(x: f32, z: f32, minWave: f32) {
  let k2 = cnSmooth(minWave, 2.0 * minWave, 130.0);
  let k3 = cnSmooth(minWave, 2.0 * minWave, 16.0);
  cnWx = 95.0 * cnNoise(x, z, 520.0, CN_S_WARP) + 26.0 * k2 * cnNoise(x, z, 130.0, CN_S_WARP + 2u) + 1.8 * k3 * cnNoise(x, z, 16.0, CN_S_WARP + 4u);
  cnWz = 95.0 * cnNoise(x, z, 520.0, CN_S_WARP + 1u) + 26.0 * k2 * cnNoise(x, z, 130.0, CN_S_WARP + 3u) + 1.8 * k3 * cnNoise(x, z, 16.0, CN_S_WARP + 5u);
  let k4 = cnSmooth(minWave, 2.0 * minWave, 30.0);
  cnWn = 26.0 * k2 * cnNoise(x, z, 85.0, CN_S_WARP + 6u) + 9.0 * k4 * cnNoise(x, z, 28.0, CN_S_WARP + 8u) + 1.8 * k3 * cnNoise(x, z, 16.0, CN_S_WARP + 7u);
}

var<private> cnUMin: f32;
var<private> cnWallness: f32;
fn cnCut(d: f32, hw: f32, W: f32, k: f32) -> f32 {
  let u = (d - hw) / W;
  cnUMin = min(cnUMin, u + 9.0 * (1.0 - k));
  let c = 1.0 - cnRamp(u);
  cnWallness = max(cnWallness, 4.0 * c * (1.0 - c) * k);
  return c;
}
fn cnDeeper(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  let m = max(a, b);
  return min(m + h * h * k * m * (1.0 - m), 1.0);
}
fn cnFarness(x: f32, z: f32) -> f32 {
  let dz = z - 300.0;
  return cnSmooth(2800.0, 6000.0, sqrt(x * x + dz * dz) + 900.0 * cnNoise(x, z, 5000.0, CN_S_FAR + 11u));
}

fn cnNatural(x: f32, z: f32, qx: f32, qz: f32, minWave: f32, texel: f32) -> f32 {
  cnUMin = 9.0;
  cnWallness = 0.0;
  let far = cnFarness(x, z);
  let calm = cnSmooth(100.0, 500.0, cnProm(x, z));
  let relief = calm * (2.0 + 62.0 * cnFbm(x, z, 1600.0, 3, CN_S_PLAT, minWave)) + far * 40.0 * cnFbm(x, z, 9000.0, 2, CN_S_PLAT + 5u, minWave);
  var plat = CN_RIM_Y + max(relief, 0.0);
  if (far > 0.0) { plat = max(plat, cnMesas(x, z, far, minWave)); }
  let wide = 1.0 + 0.38 * cnNoise(x, z, 900.0, CN_S_PLAT + 9u) * 2.0;
  let ridge = (1.0 - cnSmooth(700.0, 1500.0, abs(x))) * cnSmooth(150.0, 420.0, z) * (1.0 - cnSmooth(900.0, 1100.0, z));
  let raw = cnEllipse(x - CN_BASIN.x, z - CN_BASIN.y, CN_BASIN.z, CN_BASIN.w);
  var dBowl = cnSmin(cnEllipse(qx - CN_BASIN.x, qz - CN_BASIN.y, CN_BASIN.z, CN_BASIN.w), cnEllipse(qx - CN_ARMS.x, qz - CN_ARMS.y, CN_ARMS.z, CN_ARMS.w), 120.0);
  dBowl = min(dBowl, raw + 12.0);
  var e = cnCut(dBowl, 0.0, CN_W_BOWL * wide * (1.0 - 0.5 * ridge), 1.0);
  let dr = cnRiverDistance(qx, qz);
  e = cnDeeper(e, cnCut(dr, cnRiverFloor(qx), CN_W_RIVER * wide * (1.0 - 0.45 * ridge), 1.0), CN_K_RIDGE);
  if (qx < 0.0) {
    let m = cnMeander(qx, 260.0, 34.0 * cnSmooth(-800.0, -1400.0, qx), CN_S_SLOT);
    let d0 = cnAcross(CN_WEST, qx, qz, m, cnMeanderD);
    let d = d0 + cnAlongOut;
    let hw = CN_SIDE_HW.x * (1.0 + 0.28 * cnNoise1(qx, 330.0, CN_S_SLOT + 2u) * 2.0);
    e = cnDeeper(e, cnCut(d, hw, CN_W_SLOT, 1.0), CN_K_RIDGE);
  } else {
    let m = cnMeander(qx, 240.0, 30.0 * cnSmooth(800.0, 1400.0, qx), CN_S_SLOT + 1u);
    let d0 = cnAcross(CN_EAST, qx, qz, m, cnMeanderD);
    let d = d0 + cnAlongOut;
    let hw = CN_SIDE_HW.y * (1.0 + 0.28 * cnNoise1(qx, 310.0, CN_S_SLOT + 3u) * 2.0);
    e = cnDeeper(e, cnCut(d, hw, CN_W_SLOT, 1.0), CN_K_RIDGE);
  }
  {
    let m = cnMeander(qz, 420.0, 40.0 * cnSmooth(700.0, 1300.0, qz), CN_S_SOUTH);
    let d0 = cnAcross(CN_SOUTH, qz, qx, m, cnMeanderD);
    let d = d0 + cnAlongOut;
    let hw = CN_SIDE_HW.z * (1.0 + 0.15 * cnNoise1(qz, 600.0, CN_S_SOUTH + 1u) * 2.0);
    e = cnDeeper(e, cnCut(d, hw, CN_W_SOUTH * wide, 1.0), CN_K_RIDGE);
  }
  if (far > 0.0) {
    let n = cnFbm(qx, qz, 9000.0, 3, CN_S_FAR, minWave);
    let d = (abs(n) * 9000.0) / 1.6;
    let hw = 60.0 + 80.0 * (0.5 + cnFbm(x, z, 5000.0, 2, CN_S_FAR + 7u, minWave));
    let depth = clamp(0.55 + 0.9 * cnFbm(x, z, 14000.0, 2, CN_S_FAR + 9u, minWave), 0.35, 1.0);
    e = cnDeeper(e, far * depth * cnCut(d, hw, CN_W_FAR * wide, far), CN_K_RIDGE);
  }
  {
    let g = abs(cnFbm(qx, qz, 150.0, 2, CN_S_GULLY, minWave));
    let gully = 1.0 - cnSmooth(0.015, 0.09, g);
    let spur = cnSmooth(0.18, 0.4, g);
    e = clamp(e + cnWallness * (0.3 * gully - 0.1 * spur), 0.0, 1.0);
  }
  let reach = (1.0 - cnSmooth(0.15, 2.4, cnUMin)) * (1.0 - ridge) * (1.0 - 0.75 * far);
  if (reach > 0.0) {
    let n = cnFbm(qx, qz, 1250.0, 2, CN_S_TRIB, minWave);
    let d = (abs(n) * 1250.0) / 1.5;
    let u0 = cnUMin;
    e = cnDeeper(e, 0.8 * reach * cnCut(d, 6.0 + 16.0 * reach, 45.0, reach), CN_K_RIDGE);
    cnUMin = min(u0, cnUMin + 0.5);
  }
  e *= 1.0 - (1.0 - cnSmooth(-50.0, 10.0, cnTongue(x, z, -2400.0))) * cnSmooth(CN_TONGUE_SOLID.x, CN_TONGUE_SOLID.y, z);
  var H = plat - (plat - CN_FLOOR_Y) * e;
  H = max(H, cnButtes(qx, qz, x, z));
  if (texel < 3.0 && abs(x) < 4500.0 && abs(z) < 4500.0) { H += cnHoodoos(x, z, texel); }
  return H;
}

fn cnButtes(qx: f32, qz: f32, x: f32, z: f32) -> f32 {
  let C = 900.0;
  let ix = i32(floor(x / C));
  let iz = i32(floor(z / C));
  var H = -1e9;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let cx = ix + i;
      let cz = iz + j;
      if (cnHashF(cx, cz, CN_S_BUTTE) > 0.28) { continue; }
      let bx = (f32(cx) + 0.25 + 0.5 * cnHashF(cx, cz, CN_S_BUTTE + 1u)) * C;
      let bz = (f32(cz) + 0.25 + 0.5 * cnHashF(cx, cz, CN_S_BUTTE + 2u)) * C;
      let rad = 55.0 + 150.0 * cnHashF(cx, cz, CN_S_BUTTE + 3u);
      let ddx = qx - bx;
      let ddz = qz - bz;
      let d = sqrt(ddx * ddx + ddz * ddz);
      if (d > rad) { continue; }
      let clear = cnClearance(bx, bz, rad);
      if (clear <= 0.0) { continue; }
      let e = cnHashF(cx, cz, CN_S_BUTTE + 4u);
      let top = CN_RIM_Y - 25.0 + 190.0 * e * e;
      H = max(H, cnUnterrace(top) * (1.0 - cnSmooth(rad * 0.5, rad, d)) * clear);
    }
  }
  return H;
}

fn cnMesas(x: f32, z: f32, far: f32, minWave: f32) -> f32 {
  let lx = x + 900.0 * cnNoise(x, z, 3000.0, CN_S_MESA + 7u);
  let lz = z + 900.0 * cnNoise(x, z, 3000.0, CN_S_MESA + 8u);
  let d = (cnFbm(lx, lz, 4200.0, 3, CN_S_MESA, minWave) - 0.1) * 5200.0;
  if (d <= 0.0) { return -1e9; }
  let top = CN_RIM_Y + 70.0 + 300.0 * clamp(0.5 + cnFbm(x, z, 16000.0, 2, CN_S_MESA + 3u, minWave), 0.0, 1.0);
  let river = cnSmooth(CN_W_RIVER + 250.0, CN_W_RIVER + 900.0, cnRiverDistance(x, z));
  return CN_RIM_Y + (cnUnterrace(top) - CN_RIM_Y) * cnSmooth(0.0, 260.0, d) * far * river;
}

/** cell (cx, cz)'s hoodoo height over the plateau (0: none there) */
fn cnHoodooHeight(cx: i32, cz: i32) -> f32 {
  let C = CN_HOODOO_CELL;
  let x = (f32(cx) + 0.2 + 0.6 * cnHashF(cx, cz, CN_S_HOODOO + 1u)) * C;
  let z = (f32(cz) + 0.2 + 0.6 * cnHashF(cx, cz, CN_S_HOODOO + 2u)) * C;
  let dB = cnSmin(cnEllipse(x - CN_BASIN.x, z - CN_BASIN.y, CN_BASIN.z, CN_BASIN.w), cnEllipse(x - CN_ARMS.x, z - CN_ARMS.y, CN_ARMS.z, CN_ARMS.w), 120.0);
  let near = min(dB - CN_W_BOWL, cnRiverDistance(x, z) - cnRiverFloor(x) - CN_W_RIVER);
  let k = cnSmooth(0.1, 0.14, cnFbm(x, z, 340.0, 2, CN_S_HOODOO + 5u, 0.001)) * cnSmooth(90.0, 120.0, near) * (1.0 - cnSmooth(370.0, 400.0, near))
    * cnSmooth(160.0, 190.0, cnProm(x, z));
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
      H = max(H, (cnUnterrace(CN_RIM_Y + height) - CN_RIM_Y) * prof * lod);
    }
  }
  return H;
}

fn cnDunes(x: f32, z: f32, minWave: f32) -> f32 {
  let erg = cnSmooth(0.05, 0.25, cnFbm(x, z, 14000.0, 2, CN_S_DUNE, minWave));
  if (erg <= 0.0) { return 0.0; }
  let u = (x * 0.92 + z * 0.38) / 170.0 + 2.2 * cnNoise(x, z, 700.0, CN_S_DUNE + 3u) + 0.6 * cnNoise(x, z, 230.0, CN_S_DUNE + 4u);
  let f = u - floor(u);
  let crest = cnSmooth(0.0, 0.72, f) * (1.0 - cnSmooth(0.72, 1.0, f));
  return erg * 4.0 * crest * cnSmooth(minWave, 2.0 * minWave, 170.0);
}

// ------------------------------------------------------------------ the whole
/** a sample of the ground: its height and what it was (canyon.ts HINT): the strata segment the natural ground landed
 *  on (-1 none, 0 bench, 1 scree, 2 cliff) and how far along it, the designed zone (0 natural, 1 the city's floor, 2
 *  the stair's corridor, 3 a ramp's slope, 4 a garden terrace, 5 the promontory's top, 6 the river's channel), the
 *  river's distance (m), the normalized distance out from the nearest canyon floor */
struct CanyonSample { h: f32, kind: i32, along: f32, zone: i32, river: f32, u: f32 }

fn canyonSample(x: f32, z: f32, texel: f32) -> CanyonSample {
  var o: CanyonSample;
  let minWave = 3.0 * texel;
  cnWarp(x, z, minWave);
  let H0 = cnNatural(x, z, x + cnWx, z + cnWz, minWave, texel);
  var h = cnTerrace(H0);
  o.kind = cnTerraceKind;
  o.along = cnTerraceAlong;
  o.u = cnUMin;
  o.zone = 0;
  let lobes = 0.55 + 0.45 * cnNoise(x, z, 45.0, CN_S_SAND);
  h += 2.6 * cnSmooth(-0.35, 0.0, cnUMin) * (1.0 - cnSmooth(0.0, 0.12, cnUMin)) * lobes;
  let far = cnFarness(x, z);
  if (far > 0.0) {
    var bench = 0.0;
    if (cnTerraceKind == 0) { bench = cnSmooth(0.0, 0.15, cnTerraceAlong) * (1.0 - cnSmooth(0.85, 1.0, cnTerraceAlong)); }
    let flats = max(bench, 1.0 - cnSmooth(0.0, 10.0, H0));
    if (flats > 0.0) { h += far * cnDunes(x, z, minWave) * flats; }
  }
  let hp = cnPromontory(x, z, cnWn);
  if (hp >= h) {
    h = hp;
    o.zone = cnPromZone;
    o.kind = cnPromKind;
  }
  if (abs(x) < 320.0 && z > -700.0 && z < -260.0) {
    h = cnCorridor(x, z, h);
    if (cnCorridorZone) { o.zone = 2; }
  }
  let dW = cnEllipse(x - CN_WALL.x, z - CN_WALL.y, CN_WALL.z, CN_WALL.w);
  if (dW < 55.0) {
    h = mix(CN_FLOOR_Y, h, cnSmooth(30.0, 55.0, dW));
    if (dW < 30.0) { o.zone = 1; }
  }
  let dr = cnRiverDistance(x, z);
  o.river = dr;
  let chan = CN_FLOOR_Y - 2.5 + 2.5 * cnSmooth(CN_RIVER_HW - 5.0, CN_RIVER_HW + 10.0, dr) + max(dr - CN_RIVER_HW - 10.0, 0.0) * 3.0;
  if (chan < h) {
    h = chan;
    if (dr < CN_RIVER_HW) { o.zone = 6; }
  }
  o.h = h;
  return o;
}

/** the ground's height (m) at (x, z), as a level of texel spacing `texel` (m) holds it */
fn canyonHeight(x: f32, z: f32, texel: f32) -> f32 { return canyonSample(x, z, texel).h; }
