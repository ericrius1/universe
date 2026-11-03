// What the bent water's shaders share, ported from the waterbending app (its common.wgsl and scene.wgsl): the fluid's
// particle, what a particle of it is made of, the hashes and noises its looks are made of, the light's lobes and the
// caustic net. Included after world.wgsl (PI, hashU); where world.wgsl already has a name the app's own function keeps
// a different one (hash12i is the app's hash12).

const TAU = 6.28318531;

// a particle of the bent water (fluid.ts), 80 bytes. phase: 0 dead, 1 liquid, 2 static ice, 3 ice in a rigid group,
// 4 shard / droplet in free flight. c0..c2 the affine velocity's columns; c0.w its age (s), c1.w its tag (> 0.5 held by
// the bender, -1 thrown spray, -0.25 hurled at a mark; phase 3: its group), c2.w its density (for drawing it)
struct Particle { pos: vec3f, phase: f32, vel: vec3f, ice: f32, c0: vec4f, c1: vec4f, c2: vec4f }

fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn sq(x: f32) -> f32 { return x * x; }

// what a liquid particle is made of: water, cloud mist and snow are one fluid, each particle carrying how much of it is
// mist (m) and snow (s) — packed into its ice amount, which liquid doesn't use: -(2 * round(255 s) + m)
fn matPack(m: f32, s: f32) -> f32 { return -(floor(clamp(s, 0.0, 1.0) * 255.0 + 0.5) * 2.0 + clamp(m, 0.0, 0.999)); }
fn matMist(ice: f32) -> f32 { let v = max(-ice, 0.0); return v - floor(v); }
fn matSnow(ice: f32) -> f32 { let v = max(-ice, 0.0); return floor(v) * 0.5 / 255.0; }

fn hash1u(x: u32) -> f32 { return f32(hashU(x) & 0xffffffu) / 16777215.0; }
fn hash2i(p: vec2i) -> f32 { return hash1u((bitcast<u32>(p.x) * 0x8da6b343u) ^ (bitcast<u32>(p.y) * 0xd8163841u)); }
fn hash22i(p: vec2i) -> vec2f {
  let h = hashU((bitcast<u32>(p.x) * 0x8da6b343u) ^ (bitcast<u32>(p.y) * 0xd8163841u));
  return vec2f(f32(h & 0xffffu), f32(h >> 16u)) / 65535.0;
}
fn hash3i(p: vec3i) -> f32 { return hash1u((bitcast<u32>(p.x) * 73856093u) ^ (bitcast<u32>(p.y) * 19349663u) ^ (bitcast<u32>(p.z) * 83492791u)); }
fn hash12i(p: vec2f) -> f32 { return hash2i(vec2i(floor(p))); }
fn hash13(p: vec3f) -> f32 { return hash3i(vec3i(floor(p))); }
// interleaved gradient noise (a screen-space dither)
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }

fn vnoise(p: vec2f) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2i(i), hash2i(i + vec2i(1, 0)), u.x), mix(hash2i(i + vec2i(0, 1)), hash2i(i + vec2i(1, 1)), u.x), u.y);
}
fn vnoise3(p: vec3f) -> f32 {
  let i = vec3i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3i(i), hash3i(i + vec3i(1, 0, 0)), u.x), mix(hash3i(i + vec3i(0, 1, 0)), hash3i(i + vec3i(1, 1, 0)), u.x), u.y),
             mix(mix(hash3i(i + vec3i(0, 0, 1)), hash3i(i + vec3i(1, 0, 1)), u.x), mix(hash3i(i + vec3i(0, 1, 1)), hash3i(i + vec3i(1, 1, 1)), u.x), u.y), u.z);
}
fn fbm(p0: vec2f, oct: i32) -> f32 {
  var p = p0;
  var a = 0.5;
  var s = 0.0;
  for (var i = 0; i < oct; i++) {
    s += a * vnoise(p);
    p = mat2x2f(1.6, 1.2, -1.2, 1.6) * p + vec2f(3.1, 7.7);
    a *= 0.5;
  }
  return s;
}
fn fbm3(p0: vec3f, oct: i32) -> f32 {
  var p = p0;
  var a = 0.5;
  var s = 0.0;
  for (var i = 0; i < oct; i++) {
    s += a * vnoise3(p);
    p = p * 2.03 + vec3f(1.7, 9.2, 3.3);
    a *= 0.5;
  }
  return s;
}
// cellular noise: x the distance to the nearest feature, y to the second nearest, z the cell's hash
fn voronoi(p: vec2f) -> vec3f {
  let i = vec2i(floor(p));
  let f = fract(p);
  var d1 = 8.0;
  var d2 = 8.0;
  var id = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let o = vec2i(x, y);
      let c = i + o;
      let r = vec2f(o) + hash22i(c) - f;
      let d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = hash2i(c + vec2i(17, 3)); }
      else if (d < d2) { d2 = d; }
    }
  }
  return vec3f(sqrt(d1), sqrt(d2), id);
}

fn fresnelSchlick(cosT: f32, f0: f32) -> f32 { return f0 + (1.0 - f0) * pow(1.0 - sat(cosT), 5.0); }
// GGX specular: the BRDF without the cosine (the caller multiplies by the light's irradiance)
fn ggxSpec(n: vec3f, v: vec3f, l: vec3f, rough: f32, f0: f32) -> f32 {
  let h = normalize(v + l);
  let nh = sat(dot(n, h));
  let nv = max(dot(n, v), 1e-4);
  let nl = max(dot(n, l), 1e-4);
  let a = max(rough * rough, 0.002);
  let a2 = a * a;
  let dd = nh * nh * (a2 - 1.0) + 1.0;
  let D = a2 / (PI * dd * dd);
  let k = a * 0.5;
  let G = (nv / (nv * (1.0 - k) + k)) * (nl / (nl * (1.0 - k) + k));
  let F = fresnelSchlick(sat(dot(v, h)), f0);
  return D * G * F / (4.0 * nv * nl);
}
fn henyeyGreenstein(c: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

// ---------------------------------------------------------------- the caustic net (tileable: 8 m a tile)
const CAU_TILE = 8.0;
fn wrapCell(c: vec2i, p: i32) -> vec2i { return ((c % vec2i(p)) + vec2i(p)) % vec2i(p); }
fn vnoiseP(x: vec2f, p: i32) -> f32 {
  let i = vec2i(floor(x));
  let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash2i(wrapCell(i, p));
  let b = hash2i(wrapCell(i + vec2i(1, 0), p));
  let c = hash2i(wrapCell(i + vec2i(0, 1), p));
  let d = hash2i(wrapCell(i + vec2i(1, 1), p));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// the distance between the nearest and second-nearest feature (0 on the cells' borders), cells wrapping every p
fn voronoiEdgeP(x: vec2f, p: i32) -> f32 {
  let i = vec2i(floor(x));
  let f = fract(x);
  var d1 = 8.0;
  var d2 = 8.0;
  for (var y = -1; y <= 1; y++) {
    for (var xx = -1; xx <= 1; xx++) {
      let o = vec2i(xx, y);
      let r = vec2f(o) + hash22i(wrapCell(i + o, p)) - f;
      let d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return sqrt(d2) - sqrt(d1);
}
// the caustic net at xz, ~0..1.6
fn causticNet(xz: vec2f, t: f32) -> f32 {
  let q = xz * (6.0 / CAU_TILE);
  let w1 = vec2f(vnoiseP(q * 0.5 + t * 0.21, 3), vnoiseP(q * 0.5 - t * 0.19 + 5.2, 3)) * 1.6;
  var c = pow(1.0 - smoothstep(0.0, 0.32, voronoiEdgeP(q + w1 + vec2f(t * 0.08, -t * 0.05), 6)), 3.0);
  let q2 = q * 2.0 + vec2f(3.0, 7.0);
  let w2 = vec2f(vnoiseP(q2 * 0.5 - t * 0.17, 6), vnoiseP(q2 * 0.5 + t * 0.23 + 2.9, 6)) * 1.6;
  c += pow(1.0 - smoothstep(0.0, 0.32, voronoiEdgeP(q2 + w2 + vec2f(-t * 0.1, t * 0.07), 12)), 3.0) * 0.6;
  return c;
}

// the lub-dub of the charge's heart (energy.ts), x the phase into one beat (0..1): a strong pulse and a softer one after
fn heartbeat(x: f32) -> f32 { return smoothstep(0.0, 0.05, x) * exp(-x * 9.0) + 0.6 * smoothstep(0.28, 0.33, x) * exp(-(x - 0.28) * 9.0); }
