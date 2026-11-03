// The grand stair (STAIR) from the end of the city's avenue up the promontory's south face to the temple's ring: round
// landings on drum bodies (towers where the lower flights stand out in front of the cliff, plinths in the notch above)
// joined by broad flights between parapets, piers with lanterns along them, a forecourt where it starts. Each flight
// and landing has its walking collider (the landings' round balustrades as a ring of small solids). A landing's
// balustrade runs round to each way off it and no further: a flight's mouth between its parapets, a bridge's width.
import { MAT } from '../arch/types';
import type { V2 } from '../world/layout';
import { STAIR } from '../world/layout';
import { Frame, type Haul } from './colliders';
import { COURT_BRIDGE_HALF } from './courts';
import { DOOR_BRIDGE_HALF, landingDoors } from './dwellings';
import { COURTS, FLIGHTS, LANDINGS, LANDING_R, NOTCH_SOUTH, courtDoor, notchFloor, type Flight } from './plan';
import type { Shapes } from './shapes';
import { lantern, slopedWall } from './terraces';

const HALF = STAIR.width / 2;
/** a flight's mouth at a landing: half its width between the middles of its parapets */
const MOUTH = HALF - 0.25;
/** a landing's balustrade (and its collider's ring) stands this far in from the landing's edge */
const BAL_IN = 0.35;
const RAIL = 1.1;
const RISE = 0.16;
/** the forecourt's rings of steps down from the first landing's walk to the city's ground, and each one's riser */
const FORECOURT_STEPS = 3;
const RISE_FORECOURT = 0.2;

/** the ground a part of the stair stands on: the canyon floor in front of the cliff, the notch's floor in it */
const groundAt = (z: number) => (z > NOTCH_SOUTH - 6 ? 0 : notchFloor(z) - 1.5);

export function buildStair(s: Shapes, haul: Haul) {
  LANDINGS.forEach((l, i) => landing(s, haul, i, l));
  for (const f of FLIGHTS) flight(s, haul, f);
}

/** the ways out of landing i (the direction each leaves in, half its width): the flights touching it (between their
 *  parapets), a built dwelling's door beside it and a court's way in (their bridges' widths) */
function exits(i: number): [number, number][] {
  const out: [number, number][] = [];
  const prev = FLIGHTS[i - 1], next = FLIGHTS[i];
  if (prev) out.push([Math.atan2(-prev.dir[1], -prev.dir[0]), MOUTH]);
  if (next) out.push([Math.atan2(next.dir[1], next.dir[0]), MOUTH]);
  for (const d of landingDoors()) if (d.i === i) out.push([d.side === 'east' ? 0 : Math.PI, DOOR_BRIDGE_HALF]);
  for (const c of COURTS) if (c.landing === i) { const d = courtDoor(c); out.push([Math.atan2(d[1] - LANDINGS[i][1], d[0] - LANDINGS[i][0]), COURT_BRIDGE_HALF]); }
  // the bottom landing opens back down the avenue, the top one on to the processional way
  if (i === 0 && next) out.push([Math.atan2(-next.dir[1], -next.dir[0]), MOUTH]);
  if (i === LANDINGS.length - 1 && prev) out.push([Math.atan2(prev.dir[1], prev.dir[0]), MOUTH]);
  return out;
}

/** the arcs of a ring of radius r left standing between the ways out (each [direction, half-width]): [from, to] in
 *  radians, from < to, the openings' edges exactly where each way's sides meet the ring */
function closedArcs(open: [number, number][], r: number): [number, number][] {
  const TAU = Math.PI * 2;
  if (!open.length) return [[0, TAU]];
  const iv = open.map(([e, w]) => {
    const g = Math.asin(Math.min(1, w / r)), a = (((e - g) % TAU) + TAU) % TAU;
    return [a, a + 2 * g];
  }).sort((p, q) => p[0] - q[0]);
  const m: number[][] = [];
  for (const v of iv) { const l = m[m.length - 1]; if (l && v[0] <= l[1]) l[1] = Math.max(l[1], v[1]); else m.push([...v]); }
  // (the last opening may run on past a full turn into the first)
  while (m.length > 1 && m[m.length - 1][1] >= m[0][0] + TAU) { const l = m.pop()!; m[0] = [Math.min(m[0][0], l[0] - TAU), Math.max(m[0][1], l[1] - TAU)]; }
  const out: [number, number][] = [];
  m.forEach((v, k) => {
    const to = k + 1 < m.length ? m[k + 1][0] : m[0][0] + TAU;
    if (to - v[1] > 1e-3) out.push([v[1], to]);
  });
  return out;
}

function landing(s: Shapes, haul: Haul, i: number, [x, z, y]: [number, number, number]) {
  const b = s.b, first = i === 0;
  const R = first ? LANDING_R + 4 : LANDING_R;
  const foot = groundAt(z) - (first ? 0.6 : 0);
  const tall = y - foot > 8;
  // the drum: terracotta with cream string courses every eight metres, a cream band under the walk; its disc is cut
  // straight across where each flight meets it (the flight's corners on the circle), so the treads run to its edge
  const disc = (r: number) => outline(i, x, z, r);
  b.with({ tint: [1.02, 0.97, 0.95] }, () => {
    b.prism(disc(R), foot, y - 0.4, MAT.PLASTER, { top: null });
    for (let h = y - 8.4; h > foot + 3; h -= 8) b.prism(disc(R + 0.12), h - 0.3, h, MAT.CREAM, { top: null });
    b.prism(disc(R + 0.2), y - 0.4, y, MAT.CREAM, { top: MAT.PAVING });
  });
  // tall drums carry blind arched niches round them and lit slit windows (rooms in the stair's towers)
  if (tall) {
    const n = 12;
    for (let k = 0; k < n; k++) {
      const a = ((k + 0.5) / n) * Math.PI * 2;
      if (exits(i).some(([e]) => Math.abs(Math.atan2(Math.sin(a - e), Math.cos(a - e))) < 0.5)) continue;
      for (let h = y - 7; h > foot + 6; h -= 8) {
        const c: V2 = [x + Math.cos(a) * (R + 0.02), z + Math.sin(a) * (R + 0.02)];
        b.with({ ao: 0.7 }, () => s.obox(c[0], c[1], a + Math.PI / 2, 0.9, 0.04, h - 4, h, MAT.PLASTER_WARM, { skip: ['bottom', 'top'] }));
        b.with({ glow: (k + Math.round(h)) % 3 === 0 ? 0.9 : 0 }, () => s.obox(c[0], c[1], a + Math.PI / 2, 0.3, 0.06, h - 3.2, h - 1.2, MAT.WINDOW, { skip: ['bottom', 'top'] }));
      }
    }
  }
  // the balustrade round it to the edges of the ways off it, a pier at each end of each run (a lantern on the one
  // after an opening, a gold finial before the next: lanterns both ends at the forecourt)
  const open = exits(i), rb = R - BAL_IN;
  const arcs = closedArcs(open, rb);
  const on = (a: number, r: number): V2 => [x + Math.cos(a) * r, z + Math.sin(a) * r];
  for (const [a0, a1] of arcs) {
    const n = Math.max(1, Math.ceil(((a1 - a0) * rb) / 2.4));
    for (let k = 0; k < n; k++) s.balustrade(on(a0 + ((a1 - a0) * k) / n, rb), on(a0 + ((a1 - a0) * (k + 1)) / n, rb), y, MAT.CREAM, MAT.CREAM, RAIL);
    if (arcs.length === 1 && a1 - a0 > Math.PI * 2 - 1e-3) continue;
    for (const [a, sg] of [[a0, 1], [a1, -1]] as [number, number][]) {
      // (the pier's side flush with the opening's edge)
      const pa = a + (sg * 0.5) / (R - 0.45), c = on(pa, R - 0.45);
      s.pier(c[0], c[1], pa, 0.5, y, y + RAIL + 0.5, MAT.ASHLAR, MAT.CREAM);
      if (sg > 0 || first) lantern(s, haul, c, pa, y + RAIL + 0.5, 1.1);
      else s.finial(c[0], c[1], y + RAIL + 0.5, MAT.GOLD, 1.2);
    }
  }
  if (first) {
    // the forecourt's steps down to the avenue all round (FORECOURT_STEPS rings from the walk to the ground), two
    // lantern pylons before the first flight
    for (let k = 1; k <= FORECOURT_STEPS; k++) b.cylinder(x, z, R + 0.2 + k * 0.45, foot, y - k * RISE_FORECOURT, 32, MAT.ASHLAR);
    const e = open[0][0];
    for (const sg of [-1, 1]) {
      const a = e + Math.PI + sg * 0.55;
      const c: V2 = [x + Math.cos(a) * (R - 2.5), z + Math.sin(a) * (R - 2.5)];
      s.pier(c[0], c[1], e, 0.9, y, y + 7, MAT.PLASTER, MAT.CREAM);
      s.obox(c[0], c[1], e, 1.05, 1.05, y + 7, y + 7.4, MAT.CREAM);
      lantern(s, haul, c, e, y + 7.4, 1.6);
    }
  }
  landingCollider(haul, i, x, z, y, R, arcs);
}

/** a flight between two landings: the steps on a solid mass down to the ground, parapets with a cream cap along both
 *  sides, piers along them with lanterns and gold finials */
function flight(s: Shapes, haul: Haul, f: Flight) {
  const b = s.b, [dx, dz] = f.dir, nx = -dz, nz = dx;
  const foot = Math.min(groundAt(f.a[1]), groundAt(f.b[1])) - 0.5;
  const n = Math.max(2, Math.round((f.yb - f.ya) / RISE));
  b.with({ tint: [1.02, 0.97, 0.95] }, () => b.stairs(f.a[0], f.ya, f.a[1], f.b[0], f.yb, f.b[1], STAIR.width, n, MAT.ASHLAR, { side: MAT.PLASTER, foot }));
  for (const sg of [-1, 1]) {
    const o = sg * (HALF - 0.25);
    const p: V2 = [f.a[0] + nx * o, f.a[1] + nz * o], q: V2 = [f.b[0] + nx * o, f.b[1] + nz * o];
    slopedWall(s, p, q, f.ya - 0.3, f.yb - 0.3, RAIL + 0.3, 0.5, MAT.PLASTER, MAT.CREAM);
    // a cream string course down the flight's flank, under the parapet, hiding the steps' saw-tooth edge
    const po: V2 = [f.a[0] + nx * sg * (HALF + 0.05), f.a[1] + nz * sg * (HALF + 0.05)], qo: V2 = [f.b[0] + nx * sg * (HALF + 0.05), f.b[1] + nz * sg * (HALF + 0.05)];
    slopedWall(s, po, qo, f.ya - 0.75, f.yb - 0.75, 0.6, 0.3, MAT.CREAM, MAT.CREAM);
    const m = Math.max(1, Math.round(f.len / 11));
    for (let k = 1; k < m; k++) {
      const t = k / m, c: V2 = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], y = f.ya + (f.yb - f.ya) * t;
      s.pier(c[0], c[1], Math.atan2(dz, dx), 0.42, y - 0.3, y + RAIL + 0.45, MAT.ASHLAR, MAT.CREAM);
      if ((k + (sg > 0 ? 1 : 0)) % 2 === 0) lantern(s, haul, c, Math.atan2(dz, dx), y + RAIL + 0.45, 0.9);
      else s.finial(c[0], c[1], y + RAIL + 0.45, MAT.GOLD, 1.0);
    }
  }
  flightCollider(haul, f);
}

function flightCollider(haul: Haul, f: Flight) {
  const F = new Frame(`haven.stair.flight${f.i}`, f.a[0], f.a[1], Math.atan2(f.dir[1], f.dir[0]));
  F.stair(-0.3, -HALF + 0.5, f.len + 0.3, HALF - 0.5, f.ya, f.yb - f.ya, 0, 1);
  // (aprons a little way into the landings at either end, over the slivers their floors' cells leave at the chords; the
  // top one from where the treads end, so a steep flight leaves no lip under it higher than a step)
  F.floor(-1.6, -HALF + 0.5, 0.15, HALF - 0.5, f.ya).floor(f.len + 0.3, -HALF + 0.5, f.len + 1.6, HALF - 0.5, f.yb);
  const foot = Math.min(groundAt(f.a[1]), groundAt(f.b[1])) - 0.5;
  // (the parapets' solids run on a little way onto the landings at both ends, so they close on the landings' rings)
  for (const sg of [-1, 1]) {
    const y0 = sg < 0 ? -HALF : HALF - 0.5, y1 = sg < 0 ? -HALF + 0.5 : HALF;
    F.solid(-0.6, y0, f.len + 0.6, y1, foot, f.yb + RAIL);
  }
  haul.colliders.push(F.done());
}

/** a landing's platform outline: a circle of radius r round (x, z), cut straight across by a chord toward each flight
 *  (counter-clockwise on the map) */
function outline(i: number, x: number, z: number, r: number): V2[] {
  const cuts = [FLIGHTS[i - 1], FLIGHTS[i]].filter(Boolean).map((f, k) => {
    const e = k === 0 && i > 0 ? Math.atan2(-f!.dir[1], -f!.dir[0]) : Math.atan2(f!.dir[1], f!.dir[0]);
    return [e, Math.sqrt(LANDING_R * LANDING_R - HALF * HALF)] as [number, number];
  });
  const n = 48, out: V2[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    let d = r;
    for (const [e, c] of cuts) { const cs = Math.cos(a - e); if (cs > 0) d = Math.min(d, c / cs); }
    out.push([x + Math.cos(a) * d, z + Math.sin(a) * d]);
  }
  // (angles increasing run clockwise on a north-up map)
  return out.reverse();
}

/** a landing's floor (rows of cells over its cut disc) and its balustrade (a ring of small solids along its runs) */
function landingCollider(haul: Haul, i: number, x: number, z: number, y: number, R: number, arcs: [number, number][]) {
  const F = new Frame(`haven.stair.landing${i}`, x, z, 0);
  // the floor: rows of metre cells wholly inside the cut disc
  const poly = outline(i, 0, 0, R);
  const inside = (px: number, pz: number) => {
    let c = false;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      if ((poly[a][1] > pz) !== (poly[b][1] > pz) && px < ((poly[b][0] - poly[a][0]) * (pz - poly[a][1])) / (poly[b][1] - poly[a][1]) + poly[a][0]) c = !c;
    }
    return c;
  };
  for (let pz = -R; pz < R; pz += 1) {
    let x0: number | null = null, x1 = 0;
    for (let px = -R; px < R; px += 0.5) {
      const ok = inside(px, pz) && inside(px + 0.5, pz) && inside(px, pz + 1) && inside(px + 0.5, pz + 1);
      if (ok) { if (x0 === null) x0 = px; x1 = px + 0.5; }
    }
    if (x0 !== null) F.floor(x0, pz, x1, pz + 1, y);
  }
  // (the first landing's forecourt steps: a disc of cells for each ring, each a riser under the last)
  if (i === 0) {
    for (let k = 1; k < FORECOURT_STEPS; k++) {
      const r = R + 0.2 + k * 0.45;
      for (let pz = -r; pz < r; pz += 1) {
        const w = Math.sqrt(Math.max(0, r * r - Math.max(pz * pz, (pz + 1) * (pz + 1))));
        if (w > 0.5) F.floor(-w, pz, w, pz + 1, y - k * RISE_FORECOURT);
      }
    }
  }
  // (the balustrade's runs as boxes 0.8 m across no more than 0.7 m apart, the first and last flush with the openings'
  // edges)
  const rb = R - BAL_IN, h = 0.4 / rb;
  for (const [a0, a1] of arcs) {
    const n = a1 - a0 > 2 * h ? Math.ceil(((a1 - a0 - 2 * h) * rb) / 0.7) : 0;
    for (let k = 0; k <= n; k++) {
      const a = n ? a0 + h + ((a1 - a0 - 2 * h) * k) / n : (a0 + a1) / 2;
      const px = Math.cos(a) * rb, pz = Math.sin(a) * rb;
      F.solid(px - 0.4, pz - 0.4, px + 0.4, pz + 0.4, y - 2, y + RAIL);
    }
  }
  haul.colliders.push(F.done());
}
