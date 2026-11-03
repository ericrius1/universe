// A natural arch: a fin of layered sandstone (a long, narrow wall with a rounded top) with an opening worn through it,
// big enough to fly through. The fin is swept along its length (x) from vertical cross-sections: each section is the
// fin's bed profile (strata.ts: its beds' half-widths, ledges and recesses, rounded edges, a domed top) mirrored either
// side of its mid-plane, its two sides reading different stretches of each bed's ragged outline so the ledges wander
// along the wall. Where the opening is, every point of the section below the opening's curve (a rounded half
// superellipse, a little uneven) is lifted onto it, so the section's foot becomes the arch's underside; the beds keep
// their heights, so the strata run straight across. Toward its ends the fin narrows to a rounded nose. Its span (the
// opening's width at the ground) is the prototype's size; x runs along the fin, z across it, the ground line at y = 0.
import { MeshKit, sampleProfile, type Pt } from './mesh';
import { range, rng } from './noise';
import type { Post, Proto, Top } from './proto';
import { LODS, Outlines, profile, top, waves, type Bed } from './strata';

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function arch(seed: number, span: number): Proto {
  const build = (l: number) => {
    const lod = LODS[l];
    const r = rng(seed);
    const ol = new Outlines(seed, 0.1);
    const a = span / 2, b = span * range(r, 0.6, 0.88);
    const H = b + span * range(r, 0.2, 0.32);
    const L = a + span * range(r, 0.4, 0.65);
    const W = span * range(r, 0.24, 0.34);
    const sink = 1 + span * 0.02;
    const pw = range(r, 1.7, 2.4);
    const bend = W * range(r, 0.1, 0.3), bendPh = r() * 6.28;
    const drop = range(r, 0.35, 0.65);
    const id0 = (seed % 997) * 64;
    // the fin's beds: half-widths tapering up, ledges and recesses as a hoodoo's
    const env = (y: number) => (W / 2) * (1 + 0.35 * Math.exp(-(y + sink) / (0.05 * span + 0.4))) * (1 - 0.3 * Math.max(0, y) / H);
    const beds: Bed[] = [];
    let y = -sink;
    while (y < H - 0.1) {
      let t = range(r, span * 0.05, span * 0.11);
      if (H - (y + t) < span * 0.03) t = H - y;
      const hard = beds.length > 0 && r() < 0.45;
      const out = hard ? range(r, 1.05, 1.16) : range(r, 0.86, 0.96);
      const id = id0 + beds.length;
      const own = hard ? ol.hard(r, id, Math.round(range(r, 8, 13)), 0.12, 0.05, 0.3, 0.18) : ol.soft(id, 0.05, 0, 0);
      beds.push({ y0: y, y1: y + t, r0: env(y) * out, r1: env(y + t) * out, hard, o: own, dy: () => 0, id, sag: hard ? 0.03 : range(r, 0.06, 0.12), round: 0.3, flags: 0 });
      y += t;
    }
    waves(beds, ol);
    const pts: Pt[] = profile(beds, lod);
    pts.push(...top(pts, lod, span * 0.03, span * 0.01, ol.noise, seed));
    const crown = pts[pts.length - 1];
    const side = pts.slice(0, -1);
    // the opening's curve (null outside it)
    const lift = (x: number) => (Math.abs(x) >= a ? null : b * Math.pow(1 - Math.pow(Math.abs(x) / a, pw), 1 / pw) * (1 + 0.04 * ol.noise.fbm(x * 0.08, 7, 3, 2)));
    // sections along the fin: its ends, and close together round the opening's curve
    const xs: number[] = [];
    const nEnd = Math.round(10 * lod.n + 2), nOpen = Math.round(48 * lod.n);
    for (let k = 0; k <= nEnd; k++) xs.push(-L + ((L - a) * k) / nEnd);
    for (let k = 1; k < nOpen; k++) xs.push(-a * Math.cos((Math.PI * k) / nOpen));
    for (let k = 0; k <= nEnd; k++) xs.push(a + ((L - a) * k) / nEnd);
    const kit = new MeshKit();
    let prev: number[] | null = null;
    for (const x of xs) {
      // (the nose: narrower over the last 22% of the length, to nothing at the very end)
      const e = Math.abs(x) <= L * 0.78 ? 1 : Math.sqrt(Math.max(0, 1 - ((Math.abs(x) - L * 0.78) / (L * 0.22)) ** 2));
      const zc = bend * Math.sin((Math.PI * x) / L * 0.8 + bendPh);
      const thR = (Math.PI * (x + L)) / (2 * L), thL = thR + Math.PI;
      const floor = lift(x);
      const ceil = crown.y - (crown.y + sink) * drop * smooth(L * 0.45, L, Math.abs(x)) ** 1.5;
      // one side of the section (foot to crest), clipped at the opening's curve: the points below where it crosses
      // the curve all sit at the crossing, so the side starts there and the section's foot spans the underside
      const { R, Y } = sampleProfile(side, [thR, thL]);
      const half = (s: number, sgn: number) => {
        let q = side.map((p, j) => ({ z: sgn * R[j][s] * e, y: Y[j][s], p, under: false }));
        if (floor !== null) {
          const k = q.findIndex((v) => v.y >= floor);
          if (k < 0) q = q.map((v) => ({ ...v, y: floor, under: true }));
          else if (k > 0) {
            const t = (floor - q[k - 1].y) / (q[k].y - q[k - 1].y);
            const zf = q[k - 1].z + (q[k].z - q[k - 1].z) * t;
            q = q.map((v, i) => (i < k ? { ...v, z: zf, y: floor, under: true } : v));
          }
        }
        // (and from above toward the ends: the beds above the falling crest all sit where the side meets it)
        const k = q.findIndex((v) => v.y > ceil);
        if (k > 0) {
          const t = (ceil - q[k - 1].y) / (q[k].y - q[k - 1].y);
          const zt = q[k - 1].z + (q[k].z - q[k - 1].z) * t;
          q = q.map((v, i) => (i >= k ? { ...v, z: zt, y: ceil } : v));
        }
        return q;
      };
      const ring: number[] = [];
      const put = (v: { z: number; y: number; p: Pt; under: boolean }) => {
        const ao = v.under ? 0.45 + 0.35 * smooth(0, b, floor!) : 0.55 + 0.45 * smooth(-sink, 2 + span * 0.04, v.y);
        ring.push(kit.vert(x, v.y, zc + v.z, v.p.bed, ao, v.p.flags));
      };
      half(0, 1).forEach(put);
      ring.push(kit.vert(x, Math.min(crown.y, ceil), zc, crown.bed, 1, crown.flags));
      half(1, -1).reverse().forEach(put);
      if (prev) kit.strip(prev, ring);
      prev = ring;
    }
    // posts along the wall (from the opening's curve where it's overhead), tops along its crest
    const posts: Post[] = [];
    const tops: Top[] = [];
    for (let x = -L * 0.8; x <= L * 0.8 + 1e-6; x += W * 0.8) {
      const f = lift(x);
      const zc = bend * Math.sin((Math.PI * x) / L * 0.8 + bendPh);
      if (f === null || f > 2.5) posts.push({ x, z: zc, y0: f ?? 0, y1: H, r: W * 0.42 });
      tops.push({ x, z: zc, r: W * 0.3, y: H });
    }
    return { kit, posts, tops, height: H, radius: Math.hypot(L, W + bend) };
  };
  const bs = [0, 1, 2].map(build);
  return { kind: 'arch', name: `arch-${seed}`, seed, lods: bs.map((x) => x.kit.finish()), height: bs[0].height, radius: bs[0].radius, posts: bs[0].posts, tops: bs[0].tops, span };
}
