// The grand stair (STAIR) straight down the south spoke's notch from the temple's ring to the ring road: the
// processional way from the ring's edge onto the top landing, round landings on drum bodies standing in the notch's
// ravine (tall ones carry blind niches and lit slits: rooms in the stair's towers) joined by broad flights between
// parapets, piers along them with gold finials and lamp posts on the landings, and at its foot the forecourt (L0) laid
// flush across the ring road, so the road runs on east–west over it, an eight-point star inlaid in it and two lantern
// pylons at the notch's mouth. Each flight and landing has its walking collider (the landings' round balustrades as a
// ring of small solids). A landing's balustrade runs round to each way off it and no further: a flight's mouth between
// its parapets, a bridge's width. Lamps, finials and balusters are the parts library's, placed instanced.
import { PROUD } from '../arch/builder';
import { MAT } from '../arch/types';
import type { V2 } from '../world/layout';
import { FLOOR_Y, NOTCH, STAIR } from '../world/layout';
import { Frame, type Haul } from './colliders';
import { DOOR_BRIDGE_HALF, landingDoors } from './dwellings';
import { C, FLIGHTS, LANDINGS, LANDING_R, R_FOOT, R_TEMPLE, STAIR_FOOT, TOP, WALK, WAY, notchFloor, type Flight } from './plan';
import type { Shapes } from './shapes';
import { slopedWall } from './terraces';

const HALF = STAIR.width / 2;
/** a flight's mouth at a landing: half its width between the middles of its parapets */
const MOUTH = HALF - 0.25;
/** a landing's balustrade (and its collider's ring) stands this far in from the landing's edge */
const BAL_IN = 0.35;
const RAIL = 1.1;
const RISE = 0.16;

/** the ground a part of the stair stands on: the town's floor past the notch's mouth, the notch's floor in it */
const groundAt = (z: number) => (z > NOTCH.z1 - 2 ? FLOOR_Y : notchFloor(z) - 1.5);

/** the ring road's inner edge before the notch's mouth (a chord of the ring's outline from the spoke to its next vertex
 *  9° round): z at x */
const ringEdgeZ = (x: number) => {
  const a = (9 * Math.PI) / 180, p: V2 = [C[0], C[1] + R_FOOT], q: V2 = [C[0] + Math.sin(a) * R_FOOT * Math.sign(x || 1), C[1] + Math.cos(a) * R_FOOT];
  return p[1] + ((x - p[0]) / (q[0] - p[0])) * (q[1] - p[1]);
};

export function buildStair(s: Shapes, haul: Haul) {
  forecourt(s, haul);
  way(s, haul);
  LANDINGS.forEach((l, i) => { if (i > 0) landing(s, haul, i, l); });
  for (const f of FLIGHTS) flight(s, haul, f);
  bridges(s, haul);
}

/** a bridge from each landing with a dwelling's door beside it across the ravine to the notch's wall (the door's
 *  threshold in its recess is the dwelling's): at the door's sill, a step up from the landing at the girls' room's */
function bridges(s: Shapes, haul: Haul) {
  for (const d of landingDoors()) {
    const [lx, lz] = LANDINGS[d.i], sg = d.side === 'east' ? 1 : -1, dz = d.z - lz;
    // (from the landing's edge: over it, at its own height, the two were one plane; a step up runs in over it)
    const e = lx + sg * (Math.sqrt((LANDING_R + 0.2) ** 2 - dz * dz) - (d.sill > LANDINGS[d.i][2] + 0.05 ? 0.8 : 0)), w = C[0] + sg * NOTCH.half;
    const mx = (e + w) / 2, hx = Math.abs(w - e) / 2;
    s.obox(mx, d.z, 0, hx, DOOR_BRIDGE_HALF, d.sill - 0.5, d.sill, MAT.CREAM, { top: MAT.PAVING, skip: [sg < 0 ? 'w' : 'e'] });
    const F = new Frame(`haven.stair.bridge${d.i}`, mx, d.z, 0);
    F.floor(-hx - 0.3, -DOOR_BRIDGE_HALF, hx, DOOR_BRIDGE_HALF, d.sill);
    for (const k of [-1, 1]) F.solid(-hx, k * DOOR_BRIDGE_HALF - 0.1, hx, k * DOOR_BRIDGE_HALF + 0.1, d.sill - 0.5, d.sill + 0.2);
    haul.colliders.push(F.done());
  }
}

/** the ways out of landing i (the direction each leaves in, half its width): the flights touching it (between their
 *  parapets), a built dwelling's door beside it (its bridge's width), and at the top the processional way */
function exits(i: number): [number, number][] {
  const out: [number, number][] = [];
  const prev = FLIGHTS[i - 1], next = FLIGHTS[i];
  if (prev) out.push([Math.atan2(-prev.dir[1], -prev.dir[0]), MOUTH]);
  if (next) out.push([Math.atan2(next.dir[1], next.dir[0]), MOUTH]);
  for (const d of landingDoors()) if (d.i === i) { const dz = d.z - LANDINGS[i][1]; out.push([Math.atan2(dz, (d.side === 'east' ? 1 : -1) * Math.sqrt(LANDING_R ** 2 - dz * dz)), DOOR_BRIDGE_HALF]); }
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

/** the forecourt at the stair's foot (L0), laid across the ring road at the road's own height from the ring's inner
 *  edge to the stair square: paving with an eight-point star inlaid in a cream ring (the star mesa's own), lamp posts at
 *  its outer corners, and at the notch's mouth either side of the first flight a tall pylon carrying a lantern */
function forecourt(s: Shapes, haul: Haul) {
  const b = s.b, [, z0, y] = LANDINGS[0], H = STAIR_FOOT.half, z1 = STAIR_FOOT.z1;
  // (the ring's inner edge bends at the spoke: the forecourt's north edge follows it, the notch's mouth in its middle)
  const outline: V2[] = [[C[0] - H, ringEdgeZ(-H)], [C[0] - NOTCH.half, ringEdgeZ(-NOTCH.half)], [C[0], C[1] + R_FOOT], [C[0] + NOTCH.half, ringEdgeZ(NOTCH.half)], [C[0] + H, ringEdgeZ(H)], [C[0] + H, z1], [C[0] - H, z1]];
  s.slab(outline, y, MAT.PAVING);
  // the star in its ring: the ring a band of cream, the star's points alternately terracotta and cream, a gold boss
  // (the star's stones a centimetre over the paving: where the town's ring road is laid over the forecourt, 1.5 cm under
  // its paving, not 5 mm)
  const cz = (C[1] + R_FOOT + z1) / 2 + 2, n = 64, inlay = y + 0.012;
  const circ = (r: number) => Array.from({ length: n + 1 }, (_, k) => [C[0] + Math.cos((k / n) * 2 * Math.PI) * r, cz + Math.sin((k / n) * 2 * Math.PI) * r] as V2);
  s.flat(circ(7.4), circ(6.8), inlay, inlay, MAT.CREAM);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 2, d = Math.PI / 8;
    const tip: V2 = [C[0] + Math.cos(a) * 6.4, cz + Math.sin(a) * 6.4];
    const l: V2 = [C[0] + Math.cos(a - d) * 2.7, cz + Math.sin(a - d) * 2.7], r: V2 = [C[0] + Math.cos(a + d) * 2.7, cz + Math.sin(a + d) * 2.7];
    s.slab([[C[0], cz], r, tip, l], inlay, k % 2 ? MAT.CREAM : MAT.PLASTER_WARM);
  }
  b.cylinder(C[0], cz, 0.7, inlay, inlay + 0.12, 16, MAT.GOLD, { top: MAT.GOLD });
  // lamp posts at its outer corners (clear of the ring road's way across it)
  for (const sg of [-1, 1]) for (const z of [z1 - 1.5, z1 - 9]) b.place('lantern-post', [C[0] + sg * (H - 1.4), y, z], { scale: 1.2 });
  // the pylons at the notch's mouth: a tall pier on a plinth, a cream cap, a great lantern
  for (const sg of [-1, 1]) {
    const c: V2 = [C[0] + sg * (HALF + 2.2), NOTCH.z1 - 2.2];
    s.obox(c[0], c[1], Math.PI / 2, 1.25, 1.25, y - 0.4, y + 1.0, MAT.ASHLAR, { skip: ['bottom'] });
    s.pier(c[0], c[1], Math.PI / 2, 0.9, y + 1.0, y + 7.4, MAT.PLASTER, MAT.CREAM);
    s.obox(c[0], c[1], Math.PI / 2, 1.05, 1.05, y + 7.4, y + 7.8, MAT.CREAM);
    b.place('lantern-post', [c[0], y + 7.8, c[1]], { scale: 0.75 });
  }
  const F = new Frame('haven.stair.forecourt', C[0], z0, 0);
  F.floor(-H, ringEdgeZ(-H) - z0, H, z1 - z0, y);
  for (const sg of [-1, 1]) F.solid(sg * (HALF + 2.2) - 1.25, NOTCH.z1 - 2.2 - 1.25 - z0, sg * (HALF + 2.2) + 1.25, NOTCH.z1 - 2.2 + 1.25 - z0, y - 1, y + 8);
  haul.colliders.push(F.done());
}

/** the processional way on from the temple's ring to the top landing (the temple lays its start round the podium): paved
 *  across the notch's width from the ring's edge to the landing's round edge, a cream-edged runner down its middle */
function way(s: Shapes, haul: Haul) {
  const [lx, lz, ly] = LANDINGS[LANDINGS.length - 1], y = TOP + WALK + PROUD, h = WAY.half;
  const n = 16, out: V2[] = [];
  // (the ring's edge from west to east, then back along the landing's north arc)
  for (let k = 0; k <= n; k++) { const x = -h + (2 * h * k) / n; out.push([C[0] + x, C[1] + Math.sqrt(R_TEMPLE * R_TEMPLE - x * x)]); }
  out.push([lx + h, lz]);
  for (let k = 0; k <= n; k++) { const a = (k / n) * Math.PI; out.push([lx + Math.cos(a) * LANDING_R, lz - Math.sin(a) * LANDING_R]); }
  out.push([lx - h, lz]);
  s.slab(out.reverse(), y, MAT.PAVING);
  const r0 = Math.sqrt(R_TEMPLE * R_TEMPLE - 5 * 5) + 0.05, r1 = lz - LANDING_R + 0.3;
  s.obox(C[0], (r0 + r1) / 2, Math.PI / 2, (r1 - r0) / 2, 5.0, y, y + 0.04, MAT.CREAM, { skip: ['bottom'] });
  s.obox(C[0], (r0 + r1) / 2, Math.PI / 2, (r1 - r0) / 2, 4.2, y + 0.04, y + 0.06, MAT.PAVING, { skip: ['bottom'] });
  for (const sg of [-1, 1]) s.b.place('lantern-post', [C[0] + sg * (h - 1.2), y, (r0 + r1) / 2], { scale: 1.15 });
  const F = new Frame('haven.stair.way', C[0], C[1], 0);
  F.floor(-h, R_TEMPLE - 1.5, h, lz - C[1], ly);
  haul.colliders.push(F.done());
}

function landing(s: Shapes, haul: Haul, i: number, [x, z, y]: [number, number, number]) {
  const b = s.b, R = LANDING_R;
  const foot = groundAt(z);
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
  // the balustrade round it to the edges of the ways off it, a pier at each end of each run with a gold finial, a lamp
  // post on the landing beside the one after an opening
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
      b.place('finial-spire', [c[0], y + RAIL + 0.5, c[1]], { scale: 1.1 });
      if (sg > 0) { const q = on(pa + (sg * 1.1) / (R - 1.4), R - 1.4); b.place('lantern-post', [q[0], y, q[1]], { yaw: -pa }); }
    }
  }
  landingCollider(haul, i, x, z, y, R, arcs);
}

/** a flight between two landings: the steps on a solid mass down to the ground, parapets with a cream cap along both
 *  sides (their outer faces PROUD in from the flight's sides: flush, the two were one plane, fighting), a cream string
 *  course down each flank hiding the steps' saw-tooth edge, piers along the parapets with gold finials */
function flight(s: Shapes, haul: Haul, f: Flight) {
  const b = s.b, [dx, dz] = f.dir, nx = -dz, nz = dx;
  const foot = Math.min(groundAt(f.a[1]), groundAt(f.b[1])) - 0.5;
  const n = Math.max(2, Math.round((f.yb - f.ya) / RISE));
  b.with({ tint: [1.02, 0.97, 0.95] }, () => b.stairs(f.a[0], f.ya, f.a[1], f.b[0], f.yb, f.b[1], STAIR.width, n, MAT.ASHLAR, { side: MAT.PLASTER, foot }));
  for (const sg of [-1, 1]) {
    // (its foot's end PROUD up the flight: at the flight's foot it lay in the first riser's plane)
    const o = sg * (HALF - 0.25 - PROUD);
    const p: V2 = [f.a[0] + nx * o + dx * PROUD, f.a[1] + nz * o + dz * PROUD], q: V2 = [f.b[0] + nx * o, f.b[1] + nz * o];
    slopedWall(s, p, q, f.ya - 0.3, f.yb - 0.3, RAIL + 0.3, 0.5, MAT.PLASTER, MAT.CREAM);
    const po: V2 = [f.a[0] + nx * sg * (HALF + 0.05), f.a[1] + nz * sg * (HALF + 0.05)], qo: V2 = [f.b[0] + nx * sg * (HALF + 0.05), f.b[1] + nz * sg * (HALF + 0.05)];
    // (wholly below the parapet's foot: their end caps were one plane at the landings)
    slopedWall(s, po, qo, f.ya - 0.95, f.yb - 0.95, 0.6, 0.3, MAT.CREAM, MAT.CREAM);
    const m = Math.max(1, Math.round(f.len / 11));
    for (let k = 1; k < m; k++) {
      const t = k / m, c: V2 = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], y = f.ya + (f.yb - f.ya) * t;
      s.pier(c[0], c[1], Math.atan2(dz, dx), 0.42, y - 0.3, y + RAIL + 0.45, MAT.ASHLAR, MAT.CREAM);
      b.place((k + (sg > 0 ? 1 : 0)) % 2 === 0 ? 'finial-lotus' : 'finial-spire', [c[0], y + RAIL + 0.45, c[1]], { scale: 1.0 });
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
    F.solid(f.i === 0 ? 0 : -0.6, y0, f.len + 0.6, y1, foot, f.yb + RAIL);
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
