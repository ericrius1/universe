// Organelles: the meshes from src/world/meshes.ts, drawn four ways.
//   vs_outer/fs_outer   the solid surface (cisternae, cristae, nucleolus always; membranes when the eye is close)
//   vs_inner/fs_inner   a membrane's inner surface (its twin pushed in by the membrane's thickness), from inside
//   vs_outer/fs_glass   membranes from afar: glass, into the weighted blended transparency targets (accum, reveal) —
//                       you see the organelles through the cell, the cristae through a mitochondrion
//   vs_cap*/fs_cap      where the wedge cuts the cell open, the cut face of each organelle's material: the far side's
//                       back faces stand in for it, moved onto the cut plane (frag_depth) and drawn as a cross-section
// Between glass and solid (G.shellSolid) the solid draw dithers in as the glass fades.
#include "world.wgsl"
#include "palette.wgsl"

struct MeshV { px: f32, py: f32, pz: f32, nx: f32, ny: f32, nz: f32, org: u32, flags: u32 }
@group(2) @binding(0) var<storage, read> verts: array<MeshV>;
// the value noise's lattice, baked (src/world/organelles.ts noiseLattice): NOISE_N³ corners, the hash's own values,
// tiling. A lookup at i + fade(f) has the hardware's trilinear filter do the quintic-faded interpolation vnoise does by
// hand — one fetch for eight hashes
@group(2) @binding(1) var noiseTex: texture_3d<f32>;
const NOISE_N = 64.0;
// whether a fragment may be cut away (the wedge) or dithered out (between glass and solid): a draw without either is
// made with this off, so the GPU knows nothing of it is discarded and hides what's behind it before shading it
override CLIP: bool = true;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) n: vec3f,
  @location(2) @interpolate(flat) org: u32,
}
struct GOut { @location(0) color: vec4f, @location(1) nrm: vec4f, @location(2) id: u32 }
struct GOutD { @location(0) color: vec4f, @location(1) nrm: vec4f, @location(2) id: u32, @builtin(frag_depth) depth: f32 }
struct OitOut { @location(0) accum: vec4f, @location(1) reveal: vec4f }

// the thickness a membrane is drawn with: true to life up close, widened far away so the cut still shows it
fn shellThick(o: Organelle) -> f32 { return max(o.thick, G.scale * 0.0035); }
fn isShellOrg(o: Organelle) -> bool { return o.shape != S_DISC && o.thick > 0.0; }

fn vsCommon(vi: u32, inner: bool) -> VOut {
  let v = verts[vi];
  var p = vec3f(v.px, v.py, v.pz) - G.origin;
  let n = vec3f(v.nx, v.ny, v.nz);
  let o = orgAt(v.org);
  if (inner) { p -= n * shellThick(o); }
  var out: VOut;
  out.world = p;
  out.n = n;
  out.org = v.org;
  out.pos = frame.viewProj * vec4f(p, 1.0);
  return out;
}
@vertex fn vs_outer(@builtin(vertex_index) vi: u32) -> VOut { return vsCommon(vi, false); }
@vertex fn vs_inner(@builtin(vertex_index) vi: u32) -> VOut { return vsCommon(vi, true); }
// the wedge takes this one's surface here (the neighbouring cells are never cut: the tissue's sheet keeps them close
// enough that the wedge's reach would nick them)
fn uncut(k: u32) -> bool { return k == K_NEIGHBOR || k == K_NNUCLEUS; }
fn cutHere(in: VOut) -> bool { return isCut(in.world) && !uncut(organelles[in.org].kind); }
// (caps: only organelles the wedge reaches; the rest collapse to nothing)
fn reachesCut(o: Organelle) -> bool {
  if (G.cut <= 0.0 || uncut(o.kind)) { return false; }
  let q = o.center - G.cutCenter;
  if (length(q) - o.bound > G.cutRadius) { return false; }
  return min(dot(q, G.cutN1), dot(q, G.cutN2)) > -o.bound;
}
@vertex fn vs_cap(@builtin(vertex_index) vi: u32) -> VOut {
  var out = vsCommon(vi, false);
  if (!reachesCut(orgAt(out.org))) { out.pos = vec4f(0.0, 0.0, -2.0, 1.0); }
  return out;
}
@vertex fn vs_cap_inner(@builtin(vertex_index) vi: u32) -> VOut {
  var out = vsCommon(vi, true);
  if (!reachesCut(orgAt(out.org))) { out.pos = vec4f(0.0, 0.0, -2.0, 1.0); }
  return out;
}

fn viewNormal(n: vec3f) -> vec4f { return vec4f(normalize((frame.view * vec4f(n, 0.0)).xyz), 1.0); }

// nm per pixel at a world point
fn footprint(p: vec3f) -> f32 { return length(p - frame.camPos) * G.pxAngle; }

// a 4×4 ordered dither for cross-fading solid and glass
fn bayer(px: vec2f) -> f32 {
  let i = vec2u(px) % 4u;
  let m = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[i.y * 4u + i.x] + 0.5) / 16.0;
}

// vnoise from the baked lattice (the corners wrap every NOISE_N: a different draw of the same noise), snoise's three
// octaves of it, and world.wgsl's wrinkle made of those
fn tvnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let w = i - floor(i / NOISE_N) * NOISE_N;
  return textureSampleLevel(noiseTex, samp_repeat, (w + fade3(p - i) + 0.5) / NOISE_N, 0.0).r;
}
fn tsnoise(p: vec3f) -> f32 { return tvnoise(p) * 0.6 + tvnoise(p * 2.11 + 3.1) * 0.3 + tvnoise(p * 4.37 + 7.7) * 0.1; }
fn twrinkle(p: vec3f, n: vec3f, freq: f32, amp: f32) -> vec3f {
  let q = p * freq;
  let h0 = tsnoise(q);
  let g = vec3f(tsnoise(q + vec3f(0.35, 0.0, 0.0)), tsnoise(q + vec3f(0.0, 0.35, 0.0)), tsnoise(q + vec3f(0.0, 0.0, 0.35))) - h0;
  return normalize(n - (g / 0.35 - n * dot(g / 0.35, n)) * amp);
}

// the packed heads of a lipid bilayer's leaflet, resolved when a pixel is under ~half a nanometre: a bump normal and
// a tint per lipid (phosphatidylcholine, -ethanolamine, -serine, sphingomyelin, cholesterol)
struct Lipid { n: vec3f, tint: vec3f, ao: f32, vis: f32 }
fn lipids(p: vec3f, n: vec3f, fp: f32) -> Lipid {
  var l: Lipid; l.n = n; l.tint = vec3f(1.0); l.ao = 1.0;
  l.vis = 1.0 - smoothstep(0.12, 0.45, fp);
  if (l.vis <= 0.0) { return l; }
  let s = 0.72;
  let c = cellular8(p / s, 0.7);
  let d = (p / s - c.c);
  let t = d - n * dot(d, n);
  // each head a little sphere (radius 0.46 cells): its normal tilts out from its centre; past its rim, the crevice
  let rr = length(t) / 0.46;
  let cap = sqrt(max(1.0 - rr * rr, 0.0));
  let inHead = step(rr, 1.0);
  l.n = normalize(mix(n, normalize(t / 0.46 + n * max(cap, 0.15)), inHead * l.vis));
  l.ao = mix(1.0, mix(0.35, 0.75 + 0.25 * cap, inHead), l.vis);
  let k = c.id.x;
  var tint = vec3f(1.0, 0.97, 0.93);
  if (k < 0.12) { tint = vec3f(1.0, 0.86, 0.45); }        // cholesterol
  else if (k < 0.2) { tint = vec3f(0.75, 0.9, 1.0); }     // phosphatidylserine
  else if (k < 0.32) { tint = vec3f(1.0, 0.8, 0.85); }    // sphingomyelin
  l.tint = mix(vec3f(1.0), tint, l.vis);
  return l;
}

// a surface's detail at the scale it's seen: broad undulation, fine wrinkles, then lipid heads
struct Detail { n: vec3f, tint: vec3f, ao: f32 }
fn detail(o: Organelle, p: vec3f, n0: vec3f) -> Detail {
  var d: Detail; d.n = n0; d.tint = vec3f(1.0); d.ao = 1.0;
  let fp = footprint(p);
  // wrinkles a few pixels across at any zoom: two fixed world-space octaves bracket the wanted frequency and
  // cross-fade (a frequency that followed the distance would warp the pattern into swirls)
  let lf = log2(1.0 / max(fp * 30.0, 3.0));
  let fa = exp2(floor(lf));
  let t = fract(lf);
  let facing = abs(dot(n0, normalize(frame.camPos - p)));
  let amp = 0.2 * smoothstep(0.05, 0.4, facing);
  let pa = absP(p);
  let na = twrinkle(pa + o.seed, n0, fa, amp);
  let nb = twrinkle(pa + o.seed * 1.7, n0, fa * 2.0, amp);
  d.n = normalize(mix(na, nb, t));
  let mott = mix(tsnoise(pa * (fa * 0.35) + o.seed), tsnoise(pa * (fa * 0.7) + o.seed), t);
  d.tint = vec3f(0.9 + 0.1 * mott);
  let lp = lipids(pa, d.n, fp);
  d.n = mix(d.n, lp.n, lp.vis);
  d.tint *= lp.tint;
  d.ao = lp.ao;
  return d;
}

fn shade(o: Organelle, p: vec3f, nIn: vec3f, interior: bool) -> vec3f {
  let v = normalize(frame.camPos - p);
  let m = material(o.kind, interior);
  let dt = detail(o, p, nIn);
  var s = surfOf(m);
  s.albedo *= dt.tint;
  var c = bioLight(dt.n, v, s) * dt.ao;
  c += m.glow * m.albedo;
  return fluoro(c, o.kind, dt.n, v);
}

@fragment fn fs_outer(in: VOut) -> GOut {
  let o = orgAt(in.org);
  if (CLIP) {
    if (cutHere(in)) { discard; }
    // membranes are solid only up close (cross-fading by dither with the glass)
    if (isShellOrg(o) && bayer(in.pos.xy) > G.shellSolid) { discard; }
  }
  var out: GOut;
  out.color = vec4f(shade(o, in.world, normalize(in.n), false), 1.0);
  out.nrm = viewNormal(in.n);
  out.id = in.org + 1u;
  return out;
}
@fragment fn fs_inner(in: VOut) -> GOut {
  if (CLIP) {
    if (cutHere(in)) { discard; }
    if (bayer(in.pos.xy) > G.shellSolid) { discard; }
  }
  let o = orgAt(in.org);
  var out: GOut;
  out.color = vec4f(shade(o, in.world, -normalize(in.n), true), 1.0);
  out.nrm = viewNormal(-in.n);
  out.id = in.org + 1u;
  return out;
}

// glass: the membrane as a thin wet film — nearly clear face-on, its edge (where the eye grazes through more of it)
// dense and bright; both faces drawn, the far one from inside
@fragment fn fs_glass(in: VOut, @builtin(front_facing) ff: bool) -> OitOut {
  if (cutHere(in)) { discard; }
  let o = orgAt(in.org);
  let m = material(o.kind, false);
  var n = normalize(in.n);
  if (!ff) { n = -n; }
  let p = in.world;
  let v = normalize(frame.camPos - p);
  let dt = detail(o, p, n);
  let nv = abs(dot(dt.n, v));
  let fres = pow(clamp(1.0 - nv, 0.0, 1.0), 2.4);
  var a = mix(0.03, 0.9, fres) * m.glass * select(0.4, 1.0, ff);
  a *= 1.0 - G.shellSolid;
  var s = surfOf(m);
  s.albedo *= dt.tint;
  var c = bioLight(dt.n, v, s) + m.glow * m.albedo * 3.0;
  // the film's own glow where it's seen edge-on (light scattered along it)
  c += m.sss * fres * 0.6;
  c = fluoro(c, o.kind, dt.n, v);
  let dist = length(p - frame.camPos);
  c = mix(c, G.fogColor, fogAmount(dist));
  // weighted blended OIT (McGuire & Bavoil 2013), distance measured in zooms so it behaves the same at every scale
  let zn = dist / max(G.scale, 1.0);
  let w = clamp(10.0 / (1e-5 + pow(zn / 4.0, 3.0)), 1e-2, 3e3) * max(a, 1e-3);
  var out: OitOut;
  out.accum = vec4f(c * a, a) * w;
  out.reveal = vec4f(a);
  return out;
}

// where the ray to this fragment left the removed wedge: the cut face it crossed, or none
struct CutHit { ok: bool, p: vec3f, n: vec3f, t: f32 }
fn cutFace(world: vec3f) -> CutHit {
  var h: CutHit; h.ok = false;
  let o = frame.camPos;
  let d = normalize(world - o);
  let q = o - G.cutCenter;
  let a1 = dot(q, G.cutN1); let b1 = dot(d, G.cutN1);
  let a2 = dot(q, G.cutN2); let b2 = dot(d, G.cutN2);
  // the interval of t where both half-space values are > 0
  var t0 = 0.0; var t1 = 1e12;
  if (abs(b1) < 1e-8) { if (a1 <= 0.0) { return h; } } else { let t = -a1 / b1; if (b1 > 0.0) { t0 = max(t0, t); } else { t1 = min(t1, t); } }
  if (abs(b2) < 1e-8) { if (a2 <= 0.0) { return h; } } else { let t = -a2 / b2; if (b2 > 0.0) { t0 = max(t0, t); } else { t1 = min(t1, t); } }
  if (t1 <= t0) { return h; }
  let tw = length(world - o);
  if (t1 >= tw) { return h; }
  h.ok = true;
  h.t = t1;
  h.p = o + d * t1;
  let e1 = abs(a1 + b1 * t1); let e2 = abs(a2 + b2 * t1);
  h.n = select(-G.cutN2, -G.cutN1, e1 < e2);
  return h;
}

fn capPattern(o: Organelle, p: vec3f, fp: f32) -> vec3f {
  let sd = sdOrganelle(o, p);
  let m = material(o.kind, true);
  let th = select(o.thick, shellThick(o), o.shape != S_DISC);
  // depth through the material, 0 at the outer face
  let u = clamp(-sd / max(th, 1e-3), 0.0, 1.0);
  let soft = clamp(fp / max(th, 1e-3) * 2.0, 0.02, 0.5);
  let heads = srgb(vec3f(1.0, 0.92, 0.80));
  let tails = m.albedo * 0.5 + srgb(vec3f(0.30, 0.24, 0.12));
  if (o.kind == K_NUCLEOLUS || o.kind == K_DROPLET) {
    let g = snoise(absP(p) * (1.0 / 40.0)) * 0.5 + 0.5;
    let gr = cellular(absP(p) / 25.0, 1.0);
    return material(o.kind, false).albedo * (0.55 + 0.45 * g) * (0.7 + 0.3 * smoothstep(0.0, 0.5, gr.d1));
  }
  if (o.shape == S_DISC) {
    // a cisterna: membrane at both faces, lumen between
    let w = 0.22;
    let edge = smoothstep(w + soft, w - soft, u) + smoothstep(1.0 - w - soft, 1.0 - w + soft, u);
    return mix(m.sss * 0.6, material(o.kind, false).albedo * 1.2, clamp(edge, 0.0, 1.0));
  }
  // a shell: one bilayer (heads at both faces, tails between), or two with a space between (nucleus, mitochondrion)
  let dbl = o.kind == K_NUCLEUS || o.kind == K_MITO || o.kind == K_NNUCLEUS;
  var uu = u;
  if (dbl) {
    if (u > 0.36 && u < 0.64) { return m.sss * 0.3; }
    uu = select((u - 0.64) / 0.36, u / 0.36, u <= 0.36);
  }
  let hl = 0.2;
  let hd = smoothstep(hl + soft, hl - soft, uu) + smoothstep(1.0 - hl - soft, 1.0 - hl + soft, uu);
  return mix(tails, heads, clamp(hd, 0.0, 1.0));
}

@fragment fn fs_cap(in: VOut) -> GOutD {
  let h = cutFace(in.world);
  if (!h.ok) { discard; }
  let o = orgAt(in.org);
  let sd = sdOrganelle(o, h.p);
  let th = select(o.thick, shellThick(o), o.shape != S_DISC);
  // the cut point must be inside this organelle's material (a shell: within its thickness)
  if (sd > 0.0) { discard; }
  if (isShellOrg(o) && sd < -th * 1.02) { discard; }
  let fp = footprint(h.p);
  let v = normalize(frame.camPos - h.p);
  var s: Surf;
  s.albedo = capPattern(o, h.p, fp); s.sss = s.albedo * 0.6; s.rough = 0.6; s.wrap = 0.6; s.trans = 0.0; s.rim = 0.0;
  var c = bioLight(h.n, v, s) * 0.85;
  c = fluoro(c, o.kind, h.n, v);
  var out: GOutD;
  out.color = vec4f(c, 1.0);
  out.nrm = viewNormal(h.n);
  out.id = in.org + 1u;
  let clip = frame.viewProj * vec4f(h.p, 1.0);
  out.depth = clip.z / clip.w;
  return out;
}
