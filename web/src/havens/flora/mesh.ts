// The flora's vertex format and the kit its species are grown with: blades, strap leaves, outlined leaves and petals,
// tubes for trunks and stems, lathes for pots, lumpy masses, puffs of flakes and little balls. A species' generator lays
// its parts into a FloraMesh in the plant's own frame (metres: y up from the root, x along its facing, z out), and every
// vertex carries its normal, colour and baked occlusion, what part of the plant it is, and how the wind moves it: the
// whole plant bending by its height fraction, its branch swinging about the branch's pivot by `flex`, its leaf
// fluttering by `flutter` with the branch's phase. The shader (flora.wgsl) needs nothing else.
//
// Vertex (8 x u32): position xyz (f32); normal (10-10-10 unorm); colour (rgb8, sRGB) + occlusion (a8); part (8) | flex (8)
// | height fraction (8) | random (8); pivot xy (2 x f16); pivot z (f16) | flutter (8) | phase (8).
export type V3 = [number, number, number];

export const FLORA_VERTEX_U32 = 8;

/** what each vertex is: the shader lights, colours, burns and moves each kind its own way (flora.wgsl P_*) */
export const PART = {
  bark: 0,    // trunks and woody branches
  stem: 1,    // green stems and stalks
  blade: 2,   // grass blades and strap leaves
  leaf: 3,    // broad leaves
  petal: 4,   // petals and blossom: coloured by the instance's bloom colour (the vertex colour is its shading)
  disc: 5,    // a flower's heart, stamens, seed pods
  bract: 6,   // bougainvillea's papery bracts: coloured by the bloom colour, like petals
  needle: 7,  // the cypress's scale-leaf sprays
  frond: 8,   // palm fronds and fern fronds
  pad: 9,     // lotus pads (waxy, floating)
  fruit: 10,  // dates, pomegranates, olives
  pot: 11,    // urns (glazed or bronze: solid, glossy)
  soil: 12,   // the earth in a pot
  mass: 13,   // the leafy masses of the light levels and the shrubs' cores (lit as a soft volume)
} as const;
export type Part = (typeof PART)[keyof typeof PART];
export const PART_NAMES = Object.keys(PART) as (keyof typeof PART)[];

/** a grown mesh, ready for the GPU (and for the previews: decode()) */
export interface FloraMeshData {
  data: Uint32Array;
  indices: Uint32Array;
  vertices: number;
  triangles: number;
  /** the mesh's own height (m: its highest point, or for a hanging plant its drop) and its reach from the root axis */
  height: number;
  radius: number;
  /** bounds [min, max] */
  bounds: [V3, V3];
}

// ------------------------------------------------------------------ small math
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** any unit vector perpendicular to d */
export function perp(d: V3): V3 { return norm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])); }
export function rotateAround(v: V3, axis: V3, ang: number): V3 {
  const c = Math.cos(ang), s = Math.sin(ang);
  return add(add(mul(v, c), mul(cross(axis, v), s)), mul(axis, dot(axis, v) * (1 - c)));
}

// ------------------------------------------------------------------ randomness
/** xorshift32: the same seed grows the same plant everywhere */
export function rng(seed: number) {
  let s = (seed >>> 0) || 0x9e3779b9;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  return {
    next,
    range: (a: number, b: number) => a + (b - a) * next(),
    int: (a: number, b: number) => Math.floor(a + (b - a + 1) * next()),
    sign: () => (next() < 0.5 ? -1 : 1),
    pick: <T>(xs: readonly T[]): T => xs[Math.min(xs.length - 1, Math.floor(next() * xs.length))],
  };
}
export type Rng = ReturnType<typeof rng>;
/** a seed from numbers (a part's own stream: the levels of detail dress the same skeleton the same way) */
export function hash(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) {
    h ^= Math.floor(x * 1000) | 0;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= h >>> 15;
  }
  return h >>> 0 || 1;
}

// ------------------------------------------------------------------ colour
/** an sRGB hex colour as linear rgb */
export function hex(h: string): V3 {
  const v = parseInt(h.slice(1), 16);
  const f = (c: number) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return [f((v >> 16) & 255), f((v >> 8) & 255), f(v & 255)];
}
export const toSrgb = (x: number) => (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055);
export const fromSrgb = (x: number) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
/** a colour varied a little in brightness and hue (perceptual: in sRGB) */
export function vary(c: V3, r: Rng, light = 0.12, hue = 0.04): V3 {
  const k = 1 + r.range(-light, light);
  return [0, 1, 2].map((i) => fromSrgb(clamp(toSrgb(c[i]) * k + r.range(-hue, hue), 0, 1))) as V3;
}

// ------------------------------------------------------------------ packing
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
/** a float as IEEE half (round to nearest) */
export function toHalf(x: number): number {
  f32[0] = x;
  const b = u32[0];
  const sign = (b >>> 16) & 0x8000;
  let e = ((b >>> 23) & 0xff) - 127 + 15;
  let m = b & 0x7fffff;
  if (e <= 0) {
    if (e < -10) return sign;
    m = (m | 0x800000) >>> (1 - e);
    return sign | ((m + 0x1000) >>> 13);
  }
  if (e >= 31) return sign | 0x7c00;
  m += 0x1000;
  if (m & 0x800000) { m = 0; e += 1; if (e >= 31) return sign | 0x7c00; }
  return sign | (e << 10) | (m >>> 13);
}
export function fromHalf(h: number): number {
  const s = h & 0x8000 ? -1 : 1, e = (h >>> 10) & 31, m = h & 1023;
  if (e === 0) return s * m * Math.pow(2, -24);
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * Math.pow(2, e - 15);
}
const q8 = (x: number) => Math.round(clamp(x, 0, 1) * 255);
function packNormal(n: V3) {
  const q = (x: number) => Math.round(clamp(x * 0.5 + 0.5, 0, 1) * 1023);
  return ((q(n[0]) << 20) | (q(n[1]) << 10) | q(n[2])) >>> 0;
}

/** the wind's say over the vertices laid next: the branch they're on (its pivot and phase) */
export interface Sway { pivot: V3; phase: number }
const ROOT: Sway = { pivot: [0, 0, 0], phase: 0 };

// ------------------------------------------------------------------ the mesh builder
export class FloraMesh {
  private P: number[] = [];   // x y z
  private N: number[] = [];   // nx ny nz
  private C: number[] = [];   // r g b ao (linear, 0..1)
  private A: number[] = [];   // part flex flutter rand
  private W: number[] = [];   // pivot xyz, phase
  private I: number[] = [];
  /** the branch the next vertices are on */
  sway: Sway = ROOT;
  /** set: what's laid is left out (a light level grown with the same random sequence as the full one) */
  skip = false;
  /** a hanging plant (bougainvillea): its height fraction measured down from its top, not up from its root */
  hangs = false;

  get vertexCount() { return this.P.length / 3; }
  get triangleCount() { return this.I.length / 3; }

  /** on a branch: following vertices swing about `pivot` with `phase`; fn's laid there, then back */
  on(pivot: V3, phase: number, fn: () => void) {
    const was = this.sway;
    this.sway = { pivot, phase };
    fn();
    this.sway = was;
  }

  vert(p: V3, n: V3, col: V3, ao: number, part: Part, flex: number, flutter: number, rand: number): number {
    if (this.skip) return 0;
    this.P.push(p[0], p[1], p[2]);
    const nn = norm(n);
    this.N.push(nn[0], nn[1], nn[2]);
    this.C.push(col[0], col[1], col[2], ao);
    this.A.push(part, flex, flutter, rand);
    const s = this.sway;
    this.W.push(s.pivot[0], s.pivot[1], s.pivot[2], s.phase);
    return this.P.length / 3 - 1;
  }
  tri(a: number, b: number, c: number) { if (!this.skip) this.I.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number) { this.tri(a, b, c); this.tri(a, c, d); }

  /** a strip along a path: each row a centre point, a half-width vector across, a normal, a colour, occlusion and the
   *  wind weights; the last row a point when its half-width is ~0 */
  strip(rows: { p: V3; across: V3; n: V3; col: V3; ao: number; flex: number; flutter: number }[], part: Part, rand: number) {
    const ids: [number, number][] = [];
    for (const r of rows) {
      if (len(r.across) < 1e-5) { const t = this.vert(r.p, r.n, r.col, r.ao, part, r.flex, r.flutter, rand); ids.push([t, t]); continue; }
      ids.push([this.vert(sub(r.p, r.across), r.n, r.col, r.ao, part, r.flex, r.flutter, rand), this.vert(add(r.p, r.across), r.n, r.col, r.ao, part, r.flex, r.flutter, rand)]);
    }
    for (let k = 0; k < ids.length - 1; k++) {
      const [a, b] = ids[k], [c, d] = ids[k + 1];
      if (c === d) this.tri(a, b, c);
      else if (a === b) this.tri(a, d, c);
      else this.quad(a, b, d, c);
    }
  }

  /** a blade or strap leaf: a tapering strip from `base` along `dir`, bending down under its own weight by `droop` as it
   *  goes (and curling sideways by `twist`), its face square to `side`; colour from c0 at the base to c1 at the tip.
   *  Returns the tip. */
  blade(base: V3, dir: V3, length: number, width: number, droop: number, segs: number, part: Part, c0: V3, c1: V3,
    o: { flex0?: number; flex1?: number; flutter?: number; ao0?: number; ao1?: number; rand?: number; side?: V3; taper?: number; twist?: number } = {}): V3 {
    let d = norm(dir);
    let side = o.side ? norm(o.side) : perp(d);
    const taper = o.taper ?? 1, f0 = o.flex0 ?? 0, f1 = o.flex1 ?? 1, ao0 = o.ao0 ?? 0.55, ao1 = o.ao1 ?? 1;
    let p = base;
    const rows: { p: V3; across: V3; n: V3; col: V3; ao: number; flex: number; flutter: number }[] = [];
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      // (a strap leaf's width swells from its base and narrows to the tip; a grass blade's only narrows)
      const w = width * (taper >= 1 ? (1 - t * 0.94) * Math.min(1, 0.55 + t * 3) : 1 - t * taper * 0.9);
      side = norm(sub(side, mul(d, dot(side, d))));
      const n = norm(cross(side, d));
      rows.push({ p, across: mul(side, (k === segs && taper >= 1) ? 0 : w / 2), n, col: lerp3(c0, c1, t), ao: lerp(ao0, ao1, t), flex: lerp(f0, f1, t * t), flutter: (o.flutter ?? 0.3) * t });
      if (k === segs) break;
      d = norm(add(d, [0, -droop * (0.4 + t) / segs, 0]));
      if (o.twist) side = rotateAround(side, d, o.twist / segs);
      p = add(p, mul(d, length / segs));
    }
    this.strip(rows, part, o.rand ?? 0.5);
    return p;
  }

  /** a leaf or a petal with an outline: from `base` along `dir`, its face toward `up`; `shape` gives the half-width
   *  along it (0..1 -> fraction of `width`), `cup` lifts its edges toward `up`, `curl` bends it back along its length
   *  (+: toward -up, the tip falling away), `fold` creases it along the midrib. LOD by `segs` (along) and the midrib
   *  (kept when segs > 1). */
  leaf(base: V3, dir: V3, up: V3, length: number, width: number, part: Part, col: (t: number, edge: number) => V3,
    o: { segs?: number; shape?: (t: number) => number; cup?: number; curl?: number; fold?: number; flex0?: number; flex1?: number; flutter?: number; ao0?: number; ao1?: number; rand?: number; bend?: V3 } = {}) {
    const segs = o.segs ?? 3;
    const shape = o.shape ?? ((t: number) => Math.sin(Math.PI * Math.pow(t, 0.75)));
    let d = norm(dir);
    let u = norm(sub(up, mul(d, dot(up, d))));
    const curl = o.curl ?? 0, cup = o.cup ?? 0, fold = o.fold ?? 0;
    const f0 = o.flex0 ?? 0.2, f1 = o.flex1 ?? 1, fl = o.flutter ?? 1, ao0 = o.ao0 ?? 0.7, ao1 = o.ao1 ?? 1;
    const rand = o.rand ?? 0.5;
    const mid = segs > 1;
    let p = base;
    const rows: number[][] = [];
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      const s = norm(cross(d, u));
      const hw = (width / 2) * shape(t);
      const ao = lerp(ao0, ao1, t), flex = lerp(f0, f1, t), flt = fl * t;
      const c = mul(u, hw * cup), fo = mul(u, hw * fold);
      // edges lifted (cupped) and the midrib creased; normals tilted out along the cup so it reads round
      const nl = norm(add(u, mul(s, cup * 0.6 + fold * 0.6))), nr = norm(add(u, mul(s, -(cup * 0.6 + fold * 0.6))));
      if (k === segs || hw < 1e-4) {
        const tip = this.vert(p, u, col(t, 0), ao, part, flex, flt, rand);
        rows.push(mid ? [tip, tip, tip] : [tip, tip]);
      } else if (mid) {
        rows.push([
          this.vert(add(add(p, mul(s, -hw)), add(c, fo)), nr, col(t, 1), ao, part, flex, flt, rand),
          this.vert(p, u, col(t, 0), ao, part, flex, flt, rand),
          this.vert(add(add(p, mul(s, hw)), add(c, fo)), nl, col(t, 1), ao, part, flex, flt, rand),
        ]);
      } else {
        rows.push([
          this.vert(add(add(p, mul(s, -hw)), c), u, col(t, 1), ao, part, flex, flt, rand),
          this.vert(add(add(p, mul(s, hw)), c), u, col(t, 1), ao, part, flex, flt, rand),
        ]);
      }
      if (k === segs) break;
      // the curl turns the direction about the leaf's own side axis (falling back from its face)
      const ax = norm(cross(d, u));
      const turn = (curl * (0.5 + t)) / segs;
      d = norm(rotateAround(d, ax, -turn));
      u = norm(rotateAround(u, ax, -turn));
      if (o.bend) { d = norm(add(d, mul(o.bend, 1 / segs))); u = norm(sub(u, mul(d, dot(u, d)))); }
      p = add(p, mul(d, length / segs));
    }
    for (let k = 0; k < rows.length - 1; k++) {
      const a = rows[k], b = rows[k + 1];
      if (mid) {
        if (b[0] === b[1]) { this.tri(a[0], a[1], b[1]); this.tri(a[1], a[2], b[1]); }
        else { this.quad(a[0], a[1], b[1], b[0]); this.quad(a[1], a[2], b[2], b[1]); }
      } else if (b[0] === b[1]) this.tri(a[0], a[1], b[0]);
      else this.quad(a[0], a[1], b[1], b[0]);
    }
  }

  /** a generalised cylinder along a path (radii per point), parallel-transported rings (no twist); colour and
   *  occlusion per point, the wind's flex per point; capped at the end if `cap` */
  tube(pts: V3[], radii: number[], sides: number, part: Part, col: (k: number) => V3, ao: (k: number) => number, flex: (k: number) => number, o: { cap?: boolean; rand?: number; flutter?: number } = {}) {
    const n = pts.length;
    if (n < 2) return;
    let ref = perp(norm(sub(pts[1], pts[0])));
    const rings: number[][] = [];
    for (let k = 0; k < n; k++) {
      const t = norm(k === 0 ? sub(pts[1], pts[0]) : k === n - 1 ? sub(pts[n - 1], pts[n - 2]) : sub(pts[k + 1], pts[k - 1]));
      ref = norm(sub(ref, mul(t, dot(ref, t))));
      const b = cross(t, ref);
      const ring: number[] = [];
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        const dir = add(mul(ref, Math.cos(a)), mul(b, Math.sin(a)));
        ring.push(this.vert(add(pts[k], mul(dir, radii[k])), dir, col(k), ao(k), part, flex(k), o.flutter ?? 0, o.rand ?? 0.5));
      }
      rings.push(ring);
    }
    for (let k = 0; k < n - 1; k++) for (let j = 0; j < sides; j++) {
      const j1 = (j + 1) % sides;
      this.quad(rings[k][j], rings[k][j1], rings[k + 1][j1], rings[k + 1][j]);
    }
    if (o.cap) {
      const t = norm(sub(pts[n - 1], pts[n - 2]));
      const c = this.vert(pts[n - 1], t, col(n - 1), ao(n - 1), part, flex(n - 1), o.flutter ?? 0, o.rand ?? 0.5);
      for (let j = 0; j < sides; j++) this.tri(rings[n - 1][j], rings[n - 1][(j + 1) % sides], c);
    }
  }

  /** a surface of revolution about the y axis through `c`: profile [radius, height] from the bottom up, colour per
   *  profile point; normals from the profile (a pot, an urn) */
  lathe(c: V3, prof: [number, number][], sides: number, part: Part, col: (k: number) => V3, ao: (k: number) => number, flex = 0) {
    const rows: number[][] = [];
    for (let k = 0; k < prof.length; k++) {
      const [r, h] = prof[k];
      const pk = prof[Math.max(0, k - 1)], nk = prof[Math.min(prof.length - 1, k + 1)];
      const dr = nk[0] - pk[0], dh = nk[1] - pk[1];
      const row: number[] = [];
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        row.push(this.vert([c[0] + ca * r, c[1] + h, c[2] + sa * r], [dh * ca, -dr, dh * sa], col(k), ao(k), part, flex, 0, 0.5));
      }
      rows.push(row);
    }
    for (let k = 0; k < rows.length - 1; k++) for (let j = 0; j < sides; j++) {
      const j1 = (j + 1) % sides;
      this.quad(rows[k][j], rows[k + 1][j], rows[k + 1][j1], rows[k][j1]);
    }
  }

  /** a disc facing `up` (a flower's heart, a pot's soil): centre colour out to the rim's */
  fan(c: V3, up: V3, r: number, part: Part, inner: V3, rim: V3, o: { n?: number; dome?: number; flex?: number; ao?: number; rand?: number } = {}) {
    const u = norm(up), a0 = perp(u), b0 = cross(u, a0);
    const n = o.n ?? 8;
    const centre = this.vert(add(c, mul(u, (o.dome ?? 0) * r)), u, inner, o.ao ?? 1, part, o.flex ?? 0.5, 0, o.rand ?? 0.5);
    const ring: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, dir = add(mul(a0, Math.cos(a)), mul(b0, Math.sin(a)));
      ring.push(this.vert(add(c, mul(dir, r)), norm(add(u, mul(dir, 0.5 * (o.dome ?? 0)))), rim, o.ao ?? 1, part, o.flex ?? 0.5, 0, o.rand ?? 0.5));
    }
    for (let k = 0; k < n; k++) this.tri(centre, ring[k], ring[(k + 1) % n]);
  }

  /** a lumpy ellipsoid round `c` (radii rx, ry, rz): the leafy mass of a shrub or a crown's light level. Its normals
   *  lean out and up as a mass of leaves' do; colour darkens and occlusion deepens toward its underside. `bottom`:
   *  flattened at that height (sitting on the ground). `lump`: how lumpy (0 smooth .. 0.3). */
  mass(c: V3, rx: number, ry: number, rz: number, part: Part, col: (n: V3, r: Rng) => V3, rand: Rng,
    o: { rings?: number; segs?: number; lump?: number; flex?: number; flutter?: number; ao?: [number, number]; bottom?: number; lean?: number; pinch?: number } = {}) {
    const rings = o.rings ?? 6, segs = o.segs ?? 8, lump = o.lump ?? 0.15;
    const [aoLo, aoHi] = o.ao ?? [0.45, 1];
    const lean = o.lean ?? 0.5;
    // the lumps: a few soft bumps over the surface, so the silhouette isn't a clean ellipse
    const bumps: { d: V3; k: number; w: number }[] = [];
    for (let b = 0; b < 7; b++) bumps.push({ d: norm([rand.range(-1, 1), rand.range(-0.5, 1), rand.range(-1, 1)]), k: rand.range(0.5, 1) * lump, w: rand.range(2.5, 5) });
    const surf = (n: V3): [V3, V3] => {
      let s = 1;
      for (const b of bumps) s += b.k * Math.max(0, Math.pow(Math.max(0, dot(n, b.d)), b.w) - 0.15);
      s *= 1 + rand.range(-lump, lump) * 0.35;
      // (a pinch toward the top: a flame, a cone)
      const pin = o.pinch ? 1 - o.pinch * Math.max(0, n[1]) : 1;
      let p: V3 = [c[0] + n[0] * rx * s * pin, c[1] + n[1] * ry * s, c[2] + n[2] * rz * s * pin];
      if (o.bottom !== undefined && p[1] < o.bottom) p = [p[0], o.bottom, p[2]];
      return [p, norm(add(n, [0, lean, 0]))];
    };
    const top = (() => { const [p, n] = surf([0, 1, 0]); return this.vert(p, n, col([0, 1, 0], rand), aoHi, part, o.flex ?? 0.3, o.flutter ?? 0.15, rand.next()); })();
    let prev = [top];
    for (let i = 1; i < rings; i++) {
      const t = (i / rings) * Math.PI, row: number[] = [];
      for (let k = 0; k < segs; k++) {
        const a = ((k + (i % 2) * 0.5) / segs) * Math.PI * 2;
        const n: V3 = [Math.cos(a) * Math.sin(t), Math.cos(t), Math.sin(a) * Math.sin(t)];
        const [p, nn] = surf(n);
        const h = 0.5 + 0.5 * Math.cos(t);
        row.push(this.vert(p, nn, col(n, rand), lerp(aoLo, aoHi, Math.pow(h, 0.7)), part, (o.flex ?? 0.3) * (0.5 + 0.5 * h), (o.flutter ?? 0.15) * h, rand.next()));
      }
      for (let k = 0; k < segs; k++) {
        const k1 = (k + 1) % segs;
        if (prev.length === 1) this.tri(prev[0], row[k1], row[k]);
        else this.quad(prev[k], prev[k1], row[k1], row[k]);
      }
      prev = row;
    }
    const [bp] = surf([0, -1, 0]);
    const bot = this.vert(bp, [0, -1, 0], mul(col([0, -1, 0], rand), 0.7), aoLo, part, (o.flex ?? 0.3) * 0.5, 0, rand.next());
    for (let k = 0; k < segs; k++) this.tri(prev[k], prev[(k + 1) % segs], bot);
  }

  /** a little closed ball (an octahedron, squashed by `squash` along y): berries, fruit, buds, florets */
  ball(c: V3, r: number, col: V3, part: Part, o: { flex?: number; flutter?: number; ao?: number; rand?: number; squash?: number } = {}) {
    const sq = o.squash ?? 1;
    const ax: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const id = ax.map((a) => this.vert(add(c, [a[0] * r, a[1] * r * sq, a[2] * r]), a, col, o.ao ?? 1, part, o.flex ?? 0.5, o.flutter ?? 0, o.rand ?? 0.5));
    const f = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
    for (const t of f) this.tri(id[t[0]], id[t[1]], id[t[2]]);
  }

  /** a flake: a small rounded quad (a petal seen from afar, a blossom, a bract, a leaf in a crown) at `c` facing `n`,
   *  `size` across; its shading normal bent toward `bent` (out of the crown) so a puff of them lights as a volume */
  flake(c: V3, n: V3, size: number, col: V3, part: Part, o: { bent?: V3; bend?: number; ao?: number; flex?: number; flutter?: number; rand?: number; spin?: number; long?: number } = {}) {
    const nn = norm(n);
    const a0 = rotateAround(perp(nn), nn, o.spin ?? 0), b0 = cross(nn, a0);
    const sh = o.bent ? norm(lerp3(nn, o.bent, o.bend ?? 0.7)) : nn;
    const h = size / 2, L = o.long ?? 1;
    const ao = o.ao ?? 1, flex = o.flex ?? 0.6, fl = o.flutter ?? 1, rand = o.rand ?? 0.5;
    // a squashed hexagon: reads round at a glance, 4 triangles
    const pts: V3[] = [
      add(c, mul(a0, h * L)), add(c, add(mul(a0, h * 0.5 * L), mul(b0, h * 0.85))), add(c, add(mul(a0, -h * 0.5 * L), mul(b0, h * 0.85))),
      add(c, mul(a0, -h * L)), add(c, add(mul(a0, -h * 0.5 * L), mul(b0, -h * 0.85))), add(c, add(mul(a0, h * 0.5 * L), mul(b0, -h * 0.85))),
    ];
    const ids = pts.map((p) => this.vert(p, sh, col, ao, part, flex, fl, rand));
    this.tri(ids[0], ids[1], ids[2]); this.tri(ids[0], ids[2], ids[3]); this.tri(ids[0], ids[3], ids[4]); this.tri(ids[0], ids[4], ids[5]);
  }

  /** the cheapest leaf: a diamond (two triangles) from `base` along `dir`, its face toward `up`, widest at `at` of its
   *  length; its tip raised toward `up` by `lift` (a little cupped, so it never reads as a flat card) */
  diamond(base: V3, dir: V3, up: V3, length: number, width: number, col: V3, part: Part, o: { at?: number; lift?: number; bent?: V3; bend?: number; ao?: number; flex?: number; flutter?: number; rand?: number; tipCol?: V3 } = {}) {
    const d = norm(dir), u0 = norm(sub(up, mul(d, dot(up, d)))), s = norm(cross(d, u0));
    const at = o.at ?? 0.4, lift = o.lift ?? 0.12;
    const sh = o.bent ? norm(lerp3(u0, o.bent, o.bend ?? 0.6)) : u0;
    const ao = o.ao ?? 1, flex = o.flex ?? 0.6, fl = o.flutter ?? 1, rand = o.rand ?? 0.5;
    const mid = add(base, mul(d, length * at));
    const a = this.vert(base, sh, col, ao * 0.9, part, flex * 0.9, fl * 0.3, rand);
    const l = this.vert(add(mid, mul(s, -width / 2)), sh, col, ao, part, flex, fl * 0.7, rand);
    const r = this.vert(add(mid, mul(s, width / 2)), sh, col, ao, part, flex, fl * 0.7, rand);
    const t = this.vert(add(add(base, mul(d, length)), mul(u0, length * lift)), sh, o.tipCol ?? col, ao, part, flex, fl, rand);
    this.tri(a, r, t); this.tri(a, t, l);
  }

  /** pack for the GPU. The height fraction is measured over the mesh's own height (up from the root, or down from the
   *  top for a hanging plant) */
  build(): FloraMeshData {
    const n = this.vertexCount;
    const mn: V3 = [Infinity, Infinity, Infinity], mx: V3 = [-Infinity, -Infinity, -Infinity];
    let radius = 0;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], this.P[i * 3 + k]); mx[k] = Math.max(mx[k], this.P[i * 3 + k]); }
      radius = Math.max(radius, Math.hypot(this.P[i * 3], this.P[i * 3 + 2]));
    }
    const height = this.hangs ? Math.max(1e-3, -mn[1]) : Math.max(1e-3, mx[1]);
    const data = new Uint32Array(n * FLORA_VERTEX_U32);
    const fv = new Float32Array(data.buffer);
    for (let i = 0; i < n; i++) {
      const o = i * FLORA_VERTEX_U32;
      fv[o] = this.P[i * 3]; fv[o + 1] = this.P[i * 3 + 1]; fv[o + 2] = this.P[i * 3 + 2];
      data[o + 3] = packNormal([this.N[i * 3], this.N[i * 3 + 1], this.N[i * 3 + 2]]);
      const c = i * 4;
      data[o + 4] = (q8(toSrgb(this.C[c])) | (q8(toSrgb(this.C[c + 1])) << 8) | (q8(toSrgb(this.C[c + 2])) << 16) | (q8(this.C[c + 3]) << 24)) >>> 0;
      const y = this.P[i * 3 + 1];
      const hf = this.hangs ? clamp(-y / height, 0, 1) : clamp(y / height, 0, 1);
      data[o + 5] = (this.A[c] | (q8(this.A[c + 1]) << 8) | (q8(hf) << 16) | (q8(this.A[c + 3]) << 24)) >>> 0;
      data[o + 6] = (toHalf(this.W[c]) | (toHalf(this.W[c + 1]) << 16)) >>> 0;
      data[o + 7] = (toHalf(this.W[c + 2]) | (q8(this.A[c + 2]) << 16) | (q8(this.W[c + 3] % 1) << 24)) >>> 0;
    }
    return { data, indices: new Uint32Array(this.I), vertices: n, triangles: this.I.length / 3, height, radius, bounds: [mn, mx] };
  }
}
/** a packed mesh back into plain arrays (for the previews and the tests) */
export function decode(m: FloraMeshData) {
  const n = m.vertices;
  const fv = new Float32Array(m.data.buffer, m.data.byteOffset, m.data.length);
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3), ao = new Float32Array(n);
  const part = new Uint8Array(n), flex = new Float32Array(n), hf = new Float32Array(n), flutter = new Float32Array(n), pivot = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const o = i * FLORA_VERTEX_U32;
    pos[i * 3] = fv[o]; pos[i * 3 + 1] = fv[o + 1]; pos[i * 3 + 2] = fv[o + 2];
    const nn = m.data[o + 3];
    nrm[i * 3] = ((nn >>> 20) & 1023) / 1023 * 2 - 1; nrm[i * 3 + 1] = ((nn >>> 10) & 1023) / 1023 * 2 - 1; nrm[i * 3 + 2] = (nn & 1023) / 1023 * 2 - 1;
    const c = m.data[o + 4];
    col[i * 3] = fromSrgb((c & 255) / 255); col[i * 3 + 1] = fromSrgb(((c >>> 8) & 255) / 255); col[i * 3 + 2] = fromSrgb(((c >>> 16) & 255) / 255);
    ao[i] = ((c >>> 24) & 255) / 255;
    const a = m.data[o + 5];
    part[i] = a & 255; flex[i] = ((a >>> 8) & 255) / 255; hf[i] = ((a >>> 16) & 255) / 255;
    const w6 = m.data[o + 6], w7 = m.data[o + 7];
    pivot[i * 3] = fromHalf(w6 & 0xffff); pivot[i * 3 + 1] = fromHalf(w6 >>> 16); pivot[i * 3 + 2] = fromHalf(w7 & 0xffff);
    flutter[i] = ((w7 >>> 16) & 255) / 255;
  }
  return { pos, nrm, col, ao, part, flex, hf, flutter, pivot, idx: m.indices };
}
