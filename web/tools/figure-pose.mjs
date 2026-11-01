// One of Boulder's cast (a DNC1 mesh from its town pipeline, public/data/figure/<who>.bin.gz) laid on their back in the
// meadow, and
// what the cosmos needs to know of it, written as constants:
//   src/cosmos/figure/pose.ts       the lying pose (one rigid transform, bind -> the ground frame, as a dual
//                                   quaternion), the dive's target on the drawn right iris, the parts left out
//   src/cosmos/shaders/figproxy.wgsl  capsules round the body, for its shadow on the grass and the blades it presses
// The ground frame (metres): the right iris's target over the origin, the body along +x (feet that way), the face up
// (+y), its left toward -z; the back of the head, the shoulders, the seat and the heels on the grass (y = 0).
//   node tools/figure-pose.mjs [--who lyra]   (figure/cast.ts has their look; FIGURE names who's drawn)
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname;
const ai = process.argv.indexOf('--who');
const WHO = ai > 0 ? process.argv[ai + 1] : 'eli';
const buf = gunzipSync(readFileSync(root + `public/data/figure/${WHO}.bin.gz`));
const dv = new DataView(buf.buffer, buf.byteOffset);
const hl = dv.getUint32(8, true);
const h = JSON.parse(buf.subarray(12, 12 + hl).toString());
const V = buf.subarray(12 + hl, 12 + hl + h.verts * 24);
const I = new Uint32Array(buf.buffer.slice(buf.byteOffset + 12 + hl + h.verts * 24, buf.byteOffset + 12 + hl + h.verts * 24 + h.indices * 4));
const lo = h.qmin, span = h.qmax.map((x, i) => x - lo[i]);
const pos = (i) => [0, 1, 2].map((k) => lo[k] + (V[i * 24 + k * 2] | (V[i * 24 + k * 2 + 1] << 8)) / 65535 * span[k]);
const mat = (i) => V[i * 24 + 6];
const bone = Object.fromEntries(h.bones.map((b) => [b.name, b]));


// the back: the lowest point (bind z) of the torso's clothes and skin and the back of the head's skin (not the hair
// or a hat: they go into the grass) — near enough one plane for them to lie flat together
let back = 0;
for (let i = 0; i < h.verts; i++) {
  const p = pos(i), m = mat(i);
  const torso = p[1] > 1.0 && p[1] < 1.45 && Math.abs(p[0]) < 0.17 && m !== 3 && m !== 13;
  const head = p[1] > 1.5 && m === 0;
  if ((torso || head) && p[2] < back) back = p[2];
}

// the target: on the drawn right eye (hero.wgsl drawEye, the character's right: side -1), in the iris between the
// pupil and its rim, down and in from its middle (clear of the catchlight), on the skin's surface there
// (their eyes larger by this: figure/cast.ts, their look's cast.x)
const EYES = { eli: 0.05, lyra: 0.12 };
const E = h.eye, look = { eyes: EYES[WHO] ?? 0 };
const ek = 1.08 * (1 + look.eyes);
const ue = Math.atan2(E.x, E.z + E.r) * 0.1;
const xEye = 0.001 - 0.0062, yEye = 0.0021 - 0.004; // (eye-local: the iris's middle is (0.001, 0.0021))
const u = -ue - xEye * ek, v = E.y + yEye * ek, a = u * 10;
const ro = [0, v, 0], rd = [Math.sin(a), 0, Math.cos(a)];
const sub = (p, q) => p.map((x, i) => x - q[i]);
const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
let tHit = -1, nHit = null;
for (let t = 0; t < I.length; t += 3) {
  if (mat(I[t]) !== 0) continue;
  const A = pos(I[t]), B = pos(I[t + 1]), C = pos(I[t + 2]);
  const e1 = sub(B, A), e2 = sub(C, A), pv = cross(rd, e2), det = dot(e1, pv);
  if (Math.abs(det) < 1e-12) continue;
  const tv = sub(ro, A), bu = dot(tv, pv) / det;
  if (bu < 0 || bu > 1) continue;
  const qv = cross(tv, e1), bv = dot(rd, qv) / det;
  if (bv < 0 || bu + bv > 1) continue;
  const tt = dot(e2, qv) / det;
  if (tt > tHit) { tHit = tt; nHit = cross(e1, e2); }
}
const target = ro.map((x, i) => x + rd[i] * tHit);
const nLen = Math.hypot(...nHit), focusN = nHit.map((x) => (x / nLen) * Math.sign(dot(nHit, rd)));

// bind (A-pose, facing +z, +x their left, +y up) -> ground: up the body -> -x, facing -> +y, their left -> -z; the
// target over the origin, the back on the grass
const M = [[0, -1, 0], [0, 0, 1], [-1, 0, 0]];   // rows
const T = [target[1], -back, target[0]];
const toGround = (p) => [M[0][0] * p[0] + M[0][1] * p[1] + M[0][2] * p[2] + T[0], M[1][0] * p[0] + M[1][1] * p[1] + M[1][2] * p[2] + T[1], M[2][0] * p[0] + M[2][1] * p[1] + M[2][2] * p[2] + T[2]];
// the rotation as a quaternion (x y z w), the translation as its dual part: d = t q / 2
const tr = M[0][0] + M[1][1] + M[2][2];
let q;
{
  // (trace -1 + ...: the largest diagonal's branch)
  const s = Math.sqrt(1 + tr) * 2;
  if (tr > 0) q = [(M[2][1] - M[1][2]) / s, (M[0][2] - M[2][0]) / s, (M[1][0] - M[0][1]) / s, s / 4];
  else {
    const i = M[0][0] >= M[1][1] && M[0][0] >= M[2][2] ? 0 : M[1][1] >= M[2][2] ? 1 : 2, j = (i + 1) % 3, k = (i + 2) % 3;
    const r = Math.sqrt(1 + M[i][i] - M[j][j] - M[k][k]) * 2;
    q = [0, 0, 0, 0];
    q[i] = r / 4; q[j] = (M[j][i] + M[i][j]) / r; q[k] = (M[k][i] + M[i][k]) / r; q[3] = (M[k][j] - M[j][k]) / r;
  }
}
const qmul = (p, r) => [p[3] * r[0] + p[0] * r[3] + p[1] * r[2] - p[2] * r[1], p[3] * r[1] - p[0] * r[2] + p[1] * r[3] + p[2] * r[0], p[3] * r[2] + p[0] * r[1] - p[1] * r[0] + p[2] * r[3], p[3] * r[3] - p[0] * r[0] - p[1] * r[1] - p[2] * r[2]];
const d = qmul([T[0], T[1], T[2], 0], q).map((x) => x / 2);
// (check: the quaternion carries the bind's axes where M does)
const rot = (p) => { const c = cross(q, p).map((x, i) => x + q[3] * p[i]); return p.map((x, i) => x + 2 * cross(q, c)[i]); };
for (const [ax, want] of [[[1, 0, 0], [0, 0, -1]], [[0, 1, 0], [-1, 0, 0]], [[0, 0, 1], [0, 1, 0]]]) {
  if (rot(ax).some((x, i) => Math.abs(x - want[i]) > 1e-9)) throw new Error('rotation');
}
const eyeG = toGround(target);

// capsules round them (bind: bone heads and tails; radii by eye), for the shadow and the pressed grass
const B = (n, k = 'head') => bone[n][k];
const mid = (p, r) => p.map((x, i) => (x + r[i]) / 2);
const caps = [
  [[0, E.y - 0.03, -0.01], [0, E.y + 0.09, -0.02], 0.095, 0.09],      // the head
  [B('neck'), B('head'), 0.055, 0.055],
  [B('spine'), [0, B('neck')[1] - 0.07, -0.01], 0.125, 0.12],          // the chest
  [B('uarmR'), B('uarmL'), 0.06, 0.06],                                 // the shoulders
  [B('pelvis'), B('spine'), 0.125, 0.125],
  [mid(B('thighL'), B('thighR')), B('pelvis'), 0.12, 0.12],
];
for (const s of ['L', 'R']) {
  caps.push([B('uarm' + s), B('farm' + s), 0.048, 0.04], [B('farm' + s), B('hand' + s), 0.04, 0.032], [B('hand' + s), B('tips' + s), 0.035, 0.022],
    [B('thigh' + s), B('shin' + s), 0.08, 0.058], [B('shin' + s), B('foot' + s), 0.056, 0.045], [B('foot' + s), B('toe' + s), 0.048, 0.045]);
}
const f = (x) => x.toFixed(5), f8 = (x) => x.toFixed(8);
const v3 = (p) => `vec3f(${p.map(f).join(', ')})`;
const capsW = caps.map(([p, r, ra, rb]) => `  vec4f(${toGround(p).map(f).join(', ')}, ${f(ra)}), vec4f(${toGround(r).map(f).join(', ')}, ${f(rb)}),`).join('\n');
const all = caps.flatMap(([p, r, ra, rb]) => [toGround(p).map((x) => x - ra), toGround(p).map((x) => x + ra), toGround(r).map((x) => x - rb), toGround(r).map((x) => x + rb)]);
const bmin = [0, 1, 2].map((k) => Math.min(...all.map((p) => p[k]))), bmax = [0, 1, 2].map((k) => Math.max(...all.map((p) => p[k])));

writeFileSync(root + 'src/cosmos/figure/pose.ts', `// Written by tools/figure-pose.mjs from public/data/figure/${WHO}.bin.gz: don't edit.
/** who lies in the meadow (figure/cast.ts) */
export const FIGURE = '${WHO}';
/** bind -> the ground frame (m): the rotation (x y z w) and its dual part (Boulder's dual-quaternion skinning, every
 *  bone the same: lying still) */
export const POSE_R = [${q.map(f8).join(', ')}] as const;
export const POSE_D = [${d.map(f8).join(', ')}] as const;
/** the target in the bind space and the skin's way out there (the drawn eye's chart is laid on that plane up close:
 *  the mesh's facets would kink it) */
export const FIGURE_FOCUS = [${target.map(f8).join(', ')}] as const;
export const FIGURE_FOCUS_N = [${focusN.map(f8).join(', ')}] as const;
/** the dive's target, on the drawn right iris (the ground frame, m) */
export const FIGURE_EYE = [${eyeG.map(f8).join(', ')}] as const;
`);
writeFileSync(root + 'src/cosmos/shaders/figproxy.wgsl', `// Written by tools/figure-pose.mjs: ${WHO} lying in the meadow as tapered capsules (the ground frame, m), for their
// shadow on the grass and the blades they press flat (the figure itself is the town's mesh: figure.wgsl).
const FIG_LO = ${v3(bmin)};
const FIG_HI = ${v3(bmax)};
const FIG_N = ${caps.length};
const FIG_CAPS = array<vec4f, ${caps.length * 2}>(
${capsW}
);
fn figCap(p: vec3f, a: vec4f, b: vec4f) -> f32 {
  let pa = p - a.xyz; let ba = b.xyz - a.xyz;
  let k = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * k) - mix(a.w, b.w, k);
}
// their distance (roughly)
fn figSdf(p: vec3f) -> f32 {
  var d = 1e9;
  for (var i = 0; i < FIG_N; i++) { d = min(d, figCap(p, FIG_CAPS[i * 2], FIG_CAPS[i * 2 + 1])); }
  return d;
}
// their outline on the grass (x, z)
fn figPrint(q: vec2f) -> f32 {
  var d = 1e9;
  for (var i = 0; i < FIG_N; i++) {
    let a = FIG_CAPS[i * 2]; let b = FIG_CAPS[i * 2 + 1];
    d = min(d, figCap(vec3f(q.x, 0.0, q.y), vec4f(a.x, 0.0, a.z, a.w), vec4f(b.x, 0.0, b.z, b.w)));
  }
  return d;
}
// where a ray enters and leaves the box round them
fn figSpan(ro: vec3f, rd: vec3f) -> vec2f {
  let inv = 1.0 / select(rd, vec3f(1e-9), abs(rd) < vec3f(1e-9));
  let a = (FIG_LO - ro) * inv; let b = (FIG_HI - ro) * inv;
  let t0 = max(max(min(a.x, b.x), min(a.y, b.y)), min(a.z, b.z));
  let t1 = min(min(max(a.x, b.x), max(a.y, b.y)), max(a.z, b.z));
  return vec2f(max(t0, 0.0), t1);
}
`);
console.log('back', back, 'target bind', target, 'ground', eyeG, 'box', bmin, bmax);
