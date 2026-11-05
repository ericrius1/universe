// The shared scene: the app's globals (group 0, binding 1), the organelles as analytic shapes (group 1, shared by every
// pipeline that includes this) with their signed distances — the twins of src/world/layout.ts — and the cutaway.
#include "weft/frame"
#include "noise.wgsl"

struct Globals {
  focus: vec3f, scale: f32,         // the point the camera orbits (nm) and its distance to it
  keyDir: vec3f, level: f32,        // toward the key light; the detail level log2(scale / 30 nm)
  cutCenter: vec3f, cut: f32,       // the wedge cut out of the cell: its apex, how far open (0..1)
  cutN1: vec3f, bioTime: f32,       // the wedge's two half-space normals; biological time (s, slowed when close)
  cutN2: vec3f, fluo: f32,          // fluorescence-microscope look (0..1)
  fogColor: vec3f, fogDist: f32,    // the haze and the distance (nm) it takes ~63% of the light
  bgColor: vec3f, exposure: f32,
  clearRadius: f32, pxAngle: f32, cutRadius: f32, organelleCount: u32,   // pxAngle: radians per pixel
  hover: u32, selected: u32, quality: u32, flags: u32,
  timeScale: f32, shellSolid: f32, highlight: f32, dof: f32,    // shellSolid: membranes opaque (1) or glass (0)
  origin: vec3f, pad0: f32,         // the floating origin (nm): every position the GPU computes with is relative to it
  jewel: vec4f,                     // the jewel (src/loop.ts): its middle (relative) and radius; no bead inside it
}
@group(0) @binding(1) var<uniform> G: Globals;

struct Organelle {
  a: vec3f, kind: u32,
  b: vec3f, shape: u32,
  r: f32, amp: f32, freq: f32, seed: f32,
  thick: f32, bend: f32, parent: i32, depth: u32,
  center: vec3f, bound: f32,
}
@group(1) @binding(0) var<storage, read> organelles: array<Organelle>;

// (the GPU computes relative to G.origin, src/engine/origin.ts: absolute positions are rebased the moment they're
// loaded, and only noise is sampled at the absolute point)
fn absP(p: vec3f) -> vec3f { return p + G.origin; }
fn orgAt(i: u32) -> Organelle {
  var o = organelles[i];
  o.a -= G.origin; o.center -= G.origin;
  if (o.shape == S_CAPSULE) { o.b -= G.origin; }
  return o;
}

// kinds (layout.ts Kind)
const K_CELL = 0u; const K_NUCLEUS = 1u; const K_NUCLEOLUS = 2u; const K_MITO = 3u; const K_CRISTA = 4u; const K_ER = 5u;
const K_GOLGI = 6u; const K_LYSO = 7u; const K_PEROX = 8u; const K_ENDO = 9u; const K_VESICLE = 10u; const K_DROPLET = 11u;
const K_NEIGHBOR = 12u; const K_NNUCLEUS = 13u;
const S_BLOB = 0u; const S_CAPSULE = 1u; const S_DISC = 2u;

fn ellipsoidRadius(u: vec3f, ax: vec3f) -> f32 { let q = u / ax; return 1.0 / sqrt(dot(q, q)); }

fn blobRadius(o: Organelle, u: vec3f) -> f32 {
  let k = o.r * o.freq;
  return ellipsoidRadius(u, o.b) + o.amp * fbm(vec3f(u.x * k + o.seed, u.y * k, u.z * k), 3);
}
fn capsuleRadius(o: Organelle, s: vec3f) -> f32 {
  return o.r + o.amp * fbm(vec3f(s.x * o.freq + o.seed, s.y * o.freq, s.z * o.freq), 2);
}
fn discFrame(n: vec3f) -> mat2x3f {
  let t1 = normalize(cross(n, select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(n.y) < 0.99)));
  return mat2x3f(t1, cross(n, t1));
}
fn discRim(o: Organelle, c: f32, s: f32) -> f32 {
  return o.r * (1.0 + o.amp * (vnoise(vec3f(c * 2.3 + o.seed, s * 2.3, o.seed * 0.37)) * 0.7 + vnoise(vec3f(c * 5.1, s * 5.1 + o.seed, 1.7)) * 0.3));
}

// signed distance to the organelle's outer surface (exact on it, a good estimate near it); negative inside
fn sdOrganelle(o: Organelle, p: vec3f) -> f32 {
  if (o.shape == S_BLOB) {
    let q = p - o.a;
    let d = length(q);
    if (d < 1e-3) { return -o.r; }
    return d - blobRadius(o, q / d);
  }
  if (o.shape == S_CAPSULE) {
    let ab = o.b - o.a;
    let t = clamp(dot(p - o.a, ab) / dot(ab, ab), 0.0, 1.0);
    let s = o.a + ab * t;
    let q = p - s;
    let d = length(q);
    if (d < 1e-3) { return -o.r; }
    return d - capsuleRadius(o, absP(s + q * (o.r / d)));
  }
  let n = o.b;
  let sc = o.a + n * o.bend;
  let q = p - sc;
  let rho = length(q);
  let v = q / rho;
  let f = discFrame(n);
  let pc = dot(v, f[0]); let ps = dot(v, f[1]);
  let pl = max(length(vec2f(pc, ps)), 1e-6);
  let alpha = atan2(pl, -dot(v, n));
  let rim = discRim(o, pc / pl, ps / pl);
  let arc = max(0.0, alpha - rim / o.bend) * o.bend;
  return length(vec2f(arc, rho - o.bend)) - o.thick * 0.5;
}

// the wedge: removed where both half-spaces hold, within the cell's reach
fn wedgeCut(p: vec3f) -> f32 {
  if (G.cut <= 0.0) { return -1.0; }
  let q = p - G.cutCenter;
  if (dot(q, q) > G.cutRadius * G.cutRadius) { return -1.0; }
  return min(dot(q, G.cutN1), dot(q, G.cutN2));
}
fn isCut(p: vec3f) -> bool { return wedgeCut(p) > 0.0; }

// where a point is: the innermost organelle it's inside (or -1), and the nearest membrane (distance, organelle)
struct Place { inside: i32, nearest: i32, dist: f32, insideDepth: u32 }
fn placeOf(p: vec3f) -> Place {
  var pl: Place; pl.inside = -1; pl.nearest = -1; pl.dist = 1e9; pl.insideDepth = 0u;
  let n = G.organelleCount;
  for (var i = 0u; i < n; i++) {
    let o = orgAt(i);
    let far = length(p - o.center) - o.bound;
    if (far > pl.dist) { continue; }
    let d = sdOrganelle(o, p);
    if (abs(d) < pl.dist) { pl.dist = abs(d); pl.nearest = i32(i); }
    if (d < 0.0 && o.depth + 1u > pl.insideDepth) { pl.inside = i32(i); pl.insideDepth = o.depth + 1u; }
  }
  return pl;
}
// (a point far from every organelle: its compartment still needs the containing ones, so check those explicitly)
fn insideOf(p: vec3f) -> i32 {
  var best = -1; var depth = 0u;
  let n = G.organelleCount;
  for (var i = 0u; i < n; i++) {
    let o = orgAt(i);
    if (length(p - o.center) > o.bound) { continue; }
    if (sdOrganelle(o, p) < 0.0 && o.depth + 1u > depth) { best = i32(i); depth = o.depth + 1u; }
  }
  return best;
}

// the outward normal of an organelle's surface at p
fn organelleNormal(o: Organelle, p: vec3f, h: f32) -> vec3f {
  let e = vec2f(h, 0.0);
  return normalize(vec3f(
    sdOrganelle(o, p + e.xyy) - sdOrganelle(o, p - e.xyy),
    sdOrganelle(o, p + e.yxy) - sdOrganelle(o, p - e.yxy),
    sdOrganelle(o, p + e.yyx) - sdOrganelle(o, p - e.yyx)));
}

// quaternion rotation
fn qrot(q: vec4f, v: vec3f) -> vec3f { let t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
fn qmul(a: vec4f, b: vec4f) -> vec4f { return vec4f(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz)); }
fn qaxis(axis: vec3f, ang: f32) -> vec4f { return vec4f(axis * sin(ang * 0.5), cos(ang * 0.5)); }
// the rotation taking +Y to n
fn qfromY(n: vec3f) -> vec4f {
  let d = n.y;
  if (d < -0.9999) { return vec4f(1.0, 0.0, 0.0, 0.0); }
  let c = vec3f(n.z, 0.0, -n.x);  // cross(y, n)
  return normalize(vec4f(c, 1.0 + d));
}
fn randQuat(h: vec3f) -> vec4f {
  let u1 = h.x; let u2 = h.y * 6.2831853; let u3 = h.z * 6.2831853;
  let a = sqrt(1.0 - u1); let b = sqrt(u1);
  return vec4f(a * sin(u2), a * cos(u2), b * sin(u3), b * cos(u3));
}

// the haze between the eye and a point d nm away
fn fogAmount(d: f32) -> f32 { return 1.0 - exp(-max(d, 0.0) / G.fogDist); }

// Light for living matter: soft, wet and a little translucent. A warm key whose terminator bleeds into the material's
// deeper colour (subsurface scattering, wrapped), light passing through thin edges from behind (transmission), a cool
// fill and a coloured bounce from below, a GGX highlight with a sharp clear-coat glint on top (membranes are wet), and
// a rim. `sss` is the colour light picks up inside the material.
struct Surf { albedo: vec3f, sss: vec3f, rough: f32, wrap: f32, trans: f32, rim: f32 }

fn ggx(n: vec3f, h: vec3f, a: f32) -> f32 {
  let a2 = a * a;
  let d = max(dot(n, h), 0.0);
  let k = d * d * (a2 - 1.0) + 1.0;
  return a2 / (3.14159 * k * k);
}

fn bioLight(n: vec3f, v: vec3f, s: Surf) -> vec3f {
  let l = normalize(G.keyDir);
  let nl = dot(n, l);
  let nv = max(dot(n, v), 1e-3);
  // wrapped diffuse, its terminator tinted by the scattered colour
  let wrapD = max((nl + s.wrap) / (1.0 + s.wrap), 0.0);
  let lam = max(nl, 0.0);
  let diffuse = mix(s.sss * wrapD, s.albedo * lam, smoothstep(0.0, 0.6, lam)) + s.albedo * lam * 0.25;
  // light from behind, through the thin edges
  let back = pow(clamp(dot(v, -normalize(l + n * 0.45)), 0.0, 1.0), 3.0) * s.trans;
  let fr = pow(clamp(1.0 - nv, 0.0, 1.0), 4.0);
  let h = normalize(l + v);
  let spec = ggx(n, h, s.rough) * lam * (0.04 + 0.96 * pow(clamp(1.0 - dot(h, v), 0.0, 1.0), 5.0)) * 0.6;
  let coat = pow(max(dot(n, h), 0.0), 420.0) * lam * 1.4;
  let keyC = vec3f(1.0, 0.94, 0.86) * 1.6;
  let fillC = vec3f(0.30, 0.42, 0.75) * (0.5 + 0.5 * dot(n, normalize(vec3f(-0.5, -0.4, 0.5)))) * 0.35;
  let bounce = vec3f(0.55, 0.28, 0.22) * max(-n.y * 0.5 + 0.2, 0.0) * 0.25;
  var c = diffuse * keyC + s.albedo * (fillC + bounce) + s.sss * back * keyC * 0.9;
  c += vec3f(spec + coat) * keyC;
  c += mix(s.albedo, vec3f(0.8, 0.9, 1.0), 0.5) * fr * s.rim * 0.55;
  return c;
}

// the old name, for simple callers: a surface from an albedo
fn studio(n: vec3f, v: vec3f, albedo: vec3f, rim: f32, wrap: f32) -> vec3f {
  var s: Surf;
  s.albedo = albedo; s.sss = albedo * vec3f(1.0, 0.55, 0.45); s.rough = 0.45; s.wrap = wrap; s.trans = 0.3; s.rim = rim;
  return bioLight(n, v, s);
}

// a wrinkled normal: value-noise bumps at a frequency (1/nm), their slope taken from three more samples
fn wrinkle(p: vec3f, n: vec3f, freq: f32, amp: f32) -> vec3f {
  let q = p * freq;
  let h0 = snoise(q);
  let gx = snoise(q + vec3f(0.35, 0.0, 0.0)) - h0;
  let gy = snoise(q + vec3f(0.0, 0.35, 0.0)) - h0;
  let gz = snoise(q + vec3f(0.0, 0.0, 0.35)) - h0;
  let g = vec3f(gx, gy, gz) / 0.35;
  return normalize(n - (g - n * dot(g, n)) * amp);
}

fn srgb(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
