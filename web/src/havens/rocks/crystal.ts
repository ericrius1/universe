// Crystal clusters (ref 7): groups of clear hexagonal prisms with pyramidal tips, growing out of the ground from a common
// root at varied sizes and angles, the biggest near the middle and upright, the small ones splayed round it. Each
// crystal is a slightly irregular hexagon (its faces of unequal width), tapering a little up its prism, ending in six
// tip faces meeting at an apex nudged off the axis (real terminations are rarely symmetrical). Faces are flat: every
// face has vertices of its own, so the facets catch the light one by one. A vertex's bed coordinate is its crystal's
// index plus how far along the crystal it sits (0 at the root, 1 at the apex), which crystal.wgsl uses with the
// cluster's crystal list (its foot, axis, radius and length) for the thickness of the light's path through it.
// Sizes: `size` is the biggest crystal's length (0.5-4 m for a field cluster, 8-18 m for a landmark); LOD 1 drops the
// smallest crystals, LOD 2 keeps the few biggest.
import { MeshKit, type V3 } from './mesh';
import { gauss, range, rng } from './noise';
import type { Crystal, Post, Proto } from './proto';

const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

/** a direction tilted from `axis` by angle t toward azimuth f */
function tilt(axis: V3, t: number, f: number): V3 {
  const side = norm(Math.abs(axis[1]) < 0.9 ? cross(axis, [0, 1, 0]) : cross(axis, [1, 0, 0]));
  const up = cross(side, axis);
  const off = add([side[0] * Math.cos(f), side[1] * Math.cos(f), side[2] * Math.cos(f)], up, Math.sin(f));
  return norm(add([axis[0] * Math.cos(t), axis[1] * Math.cos(t), axis[2] * Math.cos(t)], off, Math.sin(t)));
}

export interface ClusterOpts {
  /** a landmark: fewer, fatter, more upright crystals */
  giant?: boolean;
}

export function crystals(seed: number, size: number, o: ClusterOpts = {}): Proto {
  const r = rng(seed);
  const giant = !!o.giant;
  const count = giant ? Math.round(range(r, 5, 9)) : Math.round(range(r, 9, 22));
  const axis = tilt([0, 1, 0], range(r, 0, giant ? 0.15 : 0.35), r() * 6.28);
  const list: Crystal[] = [];
  const shapes: { corners: [number, number][]; taper: number; tip: number; off: [number, number]; spin: number }[] = [];
  for (let i = 0; i < count; i++) {
    const big = i === 0;
    const len = size * (big ? 1 : giant ? range(r, 0.3, 0.75) : Math.pow(r(), 1.7) * 0.8 + 0.12);
    const rad = len * (giant ? range(r, 0.14, 0.2) : range(r, 0.1, 0.17));
    const spread = big ? 0 : size * (giant ? range(r, 0.22, 0.42) : 0.3 * Math.sqrt(r()) * (1.15 - len / size));
    const az = r() * 6.28;
    const base: V3 = [Math.cos(az) * spread, -len * range(r, 0.08, 0.2), Math.sin(az) * spread];
    // (small ones lean out from the middle, away from where they stand)
    const lean = big ? range(r, 0, 0.12) : Math.min(1.1, Math.abs(gauss(r)) * (giant ? 0.3 : 0.42) + (1 - len / size) * (giant ? 0.5 : 0.35));
    const dir = tilt(axis, lean, big ? r() * 6.28 : az + range(r, -0.6, 0.6));
    list.push({ base, axis: dir, r: rad, len, seed: r() });
    shapes.push({
      corners: Array.from({ length: 6 }, (_, k) => [(k / 6) * Math.PI * 2 + range(r, -0.14, 0.14), range(r, 0.82, 1.12)] as [number, number]),
      taper: range(r, 0.86, 0.97), tip: rad * range(r, 1.2, 2.1), off: [range(r, -0.3, 0.3) * rad, range(r, -0.3, 0.3) * rad], spin: r() * 6.28,
    });
  }
  const lods = [0, 0.3, 0.55].map((keep, l) => {
    const kit = new MeshKit();
    list.forEach((c, i) => {
      if (i > 0 && c.len < size * keep && !(l === 2 && i < 2)) return;
      const s = shapes[i];
      const side = norm(Math.abs(c.axis[1]) < 0.9 ? cross(c.axis, [0, 1, 0]) : cross(c.axis, [1, 0, 0]));
      const up = cross(side, c.axis);
      const at = (h: number, a: number, rr: number): V3 => {
        const p = add(c.base, c.axis, h);
        return add(add(p, side, Math.cos(a + s.spin) * rr), up, Math.sin(a + s.spin) * rr);
      };
      const shaft = c.len - s.tip;
      const ring0 = s.corners.map(([a, k]) => at(0, a, c.r * k));
      const ring1 = s.corners.map(([a, k]) => at(shaft, a, c.r * k * s.taper));
      const apex = add(add(add(c.base, c.axis, c.len), side, s.off[0]), up, s.off[1]);
      const v = (p: V3, t: number) => kit.vert(p[0], p[1], p[2], i + Math.min(0.999, t), 0.5 + 0.5 * t, 0);
      const tShaft = shaft / c.len;
      // the six prism faces, each its own quad (wound outward: round the axis, then up it)
      for (let k = 0; k < 6; k++) {
        const j = (k + 1) % 6;
        const a0 = v(ring0[k], 0), a1 = v(ring0[j], 0), b0 = v(ring1[k], tShaft), b1 = v(ring1[j], tShaft);
        kit.tri(a0, b0, a1); kit.tri(a1, b0, b1);
      }
      // the six tip faces
      for (let k = 0; k < 6; k++) {
        const j = (k + 1) % 6;
        const p0 = v(ring1[k], tShaft), p1 = v(ring1[j], tShaft), q = v(apex, 1);
        kit.tri(p0, q, p1);
      }
    });
    return kit.finish();
  });
  const posts: Post[] = list.filter((c) => c.len > 1.2).map((c) => {
    const mid = add(c.base, c.axis, c.len * 0.4);
    return { x: mid[0], z: mid[2], y0: 0, y1: Math.max(0.5, c.base[1] + c.axis[1] * c.len), r: c.r * 0.9 };
  });
  const reach = Math.max(...list.map((c) => Math.hypot(c.base[0] + c.axis[0] * c.len, c.base[2] + c.axis[2] * c.len) + c.r));
  const height = Math.max(...list.map((c) => c.base[1] + c.axis[1] * c.len));
  return { kind: 'crystal', name: `${giant ? 'giant' : 'crystals'}-${seed}`, seed, lods, height, radius: reach, posts, tops: [], crystals: list };
}
