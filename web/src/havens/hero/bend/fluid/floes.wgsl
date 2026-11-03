// Ice floes frozen onto the water (floes.ts), ported from the waterbending app: irregular slabs (instanced radial
// meshes: a top fan and its sides) with a frosted top, cracks, a wind-dusted rim of snow-ice and translucent blue-green
// sides. Each floe sits at its own water's level (this world's lakes and pools are at many levels); where the shore
// rises out of that water the slab ends, ragged.
#include "./../../../world/world.wgsl"
#include "./common.wgsl"

struct Floe { a: vec4f, b: vec4f }  // a: x, z, radius, seed; b: x the water's level
@group(2) @binding(0) var<storage, read> FL: array<Floe>;

struct VO {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) @interpolate(flat) seed: f32,
  @location(3) rim: f32,
  @location(4) @interpolate(flat) level: f32,
}

const SEG: u32 = 40u;

fn outline(a: f32, seed: f32) -> f32 {
  return 1.0 + 0.12 * sin(a * 3.0 + seed * 7.0) + 0.07 * sin(a * 7.0 + seed * 3.0) + 0.04 * sin(a * 13.0 + seed * 11.0);
}

fn floeVertex(vi: u32, ii: u32) -> VO {
  let f = FL[ii].a;
  let level = FL[ii].b.x;
  // triangle list: top fan (SEG tris) + side quads (SEG * 2 tris)
  let tri = vi / 3u;
  let k = vi % 3u;
  var a = 0.0;
  var ring = 0.0;
  var y = 0.0;
  var nrm = vec3f(0.0, 1.0, 0.0);
  let top = 0.12;
  let bot = -0.1;
  if (tri < SEG) {
    let s = tri;
    if (k == 0u) { ring = 0.0; a = 0.0; } else { ring = 1.0; a = f32(s + k - 1u) / f32(SEG) * TAU; }
    y = top;
  } else {
    let j = vi - SEG * 3u;
    let s = j / 6u;
    var offs = array<vec2u, 6>(vec2u(0u, 0u), vec2u(0u, 1u), vec2u(1u, 0u), vec2u(1u, 0u), vec2u(0u, 1u), vec2u(1u, 1u));
    let c = offs[j % 6u];
    a = f32(s + c.x) / f32(SEG) * TAU;
    ring = 1.0;
    y = select(top, bot, c.y == 1u);
    nrm = vec3f(cos(a), 0.0, sin(a));
  }
  let r = f.z * outline(a, f.w) * ring;
  let lp = vec2f(cos(a), sin(a)) * r;
  // the top domes slightly and dips at the rim
  var yy = y;
  if (y == top) { yy = top - (1.0 - ring) * -0.02 - ring * 0.03; }
  var o: VO;
  o.wp = vec3f(f.x + lp.x, level + yy, f.y + lp.y);
  o.n = nrm;
  o.seed = f.w;
  o.rim = ring;
  o.level = level;
  o.pos = frame.viewProj * vec4f(o.wp, 1.0);
  return o;
}

@vertex
fn vsFloe(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO { return floeVertex(vi, ii); }
@vertex
fn vsFloeShadow(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  return floeVertex(vi, ii).pos;
}

@fragment
fn fsFloe(in: VO) -> @location(0) vec4f {
  let wp = in.wp;
  // ice only forms on the water: where the shore rises above it the slab ends (ragged, like the frozen edge)
  let above = terrainHeight(wp.xz) - in.level;
  if (above > 0.04 + 0.06 * vnoise(wp.xz * 5.0)) { discard; }
  var n = normalize(in.n);
  let V = normalize(frame.camPos - wp);
  let side = 1.0 - abs(n.y);
  // cracks: voronoi edges on the top
  let vor = voronoi(wp.xz * (1.1 + 0.9 * fract(in.seed * 7.3)) + in.seed * 13.0);
  let crack = smoothstep(0.05, 0.0, vor.y - vor.x) * (1.0 - side);
  let fine = voronoi(wp.xz * 6.0 + in.seed * 5.0);
  let crack2 = smoothstep(0.035, 0.0, fine.y - fine.x) * 0.5 * (1.0 - side);
  // frost / snow-ice rim
  let frost = smoothstep(0.55, 1.0, in.rim) * 0.6 + fbm(wp.xz * 3.0, 3) * 0.4;
  let bump = vec3f(vnoise(wp.xz * 7.0) - 0.5, 0.0, vnoise(wp.xz * 7.0 + 3.1) - 0.5) * 0.25 * (1.0 - side);
  n = normalize(n + bump);
  let L = world.sunDir;
  // the key light (irradiance / PI) through the cascades, the sky's light
  let key = sunLight(wp) / PI;
  let sh = sunShadow(wp, n);
  let nl = max(dot(n, L), 0.0);
  let amb = skyAmbient(n);
  // clear blue-green ice that lets the dark water show through, whitened by frost and cracks
  let deep = vec3f(0.06, 0.2, 0.24);
  let frostC = vec3f(0.78, 0.86, 0.92);
  var alb = mix(deep, frostC, sat(frost * 0.7 + crack * 0.8 + crack2));
  alb = mix(alb, vec3f(0.35, 0.6, 0.65), side * 0.7);
  var col = alb * (amb + key * nl * sh * 0.9);
  // subsurface: light through the sides and thin rim
  col += vec3f(0.2, 0.55, 0.6) * key * pow(sat(dot(-V, L)), 3.0) * (side + 0.3) * 0.6 * sh;
  let fres = fresnelSchlick(max(dot(n, V), 0.0), 0.02);
  let rd = reflect(-V, n);
  col = mix(col, skyRadiance(normalize(vec3f(rd.x, max(rd.y, 0.02), rd.z))), fres * (1.0 - frost * 0.6));
  col += key * ggxSpec(n, V, L, mix(0.05, 0.35, frost), 0.02) * nl * sh * PI;
  // sparkle
  let g = hash13(floor(wp * 55.0));
  col += key * step(0.992, g) * pow(sat(dot(rd, L)), 12.0) * 4.0 * sh;
  return vec4f(applyAerial(col, wp), 1.0);
}
