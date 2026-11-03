// The post chain: camera motion blur first (post/motionblur.ts), the contour smudge of far silhouettes, bloom levels
// down and up, then exposure + AgX to the screen and the Seven Havens' grade (post.wgsl); the newer effects in
// post/fx.ts. Inside a host (embed.ts: out null) no bloom and no final pass: the scene's laid into the host's frame
// (layer) for the host's own film to finish.
import { Ref, type Kit, type RenderPass, type RunEntry, type Texture, type UniformBuffer } from '@ericrius1/weft';
import bloomShader from './bloom.wgsl';
import postShader from './post.wgsl';
import smudgeShader from './smudge.wgsl';
import { PostFx } from './fx';
import { MotionBlur } from './motionblur';
import { tier } from '../util/tier';

export class Post {
  readonly u: UniformBuffer<any>;
  readonly levels: Texture[] = [];
  private passes: RunEntry[] = [];
  /** the bloom levels' uniforms, set each frame before the run (their sizes follow the render's) */
  private bloomU: (() => void)[] = [];
  readonly out: RenderPass | null;
  /** exposure (stops), bloom, vignette, grain, AgX's saturation, contrast, warmth (white balance) and punch; the contour
   *  smudge; the look: the glow on what's bright (its strength, and the brightness on the screen it glows from), night
   *  vision (the cool shift of the dim land at night), the warm-cool split, the reds' and golds' richness */
  settings = {
    exposure: 0, bloom: 0.045, vignette: 0.22, grain: 0.0, saturation: 1.0, contrast: 1.08, warmth: 0.0, punchy: 0.5,
    smudge: 0.8, smudgeStart: 120, smudgeFull: 700, smudgeRadius: 1.6,
    glow: 0.3, glowFrom: 5, nightVision: 0.4, split: 1, rich: 0.07,
    /** how much of a host's frame the scene covers (layer) */
    layer: 1,
  };
  /** the smudged scene (the scene itself where there's no smudge) */
  readonly smudged: Texture;
  private readonly smudgeOn: boolean;
  private smudgeU: UniformBuffer<any>;
  private smudgePass: RenderPass | null = null;
  /** 1: the final pass blends the scene's edges (no MSAA) */
  private edgeAA: number;
  /** the newer effects (post/fx.ts) */
  readonly fx: PostFx;
  /** camera motion blur, first (the player sets its shutter) */
  readonly motionBlur: MotionBlur;

  /** depth: the scene's depth buffer, multisampled or (a phone's) not: what reads all four samples (the motion blur,
   *  the smudge) is off without them, and reads a small stand-in; out: where the picture goes (the screen, a texture of
   *  the canvas's format, or null: a host's frame, through layer) */
  constructor(readonly kit: Kit, hdrIn: Texture, depth: Texture, count = 6, out: Texture | 'screen' | null = 'screen') {
    this.u = kit.uniforms(postShader.structs.Post, 'post');
    this.fx = new PostFx(kit, hdrIn, depth);
    const ms = depth.samples > 1;
    const msDepth = ms ? depth : kit.texture({ label: 'depth.stand-in', format: 'depth32float', size: [4, 4], samples: 4 });
    // contour smudging of distant silhouettes, before everything else reads the image (not on a phone: the bloom and the
    // final pass read the scene itself)
    this.smudgeOn = ms && tier.smudge;
    this.smudged = this.smudgeOn ? kit.texture({ label: 'hdr.smudged', format: 'rgba16float', size: 'render' }) : hdrIn;
    this.smudgeU = kit.uniforms(smudgeShader.structs.SmudgeU, 'smudge');
    this.motionBlur = new MotionBlur(kit, hdrIn, msDepth);
    this.motionBlur.capable = ms;
    this.motionBlur.allowed = tier.motionBlur;
    const blurred = new Ref(() => (this.motionBlur.active ? this.motionBlur.out : hdrIn), 'post.src');
    if (this.smudgeOn) {
      this.smudgePass = kit.pass({ label: 'smudge', color: [{ target: this.smudged, clear: [0, 0, 0, 0] }] });
      this.smudgePass.fullscreen(smudgeShader, { label: 'smudge', bind: { SU: this.smudgeU, src: blurred, depth: msDepth } as never });
    }
    const hdr = this.smudged;
    let src: Texture = hdr;
    const ups: RunEntry[] = [];
    // (a host blooms the frame it's laid into)
    const levels = out ? count : 0;
    for (let i = 0; i < levels; i++) {
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
    for (let i = levels - 1; i > 0; i--) {
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
    this.edgeAA = ms ? 0 : 1;
    this.out = out ? kit.pass({ label: 'post', color: [{ target: out, clear: [0, 0, 0, 1] }] }) : null;
    // (without MSAA, the final pass blends the scene's edges instead: fx.wgsl fxEdgeAA)
    this.out?.fullscreen(postShader, { label: 'post', constants: { EDGE_AA: this.edgeAA }, bind: { P: this.u, hdr, bloom: this.levels[0], ...this.fx.bindings() } as never });
  }

  /** the scene laid into a host's frame (`target`, HDR, the host's film units) for its film to finish: over what's
   *  there by how much it shows (settings.layer, blended), or in place of it (whole) */
  layer(target: Texture) {
    const bind = { P: this.u, hdr: this.smudged, ...this.fx.bindings() } as never, constants = { EDGE_AA: this.edgeAA };
    const over = this.kit.pass({ label: 'post.layer', color: [{ target, clear: false }] });
    over.fullscreen(postShader, { label: 'post.layer', fragment: 'layer', blend: 'alpha', constants, bind });
    const whole = this.kit.pass({ label: 'post.layer.whole', color: [{ target, clear: [0, 0, 0, 1] }] });
    whole.fullscreen(postShader, { label: 'post.layer.whole', fragment: 'layer', constants, bind });
    return { over, whole };
  }

  run(): RunEntry[] {
    const s = this.settings;
    this.u.set({
      ev: [s.exposure, s.bloom, s.vignette, s.grain], grade: [s.saturation, s.contrast, s.warmth, s.punchy],
      look: [s.glow, s.glowFrom, s.nightVision, s.split], look2: [s.rich, s.layer, 0, 0],
    });
    this.smudgeU.set({ p: [s.smudge, s.smudgeStart, s.smudgeFull, s.smudgeRadius] });
    for (const f of this.bloomU) f();
    return [...this.motionBlur.run(this.smudged.height), ...(this.smudgePass ? [this.smudgePass] : []), ...this.passes, ...this.fx.passes(), ...(this.out ? [this.out] : [])];
  }
}
