// The cosmic web (megaparsecs, the Milky Way at the origin): galaxies strung along filaments between clusters round
// empty voids, made from a jittered lattice of nodes, each joined to its nearest neighbours. Two tiers: a fine web out
// to 450 Mpc round us and a coarse one out to the edge of the observable universe (14 Gpc), where the cosmic microwave
// background closes the sphere (shaders/c_web.wgsl draws that shell). The Local Group and the Virgo cluster are put in
// by hand: Andromeda, the Magellanic Clouds, the Triangulum galaxy.
import type { Kit } from '@ericrius1/weft';
import webShader from '../../../shaders/c_web.wgsl';
import type { CosmosRenderer, Level } from '../renderer';
import { PointSet, drawPoints, rng } from './points';
import type { Ladder } from '../frames';

const EDGE = 14300;   // Mpc: the last-scattering surface (comoving)

export class Web {
  readonly lv: Level;
  readonly vol: Level;
  /** the galaxies show once they could be told apart */
  private ptsOn = 1;
  readonly pts = new PointSet(260000);

  constructor(kit: Kit, R: CosmosRenderer, ladder: Ladder) {
    this.lv = R.level('web', ladder.cosmos, [99, 98, 21.9, 21.2]);
    this.vol = R.level('web.vol', ladder.cosmos, [99, 98, 24.3, 23.5]);
    const r = rng(1977);
    this.tier(r, 7, 0, 70, 90000, 0.018);
    this.tier(r, 30, 70, 520, 150000, 0.022);
    this.localGroup();
    // the edge first (behind everything), the web seen whole, then the galaxies
    R.scene.fullscreen(webShader, { label: 'web.cmb', fragment: 'fs_cmb', bind: { L: this.vol.L }, blend: 'premultiplied', enabled: this.vol.on });
    R.scene.fullscreen(webShader, { label: 'web.vol', fragment: 'fs_vol', bind: { L: this.vol.L }, blend: 'premultiplied', enabled: this.vol.on });
    drawPoints(kit, R, this.lv, this.pts, 'web', () => this.lv.on() && this.ptsOn > 0);
  }

  /** nodes on a jittered lattice of `spacing` between radii r0..r1, joined to their three nearest; galaxies on them */
  private tier(r: ReturnType<typeof rng>, spacing: number, r0: number, r1: number, count: number, sizeK: number) {
    const n = Math.ceil(r1 / spacing);
    const nodes: number[][] = [];
    const grid = new Map<string, number[]>();
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) {
      const x = (i + (r.next() - 0.5) * 0.9) * spacing, y = (j + (r.next() - 0.5) * 0.9) * spacing, z = (k + (r.next() - 0.5) * 0.9) * spacing;
      const d = Math.hypot(x, y, z);
      if (d < r0 - spacing || d > r1) continue;
      // richness: most nodes are groups, a few are great clusters
      const rich = Math.pow(r.next(), 3.2) * 6 + 0.2;
      grid.set(`${i},${j},${k}`, [x, y, z, rich, i, j, k]);
      nodes.push([x, y, z, rich, i, j, k]);
    }
    const edges: [number[], number[]][] = [];
    for (const a of nodes) {
      const near: [number, number[]][] = [];
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
        if (!di && !dj && !dk) continue;
        const b = grid.get(`${a[4] + di},${a[5] + dj},${a[6] + dk}`);
        if (b) near.push([Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), b]);
      }
      near.sort((p, q) => p[0] - q[0]);
      for (const [, b] of near.slice(0, 3)) if (a[4] * 1e6 + a[5] * 1e3 + a[6] < b[4] * 1e6 + b[5] * 1e3 + b[6]) edges.push([a, b]);
    }
    const richSum = nodes.reduce((s, a) => s + a[3], 0);
    const nCluster = count * 0.38, nFil = count * 0.52, nField = count * 0.1;
    const put = (x: number, y: number, z: number, elliptical: boolean) => {
      const d = Math.hypot(x, y, z);
      if (d < 3 || d < r0 || d > r1) return;
      // spirals blue-white, ellipticals (in the clusters) gold; a spread of sizes and luminosities
      const lum = Math.exp(r.gauss() * 0.7) * (elliptical ? 1.6 : 1);
      const t = elliptical ? [1.0, 0.78, 0.5] : r.next() < 0.5 ? [0.75, 0.85, 1.0] : [0.95, 0.9, 0.85];
      this.pts.push(x, y, z, sizeK * Math.sqrt(lum) * (0.6 + r.next()), t[0], t[1], t[2], lum);
    };
    for (const a of nodes) {
      const k = Math.round((a[3] / richSum) * nCluster);
      const sig = spacing * 0.035 * Math.sqrt(a[3]);
      for (let i = 0; i < k; i++) put(a[0] + r.gauss() * sig, a[1] + r.gauss() * sig, a[2] + r.gauss() * sig, r.next() < 0.6);
    }
    for (let i = 0; i < nFil && edges.length; i++) {
      const [a, b] = edges[Math.floor(r.next() * edges.length)];
      // (thicker toward the clusters at either end)
      const t = r.next(), w = spacing * 0.02 * (1 + 2.5 * Math.pow(Math.abs(t - 0.5) * 2, 4));
      put(a[0] + (b[0] - a[0]) * t + r.gauss() * w, a[1] + (b[1] - a[1]) * t + r.gauss() * w, a[2] + (b[2] - a[2]) * t + r.gauss() * w, false);
    }
    for (let i = 0; i < nField; i++) {
      const u = r1 * Math.cbrt(r.next()), th = Math.acos(2 * r.next() - 1), ph = r.next() * Math.PI * 2;
      put(u * Math.sin(th) * Math.cos(ph), u * Math.cos(th), u * Math.sin(th) * Math.sin(ph), false);
    }
  }

  private localGroup() {
    const P = this.pts;
    // Andromeda (M31) 0.78 Mpc, a bigger spiral than ours; M33; the Magellanic Clouds (50, 62 kpc); Virgo's heart, 16.5 Mpc
    P.push(0.42, -0.31, 0.58, 0.034, 0.95, 0.88, 0.8, 2.6);
    P.push(0.5, -0.45, 0.52, 0.009, 0.75, 0.85, 1.0, 0.3);
    P.push(-0.002, -0.032, -0.038, 0.004, 0.8, 0.85, 1.0, 0.12);
    P.push(0.004, -0.044, -0.044, 0.002, 0.8, 0.85, 1.0, 0.04);
    const r = rng(5);
    for (let i = 0; i < 1500; i++) P.push(9.5 + r.gauss() * 0.9, 4.2 + r.gauss() * 0.9, -12.4 + r.gauss() * 0.9, 0.015, 1.0, 0.8, 0.55, Math.exp(r.gauss() * 0.6) * 1.4);
    // the Local Group's dwarfs
    for (let i = 0; i < 40; i++) P.push(r.gauss() * 0.35 + 0.2, r.gauss() * 0.35 - 0.15, r.gauss() * 0.35 + 0.3, 0.0015, 0.85, 0.85, 0.9, 0.02);
  }

  update(S: number) {
    const Smpc = S / this.lv.frame.unit;
    // exposure that follows the zoom: what's at the view's distance always reads
    const l = Math.log10(S);
    this.ptsOn = l < 25.6 ? 1 : 0;
    // (fading in as the web's volume fades out)
    const w = this.lv.weight * (1 - Math.max(0, Math.min(1, (l - 24.4) / 1.2)));
    this.lv.L.set({ weight: w, a: [0.3 * Math.max(Smpc, 0.6) * Math.min(Math.max(Smpc, 0.6), 8), 1, Math.max(Smpc * 0.004, 0.02), 1], b: [EDGE, 0, 0, 0] });
    this.vol.L.set({ b: [EDGE, 0, 0, 0], c: [0.09, Smpc > 6000 ? 40 : 64, 0, 0] });
  }
}
