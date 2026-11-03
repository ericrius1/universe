// The cliff dwellings cut into the plateau's rock (ref 5): carved frontages set back into recesses in a rock face, each
// a few storeys of door, windows (lit at night) and balconies between pilasters under a cornice. In the stair's notch
// their face is its west wall (from north of L4 to the mouth): a frontage beside each of L1–L4, a bridge from the
// landing to its door (the stair's), the girls' room in the one at L2 (room/: the lowest storey is hers, its window and
// loggia in the face; the frontage stands over it). Round the plateau's edge in each slab sector (plateauFaces) the
// rock skin steps down to the ring road: an upper face from the plateau's top to a ledge path, a lower face from the
// ledge to the ring road, a row of frontages on each — their doors on the ring road and on the ledge — a flight down
// from the ledge, a parapet along each edge, a domed kiosk on the plateau's top where the sector's gold inlay ends.
// Every face hides a step in the carved ground behind it (plan.ts havenGround, HIDE); the caverns' portal cuts the
// south-south-west sector's skin (theirs). Lamps and finials are the parts library's, placed instanced.
import { PROUD } from '../arch/builder';
import { MAT, type Mat, type V3 } from '../arch/types';
import { domePart } from '../arch/parts';
import { CAVERNS, FLOOR_Y, NOTCH, type V2 } from '../world/layout';
import { Frame, type Haul } from './colliders';
import {
  C, CAUSEWAY_H, DEG, HIDE, LANDINGS, RECESS, LANDING_DOORS, NOTCH_DWELL, R_SKIN, ROOM_BOX, SKIN, TOP, WEDGES, notchFloor, reach, rng,
  type Wedge,
} from './plan';
import { pt, type Shapes } from './shapes';

const STOREY = 5.2;
/** the parapets along the faces' tops over the plateau's top (level with the courts' end walls' and the causeways'
 *  cuttings'), and along the ledge's edge */
export const PAR = 1.6;
const LEDGE_PAR = 1.0;

/** a carved frontage on a rock face (ref 5): centred at p on its recess's back, facing n (unit, out of the rock), w wide
 *  and H tall from y0: a warm dressed face between tall pilasters under an entablature and a stepped crest, a tall
 *  portal with a pointed head in the middle (a closed door below, a lancet window lit at night above), tall slit
 *  windows with pointed heads either side, now and then a balcony across the portal. Its pieces' backs on the recess's
 *  back are left off (they were all one plane, fighting) */
function frontage(s: Shapes, p: V2, n: V2, w: number, y0: number, H: number, seed: number, door = true) {
  const b = s.b, rnd = rng(seed);
  const t: V2 = [-n[1], n[0]], along = Math.atan2(t[1], t[0]);
  const at = (u: number, v: number): V2 => [p[0] + t[0] * u + n[0] * v, p[1] + t[1] * u + n[1] * v];
  const P = (u: number, y: number, v: number): V3 => { const q = at(u, v); return [q[0], y, q[1]]; };
  const out: V3 = [n[0], 0, n[1]];
  const box = (u0: number, u1: number, y1: number, y2: number, v: number, mat: Mat, skip: string[] = ['bottom']) => {
    const c = at((u0 + u1) / 2, v / 2);
    s.obox(c[0], c[1], along, (u1 - u0) / 2, Math.max(0.01, v / 2), y1, y2, mat, { skip: [...skip, 's'] });
  };
  /** a pointed head on [u0, u1] springing at y, standing proud by v */
  const head = (u0: number, u1: number, y: number, v: number, mat: Mat) => s.face([P(u0, y, v), P(u1, y, v), P((u0 + u1) / 2, y + (u1 - u0) * 0.75, v)], mat, out);
  const top = y0 + H;
  // (the dressed face between the pilasters' inner halves: its ends hidden in them)
  // (it and the pilasters under the entablature: their tops left off, they were one plane under it)
  b.with({ tint: [1.0 + (rnd() - 0.5) * 0.06, 0.97, 0.95] }, () => box(-w / 2 + 0.3, w / 2 - 0.3, y0, top - 0.5, 0.15, MAT.PLASTER_WARM, ['bottom', 'top']));
  // the edge pilasters, their bases and capitals, the entablature and a stepped crest over the middle
  for (const sg of [-1, 1]) {
    const u = sg * (w / 2 - 0.45);
    box(u - 0.45, u + 0.45, y0, top - 0.9, 0.55, MAT.ASHLAR, ['bottom', 'top']);
    box(u - 0.6, u + 0.6, y0, y0 + 0.8, 0.7, MAT.CREAM);
    box(u - 0.6, u + 0.6, top - 0.9, top - 0.5, 0.7, MAT.CREAM);
  }
  box(-w / 2 - 0.4, w / 2 + 0.4, top - 0.5, top + 0.3, 0.85, MAT.CREAM, []);
  box(-w * 0.22, w * 0.22, top + 0.3, top + 1.0, 0.7, MAT.CREAM, []);
  box(-w * 0.1, w * 0.1, top + 1.0, top + 1.6, 0.6, MAT.CREAM, []);
  // the portal: a frame with a pointed head, the door, the lancet window over it
  const pw = Math.min(3.0, w * 0.3), ph = H - 3.2;
  box(-pw / 2 - 0.5, pw / 2 + 0.5, y0, y0 + ph, 0.45, MAT.ASHLAR);
  head(-pw / 2 - 0.5, pw / 2 + 0.5, y0 + ph, 0.45, MAT.ASHLAR);
  b.with({ ao: 0.5 }, () => box(-pw / 2, pw / 2, y0, y0 + 3.8, 0.5, door ? MAT.INTERIOR : MAT.PLASTER_WARM));
  box(-pw / 2 - 0.2, pw / 2 + 0.2, y0 + 3.8, y0 + 4.3, 0.62, MAT.CREAM, []);
  // (a lancet over the door where the portal's tall enough for one)
  const lit = rnd() < 0.7 ? 0.9 : 0;
  if (ph - 0.3 > y0 + 4.9 - y0 + 0.6) b.with({ glow: lit, ao: 0.8 }, () => {
    box(-pw / 2 + 0.25, pw / 2 - 0.25, y0 + 4.9, y0 + ph - 0.3, 0.5, MAT.WINDOW);
    head(-pw / 2 + 0.25, pw / 2 - 0.25, y0 + ph - 0.3, 0.5, MAT.WINDOW);
  });
  if (door) { const q = at(pw / 2 + 1.0, 0.15 + PROUD); b.place('lantern-wall', [q[0], y0 + 2.6, q[1]], { yaw: Math.atan2(n[0], n[1]) }); }
  // slit windows either side between thin pilasters
  const side = w / 2 - 0.9 - (pw / 2 + 0.5);
  const k = Math.max(1, Math.floor(side / 1.6));
  for (const sg of [-1, 1]) for (let i = 0; i < k; i++) {
    const u = sg * (pw / 2 + 0.5 + (side * (i + 0.5)) / k);
    const lit = rnd() < 0.55 ? 0.85 : 0;
    box(u - 0.45, u + 0.45, y0 + 1.2, top - 2.0, 0.3, MAT.ASHLAR);
    head(u - 0.45, u + 0.45, top - 2.0, 0.3, MAT.ASHLAR);
    b.with({ glow: lit, ao: 0.8 }, () => { box(u - 0.25, u + 0.25, y0 + 1.6, top - 2.3, 0.34, MAT.WINDOW); head(u - 0.25, u + 0.25, top - 2.3, 0.34, MAT.WINDOW); });
  }
  if (H > 10 && rnd() < 0.5) balcony(s, at, along, 0, y0 + 4.6);
}

/** a little balcony on corbels with a balustrade, before a window */
function balcony(s: Shapes, at: (u: number, v: number) => V2, along: number, u: number, ys: number) {
  const c = at(u, 0.75), y = ys + 0.9;
  s.obox(c[0], c[1], along, 1.6, 0.75, y - 0.3, y, MAT.CREAM, { skip: ['s'] });
  for (const e of [-1.2, 1.2]) { const k = at(u + e, 0.55); s.obox(k[0], k[1], along, 0.2, 0.55, y - 1.1, y - 0.3, MAT.ASHLAR, { skip: ['bottom', 's'] }); }
  s.balustrade(at(u - 1.5, 1.3), at(u + 1.5, 1.3), y, MAT.CREAM, MAT.CREAM, 0.9, 0.36);
}

/** the strata's ledges on the rock faces: how far they stand out, how deep */
const LEDGE = { out: 0.35, h: 0.4 };

/** a frontage's recess cut into a face: its span along the face (u0..u1), up it (y0..y1) */
interface Hole { u0: number; u1: number; y0: number; y1: number; recess: boolean }

/** a rock face along a path (its points' u: metres along it), facing the right of travel, from bottom (per point) to top
 *  (per point), with holes cut in it; each hole with a recess cut RECESS deep behind it (its sides, its soffit, its
 *  floor, its back) unless another builder fills it (the girls' room). The path is split at every hole's edge */
function holedFace(s: Shapes, path: V2[], bottom: (u: number) => number, top: (u: number) => number, holes: Hole[], mat: Mat, ledges: number[] = [], noLedge: [number, number][] = []) {
  const L: number[] = [0];
  for (let i = 1; i < path.length; i++) L.push(L[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const total = L[L.length - 1];
  const at = (u: number): V2 => {
    let i = 1;
    while (i < L.length - 1 && L[i] < u) i++;
    const t = (u - L[i - 1]) / Math.max(1e-9, L[i] - L[i - 1]);
    return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t];
  };
  const cuts = new Set<number>(L);
  for (const h of holes) { cuts.add(Math.max(0, h.u0)); cuts.add(Math.min(total, h.u1)); }
  const us = [...cuts].filter((u) => u >= 0 && u <= total).sort((p, q) => p - q);
  for (let i = 0; i + 1 < us.length; i++) {
    const ua = us[i], ub = us[i + 1];
    if (ub - ua < 1e-4) continue;
    const seg = [at(ua), at(ub)], m = (ua + ub) / 2, hs = holes.filter((q) => m > q.u0 && m < q.u1).sort((p, q) => p.y0 - q.y0);
    // (the face between the holes over this stretch, one over another: the frontage over the girls' room's box)
    let y: number[] = [bottom(ua), bottom(ub)];
    for (const h of hs) { if (h.y0 > Math.min(...y) + 1e-3) s.strip(seg, y, [h.y0, h.y0], mat, true); y = [h.y1, h.y1]; }
    s.strip(seg, y, [top(ua), top(ub)], mat, true);
  }
  // ledges along the strata (a band of rock standing out, broken by the recesses)
  for (const y of ledges) {
    for (let i = 0; i + 1 < us.length; i++) {
      const ua = us[i], ub = us[i + 1], m = (ua + ub) / 2;
      if (ub - ua < 1e-4 || y < Math.max(bottom(ua), bottom(ub)) + 0.6 || y > Math.min(top(ua), top(ub)) - 0.8) continue;
      if (holes.some((h) => m > h.u0 && m < h.u1 && y > h.y0 - 0.2 && y - LEDGE.h < h.y1 + 0.2) || noLedge.some(([p, q]) => m > p && m < q)) continue;
      const a = at(ua), z = at(ub), d = [z[0] - a[0], z[1] - a[1]], l = Math.hypot(d[0], d[1]);
      const o: V2 = [-d[1] / l * LEDGE.out, d[0] / l * LEDGE.out], A: V2 = [a[0] + o[0], a[1] + o[1]], Z: V2 = [z[0] + o[0], z[1] + o[1]];
      s.strip([A, Z], y - LEDGE.h, y, mat, true);
      s.flat([a, z], [A, Z], y, y, mat).flat([a, z], [A, Z], y - LEDGE.h, y - LEDGE.h, mat, true);
    }
  }
  // the recesses: sides, soffit, floor and back (into the rock: left of travel)
  for (const h of holes) {
    if (!h.recess) continue;
    const a = at(Math.max(0, h.u0)), z = at(Math.min(total, h.u1)), d = [z[0] - a[0], z[1] - a[1]], l = Math.hypot(d[0], d[1]);
    const inn: V2 = [d[1] / l, -d[0] / l];
    const back = (q: V2): V2 => [q[0] + inn[0] * RECESS, q[1] + inn[1] * RECESS];
    s.strip([a, back(a)], h.y0, h.y1, MAT.ROCK, true);
    s.strip([back(z), z], h.y0, h.y1, MAT.ROCK, true);
    s.strip([back(a), back(z)], h.y0, h.y1, MAT.ROCK, true);
    s.flat([back(a), back(z)], [a, z], h.y1, h.y1, MAT.ROCK, true);
    s.flat([back(a), back(z)], [a, z], h.y0, h.y0, MAT.PAVING);
  }
}

export function buildDwellings(s: Shapes, haul: Haul) {
  notchWall(s, haul);
  for (const wd of WEDGES) if (wd.kind === 'top') plateauFace(s, haul, wd);
}

// ------------------------------------------------------------------------------------------------- the notch's wall

/** a door's bridge from its landing: half its width */
export const DOOR_BRIDGE_HALF = 1.4;
/** the dwellings' doors in the notch's west wall beside L1–L4: the landing, which wall, the frontage's height and where
 *  it stands from (its door's sill: the landing's walk; at L2 the frontage stands over the girls' room, whose loggia
 *  is the door, a step up), the door's z and sill. Each has its bridge from the landing (the stair's), and the
 *  landing's balustrade opens onto it */
export function landingDoors(): { i: number; side: 'east' | 'west'; room: number; y0: number; z: number; sill: number }[] {
  const out: ReturnType<typeof landingDoors> = [];
  for (const [i, side, storeys] of LANDING_DOORS) {
    const [, lz, ly] = LANDINGS[i];
    const girls = lz === ROOM_BOX.zc;
    const y0 = girls ? ROOM_BOX.y1 + PROOF : ly;
    const room = Math.min(storeys * STOREY - (girls ? y0 - ly : 0), TOP - y0 - 2.5);
    if (room >= 7) out.push({ i, side, room, y0, z: girls ? ROOM_BOX.door : lz, sill: girls ? ROOM_BOX.floor : ly });
  }
  return out;
}
/** (a hand's breadth over the room's box: the frontage over the girls' room clear of it) */
const PROOF = 0.05;

/** the notch's west wall from north of L4 to the plateau's skin: a rock face rising from the ravine's floor to a parapet
 *  over the plateau's top (stepping down to the ledge path's as it meets the skin), a recess cut for each landing's
 *  frontage and the girls' room's box left open (the room fills it) */
function notchWall(s: Shapes, haul: Haul) {
  const x = C[0] - NOTCH.half, z0 = NOTCH_DWELL.z0;
  const zU = C[1] + Math.sqrt(SKIN.upper ** 2 - NOTCH.half ** 2), zL = C[1] + Math.sqrt(SKIN.lower ** 2 - NOTCH.half ** 2);
  const W = 13;
  const doors = landingDoors();
  const holes: Hole[] = doors.map((d) => {
    const zc = LANDINGS[d.i][1];
    return { u0: zc - z0 - W / 2 - 0.55, u1: zc - z0 + W / 2 + 0.55, y0: d.y0, y1: d.y0 + d.room + 1.7, recess: true };
  });
  // more frontages high in the face between the landings' (windows over the ravine, a balcony now and then)
  const high: { z: number; y0: number; H: number; w: number }[] = [];
  for (let k = 0; k + 1 < doors.length; k++) {
    const za = LANDINGS[doors[k].i][1], zb = LANDINGS[doors[k + 1].i][1], z = (za + zb) / 2, y0 = Math.max(notchFloor(z) + 7, (doors[k].y0 + doors[k + 1].y0) / 2 + 4);
    const H = Math.min(11, TOP - 2.5 - y0);
    if (H >= 7 && Math.abs(zb - za) > W + 12) high.push({ z, y0, H, w: 9.5 });
  }
  for (const f of high) holes.push({ u0: f.z - z0 - f.w / 2 - 0.55, u1: f.z - z0 + f.w / 2 + 0.55, y0: f.y0, y1: f.y0 + f.H + 1.7, recess: true });
  holes.push({ u0: ROOM_BOX.z0 - z0, u1: ROOM_BOX.z1 - z0, y0: ROOM_BOX.y0, y1: ROOM_BOX.y1, recess: false });
  // (the face along +z looks east, into the notch: travel north to south has it on the left, so run it south to north;
  // a station either side of where it steps down at the skin)
  const len = zL - z0, zs = new Set<number>([zL, zU + 0.001, zU - 0.001, z0]);
  for (let z = z0; z < zL; z += 2) zs.add(z);
  const path: V2[] = [...zs].sort((p, q) => q - p).map((z) => [x, z]);
  const zOf = (u: number) => zL - u;
  const topAt = (z: number) => (z < zU ? TOP + PAR : SKIN.ledge + LEDGE_PAR);
  // (holes measured from the north: mirrored for the path run from the south)
  const flipped = holes.map((h) => ({ ...h, u0: zL - z0 - h.u1, u1: zL - z0 - h.u0 }));
  holedFace(s, path, (u) => notchFloor(zOf(u)) - 1, (u) => topAt(zOf(u)), flipped, MAT.ROCK);
  void len;
  // the parapet's body along the top, its inner face and coping (over the plateau's top, then the ledge's)
  const xi = x - RECESS - 2 * HIDE;
  for (const [za, zb, y] of [[z0, zU, TOP + PAR], [zU, zL, SKIN.ledge + LEDGE_PAR]] as [number, number, number][]) {
    const base = (za === z0 ? TOP : SKIN.ledge) - 0.3;
    s.strip([[xi, za], [xi, zb]], base, y - 0.12, MAT.PLASTER, true).strip([[xi, za], [xi, zb]], y - 0.12, y, MAT.CREAM, true);
    s.flat([[x, za], [x, zb]], [[xi, za], [xi, zb]], y, y, MAT.CREAM);
  }
  // (where it steps down at the skin, the step's face; at its north end, its end on the plateau's top)
  s.strip([[x, zU], [xi, zU]], SKIN.ledge + LEDGE_PAR, TOP + PAR, MAT.ROCK, true);
  s.strip([[xi, z0], [x, z0]], TOP - 0.3, TOP + PAR, MAT.ROCK, true);
  // the roof terrace over the girls' room's dwelling (the rock dug out under it for her room): paving out over the dig's
  // edges, two planters of flowers, a bench looking out over the notch
  const R = ROOM_BOX, rx0 = R.x0 - 2 * HIDE, rz0 = R.z0 - 2 * HIDE, rz1 = R.z1 + 2 * HIDE;
  s.slab([[rx0, rz0], [xi, rz0], [xi, rz1], [rx0, rz1]], TOP + PROUD, MAT.PAVING);
  for (const zz of [rz0 + 1.6, rz1 - 1.6]) {
    const c: V2 = [(rx0 + xi) / 2, zz], hw = (xi - rx0) / 2 - 0.6;
    s.obox(c[0], c[1], 0, hw, 0.6, TOP + PROUD, TOP + 0.6, MAT.PLASTER, { top: MAT.SOIL, skip: ['bottom'] });
    haul.beds.push({ poly: [[c[0] - hw + 0.1, zz - 0.5], [c[0] + hw - 0.1, zz - 0.5], [c[0] + hw - 0.1, zz + 0.5], [c[0] - hw + 0.1, zz + 0.5]], y: TOP + 0.6, kind: 'flowers', density: 0.9, palette: 'pink' });
  }
  s.bench(xi - 1.0, (rz0 + rz1) / 2, Math.PI / 2, TOP + PROUD, MAT.CREAM, 2.4);
  // the frontages in their recesses (the one at L2 over the girls' room)
  for (const d of doors) {
    const zc = LANDINGS[d.i][1];
    frontage(s, [x - RECESS, zc], [1, 0], W, d.y0, d.room, d.i * 13 + 1, d.y0 === d.sill);
  }
  high.forEach((f, k) => frontage(s, [x - RECESS, f.z], [1, 0], f.w, f.y0, f.H, 77 + k, false));
  // its collider: the face and the parapet solid, each recess's floor (its door's threshold)
  const F = new Frame('haven.dwelling.notch', x, z0, Math.PI / 2);
  // (plan x along +z, y across toward larger angles: -world x, into the rock)
  for (const [za, zb, y] of [[z0, zU, TOP + PAR], [zU, zL, SKIN.ledge + LEDGE_PAR]] as [number, number, number][]) {
    F.solid(za - z0, 0, zb - z0, x - xi, notchFloor(za) - 2, y);
  }
  for (const d of doors) {
    const zc = LANDINGS[d.i][1];
    F.floor(d.z - z0 - DOOR_BRIDGE_HALF, -0.1, d.z - z0 + DOOR_BRIDGE_HALF, RECESS - 0.5, d.sill);
    if (d.y0 === d.sill) F.solid(zc - z0 - W / 2, RECESS - 0.5, zc - z0 + W / 2, RECESS + 1, d.y0 - 1, d.y0 + d.room);
  }
  haul.colliders.push(F.done());
}

// ------------------------------------------------------------------------------------------------- the plateau's skin

/** a slab sector's edge over the ring road (see the header) */
function plateauFace(s: Shapes, haul: Haul, wd: Wedge) {
  const b = s.b, rnd = rng(wd.i, 29);
  // its angular reach on each face (to the causeways' and the notch's lines), less the caverns' portal
  const pu = wd.am + Math.atan2(Math.sin(CAVERNS.portal.angle * DEG - wd.am), Math.cos(CAVERNS.portal.angle * DEG - wd.am));
  const span = (r: number): [number, number][] => {
    const [lo, hi] = reach(wd, r), g = Math.asin(PORTAL_HALF / r);
    return pu - g > lo && pu + g < hi ? [[lo, pu - g], [pu + g, hi]] : [[lo, hi]];
  };
  const arcPts = (r: number, a0: number, a1: number): V2[] => {
    const n = Math.max(1, Math.ceil((Math.abs(a1 - a0) * r) / 2));
    return Array.from({ length: n + 1 }, (_, k) => pt(r, a0 + ((a1 - a0) * k) / n));
  };
  // the flight down from the ledge at the sector's hi end, in a frame on the lower face (t along it toward smaller
  // angles, n out of it): a platform through the ledge's parapet, the flight on from it to the ring road's level
  const lower = span(SKIN.lower), aTop = lower[lower.length - 1][1] - 3.5 / SKIN.lower;
  const O = pt(SKIN.lower, aTop), T: V2 = [Math.sin(aTop), -Math.cos(aTop)], N: V2 = [Math.cos(aTop), Math.sin(aTop)];
  const F_ = { w: 2.8, plat: 1.6, run: 26 };
  const on = (t: number, n: number): V2 => [O[0] + T[0] * t + N[0] * n, O[1] + T[1] * t + N[1] * n];
  const gap = (a: number) => Math.abs(a - aTop) * SKIN.lower < F_.plat - 0.1;
  // the rows of frontages: four on each face, spread over the sector (clear of the portal and the flight)
  const rows = [
    { r: SKIN.lower, y0: FLOOR_Y + PROOF, H: 9.4, foot: FLOOR_Y - 0.6, top: SKIN.ledge + LEDGE_PAR, th: 0.6, base: SKIN.ledge },
    { r: SKIN.upper, y0: SKIN.ledge + PROOF, H: 10.8 + 2.4 * rnd(), foot: SKIN.ledge - 0.3, top: TOP + PAR, th: 1.6, base: TOP - 0.3 },
  ];
  for (const [k, row] of rows.entries()) {
    const spans = span(row.r);
    for (const [a0, a1] of spans) {
      const last = a1 === spans[spans.length - 1][1];
      const end = k === 0 && last ? aTop - (F_.run + F_.plat + 3) / row.r : a1;
      const fronts: { a: number; w: number }[] = [], holes: Hole[] = [];
      const m = Math.min(4, Math.max(1, Math.floor(((end - a0) * row.r) / 30)));
      for (let j = 0; j < m; j++) {
        const a = a0 + ((end - a0) * (j + 0.5)) / m, w = 10 + ((j + k + wd.i) % 3) * 1.5;
        if (((end - a0) * row.r) / m < w + 5) continue;
        fronts.push({ a, w });
        const u = (a - a0) * row.r;
        holes.push({ u0: u - w / 2 - 0.55, u1: u + w / 2 + 0.55, y0: row.y0, y1: row.y0 + row.H + 1.7, recess: true });
      }
      // (the ledge's way onto the flight: a gap in the lower face's top and its parapet)
      if (k === 0 && last) { const u = (aTop - a0) * row.r; holes.push({ u0: u - F_.plat, u1: u + F_.plat, y0: SKIN.ledge, y1: row.top, recess: false }); }
      // (along increasing angle the outward face is on the left: run it from a1 back to a0)
      const L = (a1 - a0) * row.r;
      // (no ledge where the flight runs down along the lower face)
      const flightU: [number, number][] = k === 0 && last ? [[L - (aTop - a0) * row.r - F_.plat - 0.5, L - (aTop - a0) * row.r + F_.plat + F_.run + 1.5]] : [];
      holedFace(s, arcPts(row.r, a1, a0), () => row.foot, () => row.top, holes.map((h) => ({ ...h, u0: L - h.u1, u1: L - h.u0 })), MAT.ROCK, k === 0 ? [4.6, 9.4] : [19.2, 25.4], flightU);
      for (const [j, f] of fronts.entries()) frontage(s, pt(row.r - RECESS, f.a), [Math.cos(f.a), Math.sin(f.a)], f.w, row.y0, row.H, wd.i * 100 + k * 10 + j);
      // the parapet along the face's top, broken at the flight (its body and, behind the upper one, a paved walk hide the
      // step in the ground behind the face's recesses)
      const runs: [number, number][] = k === 0 && last ? [[a0, aTop - F_.plat / row.r], [aTop + F_.plat / row.r, a1]] : [[a0, a1]];
      for (const [p0, p1] of runs) {
        if (p1 <= p0) continue;
        const inner = arcPts(row.r - row.th, p0, p1), outer = arcPts(row.r, p0, p1), y = row.top;
        s.strip(inner, row.base, y - 0.12, MAT.PLASTER, true).strip(inner, y - 0.12, y, MAT.CREAM, true);
        s.flat(inner, outer, y, y, MAT.CREAM);
        if (k === 1) {
          // (its own reach at its radius: the notch's line isn't a radius)
          const rw = row.r - row.th - WALKWAY, [q0, q1] = reach(wd, rw), w0 = Math.max(p0, q0), w1 = Math.min(p1, q1);
          s.flat(arcPts(rw, w0, w1), arcPts(row.r - row.th, w0, w1), TOP + PROUD, TOP + PROUD, MAT.PAVING);
        }
        // (its ends over the portal's alcove and at the flight's gap)
        for (const [e, sg] of [[p0, 1], [p1, -1]] as [number, number][]) {
          if (Math.abs(e - pu) * row.r > PORTAL_HALF + 1 && !(k === 0 && last && Math.abs(e - aTop) * row.r < F_.plat + 0.1)) continue;
          s.strip(sg > 0 ? [pt(row.r - row.th, e), pt(row.r, e)] : [pt(row.r, e), pt(row.r - row.th, e)], row.base, y, MAT.ROCK, true);
        }
      }
    }
  }
  // the ledge path between the faces (out under the lower parapet's body at the flight's gap)
  for (const [a0, a1] of span(SKIN.upper)) {
    const inner = arcPts(SKIN.upper, a0, a1), outer = arcPts(SKIN.lower - 0.6, a0, a1);
    s.flat(outer, inner, SKIN.ledge + PROUD, SKIN.ledge + PROUD, MAT.PAVING);
  }
  s.flat(arcPts(SKIN.lower, aTop - F_.plat / SKIN.lower, aTop + F_.plat / SKIN.lower), arcPts(SKIN.lower - 0.6, aTop - F_.plat / SKIN.lower, aTop + F_.plat / SKIN.lower), SKIN.ledge + PROUD, SKIN.ledge + PROUD, MAT.PAVING);
  // the platform and the flight, a parapet on the flight's open side and round the platform, a lamp at its foot
  const pc = on(0, PROOF + F_.w / 2);
  s.obox(pc[0], pc[1], Math.atan2(T[1], T[0]), F_.plat, F_.w / 2, FLOOR_Y - 0.4, SKIN.ledge + PROUD, MAT.PLASTER, { top: MAT.PAVING, skip: ['bottom'] });
  const steps = Math.round((SKIN.ledge - FLOOR_Y) / 0.16), top = on(F_.plat, PROOF + F_.w / 2), foot = on(F_.plat + F_.run, PROOF + F_.w / 2);
  b.with({ tint: [1.02, 0.97, 0.95] }, () => b.stairs(foot[0], FLOOR_Y + PROOF, foot[1], top[0], SKIN.ledge + PROUD - PROUD, top[1], F_.w, steps, MAT.ASHLAR, { side: MAT.PLASTER, foot: FLOOR_Y - 0.4 }));
  const pw = PROOF + F_.w - 0.15 - PROUD;
  // (its foot's end PROUD up the flight: it lay in the first riser's plane)
  slope(s, on(F_.plat + F_.run - PROUD, pw), on(F_.plat, pw), FLOOR_Y + PROOF - 0.2, SKIN.ledge - 0.2, true);
  slope(s, on(F_.plat, pw), on(-F_.plat + 0.15, pw), SKIN.ledge - 0.2, SKIN.ledge - 0.2, false);
  const lp = on(F_.plat + F_.run - 0.5, PROOF + 0.4);
  b.place('lantern-post', [lp[0], FLOOR_Y + PROOF, lp[1]], { yaw: Math.atan2(N[0], N[1]) });
  // the kerbs along the causeways' cuttings, on from the terraces' to the upper face's parapet
  for (const [sd, sg] of [[wd.lo, -1], [wd.hi, 1]] as const) {
    if (sd.kind !== 'ramp') continue;
    const g = sg < 0 ? wd.w.a0 - 4 * DEG : wd.w.a1 + 4 * DEG, ga = wd.am + Math.atan2(Math.sin(g - wd.am), Math.cos(g - wd.am));
    const edge = (o: number) => [R_SKIN, SKIN.upper - 1.6].map((r) => pt(r, ga - sg * Math.asin(o / r)));
    // (the wedge's side of the kerb is left of outward travel on its hi side, right of it on its lo side)
    if (sg > 0) s.flat(edge(CAUSEWAY_H + KERB_W), edge(CAUSEWAY_H), TOP + PROUD, TOP + PROUD, MAT.PAVING);
    else s.flat(edge(CAUSEWAY_H), edge(CAUSEWAY_H + KERB_W), TOP + PROUD, TOP + PROUD, MAT.PAVING);
  }
  plateauCollider(haul, wd, span, O, T, N, F_);
}

/** the kerb along a causeway's cutting (plan.ts KERB), the caverns' portal's half-width, the paved walk behind the upper
 *  face's parapet */
const KERB_W = 1.6;
const WALKWAY = 1.8;
const PORTAL_HALF = 8;

/** a sloped parapet from p to q (its outer face to the right of travel), its foot from y0 to y1, 1.2 tall, 0.3 thick;
 *  its start's end face (its last's runs on into the next) */
function slope(s: Shapes, p: V2, q: V2, y0: number, y1: number, startEnd: boolean) {
  const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz), nx = (-dz / L) * 0.15, nz = (dx / L) * 0.15, h = 1.2;
  const R0: V2 = [p[0] + nx, p[1] + nz], R1: V2 = [q[0] + nx, q[1] + nz], L0: V2 = [p[0] - nx, p[1] - nz], L1: V2 = [q[0] - nx, q[1] - nz];
  s.strip([R0, R1], [y0, y1], [y0 + h - 0.1, y1 + h - 0.1], MAT.PLASTER, true).strip([R0, R1], [y0 + h - 0.1, y1 + h - 0.1], [y0 + h, y1 + h], MAT.CREAM, true);
  s.strip([L0, L1], [y0, y1], [y0 + h - 0.1, y1 + h - 0.1], MAT.PLASTER, false).strip([L0, L1], [y0 + h - 0.1, y1 + h - 0.1], [y0 + h, y1 + h], MAT.CREAM, false);
  s.flat([L0, L1], [R0, R1], [y0 + h, y1 + h], [y0 + h, y1 + h], MAT.CREAM);
  if (startEnd) s.strip([L0, R0], y0, y0 + h, MAT.CREAM, true);
}

/** a little domed kiosk (a chhatri) on the plateau's top: a stepped plinth, four columns, an entablature, a ribbed dome
 *  of gold on a low drum (the parts library's), a finial */
export function kiosk(s: Shapes, c: V2, a: number) {
  const b = s.b, y = TOP, r = 2.4;
  s.obox(c[0], c[1], a, r + 0.9, r + 0.9, y - 0.3, y + 0.35, MAT.ASHLAR, { skip: ['bottom'] });
  s.obox(c[0], c[1], a, r + 0.5, r + 0.5, y + 0.35, y + 0.7, MAT.CREAM, { skip: ['bottom'] });
  const ca = Math.cos(a), sa = Math.sin(a);
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const q: V2 = [c[0] + (ca * u - sa * v) * r * 0.78, c[1] + (sa * u + ca * v) * r * 0.78];
    b.cylinder(q[0], q[1], 0.28, y + 0.7, y + 4.0, 10, MAT.CREAM, { top: null });
    b.cylinder(q[0], q[1], 0.42, y + 0.7, y + 1.0, 8, MAT.ASHLAR, { top: null });
  }
  s.obox(c[0], c[1], a, r + 0.35, r + 0.35, y + 4.0, y + 4.6, MAT.CREAM);
  s.obox(c[0], c[1], a, r + 0.15, r + 0.15, y + 4.6, y + 4.95, MAT.TEAL, { skip: ['bottom'] });
  b.group(() => {
    b.at(c[0], y + 4.95, c[1], -a);
    domePart(b, { r: r * 0.95, kind: 'ribbed', mat: MAT.GOLD, drum: 0.5, base: null, finial: 'lotus', seed: 7, detail: 'mid' });
  });
}

/** a slab sector's skin's collider: in its spine's frame (x out along the spine, y across toward larger angles) the
 *  ledge path in slices along it between its parapet and the upper face, the lower face a wall to the ring road; the
 *  flight in its own */
function plateauCollider(haul: Haul, wd: Wedge, span: (r: number) => [number, number][], O: V2, T: V2, N: V2, f: { w: number; plat: number; run: number }) {
  const F = new Frame(`haven.dwelling.skin${wd.i}`, C[0], C[1], wd.am);
  for (const [a0, a1] of span(SKIN.upper)) {
    const n = Math.max(1, Math.ceil(((a1 - a0) * SKIN.upper) / 2.5));
    for (let k = 0; k < n; k++) {
      const p = a0 + ((a1 - a0) * k) / n - wd.am, q = a0 + ((a1 - a0) * (k + 1)) / n - wd.am, m = (p + q) / 2;
      const y0 = Math.sin(p) * SKIN.upper, y1 = Math.sin(q) * SKIN.upper;
      F.floor(Math.cos(m) * SKIN.upper + 0.1, Math.min(y0, y1), Math.cos(m) * SKIN.lower + 0.3, Math.max(y0, y1), SKIN.ledge + PROUD);
      F.solid(Math.cos(m) * SKIN.upper - 1.6, Math.min(y0, y1), Math.cos(m) * SKIN.upper, Math.max(y0, y1), SKIN.ledge - 1, TOP + PAR);
    }
  }
  const ga = Math.atan2(O[1] - C[1], O[0] - C[0]);
  for (const [a0, a1] of span(SKIN.lower)) {
    const n = Math.max(1, Math.ceil(((a1 - a0) * SKIN.lower) / 2.5));
    for (let k = 0; k < n; k++) {
      const p = a0 + ((a1 - a0) * k) / n, q = a0 + ((a1 - a0) * (k + 1)) / n, m = (p + q) / 2;
      const y0 = Math.sin(p - wd.am) * SKIN.lower, y1 = Math.sin(q - wd.am) * SKIN.lower, x = Math.cos(m - wd.am) * SKIN.lower;
      // (the ledge's parapet, open at the flight's way down; the lower face under it)
      if (Math.abs(m - ga) * SKIN.lower > f.plat) F.solid(x - 0.6, Math.min(y0, y1), x + 0.05, Math.max(y0, y1), SKIN.ledge - 1, SKIN.ledge + LEDGE_PAR);
      F.solid(x - 2.5, Math.min(y0, y1), x, Math.max(y0, y1), FLOOR_Y - 1, SKIN.ledge - 0.4);
    }
  }
  haul.colliders.push(F.done());
  // the platform and the flight down, in the flight's frame (x along the face toward smaller angles, y out of it… the
  // frame's y runs toward larger angles of its x: here inward, so the flight's across is negative)
  const G = new Frame(`haven.dwelling.skin${wd.i}.flight`, O[0], O[1], Math.atan2(T[1], T[0]));
  const w0 = -(PROOF + f.w), w1 = -PROOF;
  G.floor(-f.plat, w0, f.plat, w1, SKIN.ledge + PROUD);
  G.stair(f.plat, w0, f.plat + f.run, w1, FLOOR_Y + PROOF, SKIN.ledge + PROUD - FLOOR_Y - PROOF, 0, -1);
  G.solid(-f.plat, w0 - 0.3, f.plat + f.run, w0 + 0.3, FLOOR_Y - 0.5, SKIN.ledge + 1.4);
  void N;
  haul.colliders.push(G.done());
}
