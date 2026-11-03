// The GPU cull's views (cull.ts), for every cull shader: the parts' (cull.wgsl) and any renderer's own — a shader
// that includes this file, binds `CU` and `hiz` to the Cull's (Cull.views) and runs its compute at one of the Cull's
// hooks gets each view's frustum test and the scene's occlusion test as the parts have them. Group 2, bindings 0 and 5
// are these; a shader's own are the rest.
struct CullU {
  planes: array<vec4f, 48>,   // six per view, inward: the scene's first, then each cascade's
  viewProj: mat4x4f,          // the scene's (reversed-Z): the occlusion test's
  eye: vec4f,                 // xyz the scene's camera (world m), w how near a box is to be an occluder (m)
  screen: vec4f,              // xy the render's size (px), z the pyramid's levels
  n: vec4u,                   // x the parts' boxes, y the cascades, z the boxes in each region of the parts' draws,
                              // w FLAG_* | the cascades drawn this frame << 8 (one bit each: those not drawn aren't culled)
}

@group(2) @binding(0) var<uniform> CU: CullU;
// the occluders' depth pyramid (hiz.wgsl): each texel the farthest (reversed-Z: the least) depth under it
@group(2) @binding(5) var hiz: texture_2d<f32>;

const FLAG_OCCLUSION = 1u;
const FLAG_FROZEN = 2u;

// a box (world m) in a view's frustum: 0 the scene's, 1 + c cascade c's
fn inFrustum(view: u32, lo: vec3f, hi: vec3f) -> bool {
  // (the box's corner farthest along each plane's normal, inside it or the box is out)
  for (var k = 0u; k < 6u; k++) {
    let p = CU.planes[view * 6u + k];
    if (dot(p.xyz, select(lo, hi, p.xyz > vec3f(0.0))) + p.w < 0.0) { return false; }
  }
  return true;
}

// cascade c drawn this frame (one that isn't: leave its draws as they are)
fn cascadeDrawn(c: u32) -> bool { return (CU.n.w & (256u << c)) != 0u; }

// the scene's verdicts frozen (the debug view): leave the scene's draws as they are
fn frozen() -> bool { return (CU.n.w & FLAG_FROZEN) != 0u; }

// the farthest depth over a pyramid level's texels a..b (at most 5x5 of them), or as soon as it's no farther than
// `near` (the box can't be hidden)
fn farthest(a: vec2u, b: vec2u, level: u32, near: f32) -> f32 {
  let q = min(b, vec2u(textureDimensions(hiz, level)) - 1u);
  var d = 1.0;
  for (var y = a.y; y <= q.y; y++) {
    for (var x = a.x; x <= q.x; x++) {
      d = min(d, textureLoad(hiz, vec2u(x, y), level).r);
      if (d <= near) { return d; }
    }
  }
  return d;
}

// a box in the scene's frustum wholly behind the occluders: the pixels its rectangle on screen touches (all of them,
// every corner projected) each already nearer than the box's nearest corner. A corner at or behind the eye, or no
// occlusion this frame (nothing near enough to occlude, or switched off): not hidden. Valid only after the pyramid
// is made (the Cull's 'occlude' hook)
fn occluded(lo: vec3f, hi: vec3f) -> bool {
  if ((CU.n.w & FLAG_OCCLUSION) == 0u) { return false; }
  var mn = vec2f(1e9);
  var mx = vec2f(-1e9);
  var near = 0.0;
  for (var k = 0u; k < 8u; k++) {
    let c = vec3f(select(lo.x, hi.x, (k & 1u) != 0u), select(lo.y, hi.y, (k & 2u) != 0u), select(lo.z, hi.z, (k & 4u) != 0u));
    let q = CU.viewProj * vec4f(c, 1.0);
    if (q.w <= 1e-3) { return false; }
    let ndc = q.xyz / q.w;
    mn = min(mn, ndc.xy);
    mx = max(mx, ndc.xy);
    near = max(near, ndc.z);
  }
  let size = CU.screen.xy;
  // (pixels, y down)
  let p0 = clamp(vec2f(mn.x, -mx.y) * 0.5 + 0.5, vec2f(0.0), vec2f(1.0)) * size;
  let p1 = clamp(vec2f(mx.x, -mn.y) * 0.5 + 0.5, vec2f(0.0), vec2f(1.0)) * size;
  let a = vec2u(min(floor(p0), size - 1.0));
  let b = vec2u(min(floor(p1), size - 1.0));
  // the level whose texels (2^(level+1) px a side) are at least a quarter as wide as the rectangle: it lies in at
  // most 5x5 of them (a coarser level's would take in more of what's round it: the sky over the roofs in front)
  let span = max(b.x - a.x, b.y - a.y);
  let s = max(1u, 32u - countLeadingZeros(span >> 2u));
  let level = s - 1u;
  if (f32(level) >= CU.screen.z) { return false; }
  // (a hair of margin toward drawing it)
  let n = near * 1.00001;
  return n < farthest(a >> vec2u(s), b >> vec2u(s), level, n);
}
