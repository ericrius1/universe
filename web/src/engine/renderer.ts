// The frame: one scene pass into a small G-buffer (light, view normals, an id per pixel for picking), then ambient
// occlusion at half resolution, the composite (occlusion, haze, highlight), the depth of field; then laid into the film
// every picture of the dive goes through (layInto: the cosmos's HDR, its bloom and grade). Systems (organelles,
// filaments, molecules) add their draws to `scene` and their compute work to `before`.
import type { Kit, RunEntry, Texture, UniformBuffer, RenderPass, StorageBuffer } from '@ericrius1/weft';
import worldShader from '../../shaders/world.wgsl';
import post from '../../shaders/post.wgsl';
import jewelShader from '../../shaders/jewel.wgsl';
import jewelLay from '../../shaders/jewel_lay.wgsl';
import motes from '../../shaders/motes.wgsl';
import type { Globals } from '../../shaders/world.wgsl';
import { CrowdVolume } from './volume';

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
  /** the molecules' beads, lit (see constructor) */
  readonly beads: RenderPass;
  /** see-through lines at the full size (thin filaments), with their own targets */
  readonly thin: RenderPass;
  readonly accumThin: Texture;
  readonly revealThin: Texture;
  /** the scene's depth at half its size, the nearest of each four: what the glass is drawn against */
  readonly glassDepth: Texture;
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

  /** how the cell is drawn: 'light' (lit, the default) or 'illustrative' (flat colour, occlusion, ink and fog, after
   *  Goodsell: world.wgsl illustrated, post.wgsl inked); a number works too (0, 1). ?look=illustrative to try it */
  look: 'light' | 'illustrative' | number = (new URLSearchParams(location.search).get('look') as 'illustrative') ?? 'light';
  /** parts of the light that can be left out (for timing them: tools/bench.mjs PARTS, or by hand) */
  parts = { crowd: true, crowdShade: true, motes: true };
  /** whether the eye is inside the nucleus (cell.ts sets it): chromatin outside the cut is out of sight from outside
   *  while the envelope is solid (world.wgsl chromatinShut) */
  eyeInNucleus: () => boolean = () => true;
  /** the crowd's density round the focus, for its occlusion and shadow (engine/volume.ts) */
  readonly crowd: CrowdVolume;

  constructor(readonly kit: Kit, organelles: StorageBuffer, quality = 1) {
    const k = kit;
    this.globals = k.uniforms(worldShader.structs.Globals, 'globals');
    k.setGlobals(this.globals);
    // (64³ cells on a computer, 32³ on a phone)
    this.crowd = new CrowdVolume(k, quality >= 1 ? 64 : 32, k.uniforms(worldShader.structs.Vol, 'crowd.place'));
    k.shareGroup(1, worldShader, { organelles, volTex: this.crowd.tex, V: this.crowd.V }, 'world');
    this.post = k.uniforms(post.structs.Post, 'post').set({ aoRadius: 0.12, aoStrength: 1.1, dofMax: 8, dofRange: 0.7, lay: 1 });
    k.overlay.tweak(this.post, 'post');

    this.hdr = k.texture({ label: 'hdr', format: 'rgba16float', size: 'render' });
    // (view normals, octahedral: world.wgsl octNormal)
    this.nrm = k.texture({ label: 'normals', format: 'rg16float', size: 'render' });
    this.ids = k.texture({ label: 'ids', format: 'r32uint', size: 'render', usage: ['render', 'sample', 'copy-src'] });
    this.depth = k.texture({ label: 'depth', format: 'depth32float', size: 'render', usage: ['render', 'sample', 'copy-src'] });
    // (occlusion, the haze's light, the crowd's occlusion and shadow: post.wgsl fs_ao)
    this.ao = k.texture({ label: 'ao', format: 'rgba16float', size: 'render', scale: 0.5 });
    this.lit = k.texture({ label: 'lit', format: 'rgba16float', size: 'render' });
    // (the glass at half the render's size, against the scene's depth at that size: post.wgsl glassOver lays it back
    // over the full size by depth. A film's, which has time for it, at the full size)
    const gs = new URLSearchParams(location.search).has('film') ? 1 : 0.5;
    this.accum = k.texture({ label: 'glass.accum', format: 'rgba16float', size: 'render', scale: gs });
    this.reveal = k.texture({ label: 'glass.reveal', format: 'r16float', size: 'render', scale: gs });
    this.glassDepth = gs < 1 ? k.texture({ label: 'glass.depth', format: 'depth32float', size: 'render', scale: gs }) : this.depth;
    // (and what's thin — a filament under a pixel across, a line — at the full size, into targets of its own: the two
    // sum to the one weighted blend, glassOver)
    this.accumThin = k.texture({ label: 'glass.thin.accum', format: 'rgba16float', size: 'render' });
    this.revealThin = k.texture({ label: 'glass.thin.reveal', format: 'r16float', size: 'render' });
    this.dofHalf = k.texture({ label: 'dof.in', format: 'rgba16float', size: 'render', scale: 0.5 });
    this.dofOut = k.texture({ label: 'dof.out', format: 'rgba16float', size: 'render', scale: 0.5 });

    this.scene = k.pass({
      label: 'scene',
      color: [{ target: this.hdr, clear: [0, 0, 0, 1] }, { target: this.nrm, clear: [0, 0, 0, 0] }, { target: this.ids, clear: [0, 0, 0, 0] }],
      depth: { target: this.depth, clear: 0 },
    });

    // the molecules' beads lit: after the scene has every bead's depth (field.ts draws them there depth-only, first),
    // tested against it and not writing it, so a bead behind what's there is dropped before it's shaded
    this.beads = k.pass({
      label: 'beads',
      color: [{ target: this.hdr, clear: false }, { target: this.nrm, clear: false }, { target: this.ids, clear: false }],
      depth: { target: this.depth, readOnly: true },
    });
    const P = this.post;
    const glassOn = () => (this.globals.get('shellSolid') as number) < 0.999;
    const half = k.pass({ label: 'glass.depth', depth: { target: this.glassDepth, clear: 0 }, enabled: () => gs < 1 && glassOn() });
    half.fullscreen(post, { label: 'glass.depth', fragment: 'fs_halfdepth', depthWrite: true, depthCompare: 'always', bind: { depthTex: this.depth } });
    this.glass = k.pass({
      label: 'glass',
      color: [{ target: this.accum, clear: [0, 0, 0, 0] }, { target: this.reveal, clear: [1, 1, 1, 1] }],
      depth: { target: this.glassDepth, readOnly: true },
    });
    this.thin = k.pass({
      label: 'glass.thin',
      color: [{ target: this.accumThin, clear: [0, 0, 0, 0] }, { target: this.revealThin, clear: [1, 1, 1, 1] }],
      depth: { target: this.depth, readOnly: true },
    });
    // specks adrift in the water, soft and out of focus (motes.wgsl): two sizes of 9³ tiles of 4
    const add: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
    const keepB: GPUBlendState = { color: { srcFactor: 'zero', dstFactor: 'one-minus-src' }, alpha: { srcFactor: 'zero', dstFactor: 'one-minus-src' } };
    this.thin.draw(motes, { label: 'motes', vertex: 'vs', fragment: 'fs', count: 2 * 9 * 9 * 9 * 4 * 6, cull: 'none', blend: [add, keepB], depthWrite: false, enabled: () => this.parts.motes && (this.globals.get('scale') as number) < 20000 });
    const aoPass = k.pass({ label: 'ao', color: [{ target: this.ao, clear: [1, 1, 1, 1] }] });
    aoPass.fullscreen(post, { label: 'ao', fragment: 'fs_ao', bind: { P, depthTex: this.depth, nrmTex: this.nrm } });
    const comp = k.pass({ label: 'composite', color: [{ target: this.lit, clear: [0, 0, 0, 1] }] });
    comp.fullscreen(post, { label: 'composite', fragment: 'fs_composite', bind: { P, depthTex: this.depth, hdrTex: this.hdr, aoTex: this.ao, idTex: this.ids, accumTex: this.accum, revealTex: this.reveal, glassDepthTex: this.glassDepth, thinAccumTex: this.accumThin, thinRevealTex: this.revealThin } });
    const dofOn = () => (this.globals.get('dof') as number) > 0;
    const dofDown = k.pass({ label: 'dof.down', color: [{ target: this.dofHalf, clear: [0, 0, 0, 0] }], enabled: dofOn });
    dofDown.fullscreen(post, { label: 'dof.down', fragment: 'fs_dofdown', bind: { P, srcTex: this.lit, depthTex: this.depth } });
    const dof = k.pass({ label: 'dof', color: [{ target: this.dofOut, clear: [0, 0, 0, 1] }], enabled: dofOn });
    dof.fullscreen(post, { label: 'dof', fragment: 'fs_dof', bind: { P, srcTex: this.dofHalf } });

    this.items = [this.scene, this.beads, half, this.glass, this.thin, aoPass, comp, dofDown, dof];
    this.afterComp = this.items.indexOf(comp) + 1;
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
    p.fullscreen(post, { label: 'cell.lay', fragment: 'fs_lay', blend: 'premultiplied', bind: { P: this.post, srcTex: this.lit, dofTex: this.dofOut, depthTex: this.depth, idTex: this.ids } });
    return p;
  }

  /** this frame's GPU work, for a host to run with its own (the film after it, in one submission) */
  work(): RunEntry[] {
    const G = this.globals;
    // (the crowd rests past ~20 µm: field.ts)
    const S = G.get('scale') as number;
    this.crowd.update(G.get('focus') as number[], S, this.parts.crowd ? Math.min(1, Math.max(0, (20000 - S) / 8000)) : 0);
    if (!this.parts.crowdShade) this.crowd.V.set({ on: 0 });
    const shut = (G.get('shellSolid') as number) >= 0.999 && !this.eyeInNucleus();
    this.crowd.V.set({ look: this.look === 'illustrative' || this.look === 1 ? 1 : 0, shut: shut ? 1 : 0 });
    return [...this.first(), ...this.before, ...this.crowd.work(), ...this.items];
  }
  frame() { this.kit.run(this.work()); }
}
