// The frame above the cell: every level draws into one HDR target in order, coarsest first (the cosmic web, the Milky
// Way, the Sun's neighbours, the solar system, the Earth, the meadow, the skin), each with its weight for the zoom —
// sprites add their light, surfaces lay theirs over what's behind with their coverage, so a daytime sky hides the
// stars and a night one doesn't. Then bloom and the grade, to the screen, or over the cell's frame while they hand over.
//
// Each level's view is worked out here in doubles and handed over relative to its own floating origin (the zoom's
// target in its frame, rounded to float32): a level never sees a number bigger than its own few thousand units.
import type { Kit, RenderPass, Texture, UniformBuffer, RunEntry } from '@ericrius1/weft';
import { quat, vec3, type Quat, type Vec3 } from 'math';
import common from '../../shaders/cosmos.wgsl';
import post from '../../shaders/c_post.wgsl';
import type { Frame, Ladder } from './frames';
import type { CosmosControls } from './controls';

const BLOOM_MIPS = 6;
export const TIME_WRAP = 4096;

/** a level's weight over the zoom (log10 m): 0 above a, rising to 1 at b, 1 down to c, 0 by d (a > b ≥ c > d) */
export type Band = [number, number, number, number];
const smooth = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
export const bandWeight = (l: number, [a, b, c, d]: Band) => (l > b ? 1 - smooth((l - b) / (a - b)) : 1) * (l < c ? 1 - smooth((c - l) / (c - d)) : 1);

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
  readonly P: UniformBuffer<any>;
  readonly levels: Level[] = [];
  /** run before the scene (generation, culling) */
  readonly before: RunEntry[] = [];
  /** over the cell's frame (the hand-over) rather than in place of it */
  over = false;
  private items: RunEntry[];
  private bloomLv: UniformBuffer<any>[] = [];
  private readonly qi: Quat = quat.create();

  constructor(readonly kit: Kit, readonly ladder: Ladder) {
    const k = kit;
    this.hdr = k.texture({ label: 'cosmos.hdr', format: 'rgba16float', size: 'render' });
    this.bloom = k.texture({ label: 'cosmos.bloom', format: 'rgba16float', size: 'render', scale: 0.5, mips: BLOOM_MIPS });
    this.P = k.uniforms(post.structs.CPost, 'cosmos.post').set({ bloom: 0.012, exposure: 1, vignette: 0.45, grain: 0.01, saturation: 1.08, contrast: 1.08, alpha: 1 });
    k.overlay.tweak(this.P, 'cosmos.post');
    this.scene = k.pass({ label: 'cosmos', color: [{ target: this.hdr, clear: [0, 0, 0, 1] }] });
    const P = this.P;
    const items: RunEntry[] = [];
    for (let i = 0; i < BLOOM_MIPS; i++) {
      const u = k.uniforms(post.structs.Lvl, `cosmos.bloom.l${i}`);
      this.bloomLv.push(u);
      const p = k.pass({ label: `cosmos.bloom.down${i}`, color: [{ target: this.bloom.mip(i), clear: [0, 0, 0, 1] }] });
      p.fullscreen(post, { label: `cosmos.bloom.down${i}`, fragment: 'fs_down', bind: { P, B: u, srcTex: i === 0 ? this.hdr : this.bloom.mip(i - 1) } });
      items.push(p);
    }
    for (let i = BLOOM_MIPS - 2; i >= 0; i--) {
      const u = k.uniforms(post.structs.Lvl, `cosmos.bloom.u${i}`);
      this.bloomLv.push(u);
      const p = k.pass({ label: `cosmos.bloom.up${i}`, color: [{ target: this.bloom.mip(i), clear: false }] });
      p.fullscreen(post, { label: `cosmos.bloom.up${i}`, fragment: 'fs_up', blend: 'add', bind: { P, B: u, srcTex: this.bloom.mip(i + 1) } });
      items.push(p);
    }
    const fin = k.pass({ label: 'cosmos.final', color: [{ target: 'screen', clear: [0, 0, 0, 1] }], enabled: () => !this.over });
    fin.fullscreen(post, { label: 'cosmos.final', fragment: 'fs_final', bind: { P, B: this.bloomLv[0], srcTex: this.hdr, bloomTex: this.bloom.mip(0) } });
    const finOver = k.pass({ label: 'cosmos.final.over', color: [{ target: 'screen', clear: false }], enabled: () => this.over });
    finOver.fullscreen(post, { label: 'cosmos.final.over', fragment: 'fs_final', blend: 'alpha', bind: { P, B: this.bloomLv[0], srcTex: this.hdr, bloomTex: this.bloom.mip(0) } });
    this.items = [...items, fin, finOver];
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

  /** every level's view for this frame (the camera's, from the controls, in each level's own units) */
  update(c: CosmosControls, time: number) {
    const S = c.S, logS = c.logS;
    const kit = this.kit, cam = kit.camera;
    const tanHalf = Math.tan(cam.fovY / 2), aspect = kit.size.render[0] / Math.max(1, kit.size.render[1]);
    const pxAngle = (2 * tanHalf) / kit.size.render[1];
    for (const lv of this.levels) {
      lv.weight = bandWeight(logS, lv.band);
      const f = lv.frame;
      quat.invert(this.qi, f.q);
      vec3.transformQuat(lv.fwd, c.forward, this.qi);
      vec3.transformQuat(lv.right, c.right, this.qi);
      vec3.transformQuat(lv.up, c.up, this.qi);
      lv.scale = S / f.unit;
      for (let i = 0; i < 3; i++) {
        lv.origin[i] = Math.fround(f.target[i]);
        // (in doubles: the eye from the target, then relative to the origin)
        lv.eye[i] = f.target[i] - lv.fwd[i] * lv.scale - lv.origin[i];
      }
      lv.L.set({
        origin: lv.origin, weight: lv.weight, eye: lv.eye, scale: lv.scale, fwd: lv.fwd, tanHalf, right: lv.right, aspect,
        up: lv.up, time: time % TIME_WRAP, pxAngle,
      });
    }
    this.sizeBloom();
  }

  private sizeBloom() {
    const [w, h] = this.kit.size.render;
    const size = (m: number) => [Math.max(1, Math.round(w * 0.5) >> m), Math.max(1, Math.round(h * 0.5) >> m)];
    for (let i = 0; i < BLOOM_MIPS; i++) {
      const src = i === 0 ? [w, h] : size(i - 1);
      this.bloomLv[i].set({ texel: [1 / src[0], 1 / src[1]], mip: i, last: 0 });
    }
    for (let i = BLOOM_MIPS - 2; i >= 0; i--) {
      const s = size(i + 1);
      this.bloomLv[BLOOM_MIPS + (BLOOM_MIPS - 2 - i)].set({ texel: [1 / s[0], 1 / s[1]], mip: i, last: 0 });
    }
  }

  frame() {
    this.kit.run([...this.before, this.scene, ...this.items]);
  }
}
