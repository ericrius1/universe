// The bent water's simulation (fluid_sim.wgsl), ported from the waterbending app's Fluid: MLS-MPM on a grid that
// follows the action. The bending brain drives it through the app's API: `req` (one-shot requests: spawn, release /
// hurl / push, freeze / melt / shatter), `path` and `pathMode` (the form it holds the water in), `groups` (carried
// ice), `splash()` (free water thrown up), `carry` (her motion in flight), `setCenter()` (where the grid goes); and it
// reads `stats` a few frames late (held and free counts, the held water's middle and speed, what fell into the water).
// This world adds `waters` (the levels of the water round her, which the brain finds from the sources) and `landings`
// (what came down into the water this frame, on the GPU, for the lakes' ripples).
// Each frame `update(dt)` turns the requests into the uniform and picks the work; `passes()` is that work. With nothing
// alive and nothing asked of it, it does none; with nothing but static ice left, none until something is asked.
import type { Kit, Compute, RunEntry, StorageBuffer, UniformBuffer, V3, Quat } from '@ericrius1/weft';
import shader, { type SimU } from './fluid_sim.wgsl';

/** how much bent water a device can afford: a phone's (an Apple GPU's) is the app's mobile one */
export interface FluidProfile {
  readonly name: 'phone' | 'desktop';
  /** particle slots: the most water there can be at once */
  readonly slots: number;
  /** the grid (cells of 0.1 m) and its substeps a frame — every substep sweeps every cell */
  readonly dims: [number, number, number];
  readonly substeps: number;
  /** spray particle slots */
  readonly spray: number;
  /** the screen-space water's depth at this fraction of the render's resolution (its thickness is at half) */
  readonly depthScale: number;
}

const PHONE: FluidProfile = { name: 'phone', slots: 16384, dims: [80, 48, 80], substeps: 2, spray: 16384, depthScale: 0.5 };
const DESKTOP: FluidProfile = { name: 'desktop', slots: 65536, dims: [112, 64, 112], substeps: 3, spray: 65536, depthScale: 1 };

/** the profile: the desktop's (an M-series Mac's too), ?fluid=phone the lighter one; ?fluidmax=N more (or fewer)
 *  slots */
export function fluidProfile(): FluidProfile {
  const q = new URLSearchParams(location.search);
  const base = q.get('fluid') === 'phone' ? PHONE : DESKTOP;
  const max = Number(q.get('fluidmax'));
  return max > 0 ? { ...base, slots: Math.max(8192, Math.min(262144, Math.round(max / 64) * 64)) } : base;
}

export const PARTICLE_BYTES = 80;
/** (the octopus sends 8 arms x 7 points; the forms she builds in flight, 20 strands x 18) */
export const MAX_PATH = 512;
export const MAX_GROUPS = 8;
/** what landed in the water this frame: at most this many cells of it */
export const MAX_LANDINGS = 256;
const MAX_EMIT = 8;
const MAX_WATERS = 4;
const MAX_TARGETS = 16;

export interface PathPoint { p: V3; r: number; v: V3; flow: number }
export interface IceGroup { active: 0 | 1 | 2; pos: V3; rot: Quat; vel: V3; angVel: V3; radius: number; age: number }
/** free water thrown out of the surface: a disc of particles at pos, velocity vel (+ radial outward speed, + jitter) */
export interface Splash { pos: V3; radius: number; vel: V3; count: number; jitter?: number; radial?: number; seg?: [number, number] }
/** a body of water the bent water falls back into: its level, over a box (x0, z0, x1, z1; none: everywhere). A point is
 *  in it where the ground is under the level */
export interface WaterLevel { level: number; box?: [number, number, number, number] }

export interface FluidStats {
  alive: number; held: number; ice: number; free: number;
  /** of the ice, how much is static (set down, not carried) */
  staticIce: number;
  /** what fell into the water since the last readback (~3 frames): how many particles, the sum of their impact speeds
   *  (m/s), and their middle */
  absorbed: number; splash: number; absorbedAt: V3;
  heldCentroid: V3; heldSpeed: number;
  /** water through each of `targets` */
  hits: number[];
}

interface Readback { buf: GPUBuffer; busy: boolean }

const ZERO4 = [0, 0, 0, 0];

export class Fluid {
  readonly profile: FluidProfile;
  /** particle slots */
  readonly nMax: number;
  readonly particles: StorageBuffer;
  /** what landed in the water this frame, for the lakes' ripples: cleared at the start of each frame the sim runs, so
   *  read it before the next. A u32 count at byte 0 (then 12 bytes of padding), then from byte 16 up to 256 vec4f
   *  (x, z, amount, radius): one landing per 0.5 m cell the water came down in — where (world x, z: its drops' middle),
   *  their summed dent (m, negative: -0.002 · (0.6 + 0.4 · impact speed) a drop, the app's) and a radius (0.2..0.8 m,
   *  wider the more fell there). In WGSL:
   *    struct Landings { n: atomic<u32>, p0: u32, p1: u32, p2: u32, at: array<vec4f, 256> }
   *  `running` says whether it's being written (when it isn't, its count was left at 0). */
  readonly landings: StorageBuffer;
  private u: UniformBuffer<SimU>;
  private mom: StorageBuffer;
  private mass: StorageBuffer;
  private gridV: StorageBuffer;
  private solid: StorageBuffer;
  private freeList: StorageBuffer;
  private counters: StorageBuffer;
  private readbacks: Readback[] = [];
  private items: Record<string, Compute>;
  private statsCopy: RunEntry;
  private list: RunEntry[] = [];
  /** the grid's cells (its buffers are sized for them) and their size (m) */
  readonly dims: [number, number, number];
  h = 0.1;
  substeps: number;
  origin: V3 = [0, 0, 0];
  stats: FluidStats = { alive: 0, held: 0, ice: 0, free: 0, staticIce: 0, absorbed: 0, splash: 0, absorbedAt: [0, 0, 0], heldCentroid: [0, 0, 0], heldSpeed: 0, hits: [] };
  /** things thrown water can hit, up to 16: hit counts come back in stats.hits */
  targets: { pos: V3; r: number }[] = [];
  params = { stiffness: 3, restDensity: 4, viscosity: 0.08, cohesion: 0.35, pull: 9, antiGravity: 0.97, maxSpeed: 22 };
  path: PathPoint[] = [];
  /** 0 nearest point (orb), 1 spread along the path, 2 eight equal strands, 3 a sheet, 4 many strands (the forms of
   *  many lines), 5 a ball held full and round (a qi ball between her palms: fluid_sim.wgsl pathAt) */
  pathMode = 1;
  /** the points a strand of the path has (pathMode 4: the forms of many lines — the water spread evenly over the
   *  strands, the jumps from one to the next no water; the light runs along them) */
  strandLen = 18;
  /** (pathMode 4) how hard the lines are held (0..1: the geometry she builds in flight hardest, the vortex loosest) and
   *  how much of the form is the vortex (its light runs up its arms) */
  tight = 0;
  vortex = 0;
  /** how fast the mist and snow she holds become water (1: as she carries them — fluid_sim.wgsl) */
  merge = 1;
  groups: IceGroup[] = [];
  /** the water round her (up to four bodies): what falls below one of these levels is taken back */
  waters: WaterLevel[] = [];
  /** the bender's displacement this frame while she carries water in flight (the held water rides along) */
  carry: V3 = [0, 0, 0];
  // one-shot requests (consumed by the next update)
  req = {
    spawn: null as null | { pos: V3; radius: number; vel: V3; count: number; mist?: number; snow?: number },
    melt: null as null | { pos: V3; r: number }, freeze: null as null | { pos: V3; r: number },
    shatter: null as null | { pos: V3; r: number; strength: number }, freezeHeld: -2, release: false, meltAll: false,
    push: null as null | { v: V3 },
    /** with release: each particle hurled on its own arc to a point within `r` of `at`, landing `T` (+ up to `dT`) s later
     *  — or, poured, only those whose turn has come (`frac` of all she holds, each in its own order) */
    hurl: null as null | { at: V3; T: number; r: number; dT: number; frac?: number; from?: V3; fromR?: number },
  };
  enabled = true;
  onStats?: (s: FluidStats) => void;
  private splashes: Splash[] = [];
  private needInit = true;
  private frame = 0;
  private time = 0;
  private awake = -1;
  private lastAsked = -1e9;
  private live = false;
  private stepping = false;
  /** the landings hold this frame's (cleared once the sim stops) */
  private landed = false;
  private spawnN = 0;
  private emitN = 0;
  private statsRb: Readback | null = null;
  /** where the stats' sums are taken from: the grid's origin when they were last cleared (this world is kilometres
   *  across: sums of absolute positions overflowed) */
  private anchor: V3 = [0, 0, 0];
  private nextAnchor: V3 | null = null;
  private pathBuf = new Float32Array(MAX_PATH * 4);
  private pathVelBuf = new Float32Array(MAX_PATH * 4);
  private groupBuf = new Float32Array(MAX_GROUPS * 16);
  private waterBuf = new Float32Array(MAX_WATERS * 8);
  private targetBuf = new Float32Array(MAX_TARGETS * 4);
  private emitBuf = new Float32Array(MAX_EMIT * 12);

  /** `spray`: the spray's event buffers, which the sim appends splash events to */
  constructor(readonly kit: Kit, profile: FluidProfile, spray: { events: StorageBuffer; ring: StorageBuffer }) {
    this.profile = profile;
    this.nMax = profile.slots;
    this.dims = [...profile.dims];
    this.substeps = profile.substeps;
    const cells = this.dims[0] * this.dims[1] * this.dims[2];
    this.particles = kit.storage({ label: 'fluid.particles', size: this.nMax * PARTICLE_BYTES });
    this.mom = kit.storage({ label: 'fluid.mom', size: cells * 12 });
    this.mass = kit.storage({ label: 'fluid.mass', size: cells * 4 });
    this.solid = kit.storage({ label: 'fluid.solid', size: cells * 4 });
    this.gridV = kit.storage({ label: 'fluid.gridV', size: cells * 16 });
    this.freeList = kit.storage({ label: 'fluid.freeList', size: this.nMax * 4 });
    // (32 counters, then the landing table: 256 cells x key, count, x, z, amount)
    this.counters = kit.storage({ label: 'fluid.counters', size: (32 + MAX_LANDINGS * 5) * 4 });
    this.landings = kit.storage({ label: 'fluid.landings', size: 16 + MAX_LANDINGS * 16 });
    this.u = kit.uniforms(shader.structs.SimU, 'fluid');
    for (let k = 0; k < 3; k++) this.readbacks.push({ buf: kit.device.createBuffer({ label: 'fluid.stats', size: 128, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), busy: false });
    for (let g = 0; g < MAX_GROUPS; g++) this.groups.push({ active: 0, pos: [0, 0, 0], rot: [0, 0, 0, 1], vel: [0, 0, 0], angVel: [0, 0, 0], radius: 1, age: 0 });
    const bind = {
      U: this.u, P: this.particles, mom: this.mom, mass: this.mass, gridV: this.gridV, solid: this.solid, freeList: this.freeList,
      counters: this.counters, sprayEvents: spray.events, sprayRing: spray.ring, landings: this.landings,
    };
    const all = () => [this.nMax];
    const c = (entry: string, o: { threads?: () => number[]; workgroups?: number[] }) => kit.compute(shader, { label: `fluid.${entry}`, entry, bind, ...o });
    this.items = {
      initFree: c('initFree', { threads: all }),
      landClear: c('landClear', { workgroups: [1] }),
      spawn: c('spawn', { threads: () => [this.spawnN] }),
      emitSplash: c('emitSplash', { threads: () => [this.emitN] }),
      p2g1: c('p2g1', { threads: all }),
      p2g2: c('p2g2', { threads: all }),
      gridUpdate: c('gridUpdate', { threads: () => [this.dims[0] * this.dims[1] * this.dims[2]] }),
      g2p: c('g2p', { threads: all }),
      landCompact: c('landCompact', { threads: () => [MAX_LANDINGS] }),
      stats: c('stats', { threads: all }),
      resetStats: c('resetStats', { workgroups: [1] }),
    };
    this.statsCopy = kit.raw((enc) => {
      const rb = this.statsRb;
      if (!rb) return;
      enc.copyBufferToBuffer(this.counters.gpu, 0, rb.buf, 0, 128);
      rb.busy = true;
      const anchor: V3 = [...this.anchor];
      // (mapped once the frame's commands are submitted: kit.run submits right after encoding)
      queueMicrotask(() => {
        rb.buf.mapAsync(GPUMapMode.READ).then(() => {
          const c = new Int32Array(rb.buf.getMappedRange().slice(0));
          rb.buf.unmap();
          rb.busy = false;
          this.readStats(c, anchor);
        }).catch(() => { rb.busy = false; });
      });
    }, 'fluid.statsCopy');
  }

  /** throw free water out of the surface this frame (up to 8 emitters a frame; counts are capped by the free list) */
  splash(e: Splash) { if (this.splashes.length < MAX_EMIT && e.count >= 1) this.splashes.push({ ...e, count: Math.round(e.count) }); }

  /** choose the grid placement: centred on the action, snapped to cells (below: the share of the grid's height under c
   *  — on the ground most of the action is above the water it comes out of; in the air, all round) */
  setCenter(c: V3, below = 0.35) {
    const [dx, dy, dz] = this.dims;
    const h = this.h;
    this.origin = [Math.round(c[0] / h - dx / 2) * h, Math.round(c[1] / h - dy * below) * h, Math.round(c[2] / h - dz / 2) * h];
  }

  /** the grid on the action, every frame (the app's own placement, kept by its app rather than its bending): on the
   *  form being held — arms all round her, a wave in front, a stream out to the aim — kept within reach of her; in
   *  flight on the form she carries, up and down as well; a gathered orb all on it. `her` her feet, `target` where her
   *  water is (Bending.pose.target), `airborne` she flies holding water, `orb` an orb gathered out of her reach (or null) */
  follow(her: V3, target: V3, airborne: boolean, orb: V3 | null = null) {
    let f: V3 = [her[0] + (target[0] - her[0]) * 0.4, her[1] + (target[1] - her[1]) * 0.4, her[2] + (target[2] - her[2]) * 0.4];
    if (this.path.length > 1) {
      const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (const q of this.path) for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], q.p[j]); hi[j] = Math.max(hi[j], q.p[j]); }
      // (a wave rises a few metres out: the grid goes with it)
      const reach = this.pathMode > 2.5 ? 7 : 4;
      const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
      f = [Math.min(Math.max(c[0], her[0] - reach), her[0] + reach), c[1], Math.min(Math.max(c[2], her[2] - reach), her[2] + reach)];
    }
    if (orb) this.setCenter(orb, 0.5);
    else this.setCenter([f[0], airborne ? Math.min(Math.max(f[1], her[1] - 2.5), her[1] + 2.5) : her[1], f[2]], airborne ? 0.5 : 0.35);
  }

  /** start over: every particle gone, every ice group dissolved */
  reset() {
    this.needInit = true;
    for (const g of this.groups) g.active = 0;
  }

  /** there's water to draw this frame */
  get active() { return this.live; }
  /** the sim steps this frame (not idle, not just static ice): splash events and landings are being made */
  get running() { return this.stepping; }

  /** (tests) the live particles: [x, y, z, phase, held, index] each */
  async dump() {
    const f = new Float32Array(await this.particles.read());
    const out: number[][] = [];
    for (let i = 0; i < this.nMax; i++) {
      const o = i * (PARTICLE_BYTES / 4);
      if (f[o + 3] < 0.5) continue;
      out.push([f[o], f[o + 1], f[o + 2], f[o + 3], f[o + 15], i]);
    }
    return out;
  }

  /** every frame, after the bending brain's (its requests are consumed here) */
  update(frameDt: number) {
    this.frame++;
    this.time = (this.time + frameDt) % 1000;
    const list = this.list;
    list.length = 0;
    const req = this.req;
    if (this.enabled) {
      this.spawnN = req.spawn && req.spawn.count > 0 ? Math.min(Math.round(req.spawn.count), this.nMax) : 0;
      this.emitN = this.splashes.reduce((s, e) => s + e.count, 0);
      const groupsOn = this.groups.some((g) => g.active !== 0);
      const asked = this.spawnN > 0 || this.emitN > 0 || groupsOn || req.release || req.meltAll || req.freezeHeld > -2 || !!(req.melt || req.freeze || req.shatter || req.push || req.hurl);
      if (asked) this.lastAsked = this.frame;
      // (no water to move — none alive, none drawn or thrown up this half second: nothing runs. The stats readback lags
      // a few frames: a new draw keeps it awake for a while on its own)
      // (a few stragglers — drops caught on something, never landing — and nothing asked of the water for ten seconds:
      // let them go, or they'd keep it all awake; ice she's set down stays)
      const st = this.stats;
      if (st.alive > 0 && st.alive < 32 && st.held === 0 && st.ice === 0 && this.frame - this.lastAsked > 600) this.needInit = true;
      if (this.spawnN > 0 || this.emitN > 0 || this.stats.alive > 0) this.awake = this.frame + 30;
      // (the first clearing waits until the water's first asked for, or there's water to clear: nothing runs at the start,
      // and its pipelines aren't made until then: util/compile.ts)
      this.live = (this.needInit && (this.lastAsked > -1e9 || this.stats.alive > 0)) || this.frame <= this.awake;
      // (nothing but static ice, nothing asked of it for a second: it can't change until something is)
      const still = this.stats.alive > 0 && this.stats.staticIce === this.stats.alive && this.frame - this.lastAsked > 60 && !this.needInit;
      this.stepping = this.live && !still;
      if (this.stepping) { this.build(frameDt, list); this.landed = true; }
    } else this.live = this.stepping = false;
    // (stopping: the landings emptied once, so a reader finds nothing rather than the last frame's again)
    if (!list.length && this.landed) { list.push(this.items.landClear); this.landed = false; }
    // requests are one-shot
    this.splashes = [];
    req.spawn = null; req.melt = null; req.freeze = null; req.shatter = null;
    req.freezeHeld = -2; req.release = false; req.meltAll = false; req.push = null; req.hurl = null;
  }

  /** this frame's work (empty when there's none): before the shadows and the scene, the spray's sim after it */
  passes(): RunEntry[] { return this.list; }

  private build(frameDt: number, list: RunEntry[]) {
    const I = this.items;
    if (this.nextAnchor) { this.anchor = this.nextAnchor; this.nextAnchor = null; }
    this.writeUniform(Math.min(frameDt, 1 / 30) / this.substeps);
    if (this.needInit) { list.push(I.initFree); this.needInit = false; }
    list.push(I.landClear);
    if (this.spawnN > 0) list.push(I.spawn);
    if (this.emitN > 0) list.push(I.emitSplash);
    // (the one-shot requests apply in every substep's g2p; they are idempotent for a frame)
    for (let s = 0; s < this.substeps; s++) list.push(I.p2g1, I.p2g2, I.gridUpdate, I.g2p);
    list.push(I.landCompact);
    // stats every few frames: counted, copied out, then cleared (what fell into the water adds up between)
    this.statsRb = this.frame % 3 === 0 ? this.readbacks.find((x) => !x.busy) ?? null : null;
    if (this.statsRb) {
      list.push(I.stats, this.statsCopy, I.resetStats);
      this.nextAnchor = [...this.origin];
    }
  }

  private writeUniform(realDt: number) {
    const P = this.params, req = this.req;
    // (the sim's own step: 0.2 at 60 Hz, and as much less as the real step is shorter — a film's sub-frames step it
    // thirty-odd times a frame, and at a fixed step its pressure ran that many times ahead of the clock: a held orb
    // swelled and dripped. Longer real steps keep 0.2, for stability)
    const dtSim = 0.2 * Math.min(1, realDt * 60 * this.substeps);
    const vScale = this.h * (dtSim / realDt);
    const gSim = (9.8 * realDt) / (dtSim * vScale);
    const nPath = Math.min(this.path.length, MAX_PATH);
    const pb = this.pathBuf, pvb = this.pathVelBuf;
    pb.fill(0); pvb.fill(0);
    for (let k = 0; k < nPath; k++) {
      const p = this.path[k];
      pb[k * 4] = p.p[0]; pb[k * 4 + 1] = p.p[1]; pb[k * 4 + 2] = p.p[2]; pb[k * 4 + 3] = p.r;
      pvb[k * 4] = p.v[0]; pvb[k * 4 + 1] = p.v[1]; pvb[k * 4 + 2] = p.v[2]; pvb[k * 4 + 3] = p.flow;
    }
    const gb = this.groupBuf;
    this.groups.forEach((g, k) => {
      gb.set([g.pos[0], g.pos[1], g.pos[2], g.active], k * 16);
      gb.set(g.rot, k * 16 + 4);
      gb.set([g.vel[0], g.vel[1], g.vel[2], 0, g.angVel[0], g.angVel[1], g.angVel[2], 0], k * 16 + 8);
    });
    const wb = this.waterBuf;
    wb.fill(0);
    const nWater = Math.min(this.waters.length, MAX_WATERS);
    for (let k = 0; k < nWater; k++) {
      const w = this.waters[k];
      wb.set(w.box ?? [-1e9, -1e9, 1e9, 1e9], k * 8);
      wb[k * 8 + 4] = w.level;
    }
    const tb = this.targetBuf;
    tb.fill(0);
    for (let k = 0; k < Math.min(this.targets.length, MAX_TARGETS); k++) tb.set([...this.targets[k].pos, this.targets[k].r], k * 4);
    const eb = this.emitBuf;
    eb.fill(0);
    this.splashes.forEach((e, k) => {
      eb.set([e.pos[0], e.pos[1], e.pos[2], e.radius, e.vel[0], e.vel[1], e.vel[2], e.count, e.jitter ?? 0.5, e.radial ?? 0, e.seg?.[0] ?? 0, e.seg?.[1] ?? 0], k * 12);
    });
    const s = req.spawn, h = req.hurl, sub = this.substeps;
    this.u.set({
      origin: this.origin, h: this.h, dims: this.dims, nMax: this.nMax,
      dt: dtSim, stiffness: P.stiffness, restDensity: P.restDensity, viscosity: P.viscosity,
      gravity: gSim, vScale, nWater, pad0: 0,
      realDt, flow: P.antiGravity, pull: P.pull, pathCount: nPath,
      pathMode: this.pathMode, cohesion: P.cohesion, maxSpeed: P.maxSpeed, time: this.time,
      freezeGroup: req.freezeHeld >= 0 ? req.freezeHeld : -1, freezeHeld: req.freezeHeld > -2 ? 1 : 0, meltAll: req.meltAll ? 1 : 0, releaseHeld: req.release ? 1 : 0,
      melt: req.melt ? [...req.melt.pos, req.melt.r] : ZERO4,
      freeze: req.freeze ? [...req.freeze.pos, req.freeze.r] : ZERO4,
      shatter: req.shatter ? [...req.shatter.pos, req.shatter.r] : ZERO4,
      spawn: s ? [...s.pos, s.radius] : ZERO4,
      spawnVel: s ? [...s.vel, this.spawnN] : ZERO4,
      push: req.push ? [...req.push.v, 1] : ZERO4,
      anchor: [...this.anchor, 0],
      water: wb, groups: gb, path: pb, pathVel: pvb, targets: tb, emit: eb,
      nEmit: [this.splashes.length, this.emitN, 0, 0],
      spawnMat: [s?.mist ?? 0, s?.snow ?? 0, 0, 0],
      // (per substep)
      carry: [this.carry[0] / sub, this.carry[1] / sub, this.carry[2] / sub, 0],
      form: [this.strandLen, this.tight, this.merge, 0],
      hurl: h ? [...h.at, h.T] : ZERO4,
      hurl2: h ? [h.r, h.dT, 1, h.frac ?? 1] : ZERO4,
      hurl3: h?.from ? [...h.from, h.fromR ?? 0.5] : ZERO4,
    });
  }

  private readStats(c: Int32Array, a: V3) {
    const held = c[2], abs = c[4];
    this.stats = {
      alive: c[1], held, ice: c[3], free: c[10], staticIce: c[14],
      absorbed: abs, splash: c[5] / 100,
      absorbedAt: abs > 0 ? [a[0] + c[11] / 16 / abs, a[1] + c[12] / 16 / abs, a[2] + c[13] / 16 / abs] : this.stats.absorbedAt,
      heldCentroid: held > 0 ? [a[0] + c[6] / 16 / held, a[1] + c[7] / 16 / held, a[2] + c[8] / 16 / held] : this.stats.heldCentroid,
      heldSpeed: held > 0 ? c[9] / 16 / held : 0,
      hits: Array.from(c.slice(16, 32)),
    };
    this.onStats?.(this.stats);
  }
}
