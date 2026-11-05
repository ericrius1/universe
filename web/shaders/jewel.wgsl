// The jewel (src/loop.ts): one bead of the DNA made glass, and inside it the keepers' world — whose sky closes round
// them as ours closes round us, and who hold our universe in a marble of their own. Solved exactly, nothing marched: the
// sphere, the light bent into it (by colour) and the world inside seen through that bend (cosmos/levels/beyond.ts drew
// it from this camera, the same lens, so a point inside is where it lands on the screen), the cell behind it bent
// twice, through and out, upside down as through any ball of glass; the cell round it in its face; glints and a few
// motes of dust in the glass at their own depths. Then laid into the cell's light with its depth, so the focus and the
// bloom take it as they take everything.
#include "world.wgsl"
#include "weft/fullscreen"

override HI: bool = true;

struct Jewel {
  center: vec3f, radius: f32,      // its middle (relative to the origin, nm) and its glass's radius
  inner: vec4f,                    // x the world's light in the cell's terms (gain), y its contrast, z its outside alpha floor
  tint: vec4f,                     // the glass's own colour
  flags: vec4f,                    // x on
}
@group(2) @binding(0) var<uniform> J: Jewel;
@group(2) @binding(1) var litTex: texture_2d<f32>;
@group(2) @binding(2) var depthTex: texture_depth_2d;
@group(2) @binding(3) var worldTex: texture_2d<f32>;

fn ssj(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
// the world's light in the cell's terms: its contrast, and its highlights (a glint can be ninety times white in their
// film, whose bloom takes it) brought under a knee, or the cell's bloom spreads them into a lattice of copies
fn graded(w: vec3f) -> vec3f {
  let g = pow(max(w * J.inner.x, vec3f(0.0)), vec3f(J.inner.y));
  return g / (vec3f(1.0) + g * 0.3);
}
fn rayOf(uv: vec2f) -> vec3f {
  let n = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let th = tan(frame.fovY * 0.5);
  return normalize(frame.camFwd + frame.camRight * (n.x * th * frame.aspect) + frame.camUp * (n.y * th));
}
fn uvOfP(p: vec3f) -> vec2f {
  let c = frame.viewProj * vec4f(p, 1.0);
  let n = c.xy / max(c.w, 1e-6);
  return vec2f(n.x * 0.5 + 0.5, 0.5 - n.y * 0.5);
}
fn hitJ(ro: vec3f, rd: vec3f, c: vec3f, r: f32) -> vec2f {
  let oc = ro - c;
  let b = dot(oc, rd);
  let h = b * b - (dot(oc, oc) - r * r);
  if (h < 0.0) { return vec2f(-1.0); }
  let s = sqrt(h);
  return vec2f(-b - s, -b + s);
}
fn fres(c: f32) -> f32 { let m = 1.0 - clamp(c, 0.0, 1.0); return 0.04 + 0.96 * m * m * m * m * m; }

// the world inside, where a ray bent into the glass at p meets the plane through the middle facing the camera
fn inside(p: vec3f, rr: vec3f, axis: vec3f) -> vec4f {
  let q = p + rr * max(dot(J.center - p, axis) / max(dot(rr, axis), 0.05), 0.0);
  return textureSampleLevel(worldTex, samp_linear, uvOfP(q), 0.0);
}
// the cell behind, through the ball and out of it the far side: as far behind as what's there
fn behind(p: vec3f, rr: vec3f, ior: f32, back: f32) -> vec3f {
  let t2 = hitJ(p + rr * 1e-4, rr, J.center, J.radius).y;
  let p2 = p + rr * max(t2, 0.0);
  let n2 = normalize(p2 - J.center);
  var out = refract(rr, -n2, ior);
  if (dot(out, out) < 0.5) { out = reflect(rr, -n2); }
  let q = p2 + out * back;
  return textureSampleLevel(litTex, samp_linear, clamp(uvOfP(q), vec2f(0.001), vec2f(0.999)), 1.0).rgb;
}
// motes of dust and tiny bubbles in the glass, on two shells at their own depths
fn motes(ro: vec3f, rd: vec3f) -> f32 {
  var s = 0.0;
  for (var k = 0; k < 2; k++) {
    let rk = J.radius * select(0.9, 0.74, k == 1);
    let h = hitJ(ro, rd, J.center, rk);
    for (var side = 0; side < 2; side++) {
      let t = select(h.x, h.y, side == 1);
      if (t <= 0.0) { continue; }
      let q = (ro + rd * t - J.center) / J.radius * 9.0 + vec3f(f32(k) * 13.1);
      let g = floor(q);
      let hsh = hash3i(vec3i(g));
      let d = length(fract(q) - 0.5 - (hsh - 0.5) * 0.6);
      s += step(0.82, hsh.x) * exp(-d * d * 260.0) * select(0.6, 0.35, side == 1);
    }
  }
  return s;
}

@fragment fn fs(in: FullscreenOut) -> @location(0) vec4f {
  if (J.flags.x < 0.5) { return vec4f(0.0); }
  let ro = frame.camPos;
  let rd = rayOf(in.uv);
  let c = J.center; let r = J.radius;
  let inGlass = length(ro - c) < r;
  let h = hitJ(ro, rd, c, r);
  if (h.y < 0.0) { return vec4f(0.0); }
  // (something of the cell's in front of it: not there)
  let dims = vec2f(textureDimensions(depthTex));
  let d = textureLoad(depthTex, vec2i(in.uv * dims), 0);
  let tScene = select(1e9, linearDepth(d) / max(dot(rd, frame.camFwd), 1e-4), d > 0.0);
  if (!inGlass && h.x > tScene + r * 0.15) { return vec4f(0.0); }
  let axis = normalize(c - ro);
  let back = max(tScene - h.y, r * 2.5);
  let dist = length(ro - c);
  // inside the glass (and just out of it, blended, so leaving it is no cut): all of it the world inside, the cell
  // through its gaps, bent on the way out
  var inner = vec3f(0.0);
  let wIn = 1.0 - ssj(r, r * 1.1, dist);
  if (wIn > 0.0) {
    let w = textureSampleLevel(worldTex, samp_linear, in.uv, 0.0);
    let p2 = ro + rd * h.y;
    var o = refract(rd, -normalize(p2 - c), 1.5);
    if (dot(o, o) < 0.5) { o = reflect(rd, -normalize(p2 - c)); }
    let b = textureSampleLevel(litTex, samp_linear, clamp(uvOfP(p2 + o * back), vec2f(0.001), vec2f(0.999)), 1.0).rgb;
    inner = graded(w.rgb) + b * (1.0 - w.a) * J.tint.rgb;
  }
  if (inGlass) { return vec4f(inner, 1.0); }
  let p = ro + rd * h.x;
  let n = normalize(p - c);
  let cosi = -dot(rd, n);
  let F = fres(cosi);
  // what's in its face: the cell round it (where that lands on screen, blurred), the key light's glint, a soft rim
  let rf = reflect(rd, n);
  let ruv = uvOfP(p + rf * r * 3.0);
  var refl = textureSampleLevel(litTex, samp_linear, clamp(ruv, vec2f(0.001), vec2f(0.999)), 2.5).rgb * 0.9 + G.bgColor * 0.5;
  // (glints soft enough to hold still from frame to frame: a sharp one comes and goes as the view turns, and the bloom
  // flashes the whole frame with it)
  refl += vec3f(1.0, 0.97, 0.92) * pow(max(dot(rf, normalize(G.keyDir)), 0.0), 420.0) * 7.0;
  refl += vec3f(0.75, 0.82, 1.0) * pow(max(dot(rf, normalize(G.keyDir * vec3f(-1.0, 0.3, -1.0))), 0.0), 160.0) * 1.8;
  // the light bent into it: the world inside (its own alpha: where its sky is thin, the cell behind shows), by colour
  let iors = select(vec3f(1.5), vec3f(1.488, 1.5, 1.514), HI);
  var world = vec3f(0.0); var wa = 0.0; var bk = vec3f(0.0);
  for (var ch = 0; ch < select(1, 3, HI); ch++) {
    let rr = refract(rd, n, 1.0 / iors[ch]);
    let w = inside(p, rr, axis);
    let b = behind(p, rr, iors[ch], back);
    if (HI) { world[ch] = w[ch]; bk[ch] = b[ch]; wa += w.a / 3.0; } else { world = w.rgb; bk = b; wa = w.a; }
  }
  world = graded(world);
  let thru = world + bk * (1.0 - max(wa, J.inner.z)) * J.tint.rgb;
  // the glass: its edge darker where light leaves it at a glance, motes of dust in it
  let edge = ssj(0.0, 0.35, cosi);
  var col = refl * F + thru * (1.0 - F) * mix(0.55, 1.0, edge);
  col += vec3f(0.9, 0.95, 1.0) * motes(p, refract(rd, n, 1.0 / 1.5)) * 0.9;
  return vec4f(mix(col, inner, wIn), 1.0);
}
