// The souks: a covered street round the market's whole edge, as the bazaars of the old cities run round their
// squares. Each of the outline's sixteen sides (plan.ts SIDES) is laid in its own frame, x along it, z in toward the
// middle, its faces mitred where the outline turns and run into a gate's block where one stands:
//   - the shop block: its outer wall to the town (a parapet over its flat roof, a cream coping, stepped merlons along
//     it), and on the street its row of shops — each a niche in the block under a flat head, a counter across its
//     mouth, shelves and goods inside, a lamp of paper glowing in it, an awning over it, a window above (lit at night
//     or shuttered), a cream cornice along the top;
//   - the street, paved a step over the market's square;
//   - the arcade onto the market: pointed arches on slender columns, red-and-cream voussoirs, tiled spandrels, a teal
//     frieze, a coping; a pier at each corner with a finial on it;
//   - the canopy over the street: beams from the shops to the arcade and lengths of cloth across them, solid colours
//     and stripes by turns, the light falling between them in bars, a lantern hung from every other beam.
// Each side's colliders are its own (its frame's): the shop block, the shops' partitions and counters, the columns,
// the corner piers, the street's floor.
import { awning, pierced, type Bay } from '../../arch/parts';
import { MAT, TILE_PAL, type V3 } from '../../arch/types';
import type { V2 } from '../../world/layout';
import type { City, Collide } from '../ctx';
import { lanternBody } from '../props';
import { Rng } from '../rng';
import { GOODS, type Goods, hung, lay, stock } from './goods';
import { CLOTH, DYES, block, cloth, hface, ring, shaft, vface } from './kit';
import { SIDES, SOUK, STREET, type Side, corner, gateAt, run, toSide } from './plan';

const S = SOUK;
/** the niches' backs (in from the outer face) */
const BACK = S.front - S.niche;
/** the arcade's faces: toward the street (back) and onto the market (front) */
const A0 = S.arcade - S.wall / 2, A1 = S.arcade + S.wall / 2;
/** a corner pier's half-width */
const HP = 0.65;

export function buildSouks(c: City, seed: number) {
  const b = c.b, rng = new Rng(seed);
  b.owner('souk', () => {
    const cols: Collide[] = [];
    let n = 0;
    for (const s of SIDES) b.group(() => {
      b.at(s.o[0], 0, s.o[1], s.yaw);
      const col = c.collide(`city/market-souk-${s.k}`);
      cols[s.k] = col;
      b.owner('shops', () => { n = shops(c, s, col, rng, n); });
      b.owner('arcade', () => arcade(c, s, col));
      b.owner('canopy', () => canopy(c, s, rng));
      b.owner('floor', () => {
        // the street's paving, from the niches' backs to the arcade's front, a step over the square's
        b.with({ tint: [1.0, 0.86, 0.74] }, () => hface(b, s, BACK, A1, S.floor, MAT.PAVING, true, 0));
        // its edge down to the square under the arches
        vface(b, s, A1, 0.07, S.floor, MAT.PAVING, 1, 0);
        const [a0, a1] = run(s, BACK, 0), [c0, c1] = run(s, A1, 0);
        col.polyFloor([[a0, BACK], [a1, BACK], [c1, A1], [c0, A1]], S.floor, 2);
        // (the canopy held as a ceiling from its beams to the shops' roof: the follow camera kept under it as under a
        // roof, though the sun falls between its cloths and nothing's there to stop it)
        const [d0, d1] = run(s, A0, 0);
        col.polySolid([[a0, BACK], [a1, BACK], [d1, A0], [d0, A0]], S.beam, S.roof, 2);
      });
    });
    // the piers at the corners (not the gates'), in the market's frame, each its side's collider's
    b.owner('arcade', () => {
      for (let k = 0; k < 16; k++) if (!gateAt(k)) cornerPier(c, k, cols[k]);
    });
  });
}

/** the shop block along a side: its outer wall and parapet, its roof, its shops; returns the shops' count so far */
function shops(c: City, s: Side, col: Collide, rng: Rng, n0: number): number {
  const b = c.b;
  const cap = S.parapet - 0.22;
  // the outer face to the town, the parapet's inner face over the roof, its coping (a cap standing 8 cm off each
  // face: its faces, its top, the rings under its overhangs), the roof
  b.with({ tint: [1.0, 0.92, 0.86] }, () => vface(b, s, 0, 0, cap, MAT.PLASTER, -1));
  vface(b, s, 0.55, S.roof, cap, MAT.PLASTER, 1);
  vface(b, s, -0.08, cap, S.parapet, MAT.CREAM, -1);
  vface(b, s, 0.63, cap, S.parapet, MAT.CREAM, 1);
  hface(b, s, -0.08, 0.63, S.parapet, MAT.CREAM);
  hface(b, s, -0.08, 0, cap, MAT.CREAM, false);
  hface(b, s, 0.55, 0.63, cap, MAT.CREAM, false);
  b.with({ tint: [0.92, 0.8, 0.72] }, () => hface(b, s, 0.55, S.front + 0.14, S.roof, MAT.PLASTER));
  // the merlons along the parapet (instanced), a merlon's pitch apart
  const [p0, p1] = run(s, 0.275, -0.6);
  for (let x = p0 + 0.5; x < p1 - 0.3; x += 1.05) b.place('merlon-stepped', [x, S.parapet, 0.275]);
  // the shops along the street's front, clear of the corners (and a gate's flank)
  const [f0, f1] = run(s, S.front, 0);
  const g0 = gateAt(s.k), g1 = gateAt(s.k + 1);
  const m0 = f0 + (g0 ? 1.2 : 0.9), m1 = f1 - (g1 ? 1.2 : 0.9);
  const count = Math.max(0, Math.floor((m1 - m0 + (S.shopPitch - S.shopW)) / S.shopPitch));
  const lead = (m1 - m0 - (count * S.shopPitch - (S.shopPitch - S.shopW))) / 2;
  const xs = Array.from({ length: count }, (_, i) => m0 + lead + S.shopW / 2 + i * S.shopPitch);
  // the front: a wall pierced by the shops' niches (their jambs the partitions between them, their heads flat), the
  // niches' backs; no back face (the block's inside), no ends (the corners'), no top (the roof)
  b.group(() => {
    b.at(f0, 0, S.front - S.niche / 2);
    const bays: Bay[] = xs.map((x) => ({ x: x - f0, span: S.shopW, sill: 0, spring: S.shopH, kind: 'flat' }));
    b.with({ tint: [1.0, 0.88, 0.78] }, () => {
      if (bays.length) pierced(b, f1 - f0, S.roof, S.niche, bays, MAT.PLASTER_WARM, { segs: 2, back: false, ends: false, top: null });
      else vface(b, s, S.front, 0, S.roof, MAT.PLASTER_WARM, 1);
    });
  });
  if (!xs.length) vface(b, s, S.front, 0, 0, MAT.PLASTER_WARM, 1);
  // a band of tiles along the front over the awnings, PROUD of it
  b.with({ pal: TILE_PAL.HOUSE_BLUE }, () => vface(b, s, S.front + 0.03, S.shopH + 0.75, S.shopH + 1.2, MAT.TILE_BAND, 1, 0));
  // the cornice along the top of the front: its face, its top, its underside
  vface(b, s, S.front + 0.14, S.roof - 0.42, S.roof - 0.12, MAT.CREAM, 1);
  hface(b, s, S.front, S.front + 0.14, S.roof - 0.12, MAT.CREAM);
  hface(b, s, S.front, S.front + 0.14, S.roof - 0.42, MAT.CREAM, false);
  // the solid block behind the niches, and the ends and partitions beside them
  const [r0, r1] = run(s, 0, 0);
  col.solid(r0, 0, r1, BACK, 0, S.parapet);
  const edges = [f0, ...xs.flatMap((x) => [x - S.shopW / 2, x + S.shopW / 2]), f1];
  for (let i = 0; i + 1 < edges.length; i += 2) col.solid(edges[i], BACK, edges[i + 1], S.front, 0, S.roof);
  let n = n0;
  for (const x of xs) shop(c, s, col, x, rng, n++);
  // rugs and lengths of cloth hung on the piers between the shops, PROUD of the front
  for (let i = 0; i + 1 < xs.length; i++) {
    if (rng.chance(0.3)) continue;
    const x = (xs[i] + xs[i + 1]) / 2, pm = rng.chance(0.5), w = rng.range(0.32, 0.42), y0 = rng.range(0.35, 0.8);
    b.with({ tint: rng.pick(DYES) }, () => b.patch([[x - w, y0, S.front + 0.03], [x + w, y0, S.front + 0.03], [x + w, 2.6, S.front + 0.03], [x - w, 2.6, S.front + 0.03]], [0, 1, 2, 0, 2, 3], pm ? MAT.PAINT : MAT.CLOTH, [0, 0, 1]));
  }
  return n;
}

/** one shop: its niche's back, its counter, its shelves and goods, its paper lamp, its awning, the window over it */
function shop(c: City, s: Side, col: Collide, x: number, rng: Rng, n: number) {
  const b = c.b, xl = x - S.shopW / 2, xr = x + S.shopW / 2, y = S.floor, f = S.front;
  const kind: Goods = GOODS[(n * 5 + rng.int(0, 2)) % GOODS.length];
  // the niche's back (in its shade)
  b.with({ tint: [1.25, 1.12, 0.98], ao: 0.85 }, () => b.patch([[xl, 0, BACK], [xr, 0, BACK], [xr, S.shopH, BACK], [xl, S.shopH, BACK]], [0, 1, 2, 0, 2, 3], MAT.PLASTER_WARM, [0, 0, 1]));
  // the counter across its mouth, a way in at one end
  const open = n & 1 ? 'left' : 'right';
  const c0 = open === 'left' ? xl + 0.85 : xl, c1 = open === 'left' ? xr : xr - 0.85;
  block(b, c0, y, f - 0.62, c1, 0.95, f - 0.08, MAT.WOOD, [open === 'left' ? 'e' : 'w']);
  col.solid(c0, f - 0.62, c1, f - 0.08, 0, 0.95);
  lay(c, kind, c0 + 0.08, c1 - 0.08, f - 0.12, 0.42, 0.95, rng, 2);
  // a shelf along the back, stock on it (its ends in the jambs); cloth and rugs hung on a rail before it, or sacks of
  // spice on the floor
  b.box(xl, 1.45, BACK, xr, 1.5, BACK + 0.36, MAT.WOOD, { skip: ['n', 'e', 'w'] });
  stock(b, xl + 0.06, xr - 0.06, BACK + 0.34, 0.3, 1.5, rng);
  if (kind === 'cloth' || kind === 'rugs') {
    b.box(xl, 2.48, BACK + 0.5, xr, 2.53, BACK + 0.54, MAT.WOOD, { skip: ['e', 'w'] });
    hung(b, xl + 0.1, xr - 0.1, BACK + 0.52, kind === 'rugs' ? 0.4 : 1.2, 2.48, rng, kind === 'rugs' ? 3 : 4);
  } else if (kind === 'spice') lay(c, 'spice', xl + 0.2, xr - 0.2, BACK + 1.3, 0.55, y, rng, 3);
  // a paper lamp in every other niche (it glows at night), a light in every third
  if (n % 2 === 0) lanternBody(c, [x, 2.45, f - 0.9], 0.16, CLOTH[(n * 3) % CLOTH.length]);
  if (n % 7 === 3) c.light([x, 2.0, f - 0.7], 40, { radius: 7 });
  // the awning over the front (a flat one or a scalloped one, every shop its own cloth)
  b.group(() => {
    b.at(x, S.shopH + 0.38, f);
    // (a flat one's battens, rod and stays are out of sight under the canopy: far, its cloth and valance only)
    const scal = rng.chance(0.3);
    awning(b, { kind: scal ? 'scalloped' : 'flat', w: S.shopW + 0.3, out: 1.15, drop: 0.42, detail: scal ? 'mid' : 'far', tint: CLOTH[(n * 4 + rng.int(0, 1)) % CLOTH.length] });
  });
  // the window over it: glass lit at night, or a pair of painted shutters closed
  const wy0 = 4.35, wy1 = 5.65, wx0 = x - 0.55, wx1 = x + 0.55;
  if (rng.chance(0.7)) b.with({ glow: rng.range(0.55, 0.9) }, () => b.patch([[wx0, wy0, f + 0.03], [wx1, wy0, f + 0.03], [wx1, wy1, f + 0.03], [wx0, wy1, f + 0.03]], [0, 1, 2, 0, 2, 3], MAT.WINDOW, [0, 0, 1]));
  else b.with({ tint: rng.pick<V3>([[0.45, 1.05, 1.0], [0.5, 0.75, 1.25], [1.2, 0.6, 0.45]]) }, () => {
    for (const [u0, u1] of [[wx0, x - 0.01], [x + 0.01, wx1]]) b.patch([[u0, wy0, f + 0.03], [u1, wy0, f + 0.03], [u1, wy1, f + 0.03], [u0, wy1, f + 0.03]], [0, 1, 2, 0, 2, 3], MAT.WOOD, [0, 0, 1]);
  });
}

/** the arcade along a side: a wall on columns, pierced by pointed arches, from pier to pier (or a gate's flank) */
function arcade(c: City, s: Side, col: Collide) {
  const b = c.b, t = S.wall, pw = S.pier;
  const [e0, e1] = run(s, S.arcade, 0);
  // (a corner's pier is centred on the corner; a gate's flank stands where the run stops)
  const xs = e0 + (gateAt(s.k) ? 0.05 : HP), xe = e1 - (gateAt(s.k + 1) ? 0.05 : HP);
  const n = Math.max(1, Math.round((xe - xs + pw) / (S.span + pw))), span = (xe - xs - (n - 1) * pw) / n;
  const w0 = xs - 0.35, len = xe + 0.35 - w0, segs = 8, top = S.arcadeTop;
  const bays: Bay[] = Array.from({ length: n }, (_, i) => ({ x: 0.35 + span / 2 + i * (span + pw), span, sill: 0, spring: S.spring, kind: 'pointed', segs }));
  b.group(() => {
    b.at(w0, 0, S.arcade);
    b.with({ pal: TILE_PAL.HOUSE }, () => pierced(b, len, top, t, bays, MAT.PLASTER, { segs, spandrel: MAT.TILE, onColumns: true, ends: false, top: null }));
    // the rings of red and cream voussoirs on the market's face, a teal frieze over them, the coping
    for (const y of bays) ring(b, 'pointed', span, segs, y.x, S.spring, t / 2 + 0.025, 0.22, MAT.CREAM, MAT.RED);
    block(b, 0.35, top - 0.62, t / 2, len - 0.35, top - 0.14, t / 2 + 0.04, MAT.TEAL, ['n', 'e', 'w']);
    b.box(0.15, top, -t / 2 - 0.1, len - 0.15, top + 0.24, t / 2 + 0.1, MAT.CREAM, { skip: ['e', 'w'] });
    // the columns between the arches: a base, an eight-sided shaft, an abacus the arches spring from
    for (let i = 1; i < n; i++) {
      const cx = 0.35 + i * (span + pw) - pw / 2;
      block(b, cx - 0.28, S.floor, -0.28, cx + 0.28, 0.5, 0.28, MAT.CREAM);
      shaft(b, cx, 0, 0.19, 0.5, S.spring - 0.3, MAT.CREAM, 6);
      b.box(cx - pw / 2, S.spring - 0.3, -t / 2 - 0.05, cx + pw / 2, S.spring, t / 2 + 0.05, MAT.CREAM);
      col.solid(w0 + cx - 0.28, S.arcade - 0.28, w0 + cx + 0.28, S.arcade + 0.28, 0, S.spring);
    }
  });
  // (the wall over the arches: out of reach, but a flier bumps it)
  col.solid(xs, A0, xe, A1, S.spring + 2.4, top + 0.24);
}

/** the pier at corner k where two sides' arcades meet: square to the corner's bisector, capped, a finial on it */
function cornerPier(c: City, k: number, col: Collide) {
  const b = c.b, q = corner(k, S.arcade), p0 = corner(k - 1, S.arcade), p1 = corner(k + 1, S.arcade);
  const d0: V2 = [q[0] - p0[0], q[1] - p0[1]], d1: V2 = [p1[0] - q[0], p1[1] - q[1]];
  const l0 = Math.hypot(...d0), l1 = Math.hypot(...d1), u: V2 = [d0[0] / l0 + d1[0] / l1, d0[1] / l0 + d1[1] / l1];
  const yaw = Math.atan2(-u[1], u[0]), h = S.arcadeTop + 0.75;
  b.group(() => {
    b.at(q[0], 0, q[1], yaw);
    b.cappedBox(-HP, S.floor, -HP, HP, h, HP, MAT.PLASTER, { mat: MAT.CREAM, h: 0.32, out: 0.08 });
    // (a cream base course)
    b.cappedBox(-HP - 0.06, S.floor, -HP - 0.06, HP + 0.06, 0.62, HP + 0.06, MAT.CREAM, { mat: MAT.CREAM, h: 0.1, out: 0.04 });
    b.place('finial-ball', [0, h, 0], { scale: 1.3 });
  });
  // its collider in the side's frame
  const s = SIDES[k], c0 = Math.cos(yaw), s0 = Math.sin(yaw);
  const pts: V2[] = [[-HP, -HP], [HP, -HP], [HP, HP], [-HP, HP]].map(([x, z]) => toSide(s, [q[0] + c0 * x + s0 * z, q[1] - s0 * x + c0 * z]));
  col.polySolid(pts, 0, h, 0.5);
}

/** the canopy over the street: beams across it at the arcade's columns, cloth over them by turns, lanterns under */
function canopy(c: City, s: Side, rng: Rng) {
  const b = c.b;
  const [f0, f1] = run(s, S.front, 0), [a0, a1] = run(s, A0, 0);
  const x0 = Math.max(f0, a0) + (gateAt(s.k) ? 1.0 : 0.6), x1 = Math.min(f1, a1) - (gateAt(s.k + 1) ? 1.0 : 0.6);
  const n = Math.max(1, Math.round((x1 - x0) / 4.3)), step = (x1 - x0) / n;
  const yb = S.beam, yt = yb + 0.2;
  // (the cloth slopes from over the shops' cornice down to the arcade's coping, sagging between)
  const yf = S.roof - 0.06, ya = S.arcadeTop - 0.1;
  for (let i = 0; i <= n; i++) {
    const x = x0 + i * step;
    b.box(x - 0.09, yb, S.front + 0.14, x + 0.09, yt, A0, MAT.WOOD, { skip: ['n', 's'] });
    if (i % 3 === 1) b.place('lantern-hanging', [x, yb, STREET.mid], { scale: 1.3 });
  }
  for (let i = 0; i < n; i++) {
    // (two-thirds of the bay covered: the sun falls between in bars)
    const u0 = x0 + i * step + step * 0.17, u1 = x0 + (i + 1) * step - step * 0.17;
    const solid = (i + s.k) % 2 === 0, tint = solid ? DYES[(i * 3 + s.k * 5) % DYES.length] : CLOTH[(i * 5 + s.k) % CLOTH.length];
    const dm = (S.front + 0.14 + A0) / 2, sag = 0.22 + rng.range(-0.05, 0.05);
    const yl = (d: number) => yf + ((d - S.front - 0.14) / (A0 - S.front - 0.14)) * (ya - yf);
    const row = (d: number, dip: number): V3[] => [[u0, yl(d) - dip, d], [(u0 + u1) / 2, yl(d) - dip * 1.15, d], [u1, yl(d) - dip, d]];
    b.with({ tint }, () => cloth(b, [row(S.front + 0.14, 0), row(dm, sag), row(A0, 0)], solid ? MAT.PAINT : MAT.CLOTH));
  }
}
