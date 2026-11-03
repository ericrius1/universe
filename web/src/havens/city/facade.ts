// A wall face with real openings in it. A Face is one planar wall between two plan points (left and right as seen from
// outside), from a base height up `h`; its coordinates are u along it from the left end, v up from its base and w into
// the wall (negative: standing out of it). wall() lays the face in horizontal bands between the openings' sills,
// springs and tops, leaving each opening as a hole: round and pointed arches get their spandrels as fans from the
// corners, and every opening its reveals (jambs, sill, head or arch soffit) back to a fill (a window that glows at night,
// a dark interior, a door) set in by its depth. Surrounds, sills, shutters and anything else that stands out of the wall
// are boxes in the same coordinates; a region (any simple outline on the face) is laid as one piece, so a tile field
// fitted to it runs whole across it.
import type { ArchBuilder } from '../arch/builder';
import { triangulate } from '../arch/builder';
import type { City } from './ctx';
import type { Mat, V3 } from '../arch/types';
import { MAT } from '../arch/types';
import type { V2 } from '../world/layout';

export type Arch = 'flat' | 'round' | 'pointed';
export type Side = 'front' | 'top' | 'bottom' | 'left' | 'right';

export interface Opening {
  u0: number;
  u1: number;
  /** the sill (0: a doorway) and the top (an arch's crown) above the face's base */
  v0: number;
  top: number;
  arch: Arch;
  /** how far in the fill sits (0: no hole, the fill laid flush on the wall, for far and humble faces) */
  depth: number;
  /** what's at the back (null: nothing, a passage open right through) */
  fill: Mat | null;
  glow?: number;
  fillTint?: V3;
  /** the fill's palette, if it's tiled or a lattice door (types.ts TILE_PAL) */
  pal?: number;
  /** a sill stone laid under it out of the wall (its top at the sill, back to the wall's face): the reveal's sill
   *  starts behind it, at the wall's face, so the two meet and don't overlap */
  sill?: boolean;
  /** false: no reveal under it (a passage at the ground, its floor the street's paving) */
  floor?: boolean;
  /** only the hole: a part from the parts library (a window, a door: arch/parts) lays its own reveal, fill and
   *  surround in it; its arch's curve given (`arc`, face coordinates, the left spring over the crown to the right), the
   *  part's own, so the hole is the part's */
  bare?: boolean;
  arc?: V2[];
  /** a surround standing 3 cm proud, `frameW` wide */
  frame?: Mat;
  frameW?: number;
  frameTint?: V3;
}

const PROUD = 0.03;

export class Face {
  readonly len: number;
  private ru: V3;
  private n: V3;

  /** left and right ends (local plan, seen from outside), the base height and the height */
  constructor(private b: ArchBuilder, private L: V2, R: V2, readonly y0: number, readonly h: number) {
    const dx = R[0] - L[0], dz = R[1] - L[1];
    this.len = Math.hypot(dx, dz) || 1;
    this.ru = [dx / this.len, 0, dz / this.len];
    // outward: right × up
    this.n = [-this.ru[2], 0, this.ru[0]];
  }

  /** the yaw (in the builder's current frame) that turns a part's local x along the face and its z out of it: what a
   *  small part placed on the face (b.place: a bracket, a wall lantern, a merlon on a parapet) is turned by */
  get yaw(): number { return Math.atan2(-this.ru[2], this.ru[0]); }

  at(u: number, v: number, w = 0): V3 {
    return [this.L[0] + this.ru[0] * u - this.n[0] * w, this.y0 + v, this.L[1] + this.ru[2] * u - this.n[2] * w];
  }

  /** a rectangle on the face's plane (or w in front of / behind it), facing out */
  rect(u0: number, v0: number, u1: number, v1: number, w: number, mat: Mat) {
    if (u1 - u0 < 1e-4 || v1 - v0 < 1e-4) return this;
    this.b.poly([this.at(u0, v0, w), this.at(u1, v0, w), this.at(u1, v1, w), this.at(u0, v1, w)], mat);
    return this;
  }

  /** a region of the face: a simple outline of (u, v) points, w in front of or behind it, facing out, laid as one
   *  piece (a tile field fitted whole across it) */
  region(pts: V2[], w: number, mat: Mat) {
    if (pts.length < 3) return this;
    this.b.patch(pts.map(([u, v]) => this.at(u, v, w)), triangulate(pts), mat, this.n);
    return this;
  }

  /** a level surface out of the face at height v, from u0 to u1 and w0 to w1 (a step's top), its uv square to the face */
  ledge(u0: number, u1: number, v: number, w0: number, w1: number, mat: Mat) {
    this.b.patch([this.at(u0, v, w0), this.at(u1, v, w0), this.at(u1, v, w1), this.at(u0, v, w1)], [0, 1, 2, 0, 2, 3], mat, [0, 1, 0], this.ru);
    return this;
  }

  /** a box standing out of the face (w0 < w1; negative w is outside the wall), its back left off unless asked for */
  box(u0: number, v0: number, u1: number, v1: number, w0: number, w1: number, mat: Mat, o: { top?: Mat; skip?: Side[]; back?: boolean } = {}) {
    const P = (u: number, v: number, w: number) => this.at(u, v, w);
    const sk = new Set(o.skip ?? []);
    const q = (a: V3, b: V3, c: V3, d: V3, m: Mat = mat) => this.b.poly([a, b, c, d], m);
    if (!sk.has('front')) q(P(u0, v0, w0), P(u1, v0, w0), P(u1, v1, w0), P(u0, v1, w0));
    if (!sk.has('top')) q(P(u0, v1, w0), P(u1, v1, w0), P(u1, v1, w1), P(u0, v1, w1), o.top ?? mat);
    if (!sk.has('bottom')) q(P(u0, v0, w1), P(u1, v0, w1), P(u1, v0, w0), P(u0, v0, w0));
    if (!sk.has('left')) q(P(u0, v0, w1), P(u0, v0, w0), P(u0, v1, w0), P(u0, v1, w1));
    if (!sk.has('right')) q(P(u1, v0, w0), P(u1, v0, w1), P(u1, v1, w1), P(u1, v1, w0));
    if (o.back) q(P(u1, v0, w1), P(u0, v0, w1), P(u0, v1, w1), P(u1, v1, w1));
    return this;
  }

  /** the face with its openings cut */
  wall(mat: Mat, ops: Opening[]) {
    const H = this.h, L = this.len;
    const shapes = ops.filter((o) => o.depth > 0).map((o) => ({ o, ...(o.arc ? { spring: o.arc[0][1], arc: o.arc } : archOf(o)) }));
    // horizontal bands between every sill, spring and top
    const vs = new Set<number>([0, H]);
    for (const s of shapes) { vs.add(clamp(s.o.v0, 0, H)); vs.add(clamp(s.spring, 0, H)); vs.add(clamp(s.o.top, 0, H)); }
    const breaks = [...vs].sort((a, b) => a - b);
    for (let i = 0; i < breaks.length - 1; i++) {
      const va = breaks[i], vb = breaks[i + 1];
      if (vb - va < 1e-4) continue;
      const cov = shapes.filter((s) => s.o.v0 <= va + 1e-4 && s.o.top >= vb - 1e-4).map((s) => [s.o.u0, s.o.u1] as V2).sort((a, b) => a[0] - b[0]);
      let u = 0;
      for (const [c0, c1] of cov) { if (c0 > u) this.rect(u, va, Math.min(c0, L), vb, 0, mat); u = Math.max(u, c1); }
      if (u < L) this.rect(u, va, L, vb, 0, mat);
    }
    for (const s of shapes) this.opening(s.o, s.arc, s.spring, mat);
    for (const o of ops) if (o.depth <= 0) this.flush(o);
    return this;
  }

  /** an opening's fill laid on the wall without a hole */
  private flush(o: Opening) {
    const fill = o.fill;
    if (fill === null) return;
    const { arc } = archOf(o);
    const pts: V3[] = o.arch === 'flat'
      ? [this.at(o.u0, o.v0, -0.012), this.at(o.u1, o.v0, -0.012), this.at(o.u1, o.top, -0.012), this.at(o.u0, o.top, -0.012)]
      : [this.at(o.u1, o.v0, -0.012), ...[...arc].reverse().map(([u, v]) => this.at(u, v, -0.012)), this.at(o.u0, o.v0, -0.012)];
    this.b.with({ glow: o.glow ?? 0, tint: o.fillTint, pal: o.pal }, () => this.b.poly(pts, fill));
  }

  private opening(o: Opening, arc: V2[], spring: number, wallMat: Mat) {
    const b = this.b, d = o.depth;
    const w0 = o.frame ? -PROUD : 0;
    // spandrels: the wall between an arch and its box's top corners
    if (o.arch !== 'flat') {
      const mid = arc.length >> 1;
      for (let i = 0; i < mid; i++) b.poly([this.at(o.u0, o.top), this.at(arc[i][0], arc[i][1]), this.at(arc[i + 1][0], arc[i + 1][1])], wallMat);
      for (let i = mid; i < arc.length - 1; i++) b.poly([this.at(o.u1, o.top), this.at(arc[i][0], arc[i][1]), this.at(arc[i + 1][0], arc[i + 1][1])], wallMat);
    }
    if (o.bare) return;
    const jambTop = o.arch === 'flat' ? o.top : spring;
    // reveals (none for an opening whose depth is only a passage's other mouth)
    if (d >= 0.02) this.reveals(o, arc, jambTop, w0, wallMat);
    if (o.fill === null) { this.surround(o, arc, jambTop); return; }
    // the fill, set in
    const fillPts: V3[] = o.arch === 'flat'
      ? [this.at(o.u0, o.v0, d), this.at(o.u1, o.v0, d), this.at(o.u1, o.top, d), this.at(o.u0, o.top, d)]
      : [this.at(o.u1, o.v0, d), ...[...arc].reverse().map(([u, v]) => this.at(u, v, d)), this.at(o.u0, o.v0, d)];
    const fill = o.fill;
    b.with({ glow: o.glow ?? 0, tint: o.fillTint, pal: o.pal }, () => b.poly(fillPts, fill));
    this.surround(o, arc, jambTop);
  }

  private reveals(o: Opening, arc: V2[], jambTop: number, w0: number, wallMat: Mat) {
    const b = this.b, d = o.depth;
    b.poly([this.at(o.u0, o.v0, w0), this.at(o.u0, o.v0, d), this.at(o.u0, jambTop, d), this.at(o.u0, jambTop, w0)], wallMat);
    b.poly([this.at(o.u1, o.v0, w0), this.at(o.u1, jambTop, w0), this.at(o.u1, jambTop, d), this.at(o.u1, o.v0, d)], wallMat);
    const ws = o.sill ? 0 : w0;
    if (o.floor !== false) b.poly([this.at(o.u0, o.v0, ws), this.at(o.u1, o.v0, ws), this.at(o.u1, o.v0, d), this.at(o.u0, o.v0, d)], o.v0 < 0.05 ? MAT.PAVING : wallMat);
    if (o.arch === 'flat') b.poly([this.at(o.u0, o.top, w0), this.at(o.u0, o.top, d), this.at(o.u1, o.top, d), this.at(o.u1, o.top, w0)], wallMat);
    else for (let i = 0; i < arc.length - 1; i++) {
      const p = arc[i], q = arc[i + 1];
      b.poly([this.at(p[0], p[1], w0), this.at(p[0], p[1], d), this.at(q[0], q[1], d), this.at(q[0], q[1], w0)], wallMat);
    }
  }

  /** the surround: its face only, standing a little proud */
  private surround(o: Opening, arc: V2[], jambTop: number) {
    const b = this.b;
    if (o.frame) {
      const fw = o.frameW ?? 0.18;
      b.with({ tint: o.frameTint }, () => {
        const m = o.frame!;
        this.rect(o.u0 - fw, o.v0, o.u0, jambTop, -PROUD, m);
        this.rect(o.u1, o.v0, o.u1 + fw, jambTop, -PROUD, m);
        if (o.arch === 'flat') this.rect(o.u0 - fw, o.top, o.u1 + fw, o.top + fw, -PROUD, m);
        else {
          const outer = archOf(o, arc.length - 1, fw).arc;
          for (let i = 0; i < arc.length - 1; i++) {
            const a = arc[i], c = arc[i + 1], A = outer[i], C = outer[i + 1];
            b.poly([this.at(a[0], a[1], -PROUD), this.at(c[0], c[1], -PROUD), this.at(C[0], C[1], -PROUD), this.at(A[0], A[1], -PROUD)], m);
          }
        }
      });
    }
  }
}

/** an opening's arch: its spring height and the points of its curve from the left spring over the crown to the right;
 *  `grow` widens the curve outward from the same centres (a surround's outer edge) */
export function archOf(o: Pick<Opening, 'u0' | 'u1' | 'top' | 'arch'>, segs?: number, grow = 0): { spring: number; arc: V2[] } {
  const w = o.u1 - o.u0, uc = (o.u0 + o.u1) / 2;
  if (o.arch === 'flat') return { spring: o.top, arc: [] };
  const n = segs ?? Math.max(4, Math.min(w > 6 ? 18 : 10, Math.round(w * 2.5)) & ~1);
  if (o.arch === 'round') {
    const r = w / 2, spring = o.top - r, rr = r + grow;
    return { spring, arc: Array.from({ length: n + 1 }, (_, i) => { const a = Math.PI * (1 - i / n); return [uc + Math.cos(a) * rr, spring + Math.sin(a) * rr] as V2; }) };
  }
  // pointed: two arcs of radius 0.8 w struck from inside the opposite jambs, meeting at the crown
  const R = w * 0.8, Rg = R + grow;
  const ta0 = Math.acos((w / 2 - R) / R), spring = o.top - R * Math.sin(ta0);
  const ta = Math.acos((w / 2 - R) / Rg);
  const half = n / 2;
  const left = Array.from({ length: half + 1 }, (_, i) => { const a = Math.PI - (Math.PI - ta) * (i / half); return [o.u0 + R + Math.cos(a) * Rg, spring + Math.sin(a) * Rg] as V2; });
  // (the right arc, struck from inside the left jamb, meets the crown at π - ta and runs down to its spring at 0: from
  // ta, as it was, its first points overshot the crown back over the left arc, the outline crossing itself — a spike
  // over the crown, the fill folded, the spandrels overlapping)
  const right = Array.from({ length: half }, (_, i) => { const a = (Math.PI - ta) * (1 - (i + 1) / half); return [o.u1 - R + Math.cos(a) * Rg, spring + Math.sin(a) * Rg] as V2; });
  return { spring, arc: [...left, ...right] };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** a strip of relief on a face from (u0, v0) to (u1, v1), `w` wide, its face at depth d (negative: standing out of the
 *  wall; positive: on a recessed panel's back): its face and its two long sides */
export function relief(c: City, f: Face, u0: number, v0: number, u1: number, v1: number, w: number, d: number, m: Mat = MAT.CREAM) {
  const du = u1 - u0, dv = v1 - v0, L = Math.hypot(du, dv) || 1;
  const nu = (-dv / L) * (w / 2), nv = (du / L) * (w / 2);
  const a = [u0 + nu, v0 + nv], bq = [u1 + nu, v1 + nv], cq = [u1 - nu, v1 - nv], e = [u0 - nu, v0 - nv];
  const at = (p: number[], ww: number) => f.at(p[0], p[1], ww);
  const base = d < 0 ? 0 : d + 0.12;
  c.b.poly([at(e, d), at(cq, d), at(bq, d), at(a, d)], m);
  c.b.poly([at(a, base), at(a, d), at(bq, d), at(bq, base)], m);
  c.b.poly([at(cq, base), at(cq, d), at(e, d), at(e, base)], m);
}
