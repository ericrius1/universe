// The gardens' small trees: the blossom tree (cherry or almond: a dark twisting trunk splitting into spreading limbs
// under clouds of pink or white bloom, the concept's), the olive (a gnarled trunk, an open crown of narrow silver-green
// leaves) and the pomegranate (a shrubby many-stemmed tree, glossy dark leaves, scarlet flowers and red fruit). Each
// grows a skeleton (forms.ts growTree), then dresses each of its branch ends in a puff of flakes; the light levels make
// each puff a soft blob with a few flakes, then the crown a handful of big blobs over the trunk and limbs. Every puff
// swings with its limb.
import { FloraMesh, PART, add, clamp, hash, lerp, lerp3, mul, norm, rng, vary, type Part, type Rng, type V3 } from '../mesh';
import { BLOSSOM, C } from '../palette';
import { barkTubes, growTree, puff, type Limb, type Lod, type TreeShape } from './forms';
import type { SpeciesDef } from './def';

interface Dress {
  puffR: [number, number]; flat: number; flakes: number; size: number; part: Part; diamond?: boolean; long?: number;
  col: (r: Rng, n: V3, depth: number) => V3;
  /** fresh leaves among the blossom (a share of the flakes), in this colour */
  leaves?: [number, V3];
  bark: [V3, V3];
}

/** the light levels' blobs are a solid surface where the full crown is a cloud of flakes seen through: shaded down to
 *  match its depth from afar */
const LIGHT = 0.8;

/** a small tree: its skeleton, its bark, and its puffs at every branch end (or, light, its blobs) */
function smallTree(seed: number, lod: Lod, S: TreeShape, D: Dress, extra?: (m: FloraMesh, r: Rng, tips: { p: V3; d: V3; limb: Limb }[], lod: Lod) => void): FloraMesh {
  const { limbs, tips } = growTree(S, rng(seed));
  const r = rng(hash(seed, 99, lod));
  const m = new FloraMesh();
  barkTubes(m, limbs, S.height, lod, D.bark[0], D.bark[1]);
  const crown: V3 = tips.reduce((a, t) => add(a, mul(t.p, 1 / tips.length)), [0, 0, 0] as V3);
  if (lod === 2) {
    // the crown as a few big blobs, one per main limb (its tips' centre, wide enough to hold them)
    const groups = new Map<Limb, V3[]>();
    for (const t of tips) {
      const main = limbs[t.limb.root];
      groups.set(main, [...(groups.get(main) ?? []), t.p]);
    }
    for (const [limb, pts] of groups) {
      const c = pts.reduce((a, p) => add(a, mul(p, 1 / pts.length)), [0, 0, 0] as V3);
      const spread = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[2] - c[2]))) + D.puffR[1] * 0.8;
      const up = Math.max(...pts.map((p) => Math.abs(p[1] - c[1]))) + D.puffR[1] * D.flat;
      m.on(limb.pivot, limb.phase, () => m.mass(add(c, [0, up * 0.15, 0]), spread * 0.95, up * 1.05, spread * 0.95, D.part === PART.petal ? PART.petal : PART.mass, (n) => mul(D.col(r, n, 0.5 + 0.25 * n[1]), LIGHT), r, { rings: 4, segs: 7, lump: 0.25, flex: 0.5, flutter: 0.3, ao: [0.5, 0.95], lean: 0.25 }));
    }
    extra?.(m, r, tips, lod);
    return m;
  }
  for (const t of tips) {
    const rad = lerp(D.puffR[0], D.puffR[1], r.next()) * clamp(0.75 + 0.35 * t.limb.depth / Math.max(1, S.forks + 1), 0.7, 1.15);
    const c = add(t.p, mul(t.d, rad * 0.35));
    const flex = clamp(t.limb.flex[t.limb.flex.length - 1] + 0.1, 0, 1);
    m.on(t.limb.pivot, t.limb.phase, () => {
      if (lod === 1) {
        m.mass(c, rad * 0.82, rad * D.flat * 0.85, rad * 0.82, D.part === PART.petal ? PART.petal : PART.mass, (n) => mul(D.col(r, n, 0.45 + 0.35 * (0.5 + 0.5 * n[1])), LIGHT), r, { rings: 3, segs: 6, lump: 0.3, flex, flutter: 0.4, ao: [0.45, 0.95], lean: 0.25 });
        puff(m, c, rad, rad * D.flat, Math.round(D.flakes * 0.15), D.size * 1.7, D.part, D.col, r, { crown, flex, long: D.long, diamond: D.diamond, aoIn: 0.6 });
        return;
      }
      // (bloom as clusters of small blobs frilled with petals; leaves as a soft core under a shell of leaves)
      if (D.part === PART.petal) puff(m, c, rad, rad * D.flat, D.flakes, D.size, D.part, D.col, r, { crown, flex, aoIn: 0.5, shell: [0.35, 1.05] });
      else puff(m, c, rad, rad * D.flat, D.flakes, D.size, D.part, D.col, r, { crown, flex, long: D.long, diamond: D.diamond, aoIn: 0.45, core: { part: PART.mass, segs: 8 } });
      if (D.leaves) puff(m, c, rad * 0.95, rad * D.flat, Math.round(D.flakes * D.leaves[0]), D.size * 1.1, PART.leaf, (rr) => vary(D.leaves![1], rr, 0.12, 0.02), r, { crown, flex, long: 1.6, diamond: true, aoIn: 0.5 });
    });
  }
  extra?.(m, r, tips, lod);
  return m;
}

// ------------------------------------------------------------------ the blossom tree
const BLOSSOM_SHAPE: TreeShape = { height: 4.5, trunkH: 0.95, trunkR: 0.16, limbs: [3, 4], spread: 1.0, limbLen: 1.9, forks: 2, shorten: 0.7, droop: 0.3, upturn: 0.15, wander: 0.4, twist: 0.5 };
function blossom(seed: number, lod: Lod, v: number): FloraMesh {
  const S = { ...BLOSSOM_SHAPE, limbLen: v % 2 === 1 ? 1.6 : 1.95, spread: v % 2 === 1 ? 0.85 : 1.05 };
  return smallTree(seed, lod, S, {
    puffR: [0.6, 0.9], flat: 0.58, flakes: 150, size: 0.14, part: PART.petal, diamond: false,
    // (the bloom's own shading: pale and bright outside, deeper toward the puff's heart; a few deeper accents)
    col: (r, _n, depth) => r.next() < 0.12 ? mul(C.petalBase, 0.85) : vary(lerp3([0.72, 0.62, 0.66], C.petalTip, Math.pow(depth, 1.5)), r, 0.06, 0.01),
    leaves: [0.1, C.leafYellow], bark: [C.barkBlossom, C.barkBlossomLight],
  });
}

// ------------------------------------------------------------------ the olive
function olive(seed: number, lod: Lod, v: number): FloraMesh {
  const S: TreeShape = { height: 4, trunkH: 0.9, trunkR: 0.2, stems: v % 2 === 1 ? 2 : 1, limbs: v % 2 === 1 ? [2, 3] : [3, 4], spread: 0.85, limbLen: 1.35, forks: 2, shorten: 0.68, droop: 0.25, upturn: 0.2, wander: 0.5, twist: 0.8 };
  return smallTree(seed, lod, S, {
    puffR: [0.4, 0.58], flat: 0.7, flakes: 54, size: 0.13, part: PART.leaf, diamond: true,
    col: (r, _n, depth) => vary(r.next() < 0.4 ? C.oliveSilver : lerp3(mul(C.olive, 0.7), C.olive, depth), r, 0.08, 0.015),
    bark: [C.barkOlive, C.barkOliveLight],
  });
}

// ------------------------------------------------------------------ the pomegranate
function pomegranate(seed: number, lod: Lod, v: number): FloraMesh {
  const S: TreeShape = { height: 3, trunkH: 0.45, trunkR: 0.11, stems: v % 2 === 1 ? 4 : 3, limbs: [1, 2], spread: 0.55, limbLen: 1.1, forks: 1, shorten: 0.7, droop: 0.3, upturn: 0.35, wander: 0.4, twist: 0.4 };
  return smallTree(seed, lod, S, {
    puffR: [0.38, 0.52], flat: 0.75, flakes: 56, size: 0.11, part: PART.leaf, diamond: true,
    col: (r, _n, depth) => vary(lerp3(C.leafDeep, C.pom, 0.4 + 0.6 * depth), r, 0.1, 0.015),
    bark: [C.barkPom, C.barkPom],
  }, (m, r, tips, lod) => {
    if (lod === 2) return;
    // scarlet flowers on the puffs' tops, red fruit hanging under them
    tips.forEach((t, i) => m.on(t.limb.pivot, t.limb.phase, () => {
      const flex = clamp(t.limb.flex[t.limb.flex.length - 1] + 0.1, 0, 1);
      for (let k = 0; k < (lod === 0 ? 3 : 1); k++) {
        const n = norm([r.range(-1, 1), r.range(0.2, 1), r.range(-1, 1)]);
        m.flake(add(t.p, mul(n, 0.36)), n, 0.07 * (lod === 0 ? 1 : 1.5), C.petalTip, PART.petal, { flex, flutter: 0.5, rand: r.next() });
      }
      if (i % 2 === 0) m.ball(add(t.p, [r.range(-0.15, 0.15), -0.3, r.range(-0.15, 0.15)]), 0.045, C.pomFruit, PART.fruit, { flex, rand: r.next() });
    }));
  });
}

export const blossoms: SpeciesDef = {
  name: 'blossom', about: 'the blossom tree (cherry, almond): a dark twisting trunk under clouds of pink or white bloom', variants: 2, grow: blossom,
  lod: [35, 140, 2000], size: [4.2, 6], blooms: [...BLOSSOM.pink, ...BLOSSOM.white],
  wind: [0.4, 0.8, 0.8, 2.5], look: [0.5, 0.45, 0.75, 0.1], yields: 0.05, burn: [0.7, 0.8, 0.3, 900], shadows: true,
};
export const olives: SpeciesDef = {
  name: 'olive', about: 'the olive: a gnarled trunk, an open crown of narrow silver-green leaves', variants: 2, grow: olive,
  lod: [35, 140, 2000], size: [3.2, 4.8], blooms: ['#ffffff'],
  wind: [0.3, 0.7, 1, 3], look: [0.35, 0.45, 0.75, 0.15], yields: 0.05, burn: [0.6, 0.6, 0.3, 900], shadows: true,
};
export const pomegranates: SpeciesDef = {
  name: 'pomegranate', about: 'the pomegranate: many stems, glossy dark leaves, scarlet flowers and red fruit', variants: 2, grow: pomegranate,
  lod: [30, 120, 1500], size: [2.4, 3.6], blooms: ['#e2452f', '#ea5a32', '#d93a2a'],
  wind: [0.35, 0.8, 0.9, 3], look: [0.3, 0.4, 0.75, 0.35], yields: 0.15, burn: [0.6, 0.7, 0.35, 700], shadows: true,
};
