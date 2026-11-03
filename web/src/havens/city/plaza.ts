// The city's open heart and its ways: the plaza (patterned paving in rings and rays round a great tiered fountain in a
// round basin, four flower parterres, palms, benches and lamps, red pillars marking the avenue's mouth), the avenue as a
// palm boulevard from the plaza to the south gate, the boulevards east to the palace and west to the market, the
// processional way behind the grand hall lined with cypress and lamps up to the stair's square, and the squares inside
// the gate and at the stair's foot.
import type { Mat, V3 } from '../arch/types';
import { MAT } from '../arch/types';
import { AVENUE, FLOOR_Y, PLAZA, STAIR, type V2 } from '../world/layout';
import type { City, Collide } from './ctx';
import { ngon } from './geom';
import { FLOOR, lampPost } from './ground';
import { GATE_SQUARE, HALL_CLOSE, PALACE_CLOSE, STAIR_SQUARE } from './plan';
import { brazier, lanternString, planter, rectPts } from './props';

const PAVE: V3 = [1.08, 1.02, 0.95];
const BAND: V3 = [0.92, 0.62, 0.5];
const DARK: V3 = [0.78, 0.55, 0.48];

export function buildPlaza(c: City) {
  const b = c.b;
  b.group(() => {
    b.at(PLAZA.x, FLOOR_Y, PLAZA.z);
    const col = c.collide('city/plaza');
    const y = FLOOR.square;
    b.with({ tint: PAVE }, () => b.slab(ngon(0, 0, 92, 48), y, MAT.PAVING));
    // rings and rays in the paving
    const ringBand = (r0: number, r1: number, tint: V3, n = 48) => b.with({ tint }, () => {
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        b.quad([Math.cos(a1) * r0, y + 0.012, Math.sin(a1) * r0], [Math.cos(a1) * r1, y + 0.012, Math.sin(a1) * r1], [Math.cos(a0) * r1, y + 0.012, Math.sin(a0) * r1], [Math.cos(a0) * r0, y + 0.012, Math.sin(a0) * r0], MAT.PAVING);
      }
    });
    ringBand(15, 16.6, BAND);
    ringBand(37, 38.2, BAND);
    ringBand(PLAZA.r - 1.6, PLAZA.r, BAND, 64);
    b.with({ tint: DARK }, () => {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, w = 0.45, ca = Math.cos(a), sa = Math.sin(a);
        const p = (r: number, s: number): V3 => [ca * r - sa * s, y + 0.014, sa * r + ca * s];
        b.quad(p(16.6, w), p(PLAZA.r - 1.6, w), p(PLAZA.r - 1.6, -w), p(16.6, -w), MAT.PAVING);
      }
    });
    // an eight-pointed star round the basin
    b.with({ tint: BAND }, () => {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, da = Math.PI / 8;
        b.poly([[Math.cos(a - da) * 13.4, y + 0.016, Math.sin(a - da) * 13.4], [Math.cos(a) * 15, y + 0.016, Math.sin(a) * 15], [Math.cos(a + da) * 13.4, y + 0.016, Math.sin(a + da) * 13.4]].reverse() as V3[], MAT.PAVING);
      }
    });
    fountain(c, col, y);
    // four parterres between the rays, palms round them, benches and lamps
    for (let q = 0; q < 4; q++) {
      const a0 = (q / 4) * Math.PI * 2 + Math.PI / 4 - 0.42, a1 = a0 + 0.84;
      parterre(c, col, 21, 30, a0, a1, y);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const p: V2 = [Math.cos(a) * 34.5, Math.sin(a) * 34.5];
      planter(c, p[0], p[1], 1.5, 0.75, 'palms', y);
      col.solid(p[0] - 1.5, p[1] - 1.5, p[0] + 1.5, p[1] + 1.5, 0, 0.9);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.group(() => {
        b.at(Math.cos(a) * 19.2, 0, Math.sin(a) * 19.2, -a - Math.PI / 2);
        b.box(-1.6, y, -0.3, 1.6, y + 0.45, 0.3, MAT.CREAM);
        b.box(-1.4, y, -0.25, -1.1, y + 0.42, 0.25, MAT.ASHLAR).box(1.1, y, -0.25, 1.4, y + 0.42, 0.25, MAT.ASHLAR);
      });
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
      if (Math.abs(Math.sin(a) - 1) < 0.08) continue;
      lampPost(c, col, Math.cos(a) * 60, Math.sin(a) * 60, 4.2, y);
    }
    canopy(c, col, y);
    // red pillars marking the avenue's mouth (the grand hall's, ref 1)
    for (const s of [-1, 1]) pillar(c, col, s * (AVENUE.width / 2 + 2.5), PLAZA.r - 2, 13, y);
  });
}

/** a canopy of lantern strings over the fountain: eight slender red masts round it, strung to each other and up to
 *  the fountain's gold finial */
function canopy(c: City, col: Collide, y: number) {
  const b = c.b, r = 44, h = 9.5, n = 8;
  const tints: V3[] = [[1.3, 0.5, 0.2], [1.3, 0.85, 0.25], [1.15, 0.3, 0.3]];
  const masts: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
    b.box(x - 0.45, y, z - 0.45, x + 0.45, y + 0.6, z + 0.45, MAT.CREAM, { skip: ['bottom'] });
    b.box(x - 0.18, y + 0.6, z - 0.18, x + 0.18, y + h, z + 0.18, MAT.RED, { skip: ['bottom', 'top'] });
    b.cylinder(x, z, 0.3, y + h, y + h + 0.9, 4, MAT.GOLD, { r1: 0.03 });
    col.solid(x - 0.45, z - 0.45, x + 0.45, z + 0.45, 0, y + h);
    masts.push([x, y + h - 0.3, z]);
  }
  for (let i = 0; i < n; i++) {
    lanternString(c, masts[i], masts[(i + 1) % n], 1.6, 1.6, tints, 5);
    lanternString(c, masts[i], [0, y + 8.2, 0], 1.4, 1.6, tints, 7);
  }
}

/** the great fountain: a round basin (open, its water 0.56 m deep over a mosaic floor) in a rim on a step, a tiered
 *  fountain of three bowls with a gold finial. The step is walked onto, the rim is a wall to jump onto and walk round,
 *  and the basin is waded in */
function fountain(c: City, col: Collide, y: number) {
  const b = c.b, R = 12, n = 32, STEP_H = 0.25, RIM_H = 0.85;
  // (a flat ring between radii r0 < r1 at height h, facing up)
  const annulus = (r0: number, r1: number, h: number, mat: Mat) => {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      b.quad([Math.cos(a1) * r0, h, Math.sin(a1) * r0], [Math.cos(a1) * r1, h, Math.sin(a1) * r1], [Math.cos(a0) * r1, h, Math.sin(a0) * r1], [Math.cos(a0) * r0, h, Math.sin(a0) * r0], mat);
    }
  };
  b.cylinder(0, 0, R + 1.4, y, y + STEP_H, n, MAT.ASHLAR, { top: null });
  annulus(R + 0.6, R + 1.4, y + STEP_H, MAT.CREAM);
  b.cylinder(0, 0, R + 0.6, y + STEP_H, y + RIM_H, n, MAT.CREAM, { top: null });
  annulus(R, R + 0.6, y + RIM_H, MAT.CREAM);
  // the basin's inner wall, facing in toward the water
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p = (a: number, h: number): V3 => [Math.cos(a) * R, h, Math.sin(a) * R];
    b.quad(p(a0, y + 0.1), p(a1, y + 0.1), p(a1, y + RIM_H), p(a0, y + RIM_H), MAT.POOL);
  }
  b.slab(ngon(0, 0, R, n), y + 0.12, MAT.POOL);
  c.pool(ngon(0, 0, R, n), y + 0.68, 0.56);
  // the tiers
  const tiers: [number, number, number][] = [[1.4, 2.8, 4.6], [0.9, 4.6, 3.0], [0.55, 6.3, 1.7]];
  b.cylinder(0, 0, 2.2, y + 0.1, y + 1.0, 12, MAT.CREAM, { r1: 1.6, top: null });
  for (const [stem, h, bowl] of tiers) {
    b.cylinder(0, 0, stem, y + 0.9, y + h, 12, MAT.CREAM, { r1: stem * 0.8, top: null });
    b.cylinder(0, 0, stem * 0.9, y + h, y + h + 0.5, 16, MAT.CREAM, { r1: bowl, top: MAT.POOL });
    b.cylinder(0, 0, bowl, y + h + 0.5, y + h + 0.72, 16, MAT.GOLD, { top: null });
  }
  b.cylinder(0, 0, 0.3, y + 6.8, y + 7.6, 8, MAT.CREAM, { r1: 0.2 });
  b.dome(0, y + 7.6, 0, 0.42, MAT.GOLD, { rise: 0.9, tip: 0.9, rings: 5, sides: 10 });
  // the step a floor round it, the rim a ring of solid boxes with floors on top, the basin's floor under the water, the
  // tiers' stem solid
  const ring = (r: number, w: number, fn: (x0: number, z0: number, x1: number, z1: number) => void) => {
    const m = Math.ceil((2 * Math.PI * r) / (w * 0.85));
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
      fn(x - w / 2, z - w / 2, x + w / 2, z + w / 2);
    }
  };
  ring(R + 1.0, 0.8, (x0, z0, x1, z1) => col.floor(x0, z0, x1, z1, y + STEP_H));
  ring(R + 0.3, 0.6, (x0, z0, x1, z1) => col.solid(x0, z0, x1, z1, 0, y + RIM_H).floor(x0, z0, x1, z1, y + RIM_H));
  col.polyFloor(ngon(0, 0, R - 0.3, 16), y + 0.12);
  col.solid(-2.2, -2.2, 2.2, 2.2, 0, y + 7);
}

/** a flower parterre: a ring sector between radii r0 and r1 and angles a0 and a1, in a stone curb */
function parterre(c: City, col: Collide, r0: number, r1: number, a0: number, a1: number, y: number) {
  const b = c.b, n = 8;
  const pts: V2[] = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([Math.cos(a) * r1, Math.sin(a) * r1]); }
  for (let i = n; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / n; pts.push([Math.cos(a) * r0, Math.sin(a) * r0]); }
  // the curb as short boxes round it, the soil inside
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz);
    b.group(() => { b.at(p[0], 0, p[1], Math.atan2(-dz, dx)); b.box(0, y, -0.2, L, y + 0.4, 0.2, MAT.ASHLAR, { top: MAT.CREAM, skip: ['bottom'] }); });
  }
  // (the sector is not convex: its soil and beds go in as quads between the two arcs)
  for (let i = 0; i < n; i++) {
    const A = pts[i], B = pts[i + 1], C = pts[2 * n + 1 - (i + 1)], D = pts[2 * n + 1 - i];
    b.poly([[A[0], y + 0.32, A[1]], [B[0], y + 0.32, B[1]], [C[0], y + 0.32, C[1]], [D[0], y + 0.32, D[1]]].reverse() as V3[], MAT.SOIL);
    c.bed([A, B, C, D], y + 0.32, i % 3 === 1 ? 'shrubs' : 'flowers', 0.9, i % 2 ? 'pink' : 'mixed');
    const mx = (A[0] + C[0]) / 2, mz = (A[1] + C[1]) / 2;
    col.solid(mx - 1.2, mz - 1.2, mx + 1.2, mz + 1.2, 0, 0.4);
  }
}

/** a red freestanding pillar on a cubic plinth with lavender diamond insets (the grand hall's, ref 1) */
export function pillar(c: City, col: Collide | null, x: number, z: number, h: number, y = 0, s = 1) {
  const b = c.b, ps = 1.45 * s, w = 0.78 * s;
  b.box(x - ps - 0.15, y, z - ps - 0.15, x + ps + 0.15, y + 0.35 * s, z + ps + 0.15, MAT.CREAM, { skip: ['bottom'] });
  b.box(x - ps, y + 0.35 * s, z - ps, x + ps, y + 2.9 * s, z + ps, MAT.RED, { skip: ['bottom'] });
  b.box(x - ps - 0.12, y + 2.9 * s, z - ps - 0.12, x + ps + 0.12, y + 3.25 * s, z + ps + 0.12, MAT.CREAM);
  // the diamonds on the plinth's faces and halfway up the shaft
  const diamond = (cx: number, cy: number, cz: number, nx: number, nz: number, r: number) => {
    const tx = nz, tz = -nx;
    const p = (u: number, v: number): V3 => [cx + nx * 0.02 + tx * u, cy + v, cz + nz * 0.02 + tz * u];
    b.poly([p(0, -r), p(r * 0.8, 0), p(0, r), p(-r * 0.8, 0)], MAT.LAVENDER);
  };
  for (const [nx, nz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
    diamond(x + nx * ps, y + 1.62 * s, z + nz * ps, nx, nz, 0.75 * s);
    diamond(x + nx * w, y + h * 0.62, z + nz * w, nx, nz, 0.42 * s);
  }
  b.box(x - w, y + 3.25 * s, z - w, x + w, y + h, z + w, MAT.RED, { skip: ['bottom', 'top'] });
  b.box(x - w - 0.12, y + h, z - w - 0.12, x + w + 0.12, y + h + 0.35 * s, z + w + 0.12, MAT.CREAM);
  b.box(x - w * 0.8, y + h + 0.35 * s, z - w * 0.8, x + w * 0.8, y + h + 1.0 * s, z + w * 0.8, MAT.RED, { skip: ['bottom'] });
  b.cylinder(x, z, w * 0.8 * Math.SQRT2, y + h + 1.0 * s, y + h + 1.7 * s, 4, MAT.GOLD, { r1: 0.05 });
  col?.solid(x - ps, z - ps, x + ps, z + ps, 0, y + h);
}

/** a boulevard's furniture along a straight run (plan a -> b, `width` wide): palms in planters down both sides at a
 *  rhythm, lamps between them */
export function boulevard(c: City, a: V2, z: V2, width: number, name: string, o: { kind?: 'palms' | 'cypress'; every?: number; skip?: (p: V2) => boolean } = {}) {
  const b = c.b;
  const dx = z[0] - a[0], dz = z[1] - a[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
  const every = o.every ?? 12, off = width / 2 - 3.2;
  b.group(() => {
    b.at(0, FLOOR_Y, 0);
    const col = c.collide(name);
    for (let t = every / 2; t < L - 2; t += every) {
      for (const s of [-1, 1]) {
        const p: V2 = [a[0] + ux * t + nx * off * s, a[1] + uz * t + nz * off * s];
        if (o.skip?.(p)) continue;
        planter(c, p[0], p[1], 1.1, 0.6, o.kind ?? 'palms', FLOOR.street);
        col.solid(p[0] - 1.1, p[1] - 1.1, p[0] + 1.1, p[1] + 1.1, 0, 0.75);
        const q: V2 = [p[0] + ux * every / 2, p[1] + uz * every / 2];
        if (t + every / 2 < L - 2 && !o.skip?.(q)) lampPost(c, col, q[0], q[1], 4.0, FLOOR.street);
      }
    }
  });
}

/** the avenue, the boulevard east, the processional way and the squares at the gate and the stair */
export function buildWays(c: City) {
  const inSquare = (p: V2) => inRect(p, GATE_SQUARE, 3) || inRect(p, STAIR_SQUARE, 3) || Math.hypot(p[0], p[1]) < 92;
  boulevard(c, [AVENUE.x, PLAZA.r + 18], [AVENUE.x, GATE_SQUARE.z0], AVENUE.width, 'city/avenue', { skip: inSquare });
  boulevard(c, [92, 0], [PALACE_CLOSE.x0, 0], 18, 'city/east-way', { every: 14 });
  boulevard(c, [AVENUE.x, HALL_CLOSE.z0], [AVENUE.x, STAIR_SQUARE.z1], AVENUE.width, 'city/processional', { kind: 'cypress', every: 9, skip: inSquare });
  gateSquare(c);
  stairSquare(c);
}

function inRect(p: V2, r: { x0: number; x1: number; z0: number; z1: number }, m: number) {
  return p[0] > r.x0 - m && p[0] < r.x1 + m && p[1] > r.z0 - m && p[1] < r.z1 + m;
}

/** inside the south gate: paving, palms at the corners, a column with a gold lamp in the middle */
function gateSquare(c: City) {
  const b = c.b, r = GATE_SQUARE;
  const col = c.collide('city/gate-square');
  b.with({ tint: PAVE }, () => b.slab(rectPts(r.x0, r.z0, r.x1, r.z1 + 4), FLOOR.square, MAT.PAVING));
  b.with({ tint: BAND }, () => b.slab(rectPts(-6, r.z0, 6, r.z1), FLOOR.square + 0.012, MAT.PAVING));
  for (const x of [r.x0 + 5, r.x1 - 5]) for (const z of [r.z0 + 6, r.z1 - 12]) { planter(c, x, z, 1.8, 0.8, 'palms', FLOOR.square); col.solid(x - 1.8, z - 1.8, x + 1.8, z + 1.8, 0, 1); }
  for (const x of [r.x0 + 14, r.x1 - 14]) lampPost(c, col, x, (r.z0 + r.z1) / 2, 4.2, FLOOR.square);
}

/** at the stair's foot: paving, the way up left clear, cypress either side, two tall fire columns flanking the stair */
function stairSquare(c: City) {
  const b = c.b, r = STAIR_SQUARE, [sx, sz] = [STAIR.landings[0][0], STAIR.landings[0][1]];
  const col = c.collide('city/stair-square');
  b.with({ tint: PAVE }, () => b.slab(rectPts(r.x0, r.z0, r.x1, r.z1), FLOOR.square, MAT.PAVING));
  b.with({ tint: BAND }, () => b.slab(rectPts(sx - STAIR.width / 2 - 1, sz, sx + STAIR.width / 2 + 1, r.z1), FLOOR.square + 0.012, MAT.PAVING));
  for (const s of [-1, 1]) {
    const x = sx + s * (STAIR.width / 2 + 4.5);
    // a fire column: a stepped base, a shaft, a gold bowl
    b.box(x - 1.6, FLOOR.square, sz - 1.6, x + 1.6, 0.9, sz + 1.6, MAT.CREAM, { skip: ['bottom'] });
    b.box(x - 0.8, 0.9, sz - 0.8, x + 0.8, 7.2, sz + 0.8, MAT.RED, { skip: ['bottom'] });
    b.box(x - 1.0, 7.2, sz - 1.0, x + 1.0, 7.5, sz + 1.0, MAT.CREAM);
    brazier(c, x, 7.5, sz, 1.4);
    col.solid(x - 1.6, sz - 1.6, x + 1.6, sz + 1.6, 0, 7.5);
    for (let k = 0; k < 4; k++) {
      const z = sz + 10 + k * 9;
      if (z > r.z1 - 3) break;
      planter(c, sx + s * (STAIR.width / 2 + 6), z, 1.0, 0.6, 'cypress', FLOOR.square);
      col.solid(sx + s * (STAIR.width / 2 + 6) - 1, z - 1, sx + s * (STAIR.width / 2 + 6) + 1, z + 1, 0, 0.7);
    }
  }
}
