// The bent water on screen (render.wgsl, smooth.wgsl), ported from the waterbending app's FluidRenderer. After the
// scene (and its distances, post/fx.ts sceneZ): a copy of the scene to refract, the particles' spheres drawn to a depth
// of their own (full resolution; half on a phone) and a thickness (half), the depth smoothed — `passes()`. Then, in the
// pass over the finished scene (post/fx.ts's overlay, which targets the HDR), the composite: refracting the copy,
// absorbing through the thickness, the sky and the sun on it, ice, mist, snow, spray, its glow; and the charge's light
// inside it. Its shadow goes into the two nearest cascades. Nothing runs or draws while the sim is idle, and its
// screen targets stay 1×1 until the first time she bends (~31 MB at 1280×800 for anyone who never does).
import type { Kit, RenderPass, RunEntry, Texture, UniformBuffer, Compute } from '@ericrius1/weft';
import shader, { type FR } from './render.wgsl';
import smoothShader, { type SmoothU } from './smooth.wgsl';
import type { Fluid } from './fluid';

// the composite over the scene: alpha-blended colour, the target's own alpha kept (the clouds' and the AO's are there)
const OVER: GPUBlendState = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } };
const ADD: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } };

export class FluidRender {
  // (filterPx: the most the depth filter reaches, in pixels at 720 lines of the depth — scaled with its resolution, so a
  // supersampled film is smoothed as the game is)
  params = {
    radius: 0.1, thickRadius: 0.12, iceRadius: 0.07, shardRadius: 0.025, filterRadius: 0.3, filterPx: 36, threshold: 0.12, iterations: 1,
    refraction: 0.09, glow: 1, flowLight: 1.2,
    /** how big held water draws (a great orb reads as one body at a distance), and water hurled at a mark (a torrent) */
    heldScale: 1, hurlScale: 2.4,
    /** more of the water's thin-film colour (0: its own faint play; a qi ball held in her palms shimmers) */
    irid: 0,
  };
  tint: [number, number, number] = [0.025, 0.11, 0.12];
  /** spirit water (drawn from a glowing pond): its own light, rgb, and how far the water she holds has become it (0..1:
   *  drawn to deep blue, lit from within) */
  spirit: [number, number, number, number] = [0, 0, 0, 0];
  /** its charge (energy.ts): x how charged (0..1), y the heart's phase (beats), z brightness; and where it is (xyz, w
   *  its size, m) — lit from within by fsEnergy */
  energy: [number, number, number, number] = [0, 0, 0, 0];
  energyAt: [number, number, number, number] = [0, 0, 0, 1];
  /** the charge's light on the water (energy.ts): where and how far it reaches (m; 0 none), its colour x intensity and
   *  size — the app's point light, kept to the bent water */
  light: [number, number, number, number] = [0, 0, 0, 0];
  lightColor: [number, number, number, number] = [0, 0, 0, 1];
  // (glacial water, a little stylised: red goes first, so the body reads cyan-teal through its real depth; clearer and
  // more lit from within than the app's [2.6, 0.7, 0.5] and tint: this world's grass and lake are darker than its
  // pebble beaches, and through them it read as dark glass)
  absorb: [number, number, number] = [1.6, 0.42, 0.3];
  /** its own light's scale (the glow along its lines, spirit water, the charge): the app's sun is 20, this world's 1 */
  emissive = 0.05;
  enabled = true;
  /** the depth (and so the composite's normals) at this fraction of the render's resolution */
  readonly depthScale: number;
  /** the smoothed depth of the water's surface (m along the view axis; 0 none), at depthScale of the render's size */
  readonly depth: Texture;
  private raw: Texture;
  private pong: Texture;
  private ds: Texture;
  private thick: Texture;
  private mat: Texture;
  private copyTex: Texture;
  private u: UniformBuffer<FR>;
  private smoothU: UniformBuffer<SmoothU>[] = [];
  private smooth: Compute[] = [];
  private items: RunEntry[] = [];
  private list: RunEntry[] = [];
  private live = false;
  /** the screen targets at their real sizes yet (and those sizes) */
  private grown = false;
  private liveFrames = 0;
  private sized: [Texture, number][] = [];
  private time = 0;
  /** the light running along a built form's lines (eased in and out with the form) */
  private flowK = 0;

  constructor(readonly kit: Kit, readonly fluid: Fluid) {
    this.depthScale = fluid.profile.depthScale;
    const tex = (label: string, format: GPUTextureFormat, scale: number, usage: ('render' | 'sample' | 'storage' | 'copy-dst')[]) => {
      const t = kit.texture({ label, format, size: 'render', scale: 1e-6, usage });
      this.sized.push([t, scale]);
      return t;
    };
    const s = this.depthScale;
    this.raw = tex('fluid.raw', 'rg32float', s, ['render', 'sample']);
    this.pong = tex('fluid.smoothA', 'r32float', s, ['storage', 'sample']);
    this.depth = tex('fluid.smoothB', 'r32float', s, ['storage', 'sample']);
    this.ds = tex('fluid.ds', 'depth32float', s, ['render']);
    this.thick = tex('fluid.thick', 'rgba16float', 0.5, ['render', 'sample']);
    this.mat = tex('fluid.mat', 'rgba16float', 0.5, ['render', 'sample']);
    this.copyTex = tex('fluid.scene', 'rgba16float', 1, ['sample', 'copy-dst']);
    this.u = kit.uniforms(shader.structs.FR, 'fluid.render');
    // smoothing ping-pong (2D passes): raw -> A -> B (-> A -> B); the composite reads B
    const steps: [Texture, Texture][] = [[this.raw, this.pong], [this.pong, this.depth], [this.depth, this.pong], [this.pong, this.depth]];
    steps.forEach(([src, dst], i) => {
      const u = kit.uniforms(smoothShader.structs.SmoothU, `fluid.smooth${i}`);
      this.smoothU.push(u);
      this.smooth.push(kit.compute(smoothShader, { label: `fluid.smooth${i}`, entry: 'smoothPass', threads: () => [dst.width, dst.height], bind: { SM: u, src, raw: this.raw, dst } }));
    });
  }

  /** drawn (and its passes run) this frame */
  get active() { return this.live; }

  /** the shadow, in the two nearer cascades (shadows.passes[i]) */
  drawShadow(pass: RenderPass, cascade: number) {
    if (cascade > 1) return;
    pass.draw(shader, {
      label: `${pass.label}.fluid`, vertex: 'vsShadow', fragment: 'fsShadow', topology: 'triangle-strip', count: 4, instances: this.fluid.nMax,
      cull: 'none', bind: { PS: this.fluid.particles, R: this.u }, enabled: () => this.live,
    });
  }

  /** the composite (and the charge's light) into the pass over the finished scene (post.fx.overlay, after the clouds):
   *  `hdr` the scene it targets (copied, to refract), `sceneZ` the scene's distances (post.fx.sceneZ). Builds the
   *  passes `passes()` runs */
  draw(pass: RenderPass, hdr: Texture, sceneZ: Texture) {
    const kit = this.kit, P = this.fluid.particles;
    const bind = { PS: P, R: this.u, sceneZ, fDepth: this.depth, fThick: this.thick, sceneC: this.copyTex, fMat: this.mat };
    const depthPass = kit.pass({ label: 'fluid.depth', color: [{ target: this.raw, clear: [0, 0, 0, 0] }], depth: { target: this.ds, clear: 0, store: false } });
    depthPass.draw(shader, {
      label: 'fluid.depth', vertex: 'vsDepth', fragment: 'fsDepth', topology: 'triangle-strip', count: 4, instances: this.fluid.nMax,
      cull: 'none', depthCompare: 'greater', depthWrite: true, bind,
    });
    const thickPass = kit.pass({ label: 'fluid.thick', color: [{ target: this.thick, clear: [0, 0, 0, 0] }, { target: this.mat, clear: [0, 0, 0, 0] }] });
    thickPass.draw(shader, {
      label: 'fluid.thick', vertex: 'vsThick', fragment: 'fsThick', topology: 'triangle-strip', count: 4, instances: this.fluid.nMax,
      cull: 'none', blend: 'add', bind,
    });
    this.items = [kit.copy(hdr, this.copyTex, 'fluid.copy'), depthPass, thickPass];
    pass.fullscreen(shader, { label: 'fluid.composite', fragment: 'fsComposite', blend: OVER, bind, enabled: () => this.live });
    // (the charge's light inside the water: its own entry point — the composite is as big as Metal's compiler takes —
    // added over it)
    pass.fullscreen(shader, { label: 'fluid.energy', fragment: 'fsEnergy', blend: ADD, bind, enabled: () => this.live && this.energy[0] > 0.02 });
  }

  /** every frame, after the fluid's update */
  update(dt: number) {
    this.time = (this.time + dt) % 1000;
    this.live = this.enabled && this.fluid.active && this.items.length > 0;
    const list = this.list;
    list.length = 0;
    if (!this.live) return;
    // (the fluid's first frame, its initialisation, is live too: they grow from the second — a bend's first)
    if (!this.grown && ++this.liveFrames > 1) {
      this.grown = true;
      for (const [t, k] of this.sized) { t.desc.scale = k; t.alloc(); }
    }
    const p = this.params, f = this.fluid;
    this.flowK += ((f.pathMode >= 4 && f.path.length > 8 ? 1 : 0) - this.flowK) * 0.04;
    this.u.set({
      radius: p.radius, thickRadius: p.thickRadius, iceRadius: p.iceRadius, shardRadius: p.shardRadius,
      absorb: [...this.absorb, p.refraction], tint: [...this.tint, p.glow], iceTint: [0.62, 0.82, 0.95, 0.75],
      params: [p.filterRadius, p.threshold, this.time, this.emissive],
      flow: [this.flowK, Math.max(f.strandLen, 2), Math.max(f.path.length, 2), p.flowLight],
      shape: [f.vortex, p.heldScale, p.hurlScale, p.irid],
      spirit: this.spirit, energy: this.energy, ecen: this.energyAt, light: this.light, lightC: this.lightColor,
      scale: [this.depthScale, 0.5, 0, 0],
    });
    const n = Math.max(1, Math.min(2, p.iterations)) * 2;
    const h = Math.max(this.raw.height, 360);
    for (let i = 0; i < n; i++) this.smoothU[i].set({ radiusPx: (p.filterPx * h) / 720, threshold: p.threshold, worldRadius: p.filterRadius, passIdx: i });
    list.push(...this.items, ...this.smooth.slice(0, n));
  }

  /** this frame's passes (empty while idle): after the scene's distances (post.fx's sceneZ pass), before the overlay */
  passes(): RunEntry[] { return this.list; }
}
