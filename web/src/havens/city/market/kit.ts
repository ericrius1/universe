// What the market's builders share: faces laid along a souk's side (in the side's frame, mitred where the outline
// turns, run() in plan.ts), an arch's ring of voussoirs, a few plain shapes, and the market's colours — the cloth of
// its awnings and canopies, the goods in its shops (the bible's palette made rich: saffron, paprika, turmeric, indigo,
// rose, teal, henna), each a tint of MAT.PAINT (its tint is its colour: no stripes) or of MAT.CLOTH (striped with
// cream, as the awnings are).
import type { ArchBuilder } from '../../arch/builder';
import type { City } from '../ctx';
import { lanternBody } from '../props';
import { archCurve, domePart, domeProfile, type ArchKind, type DomeOpts, type FinialKind } from '../../arch/parts';
import { MAT, type Mat, type V3 } from '../../arch/types';
import type { V2 } from '../../world/layout';
import { type Side, run } from './plan';

/** the cloth's colours (tints of MAT.CLOTH: striped with cream; of MAT.PAINT: the colour itself) */
export const CLOTH: V3[] = [
  [1.25, 0.42, 0.14], [0.2, 0.72, 0.68], [1.2, 0.26, 0.2], [1.3, 0.86, 0.22], [0.86, 0.3, 0.62], [0.32, 0.42, 1.0], [1.15, 0.6, 0.18],
];
/** solid colours for canopies and goods (MAT.PAINT): deeper than the cloth's, so they read from the air */
export const DYES: V3[] = [
  [1.15, 0.32, 0.12], [0.16, 0.58, 0.56], [0.95, 0.16, 0.14], [1.3, 0.8, 0.16], [0.7, 0.2, 0.5], [0.26, 0.32, 0.85], [1.25, 0.55, 0.12], [0.5, 0.62, 0.22],
];
/** spices in their heaps (MAT.PAINT) */
export const SPICES: V3[] = [[1.35, 0.62, 0.12], [1.2, 0.24, 0.1], [1.45, 1.05, 0.2], [0.62, 0.16, 0.16], [0.52, 0.64, 0.22], [0.75, 0.45, 0.22], [1.1, 0.75, 0.45]];

/** a vertical face along a side at depth d (its run's mitred ends), from y0 to y1, facing in (+z) or out (-z) */
export function vface(b: ArchBuilder, s: Side, d: number, y0: number, y1: number, mat: Mat, out: 1 | -1, into?: number) {
  const [x0, x1] = run(s, d, into);
  if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3) return;
  b.patch([[x0, y0, d], [x1, y0, d], [x1, y1, d], [x0, y1, d]], [0, 1, 2, 0, 2, 3], mat, [0, 0, out], [out, 0, 0]);
}

/** a level strip along a side between depths d0 and d1 at height y (its ends mitred), facing up or down */
export function hface(b: ArchBuilder, s: Side, d0: number, d1: number, y: number, mat: Mat, up = true, into?: number) {
  const [a0, a1] = run(s, d0, into), [c0, c1] = run(s, d1, into);
  b.patch([[a0, y, d0], [a1, y, d0], [c1, y, d1], [c0, y, d1]], [0, 1, 2, 0, 2, 3], mat, [0, up ? 1 : -1, 0], [1, 0, 0]);
}

/** an arch's ring on a face (z), the intrados of `kind` over `span` springing at (x, y), `w` wide: its voussoirs by
 *  turns of two materials, one patch each; a face only, standing `z` off its wall (PROUD or more) */
export function ring(b: ArchBuilder, kind: ArchKind, span: number, segs: number, x: number, y: number, z: number, w: number, a: Mat, c: Mat, every = 2) {
  const P = archCurve(kind, span, segs, 0).pts, Q = archCurve(kind, span, segs, w).pts, n = P.length;
  for (let i = 0, k = 0; i + 1 < n; i += every, k++) {
    const j = Math.min(n - 1, i + every), pts: V3[] = [];
    for (let m = i; m <= j; m++) pts.push([x + P[m][0], y + P[m][1], z]);
    for (let m = j; m >= i; m--) pts.push([x + Q[m][0], y + Q[m][1], z]);
    const tris: number[] = [], L = j - i + 1;
    for (let m = 0; m + 1 < L; m++) tris.push(m, m + 1, 2 * L - 2 - m, m, 2 * L - 2 - m, 2 * L - 1 - m);
    b.patch(pts, tris, k & 1 ? c : a, [0, 0, 1]);
  }
}

/** a box standing on something (no bottom), its faces listed in `skip` left off too */
export function block(b: ArchBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Mat, skip: string[] = [], top?: Mat) {
  b.box(x0, y0, z0, x1, y1, z1, mat, { skip: ['bottom', ...skip], top });
}

/** a sheet of cloth through a grid of local points (rows across, points along), both its faces: each the same
 *  triangles wound the two ways (a sagging quad isn't flat, and split two ways its faces would part and close a sliver
 *  of a shell) */
export function cloth(b: ArchBuilder, rows: V3[][], mat: Mat) {
  for (let j = 0; j + 1 < rows.length; j++) for (let i = 0; i + 1 < rows[j].length; i++) {
    const a = rows[j][i], c = rows[j][i + 1], e = rows[j + 1][i + 1], f = rows[j + 1][i];
    for (const t of [[a, c, e], [a, e, f]] as V3[][]) { b.poly(t, mat); b.poly([t[2], t[1], t[0]], mat); }
  }
}

/** an octagonal shaft (a column's, a post's) about (x, z) from y0 to y1, no caps */
export function shaft(b: ArchBuilder, x: number, z: number, r: number, y0: number, y1: number, mat: Mat, sides = 8) {
  const at = (i: number, y: number): V3 => { const a = ((i + 0.5) / sides) * Math.PI * 2; return [x + Math.cos(a) * r, y, z + Math.sin(a) * r]; };
  for (let i = 0; i < sides; i++) b.quad(at(i + 1, y0), at(i, y0), at(i, y1), at(i + 1, y1), mat);
}

/** a regular polygon's outline (local plan) */
export const gon = (x: number, z: number, r: number, n: number, rot = 0): V2[] => Array.from({ length: n }, (_, i) => {
  const a = rot + (i / n) * Math.PI * 2;
  return [x + Math.cos(a) * r, z + Math.sin(a) * r] as V2;
});

/** a dome on its drum (parts' domePart) at the frame's origin, its gold finial placed instanced (the part's own size:
 *  half the dome's radius, at least half a metre) rather than laid: a finial is the dearest thing on a small dome */
export function domeOf(b: ArchBuilder, o: DomeOpts & { tip?: FinialKind }) {
  const r = o.r ?? 2, kind = o.kind ?? 'round';
  domePart(b, { ...o, finial: null });
  if (o.tip === undefined && o.finial === null) return;
  const fk = o.tip ?? (kind === 'onion' ? 'spire' : kind === 'ribbed' ? 'lotus' : 'ball');
  const base = o.base ? r * 0.32 : 0, drum = o.drum ?? r * 0.5;
  const tip = base + drum + domeProfile(kind, r, o.rise).at(-1)![1] - r * 0.01;
  b.place(`finial-${fk}`, [0, tip, 0], { scale: Math.max(0.5, r * 0.55) });
}

/** a string of paper lanterns between two local points sagging `sag` at its middle (props.ts lanternString's), a
 *  lantern every `every` metres; `lit`: which of them (by their place along it, from 1) carry a light, and how strong
 *  — the market's strings light the paving under them, wider than a street's */
export function strand(c: City, a: V3, z: V3, sag: number, every: number, tints: V3[], lit: number[] = [], candela = 70, radius = 12) {
  const b = c.b, L = Math.hypot(z[0] - a[0], z[2] - a[2]), n = Math.max(2, Math.round(L / every));
  const at = (t: number): V3 => [a[0] + (z[0] - a[0]) * t, a[1] + (z[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (z[2] - a[2]) * t];
  // the cord, both its faces
  const segs = Math.min(8, n + 1);
  for (let i = 0; i < segs; i++) {
    const p = at(i / segs), q = at((i + 1) / segs), dx = q[0] - p[0], dz = q[2] - p[2], l = Math.hypot(dx, dz) || 1;
    const sx = (-dz / l) * 0.02, sz = (dx / l) * 0.02;
    const quad: V3[] = [[p[0] - sx, p[1] - 0.02, p[2] - sz], [q[0] - sx, q[1] - 0.02, q[2] - sz], [q[0] + sx, q[1] + 0.02, q[2] + sz], [p[0] + sx, p[1] + 0.02, p[2] + sz]];
    b.poly(quad, MAT.WOOD);
    b.poly([...quad].reverse(), MAT.WOOD);
  }
  for (let i = 1; i < n; i++) {
    const p = at(i / n);
    lanternBody(c, [p[0], p[1] - 0.32, p[2]], 0.14, tints[i % tints.length]);
    if (lit.includes(i)) c.light([p[0], p[1] - 0.5, p[2]], candela, { radius });
  }
}
