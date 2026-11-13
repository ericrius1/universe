// San Francisco's fog, between the Earth seen from a few kilometres up and the bench (lab/lab.ts, lab/way.ts): a
// white-out laid over whatever the frame has, never a picture of anything. Not blank: soft wisps that drift and turn
// over as the zoom goes through it (the zoom is one of the noise's axes), brighter and thinner by turns, lit by the sky
// over the city (dark at night), its last tatters parting a couple of metres over the bench.
#include "weft/fullscreen"

struct FogU {
  // how white (0..1), the zoom (log10 m), the time (s), the screen's aspect
  amount: f32, zoom: f32, time: f32, aspect: f32,
  // the fog's light (HDR), and a spare
  color: vec3f, spare: f32,
}
@group(1) @binding(0) var<uniform> F: FogU;

fn hash3(p: vec3f) -> f32 { var q = fract(p * 0.1031); q += dot(q, q.zyx + 31.32); return fract((q.x + q.y) * q.z); }
fn vnoise3(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3f(1, 0, 0)), u.x), mix(hash3(i + vec3f(0, 1, 0)), hash3(i + vec3f(1, 1, 0)), u.x), u.y),
             mix(mix(hash3(i + vec3f(0, 0, 1)), hash3(i + vec3f(1, 0, 1)), u.x), mix(hash3(i + vec3f(0, 1, 1)), hash3(i + vec3f(1, 1, 1)), u.x), u.y), u.z);
}

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let a = F.amount;
  if (a <= 0.001) { discard; }
  // (the zoom as depth: a decade is a few of the wisps' own sizes, so going through it they come and go)
  let q = vec3f((i.uv - 0.5) * vec2f(F.aspect, 1.0) * 2.2, F.zoom * 1.6);
  let drift = vec3f(F.time * 0.021, F.time * 0.006, F.time * 0.013);
  let n = vnoise3(q + drift) * 0.5 + vnoise3(q * 2.1 - drift * 1.7 + 7.0) * 0.3 + vnoise3(q * 4.3 + drift * 2.3 + 3.0) * 0.2;
  // white where it's thick; where it thins, the frame behind it, first in tatters
  let cover = select(smoothstep(0.0, 1.0, a * 1.9 - 0.95 + n * 0.9), 1.0, a >= 0.999);
  // (thicker and thinner by turns: brighter where it's thick toward the sun, a cool grey in its hollows)
  let shade = mix(vec3f(0.72, 0.76, 0.82), vec3f(1.04, 1.03, 1.0), smoothstep(0.25, 0.75, n));
  let col = F.color * shade * mix(1.0, 0.92, smoothstep(0.2, 0.9, length(i.uv - 0.5)));
  return vec4f(col * cover, cover);
}
