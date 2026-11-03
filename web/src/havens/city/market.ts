// The market west of the plaza (ref 2, the night concept): its square paved inside an octagon of shopfronts, an open
// domed pavilion with a fountain at its heart, and round it rows of stalls back to back along aisles. Each stall has a
// counter, posts and a striped awning (MAT.CLOTH in orange, teal, cream, red, violet) and sells one thing: cloth hung
// on rails, mounds of spice, pots, fruit in crates, rugs, lamps. Crates and rolled rugs are stacked between them, a few
// tall peaked tents stand among them, and lanterns hang from the awnings and on strings across the aisles.
import type { V3 } from '../arch/types';
import { MAT } from '../arch/types';
import { FLOOR_Y, type V2 } from '../world/layout';
import type { City, Collide } from './ctx';
import { Face } from './facade';
import { FLOOR, lampPost } from './ground';
import { inside } from './geom';
import { MARKET_SQUARE } from './plan';
import { CLOTHS, dome, lanternBody, lanternString } from './props';
import { Rng } from './rng';

const GOODS = ['cloth', 'spice', 'pots', 'fruit', 'rugs', 'lamps'] as const;
type Goods = (typeof GOODS)[number];
const RICH: V3[] = [[1.1, 0.25, 0.22], [0.7, 0.3, 0.75], [0.3, 0.75, 0.75], [1.15, 0.75, 0.25], [0.35, 0.45, 1.0], [1.1, 1.0, 0.85]];

export function buildMarket(c: City, seed: number) {
  const b = c.b, rng = new Rng(seed);
  const M = MARKET_SQUARE;
  b.group(() => {
    b.at(M.x, FLOOR_Y, M.z);
    const col = c.collide('city/market');
    // the octagon the plan cut out, in local coordinates
    const oct: V2[] = Array.from({ length: 8 }, (_, i) => [Math.cos((i / 8) * Math.PI * 2) * M.rx, Math.sin((i / 8) * Math.PI * 2) * M.rz] as V2);
    // (a centimetre over the plaza's paving, which reaches into the octagon's east end)
    b.with({ tint: [1.02, 0.94, 0.86] }, () => b.slab(oct, FLOOR.square + 0.01, MAT.PAVING));
    b.with({ tint: [0.88, 0.66, 0.54] }, () => b.slab(oct.map(([x, z]) => [x * 0.22, z * 0.3] as V2), FLOOR.square + 0.022, MAT.PAVING));
    pavilion(c, col);
    // rows of stalls inside the octagon shrunk by the walk along the shopfronts, clear of the pavilion and the cross
    // aisles; each row two stalls back to back
    const inner = oct.map(([x, z]) => [x * 0.84, z * 0.8] as V2);
    const depth = 2.8, aisle = 6.5, pitch = 2 * depth + aisle, sw = 3.3;
    const rows: number[] = [];
    for (let z = -M.rz; z <= M.rz; z += pitch) rows.push(z);
    let n = 0;
    for (const zr of rows) {
      for (let x = -M.rx; x <= M.rx; x += sw) {
        // cross aisles every 6 stalls and the main ones through the middle
        const slot = Math.round((x + M.rx) / sw);
        if (slot % 7 === 6 || Math.abs(x) < 9 || Math.abs(zr + depth) < 7) continue;
        if (Math.hypot(x / 26, (zr + depth) / 22) < 1) continue;
        for (const side of [-1, 1] as const) {
          const zc = zr + depth + side * depth / 2;
          const corners: V2[] = [[x - sw / 2, zc - depth / 2], [x + sw / 2, zc - depth / 2], [x + sw / 2, zc + depth / 2], [x - sw / 2, zc + depth / 2]];
          if (!corners.every((p) => inside(p, inner))) continue;
          if (rng.chance(0.08)) continue;
          stall(c, col, x, zc, sw - 0.15, depth, side, rng.pick(GOODS), rng, n++);
        }
      }
      // a lantern string over the aisle in front of this row now and then
      for (let x = -M.rx * 0.7; x < M.rx * 0.7; x += rng.range(14, 22)) {
        const za = zr - aisle / 2 + 0.2;
        const a: V2 = [x, za - aisle / 2 + 0.4], z: V2 = [x + rng.range(-3, 3), za + aisle / 2 - 0.4];
        if (!inside(a, inner) || !inside(z, inner) || Math.hypot(x / 26, za / 22) < 1.2) continue;
        for (const p of [a, z]) { b.cylinder(p[0], p[1], 0.07, FLOOR.square, 4.6, 5, MAT.WOOD); col.solid(p[0] - 0.1, p[1] - 0.1, p[0] + 0.1, p[1] + 0.1, 0, 4.6); }
        lanternString(c, [a[0], 4.4, a[1]], [z[0], 4.4, z[1]], 0.5, 1.3, [CLOTHS[0], CLOTHS[3], CLOTHS[5]], 4);
      }
    }
    // a few tall peaked tents
    for (let k = 0; k < 7; k++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(0.45, 0.7);
      const p: V2 = [Math.cos(a) * M.rx * r, Math.sin(a) * M.rz * r];
      if (Math.abs(p[0]) < 12 || Math.abs(p[1]) < 10) continue;
      tent(c, col, p[0], p[1], rng.range(3.2, 4.6), rng);
    }
    for (const [x, z] of [[-30, -16], [30, -16], [-30, 16], [30, 16], [0, -40], [0, 40], [-62, 0], [62, 0]]) lampPost(c, col, x, z, 4.4, FLOOR.square);
  });
}

/** one stall at (x, zc) (local), its front toward `side` (z), selling `goods` */
function stall(c: City, col: Collide, x: number, zc: number, w: number, d: number, side: 1 | -1, goods: Goods, rng: Rng, n: number) {
  const b = c.b, y = FLOOR.square;
  const zf = zc + (side * d) / 2, zb = zc - (side * d) / 2;
  const x0 = x - w / 2, x1 = x + w / 2;
  // the counter along the front
  const cz0 = zf - side * 0.75, cz1 = zf;
  b.box(x0 + 0.1, y, Math.min(cz0, cz1), x1 - 0.1, y + 0.95, Math.max(cz0, cz1), MAT.WOOD, { skip: ['bottom'] });
  col.solid(x0 + 0.1, Math.min(cz0, cz1), x1 - 0.1, Math.max(cz0, cz1), 0, 0.95);
  // posts and the awning sloping toward the aisle
  const hb = 2.75, hf = 2.3, over = 0.9 * side;
  for (const px of [x0 + 0.08, x1 - 0.08]) {
    b.box(px - 0.06, y, zb - 0.06, px + 0.06, y + hb, zb + 0.06, MAT.WOOD, { skip: ['bottom'] });
    b.box(px - 0.06, y, zf - 0.06, px + 0.06, y + hf, zf + 0.06, MAT.WOOD, { skip: ['bottom'] });
  }
  const tint = CLOTHS[(n * 7 + rng.int(0, 6)) % CLOTHS.length];
  b.with({ tint }, () => {
    const a0: V3 = [x0 - 0.1, y + hb, zb], a1: V3 = [x1 + 0.1, y + hb, zb], f1: V3 = [x1 + 0.1, y + hf - 0.15, zf + over], f0: V3 = [x0 - 0.1, y + hf - 0.15, zf + over];
    const top = side > 0 ? [a0, a1, f1, f0] : [f0, f1, a1, a0];
    b.poly(top.reverse(), MAT.CLOTH);
    b.poly(side > 0 ? [a0, a1, f1, f0] : [f0, f1, a1, a0], MAT.CLOTH);
    // a scalloped valance at the front
    const v0: V3 = [f0[0], f0[1] - 0.35, f0[2]], v1: V3 = [f1[0], f1[1] - 0.35, f1[2]];
    b.poly(side > 0 ? [v0, v1, f1, f0] : [f0, f1, v1, v0], MAT.CLOTH);
    b.poly(side > 0 ? [f0, f1, v1, v0] : [v0, v1, f1, f0], MAT.CLOTH);
  });
  // a back cloth closing the stall
  b.with({ tint: [tint[0] * 0.8, tint[1] * 0.8, tint[2] * 0.8] }, () => {
    const q: V3[] = [[x0, y, zb], [x1, y, zb], [x1, y + hb, zb], [x0, y + hb, zb]];
    b.poly(side > 0 ? q.reverse() : q, MAT.CLOTH);
  });
  // the goods
  const top = y + 0.95, mid = (Math.min(cz0, cz1) + Math.max(cz0, cz1)) / 2;
  switch (goods) {
    case 'spice':
      for (let k = 0; k < 4; k++) {
        const px = x0 + 0.5 + k * (w - 1) / 3, t = rng.pick<V3>([[1.3, 0.35, 0.15], [1.4, 0.9, 0.2], [0.9, 0.5, 0.2], [1.2, 0.6, 0.3]]);
        b.cylinder(px, mid, 0.32, top, top + 0.12, 8, MAT.WOOD, { top: null });
        b.with({ tint: t }, () => b.cylinder(px, mid, 0.3, top + 0.12, top + 0.42, 8, MAT.CLOTH, { r1: 0.02 }));
      }
      break;
    case 'pots':
      for (let k = 0; k < 5; k++) {
        const px = x0 + 0.4 + k * (w - 0.8) / 4, r = rng.range(0.15, 0.26);
        b.cylinder(px, mid, r, top, top + r * 2.2, 8, MAT.PLASTER, { r1: r * 0.6 });
      }
      for (let k = 0; k < 3; k++) { const px = x0 + 0.5 + k * 0.9; b.cylinder(px, zf + side * 0.5, 0.3, y, y + 0.7, 8, MAT.PLASTER, { r1: 0.2 }); }
      break;
    case 'fruit':
      for (let k = 0; k < 3; k++) {
        const px = x0 + 0.3 + k * (w - 0.6) / 3, t = rng.pick<V3>([[1.2, 0.5, 0.15], [0.6, 1.3, 0.3], [1.4, 1.1, 0.25], [1.2, 0.25, 0.2]]);
        b.box(px, top, mid - 0.3, px + (w - 0.6) / 3 - 0.08, top + 0.22, mid + 0.3, MAT.WOOD, { top: MAT.CLOTH, skip: ['bottom'] });
        b.with({ tint: t }, () => b.box(px + 0.04, top + 0.22, mid - 0.26, px + (w - 0.6) / 3 - 0.12, top + 0.3, mid + 0.26, MAT.CLOTH, { skip: ['bottom'] }));
      }
      break;
    case 'cloth':
    case 'rugs': {
      // a rail across the stall's middle with lengths of cloth hanging from it
      const rz = zc;
      b.box(x0 + 0.1, y + 2.1, rz - 0.03, x1 - 0.1, y + 2.16, rz + 0.03, MAT.WOOD);
      const k = goods === 'rugs' ? 3 : 4;
      for (let i = 0; i < k; i++) {
        const u0 = x0 + 0.2 + (i * (w - 0.4)) / k, u1 = u0 + (w - 0.4) / k - 0.08, t = rng.pick(RICH);
        const yb = goods === 'rugs' ? y + 0.3 : y + 0.9;
        b.with({ tint: t }, () => {
          const q: V3[] = [[u0, yb, rz], [u1, yb, rz], [u1, y + 2.1, rz], [u0, y + 2.1, rz]];
          b.poly(q, MAT.CLOTH);
          b.poly([...q].reverse(), MAT.CLOTH);
        });
      }
      if (goods === 'rugs') for (let i = 0; i < 3; i++) b.with({ tint: rng.pick(RICH) }, () => b.cylinder(x0 + 0.5 + i * 0.75, zf + side * 0.6, 0.18, y, y + 1.6, 6, MAT.CLOTH));
      break;
    }
    case 'lamps':
      for (let i = 0; i < 4; i++) lanternBody(c, [x0 + 0.45 + (i * (w - 0.9)) / 3, y + hf - 0.55, zf + side * 0.35], 0.14, rng.pick(CLOTHS));
      c.light([x, y + 2.0, zf + side * 0.6], 50, { radius: 7 });
      break;
  }
  // crates now and then beside the stall, a hanging lantern on every third
  if (rng.chance(0.35)) {
    const cx = side > 0 ? x1 - 0.5 : x0 + 0.5, cz = zf + side * 0.75;
    b.box(cx - 0.35, y, cz - 0.3, cx + 0.35, y + 0.55, cz + 0.3, MAT.WOOD, { skip: ['bottom'] });
    if (rng.chance(0.5)) b.box(cx - 0.3, y + 0.55, cz - 0.25, cx + 0.25, y + 1.0, cz + 0.25, MAT.WOOD, { skip: ['bottom'] });
    col.solid(cx - 0.35, cz - 0.3, cx + 0.35, cz + 0.3, 0, 0.55);
  }
  if (n % 3 === 0 && goods !== 'lamps') {
    lanternBody(c, [x, y + hf - 0.6, zf + side * 0.45], 0.16, CLOTHS[n % 2 ? 0 : 3]);
    if (n % 6 === 0) c.light([x, y + hf - 0.8, zf + side * 0.7], 45, { radius: 7 });
  }
}

/** a tall peaked tent on four posts, its cloth roof a pyramid, open at the sides */
function tent(c: City, col: Collide, x: number, z: number, s: number, rng: Rng) {
  const b = c.b, y = FLOOR.square, h = 2.6, peak = 5.4;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { b.box(x + sx * s - 0.08, y, z + sz * s - 0.08, x + sx * s + 0.08, y + h, z + sz * s + 0.08, MAT.WOOD, { skip: ['bottom'] }); col.solid(x + sx * s - 0.12, z + sz * s - 0.12, x + sx * s + 0.12, z + sz * s + 0.12, 0, h); }
  b.cylinder(x, z, 0.06, y, y + peak, 5, MAT.WOOD);
  b.with({ tint: rng.pick(CLOTHS) }, () => {
    b.cylinder(x, z, (s + 0.3) * Math.SQRT2, y + h, y + peak, 4, MAT.CLOTH, { r1: 0.05, top: null, bottom: true });
    b.cylinder(x, z, (s + 0.3) * Math.SQRT2, y + h - 0.45, y + h, 4, MAT.CLOTH, { top: null });
  });
  // a rug on the ground and a lamp hanging inside
  b.with({ tint: rng.pick(RICH) }, () => b.box(x - s * 0.7, y, z - s * 0.5, x + s * 0.7, y + 0.03, z + s * 0.5, MAT.CLOTH, { skip: ['bottom'] }));
  lanternBody(c, [x, y + h - 0.3, z], 0.2);
  c.light([x, y + h - 0.5, z], 60, { radius: 8 });
}

/** the open pavilion at the market's heart: eight columns under a ring beam and a blue dome, a fountain beneath */
function pavilion(c: City, col: Collide) {
  const b = c.b, y = FLOOR.square, r = 9, h = 7.5;
  b.cylinder(0, 0, r + 1.6, y, y + 0.45, 16, MAT.ASHLAR, { top: MAT.CREAM });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8, px = Math.cos(a) * r, pz = Math.sin(a) * r;
    b.cylinder(px, pz, 0.55, y + 0.45, y + h, 10, MAT.CREAM, { top: null });
    b.box(px - 0.75, y + h, pz - 0.75, px + 0.75, y + h + 0.5, pz + 0.75, MAT.CREAM);
    col.solid(px - 0.55, pz - 0.55, px + 0.55, pz + 0.55, 0, y + h);
  }
  // arches between the columns as a deep band, then the drum and dome
  b.cylinder(0, 0, r + 0.9, y + h + 0.5, y + h + 2.6, 8, MAT.PLASTER_WARM, { top: MAT.PAVING, bottom: true });
  for (let k = 0; k < 8; k++) {
    const a0 = (k / 8) * Math.PI * 2, a1 = a0 + Math.PI / 4, R = r + 0.9;
    const f = new Face(b, [Math.cos(a1) * R, Math.sin(a1) * R], [Math.cos(a0) * R, Math.sin(a0) * R], y + h + 0.5, 2.1);
    f.box(0.3, 0.6, f.len - 0.3, 1.5, -0.1, 0, MAT.TEAL);
  }
  dome(c, 0, y + h + 2.6, 0, r * 0.82, { drum: 1.4, bulge: 1.12, tip: 0.55, rise: r, finial: true });
  // the fountain under it
  b.cylinder(0, 0, 3.4, y + 0.45, y + 1.0, 12, MAT.CREAM, { top: MAT.CREAM });
  b.cylinder(0, 0, 2.9, y + 0.5, y + 1.0, 12, MAT.POOL, { top: null });
  b.cylinder(0, 0, 0.3, y + 0.5, y + 2.3, 8, MAT.CREAM, { r1: 0.2, top: null });
  b.cylinder(0, 0, 0.2, y + 2.3, y + 2.5, 10, MAT.CREAM, { r1: 0.9, top: MAT.POOL });
  c.pool(Array.from({ length: 12 }, (_, i) => [Math.cos((i / 12) * Math.PI * 2) * 2.9, Math.sin((i / 12) * Math.PI * 2) * 2.9] as V2), y + 0.88, 0.38);
  col.solid(-3.4, -3.4, 3.4, 3.4, 0, y + 1.0).floor(-r - 1, -r - 1, r + 1, r + 1, y + h + 2.6);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    lanternBody(c, [Math.cos(a) * (r - 1.2), y + h - 0.6, Math.sin(a) * (r - 1.2)], 0.22);
  }
  c.light([0, y + h - 1.5, 0], 220, { radius: 16 });
}
