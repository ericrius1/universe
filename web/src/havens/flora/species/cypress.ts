// The Italian cypress, the concept's dark exclamation marks: a tall column, near uniform through its lower two thirds
// and drawn up to a flame's point, its dense scale-leaf foliage in vertical ridges and flame-shaped tufts that break
// its silhouette. A short trunk shows at its foot. It sways as a whole, its tufts shivering; it is dark and cool, the
// deep counterpoint to the blossom.
import { FloraMesh, PART, add, clamp, lerp, lerp3, mul, norm, rng, smooth, vary, type V3 } from '../mesh';
import { C } from '../palette';
import type { Lod } from './forms';
import type { SpeciesDef } from './def';

function cypress(seed: number, lod: Lod, v: number): FloraMesh {
  const r = rng(seed);
  const m = new FloraMesh();
  const H = 8, R = v % 2 === 1 ? 0.55 : 0.68;
  // the silhouette: a tuck at the foot, the column, the flame (and a slight lean and wander up it)
  const prof = (t: number) => R * (0.82 + 0.18 * smooth(0.0, 0.1, t)) * Math.pow(clamp((1 - t) / 0.48, 0, 1), 0.85) * (1 + 0.05 * Math.sin(t * 9 + seed));
  const lean: V3 = [r.range(-0.04, 0.04), 0, r.range(-0.04, 0.04)];
  const axis = (t: number): V3 => [lean[0] * t * H + 0.06 * Math.sin(t * 5 + seed) * t, t * H, lean[2] * t * H + 0.05 * Math.cos(t * 4 + seed) * t];
  // the trunk at its foot
  if (lod < 2) m.tube([[0, -0.1, 0], [0, 0.1, 0], [0, 0.3, 0]], [0.1, 0.09, 0.08], lod === 0 ? 6 : 4, PART.bark, () => C.barkCypress, () => 0.4, () => 0);
  // the core: rings of lumpy vertical ridges (each side its own depth, wandering slowly up the tree)
  const sides = lod === 0 ? 14 : lod === 1 ? 8 : 6, rings = lod === 0 ? 22 : lod === 1 ? 10 : 6;
  const ridge = Array.from({ length: sides }, () => [r.range(0.82, 1.12), r.range(0, 6), r.range(0.5, 1.5)]);
  const rows: number[][] = [];
  for (let i = 0; i <= rings; i++) {
    const t = 0.015 + 0.985 * (i / rings);
    const ax = axis(t), rad = prof(t);
    const row: number[] = [];
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2 + i * 0.07;
      const [k0, ph, f] = ridge[j];
      const k = k0 * (1 + 0.08 * Math.sin(t * 14 * f + ph));
      const n: V3 = norm([Math.cos(a), 0.25 + 0.6 * smooth(0.6, 1, t), Math.sin(a)]);
      const p: V3 = add(ax, [Math.cos(a) * rad * k, i === rings ? 0.15 : 0, Math.sin(a) * rad * k]);
      const lit = clamp((k - 0.82) / 0.3, 0, 1);
      const col = vary(lerp3(C.cypressDeep, lerp3(C.cypress, C.cypressLight, t * 0.6), 0.35 + 0.65 * lit), r, 0.05, 0.01);
      row.push(m.vert(p, n, col, lerp(0.35, 1, lit * 0.6 + t * 0.4), PART.needle, 0.2 * t, 0.15, r.next()));
    }
    rows.push(row);
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
    const j1 = (j + 1) % sides;
    m.quad(rows[i][j], rows[i + 1][j], rows[i + 1][j1], rows[i][j1]);
  }
  // the bottom closed (seen from a terrace above)
  const foot = m.vert(axis(0.0), [0, -1, 0], C.cypressDeep, 0.3, PART.needle, 0, 0, 0.5);
  for (let j = 0; j < sides; j++) m.tri(rows[0][j], rows[0][(j + 1) % sides], foot);
  if (lod === 2) return m;
  // flame tufts over the surface, pointing up and a little out, breaking the outline
  const tufts = lod === 0 ? 400 : 48;
  for (let k = 0; k < tufts; k++) {
    const t = Math.pow(r.next(), 0.85) * 0.93 + 0.05;
    const a = r.next() * Math.PI * 2;
    const out: V3 = [Math.cos(a), 0, Math.sin(a)];
    const rad = prof(t) * r.range(0.84, 1.0);
    const base = add(axis(t), mul(out, rad));
    const L = r.range(0.18, 0.32) * (1 - 0.35 * t) * (lod === 0 ? 1 : 1.7), W = L * r.range(0.45, 0.6);
    const dir = norm(add([0, 1, 0], mul(out, r.range(0.05, 0.2))));
    const lit = r.next();
    m.diamond(add(base, mul(dir, -L * 0.25)), dir, out, L, W, vary(lerp3(C.cypress, C.cypressLight, 0.15 + 0.35 * lit * t + 0.1 * lit), r, 0.08, 0.015), PART.needle,
      { at: 0.35, lift: 0.12, bent: norm(add(out, [0, 0.3, 0])), bend: 0.6, ao: lerp(0.55, 1, t), flex: 0.25 * t, flutter: 0.6, rand: r.next() });
  }
  return m;
}

export const cypresses: SpeciesDef = {
  name: 'cypress', about: 'Italian cypress: a dark flame-shaped column of ridged foliage and tufts', variants: 2, grow: cypress,
  lod: [40, 160, 3000], size: [6, 11],
  wind: [0.6, 0.15, 0.3, 3], look: [0.12, 0.3, 0.8, 0.15], yields: 0.05, burn: [0.8, 0.3, 0.25, 600], shadows: true,
};
