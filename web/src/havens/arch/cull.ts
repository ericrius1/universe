// The GPU's cull, for anything drawn as boxes of geometry each one indexed draw (the parts' pieces, arch.ts): a
// renderer hands it its boxes and their draws once (`add`), and gets back for each view — the scene's camera, the
// occluders' pass, every box (the debug view), each of the sun's cascades — a run of indirect draw arguments the GPU
// writes each frame, the culled boxes' with no instances (`CullSet.indirect`: weft's multi-draw indirect, one Draw
// however many boxes, recorded once into a render bundle). So the CPU never walks the boxes: a frame's cull is two
// computes, whatever the world's size (cull.wgsl).
//
// The scene's view is culled by what stands in front as well as by its frustum, two-phase so that nothing is ever
// missing or late: the boxes the scene drew last frame that are still in view and near the eye (settings.reach) are
// drawn first, depth-only, into the occluders' depth (`prez`: each renderer puts its own draws in it), at this
// frame's camera; a depth pyramid is made of that (hiz.wgsl), and every box in the frustum is tested against it. The
// occluders are real geometry drawn where it is now, so a turn or a fast flight can't reveal a box a frame late, and
// the first frame or a jump of the camera (h.view) only finds fewer occluders. Out in the open — the eye high over
// the town — nothing is near enough to occlude, and the occluders' pass and the pyramid are skipped. And it runs only
// while it pays: in an open square little is wholly hidden, and the occluders' pass and the pyramid would cost more
// than the pieces they hide; there it's tried once every so often (settings.probe frames, and at once when the eye
// jumps or turns sharply), and kept on from the first time it hides enough (settings.pays triangles). The cascades are culled by their frustums alone.
//
// A renderer's draws: one per view, from the set's arguments (its first instance the box's own index in the set, so
// a shader finds the box's data by @builtin(instance_index) & 0xffffff; the top byte is the debug view's verdict).
//   const set = cull.add('city', boxes, draws);         // boxes: 6 floats each (min, max), draws: 3 u32 each (first
//                                                       //   index, index count, base vertex)
//   bundle.draw(shader, { indices, indirect: set.indirect(SCENE) });             // the scene
//   cull.prez.bundle().draw(shader, { vertex: 'depthOnly', fragment: null, indices, indirect: set.indirect(OCCLUDERS) });
//   shadowBundle[k].draw(shader, { ..., indirect: set.indirect(CASCADE0 + k) });
//   kit.run([...cull.passes(), shadows, scene])         // before anything that draws with them
// Needs the 'indirect-first-instance' feature (`Cull.supported`): without it a renderer culls on the CPU.
//
// A renderer whose draws aren't one per box (the parts library's instances: a draw per prototype, its visible
// instances packed into a list) culls in a compute of its own, with the same views: its shader includes
// cullviews.wgsl (inFrustum, cascadeDrawn, occluded, frozen), binds `cull.views()`, and is hooked into the cull's run
// — after the frustums (`hook('frustum', …)`: the cascades' draws, before the cascades are drawn) or after the
// pyramid (`hook('occlude', …)`: the scene's, the occlusion test valid there). Its draws then read its own arguments.
import { Ref, RunAction, type Compute, type Kit, type RenderPass, type RunEntry, type StorageBuffer, type Texture, type TexView, type UniformBuffer, type View } from '@ericrius1/weft';
import cullShader from './cull.wgsl';
import hizShader from './hiz.wgsl';

/** the regions of the draw arguments: the scene's, the occluders', every box (the debug view), each cascade's from
 *  CASCADE0 */
export const SCENE = 0;
export const OCCLUDERS = 1;
export const EVERY = 2;
export const CASCADE0 = 3;
/** an indexed draw's arguments (bytes) */
const ARGS = 20;
/** a box in the GPU's list (bytes: min and max, each a vec4) */
const BOX = 32;
/** the cascades the cull's uniform has planes for */
const MAX_CASCADES = 7;
const FLAG_OCCLUSION = 1;
const FLAG_FROZEN = 2;

/** what a view drew last frame, as read back: its boxes, their triangles */
export interface CullCount { pieces: number; triangles: number }

/** one renderer's boxes in the cull: their draws' arguments, per view */
export class CullSet {
  constructor(private cull: Cull, readonly label: string, readonly base: number, readonly count: number,
    readonly boxes: Float32Array, readonly draws: Uint32Array, readonly solid: Uint32Array | null) {}
  /** a view's draws for weft's multi-draw indirect (DrawOptions.indirect): `region` SCENE, OCCLUDERS, EVERY or
   *  CASCADE0 + k, or a function choosing one each frame (a bundle records again when it changes) */
  indirect(region: number | (() => number)) {
    const c = this.cull;
    return { buffer: c.args, offset: () => ((typeof region === 'function' ? region() : region) * c.cap + this.base) * ARGS, count: this.count, stride: ARGS };
  }
}

export class Cull {
  /** the occlusion test on; how near the eye a box last drawn must be to occlude (m); the triangles it must hide to be
   *  worth running (0: always), and how often it's tried while it isn't (frames); the scene's verdicts frozen as they
   *  are (the debug view: fly off and look at what was drawn) */
  readonly settings = { occlusion: true, reach: 260, pays: 150_000, probe: 30, freeze: false };
  /** whether this GPU can (a draw's first instance from an indirect draw's arguments) */
  readonly supported: boolean;
  readonly sets: CullSet[] = [];
  /** the boxes each region of the arguments has room for */
  cap = 0;
  /** the boxes in all */
  total = 0;
  /** the draw arguments: regions of `cap` boxes each */
  readonly args: StorageBuffer;
  /** the occluders' pass (depth-only): renderers draw what they drew last frame into it (their OCCLUDERS region) */
  readonly prez: RenderPass;
  /** the occluders' depth (one sample, the render's size) */
  readonly prezDepth: Texture;
  /** what each view drew, read back (a frame or two late): by region, and the scene's boxes the occluders hid */
  readonly drawn = new Map<number, CullCount>();
  hidden: CullCount = { pieces: 0, triangles: 0 };
  /** the boxes near enough and drawn to be occluders, as read back (till one is: assumed some) */
  candidates = 1;
  /** the occlusion test ran this frame */
  occluding = false;
  /** the occlusion hid enough to pay, the last time it ran; the frames since it was last tried */
  paying = true;
  private sinceTried = 0;
  /** where the scene's eye was and looked, the last frame */
  private was = { at: [0, 0, 0], fwd: [0, 0, 0] };

  private regions: number;
  private boxes: StorageBuffer;
  private state: StorageBuffer;
  private counts: StorageBuffer;
  private u: UniformBuffer<any>;
  private planes = new Float32Array(48 * 4);
  private frustum: Compute;
  private occlude: Compute;
  private hiz!: Texture;
  private hizMips: TexView[] = [];
  private dummies: Texture[];
  private downs: Compute[] = [];
  private downU: UniformBuffer<any>[] = [];
  private readback: { buf: GPUBuffer; busy: boolean };
  private items: RunEntry[];
  private hizRef: Ref<Texture>;

  /** `due`: whether cascade k is drawn this frame (one that isn't — not in use, or a far one on its frame off — is
   *  left as it was) */
  constructor(readonly kit: Kit, readonly shadows: View[], readonly due: (k: number) => boolean = () => true, readonly scene: View = kit.mainView) {
    if (shadows.length > MAX_CASCADES) throw new Error(`cull: at most ${MAX_CASCADES} cascades`);
    this.supported = kit.features.has('indirect-first-instance');
    this.regions = CASCADE0 + shadows.length;
    this.args = kit.storage({ label: 'cull.args', size: 64, usage: ['storage', 'indirect', 'copy-dst', 'copy-src'] });
    this.boxes = kit.storage({ label: 'cull.boxes', size: 64 });
    this.state = kit.storage({ label: 'cull.state', size: 64 });
    const countBytes = (this.regions * 2 + 4) * 4;
    this.counts = kit.storage({ label: 'cull.counts', size: countBytes, usage: ['storage', 'copy-src', 'copy-dst'] });
    this.readback = { buf: kit.device.createBuffer({ label: 'cull.counts.read', size: Math.ceil(countBytes / 16) * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), busy: false };
    this.u = kit.uniforms(cullShader.structs.CullU, 'cull');
    this.prezDepth = kit.texture({ label: 'cull.occluders', format: 'depth32float', size: 'render', usage: ['render', 'sample'] });
    this.prez = kit.pass({ label: 'cull.occluders', depth: { target: this.prezDepth, clear: 0 }, enabled: () => this.occluding });
    this.fit();
    const hizRef = this.hizRef = new Ref(() => this.hiz);
    const bind = { CU: this.u, boxes: this.boxes, args: this.args, state: this.state, counts: this.counts };
    const threads = () => [this.total];
    this.frustum = kit.compute(cullShader, { label: 'cull.frustum', entry: 'frustum', threads, bind: bind as never, enabled: () => this.total > 0 });
    this.occlude = kit.compute(cullShader, {
      label: 'cull.occlude', entry: 'occlude', threads, bind: { ...bind, hiz: hizRef } as never, enabled: () => this.total > 0 && !this.settings.freeze,
    });
    // the pyramid: four levels a dispatch (enough dispatches for 2^16 px; those past the last level do nothing), the
    // slots past it bound to stand-ins
    this.dummies = [0, 1, 2].map((i) => kit.texture({ label: `cull.hiz.unused${i}`, format: 'r32float', size: [1, 1], usage: ['storage', 'sample'] }));
    for (let j = 0; j < 4; j++) {
      const u = kit.uniforms(hizShader.structs.HizU, `cull.hiz${j}`);
      // (a level past the last: a stand-in, in a dispatch that never runs or a slot it never writes)
      const mip = (k: number, or: number) => new Ref(() => this.hizMips[k] ?? this.dummies[or]);
      const dst = (k: number) => mip(4 * j + k, Math.max(0, k - 1));
      const level = (k: number) => [Math.max(1, this.hiz.width >> k), Math.max(1, this.hiz.height >> k)];
      this.downs.push(kit.compute(hizShader, {
        label: `cull.hiz${j}`, entry: j === 0 ? 'fromDepth' : 'fromLevel',
        workgroups: () => { const [w, h] = level(4 * j); return [Math.ceil(w / 8), Math.ceil(h / 8)]; },
        bind: { HZ: u, ...(j === 0 ? { depth: this.prezDepth } : { src: mip(4 * j - 1, 0) }), dst0: dst(0), dst1: dst(1), dst2: dst(2), dst3: dst(3) } as never,
        enabled: () => this.occluding && 4 * j < this.hizMips.length,
      }));
      this.downU.push(u);
    }
    this.items = [
      new RunAction(() => this.begin(), 'cull.begin'),
      kit.raw((enc) => enc.clearBuffer(this.counts.gpu), 'cull.clear'),
      this.frustum, this.prez, ...this.downs, this.occlude,
      kit.raw((enc) => this.read(enc), 'cull.read'),
    ];
  }

  /** a renderer's boxes (6 floats each: min x, y, z, max x, y, z) and their indexed draws (3 u32 each: first index,
   *  index count, base vertex); each drawn until the first cull says otherwise. `solid`: per box, how many of its
   *  first indices to draw as an occluder (its big triangles: a subset of what's drawn hides no more than all of it,
   *  so the test stays sure; by default all of them) */
  add(label: string, boxes: Float32Array, draws: Uint32Array, solid: Uint32Array | null = null): CullSet {
    const count = draws.length / 3, set = new CullSet(this, label, this.total, count, boxes, draws, solid);
    this.sets.push(set);
    this.total += count;
    if (this.total > this.cap) {
      // (room for twice as many: everything written again, the verdicts forgotten)
      this.cap = Math.max(256, 2 ** Math.ceil(Math.log2(this.total)));
      this.args.ensure(this.regions * this.cap * ARGS);
      this.boxes.ensure(this.cap * BOX);
      this.state.ensure(this.cap * 4);
      this.kit.queue.writeBuffer(this.state.gpu, 0, new Uint32Array(this.cap));
      for (const s of this.sets) this.upload(s);
    } else this.upload(set);
    return set;
  }

  /** the passes, in order, before anything that draws with the arguments (the cascades, the scene) */
  passes(): RunEntry[] { return this.items; }

  /** what a cull shader of a renderer's own binds (it includes cullviews.wgsl): the views, the occluders' pyramid */
  views() { return { CU: this.u, hiz: this.hizRef }; }

  /** a renderer's own cull (computes including cullviews.wgsl), run after the frustums ('frustum': the cascades'
   *  verdicts, before they're drawn; the occlusion test not yet valid) or after the occlusion test ('occlude': the
   *  pyramid made, the scene's verdicts) */
  hook(after: 'frustum' | 'occlude', ...items: RunEntry[]) {
    const at = this.items.indexOf(after === 'frustum' ? this.frustum : this.occlude);
    this.items.splice(at + 1, 0, ...items);
  }

  private upload(s: CullSet) {
    const box = new Float32Array(s.count * 8), B = s.boxes, D = s.draws, O = s.solid;
    for (let i = 0; i < s.count; i++) box.set([B[i * 6], B[i * 6 + 1], B[i * 6 + 2], 0, B[i * 6 + 3], B[i * 6 + 4], B[i * 6 + 5], 0], i * 8);
    this.boxes.write(box, s.base * BOX);
    const a = new Uint32Array(s.count * 5);
    for (let r = 0; r < this.regions; r++) {
      // (each box drawn till the first cull: none in the occluders' pass, which draws its occluders alone)
      for (let i = 0; i < s.count; i++) a.set([r === OCCLUDERS && O ? O[i] : D[i * 3 + 1], r === OCCLUDERS ? 0 : 1, D[i * 3], D[i * 3 + 2], i], i * 5);
      this.args.write(a, (r * this.cap + s.base) * ARGS);
    }
  }

  /** the pyramid sized to the render: level 0 half of it, padded up to powers of two (hiz.wgsl) */
  private fit() {
    const kit = this.kit, [w, h] = kit.size.render;
    const P = 2 ** Math.ceil(Math.log2(Math.ceil(w / 2))), Q = 2 ** Math.ceil(Math.log2(Math.ceil(h / 2)));
    if (this.hiz && this.hiz.width === P && this.hiz.height === Q) return;
    if (this.hiz) kit.release(this.hiz);
    this.hiz = kit.texture({ label: 'cull.hiz', format: 'r32float', size: [P, Q], mips: 'full', usage: ['sample', 'storage'] });
    this.hizMips = Array.from({ length: this.hiz.mips }, (_, k) => this.hiz.mip(k));
  }

  /** each frame, the views' matrices made: the pyramid's size, the views' planes, whether the occlusion runs */
  private begin() {
    const kit = this.kit, [w, h] = kit.size.render;
    this.fit();
    const levels = this.hizMips.length;
    this.downU.forEach((u, j) => { u.set({ at: [4 * j, Math.max(1, Math.min(4, levels - 4 * j)), w, h] }); u.upload(); });
    const s = this.settings;
    // (the occlusion only once every step of it can run: a pyramid left from another frame would hide what's there; and
    // only while anything's near enough to occlude: none, and the occluders' pass and the pyramid would cost for nothing)
    const can = s.occlusion && !s.freeze && this.total > 0 && this.candidates > 0 && !!this.occlude.pipe.pipeline && this.downs.every((d) => !!d.pipe.pipeline);
    // (a jump of the eye or a sharp turn: somewhere else, tried at once)
    const eye = this.scene.camera, a = this.was.at, f = this.was.fwd, p = eye.position, g = eye.forward;
    const moved = Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]) > 10 || g[0] * f[0] + g[1] * f[1] + g[2] * f[2] < 0.95;
    this.was = { at: [p[0], p[1], p[2]], fwd: [g[0], g[1], g[2]] };
    // (and the try kept waiting till it can run: just down from the air, the occluders aren't counted yet)
    if (moved) this.sinceTried = s.probe;
    this.occluding = can && (this.paying || s.pays <= 0 || ++this.sinceTried >= s.probe);
    if (this.occluding) this.sinceTried = 0;
    let cascades = 0;
    this.shadows.forEach((_, k) => { if (this.due(k)) cascades |= 256 << k; });
    const cam = this.scene.camera;
    this.planes.set(cam.planes, 0);
    this.shadows.forEach((v, k) => this.planes.set(v.camera.planes, (1 + k) * 24));
    this.u.set({
      planes: this.planes, viewProj: cam.viewProj, eye: [cam.position[0], cam.position[1], cam.position[2], s.reach], screen: [w, h, levels, 0],
      n: [this.total, this.shadows.length, this.cap, (this.occluding ? FLAG_OCCLUSION : 0) | (s.freeze ? FLAG_FROZEN : 0) | cascades],
    });
    this.u.upload();
  }

  /** the counts copied out for reading (one read at a time: a frame or two late) */
  private read(enc: GPUCommandEncoder) {
    const rb = this.readback, tried = this.occluding;
    // (a try whose counts can't be read: tried again next frame)
    if (rb.busy || !this.total) { if (tried && !this.paying) this.sinceTried = this.settings.probe; return; }
    enc.copyBufferToBuffer(this.counts.gpu, 0, rb.buf, 0, this.counts.size);
    rb.busy = true;
    // (mapped once the frame's commands are submitted: kit.run submits right after encoding)
    queueMicrotask(() => {
      rb.buf.mapAsync(GPUMapMode.READ).then(() => {
        const c = new Uint32Array(rb.buf.getMappedRange().slice(0));
        rb.buf.unmap();
        rb.busy = false;
        for (let r = 0; r < this.regions; r++) this.drawn.set(r, { pieces: c[r * 2], triangles: c[r * 2 + 1] });
        this.hidden = { pieces: c[this.regions * 2], triangles: c[this.regions * 2 + 1] };
        if (!this.settings.freeze) this.candidates = c[this.regions * 2 + 2];
        if (tried) this.paying = this.hidden.triangles >= this.settings.pays;
      }).catch(() => { rb.busy = false; });
    });
  }
}
