// The two courts on the avenue either side of the hall (plan.ts COURT), each a round of finer paving with an inlaid
// ring of tiles:
//   - toward the ring road (east), the fountain court: a great eight-sided basin with a fountain of two bowls in it,
//     stone benches round it, four palms in planters and four lamp posts;
//   - toward the tip (west), the pavilions: eight little domed kiosks on slender columns in a ring, each a stall of its
//     own under an awning, round a small fountain whose mast carries strings of lanterns out to every kiosk's dome.
// The avenue runs across both (round the fountains). Laid in the market's frame, under 'market/court'.
import { annulus } from '../../arch/parts';
import { MAT, TILE_PAL, type Mat, type V3 } from '../../arch/types';
import type { City, Collide } from '../ctx';
import { planter } from '../props';
import type { Rng } from '../rng';
import { GOODS, lay } from './goods';
import { CLOTH, block, cloth, domeOf, gon, shaft, strand } from './kit';
import { COURT, PAVE } from './plan';

export function buildCourts(c: City, rng: Rng) {
  const b = c.b;
  b.owner('court', () => {
    const col = c.collide('city/market-courts');
    for (const [k, q] of [['east', COURT.east], ['west', COURT.west]] as const) {
      paving(c, q.x, q.z, q.r);
      if (k === 'east') fountainCourt(c, col, q.x, q.z, rng);
      else pavilions(c, col, q.x, q.z, rng);
    }
  });
}

/** a court's round of paving over the avenue's and the square's, its inlaid rings of tile, its kerb */
function paving(c: City, x: number, z: number, r: number) {
  const b = c.b, y = PAVE.court;
  b.with({ tint: [1.08, 1.0, 0.9] }, () => b.slab(gon(x, z, r, 24), y, MAT.PAVING));
  b.cylinder(x, z, r, PAVE.square, y, 24, MAT.ASHLAR, { top: null });
  // (the tiles' ring a step over the paving, its edges down to it)
  b.with({ pal: TILE_PAL.FOUNTAIN }, () => {
    const r0 = r * 0.62, r1 = r * 0.7;
    ringFlat(b, x, z, r0, r1, y + 0.02, 24, MAT.TILE_BORDER);
    b.cylinder(x, z, r1, y, y + 0.02, 24, MAT.CREAM, { top: null });
    inward(b, x, z, r0, y, y + 0.02, 24, MAT.CREAM);
  });
}

/** a flat ring facing up from r0 to r1 at y, in n sides */
function ringFlat(b: City['b'], x: number, z: number, r0: number, r1: number, y: number, n: number, mat: Mat) {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p = (a: number, r: number): V3 => [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
    b.quad(p(a1, r0), p(a1, r1), p(a0, r1), p(a0, r0), mat);
  }
}

/** a cylinder's wall seen from inside (a basin's, a ring's inner edge), n sides */
function inward(b: City['b'], x: number, z: number, r: number, y0: number, y1: number, n: number, mat: Mat) {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p = (a: number, y: number): V3 => [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
    b.quad(p(a0, y0), p(a1, y0), p(a1, y1), p(a0, y1), mat);
  }
}

/** a basin at (x, z): its outer wall from the court's paving up to its rim, the rim's flat top, its inner wall down to
 *  its floor, its water; n sides */
function basin(c: City, x: number, z: number, r: number, h: number, n: number) {
  const b = c.b, y = PAVE.court, w = 0.45, floor = y + 0.12;
  b.with({ pal: TILE_PAL.FOUNTAIN }, () => b.cylinder(x, z, r + w, y, y + h - 0.12, n, MAT.TILE_BAND, { top: null }));
  b.cylinder(x, z, r + w + 0.06, y + h - 0.12, y + h, n, MAT.CREAM, { top: null });
  annulus(b, x, z, r, r + w + 0.06, y + h, n, MAT.CREAM);
  annulus(b, x, z, r + w, r + w + 0.06, y + h - 0.12, n, MAT.CREAM, true);
  inward(b, x, z, r, floor, y + h, n, MAT.POOL);
  b.slab(gon(x, z, r, n), floor, MAT.POOL);
  c.pool(gon(x, z, r - 0.02, n), y + h - 0.14, h - 0.26);
}

/** the fountain court: the basin and its two-bowled fountain, benches, palms, lamp posts */
function fountainCourt(c: City, col: Collide, x: number, z: number, rng: Rng) {
  const b = c.b, y = PAVE.court, R = 5.4;
  b.owner('fountain', () => {
    basin(c, x, z, R, 0.72, 16);
    // the fountain: a stem, the great bowl, a second stem, the little bowl, the jet's crown
    const f = y + 0.12;
    b.cylinder(x, z, 0.55, f, f + 1.3, 12, MAT.CREAM, { r1: 0.32, top: null });
    b.cylinder(x, z, 0.4, f + 1.25, f + 1.62, 16, MAT.CREAM, { r1: 1.9, top: null, bottom: true });
    b.with({ pal: TILE_PAL.FOUNTAIN }, () => b.slab(gon(x, z, 1.82, 16), f + 1.56, MAT.TILE));
    inward(b, x, z, 1.82, f + 1.56, f + 1.62, 16, MAT.CREAM);
    ringFlat(b, x, z, 1.82, 1.9, f + 1.62, 16, MAT.CREAM);
    b.cylinder(x, z, 0.22, f + 1.56, f + 2.5, 10, MAT.CREAM, { r1: 0.16, top: null });
    b.cylinder(x, z, 0.2, f + 2.45, f + 2.7, 12, MAT.CREAM, { r1: 0.95, top: MAT.POOL, bottom: true });
    b.cylinder(x, z, 0.09, f + 2.7, f + 3.1, 8, MAT.GOLD, { r1: 0.03 });
    c.pool(gon(x, z, 1.8, 16), f + 1.6, 0.04);
    col.polySolid(gon(x, z, R + 0.5, 8, Math.PI / 8), 0, y + 0.72, 1.2);
  });
  // benches round it, between the avenue's way and the diagonals; palms in planters and lamp posts on the diagonals
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * Math.PI * 2;
    if (Math.abs(Math.sin(a)) < 0.5) continue;
    b.group(() => {
      b.at(x + Math.cos(a) * 8.2, 0, z + Math.sin(a) * 8.2, Math.atan2(Math.cos(a), Math.sin(a)));
      block(b, -1.3, y, -0.25, 1.3, y + 0.42, 0.25, MAT.ASHLAR, [], MAT.CREAM);
    });
    col.polySolid(gon(x + Math.cos(a) * 8.2, z + Math.sin(a) * 8.2, 1.1, 6), 0, y + 0.42);
  }
  for (let k = 0; k < 4; k++) {
    const a = ((k + 0.5) / 4) * Math.PI * 2, px = x + Math.cos(a) * 12.5, pz = z + Math.sin(a) * 12.5;
    planter(c, px, pz, 1.3, 0.62, 'palms', y);
    col.solid(px - 1.3, pz - 1.3, px + 1.3, pz + 1.3, 0, y + 0.74);
    const lx = x + Math.cos(a) * 15.2, lz = z + Math.sin(a) * 15.2;
    b.place('lantern-post', [lx, y, lz], { yaw: rng.range(0, 1) });
    col.solid(lx - 0.25, lz - 0.25, lx + 0.25, lz + 0.25, 0, 2.6);
  }
}

/** the pavilions: a ring of eight domed kiosks round a little fountain, lantern strings from its mast to them */
function pavilions(c: City, col: Collide, x: number, z: number, rng: Rng) {
  const b = c.b, y = PAVE.court, R = 12, mast = 9.2;
  b.owner('fountain', () => {
    basin(c, x, z, 2.4, 0.62, 12);
    // the mast in its middle, a gold ball on it
    b.cylinder(x, z, 0.32, y + 0.12, y + 0.9, 8, MAT.CREAM, { r1: 0.22, top: null });
    b.cylinder(x, z, 0.12, y + 0.9, mast, 6, MAT.WOOD, { r1: 0.08, top: null });
    b.place('finial-ball', [x, mast - 0.04, z], { scale: 0.8 });
    col.polySolid(gon(x, z, 2.9, 8, Math.PI / 8), 0, y + 0.62, 1.2);
  });
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * Math.PI * 2, px = x + Math.cos(a) * R, pz = z + Math.sin(a) * R;
    b.owner('kiosk', () => b.group(() => {
      // (facing the fountain: its front, +z, inward)
      b.at(px, 0, pz, Math.atan2(-Math.cos(a), -Math.sin(a)));
      kiosk(c, k, rng);
    }));
    col.polySolid(gon(px, pz, 2.6, 4, a + Math.PI / 4), 0, y + 1.25);
    // a string of lanterns from the mast to its cornice
    const top: V3 = [px - Math.cos(a) * 1.7, y + 3.75, pz - Math.sin(a) * 1.7], from: V3 = [x + Math.cos(a) * 0.15, mast - 0.6, z + Math.sin(a) * 0.15];
    strand(c, from, top, 0.9, 1.5, [CLOTH[k % CLOTH.length], CLOTH[(k + 3) % CLOTH.length], [1.3, 0.8, 0.25]], [3], 60, 11);
  }
}

/** a kiosk at the origin facing +z: a plinth, four columns, a cornice block, a dome; a counter and its goods inside,
 *  an awning out over its front, a lantern hung in it */
function kiosk(c: City, k: number, rng: Rng) {
  const b = c.b, y = PAVE.court, s = 1.55, h = 3.0, top = y + 0.3 + h;
  b.cappedBox(-s - 0.25, y, -s - 0.25, s + 0.25, y + 0.3, s + 0.25, MAT.ASHLAR, { mat: MAT.CREAM, h: 0.08, out: 0.04 });
  for (const [cx, cz] of [[-s, -s], [s, -s], [s, s], [-s, s]]) {
    shaft(b, cx, cz, 0.15, y + 0.3, top - 0.22, MAT.CREAM, 8);
    b.box(cx - 0.2, top - 0.22, cz - 0.2, cx + 0.2, top, cz + 0.2, MAT.CREAM, { skip: ['top'] });
  }
  // the cornice block on them: its sides, its ceiling, its top under the dome's drum; a teal band round it
  const e = s + 0.3;
  b.cappedBox(-e, top, -e, e, top + 0.62, e, MAT.PLASTER_WARM, { mat: MAT.CREAM, h: 0.14, out: 0.07 }, { bottom: true });
  for (const [ux, uz, nx, nz] of [[1, 0, 0, 1], [-1, 0, 0, -1], [0, -1, 1, 0], [0, 1, -1, 0]]) {
    const ox = nx * (e + 0.025), oz = nz * (e + 0.025), L = e - 0.05;
    b.patch([[ox - ux * L, top + 0.12, oz - uz * L], [ox + ux * L, top + 0.12, oz + uz * L], [ox + ux * L, top + 0.42, oz + uz * L], [ox - ux * L, top + 0.42, oz - uz * L]], [0, 1, 2, 0, 2, 3], MAT.TEAL, [nx, 0, nz], [ux, 0, uz]);
  }
  b.group(() => { b.at(0, top + 0.62, 0); domeOf(b, { r: 1.45, kind: k % 2 ? 'onion' : 'round', drum: 0.35, detail: 'mid', seed: 60 + k, glaze: [[1, 1, 1], [1.9, 1.75, 0.95], [0.72, 0.78, 1.08]][k % 3] as V3, tip: k % 2 ? 'spire' : 'lotus' }); });
  // the counter across the front, its goods; a lantern hung under the ceiling; a light in every other
  block(b, -s + 0.2, y + 0.3, s - 0.7, s - 0.2, y + 1.22, s - 0.15, MAT.WOOD);
  lay(c, GOODS[(k * 3 + 1) % GOODS.length], -s + 0.3, s - 0.3, s - 0.2, 0.45, y + 1.22, rng);
  b.place('lantern-hanging', [0, top, 0], { scale: 1.1 });
  // an awning over the front between the front columns' tops
  b.with({ tint: CLOTH[(k * 2) % CLOTH.length] }, () => cloth(b, [[[-s, top - 0.25, s + 0.2], [s, top - 0.25, s + 0.2]], [[-s, top - 0.75, s + 1.25], [s, top - 0.75, s + 1.25]]], MAT.CLOTH));
}

