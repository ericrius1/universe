// motionblur.wgsl's body (the depth declared there).
// Camera motion blur (after the waterbending game's): each pixel reprojected into the last frame — the world taken as
// still — and blurred along that screen motion over a fraction of the frame (the shutter). What's within a few metres
// of the lens is kept sharp, and so is the heroine: inside her circle on screen a pixel moves as she does across it
// (a camera tracking her keeps her crisp however fast it swings), and nothing behind her is smeared over her.
// Flying fast, the game's speed lines too: thin bright streaks raying out from the middle of the picture (where she
// flies), its middle clear, dealt anew fifteen times a second so they flicker past. The scene itself stays sharp here;
// camera motion is already handled by the depth-aware blur below, while a second radial blur stretched distant terrain.
#include "./../world/world.wgsl"
#include "weft/fullscreen"

struct MotionU {
  a: vec4f,      // x shutter (1 = a whole frame's motion), y max length (px), z near mask start, w end (m)
  her: vec4f,    // her circle: centre (px), radius (px; 0 none), distance (m)
  herV: vec4f,   // her own motion on screen (px), taps, -
  speed: vec4f,  // the speed lines: x weight (0 none), y lines round, z their reach, w the clear middle (of the height)
  deal: vec4f,   // x the deal (which lines show), y the picture's middle (of its height, from the top)
}
@group(2) @binding(0) var<uniform> MU: MotionU;
@group(2) @binding(1) var src: texture_2d<f32>;

fn depthAt(c: vec2i) -> f32 { return max(textureLoad(depth, c, 0), 1e-7); }
fn lhash(p: vec2f) -> f32 { var q = fract(vec3f(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }

/** the speed lines over a colour (without resampling the scene into radial streaks) */
fn speedLines(c0: vec3f, c: vec2i, dim: vec2i) -> vec3f {
  let S = MU.speed;
  if (S.x <= 0.001) { return c0; }
  let res = vec2f(dim);
  let uv = (vec2f(c) + 0.5) / res;
  let asp = res.x / res.y;
  let d = (uv - vec2f(0.5, MU.deal.y)) * vec2f(asp, 1.0);
  let r = length(d);
  let ang = atan2(d.y, d.x);
  let col = c0;
  // (the lines: angular bins, about half of them a streak, each with its own start, reach and thickness)
  let u = fract(ang / 6.2832 + 0.5) * S.y;
  let bin = floor(u);
  let h = lhash(vec2f(bin, MU.deal.x));
  let h2 = lhash(vec2f(bin * 1.7 + 0.3, MU.deal.x + 3.1));
  let off = abs(fract(u) - 0.5);
  let thick = 0.05 + 0.08 * h2;
  let start = S.w + 0.3 * h2;
  let reach = S.z * (0.5 + 0.5 * h);
  let along = smoothstep(start, start + 0.14, r) * (1.0 - smoothstep(start + reach * 0.55, start + reach, r));
  // (a third of the bins carry a streak; they're strongest toward the picture's edges)
  let lines = smoothstep(thick, thick * 0.3, off) * step(0.66, h) * along * smoothstep(0.25, 0.75, r);
  // (a lift of the colour under them rather than flat white: the air rushing past, part of the picture)
  let lift = col * 1.7 + vec3f(1.0, 0.98, 0.94) * (0.35 / max(world.exposure, 1e-6));
  return mix(col, lift, lines * S.x * 0.32);
}

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let dim = vec2i(textureDimensions(src));
  let c = clamp(vec2i(i.uv * vec2f(dim)), vec2i(0), dim - 1);
  let srcC = textureLoad(src, c, 0);
  let d = depthAt(c);
  let uv = (vec2f(c) + 0.5) / vec2f(dim);
  // (unnormalised: a homogeneous point reprojects the same, the sky's points at infinity too)
  let wp = frame.invViewProj * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, d, 1.0);
  let pc = frame.prevViewProj * wp;
  if (pc.w <= 1e-6) { return vec4f(speedLines(srcC.rgb, c, dim), srcC.a); }
  let puv = vec2f(pc.x / pc.w * 0.5 + 0.5, 0.5 - pc.y / pc.w * 0.5);
  let ld = frame.near / d;
  let onHer = MU.her.z > 0.0 && distance(vec2f(c), MU.her.xy) < MU.her.z && abs(ld - MU.her.w) < 1.5;
  var vel = select((uv - puv) * vec2f(dim), MU.herV.xy, onHer) * MU.a.x * smoothstep(MU.a.z, MU.a.w, ld);
  let L = length(vel);
  if (L < 0.75) { return vec4f(speedLines(srcC.rgb, c, dim), srcC.a); }
  vel *= min(1.0, MU.a.y / L);
  let j = fract(52.9829189 * fract(dot(vec2f(c), vec2f(0.06711056, 0.00583715))));
  let n = i32(clamp(MU.herV.z, 4.0, 32.0));
  var acc = vec3f(0.0);
  var ws = 0.0;
  for (var k = 0; k < n; k++) {
    let q = clamp(vec2i(vec2f(c) + vel * ((f32(k) + j) / f32(n) - 0.5)), vec2i(0), dim - 1);
    let lq = frame.near / depthAt(q);
    // (a tap on something much nearer — her, a branch by the lens — isn't smeared over this pixel)
    let qHer = MU.her.z > 0.0 && distance(vec2f(q), MU.her.xy) < MU.her.z && abs(lq - MU.her.w) < 1.5;
    let w = select(1.0, 0.0, (lq < ld * 0.6 && lq < MU.a.w) || (qHer && !onHer));
    acc += textureLoad(src, q, 0).rgb * w;
    ws += w;
  }
  return vec4f(speedLines(select(srcC.rgb, acc / ws, ws > 0.5), c, dim), srcC.a);
}
