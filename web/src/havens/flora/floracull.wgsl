// The flora sorted into its draws, every frame: each instance in reach (and in view, or close enough that its shadow
// might fall into it) is listed in its species', variant's and level's draw, with its share of that level; over the
// band before a level's end it's listed in the next level's draw as well, with the rest of the share, so the two
// crossfade (flora.wgsl coverMask). A plant stays whole however close the eye comes (nothing is solid either: the cast
// walk through every plant). The draws are indirect: each bucket's instance count is counted here; its index count,
// first index, base vertex and first instance (its place in the visible list) were set at load (flora.ts).
#include "weft/frame"
#include "./floradata.wgsl"

@group(2) @binding(0) var<uniform> FU: FloraU;
@group(2) @binding(1) var<storage, read> species: array<FloraSp>;
@group(2) @binding(2) var<storage, read> instances: array<FloraInst>;
@group(2) @binding(3) var<storage, read_write> visible: array<vec2u>;
@group(2) @binding(4) var<storage, read_write> args: array<atomic<u32>>;   // 5 per bucket (drawIndexedIndirect)

@compute @workgroup_size(64) fn reset(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= u32(FU.counts.y)) { return; }
  atomicStore(&args[id.x * 5u + 1u], 0u);
}

// a sphere against the view's side planes and its near plane (reversed-Z, infinite far: no far plane)
fn inView(c: vec3f, r: f32) -> bool {
  let m = frame.viewProj;
  let r0 = vec4f(m[0][0], m[1][0], m[2][0], m[3][0]);
  let r1 = vec4f(m[0][1], m[1][1], m[2][1], m[3][1]);
  let r2 = vec4f(m[0][2], m[1][2], m[2][2], m[3][2]);
  let r3 = vec4f(m[0][3], m[1][3], m[2][3], m[3][3]);
  var planes = array<vec4f, 5>(r3 + r0, r3 - r0, r3 + r1, r3 - r1, r3 - r2);
  for (var k = 0; k < 5; k++) {
    let pl = planes[k];
    if (dot(pl.xyz, c) + pl.w < -r * length(pl.xyz)) { return false; }
  }
  return true;
}

fn emit(b: u32, i: u32, share: f32, incoming: bool) {
  let slot = atomicAdd(&args[b * 5u + 1u], 1u);
  let base = atomicLoad(&args[b * 5u + 4u]);
  visible[base + slot] = vec2u(i, u32(saturate(share) * 255.0 + 0.5) | select(0u, 256u, incoming));
}

@compute @workgroup_size(64) fn cull(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= u32(FU.counts.x)) { return; }
  let inst = instances[i];
  let sp = species[inst.id & 255u];
  let variant = (inst.id >> 8u) & 255u;
  let h = sp.form.w * inst.scale * inst.stretch;
  // (a clearing a host asked for: the trees and shrubs out of it, the grass and the flowers left)
  if (FU.clearing.z > 0.0 && h > FU.clearing.w && distance(inst.pos.xz, FU.clearing.xy) < FU.clearing.z) { return; }
  let c = inst.pos + vec3f(0.0, select(0.5, -0.5, sp.form.y > 0.5) * h, 0.0);
  let r = max(sp.form.z * inst.scale, h * 0.55) + 0.5;
  let d = distance(c, frame.camPos) / max(FU.look.z, 0.05);
  if (d >= sp.lod.z) { return; }
  // (out of view: dropped, unless near enough that its shadow may fall into view)
  if (d > 30.0 && !inView(c, r)) { return; }
  var lod = 0u;
  if (d >= sp.lod.x) { lod = 1u; }
  if (d >= sp.lod.y) { lod = 2u; }
  let end = select(select(sp.lod.z, sp.lod.y, lod == 1u), sp.lod.x, lod == 0u);
  // its share of this level: whole, then falling over the band before the level's end (the last level fading out)
  let f = saturate((end - d) / max(end * sp.lod.w, 0.5));
  let b = sp.buckets.x + variant * 3u;
  emit(b + lod, i, f, false);
  if (f < 1.0 && lod < 2u) { emit(b + lod + 1u, i, 1.0 - f, true); }
}
