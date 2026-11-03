// The cliff dwellings cut into the promontory's south face (ref 5): carved frontages standing a little proud of the
// rock, each a few storeys of door, windows (lit at night) and balconies between pilasters under a cornice. Some open
// off the grand stair's landings in the notch's walls (a short bridge from the landing to the door), two clusters are
// cut into the cliff under the south wedges' outer walls either side of the notch's mouth (on a skin of rock with
// ledges along the strata and stone paths along the rows), and rows more face the city from the tall south walls of
// the courts across the mouth.
import { MAT, type Mat, type V3 } from '../arch/types';
import type { V2 } from '../world/layout';
import { Frame, type Haul } from './colliders';
import { C, COURTS, DEG, LANDINGS, LANDING_DOORS, LANDING_R, NOTCH_EAST, NOTCH_WEST, WALL_OUT, WEDGES, notchFloor, rng } from './plan';
import { arc, pt, type Shapes } from './shapes';
import { lantern } from './terraces';

const STOREY = 5.2;

/** a carved frontage on a rock face (ref 5): centred at p on the face, facing n (unit, out of the rock), w wide and H
 *  tall from y0: a warm dressed face between tall pilasters under an entablature and a stepped crest, a tall portal
 *  with a pointed head in the middle (a closed door below, a lancet window lit at night above), tall slit windows with
 *  pointed heads either side, now and then a balcony across the portal */
function frontage(s: Shapes, haul: Haul, p: V2, n: V2, w: number, y0: number, H: number, seed: number, door = true) {
  const b = s.b, rnd = rng(seed);
  const t: V2 = [-n[1], n[0]], along = Math.atan2(t[1], t[0]);
  const at = (u: number, v: number): V2 => [p[0] + t[0] * u + n[0] * v, p[1] + t[1] * u + n[1] * v];
  const P = (u: number, y: number, v: number): V3 => { const q = at(u, v); return [q[0], y, q[1]]; };
  const out: V3 = [n[0], 0, n[1]];
  const box = (u0: number, u1: number, y1: number, y2: number, v: number, mat: Mat, skip: string[] = ['bottom']) => {
    const c = at((u0 + u1) / 2, v / 2);
    s.obox(c[0], c[1], along, (u1 - u0) / 2, Math.max(0.01, v / 2), y1, y2, mat, { skip });
  };
  /** a pointed head on [u0, u1] springing at y, standing proud by v */
  const head = (u0: number, u1: number, y: number, v: number, mat: Mat) => s.face([P(u0, y, v), P(u1, y, v), P((u0 + u1) / 2, y + (u1 - u0) * 0.75, v)], mat, out);
  const top = y0 + H;
  b.with({ tint: [1.0 + (rnd() - 0.5) * 0.06, 0.97, 0.95] }, () => box(-w / 2, w / 2, y0, top, 0.15, MAT.PLASTER_WARM));
  // the edge pilasters, their bases and capitals, the entablature and a stepped crest over the middle
  for (const sg of [-1, 1]) {
    const u = sg * (w / 2 - 0.45);
    box(u - 0.45, u + 0.45, y0, top, 0.55, MAT.ASHLAR);
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
  b.with({ glow: rnd() < 0.7 ? 0.9 : 0, ao: 0.8 }, () => {
    box(-pw / 2 + 0.25, pw / 2 - 0.25, y0 + 4.9, y0 + ph - 0.3, 0.5, MAT.WINDOW);
    head(-pw / 2 + 0.25, pw / 2 - 0.25, y0 + ph - 0.3, 0.5, MAT.WINDOW);
  });
  if (door) lantern(s, haul, at(pw / 2 + 1.0, 0.8), along, y0 + 3.0, 0.7);
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
  s.obox(c[0], c[1], along, 1.6, 0.75, y - 0.3, y, MAT.CREAM);
  for (const e of [-1.2, 1.2]) { const k = at(u + e, 0.55); s.obox(k[0], k[1], along, 0.2, 0.55, y - 1.1, y - 0.3, MAT.ASHLAR, { skip: ['bottom'] }); }
  s.balustrade(at(u - 1.5, 1.35), at(u + 1.5, 1.35), y, MAT.CREAM, MAT.CREAM, 0.9, 0.36);
}

export function buildDwellings(s: Shapes, haul: Haul) {
  notchSites(s, haul);
  southFace(s, haul);
  mouth(s, haul);
}

/** rows of frontages on the courts' tall south walls across the notch's mouth, a ledge path before each row */
function mouth(s: Shapes, haul: Haul) {
  for (const [k, levels] of [[0, [47]], [1, [58]]] as [number, number[]][]) {
    const c = COURTS[k];
    // (the court's southmost edge: its two corners at the largest z)
    const south = [...c.poly].sort((p, q) => q[1] - p[1]).slice(0, 2).sort((p, q) => p[0] - q[0]);
    const [a, b2] = south, z = a[1], n: V2 = [0, 1];
    for (const [j, y] of levels.entries()) {
      const x0 = a[0] + 1.5, x1 = b2[0] - 1.5, w = x1 - x0;
      s.obox((x0 + x1) / 2, z + 1.2, 0, w / 2 + 1.5, 1.2, y - 0.6, y, MAT.ASHLAR, { top: MAT.PAVING });
      s.obox((x0 + x1) / 2, z + 2.25, 0, w / 2 + 1.5, 0.15, y, y + 0.9, MAT.ASHLAR, { top: MAT.CREAM });
      const nF = Math.max(1, Math.round(w / 17));
      for (let i = 0; i < nF; i++) {
        const x = x0 + (w * (i + 0.5)) / nF;
        frontage(s, haul, [x, z + 0.02], n, Math.min(13, w / nF - 3), y, k === 0 ? 11 : 15, 700 + k * 40 + j * 10 + i);
      }
      const F = new Frame(`haven.dwelling.mouth${k}.${j}`, x0 - 1.5, z, 0);
      F.floor(0, 0, w + 3, 2.1, y).solid(0, 2.1, w + 3, 2.5, y - 1, y + 0.9);
      haul.colliders.push(F.done());
    }
  }
}

/** frontages in the notch's walls beside the landings, a bridge from each landing to its door */
function notchSites(s: Shapes, haul: Haul) {
  for (const { i, side, room } of landingDoors()) {
    const [lx, lz, ly] = LANDINGS[i];
    const x = xAt(side === 'east' ? NOTCH_EAST : NOTCH_WEST, lz);
    // (the frontage faces back into the notch, toward the landing)
    const n: V2 = [side === 'east' ? -1 : 1, 0];
    const p: V2 = [x, lz];
    frontage(s, haul, p, n, 13, ly, room, i * 13 + 1);
    // the bridge from the landing's edge to the door, and its collider
    const e: V2 = [lx + n[0] * -LANDING_R, lz];
    const gap = Math.abs(x - e[0]);
    const mid: V2 = [(x + e[0]) / 2, lz];
    s.obox(mid[0], mid[1], 0, gap / 2 + 0.6, DOOR_BRIDGE_HALF, ly - 0.5, ly, MAT.CREAM, { top: MAT.PAVING });
    const F = new Frame(`haven.dwelling.landing${i}`, x, lz, 0);
    // (the bridge to the closed door; the frontage stands proud of the cut face, solid)
    F.floor(Math.min(0, e[0] - x) - 0.3, -DOOR_BRIDGE_HALF, Math.max(0, e[0] - x) + 0.3, DOOR_BRIDGE_HALF, ly);
    F.solid(n[0] > 0 ? -1 : 0.1, -7, n[0] > 0 ? -0.1 : 1, 7, ly - 2, ly + 16);
    haul.colliders.push(F.done());
  }
}

/** a door's bridge from its landing: half its width */
export const DOOR_BRIDGE_HALF = 1.4;
/** the dwellings' doors in the notch's walls that are built (where the cut face rises high enough over the landing for
 *  a frontage of two storeys): the landing, which wall, the frontage's height. Each has its bridge from the landing,
 *  and the landing's balustrade opens onto it (stair.ts) */
export function landingDoors(): { i: number; side: 'east' | 'west'; room: number }[] {
  const out: { i: number; side: 'east' | 'west'; room: number }[] = [];
  for (const [i, side, storeys] of LANDING_DOORS) {
    const [, lz, ly] = LANDINGS[i];
    const room = Math.min(storeys * STOREY, faceTop([xAt(side === 'east' ? NOTCH_EAST : NOTCH_WEST, lz), lz]) - ly - 2.5);
    if (room >= 7) out.push({ i, side, room });
  }
  return out;
}

/** the x of a notch edge at z */
function xAt(line: V2[], z: number): number {
  for (let i = 0; i < line.length - 1; i++) {
    const p = line[i], q = line[i + 1];
    if ((z - p[1]) * (z - q[1]) <= 0 && p[1] !== q[1]) return p[0] + ((z - p[1]) / (q[1] - p[1])) * (q[0] - p[0]);
  }
  return line[line.length - 1][0];
}

/** how high the cut face rises at a point on the notch's edge: the floor of the terrace above it */
function faceTop(p: V2): number {
  const r = Math.hypot(p[0] - C[0], p[1] - C[1]);
  let top = -Infinity;
  for (const wd of WEDGES) for (const b of wd.bands) if (r >= b.r0 - 1 && r <= b.r1 + 1) top = Math.max(top, b.floor);
  return top;
}

/** the south face either side of the notch's mouth: a skin of rock under each south wedge's outer wall, ledges along
 *  its strata, three rows of frontages with stone paths before them and rock-cut steps between the rows */
function southFace(s: Shapes, haul: Haul) {
  const south = WEDGES.filter((w) => w.kind === 'flank' && Math.sin(w.am) > 0.6);
  for (const wd of south) {
    const last = wd.bands[wd.bands.length - 1];
    const R = wd.w.r1 + WALL_OUT, east = Math.cos(wd.am) > 0;
    // the stretch next to the notch: from the notch's edge 12 degrees round the wedge
    const edge = east ? wd.w.a1 + 1 * DEG : wd.w.a0 - 1 * DEG;
    const a0 = east ? edge - 14 * DEG : edge, a1 = east ? edge : edge + 14 * DEG;
    const top = last.floor - 14, bottom = Math.max(30, notchFloor(-440) - 14);
    // the rock skin, its strata ledges, then the rows
    const path = arc(R + 0.02, a0, a1, 2);
    s.strip(path, bottom, top + 0.5, MAT.ROCK, false);
    for (let y = top - 4; y > bottom + 3; y -= 6.5) s.strip(arc(R + 0.35, a0, a1, 2), y - 0.35, y, MAT.ROCK, false).flat(arc(R + 0.35, a0, a1, 2), arc(R, a0, a1, 2), y, y, MAT.ROCK);
    const rows = [top - 19, top - 42].filter((y) => y > bottom + 4);
    rows.forEach((y, k) => {
      // a ledge path along the row, a parapet on its edge
      const pR = R + 2.4;
      s.flat(arc(pR, a0, a1, 2), arc(R, a0, a1, 2), y, y, MAT.PAVING);
      s.strip(arc(pR, a0, a1, 2), y - 1.2, y, MAT.ASHLAR, false);
      s.strip(arc(pR, a0, a1, 2), y, y + 0.9, MAT.ASHLAR, false).strip(arc(pR - 0.35, a0, a1, 2), y, y + 0.9, MAT.ASHLAR, true);
      s.flat(arc(pR, a0, a1, 2), arc(pR - 0.35, a0, a1, 2), y + 0.9, y + 0.9, MAT.CREAM);
      const nF = 3;
      for (let j = 0; j < nF; j++) {
        const a = a0 + ((a1 - a0) * (j + 0.5)) / nF + (k % 2 ? 1.5 : -1.5) * DEG;
        const p = pt(R + 0.05, a), n: V2 = [Math.cos(a), Math.sin(a)];
        frontage(s, haul, p, n, 9 + ((j + k) % 2) * 3, y, 11 + ((j * 3 + k) % 3) * 2.5, wd.i * 100 + k * 10 + j);
      }
      southCollider(haul, wd.i, k, R, pR, a0, a1, y);
    });
  }
}

/** a row's path along the south face: a frame per few degrees, its floor and parapet */
function southCollider(haul: Haul, wi: number, k: number, R: number, pR: number, a0: number, a1: number, y: number) {
  const n = Math.ceil((a1 - a0) / (3 * DEG));
  for (let i = 0; i < n; i++) {
    const s0 = a0 + ((a1 - a0) * i) / n, s1 = a0 + ((a1 - a0) * (i + 1)) / n, sm = (s0 + s1) / 2;
    const F = new Frame(`haven.dwelling.south${wi}.row${k}.${i}`, C[0], C[1], sm);
    const w = pR * Math.sin((s1 - s0) / 2) + 0.3;
    F.floor(R - 0.2, -w, pR - 0.3, w, y);
    F.solid(pR - 0.35, -w, pR + 0.1, w, y - 1.2, y + 0.9);
    F.solid(R - 3, -w, R, w, y - 1, y + 12);
    haul.colliders.push(F.done());
  }
}
