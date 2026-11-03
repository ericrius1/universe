// The planting of one terrace: sunken parterre bays between the walks, each held by a terracotta kerb with a cream cap
// and laid out after one of a few formal patterns (a lawn with a flower border and blossom trees, a lotus pool in a
// lawn, a four-square round a fountain, stripes of flowers, an orchard), mirrored about the wedge's spine. The bays'
// soil and lawn are modelled (so the gardens read before the flora grows) and handed to the flora as beds: lawns,
// flower borders with a palette, shrubs, and one small bed per tree (a blossom tree or a cypress stands at its centre).
import { MAT, type GardenBed, type Mat } from '../arch/types';
import type { V2 } from '../world/layout';
import type { Haul } from './colliders';
import { BED, COPING, POOL_FLOOR, WATER } from './plan';
import { pt, sectorPair, type Lim, type Shapes } from './shapes';

export type BayKind = 'lawn' | 'pool' | 'quad' | 'stripes' | 'orchard';
export const BAY_KINDS: BayKind[] = ['lawn', 'pool', 'quad', 'stripes', 'orchard'];
const PALETTES: NonNullable<GardenBed['palette']>[] = ['pink', 'white', 'gold', 'purple', 'mixed'];

/** one bay: between radii ra and rb and side limits lo and hi, its walks at walk and its floor (the carved terrace
 *  floor) at floor */
export interface Bay { ra: number; rb: number; lo: Lim; hi: Lim; floor: number; walk: number; kind: BayKind; palette: number; seed: () => number }

const KERB = 0.45;

export function bay(s: Shapes, haul: Haul, y: Bay) {
  const { ra, rb, lo, hi, floor } = y;
  const bed = floor + BED, kerbTop = y.walk + 0.15;
  const [outer, inner] = sectorPair(ra, rb, lo, hi, KERB);
  s.ring(outer, inner, y.walk, bed, kerbTop, MAT.PLASTER, MAT.CREAM, 0.12);
  const a = ra + KERB, b = rb - KERB, l: Lim = (r) => lo(r) + KERB / r, h: Lim = (r) => hi(r) - KERB / r;
  const pal = (k: number) => PALETTES[(y.palette + k) % PALETTES.length];
  const wide = (r: number) => (h(r) - l(r)) * r;
  // (a pattern that insets its outline needs the room for it at both ends: in a narrower bay the inset outline crossed
  // itself, its faces folded over against their winding — such a bay is a lawn)
  const room = Math.min(wide(a), wide(b), wide((a + b) / 2));
  const fits: Record<BayKind, number> = { lawn: 2 * 1.5 + 1, pool: 2 * 2.3 + 3, quad: 4, stripes: 1, orchard: 2 * 1.2 + 1 };
  if (room < fits[y.kind]) { lawn(s, haul, a, b, l, h, bed); return; }
  switch (y.kind) {
    case 'lawn': {
      const bw = 1.5;
      // (the lawn laid in the border's own inner outline: drawn afresh, its arcs cut at other points crossed the border's)
      lawnIn(s, haul, border(s, haul, a, b, l, h, bw, bed, MAT.SOIL, 'flowers', 0.85, pal(0)), bed);
      const mid = (a + b) / 2, n = Math.max(1, Math.round(wide(mid) / 9));
      for (let i = 0; i < n; i++) tree(haul, pt(mid, l(mid) + ((i + 0.5) / n) * (h(mid) - l(mid))), bed, 'blossom', 1.6);
      corners(haul, b, l, h, bed, 1.4);
      break;
    }
    case 'pool': {
      const rim = 2.3;
      lawn(s, haul, a, b, l, h, bed, rim);
      pool(s, haul, a + rim, b - rim, inset(l, rim), inset(h, -rim), floor, bed, y.seed() < 0.75);
      corners(haul, b, l, h, bed, 1.1);
      break;
    }
    case 'quad': {
      const mid = (a + b) / 2, half = 0.8;
      const mlo: Lim = (r) => (l(r) + h(r)) / 2 - half / r, mhi: Lim = (r) => (l(r) + h(r)) / 2 + half / r;
      const path = floor + 0.4;
      // the crossing paths (gravel a little above the beds) and the four beds between them (flat's left is the left of
      // travel on the map: the outer arc of a path running toward larger angles, the low side of one running outward)
      s.flat(arcPath(mid + half, l, h), arcPath(mid - half, l, h), path, path, MAT.PAVING);
      s.flat(sidePath(mlo, a, b), sidePath(mhi, a, b), path, path, MAT.PAVING);
      const quads: [number, number, Lim, Lim][] = [[a, mid - half, l, mlo], [a, mid - half, mhi, h], [mid + half, b, l, mlo], [mid + half, b, mhi, h]];
      quads.forEach(([q0, q1, ql, qh], i) => {
        if (i === 0 || i === 3) lawn(s, haul, q0, q1, ql, qh, bed);
        else beds(s, haul, q0, q1, ql, qh, bed, MAT.SOIL, 'flowers', 0.9, pal(i));
      });
      fountain(s, haul, pt(mid, (l(mid) + h(mid)) / 2), floor, bed);
      corners(haul, b, l, h, bed, 1.0);
      break;
    }
    case 'stripes': {
      const n = Math.max(2, Math.round((b - a) / 3.2));
      const step = (b - a) / n;
      for (let i = 0; i < n; i++) {
        const r0 = a + i * step, r1 = r0 + step;
        if (i % 2 === 0) beds(s, haul, r0, r1, l, h, bed, MAT.SOIL, 'flowers', 0.95, pal(i >> 1));
        else lawn(s, haul, r0, r1, l, h, bed);
      }
      break;
    }
    case 'orchard': {
      const bw = 1.2;
      lawnIn(s, haul, border(s, haul, a, b, l, h, bw, bed, MAT.SOIL, 'shrubs', 0.7), bed);
      const rows = Math.max(1, Math.round((b - a - 2 * bw) / 6.5));
      for (let j = 0; j < rows; j++) {
        const r = a + bw + ((j + 0.5) / rows) * (b - a - 2 * bw);
        const n = Math.max(1, Math.round(wide(r) / 6.5));
        for (let i = 0; i < n; i++) tree(haul, pt(r, l(r) + ((i + 0.5 + (j % 2) * 0.25) / (n + 0.25)) * (h(r) - l(r))), bed, y.seed() < 0.5 ? 'blossom' : 'trees', 1.4);
      }
      break;
    }
  }
}

/** a side limit moved d metres toward the inside (d > 0 moves the low side up, d < 0 the high side down) */
const inset = (lim: Lim, d: number): Lim => (r) => lim(r) + d / r;

const arcPath = (r: number, lo: Lim, hi: Lim): V2[] => {
  const n = Math.max(1, Math.ceil(((hi(r) - lo(r)) * r) / 3));
  return Array.from({ length: n + 1 }, (_, i) => pt(r, lo(r) + ((hi(r) - lo(r)) * i) / n));
};
const sidePath = (lim: Lim, ra: number, rb: number): V2[] => {
  const n = Math.max(1, Math.ceil((rb - ra) / 3));
  return Array.from({ length: n + 1 }, (_, i) => { const r = ra + ((rb - ra) * i) / n; return pt(r, lim(r)); });
};

/** the sector's outline as one polygon, for a bed or a slab */
function outline(ra: number, rb: number, lo: Lim, hi: Lim): V2[] {
  return sectorPair(ra, rb, lo, hi, 0)[0];
}

/** a lawn (modelled, and a bed for the grass), optionally a ring round a hole inset by `ring` */
function lawn(s: Shapes, haul: Haul, ra: number, rb: number, lo: Lim, hi: Lim, y: number, ring = 0) {
  if (rb - ra < 0.4) return;
  if (ring > 0) { border(s, haul, ra, rb, lo, hi, ring, y, MAT.LAWN, 'lawn', 1); return; }
  lawnIn(s, haul, outline(ra, rb, lo, hi), y);
}

/** a lawn over an outline */
function lawnIn(s: Shapes, haul: Haul, p: V2[], y: number) {
  s.slab(p, y, MAT.LAWN);
  haul.beds.push({ poly: p, y, kind: 'lawn', density: 1 });
}

/** a planted bed (soil) handed over whole */
function beds(s: Shapes, haul: Haul, ra: number, rb: number, lo: Lim, hi: Lim, y: number, mat: Mat, kind: GardenBed['kind'], density: number, palette?: GardenBed['palette']) {
  if (rb - ra < 0.4) return;
  const p = outline(ra, rb, lo, hi);
  s.slab(p, y, mat);
  haul.beds.push({ poly: p, y, kind, density, ...(palette ? { palette } : {}) });
}

/** a border of width w round the sector's inside, modelled as a ring and handed over as its four sides; its inner
 *  outline (what's inside it is laid in that, edge to edge) */
function border(s: Shapes, haul: Haul, ra: number, rb: number, lo: Lim, hi: Lim, w: number, y: number, mat: Mat, kind: GardenBed['kind'], density: number, palette?: GardenBed['palette']): V2[] {
  const [o, i] = sectorPair(ra, rb, lo, hi, w);
  s.flat([...i, i[0]], [...o, o[0]], y, y, mat);
  const li = inset(lo, w), hi2 = inset(hi, -w);
  const parts: V2[][] = [
    outline(ra, ra + w, lo, hi), outline(rb - w, rb, lo, hi),
    outline(ra + w, rb - w, lo, li), outline(ra + w, rb - w, hi2, hi),
  ];
  for (const p of parts) haul.beds.push({ poly: p, y, kind, density, ...(palette ? { palette } : {}) });
  return i;
}

/** a lotus pool: a cream coping round mosaic, the water, and its lilies */
function pool(s: Shapes, haul: Haul, ra: number, rb: number, lo: Lim, hi: Lim, floor: number, bed: number, lotus: boolean) {
  if (rb - ra < 2) return;
  const [o, i] = sectorPair(ra, rb, lo, hi, 0.4);
  s.ring(o, i, bed, floor + POOL_FLOOR, floor + COPING, MAT.CREAM, MAT.CREAM, 0.1);
  s.slab(i, floor + POOL_FLOOR, MAT.POOL);
  haul.water.push({ kind: 'pool', poly: i, level: floor + WATER, depth: WATER - POOL_FLOOR });
  if (lotus) haul.beds.push({ poly: i, y: floor + WATER, kind: 'lotus', density: 0.35 });
}

/** a small round fountain basin with a bowl on a stem */
function fountain(s: Shapes, haul: Haul, c: V2, floor: number, bed: number) {
  const b = s.b, n = 16, R = 1.6;
  const ring = (r: number) => Array.from({ length: n }, (_, i) => [c[0] + Math.cos((i / n) * 2 * Math.PI) * r, c[1] + Math.sin((i / n) * 2 * Math.PI) * r] as V2);
  // (a circle's points run counter-clockwise on the map like the sectors')
  const o = ring(R).reverse(), i = ring(R - 0.35).reverse();
  s.ring(o, i, bed, floor + POOL_FLOOR, floor + COPING, MAT.CREAM, MAT.CREAM, 0.1);
  s.slab(i, floor + POOL_FLOOR, MAT.POOL);
  b.cylinder(c[0], c[1], 0.2, floor + POOL_FLOOR, floor + 1.3, 8, MAT.CREAM);
  b.lathe(c[0], floor + 1.3, c[1], [[0.15, 0], [0.55, 0.12], [0.75, 0.3], [0.72, 0.36], [0.5, 0.3], [0, 0.3]], 12, MAT.CREAM);
  haul.water.push({ kind: 'pool', poly: i, level: floor + WATER, depth: WATER - POOL_FLOOR });
}

/** a tree's bed: a small square at p (the flora plants one tree at its centre) */
function tree(haul: Haul, p: V2, y: number, kind: GardenBed['kind'], half: number) {
  haul.beds.push({ poly: [[p[0] - half, p[1] - half], [p[0] + half, p[1] - half], [p[0] + half, p[1] + half], [p[0] - half, p[1] + half]], y, kind, density: 1 });
}

/** cypresses at a bay's outer corners */
function corners(haul: Haul, b: number, l: Lim, h: Lim, y: number, d: number) {
  const r = b - d;
  tree(haul, pt(r, l(r) + d / r), y, 'cypress', 0.7);
  tree(haul, pt(r, h(r) - d / r), y, 'cypress', 0.7);
}
