// The rim (round 6, B3e: what was the city wall). The wall's curtains, gates and thirty-seven towers are gone with the
// canyon's basin; what the star keeps of them is its towers. At the end of every point's avenue but the east's, on the
// town's last flat ground before the rim's crest rises, a tip square (WAYS.tip: paved, an ashlar border round it, a
// fountain in its middle with benches and palms round it, lamps at its corners, a balustrade along its far side), and
// behind it on the crest's foot a lookout tower (WAYS.lookout: squareTower, a square shaft with a stair climbing three
// of its sides behind a stepped screen wall to the platform on its top, merlons round it, and an open pavilion there
// under a blue dome, its lantern lit at night) — from its platform the plain, the cliff and the next points' towers.
// At the east tip, where the canal leaves the town for its cascades, the water gate (GATE): two round towers either
// side of the sluice (gateTower: battered ashlar feet, plaster shafts, slit windows lit at night, a corbelled gallery
// with braziers behind its merlons, a drum of lit arched windows under a blue dome with a gold spire), their doors on
// the sluice's walk, lamps either side of them. Each is laid in its own frame: a tip's in its point's (x out along its
// axis from the star's centre, z across it), under the owner its claims are held by ('rim', 'gate').
import { MAT, TILE_PAL, type Mat, type V3 } from '../arch/types';
import { PROUD, annulus, column, domePart, finialPart, lantern, shapeOf, type Laid } from '../arch/parts';
import { GATE, POINTS, WAYS, type StarPoint, type V2 } from '../world/layout';
import type { City, Collide } from './ctx';
import { brazier, planter } from './props';
import { type Col, PAVE, balustradeRun, between, collideAt, lampAt, ngonAt, rect, treads } from './water';

const DEG = Math.PI / 180;

/** a tip square's border's width, its fountain's basin (its faces' distance from its middle, its wall, its rim's
 *  height — a step's, 35 cm, for the square's middle is a place walks go to — its water's), the benches' seat, the benches' distance out */
const SQ = { border: 1.4, basin: 4.2, wall: 0.55, rimH: 0.36, water: 0.28, bench: 7.4, seat: 0.38 };
/** the lookout tower: the shaft's half-width, the stair's band round it (and the screen wall's thickness at its outer
 *  edge), each flight's rise (three: the platform at 3 × rise), the platform's parapet */
const LOOK = { hw: 4.2, band: 1.5, screen: 0.3, rise: 4.4, parapet: 0.4, parapetH: 1.0, open: 2.0 };
/** the water gate's towers: the gallery's floor, the foot's top, the batter */
const GT = { gallery: 22, foot: 4.0, batter: 0.7, sides: 28 };

/** the warm stone of the squares' fields and borders (tints) */
const FIELD: V3 = [1.06, 0.92, 0.8], BORDER: V3 = [1.0, 0.9, 0.78];

/** a tip square and its lookout tower at every point but the east's (its tip is the water gate's) */
export function buildRim(c: City) {
  POINTS.forEach((p, k) => {
    if (p.role === 'palace') return;
    c.b.group(() => {
      // (the point's frame: x out along its axis, z across it toward larger angles)
      c.b.at(0, 0, 0, -p.tip * DEG);
      c.b.owner(`square-${p.name}`, () => tipSquare(c, p, k));
      c.b.owner(`lookout-${p.name}`, () => squareTower(c, p, k));
    });
  });
}

/** the water gate: a round tower either side of the sluice at the east tip */
export function buildWaterGate(c: City) {
  for (const s of [-1, 1] as const) c.b.owner(`tower-${s < 0 ? 'n' : 's'}`, () => gateTower(c, s));
}

// ------------------------------------------------------------------------------------------------- the tip squares

function tipSquare(c: City, p: StarPoint, k: number) {
  const b = c.b, t = WAYS.tip, u0 = t.r - t.half, u1 = t.r + t.half, h = t.half, uc = t.r, bw = SQ.border;
  const col = collideAt(c, `city/rim-${p.name}-square`, uc, 0);
  // the border round the field, the field round the basin: one plane, the two rings broken at the same ways from the
  // square's middle (and where the way out to the tower leaves it), so they share every corner along their edge
  const gap = 8, outer = rect(u0, -h, u1, h), field = rect(u0 + bw, -h + bw, u1 - bw, h - bw), basin = ngonAt(uc, 0, SQ.basin);
  const exits: V2[] = [[u1, -gap], [u1, gap]];
  b.with({ tint: BORDER }, () => between(b, outer, field, [uc, 0], PAVE, MAT.ASHLAR, false, [...basin, ...exits]));
  b.with({ tint: FIELD }, () => between(b, field, basin, [uc, 0], PAVE, MAT.PAVING, false, [...outer, ...exits]));
  col.floor(u0, -h, u1, h, PAVE);
  fountain(c, col, uc, 0, k);
  // benches round the basin, palms in planters at the field's corners, lamps at its corners and round the fountain
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2, x = uc + Math.cos(a) * SQ.bench, z = Math.sin(a) * SQ.bench;
    b.group(() => {
      b.at(x, PAVE, z, -a + Math.PI / 2);
      b.box(-1.6, 0, -0.3, 1.6, SQ.seat - PAVE, 0.3, MAT.CREAM, { skip: ['bottom'] });
    });
    // (a step's height, a body's 35 cm: sat on, stood on)
    const along = Math.abs(Math.cos(a)) > 0.5;
    col.floor(x - (along ? 0.3 : 1.6), z - (along ? 1.6 : 0.3), x + (along ? 0.3 : 1.6), z + (along ? 1.6 : 0.3), SQ.seat);
  }
  for (const [x, z] of [[u0 + 7, -h + 7], [u0 + 7, h - 7], [u1 - 7, -h + 7], [u1 - 7, h - 7]] as V2[]) {
    planter(c, x, z, 1.3, 0.7, 'palms', PAVE);
    col.solid(x - 1.3, z - 1.3, x + 1.3, z + 1.3, 0, 0.82);
  }
  for (const [x, z] of [[u0 + bw + 1.2, -h + bw + 1.2], [u0 + bw + 1.2, h - bw - 1.2], [u1 - bw - 1.2, -h + bw + 1.2], [u1 - bw - 1.2, h - bw - 1.2]] as V2[]) lampAt(b, x, PAVE, z, 1.3);
  for (let i = 0; i < 4; i++) { const a = (i / 4 + 1 / 8) * Math.PI * 2; lampAt(b, uc + Math.cos(a) * 6.4, PAVE, Math.sin(a) * 6.4); }
  // the balustrade along the far side, open in the middle onto the way to the tower
  const xb = u1 - 0.35;
  balustradeRun(c, [xb, -h + 0.35], [xb, -gap], PAVE, { seed: k });
  balustradeRun(c, [xb, gap], [xb, h - 0.35], PAVE, { seed: k + 1 });
  col.solid(xb - 0.2, -h, xb + 0.2, -gap, 0, 0.94).solid(xb - 0.2, gap, xb + 0.2, h, 0, 0.94);
  // the way out to the tower: paved from the square to the foot of its stair and along its face
  const L = WAYS.lookout.r, { hw, band } = LOOK, xt = L - hw - band;
  // (one outline, so no corner of one piece lies along another's edge)
  b.with({ tint: FIELD }, () => b.slab([[u1, -gap], [xt, -gap], [xt, -hw - band], [L - hw, -hw - band], [L - hw, hw - LOOK.open], [xt, hw - LOOK.open], [xt, gap], [u1, gap]], PAVE, MAT.PAVING));
  col.floor(u1, -gap, xt, gap, PAVE).floor(xt, -hw - band, L - hw, hw - LOOK.open, PAVE);
}

/** the square's fountain: an eight-sided basin (its wall's faces, its rim, its mosaic floor and its water), a bowl on a
 *  pedestal in its middle brimming, a gold lotus in the bowl */
function fountain(c: City, col: Col, x: number, z: number, k: number) {
  const b = c.b, out = ngonAt(x, z, SQ.basin), inn = ngonAt(x, z, SQ.basin - SQ.wall), y1 = SQ.rimH, fl = PAVE + 0.06;
  const P = (q: V2, y: number): V3 => [q[0], y, q[1]];
  for (let i = 0; i < 8; i++) {
    const a = out[i], d = out[(i + 1) % 8], e = inn[i], f = inn[(i + 1) % 8];
    // (the outlines run clockwise seen from above: the outer faces wound to face out, the inner to face in)
    b.quad(P(d, PAVE), P(a, PAVE), P(a, y1), P(d, y1), MAT.ASHLAR);
    b.with({ pal: TILE_PAL.FOUNTAIN }, () => b.quad(P(e, fl), P(f, fl), P(f, y1), P(e, y1), MAT.TILE_BAND));
  }
  between(b, out, inn, [x, z], y1, MAT.CREAM);
  b.slab(inn, fl, MAT.POOL);
  c.pool(inn, SQ.water, SQ.water - fl);
  // the pedestal and its bowl (its underside, its lip, its inside), brimming
  b.cylinder(x, z, 0.42, fl, 0.9, 12, MAT.CREAM, { top: null });
  b.lathe(x, 0.9, z, [[0.42, 0], [0.8, 0.1], [1.2, 0.26], [1.4, 0.36]], 16, MAT.CREAM);
  annulus(b, x, z, 1.26, 1.4, 1.26, 16, MAT.CREAM);
  b.lathe(x, 0, z, [[1.26, 1.26], [0.9, 1.08], [0.3, 1.02], [0.001, 1.01]], 16, MAT.POOL);
  c.pool(ngonAt(x, z, 1.12, 12), 1.2, 0.15);
  b.group(() => { b.at(x, 1.01, z); finialPart(b, { kind: 'lotus', h: 0.7, seed: k }); });
  // (its rim a step up, walked along or over into the water: its four square sides)
  const A = SQ.basin, w = SQ.wall;
  col.floor(x - A, z - A, x + A, z - A + w, y1).floor(x - A, z + A - w, x + A, z + A, y1).floor(x - A, z - A, x - A + w, z + A, y1).floor(x + A - w, z - A, x + A, z + A, y1);
}

// ------------------------------------------------------------------------------------------------- the lookouts

/** a lookout tower behind a tip's square (see the header): its frame on the point's axis at WAYS.lookout.r, x outward.
 *  Its stair: flight 1 up the near side (-z) going out, flight 2 up the far side (+x) across, flight 3 up the other
 *  side (+z) coming back, each between the shaft and the screen wall, landings at the corners; the last landing a
 *  pier on the near face, level with the platform, through a gap in its parapet */
function squareTower(c: City, p: StarPoint, k: number) {
  const b = c.b, { hw, band: w, screen: t, rise: R, parapet: pt, parapetH: ph, open } = LOOK, H = 3 * R;
  const D = hw + w - t / 2, wi = hw + w - t;
  b.group(() => {
    b.at(WAYS.lookout.r, 0, 0);
    const col = c.collide(`city/rim-${p.name}-lookout`);
    // the shaft (its top inside the parapet is the platform's paving), string courses round its free face
    b.box(-hw, -1, -hw, hw, H, hw, MAT.PLASTER, { skip: ['bottom', 'top'] });
    for (const y of [4.6, 9.0]) b.band([[-hw, -hw], [-hw, hw - open]], y, y + 0.3, MAT.CREAM, { out: 0.08 });
    col.solid(-hw, -hw, hw, hw, -1, H);
    // slit windows, lit at night, where the stair doesn't pass
    const slit = (side: 'n' | 'e' | 'w', u: number, y: number, glow: number) => onFace(c, side, hw, () => b.with({ glow }, () => b.panel([[u - 0.2, y, 0], [u + 0.2, y, 0], [u + 0.2, y + 1.5, 0], [u - 0.2, y + 1.5, 0]], MAT.WINDOW, { edge: MAT.CREAM })));
    for (const [y, g] of [[2.4, 0.7], [6.2, 0], [10.4, 0.85]] as const) slit('w', 0.6, y, g);
    for (const [u, y, g] of [[-1.5, 7.2, 0.8], [1.5, 10.6, 0], [0, 7.2, 0]] as const) slit('n', u, y, g);
    slit('e', 0, 10.6, 0.8);
    // the stair: its treads and risers between the shaft and the screen, the landings at the corners
    const n = Math.round((2 * hw) / 0.32);
    treads(b, [-hw, 0, -(hw + wi) / 2], [hw, R, -(hw + wi) / 2], w - t, n, MAT.ASHLAR);
    b.slab(rect(hw, -wi, wi, -hw), R, MAT.PAVING);
    treads(b, [(hw + wi) / 2, R, -hw], [(hw + wi) / 2, 2 * R, hw], w - t, n, MAT.ASHLAR);
    b.slab(rect(hw, hw, wi, wi), 2 * R, MAT.PAVING);
    treads(b, [hw, 2 * R, (hw + wi) / 2], [-hw, 3 * R, (hw + wi) / 2], w - t, n, MAT.ASHLAR);
    b.slab(rect(-wi, hw - open + t, -hw, wi), H, MAT.PAVING);
    col.stair(-hw, -wi, hw, -hw, 0, R, 0, 1).floor(hw, -wi, wi, -hw, R);
    col.stair(hw, -hw, wi, hw, R, R, 1, 1).floor(hw, hw, wi, wi, 2 * R);
    col.stair(-hw, hw, hw, wi, 2 * R, R, 0, -1).floor(-wi, hw - open, -hw, wi, H);
    // the screen wall round the stair's outer edge, its top a parapet's height over the treads and the landings
    const path: V2[] = [[-hw, -D], [hw, -D], [D, -D], [D, -hw], [D, hw], [D, D], [hw, D], [-hw, D], [-D, D], [-D, hw - open]];
    const tops = [0, R, R, R, 2 * R, 2 * R, 2 * R, 3 * R, 3 * R, 3 * R].map((y) => y + ph);
    screenWall(b, path, tops, -1, t, MAT.PLASTER, MAT.CREAM);
    col.solid(-hw, -hw - w, hw + w, -wi, -1, R + ph).solid(wi, -hw - w, hw + w, hw + w, -1, 2 * R + ph)
      .solid(-hw - w, wi, hw + w, hw + w, -1, H + ph).solid(-hw - w, hw - open, -wi, hw + w, -1, H + ph);
    // the last landing's pier: its face toward the square, and the parapet along the landing's end over it
    b.quad([-hw, -1, hw - open], [-wi, -1, hw - open], [-wi, H, hw - open], [-hw, H, hw - open], MAT.PLASTER);
    b.box(-wi, H, hw - open, -hw, H + ph, hw - open + t, MAT.PLASTER, { top: MAT.CREAM, skip: ['bottom', 'w', 'e'] });
    col.solid(-wi, hw - open, -hw, hw - open + t, H, H + ph);
    // the platform: its paving inside the parapet and across the gap; the parapet's runs under a cream top, the
    // merlons on them (instanced)
    b.slab(rect(-hw + pt, -hw + pt, hw - pt, hw - pt), H, MAT.PAVING);
    b.slab(rect(-hw, hw - open + t, -hw + pt, hw - pt), H, MAT.PAVING);
    const runs: [number, number, number, number, string[]][] = [
      [-hw, -hw, hw, -hw + pt, []], [-hw, hw - pt, hw, hw, []], [hw - pt, -hw + pt, hw, hw - pt, ['n', 's']], [-hw, -hw + pt, -hw + pt, hw - open + t, ['n']],
    ];
    for (const [x0, z0, x1, z1, skip] of runs) {
      b.box(x0, H, z0, x1, H + ph, z1, MAT.PLASTER, { top: MAT.CREAM, skip: ['bottom', ...skip] });
      col.solid(x0, z0, x1, z1, H, H + ph);
    }
    for (let x = -hw + 0.55; x <= hw - 0.5; x += 1.05) for (const z of [-hw + pt / 2, hw - pt / 2]) b.place('merlon-stepped', [x, H + ph, z]);
    for (let z = -hw + pt + 0.6; z <= hw - pt - 0.5; z += 1.05) {
      b.place('merlon-stepped', [hw - pt / 2, H + ph, z], { yaw: Math.PI / 2 });
      if (z < hw - open - 0.3) b.place('merlon-stepped', [-hw + pt / 2, H + ph, z], { yaw: Math.PI / 2 });
    }
    col.floor(-hw, -hw, hw, hw, H);
    // the pavilion on the platform: four columns, the canopy on them, a blue onion dome with a spire, a lantern hung in
    // it
    pavilion(c, col, H, 2.2, 3.0, k);
  });
}

/** an open pavilion on a floor at y: four columns at ±s, `h` tall, a capped canopy over them, its top round the drum
 *  of an onion dome; a lantern hung under it, lit at night */
export function pavilion(c: City, col: Collide, y: number, s: number, h: number, k: number) {
  const b = c.b, e = s + 0.55, ch = 0.55, co = 0.16, dr = 2.3;
  for (const [x, z] of [[-s, -s], [s, -s], [s, s], [-s, s]]) {
    b.group(() => { b.at(x, y, z); column(b, { order: 'octagon', h, r: 0.2, top: false, seed: k }); });
    col.solid(x - 0.25, z - 0.25, x + 0.25, z + 0.25, y, y + h);
  }
  // the canopy: its body, its cap standing out round it (the overhang's underside, its sides), the cap's top round
  // the drum
  const yc = y + h + ch * 0.55;
  b.box(-e, y + h, -e, e, yc, e, MAT.CREAM, { skip: ['top'] });
  b.box(-e - co, yc, -e - co, e + co, y + h + ch, e + co, MAT.CREAM, { skip: ['top', 'bottom'] });
  between(b, rect(-e - co, -e - co, e + co, e + co), rect(-e, -e, e, e), [0, 0], yc, MAT.CREAM, true);
  const drum = Array.from({ length: 32 }, (_, i) => { const a = (i / 32) * Math.PI * 2; return [Math.cos(a) * dr * 1.02, Math.sin(a) * dr * 1.02] as V2; });
  between(b, rect(-e - co, -e - co, e + co, e + co), drum, [0, 0], y + h + ch, MAT.CREAM);
  b.group(() => {
    b.at(0, y + h + ch, 0);
    spire(b, domePart(b, { kind: 'onion', r: dr, drum: 0.7, finial: null, glaze: [1, 1, 1], seed: k }).top, 1.5);
  });
  b.group(() => { b.at(0, y + h, 0); keep(c, lantern(b, { kind: 'hanging', drop: 0.5, candela: 220, seed: k })); });
  col.solid(-e - co, -e - co, e + co, e + co, y + h, y + h + ch);
}

// ------------------------------------------------------------------------------------------------- the water gate

/** one of the water gate's round towers (see the header), its foot by the sluice's walk, its door facing it */
function gateTower(c: City, side: -1 | 1) {
  const b = c.b, R = GATE.towerR, G = GT.gallery, n = GT.sides;
  const zc = GATE.z + side * (GATE.width / 2 + R);
  b.group(() => {
    b.at(GATE.x, 0, zc);
    const col = c.collide(`city/gate-tower-${side < 0 ? 'n' : 's'}`);
    // the battered foot, the shaft narrowing a little up to the gallery's corbels, cream bands round it
    const rAt = (y: number) => R - 0.3 * Math.max(0, (y - GT.foot) / (G - 1.4 - GT.foot));
    b.cylinder(0, 0, R + GT.batter, -2, GT.foot, n, MAT.ASHLAR, { r1: R, top: null });
    b.cylinder(0, 0, R, GT.foot, G - 1.4, n, MAT.PLASTER, { r1: rAt(G - 1.4), top: null });
    for (const y of [GT.foot, 11.5, 17.5]) ring(c, rAt(y), rAt(y + 0.4), 0.14, y, 0.4, n, MAT.CREAM);
    // slit windows round it, half of them lit at night
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      for (const y of [6.5, 13.6, 19.2]) {
        b.group(() => {
          b.at(Math.cos(a) * rAt(y), 0, Math.sin(a) * rAt(y), -a + Math.PI / 2);
          b.with({ glow: (i + Math.round(y)) % 2 ? 0.85 : 0 }, () => b.panel([[-0.22, y, 0], [0.22, y, 0], [0.22, y + 1.8, 0], [-0.22, y + 1.8, 0]], MAT.WINDOW, { edge: MAT.CREAM }));
        });
      }
    }
    // the gallery: the corbels flaring out to it, its floor's edge, its parapet (outside, top, inside), merlons on it
    // (instanced), its floor round the drum
    const ro = R + 1.1, ri = ro - 0.5, yf = G + 0.6, yp = yf + 1.0;
    b.cylinder(0, 0, rAt(G - 1.4), G - 1.4, G, n, MAT.CREAM, { r1: ro, top: null });
    b.cylinder(0, 0, ro, G, yp, n, MAT.PLASTER, { top: null });
    b.lathe(0, 0, 0, [[ri, yp], [ri, yf]], n, MAT.PLASTER);
    annulus(b, 0, 0, ri, ro, yp, n, MAT.CREAM);
    // (the floor runs in under the drum's plinth)
    const dr = 5.0;
    annulus(b, 0, 0, dr * 1.02 + 0.2, ri, yf, n, MAT.PAVING);
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2, r = (ro + ri) / 2;
      b.place('merlon-stepped', [Math.cos(a) * r, yp, Math.sin(a) * r], { yaw: -a - Math.PI / 2, scale: 1.25 });
    }
    // the drum of lit arched windows (on a plinth, so they show over the merlons) and the blue dome with its spire;
    // braziers round the gallery, lamps under the dome's springing lighting it from below
    const dp = 1.6, rp = dr * 1.02 + 0.25;
    b.cylinder(0, 0, rp, yf, yf + dp, n, MAT.CREAM, { top: null });
    annulus(b, 0, 0, dr * 1.02 - 0.05, rp, yf + dp, n, MAT.CREAM);
    b.group(() => {
      b.at(0, yf + dp, 0);
      const top = domePart(b, { kind: 'pointed', r: dr, drum: 3.0, windows: true, finial: null, glaze: [1, 1, 1], seed: side < 0 ? 3 : 4 }).top;
      spire(b, top, 2.9);
    });
    for (let i = 0; i < 4; i++) {
      const a = ((i + 0.5) / 4) * Math.PI * 2, r = (rp + ri) / 2;
      brazier(c, Math.cos(a) * r, yf, Math.sin(a) * r, 0.9);
      c.light([Math.cos(a + Math.PI / 4) * (rp + 0.8), yf + dp + 1.4, Math.sin(a + Math.PI / 4) * (rp + 0.8)], 240, { radius: 12 });
    }
    // the door: a porch on the side toward the sluice, lattice doors under a pointed arch in a cream frame, a lantern
    // over it, lamps either side of it on its apron (the paving between the sluice's walk and the porch)
    b.group(() => {
      b.at(0, 0, 0, side < 0 ? Math.PI : 0);
      // (this frame's -z faces the sluice; the walk's edge, |z| 5.5 in the world, is 9 m before the tower's middle)
      const zf = -(R + 0.4), ze = -(Math.abs(zc) - GATE.width / 2 + 1.5);
      b.box(-2.0, -1, zf, 2.0, 4.8, -(R - 1.5), MAT.ASHLAR, { top: MAT.CREAM, skip: ['bottom', 's'] });
      b.group(() => {
        b.at(0, PAVE, zf, Math.PI);
        archPanel(b, 2.9, 4.0, MAT.CREAM, 0);
        b.with({ pal: TILE_PAL.PALACE }, () => archPanel(b, 2.2, 3.4, MAT.LATTICE, PROUD));
      });
      b.slab(rect(-2.6, ze, 2.6, zf), PAVE, MAT.PAVING);
      for (const x of [-2.2, 2.2]) b.group(() => { b.at(x, PAVE, (ze + zf) / 2); keep(c, lantern(b, { kind: 'post', post: 2.6, candela: 160, seed: side + 7 })); });
      col.solid(-2.0, zf, 2.0, -(R - 1.5), -1, 4.8).floor(-2.6, ze, 2.6, zf, PAVE);
    });
    col.solid(-R * 0.9, -R * 0.9, R * 0.9, R * 0.9, -2, yp);
  });
}

// ------------------------------------------------------------------------------------------------- the pieces

/** a gold spire on a dome's tip at y, h tall (the parts' spire finial at its mid detail: near, its turned profile
 *  folds back on itself and its normals fight its winding) */
function spire(b: City['b'], y: number, h: number) {
  b.group(() => { b.at(0, y - 0.02, 0); finialPart(b, { kind: 'spire', h, detail: 'mid' }); });
}

/** a part's lights into the city's */
function keep(c: City, l: Laid) { c.lights.push(...l.lights); }

/** a band round a cylinder: its face (r out from the shaft's radius ra at y to rb at y + h), its top and its underside
 *  (rings back to the shaft) */
function ring(c: City, ra: number, rb: number, out: number, y: number, h: number, n: number, mat: Mat) {
  const b = c.b;
  b.cylinder(0, 0, ra + out, y, y + h, n, mat, { r1: rb + out, top: null });
  annulus(b, 0, 0, rb, rb + out, y + h, n, mat);
  annulus(b, 0, 0, ra, ra + out, y, n, mat, true);
}

/** run fn in a face's frame of a square shaft (half-width hw): x along the face (left to right seen from outside), y
 *  up, z out of it, the face at z 0 */
function onFace(c: City, side: 'n' | 's' | 'e' | 'w', hw: number, fn: () => void) {
  const b = c.b;
  b.group(() => {
    if (side === 's') b.at(0, 0, hw);
    else if (side === 'n') b.at(0, 0, -hw, Math.PI);
    else if (side === 'e') b.at(hw, 0, 0, Math.PI / 2);
    else b.at(-hw, 0, 0, -Math.PI / 2);
    fn();
  });
}

/** a wall along a local plan path from y0 up to a top that runs straight between the heights given at its points
 *  (a stair's screen: level along the landings, sloped along the flights), `t` thick (centred on the path), mitred at
 *  the corners: both faces, the top (of `cap`), its two ends */
function screenWall(b: City['b'], path: V2[], tops: number[], y0: number, t: number, mat: Mat, cap: Mat) {
  const L = offsetPathOpen(path, t / 2), Rr = offsetPathOpen(path, -t / 2), n = path.length;
  const P = (q: V2, y: number): V3 => [q[0], y, q[1]];
  for (let i = 0; i + 1 < n; i++) {
    const j = i + 1;
    b.quad(P(L[j], y0), P(L[i], y0), P(L[i], tops[i]), P(L[j], tops[j]), mat);
    b.quad(P(Rr[i], y0), P(Rr[j], y0), P(Rr[j], tops[j]), P(Rr[i], tops[i]), mat);
    b.quad(P(Rr[i], tops[i]), P(Rr[j], tops[j]), P(L[j], tops[j]), P(L[i], tops[i]), cap);
  }
  b.quad(P(L[0], y0), P(Rr[0], y0), P(Rr[0], tops[0]), P(L[0], tops[0]), mat);
  b.quad(P(Rr[n - 1], y0), P(L[n - 1], y0), P(L[n - 1], tops[n - 1]), P(Rr[n - 1], tops[n - 1]), mat);
}
/** an open path moved d to the left of its travel, mitred (builder.ts offsetPath) */
function offsetPathOpen(path: V2[], d: number): V2[] {
  const n = path.length;
  const dir = (i: number): V2 => { const a = path[i], q = path[i + 1], l = Math.hypot(q[0] - a[0], q[1] - a[1]) || 1; return [(q[0] - a[0]) / l, (q[1] - a[1]) / l]; };
  return path.map((p, i) => {
    const tin = dir(Math.max(0, i - 1)), tout = dir(Math.min(n - 2, i));
    const nl: V2 = [tin[1], -tin[0]], nr: V2 = [tout[1], -tout[0]], m: V2 = [nl[0] + nr[0], nl[1] + nr[1]], ml = Math.hypot(m[0], m[1]);
    if (ml < 1e-9) return [p[0] + nr[0] * d, p[1] + nr[1] * d] as V2;
    const k = 1 / Math.max((m[0] * nr[0] + m[1] * nr[1]) / ml, 0.25);
    return [p[0] + (m[0] / ml) * d * k, p[1] + (m[1] / ml) * d * k] as V2;
  });
}

/** a pointed-arched panel on a wall (its frame: x along it, y up from the sill, z out), w wide and h to its crown, on
 *  the surface `by` out of the wall, standing PROUD off that, its edges down to it */
function archPanel(b: City['b'], w: number, h: number, mat: Mat, by: number) {
  b.panel(shapeOf(w, h, 'pointed', 12).hole.map(([x, y]) => [x, y, by] as V3), mat);
}
