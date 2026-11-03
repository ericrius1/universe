// The canyon's ground as the terrain's fragment shader paints it: an include giving
//   canyonGround(p, n, info, dist) -> GroundSample { albedo (linear), rough, nrm (the bumped normal), wet }
// for a point p on the ground (world metres), its geometric normal n, its material `info` (fill.wgsl `info`, sampled
// with canyonInfoAt: r sand, g damp, b scree, a zone * 36 / 255) and its distance from the eye.
// The rock is boulder's sandstone() (redrocks/rocks.wgsl) moved into the art bible's palette and onto the canyon's own
// strata: the bed a point lies in is found in the same table the heights were stepped by (tables.wgsl), so each cliff
// band has its own shade (terracotta, burnt sienna, rose, peach), its top two metres are the cream caprock the bench
// above stands on, the soft beds between are a darker scree-red, and every band wanders a little. Over that, sampled
// in world space (triplanar where it matters): the painterly sandstone_strata on the walls' faces, cliff_flutes on the
// sheer ones, canyon_floor (cracked, pebbled) on the flats and scree, desert_sand where sand lies (on the flats and in
// the hollows the fill found), desert varnish streaking down the cliffs from under each ledge, and damp, darker,
// faintly green ground along the river. Albedo stays mid-valued and warm: the violet of the shade is the light's.
// Expects (group 2, the terrain's own, at bindings that clear boulder's terrain.wgsl):
//   @binding(20) groundTex: texture_2d_array<f32>, rgba8unorm-srgb with mips, layers GROUND_STRATA (sandstone_strata),
//                GROUND_FLUTES (cliff_flutes), GROUND_SAND (desert_sand), GROUND_FLOOR (canyon_floor), from
//                public/assets/tex/*.webp (1024² seamless)
//   @binding(21) groundInfo: texture_2d_array<f32>, rgba8unorm, one layer per height level (fill.wgsl `info`)
// and weft/frame's samp_repeat and samp_linear (group 0). Call canyonGround in uniform control flow: it samples with
// derivatives.
#include "weft/frame"
#include "./tables.wgsl"

@group(2) @binding(20) var groundTex: texture_2d_array<f32>;
@group(2) @binding(21) var groundInfo: texture_2d_array<f32>;
// the strata (tables.wgsl's CN_STRATA_Y and _K: a knot's ground height, its segment's kind) in a buffer, searched per
// pixel: a constant array indexed at run time is copied whole on each read by some shader compilers (WebKit's: on an
// iPhone the ground's painting took most of a frame), a buffer never is
@group(2) @binding(22) var<storage, read> groundStrata: array<vec2f>;

const GROUND_STRATA = 0;
const GROUND_FLUTES = 1;
const GROUND_SAND = 2;
const GROUND_FLOOR = 3;

struct GroundSample { albedo: vec3f, rough: f32, nrm: vec3f, wet: f32 }

// ------------------------------------------------------------------ small helpers (named gr*: world.wgsl has its own)
// a phone's ground (util/tier.ts, land.ts): one octave of noise where the painting has four, and each texture at one
// scale — on an iPhone the ground was most of a frame from above
override LAND_LITE: bool = false;

fn grHash(p: vec3f) -> f32 {
  var q = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
fn grNoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(grHash(i), grHash(i + vec3f(1, 0, 0)), u.x), mix(grHash(i + vec3f(0, 1, 0)), grHash(i + vec3f(1, 1, 0)), u.x), u.y),
    mix(mix(grHash(i + vec3f(0, 0, 1)), grHash(i + vec3f(1, 0, 1)), u.x), mix(grHash(i + vec3f(0, 1, 1)), grHash(i + vec3f(1, 1, 1)), u.x), u.y), u.z);
}
fn grFbm(p: vec3f) -> f32 { return grNoise(p) * 0.5 + grNoise(p * 2.03) * 0.25 + grNoise(p * 4.07) * 0.125 + grNoise(p * 8.13) * 0.0625; }
fn grLinear(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }

// the art bible's sandstone, lit (sRGB): terracotta, burnt sienna, rose, peach, cream; the scree's dark red
const GR_TERRACOTTA = vec3f(0.784, 0.392, 0.243);
const GR_SIENNA = vec3f(0.659, 0.290, 0.173);
const GR_ROSE = vec3f(0.851, 0.541, 0.384);
const GR_PEACH = vec3f(0.910, 0.690, 0.541);
const GR_CREAM = vec3f(0.941, 0.827, 0.643);
const GR_SCREE = vec3f(0.560, 0.270, 0.180);
const GR_VARNISH = vec3f(0.300, 0.180, 0.170);
const GR_DAMP = vec3f(0.45, 0.42, 0.30);

/** the strata segment holding ground height y: its index, kind (0 bench, 1 scree, 2 cliff), how far up it, its top */
struct GrBed { i: i32, kind: i32, t: f32, top: f32, bottom: f32 }
fn grBed(y: f32) -> GrBed {
  var b: GrBed;
  let n = CN_STRATA_N;
  let y0 = groundStrata[0].x;
  let yn = groundStrata[n - 1].x;
  if (y <= y0) { b.i = -1; b.kind = 1; b.t = 0.0; b.top = y0; b.bottom = y - 1.0; return b; }
  if (y >= yn) {
    // (past the table: beds of ~24 m, a cliff each)
    let k = floor((y - yn) / 24.0);
    b.i = n + i32(k); b.kind = 2; b.bottom = yn + k * 24.0; b.top = b.bottom + 24.0; b.t = (y - b.bottom) / 24.0;
    return b;
  }
  var lo = 0;
  var hi = n - 2;
  loop {
    if (lo >= hi) { break; }
    let m = (lo + hi + 1) / 2;
    if (groundStrata[m].x <= y) { lo = m; } else { hi = m - 1; }
  }
  b.i = lo;
  b.kind = i32(groundStrata[lo].y);
  b.bottom = groundStrata[lo].x;
  b.top = groundStrata[lo + 1].x;
  b.t = (y - b.bottom) / max(b.top - b.bottom, 1e-3);
  return b;
}

/** a bed's own shade (sRGB): terracotta to sienna, now and then rose or peach; a scree bed's darker red */
fn grBedColour(b: GrBed) -> vec3f {
  let h = grHash(vec3f(f32(b.i), 3.7, 1.3));
  var col = mix(GR_TERRACOTTA, GR_SIENNA, smoothstep(0.3, 0.7, h));
  col = mix(col, GR_ROSE, smoothstep(0.72, 0.95, grHash(vec3f(f32(b.i), 8.1, 2.9))) * 0.8);
  col = mix(col, GR_PEACH, smoothstep(0.85, 0.98, grHash(vec3f(f32(b.i), 5.3, 7.7))) * 0.6);
  if (b.kind == 1) { col = mix(col, GR_SCREE, 0.55); }
  return col;
}

/** the rock's colour (sRGB) at p: its bed's shade, fine bands inside it, the cream caprock at a cliff's top */
fn grRock(p: vec3f, n: vec3f) -> vec3f {
  // (the beds wander a little, so no band is ruled)
  let y = p.y + (grNoise(vec3f(p.x, 0.0, p.z) * 0.02) - 0.5) * 1.4 + (grNoise(vec3f(p.x, 0.0, p.z) * 0.11) - 0.5) * 0.35;
  let b = grBed(y);
  var col = grBedColour(b);
  // on a flat a bed's shade runs into its neighbour's over a few metres of height (a bench or a plateau that rolls
  // across a bed's edge would otherwise break into hard patches along it); on a face the bands stay crisp
  let soft = smoothstep(0.75, 0.95, n.y) * 3.0;
  if (soft > 0.0) {
    let up = b.top - y;
    let down = y - b.bottom;
    if (up < soft) { col = mix(col, grBedColour(grBed(b.top + 0.01)), 0.5 * (1.0 - up / soft)); }
    if (down < soft) { col = mix(col, grBedColour(grBed(b.bottom - 0.01)), 0.5 * (1.0 - down / soft)); }
  }
  // fine laminae inside the bed (0.4-2 m), the painterly kind: soft-edged, uneven
  let lam = grNoise(vec3f(p.x * 0.05, y * 1.6, p.z * 0.05)) * 0.6 + grNoise(vec3f(p.x * 0.02, y * 0.55, p.z * 0.02)) * 0.4;
  col *= mix(0.88, 1.1, lam);
  // the caprock: the top ~2 m of a cliff, cream (the ledge the bench above stands on), its edge a little ragged; a band
  // seen in the cliff's face, not the bench's whole floor (that stays its bed's red, sand drifted over it)
  let below = b.top - y;
  let cap = select(0.0, 1.0 - smoothstep(1.2, 2.4 + grNoise(p * 0.3) * 0.8, below), b.kind == 2) * (1.0 - smoothstep(0.8, 0.96, n.y));
  col = mix(col, GR_CREAM, cap * 0.85);
  // a thin pale band at a cliff bed's foot, on the face
  col = mix(col, GR_PEACH, (1.0 - smoothstep(0.0, 0.5, y - b.bottom)) * 0.35 * select(0.0, 1.0, b.kind == 2) * (1.0 - smoothstep(0.8, 0.96, n.y)));
  return col;
}

/** the canyon's ground at p (see the header) */
fn canyonGround(p: vec3f, n: vec3f, info: vec4f, dist: f32) -> GroundSample {
  var g: GroundSample;
  let near = 1.0 - smoothstep(30.0, 400.0, dist);
  let steep = 1.0 - smoothstep(0.5, 0.82, n.y);
  let sheer = 1.0 - smoothstep(0.18, 0.42, n.y);
  let flat = smoothstep(0.62, 0.9, n.y);
  let zone = round(info.a * 255.0 / 36.0);
  // the painterly textures, in world space: the strata and flutes on the faces (planar on the face's axis, their bands
  // level), the floor and the sand from above, at two scales against tiling
  let ax = abs(n.x) / max(abs(n.x) + abs(n.z), 1e-4);
  let uvX = vec2f(p.z, -p.y);
  let uvZ = vec2f(p.x, -p.y);
  let strata = mix(textureSample(groundTex, samp_repeat, uvZ / 26.0, GROUND_STRATA).rgb, textureSample(groundTex, samp_repeat, uvX / 26.0, GROUND_STRATA).rgb, ax);
  let flutes = mix(textureSample(groundTex, samp_repeat, uvZ / 18.0, GROUND_FLUTES).rgb, textureSample(groundTex, samp_repeat, uvX / 18.0, GROUND_FLUTES).rgb, ax);
  let floorA = textureSample(groundTex, samp_repeat, p.xz / 7.0, GROUND_FLOOR).rgb;
  var floorB = floorA;
  if (!LAND_LITE) { floorB = textureSample(groundTex, samp_repeat, mat2x2f(0.8, 0.6, -0.6, 0.8) * p.xz / 31.0, GROUND_FLOOR).rgb; }
  let sandA = textureSample(groundTex, samp_repeat, p.xz / 6.0, GROUND_SAND).rgb;
  var sandB = sandA;
  if (!LAND_LITE) { sandB = textureSample(groundTex, samp_repeat, mat2x2f(0.8, -0.6, 0.6, 0.8) * p.xz / 27.0, GROUND_SAND).rgb; }
  // (each texture's own colour, normalized to its mean, carries detail; the palette carries the colour)
  let lum = vec3f(0.299, 0.587, 0.114);
  let strataD = dot(strata, lum) / 0.42;
  let flutesD = dot(flutes, lum) / 0.36;
  // (the floor texture's red drawn a little towards terracotta and peach: it is the ground between, not the rock)
  let floorRaw = mix(floorA, sqrt(floorA * floorB), smoothstep(20.0, 120.0, dist));
  let floorTex = mix(floorRaw, mix(GR_TERRACOTTA, GR_PEACH, 0.4) * dot(floorRaw, lum) / 0.36, 0.45);
  // (the sand texture is a deep orange: drawn towards the bible's peach, warmed toward terracotta, its ripples kept)
  let sandRaw = mix(sandA, sqrt(sandA * sandB), smoothstep(15.0, 90.0, dist));
  let sandTex = mix(GR_PEACH, GR_TERRACOTTA, 0.3) * (0.58 + 0.36 * dot(sandRaw, lum) / 0.62);

  // the rock: its bed's colour with the painted detail of what it is — the strata's and the flutes' on a wall (their
  // planes stand on the face's axis, so on a flat they'd smear into straight streaks along x or z), the floor's from
  // above on a flat
  let wall = 1.0 - smoothstep(0.72, 0.93, n.y);
  var rock = grRock(p, n);
  let faceD = mix(strataD, flutesD, sheer);
  // (normalized as the strata's is, so a flat keeps the value it had)
  let flatD = dot(floorTex, lum) / 0.42;
  rock *= mix(1.0, mix(flatD, faceD, wall), mix(0.75, 0.4, 1.0 - near));
  rock = mix(rock, rock * mix(vec3f(1.0), strata / max(dot(strata, lum), 0.05) * 0.5, 0.25), steep);
  // desert varnish: dark streaks down the steep faces, strongest just under a ledge
  let b = grBed(p.y);
  let underLedge = 1.0 - smoothstep(0.0, 14.0, b.top - p.y);
  let sq = vec3f(p.x * 0.35, p.y * 0.018, p.z * 0.35) + vec3f(0.0, f32(b.i) * 0.37, 0.0);
  var streakN = 0.0;
  if (LAND_LITE) { streakN = grNoise(sq) * 0.94; } else { streakN = grFbm(sq); }
  let streak = smoothstep(0.55, 0.82, streakN);
  rock = mix(rock, GR_VARNISH, streak * steep * (0.25 + 0.55 * underLedge) * 0.75);
  // big soft mottling (paler where the rain washes, redder in the hollows)
  var mottle = 0.0;
  if (LAND_LITE) { mottle = grNoise(p * 0.035) * 0.94; } else { mottle = grFbm(p * 0.035); }
  rock *= mix(0.86, 1.08, mottle);

  // the flats: bare slickrock (its bed's colour, paler and gritty, the floor texture's cracks and pebbles in it) or the
  // canyon floor's cracked earth down on a floor, scree at the cliffs' feet, sand where it lies
  let slick = mix(rock, GR_PEACH, 0.38) * (0.7 + 0.6 * dot(floorTex, lum) / 0.45);
  var ground = mix(slick, floorTex * 1.05, smoothstep(6.0, 1.0, p.y) * 0.8);
  ground = mix(ground, mix(GR_SCREE, rock, 0.35) * (0.8 + 0.4 * dot(floorTex, lum)), info.b * 0.8);
  // (its edge wanders in the world's metres, so the material's coarse texels far off never show as blocks: wider and
  // wandering on a broader scale the farther off it is, where those texels are 4 to 40 m)
  let far = smoothstep(250.0, 2500.0, dist);
  var wander = 0.0;
  if (LAND_LITE) { wander = (grNoise(p * 0.0061) * 0.94 - 0.47) * mix(0.35, 0.5, far); }
  else { wander = (grFbm(p * 0.045) - 0.47) * 0.35 + (grFbm(p * 0.0061) - 0.47) * 0.5 * far; }
  let sandAmount = clamp(info.r * mix(0.55, 1.0, flat) + (1.0 - steep) * 0.08 + wander, 0.0, 1.0);
  ground = mix(ground, sandTex, smoothstep(0.3 - 0.25 * far, 0.8 + 0.2 * far, sandAmount));
  var albedo = mix(rock, ground, flat * (1.0 - info.b * 0.3) + (1.0 - flat) * (1.0 - steep) * 0.5);
  // damp ground by the river: darker, a breath of green; the channel's bed darker still
  let damp = info.g * (1.0 - steep * 0.8);
  albedo = mix(albedo, albedo * GR_DAMP / 0.42, damp * 0.55);
  if (zone == 6.0) { albedo *= 0.55; }
  // the gardens' terraces under their planters: dark soil, on their floors only (never down a cliff that a terrace's
  // edge texel happens to cover)
  if (zone == 4.0) { albedo = mix(albedo, vec3f(0.36, 0.24, 0.16), 0.7 * flat); }
  g.albedo = clamp(grLinear(albedo), vec3f(0.0), vec3f(0.85));
  g.rough = mix(mix(0.86, 0.95, sandAmount), 0.55, damp * 0.6);
  g.wet = damp * 0.5 + select(0.0, 0.8, zone == 6.0);
  // relief: the detail's luminance as a bump (the surface gradient from its screen derivatives, rocks.wgsl's way)
  let relief = (mix(strataD, flutesD, sheer) * steep + dot(floorTex, lum) * 2.0 * (1.0 - steep)) * near;
  let dpx = dpdx(p);
  let dpy = dpdy(p);
  let r1 = cross(dpy, n);
  let r2 = cross(n, dpx);
  let det = dot(dpx, r1);
  let grad = sign(det) * (dpdx(relief) * r1 + dpdy(relief) * r2) * 0.06;
  g.nrm = select(n, normalize(abs(det) * n - grad), abs(det) > 1e-9);
  return g;
}

/** the material info at xz from the info array, the finest level holding the point, handed over to the next coarser in
 *  each level's outer 15% (as world.wgsl's terrainHeight hands over the heights) */
fn canyonInfoAt(xz: vec2f) -> vec4f {
  // (each level's centre and half extent from the World uniform's table — world.terrainLevels: half, texel, centre — read
  // where they're needed, not copied into an array of the shader's own: a phone's compiler spills such an array)
  let L4 = world.terrainLevels[4];
  var v = textureSampleLevel(groundInfo, samp_linear, (xz - L4.zw + L4.x) / (2.0 * L4.x), 4, 0.0);
  for (var i = 3; i >= 0; i--) {
    let T4 = world.terrainLevels[i];
    let L = vec4f(T4.zw, T4.x, 0.0);
    let d = abs(xz - L.xy);
    let e = max(d.x, d.y) / L.z;
    if (e < 1.0) {
      let w = textureSampleLevel(groundInfo, samp_linear, (xz - L.xy + L.z) / (2.0 * L.z), i, 0.0);
      v = mix(w, v, smoothstep(0.85, 0.98, e));
    }
  }
  // (the zone is a code, not an amount: read at the texel holding the point in the finest level that does, never
  // blended between neighbours or levels — between a zone 3 and a 5, a blend would read 4)
  let dim = vec2f(textureDimensions(groundInfo));
  for (var i = 0; i < 5; i++) {
    let Li = world.terrainLevels[i];
    let uv = (xz - Li.zw + Li.x) / (2.0 * Li.x);
    if (all(uv >= vec2f(0.0)) && all(uv < vec2f(1.0))) {
      v.a = textureLoad(groundInfo, vec2i(uv * dim), i, 0).a;
      break;
    }
  }
  return v;
}
