// The spray's drawing (spray.ts; spray_sim.wgsl moves it), ported from the waterbending app: each particle a sprite —
// droplets streaked along their motion against the camera's, mist and spume puffs eroded by noise, glitter's
// four-pointed stars, bubbles' bright rims, leaves, motes of light, the charge's threads of light. Drawn premultiplied
// over the finished scene (post/fx.ts's overlay) after the bent water, faded softly where it meets the scene behind it
// (sceneZ) or the bent water's surface in front of it (render.ts's smoothed depth). Its light is worked out once a
// particle (the sun through the cascades, the sky, the air between): the app lit every pixel of every sprite, which
// overlapping mist made dear.
#include "./../../../world/world.wgsl"
#include "./common.wgsl"
#include "./spray_types.wgsl"

@group(2) @binding(0) var<storage, read> PS: array<SP>;
@group(2) @binding(4) var sceneZ: texture_2d<f32>;
@group(2) @binding(5) var fluidZ: texture_2d<f32>;

// what a lens of water under the surface lets through (1/m: this world's lake water, below.ts, absorption + a fifth of
// its scattering)
const UW_KD = (vec3f(0.34, 0.065, 0.1) + 0.2 * vec3f(0.035, 0.045, 0.045)) * 1.15;
const UW_ETA = 1.333;

struct VO {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) kind: f32,
  @location(2) @interpolate(flat) fade: f32,
  @location(3) wp: vec3f,
  @location(4) @interpolate(flat) seed: f32,
  @location(5) @interpolate(flat) key: vec4f,   // the key light reaching it (/ PI, the app's keyRad), w its shadow
  @location(6) @interpolate(flat) amb: vec4f,   // the sky's light from above (/ PI), w the cosine toward the light
  @location(7) @interpolate(flat) skyB: vec3f,  // the sky behind it
  @location(8) @interpolate(flat) air: vec4f,   // the air between: in-scattered light, w what it lets through
  @location(9) @interpolate(flat) streak: f32,  // drawn out along its motion (1) or round (0)
}

// toward the key light, seen from under the surface (refracted: never more than ~49 degrees from the zenith)
fn uwLightDir() -> vec3f {
  let l = world.sunDir;
  let h = l.xz / max(length(l.xz), 1e-5);
  let s = sqrt(max(1.0 - sq(max(l.y, 0.0)), 0.0)) / UW_ETA;
  return vec3f(h.x * s, sqrt(1.0 - s * s), h.y * s);
}

@vertex
fn vsSpray(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  var o: VO;
  let p = PS[ii];
  let corner = vec2f(f32(vi & 1u), f32((vi >> 1u) & 1u)) * 2.0 - 1.0;
  if (p.kind < 0.5) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }
  let k = u32(p.kind);
  let hv = hash1u(ii * 2654435761u);
  let cam = frame.camPos;
  var size = 0.012;
  var stretch = vec3f(0.0);
  if (k == 1u) {
    // droplets of all sizes, the big ones fewer
    size = 0.006 + 0.022 * hv * hv;
    // motion blur: its motion against the camera's (spray flung along with her, the camera chasing, barely moves on
    // screen — stretched by its own velocity it streaked past the lens)
    stretch = (p.vel - S.camVel.xyz) * 0.016;
  } else if (k == 2u) {
    size = (0.35 + max(2.5 - p.life, 0.0) * 0.35) * (0.7 + 0.6 * hv);
  } else if (k == 11u) {
    // a streak of torn water: a few centimetres of drops, drawn out along its flight
    size = 0.006 + 0.014 * hv * hv;
    stretch = (p.vel - S.camVel.xyz) * 0.012;
  } else if (k == 12u) {
    // haze: a soft puff a metre or so across, spreading as it hangs (it lives up to 6 s)
    size = (1.7 + 0.8 * max(6.0 - p.life, 0.0)) * (0.7 + 0.6 * hv);
  } else if (k == 3u) {
    size = 0.008;
  } else if (k == 5u) {
    // bubbles: mostly a few millimetres, a few big wobbling ones (never thinner than a pixel and a half)
    size = 0.002 + 0.009 * hv * hv * hv;
  } else if (k == 6u) {
    size = 0.0009 + 0.0012 * hv;
  } else if (k == 7u) {
    // spume: soft clots of spray, spreading as they hang
    size = (0.12 + 0.18 * hv) * (1.0 + 0.7 * clamp(1.3 - p.life, 0.0, 1.3));
    stretch = (p.vel - S.camVel.xyz) * 0.012;
  } else if (k == 8u) {
    size = 0.065 + 0.035 * hv;
  } else if (k == 9u) {
    size = 0.03 + 0.02 * hv;
  } else if (k == 10u) {
    // an energy mote: a fleck of light, streaked along its flight
    size = 0.006 + 0.01 * hv * hv;
    let sv = (p.vel - S.camVel.xyz) * 0.02;
    stretch = sv * min(1.0, 0.35 / max(length(sv), 1e-4));
  } else {
    size = 0.06;
  }
  // (a bigger burst's own size: the kind's fraction — spray_sim.wgsl emitCPU)
  size *= 1.0 + fract(p.kind) * 20.0;
  // (drops and streaks never thinner than a pixel: one that would be is drawn a pixel wide and fainter, as much light
  // as it would have — not flickering in and out between the pixels)
  var thin = 1.0;
  if (k == 1u || k == 11u) {
    let px = distance(cam, p.pos) * tan(frame.fovY * 0.5) * 2.0 * frame.invRes.y;
    if (size < px) { thin = size / px; size = px; }
  }
  if (k == 5u || k == 6u) { size = max(size, distance(cam, p.pos) * 1.5 * tan(frame.fovY * 0.5) * 2.0 * frame.invRes.y); }
  // (by night the glowing plankton — one mote in six, as the fragment picks them — shine in a soft halo)
  if (k == 6u && fract(hv * 7.31) > 0.83) { size *= 1.0 + 3.0 * smoothstep(0.3, 0.8, world.sunTrue.w); }
  let toCam = normalize(cam - p.pos);
  var right = normalize(cross(toCam, vec3f(0.0, 1.0, 0.0)));
  var up = cross(right, toCam);
  var center = p.pos;
  o.streak = select(0.0, 1.0, length(stretch) > size * 1.5);
  if (length(stretch) > size) {
    // align the quad's long axis with the screen-space motion
    let s = normalize(stretch - toCam * dot(stretch, toCam) + vec3f(1e-6));
    up = s;
    right = normalize(cross(toCam, s));
    center = p.pos - stretch * 0.5;
    o.wp = center + right * corner.x * size + up * corner.y * (length(stretch) * 0.5 + size);
  } else {
    // (haze lies low and wide over the water: half as tall as it's wide)
    o.wp = center + (right * corner.x + up * corner.y * select(1.0, 0.3, k == 12u)) * size;
  }
  if (k == 8u) {
    // a leaf: tumbling as it falls (turning in its own plane, and over: squashed across as it turns edge-on); lying
    // flat once it's down
    let falling = smoothstep(0.05, 0.3, length(p.vel));
    let spin = S.time * (1.3 + 2.0 * hv) + hv * 30.0;
    let tum = mix(1.0, 0.25 + 0.75 * abs(cos(S.time * (0.9 + 1.4 * hv) + hv * 11.0)), falling);
    let c = cos(spin);
    let s2 = sin(spin);
    let q = vec2f(corner.x * c - corner.y * s2, corner.x * s2 + corner.y * c) * vec2f(tum, 1.0);
    let lying = p.pos + vec3f(q.x, 0.0, q.y) * size;
    let upright = p.pos + (right * q.x + up * q.y) * size;
    o.wp = mix(lying, upright, falling);
  }
  if (k == 4u) {
    // foam flecks lie flat on the water
    o.wp = p.pos + vec3f(corner.x, 0.0, corner.y) * size;
  }
  o.pos = frame.viewProj * vec4f(o.wp, 1.0);
  o.uv = corner;
  o.kind = p.kind;
  o.seed = hv;
  o.fade = clamp(p.life * 3.0, 0.0, 1.0) * (0.55 + 0.45 * hv);
  // (motes fade in as they're born around the camera, and thin out with distance)
  if (k == 6u) { o.fade = clamp(p.life * 1.5, 0.0, 1.0) * clamp((6.0 - p.life) * 1.5, 0.0, 1.0) * (0.35 + 0.65 * hv) * (1.0 - smoothstep(3.0, 8.0, distance(cam, p.pos))); }
  // (spray right at the lens — the camera chasing her through her own wake — fades rather than smearing the view)
  if (k == 1u) { o.fade *= smoothstep(1.4, 4.5, distance(cam, p.pos)); }
  if (k == 7u) { o.fade *= smoothstep(2.0, 5.5, distance(cam, p.pos)); }
  // (a streak right at the lens — the camera chasing her through her own spray — fades well before it fills the view)
  if (k == 11u) { o.fade *= smoothstep(3.5, 8.0, distance(cam, p.pos)); }
  if (k == 1u || k == 11u) { o.fade *= thin; }
  // (haze fades in as it spreads and out as it thins; right at the lens it's gone rather than a smear)
  if (k == 12u) { o.fade = clamp(p.life * 0.5, 0.0, 1.0) * smoothstep(0.0, 1.0, (6.0 - p.life) * 1.2) * smoothstep(3.0, 8.0, distance(cam, p.pos)); }
  // (a leaf is solid while it lasts; a mote of light fades in and out)
  if (k == 8u) { o.fade = clamp(p.life * 1.2, 0.0, 1.0); }
  if (k == 9u) { o.fade = clamp(p.life * 0.8, 0.0, 1.0) * clamp((9.0 - p.life) * 0.8, 0.0, 1.0); }
  if (k == 10u) { o.fade = clamp(p.life * 2.0, 0.0, 1.0) * smoothstep(1.5, 4.5, distance(cam, p.pos)); }
  // its light, once for the particle
  let upN = vec3f(0.0, 1.0, 0.0);
  o.key = vec4f(sunLight(p.pos) / PI, sunShadowFast(p.pos, upN));
  o.amb = vec4f(skyAmbient(upN), dot(-toCam, world.sunDir));
  o.skyB = skyRadiance(normalize(vec3f(-toCam.x, max(-toCam.y, 0.03), -toCam.z)));
  o.air = aerial(p.pos);
  return o;
}

// the spray's rainbow: sunlight sent back off the drops toward the eye — the primary bow about 42 degrees from the point
// opposite the sun (red outside, violet in), the fainter secondary about 51 (its colours the other way round); white
// light's mix keeps it soft. Seen only with the sun behind the eye: whatever the spray, at the right angle
fn bowHue(u: f32) -> vec3f {
  let h = (1.0 - clamp(u, 0.0, 1.0)) * 0.8;
  return clamp(vec3f(abs(h * 6.0 - 3.0) - 1.0, 2.0 - abs(h * 6.0 - 2.0), 2.0 - abs(h * 6.0 - 4.0)), vec3f(0.0), vec3f(1.0));
}
fn sprayBow(wp: vec3f) -> vec3f {
  let v = normalize(wp - frame.camPos);
  let th = degrees(acos(clamp(dot(v, -world.sunDir), -1.0, 1.0)));
  let p1 = exp(-sq((th - 41.4) / 1.05));
  let p2 = exp(-sq((th - 51.6) / 1.5)) * 0.33;
  if (p1 + p2 < 1e-3) { return vec3f(0.0); }
  let c1 = mix(vec3f(0.55), bowHue((th - 40.3) / 2.2), 0.75) * p1;
  let c2 = mix(vec3f(0.55), bowHue(1.0 - (th - 50.0) / 3.4), 0.65) * p2;
  return (c1 + c2) * step(0.0, world.sunDir.y);
}

@fragment
fn fsSpray(in: VO) -> @location(0) vec4f {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  let k = u32(in.kind);
  // soft particles: fade where the sprite meets the scene behind it (the nearest of its four samples) — or the bent
  // water's surface, drawn this frame
  let z4 = textureLoad(sceneZ, vec2i(in.pos.xy), 0);
  var zS = min(min(z4.x, z4.y), min(z4.z, z4.w));
  if (S.look.y > 0.5) {
    let zf = textureLoad(fluidZ, vec2i(in.pos.xy * S.look.x), 0).x;
    if (zf > 0.0) { zS = min(zS, zf); }
  }
  let zP = frame.near / max(in.pos.z, 1e-7);
  let soft = sat((zS - zP) / select(select(0.05, 0.4, k == 7u), 0.8, k == 2u || k == 12u));
  let key = in.key.rgb;
  let sh = in.key.w;
  let amb = in.amb.rgb;
  let mu = in.amb.w;
  let night = world.sunTrue.w;
  var col = vec3f(0.0);
  var a = 0.0;
  if (k == 1u) {
    // droplet: a tiny lens — sky reflection + a sun glint + forward scattered light (whitewater in shade still reads
    // white: it scatters the whole sky's light, brighter than the irradiance a flat white surface would take)
    // (+ the bright sky behind it glowing through: spray against a sunset sky is lit up by it)
    col = amb * mix(2.2, 1.5, sh) + key * sh * (0.35 + 2.5 * henyeyGreenstein(mu, 0.75)) + in.skyB * 0.5;
    // (clear through its middle, bright round its rim: each one a lens, not a white fleck — a mass of them flung at
    // once read as confetti)
    a = (0.22 + 0.45 * smoothstep(0.3, 0.92, r2)) * (1.0 - smoothstep(0.92, 1.0, r2)) * in.fade;
    // (a drop flying past, drawn out by its motion, is a soft line — the lens's rim stretched read as a flat petal)
    if (in.streak > 0.5) { a = (1.0 - smoothstep(0.1, 1.0, abs(in.uv.x))) * (1.0 - smoothstep(0.5, 1.0, abs(in.uv.y))) * 0.4 * in.fade; }
    col += key * sh * sprayBow(in.wp) * 1.8;
  } else if (k == 11u) {
    // torn water: a streak of drops — bright where the sun comes through it toward the eye, the sky in it, a glint of
    // the bow; thin at its edges
    col = amb * mix(2.0, 1.4, sh) + key * sh * (0.4 + 3.0 * henyeyGreenstein(mu, 0.8)) + in.skyB * 0.45 + key * sh * sprayBow(in.wp) * 1.8;
    // (a soft line of drops, densest along its middle and fading to its ends — not a lens's rim: a rimmed ellipse
    // read as a grain of rice)
    let across = 1.0 - smoothstep(0.15, 1.0, abs(in.uv.x));
    let along = 1.0 - smoothstep(0.55, 1.0, abs(in.uv.y));
    a = across * along * (0.3 + 0.25 * fract(in.seed * 9.7)) * in.fade;
  } else if (k == 12u) {
    // haze: very fine mist — faint, glowing where the sun shines through it toward the eye (a strong forward lobe, a
    // little back), the bow in it with the sun behind; torn by noise, drifting
    col = amb * 0.85 + key * sh * (0.35 + 3.4 * henyeyGreenstein(mu, 0.72) + 0.4 * henyeyGreenstein(mu, -0.3)) + key * sh * sprayBow(in.wp) * 3.5;
    // (its torn texture from where it is in the world, not from the sprite: neighbouring puffs share it and run together
    // into one veil; a soft gaussian edge, no rim — puffs, not balls)
    let er = 0.15 + 0.85 * smoothstep(0.25, 0.8, fbm(in.wp.xz * 0.45 + vec2f(in.wp.y * 0.7, 0.0) - S.wind.xz * S.time * 0.05, 3));
    a = exp(-r2 * 3.0) * (1.0 - smoothstep(0.7, 1.0, r2)) * 0.1 * in.fade * er;
  } else if (k == 2u) {
    col = amb * 0.8 + key * sh * (0.4 + 3.0 * henyeyGreenstein(mu, 0.6)) + key * sh * sprayBow(in.wp) * 4.0;
    // mist: noise-eroded puffs, faint (over this world's darker water a landing's puffs hung on it like cotton)
    let er = smoothstep(0.3, 0.8, fbm(in.uv * 2.0 + in.wp.xz * 0.3 + S.time * 0.05, 3));
    a = (1.0 - smoothstep(0.0, 1.0, r2)) * 0.075 * in.fade * er;
  } else if (k == 8u) {
    // a maple leaf: five lobes round its base (the sprite's middle), its colour one of the maple's own — crimson,
    // scarlet, orange, gold, now and then plum; lit through when the light is behind it
    let th = atan2(in.uv.x, in.uv.y);
    let r = length(in.uv);
    var rr = 0.18;
    for (var li = 0; li < 5; li++) {
      let la = (f32(li) - 2.0) * 0.8;
      let ll = select(select(0.88, 0.52, abs(f32(li) - 2.0) > 1.5), 1.0, li == 2);
      rr = max(rr, ll * pow(cos(min(abs(th - la) * 2.3, 1.5707)), 1.7));
    }
    if (r > rr * 0.98) { discard; }
    let hc = fract(in.seed * 13.7);
    var albedo = vec3f(0.5, 0.035, 0.035);
    if (hc > 0.25) { albedo = vec3f(0.72, 0.1, 0.03); }
    if (hc > 0.5) { albedo = vec3f(0.85, 0.3, 0.04); }
    if (hc > 0.72) { albedo = vec3f(0.85, 0.55, 0.08); }
    if (hc > 0.94) { albedo = vec3f(0.33, 0.07, 0.22); }
    let back = henyeyGreenstein(mu, 0.5);
    col = albedo * (amb * 0.9 + key * sh * (0.45 + 1.6 * back));
    a = in.fade * smoothstep(rr * 0.98, rr * 0.9, r);
  } else if (k == 9u) {
    // a mote of light: a soft warm point (now and then a violet one), brighter as the light goes, breathing
    let hc = fract(in.seed * 7.31);
    let c = mix(vec3f(1.0, 0.72, 0.32), vec3f(0.72, 0.5, 1.0), step(0.85, hc));
    let pulse = 0.6 + 0.4 * sin(S.time * (1.2 + hc) + hc * 30.0);
    let glow = exp(-r2 * 5.0);
    let sunVis = smoothstep(-0.02, 0.02, world.sunTrue.y);
    col = c * (0.6 + 9.0 * night + 4.0 * (1.0 - sat(sunVis * 3.0))) * pulse * S.emissive;
    a = glow * 0.35 * in.fade;
  } else if (k == 10u) {
    // an energy mote: deep blue to cyan, now and then white-hot, flaring on each of the heart's beats; brighter the
    // more charged it is
    let hc = fract(in.seed * 5.77);
    let x = fract(S.energy.x);
    let beat = exp(-x * 9.0) + select(0.0, 0.6 * exp(-(x - 0.28) * 9.0), x > 0.28);
    let sp = sat(S.energy.z);
    let c = mix(mix(vec3f(0.1, 0.6, 1.0), vec3f(0.05, 0.3, 1.0), sp), vec3f(0.75, 0.92, 1.0), step(0.8, hc));
    // (a thread of light: a hot narrow core, a faint halo — the stretched quad's long axis is its v)
    let core = exp(-in.uv.x * in.uv.x * 14.0) * (1.0 - in.uv.y * in.uv.y) + 0.2 * exp(-r2 * 2.0);
    col = c * (4.0 + 14.0 * sat(S.energy.y)) * (0.5 + 0.5 * beat) * (0.7 + 0.6 * hc) * (1.0 + 1.5 * night) * S.emissive;
    a = core * 0.16 * in.fade;
  } else if (k == 7u) {
    // spume: white, lit through (forward scattering toward the sun), torn at the edges; dense near its middle
    col = amb * mix(2.3, 1.4, sh) + key * sh * (0.5 + 2.2 * henyeyGreenstein(mu, 0.6)) + in.skyB * 0.4;
    let er = smoothstep(0.15, 0.6, fbm(in.uv * 2.5 + in.wp.xz * 0.8 + S.time * 0.3, 3));
    a = (1.0 - smoothstep(0.0, 1.0, r2)) * 0.46 * in.fade * er;
  } else if (k == 3u) {
    // glitter: tiny four-pointed stars flashing as the crystals turn
    let tw = step(0.7, fract(sin(dot(in.wp, vec3f(91.3, 47.1, 13.7)) + S.time * 9.0) * 43758.5));
    let au = abs(in.uv);
    let star = max(exp(-au.x * 9.0) * exp(-au.y * 2.2), exp(-au.y * 9.0) * exp(-au.x * 2.2)) + exp(-r2 * 6.0) * 0.6;
    col = key * sh * 3.0 * tw + amb * 0.6;
    a = sat(star) * in.fade;
  } else if (k == 5u) {
    // an air bubble: a tiny mirror-ball — clear in the middle, a bright silvery rim (total internal reflection at its
    // edge), a hot glint toward the light above and a faint one below; lit by the light that's come down this deep
    let env = (amb + key * max(world.sunDir.y, 0.0) * 0.6) * exp(-UW_KD * max(waterLevel(in.wp.xz) - in.wp.y, 0.0));
    let rim = smoothstep(0.55, 0.97, r2);
    let upG = vec2f(-0.28, 0.38);
    let glint = exp(-dot(in.uv - upG, in.uv - upG) * 45.0) * 2.2 * sh + exp(-dot(in.uv + upG * 0.8, in.uv + upG * 0.8) * 60.0) * 0.4;
    col = env * (0.25 + 1.6 * rim) + key * glint * max(world.sunDir.y, 0.05) * 1.5;
    a = (0.12 + 0.75 * rim + 0.5 * glint) * in.fade * (1.0 - smoothstep(0.97, 1.0, r2));
  } else if (k == 6u) {
    // a silt mote: a speck that glints where it scatters the light coming down toward the eye
    let Lw = uwLightDir();
    let fw = henyeyGreenstein(dot(normalize(in.wp - frame.camPos), Lw), 0.7) * 4.0 * PI;
    let down = exp(-UW_KD * max(waterLevel(in.wp.xz) - in.wp.y, 0.0));
    col = (amb * 0.7 + key * max(world.sunDir.y, 0.0) * sh * (0.3 + 0.7 * fw)) * down;
    a = (1.0 - smoothstep(0.0, 1.0, r2)) * 0.32 * in.fade;
    // the shimmer: one in three catches the sun as it turns, a glint winking on and off in the light coming down; by
    // night one in six glows, plankton, breathing slowly
    let h = fract(in.seed * 7.31);
    let tw = pow(max(sin(S.time * (1.3 + 2.4 * h) + h * 60.0), 0.0), 24.0) * step(0.67, h);
    let glow = (0.5 + 0.5 * sin(S.time * (0.6 + h) + h * 30.0)) * step(0.83, h) * smoothstep(0.3, 0.8, night);
    let core = exp(-r2 * 5.0);
    // (the plankton's light against the night's own, as bright as the eye has adapted to: under the water at night
    // they're what's to see)
    col += (key * max(world.sunDir.y, 0.0) * sh * (0.4 + fw) * tw * 3.0 * down + vec3f(0.04, 0.5, 0.8) * glow * 120.0 * max(world.night.w, 1e-4)) * core;
    a = max(a, (tw * sh + glow) * core * 0.8 * in.fade);
  } else if (k == 4u) {
    // a fleck of foam riding the water: lace — bubbles gathered into threads round holes, thinning to its edges — never
    // a disc
    col = amb * 1.1 + key * sh * 0.7;
    let n = fbm(in.wp.xz * 9.0 + in.seed * 13.0, 3);
    let lace = 1.0 - abs(n * 2.0 - 1.0);
    a = smoothstep(0.55, 0.85, lace) * (1.0 - smoothstep(0.25, 1.0, r2)) * 0.6 * in.fade;
  } else {
    col = amb + key * sh * 0.7;
    a = (1.0 - smoothstep(0.3, 1.0, r2)) * 0.5 * in.fade * smoothstep(0.0, 0.5, fbm(in.wp.xz * 12.0, 2));
  }
  col = col * in.air.a + in.air.rgb;
  let af = a * soft;
  return vec4f(col * af, af);
}
