// Filaments — microtubules, actin, intermediate filaments, chromatin fibres, collagen — as chains of capsules, each
// segment a camera-facing quad ray-traced in the fragment shader (exact depth and normal, so they meet the membranes
// and molecules properly at any zoom). A filament thinner than a pixel can't be traced: vs_thin draws it instead as a
// soft line a pixel or so wide into the glass targets, its opacity the fraction of the pixel it really covers — the way
// a fluorescence image shows filaments far below the resolution limit.
#include "world.wgsl"

@group(2) @binding(0) var<storage, read> segs: array<Seg>;
// the scene's depth before the tubes (renderer.ts late): world.wgsl hiddenAt — tested by the nearest any of the tube
// can be (VOut.front), so what hides that hides all of it
@group(2) @binding(1) var occDepth: texture_depth_2d;
fn segAt(i: u32) -> Seg { var s = segs[i]; s.a -= G.origin; s.b -= G.origin; return s; }

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) seg: u32,
  @location(2) across: f32,
  @location(3) cover: f32,
  @location(4) @interpolate(flat) front: f32,    // the depth of the nearest any of it can be (reversed Z: the largest)
}
struct GOutD { @location(0) color: vec4f, @location(1) nrm: vec4f, @location(2) id: u32, @builtin(frag_depth) depth: f32 }
struct OitOut { @location(0) accum: vec4f, @location(1) reveal: vec4f }

// the drawn radius: up close, molecules (tubulin, actin) take over the surface, so the tube shrinks to a core
// (chromatin's is the reach of its nucleosomes' lumps, the tube they merge into: fs_chromatin)
fn segRadius(s: Seg) -> f32 {
  let core = select(1.0, mix(0.72, 1.0, smoothstep(120.0, 600.0, G.scale)), s.kind == 0u || s.kind == 1u);
  return max(s.ra, s.rb) * core;
}

fn quad(vi: u32, s: Seg, thin: bool) -> VOut {
  var out: VOut;
  out.seg = vi / 6u;
  let c = vi % 6u;
  let corner = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0))[c];
  let r = segRadius(s);
  if (r <= 0.0) { out.pos = vec4f(0.0, 0.0, -2.0, 1.0); return out; }
  let mid = (s.a + s.b) * 0.5;
  let distEye = length(mid - frame.camPos);
  let px = distEye * G.pxAngle;               // nm per pixel there
  let wantPx = r / px;                        // radius in pixels
  out.cover = clamp(wantPx / 0.75, 0.0, 1.0);
  // the traced draw skips the sub-pixel ones; the thin draw skips the wide ones (a short overlap fades between)
  if ((thin && wantPx > 1.6) || (!thin && wantPx < 0.9)) { out.pos = vec4f(0.0, 0.0, -2.0, 1.0); return out; }
  let rr = select(r, max(r, px * 0.9), thin);
  let ax = s.b - s.a;
  let along = normalize(ax);
  let toEye = normalize(frame.camPos - mid);
  var side = cross(along, toEye);
  if (length(side) < 1e-4) { side = cross(along, vec3f(0.0, 1.0, 0.0)); }
  side = normalize(side);
  // extend past the ends by the radius (the caps), and widen a little for the perspective of a round tube
  let p = mix(s.a - along * rr, s.b + along * rr, corner.x) + side * corner.y * rr * 1.15 + toEye * rr;
  out.world = p;
  out.across = corner.y;
  // (along the view's axis the nearest of it is its nearer end's, less the radius)
  let zf = min(dot(s.a - frame.camPos, frame.camFwd), dot(s.b - frame.camPos, frame.camFwd)) - rr;
  out.front = select(1.0, frame.near / zf, zf > frame.near);
  out.pos = frame.viewProj * vec4f(p, 1.0);
  if (isCut(mid)) { out.pos = vec4f(0.0, 0.0, -2.0, 1.0); }
  // (none right in front of the lens: the clear round the camera, as the molecules have — a tube flying through it
  // otherwise fills the frame for a frame)
  if (distEye < G.clearRadius * 0.5 && length(s.b - s.a) < G.clearRadius) { out.pos = vec4f(0.0, 0.0, -2.0, 1.0); }
  // (chromatin whose nucleosomes and linkers are all molecules still, field.wgsl's, or that the haze has all but hidden:
  // nothing here to draw)
  if (s.kind == 3u && !thin && (bpMolecule(distEye + s.len + 20.0) || distEye - s.len - 20.0 > 4.0 * G.fogDist)) {
    out.pos = vec4f(0.0, 0.0, -2.0, 1.0);
  }
  return out;
}
@vertex fn vs_tube(@builtin(vertex_index) vi: u32) -> VOut { return quad(vi, segAt(vi / 6u), false); }
@vertex fn vs_thin(@builtin(vertex_index) vi: u32) -> VOut { return quad(vi, segAt(vi / 6u), true); }

// ray–capsule (Quilez)
fn capsule(ro: vec3f, rd: vec3f, pa: vec3f, pb: vec3f, r: f32) -> f32 {
  let ba = pb - pa; let oa = ro - pa;
  let baba = dot(ba, ba); let bard = dot(ba, rd); let baoa = dot(ba, oa);
  let rdoa = dot(rd, oa); let oaoa = dot(oa, oa);
  let a = baba - bard * bard;
  let b = baba * rdoa - baoa * bard;
  let c = baba * oaoa - baoa * baoa - r * r * baba;
  let h = b * b - a * c;
  if (h >= 0.0) {
    let t = (-b - sqrt(h)) / a;
    let y = baoa + t * bard;
    if (y > 0.0 && y < baba) { return t; }
    let oc = select(ro - pb, oa, y <= 0.0);
    let b2 = dot(rd, oc); let c2 = dot(oc, oc) - r * r;
    let h2 = b2 * b2 - c2;
    if (h2 > 0.0) { return -b2 - sqrt(h2); }
  }
  return -1.0;
}

struct Look { albedo: vec3f, sss: vec3f, dye: vec3f }
fn look(kind: u32) -> Look {
  var l: Look;
  switch kind {
    case 0u: { l.albedo = srgb(vec3f(0.62, 0.95, 0.72)); l.sss = srgb(vec3f(0.15, 0.6, 0.35)); l.dye = vec3f(0.2, 1.7, 0.35); }   // microtubule (tubulin-GFP)
    case 1u: { l.albedo = srgb(vec3f(1.0, 0.45, 0.42)); l.sss = srgb(vec3f(0.7, 0.1, 0.12)); l.dye = vec3f(1.4, 0.15, 1.2); }     // actin (phalloidin)
    case 2u: { l.albedo = srgb(vec3f(0.62, 0.66, 1.0)); l.sss = srgb(vec3f(0.25, 0.25, 0.7)); l.dye = vec3f(0.0); }               // intermediate filament
    case 3u: { l.albedo = srgb(vec3f(0.36, 0.45, 0.98)); l.sss = srgb(vec3f(0.12, 0.12, 0.55)); l.dye = vec3f(0.1, 0.3, 1.5); }   // chromatin (DAPI)
    default: { l.albedo = srgb(vec3f(0.95, 0.88, 0.80)); l.sss = srgb(vec3f(0.6, 0.45, 0.35)); l.dye = vec3f(0.0); }              // collagen
  }
  return l;
}

// ---------------------------------------------------------------- chromatin, small on screen
// The nucleosome's coarsest level of detail (the molecule data, level 2): its lumps (x, y, z, radius; swollen ×1.3 as
// beads.wgsl swells them) and their colours as beads.wgsl's beadColor gives them, so these are what the molecule would
// have been. As they shrink below a pixel or so they merge into the fibre's plain tube, and their colour goes over to
// its look on the way.
const NUC_LUMPS = array<vec4f, 5>(vec4f(2.091, -0.757, -0.203, 2.919), vec4f(-2.564, -0.842, 0.079, 3.087),
  vec4f(-2.155, 3.564, 0.1, 3.044), vec4f(0.33, -3.227, 0.442, 3.221), vec4f(3.14, 2.525, -0.468, 2.946));
const NUC_COLORS = array<vec3f, 5>(vec3f(0.5477, 0.3609, 0.6627), vec3f(1.0265, 0.328, 0.4445), vec3f(0.4338, 0.3387, 0.7346),
  vec3f(0.8, 0.86, 1.0), vec3f(0.865, 0.3591, 0.51));
const NUC_LUMP_R = 3.9;     // a lump's radius, about (nm)
const NUC_AVG = vec3f(0.7392, 0.461, 0.6791);   // their colours on average, by their size
const T_NUCLEOSOME: u32 = 20u;
// a base pair's coarsest level: one sphere (1 nm, swollen ×1.3) in the backbone's blue — a linker of them is a rod
const DNA_BLUE = vec3f(0.1046, 0.2014, 1.0);
const T_DNABP: u32 = 25u;

fn sphereHit(ro: vec3f, rd: vec3f, c: vec3f, r: f32) -> f32 {
  let oc = ro - c;
  let b = dot(oc, rd);
  let h = b * b - (dot(oc, oc) - r * r);
  if (h < 0.0) { return -1.0; }
  return -b - sqrt(h);
}

fn fs_chromatin(s: Seg, ro: vec3f, rd: vec3f) -> GOutD {
  let mid = (s.a + s.b) * 0.5;
  let dm = length(mid - ro);
  // (the lumps merge into the tube as they go below a pixel or so, their colours into its own on the way)
  let merge = 1.0 - smoothstep(0.6, 1.3, NUC_LUMP_R / max(dm * G.pxAngle, 1e-9));
  var tube = look(3u);
  let own = 1.0 - smoothstep(1.0, 3.0, NUC_LUMP_R / max(dm * G.pxAngle, 1e-9));
  tube.albedo = mix(NUC_AVG, tube.albedo, own); tube.sss = mix(NUC_AVG * vec3f(0.85, 0.6, 0.6), tube.sss, own);
  var t = 1e30;
  var n = vec3f(0.0);
  var sf: Surf;
  var id = 0u;
  var dye = vec3f(0.0);
  // the tube the lumps merge into
  if (merge > 0.0) {
    let tt = capsule(ro, rd, s.a, s.b, max(s.ra, s.rb) * merge * chromReach(mid));
    let p = ro + rd * tt;
    if (tt > G.clearRadius && !isCut(p)) {
      t = tt;
      let ba = s.b - s.a;
      n = normalize(p - (s.a + ba * clamp(dot(p - s.a, ba) / dot(ba, ba), 0.0, 1.0)));
      sf.albedo = tube.albedo; sf.sss = tube.sss;
      sf.rough = mix(0.5, 0.4, own); sf.wrap = mix(0.35, 0.5, own); sf.trans = mix(0.15, 0.5, own); sf.rim = mix(0.35, 0.7, own);
      id = 0x40000000u | (3u << 16u) | (s.fil & 0xffffu);
      dye = tube.dye;
    }
  }
  // the nucleosomes and linkers that aren't molecules
  if (merge < 0.999) {
    let j0 = i32(ceil(s.s0 / 11.0));
    let j1 = i32(floor((s.s0 + s.len) / 11.0 - 1e-4));
    for (var j = j0; j <= j1; j++) {
      let nu = nucleosome(s, j);
      if (isCut(nu.c)) { continue; }
      let dc = length(nu.c - ro);
      let toTube = 1.0 - smoothstep(1.0, 3.0, NUC_LUMP_R / (dc * G.pxAngle));
      // the linker's base pairs past the molecules' reach, as the rod they make (from its first to its last, the caps
      // their spheres) less the stretch of it within the reach — a hair less, so one right on the line is drawn twice
      // (the same) rather than not at all
      let lk = nu.next - nu.c;
      let L = length(lk);
      let dir = lk / L;
      let ua = ceil(5.0 / 0.34) * 0.34;
      let ub = floor((L - 5.0) / 0.34) * 0.34;
      let D = G.lodReach.y * 0.998;
      let oc = nu.c - ro;
      let bq = dot(oc, dir);
      let hq = bq * bq - (dot(oc, oc) - D * D);
      var piece = array<vec2f, 2>(vec2f(ua, ub), vec2f(1.0, 0.0));
      if (hq > 0.0) {
        let m0 = -bq - sqrt(hq);
        let m1 = -bq + sqrt(hq);
        piece[0] = vec2f(ua, min(ub, (ceil(m0 / 0.34) - 1.0) * 0.34));
        piece[1] = vec2f(max(ua, (floor(m1 / 0.34) + 1.0) * 0.34), ub);
      }
      let wl = smoothstep(G.clearRadius * 0.6, G.clearRadius, length((nu.c + nu.next) * 0.5 - ro)) * (1.0 - 0.6 * merge) * chromReach((nu.c + nu.next) * 0.5);
      for (var q = 0; q < 2; q++) {
        let u = piece[q];
        if (u.y < u.x || wl <= 0.01) { continue; }
        let pa = nu.c + dir * u.x;
        let pb = nu.c + dir * u.y;
        let tt = select(capsule(ro, rd, pa, pb, 1.3 * wl), sphereHit(ro, rd, pa, 1.3 * wl), u.y - u.x < 0.01);
        if (tt > 0.0 && tt < t) {
          t = tt;
          let p = ro + rd * tt;
          let ba = pb - pa;
          n = normalize(p - (pa + ba * clamp(dot(p - pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0)));
          sf.albedo = mix(DNA_BLUE, look(3u).albedo, toTube); sf.sss = mix(DNA_BLUE * vec3f(0.85, 0.6, 0.6), look(3u).sss, toTube);
          sf.rough = mix(0.5, 0.4, toTube); sf.wrap = mix(0.35, 0.5, toTube); sf.trans = mix(0.15, 0.5, toTube); sf.rim = mix(0.35, 0.7, toTube);
          id = 0x80000000u | (T_DNABP << 16u) | (u32(j) & 0xffffu);
          dye = mix(DNA_BLUE * 0.15, tube.dye, toTube);
        }
      }
      if (nucMolecule(dc * 1.002)) { continue; }
      // (shrinking into the clear round the lens as the molecules do, and as they merge)
      let w = smoothstep(G.clearRadius * 0.6, G.clearRadius, dc) * (1.0 - 0.6 * merge) * chromReach(nu.c);
      if (w <= 0.01) { continue; }
      // (its lumps only for a ray that comes near it; deep in the haze, where a tenth or less of it shows, one ball for
      // them all)
      let tb = sphereHit(ro, rd, nu.c, 4.5 + 4.2 * w);
      if (tb <= 0.0 || tb > t) { continue; }
      if (dc > 2.3 * G.fogDist) {
        let tt = sphereHit(ro, rd, nu.c, 6.2 * w);
        if (tt > 0.0 && tt < t) {
          t = tt;
          n = normalize(ro + rd * tt - nu.c);
          sf.albedo = mix(NUC_AVG, look(3u).albedo, toTube); sf.sss = mix(NUC_AVG * vec3f(0.85, 0.6, 0.6), look(3u).sss, toTube);
          sf.rough = mix(0.5, 0.4, toTube); sf.wrap = mix(0.35, 0.5, toTube); sf.trans = mix(0.15, 0.5, toTube); sf.rim = mix(0.35, 0.7, toTube);
          id = 0x80000000u | (T_NUCLEOSOME << 16u) | (u32(j) & 0xffffu);
          dye = mix(NUC_AVG * 0.15, tube.dye, toTube);
        }
        continue;
      }
      let rot = nucRot(nu);
      for (var k = 0u; k < 5u; k++) {
        let L = NUC_LUMPS[k];
        let c = nu.c + qrot(rot, L.xyz);
        let r = L.w * 1.3 * w;
        // (none where the jewel is: it's the bead there, src/loop.ts)
        if (G.jewel.w > 0.0 && length(c - G.jewel.xyz) < G.jewel.w + r * 0.6) { continue; }
        let tt = sphereHit(ro, rd, c, r);
        if (tt > 0.0 && tt < t) {
          t = tt;
          n = normalize(ro + rd * tt - c);
          let col = NUC_COLORS[k];
          sf.albedo = mix(col, look(3u).albedo, toTube); sf.sss = mix(col * vec3f(0.85, 0.6, 0.6), look(3u).sss, toTube);
          sf.rough = mix(0.5, 0.4, toTube); sf.wrap = mix(0.35, 0.5, toTube); sf.trans = mix(0.15, 0.5, toTube); sf.rim = mix(0.35, 0.7, toTube);
          id = 0x80000000u | (T_NUCLEOSOME << 16u) | (u32(j) & 0xffffu);
          dye = mix(col * 0.15, tube.dye, toTube);
        }
      }
    }
  }
  if (t > 1e29) { discard; }
  let p = ro + rd * t;
  let v = -rd;
  var c = bioLightAt(p, n, v, sf);
  c = mix(c, dye * (0.4 + 0.6 * pow(clamp(1.0 - abs(dot(n, v)), 0.0, 1.0), 1.2)), G.fluo);
  var out: GOutD;
  out.color = vec4f(c, 1.0);
  out.nrm = octNormal(normalize((frame.view * vec4f(n, 0.0)).xyz));
  out.id = id;
  let clip = frame.viewProj * vec4f(p, 1.0);
  out.depth = clip.z / clip.w;
  return out;
}

@fragment fn fs_tube(in: VOut) -> GOutD {
  if (hiddenAt(occDepth, in.pos, in.front)) { discard; }
  let s = segAt(in.seg);
  let ro = frame.camPos;
  let rd = normalize(in.world - ro);
  if (s.kind == 3u) { return fs_chromatin(s, ro, rd); }
  let r = segRadius(s);
  let t = capsule(ro, rd, s.a, s.b, r);
  if (t <= 0.0 || t < G.clearRadius) { discard; }
  let p = ro + rd * t;
  if (isCut(p)) { discard; }
  let ba = s.b - s.a;
  let h = clamp(dot(p - s.a, ba) / dot(ba, ba), 0.0, 1.0);
  var n = normalize(p - (s.a + ba * h));
  let v = -rd;
  let l = look(s.kind);
  // fine ridges along the length: protofilaments on a microtubule, the twist of actin and collagen
  let along = s.s0 + h * s.len;
  let fp = t * G.pxAngle;
  let ang = atan2(dot(n, normalize(cross(ba, vec3f(0.3, 1.0, 0.2)))), dot(n, normalize(cross(ba, cross(ba, vec3f(0.3, 1.0, 0.2))))));
  var ridge = 0.0;
  if (s.kind == 0u) { ridge = sin(ang * 13.0) * (1.0 - smoothstep(0.6, 2.5, fp)); }
  else if (s.kind == 4u) { ridge = sin(along * 0.0935 * 6.2831853) * 0.6 * (1.0 - smoothstep(8.0, 30.0, fp)); }   // 67 nm D-banding
  var sf: Surf;
  sf.albedo = vary(l.albedo, s.fil) * (0.92 + 0.08 * ridge); sf.sss = l.sss; sf.rough = 0.4; sf.wrap = 0.5; sf.trans = 0.5; sf.rim = 0.7;
  var c = bioLightAt(p, n, v, sf);
  c = mix(c, l.dye * (0.4 + 0.6 * pow(clamp(1.0 - abs(dot(n, v)), 0.0, 1.0), 1.2)), G.fluo);
  var out: GOutD;
  out.color = vec4f(c, 1.0);
  out.nrm = octNormal(normalize((frame.view * vec4f(n, 0.0)).xyz));
  out.id = 0x40000000u | (s.kind << 16u) | (s.fil & 0xffffu);
  let clip = frame.viewProj * vec4f(p, 1.0);
  out.depth = clip.z / clip.w;
  return out;
}

@fragment fn fs_thin(in: VOut) -> OitOut {
  let s = segAt(in.seg);
  if (isCut(in.world)) { discard; }
  let l = look(s.kind);
  // a soft line: brightest along its middle, its opacity the coverage it really has
  let prof = 1.0 - smoothstep(0.2, 1.0, abs(in.across));
  let fade = array<f32, 5>(0.3, 0.3, 0.25, 0.5, 0.16)[min(s.kind, 4u)];
  let a = clamp(in.cover * prof * 0.9, 0.0, 1.0) * fade;
  if (a < 0.003) { discard; }
  let dist = length(in.world - frame.camPos);
  var c = mix(l.albedo * select(1.3, 0.55, s.kind == 4u), l.dye, G.fluo);
  c = mix(c, G.fogColor, fogAmount(dist));
  let zn = dist / max(G.scale, 1.0);
  let w = clamp(10.0 / (1e-5 + pow(zn / 4.0, 3.0)), 1e-2, 3e3) * a;
  var out: OitOut;
  out.accum = vec4f(c * a, a) * w;
  out.reveal = vec4f(a);
  return out;
}
