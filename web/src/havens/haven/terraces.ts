// The terraced gardens: each wedge round the temple steps down in bands, and each band is a terrace built to one
// section (radius outward from the wall that holds the band above): a canal along the foot of that wall catching the
// cascades that spill from it, a walk beside the canal, the sunken parterres (parterres.ts) between radial cross-walks
// and the spine allée with its channel, an outer promenade, and the next retaining wall, whose top is a planter trough
// spilling vines, with piers, lanterns and urns along it. The water runs down the spine: canal, channel, a spout
// through the wall, a cascade into the canal below (and at the side cross-walks the same, smaller). Pairs of stairs hang
// on the walls, landing in a break of the parapet and running down the wall's face toward the spine. Where a wedge meets
// the stair's notch its edge is a cut rock face; the sunken north courts are walled up to the top. Colliders: radial
// strips of boxes per wedge (terraceColliders.ts), a frame per flight.
import { MAT, type Mat, type V3 } from '../arch/types';
import type { V2 } from '../world/layout';
import { Frame, type Haul } from './colliders';
import { bay, BAY_KINDS, type BayKind } from './parterres';
import {
  COPING, FOOT, PARAPET, POOL_FLOOR, TOP, WALK, WALL_IN, WALL_OUT, WATER, WEDGES, notchFloor, reach, rng, NOTCH_TOP,
  type Band, type Wedge,
} from './plan';
import { arc, pt, rayLim, sector, sectorPair, side, type Lim, type Shapes } from './shapes';
import { terraceColliders } from './terraceColliders';

export const RISER = 0.17;
export const TREAD = 0.32;
export const STAIR_W = 2.6;
/** the inner walk and the promenade (from the band's inner radius / to its outer radius), the canal zone */
export const FOOT_ZONE = 4.6;
export const INNER_WALK = 6.6;
export const PROMENADE = 4.4;
/** the spine channel's half-width and its copings', the allée's half-width, a cross-walk's half-width */
export const CHANNEL = 0.6;
export const CHANNEL_COPING = 1.0;
export const ALLEE = 2.4;
export const CROSS = 1.1;
/** a deep band's parterres split into two rows with a walk between */
export const TWO_ROWS = 21;

/** a flight hung on the wall at a band's inner radius, on one side of the spine: its landing's centre (angle offset
 *  from the spine), the flight's run and step count */
export interface WallStair { sigma: 1 | -1; d: number; run: number; n: number }

export interface BandPlan {
  b: Band;
  wd: Wedge;
  R: number;
  Rn: number;
  f: number;
  wk: number;
  upper: BandPlan | null;
  last: boolean;
  /** stairs from the band above down this band's inner wall */
  stairs: WallStair[];
  /** the canal's half-extent (angle about the spine; 0: no canal) */
  canal: number;
  /** side runnels down the first cross-walks, spilling into the canal below */
  runnel: boolean;
  kinds: [BayKind, BayKind];
  palette: number;
  /** the band's reach inside its side walls, and at their faces */
  lo: Lim;
  hi: Lim;
  loEdge: Lim;
  hiEdge: Lim;
  /** the radial lines of the cross-walks (angle offsets from the spine) */
  lines: number[];
  /** a blind arcade along this band's inner wall behind the canal */
  arcade: boolean;
}

export function buildTerraces(s: Shapes, haul: Haul) {
  for (const wd of WEDGES) {
    const plans = planWedge(wd);
    for (const p of plans) {
      if (p.upper) wall(s, haul, p.upper, p.R, p);
      if (p.upper) foot(s, haul, p);
      walks(s, haul, p);
      spine(s, haul, p);
      parterre(s, haul, p);
      sides(s, p);
    }
    const last = plans[plans.length - 1];
    if (wd.kind === 'flank') { wall(s, haul, last, last.Rn, null); belvedere(s, haul, last); }
    else courtEnd(s, haul, last);
    terraceColliders(haul, plans);
  }
}

/** the per-band plan of a wedge: its stairs, canal, runnels and planting */
export function planWedge(wd: Wedge): BandPlan[] {
  const h = (wd.w.a1 - wd.w.a0) / 2;
  const lines = [h / 2, h];
  const inset = (k: Wedge['lo']['kind']) => (k === 'stair' ? 0.6 : k === 'radial' ? 1.2 : 0);
  const iLo = inset(wd.lo.kind), iHi = inset(wd.hi.kind);
  const loEdge: Lim = (r) => reach(wd, r)[0], hiEdge: Lim = (r) => reach(wd, r)[1];
  const lo: Lim = (r) => loEdge(r) + iLo / r, hi: Lim = (r) => hiEdge(r) - iHi / r;
  const rnd = rng(wd.i, 7);
  const plans: BandPlan[] = [];
  wd.bands.forEach((b, k) => {
    const upper = plans[k - 1] ?? null;
    const p: BandPlan = {
      b, wd, R: b.r0, Rn: b.r1, f: b.floor, wk: b.walk, upper, last: k === wd.bands.length - 1, stairs: [], canal: 0, runnel: false,
      kinds: [BAY_KINDS[Math.floor(rnd() * BAY_KINDS.length)], BAY_KINDS[Math.floor(rnd() * BAY_KINDS.length)]],
      palette: Math.floor(rnd() * 5), lo, hi, loEdge, hiEdge, lines, arcade: false,
    };
    // the flagship pattern on alternate bands: a lotus pool by the spine
    if (k % 2 === 1) p.kinds[0] = 'pool';
    if (upper) {
      const Rf = b.r0 + WALL_OUT + STAIR_W / 2, Rz = b.r0 + WALL_OUT + 1.8;
      const n = Math.round((upper.wk - b.walk) / RISER), run = n * TREAD;
      let reachS = Infinity;
      for (const sigma of [1, -1] as const) {
        const room = (sigma > 0 ? hi(Rf) - wd.am : wd.am - lo(Rf)) * Rf;
        reachS = Math.min(reachS, room);
        // (on the second cross-walk where it fits, else the first)
        for (const d of [lines[1], lines[0]]) {
          if (d * Rf + STAIR_W / 2 + 1 <= room && d * Rf - STAIR_W / 2 - run >= 6) { p.stairs.push({ sigma, d, run, n }); break; }
        }
      }
      let canalS = reachS - 1.5;
      for (const st of p.stairs) canalS = Math.min(canalS, st.d * Rf - STAIR_W / 2 - st.run - 1.4);
      p.canal = Math.max(0, canalS) / Rz;
      p.arcade = (k + wd.i) % 2 === 0 && canalS > 9;
    }
    plans.push(p);
  });
  // a runnel down the first cross-walks where both this band's canal and the next one reach that far
  plans.forEach((p, k) => {
    const nx = plans[k + 1];
    p.runnel = !!nx && p.canal > lines[0] + 1.6 / p.R && nx.canal > lines[0] + 1.6 / nx.R;
  });
  return plans;
}

const jitter = (rnd: () => number, a: number): V3 => { const j = (rnd() - 0.5) * 2 * a; return [1 + j, 1 + j * 0.85, 1 + j * 0.7]; };

/** an opening in a wall: its centre angle and half-width (m) and what passes through (a flight's landing, a spout, the
 *  way onto a belvedere) */
interface Opening { a: number; hw: number; kind: 'stair' | 'spout' | 'way' }

/** the retaining wall at radius R holding band `up` above band `low` (or, with low null, the outer wall over the cliff):
 *  terracotta faces, a cream string course at the upper walk's level, a planter trough along its top with cream rims,
 *  piers with lanterns and urns, buttresses down its face, spouts and their cascades */
function wall(s: Shapes, haul: Haul, up: BandPlan, R: number, low: BandPlan | null) {
  const b = s.b, wd = up.wd, am = wd.am;
  const ri = R - WALL_IN, ro = R + WALL_OUT;
  const fu = up.f, wu = up.wk, top = fu + PARAPET, soil = fu + 1.15;
  const bottom = low ? low.f - FOOT : fu - 14;
  const rnd = rng(wd.i, up.b.k, 11);
  const ext = (k: Wedge['lo']['kind']) => (k === 'ramp' || k === 'promenade' ? 0.02 : 0);
  const lo = (r: number) => up.loEdge(r) - ext(wd.lo.kind) / r, hi = (r: number) => up.hiEdge(r) + ext(wd.hi.kind) / r;
  // openings: the spout at the spine (or the way onto the belvedere), the runnels' spouts, the flights' landings
  const open: Opening[] = [{ a: am, hw: low ? 0.8 : 3.0, kind: low ? 'spout' : 'way' }];
  if (up.runnel) for (const sg of [1, -1]) open.push({ a: am + sg * up.lines[0], hw: 0.5, kind: 'spout' });
  if (low) for (const st of low.stairs) open.push({ a: am + st.sigma * st.d, hw: STAIR_W / 2, kind: 'stair' });
  open.sort((p, q) => p.a - q.a);
  const pieces: [number, number][] = [];
  let at = lo(R);
  for (const o of open) {
    const a0 = o.a - o.hw / R, a1 = o.a + o.hw / R;
    if (a0 > at) pieces.push([at, a0]);
    at = Math.max(at, a1);
  }
  if (hi(R) > at) pieces.push([at, hi(R)]);
  const clampTo = (r: number, a: number) => Math.min(hi(r), Math.max(lo(r), a));
  // a blind arcade behind the canal below (an odd number of bays, one centred under the spout)
  let arc0 = 0, arc1 = 0, nA = 0;
  if (low?.arcade) {
    const half = low.canal * (low.R + WALL_OUT + 1.8) - 1.0;
    nA = Math.floor((2 * half) / ARCH_BAY);
    if (nA % 2 === 0) nA--;
    arc0 = am - (nA * ARCH_BAY) / 2 / ro;
    arc1 = am + (nA * ARCH_BAY) / 2 / ro;
  }
  const aY0 = (low?.f ?? 0) + COPING, aY1 = aY0 + ARCH_H;
  b.with({ tint: jitter(rnd, 0.05) }, () => {
    // the face toward the band below, to the string course (round the arcade, if any)
    if (nA > 0) {
      s.strip(arc(ro, lo(ro), arc0), bottom, wu - 0.25, MAT.PLASTER, false).strip(arc(ro, arc1, hi(ro)), bottom, wu - 0.25, MAT.PLASTER, false);
      const mid = arc(ro, arc0, arc1, ARCH_BAY + 1e-3);
      s.strip(mid, bottom, aY0, MAT.PLASTER, false).strip(mid, aY1, wu - 0.25, MAT.PLASTER, false);
      arcade(s, ro, arc0, arc1, nA, aY0);
    } else s.strip(arc(ro, lo(ro), hi(ro)), bottom, wu - 0.25, MAT.PLASTER, false);
    s.strip(arc(ro, lo(ro), hi(ro)), wu - 0.25, wu, MAT.CREAM, false);
    for (const [p0, p1] of pieces) {
      const o0 = clampTo(ro, p0), o1 = clampTo(ro, p1), i0 = clampTo(ri, p0), i1 = clampTo(ri, p1);
      s.strip(arc(ro, o0, o1), wu, top - 0.12, MAT.PLASTER, false).strip(arc(ro, o0, o1), top - 0.12, top, MAT.CREAM, false);
      s.strip(arc(ri, i0, i1), wu, top - 0.12, MAT.PLASTER, true).strip(arc(ri, i0, i1), top - 0.12, top, MAT.CREAM, true);
      // the trough: rims and soil
      const rimI = ri + 0.25, rimO = ro - 0.25;
      s.flat(arc(rimI, p0, p1), arc(ri, p0, p1), top, top, MAT.CREAM);
      s.flat(arc(ro, p0, p1), arc(rimO, p0, p1), top, top, MAT.CREAM);
      s.flat(arc(rimO, p0, p1), arc(rimI, p0, p1), soil, soil, MAT.SOIL);
      s.strip(arc(rimI, p0, p1), soil, top, MAT.CREAM, false).strip(arc(rimO, p0, p1), soil, top, MAT.CREAM, true);
      const trough = sector(rimI, rimO, () => p0, () => p1);
      haul.beds.push({ poly: trough, y: soil, kind: rnd() < 0.8 ? 'vines' : 'flowers', density: 0.85, palette: 'purple' });
      // the piece's ends where it breaks for an opening (the wall's own ends meet a causeway, a cut or a side wall)
      for (const [e, faceUp] of [[p0, false], [p1, true]] as [number, boolean][]) {
        if (Math.abs(e - lo(R)) < 1e-6 || Math.abs(e - hi(R)) < 1e-6) continue;
        const pi = pt(ri, e), po = pt(ro, e);
        s.strip(faceUp ? [po, pi] : [pi, po], wu, top, MAT.PLASTER, true);
      }
    }
    // thresholds and spout channels through the openings
    for (const o of open) {
      const a0 = o.a - o.hw / R, a1 = o.a + o.hw / R;
      if (o.kind === 'spout') {
        s.flat(arc(ro, a0, a1), arc(ri, a0, a1), fu + POOL_FLOOR, fu + POOL_FLOOR, MAT.POOL);
        for (const [e, faceUp] of [[a0, true], [a1, false]] as [number, boolean][]) {
          const pi = pt(ri, e), po = pt(ro, e);
          s.strip(faceUp ? [po, pi] : [pi, po], fu + POOL_FLOOR, wu, MAT.CREAM, true);
        }
        // the lip and the cascade off it
        const lipR = ro + 0.7, lw = o.hw - 0.08;
        const c = pt(ro + 0.35, o.a);
        s.obox(c[0], c[1], o.a, 0.38, lw, fu + 0.22, fu + WATER - 0.02, MAT.CREAM);
        if (low) haul.water.push({ kind: 'cascade', a: pt(lipR, o.a - lw / lipR), b: pt(lipR, o.a + lw / lipR), top: fu + WATER, bottom: low.f + WATER });
      } else {
        s.flat(arc(ro, a0, a1), arc(ri, a0, a1), wu, wu, MAT.PAVING);
      }
    }
    // the wall's ends where it meets a causeway's blade (elsewhere a cut face or a side wall covers them)
    if (wd.lo.kind === 'ramp' || wd.lo.kind === 'promenade') s.strip([pt(ri, lo(ri)), pt(ro, lo(ro))], bottom, top, MAT.PLASTER, false);
    if (wd.hi.kind === 'ramp' || wd.hi.kind === 'promenade') s.strip([pt(ri, hi(ri)), pt(ro, hi(ro))], bottom, top, MAT.PLASTER, true);
  });
  // buttresses down the face below the string course, clear of the openings and the flights against it
  const busy = (a: number) => open.some((o) => Math.abs(a - o.a) * R < o.hw + 1.4) || (nA > 0 && a > arc0 - 1.5 / ro && a < arc1 + 1.5 / ro)
    || (low?.stairs ?? []).some((st) => { const d = (a - am) * st.sigma; return d * R > st.d * R - STAIR_W / 2 - st.run - 1 && d * R < st.d * R + STAIR_W / 2 + 1; });
  const span = (hi(ro) - lo(ro)) * ro, nB = Math.floor(span / 6.2);
  for (let i = 1; i < nB; i++) {
    const a = lo(ro) + ((hi(ro) - lo(ro)) * i) / nB;
    if (busy(a)) continue;
    const c = pt(ro + 0.2, a), tan = a + Math.PI / 2;
    s.obox(c[0], c[1], tan, 0.5, 0.3, low ? low.f : bottom, wu - 0.25, MAT.PLASTER, { top: MAT.CREAM, skip: ['bottom'] });
    s.obox(c[0], c[1], tan, 0.62, 0.38, (low ? low.wk : bottom) - 0.2, (low ? low.wk : bottom) + 0.5, MAT.ASHLAR, { skip: ['bottom'] });
  }
  // piers along the parapet: lanterns on every other one, urns on the rest
  const nP = Math.max(1, Math.round(((hi(R) - lo(R)) * R) / 15));
  let lit = 0;
  for (let i = 1; i < nP; i++) {
    const a = lo(R) + ((hi(R) - lo(R)) * i) / nP;
    if (open.some((o) => Math.abs(a - o.a) * R < o.hw + 1.6)) continue;
    const c = pt(R - 0.2, a), tan = a + Math.PI / 2;
    s.pier(c[0], c[1], tan, 0.55, wu, top + 0.62, MAT.ASHLAR, MAT.CREAM);
    if (lit++ % 2 === 0) lantern(s, haul, c, tan, top + 0.62);
    else s.urn(c[0], c[1], top + 0.62, MAT.PLASTER_WARM, MAT.CREAM, MAT.SOIL, 0.8);
    // the pier comes down the face as a cream pilaster to the terrace below (not through the arcade or a flight)
    if (busy(a)) continue;
    const q = pt(ro + 0.12, a), foot = low ? low.wk - 0.1 : bottom;
    s.obox(q[0], q[1], tan, 0.6, 0.18, foot, top - 0.12, MAT.ASHLAR, { skip: ['bottom'] });
    s.obox(q[0], q[1], tan, 0.72, 0.26, foot, foot + 0.7, MAT.CREAM, { skip: ['bottom'] });
  }
  // stone benches on the promenade before the parapet, looking out, between every other pair of piers
  for (let i = 1; i < nP; i += 2) {
    const a = lo(R) + ((hi(R) - lo(R)) * (i + 0.5)) / nP;
    if (open.some((o) => Math.abs(a - o.a) * R < o.hw + 3)) continue;
    const c = pt(R - WALL_IN - 0.75, a);
    s.bench(c[0], c[1], a + Math.PI / 2, wu, MAT.CREAM, 2.4);
  }
}

/** a blind arcade's bay width and height (sill to its top) */
const ARCH_BAY = 4.4;
const ARCH_H = 5.0;

/** a blind arcade on a wall's face at radius ro between angles a0 and a1 in n bays: piers, round arches recessed into
 *  the wall over a sill at y0, a cream impost band and keystones; the recesses dim */
function arcade(s: Shapes, ro: number, a0: number, a1: number, n: number, y0: number) {
  const half = 1.55, spring = y0 + 2.5, crown = spring + half, y1 = y0 + ARCH_H, depth = 0.75, seg = 8;
  for (let k = 0; k < n; k++) {
    const A = pt(ro, a0 + ((a1 - a0) * k) / n), B = pt(ro, a0 + ((a1 - a0) * (k + 1)) / n);
    const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2, L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const t: V2 = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
    let nn: V2 = [t[1], -t[0]];
    if (nn[0] * (mx - pt(0, 0)[0]) + nn[1] * (mz - pt(0, 0)[1]) < 0) nn = [-nn[0], -nn[1]];
    const P = (u: number, y: number, v: number): V3 => [mx + t[0] * u + nn[0] * v, y, mz + t[1] * u + nn[1] * v];
    const out: V3 = [nn[0], 0, nn[1]], h = L / 2;
    const curve = (f0: number, f1: number, v: number) => Array.from({ length: seg + 1 }, (_, i) => {
      const f = f0 + ((f1 - f0) * i) / seg;
      return P(Math.cos(f) * half, spring + Math.sin(f) * half, v);
    });
    s.face([P(-h, y0, 0), P(-half, y0, 0), P(-half, y1, 0), P(-h, y1, 0)], MAT.PLASTER, out);
    s.face([P(half, y0, 0), P(h, y0, 0), P(h, y1, 0), P(half, y1, 0)], MAT.PLASTER, out);
    s.face([P(-half, y1, 0), P(0, y1, 0), ...curve(Math.PI / 2, Math.PI, 0)], MAT.PLASTER, out);
    s.face([P(half, y1, 0), P(half, spring, 0), ...curve(0, Math.PI / 2, 0).slice(1), P(0, y1, 0)], MAT.PLASTER, out);
    s.b.with({ ao: 0.55 }, () => {
      s.face([P(-half, y0, -depth), P(half, y0, -depth), ...curve(0, Math.PI, -depth)], MAT.PLASTER_WARM, out);
      s.face([P(-half, y0, 0), P(-half, y0, -depth), P(-half, spring, -depth), P(-half, spring, 0)], MAT.PLASTER_WARM, [t[0], 0, t[1]]);
      s.face([P(half, y0, 0), P(half, y0, -depth), P(half, spring, -depth), P(half, spring, 0)], MAT.PLASTER_WARM, [-t[0], 0, -t[1]]);
      const c0 = curve(0, Math.PI, 0), c1 = curve(0, Math.PI, -depth);
      for (let i = 0; i < seg; i++) {
        const f = ((i + 0.5) / seg) * Math.PI;
        s.face([c0[i], c0[i + 1], c1[i + 1], c1[i]], MAT.PLASTER_WARM, [-Math.cos(f) * t[0], -Math.sin(f), -Math.cos(f) * t[1]]);
      }
    });
    s.face([P(-half, y0, 0), P(half, y0, 0), P(half, y0, -depth), P(-half, y0, -depth)], MAT.CREAM, [0, 1, 0]);
    // imposts at the springing and a keystone at the crown
    for (const sg of [-1, 1]) {
      const q = P(sg * (half + 0.25), spring - 0.12, 0.06);
      s.obox(q[0], q[2], Math.atan2(t[1], t[0]), 0.3, 0.07, spring - 0.25, spring, MAT.CREAM);
    }
    const kq = P(0, crown, 0.08);
    s.obox(kq[0], kq[2], Math.atan2(t[1], t[0]), 0.26, 0.09, crown - 0.45, crown + 0.2, MAT.CREAM);
  }
  // the band over the arches
  s.strip(arc(ro + 0.06, a0, a1, ARCH_BAY + 1e-3), y0 + ARCH_H - 0.3, y0 + ARCH_H, MAT.CREAM, false);
}

export function lantern(s: Shapes, haul: Haul, c: V2, a: number, y: number, scale = 1) {
  s.lantern(c[0], c[1], a, y, { glass: MAT.WINDOW, frame: MAT.CREAM, knob: MAT.GOLD }, scale);
  haul.lights.push({ p: [c[0], y + 0.4 * scale, c[1]], color: [1.0, 0.72, 0.42], candela: 45 * scale, when: 'night', radius: 10 });
}

/** the zone along the foot of a band's inner wall: the canal in the middle, the flights and their landings hung on
 *  the wall, raised planters beyond, paving in front of them all */
function foot(s: Shapes, haul: Haul, p: BandPlan) {
  const b = s.b, am = p.wd.am, R = p.R, f = p.f, wk = p.wk, up = p.upper!;
  const z0 = R + WALL_OUT, z1 = R + FOOT_ZONE, Rz = R + WALL_OUT + 1.8, Rf = R + WALL_OUT + STAIR_W / 2;
  const rnd = rng(p.wd.i, p.b.k, 13);
  const c = p.canal;
  // the canal: mosaic floor, a cream coping along its front and ends, its water and lilies
  if (c > 0) {
    const lo: Lim = () => am - c, hi: Lim = () => am + c, cw = 0.4;
    s.slab(sector(z0, z1 - cw, lo, hi), f + POOL_FLOOR, MAT.POOL);
    b.prism(sector(z1 - cw, z1, lo, hi), f + POOL_FLOOR, f + COPING, MAT.CREAM);
    for (const sg of [1, -1]) {
      const e0 = sg > 0 ? am + c - cw / Rz : am - c, e1 = sg > 0 ? am + c : am - c + cw / Rz;
      b.prism(sector(z0, z1 - cw, () => e0, () => e1), f + POOL_FLOOR, f + COPING, MAT.CREAM);
    }
    const water = sector(z0, z1 - cw, () => am - c + cw / Rz, () => am + c - cw / Rz);
    haul.water.push({ kind: 'pool', poly: water, level: f + WATER, depth: WATER - POOL_FLOOR });
    if (rnd() < 0.5) haul.beds.push({ poly: water, y: f + WATER, kind: 'lotus', density: 0.22 });
  }
  for (const sg of [1, -1] as const) {
    const st = p.stairs.find((q) => q.sigma === sg);
    const edge = (r: number) => (sg > 0 ? p.hi(r) : p.lo(r));
    const off = (r: number, d: number) => am + sg * d / r;
    // angle offsets (m of arc at Rf) where things start along this side
    const sc = c * Rz;
    const ranges: { from: number; to: number; what: 'pave' | 'planter' | 'front' }[] = [];
    if (st) {
      const ft = st.d * Rf - STAIR_W / 2, fb = ft - st.run, le = st.d * Rf + STAIR_W / 2;
      ranges.push({ from: sc, to: fb, what: 'pave' }, { from: fb, to: le, what: 'front' }, { from: le, to: Infinity, what: 'planter' });
      flight(s, haul, p, up, st);
    } else ranges.push({ from: sc, to: sc + 1.2, what: 'pave' }, { from: sc + 1.2, to: Infinity, what: 'planter' });
    for (const g of ranges) {
      const lim = (r: number, m: number) => {
        const a = off(r, Math.min(m, 1e5));
        const e = edge(r);
        return sg > 0 ? Math.min(a, e) : Math.max(a, e);
      };
      const A: Lim = (r) => lim(r, g.from), B: Lim = (r) => lim(r, g.to);
      const L: Lim = sg > 0 ? A : B, H: Lim = sg > 0 ? B : A;
      if ((H(z0) - L(z0)) * z0 < 0.3) continue;
      if (g.what === 'pave') s.slab(sector(z0, z1, L, H), wk, MAT.PAVING);
      else if (g.what === 'front') s.slab(sector(R + WALL_OUT + STAIR_W, z1, L, H), wk, MAT.PAVING);
      else {
        const [o, i] = sectorPair(z0, R + 2.6, L, H, 0.25);
        b.with({ tint: jitter(rnd, 0.04) }, () => s.ring(o, i, wk, f + 1.15, f + 1.3, MAT.PLASTER, MAT.CREAM, 0.12));
        s.slab(i, f + 1.15, MAT.SOIL);
        haul.beds.push({ poly: i, y: f + 1.15, kind: rnd() < 0.6 ? 'shrubs' : 'flowers', density: 0.8, palette: rnd() < 0.5 ? 'pink' : 'white' });
        s.slab(sector(R + 2.6, z1, L, H), wk, MAT.PAVING);
      }
    }
  }
}

/** a flight hung on the wall at a band's inner radius: its landing in the parapet's break above, the flight running
 *  down the wall's face toward the spine, a parapet on its open side and a lantern on the landing */
function flight(s: Shapes, haul: Haul, p: BandPlan, up: BandPlan, st: WallStair) {
  const b = s.b, am = p.wd.am, R = p.R, sg = st.sigma;
  const Rf = R + WALL_OUT + STAIR_W / 2;
  const at = (m: number) => pt(Rf, am + sg * m / Rf);
  const ft = st.d * Rf - STAIR_W / 2, fb = ft - st.run, le = st.d * Rf + STAIR_W / 2;
  const T = at(ft), B = at(fb);
  b.stairs(B[0], p.wk, B[1], T[0], up.wk, T[1], STAIR_W, st.n, MAT.ASHLAR, { side: MAT.PLASTER, foot: p.f });
  // the landing: a block from the floor up to the walk above
  const lA: Lim = () => am + sg * Math.min(ft, le) / Rf, lB: Lim = () => am + sg * Math.max(ft, le) / Rf;
  b.prism(sector(R + WALL_OUT - 0.05, R + WALL_OUT + STAIR_W, sg > 0 ? lA : lB, sg > 0 ? lB : lA), p.f, up.wk, MAT.PLASTER, { top: MAT.PAVING });
  // the parapet on the open side: sloped along the flight, level round the landing
  const out = (q: V2, d: number): V2 => { const dx = q[0] - pt(0, 0)[0], dz = q[1] - pt(0, 0)[1], l = Math.hypot(dx, dz); return [q[0] + (dx / l) * d, q[1] + (dz / l) * d]; };
  const e = STAIR_W / 2 - 0.15;
  const pB = out(B, e), pT = out(T, e), pL = out(at(le), e);
  slopedWall(s, pB, pT, p.wk - 0.3, up.wk - 0.3, 1.25, 0.3, MAT.PLASTER, MAT.CREAM);
  slopedWall(s, pT, pL, up.wk - 0.3, up.wk - 0.3, 1.25, 0.3, MAT.PLASTER, MAT.CREAM);
  const wl0 = pt(R + WALL_OUT, am + sg * (le - 0.15) / Rf);
  slopedWall(s, pL, wl0, up.wk - 0.3, up.wk - 0.3, 1.25, 0.3, MAT.PLASTER, MAT.CREAM);
  const lp = out(at(le - 0.45), e - 0.3);
  s.pier(lp[0], lp[1], am, 0.22, up.wk + 0.9, up.wk + 1.15, MAT.CREAM, MAT.CREAM);
  lantern(s, haul, lp, am + sg * le / Rf + Math.PI / 2, up.wk + 1.15, 0.8);
}

/** a wall whose foot and top run straight from p to q, its foot from y0 to y1 and h tall above it, `thick` thick
 *  (centred on the line), with a cap */
export function slopedWall(s: Shapes, p: V2, q: V2, y0: number, y1: number, h: number, thick: number, mat: Mat, cap: Mat) {
  const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz);
  if (L < 0.05) return;
  // (R on the right of travel from p to q, Lf on the left)
  const nx = (-dz / L) * thick / 2, nz = (dx / L) * thick / 2;
  const R0: V2 = [p[0] + nx, p[1] + nz], R1: V2 = [q[0] + nx, q[1] + nz], L0: V2 = [p[0] - nx, p[1] - nz], L1: V2 = [q[0] - nx, q[1] - nz];
  const body0 = y0 + h - 0.1, body1 = y1 + h - 0.1;
  s.strip([R0, R1], [y0, y1], [body0, body1], mat, true).strip([R0, R1], [body0, body1], [y0 + h, y1 + h], cap, true);
  s.strip([L0, L1], [y0, y1], [body0, body1], mat, false).strip([L0, L1], [body0, body1], [y0 + h, y1 + h], cap, false);
  s.flat([L0, L1], [R0, R1], [y0 + h, y1 + h], [y0 + h, y1 + h], cap);
  s.strip([L0, R0], y0, y0 + h, cap, true).strip([R1, L1], y1, y1 + h, cap, true);
}

/** the band's walks: along the canal (or, on the top band, from the temple's ring), the outer promenade, the spine
 *  allée either side of the channel, the radial cross-walks (one carrying a runnel), and the walk across the middle of
 *  a deep band */
function walks(s: Shapes, haul: Haul, p: BandPlan) {
  const am = p.wd.am, R = p.R, Rn = p.Rn, wk = p.wk;
  const ia = p.upper ? R + FOOT_ZONE : R, pa = R + INNER_WALK, pb = Rn - PROMENADE;
  s.slab(sector(ia, pa, p.lo, p.hi), wk, MAT.PAVING);
  s.slab(sector(pb, Rn - WALL_IN, p.lo, p.hi), wk, MAT.PAVING);
  const clip = (lim: Lim): Lim => (r) => Math.min(p.hi(r), Math.max(p.lo(r), lim(r)));
  const strip = (a: number, o0: number, o1: number, ra = pa, rb = pb) => {
    const L = clip(rayLim(a, o0)), H = clip(rayLim(a, o1));
    if ((H(ra) - L(ra)) * ra > 0.2 && (H(rb) - L(rb)) * rb > 0.2) s.slab(sector(ra, rb, L, H), wk, MAT.PAVING);
  };
  strip(am, CHANNEL_COPING, ALLEE);
  strip(am, -ALLEE, -CHANNEL_COPING);
  for (const d of p.lines) for (const sg of [1, -1]) {
    const a = am + sg * d;
    if (p.runnel && d === p.lines[0]) {
      strip(a, -CROSS, -0.5);
      strip(a, 0.5, CROSS);
      runnel(s, haul, p, a);
    } else strip(a, -CROSS, CROSS);
  }
  if (pb - pa >= TWO_ROWS) {
    const m = (pa + pb) / 2;
    s.slab(sector(m - 1.1, m + 1.1, p.lo, p.hi), wk, MAT.PAVING);
  }
}

/** a narrow runnel down a cross-walk from the canal to the spout in the wall below */
function runnel(s: Shapes, haul: Haul, p: BandPlan, a: number) {
  const ra = p.R + INNER_WALK, rb = p.Rn - PROMENADE, y = p.f + POOL_FLOOR;
  const L = rayLim(a, -0.5), H = rayLim(a, 0.5);
  s.slab(sector(ra, rb, L, H), y, MAT.POOL);
  s.strip(side(L, ra, rb), y, p.wk, MAT.CREAM, true);
  s.strip(side(H, ra, rb), y, p.wk, MAT.CREAM, false);
  haul.water.push({ kind: 'channel', path: [pt(p.R + FOOT_ZONE - 0.4, a), pt(p.Rn - WALL_IN, a)], level: p.f + WATER, width: 0.6, depth: WATER - POOL_FLOOR });
}

/** the spine: the channel down the middle of the parterres between raised cream copings (culverted under the walks),
 *  fed on the top band by a fountain basin by the temple's ring */
function spine(s: Shapes, haul: Haul, p: BandPlan) {
  const b = s.b, am = p.wd.am, f = p.f;
  const pa = p.R + INNER_WALK, pb = p.Rn - PROMENADE;
  const deep = pb - pa >= TWO_ROWS, m = (pa + pb) / 2;
  const runs: [number, number][] = deep ? [[pa, m - 1.1], [m + 1.1, pb]] : [[pa, pb]];
  for (const [ra, rb] of runs) {
    s.slab(sector(ra, rb, rayLim(am, -CHANNEL), rayLim(am, CHANNEL)), f + POOL_FLOOR, MAT.POOL);
    for (const sg of [1, -1]) {
      const L = rayLim(am, sg > 0 ? CHANNEL : -CHANNEL_COPING), H = rayLim(am, sg > 0 ? CHANNEL_COPING : -CHANNEL);
      b.prism(sector(ra, rb, L, H), f + POOL_FLOOR, f + COPING, MAT.CREAM);
    }
  }
  const start = p.upper ? p.R + FOOT_ZONE - 0.4 : p.R + 3.4 + 2.4;
  haul.water.push({ kind: 'channel', path: [pt(start, am), pt(p.Rn - WALL_IN, am)], level: f + WATER, width: CHANNEL * 2, depth: WATER - POOL_FLOOR });
  if (!p.upper) basin(s, haul, pt(p.R + 3.4, am), f, p.wk, 2.4);
}

/** a round fountain basin on a walk: coping, mosaic, a bowl on a stem */
export function basin(s: Shapes, haul: Haul, c: V2, f: number, wk: number, R: number) {
  const b = s.b, n = 24;
  const ring = (r: number) => Array.from({ length: n }, (_, i) => [c[0] + Math.cos((i / n) * 2 * Math.PI) * r, c[1] + Math.sin((i / n) * 2 * Math.PI) * r] as V2).reverse();
  const o = ring(R), i = ring(R - 0.45);
  s.ring(o, i, wk, f + POOL_FLOOR, wk + 0.45, MAT.CREAM, MAT.CREAM, 0.12);
  s.slab(i, f + POOL_FLOOR, MAT.POOL);
  b.cylinder(c[0], c[1], 0.32, f + POOL_FLOOR, wk + 0.9, 10, MAT.CREAM);
  b.lathe(c[0], wk + 0.9, c[1], [[0.25, 0], [0.9, 0.18], [1.15, 0.42], [1.1, 0.5], [0.8, 0.42], [0, 0.42]], 16, MAT.CREAM);
  b.cylinder(c[0], c[1], 0.12, wk + 1.3, wk + 1.75, 8, MAT.GOLD, { r1: 0.02 });
  haul.water.push({ kind: 'pool', poly: i, level: wk + 0.3, depth: wk + 0.3 - f - POOL_FLOOR });
}

/** a band's parterre cells: between the allée, the cross-walks and the band's edge, outward from the spine either side
 *  (sg), in one row or two on a deep band; each paved (too narrow to plant: under 4 m across at either end) or a bay.
 *  The colliders lay a walk's floor over the paved ones, the beds' over the rest */
export interface Cell { ra: number; rb: number; lo: Lim; hi: Lim; paved: boolean; sg: 1 | -1; j: number; row: number }
export function parterreCells(p: BandPlan): Cell[] {
  const am = p.wd.am, pa = p.R + INNER_WALK, pb = p.Rn - PROMENADE;
  const deep = pb - pa >= TWO_ROWS, m = (pa + pb) / 2;
  const rows: [number, number][] = deep ? [[pa, m - 1.1], [m + 1.1, pb]] : [[pa, pb]];
  const clip = (lim: Lim): Lim => (r) => Math.min(p.hi(r), Math.max(p.lo(r), lim(r)));
  const out: Cell[] = [];
  for (const sg of [1, -1] as const) {
    const bounds: Lim[] = [rayLim(am, sg * ALLEE)];
    for (const d of p.lines) bounds.push(rayLim(am + sg * d, -sg * CROSS), rayLim(am + sg * d, sg * CROSS));
    bounds.push(sg > 0 ? p.hi : p.lo);
    for (let j = 0; j + 1 < bounds.length; j += 2) {
      const A = clip(bounds[j]), B = clip(bounds[j + 1]);
      const lo = sg > 0 ? A : B, hi = sg > 0 ? B : A;
      rows.forEach(([ra, rb], row) => {
        const w0 = (hi(ra) - lo(ra)) * ra, w1 = (hi(rb) - lo(rb)) * rb;
        if (w0 < 0.3 && w1 < 0.3) return;
        out.push({ ra, rb, lo, hi, paved: Math.min(w0, w1) < 4, sg, j, row });
      });
    }
  }
  return out;
}

/** the parterres between the walks (parterreCells): bays, paved where too narrow to plant; pergolas over alternate
 *  bands' second cross-walks */
function parterre(s: Shapes, haul: Haul, p: BandPlan) {
  const am = p.wd.am, pa = p.R + INNER_WALK, pb = p.Rn - PROMENADE;
  const deep = pb - pa >= TWO_ROWS;
  for (const c of parterreCells(p)) {
    if (c.paved) { s.slab(sector(c.ra, c.rb, c.lo, c.hi), p.wk, MAT.PAVING); continue; }
    const kind = p.kinds[deep ? c.row : c.j === 0 ? 0 : 1];
    bay(s, haul, { ra: c.ra, rb: c.rb, lo: c.lo, hi: c.hi, floor: p.f, walk: p.wk, kind, palette: p.palette + c.j, seed: rng(p.wd.i, p.b.k, c.j, c.row, c.sg) });
  }
  for (const sg of [1, -1] as const) {
    if ((p.b.k + p.wd.i) % 2 === 0) pergola(s, haul, p, am + sg * p.lines[1], pa, pb);
  }
}

/** a pergola over a cross-walk: cream posts either side, timber cross-beams and runners, vines planted at the posts */
function pergola(s: Shapes, haul: Haul, p: BandPlan, a: number, ra: number, rb: number) {
  if ((p.hi((ra + rb) / 2) - a) * ra < CROSS + 0.5 || (a - p.lo((ra + rb) / 2)) * ra < CROSS + 0.5) return;
  const b = s.b, y = p.wk, n = Math.max(2, Math.round((rb - ra) / 3.2));
  for (let i = 0; i <= n; i++) {
    const r = ra + 0.5 + ((rb - ra - 1) * i) / n;
    for (const o of [-CROSS + 0.18, CROSS - 0.18]) {
      const q = pt(r, rayLim(a, o)(r));
      b.cylinder(q[0], q[1], 0.15, y, y + 2.75, 8, MAT.CREAM);
    }
    const c = pt(r, a);
    s.obox(c[0], c[1], a + Math.PI / 2, CROSS + 0.35, 0.09, y + 2.75, y + 2.95, MAT.WOOD);
  }
  for (const o of [-CROSS + 0.18, CROSS - 0.18]) {
    const q0 = pt(ra + 0.2, rayLim(a, o)(ra + 0.2)), q1 = pt(rb - 0.2, rayLim(a, o)(rb - 0.2));
    const c: V2 = [(q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2];
    s.obox(c[0], c[1], a, Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) / 2, 0.1, y + 2.95, y + 3.15, MAT.WOOD);
    const strip = sector(ra + 0.3, rb - 0.3, rayLim(a, o - 0.2), rayLim(a, o + 0.2));
    haul.beds.push({ poly: strip, y, kind: 'vines', density: 0.6, palette: 'purple' });
  }
}

/** a band's side walls: where it meets the stair's notch, a cut rock face under a parapet; on the sunken north courts'
 *  open sides, a wall up to the top with a balustrade */
function sides(s: Shapes, p: BandPlan) {
  const wd = p.wd;
  const r0 = p.upper ? p.R + WALL_OUT : p.R, r1 = p.Rn + WALL_OUT;
  for (const [sd, sg] of [[wd.lo, -1], [wd.hi, 1]] as const) {
    const edge = sg > 0 ? p.hiEdge : p.loEdge, inner = sg > 0 ? p.hi : p.lo;
    const path = side(edge, r0, r1, 2);
    const ipath = side(inner, r0, r1, 2);
    if (sd.kind === 'stair') {
      // (beside the processional way, north of the notch, the band is level with it: no cut there)
      const keep = path.map((q) => q[1] > NOTCH_TOP);
      const segs = runsOf(path, keep);
      for (const seg of segs) {
        const fl = seg.map((q) => Math.min(notchFloor(q[1]) - 1, p.f));
        s.strip(seg, fl, p.f + 0.3, MAT.ROCK, sg > 0);
        s.strip(seg, p.f + 0.3, p.wk, MAT.ASHLAR, sg > 0);
        s.strip(seg, p.wk, p.f + PARAPET - 0.12, MAT.PLASTER, sg > 0).strip(seg, p.f + PARAPET - 0.12, p.f + PARAPET, MAT.CREAM, sg > 0);
      }
      for (const seg of runsOf(ipath, keep)) s.strip(seg, p.wk, p.f + PARAPET, MAT.PLASTER, sg < 0);
      for (const [segO, segI] of zipRuns(path, ipath, keep)) s.flat(sg > 0 ? segI : segO, sg > 0 ? segO : segI, p.f + PARAPET, p.f + PARAPET, MAT.CREAM);
    } else if (sd.kind === 'radial') {
      const topY = TOP + WALK + 1.0;
      // (the outer face reaches down to the wall's foot: wherever the land's slope to the court dips outside it)
      s.strip(path, p.f - FOOT, topY - 0.15, MAT.PLASTER, sg > 0).strip(path, topY - 0.15, topY, MAT.CREAM, sg > 0);
      s.strip(ipath, p.wk, topY - 0.15, MAT.PLASTER, sg < 0).strip(ipath, topY - 0.15, topY, MAT.CREAM, sg < 0);
      s.flat(sg > 0 ? ipath : path, sg > 0 ? path : ipath, topY, topY, MAT.CREAM);
      if (p.f < TOP) {
        s.strip(ipath, TOP + WALK - 0.25, TOP + WALK, MAT.CREAM, sg < 0);
        // pilasters and tall blind niches down the face toward the court, as on its end wall
        // (into the court: toward smaller angles from the hi side, larger from the lo side)
        const into = (a: number): V2 => [sg * Math.sin(a), -sg * Math.cos(a)];
        const n = Math.max(2, Math.floor((r1 - r0) / 7));
        for (let i = 0; i <= n; i++) {
          const r = r0 + ((r1 - r0) * i) / n, dir = inner(r), q = pt(r, dir), d = into(dir);
          const c: V2 = [q[0] + d[0] * 0.2, q[1] + d[1] * 0.2];
          if (i > 0 && i < n) s.obox(c[0], c[1], dir, 0.45, 0.2, p.wk, TOP + WALK - 0.3, MAT.CREAM, { skip: ['bottom'] });
          if (i === n || p.wk + 9.5 > TOP + WALK - 1.5) continue;
          const rm = r + (r1 - r0) / n / 2, m = pt(rm, inner(rm)), dm = into(inner(rm));
          s.b.with({ ao: 0.7 }, () => s.obox(m[0] + dm[0] * 0.03, m[1] + dm[1] * 0.03, inner(rm), 1.3, 0.03, p.wk + 1.5, p.wk + 9.5, MAT.PLASTER_WARM, { skip: ['bottom', 'top'] }));
        }
      }
    }
  }
}

/** consecutive runs of a path's points kept by a mask */
function runsOf(path: V2[], keep: boolean[]): V2[][] {
  const out: V2[][] = [];
  let cur: V2[] = [];
  path.forEach((q, i) => { if (keep[i]) cur.push(q); else { if (cur.length > 1) out.push(cur); cur = []; } });
  if (cur.length > 1) out.push(cur);
  return out;
}
function zipRuns(a: V2[], b: V2[], keep: boolean[]): [V2[], V2[]][] {
  const out: [V2[], V2[]][] = [];
  let ca: V2[] = [], cb: V2[] = [];
  a.forEach((q, i) => { if (keep[i]) { ca.push(q); cb.push(b[i]); } else { if (ca.length > 1) out.push([ca, cb]); ca = []; cb = []; } });
  if (ca.length > 1) out.push([ca, cb]);
  return out;
}

/** a flank wedge's end over the cliff: a half-round belvedere out from the outer wall at the spine, the channel running
 *  onto it into a basin whose overflow falls down the cliff, a balustrade round it and lanterns at its corners */
function belvedere(s: Shapes, haul: Haul, p: BandPlan) {
  const b = s.b, am = p.wd.am, R = p.Rn + WALL_OUT, wk = p.wk, f = p.f;
  const c = pt(R, am), rad = 7, n = 20;
  const half: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = am - Math.PI / 2 + (Math.PI * i) / n;
    half.push([c[0] + Math.cos(t) * rad, c[1] + Math.sin(t) * rad]);
  }
  // (the half-disc's outline runs counter-clockwise on the map: round the arc, then back along the wall's face)
  b.prism(half, f - 14, wk - 0.3, MAT.PLASTER, { top: null });
  b.prism(half.map(([x, z]) => [c[0] + (x - c[0]) * 1.04, c[1] + (z - c[1]) * 1.04] as V2), wk - 0.3, wk, MAT.CREAM, { top: MAT.PAVING });
  for (let i = 0; i < n; i++) {
    const t0 = (i + 0.5) / n;
    if (Math.abs(t0 - 0.5) < 0.06) continue;
    s.balustrade(lerp2(c, half[i], 0.95), lerp2(c, half[i + 1], 0.95), wk, MAT.CREAM, MAT.CREAM);
  }
  basin(s, haul, pt(R + 3.4, am), f, wk, 2.2);
  for (const sg of [1, -1]) {
    const q = lerp2(c, half[sg > 0 ? n - 3 : 3], 0.9);
    s.pier(q[0], q[1], am, 0.3, wk, wk + 1.4, MAT.ASHLAR, MAT.CREAM);
    lantern(s, haul, q, am, wk + 1.4);
  }
  // its walking collider: the half-disc in metre rows, the balustrade round it as a ring of small solids
  const F = new Frame(`haven.wedge${p.wd.i}.belvedere`, c[0], c[1], am);
  for (let u = 0; u < rad; u += 1) {
    const w = Math.sqrt(Math.max(0, rad * rad - (u + 1) * (u + 1))) - 0.2;
    if (w > 0.3) F.floor(u - (u === 0 ? 1.4 : 0), -w, u + 1, w, wk);
  }
  for (let k = 0; k <= 30; k++) {
    const t = -Math.PI / 2 + (Math.PI * k) / 30;
    if (Math.abs(t) < 0.2) continue;
    const u = Math.cos(t) * (rad - 0.35), v = Math.sin(t) * (rad - 0.35);
    F.solid(u - 0.4, v - 0.4, u + 0.4, v + 0.4, wk - 1, wk + 1);
  }
  F.solid(rad - 0.2, -0.6, rad + 0.6, 0.6, wk - 1, wk + 0.9);
  haul.colliders.push(F.done());
  // the basin's overflow through the balustrade's gap and down the cliff
  const lip = pt(R + rad + 0.1, am);
  const t = [Math.cos(am + Math.PI / 2) * 0.6, Math.sin(am + Math.PI / 2) * 0.6];
  s.obox(lip[0], lip[1], am, 0.5, 0.65, wk - 0.35, wk - 0.15, MAT.CREAM);
  haul.water.push({ kind: 'cascade', a: [lip[0] - t[0], lip[1] - t[1]], b: [lip[0] + t[0], lip[1] + t[1]], top: wk - 0.15, bottom: f - 30 });
}

const lerp2 = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** a sunken court's far end: the wall rising to the top, with tall niches, and at the spine a nymphaeum: a half-round
 *  basin under a fountain spilling from a niche in the wall */
function courtEnd(s: Shapes, haul: Haul, p: BandPlan) {
  const b = s.b, wd = p.wd, am = wd.am, R = p.Rn, ri = R - WALL_IN, ro = R + WALL_OUT;
  const lo = p.loEdge, hi = p.hiEdge, topY = TOP + WALK + 1.0;
  b.with({ tint: [1.02, 0.98, 0.96] }, () => {
    s.strip(arc(ri, lo(ri), hi(ri)), p.wk, p.wk + 0.5, MAT.CREAM, true);
    s.strip(arc(ri, lo(ri), hi(ri)), p.wk + 0.5, TOP + WALK - 0.3, MAT.PLASTER, true);
    s.strip(arc(ri, lo(ri), hi(ri)), TOP + WALK - 0.3, TOP + WALK, MAT.CREAM, true);
    s.strip(arc(ri, lo(ri), hi(ri)), TOP + WALK, topY - 0.15, MAT.PLASTER, true).strip(arc(ri, lo(ri), hi(ri)), topY - 0.15, topY, MAT.CREAM, true);
    s.strip(arc(ro, lo(ro), hi(ro)), p.f - FOOT, topY - 0.15, MAT.PLASTER, false).strip(arc(ro, lo(ro), hi(ro)), topY - 0.15, topY, MAT.CREAM, false);
    s.flat(arc(ro, lo(R), hi(R)), arc(ri, lo(R), hi(R)), topY, topY, MAT.CREAM);
  });
  // tall blind niches along the wall, pilasters between
  const span = (hi(ri) - lo(ri)) * ri, nN = Math.max(2, Math.floor(span / 7));
  for (let i = 0; i < nN; i++) {
    const a = lo(ri) + ((hi(ri) - lo(ri)) * (i + 0.5)) / nN;
    if (Math.abs(a - am) * ri < 5) continue;
    const c = pt(ri - 0.02, a), tan = a + Math.PI / 2;
    b.with({ ao: 0.7 }, () => s.obox(c[0], c[1], tan, 1.3, 0.03, p.wk + 1.5, p.wk + 9.5, MAT.PLASTER_WARM, { skip: ['bottom', 'top'] }));
    const q = pt(ri - 0.2, lo(ri) + ((hi(ri) - lo(ri)) * i) / nN);
    if (i > 0) s.obox(q[0], q[1], tan, 0.45, 0.2, p.wk, TOP + WALK - 0.3, MAT.CREAM, { skip: ['bottom'] });
  }
  // the nymphaeum
  const c = pt(ri, am), n = 16, rad = 4.2;
  const half: V2[] = [];
  for (let i = 0; i <= n; i++) { const t = am + Math.PI / 2 + (Math.PI * i) / n; half.push([c[0] + Math.cos(t) * rad, c[1] + Math.sin(t) * rad]); }
  const inner = half.map(([x, z]) => [c[0] + (x - c[0]) * 0.9, c[1] + (z - c[1]) * 0.9] as V2);
  // (round the centre with the angle increasing, the outside is on the left of travel)
  s.strip(half, p.wk, p.f + COPING + 0.3, MAT.CREAM, false);
  s.strip(inner, p.f + POOL_FLOOR, p.f + COPING + 0.3, MAT.CREAM, true);
  s.flat(half, inner, p.f + COPING + 0.3, p.f + COPING + 0.3, MAT.CREAM);
  s.slab([...inner].reverse(), p.f + POOL_FLOOR, MAT.POOL);
  haul.water.push({ kind: 'pool', poly: [...inner].reverse(), level: p.f + WATER + 0.2, depth: 0.5 });
  const ni = pt(ri - 0.02, am);
  b.with({ ao: 0.6 }, () => s.obox(ni[0], ni[1], am + Math.PI / 2, 2.4, 0.03, p.wk + 1.2, p.wk + 11, MAT.TEAL, { skip: ['bottom', 'top'] }));
  const sp = pt(ri - 0.5, am);
  s.obox(sp[0], sp[1], am, 0.5, 0.35, p.wk + 6.2, p.wk + 6.5, MAT.GOLD);
  const t = [Math.cos(am + Math.PI / 2) * 0.3, Math.sin(am + Math.PI / 2) * 0.3];
  const e = pt(ri - 1.0, am);
  haul.water.push({ kind: 'cascade', a: [e[0] - t[0], e[1] - t[1]], b: [e[0] + t[0], e[1] + t[1]], top: p.wk + 6.3, bottom: p.f + WATER + 0.2 });
}
