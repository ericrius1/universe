// Plan geometry for laying the town out: convex polygons whose edges carry what they face (a party wall, an alley, a
// street, a grand front), cut by lines and shrunk by per-edge margins the way the street network is carved out of the
// blocks, grown by a margin (what the town keeps back from everyone else's ground); plus the rings the ring streets
// follow, each the star's building line scaled about the citadel between the ring road's outer edge (k = 0) and the
// building line itself (k = 1). Polygons are kept with positive polyArea (builder.ts): with x east and z south that is
// clockwise on a north-up map, and an edge a -> b then faces outward along (dz, -dx).
import type { V2 } from '../world/layout';
import { STAR, WAYS, buildingReach } from '../world/layout';

/** what a lot's edge faces: 0 a neighbour (party wall), 1 an alley, 2 a street, 3 a grand front (the avenue, the
 *  plaza, a court) */
export type Front = 0 | 1 | 2 | 3;

export interface Poly { p: V2[]; f: Front[] }

export function area(p: V2[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return a / 2;
}

export function centroid(p: V2[]): V2 {
  let cx = 0, cz = 0, a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const k = p[j][0] * p[i][1] - p[i][0] * p[j][1];
    a += k; cx += (p[j][0] + p[i][0]) * k; cz += (p[j][1] + p[i][1]) * k;
  }
  if (Math.abs(a) < 1e-9) return p[0];
  return [cx / (3 * a), cz / (3 * a)];
}

export function bbox(p: V2[]): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return [x0, z0, x1, z1];
}

/** a polygon wound to positive area */
export function wind(q: Poly): Poly {
  if (area(q.p) >= 0) return q;
  const n = q.p.length;
  // reversing the points turns edge i (p[i] -> p[i+1]) into edge n-2-i of the reversed list
  const p = [...q.p].reverse();
  const f = p.map((_, i) => q.f[(n - 2 - i + n) % n]);
  return { p, f };
}

/** the part of a convex polygon where nx·x + nz·z <= d; the new edge along the line faces `cut` */
export function clipHalf(q: Poly, nx: number, nz: number, d: number, cut: Front): Poly {
  const p: V2[] = [], f: Front[] = [];
  const n = q.p.length;
  for (let i = 0; i < n; i++) {
    const a = q.p[i], b = q.p[(i + 1) % n];
    const da = nx * a[0] + nz * a[1] - d, db = nx * b[0] + nz * b[1] - d;
    const ina = da <= 0, inb = db <= 0;
    if (ina) { p.push(a); f.push(q.f[i]); }
    if (ina !== inb) {
      const t = da / (da - db);
      p.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      f.push(ina ? cut : q.f[i]);
    }
  }
  return dedupe({ p, f });
}

/** drop repeated points (and the zero-length edges they make) */
function dedupe(q: Poly): Poly {
  const p: V2[] = [], f: Front[] = [];
  for (let i = 0; i < q.p.length; i++) {
    const a = q.p[i], prev = p[p.length - 1];
    if (prev && Math.hypot(a[0] - prev[0], a[1] - prev[1]) < 1e-6) { f[f.length - 1] = q.f[i]; continue; }
    p.push(a); f.push(q.f[i]);
  }
  while (p.length > 1 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 1e-6) { p.pop(); f.pop(); }
  return { p, f };
}

/** a convex polygon (either winding) with each edge moved inward by d[i] (the intersection of the moved half-planes) */
export function inset(q: Poly, d: number[] | number): Poly {
  let r = q;
  const n = q.p.length;
  const sg = area(q.p) >= 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const a = q.p[i], b = q.p[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 1e-9) continue;
    const nx = (sg * dz) / L, nz = (-sg * dx) / L;
    const di = typeof d === 'number' ? d : d[i];
    r = clipHalf(r, nx, nz, nx * a[0] + nz * a[1] - di, q.f[i]);
    if (r.p.length < 3) return r;
  }
  return r;
}

/** a convex polygon split by the line n·p = c into the side below and the side above, `gap` apart; the new edges face
 *  `cut` */
export function split(q: Poly, nx: number, nz: number, c: number, gap: number, cut: Front): [Poly, Poly] {
  return [clipHalf(q, nx, nz, c - gap / 2, cut), clipHalf(q, -nx, -nz, -(c + gap / 2), cut)];
}

/** what's left of a convex polygon outside a convex hole: up to one convex piece per edge of the hole; the edges the
 *  hole leaves face `cut` */
export function subtract(q: Poly, hole: V2[], cut: Front): Poly[] {
  const out: Poly[] = [];
  let rest = q;
  const h = area(hole) >= 0 ? hole : [...hole].reverse();
  for (let i = 0; i < h.length && rest.p.length >= 3; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    const nx = dz / L, nz = -dx / L, d = nx * a[0] + nz * a[1];
    const outside = clipHalf(rest, -nx, -nz, -d, cut);
    if (outside.p.length >= 3 && area(outside.p) > 1) out.push(outside);
    rest = clipHalf(rest, nx, nz, d, cut);
  }
  return out;
}

export function inside(pt: V2, p: V2[]): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** a regular polygon (positive area) */
export function ngon(cx: number, cz: number, r: number, n: number, rot = 0): V2[] {
  return Array.from({ length: n }, (_, i) => {
    const a = rot + (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r] as V2;
  });
}

/** world plan point -> a frame's local plan (origin o, yaw as ArchBuilder.at) */
export function toLocal(p: V2, o: V2, yaw: number): V2 {
  const c = Math.cos(yaw), s = Math.sin(yaw), dx = p[0] - o[0], dz = p[1] - o[1];
  return [c * dx - s * dz, s * dx + c * dz];
}

/** a frame's local plan point -> world plan */
export function toWorld(p: V2, o: V2, yaw: number): V2 {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [o[0] + c * p[0] + s * p[1], o[1] - s * p[0] + c * p[1]];
}

/** the ring road's outer edge round the citadel: the town's rings start there (k = 0) */
const R0 = WAYS.ring.r1;

/** how far along the ray from the star's centre at angle a (radians, 0 = east, π/2 = south) the town's building line
 *  is (straight, RIM.building inside the point's edge: layout.ts buildingReach) */
export function townReach(a: number): number {
  return buildingReach((a * 180) / Math.PI);
}

/** the point at angle a on the ring k of the way from the ring road's outer edge (k = 0) to the building line (k = 1) */
export function ring(a: number, k: number): V2 {
  const t = R0 + (townReach(a) - R0) * k;
  return [STAR.cx + Math.cos(a) * t, STAR.cz + Math.sin(a) * t];
}

/** where a point sits between the ring road (0) and the building line (1) */
export function ringK(p: V2): number {
  const dx = p[0] - STAR.cx, dz = p[1] - STAR.cz, d = Math.hypot(dx, dz);
  return (d - R0) / (townReach(Math.atan2(dz, dx)) - R0);
}

/** a convex polygon grown by d: each edge moved out by d, its corners mitred (the town's margin round a claim that
 *  isn't its own) */
export function grow(p: V2[], d: number): V2[] {
  const q = area(p) >= 0 ? p : [...p].reverse(), n = q.length, out: V2[] = [];
  // (each edge's line moved out: a point on it and its direction; consecutive lines meet at the new corners)
  const lines = q.map((a, i) => {
    const b = q[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    return { p: [a[0] + (dz / L) * d, a[1] - (dx / L) * d] as V2, u: [dx / L, dz / L] as V2 };
  }).filter((_, i) => Math.hypot(q[(i + 1) % n][0] - q[i][0], q[(i + 1) % n][1] - q[i][1]) > 1e-6);
  for (let i = 0; i < lines.length; i++) {
    const A = lines[(i + lines.length - 1) % lines.length], B = lines[i];
    const den = A.u[0] * B.u[1] - A.u[1] * B.u[0];
    if (Math.abs(den) < 1e-9) { out.push(B.p); continue; }
    const t = ((B.p[0] - A.p[0]) * B.u[1] - (B.p[1] - A.p[1]) * B.u[0]) / den;
    out.push([A.p[0] + A.u[0] * t, A.p[1] + A.u[1] * t]);
  }
  return out;
}

/** how far a point is from a polygon (0 inside it) */
export function distanceTo(p: V2[], pt: V2): number {
  if (inside(pt, p)) return 0;
  let d = Infinity;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], ex = b[0] - a[0], ez = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * ex + (pt[1] - a[1]) * ez) / (ex * ex + ez * ez || 1)));
    d = Math.min(d, Math.hypot(pt[0] - a[0] - ex * t, pt[1] - a[1] - ez * t));
  }
  return d;
}

/** where the ray o + t·u (t > 0) first crosses segment a -> b: t, or Infinity */
export function rayHit(o: V2, u: V2, a: V2, b: V2): number {
  const ex = b[0] - a[0], ez = b[1] - a[1], den = u[0] * ez - u[1] * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const t = ((a[0] - o[0]) * ez - (a[1] - o[1]) * ex) / den, s = ((a[0] - o[0]) * u[1] - (a[1] - o[1]) * u[0]) / den;
  return t > 1e-6 && s >= 0 && s <= 1 ? t : Infinity;
}

/** a rectangle along a -> b, `half` m either side (positive area) */
export function strip(a: V2, b: V2, half: number): V2[] {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = (-dz / L) * half, nz = (dx / L) * half;
  const p: V2[] = [[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]];
  return area(p) >= 0 ? p : p.reverse();
}
