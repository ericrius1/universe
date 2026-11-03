// What lies between the houses: the town's floor (its claims paved, all of it: the streets are what the houses leave),
// the courtyards in the middle of the blocks (gardens, a pool and fountain in the rich ones, a well in the humble), the
// garden plots (a lawn in a stone curb, a few trees: near the pools and out toward the rim), the neighbourhood squares
// (a fountain or a great tree, a small domed shrine, lamps), the lantern strings tied across the streets between the
// houses' upper floors, and now and then an arch or a little bridging room thrown over an alley. And the ways (owner
// 'streets'): the ring road round the citadel's foot, an arch over it where it crosses each ridge's cutting, lamps along
// it; a square at each spoke's foot (a fountain, palms, lamps) and from it the avenue out to the tip, a palm boulevard.
import type { V3 } from '../arch/types';
import { MAT } from '../arch/types';
import { CAVERNS, CLAIMS, FLOOR_Y, PLATEAU, POINTS, PORTS, RIDGES, RIDGE_CUTS, RING_ANGLES, STAR, WAYS, inPoint, pointFrame, type V2 } from '../world/layout';
import type { City, Collide } from './ctx';
import { Face } from './facade';
import { area, bbox, centroid, grow, inset, ngon, rayHit, type Poly } from './geom';
import type { Skyline } from './houses';
import type { Block, CityPlan, Lot } from './plan';
import { CLOTHS, GLAZES, basinRim, dome, lanternBody, lanternString, planter } from './props';
import { Rng } from './rng';
import { band } from './tiles';
import { TILE_PAL } from '../arch/types';

/** the heights of the city's floor layers (over FLOOR_Y): the earth flags, the paved streets, the squares' paving */
export const FLOOR = { earth: 0.02, street: 0.045, square: 0.07 };
const STREET_TINT: V3 = [1.02, 0.94, 0.86];
/** the ways' paving: the ring road and the avenues a deeper, warmer stone than the town's lanes; the spokes' squares
 *  pale */
const WAY_TINT: V3 = [0.94, 0.8, 0.7];
const FOOT_TINT: V3 = [1.1, 1.03, 0.94];
const DEG = Math.PI / 180;
/** the ways' paving's height (over FLOOR_Y): a step over the town's floor */
const WAY_Y = FLOOR.street + 0.015;

/** the town's floor: its claims (layout.ts CLAIMS, owner 'town': every point's ground inside the building line and
 *  out past the ring road, less the landmarks, the ways, the pools and the ridges) paved, all of it — the streets,
 *  the alleys and the margins round the others' ground are what the houses leave of it */
export function buildFloor(c: City, floor: V2[][]) {
  const b = c.b;
  b.with({ tint: STREET_TINT }, () => { for (const q of floor) b.slab(q, FLOOR_Y + FLOOR.street, MAT.PAVING); });
}

/** a courtyard in the middle of a block: paved, a garden, and by the block's wealth a pool and fountain or a well */
export function courtyard(c: City, col: Collide, lot: Lot) {
  const b = c.b, rng = new Rng(lot.seed);
  const q = lot.poly, w = lot.wealth, A = area(q.p);
  if (A < 12) return;
  b.with({ tint: [1.0, 0.92, 0.84] }, () => b.slab(q.p, FLOOR.square, MAT.PAVING));
  const [x0, z0, x1, z1] = bbox(q.p);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sz = z1 - z0;
  // (square to the block's frame: every corner at a corner of its box)
  const rectLike = q.p.length === 4 && q.p.every(([x, z]) => (Math.abs(x - x0) < 0.05 || Math.abs(x - x1) < 0.05) && (Math.abs(z - z0) < 0.05 || Math.abs(z - z1) < 0.05));
  if (w > 0.55 && rectLike && sx > 9 && sz > 9) {
    // a pool with a fountain in the middle, beds round it
    const px = Math.min(sx * 0.32, 5), pz = Math.min(sz * 0.32, 5);
    pool(c, col, cx, cz, px, pz, 0.45);
    for (const [ax, az] of [[x0 + 1.2, z0 + 1.2], [x1 - 1.2, z0 + 1.2], [x1 - 1.2, z1 - 1.2], [x0 + 1.2, z1 - 1.2]]) {
      const bx0 = Math.min(ax, cx), bx1 = Math.max(ax, cx), bz0 = Math.min(az, cz), bz1 = Math.max(az, cz);
      const r: number[] = [bx0 + (ax < cx ? 0 : px + 0.8), bz0 + (az < cz ? 0 : pz + 0.8), bx1 - (ax < cx ? px + 0.8 : 0), bz1 - (az < cz ? pz + 0.8 : 0)];
      if (r[2] - r[0] < 1.2 || r[3] - r[1] < 1.2) continue;
      bedBox(c, col, r, rng.pick(['flowers', 'shrubs', 'blossom'] as const), rng);
    }
    for (const [ax, az] of [[x0 + 1.4, z0 + 1.4], [x1 - 1.4, z1 - 1.4]]) planter(c, ax, az, 0.9, 0.6, rng.chance(0.6) ? 'palms' : 'cypress');
    return;
  }
  // a garden bed filling most of it, a tree, a well
  const inner = inset(q, 1.3);
  if (inner.p.length >= 3 && area(inner.p) > 4) {
    const curb = (p: Poly) => {
      for (let i = 0; i < p.p.length; i++) {
        const f = new Face(b, p.p[(i + 1) % p.p.length], p.p[i], FLOOR.square, 0.38);
        f.box(0, 0, f.len, 0.38, 0, 0.22, MAT.ASHLAR, { back: true, top: MAT.CREAM, skip: ['bottom', 'left', 'right'] });
      }
    };
    curb(inner);
    const kind = w > 0.6 ? rng.pick(['blossom', 'palms', 'trees', 'flowers'] as const) : w > 0.3 ? rng.pick(['trees', 'shrubs', 'lawn', 'flowers'] as const) : rng.pick(['trees', 'shrubs', 'scrub'] as const);
    b.slab(inner.p, FLOOR.square + 0.3, kind === 'lawn' ? MAT.LAWN : MAT.SOIL);
    c.bed(inset(inner, 0.25).p, FLOOR.square + 0.3, kind, w > 0.3 ? 0.8 : 0.5, kind === 'flowers' ? rng.pick(['pink', 'white', 'mixed', 'gold'] as const) : undefined);
    col.polySolid(inner.p, 0, 0.38);
  }
  const wellAt = inset(q, 1.4);
  if (w < 0.4 && rng.chance(0.35) && sx > 5 && sz > 5 && wellAt.p.length >= 3 && area(wellAt.p) > 1) {
    const [wx, wz] = wellAt.p[0];
    b.cylinder(wx, wz, 0.75, 0, 0.85, 10, MAT.ASHLAR, { top: null });
    b.cylinder(wx, wz, 0.55, 0.6, 0.85, 10, MAT.ASHLAR, { top: MAT.WINDOW });
    b.box(wx - 0.7, 0.85, wz - 0.05, wx - 0.6, 2.2, wz + 0.05, MAT.WOOD).box(wx + 0.6, 0.85, wz - 0.05, wx + 0.7, 2.2, wz + 0.05, MAT.WOOD).box(wx - 0.75, 2.2, wz - 0.06, wx + 0.75, 2.3, wz + 0.06, MAT.WOOD);
    col.solid(wx - 0.75, wz - 0.75, wx + 0.75, wz + 0.75, 0, 0.85);
  }
}

/** a rectangular pool (centre, half sizes) with a cream rim and a fountain column in the middle; its water; a band of
 *  tile round its rim in palette `pal` if given (a grand court's) */
export function pool(c: City, col: Collide | null, cx: number, cz: number, hx: number, hz: number, rimH: number, o: { fountain?: boolean; y?: number; pal?: number } = {}) {
  const b = c.b, y = o.y ?? FLOOR.square;
  const rw = 0.4;
  b.box(cx - hx - rw, y, cz - hz - rw, cx + hx + rw, y + rimH, cz - hz, MAT.CREAM, { skip: ['bottom'] });
  b.box(cx - hx - rw, y, cz + hz, cx + hx + rw, y + rimH, cz + hz + rw, MAT.CREAM, { skip: ['bottom'] });
  b.box(cx - hx - rw, y, cz - hz, cx - hx, y + rimH, cz + hz, MAT.CREAM, { skip: ['bottom', 'n', 's'] });
  b.box(cx + hx, y, cz - hz, cx + hx + rw, y + rimH, cz + hz, MAT.CREAM, { skip: ['bottom', 'n', 's'] });
  // (a tiled band round the rim's outer faces, if it's a grand pool)
  if (o.pal !== undefined) {
    const X0 = cx - hx - rw, X1 = cx + hx + rw, Z0 = cz - hz - rw, Z1 = cz + hz + rw;
    for (const [l, r] of [[[X0, Z1], [X1, Z1]], [[X1, Z0], [X0, Z0]], [[X1, Z1], [X1, Z0]], [[X0, Z0], [X0, Z1]]] as [V2, V2][]) {
      const f = new Face(b, l, r, y, rimH);
      b.with({ pal: o.pal }, () => f.rect(0.03, 0.07, f.len - 0.03, rimH - 0.07, -0.012, MAT.TILE_BAND));
    }
  }
  // the basin's floor inside the rim, the water held by it
  b.slab([[cx - hx, cz - hz], [cx + hx, cz - hz], [cx + hx, cz + hz], [cx - hx, cz + hz]], y + 0.01, MAT.POOL);
  if (o.fountain !== false) {
    b.cylinder(cx, cz, 0.35, y, y + 1.1, 10, MAT.CREAM, { top: null });
    b.cylinder(cx, cz, 0.35, y + 1.1, y + 1.3, 12, MAT.CREAM, { r1: 0.9, top: MAT.POOL });
  }
  c.pool([[cx - hx, cz - hz], [cx + hx, cz - hz], [cx + hx, cz + hz], [cx - hx, cz + hz]], y + rimH - 0.12, rimH - 0.13);
  col?.solid(cx - hx - rw, cz - hz - rw, cx + hx + rw, cz + hz + rw, y, y + rimH);
}

/** a raised bed in a stone curb over a plan rectangle */
function bedBox(c: City, col: Collide, r: number[], kind: 'flowers' | 'shrubs' | 'blossom', rng: Rng) {
  c.b.box(r[0], 0, r[1], r[2], 0.45, r[3], MAT.ASHLAR, { top: MAT.SOIL, skip: ['bottom'] });
  c.bed([[r[0] + 0.15, r[1] + 0.15], [r[2] - 0.15, r[1] + 0.15], [r[2] - 0.15, r[3] - 0.15], [r[0] + 0.15, r[3] - 0.15]], 0.45, kind, 0.85, kind === 'flowers' ? rng.pick(['pink', 'white', 'mixed', 'purple'] as const) : undefined);
  col.solid(r[0], r[1], r[2], r[3], 0, 0.45);
}

/** a neighbourhood square: paving, a fountain or a great tree in the middle, a domed shrine at one side, lamps */
export function localSquare(c: City, poly: V2[], idx: number, seed: number) {
  const b = c.b, rng = new Rng(seed + idx * 7919);
  const [cx, cz] = centroid(poly);
  b.group(() => {
    b.at(cx, FLOOR_Y, cz);
    const col = c.collide(`city/square-${idx}`);
    const p = poly.map(([x, z]) => [x - cx, z - cz] as V2);
    b.with({ tint: [1.08, 1.02, 0.95] }, () => b.slab(p, FLOOR.square, MAT.PAVING));
    // a ring of darker flags round the middle
    b.with({ tint: [0.86, 0.7, 0.6] }, () => b.slab(ngon(0, 0, 6.5, 16), FLOOR.square + 0.01, MAT.PAVING));
    if (rng.chance(0.6)) {
      // an octagonal fountain
      const r = 3.2;
      // (its rim a ring over an open basin: a whole disc there hid the water)
      b.cylinder(0, 0, r + 0.4, FLOOR.square, 0.6, 8, MAT.CREAM, { top: null });
      basinRim(c, 0, 0, r, 0.4, 0.1, 0.6, 8);
      b.slab(ngon(0, 0, r, 8), 0.12, MAT.POOL);
      b.cylinder(0, 0, 0.4, 0.1, 1.8, 8, MAT.CREAM, { top: null });
      b.cylinder(0, 0, 0.4, 1.8, 2.05, 10, MAT.CREAM, { r1: 1.3, top: MAT.POOL });
      b.cylinder(0, 0, 0.2, 2.05, 2.7, 8, MAT.CREAM, { r1: 0.12 });
      c.pool(ngon(0, 0, r, 8), 0.48, 0.45);
      col.solid(-r - 0.4, -r - 0.4, r + 0.4, r + 0.4, 0, 0.6);
    } else planter(c, 0, 0, 2.6, 0.7, rng.pick(['blossom', 'trees', 'palms'] as const));
    // a small domed shrine on the square's edge, facing the middle
    const a = rng.range(0, Math.PI * 2), r = Math.max(8, Math.min(...p.map(([x, z]) => Math.hypot(x, z))) - 5);
    b.group(() => {
      b.at(Math.cos(a) * r, 0, Math.sin(a) * r, -a - Math.PI / 2);
      const s = 2.4, h = 4.2;
      for (let i = 0; i < 4; i++) {
        const corners: V2[] = [[-s, -s], [s, -s], [s, s], [-s, s]];
        const f = new Face(b, corners[(i + 1) % 4], corners[i], 0, h);
        f.wall(MAT.PLASTER_WARM, i === 2 ? [{ u0: f.len / 2 - 0.9, u1: f.len / 2 + 0.9, v0: 0, top: 3.2, arch: 'pointed', depth: 0.6, fill: MAT.INTERIOR, glow: 0.6, frame: MAT.CREAM, frameW: 0.25 }] : []);
      }
      b.box(-s - 0.2, h, -s - 0.2, s + 0.2, h + 0.35, s + 0.2, MAT.CREAM);
      dome(c, 0, h + 0.35, 0, s * 0.85, { drum: 0.6, bulge: 1.1, tip: 0.5 });
      col.solid(-s, -s, s, s, 0, h + 0.35);
      c.light([0, 2.0, s + 1.0], 40, { radius: 7 });
    });
    // at some squares a slender tower beside the shrine: a gallery near its top, an open lantern stage, a dome
    if (idx % 2 === 0) {
      const ta = a + Math.PI * 0.62, tr = Math.max(8, r - 2);
      tower(c, col, Math.cos(ta) * tr, Math.sin(ta) * tr, rng.range(24, 32), rng);
    }
    // lamps on posts round it (instanced)
    for (let k = 0; k < 4; k++) {
      const aa = a + Math.PI / 4 + (k / 4) * Math.PI * 2, rr = r * 0.75, x = Math.cos(aa) * rr, z = Math.sin(aa) * rr;
      b.place('lantern-post', [x, FLOOR.square, z], { scale: 1.3 });
      col.solid(x - 0.24, z - 0.24, x + 0.24, z + 0.24, 0, 3.4);
    }
  });
}

/** a slender square tower with a corbelled gallery, an open lantern stage and a blue dome */
function tower(c: City, col: Collide, x: number, z: number, h: number, rng: Rng) {
  const b = c.b, s = 1.7, mat = rng.chance(0.5) ? MAT.PLASTER_WARM : MAT.PLASTER;
  b.box(x - s - 0.3, -2, z - s - 0.3, x + s + 0.3, 1.2, z + s + 0.3, MAT.ASHLAR, { skip: ['bottom'] });
  b.box(x - s, 1.2, z - s, x + s, h, z + s, mat, { skip: ['bottom', 'top'] });
  for (const y of [h * 0.4, h * 0.7]) b.box(x - s - 0.1, y, z - s - 0.1, x + s + 0.1, y + 0.3, z + s + 0.1, MAT.CREAM);
  // slit windows up its faces
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const y of [h * 0.25, h * 0.55]) {
    const tx = -nz * 0.18, tz = nx * 0.18, px = x + nx * (s + 0.012), pz = z + nz * (s + 0.012);
    b.poly([[px - tx, y, pz - tz], [px - tx, y + 1.5, pz - tz], [px + tx, y + 1.5, pz + tz], [px + tx, y, pz + tz]].reverse() as V3[], MAT.WINDOW);
  }
  // the gallery: a corbelled floor, a rail, then the lantern stage on four piers
  b.box(x - s - 0.9, h, z - s - 0.9, x + s + 0.9, h + 0.45, z + s + 0.9, MAT.CREAM);
  for (const [l, r] of [[[x - s - 0.9, z + s + 0.9], [x + s + 0.9, z + s + 0.9]], [[x + s + 0.9, z - s - 0.9], [x - s - 0.9, z - s - 0.9]], [[x + s + 0.9, z + s + 0.9], [x + s + 0.9, z - s - 0.9]], [[x - s - 0.9, z - s - 0.9], [x - s - 0.9, z + s + 0.9]]] as [V2, V2][]) {
    const f = new Face(b, l, r, h + 0.45, 1.0);
    f.box(0, 0, f.len, 0.95, 0, 0.2, mat, { back: true, top: MAT.CREAM, skip: ['bottom'] });
  }
  const st = h + 0.45, sh = 3.2;
  for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(x + px * s - 0.35, st, z + pz * s - 0.35, x + px * s + 0.35, st + sh, z + pz * s + 0.35, mat, { skip: ['bottom', 'top'] });
  b.with({ glow: 0.9 }, () => b.box(x - s + 0.4, st, z - s + 0.4, x + s - 0.4, st + sh - 0.4, z + s - 0.4, MAT.WINDOW, { skip: ['bottom', 'top'] }));
  b.box(x - s - 0.3, st + sh, z - s - 0.3, x + s + 0.3, st + sh + 0.4, z + s + 0.3, MAT.CREAM);
  dome(c, x, st + sh + 0.4, z, s * 1.05, { drum: 0.5, bulge: 1.12, tip: 0.7, rise: s * 1.5, finial: true, glaze: rng.pick(GLAZES) });
  c.light([x, st + 1.5, z], 120, { radius: 14 });
  col.solid(x - s - 0.3, z - s - 0.3, x + s + 0.3, z + s + 0.3, 0, h).floor(x - s - 0.9, z - s - 0.9, x + s + 0.9, z + s + 0.9, h + 0.45);
}

/** a lamp on a stone post */
export function lampPost(c: City, col: Collide | null, x: number, z: number, h: number, y = 0) {
  const b = c.b;
  b.box(x - 0.22, y, z - 0.22, x + 0.22, y + 0.5, z + 0.22, MAT.ASHLAR, { skip: ['bottom'] });
  b.cylinder(x, z, 0.09, y + 0.5, y + h, 6, MAT.WOOD, { top: null });
  b.box(x - 0.32, y + h, z - 0.05, x + 0.32, y + h + 0.08, z + 0.05, MAT.WOOD);
  lanternBody(c, [x - 0.28, y + h - 0.3, z], 0.15);
  lanternBody(c, [x + 0.28, y + h - 0.3, z], 0.15);
  c.light([x, y + h - 0.4, z], 70, { radius: 11 });
  col?.solid(x - 0.22, z - 0.22, x + 0.22, z + 0.22, y, y + h);
}

/** lantern strings tied across the town's streets and alleys between the houses' upper floors, now and then a washing
 *  line over an alley instead (the arches over the alleys are their blocks': alleyArches) */
export function streetLife(c: City, plan: CityPlan, sky: Skyline, seed: number) {
  const rng = new Rng(seed);
  const tints: V3[] = [[1.3, 0.5, 0.2], [1.3, 0.8, 0.25], [1.1, 0.3, 0.3], [1.25, 0.65, 0.3]];
  for (const s of plan.streets) {
    const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L = Math.hypot(dx, dz);
    if (L < 12) continue;
    const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
    const step = s.rank === 1 ? rng.range(11, 16) : rng.range(16, 24);
    for (let t = step * 0.7; t < L - 6; t += step * rng.range(0.8, 1.25)) {
      const mx = s.a[0] + ux * t, mz = s.a[1] + uz * t;
      const half = s.width / 2 + 0.35;
      const skew = s.rank === 1 ? rng.range(-2.5, 2.5) : rng.range(-4, 4);
      const A: V2 = [mx + nx * half, mz + nz * half], B: V2 = [mx - nx * half + ux * skew, mz - nz * half + uz * skew];
      const hA = sky.at(A[0], A[1]), hB = sky.at(B[0], B[1]);
      const y = Math.min(hA, hB) - rng.range(0.8, 2.2);
      if (y < 4.2) continue;
      // a washing line over an alley now and then
      if (s.rank === 1 && rng.chance(0.1)) { washing(c, [A[0] - nx * 0.4, y - 1.2, A[1] - nz * 0.4], [B[0] + nx * 0.4, y - 1.2, B[1] + nz * 0.4], rng); continue; }
      if (!rng.chance(s.rank === 1 ? 0.5 : 0.6)) continue;
      const a3: V3 = [A[0] - nx * 0.4, y, A[1] - nz * 0.4], b3: V3 = [B[0] + nx * 0.4, y + rng.range(-0.6, 0.6), B[1] + nz * 0.4];
      // (a light in one string in two, at one lantern in five: the windows and the doors' lanterns light the rest)
      lanternString(c, a3, b3, rng.range(0.5, 1.1), 1.5, [rng.pick(tints), rng.pick(tints), rng.pick(tints)], rng.chance(0.5) ? 5 : 0);
      // (now and then a strip of cloth bunting beside it)
      if (rng.chance(0.25)) bunting(c, [a3[0], a3[1] + 0.6, a3[2]], [b3[0], b3[1] + 0.6, b3[2]], rng);
    }
  }
}

/** the arches thrown over a block's alleys between its houses' walls (in the block's frame, into its collider) */
export function alleyArches(c: City, col: Collide, block: Block, sky: Skyline, seed: number) {
  const rng = new Rng(seed), b = c.b;
  let n = 0;
  for (const al of block.alleys) {
    const dx = al.b[0] - al.a[0], dz = al.b[1] - al.a[1], L = Math.hypot(dx, dz);
    if (L < 14) continue;
    const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
    for (let t = rng.range(8, 14); t < L - 6 && n < 3; t += rng.range(16, 30)) {
      if (!rng.chance(0.3)) continue;
      const mx = al.a[0] + ux * t, mz = al.a[1] + uz * t, h = al.width / 2 + 0.02;
      const A: V2 = [mx + nx * h, mz + nz * h], Z: V2 = [mx - nx * h, mz - nz * h];
      const wa = b.xf([A[0], 0, A[1]]), wz = b.xf([Z[0], 0, Z[1]]);
      const hA = sky.at(wa[0], wa[2]), hZ = sky.at(wz[0], wz[2]);
      if (hA < 6.5 || hZ < 6.5) continue;
      // (both feet against a house's wall: the faces either side stand there the arch's depth along the alley)
      const d = rng.range(1.6, 3.2), along = (s: number, p: V2): V2 => [p[0] + ux * s, p[1] + uz * s];
      const walls = [A, Z].every((p) => [-d / 2 - 0.3, d / 2 + 0.3].every((s) => { const q = along(s, p), w = b.xf([q[0] + (p === A ? nx : -nx) * 0.3, 0, q[1] + (p === A ? nz : -nz) * 0.3]); return sky.at(w[0], w[2]) > 6.5; }));
      if (!walls) continue;
      if (alleyArch(c, col, A, Z, d, Math.min(hA, hZ), rng)) n++;
    }
  }
}

/** an arch over an alley between two houses' walls (plan points on each face, in the block's frame), `d` deep along
 *  the alley, or a little room bridging it; false if it doesn't fit under the houses' tops */
function alleyArch(c: City, col: Collide, a: V2, z: V2, d: number, h: number, rng: Rng): boolean {
  const b = c.b;
  const L = Math.hypot(z[0] - a[0], z[1] - a[1]);
  const room = h > 8.5 && rng.chance(0.45);
  const arch = room ? 'round' as const : 'pointed' as const;
  const crown = rng.range(3.1, 3.7) + (room ? L / 2 : L * 0.74);
  const top = room ? crown + 3.0 : crown + rng.range(0.7, 1.2);
  if (top > h - 0.3) return false;
  const mat = rng.chance(0.5) ? MAT.PLASTER : MAT.PLASTER_WARM;
  b.group(() => {
    b.at(a[0], 0, a[1], Math.atan2(-(z[1] - a[1]), z[0] - a[0]));
    // (local x across the alley from a to z, z along it; the arch's faces look up and down the alley, the passage
    // through: reveals from the one, only the hole in the other, no floor of its own over the street's)
    for (const s of [-1, 1] as const) {
      const f = s > 0 ? new Face(b, [0, d / 2], [L, d / 2], 0, top) : new Face(b, [L, -d / 2], [0, -d / 2], 0, top);
      f.wall(mat, [{ u0: 0.01, u1: L - 0.01, v0: 0, top: crown, arch, depth: s > 0 ? d : 0.01, fill: null, floor: false }]);
    }
    b.box(-0.05, top, -d / 2 - 0.1, L + 0.05, top + 0.25, d / 2 + 0.1, MAT.CREAM, { skip: ['w', 'e'] });
    if (room) {
      // windows in the bridging room's faces, lit at night
      for (const s of [-1, 1] as const) {
        const f = s > 0 ? new Face(b, [0, d / 2], [L, d / 2], 0, top) : new Face(b, [L, -d / 2], [0, -d / 2], 0, top);
        b.with({ glow: rng.chance(0.6) ? 0.8 : 0 }, () => f.rect(L / 2 - 0.5, top - 2.3, L / 2 + 0.5, top - 0.9, -0.02, MAT.WINDOW));
      }
    }
    col.solidIn(b, 0, -d / 2, L, d / 2, crown, top + 0.25).floorIn(b, 0, -d / 2, L, d / 2, top + 0.25);
    if (rng.chance(0.5)) b.place('lantern-hanging', [L / 2, crown - 0.04, 0], { scale: 0.8 });
  });
  return true;
}

/** a washing line across an alley: cloths of all colours pegged along a sagging cord */
function washing(c: City, a: V3, z: V3, rng: Rng) {
  const b = c.b;
  const L = Math.hypot(z[0] - a[0], z[2] - a[2]), at = (t: number): V3 => [a[0] + (z[0] - a[0]) * t, a[1] + (z[1] - a[1]) * t - 0.45 * 4 * t * (1 - t), a[2] + (z[2] - a[2]) * t];
  const ux = (z[0] - a[0]) / L, uz = (z[2] - a[2]) / L;
  b.poly([at(0), at(0.5), [at(0.5)[0], at(0.5)[1] + 0.03, at(0.5)[2]], [a[0], a[1] + 0.03, a[2]]], MAT.WOOD);
  b.poly([at(0.5), at(1), [z[0], z[1] + 0.03, z[2]], [at(0.5)[0], at(0.5)[1] + 0.03, at(0.5)[2]]], MAT.WOOD);
  // (each cloth clear of the last along the cord: two in one plane overlapping fought)
  let t = rng.range(0.08, 0.2), w = rng.range(0.4, 0.9);
  for (; t + w / 2 / L < 0.92; ) {
    // (hung a little to the side of the cord: in its plane they fought it)
    const c0 = at(t), p: V3 = [c0[0] - uz * 0.025, c0[1], c0[2] + ux * 0.025], h = rng.range(0.5, 1.1);
    const q: V3[] = [[p[0] - ux * w / 2, p[1] - h, p[2] - uz * w / 2], [p[0] + ux * w / 2, p[1] - h, p[2] + uz * w / 2], [p[0] + ux * w / 2, p[1], p[2] + uz * w / 2], [p[0] - ux * w / 2, p[1], p[2] - uz * w / 2]];
    b.with({ tint: rng.pick([...CLOTHS, [1.25, 1.2, 1.1] as V3]) }, () => { b.poly(q, MAT.CLOTH); b.poly([...q].reverse(), MAT.CLOTH); });
    const next = rng.range(0.4, 0.9);
    t += (w / 2 + next / 2 + rng.range(0.08, 0.5)) / L;
    w = next;
  }
}

/** a strip of little cloth flags along a cord */
function bunting(c: City, a: V3, z: V3, rng: Rng) {
  const b = c.b;
  const L = Math.hypot(z[0] - a[0], z[2] - a[2]), n = Math.floor(L / 0.7);
  const at = (t: number): V3 => [a[0] + (z[0] - a[0]) * t, a[1] + (z[1] - a[1]) * t - 0.7 * 4 * t * (1 - t), a[2] + (z[2] - a[2]) * t];
  for (let i = 1; i < n; i++) {
    const p = at((i - 0.3) / n), q = at((i + 0.3) / n), m = at(i / n);
    const tip: V3 = [m[0], m[1] - 0.45, m[2]];
    b.with({ tint: rng.pick(CLOTHS) }, () => {
      b.poly([p, q, tip], MAT.CLOTH);
      b.poly([q, p, tip], MAT.CLOTH);
    });
  }
}


/** a garden plot on its lot (in its block's frame): a stone curb round a lawn, and on it a sparse bed of trees, palms or
 *  shrubs (the flora plants them; never a lawn's grass, which the slab is); in the richer places a planter with a
 *  blossoming tree in the middle */
export function gardenPlot(c: City, col: Collide, lot: Lot) {
  const b = c.b, rng = new Rng(lot.seed), q = lot.poly, w = lot.wealth;
  if (area(q.p) < 24) return;
  const t = 0.28, h = 0.3;
  // (round a corner cut by a short edge the curb is mitred badly: the outline with its short edges' corners cut off)
  const base = { p: cornered(q.p, 0.9), f: q.f };
  const path = { p: simplify(inset(base, 0.05 + t / 2).p) }, lawn = inset(base, 0.05 + t);
  if (path.p.length < 3 || lawn.p.length < 3 || area(lawn.p) < 12) return;
  // (the curb: mitred all round, capped; low enough to step over)
  b.wall(path.p, 0, h, t, MAT.ASHLAR, { cap: MAT.CREAM, capH: 0.06, capOut: 0.03, closed: true });
  b.slab(lawn.p, FLOOR.square, MAT.LAWN);
  const kind = rng.weighted(['trees', 'palms', 'blossom', 'shrubs', 'cypress'] as const, [4, 2.5, w > 0.4 ? 2 : 0.6, 2, 1]);
  const bed = inset(lawn, 0.6);
  const [x0, z0, x1, z1] = bbox(lawn.p), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (w > 0.4 && Math.min(x1 - x0, z1 - z0) > 7 && rng.chance(0.6)) {
    planter(c, cx, cz, 1.1, 0.55, rng.pick(['blossom', 'palms', 'cypress'] as const), FLOOR.square);
    col.solid(cx - 1.2, cz - 1.2, cx + 1.2, cz + 1.2, 0, 0.67);
  }
  if (bed.p.length >= 3 && area(bed.p) > 6) c.bed(bed.p, FLOOR.square, kind, rng.range(0.35, 0.55));
}

/** a convex outline with no edge shorter than `min`: the corner at the end of each short edge dropped (the outline only
 *  shrinks, staying convex), the smaller cut first */
function cornered(p: V2[], min: number): V2[] {
  let q = [...p];
  for (let guard = 0; guard < 64 && q.length > 3; guard++) {
    let worst = -1, cost = Infinity;
    for (let i = 0; i < q.length; i++) {
      const a = q[(i + q.length - 1) % q.length], v = q[i], e = q[(i + 1) % q.length];
      if (Math.min(Math.hypot(v[0] - a[0], v[1] - a[1]), Math.hypot(e[0] - v[0], e[1] - v[1])) >= min) continue;
      const lost = Math.abs((v[0] - a[0]) * (e[1] - a[1]) - (v[1] - a[1]) * (e[0] - a[0]));
      if (lost < cost) { cost = lost; worst = i; }
    }
    if (worst < 0) break;
    q.splice(worst, 1);
  }
  return q;
}

/** an outline without its nearly straight corners and its hair-short edges (a wall run round it mitres cleanly) */
function simplify(p: V2[]): V2[] {
  let q = p.filter((v, i) => { const u = p[(i + p.length - 1) % p.length]; return Math.hypot(v[0] - u[0], v[1] - u[1]) > 0.05; });
  q = q.filter((v, i) => {
    const a = q[(i + q.length - 1) % q.length], c = q[(i + 1) % q.length];
    const cr = (v[0] - a[0]) * (c[1] - v[1]) - (v[1] - a[1]) * (c[0] - v[0]);
    return Math.abs(cr) > 1e-3 * Math.hypot(v[0] - a[0], v[1] - a[1]) * Math.hypot(c[0] - v[0], c[1] - v[1]);
  });
  return q.length >= 3 ? q : p;
}

/** the radial distance (m) to the ring road's polygonal edge of radius r (its vertices at RING_ANGLES) along angle a
 *  (degrees) */
function chordR(r: number, a: number): number {
  const g = [...new Set(RING_ANGLES.map((x) => ((x % 360) + 360) % 360))].sort((p, q) => p - q), aa = ((a % 360) + 360) % 360;
  let i = g.length - 1;
  for (let k = 0; k < g.length; k++) if (aa >= g[k] && aa < (g[k + 1] ?? g[0] + 360)) i = k;
  const a0 = g[i], a1 = i + 1 < g.length ? g[i + 1] : g[0] + 360, mid = (a0 + a1) / 2;
  let d = aa - mid;
  if (d < -180) d += 360;
  return (r * Math.cos(((a1 - a0) / 2) * DEG)) / Math.cos(d * DEG);
}

/** The ways (owner 'streets'): the ring road, the spokes' squares and the avenues, paved exactly over their claims; an
 *  arch over the ring road at each ridge's cutting and lamps along its outer edge, each gate's collider holding its
 *  arc's lamps; at each spoke's foot a square with a fountain, palms and lamps, and the avenue out of it a palm
 *  boulevard (palms in stone planters down both sides, a lamp between every other pair), each point's in one collider */
export function buildWays(c: City, plan: CityPlan, seed: number) {
  const b = c.b, rng = new Rng(seed);
  const mine = CLAIMS.filter((q) => q.owner === 'streets');
  b.owner('paving', () => {
    // (a centimetre and a half over the town's floor: where two claims' outlines meet to within a hair they never fight)
    for (const q of mine) b.with({ tint: q.id.startsWith('ways/foot') ? FOOT_TINT : WAY_TINT }, () => b.slab(q.poly, FLOOR_Y + WAY_Y, MAT.PAVING));
  });

  // the ring road: its gates (kept clear of the caverns' portal, which opens off it beside one cutting) and its lamps
  const portal = PORTS.find((p) => p.id === 'citadel/portal')!, pa = CAVERNS.portal.angle, pHalf = ((portal.width / 2 + 4) / WAYS.ring.r0) / DEG;
  const gates = RIDGE_CUTS.filter((cut) => RIDGES[cut.ridge].kind === 'trunk').map((cut) => {
    let a = Math.atan2(cut.at[1] - STAR.cz, cut.at[0] - STAR.cx) / DEG;
    const d = ((a - pa + 540) % 360) - 180;
    if (Math.abs(d) < pHalf) a = pa + Math.sign(d || -1) * pHalf;
    return a;
  });
  const gateCols = gates.map((a, i) => b.owner(`gate-${i}`, () => {
    let col!: Collide;
    b.group(() => {
      const R = PLATEAU.ring.r, [x, z] = [STAR.cx + Math.cos(a * DEG) * R, STAR.cz + Math.sin(a * DEG) * R];
      b.at(x, FLOOR_Y, z, -a * DEG);
      col = c.collide(`city/ring-gate-${i}`);
      ridgeGate(c, col, chordR(WAYS.ring.r0, a) - R + 0.3, chordR(WAYS.ring.r1, a) - R - 0.3, new Rng(seed + 31 * i));
    });
    return { a, col };
  }));
  b.owner('lamps', () => {
    const g = [...new Set(RING_ANGLES.map((x) => ((x % 360) + 360) % 360))].sort((p, q) => p - q);
    for (let i = 0; i < g.length; i++) {
      const m = (g[i] + (i + 1 < g.length ? g[i + 1] : g[0] + 360)) / 2;
      const near = (x: number, w: number) => Math.abs(((m - x + 540) % 360) - 180) < w;
      // (none in the stair's forecourt, before the portal, under a gate)
      if (near(90 + STAR.rot, 6) || near(pa, 3) || gates.some((x) => near(x, 2.5))) continue;
      const r = chordR(WAYS.ring.r1, m) - 1.4, own = gateCols.reduce((p, q) => (Math.abs(((m - q.a + 540) % 360) - 180) < Math.abs(((m - p.a + 540) % 360) - 180) ? q : p));
      b.group(() => {
        b.at(STAR.cx + Math.cos(m * DEG) * r, FLOOR_Y, STAR.cz + Math.sin(m * DEG) * r, -m * DEG);
        b.place('lantern-post', [0, WAY_Y, 0], { scale: 1.35 });
        own.col.solidIn(b, -0.24, -0.24, 0.24, 0.24, 0, 3.6);
      });
    }
  });

  // each point's square at its spoke's foot and its avenue, in the point's frame (x out along the spoke from the
  // square's middle, z across it)
  for (const p of POINTS) {
    const runs = mine.filter((q) => q.id === `ways/avenue-${p.name}` || q.id === `ways/avenue-${p.name}-out`);
    const foot = mine.find((q) => q.id === `ways/foot-${p.name}`);
    if (!foot) continue;
    b.owner(`avenue-${p.name}`, () => b.group(() => {
      const [ox, oz] = inPoint(p, WAYS.foot.r, 0);
      b.at(ox, FLOOR_Y, oz, -p.tip * DEG);
      const col = c.collide(`city/avenue-${p.name}`);
      footSquare(c, col, rng);
      for (const q of runs) {
        const us = q.poly.map(([x, z]) => pointFrame(p, x, z)[0] - WAYS.foot.r);
        const u0 = Math.min(...us), u1 = Math.max(...us), side = WAYS.avenue / 2 - 1.6;
        const n = Math.floor((u1 - u0 - 6) / 12);
        if (n < 1) continue;
        const step = (u1 - u0 - 6) / n;
        for (let k = 0; k <= n; k++) {
          const x = u0 + 3 + k * step;
          for (const s of [-1, 1]) palmPlanter(c, col, x, s * side);
          // (a lamp between every other pair, on either side in turn)
          if (k < n && k % 2 === 0) {
            const s = (k / 2) % 2 === 0 ? -1 : 1, px = x + step / 2;
            b.place('lantern-post', [px, WAY_Y, s * side], { scale: 1.35 });
            col.solid(px - 0.24, s * side - 0.24, px + 0.24, s * side + 0.24, 0, 3.6);
          }
        }
      }
    }));
  }
}

/** a square stone planter (in the current frame) with a palm in it */
function palmPlanter(c: City, col: Collide, x: number, z: number, kind: 'palms' | 'cypress' | 'blossom' = 'palms') {
  const b = c.b, s = 0.75, h = 0.6;
  b.cappedBox(x - s, -0.3, z - s, x + s, h, z + s, MAT.ASHLAR, { mat: MAT.CREAM, h: 0.12, out: 0.05, top: MAT.SOIL });
  c.bed([[x - s + 0.15, z - s + 0.15], [x + s - 0.15, z - s + 0.15], [x + s - 0.15, z + s - 0.15], [x - s + 0.15, z + s - 0.15]], h, kind, 1);
  col.solid(x - s - 0.05, z - s - 0.05, x + s + 0.05, z + s + 0.05, 0, h);
}

/** a square at a spoke's foot (in its point's frame, centred): an inner ring of darker flags, a fountain in an
 *  eight-sided basin, palms in planters round it, lamps at its corners */
function footSquare(c: City, col: Collide, rng: Rng) {
  const b = c.b, r = 4.4;
  b.with({ tint: [0.84, 0.7, 0.6] }, () => b.slab(ngon(0, 0, 11.5, 16, Math.PI / 16), WAY_Y + 0.025, MAT.PAVING));
  // the basin: its wall, its rim, the water's floor, a column with a bowl and a jet
  b.cylinder(0, 0, r + 0.45, 0, 0.62, 8, MAT.CREAM, { top: null });
  basinRim(c, 0, 0, r, 0.45, 0.12, 0.62, 8);
  b.slab(ngon(0, 0, r, 8), 0.14, MAT.POOL);
  b.cylinder(0, 0, 0.45, 0.14, 2.1, 8, MAT.CREAM, { top: null });
  b.cylinder(0, 0, 0.45, 2.1, 2.4, 12, MAT.CREAM, { r1: 1.5, top: MAT.POOL });
  b.cylinder(0, 0, 0.22, 2.4, 3.1, 8, MAT.CREAM, { r1: 0.12 });
  c.pool(ngon(0, 0, r, 8), 0.5, 0.36);
  col.solid(-r - 0.45, -r - 0.45, r + 0.45, r + 0.45, 0, 0.62);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    palmPlanter(c, col, sx * 10, sz * 10, rng.chance(0.25) ? 'cypress' : 'palms');
    b.place('lantern-post', [sx * 15, WAY_Y, sz * 15], { scale: 1.35 });
    col.solid(sx * 15 - 0.24, sz * 15 - 0.24, sx * 15 + 0.24, sz * 15 + 0.24, 0, 3.6);
  }
}

/** an arch over the ring road where it crosses a ridge's cutting (in its frame: x out across the road from the citadel's
 *  foot, xi, to the ridge's end, xo; z along the road): two piers and a pointed arch between them, a cream archivolt
 *  round it on both faces, a band of tile over it, a coping crested with merlons, a lantern hung in it */
function ridgeGate(c: City, col: Collide, xi: number, xo: number, rng: Rng) {
  const b = c.b, T = 1.8, pw = 2.6, y0 = -0.4, H = 13.2, crown = 11, span = xo - xi;
  const mat = rng.chance(0.5) ? MAT.PLASTER_WARM : MAT.PLASTER;
  const pal = rng.pick([TILE_PAL.HOUSE, TILE_PAL.HOUSE_BLUE]);
  for (const s of [1, -1] as const) {
    const f = s > 0 ? new Face(b, [xi, T], [xo, T], y0, H - y0) : new Face(b, [xo, -T], [xi, -T], y0, H - y0);
    // (the passage's reveals from the one face through to the other, only the hole in that one; no floor over the road's)
    f.wall(mat, [{ u0: pw, u1: span - pw, v0: 0, top: crown - y0, arch: 'pointed', depth: s > 0 ? 2 * T : 0.01, fill: null, floor: false, frame: MAT.CREAM, frameW: 0.5 }]);
    band(c, f, pw - 0.3, crown - y0 + 0.75, span - pw + 0.3, H - y0 - 0.45, pal);
  }
  // its ends: against the citadel's foot and the ridge's rock
  new Face(b, [xi, -T], [xi, T], y0, H - y0).wall(mat, []);
  new Face(b, [xo, T], [xo, -T], y0, H - y0).wall(mat, []);
  b.box(xi - 0.15, H, -T - 0.2, xo + 0.15, H + 0.45, T + 0.2, MAT.CREAM);
  for (let x = xi + 0.6; x <= xo - 0.5; x += 1.05) for (const s of [-1, 1]) b.place('merlon-stepped', [x, H + 0.45, s * (T + 0.02)], { scale: 0.85 });
  b.place('lantern-hanging', [(xi + xo) / 2, crown - 0.05, 0], { scale: 1.4 });
  col.solid(xi, -T, xi + pw, T, y0, H + 0.45).solid(xo - pw, -T, xo, T, y0, H + 0.45).solid(xi + pw, -T, xo - pw, T, crown - 0.4, H + 0.45);
  col.floor(xi - 0.15, -T - 0.2, xo + 0.15, T + 0.2, H + 0.45);
}
