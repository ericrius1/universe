// The flora's data, shared by the draw (flora.wgsl) and the sort into draws (floracull.wgsl): the species table, the
// instance record, the frame's uniform, the vertex parts and the packed vertex (mesh.ts writes it, flora.ts uploads it).

// the parts (mesh.ts PART)
const P_BARK = 0u;
const P_STEM = 1u;
const P_BLADE = 2u;
const P_LEAF = 3u;
const P_PETAL = 4u;
const P_DISC = 5u;
const P_BRACT = 6u;
const P_NEEDLE = 7u;
const P_FROND = 8u;
const P_PAD = 9u;
const P_FRUIT = 10u;
const P_POT = 11u;
const P_SOIL = 12u;
const P_MASS = 13u;

struct FloraSp {
  wind: vec4f,      // x whole-plant bend, y branch swing, z leaf flutter, w the flutter's frequency (Hz)
  look: vec4f,      // x translucency, y wrap, z occlusion strength, w gloss
  burn: vec4f,      // x how readily it burns, y how far its leaves curl, z how much it shrinks, w its regrowth (s)
  lod: vec4f,       // the ends of LOD0, LOD1 and LOD2 (its draw distance), m from the camera; w the crossfade band
                    // before each end, as a share of the distance to it
  form: vec4f,      // x how far it yields to a walker, y 1 if it hangs from its origin, z its reach from its axis (m,
                    // the widest variant's mesh), w its height (m, the tallest variant's mesh, or a vine's drop)
  buckets: vec4u,   // x its first draw bucket (variant v at level l: x + v * 3 + l), y its variants, zw -
}

// one plant: where, turned about +y (local +x to world (cos, -sin)), its scale, its vertical stretch (a vine's drop),
// species | variant << 8, its bloom (rgb8, sRGB: the petals and bracts take it) | its leaves' brightness << 24
// (0..255 for 0.5..1.5)
struct FloraInst { pos: vec3f, yaw: f32, scale: f32, stretch: f32, id: u32, bloom: u32 }

struct FloraU {
  push: array<vec4f, 4>,   // what parts the plants (a walker's legs, a gust of airbending): xyz centre, w radius (0: none)
  pushK: vec4f,            // each one's strength (1: a walker; more for a gust)
  look: vec4f,             // x brightness, y translucency scale, z the levels' distance scale (quality: > 1 nearer), w 1: no dissolving near the eye
  wind: vec4f,             // x strength scale, y gustiness (0..1), z the gust fronts' size (m), w -
  counts: vec4f,           // x instances, y draw buckets, zw -
  clearing: vec4f,         // no plant taller than w (m) within z (m) of xy (the ground's x, z): a host's (embed.ts); z 0 none
}

// the packed vertex (8 x u32, read as two vec4u)
struct Vtx {
  p: vec3f, n: vec3f, col: vec3f, ao: f32,
  part: u32, flex: f32, hf: f32, rnd: f32,
  pivot: vec3f, flutter: f32, phase: f32,
}
fn srgbDecode(c: vec3f) -> vec3f {
  return select(c / 12.92, pow((c + 0.055) / 1.055, vec3f(2.4)), c > vec3f(0.04045));
}
fn unpackNormal(u: u32) -> vec3f {
  return vec3f(f32((u >> 20u) & 1023u), f32((u >> 10u) & 1023u), f32(u & 1023u)) / 1023.0 * 2.0 - 1.0;
}
fn decodeVtx(a: vec4u, b: vec4u) -> Vtx {
  var v: Vtx;
  v.p = vec3f(bitcast<f32>(a.x), bitcast<f32>(a.y), bitcast<f32>(a.z));
  v.n = normalize(unpackNormal(a.w));
  let c = unpack4x8unorm(b.x);
  // (rgb stored sRGB, for precision where it shows)
  v.col = srgbDecode(c.rgb);
  v.ao = c.a;
  v.part = b.y & 255u;
  v.flex = f32((b.y >> 8u) & 255u) / 255.0;
  v.hf = f32((b.y >> 16u) & 255u) / 255.0;
  v.rnd = f32((b.y >> 24u) & 255u) / 255.0;
  let pxy = unpack2x16float(b.z);
  let pz = unpack2x16float(b.w & 0xffffu);
  v.pivot = vec3f(pxy.x, pxy.y, pz.x);
  v.flutter = f32((b.w >> 16u) & 255u) / 255.0;
  v.phase = f32((b.w >> 24u) & 255u) / 255.0;
  return v;
}
