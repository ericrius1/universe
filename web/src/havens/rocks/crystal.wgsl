// The crystals (ref 7): clear hexagonal prisms drawn opaque, their clearness painted in. A facet shows the sky by
// reflection (skyRadiance about its normal; the warm lit ground when it looks down), fresnel-weighted, with a stronger
// rim the way ref 7's crystals catch a light edge; through it, what lies behind the crystal along the refracted ray
// (the sky, or the sunlit ground below), tinted by the crystal's body colour by how far the ray travels inside it (the
// crystal as a cylinder round its axis, to its ends): teal where it is thin, blue where it is thick, deeper toward its
// buried root. Mixed with that, by how clear it is, each facet painted by its own light as ref 7 paints them (bright
// toward the sun, sky-coloured facing up, deep in shade), so the facets read one from the next; the sun shines
// through from behind, the facets flash where they mirror the sun, and at night it glows faintly from within, slowly
// pulsing, in the aurora's hues (tonight's green and its nitrogen fringe, or the bible's teal and violet when there is
// none), strongest in a grotto's crystals (the instance's glow). Emission is on-screen colour over world.exposure, as
// every glow in the world is.
#include "./../world/world.wgsl"
#include "./rockdata.wgsl"

struct CrystalU {
  core: vec4f,     // rgb thin crystal's colour (teal, linear); w how strongly the clear absorbs (per metre)
  deep: vec4f,     // rgb thick crystal's colour (blue); w the path (m) at which it is all deep
  glow: vec4f,     // x the night glow (on screen), y its pulse rate (cycles per s), z the facets' glints, w the rim's fresnel boost
  ground: vec4f,   // rgb the warm ground seen through and below (albedo, linear); w how clear (0 painted solid .. 1 clear)
}
// a crystal of a cluster, in its prototype's metres: its foot (xyz) and radius (w); its unit axis (xyz) and length (w)
struct CrystalRec { base: vec4f, axis: vec4f }
@group(2) @binding(3) var<uniform> CU: CrystalU;
@group(2) @binding(4) var<storage, read> crystalRecs: array<CrystalRec>;

struct COut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) n: vec3f,
  @location(2) t: f32,                              // how far along its crystal, root 0 .. apex 1
  @location(3) @interpolate(flat) base: vec3f,      // its crystal's foot (world)
  @location(4) @interpolate(flat) axis: vec4f,      // its crystal's axis (world, unit) and radius (m)
  @location(5) @interpolate(flat) misc: vec4f,      // x its crystal's seed, y the instance's glow, z its crystal's length (m)
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> COut {
  let v = rockVerts[vi];
  let k = rockInsts[rockVis[ii]];
  let s = instScale(k);
  let ci = v.b & 0xffffu;
  let rec = crystalRecs[ci];
  var o: COut;
  o.world = instPoint(k, vertPos(v));
  o.pos = frame.viewProj * vec4f(o.world, 1.0);
  o.n = normalize(instDir(k, vertNormal(v)));
  o.t = fract(vertBed(v));
  o.base = instPoint(k, rec.base.xyz);
  o.axis = vec4f(normalize(instDir(k, rec.axis.xyz)), rec.base.w * s);
  o.misc = vec4f(rkHash(ci, 0x2545f491u), k.misc.y, rec.axis.w * s, 0.0);
  return o;
}

// how far a ray from o (on the crystal's surface, heading in along d) runs inside it: out through the side of the
// cylinder round its axis, or out of an end, whichever comes first
fn throughCrystal(o: vec3f, d: vec3f, base: vec3f, a: vec3f, r: f32, len: f32) -> f32 {
  let w = o - base;
  let wa = dot(w, a);
  let da = dot(d, a);
  let wp = w - a * wa;
  let dp = d - a * da;
  let A = max(dot(dp, dp), 1e-6);
  let B = dot(wp, dp);
  let C = dot(wp, wp) - r * r;
  var t = (-B + sqrt(max(B * B - A * C, 0.0))) / A;
  if (da > 1e-4) { t = min(t, (len - wa) / da); } else if (da < -1e-4) { t = min(t, -wa / da); }
  return clamp(t, 0.0, 2.5 * r + 0.2 * len);
}

@fragment fn fs(i: COut) -> @location(0) vec4f {
  let p = i.world;
  let v = normalize(frame.camPos - p);
  let n = normalize(i.n);
  let l = world.sunDir;
  let nv = saturate(dot(n, v));
  let seed = i.misc.x;
  let key = sunLight(p);
  var vis = 1.0;
  if (dot(n, l) > -0.2) { vis = sunShadow(p, n); }
  // the warm ground round it, lit (what a downward look meets, through the crystal or in a facet)
  let groundLit = CU.ground.rgb * (key * saturate(l.y) * vis / PI + skyAmbient(vec3f(0.0, 1.0, 0.0)));
  // the body: teal where the path through is short, blue where it is long, a little different crystal to crystal,
  // frosted paler toward the tip
  let rd = refract(-v, n, 1.0 / 1.55);
  let path = throughCrystal(p, rd, i.base, i.axis.xyz, i.axis.w, i.misc.z);
  var body = mix(CU.core.rgb, CU.deep.rgb, saturate(path / CU.deep.w * 0.8 + (seed - 0.5) * 0.3));
  body = mix(body, vec3f(0.78, 0.93, 1.0), 0.3 * smoothstep(0.6, 1.0, i.t));
  // through it: what lies behind along the refracted ray, absorbed on the way (the reds first), seen past the far
  // facet the ray leaves by (the hexagon's sector at its exit: its own tone, and the edges between the inner facets
  // drawn in light), so the inside reads as cut crystal and shifts as you move
  let behind = select(groundLit, skyRadiance(rd), rd.y > 0.0);
  let a = i.axis.xyz;
  let e1 = normalize(cross(a, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(a.y) > 0.9)));
  let e2 = cross(a, e1);
  let wq = p + rd * path - i.base;
  let rq = wq - a * dot(wq, a);
  let ang = atan2(dot(rq, e2), dot(rq, e1)) / (PI / 3.0) + seed * 6.0;
  let sector = floor(ang);
  let mid = (sector + 0.5 - seed * 6.0) * (PI / 3.0);
  let nb = e1 * cos(mid) + e2 * sin(mid);
  let f = ang - sector;
  let innerEdge = 1.0 - smoothstep(0.0, 0.07, min(f, 1.0 - f));
  let farTone = 0.6 + 0.4 * saturate(dot(nb, l) * 0.5 + 0.5);
  let trans = behind * body * exp(-path * CU.core.w * (vec3f(1.0) - body)) * farTone + body * innerEdge * 0.25 * (key * saturate(l.y) / PI + skyAmbient(n));
  // the sun shining through it from behind
  let through = key * vis * pow(saturate(dot(-v, l)), 6.0) * body * 0.6;
  // each facet painted by its light, as ref 7 paints them: bright toward the sun, the sky's colour where it faces up,
  // deep in its shade
  let face = body * (key * saturate(dot(n, l)) * vis / PI + skyAmbient(n) * 1.2);
  // the facets' mirror: the sky (or the ground) about the normal, fresnel with a stronger rim
  let rv = reflect(-v, n);
  let refl = select(groundLit * 0.8, skyRadiance(rv), rv.y > -0.02);
  let fres = saturate(0.045 + 0.955 * pow(1.0 - nv, 5.0) + CU.glow.w * pow(1.0 - nv, 3.0));
  // glints: a facet turned to mirror the sun flashes; a broader sheen round it
  let glint = key * vis * (ggx(n, v, l, 0.06, vec3f(0.06)) + ggx(n, v, l, 0.22, vec3f(0.04)) * 0.5) * CU.glow.z;
  // deeper toward its buried root
  let root = mix(0.5, 1.0, smoothstep(0.0, 0.45, i.t));
  var c = mix(mix(face, trans + through, CU.ground.w), refl, fres) * root + glint;
  // at night, a faint inner glow in the aurora's hues, slowly pulsing, strongest in the thick of it and toward the tip
  let luma = vec3f(0.2126, 0.7152, 0.0722);
  let green = world.aurora1.rgb / max(dot(world.aurora1.rgb, luma), 1e-4);
  let fringe = world.aurora3.rgb / max(dot(world.aurora3.rgb, luma), 1e-4);
  let bible = mix(srgbToLinear3(vec3f(79.0, 224.0, 192.0) / 255.0), srgbToLinear3(vec3f(142.0, 92.0, 224.0) / 255.0), seed);
  let tonight = select(0.0, 0.8, world.aurora0.x > 0.0);
  let hue = mix(bible / max(dot(bible, luma), 1e-4), mix(green, fringe, seed * 0.7), tonight);
  let pulse = 0.65 + 0.35 * sin(6.2831853 * (frame.time * CU.glow.y + seed));
  let inner = (0.35 + 0.65 * saturate(path / max(i.axis.w, 1e-3) * 0.5)) * (0.4 + 0.6 * i.t);
  c += hue * (CU.glow.x * i.misc.y * world.sunTrue.w * pulse * inner) / max(world.exposure, 1e-6);
  return vec4f(applyAerial(c, p), 1.0);
}
