// Aang's air: what his airbending does to the air round him, simulated here each frame from what his move says
// (fx.ts MoveFx: play/powers.ts sets it) and drawn by air.wgsl. Everything is a ribbon — the path of something moving, its points ageing
// out from the tail, swelling in the middle and thin at both ends like a drawn swoosh — or a leaf, a puff of dust, a
// ball:
//   - his hands' wind: a ribbon off each moving hand with a thinner twin spiralling round it;
//   - a gust off a striking palm: streaks shot forward, slowing and curling, the leaves in front blown along;
//   - the whirlwind round him (spinning up): ribbons climbing a widening helix, the leaves lifted and carried round;
//   - the air scooter: a ball of swirling air under him (air.wgsl draws it) wrapped in fast short arcs;
//   - the marble trick: three glass marbles spun round a ring of wind between his palms;
//   - a burst at his feet when he takes off or lands: a ring of air out along the floor, dust, a few leaves.
// The leaves are the season's (doy): aspen gold and orange in the autumn, greens in summer, blossom in spring, dry
// browns in winter. Nothing's drawn, and nothing's uploaded, while nothing's moving.
import type { Kit, RenderPass, StorageBuffer, UniformBuffer } from '@ericrius1/weft';
import shader from './air.wgsl';
import { type V3, add, sub, scale, len, norm, cross, clamp, smoothstep } from '../hero/math';
import type { MoveFx } from './fx';

const RIBS = 48, PTS = 28, LEAVES = 96, BALLS = 4;

export interface AirInput {
  t: number; beat: number; root: V3; yaw: number;
  J: { handL: V3; handR: V3; palmL: V3; palmR: V3; footL: V3; footR: V3; chest: V3; pelvis: V3 };
  fx: MoveFx | null; rise: number; level: number; doy: number; shown: boolean;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const sq = (x: number) => x * x;
const axes = (yaw: number) => ({ fwd: [-Math.sin(yaw), 0, -Math.cos(yaw)] as V3, left: [-Math.cos(yaw), 0, Math.sin(yaw)] as V3 });
/** two unit vectors across a direction */
function across(d: V3): [V3, V3] {
  const a = norm(Math.abs(d[1]) < 0.9 ? cross(d, [0, 1, 0]) : cross(d, [1, 0, 0]));
  return [a, cross(d, a)];
}

/** the path of something moving: its points newest first, each drifting off on its own velocity as it ages */
class Ribbon {
  p: V3[] = []; v: V3[] = []; age: number[] = [];
  /** half width at its widest (m), how long a point lives (s), how strongly it shows */
  w: number; life: number; alpha = 1;
  seed = Math.random();
  /** no more points coming: it fades as its last points age out */
  done = false;
  constructor(w: number, life: number) { this.w = w; this.life = life; }
  /** a point at its head, `age` old already (the in-betweens of a fast arc); a fresh one that soon after the last moves
   *  the head instead (a fast screen's frames would crowd the ribbon's points) */
  push(p: V3, v: V3, age = 0) {
    if (age === 0 && this.age.length && this.age[0] < 1 / 90) { this.p[0] = [...p] as V3; this.v[0] = [...v] as V3; return; }
    this.p.unshift([...p] as V3); this.v.unshift([...v] as V3); this.age.unshift(age);
    if (this.p.length > PTS) { this.p.pop(); this.v.pop(); this.age.pop(); }
  }
  step(dt: number) {
    const d = Math.exp(-3 * dt);
    for (let i = 0; i < this.p.length; i++) {
      const p = this.p[i], v = this.v[i];
      p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt;
      v[0] *= d; v[1] *= d; v[2] *= d;
      this.age[i] += dt;
    }
    while (this.age.length && this.age[this.age.length - 1] > this.life) { this.p.pop(); this.v.pop(); this.age.pop(); }
  }
  get dead() { return this.done && this.p.length < 2; }
}

/** something flying that draws a ribbon behind it: a gust's streak, a puff's curl */
interface Mote { r: Ribbon; p: V3; v: V3; age: number; life: number; curl: V3; grow: number }
/** a ribbon's emitter going round: the whirlwind's, the ball's, the marbles' */
interface Orbit { r: Ribbon; a: number; h: number; tilt: V3; tilt2: V3 }
interface Leaf { p: V3; v: V3; q: [number, number, number, number]; w: V3; size: number; col: V3; a: number; age: number; life: number; dust: boolean; down: number }

const SEASON: { from: number; to: number; cols: V3[] }[] = [
  { from: 255, to: 322, cols: [[0.95, 0.78, 0.28], [0.92, 0.66, 0.2], [0.9, 0.5, 0.17], [0.66, 0.3, 0.15]] },
  { from: 150, to: 255, cols: [[0.45, 0.63, 0.25], [0.36, 0.54, 0.2], [0.55, 0.68, 0.3]] },
  { from: 80, to: 150, cols: [[0.62, 0.8, 0.38], [0.96, 0.83, 0.87], [0.94, 0.74, 0.8]] },
];
const WINTER: V3[] = [[0.56, 0.42, 0.28], [0.48, 0.36, 0.24], [0.62, 0.5, 0.34]];
const MARBLES: V3[] = [[0.3, 0.72, 0.7], [0.92, 0.62, 0.2], [0.82, 0.25, 0.22]];

export class AirFx {
  private ribbons: Ribbon[] = [];
  private hand: { main: Ribbon | null; twin: Ribbon | null; prev: V3 | null }[] = [{ main: null, twin: null, prev: null }, { main: null, twin: null, prev: null }];
  private motes: Mote[] = [];
  private whirl: Orbit[] = [];
  private ball: Orbit[] = [];
  private wheel: Orbit[] = [];
  private leaves: Leaf[] = [];
  private balls: number[][] = [];
  private gustWas = [0, 0];
  private gustAt = [-1, -1];
  private puffWas = 0;
  private puffAt = -1;
  private riseWas = -1;
  private liftAcc = 0;
  private floorY = 0;
  private t = 0;
  // the GPU side
  private ptBuf: StorageBuffer; private ribBuf: StorageBuffer; private leafBuf: StorageBuffer; private ballBuf: StorageBuffer;
  private u: UniformBuffer<any>;
  private ptData = new Float32Array(RIBS * PTS * 8);
  private ribData = new Float32Array(RIBS * 4);
  private leafData = new Float32Array(LEAVES * 16);
  private ballData = new Float32Array(BALLS * 8);
  private nRib = 0; private nLeaf = 0; private nBall = 0;
  /** the post chain's grade (post.ts settings), for the display lock */
  grade: { exposure: number; saturation: number; contrast: number; punchy: number; warmth: number; bloom: number } | null = null;

  constructor(kit: Kit) {
    this.ptBuf = kit.storage({ label: 'air.pts', size: this.ptData.byteLength });
    this.ribBuf = kit.storage({ label: 'air.ribs', size: this.ribData.byteLength });
    this.leafBuf = kit.storage({ label: 'air.leaves', size: this.leafData.byteLength });
    this.ballBuf = kit.storage({ label: 'air.balls', size: this.ballData.byteLength });
    this.u = kit.uniforms(shader.structs.AirU, 'air');
  }

  /** into the scene pass after the opaque world (with the other water and air, before the glass) */
  draw(pass: RenderPass) {
    const common = {
      cull: 'none' as GPUCullMode, blend: 'premultiplied' as const, depthWrite: false, depthCompare: 'greater-equal' as GPUCompareFunction, topology: 'triangle-strip' as GPUPrimitiveTopology,
      bind: { AU: this.u, pts: this.ptBuf, ribs: this.ribBuf, leaves: this.leafBuf, balls: this.ballBuf } as never,
    };
    pass.draw(shader, { ...common, label: `${pass.label}.air.balls`, vertex: 'vsBall', fragment: 'fsBall', count: 4, instances: () => this.nBall, enabled: () => this.nBall > 0 });
    pass.draw(shader, { ...common, label: `${pass.label}.air.leaves`, vertex: 'vsLeaf', fragment: 'fsLeaf', count: 4, instances: () => this.nLeaf, enabled: () => this.nLeaf > 0 });
    pass.draw(shader, { ...common, label: `${pass.label}.air.ribbons`, vertex: 'vsRibbon', fragment: 'fsRibbon', count: PTS * 2, instances: () => this.nRib, enabled: () => this.nRib > 0 });
  }

  private ribbon(w: number, life: number): Ribbon | null {
    if (this.ribbons.length >= RIBS) return null;
    const r = new Ribbon(w, life);
    this.ribbons.push(r);
    return r;
  }

  /** he's back in view (or moved by hand): his hands' last places are stale, so no swish off the jump to the new ones */
  rejoin() { for (const H of this.hand) H.prev = null; }

  update(dt: number, i: AirInput) {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    this.floorY = i.root[1];
    const fx = i.shown ? i.fx : null;
    const { fwd, left } = axes(i.yaw);
    const body = (q: V3): V3 => add(i.root, add(add(scale(left, q[0]), [0, q[1], 0]), scale(fwd, q[2])));
    const bodyDir = (q: V3): V3 => add(add(scale(left, q[0]), [0, q[1], 0]), scale(fwd, q[2]));
    // ---- his hands' wind
    for (let k = 0; k < 2; k++) {
      const H = this.hand[k];
      const at = k === 0 ? i.J.handL : i.J.handR;
      const v: V3 = H.prev ? scale(sub(at, H.prev), 1 / Math.max(dt, 1e-3)) : [0, 0, 0];
      H.prev = [...at] as V3;
      const want = fx ? fx.trail[k] : 0;
      const speed = len(v);
      if (want > 0.12 && speed > 0.25) {
        if (!H.main || H.main.done) { H.main = this.ribbon(0.034, 0.34); }
        if (!H.twin || H.twin.done) H.twin = this.ribbon(0.016, 0.3);
        const s = clamp(want * smoothstep(0.25, 1.6, speed), 0, 1);
        if (H.main) { H.main.alpha = s; H.main.push(at, scale(v, 0.12)); }
        if (H.twin) {
          const [e1, e2] = across(scale(v, 1 / speed));
          const a = this.t * 19 + k * 2;
          H.twin.alpha = s * 0.85;
          H.twin.push(add(at, add(scale(e1, 0.065 * Math.cos(a)), scale(e2, 0.065 * Math.sin(a)))), scale(v, 0.18));
        }
      } else {
        if (H.main) { H.main.done = true; H.main = null; }
        if (H.twin) { H.twin.done = true; H.twin = null; }
      }
    }
    // ---- a gust off a striking palm
    for (let k = 0; k < 2; k++) {
      const g = fx ? fx.gust[k] : 0;
      if (g > 0.45 && this.gustWas[k] <= 0.45 && this.t - this.gustAt[k] > 0.15) {
        this.gustAt[k] = this.t;
        const palm = norm(k === 0 ? i.J.palmL : i.J.palmR);
        const dir = norm(add(palm, scale(fwd, 0.6)));
        this.gust(add(k === 0 ? i.J.handL : i.J.handR, scale(dir, 0.06)), dir, g);
      }
      this.gustWas[k] = g;
    }
    // ---- a burst at his feet: taking off, landing, springing up off the cushion
    const puff = fx ? fx.puff : 0;
    const feet: V3 = [(i.J.footL[0] + i.J.footR[0]) / 2, this.floorY + 0.04, (i.J.footL[2] + i.J.footR[2]) / 2];
    if (puff > 0.4 && this.puffWas <= 0.4 && this.t - this.puffAt > 0.3) { this.puffAt = this.t; this.burst(feet, 0.8 + 0.4 * puff); }
    this.puffWas = puff;
    if (i.rise >= 0.22 && this.riseWas < 0.22 && i.shown) this.burst(add(i.root, [0, 0.04, 0]), 1);
    this.riseWas = i.rise;
    // ---- the whirlwind round him
    const whirl = fx ? fx.whirl : 0;
    const spin = fx?.spin ?? 1;
    this.orbits(this.whirl, whirl > 0.05 ? 5 : 0, dt, 0.12 / (7 + 4 * whirl), (o) => {
      o.a += (7 + 4 * whirl) * spin;
      o.h += 0.7 + 0.6 * whirl;
    }, (o) => {
      if (o.h > 1.8) return null;
      const r = 0.3 + 0.22 * o.h;
      o.r.alpha = whirl * smoothstep(0, 0.25, o.h) * (1 - smoothstep(1.5, 1.8, o.h));
      return add(i.root, [Math.cos(o.a) * r, o.h, Math.sin(o.a) * r]);
    }, (k) => ({ a: (k / 5) * Math.PI * 2 + rnd(0, 0.6), h: rnd(0, 0.5) }), 0.04, 0.3);
    // ---- the scooter's ball, and the arcs round it
    const ballK = fx ? fx.ball : 0;
    const ballAt = fx ? body(fx.ballAt) : i.root;
    const R = fx ? fx.ballR : 0.3;
    this.orbits(this.ball, ballK > 0.05 ? 5 : 0, dt, 0.008, (o) => { o.a += 15; }, (o) => {
      o.r.alpha = ballK;
      return add(ballAt, scale(add(scale(o.tilt, Math.cos(o.a)), scale(o.tilt2, Math.sin(o.a))), R * 1.04));
    }, () => ({ a: rnd(0, 6.28), h: 0 }), 0.02, 0.12);
    // ---- the marbles' ring of wind between his palms (round its axis: e1, e2 across it)
    const mk = fx ? fx.marbles : 0;
    const mAt = fx ? body(fx.marblesAt) : i.root;
    const mR = fx ? fx.marblesR : 0.065;
    const e1 = left, e2 = norm(cross(fx ? norm(bodyDir(fx.marblesN)) : [0, 1, 0], left));
    const ring = (a: number, r: number, off = 0): V3 => add(mAt, add(add(scale(e1, Math.cos(a) * r), scale(e2, Math.sin(a) * r)), scale(cross(e1, e2), off)));
    this.orbits(this.wheel, mk > 0.05 ? 3 : 0, dt, 0.011, (o) => { o.a += 12; }, (o) => {
      o.r.alpha = mk * 0.8;
      return ring(o.a, mR * (1.35 + 0.12 * Math.sin(o.a * 1.7 + o.h)), 0.012 * Math.sin(o.a * 2.3 + o.h));
    }, (k) => ({ a: (k * Math.PI * 2) / 3, h: k * 2 }), 0.011, 0.16);
    // the balls themselves
    this.balls = [];
    if (ballK > 0.02) this.balls.push([...ballAt, R, 0, ballK, this.t * 6, 0.37]);
    if (mk > 0.02) {
      for (let k = 0; k < 3; k++) this.balls.push([...ring(this.t * 9 + (k * Math.PI * 2) / 3, mR), 0.016 * smoothstep(0, 0.4, mk), 1, ...MARBLES[k]]);
    }
    // ---- leaves and dust lifted round him
    const lift = fx ? fx.lift : 0;
    this.liftAcc += dt * lift * 14;
    while (this.liftAcc > 1) {
      this.liftAcc -= 1;
      const a = rnd(0, Math.PI * 2), r = rnd(0.35, 1.0);
      this.leaf(add(i.root, [Math.cos(a) * r, 0.01, Math.sin(a) * r]), [0, rnd(0.5, 1.5), 0], i.doy, Math.random() < 0.3);
    }
    this.stepLeaves(dt, i.root, whirl, spin);
    // ---- age everything, then the GPU's copy
    for (const m of this.motes) {
      m.age += dt;
      m.v = add(scale(m.v, Math.exp(-2.2 * dt)), scale(cross(m.curl, m.v), dt));
      m.p = add(m.p, scale(m.v, dt));
      m.r.w = 0.012 + m.grow * Math.min(1, m.age / m.life);
      m.r.alpha = 1 - smoothstep(0.55, 1, m.age / m.life);
      if (m.age < m.life) m.r.push(m.p, [0, 0, 0]); else m.r.done = true;
    }
    this.motes = this.motes.filter((m) => !m.r.done || m.r.p.length > 1);
    for (const r of this.ribbons) r.step(dt);
    this.ribbons = this.ribbons.filter((r) => !r.dead);
    this.upload();
  }

  /** a gust: streaks shot along `dir`, the leaves in front blown along, a little dust */
  private gust(at: V3, dir: V3, k: number) {
    const [e1, e2] = across(dir);
    for (let n = 0; n < 4; n++) {
      const r = this.ribbon(0, 0.26);
      if (!r) break;
      const sp = add(scale(e1, rnd(-0.5, 0.5)), scale(e2, rnd(-0.4, 0.4)));
      const v = scale(norm(add(dir, scale(sp, 0.35))), rnd(3.2, 4.8) * (0.7 + 0.3 * k));
      this.motes.push({ r, p: add(at, scale(sp, 0.05)), v, age: 0, life: rnd(0.45, 0.65), curl: scale(norm(cross(dir, sp)), rnd(4, 8) * (Math.random() < 0.5 ? -1 : 1)), grow: 0.055 });
    }
    for (const L of this.leaves) {
      const d = sub(L.p, at), along = d[0] * dir[0] + d[1] * dir[1] + d[2] * dir[2];
      if (along > -0.2 && along < 2 && len(sub(d, scale(dir, along))) < 0.6) { L.v = add(L.v, scale(dir, 3 * k)); L.down = 0; }
    }
  }

  /** a burst of air at p along the floor: a ring of curling streaks, dust, a few leaves */
  private burst(p: V3, k: number) {
    for (let n = 0; n < 7; n++) {
      const r = this.ribbon(0, 0.2);
      if (!r) break;
      const a = (n / 7) * Math.PI * 2 + rnd(0, 0.5);
      const d: V3 = [Math.cos(a), 0.12, Math.sin(a)];
      this.motes.push({ r, p: add(p, scale(d, 0.12)), v: scale(d, rnd(1.8, 2.6) * k), age: 0, life: rnd(0.35, 0.5), curl: scale(norm(cross(d, [0, 1, 0])), 5), grow: 0.035 });
    }
    for (let n = 0; n < 5; n++) {
      const a = rnd(0, Math.PI * 2);
      this.leaf(add(p, [Math.cos(a) * 0.2, 0.02, Math.sin(a) * 0.2]), [Math.cos(a) * rnd(0.6, 1.4), rnd(0.2, 0.6), Math.sin(a) * rnd(0.6, 1.4)], -1, true);
    }
  }

  private leaf(p: V3, v: V3, doy: number, dust: boolean) {
    if (this.leaves.length >= LEAVES) return;
    let col: V3 = [0.8, 0.74, 0.64];
    if (!dust) {
      const s = SEASON.find((x) => doy >= x.from && doy < x.to);
      const cols = s ? s.cols : WINTER;
      col = cols[Math.floor(Math.random() * cols.length)];
    }
    const ax = norm([rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)]), ang = rnd(0, Math.PI);
    this.leaves.push({
      p: [...p] as V3, v: [...v] as V3, q: [ax[0] * Math.sin(ang), ax[1] * Math.sin(ang), ax[2] * Math.sin(ang), Math.cos(ang)],
      w: [rnd(-6, 6), rnd(-6, 6), rnd(-6, 6)], size: dust ? rnd(0.05, 0.09) : rnd(0.03, 0.042), col, a: dust ? rnd(0.18, 0.28) : 1,
      age: 0, life: dust ? rnd(0.7, 1.1) : rnd(3.5, 5), dust, down: 0,
    });
  }

  /** the leaves in the air: carried round by the whirlwind and up its middle, falling and fluttering in still air,
   *  lying where they land a while, then gone; the dust spreading, rising a little, thinning */
  private stepLeaves(dt: number, c: V3, whirl: number, spin: number) {
    for (const L of this.leaves) {
      L.age += dt;
      if (L.dust) {
        L.p = add(L.p, scale(L.v, dt));
        L.v = scale(L.v, Math.exp(-3 * dt));
        L.v[1] += 0.15 * dt;
        L.size += dt * 0.22;
        continue;
      }
      if (L.down > 0) { L.down += dt; continue; }
      const dx = L.p[0] - c[0], dz = L.p[2] - c[2], r = Math.max(Math.hypot(dx, dz), 0.05);
      const swirl = whirl * 3.2 * Math.exp(-sq((r - 0.55) / 0.6));
      const wind: V3 = [(-dz / r) * swirl * spin - (dx / r) * 0.5 * whirl, whirl * 1.6 * Math.exp(-sq(r / 0.9)) - 0.55, (dx / r) * swirl * spin - (dz / r) * 0.5 * whirl];
      const k = 1 - Math.exp(-2.5 * dt);
      L.v = add(L.v, scale(sub(wind, L.v), k));
      // (a falling leaf rocks side to side)
      L.v[0] += Math.sin(L.age * 7 + L.size * 300) * 0.9 * dt;
      L.v[2] += Math.cos(L.age * 6 + L.size * 500) * 0.9 * dt;
      L.p = add(L.p, scale(L.v, dt));
      const wl = len(L.w), h = (wl * dt) / 2;
      if (wl > 1e-4) {
        const s = Math.sin(h) / wl, dq = [L.w[0] * s, L.w[1] * s, L.w[2] * s, Math.cos(h)];
        const [x, y, z, w] = L.q;
        L.q = [dq[3] * x + dq[0] * w + dq[1] * z - dq[2] * y, dq[3] * y - dq[0] * z + dq[1] * w + dq[2] * x, dq[3] * z + dq[0] * y - dq[1] * x + dq[2] * w, dq[3] * w - dq[0] * x - dq[1] * y - dq[2] * z];
      }
      if (L.p[1] < this.floorY + 0.004) { L.p[1] = this.floorY + 0.004; L.down = 0.001; L.q = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]; }
    }
    this.leaves = this.leaves.filter((L) => (L.dust || L.down === 0 ? L.age < L.life : L.down < 2.5));
  }

  /** keep `want` orbiting emitters going (each its own ribbon; a finished one replaced): each moved on by `move` (its
   *  rates, per second) in steps of at most `h` seconds, a point put down at each from `at` (null: it's done) */
  private orbits(list: Orbit[], want: number, dt: number, h: number, move: (o: Orbit) => void, at: (o: Orbit) => V3 | null,
    seed: (k: number) => { a: number; h: number }, w: number, life: number) {
    const n = Math.max(1, Math.ceil(dt / h));
    for (let k = list.length - 1; k >= 0; k--) {
      const o = list[k];
      let alive = k < want;
      for (let s = 0; s < n && alive; s++) {
        const a0 = o.a, h0 = o.h;
        move(o);
        o.a = a0 + (o.a - a0) * (dt / n); o.h = h0 + (o.h - h0) * (dt / n);
        const p = at(o);
        if (p) o.r.push(p, [0, 0, 0], (dt * (n - 1 - s)) / n); else alive = false;
      }
      if (!alive) { o.r.done = true; list.splice(k, 1); }
    }
    while (list.length < want) {
      const r = this.ribbon(w, life);
      if (!r) break;
      const s = seed(list.length);
      const tilt = norm([rnd(-1, 1), rnd(-0.4, 0.4), rnd(-1, 1)]);
      list.push({ r, a: s.a, h: s.h, tilt, tilt2: norm(cross(tilt, norm([rnd(-0.3, 0.3), 1, rnd(-0.3, 0.3)]))) });
    }
  }

  /** this frame's ribbons, leaves and balls to the GPU (only what there is) */
  private upload() {
    const P = this.ptData, R = this.ribData;
    let n = 0;
    for (const r of this.ribbons) {
      const m = r.p.length;
      if (m < 2 || n >= RIBS) continue;
      for (let k = 0; k < m; k++) {
        const u = clamp(r.age[k] / r.life, 0, 1);
        // (a swoosh: thin at its head, widest a third along, thin at its tail; thinner and fainter as it ages)
        const w = r.w * Math.pow(Math.sin(Math.PI * Math.pow(k / (m - 1), 0.6)), 0.7) * (0.4 + 0.6 * (1 - u));
        const o = (n * PTS + k) * 8, p = r.p[k];
        P[o] = p[0]; P[o + 1] = p[1]; P[o + 2] = p[2]; P[o + 3] = w;
        P[o + 4] = r.alpha * Math.pow(1 - u, 1.1); P[o + 5] = u; P[o + 6] = 0; P[o + 7] = 0;
      }
      R[n * 4] = m; R[n * 4 + 1] = 0; R[n * 4 + 2] = r.seed; R[n * 4 + 3] = 0;
      n++;
    }
    this.nRib = n;
    const L = this.leafData;
    let nl = 0;
    for (const f of this.leaves) {
      if (nl >= LEAVES) break;
      const o = nl * 16;
      const fade = f.dust ? 1 - smoothstep(0.3, 1, f.age / f.life) : f.down > 0 ? 1 - smoothstep(1.5, 2.5, f.down) : 1 - smoothstep(f.life - 0.6, f.life, f.age);
      L.set([f.p[0], f.p[1], f.p[2], f.size, f.q[0], f.q[1], f.q[2], f.q[3], f.col[0], f.col[1], f.col[2], f.a * fade, f.dust ? 1 : 0, 0, 0, 0], o);
      nl++;
    }
    this.nLeaf = nl;
    const B = this.ballData;
    this.nBall = Math.min(this.balls.length, BALLS);
    for (let k = 0; k < this.nBall; k++) B.set(this.balls[k], k * 8);
    if (n) { this.ptBuf.write(P.subarray(0, n * PTS * 8)); this.ribBuf.write(R.subarray(0, n * 4)); }
    if (nl) this.leafBuf.write(L.subarray(0, nl * 16));
    if (this.nBall) this.ballBuf.write(B.subarray(0, this.nBall * 8));
    if (n || nl || this.nBall) {
      const g = this.grade;
      this.u.set({
        counts: [n, PTS, nl, this.nBall], look: [this.t, 0, 0, 0],
        grade: g ? [g.exposure, g.saturation, g.contrast, g.punchy] : [0, 1, 1, 0], grade2: g ? [g.warmth, g.bloom, 0, 0] : [0, 0, 0, 0],
      });
    }
  }
}
