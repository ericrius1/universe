// The city wall on the WALL ellipse: straight curtain walls between towers about every 80 m, each curtain on a battered
// plinth with buttresses and a string course, a wall walk you can stand on behind a crenellated outer parapet and a low
// inner one, stairs up to it from the street inside. The towers are square, the walk passing through them, and crowned
// three ways (a crenellated platform, a domed pavilion, a pointed cap). The south gate opens between two tall round
// towers with blue domes (ref 6) under a gatehouse with its arch open and its doors swung back; the north end of the
// avenue is left open between two domed towers for the grand stair; small posterns open east and west.
import type { V3 } from '../arch/types';
import { MAT } from '../arch/types';
import { GATE, STAIR, WALL, type V2 } from '../world/layout';
import type { City, Collide } from './ctx';
import { Face, type Opening } from './facade';
import { wallPoint } from './geom';
import { CLOTHS, banner, brazier, dome, flight, merlons } from './props';
import { Rng } from './rng';

/** the walk's height, the parapets' */
const WALK = WALL.height - 2.2;
const HALF = WALL.thick / 2;
const PARAPET = 1.1;
const SPACING = 80;

interface Tower { t: number; p: V2; kind: 'tower' | 'gate' | 'north' | 'postern' }

export function buildWall(c: City, seed: number) {
  const rng = new Rng(seed);
  const towers = placeTowers();
  for (let i = 0; i < towers.length; i++) {
    const a = towers[i], b = towers[(i + 1) % towers.length];
    // the opening between a gate's two towers is the gate itself
    if (a.kind === b.kind && a.kind !== 'tower') { gateway(c, a, b); continue; }
    curtain(c, a.p, b.p, i, rng);
  }
  for (const [i, t] of towers.entries()) {
    if (t.kind === 'gate') gateTower(c, t, i);
    else if (t.kind === 'north') northTower(c, t, i);
    else squareTower(c, t, i, rng.fork(i));
  }
}

/** the wall's tangent direction (unit, plan) at its parameter t */
function tangent(t: number): V2 {
  const dx = -Math.sin(t) * WALL.rx, dz = Math.cos(t) * WALL.rz, l = Math.hypot(dx, dz);
  return [dx / l, dz / l];
}

/** the wall parameter where it passes nearest a plan point */
function paramAt(p: V2): number {
  return Math.atan2((p[1] - WALL.cz) / WALL.rz, (p[0] - WALL.cx) / WALL.rx);
}

/** the towers round the ellipse: the gates' pairs first, then evenly between them */
function placeTowers(): Tower[] {
  const anchors: Tower[] = [];
  const pair = (centre: number, half: number, kind: Tower['kind']) => {
    // (half: the plan distance from the opening's middle to each tower's centre, along the wall)
    const dt = half / arcRate(centre);
    for (const t of [centre - dt, centre + dt]) anchors.push({ t, p: wallPoint(t), kind });
  };
  pair(paramAt([GATE.x, GATE.z]), GATE.width / 2 + GATE.towerR, 'gate');
  pair(paramAt([STAIR.landings[0][0], WALL.cz - WALL.rz]), 19, 'north');
  pair(paramAt([wallReachX(1), 0]), 9, 'postern');
  pair(paramAt([-wallReachX(1), 0]), 9, 'postern');
  anchors.sort((a, b) => norm(a.t) - norm(b.t));
  const out: Tower[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i], b = anchors[(i + 1) % anchors.length];
    out.push(a);
    if (a.kind === b.kind && a.kind !== 'tower' && Math.abs(norm(b.t) - norm(a.t)) < 0.2) continue;
    const t0 = norm(a.t), t1 = norm(b.t) + (i + 1 === anchors.length ? Math.PI * 2 : 0);
    const len = arcLen(t0, t1), n = Math.max(0, Math.round(len / SPACING) - 1);
    // evenly in arc length
    for (let k = 1; k <= n; k++) out.push({ t: atArc(t0, t1, (len * k) / (n + 1)), p: [0, 0], kind: 'tower' });
  }
  for (const t of out) if (t.kind === 'tower') t.p = wallPoint(t.t);
  return out;
}

const norm = (t: number) => ((t % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
const arcRate = (t: number) => Math.hypot(WALL.rx * Math.sin(t), WALL.rz * Math.cos(t));
function arcLen(t0: number, t1: number) { let s = 0; const n = 200; for (let i = 0; i < n; i++) s += arcRate(t0 + ((t1 - t0) * (i + 0.5)) / n) * ((t1 - t0) / n); return s; }
function atArc(t0: number, t1: number, s: number) {
  let acc = 0, t = t0;
  const dt = (t1 - t0) / 2000;
  while (acc < s && t < t1) { acc += arcRate(t + dt / 2) * dt; t += dt; }
  return t;
}
/** where the wall crosses the plaza's east-west line (z = 0) */
function wallReachX(sign: number) { return sign * WALL.rx * Math.sqrt(1 - ((0 - WALL.cz) / WALL.rz) ** 2); }

/** a frame at plan point a looking along a -> b: local x along the wall, local z outward (away from the city) */
function frameAlong(c: City, a: V2, b: V2) {
  const yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
  c.b.at(a[0], 0, a[1], yaw);
  // (with x along a -> b, local +z is world (sin, cos)(yaw): outward when the wall runs clockwise on the map)
}

/** a curtain wall from tower centre a to tower centre b */
function curtain(c: City, a: V2, b: V2, idx: number, rng: Rng) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  c.b.group(() => {
    frameAlong(c, a, b);
    // outward must be +z: the city's centre lies at -z
    const mid = c.b.xf([L / 2, 0, 0]), out = c.b.xd([0, 0, 1]);
    const sgn = (mid[0] - WALL.cx) * out[0] + (mid[2] - WALL.cz) * out[2] > 0 ? 1 : -1;
    if (sgn < 0) { c.b.at(L, 0, 0, Math.PI); }
    const col = c.collide(`city/wall-${idx}`);
    curtainBody(c, col, L, rng);
  });
}

function curtainBody(c: City, col: Collide, L: number, rng: Rng) {
  const b = c.b;
  const top = WALK, out = HALF, inn = -HALF;
  // the mass, its battered foot outside, the walk on top
  b.box(0, -2, inn, L, top, out, MAT.PLASTER, { top: MAT.PAVING, skip: ['bottom', 'w', 'e'] });
  const talus = (y0: number, y1: number, z0: number, z1: number) => b.quad([L, y0, z1], [L, y1, z0], [0, y1, z0], [0, y0, z1], MAT.ASHLAR);
  talus(-2, 3.2, out, out + 1.1);
  b.box(0, 3.2, out, L, 3.5, out + 0.15, MAT.CREAM, { skip: ['bottom', 'w', 'e', 'n'] });
  // string course and the corbelled band under the parapet
  b.box(0, 10.6, out, L, 10.9, out + 0.12, MAT.CREAM, { skip: ['w', 'e', 'n'] });
  b.box(0, top - 0.7, out, L, top, out + 0.38, MAT.CREAM, { skip: ['w', 'e', 'n'] });
  // the outer parapet with its merlons, the inner one low
  b.box(0, top, out - 0.6, L, top + PARAPET, out + 0.38, MAT.PLASTER, { top: MAT.CREAM, skip: ['bottom', 'w', 'e'] });
  const fo = new Face(b, [L, out + 0.38], [0, out + 0.38], top + PARAPET, 1.2);
  merlons(fo, 1.0, L - 1.0, 0, 1.2, 1.15, 0.85, 0.98, MAT.PLASTER);
  // a stair up from the street along the inner face of some curtains: the low parapet opens where it arrives
  const run = WALK * 1.3, sw = 2.2, sx0 = L / 2 - run / 2, sz = inn - 0.36 - sw / 2;
  const stair = L > 40 && rng.chance(0.4);
  const gaps: [number, number][] = stair ? [[0, sx0 + run], [sx0 + run + sw, L]] : [[0, L]];
  for (const [g0, g1] of gaps) {
    b.box(g0, top, inn, g1, top + 0.95, inn + 0.3, MAT.PLASTER, { top: MAT.CREAM, skip: ['bottom', ...(g0 > 0 ? [] : ['w' as const]), ...(g1 < L ? [] : ['e' as const])] });
    col.solid(g0, inn, g1, inn + 0.3, top, top + 0.95);
  }
  // buttresses with sloped heads
  const nb = Math.max(1, Math.floor(L / 17));
  for (let k = 1; k < nb; k++) {
    const x = (L * k) / nb, hw = 0.85, d = 1.25, h0 = 8.4, h1 = 10.4;
    b.box(x - hw, -2, out, x + hw, h0, out + d, MAT.PLASTER, { skip: ['bottom', 'n', 'top'] });
    b.quad([x - hw, h0, out + d], [x + hw, h0, out + d], [x + hw, h1, out], [x - hw, h1, out], MAT.CREAM);
    b.poly([[x - hw, h0, out + d], [x - hw, h1, out], [x - hw, h0, out]], MAT.PLASTER);
    b.poly([[x + hw, h0, out], [x + hw, h1, out], [x + hw, h0, out + d]], MAT.PLASTER);
  }
  // pilasters on the city side
  for (let x = 8; x < L - 4; x += 10) b.box(x - 0.5, -2, inn - 0.35, x + 0.5, top - 0.6, inn, MAT.PLASTER, { top: MAT.CREAM, skip: ['bottom', 's'] });
  b.box(0, top - 0.6, inn - 0.3, L, top, inn, MAT.CREAM, { skip: ['w', 'e', 's'] });
  col.solid(0, inn, L, out, -2, top).floor(0, inn, L, out - 0.6, top);
  col.solid(0, out - 0.6, L, out + 0.38, top, top + PARAPET + 1.15);
  if (stair) {
    flight(c, col, sx0, sz, 0, run, WALK, sw, 0, 1, MAT.PAVING, { side: MAT.PLASTER, foot: -2 });
    // the landing at the top, level with the walk
    b.box(sx0 + run, -2, sz - sw / 2, sx0 + run + sw, WALK, inn, MAT.PLASTER, { top: MAT.PAVING, skip: ['bottom', 'n'] });
    col.solid(sx0 + run, sz - sw / 2, sx0 + run + sw, inn, -2, WALK).floor(sx0 + run, sz - sw / 2, sx0 + run + sw, inn + 0.3, WALK);
  }
}

/** a square wall tower centred on the wall line at t, its walk passing through, crowned one of three ways */
function squareTower(c: City, t: Tower, idx: number, rng: Rng) {
  const b = c.b;
  const [tx, tz] = tangent(t.t);
  c.b.group(() => {
    b.at(t.p[0], 0, t.p[1], Math.atan2(-tz, tx));
    // (local x along the wall, local z outward)
    const out = b.xd([0, 0, 1]);
    if ((t.p[0] - WALL.cx) * out[0] + (t.p[1] - WALL.cz) * out[2] < 0) b.at(0, 0, 0, Math.PI);
    const col = c.collide(`city/tower-${idx}`);
    const hw = t.kind === 'postern' ? 5 : 4.6, z0 = -HALF - 0.8, z1 = HALF + 4.2, H = WALK + 6.8;
    b.box(-hw, -2, z0, hw, H, z1, MAT.PLASTER, { top: MAT.PAVING, skip: ['bottom'] });
    // battered foot, bands, the walk's doors through it
    // (each sloped face wound to face out and up)
    b.quad([hw, 3.2, z1], [-hw, 3.2, z1], [-hw - 0.9, -2, z1 + 0.9], [hw + 0.9, -2, z1 + 0.9], MAT.ASHLAR);
    b.quad([hw, 3.2, z0], [hw, 3.2, z1], [hw + 0.9, -2, z1 + 0.9], [hw + 0.9, -2, z0], MAT.ASHLAR);
    b.quad([-hw, 3.2, z1], [-hw, 3.2, z0], [-hw - 0.9, -2, z0], [-hw - 0.9, -2, z1 + 0.9], MAT.ASHLAR);
    b.box(-hw - 0.12, WALK - 0.7, z0 - 0.12, hw + 0.12, WALK - 0.4, z1 + 0.12, MAT.CREAM, { skip: ['bottom'] });
    b.box(-hw - 0.4, H - 0.5, z0 - 0.4, hw + 0.4, H, z1 + 0.4, MAT.CREAM);
    for (const s of [-1, 1] as const) {
      const f = s > 0 ? new Face(b, [hw, z1], [hw, z0], 0, H) : new Face(b, [-hw, z0], [-hw, z1], 0, H);
      const zc = f.len - (0 - z0) - 0.1;
      f.wall(MAT.PLASTER, [{ u0: zc - 1.0, u1: zc + 1.0, v0: WALK, top: WALK + 2.7, arch: 'round', depth: 0.6, fill: MAT.INTERIOR }]);
    }
    // slits and a window on the outer face
    const fo = new Face(b, [-hw, z1], [hw, z1], 0, H);
    const slits: Opening[] = [5.5, 10, WALK + 2.4].map((v) => ({ u0: hw - 0.18, u1: hw + 0.18, v0: v, top: v + 1.6, arch: 'flat' as const, depth: 0, fill: MAT.WINDOW, glow: v > WALK ? 0.6 : 0 }));
    fo.wall(MAT.PLASTER, []);
    for (const o of slits) fo.rect(o.u0, o.v0, o.u1, o.top, -0.012, MAT.WINDOW);
    // the crown: merlons round the platform, then a pavilion, a pointed cap or nothing more
    const crown = rng.weighted(['merlons', 'pavilion', 'cap'] as const, [5, 3, 2]);
    const ring: [V2, V2][] = [[[hw + 0.4, z0 - 0.4], [-hw - 0.4, z0 - 0.4]], [[-hw - 0.4, z0 - 0.4], [-hw - 0.4, z1 + 0.4]], [[-hw - 0.4, z1 + 0.4], [hw + 0.4, z1 + 0.4]], [[hw + 0.4, z1 + 0.4], [hw + 0.4, z0 - 0.4]]];
    for (const [l, r] of ring) {
      const f = new Face(b, l, r, H, 1.3);
      f.box(0, 0, f.len, 0.9, 0, 0.45, MAT.PLASTER, { back: true, top: MAT.CREAM, skip: ['bottom'] });
      merlons(f, 0.6, f.len - 0.6, 0.9, 0.9, 0.9, 0.7, 0.45, MAT.PLASTER);
    }
    const zc = (z0 + z1) / 2;
    if (crown === 'pavilion') {
      const s = 2.6, ph = 3.4;
      for (const [px, pz] of [[-s, zc - s], [s, zc - s], [s, zc + s], [-s, zc + s]]) b.box(px - 0.35, H, pz - 0.35, px + 0.35, H + ph, pz + 0.35, MAT.CREAM, { skip: ['bottom'] });
      b.box(-s - 0.6, H + ph, zc - s - 0.6, s + 0.6, H + ph + 0.5, zc + s + 0.6, MAT.CREAM);
      dome(c, 0, H + ph + 0.5, zc, s + 0.2, { drum: 0, finial: true, bulge: 1.08, tip: 0.5 });
      col.solid(-s - 0.6, zc - s - 0.6, s + 0.6, zc + s + 0.6, H + ph, H + ph + 4);
    } else if (crown === 'cap') {
      b.cylinder(0, zc, (hw + 0.2) * Math.SQRT2, H + 0.6, H + 6.5, 4, MAT.PLASTER_WARM, { r1: 0.15 });
      b.cylinder(0, zc, 0.14, H + 6.5, H + 7.4, 6, MAT.GOLD);
      col.solid(-hw, z0, hw, z1, H, H + 4);
    }
    // its body solid below the walk and round the passage; the passage, the platform
    col.solid(-hw, z0, hw, z1, -2, WALK).floor(-hw, -HALF + 0.3, hw, HALF - 0.6, WALK, false);
    col.solid(-hw, z0, hw, -HALF + 0.3, WALK, H).solid(-hw, HALF - 0.6, hw, z1, WALK, H).solid(-hw, -HALF + 0.3, hw, HALF - 0.6, WALK + 2.7, H);
    col.floor(-hw, z0, hw, z1, H).solid(-hw - 0.4, z0 - 0.4, hw + 0.4, z0, H, H + 1.8).solid(-hw - 0.4, z1, hw + 0.4, z1 + 0.4, H, H + 1.8)
      .solid(-hw - 0.4, z0, -hw, z1, H, H + 1.8).solid(hw, z0, hw + 0.4, z1, H, H + 1.8);
  });
}

/** one of the south gate's two tall round towers with their blue domes (ref 6) */
function gateTower(c: City, t: Tower, idx: number) {
  const b = c.b, R = GATE.towerR;
  c.b.group(() => {
    b.at(t.p[0], 0, t.p[1] + 1.5);
    const col = c.collide(`city/gate-tower-${idx}`);
    const y1 = 24;
    b.cylinder(0, 0, R + 0.6, -2, 3, 20, MAT.ASHLAR, { r1: R, top: null });
    b.cylinder(0, 0, R, 3, y1, 20, MAT.PLASTER, { r1: R - 0.35, top: null });
    for (const y of [3, WALK - 0.6, 19]) b.cylinder(0, 0, R + 0.12 - (y / y1) * 0.35, y, y + 0.35, 20, MAT.CREAM);
    // slit windows round it, lit at night
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2, r = R - 0.3;
      for (const y of [8, 15.5]) {
        const p: V3 = [Math.cos(a) * (r + 0.02), y, Math.sin(a) * (r + 0.02)];
        const tx = -Math.sin(a) * 0.22, tz = Math.cos(a) * 0.22, nx = Math.cos(a) * 0.04, nz = Math.sin(a) * 0.04;
        b.with({ glow: k % 2 ? 0.8 : 0 }, () => b.quad([p[0] - tx + nx, y, p[2] - tz + nz], [p[0] + tx + nx, y, p[2] + tz + nz], [p[0] + tx + nx, y + 1.8, p[2] + tz + nz], [p[0] - tx + nx, y + 1.8, p[2] - tz + nz], MAT.WINDOW));
      }
    }
    // the gallery: corbels, a floor, merlons round it
    b.cylinder(0, 0, R - 0.35, y1 - 1.2, y1, 20, MAT.CREAM, { r1: R + 1.0, top: null });
    b.cylinder(0, 0, R + 1.0, y1, y1 + 1.0, 24, MAT.PLASTER, { top: MAT.PAVING });
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2, r = R + 0.75;
      b.group(() => { b.at(Math.cos(a) * r, 0, Math.sin(a) * r, -a); b.box(-0.25, y1 + 1.0, -0.55, 0.25, y1 + 2.1, 0.55, MAT.PLASTER, { top: MAT.CREAM, skip: ['bottom'] }); });
    }
    // the drum with its arched lights and the dome
    const dr = R - 1.6, d0 = y1 + 1.0, d1 = d0 + 3.4;
    b.cylinder(0, 0, dr, d0, d1, 16, MAT.CREAM, { top: null });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      b.group(() => {
        b.at(Math.cos(a) * (dr + 0.02), 0, Math.sin(a) * (dr + 0.02), -a + Math.PI / 2);
        const f = new Face(b, [-0.55, 0], [0.55, 0], d0, 3);
        f.wall(MAT.CREAM, []);
        f.rect(0, 0.5, 1.1, 2.6, -0.02, MAT.WINDOW);
      });
    }
    const top = dome(c, 0, d1, 0, dr + 0.5, { drum: 0, bulge: 1.12, tip: 0.55, rise: (dr + 0.5) * 1.15, finial: true });
    c.light([0, d0 + 1.6, 0], 300, { radius: 18 });
    col.solid(-R * 0.9, -R * 0.9, R * 0.9, R * 0.9, -2, y1).floor(-R - 0.6, -R - 0.6, R + 0.6, R + 0.6, y1 + 1.0);
    col.solid(-dr, -dr, dr, dr, y1 + 1.0, top);
  });
}

/** the domed towers flanking the open north end where the grand stair begins */
function northTower(c: City, t: Tower, idx: number) {
  const b = c.b, R = 6;
  c.b.group(() => {
    b.at(t.p[0], 0, t.p[1]);
    const col = c.collide(`city/north-tower-${idx}`);
    const y1 = 22;
    b.cylinder(0, 0, R + 0.5, -2, 3, 8, MAT.ASHLAR, { r1: R, top: null });
    b.cylinder(0, 0, R, 3, y1, 8, MAT.PLASTER, { r1: R - 0.3, top: null });
    for (const y of [3, WALK - 0.6]) b.cylinder(0, 0, R + 0.1 - (y / y1) * 0.3, y, y + 0.35, 8, MAT.CREAM);
    b.cylinder(0, 0, R - 0.3, y1 - 1, y1, 8, MAT.CREAM, { r1: R + 0.7, top: null });
    b.cylinder(0, 0, R + 0.7, y1, y1 + 1.1, 8, MAT.PLASTER, { top: MAT.PAVING });
    for (let k = 0; k < 8; k++) {
      const a = ((k + 0.5) / 8) * Math.PI * 2, r = R + 0.4;
      b.group(() => { b.at(Math.cos(a) * r, 0, Math.sin(a) * r, -a); b.box(-0.3, y1 + 1.1, -0.9, 0.3, y1 + 2.2, 0.9, MAT.PLASTER, { top: MAT.CREAM, skip: ['bottom'] }); });
    }
    const top = dome(c, 0, y1 + 1.1, 0, R - 1.2, { drum: 2.2, bulge: 1.1, tip: 0.6, finial: true });
    brazier(c, 0, y1 + 1.1, R - 0.2, 1.1);
    col.solid(-R * 0.9, -R * 0.9, R * 0.9, R * 0.9, -2, y1).floor(-R - 0.7, -R - 0.7, R + 0.7, R + 0.7, y1 + 1.1).solid(-R + 1.2, -R + 1.2, R - 1.2, R - 1.2, y1 + 1.1, top);
  });
}

/** what spans between a gate's two towers: the south gatehouse with its arch, the open north end, or a postern */
function gateway(c: City, a: Tower, b: Tower) {
  if (a.kind === 'north') return;
  const L = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]);
  c.b.group(() => {
    frameAlong(c, a.p, b.p);
    const mid = c.b.xf([L / 2, 0, 0]), out = c.b.xd([0, 0, 1]);
    if ((mid[0] - WALL.cx) * out[0] + (mid[2] - WALL.cz) * out[2] < 0) c.b.at(L, 0, 0, Math.PI);
    if (a.kind === 'gate') southGate(c, L);
    else postern(c, L);
  });
}

/** the south gate between its towers (local x from tower to tower, z outward): a gatehouse over an open arch whose
 *  vault runs right through, its great doors swung back against the passage, a lavender panel with a gold diamond and
 *  a teal frieze over the arch, crenellations on top, braziers either side and banners */
function southGate(c: City, L: number) {
  const b = c.b, col = c.collide('city/south-gate');
  const half = GATE.width / 2, x0 = L / 2 - half, x1 = L / 2 + half;
  const d = 5.5, H = 24, crown = 9.5 + half;
  const warm: V3 = [1.04, 0.98, 0.96];
  b.with({ tint: warm }, () => {
    // the outer face carries the vault through to the inner face's open mouth
    new Face(b, [0, d], [L, d], -2, H + 2).wall(MAT.PLASTER_WARM, [{ u0: x0, u1: x1, v0: 2, top: crown + 2, arch: 'round', depth: 2 * d, fill: null, frame: MAT.CREAM, frameW: 1.0 }]);
    new Face(b, [L, -d], [0, -d], -2, H + 2).wall(MAT.PLASTER_WARM, [{ u0: L - x1, u1: L - x0, v0: 2, top: crown + 2, arch: 'round', depth: 0, fill: null, frame: MAT.CREAM, frameW: 0.8 }]);
  });
  b.box(0, H, -d, L, H + 0.3, d, MAT.CREAM);
  // the panel over the arch, its diamond, the frieze
  const fo = new Face(b, [0, d], [L, d], 0, H);
  fo.box(x0 + 2.2, crown + 1.6, x1 - 2.2, H - 2.4, -0.12, 0, MAT.LAVENDER, { skip: ['bottom'] });
  const cx = L / 2, cy = (crown + 1.6 + H - 2.4) / 2, r = 1.7;
  b.poly([fo.at(cx, cy - r, -0.16), fo.at(cx + r, cy, -0.16), fo.at(cx, cy + r, -0.16), fo.at(cx - r, cy, -0.16)], MAT.GOLD);
  fo.box(0.5, H - 2.1, L - 0.5, H - 0.9, -0.1, 0, MAT.TEAL);
  for (let u = 1.2; u < L - 1.2; u += 1.4) {
    b.poly([fo.at(u - 0.5, H - 2.0, -0.13), fo.at(u - 0.3, H - 2.0, -0.13), fo.at(u + 0.5, H - 1.0, -0.13), fo.at(u + 0.3, H - 1.0, -0.13)], MAT.CREAM);
    b.poly([fo.at(u + 0.3, H - 2.0, -0.13), fo.at(u + 0.5, H - 2.0, -0.13), fo.at(u - 0.3, H - 1.0, -0.13), fo.at(u - 0.5, H - 1.0, -0.13)], MAT.CREAM);
  }
  for (const u of [x0 + 1.2, x1 - 1.2]) banner(c, fo, u, H - 2.6, 1.6, 9, CLOTHS[3]);
  // the parapet and merlons on top
  for (const [l, rr] of [[[0, d], [L, d]], [[L, -d], [0, -d]]] as [V2, V2][]) {
    const f = new Face(b, l, rr, H + 0.3, 1.0);
    f.box(0, 0, f.len, 0.9, 0, 0.5, MAT.PLASTER_WARM, { back: true, top: MAT.CREAM, skip: ['bottom', 'left', 'right'] });
    merlons(f, 0.8, f.len - 0.8, 0.9, 1.1, 1.0, 0.8, 0.5, MAT.PLASTER_WARM);
  }
  // the doors, swung back against the passage
  for (const s of [-1, 1] as const) {
    const x = s < 0 ? x0 : x1 - 0.45;
    b.box(x, 0, -d + 0.4, x + 0.45, crown - half - 0.3, -d + 0.4 + half - 0.2, MAT.WOOD, { skip: ['bottom'] });
    for (const y of [1.5, 4.5, 7.5]) b.box(s < 0 ? x + 0.45 : x - 0.04, y, -d + 0.5, s < 0 ? x + 0.49 : x, y + 0.3, -d + half, MAT.GOLD, { skip: ['bottom', 'top'] });
    col.solid(x, -d + 0.4, x + 0.45, -d + 0.4 + half - 0.2, 0, crown - half);
  }
  // fire either side of the gate, inside and out
  for (const z of [d + 3.5, -d - 3.5]) for (const x of [x0 + 1.6, x1 - 1.6]) { brazier(c, x, 0, z, 1.25); col.solid(x - 0.45, z - 0.45, x + 0.45, z + 0.45, 0, 1.6); }
  col.solid(0, -d, x0, d, -2, H).solid(x1, -d, L, d, -2, H).solid(x0, -d, x1, d, crown, H).floor(0, -d, L, d, H + 0.3)
    .solid(0, d - 0.5, L, d, H + 0.3, H + 2.2).solid(0, -d, L, -d + 0.5, H + 0.3, H + 2.2);
}

/** a postern: a short gatehouse over an 8 m arch between two square towers */
function postern(c: City, L: number) {
  const b = c.b, col = c.collide('city/postern');
  const half = 4, x0 = L / 2 - half, x1 = L / 2 + half, d = HALF + 0.5, H = WALK + 1.2, crown = 9.5;
  for (const [l, r] of [[[0, d], [L, d]], [[L, -d], [0, -d]]] as [V2, V2][]) {
    const f = new Face(b, l, r, -2, H + 2);
    const u0 = l[0] < r[0] ? x0 : L - x1, u1 = l[0] < r[0] ? x1 : L - x0;
    f.wall(MAT.PLASTER, [{ u0, u1, v0: 2, top: crown + 2, arch: 'round', depth: 2 * d, fill: MAT.INTERIOR, frame: MAT.CREAM, frameW: 0.5 }]);
  }
  b.box(0, H, -d, L, H + 0.25, d, MAT.CREAM);
  const fo = new Face(b, [0, d], [L, d], H + 0.25, 1.2);
  merlons(fo, 0.8, L - 0.8, 0, 1.0, 1.1, 0.8, 0.8, MAT.PLASTER);
  col.solid(0, -d, x0, d, -2, H).solid(x1, -d, L, d, -2, H).solid(x0, -d, x1, d, crown, H).floor(0, -d, L, d, H + 0.25);
  banner(c, fo, L / 2, -0.6, 1.4, 4.5, CLOTHS[3]);
}
