// Bent water (fluid.ts), ported from the waterbending app: an MLS-MPM fluid (after Hu et al. 2018 and matsuoka-601's
// WebGPU-Ocean) on a grid that follows the action, with
//  - "held" particles steered along a control path (the form the bending makes),
//  - ice: static ice (a solid obstacle for the liquid), rigid ice groups moved as one body (carried / thrown), shards,
//  - ballistic flight outside the grid, absorption into the water below, soaking into the ground,
//  - a free list for spawning (drawing water out of a lake or a pool) without a CPU readback.
// The ground is the terrain's height (world.wgsl). The water is up to four levels the brain gives, each over a box: a
// point is in it where the ground is under the level. What lands in it is gathered into a small table of 0.5 m cells
// and compacted each frame into `landings` for the lakes' ripples (the app wrote each drop into its own water sim).
// Sim units: positions in grid cells, the sim's time step DT per substep; velocities are kept in m/s and converted.
#include "./../../../world/world.wgsl"
#include "./common.wgsl"

struct SimU {
  origin: vec3f, h: f32,
  dims: vec3i, nMax: u32,
  dt: f32, stiffness: f32, restDensity: f32, viscosity: f32,
  gravity: f32, vScale: f32, nWater: f32, pad0: f32,
  realDt: f32, flow: f32, pull: f32, pathCount: f32,
  pathMode: f32, cohesion: f32, maxSpeed: f32, time: f32,
  freezeGroup: f32, freezeHeld: f32, meltAll: f32, releaseHeld: f32,
  melt: vec4f,       // world pos, radius (0 = none)
  freeze: vec4f,     // freeze free liquid near pos within radius (0 = none)
  shatter: vec4f,    // shatter ice near pos within radius, w strength
  spawn: vec4f,      // spawn source: world pos, radius
  spawnVel: vec4f,   // initial velocity (m/s), w = count this frame
  push: vec4f,       // a push on all held water as it's let go: xyz the velocity added, w on
  anchor: vec4f,     // where the stats' sums are taken from (the grid's origin when they were last cleared)
  water: array<vec4f, 8>,     // up to four bodies of water: [2k] the box it's over (x0, z0, x1, z1), [2k + 1].x its level
  groups: array<vec4f, 32>,   // rigid ice groups, four each: pos (w active: 1 held / 2 free), rotation, velocity, spin
  path: array<vec4f, 512>,    // xyz point, w tube radius (negative: a new strand starts here)
  pathVel: array<vec4f, 512>, // xyz velocity of the path point, w flow along the path (m/s)
  targets: array<vec4f, 16>,  // things water can hit: xyz, w radius (0 = none); hits count in counters[16 + k]
  emit: array<vec4f, 24>,     // splash emitters (free water thrown up), 3 each: (pos, disc radius), (vel, count), (jitter, radial speed, spread along xz)
  nEmit: vec4f,               // x emitters, y total particles this frame
  spawnMat: vec4f,            // what's being drawn: x cloud mist, y snow (0, 0: water)
  carry: vec4f,               // xyz: the bender's displacement this substep — held water rides along with her in flight
  form: vec4f,                // pathMode 4: x points a strand has, y how hard its lines are held (0..1); z how fast held
                              // mist and snow become water (1: as she carries them)
  hurl: vec4f,                // let go at a mark: xyz where it's sent, w the flight time (s)
  hurl2: vec4f,               // x how wide a ball round the mark it lands over (m), y the spread of flight times (s), z on,
                              // w how much of what she holds has gone (poured: each lets go in its turn)
  hurl3: vec4f,               // poured: xyz the mouth it pours from (the form's face toward the mark), w how wide (0: each
                              // from where it is)
}

// what landed in the water this frame (fluid.ts landings): how many, then each (x, z, amount (m, < 0 a dent), radius (m))
struct Landings { n: atomic<u32>, p0: u32, p1: u32, p2: u32, at: array<vec4f, 256> }

@group(2) @binding(0) var<uniform> U: SimU;
@group(2) @binding(1) var<storage, read_write> P: array<Particle>;
@group(2) @binding(2) var<storage, read_write> mom: array<atomic<i32>>;
@group(2) @binding(3) var<storage, read_write> mass: array<atomic<i32>>;
@group(2) @binding(4) var<storage, read_write> gridV: array<vec4f>;
@group(2) @binding(5) var<storage, read_write> freeList: array<u32>;
// 0 free count, 1 alive, 2 held, 3 ice (static + carried), 4 absorbed, 5 their impact speed × 100, 6-8 the held
// centroid (from the anchor, × 16), 9 held speed × 16, 10 free liquid, 11-13 the absorbed centroid (from the anchor,
// × 16), 14 static ice, 16-31 hits per target; from 32 the landing table (LAND_SLOTS × 5: key, count, x, z, amount)
@group(2) @binding(6) var<storage, read_write> counters: array<atomic<i32>>;
@group(2) @binding(7) var<storage, read_write> solid: array<atomic<i32>>;
// splash events for the spray (spray_sim.wgsl): [k + 1] = (pos, impact speed); ring[1] counts them
@group(2) @binding(8) var<storage, read_write> sprayEvents: array<vec4f, 513>;
@group(2) @binding(9) var<storage, read_write> sprayRing: array<atomic<u32>, 4>;
@group(2) @binding(10) var<storage, read_write> landings: Landings;

const FP: f32 = 1.0e6;
const LAND_BASE: u32 = 32u;
const LAND_SLOTS: u32 = 256u;
const LAND_CELL: f32 = 0.5;

fn splashEvent(p: vec3f, impact: f32) {
  // only a fraction of the absorbed particles make a visible splash (plenty, but bounded)
  let e = atomicAdd(&sprayRing[1], 1u);
  if (e < 512u) { sprayEvents[e + 1u] = vec4f(p, impact); }
}

fn cellIndex(c: vec3i) -> i32 { return (c.z * U.dims.y + c.y) * U.dims.x + c.x; }
fn toGrid(p: vec3f) -> vec3f { return (p - U.origin) / U.h; }
fn inDomain(g: vec3f) -> bool { return all(g >= vec3f(2.0)) && all(g < vec3f(U.dims) - 3.0); }
// water hurled at a mark, still on its way: it flies its own arc, out of the grid — poured a part at a time, the drops
// let go in the middle of all she still holds were stopped dead by it (the grid's velocity there is the held mass's),
// and the stream dribbled out of the bottom of the orb
fn arcing(p: Particle) -> bool { return u32(p.phase) == 1u && p.c1.w > -0.4 && p.c1.w < -0.1 && p.c0.w < 1.4; }

fn groundAt(xz: vec2f) -> f32 { return terrainHeight(xz); }
fn groundNormal(xz: vec2f) -> vec3f {
  let e = 0.3;
  let dx = groundAt(xz + vec2f(e, 0.0)) - groundAt(xz - vec2f(e, 0.0));
  let dz = groundAt(xz + vec2f(0.0, e)) - groundAt(xz - vec2f(0.0, e));
  return normalize(vec3f(-dx, 2.0 * e, -dz));
}
// the water's surface over xz (gh the ground there): the highest of the levels whose box holds xz with the ground under
// it, or -1e4 (dry)
fn waterLevelAt(xz: vec2f, gh: f32) -> f32 {
  var wl = -1e4;
  for (var k = 0u; k < u32(U.nWater); k++) {
    let b = U.water[k * 2u];
    let L = U.water[k * 2u + 1u].x;
    if (all(xz >= b.xy) && all(xz <= b.zw) && gh < L - 0.02 && L > wl) { wl = L; }
  }
  return wl;
}

fn qrot(q: vec4f, v: vec3f) -> vec3f { let t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
fn qinv(q: vec4f) -> vec4f { return vec4f(-q.xyz, q.w); }

fn rnd(i: u32, k: u32) -> f32 { return f32(hashU(i * 747796405u + k * 2891336453u + u32(U.time * 1000.0)) & 0xffffu) / 65535.0; }

fn kill(i: u32) {
  P[i].phase = 0.0;
  let slot = atomicAdd(&counters[0], 1);
  freeList[slot] = i;
}

// water landing in the water: into its 0.5 m cell of the landing table (cells keyed from the grid's origin, open
// addressing over a few slots; a full table drops the rest)
fn landAt(p: vec3f, amount: f32) {
  let c = vec2i(floor((p.xz - U.origin.xz) / LAND_CELL));
  let key = i32(0x40000000u | ((bitcast<u32>(c.x) & 0x7fffu) << 15u) | (bitcast<u32>(c.y) & 0x7fffu));
  var s = hashU(bitcast<u32>(key)) % LAND_SLOTS;
  let off = p.xz - U.origin.xz - (vec2f(c) + 0.5) * LAND_CELL;
  for (var k = 0u; k < 8u; k++) {
    let b = LAND_BASE + s * 5u;
    let r = atomicCompareExchangeWeak(&counters[b], 0, key);
    if (r.exchanged || r.old_value == key) {
      atomicAdd(&counters[b + 1u], 1);
      atomicAdd(&counters[b + 2u], i32(off.x * 4096.0));
      atomicAdd(&counters[b + 3u], i32(off.y * 4096.0));
      atomicAdd(&counters[b + 4u], i32(amount * 1e5));
      return;
    }
    s = (s + 1u) % LAND_SLOTS;
  }
}

// ---------------------------------------------------------------- spawning (drawing water out of a lake or a pool)
@compute @workgroup_size(64)
fn spawn(@builtin(global_invocation_id) id: vec3u) {
  let k = id.x;
  if (k >= u32(U.spawnVel.w)) { return; }
  let n = atomicSub(&counters[0], 1);
  if (n <= 0) { atomicAdd(&counters[0], 1); return; }
  let i = freeList[n - 1];
  // a column of water lifting out of the surface: disc at the source, staggered upward
  let a = rnd(k, 1u) * TAU;
  let r = sqrt(rnd(k, 2u)) * abs(U.spawn.w);
  let up = rnd(k, 3u);
  var p: Particle;
  p.pos = U.spawn.xyz + vec3f(cos(a) * r, -0.15 + up * 0.25, sin(a) * r);
  p.phase = 1.0;
  p.vel = U.spawnVel.xyz * (0.8 + 0.4 * rnd(k, 4u)) + vec3f(cos(a), 0.0, sin(a)) * -r * 1.5;
  // (drawn out of a cloud: mist; off a snowfield: snow — the same fluid, flowing together with the water)
  p.ice = matPack(U.spawnMat.x, U.spawnMat.y);
  p.c0 = vec4f(0.0, 0.0, 0.0, 0.0);
  p.c1 = vec4f(0.0, 0.0, 0.0, 1.0);
  p.c2 = vec4f(0.0, 0.0, 0.0, U.restDensity);
  P[i] = p;
}

// ---------------------------------------------------------------- splashes: free water thrown out of the surface
// (sheets kicked up behind her as she skims, crowns where something plunges in): real liquid that arcs, breaks into
// drops under its own cohesion, and falls back in (absorbed: ripples where it lands)
@compute @workgroup_size(64)
fn emitSplash(@builtin(global_invocation_id) id: vec3u) {
  var k = id.x;
  if (k >= u32(U.nEmit.y)) { return; }
  var e = 0u;
  for (var j = 0u; j < u32(U.nEmit.x); j++) {
    let n = u32(U.emit[j * 3u + 1u].w);
    if (k < n) { e = j; break; }
    k -= n;
  }
  let n = atomicSub(&counters[0], 1);
  if (n <= 0) { atomicAdd(&counters[0], 1); return; }
  let i = freeList[n - 1];
  let E0 = U.emit[e * 3u];
  let E1 = U.emit[e * 3u + 1u];
  let E2 = U.emit[e * 3u + 2u];
  let a = rnd(id.x, 31u) * TAU;
  let rr = sqrt(rnd(id.x, 32u));
  let out = vec3f(cos(a), 0.0, sin(a));
  var p: Particle;
  // (spread along the stretch the source covered this frame: fast, it moves metres between frames)
  let along = rnd(id.x, 38u);
  p.pos = E0.xyz + out * rr * E0.w + vec3f(E2.z * along, (rnd(id.x, 33u) - 0.5) * 0.12, E2.w * along);
  p.phase = 1.0;
  // (the outer edge of a crown flies out fastest; the jitter is biased upward so nothing is thrown into the water)
  let jit = vec3f(rnd(id.x, 34u) - 0.5, rnd(id.x, 35u) * 0.7, rnd(id.x, 36u) - 0.5) * 2.0 * E2.x;
  p.vel = E1.xyz * (0.75 + 0.5 * rnd(id.x, 37u)) + out * E2.y * (0.5 + 0.5 * rr) + jit;
  p.ice = 0.0;
  p.c0 = vec4f(0.0);
  p.c1 = vec4f(0.0, 0.0, 0.0, -1.0); // (tag: spray)
  p.c2 = vec4f(0.0, 0.0, 0.0, U.restDensity);
  P[i] = p;
}

// ---------------------------------------------------------------- P2G
fn weights(d: vec3f) -> array<vec3f, 3> {
  return array<vec3f, 3>(0.5 * (0.5 - d) * (0.5 - d), 0.75 - d * d, 0.5 * (0.5 + d) * (0.5 + d));
}

@compute @workgroup_size(64)
fn p2g1(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= U.nMax) { return; }
  let p = P[i];
  let ph = u32(p.phase);
  if (ph == 0u || ph >= 3u || arcing(p)) { return; }
  let g = toGrid(p.pos);
  if (!inDomain(g)) { return; }
  let ci = vec3i(floor(g));
  if (ph == 2u) {
    // static ice: mark its cell solid for the liquid
    atomicAdd(&solid[cellIndex(ci)], 1);
    return;
  }
  let d = g - (vec3f(ci) + 0.5);
  var w = weights(d);
  let v = p.vel / U.vScale;
  let C = mat3x3f(p.c0.xyz, p.c1.xyz, p.c2.xyz);
  for (var gx = 0; gx < 3; gx++) { for (var gy = 0; gy < 3; gy++) { for (var gz = 0; gz < 3; gz++) {
    let wt = w[gx].x * w[gy].y * w[gz].z;
    let cx = ci + vec3i(gx - 1, gy - 1, gz - 1);
    let cd = (vec3f(cx) + 0.5) - g;
    let mv = wt * (v + C * cd);
    let k = cellIndex(cx);
    atomicAdd(&mom[k * 3], i32(mv.x * FP));
    atomicAdd(&mom[k * 3 + 1], i32(mv.y * FP));
    atomicAdd(&mom[k * 3 + 2], i32(mv.z * FP));
    atomicAdd(&mass[k], i32(wt * FP));
  }}}
}

@compute @workgroup_size(64)
fn p2g2(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= U.nMax) { return; }
  let p = P[i];
  if (u32(p.phase) != 1u || arcing(p)) { return; }
  let g = toGrid(p.pos);
  if (!inDomain(g)) { return; }
  let ci = vec3i(floor(g));
  let d = g - (vec3f(ci) + 0.5);
  var w = weights(d);
  var density = 0.0;
  for (var gx = 0; gx < 3; gx++) { for (var gy = 0; gy < 3; gy++) { for (var gz = 0; gz < 3; gz++) {
    let wt = w[gx].x * w[gy].y * w[gz].z;
    density += f32(atomicLoad(&mass[cellIndex(ci + vec3i(gx - 1, gy - 1, gz - 1))])) / FP * wt;
  }}}
  P[i].c2.w = density;
  let volume = 1.0 / max(density, 1e-3);
  // Tait-like EOS; a little negative pressure (cohesion) keeps bent streams together
  var pressure = U.stiffness * (pow(density / U.restDensity, 5.0) - 1.0);
  // (thrown spray holds together much less: it should tear into drops, not fly as jelly)
  pressure = max(pressure, -U.cohesion * select(select(1.0, 3.0, p.c1.w > 0.5), 0.2, p.c1.w < -0.5));
  let C = mat3x3f(p.c0.xyz, p.c1.xyz, p.c2.xyz);
  var stress = mat3x3f(-pressure, 0.0, 0.0, 0.0, -pressure, 0.0, 0.0, 0.0, -pressure);
  stress += U.viscosity * (C + transpose(C));
  let eq = -volume * 4.0 * U.dt * stress;
  for (var gx = 0; gx < 3; gx++) { for (var gy = 0; gy < 3; gy++) { for (var gz = 0; gz < 3; gz++) {
    let wt = w[gx].x * w[gy].y * w[gz].z;
    let cx = ci + vec3i(gx - 1, gy - 1, gz - 1);
    let cd = (vec3f(cx) + 0.5) - g;
    let mv = (eq * wt) * cd;
    let k = cellIndex(cx);
    atomicAdd(&mom[k * 3], i32(mv.x * FP));
    atomicAdd(&mom[k * 3 + 1], i32(mv.y * FP));
    atomicAdd(&mom[k * 3 + 2], i32(mv.z * FP));
  }}}
}

// ---------------------------------------------------------------- grid
@compute @workgroup_size(64)
fn gridUpdate(@builtin(global_invocation_id) id: vec3u) {
  let n = U.dims.x * U.dims.y * U.dims.z;
  let i = i32(id.x);
  if (i >= n) { return; }
  let cm = atomicLoad(&mass[i]);
  let sd = atomicLoad(&solid[i]);
  let cv = vec3i(atomicLoad(&mom[i * 3]), atomicLoad(&mom[i * 3 + 1]), atomicLoad(&mom[i * 3 + 2]));
  if (cm == 0 && sd == 0 && all(cv == vec3i(0))) { return; }
  atomicStore(&mass[i], 0); atomicStore(&solid[i], 0);
  atomicStore(&mom[i * 3], 0); atomicStore(&mom[i * 3 + 1], 0); atomicStore(&mom[i * 3 + 2], 0);
  if (cm <= 0) { gridV[i] = vec4f(0.0); return; }
  let m = f32(cm) / FP;
  var v = vec3f(cv) / FP / m;
  let c = vec3i(i % U.dims.x, (i / U.dims.x) % U.dims.y, i / (U.dims.x * U.dims.y));
  let wp = U.origin + (vec3f(c) + 0.5) * U.h;
  v.y -= U.gravity * U.dt;
  // ice is a solid: liquid stops against it
  if (sd > 0) { v = vec3f(0.0); }
  // terrain: no flow into the ground (with a bit of friction)
  let gh = groundAt(wp.xz);
  if (wp.y < gh + U.h * 0.5) {
    let nrm = groundNormal(wp.xz);
    let vn = dot(v, nrm);
    if (vn < 0.0) { v -= nrm * vn; v *= 0.9; }
  }
  // the domain's sides and top are open: thrown water leaves the grid and flies on ballistically (g2p) until it lands
  // or is absorbed; only the floor holds
  if (c.y < 2 && v.y < 0.0) { v.y = 0.0; }
  gridV[i] = vec4f(v, m);
}

// ---------------------------------------------------------------- the bending path
struct PathHit { q: vec3f, t: vec3f, u: f32, r: f32, v: vec3f, flow: f32, d: f32 }
fn nearestOnPath(p: vec3f) -> PathHit {
  var best: PathHit;
  best.d = 1e9;
  let n = i32(U.pathCount);
  if (n == 1) {
    best.q = U.path[0].xyz; best.t = vec3f(0.0, 1.0, 0.0); best.u = 1.0; best.r = abs(U.path[0].w);
    best.v = U.pathVel[0].xyz; best.flow = U.pathVel[0].w; best.d = distance(p, best.q);
    return best;
  }
  for (var k = 0; k < n - 1; k++) {
    // a negative radius starts a new strand (no segment joins it to the previous point)
    if (U.path[k + 1].w < 0.0) { continue; }
    let a = U.path[k].xyz;
    let b = U.path[k + 1].xyz;
    let ab = b - a;
    let s = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    let q = a + ab * s;
    let d = distance(p, q);
    if (d < best.d) {
      best.d = d; best.q = q; best.t = normalize(ab + vec3f(1e-6));
      best.u = (f32(k) + s) / f32(n - 1);
      best.r = mix(abs(U.path[k].w), U.path[k + 1].w, s);
      best.v = mix(U.pathVel[k].xyz, U.pathVel[k + 1].xyz, s);
      best.flow = mix(U.pathVel[k].w, U.pathVel[k + 1].w, s);
    }
  }
  return best;
}

// the point on the path a particle prefers (pathMode 1: spread along the whole path; 2: eight strands of equal length,
// e.g. tentacles; 3: a sheet; 4: strands of U.form.x points each, spread evenly over them all, through a filled tube —
// the forms of many lines: the geometry she builds in flight, the vortex's arms; 5: a ball, each drop its own place
// through it): keeps a stream from pooling into one ball under its own surface tension
fn pathAt(i: u32, pos: vec3f) -> PathHit {
  let n = i32(U.pathCount);
  if (U.pathMode > 4.5 && n >= 1) {
    // (5: a ball held between the palms — each drop its own place all through it, evenly, and the whole ball turning
    // slowly about a leaning axis, its rim at the point's flow (m/s): it stays round and full. Drawn to the middle it
    // slumped into a lumpy disc under its own weight and spin, a lobe of it out round her hands)
    var hb: PathHit;
    let c = U.path[0].xyz;
    let R = abs(U.path[0].w);
    let u1 = f32(hashU(i * 2654435761u + 17u) & 0xffffu) / 65535.0;
    let u2 = f32(hashU(i * 2246822519u + 91u) & 0xffffu) / 65535.0;
    let u3 = f32(hashU(i * 3266489917u + 5u) & 0xffffu) / 65535.0;
    let rr = R * pow(u1, 1.0 / 3.0);
    let z = 2.0 * u2 - 1.0;
    let sz = sqrt(max(1.0 - z * z, 0.0));
    let w = U.pathVel[0].w / max(R, 0.05);
    let a = u3 * 6.2831853 + U.time * w;
    let lp = vec3f(cos(a) * sz, z, sin(a) * sz) * rr;
    let ax = vec3f(0.0, cos(0.5), sin(0.5));
    let off = vec3f(lp.x, lp.y * ax.y - lp.z * ax.z, lp.y * ax.z + lp.z * ax.y);
    hb.q = c + off;
    hb.t = ax;
    hb.u = u1;
    hb.r = R * 0.3;
    hb.v = U.pathVel[0].xyz + cross(ax, off) * w;
    hb.flow = 0.0;
    hb.d = distance(pos, hb.q);
    return hb;
  }
  if (U.pathMode < 0.5 || n < 2) { return nearestOnPath(pos); }
  let u = f32(hashU(i * 2654435761u + 17u) & 0xffffu) / 65535.0;
  if (U.pathMode > 2.5 && U.pathMode < 3.5) {
    // a sheet: points come in (bottom, top) pairs per column; each particle has its own (u, v) on it
    let cols = n / 2;
    let v = f32(hashU(i * 2246822519u + 91u) & 0xffffu) / 65535.0;
    let cf = u * f32(cols - 1);
    let c0 = min(i32(floor(cf)), cols - 2);
    let s = cf - f32(c0);
    let b = mix(U.path[c0 * 2].xyz, U.path[c0 * 2 + 2].xyz, s);
    let tp = mix(U.path[c0 * 2 + 1].xyz, U.path[c0 * 2 + 3].xyz, s);
    var hs: PathHit;
    // vertical position linear in v, the forward lean grows with v²: a concave face curling over at the crest
    hs.q = vec3f(mix(b.x, tp.x, v * v), mix(b.y, tp.y, v), mix(b.z, tp.z, v * v));
    hs.t = normalize(tp - b + vec3f(1e-6));
    // (a wall of water has body: each particle its own depth through it, thick at the foot, thinning to the crest —
    // a sheet one particle thick reads as a sprinkle of glitter)
    let acr = U.path[c0 * 2 + 2].xyz - U.path[c0 * 2].xyz;
    let nrm = normalize(cross(acr, hs.t) + vec3f(1e-6));
    let dep = f32(hashU(i * 3266489917u + 41u) & 0xffffu) / 65535.0 - 0.5;
    hs.q += nrm * dep * mix(0.75, 0.2, v);
    hs.u = u;
    hs.r = abs(U.path[c0 * 2].w);
    hs.v = mix(U.pathVel[c0 * 2].xyz, U.pathVel[c0 * 2 + 1].xyz, v);
    hs.flow = U.pathVel[c0 * 2].w;
    hs.d = distance(pos, hs.q);
    return hs;
  }
  var kf = u * f32(n - 1);
  if (U.pathMode > 1.5 && U.pathMode < 2.5) {
    let per = n / 8;
    let strand = min(i32(u * 8.0), 7);
    // fewer particles toward the tip so each strand tapers instead of ending in a blob
    let lu = 1.0 - sqrt(1.0 - fract(u * 8.0));
    kf = f32(strand * per) + lu * f32(per - 1);
  }
  if (U.pathMode > 3.5) {
    // (over the strands' own segments: the jump from one strand to the next isn't water)
    let L = max(U.form.x, 2.0);
    let ns = max(floor(f32(n) / L), 1.0);
    let g = u * ns * (L - 1.0);
    let st = min(floor(g / (L - 1.0)), ns - 1.0);
    kf = st * L + min(g - st * (L - 1.0), L - 1.0001);
  }
  let k = min(i32(floor(kf)), n - 2);
  let s = clamp(kf - floor(kf), 0.0, 1.0);
  var h: PathHit;
  let a = U.path[k].xyz;
  let b = U.path[k + 1].xyz;
  h.q = mix(a, b, s);
  h.t = normalize(b - a + vec3f(1e-6));
  h.u = u;
  h.r = mix(abs(U.path[k].w), abs(U.path[k + 1].w), s);
  h.v = mix(U.pathVel[k].xyz, U.pathVel[k + 1].xyz, s);
  h.flow = mix(U.pathVel[k].w, U.pathVel[k + 1].w, s);
  if (U.pathMode > 1.5) {
    // each particle also keeps its own place across the arm, so the arm is a filled, tapering tube rather than
    // a thread that surface tension beads up
    let e1 = normalize(cross(h.t, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(h.t.y) > 0.9)));
    let e2 = cross(h.t, e1);
    let th = f32(hashU(i * 3266489917u + 5u) & 0xffffu) / 65535.0 * 6.2831853;
    let rr = sqrt(f32(hashU(i * 668265263u + 7u) & 0xffffu) / 65535.0) * h.r * 0.85;
    h.q += (e1 * cos(th) + e2 * sin(th)) * rr;
    h.r *= 0.35;
  }
  h.d = distance(pos, h.q);
  return h;
}

// ---------------------------------------------------------------- G2P + everything per particle
@compute @workgroup_size(64)
fn g2p(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= U.nMax) { return; }
  var p = P[i];
  let ph = u32(p.phase);
  if (ph == 0u) { return; }
  let rdt = U.realDt;
  p.c0.w += rdt;
  let held = p.c1.w > 0.5 && ph == 1u;

  // ---- rigid ice groups: follow their body
  if (ph == 3u) {
    let gi = u32(p.c1.w);
    let gpos = U.groups[gi * 4u];
    let grot = U.groups[gi * 4u + 1u];
    if (gpos.w < 0.5) { p.phase = 2.0; P[i] = p; return; } // group dissolved: becomes static ice where it is
    let np = gpos.xyz + qrot(grot, p.c0.xyz);
    p.vel = (np - p.pos) / max(rdt, 1e-4);
    p.pos = np;
    P[i] = p;
    return;
  }
  // ---- static ice: melting / shattering
  if (ph == 2u) {
    p.ice = min(p.ice + rdt * 2.0, 1.0);
    if ((U.melt.w > 0.0 && distance(p.pos, U.melt.xyz) < U.melt.w) || U.meltAll > 0.5) {
      p.phase = 1.0; p.vel = vec3f(0.0); p.c1.w = 0.0;
    }
    if (U.shatter.w > 0.0 && distance(p.pos, U.shatter.xyz) < U.shatter.w) {
      p.phase = 4.0;
      let away = normalize(p.pos - U.shatter.xyz + vec3f(0.0, 0.3, 0.0));
      p.vel = away * U.shatter.w * (2.0 + 4.0 * rnd(i, 9u)) + vec3f(rnd(i, 10u) - 0.5, rnd(i, 11u), rnd(i, 12u) - 0.5) * 2.0;
      p.c0.w = 0.0;
    }
    P[i] = p;
    return;
  }

  var v = p.vel;
  let g = toGrid(p.pos);
  if (ph == 1u && inDomain(g) && !arcing(p)) {
    let ci = vec3i(floor(g));
    let d = g - (vec3f(ci) + 0.5);
    var w = weights(d);
    var vs = vec3f(0.0);
    var B = mat3x3f(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    for (var gx = 0; gx < 3; gx++) { for (var gy = 0; gy < 3; gy++) { for (var gz = 0; gz < 3; gz++) {
      let wt = w[gx].x * w[gy].y * w[gz].z;
      let cx = ci + vec3i(gx - 1, gy - 1, gz - 1);
      let cd = (vec3f(cx) + 0.5) - g;
      let gv = gridV[cellIndex(cx)];
      let wv = gv.xyz * wt;
      vs += wv;
      B += mat3x3f(wv * cd.x, wv * cd.y, wv * cd.z);
    }}}
    let C = B * 4.0;
    p.c0 = vec4f(C[0], p.c0.w); p.c1 = vec4f(C[1], p.c1.w); p.c2 = vec4f(C[2], p.c2.w);
    v = vs * U.vScale;
    // held water floats: cancel most of the gravity the grid applied
    if (held) { v.y += U.gravity * U.dt * U.vScale * U.flow; }
  } else {
    // free flight (outside the grid, droplets, shards — what she holds floats there as it does in the grid)
    if (!held) { v.y -= 9.8 * rdt; v *= 1.0 - 0.15 * rdt; }
    // (held water out past the grid's edge is still the body she holds — its density reads as fine water there, and
    // held mist or snow as massed: at 0 the edge of a big form of mist, which dissipates when it strays, vanished)
    let massedOut = select(0.6, 1.8, p.ice < 0.0);
    // (and water hurled at a mark flies as one mass, not as spray: massed too)
    let hurledOut = p.c1.w > -0.4 && p.c1.w < -0.1;
    p.c0 = vec4f(0.0, 0.0, 0.0, p.c0.w); p.c1 = vec4f(0.0, 0.0, 0.0, p.c1.w); p.c2 = vec4f(0.0, 0.0, 0.0, select(select(0.0, 1.6, hurledOut), massedOut, held));
  }

  // ---- what it's made of: held mist slowly condenses into water and held snow melts into it as she works them (she
  // molds the cloud into water), so a mass drawn from different sources swirls together and becomes one
  if (held && p.ice < 0.0) {
    let mk = max(U.form.z, 1.0);
    let m = matMist(p.ice) * exp(-rdt * mk / 9.0);
    let sn = matSnow(p.ice) * exp(-rdt * mk / 14.0);
    p.ice = select(matPack(m, sn), 0.0, m < 0.01 && sn < 0.01);
  }
  // ---- bending: held water is steered onto the path the player is drawing
  // (poured — hurled a part at a time: only those whose turn has come let go, the rest held in her form a moment
  // longer, so it drains out of it in a stream)
  let turn = f32(hashU(i * 2246822519u + 101u) & 0xffffu) / 65535.0;
  if (held && U.releaseHeld > 0.5 && (U.hurl2.z < 0.5 || turn <= U.hurl2.w)) {
    // let go: keep the momentum, plus the throw
    p.c1.w = 0.0;
    if (U.hurl2.z > 0.5) {
      // hurled at a mark: each particle on its own arc to a point in a ball round it, in its own time — the mass lands
      // over a moment, a torrent rather than one splat. (Free flight's air drag, ~0.15/s, made up for at the launch;
      // marked as hurled — c1.w -0.25 — so the speed cap doesn't hold it back on its way)
      let h0 = hashU(i * 2654435761u + 911u);
      let r3 = vec3f(f32(h0 & 1023u), f32((h0 >> 10u) & 1023u), f32((h0 >> 20u) & 1023u)) / 1023.0 * 2.0 - 1.0;
      let rT = f32(hashU(i * 747796405u + 13u) & 0xffffu) / 65535.0;
      let T = U.hurl.w + rT * U.hurl2.y;
      let tgt = U.hurl.xyz + r3 * U.hurl2.x;
      // (poured from a mouth: out of the form's face toward the mark, a jet — not out of all of it at once, a wall)
      if (U.hurl3.w > 0.0) {
        let h1 = hashU(i * 2246822519u + 4099u);
        let m3 = vec3f(f32(h1 & 1023u), f32((h1 >> 10u) & 1023u), f32((h1 >> 20u) & 1023u)) / 1023.0 * 2.0 - 1.0;
        p.pos = U.hurl3.xyz + m3 * U.hurl3.w;
      }
      let dk = 0.15 * T / max(1.0 - exp(-0.15 * T), 1e-3);
      v = ((tgt - p.pos) / T + vec3f(0.0, 4.9 * T, 0.0)) * dk;
      p.c1.w = -0.25;
      p.c0.w = 0.0;
    } else {
      v += U.push.xyz;
    }
  } else if (held && U.pathCount > 0.5) {
    let hit = pathAt(i, p.pos);
    let toQ = hit.q - p.pos;
    let dist = hit.d;
    let dir = toQ / max(dist, 1e-4);
    // inside the tube: gentle; outside: pulled in hard (and fast if far)
    // (in parametric modes each particle has its own spot on the path, so it is held tighter)
    let outside = max(dist - hit.r * select(0.6, 0.3, U.pathMode > 0.5), 0.0);
    // (strands are held hardest: thin arms otherwise bead up into droplets under their own surface tension; and the
    // geometry she builds in flight — its many lines — hardest of all: held loosely, the water's own pressure spread
    // its lines into sheets and blobs; the vortex's arms looser, a spinning column of water)
    let tight = select(0.0, U.form.y, U.pathMode > 3.5 && U.pathMode < 4.5);
    let pullK = mix(select(select(1.0, 1.6, U.pathMode > 0.5), 2.6, U.pathMode > 1.5 && U.pathMode < 2.5), 3.4, tight);
    // (a lone point — an orb — has no run to flow along: only its swirl. Flowing "along" it, up, floated a ball half a
    // metre over where it was held)
    let along = select(hit.flow, 0.0, U.pathCount < 1.5);
    var tv = hit.v + hit.t * along + dir * min(outside * U.pull * pullK, mix(20.0, 34.0, tight));
    // swirl inside the tube keeps the stream lively
    tv += cross(hit.t, dir) * hit.flow * 0.25;
    let far = sat(outside / max(hit.r, 0.05));
    let k = 1.0 - exp(-rdt * mix(mix(7.0, 20.0, far), mix(22.0, 50.0, far), tight));
    v = mix(v, tv, k);
  }
  // ---- freezing
  if (ph == 1u) {
    let fr = U.freeze.w > 0.0 && distance(p.pos, U.freeze.xyz) < U.freeze.w && !held;
    if (held && U.freezeHeld > 0.5) {
      if (U.freezeGroup >= 0.0) {
        // join the rigid group: store the offset in the body frame
        let gi = u32(U.freezeGroup);
        let gpos = U.groups[gi * 4u];
        let grot = U.groups[gi * 4u + 1u];
        p.phase = 3.0;
        p.c0 = vec4f(qrot(qinv(grot), p.pos - gpos.xyz), p.c0.w);
        p.c1.w = U.freezeGroup;
        p.ice = 0.0;
        p.vel = vec3f(0.0);
        P[i] = p;
        return;
      }
      p.phase = 2.0; p.c1.w = 0.0; p.ice = 0.0; p.vel = vec3f(0.0); P[i] = p; return;
    }
    if (fr) { p.phase = 2.0; p.ice = 0.0; p.vel = vec3f(0.0); P[i] = p; return; }
  }

  let sp = length(v);
  let hurled = p.c1.w > -0.4 && p.c1.w < -0.1 && p.c0.w < 5.0;
  if (sp > U.maxSpeed && !hurled) { v *= U.maxSpeed / sp; }
  p.pos += v * rdt;
  // (in flight the held water rides along with her: the sim works in her moving frame, so it keeps its form at any
  // speed instead of trailing behind at the most it could be pulled)
  if (held) { p.pos += U.carry.xyz; }
  p.vel = v;

  // ---- the world: the water's surface (absorbed), the ground (splash / soak), lifetime
  let gh = groundAt(p.pos.xz);
  let wl = waterLevelAt(p.pos.xz, gh);
  let overWater = wl > -1e3;
  // (thrown spray is taken back the moment it touches the surface: landing at a glancing angle it skated along it in
  // flat white blots)
  let isSpray = p.c1.w < -0.5;
  if (!held && overWater && ((p.pos.y < wl - 0.04 && v.y < 0.5) || (isSpray && p.pos.y < wl + 0.02 && v.y < 1.5))) {
    let impact = max(-v.y, 0.0);
    landAt(p.pos, -0.002 * (0.6 + impact * 0.4));
    if (impact > 1.2 && (i % 6u) == 0u) { splashEvent(vec3f(p.pos.x, wl, p.pos.z), impact); }
    let rel = (p.pos - U.anchor.xyz) * 16.0;
    atomicAdd(&counters[4], 1);
    atomicAdd(&counters[5], i32(impact * 100.0));
    atomicAdd(&counters[11], i32(rel.x));
    atomicAdd(&counters[12], i32(rel.y));
    atomicAdd(&counters[13], i32(rel.z));
    kill(i);
    return;
  }
  if (p.pos.y < gh + 0.02) {
    // spray landing on dry ground just soaks in (the app also darkened the ground there: this world keeps no wet map)
    if (p.c1.w < -0.5 && ph == 1u) { kill(i); return; }
    p.pos.y = gh + 0.02;
    let nrm = groundNormal(p.pos.xz);
    let vn = dot(p.vel, nrm);
    if (vn < 0.0) { p.vel -= nrm * vn * select(1.0, 1.4, ph == 4u); p.vel *= 0.8; }
    if (ph == 4u && (i % 9u) == 0u && length(p.vel) > 2.0) { splashEvent(p.pos, -1.0); }
    if (ph == 4u && length(p.vel) < 0.5) {
      // shards come to rest and melt away
      if (p.c0.w > 4.0) { kill(i); return; }
    }
  }
  // free water on dry ground soaks in after a while — lying a few centimetres over it too, stacked on itself (left on a
  // bank it kept the sim awake for minutes)
  // (a fresh draw every step: the same draw each step would leave the same particles lying there for ever)
  if (!held && ph == 1u && p.c0.w > 4.0 && p.pos.y < gh + 0.1 && rnd(i, 21u + u32(U.time * 240.0) % 9973u) < rdt * 0.6) { kill(i); return; }
  if (ph == 4u && p.c0.w > 8.0) { kill(i); return; }
  // far outside (thrown away, or fallen far below the grid — this world's ground runs hundreds of metres under its
  // origin, where the app's fixed floor was): let it go
  if (p.pos.y < U.origin.y - 200.0 || distance(p.pos, U.origin + vec3f(U.dims) * U.h * 0.5) > 120.0) { kill(i); return; }
  P[i] = p;
}

// ---------------------------------------------------------------- stats for the CPU (read back asynchronously)
@compute @workgroup_size(64)
fn stats(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= U.nMax) { return; }
  let p = P[i];
  let ph = u32(p.phase);
  if (ph == 0u) { return; }
  atomicAdd(&counters[1], 1);
  if (p.c1.w > 0.5 && ph == 1u) {
    let rel = (p.pos - U.anchor.xyz) * 16.0;
    atomicAdd(&counters[2], 1);
    atomicAdd(&counters[6], i32(rel.x));
    atomicAdd(&counters[7], i32(rel.y));
    atomicAdd(&counters[8], i32(rel.z));
    atomicAdd(&counters[9], i32(length(p.vel) * 16.0));
  }
  if (ph == 2u || ph == 3u) { atomicAdd(&counters[3], 1); }
  if (ph == 2u) { atomicAdd(&counters[14], 1); }
  if (ph == 1u && p.c1.w < 0.5) { atomicAdd(&counters[10], 1); }
  // water flying through a target (thrown water, spray, shards, or a whip's held water moving fast)
  let spd = length(p.vel);
  let heldP = ph == 1u && p.c1.w > 0.5;
  if ((ph == 1u || ph == 4u) && spd > select(1.5, 5.0, heldP)) {
    for (var k = 0; k < 16; k++) {
      let t = U.targets[k];
      if (t.w > 0.0 && distance(p.pos, t.xyz) < t.w) { atomicAdd(&counters[16 + k], 1); }
    }
  }
}

@compute @workgroup_size(1)
fn resetStats() {
  for (var k = 1; k < 32; k++) { atomicStore(&counters[k], 0); }
}

@compute @workgroup_size(64)
fn initFree(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= U.nMax) { return; }
  freeList[i] = U.nMax - 1u - i;
  P[i].phase = 0.0;
  if (i == 0u) { atomicStore(&counters[0], i32(U.nMax)); }
}

// ---------------------------------------------------------------- the landings (for the lakes' ripples)
@compute @workgroup_size(1)
fn landClear() { atomicStore(&landings.n, 0u); }

// each cell of the table that took water this frame: one landing where its drops came down (their mean), their summed
// dent, over a radius that grows with how many; the cell is emptied for the next frame
@compute @workgroup_size(64)
fn landCompact(@builtin(global_invocation_id) id: vec3u) {
  let s = id.x;
  if (s >= LAND_SLOTS) { return; }
  let b = LAND_BASE + s * 5u;
  let key = atomicLoad(&counters[b]);
  if (key == 0) { return; }
  let n = max(atomicLoad(&counters[b + 1u]), 1);
  let ox = f32(atomicLoad(&counters[b + 2u])) / 4096.0 / f32(n);
  let oz = f32(atomicLoad(&counters[b + 3u])) / 4096.0 / f32(n);
  let amount = f32(atomicLoad(&counters[b + 4u])) / 1e5;
  for (var k = 0u; k < 5u; k++) { atomicStore(&counters[b + k], 0); }
  // (the cell back from its key: 15 bits a side, signed)
  let ku = bitcast<u32>(key);
  let cx = bitcast<i32>(((ku >> 15u) & 0x7fffu) << 17u) >> 17u;
  let cz = bitcast<i32>((ku & 0x7fffu) << 17u) >> 17u;
  let xz = U.origin.xz + (vec2f(f32(cx), f32(cz)) + 0.5) * LAND_CELL + vec2f(ox, oz);
  let e = atomicAdd(&landings.n, 1u);
  if (e < 256u) { landings.at[e] = vec4f(xz.x, xz.y, amount, clamp(0.2 + 0.05 * sqrt(f32(n)), 0.2, 0.8)); }
}
