// The city's tilework (zellige), laid on a Face: the shader draws the patterns (arch.wgsl: a field of eight-point stars
// and crosses, a band of interlaced stars, a border of diamonds and chevrons, each in a palette of types.ts TILE_PAL),
// these lay the pieces they're drawn on. A tiled surround for a doorway (an alfiz: the field filling the rectangle round
// the opening and its arch, a border standing proud round it), a panel (a field in a border, a dado), a band, a tiled
// threshold. Only the grand buildings and the rich houses' doors get them, so they stand out from the plain streets.
import type { Mat } from '../arch/types';
import { MAT } from '../arch/types';
import type { V2 } from '../world/layout';
import type { City } from './ctx';
import { Face, type Opening, archOf } from './facade';

/** how far the tiles stand out of the wall, and the border round them (m) */
const FIELD_W = -0.012, BORDER_W = -0.04;

export interface TileOpts {
  pal: number;
  /** the border's width (m; 0 none) and material (TILE_BORDER, or TILE_BAND) */
  bw?: number;
  border?: Mat;
  /** the field's material (TILE, or a band) */
  field?: Mat;
}

/** a border round a rectangle (u0, v0)–(u1, v1) of the face, `bw` wide outside it, standing proud with cream sides: up
 *  each side from v0 and over the top (and under the bottom unless `open` below: a doorway's surround stands on the
 *  ground) */
export function border(c: City, f: Face, u0: number, v0: number, u1: number, v1: number, bw: number, pal: number, mat: Mat = MAT.TILE_BORDER, open = true) {
  const b = c.b;
  const strips: [number, number, number, number][] = [[u0 - bw, open ? v0 : v0 - bw, u0, v1], [u1, open ? v0 : v0 - bw, u1 + bw, v1], [u0 - bw, v1, u1 + bw, v1 + bw]];
  if (!open) strips.push([u0, v0 - bw, u1, v0]);
  for (const [a0, b0, a1, b1] of strips) {
    f.box(a0, b0, a1, b1, BORDER_W, 0, MAT.CREAM, { skip: ['front', 'bottom'] });
    b.with({ pal }, () => f.rect(a0, b0, a1, b1, BORDER_W, mat));
  }
}

/** a tiled panel: a field from (u0, v0) to (u1, v1) a little proud of the wall, in a border `bw` wide (inside the
 *  rectangle) */
export function tilePanel(c: City, f: Face, u0: number, v0: number, u1: number, v1: number, o: TileOpts) {
  const bw = o.bw ?? 0.3;
  c.b.with({ pal: o.pal }, () => f.rect(u0 + bw, v0 + bw, u1 - bw, v1 - bw, FIELD_W, o.field ?? MAT.TILE));
  if (bw > 0) border(c, f, u0 + bw, v0 + bw, u1 - bw, v1 - bw, bw, o.pal, o.border ?? MAT.TILE_BORDER, false);
}

/** a dado along a face from u0 to u1 up to v1 from v0: panels about `every` m wide between cream pilaster strips, each a
 *  field in a border; a band over them all (TILE_BAND) `band` m tall if given */
export function dado(c: City, f: Face, u0: number, u1: number, v0: number, v1: number, o: TileOpts & { every?: number; band?: number }) {
  const n = Math.max(1, Math.round((u1 - u0) / (o.every ?? 4))), w = (u1 - u0) / n, gap = 0.16;
  const band = o.band ?? 0, top = v1 - band;
  for (let k = 0; k < n; k++) {
    const a = u0 + k * w + (k ? gap / 2 : 0), z = u0 + (k + 1) * w - (k < n - 1 ? gap / 2 : 0);
    tilePanel(c, f, a, v0, z, top, o);
    if (k) f.box(u0 + k * w - gap / 2, v0, u0 + k * w + gap / 2, top, -0.06, 0, MAT.CREAM, { skip: ['bottom'] });
  }
  if (band > 0) {
    c.b.with({ pal: o.pal }, () => f.rect(u0, top, u1, v1, -0.02, MAT.TILE_BAND));
    f.box(u0, v1, u1, v1 + 0.08, -0.07, 0, MAT.CREAM, { skip: ['left', 'right'] });
  }
}

/** a doorway's tiled surround (an alfiz): the field filling the rectangle round the opening (its surround frame's outer
 *  edge, its arch) `side` m beyond it either side and `over` m over its crown, and a border round that, `bw` wide.
 *  Returns the rectangle's outer bounds (border included) */
export function surround(c: City, f: Face, o: Opening, side: number, over: number, opts: TileOpts): [number, number, number, number] {
  const fw = o.frame ? o.frameW ?? 0.18 : 0, bw = opts.bw ?? 0.28;
  const jl = o.u0 - fw, jr = o.u1 + fw;
  const U0 = jl - side, U1 = jr + side;
  const pts: V2[] = [[U0, o.v0], [jl, o.v0]];
  let crown = o.top + fw;
  if (o.arch === 'flat') pts.push([jl, o.top + fw], [jr, o.top + fw]);
  else {
    const n = archOf(o).arc.length - 1;
    const outer = archOf(o, n, fw).arc;
    crown = Math.max(...outer.map((p) => p[1]));
    pts.push(...outer);
  }
  const T = crown + over;
  pts.push([jr, o.v0], [U1, o.v0], [U1, T], [U0, T]);
  c.b.with({ pal: opts.pal }, () => f.region(pts, FIELD_W, opts.field ?? MAT.TILE));
  if (bw > 0) border(c, f, U0, o.v0, U1, T, bw, opts.pal, opts.border ?? MAT.TILE_BORDER);
  return [U0 - bw, o.v0, U1 + bw, T + bw];
}

/** a tiled step before a door: from u0 to u1, its top at v1 (from v0), `out` deep out of the face: the top a field, the
 *  front a border, the ends cream */
export function threshold(c: City, f: Face, u0: number, u1: number, v0: number, v1: number, out: number, pal: number) {
  f.box(u0, v0, u1, v1, -out, 0, MAT.CREAM, { skip: ['bottom', 'top', 'front'] });
  c.b.with({ pal }, () => {
    f.ledge(u0, u1, v1, -out, 0, MAT.TILE);
    f.rect(u0, v0, u1, v1, -out, MAT.TILE_BORDER);
  });
}

/** tiled panels up the sides of a deep opening's reveal, from its sill to `h` over it */
export function revealDado(c: City, f: Face, o: Opening, h: number, pal: number) {
  const d = o.depth, flat = (p: number[]) => [p[0], p[2]] as V2;
  const sides = [
    new Face(c.b, flat(f.at(o.u0, 0, -0.03)), flat(f.at(o.u0, 0, d)), f.y0 + o.v0, h),
    new Face(c.b, flat(f.at(o.u1, 0, d)), flat(f.at(o.u1, 0, -0.03)), f.y0 + o.v0, h),
  ];
  for (const r of sides) tilePanel(c, r, 0.06, 0.08, r.len - 0.06, h, { pal, bw: 0.2 });
}

/** a band of tile (TILE_BAND) along a face from (u0, v0) to (u1, v1), laid a little proud */
export function band(c: City, f: Face, u0: number, v0: number, u1: number, v1: number, pal: number, mat: Mat = MAT.TILE_BAND) {
  c.b.with({ pal }, () => f.rect(u0, v0, u1, v1, FIELD_W, mat));
}
