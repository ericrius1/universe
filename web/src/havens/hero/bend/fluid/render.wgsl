// Screen-space bent water (render.ts), ported from the waterbending app (after van der Laan et al. 2009, with the
// narrow-range filter of Truong & Yuksel 2018): particle spheres -> linear depth, additive thickness (+ ice / speed,
// mist / snow / glow), depth smoothing (smooth.wgsl), then a composite over the finished scene that refracts it (a
// copy of it), absorbs through the thickness, reflects the sky and the sun, whitens fast thin spray and turns frozen
// regions into faceted, frosted ice; the charge's light inside it (fsEnergy); its shadow, dithered sprites facing the
// light. Lit as this world lights everything — the key light through the cascades, the sky's irradiance and radiance,
// the air between — where the app had its own lighting block. The scene is behind it where the scene's distances
// (post/fx.ts sceneZ: the nearest of its four samples) are nearer.
#include "./../../../world/world.wgsl"
#include "weft/fullscreen"
#include "./common.wgsl"

struct FR {
  radius: f32, thickRadius: f32, iceRadius: f32, shardRadius: f32,
  absorb: vec4f,     // rgb absorption (1/m), w refraction strength
  tint: vec4f,       // in-scatter colour, w glow at night (moon)
  iceTint: vec4f,    // ice scatter colour, w frost
  params: vec4f,     // x filter radius (m), y depth threshold (m), z time (s), w its own light's scale (the app's sun is
                     // 20, this world's 1: the glow, spirit water and the charge are scaled by it)
  flow: vec4f,       // the light running along a form's lines: x on (0..1), y points a strand, z points in all, w strength
  shape: vec4f,      // x how much of the form is the vortex (its arms seven strands each), y held water's size, z water
                     // hurled at a mark (a torrent), w more of its thin-film colour
  spirit: vec4f,     // spirit water (drawn from a glowing pond): the light it holds, rgb, and how far it's spirit (w 0..1)
  energy: vec4f,     // its charge (energy.ts): x how charged (0..1), y the heart's phase (beats), z brightness
  ecen: vec4f,       // where the charge is: xyz, w its size (m)
  light: vec4f,      // the charge's light on the water: xyz where, w its reach (m; 0: none)
  lightC: vec4f,     // its colour x intensity (rgb), w its size (m)
  scale: vec4f,      // x the depth's resolution (a fraction of the render's), y the thickness's
}
@group(2) @binding(0) var<storage, read> PS: array<Particle>;
@group(2) @binding(1) var<uniform> R: FR;
@group(2) @binding(2) var sceneZ: texture_2d<f32>;   // the scene's distances along the view axis, four samples (1e9: sky)
@group(2) @binding(3) var fDepth: texture_2d<f32>;   // smoothed linear depth (x; 0: no water)
@group(2) @binding(4) var fThick: texture_2d<f32>;   // half res: thickness, ice*t, speed*t, shard*t
@group(2) @binding(5) var sceneC: texture_2d<f32>;   // the scene before the bent water (a copy of the HDR)
@group(2) @binding(6) var fMat: texture_2d<f32>;     // half res: mist*t, snow*t, glow*t

struct SpriteOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) center: vec3f, // view space
  @location(2) @interpolate(flat) rad: f32,
  @location(3) @interpolate(flat) attr: vec4f,  // ice, speed, phase, density
  @location(4) @interpolate(flat) mat: vec3f,   // what the water is made of: cloud mist, snow (fluid_sim.wgsl); its glow
}

// the scene's nearest distance at a full-resolution pixel
fn sceneNear(fc: vec2f) -> f32 {
  let z = textureLoad(sceneZ, vec2i(fc), 0);
  return min(min(z.x, z.y), min(z.z, z.w));
}

// a thin film's interference colour (after the jungle-bird session's Catching the Moon): a film 110..290 nm thick in
// slow drifting bands — a bubble's or an opal's play of colour, never thicker (past ~300 nm gold turns to a CG
// green-cyan fringe); grey removed for a hue to tint with
fn filmAt(fq: vec3f, cosT: f32, tm: f32) -> vec3f {
  let warp = vec3f(vnoise3(fq + 1.7), vnoise3(fq + 5.3), vnoise3(fq + 9.1)) - 0.5;
  let dnm = 200.0 + 90.0 * sin(6.0 * fbm3(fq * 0.8 + warp * 1.6, 3) + tm * 0.1);
  let nf = 1.38;
  let cosR = sqrt(max(0.0, 1.0 - (1.0 - cosT * cosT) / (nf * nf)));
  return 0.5 + 0.5 * cos(4.0 * PI * nf * dnm * cosR / vec3f(640.0, 540.0, 450.0));
}
fn filmHue(f: vec3f) -> vec3f { return clamp(0.5 + 1.4 * (f - dot(f, vec3f(1.0 / 3.0))), vec3f(0.0), vec3f(1.5)); }

// the charge's light (energy.ts) on a surface: irradiance / PI, wrapped a little so it reads on the shaded side (the
// app lit the water with all its point lights; this world's bent water has this one)
fn chargeLight(wp: vec3f, n: vec3f) -> vec3f {
  let reach = R.light.w;
  if (reach <= 0.0) { return vec3f(0.0); }
  let d = R.light.xyz - wp;
  let r2 = dot(d, d);
  if (r2 > reach * reach) { return vec3f(0.0); }
  let win = sq(clamp(1.0 - sq(r2 / (reach * reach)), 0.0, 1.0));
  let l = d * inverseSqrt(max(r2, 1e-6));
  return R.lightC.rgb * R.params.w * (max(dot(n, l), 0.0) * 0.85 + 0.15) * win / max(r2, max(0.2, R.lightC.w * R.lightC.w)) / PI;
}
// its glint in the glossy surface
fn chargeSpec(wp: vec3f, n: vec3f, v: vec3f, rough: f32) -> vec3f {
  let reach = R.light.w;
  let d = R.light.xyz - wp;
  let r2 = dot(d, d);
  if (reach <= 0.0 || r2 > reach * reach * 4.0) { return vec3f(0.0); }
  let a2 = max(rough * rough, 0.002);
  let l = d * inverseSqrt(max(r2, 1e-6));
  let h = normalize(l + v);
  let nh = max(dot(n, h), 0.0);
  let dd = nh * nh * (a2 - 1.0) + 1.0;
  let D = a2 / (PI * dd * dd);
  return R.lightC.rgb * R.params.w * min(D, 30.0) * max(dot(n, l), 0.0) * 0.004 / max(r2, max(0.5, R.lightC.w * R.lightC.w));
}

fn particleSprite(vi: u32, ii: u32, radScale: f32) -> SpriteOut {
  var o: SpriteOut;
  let p = PS[ii];
  let ph = u32(p.phase);
  let corner = vec2f(f32(vi & 1u), f32((vi >> 1u) & 1u)) * 2.0 - 1.0;
  if (ph == 0u) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }
  var rad = R.radius;
  if (ph == 2u || ph == 3u) { rad = R.iceRadius; }
  if (ph == 4u) { rad = R.shardRadius; }
  // isolated droplets (low density) render smaller
  let dens = p.c2.w;
  if (ph == 1u) { rad *= mix(0.6, 1.0, smoothstep(0.5, 2.5, dens)); }
  // thrown spray (tagged by the sim), and stray drops torn off the bent water (alone, low density): finer drops, flagged
  // as aerated (+40 on the speed channel) for the composite — not glass marbles
  // (stray: a handful of particles alone in the air — near the camera they read as glass marbles, bubble wrap)
  // (water hurled at a mark — a torrent in the air — is one big body of it: fuller, never spray)
  let hurled = ph == 1u && p.c1.w > -0.4 && p.c1.w < -0.1;
  let spray = ph == 1u && !hurled && (p.c1.w < -0.5 || (dens < 0.45 && p.c1.w < 0.5));
  if (spray) { rad *= 0.3 + 0.45 * hash1u(ii * 2654435761u); }
  if (hurled) { rad *= R.shape.z; }
  if (ph == 1u && p.c1.w > 0.5) { rad *= R.shape.y; }
  // (held water still on its way into the form she holds — alone, fast — is a fine streak too, though not white spray:
  // as little spheres they floated round her like bubble wrap)
  let streak = spray || (ph == 1u && p.c1.w > 0.5 && dens < 0.45 && length(p.vel) > 3.0);
  if (streak && !spray) { rad *= 0.45; }
  // (mist is fluffier than water: each particle a bigger, softer puff — where it's massed; a stray one is a thin wisp)
  let mist = select(0.0, matMist(p.ice), ph == 1u);
  let snow = select(0.0, matSnow(p.ice), ph == 1u);
  rad *= 1.0 + 0.8 * mist * smoothstep(0.8, 2.5, dens) + 0.15 * snow;
  // (mist that has strayed from the stream dissipates — it shrinks away to nothing — and stray snow is small flecks:
  // as puffs of their own they hung round her as soft discs)
  rad *= mix(1.0, smoothstep(0.45, 1.6, dens), mist) * mix(1.0, 0.45 + 0.55 * smoothstep(0.45, 1.6, dens), snow);
  if (rad < 0.002) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }
  // (mist's thickness splat no wider than its outline: each puff thins to nothing at its edge, no hard disc)
  rad *= mix(radScale, 1.05, mist);
  let vc = (frame.view * vec4f(p.pos, 1.0)).xyz;
  var vp = vc + vec3f(corner * rad, 0.0);
  if (streak) {
    // fast drops are seen as streaks (about a frame's motion blur): an ellipsoid stretched along the velocity across
    // the view, instead of a row of round beads
    let vv = (frame.view * vec4f(p.vel, 0.0)).xy;
    let L = min(length(vv) * 0.013, 0.28);
    let ax = select(vec2f(1.0, 0.0), normalize(vv), length(vv) > 1e-3);
    let ay = vec2f(-ax.y, ax.x);
    vp = vc + vec3f(ax * corner.x * (rad + L) + ay * corner.y * rad, 0.0);
  }
  o.pos = frame.proj * vec4f(vp, 1.0);
  o.uv = corner;
  o.center = vc;
  o.rad = rad;
  o.attr = vec4f(select(0.0, 1.0, ph >= 2u), length(p.vel) + select(0.0, 40.0, spray), f32(ph), dens);
  // the light running along a form she builds in flight (and the vortex): each held particle's own place on it — the
  // same as the sim gives it (fluid_sim.wgsl pathAt): its strand and how far along — and pulses travelling every line
  var glow = 0.0;
  if (R.flow.x > 0.001 && ph == 1u && p.c1.w > 0.5) {
    let u = f32(hashU(ii * 2654435761u + 17u) & 0xffffu) / 65535.0;
    let L = max(R.flow.y, 2.0);
    let ns = max(floor(R.flow.z / L), 1.0);
    let g = u * ns * (L - 1.0);
    let strand = min(floor(g / (L - 1.0)), ns - 1.0);
    let along = (g - strand * (L - 1.0)) / (L - 1.0);
    let pp = fract(along * 2.0 - R.params.z * 0.45 + strand * 0.37);
    // (up the vortex's arms: each seven strands end to end)
    let arm = floor(strand / 7.0);
    let pv = fract((strand - arm * 7.0 + along) / 7.0 * 2.0 - R.params.z * 0.45 + arm * 0.37);
    let pulse = smoothstep(0.7, 0.95, pp) * (1.0 - smoothstep(0.95, 1.0, pp));
    let pulseV = smoothstep(0.7, 0.95, pv) * (1.0 - smoothstep(0.95, 1.0, pv));
    // (the rings round her glow less than the form ahead; water still on its way to its place — alone — not at all)
    // (the vortex mostly its pulses: a broad steady glow turned its arms to flat white ribbons)
    glow = R.flow.x * mix((0.12 + 0.88 * pulse) * select(1.0, 0.5, strand < 3.5), 0.03 + 0.5 * pulseV, R.shape.x)
      * smoothstep(0.8, 2.0, dens);
  }
  o.mat = vec3f(mist, snow, glow);
  return o;
}

@vertex fn vsDepth(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SpriteOut { return particleSprite(vi, ii, 1.0); }
@vertex fn vsThick(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SpriteOut { return particleSprite(vi, ii, 1.6); }

// ---- shadows: the bent water shades the ground and the heroine (sprites facing the light; water lets some light
// through, so it is dithered to partial coverage — the soft shadow filter turns that into a lighter shadow)
struct ShOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) k: f32 }
@vertex fn vsShadow(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> ShOut {
  var o: ShOut;
  let p = PS[ii];
  let ph = u32(p.phase);
  if (ph == 0u || ph == 4u) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }
  let corner = vec2f(f32(vi & 1u), f32((vi >> 1u) & 1u)) * 2.0 - 1.0;
  let l = world.sunDir;
  let rt = normalize(cross(l, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(l.y) > 0.95)));
  let up = cross(rt, l);
  let rad = select(R.radius, R.iceRadius, ph >= 2u) * 1.4;
  o.pos = frame.viewProj * vec4f(p.pos + (rt * corner.x + up * corner.y) * rad, 1.0);
  o.uv = corner;
  o.k = select(0.45, 0.8, ph >= 2u);
  return o;
}
@fragment fn fsShadow(in: ShOut) {
  if (dot(in.uv, in.uv) > 1.0 || hash12i(in.pos.xy) > in.k) { discard; }
}

// ---- the spheres' depth (the nearest, by a depth buffer of its own) and their thickness, where the scene isn't nearer
struct DepthOut { @location(0) depth: vec4f, @builtin(frag_depth) fd: f32 }
@fragment fn fsDepth(in: SpriteOut) -> DepthOut {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  let z = sqrt(1.0 - r2);
  // view space looks down -z: the sphere's front surface is nearer the camera
  let vpos = in.center + vec3f(in.uv * in.rad, z * in.rad);
  let ld = -vpos.z;
  if (ld <= 0.05) { discard; }
  if (ld > sceneNear(in.pos.xy / R.scale.x) + 0.02) { discard; }
  var o: DepthOut;
  o.depth = vec4f(ld, in.attr.x, 0.0, 0.0);
  // reversed-Z depth for the self-occlusion test
  o.fd = frame.near / ld;
  return o;
}

struct ThickOut { @location(0) t: vec4f, @location(1) mat: vec4f }
@fragment fn fsThick(in: SpriteOut) -> ThickOut {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  let ld = -(in.center.z + sqrt(1.0 - r2) * in.rad);
  if (ld > sceneNear(in.pos.xy / R.scale.y) + 0.05) { discard; }
  // (stray mist, alone in the air, is a faint wisp — not a ball)
  // (stray snow, likewise: a dusting of powder, not round discs)
  let alone = smoothstep(0.6, 2.5, in.attr.w);
  let w = exp(-r2 * 2.5) * in.rad * 2.0 * mix(1.0, 1.5 * (0.2 + 0.8 * alone), in.mat.x) * mix(1.0, 0.25 + 0.75 * alone, in.mat.y);
  var o: ThickOut;
  o.t = vec4f(w, w * in.attr.x, w * min(in.attr.y, 62.0), w * select(0.0, 1.0, in.attr.z > 3.5));
  // (and how much of it is mist, snow, glow)
  o.mat = vec4f(w * in.mat.x, w * in.mat.y, w * in.mat.z, 0.0);
  return o;
}

// ---------------------------------------------------------------- composite
// view space position from a depth uv and its linear depth
fn viewPos(uv: vec2f, ld: f32) -> vec3f {
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  return vec3f(ndc.x / frame.proj[0][0] * ld, ndc.y / frame.proj[1][1] * ld, -ld);
}

// the surface's normal (world) from the smoothed depth (the smaller difference on each axis, to keep silhouettes sharp)
// (over two texels: one-texel differences flipped side to side where the surface turns away, a fizz round its rim)
fn fluidNormal(ci: vec2i, uv: vec2f, ld: f32, res: vec2f) -> vec3f {
  let P0 = viewPos(uv, ld);
  let dxp = textureLoad(fDepth, ci + vec2i(2, 0), 0).x;
  let dxm = textureLoad(fDepth, ci - vec2i(2, 0), 0).x;
  let dyp = textureLoad(fDepth, ci + vec2i(0, 2), 0).x;
  let dym = textureLoad(fDepth, ci - vec2i(0, 2), 0).x;
  let px = viewPos(uv + vec2f(2.0, 0.0) / res, select(ld, dxp, dxp > 0.0)) - P0;
  let mx = P0 - viewPos(uv - vec2f(2.0, 0.0) / res, select(ld, dxm, dxm > 0.0));
  let py = viewPos(uv + vec2f(0.0, 2.0) / res, select(ld, dyp, dyp > 0.0)) - P0;
  let my = P0 - viewPos(uv - vec2f(0.0, 2.0) / res, select(ld, dym, dym > 0.0));
  let ddx = select(mx, px, abs(px.z) < abs(mx.z));
  let ddy = select(my, py, abs(py.z) < abs(my.z));
  var nV = normalize(cross(ddy, ddx));
  if (nV.z < 0.0) { nV = -nV; }
  let invV = transpose(mat3x3f(frame.view[0].xyz, frame.view[1].xyz, frame.view[2].xyz));
  return normalize(invV * nV);
}

// how far a refracted lookup at uv may go: what it lands on must be behind the water (ld) — her arm or hair beside the
// orb can't be seen through it — so it eases back to straight through
fn refrBehind(uv: vec2f, ld: f32) -> f32 {
  let fc = clamp(uv * frame.res, vec2f(0.0), frame.res - 1.0);
  return smoothstep(ld - 0.4, ld + 0.1, sceneNear(fc));
}

// the water's surface at a full-resolution pixel: its depth texel, its uv there, its linear depth (0: none)
struct Surf { ci: vec2i, uv: vec2f, res: vec2f, ld: f32 }
fn surfAt(fc: vec2f) -> Surf {
  var s: Surf;
  s.res = vec2f(textureDimensions(fDepth));
  s.ci = min(vec2i(fc * R.scale.x), vec2i(s.res) - 1);
  s.uv = (vec2f(s.ci) + 0.5) / s.res;
  s.ld = textureLoad(fDepth, s.ci, 0).x;
  // (the depth at a lower resolution than the scene: whatever of the scene is nearer at this pixel stays in front)
  if (s.ld > sceneNear(fc) + 0.05) { s.ld = 0.0; }
  return s;
}

@fragment fn fsComposite(in: FullscreenOut) -> @location(0) vec4f {
  let fc = in.pos.xy;
  let sf = surfAt(fc);
  let ld = sf.ld;
  if (ld <= 0.0 || ld > 1e4) { discard; }
  let uv = fc * frame.invRes;
  var n = fluidNormal(sf.ci, sf.uv, ld, sf.res);
  let ray = viewRay(uv);
  let wp = frame.camPos + ray * (ld / max(dot(ray, frame.camFwd), 1e-4));
  let V = -ray;
  let tm = R.params.z;
  let up = vec3f(0.0, 1.0, 0.0);
  let night = world.sunTrue.w;

  let th = textureSampleLevel(fThick, samp_linear, uv, 0.0);
  let thick = max(th.x, 0.002);
  // (every particle's sprite adds a whole sphere's depth, ~60x the water it stands for: tl is the real depth of liquid
  // the light crosses — the raw sum still sets coverage and the ice look, which were tuned on it)
  let tl = thick * 0.022;
  let ice = sat(th.y / thick);
  // what it's made of: cloud mist and snow she drew, swirling through the water (they condense / melt into it as she
  // works them: fluid_sim.wgsl)
  let tmat = textureSampleLevel(fMat, samp_linear, uv, 0.0);
  let mist = sat(tmat.x / thick);
  let snow = sat(tmat.y / thick);
  // (spray particles carry +40 on the speed channel: aer is how much of this pixel's water is thrown spray)
  let aer = smoothstep(26.0, 40.0, th.z / thick);
  let speed = th.z / thick - aer * 40.0;

  // ---- ice: faceted, frosted, with internal fractures
  if (ice > 0.05) {
    let q = wp * 6.0;
    let cellA = voronoi(q.xy + q.z * 0.37);
    let cellB = voronoi(q.zy * 1.3 - q.x * 0.41);
    let facet = vec3f(hash12i(vec2f(cellA.z * 97.0, 1.0)) - 0.5, hash12i(vec2f(cellB.z * 59.0, 2.0)) - 0.5, hash12i(vec2f(cellA.z * 13.0 + cellB.z, 3.0)) - 0.5);
    n = normalize(mix(n, normalize(n + facet * 1.1), ice * 0.7));
  }
  // (mist and snow have no glassy surface: their shading takes little from the depth's normal; snow is clumpy and
  // grainy — its surface broken up at two scales)
  if (mist + snow > 0.02) { n = normalize(mix(n, V, sat(mist * 0.6 + snow * 0.2))); }
  if (snow > 0.05) {
    let gq = wp * 14.0 + vec3f(0.0, tm * 0.6, 0.0);
    let gn = vec3f(vnoise3(gq) - 0.5, vnoise3(gq + 17.0) - 0.5, vnoise3(gq + 31.0) - 0.5) + (vec3f(vnoise3(gq * 3.1), vnoise3(gq * 3.1 + 5.0), vnoise3(gq * 3.1 + 9.0)) - 0.5) * 0.5;
    n = normalize(n + gn * 1.1 * snow);
  }
  // living surface: small ripples flowing over the water (not on ice)
  if (ice < 0.95) {
    let q = wp * 11.0 + vec3f(0.0, -tm * 2.2, tm * 0.8);
    let e = 0.12;
    let g = vec3f(vnoise3(q + vec3f(e, 0.0, 0.0)) - vnoise3(q - vec3f(e, 0.0, 0.0)), vnoise3(q + vec3f(0.0, e, 0.0)) - vnoise3(q - vec3f(0.0, e, 0.0)), vnoise3(q + vec3f(0.0, 0.0, e)) - vnoise3(q - vec3f(0.0, 0.0, e)));
    n = normalize(n + g * 0.14 * (1.0 - ice));
  }
  let L = world.sunDir;
  // (looked up toward the sun past the water's own body: its shadow sprites are dithered for the ground's soft shadow,
  // and through itself they speckled it; light crossing the water is taken out by the absorption instead)
  let sh = sunShadow(wp + L * 1.2, n);
  // the key light (the app's keyRad: irradiance / PI)
  let key = sunLight(wp) / PI;
  // ---- refraction through the body, absorbed along the thickness: what's behind it displaced against the surface's
  // slope on screen (a ball of water shows the world behind it turned over), by about how far the light runs through
  // it, smaller with distance (the app's offsets were tuned with its camera ~4 m off)
  // (kept on screen: a lookup past the border clamps to its edge pixels, smeared into streaks)
  let edgeK = sat(min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)) / 0.12);
  let nV = (frame.view * vec4f(n, 0.0)).xyz;
  var refrOff = vec2f(-nV.x, nV.y) * mix(min(tl * 3.0 + 0.15, 1.2), min(thick, 1.2), ice) * R.absorb.w * mix(1.0, 1.8, ice) * edgeK * clamp(4.0 / ld, 0.2, 1.5);
  // (a faint rainbow fringe for one lookup each: the deflection extrapolated per colour — red bends less, blue more;
  // each lookup kept to what's behind the water on its own: refrBehind)
  let oR = refrOff * 0.97 * refrBehind(uv + refrOff * 0.97, ld);
  let oG = refrOff * refrBehind(uv + refrOff, ld);
  let oB = refrOff * 1.03 * refrBehind(uv + refrOff * 1.03, ld);
  refrOff = oG;
  var refr = vec3f(textureSampleLevel(sceneC, samp_linear, uv + oR, 0.0).r, textureSampleLevel(sceneC, samp_linear, uv + oG, 0.0).g,
    textureSampleLevel(sceneC, samp_linear, uv + oB, 0.0).b);
  if (ice > 0.05) {
    // frosted: blur the refraction
    var acc = refr;
    for (var k = 0; k < 6; k++) {
      let a = f32(k) * 1.047 + ign(fc) * 6.28;
      acc += textureSampleLevel(sceneC, samp_linear, uv + refrOff + vec2f(cos(a), sin(a)) * 0.006 * ice, 0.0).rgb;
    }
    refr = mix(refr, acc / 7.0, ice * 0.35);
  }
  let Tr = exp(-R.absorb.rgb * mix(tl, thick * 0.6, ice));
  let amb = skyAmbient(n) + skyAmbient(up) * 0.3 + chargeLight(wp, n) * 1.5;
  let inLight = amb + key * (0.35 + 0.65 * sh) * max(dot(L, up) * 0.5 + 0.5, 0.0);
  var scatterC = R.tint.rgb * inLight;
  // light shining through thin water: a bright rim on the side facing away from the sun
  let back = pow(sat(dot(-V, L)), 6.0) * sh;
  scatterC += R.tint.rgb * key * back * 2.5 * exp(-tl * 2.0);
  var body = refr * Tr + scatterC * (1.0 - Tr);
  // ice: clear and blue-green where thick, with white fracture planes and trapped bubbles; frost at thin edges
  if (ice > 0.05) {
    let q = wp * 3.0;
    let cr = voronoi(q.xz + vec2f(q.y * 0.6, -q.y * 0.3));
    // fractures: only some cell edges crack, and fade along their length (a network of full cells reads as a ball's
    // seams); plus clouds of tiny trapped bubbles and a little milky frost deep inside
    let fracture = smoothstep(0.03, 0.0, cr.y - cr.x) * smoothstep(0.5, 0.75, vnoise3(wp * 1.9 + 4.1)) * (0.6 + 0.4 * vnoise3(wp * 7.0));
    let bubCloud = smoothstep(0.45, 0.8, vnoise3(wp * 2.3 + 9.0));
    let bub = smoothstep(0.82, 0.95, vnoise3(wp * 22.0)) * (0.25 + 0.6 * bubCloud);
    // clear glacial ice: red is absorbed first, so it goes cyan then blue with the depth the light crosses (tl; on the
    // sprites' raw sum, ~60x it, a carried block let nothing through and read as dark steel)
    let iceT = exp(-vec3f(0.9, 0.28, 0.12) * (tl + 0.05));
    let clear = refr * iceT;
    // light scattered inside the block: a blue glow, stronger in the thick middle
    let inner = vec3f(0.3, 0.6, 0.95) * inLight * (0.17 + 0.25 * bubCloud) * (1.0 - exp(-thick * 1.5));
    // frosted where the surface faces away (rough, white-blue rime toward the silhouette)
    let rime = smoothstep(0.55, 0.15, max(dot(n, V), 0.0)) * (0.5 + 0.5 * vnoise3(wp * 9.0));
    let frostEdge = smoothstep(0.07, 0.0, thick) * R.iceTint.w;
    var iceCol = clear + inner + (fracture * 0.55 + bub * 0.35) * vec3f(0.8, 0.92, 1.0) * inLight * 0.3;
    iceCol = mix(iceCol, vec3f(0.75, 0.88, 1.0) * inLight * 0.55, rime * 0.45);
    iceCol = mix(iceCol, R.iceTint.rgb * inLight * 0.9, frostEdge * 0.5);
    body = mix(body, iceCol, ice);
  }

  // mist: lit like the cloud it came from — light scattered all through it (toward the sun most, the sky glowing
  // through), denser wisps drifting inside, the scene behind only half seen; snow: a white powder lit like the
  // snowfield, a little blue in shade
  var wisp = 0.0;
  if (mist + snow > 0.02) {
    wisp = smoothstep(0.25, 0.85, vnoise3(wp * 1.6 + vec3f(0.0, tm * 0.5, tm * 0.3)) * 0.65 + vnoise3(wp * 4.5 - vec3f(tm * 0.4)) * 0.35);
    let fwdS = henyeyGreenstein(dot(-V, L), 0.55);
    let skyB = skyRadiance(normalize(vec3f(-V.x, max(-V.y, 0.05), -V.z)));
    let mistC = (amb * 1.05 + key * sh * (0.4 + 1.6 * fwdS) + skyB * 0.2) * vec3f(0.96, 0.98, 1.0);
    // (mist only adds light — absorbing what's behind it, it reads as dirt)
    let Tm = exp(-thick * mix(0.6, 2.2, wisp));
    let mistBody = refr + mistC * (1.0 - Tm) * 0.85;
    let nl = max(dot(n, L), 0.0);
    let snowC = (amb * vec3f(0.9, 0.95, 1.05) * 1.1 + key * sh * (0.25 + 0.75 * nl)) * 0.92;
    let Ts = exp(-thick * 5.0);
    let snowBody = refr * Ts + snowC * (1.0 - Ts);
    body = mix(body, mistBody, mist);
    body = mix(body, snowBody, snow * (1.0 - mist * 0.5));
  }

  // ---- reflection: the sky + the sun's glint
  let rd = reflect(-V, n);
  var refl = skyRadiance(normalize(vec3f(rd.x, max(rd.y, 0.02), rd.z)));
  // reflect the surroundings a little darker than the sky near the horizon (the ground's bounce, the horizon's glow)
  let groundBounce = vec3f(0.12, 0.11, 0.09) * (key * max(L.y, 0.0) + skyAmbient(up));
  let skyHorizon = skyRadiance(normalize(vec3f(rd.x, 0.06, rd.z) + vec3f(1e-5)));
  refl = mix(groundBounce * 0.6 + skyHorizon * 0.3, refl, smoothstep(-0.1, 0.25, rd.y));
  let fres = fresnelSchlick(max(dot(n, V), 0.0), mix(0.02, 0.018, ice));
  let rough = mix(0.05, 0.07, ice) + smoothstep(4.0, 12.0, speed) * 0.08;
  let spec = ggxSpec(n, V, L, rough, 0.02) * key * PI * sh;
  // (mist and snow don't mirror the sky like water)
  let glassK = 1.0 - sat(mist * 0.9 + snow * 0.8);
  // a waterbender's water carries a faint thin-film play of colour: in its reflections and at grazing angles, where it
  // can be seen (face-on against a bright glow it can't), drifting with the water
  let cosT = max(dot(n, V), 0.0);
  let film = filmAt(wp * 6.0 + vec3f(0.0, tm * 0.15, 0.0), cosT, tm);
  // (faint: the app's 0.42 over this world's darker grass and dress fringes read as an oil slick)
  let iridK = min(0.2 * (1.0 + R.shape.w), 0.95) * glassK * (1.0 - ice * 0.6);
  let fresI = fres * mix(vec3f(1.0), 2.0 * film, iridK);
  // (its outline is a fringe of single drops whose normals flip from sky to ground pixel to pixel: there it mirrors
  // less, and the fringe reads as soft water rather than a fizz)
  let rimK = mix(0.35, 1.0, smoothstep(0.0, 0.15, thick));
  var col = mix(body, refl, fresI * glassK * rimK) + spec * glassK * rimK * mix(vec3f(1.0), 2.0 * film, iridK * 0.6);
  // (an opal's rim where the surface turns away, gold shading into the film's hue)
  col += mix(vec3f(1.0, 0.82, 0.5), filmHue(film), 0.6) * (amb * 0.5 + key * sh * 0.25) * pow(1.0 - cosT, 3.0) * 0.35 * iridK;
  // snow glints: grains catching the sun (and the sky)
  if (snow > 0.05) {
    let g = hash13(floor(wp * 180.0 + vec3f(0.0, tm * 2.0, 0.0)));
    let tw = step(0.993, g);
    col += (key * sh * pow(sat(dot(reflect(-V, n), L)), 4.0) * 4.0 + amb * 0.6) * tw * snow;
  }
  // ice sparkles
  if (ice > 0.05) {
    let g = hash13(floor(wp * 40.0));
    let glint = step(0.985, g) * pow(sat(dot(reflect(-V, n), L)), 8.0);
    col += key * glint * 6.0 * ice * sh;
  }
  // the cues that make clear water read against anything behind it: light caught and focused inside the body (a
  // drifting caustic shimmer, brightest where the water is thick and lit), and a cool rim where the surface turns away
  if (ice < 0.95 && mist < 0.5 && aer < 0.5 && tl > 0.02 && night < 0.9) {
    let cq = (wp.xz + vec2f(wp.y * 0.7, -wp.y * 0.4)) * 1.1;
    let cs = smoothstep(0.25, 1.4, causticNet(cq, tm * 1.3)) * smoothstep(0.02, 0.25, tl) * (0.35 + 0.65 * sh);
    col += (R.tint.rgb * 6.0 + vec3f(0.08)) * key * cs * 0.18 * (1.0 - ice);
    let rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    col += (vec3f(0.55, 0.85, 1.0) * (amb * 0.6 + key * 0.15)) * rim * 0.35 * (1.0 - ice);
  }
  // fast, thin water is whitewater / spray
  // (+ spray thrown off the surface: full of air, white where thin, glassy only in its thicker sheets)
  // (close up a drop is clear water; only a mass of them — or drops smaller than a pixel — scatters white)
  // (a thick mass of thrown water is still water: glassy in its body, froth only where it thins and breaks up)
  let massed = max(smoothstep(4.0, 16.0, ld), smoothstep(0.06, 0.2, thick) * (1.0 - smoothstep(0.3, 0.9, thick)));
  // (bent water is coherent however fast it streams: only fast, thin, scattered drops whiten)
  let white = max(smoothstep(10.0, 18.0, speed) * smoothstep(0.05, 0.01, thick) * 0.3, aer * mix(0.03, 0.22, massed)) * (1.0 - ice) * (1.0 - mist);
  col = mix(col, (amb * 1.1 + key * sh * 0.8) * 0.9, white);
  // at night: the charge's light glints in it, and a waterbender's water glows faintly under the moon — not a flat
  // wash: along its silhouette and in a slow drifting shimmer inside, so its shape still reads
  if (night > 0.05) { col += chargeSpec(wp, n, V, 0.06) * (1.0 - ice * 0.5) * night; }
  if (night > 0.01) {
    let moonRad = select(vec3f(0.0), key, world.moon.z > 0.5);
    let rimN = pow(1.0 - max(dot(n, V), 0.0), 2.0);
    let shim = smoothstep(0.3, 1.3, causticNet((wp.xz + vec2f(wp.y * 0.7, -wp.y * 0.4)) * 1.4, tm * 0.9));
    col += vec3f(0.25, 0.7, 0.9) * R.tint.w * night * (0.0008 + 0.006 * rimN + 0.008 * shim) * moonRad * 40.0 * (1.0 - ice * 0.5);
  }
  // the light it carries: a soft core all through it and brighter pulses running along its lines — by day a sheen, by
  // night the form drawn in light
  let glowK = sat(tmat.z / thick);
  if (glowK > 0.003) {
    // (strongest along its silhouette and its thin parts — light carried in the glass, the water still reading as water)
    let rimG = 0.45 + 0.55 * pow(1.0 - max(dot(n, V), 0.0), 1.5);
    col += vec3f(0.42, 0.84, 1.0) * glowK * R.flow.w * (0.18 + 0.95 * night) * rimG * (1.0 - ice * 0.7) * R.params.w;
  }
  // spirit water: deep blue, lit from within. Everything in its look — the sky it mirrors, the sun's glint, the light
  // through it — kept as brightness but drawn to its blue (a glow added over clear water read as white, or the
  // golden hour's gold); then its own light, all through it, brightest at its rim and where it's thin, veins of it
  // drifting inside
  // (and charged water goes the same way, part way: deeper and bluer as the power gathers in it — energy.ts)
  let spk = max(R.spirit.w, R.energy.x * 0.65);
  if (spk > 0.001) {
    let sk = sat(spk) * (1.0 - ice * 0.5) * (1.0 - mist * 0.8);
    let spc = select(vec3f(0.05, 0.36, 1.7) * 0.55, R.spirit.rgb, R.spirit.w > 0.001);
    let lum = dot(col, vec3f(0.2126, 0.7152, 0.0722));
    col = mix(col, vec3f(0.07, 0.3, 1.0) * lum * 1.2, sk * 0.85);
    // (and navy where it's deep: thick water swallows the light — the rim and its own glow carry the brightness, not a
    // pale body)
    col *= mix(1.0, 0.3 + 0.7 * exp(-tl * 2.2), sk);
    let rimS = 0.3 + 0.7 * pow(1.0 - max(dot(n, V), 0.0), 1.4);
    let vein = smoothstep(0.2, 1.2, causticNet((wp.xz + vec2f(wp.y * 0.6, -wp.y * 0.5)) * 1.1, tm * 0.7));
    col += spc * sk * (rimS * (0.45 + 0.55 * sat(1.0 - thick * 1.2)) + 0.6 * vein) * R.params.w;
  }
  col = applyAerial(col, wp);
  // soft edges where the sheet thins out
  // (+ water right at the lens fades: a splash the camera flies through shouldn't wash out the picture)
  var a = smoothstep(0.0, 0.03, thick) * smoothstep(0.35, 1.5, ld);
  // (snow's outline is clumpy, not a smooth tube)
  if (snow > 0.05) { a *= mix(1.0, smoothstep(0.25, 0.55, vnoise3(wp * 9.0 + tm * 0.3) * 0.6 + sat(thick * 6.0) * 0.6), snow); }
  // (mist is see-through where it thins and frays into wisps)
  // (and mist close to the lens melts away, as a cloud does when you fly into it — not a ball looming at the camera)
  if (mist > 0.02) { a *= mix(1.0, sat((1.0 - exp(-thick * mix(0.8, 2.6, wisp))) * 1.6) * smoothstep(0.0, 0.5, wisp + 0.25) * smoothstep(1.5, 9.0, ld), mist); }
  return vec4f(col, a);
}

// ---------------------------------------------------------------- the charge's light (added over the composite)
// The power gathered into what she holds (energy.ts), lit inside it: a core of deep light in the thick of it, beating
// like a heart — each beat a wave out from its middle — veins of light drifting at two depths (seen into the water,
// along the view: they slide past each other as it turns), sparks hanging in it, and a white-blue rim. Teal while it's
// faint, through cyan to a white-hot core at full; deeper, bluer, where it's spirit water.
@fragment fn fsEnergy(in: FullscreenOut) -> @location(0) vec4f {
  let fc = in.pos.xy;
  let sf = surfAt(fc);
  let ld = sf.ld;
  if (ld <= 0.0 || ld > 1e4) { discard; }
  let uv = fc * frame.invRes;
  let th = textureSampleLevel(fThick, samp_linear, uv, 0.0);
  let thick = max(th.x, 0.002);
  let tmat = textureSampleLevel(fMat, samp_linear, uv, 0.0);
  // (not in ice, cloud mist or thrown spray: the water itself)
  let k = (1.0 - sat(th.y / thick) * 0.85) * (1.0 - sat(tmat.x / thick) * 0.85) * (1.0 - smoothstep(26.0, 40.0, th.z / thick) * 0.7);
  if (k < 0.02) { discard; }
  let n = fluidNormal(sf.ci, sf.uv, ld, sf.res);
  let ray = viewRay(uv);
  let wp = frame.camPos + ray * (ld / max(dot(ray, frame.camFwd), 1e-4));
  let V = -ray;
  let E = R.energy.x;
  let tl = thick * 0.022;
  let tm = R.params.z;
  let cosV = max(dot(n, V), 0.0);
  // the heart: each beat a wave out from its middle
  let rc = distance(wp, R.ecen.xyz) / max(R.ecen.w, 0.4);
  let beat = heartbeat(fract(R.energy.y - rc * 0.22));
  // seen into it: half its depth in along the view, and deeper still for the second veins
  let q = wp - V * min(tl * 0.5 + 0.12, 1.0);
  let q2 = q - V * (0.25 + 0.5 * min(tl, 1.0));
  let core = smoothstep(0.02, 0.5, tl) * (0.4 + 0.6 * cosV);
  let v1 = smoothstep(0.35, 1.3, causticNet((q.xz + vec2f(q.y * 0.6, -q.y * 0.5)) * 1.8, tm * (0.4 + 0.9 * E)));
  let v2 = smoothstep(0.45, 1.4, causticNet((q2.zy + vec2f(q2.x * 0.5, q2.x * 0.3)) * 3.6 + 7.3, -tm * (0.6 + 1.4 * E)));
  // sparks hanging in it, twinkling
  let g = q * 6.0;
  let cell = floor(g);
  let hc = hash13(cell);
  let fo = fract(g) - 0.5 - (vec3f(hash13(cell + 1.7), hash13(cell + 3.1), hash13(cell + 5.9)) - 0.5) * 0.6;
  let spark = step(1.0 - 0.06 * E, hc) * exp(-dot(fo, fo) * 70.0) * (0.55 + 0.45 * sin(tm * 7.0 + hc * 60.0));
  let rim = pow(1.0 - cosV, 3.0);
  let sp = sat(R.spirit.w);
  let deep = mix(vec3f(0.0, 0.22, 0.42), vec3f(0.008, 0.05, 0.7), sp);
  let mid = mix(vec3f(0.06, 0.55, 0.95), vec3f(0.05, 0.32, 1.5), sp);
  let hot = vec3f(0.7, 0.9, 1.6);
  // (the deep blue carries it, the veins next; the white only at its rim and in sparks — kept from clipping, or a charged
  // body of water read as a white neon tube)
  var col = deep * core * (0.12 + 0.88 * beat) * (0.6 + 2.2 * E)
          + mid * (v1 * (0.4 + 0.8 * beat) + v2 * 0.5 * (0.6 + 0.4 * beat)) * E * 0.8
          + hot * (rim * (0.25 + 0.75 * beat) * E * E * 0.55 + spark * 2.5 * E)
          + hot * core * beat * max(E - 0.6, 0.0) * 1.2;
  // (by night it carries further: the eye's opened up)
  col *= k * R.energy.z * (0.75 + 0.5 * world.sunTrue.w) * smoothstep(0.35, 1.5, ld) * R.params.w;
  return vec4f(col, 0.0);
}
