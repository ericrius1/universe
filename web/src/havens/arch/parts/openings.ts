// What fills a wall's openings: windows, doors and the grand portals, and the grilles set in them. Each is laid on its
// wall's face in the face's frame — x along the wall from the opening's middle, y up from its sill (a door's
// threshold), z out of the wall (its face at z 0) — and hands back the hole it wants left in the wall (Laid.hole: its
// outline in (x, y); arches.ts pierced() leaves such holes, as city/facade.ts's Face does its own): it lays its own
// reveal (jambs, head or soffit, sill) back to its depth and what fills it there. With depth 0 there's no hole: the
// glass or the leaf stands PROUD on the wall (far and humble faces).
//   windowPart  'plain' (a sill, a lintel), 'shuttered' (and two louvred shutters open flat to the wall), 'latticed'
//               (a wooden surround, a grille of diamonds before the glass), 'arched' (an archivolt carried down the
//               jambs); any of them under an arch of arches.ts's ('flat' for the square-headed); lit at night by `lit`
//   door        'plank' (iron straps and studs), 'panelled' (two leaves of raised panels), 'lattice' (the gold lattice
//               doors, MAT.LATTICE, in a palette); a fanlight over it, a surround, a step before it
//   portal      the grand entrance (ref 1's hall door): a deep arch with lattice doors, an archivolt of red and cream
//               voussoirs down to the ground, the spandrels a tile field in a frame of tile border (an alfiz), a
//               cornice over it crested with merlons, steps before it, lanterns either side
//   grille      a lattice of bars in a rectangle ('diamond', 'square', 'bars'): its two directions of bars a PROUD step
//               apart where they cross; by the thousand, instanced
import type { ArchBuilder } from '../builder';
import { MAT, TILE_PAL, type LightSpot, type Mat, type V3 } from '../types';
import type { V2 } from '../../world/layout';
import { archCurve, archivolt, segsFor, soffitOf, type ArchKind, type Curve, type CurveOpts } from './arches';
import { begin, byDetail, PAINTS, PROUD, proud, rectOn, region, lightAt, type Detail, type Laid, type PartOpts } from './kit';
import { lantern } from './lanterns';
import { merlon } from './roofs';

/** an opening's shape: its arch's curve (none for a square head), its spring (the jambs' top), its outline (from the
 *  sill's left end round by the right jamb, over the arch, down the left) */
export interface Shape { curve: Curve | null; ys: number; hole: V2[] }

/** the shape of an opening w wide and h high (to its crown), under an arch */
export function shapeOf(w: number, h: number, arch: ArchKind, segs: number, curve?: CurveOpts): Shape {
  if (arch === 'flat') return { curve: null, ys: h, hole: [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]] };
  const c = archCurve(arch, w, segs, 0, curve), ys = Math.max(0.1, h - c.crown);
  const hole: V2[] = [[-w / 2, 0], [w / 2, 0]];
  for (let k = c.pts.length - 1; k >= 0; k--) hole.push([c.pts[k][0], ys + c.pts[k][1]]);
  return { curve: c, ys, hole };
}

/** an opening's reveal between z0 (its mouth) and z1 (its back): the jambs, the head (or the arch's soffit), the sill
 *  (none for sill null) */
export function reveal(b: ArchBuilder, w: number, sh: Shape, z0: number, z1: number, wall: Mat, sill: Mat | null, head: Mat = wall) {
  const x = w / 2;
  rectOn(b, z1, 0, z0, sh.ys, [-x, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0], wall, [0, 0, -1]);
  rectOn(b, z1, 0, z0, sh.ys, [x, 0, 0], [0, 0, 1], [0, 1, 0], [-1, 0, 0], wall);
  if (sh.curve) soffitOf(b, sh.curve, 0, sh.ys, z0, z1, head);
  else rectOn(b, -x, z1, x, z0, [0, sh.ys, 0], [1, 0, 0], [0, 0, 1], [0, -1, 0], head);
  if (sill !== null) rectOn(b, -x, z1, x, z0, [0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0], sill);
}

/** a flat outline (x, y) laid at depth z facing out of the wall */
export function fillAt(b: ArchBuilder, pts: V2[], z: number, mat: Mat) {
  region(b, pts, [0, 0, z], [1, 0, 0], [0, 1, 0], [0, 0, 1], mat);
}

/** a surround standing out of the face it's on (z0) to z1, `fw` wide: down both jambs from the sill and over the head
 *  (a band across a square one, an archivolt round an arch: `alt` its every other voussoir) */
function surround(b: ArchBuilder, w: number, sh: Shape, fw: number, z1: number, mat: Mat, z0 = 0, alt?: Mat) {
  const x = w / 2;
  if (!sh.curve) {
    proud(b, -x - fw, 0, -x, sh.ys, z1, mat, ['top', 'bottom'], z0);
    proud(b, x, 0, x + fw, sh.ys, z1, mat, ['top', 'bottom'], z0);
    proud(b, -x - fw, sh.ys, x + fw, sh.ys + fw, z1, mat, [], z0);
    return;
  }
  const c = sh.curve, kind = curveKind(c);
  const e = kind ? archCurve(kind.k, w, c.pts.length - 1, fw, kind.o) : c;
  // the jambs' strips up to where the archivolt's outer edge springs (a horseshoe's below the jambs' tops: there its
  // feet close it, over the strips' tops), the archivolt over them
  const yq = Math.min(sh.ys, sh.ys + e.pts[0][1]), low = yq < sh.ys - 1e-4;
  proud(b, -x - fw, 0, -x, yq, z1, mat, ['bottom', ...(low ? [] : ['top'])], z0);
  proud(b, x, 0, x + fw, yq, z1, mat, ['bottom', ...(low ? [] : ['top'])], z0);
  archivolt(b, c, e, 0, sh.ys, z0, z1, mat, alt, 2, low);
}

/** the kind an opening's curve was made as (kept beside it: archCurve's extrados must be made the same way) */
const kinds = new WeakMap<Curve, { k: ArchKind; o?: CurveOpts }>();
function curveKind(c: Curve) { return kinds.get(c); }
function shapeKind(w: number, h: number, arch: ArchKind, segs: number, curve?: CurveOpts): Shape {
  const s = shapeOf(w, h, arch, segs, curve);
  if (s.curve) kinds.set(s.curve, { k: arch, o: curve });
  return s;
}

export type WindowKind = 'plain' | 'shuttered' | 'latticed' | 'arched';

export interface WindowOpts extends PartOpts {
  /** the opening's width and its height (to an arch's crown) */
  w?: number;
  h?: number;
  kind?: WindowKind;
  /** its head ('flat' but for 'arched': 'round') */
  arch?: ArchKind;
  curve?: CurveOpts;
  /** how far in the glass sits (0.22; 0: no hole, the glass on the wall) */
  depth?: number;
  /** its glow at night (0 dark .. 1; by the seed if not given: six in ten lit) */
  lit?: number;
  /** a light it spills before it (candela at full glow; 0 none) */
  spill?: number;
  /** the shutters' paint (by the seed if not given) */
  paint?: V3;
  /** the sill's, the lintel's and the surround's (cream); the reveal's (the wall's: terracotta plaster) */
  trim?: Mat;
  wall?: Mat;
  /** a grille before the glass ('latticed': diamonds), and its material (dark wood) */
  grille?: GrilleKind | null;
  grilleMat?: Mat;
}

/** a window (see the header) */
export function windowPart(b: ArchBuilder, o: WindowOpts = {}): Laid {
  return b.owner('window', () => {
    const { d, rng } = begin(o);
    const kind = o.kind ?? 'shuttered', w = o.w ?? 1.0, h = o.h ?? 1.6;
    const arch: ArchKind = o.arch ?? (kind === 'arched' ? 'round' : 'flat');
    const depth = o.depth ?? 0.22, trim = o.trim ?? MAT.CREAM, wall = o.wall ?? MAT.PLASTER;
    const lit = o.lit ?? (rng.chance(0.6) ? rng.range(0.5, 1) : 0);
    const sh = shapeKind(w, h, arch, segsFor(d, w), o.curve);
    const lights = o.spill && lit > 0 ? [lightAt(b, [0, -0.1, 1.2], o.spill * lit, { radius: 6 })] : [];
    // the glass, set in by the depth behind its reveal (or on the wall)
    const zg = depth > 0 ? -depth : PROUD;
    if (depth > 0) reveal(b, w, sh, 0, -depth, wall, trim);
    b.with({ glow: lit }, () => fillAt(b, sh.hole, zg, MAT.WINDOW));
    const grille = o.grille !== undefined ? o.grille : kind === 'latticed' ? 'diamond' : null;
    if (grille && d !== 'far') b.group(() => {
      b.at(0, 0, zg + 0.012);
      grillePart(b, { w, h: sh.ys, kind: grille, mat: o.grilleMat ?? MAT.WOOD, detail: d, tint: [0.55, 0.42, 0.36], seed: o.seed });
    });
    if (d === 'far') {
      // (the shutters' colour carries far: flat on the wall)
      if (kind === 'shuttered') b.with({ tint: o.paint ?? rng.pick(PAINTS) }, () => {
        for (const s of [-1, 1]) b.quad([s < 0 ? -w : w / 2 + 0.04, 0.02, PROUD], [s < 0 ? -w / 2 - 0.04 : w, 0.02, PROUD], [s < 0 ? -w / 2 - 0.04 : w, sh.ys - 0.02, PROUD], [s < 0 ? -w : w / 2 + 0.04, sh.ys - 0.02, PROUD], MAT.WOOD);
      });
      return { lights, top: h, hole: depth > 0 ? sh.hole : undefined };
    }
    // the sill, a slab on a corbelled strip (near)
    const sx = w / 2 + 0.16;
    proud(b, -sx, -0.07, sx, 0, 0.15, trim);
    if (d === 'near') proud(b, -w / 2 + 0.02, -0.16, w / 2 - 0.02, -0.07, 0.08, trim, ['top']);
    // the head: a lintel under a cornice, or a surround down the jambs and round the arch
    const surr = kind === 'arched' || kind === 'latticed' || !!sh.curve;
    let top = h;
    if (surr) {
      const fw = kind === 'latticed' ? 0.1 : 0.12;
      surround(b, w, sh, fw, 0.05, kind === 'latticed' ? MAT.WOOD : trim);
      top = h + fw;
    } else if (d === 'near') {
      proud(b, -w / 2 - 0.12, h, w / 2 + 0.12, h + 0.18, 0.06, trim, ['top']);
      proud(b, -w / 2 - 0.18, h + 0.18, w / 2 + 0.18, h + 0.27, 0.11, trim);
      top = h + 0.27;
    } else { proud(b, -w / 2 - 0.12, h, w / 2 + 0.12, h + 0.18, 0.06, trim); top = h + 0.18; }
    if (kind === 'shuttered') {
      const paint = o.paint ?? rng.pick(PAINTS), gap = surr ? 0.14 : 0.04, sw = w / 2;
      b.with({ tint: paint }, () => {
        shutter(b, -w / 2 - gap - sw, -w / 2 - gap, 0.02, sh.ys - 0.02, d, rng.chance(0.5));
        shutter(b, w / 2 + gap, w / 2 + gap + sw, 0.02, sh.ys - 0.02, d, rng.chance(0.5));
      });
    }
    return { lights, top, hole: depth > 0 ? sh.hole : undefined };
  });
}

/** a shutter opened flat to the wall from x0 to x1, y0 to y1: near, stiles and rails round louvres over a panel; mid a
 *  board */
function shutter(b: ArchBuilder, x0: number, x1: number, y0: number, y1: number, d: Detail, slats: boolean) {
  const t = 0.05, s = 0.06;
  if (d !== 'near') { proud(b, x0, y0, x1, y1, 0.045, MAT.WOOD); return; }
  proud(b, x0, y0, x0 + s, y1, t, MAT.WOOD);
  proud(b, x1 - s, y0, x1, y1, t, MAT.WOOD);
  const rail = (ya: number, yb: number) => proud(b, x0 + s, ya, x1 - s, yb, t, MAT.WOOD, ['e', 'w']);
  const ym = (y0 + y1) / 2;
  rail(y0, y0 + s); rail(y1 - s, y1); rail(ym - s / 2, ym + s / 2);
  // the panels set back, the louvres (or a plain board) on them
  for (const [ya, yb] of [[y0 + s, ym - s / 2], [ym + s / 2, y1 - s]]) {
    b.quad([x0 + s, ya, 0.02], [x1 - s, ya, 0.02], [x1 - s, yb, 0.02], [x0 + s, yb, 0.02], MAT.WOOD);
    if (!slats) continue;
    const n = Math.max(2, Math.floor((yb - ya) / 0.085));
    for (let k = 0; k < n; k++) {
      const yc = ya + ((k + 0.5) / n) * (yb - ya);
      b.box(x0 + s, yc - 0.022, 0.02, x1 - s, yc + 0.022, 0.044, MAT.WOOD, { skip: ['n', 'e', 'w'] });
    }
  }
}

export type DoorKind = 'plank' | 'panelled' | 'lattice';

export interface DoorOpts extends PartOpts {
  w?: number;
  h?: number;
  kind?: DoorKind;
  arch?: ArchKind;
  curve?: CurveOpts;
  /** how far in the leaf sits (0.3) */
  depth?: number;
  /** the leaves' paint, a lattice door's palette (types.ts TILE_PAL) */
  paint?: V3;
  pal?: number;
  trim?: Mat;
  wall?: Mat;
  /** a glazed fanlight over the leaves (lit at night) */
  fanlight?: boolean;
  lit?: number;
  /** a surround (true) */
  frame?: boolean;
  /** a step before it, its top at the threshold, this tall (0.16; 0: none) */
  step?: number;
}

/** a door (see the header) */
export function door(b: ArchBuilder, o: DoorOpts = {}): Laid {
  return b.owner('door', () => {
    const { d, rng } = begin(o);
    const kind = o.kind ?? 'plank', w = o.w ?? (kind === 'plank' ? 1.2 : 1.6), h = o.h ?? (kind === 'plank' ? 2.4 : 2.9);
    const arch = o.arch ?? 'flat', depth = o.depth ?? 0.3, trim = o.trim ?? MAT.CREAM, wall = o.wall ?? MAT.PLASTER;
    const sh = shapeKind(w, h, arch, segsFor(d, w), o.curve);
    const paint = o.paint ?? rng.pick(PAINTS), pal = o.pal ?? TILE_PAL.HOUSE;
    const zl = depth > 0 ? -depth : PROUD;
    if (depth > 0) reveal(b, w, sh, 0, -depth, wall, MAT.PAVING, wall);
    // the leaves (and the fanlight over them, behind a transom)
    const fan = o.fanlight ?? (arch !== 'flat' && kind !== 'lattice');
    let leaf: V2[] = sh.hole;
    if (fan) {
      const tb = 0.08, lit = o.lit ?? (rng.chance(0.7) ? 0.7 : 0);
      const yt = arch === 'flat' ? h - Math.min(0.55, h * 0.2) : sh.ys;
      leaf = [[-w / 2, 0], [w / 2, 0], [w / 2, yt - tb], [-w / 2, yt - tb]];
      const glass: V2[] = arch === 'flat' ? [[-w / 2, yt], [w / 2, yt], [w / 2, h], [-w / 2, h]] : sh.hole.slice(2).map(([x, y]) => [x, Math.max(y, yt)] as V2);
      b.with({ glow: lit }, () => fillAt(b, glass, zl, MAT.WINDOW));
      b.box(-w / 2, yt - tb, zl, w / 2, yt, zl + 0.07, MAT.WOOD, { skip: ['n', 'e', 'w'] });
    }
    if (kind === 'lattice') b.with({ pal }, () => fillAt(b, leaf, zl, MAT.LATTICE));
    else b.with({ tint: paint }, () => {
      fillAt(b, leaf, zl, MAT.WOOD);
      if (d === 'far') return;
      const top = fan ? leaf[2][1] : sh.ys;
      if (kind === 'plank') {
        // iron straps across, studs in rows (near), a gold ring
        b.with({ tint: [0.32, 0.28, 0.27] }, () => {
          for (const t of [0.18, 0.78]) proud(b, -w / 2, top * t - 0.04, w / 2, top * t + 0.04, zl + 0.025, MAT.WOOD, ['e', 'w'], zl);
          if (d === 'near') for (const t of [0.42, 0.56]) for (let k = 0; k < 5; k++) {
            const x = -w / 2 + ((k + 0.5) / 5) * w, y = top * t;
            b.box(x - 0.022, y - 0.022, zl, x + 0.022, y + 0.022, zl + 0.03, MAT.WOOD, { skip: ['n'] });
          }
        });
        b.box(w / 2 - 0.22, top * 0.47 - 0.05, zl, w / 2 - 0.12, top * 0.47 + 0.05, zl + 0.04, MAT.GOLD, { skip: ['n'] });
      } else {
        // two leaves: their meeting stile, two raised panels each (proud boxes near, flat on mid)
        proud(b, -0.035, 0, 0.035, top, zl + 0.025, MAT.WOOD, ['bottom', 'top'], zl);
        const pt = d === 'near' ? 0.03 : PROUD;
        for (const s of [-1, 1]) for (const [ya, yb] of [[0.18, top * 0.42], [top * 0.5, top - 0.18]]) {
          const xa = s < 0 ? -w / 2 + 0.14 : 0.12, xb = s < 0 ? -0.12 : w / 2 - 0.14;
          if (d === 'near') proud(b, xa, ya, xb, yb, zl + pt, MAT.WOOD, [], zl);
          else b.quad([xa, ya, zl + pt], [xb, ya, zl + pt], [xb, yb, zl + pt], [xa, yb, zl + pt], MAT.WOOD);
        }
      }
    });
    let top = h;
    if (o.frame !== false && d !== 'far') { surround(b, w, sh, 0.16, 0.06, trim); top = h + 0.16; }
    const step = o.step ?? 0.16;
    if (step > 0 && d !== 'far') proud(b, -w / 2 - 0.35, -step, w / 2 + 0.35, 0, 0.5, MAT.ASHLAR, ['bottom']);
    return { lights: [], top, hole: depth > 0 ? sh.hole : undefined };
  });
}

export interface PortalOpts extends PartOpts {
  /** the arch's width and height (to its crown) */
  w?: number;
  h?: number;
  arch?: ArchKind;
  curve?: CurveOpts;
  depth?: number;
  /** the tiles' palette (types.ts TILE_PAL) */
  pal?: number;
  /** what fills it: the lattice doors, a dark way in (glowing at night), or nothing (a passage) */
  fill?: 'lattice' | 'open' | 'passage';
  /** steps before it (2), merlons on its cornice (true), lanterns either side (true) */
  steps?: number;
  crest?: boolean;
  lanterns?: boolean;
}

/** a grand portal (see the header) */
export function portal(b: ArchBuilder, o: PortalOpts = {}): Laid {
  return b.owner('portal', () => {
    const { d } = begin(o);
    const w = o.w ?? 2.4, h = o.h ?? 4.4, arch = o.arch ?? 'pointed', depth = o.depth ?? 0.7, pal = o.pal ?? TILE_PAL.HALL;
    const sh = shapeKind(w, h, arch, segsFor(d, w), o.curve);
    const aw = byDetail(d, 0.3, 0.3, 0), m = 0.32, bw = byDetail(d, 0.36, 0.36, 0.3);
    const zp = byDetail(d, 0.03, 0.03, PROUD), zb = 0.08;
    // the field: a rectangle of tiles round the arch, the opening cut from its foot (the hole's outline runs from the
    // right jamb's foot over the arch to the left jamb's top: reversed, the field's inner edge runs up the left jamb,
    // over, down the right)
    const Wi = w / 2 + aw + m, Hi = h + aw + m;
    const field: V2[] = [[-Wi, 0], [-w / 2, 0], ...[...sh.hole.slice(2)].reverse(), [w / 2, 0], [Wi, 0], [Wi, Hi], [-Wi, Hi]];
    const lights: LightSpot[] = [];
    b.with({ pal }, () => {
      region(b, field, [0, 0, zp], [1, 0, 0], [0, 1, 0], [0, 0, 1], d === 'far' ? MAT.CREAM : MAT.TILE);
      if (d === 'far') return;
      // the border round it, standing out of the wall past the field
      const Wo = Wi + bw, Ho = Hi + bw;
      const band = (x0: number, y0: number, x1: number, y1: number) => b.quad([x0, y0, zb], [x1, y0, zb], [x1, y1, zb], [x0, y1, zb], MAT.TILE_BORDER);
      band(-Wo, 0, -Wi, Hi); band(Wi, 0, Wo, Hi); band(-Wo, Hi, Wo, Ho);
      // its edges: the outer down to the wall, the inner down to the field
      b.with({ pal: 0 }, () => {
        rectOn(b, 0, 0, zb, Ho, [-Wo, 0, 0], [0, 0, 1], [0, 1, 0], [-1, 0, 0], MAT.CREAM);
        rectOn(b, 0, 0, zb, Ho, [Wo, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0], MAT.CREAM, [0, 0, -1]);
        rectOn(b, zp, 0, zb, Hi, [-Wi, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0], MAT.CREAM, [0, 0, -1]);
        rectOn(b, zp, 0, zb, Hi, [Wi, 0, 0], [0, 0, 1], [0, 1, 0], [-1, 0, 0], MAT.CREAM);
        rectOn(b, -Wi, zp, Wi, zb, [0, Hi, 0], [1, 0, 0], [0, 0, 1], [0, -1, 0], MAT.CREAM);
      });
      // the cornice over it all, crested
      b.with({ pal: 0 }, () => {
        proud(b, -Wo - 0.12, Ho, Wo + 0.12, Ho + 0.16, 0.2, MAT.CREAM, ['top']);
        proud(b, -Wo - 0.2, Ho + 0.16, Wo + 0.2, Ho + 0.3, 0.28, MAT.CREAM);
        if (o.crest !== false) {
          const n = Math.max(3, Math.round((2 * Wo + 0.4) / 0.62)), step = (2 * Wo + 0.4) / n;
          for (let k = 0; k < n; k++) b.group(() => { b.at(-Wo - 0.2 + step * (k + 0.5), Ho + 0.3, 0.14); merlon(b, { kind: 'stepped', w: step * 0.62, h: 0.5, t: 0.22, detail: d }); });
        }
      });
    });
    // the reveal from the field's face back to the doors; the archivolt and its jambs over the field
    if (depth > 0) reveal(b, w, sh, zp, -depth, MAT.ASHLAR, MAT.PAVING, MAT.ASHLAR);
    if (d !== 'far') surround(b, w, sh, aw, zp + 0.07, MAT.CREAM, zp, d === 'near' ? MAT.RED : undefined);
    const fill = o.fill ?? 'lattice';
    const zl = depth > 0 ? -depth : PROUD;
    if (fill === 'lattice') b.with({ pal }, () => fillAt(b, sh.hole, zl, MAT.LATTICE));
    else if (fill === 'open') b.with({ glow: 0.6 }, () => fillAt(b, sh.hole, zl, MAT.INTERIOR));
    // the steps before it, each a riser back from the one above
    const steps = d === 'far' ? 0 : o.steps ?? 2, Wo = Wi + bw;
    // (the top one from the field's face: the threshold runs out to it)
    for (let k = 0; k < steps; k++) b.box(-Wo - 0.1 * k, -0.16 * steps, k ? 0.42 * k : zp, Wo + 0.1 * k, -0.16 * k, 0.42 * (k + 1), MAT.ASHLAR, { skip: ['n', 'bottom'] });
    if (o.lanterns !== false && d !== 'far') for (const s of [-1, 1]) b.group(() => {
      b.at(s * (Wo + 0.55), Math.min(2.6, h * 0.6), 0);
      lights.push(...lantern(b, { kind: 'wall', detail: d, seed: (o.seed ?? 1) + s }).lights);
    });
    return { lights, top: Hi + bw + 0.3 + (o.crest !== false ? 0.5 : 0), hole: depth > 0 ? sh.hole : undefined };
  });
}

export type GrilleKind = 'diamond' | 'square' | 'bars';

export interface GrilleOpts extends PartOpts {
  /** the rectangle it fills (x from -w/2 to w/2, y from 0 to h) */
  w?: number;
  h?: number;
  kind?: GrilleKind;
  /** the bars' pitch and width (m) */
  pitch?: number;
  bar?: number;
  mat?: Mat;
  tint?: V3;
}

/** a grille (see the header): z 0 at its back, its bars out to about 4 cm */
export function grillePart(b: ArchBuilder, o: GrilleOpts = {}): Laid {
  return b.owner('grille', () => {
    const { d } = begin(o);
    const w = o.w ?? 1, h = o.h ?? 1.5, kind = o.kind ?? 'diamond', mat = o.mat ?? MAT.WOOD;
    const p = o.pitch ?? (kind === 'bars' ? 0.13 : 0.2), bw = o.bar ?? (kind === 'bars' ? 0.025 : 0.032);
    const near = d === 'near';
    b.with({ tint: o.tint ?? [1, 1, 1] }, () => {
      // (one direction's bars as strips clipped to the rectangle, their fronts at zf)
      const strips = (ang: number, zf: number) => {
        const ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
        const reach = Math.abs(nx) * w / 2 + Math.abs(ny) * h / 2;
        for (let c = -Math.floor(reach / p) * p; c <= reach + 1e-6; c += p) {
          const seg = clipLine(c * nx, h / 2 + c * ny, ux, uy, w / 2, h);
          if (!seg) continue;
          const [ax, ay, bx, by] = seg, ox = nx * bw / 2, oy = ny * bw / 2;
          const q: V3[] = [[ax - ox, ay - oy, zf], [bx - ox, by - oy, zf], [bx + ox, by + oy, zf], [ax + ox, ay + oy, zf]];
          b.patch(q, [0, 1, 2, 0, 2, 3], mat, [0, 0, 1]);
          if (!near) continue;
          // (its two long sides, back to its foot)
          const z0 = zf - 0.016;
          b.patch([[ax - ox, ay - oy, z0], [bx - ox, by - oy, z0], [bx - ox, by - oy, zf], [ax - ox, ay - oy, zf]], [0, 1, 2, 0, 2, 3], mat, [-nx, -ny, 0]);
          b.patch([[ax + ox, ay + oy, z0], [bx + ox, by + oy, z0], [bx + ox, by + oy, zf], [ax + ox, ay + oy, zf]], [0, 1, 2, 0, 2, 3], mat, [nx, ny, 0]);
        }
      };
      // (far, one way's bars: the other's are finer than a pixel there)
      if (kind === 'diamond') { strips(Math.PI / 4, 0.02); if (d !== 'far') strips(-Math.PI / 4, 0.02 + PROUD); }
      else if (kind === 'square') { strips(0, 0.02); if (d !== 'far') strips(Math.PI / 2, 0.02 + PROUD); }
      else strips(Math.PI / 2, 0.025);
      // the frame round it, in front of both
      const f = 0.045, zf = 0.02 + PROUD * 2;
      // (its sides the whole height, its top and foot between them: no two fronts over each other at the corners)
      proud(b, -w / 2, 0, -w / 2 + f, h, zf, mat);
      proud(b, w / 2 - f, 0, w / 2, h, zf, mat);
      proud(b, -w / 2 + f, 0, w / 2 - f, f, zf, mat, ['e', 'w']);
      proud(b, -w / 2 + f, h - f, w / 2 - f, h, zf, mat, ['e', 'w']);
    });
    return { lights: [], top: h };
  });
}

/** the line through (px, py) along (ux, uy) clipped to x in [-hw, hw], y in [0, h]: its two ends, or null */
function clipLine(px: number, py: number, ux: number, uy: number, hw: number, h: number): [number, number, number, number] | null {
  let t0 = -1e9, t1 = 1e9;
  for (const [p, u, lo, hi] of [[px, ux, -hw, hw], [py, uy, 0, h]]) {
    if (Math.abs(u) < 1e-9) { if (p < lo || p > hi) return null; continue; }
    let a = (lo - p) / u, c = (hi - p) / u;
    if (a > c) { const t = a; a = c; c = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
  }
  if (t1 - t0 < 0.02) return null;
  return [px + ux * t0, py + uy * t0, px + ux * t1, py + uy * t1];
}
