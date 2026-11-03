// The canyon's ground as the terrain draws it (land.ts): terrainpatch.wgsl's patches (the nested heights, the morph
// between levels, the earth's curve) painted by ground.wgsl (the strata's bands, the cream caprock, the flutes on the
// sheer faces, the floor's grit, sand where the fill found it settles, scree, damp by the river) from the material the
// fill left beside the heights (groundInfo, one layer a level, handed over between levels as the heights are), and lit
// as the builders' stone is (arch.wgsl, rocks.wgsl): the key light and its shadow (the cascades', the heightfield's),
// the sky's light leaning lavender in the shade and the colour there glazed toward violet (never a grey), the sunlit
// floor's warm bounce up into what faces down or sideways, a dry sheen, the lamps, rain's wet look, the air between.
#include "./../world/terrainpatch.wgsl"
#include "./ground.wgsl"

const LAND_LUMA = vec3f(0.2126, 0.7152, 0.0722);
// the shade's light at unit luminance and the violet a colour is glazed toward there, and how far each leans (arch.wgsl
// VIOLET, GLAZE and its look's lean, so the ground and the walls on it read as one)
const LAND_VIOLET = vec3f(1.04, 0.9, 1.58);
const LAND_GLAZE = vec3f(0.96, 0.96, 1.42);
const LAND_LEAN = 0.75;
// how far round the temple the Haven's floors lie (havenGround's reach: within the gardens' radius)
const LAND_HAVEN_R = CN_PROM_R + 12.0;

// the ground's heights as a patch takes them (terrainpatch.wgsl): smoothed to its spacing, so a far cliff is a slope
// and not a staircase of the texels the patch skips; and under the Haven the lowest round the vertex instead (its
// mesh's reach either way), so no coarse patch rises through a terrace, a wall's foot or a court laid on the carved
// ground
fn patchHeight(xz: vec2f, spacing: f32) -> f32 {
  if (spacing < 0.75 || distance(xz, vec2f(CN_TEMPLE_X, CN_TEMPLE_Z)) > LAND_HAVEN_R) { return terrainHeightAt(xz, spacing); }
  var h = terrainHeight(xz);
  for (var k = 1; k <= 2; k++) {
    let d = spacing * 0.5 * f32(k);
    h = min(h, min(min(terrainHeight(xz + vec2f(d, 0.0)), terrainHeight(xz - vec2f(d, 0.0))), min(terrainHeight(xz + vec2f(0.0, d)), terrainHeight(xz - vec2f(0.0, d)))));
  }
  return h;
}

// the texel of the finest level holding a point (m)
fn finestTexel(xz: vec2f) -> f32 {
  for (var k = 0; k < TERRAIN_LEVELS; k++) {
    if (levelE(k, xz) < 0.85) { return world.terrainLevels[k].y; }
  }
  return world.terrainLevels[TERRAIN_LEVELS - 1].y;
}

// (parts left out to measure them on a device: Terrain.debug, T.debug.x)
const LAND_SKIP_PAINT = 1u;
const LAND_SKIP_NORMAL = 2u;
const LAND_SKIP_SHADOW = 4u;
const LAND_SKIP_SKY = 8u;
const LAND_SKIP_AIR = 16u;

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let skip = u32(T.debug.x);
  let p = i.world;
  let toCam = frame.camPos - i.curved;
  let dist = length(toCam);
  let v = toCam / dist;
  // (the normal over the patch's own smoothing, and never over less than a texel either way: the shading follows the
  // shape that's drawn, not the facets a cliff's lip makes across the texel grid where it runs aslant — a row of lit
  // and shaded teeth along every lip near the eye)
  let eps = clamp(max(max(dist * 0.002, i.spacing * 0.5), finestTexel(p.xz)), 0.25, 32.0);
  var ng = vec3f(0.0, 1.0, 0.0);
  if ((skip & LAND_SKIP_NORMAL) == 0u) { ng = terrainNormalAt(p.xz, eps, i.spacing); }
  // (the levels as ground.wgsl's lookup takes them: centre, half extent; the material read a little off the point, by
  // a wander about as wide as its texels are at that distance — half a metre near, tens of metres far — so their grid
  // never shows in the sand's and the scree's edges)
  var g: GroundSample;
  if ((skip & LAND_SKIP_PAINT) == 0u) {
    var levels: array<vec4f, 5>;
    for (var k = 0; k < 5; k++) { let L = world.terrainLevels[k]; levels[k] = vec4f(L.zw, L.x, 0.0); }
    var wn = vec2f(0.0);
    if (LAND_LITE) { wn = vec2f(grNoise(vec3f(p.xz * 0.021, 0.0)), grNoise(vec3f(p.xz * 0.021, 7.3))) * 0.94; }
    else { wn = vec2f(grFbm(vec3f(p.xz * 0.021, 0.0)), grFbm(vec3f(p.xz * 0.021, 7.3))); }
    let warp = (wn - 0.47) * clamp(dist * 0.009, 0.8, 90.0);
    g = canyonGround(p, ng, canyonInfoAt(p.xz + warp, levels), dist);
  } else { g.albedo = vec3f(0.42, 0.2, 0.12); g.nrm = ng; g.rough = 0.9; g.wet = 0.0; }
  let n = g.nrm;

  let l = world.sunDir;
  let ndl = saturate(dot(n, l));
  var vis = 0.0;
  if (dot(ng, l) > 0.0) { vis = select(sunShadow(p, ng), 1.0, (skip & LAND_SKIP_SHADOW) != 0u); }
  let sunE = sunLight(p);
  let lit = ndl * vis;
  let day = saturate(world.sunTrue.y * 5.0 + 0.25);
  let shade = (1.0 - smoothstep(0.0, 0.35, lit)) * day;
  var skyE = vec3f(0.3, 0.33, 0.4);
  if ((skip & LAND_SKIP_SKY) == 0u) { skyE = skyAmbient(n); }
  let sky = mix(skyE, dot(skyE, LAND_LUMA) * LAND_VIOLET, shade * LAND_LEAN);
  let bounce = sunE * max(l.y, 0.0) * vec3f(0.5, 0.25, 0.15) * (0.5 - 0.5 * n.y) / PI;
  let shaded = mix(g.albedo, dot(g.albedo, LAND_LUMA) * LAND_GLAZE, 0.4 * shade * LAND_LEAN);
  var lamps = vec3f(0.0);
  if ((skip & LAND_SKIP_SKY) == 0u) { lamps = outdoorLamps(p, n); }
  var c = g.albedo * (sunE * lit + lamps) / PI + shaded * (sky + bounce);
  // a dry sheen toward the sun, glossier where it's damp (not a phone's: ground.wgsl LAND_LITE)
  if (!LAND_LITE) { c += sunE * vis * ggx(n, v, l, g.rough, vec3f(0.03)) * 0.4; }
  c = wetLook(c, p, n, v, vis, dist, 0.0);
  if ((skip & LAND_SKIP_AIR) != 0u) { return vec4f(c, 1.0); }
  return vec4f(applyAerial(c, i.curved), 1.0);
}
