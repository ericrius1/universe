// The geometry kit the city, the temple and the gardens are built with: boxes, extruded outlines, cylinders, domes,
// cones, stairs and ramps, each laid into one growing mesh in world metres under a current transform (a yaw and a
// translation: buildings are placed by their footprint's centre and turned about y). Every face gets uv in metres along
// it (u along the face's horizontal, v up, or the plan axes for flat faces), so textures tile at their real size, and
// carries the current material, tint, ambient and glow. finish() hands the typed arrays over.
import type { ArchMesh, Mat, V3 } from './types';
import type { V2 } from '../world/layout';

export interface Style { tint?: V3; ao?: number; glow?: number }

const EPS = 1e-9;
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

/** ear-clipping triangulation of a simple polygon (plan points); returns index triples into p, wound so the
 *  triangles face +y */
export function triangulate(p: V2[]): number[] {
  const n = p.length;
  if (n < 3) return [];
  const ids = Array.from({ length: n }, (_, i) => i);
  if (polyArea(p) < 0) ids.reverse();
  const out: number[] = [];
  const isEar = (a: V2, b: V2, c: V2, rest: number[]) => {
    const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cr <= EPS) return false;
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
    for (let i = 0; i < ids.length; i++) {
      const i0 = ids[(i + ids.length - 1) % ids.length], i1 = ids[i], i2 = ids[(i + 1) % ids.length];
      if (isEar(p[i0], p[i1], p[i2], ids)) { out.push(i0, i1, i2); ids.splice(i, 1); cut = true; break; }
    }
    if (!cut) break;
  }
  if (ids.length === 3) out.push(ids[0], ids[1], ids[2]);
  // (with z south, a plan-CCW triangle (x right, z down the page) faces -y: flip so caps face up)
  for (let i = 0; i < out.length; i += 3) { const t = out[i + 1]; out[i + 1] = out[i + 2]; out[i + 2] = t; }
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
  /** the current transform: yaw (radians, about +y, turning +x toward -z… i.e. counter-clockwise seen from above) and
   *  translation */
  private yaw = 0;
  private c = 1;
  private s = 0;
  private t: V3 = [0, 0, 0];
  private stack: { yaw: number; t: V3 }[] = [];
  style: Required<Style> = { tint: [1, 1, 1], ao: 1, glow: 0 };

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
    this.style = { tint: style.tint ?? st.tint, ao: style.ao ?? st.ao, glow: style.glow ?? st.glow };
    fn();
    this.style = st;
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
    this.G.push(Math.round(Math.max(0, Math.min(1, st.glow)) * 255));
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
    for (let i = 1; i < pts.length - 1; i++) this.I.push(base, base + i, base + i + 1);
    return this;
  }
  /** the same in local coordinates */
  poly(pts: V3[], mat: Mat) { return this.polyW(pts.map((p) => this.xf(p)), mat); }
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
   *  (x1, y1, z1), `width` wide, in `n` steps (riser + tread), with solid sides down to `foot` (default y0) */
  stairs(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, width: number, n: number, mat: Mat, o: { side?: Mat; foot?: number } = {}) {
    const dx = x1 - x0, dz = z1 - z0, run = Math.hypot(dx, dz) || 1;
    const fx = dx / run, fz = dz / run, rx = -fz * width / 2, rz = fx * width / 2;
    const foot = o.foot ?? y0;
    for (let k = 0; k < n; k++) {
      const ta = k / n, tb = (k + 1) / n;
      const ya = y0 + (y1 - y0) * ta, yb = y0 + (y1 - y0) * tb;
      const ax = x0 + dx * ta, az = z0 + dz * ta, bx = x0 + dx * tb, bz = z0 + dz * tb;
      // riser at a (facing down the flight), tread from a to b at height yb (facing up)
      this.quad([ax - rx, ya, az - rz], [ax + rx, ya, az + rz], [ax + rx, yb, az + rz], [ax - rx, yb, az - rz], mat);
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
   *  (`capH` tall, overhanging by `capOut`) */
  wall(path: V2[], y0: number, y1: number, thick: number, mat: Mat, o: { cap?: Mat; capH?: number; capOut?: number; closed?: boolean } = {}) {
    const n = path.length, segs = o.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = path[i], b = path[(i + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
      this.push().at(a[0], 0, a[1], Math.atan2(-dz, dx));
      this.box(0, y0, -thick / 2, L, y1, thick / 2, mat, { top: o.cap ?? mat });
      if (o.cap) {
        const h = o.capH ?? 0.4, out = o.capOut ?? 0.12;
        this.box(-out * 0.5, y1, -thick / 2 - out, L + out * 0.5, y1 + h, thick / 2 + out, o.cap);
      }
      this.pop();
    }
    return this;
  }

  /** append another builder's or a finished mesh's triangles as they are */
  merge(m: ArchMesh) {
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
    return {
      pos, nrm: new Float32Array(this.N), uv: new Float32Array(this.U), mat: new Uint8Array(this.M), tint: new Uint8Array(this.T),
      ao: new Uint8Array(this.A), glow: new Uint8Array(this.G), idx: new Uint32Array(this.I), bounds: [mn, mx],
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
