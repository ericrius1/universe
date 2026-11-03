// The geometry kit the city, the temple and the gardens are built with: boxes, extruded outlines, cylinders, domes,
// cones, stairs and ramps, each laid into one growing mesh in world metres under a current transform (a yaw and a
// translation: buildings are placed by their footprint's centre and turned about y). Every face gets uv in metres along
// it (u along the face's horizontal, v up, or the plan axes for flat faces), so textures tile at their real size, and
// carries the current material, tint, ambient and glow (on the tiles and the lattice doors, which never glow, the glow
// byte carries their palette instead: the style's `pal`). finish() hands the typed arrays over.
//
// The rules every builder follows (tools/geo-check.ts holds the world to them: `npm run check:geo` before a merge). The
// depth buffer is a reversed 32-bit float, so depth precision never makes two surfaces fight: two builders laying
// faces in one place does. So:
//   1. Nothing lies in another face's plane. Anything laid on a surface — a band, a trim, a panel, a plaque, a rug, a
//      tile field, a floor over a floor, paving over the ground — stands at least PROUD (2 cm) off it: proud(),
//      panel(), band(), or a height + PROUD by hand. Two faces facing the same way nearer than 6 mm over more than a
//      square centimetre fail the check (z-fight within 3 mm, near-coplanar within 6), whoever laid them — a builder
//      can fight itself (two overlapping awnings, a post laid twice).
//   2. A cap replaces a wall's top; it doesn't sit on it. A box under a cap or a roof skips its top (box's skip:
//      ['top'], cylinder's top: null), and the cap's underside is only the ring that overhangs (cappedBox(), wall()).
//      Where pieces stack or abut, one of the two touching faces is left out, or they overlap by more than PROUD.
//   3. No hidden faces: a face inside another solid, under the ground, or against another solid's face costs triangles
//      and no pixels (geo-check lists them: information, not a failure). Bottoms on or under the ground are skipped.
//   4. Faces are wound counter-clockwise seen from the side they face (polyW takes its normal from the winding; a
//      non-convex outline is clipped ear by ear, but a self-crossing one is a fault). A closed solid wound inside out,
//      or a face whose winding disagrees with its normals, fails the check.
//   5. Floors stand on the ground, not in it: an upward face buried more than 5 cm, a downward face at or under the
//      ground (seen only from under it), or an upward face lying on the terrain fail the check (the caverns, dug into
//      the rock, are let be).
//   6. Every triangle is laid under an owner (owner(): the district's builder, then its parts, 'hall/roof'), and inside
//      that owner's claims (world/claims.ts, listed in world/layout.ts): geo-check names every fault by the owners that
//      laid it and fails a triangle laid outside them.
import type { ArchMesh, Mat, PartPlacement, V3 } from './types';
import { isTiled } from './types';
import type { V2 } from '../world/layout';

/** a tint, an ambient, a glow (0..1); `pal` the tiles' palette (types.ts TILE_PAL) */
export interface Style { tint?: V3; ao?: number; glow?: number; pal?: number }

const EPS = 1e-9;

/** the least a surface laid on another stands off it (m): a band, a trim, a panel, a rug, a floor over a floor, paving
 *  over the ground (rule 1 above) */
export const PROUD = 0.02;
const norm3 = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** a polygon's signed area in plan (x, z): positive when counter-clockwise seen from above (+y), i.e. x→ then z↑… with
 *  z pointing south, "seen from above" means looking down -y, so CCW here is clockwise on a north-up map */
export function polyArea(p: V2[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] * p[i][1] - p[i][0] * p[j][1]);
  return a / 2;
}

/** ear-clipping triangulation of a simple polygon (2D points, either winding): index triples into p, each
 *  counter-clockwise (positive area) */
export function earClip(p: V2[]): number[] {
  const n = p.length;
  if (n < 3) return [];
  const ids = Array.from({ length: n }, (_, i) => i);
  if (polyArea(p) < 0) ids.reverse();
  const out: number[] = [];
  const isEar = (a: V2, b: V2, c: V2, rest: number[], lax: boolean) => {
    const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (lax ? cr < -EPS : cr <= EPS) return false;
    for (const k of rest) {
      const q = p[k];
      if (q === a || q === b || q === c) continue;
      const d1 = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
      const d2 = (c[0] - b[0]) * (q[1] - b[1]) - (c[1] - b[1]) * (q[0] - b[0]);
      const d3 = (a[0] - c[0]) * (q[1] - c[1]) - (a[1] - c[1]) * (q[0] - c[0]);
      if (d1 >= -EPS && d2 >= -EPS && d3 >= -EPS) return false;
    }
    return true;
  };
  let guard = 0;
  while (ids.length > 3 && guard++ < 10000) {
    let cut = false;
    // (a clean ear first; failing one — collinear runs, a polygon touching itself — one that's merely not reflex,
    // so the rest is still covered rather than left a hole)
    for (const lax of [false, true]) {
      for (let i = 0; i < ids.length; i++) {
        const i0 = ids[(i + ids.length - 1) % ids.length], i1 = ids[i], i2 = ids[(i + 1) % ids.length];
        if (isEar(p[i0], p[i1], p[i2], ids, lax)) { out.push(i0, i1, i2); ids.splice(i, 1); cut = true; break; }
      }
      if (cut) break;
    }
    if (!cut) break;
  }
  if (ids.length === 3) out.push(ids[0], ids[1], ids[2]);
  return out;
}

/** ear-clipping triangulation of a simple polygon (plan points); returns index triples into p, wound so the
 *  triangles face +y */
export function triangulate(p: V2[]): number[] {
  const out = earClip(p);
  // (with z south, a plan-CCW triangle (x right, z down the page) faces -y: flip so caps face up)
  for (let i = 0; i < out.length; i += 3) { const t = out[i + 1]; out[i + 1] = out[i + 2]; out[i + 2] = t; }
  return out;
}

/** a planar polygon's triangles (index triples into pts) wound as it is, facing n: a fan if it's convex, else
 *  clipped ear by ear in its own plane (a fan over a reflex corner folds back on itself: triangles facing the other way
 *  over the ones beside them) */
function planarTris(pts: V3[], n: V3): number[] {
  const m = pts.length, out: number[] = [];
  // (convex: every corner turns the polygon's own way about n)
  let convex = true;
  for (let i = 0; i < m && convex; i++) {
    const a = pts[i], b = pts[(i + 1) % m], c = pts[(i + 2) % m];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - b[0], vy = c[1] - b[1], vz = c[2] - b[2];
    if (n[0] * (uy * vz - uz * vy) + n[1] * (uz * vx - ux * vz) + n[2] * (ux * vy - uy * vx) < -1e-7) convex = false;
  }
  if (convex) { for (let i = 1; i < m - 1; i++) out.push(0, i, i + 1); return out; }
  // (a frame on its plane, (e1, e2, n) right-handed: the polygon counter-clockwise in it)
  const e1 = norm3(Math.abs(n[1]) < 0.9 ? cross3([0, 1, 0], n) : cross3([1, 0, 0], n)), e2 = cross3(n, e1);
  const o = pts[0];
  return earClip(pts.map((p) => { const d = sub3(p, o); return [dot3(d, e1), dot3(d, e2)] as V2; }));
}

/** a plan polyline moved d to the left of its travel (negative: the right), its corners mitred (a miter at most 4 d
 *  long: a sharper corner is clipped there) */
export function offsetPath(path: V2[], d: number, closed = false): V2[] {
  const n = path.length;
  const dir = (i: number): V2 => {
    const a = path[i], b = path[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  // (left of travel in plan with z south, seen from above: x→ then z↓ the page, left is (dz, -dx))
  const left = (t: V2): V2 => [t[1], -t[0]];
  return path.map((p, i) => {
    const first = !closed && i === 0, last = !closed && i === n - 1;
    const tin = first ? dir(0) : dir((i - 1 + n) % n), tout = last ? dir(n - 2) : dir(i);
    const nl = left(tin), nr = left(tout);
    const m: V2 = [nl[0] + nr[0], nl[1] + nr[1]], ml = Math.hypot(m[0], m[1]);
    if (ml < 1e-9) return [p[0] + nr[0] * d, p[1] + nr[1] * d] as V2;
    const k = Math.min(1 / Math.max((m[0] * nr[0] + m[1] * nr[1]) / ml, 0.25), 4);
    return [p[0] + (m[0] / ml) * d * k, p[1] + (m[1] / ml) * d * k] as V2;
  });
}

/** an open polyline with its two ends drawn on by e along their segments */
function extendEnds(path: V2[], e: number): V2[] {
  const n = path.length, out = path.map((p) => [p[0], p[1]] as V2);
  const a = path[0], b = path[1], y = path[n - 2], z = path[n - 1];
  const la = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, lz = Math.hypot(z[0] - y[0], z[1] - y[1]) || 1;
  out[0] = [a[0] - ((b[0] - a[0]) / la) * e, a[1] - ((b[1] - a[1]) / la) * e];
  out[n - 1] = [z[0] + ((z[0] - y[0]) / lz) * e, z[1] + ((z[1] - y[1]) / lz) * e];
  return out;
}

export class ArchBuilder {
  private P: number[] = [];
  private N: number[] = [];
  private U: number[] = [];
  private M: number[] = [];
  private T: number[] = [];
  private A: number[] = [];
  private G: number[] = [];
  private I: number[] = [];
  /** who made the triangles (owner(): geo-check names a fault by it): the owners' names (0 is no one's), and runs of
   *  [first triangle, owner] each time it changes */
  private owners: string[] = [''];
  private ownerIds = new Map<string, number>([['', 0]]);
  private ownerRuns: number[] = [0, 0];
  private ownerNow = 0;
  /** the small parts placed instanced (place(): parts/protos.ts), in world space, each with the owner it was placed
   *  under: the builder hands them over as its part's `instances` */
  readonly placements: PartPlacement[] = [];
  /** the current transform: yaw (radians, about +y, turning +x toward -z… i.e. counter-clockwise seen from above) and
   *  translation */
  private yaw = 0;
  private c = 1;
  private s = 0;
  private t: V3 = [0, 0, 0];
  private stack: { yaw: number; t: V3 }[] = [];
  style: Required<Style> = { tint: [1, 1, 1], ao: 1, glow: 0, pal: 0 };

  get vertexCount() { return this.P.length / 3; }
  get triangleCount() { return this.I.length / 3; }

  /** place what follows at (x, y, z), turned by yaw (radians); nests with push/pop */
  at(x: number, y: number, z: number, yaw = 0) {
    const [px, py, pz] = this.xf([x, y, z]);
    this.t = [px, py, pz];
    this.yaw += yaw;
    this.c = Math.cos(this.yaw);
    this.s = Math.sin(this.yaw);
    return this;
  }
  push() { this.stack.push({ yaw: this.yaw, t: [...this.t] as V3 }); return this; }
  pop() {
    const f = this.stack.pop();
    if (f) { this.yaw = f.yaw; this.t = f.t; this.c = Math.cos(f.yaw); this.s = Math.sin(f.yaw); }
    return this;
  }
  /** run fn with the transform and style it sets undone after */
  group(fn: () => void) {
    const st = { ...this.style };
    this.push();
    fn();
    this.pop();
    this.style = st;
    return this;
  }
  with(style: Style, fn: () => void) {
    const st = this.style;
    this.style = { tint: style.tint ?? st.tint, ao: style.ao ?? st.ao, glow: style.glow ?? st.glow, pal: style.pal ?? st.pal };
    fn();
    this.style = st;
    return this;
  }

  /** run fn with what it lays made by `name`, under the owner it's called in ('hall', then 'roof' in it: 'hall/roof').
   *  Owners are what the world's claims (world/claims.ts) and geo-check go by: the district's builder lays everything
   *  under its claim's owner, and a fault is reported with the owner that made each triangle */
  owner<T>(name: string, fn: () => T): T {
    const was = this.ownerNow, full = was ? `${this.owners[was]}/${name}` : name;
    let id = this.ownerIds.get(full);
    if (id === undefined) { id = this.owners.length; this.owners.push(full); this.ownerIds.set(full, id); }
    this.setOwner(id);
    try { return fn(); } finally { this.setOwner(was); }
  }
  private setOwner(id: number) {
    if (id === this.ownerNow) return;
    const tri = this.I.length / 3, n = this.ownerRuns.length;
    // (a run that never got a triangle is replaced, not kept)
    if (this.ownerRuns[n - 2] === tri) this.ownerRuns[n - 1] = id;
    else this.ownerRuns.push(tri, id);
    this.ownerNow = id;
  }

  /** a small part drawn instanced (a parts/protos.ts PROTOS name: 'merlon-stepped', 'lantern-wall') with its origin
   *  at local `p`, turned by `yaw` in the current frame, under the current owner. It isn't laid in the mesh (geo-check
   *  doesn't see it): place it to the rules by hand, its foot on what it stands on, its back on its wall */
  place(proto: string, p: V3, o: { yaw?: number; scale?: number; tint?: V3 } = {}) {
    const owner = this.owners[this.ownerNow];
    this.placements.push({ proto, p: this.xf(p), yaw: this.yaw + (o.yaw ?? 0), scale: o.scale, tint: o.tint, ...(owner ? { owner } : {}) });
    return this;
  }

  /** local -> world point */
  xf(p: V3): V3 {
    const { c, s, t } = this;
    return [t[0] + c * p[0] + s * p[2], t[1] + p[1], t[2] - s * p[0] + c * p[2]];
  }
  /** local -> world direction */
  xd(d: V3): V3 {
    const { c, s } = this;
    return [c * d[0] + s * d[2], d[1], -s * d[0] + c * d[2]];
  }

  private vert(p: V3, n: V3, uv: V2, mat: Mat) {
    this.P.push(p[0], p[1], p[2]);
    this.N.push(n[0], n[1], n[2]);
    this.U.push(uv[0], uv[1]);
    this.M.push(mat);
    const st = this.style;
    this.T.push(Math.round(Math.min(255, st.tint[0] * 128)), Math.round(Math.min(255, st.tint[1] * 128)), Math.round(Math.min(255, st.tint[2] * 128)));
    this.A.push(Math.round(Math.max(0, Math.min(1, st.ao)) * 255));
    this.G.push(isTiled(mat) ? st.pal : Math.round(Math.max(0, Math.min(1, st.glow)) * 255));
    return this.P.length / 3 - 1;
  }

  /** a planar polygon of world points (counter-clockwise seen from the side it faces), uv projected on its plane in
   *  metres: u along the horizontal in the plane (or plan x for flat faces), v up the plane (or plan z) */
  polyW(pts: V3[], mat: Mat, uvOrigin?: V3) {
    if (pts.length < 3) return this;
    let n: V3 = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])];
    }
    n = norm3(n);
    const o = uvOrigin ?? [0, 0, 0];
    let ua: V3, va: V3;
    if (Math.abs(n[1]) > 0.7) { ua = [1, 0, 0]; va = [0, 0, 1]; }
    else { ua = norm3([n[2], 0, -n[0]]); va = norm3(cross3(n, ua)); if (va[1] < 0) va = [-va[0], -va[1], -va[2]]; }
    const base = this.P.length / 3;
    for (const p of pts) { const d = sub3(p, o); this.vert(p, n, [dot3(d, ua), dot3(d, va)], mat); }
    for (const i of pts.length === 3 ? [0, 1, 2] : planarTris(pts, n)) this.I.push(base + i);
    return this;
  }
  /** the same in local coordinates */
  poly(pts: V3[], mat: Mat) { return this.polyW(pts.map((p) => this.xf(p)), mat); }

  /** a planar patch of local points and the triangles over them (index triples, either winding: each is turned to
   *  face `out`, a local direction), its vertices shared: one island, so a fitted pattern (a tile field) runs whole
   *  across it. uv as polyW's, or u along `ua` (a local direction in its plane: a step's top tiled square to the step) */
  patch(pts: V3[], tris: number[], mat: Mat, out: V3, ua?: V3) {
    if (pts.length < 3) return this;
    const W = pts.map((p) => this.xf(p)), n = norm3(this.xd(out));
    let u: V3, v: V3;
    if (ua) { const d = this.xd(ua), k = dot3(d, n); u = norm3([d[0] - n[0] * k, d[1] - n[1] * k, d[2] - n[2] * k]); v = cross3(n, u); }
    else if (Math.abs(n[1]) > 0.7) { u = [1, 0, 0]; v = [0, 0, 1]; }
    else { u = norm3([n[2], 0, -n[0]]); v = norm3(cross3(n, u)); if (v[1] < 0) v = [-v[0], -v[1], -v[2]]; }
    const base = this.P.length / 3;
    for (const p of W) this.vert(p, n, [dot3(p, u), dot3(p, v)], mat);
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i], b = tris[i + 1], c = tris[i + 2];
      const f = dot3(cross3(sub3(W[b], W[a]), sub3(W[c], W[a])), n) >= 0;
      this.I.push(base + a, base + (f ? b : c), base + (f ? c : b));
    }
    return this;
  }
  quad(a: V3, b: V3, c: V3, d: V3, mat: Mat) { return this.poly([a, b, c, d], mat); }

  /** an axis-aligned (in local space) box from (x0, y0, z0) to (x1, y1, z1); faces listed in `skip` are left out
   *  ('top' 'bottom' 'n' 's' 'e' 'w'); `top` overrides the top face's material */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Mat, o: { top?: Mat; skip?: string[] } = {}) {
    const sk = new Set(o.skip ?? []);
    if (!sk.has('top')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], o.top ?? mat);
    if (!sk.has('bottom')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], mat);
    if (!sk.has('s')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], mat);
    if (!sk.has('n')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], mat);
    if (!sk.has('e')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], mat);
    if (!sk.has('w')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], mat);
    return this;
  }
  /** a box by centre and half sizes (local) */
  block(cx: number, y0: number, cz: number, hx: number, h: number, hz: number, mat: Mat, o: { top?: Mat; skip?: string[] } = {}) {
    return this.box(cx - hx, y0, cz - hz, cx + hx, y0 + h, cz + hz, mat, o);
  }

  /** an outline (local plan points, any winding) extruded from y0 to y1: walls of `mat`, a top cap of `top` (null: none),
   *  a bottom cap if `bottom` */
  prism(outline: V2[], y0: number, y1: number, mat: Mat, o: { top?: Mat | null; bottom?: Mat | null } = {}) {
    const p = polyArea(outline) < 0 ? [...outline].reverse() : outline;
    // (plan-CCW with z south is clockwise seen from above: walls wound so they face outward)
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      this.quad([b[0], y0, b[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]], mat);
    }
    const tris = triangulate(p);
    const top = o.top === undefined ? mat : o.top;
    if (top !== null) this.capW(p.map(([x, z]) => this.xf([x, y1, z])), tris, top, false);
    if (o.bottom != null) this.capW(p.map(([x, z]) => this.xf([x, y0, z])), tris, o.bottom, true);
    return this;
  }
  private capW(pts: V3[], tris: number[], mat: Mat, down: boolean) {
    const n: V3 = down ? [0, -1, 0] : [0, 1, 0];
    const base = this.P.length / 3;
    for (const q of pts) this.vert(q, n, [q[0], q[2]], mat);
    for (let i = 0; i < tris.length; i += 3) {
      if (down) this.I.push(base + tris[i], base + tris[i + 2], base + tris[i + 1]);
      else this.I.push(base + tris[i], base + tris[i + 1], base + tris[i + 2]);
    }
  }

  /** a flat horizontal polygon (local plan points) at height y, facing up (or down) */
  slab(outline: V2[], y: number, mat: Mat, down = false) {
    this.capW(outline.map(([x, z]) => this.xf([x, y, z])), triangulate(outline), mat, down);
    return this;
  }

  /** a cylinder (or n-sided prism) about local (cx, cz), radius r, from y0 to y1; smooth normals when sides ≥ 12 */
  cylinder(cx: number, cz: number, r: number, y0: number, y1: number, sides: number, mat: Mat, o: { top?: Mat | null; bottom?: boolean; r1?: number } = {}) {
    const r1 = o.r1 ?? r;
    const smooth = sides >= 12;
    const circ = 2 * Math.PI * Math.max(r, r1);
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      const p00: V3 = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], p10: V3 = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r];
      const p01: V3 = [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1], p11: V3 = [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1];
      if (!smooth) { this.quad(p10, p00, p01, p11, mat); continue; }
      const slope = (r - r1) / Math.max(y1 - y0, EPS);
      const n0 = norm3(this.xd([Math.cos(a0), slope, Math.sin(a0)])), n1 = norm3(this.xd([Math.cos(a1), slope, Math.sin(a1)]));
      const u0 = (i / sides) * circ, u1 = ((i + 1) / sides) * circ;
      const b = this.P.length / 3;
      this.vert(this.xf(p10), n1, [u1, y0], mat); this.vert(this.xf(p00), n0, [u0, y0], mat);
      this.vert(this.xf(p01), n0, [u0, y1], mat); this.vert(this.xf(p11), n1, [u1, y1], mat);
      this.I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const ring = (y: number, rr: number) => Array.from({ length: sides }, (_, i) => [cx + Math.cos((i / sides) * Math.PI * 2) * rr, cz + Math.sin((i / sides) * Math.PI * 2) * rr] as V2);
    if (o.top !== null && r1 > 0.001) this.slab(ring(y1, r1), y1, o.top ?? mat);
    if (o.bottom) this.slab(ring(y0, r), y0, mat, true);
    return this;
  }

  /** a dome over local (cx, cz) springing at y from radius r: `rise` its height (r: a hemisphere), `bulge` > 1 swells
   *  it past the drum like an onion, `tip` a pointed crown (0 round .. 1 a sharp point) */
  dome(cx: number, y: number, cz: number, r: number, mat: Mat, o: { rise?: number; bulge?: number; tip?: number; rings?: number; sides?: number } = {}) {
    const rise = o.rise ?? r, bulge = o.bulge ?? 1, tip = o.tip ?? 0;
    const rings = o.rings ?? 12, sides = o.sides ?? 24;
    const prof: [number, number][] = [];
    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      const a = t * Math.PI * 0.5;
      let rr = Math.cos(a) * r * (1 + (bulge - 1) * Math.sin(a * 2) * 0.9);
      const hh = Math.sin(a) * rise;
      rr *= 1 - tip * Math.pow(t, 3) * 0.6;
      prof.push([rr, hh + tip * Math.pow(t, 6) * rise * 0.35]);
    }
    return this.lathe(cx, y, cz, prof, sides, mat);
  }

  /** a surface of revolution about local (cx, cz): profile points [radius, height above y] from the bottom up */
  lathe(cx: number, y: number, cz: number, prof: [number, number][], sides: number, mat: Mat) {
    const base = this.P.length / 3;
    let along = 0;
    const vlen: number[] = [0];
    for (let j = 1; j < prof.length; j++) { along += Math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]); vlen.push(along); }
    for (let j = 0; j < prof.length; j++) {
      const [rr, hh] = prof[j];
      const pj = prof[Math.max(0, j - 1)], nj = prof[Math.min(prof.length - 1, j + 1)];
      const dr = nj[0] - pj[0], dh = nj[1] - pj[1];
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const n = norm3(this.xd([dh * ca, -dr, dh * sa]));
        this.vert(this.xf([cx + ca * rr, y + hh, cz + sa * rr]), n, [(i / sides) * 2 * Math.PI * Math.max(prof[0][0], 0.5), vlen[j]], mat);
      }
    }
    for (let j = 0; j < prof.length - 1; j++) for (let i = 0; i < sides; i++) {
      const a = base + j * (sides + 1) + i, b = a + sides + 1;
      this.I.push(a, b, a + 1, a + 1, b, b + 1);
    }
    return this;
  }

  /** a straight flight of stairs (local): from the bottom edge's centre (x0, y0, z0) to the top edge's centre
   *  (x1, y1, z1), `width` wide, in `n` steps (riser + tread), with solid sides down to `foot` (default y0); the risers
   *  of `riser` if given (tiled) */
  stairs(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, width: number, n: number, mat: Mat, o: { side?: Mat; foot?: number; riser?: Mat } = {}) {
    const dx = x1 - x0, dz = z1 - z0, run = Math.hypot(dx, dz) || 1;
    const fx = dx / run, fz = dz / run, rx = -fz * width / 2, rz = fx * width / 2;
    const foot = o.foot ?? y0;
    for (let k = 0; k < n; k++) {
      const ta = k / n, tb = (k + 1) / n;
      const ya = y0 + (y1 - y0) * ta, yb = y0 + (y1 - y0) * tb;
      const ax = x0 + dx * ta, az = z0 + dz * ta, bx = x0 + dx * tb, bz = z0 + dz * tb;
      // riser at a (facing down the flight), tread from a to b at height yb (facing up)
      this.quad([ax - rx, ya, az - rz], [ax + rx, ya, az + rz], [ax + rx, yb, az + rz], [ax - rx, yb, az - rz], o.riser ?? mat);
      this.quad([ax + rx, yb, az + rz], [bx + rx, yb, bz + rz], [bx - rx, yb, bz - rz], [ax - rx, yb, az - rz], mat);
      // sides, facing out
      const side = o.side ?? mat;
      this.quad([ax - rx, yb, az - rz], [bx - rx, yb, bz - rz], [bx - rx, foot, bz - rz], [ax - rx, foot, az - rz], side);
      this.quad([bx + rx, yb, bz + rz], [ax + rx, yb, az + rz], [ax + rx, foot, az + rz], [bx + rx, foot, bz + rz], side);
    }
    return this;
  }

  /** a sloped ramp slab (local): bottom edge centre a, top edge centre b, width, thickness under its surface */
  ramp(a: V3, b: V3, width: number, thick: number, mat: Mat, side?: Mat) {
    const dx = b[0] - a[0], dz = b[2] - a[2], run = Math.hypot(dx, dz) || 1;
    const rx = (-dz / run) * width / 2, rz = (dx / run) * width / 2;
    const A0: V3 = [a[0] - rx, a[1], a[2] - rz], A1: V3 = [a[0] + rx, a[1], a[2] + rz];
    const B0: V3 = [b[0] - rx, b[1], b[2] - rz], B1: V3 = [b[0] + rx, b[1], b[2] + rz];
    const d = (p: V3): V3 => [p[0], p[1] - thick, p[2]];
    // (every face wound to face out: the top up, the underside down, the sides and ends away from the slab)
    this.quad(A1, B1, B0, A0, mat);
    const s = side ?? mat;
    this.quad(d(A0), d(B0), d(B1), d(A1), s);
    this.quad(A0, B0, d(B0), d(A0), s);
    this.quad(B1, A1, d(A1), d(B1), s);
    this.quad(A1, A0, d(A0), d(A1), s);
    this.quad(B0, B1, d(B1), d(B0), s);
    return this;
  }

  /** a wall along a local plan polyline from y0 to y1, `thick` thick (centred on the line), with a cap of `cap`
   *  (`capH` tall, overhanging by `capOut`) on top. Its faces meet mitred at the corners; under a cap it has no top
   *  of its own and the cap's underside is only the ring that overhangs (rules 1 and 2); it has no bottom */
  wall(path: V2[], y0: number, y1: number, thick: number, mat: Mat, o: { cap?: Mat; capH?: number; capOut?: number; closed?: boolean } = {}) {
    const closed = !!o.closed, n = path.length, segs = closed ? n : n - 1;
    if (segs < 1) return this;
    const L = offsetPath(path, thick / 2, closed), R = offsetPath(path, -thick / 2, closed);
    const P = (q: V2, y: number): V3 => [q[0], y, q[1]];
    // (left of travel, then right: each face wound to look out of the wall)
    const sides = (l: V2[], r: V2[], ya: number, yb: number, m: Mat) => {
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % n;
        this.quad(P(l[j], ya), P(l[i], ya), P(l[i], yb), P(l[j], yb), m);
        this.quad(P(r[i], ya), P(r[j], ya), P(r[j], yb), P(r[i], yb), m);
      }
      if (!closed) {
        this.quad(P(l[0], ya), P(r[0], ya), P(r[0], yb), P(l[0], yb), m);
        this.quad(P(r[n - 1], ya), P(l[n - 1], ya), P(l[n - 1], yb), P(r[n - 1], yb), m);
      }
    };
    const top = (l: V2[], r: V2[], y: number, m: Mat) => { for (let i = 0; i < segs; i++) { const j = (i + 1) % n; this.quad(P(r[i], y), P(r[j], y), P(l[j], y), P(l[i], y), m); } };
    sides(L, R, y0, y1, mat);
    if (!o.cap) { top(L, R, y1, mat); return this; }
    const h = o.capH ?? 0.4, out = o.capOut ?? 0.12;
    // the cap: its outline out by `out` all round (and past an open wall's ends), its faces, its top, and underneath
    // only the ring between it and the wall
    const ext = closed ? path : extendEnds(path, out);
    const CL = offsetPath(ext, thick / 2 + out, closed), CR = offsetPath(ext, -thick / 2 - out, closed);
    sides(CL, CR, y1, y1 + h, o.cap);
    top(CL, CR, y1 + h, o.cap);
    if (out > 1e-4) {
      const under = (a: V2, b: V2, c: V2, d: V2) => this.quad(P(a, y1), P(b, y1), P(c, y1), P(d, y1), o.cap!);
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % n;
        under(CL[i], CL[j], L[j], L[i]);
        under(R[i], R[j], CR[j], CR[i]);
      }
      if (!closed) { under(CR[0], CL[0], L[0], R[0]); under(CL[n - 1], CR[n - 1], R[n - 1], L[n - 1]); }
    }
    return this;
  }

  // -- laying detail on a surface (rule 1) -------------------------------------------------------------------------

  /** run fn with everything it lays moved `by` (PROUD) out along a local direction: the way the surface it's laid on
   *  faces. For detail built in the surface's own coordinates (a tile field drawn on a wall's plane, a plaque) */
  proud<T>(n: V3, fn: () => T, by = PROUD): T {
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    this.push().at((n[0] / l) * by, (n[1] / l) * by, (n[2] / l) * by);
    try { return fn(); } finally { this.pop(); }
  }

  /** a flat panel (a plaque, a rug, a tile field, a painted board) on the surface its local points lie on, wound to
   *  face out: laid `by` (PROUD) out along the way it faces, its edges (of `edge`, default its own material; null:
   *  none) down to the surface so it reads as a slab and not a sheet floating off it */
  panel(pts: V3[], mat: Mat, o: { by?: number; edge?: Mat | null } = {}) {
    if (pts.length < 3) return this;
    const by = o.by ?? PROUD;
    let n: V3 = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])];
    }
    n = norm3(n);
    const up = pts.map((p): V3 => [p[0] + n[0] * by, p[1] + n[1] * by, p[2] + n[2] * by]);
    this.poly(up, mat);
    if (o.edge !== null) for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      this.quad(pts[i], pts[j], up[j], up[i], o.edge ?? mat);
    }
    return this;
  }

  /** a band along a wall's face (a string course, a frieze, a cornice's fascia): the face's line as a local plan
   *  polyline (the outside on the right of travel), the band from y0 to y1 standing `out` (at least PROUD) off it,
   *  mitred at the corners: its face, its top (top: null when something sits on it), its underside (under: false when
   *  it stands on something), its ends (an open run's) */
  band(path: V2[], y0: number, y1: number, mat: Mat, o: { out?: number; closed?: boolean; top?: Mat | null; under?: boolean } = {}) {
    const closed = !!o.closed, n = path.length, segs = closed ? n : n - 1;
    if (segs < 1 || y1 - y0 < 1e-4) return this;
    const out = Math.max(o.out ?? PROUD, PROUD);
    const F = offsetPath(path, -out, closed), P = (q: V2, y: number): V3 => [q[0], y, q[1]];
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n;
      this.quad(P(F[i], y0), P(F[j], y0), P(F[j], y1), P(F[i], y1), mat);
      if (o.top !== null) this.quad(P(F[i], y1), P(F[j], y1), P(path[j], y1), P(path[i], y1), o.top ?? mat);
      if (o.under !== false) this.quad(P(path[i], y0), P(path[j], y0), P(F[j], y0), P(F[i], y0), mat);
    }
    if (!closed) {
      this.quad(P(path[0], y0), P(F[0], y0), P(F[0], y1), P(path[0], y1), mat);
      this.quad(P(F[n - 1], y0), P(path[n - 1], y0), P(path[n - 1], y1), P(F[n - 1], y1), mat);
    }
    return this;
  }

  /** a box whose top `cap.h` metres are a cap standing `cap.out` off its sides (the cream band round a flat roof, a
   *  pier's capital): the body's sides below it, the cap's sides, its top (the roof: the body has none) and only the
   *  overhanging ring underneath (rule 2). `skip` as box's, for the body ('bottom' is skipped unless asked for) */
  cappedBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Mat, cap: { mat: Mat; h: number; out?: number; top?: Mat }, o: { skip?: string[]; bottom?: boolean } = {}) {
    const yc = y1 - cap.h, out = cap.out ?? 0;
    this.box(x0, y0, z0, x1, yc, z1, mat, { skip: ['top', ...(o.bottom ? [] : ['bottom']), ...(o.skip ?? [])] });
    this.box(x0 - out, yc, z0 - out, x1 + out, y1, z1 + out, cap.mat, { skip: ['bottom'], top: cap.top });
    if (out > 1e-4) {
      const X0 = x0 - out, X1 = x1 + out, Z0 = z0 - out, Z1 = z1 + out;
      // (the ring under the overhang, facing down: four strips round the body's top)
      this.quad([X0, yc, Z0], [X1, yc, Z0], [x1, yc, z0], [x0, yc, z0], cap.mat);
      this.quad([x0, yc, z1], [x1, yc, z1], [X1, yc, Z1], [X0, yc, Z1], cap.mat);
      this.quad([X0, yc, Z1], [X0, yc, Z0], [x0, yc, z0], [x0, yc, z1], cap.mat);
      this.quad([x1, yc, z1], [x1, yc, z0], [X1, yc, Z0], [X1, yc, Z1], cap.mat);
    }
    return this;
  }

  /** append another builder's or a finished mesh's triangles as they are */
  merge(m: ArchMesh) {
    // (a mesh that says who made it keeps them, under the owner it's merged in)
    if (m.owner && m.owners) {
      const t0 = this.I.length / 3, was = this.ownerNow;
      for (let t = 0; t < m.owner.length; t++) {
        if (t > 0 && m.owner[t] === m.owner[t - 1]) continue;
        const name = m.owners[m.owner[t]];
        const full = name ? (was ? `${this.owners[was]}/${name}` : name) : this.owners[was];
        let id = this.ownerIds.get(full);
        if (id === undefined) { id = this.owners.length; this.owners.push(full); this.ownerIds.set(full, id); }
        // (the run starts at the merged triangle's place)
        const n = this.ownerRuns.length, at = t0 + t;
        if (this.ownerRuns[n - 2] === at) this.ownerRuns[n - 1] = id; else if (this.ownerRuns[n - 1] !== id) this.ownerRuns.push(at, id);
        this.ownerNow = id;
      }
      this.appendMesh(m);
      this.setOwner(was);
      return this;
    }
    return this.appendMesh(m);
  }
  private appendMesh(m: ArchMesh) {
    const base = this.P.length / 3;
    for (let i = 0; i < m.pos.length; i++) this.P.push(m.pos[i]);
    for (let i = 0; i < m.nrm.length; i++) this.N.push(m.nrm[i]);
    for (let i = 0; i < m.uv.length; i++) this.U.push(m.uv[i]);
    for (let i = 0; i < m.mat.length; i++) this.M.push(m.mat[i]);
    for (let i = 0; i < m.tint.length; i++) this.T.push(m.tint[i]);
    for (let i = 0; i < m.ao.length; i++) this.A.push(m.ao[i]);
    for (let i = 0; i < m.glow.length; i++) this.G.push(m.glow[i]);
    for (let i = 0; i < m.idx.length; i++) this.I.push(m.idx[i] + base);
    return this;
  }

  finish(): ArchMesh {
    const pos = new Float32Array(this.P);
    const mn: V3 = [Infinity, Infinity, Infinity], mx: V3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); }
    const tris = this.I.length / 3, owner = new Uint16Array(tris), R = this.ownerRuns;
    for (let r = 0; r < R.length; r += 2) owner.fill(R[r + 1], R[r], r + 2 < R.length ? R[r + 2] : tris);
    return {
      pos, nrm: new Float32Array(this.N), uv: new Float32Array(this.U), mat: new Uint8Array(this.M), tint: new Uint8Array(this.T),
      ao: new Uint8Array(this.A), glow: new Uint8Array(this.G), idx: new Uint32Array(this.I), bounds: [mn, mx],
      owner, owners: [...this.owners],
    };
  }
}

/** a mesh as Wavefront OBJ (+ an MTL naming each material), for looking at it in Blender */
export function toObj(m: ArchMesh, name = 'arch'): { obj: string; mtl: string } {
  const lines: string[] = [`mtllib ${name}.mtl`, `o ${name}`];
  for (let i = 0; i < m.pos.length; i += 3) lines.push(`v ${m.pos[i].toFixed(4)} ${m.pos[i + 1].toFixed(4)} ${m.pos[i + 2].toFixed(4)}`);
  for (let i = 0; i < m.nrm.length; i += 3) lines.push(`vn ${m.nrm[i].toFixed(4)} ${m.nrm[i + 1].toFixed(4)} ${m.nrm[i + 2].toFixed(4)}`);
  for (let i = 0; i < m.uv.length; i += 2) lines.push(`vt ${m.uv[i].toFixed(4)} ${m.uv[i + 1].toFixed(4)}`);
  let cur = -1;
  for (let i = 0; i < m.idx.length; i += 3) {
    const a = m.idx[i], b = m.idx[i + 1], c = m.idx[i + 2];
    const mt = m.mat[a];
    if (mt !== cur) { lines.push(`usemtl m${mt}`); cur = mt; }
    lines.push(`f ${a + 1}/${a + 1}/${a + 1} ${b + 1}/${b + 1}/${b + 1} ${c + 1}/${c + 1}/${c + 1}`);
  }
  const mtl = Array.from({ length: 32 }, (_, i) => `newmtl m${i}\nKd 0.8 0.8 0.8\n`).join('\n');
  return { obj: lines.join('\n'), mtl };
}
