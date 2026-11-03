// What the market sells, laid on a counter, a shelf or the ground in the frame of whatever holds it (x along its
// front, z out toward the buyer, y up from what it stands on): spice in heaps on baskets, bolts of cloth and lengths
// of it hung, rugs rolled, pots and jars, glazed bowls, brass trays, lamps that glow at night, fruit in crates. The
// goods are the market's colour, and there are thousands of them, so each is a dozen or two triangles: flat colour
// (MAT.PAINT: the tint is its colour, glowing faintly as a lamp catches it at night) rather than detail.
import type { ArchBuilder } from '../../arch/builder';
import { MAT, type Mat, type V3 } from '../../arch/types';
import type { City } from '../ctx';
import { lanternBody } from '../props';
import type { Rng } from '../rng';
import { CLOTH, DYES, SPICES, block } from './kit';

export const GOODS = ['spice', 'cloth', 'rugs', 'pots', 'bowls', 'brass', 'lamps', 'fruit'] as const;
export type Goods = (typeof GOODS)[number];

/** the fruit's colours (MAT.PAINT): oranges, pomegranates, lemons, figs, melons */
const FRUIT: V3[] = [[1.4, 0.55, 0.12], [1.05, 0.16, 0.18], [1.4, 1.15, 0.25], [0.5, 0.25, 0.42], [0.6, 0.85, 0.3]];
/** brass and copper (tints of MAT.GOLD) */
const BRASS: V3[] = [[1, 1, 1], [1.05, 0.72, 0.5], [0.95, 0.85, 0.6]];
/** the domes' glazes (tints of MAT.DOME): cerulean, turquoise, lapis */
const GLAZE: V3[] = [[1, 1, 1], [1.9, 1.75, 0.95], [0.72, 0.78, 1.08]];
/** the pots' clays (tints of MAT.PLASTER) */
const CLAY: V3[] = [[1, 1, 1], [0.85, 0.7, 0.6], [1.12, 0.98, 0.84]];

/** a heap of spice on a low basket at (x, z) on y: the basket's rim, the cone of colour over it */
export function heap(b: ArchBuilder, x: number, z: number, r: number, y: number, tint: V3) {
  b.cylinder(x, z, r, y, y + 0.12, 5, MAT.WOOD, { top: null });
  b.with({ tint }, () => b.cylinder(x, z, r * 0.94, y + 0.12, y + 0.12 + r * 0.85, 5, MAT.PAINT, { r1: 0.012, top: null }));
}

/** goods along a front from x0 to x1, the front at z (they sit back from it to z - depth), on y: a counter's top, a
 *  shelf, the ground */
export function lay(c: City, kind: Goods, x0: number, x1: number, z: number, depth: number, y: number, rng: Rng, most = 8) {
  const b = c.b, w = x1 - x0, zm = z - depth / 2;
  const each = (pitch: number, fn: (x: number, k: number) => void) => {
    const n = Math.max(1, Math.min(most, Math.floor(w / pitch)));
    for (let k = 0; k < n; k++) fn(x0 + (k + 0.5) * (w / n), k);
  };
  switch (kind) {
    case 'spice':
      each(0.66, (x) => heap(b, x, zm, Math.min(0.31, depth * 0.55), y, rng.pick(SPICES)));
      break;
    case 'cloth':
      // bolts stacked flat, each stack one colour
      each(0.46, (x) => b.with({ tint: rng.pick(DYES) }, () => block(b, x - 0.19, y, zm - depth * 0.38, x + 0.19, y + rng.range(0.14, 0.32), zm + depth * 0.38, MAT.PAINT)));
      break;
    case 'rugs': {
      // rolled rugs lying along the front, one behind another
      const n = Math.max(1, Math.min(3, Math.floor(depth / 0.28)));
      for (let k = 0; k < n; k++) b.with({ tint: rng.pick(CLOTH) }, () => roll(b, x0 + w * 0.04, x1 - w * 0.04, y, z - 0.15 - k * 0.27, 0.12, MAT.CLOTH));
      break;
    }
    case 'pots':
      each(0.42, (x) => {
        const r = rng.range(0.15, 0.23);
        b.with({ tint: rng.pick(CLAY) }, () => b.cylinder(x, zm, r, y, y + r * rng.range(1.5, 2.4), 6, MAT.PLASTER, { r1: r * 0.55, top: MAT.INTERIOR }));
      });
      break;
    case 'bowls':
      // glazed bowls stacked, blue and turquoise
      each(0.4, (x) => b.with({ tint: rng.pick(GLAZE) }, () => b.cylinder(x, zm, 0.08, y, y + 0.07 * rng.int(1, 3), 6, MAT.DOME, { r1: 0.2, top: MAT.POOL })));
      break;
    case 'brass':
      // trays stood on edge along the back, a ewer before each
      each(0.55, (x) => b.with({ tint: rng.pick(BRASS) }, () => {
        tray(b, x, y, z - depth + 0.06, rng.range(0.16, 0.24));
        b.cylinder(x, zm + 0.06, 0.07, y, y + 0.22, 5, MAT.GOLD, { r1: 0.035 });
      }));
      break;
    case 'lamps':
      each(0.5, (x) => lanternBody(c, [x, y + 0.2, zm], 0.12, rng.pick(CLOTH)));
      break;
    case 'fruit':
      each(0.62, (x) => {
        const h = w / Math.max(1, Math.min(most, Math.floor(w / 0.62))) / 2 - 0.04;
        block(b, x - h, y, z - depth + 0.04, x + h, y + 0.2, z - 0.04, MAT.WOOD, ['top']);
        b.with({ tint: rng.pick(FRUIT) }, () => block(b, x - h + 0.03, y + 0.14, z - depth + 0.07, x + h - 0.03, y + 0.27, z - 0.07, MAT.PAINT));
      });
      break;
  }
}

/** the stock on a shelf: a row of boxes and jars, each its own colour, their backs to the wall at z - depth */
export function stock(b: ArchBuilder, x0: number, x1: number, z: number, depth: number, y: number, rng: Rng) {
  const n = Math.max(1, Math.floor((x1 - x0) / 0.7)), w = (x1 - x0) / n;
  for (let k = 0; k < n; k++) {
    const u0 = x0 + k * w + 0.04, u1 = x0 + (k + 1) * w - 0.04;
    b.with({ tint: rng.pick(DYES) }, () => block(b, u0, y, z - depth, u1, y + rng.range(0.18, 0.4), z, MAT.PAINT, ['n']));
  }
}

/** a round tray on its edge at (x, z) on y, facing +z: a thin disc of brass, both its faces */
function tray(b: ArchBuilder, x: number, y: number, z: number, r: number) {
  const P: V3[] = Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2; return [x + Math.cos(a) * r, y + r + Math.sin(a) * r, z] as V3; });
  b.poly(P, MAT.GOLD);
  b.poly([...P].reverse(), MAT.GOLD);
}

/** a roll lying along x from x0 to x1 on y at z (a rolled rug, a bolt): six sides and its ends */
export function roll(b: ArchBuilder, x0: number, x1: number, y: number, z: number, r: number, mat: Mat) {
  const at = (x: number, i: number): V3 => { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; return [x, y + r + Math.cos(a) * r, z + Math.sin(a) * r]; };
  for (let i = 0; i < 6; i++) b.quad(at(x0, i + 1), at(x1, i + 1), at(x1, i), at(x0, i), mat);
  b.poly(Array.from({ length: 6 }, (_, i) => at(x1, i)), mat);
  b.poly(Array.from({ length: 6 }, (_, i) => at(x0, 5 - i)), mat);
}

/** lengths of cloth hung side by side from a rail at y1 down to y0, in a plane z (both faces), from x0 to x1 */
export function hung(b: ArchBuilder, x0: number, x1: number, z: number, y0: number, y1: number, rng: Rng, n?: number) {
  const k = n ?? Math.max(1, Math.round((x1 - x0) / 0.55));
  for (let i = 0; i < k; i++) {
    const u0 = x0 + (i * (x1 - x0)) / k + 0.02, u1 = x0 + ((i + 1) * (x1 - x0)) / k - 0.02, yb = y0 + rng.range(0, 0.4);
    const q: V3[] = [[u0, yb, z], [u1, yb, z], [u1, y1, z], [u0, y1, z]];
    const m = i & 1 ? MAT.PAINT : MAT.CLOTH;
    b.with({ tint: rng.pick(i & 1 ? DYES : CLOTH) }, () => { b.poly(q, m); b.poly([...q].reverse(), m); });
  }
}
