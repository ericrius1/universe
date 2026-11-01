// The Sun's neighbourhood (parsecs, the Sun at the origin, the galaxy's axes): the bright stars we know by name where
// they really are (galactic longitude, latitude and distance), and a crowd of faint red dwarfs at the real density
// (~0.1 per cubic parsec) to 40 pc. From inside the solar system these are the night sky's stars.
import type { Kit } from '@ericrius1/weft';
import type { CosmosRenderer, Level } from '../renderer';
import { PointSet, drawPoints, rng } from './points';
import type { Ladder } from '../frames';

/** name, l (deg), b (deg), distance (pc), temperature (K), luminosity (Suns) */
export const NAMED: [string, number, number, number, number, number][] = [
  ['α Centauri', 315.7, -0.7, 1.34, 5800, 1.5],
  ['Barnard\'s Star', 31.0, 14.1, 1.83, 3100, 0.0035],
  ['Sirius', 227.2, -8.9, 2.64, 9900, 25],
  ['Procyon', 213.7, 13.0, 3.51, 6500, 7],
  ['Altair', 47.7, -8.9, 5.13, 7600, 10.6],
  ['Vega', 67.4, 19.2, 7.68, 9600, 40],
  ['Fomalhaut', 20.5, -64.9, 7.7, 8600, 16],
  ['Arcturus', 15.1, 69.1, 11.3, 4300, 170],
  ['Capella', 162.6, 4.6, 13.1, 5000, 79],
  ['Aldebaran', 181.0, -20.2, 20.0, 3900, 440],
  ['Regulus', 226.4, 48.9, 24.3, 12500, 290],
  ['Spica', 316.1, 50.8, 77, 22400, 2000],
  ['Polaris', 123.3, 26.5, 133, 6000, 1260],
  ['Betelgeuse', 199.8, -9.0, 168, 3500, 90000],
  ['Antares', 351.9, 15.1, 170, 3600, 75000],
  ['Rigel', 209.2, -25.2, 260, 12100, 120000],
  ['Deneb', 84.3, 2.0, 800, 8500, 196000],
  ['Canopus', 261.2, -25.3, 95, 7400, 10700],
  ['Achernar', 290.8, -58.8, 43, 15000, 3150],
  ['Mimosa', 302.5, 3.2, 85, 27000, 3400],
];

/** galactic (l, b) to the galaxy frame's axes: −x toward the centre, y the north pole, z toward l = 90° */
export function galDir(l: number, b: number): [number, number, number] {
  const L = (l * Math.PI) / 180, B = (b * Math.PI) / 180;
  return [-Math.cos(B) * Math.cos(L), Math.sin(B), Math.cos(B) * Math.sin(L)];
}

function tempColor(t: number) {
  const x = t / 100;
  const R = x <= 66 ? 1 : Math.min(1, 1.293 * Math.pow(x - 60, -0.1332));
  const G = x <= 66 ? Math.max(0, Math.min(1, 0.39 * Math.log(x) - 0.634)) : Math.min(1, 1.13 * Math.pow(x - 60, -0.0755));
  const B = x >= 66 ? 1 : x <= 19 ? 0 : Math.max(0, Math.min(1, 0.543 * Math.log(x - 10) - 1.196));
  const c = [R, G, B].map((v) => Math.pow(v, 2.2)), m = Math.max(...c);
  return c.map((v) => v / m);
}

export class Local {
  readonly lv: Level;
  readonly pts = new PointSet(40000);
  sky = 1;

  constructor(kit: Kit, R: CosmosRenderer, ladder: Ladder) {
    this.lv = R.level('local', ladder.local, [20.6, 19.6, -99, -100]);
    const P = this.pts;
    for (const [, l, b, d, t, lum] of NAMED) {
      const v = galDir(l, b), c = tempColor(t);
      P.push(v[0] * d, v[1] * d, v[2] * d, 0, c[0], c[1], c[2], lum);
    }
    // the crowd: mostly red dwarfs, some orange and yellow, a few white (a rough luminosity function)
    const r = rng(9);
    for (let i = 0; i < 30000; i++) {
      // (uniform in radius: dense near the Sun, thinning out to 250 pc, where only the bright are seen)
      const rad = 1.2 + 248.8 * Math.pow(r.next(), 1.15);
      const far = Math.max(1, rad / 25);
      const th = Math.acos(2 * r.next() - 1), ph = r.next() * Math.PI * 2;
      const u = r.next();
      const [t, lum] = u < 0.72 ? [2800 + r.next() * 1000, 0.0005 + Math.pow(r.next(), 3) * 0.05]
        : u < 0.9 ? [3900 + r.next() * 1300, 0.08 + r.next() * 0.4] : u < 0.97 ? [5200 + r.next() * 900, 0.6 + r.next() * 1.4] : [6200 + r.next() * 4000, 2 + Math.pow(r.next(), 2) * 30];
      const c = tempColor(t);
      P.push(rad * Math.sin(th) * Math.cos(ph), rad * Math.cos(th) * 0.55, rad * Math.sin(th) * Math.sin(ph), 0, c[0], c[1], c[2], lum * far * far);
    }
    drawPoints(kit, R, this.lv, this.pts, 'local', () => this.lv.on() && this.sky > 0.01);
  }

  update(S: number) {
    const Spc = S / this.lv.frame.unit;
    this.lv.weight *= this.sky;
    // (from inside the solar system the sky stays as bright as it is from a few parsecs)
    this.lv.L.set({ weight: this.lv.weight, a: [0.05 * Math.max(Spc, 2) * Math.min(Math.max(Spc, 2), 3.5), 0, Math.max(Spc * 0.01, 0.05), 1] });
  }
}
