// The bent water's depth smoothing (render.ts), ported from the waterbending app: the narrow-range filter (Truong &
// Yuksel 2018) as a 2D filter over a disc of taps rather than two separable passes. Neighbours far behind the centre
// are clamped to a threshold instead of being averaged in (keeps silhouettes), neighbours far in front are ignored, and
// the empty background counts as "behind" only weakly (a separable pass clamping each column on its own smeared the
// silhouettes into vertical streaks). Ice is smoothed less. It carries the depth alone (r32float: the app carried the
// raw sample's ice and speed through every pass, at three times the memory); the ice is read from the raw depth.
#include "weft/frame"

struct SmoothU { radiusPx: f32, threshold: f32, worldRadius: f32, passIdx: f32 }
@group(2) @binding(0) var<uniform> SM: SmoothU;
@group(2) @binding(1) var src: texture_2d<f32>;   // depth (x): the raw sample's, or the last pass's
@group(2) @binding(2) var raw: texture_2d<f32>;   // the raw sample: depth, ice
@group(2) @binding(3) var dst: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn smoothPass(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(src);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  let c = vec2i(id.xy);
  let z0 = textureLoad(src, c, 0).x;
  if (z0 <= 0.0) { textureStore(dst, c, vec4f(z0, 0.0, 0.0, 0.0)); return; }
  let ice = textureLoad(raw, c, 0).y;
  // filter radius: a fixed world size projected to pixels, less for ice
  let rpx = clamp(SM.worldRadius * frame.proj[1][1] * f32(dim.y) * 0.5 / z0 * mix(1.0, 0.35, ice), 1.0, SM.radiusPx);
  let thr = SM.threshold;
  // a golden-angle spiral of taps over the disc, the same for every pixel (a per-pixel rotation leaves noise in the
  // depth that the normals turn into glitter), turned between passes so their patterns don't line up
  let rot = SM.passIdx * 1.3;
  var sum = z0;
  var wsum = 1.0;
  for (var i = 1; i < 28; i++) {
    let fi = f32(i);
    let rr = sqrt(fi / 27.0) * rpx;
    let a = fi * 2.39996 + rot;
    let q = c + vec2i(round(vec2f(cos(a), sin(a)) * rr));
    if (any(q < vec2i(0)) || any(q >= vec2i(dim))) { continue; }
    var z = textureLoad(src, q, 0).x;
    let x = rr / rpx;
    var w = exp(-x * x * 2.0);
    // (background: a little pull back, for rounded silhouettes, without dragging them)
    if (z <= 0.0) { z = z0 + thr; w *= 0.35; }
    if (z < z0 - thr) { continue; }
    z = min(z, z0 + thr);
    sum += z * w;
    wsum += w;
  }
  textureStore(dst, c, vec4f(sum / wsum, 0.0, 0.0, 0.0));
}
