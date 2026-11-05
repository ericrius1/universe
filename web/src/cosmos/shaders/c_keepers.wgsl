// The keepers' bodies (levels/keepers.ts, beyond.ts): meshes in their world (cm), each rigid part — a head, a robed body,
// a palm — moved by its frame, the tubes of the limbs already where they are. Out: their light (alpha 1, so its 4×
// resolve is how much of a pixel they cover) and the inverse of their distance from the camera, the same way (the
// fullscreen pass lays the marbles, the sky and the threads round them by it: c_beyond.wgsl).
//
// Skin a deep violet that turns teal and rose at a glancing angle (thin-film, like a beetle's), lit by the two marbles
// they hold — ours, and the second keeper's — from below; red-violet where a thin edge has a light behind it; freckled
// with points of light along the cheekbones, the crest and the backs of the fingers, laid out as cells are; the tips of
// the fingers glowing with what they do. Eyes black glass with a galaxy for an iris. Robes of midnight silk with gold.
#include "c_bview.wgsl"
#include "noise.wgsl"

@group(2) @binding(1) var<storage, read> xf: array<vec4f>;
@group(2) @binding(2) var irisTex: texture_2d<f32>;
@group(2) @binding(3) var robeTex: texture_2d<f32>;
@group(2) @binding(4) var skyTex: texture_2d<f32>;

// keepers.ts KIND
const K_SKIN = 0u; const K_HEAD = 1u; const K_ROBE = 2u; const K_PALM = 3u; const K_SLEEVE = 4u; const K_TRIM = 5u; const K_FINGER = 6u;
// keepers.ts EYE_AT, EYE_SLANT, EYE_R
const EYE_AT = vec3f(2.85, 0.35, 4.25);
const EYE_SLANT = 0.36;
const EYE_R = vec3f(2.75, 1.5, 1.55);
const NEAR = 0.2;

struct VIn { @location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) uv: vec2f, @location(3) tag: u32 }
struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) nrm: vec3f,
  @location(2) uv: vec2f,
  @location(3) local: vec3f,
  @location(4) @interpolate(flat) kind: u32,
  @location(5) @interpolate(flat) part: u32,
  @location(6) @interpolate(flat) keeper: u32,
}
struct KOut { @location(0) col: vec4f, @location(1) dist: vec4f }
override ALPHA_TO_COVERAGE: bool = true;

@vertex fn vs(v: VIn) -> VOut {
  var o: VOut;
  let part = v.tag & 0xffffu;
  var w = v.pos; var n = v.nrm;
  if (part != 0xffffu) {
    let b = part * 4u;
    let O = xf[b].xyz; let X = xf[b + 1u].xyz; let Y = xf[b + 2u].xyz; let Z = xf[b + 3u].xyz;
    w = O + X * v.pos.x + Y * v.pos.y + Z * v.pos.z;
    n = X * v.nrm.x + Y * v.nrm.y + Z * v.nrm.z;
  }
  o.world = w; o.nrm = n; o.uv = v.uv; o.local = v.pos; o.kind = (v.tag >> 16u) & 0xffu; o.part = part;
  // (which keeper: a part's number says, a limb's tag)
  o.keeper = select(v.tag >> 24u, select(0u, 1u, part >= 4u), part != 0xffffu);
  // (reversed depth: NEAR / the distance along the view; the far plane at infinity)
  let r = w - V.eye;
  o.clip = vec4f(dot(r, V.right) / (V.tanHalf * V.aspect), dot(r, V.up) / V.tanHalf, NEAR, dot(r, V.fwd));
  return o;
}

// the light falling on a point from a marble (rgb, reach in w): soft, so the far side of a face isn't black
fn marbleLight(p: vec3f, c: vec3f, L: vec4f) -> vec4f {
  let d = c - p;
  let r2 = dot(d, d);
  return vec4f(normalize(d), 1.0 / (1.0 + r2 / (L.w * L.w * 0.35)));
}

struct Mat { albedo: vec3f, rough: f32, metal: f32, sheen: f32, trans: vec3f, emit: vec3f, irid: f32, gloss: f32 }

fn light(m: Mat, p: vec3f, n: vec3f, v: vec3f) -> vec3f {
  var c = vec3f(0.0);
  // (the four lights: the two marbles, the sky's brightest, the rim behind)
  for (var i = 0; i < 4; i++) {
    var l = V.key.xyz; var col = V.keyColor.rgb;
    if (i == 0) { let q = marbleLight(p, V.orb.xyz, V.orbLight); l = q.xyz; col = V.orbLight.rgb * q.w * 13.0; }
    else if (i == 1) { let q = marbleLight(p, V.orbB.xyz, V.orbBLight); l = q.xyz; col = V.orbBLight.rgb * q.w * 14.0; }
    else if (i == 2) { l = normalize(V.rim.xyz * vec3f(-1.0, 1.0, 1.0) + vec3f(0.0, 0.2, 0.0)); col = vec3f(0.85, 0.3, 0.75) * 1.7; }
    else { l = V.rim.xyz; col = V.rimColor.rgb * 3.0; }
    let nl = dot(n, l);
    // wrapped diffuse (skin and silk both let light round the terminator); skin's light comes back out a rose-violet
    // where it has gone round (what's under it, scattered)
    let wrap = select(0.1, 0.45, m.trans.r > 0.0);
    let diff = max((nl + wrap) / (1.0 + wrap), 0.0);
    let lam = max(nl, 0.0);
    let scatter = select(vec3f(0.0), (diff - lam) * vec3f(0.4, 0.14, 0.32) * 2.0, m.trans.r > 0.0);
    let h = normalize(l + v);
    let nh = max(dot(n, h), 0.0);
    let shin = mix(8.0, 180.0, m.gloss);
    let spec = pow(nh, shin) * (shin + 8.0) / 25.0 * mix(0.04, 1.0, m.metal);
    // light through a thin edge from behind it
    let through = pow(clamp(dot(v, -l), 0.0, 1.0), 3.0) * (1.0 - abs(nl)) * 1.6;
    c += col * (m.albedo * select(diff, lam, m.trans.r > 0.0) * (1.0 - m.metal) + scatter * m.albedo * 3.0 + spec * mix(vec3f(1.0), m.albedo, m.metal) + m.trans * through * 0.6);
  }
  // the sky's own light, from above and below
  let amb = mix(V.skyLow.rgb, V.skyTop.rgb, n.y * 0.5 + 0.5) * 0.35;
  c += amb * m.albedo * (1.0 - m.metal * 0.6);
  // silk's sheen at the edges; the thin-film colours of the skin there
  let fv = 1.0 - max(dot(n, v), 0.0);
  c += m.sheen * pow(fv, 3.0) * (V.rimColor.rgb * 1.2 + V.orbLight.rgb * 0.3);
  if (m.irid > 0.0) {
    let ph = fv * 2.4 + dot(n, vec3f(0.3, 0.5, 0.2));
    let film = 0.5 + 0.5 * cos(6.2831 * (ph + vec3f(0.0, 0.33, 0.67)));
    c += film * pow(fv, 4.0) * m.irid * (V.rimColor.rgb * 0.6 + V.orbLight.rgb * 0.15 + 0.015);
  }
  return c + m.emit;
}

// points of light in the skin, laid out as cells are: one at most to a cell, only some cells lit, where `mask` says
fn freckles(q: vec3f, mask: f32, t: f32) -> f32 {
  if (mask <= 0.01) { return 0.0; }
  let cl = cellular(q, 0.8);
  let on = step(0.55, cl.id.x);
  let tw = 0.65 + 0.35 * sin(t * (0.6 + cl.id.y * 1.4) + cl.id.z * 30.0);
  return on * mask * tw * exp(-cl.d1 * cl.d1 * 90.0);
}

@fragment fn fs(in: VOut, @builtin(front_facing) front: bool) -> KOut {
  let p = in.world;
  let v = normalize(V.eye - p);
  var n = normalize(in.nrm);
  // (two-sided: inside a sleeve, its lining)
  if (dot(n, v) < 0.0) { n = -n; }
  let t = V.time;
  // (the silk's coordinates and their rate across the screen, here where every fragment still takes the same path)
  let ruvRobe = vec2f(atan2(in.local.x, in.local.z) * 1.6, in.local.y * 0.08);
  let ruvSleeve = vec2f(in.uv.x * 2.5, in.uv.y * 2.0);
  let ruv = select(ruvSleeve, ruvRobe, in.kind == K_ROBE);
  // (the robe's seam behind, where atan2 wraps: its derivative taken on the unwrapped side)
  let ruv2 = select(ruvSleeve, vec2f(atan2(-in.local.x, -in.local.z) * 1.6, in.local.y * 0.08), in.kind == K_ROBE);
  // (a mip softer than the screen asks: its fine gold lines otherwise crawl as the body breathes)
  let gx = select(dpdx(ruv), dpdx(ruv2), length(dpdx(ruv)) > length(dpdx(ruv2)) + 0.5) * 2.2;
  let gy = select(dpdy(ruv), dpdy(ruv2), length(dpdy(ruv)) > length(dpdy(ruv2)) + 0.5) * 2.2;
  var m: Mat;
  m.albedo = select(vec3f(0.028, 0.028, 0.044), vec3f(0.018, 0.036, 0.04), in.keeper == 1u); m.rough = 0.5; m.metal = 0.0; m.sheen = 0.0; m.trans = vec3f(0.55, 0.12, 0.38) * 0.5;
  m.emit = vec3f(0.0); m.irid = 0.35; m.gloss = 0.62;
  let q = in.local;
  let kind = in.kind;
  var eye = false;
  if (kind == K_HEAD) {
    // the eyes: where the eye's own ellipsoid is
    let ax = abs(q.x);
    let ex = ax - EYE_AT.x; let ey = q.y - EYE_AT.y;
    let c = cos(EYE_SLANT); let s = sin(EYE_SLANT);
    let e = vec3f(ex * c + ey * s, -ex * s + ey * c, q.z - EYE_AT.z) / EYE_R;
    let e2 = vec3f(e.x, e.y, (q.z - EYE_AT.z - 0.32) / EYE_R.z);
    if (dot(e2, e2) < 1.08) {
      eye = true;
      // black glass, the iris a galaxy (the texture) looking out ahead, a little toward the middle
      // (black glass; the iris a galaxy, smaller than the eye, looking out a little toward the middle)
      let iuv = vec2f((e.x * sign(q.x) + 0.12) * 0.62, -e.y * 0.95) * 0.5 + 0.5;
      let ir = textureSampleLevel(irisTex, samp_linear, iuv, 0.0).rgb;
      let inIris = ss(1.0, 0.8, length(iuv - 0.5) * 2.0);
      m.albedo = vec3f(0.002);
      m.gloss = 1.0; m.metal = 0.0; m.irid = 0.0; m.trans = vec3f(0.0);
      m.emit = ir * inIris * 0.55 * (0.75 + 0.25 * sin(t * 0.7));
    } else {
      // the crest and the cheekbones freckled; a faint line of light along the crest's ridge
      let crest = ss(5.0, 9.5, q.y - q.z * 0.35) * ss(1.6, 0.2, ax);
      let cheek = exp(-pow((ax - 3.6) / 1.2, 2.0) - pow((q.y + 0.9) / 1.4, 2.0) - pow((q.z - 3.0) / 2.5, 2.0));
      let brow = exp(-pow((q.y - 2.6) / 0.8, 2.0)) * ss(5.5, 1.0, ax) * ss(2.0, 4.0, q.z);
      let f = freckles(q * 1.3, cheek * 1.4 + crest + brow * 0.7, t);
      // (and over the back of the skull, the walls between cells — as the tissue's, as the web's — faintly alight)
      let cl = cellular(q * 0.62, 0.9);
      let wall = exp(-pow((cl.d2 - cl.d1) * 9.0, 2.0)) * ss(-1.0, -5.0, q.z) * ss(-2.0, 3.0, q.y);
      let pulse = 0.6 + 0.4 * sin(t * 0.8 - length(q) * 0.5);
      let fc = select(vec3f(0.35, 0.95, 1.0), vec3f(1.0, 0.78, 0.35), in.keeper == 1u);
      m.emit = fc * f * 2.2 + vec3f(1.0, 0.75, 0.35) * crest * exp(-ax * ax * 6.0) * 0.15
        + fc * vec3f(0.85, 0.75, 1.0) * wall * 0.12 * pulse;
      m.trans = vec3f(0.6, 0.12, 0.42) * (0.4 + crest);
    }
  } else if (kind == K_FINGER) {
    // the backs of the fingers freckled in a row; the tips glowing
    let tip = ss(0.93, 1.0, in.uv.x);
    let row = exp(-pow((fract(in.uv.y + 0.25) - 0.5) / 0.09, 2.0));
    let f = freckles(vec3f(in.uv.x * 14.0, in.uv.y * 3.0, f32(in.part)), row, t);
    m.emit = select(vec3f(0.35, 0.95, 1.0), vec3f(1.0, 0.78, 0.35), in.keeper == 1u) * f * 1.6 + vec3f(0.75, 0.85, 1.0) * tip * tip * 0.9;
    m.trans = vec3f(0.75, 0.15, 0.45);
  } else if (kind == K_PALM || kind == K_SKIN) {
    m.trans = vec3f(0.5, 0.12, 0.38) * 0.6;
  } else if (kind == K_ROBE || kind == K_SLEEVE) {
    // midnight silk (the texture, laid on by the part's own coordinates; a sleeve's along and round it)
    var r = textureSampleGrad(robeTex, samp_repeat, ruv, gx, gy).rgb;
    // (the second keeper's dyed a deep teal, its gold left gold)
    let g0 = ss(0.12, 0.3, r.r - r.b);
    if (in.keeper == 1u) { r = mix(r * vec3f(0.35, 1.25, 1.05), r, g0); }
    // (its pattern held down: from close, a lace of gold lines all over reads as wallpaper)
    r = mix(vec3f(lum(r)) * vec3f(0.5, 0.45, 1.0) * 0.6, r, 0.55);
    m.albedo = r * 0.9 + select(vec3f(0.006, 0.006, 0.016), vec3f(0.004, 0.012, 0.012), in.keeper == 1u);
    // and woven through with the night: points of starlight, twinkling
    let sq = select(vec3f(in.uv.x * 40.0, in.uv.y * 9.0, f32(in.keeper) * 7.0), q * 0.9, kind == K_ROBE);
    let sc = floor(sq * 1.6);
    let sh = hash3i(vec3i(sc) + vec3i(i32(in.keeper) * 977));
    let sd = length(fract(sq * 1.6) - 0.5 - (sh - 0.5) * 0.7);
    let star = step(0.86, sh.x) * exp(-sd * sd * 600.0) * (0.5 + 0.5 * sin(t * (1.0 + sh.y * 2.0) + sh.z * 40.0));
    m.emit += mix(vec3f(0.7, 0.8, 1.0), vec3f(1.0, 0.85, 0.6), sh.y) * star * 1.4;
    m.irid = 0.0; m.trans = vec3f(0.0); m.sheen = 0.25; m.gloss = 0.3;
    // the gold in it shines as gold
    let gold = ss(0.12, 0.3, r.r - r.b);
    m.metal = gold; m.gloss = mix(0.3, 0.75, gold);
    if (kind == K_ROBE) {
      // the collar's gold edge, the band round the neck, the medallion over the heart (a spiral, as everything turns)
      let neck = length(vec2f(length(q.xz + vec2f(0.0, 0.6)) - 5.3, q.y - 10.4)) - 0.8;
      let med = max(length(q.xy - vec2f(0.0, 1.5)) - 2.5, abs(q.z - 8.3) - 0.45);
      let collarTop = ss(19.5, 22.5, q.y + q.z * 0.2) * step(8.5, q.y);
      var g = max(max(ss(0.25, 0.0, neck), ss(0.25, 0.0, med)), collarTop);
      if (med < 0.3) {
        let d = q.xy - vec2f(0.0, 1.5);
        let a = atan2(d.y, d.x); let rr = length(d);
        let arm = 0.5 + 0.5 * cos(a * 2.0 - log(rr + 0.05) * 5.0 - t * 0.2);
        m.emit = vec3f(1.0, 0.8, 0.45) * arm * ss(2.4, 0.3, rr) * 0.08;
      }
      if (g > 0.0) { m.albedo = mix(m.albedo, vec3f(0.95, 0.68, 0.3), g); m.metal = max(m.metal, g); m.gloss = mix(m.gloss, 0.8, g); }
    }
  } else if (kind == K_TRIM) {
    m.albedo = vec3f(0.95, 0.68, 0.3); m.metal = 1.0; m.gloss = 0.8; m.irid = 0.0; m.trans = vec3f(0.0);
  }
  // the robe gives out below the waist: thinning into sparks, then nothing (they stand on nothing at all)
  var cover = 1.0;
  if (kind == K_ROBE) {
    let h = q.y + 0.04 * sin(atan2(q.x, q.z) * 7.0) * 30.0;
    cover = ss(-78.0, -42.0, h);
    // (a mote to some cells of a fine lattice, round, as many as the robe has thinned)
    let dq = q * 1.3;
    let dh = hash3i(vec3i(floor(dq)));
    let dd = length(fract(dq) - 0.5 - (dh - 0.5) * 0.6);
    let mote = step(1.0 - 0.3 * (1.0 - cover), dh.x) * ss(-95.0, -50.0, h) * (1.0 - ss(0.12, 0.2, dd));
    m.emit += vec3f(0.55, 0.8, 1.0) * mote * 0.9 * (0.6 + 0.4 * sin(t * 2.0 + dh.y * 40.0));
    cover = max(cover, mote);
  }
  if (!eye && (kind == K_HEAD || kind == K_PALM || kind == K_SKIN || kind == K_FINGER)) {
    let sq = select(q, vec3f(in.uv.x * 30.0, in.uv.y * 6.0, f32(in.part) * 3.0), kind == K_FINGER || kind == K_SKIN);
    let cl = cellular(sq * 2.4, 0.85);
    let edge = ss(0.0, 0.25, cl.d2 - cl.d1);
    // (fine pebbling: each cell domed, the creases between them darker)
    let toC = (cl.c - sq * 2.4);
    let tg = toC - n * dot(toC, n);
    n = normalize(n - tg * (1.0 - edge) * 0.18);
    m.albedo *= mix(0.65, 1.0, edge);
  }
  var col = light(m, p, n, v);
  if (eye || m.metal > 0.5) {
    // what the glassy and the golden reflect: the sky
    let rdir = reflect(-v, n);
    let e = textureSampleLevel(skyTex, samp_repeat, equirect(rdir), 2.0).rgb * V.skyTop.w;
    let F = select(mix(0.04, 1.0, pow(1.0 - max(dot(n, v), 0.0), 5.0)), 1.0, m.metal > 0.5 && !eye);
    col += e * F * select(m.albedo * 1.5, vec3f(0.9), eye);
  }
  var o: KOut;
  let d = length(p - V.eye);
  if (!ALPHA_TO_COVERAGE && cover < hash3u(vec3u(vec2u(in.clip.xy), 3u)).x) { discard; }
  o.col = vec4f(col, cover);
  o.dist = vec4f(1.0 / d, 1.0, 0.0, cover);
  return o;
}
