// The edge of the observable universe: the cosmic microwave background, the light of the last-scattering surface
// 14 billion parsecs away, as a thin glowing shell, seen from outside it as a sphere at the top of the zoom and as a
// faint wall from within. Its pattern is Planck's (the 2015 SMICA map, ±500 µK, in galactic coordinates: levels/web.ts
// loads it the first time the web shows) in a false colour of our own, cold deep blue through a dim slate to warm gold;
// the baked value noise stands in till it's in. L.b.x: its radius (Mpc), y how bright (fainter past the edge,
// levels/web.ts).
#include "cosmos.wgsl"
#include "noisetex.wgsl"
#include "weft/fullscreen"

// Planck's map (one channel: (byte − 127.5) / 127.5 × 500 µK), plate carrée in galactic coordinates: u = (180 − l) / 360,
// v = (90 − b) / 180
@group(2) @binding(6) var cmbTex: texture_2d<f32>;
// the real density of the nearest 200 Mpc (2MRS, data/galaxies/density.bin; its light the square of its log above D.m.x,
// so the knots and walls stand out of the haze): 128³ over a 400 Mpc box round the Sun in
// equatorial axes, log10(ρ / mean) from −1 to 1.5 over 1/255..1 (0: outside the sphere)
@group(2) @binding(5) var densTex: texture_3d<f32>;
// the catalogues' axes (levels/deepsky.ts SkyAxes): the cosmos frame to heliocentric equatorial Mpc (rows, w the
// translation) and to the galaxy's axes; k: x the density's share (0 till it's in), y the map's, z the real web's
// gain, w the fraction of the frame's resolution the volume is drawn at; m: x the log density where the web's light
// starts, y the shell over which the real web hands over to the noise (Mpc, its inner radius), z its outer
struct Deep { ex: vec4f, ey: vec4f, ez: vec4f, gx: vec4f, gy: vec4f, gz: vec4f, k: vec4f, m: vec4f }
@group(2) @binding(7) var<uniform> D: Deep;

// (the baked noise's lattices turned, so its period, 16, never lines up across the sky)
const ROT_SKY = mat3x3f(vec3f(0.95519, 0.20465, 0.21384), vec3f(-0.29213, 0.76808, 0.56983), vec3f(-0.04763, -0.60677, 0.79345));

// the microwave sky in the direction n (the cosmos frame), as a temperature over 300 µK; `foot` the angle (rad) a pixel
// of the march covers there, for the map's level
fn cmb(n: vec3f, foot: f32) -> f32 {
  if (D.k.y > 0.0) {
    let g = vec3f(dot(D.gx.xyz, n), dot(D.gy.xyz, n), dot(D.gz.xyz, n));
    let l = atan2(g.z, -g.x);
    let b = asin(clamp(g.y, -1.0, 1.0));
    let uv = vec2f(fract(0.5 - l / (2.0 * PI)), 0.5 - b / PI);
    let lod = max(log2(foot * f32(textureDimensions(cmbTex).x) / (2.0 * PI)), 0.0);
    let s = textureSampleLevel(cmbTex, samp_repeat, uv, lod).r;
    let real = (s * 255.0 - 127.5) / 127.5 * (500.0 / 300.0);
    // (the noise faded out as the map fades in)
    if (D.k.y >= 1.0) { return real; }
    return mix(noiseSky(n), real, D.k.y);
  }
  return noiseSky(n);
}
// the stand-in: value noise at a few sizes (baked)
fn noiseSky(n: vec3f) -> f32 {
  let m = ROT_SKY * n;
  return valTap(n * 9.0).g * 0.45 + valTap(m * 34.0 + 4.0).a * 0.35 + valTap(ROT_SKY * m * 120.0).b * 0.2;
}
// the false colour: cold deep blue, through teal and a dim slate at the mean, to amber and a pale warm gold
fn cmbColor(v: f32) -> vec3f {
  // (a chain of mixes, not an indexed table: a table indexed per pixel goes through memory on some GPUs)
  let x = clamp(v * 0.5 + 0.5, 0.0, 1.0) * 4.0;
  var c = mix(vec3f(0.06, 0.08, 0.42), vec3f(0.1, 0.42, 0.72), clamp(x, 0.0, 1.0));
  c = mix(c, vec3f(0.3, 0.32, 0.4), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, vec3f(0.95, 0.58, 0.2), clamp(x - 2.0, 0.0, 1.0));
  return mix(c, vec3f(1.0, 0.9, 0.62), clamp(x - 3.0, 0.0, 1.0));
}

@fragment fn fs_cmb(in: FullscreenOut) -> @location(0) vec4f {
  let rd = rayDir(in.uv);
  let ro = L.eye + L.origin;
  let R = L.b.x;
  // a shell of light (thin: a few per cent of its radius): each side glows by the length of it the ray crosses, so it
  // is faint face-on and bright round its rim, and the far side shows through the near one
  let Ri = R * 0.975;
  let b = dot(ro, rd);
  let imp2 = max(dot(ro, ro) - b * b, 0.0);
  let side = (sqrt(max(R * R - imp2, 0.0)) - sqrt(max(Ri * Ri - imp2, 0.0))) / (R - Ri);
  // (and a soft halo just outside it)
  let halo = exp(-max(sqrt(imp2) - R, 0.0) / (R * 0.025)) * select(0.0, 0.5, imp2 > R * R && b < 0.0);
  let h = sphereHit(ro, rd, vec3f(0.0), R);
  var c = vec3f(0.0);
  let warm = vec3f(1.0, 0.42, 0.12);
  let cool = vec3f(0.12, 0.35, 1.0);
  if (h.y > 0.0) {
    // the front and the back of the shell (from inside, only the back)
    for (var k = 0; k < 2; k++) {
      let t = select(h.x, h.y, k == 1);
      if (t < 0.0) { continue; }
      let n = normalize(ro + rd * t);
      let v = cmb(n, t * L.pxAngle / max(D.k.w, 0.1) / R);
      let col = cmbColor(v) * (0.55 + 0.9 * abs(v));
      // (the near side fading in as it falls behind the camera that's just left the shell: no flash as it crosses)
      c += col * side * select(0.25, 0.7 * ss(0.0, R * 0.08, t), k == 0);
    }
  }
  c += mix(cool, warm, 0.45) * halo * 2.0;
  // from far outside it, a little brighter; as the view comes inside, it fades to a faint wall
  let fade = ss(R * 0.02, R * 0.6, L.scale);
  return vec4f(c * 0.016 * fade * L.weight * L.b.y, 0.0);
}

// The cosmic web, marched through the sphere of the observable universe: within 200 Mpc of us the real one, the
// density of the 2MRS galaxies (levels/web.ts loads it the first time the web shows), its light the log of the density
// above the mean; beyond, filaments of galaxies where the walls between the cells of a cellular noise at two sizes (130
// and 38 Mpc) cross, knotted into clusters where they meet, round black voids. The two are blended over a shell (D.m.y
// to D.m.z) so there's no seam, and both coloured by how dense through one ramp, cool in the threads, warm in the
// knots: additive, no shadowing. Near enough to tell galaxies apart, the points take over (web.ts). L.c: gain, steps.
// the two cellular noises (one baked noise at two sizes) turned off the axes, and from each other: it repeats every 8
// cells (1 Gpc at the big size, 300 Mpc at the fine), and turned so, the repeats never line up with each other or with
// the view's axes
const ROT_BIG = mat3x3f(vec3f(0.64729, -0.54122, -0.53674), vec3f(0.76185, 0.48182, 0.43293), vec3f(0.02430, -0.68915, 0.72421));
const ROT_FINE = mat3x3f(vec3f(-0.38670, 0.05647, -0.92047), vec3f(-0.69696, 0.63573, 0.33180), vec3f(0.60391, 0.76984, -0.20648));

// (x: how much, y: how much of it is a cluster's hot gold rather than a filament's blue; `soft` >= 1 widens it, as
// dimly, where the march's steps are too long to find something so thin). A cellular noise's gaps between its nearest
// three points (noisetex.wgsl): a cell's wall where the first is small, its edge where both are.
fn gaps(p: vec3f) -> vec2f {
  // (from outside the shell, L.c.z: the smaller texture, as the samples scatter)
  if (L.c.z > 0.5) { return cellGapsH(p); }
  return cellGaps(p);
}
fn webDensity(p: vec3f, soft: f32) -> vec2f {
  let a = gaps(ROT_BIG * (p / 130.0));
  let wall = exp(-a.x * 40.0 / soft);
  // (deep in a void there's nothing to find at the finer size: skip it)
  if (wall < 0.05) { return vec2f(0.0); }
  // the great filaments along the big cells' edges; finer ones over their walls; clusters where they cross
  let big = exp(-a.y * 95.0 / soft);
  let b = gaps(ROT_FINE * (p / 38.0 + 7.3)).y;
  let fine = exp(-b * 70.0 / soft) * wall;
  let knot = big * exp(-b * 25.0 / soft);
  return vec2f(max(big * 2.0 + fine * 1.1 + knot * 14.0 + wall * 0.01 - 0.03, 0.0) / pow(soft, 1.5), ss(0.06, 0.3, knot));
}

// a point of the cosmos frame in the catalogues' heliocentric equatorial megaparsecs
fn toEq(p: vec3f) -> vec3f { return vec3f(dot(D.ex.xyz, p) + D.ex.w, dot(D.ey.xyz, p) + D.ey.w, dot(D.ez.xyz, p) + D.ez.w); }

// the web's colour by how dense (0 a faint thread, 1 a cluster's heart): cool blue, violet, amber, a hot pale gold
fn webRamp(s: f32) -> vec3f {
  let x = clamp(s, 0.0, 1.0) * 3.0;
  var c = mix(vec3f(0.38, 0.52, 1.0), vec3f(0.64, 0.5, 0.95), clamp(x, 0.0, 1.0));
  c = mix(c, vec3f(1.2, 0.7, 0.36), clamp(x - 1.0, 0.0, 1.0));
  return mix(c, vec3f(1.6, 1.2, 0.68), clamp(x - 2.0, 0.0, 1.0));
}

@fragment fn fs_vol(in: FullscreenOut) -> @location(0) vec4f {
  let rd = rayDir(in.uv);
  let ro = L.eye + L.origin;
  let R = L.b.x;
  let h = sphereHit(ro, rd, vec3f(0.0), R);
  if (h.y < 0.0) { return vec4f(0.0); }
  let t0 = max(h.x, 0.0);
  // (no further than a few view distances: beyond, every ray averages to the same grey)
  let t1 = min(h.y, t0 + 3.0 * L.scale);
  let steps = i32(L.c.y);
  let jit = marchDither(in.pos.xy);
  var col = vec3f(0.0);
  var tPrev = t0;
  // (a slow drift of the noise's threads' hue across the sky)
  let drift = vnoise((ro + rd * L.scale) / 900.0) * 0.08;
  for (var i = 0; i < steps; i++) {
    let u = (f32(i) + jit) / f32(steps);
    let t = t0 + (t1 - t0) * u * u;
    let dt = t - tPrev;
    tPrev = t;
    let p = ro + rd * t;
    // (what's about the view's distance away counts most: from inside, the walls round you, not all 14 Gpc at once)
    let q = t / (1.3 * L.scale);
    // (and a hollow round the eye: a filament the zoom flies through passes as the galaxies do, not a flood of light
    // across the frame for the few frames it's at the lens)
    let k = dt / (1.0 + q * q * q * q) * ss(0.1 * L.scale, 0.4 * L.scale, t);
    // the real web's share here: all of it inside the shell, none past it
    var w = 0.0;
    if (D.k.x > 0.0) {
      let e = toEq(p);
      w = (1.0 - ss(D.m.y, D.m.z, length(e))) * D.k.x;
      if (w > 0.0) {
        let x = (textureSampleLevel(densTex, samp_linear, e / 400.0 + 0.5, 0.0).r * 255.0 - 1.0) / 254.0 * 2.5 - 1.0;
        let a = max(x - D.m.x, 0.0);
        let dens = a * a * D.k.z;
        col += webRamp((x - D.m.x) / (1.4 - D.m.x)) * dens * k * w;
      }
    }
    if (w >= 1.0) { continue; }
    let soft = clamp(dt / 6.0, 1.0, 3.0);
    let d = webDensity(p, soft);
    if (d.x <= 0.0) { continue; }
    // (a cluster's knot found by one long step stands for the whole of it: held down there, so it doesn't sparkle)
    let dens = min(d.x, mix(20.0, 2.5, (soft - 1.0) * 0.5));
    col += webRamp(0.08 + drift + 0.9 * d.y) * dens * k * (1.0 - w);
  }
  col *= L.c.x / L.scale;
  // (the faint sum of everything far behind kept down, so the voids stay black and the filaments stand out)
  col = col * col / (col + vec3f(0.05));
  return vec4f(col * L.weight, 0.0);
}
