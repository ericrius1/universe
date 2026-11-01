// The Milky Way (kiloparsecs): its glow and dust as a volume (shaders/c_galaxy.wgsl), and its stars as points drawn from
// the same disc, arms, bar and bulge, with the globular clusters in the halo. Seen whole it's a barred spiral; from the
// Sun's place 8.2 kpc out it's the band across the sky behind every level below.
import type { Kit } from '@ericrius1/weft';
import galShader from '../shaders/c_galaxy.wgsl';
import type { CosmosRenderer, Level } from '../renderer';
import { PointSet, drawPoints, rng } from './points';
import type { Ladder } from '../frames';

const PITCH = 0.22, BAR = 0.44;

export class Galaxy {
  readonly lv: Level;
  readonly stars: Level;
  readonly pts = new PointSet(260000);
  /** the sky's visibility below (a daytime sky hides it): set by the app */
  sky = 1;

  constructor(kit: Kit, R: CosmosRenderer, ladder: Ladder) {
    this.lv = R.level('galaxy', ladder.galaxy, [23.6, 22.6, -99, -100]);
    // (the stars are a second view of the same frame, with their own gains)
    this.stars = R.level('galaxy.stars', ladder.galaxy, [23.0, 22.2, -99, -100]);
    this.populate();
    R.scene.fullscreen(galShader, { label: 'galaxy', fragment: 'fs', bind: { L: this.lv.L }, blend: 'premultiplied', enabled: () => this.lv.on() && this.sky > 0.01 });
    drawPoints(kit, R, this.stars, this.pts, 'galaxy.stars', () => this.stars.on() && this.sky > 0.01);
  }

  private populate() {
    const r = rng(42), P = this.pts;
    const sun = [8.2, 0.02, 0];
    const temp = (t: number) => {
      // a black body, roughly (as blackbody() in cosmos.wgsl)
      const x = t / 100;
      const R = x <= 66 ? 1 : Math.min(1, 1.293 * Math.pow(x - 60, -0.1332));
      const G = x <= 66 ? Math.max(0, Math.min(1, 0.39 * Math.log(x) - 0.634)) : Math.min(1, 1.13 * Math.pow(x - 60, -0.0755));
      const B = x >= 66 ? 1 : x <= 19 ? 0 : Math.max(0, Math.min(1, 0.543 * Math.log(x - 10) - 1.196));
      const c = [R, G, B].map((v) => Math.pow(v, 2.2)), m = Math.max(...c);
      return c.map((v) => v / m);
    };
    const star = (x: number, y: number, z: number, young: boolean) => {
      // (none in the Sun's own bubble: the neighbourhood's stars are drawn by their own level)
      if (Math.hypot(x - sun[0], y - sun[1], z - sun[2]) < 0.25) return;
      const hot = young ? r.next() < 0.7 : r.next() < 0.08;
      const T = hot ? 6500 + Math.pow(r.next(), 2) * 25000 : 3200 + r.next() * 3200;
      const c = temp(T);
      const lum = Math.exp(r.gauss() * 1.0) * (hot ? 3 : 1);
      P.push(x, y, z, 0, c[0], c[1], c[2], lum);
    };
    const N = 230000;
    let made = 0, tries = 0;
    while (made < N && tries < N * 40) {
      tries++;
      const pick = r.next();
      if (pick < 0.16) {
        // the bulge and bar
        const u = Math.abs(r.gauss()) * 1.6, v = r.gauss() * 0.55, h = r.gauss() * 0.32;
        const x = u * (r.next() < 0.5 ? -1 : 1);
        star(x * Math.cos(BAR) - v * Math.sin(BAR), h, x * Math.sin(BAR) + v * Math.cos(BAR), false);
        made++;
      } else {
        // the disc, then kept in proportion to the arms' density
        const rad = -2.8 * Math.log(Math.max(1e-6, r.next())) + 1.0;
        if (rad > 18) continue;
        const th = r.next() * Math.PI * 2;
        const x = rad * Math.cos(th), z = rad * Math.sin(th);
        const ph = th - Math.log(Math.max(rad, 0.3)) / Math.tan(PITCH);
        const arm = Math.pow(0.5 + 0.5 * Math.cos(2 * ph), 5) + 0.55 * Math.pow(0.5 + 0.5 * Math.cos(2 * ph + Math.PI), 7);
        const young = r.next() < arm * 0.9;
        if (!young && r.next() > 0.55) continue;
        const h = r.gauss() * (young ? 0.09 : 0.3);
        star(x, h, z, young);
        made++;
      }
    }
    // the globular clusters, in a halo round the centre
    for (let i = 0; i < 160; i++) {
      const rad = Math.abs(r.gauss()) * 6 + 0.5, th = Math.acos(2 * r.next() - 1), ph = r.next() * Math.PI * 2;
      const cx = rad * Math.sin(th) * Math.cos(ph), cy = rad * Math.cos(th), cz = rad * Math.sin(th) * Math.sin(ph);
      for (let k = 0; k < 40; k++) P.push(cx + r.gauss() * 0.012, cy + r.gauss() * 0.012, cz + r.gauss() * 0.012, 0, 1.0, 0.85, 0.6, 0.6);
    }
  }

  update(S: number) {
    const Sk = S / this.lv.frame.unit;
    // the volume: steps enough for the disc seen whole, more from within it
    this.lv.weight *= this.sky;
    this.stars.weight *= this.sky;
    // (inside the disc, the sky's band takes over from the march)
    const inside = Math.max(0, Math.min(1, (Math.log10(Sk) - 0.6) / -0.9));
    this.lv.L.set({ weight: this.lv.weight, a: [0.16, 14.0, 56, inside], d: [0, 0.045, 0, 0] });
    this.stars.L.set({ weight: this.stars.weight, a: [0.0005 * Math.max(Sk, 12) ** 2, 0, 0.02, 1] });
  }
}
