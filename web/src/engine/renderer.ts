// The frame: one scene pass into a small G-buffer (light, view normals, an id per pixel for picking), then ambient
// occlusion at half resolution, the composite (occlusion, haze, highlight), bloom down and up a mip chain, and the
// grade to the screen. Systems (organelles, filaments, molecules) add their draws to `scene` and their compute work to
// `before`.
import type { Kit, RunEntry, Texture, UniformBuffer, RenderPass, StorageBuffer } from '@ericrius1/weft';
import worldShader from '../../shaders/world.wgsl';
import post from '../../shaders/post.wgsl';
import jewelShader from '../../shaders/jewel.wgsl';
import jewelLay from '../../shaders/jewel_lay.wgsl';
import type { Globals } from '../../shaders/world.wgsl';

export const BLOOM_MIPS = 6;

export class Renderer {
  readonly hdr: Texture;
  readonly nrm: Texture;
  readonly ids: Texture;
  readonly depth: Texture;
  readonly ao: Texture;
  readonly lit: Texture;
  readonly bloom: Texture;
  readonly globals: UniformBuffer<Globals>;
  readonly post: UniformBuffer<any>;
  readonly scene: RenderPass;
  /** see-through layers (membranes from afar): weighted blended transparency over the scene's depth */
  readonly glass: RenderPass;
  readonly accum: Texture;
  readonly reveal: Texture;
  readonly dofHalf: Texture;
  readonly dofOut: Texture;
  /** compute work that must run before the scene (molecule generation, culling) */
  readonly before: RunEntry[] = [];
  /** another's work to run first this frame (the keepers' world, for the jewel to read) */
  first: () => RunEntry[] = () => [];
  /** the jewel (src/loop.ts): its uniform, once it's made (jewel()) */
  jewelU: UniformBuffer<any> | null = null;
  jewelOn = false;
  private items: RunEntry[];
  private levels: UniformBuffer<any>[] = [];

  constructor(readonly kit: Kit, organelles: StorageBuffer) {
    const k = kit;
    this.globals = k.uniforms(worldShader.structs.Globals, 'globals');
    k.setGlobals(this.globals);
    k.shareGroup(1, worldShader, { organelles }, 'world');
    this.post = k.uniforms(post.structs.Post, 'post').set({
      aoRadius: 0.12, aoStrength: 1.1, bloom: 0.22, bloomRadius: 1.0, vignette: 0.55, grain: 0.012, saturation: 1.12, contrast: 1.14,
      dofMax: 8, dofRange: 0.7,
    });
    k.overlay.tweak(this.post, 'post');

    this.hdr = k.texture({ label: 'hdr', format: 'rgba16float', size: 'render' });
    this.nrm = k.texture({ label: 'normals', format: 'rgba16float', size: 'render' });
    this.ids = k.texture({ label: 'ids', format: 'r32uint', size: 'render', usage: ['render', 'sample', 'copy-src'] });
    this.depth = k.texture({ label: 'depth', format: 'depth32float', size: 'render', usage: ['render', 'sample', 'copy-src'] });
    this.ao = k.texture({ label: 'ao', format: 'r16float', size: 'render', scale: 0.5 });
    this.lit = k.texture({ label: 'lit', format: 'rgba16float', size: 'render' });
    this.bloom = k.texture({ label: 'bloom', format: 'rgba16float', size: 'render', scale: 0.5, mips: BLOOM_MIPS });
    this.accum = k.texture({ label: 'glass.accum', format: 'rgba16float', size: 'render' });
    this.reveal = k.texture({ label: 'glass.reveal', format: 'r16float', size: 'render' });
    this.dofHalf = k.texture({ label: 'dof.in', format: 'rgba16float', size: 'render', scale: 0.5 });
    this.dofOut = k.texture({ label: 'dof.out', format: 'rgba16float', size: 'render', scale: 0.5 });

    this.scene = k.pass({
      label: 'scene',
      color: [{ target: this.hdr, clear: [0, 0, 0, 1] }, { target: this.nrm, clear: [0, 0, 1, 0] }, { target: this.ids, clear: [0, 0, 0, 0] }],
      depth: { target: this.depth, clear: 0 },
    });

    this.glass = k.pass({
      label: 'glass',
      color: [{ target: this.accum, clear: [0, 0, 0, 0] }, { target: this.reveal, clear: [1, 1, 1, 1] }],
      depth: { target: this.depth, readOnly: true },
    });
    const P = this.post;
    const aoPass = k.pass({ label: 'ao', color: [{ target: this.ao, clear: [1, 1, 1, 1] }] });
    aoPass.fullscreen(post, { label: 'ao', fragment: 'fs_ao', bind: { P, depthTex: this.depth, nrmTex: this.nrm } });
    const comp = k.pass({ label: 'composite', color: [{ target: this.lit, clear: [0, 0, 0, 1] }] });
    comp.fullscreen(post, { label: 'composite', fragment: 'fs_composite', bind: { P, depthTex: this.depth, hdrTex: this.hdr, aoTex: this.ao, idTex: this.ids, accumTex: this.accum, revealTex: this.reveal } });
    const dofOn = () => (this.globals.get('dof') as number) > 0;
    const dofDown = k.pass({ label: 'dof.down', color: [{ target: this.dofHalf, clear: [0, 0, 0, 0] }], enabled: dofOn });
    dofDown.fullscreen(post, { label: 'dof.down', fragment: 'fs_dofdown', bind: { P, srcTex: this.lit, depthTex: this.depth } });
    const dof = k.pass({ label: 'dof', color: [{ target: this.dofOut, clear: [0, 0, 0, 1] }], enabled: dofOn });
    dof.fullscreen(post, { label: 'dof', fragment: 'fs_dof', bind: { P, srcTex: this.dofHalf } });

    const bloomItems: RunEntry[] = [];
    const lvl = (mip: number) => {
      const u = k.uniforms(post.structs.Lvl, `bloom.l${mip}`);
      this.levels.push(u);
      return u;
    };
    for (let i = 0; i < BLOOM_MIPS; i++) {
      const p = k.pass({ label: `bloom.down${i}`, color: [{ target: this.bloom.mip(i), clear: [0, 0, 0, 1] }] });
      p.fullscreen(post, { label: `bloom.down${i}`, fragment: 'fs_down', bind: { P, L: lvl(i), srcTex: i === 0 ? this.lit : this.bloom.mip(i - 1) } });
      bloomItems.push(p);
    }
    for (let i = BLOOM_MIPS - 2; i >= 0; i--) {
      const p = k.pass({ label: `bloom.up${i}`, color: [{ target: this.bloom.mip(i), clear: false }] });
      p.fullscreen(post, { label: `bloom.up${i}`, fragment: 'fs_up', blend: 'add', bind: { P, L: lvl(BLOOM_MIPS + i), srcTex: this.bloom.mip(i + 1) } });
      bloomItems.push(p);
    }
    const fin = k.pass({ label: 'final', color: [{ target: 'screen', clear: [0, 0, 0, 1] }] });
    fin.fullscreen(post, { label: 'final', fragment: 'fs_final', bind: { P, srcTex: this.lit, bloomTex: this.bloom.mip(0), dofTex: this.dofOut, depthTex: this.depth } });

    this.items = [this.scene, this.glass, aoPass, comp, dofDown, dof, ...bloomItems, fin];
    this.afterComp = 4;
  }
  private afterComp: number;

  /** one bead made glass, the world in `inside` seen through it (drawn from this camera): drawn over the cell's light
   *  after its composite, its depth with it, before the focus and the bloom */
  jewel(inside: Texture, hi: boolean) {
    const k = this.kit;
    const J = this.jewelU = k.uniforms(jewelShader.structs.Jewel, 'jewel');
    const tex = k.texture({ label: 'jewel', format: 'rgba16float', size: 'render' });
    const on = () => this.jewelOn;
    const p = k.pass({ label: 'jewel', color: [{ target: tex, clear: [0, 0, 0, 0] }], enabled: on });
    p.fullscreen(jewelShader, { label: 'jewel', fragment: 'fs', constants: { HI: hi ? 1 : 0 }, bind: { J, litTex: this.lit, depthTex: this.depth, worldTex: inside } as never });
    const lay = k.pass({ label: 'jewel.lay', color: [{ target: this.lit, clear: false }], depth: { target: this.depth, clear: false }, enabled: on });
    lay.fullscreen(jewelLay, { label: 'jewel.lay', fragment: 'fs', blend: 'premultiplied', depthWrite: true, depthCompare: 'always', bind: { J, jewelTex: tex } as never });
    this.items.splice(this.afterComp, 0, p, lay);
  }

  /** the bloom passes' texel sizes follow the render size */
  private sizeLevels() {
    const [w, h] = this.kit.size.render;
    const size = (m: number) => [Math.max(1, (Math.round(w * 0.5)) >> m), Math.max(1, (Math.round(h * 0.5)) >> m)];
    for (let i = 0; i < BLOOM_MIPS; i++) {
      const src = i === 0 ? [w, h] : size(i - 1);
      this.levels[i].set({ texel: [1 / src[0], 1 / src[1]], mip: i, last: 0 });
    }
    for (let i = BLOOM_MIPS - 2; i >= 0; i--) {
      const s = size(i + 1);
      this.levels[BLOOM_MIPS + i].set({ texel: [1 / s[0], 1 / s[1]], mip: i, last: 0 });
    }
  }

  frame() {
    this.sizeLevels();
    this.kit.run([...this.first(), ...this.before, ...this.items]);
  }
}
