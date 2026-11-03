// Loose sandstone: boulders, talus blocks and fallen slabs. Sandstone breaks along its bedding and its joints, so a block
// is a convex lump cut by planes: a top and a bottom (the bedding, near level), four to six joints round it (near
// upright), and a few chips knocking off corners. Its surface is the softest of those planes seen from its middle (a
// smooth minimum, so the edges are crisp but not knife-sharp), a little lumpy, sampled on a latitude-longitude sphere.
// Each is about 1 m in reach with its bottom at y = 0; an instance scales it to its size (a 0.4 m stone to an 8 m
// block) and tips it as it fell. A slab is the same, thinner and longer. One bed each: the bed coordinate runs up it.
import { MeshKit, type V3 } from './mesh';
import { Noise3, range, rng } from './noise';
import type { Proto } from './proto';

const idBase = (seed: number) => (seed % 997) * 64 + 50;

function block(kind: 'boulder' | 'slab', seed: number): Proto {
  const r = rng(seed);
  const slab = kind === 'slab';
  const noise = new Noise3(seed);
  const h = slab ? range(r, 0.14, 0.3) : range(r, 0.5, 0.95);
  const stretch = slab ? range(r, 1.3, 2.2) : range(r, 1.0, 1.4);
  const yaw = r() * 6.28;
  // the planes: [normal, distance from the middle]
  const planes: [V3, number][] = [];
  const plane = (n: V3, d: number) => { const l = Math.hypot(n[0], n[1], n[2]); planes.push([[n[0] / l, n[1] / l, n[2] / l], d]); };
  plane([range(r, -0.08, 0.08), 1, range(r, -0.08, 0.08)], h / 2);
  plane([range(r, -0.06, 0.06), -1, range(r, -0.06, 0.06)], h / 2);
  const joints = Math.round(slab ? range(r, 6, 8.99) : range(r, 4, 6.99));
  for (let k = 0; k < joints; k++) {
    const a = yaw + (k / joints) * Math.PI * 2 + range(r, -0.35, 0.35);
    const c = Math.cos(a), s = Math.sin(a);
    // (stretched along the block's long axis: its joints there sit further out)
    plane([c, range(r, -0.25, 0.25), s], range(r, 0.78, 1.0) * Math.hypot(c * stretch, s));
  }
  const chips = Math.round(range(r, 2, 5));
  for (let k = 0; k < chips; k++) {
    const a = r() * 6.28, up = r() < 0.6 ? 1 : -1;
    plane([Math.cos(a), up * range(r, 0.6, 1.2), Math.sin(a)], range(r, 0.7, 0.9) * Math.max(h / 2 + 0.3, 0.6));
  }
  const soft = range(r, 0.025, 0.06);
  /** the distance from the middle to the surface along a unit direction */
  const bound = 1.05 * Math.max(stretch, 1);
  const reach = (d: V3) => {
    // (a sphere round it all as one more plane, so no direction the joints leave open runs out to a spike)
    let sum = Math.exp(-bound / soft);
    for (const [n, dist] of planes) {
      const c = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
      if (c > 1e-3) sum += Math.exp(-(dist / c) / soft);
    }
    const q = -soft * Math.log(Math.max(sum, 1e-30));
    return q * (1 + 0.035 * noise.fbm(d[0] * 2.2, d[1] * 2.2, d[2] * 2.2, 3));
  };
  const id = idBase(seed);
  const lods = [[18, 36], [10, 20], [6, 12]].map(([lat, lon]) => {
    const kit = new MeshKit();
    const pts: V3[][] = [];
    let ymin = Infinity, ymax = -Infinity;
    for (let j = 1; j < lat; j++) {
      const phi = Math.PI / 2 - (j / lat) * Math.PI;
      const row: V3[] = [];
      for (let i = 0; i < lon; i++) {
        const th = (i / lon) * Math.PI * 2;
        const d: V3 = [Math.cos(phi) * Math.cos(th), Math.sin(phi), Math.cos(phi) * Math.sin(th)];
        const q = reach(d);
        const p: V3 = [d[0] * q, d[1] * q, d[2] * q];
        row.push(p); ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]);
      }
      pts.push(row);
    }
    const qTop = reach([0, 1, 0]), qBot = reach([0, -1, 0]);
    ymin = Math.min(ymin, -qBot); ymax = Math.max(ymax, qTop);
    const lift = -ymin;
    const v = (p: V3) => {
      const t = (p[1] - ymin) / (ymax - ymin);
      return kit.vert(p[0], p[1] + lift, p[2], id + Math.min(0.999, t), 0.62 + 0.38 * t, 1);
    };
    const top = v([0, qTop, 0]);
    const rings = pts.map((row) => row.map(v));
    const bot = v([0, -qBot, 0]);
    // (rows run from the top down; seen from outside the angles turn the strip's way when walked bottom to top)
    kit.fanUp(top, rings[0]);
    for (let j = rings.length - 1; j > 0; j--) kit.strip(rings[j], rings[j - 1]);
    kit.fanDown(bot, rings[rings.length - 1]);
    return { mesh: kit.finish(), h: ymax - ymin };
  });
  const h0 = lods[0].h;
  let rmax = 0;
  for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; rmax = Math.max(rmax, reach([Math.cos(a), 0, Math.sin(a)])); }
  return {
    kind, name: `${kind}-${seed}`, seed, lods: lods.map((l) => l.mesh), height: h0, radius: rmax * 1.05,
    posts: [{ x: 0, z: 0, y0: 0, y1: h0, r: rmax * 0.7 }],
    tops: [{ x: 0, z: 0, r: rmax * 0.5, y: h0 }],
  };
}

/** a boulder or talus block, about 1 m in reach */
export const boulder = (seed: number) => block('boulder', seed);
/** a fallen slab, about 1 m in reach, thin */
export const slab = (seed: number) => block('slab', seed);
