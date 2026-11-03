// Waterbending (the waterbending game's, whole): turns what she's asked to do into what the water does. The water is
// the game's MPM fluid (fluid/fluid.ts); this steers it along a path rebuilt every frame and makes the one-shot
// requests (draw it up, let it go, freeze it, melt it, shatter it).
//   bend (hold)     draw water from a lake, a creek, a pool or a falls (or snow in winter) and steer it with the aim;
//                   let go to throw it — a fast flick of the aim as you let go whips it
//   freeze          held water gathers and freezes into a block of ice she carries (bend throws it, freeze again sets
//                   it down: an ice sculpture); empty-handed, an ice floe where she aims on the water (hold to grow it)
//   melt            the ice she aims at, or the ice she carries, back into water
//   swirl (hold)    a ring of water round her
//   wave (hold)     raise a wave in front of her; let go to send it rolling on and breaking
//   walk (hold)     the water freezes under her feet as she goes: a path across a lake
//   forms 1-6       stream, orb, whip, octopus, vortex (sent off when she lets go), a dragon of water
//   reach           how far out the water goes
// In flight what she holds she keeps gathering (from the water she skims, the falls she climbs past) and builds into
// sacred geometry round her, which becomes the vortex. Holding water gathers a charge (energy, below).
import { add, sub, scale, norm, len, dist, cross, dot, clamp, lerp, lerp3, damp, smoothstep, type V3 } from '../math';
import { quatAxisAngle, quatMul, type Quat } from '@ericrius1/weft';
import type { Fluid, PathPoint } from './fluid/fluid';

export type Form = 'stream' | 'orb' | 'whip' | 'octopus' | 'vortex';
export const FORMS: Form[] = ['stream', 'orb', 'whip', 'octopus', 'vortex'];
/** the forms she builds in flight (and the vortex they become): strands of 18 points each */
const GEO_STRANDS = 20;

export interface BendEvent { type: string; pos: V3; amount?: number; size?: number; speed?: number; snow?: boolean }

/** what the body should be doing with the water (the rig's BendPose) */
export interface BrainPose {
  mode: 'idle' | 'draw' | 'hold' | 'push' | 'swirl' | 'freeze' | 'melt' | 'wave' | 'carryIce' | 'throw';
  target: V3;
  intensity: number;
  t: number;
}

/** her, as the bending needs her: where she is and goes, how she's facing, what she aims at */
export interface Bender {
  readonly pos: V3; readonly vel: V3; readonly forward: V3; readonly right: V3;
  readonly flying: boolean; readonly moveDir: V3;
  /** the camera and the aim ray from it: what it meets (the ground, or water), how far */
  readonly camPos: V3;
  readonly aim: { dir: V3; dist: number; hit: V3; onWater: boolean };
  ground(x: number, z: number): number;
  /** turn to face the aim; pull the camera back to take a big form in (0..1) */
  faceAim: boolean;
  powerView: number;
}

/** the water round her, as the bending needs it */
export interface BendWater {
  /** the surface over (x, z), -1e9 where there's none */
  levelAt(x: number, z: number): number;
  /** the nearest drawable water within r of p (a falls' sheet counts), or null */
  nearest(p: V3, r: number): V3 | null;
  /** ripples: m of height at the middle (negative draws it down) over a radius, and foam */
  impulse(e: { x: number; z: number; r: number; amount: number; foam?: number }): void;
  /** the ice floes on it (fluid/floes.ts: the bending adds, grows and melts them; they ripple the water themselves) */
  floes: { list: unknown[]; addFloe(x: number, z: number, r: number, level: number): number; grow(i: number, dt: number): void; melt(x: number, z: number, reach?: number): void };
}

/** what she's asked to do this frame: held things and this frame's presses (powers.ts gathers them) */
export interface BendIntent {
  bend: boolean; bendHit: boolean; bendUp: boolean;
  freeze: boolean; freezeHit: boolean;
  meltHit: boolean;
  swirl: boolean;
  wave: boolean; waveUp: boolean;
  walk: boolean;
  /** a form chosen this frame (1-6), else 0 */
  form: number;
  /** the reach's change (m) */
  reach: number;
}

export class Bending {
  form: Form = 'stream';
  /** the vortex as a dragon of water (form 6) */
  serpent = false;
  holding = false;
  drawing = false;
  heldTarget = 0;
  /** how far out the water goes (m from her) */
  reach = 6.5;
  private spawned = 0;
  private source: V3 | null = null;
  private fromSnow = false;
  private target: V3 = [0, 0, 0];
  private prevPath: V3[] = [];
  /** points on a raised wave's crest this frame (spray is thrown off them) */
  crest: V3[] = [];
  private iceGroup = -1;
  private swirl = 0;
  private wave = 0;
  private time = 0;
  private aimSpeed = 0;
  private lastAimDir: V3 = [0, 0, -1];
  private whipT = 0;
  /** freezing held water: it first gathers into one mass at the hands (s left) */
  private gatherT = 0;
  private waveC: V3 = [0, 0, 0];
  private orbP: V3 = [0, 0, 0];
  private travel: { t: number; c0: V3; fwd: V3; right: V3; h: number } | null = null;
  private floeIdx = -1;
  private lastFloeAt: V3 | null = null;
  pose: BrainPose = { mode: 'idle', target: [0, 0, 0], intensity: 0, t: 0 };
  onEvent?: (e: BendEvent) => void;
  message = '';
  messageT = 0;
  /** the most water she can hold at once (the fluid's slots allow) */
  maxHeld = 9000;
  /** her hands (the rig's) */
  hands: [V3, V3] | null = null;
  /** in flight, a falls' sheet beside her to draw from */
  fallsSource?: () => V3 | null;
  /** with no water near, a snowfield to draw from (winter) */
  snowSource?: () => V3 | null;
  /** in flight she keeps gathering, up to this much, this fast (per second) */
  gatherCap = 9000;
  gatherRate = 4500;
  private lastPos: V3 | null = null;
  private carryV: V3 = [0, 0, 0];
  private regatherT = 0;
  private geoAx: V3 = [0, 0, -1];
  private geoG = 0;
  private feedK = 0;
  private vortK = 0;
  private wasGeo = false;
  /** the vortex sent off: crossing to what she aimed at, spinning round it a while, then falling onto it */
  sent: { to: V3; t: number; dur: number; hold: number; R: number } | null = null;
  private sentPh = 0;
  private serpT = 0;
  private serpSent = -1;
  private serpFrom: V3 = [0, 0, 0];
  /** where the dragon's eyes are (null: no dragon) */
  serpentEyes: [V3, V3] | null = null;
  /** the power gathered into what she holds (0..1): it builds the longer she holds it */
  charge = 0;

  constructor(private fluid: Fluid, private water: BendWater, private me: Bender) {}

  /** the ice she carries (null: none) */
  get carrying() { return this.iceGroup >= 0; }
  get swirling() { return this.swirl; }

  private emit(e: BendEvent) { this.onEvent?.(e); }
  private setMode(m: BrainPose['mode']) { if (this.pose.mode !== m) { this.pose.mode = m; this.pose.t = 0; } }

  /** let go of what she holds without throwing it (switching away from her, sitting down): it falls back; and with
   *  `ice`, the ice she carries melts and falls (left hanging, it kept the sim awake and hung before the eye) */
  relax(ice = true) {
    if (ice && this.iceGroup >= 0) {
      const g = this.fluid.groups[this.iceGroup];
      if (g && g.active === 1) { g.active = 0; this.fluid.req.melt = { pos: g.pos, r: g.radius + 1.5 }; }
      this.iceGroup = -1;
    }
    if (!this.holding) return;
    this.fluid.req.release = true;
    this.fluid.req.push = { v: [0, -1.5, 0] };
    this.holding = false; this.drawing = false; this.wave = 0; this.swirl = 0; this.sent = null; this.sentPh = 0; this.serpSent = -1;
    this.travel = null;
    this.fluid.path = [];
  }

  update(dt: number, I: BendIntent) {
    this.time += dt;
    this.pose.t += dt;
    this.crest.length = 0;
    if (this.messageT > 0) { this.messageT -= dt; if (this.messageT <= 0) this.message = ''; }
    const pl = this.me;
    const st = this.fluid.stats;
    const fwd = pl.forward, right = pl.right;
    const chest: V3 = add(pl.pos, [0, 1.25, 0]);
    // (in flight the held water rides along with her: the sim moves it with her, and the shape's own motion is taken
    // relative to her)
    const disp: V3 = this.lastPos ? sub(pl.pos, this.lastPos) : [0, 0, 0];
    this.lastPos = [...pl.pos] as V3;
    const carry = pl.flying && len(disp) < 40;
    this.carryV = carry ? scale(disp, 1 / Math.max(dt, 1e-3)) : [0, 0, 0];
    this.fluid.carry = carry ? disp : [0, 0, 0];
    // how fast the aim is turning (whips)
    const ad = pl.aim.dir;
    const turn = Math.acos(clamp(dot(ad, this.lastAimDir), -1, 1)) / Math.max(dt, 1e-3);
    this.aimSpeed = damp(this.aimSpeed, turn, 12, dt);
    this.lastAimDir = ad;
    this.reach = clamp(this.reach + I.reach, 2.5, 12);
    if (I.form > 0) {
      const k = I.form - 1;
      this.form = k < FORMS.length ? FORMS[k] : 'vortex';
      this.serpent = k === FORMS.length;
      this.emit({ type: 'form', pos: chest });
      // (turned to the vortex while holding water: it wants much more; she draws again)
      if (this.form === 'vortex' && this.holding && this.iceGroup < 0) {
        const want = Math.max(this.heldTarget, pl.flying ? Math.min(this.gatherCap, this.maxHeld * 0.7) : this.maxHeld * 0.7);
        if (this.drawing) this.heldTarget = want;
        else {
          const found = this.findSource();
          if (found) {
            this.drawing = true; this.source = found.p; this.fromSnow = found.snow;
            this.spawned = st.held; this.heldTarget = want;
            this.emit({ type: 'draw', pos: found.p, amount: 0.8, snow: found.snow });
          }
        }
      }
    }

    // ---- where the water should go: along the aim, `reach` metres out from her, never into the ground
    const tgt = add(pl.camPos, scale(ad, Math.min(pl.aim.dist, dist(pl.camPos, chest) + this.reach)));
    tgt[1] = Math.max(tgt[1], Math.max(pl.ground(tgt[0], tgt[2]), this.water.levelAt(tgt[0], tgt[2])) + 0.6);
    this.target = this.target[0] === 0 && this.target[2] === 0 ? tgt : lerp3(this.target, tgt, 1 - Math.exp(-dt * 10));

    // ---- the ice she carries
    // (E melting it is that E's whole doing: the empty-handed melt below must not run on as well and take the request)
    let meltedCarried = false;
    if (this.iceGroup >= 0) {
      const g = this.fluid.groups[this.iceGroup];
      if (g.active === 1) {
        // held up and out in front of her along the aim (above the line of sight, so she can still aim), turning
        const flat = norm([ad[0], 0, ad[2]]);
        const want = add(add(chest, scale(flat, 0.8 + g.radius * 0.8)), [0, 0.42 + g.radius * 0.6 + ad[1] * 0.8, 0]);
        want[1] = Math.max(want[1], pl.ground(want[0], want[2]) + g.radius * 0.8);
        g.vel = scale(sub(want, g.pos), 6);
        g.pos = add(g.pos, scale(g.vel, dt));
        g.rot = normQ(quatMul(quatAxisAngle([0, 1, 0], dt * 0.4), g.rot));
        this.setMode('carryIce');
        if (I.bendHit) {
          // thrown
          g.active = 2;
          g.vel = add(scale(ad, 24), [0, 2.5, 0]);
          g.angVel = [Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2];
          this.setMode('throw');
          this.emit({ type: 'launch', pos: g.pos, amount: 1 });
        } else if (I.freezeHit) {
          // set down where it is: an ice sculpture
          g.active = 0;
          this.iceGroup = -1;
          this.emit({ type: 'iceCrack', pos: g.pos });
        } else if (I.meltHit) {
          // melted back into water
          g.active = 0;
          this.fluid.req.melt = { pos: g.pos, r: g.radius + 1.5 };
          this.iceGroup = -1;
          meltedCarried = true;
          this.setMode('melt');
          this.emit({ type: 'melt', pos: g.pos, amount: 1 });
        }
      }
      if (g.active === 2) {
        // flying: ballistic, shattering where it hits
        g.vel[1] -= 9.8 * dt;
        g.pos = add(g.pos, scale(g.vel, dt));
        const av = g.angVel, an = len(av);
        if (an > 1e-4) g.rot = normQ(quatMul(quatAxisAngle(scale(av, 1 / an), an * dt), g.rot));
        const gh = pl.ground(g.pos[0], g.pos[2]), wl = this.water.levelAt(g.pos[0], g.pos[2]);
        g.age += dt;
        if (g.pos[1] - Math.max(gh, wl) < g.radius * 0.5 || g.age > 6) {
          g.active = 0;
          this.fluid.req.shatter = { pos: g.pos, r: g.radius + 1.2, strength: 1.4 };
          this.emit({ type: 'shatter', pos: g.pos, amount: 1 });
          if (wl > gh) {
            this.water.impulse({ x: g.pos[0], z: g.pos[2], r: 1.2, amount: -0.08, foam: 1.5 });
            this.emit({ type: 'splash', pos: g.pos, size: 0.9, speed: len(g.vel) });
          }
          this.iceGroup = -1;
        }
      }
      if (g.active === 0 && this.iceGroup >= 0) this.iceGroup = -1;
    }

    // ---- freeze, melt, walk on water
    if (I.freezeHit && this.iceGroup < 0 && this.holding && st.held > 50 && this.gatherT <= 0) {
      // the held water pulled together into one mass first, then frozen (a long stream would freeze as a pole)
      this.gatherT = 0.45;
      this.setMode('freeze');
    }
    let freezeNow = false;
    if (this.gatherT > 0) {
      this.gatherT -= dt;
      if (this.gatherT <= 0) { this.gatherT = 0; freezeNow = this.holding; }
    }
    if ((I.freezeHit && this.iceGroup < 0 && !this.holding) || freezeNow) {
      if (freezeNow && st.held > 50) {
        // the held water frozen into a body she carries
        const gi = this.fluid.groups.findIndex((g) => g.active === 0);
        if (gi >= 0) {
          const g = this.fluid.groups[gi];
          g.active = 1; g.pos = [...this.orbP] as V3; g.rot = [0, 0, 0, 1]; g.vel = [0, 0, 0]; g.angVel = [0, 0, 0]; g.age = 0;
          g.radius = clamp(Math.cbrt(st.held / 4000) * 0.8, 0.3, 2.5);
          this.fluid.req.freezeHeld = gi;
          this.iceGroup = gi;
          this.holding = false;
          this.drawing = false;
          this.emit({ type: 'freeze', pos: this.target, amount: clamp(st.held / 6000, 0.2, 1) });
        }
      } else if (pl.aim.onWater && pl.aim.dist < 30) {
        // an ice floe on the water where she aims
        const h = pl.aim.hit;
        this.floeIdx = this.addFloe(h[0], h[2], 1.6);
        this.fluid.req.freeze = { pos: h, r: 2.2 };
        this.emit({ type: 'freeze', pos: h, amount: 0.6 });
      } else {
        // any loose water near the aim freezes
        this.fluid.req.freeze = { pos: pl.aim.hit, r: 2.5 };
        this.emit({ type: 'freeze', pos: pl.aim.hit, amount: 0.4 });
      }
    }
    if (I.freeze && this.floeIdx >= 0 && this.water.floes.list[this.floeIdx]) {
      this.water.floes.grow(this.floeIdx, dt);
      this.setMode('freeze');
    } else this.floeIdx = -1;
    if (I.meltHit && this.iceGroup < 0 && !meltedCarried) {
      const h = pl.aim.hit;
      this.fluid.req.melt = { pos: h, r: 2.8 };
      // floes near the aim melt away (shrinking over a second)
      this.water.floes.melt(h[0], h[2], 1.5);
      this.setMode('melt');
      this.emit({ type: 'melt', pos: h, amount: 1 });
    }
    if (I.walk && !pl.flying) {
      // the water freezes under her feet as she goes: a floe a step ahead each time she's moved on a metre
      const p = pl.pos;
      const ahead = add(p, scale(pl.moveDir, 1.2));
      const onA = this.water.levelAt(ahead[0], ahead[2]) > -1e9, onP = this.water.levelAt(p[0], p[2]) > -1e9;
      if (onA || onP) {
        const at = onA ? ahead : p;
        if (!this.lastFloeAt || dist(at, this.lastFloeAt) > 1.1) {
          this.addFloe(at[0], at[2], 1.5);
          this.lastFloeAt = at;
          this.emit({ type: 'freeze', pos: at, amount: 0.3 });
        }
      }
      this.setMode('freeze');
    } else this.lastFloeAt = null;

    // ---- drawing water, holding it
    const wantHold = I.bend || I.swirl || I.wave;
    if (wantHold && this.iceGroup < 0 && !this.holding) {
      const found = this.findSource();
      if (found || st.free > 200) {
        this.holding = true;
        this.geoG = 0;
        this.wasGeo = false;
        this.drawing = !!found;
        this.source = found?.p ?? null;
        this.fromSnow = found?.snow ?? false;
        this.spawned = 0;
        this.heldTarget = this.form === 'octopus' ? this.maxHeld * 0.42 : this.form === 'whip' ? this.maxHeld * 0.38 : this.form === 'orb' ? this.maxHeld * 0.6 : this.maxHeld * 0.2;
        if (I.swirl) this.heldTarget = this.maxHeld * 0.32;
        if (I.wave) this.heldTarget = this.maxHeld;
        if (this.form === 'vortex') this.heldTarget = this.maxHeld * 0.7;
        if (pl.flying) this.heldTarget = Math.min(this.gatherCap, this.maxHeld * 0.5);
        if (found) this.emit({ type: 'draw', pos: found.p, amount: 1, snow: found.snow });
        this.message = '';
      } else if (I.bendHit) {
        this.message = 'No water within reach — get closer to a lake, a creek or the garden\'s pools';
        this.messageT = 2.5;
      }
    }
    if (this.sent && (!this.holding || this.form !== 'vortex')) { this.sent = null; this.sentPh = 0; this.serpSent = -1; }
    if (this.holding) {
      // in flight she keeps gathering: whenever there's water to take and she holds less than she can
      this.regatherT -= dt;
      if (pl.flying && wantHold && !this.drawing && this.regatherT <= 0 && st.held < this.gatherCap * 0.97 && !this.travel) {
        const found = this.findSource();
        if (found) {
          this.drawing = true;
          this.source = found.p;
          this.fromSnow = found.snow;
          this.spawned = st.held;
          this.heldTarget = Math.min(this.gatherCap, st.held + this.maxHeld * 0.35);
          this.emit({ type: 'draw', pos: found.p, amount: 0.6, snow: found.snow });
        }
        this.regatherT = 0.4;
      }
      // keep pulling water up until she holds enough
      if (this.drawing && this.source) {
        // (a source she's flying past is taken where she is: the water beneath her)
        if (pl.flying) {
          const found = this.findSource();
          if (found && found.snow === this.fromSnow) this.source = found.p;
          else if (!found || dist(found.p, this.source) > 30) this.drawing = false;
        }
        const need = this.heldTarget - this.spawned;
        if (this.drawing && need > 0 && wantHold) {
          const rate = (pl.flying ? this.gatherRate : this.fromSnow ? 3200 : 6500) * dt;
          const n = Math.min(Math.ceil(rate), Math.ceil(need));
          const up = norm(add(sub(chest, this.source), [0, 3, 0]));
          this.fluid.req.spawn = { pos: [this.source[0], this.source[1] + 0.05, this.source[2]], radius: this.fromSnow ? 0.9 : 0.45,
            vel: scale(up, this.fromSnow ? 6 : 4.5 + (pl.flying ? 3 : 0)), count: n, snow: this.fromSnow ? 1 : 0 };
          this.spawned += n;
          // the lake gives it up: a funnel pulled down where she draws, ringed with foam
          if (!this.fromSnow) {
            const k = Math.min(1, n / (6500 * dt)) * Math.min(dt * 60, 1);
            this.water.impulse({ x: this.source[0], z: this.source[2], r: 1.1, amount: -0.03 * k, foam: 0.45 * k });
          }
        } else this.drawing = false;
      }
      if (this.travel) this.buildTravel(dt);
      else this.buildPath(dt, chest, fwd, right, I.swirl, I.wave);
      // let go
      const travelDone = !!this.travel && this.travel.t > 2.6;
      let release = travelDone || (!this.travel && ((I.bendUp && !I.swirl && !I.wave) || (!wantHold && !I.waveUp) || (I.waveUp && !I.bend)));
      // (the vortex isn't thrown: it's sent — across to what she aims at, where it spins a while and then falls)
      if (this.sent) {
        this.sent.t += dt;
        release = this.sent.t > this.sent.dur + this.sent.hold;
      } else if (release && !travelDone && !I.waveUp && this.form === 'vortex' && this.vortK > 0.8 && st.held > 1500) {
        const to: V3 = pl.aim.dist < 90 ? [pl.aim.hit[0], pl.aim.hit[1] + 4, pl.aim.hit[2]] : add(chest, scale(ad, 40));
        this.sent = { to, t: 0, dur: 0.9 + dist(pl.pos, to) / 32, hold: 3.4, R: 6 };
        this.emit({ type: 'launch', pos: this.target, amount: 1.6 });
        release = false;
      }
      if (!this.travel && I.waveUp && this.wave > 0.2 && release) {
        // the wave rolls on across the water, keeping its shape, then breaks
        this.travel = { t: 0, c0: [...this.waveC] as V3, fwd: norm([fwd[0], 0, fwd[2]]), right: norm([right[0], 0, right[2]]), h: this.wave };
        this.emit({ type: 'wave', pos: this.target, size: this.wave });
        this.setMode('push');
        this.wave = 0;
      } else if (release) {
        let push: V3;
        if (travelDone) {
          // the rolling wave breaks forward
          push = add(scale(this.travel!.fwd, 5), [0, -1, 0]);
          this.travel = null;
        } else if (this.sent) {
          // the sent vortex falls onto what it spun round
          push = [0, -7, 0];
          this.sent = null;
          this.sentPh = 0; this.serpSent = -1;
        } else {
          const whip = clamp(this.aimSpeed / 6, 0, 1);
          push = add(scale(ad, 15 + 10 * whip), [0, 2.5, 0]);
          if (whip > 0.4) this.emit({ type: 'whip', pos: this.target, speed: 13 + 10 * whip });
          else this.emit({ type: 'launch', pos: this.target, amount: clamp(st.held / 6000, 0.1, 1) });
        }
        this.fluid.req.release = true;
        this.fluid.req.push = { v: push };
        this.holding = false;
        this.drawing = false;
        this.wave = 0;
        this.swirl = 0;
        this.fluid.path = [];
        this.setMode('push');
      }
    } else {
      this.fluid.path = [];
      if (this.iceGroup < 0 && this.pose.mode !== 'push' && this.pose.mode !== 'throw' && this.pose.mode !== 'melt' && !I.walk && this.floeIdx < 0) this.setMode('idle');
      if ((this.pose.mode === 'push' || this.pose.mode === 'throw' || this.pose.mode === 'melt') && this.pose.t > 0.6) this.setMode('idle');
    }
    // (a big vortex held: the camera pulls back and up to take it all in)
    pl.powerView = this.holding && this.form === 'vortex' ? clamp(st.held / 14000, 0.25, 1) : 0;
    // (carrying water in flight she flies on facing her way: the water rides along with her)
    pl.faceAim = (this.holding && (!pl.flying || this.form === 'vortex')) || this.iceGroup >= 0 || ((this.pose.mode === 'push' || this.pose.mode === 'throw') && !pl.flying);

    // ---- the charge: power gathered the longer she holds it — faster the more of it there is, drawn in flight, wound
    // into the vortex or gathered into an orb; spent as she lets go
    if (this.holding && st.held > 50 && this.iceGroup < 0) {
      const amt = clamp(st.held / 8000, 0.15, 1);
      const rate = 0.05 + 0.09 * amt + (this.form === 'vortex' ? 0.07 : this.form === 'orb' ? 0.04 : 0) + (pl.flying && this.drawing ? 0.05 : 0);
      this.charge = Math.min(1, this.charge + rate * dt);
    } else this.charge *= Math.exp(-dt * 1.4);

    // the body: reaching for the water (or the ice), drawing it up while the column rises
    const intensity = this.holding ? 1 : this.iceGroup >= 0 ? 0.8 : 0;
    this.pose.intensity = damp(this.pose.intensity, intensity, 6, dt);
    this.pose.target = this.iceGroup >= 0 ? this.fluid.groups[this.iceGroup].pos : this.target;
    if (this.holding && this.drawing && this.source && this.spawned < this.heldTarget * 0.6 && this.pose.mode === 'hold') this.pose.mode = 'draw';
  }

  /** the water to bend: under the aim or near her (in flight, what she's skimming or a falls beside her), else snow */
  private findSource(): { p: V3; snow: boolean } | null {
    const pl = this.me;
    if (pl.flying) {
      const fs = this.fallsSource?.() ?? null;
      if (fs) return { p: fs, snow: false };
      const wl = this.water.levelAt(pl.pos[0], pl.pos[2]);
      if (wl > -1e9 && pl.pos[1] - wl < (this.form === 'vortex' ? 16 : 9)) return { p: [pl.pos[0] - pl.vel[0] * 0.08, wl, pl.pos[2] - pl.vel[2] * 0.08], snow: false };
    } else {
      const w = pl.aim.onWater && pl.aim.dist < 22 ? pl.aim.hit : this.water.nearest(pl.pos, 14);
      if (w) return { p: w, snow: false };
    }
    const sn = this.snowSource?.() ?? null;
    return sn ? { p: sn, snow: true } : null;
  }

  private addFloe(x: number, z: number, r: number) { return this.water.floes.addFloe(x, z, r, this.water.levelAt(x, z)); }

  /** a sent wave: the same sheet, rolling on over the water at ~7 m/s, its crest curling over, then breaking */
  private buildTravel(dt: number) {
    const tv = this.travel!;
    tv.t += dt;
    this.wasGeo = false;
    const t = this.time;
    const k = tv.t / 2.6;
    const c = add(tv.c0, scale(tv.fwd, 7 * tv.t));
    const amount = clamp(this.fluid.stats.held / 6000, 0.15, 1.6);
    const h = (0.4 + tv.h * 1.5) * Math.min(1.2, Math.sqrt(amount + 0.2)) * (1 - 0.35 * k);
    const pts: { p: V3; r: number; flow: number }[] = [];
    const cols = 10;
    for (let i = 0; i <= cols; i++) {
      const u = i / cols - 0.5;
      const base = add(add(c, scale(tv.right, u * (4.2 + 2 * k))), scale(tv.fwd, -u * u * 1.8));
      const wl = this.water.levelAt(base[0], base[2]);
      const g = Math.max(this.me.ground(base[0], base[2]), wl);
      const taper = 0.2 + 0.8 * Math.cos(u * Math.PI) ** 2;
      const hh = h * taper + Math.sin(t * 2.4 + u * 6) * 0.1;
      const top = add([base[0], g + hh, base[2]], scale(tv.fwd, (0.8 + 0.6 * k) * hh));
      pts.push({ p: [base[0], g + 0.1, base[2]], r: 0.25, flow: 0.4 });
      pts.push({ p: top, r: 0.25, flow: 0.4 });
      if (Math.random() < dt * 10 * taper) this.crest.push(top);
      // it pushes the lake on ahead of it
      if (i % 3 === 1 && wl > -1e9) this.water.impulse({ x: base[0] + tv.fwd[0] * 0.8, z: base[2] + tv.fwd[2] * 0.8, r: 0.7, amount: 0.01 * taper * Math.min(dt * 60, 1), foam: 0.06 * Math.min(dt * 60, 1) });
    }
    this.fluid.pathMode = 3;
    this.fluid.path = pts.map((q, i) => {
      const prev = this.prevPath[i];
      const v: V3 = prev ? sub(scale(sub(q.p, prev), 1 / Math.max(dt, 1e-3)), this.carryV) : scale(tv.fwd, 7);
      return { p: q.p, r: q.r, v, flow: q.flow };
    });
    this.prevPath = pts.map((q) => q.p);
    this.pose.mode = 'push';
  }

  /** the shape the held water follows, rebuilt each frame */
  private buildPath(dt: number, chest: V3, fwd: V3, right: V3, swirl: boolean, rise: boolean) {
    type Pt = { p: V3; r: number; flow: number; brk?: boolean };
    const pts: Pt[] = [];
    this.serpentEyes = null;
    let geoPath = false;
    const t = this.time;
    const st = this.fluid.stats;
    const amount = clamp(st.held / 6000, 0.15, 1.6);
    const handC: V3 = this.hands ? scale(add(this.hands[0], this.hands[1]), 0.5) : add(add(chest, scale(fwd, 0.45)), [0, 0.05, 0]);
    this.swirl = damp(this.swirl, swirl ? 1 : 0, 4, dt);
    this.wave = damp(this.wave, rise ? 1 : 0, 2.5, dt);
    const pl = this.me;
    const surfAt = (x: number, z: number) => Math.max(pl.ground(x, z), this.water.levelAt(x, z));
    const vortexOn = this.form === 'vortex' && this.gatherT <= 0 && this.wave <= 0.05;
    const flyForm = pl.flying && this.form !== 'vortex' && this.wave <= 0.05 && this.swirl <= 0.05 && this.gatherT <= 0;
    // sent, the vortex crosses to its mark — easing out of her hands and in to it — and opens wide round it
    const sentK = this.sent ? smoothstep(0, 1, this.sent.t / this.sent.dur) : 0;
    // the dragon of water: its head swims a rising coil round her, its body after it along the way the head went (by
    // its own clock, the body is where the head was), heavier toward the head, two horns streaming back from its
    // skull, jaws open; sent, it streaks across to the mark — up and over — and coils down round it, then falls
    const serpentPts = (): Pt[] => {
      const av = clamp(st.held / 6000, 0.15, 6);
      const C: V3 = this.sent && this.serpSent >= 0 ? this.serpFrom : pl.pos;
      const R0 = 3.2 + 1.1 * Math.sqrt(av);
      const w0 = 1.05;
      const yb = Math.max(C[1] - 0.5, surfAt(C[0], C[2]) + 1.2);
      if (this.sent && this.serpSent < 0) { this.serpSent = this.serpT; this.serpFrom = [...pl.pos] as V3; }
      const crossing = this.sent ? this.sent.dur : 0;
      this.serpT += dt * (this.sent ? (this.sent.t < crossing ? 2.6 : 1.5) : 1);
      const Ts = (1.1 * Math.PI * 2) / w0;
      const TS = this.serpSent, tc = crossing * 2.6;
      const R1 = this.sent?.R ?? 6;
      const H = (tau: number): V3 => {
        const ring = (q: number): V3 => {
          const a = q * w0;
          const rw = R0 * (1 + 0.16 * Math.sin(a * 3 + 0.4));
          return [C[0] + Math.cos(a) * rw, yb + 1.6 + 1.5 * Math.sin(a * 1.5 + 0.7) + 0.6 * Math.sin(a * 0.5), C[2] + Math.sin(a) * rw];
        };
        if (TS < 0 || tau <= TS) return ring(tau);
        const to = this.sent!.to;
        const p0 = ring(TS);
        if (tau < TS + tc) {
          // across: up and over, a long arc, onto the coil's first turn round the mark
          const u = (tau - TS) / tc, e = u * u * (3 - 2 * u);
          const a1 = Math.atan2(p0[2] - to[2], p0[0] - to[0]);
          const p1: V3 = [to[0] + Math.cos(a1) * R1, to[1] + 3.5, to[2] + Math.sin(a1) * R1];
          const mid: V3 = [(p0[0] + p1[0]) / 2, Math.max(p0[1], p1[1]) + 7, (p0[2] + p1[2]) / 2];
          return lerp3(lerp3(p0, mid, e), lerp3(mid, p1, e), e);
        }
        // round it, coiling down it
        const q = tau - TS - tc;
        const a1 = Math.atan2(p0[2] - to[2], p0[0] - to[0]) + q * 1.7;
        const rr = R1 * (1 - 0.2 * Math.min(q / 8, 1)) * (1 + 0.08 * Math.sin(q * 5));
        return [to[0] + Math.cos(a1) * rr, to[1] + 3.5 - 0.55 * q, to[2] + Math.sin(a1) * rr];
      };
      const out: Pt[] = [];
      const N = 18, NB = 14, segs = NB * (N - 1);
      const body: V3[] = [];
      const bodyPts: Pt[] = [];
      for (let j = 0; j < NB; j++) {
        for (let i = 0; i < N; i++) {
          const x = (j * (N - 1) + i) / segs;
          // (much more of the water toward the neck: thrice the tail's girth there, the tail thinning away)
          const sb = (0.25 * x + x * x) / 1.25;
          const p = H(this.serpT - sb * Ts);
          // (the coil rising toward the head: the tail lower; a slow undulation along it as it swims)
          const sway = Math.sin(sb * 18 - t * 3.2) * 0.35 * Math.min(1, sb * 6);
          p[1] += -sb * 1.8 * (this.sent ? 0.3 : 1) + sway * 0.6;
          const r = (0.3 + 0.03 * av) * (0.3 + 0.7 * Math.sin(Math.PI * Math.min(1, 0.12 + sb * 0.9)));
          body.push(p);
          bodyPts.push({ p, r, flow: 2.5, brk: i === 0 });
        }
      }
      // the head out ahead of the neck: the upper jaw and the lower (open, roaring), either side of the skull
      const n0 = body[0], n1 = body[2];
      const fw = norm(sub(n0, n1));
      const sd = norm(cross(fw, [0, 1, 0])), upv = norm(cross(sd, fw));
      const HL = 2.6 + 0.15 * av, gape = 0.55 + 0.15 * Math.sin(t * 2.3) + (this.sent ? 0.4 : 0);
      for (let jw = 0; jw < 4; jw++) {
        for (let i = 0; i < N; i++) {
          const u = i / (N - 1);
          const bulge = Math.sin(Math.PI * Math.min(1, 0.15 + u * 0.95));
          let p: V3;
          if (jw < 2) {
            const sg = jw ? -1 : 1, open = gape * (1 - u) * (1 - u);
            p = add(add(n0, scale(fw, HL * (1 - u))), scale(upv, sg * open + (jw ? -0.1 : 0.22) * bulge));
          } else {
            const sg = jw === 2 ? -1 : 1;
            p = add(add(n0, scale(fw, HL * (1 - u) * 0.85)), add(scale(sd, sg * 0.3 * bulge), scale(upv, 0.22 * bulge)));
          }
          out.push({ p, r: (jw === 1 ? 0.24 : 0.32) * (0.4 + 0.6 * bulge) * (1 + 0.04 * av), flow: 0.6, brk: i === 0 });
        }
      }
      for (const q of bodyPts) out.push(q);
      // horns from the back of its skull, swept back and up over its neck
      for (let w = 0; w < 2; w++) {
        const sg = w ? 1 : -1;
        for (let i = 0; i < N; i++) {
          const u = i / (N - 1);
          const p = add(add(n0, scale(fw, 0.5 - 2.6 * u)), add(scale(sd, sg * (0.3 + 0.55 * u)), scale(upv, 0.45 + 1.0 * u - 0.5 * u * u + 0.12 * Math.sin(u * 5 - t * 4 + w))));
          out.push({ p, r: 0.09 * (1 - 0.65 * u), flow: 1.2, brk: i === 0 });
        }
      }
      const eye = (sg: number) => add(add(n0, scale(fw, HL * 0.5)), add(scale(sd, sg * 0.5), scale(upv, 0.5)));
      this.serpentEyes = [eye(-1), eye(1)];
      return out;
    };
    // the power move: a double helix of everything she's gathered spinning round her, rising from the water (or
    // ground) below up past her, widening as it climbs; sent, it crosses to its mark and opens wide round it (turning
    // slower as it widens, so the water keeps its speed)
    const vortex = (): Pt[] => {
      if (this.serpent) return serpentPts();
      const av = clamp(st.held / 6000, 0.15, 4.5);
      const C: V3 = this.sent ? lerp3(pl.pos, this.sent.to, sentK) : pl.pos;
      const gb = surfAt(C[0], C[2]);
      const H = Math.max(C[1] + 2.5 + 1.2 * av - gb, 3);
      const R0 = 1.6 + 1.9 * Math.sqrt(av);
      const R = lerp(R0, Math.max(R0, this.sent?.R ?? 0), sentK);
      const spin = 2.6 + 0.4 * av;
      this.sentPh += dt * spin * (R0 / R - 1);
      const out: Pt[] = [];
      for (let j = 0; j < GEO_STRANDS; j++) {
        const half = GEO_STRANDS / 2;
        const arm = j < half ? 0 : 1;
        for (let i = 0; i < 18; i++) {
          const u = ((j % half) * 17 + i) / (half * 17);
          const ang = t * spin + this.sentPh + u * 1.8 * Math.PI * 2 + arm * Math.PI;
          const rr = R * (0.4 + 0.8 * u) * (1 + 0.08 * Math.sin(t * 2 + u * 9 + arm * 2.1));
          out.push({ p: [C[0] + Math.cos(ang) * rr, gb + 0.25 + u * H, C[2] + Math.sin(ang) * rr], r: (0.22 + 0.08 * av) * (0.7 + 0.35 * u) * (1 + 0.6 * sentK), flow: 6, brk: j > 0 && i === 0 });
        }
      }
      return out;
    };
    // in flight she builds what she gathers into sacred geometry, layer on layer, flowing all the while: one stream
    // coils into a halo round her, armillary rings swing out of it, a circle slides out ahead of her, face-on, and a
    // star, a great circle, a crown of six circles bloom out of it; then a second star, a frame ring, two gyroscope
    // rings and a third tilted ring round her. Always twenty strands of 18 points (each particle keeps its place)
    const sacred = (): Pt[] => {
      const v = pl.vel, sp = len(v);
      const ax0: V3 = sp > 2 ? scale(v, 1 / sp) : fwd;
      this.geoAx = norm(add(this.geoAx, scale(sub(ax0, this.geoAx), 1 - Math.exp(-dt * 4))));
      const ax = this.geoAx;
      const side0 = cross(ax, [0, 1, 0]);
      const side: V3 = len(side0) > 0.1 ? norm(side0) : right;
      const up = norm(cross(side, ax));
      const gT = clamp((st.held / Math.max(this.maxHeld * 0.5, 4000)) * 6.5 - 0.5, 0, 6);
      this.geoG += clamp(gT - this.geoG, -dt * 0.8, dt * 0.45);
      const G = this.geoG;
      const sm = (a: number, b: number) => smoothstep(a, b, G);
      const w1 = sm(0.2, 1.0), wA = sm(0.9, 1.7), wB = sm(1.3, 2.1);
      const TAU = Math.PI * 2;
      const breathe = (k: number) => 1 + 0.04 * Math.sin(t * 1.1 + k * 1.7);
      const deep = 1 + Math.min(sp, 60) * 0.01;
      const ring = (c: V3, a: V3, b: V3, rad: number, th: number, k: number): V3 => {
        const rip = 0.06 * Math.sin(3 * th + t * 2.1 + k) * Math.min(1, G);
        return add(add(c, add(scale(a, Math.cos(th) * rad), scale(b, Math.sin(th) * rad))), scale(cross(a, b), rip));
      };
      const tri = (c: V3, a: V3, b: V3, rad: number, th0: number, u: number): V3 => {
        const e = Math.min(Math.floor(u * 3), 2), f = u * 3 - e;
        const at = (j: number): V3 => add(c, add(scale(a, Math.cos(th0 + (j * TAU) / 3) * rad), scale(b, Math.sin(th0 + (j * TAU) / 3) * rad)));
        return lerp3(at(e), at(e + 1), f);
      };
      const R0 = 0.85 + 0.45 * Math.min(amount, 2.2);
      const Lb = 3.5 + 1.8 * Math.min(amount, 2.2) + Math.min(sp, 40) * 0.04;
      const spiral = (u: number): V3 => {
        const q = 1 - u;
        const along = 1.1 - q * (Lb + 1.1);
        const ang = t * 6 + q * 2.6 * TAU;
        const R = R0 * (0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, 0.15 + q * 1.1)));
        return add(add(chest, scale(ax, along)), add(scale(side, Math.cos(ang) * R), scale(up, Math.sin(ang) * R)));
      };
      const rh = 0.95 + 0.05 * G;
      const O = add(chest, scale(up, 0.1));
      const halo = (u: number, ph: number): V3 => lerp3(spiral(u), ring(O, side, up, rh * breathe(1), TAU * u + t * 0.9 + ph, 1), w1);
      const R = 1.2 + 0.28 * G;
      const M = add(add(chest, scale(ax, (3.2 + 0.3 * G) * deep)), scale(up, 1.5 + 0.12 * G));
      const wC = sm(1.8, 2.4), wT = sm(2.4, 3.1), wO = sm(3.1, 3.7);
      const at = (d: number): V3 => add(M, scale(ax, d * deep));
      const core = (u: number, ph: number): V3 => lerp3(halo(u, ph), ring(M, side, up, 0.42 * R * breathe(4), TAU * u + t * 0.5 + ph, 4), wC);
      const star = (u: number, j: number): V3 => {
        const rad = 0.42 * R + (0.82 * R - 0.42 * R) * wT;
        const th0 = (j ? -Math.PI / 2 : Math.PI / 2) + (j ? -1 : 1) * t * 0.22;
        return lerp3(core(u, 1.3 + j), tri(at(0.3 + 0.15 * j), side, up, rad, th0, u), wT);
      };
      const outer = (u: number, ph: number): V3 => lerp3(star(u, 0), ring(at(0.7), side, up, R * breathe(11), TAU * u - t * 0.15 + ph, 11), wO);
      const N = 18;
      const thin = 0.085 + 0.015 * Math.min(amount, 3);
      const strands: { at: (u: number) => V3; r: number }[] = [];
      // 0: the column she draws up from a source, running into the halo (on the halo while she isn't drawing)
      this.feedK = damp(this.feedK, this.drawing && this.source ? 1 : 0, 3, dt);
      const src = this.source;
      const entry = lerp3(spiral(0), sub(O, scale(up, rh)), w1);
      strands.push({ at: (u) => {
        const h = halo(u, Math.PI);
        if (this.feedK < 0.002 || !src) return h;
        const c = add(lerp3(src, entry, u), [Math.sin(t * 5 + u * 6) * 0.12 * (1 - u), 0, Math.cos(t * 4 + u * 5) * 0.12 * (1 - u)]);
        return lerp3(h, c, this.feedK);
      }, r: thin * 1.8 });
      // 1: the halo; 2, 3: the armillary rings swinging out of it
      strands.push({ at: (u) => halo(u, 0), r: thin * 0.75 });
      const aA = wA * (Math.PI / 2 + t * 0.55), aB = wB * (Math.PI / 2 - t * 0.4);
      const sideA = add(scale(side, Math.cos(aA)), scale(ax, Math.sin(aA)));
      const upB = add(scale(up, Math.cos(aB)), scale(ax, Math.sin(aB)));
      strands.push({ at: (u) => lerp3(halo(u, 2.1), ring(O, sideA, up, rh * 1.04 * breathe(2), TAU * u - t * 0.7, 2), wA), r: thin * 0.55 });
      strands.push({ at: (u) => lerp3(halo(u, 4.2), ring(O, side, upB, rh * 1.08 * breathe(3), TAU * u + t * 0.6, 3), wB), r: thin * 0.55 });
      // 4: the core; 5, 6: the star; 7: the great circle; 8-13: the crown of six circles
      strands.push({ at: (u) => core(u, 0), r: thin });
      strands.push({ at: (u) => star(u, 0), r: thin * 0.9 });
      strands.push({ at: (u) => star(u, 1), r: thin * 0.9 });
      strands.push({ at: (u) => outer(u, 0), r: thin });
      for (let k = 0; k < 6; k++) {
        const wk = sm(3.7 + k * 0.12, 4.3 + k * 0.12);
        const phi = (k * Math.PI) / 3 + Math.PI / 6 - t * 0.1;
        const ck = add(at(0.85), add(scale(side, Math.cos(phi) * R), scale(up, Math.sin(phi) * R)));
        const dir = k % 2 ? -1 : 1;
        strands.push({ at: (u) => lerp3(outer(u, 0.5 + k), ring(ck, side, up, 0.3 * R * breathe(5 + k), TAU * u + dir * t * 0.9 + k, 5 + k), wk), r: thin * 0.85 });
      }
      // 14-19: a second star, a frame ring, two gyroscope rings round the mandala, a third ring round her
      const w2 = sm(4.9, 5.5), wF = sm(5.2, 5.8), wG = sm(5.4, 6.0), wH = sm(4.8, 5.3);
      const star2 = (u: number, j: number): V3 => {
        const th0 = (j ? -Math.PI / 2 : Math.PI / 2) + Math.PI / 6 + (j ? 1 : -1) * t * 0.3;
        return lerp3(outer(u, 2 + j), tri(at(1.05), side, up, 1.08 * R, th0, u), w2);
      };
      strands.push({ at: (u) => star2(u, 0), r: thin * 0.8 });
      strands.push({ at: (u) => star2(u, 1), r: thin * 0.8 });
      strands.push({ at: (u) => lerp3(outer(u, 4.4), ring(at(1.35), side, up, 1.48 * R * breathe(17), TAU * u + t * 0.12, 17), wF), r: thin * 0.9 });
      const gA = t * 0.5, gB = -t * 0.38 + 1.1;
      const gsA = add(scale(side, Math.cos(gA)), scale(ax, Math.sin(gA))), guB = add(scale(up, Math.cos(gB)), scale(ax, Math.sin(gB)));
      strands.push({ at: (u) => lerp3(outer(u, 5.1), ring(at(0.6), gsA, up, 1.22 * R * breathe(18), TAU * u + t * 0.8, 18), wG), r: thin * 0.6 });
      strands.push({ at: (u) => lerp3(outer(u, 5.8), ring(at(0.6), side, guB, 1.28 * R * breathe(19), TAU * u - t * 0.7, 19), wG), r: thin * 0.6 });
      const hT = Math.PI / 4 + t * 0.45;
      const hA = add(scale(side, Math.cos(hT)), scale(up, Math.sin(hT))), hB = norm(cross(ax, hA));
      strands.push({ at: (u) => lerp3(halo(u, 5.5), ring(O, hA, add(scale(hB, 0.6), scale(ax, 0.8)), rh * 1.16 * breathe(20), TAU * u + t * 1.1, 20), wH), r: thin * 0.5 });
      const out: Pt[] = [];
      strands.forEach((sd, j) => {
        for (let i = 0; i < N; i++) out.push({ p: sd.at(i / (N - 1)), r: sd.r, flow: 0.4, brk: j > 0 && i === 0 });
      });
      return out;
    };
    if (vortexOn || flyForm) {
      // the one becomes the other: each strand sets off for its place in the new form a moment after the one before,
      // whirling round her the way the vortex turns; from any other form it's there at once
      this.vortK = this.wasGeo ? clamp(this.vortK + (vortexOn ? dt : -dt) / 1.8, 0, 1) : vortexOn ? 1 : 0;
      const S = this.vortK < 1 ? sacred() : null;
      const V = this.vortK > 0 ? vortex() : null;
      if (this.sent) this.setMode('push');
      else this.pose.mode = vortexOn ? 'swirl' : 'hold';
      for (let k = 0; k < GEO_STRANDS * 18; k++) {
        const a = S?.[k], b = V?.[k];
        if (!a || !b) { pts.push((a ?? b)!); continue; }
        const j0 = (0.4 * Math.floor(k / 18)) / (GEO_STRANDS - 1);
        const m = smoothstep(j0, j0 + 0.6, this.vortK);
        const q = lerp3(a.p, b.p, m);
        const sw = Math.sin(Math.PI * m) * 1.4, c = Math.cos(sw), sn = Math.sin(sw);
        const dx = q[0] - pl.pos[0], dz = q[2] - pl.pos[2];
        pts.push({ p: [pl.pos[0] + dx * c - dz * sn, q[1], pl.pos[2] + dx * sn + dz * c], r: lerp(a.r, b.r, m), flow: lerp(a.flow, b.flow, m), brk: a.brk });
      }
      geoPath = true;
      this.fluid.strandLen = 18;
    } else if (this.drawing && this.source && this.spawned < this.heldTarget * 0.6 && this.gatherT <= 0) {
      // the column rising out of the water toward her hands
      const s = this.source;
      const top: V3 = [s[0], Math.max(s[1] + 1.4, chest[1]), s[2]];
      for (let i = 0; i <= 10; i++) {
        const u = i / 10;
        const p = u < 0.62 ? lerp3(s, top, Math.min(u * 1.6, 1)) : lerp3(top, this.target, Math.max(0, u * 1.6 - 0.6));
        pts.push({ p: add(p, [Math.sin(t * 5 + u * 6) * 0.08, 0, Math.cos(t * 4 + u * 5) * 0.08]), r: 0.22 - u * 0.05, flow: 4.5 });
      }
      this.pose.mode = 'hold';
    } else if (this.wave > 0.05 && this.gatherT <= 0) {
      // a wall of water rising in front of her out of the water (never far out: a wall 14 m away reads as nothing),
      // its crest leaning out over its face like a breaking wave
      this.pose.mode = 'wave';
      let ahead = 4.0;
      for (let d = 2; d < 6; d += 0.5) {
        const q = add(pl.pos, scale(fwd, d));
        if (this.water.levelAt(q[0], q[2]) > -1e9) { ahead = d + 1.5; break; }
      }
      const c = add(pl.pos, scale(fwd, ahead + this.wave * 1.2));
      this.waveC = c;
      const h = (0.6 + this.wave * 2.4) * Math.min(1.2, Math.sqrt(amount + 0.2));
      const cols = 10;
      for (let i = 0; i <= cols; i++) {
        const u = i / cols - 0.5;
        const base = add(add(c, scale(right, u * 4.2)), scale(fwd, -u * u * 1.8));
        const g = surfAt(base[0], base[2]);
        const taper = 0.2 + 0.8 * Math.cos(u * Math.PI) ** 2;
        const hh = h * taper + Math.sin(t * 2.4 + u * 6) * 0.1;
        const top = add([base[0], g + hh, base[2]], scale(fwd, (0.25 + 0.55 * this.wave) * hh));
        if (this.wave > 0.6 && Math.random() < dt * 14 * taper) this.crest.push(top);
        pts.push({ p: [base[0], g + 0.1, base[2]], r: 0.25, flow: 0.4 });
        pts.push({ p: top, r: 0.25, flow: 0.4 });
      }
    } else if (this.swirl > 0.05 && this.gatherT <= 0) {
      // a ring round her
      this.pose.mode = 'swirl';
      const R = 1.4 + 0.3 * Math.sin(t * 1.3);
      const c: V3 = add(pl.pos, [0, 1.05 + 0.15 * Math.sin(t * 2.1), 0]);
      const n = 24;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2 + t * 0.6;
        const tilt = 0.18 * Math.sin(a * 2 + t);
        pts.push({ p: [c[0] + Math.cos(a) * R, c[1] + tilt, c[2] + Math.sin(a) * R], r: 0.13 + 0.04 * amount, flow: 7 });
      }
    } else if (this.form === 'orb' || this.gatherT > 0) {
      // an orb floats just out of her hands (freezing gathers any form into one first)
      this.pose.mode = this.gatherT > 0 ? 'freeze' : 'hold';
      const r = clamp(Math.cbrt(((st.held / 4000) * 0.75) / Math.PI), 0.25, 1.1);
      const toAim = sub(this.target, handC);
      const p = add(handC, scale(norm(toAim), Math.min(len(toAim), 0.9 + r * 1.3)));
      this.orbP = p;
      pts.push({ p, r, flow: 2.5 });
    } else if (this.form === 'octopus') {
      // eight arms growing out of a skirt of water round her waist: each leaves the ring sideways, rises, then arches
      // over and down with a slow travelling curl; thick at the root, thin at the tip; the front ones lean at the aim
      this.pose.mode = 'hold';
      const waist = add(pl.pos, [0, 0.95, 0]);
      const toAim = norm(sub([this.target[0], Math.max(this.target[1], waist[1] + 0.4), this.target[2]], waist));
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + 0.2 * Math.sin(t * 0.7);
        const outK = norm(add(scale(right, Math.cos(a)), scale(fwd, Math.sin(a) * 0.85)));
        const front = Math.max(0, dot(outK, fwd));
        const L = 2.3 + 0.5 * Math.sin(k * 2.3) + 0.7 * front;
        const sideK = cross(outK, [0, 1, 0]);
        const ph = t * 1.6 + k * 0.9;
        for (let i = 0; i < 7; i++) {
          const u = i / 6;
          const r0 = 0.32 + u * L * 0.75;
          const up = Math.sin(u * Math.PI * 0.9) * (0.9 + 0.3 * Math.sin(ph)) * L * 0.45 + u * 0.25;
          const curl = Math.sin(u * 3.2 - ph) * 0.35 * u;
          let p = add(add(waist, scale(outK, r0)), [0, up - 0.1 * u * u * L, 0]);
          p = add(p, add(scale(sideK, curl), [0, 0.18 * Math.cos(u * 4 - ph) * u, 0]));
          p = add(p, scale(toAim, u * u * 0.9 * front));
          p[1] = Math.max(p[1], pl.ground(p[0], p[2]) + 0.35 + 0.3 * u);
          pts.push({ p, r: (0.2 * (1 - u * 0.85) + 0.025) * Math.min(1.2, 0.7 + amount * 0.3), flow: 0.8 * Math.sin(u * 5 - t * 3 + k), brk: i === 0 });
        }
      }
    } else {
      // stream / whip: from her hands arcing out to the target, ending in a heavier head; a whip lengthens along the
      // aim and snakes, tapering to a fine lash
      this.pose.mode = 'hold';
      const whipping = this.form === 'whip' || this.aimSpeed > 4;
      if (this.aimSpeed > 4) this.whipT = 0.35;
      this.whipT = Math.max(0, this.whipT - dt);
      let T = this.target;
      if (whipping) T = add(handC, scale(sub(this.target, handC), this.form === 'whip' ? 1.35 : 1 + this.whipT * 2));
      const ctrl: V3 = add(lerp3(handC, T, 0.35), [0, 0.6 + 0.3 * Math.sin(t * 1.7), 0]);
      const n = 16;
      const side = norm(cross(sub(T, handC), [0, 1, 0]));
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        let p = lerp3(lerp3(handC, ctrl, u), lerp3(ctrl, T, u), u);
        const wave = whipping ? Math.sin(u * 6.5 - t * 6.5) * 0.5 * u * u : Math.sin(u * 9 - t * 5) * 0.12 * u * (1 - u * 0.5);
        p = add(p, add(scale(side, wave), [0, Math.cos(u * 5 - t * (whipping ? 5 : 4)) * (whipping ? 0.18 * u : 0.06), 0]));
        const head = u > 0.85 ? 1 : 0;
        const rr = whipping ? (0.13 + 0.05 * amount) * (1 - 0.7 * u) + 0.02 : (0.12 + 0.05 * amount) * (1 + head * 0.35);
        // (no net flow toward the head, it would pool there: a travelling surge runs along it instead)
        pts.push({ p, r: rr, flow: 1.6 * Math.sin(u * 7 - t * 5) + 0.4 });
      }
    }
    // path velocities from the last frame's (the water keeps up with a moving path)
    const column = this.drawing && this.source && this.spawned < this.heldTarget * 0.6;
    this.fluid.pathMode = geoPath ? 4 : this.wave > 0.05 && this.gatherT <= 0 && !column ? 3
      : this.gatherT > 0 || (this.form === 'orb' && this.swirl < 0.05 && this.wave < 0.05 && !column) ? 0
      : this.form === 'octopus' && this.swirl < 0.05 && this.wave < 0.05 ? 2 : 1;
    const path: PathPoint[] = pts.map((q, i) => {
      const prev = this.prevPath[i];
      const v: V3 = prev ? sub(scale(sub(q.p, prev), 1 / Math.max(dt, 1e-3)), this.carryV) : [0, 0, 0];
      const vl = len(v);
      return { p: q.p, r: q.brk ? -q.r : q.r, v: vl > 25 ? scale(v, 25 / vl) : v, flow: q.flow };
    });
    this.prevPath = pts.map((q) => q.p);
    this.fluid.path = path;
    // (the vortex is held more loosely than the lines of the geometry: a spinning column of water, not wire; spun up
    // into it, what she gathered becomes one water within seconds)
    this.wasGeo = geoPath;
    this.fluid.vortex = geoPath ? this.vortK : 0;
    this.fluid.tight = geoPath ? 1 - smoothstep(0.5, 1, this.vortK) : 0;
    this.fluid.merge = geoPath ? 1 + 4 * this.vortK : 1;
  }
}

function normQ(q: Quat): Quat { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; }
