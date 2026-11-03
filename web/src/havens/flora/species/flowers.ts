// The flower beds' clumps: daisies (flat rays, coneflowers, asters), lilies (open stars and trumpets), tulips (goblets
// over broad straps), cushions of small stars (phlox, alyssum) and spires (foxglove bells, salvia wands). Each is a
// full mound of leaf with its flowers held just over it in a loose dome, a little larger than life so they read across
// a terrace. Their petals are grown white and shaded; each instance blooms in its bed's colour family (palette.ts). The
// light levels keep the same stems and heads, fewer and simpler; the lightest is a mound of leaf with its blooms as a
// few big flakes on top, cheap enough to colour the beds from the air.
import { FloraMesh, PART, add, clamp, lerp, lerp3, mul, norm, rng, vary, type Rng, type V3 } from '../mesh';
import { C } from '../palette';
import { bell, daisyHead, floret, lilyHead, outward, rosettes, shellPoints, starHead, tulipHead, type Lod } from './forms';
import type { SpeciesDef } from './def';

const FLOWER_LOD: [number, number, number] = [12, 40, 450];

/** a stem from near the root along `d`, gently curved; returns its tip and its direction there */
function stem(m: FloraMesh, r: Rng, d: V3, length: number, lod: Lod, curve = 0.15, width = 0.008): [V3, V3] {
  const base: V3 = [d[0] * 0.03, -0.02, d[2] * 0.03];
  const tip = m.blade(base, d, length, width * (lod === 0 ? 1 : 1.6), curve, lod === 0 ? 3 : 2, PART.stem, mul(C.stemGreen, 0.75), C.stemGreen, { flex0: 0, flex1: 0.85, flutter: 0.1, ao0: 0.45, taper: 0.4, rand: r.next() });
  return [tip, norm(add(d, [0, 0.4 - curve, 0]))];
}

/** the leafy base of a clump: `n` leaves round the root arching out and over into a mound (straps for the bulbs) */
function basal(m: FloraMesh, r: Rng, n: number, length: number, width: number, lod: Lod, o: { col?: V3; lean?: [number, number]; strap?: boolean; curl?: number; twist?: number } = {}) {
  const col = o.col ?? C.leaf;
  const [l0, l1] = o.lean ?? [0.5, 1.2];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 * 2.618 + r.range(-0.3, 0.3), lean = lerp(l0, l1, r.next());
    const d: V3 = [Math.cos(a) * Math.sin(lean), Math.cos(lean), Math.sin(a) * Math.sin(lean)];
    const L = length * r.range(0.7, 1.15), c0 = vary(col, r, 0.12, 0.025);
    const skip = m.skip;
    m.skip = skip || (lod === 1 && k % 2 === 1) || (lod === 2 && k % 3 !== 0);
    // (the inner leaves stand up, lighter; the outer ones lie out over the ground, in their shade)
    const inner = lean < lerp(l0, l1, 0.4);
    const cc = inner ? mul(c0, 1.12) : c0;
    if (o.strap) m.blade([0, 0, 0], d, L, width * (lod === 0 ? 1 : 1.3), o.curl ?? 0.8, lod === 0 ? 3 : lod === 1 ? 2 : 1, PART.blade, mul(cc, 0.65), mul(cc, 1.15), { flex0: 0, flex1: 0.6, flutter: 0.4, ao0: 0.4, rand: r.next(), twist: o.twist ? r.range(-o.twist, o.twist) : 0 });
    else m.leaf([0, 0.01, 0], d, [0, 1, 0], L, width, PART.leaf, (t, e) => mul(cc, lerp(0.7, 1.1, t) * (1 - 0.12 * e)), { segs: lod === 0 ? 3 : 2, cup: 0.25, fold: 0.15, curl: o.curl ?? 0.8, flex0: 0, flex1: 0.5, flutter: 0.6, ao0: 0.4, ao1: inner ? 1 : 0.85, rand: r.next() });
    m.skip = skip;
  }
}

/** the lightest level's body: a low dome of leaf (as wide as the full clump's foliage, about as tall) */
function leafMound(m: FloraMesh, r: Rng, rx: number, ry: number) {
  m.mass([0, ry * 0.42, 0], rx, ry * 0.58, rx, PART.mass, (n) => vary(lerp3(C.leafDeep, C.leaf, 0.55 + 0.45 * n[1]), r, 0.06, 0.01), r, { rings: 4, segs: 7, lump: 0.18, bottom: 0, flex: 0.3, ao: [0.45, 1] });
}
/** the lightest level's blooms: big flakes over its top (spread within `rx`, at about `y`), where the heads are */
function bloomFlakes(m: FloraMesh, r: Rng, n: number, rx: number, y: number, size: number) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r.next(), rr = rx * Math.sqrt(r.next());
    m.flake([Math.cos(a) * rr, y * r.range(0.88, 1.04) - rr * 0.3, Math.sin(a) * rr], [Math.cos(a) * rr * 2, 1, Math.sin(a) * rr * 2], size * r.range(0.85, 1.15), C.petalTip, PART.petal, { flex: 0.7, flutter: 0.3, rand: r.next() });
  }
}

// ------------------------------------------------------------------ daisies
const DAISY = [
  { disc: C.discGold, rays: 16, petalLen: 0.052, petalW: 0.016, discR: 0.017, droop: 0.05, heads: 12, H: 0.38 },    // shasta, coreopsis
  { disc: C.discBrown, rays: 13, petalLen: 0.058, petalW: 0.019, discR: 0.022, droop: 0.6, heads: 9, H: 0.44 },     // coneflower
  { disc: C.discGold, rays: 18, petalLen: 0.036, petalW: 0.008, discR: 0.012, droop: 0.12, heads: 15, H: 0.34 },  // aster
];
function daisy(seed: number, lod: Lod, v: number): FloraMesh {
  const r = rng(seed);
  const m = new FloraMesh();
  const D = DAISY[v % DAISY.length];
  const H = D.H * r.range(0.9, 1.1);
  basal(m, r, 34, 0.2, 0.05, lod, { lean: [0.25, 1.25], curl: 0.9 });
  if (lod === 2) { leafMound(m, r, 0.17, H * 0.5); bloomFlakes(m, r, 10, 0.2, H * 0.95, D.petalLen * 2.6); return m; }
  for (let s = 0; s < D.heads; s++) {
    const d = outward(r, 0.6);
    m.skip = lod === 1 && s % 2 === 1;
    m.on([0, 0, 0], r.next(), () => {
      const [tip, td] = stem(m, r, d, H * r.range(0.72, 1.04), lod, 0.18);
      for (let k = 0; k < 2; k++) {
        const y = r.range(0.3, 0.6), skip = m.skip;
        m.skip = skip || lod > 0;
        m.leaf(mul(tip, y), norm([Math.cos(k * 3 + s), 0.5, Math.sin(k * 3 + s)]), [0, 1, 0], 0.06, 0.016, PART.leaf, () => C.leaf, { segs: 2, flex0: y, flex1: y, rand: r.next() });
        m.skip = skip;
      }
      const up = norm(add(td, [r.range(-0.3, 0.3), 1.2, r.range(-0.3, 0.3)]));
      daisyHead(m, tip, up, { rays: lod === 0 ? D.rays : Math.max(8, Math.round(D.rays * 0.55)), petalLen: D.petalLen * r.range(0.9, 1.1), petalW: D.petalW, discR: D.discR, disc: D.disc, droop: D.droop, lod, rand: r.next(), flex: 0.9 });
    });
  }
  m.skip = false;
  return m;
}

// ------------------------------------------------------------------ lilies
function lily(seed: number, lod: Lod, v: number): FloraMesh {
  const r = rng(seed);
  const m = new FloraMesh();
  const trumpet = v % 2 === 1;
  const H = r.range(0.5, 0.62);
  basal(m, r, 18, 0.3, 0.026, lod, { strap: true, lean: [0.35, 1.15], curl: 1.1, col: C.leaf, twist: 0.6 });
  if (lod === 2) leafMound(m, r, 0.15, H * 0.4);
  const stems = r.int(4, 6);
  for (let s = 0; s < stems; s++) {
    const d = outward(r, 0.35);
    m.skip = (lod === 1 && s % 2 === 1) || (lod === 2 && s > 2);
    m.on([0, 0, 0], r.next(), () => {
      const [tip, td] = stem(m, r, d, H * r.range(0.8, 1.05), lod, 0.08, 0.009);
      // leaves whorled up the stem
      for (let k = 0; k < 6; k++) {
        const y = 0.22 + k * 0.11, skip = m.skip;
        m.skip = skip || lod > 0;
        m.blade(mul(tip, y), norm([Math.cos(k * 2.4 + s), 0.45, Math.sin(k * 2.4 + s)]), 0.1, 0.013, 0.6, 2, PART.blade, C.leaf, C.leafLight, { flex0: y * 0.8, flex1: y, flutter: 0.4, rand: r.next() });
        m.skip = skip;
      }
      const heads = r.int(1, 2);
      for (let h = 0; h < heads; h++) {
        const skip = m.skip;
        m.skip = skip || (lod > 0 && h > 0);
        const a = r.next() * Math.PI * 2;
        const hd = norm(add(td, [Math.cos(a) * 0.9, trumpet ? 0.05 : 0.4, Math.sin(a) * 0.9]));
        const at = add(tip, [Math.cos(a) * 0.025 * h, -0.05 * h, Math.sin(a) * 0.025 * h]);
        lilyHead(m, at, hd, { petalLen: (trumpet ? 0.12 : 0.1) * r.range(0.9, 1.1), petalW: trumpet ? 0.034 : 0.032, flare: trumpet ? 0.45 : 1.0, lod, rand: r.next(), flex: 0.9 });
        m.skip = skip;
      }
    });
  }
  m.skip = false;
  return m;
}

// ------------------------------------------------------------------ tulips
function tulip(seed: number, lod: Lod, v: number): FloraMesh {
  const r = rng(seed);
  const m = new FloraMesh();
  const H = r.range(0.3, 0.38);
  const open = v % 2 === 1 ? 0.35 : 0.08;
  basal(m, r, 9, 0.24, 0.07, lod === 2 ? 1 : lod, { strap: true, lean: [0.3, 0.85], curl: 0.9, col: C.leafBlue, twist: 0.9 });
  const stems = r.int(7, 10);
  for (let s = 0; s < stems; s++) {
    const d = outward(r, 0.3);
    m.skip = (lod === 1 && s % 3 === 2) || (lod === 2 && s % 2 === 1);
    m.on([0, 0, 0], r.next(), () => {
      const [tip, td] = stem(m, r, d, H * r.range(0.8, 1.1), lod, 0.04, 0.01);
      tulipHead(m, add(tip, mul(td, -0.01)), norm(add(td, [0, 1.8, 0])), { size: 0.06 * r.range(0.9, 1.1), open: open * r.range(0.6, 1.4), lod, rand: r.next(), flex: 0.9 });
    });
  }
  m.skip = false;
  return m;
}

// ------------------------------------------------------------------ cushions of stars
function starflower(seed: number, lod: Lod, v: number): FloraMesh {
  const r = rng(seed);
  const m = new FloraMesh();
  const tiny = v % 2 === 1;
  const rx = r.range(0.25, 0.3), ry = r.range(0.14, 0.18);
  const c: V3 = [0, ry * 0.42, 0];
  m.mass(c, rx * 0.84, ry * 0.68, rx * 0.84, PART.mass, (n) => vary(lerp3(C.leafDeep, C.leaf, 0.35 + 0.4 * n[1]), r, 0.05, 0.01), r, { rings: lod === 0 ? 6 : 4, segs: lod === 0 ? 11 : 7, lump: 0.2, bottom: 0, flex: 0.3, ao: [0.3, 0.8] });
  if (lod === 2) { bloomFlakes(m, r, 9, rx * 0.85, ry * 1.05, 0.12); return m; }
  // the cushion's leaves, in rosettes all over it
  rosettes(m, shellPoints(c, rx * 0.95, ry * 0.75, rx * 0.95, lod === 0 ? 110 : 34, r, (n) => n[1] > -0.3), {
    leaves: lod === 0 ? 3 : 2, size: 0.048 * (lod === 0 ? 1 : 1.35), col: (rr) => vary(lerp3(C.leaf, C.leafLight, rr.next() * 0.45), rr, 0.1, 0.02), r, flex: 0.4,
  });
  // the heads, in drifts over its top: phlox's five-petalled stars with gold eyes, alyssum's tiny florets in domes
  const drifts = shellPoints(c, rx, ry * 0.8, rx, 16, r, (n) => n[1] > 0.05, 0.2);
  const per = tiny ? 16 : 10;
  drifts.forEach((q0, i) => {
    for (let k = 0; k < per; k++) {
      const n = norm(add(q0.n, [r.range(-0.32, 0.32), r.range(-0.1, 0.25), r.range(-0.32, 0.32)]));
      const p: V3 = [c[0] + n[0] * rx * 1.0, c[1] + n[1] * ry * 0.84 + (tiny ? 0.012 * (1 - k / per) : 0), c[2] + n[2] * rx * 1.0];
      const skip = m.skip;
      m.skip = lod === 1 && k % 3 !== 0;
      if (tiny) m.flake(p, norm(add(n, [0, 0.7, 0])), 0.022 * (lod === 0 ? 1 : 1.6), C.petalTip, PART.petal, { flex: 0.5, flutter: 0.3, rand: r.next() + i });
      else starHead(m, p, norm(add(n, [0, 0.6, 0])), 0.022 * (lod === 0 ? 1 : 1.5), 5, C.discGold, { rand: r.next() + i, flex: 0.5, lod });
      m.skip = skip;
    }
  });
  return m;
}

// ------------------------------------------------------------------ spires
function spire(seed: number, lod: Lod, v: number): FloraMesh {
  const r = rng(seed);
  const m = new FloraMesh();
  const salvia = v % 2 === 1;
  basal(m, r, 26, salvia ? 0.15 : 0.2, salvia ? 0.04 : 0.065, lod, { lean: [0.25, 1.3], curl: 0.75, col: salvia ? C.leafBlue : C.leaf });
  if (lod === 2) leafMound(m, r, 0.15, salvia ? 0.16 : 0.2);
  const spikes = salvia ? r.int(9, 12) : r.int(3, 5);
  const H = salvia ? r.range(0.4, 0.5) : r.range(0.7, 0.88);
  const face = r.next() * Math.PI * 2;
  for (let s = 0; s < spikes; s++) {
    const d = outward(r, salvia ? 0.4 : 0.22);
    m.skip = lod === 1 && salvia && s % 2 === 1;
    m.on([0, 0, 0], r.next(), () => {
      const L = H * r.range(0.8, 1.05);
      const [tip] = stem(m, r, d, L, lod, 0.03, salvia ? 0.006 : 0.011);
      const sd = norm(tip);
      if (lod === 2) {
        // the spike as a slender cone of bloom, two crossed strips
        const b0 = mul(tip, salvia ? 0.45 : 0.38);
        for (const sd2 of [[Math.cos(s), 0, Math.sin(s)], [-Math.sin(s), 0, Math.cos(s)]] as V3[]) {
          m.blade(b0, sd, L * 0.6, salvia ? 0.04 : 0.09, 0.02, 1, PART.petal, C.petalBase, C.petalTip, { flex0: 0.5, flex1: 0.9, flutter: 0.2, side: sd2, rand: r.next() });
        }
        return;
      }
      if (salvia) {
        // a wand of tiny florets all round the top half of the stem, buds at the tip
        const n = 28;
        for (let k = 0; k < n; k++) {
          const t = k / n, skip = m.skip;
          m.skip = skip || (lod === 1 && k % 2 === 1);
          const at = mul(tip, lerp(0.45, 0.98, t));
          const out: V3 = norm([Math.cos(k * 2.4 + s), 0.45, Math.sin(k * 2.4 + s)]);
          const size = 0.018 * lerp(1.1, 0.55, t) * (lod === 0 ? 1 : 1.4);
          if (t > 0.88) m.ball(add(at, mul(out, size * 0.3)), size * 0.4, C.petalBase, PART.petal, { flex: lerp(0.5, 0.95, t), rand: r.next() });
          else floret(m, add(at, mul(out, size * 0.2)), out, size, { rand: r.next(), flex: clamp(lerp(0.5, 0.95, t), 0, 1), lod });
          m.skip = skip;
        }
        return;
      }
      // foxglove: bells hanging from one side of the spike, smaller and tighter toward its tip, buds above
      const n = 15;
      for (let k = 0; k < n; k++) {
        const t = k / n, skip = m.skip;
        m.skip = skip || (lod === 1 && k % 2 === 1);
        const at = mul(tip, lerp(0.42, 0.9, t));
        const a = face + r.range(-1.3, 1.3);
        const out: V3 = norm([Math.cos(a), -0.75, Math.sin(a)]);
        const Lb = 0.045 * lerp(1.1, 0.7, t) * (lod === 0 ? 1 : 1.25);
        bell(m, add(at, mul([Math.cos(a), 0, Math.sin(a)], 0.008)), out, Lb, Lb * 0.42, { sides: lod === 0 ? 5 : 3, col: (tb) => lerp3(C.petalBase, C.petalTip, tb), flex: clamp(lerp(0.5, 0.95, t), 0, 1), rand: r.next() });
        m.skip = skip;
      }
      for (let k = 0; k < 4; k++) {
        const skip = m.skip;
        m.skip = skip || lod > 0;
        m.ball(add(mul(tip, 0.92 + k * 0.025), [r.range(-0.01, 0.01), 0, r.range(-0.01, 0.01)]), 0.009 - k * 0.0015, C.petalBase, PART.petal, { flex: 0.95, rand: r.next() });
        m.skip = skip;
      }
    });
  }
  m.skip = false;
  return m;
}

const flowerDef = (name: string, about: string, variants: number, grow: SpeciesDef['grow'], size: [number, number]): SpeciesDef => ({
  name, about, variants, grow, lod: FLOWER_LOD, size,
  wind: [1, 1, 1, 3], look: [0.55, 0.45, 0.7, 0.1], yields: 0.9, burn: [0.9, 1, 0.7, 150], shadows: false,
});

export const daisies = flowerDef('daisy', 'daisies: shasta and coreopsis rays, drooping coneflowers, fine asters', 3, daisy, [0.4, 0.6]);
export const lilies = flowerDef('lily', 'lilies over arching straps: open recurved stars and long trumpets', 2, lily, [0.58, 0.85]);
export const tulips = flowerDef('tulip', 'tulips: egg-shaped goblets of six petals over broad blue-green straps', 2, tulip, [0.36, 0.5]);
export const starflowers = flowerDef('starflower', 'a cushion of small stars in drifts (phlox, alyssum) over a mound of leaf', 2, starflower, [0.2, 0.32]);
export const spires = flowerDef('spire', 'spires: foxglove bells hanging from one side, and salvia wands', 2, spire, [0.5, 1.05]);
