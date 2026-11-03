// Urns at the gardens' corners, by the pools and the stairs (the concept's): an urn on its foot (terracotta, bronze or
// cream stone), its soil, and its planting: a fern's arching fronds, a mound of geranium-like flowers that blooms in
// the instance's colour, or a spiky fountain of straps. The urn is solid and still; only its plant moves.
import { FloraMesh, PART, add, lerp, lerp3, mul, norm, rng, vary, type V3 } from '../mesh';
import { C } from '../palette';
import { frond, shellPoints, type Lod } from './forms';
import type { SpeciesDef } from './def';

/** the urn's profile: [radius, height] from its foot to its lip and back down inside to the soil */
const URN: [number, number][] = [[0.13, 0], [0.15, 0.03], [0.14, 0.07], [0.09, 0.1], [0.1, 0.14], [0.22, 0.24], [0.3, 0.36], [0.29, 0.47], [0.21, 0.56], [0.2, 0.6], [0.27, 0.63], [0.27, 0.67], [0.23, 0.67], [0.2, 0.62]];
const SOIL_Y = 0.6;

function urn(seed: number, lod: Lod, v: number): FloraMesh {
  const r = rng(seed);
  const m = new FloraMesh();
  const kind = v % 3;
  const pot = kind === 0 ? C.terracotta : kind === 1 ? C.bronze : C.creamStone;
  const prof = lod === 2 ? URN.filter((_, k) => k % 2 === 0 || k === URN.length - 1) : URN;
  m.lathe([0, 0, 0], prof, lod === 0 ? 20 : lod === 1 ? 10 : 6, PART.pot, (k) => lerp3(mul(pot, 0.8), pot, Math.min(1, prof[k][1] / 0.5)), (k) => lerp(0.55, 1, Math.min(1, prof[k][1] / 0.6)));
  m.fan([0, SOIL_Y, 0], [0, 1, 0], 0.2, PART.soil, C.potSoil, mul(C.potSoil, 0.8), { n: lod === 0 ? 10 : 6, flex: 0, ao: 0.6 });
  const top: V3 = [0, SOIL_Y, 0];
  if (kind === 0) {
    // a fern: fronds arching out and over the lip
    const fronds = lod === 0 ? 14 : lod === 1 ? 8 : 5;
    for (let k = 0; k < fronds; k++) {
      const a = k * 2.39996 + r.range(-0.2, 0.2), el = r.range(0.35, 1.2);
      const d: V3 = [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)];
      m.on(top, r.next(), () => frond(m, add(top, mul(d, 0.03)), d, r.range(0.5, 0.75), {
        pairs: lod === 0 ? 16 : 9, leafLen: 0.11, leafW: 0.025, v: 0.15, arch: 1.4, spread: 0.3, part: PART.frond,
        col0: vary(C.fern, r, 0.1, 0.02), col1: C.fernTip, rachis: C.fern, rachisW: 0.012, lod, r, flex0: 0.05, flex1: 1, start: 0.12, droopLeaf: 0.4,
      }));
    }
  } else if (kind === 1) {
    // a flowering mound: a dome of leaves with clusters of bloom over it
    const c = add(top, [0, 0.1, 0]);
    m.mass(c, 0.27, 0.16, 0.27, PART.mass, (n) => vary(lerp3(C.leafDeep, C.leaf, 0.4 + 0.4 * n[1]), r, 0.06, 0.01), r, { rings: lod === 0 ? 5 : 4, segs: lod === 0 ? 9 : 6, lump: 0.2, flex: 0.3, ao: [0.4, 0.95] });
    if (lod < 2) {
      for (const q of shellPoints(c, 0.3, 0.19, 0.3, lod === 0 ? 40 : 12, r, (n) => n[1] > -0.4)) {
        m.diamond(q.p, norm(add(q.n, [r.range(-0.6, 0.6), 0, r.range(-0.6, 0.6)])), q.n, 0.07, 0.06, vary(C.leaf, r, 0.12, 0.02), PART.leaf, { bent: q.n, ao: q.ao, flex: 0.4, flutter: 0.5, rand: r.next() });
      }
    }
    for (const q of shellPoints(c, 0.31, 0.2, 0.31, lod === 0 ? 14 : 6, r, (n) => n[1] > 0.1)) {
      // a cluster of small flowers: flakes in a ball
      for (let k = 0; k < (lod === 0 ? 7 : lod === 1 ? 3 : 1); k++) {
        const n = norm(add(q.n, [r.range(-0.5, 0.5), r.range(0, 0.6), r.range(-0.5, 0.5)]));
        m.flake(add(q.p, mul(n, 0.035)), n, lod === 2 ? 0.1 : 0.04, C.petalTip, PART.petal, { flex: 0.5, flutter: 0.4, rand: r.next() });
      }
    }
  } else {
    // a spiky fountain of straps (cordyline, a young palm)
    const straps = lod === 0 ? 22 : lod === 1 ? 10 : 6;
    for (let k = 0; k < straps; k++) {
      const a = k * 2.39996, el = lerp(1.4, 0.5, k / straps);
      const d: V3 = [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)];
      m.on(top, r.next(), () => m.blade(add(top, [0, 0.02, 0]), d, r.range(0.45, 0.7), 0.035 * (lod === 0 ? 1 : 1.4), 0.5, lod === 0 ? 3 : 1, PART.blade, mul(C.leafBlue, 0.8), vary(C.leafLight, r, 0.1, 0.02), { flex0: 0, flex1: 0.8, flutter: 0.5, ao0: 0.5, rand: r.next() }));
    }
  }
  return m;
}

export const urns: SpeciesDef = {
  name: 'urn', about: 'an urn (terracotta, bronze, cream stone) with a fern, a flowering mound or a fountain of straps', variants: 3, grow: urn,
  lod: [22, 85, 700], size: [0.9, 1.4], blooms: ['#e5534b', '#f2a7c3', '#ffffff', '#c94f7c'],
  wind: [0, 0.8, 0.8, 3], look: [0.3, 0.35, 0.75, 0.5], yields: 0, burn: [0.4, 0.8, 0.4, 400], shadows: true,
};
