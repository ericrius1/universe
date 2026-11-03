// The causeways between the garden wedges (ref 3's blade-like ramps): raised walkways from the temple's ring out to the
// mesa's edge, each a terracotta blade whose top is the walk, with cream-capped parapets, piers carrying gold finials
// and lanterns, and a belvedere with a little cupola at its end. Between two flank wedges the walk descends as a
// cordonata (long treads, low risers), level with the upper wedge's promenades where it passes them (breaks in the
// parapet open onto them); beside the sunken north courts it stays level with the top. The blade's sides go down to the
// lower terrace floor beside them, so the land's carve meets them whichever wedge it follows.
import { MAT } from '../arch/types';
import type { V2 } from '../world/layout';
import { Frame, type Haul } from './colliders';
import {
  C, CAUSEWAY_H, FOOT, GAPS, GARDENS, RAMP_MEET, TOP, WALK, bandAt, causewayEnd, rampDeck, rampUpper, type Gap, type Wedge,
} from './plan';
import type { Shapes } from './shapes';
import { lantern } from './terraces';

const DECK = GARDENS.rampWidth / 2;
const RAIL = 1.0;

export function buildCauseways(s: Shapes, haul: Haul) {
  for (const g of GAPS) if (g.kind === 'ramp' || g.kind === 'promenade') causeway(s, haul, g);
}

function causeway(s: Shapes, haul: Haul, g: Gap) {
  const b = s.b, a = g.a, ca = Math.cos(a), sa = Math.sin(a);
  const r0 = g.lo.w.r0, rEnd = causewayEnd(g), rB = rEnd - 7;
  const at = (r: number, o: number): V2 => [C[0] + ca * r - sa * o, C[1] + sa * r + ca * o];
  const deck = (r: number) => (g.kind === 'ramp' ? rampDeck(g, Math.min(r, rB)) : TOP + WALK);
  const floorOf = (w: Wedge, r: number) => bandAt(w, Math.min(r, w.w.r1 - 0.01))?.floor ?? TOP;
  // (lo is the side toward smaller angles: offset -; hi toward larger: offset +)
  const bottom = (sg: number, r: number) => (r > (sg < 0 ? g.lo : g.hi).w.r1 ? TOP : floorOf(sg < 0 ? g.lo : g.hi, r)) - FOOT;
  // stations along the causeway: every 2 m, and at every band boundary either side (the blade's foot steps there)
  const st = new Set<number>();
  for (let r = r0; r < rB; r += 2) st.add(r);
  for (const w of [g.lo, g.hi]) for (const bd of w.bands) { st.add(bd.r0); st.add(bd.r1 - 0.001); st.add(bd.r1 + 0.001); }
  st.add(rB);
  const rs = [...st].filter((r) => r >= r0 && r <= rB).sort((p, q) => p - q);
  // the breaks in the parapets: where the walk is level with a terrace's promenade beside it
  const breaks: { sg: number; r: number }[] = [];
  if (g.kind === 'ramp') {
    const u = rampUpper(g), sg = u === g.lo ? -1 : 1;
    for (let k = 1; k < u.bands.length - 1; k++) breaks.push({ sg, r: u.bands[k].r1 - RAMP_MEET });
  }
  // (beside the top band of either wedge the causeway is level with it: no parapet there at all)
  const level = (sg: number, r: number) => { const w = sg < 0 ? g.lo : g.hi; return r < w.bands[1].r0 - 1.6 && Math.abs(floorOf(w, r) + WALK - deck(r)) < 0.05; };
  const broken = (sg: number, r: number) => level(sg, r) || breaks.some((q) => q.sg === sg && Math.abs(q.r - r) < 1.2);

  b.with({ tint: [1.03, 0.98, 0.95] }, () => {
    // the blade's sides: terracotta from the foot to a cream string course under the walk, then the parapet's face
    for (const sg of [-1, 1]) {
      const o = sg * CAUSEWAY_H;
      const path = rs.map((r) => at(r, o));
      // (the hi side's face looks toward larger angles: right of outward travel)
      const right = sg > 0;
      s.strip(path, rs.map((r) => bottom(sg, r)), rs.map((r) => deck(r) - 0.35), MAT.PLASTER, right);
      s.strip(path, rs.map((r) => deck(r) - 0.35), rs.map((r) => deck(r) - 0.05), MAT.CREAM, right);
      // the parapet, in runs between its breaks
      for (const run of runs(rs, (r) => !broken(sg, r))) {
        const pO = run.map((r) => at(r, o)), pI = run.map((r) => at(r, sg * DECK));
        const top = run.map((r) => deck(r) + RAIL);
        s.strip(pO, run.map((r) => deck(r) - 0.05), top.map((y) => y - 0.12), MAT.PLASTER, right).strip(pO, top.map((y) => y - 0.12), top, MAT.CREAM, right);
        s.strip(pI, run.map((r) => deck(r)), top.map((y) => y - 0.12), MAT.PLASTER, !right).strip(pI, top.map((y) => y - 0.12), top, MAT.CREAM, !right);
        s.flat(sg > 0 ? pI : pO, sg > 0 ? pO : pI, top, top, MAT.CREAM);
        // the run's ends
        for (const [r, end] of [[run[0], 0], [run[run.length - 1], 1]] as [number, number][]) {
          if (r <= r0 + 0.01 || r >= rB - 0.01) continue;
          const p = at(r, o), q = at(r, sg * DECK);
          s.strip(end === 0 === sg > 0 ? [q, p] : [p, q], deck(r), deck(r) + RAIL, MAT.CREAM, true);
        }
      }
      // where the parapet breaks, the walk runs on to the terrace beside it
      for (const run of runs(rs, (r) => broken(sg, r))) {
        const pO = run.map((r) => at(r, o)), pI = run.map((r) => at(r, sg * DECK));
        s.flat(sg > 0 ? pI : pO, sg > 0 ? pO : pI, run.map(deck), run.map(deck), MAT.PAVING);
      }
    }
  });
  // the walk: a cordonata of long treads and low risers where it descends, plain paving where level
  walk(s, rs, at, deck);
  // the inner end against the temple's ring
  s.strip([at(r0, -CAUSEWAY_H), at(r0, CAUSEWAY_H)], bottom(1, r0), deck(r0) - 0.01, MAT.PLASTER, true);
  // piers on the parapets with finials and lanterns
  let k = 0;
  for (let r = r0 + 6; r < rB - 3; r += 12) {
    for (const sg of [-1, 1]) {
      if (broken(sg, r) || broken(sg, r - 1.2) || broken(sg, r + 1.2)) continue;
      const c = at(r, sg * (CAUSEWAY_H - 0.27)), y = deck(r) + RAIL;
      s.pier(c[0], c[1], a, 0.42, deck(r) - 0.05, y + 0.45, MAT.ASHLAR, MAT.CREAM);
      if ((k + (sg > 0 ? 1 : 0)) % 2 === 0) lantern(s, haul, c, a, y + 0.45, 0.9);
      else s.finial(c[0], c[1], y + 0.45, MAT.GOLD, 1.1);
    }
    k++;
  }
  belvedere(s, haul, g, at, rB, deck(rB), bottom);
  colliders(haul, g, rs, deck, bottom, broken, rB);
}

/** the walk's surface: treads with risers down the slope */
function walk(s: Shapes, rs: number[], at: (r: number, o: number) => V2, deck: (r: number) => number) {
  const r0 = rs[0], r1 = rs[rs.length - 1];
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
      // (flat() pairs left/right along travel: outward travel has larger angles (+o) on its right)
    } else {
      let t = r;
      while (t < r1 && y - deck(t) < 0.15) t = Math.min(r1, t + 0.05);
      next = t;
      const yt = deck(next);
      // the tread falls gently to the riser's top, the riser drops the rest
      s.flat([at(r, -DECK), at(next, -DECK)], [at(r, DECK), at(next, DECK)], [y, y - 0.03], [y, y - 0.03], MAT.ASHLAR);
      s.strip([at(next, -DECK), at(next, DECK)], yt, y - 0.03, MAT.CREAM, true);
    }
    r = next;
  }
}

/** consecutive stations kept by a test, as runs */
function runs(rs: number[], keep: (r: number) => boolean): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  for (const r of rs) { if (keep(r)) cur.push(r); else { if (cur.length > 1) out.push(cur); cur = []; } }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** the causeway's end: a square terrace a little wider than the walk, a balustrade round it, a cupola on four
 *  columns over a bench, lanterns at its outer corners */
function belvedere(s: Shapes, haul: Haul, g: Gap, at: (r: number, o: number) => V2, rB: number, y: number, bottom: (sg: number, r: number) => number) {
  const b = s.b, a = g.a, half = 5.5, depth = 7;
  const c = at(rB + depth / 2, 0);
  const foot = Math.min(bottom(-1, rB), bottom(1, rB)) - 8;
  b.with({ tint: [1.03, 0.98, 0.95] }, () => {
    s.obox(c[0], c[1], a, depth / 2, half, foot, y - 0.35, MAT.PLASTER, { skip: ['top'] });
    s.obox(c[0], c[1], a, depth / 2 + 0.08, half + 0.08, y - 0.35, y, MAT.CREAM, { top: MAT.PAVING });
  });
  // the balustrade on three sides
  const p = (r: number, o: number) => at(rB + r, o);
  s.balustrade(p(0.3, -half + 0.25), p(depth - 0.25, -half + 0.25), y, MAT.CREAM, MAT.CREAM);
  s.balustrade(p(depth - 0.25, -half + 0.25), p(depth - 0.25, half - 0.25), y, MAT.CREAM, MAT.CREAM);
  s.balustrade(p(depth - 0.25, half - 0.25), p(0.3, half - 0.25), y, MAT.CREAM, MAT.CREAM);
  // the cupola: four columns, an entablature, a ribbed dome and a gold finial
  const cc = at(rB + depth / 2 + 0.3, 0), cr = 2.2;
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const q = at(rB + depth / 2 + 0.3 + u * cr * 0.72, v * cr * 0.72);
    b.cylinder(q[0], q[1], 0.2, y, y + 3.1, 10, MAT.CREAM);
    b.cylinder(q[0], q[1], 0.3, y, y + 0.3, 8, MAT.CREAM);
  }
  s.obox(cc[0], cc[1], a, cr, cr, y + 3.1, y + 3.55, MAT.CREAM);
  b.dome(cc[0], y + 3.55, cc[1], cr * 0.95, MAT.PLASTER_WARM, { rise: 1.9, tip: 0.6, rings: 8, sides: 16 });
  s.finial(cc[0], cc[1], y + 5.4, MAT.GOLD, 1.3);
  s.bench(cc[0], cc[1], a + Math.PI / 2, y, MAT.CREAM, 2.0);
  for (const sg of [-1, 1]) {
    const q = p(depth - 0.6, sg * (half - 0.6));
    s.pier(q[0], q[1], a, 0.32, y, y + 1.25, MAT.ASHLAR, MAT.CREAM);
    lantern(s, haul, q, a, y + 1.25);
  }
}

/** the causeway's walking collider, a frame along it: the walk (a level floor, then a ramp for the descent), the
 *  parapets as solids in runs between their breaks (whose gaps are floors onto the terraces), the belvedere */
function colliders(haul: Haul, g: Gap, rs: number[], deck: (r: number) => number, bottom: (sg: number, r: number) => number, broken: (sg: number, r: number) => boolean, rB: number) {
  const F = new Frame(`haven.causeway${Math.round((g.a * 180) / Math.PI)}`, C[0], C[1], g.a);
  const r0 = rs[0];
  // the level start, the descent, the level end
  let ra = r0;
  while (ra < rB && Math.abs(deck(ra + 0.5) - deck(r0)) < 1e-4) ra += 0.5;
  let rb = rB;
  while (rb > ra && Math.abs(deck(rb - 0.5) - deck(rB)) < 1e-4) rb -= 0.5;
  F.floor(r0, -DECK, ra, DECK, deck(r0));
  if (rb > ra + 0.5) F.stair(ra, -DECK, rb, DECK, deck(rb), deck(ra) - deck(rb), 0, -1);
  F.floor(rb, -DECK, rB + 7, DECK, deck(rB));
  for (const sg of [-1, 1]) {
    const y0 = sg < 0 ? -CAUSEWAY_H : DECK - 0.05, y1 = sg < 0 ? -DECK + 0.05 : CAUSEWAY_H;
    for (let r = r0; r < rB; r += 4) {
      const r1 = Math.min(rB, r + 4);
      if (broken(sg, (r + r1) / 2)) { F.floor(r, y0, r1, y1, deck((r + r1) / 2)); continue; }
      F.solid(r, y0, r1, y1, Math.min(bottom(sg, r), bottom(sg, r1)), Math.max(deck(r), deck(r1)) + RAIL);
    }
  }
  // the belvedere's floor and balustrade
  F.floor(rB, -5.5, rB + 7, 5.5, deck(rB));
  F.solid(rB + 6.6, -5.5, rB + 7.1, 5.5, deck(rB) - 8, deck(rB) + 1);
  F.solid(rB, -5.6, rB + 7.1, -5.1, deck(rB) - 8, deck(rB) + 1);
  F.solid(rB, 5.1, rB + 7.1, 5.6, deck(rB) - 8, deck(rB) + 1);
  haul.colliders.push(F.done());
}
