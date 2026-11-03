// The city's small parts, laid in the builder's current frame: domes on drums with gold finials, chimney turrets with
// domed caps, cloth awnings and banners on a wall face, lanterns (on brackets, hanging, strung across streets), palm
// planters, braziers, merlons, and straight flights of stairs that are walked as well as drawn. Each one that lights
// the night adds its LightSpot, each one that grows something its GardenBed.
import type { Mat, V3 } from '../arch/types';
import { MAT } from '../arch/types';
import type { V2 } from '../world/layout';
import type { City, Collide } from './ctx';
import { FIRE } from './ctx';
import type { Face } from './facade';
import { ngon } from './geom';

/** the awnings' and banners' cloth colours (tints of MAT.CLOTH) */
export const CLOTHS: V3[] = [
  [1.15, 0.62, 0.22], [0.28, 0.78, 0.72], [1.2, 1.05, 0.78], [1.05, 0.3, 0.2], [0.9, 0.42, 0.7], [1.15, 0.86, 0.3], [0.45, 0.55, 1.0],
];
/** the domes' glazes (tints of MAT.DOME): cerulean, turquoise, lapis */
export const GLAZES: V3[] = [[1, 1, 1], [1.9, 1.75, 0.95], [0.72, 0.78, 1.08]];
/** shutters' and doors' paints (tints of MAT.WOOD) */
export const PAINTS: V3[] = [[0.45, 1.05, 1.0], [0.5, 0.75, 1.25], [0.6, 1.1, 0.6], [1.3, 1.0, 0.55], [1.2, 0.6, 0.45], [1, 1, 1]];

/** a dome on a drum over local (x, z) from height y: the drum `drum` tall, the dome of radius r; a gold finial on top */
export function dome(c: City, x: number, y: number, z: number, r: number, o: { drum?: number; sides?: number; bulge?: number; tip?: number; rise?: number; finial?: boolean; drumMat?: Mat; band?: boolean; glaze?: V3; mat?: Mat } = {}) {
  const b = c.b;
  const sides = o.sides ?? (r > 3 ? 24 : r > 1.6 ? 16 : 12);
  const drum = o.drum ?? r * 0.45;
  const dm = o.drumMat ?? MAT.CREAM;
  if (drum > 0) {
    b.cylinder(x, z, r * 1.02, y, y + drum, sides, dm, { top: null });
    // a cornice ring where the dome springs
    if (o.band !== false) b.cylinder(x, z, r * 1.1, y + drum - 0.04 - r * 0.06, y + drum + r * 0.02, sides, MAT.CREAM, { top: MAT.CREAM });
  }
  const y1 = y + drum;
  b.with({ tint: o.glaze ?? GLAZES[0] }, () => b.dome(x, y1, z, r, o.mat ?? MAT.DOME, { rise: o.rise ?? r * 1.05, bulge: o.bulge ?? 1, tip: o.tip ?? 0.25, rings: r > 3 ? 10 : r > 1.6 ? 7 : 5, sides }));
  if (o.finial !== false) {
    const top = y1 + (o.rise ?? r * 1.05) + (o.tip ?? 0.25) * (o.rise ?? r * 1.05) * 0.35;
    const s = Math.max(0.12, r * 0.07);
    b.cylinder(x, z, s * 0.6, top - s, top + s * 1.5, 6, MAT.GOLD, { r1: s * 0.35 });
    b.dome(x, top + s * 1.4, z, s * 1.2, MAT.GOLD, { rise: s * 1.4, tip: 0.8, rings: 4, sides: 8 });
  }
  return y1 + (o.rise ?? r * 1.05);
}

/** a chimney turret: a square shaft (half-width hw) from y0 up h, a projecting cornice, a domed cap */
export function turret(c: City, x: number, z: number, y0: number, hw: number, h: number, m: Mat, o: { capMat?: Mat; glaze?: V3; round?: boolean } = {}) {
  const b = c.b;
  if (o.round) b.cylinder(x, z, hw, y0, y0 + h, 12, m, { top: null });
  else b.box(x - hw, y0, z - hw, x + hw, y0 + h, z + hw, m, { skip: ['bottom', 'top'] });
  // the flared head: a cornice, a short attic, the cap
  const y1 = y0 + h;
  b.box(x - hw * 1.25, y1, z - hw * 1.25, x + hw * 1.25, y1 + hw * 0.3, z + hw * 1.25, MAT.CREAM);
  b.box(x - hw * 1.05, y1 + hw * 0.3, z - hw * 1.05, x + hw * 1.05, y1 + hw * 0.9, z + hw * 1.05, m, { skip: ['bottom'] });
  b.with({ tint: o.glaze ?? GLAZES[0] }, () => b.dome(x, y1 + hw * 0.9, z, hw * 1.05, o.capMat ?? MAT.DOME, { rise: hw * 1.5, tip: 0.7, rings: 6, sides: 8 }));
  return y1 + hw * 2.6;
}

/** a cloth awning on a face over u0..u1, hung at v, standing out `out` and dropping `drop`; seen from above and below */
export function awning(c: City, f: Face, u0: number, u1: number, v: number, out: number, drop: number, tint: V3, valance = true) {
  const b = c.b;
  b.with({ tint }, () => {
    const a0 = f.at(u0, v, -0.02), a1 = f.at(u1, v, -0.02), b1 = f.at(u1, v - drop, -out), b0 = f.at(u0, v - drop, -out);
    b.poly([b0, b1, a1, a0], MAT.CLOTH);
    b.poly([a0, a1, b1, b0], MAT.CLOTH);
    if (valance) {
      const vd = Math.min(0.35, drop * 0.6);
      const c0 = f.at(u0, v - drop - vd, -out), c1 = f.at(u1, v - drop - vd, -out);
      b.poly([c0, c1, b1, b0], MAT.CLOTH);
      b.poly([b0, b1, c1, c0], MAT.CLOTH);
    }
  });
}

/** a banner hung on a face: centre u, from vTop down h, w wide, on a short pole */
export function banner(c: City, f: Face, u: number, vTop: number, w: number, h: number, tint: V3) {
  const b = c.b;
  b.with({ tint }, () => {
    const pts: V3[] = [f.at(u - w / 2, vTop - h, -0.12), f.at(u + w / 2, vTop - h, -0.12), f.at(u + w / 2, vTop, -0.12), f.at(u - w / 2, vTop, -0.12)];
    b.poly(pts, MAT.CLOTH);
    b.poly([...pts].reverse(), MAT.CLOTH);
    // a pointed tail
    const tail: V3[] = [f.at(u - w / 2, vTop - h, -0.12), f.at(u, vTop - h - w * 0.5, -0.12), f.at(u + w / 2, vTop - h, -0.12)];
    b.poly(tail, MAT.CLOTH);
    b.poly([...tail].reverse(), MAT.CLOTH);
  });
  f.box(u - w / 2 - 0.12, vTop, u + w / 2 + 0.12, vTop + 0.1, -0.2, 0, MAT.GOLD);
}

/** a paper lantern's body at a local point (a little lit box with caps), hung or set */
export function lanternBody(c: City, p: V3, s: number, tint: V3 = [1.25, 0.55, 0.25]) {
  const b = c.b;
  b.with({ tint, glow: 1 }, () => b.cylinder(p[0], p[2], s, p[1] - s * 1.2, p[1] + s * 1.2, 4, MAT.CLOTH, { top: null, bottom: true }));
  b.cylinder(p[0], p[2], s * 1.15, p[1] + s * 1.2, p[1] + s * 1.75, 4, MAT.WOOD, { r1: 0.01, top: null });
}

/** a lantern on a bracket out of a face at (u, v), with its light (none at candela 0) */
export function wallLantern(c: City, f: Face, u: number, v: number, candela = 60) {
  f.box(u - 0.04, v + 0.25, u + 0.04, v + 0.33, -0.55, 0, MAT.WOOD, { skip: ['left', 'right', 'front'] });
  const p = f.at(u, v, -0.5);
  lanternBody(c, p, 0.16);
  if (candela > 0) c.light(f.at(u, v - 0.1, -0.7), candela, { radius: 9 });
}

/** a string of lanterns between two local points, sagging `sag` at its middle; `lit` of them carry a light */
export function lanternString(c: City, a: V3, z: V3, sag: number, every: number, tints: V3[], lightEvery = 4) {
  const b = c.b;
  const L = Math.hypot(z[0] - a[0], z[2] - a[2]);
  const n = Math.max(2, Math.round(L / every));
  const at = (t: number): V3 => [a[0] + (z[0] - a[0]) * t, a[1] + (z[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (z[2] - a[2]) * t];
  // the cord: thin segments
  const segs = Math.min(8, n + 1);
  for (let i = 0; i < segs; i++) {
    const p = at(i / segs), q = at((i + 1) / segs);
    const dx = q[0] - p[0], dz = q[2] - p[2], l = Math.hypot(dx, dz) || 1;
    const sx = (-dz / l) * 0.02, sz = (dx / l) * 0.02;
    b.poly([[p[0] - sx, p[1] - 0.02, p[2] - sz], [q[0] - sx, q[1] - 0.02, q[2] - sz], [q[0] + sx, q[1] + 0.02, q[2] + sz], [p[0] + sx, p[1] + 0.02, p[2] + sz]], MAT.WOOD);
    b.poly([[p[0] + sx, p[1] - 0.02, p[2] + sz], [q[0] + sx, q[1] - 0.02, q[2] + sz], [q[0] - sx, q[1] + 0.02, q[2] - sz], [p[0] - sx, p[1] + 0.02, p[2] - sz]], MAT.WOOD);
  }
  for (let i = 1; i < n; i++) {
    const p = at(i / n);
    lanternBody(c, [p[0], p[1] - 0.32, p[2]], 0.13, tints[i % tints.length]);
    if (i % lightEvery === Math.floor(lightEvery / 2)) c.light([p[0], p[1] - 0.5, p[2]], 35, { radius: 8 });
  }
}

/** a round stone planter with a palm (or another bed) at local (x, z): radius r, h tall */
export function planter(c: City, x: number, z: number, r: number, h: number, kind: 'palms' | 'cypress' | 'trees' | 'blossom' | 'shrubs' | 'flowers', y = 0) {
  const b = c.b;
  b.cylinder(x, z, r, y - 0.3, y + h, 12, MAT.ASHLAR, { top: null });
  b.cylinder(x, z, r + 0.1, y + h, y + h + 0.12, 12, MAT.CREAM, { top: null });
  b.cylinder(x, z, r - 0.15, y + h - 0.2, y + h + 0.12, 12, MAT.CREAM, { top: MAT.SOIL });
  c.bed(ngon(x, z, r - 0.15, 8), y + h - 0.08, kind, kind === 'palms' || kind === 'cypress' ? 1 : 0.8, kind === 'flowers' ? 'mixed' : undefined);
}

/** a brazier on a stone stand at local (x, z) on y: a gold bowl of coals that glow and light the night */
export function brazier(c: City, x: number, y: number, z: number, s = 1, when: 'night' | 'always' = 'night') {
  const b = c.b;
  b.cylinder(x, z, 0.32 * s, y, y + 0.25 * s, 8, MAT.ASHLAR);
  b.cylinder(x, z, 0.16 * s, y + 0.25 * s, y + 1.05 * s, 8, MAT.CREAM, { top: null });
  b.cylinder(x, z, 0.2 * s, y + 1.05 * s, y + 1.25 * s, 10, MAT.GOLD, { r1: 0.55 * s, top: null, bottom: true });
  b.with({ glow: 1, tint: [1.4, 0.55, 0.2] }, () => b.dome(x, y + 1.18 * s, z, 0.5 * s, MAT.WINDOW, { rise: 0.22 * s, rings: 3, sides: 10 }));
  c.light([x, y + 1.9 * s, z], 260 * s, { color: FIRE, when, radius: 14 * s });
}

/** merlons along a face's top: from u0 to u1 standing on v, mw wide and mh tall, with gaps between, `t` thick */
export function merlons(f: Face, u0: number, u1: number, v: number, mw: number, mh: number, gap: number, t: number, mat: Mat) {
  const n = Math.max(1, Math.floor((u1 - u0 + gap) / (mw + gap)));
  const span = n * mw + (n - 1) * gap, s0 = u0 + (u1 - u0 - span) / 2;
  for (let i = 0; i < n; i++) {
    const a = s0 + i * (mw + gap);
    f.box(a, v, a + mw, v + mh, 0, t, mat, { skip: ['bottom'], back: true });
  }
}

/** a straight flight along local x or z (axis), drawn and walked: from (x0, z0) at y0 rising `rise` over `run` toward
 *  +axis (sign 1) or -axis, `w` wide (centred on the start point's other coordinate); solid sides down to `foot` */
export function flight(c: City, col: Collide | null, x0: number, z0: number, y0: number, run: number, rise: number, w: number, axis: 0 | 1, sign: 1 | -1, mat: Mat, o: { side?: Mat; foot?: number; steps?: number } = {}) {
  const n = o.steps ?? Math.max(2, Math.round(rise / 0.18));
  const dx = axis === 0 ? sign * run : 0, dz = axis === 1 ? sign * run : 0;
  c.b.stairs(x0, y0, z0, x0 + dx, y0 + rise, z0 + dz, w, n, mat, { side: o.side ?? mat, foot: o.foot ?? y0 });
  if (col) {
    if (axis === 0) col.stair(x0, z0 - w / 2, x0 + dx, z0 + w / 2, y0, rise, 0, sign);
    else col.stair(x0 - w / 2, z0, x0 + w / 2, z0 + dz, y0, rise, 1, sign);
  }
}

/** a plan rectangle's outline as points */
export function rectPts(x0: number, z0: number, x1: number, z1: number): V2[] {
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

/** a beam of square section `w` from a to z (any direction), its sides and ends */
export function beam(c: City, a: V3, z: V3, w: number, mat: Mat) {
  const d: V3 = [z[0] - a[0], z[1] - a[1], z[2] - a[2]];
  const L = Math.hypot(d[0], d[1], d[2]) || 1;
  const dn: V3 = [d[0] / L, d[1] / L, d[2] / L];
  const ref: V3 = Math.abs(dn[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const cr = (p: V3, q: V3): V3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const nz = (p: V3, s: number): V3 => { const l = Math.hypot(p[0], p[1], p[2]) || 1; return [(p[0] / l) * s, (p[1] / l) * s, (p[2] / l) * s]; };
  const u = nz(cr(dn, ref), w / 2), v = nz(cr(u, dn), w / 2);
  const corner = (p: V3, su: number, sv: number): V3 => [p[0] + u[0] * su + v[0] * sv, p[1] + u[1] * su + v[1] * sv, p[2] + u[2] * su + v[2] * sv];
  const ring: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (let i = 0; i < 4; i++) {
    const [s0, t0] = ring[i], [s1, t1] = ring[(i + 1) % 4];
    c.b.poly([corner(a, s0, t0), corner(z, s0, t0), corner(z, s1, t1), corner(a, s1, t1)], mat);
  }
  c.b.poly(ring.map(([s, t]) => corner(z, s, t)).reverse(), mat);
  c.b.poly(ring.map(([s, t]) => corner(a, s, t)), mat);
}
