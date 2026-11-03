// The terraces' walking colliders. A wedge is cut into radial strips a few degrees wide, each a frame whose plan x runs
// out from the temple's centre: in a strip the arcs are straight enough to be boxes. Per band, a strip carries the
// floors of its zones (canal or walk at the wall's foot, the inner walk, the beds with the allée's and cross-walks'
// paths over them, the promenade), the raised planters as solids, and the retaining wall as a solid whose parapet
// breaks at the openings (thresholds there are floors). Boxes are trimmed to the band's reach, so no floor hangs over
// a causeway's flank or the notch. Each flight gets its own frame (the flight a stair, its landing a floor reaching
// through the parapet's break, its open side a solid), and the cut faces along the notch and the courts' high side
// walls get frames along them.
import type { V2 } from '../world/layout';
import { Frame, type Haul } from './colliders';
import { BED, C, DEG, FOOT, PARAPET, POOL_FLOOR, TOP, WALK, WALL_IN, WALL_OUT, notchFloor, NOTCH_TOP } from './plan';
import { pt, rayLim, side, type Lim } from './shapes';
import { ALLEE, CHANNEL, CROSS, FOOT_ZONE, INNER_WALK, PROMENADE, STAIR_W, TWO_ROWS, parterreCells, type BandPlan, type WallStair } from './terraces';

export function terraceColliders(haul: Haul, plans: BandPlan[]) {
  const wd = plans[0].wd;
  let a0 = Infinity, a1 = -Infinity;
  for (const p of plans) for (let t = 0; t <= 1; t += 0.25) {
    const r = p.R + (p.Rn - p.R) * t;
    a0 = Math.min(a0, p.loEdge(r));
    a1 = Math.max(a1, p.hiEdge(r));
  }
  const n = Math.ceil((a1 - a0) / (4 * DEG));
  for (let i = 0; i < n; i++) {
    const s0 = a0 + ((a1 - a0) * i) / n, s1 = a0 + ((a1 - a0) * (i + 1)) / n;
    const F = new Frame(`haven.wedge${wd.i}.strip${i}`, C[0], C[1], (s0 + s1) / 2);
    for (const p of plans) strip(F, p, s0, s1);
    if (!F.empty) haul.colliders.push(F.done());
  }
  for (const p of plans) for (const st of p.stairs) flight(haul, p, st);
  sideWalls(haul, plans);
}

/** one band's boxes in one strip [s0, s1] */
function strip(F: Frame, p: BandPlan, s0: number, s1: number) {
  const sm = (s0 + s1) / 2, am = p.wd.am;
  const y = (r: number, a: number) => r * Math.sin(a - sm);
  /** the strip's lateral range over [ra, rb] inside limits lo..hi: overlapping its neighbours, trimmed to the reach
   *  (at its narrowest over a deep zone; at its middle over a narrow walk, so no sliver by a wall drops a walker off
   *  the walk's level) */
  const span = (ra: number, rb: number, lo: Lim, hi: Lim): [number, number] => {
    let y0 = y(rb, s0) - 0.4, y1 = y(rb, s1) + 0.4;
    const ts = rb - ra > 6 ? [0, 0.25, 0.5, 0.75, 1] : [0.5];
    for (const t of ts) {
      const r = ra + (rb - ra) * t;
      y0 = Math.max(y0, y(r, lo(r)));
      y1 = Math.min(y1, y(r, hi(r)));
    }
    return [y0, y1];
  };
  /** a lateral feature's range at the strip's middle radius, within [y0, y1] */
  const cut = (r: number, a: number, o0: number, o1: number, y0: number, y1: number): [number, number] | null => {
    const u0 = Math.max(y0, y(r, rayLim(a, o0)(r))), u1 = Math.min(y1, y(r, rayLim(a, o1)(r)));
    return u1 - u0 > 0.05 ? [u0, u1] : null;
  };
  const R = p.R, Rn = p.Rn, f = p.f, wk = p.wk;
  // the wall at the band's inner radius, and what it holds
  const up = p.upper;
  if (up) {
    const [w0, w1] = span(R - WALL_IN, R + WALL_OUT, p.loEdge, p.hiEdge);
    if (w1 > w0) {
      F.solid(R - WALL_IN, w0, R + WALL_OUT, w1, f - FOOT, up.wk);
      // the parapet, broken at the openings (the spout at the spine, the runnels' spouts, the landings)
      const opens: [number, number, boolean][] = [[y(R, am) - 0.8, y(R, am) + 0.8, false]];
      if (up.runnel) for (const sg of [1, -1]) { const c = y(R, am + sg * up.lines[0]); opens.push([c - 0.5, c + 0.5, false]); }
      for (const st of p.stairs) { const c = y(R, am + st.sigma * st.d); opens.push([c - STAIR_W / 2, c + STAIR_W / 2, true]); }
      opens.sort((q, r2) => q[0] - r2[0]);
      let at = w0;
      for (const [o0, o1, walk] of opens) {
        if (o1 < w0 || o0 > w1) continue;
        if (o0 > at) F.solid(R - WALL_IN, at, R + WALL_OUT, o0, up.wk, up.f + PARAPET);
        if (walk) F.floor(R - WALL_IN - 0.3, Math.max(o0, w0), R + WALL_OUT + 0.3, Math.min(o1, w1), up.wk);
        at = Math.max(at, o1);
      }
      if (w1 > at) F.solid(R - WALL_IN, at, R + WALL_OUT, w1, up.wk, up.f + PARAPET);
    }
    // the canal's floor, the walk round it, the raised planters
    const za = R + WALL_OUT, zb = R + FOOT_ZONE;
    const [f0, f1] = span(za, zb, p.lo, p.hi);
    if (f1 > f0) {
      const zc = R + WALL_OUT + 1.8;
      const canal = p.canal > 0 ? cut(zc, am, -p.canal * zc, p.canal * zc, f0, f1) : null;
      if (canal) {
        F.floor(za, canal[0], zb - 0.4, canal[1], f + POOL_FLOOR);
        F.floor(za, f0, zb, canal[0], wk).floor(za, canal[1], zb, f1, wk).floor(zb - 0.4, canal[0], zb, canal[1], wk);
      } else F.floor(za, f0, zb, f1, wk);
      const Rf = R + WALL_OUT + STAIR_W / 2;
      for (const sg of [1, -1] as const) {
        const st = p.stairs.find((q) => q.sigma === sg);
        const from = st ? st.d * Rf + STAIR_W / 2 : p.canal * zc + 1.2;
        const a = am + (sg * from) / Rf;
        const edge = sg > 0 ? p.hi(Rf) : p.lo(Rf);
        if ((edge - a) * sg <= 0) continue;
        const u0 = Math.max(f0, y(Rf, Math.min(a, edge))), u1 = Math.min(f1, y(Rf, Math.max(a, edge)));
        if (u1 > u0) F.solid(za, u0, R + 2.6, u1, f - 0.5, f + 1.3);
      }
    }
  }
  // the inner walk, the parterres, the promenade
  const ia = up ? R + FOOT_ZONE : R, pa = R + INNER_WALK, pb = Rn - PROMENADE;
  const [i0, i1] = span(ia, pa, p.lo, p.hi);
  F.floor(ia, i0, pa, i1, wk);
  const [b0, b1] = span(pa, pb, p.lo, p.hi);
  // (the beds' floor in radial chunks, each trimmed to the reach over its own few metres, so no wide sliver is left
  // by a side wall where the reach swings round a corner of the notch)
  const nC = Math.max(1, Math.ceil((pb - pa) / 3));
  for (let i = 0; i < nC; i++) {
    const ca = pa + ((pb - pa) * i) / nC, cb = pa + ((pb - pa) * (i + 1)) / nC;
    const [c0, c1] = span(ca, cb, p.lo, p.hi);
    F.floor(ca, c0, cb, c1, f + BED);
  }
  if (b1 > b0) {
    const rm = (pa + pb) / 2;
    for (const [o0, o1] of [[CHANNEL, ALLEE], [-ALLEE, -CHANNEL]]) { const c = cut(rm, am, o0, o1, b0, b1); if (c) F.floor(pa, c[0], pb, c[1], wk); }
    for (const d of p.lines) for (const sg of [1, -1]) {
      const a = am + sg * d;
      const parts = p.runnel && d === p.lines[0] ? [[-CROSS, -0.5], [0.5, CROSS]] : [[-CROSS, CROSS]];
      for (const [o0, o1] of parts) { const c = cut(rm, a, o0, o1, b0, b1); if (c) F.floor(pa, c[0], pb, c[1], wk); }
    }
    if (pb - pa >= TWO_ROWS) F.floor(rm - 1.1, b0, rm + 1.1, b1, wk);
  }
  // (the cells too narrow to plant are paved at the walk's level: in radial chunks as the beds are, each trimmed to the
  // cell over its own few metres)
  for (const c of parterreCells(p)) {
    if (!c.paved) continue;
    const m = Math.max(1, Math.ceil((c.rb - c.ra) / 3));
    for (let i = 0; i < m; i++) {
      const ca = c.ra + ((c.rb - c.ra) * i) / m, cb = c.ra + ((c.rb - c.ra) * (i + 1)) / m;
      const [u0, u1] = span(ca, cb, c.lo, c.hi);
      if (u1 > u0) F.floor(ca, u0, cb, u1, wk);
    }
  }
  const [q0, q1] = span(pb, Rn - WALL_IN, p.lo, p.hi);
  F.floor(pb, q0, Rn - WALL_IN, q1, wk);
  // the outer wall: over the cliff on a flank wedge (a way through at the spine onto the belvedere), up to the top
  // round a sunken court
  if (p.last) {
    const [w0, w1] = span(Rn - WALL_IN, Rn + WALL_OUT, p.loEdge, p.hiEdge);
    if (w1 > w0) {
      if (p.wd.kind === 'flank') {
        const c = y(Rn, am);
        F.solid(Rn - WALL_IN, w0, Rn + WALL_OUT, w1, f - 14, wk);
        if (c - 3 > w0) F.solid(Rn - WALL_IN, w0, Rn + WALL_OUT, Math.min(w1, c - 3), wk, f + PARAPET);
        if (c + 3 < w1) F.solid(Rn - WALL_IN, Math.max(w0, c + 3), Rn + WALL_OUT, w1, wk, f + PARAPET);
        if (c + 3 > w0 && c - 3 < w1) F.floor(Rn - WALL_IN - 0.3, Math.max(w0, c - 3), Rn + WALL_OUT + 0.3, Math.min(w1, c + 3), wk);
      } else F.solid(Rn - WALL_IN, w0, Rn + WALL_OUT, w1, f - FOOT, TOP + WALK + 1);
    }
  }
}

/** a flight hung on a wall: the stair, its landing (reaching back through the parapet's break), its parapets */
function flight(haul: Haul, p: BandPlan, st: WallStair) {
  const up = p.upper!, am = p.wd.am, sg = st.sigma;
  const Rf = p.R + WALL_OUT + STAIR_W / 2;
  const at = (m: number) => pt(Rf, am + (sg * m) / Rf);
  const ft = st.d * Rf - STAIR_W / 2, fb = ft - st.run;
  const B = at(fb), T = at(ft);
  const F = new Frame(`haven.wedge${p.wd.i}.band${p.b.k}.flight${sg > 0 ? 'L' : 'R'}`, B[0], B[1], Math.atan2(T[1] - B[1], T[0] - B[0]));
  const run = Math.hypot(T[0] - B[0], T[1] - B[1]);
  const h = STAIR_W / 2;
  // (which side of the flight the wall is on, in its plan)
  const wallSide = Math.sign(F.plan(C[0], C[1])[1]);
  F.stair(0, -h, run, h, p.wk, up.wk - p.wk, 0, 1);
  // (the landing's floor reaches 1.8 m back through the parapet's break on the wall's side)
  const ly0 = wallSide > 0 ? -h : -h - 1.8, ly1 = wallSide > 0 ? h + 1.8 : h;
  F.floor(run - 0.1, ly0, run + STAIR_W + 0.1, ly1, up.wk);
  // the parapets: along the open side of the flight and the landing, and across the landing's far end
  const py = -wallSide * (h - 0.15);
  F.solid(0.6, py - 0.15, run + STAIR_W, py + 0.15, p.wk - 0.3, up.wk + 0.95);
  F.solid(run + STAIR_W - 0.3, -h, run + STAIR_W, h, up.wk - 0.3, up.wk + 0.95);
  haul.colliders.push(F.done());
}

/** frames along the cut faces at the notch (each straight run of a band's edge) and along the courts' high sides */
function sideWalls(haul: Haul, plans: BandPlan[]) {
  const wd = plans[0].wd;
  for (const [sd, sg] of [[wd.lo, -1], [wd.hi, 1]] as const) {
    if (sd.kind !== 'stair' && sd.kind !== 'radial') continue;
    for (const p of plans) {
      const edge = sg > 0 ? p.hiEdge : p.loEdge;
      const r0 = p.upper ? p.R + WALL_OUT : p.R, r1 = p.Rn + WALL_OUT;
      const path = side(edge, r0, r1, 2).filter((q) => sd.kind !== 'stair' || q[1] > NOTCH_TOP);
      for (const run of straightRuns(path)) {
        const a = run[0], b = run[run.length - 1];
        const F = new Frame(`haven.wedge${wd.i}.band${p.b.k}.side${sg > 0 ? 'H' : 'L'}${haul.colliders.length}`, a[0], a[1], Math.atan2(b[1] - a[1], b[0] - a[0]));
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        // (the band lies on the side of the run away from the cut; its parapet is the last 0.6 m, the side wall 1.2)
        const inward = Math.sign(F.plan(...mid(p))[1]) || 1;
        const t = sd.kind === 'stair' ? 0.6 : 1.2;
        const y0 = inward > 0 ? 0 : -t, y1 = inward > 0 ? t : 0;
        const low = sd.kind === 'stair' ? Math.min(...run.map((q) => notchFloor(q[1]))) - 1 : p.f - FOOT;
        const top = sd.kind === 'stair' ? p.f + PARAPET : TOP + WALK + 1;
        F.solid(-0.3, y0, len + 0.3, y1, low, top);
        haul.colliders.push(F.done());
      }
    }
  }
}

/** a point in the middle of a band */
function mid(p: BandPlan): [number, number] {
  const r = (p.R + p.Rn) / 2;
  return pt(r, (p.lo(r) + p.hi(r)) / 2);
}

/** a path split where it turns (a corner of the notch's edge) into straight runs */
function straightRuns(path: V2[]): V2[][] {
  if (path.length < 2) return [];
  const out: V2[][] = [];
  let cur: V2[] = [path[0], path[1]];
  const dir = (a: V2, b: V2) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  for (let i = 2; i < path.length; i++) {
    const d0 = dir(cur[0], cur[1]), d1 = dir(path[i - 1], path[i]);
    if (Math.abs(Math.atan2(Math.sin(d1 - d0), Math.cos(d1 - d0))) > 4 * DEG) { out.push(cur); cur = [path[i - 1]]; }
    cur.push(path[i]);
  }
  out.push(cur);
  return out;
}
