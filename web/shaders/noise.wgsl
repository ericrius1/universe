// Hash and value noise, bit-for-bit the same as src/world/noise.ts (the CPU builds the meshes, the GPU places the
// molecules on them: both read these numbers). PCG3D on u32 lattice coordinates; quintic-faded trilinear value noise.
fn pcg3(v0: vec3u) -> vec3u {
  var v = v0 * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> vec3u(16u);
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
fn hash3i(p: vec3i) -> vec3f { return vec3f(pcg3(bitcast<vec3u>(p))) * (1.0 / 4294967296.0); }
fn hash3u(p: vec3u) -> vec3f { return vec3f(pcg3(p)) * (1.0 / 4294967296.0); }

fn fade3(t: vec3f) -> vec3f { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
fn ncorner(p: vec3i) -> f32 { return f32(pcg3(bitcast<vec3u>(p)).x) * (2.0 / 4294967296.0) - 1.0; }

fn vnoise(p: vec3f) -> f32 {
  let i = vec3i(floor(p));
  let f = fade3(p - floor(p));
  return mix(
    mix(mix(ncorner(i), ncorner(i + vec3i(1, 0, 0)), f.x), mix(ncorner(i + vec3i(0, 1, 0)), ncorner(i + vec3i(1, 1, 0)), f.x), f.y),
    mix(mix(ncorner(i + vec3i(0, 0, 1)), ncorner(i + vec3i(1, 0, 1)), f.x), mix(ncorner(i + vec3i(0, 1, 1)), ncorner(i + vec3i(1, 1, 1)), f.x), f.y),
    f.z);
}

fn fbm(p: vec3f, octaves: i32) -> f32 {
  var s = 0.0; var a = 0.5; var f = 1.0;
  for (var i = 0; i < octaves; i++) {
    let fi = f32(i);
    s += a * vnoise(p * f + vec3f(fi * 17.13, fi * 7.71, fi * 3.37));
    a *= 0.5; f *= 2.03;
  }
  return s;
}

// a cheap smooth gradient noise for shading (not shared with the CPU)
fn snoise(p: vec3f) -> f32 { return vnoise(p) * 0.6 + vnoise(p * 2.11 + 3.1) * 0.3 + vnoise(p * 4.37 + 7.7) * 0.1; }

// 3D cellular noise: distance to the nearest and second-nearest jittered points, and the nearest point's hash
struct Cell3 { d1: f32, d2: f32, id: vec3f, c: vec3f }
fn cellular(p: vec3f, jitter: f32) -> Cell3 {
  let i = vec3i(floor(p));
  var o: Cell3; o.d1 = 9.0; o.d2 = 9.0;
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let g = i + vec3i(x, y, z);
        let h = hash3i(g);
        let c = vec3f(g) + 0.5 + (h - 0.5) * jitter;
        let d = length(p - c);
        if (d < o.d1) { o.d2 = o.d1; o.d1 = d; o.id = h; o.c = c; } else if (d < o.d2) { o.d2 = d; }
      }
    }
  }
  return o;
}

// the same, searching only the 2×2×2 cells nearest p (the half of its own cell it's in, along each axis): exact wherever
// the nearest point is within about half a cell of p — all that a pattern drawn within that of its points (lipid heads,
// specks) shows — and an eighth less hashing than 27
fn cellular8(p: vec3f, jitter: f32) -> Cell3 {
  let i = vec3i(floor(p));
  let lo = i - vec3i(select(vec3i(0), vec3i(1), p - floor(p) < vec3f(0.5)));
  var o: Cell3; o.d1 = 9.0; o.d2 = 9.0;
  for (var k = 0; k < 8; k++) {
    let g = lo + vec3i(k & 1, (k >> 1) & 1, k >> 2);
    let h = hash3i(g);
    let c = vec3f(g) + 0.5 + (h - 0.5) * jitter;
    let d = length(p - c);
    if (d < o.d1) { o.d2 = o.d1; o.d1 = d; o.id = h; o.c = c; } else if (d < o.d2) { o.d2 = d; }
  }
  return o;
}
