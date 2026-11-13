// The cosmic web (megaparsecs, the cosmos frame: the galactic centre at the origin, the galaxy's disc tilted in it as the
// ladder has it). Where it has been mapped it's the real one: the 43,533 galaxies of the 2MASS Redshift Survey where
// they are out to 300 Mpc (Virgo, Perseus–Pisces, the Great Wall, and the empty wedge the Milky Way's own plane hides,
// the zone of avoidance), coloured by type, over the real density they trace within 200 Mpc (shaders/c_web.wgsl);
// beyond, the baked cellular noise, out to the edge of the observable universe (14 Gpc), where Planck's map of the
// cosmic microwave background closes the sphere. The Local Group is a level of its own (localgroup.ts), made here.
// Each file is fetched the first time what it draws comes near, not at boot.
import { generateMips, type Kit, type StorageBuffer, type Draw, type UniformBuffer, type Texture } from '@ericrius1/weft';
import webShader from '../shaders/c_web.wgsl';
import type { CosmosRenderer, Level } from '../renderer';
import { PointSet, drawPoints } from './points';
import { noiseTex } from '../noisetex';
import type { Frame, Ladder } from '../frames';
import type { Vec3 } from 'math';
import { SkyAxes, decodeImage, fetchBytes, fetchJson, eqToGal, lbOf, type NamedPlace } from './deepsky';
import { LocalGroup } from './localgroup';

const EDGE = 14300;   // Mpc: the last-scattering surface (comoving)
/** the galaxies drawn: 2MRS to 300 Mpc (a phone the brightest of them) */
const NEARBY_MAX = 300, NEARBY_PHONE = 15000;
/** 2MRS's types (2mrs.json): unknown, spiral, elliptical or lenticular, other (irregular, peculiar) */
const TYPE_COLOR = [[0.92, 0.88, 0.82], [0.7, 0.82, 1.0], [1.0, 0.8, 0.55], [0.62, 0.76, 1.0]];

interface Structure { name: string; kind: string; xyzMpc: [number, number, number]; redshiftDistanceMpc?: number; lengthMpc?: number }
interface Structures { structures: Structure[] }

/** how big a named structure is drawn round its place (Mpc), for a guide's ring: a cluster's core about 2 Mpc, a wall
 *  half its length; the Boötes Void about 300 million light-years (92 Mpc) across. (structures.json's radiusMpc for
 *  it is from a source that used H0 = 50: not used.) */
const extentOf = (s: Structure) => s.kind === 'void' ? 46 : s.kind === 'wall' ? (s.lengthMpc ?? 200) / 2 : s.kind === 'supercluster' ? 10 : 2;

export class Web {
  readonly lv: Level;
  readonly vol: Level;
  readonly localGroup: LocalGroup;
  /** the galaxies (2MRS): room for them all, empty (and not drawn) till they're in */
  readonly pts: PointSet;
  private ptsBuf: StorageBuffer;
  /** each drawn galaxy's record in 2mrs.bin */
  private srcIndex: Int32Array | null = null;
  private structures: Structure[] | null = null;
  private structuresAsked = false;
  private readonly cosmos: Frame;
  private nearby: 'none' | 'asked' | 'in' = 'none';
  /** the real density and Planck's map: asked for once the web shows, then fading in (0..1) */
  private dens: 'none' | 'asked' | 'in' = 'none';
  private cmb: 'none' | 'asked' | 'in' = 'none';
  private densIn = 0;
  private cmbIn = 0;
  private lastT = 0;
  readonly axes: SkyAxes;
  private readonly D: UniformBuffer<any>;
  private readonly draws: Draw[] = [];
  private readonly kit: Kit;
  private readonly small: boolean;
  private readonly vscale: number;
  /** the real web's light: its gain, and the log density (over the mean) where it starts */
  realGain = 0.2;
  realFrom = 0.6;

  constructor(kit: Kit, R: CosmosRenderer, ladder: Ladder) {
    this.kit = kit;
    this.small = R.light;
    this.vscale = R.volumeScale;
    this.axes = new SkyAxes(ladder);
    this.cosmos = ladder.cosmos;
    this.lv = R.level('web', ladder.cosmos, [99, 98, 21.9, 21.2]);
    this.vol = R.level('web.vol', ladder.cosmos, [99, 98, 24.3, 23.5]);
    this.D = kit.uniforms(webShader.structs.Deep, 'web.deep');
    this.D.set({ ...this.axes.uniforms(), k: [0, 0, this.realGain, this.vscale], m: [this.realFrom, 150, 195, 0] });
    // (stand-ins till the real ones are in: never read while their share is 0)
    const densTex = kit.texture({ label: 'web.density.none', format: 'r8unorm', size: [1, 1, 1], dimension: '3d' });
    const cmbTex = kit.texture({ label: 'web.cmb.none', format: 'r8unorm', size: [1, 1] });
    // the edge first (behind everything), the web seen whole, then the galaxies
    const { cellTex, valTex, codeTex } = noiseTex(kit, R);
    R.volume('web.vol', () => this.vol.on(), (p) => {
      const bind = { L: this.vol.L, cellTex, valTex, codeTex, densTex, cmbTex, D: this.D };
      this.draws.push(p.fullscreen(webShader, { label: 'web.cmb', fragment: 'fs_cmb', bind, blend: 'premultiplied', enabled: () => this.vol.on() }) as unknown as Draw);
      this.draws.push(p.fullscreen(webShader, { label: 'web.vol', fragment: 'fs_vol', bind, blend: 'premultiplied', enabled: () => this.vol.on() }) as unknown as Draw);
    });
    this.pts = new PointSet(R.light ? NEARBY_PHONE : 43533);
    this.pts.count = this.pts.max;
    this.ptsBuf = drawPoints(kit, R, this.lv, this.pts, 'web', () => this.lv.on() && this.nearby === 'in');
    this.localGroup = new LocalGroup(kit, R, ladder, this.axes);
  }

  /** the 2MRS galaxies, brightest first, as points in the cosmos frame */
  private loadNearby() {
    this.nearby = 'asked';
    fetchBytes('galaxies/2mrs.bin').then((buf) => {
      const f = new Float32Array(buf), u = new Uint32Array(buf);
      const P = this.pts;
      P.count = 0;
      const at: [number, number, number] = [0, 0, 0];
      const src = new Int32Array(P.max);
      for (let i = 0; i < f.length / 5 && P.count < P.max; i++) {
        const x = f[i * 5], y = f[i * 5 + 1], z = f[i * 5 + 2], logL = f[i * 5 + 3], tf = u[i * 5 + 4];
        const d = Math.hypot(x, y, z);
        // (the Local Group's own are drawn by its level; those 2MRS could only put at 1 Mpc aren't drawn at all)
        if (d > NEARBY_MAX || d < 1.5 || (tf >> 8) & 2) continue;
        this.axes.eqToCosmos([x, y, z], at);
        // brightness by K-band luminosity, size roughly with it (a 3×10¹⁰ L☉ galaxy about 12 kpc across its glow)
        const lum = Math.pow(10, logL - 10.5);
        const c = TYPE_COLOR[tf & 255] ?? TYPE_COLOR[0];
        src[P.count] = i;
        P.push(at[0], at[1], at[2], 0.012 * Math.pow(lum, 0.35), c[0], c[1], c[2], lum);
      }
      this.srcIndex = src.subarray(0, P.count);
      // (the rest of the records empty, passed over)
      const n = P.count;
      P.data.fill(0, n * 8);
      this.ptsBuf.write(P.data);
      P.count = P.max;
      this.nearby = 'in';
    }, (e) => console.warn('web: no 2MRS', e));
  }

  /** the real density of the nearest 200 Mpc (a phone's at half the resolution) */
  private loadDensity() {
    this.dens = 'asked';
    fetchBytes('galaxies/density.bin').then((buf) => {
      let src = new Uint8Array(buf), N = 128;
      if (this.small) {
        // (each 2×2×2 block averaged; any outside the sphere is outside)
        const M = 64, out = new Uint8Array(M * M * M);
        for (let z = 0; z < M; z++) for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
          let s = 0, zero = false;
          for (let k = 0; k < 8; k++) {
            const v = src[(2 * x + (k & 1)) + 128 * ((2 * y + ((k >> 1) & 1)) + 128 * (2 * z + (k >> 2)))];
            if (!v) zero = true;
            s += v;
          }
          out[x + M * (y + M * z)] = zero ? 0 : Math.round(s / 8);
        }
        src = out; N = M;
      }
      const t = this.kit.texture({ label: 'web.density', format: 'r8unorm', size: [N, N, N], dimension: '3d', usage: ['sample', 'copy-dst'] });
      this.kit.queue.writeTexture({ texture: t.gpu }, src, { bytesPerRow: N, rowsPerImage: N }, [N, N, N]);
      for (const d of this.draws) d.set('densTex', t);
      this.dens = 'in';
    }, (e) => console.warn('web: no density', e));
  }

  /** Planck's map of the microwave background (a phone's at half the resolution) */
  private loadCmb() {
    this.cmb = 'asked';
    decodeImage(['cmb/smica_4k.webp'], 'gray', this.small ? 2048 : 0).then((m) => {
      const t: Texture = this.kit.texture({ label: 'web.cmb', format: 'r8unorm', size: [m.width, m.height], mips: 'full' });
      t.write(m.data);
      generateMips(this.kit, t);
      for (const d of this.draws) d.set('cmbTex', t);
      this.cmb = 'in';
    }, (e) => console.warn('web: no microwave map', e));
  }

  /** what a guide can point at in the web: the named clusters, superclusters, voids and walls (structures.json) and the
   *  Local Group's galaxies with names, where they are in the cosmos frame (megaparsecs). Fetched the first time it's
   *  asked. The structures sit where the galaxies are drawn: at their redshift distance, as 2MRS has them. */
  async named(): Promise<NamedPlace[]> {
    const s = await fetchJson<Structures>('galaxies/structures.json');
    const out: NamedPlace[] = s.structures.map((x) => {
      const [l, b] = lbOf(eqToGal(x.xyzMpc));
      return { name: x.name, kind: x.kind, frame: 'cosmos' as const, at: this.axes.eqToCosmos(x.xyzMpc), distanceMpc: Math.hypot(...x.xyzMpc), l, b };
    });
    return [...out, ...(await this.localGroup.named())];
  }

  /** where a named thing the web draws is (ui/things.ts FindsThings): 'galaxy', the Local Group's by name as
   *  localgroup.json has them; 'structure', the named clusters, walls and voids as structures.json has them (with a ring
   *  for their extent); null until their file is in (asked for the first time this is) */
  find(kind: string, name: string): { frame: Frame; at: Vec3; r?: number; name?: string; ring?: boolean } | null {
    if (kind === 'galaxy') return this.localGroup.find(name);
    if (kind === 'level' && name === 'web.cmb') return { frame: this.cosmos, at: [0, 0, 0], r: EDGE, name: 'The microwave background', ring: true };
    if (kind !== 'structure') return null;
    if (!this.structuresAsked) {
      this.structuresAsked = true;
      fetchJson<Structures>('galaxies/structures.json').then((s) => { this.structures = s.structures; }, (e) => console.warn('web: no structures', e));
    }
    const s = this.structures?.find((x) => x.name === name);
    if (!s) return null;
    return { frame: this.cosmos, at: this.axes.eqToCosmos(s.xyzMpc), r: extentOf(s), name: s.name, ring: s.kind === 'void' || s.kind === 'wall' };
  }

  /** the 2MRS galaxy drawn nearest a point on the screen (css px, `w` × `h` the view's size, `tanHalf` the tangent of
   *  half its vertical field): its record's index in 2mrs.bin, or null if none is drawn within `within` px */
  nearest(x: number, y: number, w: number, h: number, tanHalf: number, within = 24): number | null {
    const src = this.srcIndex, lv = this.lv;
    if (!src || this.nearby !== 'in' || !lv.on()) return null;
    const d = this.pts.data, asp = w / Math.max(1, h);
    let best = within * within, at: number | null = null;
    for (let i = 0; i < src.length; i++) {
      const rx = d[i * 8] - lv.origin[0] - lv.eye[0], ry = d[i * 8 + 1] - lv.origin[1] - lv.eye[1], rz = d[i * 8 + 2] - lv.origin[2] - lv.eye[2];
      const z = rx * lv.fwd[0] + ry * lv.fwd[1] + rz * lv.fwd[2];
      if (z <= 0) continue;
      const sx = ((rx * lv.right[0] + ry * lv.right[1] + rz * lv.right[2]) / (z * tanHalf * asp) * 0.5 + 0.5) * w;
      const sy = (0.5 - (rx * lv.up[0] + ry * lv.up[1] + rz * lv.up[2]) / (z * tanHalf) * 0.5) * h;
      const e = (sx - x) * (sx - x) + (sy - y) * (sy - y);
      if (e < best) { best = e; at = src[i]; }
    }
    return at;
  }

  update(S: number) {
    const Smpc = S / this.lv.frame.unit;
    const l = Math.log10(S);
    const now = performance.now(), dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    // (each asked for as it first comes near: the map with the web, the density once it's within reach, the
    // galaxies as they show)
    if (this.vol.on() && this.cmb === 'none') this.loadCmb();
    if (this.vol.on() && this.dens === 'none' && l < 26.0) this.loadDensity();
    if (this.cmb === 'in') this.cmbIn = Math.min(1, this.cmbIn + dt / 0.6);
    if (this.dens === 'in') this.densIn = Math.min(1, this.densIn + dt / 0.6);
    // the galaxies: in from 300 Mpc or so, the whole survey a ball at the web's middle, gone into the Local Group
    const w = this.lv.weight * (1 - Math.max(0, Math.min(1, (l - 24.7) / 0.6)));
    if (w > 0 && this.nearby === 'none') this.loadNearby();
    // (exposure that follows the zoom: what's at the view's distance always reads)
    this.lv.L.set({ weight: w, a: [0.3 * Math.max(Smpc, 0.6) * Math.min(Math.max(Smpc, 0.6), 8), 1, Math.max(Smpc * 0.04, 0.02), 1], b: [EDGE, 0, 0, 0] });
    this.localGroup.update(S);
    // (the web's brighter seen whole, where the voids between near filaments take up more of the view)
    // (and faint, not gone, seen whole from outside; past the edge, where it's what our marble holds (levels/beyond.ts),
    // bright again)
    const gain = 0.8 * (1 + 0.5 * Math.max(0, Math.min(1, (l - 24.8) / 1.0))) * (1 - 0.35 * Math.max(0, Math.min(1, (l - 26.3) / 0.5)))
      * (1 + 1.4 * Math.max(0, Math.min(1, (l - 26.9) / 0.4)));
    // (the microwave background's shell fainter there too, a skin round the web rather than a mottled ball)
    const cmb = 1 - 0.7 * Math.max(0, Math.min(1, (l - 26.9) / 0.4));
    // (fewer steps from outside the shell, where the web's a faint skin and every ray crosses the whole of it: its
    // samples scatter across the noise, and each costs a miss)
    const steps = Smpc > 6000 ? Math.round(28 - 16 * Math.max(0, Math.min(1, (l - 26.3) / 0.5))) : 36;
    this.vol.L.set({ b: [EDGE, cmb, 0, 0], c: [gain, steps, l > 26.3 ? 1 : 0, 0] });
    // (the real web's gain a little higher seen from farther: its haze of walls thins out against the noise's threads)
    const realK = this.realGain * Math.min(3, Math.max(1, Math.sqrt(Smpc / 64)));
    this.D.set({ k: [this.densIn, this.cmbIn, realK, this.vscale], m: [this.realFrom, 150, 195, 0] });
  }
}
