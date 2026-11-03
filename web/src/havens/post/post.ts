// The post chain: camera motion blur first (post/motionblur.ts), the contour smudge of far silhouettes, bloom levels
// down and up, then exposure + AgX to the screen and the Seven Havens' grade (post.wgsl); the newer effects in
// post/fx.ts.
import { Ref, type Kit, type RenderPass, type RunEntry, type Texture, type UniformBuffer } from '@ericrius1/weft';
import bloomShader from './bloom.wgsl';
import postShader from './post.wgsl';
import smudge4 from './smudge.wgsl';
import smudge1 from './smudge1.wgsl';
import { PostFx } from './fx';
import { MotionBlur } from './motionblur';
import { tier } from '../util/tier';

const smudgeShader = tier.msaa === 4 ? smudge4 : smudge1;

export class Post {
  readonly u: UniformBuffer<any>;
  readonly levels: Texture[] = [];
  private passes: RunEntry[] = [];
  /** the bloom levels' uniforms, set each frame before the run (their sizes follow the render's) */
  private bloomU: (() => void)[] = [];
  readonly out: RenderPass;
  /** exposure (stops), bloom, vignette, grain, AgX's saturation, contrast, warmth (white balance) and punch; the contour
   *  smudge; the look: the glow on what's bright (its strength, and the brightness on the screen it glows from), night
   *  vision (the cool shift of the dim land at night), the warm-cool split, the reds' and golds' richness */
  settings = {
    exposure: 0, bloom: 0.045, vignette: 0.22, grain: 0.0, saturation: 1.0, contrast: 1.08, warmth: 0.0, punchy: 0.5,
    smudge: 0.8, smudgeStart: 120, smudgeFull: 700, smudgeRadius: 1.6,
    glow: 0.3, glowFrom: 5, nightVision: 0.4, split: 1, rich: 0.07,
  };
  readonly smudged: Texture;
  private smudgeU: UniformBuffer<any>;
  private smudgePass: RenderPass;
  /** the newer effects (post/fx.ts) */
  readonly fx: PostFx;
  /** camera motion blur, first (the player sets its shutter) */
  readonly motionBlur: MotionBlur;

  /** depth: the scene's depth buffer (multisampled with MSAA: util/tier.ts msaa); out: where the picture goes (the
   *  screen, or a texture of the canvas's format a host lays over its own: embed.ts) */
  constructor(readonly kit: Kit, hdrIn: Texture, depth: Texture, count = 6, out: Texture | 'screen' = 'screen') {
    this.u = kit.uniforms(postShader.structs.Post, 'post');
    this.fx = new PostFx(kit, hdrIn, depth);
    // contour smudging of distant silhouettes, before everything else reads the image
    this.smudged = kit.texture({ label: 'hdr.smudged', format: 'rgba16float', size: 'render' });
    this.smudgeU = kit.uniforms(smudgeShader.structs.SmudgeU, 'smudge');
    this.smudgePass = kit.pass({ label: 'smudge', color: [{ target: this.smudged, clear: [0, 0, 0, 0] }] });
    this.motionBlur = new MotionBlur(kit, hdrIn, depth);
    const blurred = new Ref(() => (this.motionBlur.active ? this.motionBlur.out : hdrIn), 'post.src');
    this.smudgePass.fullscreen(smudgeShader, { label: 'smudge', bind: { SU: this.smudgeU, src: blurred, depth } as never });
    // (without the smudge (a phone: util/tier.ts) the chain reads the scene itself, and the motion blur, off there, too)
    const hdr = tier.smudge ? this.smudged : hdrIn;
    let src: Texture = hdr;
    const ups: RunEntry[] = [];
    for (let i = 0; i < count; i++) {
      const t = kit.texture({ label: `bloom${i}`, format: 'rgba16float', size: 'render', scale: 0.5 ** (i + 1) });
      const u = kit.uniforms(bloomShader.structs.BloomU, `bloom${i}`);
      const s = src;
      const p = kit.pass({ label: `bloom.down${i}`, color: [{ target: t, clear: [0, 0, 0, 0] }] });
      p.fullscreen(bloomShader, { label: `bloom.down${i}`, fragment: 'down', bind: { B: u, src: s } as never });
      this.bloomU.push(() => u.set({ texel: [1 / s.width, 1 / s.height, i === 0 ? 1 : 0, 0.0] }));
      this.passes.push(p);
      this.levels.push(t);
      src = t;
    }
    for (let i = count - 1; i > 0; i--) {
      const from = this.levels[i], to = this.levels[i - 1];
      const u = kit.uniforms(bloomShader.structs.BloomU, `bloomUp${i}`);
      const p = kit.pass({ label: `bloom.up${i}`, color: [{ target: to, clear: false }] });
      p.fullscreen(bloomShader, { label: `bloom.up${i}`, fragment: 'up', blend: 'add', bind: { B: u, src: from } as never });
      this.bloomU.push(() => u.set({ texel: [1 / from.width, 1 / from.height, this.fx.bloomWeight, 0] }));
      ups.push(p);
    }
    this.passes.push(...ups);
    this.fx.levels = count;
    this.fx.attach(hdr);
    this.out = kit.pass({ label: 'post', color: [{ target: out, clear: [0, 0, 0, 1] }] });
    this.out.fullscreen(postShader, { label: 'post', bind: { P: this.u, hdr, bloom: this.levels[0], ...this.fx.bindings() } as never });
  }

  run(): RunEntry[] {
    const s = this.settings;
    this.u.set({
      ev: [s.exposure, s.bloom, s.vignette, s.grain], grade: [s.saturation, s.contrast, s.warmth, s.punchy],
      look: [s.glow, s.glowFrom, s.nightVision, s.split], look2: [s.rich, 0, 0, 0],
    });
    this.smudgeU.set({ p: [s.smudge, s.smudgeStart, s.smudgeFull, s.smudgeRadius] });
    for (const f of this.bloomU) f();
    if (!tier.smudge) return [...this.passes, ...this.fx.passes(), this.out];
    return [...this.motionBlur.run(this.smudged.height), this.smudgePass, ...this.passes, ...this.fx.passes(), this.out];
  }
}
