// The lab round the plate (lab/lab.ts): the bench it stands on and the room past it, drawn behind the well's own
// picture (Hepatocyte's, laid over this) wherever that has nothing. One ray per pixel against the bench's top, in the
// plate's millimetres (x along its columns, z down its rows, y up from the middle of its top face, the bench 11.2 mm
// below that). Black epoxy resin, matte with a broad sheen of the ceiling's panels in it (it meets air: the one place a
// highlight belongs), the plate's soft shadow on it under the room's overhead light, and the room going dim past it.
#include "weft/fullscreen"

struct BenchU {
  eye: vec3f, tanHalf: f32,
  fwd: vec3f, aspect: f32,
  right: vec3f, benchY: f32,
  up: vec3f, shows: f32,
  // the plate's footprint (half its width and depth, mm), the room's light
  plate: vec2f, light: f32, spare: f32,
}
@group(1) @binding(0) var<uniform> B: BenchU;

fn hash2(p: vec2f) -> f32 { var q = fract(p * vec2f(123.34, 456.21)); q += dot(q, q + 45.32); return fract(q.x * q.y); }
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2f(1.0, 0.0)), u.x), mix(hash2(i + vec2f(0.0, 1.0)), hash2(i + vec2f(1.0, 1.0)), u.x), u.y);
}
/** how far a point is outside a rectangle about the origin (mm; negative inside) */
fn sdBox(p: vec2f, h: vec2f) -> f32 { let d = abs(p) - h; return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0); }

/** the room seen along a direction: dim walls, the ceiling's panels a little brighter overhead */
fn room(rd: vec3f) -> vec3f {
  let up = rd.y;
  var c = mix(vec3f(0.016, 0.017, 0.019), vec3f(0.040, 0.041, 0.044), smoothstep(-0.2, 0.5, up));
  // (long panels of light overhead, soft: a frosted diffuser seen out of focus)
  let pan = smoothstep(0.55, 0.9, up) * (0.5 + 0.5 * smoothstep(0.2, 0.8, abs(sin(atan2(rd.z, rd.x) * 3.0))));
  return (c + vec3f(0.30, 0.31, 0.32) * pan) * B.light;
}

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let ndc = vec2f(i.uv.x * 2.0 - 1.0, 1.0 - i.uv.y * 2.0);
  let rd = normalize(B.fwd + B.right * (ndc.x * B.tanHalf * B.aspect) + B.up * (ndc.y * B.tanHalf));
  var col = room(rd);
  let dy = B.benchY - B.eye.y;
  if (rd.y < -1e-4 && dy < 0.0) {
    let t = dy / rd.y;
    let p = B.eye + rd * t;
    // the resin: near black, a faint fleck and a slow mottle in it
    let fleck = vnoise(p.xz * 1.7) * 0.6 + vnoise(p.xz * 0.11) * 0.4;
    var alb = vec3f(0.040, 0.042, 0.046) * (0.85 + 0.3 * fleck);
    // the light: the room's overhead panels, most of it straight down, shadowed under and round the plate
    let d = sdBox(p.xz, B.plate);
    let shadow = mix(0.22, 1.0, smoothstep(-6.0, 26.0, d));
    var c = alb * 1.5 * shadow * B.light;
    // its sheen: the panels' light at a grazing angle (Fresnel, F0 4% for resin in air), blurred by its matte top
    let v = -rd;
    let fres = 0.04 + 0.96 * pow(1.0 - max(v.y, 0.0), 5.0);
    let refl = room(reflect(rd, vec3f(0.0, 1.0, 0.0)));
    c += refl * fres * 0.55 * mix(0.35, 1.0, smoothstep(-4.0, 14.0, d));
    // (and it goes into the room's dimness far off: the bench is a couple of metres long)
    let far = smoothstep(500.0, 1600.0, length(p.xz));
    col = mix(c, room(rd) * 0.8, far);
  }
  return vec4f(col * B.shows, 1.0);
}
