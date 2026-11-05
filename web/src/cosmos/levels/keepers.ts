// The keepers (beyond.ts): two beings past the edge of the observable universe who keep universes as marbles — ours
// hovering over the first one's palm, the second turning one of its own between its hands while smaller ones go round it
// as electrons go round a nucleus, and a thread of light strung between them with more universes wound on it as DNA is
// wound on its spools. Their shapes are made here once, as meshes from signed distances (naive surface nets: a head, a
// robed body, a palm), and posed every frame: each rigid part its own transform, the necks, arms and fingers tubes swept
// along their joints. Every motion is a whole number of turns in `cycle` seconds, so a film that loops on that period
// finds them where it left them. Units: centimetres, y up, our universe's marble at the origin.

export type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const madd = (a: V3, b: V3, k: number): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** v turned by `a` (rad) about the unit axis k (Rodrigues) */
const turn = (v: V3, k: V3, a: number): V3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
};
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const ss = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export { add, sub, mul, madd, dot, cross, len, norm, lerp, turn };

// ---------------------------------------------------------------- signed distances
const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);
function ell(x: number, y: number, z: number, rx: number, ry: number, rz: number) {
  const k0 = Math.hypot(x / rx, y / ry, z / rz), k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
}
function capsule(x: number, y: number, z: number, a: V3, b: V3, r: number) {
  const pa: V3 = [x - a[0], y - a[1], z - a[2]], ba = sub(b, a);
  const h = clamp(dot(pa, ba) / dot(ba, ba), 0, 1);
  return len(madd(pa, ba, -h)) - r;
}
function roundCone(x: number, y: number, z: number, a: V3, b: V3, r1: number, r2: number) {
  const pa: V3 = [x - a[0], y - a[1], z - a[2]], ba = sub(b, a);
  const h = clamp(dot(pa, ba) / dot(ba, ba), 0, 1);
  return len(madd(pa, ba, -h)) - (r1 + (r2 - r1) * h);
}
const torus = (x: number, y: number, z: number, R: number, r: number) => Math.hypot(Math.hypot(x, z) - R, y) - r;

/** the head's proportions: the second keeper's crest longer, its face narrower */
/** the head's proportions: the first keeper's long, a fin along its crown; the second's broad, two ridges swept back
 *  like horns and the fin all but gone */
export interface HeadShape { crest: number; width: number; brow: number; ridges: number }
export const HEAD_A: HeadShape = { crest: 1, width: 1, brow: 1, ridges: 0.5 };
export const HEAD_B: HeadShape = { crest: 0.4, width: 1.18, brow: 1.35, ridges: 1.8 };
/** their bodies (the robed body's mesh scaled across, up, front to back): the first tall and slender, the second broad */
export const BUILD_A: V3 = [0.94, 1.06, 0.94], BUILD_B: V3 = [1.2, 0.95, 1.12];

// the eyes: where they sit (each side), how they slant, their size (shared with c_keepers.wgsl's eye())
export const EYE_AT: V3 = [2.85, 0.35, 4.25], EYE_SLANT = 0.36, EYE_R: V3 = [2.75, 1.5, 1.55];

/** a keeper's head (x right, y up, z where it looks; the middle of the skull near the origin): a long skull swept back and
 *  up with a fin along it, a narrow face and chin, high cheekbones and brow, almond eyes slanting up and out, a small
 *  mouth, two slits for a nose */
export function headSd(x: number, y: number, z: number, h: HeadShape) {
  const ax = Math.abs(x) / h.width;
  // the skull, its long axis back and up
  const cy = y - 2.8, cz = z + 4.0;
  const L = cy * 0.38 - cz * 0.925, P = cy * 0.925 + cz * 0.38;
  let d = ell(ax, P, L, 6.9, 7.4, 12.5 * (0.9 + 0.1 * h.crest));
  // the face, the chin, the cheekbones, the brow
  d = smin(d, ell(ax, y + 2.0, z - 1.8, 4.7, 6.3, 5.3), 3.6);
  d = smin(d, ell(ax, y + 7.2, z - 2.9, 2.2, 2.0, 2.3), 3.0);
  d = smin(d, ell(ax - 3.5, y + 0.6, z - 3.3, 2.0, 1.25, 2.5), 1.6);
  d = smin(d, ell(ax, y - 2.1, z - 4.3, 4.8, 1.25 * h.brow, 2.4), 1.7);
  // the fin along the skull's crown
  const fy = y - 7.0, fz = z + 6.5;
  d = smin(d, ell(ax, fy * 0.925 + fz * 0.38, fy * 0.38 - fz * 0.925, 1.0, 3.2, 12.5 * h.crest), 2.0);
  // (and two ridges either side of it, swept back: the second keeper's like horns)
  const rg = h.ridges;
  d = smin(d, ell(ax - 3.2 - 0.6 * rg, fy * 0.925 + fz * 0.38 + 2.2 - 0.6 * rg, fy * 0.38 - fz * 0.925 + 1.5, 0.45 + 0.4 * rg, 0.9 + 0.8 * rg, 6 + 4.5 * rg), 1.6);
  // the eyes' sockets, and the eyes in them
  const ex = ax - EYE_AT[0], ey = y - EYE_AT[1], c = Math.cos(EYE_SLANT), s = Math.sin(EYE_SLANT);
  const qx = ex * c + ey * s, qy = -ex * s + ey * c;
  d = smax(d, -ell(qx, qy, z - EYE_AT[2] - 0.5, 3.05, 1.72, 2.3), 0.8);
  d = Math.min(d, ell(qx, qy, z - EYE_AT[2] - 0.32, EYE_R[0], EYE_R[1], EYE_R[2]));
  // the mouth, the nose's slits
  d = smax(d, -ell(ax, y + 5.4, z - 6.25, 1.6, 0.14, 0.9), 0.25);
  d = smax(d, -ell(ax - 0.55, y + 2.4, z - 6.55, 0.13, 0.5, 0.45), 0.12);
  return d;
}

/** a keeper's body (x right, y up, z forward; the middle of the chest at the origin): shoulders, a long robe flaring as
 *  it falls, in folds below the chest; gold round the neck and a medallion over the heart */
export function torsoSd(x: number, y: number, z: number) {
  let d = capsule(x, y, z, [-12.5, 7.5, -1], [12.5, 7.5, -1], 5.2);
  d = smin(d, ell(x, y, z, 12.5, 13, 8.5), 5);
  // (flattened front to back)
  const zf = (z + 0.8) / 0.74;
  let robe = roundCone(x, y, zf, [0, -8, 0], [0, -95, 0], 11, 23);
  const a = Math.atan2(x, zf);
  robe += 0.75 * Math.sin(a * 11 + y * 0.045) * ss(-12, -34, y) + 0.35 * Math.sin(a * 23 - y * 0.08) * ss(-30, -60, y);
  d = smin(d, robe, 6);
  d = Math.min(d, torus(x, y - 10.4, z + 0.6, 5.3, 0.8));
  d = Math.min(d, Math.max(Math.hypot(x, y - 1.5) - 2.5, Math.abs(z - 8.3) - 0.4));
  return d;
}

/** a right palm (x toward the thumb, y out of the palm, z toward the fingers; its middle at the origin): cupped a little,
 *  a heel and the thumb's mound, the knuckles' ridge, the wrist going back into the sleeve */
export function palmSd(x: number, y: number, z: number) {
  const yy = y - 0.07 * x * x;
  const qx = Math.abs(x) - 1.95, qy = Math.abs(yy) - 0.05, qz = Math.abs(z) - 2.85;
  let d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - 0.62;
  d = smin(d, ell(x - 0.5, y + 0.2, z + 2.8, 2.8, 1.1, 1.8), 1.0);
  d = smin(d, ell(x - 2.4, y - 0.2, z + 1.6, 1.4, 1.0, 2.2), 1.0);
  d = smin(d, capsule(x, y, z, [-2.3, -0.15, 3.4], [2.3, -0.15, 3.4], 0.95), 0.8);
  d = smin(d, roundCone(x, y, z, [0.3, -0.3, -3.4], [0.2, -0.3, -7.5], 1.25, 1.05), 1.2);
  return d;
}

// ---------------------------------------------------------------- meshes
/** vertices: position, normal, uv (a tube's along and around; a part's nothing), tag (part | kind << 16) */
export const VFLOATS = 9;
export const VBYTES = VFLOATS * 4;
export class MeshData {
  v: number[] = [];
  i: number[] = [];
  get count() { return this.v.length / VFLOATS; }
  vert(p: V3, n: V3, u: number, w: number, tag: number) { this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], u, w, tag); return this.count - 1; }
}
/** what a vertex is: the shader shades by it */
export const KIND = { skin: 0, head: 1, robe: 2, palm: 3, sleeve: 4, trim: 5, finger: 6 } as const;
export const DYNAMIC = 0xffff;
export const tag = (part: number, kind: number, keeper = 0) => part | (kind << 16) | (keeper << 24);

/** a closed surface from a signed distance over a box, cells about `h` across (naive surface nets: a vertex in each cell
 *  the surface passes through, at the mean of where it crosses the cell's edges; a quad across each edge it crosses) */
export function nets(sd: (x: number, y: number, z: number) => number, lo: V3, hi: V3, h: number, t: number, out: MeshData) {
  const nx = Math.ceil((hi[0] - lo[0]) / h), ny = Math.ceil((hi[1] - lo[1]) / h), nz = Math.ceil((hi[2] - lo[2]) / h);
  const sx = nx + 1, sy = ny + 1;
  const f = new Float32Array(sx * sy * (nz + 1));
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) f[i + sx * (j + sy * k)] = sd(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
  const at = (i: number, j: number, k: number) => f[i + sx * (j + sy * k)];
  const cell = new Int32Array(nx * ny * nz).fill(-1);
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const C: V3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const vals = new Float32Array(8);
  const e = h * 0.5;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) { vals[c] = at(i + C[c][0], j + C[c][1], k + C[c][2]); if (vals[c] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let px = 0, py = 0, pz = 0, m = 0;
    for (const [a, b] of E) {
      const va = vals[a], vb = vals[b];
      if ((va < 0) === (vb < 0)) continue;
      const u = va / (va - vb);
      px += C[a][0] + (C[b][0] - C[a][0]) * u; py += C[a][1] + (C[b][1] - C[a][1]) * u; pz += C[a][2] + (C[b][2] - C[a][2]) * u;
      m++;
    }
    const p: V3 = [lo[0] + (i + px / m) * h, lo[1] + (j + py / m) * h, lo[2] + (k + pz / m) * h];
    const n = norm([sd(p[0] + e, p[1], p[2]) - sd(p[0] - e, p[1], p[2]), sd(p[0], p[1] + e, p[2]) - sd(p[0], p[1] - e, p[2]), sd(p[0], p[1], p[2] + e) - sd(p[0], p[1], p[2] - e)]);
    cell[i + nx * (j + ny * k)] = out.vert(p, n, 0, 0, t);
  }
  const ci = (i: number, j: number, k: number) => cell[i + nx * (j + ny * k)];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) out.i.push(a, c, b, a, d, c); else out.i.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = at(i, j, k), b = at(i + 1, j, k);
    if ((a < 0) !== (b < 0)) quad(ci(i, j - 1, k - 1), ci(i, j, k - 1), ci(i, j, k), ci(i, j - 1, k), a < 0);
  }
  for (let k = 1; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 1; i < nx; i++) {
    const a = at(i, j, k), b = at(i, j + 1, k);
    if ((a < 0) !== (b < 0)) quad(ci(i - 1, j, k - 1), ci(i - 1, j, k), ci(i, j, k), ci(i, j, k - 1), a < 0);
  }
  for (let k = 0; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 1; i < nx; i++) {
    const a = at(i, j, k), b = at(i, j, k + 1);
    if ((a < 0) !== (b < 0)) quad(ci(i - 1, j - 1, k), ci(i, j - 1, k), ci(i, j, k), ci(i - 1, j, k), a < 0);
  }
}

/** a tube swept through points (a Catmull-Rom curve), its radius at each, `sides` round, rounded shut at the end (and the
 *  start, `capStart`); uv: how far along (0..1) and round */
export function tube(out: MeshData, pts: V3[], radii: number[], sides: number, perSeg: number, t: number, capStart = false, capEnd = true) {
  const P: V3[] = [], R: number[] = [];
  const n = pts.length;
  for (let s = 0; s < n - 1; s++) {
    const p0 = pts[Math.max(0, s - 1)], p1 = pts[s], p2 = pts[s + 1], p3 = pts[Math.min(n - 1, s + 2)];
    for (let k = 0; k < perSeg; k++) {
      const u = k / perSeg, u2 = u * u, u3 = u2 * u;
      const c = (i: number) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * u + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * u2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * u3);
      P.push([c(0), c(1), c(2)]);
      const r1 = radii[s], r2 = radii[s + 1];
      R.push(r1 + (r2 - r1) * (u * u * (3 - 2 * u)));
    }
  }
  P.push(pts[n - 1]); R.push(radii[n - 1]);
  // frames carried along (parallel transport), so the tube doesn't twist
  let T = norm(sub(P[1], P[0]));
  let N = norm(cross(T, Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const rings: number[] = [];
  const total = P.length - 1;
  // (a ring round c; over a cap, `ca` and `sa` the cosine and sine of how far it has closed toward the tip along T·dir)
  const ring = (c: V3, r: number, T: V3, N: V3, u: number, ca = 1, sa = 0, dir = 1) => {
    const B = cross(T, N), first = out.count;
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const d = add(mul(N, Math.cos(a)), mul(B, Math.sin(a)));
      out.vert(madd(madd(c, d, r * ca), T, r * sa * dir), norm(madd(mul(d, ca), T, sa * dir)), u, k / sides, t);
    }
    return first;
  };
  // (a rounded cap: rings closing over the end)
  const cap = (c: V3, r: number, T: V3, N: V3, u: number, dir: number) => {
    const first: number[] = [];
    for (let q = 1; q <= 3; q++) {
      const a = (q / 3) * Math.PI * 0.5 * (q === 3 ? 0.985 : 1);
      first.push(ring(c, r, T, N, u, Math.cos(a), Math.sin(a), dir));
    }
    return first;
  };
  for (let s = 0; s <= total; s++) {
    if (s > 0) {
      const T2 = norm(sub(P[Math.min(total, s + 1)], P[s - 1]));
      const ax = cross(T, T2), sa = len(ax);
      if (sa > 1e-6) N = norm(turn(N, mul(ax, 1 / sa), Math.asin(Math.min(1, sa))));
      T = T2;
    }
    rings.push(ring(P[s], R[s], T, N, s / total));
  }
  const strip = (a: number, b: number) => { for (let k = 0; k < sides; k++) out.i.push(a + k, b + k, b + k + 1, a + k, b + k + 1, a + k + 1); };
  for (let s = 0; s < total; s++) strip(rings[s], rings[s + 1]);
  if (capEnd) {
    const endCaps = cap(P[total], R[total], T, N, 1, 1);
    let prev = rings[total];
    for (const r of endCaps) { strip(prev, r); prev = r; }
  }
  if (capStart) {
    const T0 = norm(sub(P[1], P[0]));
    const N0 = norm(cross(T0, Math.abs(T0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    // (the first ring's own frame: rebuilt, so the cap meets it)
    const starts = cap(P[0], R[0], T0, N0, 0, -1);
    let p = ring(P[0], R[0], T0, N0, 0);
    for (const r of starts) { strip(r, p); p = r; }
  }
}

// ---------------------------------------------------------------- the pose
/** their hands against the palm's mesh (palmSd's units): a size up from a person's */
export const HAND = 1.25;
/** a rigid part's frame: where its origin is, its axes (x, y, z), and a mirror (-1: a left hand) */
export interface Frame3 { o: V3; x: V3; y: V3; z: V3; mirror: number }
export interface Hand {
  /** the palm's frame (x toward the thumb, y out of the palm, z along the fingers) */
  palm: Frame3;
  /** the finger joints, base to tip (the last finger is the thumb) */
  fingers: V3[][];
  /** the arm: shoulder, elbow, wrist */
  arm: [V3, V3, V3];
}
export interface KeeperPose {
  /** which (0 the first, 1 the second), and its build */
  keeper: number;
  build: V3;
  chest: Frame3;
  head: Frame3;
  hands: [Hand, Hand];
  neck: V3[];
}

const frameOf = (o: V3, zAxis: V3, yHint: V3, mirror = 1): Frame3 => {
  const z = norm(zAxis), x = norm(cross(yHint, z)), y = cross(z, x);
  return { o, x: mul(x, mirror), y, z, mirror };
};
const local = (f: Frame3, p: V3): V3 => add(f.o, add(add(mul(f.x, p[0]), mul(f.y, p[1])), mul(f.z, p[2])));
const localDir = (f: Frame3, p: V3): V3 => add(add(mul(f.x, p[0]), mul(f.y, p[1])), mul(f.z, p[2]));

/** two bones from a shoulder to a wrist, the elbow bent toward `pole` */
function elbow(s: V3, w: V3, a: number, b: number, pole: V3): V3 {
  const d = sub(w, s), L = clamp(len(d), Math.abs(a - b) + 0.01, a + b - 0.01), u = norm(d);
  const x = (a * a - b * b + L * L) / (2 * L), h = Math.sqrt(Math.max(0, a * a - x * x));
  const side = norm(madd(pole, u, -dot(pole, u)));
  return add(madd(s, u, x), mul(side, h));
}

/** the fingers of a hand: base offsets in the palm, each finger's lengths, its curl at each joint (rad, toward the palm)
 *  and its splay */
function fingers(palm: Frame3, curls: number[][], spread: number, thumbOpen: number): V3[][] {
  const out: V3[][] = [];
  const base: V3[] = ([[-2.05, -0.1, 3.7], [0, -0.05, 3.95], [2.05, -0.1, 3.7]] as V3[]).map((b) => mul(b, HAND));
  const lens = [[4.9, 3.6, 3.0], [5.6, 4.1, 3.3], [5.0, 3.7, 3.05]].map((l) => l.map((x) => x * HAND));
  for (let f = 0; f < 3; f++) {
    const splay = (f - 1) * (0.16 + spread * 0.22);
    let dir: V3 = [Math.sin(splay), 0, Math.cos(splay)], p = base[f];
    const pts: V3[] = [local(palm, p)];
    for (let j = 0; j < 3; j++) {
      // (bending toward the palm: about the finger's own side axis)
      const side = norm(cross([0, 1, 0], dir));
      dir = norm(turn(dir, side, -curls[f][j]));
      p = madd(p, dir, lens[f][j]);
      pts.push(local(palm, p));
    }
    out.push(pts);
  }
  // the thumb, from the heel of the palm, across and up
  let dir: V3 = norm([0.82 + thumbOpen * 0.1, 0.32 - thumbOpen * 0.15, 0.48]);
  let p: V3 = mul([2.75, 0.1, -1.1], HAND);
  const pts: V3[] = [local(palm, p)];
  const tl = [3.2, 2.6, 2.1].map((x) => x * HAND);
  for (let j = 0; j < 3; j++) {
    const side = norm(cross([0, 1, 0], dir));
    dir = norm(turn(dir, side, -curls[3][j]));
    p = madd(p, dir, tl[j]);
    pts.push(local(palm, p));
  }
  out.push(pts);
  return out;
}

/** where every keeper is at time t (s), every motion a whole number of turns in `cycle` s */
export class Choreography {
  constructor(public cycle = 120) {}
  /** a slow wave of about `period` s (made a whole number of turns in the cycle) */
  w(t: number, period: number, phase = 0) {
    const n = Math.max(1, Math.round(this.cycle / period));
    return Math.sin((2 * Math.PI * n * t) / this.cycle + phase);
  }
  /** its turning angle (rad) after t s at about `period` s a turn */
  a(t: number, period: number, phase = 0) {
    const n = Math.max(1, Math.round(this.cycle / period));
    return (2 * Math.PI * n * t) / this.cycle + phase;
  }
}

export const ORB_R = 3.2;
/** the keepers' marbles of their own: the second keeper's, between its hands */
export const ORB_B: V3 = [27, 11, -18];
export const ORB_B_R = 4.6;
/** the middle of their world, and its sky's radius (cm) */
export const WORLD_C: V3 = [3, 14, -12];
export const WORLD_R = 240;

/** the first keeper: our universe over its right palm, its left hand spinning the thread */
export function poseA(t: number, C: Choreography, orb: V3): KeeperPose {
  const breath = C.w(t, 5.2);
  const chest = frameOf([-37, 9 + breath * 0.35, -5], [0.86, 0, 0.5], [0, 1, 0]);
  const bd = BUILD_A;
  // the head, bowed over the orb, its gaze drifting
  const headAt = local(chest, [0, 30.5 * bd[1] + breath * 0.2, 4.5]);
  const toOrb = add(sub(orb, headAt), [C.w(t, 9.5) * 3, 2 + C.w(t, 13, 1) * 1.5, C.w(t, 7.5, 2) * 2]);
  const look = norm([toOrb[0], toOrb[1] * 0.55, toOrb[2]]);
  const head = frameOf(headAt, look, norm(add([0, 1, 0], mul(look, -0.3))));
  // the right hand under the orb, palm up, rising and falling with it
  const bob = C.w(t, 6.1, 0.5);
  const palmR = frameOf([orb[0] - 1.6, orb[1] - 7.6 + bob * 0.25, orb[2] + 1.0], [0.78, 0.18, 0.6], norm([-0.12, 1, 0.08]));
  const curlR = [0, 1, 2, 3].map((f) => [0, 1, 2].map((j) => (f === 3 ? 0.1 : 0.14 + j * 0.07) + 0.17 * C.w(t, 3.4 + f * 0.5, f * 1.3 + j * 0.4)));
  // the left hand raised to its side, slowly circling as it spins the thread, fingers rippling
  const lc = C.a(t, 8.4);
  const palmL = frameOf(add([-19, 31, -27], [Math.cos(lc) * 1.6, Math.sin(lc) * 1.6, Math.sin(lc) * 0.8]),
    norm([0.45 + C.w(t, 8.4, 1) * 0.08, 0.72, -0.1]), norm([0.45, -0.25, 0.85]), -1);
  const curlL = [0, 1, 2, 3].map((f) => [0, 1, 2].map((j) => 0.1 + j * 0.04 + 0.22 * Math.max(0, C.w(t, 3.5, -f * 0.9 - j * 0.5))));
  const shR = local(chest, [12.5 * bd[0], 7.5 * bd[1], -1]), shL = local(chest, [-12.5 * bd[0], 7.5 * bd[1], -1]);
  const wristR = local(palmR, [0.2 * HAND, -0.3 * HAND, -6.2 * HAND]), wristL = local(palmL, [0.2 * HAND, -0.3 * HAND, -6.2 * HAND]);
  const hands: [Hand, Hand] = [
    { palm: palmR, fingers: fingers(palmR, curlR, 0.15, 0.4), arm: [shR, elbow(shR, wristR, 27, 25, local(chest, [6, -10, -12])), wristR] },
    { palm: palmL, fingers: fingers(palmL, curlL, 0.7, 1), arm: [shL, elbow(shL, wristL, 27, 25, local(chest, [-14, -14, -6])), wristL] },
  ];
  return { keeper: 0, build: bd, chest, head, hands, neck: neckOf(chest, head, bd) };
}

/** the second keeper: turning its own marble between its hands, its electrons going round */
export function poseB(t: number, C: Choreography): KeeperPose {
  const breath = C.w(t, 5.8, 2);
  const chest = frameOf([44, 6 + breath * 0.35, -36], [-0.72, 0, 0.7], [0, 1, 0]);
  const bd = BUILD_B;
  const headAt = local(chest, [0, 31 * bd[1] + breath * 0.2, 4.5]);
  // (between its own marble and the first keeper's, curious)
  const k = 0.5 + 0.5 * C.w(t, 11, 0.3);
  const target = lerp(ORB_B, [0, 2, 0], k * 0.65);
  const toT = add(sub(target, headAt), [0, C.w(t, 7, 1) * 2, 0]);
  const look = norm([toT[0], toT[1] * 0.55, toT[2]]);
  const head = frameOf(headAt, look, norm(add([0, 1, 0], mul(look, -0.25))));
  // the hands either side of its marble, palms toward it, turning round it
  const a = C.a(t, 9) * 0.5, tilt = 0.25 * C.w(t, 9, 1.7);
  const axis = norm([Math.sin(tilt), 1, 0.2]);
  const sideBase = norm(cross(axis, [0.3, 0, 1]));
  const side = turn(sideBase, axis, Math.sin(a) * 0.5);
  const handAt = (s: number) => madd(ORB_B, side, s * (ORB_B_R + 3.2));
  const palm = (s: number) => {
    const o = handAt(s);
    // (palm toward the marble, fingers up and a little forward)
    // (fingers reaching forward past it and round, not up: a cradle, not a cage)
    return frameOf(add(o, mul(axis, -1.5)), norm(add(add(mul(chest.z, 0.85), mul(side, -s * 0.3)), mul(axis, 0.25))), mul(side, -s), s > 0 ? 1 : -1);
  };
  // (the chest's right is toward its +x: the right hand on the +side)
  const sgn = dot(side, chest.x) > 0 ? 1 : -1;
  const palmR = palm(sgn), palmL = palm(-sgn);
  const curl = (ph: number) => [0, 1, 2, 3].map((f) => [0, 1, 2].map((j) => 0.08 + j * 0.05 + 0.08 * C.w(t, 4.6, ph + f * 0.8)));
  const shR = local(chest, [12.5 * bd[0], 7.5 * bd[1], -1]), shL = local(chest, [-12.5 * bd[0], 7.5 * bd[1], -1]);
  const wristR = local(palmR, [0.2 * HAND, -0.3 * HAND, -6.2 * HAND]), wristL = local(palmL, [0.2 * HAND, -0.3 * HAND, -6.2 * HAND]);
  const hands: [Hand, Hand] = [
    { palm: palmR, fingers: fingers(palmR, curl(0), 0.3, 0.6), arm: [shR, elbow(shR, wristR, 27, 25, local(chest, [10, -14, -8])), wristR] },
    { palm: palmL, fingers: fingers(palmL, curl(2), 0.3, 0.6), arm: [shL, elbow(shL, wristL, 27, 25, local(chest, [-10, -14, -8])), wristL] },
  ];
  return { keeper: 1, build: bd, chest, head, hands, neck: neckOf(chest, head, bd) };
}

function neckOf(chest: Frame3, head: Frame3, bd: V3): V3[] {
  const a = local(chest, [0, 9.5 * bd[1], -0.6]), b = local(head, [0, -6.2, -2.6]);
  const mid = add(lerp(a, b, 0.5), mul(chest.z, 0.8));
  return [local(chest, [0, 4 * bd[1], -0.8]), a, mid, b, local(head, [0, -2.5, -2.0])];
}

/** the posed limbs as tubes (world space, cm): the neck, each arm's sleeve, the wrist, the fingers */
export function limbs(out: MeshData, p: KeeperPose, hi: boolean) {
  const sides = hi ? 14 : 9, seg = hi ? 5 : 3, kp = p.keeper;
  tube(out, p.neck, [4.6, 3.8, 3.3, 3.1, 2.9].map((r) => r * (kp ? 1.12 : 0.95)), sides, seg, tag(DYNAMIC, KIND.skin, kp), true);
  for (const h of p.hands) {
    const [s, e, w] = h.arm;
    // the sleeve to most of the way down the forearm, belling out, then gathered in at the cuff round the wrist
    const end = lerp(e, w, 0.74);
    tube(out, [lerp(s, p.chest.o, 0.45), s, e, lerp(e, w, 0.4), lerp(e, w, 0.66), end], [4.2, 4.6, 4.0, 4.4, 4.6, 2.3], sides + 2, seg, tag(DYNAMIC, KIND.sleeve, kp), true, true);
    tube(out, [lerp(e, w, 0.5), lerp(e, w, 0.8), w, local(h.palm, [0.2 * HAND, -0.3 * HAND, -3.6 * HAND])], [1.7, 1.5, 1.35, 1.3], sides, seg, tag(DYNAMIC, KIND.skin, kp));
    for (let f = 0; f < 4; f++) {
      const pts = h.fingers[f];
      const r = (f === 3 ? [0.62, 0.52, 0.43, 0.3] : [0.5, 0.43, 0.36, 0.24]).map((x) => x * HAND);
      // (from just inside the palm, so the root is hidden in it)
      const root = madd(pts[0], norm(sub(pts[0], pts[1])), 0.9);
      tube(out, [root, ...pts], [r[0] * 1.05, ...r], hi ? 10 : 7, hi ? 4 : 2, tag(DYNAMIC, KIND.finger, kp));
    }
  }
}

/** the four fingertips of each hand (the glow of what they do comes from them) */
export const tips = (p: KeeperPose): V3[] => p.hands.flatMap((h) => h.fingers.map((f) => f[3]));
export { frameOf, local, localDir };
