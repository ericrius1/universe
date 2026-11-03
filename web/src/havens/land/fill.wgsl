// Fills one level of the canyon's nested heights on the GPU (source.ts dispatches it at load, a level in a few
// milliseconds): `fill` runs canyon.wgsl once per texel of the level's px x px grid (texel k's centre at
// (k + 0.5) * texel - half from the level's centre, as boulder's levels lie) into a buffer of f32 heights, row-major
// with rows going south (+z), and what each texel was into a buffer of packed hints; `info` then reads the heights round
// each texel (its slope, the hollow it lies in) and its hints, and writes the ground's material as rgba8 packed in a u32
// (sand, damp, scree, zone: ground.wgsl's `info`), on a grid `infoStep` times coarser than the heights.
#include "./canyon.wgsl"

struct CanyonFill {
  centre: vec2f,     // the level's centre (x, z, m)
  half: f32,         // its half extent (m)
  texel: f32,        // its texel (m): 2 * half / px
  px: u32,           // texels per side
  infoStep: u32,     // height texels per info texel (1: the same grid)
  row0: u32,         // the first row this dispatch fills (a band of the level at a time: source.ts fillAll's slices)
}
@group(2) @binding(0) var<uniform> canyonFill: CanyonFill;
@group(2) @binding(1) var<storage, read_write> canyonHeights: array<f32>;
@group(2) @binding(2) var<storage, read_write> canyonHints: array<u32>;
@group(2) @binding(3) var<storage, read_write> canyonInfo: array<u32>;

// texel (i, j)'s centre: the level's corner plus (k + 0.5) texels (levels.ts texelCentre makes the same f32 numbers)
fn fillPos(i: u32, j: u32) -> vec2f {
  let L = canyonFill;
  let corner = L.centre - L.half;
  let along = (vec2f(f32(i), f32(j)) + 0.5) * L.texel;
  return corner + along;
}

// a texel's hints in a u32: the strata kind + 1 (4 bits), the zone (4), how far along the segment (8), the river's
// distance in centimetres (16, held at 655 m)
@compute @workgroup_size(8, 8) fn fill(@builtin(global_invocation_id) id: vec3u) {
  let n = canyonFill.px;
  let y = id.y + canyonFill.row0;
  if (id.x >= n || y >= n) { return; }
  let p = fillPos(id.x, y);
  let s = canyonSample(p.x, p.y, canyonFill.texel);
  let k = y * n + id.x;
  canyonHeights[k] = s.h;
  canyonHints[k] = u32(s.kind + 1) | (u32(s.zone) << 4u) | (u32(round(clamp(s.along, 0.0, 1.0) * 255.0)) << 8u)
    | (u32(round(min(s.river, 655.0) * 100.0)) << 16u);
}

fn fillHeight(i: i32, j: i32) -> f32 {
  let n = i32(canyonFill.px);
  return canyonHeights[u32(clamp(j, 0, n - 1) * n + clamp(i, 0, n - 1))];
}

// the ground's material (canyonInfo in canyon.ts, from the filled heights): sand on the flats and in hollows, less on
// scree; damp within ~70 m of the river; scree on the soft beds' slopes under the cliffs; the zone, so the gardens'
// terraces, the stair's corridor and the city's floor can be told apart
@compute @workgroup_size(8, 8) fn info(@builtin(global_invocation_id) id: vec3u) {
  let step = canyonFill.infoStep;
  let n = canyonFill.px / step;
  if (id.x >= n || id.y >= n) { return; }
  let i = i32(id.x * step + step / 2u);
  let j = i32(id.y * step + step / 2u);
  let t = canyonFill.texel;
  let h = fillHeight(i, j);
  let gx = (fillHeight(i + 1, j) - fillHeight(i - 1, j)) / (2.0 * t);
  let gz = (fillHeight(i, j + 1) - fillHeight(i, j - 1)) / (2.0 * t);
  let R = max(i32(round(12.0 / t)), 1);
  let ring = (fillHeight(i - R, j) + fillHeight(i + R, j) + fillHeight(i, j - R) + fillHeight(i, j + R)) / 4.0;
  let hint = canyonHints[u32(j) * canyonFill.px + u32(i)];
  let kind = i32(hint & 15u) - 1;
  let zone = (hint >> 4u) & 15u;
  let river = f32(hint >> 16u) / 100.0;
  let slope = sqrt(gx * gx + gz * gz);
  let cliff = cnSmooth(0.5, 2.5, slope);
  let hollow = clamp((ring - h) / 3.0, -1.0, 1.0);
  let flat = 1.0 - cnSmooth(0.12, 0.6, slope);
  var talus = 0.0;
  if (kind == 1) { talus = cnSmooth(0.1, 0.5, slope) * (1.0 - cliff); }
  let p = fillPos(u32(i), u32(j));
  // (sand settles on the canyons' floors, less on the benches, least on the plateau's slickrock; in broad soft patches
  // and in every hollow)
  let settles = select(select(0.08, 0.2, kind == 0), 0.62, kind == -1);
  var sand = clamp(flat * (settles + 0.55 * cnFbm(p.x, p.y, 140.0, 3, CN_S_SAND + 1u, 0.001)) + hollow * 0.5 - talus * 0.3, 0.0, 1.0);
  if (zone == 4u || zone == 6u) { sand = 0.0; }
  let damp = 1.0 - cnSmooth(CN_RIVER_HW, CN_RIVER_HW + 70.0, river);
  canyonInfo[id.y * n + id.x] = pack4x8unorm(vec4f(sand, damp, talus, f32(zone) * 36.0 / 255.0));
}
