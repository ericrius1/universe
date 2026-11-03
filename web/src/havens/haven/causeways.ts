// The causeways down the spokes (ref 3's blade-like ramps; the compass rose's gold rays): from the temple's ring to the
// ring road, each a terracotta blade whose top is the walk, between parapets whose copings are gold. Each runs between a
// flank wedge and a top wedge: it descends as a cordonata (long treads, low risers) level with the flank wedge's outer
// promenades where it passes them (breaks in the parapet open onto them), runs level past that wedge's end, and a last
// flight takes it down to the ring road at its port. Beside the top wedge's sunken courts it stands over them; beyond
// them the plateau's slab stands over it, and that side is a cutting: a wall from the walk up past the slab's edge,
// gold-coped too (the slab's kerb along its top is the terraces'). The blade's sides go down below the floor beside
// them, so the land's carve meets them whichever wedge it follows. Everything inside the causeway's claim (CAUSEWAY_H
// either side of the spoke); the lamp posts and finials the parts library's, placed instanced.
import { MAT } from '../arch/types';
import type { V2 } from '../world/layout';
import { Frame, type Haul } from './colliders';
import {
  C, CAUSEWAY_H, FOOT, GAPS, GARDENS, KEEP_TOP, R_FOOT, R_INNER, RAMP_MEET, SKIN, TOP, WALK, WALL_OUT, bandAt, cutSide,
  lastFlight, rampDeck, rampGuide, type Gap, type Wedge,
} from './plan';
import type { Shapes } from './shapes';

const DECK = GARDENS.rampWidth / 2;
const RAIL = 1.0;
/** a coping's depth */
const CAP = 0.14;

export function buildCauseways(s: Shapes, haul: Haul) {
  for (const g of GAPS) if (g.kind === 'ramp') causeway(s, haul, g);
}

/** what one side of a causeway is at radius r: over the ground beside it (a parapet on the blade), or a cutting into
 *  the slab beside it (a wall up to `top`) */
interface SideAt { cut: boolean; top: number; bottom: number }

function causeway(s: Shapes, haul: Haul, g: Gap) {
  const b = s.b, a = g.a, ca = Math.cos(a), sa = Math.sin(a);
  const guide = rampGuide(g), f = lastFlight(g);
  const r0 = g.lo.w.r0, rB = f.r0;
  const at = (r: number, o: number): V2 => [C[0] + ca * r - sa * o, C[1] + sa * r + ca * o];
  const deck = (r: number) => rampDeck(g, r);
  const wedge = (sg: number) => (sg < 0 ? g.lo : g.hi);
  /** the floor beside a side at radius r: its band's, the town's past a flank wedge's end, the slab's or the skin's past
   *  a top wedge's courts */
  const besideFloor = (w: Wedge, r: number) => {
    const bd = bandAt(w, Math.min(r, w.w.r1 - 0.01));
    if (r < w.w.r1 + WALL_OUT) return bd?.floor ?? TOP;
    if (w.kind === 'flank') return 0;
    return r < SKIN.upper ? TOP : r < SKIN.lower ? SKIN.ledge : 0;
  };
  const side = (sg: number, r: number): SideAt => {
    const w = wedge(sg), cut = cutSide(g, r) === sg;
    const floor = besideFloor(w, r);
    // (inside the inner ring everything stands on the rock kept over the caverns)
    const bottom = Math.max(Math.min(floor, deck(r) - WALK) - FOOT, r < R_INNER + 1 ? KEEP_TOP + 0.1 : -2.9);
    const top = cut ? (r < SKIN.upper ? TOP + WALK + RAIL : SKIN.ledge + RAIL) : deck(r) + RAIL;
    return { cut, top, bottom };
  };
  // stations along the causeway: every 2 m, and at every band boundary either side (the blade's foot steps there), where
  // the cutting starts and steps down at the skin, and on down the last flight
  const st = new Set<number>([r0, rB, f.r1, f.r1 + 0.8, R_FOOT]);
  for (let r = r0; r < R_FOOT; r += 2) st.add(r);
  for (const w of [g.lo, g.hi]) for (const bd of w.bands) { st.add(bd.r0); st.add(bd.r1 - 0.001); st.add(bd.r1 + 0.001); }
  for (const w of [g.lo, g.hi]) { st.add(w.w.r1 + WALL_OUT - 0.001); st.add(w.w.r1 + WALL_OUT + 0.001); }
  for (const r of [SKIN.upper, SKIN.lower]) { st.add(r - 0.001); st.add(r + 0.001); }
  const rs = [...st].filter((r) => r >= r0 && r <= R_FOOT).sort((p, q) => p - q);
  // the breaks in the flank side's parapet: where the walk is level with a terrace's promenade beside it
  const gs = guide === g.lo ? -1 : 1;
  const breaks = guide.bands.slice(1, -1).map((bd) => bd.r1 - RAMP_MEET);
  // (beside the top band of either wedge the causeway is level with it: no parapet there at all; past the flank's last
  // promenade the walk runs on level with it to its outer wall)
  const level = (sg: number, r: number) => {
    const w = wedge(sg);
    return (r < w.bands[1].r0 - 1.6 && Math.abs((bandAt(w, r)?.walk ?? -99) - deck(r)) < 0.05)
      || (sg === gs && r > guide.bands[guide.bands.length - 1].r1 - RAMP_MEET - 1.2 && r < guide.w.r1 - 0.2);
  };
  const broken = (sg: number, r: number) => !side(sg, r).cut && (level(sg, r) || (sg === gs && breaks.some((q) => Math.abs(q - r) < 1.2)));

  b.with({ tint: [1.03, 0.98, 0.95] }, () => {
    for (const sg of [-1, 1]) {
      const o = sg * CAUSEWAY_H, oi = sg * DECK;
      // (the hi side's outer face looks toward larger angles: right of outward travel)
      const right = sg > 0;
      // the blade's side below the walk where the ground beside is lower: terracotta to a cream string course
      for (const run of runs(rs, (r) => !side(sg, r).cut && r <= f.r1 + 0.8)) {
        const path = run.map((r) => at(r, o));
        s.strip(path, run.map((r) => side(sg, r).bottom), run.map((r) => deck(r) - 0.35), MAT.PLASTER, right);
        s.strip(path, run.map((r) => deck(r) - 0.35), run.map((r) => deck(r) - 0.05), MAT.CREAM, right);
      }
      // the parapets, in runs between their breaks, and the cutting's walls: plaster faces, a gold coping
      for (const run of runs(rs, (r) => !broken(sg, r) && r <= f.r1 + 0.8)) {
        const pO = run.map((r) => at(r, o)), pI = run.map((r) => at(r, oi));
        const top = run.map((r) => side(sg, r).top), cut = run.map((r) => side(sg, r).cut);
        // (the outer face: from the string course on the blade, from just under the slab's kerb in the cutting)
        const outFoot = run.map((r, k) => (cut[k] ? (r < SKIN.upper ? TOP - 0.3 : SKIN.ledge - 0.3) : deck(r) - 0.05));
        s.strip(pO, outFoot, top.map((y) => y - CAP), MAT.PLASTER, right).strip(pO, top.map((y) => y - CAP), top, MAT.GOLD, right);
        // (the inner face: in a cutting the rock it's cut through up to the slab's level, the parapet over it plaster)
        const rockTop = run.map((r, k) => (cut[k] ? Math.max(deck(r), Math.min(top[k] - CAP, (r < SKIN.upper ? TOP : SKIN.ledge) - 0.3)) : deck(r)));
        s.strip(pI, run.map((r) => deck(r)), rockTop, MAT.ROCK, !right).strip(pI, rockTop, top.map((y) => y - CAP), MAT.PLASTER, !right).strip(pI, top.map((y) => y - CAP), top, MAT.GOLD, !right);
        s.flat(sg > 0 ? pI : pO, sg > 0 ? pO : pI, top, top, MAT.GOLD);
        // the run's ends (and where the cutting's wall steps down at the skin and where it rises from the parapet)
        for (const [r, end] of [[run[0], 0], [run[run.length - 1], 1]] as [number, number][]) {
          if (r <= r0 + 0.01 || r >= R_FOOT - 0.01) continue;
          const p = at(r, o), q = at(r, oi), sd = side(sg, r);
          s.strip(end === 0 === sg > 0 ? [q, p] : [p, q], deck(r), sd.top, MAT.PLASTER, true);
        }
        for (let k = 1; k < run.length; k++) {
          const y0 = top[k - 1], y1 = top[k];
          if (Math.abs(y1 - y0) < 0.5) continue;
          // (a step in the top between two stations a millimetre apart: its riser faces the lower side)
          const r = run[k], p = at(r, o), q = at(r, oi), outward = y1 < y0;
          s.strip(outward === sg > 0 ? [q, p] : [p, q], Math.min(y0, y1), Math.max(y0, y1), MAT.PLASTER, true);
        }
      }
      // where the parapet breaks, the walk runs on to the terrace beside it
      for (const run of runs(rs, (r) => broken(sg, r) && r < rB)) {
        const pO = run.map((r) => at(r, o)), pI = run.map((r) => at(r, oi));
        s.flat(sg > 0 ? pI : pO, sg > 0 ? pO : pI, run.map(deck), run.map(deck), MAT.PAVING);
      }
    }
  });
  // the walk: a cordonata of long treads and low risers where it descends, plain paving where level; the last flight;
  // the foot's landing out to the ring road
  const treads = walk(s, rs.filter((r) => r <= rB), at, deck);
  const [fx0, fz0] = at(f.r1, 0), [fx1, fz1] = at(rB, 0);
  b.with({ tint: [1.03, 0.98, 0.95] }, () => b.stairs(fx0, f.y, fz0, fx1, f.top, fz1, 2 * DECK, f.n, MAT.ASHLAR, { side: MAT.CREAM, foot: f.y - 0.6, riser: MAT.CREAM }));
  // (out to the ring's outline: a vertex on the spoke, chords to the next 9° round either side)
  const edge = (o: number) => R_FOOT - Math.abs(o) * Math.tan((4.5 * Math.PI) / 180);
  s.slab([at(f.r1, -DECK), at(edge(-DECK), -DECK), at(R_FOOT, 0), at(edge(DECK), DECK), at(f.r1, DECK)], f.y, MAT.PAVING);
  // piers on the parapets every 12 m with gold finials, and lamp posts on the walk beside every other pair
  let k = 0;
  for (let r = r0 + 6; r < f.r1 - 2; r += 12) {
    for (const sg of [-1, 1]) {
      if (broken(sg, r) || broken(sg, r - 1.2) || broken(sg, r + 1.2) || side(sg, r - 0.5).cut !== side(sg, r + 0.5).cut) continue;
      // (its cap's outer face on the parapet's: inside the causeway's claim)
      const c = at(r, sg * (CAUSEWAY_H - 0.5)), sd = side(sg, r), y = sd.top;
      s.pier(c[0], c[1], a, 0.42, y - CAP - 0.02, y + 0.45, MAT.ASHLAR, MAT.GOLD);
      b.place(sd.cut ? 'finial-lotus' : 'finial-spire', [c[0], y + 0.45, c[1]], { scale: 1.1 });
      if ((k + (sg > 0 ? 1 : 0)) % 2 === 0) {
        const q = at(r + 1.0, sg * (DECK - 0.4));
        b.place('lantern-post', [q[0], treadAt(treads, r + 1.0, deck), q[1]], { yaw: -a });
      }
    }
    k++;
  }
  // the newels at the last flight's foot, each with a lamp post beside it on the landing
  for (const sg of [-1, 1]) {
    const c = at(f.r1 + 0.35, sg * (CAUSEWAY_H - 0.5));
    s.pier(c[0], c[1], a, 0.42, f.y, f.y + RAIL + 0.6, MAT.ASHLAR, MAT.GOLD);
    b.place('finial-spire', [c[0], f.y + RAIL + 0.6, c[1]], { scale: 1.2 });
    const q = at(f.r1 + 0.9, sg * (DECK - 0.4));
    b.place('lantern-post', [q[0], f.y, q[1]], { yaw: -a, scale: 1.1 });
  }
  colliders(haul, g, rs, deck, side, broken);
}

/** a stretch of the walk: from r0 to r1 at y0 to y1 (a tread falls a little along itself) */
interface Tread { r0: number; r1: number; y0: number; y1: number }

/** the walk's surface: treads with risers down the slope; its treads handed back (where a lamp stands) */
function walk(s: Shapes, rs: number[], at: (r: number, o: number) => V2, deck: (r: number) => number): Tread[] {
  const r0 = rs[0], r1 = rs[rs.length - 1], out: Tread[] = [];
  let r = r0;
  while (r < r1 - 1e-6) {
    const y = deck(r);
    // a level stretch runs to where the walk starts to fall; a sloped one in treads of ~0.15 m drop
    let next = r + 2;
    if (Math.abs(deck(Math.min(r1, r + 2)) - y) < 1e-4) {
      next = r;
      while (next < r1 && Math.abs(deck(Math.min(r1, next + 1)) - y) < 1e-4) next = Math.min(r1, next + 1);
      if (next <= r) next = Math.min(r1, r + 1);
      s.flat([at(r, -DECK), at(next, -DECK)], [at(r, DECK), at(next, DECK)], [y, y], [y, y], MAT.PAVING);
      out.push({ r0: r, r1: next, y0: y, y1: y });
      // (flat() pairs left/right along travel: outward travel has larger angles (+o) on its right)
    } else {
      let t = r;
      while (t < r1 && y - deck(t) < 0.15) t = Math.min(r1, t + 0.05);
      next = t;
      const yt = deck(next);
      // the tread falls gently to the riser's top, the riser drops the rest
      s.flat([at(r, -DECK), at(next, -DECK)], [at(r, DECK), at(next, DECK)], [y, y - 0.03], [y, y - 0.03], MAT.ASHLAR);
      s.strip([at(next, -DECK), at(next, DECK)], yt, y - 0.03, MAT.CREAM, true);
      out.push({ r0: r, r1: next, y0: y, y1: y - 0.03 });
    }
    r = next;
  }
  return out;
}

/** the walk's height at r: on its tread there, or the deck's line past them */
function treadAt(treads: Tread[], r: number, deck: (r: number) => number): number {
  for (const t of treads) if (r >= t.r0 && r <= t.r1) return t.y0 + ((r - t.r0) / Math.max(1e-6, t.r1 - t.r0)) * (t.y1 - t.y0);
  return deck(r);
}

/** consecutive stations kept by a test, as runs */
function runs(rs: number[], keep: (r: number) => boolean): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  for (const r of rs) { if (keep(r)) cur.push(r); else { if (cur.length > 1) out.push(cur); cur = []; } }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** the causeway's walking collider, a frame along it: the walk (a level floor, then a ramp for the descent, level again,
 *  the last flight, the foot), the parapets and the cutting's walls as solids in runs between their breaks (whose gaps
 *  are floors onto the terraces) */
function colliders(haul: Haul, g: Gap, rs: number[], deck: (r: number) => number, side: (sg: number, r: number) => SideAt, broken: (sg: number, r: number) => boolean) {
  const F = new Frame(`haven.causeway${Math.round((g.a * 180) / Math.PI)}`, C[0], C[1], g.a);
  const f = lastFlight(g), r0 = rs[0];
  // the level start, the descent, the level stretch past the flank wedge's end
  let ra = r0;
  while (ra < f.r0 && Math.abs(deck(ra + 0.5) - deck(r0)) < 1e-4) ra += 0.5;
  let rb = f.r0;
  while (rb > ra && Math.abs(deck(rb - 0.5) - deck(f.r0)) < 1e-4) rb -= 0.5;
  F.floor(r0 - 0.5, -DECK, ra, DECK, deck(r0));
  if (rb > ra + 0.5) F.stair(ra, -DECK, rb, DECK, deck(rb), deck(ra) - deck(rb), 0, -1);
  F.floor(rb, -DECK, f.r0, DECK, deck(f.r0));
  F.stair(f.r0, -DECK, f.r1, DECK, f.y, f.top - f.y, 0, -1);
  F.floor(f.r1, -DECK, R_FOOT, DECK, f.y);
  for (const sg of [-1, 1]) {
    const y0 = sg < 0 ? -CAUSEWAY_H : DECK - 0.05, y1 = sg < 0 ? -DECK + 0.05 : CAUSEWAY_H;
    for (let r = r0; r < f.r1; r += 4) {
      const r1 = Math.min(f.r1, r + 4), sd = side(sg, (r + r1) / 2);
      if (broken(sg, (r + r1) / 2)) { F.floor(r, y0, r1, y1, deck((r + r1) / 2)); continue; }
      F.solid(r, y0, r1, y1, Math.min(side(sg, r).bottom, side(sg, r1).bottom), sd.cut ? sd.top : Math.max(deck(r), deck(r1)) + RAIL);
    }
  }
  haul.colliders.push(F.done());
}
