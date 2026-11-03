// Stars and planets at their true places: equatorial unit vectors turned into the world by the local sidereal time,
// coloured by B-V, point sprites added over the sky (where nothing else is). How many show depends on the sky behind
// them: its brightness on the screen (twilight, moonlight, the cities' glow) sets the faintest magnitude the eye can
// pick out, so as the sky darkens they come out one by one, the planets and the brightest first. A star's brightness
// is set on the screen (against the night's exposure, the way an eye adapts): the faintest a pinprick, the brightest
// with a glow. Near the horizon they dim (airmass) and twinkle; planets shine steadily.
#include "./world.wgsl"

struct Star { dir: vec3f, mag: f32, bv: f32, seed: f32, p0: f32, p1: f32 }
@group(2) @binding(0) var<storage, read> stars: array<Star>;

struct SOut {
  @builtin(position) pos: vec4f,
  @location(0) q: vec2f,
  @location(1) @interpolate(flat) color: vec3f,
}

fn bvColor(bv: f32) -> vec3f {
  let t = clamp((bv + 0.3) / 2.2, 0.0, 1.0);
  return mix(mix(vec3f(0.62, 0.72, 1.0), vec3f(1.0, 0.98, 0.95), smoothstep(0.0, 0.3, t)), vec3f(1.0, 0.62, 0.35), smoothstep(0.35, 1.0, t));
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SOut {
  var o: SOut;
  let s = stars[ii];
  let d = normalize(world.eqX.xyz * s.dir.x + world.eqY.xyz * s.dir.y + world.eqZ.xyz * s.dir.z);
  let corner = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2.0 - 1.0;
  // the sky behind it on the screen (the airglow and the city's glow too), and the faintest star the eye finds there
  let lw = vec3f(0.2126, 0.7152, 0.0722);
  let bg = dot(skyAtmosphere(d), lw) * world.exposure + 0.004 * world.night.z;
  let mlim = 6.4 - 2.75 * log2(max(bg, 0.012) / 0.012) * 0.30103;
  // dimmer through more air low down; twinkling there (a planet's disc doesn't)
  let drop = horizonDrop();
  let airmass = 1.0 / max(d.y - drop + 0.06, 0.06);
  let m = s.mag + 0.18 * (airmass - 1.0);
  let planet = s.seed < 0.0;
  let low = smoothstep(0.55, 0.0, d.y);
  let t = world.site.z;
  let tw = select(1.0 + (0.06 + 0.3 * low) * (0.6 * sin(t * (11.0 + s.seed * 7.0) + s.seed * 91.0) + 0.4 * sin(t * (17.3 + s.seed * 5.0) + s.seed * 43.0)), 1.0, planet);
  // its brightness on the screen: nothing at the limit, a pinprick a little above it, a glow far above
  let x = 0.4 * (mlim - m);
  let B = 0.05 * (pow(10.0, 0.55 * max(x, 0.0)) - 1.0) * world.night.x * tw;
  // (at least a pixel and a half across, so they hold still as the view moves)
  let px = (1.75 + 1.1 * sqrt(min(B, 9.0))) * max(frame.res.y / 1080.0, 0.75);
  let c = frame.viewProj * vec4f(d, 0.0);
  o.pos = vec4f(c.xy + corner * px * 2.0 * frame.invRes * c.w, 0.0, c.w);
  if (d.y < -0.02 + drop || x <= 0.0 || c.w <= 0.0) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); }
  o.q = corner;
  o.color = bvColor(s.bv) * min(B, 40.0) / max(world.exposure, 1e-6);
  return o;
}

@fragment fn fs(i: SOut) -> @location(0) vec4f {
  let a = exp(-dot(i.q, i.q) * 3.5);
  return vec4f(i.color * a, 0.0);
}
