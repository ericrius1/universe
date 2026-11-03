// The GPU's cull (cull.ts): every box tested against every view that draws it — the scene's camera and each of the sun's
// cascades — and each box's indexed draw in that view given one instance or none, in the draw arguments the bundles'
// indirect draws read (one per box: its index count, instances, first index, base vertex, first instance). Two
// computes a frame:
//   frustum   before anything is drawn: each cascade's draws (their frustums alone); the scene's frustum kept for the
//             second; and the occluders' draws: what the scene drew last frame, in its frustum still and near the eye
//             (drawn depth-only into the occluders' depth, its pyramid made: hiz.wgsl)
//   occlude   after the pyramid: the scene's draws, each box in its frustum and not wholly behind the occluders — every
//             pixel its rectangle covers already nearer than its nearest corner. The occluders are this frame's, drawn
//             with this frame's camera: a box that turning or flying brings into view is tested against what is there
//             now, never against last frame (nothing pops in a frame late), and an empty history (the first frame, a
//             jump of the camera) only means fewer occluders, never a box missing
// Regions of the arguments (each `n.z` boxes long): 0 the scene's, 1 the occluders', 2 every box (the debug view:
// its first instance carries the box's verdict in its top byte), 3 + k cascade k's.
#include "./cullviews.wgsl"

struct Box { lo: vec4f, hi: vec4f }

@group(2) @binding(1) var<storage, read> boxes: array<Box>;
@group(2) @binding(2) var<storage, read_write> args: array<u32>;
// per box: STATE_* (last frame's verdict, this frame's frustum)
@group(2) @binding(3) var<storage, read_write> state: array<u32>;
// per region: the boxes drawn, their triangles; then the scene's boxes hidden by the occluders and theirs; then the
// boxes that would be occluders (cull.ts skips the occluders' pass while there are none: the eye high over the town)
@group(2) @binding(4) var<storage, read_write> counts: array<atomic<u32>>;

const STATE_DRAWN = 1u;
const STATE_IN_VIEW = 2u;
const STATE_HIDDEN = 4u;
const SCENE = 0u;
const OCCLUDERS = 1u;
const EVERY = 2u;
const CASCADES = 3u;
// the debug view's verdicts (the top byte of region EVERY's first instance; arch.wgsl vs reads it)
const SHOWN = 1u;
const HIDDEN = 2u;
const OUTSIDE = 3u;

// one box's draw in a region: an instance or none, counted
fn put(region: u32, i: u32, on: bool) {
  let a = (region * CU.n.z + i) * 5u;
  args[a + 1u] = select(0u, 1u, on);
  if (on) {
    atomicAdd(&counts[region * 2u], 1u);
    atomicAdd(&counts[region * 2u + 1u], args[a] / 3u);
  }
}

@compute @workgroup_size(64) fn frustum(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= CU.n.x) { return; }
  let lo = boxes[i].lo.xyz;
  let hi = boxes[i].hi.xyz;
  for (var c = 0u; c < CU.n.y; c++) {
    if (cascadeDrawn(c)) { put(CASCADES + c, i, inFrustum(1u + c, lo, hi)); }
  }
  if (frozen()) { return; }
  let seen = inFrustum(0u, lo, hi);
  let was = state[i];
  // (the box's nearest point to the eye)
  let gap = max(max(lo - CU.eye.xyz, CU.eye.xyz - hi), vec3f(0.0));
  let near = seen && (was & STATE_DRAWN) != 0u && dot(gap, gap) < CU.eye.w * CU.eye.w;
  put(OCCLUDERS, i, near && (CU.n.w & FLAG_OCCLUSION) != 0u);
  if (near) { atomicAdd(&counts[(CASCADES + CU.n.y) * 2u + 2u], 1u); }
  state[i] = (was & STATE_DRAWN) | select(0u, STATE_IN_VIEW, seen);
}

@compute @workgroup_size(64) fn occlude(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= CU.n.x) { return; }
  let was = state[i];
  let seen = (was & STATE_IN_VIEW) != 0u;
  var hidden = false;
  if (seen) { hidden = occluded(boxes[i].lo.xyz, boxes[i].hi.xyz); }
  let drawn = seen && !hidden;
  put(SCENE, i, drawn);
  if (hidden) {
    let n = args[i * 5u];
    atomicAdd(&counts[(CASCADES + CU.n.y) * 2u], 1u);
    atomicAdd(&counts[(CASCADES + CU.n.y) * 2u + 1u], n / 3u);
  }
  state[i] = select(0u, STATE_IN_VIEW, seen) | select(0u, STATE_DRAWN, drawn) | select(0u, STATE_HIDDEN, hidden);
  // (the debug view's verdict, in every box's draw)
  let e = (EVERY * CU.n.z + i) * 5u + 4u;
  let verdict = select(select(OUTSIDE, HIDDEN, seen), SHOWN, drawn);
  args[e] = (args[e] & 0xffffffu) | (verdict << 24u);
}
