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
  bgColor: vec3f, spot: f32,        // spot: the spotlight's strength (0..1: the guide's "Look for", ui/guiding.ts)
  clearRadius: f32, pxAngle: f32, cutRadius: f32, organelleCount: u32,   // pxAngle: radians per pixel
  hover: u32, selected: u32, spots: u32, flags: u32,   // spots: what the spotlight lights (ui/spot.ts)
  timeScale: f32, shellSolid: f32, highlight: f32, dof: f32,    // shellSolid: membranes opaque (1) or glass (0)
  origin: vec3f, hazeBg: f32,       // the floating origin (nm): every position the GPU computes with is relative to it;
                                    // how far the empty background is the haze itself (a film's: src/loop.ts)
  jewel: vec4f,                     // the jewel (src/loop.ts): its middle (relative) and radius; no bead inside it
  lodReach: vec4f,                  // how far off (nm) a nucleosome, and a base pair, are still molecules (lodPx over 9);
                                    // z: how far round the focus chromatin is (a film's, round its jewel: chromReach)
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
// the crowd's density round the focus (src/engine/volume.ts, shaders/volume.wgsl): what share of each cell molecules
// fill, with a short mip chain
struct Vol { corner: vec3f, voxel: f32, n: f32, on: f32, look: f32, late: f32 }   // look: 0 light, 1 illustrative (renderer.ts)
@group(1) @binding(1) var volTex: texture_3d<f32>;
@group(1) @binding(2) var<uniform> V: Vol;

// (the GPU computes relative to G.origin, src/engine/origin.ts: absolute positions are rebased the moment they're
// loaded, and only noise is sampled at the absolute point)
fn absP(p: vec3f) -> vec3f { return p + G.origin; }
fn orgAt(i: u32) -> Organelle {
  var o = organelles[i];
  o.a -= G.origin; o.center -= G.origin;
  if (o.shape == S_CAPSULE) { o.b -= G.origin; }
  return o;
}

// what the spotlight lights (G.spots, while G.spot > 0): up to two kinds, 16 bits each, the class in the top two
// (1 organelle, 2 filament, 3 molecule) and the kind below (ui/spot.ts). Opaque things are lit in the composite
// (post.wgsl, by the id under each pixel), membranes seen as glass in their own pass (organelle.wgsl).
fn spotOne(id: u32, t: u32) -> bool {
  let cls = t >> 14u; let k = t & 0x3fffu;
  if (cls == 0u) { return false; }
  if ((id & 0x80000000u) != 0u) { return cls == 3u && ((id >> 16u) & 0x7fffu) == k; }
  if ((id & 0x40000000u) != 0u) { return cls == 2u && ((id >> 16u) & 0xffu) == k; }
  return cls == 1u && id <= G.organelleCount && organelles[id - 1u].kind == k;
}
fn spotlit(id: u32) -> bool { return id != 0u && (spotOne(id, G.spots & 0xffffu) || spotOne(id, G.spots >> 16u)); }

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
fn basis(x: vec3f, y: vec3f) -> vec4f {
  // the rotation whose columns are x, y, x×y (orthonormalised), as a quaternion
  let X = normalize(x - y * dot(x, y));
  let Y = y;
  let Z = cross(X, Y);
  let tr = X.x + Y.y + Z.z;
  var q: vec4f;
  if (tr > 0.0) {
    let s = sqrt(tr + 1.0) * 2.0;
    q = vec4f((Y.z - Z.y) / s, (Z.x - X.z) / s, (X.y - Y.x) / s, 0.25 * s);
  } else if (X.x > Y.y && X.x > Z.z) {
    let s = sqrt(1.0 + X.x - Y.y - Z.z) * 2.0;
    q = vec4f(0.25 * s, (Y.x + X.y) / s, (Z.x + X.z) / s, (Y.z - Z.y) / s);
  } else if (Y.y > Z.z) {
    let s = sqrt(1.0 + Y.y - X.x - Z.z) * 2.0;
    q = vec4f((Y.x + X.y) / s, 0.25 * s, (Z.y + Y.z) / s, (Z.x - X.z) / s);
  } else {
    let s = sqrt(1.0 + Z.z - X.x - Y.y) * 2.0;
    q = vec4f((Z.x + X.z) / s, (Z.y + Y.z) / s, 0.25 * s, (X.y - Y.x) / s);
  }
  return normalize(q);
}
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

// What writes its own depth (a traced tube, a cut face) can't be hidden by the GPU before it's shaded: those draw in
// a pass of their own after the scene (renderer.ts late), against a copy of the scene's depth, and each fragment asks
// it first — hidden by what's there already (reversed Z: nearer is larger), it goes before any of its work
fn hiddenAt(occ: texture_depth_2d, pos: vec4f, depth: f32) -> bool {
  return V.late > 0.5 && textureLoad(occ, vec2i(pos.xy), 0) > depth * 1.000002 + 1e-9;
}

// the haze between the eye and a point d nm away
fn fogAmount(d: f32) -> f32 { return 1.0 - exp(-max(d, 0.0) / G.fogDist); }

// ---------------------------------------------------------------- chromatin
// a filament segment (src/world/filaments.ts)
struct Seg { a: vec3f, ra: f32, b: vec3f, rb: f32, kind: u32, fil: u32, s0: f32, len: f32 }
// Chromatin's nucleosomes: one every 11 nm in a zig-zag round the fibre. field.wgsl makes them molecules while they're
// big on screen; past that filament.wgsl draws the very same ones itself, as the molecule's coarsest level — its five
// lumps — would be drawn, so the hand-over can't be seen, and the fibre is the same thing from a micron off as up close
// (no tube swelling up round the beads as the view widens).
struct Nuc { c: vec3f, rad: vec3f, next: vec3f, T: vec3f, tilt: f32 }   // next: where its linker DNA goes (the next one's middle)
fn nucleosome(s: Seg, j: i32) -> Nuc {
  let ax = s.b - s.a;
  let T = normalize(ax);
  let R0 = normalize(cross(T, vec3f(0.31, 1.0, 0.17)));
  let R1 = cross(T, R0);
  let hj = hash3i(vec3i(j, i32(s.fil), 7));
  let th = f32(j) * 3.5 + hj.x * 0.6;
  var n: Nuc;
  n.rad = R0 * cos(th) + R1 * sin(th);
  n.c = s.a + ax * ((f32(j) * 11.0 - s.s0) / s.len) + n.rad * 8.5;
  n.T = T;
  n.tilt = hj.y * 1.2 - 0.6;
  let thn = f32(j + 1) * 3.5 + hash3i(vec3i(j + 1, i32(s.fil), 7)).x * 0.6;
  n.next = n.c + T * 11.0 + (R0 * cos(thn) + R1 * sin(thn) - n.rad) * 8.5;
  return n;
}
fn nucRot(n: Nuc) -> vec4f { return qmul(basis(n.rad, n.T), qaxis(vec3f(1.0, 0.0, 0.0), n.tilt)); }
// the size (px) a molecule of radius r counts as for its level of detail this far off: its size on screen, less as the
// haze hides it (a twentieth of it showing, it counts as a quarter its size)
fn lodPx(r: f32, dist: f32) -> f32 { return r / max(dist * G.pxAngle, 1e-9) * exp(-0.5 * dist / G.fogDist); }
// whether a nucleosome this far off is one of the molecules: while it counts as over 9 px (its type's radius 10.74 nm,
// the molecule data) — the field's lod1 line (src/world/field.ts), so the molecules never come to their coarsest level
// (the distance where it crosses the line worked out on the CPU: main.ts lodReach)
fn nucMolecule(dist: f32) -> bool { return dist < G.lodReach.x; }
// and whether a base pair is (theirs 1.1 nm): past that line each is drawn as one sphere, so a linker of them is a rod,
// and filament.wgsl draws it as one
fn bpMolecule(dist: f32) -> bool { return dist < G.lodReach.y; }
// chromatin's reach round the focus (1 within it, fading to 0 at its edge): everywhere, but for a film's jewel, where the
// strands round the bead the eye has just left are made out from it as the view widens (src/loop.ts)
fn chromReach(p: vec3f) -> f32 { let R = G.lodReach.z; return 1.0 - smoothstep(0.7 * R, R, length(p - G.focus)); }

// Light for living matter, under water. Protein and lipid against cytosol reflect about 0.2% face-on (in air, 4%), so
// nothing here glints: no white highlight, no clear-coat, no white rim (docs/next.md "The look"). What's left is soft
// and a little translucent: a warm key whose terminator bleeds into the material's deeper colour (wrapped, tinted by
// `sss`, the colour light picks up inside it), light through thin edges from behind (transmission), ambient light
// from the water round it by the normal (a hemisphere: the key's side cooler and brighter, the far side warm and
// deep) in place of a constant fill, and the faintest dielectric lobe, rough and tinted by the material. `occl` is how
// much of the ambient light the crowd round it takes (0 none), `shad` how much of the key it hides (0 none).
struct Surf { albedo: vec3f, sss: vec3f, rough: f32, wrap: f32, trans: f32, rim: f32, occl: f32, shad: f32 }

// the crowd's density at p, the mean over cells 2^lod wide (none outside the grid, fading out over its last cells)
fn crowdAt(p: vec3f, lod: f32) -> f32 {
  let u = (p - V.corner) / (V.voxel * V.n);
  let e = min(min(u, 1.0 - u), vec3f(1.0));
  let edge = clamp(min(e.x, min(e.y, e.z)) * V.n * 0.25, 0.0, 1.0);
  if (edge <= 0.0) { return 0.0; }
  return textureSampleLevel(volTex, samp_linear, u, lod).r * edge;
}
// The crowd round a point with outward normal n: how much of the water's light it takes (occl, from taps out along
// the normal at widening cells: a cone) and how much of the key's (shad, from taps toward the light, wider as they go).
// The first tap stands a cell and a half off, so a molecule's own share of its cells darkens it only a little.
struct Crowd { occl: f32, shad: f32 }
fn crowdLight(p: vec3f, n: vec3f) -> Crowd {
  var c: Crowd;
  if (V.on <= 0.0) { return c; }
  let vx = V.voxel;
  let l = normalize(G.keyDir);
  // (the normal leant a little toward the light: the sky's side counts for more)
  let a = normalize(n + l * 0.3);
  let o = crowdAt(p + a * (1.5 * vx), 0.0) * 0.5 + crowdAt(p + a * (3.0 * vx), 1.0) * 0.8 + crowdAt(p + a * (6.0 * vx), 2.0) * 1.2;
  c.occl = (1.0 - exp(-o * 2.2)) * V.on;
  let q = p + n * (0.75 * vx);
  let s = crowdAt(q + l * (2.0 * vx), 1.0) * 1.0 + crowdAt(q + l * (4.5 * vx), 2.0) * 1.6 + crowdAt(q + l * (9.0 * vx), 3.0) * 2.4;
  c.shad = (1.0 - exp(-s * 1.6)) * V.on * 0.85;
  return c;
}
// bioLight at p; or, in the illustrative look (renderer.ts look), the flat colour alone, light ignored, as Goodsell
// paints (post.wgsl adds the occlusion, inks the lines and the fog). The crowd's occlusion and shadow (crowdLight) are
// taken in once a pixel, at half the size, by post.wgsl fs_ao: here they'd be paid for every surface drawn
fn bioLightAt(p: vec3f, n: vec3f, v: vec3f, s: Surf) -> vec3f {
  if (V.look > 0.5) { return illustrated(s); }
  return bioLight(n, v, s);
}
fn illustrated(s: Surf) -> vec3f {
  let c = held(s.albedo);
  return max(mix(vec3f(luma(c)), c, 1.2), vec3f(0.0)) * 0.8 + 0.004;
}

fn ggx(n: vec3f, h: vec3f, a: f32) -> f32 {
  let a2 = a * a;
  let d = max(dot(n, h), 0.0);
  let k = d * d * (a2 - 1.0) + 1.0;
  return a2 / (3.14159 * k * k);
}

fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
// colour held back: no channel further from the grey than its lightness allows (molecules have no colour; the one
// they're given is a choice, so a restrained one), and never quite black
fn held(c: vec3f) -> vec3f {
  let l = luma(c);
  let d = c - vec3f(l);
  let m = max(max(abs(d.x), abs(d.y)), abs(d.z));
  let cap = l * 2.0 + 0.004;
  return max(vec3f(l) + d * min(1.0, cap / max(m, 1e-6)), vec3f(0.003));
}
// a small turn about the grey axis, and a lightness nudge
fn hueShift(c: vec3f, h: f32, l: f32) -> vec3f {
  let k = vec3f(0.57735);
  let ca = cos(h); let sa = sin(h);
  let r = c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
  return max(r * (1.0 + l), vec3f(0.0));
}
// each copy of a thing a little different from the next: ±8% in lightness, a few degrees in hue, from its id
fn vary(c: vec3f, id: u32) -> vec3f {
  // (the turn about the grey axis to first order — it's small — so no trigonometry in the beads' vertex work)
  let h = pcg3(vec3u(id, 0x9e37u, 0x51u));
  let a = (f32(h.x >> 8u) * (1.0 / 16777216.0) - 0.5) * 0.22;
  let l = (f32(h.y >> 8u) * (1.0 / 16777216.0) - 0.5) * 0.16;
  return max((c + cross(vec3f(0.57735), c) * a) * (1.0 + l), vec3f(0.0));
}

// the light in the water round a thing, by its normal: brighter and cooler toward the key, warm and deep away from it
const AMB_SKY = vec3f(0.18, 0.22, 0.31);
const AMB_GROUND = vec3f(0.07, 0.05, 0.05);
fn ambient(n: vec3f) -> vec3f {
  let k = dot(n, normalize(G.keyDir)) * 0.5 + 0.5;
  return mix(AMB_GROUND, AMB_SKY, k * k * (3.0 - 2.0 * k));
}
const KEY_C = vec3f(1.0, 0.95, 0.88) * 1.65;

fn bioLight(n: vec3f, v: vec3f, s0: Surf) -> vec3f {
  var s = s0;
  s.albedo = held(s.albedo); s.sss = held(s.sss);
  let l = normalize(G.keyDir);
  let nl = dot(n, l);
  let nv = max(dot(n, v), 1e-3);
  let key = KEY_C * (1.0 - s.shad);
  // wrapped diffuse, its terminator tinted by the scattered colour
  let wrapD = max((nl + s.wrap) / (1.0 + s.wrap), 0.0);
  let lam = max(nl, 0.0);
  let diffuse = mix(s.sss * wrapD, s.albedo * lam, smoothstep(0.0, 0.6, lam)) + s.albedo * lam * 0.25;
  // light from behind, through the thin edges
  let back = pow(clamp(dot(v, -normalize(l + n * 0.45)), 0.0, 1.0), 3.0) * s.trans;
  // the dielectric's own lobe under water: F0 1%, rough, the material's colour, gone where the crowd hides the sky
  let a = clamp(s.rough, 0.35, 0.6);
  let h = normalize(l + v);
  let F = 0.01 + 0.05 * pow(clamp(1.0 - dot(h, v), 0.0, 1.0), 5.0);
  let spec = ggx(n, h, a * a) * lam * F * (1.0 - s.occl);
  let amb = ambient(n) * (1.0 - s.occl);
  var c = diffuse * key + s.albedo * amb + s.sss * back * key * 0.8 + s.albedo * spec * key;
  // the edge where the eye grazes through more of it: its own deeper colour, faint
  let fr = pow(clamp(1.0 - nv, 0.0, 1.0), 4.0);
  c += s.sss * fr * s.rim * 0.3 * (1.0 - 0.6 * s.occl);
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

// a view-space normal packed into two numbers (octahedral) for the scene's normals target (rg16float: only the
// occlusion reads it, post.wgsl fs_ao), and back
fn octNormal(n0: vec3f) -> vec4f {
  let n = n0 / (abs(n0.x) + abs(n0.y) + abs(n0.z));
  let s = select(vec2f(-1.0), vec2f(1.0), n.xy >= vec2f(0.0));
  let e = select((1.0 - abs(n.yx)) * s, n.xy, n.z >= 0.0);
  return vec4f(e, 0.0, 1.0);
}
fn unOctNormal(e: vec2f) -> vec3f {
  var n = vec3f(e, 1.0 - abs(e.x) - abs(e.y));
  let t = max(-n.z, 0.0);
  n.x += select(t, -t, n.x >= 0.0);
  n.y += select(t, -t, n.y >= 0.0);
  return normalize(n);
}

fn srgb(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
