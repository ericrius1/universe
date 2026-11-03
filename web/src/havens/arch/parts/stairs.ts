// A flight of stairs with landings: from its first riser's foot at the origin (its middle; x across it), climbing
// toward -z, `rise` in all over `steps` (risers of about 17 cm on treads of 32), broken by a landing every so many
// steps; solid down to its foot. Its sides: 'parapet' (cheek walls rising a parapet's height over the treads, sloped
// along the flights and level along the landings, under a cream coping), 'string' (a low cheek a little over the
// treads' noses), 'none' (the steps' sawtooth sides). Near: every tread's nose standing over its riser; mid plain
// steps; far a ramp's outline. Its walk (Laid.walk: the flights as stairs, the landings and its top as floors, the
// cheeks as solids) is in its own frame, for the caller's collider.
import type { ArchBuilder } from '../builder';
import { MAT, type Mat, type V3 } from '../types';
import type { V2 } from '../../world/layout';
import { begin, byDetail, region, type Laid, type PartOpts } from './kit';

export interface FlightOpts extends PartOpts {
  /** its rise in all, its width, a tread's going */
  rise?: number;
  width?: number;
  going?: number;
  /** a landing after every this many steps (12), how deep (1.4) */
  every?: number;
  landing?: number;
  /** its sides */
  cheek?: 'parapet' | 'string' | 'none';
  /** the treads', the risers' (a tile border's: `pal`), the cheeks', the coping's */
  mat?: Mat;
  riser?: Mat;
  side?: Mat;
  coping?: Mat;
}

/** a flight with landings (see the header) */
export function flight(b: ArchBuilder, o: FlightOpts = {}): Laid {
  return b.owner('stair', () => {
    const { d } = begin(o);
    const rise = o.rise ?? 3, w = o.width ?? 1.8, g = o.going ?? 0.32, every = o.every ?? 12, L = o.landing ?? 1.4;
    const n = Math.max(1, Math.round(rise / 0.17)), r = rise / n;
    const mat = o.mat ?? MAT.ASHLAR, riser = o.riser ?? mat, side = o.side ?? MAT.PLASTER, cheek = o.cheek ?? 'parapet';
    // the steps' places: each its riser's z and its tread's height, and the landings'
    const steps: { z: number; y: number; deep: number }[] = [];
    let z = 0;
    for (let k = 0; k < n; k++) {
      const land = k > 0 && k < n - 1 && (k + 1) % every === 0 && n - k > 3;
      steps.push({ z, y: (k + 1) * r, deep: land ? L : g });
      z -= land ? L : g;
    }
    const end = z, hw = w / 2;
    const walk = { solids: [] as number[][], floors: [] as number[][], stairs: [] as number[][] };
    // the outline of its side (z, y): up the steps from the foot, down the back
    const saw: V2[] = [[0, 0]];
    for (const s of steps) { saw.push([s.z, s.y]); saw.push([s.z - s.deep, s.y]); }
    saw.push([end, 0]);
    if (d === 'far') {
      // a ramp's outline: its slope, its sides
      const top = rise;
      b.quad([-hw, 0, 0], [hw, 0, 0], [hw, top, end], [-hw, top, end], mat);
      b.quad([-hw, top, end], [hw, top, end], [hw, 0, end], [-hw, 0, end], mat);
      for (const x of [-hw, hw]) region(b, [[0, 0], [end, top], [end, 0]], [x, 0, 0], [0, 0, 1], [0, 1, 0], [x < 0 ? -1 : 1, 0, 0], side);
    } else {
      const nose = d === 'near' ? 0.03 : 0, nt = 0.045;
      steps.forEach((s, k) => {
        const y0 = k === 0 ? 0 : steps[k - 1].y;
        // the riser (up to under the nose), the tread, the nose's face and underside
        b.quad([-hw, y0, s.z], [hw, y0, s.z], [hw, s.y - (nose ? nt : 0), s.z], [-hw, s.y - (nose ? nt : 0), s.z], riser);
        b.quad([-hw, s.y, s.z + nose], [hw, s.y, s.z + nose], [hw, s.y, s.z - s.deep], [-hw, s.y, s.z - s.deep], mat);
        if (nose) {
          b.quad([-hw, s.y - nt, s.z + nose], [hw, s.y - nt, s.z + nose], [hw, s.y, s.z + nose], [-hw, s.y, s.z + nose], mat);
          b.quad([-hw, s.y - nt, s.z], [hw, s.y - nt, s.z], [hw, s.y - nt, s.z + nose], [-hw, s.y - nt, s.z + nose], mat);
          if (cheek === 'none') for (const x of [-hw, hw]) region(b, [[s.z, s.y - nt], [s.z + nose, s.y - nt], [s.z + nose, s.y], [s.z, s.y]], [x, 0, 0], [0, 0, 1], [0, 1, 0], [x < 0 ? -1 : 1, 0, 0], mat);
        }
      });
      // the back, down from the top to the foot
      b.quad([hw, 0, end], [-hw, 0, end], [-hw, rise, end], [hw, rise, end], side);
      if (cheek === 'none') for (const x of [-hw, hw]) region(b, saw, [x, 0, 0], [0, 0, 1], [0, 1, 0], [x < 0 ? -1 : 1, 0, 0], side);
    }
    // the cheeks: walls either side, their tops along the noses' line (the treads' fronts) a height over them
    if (cheek !== 'none' && d !== 'far') {
      const over = cheek === 'parapet' ? 0.95 : 0.16, t = cheek === 'parapet' ? 0.22 : 0.18;
      const line: V2[] = [[0.25, over]];
      steps.forEach((s, k) => {
        if (s.deep > g + 1e-6) { line.push([s.z, s.y + over]); line.push([s.z - s.deep, s.y + over]); }
        else if (k === 0) line.push([s.z, s.y + over]);
      });
      line.push([end, rise + over]);
      for (const sx of [-1, 1]) {
        const x0 = sx < 0 ? -hw - t : hw, x1 = sx < 0 ? -hw : hw + t;
        cheekWall(b, line, x0, x1, side, o.coping ?? MAT.CREAM, d === 'near');
        walk.solids.push([x0, end, x1, 0.25, 0, rise + over]);
      }
    }
    // the walk: each run of steps a stair, each landing a floor, the top a floor
    let k0 = 0;
    for (let k = 0; k <= n; k++) {
      if (k < n && steps[k].deep <= g + 1e-6) continue;
      // (a run of steps up to the landing's riser, or to the top)
      const zA = steps[k0].z, zB = k === n ? end : steps[k].z, yA = k0 === 0 ? 0 : steps[k0 - 1].y;
      const yB = k === n ? rise : steps[k].y - r;
      if (zA > zB) walk.stairs.push([-hw, zB, hw, zA, yA, yB - yA, 1, -1]);
      if (k < n) walk.floors.push([-hw, steps[k].z - steps[k].deep, hw, steps[k].z, steps[k].y, 1]);
      k0 = k + 1;
    }
    walk.floors.push([-hw, end - 0.01, hw, end, rise, 1]);
    return { lights: [], top: rise, walk };
  });
}

/** a cheek wall from x0 to x1 under a top line (z, y) from its foot at z 0.25 back to its end: both faces, its front
 *  and its back, its top under a coping (near: moulded, a fillet and a cap) that follows the line */
function cheekWall(b: ArchBuilder, line: V2[], x0: number, x1: number, mat: Mat, coping: Mat, near: boolean) {
  const z0 = line[0][0], z1 = line[line.length - 1][0];
  const outline: V2[] = [[z1, 0], ...line.slice().reverse(), [z0, 0]];
  // (the outline's (z, y) on a face at x, facing ±x; the ends' quads)
  region(b, outline, [x0, 0, 0], [0, 0, 1], [0, 1, 0], [-1, 0, 0], mat, [0, 0, 1]);
  region(b, outline, [x1, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0], mat, [0, 0, -1]);
  b.quad([x0, 0, z0], [x1, 0, z0], [x1, line[0][1], z0], [x0, line[0][1], z0], mat);
  b.quad([x1, 0, z1], [x0, 0, z1], [x0, line[line.length - 1][1], z1], [x1, line[line.length - 1][1], z1], mat);
  // the coping: a band over the line, a little wider than the wall, its underside showing either side
  const ct = 0.12, ov = near ? 0.04 : 0.03;
  const up: V2[] = line.map(([z, y]) => [z, y + ct]);
  const band: V2[] = [...line, ...up.slice().reverse()];
  const cx0 = x0 - ov, cx1 = x1 + ov;
  region(b, band, [cx0, 0, 0], [0, 0, 1], [0, 1, 0], [-1, 0, 0], coping, [0, 0, 1]);
  region(b, band, [cx1, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0], coping, [0, 0, -1]);
  for (let i = 0; i + 1 < line.length; i++) {
    const [za, ya] = up[i], [zc, yc] = up[i + 1], [zb, yb] = line[i], [zd, yd] = line[i + 1];
    const dz = zc - za, dy = yc - ya;
    // its top (out: up from the slope) and its underside's strips either side of the wall
    b.patch([[cx0, ya, za], [cx1, ya, za], [cx1, yc, zc], [cx0, yc, zc]], [0, 1, 2, 0, 2, 3], coping, [0, -dz, dy]);
    for (const [xa, xb] of [[cx0, x0], [x1, cx1]]) b.patch([[xa, yb, zb], [xb, yb, zb], [xb, yd, zd], [xa, yd, zd]], [0, 1, 2, 0, 2, 3], coping, [0, dz, -dy] as V3);
  }
  // its ends
  for (const [i, s] of [[0, 1], [line.length - 1, -1]] as const) {
    const [z, y] = line[i];
    b.patch([[cx0, y, z], [cx1, y, z], [cx1, y + ct, z], [cx0, y + ct, z]], [0, 1, 2, 0, 2, 3], coping, [0, 0, s]);
  }
}
