// The solar system (AU): the Sun, the eight planets where they are today on their real orbits (J2000 elements), the
// orbits themselves, the asteroid belt, the Kuiper belt and the Oort cloud far out. Close to the Earth, its own level
// takes over from the dot this one draws.
import type { Kit, StorageBuffer } from '@ericrius1/weft';
import solarShader from '../../../shaders/c_solar.wgsl';
import type { CosmosRenderer, Level } from '../renderer';
import { PointSet, drawPoints, rng } from './points';
import { AU, PLANETS, planetPos, orbitPoint, type Ladder } from '../frames';
import type { Vec3 } from 'math';

const SEGS = 360;
const KIND: Record<string, number> = { jupiter: 1, saturn: 2, uranus: 0, neptune: 0, mercury: 3, venus: 0, earth: 3, mars: 3 };

export class Solar {
  readonly lv: Level;
  readonly belts: Level;
  readonly pts = new PointSet(42000);
  private planets: StorageBuffer;
  private pdata = new Float32Array(PLANETS.length * 8);
  private readonly pos: Vec3 = [0, 0, 0];
  /** how much the Earth's own level has taken over (it hides this level's Earth) */
  earthShare = 0;

  constructor(kit: Kit, R: CosmosRenderer, private ladder: Ladder) {
    this.lv = R.level('solar', ladder.solar, [17.2, 16.2, 6.6, 5.9]);
    this.belts = R.level('solar.belts', ladder.solar, [17.6, 16.6, 10.6, 9.8]);
    this.planets = kit.storage({ label: 'planets', data: this.pdata, stride: 32 });
    // the orbits, drawn as strips joined end to end (their index in w)
    const o = new Float32Array(PLANETS.length * (SEGS + 1) * 4);
    const d = ladder.day, T = d / 36525;
    PLANETS.forEach((p, k) => {
      const [a, e, i, , w, O] = p.el.map((x, j) => x + p.d[j] * T);
      for (let s = 0; s <= SEGS; s++) {
        orbitPoint(a, e, i, w, O, (s / SEGS) * Math.PI * 2, this.pos);
        o.set([this.pos[0], this.pos[1], this.pos[2], k], (k * (SEGS + 1) + s) * 4);
      }
    });
    const orbit = kit.storage({ label: 'orbits', data: o, stride: 16 });
    const L = this.lv.L, on = this.lv.on;
    R.scene.draw(solarShader, { label: 'orbits', vertex: 'vs_orbit', fragment: 'fs_orbit', topology: 'line-list', bind: { L, orbit }, count: (PLANETS.length * (SEGS + 1) - 1) * 2, blend: 'premultiplied', cull: 'none', enabled: on });
    this.populate();
    drawPoints(kit, R, this.belts, this.pts, 'belts');
    R.scene.fullscreen(solarShader, { label: 'sun', fragment: 'fs_sun', bind: { L }, blend: 'premultiplied', enabled: on });
    R.scene.draw(solarShader, { label: 'planets', vertex: 'vs_planet', fragment: 'fs_planet', bind: { L, planets: this.planets }, count: 6, instances: PLANETS.length, blend: 'premultiplied', cull: 'none', enabled: on });
  }

  private populate() {
    const r = rng(3), P = this.pts;
    const ring = (n: number, r0: number, r1: number, thick: number, c: number[], lum: number) => {
      for (let i = 0; i < n; i++) {
        const rad = r0 + (r1 - r0) * Math.sqrt(r.next()), th = r.next() * Math.PI * 2;
        P.push(rad * Math.cos(th), r.gauss() * thick * rad, rad * Math.sin(th), 0, c[0], c[1], c[2], lum * (0.4 + r.next()));
      }
    };
    ring(16000, 2.15, 3.3, 0.06, [0.75, 0.68, 0.6], 0.25);
    ring(12000, 30, 50, 0.08, [0.6, 0.7, 0.85], 2.5);
    // the Oort cloud: a sphere of comets, 2,000 to 50,000 AU
    for (let i = 0; i < 3500; i++) {
      const rad = 2000 * Math.pow(25, r.next()), th = Math.acos(2 * r.next() - 1), ph = r.next() * Math.PI * 2;
      P.push(rad * Math.sin(th) * Math.cos(ph), rad * Math.cos(th), rad * Math.sin(th) * Math.sin(ph), 0, 0.6, 0.75, 1.0, 1.2 * (0.3 + r.next()));
    }
  }

  update(S: number) {
    const Sau = S / AU, lv = this.lv, o = lv.origin, l = Math.log10(S);
    const d = this.ladder.day;
    PLANETS.forEach((p, k) => {
      planetPos(p, d, this.pos);
      // (the Earth fades as its own level comes in)
      const hide = p.id === 'earth' && l < 9.4;
      // relative to the level's origin, in doubles
      this.pdata.set([this.pos[0] - o[0], this.pos[1] - o[1], this.pos[2] - o[2], hide ? 0 : p.r * 1000 / AU, p.color[0], p.color[1], p.color[2], KIND[p.id]], k * 8);
    });
    this.planets.write(this.pdata);
    // the Sun relative to the origin; its brightness held as the zoom changes
    const sunGain = 0.35;
    const orbitA = 0.5 * Math.min(1, Math.max(0, (l - 10.2) / 1.5)) * Math.min(1, Math.max(0, (16.4 - l) / 1.2));
    lv.L.set({ sunPos: [-o[0], -o[1], -o[2]], a: [sunGain, 1.0, orbitA, 0] });
    this.belts.L.set({ a: [0.0045 * Math.max(Sau, 3) ** 2, 0, Math.max(Sau * 0.004, 0.002), 1] });
  }
}
