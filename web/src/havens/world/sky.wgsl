// The sky behind everything. By day the atmosphere's sky-view table (the painted dome: atmosphere.wgsl), the sun's
// limb-darkened disc; by night the same table lit by the moon (navy and indigo, as the eye takes it), the moon itself —
// the show's big one, its real phase lit from the sun's true direction, held luminous on the screen with a soft halo —
// the Milky Way (the NASA SVS map from Gaia: its star clouds and dust lanes, set on the screen against the sky's own
// brightness, so it fades in twilight and dims under the moon), airglow and the city's glow low toward it (world.glow);
// day and night the aurora's soft glow round its curtains (by day, its veil). Stars are point sprites drawn just after
// this (stars.wgsl), the aurora's curtains after them (aurora.wgsl). Only where nothing else was drawn; high up, what's
// below the horizon here is below the true one (world.wgsl horizonDrop).
#include "./world.wgsl"
#include "weft/fullscreen"

// 1: the aurora from its dome map too (for reflections, which don't draw its curtains)
override AURORA_DOME = 0.0;

// the Milky Way (public/assets/sky/milkyway.webp): J2000 plate carree, right ascension 0 at the centre increasing to
// the left, each channel's cube root
@group(2) @binding(0) var milkyTex: texture_2d<f32>;

const SUN_RADIUS = 0.00467;   // radians (0.2675 deg)

// the moon's light on the screen (before the tone map): its disc at its brightest, by day and by night, and its halo's
const MOON_DAY = 0.35;
const MOON_NIGHT = 2.2;
const MOON_HALO = 0.22;

fn moonDisc(rd: vec3f) -> vec3f {
  let m = normalize(world.moonDir);
  let r = world.moon.y;
  let c = dot(rd, m);
  if (world.moonDir.y < -0.03 + horizonDrop()) { return vec3f(0.0); }
  // the halo round it: the moonlight scattered in the air close to its disc, soft, cool, by night (its phase's share)
  let a = acos(clamp(c, -1.0, 1.0));
  let night = world.sunTrue.w;
  let hk = max(a - r, 0.0) / r;
  let halo = vec3f(0.78, 0.86, 1.0) * (exp(-hk * 1.1) * 0.75 + exp(-hk * 0.22) * 0.25) * MOON_HALO * night * world.moon.x * world.moon.x;
  let haloL = halo / max(world.exposure, 1e-6) * smoothstep(-0.03, 0.03, world.moonDir.y - horizonDrop());
  if (c < cos(r * 1.03)) { return haloL; }
  var e1 = cross(m, vec3f(0.0, 1.0, 0.0));
  if (dot(e1, e1) < 1e-6) { e1 = vec3f(1.0, 0.0, 0.0); }
  e1 = normalize(e1);
  let e2 = cross(e1, m);
  let q = vec2f(dot(rd, e1), dot(rd, e2)) / sin(r);
  let rr = dot(q, q);
  if (rr > 1.0) { return haloL; }
  let z = sqrt(1.0 - rr);
  // the visible hemisphere faces us (-m); Lommel-Seeliger: the full moon's disc is nearly flat, not limb-darkened
  let nrm = normalize(e1 * q.x + e2 * q.y - m * z);
  let ci = dot(nrm, world.sunTrue.xyz);
  let ce = z;
  let lit = select(0.0, ci / (ci + ce), ci > 0.0);
  // maria: dark basalt plains, a fixed pattern on the near side (pale blue-grey on the show's moon)
  let mare = smoothstep(0.45, 0.62, fbm2(q * 2.3 + vec2f(3.1, 1.7), 4));
  let albedo = mix(vec3f(1.0), vec3f(0.6, 0.68, 0.82), mare) * (0.92 + 0.16 * noise2(q * 18.0));
  // earthshine on the dark limb of a crescent
  let earth = 0.012 * (1.0 - world.moon.x);
  let tr = transmittanceToSpace(altitudeKm(frame.camPos), rd.y);
  // (held on the screen: by night luminous, a little over white, so its maria show; by day a pale disc in the blue)
  let col = vec3f(0.92, 0.97, 1.0) * world.moon.w * (lit * albedo * 2.0 + earth) * tr;
  let hold = mix(MOON_DAY, MOON_NIGHT, night) / max(world.moon.w * dot(tr, vec3f(0.2126, 0.7152, 0.0722)) * world.exposure, 1e-6);
  return col * min(1.0, hold) + haloL;
}

fn milkyWay(rd: vec3f) -> vec3f {
  let e = vec3f(dot(rd, world.eqX.xyz), dot(rd, world.eqY.xyz), dot(rd, world.eqZ.xyz));
  let ra = atan2(e.y, e.x);
  let dec = asin(clamp(e.z, -1.0, 1.0));
  let uv = vec2f(fract(0.5 - ra / (2.0 * PI)), 0.5 - dec / PI);
  // (the map's level from a pixel's size on the sky: no seam where it wraps)
  let pix = 2.0 / (frame.proj[1][1] * frame.res.y);
  let lod = max(log2(pix * 4096.0 / (2.0 * PI)), 0.0);
  let c = textureSampleLevel(milkyTex, samp_repeat, uv, lod).rgb;
  // (magnified — the telescope's finder and eyepieces — the map's texels would swell into blotches like cloud: its
  // light is the stars' there, which the eyepiece draws one by one, so it gives way)
  return c * c * c * smoothstep(3.0e-5, 4.5e-4, pix);
}

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let rd = viewRay(i.uv);
  var c = select(skyAtmosphere(rd), skyRadiance(rd), AURORA_DOME > 0.5);
  let night = world.sunTrue.w;
  let drop = horizonDrop();
  let above = smoothstep(-0.02 + drop, 0.06 + drop, rd.y);
  // the sun's disc (only while the sun itself is the key light)
  if (world.moon.z < 0.5) {
    let a = acos(clamp(dot(rd, world.sunTrue.xyz), -1.0, 1.0));
    if (a < SUN_RADIUS * 1.6) {
      let r = a / SUN_RADIUS;
      let mu = sqrt(max(0.0, 1.0 - r * r));
      let limb = 1.0 - 0.6 * (1.0 - mu) - 0.2 * (1.0 - mu) * (1.0 - mu);
      let disc = select(0.0, limb, r < 1.0);
      let L = 1.0 / (PI * SUN_RADIUS * SUN_RADIUS);
      let tr = transmittanceToSpace(altitudeKm(frame.camPos), rd.y);
      // (held to a few hundred times white on the screen: far past white whatever the exposure, but no longer
      // blooming into a ball that swallows the sunset round it)
      var sun = tr * L * disc * world.haze.w;
      sun *= min(1.0, 600.0 / max(dot(sun, vec3f(0.2126, 0.7152, 0.0722)) * world.exposure, 1e-6));
      c += select(sun, vec3f(0.0), rd.y < -0.03 + drop);
    }
  }
  if (night > 0.0) {
    let ext = exp(-0.15 / max(rd.y - drop + 0.04, 0.04));
    // the night's own navy, never black, the moon or no moon: no darker on the screen than this (indigo low down)
    let navy = mix(vec3f(0.009, 0.007, 0.03), vec3f(0.003, 0.006, 0.028), smoothstep(0.0, 0.5, rd.y)) * world.night.z;
    c = mix(c, max(c, navy / max(world.exposure, 1e-6)), night * above);
    // the Milky Way, set on the screen against the sky behind it (lost in twilight, washed out by the moon)
    let bg = dot(c, vec3f(0.2126, 0.7152, 0.0722)) * world.exposure;
    let mw = max(milkyWay(rd) - vec3f(0.005), vec3f(0.0)) * 0.55 * (1.0 - smoothstep(0.01, 0.06, bg));
    c += mw * world.night.y * night * ext * above / max(world.exposure, 1e-6);
    // airglow (brightest some 10-20 degrees up) and the city's light low toward it (all round from inside it)
    // (the airglow's band in the show's night colours: teal toward violet, never the olive of the real one)
    let ag = vec3f(0.3, 0.42, 0.62) * exp(-max(rd.y, 0.0) * 4.0) * (1.0 - exp(-max(rd.y, 0.0) * 30.0));
    let hz = normalize(vec2f(rd.x, rd.z) + vec2f(1e-5, 0.0));
    let toward = mix(1.0, pow(max(dot(hz, world.glow.xz), 0.0), 3.0), world.glow.y);
    let city = vec3f(1.0, 0.62, 0.5) * toward * world.glow.w * exp(-max(rd.y, 0.0) * 9.0);
    c += (ag * 0.00025 + city * 0.0005) * world.night.z * night * above;
  }
  // the aurora's glow round its curtains (the diffuse aurora they stand in, and their light scattered in the air; by day
  // most of the veil): a blurred level of its dome map (the curtains themselves are drawn after this)
  // (by day a finer level, brighter: the veil's soft bands)
  if (world.aurora0.x > 0.0) { c += textureSampleLevel(auroraDome, samp_linear, auroraDomeUv(rd), mix(3.2, 4.5, night)).rgb * mix(1.3, 0.3, night) * above; }
  c += moonDisc(rd);
  return vec4f(c, 1.0);
}
