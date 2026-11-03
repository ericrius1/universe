// The great hall at the market's heart (plan.ts HALL), the covered market of its rarest goods: an octagon of thick
// walls with a turret at every corner (each crowned with a little onion dome), the avenue through it east to west
// under two grand portals and the cross street north to south under two more, a lit window high in each diagonal face;
// its flat roof ringed by a parapet of stepped merlons, and over the middle the market's landmark, a pointed blue dome
// on a drum of lit windows, seen from the citadel and the tip. Inside: a painted ceiling round a great round opening
// into the dome (its inside glazed blue, the drum's inside cream), a ring of brass lanterns hung from the ceiling, a
// dais in the middle under them, and the stalls of the lamp-sellers, the jewellers, the cloth merchants along the
// diagonal walls. Laid in the market's frame round its middle (the hall's own colliders: walls, turrets, dais,
// counters, and its floor, roofed).
import { domePart, domeProfile, smooth, windowPart } from '../../arch/parts';
import { archCurve, pierced, segsFor, type Bay } from '../../arch/parts/arches';
import { MAT, TILE_PAL, type Mat, type V3 } from '../../arch/types';
import type { V2 } from '../../world/layout';
import type { City } from '../ctx';
import type { Rng } from '../rng';
import { GOODS, lay } from './goods';
import { grand } from './gates';
import { CLOTH, block, domeOf, gon, shaft } from './kit';
import { HALL, PAVE } from './plan';

const RI = HALL.r * Math.cos(Math.PI / 8);
/** the walls' middle line's inradius, the inner faces' */
const RM = RI - HALL.wall / 2, RN = RI - HALL.wall;
/** a turret's radius and its centre's (on the walls' middle line's corners) */
const TR = 1.5, TC = RM / Math.cos(Math.PI / 8);
/** the opening into the dome: its radius, and the dome's springing */
const RO = HALL.dome.r - 0.25, SPRING = HALL.h + HALL.dome.drum;

export function buildHall(c: City, rng: Rng) {
  const b = c.b;
  b.owner('hall', () => {
    const col = c.collide('city/market-hall');
    // the eight walls, each in its face's frame (x along it, z out from the middle)
    for (let j = 0; j < 8; j++) b.group(() => {
      const a = (j / 8) * Math.PI * 2;
      b.at(Math.cos(a) * RM, 0, Math.sin(a) * RM, Math.atan2(Math.cos(a), Math.sin(a)));
      face(c, j, col);
    });
    // the turrets at the corners
    for (let j = 0; j < 8; j++) {
      const a = ((j + 0.5) / 8) * Math.PI * 2, x = Math.cos(a) * TC, z = Math.sin(a) * TC, th = HALL.h + 2.4;
      b.with({ tint: [1.0, 0.9, 0.8] }, () => shaft(b, x, z, TR, 0, th, MAT.PLASTER));
      shaft(b, x, z, TR + 0.08, HALL.h - 0.35, HALL.h + 0.1, MAT.CREAM);
      b.slab(gon(x, z, TR + 0.08, 8, Math.PI / 8), HALL.h - 0.35, MAT.CREAM, true);
      b.slab(gon(x, z, TR + 0.08, 8, Math.PI / 8), HALL.h + 0.1, MAT.CREAM);
      b.cylinder(x, z, TR + 0.14, th, th + 0.3, 8, MAT.CREAM, { bottom: true });
      b.group(() => { b.at(x, th + 0.3, z); domeOf(b, { r: TR * 0.85, kind: 'onion', drum: 0.35, detail: 'far', seed: 40 + j, glaze: [1, 1, 1] }); });
      col.polySolid(gon(x, z, TR, 8, Math.PI / 8), 0, th);
    }
    // the roof between the parapet and the drum, the parapet (capped; merlons on it), the ceiling under it
    const oct = gon(0, 0, HALL.r, 8, Math.PI / 8);
    annular(b, oct, HALL.dome.r * 1.02, HALL.h, MAT.PLASTER, true);
    const pin = 0.6;
    const path = gon(0, 0, (RI - pin) / Math.cos(Math.PI / 8), 8, Math.PI / 8);
    b.wall(path, HALL.h, HALL.h + 0.8, 0.45, MAT.PLASTER, { closed: true, cap: MAT.CREAM, capH: 0.16, capOut: 0.06 });
    for (let j = 0; j < 8; j++) {
      const p = path[j], q = path[(j + 1) % 8], L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.floor((L - 3.2) / 1.05);
      for (let k = 0; k <= n; k++) { const f = (1.6 + (k * (L - 3.2)) / Math.max(1, n)) / L; b.place('merlon-stepped', [p[0] + (q[0] - p[0]) * f, HALL.h + 0.96, p[1] + (q[1] - p[1]) * f], { yaw: Math.atan2(-(q[1] - p[1]), q[0] - p[0]) }); }
    }
    b.with({ tint: [0.9, 0.95, 1.05] }, () => annular(b, gon(0, 0, RN / Math.cos(Math.PI / 8), 8, Math.PI / 8), RO, HALL.ceiling, MAT.LAVENDER, false));
    // the drum's inside up from the ceiling to the dome's springing, and the dome's inside, glazed
    inside(b);
    // the dome over it all, its drum's windows lit
    b.group(() => {
      b.at(0, HALL.h, 0);
      domePart(b, { r: HALL.dome.r, kind: 'pointed', rise: HALL.dome.rise, drum: HALL.dome.drum, windows: true, detail: 'near', seed: 7, glaze: [1, 1, 1], finial: null });
      // (its spire placed: the dome's own would stand past the claim's 25 m)
      const tip = HALL.dome.drum + domeProfile('pointed', HALL.dome.r, HALL.dome.rise).at(-1)![1] - HALL.dome.r * 0.01;
      b.place('finial-spire', [0, tip, 0], { scale: 3.4 });
    });
    // the floor (a kerb where the ways come in), the dais in the middle, the lanterns over it
    b.with({ tint: [0.98, 0.86, 0.74] }, () => b.slab(gon(0, 0, RI / Math.cos(Math.PI / 8), 8, Math.PI / 8), PAVE.hall, MAT.PAVING));
    b.with({ pal: TILE_PAL.FOUNTAIN }, () => b.slab(gon(0, 0, 7.2, 16), PAVE.hall + 0.02, MAT.TILE));
    b.cylinder(0, 0, 7.2, PAVE.hall, PAVE.hall + 0.02, 16, MAT.CREAM, { top: null });
    const dr = 3.4;
    b.with({ pal: TILE_PAL.HALL }, () => b.cylinder(0, 0, dr, PAVE.hall + 0.02, 0.5, 8, MAT.TILE_BORDER, { top: null }));
    b.cylinder(0, 0, dr + 0.12, 0.5, 0.62, 8, MAT.CREAM, { bottom: true });
    // (on the dais, a brass lamp-stand as tall as a man, its lamps lit)
    b.cylinder(0, 0, 0.12, 0.62, 2.6, 6, MAT.GOLD, { r1: 0.06, top: null });
    b.cylinder(0, 0, 0.7, 2.6, 2.75, 8, MAT.GOLD, { r1: 0.9, bottom: true });
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; b.place('lantern-cage', [Math.cos(a) * 0.62, 3.0, Math.sin(a) * 0.62], { scale: 0.9 }); }
    col.polySolid(gon(0, 0, dr + 0.12, 8), 0, 0.62);
    for (let k = 0; k < 8; k++) {
      const a = ((k + 0.5) / 8) * Math.PI * 2, rr = 11;
      b.place('lantern-hanging', [Math.cos(a) * rr, HALL.ceiling, Math.sin(a) * rr], { scale: 1.7 });
    }
    c.light([0, 4.5, 0], 120, { radius: 14 });
    // the stalls along the diagonal walls inside
    for (let j = 1; j < 8; j += 2) b.group(() => {
      const a = (j / 8) * Math.PI * 2;
      b.at(Math.cos(a) * RN, 0, Math.sin(a) * RN, Math.atan2(Math.cos(a), Math.sin(a)) + Math.PI);
      for (const sx of [-1, 1]) stall(c, sx * 2.6, j * 2 + (sx > 0 ? 1 : 0), rng);
      col.polySolid([[-5.2, 0], [5.2, 0], [5.2, 1.6], [-5.2, 1.6]].map(([x, z]) => frameTo(a, x, z)), 0, 1.0);
    });
    col.polyFloor(gon(0, 0, RN / Math.cos(Math.PI / 8), 8, Math.PI / 8), PAVE.hall);
  });
}

/** a local point of the inner diagonal face's frame (its middle at angle a on the inner faces, z in) in the market's */
function frameTo(a: number, x: number, z: number): V2 {
  const yaw = Math.atan2(Math.cos(a), Math.sin(a)) + Math.PI, c = Math.cos(yaw), s = Math.sin(yaw);
  return [Math.cos(a) * RN + c * x + s * z, Math.sin(a) * RN - s * x + c * z];
}

/** one of the eight walls (its face's frame: x along it, z out): the avenue's and the cross street's openings with
 *  their portals, the diagonals' high windows */
function face(c: City, j: number, col: ReturnType<City['collide']>) {
  const b = c.b, t = HALL.wall, h = HALL.h;
  // (between the turrets, which take the corners: its ends inside them)
  const L = 2 * RM * Math.tan(Math.PI / 8) - 1.2;
  const axis = j % 2 === 0, o = j % 4 === 0 ? HALL.way : HALL.cross;
  const det = 'mid', segs = segsFor(det, o.w), ys = o.h - archCurve('pointed', o.w, segs).crown;
  b.with({ tint: [1.0, 0.9, 0.8] }, () => b.group(() => {
    b.at(-L / 2, 0, 0);
    if (axis) pierced(b, L, h, t, [{ x: L / 2, span: o.w, sill: 0, spring: ys, kind: 'pointed', segs } as Bay], MAT.PLASTER, { top: null, ends: false, soffit: MAT.ASHLAR });
    else b.box(0, 0, -t / 2, L, h, t / 2, MAT.PLASTER, { skip: ['top', 'bottom', 'e', 'w'] });
  }));
  // a tiled dado inside, a teal frieze under the ceiling
  b.with({ pal: TILE_PAL.HALL }, () => {
    const zi = -t / 2 - 0.025;
    const dado = (x0: number, x1: number) => b.patch([[x0, PAVE.hall, zi], [x1, PAVE.hall, zi], [x1, 1.4, zi], [x0, 1.4, zi]], [0, 1, 2, 0, 2, 3], MAT.TILE, [0, 0, -1], [-1, 0, 0]);
    if (axis) { dado(-L / 2 + 0.6, -o.w / 2 - 0.3); dado(o.w / 2 + 0.3, L / 2 - 0.6); } else dado(-L / 2 + 0.6, L / 2 - 0.6);
  });
  b.patch([[-L / 2 + 0.6, HALL.ceiling - 0.7, -t / 2 - 0.03], [L / 2 - 0.6, HALL.ceiling - 0.7, -t / 2 - 0.03], [L / 2 - 0.6, HALL.ceiling - 0.1, -t / 2 - 0.03], [-L / 2 + 0.6, HALL.ceiling - 0.1, -t / 2 - 0.03]], [0, 1, 2, 0, 2, 3], MAT.TEAL, [0, 0, -1], [-1, 0, 0]);
  // a cream band along the outside at the roof
  block(b, -L / 2, h - 0.5, t / 2, L / 2, h - 0.1, t / 2 + 0.1, MAT.CREAM, ['n', 'e', 'w']);
  b.box(-L / 2, h - 0.5, t / 2, L / 2, h - 0.5, t / 2 + 0.1, MAT.CREAM, { skip: ['top', 'n', 's', 'e', 'w'] });
  if (axis) {
    // the portals out on the ways (and onto the hall inside: a cream archivolt's face round the arch)
    b.group(() => { b.at(0, 0, t / 2); grand(c, o.w, o.h, 'passage', det, 30 + j, false); });
    const wall = (x0: number, x1: number, y0: number) => col.solid(...(pts(j, x0, -t / 2, x1, t / 2)), y0, h);
    wall(-L / 2, -o.w / 2, 0); wall(o.w / 2, L / 2, 0); wall(-o.w / 2, o.w / 2, ys + archCurve('pointed', o.w, segs).crown);
    // (the avenue's floor's kerb across the opening, outside)
    const k = PAVE.hall;
    b.patch([[-o.w / 2, PAVE.avenue, t / 2], [o.w / 2, PAVE.avenue, t / 2], [o.w / 2, k, t / 2], [-o.w / 2, k, t / 2]], [0, 1, 2, 0, 2, 3], MAT.ASHLAR, [0, 0, 1]);
  } else {
    // two lit windows high in the face, their glass on the wall
    for (const sx of [-1, 1]) b.group(() => { b.at(sx * 2.4, 4.6, t / 2); windowPart(b, { kind: 'arched', arch: 'pointed', w: 1.5, h: 2.9, depth: 0, detail: 'mid', lit: 0.85, seed: j * 2 + sx }); });
    col.polySolid([[-L / 2, -t / 2], [L / 2, -t / 2], [L / 2, t / 2], [-L / 2, t / 2]].map(([x, z]) => faceTo(j, x, z)), 0, h, 1.2);
  }
}

/** a local point of face j's frame (its middle on the walls' middle line, z out) in the market's */
function faceTo(j: number, x: number, z: number): V2 {
  const a = (j / 8) * Math.PI * 2, yaw = Math.atan2(Math.cos(a), Math.sin(a)), c = Math.cos(yaw), s = Math.sin(yaw);
  return [Math.cos(a) * RM + c * x + s * z, Math.sin(a) * RM - s * x + c * z];
}
/** a box in an axis face's frame as a market-frame rectangle (x0, z0, x1, z1): the axis faces are square to the frame */
function pts(j: number, x0: number, z0: number, x1: number, z1: number): [number, number, number, number] {
  const p = faceTo(j, x0, z0), q = faceTo(j, x1, z1);
  return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])];
}

/** a flat ring between an outer polygon and a circle of radius r (in 32 steps) at y, facing up or down: each of the
 *  polygon's sides a fan to its arc */
function annular(b: City['b'], outer: V2[], r: number, y: number, mat: Mat, up: boolean) {
  const n = outer.length, per = Math.max(2, Math.round(32 / n));
  for (let i = 0; i < n; i++) {
    const p = outer[i], q = outer[(i + 1) % n];
    const a0 = Math.atan2(p[1], p[0]), a1 = a0 + (Math.PI * 2) / n;
    const arc: V3[] = Array.from({ length: per + 1 }, (_, k) => { const a = a0 + ((a1 - a0) * k) / per; return [Math.cos(a) * r, y, Math.sin(a) * r]; });
    const pts: V3[] = [[p[0], y, p[1]], [q[0], y, q[1]], ...arc.reverse()];
    const tris: number[] = [];
    // (the outer edge's two corners fanned to the arc: the first corner to its half, the second to the rest)
    const half = Math.floor(per / 2);
    for (let k = 0; k < half; k++) tris.push(1, 2 + k, 3 + k);
    tris.push(0, 1, 2 + half);
    for (let k = half; k < per; k++) tris.push(0, 2 + k, 3 + k);
    b.patch(pts, tris, mat, [0, up ? 1 : -1, 0]);
  }
}

/** the drum's inside (from the ceiling to the dome's springing) and the dome's, both seen from within */
function inside(b: City['b']) {
  const n = 32;
  const ring = (r: number, y: number): V3[] => Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * Math.PI * 2; return [Math.cos(a) * r, y, Math.sin(a) * r]; });
  // (turning the other way from the dome's outside: the sheets face in)
  b.with({ tint: [1.05, 0.95, 0.85] }, () => {
    const r0 = ring(RO, HALL.ceiling), r1 = ring(RO, SPRING);
    for (let i = 0; i < n; i++) b.quad(r0[i], r0[i + 1], r1[i + 1], r1[i], MAT.CREAM);
  });
  const prof = smooth(domeProfile('pointed', RO, HALL.dome.rise - 0.3), 12);
  const rows = prof.map(([r, hh]) => ring(Math.max(r, 0.02), SPRING + hh));
  b.with({ tint: [1.5, 1.42, 1.0] }, () => {
    for (let j = 0; j + 1 < rows.length; j++) for (let i = 0; i < n; i++) b.quad(rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i], MAT.DOME);
  });
}

/** a stall against an inner diagonal wall (the frame's x along it, z in from it): a counter, a canopy of cloth on two
 *  poles, its goods */
function stall(c: City, x: number, n: number, rng: Rng) {
  const b = c.b, w = 4.2, d = 1.4, y = PAVE.hall;
  const kind = GOODS[(n * 3) % GOODS.length];
  block(b, x - w / 2, y, d - 0.6, x + w / 2, 0.95, d, MAT.WOOD);
  lay(c, kind, x - w / 2 + 0.1, x + w / 2 - 0.1, d - 0.05, 0.5, 0.95, rng);
  // (a cloth hung on the wall behind it, PROUD of the dado)
  const tint = CLOTH[n % CLOTH.length];
  b.with({ tint }, () => b.patch([[x - w / 2, 1.6, 0.06], [x + w / 2, 1.6, 0.06], [x + w / 2, 3.6, 0.06], [x - w / 2, 3.6, 0.06]], [0, 1, 2, 0, 2, 3], MAT.CLOTH, [0, 0, 1]));
}
