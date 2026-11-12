// The noise the marches above the cell evaluate at every step, baked once into two tiling 3D textures (noisetex.ts)
// so a step reads it with a tap or two instead of hashing its way through it:
//  - cellTex (rgba32uint, 32 a side): a cellular noise of 8 cells a period, 4 texels a cell, as the four jittered
//    points nearest each texel's centre, one to a channel: each coordinate in 10 bits, 2 for which neighbouring cell
//    (−1, 0, 1 from the texel's own) and 8 for its jitter in it. A step finds its distances to those four exactly, so
//    a wall or an edge is as sharp as the analytic noise's (interpolated distances blur its thin creases away), and
//    a point is the same point to every texel that holds it, so the field has no seams.
//  - codeTex (r32uint, 32 a side): the same four as which of the 27 cells round the texel's own hold them (5 bits
//    each), their jitter hashed again by the march: a quarter the size (128 kB), for a march whose samples scatter
//    across the whole of the noise (the web from outside), where cache misses cost more than the hashing.
//  - valTex (rgba8unorm, 128 a side, stored as v·0.5 + 0.5): value noise of 16 lattice cells a period, 8 texels a
//    cell: r three octaves of it, g four, b one, a four more from other points.
#include "noise.wgsl"

@group(2) @binding(0) var cellOut: texture_storage_3d<rgba32uint, write>;
@group(2) @binding(1) var valOut: texture_storage_3d<rgba8unorm, write>;
@group(2) @binding(2) var codeOut: texture_storage_3d<r32uint, write>;

const NC = 32;          // the cellular texture's size
const CP = 8;           // its period, in cells (4 texels a cell)
const NV = 128;         // the value noise's
const VP = 16;          // its period, in lattice cells

fn wrapi(g: vec3i, n: i32) -> vec3u { return vec3u(((g % n) + n) % n); }

// the cell g's point's jitter, quantised to 8 bits (0..255 each way), the lattice wrapped every CP
fn jitterQ(g: vec3i) -> vec3u { return min(vec3u(hash3u(wrapi(g, CP) + vec3u(17u, 51u, 119u)) * 256.0), vec3u(255u)); }
fn pointAt(g: vec3i, q: vec3u) -> vec3f { return vec3f(g) + 0.5 + ((vec3f(q) + 0.5) / 256.0 - 0.5) * 0.95; }

// the four points nearest c (cell units), packed both ways
struct Near4 { pts: vec4u, cells: u32 }
fn nearest4(c: vec3f) -> Near4 {
  let base = vec3i(floor(c));
  var d = vec4f(99.0);
  var k = vec4u(0u);
  var n = vec4u(0u);
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let o = vec3i(x, y, z);
        let q = jitterQ(base + o);
        let e = length(c - pointAt(base + o, q));
        let w = vec3u(o + 1);
        let code = ((w.x << 8u) | q.x) | (((w.y << 8u) | q.y) << 10u) | (((w.z << 8u) | q.z) << 20u);
        let cell = u32((x + 1) + 3 * (y + 1) + 9 * (z + 1));
        if (e < d.x) { d = vec4f(e, d.xyz); k = vec4u(code, k.xyz); n = vec4u(cell, n.xyz); }
        else if (e < d.y) { d = vec4f(d.x, e, d.yz); k = vec4u(k.x, code, k.yz); n = vec4u(n.x, cell, n.yz); }
        else if (e < d.z) { d = vec4f(d.xy, e, d.z); k = vec4u(k.xy, code, k.z); n = vec4u(n.xy, cell, n.z); }
        else if (e < d.w) { d.w = e; k.w = code; n.w = cell; }
      }
    }
  }
  return Near4(k, n.x | (n.y << 5u) | (n.z << 10u) | (n.w << 15u));
}

// value noise (as vnoise) with its lattice wrapped every `per` cells
fn corner(g: vec3i, per: i32, seed: u32) -> f32 { return f32(pcg3(wrapi(g, per) + vec3u(seed, seed * 5u, seed * 11u)).x) * (2.0 / 4294967296.0) - 1.0; }
fn vwrap(p: vec3f, per: i32, seed: u32) -> f32 {
  let i = vec3i(floor(p));
  let f = fade3(p - floor(p));
  return mix(
    mix(mix(corner(i, per, seed), corner(i + vec3i(1, 0, 0), per, seed), f.x), mix(corner(i + vec3i(0, 1, 0), per, seed), corner(i + vec3i(1, 1, 0), per, seed), f.x), f.y),
    mix(mix(corner(i + vec3i(0, 0, 1), per, seed), corner(i + vec3i(1, 0, 1), per, seed), f.x), mix(corner(i + vec3i(0, 1, 1), per, seed), corner(i + vec3i(1, 1, 1), per, seed), f.x), f.y),
    f.z);
}
// octaves at twice the frequency each (so each still tiles), as fbm
fn fwrap(p: vec3f, octaves: i32, seed: u32) -> f32 {
  var s = 0.0; var a = 0.5; var f = 1.0; var per = VP;
  for (var i = 0; i < octaves; i++) {
    s += a * vwrap(p * f, per, seed + u32(i) * 101u);
    a *= 0.5; f *= 2.0; per *= 2;
  }
  return s;
}

@compute @workgroup_size(4, 4, 4) fn bake(@builtin(global_invocation_id) id: vec3u) {
  if (all(id < vec3u(NC))) {
    let n = nearest4((vec3f(id) + 0.5) * (f32(CP) / f32(NC)));
    textureStore(cellOut, id, n.pts);
    textureStore(codeOut, id, vec4u(n.cells, 0u, 0u, 0u));
  }
  if (any(id >= vec3u(NV))) { return; }
  let pv = (vec3f(id) + 0.5) * (f32(VP) / f32(NV));
  let v = vec4f(fwrap(pv, 3, 1u), fwrap(pv, 4, 2000u), vwrap(pv, VP, 4000u), fwrap(pv, 4, 6000u));
  textureStore(valOut, id, v * 0.5 + 0.5);
}
