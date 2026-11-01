// The Earth's air (kilometres, the planet's centre at `c`): Rayleigh scattering (the blue of the sky, the red of a
// sunset) and Mie (the haze round the Sun), single scattering marched along the view ray with a shorter march toward
// the Sun from each sample. Returns the light scattered toward the eye and the transmittance along the ray.
const RP = 6371.0;
const RA = 6471.0;
const BETA_R = vec3f(5.8e-3, 13.5e-3, 33.1e-3);   // per km
const BETA_M = 12e-3;
const H_R = 8.0;
const H_M = 1.2;
const G_M = 0.76;

struct Air { light: vec3f, trans: vec3f }

// the air between the eye and the land: a little clearer than the sky's own (a dry Colorado day), so the land seen
// from high up keeps its colour under the haze
const HAZE = 0.7;
fn overLand(c: vec3f, a: Air) -> vec3f { return c * pow(a.trans, vec3f(HAZE)) + a.light * HAZE; }

fn raySphere(ro: vec3f, rd: vec3f, c: vec3f, r: f32) -> vec2f {
  let oc = ro - c;
  let b = dot(oc, rd);
  let h = b * b - (dot(oc, oc) - r * r);
  if (h < 0.0) { return vec2f(1e9, -1e9); }
  let s = sqrt(h);
  return vec2f(-b - s, -b + s);
}

fn air(ro: vec3f, rd: vec3f, tMax: f32, c: vec3f, sun: vec3f, sunI: f32, steps: i32) -> Air {
  var o: Air; o.light = vec3f(0.0); o.trans = vec3f(1.0);
  let ha = raySphere(ro, rd, c, RA);
  let hg = raySphere(ro, rd, c, RP);
  let t0 = max(ha.x, 0.0);
  // (no further than the ground)
  var t1 = min(ha.y, tMax);
  if (hg.x > 0.0 && hg.x < 1e8) { t1 = min(t1, hg.x); }
  if (t1 <= t0) { return o; }
  let dt = (t1 - t0) / f32(steps);
  var odR = 0.0; var odM = 0.0;
  var sumR = vec3f(0.0); var sumM = vec3f(0.0);
  for (var i = 0; i < steps; i++) {
    let p = ro + rd * (t0 + (f32(i) + 0.5) * dt);
    let hgt = max(length(p - c) - RP, 0.0);
    let dR = exp(-hgt / H_R) * dt; let dM = exp(-hgt / H_M) * dt;
    odR += dR; odM += dM;
    // toward the Sun: through the air, unless the planet's in the way
    let ls = raySphere(p, sun, c, RA);
    let lp = raySphere(p, sun, c, RP);
    if (lp.x > 0.0 && lp.x < 1e8) { continue; }
    let ldt = ls.y / 6.0;
    var lR = 0.0; var lM = 0.0;
    for (var j = 0; j < 6; j++) {
      let q = p + sun * ((f32(j) + 0.5) * ldt);
      let hq = max(length(q - c) - RP, 0.0);
      lR += exp(-hq / H_R) * ldt; lM += exp(-hq / H_M) * ldt;
    }
    let tau = BETA_R * (odR + lR) + BETA_M * 1.1 * (odM + lM);
    let att = exp(-tau);
    sumR += att * dR; sumM += att * dM;
  }
  let mu = dot(rd, sun);
  let pR = 3.0 / (16.0 * 3.14159) * (1.0 + mu * mu);
  let g2 = G_M * G_M;
  let pM = 3.0 / (8.0 * 3.14159) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * G_M * mu, 1.5));
  o.light = sunI * (sumR * BETA_R * pR + sumM * BETA_M * pM);
  o.trans = exp(-(BETA_R * odR + BETA_M * 1.1 * odM));
  return o;
}

// sunlight reaching a point (km, relative to the centre): reddened by the air on the way
fn sunlightAt(p: vec3f, c: vec3f, sun: vec3f) -> vec3f {
  let lp = raySphere(p, sun, c, RP - 0.5);
  if (lp.x > 0.0 && lp.x < 1e8) { return vec3f(0.0); }
  let ls = raySphere(p, sun, c, RA);
  let ldt = ls.y / 8.0;
  var lR = 0.0; var lM = 0.0;
  for (var j = 0; j < 8; j++) {
    let q = p + sun * ((f32(j) + 0.5) * ldt);
    let hq = max(length(q - c) - RP, 0.0);
    lR += exp(-hq / H_R) * ldt; lM += exp(-hq / H_M) * ldt;
  }
  return exp(-(BETA_R * lR + BETA_M * 1.1 * lM));
}
