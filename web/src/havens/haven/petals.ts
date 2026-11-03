// The lotus crown on the temple's roof: thick golden rhombus slabs leaning outward round the centre (ref 3, the
// concepts), folded along their spine so each half catches the light differently, a raised gilded rim round each face,
// a recessed diamond window in the main petals' faces whose back panel is lavender with a gilded lotus and a little
// planted ledge (an inner garden in every petal); a ring of smaller upright petals inside, low canopy petals over the portals between, small sepals along the
// cornice; and the needle: a slender golden spire with collars, a lantern near its tip that burns all night.
import { MAT, type V3 } from '../arch/types';
import type { V2 } from '../world/layout';
import type { Haul } from './colliders';
import { C, rng } from './plan';
import type { Shapes } from './shapes';

export interface Petal {
  /** the angle it faces, its foot's radius and height, its height, its lean outward (from upright) */
  a: number; rb: number; yb: number; H: number; lean: number;
  /** half-width at its side corners, where those sit up its length (0..1), its thickness, the spine's fold */
  W: number; sv: number; T: number; fold: number;
  /** a recessed window (with its back panel and ledge) or a plain face */
  window: boolean;
  tint: V3;
}

/** a petal's points: from its plane coordinates (t across, s up its length, n out of its face) to the world */
function frame(p: Petal) {
  const er: V2 = [Math.cos(p.a), Math.sin(p.a)], sl = Math.sin(p.lean), cl = Math.cos(p.lean);
  const base: V3 = [C[0] + er[0] * p.rb, p.yb, C[1] + er[1] * p.rb];
  return (t: number, s: number, n: number): V3 => [
    base[0] + er[0] * (s * sl + n * cl) - er[1] * t,
    base[1] + s * cl - n * sl,
    base[2] + er[1] * (s * sl + n * cl) + er[0] * t,
  ];
}

export function petal(s: Shapes, haul: Haul, p: Petal) {
  const b = s.b, P = frame(p), S = p.H / Math.cos(p.lean), sv = p.sv * S;
  // the face folds along the spine: each half a plane, raised by the fold at the spine and flush at its side corner
  const out = (t: number) => p.fold * (1 - Math.min(1, Math.abs(t) / p.W));
  const F = (q: V2, lift = 0): V3 => P(q[0], q[1], out(q[0]) + lift);
  const Bk = (q: V2): V3 => P(q[0], q[1], -p.T);
  const o = P(0, 0, 0), e = P(0, 0, 1), nrm: V3 = [e[0] - o[0], e[1] - o[1], e[2] - o[2]];
  const neg = (v: V3): V3 => [-v[0], -v[1], -v[2]];
  /** from the middle of some points toward (or, negated, away from) a point */
  const toward = (pts: V3[], c: V3): V3 => {
    const m = pts.reduce((acc, q) => [acc[0] + q[0] / pts.length, acc[1] + q[1] / pts.length, acc[2] + q[2] / pts.length] as V3, [0, 0, 0] as V3);
    return [c[0] - m[0], c[1] - m[1], c[2] - m[2]];
  };
  // the rhombus, the inner edge of its gilded rim, its window (all scaled about one middle up the spine)
  const R: V2[] = [[0, 0], [p.W, sv], [0, S], [-p.W, sv]];
  const mid: V2 = [0, S * 0.47];
  const scaled = (k: number): V2[] => R.map(([t, sp]) => [t * k, mid[1] + (sp - mid[1]) * k]);
  const Rr = scaled(0.87), Wn = scaled(0.44), rim = Math.min(0.35, p.T * 0.1), centre = F(mid);
  b.with({ tint: p.tint }, () => {
    for (let i = 0; i < 4; i++) {
      const a0 = R[i], a1 = R[(i + 1) % 4], r0 = Rr[i], r1 = Rr[(i + 1) % 4];
      // the raised rim and its inner step, the slab's edge
      s.face([F(a0, rim), F(a1, rim), F(r1, rim), F(r0, rim)], MAT.GOLD, nrm);
      const step = [F(r0, rim), F(r1, rim), F(r1), F(r0)];
      s.face(step, MAT.GOLD, toward(step, centre));
      const edge = [F(a0, rim), F(a1, rim), Bk(a1), Bk(a0)];
      s.face(edge, MAT.GOLD, neg(toward(edge, centre)));
      // the face within the rim, round the window
      if (p.window) s.face([F(r0), F(r1), F(Wn[(i + 1) % 4]), F(Wn[i])], MAT.GOLD, nrm);
    }
    if (!p.window) for (const half of [[Rr[0], Rr[1], Rr[2]], [Rr[0], Rr[2], Rr[3]]]) s.face(half.map((q) => F(q)), MAT.GOLD, nrm);
    b.with({ ao: 0.85 }, () => s.face(R.map(Bk), MAT.GOLD, neg(nrm)));
  });
  if (!p.window) return;
  // the window's reveals, its lavender back panel, the gilded lotus on it and the planted ledge at its foot
  const depth = -0.6;
  const Bp = (q: V2): V3 => P(q[0], q[1], depth);
  const back = Bp(mid);
  b.with({ tint: [p.tint[0] * 0.92, p.tint[1] * 0.9, p.tint[2] * 0.88], ao: 0.7 }, () => {
    for (let i = 0; i < 4; i++) {
      const rv = [F(Wn[i]), F(Wn[(i + 1) % 4]), Bp(Wn[(i + 1) % 4]), Bp(Wn[i])];
      s.face(rv, MAT.GOLD, toward(rv, back));
    }
  });
  b.with({ ao: 0.75 }, () => s.face(Wn.map(Bp), MAT.LAVENDER, nrm));
  const Ln: V2[] = Wn.map(([t, sp]) => [t * 0.42, mid[1] + (sp - mid[1]) * 0.42]);
  const Rl = (q: V2): V3 => P(q[0], q[1], depth + 0.25);
  const lotus = Rl(mid);
  b.with({ tint: p.tint }, () => {
    s.face(Ln.map(Rl), MAT.GOLD, nrm);
    for (let i = 0; i < 4; i++) {
      const sd = [Rl(Ln[i]), Rl(Ln[(i + 1) % 4]), Bp(Ln[(i + 1) % 4]), Bp(Ln[i])];
      s.face(sd, MAT.GOLD, neg(toward(sd, lotus)));
    }
    // four leaves round the lotus diamond
    for (const [dt, ds] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c: V2 = [dt * Ln[1][0] * 1.55, mid[1] + ds * (Ln[2][1] - mid[1]) * 1.45];
      const w = Math.abs(Ln[1][0]) * 0.32;
      const leaf: V2[] = [[c[0] - w * (ds !== 0 ? 1 : 0.5), c[1]], [c[0], c[1] - w * (dt !== 0 ? 1 : 0.6)], [c[0] + w * (ds !== 0 ? 1 : 0.5), c[1]], [c[0], c[1] + w * (dt !== 0 ? 1 : 0.6)]];
      s.face(leaf.map((q) => P(q[0], q[1], depth + 0.12)), MAT.GOLD, nrm);
    }
  });
  // the ledge: a level planter box in the window's lower corner, holding flowers that spill over the frame
  const foot = P(Wn[0][0], Wn[0][1] + (Wn[1][1] - Wn[0][1]) * 0.55, depth);
  const lx = Math.abs(Wn[1][0]) * 0.55;
  const er: V2 = [Math.cos(p.a), Math.sin(p.a)], et: V2 = [-er[1], er[0]];
  const cx = foot[0] + er[0] * 1.1, cz = foot[2] + er[1] * 1.1;
  s.obox(cx, cz, Math.atan2(et[1], et[0]), lx, 1.0, foot[1] - 0.8, foot[1] + 0.4, MAT.PLASTER_WARM, { top: MAT.SOIL });
  const poly: V2[] = [[-lx, -0.9], [lx, -0.9], [lx, 0.9], [-lx, 0.9]].map(([u, v]) => [cx + et[0] * u + er[0] * v, cz + et[1] * u + er[1] * v]);
  haul.beds.push({ poly, y: foot[1] + 0.4, kind: 'flowers', density: 0.9, palette: 'pink' });
  haul.beds.push({ poly, y: foot[1] + 0.4, kind: 'vines', density: 0.6, palette: 'purple' });
}

/** the lotus: the main petals (TEMPLE.petals of them, facing the petal faces of the base), the inner ring, the canopy
 *  petals over the portals and the sepals on the cornice */
export function crown(s: Shapes, haul: Haul, count: number, roofY: number, petalH: number, baseR: number) {
  const rnd = rng(42);
  const gold = (): V3 => { const j = (rnd() - 0.5) * 0.06; return [1 + j, 1 + j * 0.8, 1 + j * 0.5]; };
  const step = (2 * Math.PI) / count;
  for (let i = 0; i < count; i++) {
    const a = i * step;
    petal(s, haul, { a, rb: 29, yb: roofY + 0.6, H: petalH, lean: 24 * Math.PI / 180, W: 21.5, sv: 0.42, T: 3.6, fold: 2.6, window: true, tint: gold() });
    petal(s, haul, { a: a + step / 2, rb: 13, yb: roofY + 0.6, H: petalH * 0.7, lean: 9 * Math.PI / 180, W: 10.5, sv: 0.4, T: 2.4, fold: 1.4, window: false, tint: gold() });
    // (the smaller golden roofs between the big petals: low and leaning far out over the portals' faces)
    petal(s, haul, { a: a + step / 2, rb: 33, yb: roofY + 0.6, H: petalH * 0.24, lean: 60 * Math.PI / 180, W: 15, sv: 0.42, T: 1.6, fold: 1.6, window: false, tint: gold() });
  }
  for (let i = 0; i < count * 4; i++) {
    const a = (i + 0.5) * (step / 4);
    petal(s, haul, { a, rb: baseR * 0.95, yb: roofY + 0.4, H: 4.2, lean: 12 * Math.PI / 180, W: 1.9, sv: 0.42, T: 0.55, fold: 0.3, window: false, tint: gold() });
  }
  // sockets the main and inner petals stand in
  for (let i = 0; i < count; i++) {
    const a = i * step;
    for (const [r, h, w] of [[29, 1.4, 3.2], [13, 1.2, 2.2]] as [number, number, number][]) {
      const aa = r === 29 ? a : a + step / 2;
      const c: V2 = [C[0] + Math.cos(aa) * (r + 0.8), C[1] + Math.sin(aa) * (r + 0.8)];
      s.obox(c[0], c[1], aa, w * 0.7, w, roofY, roofY + h, MAT.CREAM, { skip: ['bottom'] });
    }
    // a floodlight on the roof's edge before each great petal, lighting its face up from below at night: the crown
    // glows gold over the city
    const f: V2 = [C[0] + Math.cos(a) * (baseR - 8), C[1] + Math.sin(a) * (baseR - 8)];
    haul.lights.push({ p: [f[0], roofY + 2.5, f[1]], color: [1.0, 0.8, 0.52], candela: 7000, when: 'night', radius: 75 });
  }
}

/** the needle: an octagonal golden spire from a stepped plinth, collars up it, an open lantern near the tip (a light
 *  that burns all night and glints by day) and a point */
export function needle(s: Shapes, haul: Haul, y0: number, top: number) {
  const b = s.b, [cx, cz] = C;
  b.cylinder(cx, cz, 6.2, y0, y0 + 1.6, 8, MAT.CREAM);
  b.cylinder(cx, cz, 5.2, y0 + 1.6, y0 + 3.0, 8, MAT.CREAM);
  b.cylinder(cx, cz, 4.4, y0 + 3.0, y0 + 4.2, 8, MAT.GOLD);
  const lantern = top - 10, shaft0 = y0 + 4.2;
  const r = (y: number) => 3.3 + (0.45 - 3.3) * Math.pow((y - shaft0) / (lantern - shaft0), 0.85);
  const rings = [shaft0, shaft0 + 14, shaft0 + 34, shaft0 + 52, lantern];
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i], c = rings[i + 1];
    b.cylinder(cx, cz, r(a), a, c, 8, MAT.GOLD, { r1: r(c), top: null });
    if (i > 0) collar(b, cx, cz, a, r(a));
  }
  collar(b, cx, cz, lantern, r(lantern) + 0.2);
  // the lantern: a glowing core in an open cage of four posts under a little roof, then the point
  const ly = lantern + 0.6;
  b.with({ glow: 1 }, () => b.cylinder(cx, cz, 0.55, ly, ly + 3.0, 8, MAT.WINDOW));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.cylinder(cx + Math.cos(a) * 0.95, cz + Math.sin(a) * 0.95, 0.12, ly, ly + 3.2, 6, MAT.GOLD);
  }
  b.cylinder(cx, cz, 1.3, ly + 3.2, ly + 3.6, 8, MAT.GOLD);
  b.cylinder(cx, cz, 1.0, ly + 3.6, top, 8, MAT.GOLD, { r1: 0.02 });
  haul.lights.push({ p: [cx, ly + 1.5, cz], color: [1.0, 0.86, 0.62], candela: 9000, when: 'always', radius: 90 });
}

function collar(b: Shapes['b'], cx: number, cz: number, y: number, r: number) {
  b.cylinder(cx, cz, r + 0.55, y - 0.35, y + 0.35, 8, MAT.GOLD);
  b.cylinder(cx, cz, r + 0.3, y + 0.35, y + 0.6, 8, MAT.CREAM);
}
