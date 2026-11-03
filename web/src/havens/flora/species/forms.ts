// The organs the species are assembled from: flower heads (a daisy's rays, a lily's trumpet, a tulip's goblet, a star,
// a spike's florets), pinnate fronds (palm, fern), leaf rosettes over a clipped surface, puffs of flakes (blossom, a
// crown's leaves), and the branching skeleton a small tree grows. Each lays into a FloraMesh at its level of detail.
import { FloraMesh, PART, add, clamp, cross, dot, lerp, lerp3, mul, norm, perp, rotateAround, sub, type Part, type Rng, type V3 } from '../mesh';
import { C } from '../palette';

export type Lod = 0 | 1 | 2;

/** a point on the unit sphere's upper part (cosine-weighted toward up by `tilt`, the most off vertical in radians) */
export function outward(r: Rng, tilt: number): V3 {
  const a = r.next() * Math.PI * 2, t = r.range(0, tilt);
  return [Math.cos(a) * Math.sin(t), Math.cos(t), Math.sin(a) * Math.sin(t)];
}

/** a path from `start` along `d0`, falling under `droop` and turning up toward its end by `upturn`, wandering a little */
export function bendPath(start: V3, d0: V3, length: number, segs: number, droop: number, upturn: number, wander: number, r: Rng): V3[] {
  const pts: V3[] = [start];
  let d = norm(d0), p = start;
  const step = length / segs;
  const kink: V3 = [r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)];
  for (let k = 1; k <= segs; k++) {
    const t = k / segs;
    const bend: V3 = [kink[0] * wander, -droop * (1 - t) + upturn * t * t, kink[2] * wander];
    d = norm(add(d, mul(bend, (step / Math.max(length, 0.1)) * 2.2)));
    p = add(p, mul(d, step));
    pts.push(p);
  }
  return pts;
}

/** the point and direction at fraction f along a polyline */
export function along(pts: V3[], f: number): [V3, V3] {
  const fi = clamp(f, 0, 1) * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(fi)), t = fi - i;
  return [lerp3(pts[i], pts[i + 1], t), norm(sub(pts[i + 1], pts[i]))];
}

// ------------------------------------------------------------------ flower heads
/** the shading of a petal from its base (t 0) to its tip, near white (the bloom colour multiplies it) */
export const petalShade = (warm = false) => (t: number, edge: number): V3 => lerp3(warm ? C.petalBaseWarm : C.petalBase, C.petalTip, Math.min(1, t * 1.6 + edge * 0.15));

/** a daisy: ray petals round a domed disc, facing `up` */
export function daisyHead(m: FloraMesh, c: V3, up: V3, o: { rays: number; petalLen: number; petalW: number; discR: number; disc: V3; droop: number; lod: Lod; rand: number; flex: number }) {
  const u = norm(up), a0 = perp(u), b0 = cross(u, a0);
  m.fan(c, u, o.discR, PART.disc, mul(o.disc, 1.15), mul(o.disc, 0.75), { n: o.lod === 0 ? 8 : 5, dome: 0.6, flex: o.flex, ao: 1, rand: o.rand });
  for (let k = 0; k < o.rays; k++) {
    const a = (k / o.rays) * Math.PI * 2 + o.rand * 3;
    const rd: V3 = add(mul(a0, Math.cos(a)), mul(b0, Math.sin(a)));
    const dir = norm(add(rd, mul(u, -o.droop + 0.15 * Math.sin(k * 2.7))));
    const base = add(c, mul(rd, o.discR * 0.75));
    if (o.lod === 0) m.leaf(base, dir, u, o.petalLen, o.petalW, PART.petal, petalShade(), { segs: 2, shape: (t) => Math.sin(Math.PI * (0.25 + 0.75 * t) * 0.92) * (t < 0.95 ? 1 : 0.6), cup: 0.15, curl: o.droop * 0.6, flex0: o.flex, flex1: o.flex, flutter: 0.5, ao0: 0.9, rand: o.rand });
    else m.diamond(base, dir, u, o.petalLen, o.petalW * 1.15, C.petalTip, PART.petal, { at: 0.55, lift: 0.05, flex: o.flex, flutter: 0.4, rand: o.rand });
  }
}

/** a lily: six pointed petals flaring from a trumpet and curling back at their tips, a throat of `throat`, stamens */
export function lilyHead(m: FloraMesh, c: V3, dir: V3, o: { petalLen: number; petalW: number; flare: number; lod: Lod; rand: number; flex: number }) {
  const d = norm(dir), a0 = perp(d), b0 = cross(d, a0);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + (k % 2) * 0.12;
    const rd: V3 = add(mul(a0, Math.cos(a)), mul(b0, Math.sin(a)));
    const pd = norm(add(d, mul(rd, o.flare)));
    const L = o.petalLen * (k % 2 ? 0.94 : 1), W = o.petalW * (k % 2 ? 1.1 : 0.9);
    // (the petal's face toward the trumpet's axis: its inside seen looking in)
    const face = norm(sub(d, mul(rd, 0.8)));
    if (o.lod === 2) { m.diamond(c, pd, face, L, W, C.petalTip, PART.petal, { at: 0.45, lift: -0.15, flex: o.flex, rand: o.rand }); continue; }
    m.leaf(c, pd, face, L, W, PART.petal, petalShade(true), { segs: o.lod === 0 ? 4 : 2, shape: (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.8), cup: 0.25, curl: o.lod === 0 ? 1.6 : 1.1, flex0: o.flex, flex1: o.flex, flutter: 0.4, ao0: 0.75, rand: o.rand });
  }
  if (o.lod === 0) {
    // stamens: thin filaments with gold anthers
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.5;
      const sd = norm(add(d, mul(add(mul(a0, Math.cos(a)), mul(b0, Math.sin(a))), 0.35)));
      const tip = m.blade(c, sd, o.petalLen * 0.75, 0.003, 0.4, 1, PART.disc, C.leafLight, C.stamen, { flex0: o.flex, flex1: o.flex, flutter: 0.3, taper: 0.2, rand: o.rand });
      m.ball(tip, 0.0042, C.anther, PART.disc, { flex: o.flex, rand: o.rand, squash: 1.8 });
    }
  }
}

/** a tulip: a goblet of six overlapping cupped petals (three outer, three inner) facing `up`, egg-shaped, opening a
 *  little at the lip by `open` */
export function tulipHead(m: FloraMesh, c: V3, up: V3, o: { size: number; open: number; lod: Lod; rand: number; flex: number }) {
  const u = norm(up);
  const H = o.size * 1.3;
  // the goblet's profile: narrow at its foot, widest a third up, drawing in toward the top and flaring as it opens
  const rad = (t: number) => o.size * (0.16 + 0.5 * Math.sin(Math.PI * Math.min(1, 0.1 + t * 0.85)) * (1 - 0.3 * t) + o.open * 0.5 * t * t);
  for (let k = 0; k < 6; k++) {
    const inner = k % 2 === 1;
    const phi = (k / 6) * Math.PI * 2 + o.rand * 2;
    if (o.lod === 2) {
      const a0 = perp(u), b0 = cross(u, a0);
      const rd: V3 = add(mul(a0, Math.cos(phi)), mul(b0, Math.sin(phi)));
      if (!inner) m.diamond(add(c, mul(rd, o.size * 0.15)), norm(add(u, mul(rd, 0.35))), rd, H, o.size * 0.95, C.petalTip, PART.petal, { at: 0.55, lift: -0.2, flex: o.flex, rand: o.rand });
      continue;
    }
    cupPetal(m, c, u, phi, inner ? 1.3 : 1.4, H * (inner ? 0.96 : 1), (t) => rad(t) * (inner ? 0.92 : 1), {
      rows: o.lod === 0 ? 4 : 2, cols: o.lod === 0 ? 3 : 1, col: (t, e) => lerp3(C.petalBase, C.petalTip, Math.min(1, t * 1.4 + e * 0.1)), flex: o.flex, ao0: inner ? 0.6 : 0.8, rand: o.rand, tipWidth: 0.15,
    });
  }
}

/** one petal of a cup (a tulip's goblet, a lotus's bowl): a patch of the cup's surface of revolution about `axis` from
 *  `c`, centred on azimuth `phi` and `span` radians wide at its widest, `height` tall; the cup's radius at each height
 *  fraction from `radius(t)`, the petal's width narrowing to its tip; `out` the cup's outside (normals face it) */
export function cupPetal(m: FloraMesh, c: V3, axis: V3, phi: number, span: number, height: number, radius: (t: number) => number,
  o: { rows: number; cols: number; col: (t: number, e: number) => V3; flex: number; ao0?: number; rand: number; tipWidth?: number; part?: Part }) {
  const u = norm(axis), a0 = perp(u), b0 = cross(u, a0);
  const grid: number[][] = [];
  for (let i = 0; i <= o.rows; i++) {
    const t = i / o.rows;
    // the petal's angular width: full through its middle, narrowing to a rounded point
    const w = span * Math.pow(Math.sin(Math.PI * (0.22 + 0.78 * Math.min(t, 0.999))), 0.55) * (i === o.rows ? (o.tipWidth ?? 0) : 1);
    const R = radius(t);
    const row: number[] = [];
    for (let j = 0; j <= o.cols; j++) {
      const e = j / o.cols - 0.5;
      const a = phi + e * w;
      const rd: V3 = add(mul(a0, Math.cos(a)), mul(b0, Math.sin(a)));
      // (the edges curl a touch outward, the way a petal's do)
      const p = add(add(c, mul(u, height * t)), mul(rd, R * (1 + 0.06 * Math.abs(e) * 2 * t)));
      const dR = (radius(Math.min(1, t + 0.05)) - radius(Math.max(0, t - 0.05))) / 0.1;
      const n = norm(sub(rd, mul(u, dR / Math.max(height, 1e-3))));
      row.push(m.vert(p, n, o.col(t, Math.abs(e) * 2), lerp(o.ao0 ?? 0.75, 1, t), o.part ?? PART.petal, o.flex, 0.25 * t, o.rand));
    }
    grid.push(row);
  }
  for (let i = 0; i < o.rows; i++) for (let j = 0; j < o.cols; j++) m.quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);
}

/** a bell (a foxglove's, a campanula's): an open tube flaring to its mouth, from `c` along `dir`, its lip lobed */
export function bell(m: FloraMesh, c: V3, dir: V3, length: number, mouth: number, o: { sides: number; col: (t: number) => V3; flex: number; rand: number }) {
  const d = norm(dir), a0 = perp(d), b0 = cross(d, a0);
  const prof: [number, number][] = [[0.2, 0], [0.55, 0.45], [0.8, 0.8], [1.15, 1]];
  const rows: number[][] = [];
  for (const [rf, tf] of prof) {
    const row: number[] = [];
    for (let j = 0; j < o.sides; j++) {
      const a = (j / o.sides) * Math.PI * 2;
      const rd: V3 = add(mul(a0, Math.cos(a)), mul(b0, Math.sin(a)));
      // (the lip lobed: every other point of the mouth pulled back a little)
      const lobe = tf === 1 && j % 2 === 1 ? 0.88 : 1;
      row.push(m.vert(add(add(c, mul(d, length * tf * lobe)), mul(rd, mouth * rf)), norm(add(rd, mul(d, -0.3))), o.col(tf), lerp(0.6, 1, tf), PART.petal, o.flex, 0.2, o.rand));
    }
    rows.push(row);
  }
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < o.sides; j++) {
    const j1 = (j + 1) % o.sides;
    m.quad(rows[i][j], rows[i][j1], rows[i + 1][j1], rows[i + 1][j]);
  }
}

/** a little star of `n` petals (phlox, alyssum, verbena: a cushion's many heads) facing `up` */
export function starHead(m: FloraMesh, c: V3, up: V3, r: number, n: number, eye: V3 | null, o: { rand: number; flex: number; lod: Lod }) {
  const u = norm(up), a0 = perp(u), b0 = cross(u, a0);
  if (o.lod === 2) { m.flake(c, u, r * 2, C.petalTip, PART.petal, { flex: o.flex, flutter: 0.3, rand: o.rand }); return; }
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + o.rand * 6;
    const rd: V3 = add(mul(a0, Math.cos(a)), mul(b0, Math.sin(a)));
    m.diamond(c, norm(add(rd, mul(u, 0.12))), u, r, r * 0.75, C.petalTip, PART.petal, { at: 0.6, lift: 0.08, flex: o.flex, flutter: 0.3, rand: o.rand, tipCol: C.petalTip });
  }
  if (eye && o.lod === 0) m.ball(add(c, mul(u, r * 0.08)), r * 0.16, eye, PART.disc, { flex: o.flex, rand: o.rand, squash: 0.5 });
}

/** a floret on a spike: a small bell (three petals cupped round `dir`) */
export function floret(m: FloraMesh, c: V3, dir: V3, size: number, o: { rand: number; flex: number; lod: Lod }) {
  const d = norm(dir), a0 = perp(d), b0 = cross(d, a0);
  const n = o.lod === 0 ? 3 : 2;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + o.rand * 5;
    const rd: V3 = add(mul(a0, Math.cos(a)), mul(b0, Math.sin(a)));
    m.diamond(c, norm(add(d, mul(rd, 0.7))), norm(add(rd, mul(d, -0.3))), size, size * 0.85, C.petalTip, PART.petal, { at: 0.5, lift: -0.25, flex: o.flex, flutter: 0.3, rand: o.rand, tipCol: C.petalTip });
  }
}

// ------------------------------------------------------------------ fronds
/** a pinnate frond (a palm's, a fern's): a rachis from `base` along `dir` arching down by `arch`, leaflets in pairs
 *  along its outer part angled forward and lifted in a V, longest at its middle. The wind: it swings about its base
 *  (`pivot`), more toward its tip; the leaflets flutter. */
export function frond(m: FloraMesh, base: V3, dir: V3, length: number, o: {
  pairs: number; leafLen: number; leafW: number; v: number; arch: number; spread: number; part: Part; col0: V3; col1: V3; rachis: V3; rachisW: number;
  lod: Lod; r: Rng; flex0?: number; flex1?: number; start?: number; droopLeaf?: number; ragged?: number;
}) {
  const r = o.r;
  const segs = o.lod === 0 ? 8 : o.lod === 1 ? 5 : 3;
  const pts = bendPath(base, dir, length, segs, o.arch, 0, 0.05, r);
  const f0 = o.flex0 ?? 0.1, f1 = o.flex1 ?? 1;
  // the rachis: a thin strip seen edge-on as a line, its face up
  const up0 = norm(sub([0, 1, 0], mul(norm(dir), dot([0, 1, 0], norm(dir)))));
  m.strip(pts.map((p, k) => {
    const [, t] = along(pts, k / segs);
    const side = norm(cross(t, up0));
    return { p, across: mul(side, o.rachisW * (1 - 0.8 * k / segs) * 0.5), n: norm(cross(side, t)), col: lerp3(o.rachis, o.col1, k / segs * 0.5), ao: lerp(0.6, 1, k / segs), flex: lerp(f0, f1, Math.pow(k / segs, 1.5)), flutter: 0.1 };
  }), o.part, r.next());
  if (o.lod === 2) {
    // the light level: the frond's two sides as one tapering V of strips
    for (const sgn of [-1, 1]) {
      m.strip(pts.map((p, k) => {
        const t = k / segs;
        const [, tan] = along(pts, t);
        const side = norm(cross(tan, up0));
        const w = o.leafLen * Math.pow(Math.sin(Math.PI * clamp((t - (o.start ?? 0.1)) / (1 - (o.start ?? 0.1)), 0, 1)), 0.6);
        const lat = add(mul(side, sgn * w * 0.5), mul(up0, w * o.v * 0.5));
        return { p: add(p, lat), across: lat, n: norm(add(up0, mul(side, -sgn * o.v))), col: lerp3(o.col0, o.col1, t), ao: lerp(0.7, 1, t), flex: lerp(f0, f1, Math.pow(t, 1.5)), flutter: 0.5 * t };
      }), o.part, r.next());
    }
    return pts;
  }
  const start = o.start ?? 0.1;
  for (let k = 0; k < o.pairs; k++) {
    const t = start + (1 - start) * (k + 0.5) / o.pairs;
    const [p, tan] = along(pts, t);
    const side = norm(cross(tan, up0));
    const up = norm(cross(side, tan));
    const L = o.leafLen * Math.pow(Math.sin(Math.PI * clamp((t - start * 0.5) / (1 - start * 0.5), 0.05, 1)), 0.55) * (1 - (o.ragged ?? 0) * r.next());
    const flex = lerp(f0, f1, Math.pow(t, 1.5));
    for (const sgn of [-1, 1]) {
      const ld = norm(add(add(mul(tan, o.spread), mul(side, sgn)), mul(up, o.v)));
      const lu = norm(add(up, mul(side, -sgn * 0.4)));
      if (o.lod === 0) m.blade(p, ld, L, o.leafW, o.droopLeaf ?? 0.5, 2, o.part, lerp3(o.col0, o.col1, t * 0.6), o.col1, { flex0: flex, flex1: flex, flutter: 0.9, ao0: lerp(0.65, 0.95, t), ao1: 1, rand: r.next(), side: cross(ld, lu), taper: 0.85 });
      else m.diamond(p, ld, lu, L, o.leafW * 1.6, lerp3(o.col0, o.col1, t * 0.6), o.part, { at: 0.3, lift: 0.04, flex, flutter: 0.8, ao: lerp(0.7, 1, t), rand: r.next(), tipCol: o.col1 });
    }
  }
  return pts;
}

// ------------------------------------------------------------------ clipped surfaces and puffs
/** leaf rosettes over a surface: at each point a few tiny leaves fanning out from the surface's normal (a clipped box
 *  ball's or hedge's fine texture) */
export function rosettes(m: FloraMesh, points: { p: V3; n: V3; ao: number }[], o: { leaves: number; size: number; col: (r: Rng, n: V3) => V3; r: Rng; flex: number; part?: Part }) {
  const r = o.r;
  for (const q of points) {
    const a0 = perp(q.n), b0 = cross(q.n, a0);
    const spin = r.next() * Math.PI * 2;
    const col = o.col(r, q.n);
    for (let k = 0; k < o.leaves; k++) {
      const a = spin + (k / o.leaves) * Math.PI * 2;
      const rd: V3 = add(mul(a0, Math.cos(a)), mul(b0, Math.sin(a)));
      const d = norm(add(rd, mul(q.n, r.range(0.6, 1.2))));
      const sz = o.size * r.range(0.8, 1.2);
      m.diamond(sub(q.p, mul(q.n, sz * 0.15)), d, norm(add(q.n, mul(rd, -0.6))), sz, sz * 0.62, col, o.part ?? PART.leaf, { at: 0.45, lift: 0.1, bent: q.n, bend: 0.55, ao: q.ao, flex: o.flex, flutter: 0.35, rand: r.next() });
    }
  }
}

/** points over an ellipsoid's surface (roughly even: a golden spiral), with their normals; `keep` filters them */
export function shellPoints(c: V3, rx: number, ry: number, rz: number, count: number, r: Rng, keep: (n: V3) => boolean = () => true, jitter = 0.08) {
  const out: { p: V3; n: V3; ao: number }[] = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * 2.39996323 + r.range(-0.3, 0.3);
    const n = norm([Math.cos(a) * rr + r.range(-jitter, jitter), y + r.range(-jitter, jitter), Math.sin(a) * rr + r.range(-jitter, jitter)]);
    if (!keep(n)) continue;
    const s = 1 + r.range(-0.04, 0.04);
    out.push({ p: [c[0] + n[0] * rx * s, c[1] + n[1] * ry * s, c[2] + n[2] * rz * s], n: norm([n[0] / rx, n[1] / ry, n[2] / rz]), ao: lerp(0.5, 1, Math.pow(0.5 + 0.5 * n[1], 0.8)) });
  }
  return out;
}

/** a puff: a cloud of flakes round `c` (radii rx, ry), denser toward its surface, each facing roughly out of it and
 *  its shading normal bent out of the whole crown (`crown`): blossom, a crown's leaf clusters. With a `core`, a soft
 *  lumpy mass fills its heart, so a few flakes over it read as a full cluster */
export function puff(m: FloraMesh, c: V3, rx: number, ry: number, count: number, size: number, part: Part, col: (r: Rng, n: V3, depth: number) => V3, r: Rng,
  o: { crown: V3; flex: number; long?: number; diamond?: boolean; aoIn?: number; up?: number; core?: { part: Part; segs: number }; shell?: [number, number] }) {
  if (o.core) m.mass(c, rx * 0.78, ry * 0.78, rx * 0.78, o.core.part, (n) => col(r, n, 0.45 + 0.35 * (0.5 + 0.5 * n[1])), r, { rings: Math.max(3, o.core.segs - 3), segs: o.core.segs, lump: 0.32, flex: o.flex, flutter: 0.2, ao: [o.aoIn ?? 0.45, 0.95], lean: 0.45 });
  for (let k = 0; k < count; k++) {
    const n = norm([r.range(-1, 1), r.range(-0.6, 1) + (o.up ?? 0.2), r.range(-1, 1)]);
    // (round a core, the flakes sit in a shell over its surface, breaking its outline; alone, all through the puff)
    const depth = o.shell ? r.range(o.shell[0], o.shell[1]) : o.core ? r.range(0.78, 1.12) : Math.pow(r.next(), 0.35);
    const p: V3 = [c[0] + n[0] * rx * depth, c[1] + n[1] * ry * depth, c[2] + n[2] * rx * depth];
    const bent = norm(add(norm(sub(p, o.crown)), [0, 0.35, 0]));
    const face = norm(add(n, [r.range(-0.6, 0.6), r.range(-0.3, 0.6), r.range(-0.6, 0.6)]));
    const ao = lerp(o.aoIn ?? 0.5, 1, depth) * lerp(0.75, 1, 0.5 + 0.5 * n[1]);
    const cc = col(r, n, depth);
    if (o.diamond) m.diamond(p, perp(face), face, size * r.range(0.8, 1.25), size * 0.7 * r.range(0.8, 1.2), cc, part, { at: 0.5, lift: 0.15, bent, bend: 0.75, ao, flex: o.flex, flutter: 1, rand: r.next() });
    else m.flake(p, face, size * r.range(0.75, 1.25), cc, part, { bent, bend: 0.75, ao, flex: o.flex, flutter: 1, rand: r.next(), spin: r.next() * 3, long: o.long });
  }
}

// ------------------------------------------------------------------ small trees
export interface Limb { pts: V3[]; radii: number[]; depth: number; pivot: V3; phase: number; flex: number[]; /** the main limb (off the trunk) it grows from: its index in the skeleton */ root: number }
export interface TreeShape {
  height: number; trunkH: number; trunkR: number; limbs: [number, number]; spread: number; limbLen: number;
  /** how many times limbs fork, and how much each fork shortens */
  forks: number; shorten: number; droop: number; upturn: number; wander: number;
  /** several stems from the ground (an olive's, a pomegranate's) instead of one trunk */
  stems?: number; lean?: number; twist?: number;
}

/** a small tree's skeleton: a trunk (or stems) that splits into limbs, each forking `forks` times; the ends are where
 *  its puffs grow. Each limb (and its forks) swings about the limb's base. */
export function growTree(S: TreeShape, r: Rng): { limbs: Limb[]; tips: { p: V3; d: V3; limb: Limb }[] } {
  const limbs: Limb[] = [];
  const tips: { p: V3; d: V3; limb: Limb }[] = [];
  const stems = S.stems ?? 1;
  for (let s = 0; s < stems; s++) {
    const a = r.next() * Math.PI * 2, tilt = stems > 1 ? r.range(0.15, 0.35) : (S.lean ?? 0.05);
    const d0: V3 = norm([Math.cos(a) * tilt, 1, Math.sin(a) * tilt]);
    const base: V3 = stems > 1 ? [Math.cos(a) * 0.08, -0.05, Math.sin(a) * 0.08] : [0, -0.05, 0];
    const trunk = bendPath(base, d0, S.trunkH * r.range(0.85, 1.1), 6, 0, 0, (S.twist ?? 0.3), r);
    const trunkR = S.trunkR / Math.sqrt(stems);
    const tl: Limb = { pts: trunk, radii: trunk.map((_, k) => trunkR * (1 + 0.45 * Math.exp(-k * 1.6)) * (1 - 0.25 * k / 6)), depth: 0, pivot: [0, 0, 0], phase: r.next(), flex: trunk.map(() => 0), root: limbs.length };
    limbs.push(tl);
    const top = trunk[trunk.length - 1];
    const n = r.int(S.limbs[0], S.limbs[1]);
    const a0 = r.next() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const az = a0 + (i / n) * Math.PI * 2 + r.range(-0.4, 0.4);
      const el = Math.PI / 2 - S.spread * r.range(0.75, 1.15);
      const d: V3 = norm([Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)]);
      fork(top, d, S.limbLen * r.range(0.8, 1.15), trunkR * 0.62, 1, top, r.next(), 0, limbs.length);
    }
  }
  function fork(start: V3, d: V3, L: number, rad: number, depth: number, pivot: V3, phase: number, flex0: number, root: number) {
    const segs = Math.max(3, Math.round(L / 0.35));
    const pts = bendPath(start, d, L, segs, S.droop, S.upturn, S.wander, r);
    const flex = pts.map((_, k) => clamp(flex0 + (k / segs) * (0.35 + 0.25 * depth), 0, 1));
    const limb: Limb = { pts, radii: pts.map((_, k) => rad * (1 - 0.55 * k / segs)), depth, pivot, phase, flex, root };
    limbs.push(limb);
    const end = pts[pts.length - 1], dEnd = norm(sub(pts[pts.length - 1], pts[pts.length - 2]));
    if (depth <= S.forks) {
      const kids = depth === S.forks ? 2 : r.int(2, 3);
      for (let j = 0; j < kids; j++) {
        // forks leave from the outer part of the limb, turned about it and spreading out
        const f = j === 0 ? 1 : r.range(0.55, 0.85);
        const [p, t] = along(pts, f);
        const turn = rotateAround(perp(t), t, r.next() * Math.PI * 2);
        const nd = norm(add(t, mul(turn, r.range(0.45, 0.9))));
        fork(p, norm(add(nd, [0, 0.15, 0])), L * S.shorten * r.range(0.8, 1.1), rad * 0.6, depth + 1, pivot, phase, flex[Math.round(f * segs)], root);
      }
    } else tips.push({ p: end, d: dEnd, limb });
  }
  return { limbs, tips };
}

/** the skeleton as bark tubes (sides by depth and level of detail; twigs below `minR` left to the light levels' puffs) */
export function barkTubes(m: FloraMesh, limbs: Limb[], height: number, lod: Lod, col: V3, light: V3, minR = 0.012) {
  for (const L of limbs) {
    if (lod === 2 && L.depth > 1) continue;
    if (lod === 1 && L.depth > 2) continue;
    if (L.radii[0] < minR) continue;
    const sides = lod === 0 ? (L.depth === 0 ? 9 : L.depth === 1 ? 7 : 5) : lod === 1 ? (L.depth === 0 ? 6 : 4) : 4;
    const step = lod === 0 ? 1 : 2;
    const idx = L.pts.map((_, k) => k).filter((k) => k % step === 0 || k === L.pts.length - 1);
    const pts = idx.map((k) => L.pts[k]), radii = idx.map((k) => L.radii[k]), fl = idx.map((k) => L.flex[k]);
    m.on(L.pivot, L.phase, () => m.tube(pts, radii, sides, PART.bark, (k) => lerp3(col, light, clamp(pts[k][1] / height, 0, 1) * 0.5), (k) => lerp(0.45, 0.85, clamp(pts[k][1] / height, 0, 1)), (k) => fl[k], { cap: L.depth > 0 }));
  }
}
