// One of Boulder's cast lying on their back in the meadow (the ground frame, metres; figure/cast.ts): their mesh
// (Boulder's Blender-built DNC1 file, public/data/figure/) drawn as Boulder draws them — ink and paint, after its
// hero.wgsl fsCel: flat fills from their colour model, one hard terminator from the sun leaned toward the camera, the
// face drawn on the head's chart (Boulder's drawEye and drawFace, as they are there), an inverted-hull ink line. Lying
// still, every bone has the same skin transform (figure/pose.ts), so the head's space is the bind space.
// Going in, the drawn right eye holds the zoom: its iris grows fibres, crypts and a collarette once they're bigger
// than a pixel, and the cornea's living cells come over it as the cell's world nears (deep.x).
// Drawn into its own target (colour and coverage, and the inverse of its distance) for the meadow to lay into its
// grass (c_ground.wgsl).
#include "cosmos.wgsl"

struct HeroU {
  qmin: vec4f,            // the quantisation box (bind space); w the nose tip's height
  qmax: vec4f,
  eye: vec4f,             // the eyes: x half spacing, y height, z depth, w radius (bind space)
  face: vec4f,            // x brow height, y mouth height, z lip half width, w nose tip depth
  headR: vec4f, headD: vec4f,   // the (one) skin transform, bind -> ground: a dual quaternion
  // the face's state (Boulder's cast/face.ts): face2 blink, smile, brows down, wide; face3 gaze x, y, jaw, squint;
  // faceB the brows' ends; faceE knit, upper lids, lower lids, eyes shut in a smile; faceM open, spread, round, press;
  // faceN teeth, tongue, tuck, smirk; faceX frown, blush
  face2: vec4f, face3: vec4f, faceB: vec4f, faceE: vec4f, faceM: vec4f, faceN: vec4f, faceX: vec4f,
  // ink: x the line's width (px at 1080 lines), y how far the key leans toward the camera
  toon: vec4f,
  // the town's look for them (looks.ts): the eyes, the drawn iris, the mouth, the shading, an old face's lines
  actor: vec4f, actorIris: vec4f, actor2: vec4f, actor3: vec4f, actor4: vec4f,
  // the colour model per palette slot (display rgb, w 1) and its shade multiple
  cel: array<vec4f, 16>, celShade: array<vec4f, 16>,
  // x how far the cornea's cells show (0..1), y the grade's contrast, z its saturation, w the level's exposure (undone)
  deep: vec4f,
  // x night (0 day .. 1)
  sky: vec4f,
  // palette slots not drawn here (a prop of the town's; -1 none)
  hide: vec4f,
  // the dive's target (bind space) and the skin's way out there: the drawn eye's chart on that plane up close
  focus: vec4f, focusN: vec4f,
}
@group(2) @binding(1) var<uniform> HU: HeroU;

struct VIn {
  @location(0) pm: vec4u,
  @location(1) nrm: vec4f,
  @location(2) flow: vec4f,
};
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) rel: vec3f,    // from the camera (m)
  @location(1) nrm: vec3f,
  @location(2) local: vec3f,
  @location(3) @interpolate(flat) mat: u32,
  @location(4) bake: vec4f,
};
struct FOut { @location(0) col: vec4f, @location(1) dist: vec4f };

fn dqDirR(r: vec4f, p: vec3f) -> vec3f { return p + 2.0 * cross(r.xyz, cross(r.xyz, p) + r.w * p); }
fn dqPointRD(r: vec4f, d: vec4f, p: vec3f) -> vec3f {
  let t = 2.0 * (r.w * d.xyz - d.w * r.xyz + cross(r.xyz, d.xyz));
  return dqDirR(r, p) + t;
}
fn bindPos(v: VIn) -> vec3f { return HU.qmin.xyz + vec3f(v.pm.xyz) / 65535.0 * (HU.qmax.xyz - HU.qmin.xyz); }
fn camPos() -> vec3f { return L.origin + L.eye; }
// (a prop of the town's: not here)
fn hidden(mat: u32) -> bool { return any(vec4f(f32(mat)) == HU.hide); }
// a point from the camera, on the screen (reversed depth: near / distance)
fn figClip(rel: vec3f) -> vec4f {
  var c = clipOf(rel);
  let near = L.scale * 1e-3;
  if (isDome()) { c.z = near / max(length(rel), 1e-12); }
  else { c.z = near; }
  return c;
}

fn underGround(rel: vec3f) -> bool { return (rel.y + L.eye.y) + L.origin.y < -0.004; }
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn sq(x: f32) -> f32 { return x * x; }

// ---- the iris up close, and the cornea's cells over it: what the drawn eye becomes going in
// (eye-local metres; q the point in the iris's own units, 1 its rim; px a pixel there)
fn irisNear(c0: vec3f, q: vec2f, px: f32) -> vec3f {
  let k = 1.0 - ss(0.00003, 0.00012, px);
  if (k <= 0.0) { return c0; }
  let r = length(q);
  // (round the pupil by the direction itself, not its angle: no seam where the angle wraps; each fibre wavering a
  // little as it runs out)
  let w = vnoise(vec3f(q * 9.0, 5.0)) * 0.012;
  let dir = vec2f(cos(atan2(q.y, q.x) + w), sin(atan2(q.y, q.x) + w));
  // fibres running out from the pupil (each ~ 20 µm on an iris this size), finer as the view comes in
  let f1 = vnoise(vec3f(dir * 60.0, r * 5.0)) * 0.5 + 0.5;
  let f2 = vnoise(vec3f(dir * 220.0, r * 14.0 + 7.0)) * 0.5 + 0.5;
  let k3 = 1.0 - ss(0.000006, 0.00002, px);
  let f3 = vnoise(vec3f(dir * 800.0, r * 40.0 + 13.0)) * 0.5 + 0.5;
  let fib = mix(f1 * 0.55 + f2 * 0.45, f1 * 0.4 + f2 * 0.3 + f3 * 0.3, k3);
  var c = c0 * (0.62 + 0.75 * fib);
  // the collarette: a paler, warmer ring two-fifths of the way out, crinkled
  let cr = 0.42 + 0.04 * vnoise(vec3f(dir * 9.0, 3.0));
  c = mix(c, c0 * vec3f(1.5, 1.35, 1.05) + vec3f(0.06, 0.04, 0.0), exp(-sq((r - cr) / 0.035)) * 0.7);
  // crypts: dark hollows between the fibres, in the middle of the iris
  let cy = vnoise(vec3f(dir * 16.0, r * 7.0 + 21.0));
  c *= 1.0 - 0.55 * ss(0.35, 0.6, cy) * ss(0.45, 0.55, r) * (1.0 - ss(0.82, 0.92, r));
  // furrows round its outer part, and its rim darker
  c *= 1.0 - 0.25 * ss(0.6, 0.9, abs(sin(r * 46.0 + vnoise(vec3f(dir * 5.0, 9.0)) * 2.0))) * ss(0.75, 0.85, r);
  return mix(c0, c, k);
}
fn cornea(p: vec2f) -> vec4f {
  // a few layers of flat cells ~40 µm across, their walls and their nuclei: colour, how much it hides
  var col = vec3f(0.0);
  var a = 0.0;
  for (var k = 0; k < 3; k++) {
    let s = 0.00004 * (1.0 - f32(k) * 0.2);
    let q = p / s + vec2f(f32(k) * 7.3, f32(k) * 3.1);
    let i = floor(q);
    var d1 = 9.0; var d2 = 9.0; var id = vec3f(0.0); var cc = vec2f(0.0);
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let g = i + vec2f(f32(x), f32(y));
        let h = hash3i(vec3i(i32(g.x), i32(g.y), 913 + k));
        let c = g + 0.5 + (h.xy - 0.5) * 0.8;
        let d = length(q - c);
        if (d < d1) { d2 = d1; d1 = d; id = h; cc = c; } else if (d < d2) { d2 = d; }
      }
    }
    let wall = exp(-(d2 - d1) * (d2 - d1) / 0.0016);
    let nuc = 1.0 - ss(0.14, 0.24, length((q - cc) * vec2f(1.0, 1.35)) * (0.9 + 0.3 * id.z));
    let layer = vec3f(0.95, 0.78, 0.74) * 0.35 + vec3f(1.0, 0.9, 0.86) * wall * 0.5 + vec3f(0.42, 0.28, 0.62) * nuc * 0.85;
    let la = clamp(0.1 + wall * 0.35 + nuc * 0.55, 0.0, 1.0) * (1.0 - f32(k) * 0.2);
    col += (1.0 - a) * la * layer;
    a += (1.0 - a) * la;
  }
  return vec4f(col, a);
}

// ---- Boulder's drawn face (hero.wgsl, as it is there)
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
  // (going in: the iris's own fibres and crypts once they're bigger than a pixel)
  irisC = irisNear(irisC, q, px);
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
  // (and nearer still, the cornea's living cells over all of it)
  if (HU.deep.x > 0.0) { let e = cornea(vec2f(x, y)); c = mix(c, e.rgb, e.a * HU.deep.x); }
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
/** (`alien`: one from elsewhere in the other Boulder — the mouth only, smaller; their eyes are alienFace's) */
fn drawFace(hp: vec3f, px: f32, lit: f32, yawV: f32, alien: bool) -> FaceInk {
  var o = FaceInk(vec3f(0.0), 0.0);
  let E = HU.eye;
  let u = atan2(hp.x, hp.z) * 0.1;
  let v = hp.y;
  let ue = atan2(E.x, E.z + E.w) * 0.1;
  // a blush: a soft flush over each cheek with the show's three little strokes across it
  let bl = select(clamp(HU.faceX.y, 0.0, 1.0), 0.0, alien);
  if (bl > 0.01) {
    let bq = vec2f((abs(u) - ue - 0.003) / 0.0105, (v - E.y + 0.0175) / 0.0052);
    let bf = (1.0 - smoothstep(0.35, 1.0, length(bq))) * 0.38 * bl;
    let bs = (abs(u) - ue - 0.003) * 1.0 + (v - E.y + 0.0175) * 0.55;
    let st = lineCov(fract(bs / 0.0042 + 0.5) - 0.5, 0.06, px / 0.0042) * (1.0 - smoothstep(0.5, 0.75, length(bq))) * 0.5 * smoothstep(0.4, 0.8, bl);
    let ba = max(bf, st);
    if (ba > 0.0) { o.col = mix(vec3f(0.93, 0.42, 0.42), vec3f(0.78, 0.25, 0.28), st / max(ba, 1e-4)); o.a = ba; }
  }
  for (var k = 0; k < select(2, 0, alien); k++) {
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
  let nose = lineCov(dN, 0.0006, px) * smoothstep(-0.0015, 0.0005, nx) * (1.0 - smoothstep(0.0055, 0.0068, nx)) * select(1.0, 0.0, alien);
  o.col = mix(o.col, vec3f(0.36, 0.22, 0.16), nose); o.a = max(o.a, nose);
  let ns = (1.0 - smoothstep(0.9, 1.1, length(vec2f((nx - 0.0026) / 0.0036, (v - ny + 0.0046) / 0.0018)))) * (1.0 - nose) * select(1.0, 0.0, alien);
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
  let mw = 0.0115 * select(1.0, A2.x, A2.x > 0.0) * (1.0 + 0.1 * smile + 0.2 * spread - 0.42 * rnd - 0.1 * press + 0.3 * open * grin * smile) * select(1.0, 0.55, alien);
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


/** the face's zone (head space): in front of the head, between the chin and the brow, the face's width */
fn faceDepth(hp: vec3f) -> f32 { return smoothstep(-0.01, 0.02, hp.z) * (1.0 - smoothstep(HU.face.w + 0.02, HU.face.w + 0.035, hp.z)); }
fn faceZoneOf(hp: vec3f) -> f32 { return faceDepth(hp) * step(HU.face.y - 0.045, hp.y) * step(hp.y, HU.face.x + 0.03) * step(abs(hp.x), 0.085); }

// ---- the display lock: the colour model's display colour, back through this level's exposure and the grade
// (c_post.wgsl: AgX, its saturation and contrast; the screen shows its result to the 1 / 2.2)
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
  var g = pow(max(D0, vec3f(0.0)), vec3f(2.2));
  g = (g - 0.5) / max(HU.deep.y, 0.01) + 0.5;
  let l = luma(g);
  g = l + (g - l) / max(HU.deep.z, 0.01);
  let inset = mat3x3f(vec3f(0.842, 0.0423, 0.0424), vec3f(0.0784, 0.878, 0.0784), vec3f(0.0792, 0.0792, 0.879));
  let outset = mat3x3f(vec3f(1.197, -0.0528, -0.0529), vec3f(-0.098, 1.152, -0.098), vec3f(-0.099, -0.099, 1.152));
  var d = inset * clamp(g, vec3f(0.0), vec3f(1.0));
  d = vec3f(agxPolyInv(d.x), agxPolyInv(d.y), agxPolyInv(d.z));
  let c = outset * exp2(d * 16.5 - 12.47);
  return max(c, vec3f(0.0)) / max(HU.deep.w, 1e-6);
}
/** the colour model's light: noon as designed, golden hour warmer, night moonlit (darker, bluer) */
fn celCondition() -> vec3f {
  let sunUp = L.sun.y;
  let golden = (1.0 - ss(0.05, 0.4, sunUp)) * ss(-0.12, 0.02, sunUp);
  let k = mix(vec3f(1.0), vec3f(1.08, 0.94, 0.8), golden);
  return mix(k, vec3f(0.2, 0.23, 0.36), ss(0.2, 0.9, HU.sky.x));
}
/** the art-directed key: the sun leaned toward the camera's side of them, never from below 17 degrees */
fn celKey() -> vec3f {
  let head = dqPointRD(HU.headR, HU.headD, vec3f(0.0, HU.eye.y, 0.0)) - L.origin - L.eye;
  var v = -head.xz;
  v /= max(length(v), 1e-9);
  let s = L.sun;
  var k = normalize(vec3f(s.x + v.x * HU.toon.y, s.y, s.z + v.y * HU.toon.y));
  k.y = max(k.y, 0.3);
  return normalize(k);
}

@vertex fn vs(v: VIn) -> VOut {
  var o: VOut;
  let mat = v.pm.w & 0xffu;
  let lp = bindPos(v);
  // (from the camera in two steps: the origin is the zoom's target, the eye a little way from it)
  let rel = (dqPointRD(HU.headR, HU.headD, lp) - L.origin) - L.eye;
  o.pos = select(figClip(rel), vec4f(0.0, 0.0, -2.0, 1.0), hidden(mat));
  o.rel = rel;
  o.nrm = dqDirR(HU.headR, v.nrm.xyz);
  o.local = lp;
  o.mat = mat;
  o.bake = vec4f(v.nrm.w, v.flow.w, v.flow.x, v.flow.y);
  return o;
}

@fragment fn fs(in: VOut, @builtin(front_facing) ff: bool) -> FOut {
  let mat = in.mat;
  let E = HU.eye;
  // (lying still, the head's space is the bind space; the drawn face's chart and its pixel, derivatives in uniform
  // control flow)
  let lp = in.local;
  // (up close — a view a few millimetres across — the chart is laid on the plane through the target rather than on the
  // mesh's flat facets, which would kink every line of it at their edges)
  let dB = dqDirR(vec4f(-HU.headR.xyz, HU.headR.w), normalize(in.rel));
  let camB = lp - dB * length(in.rel);
  let tP = dot(HU.focus.xyz - camB, HU.focusN.xyz) / min(dot(dB, HU.focusN.xyz), -1e-4);
  let near = (1.0 - ss(0.003, 0.012, L.scale)) * step(length(lp - HU.focus.xyz), 0.03);
  let hp = mix(lp, camB + dB * tP, near);
  let fpx = max(length(fwidth(vec2f(atan2(hp.x, hp.z) * 0.1, hp.y))), 1e-10);
  let faceZone = faceZoneOf(hp);
  var N = normalize(in.nrm);
  if (!ff) { N = -N; }
  let V = normalize(-in.rel);
  let q = HU.headR;
  let Lk = celKey();
  // the head shades as one smooth form (an ellipsoid round its middle), not as its sculpted shapes
  let headM = smoothstep(E.y - 0.17, E.y - 0.13, lp.y);
  var Ns = N;
  if (headM > 0.0 && (mat == 0u || mat == 11u)) {
    let hc = vec3f(0.0, E.y + 0.015, E.z - 0.075);
    let hn = dqDirR(q, normalize((lp - hc) * vec3f(1.0, 0.85, 1.25)));
    Ns = normalize(mix(N, hn, 0.85 * headM));
  }
  // (and the singlet and the vest over the chest as one rounded form: the vest's padded straps are all small folds,
  // each of which would flip between light and shade on its own)
  if (mat == 1u || mat == 13u || mat == 14u) {
    let tc = vec3f(0.0, 1.22, -0.005);
    let tn = dqDirR(q, normalize((lp - tc) * vec3f(1.0 / 0.17, 1.0 / 0.32, 1.0 / 0.12)));
    let k = smoothstep(0.95, 1.1, lp.y) * (1.0 - smoothstep(1.5, 1.56, lp.y)) * (1.0 - smoothstep(0.2, 0.26, abs(lp.x)));
    Ns = normalize(mix(N, tn, 0.75 * k));
  }
  // one hard edge, nudged by the baked occlusion, anti-aliased over about a pixel; the face stays in the light
  let ao = clamp(in.bake.x, 0.0, 1.0);
  let faceLit = smoothstep(0.015, 0.05, hp.z) * faceZone * select(0.0, 1.0, mat == 0u || mat == 11u);
  let t = dot(Ns, Lk) + (ao - 0.75) * 0.6 * select(1.0, HU.actor3.x, HU.actor3.w > 0.5) + 0.42 * faceLit + HU.actor3.y;
  let aa = max(fwidth(t), 1e-3);
  let lit = smoothstep(-aa, aa, t + 0.05);
  let cm = HU.cel[min(mat, 15u)];
  let fill = srgbToLin(select(celFill(mat), cm.rgb, cm.w > 0.5));
  let sm = HU.celShade[min(mat, 15u)];
  let shade = fill * select(celShadeMul(mat), sm.rgb, sm.w > 0.5);
  var col = mix(shade, fill, lit);
  // the face, drawn
  if (faceZone > 0.5 && (mat == 0u || mat == 11u)) {
    // (the head's turn from the camera to the head's middle, not each pixel's own view: up close those sweep across
    // the eyes' near / far switch and would crease them)
    let hc = dqPointRD(HU.headR, HU.headD, vec3f(0.0, E.y, E.z - 0.075)) - L.origin - L.eye;
    let Vh = dqDirR(vec4f(-q.xyz, q.w), normalize(-hc));
    let fd = drawFace(hp, fpx, lit, atan2(Vh.x, Vh.z), false);
    col = mix(col, srgbToLin(fd.col), fd.a);
  }
  // a thin warm rim on the shadow side when the light is behind them
  let nv = max(dot(N, V), 0.0);
  let back = smoothstep(0.2, 0.7, dot(-V, L.sun)) * (1.0 - HU.sky.x);
  let rim = smoothstep(0.82, 0.86, 1.0 - nv) * back * (1.0 - lit);
  col = mix(col, fill * vec3f(1.25, 1.12, 1.0), rim * 0.85);
  // (under the meadow — long hair down the back, lying on it — nothing)
  if (underGround(in.rel)) { discard; }
  var o: FOut;
  o.col = vec4f(celLock(pow(max(col, vec3f(0.0)), vec3f(1.0 / 2.2)) * celCondition()), 1.0);
  o.dist = vec4f(1.0 / max(length(in.rel), 1e-12), 0.0, 0.0, 1.0);
  return o;
}

// the ink line: the mesh again, pushed out along its normals by a constant width on screen, back faces only, so a
// dark rim shows round every silhouette; pushed a little away from the camera too, so it shows only where it clears
// what's behind it; the face keeps a deep push, so its nose and cheeks never draw one over it
struct LOut { @builtin(position) pos: vec4f, @location(0) rel: vec3f };
@vertex fn vsOutline(v: VIn) -> LOut {
  var o: LOut;
  let mat = v.pm.w & 0xffu;
  let lp = bindPos(v);
  var rel = (dqPointRD(HU.headR, HU.headD, lp) - L.origin) - L.eye;
  if (hidden(mat)) { o.pos = vec4f(0.0, 0.0, -2.0, 1.0); o.rel = rel; return o; }
  let n = dqDirR(HU.headR, v.nrm.xyz);
  let dist = max(length(rel), 1e-9);
  // (width set for 1080 lines: thinner as the target's lines drop, never under about a pixel)
  let px = max(HU.toon.x / (1080.0 * L.view.y), 1.0);
  rel += n * px * L.pxAngle * dist;
  let face = (mat == 0u || mat == 11u) && lp.y > HU.eye.y - 0.11;
  rel += normalize(rel) * min(select(0.004, 0.02, face) * dist, 0.06);
  o.pos = figClip(rel);
  o.rel = rel;
  return o;
}
@fragment fn fsOutline(in: LOut) -> FOut {
  // near-black, warm (the show's lines are dark brown-black), as dark in the shade as in the sun
  if (underGround(in.rel)) { discard; }
  var o: FOut;
  o.col = vec4f(celLock(vec3f(0.09, 0.06, 0.055) * celCondition()), 1.0);
  o.dist = vec4f(1.0 / max(length(in.rel), 1e-12), 0.0, 0.0, 1.0);
  return o;
}
