// The heightfield's shadow for one terrain level: from each texel's ground, march toward the sun over every level's
// heights (finest first), growing the step as the ray climbs away; the visibility is the narrowest the ray came to the
// ground relative to the sun disc's width at that distance (a soft penumbra), and the earth curves away beneath it.
#include "./world.wgsl"
#include "weft/fullscreen"

struct TSU { level: vec4f }
@group(2) @binding(0) var<uniform> TS: TSU;

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let L = world.terrainLevels[i32(TS.level.x)];
  let xz = L.zw + i.uv * 2.0 * L.x - L.x;
  let l = world.sunDir;
  if (l.y < -0.02) { return vec4f(0.0); }
  let h0 = terrainHeight(xz) + 0.25;
  let lh = normalize(l.xz + vec2f(1e-6, 0.0));
  let tanA = l.y / max(length(l.xz), 1e-4);
  var d = L.y * 0.7;
  var vis = 1.0;
  let sunWidth = 0.0093;   // the sun's disc, radians
  for (var k = 0; k < 96; k++) {
    let p = xz + lh * d;
    if (levelE(TERRAIN_LEVELS - 1, p) > 1.0) { break; }
    let ray = h0 + d * tanA + d * d / (2.0 * 6371000.0);
    let h = terrainHeight(p);
    vis = min(vis, saturate((ray - h) / (d * sunWidth) + 0.5));
    if (vis <= 0.0 || ray > world.ground.x + 50.0) { break; }
    d = d * 1.12 + L.y * 0.5;
  }
  return vec4f(vis, vis, vis, 1.0);
}
