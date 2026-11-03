// The canyon's loose and standing stone (hoodoos, mushroom rocks, spires, arches, ledges, talus), painted rather than
// photographed, after boulder's sandstone() (redrocks/rocks.wgsl) in the art bible's palette. Each bed of a formation has
// its own colour, picked from its id the way the generator's preview picks it (tools/rocks/palette.ts): the soft beds
// among terracotta, burnt sienna and rose, the hard ledge-formers paler (a few toward cream, now and then a dark
// ironstone band), each a little darker at its foot where the next bed's contact runs. Over that the painterly textures,
// divided by their own mean so they add brushwork and not a second colour: the strata texture's thin laminae on the
// sides (projected in the rock's own metres, so a fallen block's laminae fall with it), the flutes texture's vertical
// streaks and desert varnish on steep faces, the sand texture as dust settled on what faces up and as a stain where the
// rock meets the ground. Light as the world lights everything (sunLight, sunShadow, skyAmbient, aerial perspective),
// with the look's three liberties: a soft-edged terminator that reads like a brush stroke, shade that leans violet,
// and the canyon's warm bounce lighting the undersides of ledges and caps from the sunlit floor.
#include "./../world/world.wgsl"
#include "./rockdata.wgsl"

struct RockU {
  tint: vec4f,     // rgb a multiplier over the palette; w how strongly the textures' brushwork shows (0..1)
  tile: vec4f,     // the textures' tile (m): x strata, y flutes, z sand; w the bump's strength
  shade: vec4f,    // rgb the lean of the shade (lavender); w the canyon's warm bounce
  look: vec4f,     // x varnish streaks, y dust on the tops, z how soft the terminator is, w the ground stain's height (m)
}
@group(2) @binding(3) var<uniform> RU: RockU;
@group(2) @binding(4) var strataTex: texture_2d<f32>;
@group(2) @binding(5) var flutesTex: texture_2d<f32>;
@group(2) @binding(6) var sandTex: texture_2d<f32>;

// the textures' mean colours (linear), so dividing by them leaves the brushwork and not their colour
const STRATA_MEAN = vec3f(0.6432, 0.1607, 0.0689);
const FLUTES_MEAN = vec3f(0.4445, 0.1021, 0.039);
const SAND_MEAN = vec3f(0.8353, 0.3611, 0.1492);

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) n: vec3f,
  @location(2) obj: vec3f,      // the rock's own position, in metres (the textures' space)
  @location(3) on: vec3f,       // its normal in its own frame
  @location(4) bed: f32,
  @location(5) ao: f32,
  @location(6) @interpolate(flat) flags: u32,
  @location(7) @interpolate(flat) seed: f32,
  @location(8) groundY: f32,    // height above the ground it stands on (m)
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let v = rockVerts[vi];
  let k = rockInsts[rockVis[ii]];
  let p = vertPos(v);
  let s = instScale(k);
  let n = vertNormal(v);
  var o: VOut;
  o.world = instPoint(k, p);
  o.pos = frame.viewProj * vec4f(o.world, 1.0);
  o.n = normalize(instDir(k, n));
  o.obj = p * s;
  o.on = n;
  o.bed = vertBed(v);
  o.ao = vertAo(v);
  o.flags = vertFlags(v);
  o.seed = k.misc.x;
  o.groundY = o.world.y - k.misc.z;
  return o;
}

// a bed's colour (linear): among terracotta, burnt sienna and rose; a hard bed the same red a little paler toward peach
// (now and then cream, now and then a dark ironstone band), so the beds read as one stone layered, not as stripes; the
// same picks as tools/rocks/palette.ts
fn bedColor(id: u32, hard: bool) -> vec3f {
  let h = rkHash(id, 0x51ed270bu);
  let g = rkHash(id, 0x2c1b3c6du);
  let reds = array<vec3f, 4>(srgbToLinear3(vec3f(200.0, 100.0, 62.0) / 255.0), srgbToLinear3(vec3f(168.0, 74.0, 44.0) / 255.0),
    srgbToLinear3(vec3f(184.0, 85.0, 58.0) / 255.0), srgbToLinear3(vec3f(217.0, 138.0, 98.0) / 255.0));
  let a = u32(h * 4.0) % 4u;
  let base = mix(reds[a], reds[(a + 1u) % 4u], g * 0.5);
  if (!hard) { return base; }
  if (g > 0.9) { return base * vec3f(0.72, 0.62, 0.62); }
  if (g < 0.08) { return mix(base, srgbToLinear3(vec3f(240.0, 211.0, 164.0) / 255.0), 0.6); }
  return mix(base, srgbToLinear3(vec3f(232.0, 176.0, 138.0) / 255.0), 0.22 + 0.18 * h);
}

struct Surface { albedo: vec3f, relief: f32, rough: f32 }

// the rock's paint at a fragment: its bed's colour under the textures' brushwork, dust and stain, darkened in its
// hollows toward a violet maroon
fn surface(i: VOut, dist: f32) -> Surface {
  var s: Surface;
  let hard = (i.flags & 1u) != 0u;
  // (each instance shifts its beds' ids, so two copies of a prototype aren't painted alike)
  let id = u32(floor(i.bed)) + u32(i.seed * 13.0);
  let frac = fract(i.bed);
  var col = bedColor(id, hard) * RU.tint.rgb;
  // the bed's contact with the one below: a soft darker band at its foot
  col *= 0.86 + 0.14 * smoothstep(0.0, 0.18, frac);
  // the textures, projected in the rock's own metres: sides by the strata (and the flutes on the steep), tops by sand
  let q = i.obj;
  let w = pow(abs(normalize(i.on)), vec3f(4.0));
  let ws = w / max(w.x + w.y + w.z, 1e-4);
  let off = vec2f(i.seed * 17.0, i.seed * 5.0);
  let sx = textureSample(strataTex, samp_repeat, (vec2f(q.z, -q.y) + off) / RU.tile.x).rgb;
  let sz = textureSample(strataTex, samp_repeat, (vec2f(q.x, -q.y) + off) / RU.tile.x).rgb;
  let fx = textureSample(flutesTex, samp_repeat, (vec2f(q.z, -q.y) + off) / RU.tile.y).rgb;
  let fz = textureSample(flutesTex, samp_repeat, (vec2f(q.x, -q.y) + off) / RU.tile.y).rgb;
  let sy = textureSample(sandTex, samp_repeat, (q.xz + off) / RU.tile.z).rgb;
  let side = (sx * ws.x + sz * ws.z) / max(ws.x + ws.z, 1e-4) / STRATA_MEAN;
  let flute = (fx * ws.x + fz * ws.z) / max(ws.x + ws.z, 1e-4) / FLUTES_MEAN;
  let topT = sy / SAND_MEAN;
  // (the brushwork fades with distance into the bed's flat colour, as a painter would leave it)
  let far = smoothstep(120.0, 900.0, dist);
  let k = RU.tint.w * (1.0 - far * 0.7);
  let steep = 1.0 - smoothstep(0.35, 0.75, abs(i.on.y));
  var paint = mix(vec3f(1.0), side, k * (1.0 - ws.y));
  paint *= mix(vec3f(1.0), flute, RU.look.x * steep * select(0.75, 0.35, hard) * (1.0 - far));
  paint = mix(paint, topT, ws.y * k);
  col *= paint;
  // dust settled on what faces up, a sand stain up from the ground
  let up = smoothstep(0.55, 0.9, i.n.y);
  let dust = srgbToLinear3(vec3f(227.0, 165.0, 126.0) / 255.0) * mix(vec3f(1.0), topT, k);
  col = mix(col, dust, up * RU.look.y);
  let stain = 1.0 - smoothstep(0.0, RU.look.w, i.groundY);
  col = mix(col, srgbToLinear3(vec3f(232.0, 176.0, 138.0) / 255.0) * 0.9, stain * 0.45);
  // the hollows (under ledges and caps, between the beds) toward violet maroon
  col *= mix(vec3f(0.62, 0.5, 0.66), vec3f(1.0), smoothstep(0.15, 0.95, i.ao));
  s.albedo = clamp(col, vec3f(0.0), vec3f(0.92));
  // (relief: the brushwork's light and dark, and a groove along each bed's contact)
  s.relief = dot(paint, vec3f(0.2126, 0.7152, 0.0722)) - 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.08, frac));
  s.rough = mix(0.88, 0.7, up);
  return s;
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let p = i.world;
  let toCam = frame.camPos - p;
  let dist = length(toCam);
  let v = toCam / dist;
  let n0 = normalize(i.n);
  let s = surface(i, dist);
  // the brushwork's relief as a bump (surface gradient from the screen derivatives)
  let h = s.relief * RU.tile.w * (1.0 - smoothstep(30.0, 200.0, dist));
  let dpx = dpdx(p);
  let dpy = dpdy(p);
  let r1 = cross(dpy, n0);
  let r2 = cross(n0, dpx);
  let det = dot(dpx, r1);
  var n = normalize(abs(det) * n0 - sign(det) * (dpdx(h) * r1 + dpdy(h) * r2));
  if (abs(det) < 1e-9) { n = n0; }
  let l = world.sunDir;
  let ndl = dot(n, l);
  // a soft-edged terminator (the look's brush stroke) blended with the true falloff
  let lit = mix(saturate(ndl), smoothstep(-0.1, 0.3, ndl), RU.look.z);
  var vis = 1.0;
  if (ndl > -0.15) { vis = sunShadow(p, n0); }
  let key = sunLight(p);
  let sun = key * lit * vis;
  // shade: the sky's light leaning lavender, kept from the hollows by the ambient term
  let amb = skyAmbient(n) * RU.shade.rgb * mix(0.35, 1.0, i.ao);
  // the canyon's warm bounce: sunlit sand and stone below light what faces down and sideways
  let bounce = key * saturate(l.y) * saturate(0.35 - n.y * 0.65) * RU.shade.w * vec3f(0.95, 0.55, 0.32) * i.ao;
  var c = s.albedo * ((sun + bounce) / PI + amb + outdoorLamps(p, n) / PI);
  c += sun * ggx(n, v, l, s.rough, vec3f(0.03)) * 0.5;
  return vec4f(applyAerial(c, p), 1.0);
}
