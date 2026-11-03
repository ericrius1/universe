// What the rock and crystal draws read (rocks.ts fills it): every prototype's meshes in one vertex array (pulled by
// index, each level of detail's first vertex as its draw's base), the placed instances (an object-to-world 3x4 and a
// few numbers each), and this frame's visible instances, grouped by prototype and level of detail (a draw's instances
// are its slice of that list). A vertex is 20 bytes: its position in its prototype's metres, its normal (snorm8 x3) with
// its ambient (unorm8) in the fourth byte, and its bed (the bed's id in the low 16 bits, the fraction up the bed in the
// next 8, flags in the top 8: 1 a hard bed; for a crystal the id is its crystal's
// index in the cluster list and the fraction how far along the crystal).

struct RockV { px: f32, py: f32, pz: f32, n: u32, b: u32 }

// rows of the object-to-world transform (rotation and uniform scale, translation in w); misc: x a seed (0..1), y the
// night glow (crystals, 0..1), z the height of the ground it stands on (its sand stain; far below: none), w -
struct RockInst { m0: vec4f, m1: vec4f, m2: vec4f, misc: vec4f }

@group(2) @binding(0) var<storage, read> rockVerts: array<RockV>;
@group(2) @binding(1) var<storage, read> rockInsts: array<RockInst>;
@group(2) @binding(2) var<storage, read> rockVis: array<u32>;

fn instPoint(k: RockInst, p: vec3f) -> vec3f {
  return vec3f(dot(k.m0.xyz, p) + k.m0.w, dot(k.m1.xyz, p) + k.m1.w, dot(k.m2.xyz, p) + k.m2.w);
}
fn instDir(k: RockInst, d: vec3f) -> vec3f { return vec3f(dot(k.m0.xyz, d), dot(k.m1.xyz, d), dot(k.m2.xyz, d)); }
fn instScale(k: RockInst) -> f32 { return length(vec3f(k.m0.x, k.m1.x, k.m2.x)); }

fn vertPos(v: RockV) -> vec3f { return vec3f(v.px, v.py, v.pz); }
fn vertNormal(v: RockV) -> vec3f { return unpack4x8snorm(v.n).xyz; }
fn vertAo(v: RockV) -> f32 { return unpack4x8unorm(v.n).w; }
fn vertBed(v: RockV) -> f32 { return f32(v.b & 0xffffu) + f32((v.b >> 16u) & 0xffu) / 256.0; }
fn vertFlags(v: RockV) -> u32 { return v.b >> 24u; }

// a hash 0..1 of an id and a salt (tools/rocks/palette.ts has its twin, for the previews)
fn rkHash(id: u32, salt: u32) -> f32 { return hashF((id * 0x9e3779b1u) ^ salt); }

// the shadow cascades: position only
@vertex fn vsShadow(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  return frame.viewProj * vec4f(instPoint(rockInsts[rockVis[ii]], vertPos(rockVerts[vi])), 1.0);
}
