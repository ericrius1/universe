// The frame: one scene pass into a small G-buffer (light, view normals, an id per pixel for picking), then ambient
// occlusion at half resolution, the composite (occlusion, haze, highlight), the depth of field; then laid into the film
// every picture of the dive goes through (layInto: the cosmos's HDR, its bloom and grade). Systems (organelles,
// filaments, molecules) add their draws to `scene` and their compute work to `before`.
import type { Kit, RunEntry, Texture, UniformBuffer, RenderPass, StorageBuffer } from '@ericrius1/weft';
import worldShader from '../../shaders/world.wgsl';
import post from '../../shaders/post.wgsl';
import jewelShader from '../../shaders/jewel.wgsl';
import jewelLay from '../../shaders/jewel_lay.wgsl';
import type { Globals } from '../../shaders/world.wgsl';

export class Renderer {
  readonly hdr: Texture;
  readonly nrm: Texture;
  readonly ids: Texture;
  readonly depth: Texture;
  readonly ao: Texture;
  readonly lit: Texture;
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

  constructor(readonly kit: Kit, organelles: StorageBuffer) {
    const k = kit;
    this.globals = k.uniforms(worldShader.structs.Globals, 'globals');
    k.setGlobals(this.globals);
    k.shareGroup(1, worldShader, { organelles }, 'world');
    this.post = k.uniforms(post.structs.Post, 'post').set({ aoRadius: 0.12, aoStrength: 1.1, dofMax: 8, dofRange: 0.7, lay: 1 });
    k.overlay.tweak(this.post, 'post');

    this.hdr = k.texture({ label: 'hdr', format: 'rgba16float', size: 'render' });
    this.nrm = k.texture({ label: 'normals', format: 'rgba16float', size: 'render' });
    this.ids = k.texture({ label: 'ids', format: 'r32uint', size: 'render', usage: ['render', 'sample', 'copy-src'] });
    this.depth = k.texture({ label: 'depth', format: 'depth32float', size: 'render', usage: ['render', 'sample', 'copy-src'] });
    this.ao = k.texture({ label: 'ao', format: 'r16float', size: 'render', scale: 0.5 });
    this.lit = k.texture({ label: 'lit', format: 'rgba16float', size: 'render' });
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

    this.items = [this.scene, this.glass, aoPass, comp, dofDown, dof];
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

  /** its frame laid into the film's HDR (`target`, the cosmos's: one bloom and one grade for every picture of the dive),
   *  weighted by the post uniform's `lay` — under what's there as the two hand over — after this frame's own work */
  layInto(target: Texture): RenderPass {
    const p = this.kit.pass({ label: 'cell.lay', color: [{ target, clear: false }] });
    p.fullscreen(post, { label: 'cell.lay', fragment: 'fs_lay', blend: 'premultiplied', bind: { P: this.post, srcTex: this.lit, dofTex: this.dofOut, depthTex: this.depth } });
    return p;
  }

  /** this frame's GPU work, for a host to run with its own (the film after it, in one submission) */
  work(): RunEntry[] { return [...this.first(), ...this.before, ...this.items]; }
  frame() { this.kit.run(this.work()); }
}
