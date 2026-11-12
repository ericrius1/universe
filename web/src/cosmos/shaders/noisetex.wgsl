// The noise baked into tiling 3D textures once at load (c_noisebake.wgsl, noisetex.ts), read back with a tap: what
// the cosmic web's and the Milky Way's marches evaluate at every step. Include after cosmos.wgsl (its sampler).
@group(2) @binding(1) var cellTex: texture_3d<u32>;
@group(2) @binding(2) var valTex: texture_3d<f32>;
@group(2) @binding(4) var codeTex: texture_3d<u32>;

// the distance from p to a point packed as the bake packs it (relative to the cell `base`)
fn cellDist(p: vec3f, base: vec3f, code: u32) -> f32 {
  let w = vec3u(code, code >> 10u, code >> 20u) & vec3u(1023u);
  let pt = base + vec3f(w >> vec3u(8u)) - 0.5 + ((vec3f(w & vec3u(255u)) + 0.5) / 256.0 - 0.5) * 0.95;
  return length(p - pt);
}

// a cellular noise at p (cell units; it repeats every 8): the gaps between the distances to its nearest three
// jittered points, F2 − F1 and F3 − F1 — a cell's wall where the first is near 0, its edge where both are
fn cellGaps(p: vec3f) -> vec2f {
  let t = vec3i(floor(p * 4.0));
  let k = textureLoad(cellTex, vec3u(((t % 32) + 32) % 32), 0);
  let base = floor((vec3f(t) + 0.5) * 0.25);
  let a = cellDist(p, base, k.x); let b = cellDist(p, base, k.y);
  let c = cellDist(p, base, k.z); let d = cellDist(p, base, k.w);
  // (the nearest three of the four)
  let lo1 = min(a, b); let hi1 = max(a, b); let lo2 = min(c, d); let hi2 = max(c, d);
  let f1 = min(lo1, lo2); let m = max(lo1, lo2);
  let n = min(hi1, hi2);
  let f2 = min(m, n);
  let f3 = min(max(m, n), max(hi1, hi2));
  return vec2f(f2 - f1, f3 - f1);
}

// the same from the smaller texture (codeTex), each point's jitter hashed and quantised as the bake's
fn cellDistH(p: vec3f, base: vec3i, code: u32) -> f32 {
  let g = base + vec3i(i32(code % 3u), i32((code / 3u) % 3u), i32(code / 9u)) - 1;
  let q = min(floor(hash3u(vec3u(((g % 8) + 8) % 8) + vec3u(17u, 51u, 119u)) * 256.0), vec3f(255.0));
  return length(p - (vec3f(g) + 0.5 + ((q + 0.5) / 256.0 - 0.5) * 0.95));
}
fn cellGapsH(p: vec3f) -> vec2f {
  let t = vec3i(floor(p * 4.0));
  let k = textureLoad(codeTex, vec3u(((t % 32) + 32) % 32), 0).x;
  let base = vec3i(floor((vec3f(t) + 0.5) * 0.25));
  let a = cellDistH(p, base, k & 31u); let b = cellDistH(p, base, (k >> 5u) & 31u);
  let c = cellDistH(p, base, (k >> 10u) & 31u); let d = cellDistH(p, base, (k >> 15u) & 31u);
  let lo1 = min(a, b); let hi1 = max(a, b); let lo2 = min(c, d); let hi2 = max(c, d);
  let f1 = min(lo1, lo2); let m = max(lo1, lo2);
  let n = min(hi1, hi2);
  return vec2f(min(m, n) - f1, min(max(m, n), max(hi1, hi2)) - f1);
}

// value noise at p (lattice units): r three octaves, g four, b one, a four of another (each about −1..1)
fn valTap(p: vec3f) -> vec4f { return textureSampleLevel(valTex, samp_repeat, p * (1.0 / 16.0), 0.0) * 2.0 - 1.0; }
