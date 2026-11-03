// The houses that fill the lots, each built from its lot (a convex polygon in its block's frame), the edges it shows to a
// street, an alley, a grand front or a courtyard, and how rich its district is. A house is one block of 1–4 storeys or,
// on deeper lots, a front and a back block of different heights, the lower one's roof a terrace with a stair up to the
// higher. Street faces get a door, windows in columns over the storeys (flat, round or pointed by the house's style, lit
// at night or dark), shopfronts or a deep-arched arcade on the grand fronts, sills and surrounds, shutters, balconies and
// wooden oriels, awnings, banners and a lantern by the door; party walls stay blank. Roofs are flat behind parapets,
// with stair kiosks, pergolas, roof gardens, water tanks, blue domes and chimney turrets with domed caps. Every block is
// solid to walk into and floored on top, every parapet is a low wall, every stair is walked.
import type { Mat, V3 } from '../arch/types';
import { MAT } from '../arch/types';
import type { V2 } from '../world/layout';
import type { City, Collide } from './ctx';
import { Face, type Arch, type Opening } from './facade';
import { type Front, type Poly, area, bbox, clipHalf, inside, toWorld } from './geom';
import type { Lot } from './plan';
import { CLOTHS, GLAZES, PAINTS, awning, banner, dome, flight, merlons, turret, wallLantern } from './props';
import { Rng } from './rng';

/** foundations go this far below the floor */
const G = 2;

/** the heights of what's built, on a coarse grid of world plan cells: what lantern strings tie to */
export class Skyline {
  private cells = new Map<number, { p: V2[]; h: number }[]>();
  private readonly cell = 24;
  add(p: V2[], h: number) {
    const [x0, z0, x1, z1] = bbox(p), c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
      const k = i * 4096 + j;
      let l = this.cells.get(k);
      if (!l) this.cells.set(k, (l = []));
      l.push({ p, h });
    }
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
  /** the roof's surface: plastered like the walls, or paved as a terrace */
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

  for (const [k, part] of parts.entries()) {
    buildPart(c, col, part, parts[1 - k] ?? null, st, rng);
    sky.add(part.poly.map((q) => toWorld(q, frame.o, frame.yaw)), part.H);
  }
}

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
    roof: rng.chance(0.45) ? MAT.PAVING : wall,
    glaze: rng.weighted(GLAZES, [5, 3, 2]),
    trim: w > 0.3 ? MAT.CREAM : MAT.PLASTER,
    trimTint: w > 0.3 ? [1, 1, 1] : [0.86, 0.82, 0.8],
    roofTint: [0.86 + rng.range(-0.08, 0.1), 0.8 + rng.range(-0.08, 0.08), 0.78 + rng.range(-0.08, 0.08)],
    gh: sh + 0.3 + w * 0.6,
    sh,
    arch: rich ? rng.weighted<Arch>(['round', 'pointed', 'flat'], [5, 3, 2]) : w > 0.3 ? rng.weighted<Arch>(['round', 'flat', 'pointed'], [4, 5, 1]) : rng.weighted<Arch>(['flat', 'round'], [8, 2]),
    winW: 0.8 + w * 0.55 + rng.range(-0.05, 0.15),
    winH: 1.35 + w * 0.9 + rng.range(-0.1, 0.2),
    spacing: 2.9 + rng.range(0, 1.1) + w * 0.4,
    shutters: w > 0.2 && w < 0.8 && rng.chance(0.35) ? rng.pick(PAINTS) : null,
    frames: w > 0.35 && rng.chance(0.4 + w * 0.5),
  };
}

function buildPart(c: City, col: Collide, part: Part, other: Part | null, st: Style, rng: Rng) {
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
      if (shown && st.w > 0.4) face.box(0, 0, face.len, G + 0.55, -0.07, 0, MAT.ASHLAR, { skip: ['left', 'right', 'bottom'] });
      if (shown && st.w > 0.3) {
        face.box(-0.2, G + H - 0.28, face.len + 0.2, G + H + 0.04, -0.2, 0, st.trim, { skip: ['left', 'right'] });
        if (st.rich) for (let k = 1; k < part.storeys; k++) {
          const v = G + st.gh + (k - 1) * st.sh;
          face.box(0, v - 0.08, face.len, v + 0.08, -0.06, 0, st.trim, { skip: ['left', 'right', 'bottom'] });
        }
      }
      for (const d of decor) d();
    }
  });

  // the roof: walked on, behind a parapet that is a low wall (a gap where an outside stair arrives)
  b.with({ tint: st.roofTint }, () => b.slab(p, H, st.roof));
  col.polySolid(p, -G, H).polyFloor(p, H);
  const stair = outsideStair(part, other, H, rng);
  b.with({ tint: st.tint }, () => {
    for (let i = 0; i < p.length; i++) {
      // (none along the cut under a taller block's wall; a low coping, stepped over, along it above a lower one)
      if (i === part.cut && lower === null) continue;
      const face = new Face(b, p[(i + 1) % p.length], p[i], H, pH);
      if (face.len < 0.3) continue;
      const h = i === part.cut ? 0.3 : pH;
      const gaps: [number, number][] = stair && stair.edge === i ? [[face.len - stair.g1, face.len - stair.g0]] : [];
      const segs = segments(face.len, gaps);
      for (const [u0, u1] of segs) {
        const skip: ('left' | 'right' | 'bottom')[] = ['bottom'];
        if (u0 < 1e-3) skip.push('left');
        if (u1 > face.len - 1e-3) skip.push('right');
        face.box(u0, 0, u1, h, 0, 0.3, st.wall, { back: true, top: st.w > 0.3 ? MAT.CREAM : st.wall, skip });
        const q = [face.at(u0, 0), face.at(u1, 0), face.at(u1, 0, 0.3), face.at(u0, 0, 0.3)].map((v) => [v[0], v[2]] as V2);
        col.polySolid(q, H, H + h, 1.0);
      }
      if (st.rich && part.f[i] >= 2 && i !== part.cut && rng.chance(0.5)) for (const [u0, u1] of segs) merlons(face, u0, u1, h, 0.5, 0.42, 0.42, 0.3, st.wall);
    }
  });
  if (stair) stair.build(c, col, st);
  if (lower !== null && other) terraceStair(c, col, other, part, st, rng);
  roofTop(c, col, part, st, rng, !!stair);
  if (st.w > 0.5 && rng.chance(0.3)) cornerTower(c, col, part, st, rng);
}

/** a round tower engaged at a corner where two street fronts meet, rising past the parapet to a dome or merlons */
function cornerTower(c: City, col: Collide, part: Part, st: Style, rng: Rng) {
  const b = c.b, p = part.poly, n = p.length;
  for (let i = 0; i < n; i++) {
    const prev = (i + n - 1) % n;
    if (part.f[i] < 2 || part.f[prev] < 2 || i === part.cut || prev === part.cut) continue;
    const [ax, az] = outward(p, prev), [bx, bz] = outward(p, i);
    if (Math.abs(ax * bx + az * bz) > 0.3) continue;
    const r = rng.range(1.8, 2.6), h = part.H + rng.range(2.5, 6);
    // (its centre a little inside the corner, so it bulges out of both fronts)
    const cx = p[i][0] - (ax + bx) * r * 0.35, cz = p[i][1] - (az + bz) * r * 0.35;
    b.with({ tint: st.tint }, () => b.cylinder(cx, cz, r, -G, h, 12, st.wall, { top: MAT.PAVING }));
    b.cylinder(cx, cz, r + 0.12, h - 0.4, h, 12, MAT.CREAM);
    for (const v of [part.H - 2.6, part.H + 0.6]) {
      if (v + 1.6 > h - 0.6) continue;
      for (let k = 0; k < 3; k++) {
        const a = Math.atan2(ax + bz * (k - 1) * 0.9 + bx, az - bx * (k - 1) * 0.9 + bz) ;
        const dx = Math.sin(a), dz = Math.cos(a), tx = dz * 0.32, tz = -dx * 0.32;
        const q = (s: number, y: number): V3 => [cx + dx * (r + 0.015) + tx * s, y, cz + dz * (r + 0.015) + tz * s];
        b.with({ glow: rng.chance(0.6) ? 0.8 : 0 }, () => b.poly([q(-1, v), q(1, v), q(1, v + 1.6), q(-1, v + 1.6)].reverse(), MAT.WINDOW));
      }
    }
    if (rng.chance(0.6)) dome(c, cx, h, cz, r * 0.95, { drum: 0.4, bulge: 1.1, tip: 0.6, finial: true, glaze: st.glaze });
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

/** the openings on one face and what hangs on it (run after the wall is laid) */
function openings(c: City, face: Face, part: Part, isMain: boolean, front: Front, court: boolean, st: Style, rng: Rng): { ops: Opening[]; decor: (() => void)[] } {
  const ops: Opening[] = [], decor: (() => void)[] = [];
  const L = face.len, w = st.w;
  if (L < 2.2) return { ops, decor };
  const lit = () => (rng.chance(0.62) ? rng.range(0.45, 1) : 0);
  const spacing = front >= 2 ? st.spacing : st.spacing * 1.35;
  // windows on alleys, courtyards and humble houses lie flush (no hole): the streets get the deep ones
  const deep = (d: number) => (front >= 2 && w > 0.18 ? d : 0);
  const m = Math.max(1, Math.min(14, Math.floor((L - 0.6) / spacing)));
  const us = Array.from({ length: m }, (_, i) => (L * (i + 0.5)) / m);
  const ww = Math.min(st.winW * (front >= 2 ? 1 : 0.8), L / m - 0.9);
  if (ww < 0.5) return { ops, decor };
  const framed = (o: Opening): Opening => (st.frames && front >= 2 ? { ...o, frame: st.trim, frameW: 0.16, frameTint: st.trimTint } : o);

  // the ground floor: the door on the main front, an arcade on the grand fronts, shopfronts on the busy streets
  const doorAt = isMain ? Math.floor(m / 2) : court && rng.chance(0.4) ? rng.int(0, m - 1) : -1;
  const arcade = front === 3 && w > 0.55 && L > 7 && isMain && rng.chance(0.7);
  const shops = !arcade && front >= 2 && isMain && w > 0.25 && w < 0.85 && rng.chance(0.5);
  for (let i = 0; i < m; i++) {
    const u = us[i];
    if (arcade) {
      const aw = Math.min(L / m - 0.8, 2.8);
      ops.push({ u0: u - aw / 2, u1: u + aw / 2, v0: G, top: G + Math.min(st.gh - 0.4, 3.0 + aw * 0.5), arch: st.arch === 'flat' ? 'round' : st.arch, depth: 1.6, fill: MAT.INTERIOR, glow: rng.chance(0.7) ? rng.range(0.3, 0.7) : 0, frame: MAT.CREAM, frameW: 0.22 });
      if (i === doorAt) decor.push(() => wallLantern(c, face, u + aw / 2 + 0.45, G + 2.9, 60));
      continue;
    }
    if (i === doorAt) {
      const dw = Math.min(L / m - 0.6, isMain ? 1.4 + w * 1.0 : 1.2);
      const arch: Arch = w > 0.3 || rng.chance(0.4) ? (st.arch === 'flat' ? 'round' : st.arch) : 'flat';
      const dh = Math.min(st.gh - 0.5, 2.3 + w * 1.1 + (arch === 'flat' ? 0 : dw * 0.4));
      const op: Opening = { u0: u - dw / 2, u1: u + dw / 2, v0: G, top: G + dh, arch, depth: 0.45, fill: MAT.WOOD, fillTint: rng.pick(PAINTS) };
      ops.push(w > 0.3 ? { ...op, frame: st.trim, frameW: 0.22, frameTint: st.trimTint } : op);
      decor.push(() => {
        face.box(u - dw / 2 - 0.25, G - 0.1, u + dw / 2 + 0.25, G + 0.15, -0.5, 0, MAT.ASHLAR, { skip: ['bottom'] });
        if (front >= 2 || rng.chance(0.6)) {
          const v = G + Math.min(dh + 0.1, st.gh - 0.4);
          wallLantern(c, face, u + dw / 2 + 0.55, v, w > 0.45 || rng.chance(0.5) ? 55 : 0);
        }
        if (!st.rich && rng.chance(0.3)) awning(c, face, u - dw / 2 - 0.4, u + dw / 2 + 0.4, G + dh + 0.45, 1.1, 0.45, rng.pick(CLOTHS));
        // potted plants either side of the door now and then
        if (rng.chance(0.35)) for (const du of rng.chance(0.5) ? [-1, 1] : [rng.chance(0.5) ? -1 : 1]) {
          const p = face.at(u + du * (dw / 2 + 0.55), G, -0.45), r = rng.range(0.26, 0.38);
          c.b.cylinder(p[0], p[2], r, 0, r * 1.9, 8, MAT.PLASTER, { r1: r * 1.25, top: MAT.SOIL });
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
        decor.push(() => balconyOn(face, u, dw + 1.2, base, st));
        continue;
      }
      const op = framed({ u0: u - ww / 2, u1: u + ww / 2, v0: base + 0.85, top: base + 0.85 + wh, arch: st.arch, depth: deep(0.28), fill: MAT.WINDOW, glow: lit() });
      ops.push(op);
      decor.push(() => {
        if (w > 0.2 && front >= 2) face.box(op.u0 - 0.12, op.v0 - 0.12, op.u1 + 0.12, op.v0, -0.14, 0, st.trim, { skip: ['left', 'right'] });
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

/** a pair of painted shutters folded back beside a window */
function shutters(c: City, face: Face, op: Opening, sw: number, paint: V3) {
  c.b.with({ tint: paint }, () => {
    face.rect(op.u0 - sw - 0.04, op.v0, op.u0 - 0.04, op.top, -0.05, MAT.WOOD);
    face.rect(op.u1 + 0.04, op.v0, op.u1 + sw + 0.04, op.top, -0.05, MAT.WOOD);
  });
}

/** a balcony on brackets: slab, a solid rail, under a door-window at storey base `base` */
function balconyOn(face: Face, u: number, bw: number, base: number, st: Style) {
  const u0 = u - bw / 2, u1 = u + bw / 2, d = 0.95;
  face.box(u0, base - 0.18, u1, base + 0.06, -d, 0, st.trim);
  face.box(u0, base + 0.06, u1, base + 0.95, -d, -d + 0.1, st.wall, { top: st.trim, skip: ['bottom'] });
  face.box(u0, base + 0.06, u0 + 0.1, base + 0.95, -d + 0.1, 0, st.wall, { top: st.trim, skip: ['bottom'] });
  face.box(u1 - 0.1, base + 0.06, u1, base + 0.95, -d + 0.1, 0, st.wall, { top: st.trim, skip: ['bottom'] });
  for (const x of [u0 + 0.15, u1 - 0.35]) face.box(x, base - 0.6, x + 0.2, base - 0.18, -0.6, 0, st.trim, { skip: ['top'] });
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

/** an outside flight from the ground to the roof along a courtyard face or a wide street face, square to the frame */
function outsideStair(part: Part, other: Part | null, H: number, rng: Rng): { edge: number; g0: number; g1: number; build: (c: City, col: Collide, st: Style) => void } | null {
  if (other && other.H > H) return null;
  const p = part.poly;
  const sw = 1.1, run = H * 1.2;
  for (let i = 0; i < p.length; i++) {
    if (i === part.cut || !(part.court[i] || part.f[i] === 2) || axisOf(p, i) === null) continue;
    const L = edgeLen(p, i);
    if (L < run + sw + 0.9 || !rng.chance(part.court[i] ? 0.45 : 0.12)) continue;
    const a = p[i], e = p[(i + 1) % p.length];
    const ax = axisOf(p, i)!;
    const [nx, nz] = outward(p, i);
    const dir = ax === 0 ? Math.sign(e[0] - a[0]) : Math.sign(e[1] - a[1]);
    const t0 = 0.4;
    const along = (t: number): V2 => [a[0] + ((e[0] - a[0]) * t) / L, a[1] + ((e[1] - a[1]) * t) / L];
    const off = sw / 2 + 0.02;
    const start = along(t0), top = along(t0 + run);
    return {
      edge: i, g0: t0 + run, g1: t0 + run + sw,
      build: (c, col, st) => {
        c.b.with({ tint: st.tint }, () => {
          flight(c, col, start[0] + nx * off, start[1] + nz * off, 0, run, H, sw, ax, dir as 1 | -1, st.wall, { foot: -G });
          // the landing at the top, level with the roof
          const l0 = top, l1 = along(t0 + run + sw);
          const x0 = Math.min(l0[0], l1[0]), x1 = Math.max(l0[0], l1[0]), z0 = Math.min(l0[1], l1[1]), z1 = Math.max(l0[1], l1[1]);
          const bx0 = ax === 0 ? x0 : Math.min(x0, x0 + nx * (sw + 0.02)), bx1 = ax === 0 ? x1 : Math.max(x1, x1 + nx * (sw + 0.02));
          const bz0 = ax === 1 ? z0 : Math.min(z0, z0 + nz * (sw + 0.02)), bz1 = ax === 1 ? z1 : Math.max(z1, z1 + nz * (sw + 0.02));
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
function roofTop(c: City, col: Collide, part: Part, st: Style, rng: Rng, hasStair: boolean) {
  const b = c.b, p = part.poly, H = part.H;
  const [x0, z0, x1, z1] = bbox(p);
  const fits = (r: number[]) => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]].every((q) => inside(q as V2, p));
  const used: number[][] = [];
  const free = (r: number[]) => fits(r) && used.every((u) => r[2] < u[0] || r[0] > u[2] || r[3] < u[1] || r[1] > u[3]);
  const corners = (s: number, m = 0.55): number[][] => [
    [x0 + m, z0 + m, x0 + m + s, z0 + m + s], [x1 - m - s, z0 + m, x1 - m, z0 + m + s], [x1 - m - s, z1 - m - s, x1 - m, z1 - m], [x0 + m, z1 - m - s, x0 + m + s, z1 - m],
  ];
  const minDim = Math.min(x1 - x0, z1 - z0);
  const tower = part.storeys >= 4 && (x1 - x0) * (z1 - z0) < 140;

  // a dome over the middle of a rich roof (always over a tower house's)
  if ((tower && rng.chance(0.6)) || (minDim > 6 && rng.chance(st.rich ? 0.12 : st.w > 0.35 ? 0.03 : 0.006))) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, r = Math.min(4.6, minDim * (tower ? 0.42 : 0.3));
    const sq = [cx - r * 1.15, cz - r * 1.15, cx + r * 1.15, cz + r * 1.15];
    if (fits(sq)) {
      const drum = tower ? r * 0.9 : r * rng.range(0.35, 0.8);
      if (r > 2.2) b.with({ tint: st.tint }, () => b.box(sq[0], H, sq[1], sq[2], H + 0.6, sq[3], st.wall, { top: MAT.CREAM, skip: ['bottom'] }));
      const y = H + (r > 2.2 ? 0.6 : 0);
      dome(c, cx, y, cz, r, { drum, bulge: rng.chance(0.4) ? 1.12 : 1, tip: rng.range(0.1, 0.5), finial: rng.chance(0.7), drumMat: rng.chance(0.5) ? MAT.CREAM : st.wall, glaze: st.glaze });
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
      if (st.rich && rng.chance(0.12)) dome(c, mx, H + kh + 0.25, mz, s * 0.42, { drum: 0.3, finial: true, glaze: st.glaze });
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
