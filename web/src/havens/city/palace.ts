// The palace east of the plaza (ref 2), its long front facing south across its court onto the east boulevard. It
// stands on a terrace reached by a grand stair. The long hall's front runs nine bays between buttresses that end in
// pinnacles, each bay a tall lancet window with mullions and Y tracery, the middle bay a pointed portal under a rose
// window. Round towers with bell domes stand at the corners. Behind the long hall the wings are crowded with tall
// chimney turrets under domed caps, and the keep in the middle carries the open X-braced lattice spire: two flaring
// stages of corner posts, rings and great X's with a railed platform between them and a domed crown with a gold needle
// at PALACE.spireH.
import type { Mat, V3 } from '../arch/types';
import { MAT } from '../arch/types';
import { FLOOR_Y, PALACE, type V2 } from '../world/layout';
import type { City, Collide } from './ctx';
import { Face, type Opening, relief } from './facade';
import { FLOOR, lampPost, pool } from './ground';
import { PALACE_CLOSE } from './plan';
import { pillar } from './plaza';
import { beam, brazier, dome, flight, lanternBody, merlons, planter, rectPts, turret } from './props';

const HW = PALACE.width / 2, HD = PALACE.depth / 2;
/** the terrace, the long hall's depth and height, the keep's top */
const P = 3.2, HALL_D = 27, HALL_H = P + 19, KEEP = PALACE.height;
const WARM: V3 = [1.05, 0.96, 0.92];

export function buildPalace(c: City) {
  const b = c.b;
  b.group(() => {
    b.at(PALACE.x, FLOOR_Y, PALACE.z);
    const col = c.collide('city/palace');
    court(c, col);
    terrace(c, col);
    b.with({ tint: WARM }, () => {
      longHall(c, col);
      keepAndWings(c, col);
    });
    for (const [x, z, r] of [[-HW - 1, HD, 6.5], [HW + 1, HD, 6.5], [-HW - 1, -HD, 5.2], [HW + 1, -HD, 5.2]]) cornerTower(c, col, x, z, r);
    spire(c, col, 0, -4, KEEP);
  });
}

/** the court between the palace and the boulevard: paving, two fountain pools, palms, lamps, red pillars */
function court(c: City, col: Collide) {
  const b = c.b, r = PALACE_CLOSE;
  const x0 = r.x0 - PALACE.x, x1 = r.x1 - PALACE.x, z0 = r.z0 - PALACE.z, z1 = r.z1 - PALACE.z;
  b.with({ tint: [1.08, 1.02, 0.95] }, () => b.slab(rectPts(x0, z0, x1, z1), FLOOR.square, MAT.PAVING));
  b.with({ tint: [0.92, 0.62, 0.5] }, () => b.slab(rectPts(-16, HD + 14, 16, z1), FLOOR.square + 0.012, MAT.PAVING));
  for (const s of [-1, 1]) {
    pool(c, col, s * 30, HD + 26, 7, 4.5, 0.55);
    for (const dx of [-14, 14]) { planter(c, s * 30 + dx, HD + 26, 1.3, 0.7, 'palms', FLOOR.square); col.solid(s * 30 + dx - 1.3, HD + 24.7, s * 30 + dx + 1.3, HD + 27.3, 0, 0.8); }
    for (const x of [22, 38]) lampPost(c, col, s * x, HD + 16, 4.2, FLOOR.square);
    pillar(c, col, s * 17, z1 - 4, 12, FLOOR.square, 0.85);
  }
  // gardens behind: beds and cypress in rows
  for (let x = -40; x <= 40; x += 16) for (const z of [-HD - 14, -HD - 26]) {
    b.box(x - 5, 0, z - 3, x + 5, 0.5, z + 3, MAT.ASHLAR, { top: MAT.SOIL, skip: ['bottom'] });
    c.bed(rectPts(x - 4.8, z - 2.8, x + 4.8, z + 2.8), 0.5, z < -HD - 20 ? 'flowers' : 'shrubs', 0.85, 'mixed');
    col.solid(x - 5, z - 3, x + 5, z + 3, 0, 0.5);
    planter(c, x + 8, z, 0.7, 0.5, 'cypress', FLOOR.square);
  }
}

/** the terrace under the whole palace and the grand stair from the court */
function terrace(c: City, col: Collide) {
  const b = c.b, x0 = -HW - 2, x1 = HW + 2, z0 = -HD - 2, z1 = HD + 4;
  b.box(x0, -2, z0, x1, P, z1, MAT.ASHLAR, { top: MAT.PAVING, skip: ['bottom'] });
  b.box(x0 - 0.15, P - 0.35, z0 - 0.15, x1 + 0.15, P, z1 + 0.15, MAT.CREAM, { skip: ['bottom', 'top'] });
  // a balustrade along the terrace's front, open where the stair arrives
  for (const [u0, u1] of [[x0, -15], [15, x1]]) {
    b.box(u0, P, z1 - 0.5, u1, P + 1.0, z1, MAT.CREAM, { skip: ['bottom'] });
    col.solid(u0, z1 - 0.5, u1, z1, P, P + 1.0);
  }
  col.solid(x0, z0, x1, z1, -2, P).floor(x0, z0, x1, z1, P);
  const sw = 28, run = 11;
  flight(c, col, 0, z1 + run, FLOOR.square, run, P - FLOOR.square, sw, 1, -1, MAT.CREAM, { side: MAT.ASHLAR, steps: 18, foot: 0 });
  for (const s of [-1, 1]) {
    const x = s * (sw / 2 + 0.9);
    b.box(x - 0.9, 0, z1, x + 0.9, P + 0.8, z1 + run, MAT.ASHLAR, { top: MAT.CREAM, skip: ['bottom'] });
    col.solid(x - 0.9, z1, x + 0.9, z1 + run, 0, P + 0.8);
    brazier(c, x, P + 0.8, z1 + 0.9, 1.2);
    brazier(c, x, 0.9, z1 + run - 0.9, 0.9);
  }
}

/** the long hall: nine bays of lancets between buttresses with pinnacles, the portal and rose window in the middle */
function longHall(c: City, col: Collide) {
  const b = c.b, z0 = HD - HALL_D, z1 = HD;
  b.box(-HW, P, z0, HW, HALL_H, z1, MAT.PLASTER_WARM, { skip: ['bottom', 's', 'e', 'w'] });
  const f = new Face(b, [-HW, z1], [HW, z1], P, HALL_H - P);
  const bays = 9, bw = (2 * HW) / bays, ops: Opening[] = [];
  const lancets: [number, number, number][] = [];
  for (let k = 0; k < bays; k++) {
    const u = bw * (k + 0.5);
    if (k === (bays - 1) / 2) {
      ops.push({ u0: u - 3.0, u1: u + 3.0, v0: 0, top: 11.5, arch: 'pointed', depth: 1.4, fill: MAT.WOOD, fillTint: [0.9, 0.6, 0.45], frame: MAT.CREAM, frameW: 0.5 });
      continue;
    }
    ops.push({ u0: u - 2.3, u1: u + 2.3, v0: 2.6, top: 16.2, arch: 'pointed', depth: 0.8, fill: MAT.WINDOW, glow: 0.85, frame: MAT.CREAM, frameW: 0.3 });
    lancets.push([u, 2.6, 16.2]);
  }
  f.wall(MAT.PLASTER_WARM, ops);
  // tracery: two mullions up to the spring, a Y in the head
  for (const [u, v0, top] of lancets) {
    const spring = top - 4.6 * 0.8 * Math.sin(Math.acos((2.3 - 3.68) / 3.68));
    for (const du of [-0.77, 0.77]) relief(c, f, u + du, v0, u + du, spring, 0.18, 0.68, MAT.CREAM);
    relief(c, f, u - 0.77, spring, u, top - 1.2, 0.16, 0.68, MAT.CREAM);
    relief(c, f, u + 0.77, spring, u, top - 1.2, 0.16, 0.68, MAT.CREAM);
    relief(c, f, u - 2.3, v0 + (spring - v0) * 0.55, u + 2.3, v0 + (spring - v0) * 0.55, 0.18, 0.68, MAT.CREAM);
  }
  // the rose window over the portal
  const uc = HW, rv = 14.6;
  const disc = (r: number, w: number, m: Mat, glow = 0) => b.with({ glow }, () => {
    const n = 20, pts: V3[] = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push(f.at(uc + Math.cos(a) * r, rv + Math.sin(a) * r, w)); }
    b.poly(pts, m);
  });
  disc(2.6, -0.08, MAT.GOLD);
  disc(2.15, -0.12, MAT.LAVENDER, 0.8);
  for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI; relief(c, f, uc - Math.cos(a) * 2.1, rv - Math.sin(a) * 2.1, uc + Math.cos(a) * 2.1, rv + Math.sin(a) * 2.1, 0.14, -0.16, MAT.GOLD); }
  // buttresses with pinnacles, the cornice, the parapet with small merlons
  for (let k = 0; k <= bays; k++) {
    const u = bw * k;
    f.box(u - 0.8, 0, u + 0.8, HALL_H - P - 0.6, -1.2, 0, MAT.PLASTER_WARM, { top: MAT.CREAM, skip: ['bottom'] });
    const p = f.at(u, HALL_H - P, -0.6);
    b.box(p[0] - 0.55, p[1] - 0.6, p[2] - 0.55, p[0] + 0.55, p[1] + 2.4, p[2] + 0.55, MAT.CREAM, { skip: ['bottom'] });
    b.cylinder(p[0], p[2], 0.78, p[1] + 2.4, p[1] + 5.2, 4, MAT.CREAM, { r1: 0.05 });
  }
  f.box(-0.3, HALL_H - P - 0.9, f.len + 0.3, HALL_H - P, -0.55, 0, MAT.CREAM, { skip: ['left', 'right'] });
  const fp = new Face(b, [-HW, z1], [HW, z1], HALL_H, 1.6);
  fp.box(0, 0, fp.len, 0.8, 0, 0.45, MAT.PLASTER_WARM, { back: true, top: MAT.CREAM, skip: ['bottom', 'left', 'right'] });
  merlons(fp, 0.6, fp.len - 0.6, 0.8, 0.6, 0.55, 0.6, 0.45, MAT.CREAM);
  // the long hall's ends (west onto the plaza's way, east), with lancets
  for (const s of [-1, 1] as const) {
    const fe = s > 0 ? new Face(b, [HW, z1], [HW, z0], P, HALL_H - P) : new Face(b, [-HW, z0], [-HW, z1], P, HALL_H - P);
    const e: Opening[] = [];
    for (const u of [fe.len * 0.25, fe.len * 0.5, fe.len * 0.75]) e.push({ u0: u - 1.8, u1: u + 1.8, v0: 3, top: 14.5, arch: 'pointed', depth: 0.7, fill: MAT.WINDOW, glow: 0.8, frame: MAT.CREAM, frameW: 0.25 });
    fe.wall(MAT.PLASTER_WARM, e);
  }
  col.solid(-HW, z0, HW, z1, P, HALL_H).floor(-HW, z0, HW, z1, HALL_H).solid(-HW, z1 - 0.45, HW, z1, HALL_H, HALL_H + 1.4);
}

/** the keep in the middle (the spire's base) and the wings round it, crowded with chimney turrets */
function keepAndWings(c: City, col: Collide) {
  const b = c.b, zf = HD - HALL_D, WH = P + 13.5;
  // wings
  const wings: [number, number, number, number][] = [[-HW, -HD, -15, zf], [15, -HD, HW, zf], [-15, -HD, 15, -18]];
  for (const [x0, z0, x1, z1] of wings) {
    b.box(x0, P, z0, x1, WH, z1, MAT.PLASTER_WARM, { skip: ['bottom'] });
    b.box(x0 - 0.25, WH - 0.5, z0 - 0.25, x1 + 0.25, WH, z1 + 0.25, MAT.CREAM, { skip: ['top'] });
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
  // the keep
  const kx = 15, kz0 = -18, kz1 = zf + 0.5;
  b.box(-kx, P, kz0, kx, KEEP, kz1, MAT.PLASTER_WARM, { skip: ['bottom'] });
  b.box(-kx - 0.5, KEEP - 1.0, kz0 - 0.5, kx + 0.5, KEEP, kz1 + 0.5, MAT.CREAM);
  for (const [l, r] of [[[-kx, kz1], [kx, kz1]], [[kx, kz0], [-kx, kz0]], [[kx, kz1], [kx, kz0]], [[-kx, kz0], [-kx, kz1]]] as [V2, V2][]) {
    const f = new Face(b, l, r, P, KEEP - P);
    for (const u of [f.len * 0.2, f.len * 0.4, f.len * 0.6, f.len * 0.8]) b.with({ glow: 0.8 }, () => f.rect(u - 1.0, WH - P + 2.5, u + 1.0, KEEP - P - 3.0, -0.015, MAT.WINDOW));
  }
  col.solid(-kx, kz0, kx, kz1, P, KEEP).floor(-kx, kz0, kx, kz1, KEEP);
  // chimney turrets with domed caps over the wings and the hall
  const ts: [number, number, number][] = [[-38, -28, 21], [-24, -10, 17], [-38, 2, 19], [38, -28, 21], [24, -10, 17], [38, 2, 19], [-8, -30, 15], [8, -30, 15], [-30, HD - 6, 14], [30, HD - 6, 14]];
  for (const [x, z, h] of ts) {
    const y0 = z > zf ? HALL_H : WH, hw = h > 18 ? 1.9 : 1.6;
    turret(c, x, z, y0, hw, h, MAT.PLASTER_WARM, { capMat: MAT.PLASTER_WARM, glaze: WARM });
    col.solid(x - hw, z - hw, x + hw, z + hw, y0, y0 + h + hw);
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

