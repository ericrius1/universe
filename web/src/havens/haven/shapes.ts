// World-space shape helpers for the Haven on top of ArchBuilder: vertical strips along a polyline (walls' faces, their
// texture running on round the curve without a seam), flat or sloped surfaces between two polylines (walks, wall tops,
// decks), arcs and lines round the temple, sector outlines between two radii and two side limits (planters, pools,
// walls bounded by the causeways), and the small furniture repeated through the gardens (piers, lanterns, urns,
// benches, finials, balusters). The builder's transform is left at identity: everything here is in world metres.
import type { ArchBuilder } from '../arch/builder';
import type { Mat, V3 } from '../arch/types';
import type { V2 } from '../world/layout';
import { C } from './plan';

/** a side limit of a sector: its angle at radius r */
export type Lim = (r: number) => number;

/** the ray from the temple's centre at angle a, moved sideways by o metres (toward larger angles when o > 0), as a
 *  side limit: where the circle of radius r crosses it */
export const rayLim = (a: number, o: number): Lim => (r) => a + Math.asin(Math.max(-1, Math.min(1, o / Math.max(r, Math.abs(o) + 1e-3))));
export const constLim = (a: number): Lim => () => a;
export const maxLim = (p: Lim, q: Lim): Lim => (r) => Math.max(p(r), q(r));
export const minLim = (p: Lim, q: Lim): Lim => (r) => Math.min(p(r), q(r));

export const pt = (r: number, a: number): V2 => [C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)];
export const v3 = (p: V2, y: number): V3 => [p[0], y, p[1]];

/** an arc at radius r from angle a0 to a1, in segments no longer than seg metres */
export function arc(r: number, a0: number, a1: number, seg = 3): V2[] {
  const n = Math.max(1, Math.ceil((Math.abs(a1 - a0) * r) / seg));
  return Array.from({ length: n + 1 }, (_, i) => pt(r, a0 + ((a1 - a0) * i) / n));
}

/** a path along a side limit from radius ra to rb */
export function side(lim: Lim, ra: number, rb: number, seg = 3): V2[] {
  const n = Math.max(1, Math.ceil(Math.abs(rb - ra) / seg));
  return Array.from({ length: n + 1 }, (_, i) => { const r = ra + ((rb - ra) * i) / n; return pt(r, lim(r)); });
}

/** the outline of the sector between radii ra < rb and side limits lo < hi: the inner arc, out along the hi side, the
 *  outer arc back and in along the lo side (counter-clockwise on a north-up map: its inside on the left of travel) */
export function sector(ra: number, rb: number, lo: Lim, hi: Lim, seg = 3): V2[] {
  const inner = arc(ra, lo(ra), hi(ra), seg);
  const hiSide = side(hi, ra, rb, seg).slice(1);
  const outer = arc(rb, hi(rb), lo(rb), seg).slice(1);
  const loSide = side(lo, rb, ra, seg).slice(1, -1);
  return [...inner, ...hiSide, ...outer, ...loSide];
}

/** two outlines of one sector, the second inset by d all round, with matching vertices (for a ring between them) */
export function sectorPair(ra: number, rb: number, lo: Lim, hi: Lim, d: number, seg = 3): [V2[], V2[]] {
  const nA = Math.max(1, Math.ceil((Math.abs(hi(ra) - lo(ra)) * ra) / seg)), nB = Math.max(1, Math.ceil((Math.abs(hi(rb) - lo(rb)) * rb) / seg));
  const nS = Math.max(1, Math.ceil((rb - ra) / seg));
  const build = (ra2: number, rb2: number, lo2: Lim, hi2: Lim) => {
    const out: V2[] = [];
    for (let i = 0; i < nA; i++) out.push(pt(ra2, lo2(ra2) + ((hi2(ra2) - lo2(ra2)) * i) / nA));
    for (let i = 0; i < nS; i++) { const r = ra2 + ((rb2 - ra2) * i) / nS; out.push(pt(r, hi2(r))); }
    for (let i = 0; i < nB; i++) out.push(pt(rb2, hi2(rb2) + ((lo2(rb2) - hi2(rb2)) * i) / nB));
    for (let i = 0; i < nS; i++) { const r = rb2 + ((ra2 - rb2) * i) / nS; out.push(pt(r, lo2(r))); }
    return out;
  };
  const outer = build(ra, rb, lo, hi);
  const inner = build(ra + d, rb - d, (r) => lo(r) + d / r, (r) => hi(r) - d / r);
  return [outer, inner];
}

/** the ArchBuilder in world metres with the Haven's shape helpers */
export class Shapes {
  constructor(readonly b: ArchBuilder) {}

  /** vertical faces along a polyline from y0 to y1 (numbers, or per-vertex arrays), facing the right of its direction
   *  of travel (or the left); the texture's u runs on along the whole path, its v is the world height */
  strip(path: V2[], y0: number | number[], y1: number | number[], mat: Mat, right = true, closed = false) {
    const n = path.length, segs = closed ? n : n - 1;
    let s = 0;
    for (let i = 0; i < segs; i++) {
      const p = path[i], q = path[(i + 1) % n];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 1e-6) continue;
      const a0 = typeof y0 === 'number' ? y0 : y0[i], b0 = typeof y0 === 'number' ? y0 : y0[(i + 1) % n];
      const a1 = typeof y1 === 'number' ? y1 : y1[i], b1 = typeof y1 === 'number' ? y1 : y1[(i + 1) % n];
      if (a1 - a0 < 1e-4 && b1 - b0 < 1e-4) { s += len; continue; }
      const tx = (q[0] - p[0]) / len, tz = (q[1] - p[1]) / len;
      // (polyW's u axis is the face's horizontal: along the travel on right-facing faces, against it on left-facing;
      // an origin s back along the travel makes u run on from the previous segment either way)
      const uo: V3 = [p[0] - tx * s, 0, p[1] - tz * s];
      const pts: V3[] = right
        ? [[p[0], a0, p[1]], [q[0], b0, q[1]], [q[0], b1, q[1]], [p[0], a1, p[1]]]
        : [[q[0], b0, q[1]], [p[0], a0, p[1]], [p[0], a1, p[1]], [q[0], b1, q[1]]];
      this.b.polyW(dropDegenerate(pts), mat, uo);
      s += len;
    }
    return this;
  }

  /** an upward (or downward) surface between a left and a right polyline (left and right of the direction of travel),
   *  at a height or per-vertex heights for each */
  flat(left: V2[], right: V2[], yl: number | number[], yr: number | number[], mat: Mat, down = false) {
    const n = Math.min(left.length, right.length);
    for (let i = 0; i < n - 1; i++) {
      const hl = (j: number) => (typeof yl === 'number' ? yl : yl[j]), hr = (j: number) => (typeof yr === 'number' ? yr : yr[j]);
      const pts: V3[] = [[left[i][0], hl(i), left[i][1]], [right[i][0], hr(i), right[i][1]], [right[i + 1][0], hr(i + 1), right[i + 1][1]], [left[i + 1][0], hl(i + 1), left[i + 1][1]]];
      this.b.polyW(dropDegenerate(down ? pts.reverse() : pts), mat);
    }
    return this;
  }

  /** a ring wall between an outline and its inset (matching vertices, closed): outer face from y0, inner face from
   *  yIn, both to y1, a cap of `cap` capH deep on top */
  ring(outer: V2[], inner: V2[], y0: number, yIn: number, y1: number, mat: Mat, cap: Mat, capH: number) {
    const o = [...outer, outer[0]], i = [...inner, inner[0]];
    // (sector outlines run counter-clockwise on the map, their inside on the left of travel: the outer face looks right,
    // the inner face back into the bed looks left)
    this.strip(o, y0, y1 - capH, mat, true).strip(o, y1 - capH, y1, cap, true);
    this.strip(i, yIn, y1 - capH, mat, false).strip(i, y1 - capH, y1, cap, false);
    this.flat(i, o, y1, y1, cap);
    return this;
  }

  /** a planar polygon of world points facing the side of `want` (its winding is put right whichever way it was
   *  listed) */
  face(pts: V3[], mat: Mat, want: V3) {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      nx += (a[1] - c[1]) * (a[2] + c[2]); ny += (a[2] - c[2]) * (a[0] + c[0]); nz += (a[0] - c[0]) * (a[1] + c[1]);
    }
    this.b.polyW(nx * want[0] + ny * want[1] + nz * want[2] < 0 ? [...pts].reverse() : pts, mat);
    return this;
  }

  /** a horizontal polygon (plan outline) at height y */
  slab(outline: V2[], y: number, mat: Mat, down = false) { this.b.slab(cleanOutline(outline), y, mat, down); return this; }

  /** an oriented box: centre (x, z), half sizes along its own axes (hx along the direction a, hz across), from y0 to
   *  y1; faces in skip left out */
  obox(x: number, z: number, a: number, hx: number, hz: number, y0: number, y1: number, mat: Mat, o: { top?: Mat; skip?: string[] } = {}) {
    this.b.push().at(x, 0, z, -a);
    this.b.box(-hx, y0, -hz, hx, y1, hz, mat, o);
    this.b.pop();
    return this;
  }

  /** a square pier of half-width h at (x, z) turned by a, from y0 to y1, with a cream cap block overhanging it */
  pier(x: number, z: number, a: number, h: number, y0: number, y1: number, mat: Mat, cap: Mat) {
    this.obox(x, z, a, h, h, y0, y1 - 0.18, mat, { skip: ['bottom'] });
    this.obox(x, z, a, h + 0.08, h + 0.08, y1 - 0.18, y1, cap, { skip: ['bottom'] });
    return this;
  }

  /** a lantern standing on a surface at y: a little glazed lamp with a cream roof and a gold knob; glows at night */
  lantern(x: number, z: number, a: number, y: number, mat: { glass: Mat; frame: Mat; knob: Mat }, s = 1) {
    const b = this.b;
    this.obox(x, z, a, 0.2 * s, 0.2 * s, y, y + 0.12 * s, mat.frame, { skip: ['bottom'] });
    b.with({ glow: 1, ao: 1 }, () => this.obox(x, z, a, 0.17 * s, 0.17 * s, y + 0.12 * s, y + 0.62 * s, mat.glass, { skip: ['bottom', 'top'] }));
    this.obox(x, z, a, 0.26 * s, 0.26 * s, y + 0.62 * s, y + 0.7 * s, mat.frame);
    b.push().at(x, 0, z, -a - Math.PI / 4);
    b.cylinder(0, 0, 0.37 * s, y + 0.7 * s, y + 0.92 * s, 4, mat.frame, { r1: 0.02 * s });
    b.pop();
    b.cylinder(x, z, 0.05 * s, y + 0.9 * s, y + 1.02 * s, 6, mat.knob, { r1: 0.0 });
    return this;
  }

  /** a terracotta urn on a plinth, standing at y */
  urn(x: number, z: number, y: number, body: Mat, rim: Mat, soil: Mat, s = 1) {
    const b = this.b;
    b.cylinder(x, z, 0.32 * s, y, y + 0.2 * s, 8, rim);
    b.lathe(x, y + 0.2 * s, z, [[0.16 * s, 0], [0.3 * s, 0.18 * s], [0.42 * s, 0.45 * s], [0.4 * s, 0.7 * s], [0.3 * s, 0.86 * s], [0.38 * s, 0.94 * s], [0.4 * s, 1.0 * s]], 10, body);
    b.cylinder(x, z, 0.37 * s, y + 0.95 * s, y + 0.97 * s, 10, soil, { top: soil });
    return this;
  }

  /** a stone bench along direction a, centred at (x, z) on a surface at y */
  bench(x: number, z: number, a: number, y: number, mat: Mat, len = 2.2) {
    const ca = Math.cos(a), sa = Math.sin(a);
    for (const e of [-0.42, 0.42]) this.obox(x + ca * e * len, z + sa * e * len, a, 0.12, 0.2, y, y + 0.36, mat, { skip: ['bottom'] });
    this.obox(x, z, a, len / 2, 0.26, y + 0.36, y + 0.46, mat);
    return this;
  }

  /** a small gold finial (a bulb and spike) on a surface at y */
  finial(x: number, z: number, y: number, mat: Mat, s = 1) {
    this.b.lathe(x, y, z, [[0.16 * s, 0], [0.2 * s, 0.1 * s], [0.13 * s, 0.25 * s], [0.07 * s, 0.4 * s], [0.025 * s, 0.75 * s], [0, 0.85 * s]], 8, mat);
    return this;
  }

  /** a balustrade along a straight run from p to q on a surface at y: a plinth, turned balusters every `step` m (the
   *  parts library's, placed instanced: between the plinth's top and the rail's underside) and a rail */
  balustrade(p: V2, q: V2, y: number, _mat: Mat, rail: Mat, h = 1.0, step = 0.42) {
    const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz);
    if (L < 0.3) return this;
    const a = Math.atan2(dz, dx), mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
    this.obox(mx, mz, a, L / 2, 0.2, y, y + 0.16, rail, { skip: ['bottom'] });
    this.obox(mx, mz, a, L / 2 + 0.04, 0.17, y + h - 0.14, y + h, rail);
    const n = Math.max(1, Math.floor(L / step)), scale = (h - 0.3) / BALUSTER_H;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      this.b.place('baluster-turned', [p[0] + dx * t, y + 0.16, p[1] + dz * t], { yaw: -a, scale });
    }
    return this;
  }
}

/** the parts library's baluster's height at its defaults (balustrade.ts baluster()) */
const BALUSTER_H = 0.68;

/** an outline without corners a few millimetres apart or in line with their neighbours (their slivers of triangles,
 *  a fraction of a square centimetre, came out wound against the face) */
function cleanOutline(p: V2[]): V2[] {
  let out = p.filter((q, i) => { const r = p[(i + p.length - 1) % p.length]; return Math.hypot(q[0] - r[0], q[1] - r[1]) > 0.005; });
  for (let pass = 0; pass < 2 && out.length > 3; pass++) {
    out = out.filter((q, i) => {
      const a = out[(i + out.length - 1) % out.length], c = out[(i + 1) % out.length];
      const cr = (q[0] - a[0]) * (c[1] - a[1]) - (q[1] - a[1]) * (c[0] - a[0]), L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      return Math.abs(cr) / Math.max(L, 1e-9) > 0.002;
    });
  }
  return out.length >= 3 ? out : p;
}

/** a polygon without repeated corners (a zero-height side of a sloped quad) */
function dropDegenerate(pts: V3[]): V3[] {
  const out: V3[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) > 1e-6) out.push(p);
  }
  const f = out[0], l = out[out.length - 1];
  if (out.length > 1 && Math.abs(f[0] - l[0]) + Math.abs(f[1] - l[1]) + Math.abs(f[2] - l[2]) < 1e-6) out.pop();
  return out;
}
