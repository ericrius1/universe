// Balustrades along x (centred on the origin, standing on y 0, their faces to ±z): newel posts at the ends and every
// `post` metres, each under a cap (and near, a ball); between them a plinth and a handrail, and the balusters between
// those — 'turned' (a vase on a stem, turned smooth near, six-sided mid, square far), 'square' (a post with a
// chamfered waist), or 'lattice' (a grille of diamonds each side instead). The balusters repeat by the thousand: with
// `placesOnly` they aren't laid, their places are handed back (Laid & { at }) for the instanced renderer to draw
// baluster() at.
import type { ArchBuilder } from '../builder';
import { MAT, type Mat } from '../types';
import { begin, byDetail, facets, revolve, type Detail, type Laid, type PartOpts } from './kit';
import { grillePart } from './openings';

export type BalusterKind = 'turned' | 'square' | 'lattice';

export interface BalusterOpts extends PartOpts {
  kind?: BalusterKind;
  /** its height (between the plinth and the rail), its widest radius */
  h?: number;
  r?: number;
  mat?: Mat;
}

/** one baluster standing on the origin, h tall, open at both ends (its foot on a plinth, its head under a rail) */
export function baluster(b: ArchBuilder, o: BalusterOpts = {}): Laid {
  return b.owner('baluster', () => {
    const { d } = begin(o);
    const h = o.h ?? 0.68, r = o.r ?? 0.065, mat = o.mat ?? MAT.CREAM, kind = o.kind ?? 'turned';
    if (d === 'far' || kind === 'square') {
      const s = r * 0.85;
      if (d === 'far') { facets(b, 0, 0, s * Math.SQRT2, s * Math.SQRT2 * 0.8, 0, h, 4, mat, Math.PI / 4); return { lights: [], top: h }; }
      // a square post: a block at its foot and its head, a slimmer shaft between
      const a = h * 0.18, c = h * 0.82, t = s * 0.68;
      b.box(-s, 0, -s, s, a, s, mat, { skip: ['bottom'] });
      b.box(-t, a, -t, t, c, t, mat, { skip: ['bottom', 'top'] });
      b.box(-s, c, -s, s, h, s, mat, { skip: ['top'] });
      return { lights: [], top: h };
    }
    // turned: a foot, a vase swelling low, a neck, a collar, a head
    const prof: [number, number][] = [[0.8, 0], [0.82, 0.05], [0.62, 0.09], [0.58, 0.13], [0.86, 0.26], [1, 0.38], [0.88, 0.5], [0.55, 0.62], [0.4, 0.7], [0.42, 0.76], [0.62, 0.8], [0.62, 0.84], [0.45, 0.88], [0.5, 0.94], [0.7, 0.97], [0.7, 1]];
    const p = prof.map(([pr, py]) => [pr * r, py * h] as [number, number]);
    revolve(b, 0, 0, 0, d === 'near' ? p : p.filter((_, i) => i % 2 === 0 || i === p.length - 1), byDetail(d, 10, 6, 4), mat);
    return { lights: [], top: h };
  });
}

export interface BalustradeOpts extends PartOpts {
  /** its length (along x), its height to the rail's top */
  len?: number;
  h?: number;
  kind?: BalusterKind;
  /** balusters' pitch, newels' spacing */
  pitch?: number;
  post?: number;
  /** its stone, its rail's */
  mat?: Mat;
  rail?: Mat;
  /** the balusters not laid: their places handed back */
  placesOnly?: boolean;
}

/** a balustrade (see the header) */
export function balustrade(b: ArchBuilder, o: BalustradeOpts = {}): Laid & { at: number[]; y: number; hb: number } {
  return b.owner('balustrade', () => {
    const { d } = begin(o);
    const len = o.len ?? 4, h = o.h ?? 1.0, kind = o.kind ?? 'turned', pitch = o.pitch ?? 0.24;
    const mat = o.mat ?? MAT.CREAM, rail = o.rail ?? MAT.CREAM;
    const pw = 0.16, pb = 0.15, rt = 0.11, plw = 0.11, rw = 0.13;
    const bays = Math.max(1, Math.round(len / (o.post ?? 2.4)));
    const newel = (x: number) => {
      b.box(x - pw, 0, -pw, x + pw, h + 0.04, pw, mat, { skip: ['bottom', 'top'] });
      b.box(x - pw - 0.03, h + 0.04, -pw - 0.03, x + pw + 0.03, h + 0.12, pw + 0.03, rail);
      if (d === 'near') revolve(b, x, h + 0.12, 0, [[0.06, 0], [0.07, 0.02], [0.04, 0.04], [0.035, 0.06], [0.08, 0.1], [0.095, 0.15], [0.08, 0.2], [0.04, 0.235], [0.001, 0.245]], 10, rail);
    };
    const at: number[] = [];
    for (let k = 0; k <= bays; k++) newel(-len / 2 + (k * len) / bays);
    const hb = h - pb - rt;
    for (let k = 0; k < bays; k++) {
      const xa = -len / 2 + (k * len) / bays + pw, xb = -len / 2 + ((k + 1) * len) / bays - pw;
      // the plinth and the rail between the newels (their ends against them)
      b.box(xa, 0, -plw, xb, pb, plw, mat, { skip: ['bottom', 'e', 'w'] });
      b.box(xa, h - rt, -rw, xb, h, rw, rail, { skip: ['e', 'w'] });
      if (kind === 'lattice') {
        if (d === 'far') continue;
        // a grille each side, back to back
        for (const s of [1, -1]) b.group(() => {
          b.at((xa + xb) / 2, pb, 0, s < 0 ? Math.PI : 0);
          grillePart(b, { w: xb - xa, h: hb, kind: 'diamond', mat, detail: d, pitch: 0.18, bar: 0.035 });
        });
        continue;
      }
      const n = Math.max(1, Math.round((xb - xa) / pitch));
      for (let i = 0; i < n; i++) {
        const x = xa + ((i + 0.5) * (xb - xa)) / n;
        at.push(x);
        if (!o.placesOnly) b.group(() => { b.at(x, pb, 0); baluster(b, { kind, h: hb, mat, detail: d }); });
      }
    }
    return { lights: [], top: h + (d === 'near' ? 0.37 : 0.12), at, y: pb, hb };
  });
}

export type { Detail };
