// Spray / mist / glitter (spray_sim.wgsl moves them, spray_draw.wgsl draws them), ported from the waterbending app:
// CPU emitters for the bending's moments (`emit`, `bubbles`), and GPU splash events the fluid sim appends (`events`,
// `ring`: bound into fluid_sim.wgsl). Under water (`under`, set from the eye's lake): drifting silt motes kept round
// the camera, and a rush of bubbles going under. The energy motes are drawn to `attract` (energy.ts).
// Drawn over the finished scene (post/fx.ts's overlay, after the bent water's composite) rather than into the scene:
// premultiplied like the clouds, faded softly against the scene's distances and the bent water's smoothed surface —
// which only exists after the scene — and without the multisampled pass's cost. Idle (no work, no draw) once the last
// particle it made can have died.
import type { Kit, RenderPass, RunEntry, StorageBuffer, Texture, UniformBuffer, V3, Compute } from '@ericrius1/weft';
import simShader, { type SprayU } from './spray_sim.wgsl';
import drawShader from './spray_draw.wgsl';
import type { WaterLevel } from './fluid';

const MAX_EMIT = 64;
const MAX_WATERS = 4;
export type SprayKind = 'droplet' | 'mist' | 'glitter' | 'foam' | 'bubble' | 'mote' | 'spume' | 'leaf' | 'spirit' | 'energy' | 'sheet' | 'haze';
/** (sheet: water torn into streaks of drops, flying off a skimmer; haze: fine mist that hangs for seconds, lit through
 *  by the sun, a bow in it when the sun is behind the eye) */
const KIND: Record<SprayKind, number> = { droplet: 1, mist: 2, glitter: 3, foam: 4, bubble: 5, mote: 6, spume: 7, leaf: 8, spirit: 9, energy: 10, sheet: 11, haze: 12 };
/** what the 'energy' motes are drawn to (energy.ts): up to 8 points along the form she holds (xyz, radius), how
 *  charged it is, its heart's phase */
export interface Attract { pts: [number, number, number, number][]; k: number; phase: number }

export interface Emit {
  pos: V3; radius: number; vel: V3; spread: number; count: number; kind: SprayKind; life: number;
  /** how much bigger than its kind's own each particle is drawn (1..20: a dragon's splash throws sheets, not drops) */
  size?: number;
}

export class Spray {
  readonly particles: StorageBuffer;
  /** splash events from the fluid sim: [k + 1] = (pos, impact speed); ring[1] counts them, ring[0] is the next slot */
  readonly events: StorageBuffer;
  readonly ring: StorageBuffer;
  readonly u: UniformBuffer<SprayU>;
  attract: Attract = { pts: [], k: 0, phase: 0 };
  /** the water round her (the fluid's: fluid.waters) — droplets falling into it vanish, leaves float on it */
  waters: WaterLevel[] = [];
  /** the eye is under the water (the lake's: water/below.ts) */
  under = false;
  /** wind (m/s) the droplets and mist drift on */
  wind: V3 = [1.2, 0, -0.4];
  /** its own light's scale (the motes of light, the energy motes): the app's sun is 20, this world's 1 */
  emissive = 0.05;
  /** the charge (energy.ts): x the heart's phase (beats), y the charge (0..1), z how far it's spirit water */
  energy: [number, number, number, number] = [0, 0, 0, 0];
  private items: Record<string, Compute>;
  private queue: Emit[] = [];
  private list: RunEntry[] = [];
  private frame = 0;
  private time = 0;
  /** (kit.time until which a particle it made may live) */
  private until = -1;
  private live = false;
  private wasUnder = false;
  private lastCam: V3 | null = null;
  private camVel: V3 = [0, 0, 0];
  private maxCount = 0;
  private nEmit = 0;
  private emitBuf = new Float32Array(MAX_EMIT * 12);
  private waterBuf = new Float32Array(MAX_WATERS * 8);
  private attractBuf = new Float32Array(8 * 4);
  private fluidDrawn = () => false;
  private fluidScale = 1;

  constructor(readonly kit: Kit, readonly max: number) {
    this.particles = kit.storage({ label: 'spray.particles', size: max * 32 });
    this.events = kit.storage({ label: 'spray.events', size: 513 * 16 });
    this.ring = kit.storage({ label: 'spray.ring', size: 16 });
    this.u = kit.uniforms(simShader.structs.SprayU, 'spray');
    const bind = { PS: this.particles, S: this.u, events: this.events, ring: this.ring };
    this.items = {
      emitCPU: kit.compute(simShader, { label: 'spray.emit', entry: 'emitCPU', bind, workgroups: () => [Math.ceil(this.maxCount / 64), this.nEmit] }),
      emitEvents: kit.compute(simShader, { label: 'spray.events', entry: 'emitEvents', bind, workgroups: [512] }),
      clearEvents: kit.compute(simShader, { label: 'spray.clear', entry: 'clearEvents', bind, workgroups: [1] }),
      updateP: kit.compute(simShader, { label: 'spray.update', entry: 'updateP', bind, threads: [max] }),
    };
  }

  emit(e: Emit) {
    if (this.queue.length >= MAX_EMIT) return;
    this.queue.push(e);
    this.until = Math.max(this.until, this.kit.time + e.life * 1.4 + 0.5);
  }

  /** a puff of air bubbles under water at pos (they rise, wobble and burst at the surface; above water nothing):
   *  `size` 0..1 from a few small ones to a big gulp, `vel` the push they leave with */
  bubbles(pos: V3, size = 0.3, vel: V3 = [0, 0.15, 0]) {
    const s = Math.min(Math.max(size, 0), 1);
    this.emit({ pos, radius: 0.04 + 0.18 * s, vel, spread: 0.12 + 0.25 * s, count: Math.round(3 + 40 * s * s), kind: 'bubble', life: 6 });
  }

  /** the drawing, into the pass over the finished scene (after the bent water's composite): `sceneZ` the scene's
   *  distances (post.fx.sceneZ), `fluidZ` the bent water's smoothed surface (render.ts depth) at `fluidScale` of the
   *  render's resolution, drawn this frame when `fluidDrawn()` */
  draw(pass: RenderPass, sceneZ: Texture, fluidZ: Texture, fluidScale: number, fluidDrawn: () => boolean) {
    this.fluidDrawn = fluidDrawn;
    this.fluidScale = fluidScale;
    pass.draw(drawShader, {
      label: 'spray', vertex: 'vsSpray', fragment: 'fsSpray', topology: 'triangle-strip', count: 4, instances: this.max, cull: 'none',
      blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } },
      bind: { PS: this.particles, S: this.u, sceneZ, fluidZ }, enabled: () => this.live,
    });
  }

  /** every frame, after the emitters: `fluidRunning` the fluid sim steps this frame (its splash events feed the spray) */
  update(dt: number, fluidRunning: boolean) {
    this.frame++;
    this.time = (this.time + dt) % 1000;
    const cam = this.kit.camera;
    const p = cam.position;
    // the camera's velocity (0 across a cut)
    if (this.lastCam) {
      const d: V3 = [p[0] - this.lastCam[0], p[1] - this.lastCam[1], p[2] - this.lastCam[2]];
      const cut = Math.hypot(d[0], d[1], d[2]) > 5;
      this.camVel = cut ? [0, 0, 0] : [d[0] / Math.max(dt, 1e-3), d[1] / Math.max(dt, 1e-3), d[2] / Math.max(dt, 1e-3)];
    }
    this.lastCam = [p[0], p[1], p[2]];
    // under water: silt motes drifting round the camera (kept topped up; they die above the water or left behind);
    // going under, the air dragged down with the camera rushes up past the lens
    if (this.under) {
      const f = cam.forward;
      const at = (k: number): V3 => [p[0] + f[0] * k, p[1] + f[1] * k, p[2] + f[2] * k];
      this.queue.unshift({ pos: at(2.5), radius: 6, vel: [0, 0, 0], spread: 0.02, count: Math.round(14 * Math.min(1, dt * 60)), kind: 'mote', life: 6 });
      if (!this.wasUnder) {
        const q = at(0.9);
        this.queue.unshift({ pos: [q[0], q[1] - 0.5, q[2]], radius: 0.7, vel: [0, 0.9, 0], spread: 0.5, count: 160, kind: 'bubble', life: 4 });
      }
      if (this.queue.length > MAX_EMIT) this.queue.length = MAX_EMIT;
      this.until = Math.max(this.until, this.kit.time + 9);
    }
    this.wasUnder = this.under;
    // (the fluid's crowns live under 3 s, its mist up to 4.5: kept going that long after it)
    if (fluidRunning) this.until = Math.max(this.until, this.kit.time + 5);
    this.live = this.kit.time < this.until;
    const list = this.list;
    list.length = 0;
    if (!this.live) { this.queue = []; return; }
    const n = (this.nEmit = this.queue.length);
    const eb = this.emitBuf;
    eb.fill(0);
    this.maxCount = 0;
    this.queue.forEach((e, k) => {
      const c = Math.min(e.count, 4096);
      eb.set([e.pos[0], e.pos[1], e.pos[2], e.radius, e.vel[0], e.vel[1], e.vel[2], e.spread, c, KIND[e.kind], e.size ?? 1, e.life], k * 12);
      this.maxCount = Math.max(this.maxCount, c);
    });
    const wb = this.waterBuf;
    wb.fill(0);
    const nWater = Math.min(this.waters.length, MAX_WATERS);
    for (let k = 0; k < nWater; k++) {
      wb.set(this.waters[k].box ?? [-1e9, -1e9, 1e9, 1e9], k * 8);
      wb[k * 8 + 4] = this.waters[k].level;
    }
    const A = this.attract, ab = this.attractBuf, na = Math.min(A.pts.length, 8);
    ab.fill(0);
    for (let i = 0; i < na; i++) ab.set(A.pts[i], i * 4);
    this.u.set({
      nEmit: n, maxP: this.max, frameNo: this.frame, under: this.under ? 1 : 0,
      dt, time: this.time, nWater, emissive: this.emissive,
      wind: [...this.wind, 0], camVel: [...this.camVel, 0], energy: this.energy,
      look: [this.fluidScale, this.fluidDrawn() ? 1 : 0, 0, 0],
      water: wb, emit: eb, attract: ab, attractInfo: [A.k, A.phase, na, 0],
    });
    const I = this.items;
    if (n) list.push(I.emitCPU);
    list.push(I.emitEvents, I.clearEvents, I.updateP);
    this.queue = [];
  }

  /** this frame's work (after the fluid sim, whose events it takes) */
  passes(): RunEntry[] { return this.list; }

  /** drawn this frame */
  get active() { return this.live; }
}
