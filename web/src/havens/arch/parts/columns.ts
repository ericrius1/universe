// Columns, free-standing, their foot's middle at the origin: a plinth, a base, the shaft, a capital and its abacus — the
// abacus's top at h, what an architrave or an arch's impost rests on (left off with `top: false`, as it is under
// anything laid on it). Four orders in the town's way:
//   'round'   a round shaft tapering a little on a moulded base (a torus over a scotia), a ringed bell capital under a
//             square abacus: the colonnades' deep red shafts on cream
//   'octagon' an eight-sided shaft on an eight-sided plinth, a stepped cap, gold rings (the arcades' and the courts')
//   'lotus'   a slender shaft on a flared foot, a gold bell of petals opening under its abacus (the temple's, the
//             palace's)
//   'pillar'  the grand hall's square red pillar (ref 1): a stepped cream base and cap, a lavender diamond set in each
//             face near its head and its foot
// Near: every moulding turned smooth, the petals, the rings, the diamonds' bevels; mid: the same shapes in a dozen
// sides, flat diamonds; far: a six-sided shaft under a block (about 30 triangles).
import type { ArchBuilder } from '../builder';
import { MAT, type Mat } from '../types';
import { annulus, begin, byDetail, facets, PROUD, revolve, type Detail, type Laid, type PartOpts, type Rand } from './kit';

export type Order = 'round' | 'octagon' | 'lotus' | 'pillar';

/** the hall's lavender (the bible's #A2A4D6) as a tint of MAT.PAINT: the lavender panels' own material fits a whole
 *  ornament panel to each face, too much picture for a diamond a hand across */
const LAVENDER: [number, number, number] = [0.36, 0.37, 0.67];

export interface ColumnOpts extends PartOpts {
  /** to the abacus's top (m) */
  h?: number;
  /** the shaft's radius at its foot (half its width for a pillar) */
  r?: number;
  order?: Order;
  /** the shaft's material (red for round and pillar, cream for octagon and lotus) */
  shaft?: Mat;
  /** the base's and the capital's */
  trim?: Mat;
  /** the lotus's bell and the rings (gold) */
  gilt?: Mat;
  /** the abacus's top drawn (false when something rests on it) */
  top?: boolean;
  /** a square plinth under the base (true) */
  plinth?: boolean;
}

/** a column's abacus: half its width, and its height (what an arcade springs from) */
export function abacusOf(o: ColumnOpts): { half: number; h: number } {
  const h = o.h ?? 4, r = o.r ?? h / 14, order = o.order ?? 'round';
  return order === 'pillar' ? { half: r * 1.38, h: r * 0.3 } : { half: r * (order === 'lotus' ? 1.75 : 1.5), h: r * 0.32 };
}

/** a column (see the header) */
export function column(b: ArchBuilder, o: ColumnOpts = {}): Laid {
  return b.owner('column', () => {
    const { d, rng } = begin(o);
    let out: Laid = { lights: [], top: 0 };
    // (a painter's hand: no two shafts quite the same colour)
    b.with({ tint: rng.vary(b.style.tint, 0.035) }, () => { out = lay(b, o, d, rng); });
    return out;
  });
}

/** the column itself, in the tint its seed gave it */
function lay(b: ArchBuilder, o: ColumnOpts, d: Detail, rng: Rand): Laid {
  const h = o.h ?? 4, r = (o.r ?? h / 14) * rng.range(0.97, 1.03), order = o.order ?? 'round';
  const shaft = o.shaft ?? (order === 'round' || order === 'pillar' ? MAT.RED : MAT.CREAM);
  const trim = o.trim ?? MAT.CREAM, gilt = o.gilt ?? MAT.GOLD;
  const ab = abacusOf({ ...o, r, order });
  const top = o.top === false ? ['top'] : [];
  // the abacus: a square block, its top at h (its bottom shows round the capital's flare)
  const ya = h - ab.h;
  b.box(-ab.half, ya, -ab.half, ab.half, h, ab.half, trim, { skip: top });
  if (order === 'pillar') { pillar(b, d, h, r, ya, shaft, trim, rng.range(0, 1)); return { lights: [], top: h }; }
  const pw = r * 1.42, ph = o.plinth === false ? 0 : r * 0.55;
  if (ph > 0) {
    if (order === 'octagon' && d !== 'far') facetsBox(b, pw, ph, trim);
    else b.box(-pw, 0, -pw, pw, ph, pw, trim, { skip: ['bottom'] });
  }
  if (d === 'far') {
    // a six-sided shaft from the plinth to the abacus
    facets(b, 0, 0, r * 1.05, r * 0.95, ph, ya, 6, shaft, Math.PI / 6);
    return { lights: [], top: h };
  }
  const sides = byDetail(d, order === 'octagon' ? 8 : 20, order === 'octagon' ? 8 : 12, 6);
  const taper = order === 'lotus' ? 0.92 : 0.88;
  const rt = r * taper;
  if (order === 'round') {
    // the base: a scotia between fillets under a torus, turned (near), or a plain ring (mid)
    const yb = ph + r * 0.55;
    if (d === 'near') revolve(b, 0, ph, 0, [[r * 1.34, 0], [r * 1.37, r * 0.07], [r * 1.36, r * 0.16], [r * 1.28, r * 0.24], [r * 1.12, r * 0.27], [r * 1.08, r * 0.33], [r * 1.14, r * 0.4], [r * 1.12, r * 0.47], [r * 1.04, r * 0.52], [r, r * 0.55]], sides, trim);
    else { b.cylinder(0, 0, r * 1.28, ph, ph + r * 0.4, sides, trim, { top: null }); annulus(b, 0, 0, r, r * 1.28, ph + r * 0.4, sides, trim); }
    const yb2 = d === 'near' ? yb : ph + r * 0.4;
    // the capital: an astragal ring at the neck, the bell flaring to the abacus
    const yc = ya - r * 0.85;
    b.cylinder(0, 0, r, yb2, yc, sides, shaft, { top: null, r1: rt });
    if (d === 'near') {
      revolve(b, 0, yc, 0, [[rt, 0], [rt * 1.09, r * 0.04], [rt * 1.12, r * 0.1], [rt * 1.08, r * 0.16], [rt * 1.02, r * 0.2], [rt * 1.04, r * 0.32], [rt * 1.14, r * 0.5], [r * 1.3, r * 0.68], [r * 1.42, r * 0.8], [r * 1.44, r * 0.85]], sides, trim);
      // gold rings round the shaft, a hand under the neck
      ring(b, rt * 0.99, yc - r * 0.7, r * 0.08, sides, gilt);
    } else b.cylinder(0, 0, rt, yc, ya, sides, trim, { top: null, r1: r * 1.4 });
    return { lights: [], top: h };
  }
  if (order === 'octagon') {
    const ph8 = Math.PI / 8;
    // the shaft's foot: an eight-sided step; the cap: two widening steps under the abacus
    const yb = ph + r * 0.3, yc = ya - r * 0.5;
    facets(b, 0, 0, r * 1.22, r * 1.22, ph, yb, 8, trim, ph8);
    annulus(b, 0, 0, r, r * 1.22, yb, 8, trim, false, ph8);
    facets(b, 0, 0, r, rt, yb, yc, 8, shaft, ph8);
    facets(b, 0, 0, rt * 1.12, rt * 1.12, yc, yc + r * 0.22, 8, trim, ph8);
    annulus(b, 0, 0, rt, rt * 1.12, yc, 8, trim, true, ph8);
    facets(b, 0, 0, rt * 1.3, rt * 1.3, yc + r * 0.22, ya, 8, trim, ph8);
    annulus(b, 0, 0, rt * 1.12, rt * 1.3, yc + r * 0.22, 8, trim, true, ph8);
    if (d === 'near') for (const t of [0.22, 0.78]) {
      const y = yb + (yc - yb) * t, rr = r + (rt - r) * t;
      oct(b, rr * 1.07, y, r * 0.09, gilt, ph8);
    }
    return { lights: [], top: h };
  }
  // lotus: a flared foot, a slender shaft, a gold bell of petals under the abacus
  const yb = ph + r * 0.75, yc = ya - r * 1.5;
  const petals = 12, lobe = d === 'near' ? (a: number) => 1 + 0.06 * Math.pow(Math.abs(Math.cos(a * petals / 2)), 3) - 0.03 : undefined;
  revolve(b, 0, ph, 0, [[r * 1.45, 0], [r * 1.42, r * 0.12], [r * 1.25, r * 0.3], [r * 1.08, r * 0.5], [r * 1.02, r * 0.66], [r, r * 0.75]], sides, trim, { lobe: d === 'near' ? (a) => 1 + 0.035 * Math.cos(a * 16) : undefined });
  b.cylinder(0, 0, r, yb, yc, sides, shaft, { top: null, r1: rt });
  ring(b, rt, yc - r * 0.18, r * 0.12, sides, gilt);
  revolve(b, 0, yc, 0, [[rt, 0], [rt * 1.04, r * 0.25], [rt * 1.2, r * 0.6], [r * 1.42, r * 1.0], [r * 1.66, r * 1.3], [r * 1.7, r * 1.42], [r * 1.66, r * 1.5]], sides, gilt, { lobe });
  return { lights: [], top: h };
}

/** an eight-sided plinth (faces square to x and z) from 0 to ph, `pw` to its faces */
function facetsBox(b: ArchBuilder, pw: number, ph: number, mat: Mat) {
  const R = pw / Math.cos(Math.PI / 8), p = Math.PI / 8;
  facets(b, 0, 0, R, R, 0, ph, 8, mat, p);
  annulus(b, 0, 0, 0, R, ph, 8, mat, false, p);
}

/** a round ring of a given thickness `t` round a shaft of radius r at height y (its inside left off) */
function ring(b: ArchBuilder, r: number, y: number, t: number, sides: number, mat: Mat) {
  revolve(b, 0, y, 0, [[r, 0], [r + t * 0.45, t * 0.15], [r + t * 0.6, t * 0.5], [r + t * 0.45, t * 0.85], [r, t]], sides, mat);
}

/** an eight-sided ring round a shaft (radius rr to its corners) from y up t: its sides and its top and bottom */
function oct(b: ArchBuilder, rr: number, y: number, t: number, mat: Mat, phase: number) {
  facets(b, 0, 0, rr, rr, y, y + t, 8, mat, phase);
  annulus(b, 0, 0, rr / 1.07, rr, y + t, 8, mat, false, phase);
  annulus(b, 0, 0, rr / 1.07, rr, y, 8, mat, true, phase);
}

/** the hall's pillar: a square shaft on a two-stepped base, a two-stepped cap under the abacus, a lavender diamond set
 *  in each face near the head and the foot (near: a cream frame and the lavender proud of it, their bevels) */
function pillar(b: ArchBuilder, d: string, h: number, r: number, ya: number, shaft: Mat, trim: Mat, k: number) {
  const s1 = r * 1.42, s2 = r * 1.2, y1 = r * 0.42, y2 = r * 0.78;
  b.box(-s1, 0, -s1, s1, y1, s1, trim, { skip: ['bottom'] });
  b.box(-s2, y1, -s2, s2, y2, s2, trim, { skip: ['bottom'] });
  const yc = ya - r * 0.5;
  b.box(-r, y2, -r, r, yc, r, shaft, { skip: ['bottom', 'top'] });
  b.box(-r * 1.14, yc, -r * 1.14, r * 1.14, yc + r * 0.22, r * 1.14, trim, { skip: ['top'] });
  b.box(-r * 1.26, yc + r * 0.22, -r * 1.26, r * 1.26, ya, r * 1.26, trim, { skip: ['top'] });
  if (d === 'far') return;
  // (one face's diamonds in its own frame, x along it, z out: turned to each of the four)
  const dia = (y: number, s: number) => {
    for (let f = 0; f < 4; f++) b.group(() => {
      b.at(0, 0, 0, (f * Math.PI) / 2);
      if (d === 'near') {
        diamond(b, 0, y, s, r, PROUD, trim);
        b.with({ tint: LAVENDER }, () => diamond(b, 0, y, s * 0.68, r + PROUD, PROUD, MAT.PAINT));
      } else b.with({ tint: LAVENDER }, () => b.poly([[0, y - s, r + PROUD], [s, y, r + PROUD], [0, y + s, r + PROUD], [-s, y, r + PROUD]], MAT.PAINT));
    });
  };
  dia(yc - r * 1.35, r * 0.62 + k * 0.04);
  dia(y2 + r * 1.05, r * 0.42);
}

/** a diamond slab standing out of a face (z0) by t: its front and its four bevels (bevelled in by a fifth) */
function diamond(b: ArchBuilder, x: number, y: number, s: number, z0: number, t: number, mat: Mat) {
  const z1 = z0 + t, i = s * 0.86;
  const back = [[x, y - s], [x + s, y], [x, y + s], [x - s, y]] as const;
  const front = [[x, y - i], [x + i, y], [x, y + i], [x - i, y]] as const;
  b.poly(front.map(([u, v]) => [u, v, z1] as [number, number, number]), mat);
  for (let k = 0; k < 4; k++) {
    const a = back[k], c = back[(k + 1) % 4], fa = front[k], fc = front[(k + 1) % 4];
    b.poly([[a[0], a[1], z0], [c[0], c[1], z0], [fc[0], fc[1], z1], [fa[0], fa[1], z1]], mat);
  }
}
