// The canyon's own plants, for the floor, the benches and the plateau: desert scrub (sage and saltbush: a twiggy
// grey-green mound), bunchgrass (a fountain of pale straw blades with a few seed stalks) and agaves (a stiff rosette of
// thick, channelled blue-green leaves with yellow margins and dark tips). Muted against the gardens' greens, as the
// desert's are.
import { FloraMesh, PART, add, clamp, hash, lerp, lerp3, mul, norm, rng, vary, type V3 } from '../mesh';
import { C } from '../palette';
import { bendPath, outward, puff, type Lod } from './forms';
import type { SpeciesDef } from './def';

function scrub(seed: number, lod: Lod, v: number): FloraMesh {
  const r = rng(seed);
  const d = rng(hash(seed, lod, 5));
  const m = new FloraMesh();
  const R = v % 2 === 1 ? 0.75 : 0.55, H = v % 2 === 1 ? 0.75 : 0.6;
  const col = (rr: typeof r, n: V3, depth: number) => vary(lerp3(mul(C.scrub, 0.75), C.scrubLight, clamp(0.3 + 0.5 * depth + 0.2 * n[1], 0, 1)), rr, 0.1, 0.02);
  // twiggy stems from the crown, each ending in a tuft of small leaves
  const stems = 14;
  for (let s = 0; s < stems; s++) {
    const dir = outward(r, 1.1);
    const L = lerp(0.6, 1, r.next()) * Math.hypot(R * dir[0], H * dir[1], R * dir[2]) * 1.05;
    const pts = bendPath([0, -0.03, 0], dir, L, 3, 0.15, 0.2, 0.4, r);
    const tip = pts[pts.length - 1];
    m.on([0, 0, 0], r.next(), () => {
      if (lod === 0) m.tube(pts, pts.map((_, k) => 0.016 * (1 - 0.7 * k / 3)), 3, PART.bark, () => C.scrubStem, () => 0.55, (k) => (k / 3) * 0.6);
      if (lod === 2) return;
      const rad = r.range(0.18, 0.3);
      if (lod === 1) m.mass(tip, rad, rad * 0.7, rad, PART.mass, (n) => col(d, n, 0.7), d, { rings: 3, segs: 5, lump: 0.3, flex: 0.5, ao: [0.5, 1] });
      puff(m, tip, rad, rad * 0.75, lod === 0 ? 30 : 6, lod === 0 ? 0.075 : 0.12, PART.leaf, col, d, { crown: [0, H * 0.5, 0], flex: 0.6, long: 1.7, diamond: true, aoIn: 0.5, core: lod === 0 ? { part: PART.mass, segs: 6 } : undefined });
    });
  }
  if (lod === 2) m.mass([0, H * 0.45, 0], R * 0.9, H * 0.55, R * 0.9, PART.mass, (n) => col(d, n, 0.6 + 0.3 * n[1]), d, { rings: 4, segs: 7, lump: 0.3, bottom: 0, flex: 0.4, ao: [0.45, 1] });
  return m;
}

function bunchgrass(seed: number, lod: Lod, v: number): FloraMesh {
  const r = rng(seed);
  const m = new FloraMesh();
  const H = v % 2 === 1 ? 0.55 : 0.4;
  const blades = 84;
  const every = lod === 0 ? 1 : lod === 1 ? 3 : 8;
  for (let k = 0; k < blades; k++) {
    const dir = outward(r, 1.0);
    const base: V3 = [dir[0] * 0.04 * r.next(), -0.02, dir[2] * 0.04 * r.next()];
    const tone = r.next();
    const tip = tone < 0.25 ? vary(C.tuftBase, r, 0.1, 0.02) : vary(C.tuft, r, 0.1, 0.03);
    const L = H * r.range(0.6, 1.05), droop = r.range(0.4, 1.4), ph = r.next();
    m.skip = k % every !== 0;
    m.on(base, ph, () => m.blade(base, dir, L, 0.008 * (lod === 0 ? 1 : lod === 1 ? 2 : 3.2), droop, lod === 0 ? 3 : lod === 1 ? 2 : 1, PART.blade, vary(C.tuftBase, r, 0.1, 0.02), tip, { flex0: 0, flex1: 1, flutter: 0.4, ao0: 0.45, rand: r.next() }));
  }
  // seed stalks with their narrow heads
  for (let k = 0; k < 6; k++) {
    const dir = outward(r, 0.45);
    m.skip = (lod === 1 && k > 1) || lod === 2;
    m.on([0, 0, 0], r.next(), () => {
      const tip = m.blade([0, 0, 0], dir, H * r.range(1.1, 1.35), 0.004, 0.15, 2, PART.stem, C.tuftBase, C.tuft, { flex0: 0, flex1: 1, flutter: 0.2, taper: 0.3, rand: r.next() });
      m.blade(add(tip, mul(dir, -0.09)), norm(add(dir, [0, 0.3, 0])), 0.1, 0.012, 0.1, 1, PART.blade, mul(C.tuft, 1.05), mul(C.tuft, 1.15), { flex0: 1, flex1: 1, flutter: 0.5, taper: 0.7, rand: r.next() });
    });
  }
  m.skip = false;
  return m;
}

function agave(seed: number, lod: Lod, v: number): FloraMesh {
  const r = rng(seed);
  const m = new FloraMesh();
  const big = v % 2 === 1;
  const n = lod === 0 ? (big ? 30 : 22) : lod === 1 ? 14 : 8;
  for (let k = 0; k < n; k++) {
    const a = k * 2.39996 + r.range(-0.1, 0.1);
    // the inner leaves stand up, the outer ones spread out low
    const age = k / n;
    const el = lerp(1.3, 0.25, Math.pow(1 - age, 0.8)) + r.range(-0.08, 0.08);
    const dir: V3 = [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)];
    const L = (big ? 0.7 : 0.45) * lerp(0.55, 1, 1 - age * 0.6) * r.range(0.9, 1.1);
    const W = L * 0.24;
    const leafCol = vary(C.agave, r, 0.08, 0.02);
    m.leaf([Math.cos(a) * 0.03, 0.02, Math.sin(a) * 0.03], dir, [0, 1, 0], L, W, PART.leaf,
      (t, e) => lerp3(lerp3(C.agaveBase, leafCol, Math.min(1, t * 2)), C.agaveEdge, e > 0.9 && lod === 0 ? 0.65 : 0),
      { segs: lod === 0 ? 4 : lod === 1 ? 2 : 1, shape: (t) => Math.pow(Math.sin(Math.PI * Math.min(1, 0.25 + t * 0.85)), 0.7) * (1 - t * 0.2), fold: 0.45, cup: 0.1, curl: lerp(-0.1, 0.35, 1 - age), flex0: 0, flex1: 0.12, flutter: 0.05, ao0: 0.4, rand: r.next() });
  }
  return m;
}

export const scrubs: SpeciesDef = {
  name: 'scrub', about: 'desert scrub: a twiggy grey-green mound of sage and saltbush', variants: 2, grow: scrub,
  lod: [18, 70, 500], size: [0.4, 1.0], blooms: ['#ffffff'],
  wind: [0.4, 0.7, 0.8, 3.5], look: [0.25, 0.4, 0.7, 0.05], yields: 0.4, burn: [1, 0.7, 0.6, 900], shadows: true,
};
export const bunchgrasses: SpeciesDef = {
  name: 'bunchgrass', about: 'bunchgrass: a fountain of pale straw blades and seed stalks', variants: 2, grow: bunchgrass,
  lod: [15, 55, 350], size: [0.3, 0.65], blooms: ['#ffffff'],
  wind: [1, 1.3, 0.8, 4], look: [0.55, 0.5, 0.7, 0.05], yields: 1, burn: [1, 0.6, 0.85, 240], shadows: false,
};
export const agaves: SpeciesDef = {
  name: 'agave', about: 'agave: a stiff rosette of thick channelled blue-green leaves', variants: 2, grow: agave,
  lod: [20, 80, 600], size: [0.4, 1.0], blooms: ['#ffffff'],
  wind: [0.05, 0.1, 0.05, 2], look: [0.15, 0.3, 0.7, 0.4], yields: 0, burn: [0.25, 0.3, 0.2, 1800], shadows: true,
};
