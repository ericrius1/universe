// The frame above the cell: every level draws into one HDR target in order, coarsest first (the cosmic web, the Milky
// Way, the Sun's neighbours, the solar system, the Earth, the meadow, the skin), each with its weight for the zoom —
// sprites add their light, surfaces lay theirs over what's behind with their coverage, so a daytime sky hides the
// stars and a night one doesn't. A host's picture can be laid into it after (Universe's: Seven Havens' gardens, and
// her face; the cell's frame, under this one's as the two hand over, or alone). Then bloom and the film, to the screen.
//
// Each level's view is worked out here in doubles and handed over relative to its own floating origin (the zoom's
// target in its frame, rounded to float32): a level never sees a number bigger than its own few thousand units.
import type { Kit, RenderPass, Texture, UniformBuffer, RunEntry, Draw, Taau } from '@ericrius1/weft';
import { quat, vec3, type Quat, type Vec3 } from 'math';
import common from './shaders/cosmos.wgsl';
import post from './shaders/c_post.wgsl';
import volShader from './shaders/c_vol.wgsl';
import type { Frame, Ladder } from './frames';
import type { CosmosControls } from './controls';
import { BLOOM_LEVELS, COSMOS_FILM, filmFields, type Film } from './film';

const BLOOM_MIPS = BLOOM_LEVELS;
export const TIME_WRAP = 4096;

/** a level's weight over the zoom (log10 m): 0 above a, rising to 1 at b, 1 down to c, 0 by d (a > b ≥ c > d) */
export type Band = [number, number, number, number];
const smooth = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
export const bandWeight = (l: number, [a, b, c, d]: Band) => (l > b ? 1 - smooth((l - b) / (a - b)) : 1) * (l < c ? 1 - smooth((c - l) / (c - d)) : 1);

/** drawn for a planetarium instead of a screen: a square domemaster `size` pixels across, into `out` (an sRGB
 *  texture, rgba8unorm-srgb), the camera on the dome's sweet spot `elevation` (rad) above the front horizon */
export interface DomeOptions { size: number; out: Texture | 'screen'; elevation?: number }

export interface Level {
  id: string;
  frame: Frame;
  band: Band;
  L: UniformBuffer<any>;
  weight: number;
  /** the view in the level's units: eye relative to its origin, the origin, the camera's basis, the view distance */
  readonly eye: Vec3;
  readonly origin: Vec3;
  readonly fwd: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
  scale: number;
  on: () => boolean;
}

export class CosmosRenderer {
  readonly hdr: Texture;
  readonly bloom: Texture;
  readonly scene: RenderPass;
  /** the film's uniform (loom/film), and its settings this frame: the cosmos's own, or a host's mixed in */
  readonly P: UniformBuffer<any>;
  film: Film;
  /** its alpha: 1, or less over the cell's frame while the two hand over (index.ts) */
  alpha = 1;
  /** a level's own grade over whatever film is in force (levels/beyond.ts: the keepers' world, graded for itself) */
  grade: ((f: Film) => Film) | null = null;
  /** a host's film for what it lays in last (`lay`), mixed with this one's own (Universe's: the cell's, cosmos/film.ts
   *  CELL_FILM, as the two hand over) */
  host: ((f: Film) => Film) | null = null;
  private encode: boolean;
  readonly levels: Level[] = [];
  /** run before the scene (generation, culling) */
  readonly before: RunEntry[] = [];
  /** its own work after the scene, into its HDR, before a host's (levels/beyond.ts: the keepers' world laid in) */
  readonly after: RunEntry[] = [];
  /** a host's own work this frame: before all of it, and after the scene, into its HDR before the bloom (Universe's:
   *  Seven Havens' gardens drawn, then laid into the frame) */
  first: () => RunEntry[] = () => [];
  afterScene: () => RunEntry[] = () => [];
  /** a host's own frame laid into the HDR last, before the bloom (Universe's: the cell's — under this one's as the two
   *  hand over, alone when it's all that's seen: `hostOnly`) */
  lay: () => RunEntry[] = () => [];
  /** the host's frame alone this time: none of this one's own work, just its film on what `lay` lays in */
  hostOnly = false;
  /** over a frame already on the screen (a host's, graded its own way) rather than in place of it */
  over = false;
  /** wholly covered by what a host lays in after the scene (Universe's gardens, her face): the scene's levels not
   *  drawn at all */
  covered = false;
  private items: RunEntry[];
  /** the temporal upscaler (useTaau), and what runs before its items */
  taau: Taau | null = null;
  private taauItems: RunEntry[] = [];
  private down0!: Draw;
  private finDraws: Draw[] = [];
  private bloomLv: UniformBuffer<any>[] = [];
  private readonly qi: Quat = quat.create();
  private readonly offset: Vec3 = [0, 0, 0];
  private readonly off: Vec3 = [0, 0, 0];

  /** the dome's sweet spot's elevation (rad), when drawing a dome */
  elevation: number;

  /** the resolution the volumes march at (volume()), a fraction of the frame's */
  readonly volumeScale: number;

  constructor(readonly kit: Kit, readonly ladder: Ladder, readonly dome: DomeOptions | null = null, volumeScale = 1) {
    const k = kit;
    this.volumeScale = dome ? 1 : volumeScale;
    const N = dome?.size ?? 0;
    this.elevation = dome?.elevation ?? (35 * Math.PI) / 180;
    this.hdr = k.texture({ label: 'cosmos.hdr', format: 'rgba16float', size: dome ? [N, N] : 'render' });
    this.bloom = dome
      ? k.texture({ label: 'cosmos.bloom', format: 'rgba16float', size: [N / 2, N / 2], mips: BLOOM_MIPS })
      : k.texture({ label: 'cosmos.bloom', format: 'rgba16float', size: 'render', scale: 0.5, mips: BLOOM_MIPS });
    this.P = k.uniforms(post.structs.FilmU, 'cosmos.film');
    this.encode = !dome || dome.out === 'screen';
    // (a dome's fisheye: no vignette, no grain, black outside its circle)
    this.film = dome ? { ...COSMOS_FILM, vignette: 0, grain: 0 } : { ...COSMOS_FILM };
    this.scene = k.pass({ label: 'cosmos', color: [{ target: this.hdr, clear: [0, 0, 0, 1] }] });
    const P = this.P;
    const items: RunEntry[] = [];
    for (let i = 0; i < BLOOM_MIPS; i++) {
      const u = k.uniforms(post.structs.Lvl, `cosmos.bloom.l${i}`);
      this.bloomLv.push(u);
      const p = k.pass({ label: `cosmos.bloom.down${i}`, color: [{ target: this.bloom.mip(i), clear: [0, 0, 0, 1] }] });
      const d = p.fullscreen(post, { label: `cosmos.bloom.down${i}`, fragment: 'fs_down', bind: { B: u, srcTex: i === 0 ? this.hdr : this.bloom.mip(i - 1) } });
      if (i === 0) this.down0 = d as unknown as Draw;
      items.push(p);
    }
    for (let i = BLOOM_MIPS - 2; i >= 0; i--) {
      const u = k.uniforms(post.structs.Lvl, `cosmos.bloom.u${i}`);
      this.bloomLv.push(u);
      const p = k.pass({ label: `cosmos.bloom.up${i}`, color: [{ target: this.bloom.mip(i), clear: false }] });
      p.fullscreen(post, { label: `cosmos.bloom.up${i}`, fragment: 'fs_up', blend: 'add', bind: { B: u, srcTex: this.bloom.mip(i + 1) } });
      items.push(p);
    }
    const fin = k.pass({ label: 'cosmos.final', color: [{ target: !dome || dome.out === 'screen' ? 'screen' : dome.out.mip(0), clear: [0, 0, 0, 1] }], enabled: () => !this.over });
    this.finDraws.push(fin.fullscreen(post, { label: 'cosmos.final', fragment: 'fs_final', bind: { F: P, B: this.bloomLv[0], srcTex: this.hdr, bloomTex: this.bloom.mip(0) } }) as unknown as Draw);
    const finOver = k.pass({ label: 'cosmos.final.over', color: [{ target: 'screen', clear: false }], enabled: () => this.over });
    this.finDraws.push(finOver.fullscreen(post, { label: 'cosmos.final.over', fragment: 'fs_final', blend: 'alpha', bind: { F: P, B: this.bloomLv[0], srcTex: this.hdr, bloomTex: this.bloom.mip(0) } }) as unknown as Draw);
    this.items = [...items, fin, finOver];
  }

  /** temporal anti-aliasing with upscaling over the HDR, before the bloom and the film (?taau): the bloom and the
   *  film read its output (the canvas's size) */
  useTaau(t: Taau, before: RunEntry[] = []) {
    this.taau = t;
    this.taauItems = [...before, ...t.items];
    this.down0.set('srcTex', t.out);
    for (const d of this.finDraws) d.set('srcTex', t.out);
  }

  /** a level: its uniforms, and the zoom over which it shows */
  level(id: string, frame: Frame, band: Band): Level {
    const lv: Level = {
      id, frame, band, L: this.kit.uniforms(common.structs.Lv, `cosmos.${id}`), weight: 0,
      eye: [0, 0, 0], origin: [0, 0, 0], fwd: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0], scale: 1,
      on: () => lv.weight > 0.002,
    };
    this.levels.push(lv);
    return lv;
  }

  /** a march that costs a lot per pixel (a volume, a shell) and has no fine edge to it: drawn into the scene where it
   *  comes, or below full resolution into a target of its own (cleared, before the scene) that's laid into the scene
   *  there, upsampled. Its draws blend premultiplied, as the scene's do, so the two come to the same */
  volume(label: string, enabled: () => boolean, draw: (into: RenderPass) => void) {
    if (this.volumeScale >= 1) { draw(this.scene); return; }
    const k = this.kit;
    const tex = k.texture({ label: `cosmos.${label}`, format: 'rgba16float', size: 'render', scale: this.volumeScale });
    const p = k.pass({ label: `cosmos.${label}`, color: [{ target: tex, clear: [0, 0, 0, 0] }], enabled });
    draw(p);
    this.before.push(p);
    this.scene.fullscreen(volShader, { label: `cosmos.${label}.up`, fragment: 'fs', blend: 'premultiplied', bind: { volTex: tex }, enabled });
  }

  /** every level's view for this frame (the camera's, from the controls, in each level's own units) */
  update(c: CosmosControls, time: number) {
    const S = c.S, logS = c.logS;
    const kit = this.kit, cam = kit.camera;
    const [W, H] = this.size();
    const tanHalf = Math.tan(cam.fovY / 2), aspect = W / Math.max(1, H);
    // (a fisheye's pixel is its 180° over its width)
    const pxAngle = this.dome ? Math.PI / W : (2 * tanHalf) / H;
    const view = [1 / W, 1 / H, this.dome ? 1 : 0, this.elevation];
    this.ladder.pivotOffset(logS, this.offset);
    for (const lv of this.levels) {
      lv.weight = bandWeight(logS, lv.band);
      const f = lv.frame;
      quat.invert(this.qi, f.q);
      vec3.transformQuat(lv.fwd, c.forward, this.qi);
      vec3.transformQuat(lv.right, c.right, this.qi);
      vec3.transformQuat(lv.up, c.up, this.qi);
      lv.scale = S / f.unit;
      vec3.transformQuat(this.off, this.offset, this.qi);
      for (let i = 0; i < 3; i++) {
        lv.origin[i] = Math.fround(f.target[i]);
        // (in doubles: the eye from the target, then relative to the origin)
        lv.eye[i] = f.target[i] + this.off[i] / f.unit - lv.fwd[i] * lv.scale - lv.origin[i];
      }
      lv.L.set({
        origin: lv.origin, weight: lv.weight, eye: lv.eye, scale: lv.scale, fwd: lv.fwd, tanHalf, right: lv.right, aspect,
        up: lv.up, time: time % TIME_WRAP, pxAngle, view,
      });
    }
  }

  /** the target's size (px) */
  size(): [number, number] { return this.dome ? [this.dome.size, this.dome.size] : [this.kit.size.render[0], this.kit.size.render[1]]; }

  private sizeBloom(f: Film) {
    const [w, h] = this.size();
    const size = (m: number) => [Math.max(1, Math.round(w * 0.5) >> m), Math.max(1, Math.round(h * 0.5) >> m)];
    for (let i = 0; i < BLOOM_MIPS; i++) {
      const c = this.kit.size.canvas;
      const src = i === 0 ? (this.taau?.params.on ? [c[0], c[1]] : [w, h]) : size(i - 1);
      this.bloomLv[i].set({ texel: [1 / src[0], 1 / src[1]], mip: i, weight: 1, first: [f.bloomEven, f.kneeLo, f.kneeHi, f.knee] });
    }
    for (let i = BLOOM_MIPS - 2; i >= 0; i--) {
      const s = size(i + 1);
      this.bloomLv[BLOOM_MIPS + (BLOOM_MIPS - 2 - i)].set({ texel: [1 / s[0], 1 / s[1]], mip: i, weight: f.bloomWeight });
    }
  }

  /** this frame's GPU work, for a host that runs it with its own */
  run(): RunEntry[] {
    this.prep();
    if (this.hostOnly) return [...this.lay(), ...this.taauItems, ...this.items];
    return [...this.first(), ...this.before, ...(this.covered ? [] : [this.scene]), ...this.after, ...this.afterScene(), ...this.lay(), ...this.taauItems, ...this.items];
  }
  /** (the film's settings as they stand now: a level's grade and a host's mixed in after the views were worked out; its
   *  bloom's too) */
  private prep() {
    let f = this.grade ? this.grade(this.film) : this.film;
    if (this.host) f = this.host(f);
    this.P.set(filmFields(f, this.alpha, this.encode, !!this.dome));
    this.sizeBloom(f);
  }

  /** the frame in two halves, for a host that reads the HDR in between (Universe's jewel: the keepers' world, drawn
   *  here, read by the cell before this is laid over it): the scene and its own work after it, then the rest */
  offscreen(): RunEntry[] { return [...this.before, this.scene, ...this.after]; }
  finish(): RunEntry[] { this.prep(); return [...this.afterScene(), ...this.lay(), ...this.taauItems, ...this.items]; }

  frame() { this.kit.run(this.run()); }
}
