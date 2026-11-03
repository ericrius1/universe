// The houses that fill the lots, each built from its lot (a convex polygon in its block's frame), the edges it shows to a
// street, an alley, a grand front or a courtyard, and how rich its district is. A house is one block of 1–4 storeys or,
// on deeper lots, a front and a back block of different heights, the lower one's roof a terrace with a stair up to the
// higher. Street faces get a door, windows in columns over the storeys (flat, round or pointed by the house's style, lit
// at night or dark), shopfronts or a deep-arched arcade on the grand fronts, sills and surrounds, shutters, balconies and
// wooden oriels, awnings, banners and a lantern by the door (on a rich house's main front, the door in a tiled surround
// over a tiled step, now and then gold lattice doors); party walls stay blank. Roofs are flat behind parapets,
// with stair kiosks, pergolas, roof gardens, water tanks, blue domes and chimney turrets with domed caps. Every block is
// solid to walk into and floored on top, every parapet is a low wall, every stair is walked.
import { PROUD } from '../arch/builder';
import type { Mat, V3 } from '../arch/types';
import { MAT, TILE_PAL } from '../arch/types';
import type { V2 } from '../world/layout';
import type { City, Collide } from './ctx';
import { Face, type Arch, type Opening } from './facade';
import { type Front, type Poly, area, bbox, clipHalf, inset, inside, toWorld } from './geom';
import type { Lot } from './plan';
import { CLOTHS, GLAZES, PAINTS, awning, banner, dome, flight, turret } from './props';
import { Rng } from './rng';
import { surround, threshold } from './tiles';
import { door, shapeOf, windowPart, type DoorKind, type WindowKind } from '../arch/parts';
import { segsFor } from '../arch/parts/arches';

/** foundations go this far below the floor */
const G = 2;

/** the heights of what's built, on a coarse grid of world plan cells: what lantern strings tie to */
export class Skyline {
  private cells = new Map<number, { p: V2[]; h: number }[]>();
  private lots = new Map<number, { p: V2[]; lot: Lot }[]>();
  private readonly cell = 24;
  private bin<T extends { p: V2[] }>(m: Map<number, T[]>, e: T) {
    const [x0, z0, x1, z1] = bbox(e.p), c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
      const k = i * 4096 + j;
      let l = m.get(k);
      if (!l) m.set(k, (l = []));
      l.push(e);
    }
  }
  add(p: V2[], h: number) { this.bin(this.cells, { p, h }); }
  /** a lot's footprint (world plan), every one known before any house is built */
  addLot(p: V2[], lot: Lot) { this.bin(this.lots, { p, lot }); }
  /** the lot a world plan point lies in (null: a street, a square, open ground) */
  lotAt(x: number, z: number): Lot | null {
    for (const e of this.lots.get(Math.floor(x / this.cell) * 4096 + Math.floor(z / this.cell)) ?? []) if (inside([x, z], e.p)) return e.lot;
    return null;
  }
  /** the height of what stands at a world plan point (0: open ground) */
  at(x: number, z: number): number {
    const l = this.cells.get(Math.floor(x / this.cell) * 4096 + Math.floor(z / this.cell));
    let h = 0;
    if (l) for (const e of l) if (e.h > h && inside([x, z], e.p)) h = e.h;
    return h;
  }
}

interface Style {
  wall: Mat;
  tint: V3;
  /** the domes' glaze */
  glaze: V3;
  /** the roof's surface: a lime-washed terrace, tan to brown (roofTint) */
  roof: Mat;
  trim: Mat;
  trimTint: V3;
  roofTint: V3;
  /** ground and upper storeys' heights */
  gh: number;
  sh: number;
  arch: Arch;
  winW: number;
  winH: number;
  spacing: number;
  shutters: V3 | null;
  frames: boolean;
  rich: boolean;
  /** the merlons on its parapets (a PROTOS name) */
  merlon: string;
  /** its street windows and its door from the parts library (the better-off houses'), and their kinds */
  parts: boolean;
  window: WindowKind;
  door: DoorKind;
  w: number;
}

interface Part { poly: V2[]; f: Front[]; court: boolean[]; storeys: number; H: number; cut: number }

export function house(c: City, col: Collide, lot: Lot, court: boolean[], frame: { o: V2; yaw: number }, sky: Skyline) {
  const rng = new Rng(lot.seed);
  const p = lot.poly.p, f = lot.poly.f;
  const w = lot.wealth;
  const st = style(rng, w);
  const A = area(p);
  // the main front: the best-ranked edge, the longest of those
  let main = 0;
  for (let i = 1; i < p.length; i++) if (rank(i) > rank(main)) main = i;
  function rank(i: number) { return (f[i] + (court[i] ? 0.5 : 0)) * 1000 + edgeLen(p, i); }

  // storeys: humble houses low, rich ones tall, now and then a tower house
  let n = w < 0.3 ? rng.weighted([1, 2, 3], [4, 5, 1]) : w < 0.6 ? rng.weighted([1, 2, 3, 4], [1, 4.5, 3.5, 1]) : rng.weighted([2, 3, 4], [2.5, 4.5, 3]);
  if (A < 60 && n > 2) n = 2;
  const tower = A < 110 && A > 30 && rng.chance(0.05 + w * 0.06);
  if (tower) n += rng.int(2, 3);
  const Hn = (k: number) => st.gh + (k - 1) * st.sh;

  // massing: one block, or front and back blocks of different heights on a deep lot whose front is square to the frame
  const parts: Part[] = [];
  const ax = axisOf(p, main);
  const deep = depthAlong(p, main);
  if (!tower && ax !== null && A > 120 && deep > 13 && n >= 2 && rng.chance(0.55)) {
    const [nx, nz] = outward(p, main);
    const proj = p.map(([x, z]) => x * nx + z * nz);
    const hi = Math.max(...proj), lo = Math.min(...proj);
    const s = hi - (hi - lo) * rng.range(0.45, 0.6);
    const front = clipHalf({ p, f: f.map((v) => v) }, -nx, -nz, -s, 0);
    const back = clipHalf({ p, f: f.map((v) => v) }, nx, nz, s, 0);
    const nb = Math.max(1, n + (rng.chance(0.6) ? -1 : 1));
    const courtOf = (q: Poly) => q.p.map((_, i) => courtAt(q, i, p, court));
    parts.push({ poly: front.p, f: front.f, court: courtOf(front), storeys: n, H: Hn(n), cut: findCut(front.p, nx, nz, s) });
    parts.push({ poly: back.p, f: back.f, court: courtOf(back), storeys: nb, H: Hn(nb), cut: findCut(back.p, nx, nz, s) });
  } else parts.push({ poly: p, f, court, storeys: n, H: Hn(n), cut: -1 });

  // (whether a plan point here lies in no other lot: a corner tower keeps out of its neighbours')
  const ours = (q: V2) => { const w = toWorld(q, frame.o, frame.yaw), l = sky.lotAt(w[0], w[1]); return !l || l === lot; };
  // (whether a plan point out of the house is open ground: a street, an alley, a courtyard — where an outside stair may
  // stand)
  const open = (q: V2) => { const w = toWorld(q, frame.o, frame.yaw), l = sky.lotAt(w[0], w[1]); return !l || (l !== lot && l.kind === 'court'); };
  for (const [k, part] of parts.entries()) {
    buildPart(c, col, part, parts[1 - k] ?? null, st, rng, ours, open);
    sky.add(part.poly.map((q) => toWorld(q, frame.o, frame.yaw)), part.H);
  }
}

/** the windows' second chances: each face's own stream (openings) */
let moreSalt = 0;

function style(rng: Rng, w: number): Style {
  const rich = w > 0.62;
  const wall: Mat = rng.chance(0.05 + w * 0.06) ? MAT.ASHLAR : w > 0.45 && rng.chance(0.55) ? MAT.PLASTER_WARM : MAT.PLASTER;
  // a per-house plaster tint: terracotta toward rose, orange or a sunbaked pale
  const hue = rng.next();
  const tint: V3 = hue < 0.5 ? [1 + rng.range(-0.08, 0.08), 1 + rng.range(-0.1, 0.06), 1 + rng.range(-0.1, 0.06)]
    : hue < 0.72 ? [1.06, 0.92, 0.9] : hue < 0.88 ? [1.04, 1.1, 1.0] : [1.12, 1.2, 1.15];
  const sh = 3.3 + w * 0.6 + rng.range(-0.1, 0.2);
  return {
    wall, tint, rich, w,
    roof: MAT.CREAM,
    glaze: rng.weighted(GLAZES, [5, 3, 2]),
    trim: w > 0.3 ? MAT.CREAM : MAT.PLASTER,
    trimTint: w > 0.3 ? [1, 1, 1] : [0.86, 0.82, 0.8],
    roofTint: roofTint(rng),
    gh: sh + 0.3 + w * 0.6,
    sh,
    arch: rich ? rng.weighted<Arch>(['round', 'pointed', 'flat'], [5, 3, 2]) : w > 0.3 ? rng.weighted<Arch>(['round', 'flat', 'pointed'], [4, 5, 1]) : rng.weighted<Arch>(['flat', 'round'], [8, 2]),
    winW: 0.8 + w * 0.55 + rng.range(-0.05, 0.15),
    winH: 1.35 + w * 0.9 + rng.range(-0.1, 0.2),
    spacing: 2.9 + rng.range(0, 1.1) + w * 0.4,
    shutters: w > 0.2 && w < 0.8 && rng.chance(0.35) ? rng.pick(PAINTS) : null,
    frames: w > 0.35 && rng.chance(0.4 + w * 0.5),
    merlon: rng.weighted(['merlon-stepped', 'merlon-square', 'merlon-pointed', 'merlon-rounded'], [4, 2, 1.5, 1]),
    parts: w > 0.42 && rng.chance(0.4 + w * 0.5),
    window: rng.weighted<WindowKind>(['shuttered', 'latticed', 'arched', 'plain'], [4, 2.5, w > 0.6 ? 2.5 : 1, 1.5]),
    door: rng.weighted<DoorKind>(['plank', 'panelled'], [3, 2]),
  };
}

/** the roofs' tints: tan and brown, sun-faded sand to umber, each a little its own (from the air the town is a field of
 *  them between the cream streets) */
const ROOFS: V3[] = [[1.0, 0.94, 0.86], [0.88, 0.78, 0.68], [0.76, 0.62, 0.52], [0.64, 0.5, 0.42], [0.54, 0.41, 0.35], [0.84, 0.7, 0.52]];
function roofTint(rng: Rng): V3 {
  const t = rng.weighted(ROOFS, [3, 3, 2.5, 1.5, 1.5, 2]), k = rng.range(0.94, 1.06);
  return [t[0] * k, t[1] * k * rng.range(0.97, 1.03), t[2] * k * rng.range(0.96, 1.04)];
}

/** a hole in a face for a part of the parts library (a window, a door) at u, its sill at v0, w wide, h to its crown:
 *  the part's own shape (arch/parts shapeOf at mid detail), so the hole is the one the part's reveal lines */
function partHole(u: number, v0: number, w: number, h: number, arch: Arch, depth: number): Opening {
  const o: Opening = { u0: u - w / 2, u1: u + w / 2, v0, top: v0 + h, arch, depth, fill: null, bare: true };
  if (arch === 'flat') return o;
  const sh = shapeOf(w, h, arch, segsFor('mid', w));
  return { ...o, arc: sh.curve!.pts.map(([x, y]) => [u + x, v0 + sh.ys + y] as V2) };
}
/** lay a part on a face, its frame at (u, v) on the face's plane, x along it, z out of it */
function onFaceLay(c: City, f: Face, u: number, v: number, lay: () => void) {
  c.b.group(() => { const p = f.at(u, v, 0); c.b.at(p[0], p[1], p[2], f.yaw); lay(); });
}

/** a dome (props.ts) crowned with a gold finial from the parts, instanced, its foot on the dome's apex */
function domeWithFinial(c: City, x: number, y: number, z: number, r: number, o: Parameters<typeof dome>[5] & object, rng: Rng) {
  const top = dome(c, x, y, z, r, { ...o, finial: false }), rise = o.rise ?? r * 1.05;
  // (the apex: dome() hands back the spring plus the rise; a pointed crown stands a little over it)
  const apex = top + (o.tip ?? 0.25) * rise * 0.35 - 0.02;
  c.b.place(rng.pick(['finial-ball', 'finial-spire', 'finial-lotus']), [x, apex, z], { scale: Math.max(0.5, r * 0.4) });
}

/** a small part placed on a face (instanced: b.place), at (u, v) on it, `w` out of it (negative), turned to it */
function onFace(c: City, f: Face, proto: string, u: number, v: number, w = 0, o: { scale?: number; tint?: V3 } = {}) {
  c.b.place(proto, f.at(u, v, w), { yaw: f.yaw, ...o });
}

function buildPart(c: City, col: Collide, part: Part, other: Part | null, st: Style, rng: Rng, ours: (q: V2) => boolean, open: (q: V2) => boolean) {
  const b = c.b;
  const p = part.poly, H = part.H;
  if (p.length < 3 || area(p) < 8) return;
  // the door goes on the best street face
  let mainEdge = -1, best = 0;
  for (let i = 0; i < p.length; i++) {
    const r = (part.f[i] + (part.court[i] ? 0.5 : 0)) * 1000 + edgeLen(p, i);
    if (i !== part.cut && r > best) { best = r; mainEdge = i; }
  }
  const pH = st.rich ? rng.range(1.0, 1.3) : rng.range(0.85, 1.1);
  const lower = other !== null && other.H < H - 0.5 ? other.H : null;

  // which corners turn out (convex: the outline's own way round), and which faces are dressed (a street's, a court's)
  const np = p.length;
  let turn = 0;
  for (let k = 0; k < np; k++) { const a = p[k], q = p[(k + 1) % np]; turn += a[0] * q[1] - q[0] * a[1]; }
  const convex = (k: number) => {
    const a = p[(k + np - 1) % np], q = p[((k % np) + np) % np], e = p[(k + 1) % np];
    return Math.sign(turn) * ((q[0] - a[0]) * (e[1] - q[1]) - (q[1] - a[1]) * (e[0] - q[0])) > 1e-6;
  };
  // (a face too short to dress — a hair's edge left where two cuts met — isn't dressed: nothing wraps round onto it)
  const shown2 = (k: number) => { const j = ((k % np) + np) % np; return j !== part.cut && (part.f[j] > 0 || part.court[j]) && edgeLen(p, j) >= 0.3; };
  // (a corner sharper than 80°: what stands out of the two faces there meets past it, so each stops short)
  const sharp = (k: number) => {
    const a = p[(k + np - 1) % np], q = p[((k % np) + np) % np], e = p[(k + 1) % np];
    const ux = a[0] - q[0], uz = a[1] - q[1], vx = e[0] - q[0], vz = e[1] - q[1];
    return (ux * vx + uz * vz) / ((Math.hypot(ux, uz) * Math.hypot(vx, vz)) || 1) > Math.cos((80 * Math.PI) / 180);
  };

  // the walls, their openings and what hangs on them
  b.with({ tint: st.tint }, () => {
    for (let i = 0; i < p.length; i++) {
      const face = new Face(b, p[(i + 1) % p.length], p[i], -G, H + G);
      if (face.len < 0.3) continue;
      if (i === part.cut) {
        // between the front and back blocks: hidden below the lower roof, the taller block's face above it
        if (lower !== null) cutFace(b, p, i, lower, H, st, rng);
        continue;
      }
      const front = part.f[i];
      const shown = front > 0 || part.court[i];
      const { ops, decor } = shown ? openings(c, face, part, i === mainEdge, front, part.court[i], st, rng) : { ops: [], decor: [] };
      face.wall(st.wall, ops);
      // (the face runs from its left end at p[i + 1] to its right at p[i]. What stands out of it along its length —
      // the plinth, the string courses — stops that far short of a corner turning in, where the next face's runs on
      // into it: both to the corner, they overlapped there; the cornice wraps a corner turning out where the next face
      // has one too, and only there: past a face's end in line with the next, it ran into that one's)
      // (and at an end where the next face isn't dressed — a party wall, a neighbour's lot beyond it — it stops its own
      // depth short, so a neighbour's plinth or cornice turning the same corner from the other side never meets it)
      const outL = convex(i + 1) && shown2(i + 1) && !sharp(i + 1), outR = convex(i) && shown2(i - 1) && !sharp(i);
      const cutL = !shown2(i + 1) || sharp(i + 1), cutR = !shown2(i - 1) || sharp(i);
      const run = (d: number, wrap = false): [number, number] => [outL && wrap ? -d : cutL ? d : 0, face.len + (outR && wrap ? d : cutR ? -d : 0)];
      if (shown && st.w > 0.4) { const [a, z] = run(0.07); face.box(a, 0, z, G + 0.55, -0.07, 0, MAT.ASHLAR, { skip: ['left', 'right', 'bottom'] }); }
      if (shown && st.w > 0.3) {
        const [a, z] = run(0.2, true);
        face.box(a, G + H - 0.28, z, G + H + 0.04, -0.2, 0, st.trim, { skip: ['left', 'right'] });
        if (st.rich) for (let k = 1; k < part.storeys; k++) {
          const v = G + st.gh + (k - 1) * st.sh, [a2, z2] = run(0.06);
          face.box(a2, v - 0.08, z2, v + 0.08, -0.06, 0, st.trim, { skip: ['left', 'right', 'bottom'] });
        }
      }
      for (const d of decor) d();
    }
  });

  // the roof: walked on, behind a parapet that is a low wall (a gap where an outside stair arrives)
  b.with({ tint: st.roofTint }, () => b.slab(p, H, st.roof));
  col.polySolid(p, -G, H).polyFloor(p, H);
  const stair = outsideStair(part, other, H, rng, open, mainEdge);
  // (the parapet's pieces mitred where two edges meet — each its own outline from the wall's face in to the inner
  // line, the corners on the bisector — so no two tops lie one over the other; a square end at a gap, and where the
  // corner's too sharp to mitre)
  const T = 0.3, n = p.length;
  const dirOf = (i: number): V2 => { const a = p[i], e = p[(i + 1) % n], L = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1; return [(e[0] - a[0]) / L, (e[1] - a[1]) / L]; };
  const mitre: (V2 | null)[] = p.map((v, k) => {
    const i0 = (k + n - 1) % n, d0 = dirOf(i0), d1 = dirOf(k);
    const P0: V2 = [p[i0][0] - d0[1] * T, p[i0][1] + d0[0] * T], P1: V2 = [v[0] - d1[1] * T, v[1] + d1[0] * T];
    const den = d0[0] * d1[1] - d0[1] * d1[0];
    if (Math.abs(den) < 1e-6) return P1;
    const sp = ((P1[0] - P0[0]) * d1[1] - (P1[1] - P0[1]) * d1[0]) / den, X: V2 = [P0[0] + d0[0] * sp, P0[1] + d0[1] * sp];
    return Math.hypot(X[0] - v[0], X[1] - v[1]) > 4 * T ? null : X;
  });
  b.with({ tint: st.tint }, () => {
    for (let i = 0; i < n; i++) {
      // (none along the cut under a taller block's wall; a low coping, stepped over, along it above a lower one)
      if (i === part.cut && lower === null) continue;
      const face = new Face(b, p[(i + 1) % n], p[i], H, pH);
      if (face.len < 0.05) continue;
      const h = i === part.cut ? 0.3 : pH;
      const gaps: [number, number][] = stair && stair.edge === i ? [[face.len - stair.g1, face.len - stair.g0]] : [];
      const segs = segments(face.len, gaps);
      const inner = (u: number): V2 => {
        if (u < 1e-3 && mitre[(i + 1) % n]) return mitre[(i + 1) % n]!;
        if (u > face.len - 1e-3 && mitre[i]) return mitre[i]!;
        const q = face.at(u, 0, T);
        return [q[0], q[2]];
      };
      for (const [u0, u1] of segs) {
        const a = face.at(u0, 0), e = face.at(u1, 0);
        let i0 = inner(u0), i1 = inner(u1);
        // (on a short edge between two sharp corners the mitres cross: square ends there)
        const along = (q: V2) => ((q[0] - a[0]) * (e[0] - a[0]) + (q[1] - a[2]) * (e[2] - a[2])) / Math.max(1e-9, u1 - u0);
        if (along(i1) - along(i0) < 0.02) { const s0 = face.at(u0, 0, T), s1 = face.at(u1, 0, T); i0 = [s0[0], s0[2]]; i1 = [s1[0], s1[2]]; }
        const q: V2[] = [[a[0], a[2]], [e[0], e[2]], i1, i0];
        if (u1 - u0 < 0.05 || area(q) * area(p) <= 1e-6) continue;
        b.prism(q, H, H + h, st.wall, { top: st.w > 0.3 ? MAT.CREAM : st.wall });
        col.polySolid(q, H, H + h, 1.0);
      }
      // (merlons along a rich street front's parapet, instanced: their feet on its coping, square to it)
      if (st.rich && part.f[i] >= 2 && i !== part.cut && rng.chance(0.5)) for (const [u0, u1] of segs) {
        const m = Math.floor((u1 - u0 - 0.6) / 0.85);
        for (let k = 0; k < m; k++) onFace(c, face, st.merlon, u0 + (u1 - u0 - (m - 1) * 0.85) / 2 + k * 0.85, h, 0.15, { scale: 0.75, tint: st.tint });
      }
    }
  });
  if (stair) stair.build(c, col, st);
  if (lower !== null && other) terraceStair(c, col, other, part, st, rng);
  roofTop(c, col, part, st, rng, !!stair, other !== null && other.H > H);
  if (st.w > 0.5 && rng.chance(0.3)) cornerTower(c, col, part, other, st, rng, ours);
}

/** a round tower engaged at a corner where two street fronts meet, rising past the parapet to a dome or merlons */
function cornerTower(c: City, col: Collide, part: Part, other: Part | null, st: Style, rng: Rng, ours: (q: V2) => boolean) {
  const b = c.b, p = part.poly, n = p.length;
  for (let i = 0; i < n; i++) {
    const prev = (i + n - 1) % n;
    if (part.f[i] < 2 || part.f[prev] < 2 || i === part.cut || prev === part.cut) continue;
    const [ax, az] = outward(p, prev), [bx, bz] = outward(p, i);
    if (Math.abs(ax * bx + az * bz) > 0.3) continue;
    const r = rng.range(1.8, 2.6), h = part.H + rng.range(2.5, 6);
    // (its centre a little inside the corner, so it bulges out of both fronts)
    const cx = p[i][0] - (ax + bx) * r * 0.35, cz = p[i][1] - (az + bz) * r * 0.35;
    // (not where it would reach into a neighbour across a narrow way, or the house's other block: their parapets and
    // merlons ran through its top)
    const rim = Array.from({ length: 16 }, (_, k) => [cx + Math.cos((k / 16) * Math.PI * 2) * (r + 0.15), cz + Math.sin((k / 16) * Math.PI * 2) * (r + 0.15)] as V2);
    if (rim.some((q) => !ours(q) || (other !== null && inside(q, other.poly)))) continue;
    b.with({ tint: st.tint }, () => b.cylinder(cx, cz, r, -G, h, 12, st.wall, { top: MAT.PAVING }));
    // (the band's top a step under the roof's paving: at the same height they fought)
    b.cylinder(cx, cz, r + 0.12, h - 0.43, h - 0.03, 12, MAT.CREAM);
    for (const v of [part.H - 2.6, part.H + 0.6]) {
      if (v + 1.6 > h - 0.6) continue;
      for (let k = 0; k < 3; k++) {
        const a = Math.atan2(ax + bz * (k - 1) * 0.9 + bx, az - bx * (k - 1) * 0.9 + bz) ;
        const dx = Math.sin(a), dz = Math.cos(a), tx = dz * 0.32, tz = -dx * 0.32;
        const q = (s: number, y: number): V3 => [cx + dx * (r + 0.015) + tx * s, y, cz + dz * (r + 0.015) + tz * s];
        b.with({ glow: rng.chance(0.6) ? 0.8 : 0 }, () => b.poly([q(-1, v), q(1, v), q(1, v + 1.6), q(-1, v + 1.6)].reverse(), MAT.WINDOW));
      }
    }
    if (rng.chance(0.6)) domeWithFinial(c, cx, h, cz, r * 0.95, { drum: 0.4, bulge: 1.1, tip: 0.6, glaze: st.glaze }, rng);
    else {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        b.group(() => { b.at(cx + Math.cos(a) * (r - 0.2), 0, cz + Math.sin(a) * (r - 0.2), -a); b.box(-0.2, h, -0.35, 0.2, h + 0.7, 0.35, st.wall, { top: MAT.CREAM, skip: ['bottom'] }); });
      }
    }
    col.solid(cx - r * 0.85, cz - r * 0.85, cx + r * 0.85, cz + r * 0.85, -G, h).floor(cx - r * 0.7, cz - r * 0.7, cx + r * 0.7, cz + r * 0.7, h);
    return;
  }
}

/** the taller block's face above the lower block's roof, onto the terrace: a door and a window or two */
function cutFace(b: City['b'], p: V2[], i: number, lower: number, H: number, st: Style, rng: Rng) {
  const face = new Face(b, p[(i + 1) % p.length], p[i], lower, H - lower);
  const ops: Opening[] = [];
  const L = face.len, h = H - lower;
  if (h > 2.8 && L > 3) {
    const u = L * rng.range(0.3, 0.7);
    ops.push({ u0: u - 0.6, u1: u + 0.6, v0: 0, top: Math.min(h - 0.5, 2.5), arch: st.arch === 'flat' ? 'flat' : 'round', depth: 0.35, fill: MAT.WOOD, fillTint: rng.pick(PAINTS) });
    if (L > 6) {
      const u2 = u < L / 2 ? u + 2.4 : u - 2.4;
      ops.push({ u0: u2 - st.winW / 2, u1: u2 + st.winW / 2, v0: 0.9, top: Math.min(h - 0.5, 0.9 + st.winH), arch: st.arch, depth: 0.28, fill: MAT.WINDOW, glow: rng.chance(0.6) ? rng.range(0.4, 1) : 0 });
    }
  }
  face.wall(st.wall, ops);
}

/** a rich house's door in a tiled surround: as far out either side as its neighbours leave room (an opening's frame, a
 *  shop's awning), up to the storey's line (its cream band running over the border's top) or under the cornice */
function tiledDoor(c: City, face: Face, door: Opening, ops: Opening[], part: Part, st: Style, pal: number) {
  const fw = door.frameW ?? 0, top = door.top + fw;
  const ceil = G + st.gh + (part.storeys > 1 ? 0.02 : -0.32);
  const room = ceil - top;
  if (room < 0.1) return;
  const bw = Math.min(0.24, room * 0.65), over = Math.max(0.02, room - bw - 0.02);
  let left = door.u0 - fw - 0.15, right = face.len - 0.15 - (door.u1 + fw);
  for (const o of ops) {
    if (o === door || o.v0 > ceil || o.top < door.v0) continue;
    const ow = (o.frameW ?? 0) + (o.fill === MAT.INTERIOR ? 0.4 : 0.12);
    if (o.u1 <= door.u0) left = Math.min(left, door.u0 - fw - (o.u1 + ow));
    else if (o.u0 >= door.u1) right = Math.min(right, o.u0 - ow - (door.u1 + fw));
  }
  const side = Math.min(0.6, Math.min(left, right) - bw);
  if (side < 0.16) return;
  surround(c, face, door, side, over, { pal, bw });
}

/** the openings on one face and what hangs on it (run after the wall is laid) */
function openings(c: City, face: Face, part: Part, isMain: boolean, front: Front, court: boolean, st: Style, rng: Rng): { ops: Opening[]; decor: (() => void)[] } {
  const ops: Opening[] = [], decor: (() => void)[] = [];
  const L = face.len, w = st.w;
  if (L < 2.2) return { ops, decor };
  // (most windows lit at night: the city's own odds, then — for one it leaves dark — a second chance from a stream of
  // their own, forked without drawing from the house's, so every draw after this, and the city with it, stays as it was)
  const more = rng.fork(0x1173 + moreSalt++);
  const lit = () => (rng.chance(0.62) ? rng.range(0.45, 1) : 0) || (more.chance(0.55) ? more.range(0.35, 0.85) : 0);
  const spacing = front >= 2 ? st.spacing : st.spacing * 1.35;
  // windows on alleys, courtyards and humble houses lie flush (no hole): the streets get the deep ones
  const deep = (d: number) => (front >= 2 && w > 0.38 ? d : 0);
  const m = Math.max(1, Math.min(14, Math.floor((L - 0.6) / spacing)));
  const us = Array.from({ length: m }, (_, i) => (L * (i + 0.5)) / m);
  const ww = Math.min(st.winW * (front >= 2 ? 1 : 0.8), L / m - 0.9);
  if (ww < 0.5) return { ops, decor };
  const framed = (o: Opening): Opening => (st.frames && front >= 2 ? { ...o, frame: st.trim, frameW: 0.16, frameTint: st.trimTint } : o);

  // the ground floor: the door on the main front, an arcade on the grand fronts, shopfronts on the busy streets
  const doorAt = isMain ? Math.floor(m / 2) : court && rng.chance(0.4) ? rng.int(0, m - 1) : -1;
  const arcade = front === 3 && w > 0.55 && L > 7 && isMain && rng.chance(0.7);
  const shops = !arcade && front >= 2 && isMain && w > 0.15 && w < 0.85 && rng.chance(0.6);
  for (let i = 0; i < m; i++) {
    const u = us[i];
    if (arcade) {
      const aw = Math.min(L / m - 0.8, 2.8);
      ops.push({ u0: u - aw / 2, u1: u + aw / 2, v0: G, top: G + Math.min(st.gh - 0.4, 3.0 + aw * 0.5), arch: st.arch === 'flat' ? 'round' : st.arch, depth: 1.6, fill: MAT.INTERIOR, glow: rng.chance(0.7) ? rng.range(0.3, 0.7) : 0, frame: MAT.CREAM, frameW: 0.22 });
      if (i === doorAt) decor.push(() => onFace(c, face, 'lantern-wall', u + aw / 2 + 0.45, G + 2.6));
      continue;
    }
    if (i === doorAt) {
      const dw = Math.min(L / m - 0.6, isMain ? 1.4 + w * 1.0 : 1.2);
      const arch: Arch = w > 0.3 || rng.chance(0.4) ? (st.arch === 'flat' ? 'round' : st.arch) : 'flat';
      const dh = Math.min(st.gh - 0.5, 2.3 + w * 1.1 + (arch === 'flat' ? 0 : dw * 0.4));
      let op: Opening = { u0: u - dw / 2, u1: u + dw / 2, v0: G, top: G + dh, arch, depth: 0.45, fill: MAT.WOOD, fillTint: rng.pick(PAINTS) };
      // a rich house's main door: tiles round it and under it, now and then gold lattice doors (from a stream of its own:
      // the house's draws, and the city's after them, stay as they were)
      const orn = st.rich && isMain ? rng.fork(0x711e5) : null;
      const pal = orn ? orn.pick([TILE_PAL.HOUSE, TILE_PAL.HOUSE, TILE_PAL.HOUSE_BLUE]) : 0;
      if (orn?.chance(0.4)) op = { ...op, fill: MAT.LATTICE, fillTint: undefined, pal };
      if (w > 0.3) op = { ...op, frame: st.trim, frameW: 0.22, frameTint: st.trimTint };
      // (the better-off houses' doors from the parts: a step up to a planked or panelled door in its surround)
      const asPart = !orn && st.parts, step = 0.16, paint = rng.pick(PAINTS), seed = Math.floor(rng.next() * 1e6);
      if (asPart) op = partHole(u, G + step, dw, dh - step, arch, 0.3);
      ops.push(op);
      decor.push(() => {
        if (asPart) onFaceLay(c, face, u, G + step, () => door(c.b, { w: dw, h: dh - step, kind: st.door, arch, detail: 'mid', depth: 0.3, paint, trim: st.trim, wall: st.wall, step, seed }));
        else if (orn) {
          threshold(c, face, u - dw / 2 - 0.25, u + dw / 2 + 0.25, G - 0.1, G + 0.15, 0.5, pal);
          tiledDoor(c, face, op, ops, part, st, pal);
        } else face.box(u - dw / 2 - 0.25, G - 0.1, u + dw / 2 + 0.25, G + 0.15, -0.5, 0, MAT.ASHLAR, { skip: ['bottom'] });
        if (front >= 2 || rng.chance(0.6)) {
          const v = G + Math.min(dh + 0.1, st.gh - 0.4);
          // (a lantern by the door, lit: the better-off houses' all, one in three of the humbler)
          if (w > 0.45 || rng.chance(0.35)) onFace(c, face, 'lantern-wall', u + dw / 2 + 0.55, v - 0.3);
        }
        if (!st.rich && rng.chance(0.45)) awning(c, face, u - dw / 2 - 0.4, u + dw / 2 + 0.4, G + dh + 0.45, 1.1, 0.45, rng.pick(CLOTHS));
        // what stands by a door: a bench against the wall, jars, a stack of crates (on the side away from its lantern)
        const things = rng.chance(w < 0.5 ? 0.45 : 0.25);
        if (things) doorstep(c, face, u - dw / 2 - 1.15, rng);
        // potted plants either side of the door now and then (only right of it where the things stand left)
        if (rng.chance(0.2)) for (const du of things ? [1] : rng.chance(0.5) ? [-1, 1] : [rng.chance(0.5) ? -1 : 1]) {
          const p = face.at(u + du * (dw / 2 + 0.55), G, -0.45), r = rng.range(0.26, 0.38);
          c.b.cylinder(p[0], p[2], r, 0, r * 1.9, 6, MAT.PLASTER, { r1: r * 1.25, top: MAT.SOIL });
          c.bed(Array.from({ length: 6 }, (_, i) => [p[0] + Math.cos((i / 6) * Math.PI * 2) * r * 1.1, p[2] + Math.sin((i / 6) * Math.PI * 2) * r * 1.1] as V2), r * 1.9, rng.pick(['flowers', 'shrubs', 'flowers'] as const), 1, rng.pick(['pink', 'white', 'gold', 'purple'] as const));
        }
      });
      continue;
    }
    if (shops && rng.chance(0.75)) {
      const sw = Math.min(L / m - 0.7, 2.6);
      const top = G + Math.min(st.gh - 0.6, 2.9);
      ops.push({ u0: u - sw / 2, u1: u + sw / 2, v0: G, top, arch: rng.chance(0.4) ? 'round' : 'flat', depth: 0.9, fill: MAT.INTERIOR, glow: rng.chance(0.75) ? rng.range(0.4, 0.9) : 0 });
      if (rng.chance(0.75)) {
        const tint = rng.pick(CLOTHS), out = rng.range(1.2, 1.8), drop = rng.range(0.5, 0.8);
        decor.push(() => awning(c, face, u - sw / 2 - 0.3, u + sw / 2 + 0.3, top + 0.35, out, drop, tint));
      }
      continue;
    }
    if (rng.chance(front >= 2 ? 0.85 : 0.5)) {
      const gw = Math.min(ww, 0.95), sill = G + 1.25, top = G + Math.min(st.gh - 0.5, 2.35 + w * 0.4);
      ops.push(framed({ u0: u - gw / 2, u1: u + gw / 2, v0: sill, top, arch: st.arch === 'pointed' ? 'round' : st.arch, depth: deep(0.3), fill: MAT.WINDOW, glow: lit() }));
    }
  }

  // the upper storeys: windows in the same columns, now and then a balcony door or a wooden oriel
  const oriel = !st.rich && w > 0.25 && front >= 2 && part.storeys >= 2 && m >= 2 && rng.chance(0.3) ? rng.int(0, m - 1) : -1;
  for (let k = 1; k < part.storeys; k++) {
    const base = G + st.gh + (k - 1) * st.sh;
    const wh = Math.min(st.winH * (front >= 2 ? 1 : 0.75), st.sh - 1.2);
    for (let i = 0; i < m; i++) {
      const u = us[i];
      if (front < 2 && !court && rng.chance(0.35)) continue;
      if (i === oriel && k === 1) {
        const ow = Math.min(L / m - 0.4, 2.1), g = lit();
        decor.push(() => orielOn(c, face, u, ow, base, st, g));
        continue;
      }
      if (st.rich && front >= 2 && rng.chance(0.28)) {
        const dw = Math.min(ww + 0.2, 1.5);
        ops.push(framed({ u0: u - dw / 2, u1: u + dw / 2, v0: base + 0.05, top: base + Math.min(st.sh - 0.5, 2.6), arch: st.arch, depth: 0.35, fill: MAT.WINDOW, glow: lit() }));
        decor.push(() => balconyOn(c, face, u, dw + 1.2, base, st));
        continue;
      }
      if (st.parts && front >= 2) {
        // (a window from the parts: shuttered only where its shutters clear the next window's)
        const kind: WindowKind = st.window === 'shuttered' && L / m < ww * 2 + 0.7 ? 'plain' : st.window;
        const g = lit(), seed = Math.floor(rng.next() * 1e6);
        ops.push(partHole(u, base + 0.85, ww, wh, kind === 'arched' && st.arch === 'flat' ? 'round' : st.arch, 0.22));
        decor.push(() => onFaceLay(c, face, u, base + 0.85, () => windowPart(c.b, {
          w: ww, h: wh, kind, arch: kind === 'arched' && st.arch === 'flat' ? 'round' : st.arch, detail: 'mid', depth: 0.22, lit: g,
          wall: st.wall, trim: st.trim, paint: st.shutters ?? undefined, seed,
        })));
        continue;
      }
      const sill = w > 0.38 && front >= 2;
      const op = framed({ u0: u - ww / 2, u1: u + ww / 2, v0: base + 0.85, top: base + 0.85 + wh, arch: st.arch, depth: deep(0.28), fill: MAT.WINDOW, glow: lit(), sill });
      ops.push(op);
      decor.push(() => {
        if (sill) face.box(op.u0 - 0.12, op.v0 - 0.12, op.u1 + 0.12, op.v0, -0.14, 0, st.trim, { skip: ['left', 'right'] });
        if (st.shutters && op.arch === 'flat') shutters(c, face, op, ww / 2, st.shutters);
      });
    }
  }
  // banners on the grand fronts
  if (front === 3 && w > 0.5 && part.storeys >= 2 && m >= 2 && rng.chance(0.45)) {
    const tint = rng.pick<V3>([[1.05, 0.25, 0.2], [1.05, 0.25, 0.2], [0.35, 0.75, 0.7], [0.75, 0.35, 0.75]]);
    const top = G + part.H - 0.4, len = Math.min(part.H - 3.5, 5.5);
    for (const u of m >= 4 ? [L / m, L * (1 - 1 / m)] : [L / 2]) decor.push(() => banner(c, face, u, top, 1.1, len, tint));
  }
  return { ops, decor };
}

/** the things by a door, against the wall to the left of `u` (its right end there): a bench, a few jars, a stack of
 *  crates (not where the face runs out) */
function doorstep(c: City, face: Face, u: number, rng: Rng) {
  const b = c.b, kind = rng.weighted(['bench', 'jars', 'crates'] as const, [3, 4, 2]);
  if (kind === 'bench') {
    const l = rng.range(1.2, 1.8);
    if (u - l < 0.4) return;
    // (a hand's breadth off the wall, clear of its plinth)
    b.with({ tint: rng.chance(0.5) ? [0.85, 0.75, 0.7] : [1, 1, 1] }, () => face.box(u - l, G, u, G + 0.45, -0.55, -0.1, rng.chance(0.6) ? MAT.WOOD : MAT.ASHLAR, { skip: ['bottom'], back: true }));
    return;
  }
  if (kind === 'jars') {
    let x = u - 0.3;
    for (let k = rng.int(2, 3); k > 0 && x > 0.6; k--) {
      const r = rng.range(0.2, 0.3), h = rng.range(0.5, 0.85), p = face.at(x - r, G, -r - 0.08);
      b.with({ tint: rng.pick<V3>([[1.1, 0.75, 0.55], [1.0, 0.9, 0.75], [0.8, 0.55, 0.42]]) }, () => {
        b.cylinder(p[0], p[2], r * 0.75, 0, h * 0.3, 6, MAT.CREAM, { r1: r, top: null });
        b.cylinder(p[0], p[2], r, h * 0.3, h * 0.85, 6, MAT.CREAM, { r1: r * 0.55, top: null });
        b.cylinder(p[0], p[2], r * 0.55, h * 0.85, h, 6, MAT.CREAM, { r1: r * 0.42, top: MAT.INTERIOR });
      });
      x -= 2 * r + 0.08;
    }
    return;
  }
  const s0 = rng.range(0.5, 0.7);
  if (u - s0 * 2 < 0.4) return;
  b.with({ tint: [0.95, 0.85, 0.7] }, () => {
    face.box(u - s0, G, u, G + s0, -s0 - 0.1, -0.1, MAT.WOOD, { skip: ['bottom'], back: true });
    face.box(u - 2 * s0 - 0.05, G, u - s0 - 0.05, G + s0, -s0 - 0.1, -0.1, MAT.WOOD, { skip: ['bottom'], back: true });
    if (rng.chance(0.6)) face.box(u - s0 * 1.5, G + s0 + 0.02, u - s0 * 0.55, G + s0 * 1.75, -s0 * 0.9 - 0.1, -0.15, MAT.WOOD, { back: true });
  });
}

/** a pair of painted shutters folded back beside a window */
function shutters(c: City, face: Face, op: Opening, sw: number, paint: V3) {
  c.b.with({ tint: paint }, () => {
    face.rect(op.u0 - sw - 0.04, op.v0, op.u0 - 0.04, op.top, -0.05, MAT.WOOD);
    face.rect(op.u1 + 0.04, op.v0, op.u1 + sw + 0.04, op.top, -0.05, MAT.WOOD);
  });
}

/** a balcony on brackets: slab, a solid rail, under a door-window at storey base `base` */
function balconyOn(c: City, face: Face, u: number, bw: number, base: number, st: Style) {
  const u0 = u - bw / 2, u1 = u + bw / 2, d = 0.95;
  face.box(u0, base - 0.18, u1, base + 0.06, -d, 0, st.trim);
  face.box(u0, base + 0.06, u1, base + 0.95, -d, -d + 0.1, st.wall, { top: st.trim, skip: ['bottom'] });
  face.box(u0, base + 0.06, u0 + 0.1, base + 0.95, -d + 0.1, 0, st.wall, { top: st.trim, skip: ['bottom'] });
  face.box(u1 - 0.1, base + 0.06, u1, base + 0.95, -d + 0.1, 0, st.wall, { top: st.trim, skip: ['bottom'] });
  // (on scrolled brackets, instanced: their backs on the wall, their tops under the slab)
  for (const x of [u0 + 0.25, u1 - 0.25]) onFace(c, face, 'bracket-scroll', x, base - 0.18, 0, { scale: 1.5, tint: st.trimTint });
}

/** a wooden oriel (a screened bay) on the first floor: its lattice front lit from inside at night */
function orielOn(c: City, face: Face, u: number, ow: number, base: number, st: Style, glow: number) {
  const u0 = u - ow / 2, u1 = u + ow / 2, v0 = base + 0.2, v1 = base + Math.min(st.sh - 0.3, 2.7), d = 0.75;
  face.box(u0, v0, u1, v1, -d, 0, MAT.WOOD, { skip: ['front'] });
  face.rect(u0, v0, u1, v1, -d, MAT.WOOD);
  c.b.with({ glow }, () => face.rect(u0 + 0.16, v0 + 0.3, u1 - 0.16, v1 - 0.25, -d - 0.01, MAT.WINDOW));
  for (let k = 1; k < 4; k++) {
    const x = u0 + 0.16 + ((ow - 0.32) * k) / 4;
    face.box(x - 0.025, v0 + 0.3, x + 0.025, v1 - 0.25, -d - 0.04, -d - 0.01, MAT.WOOD, { skip: ['bottom', 'top'] });
  }
  face.box(u0 - 0.08, v1, u1 + 0.08, v1 + 0.16, -d - 0.1, 0, st.trim);
  face.box(u0 + 0.1, v0 - 0.45, u1 - 0.1, v0, -d + 0.15, 0, MAT.WOOD, { skip: ['top'] });
}

/** an outside flight from the ground to the roof along a street face (not its door's), square to the frame, all of it on
 *  open ground */
function outsideStair(part: Part, other: Part | null, H: number, rng: Rng, open: (q: V2) => boolean, door: number): { edge: number; g0: number; g1: number; build: (c: City, col: Collide, st: Style) => void } | null {
  if (other && other.H > H) return null;
  const p = part.poly;
  const sw = 1.1, run = H * 1.2;
  for (let i = 0; i < p.length; i++) {
    // (on a street face, not a courtyard's: a courtyard is the neighbours' too, their doors and steps in it)
    if (i === part.cut || i === door || part.f[i] !== 2 || axisOf(p, i) === null) continue;
    const L = edgeLen(p, i);
    // (its landing well short of the face's far end: a door on the face beyond the corner keeps its step)
    if (L < run + sw + 2.0 || !rng.chance(0.2)) continue;
    const a = p[i], e = p[(i + 1) % p.length];
    const ax = axisOf(p, i)!;
    const [nx, nz] = outward(p, i);
    const dir = ax === 0 ? Math.sign(e[0] - a[0]) : Math.sign(e[1] - a[1]);
    const t0 = 0.4;
    const along = (t: number): V2 => [a[0] + ((e[0] - a[0]) * t) / L, a[1] + ((e[1] - a[1]) * t) / L];
    const off = sw / 2 + 0.1;
    const start = along(t0), top = along(t0 + run);
    // (all of it — the flight and its landing — on open ground: not into a neighbour's lot or garden)
    const out = (t: number, d: number): V2 => { const q = along(t); return [q[0] + nx * d, q[1] + nz * d]; };
    if (![t0, t0 + run / 2, t0 + run, t0 + run + sw].every((t) => open(out(t, 0.3)) && open(out(t, sw + 0.4)))) continue;
    return {
      edge: i, g0: t0 + run, g1: t0 + run + sw,
      build: (c, col, st) => {
        c.b.with({ tint: st.tint }, () => {
          flight(c, col, start[0] + nx * off, start[1] + nz * off, 0, run, H, sw, ax, dir as 1 | -1, st.wall, { foot: -G });
          // the landing at the top, level with the roof
          // (its far end PROUD short of the corner: there it lay in the taller block's wall)
          const l0 = top, l1 = along(t0 + run + sw - PROUD);
          const x0 = Math.min(l0[0], l1[0]), x1 = Math.max(l0[0], l1[0]), z0 = Math.min(l0[1], l1[1]), z1 = Math.max(l0[1], l1[1]);
          const bx0 = ax === 0 ? x0 : Math.min(x0, x0 + nx * (sw + 0.1)), bx1 = ax === 0 ? x1 : Math.max(x1, x1 + nx * (sw + 0.1));
          const bz0 = ax === 1 ? z0 : Math.min(z0, z0 + nz * (sw + 0.1)), bz1 = ax === 1 ? z1 : Math.max(z1, z1 + nz * (sw + 0.1));
          c.b.box(bx0, -G, bz0, bx1, H, bz1, st.wall, { top: MAT.PAVING, skip: ['bottom'] });
          col.solid(bx0, bz0, bx1, bz1, -G, H).floor(bx0, bz0, bx1, bz1, H);
        });
      },
    };
  }
  return null;
}

/** on the lower block's roof (a terrace), a flight up the taller block's wall to its roof */
function terraceStair(c: City, col: Collide, low: Part, high: Part, st: Style, rng: Rng) {
  const i = low.cut;
  if (i < 0) return;
  const p = low.poly, ax = axisOf(p, i);
  if (ax === null) return;
  const rise = high.H - low.H, run = rise * 1.25, sw = 1.0, L = edgeLen(p, i);
  if (L < run + 1.2 || !rng.chance(0.75)) return;
  const a = p[i], e = p[(i + 1) % p.length];
  const [nx, nz] = outward(p, i);
  const t0 = rng.chance(0.5) ? 0.5 : L - 0.5 - run;
  const dir = (ax === 0 ? Math.sign(e[0] - a[0]) : Math.sign(e[1] - a[1])) as 1 | -1;
  const s: V2 = [a[0] + ((e[0] - a[0]) * t0) / L, a[1] + ((e[1] - a[1]) * t0) / L];
  // (the terrace side of the cut is inward from the low block's cut edge)
  const off = -(sw / 2 + 0.32);
  c.b.with({ tint: st.tint }, () => flight(c, col, s[0] + nx * off, s[1] + nz * off, low.H, run, rise, sw, ax, dir, st.wall, { foot: low.H }));
}

/** what stands on a roof: a stair kiosk, a dome, a chimney turret, a pergola, a roof garden, a water tank */
function roofTop(c: City, col: Collide, part: Part, st: Style, rng: Rng, hasStair: boolean, terrace: boolean) {
  const b = c.b, p = part.poly, H = part.H;
  const [x0, z0, x1, z1] = bbox(p);
  // (inside the parapet; on a terrace, clear of the band along its cut where the stair up to the taller block stands)
  const within = insetPoly(p, 0.38);
  const cutLine = terrace && part.cut >= 0 ? { a: p[part.cut], e: p[(part.cut + 1) % p.length] } : null;
  const offCut = (q: V2) => {
    if (!cutLine) return true;
    const { a, e } = cutLine, L = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
    return Math.abs((q[0] - a[0]) * (e[1] - a[1]) - (q[1] - a[1]) * (e[0] - a[0])) / L > 2.6;
  };
  const fits = (r: number[]) => within.length >= 3 && [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]].every((q) => inside(q as V2, within) && offCut(q as V2));
  const used: number[][] = [];
  const free = (r: number[]) => fits(r) && used.every((u) => r[2] < u[0] || r[0] > u[2] || r[3] < u[1] || r[1] > u[3]);
  const corners = (s: number, m = 0.55): number[][] => [
    [x0 + m, z0 + m, x0 + m + s, z0 + m + s], [x1 - m - s, z0 + m, x1 - m, z0 + m + s], [x1 - m - s, z1 - m - s, x1 - m, z1 - m], [x0 + m, z1 - m - s, x0 + m + s, z1 - m],
  ];
  const minDim = Math.min(x1 - x0, z1 - z0);
  const tower = part.storeys >= 4 && (x1 - x0) * (z1 - z0) < 140;

  // a dome over the middle of a rich roof (always over a tower house's)
  if ((tower && rng.chance(0.6)) || (minDim > 6 && rng.chance(st.rich ? 0.2 : st.w > 0.35 ? 0.05 : 0.006))) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, r = Math.min(4.6, minDim * (tower ? 0.42 : 0.3));
    const sq = [cx - r * 1.15, cz - r * 1.15, cx + r * 1.15, cz + r * 1.15];
    if (fits(sq)) {
      const drum = tower ? r * 0.9 : r * rng.range(0.35, 0.8);
      if (r > 2.2) b.with({ tint: st.tint }, () => b.box(sq[0], H, sq[1], sq[2], H + 0.6, sq[3], st.wall, { top: MAT.CREAM, skip: ['bottom'] }));
      const y = H + (r > 2.2 ? 0.6 : 0);
      const o = { drum, bulge: rng.chance(0.4) ? 1.12 : 1, tip: rng.range(0.1, 0.5), drumMat: rng.chance(0.5) ? MAT.CREAM : st.wall, glaze: st.glaze };
      if (rng.chance(0.7)) domeWithFinial(c, cx, y, cz, r, o, rng); else dome(c, cx, y, cz, r, { ...o, finial: false });
      col.solid(cx - r * 0.75, cz - r * 0.75, cx + r * 0.75, cz + r * 0.75, H, y + drum + r * 0.8);
      used.push(sq);
    }
  }
  // the stair kiosk (the way up from inside), on most roofs of two storeys and more
  if (!hasStair && part.storeys >= 2 && rng.chance(0.5)) {
    const s = rng.range(2.3, 3.0);
    for (const r of rng.chance(0.5) ? corners(s) : corners(s).reverse()) {
      if (!free(r)) continue;
      const kh = 2.4;
      b.with({ tint: st.tint }, () => {
        b.box(r[0], H, r[1], r[2], H + kh, r[3], st.wall, { top: MAT.PAVING, skip: ['bottom'] });
        b.box(r[0] - 0.08, H + kh, r[1] - 0.08, r[2] + 0.08, H + kh + 0.25, r[3] + 0.08, st.w > 0.3 ? MAT.CREAM : st.wall);
      });
      // its door, facing the roof's middle
      const mx = (r[0] + r[2]) / 2, mz = (r[1] + r[3]) / 2, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const dx = cx - mx, dz = cz - mz;
      const f = Math.abs(dx) > Math.abs(dz)
        ? (dx > 0 ? new Face(b, [r[2], r[3]], [r[2], r[1]], H, kh) : new Face(b, [r[0], r[1]], [r[0], r[3]], H, kh))
        : (dz > 0 ? new Face(b, [r[0], r[3]], [r[2], r[3]], H, kh) : new Face(b, [r[2], r[1]], [r[0], r[1]], H, kh));
      b.with({ tint: rng.pick(PAINTS) }, () => f.rect(f.len / 2 - 0.45, 0, f.len / 2 + 0.45, 1.95, -0.02, MAT.WOOD));
      if (st.rich && rng.chance(0.12)) domeWithFinial(c, mx, H + kh + 0.25, mz, s * 0.42, { drum: 0.3, glaze: st.glaze }, rng);
      col.solid(r[0], r[1], r[2], r[3], H, H + kh + 0.25).floor(r[0], r[1], r[2], r[3], H + kh + 0.25);
      used.push(r);
      break;
    }
  }
  // a chimney turret with a domed cap at a corner of a rich roof
  if (st.w > 0.45 && rng.chance(st.rich ? 0.14 : 0.05)) {
    const hw = rng.range(0.8, 1.3);
    for (const r of corners(hw * 2, 0.2)) {
      if (!free(r)) continue;
      const h = rng.range(3.5, 7.5);
      const cap = rng.chance(0.5) ? { glaze: st.glaze } : { capMat: st.wall, glaze: st.tint };
      b.with({ tint: st.tint }, () => turret(c, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2, H, hw, h, st.wall, { round: rng.chance(0.3), ...cap }));
      col.solid(r[0], r[1], r[2], r[3], H, H + h + hw);
      used.push(r);
      break;
    }
  }
  // a pergola with a cloth over a corner of the terrace
  if (rng.chance(0.13)) {
    const sx = rng.range(3, 4.5), sz = rng.range(2.6, 3.6);
    for (const r0 of corners(Math.max(sx, sz))) {
      const r = [r0[0], r0[1], r0[0] + sx, r0[1] + sz];
      if (!free(r)) continue;
      const ph = 2.3;
      for (const [px, pz] of [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]) b.box(px - 0.07, H, pz - 0.07, px + 0.07, H + ph, pz + 0.07, MAT.WOOD, { skip: ['bottom'] });
      b.with({ tint: rng.pick(CLOTHS) }, () => {
        const q: V3[] = [[r[0] - 0.15, H + ph, r[1] - 0.15], [r[2] + 0.15, H + ph, r[1] - 0.15], [r[2] + 0.15, H + ph - 0.25, r[3] + 0.15], [r[0] - 0.15, H + ph - 0.25, r[3] + 0.15]];
        b.poly([q[3], q[2], q[1], q[0]], MAT.CLOTH);
        b.poly(q, MAT.CLOTH);
      });
      used.push(r);
      break;
    }
  }
  // a roof garden in planters along the parapet
  if (st.w > 0.4 && rng.chance(st.rich ? 0.3 : 0.1)) {
    const along = x1 - x0 > z1 - z0;
    const r = along ? [x0 + 0.6, z0 + 0.45, x1 - 0.6, z0 + 1.35] : [x0 + 0.45, z0 + 0.6, x0 + 1.35, z1 - 0.6];
    if (free(r) && (r[2] - r[0]) * (r[3] - r[1]) > 2) {
      b.box(r[0], H, r[1], r[2], H + 0.55, r[3], MAT.ASHLAR, { top: MAT.SOIL, skip: ['bottom'] });
      c.bed([[r[0] + 0.1, r[1] + 0.1], [r[2] - 0.1, r[1] + 0.1], [r[2] - 0.1, r[3] - 0.1], [r[0] + 0.1, r[3] - 0.1]], H + 0.55, rng.pick(['flowers', 'shrubs', 'vines'] as const), 0.8, rng.pick(['pink', 'mixed', 'white', 'purple'] as const));
      col.solid(r[0], r[1], r[2], r[3], H, H + 0.55);
      used.push(r);
    }
  }
  // a wind-catcher (a badgir: a slender square tower, slotted on its faces, to draw the breeze down into the house) on
  // a middling roof now and then
  if (st.w > 0.28 && st.w < 0.75 && part.storeys >= 2 && rng.chance(0.16)) {
    const hw = rng.range(0.7, 1.0), h = rng.range(3.2, 5.2);
    for (const r of rng.chance(0.5) ? corners(hw * 2, 0.6) : corners(hw * 2, 0.6).reverse()) {
      if (!free(r)) continue;
      const cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2;
      b.with({ tint: st.tint }, () => b.cappedBox(cx - hw, H, cz - hw, cx + hw, H + h, cz + hw, st.wall, { mat: st.trim, h: 0.22, out: 0.08 }));
      // (its slots: dark on each face, a little proud of it)
      for (const [L, R] of [[[cx - hw, cz + hw], [cx + hw, cz + hw]], [[cx + hw, cz - hw], [cx - hw, cz - hw]], [[cx + hw, cz + hw], [cx + hw, cz - hw]], [[cx - hw, cz - hw], [cx - hw, cz + hw]]] as [V2, V2][]) {
        const f = new Face(b, L, R, H, h);
        for (let k = 0; k < 2; k++) { const u = (f.len * (k + 1)) / 3; f.rect(u - 0.12, h - 1.6, u + 0.12, h - 0.45, -0.02, MAT.INTERIOR); }
      }
      col.solid(r[0], r[1], r[2], r[3], H, H + h);
      used.push(r);
      break;
    }
  }
  // a water tank on a humble roof
  if (st.w < 0.35 && rng.chance(0.14)) {
    for (const r of corners(1.6)) {
      if (!free(r)) continue;
      b.cylinder((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, 0.7, H, H + 1.5, 10, MAT.WOOD);
      col.solid(r[0], r[1], r[2], r[3], H, H + 1.5);
      used.push(r);
      break;
    }
  }
}

/** a convex outline moved in by d (geom.ts inset, its fronts kept) */
function insetPoly(p: V2[], d: number): V2[] {
  const q = inset({ p, f: p.map(() => 0 as Front) }, d).p;
  return q.length >= 3 ? q : [];
}

/** the parts of [0, L] outside the gaps */
function segments(L: number, gaps: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let u = 0;
  for (const [g0, g1] of [...gaps].sort((a, b) => a[0] - b[0])) {
    if (g0 > u + 0.05) out.push([u, Math.min(g0, L)]);
    u = Math.max(u, g1);
  }
  if (u < L - 0.05) out.push([u, L]);
  return out;
}

function edgeLen(p: V2[], i: number) { const a = p[i], b = p[(i + 1) % p.length]; return Math.hypot(b[0] - a[0], b[1] - a[1]); }

/** an edge's outward normal (the polygon has positive area) */
function outward(p: V2[], i: number): V2 {
  const a = p[i], b = p[(i + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
}

/** 0 if an edge runs along x, 1 along z, null if it slants */
function axisOf(p: V2[], i: number): 0 | 1 | null {
  const a = p[i], b = p[(i + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  if (Math.abs(b[1] - a[1]) < 0.02 * L) return 0;
  if (Math.abs(b[0] - a[0]) < 0.02 * L) return 1;
  return null;
}

/** how deep a polygon is behind one of its edges */
function depthAlong(p: V2[], i: number): number {
  const [nx, nz] = outward(p, i);
  const proj = p.map(([x, z]) => x * nx + z * nz);
  return Math.max(...proj) - Math.min(...proj);
}

/** the edge of a part that lies on the cut line n·p = s */
function findCut(p: V2[], nx: number, nz: number, s: number): number {
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    if (Math.abs(a[0] * nx + a[1] * nz - s) < 1e-3 && Math.abs(b[0] * nx + b[1] * nz - s) < 1e-3) return i;
  }
  return -1;
}

/** does a part's edge lie along one of the lot's courtyard edges */
function courtAt(q: Poly, i: number, lot: V2[], court: boolean[]): boolean {
  const a = q.p[i], b = q.p[(i + 1) % q.p.length], m: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  for (let j = 0; j < lot.length; j++) {
    if (!court[j]) continue;
    const u = lot[j], v = lot[(j + 1) % lot.length];
    const dx = v[0] - u[0], dz = v[1] - u[1], L2 = dx * dx + dz * dz;
    const t = ((m[0] - u[0]) * dx + (m[1] - u[1]) * dz) / L2;
    if (t < 0 || t > 1) continue;
    if (Math.hypot(u[0] + dx * t - m[0], u[1] + dz * t - m[1]) < 0.05) return true;
  }
  return false;
}
