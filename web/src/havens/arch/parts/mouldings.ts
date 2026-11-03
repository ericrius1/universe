// Mouldings run along a path: a profile — (out, up) points, out from the wall's face, up from the moulding's foot,
// from where it leaves the wall round to where it meets it again — swept along a plan polyline (local x, z) at a
// height, mitred at its corners, its open ends closed. Out is to the right of the path's way as seen from above with
// z toward the viewer: a run along +x stands out toward +z, as everything on a wall does here (a closed path is turned
// so it stands outward). Profiles, by name, of unit height (scaled by `size`):
//   'cornice'  a crowning cornice: a fillet, a cove, the corona's soffit and face, a cymatium; its top back to the wall
//              (or on over the wall's top by `back`, capping it: the wall then has no top of its own)
//   'band'     a string course: bevelled out, a face, bevelled back
//   'plinth'   a base at a wall's foot: a step, a torus, a cavetto up into the wall
//   'coping'   a wall's cap, over its whole thickness (`back`), overhanging and dripped both sides
//   'torus'    a round bead
//   'cavetto'  a cove under eaves, its top under what it carries (left off)
// Near: the curves in their segments; mid: fewer; far: a box's outline. Every face of a segment is flat (crisp, as the
// painted trim is), and none is laid on the wall it stands on, the ground it sits on or the eaves over it.
import type { ArchBuilder } from '../builder';
import { polyArea } from '../builder';
import { MAT, type Mat, type V3 } from '../types';
import type { V2 } from '../../world/layout';
import { begin, byDetail, region, type Detail, type Laid, type PartOpts } from './kit';

export type ProfileName = 'cornice' | 'band' | 'plinth' | 'coping' | 'torus' | 'cavetto';

/** a profile's points (out, up), and whether each segment is drawn (false: on the wall, the ground, under eaves) */
export interface Profile { pts: V2[]; draw: boolean[] }

const arcPts = (cx: number, cy: number, r: number, a0: number, a1: number, n: number): V2[] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * (i / n); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as V2; });

/** a named profile at a size (its height, m), its detail, how far it reaches back over its wall (0: not at all) */
export function profileOf(name: ProfileName, size: number, d: Detail, back = 0): Profile {
  const n = byDetail(d, 5, 2, 1), s = size;
  // the points in units of its height, each with whether the segment from it to the next is drawn
  const P: V2[] = [], D: boolean[] = [];
  const go = (pts: V2[], draw = true) => { for (const q of pts) { if (P.length) D.push(draw); P.push(q); } };
  if (name === 'coping') {
    // (in metres: its overhang a share of its height, at most 14 cm, the wall's thickness between)
    const ov = Math.min(0.14, s * 0.6);
    const pts: V2[] = d === 'far'
      ? [[0, 0], [ov, 0], [ov, s], [-back - ov, s], [-back - ov, 0], [-back, 0]]
      : [[0, 0], [ov * 0.4, 0], [ov, s * 0.12], [ov, s * 0.6], [ov * 0.7, s * 0.85], [0, s], [-back, s], [-back - ov * 0.7, s * 0.85], [-back - ov, s * 0.6], [-back - ov, s * 0.12], [-back - ov * 0.4, 0], [-back, 0]];
    return { pts, draw: pts.slice(1).map(() => true) };
  }
  if (d === 'far') {
    const out = { cornice: 0.56, band: 0.3, plinth: 0.36, torus: 0.5, cavetto: 0.6 }[name];
    go([[0, 0], [out, 0]], name !== 'plinth');
    go([[out, 1], [0, 1]]);
    if (name === 'cavetto') D[D.length - 1] = false;
  } else if (name === 'cornice') {
    // a fillet; a cove out to the corona's soffit; its face; a fillet; a cymatium; its top back to the wall
    go([[0, 0], [0.05, 0], [0.05, 0.06]]);
    go(arcPts(0.4, 0.06, 0.35, Math.PI, Math.PI / 2, n + 1).slice(1));
    go([[0.45, 0.41], [0.45, 0.7], [0.48, 0.72]]);
    go(arcPts(0.44, 0.94, 0.12, -Math.PI / 2 + 0.35, 0, n).map(([x, y]) => [x + 0.005, y - 0.04] as V2));
    go([[0.565, 1], [0, 1]]);
  } else if (name === 'band') {
    go([[0, 0], [0.22, 0.12], [0.3, 0.26], [0.3, 0.74], [0.22, 0.88], [0, 1]]);
  } else if (name === 'plinth') {
    // on the ground (not drawn); a step, its top; a torus; a cavetto up into the wall
    go([[0, 0], [0.36, 0]]);
    D[0] = false;
    go([[0.36, 0.3], [0.31, 0.34], [0.22, 0.34]]);
    go(arcPts(0.22, 0.46, 0.12, -Math.PI / 2, Math.PI / 2, n + 2).slice(1));
    // (a quarter ellipse from the torus's top in to the wall at the top: concave, as a cavetto is)
    go(Array.from({ length: n + 1 }, (_, i) => { const a = -Math.PI / 2 - (Math.PI / 2) * (i / (n + 1)); return [0.22 + 0.22 * Math.cos(a), 1 + 0.42 * Math.sin(a)] as V2; }).slice(1));
    go([[0, 1]]);
  } else if (name === 'torus') {
    go(arcPts(0, 0.5, 0.5, -Math.PI / 2, Math.PI / 2, n * 2));
  } else {
    go(arcPts(0.6, 0, 0.6, Math.PI, Math.PI / 2, n * 2).map(([x, y]) => [x, y / 0.6] as V2));
    go([[0, 1]], false);
  }
  let pts = P.map(([x, y]) => [x * s, y * s] as V2), draw = D;
  // a profile reaching back over its wall: its top runs on to -back and drips down the far face; its underside lies on
  // the wall's top (not drawn)
  if (back > 0) {
    const top = pts[pts.length - 1][1], drip = Math.min(0.06, top * 0.2);
    pts = [...pts.slice(0, -1), [-back, top], [-back, top - drip], [0, top - drip]];
    draw = [...draw.slice(0, -1), true, true, false];
  }
  return { pts, draw };
}

export interface MouldingOpts extends PartOpts {
  profile?: ProfileName | Profile;
  /** its height (m: the named profiles are of unit height) */
  size?: number;
  /** its foot's height */
  y?: number;
  /** the path a loop (a building's outline) */
  closed?: boolean;
  /** how far its top reaches back over the wall (the wall's thickness: it caps it; a coping's whole width) */
  back?: number;
  mat?: Mat;
}

/** a moulding along a local plan path (see the header) */
export function moulding(b: ArchBuilder, path: V2[], o: MouldingOpts = {}): Laid {
  return b.owner('moulding', () => {
    const { d } = begin(o);
    const size = o.size ?? 0.4, y0 = o.y ?? 0, mat = o.mat ?? MAT.CREAM;
    const prof = typeof o.profile === 'object' ? o.profile : profileOf(o.profile ?? 'cornice', size, d, o.back ?? 0);
    let p = path;
    // (a loop turned so its out is outward: with z south, a positive area winds the other way)
    if (o.closed && polyArea(p) > 0) p = [...p].reverse();
    const n = p.length, closed = !!o.closed && n > 2, segs = closed ? n : n - 1;
    if (segs < 1) return { lights: [], top: y0 + size };
    // each segment's way and its out; each vertex's mitred out (its length past 1 at a sharp corner)
    const dir: V2[] = [], out: V2[] = [];
    for (let i = 0; i < segs; i++) {
      const a = p[i], c = p[(i + 1) % n], L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      dir.push([(c[0] - a[0]) / L, (c[1] - a[1]) / L]);
      out.push([-(c[1] - a[1]) / L, (c[0] - a[0]) / L]);
    }
    const mitre = (i: number): V2 => {
      const prev = closed ? out[(i - 1 + segs) % segs] : out[Math.max(0, i - 1)], next = closed ? out[i % segs] : out[Math.min(segs - 1, i)];
      if (!closed && (i === 0 || i === n - 1)) return i === 0 ? out[0] : out[segs - 1];
      const k = 1 + prev[0] * next[0] + prev[1] * next[1];
      return k < 1e-3 ? next : [(prev[0] + next[0]) / k, (prev[1] + next[1]) / k];
    };
    const at = (i: number, q: V2): V3 => { const m = mitre(i % n), v = p[i % n]; return [v[0] + m[0] * q[0], y0 + q[1], v[1] + m[1] * q[0]]; };
    const P = prof.pts;
    for (let i = 0; i < segs; i++) {
      const o2 = out[i];
      for (let k = 0; k + 1 < P.length; k++) {
        if (!prof.draw[k]) continue;
        const a = P[k], c = P[k + 1];
        // (the profile walks round its section with the solid on its left: out is to the right of its way)
        const no = c[1] - a[1], nu = -(c[0] - a[0]);
        const nrm: V3 = [o2[0] * no, nu, o2[1] * no];
        b.patch([at(i, a), at(i + 1, a), at(i + 1, c), at(i, c)], [0, 1, 2, 0, 2, 3], mat, nrm);
      }
    }
    // the open ends: the section, closed along the wall
    if (!closed) for (const [i, s] of [[0, -1], [n - 1, 1]] as const) {
      const t = dir[i === 0 ? 0 : segs - 1], m = out[i === 0 ? 0 : segs - 1], v = p[i];
      region(b, P, [v[0], y0, v[1]], [m[0], 0, m[1]], [0, 1, 0], [t[0] * s, 0, t[1] * s], mat);
    }
    let top = 0;
    for (const q of P) top = Math.max(top, q[1]);
    return { lights: [], top: y0 + top };
  });
}
