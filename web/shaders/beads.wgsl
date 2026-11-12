// Molecules drawn as their beads: every bead a camera-facing quad ray-traced into a sphere (exact depth and normal, so
// packed beads meet in crisp creases that the ambient occlusion then darkens — the look of a space-filling model).
// One indirect draw per (type, level of detail): the bead comes from the vertex index (first vertex = the level's first
// bead), the instance from the list slot (first instance = the list's start), which needs 'indirect-first-instance'.
#include "world.wgsl"
#include "molecules.wgsl"

@group(2) @binding(1) var<storage, read> insts: array<Inst>;
@group(2) @binding(2) var<storage, read> lists: array<u32>;
@group(2) @binding(11) var<storage, read> beads: array<vec4f>;
@group(2) @binding(12) var<storage, read> beadInfo: array<u32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) center: vec3f,
  @location(2) @interpolate(flat) radius: f32,
  @location(3) @interpolate(flat) color: vec3f,
  @location(4) @interpolate(flat) info4: vec4u,     // type, flags, instance id, bead info
}
struct GOut { @location(0) color: vec4f, @location(1) nrm: vec4f, @location(2) id: u32 }
// (the depth the scene ended with, the beads' own among it: the lit draw shades only the bead that set it)
@group(2) @binding(13) var beadDepth: texture_depth_2d;

fn hueShift(c: vec3f, h: f32, l: f32) -> vec3f {
  // a small turn about the grey axis, and a lightness nudge
  let k = vec3f(0.57735);
  let ca = cos(h); let sa = sin(h);
  let r = c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
  return max(r * (1.0 + l), vec3f(0.0));
}

fn beadColor(T: MolType, inst: Inst, info: u32) -> vec3f {
  // a ball takes its colour from the instance (sRGB, packed in tint)
  if ((T.flags & F_TINT) != 0u) { return srgb(unpack4x8unorm(inst.tint).rgb); }
  let g = info & 0xfffu;
  let kind = (info >> 12u) & 3u;
  if ((T.flags & F_DNABP) != 0u) {
    // backbones blue-white; the bases A, T, G, C (pairs from the instance's tint)
    if (g < 2u) { return select(T.color, T.color2, g == 1u); }
    let pair = inst.tint % 4u;
    let A = vec3f(1.0, 0.32, 0.25); let Tt = vec3f(1.0, 0.82, 0.2); let Gg = vec3f(0.3, 0.9, 0.4); let C = vec3f(0.35, 0.6, 1.0);
    var a = A; var b = Tt;
    if (pair == 1u) { a = Tt; b = A; } else if (pair == 2u) { a = Gg; b = C; } else if (pair == 3u) { a = C; b = Gg; }
    return select(a, b, g == 3u);
  }
  var c = T.color;
  if (kind == 1u) { c = T.color2; }
  else if (kind == 2u) { c = select(vec3f(0.33, 0.48, 1.0), vec3f(0.8, 0.86, 1.0), (g & 1u) == 1u); }
  else if (T.spread > 0.0) {
    let hs = fract(f32(g) * 0.6180339);
    c = mix(T.color, T.color2, select(0.0, hs, T.groups > 2u));
    c = hueShift(c, (hs - 0.5) * T.spread * 3.0, (fract(f32(g) * 0.379) - 0.5) * T.spread * 2.0);
  }
  return c;
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var out: VOut;
  let inst = insts[lists[ii]];
  let T = types[inst.mtype];
  let bi = vi / 6u;
  let b = beads[bi];
  let info = beadInfo[bi];
  var lp = b.xyz;
  if ((T.flags & F_ROTOR) != 0u && (info & B_ROTOR) != 0u) {
    // ATP synthase's rotor: ~150 turns a second, slowed with everything else as you zoom in
    // (a game's own motor, id bit 0x8000: its tint is the rotor angle in tenths of a degree)
    // (anticlockwise seen from the matrix: the synthesis direction)
    var a = -(G.bioTime * 6.2831853 * 150.0) + f32(inst.tint % 360u);
    if ((inst.id & 0x8000u) != 0u) { a = f32(inst.tint) * 0.00174533; }
    let ca = cos(a); let sa = sin(a);
    lp = vec3f(lp.x * ca - lp.z * sa, lp.y, lp.x * sa + lp.z * ca);
  }
  // (a vesicle is one bead the size it's given; everything else keeps its size and fades in by shrinking — its beads
  // in place, or, a film's (G.flags 1), the whole of it, a solid going off rather than a dust)
  let whole = (T.flags & F_VESICLE) != 0u || (G.flags & 1u) != 0u;
  let c = inst.pos + qrot(inst.rot, lp * select(1.0, inst.scale, whole));
  var r = b.w * inst.scale;
  if ((T.flags & F_VESICLE) != 0u) { r = inst.scale; }
  // the coarsest level's lumps swell to merge into one soft shape (no sand of tiny spheres)
  if (inst.lod == 2u) { r *= 1.3; } else if (inst.lod == 1u) { r *= 1.16; }
  let corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi % 6u];
  let toEye = normalize(frame.camPos - c);
  let right = normalize(cross(frame.camUp, toEye));
  let up = cross(toEye, right);
  let dist = length(frame.camPos - c);
  // a quad in front of the sphere, wide enough for its perspective silhouette
  let grow = r * dist / sqrt(max(dist * dist - r * r, 1e-6));
  let p = c + (right * corner.x + up * corner.y) * grow * 1.05 + toEye * r;
  out.world = p;
  out.center = c;
  out.radius = r;
  out.color = beadColor(T, inst, info);
  out.info4 = vec4u(inst.mtype, T.flags, inst.id, info);
  out.pos = frame.viewProj * vec4f(p, 1.0);
  if (dist <= r * 1.05) { out.pos = vec4f(0.0, 0.0, -2.0, 1.0); }
  // (none where the jewel is: it's the bead there, src/loop.ts)
  if (G.jewel.w > 0.0 && length(c - G.jewel.xyz) < G.jewel.w + r * 0.6) { out.pos = vec4f(0.0, 0.0, -2.0, 1.0); }
  return out;
}

// where the eye's ray through this fragment meets the bead (t < 0: it misses), and its depth there
struct BeadHit { t: f32, p: vec3f, rd: vec3f, depth: f32 }
fn beadHit(in: VOut) -> BeadHit {
  var o: BeadHit;
  let ro = frame.camPos;
  o.rd = normalize(in.world - ro);
  let oc = ro - in.center;
  let b = dot(oc, o.rd);
  let cc = dot(oc, oc) - in.radius * in.radius;
  let h = b * b - cc;
  o.t = select(-1.0, -b - sqrt(max(h, 0.0)), h >= 0.0);
  o.p = ro + o.rd * o.t;
  let clip = frame.viewProj * vec4f(o.p, 1.0);
  o.depth = clip.z / clip.w;
  return o;
}

// first, in the scene pass: the depth alone (every bead, cheaply, so the scene's depth is the nearest of everything)
@fragment fn fs_depth(in: VOut) -> @builtin(frag_depth) f32 {
  let hit = beadHit(in);
  if (hit.t < 0.0) { discard; }
  return hit.depth;
}

// then lit, in a pass of its own over the scene's depth (renderer.ts beads): the quad lies at the bead's front, so one
// wholly behind what's there fails the depth test before it's shaded; one that pokes through is shaded only where its
// own depth is the one there
@fragment fn fs(in: VOut) -> GOut {
  let hit = beadHit(in);
  if (hit.t < 0.0) { discard; }
  let there = textureLoad(beadDepth, vec2i(in.pos.xy), 0);
  if (abs(hit.depth - there) > there * 4e-6) { discard; }
  let rd = hit.rd;
  let t = hit.t;
  let p = hit.p;
  var n = normalize(p - in.center);
  let v = -rd;
  let flags = in.info4.y;
  var s: Surf;
  s.albedo = in.color; s.sss = in.color * vec3f(0.85, 0.6, 0.6); s.rough = 0.5; s.wrap = 0.35; s.trans = 0.15; s.rim = 0.35;
  var glow = vec3f(0.0);
  if ((flags & F_VESICLE) != 0u) {
    // a vesicle's membrane: packed lipid heads on a wet bubble
    let fp = t * G.pxAngle;
    let vis = 1.0 - smoothstep(0.12, 0.45, fp);
    if (vis > 0.0) {
      let cl = cellular8(p / 0.72, 0.85);
      let d = p / 0.72 - cl.c;
      let tg = d - n * dot(d, n);
      let bump = 1.0 - smoothstep(0.25, 0.62, length(tg));
      n = normalize(mix(n, normalize(n * 0.55 + tg), (1.0 - bump) * vis));
      s.albedo *= mix(1.0, mix(0.55, 1.0, bump), vis);
    }
    s.rough = 0.3; s.rim = 0.9; s.trans = 0.6;
  }
  if ((flags & F_GLOW) != 0u) { glow = in.color * 1.6; }
  var c = bioLight(n, v, s) + glow;
  c = mix(c, in.color * 0.15 + glow * 2.0, G.fluo * 0.85);
  var out: GOut;
  out.color = vec4f(c, 1.0);
  out.nrm = vec4f(normalize((frame.view * vec4f(n, 0.0)).xyz), 1.0);
  out.id = 0x80000000u | (in.info4.x << 16u) | (in.info4.z & 0xffffu);
  return out;
}
