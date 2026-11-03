// Firebending's flames (fire.wgsl draws them): held flames — a small light kept over a palm or a fingertip, set each
// frame by whoever holds it (`hold`) and gone when they stop — and fireballs, thrown (`burst`: a jet of puffs out of a
// fist, each rising a little, growing and cooling as it slows). A few dozen at most, written to one small buffer; drawn
// only while there are any. Their light on the world (world.wgsl outdoorLamps): each held flame a lamp, the jet's
// puffs one together, where they are, as bright as they burn (`lights`, set each update).
import type { Kit, RenderPass, StorageBuffer, UniformBuffer } from '@ericrius1/weft';
import shader from './fire.wgsl';
import type { V3 } from '../hero/math';

const MAX = 48;
/** the light a flame gives (candela: a held flame at full heat, the whole of a fresh jet), and its colour */
const HELD_CD = 120, JET_CD = 320;
const FLAME: [number, number, number] = [1.0, 0.55, 0.22];
/** candela -> world.lamps' strength (boulder's lamps: candela x level x 30 / 128000, the night lifted into range) */
const CD = 30 / 128000;

interface Ball { p: V3; v: V3; size: number; grow: number; age: number; life: number; seed: number }

export class FireFx {
  private buf: StorageBuffer;
  private u: UniformBuffer<any>;
  private data = new Float32Array(MAX * 12);
  private n = 0;
  private t = 0;
  private held = new Map<string, { at: V3; up: V3; size: number; heat: number; seed: number }>();
  private balls: Ball[] = [];
  /** this frame's lights, two vec4s each (world.wgsl lamps: [x, y, z, strength], [r, g, b, 9: all round]), at most 8 */
  lights: [number, number, number, number][] = [];

  constructor(kit: Kit) {
    this.buf = kit.storage({ label: 'fire.flames', size: this.data.byteLength });
    this.u = kit.uniforms(shader.structs.FireU, 'fire');
  }

  /** into the scene pass after the opaque world (with the air, before the glass) */
  draw(pass: RenderPass) {
    pass.draw(shader, {
      label: `${pass.label}.fire`, vertex: 'vsFlame', fragment: 'fsFlame', count: 4, instances: () => this.n, enabled: () => this.n > 0,
      cull: 'none', blend: 'premultiplied', depthWrite: false, depthCompare: 'greater-equal', topology: 'triangle-strip',
      bind: { FU: this.u, flames: this.buf } as never,
    });
  }

  /** a held flame this frame (`id` keeps its flicker its own): where it stands, its way up, its size (m), how hot
   *  (0..1); not set in a frame, it's gone */
  hold(id: string, at: V3, size: number, heat = 1, up: V3 = [0, 1, 0]) {
    const h = this.held.get(id);
    if (h) { h.at = at; h.up = up; h.size = size; h.heat = heat; }
    else this.held.set(id, { at, up, size, heat, seed: Math.random() });
  }

  /** a jet of fire out of `at` along `dir` (unit): `count` puffs streaming out of it over its first tenth of a second
   *  or so, the first the fastest (`speed` m/s), each `size` (m) and growing as it slows */
  burst(at: V3, dir: V3, o: { count?: number; speed?: number; size?: number; spread?: number } = {}) {
    const n = o.count ?? 16, sp = o.speed ?? 12, sz = o.size ?? 0.15, spread = o.spread ?? 0.1;
    for (let k = 0; k < n && this.balls.length < MAX - 8; k++) {
      const j: V3 = [(Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread];
      const f = (1 - 0.4 * k / n) * (0.9 + 0.2 * Math.random());
      this.balls.push({
        p: [...at] as V3, v: [(dir[0] + j[0]) * sp * f, (dir[1] + j[1]) * sp * f, (dir[2] + j[2]) * sp * f],
        size: sz * (0.7 + 0.3 * Math.random()), grow: 1.6 + Math.random() * 0.8, age: -k * 0.009, life: 0.5 + 0.25 * Math.random(), seed: Math.random(),
      });
    }
  }

  /** anything burning (held this frame or still in the air) */
  get busy() { return this.n > 0; }

  update(dt: number) {
    this.t += dt;
    const D = this.data, L: [number, number, number, number][] = [];
    const lamp = (p: V3, cd: number) => { if (L.length < 16) L.push([p[0], p[1], p[2], cd * CD], [...FLAME, 9]); };
    let n = 0;
    for (const h of this.held.values()) {
      // (it flickers: a breath and a quick shiver)
      lamp(h.at, HELD_CD * h.heat * (0.85 + 0.1 * Math.sin(this.t * 13 + h.seed * 40) + 0.05 * Math.sin(this.t * 31 + h.seed * 7)));
      if (n >= MAX) break;
      const o = n * 12;
      D[o] = h.at[0]; D[o + 1] = h.at[1]; D[o + 2] = h.at[2]; D[o + 3] = h.size;
      D[o + 4] = h.up[0]; D[o + 5] = h.up[1]; D[o + 6] = h.up[2]; D[o + 7] = h.heat;
      D[o + 8] = 0; D[o + 9] = h.seed; D[o + 10] = 0; D[o + 11] = 0;
      n++;
    }
    this.held.clear();
    // (the fireballs slow in the air and rise a little as they burn out)
    const drag = Math.exp(-dt * 4.5);
    this.balls = this.balls.filter((b) => b.age < b.life);
    for (const b of this.balls) {
      b.age += dt;
      if (b.age < 0) continue;
      b.v = [b.v[0] * drag, b.v[1] * drag + dt * 1.6, b.v[2] * drag];
      b.p = [b.p[0] + b.v[0] * dt, b.p[1] + b.v[1] * dt, b.p[2] + b.v[2] * dt];
      if (n >= MAX) continue;
      const u = b.age / b.life, o = n * 12;
      D[o] = b.p[0]; D[o + 1] = b.p[1]; D[o + 2] = b.p[2]; D[o + 3] = b.size * (1 + b.grow * u);
      D[o + 4] = 0; D[o + 5] = 1; D[o + 6] = 0; D[o + 7] = 1 - 0.3 * u;
      D[o + 8] = 1; D[o + 9] = b.seed; D[o + 10] = u; D[o + 11] = 0;
      n++;
    }
    // (the jet's puffs as one light at their middle, dimming as they burn out)
    let w = 0;
    const c: V3 = [0, 0, 0];
    for (const b of this.balls) {
      if (b.age < 0) continue;
      const k = 1 - b.age / b.life;
      w += k; c[0] += b.p[0] * k; c[1] += b.p[1] * k; c[2] += b.p[2] * k;
    }
    if (w > 0.05) lamp([c[0] / w, c[1] / w, c[2] / w], JET_CD * Math.min(1, w / 9));
    this.lights = L;
    this.n = n;
    if (n > 0) this.buf.write(D.subarray(0, n * 12));
    this.u.set({ counts: [n, this.t, 0, 0] });
  }
}
