// What the keepers' world's passes share (levels/beyond.ts): the camera in their world (cm) and its lights, and the
// little geometry both need — rays, where a point lands on the screen, spheres, a direction's place on the sky.
#include "weft/frame"

struct BV {
  eye: vec3f, tanHalf: f32,        // the camera (cm), tan(fovY / 2)
  fwd: vec3f, aspect: f32,
  right: vec3f, pxAngle: f32,      // radians per pixel
  up: vec3f, time: f32,
  world: vec4f,                    // the middle of their world, its sky's radius
  orb: vec4f,                      // our universe's marble (its glass)
  orbLight: vec4f,                 // its light (rgb), w its reach (cm)
  orbB: vec4f,                     // the second keeper's own
  orbBLight: vec4f,
  key: vec4f, keyColor: vec4f,     // toward the sky's brightest, its light
  rim: vec4f, rimColor: vec4f,     // from behind
  skyTop: vec4f, skyLow: vec4f,    // the ambient from above and below; w of skyTop: the sky's gain
  view: vec4f,                     // xy 1 / the target's size; z 1: the camera outside their world; w the weight
  counts: vec4u,                   // marbles, thread chunks
  cloud: vec4f,                    // x the cloud sea's height, y its haze's thickness, z the universe image valid
  outside: vec4f,                  // the colour past their sky, from inside (cosmos: black)
}
@group(2) @binding(0) var<uniform> V: BV;

const PI = 3.14159265;

fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn lum(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

fn rayDir(uv: vec2f) -> vec3f {
  let n = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  return normalize(V.fwd + V.right * (n.x * V.tanHalf * V.aspect) + V.up * (n.y * V.tanHalf));
}
// a point's place on the screen (uv), as this camera sees it
fn uvOf(p: vec3f) -> vec2f {
  let r = p - V.eye;
  let z = max(dot(r, V.fwd), 1e-4);
  let n = vec2f(dot(r, V.right) / (z * V.tanHalf * V.aspect), dot(r, V.up) / (z * V.tanHalf));
  return vec2f(n.x * 0.5 + 0.5, 0.5 - n.y * 0.5);
}
fn sphere(ro: vec3f, rd: vec3f, c: vec3f, r: f32) -> vec2f {
  let oc = ro - c;
  let b = dot(oc, rd);
  let h = b * b - (dot(oc, oc) - r * r);
  if (h < 0.0) { return vec2f(-1.0); }
  let s = sqrt(h);
  return vec2f(-b - s, -b + s);
}
fn equirect(n: vec3f) -> vec2f { return vec2f(atan2(n.z, n.x) / (2.0 * PI) + 0.5, acos(clamp(n.y, -1.0, 1.0)) / PI); }
fn turnAbout(v: vec3f, k: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
fn fresnel(c: f32) -> f32 { let m = 1.0 - clamp(c, 0.0, 1.0); return 0.04 + 0.96 * m * m * m * m * m; }
