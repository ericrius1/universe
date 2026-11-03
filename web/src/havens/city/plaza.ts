// The city's civic heart at the south point, where everyone arrives: the plaza (PLAZA) and the square at the grand
// stair's foot (STAIR_SQUARE), both under the plaza's claims (layout.ts CLAIMS: the plaza's sixteen-gon, its apothem
// PLAZA.paved, cut off where the grand hall's close begins; the stair square from the ring road's outer edge round the
// stair's forecourt). The plaza is a great round square paved in rings and rays round a fountain whose basin is the
// star mesa's own eight-pointed star, four flower parterres and their palms, benches, lamps and a canopy of lantern
// strings over it all; round it on the sixteen-gon runs the riwaq — a covered arcade of horseshoe arches on red columns
// with tiled spandrels and the teal frieze, merlons on its coping, a shop's lit doorway behind every bay in a tiled back
// wall — broken by a tiled gate on each of its four ways out to the town (east, west, north-east and north-west), ending
// in domed towers at the south where the plaza opens onto the hall's close, and open to the north between two tall
// minarets onto the stair square. From the plaza north a processional carpet of tiles runs through the stair square to
// the stair's foot between two rows of the grand hall's red pillars (ref 1), the inner ones carrying fires.
// Small parts that repeat (the lanterns, the merlons, the finials) are placed instanced (b.place: parts/protos.ts).
import type { Mat, V3 } from '../arch/types';
import { MAT, TILE_PAL } from '../arch/types';
import { PROUD } from '../arch/builder';
import { abacusOf, arcade, archCurve, column, domePart, pierced, portal, shapeOf } from '../arch/parts';
import { FLOOR_Y, GRAND_HALL, PLAZA, STAIR, STAIR_SQUARE, WAYS, closePoly, polar, subtractConvex, type V2 } from '../world/layout';
import type { City, Collide } from './ctx';
import { Face, type Opening } from './facade';
import { ngon } from './geom';
import { FLOOR } from './ground';
import { GLAZES, banner, brazier, planter, rectPts } from './props';

const PAVE: V3 = [1.08, 1.02, 0.95];
const BAND: V3 = [0.92, 0.62, 0.5];
const DARK: V3 = [0.78, 0.55, 0.48];
/** the inlays' heights over the paving: the rings and rays, and the processional carpet laid over them */
const INLAY = PROUD, CARPET = 2 * PROUD;
/** the carpet's half width (the stair's 14 m less a metre each side) */
const CARPET_HALF = 6;

// ---- the plaza's sixteen-gon (its claim's: layout.ts around(PLAZA, PLAZA.paved, 16, π/16)) in the plaza's frame
const PI16 = Math.PI / 16;
/** vertex k's angle (0 east, π/2 south), and side k's middle (between vertices k and k+1) */
const vAng = (k: number) => PI16 + (k * Math.PI) / 8;
const sAng = (k: number) => ((k + 1) * Math.PI) / 8;
/** vertex k of the sixteen-gon whose apothem is A */
const vAt = (k: number, A: number): V2 => { const r = A / Math.cos(PI16), a = vAng(k); return [Math.cos(a) * r, Math.sin(a) * r]; };
/** where the hall's close begins, in the plaza's frame (the plaza's claim stops there) */
const HALL_FRONT = Math.min(...closePoly(GRAND_HALL).map((q) => q[1])) - PLAZA.z;

/** the riwaq round the plaza: its arcade's centre line and its back wall's (apothems), the back wall's thickness, the
 *  columns' height (the arches' spring) and radius, the bays in a whole side and either side of a gate, how far from a
 *  corner the arcade stops (inside the corner's pier), the gates' passage and height, the back wall's height (its upper
 *  storey over the roof) */
const RW = { arc: 84.6, back: 91.0, tw: 0.7, spring: 4.3, colR: 0.3, bays: 7, gateBays: 2, corner: 1.0, gateSpan: 5.4, gateH: 14.0, upper: 11.7 };
/** the riwaq's sides (sixteen-gon sides by index: 15 the east's, 11 the north's) and what each is: an arcade, an
 *  arcade broken by a gate, or the open north; the ends of the run, at the south-east and south-west, are towers */
type SideKind = 'arcade' | 'gate' | 'open';
const SIDES: [number, SideKind][] = [[6, 'arcade'], [7, 'gate'], [8, 'arcade'], [9, 'gate'], [10, 'arcade'], [11, 'open'], [12, 'arcade'], [13, 'gate'], [14, 'arcade'], [15, 'gate'], [0, 'arcade']];
/** the corners between two arcaded sides (vertex indices): a pier each; the run's ends and the north's two corners: a
 *  tower each */
const PIERS = [7, 8, 9, 10, 13, 14, 15, 0];
const TOWERS: { k: number; kind: 'minaret' | 'end' }[] = [{ k: 11, kind: 'minaret' }, { k: 12, kind: 'minaret' }, { k: 1, kind: 'end' }, { k: 6, kind: 'end' }];

/** the riwaq's arcade as the parts' arcade() lays it at mid detail (arches.ts's arithmetic, so the roof, the back wall
 *  and the merlons meet it): the columns' abacus (the bays' piers), the wall's thickness, a bay's span, the arch's
 *  crown over its spring, the spandrels' top (the roof's top), the wall's top under its coping and the coping's top */
const ARC = (() => {
  // (the wall thinner than its abaci by 10 cm a side: at the parts' own 4 cm the horseshoe's archivolt dipped past the
  // spring into the abacus's face, 3 mm off it)
  const pw = abacusOf({ order: 'round', h: RW.spring, r: RW.colR }).half * 2, t = pw - 0.2;
  const side = 2 * RW.arc * Math.tan(PI16), len = side - 2 * RW.corner;
  const span = (len - (RW.bays + 1) * pw) / RW.bays;
  const crown = archCurve('horseshoe', span, 10).crown;
  const zone = RW.spring + crown + 0.2 + 0.22, h = zone + 0.5 + 0.3;
  return { pw, t, side, len, span, crown, zone, h, top: h + 0.2, gateLen: RW.gateBays * span + (RW.gateBays + 1) * pw };
})();
/** a gate's block along its side (half its width: the arcade either side runs 0.35 m into it) and through the riwaq
 *  (its front stands proud of the arcade's face, its back past the back wall's) */
const GATE = (() => {
  const half = ARC.side / 2 - RW.corner - ARC.gateLen + 0.35;
  return { half, front: ARC.t / 2 + 0.6, back: -(RW.back + RW.tw / 2 + 0.3 - RW.arc) };
})();

export function buildPlaza(c: City) {
  const b = c.b;
  b.group(() => {
    b.at(PLAZA.x, FLOOR_Y, PLAZA.z);
    const y = FLOOR.square;
    const col = c.collide('city/plaza');
    b.owner('paving', () => paving(c, y));
    b.owner('fountain', () => fountain(c, col, y));
    b.owner('garden', () => {
      // four parterres between the rays on the diagonals, palms round them, benches by the basin, lamps on the outer
      // ring
      for (let q = 0; q < 4; q++) {
        const a0 = (q / 4) * Math.PI * 2 + Math.PI / 4 - 0.42, a1 = a0 + 0.84;
        parterre(c, col, 21, 30, a0, a1, y);
      }
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const p: V2 = [Math.cos(a) * 34.5, Math.sin(a) * 34.5];
        planter(c, p[0], p[1], 1.5, 0.75, 'palms', y);
        col.solid(p[0] - 1.5, p[1] - 1.5, p[0] + 1.5, p[1] + 1.5, 0, 0.9);
        b.group(() => {
          b.at(Math.cos(a) * 19.2, 0, Math.sin(a) * 19.2, -a - Math.PI / 2);
          // (a solid block on the paving: the legs it had stood inside it, unseen, their feet and its bottom fighting)
          b.box(-1.6, y, -0.3, 1.6, y + 0.45, 0.3, MAT.CREAM, { skip: ['bottom'] });
        });
      }
      // an outer ring of eight narrower beds of flowers between the ways out, a palm in each
      for (let q = 0; q < 8; q++) {
        const am = (q / 8) * Math.PI * 2 + Math.PI / 8;
        parterre(c, col, 50, 57, am - 0.15, am + 0.15, y, 4);
        const x = Math.cos(am) * 53.5, z = Math.sin(am) * 53.5;
        c.bed(ngon(x, z, 0.9, 6), y + 0.32, 'palms', 1);
      }
      // fires on stands on the diagonals by the basin, before the parterres
      for (let q = 0; q < 4; q++) {
        const a = (q / 4) * Math.PI * 2 + Math.PI / 4, x = Math.cos(a) * 18.6, z = Math.sin(a) * 18.6;
        b.cylinder(x, z, 0.62, y, y + 0.7, 8, MAT.ASHLAR, { top: MAT.CREAM });
        brazier(c, x, y + 0.7, z, 1.2);
        flame(c, x, y + 0.7, z, 1.2);
        col.solid(x - 0.6, z - 0.6, x + 0.6, z + 0.6, 0, y + 2.2);
      }
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
        const x = Math.cos(a) * 60, z = Math.sin(a) * 60;
        b.place('lantern-post', [x, y, z], { yaw: -a, scale: 1.55 });
        col.solid(x - 0.25, z - 0.25, x + 0.25, z + 0.25, 0, 3.6);
      }
    });
    b.owner('canopy', () => canopy(c, col, y));
    // an avenue of palms either side of the carpet from the north gate toward the basin
    b.owner('garden', () => {
      for (const s of [-1, 1]) for (let z = -86; z <= -46; z += 8) {
        planter(c, s * 9.6, z, 1.05, 0.65, 'palms', y);
        col.solid(s * 9.6 - 1.05, z - 1.05, s * 9.6 + 1.05, z + 1.05, 0, 0.8);
      }
    });
  });
  // the riwaq round it (its sides in a few colliders, each turned to its sides)
  b.owner('riwaq', () => b.group(() => {
    b.at(PLAZA.x, FLOOR_Y + FLOOR.square, PLAZA.z);
    riwaq(c);
  }));
  b.owner('stair-square', () => stairSquare(c));
}

// ------------------------------------------------------------------------------------------------- the ground

/** the plaza's paving: its claim's sixteen-gon (cut at the hall's close) in cream flags, rings and rays inlaid in it, an
 *  eight-pointed star of flags round the basin's step; the processional carpet from the north up to the basin */
function paving(c: City, y: number) {
  const b = c.b;
  const outline: V2[] = [];
  for (let k = 0; k < 16; k++) outline.push(vAt(k, PLAZA.paved));
  b.with({ tint: PAVE }, () => b.slab(clipZ(outline, HALL_FRONT), y, MAT.PAVING));
  // rings and rays in the paving
  const yi = y + INLAY;
  // (anything of them past the hall's close cut off at its edge)
  const inlay = (p: V2[]) => { const q = clipZ(p, HALL_FRONT - 0.05); if (q.length >= 3) b.poly(q.map(([x, z]) => [x, yi, z] as V3), MAT.PAVING); };
  const ringBand = (r0: number, r1: number, tint: V3, n = 48) => b.with({ tint }, () => {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      inlay([[Math.cos(a1) * r0, Math.sin(a1) * r0], [Math.cos(a1) * r1, Math.sin(a1) * r1], [Math.cos(a0) * r1, Math.sin(a0) * r1], [Math.cos(a0) * r0, Math.sin(a0) * r0]]);
    }
  });
  ringBand(20, 21.4, BAND);
  ringBand(37, 38.2, BAND);
  ringBand(PLAZA.r - 1.6, PLAZA.r, BAND, 64);
  // (the rays run between the rings, level with them, their ends on the rings' edges: laid over the middle ring 2 mm
  // above it, they fought it. The rings are polygons with a corner on every ray: a ray's end is a shallow V. The
  // north ray is under the carpet: left out)
  const chord = (R: number, n: number, s: number) => { const d = (Math.PI * 2) / n; return R * (1 - (Math.abs(s) / (R * Math.sin(d))) * (1 - Math.cos(d))); };
  b.with({ tint: DARK }, () => {
    for (let i = 0; i < 16; i++) {
      if (i === 12) continue;
      const a = (i / 16) * Math.PI * 2, w = 0.45, ca = Math.cos(a), sa = Math.sin(a);
      const p = (r: number, s: number): V2 => [ca * r - sa * s, sa * r + ca * s];
      for (const [r0, n0, r1, n1] of [[21.4, 48, 37, 48], [38.2, 48, PLAZA.r - 1.6, 64]]) {
        inlay([p(chord(r1, n1, w), w), p(chord(r0, n0, w), w), p(r0, 0), p(chord(r0, n0, -w), -w), p(chord(r1, n1, -w), -w), p(r1, 0)].reverse());
      }
    }
  });
  // the carpet: from the plaza's north edge to the basin's step (the stair square lays the rest of it to the stair)
  carpet(c, -PLAZA.paved, -STEP_R - 0.4, [false, true]);
}

/** the processional carpet along the plaza's frame's north-south axis from z0 to z1 (z0 < z1): a field of tiles
 *  between borders, laid over the paving and its inlays; its ends' edges where it doesn't run on (`ends`: north, south) */
function carpet(c: City, z0: number, z1: number, ends: [boolean, boolean]) {
  const b = c.b, y = FLOOR.square + CARPET, h = CARPET_HALF, bw = 0.7;
  b.with({ pal: TILE_PAL.HALL }, () => {
    b.slab(rectPts(-h + bw, z0, h - bw, z1), y, MAT.TILE);
    b.slab(rectPts(-h, z0, -h + bw, z1), y, MAT.TILE_BORDER);
    b.slab(rectPts(h - bw, z0, h, z1), y, MAT.TILE_BORDER);
  });
  // its edges down to the paving, so it reads as a slab of tiles
  b.with({ tint: PAVE }, () => {
    b.quad([-h, y, z0], [-h, FLOOR.square, z0], [-h, FLOOR.square, z1], [-h, y, z1], MAT.CREAM);
    b.quad([h, y, z1], [h, FLOOR.square, z1], [h, FLOOR.square, z0], [h, y, z0], MAT.CREAM);
    if (ends[0]) b.quad([h, FLOOR.square, z0], [-h, FLOOR.square, z0], [-h, y, z0], [h, y, z0], MAT.CREAM);
    if (ends[1]) b.quad([-h, FLOOR.square, z1], [h, FLOOR.square, z1], [h, y, z1], [-h, y, z1], MAT.CREAM);
  });
}

/** a convex outline cut at local z = zc (what's north of it kept) */
function clipZ(p: V2[], zc: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], q = p[(i + 1) % p.length];
    if (a[1] <= zc) out.push(a);
    if ((a[1] < zc) !== (q[1] < zc)) { const t = (zc - a[1]) / (q[1] - a[1]); out.push([a[0] + (q[0] - a[0]) * t, zc]); }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------- the fountain

/** the basin's star: the two squares' corner radius at the rim's outer face, the rim's width and the step's */
const STAR_R = 15, RIM_W = 0.6, STEP_W = 1.0;
/** how far out the basin's step reaches at its points */
const STEP_R = STAR_R + STEP_W * Math.SQRT2;
/** an eight-pointed star of two squares (the khatam: the mesa's own shape), its points at radius R on the axes and the
 *  diagonals: one square's corners and the other's. Two stars of different R have edges parallel, √½·ΔR apart */
function star(R: number): V2[] {
  const n = R * Math.cos(Math.PI / 4) / Math.cos(Math.PI / 8);
  return Array.from({ length: 16 }, (_, i) => { const a = (i * Math.PI) / 8, r = i % 2 ? n : R; return [Math.cos(a) * r, Math.sin(a) * r] as V2; });
}

/** the great fountain: its basin an eight-pointed star (open, its water 0.56 m deep over a mosaic floor) in a rim on a
 *  step, a tiered fountain of three bowls with a gold finial in it; the rim's outer faces a band of interlaced stars in
 *  turquoise and cobalt, the step's risers a border of diamonds and chevrons. The step is walked onto, the rim is a
 *  wall to jump onto and walk round, and the basin is waded in */
function fountain(c: City, col: Collide, y: number) {
  const b = c.b, STEP_H = 0.25, RIM_H = 0.85;
  const out = star(STAR_R), inn = star(STAR_R - RIM_W * Math.SQRT2), stp = star(STEP_R);
  const n = out.length;
  const P = (q: V2, h: number): V3 => [q[0], h, q[1]];
  // a ring between two stars at height h facing up, and a star's faces between two heights facing out (or in)
  const ring = (a: V2[], z: V2[], h: number, m: Mat) => { for (let i = 0; i < n; i++) { const j = (i + 1) % n; b.quad(P(a[j], h), P(z[j], h), P(z[i], h), P(a[i], h), m); } };
  const sides = (s: V2[], h0: number, h1: number, m: Mat, inward = false) => {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (inward) b.quad(P(s[i], h0), P(s[j], h0), P(s[j], h1), P(s[i], h1), m);
      else b.quad(P(s[j], h0), P(s[i], h0), P(s[i], h1), P(s[j], h1), m);
    }
  };
  sides(stp, y, y + STEP_H, MAT.ASHLAR);
  ring(out, stp, y + STEP_H, MAT.CREAM);
  sides(out, y + STEP_H, y + RIM_H, MAT.CREAM);
  ring(inn, out, y + RIM_H, MAT.CREAM);
  b.with({ pal: TILE_PAL.FOUNTAIN }, () => {
    sides(star(STAR_R + PROUD * Math.SQRT2), y + STEP_H + 0.07, y + RIM_H - 0.07, MAT.TILE_BAND);
    sides(star(STEP_R + PROUD * Math.SQRT2), y + 0.035, y + STEP_H - 0.035, MAT.TILE_BORDER);
  });
  // the basin's inner wall, facing in toward the water, and its floor
  sides(inn, y + 0.1, y + RIM_H, MAT.POOL, true);
  b.slab(inn, y + 0.12, MAT.POOL);
  c.pool(inn, y + 0.68, 0.56);
  // the tiers
  const tiers: [number, number, number][] = [[1.4, 2.8, 4.6], [0.9, 4.6, 3.0], [0.55, 6.3, 1.7]];
  b.cylinder(0, 0, 2.2, y + 0.1, y + 1.0, 16, MAT.CREAM, { r1: 1.6, top: null });
  for (const [stem, h, bowl] of tiers) {
    b.cylinder(0, 0, stem, y + 0.9, y + h, 12, MAT.CREAM, { r1: stem * 0.8, top: null });
    b.cylinder(0, 0, stem * 0.9, y + h, y + h + 0.5, 20, MAT.CREAM, { r1: bowl, top: MAT.POOL });
    b.cylinder(0, 0, bowl, y + h + 0.5, y + h + 0.72, 20, MAT.GOLD, { top: null });
  }
  b.cylinder(0, 0, 0.3, y + 6.8, y + 7.6, 8, MAT.CREAM, { r1: 0.2 });
  b.dome(0, y + 7.6, 0, 0.42, MAT.GOLD, { rise: 0.9, tip: 0.9, rings: 5, sides: 10 });
  // the step a floor round it, the rim a run of solid boxes with floors on top, the basin's floor under the water (its
  // octagon and its points), the tiers' stem solid
  const along = (s: V2[], w: number, fn: (x0: number, z0: number, x1: number, z1: number) => void) => {
    for (let i = 0; i < n; i++) {
      const a = s[i], q = s[(i + 1) % n], L = Math.hypot(q[0] - a[0], q[1] - a[1]), m = Math.ceil(L / (w * 0.85));
      for (let k = 0; k < m; k++) { const t = (k + 0.5) / m, x = a[0] + (q[0] - a[0]) * t, z = a[1] + (q[1] - a[1]) * t; fn(x - w / 2, z - w / 2, x + w / 2, z + w / 2); }
    }
  };
  along(star(STAR_R + (STEP_W / 2) * Math.SQRT2), 0.8, (x0, z0, x1, z1) => col.floor(x0, z0, x1, z1, y + STEP_H));
  along(star(STAR_R - (RIM_W / 2) * Math.SQRT2), 0.6, (x0, z0, x1, z1) => col.solid(x0, z0, x1, z1, 0, y + RIM_H).floor(x0, z0, x1, z1, y + RIM_H));
  const core = inn.filter((_, i) => i % 2 === 1);
  col.polyFloor(core, y + 0.12);
  for (let i = 0; i < n; i += 2) col.polyFloor([inn[(i + n - 1) % n], inn[i], inn[i + 1]], y + 0.12);
  col.solid(-2.2, -2.2, 2.2, 2.2, 0, y + 7);
}

/** a flower parterre: a ring sector between radii r0 and r1 and angles a0 and a1, in a stone curb */
function parterre(c: City, col: Collide, r0: number, r1: number, a0: number, a1: number, y: number, n = 8) {
  const b = c.b;
  const pts: V2[] = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([Math.cos(a) * r1, Math.sin(a) * r1]); }
  for (let i = n; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / n; pts.push([Math.cos(a) * r0, Math.sin(a) * r0]); }
  // the curb round it, mitred at its corners (short boxes overlapping at them fought), its cream top a cap; the soil
  // inside
  b.wall(pts, y, y + 0.34, 0.4, MAT.ASHLAR, { cap: MAT.CREAM, capH: 0.06, capOut: 0, closed: true });
  // (the sector is not convex: its soil and beds go in as quads between the two arcs)
  for (let i = 0; i < n; i++) {
    const A = pts[i], B = pts[i + 1], C = pts[2 * n + 1 - (i + 1)], D = pts[2 * n + 1 - i];
    b.poly([[A[0], y + 0.32, A[1]], [B[0], y + 0.32, B[1]], [C[0], y + 0.32, C[1]], [D[0], y + 0.32, D[1]]].reverse() as V3[], MAT.SOIL);
    c.bed([A, B, C, D], y + 0.32, i % 3 === 1 ? 'shrubs' : 'flowers', 0.9, i % 2 ? 'pink' : 'mixed');
    const mx = (A[0] + C[0]) / 2, mz = (A[1] + C[1]) / 2;
    col.solid(mx - 1.2, mz - 1.2, mx + 1.2, mz + 1.2, 0, 0.4);
  }
}

/** a canopy of lantern strings over the fountain: eight slender red masts round it, strung to each other and up to the
 *  fountain's gold finial — paper lanterns on the cords, every few a brass cage hung on its chain that lights the
 *  square */
function canopy(c: City, col: Collide, y: number) {
  const b = c.b, r = 44, h = 9.5, n = 8;
  const tints: V3[] = [[1.3, 0.5, 0.2], [1.3, 0.85, 0.25], [1.15, 0.3, 0.3]];
  const masts: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
    b.box(x - 0.45, y, z - 0.45, x + 0.45, y + 0.6, z + 0.45, MAT.CREAM, { skip: ['bottom'] });
    b.box(x - 0.18, y + 0.6, z - 0.18, x + 0.18, y + h, z + 0.18, MAT.RED, { skip: ['bottom', 'top'] });
    b.cylinder(x, z, 0.3, y + h, y + h + 0.9, 4, MAT.GOLD, { r1: 0.03 });
    col.solid(x - 0.45, z - 0.45, x + 0.45, z + 0.45, 0, y + h);
    masts.push([x, y + h - 0.3, z]);
  }
  for (let i = 0; i < n; i++) {
    cordOfLanterns(c, masts[i], masts[(i + 1) % n], 1.6, 1.9, tints, 9);
    cordOfLanterns(c, masts[i], [0, y + 8.2, 0], 1.4, 1.9, tints, 12);
  }
}

/** a string of lanterns between two local points, sagging `sag` at its middle: paper lanterns every `every` m on the
 *  cord, and every `cage`-th a brass cage on its chain instead (instanced: each lights the square round it) */
function cordOfLanterns(c: City, a: V3, z: V3, sag: number, every: number, tints: V3[], cage: number) {
  const b = c.b;
  const L = Math.hypot(z[0] - a[0], z[2] - a[2]);
  const n = Math.max(2, Math.round(L / every));
  const at = (t: number): V3 => [a[0] + (z[0] - a[0]) * t, a[1] + (z[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (z[2] - a[2]) * t];
  // the cord: thin segments, both sides
  const segs = Math.min(10, n + 1);
  for (let i = 0; i < segs; i++) {
    const p = at(i / segs), q = at((i + 1) / segs);
    const dx = q[0] - p[0], dz = q[2] - p[2], l = Math.hypot(dx, dz) || 1;
    const sx = (-dz / l) * 0.02, sz = (dx / l) * 0.02;
    b.poly([[p[0] - sx, p[1] - 0.02, p[2] - sz], [q[0] - sx, q[1] - 0.02, q[2] - sz], [q[0] + sx, q[1] + 0.02, q[2] + sz], [p[0] + sx, p[1] + 0.02, p[2] + sz]], MAT.WOOD);
    b.poly([[p[0] + sx, p[1] - 0.02, p[2] + sz], [q[0] + sx, q[1] - 0.02, q[2] + sz], [q[0] - sx, q[1] + 0.02, q[2] - sz], [p[0] - sx, p[1] + 0.02, p[2] - sz]], MAT.WOOD);
  }
  for (let i = 1; i < n; i++) {
    const p = at(i / n);
    if (i % cage === Math.floor(cage / 2)) b.place('lantern-hanging', [p[0], p[1] - 0.02, p[2]], { scale: 0.9 });
    else paperLantern(c, [p[0], p[1] - 0.3, p[2]], 0.16, tints[i % tints.length]);
  }
}

/** a paper lantern seen from across a square: a lit spindle of eight faces (its cloth glows at night) */
function paperLantern(c: City, p: V3, r: number, tint: V3) {
  const b = c.b, h = r * 1.35, top: V3 = [p[0], p[1] + h, p[2]], bot: V3 = [p[0], p[1] - h, p[2]];
  const ring: V3[] = [0, 1, 2, 3].map((i) => [p[0] + Math.cos((i * Math.PI) / 2 + Math.PI / 4) * r, p[1], p[2] + Math.sin((i * Math.PI) / 2 + Math.PI / 4) * r]);
  b.with({ tint, glow: 1 }, () => {
    for (let i = 0; i < 4; i++) {
      const a = ring[i], q = ring[(i + 1) % 4];
      b.poly([q, a, top], MAT.CLOTH);
      b.poly([a, q, bot], MAT.CLOTH);
    }
  });
}

// ------------------------------------------------------------------------------------------------- the riwaq

/** a frame on side k of the sixteen-gon at apothem A: its middle at the origin, x along it from vertex k to vertex k+1,
 *  z in toward the plaza's middle (the yaw that turns the builder's +z that way) */
function sideFrame(k: number, A: number): { o: V2; yaw: number } {
  const t = sAng(k);
  return { o: [Math.cos(t) * A, Math.sin(t) * A], yaw: Math.atan2(-Math.cos(t), -Math.sin(t)) };
}

/** the riwaq's colliders: its sides in a few groups, each one collider turned to its sides' bisector (a pair's sides
 *  each turned ±11.25° in it); the piers and the towers in the group beside them */
const GROUPS: number[][] = [[6, 7], [8, 9], [10], [12], [13, 14], [15, 0]];
const groupOf = (k: number) => GROUPS.findIndex((g) => g.includes(k));
/** the group by each pier's and tower's vertex (vertex k is between sides k-1 and k) */
const VERTEX_GROUP: Record<number, number> = { 7: 0, 8: 0, 6: 0, 9: 1, 10: 1, 11: 2, 12: 3, 13: 3, 14: 4, 15: 4, 0: 5, 1: 5 };

/** what's walked of a piece laid in its own frame (o, yaw: in the plaza's), gathered into its group's collider whose
 *  frame is the plaza's middle turned by `gy`: boxes square to the piece's frame laid square in the collider's where
 *  they're turned alike, else as strips (Collide.polySolid's) a little over a metre wide */
class Walk {
  private O: V2;
  private rel: number;
  constructor(private col: Collide, o: V2, yaw: number, gy: number) {
    const c = Math.cos(-gy), s = Math.sin(-gy);
    this.O = [c * o[0] + s * o[1], -s * o[0] + c * o[1]];
    this.rel = yaw - gy;
  }
  private pts(x0: number, z0: number, x1: number, z1: number): V2[] {
    const c = Math.cos(this.rel), s = Math.sin(this.rel);
    return ([[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as V2[]).map(([x, z]) => [this.O[0] + c * x + s * z, this.O[1] - s * x + c * z] as V2);
  }
  private get square() { return Math.abs(Math.sin(this.rel)) < 1e-6; }
  solid(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number) {
    const p = this.pts(x0, z0, x1, z1);
    if (this.square) this.col.solid(Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1])), y0, y1);
    else this.col.polySolid(p, y0, y1, 1.2);
    return this;
  }
  floor(x0: number, z0: number, x1: number, z1: number, h: number) {
    const p = this.pts(x0, z0, x1, z1);
    if (this.square) this.col.floor(Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1])), h);
    else this.col.polyFloor(p, h, 1.2);
    return this;
  }
}

/** the riwaq round the plaza (laid in the plaza's frame on its paving): each group's collider, its sides, the piers at
 *  its corners, its towers */
function riwaq(c: City) {
  const b = c.b;
  const cols = GROUPS.map((g, i) => {
    const m = g.reduce((s, k) => [s[0] + Math.cos(sAng(k)), s[1] + Math.sin(sAng(k))], [0, 0]), t = Math.atan2(m[1], m[0]);
    const gy = Math.atan2(-Math.cos(t), -Math.sin(t));
    let col!: Collide;
    b.group(() => { b.at(0, 0, 0, gy); col = c.collide(`city/plaza-riwaq-${i}`); });
    return { col, gy };
  });
  const walk = (vertexOrSide: number, o: V2, yaw: number, side = true) => {
    const g = cols[side ? groupOf(vertexOrSide) : VERTEX_GROUP[vertexOrSide]];
    return new Walk(g.col, o, yaw, g.gy);
  };
  for (const [k, kind] of SIDES) {
    if (kind === 'open') continue;
    const f = sideFrame(k, RW.arc);
    riwaqSide(c, walk(k, f.o, f.yaw), k, kind);
  }
  for (const k of PIERS) cornerPier(c, walk(k, [0, 0], 0, false), k);
  for (const t of TOWERS) tower(c, (o, yaw) => walk(t.k, o, yaw, false), t.k, t.kind);
}

/** one side of the riwaq in its own frame (sideFrame at the arcade's line): the arcade (or two, either side of a
 *  gate), the roof behind it from the arcade's back to the back wall, the back wall with a shop's doorway behind every
 *  bay and a tiled dado, merlons along both copings, a lantern hung in every other arch */
function riwaqSide(c: City, w: Walk, k: number, kind: SideKind) {
  const b = c.b, f = sideFrame(k, RW.arc);
  b.group(() => {
    b.at(f.o[0], 0, f.o[1], f.yaw);
    // the arcades' runs along the side (their middles and bays), and the roof's and back wall's (x from, x to: a
    // vertex's end mitred, a gate's inside its block)
    const runs: { x: number; n: number }[] = kind === 'gate'
      ? [{ x: -ARC.side / 2 + RW.corner + ARC.gateLen / 2, n: RW.gateBays }, { x: ARC.side / 2 - RW.corner - ARC.gateLen / 2, n: RW.gateBays }]
      : [{ x: 0, n: RW.bays }];
    const spans: [number | null, number | null][] = kind === 'gate' ? [[null, -GATE.half + 0.3], [GATE.half - 0.3, null]] : [[null, null]];
    runs.forEach((r, i) => b.group(() => {
      b.at(r.x, 0, 0);
      const laid = arcade(b, { kind: 'horseshoe', bays: r.n, span: ARC.span, spring: RW.spring, thick: ARC.t, columns: { order: 'round', r: RW.colR }, detail: 'mid', pal: TILE_PAL.HALL, seed: k * 13 + i });
      for (const s of laid.walk?.solids ?? []) w.solid(r.x + s[0], s[1], r.x + s[2], s[3], s[4], s[5]);
    }));
    const bays = runs.flatMap((r) => Array.from({ length: r.n }, (_, j) => r.x - (r.n * ARC.span + (r.n + 1) * ARC.pw) / 2 + ARC.pw + ARC.span / 2 + j * (ARC.span + ARC.pw)));
    bays.forEach((x, j) => { if (j % 2 === 0) b.place('lantern-hanging', [x, RW.spring + ARC.crown - 0.04, 0], { scale: 1.15 }); });
    // merlons along the arcade's coping
    const mStep = 1.05, mN = Math.floor((ARC.side - 2 * RW.corner) / mStep);
    for (let j = 0; j < mN; j++) {
      const x = -((mN - 1) * mStep) / 2 + j * mStep;
      if (kind === 'gate' && Math.abs(x) < GATE.half + 0.4) continue;
      b.place('merlon-stepped', [x, ARC.top, 0], { scale: 1.1, tint: [1.05, 0.98, 0.95] });
    }
    for (const [x0, x1] of spans) {
      roof(c, w, x0, x1);
      backWall(c, w, x0, x1, bays.filter((x) => (x0 === null || x > x0) && (x1 === null || x < x1)));
    }
    if (kind === 'gate') gate(c, w, k);
  });
}

/** where along a side (x, in its frame) a run that ends at a vertex (null) or at x ends, at a depth z (the run's
 *  mitre at the vertex: the sixteen-gon's corner at that apothem) */
const endX = (x: number | null, z: number, s: -1 | 1) => (x === null ? s * (RW.arc - z) * Math.tan(PI16) : x);

/** the riwaq's roof over a run: its top level with the spandrels' top (the arcade's frieze and coping stand over it as
 *  a parapet), its painted ceiling beneath; from the arcade's back to the back wall's face */
function roof(c: City, w: Walk, x0: number | null, x1: number | null) {
  const b = c.b, za = -ARC.t / 2, zb = -(RW.back - RW.tw / 2 - RW.arc), yt = ARC.zone, ys = ARC.zone - 0.35;
  const q = (z: number, y: number): [V3, V3] => [[endX(x0, z, -1), y, z], [endX(x1, z, 1), y, z]];
  const [a0, a1] = q(za, yt), [b0, b1] = q(zb, yt);
  b.with({ tint: [1.0, 0.92, 0.86] }, () => b.quad(a0, a1, b1, b0, MAT.PAVING));
  const [c0, c1] = q(za, ys), [d0, d1] = q(zb, ys);
  b.with({ tint: [0.62, 0.42, 0.3] }, () => b.quad(d0, d1, c1, c0, MAT.WOOD));
  w.solid(Math.max(a0[0], b0[0]), zb, Math.min(a1[0], b1[0]), za, ys, yt).floor(Math.max(a0[0], b0[0]), zb, Math.min(a1[0], b1[0]), za, yt);
}

/** the riwaq's back wall over a run, standing a storey over its roof (the plaza's enclosure seen over the arcade): its
 *  face to the plaza (a shop's lit doorway behind every bay under the roof, a dado of tiles between them under a tile
 *  border; over the roof a window to every bay, a band of interlaced stars under the cap), its plain face to the town,
 *  its cream cap (both mitred at the vertices), merlons along it */
function backWall(c: City, w: Walk, x0: number | null, x1: number | null, bays: number[]) {
  const b = c.b, zi = -(RW.back - RW.tw / 2 - RW.arc), zo = -(RW.back + RW.tw / 2 - RW.arc), H = RW.upper, cap = 0.25, oh = 0.12;
  const xi0 = endX(x0, zi, -1), xi1 = endX(x1, zi, 1), xo0 = endX(x0, zo, -1), xo1 = endX(x1, zo, 1);
  const f = new Face(b, [xi0, zi], [xi1, zi], 0, H);
  const ops: Opening[] = bays.flatMap((x): Opening[] => [
    { u0: x - xi0 - 0.85, u1: x - xi0 + 0.85, v0: PROUD, top: 3.1, arch: 'pointed', depth: 0.32, fill: MAT.INTERIOR, glow: 0.55, frame: MAT.CREAM, frameW: 0.2 },
    { u0: x - xi0 - 0.6, u1: x - xi0 + 0.6, v0: 9.0, top: 10.85, arch: 'pointed', depth: 0.16, fill: MAT.WINDOW, glow: 0.7, frame: MAT.CREAM, frameW: 0.14 },
  ]);
  f.wall(MAT.PLASTER_WARM, ops);
  b.with({ pal: TILE_PAL.FOUNTAIN }, () => f.rect(0, 11.08, f.len, 11.42, -PROUD, MAT.TILE_BAND));
  // the dado: tiles under a border between the doorways' surrounds, a hand off the wall
  const gaps: [number, number][] = [];
  let u = 0;
  for (const o of ops) { if (o.v0 > 1) continue; gaps.push([u, o.u0 - 0.2]); u = o.u1 + 0.2; }
  gaps.push([u, f.len]);
  b.with({ pal: TILE_PAL.HALL }, () => {
    for (const [g0, g1] of gaps) {
      if (g1 - g0 < 0.1) continue;
      f.rect(g0, 0.08, g1, 1.25, -PROUD, MAT.TILE);
      f.rect(g0, 1.25, g1, 1.5, -PROUD, MAT.TILE_BORDER);
    }
  });
  new Face(b, [xo1, zo], [xo0, zo], 0, H).rect(0, 0, xo1 - xo0, H, 0, MAT.PLASTER);
  // the cap: its top, its faces, the strips that overhang either side underneath
  const ci = zi + oh, co = zo - oh;
  const P = (x: number, y: number, z: number): V3 => [x, y, z];
  const ci0 = endX(x0, ci, -1), ci1 = endX(x1, ci, 1), co0 = endX(x0, co, -1), co1 = endX(x1, co, 1);
  b.quad(P(ci0, H + cap, ci), P(ci1, H + cap, ci), P(co1, H + cap, co), P(co0, H + cap, co), MAT.CREAM);
  b.quad(P(ci0, H, ci), P(ci1, H, ci), P(ci1, H + cap, ci), P(ci0, H + cap, ci), MAT.CREAM);
  b.quad(P(co1, H, co), P(co0, H, co), P(co0, H + cap, co), P(co1, H + cap, co), MAT.CREAM);
  b.quad(P(xi0, H, zi), P(xi1, H, zi), P(ci1, H, ci), P(ci0, H, ci), MAT.CREAM);
  b.quad(P(co0, H, co), P(co1, H, co), P(xo1, H, zo), P(xo0, H, zo), MAT.CREAM);
  // merlons along it
  const mStep = 1.05, n = Math.floor((xo1 - xo0 - 0.6) / mStep);
  for (let j = 0; j < n; j++) b.place('merlon-stepped', [(xo0 + xo1) / 2 - ((n - 1) * mStep) / 2 + j * mStep, H + cap, (zi + zo) / 2], { scale: 1.1, tint: [1.05, 0.98, 0.95] });
  w.solid(Math.max(xi0, xo0), zo, Math.min(xi1, xo1), zi, 0, H + cap).floor(Math.max(xi0, xo0), zo, Math.min(xi1, xo1), zi, H + cap);
}

/** a gate through the riwaq (in its side's frame, across its middle): a block from the arcade's face (stood proud of
 *  it) through to past the back wall, a horseshoe passage through it under a tiled portal on the plaza's face, red
 *  banners either side, a band of interlaced stars over it, its cap crested with merlons, a domed turret at its two
 *  front corners, lanterns either side of the passage on both faces */
function gate(c: City, wk: Walk, k: number) {
  const b = c.b, G = GATE.half * 2, D = GATE.front - GATE.back, zc = (GATE.front + GATE.back) / 2, H = RW.gateH;
  const w = RW.gateSpan, crownH = 9.4, segs = 18, sh = shapeOf(w, crownH, 'horseshoe', segs);
  b.group(() => {
    b.at(-GATE.half, 0, zc);
    pierced(b, G, H, D, [{ x: GATE.half, span: w, sill: 0, spring: sh.ys, kind: 'horseshoe', segs }], MAT.PLASTER_WARM, { top: null, soffit: MAT.ASHLAR });
  });
  // the portal on its plaza face (its own tile field, border, archivolt and cornice: the passage's reveals are the
  // block's)
  b.group(() => {
    b.at(0, 0, GATE.front);
    portal(b, { w, h: crownH, arch: 'horseshoe', depth: 0, fill: 'passage', steps: 0, crest: false, lanterns: false, pal: TILE_PAL.HALL, detail: 'near', seed: k });
    // a band of interlaced stars across the face over it, between cream fillets
    const yb = 12.5;
    b.with({ pal: TILE_PAL.FOUNTAIN }, () => b.quad([-GATE.half + 0.4, yb, PROUD], [GATE.half - 0.4, yb, PROUD], [GATE.half - 0.4, yb + 0.6, PROUD], [-GATE.half + 0.4, yb + 0.6, PROUD], MAT.TILE_BAND));
    for (const v of [yb - 0.14, yb + 0.6]) b.box(-GATE.half + 0.3, v, 0, GATE.half - 0.3, v + 0.14, 0.08, MAT.CREAM, { skip: ['n'] });
    for (const s of [-1, 1]) b.place('lantern-wall', [s * (w / 2 + 1.75), 3.4, 0], { scale: 1.3 });
  });
  // red banners either side of the portal
  const face = new Face(b, [-GATE.half, GATE.front], [GATE.half, GATE.front], 0, H);
  for (const s of [-1, 1]) banner(c, face, GATE.half + s * 5.0, 12.0, 1.3, 5.0, [1.05, 0.3, 0.2]);
  // lanterns on its town face
  b.group(() => { b.at(0, 0, GATE.back, Math.PI); for (const s of [-1, 1]) b.place('lantern-wall', [s * (w / 2 + 1.1), 3.4, 0], { scale: 1.2 }); });
  // the cap over the block, crested; the turrets
  capOn(b, -GATE.half, GATE.back, GATE.half, GATE.front, H, 0.4, 0.2, MAT.CREAM);
  const ct = H + 0.4, mStep = 1.0;
  for (const z of [GATE.front - 0.35, GATE.back + 0.35]) {
    const n = Math.floor((G - 3.2) / mStep);
    for (let j = 0; j < n; j++) b.place('merlon-stepped', [-((n - 1) * mStep) / 2 + j * mStep, ct, z], { scale: 1.25, tint: [1.05, 0.98, 0.95] });
  }
  for (const s of [-1, 1]) {
    const x = s * (GATE.half - 0.95), z = GATE.front - 0.95;
    turretDome(c, x, z, ct, 0.85, 3.4, k * 2 + (s > 0 ? 1 : 0));
    wk.solid(x - 0.85, z - 0.85, x + 0.85, z + 0.85, ct, ct + 5.2);
  }
  // walked: the block either side of the passage, over it from the arch's haunches, its top
  wk.solid(-GATE.half, GATE.back, -w / 2, GATE.front, 0, H + 0.4).solid(w / 2, GATE.back, GATE.half, GATE.front, 0, H + 0.4);
  wk.solid(-w / 2, GATE.back, w / 2, GATE.front, sh.ys + 1.2, H + 0.4).floor(-GATE.half, GATE.back, GATE.half, GATE.front, ct);
}

/** a cap over a block's footprint (x0..x1, z0..z1) at y, `h` tall, standing `out` past its sides: its sides, its top,
 *  the overhanging ring underneath (the block's own top left off: the cap is its top) */
function capOn(b: City['b'], x0: number, z0: number, x1: number, z1: number, y: number, h: number, out: number, mat: Mat) {
  const X0 = x0 - out, X1 = x1 + out, Z0 = z0 - out, Z1 = z1 + out;
  b.box(X0, y, Z0, X1, y + h, Z1, mat, { skip: ['bottom'] });
  b.quad([X0, y, Z0], [X1, y, Z0], [x1, y, z0], [x0, y, z0], mat);
  b.quad([x0, y, z1], [x1, y, z1], [X1, y, Z1], [X0, y, Z1], mat);
  b.quad([X0, y, Z1], [X0, y, Z0], [x0, y, z0], [x0, y, z1], mat);
  b.quad([x1, y, z1], [x1, y, z0], [X1, y, Z0], [X1, y, Z1], mat);
}

/** a slender turret standing on a roof at (x, y0, z): a square shaft (half width hw) h tall in warm plaster, a cream
 *  cornice, a pointed dome of glazed tiles and a gold finial (instanced) */
function turretDome(c: City, x: number, z: number, y0: number, hw: number, h: number, seed: number) {
  const b = c.b, y1 = y0 + h + 0.25, r = hw * 0.98, rise = r * 1.5;
  b.box(x - hw, y0, z - hw, x + hw, y0 + h, z + hw, MAT.PLASTER_WARM, { skip: ['bottom', 'top'] });
  capOn(b, x - hw, z - hw, x + hw, z + hw, y0 + h, 0.25, 0.12, MAT.CREAM);
  b.with({ tint: GLAZES[seed % GLAZES.length] }, () => b.dome(x, y1, z, r, MAT.DOME, { rise, tip: 0.7, rings: 5, sides: 12 }));
  b.place('finial-spire', [x, y1 + rise * 1.12, z], { scale: 1.1 });
}

/** the pier at a corner between two arcaded sides (vertex k, on the arcade's line): eight-sided, past the copings,
 *  capped, a gold finial on it and a lantern on its face to the plaza */
function cornerPier(c: City, w: Walk, k: number) {
  const b = c.b, [x, z] = vAt(k, RW.arc), r = 1.3, h = ARC.top + 0.7, a = vAng(k);
  b.cylinder(x, z, r, 0, h, 8, MAT.PLASTER_WARM, { top: null });
  b.cylinder(x, z, r + 0.15, h, h + 0.3, 8, MAT.CREAM);
  // (the cap's underside: the ring that overhangs)
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2;
    const p = (t: number, rr: number): V3 => [x + Math.cos(t) * rr, h, z + Math.sin(t) * rr];
    b.quad(p(a0, r + 0.15), p(a1, r + 0.15), p(a1, r), p(a0, r), MAT.CREAM);
  }
  b.place('finial-lotus', [x, h + 0.3, z], { scale: 1.6 });
  // (its lantern on the face toward the plaza's middle: the octagon's face nearest that way)
  const fa = Math.round((a + Math.PI) / (Math.PI / 4)) * (Math.PI / 4), ap = r * Math.cos(Math.PI / 8);
  b.group(() => { b.at(x + Math.cos(fa) * ap, 3.6, z + Math.sin(fa) * ap, Math.atan2(Math.cos(fa), Math.sin(fa))); b.place('lantern-wall', [0, 0, 0], { scale: 1.2 }); });
  w.solid(x - r, z - r, x + r, z + r, 0, h + 0.3).floor(x - r, z - r, x + r, z + r, h + 0.3);
}

/** a tower at a vertex of the riwaq's run, square to the vertex's ray: the two minarets either side of the plaza's
 *  open north, tall over the stair square, with a lantern stage of arched windows under a pointed dome; the two
 *  shorter ones that end the run at the south-east and south-west, under round domes. Each in warm plaster on a cream
 *  plinth, blind arches of tiles in its faces, the riwaq's teal frieze carried round it, a cream cornice, a lantern on
 *  its face to the plaza */
function tower(c: City, walk: (o: V2, yaw: number) => Walk, k: number, kind: 'minaret' | 'end') {
  const b = c.b, a = vAng(k), hw = 3.3, H = kind === 'minaret' ? 12.6 : 13.0;
  // (its middle out along the ray so it takes the riwaq's ends into it, its far corners inside the claim's sixteen-gon)
  const r = kind === 'minaret' ? 88.8 : 88.3;
  // (its frame: +z out along the vertex's ray, x across it)
  const o: V2 = [Math.cos(a) * r, Math.sin(a) * r], yaw = Math.atan2(Math.cos(a), Math.sin(a));
  b.group(() => {
    b.at(o[0], 0, o[1], yaw);
    b.box(-hw - 0.25, 0, -hw - 0.25, hw + 0.25, 0.6, hw + 0.25, MAT.CREAM, { skip: ['bottom'] });
    // its four faces, each with a blind arch of tiles (two, one over the other, on a minaret)
    const faces: [V2, V2][] = [[[-hw, hw], [hw, hw]], [[hw, hw], [hw, -hw]], [[hw, -hw], [-hw, -hw]], [[-hw, -hw], [-hw, hw]]];
    faces.forEach(([L, R], i) => {
      const f = new Face(b, L, R, 0.6, H - 0.6);
      const ops: Opening[] = [{ u0: hw - 1.2, u1: hw + 1.2, v0: 1.4, top: 5.6, arch: 'pointed', depth: 0.3, fill: MAT.TILE, pal: TILE_PAL.HALL, frame: MAT.CREAM, frameW: 0.22 }];
      if (kind === 'minaret') ops.push({ u0: hw - 0.95, u1: hw + 0.95, v0: 8.3, top: 11.4, arch: 'pointed', depth: 0.3, fill: MAT.TILE, pal: TILE_PAL.FOUNTAIN, frame: MAT.CREAM, frameW: 0.2 });
      f.wall(MAT.PLASTER_WARM, ops);
      // the riwaq's teal frieze carried round it, and a lantern by the lower arch on the face to the plaza (the third:
      // its -z, back down the ray)
      f.rect(0, ARC.zone - 0.6, f.len, ARC.zone - 0.1, -PROUD, MAT.TEAL);
      if (i === 2) b.group(() => { const p = f.at(hw + 1.85, 3.2); b.at(p[0], p[1], p[2], Math.atan2(-(R[1] - L[1]), R[0] - L[0])); b.place('lantern-wall', [0, 0, 0], { scale: 1.2 }); });
    });
    capOn(b, -hw, -hw, hw, hw, H, 0.5, 0.3, MAT.CREAM);
    b.group(() => {
      b.at(0, H + 0.5, 0);
      const laid = kind === 'minaret'
        ? domePart(b, { kind: 'pointed', r: 2.6, base: 'octagon', windows: true, drum: 2.4, detail: 'mid', finial: null, seed: k })
        : domePart(b, { kind: 'onion', r: 2.84, base: 'square', drum: 1.0, detail: 'mid', finial: null, seed: k });
      // (its finial's tip under the plaza's claim's ceiling, 22 m)
      b.place(kind === 'minaret' ? 'finial-spire' : 'finial-lotus', [0, laid.top, 0], { scale: kind === 'minaret' ? 1.6 : 1.9 });
      if (kind === 'minaret') c.light([0, 2.4, 0], 140, { radius: 18 });
    });
  });
  walk(o, yaw).solid(-hw - 0.25, -hw - 0.25, hw + 0.25, hw + 0.25, 0, H + 0.5).floor(-hw - 0.3, -hw - 0.3, hw + 0.3, hw + 0.3, H + 0.5);
}
// ------------------------------------------------------------------------------------------------- the stair square

/** the square at the grand stair's foot (STAIR_SQUARE, under the plaza's claims: its middle from the stair's forecourt
 *  to the plaza, its wings either side from the ring road), paved, the carpet carried on from the plaza to the stair's
 *  foot between two rows of red pillars — the inner carrying fires, the outer gold lotus finials — a small fountain in
 *  each wing, cypress along its sides, lamps */
function stairSquare(c: City) {
  const b = c.b, sq = STAIR_SQUARE, foot = STAIR.landings[0][1] + 18, zc = (sq.z0 + sq.z1) / 2;
  const e0 = polar(WAYS.ring.r1, 90), eW = polar(WAYS.ring.r1, 99), eE = polar(WAYS.ring.r1, 81);
  const edgeZ = (x: number) => { const q = x < 0 ? eW : eE; return e0[1] + ((q[1] - e0[1]) * x) / q[0] - zc; };
  // (its frame at its middle: z from it, so its collider stands in the square)
  const Z = (z: number) => z - zc;
  // the plaza's sixteen-gon in this frame: the square's paving stops at its edge
  const plaza = Array.from({ length: 16 }, (_, k) => { const p = vAt(k, PLAZA.paved); return [PLAZA.x + p[0], Z(PLAZA.z + p[1])] as V2; });
  const pieces: V2[][] = [
    [[sq.x0, edgeZ(sq.x0)], [-18, edgeZ(-18)], [-18, Z(sq.z1)], [sq.x0, Z(sq.z1)]],
    [[-18, Z(foot)], [18, Z(foot)], [18, Z(sq.z1)], [-18, Z(sq.z1)]],
    [[18, edgeZ(18)], [sq.x1, edgeZ(sq.x1)], [sq.x1, Z(sq.z1)], [18, Z(sq.z1)]],
  ];
  b.group(() => {
    b.at(0, FLOOR_Y, zc);
    const col = c.collide('city/stair-square');
    const y = FLOOR.square;
    b.with({ tint: PAVE }, () => { for (const p of pieces) for (const q of subtractConvex(p, plaza)) b.slab(q, y, MAT.PAVING); });
    // the carpet from the stair's foot to the plaza's edge (the plaza lays it on to its basin)
    b.group(() => { b.at(PLAZA.x, 0, Z(PLAZA.z)); carpet(c, foot - PLAZA.z, -PLAZA.paved, [true, false]); });
    // the pillars: the inner row along the carpet, the outer in the wings
    for (const s of [-1, 1]) {
      for (const [i, z] of [349.5, 358.5, 367.5].entries()) {
        redPillar(c, col, s * 13.2, Z(z), y, 15.5 - i * 0.6, { top: 'fire', seed: 40 + i * 2 + (s > 0 ? 1 : 0) });
        if (i < 2) {
          b.place('lantern-post', [s * 8.2, y, Z(z + 4.5)], { yaw: s > 0 ? Math.PI / 2 : -Math.PI / 2, scale: 1.45 });
          col.solid(s * 8.2 - 0.25, Z(z + 4.25), s * 8.2 + 0.25, Z(z + 4.75), 0, 3.4);
        }
      }
      for (const [i, z] of [347, 366].entries()) redPillar(c, col, s * 27, Z(z), y, 12.5, { top: 'finial', seed: 50 + i * 2 + (s > 0 ? 1 : 0) });
      // a small star basin in each wing between its pillars
      wingFountain(c, col, s * 27, Z(356.5), y);
      // cypress down the wing's outer side, lamps by the ring road
      for (let z = edgeZ(s * 35.5) + 6; z < Z(sq.z1) - 3; z += 6.2) {
        planter(c, s * 35.2, z, 0.9, 0.6, 'cypress', y);
        col.solid(s * 35.2 - 0.9, z - 0.9, s * 35.2 + 0.9, z + 0.9, 0, 0.7);
      }
      for (const x of [21, 33]) {
        b.place('lantern-post', [s * x, y, edgeZ(s * x) + 3.2], { scale: 1.45 });
        col.solid(s * x - 0.25, edgeZ(s * x) + 2.95, s * x + 0.25, edgeZ(s * x) + 3.45, 0, 3.4);
      }
    }
  });
}

/** a little eight-pointed star basin with a jet's bowl in it (the plaza's fountain small), in a stair square wing */
function wingFountain(c: City, col: Collide, x: number, z: number, y: number) {
  const b = c.b, R = 3.4, rim = 0.4, H = 0.6;
  const out = star(R).map(([u, v]) => [x + u, z + v] as V2), inn = star(R - rim * Math.SQRT2).map(([u, v]) => [x + u, z + v] as V2), n = out.length;
  const P = (q: V2, h: number): V3 => [q[0], h, q[1]];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    b.quad(P(out[j], y), P(out[i], y), P(out[i], y + H), P(out[j], y + H), MAT.CREAM);
    b.quad(P(inn[j], y + H), P(out[j], y + H), P(out[i], y + H), P(inn[i], y + H), MAT.CREAM);
    b.quad(P(inn[i], y + 0.1), P(inn[j], y + 0.1), P(inn[j], y + H), P(inn[i], y + H), MAT.POOL);
  }
  b.with({ pal: TILE_PAL.FOUNTAIN }, () => {
    const t = star(R + PROUD * Math.SQRT2).map(([u, v]) => [x + u, z + v] as V2);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; b.quad(P(t[j], y + 0.08), P(t[i], y + 0.08), P(t[i], y + H - 0.08), P(t[j], y + H - 0.08), MAT.TILE_BAND); }
  });
  b.slab(inn, y + 0.12, MAT.POOL);
  c.pool(inn, y + 0.45, 0.33);
  b.cylinder(x, z, 0.32, y + 0.1, y + 1.1, 10, MAT.CREAM, { r1: 0.22, top: null });
  b.cylinder(x, z, 0.2, y + 1.1, y + 1.45, 14, MAT.CREAM, { r1: 0.9, top: MAT.POOL });
  b.cylinder(x, z, 0.9, y + 1.45, y + 1.58, 14, MAT.GOLD, { top: null });
  col.polySolid(ngon(x, z, R, 8), 0, y + H);
  col.polyFloor(ngon(x, z, R - 0.4, 8), y + H);
}

// ------------------------------------------------------------------------------------------------- the red pillars

/** a red pillar of the grand hall's (ref 1) at local (x, z) on y, `h` tall to its head: a tall cubic plinth in red
 *  between cream courses with a big lavender diamond set in each face, the parts' square red pillar on it (stepped
 *  cream base and cap, lavender diamonds near its head and foot), and on its head a fire in a gold bowl, or a gold
 *  lotus finial (instanced) */
export function redPillar(c: City, col: Collide | null, x: number, z: number, y: number, h: number, o: { top?: 'fire' | 'finial' | 'none'; seed?: number; s?: number } = {}) {
  const b = c.b, s = o.s ?? 1, pw = 1.35 * s, ph = 3.0 * s, r = 0.56 * s;
  b.group(() => {
    b.at(x, y, z);
    b.box(-pw - 0.14, 0, -pw - 0.14, pw + 0.14, 0.32 * s, pw + 0.14, MAT.CREAM, { skip: ['bottom'] });
    b.cappedBox(-pw, 0.32 * s, -pw, pw, ph, pw, MAT.RED, { mat: MAT.CREAM, h: 0.34 * s, out: 0.12 });
    // the diamonds: a cream frame and the lavender proud of it, on each face
    for (let f = 0; f < 4; f++) b.group(() => {
      b.at(0, 0, 0, (f * Math.PI) / 2);
      const yc = (0.32 * s + ph - 0.34 * s) / 2, d = 0.82 * s;
      const dia = (k: number, zz: number): V3[] => [[0, yc - d * k, zz], [d * k * 0.8, yc, zz], [0, yc + d * k, zz], [-d * k * 0.8, yc, zz]];
      b.panel(dia(1, pw), MAT.CREAM);
      b.with({ tint: [0.36, 0.37, 0.67] }, () => b.panel(dia(0.72, pw + PROUD), MAT.PAINT));
    });
    b.group(() => {
      b.at(0, ph, 0);
      column(b, { order: 'pillar', h: h - ph, r, detail: 'near', seed: o.seed ?? 1, top: o.top !== 'fire' });
    });
    if (o.top === 'fire') { brazier(c, 0, h, 0, 1.5 * s); flame(c, 0, h, 0, 1.5 * s); }
    else if (o.top !== 'none') b.place('finial-lotus', [0, h, 0], { scale: 2.4 * s });
  });
  col?.solid(x - pw - 0.14, z - pw - 0.14, x + pw + 0.14, z + pw + 0.14, 0, y + ph).solid(x - r * 1.4, z - r * 1.4, x + r * 1.4, z + r * 1.4, y + ph, y + h);
}

/** a brazier's flame (props.ts brazier() at the same place and size): a painted tongue of fire over its coals (paint:
 *  its tint its colour by day, and it glows at night) */
function flame(c: City, x: number, y: number, z: number, s: number) {
  const prof: [number, number][] = [[0.42, 0], [0.5, 0.22], [0.42, 0.6], [0.24, 1.0], [0.1, 1.35], [0, 1.6]];
  c.b.with({ tint: [1.0, 0.42, 0.1], glow: 1 }, () => c.b.lathe(x, y + 1.2 * s, z, prof.map(([r, h]) => [r * s, h * s] as [number, number]), 8, MAT.PAINT));
}

/** a red freestanding pillar on a cubic plinth with lavender diamond insets (the old grand hall's: the palace's court
 *  still has them) */
export function pillar(c: City, col: Collide | null, x: number, z: number, h: number, y = 0, s = 1) {
  const b = c.b, ps = 1.45 * s, w = 0.78 * s;
  b.box(x - ps - 0.15, y, z - ps - 0.15, x + ps + 0.15, y + 0.35 * s, z + ps + 0.15, MAT.CREAM, { skip: ['bottom'] });
  b.box(x - ps, y + 0.35 * s, z - ps, x + ps, y + 2.9 * s, z + ps, MAT.RED, { skip: ['bottom'] });
  b.box(x - ps - 0.12, y + 2.9 * s, z - ps - 0.12, x + ps + 0.12, y + 3.25 * s, z + ps + 0.12, MAT.CREAM);
  // the diamonds on the plinth's faces and halfway up the shaft
  const diamond = (cx: number, cy: number, cz: number, nx: number, nz: number, r: number) => {
    const tx = nz, tz = -nx;
    const p = (u: number, v: number): V3 => [cx + nx * 0.02 + tx * u, cy + v, cz + nz * 0.02 + tz * u];
    b.poly([p(0, -r), p(r * 0.8, 0), p(0, r), p(-r * 0.8, 0)], MAT.LAVENDER);
  };
  for (const [nx, nz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
    diamond(x + nx * ps, y + 1.62 * s, z + nz * ps, nx, nz, 0.75 * s);
    diamond(x + nx * w, y + h * 0.62, z + nz * w, nx, nz, 0.42 * s);
  }
  b.box(x - w, y + 3.25 * s, z - w, x + w, y + h, z + w, MAT.RED, { skip: ['bottom', 'top'] });
  b.box(x - w - 0.12, y + h, z - w - 0.12, x + w + 0.12, y + h + 0.35 * s, z + w + 0.12, MAT.CREAM);
  b.box(x - w * 0.8, y + h + 0.35 * s, z - w * 0.8, x + w * 0.8, y + h + 1.0 * s, z + w * 0.8, MAT.RED, { skip: ['bottom'] });
  b.cylinder(x, z, w * 0.8 * Math.SQRT2, y + h + 1.0 * s, y + h + 1.7 * s, 4, MAT.GOLD, { r1: 0.05 });
  col?.solid(x - ps, z - ps, x + ps, z + ps, 0, y + h);
}

/** a boulevard's furniture along a straight run (plan a -> b, `width` wide): palms in planters down both sides at a
 *  rhythm, lamps between them */
export function boulevard(c: City, a: V2, z: V2, width: number, name: string, o: { kind?: 'palms' | 'cypress'; every?: number; skip?: (p: V2) => boolean } = {}) {
  const b = c.b;
  const dx = z[0] - a[0], dz = z[1] - a[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
  const every = o.every ?? 12, off = width / 2 - 3.2;
  b.group(() => {
    b.at(0, FLOOR_Y, 0);
    const col = c.collide(name);
    for (let t = every / 2; t < L - 2; t += every) {
      for (const s of [-1, 1]) {
        const p: V2 = [a[0] + ux * t + nx * off * s, a[1] + uz * t + nz * off * s];
        if (o.skip?.(p)) continue;
        planter(c, p[0], p[1], 1.1, 0.6, o.kind ?? 'palms', FLOOR.street);
        col.solid(p[0] - 1.1, p[1] - 1.1, p[0] + 1.1, p[1] + 1.1, 0, 0.75);
        const q: V2 = [p[0] + ux * every / 2, p[1] + uz * every / 2];
        if (t + every / 2 < L - 2 && !o.skip?.(q)) { b.place('lantern-post', [q[0], FLOOR.street, q[1]], { scale: 1.5 }); col.solid(q[0] - 0.25, q[1] - 0.25, q[0] + 0.25, q[1] + 0.25, 0, 3.5); }
      }
    }
  });
}
