// The market's plan, in its own frame: x east and z south from MARKET's centre (layout.ts: the west point's grand
// market, its claim the sixteen-gon round its ellipse), y up from FLOOR_Y. Everything the market's builders lay is
// placed from here, so the souks, the gates, the hall, the courts and the stalls keep out of one another by design:
//
//              N gate (shut to the town: lattice doors)
//        ╱‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾╲          the souks: a covered street round the whole edge, its
//      ╱   stalls        ┆        stalls      ╲        shops in the outer block, its arcade onto the market
//  W  ┃  ○ pavilions ═══ HALL ═══ fountain ○   ┃  E   the avenue (from market-in, the ring road's side, east, to
//  gate ╲   stalls        ┆        stalls      ╱ gate   market-out, west, toward the tip) through the gates, the
//        ╲________________________________╱          courts and the domed hall; the cross street N-S through it
//              S gate
//
// The souks run round the outline's sixteen sides (Side: each a straight run in its own frame, x along it from its
// first corner, z in toward the middle), mitred where they turn: at a depth d in from the outer face a side runs from
// x0(d) to x1(d). The four gates stand at the outline's corners on the axes (the claim's own corners: the avenue's
// ports sit on the east and west ones), each a domed crossing where the souk street passes the gate's way; a side
// that meets a gate stops inside the gate's block.
import { MARKET, type V2 } from '../../world/layout';

/** the claim's sixteen-gon (layout.ts's west/market: round the ellipse, its corners on it scaled by 1/cos(π/16)) */
const K = 1 / Math.cos(Math.PI / 16);
const CLAIM: V2[] = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  return [Math.cos(a) * MARKET.rx * K, Math.sin(a) * MARKET.rz * K] as V2;
});

/** how far inside its claim the market's outer face stands (m): off the town's walls built against it */
export const EDGE = 0.4;

/** the inward normal of the edge a -> b of a polygon wound from the east through the south (x east, z south) */
function inward(a: V2, b: V2): V2 {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  return [-dz / L, dx / L];
}

/** a polygon's corner k moved in by d (where its two sides' lines, each moved in by d, meet) */
function mitre(p: V2[], k: number, d: number): V2 {
  const n = p.length, a = p[(k + n - 1) % n], c = p[k], e = p[(k + 1) % n];
  const n0 = inward(a, c), n1 = inward(c, e), k1 = 1 + n0[0] * n1[0] + n0[1] * n1[1];
  return [c[0] + (d * (n0[0] + n1[0])) / k1, c[1] + (d * (n0[1] + n1[1])) / k1];
}

/** the market's outer face: the claim's sixteen-gon EDGE in */
export const OUT: V2[] = CLAIM.map((_, k) => mitre(CLAIM, k, EDGE));
/** the outline's corner k moved in by d (m) */
export const corner = (k: number, d: number): V2 => mitre(OUT, ((k % 16) + 16) % 16, d);

// ------------------------------------------------------------------------------------------------- the souks

/** the souks' section, in from the outer face (m): the shop block (its outer wall and the shops' niches, `niche` deep,
 *  their fronts at `front`), the covered street, the arcade (its back face at `arcade - wall / 2`) onto the market */
export const SOUK = {
  /** the shop block's front, the shops' niches' depth from it */
  front: 3.6, niche: 2.5,
  /** the arcade's line and its wall's thickness */
  arcade: 9.2, wall: 0.6,
  /** the shop block's roof and its parapet's top, the arcade's coping's foot */
  roof: 7.4, parapet: 8.2, arcadeTop: 6.5,
  /** the souk street's paving over the market's */
  floor: 0.11,
  /** the shops' openings: their width, their head; the pitch they repeat at */
  shopW: 3.4, shopH: 2.9, shopPitch: 4.5,
  /** the arcade's arches: their span and spring, the columns between them (their width, the abacus's) */
  span: 3.5, spring: 3.3, pier: 0.7,
  /** the canopy: the beams' foot over the street, the cloth over them */
  beam: 6.05,
};
/** the street's middle, its half-width (between the shops' fronts and the arcade's back) */
export const STREET = { mid: (SOUK.front + SOUK.arcade - SOUK.wall / 2) / 2, half: (SOUK.arcade - SOUK.wall / 2 - SOUK.front) / 2 };

/** a side of the outline, the frame its souk is laid in: its first corner, along it (u), in toward the middle (n),
 *  its yaw for ArchBuilder.at (local x along u, local z along n) and its length */
export interface Side { k: number; o: V2; u: V2; n: V2; yaw: number; len: number }
export const SIDES: Side[] = OUT.map((o, k) => {
  const e = OUT[(k + 1) % 16], L = Math.hypot(e[0] - o[0], e[1] - o[1]);
  const u: V2 = [(e[0] - o[0]) / L, (e[1] - o[1]) / L];
  return { k, o, u, n: [-u[1], u[0]], yaw: Math.atan2(-u[1], u[0]), len: L };
});
/** a side-frame point (x along, d in) in the market's frame */
export const onSide = (s: Side, x: number, d: number): V2 => [s.o[0] + s.u[0] * x + s.n[0] * d, s.o[1] + s.u[1] * x + s.n[1] * d];
/** a market point in a side's frame (x along, d in) */
export const toSide = (s: Side, p: V2): V2 => {
  const dx = p[0] - s.o[0], dz = p[1] - s.o[1];
  return [dx * s.u[0] + dz * s.u[1], dx * s.n[0] + dz * s.n[1]];
};

// ------------------------------------------------------------------------------------------------- the gates

/** a gate: its corner of the outline (on an axis), the axis out (unit), the block's reach along it (inner face to
 *  outer face, m from the middle) and its half-width across, the walls' thickness, its height (the roof), the way
 *  through (its portals' width and height to the crown), whether it opens onto the town (the east and west on the
 *  avenue) or is shut there (lattice doors), and where the souk's street crosses it (along the axis) */
export interface Gate { name: 'east' | 'south' | 'west' | 'north'; k: number; axis: V2; across: V2; inner: number; outer: number; half: number; wall: number; h: number; way: { w: number; h: number }; open: boolean; street: number }
const AXES: [Gate['name'], number, V2][] = [['east', 0, [1, 0]], ['south', 4, [0, 1]], ['west', 8, [-1, 0]], ['north', 12, [0, -1]]];
export const GATES: Gate[] = AXES.map(([name, k, axis]) => {
  const great = name === 'east' || name === 'west', half = great ? 7 : 6, across: V2 = [-axis[1], axis[0]];
  // (its outer face where the outline is nearest the middle across its width, a few centimetres in)
  const reach = (t: number) => {
    // the outline's two sides from the corner, met by the line across the axis at offset t
    let r = Infinity;
    for (const [a, b] of [[OUT[(k + 15) % 16], OUT[k]], [OUT[k], OUT[(k + 1) % 16]]]) {
      const ta = a[0] * across[0] + a[1] * across[1], tb = b[0] * across[0] + b[1] * across[1];
      if ((t - ta) * (t - tb) > 0) continue;
      const f = (t - ta) / (tb - ta), p: V2 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      r = Math.min(r, p[0] * axis[0] + p[1] * axis[1]);
    }
    return r;
  };
  const outer = Math.min(reach(half), reach(-half)) - 0.05, depth = great ? 13.5 : 12;
  // (the souk street's middle where it crosses the gate's flank, along the axis: on the side that runs in from the
  // corner, at the street's middle depth)
  const s = SIDES[k], t = (half - (s.o[0] * across[0] + s.o[1] * across[1]) - STREET.mid * (s.n[0] * across[0] + s.n[1] * across[1])) / (s.u[0] * across[0] + s.u[1] * across[1]);
  const p = onSide(s, t, STREET.mid);
  return { name, k, axis, across, inner: outer - depth, outer, half, wall: 1.5, h: great ? 12.5 : 11, way: great ? { w: 7, h: 10.5 } : { w: 4.6, h: 7.6 }, open: true, street: p[0] * axis[0] + p[1] * axis[1] };
});
export const gateAt = (k: number) => GATES.find((g) => g.k === ((k % 16) + 16) % 16);

/** where a side's run stops at a gate's block, at depth d (side-frame x): `end` the side's last corner is the gate's,
 *  else its first; `into` how far into the block it reaches (its end hidden there) */
export function gateCut(s: Side, g: Gate, d: number, into = 0.3): number {
  // (the line at depth d along the side meets the block's flank, across = ±half: the flank on the side's own side of
  // the axis)
  const o = onSide(s, 0, d), ta = o[0] * g.across[0] + o[1] * g.across[1], tu = s.u[0] * g.across[0] + s.u[1] * g.across[1];
  const m = onSide(s, s.len / 2, d), sg = Math.sign(m[0] * g.across[0] + m[1] * g.across[1]);
  const x = (sg * g.half - ta) / tu;
  // (into the block: toward the gate's corner)
  return s.k === g.k ? x - into : x + into;
}

/** a side's run at depth d (side-frame x from, to): from its mitred corner, or from inside a gate's block */
export function run(s: Side, d: number, into = 0.3): [number, number] {
  const a = gateAt(s.k), b = gateAt(s.k + 1);
  const x0 = a ? gateCut(s, a, d, into) : toSide(s, corner(s.k, d))[0];
  const x1 = b ? gateCut(s, b, d, into) : toSide(s, corner(s.k + 1, d))[0];
  return [x0, x1];
}

// ------------------------------------------------------------------------------------------------- the middle

/** the avenue's way through the market (its half-width: the port's 16 m) and the cross street's, north to south */
export const AVENUE = { half: 8 };
export const CROSS = { half: 5 };
/** the great hall at the middle: an octagon (its corners' radius, its wall's thickness and height, its openings: the
 *  avenue's east and west, the cross street's north and south), the dome on its drum over it */
export const HALL = { r: 17, wall: 1.2, h: 10, ceiling: 9.4, way: { w: 6.2, h: 8.6 }, cross: { w: 5, h: 7.4 }, dome: { r: 9.2, drum: 2, rise: 7.2 } };
/** the courts on the avenue either side of the hall: the fountain court toward the ring road (east), the ring of
 *  domed pavilions toward the tip (west) */
export const COURT = { east: { x: 58, z: 0, r: 17 }, west: { x: -58, z: 0, r: 17 } };
/** the inside of the arcade: the market's open floor (the paving's edge under the arcade, and the walk along it) */
export const INNER = { edge: SOUK.arcade + SOUK.wall / 2, walk: SOUK.arcade + SOUK.wall / 2 + 3.2 };
/** the open floor inside the arcade's walk (local plan polygon): what the stalls fill */
export const FLOOR_POLY: V2[] = OUT.map((_, k) => corner(k, INNER.walk));

/** the paving's heights, each floor laid over another PROUD over it: the market's square, the avenue's way across it,
 *  a court's (and the souks' streets, which never meet one), the hall's and the gates' */
export const PAVE = { square: 0.07, avenue: 0.09, court: 0.11, hall: 0.13 };
