// What lies between the houses: the city's floor (packed reddish flags inside the wall), the streets paved in cream
// over it, the courtyards in the middle of the blocks (gardens, a pool and fountain in the rich ones, a well in the
// humble), the neighbourhood squares (a fountain or a great tree, a small domed shrine, lamps), the lantern strings
// tied across the streets between the houses' upper floors, and now and then an arch or a little bridging room thrown
// over an alley.
import type { V3 } from '../arch/types';
import { MAT } from '../arch/types';
import { FLOOR_Y, WALL, type V2 } from '../world/layout';
import type { City, Collide } from './ctx';
import { Face } from './facade';
import { area, bbox, centroid, inset, ngon, type Poly } from './geom';
import type { Skyline } from './houses';
import type { CityPlan, Lot, Street } from './plan';
import { CLOTHS, GLAZES, dome, lanternBody, lanternString, planter } from './props';
import { Rng } from './rng';

/** the heights of the city's floor layers (over FLOOR_Y): the earth flags, the paved streets, the squares' paving */
export const FLOOR = { earth: 0.02, street: 0.045, square: 0.07 };
const STREET_TINT: V3 = [1.06, 1.0, 0.94];
const EARTH_TINT: V3 = [0.84, 0.6, 0.48];

export function buildFloor(c: City) {
  const b = c.b;
  const n = 128;
  const ring = Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return [WALL.cx + Math.cos(t) * (WALL.rx - 1), WALL.cz + Math.sin(t) * (WALL.rz - 1)] as V2;
  });
  b.with({ tint: EARTH_TINT }, () => b.slab(ring, FLOOR_Y + FLOOR.earth, MAT.PAVING));
}

/** the streets of rank 2 and up paved in cream over the floor */
export function paveStreets(c: City, streets: Street[]) {
  const b = c.b;
  b.with({ tint: STREET_TINT }, () => {
    for (const s of streets) {
      if (s.rank < 2) continue;
      const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L = Math.hypot(dx, dz);
      if (L < 1) continue;
      const nx = (-dz / L) * (s.width / 2 + 0.6), nz = (dx / L) * (s.width / 2 + 0.6);
      const ex = (dx / L) * (s.width / 2), ez = (dz / L) * (s.width / 2);
      const y = FLOOR_Y + FLOOR.street;
      // (wound to face up)
      b.poly([[s.a[0] - nx - ex, y, s.a[1] - nz - ez], [s.a[0] + nx - ex, y, s.a[1] + nz - ez], [s.b[0] + nx + ex, y, s.b[1] + nz + ez], [s.b[0] - nx + ex, y, s.b[1] - nz + ez]], MAT.PAVING);
    }
  });
}

/** a courtyard in the middle of a block: paved, a garden, and by the block's wealth a pool and fountain or a well */
export function courtyard(c: City, col: Collide, lot: Lot) {
  const b = c.b, rng = new Rng(lot.seed);
  const q = lot.poly, w = lot.wealth, A = area(q.p);
  if (A < 12) return;
  b.with({ tint: [1.0, 0.92, 0.84] }, () => b.slab(q.p, FLOOR.square, MAT.PAVING));
  const [x0, z0, x1, z1] = bbox(q.p);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sz = z1 - z0;
  const rectLike = q.p.length === 4 && A > 0.9 * sx * sz;
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
  if (w < 0.4 && rng.chance(0.35) && sx > 5 && sz > 5) {
    const [wx, wz] = [x0 + 1.3, z0 + 1.3];
    b.cylinder(wx, wz, 0.75, 0, 0.85, 10, MAT.ASHLAR, { top: null });
    b.cylinder(wx, wz, 0.55, 0.6, 0.85, 10, MAT.ASHLAR, { top: MAT.WINDOW });
    b.box(wx - 0.7, 0.85, wz - 0.05, wx - 0.6, 2.2, wz + 0.05, MAT.WOOD).box(wx + 0.6, 0.85, wz - 0.05, wx + 0.7, 2.2, wz + 0.05, MAT.WOOD).box(wx - 0.75, 2.2, wz - 0.06, wx + 0.75, 2.3, wz + 0.06, MAT.WOOD);
    col.solid(wx - 0.75, wz - 0.75, wx + 0.75, wz + 0.75, 0, 0.85);
  }
}

/** a rectangular pool (centre, half sizes) with a cream rim and a fountain column in the middle; its water */
export function pool(c: City, col: Collide | null, cx: number, cz: number, hx: number, hz: number, rimH: number, o: { fountain?: boolean; y?: number } = {}) {
  const b = c.b, y = o.y ?? FLOOR.square;
  const rw = 0.4;
  b.box(cx - hx - rw, y, cz - hz - rw, cx + hx + rw, y + rimH, cz - hz, MAT.CREAM, { skip: ['bottom'] });
  b.box(cx - hx - rw, y, cz + hz, cx + hx + rw, y + rimH, cz + hz + rw, MAT.CREAM, { skip: ['bottom'] });
  b.box(cx - hx - rw, y, cz - hz, cx - hx, y + rimH, cz + hz, MAT.CREAM, { skip: ['bottom', 'n', 's'] });
  b.box(cx + hx, y, cz - hz, cx + hx + rw, y + rimH, cz + hz, MAT.CREAM, { skip: ['bottom', 'n', 's'] });
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
      b.cylinder(0, 0, r + 0.4, FLOOR.square, 0.6, 8, MAT.CREAM, { top: MAT.CREAM });
      b.cylinder(0, 0, r, 0.1, 0.6, 8, MAT.POOL, { top: null });
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
    // lamps on posts round it
    for (let k = 0; k < 4; k++) {
      const aa = a + Math.PI / 4 + (k / 4) * Math.PI * 2, rr = r * 0.75;
      lampPost(c, col, Math.cos(aa) * rr, Math.sin(aa) * rr, 3.4);
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

/** lantern strings tied across the streets between upper floors, and the arches thrown over alleys */
export function streetLife(c: City, plan: CityPlan, sky: Skyline, seed: number) {
  const rng = new Rng(seed);
  const tints: V3[] = [[1.3, 0.5, 0.2], [1.3, 0.8, 0.25], [1.1, 0.3, 0.3], [1.25, 0.65, 0.3]];
  let arches = 0;
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
      // an alley now and then gets an arch over it instead
      if (s.rank === 1 && arches < 140 && rng.chance(0.12) && hA > 6.5 && hB > 6.5) {
        alleyArch(c, [mx + nx * (s.width / 2 + 0.02), mz + nz * (s.width / 2 + 0.02)], [mx - nx * (s.width / 2 + 0.02), mz - nz * (s.width / 2 + 0.02)], Math.min(hA, hB), rng, arches++);
        continue;
      }
      // or a washing line
      if (s.rank === 1 && rng.chance(0.1)) { washing(c, [A[0] - nx * 0.4, y - 1.2, A[1] - nz * 0.4], [B[0] + nx * 0.4, y - 1.2, B[1] + nz * 0.4], rng); continue; }
      if (!rng.chance(s.rank === 1 ? 0.55 : 0.5)) continue;
      const a3: V3 = [A[0] - nx * 0.4, y, A[1] - nz * 0.4], b3: V3 = [B[0] + nx * 0.4, y + rng.range(-0.6, 0.6), B[1] + nz * 0.4];
      lanternString(c, a3, b3, rng.range(0.5, 1.1), 1.5, [rng.pick(tints), rng.pick(tints), rng.pick(tints)], 6);
      // (now and then a strip of cloth bunting beside it)
      if (rng.chance(0.25)) bunting(c, [a3[0], a3[1] + 0.6, a3[2]], [b3[0], b3[1] + 0.6, b3[2]], rng);
    }
  }
}

/** an arch over an alley between two houses' walls (plan points on each face), or a little room bridging it */
function alleyArch(c: City, a: V2, z: V2, h: number, rng: Rng, idx: number) {
  const b = c.b;
  const L = Math.hypot(z[0] - a[0], z[1] - a[1]);
  b.group(() => {
    b.at(a[0], FLOOR_Y, a[1], Math.atan2(-(z[1] - a[1]), z[0] - a[0]));
    const col = c.collide(`city/arch-${idx}`);
    const d = rng.range(1.6, 3.2);
    const room = h > 8.5 && rng.chance(0.45);
    const arch = room ? 'round' as const : 'pointed' as const;
    const crown = rng.range(3.1, 3.7) + (room ? L / 2 : L * 0.74);
    const top = room ? crown + 3.0 : crown + rng.range(0.7, 1.2);
    if (top > h - 0.3) return;
    const mat = rng.chance(0.5) ? MAT.PLASTER : MAT.PLASTER_WARM;
    // (local x across the alley from a to z, z along it; the arch's faces look up and down the alley)
    for (const s of [-1, 1] as const) {
      const f = s > 0 ? new Face(b, [0, d / 2], [L, d / 2], 0, top) : new Face(b, [L, -d / 2], [0, -d / 2], 0, top);
      f.wall(mat, [{ u0: 0.01, u1: L - 0.01, v0: 0, top: crown, arch, depth: s > 0 ? d : 0, fill: null }]);
    }
    b.box(-0.05, top, -d / 2 - 0.1, L + 0.05, top + 0.25, d / 2 + 0.1, MAT.CREAM, { skip: ['w', 'e'] });
    if (room) {
      // windows in the bridging room's faces, lit at night
      for (const s of [-1, 1] as const) {
        const f = s > 0 ? new Face(b, [0, d / 2], [L, d / 2], 0, top) : new Face(b, [L, -d / 2], [0, -d / 2], 0, top);
        b.with({ glow: rng.chance(0.6) ? 0.8 : 0 }, () => f.rect(L / 2 - 0.5, top - 2.3, L / 2 + 0.5, top - 0.9, -0.012, MAT.WINDOW));
      }
    }
    col.solid(0, -d / 2, L, d / 2, crown, top + 0.25).floor(0, -d / 2, L, d / 2, top + 0.25);
    if (rng.chance(0.5)) {
      const p = [L / 2, crown - 0.7, 0] as V3;
      lanternBody(c, p, 0.16, CLOTHS[0]);
      c.light(p, 40, { radius: 8 });
    }
  });
}

/** a washing line across an alley: cloths of all colours pegged along a sagging cord */
function washing(c: City, a: V3, z: V3, rng: Rng) {
  const b = c.b;
  const L = Math.hypot(z[0] - a[0], z[2] - a[2]), at = (t: number): V3 => [a[0] + (z[0] - a[0]) * t, a[1] + (z[1] - a[1]) * t - 0.45 * 4 * t * (1 - t), a[2] + (z[2] - a[2]) * t];
  const ux = (z[0] - a[0]) / L, uz = (z[2] - a[2]) / L;
  b.poly([at(0), at(0.5), [at(0.5)[0], at(0.5)[1] + 0.03, at(0.5)[2]], [a[0], a[1] + 0.03, a[2]]], MAT.WOOD);
  b.poly([at(0.5), at(1), [z[0], z[1] + 0.03, z[2]], [at(0.5)[0], at(0.5)[1] + 0.03, at(0.5)[2]]], MAT.WOOD);
  for (let t = rng.range(0.08, 0.2); t < 0.9; t += rng.range(0.12, 0.22)) {
    const p = at(t), w = rng.range(0.4, 0.9), h = rng.range(0.5, 1.1);
    const q: V3[] = [[p[0] - ux * w / 2, p[1] - h, p[2] - uz * w / 2], [p[0] + ux * w / 2, p[1] - h, p[2] + uz * w / 2], [p[0] + ux * w / 2, p[1], p[2] + uz * w / 2], [p[0] - ux * w / 2, p[1], p[2] - uz * w / 2]];
    b.with({ tint: rng.pick([...CLOTHS, [1.25, 1.2, 1.1] as V3]) }, () => { b.poly(q, MAT.CLOTH); b.poly([...q].reverse(), MAT.CLOTH); });
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

