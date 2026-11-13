// The Sun's neighbourhood (parsecs, the Sun at the origin, the galaxy's axes): the Hipparcos stars where they really
// are, with their real luminosities and colours (sky.ts; web/public/data/sky/stars.json says what's in the files) —
// the 8,874 to V 6.5 fetched when the level first shows, the 32,537 more to V 8 after them (not on a phone or a light
// GPU) — so from the Earth the sky is the real one, and flying out from the Sun changes which stars are bright, truly.
// The Sun among them, seen as a star from parsecs out. A crowd of invented faint red dwarfs at about the real density
// for flying through at parsec scale, every one of them fainter from the Sun than the catalogue reaches (so none adds a
// star to the Earth's sky). And the constellations' figures (shaders/c_figures.wgsl) joining the real stars in space:
// true from here, coming apart as the view leaves (a constellation is a view from here).
import type { Kit, StorageBuffer } from '@ericrius1/weft';
import type { Vec3 } from 'math';
import figShader from '../shaders/c_figures.wgsl';
import type { CosmosRenderer, Level } from '../renderer';
import { PointSet, drawPoints, rng } from './points';
import type { Frame, Ladder } from '../frames';
import { bvColor, fetchBin, fetchJSON, parseStars, type Figure, type Star, type StarName } from '../sky';

/** the catalogue's faintest from the Sun (stars8.bin): the crowd stays fainter than this */
const V_LIMIT = 8.0;
/** the stars' gain: flux 10^(−0.4 V) from the Sun to the light the shared PSF spreads (c_points.wgsl) */
const GAIN = 48.0;
/** the figures' light, the gap they leave round each star (px) and their width (px) */
const FIG_LIGHT = 0.022, FIG_GAP = 7, FIG_WIDTH = 1.1;
/** the Sun: its absolute magnitude and B−V, and the distance (pc) it fades in from as a star (closer, the solar
 *  system's level draws it) */
const SUN_MV = 4.83, SUN_BV = 0.65, SUN_NEAR = 0.4;
/** a star's luminosity in the points' units (its flux from 1 pc): from its V seen at d parsecs */
const lumOf = (V: number, d: number) => d * d * Math.pow(10, -0.4 * V);

/** galactic (l, b) to the galaxy frame's axes: −x toward the centre, y the north pole, z toward l = 90° */
export function galDir(l: number, b: number): [number, number, number] {
  const L = (l * Math.PI) / 180, B = (b * Math.PI) / 180;
  return [-Math.cos(B) * Math.cos(L), Math.sin(B), Math.cos(B) * Math.sin(L)];
}
/** the stars once placed here by hand (name, l, b, distance pc, …): none now — the catalogue answers (Local.find) */
export const NAMED: [string, number, number, number, number, number][] = [];

export interface NamedStar { name: string; hip: number; bayer?: string; designation: string; pos: Vec3; V: number }

export class Local {
  readonly lv: Level;
  /** the figures: a level of their own over the zoom (the band where the sky is the solar system's backdrop, and out to
   *  where they've come apart) */
  readonly fig: Level;
  readonly pts = new PointSet(8874 + 32537 + 1 + 14000, true);
  /** the sky's visibility below (a daytime sky hides it): set by the app */
  sky = 1;
  /** the constellations' figures: 0 off, 1 as they are (scaled between) */
  figures = 1;
  /** the catalogue, as far as it's in (brightest first), by Hipparcos number, and the named stars among it */
  readonly stars: Star[] = [];
  readonly byHip = new Map<number, Star>();
  readonly named: NamedStar[] = [];
  /** the figures as loaded (lines.json, by abbreviation) */
  figureSet: Record<string, Figure> = {};
  /** resolves once the bright stars, their names and the figures are in */
  readonly ready: Promise<void>;
  private start!: () => void;
  private asked = false;
  private readonly kit: Kit;
  private readonly R: CosmosRenderer;
  private segs = 0;
  private segBuf: StorageBuffer;
  private names: Record<string, StarName> = {};

  constructor(kit: Kit, R: CosmosRenderer, ladder: Ladder) {
    this.kit = kit;
    this.R = R;
    this.lv = R.level('local', ladder.local, [20.6, 19.6, -99, -100]);
    this.fig = R.level('local.figures', ladder.local, [18.1, 17.0, -99, -100]);
    this.ready = new Promise((res) => { this.start = res; });
    const P = this.pts;
    const sun = bvColor(SUN_BV);
    P.push(0, 0, 0, SUN_NEAR, sun[0], sun[1], sun[2], lumOf(SUN_MV, 10));
    this.crowd();
    drawPoints(kit, R, this.lv, this.pts, 'local', () => this.lv.on() && this.sky > 0.01);
    // the figures' lines (two ends a line, filled once the catalogue's in)
    this.segBuf = kit.storage({ label: 'local.figures', size: 1600 * 32, stride: 32 });
    R.scene.draw(figShader, {
      label: 'local.figures', vertex: 'vs', fragment: 'fs', bind: { L: this.fig.L, segs: this.segBuf }, count: 6,
      instances: () => this.segs * 6, blend: 'premultiplied', cull: 'none',
      enabled: () => this.segs > 0 && this.fig.on() && this.sky > 0.01 && this.figures > 0.002,
    });
  }

  /** red dwarfs within 30 pc at about the real density (0.1 a cubic parsec), absolute magnitudes 9 to 16 rising toward
   *  the faint; any that would be brighter from the Sun than the catalogue's limit is put further out until it isn't */
  private crowd() {
    const r = rng(9), P = this.pts, c = [0, 0, 0];
    for (let i = 0; i < 11000; i++) {
      const Mv = 9 + 7 * Math.pow(r.next(), 0.6);
      // (the nearest it may be and still be fainter than V_LIMIT from here)
      const dMin = 10 * Math.pow(10, (V_LIMIT + 0.3 - Mv) / 5);
      const d = Math.max(dMin, 30 * Math.cbrt(r.next()));
      const th = Math.acos(2 * r.next() - 1), ph = r.next() * Math.PI * 2;
      bvColor(Math.min(1.95, 1.2 + (Mv - 9) * 0.1), c);
      P.push(d * Math.sin(th) * Math.cos(ph), d * Math.cos(th), d * Math.sin(th) * Math.sin(ph), 0, c[0], c[1], c[2], lumOf(Mv, 10));
    }
  }

  /** the catalogue in, its brightest first: stars6 (and its names and figures), then stars8 where the device can */
  private async load() {
    try {
      const [b6, names, lines] = await Promise.all([
        fetchBin('stars6.bin'),
        fetchJSON<{ byHip: Record<string, StarName> }>('names.json'),
        fetchJSON<{ byConstellation: Record<string, Figure> }>('lines.json'),
      ]);
      this.names = names.byHip;
      this.take(parseStars(b6));
      this.figureSet = lines.byConstellation;
      this.buildFigures();
      this.start();
      if (this.R.light) return;
      this.take(parseStars(await fetchBin('stars8.bin')));
    } catch (e) {
      console.warn('local: the catalogue failed to load', e);
    }
  }

  private take(list: Star[]) {
    const P = this.pts, c = [0, 0, 0];
    for (const s of list) {
      const d = Math.hypot(s.pos[0], s.pos[1], s.pos[2]);
      bvColor(s.bv, c);
      P.push(s.pos[0], s.pos[1], s.pos[2], 0, c[0], c[1], c[2], lumOf(s.V, d));
      this.stars.push(s);
      this.byHip.set(s.hip, s);
      const n = this.names[s.hip];
      if (n) this.named.push({ name: n.name, hip: s.hip, bayer: n.bayer, designation: n.designation, pos: s.pos, V: s.V });
    }
    P.flush();
  }

  private buildFigures() {
    const segs: number[] = [];
    for (const f of Object.values(this.figureSet)) {
      for (const [h0, h1] of f.lines) {
        const a = this.byHip.get(h0), b = this.byHip.get(h1);
        if (a && b) segs.push(...a.pos, 0, ...b.pos, 0);
      }
    }
    const data = new Float32Array(segs);
    this.segBuf.ensure(data.byteLength);
    this.segBuf.write(data);
    this.segs = data.length / 8;
  }

  // ---------------------------------------------------------------- for labels and taps
  /** the eye in this level's units (pc, the galaxy's axes, the Sun at the origin) this frame */
  eye(out: Vec3 = [0, 0, 0]): Vec3 {
    for (let i = 0; i < 3; i++) out[i] = this.lv.eye[i] + this.lv.origin[i];
    return out;
  }

  /** a named star (its IAU name or its Bayer designation, any case: 'Sirius', 'α CMa'), once the catalogue's in */
  star(name: string): NamedStar | null {
    const q = name.trim().toLowerCase();
    return this.named.find((s) => s.name.toLowerCase() === q || s.bayer?.toLowerCase() === q) ?? null;
  }

  /** a named star's place (pc, this level's axes), or null */
  starPlace(name: string): Vec3 | null { return this.star(name)?.pos ?? null; }

  /** its magnitude as seen from `from` (pc, this level's axes) */
  magFrom(s: { pos: Vec3; V: number }, from: Vec3): number {
    const d0 = Math.hypot(s.pos[0], s.pos[1], s.pos[2]), d = Math.hypot(s.pos[0] - from[0], s.pos[1] - from[1], s.pos[2] - from[2]);
    return s.V + 5 * Math.log10(Math.max(d, 1e-9) / Math.max(d0, 1e-9));
  }

  /** the brightest named star within `within` (rad) of the direction `dir` (this level's axes) as seen from `from`
   *  (pc; the eye this frame), and how bright it is from there; null if none */
  brightestNear(dir: ArrayLike<number>, within = 0.05, from: Vec3 = this.eye()): (NamedStar & { mag: number; angle: number }) | null {
    const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1, cw = Math.cos(within);
    let best: (NamedStar & { mag: number; angle: number }) | null = null;
    for (const s of this.named) {
      const v = [s.pos[0] - from[0], s.pos[1] - from[1], s.pos[2] - from[2]], l = Math.hypot(v[0], v[1], v[2]) || 1;
      const c = (v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]) / (l * dl);
      if (c < cw) continue;
      const mag = this.magFrom(s, from);
      if (!best || mag < best.mag) best = { ...s, mag, angle: Math.acos(Math.min(1, c)) };
    }
    return best;
  }

  /** where a named thing of this level is (ui/things.ts FindsThings): a star by its IAU name ('Sirius', 'Rigil
   *  Kentaurus'), or a constellation's figure by its abbreviation as lines.json keys it ('Ori'): the figure's place is
   *  the middle of its stars as seen from the Sun, at their median distance, its radius enough to ring them from here */
  find(kind: string, name: string): { frame: Frame; at: Vec3; r?: number; name?: string } | null {
    if (kind === 'star') {
      const s = this.star(name);
      return s ? { frame: this.lv.frame, at: [s.pos[0], s.pos[1], s.pos[2]], name: s.name } : null;
    }
    if (kind === 'figure') {
      const f = this.figureSet[name];
      if (!f) return null;
      const hips = [...new Set(f.lines.flat())], dirs: Vec3[] = [], dists: number[] = [], m: Vec3 = [0, 0, 0];
      for (const h of hips) {
        const s = this.byHip.get(h);
        if (!s) continue;
        const d = Math.hypot(s.pos[0], s.pos[1], s.pos[2]);
        const u: Vec3 = [s.pos[0] / d, s.pos[1] / d, s.pos[2] / d];
        dirs.push(u); dists.push(d);
        for (let i = 0; i < 3; i++) m[i] += u[i];
      }
      if (!dirs.length) return null;
      const ml = Math.hypot(m[0], m[1], m[2]) || 1;
      for (let i = 0; i < 3; i++) m[i] /= ml;
      let ang = 0;
      for (const u of dirs) ang = Math.max(ang, Math.acos(Math.min(1, u[0] * m[0] + u[1] * m[1] + u[2] * m[2])));
      const D = dists.sort((a, b) => a - b)[dists.length >> 1];
      return { frame: this.lv.frame, at: [m[0] * D, m[1] * D, m[2] * D], r: D * Math.tan(Math.min(ang * 1.1, 1.2)), name: f.name };
    }
    return null;
  }

  update(S: number) {
    const Spc = S / this.lv.frame.unit;
    if (!this.asked && this.lv.weight > 0.002) { this.asked = true; void this.load(); }
    this.lv.weight *= this.sky;
    this.lv.L.set({ weight: this.lv.weight, a: [GAIN, 0, Math.max(Spc * 0.01, 0.01), 1] });
    this.fig.weight *= this.sky * Math.max(0, Math.min(1, this.figures));
    this.fig.L.set({ weight: this.fig.weight, a: [FIG_LIGHT, FIG_GAP, FIG_WIDTH, 0] });
  }
}
