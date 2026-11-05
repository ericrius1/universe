// Beyond the observable universe: past its edge the zoom goes on, and the sphere of the microwave background turns out to
// be inside a glass marble a few centimetres across, floating over a palm. The keepers (keepers.ts) stand in a sea of
// cloud under a nebula: the first holds ours, the second turns its own between its hands with smaller ones going round
// it, and a thread of light between them is wound with more, as DNA is wound on its spools. Their world is a sphere too
// — its sky the inside of it — and from far enough outside it's a marble again (the cell's jewel, Universe's loop).
//
// Their bodies are meshes (drawn first, with their depth, 4× sampled); everything else is one fullscreen pass that solves
// the marbles, the sky and the cloud sea exactly and finds the threads' glow in closed form (c_beyond.wgsl), into a
// target of its own. From the cosmos's camera that's laid into its HDR, over the universe it bends through the glass of
// our marble; from the cell's (`view`), whoever draws the jewel reads it.
//
// The scale: our marble's glass is 1.1 times the edge of the observable universe (EDGE, web.ts), and 3.2 cm across a
// keeper's palm — so a centimetre there is 4,900 Mpc here. The cosmos frame's axes are theirs (y up).
import type { Kit, Texture, StorageBuffer, UniformBuffer, RenderPass } from '@ericrius1/weft';
import { Ref } from '@ericrius1/weft';
import keepersShader from '../shaders/c_keepers.wgsl';
import beyondShader from '../shaders/c_beyond.wgsl';
import volShader from '../shaders/c_vol.wgsl';
import type { CosmosRenderer, Level } from '../renderer';
import { MPC, type Ladder } from '../frames';
import { BEYOND_FILM, mixFilm } from '../film';
import {
  Choreography, MeshData, VBYTES, KIND, ORB_R, ORB_B, ORB_B_R, WORLD_C, WORLD_R, packed, keeperShapes, type Shapes,
  poseA, poseB, limbs, tips, tag, tube, HAND, add, sub, mul, madd, norm, cross, dot, len, lerp, turn, type V3, type KeeperPose, type Frame3,
} from './keepers';

const EDGE = 14300;
/** our marble's glass against the edge of the universe inside it */
const GLASS = 1.5;
/** cm (theirs) per Mpc (ours), and metres (ours) per cm (theirs) */
export const CM_PER_MPC = ORB_R / (EDGE * GLASS);
export const M_PER_CM = MPC / CM_PER_MPC;
/** log10 of the view distance (m) of a distance in their world (cm) */
export const logSOf = (cm: number) => Math.log10(cm * M_PER_CM);
/** the jewel's glass against their sky (the cell's bead is that much bigger than their world) */
export const JEWEL_GLASS = 1.08;

const LAYOUT: GPUVertexBufferLayout = {
  arrayStride: VBYTES, attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
    { shaderLocation: 2, offset: 24, format: 'float32x2' }, { shaderLocation: 3, offset: 32, format: 'uint32' },
  ],
};
const MAX_MARBLES = 40, MAX_CHUNKS = 64, MAX_SEGS = 1400;
/** the rigid parts: each keeper's head, body and palms */
const PARTS = 8;

/** a camera in their world (cm): where, which way, its lens */
export interface BeyondView { eye: V3; fwd: V3; right: V3; up: V3; tanHalf: number; aspect: number; pxAngle: number }

export interface BeyondOptions {
  /** where its pictures are: a folder's URL, or a file's name to its URL */
  assets: string | ((file: string) => string);
  /** a desktop's (refraction by colour, finer threads); a phone's not */
  hi: boolean;
  /** its targets' resolution, a fraction of the frame's */
  scale: number;
}

async function image(kit: Kit, url: string, label: string, mips: number): Promise<Texture> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none' });
  const t = kit.texture({ label, format: 'rgba8unorm-srgb', size: [bmp.width, bmp.height], mips, usage: ['sample', 'copy-dst', 'render'] });
  // (each mip drawn smaller by the browser: soft enough for the sky's reflections)
  let w = bmp.width, h = bmp.height;
  t.writeImage(bmp, { mip: 0 });
  for (let m = 1; m < mips; m++) {
    w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
    const cv = new OffscreenCanvas(w, h);
    const g = cv.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, w, h);
    t.writeImage(cv, { mip: m });
  }
  bmp.close();
  return t;
}

export class Beyond {
  readonly lv: Level;
  /** what it drew: light premultiplied by how much it covers (the cosmos lays it in; the cell's jewel reads it) */
  readonly out: Texture;
  readonly V: UniformBuffer<any>;
  readonly C: Choreography;
  /** their clock (s), or a film's own (clock) */
  time = 0;
  clock: number | null = null;
  /** drawn this frame, and from where (null: the cosmos's own camera) */
  on = false;
  view: BeyondView | null = null;
  /** the cosmos's picture of the universe is there to bend through our marble */
  universe = true;
  ready = false;
  private loading = false;
  private soon: ReturnType<typeof setTimeout> | null = null;
  private readonly hi: boolean;
  private readonly url: (f: string) => string;
  private readonly xf: StorageBuffer;
  private readonly xfData = new Float32Array(PARTS * 16);
  private readonly marbles: StorageBuffer;
  private readonly mData = new Float32Array(MAX_MARBLES * 12);
  private readonly chunks: StorageBuffer;
  private readonly cData = new Float32Array(MAX_CHUNKS * 8);
  private readonly segs: StorageBuffer;
  private readonly sData = new Float32Array(MAX_SEGS * 8);
  private svb: StorageBuffer | null = null;
  private sib: StorageBuffer | null = null;
  private sn = 0;
  private dvb: StorageBuffer;
  private dib: StorageBuffer;
  private dn = 0;
  private tex: Record<string, Texture> = {};
  private readonly blank: Texture;
  /** the parts' bind poses are the identity: their transforms are their frames */
  private poses: [KeeperPose, KeeperPose] | null = null;

  constructor(private kit: Kit, readonly R: CosmosRenderer, private ladder: Ladder, o: BeyondOptions) {
    this.hi = o.hi;
    this.url = typeof o.assets === 'string' ? ((f) => (o.assets as string) + f) : o.assets;
    this.C = new Choreography(120);
    this.lv = R.level('beyond', ladder.cosmos, [99, 98, logSOf(ORB_R * 3.2), 26.97]);
    const k = kit, scale = o.scale;
    this.V = k.uniforms(beyondShader.structs.BV, 'beyond.view');
    this.xf = k.storage({ label: 'beyond.xf', data: this.xfData, usage: ['storage', 'copy-dst'] });
    this.marbles = k.storage({ label: 'beyond.marbles', data: this.mData, usage: ['storage', 'copy-dst'] });
    this.chunks = k.storage({ label: 'beyond.chunks', data: this.cData, usage: ['storage', 'copy-dst'] });
    this.segs = k.storage({ label: 'beyond.segs', data: this.sData, usage: ['storage', 'copy-dst'] });
    this.dvb = k.storage({ label: 'beyond.dvb', size: 60000 * VBYTES, usage: ['vertex', 'copy-dst'] });
    this.dib = k.storage({ label: 'beyond.dib', size: 360000 * 4, usage: ['index', 'copy-dst'] });
    this.blank = k.texture({ label: 'beyond.blank', format: 'rgba8unorm', size: [1, 1], usage: ['sample', 'copy-dst'] });
    this.blank.write(new Uint8Array([0, 0, 0, 255]));
    // (the pictures wait in the blank's place until they're in)
    const T = (name: string) => new Ref(() => this.tex[name] ?? this.blank, `beyond.${name}`);

    // the keepers: light, and the inverse of their distance (both resolved from 4 samples; the depth kept to itself)
    const size = 'render' as const;
    const ms = (label: string, format: GPUTextureFormat) => k.texture({ label, format, size, scale, samples: 4 });
    const keepCol = k.texture({ label: 'beyond.keep', format: 'rgba16float', size, scale });
    const keepDist = k.texture({ label: 'beyond.keep.dist', format: 'rgba16float', size, scale });
    const keepers = k.pass({
      label: 'beyond.keepers',
      color: [
        { target: ms('beyond.keep.ms', 'rgba16float'), resolve: keepCol, clear: [0, 0, 0, 0], store: false },
        { target: ms('beyond.keep.dist.ms', 'rgba16float'), resolve: keepDist, clear: [0, 0, 0, 0], store: false },
      ],
      depth: { target: ms('beyond.keep.depth', 'depth32float'), clear: 0, store: false },
      enabled: () => this.on,
    });
    const bindK = { V: this.V, xf: this.xf, irisTex: T('iris'), robeTex: T('robe'), skyTex: T('sky') };
    keepers.draw(keepersShader, {
      label: 'beyond.keepers.static', vertex: 'vs', fragment: 'fs', cull: 'none', bind: bindK as never, alphaToCoverage: true, depthCompare: 'greater',
      vertexBuffers: [{ layout: LAYOUT, buffer: new Ref(() => this.svb) }], indices: { buffer: new Ref(() => this.sib), format: 'uint32' },
      count: () => this.sn, enabled: () => this.ready && this.sn > 0,
    });
    keepers.draw(keepersShader, {
      label: 'beyond.keepers.limbs', vertex: 'vs', fragment: 'fs', cull: 'none', bind: bindK as never, alphaToCoverage: true, depthCompare: 'greater',
      vertexBuffers: [{ layout: LAYOUT, buffer: this.dvb }], indices: { buffer: this.dib, format: 'uint32' },
      count: () => this.dn, enabled: () => this.ready && this.dn > 0,
    });
    // the rest, over them
    this.out = k.texture({ label: 'beyond.out', format: 'rgba16float', size, scale });
    const world = k.pass({ label: 'beyond', color: [{ target: this.out, clear: [0, 0, 0, 0] }], enabled: () => this.on });
    world.fullscreen(beyondShader, {
      label: 'beyond', fragment: 'fs', constants: { HI: o.hi ? 1 : 0 },
      bind: {
        V: this.V, keepCol, keepDist, uniTex: R.hdr, skyTex: T('sky'), wispTex: T('wisps'), galTex: T('galaxy'),
        marbles: this.marbles, chunks: this.chunks, segs: this.segs,
      } as never,
    });
    // laid into the cosmos's frame (from its own camera only)
    const lay = k.pass({ label: 'beyond.lay', color: [{ target: R.hdr, clear: false }], enabled: () => this.on && !this.view });
    lay.fullscreen(volShader, { label: 'beyond.lay', fragment: 'fs', blend: 'premultiplied', bind: { volTex: this.out } });
    R.after.push(keepers, world, lay);
    // (their world graded for itself as it comes in)
    R.grade = (f) => (this.on && !this.view ? mixFilm(f, BEYOND_FILM, this.lv.weight) : f);
  }

  /** the pictures and the shapes (once, when the zoom first comes near: the meshes take a moment to make) */
  load() {
    if (this.loading) return;
    this.loading = true;
    const files: [string, string, number][] = [['sky', 'sky.jpg', 6], ['wisps', 'wisps.jpg', 1], ['galaxy', 'galaxy.jpg', 1], ['iris', 'iris.jpg', 4], ['robe', 'robe.jpg', 6]];
    for (const [name, file, mips] of files) {
      void image(this.kit, this.url(file), `beyond.${name}`, mips).then((t) => { this.tex[name] = t; }, (e) => console.warn(`beyond: ${file}`, e));
    }
    // (the shapes made in a worker, so the page goes on drawing: on the page, even a part a task, a phone's frames stalled
    // for half a second at a time as the zoom set out; made here if no worker will)
    const t0 = performance.now();
    const take = (s: Shapes) => {
      if (this.ready) return;
      this.svb = this.kit.storage({ label: 'beyond.svb', data: s.vb, usage: ['vertex', 'copy-dst'] });
      this.sib = this.kit.storage({ label: 'beyond.sib', data: s.ib, usage: ['index', 'copy-dst'] });
      this.sn = s.ib.length;
      this.ready = true;
      console.log(`beyond: keepers made (${s.vb.length / 9} vertices, ${s.ib.length / 3} triangles) by ${Math.round(performance.now() - t0)} ms`);
    };
    try {
      const w = new Worker(new URL('./keepers.worker.ts', import.meta.url), { type: 'module', name: 'keepers' });
      w.onmessage = (e: MessageEvent<Shapes>) => { w.terminate(); take(e.data); };
      w.onerror = () => { w.terminate(); take(keeperShapes(this.hi)); };
      w.postMessage(this.hi);
    } catch { setTimeout(() => take(keeperShapes(this.hi)), 30); }
  }

  /** the cosmos's own camera's view of their world this frame (cm) */
  private cosmosView(): BeyondView {
    const lv = this.lv, k = CM_PER_MPC;
    const eye: V3 = [(lv.eye[0] + lv.origin[0]) * k, (lv.eye[1] + lv.origin[1]) * k, (lv.eye[2] + lv.origin[2]) * k];
    const kit = this.kit, [W, H] = this.R.size();
    const tanHalf = Math.tan(kit.camera.fovY / 2);
    return { eye, fwd: [...lv.fwd] as V3, right: [...lv.right] as V3, up: [...lv.up] as V3, tanHalf, aspect: W / Math.max(1, H), pxAngle: (2 * tanHalf) / H };
  }

  /** this frame: shown while the zoom's past the edge of the universe (or `view` given: the cell's jewel) */
  update(logS: number, dt: number) {
    // (asked for a few seconds after the zoom first nears the edge — the page opens there, and these wait for it to
    // settle — or at once when it's past it, or for the jewel)
    if (this.view || logS > 27.05) this.load();
    else if (logS > 26.4 && !this.soon) this.soon = setTimeout(() => this.load(), 4000);
    if (!this.view) this.universe = true;
    this.on = this.ready && (this.lv.weight > 0.002 || !!this.view);
    if (!this.on) return;
    this.time = this.clock ?? this.time + dt;
    const v = this.view ?? this.cosmosView();
    this.pose(this.time);
    const C = WORLD_C, R = WORLD_R;
    const outside = len(sub(v.eye, C)) > R;
    // the light of our universe, and of theirs: what the CMB's mottle comes to, and a rose and teal
    this.V.set({
      eye: v.eye, tanHalf: v.tanHalf, fwd: v.fwd, aspect: v.aspect, right: v.right, pxAngle: v.pxAngle, up: v.up, time: this.time % 4096,
      world: [...C, R], orb: [0, 0, 0, ORB_R], orbLight: [1.0, 0.84, 1.1, 42], orbB: [...ORB_B, ORB_B_R], orbBLight: [1.15, 0.55, 1.05, 36],
      key: [...norm([-0.45, 0.62, 0.65]), 1], keyColor: [0.42, 0.36, 0.62, 1], rim: [...norm([0.35, 0.35, -1]), 1], rimColor: [0.2, 0.62, 0.7, 1],
      skyTop: [0.03, 0.026, 0.065, 0.16], skyLow: [0.03, 0.014, 0.035, 1],
      view: [1 / Math.max(1, this.out.width), 1 / Math.max(1, this.out.height), outside ? 1 : 0, this.view ? 1 : this.lv.weight],
      counts: [this.nMarbles, this.nChunks, 0, 0], cloud: [-1e6, 30, this.universe ? 1 : 0, 0], outside: [0, 0, 0, 0],
    });
  }

  private nMarbles = 0;
  private nChunks = 0;

  /** every keeper, marble and thread where they are at time t */
  private pose(t: number) {
    const C = this.C;
    const orb: V3 = [0, 0, 0];
    const A = poseA(t, C, orb), B = poseB(t, C);
    this.poses = [A, B];
    // the rigid parts' frames: origin, x, y, z (a mat4 each, columns)
    const put = (i: number, f: Frame3, s: V3 = [1, 1, 1]) => {
      this.xfData.set([...f.o, 1, ...mul(f.x, s[0]), 0, ...mul(f.y, s[1]), 0, ...mul(f.z, s[2]), 0], i * 16);
    };
    const H: V3 = [HAND, HAND, HAND];
    put(0, A.head); put(1, A.chest, A.build); put(2, A.hands[0].palm, H); put(3, A.hands[1].palm, H);
    put(4, B.head); put(5, B.chest, B.build); put(6, B.hands[0].palm, H); put(7, B.hands[1].palm, H);
    this.xf.write(this.xfData);
    // the limbs
    const m = new MeshData();
    limbs(m, A, this.hi);
    limbs(m, B, this.hi);
    const vb = packed(m);
    this.dvb.ensure(vb.byteLength);
    this.dvb.write(vb);
    const ib = new Uint32Array(m.i);
    this.dib.ensure(ib.byteLength);
    this.dib.write(ib);
    this.dn = m.i.length;
    this.marblesAndThreads(t, A, B);
  }

  private marblesAndThreads(t: number, A: KeeperPose, B: KeeperPose) {
    const C = this.C, M = this.mData, S = this.sData, CH = this.cData;
    let nm = 0, ns = 0, nc = 0;
    const marble = (p: V3, r: number, axis: V3, spin: number, hue: V3, kind: number) => {
      if (nm >= MAX_MARBLES) return;
      M.set([...p, r, ...axis, spin, ...hue, kind], nm * 12);
      nm++;
    };
    let chunkStart = 0;
    const seg = (a: V3, b: V3, I: number, w: number) => {
      if (ns >= MAX_SEGS) return;
      S.set([...a, I, ...b, w], ns * 8);
      ns++;
    };
    // (a chunk: the segments since the last, and the sphere round them)
    const chunk = (hue: number) => {
      if (ns === chunkStart || nc >= MAX_CHUNKS) { chunkStart = ns; return; }
      let lo: V3 = [1e9, 1e9, 1e9], hi: V3 = [-1e9, -1e9, -1e9], wmax = 0, imax = 0;
      for (let s = chunkStart; s < ns; s++) for (const o of [0, 4]) {
        for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], S[s * 8 + o + i]); hi[i] = Math.max(hi[i], S[s * 8 + o + i]); }
        if (o === 4) wmax = Math.max(wmax, S[s * 8 + 7]); else imax = Math.max(imax, S[s * 8 + 3]);
      }
      const c = lerp(lo, hi, 0.5);
      // (the glow reaches about as far as it's bright: a little past the segments)
      const r = len(sub(hi, c)) + wmax * Math.sqrt(Math.max(1, imax) * 400) + 1.5;
      CH.set([...c, r, chunkStart, ns - chunkStart, hue, 0], nc * 8);
      nc++;
      chunkStart = ns;
    };

    // the thread of universes, wound with them as DNA is with its spools: round ours first, its first spool; up between
    // the first keeper's raised fingers (which spin it), over, and down to the second keeper's marble
    const tipsA = tips(A), tipsB = tips(B);
    const hand = lerp(tipsA[4], tipsA[5], 0.5);
    const ctrl: V3[] = [[0, ORB_R + 0.5, 0], [-6, 13, -11], hand, add(hand, [8, 12, -6]), [8, 50, -36], [21, 46, -35], [27, 31, -27], add(ORB_B, [0, ORB_B_R + 2, 0])];
    const curve = (u: number): V3 => {
      const n = ctrl.length - 1, f = Math.min(n - 1e-6, u * n), s = Math.floor(f), w = f - s;
      const p0 = ctrl[Math.max(0, s - 1)], p1 = ctrl[s], p2 = ctrl[s + 1], p3 = ctrl[Math.min(n, s + 2)];
      const c = (i: number) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * w + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * w * w + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * w * w * w);
      return [c(0), c(1), c(2)];
    };
    // (light running along it from ours to the second keeper's, in pulses)
    const ph = C.a(t, 3.6) / (2 * Math.PI);
    const pulse = (u: number) => 1 + 3.2 * Math.pow(Math.max(0, Math.cos(2 * Math.PI * (u * 1.5 - ph))), 24);
    const steps = this.hi ? 26 : 14;
    // ours its first spool: 1.65 turns round it, the coil's axis across the thread, out over its top
    {
      const W = norm([0.3, 0.25, 1]), Uax = norm(cross(W, [0, 1, 0])), Vax = cross(W, Uax);
      const R = ORB_R + 0.35, n = steps + 8;
      let last: V3 | null = null;
      for (let k = 0; k <= n; k++) {
        const a = Math.PI * 0.5 - (k / n) * 1.65 * 2 * Math.PI;
        const q = add(add(mul(Uax, Math.cos(a) * R), mul(Vax, Math.sin(a) * R)), mul(W, (k / n - 0.5) * ORB_R * 0.8));
        if (last) seg(last, q, 0.8 * pulse(-0.15 + (k / n) * 0.15), 0.03);
        last = q;
      }
      seg(last!, ctrl[0], 0.8, 0.03);
      chunk(0);
    }
    // up to the hand, a plain linker
    const uHand = 2 / (ctrl.length - 1);
    let prev: V3 = ctrl[0];
    for (let k = 1; k <= 14; k++) { const q = curve((k / 14) * uHand); seg(prev, q, 1.6 * pulse((k / 14) * uHand), 0.05); prev = q; }
    chunk(0);
    // and past it the others, strung along to the second keeper's (flowing toward it, swelling in, shrinking out)
    const turns = C.a(t, 30) / (2 * Math.PI), flow = turns % 1, cyc = Math.floor(turns);
    const beads = 8;
    const hues: V3[] = [[1.0, 0.55, 0.25], [0.35, 0.8, 1.0], [0.95, 0.35, 0.8], [0.5, 1.0, 0.6], [1.0, 0.85, 0.4], [0.6, 0.45, 1.0], [1.0, 0.45, 0.4], [0.4, 0.95, 0.9]];
    for (let b = 0; b <= beads; b++) {
      const f = (b + flow) / (beads + 1), u = uHand + (1 - uHand) * f;
      const pos = curve(u);
      const size = Math.sin(Math.PI * Math.min(1, Math.max(0, f)));
      const r = (1.1 + 0.6 * ((b * 7) % 3) / 2) * Math.min(1, size * 2.2);
      const T = norm(sub(curve(Math.min(1, u + 0.01)), curve(Math.max(0, u - 0.01))));
      const enter = madd(pos, T, -(r + 0.35));
      // (the linker from the last to this one)
      const u0 = uHand + (1 - uHand) * (b - 1 + flow) / (beads + 1);
      for (let k = 1; k <= 4; k++) seg(lerp(prev, enter, (k - 1) / 4), lerp(prev, enter, k / 4), 1.6 * pulse(u0 + (u - u0) * k / 4), 0.05);
      if (r > 0.15) {
        const id = (((b - cyc) % hues.length) + hues.length) % hues.length;
        const axisM = norm(cross(T, [0.3, 1, 0.2]));
        marble(pos, r, norm(add(axisM, mul(T, 0.4))), C.a(t, 12, b) * 0.5, hues[id], (b % 3 === 1 ? 1 : 0) + 0.6);
        // wound 1.65 times round it (a nucleosome's turns), the coil's axis across the thread
        const W = axisM, Uax = norm(cross(W, T)), Vax = cross(W, Uax);
        let last = enter;
        for (let k = 0; k <= steps; k++) {
          const a = (k / steps) * 1.65 * 2 * Math.PI;
          const q = add(add(madd(pos, Uax, Math.cos(a) * (r + 0.3)), mul(Vax, Math.sin(a) * (r + 0.3))), mul(W, (k / steps - 0.5) * r * 0.9));
          if (k > 0) seg(last, q, 2.2 * pulse(u + (k / steps) * 0.02), 0.045);
          last = q;
        }
        prev = last;
      } else prev = enter;
      chunk(0);
    }
    for (let k = 1; k <= 4; k++) seg(lerp(prev, curve(1), (k - 1) / 4), lerp(prev, curve(1), k / 4), 1.6, 0.05);
    chunk(0);
    // other universes adrift in their sky, near and far: marbles at their own depths, slowly going round (how many there
    // are, and how far it goes)
    for (let i = 0; i < (this.hi ? 20 : 10); i++) {
      const h = (x: number) => { const v = Math.sin(i * 12.9898 + x * 78.233) * 43758.5453; return v - Math.floor(v); };
      const rad = 70 + h(1) * 130, el = (h(2) - 0.45) * 1.3, a0 = h(3) * Math.PI * 2;
      const a = a0 + C.a(t, 60 + h(4) * 60) * (h(5) > 0.5 ? 1 : -1) * 0.25;
      const p: V3 = [WORLD_C[0] + Math.cos(a) * Math.cos(el) * rad, WORLD_C[1] + Math.sin(el) * rad * 0.7, WORLD_C[2] + Math.sin(a) * Math.cos(el) * rad];
      // (none in front of them as the wide shot sees them: from +z and a little right)
      if (dot(norm(sub(p, WORLD_C)), norm([0.29, 0.1, 0.95])) > 0.72) continue;
      marble(p, 1.6 + h(6) * 5.5, norm([h(7) - 0.5, 1, h(8) - 0.5]), C.a(t, 20 + h(9) * 20, i), hues[i % hues.length], (h(10) > 0.6 ? 1 : 0) + 0.3 + h(11) * 0.6);
    }

    // the threads that hold ours up: from each fingertip under it, a short arc up to the glass
    for (let f = 0; f < 4; f++) {
      const tip = tipsA[f];
      const to = madd([0, 0, 0], norm(sub(tip, [0, 0, 0])), ORB_R + 0.1);
      // (a curl about the straight line, a pulse going up it)
      const ax = norm(sub(to, tip)), side = norm(cross(ax, [0, 1, 0.2]));
      const n = 7;
      let last = tip;
      for (let s = 1; s <= n; s++) {
        const u = s / n;
        const q = add(lerp(tip, to, u), mul(turn(side, ax, u * 5 + C.a(t, 3.1, f)), Math.sin(u * Math.PI) * 0.35));
        const pulse = 0.35 + 0.9 * Math.pow(Math.max(0, Math.sin((u - C.a(t, 1.7, f * 2.1) / (2 * Math.PI)) * 2 * Math.PI)), 6);
        seg(last, q, pulse, 0.012);
        last = q;
      }
    }
    // and a mote at each fingertip of both, a little brighter where they work
    for (const p of [...tipsA, ...tipsB]) seg(p, p, 1.6, 0.04);
    chunk(1);
    // motes round ours: its field, slowly turning
    for (let i = 0; i < (this.hi ? 36 : 18); i++) {
      const a = C.a(t, 7 + (i % 5) * 1.5, i * 2.39), inc = (i * 0.618) % 1 * Math.PI - Math.PI / 2, rr = 4.8 + (i % 7) * 0.45;
      const p: V3 = [Math.cos(a) * Math.cos(inc) * rr, Math.sin(inc) * rr * 0.6 + Math.sin(a * 2) * 0.4, Math.sin(a) * Math.cos(inc) * rr];
      seg(p, p, 0.9 + 0.6 * Math.max(0, C.w(t, 1.9, i)), 0.03);
    }
    chunk(1);

    // the second keeper's marble, turning between its hands, and its electrons going round it on their tilted orbits
    const spinB = C.a(t, 9) * 0.5;
    marble(ORB_B, ORB_B_R, norm([0.25, 1, 0.15]), spinB, [0.9, 0.35, 1.0], 2.15);
    for (let e = 0; e < 5; e++) {
      const axis = norm(turn([0, 1, 0], norm([Math.cos(e * 1.3), 0, Math.sin(e * 1.3)]), 0.5 + e * 0.32));
      const u = norm(cross(axis, [0.3, 0.1, 1])), w = cross(axis, u);
      const rr = ORB_B_R + 3.2 + e * 1.15;
      const a = C.a(t, 3.2 + e * 0.9, e * 1.7);
      const p = add(ORB_B, add(mul(u, Math.cos(a) * rr), mul(w, Math.sin(a) * rr)));
      marble(p, 0.55 + 0.12 * (e % 3), axis, a * 2, hues[(e + 3) % hues.length], 1.4);
      // (its orbit, a faint ring)
      const n = this.hi ? 40 : 20;
      let q0 = add(ORB_B, mul(u, rr));
      for (let k = 1; k <= n; k++) {
        const b = (k / n) * Math.PI * 2;
        const q = add(ORB_B, add(mul(u, Math.cos(b) * rr), mul(w, Math.sin(b) * rr)));
        seg(q0, q, 0.18, 0.02);
        q0 = q;
      }
      chunk(2);
    }
    // and the threads from its fingertips to its marble
    for (const tip of tipsB) {
      const to = madd(ORB_B, norm(sub(tip, ORB_B)), ORB_B_R + 0.2);
      seg(tip, to, 1.3, 0.03);
    }
    chunk(2);
    this.nMarbles = nm; this.nChunks = nc;
    this.marbles.write(M.subarray(0, Math.max(1, nm) * 12));
    this.chunks.write(CH.subarray(0, Math.max(1, nc) * 8));
    this.segs.write(S.subarray(0, Math.max(1, ns) * 8));
  }

  /** the keepers' poses this frame (for whoever wants their hands) */
  get keepers() { return this.poses; }
}

export { WORLD_C, WORLD_R, ORB_R, ORB_B };
