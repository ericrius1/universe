// Below the atom (src/loop.ts, cosmos/... none: the cell's own): the bead the zoom goes into, resolving into atoms, one
// atom's cloud, its nucleus, a proton's quarks, the long desert of scales, the foam at the Planck length and the light
// past it (quantum_core.wgsl: qWorld, a pure function of the view, in units of the view distance). Drawn round the bead
// from the cell's camera, then laid into the cell's light with its depth (jewel_lay.wgsl), so the focus and the bloom
// take it as they take everything; past the bead it covers the frame.
#include "world.wgsl"
#include "weft/fullscreen"
#include "quantum_core.wgsl"

struct Quantum {
  center: vec3f, radius: f32,      // the bead's middle (relative to the origin, nm) and radius
  eye: vec3f, L: f32,              // the eye from the bead in view distances (|eye| about 1); log10 of the view distance (m)
  view: vec4f,                     // x time (s), y a pixel's angle, z the universe's ball's radius (view distances), w unused
  flags: vec4f,                    // x on, y depth-tested against the cell (the eye outside the bead)
}
@group(2) @binding(0) var<uniform> J: Quantum;
@group(2) @binding(1) var depthTex: texture_depth_2d;

@fragment fn fs(in: FullscreenOut) -> @location(0) vec4f {
  if (J.flags.x < 0.5) { return vec4f(0.0); }
  let n = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let th = tan(frame.fovY * 0.5);
  let rd = normalize(frame.camFwd + frame.camRight * (n.x * th * frame.aspect) + frame.camUp * (n.y * th));
  // (something of the cell's in front of the bead: not there)
  if (J.flags.y > 0.5) {
    let dims = vec2f(textureDimensions(depthTex));
    let d = textureLoad(depthTex, vec2i(in.uv * dims), 0);
    let tScene = select(1e9, linearDepth(d) / max(dot(rd, frame.camFwd), 1e-4), d > 0.0);
    let oc = frame.camPos - J.center;
    let b = dot(oc, rd);
    let h = b * b - (dot(oc, oc) - J.radius * J.radius);
    if (h > 0.0 && -b - sqrt(h) > tScene + J.radius * 0.1) { return vec4f(0.0); }
  }
  let q = qWorld(J.eye, rd, J.L, J.view.x, J.view.y, in.pos.xy, J.view.z);
  // the bead itself until its atoms cover it (the strand's own gives way to it: beads.wgsl, filament.wgsl): a pearl
  // among the strand's beads, lit as they are, in their haze
  let wb = 1.0 - smoothstep(-9.0, -9.15, J.L);
  if (wb <= 0.0) { return q; }
  let r = J.radius * 1e-9 / pow(10.0, J.L);
  let h = qSphereHit(J.eye, rd, vec3f(0.0), r);
  if (h.x <= 0.0) { return q; }
  let nb = normalize(J.eye + rd * h.x);
  var s: Surf;
  s.albedo = srgb(vec3f(0.78, 0.8, 0.88)); s.sss = srgb(vec3f(0.55, 0.5, 0.62)); s.rough = 0.4; s.wrap = 0.5; s.trans = 0.4; s.rim = 0.8;
  let dist = h.x * pow(10.0, J.L) * 1e9;
  let lit = mix(bioLight(nb, -rd, s), G.fogColor, fogAmount(dist));
  // (its edge a pixel soft)
  let oc = J.eye; let bb = dot(oc, rd); let d = sqrt(max(dot(oc, oc) - bb * bb, 0.0));
  let a = (1.0 - smoothstep(r - J.view.y * h.x, r + J.view.y * h.x, d)) * wb;
  return q + vec4f(lit * a, a) * (1.0 - q.a);
}
