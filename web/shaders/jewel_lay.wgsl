// The jewel laid into the cell's light (jewel.wgsl drew it): its light, and the depth of its glass's front (from inside
// it, its middle's) so the focus and the bloom take it as they take everything.
#include "weft/frame"
#include "weft/fullscreen"

struct Jewel {
  center: vec3f, radius: f32,
  inner: vec4f,
  tint: vec4f,
  flags: vec4f,
}
@group(2) @binding(0) var<uniform> J: Jewel;
@group(2) @binding(1) var jewelTex: texture_2d<f32>;

fn rayOf(uv: vec2f) -> vec3f {
  let n = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let th = tan(frame.fovY * 0.5);
  return normalize(frame.camFwd + frame.camRight * (n.x * th * frame.aspect) + frame.camUp * (n.y * th));
}
fn hitJ(ro: vec3f, rd: vec3f, c: vec3f, r: f32) -> vec2f {
  let oc = ro - c;
  let b = dot(oc, rd);
  let h = b * b - (dot(oc, oc) - r * r);
  if (h < 0.0) { return vec2f(-1.0); }
  let s = sqrt(h);
  return vec2f(-b - s, -b + s);
}

struct LayOut { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 }
@fragment fn fs(in: FullscreenOut) -> LayOut {
  let j = textureSampleLevel(jewelTex, samp_linear, in.uv, 0.0);
  if (j.a < 0.004) { discard; }
  let ro = frame.camPos;
  let rd = rayOf(in.uv);
  let h = hitJ(ro, rd, J.center, J.radius);
  var o: LayOut;
  o.color = j;
  // (from inside the glass, its middle's distance: the focus is there, and the world inside should be sharp)
  let p = ro + rd * select(h.x, length(J.center - ro), h.x <= 0.0);
  let cl = frame.viewProj * vec4f(p, 1.0);
  o.depth = clamp(cl.z / cl.w, 0.0, 1.0);
  return o;
}
