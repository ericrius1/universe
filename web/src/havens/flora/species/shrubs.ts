// The gardens' clipped and loose shrubs: box balls, cones and loose leafy mounds, and the box hedge planted in segments
// along a bed's edge. Each is a dark leafy mass (its shaded inside) with tiny leaves in rosettes over its surface, so a
// clipped ball keeps a crisp round silhouette and still reads as leaves up close; the light levels keep the mass and
// fewer, bigger rosettes, then the mass alone.
import { FloraMesh, PART, add, clamp, lerp, lerp3, mul, norm, rng, vary, type Rng, type V3 } from '../mesh';
import { C } from '../palette';
import { rosettes, shellPoints, type Lod } from './forms';
import type { SpeciesDef } from './def';

const boxCol = (r: Rng, n: V3) => vary(lerp3(C.box, C.boxLight, clamp(0.25 + 0.55 * n[1] + 0.25 * r.next(), 0, 1)), r, 0.08, 0.015);
const massCol = (n: V3, r: Rng) => vary(lerp3(C.boxDeep, C.box, 0.45 + 0.45 * n[1]), r, 0.05, 0.01);

/** a clipped or loose shrub over an ellipsoid: `lump` 0 clipped smooth .. 0.3 loose; `pinch` draws it to a cone */
function shrub(r: Rng, lod: Lod, rx: number, ry: number, o: { lump: number; pinch?: number; leaf: number; points: number; loose?: boolean }): FloraMesh {
  const m = new FloraMesh();
  const c: V3 = [0, ry * 0.95, 0];
  m.mass(c, rx * 0.93, ry * 0.93, rx * 0.93, PART.mass, massCol, r, { rings: lod === 0 ? 8 : lod === 1 ? 6 : 4, segs: lod === 0 ? 12 : lod === 1 ? 9 : 7, lump: o.lump, pinch: o.pinch, bottom: 0.02, flex: 0.2, flutter: 0.05, ao: [0.3, 0.9] });
  if (lod === 2) return m;
  // the rosettes over its surface (a loose shrub's leaves bigger, held further out)
  const pin = o.pinch ?? 0;
  const pts = shellPoints(c, rx, ry, rx, lod === 0 ? o.points : Math.round(o.points * 0.25), r, (n) => c[1] + n[1] * ry > 0.06, 0.06)
    .map((q) => {
      const k = 1 - pin * Math.max(0, q.n[1]);
      const out = o.loose ? 1 + r.range(-0.05, 0.12) : 1;
      return { p: [q.p[0] * k * out, q.p[1], q.p[2] * k * out] as V3, n: q.n, ao: q.ao };
    });
  rosettes(m, pts, { leaves: lod === 0 ? 3 : 2, size: o.leaf * (lod === 0 ? 1 : 1.7), col: boxCol, r, flex: 0.3 });
  return m;
}

function boxball(seed: number, lod: Lod, v: number): FloraMesh {
  const r = rng(seed);
  // v0 a ball, v1 a cone, v2 a loose leafy mound
  if (v % 3 === 1) return shrub(r, lod, 0.42, 0.78, { lump: 0.04, pinch: 0.85, leaf: 0.068, points: 300 });
  if (v % 3 === 2) return shrub(r, lod, 0.62, 0.42, { lump: 0.26, leaf: 0.1, points: 260, loose: true });
  return shrub(r, lod, 0.5, 0.47, { lump: 0.05, leaf: 0.068, points: 300 });
}

// ------------------------------------------------------------------ hedges
/** a rounded box of leaf (a superellipsoid: `p` 2 round .. 6 nearly square) about `c` with half sizes `h`: a cube's six
 *  faces subdivided and pushed onto it. Returns the surface points for the rosettes */
function roundedBox(m: FloraMesh, r: Rng, c: V3, h: V3, p: number, segs: number, keepBottom: boolean) {
  const pts: { p: V3; n: V3; ao: number }[] = [];
  const faces: [V3, V3, V3][] = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
  const e = 2 / p;
  const sp = (x: number) => Math.sign(x) * Math.pow(Math.abs(x), e);
  for (const [n0, u, v] of faces) {
    if (!keepBottom && n0[1] < 0) continue;
    const grid: number[][] = [];
    for (let i = 0; i <= segs; i++) {
      const row: number[] = [];
      for (let j = 0; j <= segs; j++) {
        const a = (i / segs) * 2 - 1, b = (j / segs) * 2 - 1;
        const q = norm(add(n0, add(mul(u, a), mul(v, b))));
        const s: V3 = [sp(q[0]), sp(q[1]), sp(q[2])];
        const lump = 1 + r.range(-0.025, 0.025);
        const pos: V3 = [c[0] + s[0] * h[0] * lump, Math.max(0.02, c[1] + s[1] * h[1] * lump), c[2] + s[2] * h[2] * lump];
        // the superellipsoid's normal: its gradient
        const gn = norm([Math.sign(s[0]) * Math.pow(Math.abs(s[0]) + 1e-6, p - 1) / h[0], Math.sign(s[1]) * Math.pow(Math.abs(s[1]) + 1e-6, p - 1) / h[1], Math.sign(s[2]) * Math.pow(Math.abs(s[2]) + 1e-6, p - 1) / h[2]]);
        const up = 0.5 + 0.5 * gn[1];
        row.push(m.vert(pos, norm(add(gn, [0, 0.3, 0])), massCol(gn, r), lerp(0.3, 0.9, up), PART.mass, 0.15 * up, 0.05, r.next()));
        if (i > 0 && j > 0 && i < segs && j < segs) pts.push({ p: pos, n: gn, ao: lerp(0.5, 1, up) });
      }
      grid.push(row);
    }
    for (let i = 0; i < segs; i++) for (let j = 0; j < segs; j++) m.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
  }
  return pts;
}

/** a hedge segment: 1.2 m of clipped box along x, its ends rounded so segments planted a metre apart run on unbroken */
function hedge(seed: number, lod: Lod, v: number): FloraMesh {
  const r = rng(seed);
  const m = new FloraMesh();
  const H = v % 2 === 1 ? 0.95 : 0.65, Wd = v % 2 === 1 ? 0.6 : 0.5;
  const half: V3 = [0.62, H / 2, Wd / 2];
  const pts = roundedBox(m, r, [0, H / 2, 0], half, lod === 2 ? 4 : 5, lod === 0 ? 5 : lod === 1 ? 3 : 2, false);
  if (lod === 2) return m;
  // rosettes over its sides and top (more of them than the grid's points: scattered over each face)
  const extra: { p: V3; n: V3; ao: number }[] = [];
  const count = lod === 0 ? 330 : 70;
  for (let k = 0; k < count; k++) {
    const face = r.next();
    let n: V3, p: V3;
    if (face < 0.4) { n = [0, 1, 0]; p = [r.range(-0.58, 0.58), H, r.range(-Wd / 2 + 0.03, Wd / 2 - 0.03)]; }
    else { const s = face < 0.7 ? 1 : -1; n = [0, 0, s]; p = [r.range(-0.58, 0.58), r.range(0.06, H - 0.03), s * Wd / 2]; }
    const nn = norm(add(n, [r.range(-0.15, 0.15), r.range(-0.1, 0.15), r.range(-0.15, 0.15)]));
    extra.push({ p, n: nn, ao: lerp(0.55, 1, p[1] / H) });
  }
  rosettes(m, [...pts.filter((_, i) => lod === 0 || i % 3 === 0), ...extra], { leaves: lod === 0 ? 3 : 2, size: 0.066 * (lod === 0 ? 1 : 1.6), col: boxCol, r, flex: 0.2 });
  return m;
}

export const boxballs: SpeciesDef = {
  name: 'boxball', about: 'clipped box: a ball, a cone, and a loose leafy mound', variants: 3, grow: boxball,
  lod: [20, 80, 1200], size: [0.55, 1.5],
  wind: [0.25, 0.3, 0.5, 4], look: [0.2, 0.35, 0.85, 0.2], yields: 0.35, burn: [0.6, 0.5, 0.35, 300], shadows: true,
};
export const hedges: SpeciesDef = {
  name: 'hedge', about: 'a clipped box hedge, 1.2 m segments planted a metre apart along an edge', variants: 2, grow: hedge,
  lod: [20, 80, 1200], size: [0.6, 1.0],
  wind: [0.1, 0.15, 0.4, 4], look: [0.2, 0.35, 0.85, 0.2], yields: 0.2, burn: [0.6, 0.5, 0.35, 300], shadows: true,
};
