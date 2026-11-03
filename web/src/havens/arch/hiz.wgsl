// The occluders' depth pyramid for the cull's occlusion test (cull.wgsl occluded): each texel the farthest depth under
// it — reversed-Z, so the least. Level 0 is half the occluders' depth (each texel its 2x2 pixels), its size padded up
// to powers of two so that every level halves the one before exactly and a texel at level L covers 2^(L+1) pixels a
// side: the test finds the texels a rectangle of pixels falls in by shifting. Pixels past the screen's edge count as
// the nearest there is (1), so they never make a texel farther than what's on screen under it. One dispatch makes up
// to four levels: an 8x8 workgroup's texels, then their 4x4, 2x2 and 1 through workgroup memory.
struct HizU {
  at: vec4u,   // x the first level this dispatch makes, y how many it makes (1..4), zw the occluders' depth's size (px)
}

@group(2) @binding(0) var<uniform> HZ: HizU;
@group(2) @binding(1) var depth: texture_depth_2d;      // the occluders' depth (level 0's source)
@group(2) @binding(2) var src: texture_2d<f32>;          // the level before (the later dispatches' source)
@group(2) @binding(3) var dst0: texture_storage_2d<r32float, write>;
@group(2) @binding(4) var dst1: texture_storage_2d<r32float, write>;
@group(2) @binding(5) var dst2: texture_storage_2d<r32float, write>;
@group(2) @binding(6) var dst3: texture_storage_2d<r32float, write>;

var<workgroup> tile: array<f32, 64>;

fn depthAt(p: vec2u) -> f32 {
  if (any(p >= HZ.at.zw)) { return 1.0; }
  return textureLoad(depth, p, 0);
}

fn srcAt(p: vec2u) -> f32 {
  return textureLoad(src, min(p, vec2u(textureDimensions(src)) - 1u), 0).r;
}

fn put(k: u32, p: vec2u, d: f32) {
  if (k == 0u) { if (all(p < textureDimensions(dst0))) { textureStore(dst0, p, vec4f(d)); } }
  else if (k == 1u) { if (all(p < textureDimensions(dst1))) { textureStore(dst1, p, vec4f(d)); } }
  else if (k == 2u) { if (all(p < textureDimensions(dst2))) { textureStore(dst2, p, vec4f(d)); } }
  else { if (all(p < textureDimensions(dst3))) { textureStore(dst3, p, vec4f(d)); } }
}

// this workgroup's texels of the dispatch's first level made (d), the levels under it from them
fn finish(d: f32, l: vec2u, w: vec2u) {
  put(0u, w * 8u + l, d);
  tile[l.y * 8u + l.x] = d;
  var n = 8u;
  for (var k = 1u; k < 4u; k++) {
    // (uniform: every invocation of the dispatch reads the same count)
    if (k >= HZ.at.y) { break; }
    workgroupBarrier();
    n = n / 2u;
    let inside = all(l < vec2u(n));
    var m = 0.0;
    if (inside) {
      let i = l.y * 16u + l.x * 2u;
      m = min(min(tile[i], tile[i + 1u]), min(tile[i + 8u], tile[i + 9u]));
      put(k, w * n + l, m);
    }
    workgroupBarrier();
    if (inside) { tile[l.y * 8u + l.x] = m; }
  }
}

@compute @workgroup_size(8, 8) fn fromDepth(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_id) l: vec3u, @builtin(workgroup_id) w: vec3u) {
  let p = g.xy * 2u;
  finish(min(min(depthAt(p), depthAt(p + vec2u(1u, 0u))), min(depthAt(p + vec2u(0u, 1u)), depthAt(p + vec2u(1u, 1u)))), l.xy, w.xy);
}

@compute @workgroup_size(8, 8) fn fromLevel(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_id) l: vec3u, @builtin(workgroup_id) w: vec3u) {
  let p = g.xy * 2u;
  finish(min(min(srcAt(p), srcAt(p + vec2u(1u, 0u))), min(srcAt(p + vec2u(0u, 1u)), srcAt(p + vec2u(1u, 1u)))), l.xy, w.xy);
}
