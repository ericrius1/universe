// The date palm (the city's streets and courts): a tall trunk in rings of old leaf bases, leaning and gently curved,
// a collar of frond stubs under the crown, and the crown itself: young fronds standing up, the middle ones arching
// out, the oldest hanging down, each a rachis with paired leaflets lifted in a V; orange date clusters hang under it.
// The fronds swing about the crown, their leaflets fluttering; the trunk bends as a whole.
import { FloraMesh, PART, add, clamp, lerp, lerp3, mul, norm, rng, vary, type V3 } from '../mesh';
import { C } from '../palette';
import { bendPath, frond, type Lod } from './forms';
import type { SpeciesDef } from './def';

function datePalm(seed: number, lod: Lod, v: number): FloraMesh {
  const r = rng(seed);
  const m = new FloraMesh();
  const H = v % 2 === 1 ? 10 : 8.5;
  const lean: V3 = norm([r.range(-0.12, 0.12), 1, r.range(-0.12, 0.12)]);
  const segs = lod === 0 ? 40 : lod === 1 ? 12 : 4;
  const trunk = bendPath([0, -0.1, 0], lean, H, segs, 0, 0.05, 0.08, r);
  const top = trunk[trunk.length - 1];
  // the trunk: rings of leaf bases (each ring a little proud, dark in its grooves), wider at the foot and under the crown
  const radius = (k: number) => {
    const t = k / segs;
    const ring = lod === 0 ? (k % 2 === 0 ? 1.06 : 0.97) : 1;
    return (0.3 + 0.12 * Math.exp(-t * 18) + 0.08 * clamp((t - 0.9) / 0.1, 0, 1)) * ring;
  };
  m.tube(trunk, trunk.map((_, k) => radius(k)), lod === 0 ? 10 : lod === 1 ? 6 : 4, PART.bark,
    (k) => (lod === 0 && k % 2 === 1 ? C.palmRing : vary(lerp3(C.palmTrunk, mul(C.palmTrunk, 1.15), k / segs), r, 0.05, 0.01)), (k) => (lod === 0 && k % 2 === 1 ? 0.55 : 0.85), (k) => (k / segs) * 0.15, { cap: true });
  // the collar of frond stubs under the crown
  if (lod < 2) {
    const stubs = lod === 0 ? 18 : 8;
    for (let k = 0; k < stubs; k++) {
      const a = (k / stubs) * Math.PI * 2 + r.range(-0.2, 0.2);
      const out: V3 = [Math.cos(a), 0, Math.sin(a)];
      const base = add(top, add(mul(out, 0.28), [0, -r.range(0.15, 0.6), 0]));
      m.diamond(base, norm(add(out, [0, r.range(0.4, 1.2), 0])), out, r.range(0.35, 0.6), 0.16, vary(C.frondOld, r, 0.12, 0.03), PART.frond, { at: 0.3, lift: 0.05, ao: 0.6, flex: 0.15, flutter: 0.1, rand: r.next() });
    }
  }
  // the crown: whorls of fronds by golden angle, the youngest upright, the oldest hanging
  const fronds = lod === 0 ? 22 : lod === 1 ? 16 : 10;
  for (let k = 0; k < fronds; k++) {
    const age = k / (fronds - 1);
    const a = k * 2.39996 + r.range(-0.15, 0.15);
    const el = lerp(1.15, -0.55, Math.pow(age, 0.9)) + r.range(-0.12, 0.12);
    const d: V3 = norm([Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)]);
    const L = r.range(3.2, 4.2) * (age < 0.15 ? 0.8 : 1);
    const old = age > 0.82;
    const base = add(top, mul(d, 0.12));
    m.on(top, r.next(), () => frond(m, base, d, L, {
      pairs: lod === 0 ? 26 : 16, leafLen: 0.64, leafW: 0.055, v: 0.6, arch: lerp(0.25, 1.4, age), spread: 0.45, part: PART.frond,
      col0: old ? C.frondOld : vary(C.frond, r, 0.08, 0.02), col1: old ? mul(C.frondOld, 1.1) : vary(C.frondTip, r, 0.08, 0.02), rachis: C.frondOld, rachisW: 0.05,
      lod, r, flex0: 0.05, flex1: 1, start: 0.14, droopLeaf: 0.6, ragged: 0.25,
    }));
  }
  // date clusters hanging under the crown
  if (lod < 2) {
    const clusters = r.int(3, 5);
    for (let k = 0; k < clusters; k++) {
      const a = r.next() * Math.PI * 2;
      const out: V3 = [Math.cos(a), 0, Math.sin(a)];
      const at = add(top, add(mul(out, 0.35), [0, -0.3, 0]));
      m.on(top, r.next(), () => {
        const strands = lod === 0 ? 6 : 3;
        for (let s = 0; s < strands; s++) {
          const d = norm(add(out, [r.range(-0.4, 0.4), -r.range(1.2, 2.2), r.range(-0.4, 0.4)]));
          const len = r.range(0.35, 0.6);
          if (lod === 0) m.blade(at, d, len, 0.008, 0.2, 2, PART.stem, C.dates, C.dates, { flex0: 0.3, flex1: 0.5, flutter: 0, taper: 0.3, rand: r.next() });
          for (let j = 0; j < (lod === 0 ? 4 : 2); j++) {
            const p = add(at, mul(d, len * (0.35 + j * 0.15)));
            m.ball(add(p, [r.range(-0.03, 0.03), 0, r.range(-0.03, 0.03)]), lod === 0 ? 0.022 : 0.05, vary(C.dates, r, 0.12, 0.03), PART.fruit, { flex: 0.45, rand: r.next(), squash: 1.4 });
          }
        }
      });
    }
  }
  return m;
}

export const datePalms: SpeciesDef = {
  name: 'datepalm', about: 'the date palm: a ringed trunk, a crown of arching pinnate fronds, orange dates', variants: 2, grow: datePalm,
  lod: [45, 170, 3000], size: [7, 13], blooms: ['#ffffff'],
  wind: [0.35, 1, 1, 2.5], look: [0.4, 0.45, 0.75, 0.25], yields: 0, burn: [0.7, 0.6, 0.2, 1200], shadows: true,
};
