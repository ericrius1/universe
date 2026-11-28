// Sub-atomic world for Universe: from a single DNA bead (~1 nm) down through atoms,
// orbitals, the vast intra-atomic void, the Carbon-12 nucleus, a proton's valence quarks
// and gluon flux tubes, a point-like quark, 14 decades of self-similar vacuum fluctuations,
// spacetime quantum foam at the Planck length, infinite scale-free light, and back into
// the newborn universe / cosmic microwave background sphere.
//
// Self-contained WGSL: all module-scope identifiers prefixed with `q`. No bindings,
// no textures, no overrides, no enable directives. Analytic + parallax layers only.

const qPI: f32 = 3.14159265359;
const qTAU: f32 = 6.28318530718;
const qSQRT_PI_HALF: f32 = 1.25331413732;
const qINV_SQRT2: f32 = 0.70710678119;

// ---------------------------------------------------------------- math & noise helpers

// Smoothstep safe for both ascending (a < b) and descending (a > b) ranges
fn qRamp(a: f32, b: f32, x: f32) -> f32 {
  let u = clamp((x - a) / (b - a), 0.0, 1.0);
  return u * u * (3.0 - 2.0 * u);
}

// Quintic smoothstep (zero 1st and 2nd derivatives at endpoints)
fn qSmooth5(a: f32, b: f32, x: f32) -> f32 {
  let u = clamp((x - a) / (b - a), 0.0, 1.0);
  return u * u * u * (u * (u * 6.0 - 15.0) + 10.0);
}

// Smooth bell window: fades in on [a0, a1] and fades out on [b0, b1] (a0 < a1 <= b0 < b1)
fn qWindow(x: f32, a0: f32, a1: f32, b0: f32, b1: f32) -> f32 {
  return qRamp(a0, a1, x) * (1.0 - qRamp(b0, b1, x));
}

// Fast erfc(x) approximation (Abramowitz & Stegun 7.1.26, max error ~1.5e-7)
fn qErfc(x: f32) -> f32 {
  let ax = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * ax);
  let poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  let r = poly * exp(-ax * ax);
  return select(2.0 - r, r, x >= 0.0);
}

// Exact line integral of exp(-|p - c|^2 / (2*sig^2)) along ray ro + rd*s for s in [0, +inf)
fn qGaussLine(ro: vec3f, rd: vec3f, c: vec3f, sig: f32) -> f32 {
  let oc = ro - c;
  let s0 = -dot(oc, rd);
  let d2 = max(dot(oc, oc) - s0 * s0, 0.0);
  let inv2s2 = 0.5 / (sig * sig);
  let radial = exp(-min(d2 * inv2s2, 40.0));
  if (radial < 1e-5) { return 0.0; }
  let m0 = sig * qSQRT_PI_HALF * qErfc(-s0 * qINV_SQRT2 / sig);
  return radial * m0;
}

// Exact line integral of an elongated (prolate) 3D Gaussian lobe centered at `center`,
// stretched by `sigL` along unit `axis` and `sigT` perpendicular to `axis`.
fn qAnisoGaussLine(ro: vec3f, rd: vec3f, center: vec3f, axis: vec3f, uAx: vec3f, vAx: vec3f, sigL: f32, sigT: f32) -> f32 {
  let oc = ro - center;
  let roE = vec3f(dot(oc, axis) / sigL, dot(oc, uAx) / sigT, dot(oc, vAx) / sigT);
  let rdE = vec3f(dot(rd, axis) / sigL, dot(rd, uAx) / sigT, dot(rd, vAx) / sigT);
  let lenE = max(length(rdE), 1e-5);
  let rdU = rdE / lenE;
  let s0 = -dot(roE, rdU);
  let d2 = max(dot(roE, roE) - s0 * s0, 0.0);
  let radial = exp(-min(d2 * 0.5, 40.0));
  if (radial < 1e-5) { return 0.0; }
  let m0 = qSQRT_PI_HALF * qErfc(-s0 * qINV_SQRT2);
  return (radial * m0) / lenE;
}

// Exact line integral of (|p|^2 / sig^2) * exp(-|p|^2 / (2*sig^2)) along ray [0, +inf)
fn qShell2sLine(ro: vec3f, rd: vec3f, sig: f32) -> f32 {
  let s0 = -dot(ro, rd);
  let d2 = max(dot(ro, ro) - s0 * s0, 0.0);
  let s2 = sig * sig;
  let inv2s2 = 0.5 / s2;
  let radial = exp(-min(d2 * inv2s2, 40.0));
  if (radial < 1e-5) { return 0.0; }
  let m0 = sig * qSQRT_PI_HALF * qErfc(-s0 * qINV_SQRT2 / sig);
  let e0 = exp(-min(s0 * s0 * inv2s2, 40.0));
  let m2 = s2 * (m0 - s0 * e0);
  return radial * max(d2 * m0 + m2, 0.0) / s2;
}

// Ray-sphere intersection returning (tNear, tFar); tFar < 0 means miss
fn qSphereHit(ro: vec3f, rd: vec3f, c: vec3f, r: f32) -> vec2f {
  let oc = ro - c;
  let b = dot(oc, rd);
  let h = b * b - (dot(oc, oc) - r * r);
  if (h < 0.0) { return vec2f(-1.0, -1.0); }
  let sh = sqrt(h);
  return vec2f(-b - sh, -b + sh);
}

// Exact closest-approach between ray (ro + rd*s, s >= 0) and segment (a -> b).
// Returns vec3f(distance, segmentParam u in [0,1], rayDepth s)
fn qRaySeg(ro: vec3f, rd: vec3f, a: vec3f, b: vec3f) -> vec3f {
  let ba = b - a;
  let oa = ro - a;
  let bDotB = max(dot(ba, ba), 1e-8);
  let rDotB = dot(rd, ba);
  let rDotO = dot(rd, oa);
  let bDotO = dot(ba, oa);
  let denom = max(bDotB - rDotB * rDotB, 1e-6);
  let u = clamp((bDotO - rDotB * rDotO) / denom, 0.0, 1.0);
  let s = max(u * rDotB - rDotO, 0.0);
  let pRay = ro + rd * s;
  let pSeg = a + ba * u;
  return vec3f(length(pRay - pSeg), u, s);
}

// PCG-style 3D integer hash -> [0, 1)^3
fn qHash33u(vIn: vec3u) -> vec3f {
  var v = vIn * 1664525u + 1013904223u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v = v ^ (v >> vec3u(16u));
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  return vec3f(v & vec3u(0x00ffffffu)) * (1.0 / 16777216.0);
}

fn qHash31(p: vec3i) -> f32 {
  return qHash33u(bitcast<vec3u>(p)).x;
}

fn qHash33(p: vec3i) -> vec3f {
  return qHash33u(bitcast<vec3u>(p));
}

// Smooth 3D value noise in [-1, 1]
fn qVNoise3(p: vec3f) -> f32 {
  let ip = vec3i(floor(p));
  let fp = fract(p);
  let u = fp * fp * fp * (fp * (fp * 6.0 - 15.0) + 10.0);
  let n000 = qHash31(ip + vec3i(0, 0, 0));
  let n100 = qHash31(ip + vec3i(1, 0, 0));
  let n010 = qHash31(ip + vec3i(0, 1, 0));
  let n110 = qHash31(ip + vec3i(1, 1, 0));
  let n001 = qHash31(ip + vec3i(0, 0, 1));
  let n101 = qHash31(ip + vec3i(1, 0, 1));
  let n011 = qHash31(ip + vec3i(0, 1, 1));
  let n111 = qHash31(ip + vec3i(1, 1, 1));
  let nx00 = mix(n000, n100, u.x);
  let nx10 = mix(n010, n110, u.x);
  let nx01 = mix(n001, n101, u.x);
  let nx11 = mix(n011, n111, u.x);
  let nxy0 = mix(nx00, nx10, u.y);
  let nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z) * 2.0 - 1.0;
}

// Deterministic orthogonal rotation for an integer layer index
fn qLayerRot(k: i32) -> mat3x3f {
  let h = qHash33(vec3i(k * 17 + 3, k * 31 - 11, k * 13 + 7));
  let a = h.x * qTAU;
  let b = acos(clamp(h.y * 2.0 - 1.0, -1.0, 1.0));
  let g = h.z * qTAU;
  let ca = cos(a); let sa = sin(a);
  let cb = cos(b); let sb = sin(b);
  let cg = cos(g); let sg = sin(g);
  let r0 = vec3f(ca * cg - sa * cb * sg, -ca * sg - sa * cb * cg, sa * sb);
  let r1 = vec3f(sa * cg + ca * cb * sg, -sa * sg + ca * cb * cg, -ca * sb);
  let r2 = vec3f(sb * sg, sb * cg, cb);
  return mat3x3f(r0, r1, r2);
}

// Fast 2x2x2 nearest-octant 3D Worley cellular noise returning (d1, d2 - d1, cellId, d2).
// Centers the 8-cell neighborhood around p (via fract(p) < 0.5), giving clean Voronoi
// membranes at 3.4x lower cost than a 3x3x3 search.
fn qCell8(p: vec3f, tPhase: f32) -> vec4f {
  let ip = vec3i(floor(p));
  let fp = fract(p);
  let lo = ip - select(vec3i(0), vec3i(1), fp < vec3f(0.5));
  var d1: f32 = 8.0;
  var d2: f32 = 8.0;
  var bestId: f32 = 0.0;
  for (var k: i32 = 0; k < 8; k++) {
    let g = lo + vec3i(k & 1, (k >> 1) & 1, k >> 2);
    let h = qHash33(g);
    let drift = 0.5 + 0.30 * sin(h * qTAU + vec3f(tPhase, tPhase * 1.17 + 1.3, tPhase * 0.83 + 2.7));
    let diff = vec3f(g) + drift - p;
    let dist2 = dot(diff, diff);
    if (dist2 < d1) {
      d2 = d1;
      d1 = dist2;
      bestId = h.x;
    } else if (dist2 < d2) {
      d2 = dist2;
    }
  }
  let r1 = sqrt(d1);
  let r2 = sqrt(d2);
  return vec4f(r1, r2 - r1, bestId, r2);
}

// ---------------------------------------------------------------- Stage 1: Nucleotide atoms (L -8.6 -> -9.68)
// Packed inside the DNA bead (R = 0.36 nm) in nm units (L1 = -9.0).
// Atom 0 is Carbon at (0,0,0), handing off seamlessly into Stage 2's Carbon orbitals.

const qATOM_COUNT: i32 = 16;

fn qAtomColor(elem: i32) -> vec3f {
  if (elem == 0) { return vec3f(0.37, 0.41, 0.49); } // Carbon: restrained pearl-slate
  if (elem == 1) { return vec3f(0.25, 0.35, 0.55); } // Nitrogen: muted slate-periwinkle
  if (elem == 2) { return vec3f(0.50, 0.28, 0.28); } // Oxygen: muted dusty rose-clay
  if (elem == 3) { return vec3f(0.54, 0.41, 0.24); } // Phosphorus: muted warm champagne-ochre
  return vec3f(0.49, 0.53, 0.59);                    // Hydrogen: cool frost-pearl
}

fn qStage1Atoms(ro: vec3f, rd: vec3f, L: f32, t: f32, px: f32) -> vec4f {
  let wIn = qRamp(-8.60, -9.12, L);
  let wOut = 1.0 - qRamp(-9.42, -9.76, L);
  let wStage = wIn * wOut;
  if (wStage < 1e-4) { return vec4f(0.0); }

  let sc = pow(10.0, clamp(L - (-9.0), -6.0, 6.0));
  let roNm = ro * sc;

  var pos = array<vec3f, 16>(
    vec3f( 0.000,  0.000,  0.000), // 0: C (central target!)
    vec3f( 0.168,  0.042,  0.025), // 1: N
    vec3f(-0.105,  0.148,  0.038), // 2: C
    vec3f(-0.158, -0.055, -0.068), // 3: C
    vec3f( 0.048, -0.170,  0.046), // 4: O
    vec3f( 0.238,  0.162, -0.045), // 5: C
    vec3f( 0.082,  0.258, -0.025), // 6: N
    vec3f(-0.072,  0.258,  0.072), // 7: O
    vec3f(-0.248,  0.090, -0.042), // 8: C
    vec3f(-0.218, -0.172,  0.055), // 9: P
    vec3f(-0.278, -0.115,  0.165), // 10: O
    vec3f(-0.135, -0.270, -0.015), // 11: O
    vec3f( 0.208, -0.178, -0.072), // 12: C
    vec3f( 0.278, -0.035,  0.095), // 13: H
    vec3f(-0.042,  0.092, -0.208), // 14: H
    vec3f( 0.118, -0.095,  0.218)  // 15: H
  );
  var rad = array<f32, 16>(
    0.116, 0.108, 0.112, 0.112, 0.104, 0.110, 0.104, 0.098,
    0.108, 0.128, 0.096, 0.096, 0.106, 0.082, 0.082, 0.082
  );
  var elm = array<i32, 16>(
    0, 1, 0, 0, 2, 0, 1, 2, 0, 3, 2, 2, 0, 4, 4, 4
  );

  // Atom 0 opens translucently into Stage 2 orbitals
  let dissolveCore = qRamp(-9.26, -9.62, L);
  let keyDir = normalize(vec3f(-0.42, 0.68, 0.60));
  let rimDir = normalize(vec3f(0.55, -0.35, -0.75));

  var bestT: f32 = 1e9;
  var bestIdx: i32 = -1;
  var bestN: vec3f = vec3f(0.0, 1.0, 0.0);
  var bestEdge: f32 = 0.0;
  var cloudGlow: vec3f = vec3f(0.0);
  var cloudCov: f32 = 0.0;

  for (var i: i32 = 0; i < qATOM_COUNT; i++) {
    let fi = f32(i);
    let jAmp = select(0.004, 0.0, i == 0);
    let c = pos[i] + vec3f(
      sin(t * 0.75 + fi * 1.9),
      cos(t * 0.62 + fi * 2.7),
      sin(t * 0.83 + fi * 3.1)
    ) * jAmp;
    let r = rad[i];
    let col = qAtomColor(elm[i]);

    let camDist = length(roNm - c);
    let nearFade = qRamp(r * 0.95, r * 2.35, camDist);
    let coreVis = select(nearFade * (1.0 - dissolveCore * 0.65), 1.0 - dissolveCore, i == 0);

    // Subtle electron-cloud aura hugging silhouettes without washing over crevices
    let sig = r * 0.54;
    let gl = qGaussLine(roNm, rd, c, sig) / max(sig, 1e-4);
    let haloW = select(nearFade * (1.0 - dissolveCore * 0.65), 1.0 - dissolveCore * 0.50, i == 0);
    cloudGlow += col * pow(max(gl * 0.38, 0.0), 1.75) * 0.058 * haloW;
    cloudCov = 1.0 - (1.0 - cloudCov) * exp(-gl * 0.12 * haloW);

    if (coreVis > 0.01) {
      let rCore = r * 0.86;
      let oc = roNm - c;
      let b = dot(oc, rd);
      let d2 = max(dot(oc, oc) - b * b, 0.0);
      let d = sqrt(d2);
      let aa = max(px * max(-b, 0.05) * 1.5, rCore * 0.11);
      if (d < rCore + aa && -b > -rCore) {
        let hitT = max(-b - sqrt(max(rCore * rCore - d2, 0.0)), 0.001);
        let edge = 1.0 - qRamp(rCore - aa, rCore + aa, d);
        if (hitT < bestT && edge > 0.05) {
          bestT = hitT;
          bestIdx = i;
          bestN = normalize(roNm + rd * hitT - c);
          bestEdge = edge * coreVis;
        }
      }
    }
  }

  var rgb = cloudGlow;
  var alpha = cloudCov;

  if (bestIdx >= 0) {
    let baseCol = qAtomColor(elm[bestIdx]);
    let pHit = roNm + rd * bestT;
    var ao: f32 = 1.0;
    var shad: f32 = 1.0;
    for (var j: i32 = 0; j < qATOM_COUNT; j++) {
      if (j == bestIdx) { continue; }
      let toJ = pos[j] - pHit;
      let rj = rad[j];
      let dN = length(toJ) / max(rj, 0.05);
      ao *= 1.0 - 0.54 * exp(-max(dN - 0.80, 0.0) * 2.5);
      // Soft analytic cast shadow from neighbor sphere along keyDir
      let proj = dot(toJ, keyDir);
      if (proj > 0.0) {
        let perp = length(toJ - keyDir * proj);
        let occ = 1.0 - qRamp(rj * 0.45, rj * 1.15, perp);
        shad *= 1.0 - occ * 0.72 * exp(-proj * 1.15);
      }
    }
    let nl = dot(bestN, keyDir);
    let lam = max(nl, 0.0);
    let wrap = max((nl + 0.36) / 1.36, 0.0);
    let skyK = nl * 0.5 + 0.5;
    let ndv = max(dot(bestN, -rd), 0.0);
    let fres = pow(1.0 - ndv, 3.2);
    let rimL = max(dot(bestN, rimDir), 0.0);

    // Rich directional shading with tinted crevice AO (matching the cell's restrained pearl-under-water look)
    let sssCol = baseCol * vec3f(0.84, 0.74, 0.78);
    let keyLight = mix(sssCol * wrap * 0.34, baseCol * (0.24 + 0.92 * lam), qRamp(0.0, 0.58, lam)) * shad;
    let ambLight = baseCol * mix(vec3f(0.045, 0.058, 0.088), vec3f(0.18, 0.22, 0.28), skyK * skyK * (3.0 - 2.0 * skyK));
    let aoTint = mix(baseCol * 0.45 + vec3f(0.04, 0.07, 0.12), vec3f(1.0), ao) * ao;

    // Atom 0 awakens softly warm from within only as it opens into Stage 2 orbitals
    let innerBloom = select(0.0, 0.05 + 0.34 * dissolveCore, bestIdx == 0);
    let coreLight = (keyLight + ambLight) * aoTint
      + mix(baseCol, vec3f(0.76, 0.84, 0.96), 0.35) * fres * (0.14 + 0.14 * rimL) * ao * (0.35 + 0.65 * shad)
      + vec3f(0.95, 0.86, 0.72) * pow(ndv, 1.8) * innerBloom;
    let cA = clamp(bestEdge * 0.96, 0.0, 1.0);
    rgb = coreLight * cA + cloudGlow * (1.0 - cA);
    alpha = clamp(cA + cloudCov * (1.0 - cA), 0.0, 1.0);
  }

  // Cleanly cover the DNA bead's 0.36 nm silhouette by L=-9.15 with a soft organic feather
  let beadHit = qSphereHit(roNm, rd, vec3f(0.0), 0.372);
  if (beadHit.y > 0.0) {
    let chord = (beadHit.y - max(beadHit.x, 0.0)) / 0.744;
    let discMask = qRamp(0.0, 0.34, chord);
    let discCover = discMask * qRamp(-8.62, -9.12, L);
    let interiorBg = vec3f(0.0022, 0.0062, 0.0096);
    let fillA = max(discCover, alpha);
    rgb = rgb + interiorBg * max(fillA - alpha, 0.0);
    alpha = fillA;
  }

  return vec4f(rgb * wStage, clamp(alpha * wStage, 0.0, 1.0));
}

// ---------------------------------------------------------------- Stage 2: Carbon Atom Orbitals (L -9.35 -> -11.35)
// Scale reference L2 = -10.1 (1 unit = 0.079 nm = 0.79 Angstrom).
// Sculptural analytic 1s pearl core, hollow 2s spherical shell with radial node,
// three distinct orthogonal 2p dumbbell lobe pairs (prolate anisotropic Gaussians with crisp
// nodal planes!), and temporally-soft probability-weighted electron shimmer.

fn qElectronShimmer(p: vec3f, t: f32, density: f32, foot: f32) -> f32 {
  if (density < 0.04) { return 0.0; }
  let freq = 26.0;
  let nyq = 1.0 - qRamp(0.02, 0.065, foot * freq);
  if (nyq < 1e-3) { return 0.0; }
  let q = p * freq;
  let cell = vec3i(floor(q));
  let f = fract(q);
  let h = qHash33(cell);
  let sparkOn = qRamp(0.64, 0.76, h.x);
  if (sparkOn < 1e-3) { return 0.0; }
  let center = vec3f(0.25) + 0.5 * h;
  let dist = length(f - center);
  // Slow, smooth breath (~2.5s period) -> zero harsh flicker across frames
  let breath = 0.5 + 0.5 * sin(t * (1.5 + h.y * 1.1) + h.z * qTAU);
  let pulse = breath * breath * breath;
  let minRad = max(0.095, foot * freq * 1.5);
  let spot = exp(-dist * dist / (minRad * minRad));
  return spot * pulse * sparkOn * density * nyq;
}

// Evaluate one 2p prolate lobe with internal probability-cloud wisps, nodal-plane pinch,
// and clean camera-proximity fade so flying past lobes gives rich depth & parallax without wash.
fn qOrbitalLobe(roA: vec3f, rd: vec3f, center: vec3f, ax: vec3f, uAx: vec3f, vAx: vec3f, sigL: f32, sigT: f32, t: f32, px: f32) -> f32 {
  let sL = -dot(roA - center, rd);
  let camW = qRamp(0.02, 0.16, sL);
  if (camW < 1e-4) { return 0.0; }
  let raw = qAnisoGaussLine(roA, rd, center, ax, uAx, vAx, sigL, sigT) / sigT;
  if (raw < 1e-4) { return 0.0; }
  let pL = roA + rd * max(sL, 0.0);
  // Keep nodal planes deep ink-dark velvet near origin
  let nodal = qRamp(0.025, 0.125, abs(dot(pL, ax)));
  // Delicate band-limited volumetric probability wisps inside each lobe
  let foot = max(sL, 0.04) * px;
  let hiMask = 1.0 - qRamp(0.015, 0.065, foot * 16.0);
  let n1 = qVNoise3(pL * 9.5 + vec3f(t * 0.04, -t * 0.05, t * 0.03));
  let n2 = qVNoise3(pL * 20.0 - vec3f(t * 0.05, t * 0.04, -t * 0.06)) * hiMask;
  let wisp = clamp(0.62 + 0.42 * n1 + 0.22 * n2, 0.16, 1.20);
  // Steep falloff keeps tails pitch-black velvet between lobes (zero grey screen wash!)
  return pow(max(raw * 0.34, 0.0), 2.15) * nodal * wisp * camW;
}

fn qStage2Orbitals(ro: vec3f, rd: vec3f, L: f32, t: f32, px: f32) -> vec3f {
  let wStage = qWindow(L, -11.42, -10.82, -9.75, -9.36);
  if (wStage < 1e-4) { return vec3f(0.0); }

  let sc = pow(10.0, clamp(L - (-10.1), -6.0, 6.0));
  let roA = ro * sc;

  // Orthonormal 2p basis tilted organically off-axis so all 6 lobes sit >= 44 deg from the
  // incoming flight path (never flying straight through a lobe, and oblique rather than rigid).
  let e3 = normalize(vec3f(0.28, 0.18, 0.943));
  let e1Base = normalize(cross(vec3f(0.0, 1.0, 0.0), e3));
  let e2Base = cross(e3, e1Base);
  let ang = t * 0.05 + 0.55;
  let ca = cos(ang); let sa = sin(ang);
  let e1 = e1Base * ca + e2Base * sa;
  let e2 = -e1Base * sa + e2Base * ca;

  let kxy = 0.81649658; // sqrt(2/3)
  let kz  = 0.57735027; // sqrt(1/3)
  let ax0 = e1 * kxy + e3 * kz;
  let ax1 = (e1 * -0.5 + e2 *  0.8660254) * kxy + e3 * kz;
  let ax2 = (e1 * -0.5 + e2 * -0.8660254) * kxy + e3 * kz;

  let s0 = -dot(roA, rd);
  let dOrig = sqrt(max(dot(roA, roA) - s0 * s0, 0.0));

  // 1. Compact, jewel-like 1s pearl core (true Carbon scale ratio ~1:6 vs 2p), opening smoothly
  // into a sheer translucent veil as we pass through it around L = -10.9..-11.2
  let sig1s: f32 = 0.015;
  let i1s = qGaussLine(roA, rd, vec3f(0.0), sig1s) / sig1s;
  let hollow1s = qSmooth5(-10.72, -11.15, L);
  let ring1s = mix(1.0, qRamp(0.0, 0.016, dOrig), hollow1s * 0.82);
  let coreDissolve = 1.0 - qSmooth5(-10.72, -11.18, L);
  let core1s = pow(max(i1s * 0.44, 0.0), 1.90) * ring1s * coreDissolve;

  // 2. Soft, gossamer hollow 2s probability shell: silky grazing halo, deep dark velvet interior!
  let R2s: f32 = 0.255;
  let dr2s: f32 = 0.056;
  let disc2s = max(R2s * R2s - dOrig * dOrig, 0.0);
  let halfC = sqrt(disc2s);
  let cosT = halfC / R2s;
  // Soft limb profile: vanishes smoothly both outside R2s and straight through the dark hollow center
  let rimOut = exp(-max(dOrig - R2s, 0.0) * max(dOrig - R2s, 0.0) / (2.0 * dr2s * dr2s));
  let rimIn  = pow(clamp(1.0 - cosT, 0.0, 1.0), 2.1) * 0.92 + 0.08;
  let shellProf = rimOut * rimIn;
  var shell2s: f32 = 0.0;
  if (shellProf > 1e-4) {
    let sNear = s0 - halfC;
    let sFar  = s0 + halfC;
    let wNear = qRamp(0.04, 0.20, sNear);
    let wFar  = qRamp(0.04, 0.20, sFar);
    if (wNear > 1e-4) {
      let p1 = roA + rd * sNear;
      let t1 = clamp(0.55 + 0.48 * qVNoise3(p1 * 9.0 + vec3f(0.0, t * 0.05, 0.0)), 0.15, 1.15);
      shell2s += 0.55 * shellProf * wNear * t1;
    }
    if (wFar > 1e-4) {
      let p2 = roA + rd * sFar;
      let t2 = clamp(0.55 + 0.48 * qVNoise3(p2 * 9.0 - vec3f(t * 0.04, 0.0, 0.0)), 0.15, 1.15);
      shell2s += 0.45 * shellProf * wFar * t2;
    }
  }
  let cloudDissolve = 1.0 - qSmooth5(-10.78, -11.30, L);

  // 3. Six sculptural 2p dumbbell lobes sweeping past in two waves (3 front, 3 rear) over velvet dark
  let lobeOff: f32 = 0.305;
  let sigL: f32 = 0.115;
  let sigT: f32 = 0.052;

  let lobeX = qOrbitalLobe(roA, rd,  ax0 * lobeOff, ax0, ax1, ax2, sigL, sigT, t, px)
            + qOrbitalLobe(roA, rd, -ax0 * lobeOff, ax0, ax1, ax2, sigL, sigT, t, px);
  let lobeY = qOrbitalLobe(roA, rd,  ax1 * lobeOff, ax1, ax2, ax0, sigL, sigT, t, px)
            + qOrbitalLobe(roA, rd, -ax1 * lobeOff, ax1, ax2, ax0, sigL, sigT, t, px);
  let lobeZ = qOrbitalLobe(roA, rd,  ax2 * lobeOff, ax2, ax0, ax1, sigL, sigT, t, px)
            + qOrbitalLobe(roA, rd, -ax2 * lobeOff, ax2, ax0, ax1, sigL, sigT, t, px);

  let col1s = vec3f(1.00, 0.92, 0.80); // warm pearl-ivory 1s heart
  let col2s = vec3f(0.46, 0.68, 0.94); // sheer moonstone-ice 2s shell
  let colPx = vec3f(0.92, 0.76, 0.54); // muted champagne-gold 2px dumbbells
  let colPy = vec3f(0.46, 0.70, 0.96); // cool silver-ice 2py dumbbells
  let colPz = vec3f(0.68, 0.56, 0.88); // misty lavender-slate 2pz dumbbells

  var col = vec3f(0.0);
  col += col1s * core1s * 0.82;
  col += col2s * shell2s * 0.145 * cloudDissolve;
  col += colPx * lobeX * 0.50 * cloudDissolve;
  col += colPy * lobeY * 0.45 * cloudDissolve;
  col += colPz * lobeZ * 0.36 * cloudDissolve;

  // Faint, temporally soft stochastic shimmer of electron positions weighted by local orbital density
  let shimmerFade = qWindow(L, -11.00, -10.50, -9.90, -9.50);
  if (shimmerFade > 1e-3 && dOrig < 0.58) {
    var shim: f32 = 0.0;
    let sMid = max(s0, 0.08);
    let stepS = 0.095;
    for (var k: i32 = -1; k <= 1; k++) {
      let sk = sMid + f32(k) * stepS;
      if (sk > 0.06) {
        let pk = roA + rd * sk;
        let x0 = dot(pk, ax0); let x1 = dot(pk, ax1); let x2 = dot(pk, ax2);
        let r2 = dot(pk, pk);
        let r = sqrt(r2);
        let d2p = (x0 * x0 + x1 * x1 + x2 * x2) / (0.24 * 0.24) * exp(-r2 / (2.0 * 0.20 * 0.20));
        let d2s = exp(-pow((r - R2s) / (dr2s * 1.2), 2.0)) * 0.30;
        let dens = clamp(d2p * 0.75 + d2s, 0.0, 1.2);
        shim += qElectronShimmer(pk, t + f32(k) * 0.41, dens, sk * px);
      }
    }
    col += vec3f(0.96, 0.95, 1.0) * shim * 0.52 * shimmerFade;
  }

  return col * wStage;
}

// ---------------------------------------------------------------- Stage 3: Vast Intra-Atomic Emptiness (L -10.5 -> -14.2)
// Soft enveloping peripheral glow of the distant electron cloud fading into deep velvet dark,
// while the Carbon-12 nucleus grows steadily from a tiny luminous point at (0,0,0).

fn qStage3Void(ro: vec3f, rd: vec3f, L: f32, t: f32, px: f32) -> vec3f {
  let wStage = qWindow(L, -14.35, -13.75, -10.85, -10.25);
  if (wStage < 1e-4) { return vec3f(0.0); }

  var col = vec3f(0.0);

  // 1. Soft enveloping peripheral mist of the outer electron cloud fading away smoothly
  let mistFade = qWindow(L, -13.20, -11.75, -10.85, -10.35);
  if (mistFade > 1e-4) {
    let b = -dot(ro, rd);
    let imp = sqrt(max(dot(ro, ro) - b * b, 0.0));
    let n = qVNoise3(rd * 2.0 + vec3f(0.0, t * 0.04, L * 0.12));
    // Peripheral cathedral halo: dark deep-indigo center so the nuclear pinpoint shines like a diamond
    let rim = smoothstep(0.14, 0.95, imp);
    let mist = (0.002 + 0.022 * rim * rim) * (0.85 + 0.15 * n);
    col += vec3f(0.45, 0.62, 0.92) * mist * mistFade;
  }

  // 2. Whisper-faint full-screen parallax field wisps so the 3.5-decade zoom feels spacious & alive
  let dustW = qWindow(L, -13.90, -13.10, -11.30, -10.75);
  if (dustW > 1e-4) {
    let zAx = normalize(-ro);
    let rz = max(dot(rd, zAx), 0.12);
    let u = -L / 1.15;
    let k0 = i32(floor(u));
    let f = fract(u);
    for (var j: i32 = 0; j < 2; j++) {
      let x = f32(j) - f; // in (-1, +1]
      let sw = sin(clamp((x + 1.0) * 0.5, 0.0, 1.0) * qPI);
      let sPlane = 1.0 / rz;
      let pWorld = ro + rd * sPlane;
      let pL = qLayerRot(k0 + j + 100) * (pWorld * pow(10.0, x * 1.15) * 1.4);
      let n1 = qVNoise3(pL + vec3f(0.0, 0.0, t * 0.05));
      let wisp = pow(max(n1 * 0.5 + 0.5, 0.0), 3.6);
      col += vec3f(0.28, 0.42, 0.68) * wisp * 0.010 * sw * sw * dustW;
    }
  }

  // 3. The Carbon-12 nucleus: tiny luminous point at (0,0,0) growing continuously into Stage 4
  let rNucView = pow(10.0, clamp(-14.5686 - L, -6.0, 1.0));
  let s0 = -dot(ro, rd);
  if (s0 > 0.0) {
    let d = sqrt(max(dot(ro, ro) - s0 * s0, 0.0));
    let foot = s0 * px;
    let coreR = max(rNucView * 0.58, foot * 1.25);
    let haloR = max(rNucView * 2.0, foot * 5.5 + 0.011 * qRamp(-10.8, -13.8, L));

    let starIn = qRamp(-10.45, -11.15, L);
    let starOut = 1.0 - qRamp(-13.68, -14.10, L);
    let starW = starIn * starOut;

    if (starW > 1e-4) {
      let core = exp(-min((d * d) / (coreR * coreR), 40.0));
      let halo = exp(-min(d / max(haloR, 1e-5), 25.0)) * 0.22
               + 1.0 / (1.0 + (d * d) / (haloR * haloR * 0.28)) * 0.06;
      let grow = mix(0.75, 1.75, qRamp(-10.8, -13.8, L));
      let coreCol = vec3f(1.00, 0.94, 0.84);
      let haloCol = vec3f(0.74, 0.80, 0.96);
      col += (coreCol * core * 1.85 + haloCol * halo * 0.68) * grow * starW;
    }
  }

  return col * wStage;
}

// ---------------------------------------------------------------- Stage 4: Carbon-12 Nucleus (L -13.65 -> -15.08)
// 6 protons (warm ivory-rose) + 6 neutrons (cool silver-moonstone).
// Nucleon radius = 0.85e-15 m, nucleus radius ~ 2.7e-15 m (L4 = -14.5686).
// Nucleon 0 is a PROTON at (0,0,0), nestled cleanly so we enter it without clipping neighbors.

fn qStage4Nucleus(ro: vec3f, rd: vec3f, L: f32, t: f32, px: f32) -> vec3f {
  let wStage = qWindow(L, -15.08, -14.78, -14.00, -13.62);
  if (wStage < 1e-4) { return vec3f(0.0); }

  let sc = pow(10.0, clamp(L - (-14.5686), -6.0, 6.0));
  let roN = ro * sc;
  let rNuc: f32 = 0.3148;

  var nPos = array<vec3f, 12>(
    vec3f( 0.00,  0.00,  0.00), // 0: PROTON (target at origin)
    vec3f( 0.56,  0.14, -0.14), // 1: neutron
    vec3f(-0.54,  0.22,  0.14), // 2: proton
    vec3f( 0.08, -0.56,  0.10), // 3: neutron
    vec3f(-0.14,  0.56, -0.20), // 4: proton
    vec3f( 0.42, -0.34, -0.34), // 5: proton
    vec3f(-0.44, -0.30, -0.34), // 6: neutron
    vec3f( 0.11,  0.06, -0.58), // 7: neutron
    vec3f( 0.56,  0.46,  0.22), // 8: neutron (widened slightly for clean entry window)
    vec3f(-0.48, -0.18,  0.40), // 9: proton
    vec3f(-0.22,  0.54,  0.30), // 10: neutron (widened slightly)
    vec3f( 0.36, -0.44,  0.34)  // 11: proton
  );
  var isProt = array<f32, 12>(
    1.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0
  );

  let protonCol  = vec3f(0.62, 0.44, 0.39);
  let neutronCol = vec3f(0.37, 0.48, 0.62);
  let keyDir = normalize(vec3f(-0.40, 0.65, 0.65));
  let rimDir = normalize(vec3f(0.55, -0.35, -0.75));

  let openSkin = qRamp(-14.66, -14.98, L);
  let p0Jostle = 0.008 * (1.0 - qRamp(-14.52, -14.82, L));

  var bestT: f32 = 1e9;
  var bestIdx: i32 = -1;
  var bestN: vec3f = vec3f(0.0, 1.0, 0.0);
  var bestEdge: f32 = 0.0;
  var bestVis: f32 = 0.0;
  var mistGlow: vec3f = vec3f(0.0);

  for (var i: i32 = 0; i < 12; i++) {
    let fi = f32(i);
    let amp = select(0.022, p0Jostle, i == 0);
    let c = nPos[i] + vec3f(
      sin(t * 1.35 + fi * 2.1),
      cos(t * 1.18 + fi * 1.7 + 0.8),
      sin(t * 1.48 + fi * 2.9 + 1.6)
    ) * amp;
    let baseC = mix(neutronCol, protonCol, isProt[i]);

    // Smoothly fade outer nucleons well before they approach the camera lens (zero clipping notches!)
    let camDist = length(roN - c);
    let vis = select(qRamp(rNuc * 1.55, rNuc * 2.85, camDist) * (1.0 - openSkin * 0.65), 1.0 - openSkin, i == 0);

    let sig = rNuc * 0.56;
    let gl = qGaussLine(roN, rd, c, sig) / sig;
    mistGlow += baseC * pow(max(gl * 0.36, 0.0), 1.8) * 0.055 * select(vis, 1.0 - openSkin * 0.85, i == 0);

    if (vis > 0.02) {
      let oc = roN - c;
      let b = dot(oc, rd);
      let d2 = max(dot(oc, oc) - b * b, 0.0);
      let d = sqrt(d2);
      let aa = max(px * max(-b, 0.05) * 1.5, rNuc * 0.08);
      if (d < rNuc + aa && -b > -rNuc) {
        let hitT = max(-b - sqrt(max(rNuc * rNuc - d2, 0.0)), 0.001);
        let edge = 1.0 - qRamp(rNuc - aa, rNuc + aa, d);
        if (hitT < bestT && edge > 0.05) {
          bestT = hitT;
          bestIdx = i;
          bestN = normalize(roN + rd * hitT - c);
          bestEdge = edge;
          bestVis = vis;
        }
      }
    }
  }

  var col = mistGlow;
  if (bestIdx >= 0) {
    let baseC = mix(neutronCol, protonCol, isProt[bestIdx]);
    let pHit = roN + rd * bestT;
    var ao: f32 = 1.0;
    var shad: f32 = 1.0;
    for (var j: i32 = 0; j < 12; j++) {
      if (j == bestIdx) { continue; }
      let toJ = nPos[j] - pHit;
      let dN = length(toJ) / rNuc;
      ao *= 1.0 - 0.52 * exp(-max(dN - 0.85, 0.0) * 2.5);
      let proj = dot(toJ, keyDir);
      if (proj > 0.0) {
        let perp = length(toJ - keyDir * proj);
        let occ = 1.0 - qRamp(rNuc * 0.45, rNuc * 1.15, perp);
        shad *= 1.0 - occ * 0.65 * exp(-proj * 0.9);
      }
    }
    let surfVar = 0.93 + 0.07 * qVNoise3(pHit * 4.8 + vec3f(t * 0.25));
    let nl = dot(bestN, keyDir);
    let lam = max(nl, 0.0);
    let wrap = max((nl + 0.35) / 1.35, 0.0);
    let ndv = max(dot(bestN, -rd), 0.0);
    let fres = pow(1.0 - ndv, 3.0);
    let rimL = max(dot(bestN, rimDir), 0.0);
    let innerGlow = select(0.02, 0.14 + 0.26 * openSkin, bestIdx == 0);
    let aoTint = mix(baseC * 0.45 + vec3f(0.03, 0.04, 0.08), vec3f(1.0), ao) * ao;
    let surf = baseC * surfVar * (0.06 + (0.24 * wrap + 0.82 * lam) * shad) * aoTint
      + mix(baseC, vec3f(0.94, 0.91, 0.88), 0.42) * fres * (0.24 + 0.22 * rimL) * ao * (0.4 + 0.6 * shad)
      + vec3f(0.96, 0.78, 0.72) * pow(ndv, 1.8) * innerGlow;
    let cA = clamp(bestEdge * bestVis * 0.96, 0.0, 1.0);
    col = surf * cA + mistGlow * (1.0 - cA);
  }

  return col * wStage;
}

// ---------------------------------------------------------------- Stage 5: Inside the Proton (L -14.78 -> -16.45)
// Reference scale L5 = -15.0706 (1 unit = 0.85e-15 m, proton radius).
// Three valence quarks (dusty rose, sage, slate — NOT primary RGB) in a clear 3D Y formation,
// crisp glowing curved gluon flux tubes, and fizzing short-lived virtual quark-antiquark sparks.

fn qFluxTubeArm(ro: vec3f, rd: vec3f, a: vec3f, b: vec3f, colA: vec3f, colB: vec3f, t: f32, seed: f32, px: f32) -> vec3f {
  let rs = qRaySeg(ro, rd, a, b);
  let u = rs.y;
  let s = rs.z;
  let dir = b - a;
  let perp = normalize(cross(dir, vec3f(0.17, 0.93, -0.32)));
  let perp2 = normalize(cross(dir, perp));
  let arch = sin(u * qPI);
  let sway = (perp * sin(t * 2.1 + u * 5.0 + seed) + perp2 * cos(t * 1.7 + u * 4.2 + seed * 1.6)) * (0.020 * arch);
  let pSeg = mix(a, b, u) + sway;
  let d = length((ro + rd * s) - pSeg);

  let endFade = qRamp(0.0, 0.14, u) * qRamp(1.0, 0.88, u);
  let pulse = 0.80 + 0.20 * sin(u * 9.5 - t * 3.4 + seed);
  let foot = max(s * px, 1e-4);

  let rCore = max(0.013, foot * 1.8);
  let rSheath = max(0.042, foot * 4.0);
  let core = exp(-min((d * d) / (rCore * rCore), 36.0));
  let sheath = exp(-min((d * d) / (rSheath * rSheath), 30.0));
  let c = mix(colA, colB, u);
  let hot = mix(c, vec3f(1.0, 0.96, 0.90), 0.62);
  return (hot * core * 0.98 + c * sheath * 0.28) * pulse * (0.35 + 0.65 * endFade);
}

fn qStage5Proton(ro: vec3f, rd: vec3f, L: f32, t: f32, px: f32) -> vec3f {
  let wStage = qWindow(L, -16.48, -15.85, -15.05, -14.75);
  if (wStage < 1e-4) { return vec3f(0.0); }

  let sc = pow(10.0, clamp(L - (-15.0706), -6.0, 6.0));
  let roP = ro * sc;

  // Muted color-charge hues (dusty rose, sage, slate — never primary RGB)
  let cRose    = vec3f(0.86, 0.50, 0.56); // Quark 0 (target)
  let cSage    = vec3f(0.48, 0.74, 0.58); // Quark 1
  let cSlate   = vec3f(0.50, 0.64, 0.86); // Quark 2
  let cSinglet = vec3f(0.98, 0.94, 0.86); // Pearl-ivory Y-junction

  // Equilateral Y-triangle tilted cleanly across the 3D view plane with a gentle slow orbital spin
  // so all three quarks and all three Y-arms read unmistakably!
  let uAx = normalize(vec3f( 0.92,  0.04, -0.39));
  let vAx = normalize(vec3f(-0.11,  0.96, -0.26));
  let wAx = cross(uAx, vAx);

  let spin = t * 0.22;
  let rTri: f32 = 0.235;
  let a0 = -qPI * 0.5 + spin;
  let a1 = a0 + qTAU / 3.0;
  let a2 = a0 + 2.0 * qTAU / 3.0;

  let b0 = (uAx * cos(a0) + vAx * sin(a0)) * rTri + wAx * (0.04 * sin(t * 0.7));
  let b1 = (uAx * cos(a1) + vAx * sin(a1)) * rTri + wAx * (0.05 * cos(t * 0.6 + 1.2));
  let b2 = (uAx * cos(a2) + vAx * sin(a2)) * rTri + wAx * (0.05 * sin(t * 0.8 + 2.4));

  // Smooth quintic glide: as L drops from -15.35 to -15.85, Quark 0 settles dead-center at (0,0,0)
  let glide = qSmooth5(-15.35, -15.85, L);
  let shift = b0 * glide;
  let q0 = b0 - shift;
  let q1 = b1 - shift;
  let q2 = b2 - shift;
  let yc = (q0 + q1 + q2) * 0.33333 + vec3f(sin(t * 1.4), cos(t * 1.1), sin(t * 0.9)) * 0.009 * (1.0 - glide);

  var col = vec3f(0.0);

  // 1. Delicate translucent proton confinement halo (smoothly gated, zero sharp planes!)
  let bagFade = 1.0 - qRamp(-15.08, -15.42, L);
  if (bagFade > 1e-3) {
    let bagC = -shift;
    let oc = roP - bagC;
    let b = dot(oc, rd);
    let imp = sqrt(max(dot(oc, oc) - b * b, 0.0));
    let rim = exp(-pow((imp - 0.88) / 0.16, 2.0)) * qRamp(-0.25, 0.25, -b);
    col += vec3f(0.76, 0.64, 0.62) * rim * 0.055 * bagFade;
  }

  // 2. Crisp glowing Y-shaped gluon flux tubes connecting yc -> q0, q1, q2
  let tubeFade = 1.0 - qRamp(-15.72, -16.25, L);
  if (tubeFade > 1e-3) {
    col += qFluxTubeArm(roP, rd, yc, q0, cSinglet, cRose,  t, 0.0, px) * tubeFade;
    col += qFluxTubeArm(roP, rd, yc, q1, cSinglet, cSage,  t, 2.1, px) * tubeFade;
    col += qFluxTubeArm(roP, rd, yc, q2, cSinglet, cSlate, t, 4.2, px) * tubeFade;
    // Luminous pearl knot at the Steiner Y-junction
    let sY = -dot(roP - yc, rd);
    if (sY > 0.0) {
      let dY = length((roP - yc) + rd * sY);
      let rY = max(0.032, sY * px * 2.4);
      col += cSinglet * exp(-min((dY * dY) / (rY * rY), 36.0)) * 0.50 * tubeFade;
    }
  }

  // 3. The three valence quarks (jewel-like incandescent cores + muted color-charge halos)
  let q0Shrink = mix(1.0, 0.35, qRamp(-15.50, -16.10, L));
  var qPos = array<vec3f, 3>(q0, q1, q2);
  var qCol = array<vec3f, 3>(cRose, cSage, cSlate);
  for (var i: i32 = 0; i < 3; i++) {
    let qp = qPos[i];
    let qc = qCol[i];
    let oc = roP - qp;
    let sQ = -dot(oc, rd);
    if (sQ <= 0.0) { continue; }
    let dQ = length(oc + rd * sQ);
    let rScale = select(1.0, q0Shrink, i == 0);
    let foot = sQ * px;
    let rCore = max(0.024 * rScale, foot * 1.8);
    let rHalo = max(0.084 * rScale, foot * 4.5);
    let core = exp(-min((dQ * dQ) / (rCore * rCore), 40.0));
    let halo = exp(-min((dQ * dQ) / (rHalo * rHalo), 30.0)) * 0.38
             + exp(-min(dQ / max(rHalo * 1.4, 1e-4), 20.0)) * 0.085;
    col += mix(qc, vec3f(1.0, 0.96, 0.92), 0.70) * core * 1.25 + qc * halo * 0.56;
  }

  // 4. Fizzing sea of short-lived virtual quark-antiquark sparks inside the proton
  let seaFade = 1.0 - qRamp(-15.65, -16.20, L);
  if (seaFade > 1e-3) {
    let bagC = -shift;
    for (var k: i32 = 0; k < 12; k++) {
      let fk = f32(k);
      let period = 1.25 + fract(fk * 0.371) * 0.90;
      let cycle = t / period + fk * 0.6180339;
      let gen = i32(floor(cycle));
      let life = fract(cycle);
      let env = sin(life * qPI);
      let env2 = env * env;
      if (env2 < 0.02) { continue; }
      let h1 = qHash33(vec3i(k * 13 + 5, gen * 29 + 3, k * 7 - gen));
      let h2 = qHash33(vec3i(k * 19 + 1, gen * 11 + 9, gen * 5 + 2));
      let dir = normalize(h1 * 2.0 - 1.0 + vec3f(1e-4));
      let rad = (0.14 + pow(h2.x, 0.55) * 0.38);
      let mid = bagC + dir * rad;
      let sepDir = normalize(h2 * 2.0 - 1.0 + vec3f(1e-4));
      let sep = 0.028 * sin(life * qPI);
      let pa = mid + sepDir * sep;
      let pb = mid - sepDir * sep;
      let pairCol = select(select(cRose, cSage, h1.y > 0.33), cSlate, h1.y > 0.66);
      let antiCol = mix(vec3f(0.88, 0.90, 0.96), vec3f(1.0) - pairCol * 0.32, 0.5);

      let sa = -dot(roP - pa, rd);
      if (sa > 0.02) {
        let da = length((roP - pa) + rd * sa);
        let rS = max(0.011, sa * px * 1.6);
        col += pairCol * exp(-min((da * da) / (rS * rS), 32.0)) * 0.55 * env2 * seaFade;
      }
      let sb = -dot(roP - pb, rd);
      if (sb > 0.02) {
        let db = length((roP - pb) + rd * sb);
        let rS = max(0.011, sb * px * 1.6);
        col += antiCol * exp(-min((db * db) / (rS * rS), 32.0)) * 0.55 * env2 * seaFade;
      }
    }
  }

  return col * wStage;
}

// ---------------------------------------------------------------- Stage 6: Point-like Quark (L -15.85 -> -18.8)
// Point-like singularity of dusty-rose / pearl light surrounded by silky, broad polarized
// vacuum wisps (full-screen log-periodic parallax — zero sphere borders, zero discontinuities).

fn qStage6Quark(ro: vec3f, rd: vec3f, L: f32, t: f32, px: f32) -> vec3f {
  let wStage = qWindow(L, -18.90, -17.80, -16.20, -15.75);
  if (wStage < 1e-4) { return vec3f(0.0); }

  let s0 = -dot(ro, rd);
  let imp = sqrt(max(dot(ro, ro) - s0 * s0, 0.0));
  let forward = qRamp(-0.2, 0.3, s0);

  var col = vec3f(0.0);

  // 1. Point-like luminous core at the origin
  let coreFade = 1.0 - qRamp(-17.35, -18.60, L);
  if (coreFade > 1e-4 && forward > 1e-4) {
    let foot = max(s0 * px, 1e-4);
    let rPin = max(0.018, foot * 2.2);
    let pin = exp(-min((imp * imp) / (rPin * rPin), 40.0));
    let lorentz = 1.0 / (1.0 + (imp * imp) / (0.044 * 0.044));
    let aureole = exp(-min(imp / 0.18, 25.0));

    let breath = 0.93 + 0.07 * sin(t * 2.1);
    let cCore = vec3f(1.00, 0.94, 0.90);
    let cRose = vec3f(0.86, 0.52, 0.57);
    let cMist = vec3f(0.54, 0.62, 0.82);

    col += (cCore * pin * 2.15 + cRose * lorentz * 0.54 + cMist * aureole * 0.16) * breath * coreFade * forward;
  }

  // 2. Broad, silky polarized-vacuum ribbons swirling softly around the quark
  let zAx = normalize(-ro);
  let rz = max(dot(rd, zAx), 0.15);
  let pPlane = ro + rd * (1.0 / rz);
  let radialEnv = exp(-imp * 1.55) * 0.85 + 0.15;

  let dL: f32 = 0.85;
  let u = -L / dL;
  let k0 = i32(floor(u));
  let f = fract(u);
  // j in [-1, 2] => x = j - f in (-2, +2], exact zero-endpoint window (x + 2) / 4!
  for (var j: i32 = -1; j <= 2; j++) {
    let x = f32(j) - f;
    let sw = sin(clamp((x + 2.0) * 0.25, 0.0, 1.0) * qPI);
    let sw2 = sw * sw;
    if (sw2 < 1e-3) { continue; }
    let scL = pow(10.0, x * dL) * 0.85;
    let q = qLayerRot(k0 + j + 200) * (pPlane * scL);
    let footL = px * scL;
    let loMask = 1.0 - qRamp(0.18, 0.55, footL);
    let hiMask = 1.0 - qRamp(0.06, 0.22, footL);
    let n1 = qVNoise3(q * 1.35 + vec3f(t * 0.14, -t * 0.11, t * 0.08));
    let n2 = qVNoise3(q * 2.80 - vec3f(t * 0.17, t * 0.12, -t * 0.09)) * hiMask;
    let veil = pow(exp(-abs(n1 + n2 * 0.40) * 6.8), 1.55);
    let tint = mix(vec3f(0.84, 0.54, 0.58), vec3f(0.54, 0.65, 0.86), n1 * 0.5 + 0.5);
    col += tint * veil * 0.11 * sw2 * loMask * radialEnv;
  }

  return col * wStage;
}

// ---------------------------------------------------------------- Stage 7: The Desert — 14 Decades (L -17.5 -> -32.8)
// Sweeping, gossamer log-periodic 3D parallax vacuum-fluctuation fields flowing seamlessly
// across 14 decades. Subtle muted force-echo hues merge slowly into pale white-gold by L ~ -32.

fn qStage7Desert(ro: vec3f, rd: vec3f, L: f32, t: f32, px: f32) -> vec3f {
  let wStage = qWindow(L, -33.00, -31.85, -18.50, -17.40);
  if (wStage < 1e-4) { return vec3f(0.0); }

  let unify = qRamp(-18.0, -32.0, L);
  let cGold  = vec3f(0.98, 0.90, 0.72);
  let cPearl = vec3f(0.92, 0.90, 0.86);

  // Subtle muted force-echo hues slowly unifying into serene pale white-gold
  let cF0 = mix(vec3f(0.76, 0.50, 0.58), cGold,  unify);
  let cF1 = mix(vec3f(0.46, 0.62, 0.86), cPearl, unify);
  let cF2 = mix(vec3f(0.46, 0.68, 0.66), cGold,  unify);

  let zAx = normalize(-ro);
  let rz = max(dot(rd, zAx), 0.12);
  let s0 = max(-dot(ro, rd), 0.0);
  let imp = sqrt(max(dot(ro, ro) - s0 * s0, 0.0));
  // Subtle depth framing so corners stay deep velvet dark while gossamer fields shine across the view
  let frameEnv = 0.52 + 0.48 * exp(-imp * 1.45);

  let dL: f32 = 0.85;
  let u = -L / dL;
  let k0 = i32(floor(u));
  let f = fract(u);

  var col = vec3f(0.0);

  // j in [-1, 2] => x = j - f in (-2, +2], exact zero-endpoint window (x + 2) / 4!
  for (var j: i32 = -1; j <= 2; j++) {
    let k = k0 + j;
    let x = f32(j) - f;
    let normX = clamp((x + 2.0) * 0.25, 0.0, 1.0);
    let sw = sin(normX * qPI);
    let weight = sw * sw;
    if (weight < 1e-3) { continue; }

    let hDepth = qHash31(vec3i(k, 73, 19));
    let sPlane = (0.72 + 0.56 * hDepth) / rz;
    let pWorld = ro + rd * sPlane;

    // Broad, sweeping gossamer spatial scale (calm, luminous, poetic — never noisy static!)
    let scL = pow(10.0, x * dL) * 0.82;
    let rot = qLayerRot(k + 500);
    let q = rot * (pWorld * scL);

    let footL = sPlane * px * scL;
    let loMask = 1.0 - qRamp(0.18, 0.55, footL);
    if (loMask < 1e-3) { continue; }
    let hiMask = 1.0 - qRamp(0.06, 0.22, footL);

    let phase = t * 0.14 + f32(k & 31) * 0.71;
    let n1 = qVNoise3(q * 1.20 + vec3f(phase, -phase * 0.7, phase * 0.5));
    let n2 = qVNoise3(q * 2.55 - vec3f(phase * 0.8, phase * 0.6, -phase * 0.9)) * hiMask;

    // Large-scale patchiness lets luminous currents float over wide stretches of deep velvet dark
    let patchEnv = qRamp(-0.20, 0.55, n1 + n2 * 0.35);
    let ribbon = pow(exp(-abs(n1 + n2 * 0.42) * 8.6), 2.0);
    let fineArc = pow(exp(-abs(n1 - n2 * 0.58) * 12.5), 1.8) * 0.46;

    let hPick = fract(f32(k) * 0.6180339 + n1 * 0.18);
    var tint = mix(cF0, cF1, qRamp(0.15, 0.55, hPick));
    tint = mix(tint, cF2, qRamp(0.60, 0.92, hPick));

    let uniLift = mix(0.95, 1.22, unify);
    let stream = (ribbon * 0.13 + fineArc * 0.075) * (0.28 + 0.72 * patchEnv);
    col += tint * stream * weight * loMask * frameEnv * uniLift;
  }

  // Quiet luminous central potential anchor
  let centerGlow = exp(-imp * 3.4) * 0.028 * mix(0.9, 1.7, unify);
  col += mix(cF1, cGold, 0.5 + 0.5 * unify) * centerGlow;

  return col * wStage;
}

// ---------------------------------------------------------------- Stage 8: Quantum Foam at Planck Scale (L -31.8 -> -35.8)
// Planck length = 1.616e-35 m (L_planck = -34.79).
// 3 full-screen log-periodic 3D cellular parallax layers (100% temporally smooth — zero pops!).
// Deep velvet voids inside shifting bubbles, luminous champagne-gold & ice-silver membranes;
// at L = -34.8 cells are large (~size of the view) with nested smaller froth visible behind them!

fn qStage8Foam(ro: vec3f, rd: vec3f, L: f32, t: f32, px: f32) -> vec3f {
  let wStage = qWindow(L, -36.05, -35.10, -32.75, -31.75);
  if (wStage < 1e-4) { return vec3f(0.0); }

  let planckness = qRamp(-31.9, -34.79, L);

  let zAx = normalize(-ro);
  let rz = max(dot(rd, zAx), 0.12);

  // 3 log-periodic cellular layers: j in [-1, 1] => x = j - f in (-2, +1], width 3.0!
  // Window sin((x + 2) / 3 * PI)^2 is EXACTLY 0 at BOTH endpoints (-2 and +1) -> ZERO popping!
  let dL: f32 = 0.85;
  let u = (-34.79 - L) / dL;
  let k0 = i32(floor(u));
  let f = fract(u);

  let cWallWarm = vec3f(1.00, 0.90, 0.72); // champagne-gold spacetime membranes
  let cWallCool = vec3f(0.66, 0.82, 1.00); // pearlescent ice-silver iridescence

  var col = vec3f(0.0);

  for (var j: i32 = -1; j <= 1; j++) {
    let k = k0 + j;
    let x = f32(j) - f; // (-2.0, +1.0]
    let normX = clamp((x + 2.0) / 3.0, 0.0, 1.0);
    let sw = sin(normX * qPI);
    let weight = sw * sw;
    if (weight < 1e-3) { continue; }

    let hDepth = qHash31(vec3i(k, 41, 89));
    let sPlane = (0.78 + 0.44 * hDepth) / rz;
    let pWorld = ro + rd * sPlane;

    // At L=-32 (fine emerging froth): ~6 bubbles across view.
    // At L=-34.8 (Planck length): ~2-4 large curving spacetime bubbles with deep dark hollows!
    let baseFreq = mix(2.25, 1.28, planckness);
    let scL = pow(10.0, x * dL) * baseFreq;
    let rot = qLayerRot(k + 900);
    let q0 = rot * (pWorld * scL);
    // Gentle organic domain warp turns polygonal Voronoi walls into curved liquid-light bubbles!
    let tP = t * 0.36 + f32(k & 15) * 0.8;
    let q = q0 + 0.16 * vec3f(
      sin(q0.y * 2.1 + tP),
      sin(q0.z * 2.1 - tP * 0.85),
      sin(q0.x * 2.1 + tP * 0.92)
    );

    let cellPx = sPlane * px * scL;
    let loMask = 1.0 - qRamp(0.20, 0.60, cellPx);
    if (loMask < 1e-3) { continue; }
    // Keep foreground giant-cell membranes crisp in view space so they never wash into milky fog!
    let wallCellW = max(min(0.048, 0.028 * scL), cellPx * 2.1);
    let sharp = clamp(1.0 / max(wallCellW, 0.004), 4.0, 160.0);

    let cell = qCell8(q, tP);
    let d1 = cell.x;
    let edge = cell.y; // 0 right on bubble membrane walls
    let cid = cell.z;

    // Crisp luminous curved membranes over deep velvety midnight-indigo bubble hollows
    let membrane = exp(-edge * sharp);
    let caustic = pow(membrane, 2.2) * 0.68 + membrane * 0.18;
    let softHalo = exp(-edge * (sharp * 0.65)) * 0.018;

    let irid = 0.5 + 0.5 * sin(cid * qTAU + d1 * 4.5 + t * 0.32);
    let wallCol = mix(cWallWarm, cWallCool, irid * 0.48);

    let scaleGain = mix(0.42, 0.72, planckness);
    col += wallCol * (caustic + softHalo) * weight * loMask * scaleGain;
  }

  // Luminous golden-ivory heart awakening gently at the center as Planck opens into Infinity (-34.65 -> -35.65)
  let openInf = qRamp(-34.65, -35.65, L);
  if (openInf > 1e-4) {
    let s0 = max(-dot(ro, rd), 0.0);
    let imp = sqrt(max(dot(ro, ro) - s0 * s0, 0.0));
    let heart = exp(-imp * 4.2) * 0.38 + exp(-imp * 1.6) * 0.05;
    col += vec3f(1.00, 0.93, 0.80) * heart * openInf;
  }

  return col * wStage;
}

// ---------------------------------------------------------------- Stage 9: Beyond Planck — Infinity (L -34.9 -> -40.35)
// Endless self-similar cathedral tunnel of light — every scale at once, woven caustic shells,
// inward-rushing rings and streaming radial beams converging continuously into the newborn ball's
// birth without ever collapsing into a flat blank white frame.

fn qStage9Infinity(ro: vec3f, rd: vec3f, L: f32, t: f32, px: f32) -> vec3f {
  let wIn = qRamp(-34.85, -35.75, L);
  let wOut = 1.0 - qRamp(-39.96, -40.28, L);
  let wStage = wIn * wOut;
  if (wStage < 1e-4) { return vec3f(0.0); }

  let rise = qRamp(-35.0, -40.0, L);
  let crescendo = qSmooth5(-38.55, -40.0, L);
  // Past -39.95, light contracts rapidly toward the newborn sphere's radius so it gathers cleanly into Stage 10
  let gather = qSmooth5(-39.95, -40.28, L);

  let zAx = normalize(-ro);
  let refUp = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(zAx.y) > 0.9);
  let xAx = normalize(cross(refUp, zAx));
  let yAx = cross(zAx, xAx);

  let rz = dot(rd, zAx);
  let rx = dot(rd, xAx);
  let ry = dot(rd, yAx);
  let rad = max(length(vec2f(rx, ry)), 1e-4);
  let ang = atan2(ry, rx);

  let logR = log2(rad);

  // Two inward-rushing log-scale harmonics ("every scale at once" converging into the center)
  let flowA = logR * 1.45 - L * 1.70 + t * 0.55;
  let flowB = logR * 2.90 - L * 2.55 + t * 0.90;

  let dirP = vec2f(cos(ang), sin(ang));
  // Continuous 3D noise coordinates (zero fract wrap pops!)
  let w1 = qVNoise3(vec3f(dirP * 1.85, flowA * 0.42));
  let w2 = qVNoise3(vec3f(dirP * 3.30, flowB * 0.28 + t * 0.08));

  let centerAA = qRamp(px * 3.5, px * 28.0, rad);

  // Sculpted high-contrast inward-rushing caustic rings over deep luminous golden-twilight valleys
  let rA = 0.5 + 0.5 * cos((flowA + w1 * 0.34) * qTAU);
  let ringA = pow(rA, 7.5) * centerAA + (1.0 - centerAA) * 0.20;

  let rB = 0.5 + 0.5 * cos((flowB + w2 * 0.40) * qTAU);
  let ringB = pow(rB, 9.0) * centerAA + (1.0 - centerAA) * 0.12;

  // Streaming radial light shafts rushing inward toward the center (strongest through the climax -39 -> -40.2!)
  let rayZ1 = logR * 0.85 - L * 2.10 + t * 0.80;
  let rayZ2 = logR * 1.55 - L * 3.20 + t * 1.15;
  let beam1 = qVNoise3(vec3f(dirP * 3.2, rayZ1));
  let beam2 = qVNoise3(vec3f(vec2f(-dirP.y, dirP.x) * 6.0, rayZ2));
  let beams = pow(max(beam1 * 0.5 + 0.5, 0.0), 3.4) * 0.78
            + pow(max(beam2 * 0.5 + 0.5, 0.0), 4.2) * 0.65;
  let spokeStreaks = pow(max(0.5 + 0.5 * sin(ang * 12.0 + w1 * 2.4 - t * 0.4), 0.0), 5.5)
                   * (0.50 + 0.50 * cos((logR * 1.6 - L * 2.8 + t * 1.1) * qTAU));

  let wallDecay = mix(mix(2.55, 0.95, crescendo), 4.2, gather);
  let wallFall = exp(-rad * wallDecay);
  let heartTight = mix(mix(125.0, 34.0, crescendo), 82.0, gather);
  let heart = 1.0 / (1.0 + rad * rad * heartTight);

  let cWarm  = vec3f(1.00, 0.82, 0.52);
  let cIvory = vec3f(1.00, 0.95, 0.84);
  let cCool  = vec3f(0.48, 0.68, 1.00);
  let cGold  = vec3f(1.00, 0.66, 0.28);

  // Keep vivid high-contrast structure all the way into the ball's birth (bloom provides the glow!)
  let ringPower = (ringA * 0.90 + ringB * 0.48) * (0.16 + 1.15 * beams) * wallFall;
  let rayPower  = (beams * 0.45 + spokeStreaks * 0.62) * exp(-rad * mix(1.75, 3.8, gather)) * mix(0.22, 1.00, crescendo);

  let ringTint = mix(cCool, cWarm, 0.45 + 0.55 * rise);
  var col = ringTint * ringPower * mix(0.72, 1.28, rise);
  col += mix(cGold, cIvory, 0.42 + 0.42 * crescendo) * rayPower * mix(0.45, 0.95, crescendo);
  col += mix(cWarm, cIvory, 0.40 + 0.50 * rise) * heart * mix(0.88, 1.48, crescendo) * (1.0 - 0.35 * gather);

  // Modest warm golden valley floor (deep enough that rushing rings/beams stay razor-clear under AgX + bloom)
  let valley = (pow(rise, 3.5) * 0.020 + crescendo * 0.055) * exp(-rad * mix(1.35, 4.2, gather));
  col += mix(cGold, cWarm, 0.40 + 0.40 * crescendo) * valley;

  let fwdMask = qRamp(-0.25, 0.15, rz);
  return col * fwdMask * wStage;
}

// ---------------------------------------------------------------- Stage 10: Newborn Universe -> CMB Ball (L -40 -> -41)
// Exact CMB color ramp matching Universe's c_web.wgsl (`cmbColor`).

fn qCmbColor(v: f32) -> vec3f {
  let x = clamp(v * 0.5 + 0.5, 0.0, 1.0) * 4.0;
  var c = mix(vec3f(0.06, 0.08, 0.42), vec3f(0.10, 0.42, 0.72), clamp(x, 0.0, 1.0));
  c = mix(c, vec3f(0.30, 0.32, 0.40), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, vec3f(0.95, 0.58, 0.20), clamp(x - 2.0, 0.0, 1.0));
  return mix(c, vec3f(1.00, 0.90, 0.62), clamp(x - 3.0, 0.0, 1.0));
}

fn qCmbMap(n: vec3f, foot: f32) -> f32 {
  let rot1 = mat3x3f(
    vec3f( 0.95519,  0.20465,  0.21384),
    vec3f(-0.29213,  0.76808,  0.56983),
    vec3f(-0.04763, -0.60677,  0.79345)
  );
  let rot2 = mat3x3f(
    vec3f( 0.64729, -0.54122, -0.53674),
    vec3f( 0.76185,  0.48182,  0.43293),
    vec3f( 0.02430, -0.68915,  0.72421)
  );
  let m1 = rot1 * n;
  let m2 = rot2 * m1;
  let f2 = 1.0 - qRamp(0.015, 0.055, foot);
  let f3 = 1.0 - qRamp(0.006, 0.025, foot);
  let v1 = qVNoise3(n * 4.8);
  let v2 = qVNoise3(m1 * 13.5 + vec3f(3.7)) * f2;
  let v3 = qVNoise3(m2 * 32.0 - vec3f(2.1)) * f3;
  return (v1 * 0.48 + v2 * 0.34 + v3 * 0.18) * 1.45;
}

fn qStage10Seam(ro: vec3f, rd: vec3f, L: f32, t: f32, px: f32, ballR: f32) -> vec3f {
  if (L > -39.65) { return vec3f(0.0); }
  let cool = qRamp(-40.0, -41.0, L);
  let birthIn = qRamp(-39.75, -40.04, L);

  let b = dot(ro, rd);
  let imp2 = max(dot(ro, ro) - b * b, 0.0);
  let imp = sqrt(imp2);

  var col = vec3f(0.0);

  // Structured inward-gathering golden rays pulling swiftly into the newborn sphere (-40.0 -> -40.34)
  let outFade = (1.0 - qSmooth5(0.0, 0.34, cool)) * birthIn;
  if (outFade > 1e-4) {
    let effR = max(ballR, 0.16);
    let outside = max(imp - effR * 0.88, 0.0);
    let zAx = normalize(-ro);
    let refUp = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(zAx.y) > 0.9);
    let xAx = normalize(cross(refUp, zAx));
    let yAx = cross(zAx, xAx);
    let rx = dot(rd, xAx);
    let ry = dot(rd, yAx);
    let rad = max(length(vec2f(rx, ry)), 1e-4);
    let dirP = vec2f(rx, ry) / rad;
    let rayN = qVNoise3(vec3f(dirP * 4.2, log2(rad) * 1.2 - L * 2.5 + t * 0.9));
    let streaks = 0.12 + 0.88 * pow(max(rayN * 0.5 + 0.5, 0.0), 2.8);
    let gather = exp(-outside * mix(3.8, 16.5, cool));
    let outTint = mix(vec3f(1.00, 0.82, 0.52), vec3f(0.95, 0.54, 0.20), cool * 1.5);
    col += outTint * gather * streaks * 0.72 * outFade;
  }

  if (ballR > 0.0005) {
    let R = ballR;
    let Ri = R * 0.972;
    let h = qSphereHit(ro, rd, vec3f(0.0), R);

    let haloDist = max(imp - R, 0.0);
    let haloWidth = R * mix(0.22, 0.032, qRamp(0.0, 0.85, cool));
    let halo = exp(-haloDist / max(haloWidth, 1e-4)) * select(0.0, 1.0, imp > R && b < 0.0);
    let haloCol = mix(
      vec3f(1.00, 0.84, 0.54),
      mix(vec3f(0.12, 0.35, 1.0), vec3f(1.0, 0.42, 0.12), 0.45),
      qRamp(0.25, 0.95, cool)
    );
    col += haloCol * halo * mix(0.92, 0.16, qRamp(0.0, 0.90, cool)) * birthIn;

    if (h.y > 0.0) {
      let side = (sqrt(max(R * R - imp2, 0.0)) - sqrt(max(Ri * Ri - imp2, 0.0))) / max(R - Ri, 1e-5);
      let limbAA = 1.0 - qRamp(R - px * 1.5, R + px * 0.5, imp);
      var shellCol = vec3f(0.0);

      let ang = t * 0.03;
      let ca = cos(ang); let sa = sin(ang);
      let rotS = mat3x3f(vec3f(ca, 0.0, sa), vec3f(0.0, 1.0, 0.0), vec3f(-sa, 0.0, ca));

      for (var k: i32 = 0; k < 2; k++) {
        let sHit = select(h.x, h.y, k == 1);
        if (sHit < 0.0) { continue; }
        let n = rotS * normalize(ro + rd * sHit);
        let v = qCmbMap(n, (sHit * px) / R);

        let cmbC  = qCmbColor(v) * (0.55 + 0.85 * abs(v));
        let goldC = mix(vec3f(0.90, 0.44, 0.12), vec3f(1.00, 0.88, 0.56), clamp(v * 0.5 + 0.5, 0.0, 1.0));
        let hotC  = vec3f(1.00, 0.96, 0.88) * (0.94 + 0.06 * v);

        var c = mix(hotC, goldC, qRamp(0.05, 0.48, cool));
        c = mix(c, cmbC, qRamp(0.42, 0.94, cool));

        let sideW = select(0.72, 0.28, k == 1);
        shellCol += c * sideW;
      }

      let shellGain = mix(1.15, 0.060, qSmooth5(0.0, 1.0, cool));
      let geom = mix(1.0 + 0.30 * min(side, 3.5), min(side, 7.2), qRamp(0.18, 0.88, cool));
      let ballLight = shellCol * geom * shellGain * limbAA * birthIn;

      let occ = limbAA * qRamp(0.12, 0.65, cool);
      col = col * (1.0 - occ * 0.90) + ballLight;
    }
  }

  return col;
}

// ---------------------------------------------------------------- Public Entry Point

// premultiplied linear-HDR rgba; .a = coverage over whatever is behind (the cell's DNA)
fn qWorld(ro: vec3f, rd: vec3f, L: f32, t: f32, px: f32, pix: vec2f, ballR: f32) -> vec4f {
  if (L >= -8.59) { return vec4f(0.0); }

  // Deep velvety blue-black background (~0.002-0.005 linear); full-screen alpha = 1.0 by L = -9.45
  let bgAlpha = qRamp(-9.12, -9.45, L);
  let bgBlackout = 1.0 - qRamp(-40.0, -40.55, L);

  let s0 = max(-dot(ro, rd), 0.0);
  let imp = sqrt(max(dot(ro, ro) - s0 * s0, 0.0));
  let bgGrad = mix(vec3f(0.0020, 0.0044, 0.0080), vec3f(0.0010, 0.0020, 0.0040), clamp(imp * 1.15, 0.0, 1.0));
  let bgDeep = mix(bgGrad, mix(vec3f(0.0026, 0.0038, 0.0076), vec3f(0.0010, 0.0016, 0.0034), clamp(imp * 1.15, 0.0, 1.0)), qRamp(-9.4, -10.2, L));
  let bgWarm = mix(bgDeep, vec3f(0.0048, 0.0038, 0.0026), qWindow(L, -40.1, -39.2, -35.2, -33.0) * 0.65);
  let bgCol = bgWarm * bgBlackout;

  // Stage 1: Bead resolving into nucleotide atoms
  let s1 = qStage1Atoms(ro, rd, L, t, px);

  var rgb = s1.rgb + bgCol * bgAlpha * (1.0 - s1.a);
  var alpha = s1.a + bgAlpha * (1.0 - s1.a);

  // Additive / volumetric deeper stages (strict L bounds -> only 1-2 active per frame)
  if (L < -9.32 && L > -11.50) {
    let s2 = qStage2Orbitals(ro, rd, L, t, px);
    rgb += s2;
    alpha = max(alpha, clamp(dot(s2, vec3f(0.3, 0.6, 0.1)) * 1.4, 0.0, 1.0));
  }
  if (L < -10.22 && L > -14.40) {
    rgb += qStage3Void(ro, rd, L, t, px);
  }
  if (L < -13.60 && L > -15.12) {
    rgb += qStage4Nucleus(ro, rd, L, t, px);
  }
  if (L < -14.72 && L > -16.52) {
    rgb += qStage5Proton(ro, rd, L, t, px);
  }
  if (L < -15.72 && L > -18.95) {
    rgb += qStage6Quark(ro, rd, L, t, px);
  }
  if (L < -17.35 && L > -33.05) {
    rgb += qStage7Desert(ro, rd, L, t, px);
  }
  if (L < -31.70 && L > -36.10) {
    rgb += qStage8Foam(ro, rd, L, t, px);
  }
  if (L < -34.80 && L > -40.48) {
    rgb += qStage9Infinity(ro, rd, L, t, px);
  }
  if (L < -39.62) {
    rgb += qStage10Seam(ro, rd, L, t, px, ballR);
  }

  // Imperceptible linear dither in the deep darks using `pix`
  let dither = (fract(52.9829189 * fract(dot(pix, vec2f(0.06711056, 0.00583715)))) - 0.5) * 0.00018;
  rgb = max(rgb + vec3f(dither) * alpha * bgBlackout, vec3f(0.0));

  return vec4f(rgb, clamp(alpha, 0.0, 1.0));
}
