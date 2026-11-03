// The heaped clouds (src/world/clouds.ts), after Stormbreak's: each cloud a fixed cluster of soft, lit sprites at
// fixed places in the world — drifting with the wind, never re-forming as the camera moves — composited over the
// finished scene in the order the CPU sorted them (back to front), premultiplied. Three kinds:
//   puffs    cumulus and cumulonimbus: a soft ball with its rim eaten into lumps, lit as one body — the side toward
//            the light bright, the side away and the flat base in the cloud's own shade (darker the thicker the
//            cloud), a silver rim against the light
//   lenses   lenticular wave clouds: an ellipsoid ray-traced per pixel (the chord through it is the density), smooth
//            and laminar, standing over the mountains
//   virga    rain and virga hanging from a base: streaked sheets fading out before the ground
// Each lit by the key light at its own height (sunset colours, the earth's shadow) through any deck above it, the
// sky's light and the air in front — those found once per sprite corner, not per pixel. The shadow entries draw the same sprites facing the light into the cloud shadow
// map (multiplied in; alpha the lowest cloud).
#include "./cloudlayer.wgsl"

struct Puff {
  pos: vec3f, r: f32,         // centre (virga: the top of the sheet), radius (lens: its bounding radius)
  off: vec3f, base: f32,      // puff: where it sits on its cloud (over the cloud's half-size; y 0 base .. 1 top); lens:
                              // its semi-axes (m); virga: x its length (m). base: the cloud's flat base (world y)
  seed: f32, alpha: f32, dark: f32, kind: f32,   // kind 0 puff, 1 lens, 2 virga
  ax: vec4f,                  // lens: the cosine and sine of its yaw, its optical depth through the middle; puff: x a flat
                              // top (world y; 0 none: an anvil's)
}
@group(2) @binding(2) var sceneZ: texture_2d<f32>;
@group(2) @binding(3) var<storage, read> puffs: array<Puff>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) wp: vec3f,
  @location(2) @interpolate(flat) ii: u32,
  @location(3) vz: f32,
  @location(4) right: vec3f,
  @location(5) up: vec3f,
  @location(6) keyS: vec3f,     // the key light straight through any deck above (direct)
  @location(7) keyD: vec3f,     // what the decks scatter of it on the way down
  @location(8) amb: vec3f,      // the sky's light on it (as its top sees it; at least a little of the clear sky's)
  @location(9) ap: vec4f,       // the air in front: in-scattered light, transmittance
}

const TAU = 6.2831853;
fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }

// a sprite where the wind has carried it since it was listed (the list is drawn up every few frames; this between)
fn drifted(i: u32) -> Puff {
  var p = puffs[i];
  p.pos += vec3f(CL.wind.z, 0.0, CL.wind.w) * p.ax.w;
  return p;
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let p = drifted(ii);
  var quad = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let c = quad[vi];
  let toCam = normalize(frame.camPos - p.pos);
  var r = cross(vec3f(0.0, 1.0, 0.0), toCam);
  r = select(normalize(r), vec3f(1.0, 0.0, 0.0), length(r) < 1e-4);
  var u = cross(toCam, r);
  var o: VOut;
  if (p.kind > 1.5) {
    // virga: a sheet turned to the camera about the vertical, hanging from its top
    u = vec3f(0.0, 1.0, 0.0);
    o.wp = p.pos + r * c.x * p.r + u * (c.y - 1.0) * 0.5 * p.off.x;
  } else if (p.kind > 0.5) {
    o.wp = p.pos + (r * c.x + u * c.y) * p.r;
  } else {
    // (turned by its own fixed angle, so neighbours don't look stamped)
    let a = p.seed * TAU;
    let ca = cos(a); let sa = sin(a);
    let r2 = r * ca + u * sa;
    u = -r * sa + u * ca;
    r = r2;
    o.wp = p.pos + (r * c.x + u * c.y) * p.r;
  }
  o.pos = frame.viewProj * vec4f(o.wp, 1.0);
  o.uv = c;
  o.ii = ii;
  o.vz = dot(o.wp - frame.camPos, frame.camFwd);
  o.right = r; o.up = u;
  // the light at the sprite (one value over it: it changes over kilometres, not across a puff)
  let over = decksOver(p.pos, -1);
  let K = keyAt(p.pos);
  o.keyS = K * over.x;
  o.keyD = K * (over.y - over.x);
  let shapeN = select(vec3f(0.0, 1.0, 0.0), normalize(p.off + vec3f(0.0, 0.35, 0.0)), p.kind < 0.5);
  let clearUp = max(vec3f(0.0), skyIrradiance[0].rgb + skyIrradiance[1].rgb) * world.haze.z;
  o.amb = max(skyAmbient(normalize(shapeN + vec3f(0.0, 0.8, 0.0))), clearUp * 0.3) + flashGlow(p.pos);
  o.ap = aerial(select(p.pos, o.wp, p.kind > 1.5));
  return o;
}

fn noiseAt(uv: vec2f) -> vec4f { return textureSampleLevel(cloudNoise, samp_repeat, uv, 0.0); }

fn puffColor(p: Puff, i: VOut, z: vec4f) -> vec4f {
  let r = length(i.uv);
  if (r > 1.0) { return vec4f(0.0); }
  // its shape: a soft ball, the rim eaten into lumps (the puff's own noise: the same lumps every frame), and the billows
  let s = vec2f(p.seed * 0.41, p.seed * 0.73);
  let n = noiseAt(i.uv * 0.42 + s).r;
  let n2 = noiseAt(i.uv * 0.29 + s.yx * 1.3 + 0.5).b;
  // (always nothing at the sprite's edge: no circle shows round a big one)
  let m = smoothstep(1.0, 0.4, r + (n - 0.5) * 0.75 + (n2 - 0.5) * 0.3 * r) * (0.82 + 0.18 * n) * smoothstep(1.0, 0.8, r);
  if (m < 0.004) { return vec4f(0.0); }
  // the flat base: nothing below it (and an anvil's flat top: nothing above)
  var baseK = smoothstep(p.base - 1.0, p.base + p.r * 0.3, i.wp.y);
  if (p.ax.x > 0.0) { baseK *= 1.0 - smoothstep(p.ax.x - p.r * 0.25, p.ax.x + 1.0, i.wp.y); }
  // soft against the scene, and fading as the lens comes up to it
  let soft = dot(saturate((z - vec4f(i.vz)) / max(p.r * 0.5, 1.0)), vec4f(0.25));
  let near = sat((i.vz - p.r * 0.25) / max(p.r * 1.2, 1.0));
  let a = m * 0.96 * baseK * soft * near * p.alpha;
  if (a < 0.002) { return vec4f(0.0); }
  // the normal: the ball's (bumped by its lumps), bent toward where the puff sits on the cloud
  let toCam = normalize(frame.camPos - i.wp);
  let zz = sqrt(max(1.0 - r * r, 0.0));
  let nb = normalize(i.right * (i.uv.x + (n - 0.5) * 0.5) + i.up * (i.uv.y + (n - 0.5) * 0.5) + toCam * (zz + 0.15));
  let shapeN = normalize(p.off + vec3f(0.0, 0.35, 0.0));
  let N = normalize(nb * 0.55 + shapeN);
  let L = world.sunDir;
  // in the cloud's own shade: the far side from the light and toward the base (deeper in a thick cloud)
  let toward = dot(normalize(p.off + vec3f(0.0, 0.05, 0.0)), L);
  let open = sat(0.3 + 0.65 * toward + 0.55 * p.off.y);
  // (and a thick cloud's base, seen from below, gets only what filters down through it)
  let deep = p.dark * (1.0 - sat(p.off.y * 1.6)) * sat(0.25 - N.y * 0.9);
  let shade = mix(0.28, 1.0, open * open) * (1.0 - p.dark * (1.0 - open) * 0.8) * (1.0 - 0.8 * deep);
  let lit = sat((dot(N, L) + 0.35) / 1.35) * shade * (0.78 + 0.4 * n2);
  // (under a deck: the light straight through lights one side, the rest comes from everywhere)
  let S = i.keyS;
  // the sky's light from above, the ground's from below (the base greyer, darker under a big one)
  let amb = i.amb * mix(0.62, 1.1, sat(p.off.y * 1.4 + 0.15)) * (0.88 + 0.2 * n2) * (1.0 - 0.45 * p.dark * (1.0 - sat(p.off.y))) * (1.0 - 0.5 * deep);
  // the silver rim: light through the thin edges against the light (and a cloud against the sun glows through)
  let mu = dot(-toCam, L);
  let rim = hg(mu, 0.6) * (pow(1.0 - m, 1.2) * 1.6 + 0.22) * (1.0 - 0.6 * p.dark) + hg(mu, 0.2) * 0.1;
  // (light scattered on through the cloud: its shaded side is grey, never dark); the cities' light under it at night
  let hk = p.base / 1200.0;
  let city = vec3f(1.0, 0.6, 0.34) * CL.misc.x * world.sunTrue.w * (1.0 - sat(p.off.y)) * 0.5 / (1.0 + hk * hk);
  // (a thick cloud's shaded side gets less of the sky's light scattered round to it)
  let ambK = PI * 0.5 * (1.0 - 0.35 * p.dark * (1.0 - open));
  // (painted: the lit side bright, the shaded side and the base lavender: cloudlayer.wgsl cloudPaint)
  var col = 0.94 * cloudPaint(S * (lit * (0.42 + 0.1 * p.dark) + 0.07) + S * rim * 0.37, i.keyD * 0.2 * shade + amb * ambK) + city;
  col = col * i.ap.a + i.ap.rgb;
  return vec4f(col * a, a);
}

fn lensColor(p: Puff, i: VOut, z: vec4f) -> vec4f {
  let ro = frame.camPos;
  let rd = normalize(i.wp - ro);
  let cs = p.ax.x; let sn = p.ax.y;
  let q = vec3f(cs * (ro.x - p.pos.x) + sn * (ro.z - p.pos.z), ro.y - p.pos.y, -sn * (ro.x - p.pos.x) + cs * (ro.z - p.pos.z)) / p.off;
  let d = vec3f(cs * rd.x + sn * rd.z, rd.y, -sn * rd.x + cs * rd.z) / p.off;
  let A = dot(d, d); let B = dot(q, d); let C = dot(q, q) - 1.0;
  let disc = B * B - A * C;
  if (disc <= 0.0) { return vec4f(0.0); }
  let sq = sqrt(disc);
  let t1 = (-B + sq) / A;
  if (t1 <= 0.0) { return vec4f(0.0); }
  let ta = max((-B - sq) / A, 0.0);
  let zr = z / max(dot(rd, frame.camFwd), 1e-4);
  let chord = clamp(min(vec4f(t1), zr) - ta, vec4f(0.0), vec4f(t1 - ta));
  // densest in the middle, laminar bands through it (the stacked look of a wave cloud), a faint streak along the wind
  let mid = q + d * (0.5 * (ta + t1));
  // (thin toward the rim — the edge of a wave cloud is soft, its middle dense — its rim frayed a little, laminar bands
  // through it, streaks along the wind on its face)
  let wob = noiseAt(vec2f(mid.x * 0.16 + p.seed, mid.z * 0.5 + p.seed * 2.0));
  let core = sat(1.0 - dot(mid, mid) * (0.85 + 0.35 * wob.r));
  let band = 0.75 + 0.25 * sin(mid.y * 7.0 + p.seed * 40.0 + wob.b * 3.0);
  let streak = noiseAt(vec2f(mid.z * 0.08 + p.seed, mid.x * 0.6)).a;
  let sigma = p.ax.z / (2.0 * p.off.y) * (0.03 + 1.4 * pow(core, 1.5)) * band * (0.65 + 0.7 * streak);
  let a4 = 1.0 - exp(-sigma * chord);
  let a = dot(a4, vec4f(0.25)) * p.alpha;
  if (a < 0.002) { return vec4f(0.0); }
  // the light: the entry point's normal, the underside in the lens's own shade, silver where it's thin
  let e = q + d * ta;
  let nl = e / p.off;
  let N = normalize(vec3f(cs * nl.x - sn * nl.z, nl.y, sn * nl.x + cs * nl.z));
  let L = world.sunDir;
  // the light through it: from below, what its thickness over the point lets down; from the side and above, what
  // its surface sends back toward the light's side
  let tauV = p.ax.z * sqrt(max(1.0 - e.x * e.x - e.z * e.z, 0.0)) * (0.3 + 0.7 * core);
  let R = 0.113 * tauV / (1.0 + 0.113 * tauV);
  let muS = max(L.y, 0.03);
  let under = max(1.0 - R - exp(-0.28 * tauV / muS), 0.0) * muS * 1.5 * (0.8 + 0.4 * streak);
  let side = sat(dot(N, L) * 0.6 + 0.4);
  let lit = mix(side, under, sat(-N.y * 1.6));
  let S = i.keyS + i.keyD;
  let mu = dot(rd, L);
  let tauMid = sigma * (t1 - ta);
  let rim = hg(mu, 0.65) * exp(-tauMid * 0.35) * 1.4 + hg(mu, 0.2) * 0.08;
  var col = 0.95 * cloudPaint(S * (lit * 0.42 + 0.06) + S * rim * 0.37, i.amb * PI * 0.5 * (0.6 + 0.4 * N.y));
  col = col * i.ap.a + i.ap.rgb;
  return vec4f(col * a, a);
}

fn virgaColor(p: Puff, i: VOut, z: vec4f) -> vec4f {
  let v = (1.0 - i.uv.y) * 0.5;
  let x = i.uv.x;
  let streak = noiseAt(vec2f(v * 0.12 + p.seed, x * 0.55 + p.seed * 3.0)).a;
  let fall = smoothstep(0.0, 0.15, v) * (1.0 - smoothstep(0.25, 1.0, v + (streak - 0.5) * 0.35));
  let soft = dot(saturate((z - vec4f(i.vz)) / max(p.r * 0.5, 1.0)), vec4f(0.25));
  // (a sheet: seen from underneath it is edge-on, and gone)
  let side = 1.0 - smoothstep(0.55, 0.9, abs(normalize(frame.camPos - i.wp).y));
  let a = pow(max(1.0 - x * x, 0.0), 2.0) * fall * (0.45 + 0.6 * streak) * 0.24 * p.alpha * soft * side;
  if (a < 0.002) { return vec4f(0.0); }
  let L = world.sunDir;
  let toCam = normalize(frame.camPos - i.wp);
  let S = i.keyS + i.keyD;
  var col = cloudPaint(S * (0.05 + 0.5 * hg(dot(-toCam, L), 0.55)), i.amb * PI * 0.45) * (1.0 - 0.45 * p.dark);
  col = col * i.ap.a + i.ap.rgb;
  return vec4f(col * a, a);
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let p = drifted(i.ii);
  let z = textureLoad(sceneZ, vec2i(i.pos.xy), 0);
  var o: vec4f;
  if (p.kind > 1.5) { o = virgaColor(p, i, z); } else if (p.kind > 0.5) { o = lensColor(p, i, z); } else { o = puffColor(p, i, z); }
  if (o.a < 0.002) { discard; }
  return o;
}

// ------------------------------------------------------------------ into the cloud shadow map
struct SOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) wp: vec3f,
  @location(2) @interpolate(flat) ii: u32,
}

@vertex fn vsShadow(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SOut {
  let p = drifted(ii);
  var quad = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let c = quad[vi];
  var o: SOut;
  let e1 = cloudSky.e1.xyz; let e2 = cloudSky.e2.xyz;
  // (a puff's shadow is its core; virga casts none)
  let r = select(p.r * 0.8, p.r, p.kind > 0.5);
  o.wp = p.pos + (e1 * c.x + e2 * c.y) * r;
  let u = (dot(o.wp, e1) - cloudSky.e1.w) / cloudSky.map.x * 2.0;
  let v = (dot(o.wp, e2) - cloudSky.e2.w) / cloudSky.map.x * 2.0;
  o.pos = select(vec4f(u, v, 0.5, 1.0), vec4f(2.0, 2.0, 0.5, 1.0), p.kind > 1.5);
  o.uv = c;
  o.ii = ii;
  return o;
}

@fragment fn fsShadow(i: SOut) -> @location(0) vec4f {
  let p = drifted(i.ii);
  var t = 1.0;
  var low = p.pos.y - p.r * 0.6;
  if (p.kind > 0.5) {
    // the lens: the chord along the light's ray through it
    let L = world.sunDir;
    let cs = p.ax.x; let sn = p.ax.y;
    let q = vec3f(cs * (i.wp.x - p.pos.x) + sn * (i.wp.z - p.pos.z), i.wp.y - p.pos.y, -sn * (i.wp.x - p.pos.x) + cs * (i.wp.z - p.pos.z)) / p.off;
    let d = vec3f(cs * L.x + sn * L.z, L.y, -sn * L.x + cs * L.z) / p.off;
    let A = dot(d, d); let B = dot(q, d); let C = dot(q, q) - 1.0;
    let disc = B * B - A * C;
    if (disc <= 0.0) { discard; }
    let chord = 2.0 * sqrt(disc) / A;
    t = exp(-0.28 * p.ax.z / (2.0 * p.off.y) * chord * p.alpha);
    low = p.pos.y - p.off.y;
  } else {
    let r = length(i.uv);
    if (r > 1.0) { discard; }
    t = 1.0 - smoothstep(1.0, 0.25, r) * 0.82 * p.alpha * select(1.0, 1.15, p.dark > 0.5);
  }
  return vec4f(t, t, t, low);
}
