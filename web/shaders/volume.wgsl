// The crowd as a coarse density volume round the focus (src/engine/volume.ts): each frame every molecule the field made
// (field.wgsl, the instances the beads are drawn from) is splatted into a grid by its volume — an atomic add into the
// eight cells round its middle — then the grid is smoothed into a filterable 3D texture with a short mip chain. Shading
// (world.wgsl crowdLight) reads it for occlusion, a few taps out along the normal, and for a soft shadow, a few toward the
// key light: the crowd shadows itself, the beads and the membranes alike.
#include "molecules.wgsl"

struct VolSplat {
  corner: vec3f, voxel: f32,        // the grid's least corner (relative to the origin) and a cell's size (nm)
  n: u32, maxInst: u32, pad0: u32, pad1: u32,
}
@group(2) @binding(1) var<storage, read> insts: array<Inst>;
@group(2) @binding(3) var<storage, read> counts: array<u32>;
@group(2) @binding(4) var<storage, read_write> acc: array<atomic<u32>>;
@group(2) @binding(5) var<uniform> VS: VolSplat;
@group(2) @binding(6) var accIn: texture_storage_3d<rgba16float, write>;
@group(2) @binding(7) var srcMip: texture_3d<f32>;
@group(2) @binding(8) var<storage, read> accRead: array<u32>;

// (fixed point: a cell's whole volume filled is this many)
const ONE: f32 = 4096.0;

@compute @workgroup_size(64) fn splat(@builtin(global_invocation_id) g: vec3u) {
  let total = min(counts[NLISTS], VS.maxInst);
  if (g.x >= total) { return; }
  let inst = insts[g.x];
  let T = types[inst.mtype];
  let r = T.radius * inst.scale;
  if (r <= 0.0) { return; }
  // (about half its bounding sphere is the molecule)
  let fill = 0.5 * 4.18879 * r * r * r / (VS.voxel * VS.voxel * VS.voxel);
  let q = (inst.pos - VS.corner) / VS.voxel - 0.5;
  let n = i32(VS.n);
  let i0 = vec3i(floor(q));
  let f = q - floor(q);
  if (any(i0 < vec3i(-1)) || any(i0 >= vec3i(n))) { return; }
  for (var k = 0; k < 8; k++) {
    let o = vec3i(k & 1, (k >> 1) & 1, k >> 2);
    let c = i0 + o;
    if (any(c < vec3i(0)) || any(c >= vec3i(n))) { continue; }
    let w = select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1) * select(1.0 - f.z, f.z, o.z == 1);
    atomicAdd(&acc[u32((c.z * n + c.y) * n + c.x)], u32(fill * w * ONE + 0.5));
  }
}

// the sums into the texture's finest level, smoothed by a [1 2 1]³ tent (a molecule a few cells wide spreads as one)
@compute @workgroup_size(4, 4, 4) fn resolve(@builtin(global_invocation_id) g: vec3u) {
  let n = i32(VS.n);
  let p = vec3i(g);
  if (any(p >= vec3i(n))) { return; }
  var s = 0.0;
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let c = p + vec3i(x, y, z);
        if (any(c < vec3i(0)) || any(c >= vec3i(n))) { continue; }
        let w = f32((2 - abs(x)) * (2 - abs(y)) * (2 - abs(z)));
        s += f32(accRead[u32((c.z * n + c.y) * n + c.x)]) * w;
      }
    }
  }
  let d = s / (64.0 * ONE);
  textureStore(accIn, p, vec4f(d, 0.0, 0.0, 1.0));
}

// a coarser level: the mean of the eight cells under each
@compute @workgroup_size(4, 4, 4) fn down(@builtin(global_invocation_id) g: vec3u) {
  let n = vec3u(textureDimensions(accIn));
  if (any(g >= n)) { return; }
  var s = 0.0;
  for (var k = 0u; k < 8u; k++) {
    s += textureLoad(srcMip, vec3i(g * 2u + vec3u(k & 1u, (k >> 1u) & 1u, k >> 2u)), 0).r;
  }
  textureStore(accIn, vec3i(g), vec4f(s * 0.125, 0.0, 0.0, 1.0));
}
