// The post chain's newer half (post.ts runs it). Before the clouds go over the scene: the scene's distances (every
// pass after the scene reads them) and ambient occlusion (ao.wgsl, multiplied in). After the bloom: the key light's
// measured visibility and the autofocus, crepuscular shafts and the depth of field (rays.wgsl); the
// final pass (post.wgsl, through fx.wgsl) adds them with the glare and the lens's ghosts, chromatic aberration,
// sharpening, the time-of-day grade, halation and grain.
import type { Kit, RenderPass, RunEntry, StorageBuffer, Texture, UniformBuffer } from '@ericrius1/weft';
import sceneZ4 from './scenez.wgsl';
import sceneZ1 from './scenez1.wgsl';
import aoShader from './ao.wgsl';
import raysShader from './rays.wgsl';
import { tier } from '../util/tier';

export interface FxSettings {
  /** ambient occlusion's strength and radius (m) */
  ao: number; aoRadius: number;
  /** crepuscular shafts: strength, length (a fraction of the screen), and the air's depth (m: how far through it they
   *  glow fully; less is hazier air, beams in the near trees too) */
  rays: number; raysLength: number; raysAir: number;
  /** the lens: ghosts and halo, the light's glare (glow and starburst), an anamorphic streak */
  flare: number; glare: number; streak: number;
  aberration: number; sharpen: number; grain: number; halation: number;
  /** the time-of-day grade's strength; bloom's reach (0 tight .. 1 wide) */
  grade: number; bloomRadius: number;
  /** depth of field (films): focus (m, 0 autofocus), aperture (blur px at 1080 lines per unit of defocus), the most blur */
  dof: boolean; focus: number; aperture: number; dofMax: number;
}

export class PostFx {
  settings: FxSettings = {
    ao: tier.ao ? 1 : 0, aoRadius: 0.9,
    rays: tier.rays ? 1.5 : 0, raysLength: 0.55, raysAir: 300,
    flare: 1, glare: 0.6, streak: 0,
    aberration: 0.5, sharpen: 0.35, grain: 0.02, halation: 0.4,
    grade: 1, bloomRadius: 0.6,
    dof: false, focus: 0, aperture: 8, dofMax: 18,
  };
  /** the four depth samples' distances along the view axis (1e9: the sky) */
  readonly sceneZ: Texture;
  readonly u: UniformBuffer<any>;
  /** the light's visibility and the autofocus distance (rays.wgsl measure) */
  readonly state: StorageBuffer;
  private zPass: RenderPass;
  /** a pass over the finished scene, before the post chain reads it: the occlusion multiplied in, then the clouds
   *  (world/clouds.ts draws into it) */
  readonly overlay: RenderPass;
  private aoPasses: RenderPass[] = [];
  private after: RunEntry[] = [];
  private shaftB: Texture;
  private dofTex: Texture;
  private frame = 0;

  /** depth: the scene's depth buffer (multisampled with MSAA: util/tier.ts msaa) */
  constructor(readonly kit: Kit, readonly hdr: Texture, readonly depth: Texture) {
    const s = this.settings;
    this.u = kit.uniforms(raysShader.structs.FXU, 'fx');
    this.state = kit.storage({ label: 'fx.state', size: 16, usage: ['storage', 'copy-dst', 'copy-src'] });
    this.state.write(new Float32Array([1, 10, 0, 0]));
    this.sceneZ = kit.texture({ label: 'sceneZ', format: tier.sceneDepthFormat, size: 'render', usage: ['render', 'sample'] });
    this.zPass = kit.pass({ label: 'sceneZ', color: [{ target: this.sceneZ, clear: [0, 0, 0, 0] }] });
    this.zPass.fullscreen(tier.msaa === 4 ? sceneZ4 : sceneZ1, { label: 'sceneZ', bind: { depth } as never });

    // ambient occlusion, half res
    const half = (label: string, format: GPUTextureFormat, mips: number | 'full' = 1) => kit.texture({ label, format, size: 'render', scale: 0.5, mips, usage: ['render', 'sample'] });
    // (its first three mips are read; 'full' as the render's 1x1 before the canvas is sized can't have three, which
    // WebGPU rejected at startup)
    const zHalf = half('ao.z', 'r32float', 'full');
    const aoRaw = half('ao.raw', 'rgba16float'), aoBlur = half('ao.blur', 'rgba16float');
    const on = () => s.ao > 0;
    const pass = (label: string, target: Texture | ReturnType<Texture['mip']>, enabled: () => boolean, clear: GPUColor | false = [0, 0, 0, 0]) => {
      const p = kit.pass({ label, color: [{ target, clear }], enabled });
      this.aoPasses.push(p);
      return p;
    };
    pass('ao.prep', zHalf.mip(0), on).fullscreen(aoShader, { label: 'ao.prep', fragment: 'prep', bind: { sceneZ: this.sceneZ } as never });
    for (let m = 1; m < 3; m++) pass(`ao.z${m}`, zHalf.mip(m), on).fullscreen(aoShader, { label: `ao.z${m}`, fragment: 'zdown', bind: { texA: zHalf.mip(m - 1) } as never });
    pass('ao', aoRaw, on).fullscreen(aoShader, { label: 'ao', fragment: 'ao', bind: { FX: this.u, sceneZ: this.sceneZ, zHalf } as never });
    pass('ao.blur', aoBlur, on).fullscreen(aoShader, { label: 'ao.blur', fragment: 'blur', bind: { FX: this.u, zHalf, texA: aoRaw, hdrTex: hdr } as never });
    // (multiplied into the scene)
    const multiply: GPUBlendState = { color: { srcFactor: 'dst', dstFactor: 'zero', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } };
    this.overlay = kit.pass({ label: 'overlay', color: [{ target: hdr, clear: false }] });
    this.overlay.fullscreen(aoShader, { label: 'ao.apply', fragment: 'apply', blend: multiply, bind: { FX: this.u, sceneZ: this.sceneZ, zHalf, texA: aoBlur } as never, enabled: on });

    this.shaftB = kit.texture({ label: 'rays.b', format: 'r16float', size: 'render', scale: 0.25, usage: ['render', 'sample'] });
    this.dofTex = half('dof', 'rgba16float');
  }

  /** the passes after the bloom: they read the smudged scene */
  attach(scene: Texture) {
    const kit = this.kit, s = this.settings;
    const quarter = (label: string) => kit.texture({ label, format: 'r16float', size: 'render', scale: 0.25, usage: ['render', 'sample'] });
    const mask = kit.texture({ label: 'rays.mask', format: 'r16float', size: 'render', scale: 0.5, usage: ['render', 'sample'] });
    const shaftA = quarter('rays.a');
    const measure = kit.compute(raysShader, { label: 'fx.measure', entry: 'measure', workgroups: [1], bind: { FX: this.u, sceneZ: this.sceneZ, hdrTex: this.hdr, fxState: this.state } as never });
    const rays = () => s.rays > 0;
    const pm = kit.pass({ label: 'rays.mask', color: [{ target: mask, clear: [0, 0, 0, 0] }], enabled: rays });
    pm.fullscreen(raysShader, { label: 'rays.mask', fragment: 'skymask', bind: { sceneZ: this.sceneZ, hdrTex: this.hdr } as never });
    const p0 = kit.pass({ label: 'rays.0', color: [{ target: shaftA, clear: [0, 0, 0, 0] }], enabled: rays });
    p0.fullscreen(raysShader, { label: 'rays.0', fragment: 'shafts', constants: { SHAFT_PASS: 0 }, bind: { FX: this.u, src: mask } as never });
    const p1 = kit.pass({ label: 'rays.1', color: [{ target: this.shaftB, clear: [0, 0, 0, 0] }], enabled: rays });
    p1.fullscreen(raysShader, { label: 'rays.1', fragment: 'shafts', constants: { SHAFT_PASS: 1 }, bind: { FX: this.u, src: shaftA } as never });
    const d = kit.pass({ label: 'dof', color: [{ target: this.dofTex, clear: [0, 0, 0, 0] }], enabled: () => s.dof });
    d.fullscreen(raysShader, { label: 'dof', fragment: 'dof', bind: { FX: this.u, sceneZ: this.sceneZ, src: scene, fxRead: this.state } as never });
    this.after = [measure, pm, p0, p1, d];
  }

  /** the final pass's bindings (post.wgsl through fx.wgsl) */
  bindings() {
    return { FX: this.u, fxSceneZ: this.sceneZ, fxRead: this.state, fxShafts: this.shaftB, fxDof: this.dofTex };
  }

  /** the weight of each wider bloom level (bloom.wgsl up) and what normalises their sum (as six levels' would be, so
   *  fewer levels keep the glow's strength) */
  get bloomWeight() { return 0.55 + 0.9 * this.settings.bloomRadius; }
  levels = 6;
  private bloomNorm() { let w = 0, k = 1; for (let i = 0; i < this.levels; i++) { w += k; k *= this.bloomWeight; } return 6 / w; }

  /** work that needs the scene's distances and draws into the overlay (Katara's bent water: its screen-space passes) */
  beforeOverlay: () => RunEntry[] = () => [];

  /** right after the scene pass: the distances, the occlusion, the overlay (the clouds) */
  pre(): RunEntry[] {
    this.setU();
    return [this.zPass, ...this.aoPasses, ...this.beforeOverlay(), this.overlay];
  }

  private setU() {
    const s = this.settings;
    this.u.set({
      rays: [s.rays, s.raysLength, 0.93, s.raysAir], flare: [s.flare, s.glare, s.streak, 0],
      // (sharpening a little stronger below native scale: more to recover)
      lens: [s.aberration, Math.min(1, s.sharpen * (1 + (1 - this.kit.renderScale) * 0.9)), s.grain, s.halation], grade: [s.grade, this.bloomNorm(), 0, 0],
      dof: [s.dof ? 1 : 0, s.focus, s.aperture, s.dofMax], ao: [s.ao, s.aoRadius, 40, 260], misc: [this.frame++, 0, 0, 0],
    });
  }

  /** after the bloom, before the final pass */
  passes(): RunEntry[] { return this.after; }
}
