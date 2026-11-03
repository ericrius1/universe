// The builders' architecture (arch.ts draws it: the city, the temple and its gardens): each part one mesh in world
// metres cut into pieces on a lattice (chunks.ts), every vertex with its material, tint, ambient, glow and the night's
// light baked into it (bake.ts). Lit as every lit thing in the world is (world.wgsl): the key light and its shadow, the
// sky's light (darker in the builder's creases), the warm canyon floor's bounce, the key's highlight and the sky's
// reflection on what's smooth (gold, glaze, glass), the dynamic lamps (Iroh's fire), the air between. Painted, never
// inked: each material's texture at its real size (or fitted whole to each face: the lavender panels, the teal
// friezes), striped cloth, glazing bars on every pane, a slow hand-painted wander in every colour, and shade leaning
// violet (the bible's first rule). At night the lights the builders placed pool on the streets and walls round every lantern and window, the
// windows, doorways and lanterns themselves glow, and the braziers, once lit, flicker.
#include "./../world/world.wgsl"

struct MatU {
  base: vec4f,   // rgb its colour (linear), w its roughness
  tex: vec4f,    // x its texture's layer (-1 none), y the texture's size on the surface (m), z its own colours (1) or the
                 // base colour with its detail (0), w how strongly the texture shows
  look: vec4f,   // x metalness, y a dielectric's reflectance, z the painted wander, w the uv mapping (0 by the metre,
                 // 1 a panel per face, 2 a frieze band, 3 striped cloth, 4 a window pane)
  glow: vec4f,   // rgb the light it gives when it glows (linear), w how much of its own colour shows in that light
}
struct ArchU {
  mats: array<MatU, 18>,
  night: vec4f,  // x the lamps' light on screen per candela at 1 m, y the exposure it's held at (darker nights: no
                 // brighter on screen), z the glows' strength, w the lights on (-1: by the sun)
  look: vec4f,   // x the shade's lean to violet, y the painted wander, z a debug view (0 none, 1 the pieces, 2 the night's
                 // light alone, 3 the albedo, 4 the normals), w the canyon floor's bounce
}
struct Chunk { o: vec4f }   // a piece's lattice: xyz its origin (world m), w its step (m)

@group(2) @binding(0) var<storage, read> chunks: array<Chunk>;
@group(2) @binding(1) var<uniform> AU: ArchU;
@group(2) @binding(2) var matTex: texture_2d_array<f32>;
@group(2) @binding(3) var<storage, read> fires: array<vec4f>;   // per fire: rgb its colour, w how lit (0 out .. 1)

const LUMA = vec3f(0.2126, 0.7152, 0.0722);
// the shade's light: lavender, at unit luminance; and the violet a colour is glazed toward in the shade (blue over red:
// the red plaster in shade goes maroon to violet, never crimson)
const VIOLET = vec3f(1.04, 0.9, 1.58);
const GLAZE = vec3f(0.96, 0.96, 1.42);
// chunks.ts RGBM_RANGE
const RGBM_RANGE = 4096.0;

struct VIn {
  @builtin(instance_index) piece: u32,
  @location(0) q: vec4u,        // the lattice position; w the material | the glow << 8
  @location(1) oct: vec2f,      // the normal, octahedral
  @location(2) uv: vec2f,
  @location(3) tint: vec4f,     // rgb the tint / 2, a the ambient
  @location(4) night: vec4f,    // the night's light, RGBM
  @location(5) fire: u32,       // the nearest fire's index (0xffff none) | the fires' strength (a half, its sign set on
                                // the fire's own body) << 16
}
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) p: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,
  @location(3) @interpolate(perspective, centroid) tint: vec4f,
  // rgb the baked lamps' light now (irradiance: on, held, flickering), a how far its glow is on (the night's; a fire's
  // body: its fire). Taken at the centroid of the samples a triangle covers: the light falls off steeply across the
  // refined triangles round a lamp, and read at the centre of a pixel the triangle only grazes it would be carried on
  // past the triangle's edge, below zero
  @location(4) @interpolate(perspective, centroid) lamp: vec4f,
  @location(5) @interpolate(flat) id: vec4u,      // the material, the glow (0..255), the piece
}

fn latticePos(piece: u32, q: vec3u) -> vec3f {
  let c = chunks[piece].o;
  return c.xyz + vec3f(q) * c.w;
}

fn octNormal(e: vec2f) -> vec3f {
  var n = vec3f(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
  let t = max(-n.z, 0.0);
  n.x += select(t, -t, n.x >= 0.0);
  n.y += select(t, -t, n.y >= 0.0);
  return normalize(n);
}

// the lights on: from as the sun nears the horizon at dusk till it's back over it at dawn
fn lightsOn() -> f32 {
  if (AU.night.w >= 0.0) { return AU.night.w; }
  return smoothstep(0.06, -0.08, world.sunTrue.y);
}

// a lamp's light (authored on screen) in the scene: held at the night's exposure, so a moonlit night's lanterns read as a
// dark night's do, and dusk's (a brighter scene, the eye less open) are fainter
fn held() -> f32 {
  let e = max(world.exposure, 1e-6);
  return min(e, AU.night.y) / (AU.night.y * e);
}

@vertex fn vs(v: VIn) -> VOut {
  let p = latticePos(v.piece, v.q.xyz);
  var o: VOut;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.p = p;
  o.n = octNormal(v.oct);
  o.uv = v.uv;
  o.tint = vec4f(v.tint.rgb * (255.0 / 128.0), v.tint.a);
  // the baked lamps: the night's when they're on; the fires as lit, flickering together
  let on = lightsOn();
  var lamp = v.night.rgb * (v.night.a * v.night.a * RGBM_RANGE) * on;
  var gate = on;
  let fi = v.fire & 0xffffu;
  if (fi != 0xffffu) {
    let f = fires[fi];
    let t = world.site.z;
    let flick = 0.72 + 0.28 * noise2(vec2f(t * 6.5, f32(fi) * 7.31)) + 0.08 * sin(t * 23.0 + f32(fi));
    lamp += f.rgb * f.w * unpack2x16float(v.fire & 0x7fffffffu).y * flick;
    if ((v.fire >> 31u) == 1u) { gate = f.w * flick; }
  }
  o.lamp = vec4f(lamp * AU.night.x * held(), gate);
  o.id = vec4u(v.q.w & 0xffu, v.q.w >> 8u, v.piece, 0u);
  return o;
}

@vertex fn vsShadow(@builtin(instance_index) piece: u32, @location(0) q: vec4u) -> @builtin(position) vec4f {
  return frame.viewProj * vec4f(latticePos(piece, q.xyz), 1.0);
}

// the slow wander a painter's colour has: a broad drift of value and warmth over tens of metres, a smaller one over a
// few (each material its own)
fn wander(p: vec3f, k: f32, seed: f32) -> vec3f {
  if (k <= 0.0) { return vec3f(1.0); }
  let q = p.xz + vec2f(p.y * 0.61, -p.y * 0.37);
  let a = fbm2(q * 0.035 + vec2f(seed * 17.3, seed * 5.1), 3) - 0.44;
  let b = noise2(q * 0.27 + vec2f(seed * 3.3, 11.0)) - 0.5;
  let val = 1.0 + (a * 0.3 + b * 0.12) * k;
  return val * vec3f(1.0 + a * 0.12 * k, 1.0, 1.0 - a * 0.16 * k);
}

// awnings' and banners' cloth: stripes across u, the tint's colour and a cream (a teal on cream cloth), the weave in it
fn clothOf(uv: vec2f, tint: vec3f, fw: f32, base: vec3f) -> vec3f {
  let hi = max(tint.r, max(tint.g, tint.b));
  let sat = (hi - min(tint.r, min(tint.g, tint.b))) / max(hi, 1e-3);
  let alt = mix(vec3f(0.035, 0.26, 0.24), vec3f(0.8, 0.71, 0.52), smoothstep(0.18, 0.42, sat));
  let x = uv.x / 0.6;
  let e = max(fw / 0.6, 1e-4);
  let s = smoothstep(0.25 - e, 0.25 + e, abs(fract(x) - 0.5));
  let weave = 0.92 + 0.08 * noise2(uv * vec2f(43.0, 7.0));
  return mix(base * tint, alt, s) * weave;
}

// a window pane (uv 0..1 over it): x its glazing bars (a cross: one upright, one transom above the middle), y the
// light of the room behind it, brightest low in the middle
fn paneOf(uv: vec2f, fw: vec2f) -> vec2f {
  let ex = max(fw, vec2f(1e-4));
  let up = 1.0 - smoothstep(0.035 - ex.x, 0.035 + ex.x, abs(uv.x - 0.5));
  let across = 1.0 - smoothstep(0.03 - ex.y, 0.03 + ex.y, abs(uv.y - 0.64));
  let rim = 1.0 - smoothstep(0.0, 0.05 + ex.x, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  let fall = (0.7 + 0.45 * (1.0 - uv.y)) * (1.0 - 0.35 * smoothstep(0.2, 0.5, abs(uv.x - 0.5)));
  return vec2f(max(max(up, across), rim * 0.8), fall);
}

// what a smooth surface sees in a direction: the sky over the horizon, the warm canyon floor in the light under it
fn envOf(r: vec3f, sunE: vec3f) -> vec3f {
  let sky = skyRadiance(normalize(vec3f(r.x, max(r.y, 0.02), r.z)));
  let ground = vec3f(0.42, 0.21, 0.12) * (sunE * max(world.sunDir.y, 0.0) / PI + skyAmbient(vec3f(0.0, 1.0, 0.0)));
  return mix(ground, sky, smoothstep(-0.15, 0.05, r.y));
}

fn pieceColour(k: u32) -> vec3f {
  let h = hashU(k * 2654435761u + 17u);
  return vec3f(f32(h & 255u), f32((h >> 8u) & 255u), f32((h >> 16u) & 255u)) / 255.0 * 0.8 + 0.1;
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let mat = AU.mats[min(i.id.x, 17u)];
  let p = i.p;
  let toCam = frame.camPos - p;
  let dist = length(toCam);
  let v = toCam / max(dist, 1e-4);
  let n = normalize(i.n);
  // the texture: by the metre, or a whole panel or frieze per uv unit; the picture upright
  let map = i32(mat.look.w);
  let layer = i32(mat.tex.x);
  var tuv = select(i.uv / max(mat.tex.y, 1e-3), i.uv, map == 1 || map == 2);
  tuv.y = -tuv.y;
  let texel = textureSample(matTex, samp_repeat, tuv, max(layer, 0)).rgb;
  let mean = textureSampleLevel(matTex, samp_repeat, vec2f(0.5), max(layer, 0), 12.0).rgb;
  let fw = fwidth(i.uv);

  // its colour: the texture's own, or the base colour with the texture's light and dark; the builder's tint; the wander
  var albedo = mat.base.rgb;
  if (layer >= 0) {
    let own = mix(mean, texel, mat.tex.w) * mat.base.rgb;
    let detail = mix(1.0, dot(texel, LUMA) / max(dot(mean, LUMA), 1e-4), mat.tex.w);
    albedo = mix(mat.base.rgb * detail, own, mat.tex.z);
  }
  if (map == 3) { albedo = clothOf(i.uv, i.tint.rgb, fw.x, mat.base.rgb); } else { albedo *= i.tint.rgb; }
  // a window's pane: its glazing bars (a cross, cream-painted wood), the light inside falling off toward its top and
  // its sides (x the bars, y the light's fall)
  var pane = vec2f(0.0, 1.0);
  if (map == 4 && i.uv.x > -0.5) {
    pane = paneOf(i.uv, fw);
    albedo = mix(albedo, vec3f(0.42, 0.34, 0.24), pane.x);
  }
  albedo = clamp(albedo * wander(p, mat.look.z * AU.look.y, f32(i.id.x)), vec3f(0.0), vec3f(0.92));
  let ao = i.tint.a;

  // the key light and its shadow
  let l = world.sunDir;
  let ndl = dot(n, l);
  var vis = 0.0;
  if (ndl > 0.0) { vis = sunShadow(p, n); }
  let sunE = sunLight(p);
  let key = sunE * vis;
  let lit = saturate(ndl) * vis;
  // the shade (what the key misses, by day, and the creases): the sky's light in it turns lavender at its own
  // brightness and the colour it falls on is glazed toward violet at its own value (maroon-violet on the red stone,
  // lavender on the cream: never a grey), and the sunlit canyon floor bounces its warm stone up into whatever faces
  // down or sideways
  let day = saturate(world.sunTrue.y * 5.0 + 0.25);
  let shade = saturate(1.0 - smoothstep(0.0, 0.35, lit) + (1.0 - ao) * 0.5) * day;
  let skyE = skyAmbient(n);
  let sky = mix(skyE, dot(skyE, LUMA) * VIOLET, shade * AU.look.x) * mix(0.25, 1.0, ao);
  let bounce = sunE * max(l.y, 0.0) * vec3f(0.5, 0.25, 0.15) * (0.5 - 0.5 * n.y) * AU.look.w / PI;
  let metal = mat.look.x;
  let rough = max(mat.base.w, 0.05);
  let f0 = mix(vec3f(mat.look.y), albedo, metal);
  let lamp = max(i.lamp.rgb, vec3f(0.0));
  let lightE = key * saturate(ndl) * mix(1.0, ao, 0.35) / PI + outdoorLamps(p, n) / PI + lamp / PI;
  let shaded = mix(albedo, dot(albedo, LUMA) * GLAZE, 0.4 * shade * AU.look.x);
  var c = (albedo * lightE + shaded * (sky + bounce * mix(0.4, 1.0, ao))) * (1.0 - metal);
  // (a metal's lamps: gold leaf is rough enough that the lamps' light round it comes back off it in its own colour)
  c += f0 * (lamp + outdoorLamps(p, n)) / PI * metal;
  // the key's highlight; the sky's reflection on what's smooth (metal shows it in its own colour: gold stays gold under
  // a teal sky)
  c += key * ggx(n, v, l, rough, f0);
  if (rough < 0.75) {
    let nv = saturate(dot(n, v));
    var env = envOf(reflect(-v, n), sunE);
    env = mix(env, vec3f(dot(env, LUMA)), metal);
    let F = f0 + (max(vec3f(1.0 - rough), f0) - f0) * pow(1.0 - nv, 5.0);
    c += env * F * (1.0 - rough) * mix(0.3, 1.0, ao) * (1.0 - pane.x);
  }
  // its own glow at night: a window's warm light, a doorway's, a lantern's paper lit through (a brazier's coals while
  // it burns)
  let g = f32(i.id.y) / 255.0;
  if (g > 0.0) {
    let own = mix(i.tint.rgb, albedo * 2.2, mat.glow.w);
    c += mat.glow.rgb * own * g * i.lamp.a * AU.night.z * held() * pane.y * (1.0 - pane.x);
  }

  let dbg = i32(AU.look.z);
  let ex = max(world.exposure, 1e-6);
  if (dbg == 1) { return vec4f(pieceColour(i.id.z) * (0.45 + 0.55 * saturate(dot(n, normalize(vec3f(0.3, 1.0, 0.4))))) * 0.6 / ex, 1.0); }
  if (dbg == 2) { c = vec3f(0.5) * (lamp / PI + vec3f(0.02 / ex)); }
  if (dbg == 3) { return vec4f(albedo * 0.7 / ex, 1.0); }
  if (dbg == 4) { return vec4f((n * 0.5 + 0.5) * 0.6 / ex, 1.0); }

  c = wetLook(c, p, n, v, vis, dist, 0.0);
  return vec4f(applyAerial(c, p), 1.0);
}
