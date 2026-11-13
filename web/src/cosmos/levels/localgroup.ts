// The Local Group (megaparsecs, the cosmos frame): the 146 galaxies of McConnachie's list (data/galaxies/
// localgroup.json, his 2012 table as updated in 2021) where they are. The big ones, Andromeda, Triangulum, the Large and
// Small Magellanic Clouds, and the Milky Way itself seen from out here, are small soft discs laid in their own planes
// (shaders/c_lgdisc.wgsl); the dwarfs are points, sized by their half-light radii. Fetched the first time it shows.
import type { Kit, StorageBuffer } from '@ericrius1/weft';
import discShader from '../shaders/c_lgdisc.wgsl';
import type { CosmosRenderer, Level } from '../renderer';
import { PointSet, drawPoints } from './points';
import type { Frame, Ladder } from '../frames';
import type { Vec3 } from 'math';
import { fetchJson, eqToGal, lbOf, type NamedPlace, type SkyAxes } from './deepsky';

interface LGGalaxy {
  name: string; aka?: string; type: string; candidate: boolean; MV: number | null; distanceKpc: number;
  halfLightRadiusPc: number | null; radiusKpc?: number; xyzMpc: [number, number, number]; ra: number; dec: number;
}

/** how the big ones lie on our sky: position angle (deg, north through east) and inclination (deg, 0 face on). M31 and
 *  M33 from RC3 and their rotation-curve fits; the Clouds from van der Marel's and Kallivayalil's discs */
const DISCS: Record<string, { pa: number; inc: number; kind: number; color: [number, number, number] }> = {
  Andromeda: { pa: 38, inc: 77, kind: 0, color: [0.92, 0.88, 0.9] },
  Triangulum: { pa: 23, inc: 54, kind: 0, color: [0.72, 0.82, 1.0] },
  LMC: { pa: 170, inc: 35, kind: 1, color: [0.72, 0.8, 1.0] },
  SMC: { pa: 45, inc: 70, kind: 1, color: [0.75, 0.82, 1.0] },
};
/** absolute magnitudes the list has too bright, seen through heavy reddening and over-corrected for it (the list gives
 *  the LMC −21.0, brighter than the Milky Way): McConnachie 2012's own values instead */
const MV_FIX: Record<string, number> = { LMC: -18.1, SMC: -16.8, IC10: -15.0 };

const lumOf = (mv: number) => Math.pow(10, -0.4 * (mv - 4.83));
const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class LocalGroup {
  readonly lv: Level;
  /** the dwarfs */
  readonly pts = new PointSet(160);
  private ptsBuf: StorageBuffer;
  private discBuf: StorageBuffer;
  private state: 'none' | 'asked' | 'in' = 'none';
  private list: LGGalaxy[] | null = null;
  /** the dwarfs' light against the big ones': the eye's response, not the light's (a dwarf of 10⁵ Suns is a ten-
   *  millionth of Andromeda, and would never be seen), so their luminosity is shown as its 0.45 power */
  dwarfGain = 0.3;
  discGain = 5e-5;

  private readonly cosmos: Frame;

  constructor(kit: Kit, R: CosmosRenderer, ladder: Ladder, private axes: SkyAxes) {
    this.cosmos = ladder.cosmos;
    this.lv = R.level('localgroup', ladder.cosmos, [25.2, 24.3, 21.2, 20.4]);
    const on = () => this.lv.on() && this.state === 'in';
    this.discBuf = kit.storage({ label: 'localgroup.discs', size: 5 * 16 * 4, stride: 16 * 4 });
    R.scene.draw(discShader, { label: 'localgroup.discs', vertex: 'vs', fragment: 'fs', bind: { L: this.lv.L, discs: this.discBuf }, count: 6, instances: 5, blend: 'premultiplied', cull: 'none', enabled: on });
    this.pts.count = this.pts.max;
    this.ptsBuf = drawPoints(kit, R, this.lv, this.pts, 'localgroup', on);
  }

  private loading: Promise<LGGalaxy[]> | null = null;
  private load() {
    return this.loading ??= fetchJson<{ galaxies: LGGalaxy[] }>('galaxies/localgroup.json').then((j) => (this.list = j.galaxies));
  }

  private fill(list: LGGalaxy[]) {
    const P = this.pts, A = this.axes;
    P.count = 0;
    const discs = new Float32Array(5 * 16);
    let nd = 0;
    const at: [number, number, number] = [0, 0, 0];
    for (const g of list) {
      const mv = MV_FIX[g.name] ?? g.MV ?? -8;
      const lum = lumOf(mv) / 3e10;
      const disc = DISCS[g.name];
      if (g.name === 'Milky Way') {
        // ours, seen from out here: face on to the galactic pole, round its centre (the cosmos frame's origin)
        const e1 = A.galToCosmos([1, 0, 0]), e2 = A.galToCosmos([0, 0, 1]);
        discs.set([0, 0, 0, (g.radiusKpc ?? 15) / 1000, ...e1, lum, ...e2, 0, 1.0, 0.9, 0.82, 1], nd++ * 16);
        continue;
      }
      A.eqToCosmos(g.xyzMpc, at);
      if (disc) {
        // its plane from its position angle and inclination on our sky (equatorial axes): the major axis along the PA, the
        // normal tipped from the line of sight toward the minor axis
        const d = Math.hypot(...g.xyzMpc), n = g.xyzMpc.map((v) => v / d);
        const zn = n[2], N = [-zn * n[0], -zn * n[1], 1 - zn * zn], nl = Math.hypot(...N);
        const Nn = N.map((v) => v / nl);
        const E = [Nn[1] * n[2] - Nn[2] * n[1], Nn[2] * n[0] - Nn[0] * n[2], Nn[0] * n[1] - Nn[1] * n[0]];
        // (east = north × line of sight: toward increasing right ascension)
        const pa = (disc.pa * Math.PI) / 180, inc = (disc.inc * Math.PI) / 180;
        const maj = [0, 1, 2].map((i) => Nn[i] * Math.cos(pa) + E[i] * Math.sin(pa));
        const min = [0, 1, 2].map((i) => -Nn[i] * Math.sin(pa) + E[i] * Math.cos(pa));
        const nrm = [0, 1, 2].map((i) => -n[i] * Math.cos(inc) + min[i] * Math.sin(inc));
        const e2 = [nrm[1] * maj[2] - nrm[2] * maj[1], nrm[2] * maj[0] - nrm[0] * maj[2], nrm[0] * maj[1] - nrm[1] * maj[0]];
        const c1 = A.galToCosmos(eqToGal(maj)), c2 = A.galToCosmos(eqToGal(e2));
        discs.set([at[0], at[1], at[2], (g.radiusKpc ?? 3) / 1000, ...c1, lum, ...c2, disc.kind, ...disc.color, 0], nd++ * 16);
        continue;
      }
      // (the one candidate the list marks a disputed overdensity in our own disc, Canis Major, not drawn)
      if (g.type === 'candidate') continue;
      // a dwarf: a point by type (gas-poor spheroidals and ellipticals warm, gas-rich irregulars blue)
      const c = g.type === 'irregular' ? [0.7, 0.8, 1.0] : g.type === 'candidate' ? [0.8, 0.8, 0.8] : [1.0, 0.86, 0.68];
      const size = g.radiusKpc ? g.radiusKpc / 1000 : (g.halfLightRadiusPc ?? 200) * 2e-6;
      P.push(at[0], at[1], at[2], size, c[0], c[1], c[2], this.dwarfGain * Math.pow(lum, 0.45));
    }
    const n = P.count;
    P.data.fill(0, n * 8);
    this.ptsBuf.write(P.data);
    P.count = P.max;
    this.discBuf.write(discs);
  }

  /** the Local Group's named galaxies (everything in the list but the Milky Way), where they are in the cosmos frame */
  async named(): Promise<NamedPlace[]> {
    const list = await this.load();
    return list.filter((g) => g.name !== 'Milky Way').map((g) => {
      const [l, b] = lbOf(eqToGal(g.xyzMpc));
      return { name: g.name, aka: g.aka, kind: g.type, frame: 'cosmos' as const, at: this.axes.eqToCosmos(g.xyzMpc), distanceMpc: g.distanceKpc / 1000, l, b };
    });
  }

  /** where one of the Local Group's galaxies is, by its name in the list (ui/things.ts), with its radius; null until
   *  the list is in (asked for the first time this is) */
  find(name: string): { frame: Frame; at: Vec3; r?: number; name?: string } | null {
    if (!this.list) { void this.load().catch(() => {}); return null; }
    const g = this.list.find((x) => x.name === name || x.aka === name);
    if (!g) return null;
    const at: Vec3 = g.name === 'Milky Way' ? [0, 0, 0] : this.axes.eqToCosmos(g.xyzMpc);
    return { frame: this.cosmos, at, r: g.radiusKpc ? g.radiusKpc / 1000 : (g.halfLightRadiusPc ?? 300) * 1e-6, name: g.aka ? `${g.name} (${g.aka})` : g.name };
  }

  update(S: number) {
    const l = Math.log10(S), Smpc = S / this.lv.frame.unit;
    if (this.state === 'none' && this.lv.weight > 0) {
      this.state = 'asked';
      this.load().then((list) => { this.fill(list); this.state = 'in'; }, (e) => console.warn('local group: not loaded', e));
    }
    // (exposure that follows the zoom, as the web's galaxies'; the Milky Way's own disc gone as its volume comes)
    const s = Math.max(Smpc, 0.02);
    this.lv.L.set({ weight: this.lv.weight, a: [0.3 * Math.max(s, 0.6) * Math.min(Math.max(s, 0.6), 8), 1, Math.max(Smpc * 0.01, 0.002), 1], c: [ss(22.6, 23.6, l), this.discGain * (1 + 3 * ss(21.5, 22.7, l)), 0, 0] });
  }
}
