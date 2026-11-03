// The caverns' crystals: clusters of faceted shards, the rim's crystals (rocks/crystal.ts) grown as the arch builds
// things — clear six-sided prisms with pyramidal tips from a common root, the biggest upright in the middle, the rest
// splayed round it, each hexagon a little irregular and its apex nudged off the axis — but lit from within: their
// material (MAT.CRYSTAL) is drawn by arch.wgsl as an emerald-to-mint glow, banded by facet, with near-white tips. Every
// face has its own vertices (flat facets); each vertex carries how far along its shard it is (the ambient byte: 0 the
// root, 1 the apex), a hue (the tint: deep emerald to mint) and the cluster's glow (the glow byte). A cluster grows
// along any axis — up from a floor, out of a wall, down from a ceiling — and hands back where its light sits.
import type { ArchBuilder } from '../arch/builder';
import { MAT, type ArchMesh, type V3 } from '../arch/types';
import { rng } from '../haven/plan';

const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const range = (r: () => number, a: number, b: number) => a + (b - a) * r();

/** a direction tilted from `axis` by angle t toward azimuth f */
function tilt(axis: V3, t: number, f: number): V3 {
  const side = norm(Math.abs(axis[1]) < 0.9 ? cross(axis, [0, 1, 0]) : cross(axis, [1, 0, 0]));
  const up = cross(side, axis);
  const off = add([side[0] * Math.cos(f), side[1] * Math.cos(f), side[2] * Math.cos(f)], up, Math.sin(f));
  return norm(add([axis[0] * Math.cos(t), axis[1] * Math.cos(t), axis[2] * Math.cos(t)], off, Math.sin(t)));
}

export interface Cluster {
  /** the biggest shard's length (m) */
  size: number;
  /** the way it grows (default up) */
  axis?: V3;
  /** how many shards (default by size) */
  count?: number;
  /** how far round the root the others stand, as a fraction of size (default 0.3) */
  spread?: number;
  /** its hue: 0 deep emerald .. 1 pale mint (each shard varies about it) */
  hue?: number;
  /** its glow (0..1) */
  glow?: number;
  /** a landmark: fewer, fatter, more upright shards */
  giant?: boolean;
  seed: number;
}

/** a cluster's mesh grown from `root` (world), merged into the builder; where its light belongs (a little out from its
 *  middle along its axis) */
export function crystalCluster(b: ArchBuilder, root: V3, o: Cluster): V3 {
  const r = rng(o.seed, 917);
  const axis = norm(o.axis ?? [0, 1, 0]);
  const giant = !!o.giant, size = o.size;
  const count = o.count ?? (giant ? Math.round(range(r, 5, 8)) : Math.round(range(r, 6, 11)));
  const spread = o.spread ?? 0.3;
  const P: number[] = [], N: number[] = [], U: number[] = [], T: number[] = [], A: number[] = [], I: number[] = [];
  const glow = Math.round(Math.max(0, Math.min(1, o.glow ?? 1)) * 255);
  // (a face: its corners with how far along each is; its normal turned away from the shard's axis line)
  const face = (pts: V3[], ts: number[], hue: number, mid: V3, ax: V3) => {
    let n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
    const c = pts.reduce((s, p) => add(s, p, 1 / pts.length), [0, 0, 0] as V3);
    const w = sub(c, mid), out = sub(w, [ax[0] * dot(w, ax), ax[1] * dot(w, ax), ax[2] * dot(w, ax)]);
    // (a tip face leans out along the axis as well: its outward is from the axis point under it)
    // (uv.x across the face, 0 at one edge, 1 at the other — a tip's apex in the middle — for the edges' light)
    let us = pts.length === 3 ? [0, 1, 0.5] : [0, 1, 1, 0];
    const flip = dot(n, dot(out, out) > 1e-8 ? out : ax) < 0;
    if (flip) { pts = [...pts].reverse(); ts = [...ts].reverse(); us = [...us].reverse(); n = [-n[0], -n[1], -n[2]]; }
    const base = P.length / 3;
    const tint = [0.86 + 0.14 * hue, 1, 0.9 + 0.12 * hue].map((x) => Math.round(Math.min(255, x * 128)));
    pts.forEach((p, k) => {
      P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); U.push(us[k], ts[k]);
      T.push(tint[0], tint[1], tint[2]); A.push(Math.round(Math.min(1, ts[k]) * 255));
    });
    for (let k = 1; k < pts.length - 1; k++) I.push(base, base + k, base + k + 1);
  };
  let light: V3 = add(root, axis, size * 0.45);
  for (let i = 0; i < count; i++) {
    const big = i === 0;
    const len = size * (big ? 1 : giant ? range(r, 0.3, 0.7) : Math.pow(r(), 1.6) * 0.75 + 0.15);
    const rad = len * (giant ? range(r, 0.14, 0.19) : range(r, 0.1, 0.16));
    const sp = big ? 0 : size * (giant ? range(r, 0.2, 0.38) : spread * Math.sqrt(r()) * (1.15 - len / size));
    const az = r() * 6.283;
    const side = norm(Math.abs(axis[1]) < 0.9 ? cross(axis, [0, 1, 0]) : cross(axis, [1, 0, 0]));
    const up = cross(side, axis);
    const foot = add(add(add(root, side, Math.cos(az) * sp), up, Math.sin(az) * sp), axis, -len * range(r, 0.06, 0.16));
    const lean = big ? range(r, 0, 0.1) : Math.min(1.0, Math.abs(r() - r()) * (giant ? 0.5 : 0.7) + (1 - len / size) * (giant ? 0.45 : 0.4));
    const dir = tilt(axis, lean, big ? r() * 6.28 : az + range(r, -0.5, 0.5));
    const corners = Array.from({ length: 6 }, (_, k) => [(k / 6) * Math.PI * 2 + range(r, -0.15, 0.15), range(r, 0.8, 1.12)] as [number, number]);
    const taper = range(r, 0.84, 0.96), tipL = rad * range(r, 1.3, 2.2), spin = r() * 6.28;
    const hue = Math.max(0, Math.min(1, (o.hue ?? 0.5) + (r() - 0.5) * 0.5));
    const s2 = norm(Math.abs(dir[1]) < 0.9 ? cross(dir, [0, 1, 0]) : cross(dir, [1, 0, 0])), u2 = cross(s2, dir);
    const ringAt = (h: number, k: number, rr: number): V3 => {
      const [a, m] = corners[k];
      return add(add(add(foot, dir, h), s2, Math.cos(a + spin) * rr * m), u2, Math.sin(a + spin) * rr * m);
    };
    const shaft = len - tipL, ts = shaft / len;
    const apex = add(add(add(foot, dir, len), s2, range(r, -0.3, 0.3) * rad), u2, range(r, -0.3, 0.3) * rad);
    const mid = add(foot, dir, shaft * 0.5);
    for (let k = 0; k < 6; k++) {
      const j = (k + 1) % 6;
      face([ringAt(0, k, rad), ringAt(0, j, rad), ringAt(shaft, j, rad * taper), ringAt(shaft, k, rad * taper)], [0, 0, ts, ts], hue, mid, dir);
      face([ringAt(shaft, k, rad * taper), ringAt(shaft, j, rad * taper), apex], [ts, ts, 1], hue, foot, dir);
    }
    if (big) light = add(foot, dir, len * 0.5);
  }
  const n = P.length / 3;
  const mn: V3 = [Infinity, Infinity, Infinity], mx: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); }
  const mesh: ArchMesh = {
    pos: new Float32Array(P), nrm: new Float32Array(N), uv: new Float32Array(U), mat: new Uint8Array(n).fill(MAT.CRYSTAL),
    tint: new Uint8Array(T), ao: new Uint8Array(A), glow: new Uint8Array(n).fill(glow), idx: new Uint32Array(I), bounds: [mn, mx],
  };
  b.merge(mesh);
  return light;
}
