// Beds: how a formation's stone is layered, and the profile that layering carves. Sandstone erodes by its beds: the hard
// ones (well-cemented sandstone, the caprock) stand out as ledges with flat tops and rounded, pillowy edges; the soft ones
// between (silty, weak) wear back into curved recesses, fluted here and there by the rain. A formation is a stack of beds
// round an axis that wanders a little as it rises; each bed has its own outline (the body's shared lobes times its own
// ragged edge), its radius at its foot and at its top (a ledge sticks out past its neighbours, a recess sits back), a
// recess's curve, how round its edges are and a wavy top. `profile` walks the stack from the foot up: up each bed's wall
// (curved in for soft beds, a little proud for hard ones), round each convex edge on a short arc, and across the step
// to the next bed, giving every step face to the bed whose face it is (a ledge's top to the ledge, an overhang's
// underside to the overhanging bed). `top` closes it over a gently domed (or, for a spire, pointed) top.
import { RF, type Outline, type Pt } from './mesh';
import { Noise3, range, type Rand } from './noise';

export interface Bed {
  y0: number;
  y1: number;
  /** radius at its foot and at its top (m, before the outline) */
  r0: number;
  r1: number;
  hard: boolean;
  o: Outline;
  /** waviness of its top boundary (m) */
  dy: Outline;
  id: number;
  /** a soft bed's recess at mid-height (fraction of its radius); a hard bed's bulge */
  sag: number;
  /** the radius of its convex edges, as a fraction of its thickness */
  round: number;
  /** extra flags for its vertices */
  flags: number;
}

/** level of detail: angle steps (a fraction of the full count), rings up a soft bed, segments round an edge, and (the
 *  far silhouette) beds within this fraction of each other's radius merged into one */
export interface Lod { n: number; soft: number; arc: number; merge?: number }
export const LODS: Lod[] = [
  { n: 1, soft: 3, arc: 3 },
  { n: 0.5, soft: 2, arc: 2 },
  { n: 0.25, soft: 1, arc: 0 },
  { n: 0.125, soft: 0, arc: 0, merge: 0.15 },
];

/** angle steps at a level of detail from the finest level's */
export const stepsAt = (n0: number, lod: Lod) => Math.max(10, Math.round(n0 * lod.n));

/** a far level's beds: runs of beds within `tol` of the run's first bed's radius merged into one (the first's outline
 *  and id, the run's ends' radii), so only the silhouette's real steps and curves remain */
function merged(beds: Bed[], tol: number): Bed[] {
  const out: Bed[] = [];
  let r0 = 0;
  for (const b of beds) {
    const last = out[out.length - 1], rb = (b.r0 + b.r1) / 2;
    if (last && Math.abs(rb - r0) < tol * r0) out[out.length - 1] = { ...last, y1: b.y1, r1: b.r1, dy: b.dy };
    else { out.push({ ...b }); r0 = rb; }
  }
  return out;
}

export const mul = (a: Outline, b: Outline): Outline => (t) => a(t) * b(t);

/** an ellipse's radius at angle t (semi-axes 1 along the angle phi and 1/aspect across it) */
export const ellipse = (aspect: number, phi = 0): Outline => (t) => 1 / Math.sqrt(Math.cos(t - phi) ** 2 + (aspect * Math.sin(t - phi)) ** 2);

/** a unit circle moved off the axis by d (< 1) toward the angle phi, as a radius about the axis: a cap sitting off-centre
 *  on its stem */
export const shifted = (d: number, phi: number): Outline => (t) => {
  const c = Math.cos(t - phi), s = Math.sin(t - phi);
  return d * c + Math.sqrt(Math.max(0, 1 - d * d * s * s));
};

/** the shortest signed angle from b to a */
const dAng = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** outlines for one formation: lobes shared by all its beds, and each bed's own ragged edge */
export class Outlines {
  readonly noise: Noise3;
  constructor(seed: number, readonly lobe = 0.14) { this.noise = new Noise3(seed); }

  /** the body's lobes at a height (h the formation's height, so tall and short rocks keep the same few lobes) */
  body(y: number, h: number): Outline {
    const w = (y / Math.max(h, 1)) * 1.3;
    const n = this.noise;
    return (t) => 1 + this.lobe * (n.ring(t, 0.9, w, 2) * 1.5 + n.ring(t, 2.1, w * 1.7 + 11, 2) * 0.7);
  }

  /** a waist pinched in on two opposite sides at angle a0 (depth 0..1): two legs grown together */
  pinch(a0: number, depth: number, width = 0.55): Outline {
    return (t) => 1 - depth * (Math.exp(-(dAng(t, a0) ** 2) / (width * width)) + Math.exp(-(dAng(t, a0 + Math.PI) ** 2) / (width * width)));
  }

  /** a soft bed's edge: a gentle wobble (amp) and about k vertical flutes of depth f, irregularly spaced and only on
   *  some faces, the same flutes all up the formation */
  soft(salt: number, amp: number, k: number, f: number): Outline {
    const n = this.noise;
    return (t) => {
      const wob = 1 + amp * n.ring(t, 2.6, 7.1 + salt * 3.7, 2) * 1.5;
      if (f <= 0) return wob;
      const ph = k * t + 3.0 * n.ring(t, 1.2, 40, 2);
      const on = Math.min(1, Math.max(0, 0.5 + 1.6 * n.ring(t, 1.0, 47, 2)));
      return wob * (1 - f * on * (1 - Math.pow(Math.abs(Math.sin(ph)), 0.6)));
    };
  }

  /** a hard bed's edge: a wobble of amplitude amp with a few chipped corners (an irregular polygon of c corners,
   *  radii 1 - jag .. 1, blended in by `angular`) */
  hard(r: Rand, salt: number, c: number, jag: number, amp: number, angular = 0.5, lobe = 0.16): Outline {
    const angs: number[] = [];
    let a = 0;
    for (let i = 0; i < c; i++) { angs.push(a); a += range(r, 0.55, 1.45); }
    const a0 = r() * Math.PI * 2;
    for (let i = 0; i < c; i++) angs[i] = a0 + (angs[i] / a) * Math.PI * 2;
    const rad = angs.map(() => 1 - jag * r());
    const n = this.noise;
    return (t) => {
      // (the polygon's distance at angle t: the ray against the edge between the corners either side)
      let tt = (t - angs[0]) % (Math.PI * 2);
      if (tt < 0) tt += Math.PI * 2;
      tt += angs[0];
      let k = c - 1;
      for (let i = 0; i < c - 1; i++) if (tt < angs[i + 1]) { k = i; break; }
      const b0 = angs[k], b1 = k + 1 < c ? angs[k + 1] : angs[0] + Math.PI * 2;
      const q0 = rad[k], q1 = rad[(k + 1) % c];
      const p0x = Math.cos(b0) * q0, p0z = Math.sin(b0) * q0;
      const ex = Math.cos(b1) * q1 - p0x, ez = Math.sin(b1) * q1 - p0z;
      const dx = Math.cos(tt), dz = Math.sin(tt);
      const den = dx * ez - dz * ex;
      const poly = Math.abs(den) < 1e-9 ? q0 : (p0x * ez - p0z * ex) / den;
      const arc = q0 + (q1 - q0) * ((tt - b0) / (b1 - b0));
      // (a ledge stands out further on some sides than others: its own broad lobes, besides the body's)
      const wob = (1 + amp * n.ring(t, 2.4, 90 + salt * 2.3, 3) * 1.5) * (1 + lobe * n.ring(t, 0.8, 500 + salt * 1.3, 2) * 1.5);
      return (angular * poly + (1 - angular) * arc) * wob;
    };
  }

  /** a wavy bed boundary of amplitude a (m) */
  wave(salt: number, a: number): Outline {
    const n = this.noise;
    return (t) => a * n.ring(t, 1.7, 130 + salt * 1.9, 2) * 1.4;
  }

  /** an axis that wanders by up to about `a` (m) over a height h, as noise in height */
  wander(a: number, h: number, salt = 0): (y: number) => [number, number] {
    const n = this.noise;
    return (y) => { const u = (y / Math.max(h, 1)) * 1.4; return [a * n.fbm(u, 300 + salt, 0.5, 2) * 1.6, a * n.fbm(u, 340 + salt, 0.5, 2) * 1.6]; };
  }
}

/** the bed coordinate of height y in bed b */
export const bedAt = (b: Bed, y: number) => b.id + Math.min(0.999, Math.max(0, (y - b.y0) / Math.max(b.y1 - b.y0, 1e-3)));

/** give each boundary between beds its waves, gentle against the thinner of the two beds it divides */
export function waves(beds: Bed[], ol: Outlines, frac = 0.15, cap = 0.35) {
  for (let i = 0; i < beds.length; i++) {
    const t = beds[i].y1 - beds[i].y0, tn = i + 1 < beds.length ? beds[i + 1].y1 - beds[i + 1].y0 : t;
    beds[i].dy = ol.wave(beds[i].id, Math.min(frac * Math.min(t, tn), cap));
  }
}

export interface ProfileOpts {
  /** a step smaller than this (m) is no step: the walls just meet */
  minStep?: number;
  /** closed underneath: a flat, slightly hollow bottom (m of hollow); else open at the foot */
  bottom?: number;
}

/** The side of a stack of beds as a profile, from its foot (or its closed bottom) to the top edge of the last bed. */
export function profile(beds0: Bed[], lod: Lod, o: ProfileOpts = {}): Pt[] {
  const beds = lod.merge ? merged(beds0, lod.merge) : beds0;
  const pts: Pt[] = [];
  const minStep = o.minStep ?? 0.05;
  const flat: Outline = () => 0;
  /** a convex edge on a quarter arc about (cr, cy), radius b, from angle a0 to a1 */
  const arc = (b: Bed, cr: number, cy: number, rad: number, a0: number, a1: number, dy: Outline, f: number, extra: number) => {
    // (small edges get fewer segments: about one per 12 cm of radius)
    const k = Math.max(1, Math.min(lod.arc, Math.round(rad / 0.12)));
    for (let s = 0; s <= k; s++) {
      const a = a0 + ((a1 - a0) * s) / k;
      const y = cy + rad * Math.sin(a);
      pts.push({ r: cr + rad * Math.cos(a), y, o: b.o, dy, bed: bedAt(b, y), flags: f | (s === k ? extra : 0) });
    }
  };
  for (let i = 0; i < beds.length; i++) {
    const b = beds[i];
    const h = b.y1 - b.y0, f = (b.hard ? RF.HARD : 0) | b.flags;
    const prev = i > 0 ? beds[i - 1] : null, next = i + 1 < beds.length ? beds[i + 1] : null;
    const dy0 = prev ? prev.dy : flat;
    // the edges' radii: a convex edge where the bed overhangs the one below (or closes the bottom) and where it is a
    // ledge (or the top); together never more than most of the bed
    const overhang = prev !== null && b.r0 - prev.r1 > minStep;
    const ledge = !next || b.r1 - next.r0 > minStep;
    const edge = (r: number) => (lod.arc > 0 ? Math.min(b.round * h, r * 0.25, h * 0.4) : 0);
    // (an edge no wider than most of the step it rounds, or the step folds back under it)
    const e0 = overhang ? Math.min(edge(b.r0), 0.7 * (b.r0 - prev!.r1)) : !prev && o.bottom !== undefined ? edge(b.r0) : 0;
    const e1 = ledge ? Math.min(edge(b.r1), next ? 0.7 * (b.r1 - next.r0) : Infinity) : 0;
    // the foot: a closed bottom, an overhang's underside, or this bed's own copy of the ring it starts from
    if (!prev && o.bottom !== undefined) {
      pts.push({ r: 0, y: b.y0 + o.bottom, o: b.o, bed: b.id, flags: f });
      pts.push({ r: b.r0 * 0.55, y: b.y0 + o.bottom * 0.6, o: b.o, bed: b.id, flags: f });
    } else if (prev) pts.push({ ...pts[pts.length - 1], bed: b.id, flags: f, brk: true });
    if (prev === null && o.bottom === undefined) pts.push({ r: b.r0, y: b.y0, o: b.o, dy: dy0, bed: b.id, flags: f });
    else if (overhang || prev === null) {
      if (e0 > 0.02) arc(b, b.r0 - e0, b.y0 + e0, e0, -Math.PI / 2, 0, dy0, f, 0);
      else pts.push({ r: b.r0, y: b.y0, o: b.o, dy: dy0, bed: b.id, flags: f });
    }
    // up the wall between its edges: a soft bed curves in, a hard one stands a little proud at its middle
    const m = b.hard ? (h > 1.5 && lod.soft > 1 ? 1 : 0) : b.sag > 0 ? lod.soft : 0;
    const w0 = b.y0 + (e0 > 0.02 ? e0 : 0), w1 = b.y1 - (e1 > 0.02 ? e1 : 0);
    for (let k = 1; k <= m; k++) {
      const y = w0 + ((w1 - w0) * k) / (m + 1);
      const t = (y - b.y0) / h;
      const r = (b.r0 + (b.r1 - b.r0) * t) * (b.hard ? 1 + b.sag * Math.sin(Math.PI * t) : 1 - b.sag * Math.sin(Math.PI * t));
      const da = dy0, db = b.dy;
      pts.push({ r, y, o: b.o, dy: (th) => da(th) * (1 - t) + db(th) * t, bed: bedAt(b, y), flags: f });
    }
    // the top: a ledge (or the very top) rounds its edge and walks in across to the next bed's foot; otherwise the
    // wall runs up to the corner under the next bed (on the next bed's outline when they just meet)
    if (ledge) {
      if (e1 > 0.02) arc(b, b.r1 - e1, b.y1 - e1, e1, 0, Math.PI / 2, b.dy, f, 0);
      else pts.push({ r: b.r1, y: b.y1, o: b.o, dy: b.dy, bed: bedAt(b, b.y1), flags: f });
      if (next) pts.push({ r: next.r0, y: b.y1, o: next.o, dy: b.dy, bed: bedAt(b, b.y1), flags: f });
    } else {
      const meet = next!.r0 - b.r1 <= minStep;
      pts.push({ r: meet ? next!.r0 : b.r1, y: b.y1, o: meet ? next!.o : b.o, dy: b.dy, bed: bedAt(b, b.y1), flags: f });
    }
  }
  return pts;
}

/** The top of a stack: in from its last ring over a surface rising `rise` (m) at the axis — a gentle dome (shape 2) or
 *  a point (shape 1 is a cone) — uneven by `rough` (m). */
export function top(pts: Pt[], lod: Lod, rise: number, rough: number, noise: Noise3, salt: number, shape = 2): Pt[] {
  const edge = pts[pts.length - 1];
  const steps = lod.n >= 1 ? [0.82, 0.58, 0.32] : lod.n >= 0.5 ? [0.7, 0.35] : [0.5];
  const out: Pt[] = [];
  const ed = edge.dy ?? (() => 0);
  for (const s of steps) {
    const lift = rise * (1 - Math.pow(s, shape));
    const dy: Outline = (t) => ed(t) * s + lift + rough * s * noise.ring(t, 2.2 * s + 0.4, 200 + salt + s * 5, 2);
    out.push({ r: edge.r * s, y: edge.y, o: edge.o, dy, bed: edge.bed, flags: edge.flags });
  }
  out.push({ r: 0, y: edge.y + rise, o: edge.o, bed: edge.bed, flags: edge.flags });
  return out;
}
