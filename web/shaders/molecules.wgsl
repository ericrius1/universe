// What the molecule generator (field.wgsl) and the bead renderer (beads.wgsl) share: the type table, one instance,
// and the lists — one per (type, level of detail), CAP slots each — that the draws read through indirect arguments.
struct MolType {
  lodStart: vec3u, flags: u32,      // first bead of each level of detail; F_* flags
  lodCount: vec3u, groups: u32,     // beads in each level; chains
  color: vec3f, radius: f32,        // base colour (linear); bounding radius, nm
  color2: vec3f, spread: f32,       // RNA / second colour; per-chain variation
}
struct Inst {
  pos: vec3f, scale: f32,           // scale 0..1 also fades a molecule in
  rot: vec4f,
  mtype: u32, lod: u32, tint: u32, id: u32,
}
const CAP: u32 = 16384u;
const NTYPES: u32 = 33u;
const NLISTS: u32 = 99u;            // NTYPES × 3 levels
const F_ROTOR: u32 = 1u; const F_MEMBRANE: u32 = 2u; const F_DNABP: u32 = 4u; const F_VESICLE: u32 = 8u; const F_GLOW: u32 = 16u; const F_TINT: u32 = 64u;
const B_ROTOR: u32 = 16384u;        // bead info bit: this bead turns with the rotor
// type ids the shaders need by name (molecules.ts MOLS)
const T_TUBULIN: u32 = 22u; const T_ACTIN: u32 = 6u; const T_NUCLEOSOME: u32 = 20u; const T_DNABP: u32 = 25u; const T_NPC: u32 = 26u;
const T_RIBOSOME: u32 = 0u; const T_POLYMERASE: u32 = 21u; const T_MRNA: u32 = 30u; const T_BALL: u32 = 32u;

@group(2) @binding(0) var<storage, read> types: array<MolType>;
