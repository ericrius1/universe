// The molecular field, made fresh every frame on the GPU round the point the camera looks at. Space is cut into
// chunks at a ladder of sizes (c0·2^L); each chunk holds K candidate molecules at hashed spots. The finest level in
// play follows the zoom, and coarser levels' molecules stay as finer ones arrive — so a molecule seen from a micron
// away is the same one you find at ten nanometres, and the crowd thickens as you zoom until it's as dense as a real
// cytoplasm. Each candidate asks the world where it is (world.wgsl placeOf): inside which organelle, how near which
// membrane. Near a membrane it becomes one of that membrane's proteins, set into the surface; elsewhere one of its
// compartment's soluble molecules, by weight. Filaments are decorated by `lattice` (tubulin in 13 protofilaments on a
// 3-start helix, actin's double helix, nucleosomes on chromatin with linker DNA between), and the app's animated
// actors (kinesins, vesicles) come in through `actors`. Each instance gets a level of detail from its size on screen
// and is appended to its (type, level) list; `finish` turns the counts into indirect draw arguments.
#include "world.wgsl"
#include "molecules.wgsl"

struct Field {
  focus: vec3f, radius: f32,
  camPos: vec3f, clear: f32,
  level: f32, c0: f32, perChunk: u32, maxInst: u32,
  lv0: vec4i, lv1: vec4i, lv2: vec4i, lv3: vec4i,     // per generated level: origin chunk, chunks per side
  lf: vec4f,                                          // per generated level: its absolute level number
  starts: vec4u,                                      // first thread of each level
  total: u32, segCount: u32, actorCount: u32, seed: u32,
  pxAngle: f32, lod0: f32, lod1: f32, cull: f32,
  p0: vec4f, p1: vec4f, p2: vec4f, p3: vec4f, p4: vec4f, p5: vec4f,   // frustum planes
  latticeOn: f32, wobble: f32, latticeR: f32, nearByRadius: f32,   // latticeR: how far round the focus filaments are
                                    // decorated; nearByRadius: 1, a molecule kept from the lens by its own size (emit), not by `clear`
}
struct CompEntry { mtype: u32, cum: f32 }

@group(2) @binding(1) var<storage, read_write> insts: array<Inst>;
@group(2) @binding(2) var<storage, read_write> lists: array<u32>;
@group(2) @binding(3) var<storage, read_write> counts: array<atomic<u32>>;
@group(2) @binding(4) var<storage, read_write> args: array<u32>;
@group(2) @binding(5) var<uniform> F: Field;
@group(2) @binding(6) var<storage, read> comps: array<CompEntry>;       // 32 rows of 12: compartments, then membranes by kind
@group(2) @binding(7) var<storage, read> compMeta: array<vec4f>;        // per row: density, entries, offset, -
@group(2) @binding(8) var<storage, read> segs: array<Seg>;
@group(2) @binding(9) var<storage, read> segList: array<u32>;
@group(2) @binding(10) var<storage, read> actorIn: array<Inst>;     // (positions already relative to the origin)

fn segAt(i: u32) -> Seg { var s = segs[i]; s.a -= G.origin; s.b -= G.origin; return s; }

const ROW: u32 = 12u;
const MEMBRANE_ROW: u32 = 16u;     // membranes start at row 16 + organelle kind

// ---------------------------------------------------------------- appending
fn planeOut(p: vec3f, r: f32) -> bool {
  return dot(F.p0.xyz, p) + F.p0.w < -r || dot(F.p1.xyz, p) + F.p1.w < -r || dot(F.p2.xyz, p) + F.p2.w < -r ||
         dot(F.p3.xyz, p) + F.p3.w < -r || dot(F.p4.xyz, p) + F.p4.w < -r || dot(F.p5.xyz, p) + F.p5.w < -r;
}
fn emit(inst0: Inst, crowd: bool) {
  var inst = inst0;
  let T = types[inst.mtype];
  // (a film's crowd: none on the line the eye backs away along — any there would meet the lens, so they're never
  // there at all — and a small clear right at the lens; the rest, flown past, come in from the frame's edge and go,
  // rather than swelling up in front of it as a clear round the lens lets them out)
  if (crowd && F.nearByRadius > 0.5) {
    let a = normalize(F.camPos - F.focus);
    let v = inst.pos - F.focus;
    let along = dot(v, a);
    let lat = length(v - a * along);
    let rr = T.radius * 1.3 + F.clear * 0.1;
    inst.scale *= select(1.0, smoothstep(rr, rr * 1.8, lat), along > 0.0);
    inst.scale *= smoothstep(min(2.0 * T.radius, F.clear * 0.6), min(3.0 * T.radius, F.clear), length(inst.pos - F.camPos));
  }
  let r = T.radius * inst.scale;
  if (r <= 0.0) { return; }
  let dc = length(inst.pos - F.camPos);
  let px = r / max(dc * F.pxAngle, 1e-9);
  if (px < F.cull) { return; }
  if (planeOut(inst.pos, r)) { return; }
  // (its level of detail by the size it counts as, the haze taken in: world.wgsl lodPx)
  let lpx = px * exp(-0.5 * dc / G.fogDist);
  var lod = 2u;
  if (lpx > F.lod0) { lod = 0u; } else if (lpx > F.lod1) { lod = 1u; }
  inst.lod = lod;
  let i = atomicAdd(&counts[NLISTS], 1u);
  if (i >= F.maxInst) { return; }
  insts[i] = inst;
  let li = inst.mtype * 3u + lod;
  let slot = atomicAdd(&counts[li], 1u);
  if (slot < CAP) { lists[li * CAP + slot] = i; }
}

@compute @workgroup_size(64) fn clear(@builtin(global_invocation_id) g: vec3u) {
  if (g.x <= NLISTS) { atomicStore(&counts[g.x], 0u); }
}

@compute @workgroup_size(64) fn finish(@builtin(global_invocation_id) g: vec3u) {
  let li = g.x;
  if (li >= NLISTS) { return; }
  let T = types[li / 3u];
  let lod = li % 3u;
  let n = min(atomicLoad(&counts[li]), CAP);
  args[li * 4u + 0u] = T.lodCount[lod] * 3u;
  args[li * 4u + 1u] = n;
  args[li * 4u + 2u] = T.lodStart[lod] * 3u;
  args[li * 4u + 3u] = li * CAP;
}

// ---------------------------------------------------------------- the crowd
fn compartmentRow(inside: i32) -> u32 {
  if (inside < 0) { return 0u; }
  switch organelles[u32(inside)].kind {
    case 0u: { return 1u; }     // cytosol
    case 1u: { return 2u; }     // nucleoplasm
    case 2u: { return 3u; }     // nucleolus
    case 3u: { return 4u; }     // mitochondrial matrix
    case 5u: { return 5u; }     // ER lumen
    case 6u: { return 6u; }     // Golgi lumen
    case 7u: { return 7u; }     // lysosome
    case 8u: { return 8u; }     // peroxisome
    case 9u, 10u: { return 9u; }
    case 4u: { return 10u; }    // inside a crista
    case 11u: { return 11u; }
    default: { return 12u; }    // a neighbouring cell
  }
}
fn pick(row: u32, u: f32) -> i32 {
  let n = u32(compMeta[row].y);
  if (n == 0u) { return -1; }
  for (var k = 0u; k < n; k++) {
    let e = comps[row * ROW + k];
    if (u <= e.cum) { return i32(e.mtype); }
  }
  return i32(comps[row * ROW + n - 1u].mtype);
}

// a gentle tumble and drift (Brownian, but small: real diffusion would carry everything out of view)
fn wobble(h: vec3f, r: f32) -> vec3f {
  let t = G.bioTime * 40.0 + h * 100.0;
  return (vec3f(vnoise(vec3f(t.x, h.y * 9.0, 0.0)), vnoise(vec3f(h.z * 9.0, t.y, 1.0)), vnoise(vec3f(2.0, h.x * 9.0, t.z)))) * r * F.wobble;
}

@compute @workgroup_size(64) fn crowd(@builtin(global_invocation_id) g: vec3u) {
  let t = g.x;
  if (t >= F.total) { return; }
  // which level, which chunk, which slot
  var L = 0u;
  if (t >= F.starts.y) { L = 1u; }
  if (t >= F.starts.z) { L = 2u; }
  if (t >= F.starts.w) { L = 3u; }
  var lv = F.lv0; var start = F.starts.x;
  if (L == 1u) { lv = F.lv1; start = F.starts.y; }
  if (L == 2u) { lv = F.lv2; start = F.starts.z; }
  if (L == 3u) { lv = F.lv3; start = F.starts.w; }
  let absL = F.lf[L];
  let cL = F.c0 * exp2(absL);
  let local = t - start;
  let K = F.perChunk;
  let k = local % K;
  let lin = local / K;
  let n = u32(lv.w);
  let ci = lv.xyz + vec3i(i32(lin % n), i32((lin / n) % n), i32(lin / (n * n)));
  let hu = pcg3(bitcast<vec3u>(ci) + vec3u(k * 0x9E3779B1u, u32(absL) * 0x85EBCA6Bu, F.seed));
  let h = vec3f(hu) * (1.0 / 4294967296.0);
  let h2 = hash3u(hu ^ vec3u(0x27d4eb2fu));
  // (the chunk's spot rounds the same every frame; rebased before anything moves it)
  var p = (vec3f(ci) + h) * cL - G.origin;

  let d = length(p - F.focus);
  if (d > F.radius) { return; }
  // (none crowding the jewel, src/loop.ts: its first frame's view of it clear)
  if (G.jewel.w > 0.0 && length(p - G.jewel.xyz) < G.jewel.w * 25.0) { return; }
  let wD = 1.0 - smoothstep(0.7 * F.radius, F.radius, d);
  let wL = clamp((absL + 1.0 - F.level) / 0.6, 0.0, 1.0);
  let dc = length(p - F.camPos);
  let wC = select(smoothstep(F.clear * 0.6, F.clear, dc), 1.0, F.nearByRadius > 0.5);
  var w = wD * wL * wC;
  if (w <= 0.01) { return; }
  if (isCut(p)) { return; }
  // (out of view, whatever it turns out to be — the largest molecule, moved onto a membrane as far as the band and
  // jostled — it would be culled in emit: so it goes before asking the world where it is, much of the work here)
  if (planeOut(p, 130.0 + cL * 0.4)) { return; }

  let pl = placeOf(p);
  var inst: Inst;
  inst.tint = hu.x;
  inst.id = 0x80000000u | (hu.y & 0xffffu);
  let band = cL * 0.32;
  if (pl.nearest >= 0 && pl.dist < band) {
    // a membrane protein, set into the nearest surface
    let o = orgAt(u32(pl.nearest));
    let row = MEMBRANE_ROW + o.kind;
    let mm = compMeta[row];
    // (the band is a fixed share of the chunk, so finer levels would put ever more proteins per area: their
    // acceptance falls with the chunk's area below 120 nm)
    let areaK = min(1.0, (cL / 120.0) * (cL / 120.0));
    if (mm.y < 0.5 || h2.z > mm.x * areaK) { return; }
    let mt = pick(row, h2.x);
    if (mt < 0) { return; }
    let sd = sdOrganelle(o, p);
    let nrm = organelleNormal(o, p, max(0.4, o.r * 1e-4));
    p = p - nrm * sd + nrm * mm.z;
    if (isCut(p)) { return; }
    inst.pos = p;
    inst.rot = qmul(qfromY(nrm), qaxis(vec3f(0.0, 1.0, 0.0), h2.y * 6.2831853));
    inst.mtype = u32(mt);
  } else {
    let row = compartmentRow(pl.inside);
    if (h2.z > compMeta[row].x) { return; }
    let mt = pick(row, h2.x);
    if (mt < 0) { return; }
    let r = types[u32(mt)].radius;
    if (pl.dist < r * 0.9) { return; }
    inst.pos = p + wobble(h, r);
    inst.rot = randQuat(hash3u(hu ^ vec3u(0x165667b1u)));
    inst.mtype = u32(mt);
  }
  inst.scale = w;
  emit(inst, true);
}

// ---------------------------------------------------------------- filament lattices
fn fade(p: vec3f) -> f32 {
  let d = length(p - F.focus);
  let dc = length(p - F.camPos);
  return (1.0 - smoothstep(0.7 * F.latticeR, F.latticeR, d)) * smoothstep(F.clear * 0.6, F.clear, dc);
}

@compute @workgroup_size(64) fn lattice(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= F.segCount) { return; }
  let s = segAt(segList[g.x]);
  let ax = s.b - s.a;
  // (a segment wholly out of view makes nothing emit would keep: every chromatin segment is in the list, wherever it is)
  if (planeOut((s.a + s.b) * 0.5, length(ax) * 0.5 + 40.0)) { return; }
  let T = normalize(ax);
  let R0 = normalize(cross(T, vec3f(0.31, 1.0, 0.17)));
  let R1 = cross(T, R0);
  if (s.kind == 0u) {
    // microtubule: αβ dimers 8 nm long on 13 protofilaments, each protofilament 0.92 nm higher (the 3-start helix)
    for (var k = 0u; k < 13u; k++) {
      let th = f32(k) * 6.2831853 / 13.0;
      let rad = R0 * cos(th) + R1 * sin(th);
      let off = f32(k) * 0.923;
      let j0 = i32(ceil((s.s0 - off) / 8.0));
      let j1 = i32(floor((s.s0 + s.len - off) / 8.0 - 1e-4));
      for (var j = j0; j <= j1; j++) {
        let z = f32(j) * 8.0 + off;
        let p = s.a + ax * ((z - s.s0) / s.len) + rad * 11.2;
        let w = fade(p) * F.latticeOn;
        if (w <= 0.01 || isCut(p)) { continue; }
        var inst: Inst;
        inst.pos = p; inst.scale = w; inst.rot = basis(rad, T); inst.mtype = T_TUBULIN;
        inst.tint = u32(j) * 13u + k; inst.id = 0x80000000u | ((u32(j) * 13u + k) & 0xffffu);
        emit(inst, false);
      }
    }
  } else if (s.kind == 1u) {
    // actin: subunits every 2.75 nm, each turned -166.6° from the last (two long-pitch strands)
    let j0 = i32(ceil(s.s0 / 2.75));
    let j1 = i32(floor((s.s0 + s.len) / 2.75 - 1e-4));
    for (var j = j0; j <= j1; j++) {
      let z = f32(j) * 2.75;
      let th = f32(j) * -2.9077;
      let rad = R0 * cos(th) + R1 * sin(th);
      let p = s.a + ax * ((z - s.s0) / s.len) + rad * 2.4;
      let w = fade(p) * F.latticeOn;
      if (w <= 0.01 || isCut(p)) { continue; }
      var inst: Inst;
      inst.pos = p; inst.scale = w; inst.rot = basis(rad, T); inst.mtype = T_ACTIN;
      inst.tint = u32(j); inst.id = 0x80000000u | (u32(j) & 0xffffu);
      emit(inst, false);
    }
  } else if (s.kind == 3u && !chromatinShut((s.a + s.b) * 0.5, length(ax) * 0.5 + 30.0)) {
    // chromatin: a nucleosome every 11 nm in a zig-zag round the fibre (world.wgsl nucleosome) — the molecule while
    // it's big on screen, filament.wgsl's lumps after — and linker DNA between them
    let j0 = i32(ceil(s.s0 / 11.0));
    let j1 = i32(floor((s.s0 + s.len) / 11.0 - 1e-4));
    for (var j = j0; j <= j1; j++) {
      let nu = nucleosome(s, j);
      let c = nu.c;
      let rad = nu.rad;
      if (isCut(c)) { continue; }
      let dc = length(c - F.camPos);
      let w = smoothstep(F.clear * 0.6, F.clear, dc) * chromReach(c);
      if (nucMolecule(dc) && w > 0.01) {
        var inst: Inst;
        inst.pos = c; inst.scale = w; inst.rot = nucRot(nu);
        inst.mtype = T_NUCLEOSOME; inst.tint = u32(j); inst.id = 0x80000000u | (u32(j) & 0xffffu);
        emit(inst, false);
      }
      // the linker to the next nucleosome: base pairs every 0.34 nm, 36° apart, leaving the cores (5.5 nm round each)
      // (as molecules only close in: further off filament.wgsl draws the rod they'd make)
      let lk = nu.next - c;
      let L = length(lk);
      let dir = lk / L;
      let ref0 = normalize(cross(dir, vec3f(0.17, 0.31, 1.0)));
      let nbp = select(0, i32(L / 0.34), bpMolecule(dc - L));
      for (var b = 0; b < nbp; b++) {
        let along = f32(b) * 0.34;
        if (along < 5.0 || along > L - 5.0) { continue; }
        let pb = c + dir * along;
        if (!bpMolecule(length(pb - F.camPos))) { continue; }
        let wb = smoothstep(F.clear * 0.6, F.clear, length(pb - F.camPos)) * chromReach(pb);
        if (wb <= 0.01) { continue; }
        var bp: Inst;
        let tw = f32(b) * 0.62832 + f32(j) * 1.7;
        bp.pos = pb; bp.scale = wb; bp.rot = qmul(basis(ref0, dir), qaxis(vec3f(0.0, 1.0, 0.0), tw));
        bp.mtype = T_DNABP;
        bp.tint = pcg3(vec3u(u32(b), u32(j), s.fil)).x;
        bp.id = 0x80000000u | (u32(j) & 0xffffu);
        emit(bp, false);
      }
    }
  }
}

// ---------------------------------------------------------------- actors (the app's own: walkers, cargo, the game)
@compute @workgroup_size(64) fn actors(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= F.actorCount) { return; }
  let a = actorIn[g.x];
  if (isCut(a.pos)) { return; }
  emit(a, false);
}
