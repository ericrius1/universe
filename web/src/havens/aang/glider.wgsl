// Aang's glider (glider.ts builds it and carries it over him as he glides), drawn as the cast are (hero.wgsl's ink and
// paint): flat fills, one hard shade edge from the key light, the colours designed on the screen and locked through
// this frame's exposure and tone map (as air.wgsl's are), the light reaching them only as the colour model's condition
// (golden hour warmer, night moonlit); and the ink line round it — the mesh again, its back faces pushed out along their
// normals by a constant width on screen.
#include "./../world/world.wgsl"

struct GliderU {
  o: vec4f, x: vec4f, y: vec4f, z: vec4f,   // where it is: its middle and its frame (right, up, back), world
  grade: vec4f,    // the post chain's grade (post.ts settings): x exposure bias (stops), y saturation, z contrast, w punch
  grade2: vec4f,   // x warmth, y bloom
  toon: vec4f,     // x the ink line's width (px at 1080 lines)
  shape: vec4f,    // x how far it's open (0 folded along the staff .. 1 open; a little past as it snaps open)
}
@group(2) @binding(0) var<uniform> GU: GliderU;
@group(2) @binding(1) var<storage, read> verts: array<vec4f>;   // 2 per vertex: xyz, w its colour (0 wing, 1 staff, 2 rib) | normal

fn agxPoly(x: f32) -> f32 {
  let x2 = x * x; let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
fn agxPolyD(x: f32) -> f32 {
  let x2 = x * x; let x4 = x2 * x2;
  return 93.0 * x4 * x - 200.7 * x4 + 127.84 * x2 * x - 20.604 * x2 + 0.8596 * x + 0.1191;
}
fn agxPolyInv(y: f32) -> f32 {
  var x = clamp(y * 0.6 + 0.2, 0.0, 1.0);
  for (var i = 0; i < 6; i++) { x = clamp(x - (agxPoly(x) - y) / max(agxPolyD(x), 0.05), 0.0, 1.0); }
  return x;
}
/** the scene colour that comes out of post.wgsl as the designed display colour D0 */
fn lock(D0: vec3f) -> vec3f {
  let G = GU.grade;
  var d = (D0 - 0.5) / max(G.z, 0.01) + 0.5;
  let inset = mat3x3f(vec3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051), vec3f(0.0784335999999992, 0.878468636469772, 0.0784336),
    vec3f(0.0792237451477643, 0.0791661274605434, 0.879142973793104));
  let outset = mat3x3f(vec3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438), vec3f(-0.0980208811401368, 1.15190312990417, -0.0980434501171241),
    vec3f(-0.0990297440797205, -0.0989611768448433, 1.15107367264116));
  d = inset * d;
  let sat = mix(1.0, 1.4, G.w) * G.y;
  let l = dot(d, vec3f(0.2126, 0.7152, 0.0722));
  d = l + (d - l) / max(sat, 0.01);
  d = pow(max(d, vec3f(1e-5)), vec3f(1.0 / mix(1.0, 1.35, G.w)));
  d = vec3f(agxPolyInv(d.x), agxPolyInv(d.y), agxPolyInv(d.z));
  let minEv = -12.47393; let maxEv = 4.026069;
  var c = outset * exp2(d * (maxEv - minEv) + minEv);
  let w = GU.grade2.x;
  c /= vec3f(1.0 + w * 0.08, 1.0, 1.0 - w * 0.08);
  return max(c, vec3f(0.0)) / max(world.exposure * exp2(G.x) * (1.0 - GU.grade2.y), 1e-9);
}
/** the colour model's light (outdoors): noon as designed, golden hour warmer, night moonlit */
fn condition() -> vec3f {
  let sunUp = world.sunTrue.y;
  let golden = (1.0 - smoothstep(0.05, 0.4, sunUp)) * smoothstep(-0.12, 0.02, sunUp);
  let k = mix(vec3f(1.0), vec3f(1.08, 0.94, 0.8), golden);
  return mix(k, vec3f(0.42, 0.48, 0.72), smoothstep(0.2, 0.9, world.sunTrue.w));
}

fn toWorld(l: vec3f) -> vec3f { return GU.o.xyz + GU.x.xyz * l.x + GU.y.xyz * l.y + GU.z.xyz * l.z; }
fn dirWorld(n: vec3f) -> vec3f { return normalize(GU.x.xyz * n.x + GU.y.xyz * n.y + GU.z.xyz * n.z); }

struct Folded { p: vec3f, n: vec3f }
/** a point of the glider (and its normal) as far open as GU.shape.x: the wings and the tail fanned in toward the staff,
 *  each point turned about its hinge — the wing's beside the staff's head, the tail's at its root — by its angle off the
 *  staff times how far open, as a fan closes; their dihedral lowered with them. The staff and its grip don't move */
fn fold(p: vec3f, n: vec3f, col: u32) -> Folded {
  let o = GU.shape.x;
  if (col == 1u || abs(p.x) < 0.021 || (o >= 0.999 && o <= 1.001)) { return Folded(p, n); }
  let tail = p.z > 0.45;
  let hz = select(-0.8, 0.5, tail);
  let d = vec2f(p.x, p.z - hz);
  let r = length(d);
  let a0 = atan2(d.x, d.y);
  let da = a0 * o - a0;
  let x = sin(a0 + da) * r;
  // (the wings' dihedral was 0.07 a metre out, the tail's 0.03)
  let k = select(0.07, 0.03, tail);
  let q = vec3f(x, p.y - k * (abs(p.x) - abs(x)), hz + cos(a0 + da) * r);
  let c = cos(da); let s = sin(da);
  return Folded(q, vec3f(n.x * c + n.z * s, n.y, n.z * c - n.x * s));
}

struct GOut { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) @interpolate(flat) col: u32 }

@vertex fn vsFill(@builtin(vertex_index) vi: u32) -> GOut {
  let a = verts[vi * 2u]; let b = verts[vi * 2u + 1u];
  var o: GOut;
  let f = fold(a.xyz, b.xyz, u32(a.w + 0.5));
  o.world = toWorld(f.p);
  o.n = dirWorld(f.n);
  o.pos = frame.viewProj * vec4f(o.world, 1.0);
  o.col = u32(a.w + 0.5);
  return o;
}
@fragment fn fsFill(i: GOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  // the wings red-orange, the staff warm wood, the ribs along the wings' edges yellow-brown: the lit fill and its shade
  var fill = vec3f(0.73, 0.31, 0.22); var shadeK = vec3f(0.66, 0.74, 0.78);
  if (i.col == 1u) { fill = vec3f(0.55, 0.36, 0.22); shadeK = vec3f(0.7, 0.66, 0.74); }
  if (i.col == 2u) { fill = vec3f(0.82, 0.62, 0.32); shadeK = vec3f(0.7, 0.68, 0.74); }
  var N = normalize(i.n);
  if (!ff) { N = -N; }
  let V = normalize(frame.camPos - i.world);
  // (the key leans toward the camera, as the cast's does: a drawing's light)
  let Lk = normalize(world.sunDir + V * 0.4);
  let t = dot(N, Lk) + 0.1;
  let aa = max(fwidth(t), 1e-3);
  let lit = smoothstep(-aa, aa, t) * smoothstep(0.35, 0.65, sunShadowFast(i.world + world.sunDir * 0.05, N));
  let D = mix(fill * shadeK, fill, lit);
  return vec4f(applyAerial(lock(D * condition()), i.world), 1.0);
}

struct IOut { @builtin(position) pos: vec4f, @location(0) world: vec3f }
@vertex fn vsInk(@builtin(vertex_index) vi: u32) -> IOut {
  let a = verts[vi * 2u]; let b = verts[vi * 2u + 1u];
  let f = fold(a.xyz, b.xyz, u32(a.w + 0.5));
  var wp = toWorld(f.p);
  let n = dirWorld(f.n);
  let dist = max(distance(wp, frame.camPos), 0.05);
  let pxM = 2.0 * tan(frame.fovY * 0.5) * dist / max(frame.res.y, 1.0);
  let px = max(GU.toon.x * frame.res.y / 1080.0, 1.0);
  wp += n * px * pxM;
  wp += normalize(wp - frame.camPos) * min(0.004 * dist, 0.06);
  var o: IOut;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.world = wp;
  return o;
}
@fragment fn fsInk(i: IOut) -> @location(0) vec4f {
  // near-black, warm, as the cast's lines are
  return vec4f(applyAerial(lock(vec3f(0.09, 0.06, 0.055) * condition()), i.world), 1.0);
}
