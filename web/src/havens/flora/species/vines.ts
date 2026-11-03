// Bougainvillea spilling over the terraces' retaining walls (the concept has it over every wall): a cushion of bracts
// and leaves over the wall's coping, and curtains of strands hanging down its face, each a rope of magenta bract
// clusters with dark leaves among them, longest in the middle so the curtain's lower edge is scalloped. Its frame:
// the origin on the wall's top outer edge (the coping's top), x along the wall, z out from its face, y up; it hangs
// down to -drop. The scatter strings these along a wall's top line, turned to face out. Each strand swings about where
// it leaves the wall top, more toward its tip, and never into the wall (flora.wgsl).
import { FloraMesh, PART, add, clamp, lerp, lerp3, mul, norm, rng, vary, type Rng, type V3 } from '../mesh';
import { C } from '../palette';
import type { Lod } from './forms';
import type { SpeciesDef } from './def';

/** the drop (m) of each variant's longest strands */
export const VINE_DROPS = [1.6, 2.6, 3.6];
/** the width (m) of one cascade along the wall */
export const VINE_WIDTH = 2.6;

const bractCol = (r: Rng, depth: number): V3 => vary(lerp3([0.66, 0.58, 0.64], [1, 1, 1], Math.pow(depth, 1.2)), r, 0.08, 0.02);

/** a cluster of bracts (and a leaf or two) round `c`, facing mostly out of the wall */
function cluster(m: FloraMesh, r: Rng, c: V3, rad: number, n: number, leaves: number, size: number, flex: number) {
  for (let k = 0; k < n; k++) {
    const dir = norm([r.range(-1, 1), r.range(-0.8, 0.8), r.range(0.1, 1.2)]);
    const depth = r.range(0.25, 1.05);
    const p = add(c, mul(dir, rad * depth));
    const face = norm(add(dir, [r.range(-0.5, 0.5), r.range(-0.3, 0.5), r.range(0, 0.6)]));
    m.flake(p, face, size * r.range(0.75, 1.2), bractCol(r, depth), PART.bract, { bent: norm(add(dir, [0, 0.2, 0.6])), bend: 0.6, ao: lerp(0.55, 1, depth), flex, flutter: 1, rand: r.next(), spin: r.next() * 3 });
  }
  for (let k = 0; k < leaves; k++) {
    const dir = norm([r.range(-1, 1), r.range(-0.6, 0.6), r.range(-0.2, 1)]);
    const p = add(c, mul(dir, rad * r.range(0.4, 0.95)));
    m.diamond(p, norm(add(dir, [0, -0.4, 0])), norm(add(dir, [0, 0.3, 0.4])), size * 1.3, size * 0.75, vary(C.bougLeaf, r, 0.12, 0.02), PART.leaf, { at: 0.45, lift: 0.1, ao: 0.75, flex, flutter: 0.8, rand: r.next() });
  }
}

function bougainvillea(seed: number, lod: Lod, v: number): FloraMesh {
  const r = rng(seed);
  const m = new FloraMesh();
  const D = VINE_DROPS[v % VINE_DROPS.length], W = VINE_WIDTH;
  // the cushion over the coping: overlapping puffs along the wall, tapering at its ends
  const puffs = 4;
  for (let k = 0; k < puffs; k++) {
    const t = (k + r.range(0.25, 0.75)) / puffs, x = -W / 2 + W * t;
    const end = Math.sin(Math.PI * t);
    const c: V3 = [x, 0.03 + 0.05 * end, r.range(-0.18, 0)];
    const rad = r.range(0.24, 0.36) * (0.6 + 0.4 * end);
    m.on([x, 0, 0], r.next(), () => {
      if (lod === 2) { m.mass(c, rad * 1.1, rad * 0.6, rad * 1.1, PART.bract, (n) => bractCol(r, 0.6 + 0.4 * n[1]), r, { rings: 3, segs: 6, lump: 0.25, flex: 0.15, ao: [0.6, 1] }); return; }
      if (lod === 0) cluster(m, r, add(c, [0, rad * 0.05, 0]), rad, 46, 12, 0.1, 0.2);
      else {
        m.mass(c, rad * 0.8, rad * 0.38, rad * 0.8, PART.bract, (n) => bractCol(r, 0.45 + 0.4 * n[1]), r, { rings: 3, segs: 5, lump: 0.3, flex: 0.15, ao: [0.45, 0.9] });
        cluster(m, r, add(c, [0, rad * 0.1, 0]), rad, 9, 3, 0.15, 0.2);
      }
    });
  }
  // the strands: from the wall's top edge, out over it and down its face
  const strands = lod === 0 ? 11 : lod === 1 ? 8 : 5;
  for (let s = 0; s < strands; s++) {
    const x0 = -W / 2 + W * (s + r.range(0.25, 0.75)) / strands;
    const centre = 1 - Math.pow(Math.abs(x0) / (W / 2), 1.6);
    const L = D * (0.45 + 0.55 * centre) * r.range(0.78, 1.08);
    const top: V3 = [x0, 0.05, 0.04];
    const sway = r.range(-0.25, 0.25), bulge = r.range(0.1, 0.24);
    const at = (t: number): V3 => [x0 + sway * t * t + 0.05 * Math.sin(t * 7 + s), 0.05 - L * t, 0.06 + bulge * Math.sin(Math.PI * Math.min(1, t * 1.3)) * (1 - 0.4 * t) + 0.04 * t];
    m.on(top, r.next(), () => {
      if (lod === 2) {
        // the strand as a hanging tongue of bloom
        const c = at(0.5);
        m.mass(c, 0.22, L * 0.52, 0.12, PART.bract, (n) => bractCol(r, 0.65 + 0.3 * n[2]), r, { rings: 4, segs: 5, lump: 0.2, flex: 0.5, flutter: 0.3, ao: [0.6, 1], lean: 0 });
        return;
      }
      const step = lod === 0 ? 0.14 : 0.26;
      const n = Math.max(2, Math.round(L / step));
      // the strand's body: a lumpy rope of bloom, thick at the wall's top and thinning to its tip (its bracts and
      // leaves over it make it read as clusters)
      const pts = Array.from({ length: n + 1 }, (_, k) => at(k / n));
      // (the rope in the bracts' own shade, the depth between them; at the light level thicker, the strand's body)
      const thick = lod === 0 ? 1 : 2.2;
      const radii = pts.map((_, k) => lerp(0.06, 0.025, k / n) * thick * r.range(0.7, 1.25) * (k === n ? 0.4 : 1));
      m.tube(pts, radii, lod === 0 ? 5 : 4, PART.bract, () => bractCol(r, lod === 0 ? 0.3 : 0.55), (k) => lerp(0.6, 0.85, k / n), (k) => clamp(k / n, 0.05, 1), { cap: true, flutter: 0.2 });
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const rad = lerp(0.2, 0.1, t) * r.range(0.8, 1.15);
        cluster(m, r, pts[k], rad, lod === 0 ? Math.round(lerp(8, 5, t)) : 4, lod === 0 ? (r.next() < 0.5 ? 3 : 2) : 1, (lod === 0 ? 0.11 : 0.16) * lerp(1.1, 0.8, t), clamp(t, 0.05, 1));
      }
    });
  }
  return m;
}

export const bougainvilleas: SpeciesDef = {
  name: 'bougainvillea', about: 'bougainvillea over a wall top: a cushion on the coping, curtains of magenta strands down its face',
  variants: 3, grow: bougainvillea, hangs: true,
  lod: [30, 110, 1600], size: [1.6, 3.6], blooms: ['#c2378a', '#d6479b', '#b02c7c', '#cf3f93', '#e05aa8'],
  wind: [0.5, 0.8, 1, 3], look: [0.5, 0.45, 0.75, 0.1], yields: 0.3, burn: [0.8, 0.7, 0.45, 600], shadows: true,
};
