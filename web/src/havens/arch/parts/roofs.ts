// What crowns the town's roofs and walls, and what holds things out from its walls:
//   domePart     a dome on a drum: 'round', 'pointed', 'onion' (swelling past its drum, drawn up to a long point),
//                'ribbed' (a melon of gores between gold ribs); over an optional square or eight-sided base, its drum
//                plain or pierced by arched windows (lit at night) on its faces, a cornice where it springs, a finial
//   finialPart   the gold on a dome's or a tower's tip: 'ball' (two balls on a stem), 'spire' (a bulb and a ringed
//                needle), 'lotus' (a bud of petals)
//   merlon       one merlon on a wall's top (its foot's middle at the origin, its faces to ±z): 'square' (capped),
//                'stepped' (the three-stepped kind), 'pointed' (a leaf), 'rounded'
//   crenellation a row of them along x, centred (their places handed back: by the thousand, instanced)
//   awning       cloth on a wall (hung at y 0 along x, z out): 'flat' (a sloped sheet, a valance), 'scalloped' (its
//                valance cut in scallops), 'barrel' (a quarter round with cheeks); a batten, a front rod and stays
//   bracket      what holds a balcony or a cornice out of a wall (its back on the wall, its top at y 0, hanging
//                under): 'stepped' (three corbelled blocks), 'scroll' (an ogee), 'beam' (a beam's end), 'knee' (an
//                arm and a strut)
import type { ArchBuilder } from '../builder';
import { MAT, type Mat, type V3 } from '../types';
import type { V2 } from '../../world/layout';
import { annulus, begin, byDetail, CLOTHS, facets, GLAZES, PROUD, proud, rectOn, region, revolve, sheet, type Detail, type Laid, type PartOpts } from './kit';
import { windowPart } from './openings';

/** a profile [radius, height] resampled through its points as a smooth curve (Catmull-Rom), `n` points */
export function smooth(prof: [number, number][], n: number): [number, number][] {
  if (n <= prof.length) return prof;
  const out: [number, number][] = [], m = prof.length - 1;
  for (let k = 0; k < n; k++) {
    const t = (k / (n - 1)) * m, i = Math.min(m - 1, Math.floor(t)), f = t - i;
    const p0 = prof[Math.max(0, i - 1)], p1 = prof[i], p2 = prof[i + 1], p3 = prof[Math.min(m, i + 2)];
    const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f);
    out.push([Math.max(0, cr(p0[0], p1[0], p2[0], p3[0])), cr(p0[1], p1[1], p2[1], p3[1])]);
  }
  return out;
}

export type DomeKind = 'round' | 'pointed' | 'onion' | 'ribbed';

/** a dome's surface's profile over its springing, radius r: [radius, height] from the bottom up (radius about 0 at the
 *  top, where the finial sits) */
export function domeProfile(kind: DomeKind, r: number, rise?: number): [number, number][] {
  if (kind === 'onion') {
    const R = rise ?? r * 1.55;
    return [[r, 0], [r * 1.07, R * 0.07], [r * 1.16, R * 0.18], [r * 1.19, R * 0.3], [r * 1.12, R * 0.45], [r * 0.92, R * 0.6], [r * 0.62, R * 0.74], [r * 0.33, R * 0.86], [r * 0.13, R * 0.95], [r * 0.025, R]];
  }
  const R = rise ?? (kind === 'pointed' ? r * 1.25 : r * 1.0), tip = kind === 'pointed' ? 0.55 : kind === 'ribbed' ? 0.2 : 0;
  const pts: [number, number][] = [];
  for (let j = 0; j <= 8; j++) {
    const t = j / 8, a = t * Math.PI * 0.5;
    // (a pointed one drawn in toward its tip and lifted, as ArchBuilder.dome does)
    const rr = Math.cos(a) * r * (1 - tip * Math.pow(t, 3) * 0.6), hh = Math.sin(a) * R + tip * Math.pow(t, 6) * R * 0.35;
    pts.push([Math.max(rr, r * 0.025), hh]);
  }
  return pts;
}

export interface DomeOpts extends PartOpts {
  r?: number;
  kind?: DomeKind;
  /** its rise over its springing (by kind if not given) */
  rise?: number;
  /** the drum's height (r × 0.5; 0: none) and whether arched windows pierce it */
  drum?: number;
  windows?: boolean;
  /** a base block under the drum (none) */
  base?: 'square' | 'octagon' | null;
  /** the glaze's tint (by the seed if not given) and the dome's material (glazed tiles; gold) */
  glaze?: V3;
  mat?: Mat;
  drumMat?: Mat;
  /** its finial (by kind if not given; null none) */
  finial?: FinialKind | null;
  /** a ribbed one's gores */
  ribs?: number;
}

/** a dome on its drum, its foot's middle at the origin (see the header) */
export function domePart(b: ArchBuilder, o: DomeOpts = {}): Laid {
  return b.owner('dome', () => {
    const { d, rng } = begin(o);
    const r = o.r ?? 2, kind = o.kind ?? 'round', mat = o.mat ?? MAT.DOME, drumMat = o.drumMat ?? MAT.CREAM;
    const glaze = o.glaze ?? (mat === MAT.DOME ? rng.pick(GLAZES) : [1, 1, 1] as V3);
    const sides = byDetail(d, r > 2.5 ? 40 : 32, 20, 8);
    let y = 0;
    // the base: a square or eight-sided block the drum stands on
    if (o.base) {
      const bh = r * 0.32, hw = r * 1.16;
      if (o.base === 'square') b.box(-hw, 0, -hw, hw, bh, hw, MAT.PLASTER, { skip: ['bottom'] });
      else { const R = hw / Math.cos(Math.PI / 8); facets(b, 0, 0, R, R, 0, bh, 8, MAT.PLASTER, Math.PI / 8); annulus(b, 0, 0, 0, R, bh, 8, MAT.PLASTER, false, Math.PI / 8); }
      y = bh;
    }
    // the drum: round, or of flat faces with an arched window in every other one
    const drum = o.drum ?? r * 0.5, rd = r * 1.02;
    const lights: Laid['lights'] = [];
    if (drum > 0) {
      if (o.windows && d !== 'far' && r >= 1.5) {
        const nf = 16, R = rd / Math.cos(Math.PI / nf), fw = 2 * rd * Math.tan(Math.PI / nf);
        facets(b, 0, 0, R, R, y, y + drum, nf, drumMat, Math.PI / nf);
        for (let k = 0; k < nf; k += 2) b.group(() => {
          // (each face's own frame: x along it, z out of it)
          const a = (k / nf) * Math.PI * 2;
          b.at(Math.cos(a) * rd, y + drum * 0.2, Math.sin(a) * rd, -a + Math.PI / 2);
          windowPart(b, { kind: 'arched', w: fw * 0.42, h: drum * 0.6, depth: 0, detail: d, seed: (o.seed ?? 1) * 17 + k, lit: 0.85 });
        });
      } else b.cylinder(0, 0, rd, y, y + drum, sides, drumMat, { top: null });
      y += drum;
    }
    // the cornice where it springs: a moulded ring out over the drum, its top a ring in to the dome
    const ct = r * 0.12, co = r * 1.12;
    const rdo = o.windows && d !== 'far' && r >= 1.5 ? rd / Math.cos(Math.PI / 16) : rd;
    if (drum > 0 || o.base) {
      if (d === 'near') revolve(b, 0, y - ct, 0, [[rdo * 0.995, 0], [r * 1.05, ct * 0.18], [r * 1.07, ct * 0.4], [co, ct * 0.75], [co, ct]], sides, MAT.CREAM);
      else { b.cylinder(0, 0, co, y - ct * 0.6, y, sides, MAT.CREAM, { top: null }); annulus(b, 0, 0, rdo * 0.99, co, y - ct * 0.6, sides, MAT.CREAM, true); }
      annulus(b, 0, 0, r, co, y, sides, MAT.CREAM);
    }
    // the dome
    const prof = smooth(domeProfile(kind, r, o.rise), byDetail(d, 22, 12, 5));
    const ribs = o.ribs ?? (kind === 'ribbed' ? 16 : 0), k = 0.07;
    const lobe = ribs ? (a: number) => 1 - k + k * Math.pow(Math.abs(Math.sin((a * ribs) / 2)), 0.5) : undefined;
    b.with({ tint: glaze }, () => revolve(b, 0, y, 0, prof, ribs ? Math.max(sides, ribs * byDetail(d, 4, 2, 1)) : sides, mat, { lobe }));
    if (ribs && d === 'near') for (let j = 0; j < ribs; j++) rib(b, prof, y, (j / ribs) * Math.PI * 2, 1 - k, r * 0.018, r * 0.016);
    const tip = y + prof[prof.length - 1][1];
    // the finial
    const fk = o.finial === undefined ? (kind === 'onion' ? 'spire' : kind === 'ribbed' ? 'lotus' : 'ball') : o.finial;
    let top = tip;
    if (fk) b.group(() => { b.at(0, tip - r * 0.01, 0); top = tip + finialPart(b, { kind: fk, h: Math.max(0.5, r * 0.55), detail: d }).top; });
    return { lights, top };
  });
}

/** a gold rib along a melon dome's crease at angle a (radius × `m` at the crease), standing `h` out of it, `w` wide:
 *  its top and its two sides (their feet in the gores either side) */
function rib(b: ArchBuilder, prof: [number, number][], y: number, a: number, m: number, h: number, w: number) {
  const ca = Math.cos(a), sa = Math.sin(a), tx = -sa, tz = ca;
  const at = (rr: number, hh: number, s: number, up: number): V3 => {
    const R = rr * m + up;
    return [ca * R + tx * s, y + hh, sa * R + tz * s];
  };
  const run = prof.slice(0, -1);
  const row = (s: number, up: number) => run.map(([rr, hh]) => at(rr, hh, s, up));
  sheet(b, [row(w / 2, h), row(-w / 2, h)], MAT.GOLD);
  sheet(b, [row(w / 2, -h), row(w / 2, h)], MAT.GOLD);
  sheet(b, [row(-w / 2, h), row(-w / 2, -h)], MAT.GOLD);
}

export type FinialKind = 'ball' | 'spire' | 'lotus';

export interface FinialOpts extends PartOpts { kind?: FinialKind; h?: number; mat?: Mat }

/** a finial standing on the origin, h tall (see the header) */
export function finialPart(b: ArchBuilder, o: FinialOpts = {}): Laid {
  return b.owner('finial', () => {
    const { d } = begin(o);
    const kind = o.kind ?? 'ball', h = o.h ?? 1, mat = o.mat ?? MAT.GOLD;
    const sides = byDetail(d, 10, 8, 4), n = byDetail(d, 3, 2, 1);
    let prof: [number, number][];
    if (kind === 'spire') prof = [[0.09, 0], [0.11, 0.03], [0.07, 0.08], [0.05, 0.12], [0.11, 0.2], [0.13, 0.27], [0.1, 0.34], [0.04, 0.4], [0.03, 0.46], [0.05, 0.48], [0.03, 0.5], [0.018, 0.75], [0.03, 0.77], [0.016, 0.79], [0.004, 1]];
    else if (kind === 'lotus') prof = [[0.1, 0], [0.12, 0.04], [0.06, 0.1], [0.05, 0.16], [0.12, 0.28], [0.15, 0.4], [0.12, 0.55], [0.06, 0.7], [0.02, 0.8], [0.004, 1]];
    else prof = [[0.1, 0], [0.12, 0.04], [0.06, 0.09], [0.045, 0.14], [0.13, 0.25], [0.15, 0.36], [0.12, 0.46], [0.04, 0.52], [0.035, 0.57], [0.08, 0.66], [0.09, 0.72], [0.06, 0.8], [0.02, 0.86], [0.004, 1]];
    prof = prof.map(([r, y]) => [r * h, y * h] as [number, number]);
    if (d === 'far') prof = [prof[0], ...prof.filter((_, i) => i % 3 === 2), prof[prof.length - 1]];
    else if (n > 2) prof = smooth(prof, Math.round(prof.length * 1.5));
    const lobe = kind === 'lotus' && d === 'near' ? (a: number) => 1 + 0.08 * Math.cos(a * 8) : undefined;
    revolve(b, 0, 0, 0, prof, sides, mat, { lobe });
    annulus(b, 0, 0, 0, prof[0][0], 0, sides, mat, true);
    return { lights: [], top: h };
  });
}

/** an outline in (x, y) (any winding) made a slab from z0 to z1: its faces (as one island each) and its edges
 *  (`open`: an edge left off, where it sits on something) */
export function slabXY(b: ArchBuilder, pts: V2[], z0: number, z1: number, mat: Mat, open: (a: V2, c: V2) => boolean = () => false) {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  const p = area < 0 ? [...pts].reverse() : pts;
  region(b, p, [0, 0, z1], [1, 0, 0], [0, 1, 0], [0, 0, 1], mat);
  region(b, p, [0, 0, z0], [1, 0, 0], [0, 1, 0], [0, 0, -1], mat, [-1, 0, 0]);
  for (let i = 0; i < p.length; i++) {
    const a = p[i], c = p[(i + 1) % p.length];
    if (open(a, c)) continue;
    const dx = c[0] - a[0], dy = c[1] - a[1];
    if (Math.hypot(dx, dy) < 1e-6) continue;
    b.patch([[a[0], a[1], z1], [a[0], a[1], z0], [c[0], c[1], z0], [c[0], c[1], z1]], [0, 1, 2, 0, 2, 3], mat, [dy, -dx, 0]);
  }
}

export type MerlonKind = 'square' | 'stepped' | 'pointed' | 'rounded';

export interface MerlonOpts extends PartOpts {
  kind?: MerlonKind;
  /** its width (along x), height, thickness (along z) */
  w?: number;
  h?: number;
  t?: number;
  mat?: Mat;
  /** a square one's cap */
  cap?: Mat;
}

/** one merlon standing on the origin (see the header) */
export function merlon(b: ArchBuilder, o: MerlonOpts = {}): Laid {
  return b.owner('merlon', () => {
    const { d } = begin(o);
    const kind = o.kind ?? 'stepped', w = o.w ?? 0.55, h = o.h ?? 0.75, t = o.t ?? 0.4, mat = o.mat ?? MAT.PLASTER;
    const hw = w / 2, z0 = -t / 2, z1 = t / 2;
    const foot = (a: V2, c: V2) => Math.abs(a[1]) < 1e-6 && Math.abs(c[1]) < 1e-6;
    if (kind === 'square') {
      const ch = d === 'far' ? 0 : Math.min(0.08, h * 0.12), oh = 0.03;
      b.box(-hw, 0, z0, hw, h - ch, z1, mat, { skip: ['bottom', ...(ch > 0 ? ['top'] : [])] });
      if (ch > 0) b.box(-hw - oh, h - ch, z0 - oh, hw + oh, h, z1 + oh, o.cap ?? MAT.CREAM);
      return { lights: [], top: h };
    }
    let pts: V2[];
    if (kind === 'stepped') {
      const s = d === 'far' ? 2 : 3, tiers = s === 3 ? [0.46, 0.76, 1] : [0.6, 1], widths = s === 3 ? [1, 0.64, 0.3] : [1, 0.5];
      pts = [[-hw, 0], [hw, 0]];
      for (let i = 0; i < s; i++) { pts.push([hw * widths[i], h * tiers[i]]); if (i + 1 < s) pts.push([hw * widths[i + 1], h * tiers[i]]); }
      const right = pts.slice(2);
      pts = [...pts, ...right.reverse().map(([x, y]) => [-x, y] as V2)];
    } else if (kind === 'pointed') {
      const n = byDetail(d, 6, 3, 1), ys = h * 0.5;
      pts = [[-hw, 0], [hw, 0], [hw, ys]];
      // (an ogee to the point: out a little, then in)
      for (let i = 1; i <= n; i++) { const tt = i / n; pts.push([hw * (1 - tt) * (1 + 0.35 * Math.sin(tt * Math.PI)), ys + (h - ys) * tt]); }
      const right = pts.slice(2, -1);
      pts = [...pts, ...right.reverse().map(([x, y]) => [-x, y] as V2)];
    } else {
      const n = byDetail(d, 10, 6, 2), ys = h - hw;
      pts = [[-hw, 0], [hw, 0]];
      for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI; pts.push([Math.cos(a) * hw, ys + Math.sin(a) * hw]); }
    }
    slabXY(b, pts, z0, z1, mat, foot);
    return { lights: [], top: h };
  });
}

export interface CrenellationOpts extends MerlonOpts {
  /** the row's length (along x, centred), the gap between merlons (a merlon's width if not given) */
  len?: number;
  gap?: number;
  /** only their places, not laid (to be drawn instanced) */
  placesOnly?: boolean;
}

/** a row of merlons along x (see the header): their middles' x handed back */
export function crenellation(b: ArchBuilder, o: CrenellationOpts = {}): Laid & { at: number[] } {
  return b.owner('crenellation', () => {
    const w = o.w ?? 0.55, gap = o.gap ?? w * 0.8, len = o.len ?? 6;
    const n = Math.max(1, Math.floor((len + gap) / (w + gap))), span = n * w + (n - 1) * gap;
    const at = Array.from({ length: n }, (_, i) => -span / 2 + w / 2 + i * (w + gap));
    if (!o.placesOnly) at.forEach((x, i) => b.group(() => { b.at(x, 0, 0); merlon(b, { ...o, seed: (o.seed ?? 1) + i }); }));
    return { lights: [], top: o.h ?? 0.75, at };
  });
}

export type AwningKind = 'flat' | 'scalloped' | 'barrel';

export interface AwningOpts extends PartOpts {
  kind?: AwningKind;
  /** its width (along the wall), how far out, how far its front falls below its top (y 0) */
  w?: number;
  out?: number;
  drop?: number;
  /** the valance's height (0: none) */
  valance?: number;
  /** the cloth's tint (by the seed if not given) */
  tint?: V3;
}

/** an awning hung on a wall (see the header) */
export function awning(b: ArchBuilder, o: AwningOpts = {}): Laid {
  return b.owner('awning', () => {
    const { d, rng } = begin(o);
    const kind = o.kind ?? 'flat', w = o.w ?? 2.2, out = o.out ?? 1.3, drop = o.drop ?? (kind === 'barrel' ? 0.8 : 0.55);
    const val = o.valance ?? (kind === 'barrel' ? 0.18 : 0.28), tint = o.tint ?? rng.vary(rng.pick(CLOTHS), 0.03);
    const hw = w / 2, z0 = PROUD + 0.03;
    // both faces of a cloth: a sheet's points the one way and the other
    const both = (pts: V3[]) => { b.poly(pts, MAT.CLOTH); b.poly([...pts].reverse(), MAT.CLOTH); };
    b.with({ tint }, () => {
      if (kind === 'barrel') {
        // a quarter round from the wall out and down to its front, both its faces, and its two cheeks
        const n = byDetail(d, 8, 5, 2);
        const prof: V2[] = Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * Math.PI * 0.5; return [z0 + Math.sin(a) * (out - z0), -drop + Math.cos(a) * drop]; });
        const row = (x: number) => prof.map(([z, y]) => [x, y, z] as V3);
        sheet(b, [row(hw), row(-hw)], MAT.CLOTH);
        sheet(b, [row(-hw), row(hw)], MAT.CLOTH);
        for (const x of [-hw, hw]) {
          const cheek: V3[] = [[x, -drop, z0], ...prof.map(([z, y]) => [x, y, z] as V3)];
          both(cheek);
        }
      } else {
        both([[-hw, 0, z0], [hw, 0, z0], [hw, -drop, out], [-hw, -drop, out]]);
      }
      // the valance: straight, or cut in scallops
      if (val > 0) {
        const y0 = -drop, y1 = y0 - val;
        if (kind === 'scalloped' && d !== 'far') {
          const n = Math.max(2, Math.round(w / 0.36)), sw = w / n, seg = byDetail(d, 6, 3, 1);
          const pts: V2[] = [[-hw, y0]];
          pts.push([hw, y0]);
          for (let i = n - 1; i >= 0; i--) {
            const x0 = -hw + i * sw;
            for (let k = 0; k <= seg; k++) { const a = (k / seg) * Math.PI; pts.push([x0 + sw / 2 + (Math.cos(a) * sw) / 2, y1 + 0.06 - Math.sin(a) * 0.1]); }
          }
          region(b, pts, [0, 0, out], [1, 0, 0], [0, 1, 0], [0, 0, 1], MAT.CLOTH);
          region(b, pts, [0, 0, out], [1, 0, 0], [0, 1, 0], [0, 0, -1], MAT.CLOTH, [-1, 0, 0]);
        } else {
          rectOn(b, -hw, y1, hw, y0, [0, 0, out], [1, 0, 0], [0, 1, 0], [0, 0, 1], MAT.CLOTH);
          rectOn(b, -hw, y1, hw, y0, [0, 0, out], [1, 0, 0], [0, 1, 0], [0, 0, -1], MAT.CLOTH, [-1, 0, 0]);
        }
      }
    });
    if (d !== 'far') {
      // the batten it's hung from, the rod along its front, the stays from the wall to the rod's ends
      proud(b, -hw - 0.04, -0.02, hw + 0.04, 0.06, z0, MAT.WOOD);
      b.box(-hw - 0.03, -drop - 0.04, out - 0.06, hw + 0.03, -drop - 0.005, out - PROUD, MAT.WOOD);
      if (d === 'near') for (const x of [-hw + 0.06, hw - 0.06]) stay(b, [x, -drop - 0.55, 0], [x, -drop - 0.02, out - 0.04], 0.016);
    }
    return { lights: [], top: 0.06 };
  });
}

/** a thin square rod from a to c (a stay, a strut), its four sides */
export function stay(b: ArchBuilder, a: V3, c: V3, w: number, mat: Mat = MAT.WOOD) {
  const d: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]) || 1;
  const n: V3 = [d[0] / L, d[1] / L, d[2] / L], ref: V3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const cr = (p: V3, q: V3): V3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const u0 = cr(n, ref), ul = Math.hypot(...u0), u: V3 = [(u0[0] / ul) * w, (u0[1] / ul) * w, (u0[2] / ul) * w], v = cr(u, n);
  const P = (p: V3, su: number, sv: number): V3 => [p[0] + u[0] * su + v[0] * sv, p[1] + u[1] * su + v[1] * sv, p[2] + u[2] * su + v[2] * sv];
  const ring: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (let i = 0; i < 4; i++) {
    const [s0, t0] = ring[i], [s1, t1] = ring[(i + 1) % 4];
    b.poly([P(a, s0, t0), P(c, s0, t0), P(c, s1, t1), P(a, s1, t1)], mat);
  }
}

export type BracketKind = 'stepped' | 'scroll' | 'beam' | 'knee';

export interface BracketOpts extends PartOpts {
  kind?: BracketKind;
  /** its width (along the wall), how far out, how far down */
  w?: number;
  out?: number;
  h?: number;
  mat?: Mat;
  /** its top drawn (false: something rests on it) */
  top?: boolean;
}

/** a bracket out of a wall (see the header) */
export function bracket(b: ArchBuilder, o: BracketOpts = {}): Laid {
  return b.owner('bracket', () => {
    const { d } = begin(o);
    const kind = o.kind ?? 'scroll', w = o.w ?? 0.26, out = o.out ?? 0.42, h = o.h ?? 0.5;
    const mat = o.mat ?? (kind === 'beam' || kind === 'knee' ? MAT.WOOD : MAT.CREAM), hw = w / 2;
    const top = o.top === true ? [] : ['top'];
    if (kind === 'stepped' || d === 'far') {
      const n = d === 'far' ? 1 : 3;
      for (let k = 0; k < n; k++) proud(b, -hw, -h + (k * h) / n, hw, -h + ((k + 1) * h) / n, (out * (k + 1)) / n, mat, k === n - 1 ? top : ['top']);
      return { lights: [], top: 0 };
    }
    if (kind === 'scroll') {
      // an ogee from the wall's foot out to the top's front: its curved face, its two sides
      const n = byDetail(d, 12, 5, 2);
      const prof: V2[] = Array.from({ length: n + 1 }, (_, i) => {
        const t = i / n, s = t * t * (3 - 2 * t);
        return [out * (0.12 + 0.88 * s) * (1 - 0.0 * t), -h + h * t];
      });
      prof[0] = [0, -h];
      const row = (x: number) => prof.map(([z, y]) => [x, y, z] as V3);
      sheet(b, [row(-hw), row(hw)], mat);
      for (const x of [-hw, hw]) region(b, [...prof, [0, 0]], [x, 0, 0], [0, 0, 1], [0, 1, 0], [x < 0 ? -1 : 1, 0, 0], mat);
      if (o.top === true) rectOn(b, -hw, 0, hw, out, [0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0], mat);
      return { lights: [], top: 0 };
    }
    if (kind === 'beam') {
      // a beam's end, its underside cut up to its tip in a curve
      const n = byDetail(d, 6, 3, 1), bh = Math.min(h, w * 1.2);
      const prof: V2[] = [[0, -bh]];
      for (let i = 0; i <= n; i++) { const t = i / n; prof.push([out * 0.55 + out * 0.45 * Math.sin(t * Math.PI / 2), -bh + bh * 0.55 * (1 - Math.cos(t * Math.PI / 2))]); }
      prof.push([out, 0], [0, 0]);
      // (the profile in (z, y) made a slab across x: its two sides, its faces round)
      for (const x of [-hw, hw]) region(b, prof, [x, 0, 0], [0, 0, 1], [0, 1, 0], [x < 0 ? -1 : 1, 0, 0], mat);
      for (let i = 0; i < prof.length; i++) {
        const a = prof[i], c = prof[(i + 1) % prof.length];
        if (a[0] === 0 && c[0] === 0) continue;
        if (a[1] === 0 && c[1] === 0 && o.top !== true) continue;
        // (the outline runs round counter-clockwise in (z, y): each edge's outside to its right)
        const dz = c[0] - a[0], dy = c[1] - a[1];
        b.patch([[-hw, a[1], a[0]], [hw, a[1], a[0]], [hw, c[1], c[0]], [-hw, c[1], c[0]]], [0, 1, 2, 0, 2, 3], mat, [0, -dz, dy]);
      }
      return { lights: [], top: 0 };
    }
    // a knee: an arm out under the top, a strut from the wall below to its front, a plate on the wall
    const t = Math.min(0.09, w * 0.5);
    proud(b, -t / 2, -t, t / 2, 0, out, mat, top);
    proud(b, -t / 2, -h, t / 2, -t, t, mat, ['top']);
    stay(b, [0, -h + 0.06, t * 0.7], [0, -t * 0.8, out * 0.82], t * 0.42, mat);
    return { lights: [], top: 0 };
  });
}

export type { Detail };
