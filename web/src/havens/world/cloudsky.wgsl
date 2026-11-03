// What the clouds do to the light on everything else (world.wgsl includes this; src/world/clouds.ts fills it):
//   cloudShadow(p)   the direct key light let through to a point: a map looking down the sun's (or moon's) rays,
//                    rendered every frame from the puffs, the lenses and the layers (cloudshade.wgsl), holding the
//                    transmittance along each ray and the lowest cloud on it — points above that are in the clear.
//                    Beyond the map, the sky's mean. And the rain or snow falling under the clouds (weather.wgsl).
//   cloudAmbient     the sky's light under cloud: the clear sky's share of it, and for the rest the clouds' grey
//                    undersides — the key light diffused through them (a two-stream slab) and the ground's bounce.

struct CloudSky {
  e1: vec4f,        // xyz the map's first axis (across the key light's rays), w its origin along it (m)
  e2: vec4f,        // xyz the second axis, w its origin
  map: vec4f,       // x the map's extent (m), y shadow strength, z the mean direct transmittance beyond it, w on
  dome: vec4f,      // x how much of the sky the clouds cover, y their diffuse transmittance, z their base (km above sea level), w how much of a time-lapse it is (0..1)
}
@group(3) @binding(8) var cloudShadowTex: texture_2d<f32>;
@group(3) @binding(9) var<uniform> cloudSky: CloudSky;

// where a world point falls on the cloud shadow map
fn cloudMapUv(p: vec3f) -> vec2f {
  let u = (dot(p, cloudSky.e1.xyz) - cloudSky.e1.w) / cloudSky.map.x;
  let v = (dot(p, cloudSky.e2.xyz) - cloudSky.e2.w) / cloudSky.map.x;
  return vec2f(u + 0.5, 0.5 - v);
}

fn cloudShadow(p: vec3f) -> f32 {
  if (cloudSky.map.w < 0.5) { return fallShade(p); }
  let uv = cloudMapUv(p);
  let s = textureSampleLevel(cloudShadowTex, samp_linear, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
  // (in a time-lapse a sun near the horizon shines through decks tens of km off along its slant: their shadows merge
  // into the mean, or the ground would strobe as the gaps race past; above the lowest cloud on the ray: a peak in the
  // sun over a deck)
  let shade = mix(cloudSky.map.z, s.r, mix(1.0, smoothstep(0.07, 0.24, world.sunDir.y), cloudSky.dome.w));
  var t = mix(shade, 1.0, smoothstep(s.a - 150.0, s.a + 60.0, p.y));
  let edge = max(abs(uv.x - 0.5), abs(uv.y - 0.5)) * 2.0;
  t = mix(t, cloudSky.map.z, smoothstep(0.8, 1.0, edge));
  return mix(1.0, t, cloudSky.map.y) * fallShade(p);
}

fn cloudAmbient(n: vec3f, clear: vec3f, clearUp: vec3f) -> vec3f {
  let c = cloudSky.dome.x;
  if (c <= 0.0) { return clear; }
  let mu = world.sunDir.y;
  // the key light on the clouds' tops, diffused down through them; the clear sky's light through them too
  let top = transmittanceToSpace(cloudSky.dome.z, mu) * world.haze.w * smoothstep(-0.06, 0.02, mu) * keyTint();
  let base = (top * max(mu, 0.0) / PI + clearUp) * cloudSky.dome.y;
  // (a dome brightest overhead; the ground, lit by it, bounces a little back up)
  let under = base * (0.62 + 0.38 * n.y) + base * 0.2 * (0.5 - 0.5 * n.y);
  return mix(clear, under, c);
}
