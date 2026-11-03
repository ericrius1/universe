// What the spray's sim and its drawing share (spray_sim.wgsl, spray_draw.wgsl): its particle, its uniform, where the
// water is.
struct SP { pos: vec3f, life: f32, vel: vec3f, kind: f32 } // kind: 0 dead, 1 droplet, 2 mist, 3 glitter, 4 foam fleck, 5 bubble, 6 mote, 7 spume, 8 leaf, 9 spirit, 10 energy, 11 sheet (torn water flying), 12 haze (mist that hangs)
struct SprayU {
  nEmit: u32, maxP: u32, frameNo: u32, under: u32,   // under: the eye is under the water
  dt: f32, time: f32, nWater: f32, emissive: f32,     // emissive: its own light's scale (spray.ts)
  wind: vec4f,
  camVel: vec4f,      // the camera's velocity (m/s; 0 across a cut): what moves with it holds still on screen
  energy: vec4f,      // the charge (energy.ts): x the heart's phase (beats), y the charge (0..1), z how far it's spirit water
  look: vec4f,        // x the water's depth texture's scale (render.ts), y it was drawn this frame
  water: array<vec4f, 8>,     // up to four bodies of water: [2k] the box (x0, z0, x1, z1), [2k + 1].x the level
  emit: array<vec4f, 192>,    // 64 emitters, 3 each: (pos, radius), (vel, spread), (count, kind, size, life)
  // what the energy motes are drawn to (energy.ts): points along the form she holds (xyz, radius); x the charge,
  // y the heart's phase, z how many points
  attract: array<vec4f, 8>,
  attractInfo: vec4f,
}
@group(2) @binding(1) var<uniform> S: SprayU;

// the water's surface over xz (-1e4: none there) — the highest of the levels whose box holds xz with the ground under it
fn waterLevel(xz: vec2f) -> f32 {
  let gh = terrainHeight(xz);
  var wl = -1e4;
  for (var k = 0u; k < u32(S.nWater); k++) {
    let b = S.water[k * 2u];
    let L = S.water[k * 2u + 1u].x;
    if (all(xz >= b.xy) && all(xz <= b.zw) && gh < L && L > wl) { wl = L; }
  }
  return wl;
}

