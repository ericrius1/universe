// The ground's geometry, for the shader that draws it (the land's: land/land.wgsl): one grid patch per quadtree node
// (CDLOD, Strugar 2009), its heights from the nested levels as the including shader takes them for a patch's spacing
// (its `patchHeight(xz, spacing)`: world.wgsl terrainHeightAt smooths them to it); each vertex morphs toward its
// parent's grid as it nears the end of its level's range so neighbouring levels meet (both read the same heights at the
// coarser spacing there), and a skirt hangs from every patch's edge, as deep as the ground drops along it there, so
// where neighbours still part — a cliff, whose height range stretches a patch's reach past what the morph can cover —
// the gap shows the cliff and never the sky; the far field drops with the earth's curvature, the outermost rim pulled
// under the horizon. A ground shader includes this, binds T and nodes (world/terrain.ts does), defines patchHeight and
// adds its own fragment stage reading VOut.
#include "./world.wgsl"

struct TerrainU {
  grid: vec4f,          // x quads per patch side, y range of level 0 (m), z morph start (fraction of range), w earth radius (m)
}
@group(2) @binding(0) var<uniform> T: TerrainU;
@group(2) @binding(1) var<storage, read> nodes: array<vec4f>;    // x0, z0, size, lod level

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,     // uncurved: where it is
  @location(1) curved: vec3f,    // where it's drawn (the earth's curve round the camera): for the aerial perspective
  @location(2) morph: f32,
  @location(3) spacing: f32,     // the patch's vertex spacing here (m): what its heights were smoothed to
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let node = nodes[ii];
  let N = u32(T.grid.x);
  // (the grid's (N + 1)^2 vertices inside a ring of the skirt's: each skirt vertex under the edge vertex beside it)
  let W = N + 3u;
  let k = vec2u(vi % W, vi / W);
  let edge = vec2<bool>(k.x == 0u || k.x == W - 1u, k.y == 0u || k.y == W - 1u);
  var g = vec2f(clamp(vec2i(k) - 1, vec2i(0), vec2i(i32(N))));
  let step = node.z / f32(N);
  var xz = node.xy + g * step;
  let range = T.grid.y * exp2(node.w);
  let hApprox = terrainHeight(xz);
  let d = distance(vec3f(xz.x, hApprox, xz.y), frame.camPos);
  let morph = saturate((d - range * T.grid.z) / (range * (1.0 - T.grid.z)));
  g -= fract(g * 0.5) * 2.0 * morph;
  xz = node.xy + g * step;
  // (the spacing grows to the parent's as the vertex morphs onto its grid: where they meet, both read alike)
  let spacing = step * (1.0 + morph);
  var h = patchHeight(xz, spacing);
  if (any(edge)) {
    // the skirt: down past the most the ground falls within two steps along the edge (either way along it at a corner)
    var fall = 0.0;
    for (var a = 0; a < 2; a++) {
      if (!edge[1 - a]) { continue; }
      var e = vec2f(0.0);
      e[a] = step;
      fall = max(fall, max(max(abs(patchHeight(xz + e, spacing) - h), abs(patchHeight(xz - e, spacing) - h)),
        max(abs(patchHeight(xz + 2.0 * e, spacing) - h), abs(patchHeight(xz - 2.0 * e, spacing) - h))));
    }
    h -= 0.5 + step * 0.5 + fall * 1.5;
  }
  let p = vec3f(xz.x, h, xz.y);
  // the earth's curvature around the camera, and the outermost rim pulled under the horizon
  let hd = distance(xz, frame.camPos.xz);
  var c = p;
  c.y -= hd * hd / (2.0 * T.grid.w);
  c.y -= smoothstep(0.93, 1.0, levelE(TERRAIN_LEVELS - 1, xz)) * 3000.0;
  var o: VOut;
  o.pos = frame.viewProj * vec4f(c, 1.0);
  o.world = p;
  o.curved = c;
  o.morph = morph;
  o.spacing = spacing;
  return o;
}
