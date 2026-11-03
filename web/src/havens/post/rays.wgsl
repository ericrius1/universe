// The key light through the lens and the air, at reduced resolution (post/fx.ts runs them after the clouds):
//   measure   one workgroup: how much of the sun's (or moon's) disc is in clear sky — trees, ridges, the house and the
//             clouds (the scene's alpha holds what they let through) all count — and the distance at the middle of
//             the frame (the depth of field's autofocus); both eased over a few frames
//   shafts    crepuscular rays: that same open sky as a half-res mask, then two nested quarter-res radial blurs of it
//             toward the light, so gaps in the crowns and the clouds throw beams through the air
//   dof       depth of field (films): half-res, a disc gathered per pixel, sized by its circle of confusion
#include "./../world/world.wgsl"
#include "./fxu.wgsl"
#include "weft/fullscreen"

@group(2) @binding(11) var sceneZ: texture_2d<f32>;
@group(2) @binding(12) var hdrTex: texture_2d<f32>;
@group(2) @binding(13) var src: texture_2d<f32>;
@group(2) @binding(14) var<storage, read_write> fxState: array<f32, 4>;   // x the light's visibility, y the autofocus (m)
@group(2) @binding(15) var<storage, read> fxRead: array<f32, 4>;

// (the sky's distance as a half-float target holds it: scenez.wgsl)
const SKY = 6e4;
const SUN_RADIUS = 0.00467;

fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }

// open sky at a screen uv: 1 where nothing was drawn, times what the clouds let through
fn skyOpen(uv: vec2f) -> f32 {
  let dim = vec2f(textureDimensions(sceneZ));
  let px = vec2i(clamp(uv, vec2f(0.0), vec2f(0.9999)) * dim);
  let z = textureLoad(sceneZ, px, 0).x;
  let open = z >= SKY;
  return select(0.0, saturate(textureLoad(hdrTex, px, 0).a), open);
}

// ------------------------------------------------------------------ measure
var<workgroup> wgV: array<f32, 64>;
var<workgroup> wgZ: array<f32, 64>;

@compute @workgroup_size(64) fn measure(@builtin(local_invocation_index) li: u32) {
  let s = keyOnScreen();
  // a disc twice the light's: a vogel spiral of 64 taps
  let r = sqrt((f32(li) + 0.5) / 64.0) * 2.0;
  let a = f32(li) * 2.39996323;
  let k = tan(SUN_RADIUS) / tan(frame.fovY * 0.5) * 0.5;
  let uv = s.xy + vec2f(cos(a) / frame.aspect, sin(a)) * r * k;
  let inside = all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0));
  // (off the screen: assume the open sky the light usually stands in, a little dimmed; from a room, its walls)
  wgV[li] = select(0.7, skyOpen(uv), inside) * select(0.0, 1.0, s.z > 0.0);
  // the middle of the frame, the nearest of a small cross
  let dim = vec2f(textureDimensions(sceneZ));
  let c = vec2f(0.5) + vec2f(f32(li % 8u) - 3.5, f32(li / 8u) - 3.5) * 0.004;
  wgZ[li] = min(textureLoad(sceneZ, vec2i(c * dim), 0).x, 2.0e4);
  workgroupBarrier();
  var n = 32u;
  while (n > 0u) {
    if (li < n) { wgV[li] += wgV[li + n]; wgZ[li] = min(wgZ[li], wgZ[li + n]); }
    workgroupBarrier();
    n = n / 2u;
  }
  if (li == 0u) {
    let v = wgV[0] / 64.0;
    let first = fxState[3] < 0.5;
    // (eased over a few frames: a time-lapse's clouds racing over the sun don't make its flare flicker)
    fxState[0] = select(mix(fxState[0], v, 0.25), v, first);
    // (focus pulls in log space, a little over a quarter second)
    let z = max(wgZ[0], 0.3);
    fxState[1] = select(exp(mix(log(max(fxState[1], 0.3)), log(z), 0.12)), z, first);
    fxState[3] = 1.0;
  }
}

// ------------------------------------------------------------------ shafts
@fragment fn skymask(i: FullscreenOut) -> @location(0) vec4f { return vec4f(skyOpen(i.uv), 0.0, 0.0, 1.0); }

override SHAFT_PASS: u32 = 0u;
const SHAFT_N = 24;

@fragment fn shafts(i: FullscreenOut) -> @location(0) vec4f {
  let s = keyOnScreen();
  if (s.z <= 0.0) { return vec4f(0.0); }
  var dir = s.xy - i.uv;
  let len = length(dir * vec2f(frame.aspect, 1.0));
  dir *= min(1.0, FX.rays.y / max(len, 1e-5));
  let jit = ign(i.pos.xy + f32(u32(FX.misc.x) % 64u) * 5.588);
  // (a tap past the screen's edge counts as open sky only while the light itself is near the frame: far off it, the
  // sky out there is unknown)
  let off = max(max(-s.x, s.x - 1.0), max(-s.y, s.y - 1.0));
  let outside = 0.6 * smoothstep(0.5, 0.15, off);
  var acc = 0.0; var ws = 0.0; var w = 1.0;
  if (SHAFT_PASS == 0u) {
    let step = dir / f32(SHAFT_N);
    for (var k = 0; k < SHAFT_N; k++) {
      let q = i.uv + step * (f32(k) + jit);
      let inside = all(q >= vec2f(0.0)) && all(q <= vec2f(1.0));
      acc += select(outside, textureSampleLevel(src, samp_linear, q, 0.0).r, inside) * w;
      ws += w; w *= FX.rays.z;
    }
  } else {
    // (the second blur fills in between the first one's taps)
    let step = dir / f32(SHAFT_N * SHAFT_N);
    let decay = pow(FX.rays.z, 1.0 / f32(SHAFT_N));
    for (var k = 0; k < SHAFT_N; k++) {
      acc += textureSampleLevel(src, samp_linear, i.uv + step * (f32(k) + jit), 0.0).r * w;
      ws += w; w *= decay;
    }
  }
  return vec4f(acc / ws, 0.0, 0.0, 1.0);
}

// ------------------------------------------------------------------ depth of field
fn focusDist() -> f32 { return select(fxRead[1], FX.dof.y, FX.dof.y > 0.0); }
// the circle of confusion's radius (px at this resolution) at a distance
fn coc(z: f32) -> f32 {
  let k = f32(textureDimensions(sceneZ).y) / 1080.0;
  return min(FX.dof.z * abs(1.0 - focusDist() / max(z, 0.05)), FX.dof.w) * k;
}

@fragment fn dof(i: FullscreenOut) -> @location(0) vec4f {
  let dim = vec2f(textureDimensions(sceneZ));
  let zc = textureLoad(sceneZ, vec2i(i.uv * dim), 0).x;
  let cc = coc(min(zc, 1e6));
  var acc = vec3f(0.0); var ws = 0.0;
  let R = max(cc, 1.0);
  for (var k = 0; k < 40; k++) {
    let f = (f32(k) + 0.5) / 40.0;
    let a = f32(k) * 2.39996323;
    let o = vec2f(cos(a), sin(a)) * sqrt(f) * R;
    let q = i.uv + o / dim;
    let zt = textureLoad(sceneZ, vec2i(clamp(q, vec2f(0.0), vec2f(0.9999)) * dim), 0).x;
    let ct = coc(min(zt, 1e6));
    // a tap blurs over this pixel if its own circle reaches it; nearer taps spill over a sharp background
    let reach = select(min(ct, cc), max(ct, cc), zt < zc);
    let w = saturate(reach - length(o) + 1.0);
    acc += textureSampleLevel(src, samp_linear, q, 0.0).rgb * w;
    ws += w;
  }
  return vec4f(acc / max(ws, 1e-4), cc);
}
