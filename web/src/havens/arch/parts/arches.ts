// Arches and arcades. archCurve() is every arched thing's curve (the arcades', the windows', the doors', the portals'):
// over a span from x -s/2 to s/2, springing at y 0, from the left spring over the crown to the right —
//   'round'      a half circle
//   'pointed'    two arcs struck from inside the opposite jambs (`point`: their radius over the span, 0.8)
//   'horseshoe'  a circle carried on past its middle, so the arch closes in again to its springs (`shoe`: the angle
//                below its middle, radians)
//   'lobed'      a round arch cusped into `lobes` foils (five)
// — and, grown outward by `grow` from the same centres, its extrados (an archivolt's outer edge), each point paired
// with the intrados's on the same ray. pierced() lays a wall with a row of such openings: its two faces cut round them
// (the spandrels one island each, a tile field fitted whole), the jambs, the sills and the arch's soffit, the ends.
// arcade() is the free-standing run of them in the town's way: columns or piers, the arches with a voussoired
// archivolt and a keystone, tiled spandrels, a teal frieze, a coping — near; mid without the voussoirs, the keystones
// and the frieze's sides; far a pierced slab under a flat top.
import type { ArchBuilder } from '../builder';
import { MAT, TILE_PAL, type Mat, type V3 } from '../types';
import type { V2 } from '../../world/layout';
import { begin, byDetail, rectOn, region, sheet, type Detail, type Laid, type PartOpts } from './kit';
import { abacusOf, column, type ColumnOpts } from './columns';

export type ArchKind = 'flat' | 'round' | 'pointed' | 'horseshoe' | 'lobed';

/** an arch's curve: its points (x, y over the springing), its crown's height, where its tangent breaks (indices: the
 *  pointed arch's crown, the lobes' cusps), its half width at the widest */
export interface Curve { pts: V2[]; crown: number; breaks: number[]; half: number }

export interface CurveOpts { lobes?: number; point?: number; shoe?: number }

/** an arch's curve over a span (see the header): about `segs` segments (even); `grow` its extrados */
export function archCurve(kind: ArchKind, span: number, segs = 12, grow = 0, o: CurveOpts = {}): Curve {
  const s = span, g = grow;
  const n = Math.max(2, segs + (segs & 1));
  if (kind === 'flat') return { pts: [[-s / 2 - g, g], [s / 2 + g, g]], crown: g, breaks: [], half: s / 2 + g };
  if (kind === 'pointed') {
    const R = Math.max(0.55, o.point ?? 0.8) * s, Rg = R + g, cx = -s / 2 + R, h = n / 2;
    const ta = Math.acos(Math.max(-1, Math.min(1, (s / 2 - R) / Rg)));
    const pts: V2[] = [];
    for (let i = 0; i <= h; i++) { const a = Math.PI - (Math.PI - ta) * (i / h); pts.push([cx + Rg * Math.cos(a), Rg * Math.sin(a)]); }
    for (let i = 1; i <= h; i++) { const a = (Math.PI - ta) * (1 - i / h); pts.push([-cx + Rg * Math.cos(a), Rg * Math.sin(a)]); }
    return { pts, crown: Rg * Math.sin(ta), breaks: [h], half: s / 2 + g };
  }
  if (kind === 'horseshoe') {
    const phi = o.shoe ?? 0.42, r = s / 2 / Math.cos(phi), yc = r * Math.sin(phi), rg = r + g;
    const pts: V2[] = [];
    for (let i = 0; i <= n; i++) { const a = Math.PI + phi - (Math.PI + 2 * phi) * (i / n); pts.push([rg * Math.cos(a), yc + rg * Math.sin(a)]); }
    return { pts, crown: yc + rg, breaks: [], half: rg };
  }
  const R = s / 2;
  if (kind === 'round') {
    const pts: V2[] = [];
    for (let i = 0; i <= n; i++) { const a = Math.PI * (1 - i / n); pts.push([(R + g) * Math.cos(a), (R + g) * Math.sin(a)]); }
    return { pts, crown: R + g, breaks: [], half: R + g };
  }
  // lobed: foils between cusps on a circle inside the round arch, each bulging out to touch it
  const L = Math.max(3, o.lobes ?? 5), D = Math.PI / L, Rc = R * 0.82, per = Math.max(2, Math.round(n / L));
  const key: V2[] = [[-R, 0]];
  for (let k = 1; k < L; k++) key.push([Rc * Math.cos(Math.PI - k * D), Rc * Math.sin(Math.PI - k * D)]);
  key.push([R, 0]);
  const pts: V2[] = [key[0]], breaks: number[] = [];
  for (let k = 0; k < L; k++) {
    const A = key[k], C = key[k + 1], am = Math.PI - (k + 0.5) * D, M: V2 = [R * Math.cos(am), R * Math.sin(am)];
    const arc = through(A, M, C, per);
    for (let i = 1; i < arc.length; i++) pts.push(arc[i]);
    if (k < L - 1) breaks.push(pts.length - 1);
  }
  if (g > 0) return { pts: pts.map(([x, y]) => { const a = Math.atan2(y, x); return [(R + g) * Math.cos(a), (R + g) * Math.sin(a)] as V2; }), crown: R + g, breaks: [], half: R + g };
  // (a foil by a spring bulges a little past the round arch: the widest and the highest as they are)
  return { pts, crown: Math.max(...pts.map((q) => q[1])), breaks, half: Math.max(...pts.map((q) => Math.abs(q[0]))) };
}

/** points along the circle through a, m and c (from a by m to c), `n` segments */
function through(a: V2, m: V2, c: V2, n: number): V2[] {
  const ax = a[0], ay = a[1], bx = m[0], by = m[1], cx = c[0], cy = c[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return Array.from({ length: n + 1 }, (_, i) => [a[0] + (c[0] - a[0]) * (i / n), a[1] + (c[1] - a[1]) * (i / n)] as V2);
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  let a0 = Math.atan2(ay - uy, ax - ux), am = Math.atan2(by - uy, bx - ux), a1 = Math.atan2(cy - uy, cx - ux);
  // (the way round from a to c that passes m)
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = norm(am - a0) < norm(a1 - a0);
  if (ccw) { a1 = a0 + norm(a1 - a0); } else { a1 = a0 - norm(a0 - a1); }
  void am;
  return Array.from({ length: n + 1 }, (_, i) => { const t = a0 + (a1 - a0) * (i / n); return [ux + r * Math.cos(t), uy + r * Math.sin(t)] as V2; });
}

/** one opening of a pierced wall: its middle along the wall, its span, its sill (0: open to the ground), its spring
 *  (the jambs' top), its arch */
export interface Bay { x: number; span: number; sill: number; spring: number; kind: ArchKind; curve?: CurveOpts; segs?: number }

export interface PiercedOpts {
  /** the arch's segments (12) */
  segs?: number;
  /** the soffits' and the jambs' material (the wall's) */
  soffit?: Mat;
  /** the spandrels' (the wall's), and their tiles' palette */
  spandrel?: Mat;
  pal?: number;
  /** the spandrels' top (the arches' highest crown and a margin): the wall above is one band */
  zone?: number;
  /** nothing below the spring between the openings (they stand on columns) */
  onColumns?: boolean;
  /** the reveals (jambs, sills, soffits) through its thickness (true; false: only the hole, its fill's part lays its
   *  own) */
  reveals?: boolean;
  /** its back face, its ends, its top (null: a cap takes its place) */
  back?: boolean;
  ends?: boolean;
  top?: Mat | null;
}

/** a wall from x 0 to len and y 0 to h, between z -t/2 and t/2, pierced by a row of arched openings (see the header);
 *  each opening's curve back, and the spandrels' top */
export function pierced(b: ArchBuilder, len: number, h: number, t: number, bays: Bay[], mat: Mat, o: PiercedOpts = {}): { curves: Curve[]; zone: number } {
  const segs = o.segs ?? 12, soffit = o.soffit ?? mat, span = o.spandrel ?? mat;
  const curves = bays.map((y) => archCurve(y.kind, y.span, y.segs ?? segs, 0, y.curve));
  const zone = Math.min(h, o.zone ?? Math.max(...bays.map((y, i) => y.spring + curves[i].crown)) + 0.2);
  // (each opening's box: its span, or wider by a little where its arch swells past its jambs, so the curve never
  // touches the box's side)
  const box = bays.map((y, i) => { const hw = curves[i].half > y.span / 2 + 1e-6 ? curves[i].half + 0.02 : y.span / 2; return [y.x - hw, y.x + hw]; });
  const sides: { z: number; out: V3; ua: V3; uDir: V3 }[] = [{ z: t / 2, out: [0, 0, 1], ua: [1, 0, 0], uDir: [1, 0, 0] }];
  if (o.back !== false) sides.push({ z: -t / 2, out: [0, 0, -1], ua: [1, 0, 0], uDir: [-1, 0, 0] });
  const low = (i: number) => (o.onColumns ? bays[i].spring : 0);
  for (const sd of sides) {
    const O: V3 = [0, 0, sd.z], VA: V3 = [0, 1, 0];
    const rect = (u0: number, v0: number, u1: number, v1: number, m: Mat = mat) => rectOn(b, u0, v0, u1, v1, O, sd.ua, VA, sd.out, m, sd.uDir);
    // the ends and the piers between the openings, up to the spandrels' top
    rect(0, low(0), box[0][0], zone);
    for (let i = 0; i + 1 < bays.length; i++) rect(box[i][1], Math.min(low(i), low(i + 1)), box[i + 1][0], zone);
    rect(box[bays.length - 1][1], low(bays.length - 1), len, zone);
    // the wall over them all
    rect(0, zone, len, h);
    bays.forEach((y, i) => {
      const [x0, x1] = box[i], c = curves[i], ys = y.spring;
      if (!o.onColumns) {
        if (y.sill > 0) rect(x0, 0, x1, y.sill);
        rect(x0, y.sill, y.x - y.span / 2, ys);
        rect(y.x + y.span / 2, y.sill, x1, ys);
      }
      // the spandrels: the opening's box above its spring, round the arch
      const pts: V2[] = [[x0, ys], [x0, zone], [x1, zone], [x1, ys]];
      for (let k = c.pts.length - 1; k >= 0; k--) pts.push([y.x + c.pts[k][0], ys + c.pts[k][1]]);
      region(b, pts, O, sd.ua, VA, sd.out, span, sd.uDir);
    });
  }
  // the reveals: jambs and sills (not on columns: the arch springs from their abaci), the soffits
  if (o.reveals !== false) bays.forEach((y, i) => {
    const c = curves[i], ys = y.spring, xl = y.x - y.span / 2, xr = y.x + y.span / 2;
    if (!o.onColumns && ys > y.sill) {
      rectOn(b, -t / 2, y.sill, t / 2, ys, [xl, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0], soffit, [0, 0, -1]);
      rectOn(b, -t / 2, y.sill, t / 2, ys, [xr, 0, 0], [0, 0, 1], [0, 1, 0], [-1, 0, 0], soffit);
    }
    if (!o.onColumns && y.sill > 0) rectOn(b, xl, -t / 2, xr, t / 2, [0, y.sill, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0], soffit);
    soffitOf(b, c, y.x, ys, t / 2, -t / 2, soffit);
  });
  if (o.ends !== false) {
    rectOn(b, -t / 2, low(0), t / 2, h, [0, 0, 0], [0, 0, 1], [0, 1, 0], [-1, 0, 0], mat);
    rectOn(b, -t / 2, low(bays.length - 1), t / 2, h, [len, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0], mat, [0, 0, -1]);
  }
  if (o.top !== null) rectOn(b, 0, -t / 2, len, t / 2, [0, h, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0], o.top ?? mat);
  return { curves, zone };
}

/** an arch's soffit between two depths (z0 its front, z1 its back), smooth between the curve's breaks */
export function soffitOf(b: ArchBuilder, c: Curve, x: number, y: number, z0: number, z1: number, mat: Mat) {
  const cuts = [0, ...c.breaks, c.pts.length - 1];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const run = c.pts.slice(cuts[k], cuts[k + 1] + 1);
    if (run.length < 2) continue;
    sheet(b, [run.map(([u, v]) => [x + u, y + v, z0] as V3), run.map(([u, v]) => [x + u, y + v, z1] as V3)], mat);
  }
}

/** a band round an arch on a face (z0) standing out to z1: from the intrados (c) out to its extrados (e, the same
 *  points grown), its front, its outer edge, its inner edge (the soffit's carried on) and its feet; `alt`: every other
 *  voussoir of that */
export function archivolt(b: ArchBuilder, c: Curve, e: Curve, x: number, y: number, z0: number, z1: number, mat: Mat, alt?: Mat, every = 2, feet = true) {
  const P = c.pts.map(([u, v]) => [x + u, y + v] as V2), Q = e.pts.map(([u, v]) => [x + u, y + v] as V2), n = P.length;
  // the front: one island (or the voussoirs, each its own)
  if (alt === undefined) {
    const pts: V3[] = [...P.map(([u, v]) => [u, v, z1] as V3), ...Q.map(([u, v]) => [u, v, z1] as V3)];
    const tris: number[] = [];
    for (let i = 0; i + 1 < n; i++) tris.push(i, i + 1, n + i + 1, i, n + i + 1, n + i);
    b.patch(pts, tris, mat, [0, 0, 1]);
  } else {
    for (let i = 0; i + 1 < n; i += every) {
      const j = Math.min(n - 1, i + every), pts: V3[] = [];
      for (let k = i; k <= j; k++) pts.push([P[k][0], P[k][1], z1]);
      for (let k = j; k >= i; k--) pts.push([Q[k][0], Q[k][1], z1]);
      const tris: number[] = [], m = j - i + 1;
      for (let k = 0; k + 1 < m; k++) tris.push(k, k + 1, 2 * m - 2 - k, k, 2 * m - 2 - k, 2 * m - 1 - k);
      b.patch(pts, tris, ((i / every) & 1) ? alt : mat, [0, 0, 1]);
    }
  }
  // the outer edge (out from the curve's middle) and the inner (into the opening), the feet (down)
  for (let i = 0; i + 1 < n; i++) {
    const q0 = Q[i], q1 = Q[i + 1], dq: V3 = [q0[1] - q1[1], q1[0] - q0[0], 0];
    b.patch([[q0[0], q0[1], z0], [q1[0], q1[1], z0], [q1[0], q1[1], z1], [q0[0], q0[1], z1]], [0, 1, 2, 0, 2, 3], mat, dq);
  }
  soffitOf(b, c, x, y, z1, z0, mat);
  if (feet) for (const [i, j] of [[0, 1], [n - 1, n - 2]] as const) {
    // (its normal square to the foot, away from the curve)
    const p = P[i], q = Q[i], ex = q[0] - p[0], ey = q[1] - p[1], ax = p[0] - P[j][0], ay = p[1] - P[j][1];
    const out: V3 = ey * ax - ex * ay >= 0 ? [ey, -ex, 0] : [-ey, ex, 0];
    b.patch([[p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [p[0], p[1], z1]], [0, 1, 2, 0, 2, 3], mat, out);
  }
}

export interface ArcadeOpts extends PartOpts {
  /** openings, their span, the pier between them (pier mode) */
  bays?: number;
  span?: number;
  pier?: number;
  /** the arches' spring (the columns' height on columns) and the wall's top */
  spring?: number;
  h?: number;
  thick?: number;
  kind?: ArchKind;
  curve?: CurveOpts;
  /** on columns (their order and look), or on plain piers */
  columns?: ColumnOpts | false;
  /** the wall's, the arch's ring's (and its alternate voussoirs'), the spandrels' (a tile field: its palette) */
  mat?: Mat;
  ring?: Mat;
  alt?: Mat | null;
  spandrel?: Mat;
  pal?: number;
  /** a teal frieze over the arches (true) */
  frieze?: boolean;
}

/** a free-standing arcade, centred on the origin along x, its faces to ±z (see the header) */
export function arcade(b: ArchBuilder, o: ArcadeOpts = {}): Laid {
  return b.owner('arcade', () => {
    const { d } = begin(o);
    const n = o.bays ?? 3, s = o.span ?? 2.4, kind = o.kind ?? 'round', mat = o.mat ?? MAT.PLASTER;
    const colOpts = o.columns === false ? null : { order: 'round' as const, h: o.spring ?? 3.2, r: 0.24, ...(o.columns ?? {}), detail: d, top: true };
    const ab = colOpts ? abacusOf(colOpts) : null;
    // (on columns the wall a little thinner than their abaci, which show a ledge either side)
    const t = o.thick ?? (ab ? ab.half * 2 - 0.08 : 0.7);
    const pw = ab ? ab.half * 2 : (o.pier ?? 0.9);
    const spring = colOpts ? colOpts.h ?? 3.2 : (o.spring ?? 3.0);
    const segs = byDetail(d, 18, 10, 6);
    const ringW = byDetail(d, 0.22, 0.2, 0);
    const probe = archCurve(kind, s, segs, 0, o.curve);
    const crown = spring + probe.crown;
    const zone = crown + ringW + byDetail(d, 0.25, 0.22, 0.15);
    const fh = o.frieze === false || d === 'far' ? 0 : 0.5;
    const h = Math.max(o.h ?? 0, zone + fh + 0.3);
    const len = n * s + (n + 1) * pw, x0 = -len / 2;
    const bays: Bay[] = Array.from({ length: n }, (_, k) => ({ x: pw + s / 2 + k * (s + pw), span: s, sill: 0, spring, kind, curve: o.curve }));
    const spandrel = d === 'far' ? mat : o.spandrel ?? MAT.TILE;
    const pal = o.pal ?? TILE_PAL.HALL;
    // the wall (its top under the coping: none)
    b.group(() => {
      b.at(x0, 0, 0);
      b.with({ pal }, () => pierced(b, len, h, t, bays, mat, { segs, spandrel, zone, onColumns: !!colOpts, top: d === 'far' ? mat : null }));
      const zf = t / 2;
      for (const side of [1, -1]) b.group(() => {
        // (the back's the front turned half round about the wall's middle)
        if (side < 0) b.at(len, 0, 0, Math.PI);
        for (const y of bays) {
          if (ringW <= 0) continue;
          const c = archCurve(kind, s, segs, 0, o.curve), e = archCurve(kind, s, segs, ringW, o.curve);
          const alt = d === 'near' ? (o.alt === null ? undefined : o.alt ?? MAT.RED) : undefined;
          archivolt(b, c, e, y.x, spring, zf, zf + 0.05, o.ring ?? MAT.CREAM, alt);
          if (d === 'near') {
            // the keystone, gold, at the crown
            const kw = 0.16, top = spring + e.crown + 0.06;
            b.box(y.x - kw, spring + c.crown, zf + 0.05, y.x + kw, top, zf + 0.11, MAT.GOLD, { skip: ['n'] });
          }
        }
        // the frieze: a teal band proud of the wall over the arches
        if (fh > 0) b.box(0, zone, zf, len, zone + fh, zf + 0.04, MAT.TEAL, { skip: ['n'] });
      });
      // the coping: a fillet and the overhanging cap (near), or the cap alone
      if (d !== 'far') {
        if (d === 'near') b.box(-0.05, h, -t / 2 - 0.05, len + 0.05, h + 0.1, t / 2 + 0.05, MAT.CREAM, { skip: ['top'] });
        const y0 = d === 'near' ? h + 0.1 : h, oh = d === 'near' ? 0.16 : 0.1;
        b.box(-oh, y0, -t / 2 - oh, len + oh, y0 + 0.2, t / 2 + oh, MAT.CREAM);
      }
    });
    // the columns under the arches' springs
    const solids: number[][] = [];
    for (let j = 0; j <= n; j++) {
      const cx = x0 + pw / 2 + j * (s + pw);
      if (colOpts) b.group(() => { b.at(cx, 0, 0); column(b, { ...colOpts, seed: (o.seed ?? 1) * 31 + j, top: true }); });
      solids.push([cx - pw / 2, -t / 2, cx + pw / 2, t / 2, 0, h]);
    }
    solids.push([x0, -t / 2, -x0, t / 2, crown, h]);
    return { lights: [], top: h + (d === 'near' ? 0.3 : d === 'mid' ? 0.2 : 0), walk: { solids, floors: [], stairs: [] } };
  });
}

/** the detail an arcade's segments are at (for the others laying arches: windows, doors) */
export const segsFor = (d: Detail, w: number) => byDetail(d, w > 2 ? 18 : 12, w > 2 ? 10 : 8, w > 2 ? 6 : 4);
