// The grand hall on the plaza's south side (ref 1), facing north onto it across its close (city.ts turns it about its
// anchor by GRAND_HALL.yaw; its own frame has local +z toward its front, the plaza). A tall
// terracotta front rises between two projecting piers to a stepped gable with a great diamond window. Below it a
// lavender panel is recessed into the front, carrying gold geometry in relief (a diamond, an X, chevrons) over a portal
// framed by nested gold gables. To either side the wings step down in three layers whose sloped tops, edged in cream,
// read as diagonal buttress walls; along their fronts runs a teal frieze with cream X's over tall arched windows. Red
// pillars on cubic plinths with lavender diamonds (plaza.ts redPillar: the parts' square pillar on its plinth, a gold
// lotus on its head) stand in rows either side of the broad steps that climb from the close to its podium, the
// tallest nearest the plaza, shrubs at their feet. Behind the hall lies a walled garden with a long pool and cypress. Its tilework in teal and
// terracotta on cream: the portal's gold lattice doors between tiled jambs under a tiled tympanum, the steps' risers,
// a dado of panels along the podium either side of them and on the cheek walls.
import type { Mat, V3 } from '../arch/types';
import { MAT, TILE_PAL } from '../arch/types';
import { PROUD } from '../arch/builder';
import { FLOOR_Y, GRAND_HALL, type V2 } from '../world/layout';
import type { City, Collide } from './ctx';
import { Face, type Opening, relief } from './facade';
import { FLOOR, pool } from './ground';
import { HALL_CLOSE } from './plan';
import { redPillar } from './plaza';
import { brazier, flight, planter, rectPts } from './props';
import { dado, revealDado, tilePanel } from './tiles';

const W = GRAND_HALL.width / 2, D = GRAND_HALL.depth / 2, TOP = GRAND_HALL.height;
/** the podium the hall stands on, the central block's half width and height, the piers */
const POD = 2.4, CW = 12, CH = 30, PIER = 3.4;
const WARM: V3 = [1.08, 1.0, 0.96];

export function buildHall(c: City) {
  const b = c.b;
  b.group(() => {
    b.at(GRAND_HALL.x, FLOOR_Y, GRAND_HALL.z);
    const col = c.collide('city/grand-hall');
    close(c, col);
    podium(c, col);
    b.with({ tint: WARM }, () => {
      centre(c, col);
      for (const s of [-1, 1] as const) wing(c, col, s);
    });
    front(c, col);
    pillars(c, col);
    garden(c, col);
  });
}

/** the red pillars of ref 1 in two rows either side of the steps and out across the close toward the plaza, the
 *  nearest the plaza the tallest; a low bed of shrubs along each row */
function pillars(c: City, col: Collide) {
  const b = c.b;
  for (const s of [-1, 1]) {
    for (const [i, [x, z, h]] of ([[19.6, D + 7, 15.2], [19.6, D + 16.5, 16.6], [19.6, D + 26, 18], [29, D + 11.5, 13.6], [29, D + 22, 14.8]] as [number, number, number][]).entries()) {
      redPillar(c, col, s * x, z, FLOOR.square, h, { top: 'finial', seed: 70 + i * 2 + (s > 0 ? 1 : 0) });
    }
    // the shrubs between the inner row's plinths, in a stone curb
    for (const [za, zb] of [[D + 9.4, D + 14.1], [D + 18.9, D + 23.6]]) {
      const x0 = s * 19.6 - 0.9, x1 = s * 19.6 + 0.9;
      b.box(Math.min(x0, x1), FLOOR.square, za, Math.max(x0, x1), FLOOR.square + 0.5, zb, MAT.ASHLAR, { top: MAT.SOIL, skip: ['bottom'] });
      c.bed(rectPts(Math.min(x0, x1) + 0.12, za + 0.12, Math.max(x0, x1) - 0.12, zb - 0.12), FLOOR.square + 0.5, 'shrubs', 1);
      col.solid(Math.min(x0, x1), za, Math.max(x0, x1), zb, 0, 0.6);
    }
  }
}

/** the close round the hall: paving, the side ways with palms */
function close(c: City, col: Collide) {
  const b = c.b, r = HALL_CLOSE, z0 = r.z0 - GRAND_HALL.z, z1 = r.z1 - GRAND_HALL.z;
  b.with({ tint: [1.08, 1.02, 0.95] }, () => b.slab(rectPts(r.x0, z0, r.x1, z1), FLOOR.square, MAT.PAVING));
  for (const s of [-1, 1]) for (let z = z0 + 10; z < D + 4; z += 13) {
    planter(c, s * (W + 13), z, 1.2, 0.6, 'palms', FLOOR.square);
    col.solid(s * (W + 13) - 1.2, z - 1.2, s * (W + 13) + 1.2, z + 1.2, 0, 0.7);
    if (z + 6.5 < D + 4) { b.place('lantern-post', [s * (W + 13), FLOOR.square, z + 6.5], { scale: 1.5 }); col.solid(s * (W + 13) - 0.25, z + 6.25, s * (W + 13) + 0.25, z + 6.75, 0, 3.4); }
  }
}

/** the podium and the broad steps from the plaza up to it */
function podium(c: City, col: Collide) {
  const b = c.b, x0 = -W - 1.5, x1 = W + 1.5, z0 = -D - 1.5, z1 = D + 3;
  b.box(x0, -2, z0, x1, POD, z1, MAT.ASHLAR, { top: MAT.PAVING, skip: ['bottom'] });
  b.box(x0 - 0.15, POD - 0.3, z0 - 0.15, x1 + 0.15, POD, z1 + 0.15, MAT.CREAM, { skip: ['bottom', 'top'] });
  col.solid(x0, z0, x1, z1, -2, POD).floor(x0, z0, x1, z1, POD);
  const sw = 34, run = 14, pal = TILE_PAL.HALL;
  b.with({ pal }, () => flight(c, col, 0, z1 + run, FLOOR.square, run, POD - FLOOR.square, sw, 1, -1, MAT.CREAM, { side: MAT.ASHLAR, steps: 16, foot: 0, riser: MAT.TILE_BORDER }));
  // cheek walls with braziers at the top, tiled panels on their outer sides and their ends
  for (const s of [-1, 1]) {
    const x = s * (sw / 2 + 0.8);
    b.box(x - 0.8, 0, z1, x + 0.8, POD + 0.9, z1 + run, MAT.ASHLAR, { top: MAT.CREAM, skip: ['bottom'] });
    col.solid(x - 0.8, z1, x + 0.8, z1 + run, 0, POD + 0.9);
    brazier(c, x, POD + 0.9, z1 + 1.0, 1.2);
    const xo = x + s * 0.8;
    const side = s > 0 ? new Face(b, [xo, z1 + run], [xo, z1], 0, POD + 0.9) : new Face(b, [xo, z1], [xo, z1 + run], 0, POD + 0.9);
    dado(c, side, 0.35, side.len - 0.35, FLOOR.square + 0.25, POD + 0.5, { pal, every: 4.6, bw: 0.24 });
    const end = new Face(b, [x - 0.8, z1 + run], [x + 0.8, z1 + run], 0, POD + 0.9);
    tilePanel(c, end, 0.2, FLOOR.square + 0.25, end.len - 0.2, POD + 0.5, { pal, bw: 0.2 });
  }
  // the podium's front either side of the steps: a dado of tiled panels under its cream band
  for (const s of [-1, 1]) {
    const xa = s * (sw / 2 + 1.6 + 0.4), xb = s * (x1 - 0.4);
    const f = s > 0 ? new Face(b, [xa, z1], [xb, z1], 0, POD) : new Face(b, [xb, z1], [xa, z1], 0, POD);
    dado(c, f, 0, f.len, FLOOR.square + 0.2, POD - 0.42, { pal, every: 4.8, bw: 0.24 });
  }
}

/** the central block behind the front: plain walls, a flat roof at CH with a parapet */
function centre(c: City, col: Collide) {
  const b = c.b, z0 = -D, z1 = D - 2;
  // (the roof is the cream band's top: the walls' own top at the same height fought it)
  b.box(-CW, POD, z0, CW, CH, z1, MAT.PLASTER_WARM, { skip: ['bottom', 'top', 's', 'n'] });
  b.box(-CW - 0.3, CH - 0.6, z0 - 0.3, CW + 0.3, CH, z1, MAT.CREAM, { skip: ['bottom', 's'] });
  // its back to the garden: three tall lancets over a door, buttresses between
  const fb = new Face(b, [CW, z0], [-CW, z0], POD, CH - POD);
  const ops: Opening[] = [{ u0: CW - 1.6, u1: CW + 1.6, v0: PROUD, top: 6.2, arch: 'pointed', depth: 0.9, fill: MAT.WOOD, fillTint: [0.8, 0.55, 0.45], frame: MAT.CREAM, frameW: 0.35 }];
  for (const u of [CW - 6.5, CW, CW + 6.5]) ops.push({ u0: u - 1.3, u1: u + 1.3, v0: 9, top: u === CW ? 24 : 21, arch: 'pointed', depth: 0.7, fill: MAT.WINDOW, glow: 0.8, frame: MAT.CREAM, frameW: 0.3 });
  fb.wall(MAT.PLASTER_WARM, ops);
  for (const u of [0.9, CW - 3.3, CW + 3.3, 2 * CW - 0.9]) {
    fb.box(u - 0.75, 0, u + 0.75, CH - POD - 3, -1.4, 0, MAT.PLASTER_WARM, { top: MAT.CREAM, skip: ['bottom'] });
    fb.box(u - 0.85, CH - POD - 3, u + 0.85, CH - POD - 2.6, -1.5, 0, MAT.CREAM, { skip: ['bottom'] });
  }
  fb.box(0, 7.2, 2 * CW, 7.6, -0.3, 0, MAT.CREAM, { skip: ['left', 'right'] });
  // tall windows high in its sides, over the wings
  for (const s of [-1, 1] as const) {
    const f = s > 0 ? new Face(b, [CW, z1], [CW, z0], POD, CH - POD) : new Face(b, [-CW, z0], [-CW, z1], POD, CH - POD);
    for (let k = 0; k < 5; k++) {
      const u = 5 + k * (f.len - 10) / 4;
      f.rect(u - 0.9, 23, u + 0.9, 26.5, -0.02, MAT.WINDOW);
    }
  }
  col.solid(-CW, z0, CW, z1, POD, CH).floor(-CW, z0, CW, z1, CH);
}

/** one wing (s = -1 west, 1 east): three layers stepping back and up toward the centre, their sloped tops edged in
 *  cream (the diagonal buttress walls), a teal frieze with cream X's along the front over tall arched windows */
function wing(c: City, col: Collide, s: -1 | 1) {
  const b = c.b;
  // [front z, back z, height at the centre, height at the outer end, outer x]
  const layers: [number, number, number, number, number][] = [[D - 5, D - 16, 27, 13.5, W], [D - 16, -4, 32.5, 18.5, W - 1.5], [-4, -D, 36, 23, W - 3.5]];
  const P = (x: number, y: number, z: number): V3 => [s * x, y, z];
  // (polygons are listed as they face for the east wing; the west wing's mirror reverses them)
  const poly = (p: V3[], m: Mat = MAT.PLASTER_WARM) => b.poly(s > 0 ? p : [...p].reverse(), m);
  for (const [i, [zf, zb, hi, lo, xo]] of layers.entries()) {
    const xi = CW;
    if (i === 0) wingFront(c, col, s, zf, lo, hi, xo);
    else poly([P(xi, POD, zf), P(xo, POD, zf), P(xo, lo, zf), P(xi, hi, zf)]);
    if (i < 2) poly([P(xi, hi, zb), P(xo, lo, zb), P(xo, POD, zb), P(xi, POD, zb)]);
    else wingBack(c, s, zb, lo, hi, xo);
    poly([P(xo, POD, zf), P(xo, POD, zb), P(xo, lo, zb), P(xo, lo, zf)]);
    poly([P(xo, lo, zf), P(xo, lo, zb), P(xi, hi, zb), P(xi, hi, zf)]);
    // (where it rises over the centre's roof, its inner side: else it's open to the roof, and seen through from there)
    if (hi > CH) poly([P(xi, CH, zb), P(xi, CH, zf), P(xi, hi, zf), P(xi, hi, zb)]);
    // the cream coping along the sloped front edge
    copingBeam(c, P(xo + 0.35, lo, zf + 0.35), P(xi, hi, zf + 0.35), 1.0, 0.6, s);
    // the outer end's windows
    const fo = s > 0 ? new Face(b, [xo, zf], [xo, zb], 0, lo) : new Face(b, [-xo, zb], [-xo, zf], 0, lo);
    const n = Math.floor(fo.len / 3.6);
    for (let k = 0; k < n; k++) {
      const u = (fo.len * (k + 0.5)) / n;
      b.with({ glow: 0.7 }, () => fo.rect(u - 0.7, POD + 2.5, u + 0.7, Math.min(lo - 2, POD + 7.5), -0.02, MAT.WINDOW));
    }
    // walked: the layer as stepped floors under its slope
    const steps = 4;
    for (let k = 0; k < steps; k++) {
      const xa = xi + ((xo - xi) * k) / steps, xb = xi + ((xo - xi) * (k + 1)) / steps;
      const h = hi + ((lo - hi) * (k + 0.5)) / steps;
      col.solid(s * xa, zb, s * xb, zf, POD, h).floor(s * xa, zb, s * xb, zf, h);
    }
  }
}

/** the back of the last layer, onto the garden: two rows of arched windows, the raking triangle over them */
function wingBack(c: City, s: -1 | 1, zb: number, lo: number, hi: number, xo: number) {
  const b = c.b;
  const f = s > 0 ? new Face(b, [xo, zb], [CW, zb], POD, lo - POD) : new Face(b, [-CW, zb], [-xo, zb], POD, lo - POD);
  const n = Math.floor(f.len / 3.4), ops: Opening[] = [];
  for (let k = 0; k < n; k++) {
    const u = (f.len * (k + 0.5)) / n;
    ops.push({ u0: u - 0.8, u1: u + 0.8, v0: 1.4, top: 6.4, arch: 'round', depth: 0, fill: MAT.WINDOW, glow: 0.7 });
    ops.push({ u0: u - 0.7, u1: u + 0.7, v0: 10.5, top: 14.5, arch: 'round', depth: 0, fill: MAT.WINDOW, glow: 0.7 });
  }
  f.wall(MAT.PLASTER_WARM, ops);
  f.box(0, 8.4, f.len, 8.8, -0.3, 0, MAT.CREAM, { skip: ['left', 'right'] });
  b.poly(s > 0 ? [[xo, lo, zb], [CW, lo, zb], [CW, hi, zb]] : [[-CW, lo, zb], [-xo, lo, zb], [-CW, hi, zb]], MAT.PLASTER_WARM);
}

/** a sloped beam of rectangular section from a up to z (a coping along a raking wall top), `w` deep, `h` tall */
function copingBeam(c: City, a: V3, z: V3, w: number, h: number, s: number) {
  const b = c.b, dz = w / 2;
  const A0: V3 = [a[0], a[1], a[2] - dz], A1: V3 = [a[0], a[1], a[2] + dz], Z0: V3 = [z[0], z[1], z[2] - dz], Z1: V3 = [z[0], z[1], z[2] + dz];
  const up = (p: V3): V3 => [p[0], p[1] + h, p[2]];
  const q = (p: V3[]) => b.poly(s > 0 ? p : [...p].reverse(), MAT.CREAM);
  q([up(A0), up(A1), up(Z1), up(Z0)].reverse());
  q([A1, Z1, up(Z1), up(A1)].reverse());
  q([A1, A0, Z0, Z1].reverse());
  q([up(A0), up(A1), A1, A0]);
  q([Z0, up(Z0), up(A0), A0]);
}

/** the wing's front: a wall with tall arched windows up to its outer height, the raking triangle above, the teal
 *  frieze with cream X's and diamonds, shrubs along its foot */
function wingFront(c: City, col: Collide, s: -1 | 1, zf: number, lo: number, hi: number, xo: number) {
  const b = c.b;
  const f = s > 0 ? new Face(b, [CW, zf], [xo, zf], POD, lo - POD) : new Face(b, [-xo, zf], [-CW, zf], POD, lo - POD);
  const L = f.len, n = 5;
  // lanterns between the windows
  for (let k = 1; k < n; k++) b.place('lantern-wall', f.at((L * k) / n, 4.6), { scale: 1.2 });
  const ops: Opening[] = [];
  for (let k = 0; k < n; k++) {
    const u = (L * (k + 0.5)) / n;
    ops.push({ u0: u - 0.95, u1: u + 0.95, v0: 0.9, top: 6.6, arch: 'round', depth: 0.55, fill: MAT.WINDOW, glow: 0.75, frame: MAT.CREAM, frameW: 0.22 });
  }
  f.wall(MAT.PLASTER_WARM, ops);
  const tri: V3[] = s > 0 ? [[CW, lo, zf], [xo, lo, zf], [CW, hi, zf]] : [[-xo, lo, zf], [-CW, lo, zf], [-CW, hi, zf]];
  b.poly(tri, MAT.PLASTER_WARM);
  // the frieze: teal, with cream X's in relief and little diamonds between
  const v0 = 7.5, v1 = 9.9;
  f.box(0, v0 - 0.2, L, v0, -0.22, 0, MAT.CREAM, { skip: ['left', 'right'] });
  f.box(0, v0, L, v1, -0.14, 0, MAT.TEAL, { skip: ['left', 'right', 'bottom'] });
  f.box(0, v1, L, v1 + 0.25, -0.22, 0, MAT.CREAM, { skip: ['left', 'right'] });
  const cell = L / Math.round(L / 2.3);
  for (let u = cell / 2; u < L; u += cell) {
    const hw = cell * 0.34, m = 0.22;
    relief(c, f, u - hw, v0 + m, u + hw, v1 - m, 0.2, -0.18);
    relief(c, f, u - hw, v1 - m, u + hw, v0 + m, 0.2, -0.18 - PROUD);
    if (u + cell / 2 < L - 0.2) {
      const du = u + cell / 2, dv = (v0 + v1) / 2;
      b.poly([f.at(du, dv - 0.32, -0.18), f.at(du + 0.24, dv, -0.18), f.at(du, dv + 0.32, -0.18), f.at(du - 0.24, dv, -0.18)], MAT.CREAM);
    }
  }
  // shrubs in a long planter along its foot
  const z0 = zf + 0.4, z1 = zf + 2.0, x0 = s > 0 ? CW + 0.6 : -xo + 0.6, x1 = s > 0 ? xo - 0.6 : -CW - 0.6;
  b.box(x0, POD, z0, x1, POD + 0.7, z1, MAT.ASHLAR, { top: MAT.SOIL, skip: ['bottom'] });
  c.bed(rectPts(x0 + 0.15, z0 + 0.15, x1 - 0.15, z1 - 0.15), POD + 0.7, 'shrubs', 1);
  col.solid(x0, z0, x1, z1, POD, POD + 0.7);
}

/** the central front between the piers: the portal under nested gold gables, the lavender panel recessed with its
 *  gold geometry, the cornice, the gable with the great diamond window; the piers with their caps and gold diamonds */
function front(c: City, col: Collide) {
  const b = c.b, x0 = -CW + PIER, x1 = CW - PIER, zf = D, top = 31;
  b.with({ tint: WARM }, () => {
    const f = new Face(b, [x0, zf], [x1, zf], POD, top - POD);
    const L = f.len, uc = L / 2;
    const panel: Opening = { u0: 2.0, u1: L - 2.0, v0: 10.2, top: 25.8, arch: 'flat', depth: 0.75, fill: MAT.LAVENDER, frame: MAT.GOLD, frameW: 0.32 };
    const portal: Opening = { u0: uc - 3.1, u1: uc + 3.1, v0: PROUD, top: 7.6, arch: 'flat', depth: 1.8, fill: MAT.LATTICE, pal: TILE_PAL.HALL, glow: 0, frame: MAT.CREAM, frameW: 0.45 };
    f.wall(MAT.PLASTER_WARM, [panel, portal]);
    // the portal's tilework: a tiled field either side of it in a border, the tympanum under the lowest gable tiled
    const jl = portal.u0 - 0.45, jr = portal.u1 + 0.45, fv = 7.75, sw = 1.3, bw = 0.28;
    b.with({ pal: TILE_PAL.HALL }, () => {
      f.rect(jl - sw, 0, jl, fv, -0.012, MAT.TILE).rect(jr, 0, jr + sw, fv, -0.012, MAT.TILE);
      f.region([[uc - 3.62, 8.05], [uc + 3.62, 8.05], [uc, 10.04]], -0.012, MAT.TILE);
      revealDado(c, f, portal, 2.6, TILE_PAL.HALL);
      // (the border up their outer sides and over their tops)
      for (const [a0, v0, a1, v1] of [[jl - sw - bw, 0, jl - sw, fv], [jr + sw, 0, jr + sw + bw, fv], [jl - sw - bw, fv, jl, fv + bw], [jr, fv, jr + sw + bw, fv + bw]]) {
        f.box(a0, v0, a1, v1, -0.04, 0, MAT.CREAM, { skip: ['front', 'bottom'] });
        f.rect(a0, v0, a1, v1, -0.04, MAT.TILE_BORDER);
      }
    });
    // the gold geometry on the panel (laid on its lavender back)
    // (each strip a little prouder than the one laid before it, in a cycle of four: where two meet or cross, one stands
    // over the other instead of the two fighting in one plane)
    let lvl = 0;
    const gold = (a0: number, b0: number, a1: number, b1: number, w = 0.34) => relief(c, f, a0, b0, a1, b1, w, panel.depth - 0.12 - PROUD * (lvl++ % 4), MAT.GOLD);
    const pu = (t: number) => panel.u0 + (panel.u1 - panel.u0) * t, pv = (t: number) => panel.v0 + (panel.top - panel.v0) * t;
    // a diamond outline at the top with a solid one inside
    const dia = (cu: number, cv: number, hu: number, hv: number) => { gold(cu, cv - hv, cu + hu, cv); gold(cu + hu, cv, cu, cv + hv); gold(cu, cv + hv, cu - hu, cv); gold(cu - hu, cv, cu, cv - hv); };
    dia(pu(0.5), pv(0.83), 2.1, 1.9);
    b.poly([f.at(pu(0.5), pv(0.83) - 0.8, 0.6), f.at(pu(0.5) + 0.8, pv(0.83), 0.6), f.at(pu(0.5), pv(0.83) + 0.8, 0.6), f.at(pu(0.5) - 0.8, pv(0.83), 0.6)], MAT.GOLD);
    // the Y: two arms meeting, a stem
    gold(pu(0.2), pv(0.66), pu(0.5), pv(0.53));
    gold(pu(0.8), pv(0.66), pu(0.5), pv(0.53));
    gold(pu(0.5), pv(0.53), pu(0.5), pv(0.4));
    // an X in a diamond below it
    dia(pu(0.5), pv(0.27), 2.5, 1.9);
    gold(pu(0.5) - 1.25, pv(0.27) - 0.95, pu(0.5) + 1.25, pv(0.27) + 0.95, 0.24);
    gold(pu(0.5) + 1.25, pv(0.27) - 0.95, pu(0.5) - 1.25, pv(0.27) + 0.95, 0.24);
    // chevrons at the foot
    for (const t of [0.05, 0.12]) { gold(pu(0.22), pv(t), pu(0.5), pv(t + 0.06)); gold(pu(0.5), pv(t + 0.06), pu(0.78), pv(t)); }
    // nested gold gables over the portal, small diamonds beside it
    for (const [k, hw] of [[0, 4.2], [1, 3.3], [2, 2.4]] as [number, number][]) {
      const v = 7.9 + k * 0.62;
      relief(c, f, uc - hw, v, uc, v + hw * 0.55, 0.3, -0.12 - k * 2 * PROUD, MAT.GOLD);
      relief(c, f, uc, v + hw * 0.55, uc + hw, v, 0.3, -0.12 - (k * 2 + 1) * PROUD, MAT.GOLD);
    }
    for (const u of [uc - 6.6, uc + 6.6]) for (const v of [2.2, 5.2]) b.poly([f.at(u, v - 0.4, -0.04), f.at(u + 0.32, v, -0.04), f.at(u, v + 0.4, -0.04), f.at(u - 0.32, v, -0.04)], MAT.GOLD);
    // the cornice over the front and the gable above it with its diamond window
    f.box(-PIER - 0.2, top - POD - 0.7, L + PIER + 0.2, top - POD, -0.5, 0, MAT.CREAM, { skip: ['left', 'right'] });
    const peak = TOP - 0.8;
    b.poly([[x0, top, zf], [x1, top, zf], [0, peak, zf]], MAT.PLASTER_WARM);
    b.poly([[x1, top, zf - 6], [x0, top, zf - 6], [0, peak, zf - 6]], MAT.PLASTER_WARM);
    b.poly([[x1, top, zf], [x1, top, zf - 6], [0, peak, zf - 6], [0, peak, zf]], MAT.PLASTER_WARM);
    b.poly([[x0, top, zf - 6], [x0, top, zf], [0, peak, zf], [0, peak, zf - 6]], MAT.PLASTER_WARM);
    copingBeam(c, [x1 + 0.4, top, zf - 2.6], [0, peak + 0.2, zf - 2.6], 6.6, 0.55, 1);
    copingBeam(c, [-x1 - 0.4, top, zf - 2.6], [0, peak + 0.2, zf - 2.6], 6.6, 0.55, -1);
    const dc = 33.6, dr = 2.5;
    b.poly([[0, dc - dr - 0.35, zf + 0.06], [dr * 0.85 + 0.35, dc, zf + 0.06], [0, dc + dr + 0.35, zf + 0.06], [-dr * 0.85 - 0.35, dc, zf + 0.06]], MAT.GOLD);
    b.with({ glow: 0.85 }, () => b.poly([[0, dc - dr, zf + 0.1], [dr * 0.85, dc, zf + 0.1], [0, dc + dr, zf + 0.1], [-dr * 0.85, dc, zf + 0.1]], MAT.LAVENDER));
    relief(c, new Face(b, [-dr, zf + 0.1], [dr, zf + 0.1], 0, 40), dr, dc - dr, dr, dc + dr, 0.2, -0.06, MAT.GOLD);
    relief(c, new Face(b, [-dr, zf + 0.1], [dr, zf + 0.1], 0, 40), dr - dr * 0.85, dc, dr + dr * 0.85, dc, 0.2, -0.06 - PROUD, MAT.GOLD);
    // the piers: projecting, rising past the cornice to stepped caps; gold diamonds up their faces
    for (const sx of [-1, 1]) {
      const px0 = sx > 0 ? x1 : -CW, px1 = sx > 0 ? CW : x0, pz = zf + 1.7, ph = 35;
      b.box(px0, POD, zf - 0.5, px1, ph, pz, MAT.PLASTER_WARM, { skip: ['bottom', 'n'] });
      b.box(px0 - 0.35, ph, zf - 0.85, px1 + 0.35, ph + 0.6, pz + 0.35, MAT.CREAM);
      b.box(px0 + 0.2, ph + 0.6, zf - 0.3, px1 - 0.2, ph + 1.8, pz - 0.2, MAT.PLASTER_WARM, { skip: ['bottom'] });
      b.cylinder((px0 + px1) / 2, (zf - 0.3 + pz - 0.2) / 2, (px1 - px0 - 0.4) * 0.72, ph + 1.8, ph + 2.5, 4, MAT.CREAM, { r1: (px1 - px0 - 0.4) * 0.3 });
      b.place('finial-lotus', [(px0 + px1) / 2, ph + 2.5, (zf - 0.3 + pz - 0.2) / 2], { scale: 2.6 });
      const pf = new Face(b, [px0, pz], [px1, pz], POD, ph - POD);
      for (const v of [4, 10, 16, 22, 28]) {
        const uc2 = pf.len / 2;
        b.poly([pf.at(uc2, v - 0.55, -0.03), pf.at(uc2 + 0.42, v, -0.03), pf.at(uc2, v + 0.55, -0.03), pf.at(uc2 - 0.42, v, -0.03)], MAT.GOLD);
      }
      pf.box(0.25, 0, 0.5, ph - POD - 0.2, -0.06, 0, MAT.CREAM, { skip: ['bottom', 'top'] });
      pf.box(pf.len - 0.5, 0, pf.len - 0.25, ph - POD - 0.2, -0.06, 0, MAT.CREAM, { skip: ['bottom', 'top'] });
      b.place('lantern-wall', pf.at(pf.len / 2, 2.4), { scale: 1.5 });
      col.solid(px0, zf - 0.5, px1, pz, POD, ph + 1.8);
    }
  });
  // the portal's lanterns and braziers either side of it
  for (const sx of [-1, 1]) brazier(c, sx * 5.4, POD, zf + 2.6, 1.0);
  col.solid(x0, zf - 6, x1, zf, top, TOP - 0.8);
}

/** the walled garden behind the hall: a long pool between cypress, flower beds, two domed kiosks, a gate north */
function garden(c: City, col: Collide) {
  const b = c.b, z0 = -D - 3, z1 = HALL_CLOSE.z0 - GRAND_HALL.z + 2, x = 26;
  // the wall round it, open to the north in the middle
  const segs: [V2, V2][] = [[[-x, z1], [-4, z1]], [[4, z1], [x, z1]], [[x, z1], [x, z0]], [[-x, z0], [-x, z1]]];
  for (const [p, q] of segs) {
    const f = new Face(b, p, q, 0, 2.2);
    f.box(0, 0, f.len, 2.2, 0, 0.5, MAT.PLASTER_WARM, { back: true, top: MAT.CREAM, skip: ['bottom'] });
    const r = [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])];
    col.solid(r[0] - 0.5, r[1] - 0.5, r[2] + 0.5, r[3] + 0.5, 0, 2.2);
  }
  for (const sx of [-4.4, 4.4]) { b.box(sx - 0.6, 0, z1 - 0.6, sx + 0.6, 3.6, z1 + 0.6, MAT.CREAM); col.solid(sx - 0.6, z1 - 0.6, sx + 0.6, z1 + 0.6, 0, 3.6); }
  const zc = (z0 + z1) / 2;
  pool(c, col, 0, zc, 3.2, Math.abs(z1 - z0) / 2 - 7, 0.5, { fountain: false });
  for (const sx of [-1, 1]) {
    for (let z = z0 - 3; z > z1 + 3; z -= 4.6) planter(c, sx * 6.2, z, 0.7, 0.5, 'cypress', FLOOR.square);
    const r = [sx > 0 ? 9 : -22, z1 + 4, sx > 0 ? 22 : -9, z0 - 4];
    b.box(r[0], 0, Math.min(r[1], r[3]), r[2], 0.5, Math.max(r[1], r[3]), MAT.ASHLAR, { top: MAT.SOIL, skip: ['bottom'] });
    c.bed(rectPts(r[0] + 0.2, Math.min(r[1], r[3]) + 0.2, r[2] - 0.2, Math.max(r[1], r[3]) - 0.2), 0.5, 'flowers', 0.9, sx > 0 ? 'white' : 'pink');
    col.solid(r[0], Math.min(r[1], r[3]), r[2], Math.max(r[1], r[3]), 0, 0.5);
  }
}

