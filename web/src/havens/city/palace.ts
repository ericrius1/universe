// The palace in the east point (ref 2), facing west down its avenue to the ring road and the citadel, its back to the
// canal (round 6, B3e: city.ts turns its frame to PALACE's yaw: here +z is its front, x along it). It stands on a
// terrace over its close (PALACE.close): before it the court, paved, with two fountain pools banded in tile, palms,
// lamps and the red pillars at its mouth, an arcaded gallery down either side (pointed arches on red columns, tiled
// spandrels, merlons along their roofs); a grand stair up to the terrace. The long hall's front runs nine bays between
// buttresses that end in pinnacles, each bay a tall lancet window with mullions and Y tracery; in the middle a
// frontispiece (a pishtaq) stands out of it and up past its parapet, a deep pointed iwan in it under a ring of cream
// and red voussoirs, tiled spandrels, a rose window over it, a cornice and merlons on top; in the iwan the gold lattice
// doors in their tiled alfiz. Round towers with bell domes stand at the corners. Behind the long hall the wings are
// crowded with chimney turrets under domed caps, two great onion domes on drums of lit windows rise over them, and the
// keep in the middle carries the open X-braced lattice spire: two flaring stages of corner posts, rings and great X's
// with a railed platform between them and a domed crown with a gold needle at PALACE.spireH. Merlons (instanced) run
// round every roof. Behind it, over the canal's head, the terrace runs on as a balustraded rear terrace with a domed
// pavilion at either corner, and a broad flight goes down from it to the landing where the canal begins (the
// canal-head port). Its tilework in turquoise and cobalt on cream: the dados of tiled panels under the lancets and
// along the terrace's front, the stairs' cheeks and risers tiled, the court's pools banded with interlaced stars.
import type { Mat, V3 } from '../arch/types';
import { MAT, TILE_PAL } from '../arch/types';
import { arcade, archCurve, archivolt, domePart, moulding, pierced } from '../arch/parts';
import { FLOOR_Y, PALACE, type V2 } from '../world/layout';
import type { City, Collide } from './ctx';
import { Face, type Opening, relief } from './facade';
import { lampPost, pool } from './ground';
import { pillar } from './plaza';
import { beam, brazier, dome, flight, lanternBody, planter, rectPts, turret } from './props';
import { pavilion } from './rim';
import { dado, revealDado, surround, tilePanel } from './tiles';
import { PAVE, balustradeRun, lampAt } from './water';

const PAL = TILE_PAL.PALACE;

const HW = PALACE.width / 2, HD = PALACE.depth / 2;
/** the terrace, the long hall's depth and height, the keep's top, the wings' */
const P = 3.2, HALL_D = 27, HALL_H = P + 19, KEEP = PALACE.height, WH = P + 13.5;
const WARM: V3 = [1.05, 0.96, 0.92];
/** the close (PALACE.close, in this frame) */
const CLOSE = PALACE.close;
/** the terrace's front edge, its back edge over the canal (the rear terrace), the rear flight's width */
const FRONT = HD + 4, REAR = { z: -52, stair: 20 };
/** the frontispiece round the portal: its half-width, how far it stands out of the long hall's face, its height over
 *  the terrace; the iwan's span and its crown */
const PISHTAQ = { hw: 5.9, out: 1.6, h: HALL_H - P + 6, span: 7.0, crown: 14 };
/** the court's galleries: their arcades' bays, span, spring; the gallery's depth behind its arcade */
const GALLERY = { bays: 8, span: 3.0, spring: 3.6, depth: 3.6 };
/** the merlons on the palace's roofs (instanced: parts/protos.ts), their size over the prototype's */
const MERLON = { kind: 'merlon-stepped', scale: 1.3, every: 1.25 };

export function buildPalace(c: City) {
  const b = c.b;
  b.group(() => {
    b.at(PALACE.x, FLOOR_Y, PALACE.z);
    const col = c.collide('city/palace');
    court(c, col);
    galleries(c, col);
    terrace(c, col);
    rearTerrace(c, col);
    b.with({ tint: WARM }, () => {
      longHall(c, col);
      pishtaq(c, col);
      keepAndWings(c, col);
    });
    for (const [x, z, r] of [[-HW - 1, HD, 6.5], [HW + 1, HD, 6.5], [-HW - 1, -HD, 5.2], [HW + 1, -HD, 5.2]]) cornerTower(c, col, x, z, r);
    spire(c, col, 0, -4, KEEP);
  });
}

/** merlons (instanced) standing on y along a line from a to z (this frame), every MERLON.every, clear of `skip` */
function merlonRun(c: City, a: V2, z: V2, y: number, skip: (p: V2) => boolean = () => false) {
  const dx = z[0] - a[0], dz = z[1] - a[1], L = Math.hypot(dx, dz), n = Math.max(1, Math.floor(L / MERLON.every));
  const yaw = Math.atan2(-dz, dx);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, p: V2 = [a[0] + dx * t, a[1] + dz * t];
    if (!skip(p)) c.b.place(MERLON.kind, [p[0], y, p[1]], { yaw, scale: MERLON.scale });
  }
}
/** clear of the corner towers (their crowns stand over the roofs' corners) */
const clearOfTowers = (p: V2) => [[-HW - 1, HD], [HW + 1, HD], [-HW - 1, -HD], [HW + 1, -HD]].some(([x, z]) => Math.hypot(p[0] - x, p[1] - z) < 7.5);

/** the court between the palace and the avenue: paving, two fountain pools, palms, lamps, the red pillars at its mouth */
function court(c: City, col: Collide) {
  const b = c.b, x0 = CLOSE.x0, x1 = CLOSE.x1, z0 = FRONT, z1 = CLOSE.z1;
  b.with({ tint: [1.08, 1.02, 0.95] }, () => b.slab(rectPts(x0, z0, x1, z1), PAVE, MAT.PAVING));
  b.with({ tint: [0.92, 0.62, 0.5] }, () => b.slab(rectPts(-16, HD + 15, 16, z1), PAVE + 0.04, MAT.PAVING));
  col.floor(x0, z0, x1, z1, PAVE);
  for (const s of [-1, 1]) {
    pool(c, col, s * 30, HD + 26, 7, 4.5, 0.55, { pal: PAL, y: PAVE });
    for (const dx of [-14, 14]) { planter(c, s * 30 + dx, HD + 26, 1.3, 0.7, 'palms', PAVE); col.solid(s * 30 + dx - 1.3, HD + 24.7, s * 30 + dx + 1.3, HD + 27.3, 0, 0.8); }
    for (const x of [22, 38]) lampPost(c, col, s * x, HD + 16, 4.2, PAVE);
    pillar(c, col, s * 17, z1 - 4, 12, PAVE, 0.85);
  }
}

/** an arcaded gallery down either side of the court: the arcade (pointed arches on red columns, tiled spandrels) on its
 *  court side, a wall behind, a roof between them with merlons along its back, lanterns hung in it (instanced) */
function galleries(c: City, col: Collide) {
  const b = c.b, G = GALLERY, zc = (FRONT + CLOSE.z1) / 2 + 1;
  for (const s of [-1, 1] as const) {
    // (the arcade's line a gallery's depth in from the close's side; its frame turned so its length runs along z)
    const xa = s < 0 ? CLOSE.x0 + G.depth + 0.6 : CLOSE.x1 - G.depth - 0.6, xw = s < 0 ? CLOSE.x0 + 0.6 : CLOSE.x1 - 0.6;
    let laid = { top: 0, walk: { solids: [] as number[][], floors: [] as number[][], stairs: [] as number[][] } };
    b.group(() => {
      b.at(xa, PAVE, zc, -Math.PI / 2);
      const l = arcade(b, { kind: 'pointed', bays: G.bays, span: G.span, spring: G.spring, detail: 'mid', pal: PAL, columns: { order: 'round', h: G.spring, r: 0.24 }, mat: MAT.PLASTER_WARM, seed: s + 5 });
      laid = { top: l.top, walk: l.walk! };
    });
    // the arcade's length and wall thickness, as arcade() makes them (its columns' abaci 1.5 r either side)
    const pw = 0.24 * 1.5 * 2, len = G.bays * G.span + (G.bays + 1) * pw, t = pw - 0.08, za = zc - len / 2, zb = zc + len / 2;
    const h = laid.top - 0.2, yr = h + 0.15;
    const xi = xa + s * t / 2, xo = xw + s * 0.3, xn = xw - s * 0.3;
    // the wall behind (its top under the roof), the roof (its top under the arcade's coping's, its underside the
    // gallery's ceiling), merlons along its back
    b.box(Math.min(xn, xo), 0, za, Math.max(xn, xo), PAVE + h, zb, MAT.PLASTER_WARM, { skip: ['bottom', 'top'] });
    b.box(Math.min(xi, xo), PAVE + h, za, Math.max(xi, xo), PAVE + yr, zb, MAT.PLASTER_WARM, { top: MAT.CREAM, skip: ['bottom', s < 0 ? 'e' : 'w'] });
    // (the ceiling from under the arcade's coping's overhang, its underside the coping's own)
    b.slab(rectPts(Math.min(xi + s * 0.1, xn), za, Math.max(xi + s * 0.1, xn), zb), PAVE + h, MAT.CREAM, true);
    merlonRun(c, [xw, za + 0.4], [xw, zb - 0.4], PAVE + yr);
    for (let k = 0; k < G.bays; k++) b.place('lantern-hanging', [(xi + xo) / 2, PAVE + h, za + pw + G.span / 2 + k * (G.span + pw)]);
    col.solid(Math.min(xn, xo), za, Math.max(xn, xo), zb, 0, PAVE + yr);
    for (let j = 0; j <= G.bays; j++) { const z = za + pw / 2 + j * (G.span + pw); col.solid(xa - pw / 2, z - pw / 2, xa + pw / 2, z + pw / 2, 0, PAVE + h); }
  }
}

/** the terrace under the whole palace (on out behind it as the rear terrace) and the grand stair from the court */
function terrace(c: City, col: Collide) {
  const b = c.b, x0 = -HW - 2, x1 = HW + 2, z0 = REAR.z, z1 = FRONT;
  b.box(x0, -2, z0, x1, P, z1, MAT.ASHLAR, { top: MAT.PAVING, skip: ['bottom'] });
  b.box(x0 - 0.15, P - 0.35, z0 - 0.15, x1 + 0.15, P, z1 + 0.15, MAT.CREAM, { skip: ['bottom', 'top'] });
  // a balustrade along the terrace's front, open where the stair arrives
  for (const [u0, u1] of [[x0, -15], [15, x1]]) {
    b.box(u0, P, z1 - 0.5, u1, P + 1.0, z1, MAT.CREAM, { skip: ['bottom'] });
    col.solid(u0, z1 - 0.5, u1, z1, P, P + 1.0);
  }
  col.solid(x0, z0, x1, z1, -2, P).floor(x0, z0, x1, z1, P);
  const sw = 28, run = 11;
  b.with({ pal: PAL }, () => flight(c, col, 0, z1 + run, PAVE, run, P - PAVE, sw, 1, -1, MAT.CREAM, { side: MAT.ASHLAR, steps: 18, foot: 0, riser: MAT.TILE_BORDER }));
  for (const s of [-1, 1]) {
    const x = s * (sw / 2 + 0.9);
    b.box(x - 0.9, 0, z1, x + 0.9, P + 0.8, z1 + run, MAT.ASHLAR, { top: MAT.CREAM, skip: ['bottom'] });
    col.solid(x - 0.9, z1, x + 0.9, z1 + run, 0, P + 0.8);
    brazier(c, x, P + 0.8, z1 + 0.9, 1.2);
    brazier(c, x, 0.9, z1 + run - 0.9, 0.9);
    // tiled panels on the cheek's outer side and its end
    const xo = x + s * 0.9;
    const side = s > 0 ? new Face(b, [xo, z1 + run], [xo, z1], 0, P + 0.8) : new Face(b, [xo, z1], [xo, z1 + run], 0, P + 0.8);
    dado(c, side, 0.35, side.len - 0.35, PAVE + 0.25, P + 0.45, { pal: PAL, every: 3.6, bw: 0.22 });
    const end = new Face(b, [x - 0.9, z1 + run], [x + 0.9, z1 + run], 0, 0.9);
    tilePanel(c, end, 0.18, PAVE + 0.12, end.len - 0.18, 0.86, { pal: PAL, bw: 0.14 });
  }
  // the terrace's front either side of the stair: a dado of tiled panels under its cream band
  for (const s of [-1, 1]) {
    const xa = s * (sw / 2 + 1.8 + 0.4), xb = s * (x1 - 0.4);
    const f = s > 0 ? new Face(b, [xa, z1], [xb, z1], 0, P) : new Face(b, [xb, z1], [xa, z1], 0, P);
    dado(c, f, 0, f.len, PAVE + 0.2, P - 0.5, { pal: PAL, every: 5.2, bw: 0.24, band: 0.4 });
  }
}

/** the rear terrace over the canal's head (the terrace's back, from the wings to REAR.z): its balustrades, a domed
 *  pavilion at either corner, cypress; the broad flight down from it between braziered cheeks to the landing at the
 *  canal's head (paved to the close's back edge: the canal-head port), cypress and lamps on the landing */
function rearTerrace(c: City, col: Collide) {
  const b = c.b, hw = REAR.stair / 2, run = 18 * 0.34, zb = REAR.z - run, xe = HW + 1.7, ze = CLOSE.z0;
  // the landing: paved from the close's back edge to the terrace's wall, round the flight and its cheeks
  const ch = hw + 1.8;
  b.with({ tint: [1.06, 0.95, 0.84] }, () => b.slab([[-xe, ze], [xe, ze], [xe, REAR.z], [ch, REAR.z], [ch, zb], [-ch, zb], [-ch, REAR.z], [-xe, REAR.z]], PAVE, MAT.PAVING));
  col.floor(-xe, ze, xe, zb, PAVE).floor(-xe, zb, -ch, REAR.z, PAVE).floor(ch, zb, xe, REAR.z, PAVE);
  // the flight up to the terrace, its cheeks with braziers
  b.with({ pal: PAL }, () => flight(c, col, 0, zb, PAVE, run, P - PAVE, REAR.stair, 1, 1, MAT.CREAM, { side: MAT.ASHLAR, steps: 18, foot: 0, riser: MAT.TILE_BORDER }));
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.9);
    b.box(x - 0.9, 0, zb, x + 0.9, P + 0.8, REAR.z, MAT.ASHLAR, { top: MAT.CREAM, skip: ['bottom', 's'] });
    col.solid(x - 0.9, zb, x + 0.9, REAR.z, 0, P + 0.8);
    brazier(c, x, P + 0.8, REAR.z - 0.9, 1.2);
    brazier(c, x, 0.9, zb + 0.9, 0.9);
  }
  // the balustrades along the terrace's back and down its sides to the corner towers
  const zr = REAR.z + 0.35, xr = HW + 2 - 0.35;
  for (const s of [-1, 1]) {
    balustradeRun(c, [s * (hw + 1.9), zr], [s * xr, zr], P, { seed: 21 + s });
    balustradeRun(c, [s * xr, zr + 0.4], [s * xr, -HD - 6.3], P, { seed: 23 + s });
    col.solid(Math.min(s * (hw + 1.9), s * xr), zr - 0.2, Math.max(s * (hw + 1.9), s * xr), zr + 0.2, P, P + 0.94).solid(s * xr - 0.2, zr, s * xr + 0.2, -HD - 6.3, P, P + 0.94);
    // a pavilion at the corner, cypress along the balustrade, lamps by the flight's head
    b.group(() => { b.at(s * 33, 0, REAR.z + 6.2); pavilion(c, col, P, 2.1, 3.2, 31 + s); });
    for (const x of [16, 24, 42]) { planter(c, s * x, REAR.z + 2.2, 0.9, 0.6, 'cypress', P); col.solid(s * x - 0.9, REAR.z + 1.3, s * x + 0.9, REAR.z + 3.1, P, P + 0.72); }
    lampAt(b, s * (hw + 3.2), P, REAR.z + 1.4, 1.2);
    // and on the landing: cypress either side, lamps at the canal's head
    for (const x of [22, 34]) { planter(c, s * x, (ze + zb) / 2 - 1, 1.0, 0.6, 'cypress', PAVE); col.solid(s * x - 1, (ze + zb) / 2 - 2, s * x + 1, (ze + zb) / 2, 0, 0.72); }
    lampAt(b, s * 13.5, PAVE, ze + 2, 1.3);
  }
}

/** the long hall: nine bays of lancets between buttresses with pinnacles (the middle one in the pishtaq), the portal in
 *  the middle */
function longHall(c: City, col: Collide) {
  const b = c.b, z0 = HD - HALL_D, z1 = HD, pu0 = HW - PISHTAQ.hw, pu1 = HW + PISHTAQ.hw;
  b.box(-HW, P, z0, HW, HALL_H, z1, MAT.PLASTER_WARM, { skip: ['bottom', 's', 'e', 'w'] });
  const f = new Face(b, [-HW, z1], [HW, z1], P, HALL_H - P);
  const bays = 9, bw = (2 * HW) / bays, ops: Opening[] = [];
  const lancets: [number, number, number][] = [];
  for (let k = 0; k < bays; k++) {
    const u = bw * (k + 0.5);
    if (k === (bays - 1) / 2) {
      // (its threshold PROUD of the terrace's paving: the reveal's sill on it fought it)
      ops.push({ u0: u - 3.0, u1: u + 3.0, v0: 0.02, top: 11.5, arch: 'pointed', depth: 1.4, fill: MAT.LATTICE, pal: PAL, frame: MAT.CREAM, frameW: 0.5 });
      continue;
    }
    ops.push({ u0: u - 2.3, u1: u + 2.3, v0: 2.6, top: 16.2, arch: 'pointed', depth: 0.8, fill: MAT.WINDOW, glow: 0.85, frame: MAT.CREAM, frameW: 0.3 });
    lancets.push([u, 2.6, 16.2]);
  }
  f.wall(MAT.PLASTER_WARM, ops);
  // the portal's tilework: an alfiz round it (inside the iwan), its reveals tiled; and a dado of tiled panels in each of
  // the other bays under its lancet's sill
  const gate = ops.find((o) => o.fill === MAT.LATTICE)!;
  surround(c, f, gate, 0.18, 0.25, { pal: PAL, bw: 0.2 });
  revealDado(c, f, gate, 2.6, PAL);
  for (const [u] of lancets) dado(c, f, u - bw / 2 + 0.95, u + bw / 2 - 0.95, 0.15, 2.32, { pal: PAL, every: 4.1, bw: 0.22, band: 0.34 });
  // tracery: two mullions up to the spring, a Y in the head
  for (const [u, v0, top] of lancets) {
    const spring = top - 4.6 * 0.8 * Math.sin(Math.acos((2.3 - 3.68) / 3.68));
    for (const du of [-0.77, 0.77]) relief(c, f, u + du, v0, u + du, spring, 0.18, 0.68, MAT.CREAM);
    relief(c, f, u - 0.77, spring, u, top - 1.2, 0.16, 0.68, MAT.CREAM);
    relief(c, f, u + 0.77, spring, u, top - 1.2, 0.16, 0.68, MAT.CREAM);
    relief(c, f, u - 2.3, v0 + (spring - v0) * 0.55, u + 2.3, v0 + (spring - v0) * 0.55, 0.18, 0.68, MAT.CREAM);
  }
  // buttresses with pinnacles (not inside the pishtaq), the cornice and the parapet either side of it, merlons on it
  for (let k = 0; k <= bays; k++) {
    const u = bw * k;
    if (u > pu0 - 1 && u < pu1 + 1) continue;
    f.box(u - 0.8, 0, u + 0.8, HALL_H - P - 0.6, -1.2, 0, MAT.PLASTER_WARM, { top: MAT.CREAM, skip: ['bottom'] });
    const p = f.at(u, HALL_H - P, -0.6);
    b.box(p[0] - 0.55, p[1] - 0.6, p[2] - 0.55, p[0] + 0.55, p[1] + 2.4, p[2] + 0.55, MAT.CREAM, { skip: ['bottom'] });
    b.cylinder(p[0], p[2], 0.78, p[1] + 2.4, p[1] + 5.2, 4, MAT.CREAM, { r1: 0.05 });
  }
  const fp = new Face(b, [-HW, z1], [HW, z1], HALL_H, 1.6);
  for (const [u0, u1] of [[-0.3, pu0], [pu1, f.len + 0.3]]) f.box(u0, HALL_H - P - 0.9, u1, HALL_H - P, -0.55, 0, MAT.CREAM, { skip: ['left', 'right'] });
  for (const [u0, u1] of [[0, pu0], [pu1, fp.len]]) {
    fp.box(u0, 0, u1, 0.8, 0, 0.45, MAT.PLASTER_WARM, { back: true, top: MAT.CREAM, skip: ['bottom', 'left', 'right'] });
    const a = fp.at(u0 + 0.5, 0.8, 0.225), z = fp.at(u1 - 0.5, 0.8, 0.225);
    merlonRun(c, [a[0], a[2]], [z[0], z[2]], HALL_H + 0.8, clearOfTowers);
  }
  // the long hall's ends (west onto the plaza's way, east), with lancets; merlons round its roof's back and ends
  for (const s of [-1, 1] as const) {
    const fe = s > 0 ? new Face(b, [HW, z1], [HW, z0], P, HALL_H - P) : new Face(b, [-HW, z0], [-HW, z1], P, HALL_H - P);
    const e: Opening[] = [];
    for (const u of [fe.len * 0.25, fe.len * 0.5, fe.len * 0.75]) e.push({ u0: u - 1.8, u1: u + 1.8, v0: 3, top: 14.5, arch: 'pointed', depth: 0.7, fill: MAT.WINDOW, glow: 0.8, frame: MAT.CREAM, frameW: 0.3 });
    fe.wall(MAT.PLASTER_WARM, e);
    merlonRun(c, [s * (HW - 0.3), z0 + 0.4], [s * (HW - 0.3), z1 - 0.8], HALL_H, clearOfTowers);
  }
  merlonRun(c, [-HW + 0.4, z0 + 0.3], [HW - 0.4, z0 + 0.3], HALL_H, (p) => clearOfTowers(p) || Math.abs(p[0]) < 15.8);
  col.solid(-HW, z0, HW, z1, P, HALL_H).floor(-HW, z0, HW, z1, HALL_H).solid(-HW, z1 - 0.45, HW, z1, HALL_H, HALL_H + 1.4);
}

/** the pishtaq round the portal: a wall standing out of the long hall's face and up past its parapet, a deep pointed
 *  iwan through it (the portal in its back), a ring of cream and red voussoirs round its arch, tiled spandrels, a tile
 *  band over them and under its cornice, a rose window between, wall lanterns either side; a cornice round its top
 *  (capping it) with merlons on it */
function pishtaq(c: City, col: Collide) {
  const b = c.b, { hw, out: t, h, span } = PISHTAQ, len = 2 * hw, segs = 18;
  const curve = archCurve('pointed', span, segs), spring = PISHTAQ.crown - curve.crown;
  b.group(() => {
    b.at(-hw, P, HD + t / 2);
    // (a shade paler than the hall it stands out of)
    let zone = 0;
    b.with({ pal: PAL, tint: [1.14, 1.06, 1.0] }, () => { zone = pierced(b, len, h, t, [{ x: hw, span, sill: 0, spring, kind: 'pointed', segs }], MAT.PLASTER_WARM, { back: false, top: null, spandrel: MAT.TILE, segs }).zone; });
    // its back over the long hall's roof
    b.quad([len, HALL_H - P, -t / 2], [0, HALL_H - P, -t / 2], [0, h, -t / 2], [len, h, -t / 2], MAT.PLASTER_WARM);
    // the voussoirs, the tile bands, the rose window, the lanterns
    archivolt(b, curve, archCurve('pointed', span, segs, 0.5), hw, spring, t / 2, t / 2 + 0.06, MAT.CREAM, MAT.RED);
    const band = (v0: number, v1: number) => b.with({ pal: PAL }, () => b.panel([[0.3, v0, t / 2], [len - 0.3, v0, t / 2], [len - 0.3, v1, t / 2], [0.3, v1, t / 2]], MAT.TILE_BAND));
    band(zone + 0.3, zone + 1.0);
    band(h - 2.3, h - 1.6);
    // a tiled border up either side of the arch to the band over it
    for (const [x0, x1] of [[0.3, 0.8], [len - 0.8, len - 0.3]]) b.with({ pal: PAL }, () => b.panel([[x0, 0.3, t / 2], [x1, 0.3, t / 2], [x1, zone + 0.3, t / 2], [x0, zone + 0.3, t / 2]], MAT.TILE_BORDER));
    const rv = (zone + 1.0 + h - 2.3) / 2;
    const disc = (r: number, by: number, m: Mat, glow = 0) => b.with({ glow }, () => {
      const pts: V3[] = [];
      for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; pts.push([hw + Math.cos(a) * r, rv + Math.sin(a) * r, t / 2 + by]); }
      b.panel(pts, m);
    });
    disc(2.4, 0, MAT.CREAM);
    disc(2.0, 0.02, MAT.LAVENDER, 0.8);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI, ca = Math.cos(a) * 1.95, sa = Math.sin(a) * 1.95, nx = -Math.sin(a) * 0.08, ny = Math.cos(a) * 0.08;
      b.panel([[hw - ca - nx, rv - sa - ny, t / 2 + 0.04], [hw + ca - nx, rv + sa - ny, t / 2 + 0.04], [hw + ca + nx, rv + sa + ny, t / 2 + 0.04], [hw - ca + nx, rv - sa + ny, t / 2 + 0.04]], MAT.GOLD);
    }
    for (const x of [0.9, len - 0.9]) b.place('lantern-wall', [x, 4.2, t / 2]);
    // the cornice round its top, capping it; merlons along it
    const top = moulding(b, [[0, t / 2], [len, t / 2], [len, -t / 2], [0, -t / 2]], { profile: 'cornice', size: 0.7, y: h - 0.7, closed: true, back: t / 2 }).top;
    for (let i = 0; i < 9; i++) b.place(MERLON.kind, [0.75 + (i * (len - 1.5)) / 8, top, 0], { scale: MERLON.scale });
  });
  col.solid(-hw, HD, -span / 2, HD + t, P, P + h).solid(span / 2, HD, hw, HD + t, P, P + h).solid(-hw, HD, hw, HD + t, P + PISHTAQ.crown, P + h);
}

/** the keep in the middle (the spire's base) and the wings round it, crowded with chimney turrets, two onion domes on
 *  drums of lit windows over the side wings; merlons round the roofs */
function keepAndWings(c: City, col: Collide) {
  const b = c.b, zf = HD - HALL_D;
  // wings
  const wings: [number, number, number, number][] = [[-HW, -HD, -15, zf], [15, -HD, HW, zf], [-15, -HD, 15, -18]];
  // (the cream band round their tops along the outline that shows, once: a band to each wing overlapped where they
  // meet)
  b.band([[HW, zf], [HW, -HD], [-HW, -HD], [-HW, zf]], WH - 0.5, WH, MAT.CREAM, { out: 0.25 });
  for (const [x0, z0, x1, z1] of wings) {
    b.box(x0, P, z0, x1, WH, z1, MAT.PLASTER_WARM, { skip: ['bottom'] });
    // two rows of windows on the faces that show
    const faces: [V2, V2][] = [[[x1, z0], [x0, z0]], [[x0, z0], [x0, z1]], [[x1, z1], [x1, z0]]];
    for (const [l, r] of faces) {
      const f = new Face(b, l, r, P, WH - P);
      if (f.len < 4) continue;
      const n = Math.floor(f.len / 4.2);
      for (let k = 0; k < n; k++) {
        const u = (f.len * (k + 0.5)) / n;
        for (const v of [2.0, 7.4]) b.with({ glow: (k + v) % 3 ? 0.75 : 0 }, () => f.rect(u - 0.8, v, u + 0.8, v + 3.0, -0.015, MAT.WINDOW));
      }
    }
    col.solid(x0, z0, x1, z1, P, WH).floor(x0, z0, x1, z1, WH);
  }
  // merlons along the wings' back and their outer sides
  merlonRun(c, [-HW + 0.3, -HD + 0.3], [HW - 0.3, -HD + 0.3], WH, clearOfTowers);
  for (const s of [-1, 1]) merlonRun(c, [s * (HW - 0.3), -HD + 0.6], [s * (HW - 0.3), zf - 0.3], WH, clearOfTowers);
  // the keep
  const kx = 15, kz0 = -18, kz1 = zf + 0.5;
  // (its roof is the cream band's top: the walls' own top at the same height fought it)
  b.box(-kx, P, kz0, kx, KEEP, kz1, MAT.PLASTER_WARM, { skip: ['bottom', 'top'] });
  b.box(-kx - 0.5, KEEP - 1.0, kz0 - 0.5, kx + 0.5, KEEP, kz1 + 0.5, MAT.CREAM);
  for (const [l, r] of [[[-kx, kz1], [kx, kz1]], [[kx, kz0], [-kx, kz0]], [[kx, kz1], [kx, kz0]], [[-kx, kz0], [-kx, kz1]]] as [V2, V2][]) {
    const f = new Face(b, l, r, P, KEEP - P);
    for (const u of [f.len * 0.2, f.len * 0.4, f.len * 0.6, f.len * 0.8]) b.with({ glow: 0.8 }, () => f.rect(u - 1.0, WH - P + 2.5, u + 1.0, KEEP - P - 3.0, -0.015, MAT.WINDOW));
  }
  for (const [a, z] of [[[-kx, kz0], [kx, kz0]], [[-kx, kz1], [kx, kz1]], [[-kx, kz0 + 0.4], [-kx, kz1 - 0.4]], [[kx, kz0 + 0.4], [kx, kz1 - 0.4]]] as [V2, V2][]) merlonRun(c, a, z, KEEP);
  col.solid(-kx, kz0, kx, kz1, P, KEEP).floor(-kx, kz0, kx, kz1, KEEP);
  // chimney turrets with domed caps over the wings and the hall
  const ts: [number, number, number][] = [[-38, -28, 21], [-24, -10, 17], [-38, 2, 19], [38, -28, 21], [24, -10, 17], [38, 2, 19], [-8, -30, 15], [8, -30, 15], [-30, HD - 6, 14], [30, HD - 6, 14]];
  for (const [x, z, h] of ts) {
    const y0 = z > zf ? HALL_H : WH, hw = h > 18 ? 1.9 : 1.6;
    turret(c, x, z, y0, hw, h, MAT.PLASTER_WARM, { capMat: MAT.PLASTER_WARM, glaze: WARM });
    col.solid(x - hw, z - hw, x + hw, z + hw, y0, y0 + h + hw);
  }
  // the onion domes on their drums over the side wings, on eight-sided bases, lotus finials
  for (const s of [-1, 1]) {
    b.group(() => { b.at(s * 29, WH, -20.5); domePart(b, { kind: 'onion', r: 5.0, drum: 2.8, windows: true, base: 'octagon', finial: 'lotus', glaze: [1, 1, 1], seed: 40 + s }); });
    col.solid(s * 29 - 5.8, -26.3, s * 29 + 5.8, -14.7, WH, WH + 12);
  }
}

/** a round corner tower with a bell dome */
function cornerTower(c: City, col: Collide, x: number, z: number, r: number) {
  const b = c.b, h = r > 6 ? 30 : 26;
  b.with({ tint: WARM }, () => {
    b.cylinder(x, z, r + 0.5, -2, P + 0.4, 16, MAT.ASHLAR, { r1: r, top: null });
    b.cylinder(x, z, r, P + 0.4, h, 16, MAT.PLASTER_WARM, { top: null });
  });
  for (const y of [P + 0.4, HALL_H - 0.8, h - 1.2]) b.cylinder(x, z, r + 0.14, y, y + 0.4, 16, MAT.CREAM);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    b.group(() => {
      b.at(x + Math.cos(a) * (r + 0.02), 0, z + Math.sin(a) * (r + 0.02), -a + Math.PI / 2);
      const f = new Face(b, [-0.7, 0], [0.7, 0], 0, h);
      for (const v of [8, 15, 22]) if (v + 3.4 < h - 1.5) b.with({ glow: (k + v) % 2 ? 0.8 : 0 }, () => f.rect(0.1, v, 1.3, v + 3.2, -0.02, MAT.WINDOW));
    });
  }
  b.cylinder(x, z, r + 0.6, h, h + 0.7, 16, MAT.CREAM);
  dome(c, x, h + 0.7, z, r * 0.92, { drum: r * 0.35, bulge: 1.15, tip: 0.65, rise: r * 1.25, finial: true });
  col.solid(x - r * 0.9, z - r * 0.9, x + r * 0.9, z + r * 0.9, -2, h + 0.7).floor(x - r, z - r, x + r, z + r, h + 0.7);
}

/** the open lattice spire on the keep's roof: two stages of corner posts, rings and X braces (the lower flaring out,
 *  the upper tapering), a railed platform between them with lanterns at its corners, a domed crown and a gold needle */
function spire(c: City, col: Collide, x: number, z: number, y0: number) {
  const b = c.b;
  const tip = PALACE.spireH;
  const stage = (ya: number, yb: number, ha: number, hb: number, tiers: number, post: number, brace: number) => {
    const corner = (y: number, sx: number, sz: number): V3 => {
      const t = (y - ya) / (yb - ya), h = ha + (hb - ha) * t;
      return [x + sx * h, y, z + sz * h];
    };
    const cs: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sz] of cs) beam(c, corner(ya, sx, sz), corner(yb, sx, sz), post, MAT.CREAM);
    for (let k = 0; k <= tiers; k++) {
      const y = ya + ((yb - ya) * k) / tiers;
      for (let i = 0; i < 4; i++) {
        const [ax, az] = cs[i], [bx, bz] = cs[(i + 1) % 4];
        beam(c, corner(y, ax, az), corner(y, bx, bz), k === 0 || k === tiers ? post * 0.9 : brace, MAT.ASHLAR);
        if (k < tiers) {
          const y1 = ya + ((yb - ya) * (k + 1)) / tiers;
          beam(c, corner(y, ax, az), corner(y1, bx, bz), brace, MAT.CREAM);
          beam(c, corner(y, bx, bz), corner(y1, ax, az), brace, MAT.CREAM);
        }
      }
    }
  };
  // its footing on the keep
  b.box(x - 9, y0, z - 9, x + 9, y0 + 1.2, z + 9, MAT.CREAM);
  const pl = y0 + 1.2 + 34;
  stage(y0 + 1.2, pl, 7.2, 10.4, 2, 1.3, 0.8);
  // the platform with its rail and corner lanterns
  const ph = 11.6;
  b.box(x - ph, pl, z - ph, x + ph, pl + 0.9, z + ph, MAT.CREAM);
  for (const [l, r] of [[[x - ph, z + ph], [x + ph, z + ph]], [[x + ph, z - ph], [x - ph, z - ph]], [[x + ph, z + ph], [x + ph, z - ph]], [[x - ph, z - ph], [x - ph, z + ph]]] as [V2, V2][]) {
    const f = new Face(b, l, r, pl + 0.9, 1.2);
    f.box(0, 0, f.len, 0.25, 0, 0.3, MAT.GOLD, { back: true });
    f.box(0, 0.95, f.len, 1.15, 0, 0.3, MAT.CREAM, { back: true });
    for (let u = 1.2; u < f.len - 0.6; u += 1.6) f.box(u - 0.08, 0.25, u + 0.08, 0.95, 0.07, 0.23, MAT.CREAM, { back: true, skip: ['top', 'bottom'] });
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const p: V3 = [x + sx * (ph - 0.6), pl + 0.9, z + sz * (ph - 0.6)];
    b.box(p[0] - 0.5, p[1], p[2] - 0.5, p[0] + 0.5, p[1] + 2.2, p[2] + 0.5, MAT.CREAM, { skip: ['bottom'] });
    b.cylinder(p[0], p[2], 0.7, p[1] + 2.2, p[1] + 4.0, 4, MAT.GOLD, { r1: 0.05 });
    lanternBody(c, [p[0], p[1] + 1.4, p[2] + sz * 0.7], 0.3);
    c.light([p[0] + sx * 0.8, p[1] + 1.4, p[2] + sz * 0.8], 400, { radius: 22 });
  }
  col.floor(x - ph, z - ph, x + ph, z + ph, pl + 0.9).solid(x - ph, z - ph, x + ph, z - ph + 0.3, pl + 0.9, pl + 2.05)
    .solid(x - ph, z + ph - 0.3, x + ph, z + ph, pl + 0.9, pl + 2.05).solid(x - ph, z - ph, x - ph + 0.3, z + ph, pl + 0.9, pl + 2.05).solid(x + ph - 0.3, z - ph, x + ph, z + ph, pl + 0.9, pl + 2.05);
  // the upper stage, the crown, the needle
  const top = pl + 0.9 + 17;
  stage(pl + 0.9, top, 5.8, 3.6, 2, 0.9, 0.55);
  b.box(x - 4.2, top, z - 4.2, x + 4.2, top + 0.6, z + 4.2, MAT.CREAM);
  b.cylinder(x, z, 2.6, top + 0.6, top + 2.4, 8, MAT.CREAM, { top: null });
  dome(c, x, top + 2.4, z, 2.9, { drum: 0, bulge: 1.12, tip: 0.6, rise: 3.6, finial: false });
  const n0 = top + 2.4 + 3.9;
  b.cylinder(x, z, 0.32, n0, tip - 1.4, 8, MAT.GOLD, { r1: 0.12 });
  b.dome(x, tip - 1.6, z, 0.45, MAT.GOLD, { rise: 1.6, tip: 1, rings: 5, sides: 8 });
  col.solid(x - 3, z - 3, x + 3, z + 3, top, tip);
}
