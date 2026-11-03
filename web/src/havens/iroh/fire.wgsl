// Firebending, drawn (fire.ts keeps the flames): each flame a quad standing up toward the camera — a held flame a
// flickering teardrop over a palm or a fingertip (a white-gold core, orange round it, a red rim, its tip licking up and
// tearing off), a fireball a rolling round puff (a hot core, its edge broken by noise) that cools to red and smoke-dark
// as it dies. Emissive: the colour is designed on the screen and given as this frame's exposure needs to show it, its
// core pushed past white so the bloom haloes it. Premultiplied, no depth written, after the opaque world.
#include "./../world/world.wgsl"

struct FireU {
  counts: vec4f,   // x flames, y time
}
@group(2) @binding(0) var<uniform> FU: FireU;
@group(2) @binding(1) var<storage, read> flames: array<vec4f>;  // 3 per flame: xyz, w size | up xyz, w heat (0..1) | x kind (0 held, 1 fireball), y seed, z age (0..1), w -

fn srgbToLin(c: vec3f) -> vec3f { return pow(max(c, vec3f(0.0)), vec3f(2.2)); }
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), u.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn fbm(p: vec2f) -> f32 { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.1 + 3.1) + 0.15 * vnoise(p * 4.3 + 7.7); }

struct FOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) f: u32, @location(2) world: vec3f }

@vertex fn vsFlame(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> FOut {
  let A = flames[ii * 3u]; let B = flames[ii * 3u + 1u]; let C = flames[ii * 3u + 2u];
  let q = vec2f(f32(vi & 1u), f32((vi >> 1u) & 1u));
  let toCam = normalize(frame.camPos - A.xyz);
  var up = normalize(B.xyz);
  var side = cross(up, toCam);
  if (length(side) < 1e-3) { side = frame.camRight; }
  side = normalize(side);
  let ball = C.x > 0.5;
  // (a held flame stands on its point, twice as tall as wide; a fireball is round, centred)
  let w = A.w * select(0.55, 1.0, ball);
  let h = A.w * select(1.6, 1.0, ball);
  let base = select(A.xyz - up * h * 0.12, A.xyz - up * h * 0.5, ball);
  let p = base + side * (q.x * 2.0 - 1.0) * w + up * q.y * h + toCam * A.w * 0.3;
  var o: FOut;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.uv = vec2f(q.x * 2.0 - 1.0, q.y);
  o.f = ii;
  o.world = p;
  return o;
}

@fragment fn fsFlame(i: FOut) -> @location(0) vec4f {
  let B = flames[i.f * 3u + 1u]; let C = flames[i.f * 3u + 2u];
  let heat = B.w;
  let seed = C.y;
  let t = FU.counts.y;
  var u = i.uv;
  var core = 0.0; var body = 0.0;
  if (C.x < 0.5) {
    // the held flame: a teardrop on its point, its width swaying and its tip licking up in the noise
    let n = fbm(vec2f(u.x * 2.0 + seed * 7.0, u.y * 3.0 - t * 5.5));
    let sway = (vnoise(vec2f(t * 3.1 + seed * 5.0, 0.0)) - 0.5) * 0.35 * u.y * u.y;
    let x = u.x - sway;
    let y = u.y + (n - 0.5) * 0.28 * u.y;
    let r = 0.85 * sqrt(max(y, 0.0)) * pow(max(1.0 - y, 0.0), 0.9) * 1.6;
    let d = abs(x) / max(r, 1e-3);
    body = (1.0 - smoothstep(0.75, 1.0, d)) * smoothstep(0.0, 0.05, y) * (1.0 - smoothstep(0.88, 0.98, y));
    core = (1.0 - smoothstep(0.2, 0.55, d)) * smoothstep(0.05, 0.18, y) * (1.0 - smoothstep(0.35, 0.65, y));
  } else {
    // the fireball: round, its edge torn by noise rolling up through it, cooling as it ages
    let p = u * vec2f(1.0, 2.0) - vec2f(0.0, 1.0);
    let n = fbm(p * 2.3 + vec2f(seed * 9.0, -t * 3.0));
    let d = length(p) + (n - 0.5) * 0.55;
    body = 1.0 - smoothstep(0.62, 0.85, d);
    core = (1.0 - smoothstep(0.1, 0.45, d)) * (1.0 - C.z);
  }
  if (body <= 0.002) { discard; }
  let age = C.z;
  // white-gold core, orange, a red rim; an old fireball dark at its edge
  var c = mix(vec3f(0.95, 0.36, 0.08), vec3f(1.0, 0.62, 0.16), smoothstep(0.0, 0.7, body));
  c = mix(c, vec3f(1.0, 0.93, 0.7), core);
  c = mix(c, vec3f(0.5, 0.1, 0.05), smoothstep(0.55, 1.0, age) * (1.0 - core));
  let glow = (1.2 + 3.0 * core) * mix(0.6, 1.0, heat) * (1.0 - 0.7 * smoothstep(0.6, 1.0, age));
  let a = body * heat * (1.0 - smoothstep(0.75, 1.0, age));
  let lin = srgbToLin(c) * glow / max(world.exposure, 1e-9);
  // (through the air between it and the camera; mostly added light, a little coverage so it reads over a bright sky)
  return vec4f(lin * aerial(i.world).a * a, a * 0.25);
}
