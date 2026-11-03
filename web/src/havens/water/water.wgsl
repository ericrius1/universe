// The parts' water (water.ts): a pool's or a channel's sheet at its level — clear over its shallow floor and teal over
// the deep (the bible's pool teal, the light it scatters back), the sky mirrored at a glance, the sun's glint on a
// breeze's ripple — and a cascade's sheet falling from its lip, streaked white and teal, thinning to spray at its foot.
// Drawn after the opaque world, premultiplied, over the mosaic floors and the walls it lets show through.
#include "./../world/world.wgsl"

@group(2) @binding(0) var<storage, read> verts: array<vec4f>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) p: vec3f,
  @location(1) d: f32,   // the depth of water under a sheet (m); on a cascade -1 less how far down it (0 lip .. 1 foot)
}

// the bible's pool teal (#4FA3C2), linear: the colour the water scatters back where it's deep
const POOL_TEAL = vec3f(0.078, 0.366, 0.539);
// a cascade's water: white with a breath of teal
const FALL = vec3f(0.72, 0.86, 0.88);

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let v = verts[vi];
  var o: VOut;
  o.pos = frame.viewProj * vec4f(v.xyz, 1.0);
  o.p = v.xyz;
  o.d = v.w;
  return o;
}

// the light falling on the water from above: the sky's and the sun's (in its shadow or not)
fn lightOn(p: vec3f, n: vec3f) -> vec3f {
  let l = world.sunDir;
  return skyAmbient(n) + sunLight(p) * sunShadow(p, n) * saturate(dot(n, l)) / PI;
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let p = i.p;
  let v = normalize(frame.camPos - p);
  let t = world.site.z;
  if (i.d < 0.0) {
    // a cascade: streaks running down it, each its own speed; thin at the lip, thicker as it falls, spray at its foot
    let down = saturate(-1.0 - i.d);
    let u = (p.x + p.z) * 2.3;
    let s = noise2(vec2f(u, p.y * 0.9 + t * 2.6)) * 0.6 + noise2(vec2f(u * 2.7, p.y * 1.7 + t * 4.1)) * 0.4;
    let streak = smoothstep(0.35, 0.8, s);
    let a = (0.3 + 0.5 * streak) * smoothstep(0.0, 0.08, down) * (1.0 - 0.6 * smoothstep(0.75, 1.0, down));
    let c = FALL * (0.75 + 0.35 * streak) * lightOn(p, vec3f(0.0, 0.6, 0.8)) * 0.9;
    return vec4f(applyAerial(c, p) * a, a);
  }
  // a breeze's ripple on the sheet
  let g = vec2f(noise2(p.xz * 1.7 + vec2f(t * 0.6, t * 0.4)), noise2(p.xz * 1.9 - vec2f(t * 0.5, -t * 0.7))) - 0.5;
  let n = normalize(vec3f(g.x * 0.12, 1.0, g.y * 0.12));
  let nv = saturate(dot(n, v));
  let fres = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  let r = reflect(-v, n);
  let sky = skyRadiance(normalize(vec3f(r.x, max(r.y, 0.02), r.z)));
  let l = world.sunDir;
  let glint = sunLight(p) * sunShadow(p, vec3f(0.0, 1.0, 0.0)) * ggx(n, v, l, 0.08, vec3f(0.02));
  // the water's own colour (the light it scatters back), more of it the deeper; the floor through it where it's
  // shallow
  let thick = 1.0 - exp(-max(i.d, 0.05) * 3.0);
  let body = POOL_TEAL * lightOn(p, vec3f(0.0, 1.0, 0.0)) * 0.85;
  let a = saturate(mix(0.3 + 0.55 * thick, 1.0, fres));
  let c = body * (a - fres * a) + sky * fres + glint;
  return vec4f(applyAerial(c, p), a);
}
