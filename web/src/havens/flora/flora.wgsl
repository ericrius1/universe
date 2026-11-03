// The gardens' plants, drawn (floracull.wgsl has already sorted the instances in reach into their species', variants'
// and levels' draws). Each vertex is placed by its instance (turned, scaled, a vine stretched to its drop) and moved
// by the wind in three tiers: the whole plant bending about its root by its height fraction, its branch swinging about
// the branch's pivot by its flex, its leaf fluttering along its normal, all under gust fronts carried downwind. Whoever
// walks through parts it, at their own height and as far as it gives. Then it's lit like the rest of the world: leaves,
// petals and bracts two-sided and translucent against the sun, pots, pads and fruit glossy, the sky's ambient, the
// lamps by night, the air's haze over it. Fire burns it (the MARKS HOOK below): blackened, curled toward its branches
// and shrunk toward its root, embers glowing, then grown back pale and fresh over minutes. Each level of detail
// crossfades with the next inside each pixel's samples, so nothing pops.
#include "./../world/world.wgsl"
#include "./floradata.wgsl"

@group(2) @binding(0) var<uniform> FU: FloraU;
@group(2) @binding(1) var<storage, read> species: array<FloraSp>;
@group(2) @binding(2) var<storage, read> instances: array<FloraInst>;
@group(2) @binding(3) var<storage, read> visible: array<vec2u>;   // per draw: instance, its share (8 bits) | incoming (bit 8)
@group(2) @binding(4) var<storage, read> verts: array<vec4u>;     // two per vertex (floradata.wgsl decodeVtx)

// ---- MARKS HOOK --------------------------------------------------------------------------------------------------------
// The world's surface marks (the marks track: scorch with its cooling embers, wet, frost) as fire left them at a point:
// char 0..1 (how blackened), ember 0..1 (how hot it still glows), age (seconds since it burnt). Until the marks include
// lands this says nothing is burnt. To wire it, #include the marks include above and make this body its lookup, e.g.
//   let m = marksAt(p, n); return Burn(m.char, m.ember, m.age);
// A plant answers it twice: once at its root (the whole plant curls and shrinks, and grows back over its species'
// burn.w seconds) and once at each vertex (where the fire touched, blackened).
struct Burn { char: f32, ember: f32, age: f32 }
fn burnAt(p: vec3f, n: vec3f) -> Burn { return Burn(0.0, 0.0, 1e9); }
// -----------------------------------------------------------------------------------------------------------------------

fn rotY(v: vec3f, c: f32, s: f32) -> vec3f { return vec3f(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }

// the gusts over a point (0..1): soft fronts of stronger air carried downwind at the wind's own speed, so a gust is
// seen crossing a terrace
fn gustAt(xz: vec2f) -> f32 {
  let dir = normalize(world.wind.xy + vec2f(1e-5, 0.0));
  let adv = xz - dir * world.site.z * max(world.wind.z, 0.5) * 0.9;
  return smoothstep(0.35, 0.8, noise2(adv / max(FU.wind.z, 1.0) + vec2f(13.7, 4.1))) * FU.wind.y;
}

// how burnt a plant is, as a whole (from its root) and how far grown back (0 none .. 1 all)
fn burntAt(p: vec3f, sp: FloraSp) -> vec2f {
  let b = burnAt(p, vec3f(0.0, 1.0, 0.0));
  let regrow = smoothstep(0.2, 1.0, b.age / max(sp.burn.w, 1.0));
  return vec2f(saturate(b.char * sp.burn.x) * (1.0 - regrow), regrow * step(0.02, b.char));
}

struct Placed { wp: vec3f, n: vec3f, v: Vtx, burnt: f32, regrow: f32 }

// a vertex placed in the world: burnt, scaled, bent by the wind, parted by a walker
fn place(vi: u32, inst: FloraInst, sp: FloraSp) -> Placed {
  var o: Placed;
  let v = decodeVtx(verts[vi * 2u], verts[vi * 2u + 1u]);
  o.v = v;
  let c = cos(inst.yaw);
  let s = sin(inst.yaw);
  let seed = fract(inst.pos.x * 0.1373 + inst.pos.z * 0.0717);
  let hangs = sp.form.y > 0.5;
  let woody = v.part == P_BARK || v.part == P_POT || v.part == P_SOIL;

  // ---- fire: leaves and petals curl in toward their branch and droop; the plant shrinks toward its root (or a vine
  // toward its wall top), then grows back
  let bs = burntAt(inst.pos + vec3f(0.0, select(0.3, -0.3, hangs), 0.0), sp);
  o.burnt = bs.x;
  o.regrow = bs.y;
  var p = v.p;
  if (!woody) {
    let curl = sp.burn.y * bs.x * (0.4 + 0.6 * v.flex);
    p = mix(p, v.pivot, curl * 0.35) - vec3f(0.0, curl * 0.08 * length(p - v.pivot), 0.0);
  }
  p *= 1.0 - sp.burn.z * bs.x * select(1.0, 0.25, woody);

  // ---- scaled into the plant's own frame (a vine's stretch draws its strands down)
  let k = vec3f(inst.scale, inst.scale * inst.stretch, inst.scale);
  let lp0 = p * k;
  let pv = v.pivot * k;
  let height = max(sp.form.w * inst.scale * inst.stretch, 0.05);

  // ---- the wind, in the plant's frame: the whole plant, its branch, its leaf
  let wl = rotY(vec3f(world.wind.x, 0.0, world.wind.y), c, -s);
  let speed = world.wind.z * FU.wind.x;
  let gust = gustAt(inst.pos.xz);
  let t = world.site.z;
  let ph = v.phase * 6.2831 + seed * 4.0;
  let swing = sin(t * 1.7 + ph) * 0.6 + sin(t * 2.9 + ph * 1.7) * 0.4;
  let side = vec3f(-wl.z, 0.0, wl.x);
  var off = wl * (v.hf * v.hf) * sp.wind.x * speed * (0.45 + 0.9 * gust) * (0.85 + 0.15 * sin(t * 1.3 + seed * 6.28)) * 0.012 * height;
  off += (wl * (0.55 + 0.45 * gust) + vec3f(0.0, 0.3, 0.0) * swing + side * 0.3 * swing) * v.flex * length(lp0 - pv) * sp.wind.y * speed * 0.03 * (0.5 + 0.5 * swing + 0.6 * gust);
  off += v.n * v.flutter * sp.wind.z * speed * 0.004 * sin(t * 6.2831 * sp.wind.w + ph * 5.0 + lp0.x * 3.0 + lp0.z * 2.3);
  // (what swings out comes down a little: the bend keeps its length)
  off.y -= dot(off.xz, off.xz) / max(2.0 * height, 0.1);
  // (a vine never swings into its wall: local -z)
  if (hangs) { off.z = max(off.z, -0.02); }
  let lp = lp0 + off;

  // ---- into the world, and parted by whoever walks through it (only what's at their height, as far as it gives)
  var wp = inst.pos + rotY(lp, c, s);
  let give = sp.form.x * max(v.hf, v.flex);
  if (give > 0.0) {
    for (var i = 0u; i < 4u; i++) {
      let q = FU.push[i];
      if (q.w <= 0.0) { continue; }
      let d = wp.xz - q.xz;
      let dist = length(d);
      let reach = q.w * (1.0 + 0.5 * v.hf);
      if (dist >= reach) { continue; }
      let fall = 1.0 - dist / reach;
      let atHeight = 1.0 - smoothstep(q.y + 0.3, q.y + 1.6, wp.y);
      let away = normalize(d + vec2f(1e-4, 0.0));
      wp += vec3f(away.x, -0.35, away.y) * fall * fall * atHeight * give * FU.pushK[i] * q.w * 0.6;
    }
  }
  o.wp = wp;
  o.n = normalize(rotY(v.n / k, c, s));
  return o;
}

// (what's interpolated is taken at the centroid of the samples a triangle covers: read at the centre of a pixel that a
// sliver only grazes — a cypress's tip, a blade, a petal edge-on — it was carried far past the triangle's corners, a
// colour or a haze many times any of theirs, and that one pixel, there for a frame as the plant swayed, the bloom
// spread into a ball of its colour)
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(perspective, centroid) wp: vec3f,
  @location(1) @interpolate(perspective, centroid) n: vec3f,
  @location(2) @interpolate(perspective, centroid) albedo: vec3f,
  @location(3) @interpolate(perspective, centroid) ao: f32,
  @location(4) @interpolate(flat) part: u32,
  @location(5) @interpolate(flat) fade: u32,
  @location(6) @interpolate(flat) look: vec4f,
  @location(7) @interpolate(perspective, centroid) ap: vec4f,
  @location(8) @interpolate(perspective, centroid) ember: f32,
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let vis = visible[ii];
  let inst = instances[vis.x];
  let sp = species[inst.id & 255u];
  let q = place(vi, inst, sp);
  var o: VOut;
  o.pos = frame.viewProj * vec4f(q.wp, 1.0);
  o.wp = q.wp;
  o.n = q.n;
  o.ao = q.v.ao;
  o.part = q.v.part;
  o.fade = vis.y;
  o.look = sp.look;
  o.ap = aerial(q.wp);

  // ---- its colour: petals and bracts take the instance's bloom; leaves its brightness
  let bloom = unpack4x8unorm(inst.bloom);
  var col = q.v.col;
  let part = q.v.part;
  if (part == P_PETAL || part == P_BRACT) { col *= srgbDecode(bloom.rgb); }
  else if (part != P_POT && part != P_SOIL && part != P_DISC && part != P_FRUIT) { col *= 0.5 + bloom.a; }
  // growing back: the new leaves pale and fresh for a while (the flowers simply come again)
  let leafy = part == P_LEAF || part == P_BLADE || part == P_NEEDLE || part == P_FROND || part == P_MASS || part == P_STEM || part == P_PAD;
  if (leafy) { col = mix(col, col * vec3f(1.25, 1.35, 0.7) + vec3f(0.02, 0.03, 0.0), q.regrow * (1.0 - q.regrow) * 3.0); }
  // fire: scorched brown, then char (where the fire touched it, or the whole plant once it's burnt through); embers
  let vb = burnAt(q.wp, q.n);
  let vchar = saturate(vb.char * sp.burn.x) * (1.0 - smoothstep(0.2, 1.0, vb.age / max(sp.burn.w, 1.0)));
  let ch = max(q.burnt, vchar);
  let scorch = mix(vec3f(0.16, 0.09, 0.035), vec3f(0.025, 0.02, 0.018), smoothstep(0.35, 0.9, ch));
  col = mix(col, select(scorch, scorch * 1.6, part == P_POT), smoothstep(0.0, 0.6, ch) * select(1.0, 0.5, part == P_POT));
  // (embers in specks along the charred parts, not the whole plant aglow)
  let speck = smoothstep(0.6, 0.85, noise2(q.wp.xz * 7.0 + q.wp.y * 5.0) * 0.65 + q.v.rnd * 0.35);
  o.ember = max(burnAt(inst.pos, vec3f(0.0, 1.0, 0.0)).ember * q.burnt, vb.ember) * sp.burn.x * step(0.05, ch) * speck;
  o.albedo = col;
  return o;
}

// ---- the levels' crossfade: each pixel's four samples ranked (the rank turned from pixel to pixel, refined by a 4x4
// Bayer: 64 levels); the outgoing level keeps the samples under its share, the incoming one exactly the rest, so the
// resolve blends them (one sample, no MSAA: the two swap at the middle of the band)
override SAMPLES: u32 = 4u;
const BAYER = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
fn coverMask(pix: vec2f, fade: u32) -> u32 {
  let f = f32(fade & 255u) / 255.0;
  let incoming = (fade & 256u) != 0u;
  let p = vec2u(pix) % vec2u(4u);
  let b = BAYER[p.y * 4u + p.x];
  if (SAMPLES == 1u) { return select(0u, 1u, select((f > 0.5), (f >= 0.5), incoming)); }
  let rot = (p.x * 3u + p.y) % 4u;
  var mask = 0u;
  for (var s = 0u; s < 4u; s++) {
    let u = (f32((s + rot) % 4u) * 16.0 + b + 0.5) / 64.0;
    if (select((u < f), (u >= 1.0 - f), incoming)) { mask |= 1u << s; }
  }
  return mask;
}

fn thinPart(part: u32) -> bool {
  return part == P_BLADE || part == P_LEAF || part == P_PETAL || part == P_BRACT || part == P_FROND || part == P_NEEDLE || part == P_STEM || part == P_PAD;
}

struct FOut { @location(0) color: vec4f, @builtin(sample_mask) mask: u32 }
@fragment fn fs(i: VOut, @builtin(front_facing) front: bool) -> FOut {
  let mask = coverMask(i.pos.xy, i.fade);
  if (mask == 0u) { discard; }
  var n = normalize(i.n);
  if (!front) { n = -n; }
  let v = normalize(frame.camPos - i.wp);
  let l = world.sunDir;
  let look = i.look;
  let thin = thinPart(i.part);
  let ao = mix(1.0, i.ao, look.z);
  let sunC = sunLight(i.wp);
  // (thin parts take the cheap shadow: their own detail hides its softness)
  var vis: f32;
  if (thin) { vis = sunShadowFast(i.wp, n); } else { vis = sunShadow(i.wp, n); }
  // a soft terminator (leaves are a volume, not a plane)
  let ndl = saturate((dot(n, l) + look.y) / (1.0 + look.y));
  var c = i.albedo * (sunC * vis * ndl / PI + skyAmbient(n) * ao + outdoorLampsBoth(i.wp, n) / PI);
  if (thin) {
    // the sun through the leaf toward the eye: its own colour, deepened by passing through it
    let back = pow(saturate(dot(-v, l)), 3.0) * look.x * FU.look.y;
    let through = 0.45 + 0.55 * saturate(dot(-n, l));
    c += sunC * vis * i.albedo * (0.6 + 0.4 * i.albedo) * back * through * 0.6;
  }
  // gloss: lotus pads' wax, glazed and bronze pots, fruit
  if (look.w > 0.0) { c += sunC * vis * ggx(n, v, l, mix(0.75, 0.2, look.w), vec3f(0.04)) * look.w * ao; }
  // the sky off the leaves' sheen (a few percent head-on, more at a graze): a dark cypress against the dusk or the night
  // sky reads as that sky deepened, blue-violet (ref 8), not a black cut-out
  let graze = 1.0 - saturate(abs(dot(n, v)));
  c += skyAmbient(reflect(-v, n)) * (0.05 + 0.3 * graze * graze * graze) * mix(0.6, 1.0, ao);
  c *= FU.look.x;
  c = c * i.ap.a + i.ap.rgb;
  // embers: on-screen colour, so they glow alike by day and by night
  c += vec3f(1.0, 0.32, 0.06) * i.ember * (0.65 + 0.35 * sin(world.site.z * 9.0 + i.wp.x * 3.1 + i.wp.z * 2.3)) / world.exposure;
  return FOut(vec4f(c, 1.0), mask);
}

// ---- the sun's shadow cascades: the same placement (the wind and the walkers move the shadows too); a crossfading
// level casts its share by a dither
struct SOut { @builtin(position) pos: vec4f, @location(0) @interpolate(flat) fade: u32 }
@vertex fn vsShadow(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SOut {
  let vis = visible[ii];
  let inst = instances[vis.x];
  let q = place(vi, inst, species[inst.id & 255u]);
  var o: SOut;
  o.pos = frame.viewProj * vec4f(q.wp, 1.0);
  o.fade = vis.y;
  return o;
}
@fragment fn fsShadow(i: SOut) {
  let f = f32(i.fade & 255u) / 255.0;
  let p = vec2u(i.pos.xy) % vec2u(4u);
  let u = (BAYER[p.y * 4u + p.x] + 0.5) / 16.0;
  if (select((u >= f), (u < 1.0 - f), (i.fade & 256u) != 0u)) { discard; }
}
