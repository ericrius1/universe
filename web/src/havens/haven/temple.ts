// The temple at TEMPLE: a twelve-sided colonnaded base on a podium (refs 3, 5): terracotta walls between a tight rhythm
// of cream pilasters, slit windows lit at night, a teal frieze studded with gold diamonds, a deep cream cornice and an
// attic; portals on six faces (the south one meets the grand stair's processional way) with stepped cream frames and
// pointed heads, balconies on the other six; inside, a dim hall round a ring of columns and a sanctum on a dais under
// a golden lotus. On the roof, the lotus crown (petals.ts) round a garden court and the needle. Round it, the paved ring
// the gardens and causeways start from, the processional way to the stair and the avenue north.
import { MAT, type Mat, type V3 } from '../arch/types';
import type { V2 } from '../world/layout';
import { TEMPLE } from '../world/layout';
import { Frame, type Haul } from './colliders';
import { crown, needle, petal } from './petals';
import { AVENUE_N, C, GARDENS, NOTCH_TOP, TOP, WALK, WAY, rng } from './plan';
import type { Shapes } from './shapes';
import { basin, lantern } from './terraces';

const N = 12;
const RC = TEMPLE.baseR;                       // circumradius of the base
const AP = RC * Math.cos(Math.PI / N);         // its apothem
const HALF = RC * Math.sin(Math.PI / N);       // half a face
const THICK = 3;
const FLOOR = TOP + WALK;                      // the ring's walk
const PODIUM = FLOOR + 2.4;                    // the podium and the hall's floor
const PODIUM_AP = AP + 8.5;
const ROOF = TOP + TEMPLE.baseH;               // the roof terrace
const CEIL = ROOF - 3.6;
const DOOR_W = 3.6, DOOR_H = 12.5;
/** the raised planter on the ring before each balcony face: out from the temple's centre from r0 to r1, w either side
 *  of the face's middle; its rim's top and its soil over the ring's walk */
const PLANTER = { r0: PODIUM_AP + 3.0, r1: GARDENS.wedges[0].r0 * Math.cos(Math.PI / N) - 4.5, w: 11, rim: 0.75, soil: 0.55 };

/** a face's frame: its centre angle, and a point at u along the face (toward larger angles), v out from it, height y */
function face(j: number) {
  const th = (j / N) * Math.PI * 2;
  const n: V2 = [Math.cos(th), Math.sin(th)], t: V2 = [-n[1], n[0]];
  const at = (u: number, v: number): V2 => [C[0] + n[0] * (AP + v) + t[0] * u, C[1] + n[1] * (AP + v) + t[1] * u];
  return { th, n, t, at, along: th + Math.PI / 2 };
}
const isPortal = (j: number) => j % 2 === 1;

export function buildTemple(s: Shapes, haul: Haul) {
  ring(s, haul);
  podium(s, haul);
  for (let j = 0; j < N; j++) facade(s, haul, j);
  interior(s, haul);
  roof(s, haul);
  crown(s, haul, TEMPLE.petals, ROOF, TEMPLE.petalH, AP);
  needle(s, haul, ROOF + 0.6, TEMPLE.y + TEMPLE.needleH);
  colliders(haul);
}

/** the ring round the podium out to the gardens: paving, a cream band at the gardens' edge, lanterns and urns; the
 *  processional way south to the stair's top landing and the avenue north */
function ring(s: Shapes, haul: Haul) {
  const b = s.b, r0 = GARDENS.wedges[0].r0, n = 96;
  const circ = (r: number) => Array.from({ length: n }, (_, i) => [C[0] + Math.cos((i / n) * 2 * Math.PI) * r, C[1] + Math.sin((i / n) * 2 * Math.PI) * r] as V2);
  // (the ring: between the podium's twelve-gon and the circle where the gardens begin, in twelve wedge pieces)
  for (let j = 0; j < N; j++) {
    const f = face(j), a0 = f.th - Math.PI / N, a1 = f.th + Math.PI / N;
    const inner = [polyCorner(j, PODIUM_AP, -1), polyCorner(j, PODIUM_AP, 1)];
    const m = 8, outer: V2[] = [];
    for (let i = 0; i <= m; i++) { const a = a0 + ((a1 - a0) * i) / m; outer.push([C[0] + Math.cos(a) * r0, C[1] + Math.sin(a) * r0]); }
    s.slab([inner[0], inner[1], ...outer.reverse()], FLOOR, MAT.PAVING);
  }
  const band = circ(r0 - 0.6), edge = circ(r0);
  s.flat([...edge, edge[0]], [...band, band[0]], FLOOR + 0.01, FLOOR + 0.01, MAT.CREAM);
  // raised planters before each balcony face, cypresses flanking each portal's flight
  for (let j = 0; j < N; j++) {
    const f = face(j);
    if (isPortal(j)) {
      for (const sg of [-1, 1]) {
        const p = f.at(sg * 8.2, PODIUM_AP - AP + 4.2);
        haul.beds.push({ poly: [[p[0] - 0.8, p[1] - 0.8], [p[0] + 0.8, p[1] - 0.8], [p[0] + 0.8, p[1] + 0.8], [p[0] - 0.8, p[1] + 0.8]], y: FLOOR + 0.5, kind: 'cypress', density: 1 });
        b.cylinder(p[0], p[1], 1.0, FLOOR, FLOOR + 0.5, 12, MAT.CREAM, { top: MAT.SOIL });
      }
      continue;
    }
    const v0 = PLANTER.r0 - AP, v1 = PLANTER.r1 - AP, w = PLANTER.w, soil = FLOOR + PLANTER.soil;
    const outer: V2[] = [f.at(-w, v0), f.at(-w, v1), f.at(w, v1), f.at(w, v0)].reverse();
    const inner: V2[] = [f.at(-w + 0.4, v0 + 0.4), f.at(-w + 0.4, v1 - 0.4), f.at(w - 0.4, v1 - 0.4), f.at(w - 0.4, v0 + 0.4)].reverse();
    s.ring(outer, inner, FLOOR, soil, FLOOR + PLANTER.rim, MAT.PLASTER, MAT.CREAM, 0.14);
    s.slab(inner, soil, MAT.SOIL);
    haul.beds.push({ poly: inner, y: soil, kind: 'flowers', density: 0.95, palette: (['pink', 'white', 'gold', 'purple', 'mixed', 'pink'] as const)[j / 2] });
    for (const u of [-w * 0.55, 0, w * 0.55]) {
      const p = f.at(u, (v0 + v1) / 2);
      haul.beds.push({ poly: [[p[0] - 1.2, p[1] - 1.2], [p[0] + 1.2, p[1] - 1.2], [p[0] + 1.2, p[1] + 1.2], [p[0] - 1.2, p[1] + 1.2]], y: soil, kind: u === 0 ? 'blossom' : 'shrubs', density: 1 });
    }
  }
  // lanterns round the ring, urns between them
  const rnd = rng(5);
  for (let i = 0; i < 24; i++) {
    const a = ((i + 0.5) / 24) * Math.PI * 2;
    const p: V2 = [C[0] + Math.cos(a) * (r0 - 3.5), C[1] + Math.sin(a) * (r0 - 3.5)];
    if (Math.abs(Math.sin(a) - 1) < 0.02) continue;
    if (i % 2 === 0) {
      b.cylinder(p[0], p[1], 0.22, FLOOR, FLOOR + 3.2, 8, MAT.CREAM);
      b.cylinder(p[0], p[1], 0.38, FLOOR, FLOOR + 0.5, 8, MAT.ASHLAR);
      lantern(s, haul, p, a, FLOOR + 3.2, 1.1);
    } else s.urn(p[0], p[1], FLOOR, MAT.PLASTER_WARM, MAT.CREAM, MAT.SOIL, 1.2 + rnd() * 0.1);
  }
  // the processional way: paved across its width from the ring to the top landing's middle, a cream-edged runner down
  // it from the podium's south steps to the landing, cypresses and lanterns
  const zr = C[1] + Math.sqrt(r0 * r0 - WAY.half * WAY.half) - 0.5;
  s.slab([[C[0] - WAY.half, zr], [C[0] + WAY.half, zr], [C[0] + WAY.half, WAY.z1], [C[0] - WAY.half, WAY.z1]], FLOOR + 0.02, MAT.PAVING);
  const z0 = C[1] + PODIUM_AP + 5.6, z1 = NOTCH_TOP;
  s.obox(C[0], (z0 + z1) / 2, Math.PI / 2, (z1 - z0) / 2, 5.0, FLOOR, FLOOR + 0.04, MAT.CREAM, { skip: ['bottom'] });
  s.obox(C[0], (z0 + z1) / 2, Math.PI / 2, (z1 - z0) / 2, 4.2, FLOOR + 0.04, FLOOR + 0.06, MAT.PAVING, { skip: ['bottom'] });
  for (let z = z0 + 4; z < z1 - 2; z += 7) for (const sg of [-1, 1]) {
    const p: V2 = [C[0] + sg * 7.5, z];
    haul.beds.push({ poly: [[p[0] - 0.8, p[1] - 0.8], [p[0] + 0.8, p[1] - 0.8], [p[0] + 0.8, p[1] + 0.8], [p[0] - 0.8, p[1] + 0.8]], y: FLOOR, kind: 'cypress', density: 1 });
    b.cylinder(p[0], p[1], 0.9, FLOOR, FLOOR + 0.45, 10, MAT.CREAM);
  }
  // the avenue north across the forecourt to a pair of pylons
  const n0 = C[1] - PODIUM_AP - 5.6, n1 = C[1] - AVENUE_N.r1;
  s.obox(C[0], (n0 + n1) / 2, Math.PI / 2, (n0 - n1) / 2, AVENUE_N.half, FLOOR - 0.6, FLOOR, MAT.PAVING, { skip: ['bottom'] });
  for (const sg of [-1, 1]) s.obox(C[0] + sg * (AVENUE_N.half + 0.2), (n0 + n1) / 2, Math.PI / 2, (n0 - n1) / 2, 0.25, FLOOR - 0.6, FLOOR + 0.14, MAT.CREAM, { skip: ['bottom'] });
  for (let z = n0 - 6; z > n1 + 4; z -= 9) for (const sg of [-1, 1]) {
    const p: V2 = [C[0] + sg * (AVENUE_N.half + 2.5), z];
    haul.beds.push({ poly: [[p[0] - 0.8, p[1] - 0.8], [p[0] + 0.8, p[1] - 0.8], [p[0] + 0.8, p[1] + 0.8], [p[0] - 0.8, p[1] + 0.8]], y: TOP, kind: 'cypress', density: 1 });
  }
  // (three steps down off the avenue's end to the forecourt's ground)
  for (let k = 0; k < 3; k++) s.obox(C[0], n1 - 0.45 - k * 0.45, 0, AVENUE_N.half + 0.45, 0.23, TOP - 0.6, FLOOR - (k + 1) * 0.2, MAT.ASHLAR, { skip: ['bottom'] });
  for (const sg of [-1, 1]) {
    const p: V2 = [C[0] + sg * (AVENUE_N.half + 1.6), n1 + 2];
    s.pier(p[0], p[1], 0, 1.3, FLOOR - 0.6, FLOOR + 9, MAT.PLASTER, MAT.CREAM);
    s.obox(p[0], p[1], 0, 1.5, 1.5, FLOOR + 9, FLOOR + 9.6, MAT.CREAM);
    s.finial(p[0], p[1], FLOOR + 9.6, MAT.GOLD, 2.2);
    lantern(s, haul, [p[0] - sg * 1.7, p[1] + 1.7], 0, FLOOR + 5.5, 1.2);
  }
}

/** a corner of the twelve-gon of apothem ap at the start (-1) or end (+1) of face j */
function polyCorner(j: number, ap: number, e: number): V2 {
  const a = ((j + e * 0.5) / N) * Math.PI * 2, r = ap / Math.cos(Math.PI / N);
  return [C[0] + Math.cos(a) * r, C[1] + Math.sin(a) * r];
}
const gon = (ap: number): V2[] => Array.from({ length: N }, (_, j) => polyCorner(j, ap, 1)).reverse();

/** the podium: cream ashlar faces, a balustrade along its edge, flights up to the six portals */
function podium(s: Shapes, haul: Haul) {
  const b = s.b;
  b.prism(gon(PODIUM_AP), FLOOR - 0.6, PODIUM - 0.3, MAT.ASHLAR, { top: null });
  b.prism(gon(PODIUM_AP + 0.15), PODIUM - 0.3, PODIUM, MAT.CREAM, { top: MAT.PAVING });
  for (let j = 0; j < N; j++) {
    const f = face(j), v = PODIUM_AP - AP - 0.25;
    const ends: [number, number][] = isPortal(j) ? [[-HALF - 0.9, -6.4], [6.4, HALF + 0.9]] : [[-HALF - 0.9, HALF + 0.9]];
    for (const [u0, u1] of ends) s.balustrade(f.at(u0 * (PODIUM_AP / AP), v), f.at(u1 * (PODIUM_AP / AP), v), PODIUM, MAT.CREAM, MAT.CREAM);
    if (isPortal(j)) {
      const p = f.at(0, PODIUM_AP - AP + 2.8), q = f.at(0, PODIUM_AP - AP - 0.02);
      b.stairs(p[0], FLOOR, p[1], q[0], PODIUM, q[1], 12, 14, MAT.ASHLAR, { side: MAT.ASHLAR, foot: FLOOR - 0.6 });
      for (const sg of [-1, 1]) {
        const c = f.at(sg * 6.6, PODIUM_AP - AP + 0.4);
        s.pier(c[0], c[1], f.along, 0.55, PODIUM, PODIUM + 1.6, MAT.ASHLAR, MAT.CREAM);
        lantern(s, haul, c, f.along, PODIUM + 1.6, 1.0);
      }
    } else {
      // braziers on the podium before each balcony face, lit by firebending
      const c = f.at(0, 3.2);
      b.lathe(c[0], PODIUM, c[1], [[0.5, 0], [0.3, 0.2], [0.25, 0.9], [0.7, 1.1], [0.95, 1.45], [0.85, 1.5]], 12, MAT.GOLD);
      haul.lights.push({ p: [c[0], PODIUM + 1.9, c[1]], color: [1.0, 0.55, 0.22], candela: 400, when: 'fire', radius: 16 });
    }
  }
}

/** one face of the base: plinth, pilasters with slit windows between, frieze with gold diamonds, cornice, attic, the
 *  corner piers; a portal or a balcony in the middle */
function facade(s: Shapes, haul: Haul, j: number) {
  const b = s.b, f = face(j), portal = isPortal(j);
  const rnd = rng(j, 31);
  const wallAt = (u0: number, u1: number, y0: number, y1: number, v: number, mat: Mat, o: { skip?: string[]; top?: Mat } = {}) => {
    const p = f.at((u0 + u1) / 2, v / 2);
    s.obox(p[0], p[1], f.along, (u1 - u0) / 2, Math.abs(v) / 2, y0, y1, mat, o);
  };
  const half = HALF - 1.2;
  // the wall itself: a slab THICK deep behind the face (the hall's inner face is drawn by interior())
  b.with({ tint: [1.02 + (rnd() - 0.5) * 0.04, 0.99, 0.97] }, () => {
    const q0 = f.at(-HALF, 0), q1 = f.at(HALF, 0);
    if (portal) {
      const l0 = f.at(-DOOR_W, 0), l1 = f.at(DOOR_W, 0);
      s.strip([q0, l0], PODIUM, ROOF - 2.4, MAT.PLASTER, false).strip([l1, q1], PODIUM, ROOF - 2.4, MAT.PLASTER, false);
      s.strip([l0, l1], PODIUM + DOOR_H + 4.5, ROOF - 2.4, MAT.PLASTER, false);
    } else s.strip([q0, q1], PODIUM, ROOF - 2.4, MAT.PLASTER, false);
  });
  // plinth
  for (const [u0, u1] of portal ? [[-half, -DOOR_W - 1.2], [DOOR_W + 1.2, half]] : [[-half, half]]) wallAt(u0, u1, PODIUM, PODIUM + 1.4, 0.35, MAT.ASHLAR, { skip: ['bottom'] });
  // pilasters and the slit windows between them
  const n = 11, pitch = (2 * half) / n;
  for (let i = 0; i <= n; i++) {
    const u = -half + i * pitch;
    if (portal && Math.abs(u) < DOOR_W + 2.4) continue;
    wallAt(u - 0.42, u + 0.42, PODIUM + 1.4, ROOF - 6.0, 0.5, MAT.CREAM, { skip: ['bottom'] });
    b.cylinder(...f.at(u, 0.25), 0.55, PODIUM + 1.4, PODIUM + 2.0, 4, MAT.ASHLAR);
    if (i < n) {
      const um = u + pitch / 2;
      if (portal && Math.abs(um) < DOOR_W + 2.4) continue;
      const lit = rnd() < 0.75 ? 0.85 : 0.0;
      b.with({ glow: lit }, () => wallAt(um - 0.32, um + 0.32, ROOF - 13.5, ROOF - 7.2, 0.04, MAT.WINDOW, { skip: ['bottom'] }));
      b.with({ ao: 0.8 }, () => wallAt(um - 0.55, um + 0.55, ROOF - 7.2, ROOF - 6.9, 0.18, MAT.CREAM, { skip: ['bottom'] }));
    }
  }
  // frieze (teal with gold diamonds), cornice, attic
  wallAt(-HALF, HALF, ROOF - 6.0, ROOF - 4.0, 0.3, MAT.TEAL, { skip: ['bottom'] });
  for (let i = 0; i < n; i++) {
    const u = -half + (i + 0.5) * pitch, c = f.at(u, 0.34);
    diamond(s, c, f.along, ROOF - 5.0, 0.62, MAT.GOLD);
  }
  wallAt(-HALF - 0.6, HALF + 0.6, ROOF - 4.0, ROOF - 3.2, 0.8, MAT.CREAM);
  wallAt(-HALF - 1.0, HALF + 1.0, ROOF - 3.2, ROOF - 2.4, 1.45, MAT.CREAM);
  wallAt(-HALF, HALF, ROOF - 2.4, ROOF, 0.05, MAT.PLASTER, { skip: ['bottom'] });
  wallAt(-HALF - 0.2, HALF + 0.2, ROOF, ROOF + 0.4, 0.25, MAT.CREAM, { skip: ['bottom'] });
  // the corner pier at the face's end, with a gold cap
  const k = f.at(HALF, 0.2);
  s.obox(k[0], k[1], f.along + Math.PI / N, 1.35, 1.35, PODIUM, ROOF + 1.4, MAT.ASHLAR, { skip: ['bottom'] });
  b.cylinder(k[0], k[1], 1.3, ROOF + 1.4, ROOF + 3.0, 4, MAT.GOLD, { r1: 0.05 });
  if (portal) portalFrame(s, haul, f);
  else balcony(s, haul, f);
}

/** a raised gold diamond on a face at height y: a flat rhombus standing proud */
function diamond(s: Shapes, c: V2, along: number, y: number, r: number, mat: Mat) {
  const ta: V2 = [Math.cos(along), Math.sin(along)], n: V2 = [ta[1], -ta[0]];
  const pts: V3[] = [[c[0], y - r, c[1]], [c[0] + ta[0] * r * 0.7, y, c[1] + ta[1] * r * 0.7], [c[0], y + r, c[1]], [c[0] - ta[0] * r * 0.7, y, c[1] - ta[1] * r * 0.7]];
  const off = (p: V3, d: number): V3 => [p[0] + n[0] * d, p[1], p[2] + n[1] * d];
  s.b.polyW(pts.map((p) => off(p, 0.12)), mat);
  for (let i = 0; i < 4; i++) s.b.polyW([off(pts[i], 0), off(pts[(i + 1) % 4], 0), off(pts[(i + 1) % 4], 0.12), off(pts[i], 0.12)].reverse(), mat);
}

/** a portal: stepped cream jambs, a pointed head, gold trim, the reveal through the wall's depth */
function portalFrame(s: Shapes, haul: Haul, f: ReturnType<typeof face>) {
  const b = s.b, y0 = PODIUM, y1 = PODIUM + DOOR_H;
  for (const sg of [-1, 1]) {
    for (const [w, d] of [[0.9, 0.5], [0.6, 0.95]]) {
      const u = sg * (DOOR_W + w / 2 + (d > 0.6 ? 0.9 : 0));
      const c = f.at(u, d / 2);
      s.obox(c[0], c[1], f.along, w / 2, d / 2, y0, y1 + 1.0, MAT.CREAM, { skip: ['bottom'] });
    }
    // the reveal's side through the wall
    const p = f.at(sg * DOOR_W, 0), q = f.at(sg * DOOR_W, -THICK);
    b.with({ ao: 0.6 }, () => s.strip(sg > 0 ? [p, q] : [q, p], y0, y1, MAT.ASHLAR, true));
  }
  // the soffit and a pointed head of two leaning slabs over the opening, a gold diamond above
  const a = f.at(-DOOR_W, 0), c = f.at(DOOR_W, 0), ai = f.at(-DOOR_W, -THICK), ci = f.at(DOOR_W, -THICK);
  b.with({ ao: 0.55 }, () => s.flat([a, c], [ai, ci], y1, y1, MAT.ASHLAR, true));
  const apex = PODIUM + DOOR_H + 4.2;
  const P = (u: number, v: number, y: number): V3 => { const q = f.at(u, v); return [q[0], y, q[1]]; };
  for (const v of [0.02, 0.6]) {
    const w = DOOR_W + 1.8 + v;
    b.polyW([P(-w, v, y1 + 1.0), P(w, v, y1 + 1.0), P(0, v, apex + v * 0.8)].reverse(), v < 0.1 ? MAT.LAVENDER : MAT.CREAM);
  }
  for (const sg of [-1, 1]) {
    const w = DOOR_W + 2.4;
    b.polyW([P(sg * w, 0.6, y1 + 1.0), P(0, 0.6, apex + 0.48), P(0, 0, apex + 0.48), P(sg * w, 0, y1 + 1.0)][sg > 0 ? 'slice' : 'reverse'](), MAT.GOLD);
  }
  diamond(s, f.at(0, 0.66), f.along, apex - 1.6, 0.9, MAT.GOLD);
  // the opening's darkness at the back of the reveal is the hall itself; a lamp inside each portal
  const l = f.at(0, -THICK - 2);
  haul.lights.push({ p: [l[0], PODIUM + 6, l[1]], color: [1.0, 0.7, 0.4], candela: 120, when: 'always', radius: 14 });
}

/** a balcony on a petal face: a slab on corbels with a balustrade, a tall lit window behind it */
function balcony(s: Shapes, haul: Haul, f: ReturnType<typeof face>) {
  const b = s.b, y = PODIUM + 10.5, w = 6.2, d = 2.6;
  const c = f.at(0, d / 2);
  s.obox(c[0], c[1], f.along, w, d / 2, y - 0.45, y, MAT.CREAM);
  for (const u of [-w + 0.6, -w / 3, w / 3, w - 0.6]) {
    const k = f.at(u, d / 2 - 0.3);
    s.obox(k[0], k[1], f.along, 0.3, d / 2 - 0.3, y - 1.8, y - 0.45, MAT.ASHLAR, { skip: ['bottom'] });
  }
  s.balustrade(f.at(-w + 0.2, d - 0.25), f.at(w - 0.2, d - 0.25), y, MAT.CREAM, MAT.CREAM);
  s.balustrade(f.at(-w + 0.2, 0.3), f.at(-w + 0.2, d - 0.25), y, MAT.CREAM, MAT.CREAM);
  s.balustrade(f.at(w - 0.2, d - 0.25), f.at(w - 0.2, 0.3), y, MAT.CREAM, MAT.CREAM);
  const win = f.at(0, 0.06);
  b.with({ glow: 0.9 }, () => s.obox(win[0], win[1], f.along, 1.7, 0.03, y, y + 6.5, MAT.WINDOW, { skip: ['bottom'] }));
  const fr = f.at(0, 0.3);
  s.obox(fr[0], fr[1], f.along, 2.3, 0.25, y + 6.5, y + 7.1, MAT.CREAM);
  diamond(s, f.at(0, 0.32), f.along, y + 8.0, 0.75, MAT.GOLD);
  const l = f.at(0, 1.2);
  haul.lights.push({ p: [l[0], y + 2.5, l[1]], color: [1.0, 0.72, 0.45], candela: 60, when: 'night', radius: 10 });
}

/** the hall: its floor, the walls' inner faces and the ceiling (dim), a ring of columns, and the sanctum: a round dais
 *  under a golden lotus round a flame */
function interior(s: Shapes, haul: Haul) {
  const b = s.b, ap = AP - THICK;
  s.slab(gon(ap + 0.01), PODIUM, MAT.PAVING);
  b.with({ ao: 0.42 }, () => {
    for (let j = 0; j < N; j++) {
      const f = face(j);
      const q0 = f.at(-(HALF * ap) / AP, -THICK), q1 = f.at((HALF * ap) / AP, -THICK);
      if (isPortal(j)) {
        const l0 = f.at(-DOOR_W, -THICK), l1 = f.at(DOOR_W, -THICK);
        s.strip([q0, l0], PODIUM, CEIL, MAT.PLASTER_WARM, true).strip([l1, q1], PODIUM, CEIL, MAT.PLASTER_WARM, true);
        s.strip([l0, l1], PODIUM + DOOR_H, CEIL, MAT.PLASTER_WARM, true);
      } else s.strip([q0, q1], PODIUM, CEIL, MAT.PLASTER_WARM, true);
    }
    s.slab(gon(ap + 0.01), CEIL, MAT.PLASTER_WARM, true);
  });
  // the walls inside: pilasters, lavender panels with gold diamonds between them, a teal frieze under the ceiling
  b.with({ ao: 0.5 }, () => {
    for (let j = 0; j < N; j++) {
      const f = face(j), hw = (HALF * ap) / AP, k = 6;
      for (let i = 0; i <= k; i++) {
        const u = -hw + (2 * hw * i) / k;
        if (isPortal(j) && Math.abs(u) < DOOR_W + 0.8) continue;
        const c = f.at(u, -THICK - 0.2);
        s.obox(c[0], c[1], f.along, 0.42, 0.2, PODIUM, CEIL - 2.4, MAT.ASHLAR, { skip: ['bottom'] });
        if (i === k) continue;
        const um = u + hw / k;
        if (isPortal(j) && Math.abs(um) < DOOR_W + 1.6) continue;
        const pc = f.at(um, -THICK - 0.03);
        s.obox(pc[0], pc[1], f.along, hw / k - 0.9, 0.03, PODIUM + 2.2, CEIL - 4.0, MAT.LAVENDER, { skip: ['bottom'] });
        diamond(s, f.at(um, -THICK - 0.12), f.along + Math.PI, PODIUM + 9.5, 0.8, MAT.GOLD);
      }
      const q0 = f.at(-hw, -THICK - 0.05), q1 = f.at(hw, -THICK - 0.05);
      s.strip([q0, q1], CEIL - 2.4, CEIL - 0.6, MAT.TEAL, true).strip([q0, q1], CEIL - 0.6, CEIL, MAT.CREAM, true);
    }
  });
  // cream rings inlaid in the floor round the sanctum
  for (const r of [18, 27, 46]) {
    const n = 64, ring = (rr: number) => Array.from({ length: n + 1 }, (_, i) => [C[0] + Math.cos((i / n) * 2 * Math.PI) * rr, C[1] + Math.sin((i / n) * 2 * Math.PI) * rr] as V2);
    s.flat(ring(r + 0.35), ring(r - 0.35), PODIUM + 0.01, PODIUM + 0.01, MAT.CREAM);
  }
  // the columns
  b.with({ ao: 0.55 }, () => {
    for (let i = 0; i < 12; i++) {
      const a = ((i + 0.5) / 12) * Math.PI * 2, p: V2 = [C[0] + Math.cos(a) * 38, C[1] + Math.sin(a) * 38];
      b.cylinder(p[0], p[1], 1.25, PODIUM, CEIL - 1.2, 12, MAT.CREAM);
      b.cylinder(p[0], p[1], 1.6, PODIUM, PODIUM + 0.6, 8, MAT.ASHLAR);
      b.cylinder(p[0], p[1], 1.25, CEIL - 1.2, CEIL, 8, MAT.GOLD, { r1: 2.0 });
    }
  });
  // the sanctum
  for (const [r, h] of [[13.6, 0.27], [12.8, 0.54], [12, 0.81]]) b.cylinder(C[0], C[1], r, PODIUM, PODIUM + h, 24, MAT.CREAM);
  const y = PODIUM + 0.81;
  b.lathe(C[0], y, C[1], [[1.6, 0], [1.1, 0.4], [0.8, 1.6], [1.4, 1.9], [2.3, 2.3], [2.2, 2.45], [0.4, 2.3]], 16, MAT.GOLD);
  b.with({ glow: 1 }, () => b.cylinder(C[0], C[1], 0.9, y + 2.3, y + 2.9, 10, MAT.WINDOW, { r1: 0.2 }));
  // a golden lotus round the flame: two rings of small petals
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    petal(s, haul, { a, rb: 2.6, yb: y, H: 3.6, lean: 0.55, W: 1.3, sv: 0.42, T: 0.22, fold: 0.18, window: false, tint: [1, 1, 1] });
    petal(s, haul, { a: a + Math.PI / 8, rb: 1.6, yb: y + 0.3, H: 3.0, lean: 0.3, W: 0.9, sv: 0.42, T: 0.18, fold: 0.14, window: false, tint: [1.03, 1.0, 0.95] });
  }
  haul.lights.push({ p: [C[0], y + 3.5, C[1]], color: [1.0, 0.7, 0.38], candela: 800, when: 'always', radius: 30 });
  for (let i = 0; i < 6; i++) {
    const a = ((i + 0.5) / 6) * Math.PI * 2;
    haul.lights.push({ p: [C[0] + Math.cos(a) * 26, PODIUM + 8, C[1] + Math.sin(a) * 26], color: [1.0, 0.66, 0.36], candela: 150, when: 'always', radius: 18 });
  }
}

/** the roof terrace: paving, a balustrade round its edge, the garden court round the needle's foot */
function roof(s: Shapes, haul: Haul) {
  s.slab(gon(AP - 0.3), ROOF + 0.4, MAT.PAVING);
  for (let j = 0; j < N; j++) {
    const f = face(j);
    s.balustrade(f.at(-HALF + 1.6, -0.9), f.at(HALF - 1.6, -0.9), ROOF + 0.4, MAT.CREAM, MAT.CREAM);
  }
  // the court: six planters between the main petals' feet, a ring pool round the needle's plinth
  const rnd = rng(77);
  for (let i = 0; i < 6; i++) {
    const a = ((i + 0.5) / 6) * Math.PI * 2;
    const c: V2 = [C[0] + Math.cos(a) * 21, C[1] + Math.sin(a) * 21];
    s.obox(c[0], c[1], a + Math.PI / 2, 3.6, 2.4, ROOF + 0.4, ROOF + 1.3, MAT.PLASTER_WARM, { top: MAT.SOIL });
    const poly: V2[] = [[-3.3, -2.1], [3.3, -2.1], [3.3, 2.1], [-3.3, 2.1]].map(([u, v]) => [c[0] + Math.cos(a + Math.PI / 2) * u - Math.sin(a + Math.PI / 2) * v, c[1] + Math.sin(a + Math.PI / 2) * u + Math.cos(a + Math.PI / 2) * v]);
    haul.beds.push({ poly, y: ROOF + 1.3, kind: rnd() < 0.5 ? 'blossom' : 'flowers', density: 0.8, palette: 'pink' });
  }
  basin(s, haul, C, ROOF + 0.4 - WALK, ROOF + 0.4, 9.5);
}

/** the temple's walking colliders: a frame per face (its wall with the portal's gap and sill, the hall's floor behind,
 *  the podium, its flight, its balustrade, the ring before it, the roof), and one for the hall's columns and dais */
function colliders(haul: Haul) {
  for (let j = 0; j < N; j++) {
    const th = (j / N) * Math.PI * 2;
    const F = new Frame(`haven.temple.face${j}`, C[0], C[1], th);
    const h = HALF + 0.3, r0 = GARDENS.wedges[0].r0;
    F.floor(0, -h, AP - THICK, h, PODIUM, false);
    if (isPortal(j)) {
      F.solid(AP - THICK, -h, AP, -DOOR_W, PODIUM, ROOF).solid(AP - THICK, DOOR_W, AP, h, PODIUM, ROOF);
      F.solid(AP - THICK, -DOOR_W, AP, DOOR_W, PODIUM + DOOR_H, ROOF);
      F.door(AP - THICK - 0.5, -DOOR_W, AP + 0.5, DOOR_W, PODIUM);
      F.stair(PODIUM_AP, -6, PODIUM_AP + 2.8, 6, FLOOR, PODIUM - FLOOR, 0, -1);
      F.solid(PODIUM_AP - 0.5, -h * (PODIUM_AP / AP), PODIUM_AP, -6.2, PODIUM, PODIUM + 1);
      F.solid(PODIUM_AP - 0.5, 6.2, PODIUM_AP, h * (PODIUM_AP / AP), PODIUM, PODIUM + 1);
    } else {
      F.solid(AP - THICK, -h, AP, h, PODIUM, ROOF);
      F.solid(PODIUM_AP - 0.5, -h * (PODIUM_AP / AP), PODIUM_AP, h * (PODIUM_AP / AP), PODIUM, PODIUM + 1);
      F.floor(AP, -6.2, AP + 2.6, 6.2, PODIUM + 10.5);
      // (the raised planter before it: its rim a wall to walk into, its soil to stand on once jumped over it)
      F.solid(PLANTER.r0, -PLANTER.w, PLANTER.r1, PLANTER.w, FLOOR - 0.1, FLOOR + PLANTER.rim).floor(PLANTER.r0, -PLANTER.w, PLANTER.r1, PLANTER.w, FLOOR + PLANTER.soil);
    }
    F.floor(AP, -h * (PODIUM_AP / AP), PODIUM_AP, h * (PODIUM_AP / AP), PODIUM);
    F.solid(PODIUM_AP, -h * 1.2, PODIUM_AP + 0.01, h * 1.2, FLOOR - 0.6, FLOOR - 0.59);
    F.floor(PODIUM_AP, -r0 * Math.sin(Math.PI / N) - 1, r0 + 0.5, r0 * Math.sin(Math.PI / N) + 1, FLOOR);
    F.floor(0, -h, AP - 0.3, h, ROOF + 0.4);
    F.solid(AP - 1.2, -h, AP - 0.6, h, ROOF + 0.4, ROOF + 1.4);
    // (the podium's face: a step up from the ring a walker can't take but at the flights)
    F.solid(PODIUM_AP - 0.2, -h * (PODIUM_AP / AP), PODIUM_AP + 0.01, isPortal(j) ? -6 : h * (PODIUM_AP / AP), FLOOR - 0.6, PODIUM);
    if (isPortal(j)) F.solid(PODIUM_AP - 0.2, 6, PODIUM_AP + 0.01, h * (PODIUM_AP / AP), FLOOR - 0.6, PODIUM);
    haul.colliders.push(F.done());
  }
  // the processional way south to the stair's top landing, and the avenue north with its steps down at the end
  const W = new Frame('haven.temple.ways', C[0], C[1], 0);
  W.floor(-WAY.half, PODIUM_AP + 2.8, WAY.half, WAY.z1 - C[1], FLOOR);
  W.floor(-AVENUE_N.half - 0.2, -AVENUE_N.r1, AVENUE_N.half + 0.2, -PODIUM_AP - 2.8, FLOOR);
  W.stair(-AVENUE_N.half - 0.2, -AVENUE_N.r1 - 1.4, AVENUE_N.half + 0.2, -AVENUE_N.r1, TOP, WALK, 1, 1);
  for (const sg of [-1, 1]) W.solid(sg > 0 ? AVENUE_N.half - 0.05 : -AVENUE_N.half - 0.45, -AVENUE_N.r1, sg > 0 ? AVENUE_N.half + 0.45 : -AVENUE_N.half + 0.05, -PODIUM_AP - 2.8, TOP - 1, FLOOR + 0.14);
  haul.colliders.push(W.done());
  const K = new Frame('haven.temple.core', C[0], C[1], 0);
  for (let i = 0; i < 12; i++) {
    const a = ((i + 0.5) / 12) * Math.PI * 2, p = K.plan(C[0] + Math.cos(a) * 38, C[1] + Math.sin(a) * 38);
    K.solid(p[0] - 1.2, p[1] - 1.2, p[0] + 1.2, p[1] + 1.2, PODIUM, CEIL);
  }
  for (const [r, h] of [[13.6, 0.27], [12.8, 0.54], [12, 0.81]]) {
    const c = r * 0.72;
    K.floor(-r, -c * 0.55, r, c * 0.55, PODIUM + h, false).floor(-c * 0.55, -r, c * 0.55, r, PODIUM + h, false).floor(-c, -c, c, c, PODIUM + h, false);
  }
  K.solid(-2.4, -2.4, 2.4, 2.4, PODIUM + 0.81, PODIUM + 3.6);
  // the needle's plinth and the court's pool rim on the roof
  K.solid(-6.2, -6.2, 6.2, 6.2, ROOF, ROOF + 40);
  haul.colliders.push(K.done());
}
