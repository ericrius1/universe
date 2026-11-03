// smudge.wgsl's body (the depth declared there).
// Contour smudging (after Florian Hoenig's distant forests): far away, the outline of every crown against what's behind
// it — another ridge, the sky — is a hard, aliased, level-of-detail edge the eye picks out. Where the depth jumps and
// the nearer side is far, blend the pixel toward its neighbourhood across the edge, a little more the farther it is,
// so distant forest reads as soft massed canopy instead of a field of cut-outs. Near things are untouched.
#include "weft/frame"
#include "weft/fullscreen"

struct SmudgeU { p: vec4f }   // x strength, y start distance (m), z full distance (m), w radius (px)
@group(2) @binding(0) var<uniform> SU: SmudgeU;
@group(2) @binding(1) var src: texture_2d<f32>;

fn dist(px: vec2i) -> f32 {
  let s = vec2i(textureDimensions(depth));
  let d = textureLoad(depth, clamp(px, vec2i(0), s - 1), 0);
  return select(frame.near / d, 1e7, d <= 0.0);
}

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(src));
  let px = vec2i(i.uv * size);
  let c = textureLoad(src, px, 0);
  let d0 = dist(px);
  let far = smoothstep(SU.p.y, SU.p.z, min(d0, 5000.0));
  if (far <= 0.0 || SU.p.x <= 0.0) { return c; }
  let r = SU.p.w * (0.6 + 0.6 * far) * size.y / 1080.0;
  var acc = vec3f(0.0);
  var wsum = 0.0;
  var edge = 0.0;
  for (var k = 0; k < 8; k++) {
    let a = f32(k) * 0.7853982 + 0.3927;
    let o = vec2i(round(vec2f(cos(a), sin(a)) * r));
    let dn = dist(px + o);
    // an edge: the depths differ by a good fraction
    let e = smoothstep(0.04, 0.25, abs(dn - d0) / max(min(dn, d0), 1.0));
    edge = max(edge, e);
    let cn = textureLoad(src, clamp(px + o, vec2i(0), vec2i(size) - 1), 0).rgb;
    acc += cn;
    wsum += 1.0;
  }
  let k = SU.p.x * far * edge;
  return vec4f(mix(c.rgb, acc / wsum, k * 0.75), c.a);
}
