// The heroine (the waterbending game's Blender-built DNC1 mesh, its M2b body: a smooth head whose face is drawn, one
// mass of hair): dual-quaternion skinned, quantised vertices with a material id, strand flow (hair) and baked AO /
// thickness / curvature. Her own shading, after autumnvibes' dancers — pre-integrated skin with the face painted into
// it, Marschner hair along its locks, cloth with sheen, silk and light through it — lit by this world: the sun (or
// moon) through the cascades, the sky's irradiance and ground bounce, the air between (the rooms' light, boulder's,
// is a shim here: interior/indoor.wgsl). Katara, Aang and Iroh all drawn by it: the others by their CastLook.
#include "./../interior/indoor.wgsl"

struct HeroU {
  pal: array<vec4f, 16>,  // per material slot: linear rgb, silk
  qmin: vec4f,            // the quantisation box (bind space); w the nose tip's height
  qmax: vec4f,            // w glow (unused)
  eye: vec4f,             // the eyes: x half spacing, y height, z depth, w radius (bind space)
  face: vec4f,            // x brow height, y mouth height, z lip half width, w nose tip depth
  iris: vec4f,            // rgb iris colour, w blush
  sway: vec4f,            // xyz a push on loose cloth (wind, flight), w the jaw's opening
  params: vec4f,          // x specular scale, y night fill, z ground albedo, w -
  // the drawn face: the head bone's skin transform (a dual quaternion, bind -> world), the rig's face state (blink,
  // smile, brows down, wide) and (gaze x, gaze y in the head's axes, jaw open, squint)
  headR: vec4f, headD: vec4f, face2: vec4f, face3: vec4f,
  // the face model's state (cast/face.ts; L the character's left, side 1): faceB each brow's inner and outer end
  // (-1 down .. 1 up: inL, inR, outL, outR); faceE the brows knit, the upper lids (-1 wide .. 1 heavy), the lower lids
  // raised, the eyes shut in a smile's arch; faceM the mouth open, spread (ee), rounded (oo), pressed (m b p); faceN the
  // upper teeth showing, the tongue's tip up, the lower lip under the teeth (f v), a smirk (-1 the right .. 1 the
  // left); faceX a frown, a blush
  faceB: vec4f, faceE: vec4f, faceM: vec4f, faceN: vec4f, faceX: vec4f,
  // the hair's lock lines' axis, bind space: the pole in front of the forehead (y, z), the gather at the nape (y, z)
  hair: vec4f,
  // ink and paint: x the ink line's width (px at 1080 lines), y how far the key light leans toward the camera, z first
  // person (headless), w -
  toon: vec4f,
  // the post chain's grade (post.wgsl), for the display lock: x exposure bias (stops), y saturation, z contrast,
  // w the look's punch; post2: x warmth, y bloom
  post: vec4f, post2: vec4f,
  // another of the cast this shader draws (all zero: her): x the eyes larger by this fraction, y round eyes (taller,
  // no flick past the lid, a bigger iris), z thinner brows, w the airbender's arrows (1); actorIris the drawn iris
  // (display rgb, w 1: instead of her blue); actor2 the mouth: x wider by this factor, y its smile deeper by this
  // factor (0: hers), z open in a grin (the teeth, the tongue: 1), w creases at its corners when he smiles; actor3
  // the shading (w 1: set): x the baked occlusion's push into shade (hers 1), y the terminator moved toward the shade
  // (more of him lit), z his figure in the light or the shade as one (the light over his head decides it all: no
  // bands where a roof's shadow edge crosses him); actor4 an old man's face: x his brows his own (hair, not drawn), y
  // heavy upper lids (no flick, a fold above them, a line under the eye), z crow's feet, w lines across the forehead
  actor: vec4f, actorIris: vec4f, actor2: vec4f, actor3: vec4f, actor4: vec4f,
  // another's head reshaped in bind space (sculptPt; all zero: as built): sculpt x the cranium wider over the temples,
  // y the jaw tapered toward the chin, z the chin longer (m down), w the back of the skull deeper; sculpt2 the ears:
  // x their palette slot, y larger by, z out from the head by (m), w down by (m); sculpt3 where an ear meets the head
  // (x its distance out, y, z)
  sculpt: vec4f, sculpt2: vec4f, sculpt3: vec4f,
  // the colour model per palette slot (display rgb, w 1: instead of celFill's) and its shade (an rgb multiple of the
  // fill, w 1: instead of celShadeMul's)
  cel: array<vec4f, 16>, celShade: array<vec4f, 16>,
  // the arrows (arrowMarks), bind space: [0] the head's (its band's half width, the arrowhead's tip height, length and
  // half width); the left arm's (the right's mirrored): [1] the elbow (w the band's half width), [2] the wrist (w the
  // arrowhead's half width), [3] the middle finger's knuckle, [4] the back of the hand's way; [5] x the head's middle
  // (z), y the band's end at the nape
  mark: array<vec4f, 6>,
  // her legs, world space, for the skirt to keep outside: the left thigh (hip -> knee), shin (knee -> ankle), the
  // right's; each [a, b] with the radius at that end in w (legs[0].w 0: off — another of the cast)
  legs: array<vec4f, 8>,
}
@group(2) @binding(0) var<storage, read> DQ: array<vec4f>;
@group(2) @binding(1) var<uniform> HU: HeroU;

struct VIn {
  @location(0) pm: vec4u,
  @location(1) nrm: vec4f,
  @location(2) flow: vec4f,
  @location(3) bones: vec4u,
  @location(4) weights: vec4f,
};
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wpos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) local: vec3f,
  @location(3) lnrm: vec3f,
  @location(4) @interpolate(flat) mat: u32,
  @location(5) flow: vec3f,
  @location(6) across: vec4f,
  @location(7) bake: vec4f,
  @location(8) q: vec4f,
};

/** a vertex's blended dual quaternion; `lin` how far it goes linear instead (skinPos, skinDir) */
struct SkinDQ { r: vec4f, d: vec4f, lin: f32 };
fn skinDQ(v: VIn) -> SkinDQ {
  let b = v.bones * 2u;
  let r0 = DQ[b.x];
  let r1 = DQ[b.y]; let r2 = DQ[b.z]; let r3 = DQ[b.w];
  // (antipodal quaternions blended the short way round)
  let w = v.weights * vec4f(1.0, select(1.0, -1.0, dot(r1, r0) < 0.0), select(1.0, -1.0, dot(r2, r0) < 0.0), select(1.0, -1.0, dot(r3, r0) < 0.0));
  let r = r0 * w.x + r1 * w.y + r2 * w.z + r3 * w.w;
  let d = DQ[b.x + 1u] * w.x + DQ[b.y + 1u] * w.y + DQ[b.z + 1u] * w.z + DQ[b.w + 1u] * w.w;
  let n = 1.0 / max(length(r), 1e-6);
  // (a bone turned nearly half round from the first — a thigh stepping through against the other one in a lunge, the
  // cloth between them on both — has no short way round: the blend's sign turns over from one frame to the next and the
  // vertex jumps across. From ~145° apart it goes linear instead, the positions blended: no flip, a little pinch)
  let c = abs(vec3f(dot(r1, r0), dot(r2, r0), dot(r3, r0)));
  let near = select(vec3f(1.0), c, v.weights.yzw > vec3f(0.04));
  return SkinDQ(r * n, d * n, 1.0 - smoothstep(0.08, 0.3, min(near.x, min(near.y, near.z))));
}
fn dqDir(q: SkinDQ, p: vec3f) -> vec3f { return p + 2.0 * cross(q.r.xyz, cross(q.r.xyz, p) + q.r.w * p); }
fn dqPoint(q: SkinDQ, p: vec3f) -> vec3f {
  let t = 2.0 * (q.r.w * q.d.xyz - q.d.w * q.r.xyz + cross(q.r.xyz, q.d.xyz));
  return dqDir(q, p) + t;
}
/** a point through each bone, blended linearly (the eyes, and the dual quaternions' near-antipodal fallback) */
fn linPoint(v: VIn, lp: vec3f) -> vec3f {
  let b = v.bones * 2u;
  let p = dqPoint(SkinDQ(DQ[b.x], DQ[b.x + 1u], 0.0), lp) * v.weights.x + dqPoint(SkinDQ(DQ[b.y], DQ[b.y + 1u], 0.0), lp) * v.weights.y
    + dqPoint(SkinDQ(DQ[b.z], DQ[b.z + 1u], 0.0), lp) * v.weights.z + dqPoint(SkinDQ(DQ[b.w], DQ[b.w + 1u], 0.0), lp) * v.weights.w;
  return p / max(dot(v.weights, vec4f(1.0)), 1e-4);
}
/** the eyes (material 8 marks rigid parts skinned linearly: no dual-quaternion bulge); elsewhere the dual quaternion,
 *  faded to linear where its bones are nearly opposite (skinDQ) */
fn skinPos(v: VIn, q: SkinDQ, lp: vec3f) -> vec3f {
  if ((v.pm.w & 0xffu) == 8u) { return linPoint(v, lp); }
  if (q.lin <= 0.0) { return dqPoint(q, lp); }
  return mix(dqPoint(q, lp), linPoint(v, lp), q.lin);
}
/** a direction (a normal, a strand's flow) skinned as skinPos skins the point */
fn skinDir(v: VIn, q: SkinDQ, p: vec3f) -> vec3f {
  if (q.lin <= 0.0) { return dqDir(q, p); }
  let b = v.bones * 2u;
  let l = dqDir(SkinDQ(DQ[b.x], DQ[b.x + 1u], 0.0), p) * v.weights.x + dqDir(SkinDQ(DQ[b.y], DQ[b.y + 1u], 0.0), p) * v.weights.y
    + dqDir(SkinDQ(DQ[b.z], DQ[b.z + 1u], 0.0), p) * v.weights.z + dqDir(SkinDQ(DQ[b.w], DQ[b.w + 1u], 0.0), p) * v.weights.w;
  return mix(dqDir(q, p), l, q.lin);
}
fn bindPos(v: VIn) -> vec3f { return HU.qmin.xyz + vec3f(v.pm.xyz) / 65535.0 * (HU.qmax.xyz - HU.qmin.xyz); }
/** the skirt (the dress and its fur trim between the waist and the hem) kept outside her legs: a knee driven up, a
 *  thigh swung through, would otherwise pass through the cloth skinned partly to the panels hanging from her waist
 *  (rig.ts's chains) — each vertex inside a leg's tapered capsule goes out to its surface */
fn clearLegs(v: VIn, p: vec3f, lp: vec3f) -> vec3f {
  let m = v.pm.w & 0xffu;
  if (HU.legs[0].w <= 0.0 || (m != 1u && m != 13u) || lp.y > 0.9 || lp.y < 0.25) { return p; }
  var q = p;
  for (var i = 0u; i < 4u; i++) {
    let a = HU.legs[i * 2u];
    let b = HU.legs[i * 2u + 1u];
    let ab = b.xyz - a.xyz;
    let u = clamp(dot(q - a.xyz, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
    let c = a.xyz + ab * u;
    let d = q - c;
    let l = length(d);
    let r = mix(a.w, b.w, u);
    if (l < r && l > 1e-5) { q = c + d * (r / l); }
  }
  return q;
}
/** the head reshaped (HU.sculpt): Aang's skull rounder than the build's egg — the jaw tapered to a chin, a little more
 *  over the temples and behind, the ears larger and standing out. The drawn face rides its chart (an angle round the
 *  head's axis and a height), so the eyes and mouth keep their places as the surface under them moves */
fn sculpting(p: vec3f) -> bool {
  let S = HU.sculpt; let h = p.y - HU.eye.y;
  return abs(S.x) + abs(S.y) + abs(S.z) + abs(S.w) + abs(HU.sculpt2.y) > 0.0 && h > -0.17 && abs(p.x) < 0.17 && abs(p.z) < 0.2;
}
fn sculptPt(p: vec3f, mat: u32) -> vec3f {
  if (!sculpting(p)) { return p; }
  let S = HU.sculpt; let S2 = HU.sculpt2; let E = HU.eye;
  var q = p;
  let sx = select(-1.0, 1.0, p.x > 0.0);
  // the ears: larger round where they meet the head, further out, a little lower
  if (abs(f32(mat) - S2.x) < 0.5) {
    let c = vec3f(sx * HU.sculpt3.x, HU.sculpt3.y, HU.sculpt3.z);
    q = c + (p - c) * vec3f(1.0 + S2.y * 1.5, 1.0 + S2.y, 1.0 + S2.y) + vec3f(sx * S2.z, -S2.w, 0.0);
  }
  let h = q.y - E.y;
  // the cranium over the temples, and behind
  let wT = smoothstep(-0.015, 0.05, h) * (1.0 - 0.45 * smoothstep(0.09, 0.15, h));
  q.x *= 1.0 + S.x * wT;
  if (q.z < 0.0) { q.z *= 1.0 + S.w * smoothstep(-0.005, 0.06, h); }
  // the jaw tapered toward the chin (its front, not the neck under it), the chin a little longer
  let jy = (1.0 - smoothstep(-0.1, -0.025, h)) * (1.0 - 0.7 * (1.0 - smoothstep(-0.15, -0.112, h)));
  let jz = smoothstep(-0.015, 0.07, q.z);
  q.x *= 1.0 - S.y * jy * jz;
  q.y -= S.z * (1.0 - smoothstep(-0.1, -0.055, h)) * smoothstep(0.0, 0.075, q.z) * (1.0 - 0.6 * (1.0 - smoothstep(-0.15, -0.115, h)));
  return q;
}
/** the normal through the reshaping (from its change across two steps along the surface) */
fn sculptNrm(v: VIn) -> vec3f {
  let n = v.nrm.xyz;
  let p = bindPos(v);
  if (!sculpting(p)) { return n; }
  let m = v.pm.w & 0xffu;
  let t1 = normalize(cross(n, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.y) > 0.9)));
  let t2 = cross(n, t1);
  let q0 = sculptPt(p, m);
  let nn = cross(sculptPt(p + t1 * 0.002, m) - q0, sculptPt(p + t2 * 0.002, m) - q0);
  let l = length(nn);
  if (l < 1e-9) { return n; }
  return select(nn / l, -nn / l, dot(nn, n) < 0.0);
}
fn deformedPos(v: VIn, q: SkinDQ) -> vec3f {
  // loose cloth (the high nibble of the material word) takes the wind's push, more toward its hem
  let lo = f32(v.pm.w >> 8u) / 15.0;
  let mat = v.pm.w & 0xffu;
  let lp = sculptPt(bindPos(v), mat);
  return clearLegs(v, skinPos(v, q, lp), lp) + HU.sway.xyz * (lo * lo);
}

/** first person (HU.toon.z = 1: the view at her eyes, on a bike, in a car's seat, in the harness): her head and what's
 *  on it (and the hair hanging from it: a beard) left out of the main view, the eye being inside it; a mirror's view
 *  (frame.user.x = -1) shows her whole */
fn headless(v: VIn) -> bool {
  if (HU.toon.z < 0.5 || frame.user.x < -0.5) { return false; }
  // (and the hair hanging below the chin in front of the neck — Iroh's beard — which would hang in the view; a braid
  // down the back is left whole)
  let m = v.pm.w & 0xffu; let p = bindPos(v);
  return p.y > HU.eye.y - 0.17 || ((m == 3u || m == 10u) && p.y > HU.eye.y - 0.45 && p.z > 0.0);
}

@vertex fn vs(v: VIn) -> VOut {
  var o: VOut;
  let Q = skinDQ(v);
  let wp = deformedPos(v, Q);
  o.pos = select(frame.viewProj * vec4f(wp, 1.0), vec4f(0.0, 0.0, -2.0, 1.0), headless(v));
  o.wpos = wp;
  let mat = v.pm.w & 0xffu;
  o.nrm = normalize(skinDir(v, Q, sculptNrm(v)) + vec3f(0.0, 1e-6, 0.0));
  o.local = bindPos(v);
  o.lnrm = v.nrm.xyz;
  o.mat = mat;
  o.flow = skinDir(v, Q, v.flow.xyz);
  // hair: across the strand + the strand coordinate; skin: x = the lip area (the flow slot is free there)
  let hairy = mat == 3u || mat == 10u;
  o.across = select(vec4f(v.flow.z, 0.0, 0.0, v.flow.w), vec4f(cross(v.flow.xyz, v.nrm.xyz), v.flow.w), hairy);
  o.bake = vec4f(v.nrm.w, v.flow.w, v.flow.x, v.flow.y);
  o.q = Q.r;
  return o;
}

@vertex fn vsShadow(v: VIn) -> @builtin(position) vec4f {
  return frame.viewProj * vec4f(deformedPos(v, skinDQ(v)), 1.0);
}

// ---------------------------------------------------------------- the light on her
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn sq(x: f32) -> f32 { return x * x; }
fn hh13(p: vec3f) -> f32 { var q = fract(p * 0.1031); q += dot(q, q.zyx + 31.32); return fract((q.x + q.y) * q.z); }
fn hh3i(i: vec3i) -> f32 { return hashF(hashU((u32(i.x) * 73856093u) ^ (u32(i.y) * 19349663u) ^ (u32(i.z) * 83492791u))); }
fn vnoise3(p: vec3f) -> f32 {
  let i = vec3i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hh3i(i), hh3i(i + vec3i(1, 0, 0)), u.x), mix(hh3i(i + vec3i(0, 1, 0)), hh3i(i + vec3i(1, 1, 0)), u.x), u.y),
    mix(mix(hh3i(i + vec3i(0, 0, 1)), hh3i(i + vec3i(1, 0, 1)), u.x), mix(hh3i(i + vec3i(0, 1, 1)), hh3i(i + vec3i(1, 1, 1)), u.x), u.y), u.z);
}

/** the light reaching her at a point: the key (the sun or the moon) as radiance-like E/pi and its visibility, the
 *  ambient irradiance/pi toward a normal (the sky and the ground's bounce outside; the room's probes and lamps inside) */
struct Lit { key: vec3f, L: vec3f, sh: vec3f, room: u32 };
fn litAt(p: vec3f, N: vec3f) -> Lit {
  var o: Lit;
  o.L = world.sunDir;
  o.key = sunLight(p) / PI;
  o.room = roomOf(p, N);
  return o;
}
fn ambientAt(p: vec3f, N: vec3f, room: u32) -> vec3f {
  if (room > 0u) {
    return indoorAmbient(p, N, room) + lampIrradiance(p, N, room, -1.0) / PI;
  }
  // the sky from above; the sunlit ground bouncing up from below
  let below = saturate(0.5 - 0.5 * N.y);
  let ground = HU.params.z * (sunLight(p) * max(world.sunDir.y, 0.0) / PI + skyAmbient(vec3f(0.0, 1.0, 0.0)));
  // by night a faint fill from the camera's side (a film crew's moonlight): she'd read as a cut-out against the land
  let fill = sunLight(p) / PI * HU.params.y * world.sunTrue.w * (0.35 + 0.65 * max(dot(N, normalize(frame.camPos - p)), 0.0));
  return skyAmbient(N) + ground * below * below * 0.8 + fill;
}
/** sun visibility (normal-offset, the cascades' 3x3 PCF) */
fn keyVis(p: vec3f, N: vec3f) -> f32 {
  if (world.sunCos < -0.05 && world.moon.z < 0.5) { return 0.0; }
  return sunShadow(p, N);
}
/** the key light through a thin layer (ears, cloth lit from behind): the fast tap past the surface */
fn keyVisThrough(p: vec3f, depth: f32) -> f32 { return sunShadowFast(p + world.sunDir * (depth + 0.03), vec3f(0.0, 1.0, 0.0)); }
/** the sky's reflection: sharp for glossy surfaces, the soft ambient for rough ones; the room's indoors */
fn envSpec(p: vec3f, R: vec3f, rough: f32, room: u32) -> vec3f {
  if (room > 0u) {
    let probe = roomReflection(p, R, rough);
    return select(indoorAmbient(p, R, room) * PI, probe.rgb, probe.w > 0.5);
  }
  let sky = skyRadiance(normalize(vec3f(R.x, max(R.y, 0.02), R.z)));
  let soft = skyAmbient(R) * PI;
  return mix(mix(sky, soft, smoothstep(0.15, 0.75, rough)), soft * 0.8, smoothstep(0.05, -0.3, R.y));
}

fn fresnelS(f0: f32, c: f32) -> f32 { return f0 + (1.0 - f0) * pow(1.0 - clamp(c, 0.0, 1.0), 5.0); }
/** GGX (normalised, Schlick fresnel) times N.L: the BRDF times the cosine */
fn hggx(N: vec3f, V: vec3f, L: vec3f, rough: f32, f0: f32) -> f32 {
  let H = normalize(L + V);
  let a = rough * rough;
  let nh = max(dot(N, H), 0.0);
  let d = a * a / (PI * pow(nh * nh * (a * a - 1.0) + 1.0, 2.0));
  let nl = max(dot(N, L), 0.0);
  let nv = max(dot(N, V), 1e-3);
  let k = a * 0.5;
  let g = 1.0 / ((nl * (1.0 - k) + k) * (nv * (1.0 - k) + k));
  return d * g * fresnelS(f0, dot(H, V)) * nl * 0.25;
}
/** anisotropic GGX (silk threads along T), times N.L */
fn ggxAniso(N: vec3f, V: vec3f, L: vec3f, T: vec3f, ax: f32, ay: f32, f0: f32) -> f32 {
  let H = normalize(L + V);
  let B = cross(N, T);
  let nh = dot(N, H);
  let th = dot(T, H);
  let bh = dot(B, H);
  let d = th * th / (ax * ax) + bh * bh / (ay * ay) + nh * nh;
  let D = 1.0 / (PI * ax * ay * d * d);
  let nl = max(dot(N, L), 0.0);
  let nv = max(dot(N, V), 1e-3);
  let k = (ax + ay) * 0.25;
  let G = 1.0 / ((nl * (1.0 - k) + k) * (nv * (1.0 - k) + k));
  return D * G * fresnelS(f0, dot(H, V)) * nl * 0.25 * step(0.0, nh);
}
/** Charlie sheen (Estevez & Kulla) with Ashikhmin visibility: the soft grazing glow of fibres, times N.L */
fn charlie(N: vec3f, V: vec3f, L: vec3f, rough: f32) -> f32 {
  let H = normalize(L + V);
  let nh = max(dot(N, H), 0.0);
  let inv = 1.0 / max(rough, 0.07);
  let sin2 = max(1.0 - nh * nh, 0.0078125);
  let D = (2.0 + inv) * pow(sin2, inv * 0.5) / (2.0 * PI);
  let nl = max(dot(N, L), 0.0);
  let nv = max(dot(N, V), 1e-3);
  return D / (4.0 * (nl + nv - nl * nv) + 1e-3) * nl;
}
fn weave(p: vec3f, s: f32) -> f32 { return sin(p.x * s) * sin(p.y * s * 1.03 + p.z * s * 0.7) * 0.5 + 0.5; }
/** rotate by a unit quaternion / its inverse */
fn qrot(q: vec4f, p: vec3f) -> vec3f { return p + 2.0 * cross(q.xyz, cross(q.xyz, p) + q.w * p); }
fn qrotInv(q: vec4f, p: vec3f) -> vec3f { return p + 2.0 * cross(-q.xyz, cross(-q.xyz, p) + q.w * p); }
/** 3D value noise and its gradient (Quilez): pores, unevenness */
fn vnoise3d(p: vec3f) -> vec4f {
  let i = vec3i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let du = 6.0 * f * (1.0 - f);
  let a = hh3i(i); let b = hh3i(i + vec3i(1, 0, 0)); let c = hh3i(i + vec3i(0, 1, 0)); let d = hh3i(i + vec3i(1, 1, 0));
  let e = hh3i(i + vec3i(0, 0, 1)); let g = hh3i(i + vec3i(1, 0, 1)); let h = hh3i(i + vec3i(0, 1, 1)); let k = hh3i(i + vec3i(1, 1, 1));
  let k1 = b - a; let k2 = c - a; let k3 = e - a; let k4 = a - b - c + d; let k5 = a - c - e + h; let k6 = a - b - e + g;
  let k7 = -a + b + c - d + e - g - h + k;
  let v = a + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z;
  let gr = du * vec3f(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z, k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x, k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y);
  return vec4f(v, gr);
}
/** plain weave height at (u, v) in threads: warp along v, weft along u, each passing over / under the next */
fn weaveH(u: f32, v: f32) -> f32 {
  let iu = floor(u);
  let iv = floor(v);
  let a = sin(fract(u) * PI);
  let b = sin(fract(v) * PI);
  let ew = 0.5 + 0.5 * cos(PI * (v - 0.5 + iu));
  let ef = 0.5 - 0.5 * cos(PI * (u - 0.5 + iv));
  return max(sqrt(a) * (0.55 + 0.45 * ew), sqrt(b) * (0.55 + 0.45 * ef));
}
fn weave3(u: f32, v: f32) -> vec3f {
  let e = 0.08;
  let h = weaveH(u, v);
  return vec3f(h, (weaveH(u + e, v) - h) / e, (weaveH(u, v + e) - h) / e);
}

struct Fabric { alb: vec3f, silk: f32, thin: f32, ao: f32, N: vec3f, V: vec3f, T: vec3f, wpos: vec3f };
/** cloth: wrapped diffuse, Charlie sheen, an anisotropic silk highlight, light through thin cloth from behind */
fn shadeFabric(f: Fabric, lt: Lit, sh: f32, amb: vec3f) -> vec3f {
  let L = lt.L;
  let key = lt.key;
  let N = f.N;
  let V = f.V;
  let NdL = dot(N, L);
  let nv = max(dot(N, V), 1e-3);
  let occ = mix(0.25, 1.0, f.ao);
  let specOcc = clamp(f.ao * 1.4 - 0.25, 0.0, 1.0);
  let ks = HU.params.x;
  // diffuse: cloth scatters light a little past the terminator
  let w = mix(0.3, 0.45, f.thin);
  let diff = max((NdL + w) / (1.0 + w), 0.0) / (1.0 + w * 0.5);
  var c = f.alb * (key * diff * sh * mix(1.0, f.ao, 0.3) + amb * occ);
  let lit = clamp(diff * sh, 0.0, 1.0);
  c += key * 4.0 * lit * (1.0 - lit) * 0.1 * f.alb * f.alb / max(luma(f.alb), 0.02);
  // sheen: fibres catch light at grazing angles (tinted toward the cloth colour, brighter for silk)
  let sheenCol = mix(sqrt(f.alb) * 0.85, vec3f(0.75), mix(0.04, 0.15, f.silk));
  c += key * sh * charlie(N, V, L, mix(0.55, 0.3, f.silk)) * sheenCol * mix(0.45, 1.0, f.silk) * specOcc * ks;
  // the sky's sheen round the silhouette
  c += amb * sheenCol * pow(1.0 - nv, 3.0) * mix(0.2, 0.4, f.silk) * occ;
  // silk: a long anisotropic highlight across the threads, and the sky in it at grazing angles
  if (f.silk > 0.4) {
    let aniso = ggxAniso(N, V, L, f.T, 0.16, 0.5, 0.045);
    c += key * sh * aniso * (f.silk - 0.4) * mix(vec3f(1.0), f.alb * 2.0 + vec3f(0.3), 0.35) * specOcc * ks;
    c += envSpec(f.wpos, reflect(-V, N), 0.3, lt.room) * fresnelS(0.045, nv) * (f.silk - 0.4) * 0.9 * specOcc;
  }
  // thin cloth lit from behind glows in a deeper, more saturated version of its colour
  if (f.thin > 0.01 && NdL < 0.2) {
    let shT = keyVisThrough(f.wpos, 0.012);
    let tcol = pow(f.alb, vec3f(0.62)) * mix(vec3f(1.0), normalize(f.alb + vec3f(1e-3)) * 1.7, 0.35);
    let back = max(-NdL, 0.0);
    let fwd = pow(max(dot(-V, L), 0.0), 3.0);
    c += key * shT * tcol * f.thin * (back * 0.55 + fwd * back * 0.9 + fwd * 0.25) * mix(0.7, 1.0, f.silk);
  }
  let kick = pow(clamp(dot(-V, L) * 0.5 + 0.5, 0.0, 1.0), 2.0);
  c += key * sh * pow(1.0 - nv, 3.0) * kick * sheenCol * 0.6 * occ;
  return c;
}

// ---------------------------------------------------------------- hair (Karis 2016, "Physically based hair shading")
fn hairG(B: f32, t: f32) -> f32 { return exp(-0.5 * t * t / (B * B)) / (2.5066283 * B); }
fn hairBSDF(T: vec3f, V: vec3f, L: vec3f, base: vec3f, rough: f32, jit: f32) -> vec3f {
  let sinL = clamp(dot(T, L), -1.0, 1.0);
  let sinV = clamp(dot(T, V), -1.0, 1.0);
  let cosThetaD = max(cos(0.5 * abs(asin(sinV) - asin(sinL))), 0.05);
  let Lp = L - sinL * T;
  let Vp = V - sinV * T;
  let cosPhi = dot(Lp, Vp) * inverseSqrt(dot(Lp, Lp) * dot(Vp, Vp) + 1e-4);
  let cosHalfPhi = sqrt(clamp(0.5 + 0.5 * cosPhi, 0.0, 1.0));
  let n = 1.55;
  let f0 = 0.0465;
  let shift = 0.035 + jit;
  let r2 = rough * rough;
  var S = vec3f(0.0);
  {
    // R: the white surface glint, shifted toward the root
    let Mp = hairG(r2 * 1.4142 * cosHalfPhi + 1e-3, sinL + sinV + shift * 2.0);
    let Fp = fresnelS(f0, sqrt(clamp(0.5 + 0.5 * dot(L, V), 0.0, 1.0)));
    S += vec3f(Mp * 0.25 * cosHalfPhi * Fp * 1.25);
  }
  {
    // TT: light through the strand (back-lit hair glows in its own colour)
    let Mp = hairG(r2 * 0.5 + 1e-3, sinL + sinV - shift);
    let a = 1.0 / n;
    let h = cosHalfPhi * (1.0 + a * (0.6 - 0.8 * cosPhi));
    let f = fresnelS(f0, cosThetaD * sqrt(clamp(1.0 - h * h, 0.0, 1.0)));
    let Tp = pow(base, vec3f(0.5 * sqrt(clamp(1.0 - (h * a) * (h * a), 0.0, 1.0)) / cosThetaD));
    S += Mp * exp(-3.65 * cosPhi - 3.98) * (1.0 - f) * (1.0 - f) * Tp;
  }
  {
    // TRT: the coloured secondary highlight, shifted toward the tip
    let Mp = hairG(r2 * 2.0 + 1e-3, sinL + sinV - shift * 4.0);
    let f = fresnelS(f0, cosThetaD * 0.5);
    let Tp = pow(base, vec3f(0.8 / cosThetaD));
    S += Mp * exp(17.0 * cosPhi - 16.78) * (1.0 - f) * (1.0 - f) * f * Tp;
  }
  return S;
}

// ---------------------------------------------------------------- the drawn face (the waterbending game's, M2b)
// Her head is a smooth oval: the face is drawn — painted into the skin and lit with it — on a chart of the head's own
// space (the angle round its up axis, and height), so it rides the head rigidly whatever the face bones do: a heavy
// upper lid line with a flick past the outer corner, a thin partial lower lid, a tall iris under the lid following the
// gaze, a pupil and one catchlight, thick brows tapering out, a small nose hook, a mouth line and the short line under
// it. Blinks, squints, smiles and brows-down reshape the curves; the far eye is widened as the head turns away.
struct FaceInk { col: vec3f, a: f32 };
fn srgbToLin(c: vec3f) -> vec3f { return pow(max(c, vec3f(0.0)), vec3f(2.2)); }
fn lineCov(d: f32, halfW: f32, px: f32) -> f32 {
  let hw = max(halfW, px * 0.6);
  return (1.0 - smoothstep(hw - px * 0.5, hw + px * 0.5, abs(d))) * min(1.0, halfW / max(px * 0.6, 1e-6) * 1.6 + 0.35);
}
/** a parabola peaked at (xp, yp) reaching (x0, y0) on its left and (x1, y1) on its right: its height at x and slope */
fn arc2(x: f32, xp: f32, yp: f32, x0: f32, y0: f32, x1: f32, y1: f32) -> vec2f {
  let left = x < xp;
  let k = select((yp - y1) / max(sq(x1 - xp), 1e-8), (yp - y0) / max(sq(x0 - xp), 1e-8), left);
  return vec2f(yp - k * sq(x - xp), -2.0 * k * (x - xp));
}
fn segDist(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a; let ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-10), 0.0, 1.0));
}
/** one eye (and its brow), in eye-local metres: x toward the outer corner, y up */
fn drawEye(x0: f32, y0: f32, side: f32, widen: f32, px0: f32, lit: f32) -> FaceInk {
  let ek = 1.08 * (1.0 + HU.actor.x);
  let rnd = HU.actor.y;
  let px = px0 / ek;
  var o = FaceInk(vec3f(0.0), 0.0);
  let F2 = HU.face2; let F3 = HU.face3;
  // (the upper lids wide or heavy, the lower raised; shut by a blink, or in a smile's arch: the eyes' own laugh)
  let lidUp = HU.faceE.y; let lidLow = max(HU.faceE.z, 0.0); let happy = clamp(HU.faceE.w, 0.0, 1.0);
  let wide = max(-lidUp, 0.0); let heavyLid = max(lidUp, 0.0);
  let blink = max(clamp(F2.x, 0.0, 1.0), happy);
  let hk = happy / max(blink, 1e-3);
  let x = x0 / widen / ek;
  let y = y0 / ek;
  let xi = -0.0185; let yi = -0.0015 + 0.0008 * rnd; let xo = 0.0205; let yo = 0.0025 - 0.0022 * rnd;
  let heavy = HU.actor4.y;
  let ytop = 0.0135 + 0.003 * wide - 0.0058 * heavyLid - 0.002 * lidLow + 0.0048 * rnd - 0.0045 * heavy;
  let ybot = -0.0115 + 0.0045 * lidLow + 0.002 * F2.y - 0.0042 * rnd - 0.0012 * wide;
  var up = arc2(x, -0.002, ytop, xi, yi, xo, yo);
  let shutB = vec2f(-0.0035 - 9.0 * sq(x - 0.001), -18.0 * (x - 0.001));
  let shutH = vec2f(0.0014 - 24.0 * sq(x - 0.001), -48.0 * (x - 0.001));
  up = mix(up, mix(shutB, shutH, hk), blink);
  // (smiling, the lower lid pushes up to meet the arch: a smiling squint, then the eye shut in it)
  var lo = arc2(-x, -0.001, -ybot, -xo, -yo, -xi, -yi) * vec2f(-1.0, 1.0);
  lo = mix(lo, vec2f(shutH.x - 0.0007, shutH.y), smoothstep(0.0, 1.0, happy) * 0.92);
  let inX = smoothstep(xi - 0.0004, xi + 0.0004, x) * (1.0 - smoothstep(xo - 0.0004, xo + 0.0004, x));
  let open = inX * smoothstep(-px, px, up.x - y) * smoothstep(-px, px, y - lo.x) * (1.0 - smoothstep(0.85, 1.0, blink)) * (1.0 - smoothstep(0.7, 0.9, happy));
  let white = mix(vec3f(0.8, 0.81, 0.9), vec3f(0.93, 0.93, 0.95), lit);
  var c = white;
  let ic = vec2f(0.001 + F3.x * 0.011 * side / widen, 0.0021 + F3.y * 0.008);
  let ir = vec2f(0.0097, 0.0127) * (1.0 + 0.2 * rnd);
  let q = (vec2f(x, y) - ic) / ir;
  let rq = length(q);
  let iris = 1.0 - smoothstep(1.0 - px / ir.x, 1.0 + px / ir.x, rq);
  let ownIris = HU.actorIris.w > 0.5;
  var irisC = mix(select(vec3f(0.33, 0.5, 0.86), HU.actorIris.rgb, ownIris), select(vec3f(0.13, 0.22, 0.54), HU.actorIris.rgb * 0.5, ownIris), smoothstep(-0.4, 0.75, q.y));
  irisC = mix(irisC, select(vec3f(0.07, 0.1, 0.26), HU.actorIris.rgb * 0.25, ownIris), smoothstep(0.78, 0.95, rq));
  c = mix(c, irisC, iris);
  let pr = vec2f(0.0034, 0.0049) * (1.0 + 0.18 * rnd);
  let pq = (vec2f(x, y) - ic) / pr;
  c = mix(c, vec3f(0.04, 0.04, 0.09), 1.0 - smoothstep(1.0 - px / pr.x, 1.0 + px / pr.x, length(pq)));
  let gr = 0.0021 * (1.0 + 0.3 * rnd);
  let gl = length(vec2f(x, y) - ic - vec2f(-0.0032 * side, 0.0048) * (1.0 + 0.2 * rnd));
  c = mix(c, vec3f(1.0), 1.0 - smoothstep(gr - px * 0.5, gr + px * 0.5, gl));
  // (round eyes: a second, smaller glint low across the pupil)
  let gl2 = length(vec2f(x, y) - ic - vec2f(0.0036 * side, -0.0042));
  c = mix(c, vec3f(1.0), (1.0 - smoothstep(0.0009 - px * 0.5, 0.0009 + px * 0.5, gl2)) * rnd);
  o.col = c; o.a = open;
  let ink = vec3f(0.1, 0.06, 0.05);
  let dU = (y - up.x) / sqrt(1.0 + up.y * up.y);
  let wU = mix(mix(0.0006, 0.0019, smoothstep(xi, xo, x)), mix(0.0013, 0.002, smoothstep(xi, xo, x)), rnd) * mix(1.0, mix(0.8, 1.15, hk), blink) * (1.0 + 0.5 * heavy + 0.25 * heavyLid);
  var lid = lineCov(dU, wU, px) * smoothstep(xi - 0.0012, xi + 0.0006, x) * (1.0 - smoothstep(xo - 0.0004, xo + 0.0008, x));
  let flick = segDist(vec2f(x, y), vec2f(xo - 0.001, mix(yo, -0.002, blink) + 0.0004), vec2f(xo + 0.0042, mix(yo + 0.0028, -0.0035, blink)));
  lid = max(lid, lineCov(flick, mix(0.0016, 0.0005, smoothstep(xo, xo + 0.0042, x)), px) * (1.0 - rnd) * (1.0 - heavy) * (1.0 - hk * blink));
  let dL = (y - lo.x) / sqrt(1.0 + lo.y * lo.y);
  let low = lineCov(dL, 0.0005, px) * smoothstep(-0.006, -0.002, x) * (1.0 - smoothstep(xo - 0.002, xo, x)) * (1.0 - blink);
  var lines = max(lid, low * 0.85);
  // (an old man's: the lid's fold above it, a bag under the eye, crow's feet at the outer corner)
  if (heavy > 0.0) {
    let dF = (y - up.x - 0.0036) / sqrt(1.0 + up.y * up.y);
    let fold = lineCov(dF, 0.00045, px) * smoothstep(xi + 0.004, xi + 0.008, x) * (1.0 - smoothstep(xo - 0.004, xo, x)) * (1.0 - blink) * heavy;
    let bag = lineCov(segDist(vec2f(x, y), vec2f(-0.006, ybot - 0.0042), vec2f(0.012, ybot - 0.0028)), 0.0004, px) * heavy;
    lines = max(lines, max(fold, bag) * 0.7);
  }
  let crow = HU.actor4.z;
  if (crow > 0.0) {
    let c1 = segDist(vec2f(x, y), vec2f(xo + 0.0035, yo + 0.0004), vec2f(xo + 0.0095, yo + 0.0034));
    let c2 = segDist(vec2f(x, y), vec2f(xo + 0.0035, yo - 0.0022), vec2f(xo + 0.0092, yo - 0.0052));
    lines = max(lines, lineCov(min(c1, c2), 0.0004, px) * 0.7 * crow);
  }
  o.col = mix(o.col, ink, lines); o.a = max(o.a, lines);
  // the brow: each end up or down on its own (worry: the inner ends up; anger: down and drawn together), its arch's
  // peak moving toward the end that's raised more
  let be = select(HU.faceB.yw, HU.faceB.xz, side > 0.0);
  let bIn = be.x; let bOut = be.y; let knit = max(HU.faceE.x, 0.0);
  let xin = -0.016 - 0.0024 * knit;
  let yin = 0.0198 + 0.0076 * bIn - 0.0036 * knit + 0.002 * wide;
  let yout = 0.0222 + 0.0054 * bOut - 0.0008 * knit + 0.0015 * wide;
  let tilt = clamp(bIn - bOut, -1.0, 1.0);
  let xp = 0.004 - 0.0075 * max(tilt, 0.0) + 0.004 * max(-tilt, 0.0);
  let yp = max(0.0252 + 0.0034 * (bIn + bOut) * 0.5 - 0.003 * knit + 0.002 * wide, max(yin, yout) + 0.0009);
  let br = arc2(x, xp, yp, xin, yin, 0.0215, yout);
  let dB = (y - br.x) / sqrt(1.0 + br.y * br.y);
  let bw = mix(0.0026 * (1.0 + 0.35 * knit), 0.0009, smoothstep(xin, 0.0215, x)) * (1.0 - 0.5 * HU.actor.z);
  let brow = lineCov(dB, bw, px) * smoothstep(xin - 0.0015, xin + 0.0005, x) * (1.0 - smoothstep(0.0205, 0.0225, x)) * (1.0 - HU.actor4.x);
  o.col = mix(o.col, vec3f(0.12, 0.08, 0.07), brow); o.a = max(o.a, brow);
  return o;
}
fn drawFace(hp: vec3f, px: f32, lit: f32, yawV: f32) -> FaceInk {
  var o = FaceInk(vec3f(0.0), 0.0);
  let E = HU.eye;
  let u = atan2(hp.x, hp.z) * 0.1;
  let v = hp.y;
  let ue = atan2(E.x, E.z + E.w) * 0.1;
  // a blush: a soft flush over each cheek with the show's three little strokes across it
  let bl = clamp(HU.faceX.y, 0.0, 1.0);
  if (bl > 0.01) {
    let bq = vec2f((abs(u) - ue - 0.003) / 0.0105, (v - E.y + 0.0175) / 0.0052);
    let bf = (1.0 - smoothstep(0.35, 1.0, length(bq))) * 0.38 * bl;
    let bs = (abs(u) - ue - 0.003) * 1.0 + (v - E.y + 0.0175) * 0.55;
    let st = lineCov(fract(bs / 0.0042 + 0.5) - 0.5, 0.06, px / 0.0042) * (1.0 - smoothstep(0.5, 0.75, length(bq))) * 0.5 * smoothstep(0.4, 0.8, bl);
    let ba = max(bf, st);
    if (ba > 0.0) { o.col = mix(vec3f(0.93, 0.42, 0.42), vec3f(0.78, 0.25, 0.28), st / max(ba, 1e-4)); o.a = ba; }
  }
  for (var k = 0; k < 2; k++) {
    let side = select(-1.0, 1.0, k == 0);
    let far = side * yawV < 0.0;
    let turn = smoothstep(0.25, 0.9, abs(yawV));
    let off = abs(abs(yawV) - atan2(E.x, E.z + E.w));
    let widen = select(clamp(0.62 / max(cos(off), 0.2), 1.0, 1.75), 1.0 + 0.35 * turn, far);
    let fade = select(1.0, 1.0 - smoothstep(0.95, 1.1, abs(yawV)), far);
    if (fade <= 0.0) { continue; }
    let fwdShift = select(smoothstep(0.7, 1.45, abs(yawV)) * 0.0045, 0.0, far);
    let e = drawEye((u - side * (ue - fwdShift)) * side, v - E.y, side, widen, px, lit);
    o.col = mix(o.col, e.col, e.a * fade); o.a = max(o.a, e.a * fade);
  }
  // the nose: a small hook at its tip, on the side away from the viewer
  let sn = select(1.0, -1.0, yawV > 0.08);
  let ny = HU.qmin.w;
  let nx = u * sn;
  let nArc = ny - 0.0024 + 130.0 * sq(max(nx, 0.0));
  let dN = (v - nArc) / sqrt(1.0 + sq(260.0 * max(nx, 0.0)));
  let nose = lineCov(dN, 0.0006, px) * smoothstep(-0.0015, 0.0005, nx) * (1.0 - smoothstep(0.0055, 0.0068, nx));
  o.col = mix(o.col, vec3f(0.36, 0.22, 0.16), nose); o.a = max(o.a, nose);
  let ns = (1.0 - smoothstep(0.9, 1.1, length(vec2f((nx - 0.0026) / 0.0036, (v - ny + 0.0046) / 0.0018)))) * (1.0 - nose);
  o.col = mix(o.col, vec3f(0.5, 0.33, 0.24), ns * 0.85); o.a = max(o.a, ns * 0.85);
  // the mouth (cast/face.ts's): one line, its corners up with a smile, down with a frown, one up in a smirk; open, the
  // shape between the upper lip's line and the lower's — round (o, oo: the top arched up too), spread (ee: wide and
  // boxy), a grin's D under the smile — the upper teeth along its top (the lower too when it's spread), the tongue at
  // its bottom, its tip up behind the teeth (l, n, th), the rim inked; pressed (m b p) a firmer line with its corners
  // tucked; the lower lip under the upper teeth (f, v); the short line of the lower lip under it all; creases at the
  // corners of a big smile (actor2.w)
  let my = HU.face.y;
  let F2 = HU.face2;
  let A2 = HU.actor2;
  let smile = F2.y; let frown = max(HU.faceX.x, 0.0);
  let open = clamp(HU.faceM.x, 0.0, 1.0); let spread = clamp(HU.faceM.y, 0.0, 1.0);
  let rnd = clamp(HU.faceM.z, 0.0, 1.0); let press = clamp(HU.faceM.w, 0.0, 1.0);
  let teeth = clamp(HU.faceN.x, 0.0, 1.0); let tongue = clamp(HU.faceN.y, 0.0, 1.0);
  let tuck = clamp(HU.faceN.z, 0.0, 1.0); let smirk = clamp(HU.faceN.w, -1.0, 1.0);
  let grin = select(0.0, 1.0, A2.z > 0.5);
  let mw = 0.0115 * select(1.0, A2.x, A2.x > 0.0) * (1.0 + 0.1 * smile + 0.2 * spread - 0.42 * rnd - 0.1 * press + 0.3 * open * grin * smile);
  let smK = select(1.0, A2.y, A2.y > 0.0);
  let sd = select(-1.0, 1.0, u > 0.0);
  let cUp = (0.0028 * smK * smile * (1.0 - 0.6 * rnd) - 0.0034 * frown) * (1.0 - 0.45 * press) + 0.0024 * smirk * sd;
  let un = u / mw;
  let mArc = my + 0.0012 + cUp * un * un;
  let mSl = 2.0 * cUp * un / mw;
  let mIn = 1.0 - smoothstep(mw - 0.0008, mw + 0.0004, abs(u));
  // open: the lips apart over the opening's width, its depth, the upper lip lifted (rounded: most; a smile flattens it)
  let isOpen = smoothstep(0.03, 0.09, open);
  let ow = mw * mix(0.94, 0.82, rnd);
  let gx = clamp(u / ow, -1.0, 1.0);
  let prof = pow(max(1.0 - gx * gx, 0.0), mix(0.5, 0.3, spread * (1.0 - rnd)));
  let depth = (0.0165 + 0.0025 * rnd) * open;
  let lift = (0.001 + 0.0042 * rnd) * open * (1.0 - 0.75 * smile * (1.0 - rnd));
  let top = mArc + lift * prof;
  let bot = mArc - depth * prof - 0.0004 * isOpen;
  let gap = max(top - bot, 1e-5);
  let inO = isOpen * step(abs(u), ow) * smoothstep(bot - px, bot + px, v) * (1.0 - smoothstep(top - px, top + px, v));
  if (inO > 0.0) {
    // (deep and dark at the back, warmer toward the lower lip)
    var gc = mix(vec3f(0.36, 0.09, 0.08), vec3f(0.22, 0.045, 0.05), smoothstep(bot, top, v));
    // the upper teeth: a band down from the top, shorter toward the corners; the lower ones when the lips spread
    let tH = min(0.0028 * teeth, gap * 0.48) * pow(prof, 0.35);
    let tU = smoothstep(top - tH - px, top - tH + px, v);
    let tL = (1.0 - smoothstep(bot + 0.0017 * spread * teeth * prof - px, bot + 0.0017 * spread * teeth * prof + px, v)) * step(0.05, spread * teeth);
    // the tongue: a soft mound along the bottom, its tip raised to the teeth for l, n, th
    let tq = vec2f(u / (ow * 0.78), (v - bot) / max(gap * (0.42 + 0.25 * tongue), 1e-5));
    var tg = (1.0 - smoothstep(1.0 - px / (gap * 0.4 + 1e-5), 1.0 + px / (gap * 0.4 + 1e-5), length(vec2f(tq.x, max(tq.y, 0.0))))) * smoothstep(0.15, 0.6, gap / 0.006);
    let tip = length(vec2f(u / (ow * 0.32), (v - (top - tH - 0.0016)) / 0.0021));
    tg = max(tg, (1.0 - smoothstep(1.0 - px / 0.002, 1.0 + px / 0.002, tip)) * smoothstep(0.35, 0.7, tongue));
    gc = mix(gc, mix(vec3f(0.66, 0.26, 0.27), vec3f(0.84, 0.42, 0.4), smoothstep(-0.2, 0.7, tq.y)), tg * (1.0 - tU));
    gc = mix(gc, mix(vec3f(0.95, 0.93, 0.9), vec3f(0.78, 0.74, 0.74), smoothstep(top - tH * 0.3, top - tH, v)), tU);
    gc = mix(gc, vec3f(0.9, 0.88, 0.86), tL * (1.0 - tU));
    o.col = mix(o.col, gc, inO); o.a = max(o.a, inO);
  }
  // (its rim: the lower lip's edge inked)
  let bSl = mSl - depth * (-2.0 * gx * select(0.5, 0.3, spread > 0.5)) / max(ow * max(prof, 0.15), 1e-5);
  let rim = lineCov((v - bot) / sqrt(1.0 + bSl * bSl), 0.00048, px) * isOpen * step(abs(u), ow * 0.995) * smoothstep(0.0, 0.25, prof);
  o.col = mix(o.col, vec3f(0.16, 0.08, 0.06), rim); o.a = max(o.a, rim);
  // f, v: the upper teeth over the lower lip, just under the line
  if (tuck > 0.02) {
    let tw = mw * 0.55;
    let tb = mArc - 0.0021 * tuck;
    let ft = (1.0 - smoothstep(tw - px, tw + px, abs(u))) * smoothstep(tb - px, tb + px, v) * (1.0 - smoothstep(mArc - px, mArc + px, v)) * smoothstep(0.2, 0.6, tuck);
    o.col = mix(o.col, vec3f(0.94, 0.92, 0.89), ft); o.a = max(o.a, ft);
    let fe = lineCov(v - tb, 0.0004, px) * (1.0 - smoothstep(tw - px, tw + px, abs(u))) * smoothstep(0.2, 0.6, tuck);
    o.col = mix(o.col, vec3f(0.36, 0.22, 0.16), fe * 0.8); o.a = max(o.a, fe * 0.8);
  }
  if (A2.w > 0.0) {
    let cy = my + 0.0012 + cUp;
    let cr = segDist(vec2f(abs(u), v), vec2f(mw + 0.0003, cy + 0.0028), vec2f(mw + 0.0013, cy - 0.0003));
    let crease = lineCov(cr, 0.00045, px) * smoothstep(0.55, 0.85, smile) * A2.w * 0.8;
    o.col = mix(o.col, vec3f(0.36, 0.22, 0.16), crease); o.a = max(o.a, crease);
  }
  // the line: the upper lip's edge (the top of the opening when open), firmer pressed; pressed, its corners tucked in
  let lY = mix(mArc, top, isOpen);
  let lSl = mSl + lift * (-2.0 * gx) / max(ow * max(prof, 0.15), 1e-5) * 0.5 * isOpen;
  let dM = (v - lY) / sqrt(1.0 + lSl * lSl);
  let mouth = lineCov(dM, mix(0.00065, 0.0003, smoothstep(0.0, mw, abs(u))) * (1.0 + 0.7 * press), px) * mIn;
  o.col = mix(o.col, vec3f(0.16, 0.08, 0.06), mouth); o.a = max(o.a, mouth);
  if (press > 0.25) {
    let cy = my + 0.0012 + cUp;
    let tk = lineCov(segDist(vec2f(abs(u), v), vec2f(mw - 0.0002, cy + 0.0013), vec2f(mw + 0.0004, cy - 0.0011)), 0.00035, px) * smoothstep(0.25, 0.7, press);
    o.col = mix(o.col, vec3f(0.36, 0.22, 0.16), tk * 0.8); o.a = max(o.a, tk * 0.8);
  }
  // the lower lip's short line, under the opening when it's open, up under the teeth for f and v
  let llY = min(my - 0.0068 + 0.0022 * tuck - 0.0012 * press, bot - 0.0026 * isOpen + (1.0 - isOpen) * 1.0);
  let llW = mix(0.0042, 0.0032, rnd) * select(1.0, sqrt(A2.x), A2.x > 0.0);
  let lipT = lineCov(v - llY - 0.002 * sq(u / llW), 0.0005, px) * (1.0 - smoothstep(llW - 0.0014, llW, abs(u)));
  o.col = mix(o.col, vec3f(0.36, 0.22, 0.16), lipT * 0.9); o.a = max(o.a, lipT * 0.9);
  return o;
}
/** a world point in the head's bind space (the head bone's skin transform undone) */
fn headSpace(wp: vec3f) -> vec3f { return dqPoint(SkinDQ(vec4f(-HU.headR.xyz, HU.headR.w), vec4f(-HU.headD.xyz, HU.headD.w), 0.0), wp); }
/** the hair mass's lock field: the angle round the axis from a pole in front of the forehead to the gather at the nape
 *  (a fraction of a turn: 0 along the part), and the way its locks run there (bind space) */
fn lockAngle(hp: vec3f) -> f32 {
  let P = vec3f(0.0, HU.hair.x, HU.hair.y); let T = vec3f(0.0, HU.hair.z, HU.hair.w);
  let ax = normalize(T - P + vec3f(0.0, 0.0, 1e-6));
  var e1 = normalize(cross(ax, vec3f(1.0, 0.0, 0.0)));
  e1 = select(e1, -e1, e1.y < 0.0);
  let e2 = cross(ax, e1);
  var rel = hp - T;
  rel -= ax * dot(rel, ax);
  return atan2(dot(rel, e2), dot(rel, e1)) * 0.15915494;
}

@fragment fn fs(in: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let mat = in.mat;
  var N = normalize(in.nrm);
  if (!ff) { N = -N; }
  let p = in.wpos;
  let V = normalize(frame.camPos - p);
  let lt = litAt(p, N);
  let L = lt.L;
  let key = lt.key;
  let ks = HU.params.x;
  let NdL = dot(N, L);
  let nv = max(dot(N, V), 1e-3);
  let lp = in.local;
  // (the skinning rotation, bind -> world; never normalised from ~0 where two bones' signs meet across a triangle)
  let q = in.q * inverseSqrt(max(dot(in.q, in.q), 1e-8));
  // fine detail fades once it's smaller than a pixel (derivatives in uniform control flow): the bind-space size of a
  // pixel, and how fast the hair's strand coordinate runs across the screen
  let pix = length(fwidth(lp));
  let wf = 1.0 - smoothstep(0.3, 0.8, pix * 2600.0 / 6.2832);
  // (the face's chart and pixel size, and the hair's lock field and its rate: derivatives in uniform control flow)
  let chp = headSpace(p);
  let cfpx = max(length(fwidth(vec2f(atan2(chp.x, chp.z) * 0.1, chp.y))), 1e-6);
  let cfz = faceZoneOf(chp);
  let lockA = lockAngle(lp);
  let mass = in.across.w > -0.3 && abs(HU.hair.w) > 1e-4;
  // (the mass's strands: its lock angle cut into fine locks; the braid and loops their own coordinate)
  let strandC = select(in.across.w, lockA * 3.0, mass);
  let sw = fwidth(strandC * 48.0);
  let ao = clamp(in.bake.x, 0.0, 1.0);
  let occ = mix(0.22, 1.0, ao);
  let specOcc = clamp(ao * 1.4 - 0.25, 0.0, 1.0);
  let amb = ambientAt(p, N, lt.room);
  let backlit = pow(max(dot(-V, L), 0.0), 4.0);
  let kick = pow(clamp(dot(-V, L) * 0.5 + 0.5, 0.0, 1.0), 2.0);
  let rimF = pow(1.0 - nv, 3.0) * occ;
  let E = HU.eye;
  let alb = HU.pal[min(mat, 15u)].rgb;
  let sh = keyVis(p, N);
  var col = vec3f(0.0);

  if (mat == 0u || mat == 11u) {
    // ---------- skin: lips (baked from the sculpted outline), blush, a warmer nose, deeper lids, painted in bind space
    var skin = alb;
    let lipM = clamp(in.across.x, 0.0, 1.0);
    var oily = 0.0;
    let front = smoothstep(0.02, 0.05, lp.z - E.z + 0.06);
    let head = smoothstep(E.y - 0.16, E.y - 0.12, lp.y) * front;
    if (head > 0.0) {
      let fx = abs(lp.x);
      let mq = vec2f(lp.x / (HU.face.z * 1.05), (lp.y - HU.face.y) / 0.0085);
      let lipC = HU.pal[11].rgb * select(1.0, 0.86, mq.y > 0.0) * mix(0.8, 1.06, smoothstep(0.3, 0.85, lipM));
      skin = mix(skin, lipC, smoothstep(0.05, 0.55, lipM) * head);
      // the line where the lips meet (fading as the mouth opens)
      let part = (1.0 - smoothstep(0.0, 0.06, abs(mq.y + 0.05 - 0.4 * mq.x * mq.x))) * (1.0 - smoothstep(0.75, 1.05, abs(mq.x)));
      skin = mix(skin, HU.pal[11].rgb * 0.2, part * head * smoothstep(HU.face.w - 0.024, HU.face.w - 0.012, lp.z) * (1.0 - smoothstep(0.03, 0.2, HU.sway.w)));
      // blush over the cheekbones, the nose warmer, the lids and the socket under the brow deeper
      let cq = vec2f((fx - E.x * 1.15) / 0.03, (lp.y - (E.y - 0.027)) / 0.018);
      skin = mix(skin, skin * vec3f(1.16, 0.86, 0.8), (1.0 - smoothstep(0.0, 1.0, length(cq))) * HU.iris.w * 2.4 * head);
      let nq = vec2f(lp.x / 0.014, (lp.y - HU.qmin.w + 0.002) / 0.012);
      let noseZ = (1.0 - smoothstep(0.25, 1.0, length(nq))) * smoothstep(HU.face.w - 0.032, HU.face.w - 0.012, lp.z);
      skin = mix(skin, skin * vec3f(1.1, 0.9, 0.86), noseZ * head * 0.6);
      let lq = vec2f((fx - E.x) / (E.w * 1.6), (lp.y - E.y - E.w * 0.78) / (E.w * 0.72));
      skin *= mix(vec3f(1.0), vec3f(0.86, 0.79, 0.81), (1.0 - smoothstep(0.3, 1.0, length(lq))) * head);
      // the oily T-zone: a crisper sheen there, the cheeks stay soft
      oily = max(noseZ, (1.0 - smoothstep(0.01, 0.032, fx)) * smoothstep(E.y + 0.022, E.y + 0.045, lp.y)) * head;
      // brown skin is never one flat colour: deeper round the mouth and down the sides, lighter on the high planes
      let mo = vec2f(lp.x / (HU.face.z * 1.75), (lp.y - HU.face.y + 0.002) / 0.021);
      let peri = (1.0 - smoothstep(0.55, 1.0, length(mo))) * (1.0 - smoothstep(0.05, 0.45, lipM));
      skin *= mix(vec3f(1.0), vec3f(0.9, 0.87, 0.87), peri * head * 0.8);
      let sides = smoothstep(0.045, 0.078, fx) * smoothstep(E.y + 0.05, E.y - 0.005, lp.y);
      skin *= mix(vec3f(1.0), vec3f(0.92, 0.9, 0.9), sides * head);
      let ck = vec2f((fx - E.x * 1.25) / 0.016, (lp.y - (E.y - 0.021)) / 0.009);
      let highs = max(max((1.0 - smoothstep(0.0, 0.04, fx)) * smoothstep(E.y + 0.018, E.y + 0.05, lp.y),
        (1.0 - smoothstep(0.0, 0.007, fx)) * smoothstep(HU.qmin.w + 0.006, E.y - 0.004, lp.y) * (1.0 - smoothstep(E.y + 0.004, E.y + 0.02, lp.y))),
        exp(-dot(ck, ck)));
      skin *= mix(vec3f(1.0), vec3f(1.06, 1.05, 1.0), highs * head);
    }
    // the face, drawn as the show draws it, painted into the skin and lit with it
    if (cfz > 0.5) {
      let Vh = dqDir(SkinDQ(vec4f(-HU.headR.xyz, HU.headR.w), vec4f(0.0), 0.0), V);
      let fd = drawFace(chp, cfpx, 1.0, atan2(Vh.x, Vh.z));
      skin = mix(skin, srgbToLin(fd.col) * 0.6, fd.a);
    }
    if (HU.actor.w > 0.5) { skin = mix(skin, vec3f(0.12, 0.3, 0.62), arrowMarks(lp, pix * 0.75)); }
    // pores and fine unevenness (bind space, gone below a pixel): a broken, skin-like sheen
    let fpo = 1.0 - smoothstep(0.15, 0.5, pix * 1600.0);
    let fpb = 1.0 - smoothstep(0.15, 0.5, pix * 430.0);
    var po = vec4f(0.5, 0.0, 0.0, 0.0);
    var Ns = N;
    if (fpb > 0.0) {
      po = vnoise3d(lp * 1600.0);
      let pb = vnoise3d(lp * 430.0 + vec3f(17.0));
      var gs = po.yzw * (0.05 * fpo * (1.0 - 0.8 * lipM)) + pb.yzw * (0.028 * fpb);
      gs = qrot(q, gs);
      Ns = normalize(N - (gs - N * dot(gs, N)));
      skin *= 1.0 + (pb.x - 0.5) * 0.08 * fpb;
    }
    let thin = 1.0 - clamp(in.bake.y, 0.0, 1.0);
    let curv = clamp(in.bake.z, 0.0, 1.0);
    let cav = clamp(-in.bake.z * 1.6, 0.0, 1.0);
    // inside the mouth: a deep warm red, in shade
    let inMouth = smoothstep(0.1, 0.75, clamp(in.bake.w, 0.0, 1.0));
    skin = mix(skin, vec3f(0.36, 0.085, 0.085), inMouth);
    let mshade = 1.0 - inMouth * mix(0.92, 0.7, HU.sway.w);
    let socc = mix(0.58, 1.0, pow(ao, 0.6)) * mshade * (1.0 - 0.22 * cav);
    // thin, curved parts (ears, the nose tip, knuckles) a little redder
    skin = mix(skin, skin * vec3f(1.08, 0.9, 0.88), clamp(thin * 0.6 + curv * 0.25, 0.0, 0.25));
    // pre-integrated scattering (Penner): per channel the terminator widens with curvature, red reaching furthest
    let w = vec3f(0.3, 0.13, 0.08) + curv * vec3f(0.38, 0.2, 0.13);
    let diff = pow(clamp((vec3f(NdL) + w) / (1.0 + w), vec3f(0.0), vec3f(1.0)), vec3f(1.0) + w);
    // shadow edges bleed red
    let shc = pow(vec3f(sh), vec3f(0.5, 0.9, 1.2));
    let direct = key * diff * shc * mix(1.0, ao, 0.2) * mshade * (1.0 - 0.15 * cav);
    var trans = vec3f(0.0);
    if (thin > 0.05 && (NdL < 0.1 || backlit > 0.01)) {
      let shT = keyVisThrough(p, 0.014);
      trans = key * shT * vec3f(1.0, 0.32, 0.16) * thin * thin * (max(-NdL, 0.0) * 0.6 + backlit) * skin * 0.6;
    }
    // ambient: warm and saturated in shade (light bleeds through skin), occluded in creases
    let ambS = (luma(amb) * vec3f(1.25, 0.96, 0.82) * 0.45 + amb * 0.55) * socc;
    col = skin * (direct + ambS) + skin * skin * ambS * 0.25 + trans;
    // specular: an oily lobe (crisper on the T-zone and the lips) and a broad one, broken up by the pores
    let micro = (po.x - 0.5) * 0.1 * fpo;
    let r1 = clamp(mix(mix(0.5, 0.38, oily), 0.26, lipM) + micro, 0.18, 0.7);
    let sOcc = specOcc * mshade * (1.0 - 0.55 * cav);
    let spec = hggx(Ns, V, L, r1, 0.028) * 0.7 + hggx(Ns, V, L, 0.62, 0.028) * 0.3;
    col += key * sh * spec * mix(1.0, 1.8, lipM) * sOcc * ks;
    col += envSpec(p, reflect(-V, Ns), r1 + 0.12, lt.room) * fresnelS(0.028, max(dot(Ns, V), 1e-3)) * sOcc * mix(0.22, 0.45, max(oily, lipM));
    // rim: the sky wrapping the silhouette (fine hair), warm when back-lit
    col += rimF * (luma(amb) * 0.3 * skin + key * kick * skin * vec3f(1.0, 0.6, 0.45) * sh);
  } else if (mat == 12u) {
    // ---------- beads, the pendant: polished stone, lit a little through itself, a crisp clear coat
    let wrap = max((NdL + 0.45) / 1.45, 0.0);
    col = alb * (key * wrap * sh * mix(0.55, 1.0, ao) + amb * mix(0.4, 1.0, ao) * 1.15);
    col += alb * key * sh * (pow(1.0 - nv, 2.0) * kick * 0.6 + backlit * 0.25);
    col += key * sh * (hggx(N, V, L, 0.1, 0.05) * 1.8 + hggx(N, V, L, 0.32, 0.05) * 0.35) * specOcc * ks;
    col += envSpec(p, reflect(-V, N), 0.1, lt.room) * fresnelS(0.05, nv) * mix(0.35, 1.0, ao);
  } else if (mat == 3u) {
    // ---------- hair: Marschner lobes along the strand flow, clumps shading each other
    // (the mass's locks run from the part back to the gather: along the axis, across the angle)
    var flowW = in.flow;
    if (mass) {
      let ax = normalize(vec3f(0.0, HU.hair.z - HU.hair.x, HU.hair.w - HU.hair.y));
      flowW = qrot(q, ax);
    }
    var T = flowW - N * dot(flowW, N);
    if (dot(T, T) < 1e-6) { T = cross(N, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-4); }
    T = normalize(T);
    let clump = strandC;
    // strands: the strand coordinate cut into fine strands, each its own tone and highlight shift
    let sc = clump * 48.0;
    let sid = i32(floor(sc));
    let sfr = fract(sc);
    let sh1 = hashF(hashU(u32(sid + 4096)));
    let sh2 = hashF(hashU(u32(sid + 9137)));
    let sF = 1.0 - smoothstep(0.3, 0.75, sw);
    let tone = mix(1.0, (0.7 + 0.55 * sh1) * (0.86 + 0.28 * sin(sfr * PI)), sF);
    let jit = (sh2 - 0.5) * 0.16 * sF;
    let base = alb * (1.0 + 0.12 * clump) * tone;
    let rough = 0.33 + 0.04 * clump + 0.1 * smoothstep(4.0, 15.0, distance(frame.camPos, p));
    let selfSh = mix(0.18, 1.0, ao * ao);
    let gf = 1.0 - smoothstep(0.2, 0.6, pix * 1900.0);
    var grain = 1.0;
    if (gf > 0.0) { grain = mix(1.0, 0.55 + 0.9 * vnoise3(lp * 1900.0), gf); }
    var c = key * sh * selfSh * hairBSDF(T, V, L, base, rough, jit) * mix(1.0, grain, 0.6) * ks;
    // multiple scattering (Karis): wrapped against a normal facing the viewer, tinted by the hair colour
    let fakeN = normalize(V - T * dot(V, T));
    let ms = clamp((dot(fakeN, L) + 1.0) * 0.25, 0.0, 1.0) / PI;
    let tint = pow(base / max(luma(base), 1e-4), vec3f(1.0 - sh * 0.6));
    c += key * sh * selfSh * sqrt(base) * ms * tint * 0.7;
    // the sky through the mass, and a soft sheen along the strands where they face it
    c += base * ambientAt(p, normalize(N + fakeN), lt.room) * occ * 0.95;
    let skyR = select(skyAmbient(reflect(-V, N)), amb, lt.room > 0u);
    let tH = dot(T, normalize(V + vec3f(0.0, 1.0, 0.0)));
    c += skyR * 0.05 * (0.4 + 0.6 * sqrt(max(1.0 - tH * tH, 0.0))) * occ * mix(1.0, 0.5 + sh1, sF) * grain;
    let skyC = select(skyAmbient(vec3f(0.0, 1.0, 0.0)), amb, lt.room > 0u);
    let Hs = normalize(vec3f(0.0, 1.0, 0.0) + V);
    let ts = dot(T, Hs) - 0.12 + jit * 1.5;
    let ts2 = dot(T, Hs) + 0.1 + jit * 1.5;
    let band = pow(sqrt(max(1.0 - ts * ts, 0.0)), 70.0) * 0.2 + pow(sqrt(max(1.0 - ts2 * ts2, 0.0)), 20.0) * 0.05 * sqrt(base / max(luma(base), 1e-4));
    c += skyC * band * smoothstep(-0.2, 0.7, N.y) * specOcc * mix(1.0, 0.3 + 1.4 * sh1 * sh1, sF) * grain;
    c += key * sh * pow(1.0 - nv, 3.0) * kick * sqrt(base) * 0.5 * occ;
    col = c;
  } else {
    // ---------- fabrics: woven threads up close, sheen, a silk highlight, light through thin cloth
    let silk = HU.pal[min(mat, 15u)].w;
    let fur = select(0.0, 1.0, mat == 13u);
    let k = select(1550.0, 2600.0, mat == 5u);
    let fwv = (1.0 - smoothstep(0.18, 0.5, pix * k)) * (1.0 - 0.6 * silk) * (1.0 - fur);
    var tw = abs(in.lnrm);
    tw = tw * tw * tw * tw;
    tw /= tw.x + tw.y + tw.z + 1e-5;
    var g = vec3f(0.0);
    var hgt = 0.0;
    if (fwv > 0.0) {
      let wx = weave3(lp.z * k, lp.y * k);
      let wy = weave3(lp.x * k, lp.z * k);
      let wz = weave3(lp.x * k, lp.y * k);
      hgt = wx.x * tw.x + wy.x * tw.y + wz.x * tw.z;
      g = vec3f(0.0, wx.z, wx.y) * tw.x + vec3f(wy.y, 0.0, wy.z) * tw.y + vec3f(wz.y, wz.z, 0.0) * tw.z;
      g = qrot(q, g) * (0.09 * fwv);
    }
    let Nf = normalize(N - (g - N * dot(g, N)));
    var a = alb * mix(1.0 - 0.12 * wf + 0.12 * wf * weave(lp, 2600.0), 0.97 + 0.03 * weave(lp, 1100.0), silk);
    a *= mix(1.0, (0.86 + 0.14 * hgt) * (0.96 + 0.08 * hh13(lp * k * 0.5)), fwv);
    let up = vec3f(0.0, 1.0, 0.0);
    var Tw = up - Nf * dot(up, Nf);
    if (dot(Tw, Tw) < 1e-4) { Tw = cross(Nf, vec3f(1.0, 0.0, 0.0)); }
    var fab: Fabric;
    fab.alb = a;
    fab.silk = silk;
    fab.thin = clamp(1.0 - in.bake.y, 0.0, 1.0);
    fab.ao = ao * select(0.5, 1.0, ff);
    fab.N = Nf;
    fab.V = V;
    fab.T = normalize(Tw);
    fab.wpos = p;
    col = shadeFabric(fab, lt, sh, amb);
  }
  col = min(col, vec3f(24.0));
  col = applyAerial(col, p);
  // sheer chiffon (material 15): partial coverage through alpha-to-coverage
  return vec4f(col, select(1.0, 0.5, mat == 15u));
}


// ================================================================ ink and paint: she drawn as the show draws her
// (the waterbending game's look, its default) Flat fills from a colour model — lit and shade per material, designed
// for the screen as a colour stylist paints a cel — one hard terminator from a key light (the sun or moon here)
// leaned toward the camera so her face and back read, the world's cast shadows switching her to the shade tone (her
// own body's skipped: looked up from above her head toward the light), the drawn face, ink lock lines on the hair, a
// thin warm rim when the light's behind her; no specular, sheen, scattering or pores. The fills are locked through
// this frame's exposure and this world's tone map (post.wgsl run backwards), so they come out on the screen as
// designed in any light; the light reaches them only through the colour model (golden hour warmer, night moonlit, a
// lamp-lit room warm) and the shadow. And an inverted-hull ink line in its own draw (vsOutline / fsOutline).

/** the face's zone (head space): in front of the head, between the chin and the brow, the face's width, and no further
 *  out than a little past the nose's tip: a hand, a cup or a wrist held up before the face isn't the face */
fn faceDepth(hp: vec3f) -> f32 { return smoothstep(-0.01, 0.02, hp.z) * (1.0 - smoothstep(HU.face.w + 0.02, HU.face.w + 0.035, hp.z)); }
fn faceZoneOf(hp: vec3f) -> f32 { return faceDepth(hp) * step(HU.face.y - 0.045, hp.y) * step(hp.y, HU.face.x + 0.03) * step(abs(hp.x), 0.085); }
/** the show's colour model, per palette slot: the lit fill (display-referred sRGB) */
fn celFill(mat: u32) -> vec3f {
  var c = vec3f(0.6);
  switch mat {
    case 0u, 8u, 11u: { c = vec3f(0.66, 0.46, 0.33); }   // skin, a warm medium brown
    case 1u: { c = vec3f(0.36, 0.44, 0.72); }            // the tunic, a clear mid blue
    case 2u: { c = vec3f(0.17, 0.19, 0.33); }            // leggings and arm wraps, dark navy
    case 3u: { c = vec3f(0.19, 0.13, 0.11); }            // hair, a very dark brown
    case 4u: { c = vec3f(0.44, 0.44, 0.48); }            // boots, grey
    case 5u: { c = vec3f(0.62, 0.7, 0.88); }             // trims, undersleeves, light blue
    case 6u, 7u, 13u: { c = vec3f(0.9, 0.9, 0.92); }     // collar, sash, fur: white (a hair under: the bloom)
    case 12u: { c = vec3f(0.55, 0.78, 0.9); }            // beads, the pendant
    case 14u: { c = vec3f(0.12, 0.13, 0.26); }           // the choker, dark navy
    default: { c = vec3f(0.36, 0.44, 0.72); }
  }
  return c;
}
/** the shade tone as a multiple of the fill: deeper and a little cooler, warm on skin */
fn celShadeMul(mat: u32) -> vec3f {
  if (mat == 0u || mat == 8u || mat == 11u) { return vec3f(0.74, 0.62, 0.62); }
  if (mat == 3u) { return vec3f(0.62, 0.58, 0.62); }
  if (mat == 6u || mat == 7u || mat == 13u) { return vec3f(0.72, 0.74, 0.86); }
  return vec3f(0.6, 0.62, 0.78);
}

// ---- the display lock: the scene colour that comes out of post.wgsl (bloom mix, exposure, warmth, AgX, its look, the
// contrast) as the designed display colour
fn agxPoly(x: f32) -> f32 {
  let x2 = x * x; let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
fn agxPolyD(x: f32) -> f32 {
  let x2 = x * x; let x4 = x2 * x2;
  return 93.0 * x4 * x - 200.7 * x4 + 127.84 * x2 * x - 20.604 * x2 + 0.8596 * x + 0.1191;
}
fn agxPolyInv(y: f32) -> f32 {
  var x = clamp(y * 0.6 + 0.2, 0.0, 1.0);
  for (var i = 0; i < 6; i++) { x = clamp(x - (agxPoly(x) - y) / max(agxPolyD(x), 0.05), 0.0, 1.0); }
  return x;
}
fn celLock(D0: vec3f) -> vec3f {
  let G = HU.post;
  // the contrast, undone; then AgX's outset (its inverse is the inset), the look's saturation and power
  var d = (D0 - 0.5) / max(G.z, 0.01) + 0.5;
  let inset = mat3x3f(vec3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051), vec3f(0.0784335999999992, 0.878468636469772, 0.0784336),
    vec3f(0.0792237451477643, 0.0791661274605434, 0.879142973793104));
  let outset = mat3x3f(vec3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438), vec3f(-0.0980208811401368, 1.15190312990417, -0.0980434501171241),
    vec3f(-0.0990297440797205, -0.0989611768448433, 1.15107367264116));
  d = inset * d;
  let sat = mix(1.0, 1.4, G.w) * G.y;
  let l = luma(d);
  d = l + (d - l) / max(sat, 0.01);
  d = pow(max(d, vec3f(1e-5)), vec3f(1.0 / mix(1.0, 1.35, G.w)));
  // the contrast polynomial, the log, the inset — undone
  d = vec3f(agxPolyInv(d.x), agxPolyInv(d.y), agxPolyInv(d.z));
  let minEv = -12.47393; let maxEv = 4.026069;
  var c = outset * exp2(d * (maxEv - minEv) + minEv);
  // the warmth, the exposure, the bloom's share
  let w = HU.post2.x;
  c /= vec3f(1.0 + w * 0.08, 1.0, 1.0 - w * 0.08);
  return max(c, vec3f(0.0)) / max(world.exposure * exp2(G.x) * (1.0 - HU.post2.y), 1e-9);
}
/** the colour model's light: noon as designed, golden hour warmer, night moonlit (darker, bluer); a room's lamplight */
fn celCondition(room: u32) -> vec3f {
  let sunUp = world.sunTrue.y;
  let golden = (1.0 - smoothstep(0.05, 0.4, sunUp)) * smoothstep(-0.12, 0.02, sunUp);
  var k = mix(vec3f(1.0), vec3f(1.08, 0.94, 0.8), golden);
  k = mix(k, vec3f(0.42, 0.48, 0.72), smoothstep(0.2, 0.9, world.sunTrue.w));
  if (room > 0u) { k = mix(mix(vec3f(1.0), vec3f(1.04, 0.97, 0.9), golden), vec3f(0.95, 0.86, 0.74), smoothstep(0.2, 0.9, world.sunTrue.w)); }
  return k;
}
/** the house's outdoor lamps on her (world.lamps: the terrace's café lights and lantern, the porch's): how bright they
 *  make a white card as this frame's exposure shows it (k), the way their light comes from (weighted), its colour */
struct LampKey { k: f32, dir: vec3f, col: vec3f };
fn lampKey(p: vec3f) -> LampKey {
  var e = vec3f(0.0);
  var d = vec3f(0.0);
  for (var i = 0u; i < 8u; i++) {
    let a = world.lamps[i * 2u];
    if (a.w <= 0.0) { continue; }
    let b = world.lamps[i * 2u + 1u];
    let v = a.xyz - p;
    let d2 = max(dot(v, v), 0.04);
    let l = v * inverseSqrt(d2);
    var face = 1.0;
    if (b.w < 8.0) { face = smoothstep(-0.35, 0.15, dot(-l, vec3f(cos(b.w), 0.0, sin(b.w)))); }
    let win = saturate(1.0 - d2 / 196.0);
    let c = b.rgb * a.w * face * win * win / d2;
    e += c;
    d += l * luma(c);
  }
  var o: LampKey;
  o.col = e;
  o.k = luma(e) * world.exposure / PI;
  o.dir = select(vec3f(0.0, 1.0, 0.0), normalize(d), dot(d, d) > 1e-14);
  return o;
}
/** the art-directed key: the sun (or moon) leaned toward the camera's side of her, never from below 17 degrees */
fn celKey() -> vec3f {
  let L = world.sunDir;
  let head = dqPoint(SkinDQ(HU.headR, HU.headD, 0.0), vec3f(0.0, HU.eye.y, 0.0));
  var v = frame.camPos.xz - head.xz;
  v /= max(length(v), 1e-4);
  var k = normalize(vec3f(L.x + v.x * HU.toon.y, L.y, L.z + v.y * HU.toon.y));
  k.y = max(k.y, 0.3);
  return normalize(k);
}
/** the hair's lock lines in ink: a few lines at fixed angles fanning back from the part to the gather, the part itself
 *  over the front of the head; where they come closer than a few pixels they fade. fw: the angle's change per pixel */
fn hairLines(a: f32, fw: f32, px: f32, front: f32) -> f32 {
  let w = max(fw, 1e-6);
  let b = abs(a);
  var ink = 0.0;
  for (var k = 0; k < 3; k++) {
    let c = select(select(0.3, 0.19, k == 1), 0.095, k == 0);
    ink = max(ink, 1.0 - smoothstep(0.5 * px, 1.2 * px, abs(b - c) / w));
  }
  ink = max(ink, (1.0 - smoothstep(0.45 * px, 1.05 * px, b / w)) * front);
  return ink * (1.0 - smoothstep(0.016, 0.026, w)) * step(b, 0.42) * step(1e-4, abs(HU.hair.w));
}

/** the airbender's arrows (actor.w): on his head an arrowhead on the forehead pointing down between the brows, its band
 *  running back over the crown and down to the nape; on each forearm a band down its back from under the cuff to an
 *  arrowhead on the back of the hand pointing at the middle finger. Drawn in bind space (they ride the skin in any
 *  pose); px the bind-space size of a pixel. Coverage 0..1 */
fn arrowMarks(lp: vec3f, px: f32) -> f32 {
  let M = HU.mark;
  var d = 1e3;
  if (lp.y > M[5].y) {
    let front = lp.z > M[5].x;
    let ax = abs(lp.x);
    let tip = M[0].y; let L = M[0].z; let k = M[0].w / M[0].z;
    // the band: down the middle over the top and the back; in front only above the arrowhead
    let db = select(ax - M[0].x, 1e3, front && lp.y < tip + L);
    let dt = select(max((ax - k * (lp.y - tip)) / sqrt(1.0 + k * k), max(tip - lp.y, lp.y - tip - L)), 1e3, !front);
    d = min(db, dt);
  }
  let q = vec3f(abs(lp.x), lp.y, lp.z);
  let E = M[1].xyz; let Wr = M[2].xyz; let K = M[3].xyz;
  if (q.x > E.x - 0.04 && lp.y < M[5].y) {
    // the nearest point on elbow -> wrist -> knuckle, how far along, the way across the back there
    let a1 = Wr - E; let a2 = K - Wr;
    let t1 = clamp(dot(q - E, a1) / dot(a1, a1), 0.0, 1.0);
    let t2 = clamp(dot(q - Wr, a2) / dot(a2, a2), 0.0, 1.0);
    let r1 = q - (E + a1 * t1); let r2 = q - (Wr + a2 * t2);
    let onHand = dot(r2, r2) < dot(r1, r1);
    let r = select(r1, r2, onHand);
    let u = normalize(select(a1, a2, onHand));
    let l1 = length(a1); let l2 = length(a2);
    let s = select(t1 * l1, l1 + t2 * l2, onHand);
    let Dp = normalize(M[4].xyz - u * dot(M[4].xyz, u));
    let lat = abs(dot(r, cross(u, Dp)));
    let back = dot(r, Dp) > 0.0 && length(r) < 0.06;
    let sb = l1 + 0.12 * l2; let st = l1 + 0.86 * l2;
    let db = select(1e3, max(lat - M[1].w, max(-s, s - sb)), back);
    let kh = M[2].w / (st - sb);
    let dh = select(1e3, max((lat - kh * (st - s)) / sqrt(1.0 + kh * kh), max(sb - s - 0.002, s - st)), back);
    d = min(d, min(db, dh));
  }
  return 1.0 - smoothstep(-px, px, d);
}

@fragment fn fsCel(in: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let mat = in.mat;
  let E = HU.eye;
  let p = in.wpos;
  // the drawn face's chart and pixel size, the lock field and its rate (derivatives in uniform control flow)
  let hp = headSpace(p);
  let fpx = max(length(fwidth(vec2f(atan2(hp.x, hp.z) * 0.1, hp.y))), 1e-6);
  let lockA = lockAngle(hp);
  let lockW = fwidth(lockA);
  let mpx = max(length(fwidth(in.local)), 1e-6) * 0.75;
  let faceZone = faceZoneOf(hp);
  let lp = in.local;
  var N = normalize(in.nrm);
  if (!ff) { N = -N; }
  let V = normalize(frame.camPos - p);
  let q = in.q * inverseSqrt(max(dot(in.q, in.q), 1e-8));
  let Lk = celKey();
  // the head shades as one smooth form (an ellipsoid round its middle), not as its sculpted shapes
  let headM = smoothstep(E.y - 0.17, E.y - 0.13, lp.y);
  var Ns = N;
  if (headM > 0.0 && (mat == 0u || mat == 11u)) {
    let hc = vec3f(0.0, E.y + 0.015, E.z - 0.075);
    let hn = qrot(q, normalize((lp - hc) * vec3f(1.0, 0.85, 1.25)));
    Ns = normalize(mix(N, hn, 0.85 * headM));
  }
  // one hard edge, nudged by the baked occlusion (creases fall into shade first), anti-aliased over about a pixel; the
  // face stays in the light unless the key comes hard from the side or behind
  let ao = clamp(in.bake.x, 0.0, 1.0);
  let faceLit = smoothstep(0.015, 0.05, hp.z) * faceZone * select(0.0, 1.0, mat == 0u || mat == 11u);
  let t = dot(Ns, Lk) + (ao - 0.75) * 0.6 * select(1.0, HU.actor3.x, HU.actor3.w > 0.5) + 0.42 * faceLit + HU.actor3.y;
  let aa = max(fwidth(t), 1e-3);
  var lit = smoothstep(-aa, aa, t + 0.05);
  // the world's cast shadows switch her to the shade tone; her own skipped (the lookup starts toward the light from
  // above the top of her head). In a room she reads as lit by it.
  let topP = dqPoint(SkinDQ(HU.headR, HU.headD, 0.0), vec3f(0.0, E.y + 0.16, 0.0));
  let top = topP.y;
  let L = world.sunDir;
  let reach = clamp((top - p.y) / max(L.y, 0.2), 0.5, 4.0);
  let room = roomOf(p, N);
  // (and her figure as one: when the light over the top of her head is cut off — the house, a crown overhead — she's
  // in the shade all over, as a drawing would have her)
  let lightOn = world.sunCos > -0.05 || world.moon.z > 0.5;
  let asOne = HU.actor3.z > 0.5;
  let oxz = select(p.xz, topP.xz, asOne);
  let over = sunShadowFast(vec3f(oxz.x, top + 0.12, oxz.y) + L * 0.15, vec3f(0.0, 1.0, 0.0));
  var env = select(0.0, select(min(sunShadowFast(p + L * reach, vec3f(0.0, 1.0, 0.0)), over), over, asOne), lightOn);
  if (room > 0u) { env = max(env, 0.75); }
  lit *= smoothstep(0.35, 0.65, env);
  // at night, outdoors, the lamps light her where they reach (world.lamps: a held flame, the lanterns): their warm
  // light the key from their way, the moon's blue kept in the shade
  let nightK = smoothstep(0.2, 0.9, world.sunTrue.w) * select(1.0, 0.0, room > 0u);
  let lk = lampKey(p);
  let lampK = smoothstep(0.004, 0.22, lk.k) * nightK;
  let lampC = lk.col / max(luma(lk.col), 1e-6);
  // (lifted toward the light's way a little: a lamp over her head still lights her face from the front; derivatives in
  // uniform control flow)
  let Ll = normalize(lk.dir + vec3f(0.0, -0.25, 0.0) + V * 0.35);
  let tl = dot(Ns, Ll) + (ao - 0.75) * 0.6 * select(1.0, HU.actor3.x, HU.actor3.w > 0.5) + 0.3 * faceLit + HU.actor3.y;
  let al = max(fwidth(tl), 1e-3);
  lit = mix(lit, smoothstep(-al, al, tl + 0.12), lampK);
  let cm = HU.cel[min(mat, 15u)];
  let fillD = select(celFill(mat), cm.rgb, cm.w > 0.5);
  let fill = srgbToLin(fillD);
  let sm = HU.celShade[min(mat, 15u)];
  let shade = fill * select(celShadeMul(mat), sm.rgb, sm.w > 0.5);
  var col = mix(shade, fill, lit);
  // the airbender's arrows, light blue
  if (HU.actor.w > 0.5 && mat == 0u) {
    let tf = srgbToLin(vec3f(0.5, 0.62, 0.86));
    col = mix(col, mix(tf * vec3f(0.62, 0.66, 0.82), tf, lit), arrowMarks(in.local, mpx));
  }
  // the face, drawn
  if (faceZone > 0.5 && (mat == 0u || mat == 11u)) {
    let Vh = dqDir(SkinDQ(vec4f(-HU.headR.xyz, HU.headR.w), vec4f(0.0), 0.0), V);
    let fd = drawFace(hp, fpx, lit, atan2(Vh.x, Vh.z));
    col = mix(col, srgbToLin(fd.col), fd.a);
  }
  // an old man's forehead: three wavy lines across it, shorter as they rise
  if (HU.actor4.w > 0.0 && mat == 0u) {
    let fu = atan2(hp.x, hp.z) * 0.1;
    var fl = 0.0;
    for (var k = 0; k < 3; k++) {
      let kk = f32(k);
      let fv = HU.face.x + 0.026 + 0.0115 * kk + 0.0016 * cos(fu * 140.0 + kk * 1.7) + 1.2 * fu * fu;
      let reach = 0.044 - 0.007 * kk;
      fl = max(fl, lineCov(hp.y - fv, 0.00055, fpx) * (1.0 - smoothstep(reach - 0.008, reach, abs(fu))) * faceDepth(hp));
    }
    col = mix(col, srgbToLin(vec3f(0.42, 0.27, 0.2)), fl * 0.8 * HU.actor4.w);
  }
  // the hair's lock lines, in ink
  if (mat == 3u && in.across.w > -0.3) {
    let lk = hairLines(lockA, lockW, max(frame.res.y / 1080.0, 1.0) * 0.9, smoothstep(-0.02, 0.03, hp.z));
    col = mix(col, srgbToLin(vec3f(0.07, 0.045, 0.04)), lk);
  }
  // a thin warm rim on the shadow side when the light is behind her
  let nv = max(dot(N, V), 0.0);
  let back = smoothstep(0.2, 0.7, dot(-V, L)) * (1.0 - world.sunTrue.w);
  let rim = smoothstep(0.82, 0.86, 1.0 - nv) * back * (1.0 - lit) * smoothstep(0.35, 0.65, env);
  col = mix(col, fill * vec3f(1.25, 1.12, 1.0), rim * 0.85);
  // (designed in display space; locked through this frame's exposure and tone map)
  // (the lamps' warmth on the lit side, the night's blue kept in the shade)
  let cond = mix(celCondition(room), mix(vec3f(1.0), lampC, 0.32) * vec3f(0.97, 0.95, 0.93), lampK * mix(0.45, 1.0, lit));
  col = celLock(pow(max(col, vec3f(0.0)), vec3f(1.0 / 2.2)) * cond);
  col = applyAerial(col, p);
  return vec4f(col, select(1.0, 0.5, mat == 15u));
}

// the ink line: the skinned mesh again, pushed out along its normals by a constant width on screen, back faces only, so
// a dark rim shows round every silhouette; pushed a little away from the camera too, so it shows only where it clears
// what's behind it — one piece over another (a sleeve over her side, the collar or sash over the tunic, a lobe of the
// braid over the next) draws its line; her face keeps a deep push, so its nose and cheeks never draw one over it
struct LOut { @builtin(position) pos: vec4f, @location(0) wpos: vec3f };
@vertex fn vsOutline(v: VIn) -> LOut {
  var o: LOut;
  let mat = v.pm.w & 0xffu;
  let Q = skinDQ(v);
  var wp = deformedPos(v, Q);
  // (no line round the sheer layer)
  if (mat == 15u || headless(v)) { o.pos = vec4f(0.0, 0.0, -2.0, 1.0); o.wpos = wp; return o; }
  let n = normalize(skinDir(v, Q, sculptNrm(v)) + vec3f(0.0, 1e-6, 0.0));
  let dist = max(distance(wp, frame.camPos), 0.05);
  let pxM = 2.0 * tan(frame.fovY * 0.5) * dist / max(frame.res.y, 1.0);
  // (width set for 1080 lines: thinner as the render resolution drops, never under about a pixel)
  let px = max(HU.toon.x * frame.res.y / 1080.0, 1.0);
  wp += n * px * pxM;
  let face = (mat == 0u || mat == 8u || mat == 11u) && bindPos(v).y > HU.eye.y - 0.11;
  wp += normalize(wp - frame.camPos) * min(select(0.004, 0.02, face) * dist, 0.06);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.wpos = wp;
  return o;
}
@fragment fn fsOutline(in: LOut) -> @location(0) vec4f {
  // near-black, warm (the show's lines are dark brown-black), as dark in the shade as in the sun
  let col = celLock(vec3f(0.09, 0.06, 0.055) * celCondition(roomOf(in.wpos, vec3f(0.0, 1.0, 0.0))));
  return vec4f(applyAerial(col, in.wpos), 1.0);
}
