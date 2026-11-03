// Aang's air, drawn as the show draws airbending (air.ts simulates it each frame): ribbons of wind — strips facing the
// camera along each ribbon's points, white with a pale-blue rim line, soft at their edges, a flow running along them —
// the leaves and the dust it lifts (cut-out quads: a leaf's shape with its midrib, flat-shaded light and shade; dust a
// soft puff), and balls: the air scooter's (a ball of swirling air seen through, its bands turning, its outline drawn)
// and the marbles (glass, a highlight). Like his fills (hero.wgsl's drawn look) the colours are designed on the screen
// and locked through this frame's exposure and tone map; the light reaches them only as the colour model's condition
// (golden hour warmer, night moonlit). Drawn after everything opaque, premultiplied, no depth written.
#include "./../world/world.wgsl"

struct AirU {
  counts: vec4f,   // x ribbons, y points per ribbon, z leaves, w balls
  look: vec4f,     // x time
  grade: vec4f,    // the post chain's grade (post.ts settings): x exposure bias (stops), y saturation, z contrast, w punch
  grade2: vec4f,   // x warmth, y bloom
}
@group(2) @binding(0) var<uniform> AU: AirU;
@group(2) @binding(1) var<storage, read> pts: array<vec4f>;     // 2 per point: xyz, w half width | x alpha
@group(2) @binding(2) var<storage, read> ribs: array<vec4f>;    // 1 per ribbon: x points, y -, z seed, w -
@group(2) @binding(3) var<storage, read> leaves: array<vec4f>;  // 4 per leaf: xyz, w size | its turn (a quaternion) | rgb, alpha | x kind (0 leaf, 1 dust)
@group(2) @binding(4) var<storage, read> balls: array<vec4f>;   // 2 per ball: xyz centre, w radius | x kind (0 the scooter's, 1 a marble), y alpha, z spin, w seed

fn srgbToLin(c: vec3f) -> vec3f { return pow(max(c, vec3f(0.0)), vec3f(2.2)); }
fn qrot(q: vec4f, p: vec3f) -> vec3f { return p + 2.0 * cross(q.xyz, cross(q.xyz, p) + q.w * p); }

// ---- the display lock (as hero.wgsl's celLock): the scene colour that comes out of post.wgsl as the designed one
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
fn airLock(D0: vec3f) -> vec3f {
  let G = AU.grade;
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
  let w = AU.grade2.x;
  c /= vec3f(1.0 + w * 0.08, 1.0, 1.0 - w * 0.08);
  return max(c, vec3f(0.0)) / max(world.exposure * exp2(G.x) * (1.0 - AU.grade2.y), 1e-9);
}
/** the colour model's light (hero.wgsl celCondition, outdoors): noon as designed, golden hour warmer, night moonlit */
fn condition() -> vec3f {
  let sunUp = world.sunTrue.y;
  let golden = (1.0 - smoothstep(0.05, 0.4, sunUp)) * smoothstep(-0.12, 0.02, sunUp);
  let k = mix(vec3f(1.0), vec3f(1.08, 0.94, 0.8), golden);
  return mix(k, vec3f(0.42, 0.48, 0.72), smoothstep(0.2, 0.9, world.sunTrue.w));
}
/** a designed display colour, premultiplied by its coverage, through the air between it and the camera */
fn paint(D: vec3f, a: f32, p: vec3f) -> vec4f {
  let c = airLock(D * condition());
  let ap = aerial(p);
  return vec4f((c * ap.a + ap.rgb) * a, a);
}

// ---------------------------------------------------------------- ribbons
struct ROut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) uv: vec2f,      // x along (0 its head .. 1 its tail), y across (-1 .. 1)
  @location(2) a: f32,
  @location(3) seed: f32,
}
@vertex fn vsRibbon(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> ROut {
  let info = ribs[ii];
  let n = max(u32(info.x), 1u);
  let P = u32(AU.counts.y);
  let j = min(vi / 2u, n - 1u);
  let side = select(-1.0, 1.0, (vi & 1u) == 1u);
  let base = ii * P;
  let p0 = pts[(base + j) * 2u];
  let ja = select(j - 1u, 0u, j == 0u);
  let jb = min(j + 1u, n - 1u);
  var tg = pts[(base + jb) * 2u].xyz - pts[(base + ja) * 2u].xyz;
  if (dot(tg, tg) < 1e-12) { tg = frame.camUp; }
  tg = normalize(tg);
  let toCam = normalize(frame.camPos - p0.xyz);
  var right = cross(tg, toCam);
  if (dot(right, right) < 1e-8) { right = frame.camRight; }
  right = normalize(right);
  // (never thinner than about a pixel: thinner, fainter instead)
  let dist = max(distance(p0.xyz, frame.camPos), 0.05);
  let pxM = 2.0 * tan(frame.fovY * 0.5) * dist / max(frame.res.y, 1.0);
  let w = max(p0.w, pxM * 0.8);
  var o: ROut;
  let wp = p0.xyz + right * side * w;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.world = wp;
  o.uv = vec2f(f32(j) / f32(max(n - 1u, 1u)), side);
  o.a = select(0.0, pts[(base + j) * 2u + 1u].x * min(1.0, p0.w / w), u32(info.x) > 1u);
  o.seed = info.z;
  return o;
}
@fragment fn fsRibbon(i: ROut) -> @location(0) vec4f {
  let x = abs(i.uv.y);
  // a soft body, a pale-blue line along each edge, the wind running along it
  let body = 1.0 - smoothstep(0.25, 0.95, x);
  let rim = smoothstep(0.55, 0.78, x) * (1.0 - smoothstep(0.82, 1.0, x));
  let flow = 0.8 + 0.2 * sin(i.uv.x * 23.0 - AU.look.x * 13.0 + i.seed * 6.2831853);
  let a = clamp(i.a * (body * 0.5 * flow + rim * 0.62), 0.0, 1.0);
  if (a < 0.003) { discard; }
  let D = mix(vec3f(0.94, 0.97, 1.0), vec3f(0.66, 0.82, 0.96), rim / max(body * 0.5 * flow + rim, 1e-3));
  return paint(D, a, i.world);
}

// ---------------------------------------------------------------- leaves and dust
struct LOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) q: vec2f,
  @location(2) col: vec4f,
  @location(3) n: vec3f,
  @location(4) kind: f32,
}
@vertex fn vsLeaf(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LOut {
  let a = leaves[ii * 4u];
  let rot = leaves[ii * 4u + 1u];
  let col = leaves[ii * 4u + 2u];
  let kind = leaves[ii * 4u + 3u].x;
  let q = vec2f(f32(vi & 1u), f32((vi >> 1u) & 1u)) * 2.0 - 1.0;
  var o: LOut;
  var p: vec3f;
  var n: vec3f;
  if (kind > 0.5) {
    // dust: a puff facing the camera
    p = a.xyz + (frame.camRight * q.x + frame.camUp * q.y) * a.w;
    n = -frame.camFwd;
  } else {
    // a leaf: its blade in its own x-y plane, turned by its quaternion
    p = a.xyz + qrot(rot, vec3f(q.x * 0.62, q.y, 0.0) * a.w);
    n = qrot(rot, vec3f(0.0, 0.0, 1.0));
  }
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.world = p;
  o.q = q;
  o.col = col;
  o.n = n;
  o.kind = kind;
  return o;
}
@fragment fn fsLeaf(i: LOut) -> @location(0) vec4f {
  if (i.kind > 0.5) {
    let r = length(i.q);
    let a = i.col.a * exp(-r * r * 3.0) * (1.0 - smoothstep(0.85, 1.0, r));
    if (a < 0.003) { discard; }
    return paint(i.col.rgb, a, i.world);
  }
  // the blade: an egg pointed at its tip (q.y 1), a short stalk below it, the midrib
  let y = i.q.y;
  let half = 0.92 * sqrt(max(1.0 - y * y, 0.0)) * (1.0 - 0.3 * y);
  let blade = 1.0 - smoothstep(half - 0.06, half + 0.02, abs(i.q.x));
  let stalk = (1.0 - smoothstep(0.03, 0.08, abs(i.q.x))) * step(y, -0.8);
  let cov = max(blade * step(-0.85, y), stalk);
  if (cov < 0.02) { discard; }
  var n = normalize(i.n);
  if (dot(n, frame.camPos - i.world) < 0.0) { n = -n; }
  let lit = smoothstep(-0.05, 0.08, dot(n, world.sunDir));
  var D = mix(i.col.rgb * vec3f(0.66, 0.62, 0.72), i.col.rgb, lit);
  let rib = (1.0 - smoothstep(0.02, 0.06, abs(i.q.x))) * blade;
  D = mix(D, D * 0.78, rib);
  return paint(D, cov * i.col.a, i.world);
}

// ---------------------------------------------------------------- balls: the scooter's, the marbles
struct BOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) b: u32,
}
@vertex fn vsBall(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> BOut {
  let c = balls[ii * 2u];
  let q = vec2f(f32(vi & 1u), f32((vi >> 1u) & 1u)) * 2.0 - 1.0;
  // (a quad over the sphere, pulled toward the camera so its front stays in front of what's behind it)
  let toCam = normalize(frame.camPos - c.xyz);
  let p = c.xyz + (frame.camRight * q.x + frame.camUp * q.y) * c.w * 1.25 + toCam * c.w;
  var o: BOut;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.world = p;
  o.b = ii;
  return o;
}
@fragment fn fsBall(i: BOut) -> @location(0) vec4f {
  let C = balls[i.b * 2u];
  let I = balls[i.b * 2u + 1u];
  let ro = frame.camPos;
  let rd = normalize(i.world - ro);
  let oc = ro - C.xyz;
  let bq = dot(oc, rd);
  let cq = dot(oc, oc) - C.w * C.w;
  let h = bq * bq - cq;
  if (h <= 0.0) { discard; }
  let sh = sqrt(h);
  let t0 = -bq - sh;
  let t1 = -bq + sh;
  let p0 = ro + rd * max(t0, 0.0);
  let n0 = normalize(p0 - C.xyz);
  let rimK = 1.0 - abs(dot(n0, rd));
  if (I.x > 0.5) {
    // a glass marble: its colour lit and shaded, a white glint
    let lit = smoothstep(-0.1, 0.15, dot(n0, world.sunDir) + 0.25);
    var D = mix(I.yzw * 0.55, I.yzw, lit);
    let gl = pow(max(dot(reflect(rd, n0), normalize(world.sunDir + vec3f(0.0, 0.6, 0.0))), 0.0), 40.0);
    D = mix(D, vec3f(0.97), saturate(gl * 1.5));
    D = mix(D, vec3f(0.1, 0.07, 0.06), smoothstep(0.82, 0.95, rimK));
    return paint(D, 1.0, p0);
  }
  // the scooter's ball: swirling air seen through — bands turning round a tilted axis on its near and far sides, a
  // drawn outline, a faint body
  let spin = I.z;
  let ax = normalize(vec3f(0.35 * sin(spin * 0.13), 1.0, 0.35 * cos(spin * 0.11)));
  var band = 0.0;
  for (var k = 0; k < 2; k++) {
    let p = select(ro + rd * t1, p0, k == 0);
    let l = (p - C.xyz) / C.w;
    let lat = dot(l, ax);
    let e1 = normalize(cross(ax, vec3f(0.0, 0.0, 1.0)));
    let e2 = cross(ax, e1);
    let lon = atan2(dot(l, e2), dot(l, e1));
    let s = sin(lon * 3.0 + lat * 4.0 - spin * 2.0 + I.w);
    let w = smoothstep(0.82, 0.97, s) * select(0.4, 1.0, k == 0);
    band = max(band, w * (1.0 - smoothstep(0.75, 1.0, abs(lat))));
  }
  let outline = smoothstep(0.88, 0.95, rimK) * (1.0 - smoothstep(0.975, 1.0, rimK));
  let body = 0.05 + 0.08 * (t1 - max(t0, 0.0)) / (2.0 * C.w) + 0.12 * smoothstep(0.5, 0.95, rimK);
  let a = clamp((body + band * 0.6 + outline * 0.6) * I.y, 0.0, 1.0);
  let D = mix(vec3f(0.93, 0.97, 1.0), vec3f(0.6, 0.78, 0.95), max(outline, 0.3 + band * 0.2));
  return paint(D, a, p0);
}
