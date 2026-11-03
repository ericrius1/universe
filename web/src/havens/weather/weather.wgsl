// The weather's touch on the world (world.wgsl includes this; src/weather/index.ts fills it):
//   flashAmbient(n)   a lightning flash's light on a surface: mostly from the flash's side of the sky, some from all
//                     of it (the clouds it lights up)
//   flashGlow(p)      the light a flash puts into the cloud round it (the clouds add it to their own)
//   fallShade(p)      the key light through the rain or snow between a point and the cloud base (cloudShadow takes it)
//   wetLook(...)      rain on the ground: darker and glossier as it soaks in (a rough film: a soft sheen, never a
//                     mirror), water standing in the hollows of flat ground — a mirror of the sky and the light, with
//                     rings spreading where the drops land. `n` the surface's smooth normal (its fine bumps would
//                     glitter)
struct WeatherU {
  wet: vec4f,      // x the ground's wetness (0..1), y standing water (0..1), z the rain falling now (0..1), w -
  flash: vec4f,    // a lightning flash: xyz where (world m), w the light in the cloud at it (0: none)
  flashC: vec4f,   // rgb its colour, w how far its glow spreads through the clouds (m)
  flashL: vec4f,   // xyz the unit direction from the eye to it, w its light on the ground round the eye (sun units)
  fall: vec4f,     // x the rain's or snow's extinction (1/m), y the top of the fall (world y: the cloud base), zw -
}
@group(3) @binding(11) var<uniform> weatherU: WeatherU;

fn flashAmbient(n: vec3f) -> vec3f {
  let e = weatherU.flashL.w;
  if (e <= 0.0) { return vec3f(0.0); }
  return weatherU.flashC.rgb * e * (0.12 + 0.88 * pow(saturate(dot(n, weatherU.flashL.xyz) * 0.5 + 0.5), 2.0));
}

fn fallShade(p: vec3f) -> f32 {
  let s = weatherU.fall.x;
  if (s <= 0.0) { return 1.0; }
  return exp(-s * max(weatherU.fall.y - p.y, 0.0) / max(world.sunDir.y, 0.05));
}

fn flashGlow(p: vec3f) -> vec3f {
  let f = weatherU.flash.w;
  if (f <= 0.0) { return vec3f(0.0); }
  let d = p - weatherU.flash.xyz;
  let R = weatherU.flashC.w;
  return weatherU.flashC.rgb * f * R * R / (R * R + dot(d, d));
}

// the rings of drops landing on standing water: cells of a grid each take a drop now and then, a ring spreading
// from it; the slope of the water they leave (xz)
fn rainRings(xz: vec2f, rate: f32) -> vec2f {
  let t = world.site.z;
  var g = vec2f(0.0);
  let cell = 0.42;
  let q = xz / cell;
  let i0 = floor(q);
  for (var j = -1; j <= 1; j++) {
    for (var k = -1; k <= 1; k++) {
      let c = i0 + vec2f(f32(j), f32(k));
      let h = hash22(c);
      // (each cell's drops come at its own pace; the rain's rate sets how many cells are dripping)
      let ph = t * (0.9 + 0.6 * h.x) + h.y * 13.0;
      let age = fract(ph);
      let live = step(hash12(c + floor(ph) * 7.13), rate);
      let at = (c + 0.2 + 0.6 * hash22(c + floor(ph) * 3.7)) * cell;
      let d = xz - at;
      let r = length(d);
      let front = age * 0.36;
      let x = (r - front) * 38.0;
      let wave = sin(x) * exp(-x * x * 0.12) * (1.0 - age) * (1.0 - age) * live;
      g += d / max(r, 1e-3) * wave;
    }
  }
  return g * 0.09;
}

fn wetLook(c: vec3f, p: vec3f, n: vec3f, v: vec3f, vis: f32, dist: f32, snow: f32) -> vec3f {
  let wet = weatherU.wet.x * (1.0 - snow);
  if (wet <= 0.002) { return c; }
  // standing water: on flat ground, in the low places of a slow field, more of it the longer it has rained (the field
  // only read where there can be any)
  let flat = smoothstep(0.94, 0.985, n.y) * weatherU.wet.y * (1.0 - smoothstep(120.0, 320.0, dist));
  var pool = 0.0;
  if (flat > 0.0) {
    let hollow = fbm2(p.xz * 0.09 + vec2f(3.1, 7.7), 3) * 0.8 + noise2(p.xz * 0.7) * 0.2;
    pool = flat * smoothstep(0.7 - 0.3 * weatherU.wet.y, 0.58 - 0.3 * weatherU.wet.y, hollow);
  }
  // soaked: the diffuse light darker (water in the pores), a gloss on top; standing water darker still
  var col = c * mix(1.0, 0.55, wet) * (1.0 - 0.6 * pool);
  // the water's surface: up, ringed by the drops near the eye
  var wn = normalize(mix(n, vec3f(0.0, 1.0, 0.0), pool));
  if (pool > 0.01 && dist < 45.0 && weatherU.wet.z > 0.0) {
    let g = rainRings(p.xz, weatherU.wet.z) * (1.0 - smoothstep(20.0, 45.0, dist));
    wn = normalize(wn + vec3f(g.x, 0.0, g.y));
  }
  let r = reflect(-v, wn);
  let nv = saturate(dot(wn, v));
  // (a rough wet film never reaches a mirror's Fresnel at grazing; standing water does)
  let fres = 0.02 + mix(0.25, 0.98, pool) * pow(1.0 - nv, 5.0);
  // (the sky it mirrors: the clear sky's, turned to the clouds' grey as far as they cover it — dimmer toward the
  // horizon, where the hills and the trees stand in it)
  let up = skyAmbient(vec3f(0.0, 1.0, 0.0));
  let sky = mix(skyRadiance(normalize(vec3f(r.x, max(r.y, 0.02), r.z))), up * (0.55 + 0.45 * saturate(r.y * 2.0)), cloudSky.dome.x) * (0.35 + 0.65 * smoothstep(0.02, 0.3, r.y));
  col += sky * fres * mix(0.3 * wet, 1.0, pool);
  // the key light's glint: broad on soaked ground, sharp on standing water
  let l = world.sunDir;
  col += sunLight(p) * vis * ggx(wn, v, l, mix(0.4, 0.06, pool), vec3f(0.02)) * mix(0.5 * wet, 1.0, pool);
  return col;
}
