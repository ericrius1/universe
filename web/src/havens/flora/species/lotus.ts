// Lotus on the pools: a clump of round pads floating on the water (each notched to its centre, its rim a little
// raised, paler at the heart), and in the flowering variants a pink lotus or two standing over them (three whorls of
// boat-shaped petals round a gold seed pod, pale at the base and deepening to the tips) and a closed bud. The clump's
// origin sits on the water's surface (the instance's y is the pool's level); the stems go down into the water.
import { FloraMesh, PART, add, lerp, lerp3, mul, norm, rng, vary, type Rng, type V3 } from '../mesh';
import { C } from '../palette';
import { cupPetal, type Lod } from './forms';
import type { SpeciesDef } from './def';

/** a pad floating at `c`: a disc of radius `R` with a notch, its rim lifted a little */
function pad(m: FloraMesh, r: Rng, c: V3, R: number, lod: Lod) {
  const segs = lod === 0 ? 18 : lod === 1 ? 10 : 6;
  const notch = r.next() * Math.PI * 2, gap = 0.32;
  const tint = vary(C.pad, r, 0.12, 0.03);
  const ctr = m.vert(add(c, [0, 0.006, 0]), [0, 1, 0], vary(C.padLight, r, 0.08, 0.02), 1, PART.pad, 0.2, 0.1, r.next());
  const lift = r.range(0.01, 0.03), ripple = r.next() * 6;
  const rim: number[] = [], mid: number[] = [];
  for (let k = 0; k <= segs; k++) {
    const a = notch + gap / 2 + (k / segs) * (Math.PI * 2 - gap);
    const out: V3 = [Math.cos(a), 0, Math.sin(a)];
    const wob = 1 + 0.03 * Math.sin(a * 5 + ripple);
    mid.push(m.vert(add(c, add(mul(out, R * 0.6 * wob), [0, 0.004, 0])), [out[0] * 0.05, 1, out[2] * 0.05], lerp3(tint, C.padLight, 0.35), 1, PART.pad, 0.25, 0.2, r.next()));
    rim.push(m.vert(add(c, add(mul(out, R * wob), [0, lift * (0.6 + 0.4 * Math.sin(a * 3 + ripple)), 0])), norm([out[0] * 0.35, 1, out[2] * 0.35]), tint, 0.9, PART.pad, 0.35, 0.45, r.next()));
  }
  for (let k = 0; k < segs; k++) {
    m.tri(ctr, mid[k + 1], mid[k]);
    m.quad(mid[k], mid[k + 1], rim[k + 1], rim[k]);
  }
}

/** a lotus flower at `c` facing up: three whorls of boat-shaped petals opening outward, a gold pod at the heart */
function flower(m: FloraMesh, r: Rng, c: V3, size: number, lod: Lod) {
  const up: V3 = norm([r.range(-0.12, 0.12), 1, r.range(-0.12, 0.12)]);
  const whorls = lod === 0 ? [[7, 0.45, 0.9], [8, 0.95, 1.0], [8, 1.5, 0.92]] : lod === 1 ? [[6, 0.6, 0.95], [7, 1.3, 1.0]] : [[5, 1.0, 1.0]];
  // (petal shading: pale and warm at the base, deepening toward the tips; the bloom colour multiplies it)
  const shade = (t: number, e: number): V3 => lerp3(C.petalBaseWarm, [0.78, 0.6, 0.68], Math.pow(t, 1.4) * (0.85 + 0.15 * e));
  whorls.forEach(([n, open, len], w) => {
    for (let k = 0; k < n; k++) {
      const phi = (k / n) * Math.PI * 2 + w * 0.4 + r.range(-0.08, 0.08);
      const H = size * len * r.range(0.92, 1.06);
      cupPetal(m, c, up, phi, (Math.PI * 2 / n) * 1.25, H, (t) => size * (0.12 + open * 0.55 * Math.sin(t * Math.PI * 0.55) + 0.1 * t), {
        rows: lod === 0 ? 4 : lod === 1 ? 2 : 1, cols: lod === 0 ? 2 : 1, col: shade, flex: 0.85, ao0: 0.7, rand: r.next(), tipWidth: 0,
      });
    }
  });
  // the seed pod (a flat-topped gold cone) and its ring of stamens
  m.fan(add(c, mul(up, size * 0.32)), up, size * 0.16, PART.disc, C.lotusPod, mul(C.lotusPod, 0.8), { n: lod === 0 ? 8 : 5, dome: 0.15, flex: 0.85 });
  if (lod === 0) for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    m.blade(add(c, mul(up, size * 0.12)), norm(add(up, [Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7])), size * 0.28, 0.006, 0.2, 1, PART.disc, C.stamen, C.discGold, { flex0: 0.85, flex1: 0.9, flutter: 0.2, taper: 0.3, rand: r.next() });
  }
}

/** a closed bud: a pointed teardrop of petal, pink at its tip */
function bud(m: FloraMesh, c: V3, size: number, lod: Lod) {
  const prof: [number, number][] = [[0.05, 0], [0.32, 0.2], [0.38, 0.45], [0.26, 0.75], [0.0, 1.0]];
  m.lathe(c, prof.map(([a, b]) => [a * size, b * size * 1.7]), lod === 0 ? 8 : 5, PART.petal, (k) => lerp3(C.petalBaseWarm, [0.75, 0.55, 0.65], k / (prof.length - 1)), (k) => lerp(0.75, 1, k / (prof.length - 1)), 0.8);
}

function lotus(seed: number, lod: Lod, v: number): FloraMesh {
  const r = rng(seed);
  const m = new FloraMesh();
  const pads = v === 0 ? r.int(5, 7) : r.int(7, 9);
  for (let k = 0; k < pads; k++) {
    const a = k * 2.39996 + r.range(-0.3, 0.3), rr = 0.55 * Math.sqrt((k + 0.5) / pads) * r.range(0.8, 1.15);
    m.on([0, -0.3, 0], r.next(), () => pad(m, r, [Math.cos(a) * rr, 0.004 + k * 0.0015, Math.sin(a) * rr], r.range(0.14, 0.3), lod));
  }
  const flowers = v === 0 ? 0 : v === 1 ? 1 : 2;
  for (let k = 0; k < flowers + (v === 0 ? 0 : 1); k++) {
    const isBud = k === flowers;
    const a = r.next() * Math.PI * 2, rr = r.range(0.05, 0.3);
    const h = isBud ? r.range(0.14, 0.26) : r.range(0.05, 0.13);
    const foot: V3 = [Math.cos(a) * rr, -0.25, Math.sin(a) * rr];
    const top: V3 = add(foot, [r.range(-0.05, 0.05), 0.25 + h, r.range(-0.05, 0.05)]);
    m.on(foot, r.next(), () => {
      if (lod < 2) m.blade(foot, norm([top[0] - foot[0], top[1] - foot[1], top[2] - foot[2]]), Math.hypot(top[0] - foot[0], top[1] - foot[1], top[2] - foot[2]), 0.012, 0.05, 2, PART.stem, mul(C.stemGreen, 0.8), C.stemGreen, { flex0: 0, flex1: 0.8, flutter: 0.05, taper: 0.2, rand: r.next() });
      if (isBud) bud(m, top, 0.06, lod);
      else flower(m, r, top, 0.16 * r.range(0.9, 1.1), lod);
    });
  }
  return m;
}

export const lotuses: SpeciesDef = {
  name: 'lotus', about: 'lotus on the pools: notched floating pads, pink many-petalled flowers and buds', variants: 3, grow: lotus,
  lod: [18, 70, 400], size: [0.85, 1.3], scaled: true, blooms: ['#f2a7c3', '#f5b8cf', '#ee98b8', '#f8d0de'],
  wind: [0.05, 0.5, 0.6, 2], look: [0.45, 0.4, 0.6, 0.6], yields: 0.6, burn: [0.15, 0.6, 0.4, 300], shadows: false,
};
