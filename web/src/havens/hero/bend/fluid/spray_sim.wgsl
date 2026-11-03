// Spray, mist and sparkle (spray.ts), ported from the waterbending app: droplets flung off splashes and whips, mist
// puffs that drift, frost glitter when water freezes and ice dust when it shatters, spume, falling leaves, motes of
// light, the charge's energy motes. Emitted by CPU requests and by splash events the fluid sim appends on the GPU
// (fluid_sim.wgsl). Under water: air bubbles (buoyant, zigzagging, bursting at the surface) and silt motes drifting
// about the camera. The water is the levels the brain gives (the same as the fluid's), the ground the terrain's.
#include "./../../../world/world.wgsl"
#include "./common.wgsl"
#include "./spray_types.wgsl"

@group(2) @binding(0) var<storage, read_write> PS: array<SP>;
@group(2) @binding(2) var<storage, read_write> events: array<vec4f, 513>; // xyz pos, w impact speed (from [1])
@group(2) @binding(3) var<storage, read_write> ring: array<atomic<u32>, 4>; // 0 the next slot, 1 events this frame

fn rndS(i: u32, k: u32) -> f32 { return f32(hashU(i * 1664525u + k * 1013904223u + S.frameNo * 69069u) & 0xffffu) / 65535.0; }
fn rndDir(i: u32, k: u32) -> vec3f {
  let z = rndS(i, k) * 2.0 - 1.0;
  let a = rndS(i, k + 1u) * TAU;
  let r = sqrt(max(1.0 - z * z, 0.0));
  return vec3f(r * cos(a), z, r * sin(a));
}

fn spawnOne(pos: vec3f, vel: vec3f, kind: f32, life: f32) {
  let slot = atomicAdd(&ring[0], 1u) % S.maxP;
  PS[slot] = SP(pos, life, vel, kind);
}

// CPU emitters: one thread per particle of each emitter (64 x 64 workgroups at most)
@compute @workgroup_size(64)
fn emitCPU(@builtin(global_invocation_id) id: vec3u, @builtin(workgroup_id) wg: vec3u) {
  let e = wg.y;
  if (e >= S.nEmit) { return; }
  let E0 = S.emit[e * 3u];
  let E1 = S.emit[e * 3u + 1u];
  let E2 = S.emit[e * 3u + 2u];
  let k = id.x;
  if (f32(k) >= E2.x) { return; }
  let i = k + e * 4096u;
  let d = rndDir(i, 3u);
  let p = E0.xyz + d * E0.w * pow(rndS(i, 7u), 0.33);
  let v = E1.xyz * (0.6 + 0.8 * rndS(i, 9u)) + rndDir(i, 11u) * E1.w;
  // (its size rides in the kind's fraction: x1..x20, spray_draw.wgsl)
  spawnOne(p, v, E2.y + clamp((max(E2.z, 1.0) - 1.0) / 20.0, 0.0, 0.95), E2.w * (0.6 + 0.8 * rndS(i, 13u)));
}

// GPU splash events from the fluid: each event throws up a crown of droplets and a puff of mist
@compute @workgroup_size(16)
fn emitEvents(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let n = min(atomicLoad(&ring[1]), 512u);
  let ev = wg.x;
  if (ev >= n) { return; }
  let E = events[ev + 1u];
  let impact = E.w;
  let i = ev * 16u + li;
  if (impact < 0.0) {
    // ice dust: glitter from a shard skittering over the ground
    if (li < 5u) { spawnOne(E.xyz, rndDir(i, 17u) * 0.8 + vec3f(0.0, 0.6, 0.0), 3.0, 0.8 + rndS(i, 18u)); }
    return;
  }
  if (li < 12u) {
    // crown: up and outward, faster for harder hits
    let a = rndS(i, 1u) * TAU;
    let out = vec3f(cos(a), 0.0, sin(a));
    let v = out * (0.6 + rndS(i, 2u) * 1.4) * (0.4 + impact * 0.25) + vec3f(0.0, 1.0 + rndS(i, 3u) * 2.2, 0.0) * (0.3 + impact * 0.3);
    spawnOne(E.xyz + out * 0.05 + vec3f(0.0, 0.03, 0.0), v, 1.0, 0.6 + rndS(i, 4u) * 0.8);
  // (a mass of water landing at once raises hundreds of events: a puff of mist from only some of them, and foam on a
  // few — all of them stacked into one opaque white cloud sitting on the water for seconds)
  } else if (li < 13u && impact > 3.0 && ev % 12u == 0u) {
    spawnOne(E.xyz + vec3f(0.0, 0.1, 0.0), rndDir(i, 5u) * 0.3 + vec3f(0.0, 0.4, 0.0), 2.0, 0.9 + rndS(i, 6u) * 1.1);
  } else if (li >= 14u && li < 15u && ev % 2u == 0u) {
    // foam flecks riding the surface
    let a = rndS(i, 8u) * TAU;
    spawnOne(vec3f(E.x, E.y + 0.02, E.z) + vec3f(cos(a), 0.0, sin(a)) * 0.2, vec3f(cos(a), 0.0, sin(a)) * 0.4, 4.0, 2.0 + rndS(i, 9u) * 2.0);
  }
}

@compute @workgroup_size(1)
fn clearEvents() { atomicStore(&ring[1], 0u); }

@compute @workgroup_size(64)
fn updateP(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= S.maxP) { return; }
  var p = PS[i];
  if (p.kind < 0.5) { return; }
  let dt = S.dt;
  p.life -= dt;
  if (p.life <= 0.0) { PS[i].kind = 0.0; return; }
  let k = u32(p.kind);
  if (k == 5u || k == 6u) {
    // ---- under water only (bubbles, motes): out of the water they're gone
    let surf = waterLevel(p.pos.xz);
    if (p.pos.y > surf) {
      PS[i].kind = 0.0;
      // a bubble reaching the surface pops: a fleck of foam, now and then a droplet
      if (k == 5u && p.pos.y < surf + 0.3) {
        spawnOne(vec3f(p.pos.x, surf + 0.01, p.pos.z), vec3f(rndS(i, 21u) - 0.5, 0.0, rndS(i, 22u) - 0.5) * 0.15, 4.0, 0.6 + rndS(i, 23u));
        if (rndS(i, 24u) < 0.3) { spawnOne(vec3f(p.pos.x, surf + 0.02, p.pos.z), vec3f(rndS(i, 25u) - 0.5, 1.6 + rndS(i, 26u), rndS(i, 27u) - 0.5) * 0.7, 1.0, 0.3); }
      }
      return;
    }
    let h = f32(hashU(i * 2654435761u) & 0xffffu) / 65535.0;
    if (k == 5u) {
      // buoyancy against drag: small bubbles rise ~0.2 m/s, bigger ones faster, zigzagging as they go
      let vt = 0.16 + 0.22 * h * h;
      let ph = S.time * (5.0 + 4.0 * h) + h * 40.0;
      let wob = vec3f(cos(ph), 0.0, sin(ph * 1.3)) * (0.05 + 0.1 * h);
      p.vel += (vec3f(0.0, vt, 0.0) + wob - p.vel) * (1.0 - exp(-dt * 3.0));
    } else {
      // motes hang in the water: a slow random drift, settling a little
      let ph = S.time * 0.3 + h * 50.0;
      let drift = vec3f(sin(ph + f32(i) * 0.1), sin(ph * 0.7 + 2.0) * 0.4 - 0.15, cos(ph * 0.9 + h * 7.0)) * 0.025;
      p.vel += (drift - p.vel) * (1.0 - exp(-dt * 0.5));
      // (left behind: the camera's own sphere of them is kept topped up)
      if (distance(p.pos, frame.camPos) > 9.0 || S.under == 0u) { p.life = min(p.life, 0.3); }
    }
    p.pos += p.vel * dt;
    let g = terrainHeight(p.pos.xz);
    if (p.pos.y < g + 0.01) { p.pos.y = g + 0.01; }
    PS[i] = p;
    return;
  }
  if (k == 1u) {
    p.vel.y -= 9.8 * dt;
    p.vel += (S.wind.xyz - p.vel) * (1.0 - exp(-dt * 0.4));
  } else if (k == 2u) {
    // mist: buoyant, drifts with the breeze, slows
    p.vel += (S.wind.xyz * 0.6 + vec3f(0.0, 0.25, 0.0) - p.vel) * (1.0 - exp(-dt * 1.2));
  } else if (k == 3u) {
    p.vel.y -= 1.2 * dt;
    p.vel *= exp(-dt * 2.5);
  } else if (k == 8u) {
    // a falling leaf: slow, fluttering — sideslipping one way then the other as it falls, rocking, drifting on the
    // breeze; once down it lies where it fell (on water it floats)
    let h = f32(hashU(i * 2654435761u) & 0xffffu) / 65535.0;
    let ph = S.time * (2.0 + 1.6 * h) + h * 40.0;
    let flutter = vec3f(cos(ph), 0.0, sin(ph * 0.8 + 1.3)) * (0.6 + 0.5 * h);
    let tgt = S.wind.xyz * 0.8 + flutter + vec3f(0.0, -0.8 - 0.35 * h + 0.45 * sin(ph * 2.0), 0.0);
    p.vel += (tgt - p.vel) * (1.0 - exp(-dt * 2.5));
  } else if (k == 9u) {
    // a mote of light: hanging in the air, drifting slowly every way, rising a little
    let h = f32(hashU(i * 2654435761u + 7u) & 0xffffu) / 65535.0;
    let ph = S.time * 0.35 + h * 50.0;
    let drift = vec3f(sin(ph + h * 9.0), 0.3 + 0.25 * sin(ph * 0.7), cos(ph * 0.9 + 2.0)) * 0.22;
    p.vel += (drift - p.vel) * (1.0 - exp(-dt * 0.6));
  } else if (k == 10u) {
    // an energy mote: drawn to the nearest point of the form she holds and swept round it — in from far off, faster
    // the nearer it comes, then circling on a shell about it on its own tilted orbit, surging on each beat; drawn
    // into the water it's gone. With nothing held (the charge spent) it drifts, slowing, and fades
    let h = f32(hashU(i * 2654435761u + 11u) & 0xffffu) / 65535.0;
    let h2 = f32(hashU(i * 1103515245u + 5u) & 0xffffu) / 65535.0;
    let n = u32(S.attractInfo.z);
    let E = S.attractInfo.x;
    if (n > 0u && E > 0.01) {
      var c = S.attract[0];
      var best = 1e9;
      for (var j = 0u; j < n; j++) { let d = distance(p.pos, S.attract[j].xyz); if (d < best) { best = d; c = S.attract[j]; } }
      let d = c.xyz - p.pos;
      let r = max(length(d), 1e-3);
      let dir = d / r;
      let ax = normalize(vec3f(h - 0.5, 1.0, h2 - 0.5) + vec3f(0.0, 0.0, 0.3 * sin(S.time * 0.4 + h * 20.0)));
      let tang = normalize(cross(ax, dir) + vec3f(1e-5));
      let shell = c.w * (1.05 + 0.55 * h);
      let x = fract(S.attractInfo.y);
      let beat = exp(-x * 9.0) + select(0.0, 0.6 * exp(-(x - 0.28) * 9.0), x > 0.28);
      let inward = clamp((r - shell) * (1.6 + 2.0 * E), -3.0, 26.0) * (1.0 + 0.6 * beat);
      let swirl = (1.5 + 7.0 * E) * (0.6 + 0.4 * h2) * (1.0 + 0.5 * beat) * smoothstep(shell * 4.0, shell, r);
      let want = dir * inward + tang * swirl;
      p.vel += (want - p.vel) * (1.0 - exp(-dt * (2.0 + 2.0 * E)));
      if (r < c.w * 0.55) { p.life = min(p.life, 0.12); }
    } else {
      p.vel *= exp(-dt * 1.5);
      p.life = min(p.life, 1.2);
    }
  } else if (k == 7u) {
    // spume: water torn into spray, heavy but caught by the air — it slows quickly, hangs, and falls back
    p.vel.y -= 7.0 * dt;
    p.vel += (S.wind.xyz - p.vel) * (1.0 - exp(-dt * 1.5));
  } else if (k == 11u) {
    // a sheet's torn water: streaks of drops flung off a skimmer, the air taking their speed a little faster than a
    // drop's, falling back
    p.vel.y -= 9.8 * dt;
    p.vel += (S.wind.xyz - p.vel) * (1.0 - exp(-dt * 2.6));
  } else if (k == 12u) {
    // haze: fine mist hanging over the water, drifting on the breeze, rising a little, slowing to it
    p.vel += (S.wind.xyz * 0.7 + vec3f(0.0, 0.12, 0.0) - p.vel) * (1.0 - exp(-dt * 0.9));
  } else {
    p.vel *= exp(-dt * 0.8);
  }
  p.pos += p.vel * dt;
  // (the water right here — every lake and pool has its own level)
  let wl = waterLevel(p.pos.xz);
  let g = terrainHeight(p.pos.xz);
  // droplets falling back into the water vanish
  if ((k == 1u || k == 7u || k == 11u) && p.pos.y < wl && p.vel.y < 0.0) { PS[i].kind = 0.0; return; }
  if (p.pos.y < g + 0.01) { p.pos.y = g + 0.01; p.vel = vec3f(0.0); if (k == 1u) { p.life = min(p.life, 0.15); } }
  // (a leaf comes to rest on the water and floats)
  if (k == 8u && wl > g && p.pos.y < wl + 0.01) { p.pos.y = wl + 0.01; p.vel = vec3f(p.vel.x, 0.0, p.vel.z) * 0.9; }
  PS[i] = p;
}
