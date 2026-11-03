// Her body in the world (after the waterbending game's player): walking, running and jumping over the terrain and
// through the house (its floors and stairs, its walls, the trunks), wading in the garden's water; and, off her feet, one
// motion carried by its own momentum through the air, along the water's surface and under it — no modes to switch,
// only what her movement says she means:
// - a quick double-press of Jump in open air lifts her into flight: a slow, precise cruise, then a boost (Shift)
//   that winds up to a tearing speed, steered where the camera looks, keeping clear of the ground and the treetops;
// - flown slowly down onto the ground she lands; slow and low over water she settles into it and swims;
// - come down level onto the water at speed and she skims it: the surface holds her up (planing) and drag bleeds the
//   glide away, spray thrown off her; steer up and she lifts off it again. Fast and low over a lake and not asking for
//   a dive, a cushion eases her level into the skim (the user, 2026-10-20: "it's a little too hard to flatten out when
//   I'm going really fast"), less the more she's pushing down, none in a firm dive;
// - come in steeply (or steer down into it) and she goes straight in, her speed and heading kept, the water's drag
//   taking it; pitch up under water and her momentum carries her out through the surface and back into flight;
// - in the water she swims (at the surface and under it), leaps out (Space), and climbs out into flight (a leap held).
// Her facing turns toward where she's going.
import { type V3, add, scale, norm, len, clamp, dot, cross, lerp, smoothstep, rotateAxis, damp, angDiff, ease, unease, throttle, unthrottle } from './math';
import type { HeroWorld } from './world';

/** swimming's moments (for splashes, bubbles and sounds): into deep water, under it, back up, out, bursting out, a stroke */
export type SwimEvent = 'enter' | 'dive' | 'surface' | 'exit' | 'breach' | 'stroke';
/** wading deeper than this she swims; shallower than SWIM_OUT she stands again */
const SWIM_IN = 1.1, SWIM_OUT = 0.9;
/** swimming at the surface her feet hang this far under it (the rig floats her head and shoulders out) */
const FLOAT = 1.32;
/** her body's middle over her feet (the waist, which flight's and swimming's lean turn about): what's in the water */
const CORE = 1.0;
/** skimming: her middle this far over the water (her front just in it); planing holds her up from SKIM_MIN m/s, fully
 *  from SKIM_FULL */
const SKIM_H = 0.12;
const SKIM_MIN = 3.2, SKIM_FULL = 6;
/** going in: a path steeper than this (its descent's tangent, ~25 degrees) or steering down more than DIVE_D */
const STEEP = 0.47, DIVE_D = -0.42;
/** under water, rising faster than this (m/s) she bursts out through the surface rather than coming up to float */
const BREACH_V = 2.8;
/** the cushion's flare: the sink it lets her keep is the height left over this (s), so she rounds out onto the water */
const FLARE = 0.45;
/** How quickly the second Jump press must follow the first to turn a jump into flight. */
const FLY_DOUBLE = 0.45;
/** the highest she flies (m): well up in the sky, still inside the air the atmosphere's tables are made for */
const FLY_CEILING = 20_000;

/** what the player's hands are doing this frame (keys, a stick, the touch controls) */
export interface MoveInput {
  /** the stick: x right, z forward (-1..1) */
  x: number; z: number;
  /** up / down (-1..1): Space (a jump held) and C */
  y: number;
  run: boolean;
  /** this frame: jump pressed; `fly` take off or come down (scripts and films only: no key does it any more) */
  jump: boolean; fly: boolean;
}

export class HeroPlayer {
  pos: V3 = [0, 0, 0];
  vel: V3 = [0, 0, 0];
  /** body facing (0 = toward -z) */
  yaw = 0;
  onGround = true;
  speed = 0;
  running = false;
  wade = 0;
  landImpact = 0;
  jumpT = 0;
  /** the camera's aim (yaw, pitch): what she walks relative to and steers by in flight */
  aimYaw = 0;
  aimPitch = 0;
  /** turn to face the aim (bending) */
  faceAim = false;
  onLand?: (pos: V3, impact: number) => void;
  onJump?: (pos: V3) => void;
  onFly?: (on: boolean) => void;
  // ---- flight
  flying = false;
  /** the body's lean (flight): pitch forward (rad, pi/2 lies level), roll into turns */
  flyPitch = 0;
  flyRoll = 0;
  /** flying on a rail (films): each frame where she is and her velocity (and the boost's look, 0..1), in place of
   *  her own steering; null: her own */
  rail: ((dt: number) => { pos: ArrayLike<number>; vel: ArrayLike<number>; boost?: number }) | null = null;
  /** the boost's wind-up (0..1, eased) */
  boostK = 0;
  private boostT = 0;
  /** ordinary flight's own run-up: seconds of directional input, so takeoff starts at maneuvering speed */
  private cruiseT = 0;
  private climbNeed = 0;
  private diveK = 0;
  private lastYaw = 0;
  /** height over the ground (or the water) under her */
  altitude = 0;
  // ---- the water under her in flight: its level within reach (null: none), and how far she's skimming it (0..1: the
  // surface holding her up, her front in it), how hard she's pressed into it (her speed through it, m/s)
  overWater: number | null = null;
  skim = 0;
  skimSpeed = 0;
  /** (a moment after bursting out of the water she's not taken straight back in) */
  private outT = 0;
  /** (a moment after taking off she's not settled straight back down: Space tapped again low in a jump hovers) */
  private liftT = 0;
  /** seconds left in which another Jump press starts flight */
  private flyTap = 0;
  // ---- swimming: 0 none, 1 at the surface, 2 under; her head's depth; the water's level (null: not in it); speed;
  // the stroke cycle (0..1); a leap out of the water in the air
  swimming: 0 | 1 | 2 = 0;
  swimDepth = 0;
  waterSurface: number | null = null;
  swimSpeed = 0;
  swimPhase = 0;
  leaping = false;
  swim = { surface: 1.7, surfaceSprint: 3.4, under: 2.5, underSprint: 5.5 };
  onSwim?: (e: SwimEvent, pos: V3) => void;
  /** speeds (m/s): walking and running; flight's start, cruise and boost; each acceleration's time (s); turn rate */
  // (the user, 2026-10-20: ordinary flight accelerates from a granular start; boost's former 360 m/s top is 10% higher;
  // 2026-10-29: gentler still the first seconds, math.ts throttle, the cruise a second later)
  tune = { walk: 1.55, run: 5.2, start: 4, cruise: 40, cruiseRamp: 6, boost: 396, boostRamp: 4, decel: 3, turn: 5, jump: 4.7 };
  /** the water's hold on her: skimming, the drag on her glide (m/s² = a + b v²); under water, a plunge's momentum
   *  bled (dv/dt = -k v², over her swimming speed) and how fast she can turn it (rad/s) */
  waterTune = { skimA: 1.1, skimB: 0.0035, plungeK: 0.028, turn: 2.4 };
  /** the cushion over water: flying fast and low over a lake, not asking for a dive, she's eased level into a skim.
   *  From `speed` (m/s), full at a third faster; within `height` m of the surface at 20 m/s (more the faster, and at
   *  least 0.6 s of her sinking: more warning);
   *  less the more she's steering down, none at `diveAngle` degrees down (aimed, or a path already that steep) or with
   *  down held (C, the pad's B, Sink): a held dive goes in as ever; `strength` 0 turns it off. It only ever lifts */
  cushion = { height: 4, strength: 1, diveAngle: 32, speed: 15 };
  /** the cushion of air over land (m): flying at speed (past a jog), come down to it and the look-ahead keeps her about
   *  this high over the ground ahead, skimming along at it rather than sinking lower (flying lower already, she's held
   *  where she is, not lifted); slow (coming in to land) it fades away, and down held (C, the pad's B, Sink) takes her
   *  under it. A boost used to lift her 25 m and more clear, which kept her from getting
   *  low; then 3 m, at a boost only (the user, 2026-10-25: "let's move that up to ten meters ... that padding or buffer
   *  that keeps you skimming around that level") */
  clearance = 10;
  /** (the cushion's hold this frame, 0..1: the tests read it) */
  cushionK = 0;

  constructor(private world: HeroWorld) {}

  place(p: V3, yaw: number) {
    this.pos = [p[0], this.world.bodyGround(p[0], p[2], p[1] + 0.3), p[2]];
    this.vel = [0, 0, 0];
    this.yaw = yaw;
    this.lastYaw = yaw;
    this.onGround = true;
    this.skim = 0;
    this.flyTap = 0;
    if (this.flying) this.setFlying(false);
  }

  /** in the air already at `p` (feet), moving at `vel` (m/s): flying on from there (first person's free flight, become
   *  one of the cast) — the throttle and the boost wound to that speed, so it carries on and eases as it would have
   *  (no take-off hop); indoors, or not able to fly, she just falls from there */
  flyAt(p: V3, yaw: number, vel: V3) {
    this.pos = [p[0], p[1], p[2]];
    this.yaw = yaw;
    this.lastYaw = yaw;
    this.onGround = false;
    this.skim = 0;
    this.flyTap = 0;
    this.setFlying(true);
    this.vel = [vel[0], vel[1], vel[2]];
    if (!this.flying) return;
    this.liftT = 0;
    // (the wind-ups, each as far along as this speed)
    const F = this.tune, s = len(vel);
    this.cruiseT = unthrottle(clamp((s - F.start) / Math.max(F.cruise - F.start, 1e-3), 0, 1)) * F.cruiseRamp;
    this.boostT = unease(clamp((s - F.cruise) / Math.max(F.boost - F.cruise, 1e-3), 0, 1));
    this.boostK = ease(this.boostT);
  }

  /** whoever's body this is can take to the air (the whole cast does: hero/katara.ts) */
  canFly = true;
  /** a jump's double-press window is open: the next Jump takes off (input/modes.ts: the pad's A is Jump alone then) */
  get flyPending() { return this.flyTap > 0 && !this.flying; }

  /** Flight belongs outside: anywhere but in a room, a garage or a stairwell. On a terrace under a deck she still takes
   *  off (the ceiling keeps her under it until she's out from beneath). */
  private outdoors() { return !this.world.indoors(this.pos[0], this.pos[2], this.pos[1]); }

  setFlying(on: boolean) {
    if (on === this.flying || (on && (!this.canFly || !this.outdoors()))) return;
    this.flying = on;
    this.flyTap = 0;
    this.cruiseT = 0;
    if (on) {
      this.onGround = false;
      this.leaping = false;
      // out of the water: a burst up through the surface
      if (this.swimming) { this.vel[1] = Math.max(this.vel[1], 6); this.outT = 0.6; this.leaveWater(true); }
      else this.vel[1] = Math.max(this.vel[1], 3.5);
      this.liftT = 0.6;
    } else { this.boostT = 0; this.boostK = 0; this.skim = 0; this.overWater = null; }
    this.onFly?.(on);
  }

  /** the pose the rig takes for the water (rig.ts swim): 1 at the surface, 2 under, 3 streamlined (a leap, or shooting
   *  through the water fast after a plunge), 0 out of it */
  get swimPose(): number {
    if (this.leaping) return 3;
    if (this.swimming === 2 && len(this.vel) > 3.6) return 3;
    return this.swimming;
  }

  // ---------------------------------------------------------------- water states
  private enterWater(level: number, under: boolean) {
    this.swimming = under ? 2 : 1;
    // (the stoop's gain is the air's: gone in the water)
    this.diveK = 0;
    this.waterSurface = level;
    this.onGround = false;
    this.leaping = false;
    this.wade = 0;
    this.skim = 0;
    this.onSwim?.('enter', this.pos);
    if (under) this.onSwim?.('dive', this.pos);
  }
  private leaveWater(breach: boolean) {
    if (breach) this.onSwim?.('breach', this.pos);
    this.swimming = 0;
    this.waterSurface = null;
    this.swimDepth = 0;
    this.swimSpeed = 0;
    this.onSwim?.('exit', this.pos);
  }

  update(dt: number, inp: MoveInput) {
    if (inp.fly) this.setFlying(!this.flying);
    this.outT = Math.max(0, this.outT - dt);
    this.liftT = Math.max(0, this.liftT - dt);
    this.flyTap = Math.max(0, this.flyTap - dt);
    const outdoors = this.outdoors();
    // Flight doesn't carry on into a room. She drops back to the ordinary jump/fall there.
    if (this.flying && !outdoors) this.setFlying(false);
    // A quick second press turns a jump (or an airborne first tap) into flight. A held first press produces only one
    // `jump` edge, so it cannot accidentally take off.
    if (!this.flying && !this.onGround && !this.swimming && this.canFly && outdoors && inp.jump) {
      if (this.flyTap > 0) this.setFlying(true);
      else this.flyTap = FLY_DOUBLE;
    }
    if (this.flying) { this.updateFlight(dt, inp); return; }
    if (this.swimming) { this.updateSwim(dt, inp); return; }
    const W = this.world;
    const cy = Math.cos(this.aimYaw), sy = Math.sin(this.aimYaw);
    // (the stick relative to the camera: forward is where it looks)
    let dir: V3 = [inp.x * cy - inp.z * sy, 0, -inp.x * sy - inp.z * cy];
    const dl = len(dir);
    if (dl > 1) dir = scale(dir, 1 / dl);
    this.running = inp.run && dl > 0.1;
    const ground = W.bodyGround(this.pos[0], this.pos[2], this.pos[1] + 0.3);
    const wl = W.waterLevel(this.pos[0], this.pos[2]);
    this.wade = this.onGround && wl !== null ? Math.max(0, wl - ground) : 0;
    const wadeSlow = clamp(1 - this.wade * 0.6, 0.35, 1);
    const maxSp = (this.running ? this.tune.run : this.tune.walk) * wadeSlow;
    const target: V3 = scale(dir, maxSp * Math.min(1, dl));
    // (picking up speed over half a second, slowing a little quicker; in the air hardly any control)
    const acc = this.onGround ? (dl > 0.1 ? (this.running ? 4.5 : 6) : 8) : 1.5;
    this.vel[0] = damp(this.vel[0], target[0], acc, dt);
    this.vel[2] = damp(this.vel[2], target[2], acc, dt);
    this.speed = Math.hypot(this.vel[0], this.vel[2]);
    // facing: toward where she's going (or the aim while bending); slower turns at speed
    let wantYaw = this.yaw;
    if (this.faceAim) wantYaw = this.aimYaw;
    else if (this.speed > 0.25) wantYaw = Math.atan2(-this.vel[0], -this.vel[2]);
    const turnRate = this.faceAim ? 10 : lerp(9, 5, smoothstep(2, 5, this.speed));
    this.yaw += angDiff(this.yaw, wantYaw) * (1 - Math.exp(-dt * turnRate));
    this.lastYaw = this.yaw;
    // (leaping out of the water her body follows the arc, nose first; otherwise upright)
    if (this.leaping) this.flyPitch = damp(this.flyPitch, clamp(Math.PI / 2 - Math.atan2(this.vel[1], Math.max(this.speed, 0.5)), 0.2, 2.6), 6, dt);
    else this.flyPitch = damp(this.flyPitch, 0, 5, dt);
    this.flyRoll = damp(this.flyRoll, 0, 5, dt);
    if (this.onGround && inp.jump) {
      this.vel[1] = this.wade > 0.5 ? 3.2 : this.tune.jump;
      this.onGround = false;
      if (outdoors) this.flyTap = FLY_DOUBLE;
      this.jumpT = 0;
      this.onJump?.(this.pos);
    }
    if (!this.onGround) this.vel[1] -= 12.5 * dt;
    let np: V3 = add(this.pos, scale(this.vel, dt));
    // walls and trunks
    np = W.move(this.pos, np);
    // no walking up cliffs (small steps — a rock, a stair — are fine)
    const g0 = ground, g1 = W.bodyGround(np[0], np[2], this.pos[1] + 0.3);
    const run = Math.hypot(np[0] - this.pos[0], np[2] - this.pos[2]);
    if (this.onGround && g1 - g0 > 0.35 && (g1 - g0) / Math.max(run, 1e-4) > 1.6) {
      np[0] = this.pos[0]; np[2] = this.pos[2]; this.vel[0] *= 0.2; this.vel[2] *= 0.2;
    }
    let gh = W.bodyGround(np[0], np[2], np[1] + 0.3);
    // (never up through a slab: a floor above the ceiling over her is the storey above, not a step onto it)
    const c0 = W.ceilingAt(this.pos[0], this.pos[2], this.pos[1]);
    if (c0 !== null && gh > c0) gh = W.bodyGround(np[0], np[2], Math.min(np[1], this.pos[1]) - 0.45);
    // falling, the way down swept from where she was: a roof, a deck or a floor passed between this frame and the last
    // (a fast fall after flight covers metres a frame) is where she lands — in steps along her path, each asking at
    // the top of its stretch
    if (!this.onGround && np[1] < this.pos[1]) {
      const n = Math.min(32, Math.max(1, Math.ceil(Math.hypot(np[0] - this.pos[0], np[2] - this.pos[2]) / 0.4)));
      for (let k = 1; k <= n; k++) {
        const u = k / n, x = lerp(this.pos[0], np[0], u), z = lerp(this.pos[2], np[2], u);
        const g = W.bodyGround(x, z, lerp(this.pos[1], np[1], (k - 1) / n) + 0.3);
        if (lerp(this.pos[1], np[1], u) <= g) { np = [x, np[1], z]; gh = g; break; }
      }
    }
    // into deep water: wading in she starts to swim; falling (or leaping) in, she goes under with her momentum
    const wl1 = W.waterLevel(np[0], np[2]);
    if (wl1 !== null && wl1 - gh > SWIM_IN && (this.onGround || (np[1] < wl1 - 0.5 && this.vel[1] < 0))) {
      this.pos = np;
      const deep = !this.onGround && this.vel[1] < -4.5;
      if (!deep) this.vel[1] *= 0.3;
      this.enterWater(wl1, deep);
      return;
    }
    if (this.onGround) {
      // stick to the ground (smoothly over bumps), unless it drops away under her
      if (np[1] - gh > 0.35 && this.vel[1] <= 0) this.onGround = false;
      else { np[1] = gh; this.vel[1] = 0; }
    } else if (np[1] <= gh) {
      np[1] = gh;
      this.landImpact = -this.vel[1];
      this.vel[1] = 0;
      this.onGround = true;
      this.leaping = false;
      this.flyTap = 0;
      this.onLand?.(np, this.landImpact);
    }
    // a jump indoors stops at the ceiling
    const ceil = W.ceilingAt(np[0], np[2], this.pos[1]);
    if (ceil !== null && np[1] + 1.75 > ceil) { np[1] = Math.max(gh, ceil - 1.75); this.vel[1] = Math.min(this.vel[1], 0); }
    this.jumpT += dt;
    this.altitude = np[1] - gh;
    this.pos = np;
  }

  // ---------------------------------------------------------------- flight
  private updateFlight(dt: number, inp: MoveInput) {
    const F = this.tune, W = this.world;
    const mx = inp.x, mz = -inp.z, my = inp.y;
    this.running = inp.run;
    // the boost: winding up over seconds, along where she's steering — or along the camera's aim
    const boosting = this.running && !this.faceAim;
    this.boostT = clamp(this.boostT + (boosting ? dt / Math.max(F.boostRamp, 0.1) : -dt / Math.max(F.decel, 0.1)), 0, 1);
    this.boostK = ease(this.boostT);
    // (on a rail — a film's: where she is and how fast come from it; she's posed from them as ever)
    if (this.rail) {
      const r = this.rail(dt);
      this.vel = [r.vel[0], r.vel[1], r.vel[2]];
      if (r.boost !== undefined) this.boostK = r.boost;
      this.flightPose(dt);
      this.pos = [r.pos[0], r.pos[1], r.pos[2]];
      this.altitude = this.pos[1] - W.terrain.heightAt(this.pos[0], this.pos[2]);
      this.skim = 0; this.overWater = null;
      this.jumpT += dt;
      return;
    }
    const cp = Math.cos(this.aimPitch), sp = Math.sin(this.aimPitch);
    const f3: V3 = [-Math.sin(this.aimYaw) * cp, sp, -Math.cos(this.aimYaw) * cp];
    const r3: V3 = [Math.cos(this.aimYaw), 0, -Math.sin(this.aimYaw)];
    let dir: V3 = add(add(scale(f3, -mz), scale(r3, mx)), [0, my, 0]);
    if (boosting && len(dir) < 0.1) dir = [...f3];
    let dl = len(dir);
    if (dl > 1) { dir = scale(dir, 1 / dl); dl = 1; }
    // Normal flight has a throttle of its own: a fresh directional press starts at a jogging pace, stays near it a couple
    // of seconds (a hop from place to place) and takes six to reach cruise. Letting the stick rest winds that throttle
    // back down, preserving fine movement later.
    this.cruiseT = clamp(this.cruiseT + (dl > 0.1 && !boosting ? dt : -dt * 1.5), 0, F.cruiseRamp);
    const cruiseK = throttle(this.cruiseT / Math.max(F.cruiseRamp, 0.1));
    const normal = lerp(F.start, F.cruise, cruiseK);
    const sp0 = len(this.vel);
    const v0: V3 = [...this.vel];
    const D: V3 = dl > 0.1 ? scale(dir, 1 / dl) : sp0 > 0.5 ? scale(this.vel, 1 / sp0) : [0, 0, 0];
    // ---- the water under her (where she is now): its level, whether it's deep enough to go into
    const g0 = W.groundAt(this.pos[0], this.pos[2], this.pos[1]);
    const wl0 = W.waterLevel(this.pos[0], this.pos[2]);
    const open = wl0 !== null && wl0 > g0 + 0.05 ? wl0 : null;
    const deep = open !== null && open - g0 > SWIM_IN;
    // the cushion over water: fast and low over a lake and not asking for a dive, she's eased level into a skim — her
    // steering lifted toward level here, her path pulled out of its descent below (her speed kept). Less the more she's
    // steering down, none in a firm dive (aimed steeply, down held, or a path already that steep): what she asks wins
    const hs0 = Math.hypot(v0[0], v0[2]);
    // (what she's steering at before the cushion lifts it: whether she's aiming to go in)
    const aimY = D[1];
    let cush = 0;
    if (deep && open !== null && this.outT <= 0 && v0[1] < 0.5 && !this.faceAim) {
      const C = this.cushion, dive = (C.diveAngle * Math.PI) / 180;
      const h = this.pos[1] + CORE - open - SKIM_H;
      // (the warning: the height at 20 m/s, more the faster, and never under 0.6 s of her sinking)
      const H = Math.max(C.height * clamp(sp0 / 20, 0.75, 3), -v0[1] * 0.6);
      const path = Math.atan2(-v0[1], Math.max(hs0, 1e-3));
      const aimDown = dl > 0.1 ? Math.asin(clamp(-D[1], -1, 1)) : path;
      cush = clamp(C.strength, 0, 1)
        * smoothstep(C.speed, C.speed * 1.33, sp0)
        * (1 - smoothstep(H * 0.45, H, h))
        * (1 - smoothstep(dive * 0.2, dive, aimDown))
        * (1 - smoothstep(dive * 0.85, dive * 1.15, path))
        * (1 - smoothstep(0.1, 0.5, -my));
      // (her steering no steeper than the flare's path from here: down onto the water, level as she reaches it)
      const flareY = clamp(-(Math.max(h, 0) + 0.15) / (FLARE * Math.max(sp0, 1)), -1, 0);
      if (cush > 0 && dl > 0.1 && D[1] < flareY) {
        const ny = lerp(D[1], flareY, cush), h2 = Math.hypot(D[0], D[2]), nh = Math.sqrt(1 - ny * ny);
        if (h2 > 1e-4) { D[0] *= nh / h2; D[2] *= nh / h2; D[1] = ny; }
      }
    }
    this.cushionK = cush;
    const base = this.faceAim ? Math.min(10, normal) : normal;
    // diving, gravity adds to the speed (a falcon's stoop); pulling out it bleeds back off
    const steep = dl > 0.1 ? smoothstep(0.25, 0.85, -D[1]) * (1 - this.boostK) : 0;
    this.diveK = damp(this.diveK, steep, steep > this.diveK ? 1.6 : 0.6, dt);
    let S = lerp(base * Math.min(dl / 0.999, 1) * (1 + 0.9 * this.diveK), F.boost, this.boostK);
    // sinking (down held, the stick let go): once she's coming down, steadily, slower as the ground (or the water) nears —
    // down onto the ground she lands, onto water she goes in gently (still rising, she's turned round as hard as ever)
    if (my < -0.3 && Math.hypot(mx, mz) < 0.2 && !boosting && this.vel[1] < 0) {
      const below = Math.max(W.groundAt(this.pos[0], this.pos[2], this.pos[1]), W.waterLevel(this.pos[0], this.pos[2]) ?? -1e9);
      S = Math.min(S, 4 + 0.45 * Math.max(0, this.pos[1] - below));
    }
    // at speed, look ahead along the path for rising ground: never slam into a hillside, clear of the trees. Deep water
    // is no obstacle — she can go into it — so over a lake the look-ahead sees nothing to climb over (nor the extra
    // cushion of air she keeps over land, `clearance`: she can come down to the water at any speed)
    if (sp0 <= 6) this.climbNeed = this.vel[1];
    else {
      const extra = Math.max(0, sp0 - 12) * 0.015 + Math.max(0, sp0 - F.cruise) * 0.1 + 25 * smoothstep(F.cruise * 1.67, F.cruise * 3, sp0);
      // (the cushion: all of `clearance` from a run's pace up, holding her from sinking under it — though never lifting her
      // to it from lower, where C took her or she flew low: there it keeps her at the height she's at; down held, only
      // what the speed itself asks, up to 3 m)
      const low = Math.min(0.5 + extra, 3), alt = this.pos[1] - W.terrain.heightAt(this.pos[0], this.pos[2]);
      const pad = Math.min(my < -0.3 ? low : Math.max(low, Math.min(this.clearance * smoothstep(8, 16, sp0), alt)), this.clearance);
      let need = -Infinity;
      for (const t of [0.12, 0.25, 0.45, 0.7, 1.0, 1.5]) {
        const q = add(this.pos, scale(this.vel, t));
        const qg = W.terrain.heightAt(q[0], q[2]);
        const ql = W.waterLevel(q[0], q[2]);
        if (ql !== null && ql - qg > SWIM_IN) continue;
        need = Math.max(need, (qg + pad - this.pos[1]) / t);
      }
      if (need === -Infinity) need = Math.min(this.vel[1], 0) - 60;
      this.climbNeed = damp(this.climbNeed, need, need > this.climbNeed ? 7 : 2.5, dt);
      const w = smoothstep(6, 14, sp0), Sv = Math.max(S, sp0, 1);
      const dy = clamp(this.climbNeed / Sv, -1, 0.95);
      if (dl > 0.1 && dy > D[1]) {
        const ny = lerp(D[1], dy, w), h = Math.hypot(D[0], D[2]), nh = Math.sqrt(1 - ny * ny);
        if (h > 1e-4) { D[0] *= nh / h; D[2] *= nh / h; D[1] = ny; }
      }
    }
    // glide: slow to build up, slow to bleed off; hover with a gentle bob when there's no input (at a hop's pace the stick
    // let go stops her sooner, so a short hop ends where it's aimed)
    const acc = (dl > 0.1 ? 2.2 : lerp(3.2, 1.6, smoothstep(8, 20, sp0))) + 2.4 * steep;
    const vLow: V3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) vLow[i] = damp(this.vel[i], D[i] * S, acc, dt);
    // fast, she keeps her speed and her heading turns at a limited rate
    const hi = smoothstep(F.cruise * 1.05, F.cruise * 2.3, sp0);
    if (hi > 0 && sp0 > 0.5) {
      const d0 = scale(this.vel, 1 / sp0);
      const want = S > 0.5 && dl > 0.1 ? D : d0;
      const ang = Math.acos(clamp(dot(d0, want), -1, 1));
      let d1 = d0;
      const ax = cross(d0, want), al = len(ax);
      if (ang > 1e-4 && al > 1e-6) d1 = rotateAxis(d0, scale(ax, 1 / al), ang * (1 - Math.exp(-dt * F.turn / (1 + sp0 / (F.cruise * 3)))));
      const s1 = damp(sp0, S, S > sp0 ? 2.2 : 1.6, dt);
      for (let i = 0; i < 3; i++) this.vel[i] = lerp(vLow[i], d1[i] * s1, hi);
    } else this.vel = vLow;
    if (dl < 0.1) this.vel[1] += Math.sin(this.jumpT * 1.7) * 0.15 * dt;
    // (the cushion's flare: sinking faster than the height left allows, her path is turned up toward the flare's, her
    // speed kept — eased in, quicker the more it holds — so she rounds out onto the water and skims; never down)
    if (cush > 0 && open !== null && this.vel[1] < 0) {
      const s = len(this.vel), hs = Math.hypot(this.vel[0], this.vel[2]);
      const h = Math.max(this.pos[1] + CORE - open - SKIM_H, 0);
      const vyT = -(h + 0.15) / FLARE;
      if (this.vel[1] < vyT && hs > 1e-3 && s > 1e-3) {
        const th = Math.atan2(this.vel[1], hs), thT = Math.asin(clamp(vyT / s, -1, 0));
        const th1 = th + (thT - th) * (1 - Math.exp(-dt * 6 * cush)), k = (s * Math.cos(th1)) / hs;
        this.vel[0] *= k; this.vel[2] *= k; this.vel[1] = s * Math.sin(th1);
      }
    }
    this.overWater = open !== null && this.pos[1] - open < 14 ? open : null;
    // going in: coming in steeply, or steering (or pressing) down into it — the cushion's hold moving both toward its
    // dive angle: a path a little steeper touches down into a skim, a steering a little further down still skims
    const diveC = (this.cushion.diveAngle * Math.PI) / 180;
    // (only ever toward letting her skim: a dive angle set under the plain thresholds doesn't make it easier to go in)
    const steepT = lerp(STEEP, Math.max(STEEP, Math.tan(diveC) * 0.95), cush), aimT = lerp(DIVE_D, Math.min(DIVE_D, -Math.sin(diveC)), cush);
    const plunge = deep && this.outT <= 0 && (-v0[1] / Math.max(hs0, 0.1) > steepT || (dl > 0.1 && aimY < aimT) || my < -0.3);
    // skimming: come down level onto the water at speed and the surface holds her up — her middle kept just over it
    // (a stiff spring that only ever pushes up), the steering's gentle downward pull taken out (steering level-ish is
    // skimming; steering up she lifts off it) — and drag bleeds the glide away: her own flight adds no speed while she's
    // on the water, only the boost does
    let skimK = 0, planing = false;
    if (open !== null && !plunge) {
      const hc = this.pos[1] + CORE - open;
      const plane = smoothstep(SKIM_MIN, SKIM_FULL, hs0);
      // (rising away from it isn't skimming: bursting out, lifting off)
      const contact = (1 - smoothstep(SKIM_H, SKIM_H + 0.32, hc)) * (1 - smoothstep(1.5, 4, v0[1]));
      skimK = plane * contact;
      // (coming down onto it her sink is eased off over the last metre: she touches down on it, a seaplane's landing,
      // rather than punching through)
      if (plane > 0 && hc < SKIM_H + 0.9) {
        const vyS = (SKIM_H - hc) * 9;
        if (this.vel[1] < vyS) this.vel[1] = damp(this.vel[1], vyS, 24 * plane, dt);
      }
      planing = plane > 0.35;
      if (skimK > 0.01) {
        const T = this.waterTune;
        const hsC = Math.hypot(this.vel[0], this.vel[2]);
        const drag = (T.skimA + T.skimB * hs0 * hs0) * skimK;
        let hs1 = Math.max(hs0 - drag * dt, 0);
        // (the boost drives her on along the water: a hydroplane's rooster tail)
        hs1 = boosting ? Math.max(hs1, Math.min(hsC, hs0 + 30 * this.boostK * dt) - drag * dt) : Math.min(hs1, hsC);
        const dx = hsC > 0.5 ? this.vel[0] / hsC : hs0 > 1e-3 ? v0[0] / hs0 : 0, dz = hsC > 0.5 ? this.vel[2] / hsC : hs0 > 1e-3 ? v0[2] / hs0 : 0;
        this.vel[0] = lerp(this.vel[0], dx * hs1, skimK);
        this.vel[2] = lerp(this.vel[2], dz * hs1, skimK);
      }
    }
    this.skim = damp(this.skim, skimK, skimK > this.skim ? 12 : 6, dt);
    this.skimSpeed = Math.hypot(this.vel[0], this.vel[2]);
    // slow and low with nothing asked of her (nor bending), she comes down: onto the ground she lands, onto water she
    // settles into it
    const low = this.pos[1] - Math.max(g0, open ?? -1e9);
    const settling = low < 1.1 && len(this.vel) < 3.5 && my <= 0 && dl < 0.1 && !this.faceAim && this.liftT <= 0;
    if (settling) this.vel[1] = Math.min(this.vel[1], -1.8);
    this.flightPose(dt);
    let np: V3 = add(this.pos, scale(this.vel, dt));
    np = W.move(this.pos, np, 0.3);
    // (coming down, the ground asked from where she was: a roof passed this frame is still under her)
    const g = W.groundAt(np[0], np[2], Math.max(np[1], this.pos[1]));
    // (backstop: if the limited turn hasn't lifted her heading enough, lift it here — redirected, the speed kept)
    const sp1 = len(this.vel);
    if (sp1 > 6 && this.climbNeed > this.vel[1]) {
      const vy = lerp(this.vel[1], this.climbNeed, smoothstep(6, 14, sp1) * (1 - Math.exp(-dt * 6)));
      // (a path mostly along the ground pulls out of its dive keeping its speed; one straight down just slows — its speed
      // never turned into a dash along the ground)
      const h = Math.hypot(this.vel[0], this.vel[2]), nh = Math.sqrt(Math.max(sp1 * sp1 - vy * vy, 0.25 * h * h));
      if (h > 0.25 * sp1) { this.vel[0] *= nh / h; this.vel[2] *= nh / h; }
      this.vel[1] = vy;
    }
    const wl = W.waterLevel(np[0], np[2]);
    const deepHere = wl !== null && wl - g > SWIM_IN;
    // (planing, the water is a floor under her: her front in it, no further)
    if (planing && wl !== null && np[1] < wl - CORE + SKIM_H - 0.1) { np[1] = wl - CORE + SKIM_H - 0.1; this.vel[1] = Math.max(this.vel[1], 0); }
    // into the water: her middle gone under the surface (deep enough to swim), her momentum carried in
    if (deepHere && np[1] + CORE < wl - 0.08 && this.outT <= 0) {
      this.pos = np;
      const v = len(this.vel);
      this.flying = false;
      this.boostT = 0; this.boostK = 0;
      this.skim = 0; this.overWater = null;
      this.enterWater(wl, v > 3.2 || my < -0.3);
      return;
    }
    // the ground (and shallow water's bed) is a floor; deep water isn't (she skims it or goes in)
    const floor = deepHere ? -1e9 : g + 0.5;
    if (np[1] < floor) { np[1] = Math.max(np[1] + (floor - np[1]) * (1 - Math.exp(-dt * 10)), g + 0.02); if (this.vel[1] < 0) this.vel[1] *= 0.3; }
    // (the ceiling over her where she is, not over the ground below: flying off a deck over the storey under it, that
    // storey's ceiling is beneath her, and she flies on over it, never pulled down under it)
    const ceil = W.ceilingAt(np[0], np[2], Math.max(g, this.pos[1]));
    if (ceil !== null && np[1] + 1.8 > ceil) { np[1] = Math.max(g, ceil - 1.8); this.vel[1] = Math.min(this.vel[1], 0); }
    if (np[1] > FLY_CEILING) { np[1] = FLY_CEILING; this.vel[1] = Math.min(this.vel[1], 0); }
    this.altitude = np[1] - Math.max(g, wl ?? -1e9);
    // land: coming down onto the ground slowly (not onto water: she goes into that). Settling counts however the floor
    // above has eased her sink: below its half metre that leaves -0.54 m/s, and she hung there, flying, for good
    if (!deepHere && np[1] - g < 0.62 && (my < 0 || settling || this.vel[1] < -1.5) && this.speed < 6) {
      np[1] = g;
      this.setFlying(false);
      this.onGround = true;
      this.landImpact = Math.max(-this.vel[1], 1);
      this.vel[1] = 0;
      this.onLand?.(np, this.landImpact);
    }
    this.wade = 0;
    this.jumpT += dt;
    this.pos = np;
  }

  /** in flight: her facing from her way, the body's lean along her path and into her turns */
  private flightPose(dt: number) {
    this.speed = Math.hypot(this.vel[0], this.vel[2]);
    let wantYaw = this.yaw;
    if (this.faceAim) wantYaw = this.aimYaw;
    else if (this.speed > 0.6) wantYaw = Math.atan2(-this.vel[0], -this.vel[2]);
    this.yaw += angDiff(this.yaw, wantYaw) * (1 - Math.exp(-dt * 5));
    // the body's lean: upright hovering, lying along the path at speed, banked into turns
    const yawRate = angDiff(this.lastYaw, this.yaw) / Math.max(dt, 1e-3);
    this.lastYaw = this.yaw;
    const fwdSpeed = this.vel[0] * -Math.sin(this.yaw) + this.vel[2] * -Math.cos(this.yaw);
    const along = smoothstep(1.5, 9, fwdSpeed);
    const level = 1.36 + 0.16 * smoothstep(12, 24, fwdSpeed);
    const path = Math.atan2(this.vel[1], Math.max(fwdSpeed, 0.1));
    let wantPitch = along * clamp(level - path * (path > 0 ? 0.95 : 1.05), 0.15, 2.5) + (1 - along) * 0.05 + Math.min(fwdSpeed, 0) * 0.03;
    // (skimming she lies flat along the water, her front in it)
    wantPitch = lerp(wantPitch, Math.max(wantPitch, 1.5), this.skim);
    if (this.faceAim) wantPitch *= 0.3;
    this.flyPitch = damp(this.flyPitch, wantPitch, 3.2, dt);
    // (on the water the turns are carved: she leans into them harder)
    this.flyRoll = damp(this.flyRoll, clamp(-yawRate * Math.min(this.speed, 40) * (0.05 + 0.03 * this.skim), -0.7 - 0.2 * this.skim, 0.7 + 0.2 * this.skim), 3.5, dt);
  }

  // ---------------------------------------------------------------- the water
  private updateSwim(dt: number, inp: MoveInput) {
    const S = this.swim, W = this.world, T = this.waterTune;
    const mx = inp.x, mz = -inp.z, my = inp.y;
    this.running = inp.run;
    const level = W.waterLevel(this.pos[0], this.pos[2]);
    const g = W.groundAt(this.pos[0], this.pos[2], this.pos[1] + 0.3);
    // the water ran out under her (a shore): momentum can carry a leap onward, but flight still needs a double-press
    if (level === null || level - g < SWIM_OUT) {
      const fast = len(this.vel) > 6 && this.canFly;
      this.leaveWater(false);
      if (fast) { this.leaping = true; this.outT = 0.4; this.onGround = false; this.jumpT = 0; return; }
      this.vel[1] = Math.max(this.vel[1], 0);
      if (this.pos[1] <= g + 0.3) { this.pos[1] = g; this.onGround = true; this.vel[1] = 0; } else this.jumpT = 0;
      return;
    }
    this.waterSurface = level;
    let under = this.swimming === 2;
    // dive: C at the surface, or swimming forward looking steeply down
    if (!under && (my < -0.3 || (mz < 0 && this.aimPitch < -0.55))) {
      under = true;
      this.swimming = 2;
      this.vel[1] = Math.min(this.vel[1], -1.4);
      this.onSwim?.('dive', this.pos);
    }
    // a leap: Jump at the surface — a dolphin arc out of the water. A quick second press becomes flight.
    const hs = Math.hypot(this.vel[0], this.vel[2]);
    if (!under && inp.jump && (hs > 1.0 || this.canFly)) {
      this.vel[1] = 4.6 + hs * 0.35;
      this.leaveWater(true);
      this.leaping = true;
      this.flyTap = FLY_DOUBLE;
      this.jumpT = 0;
      this.pos[1] = Math.max(this.pos[1], level - FLOAT * 0.6);
      return;
    }
    const cp = Math.cos(this.aimPitch), sp = Math.sin(this.aimPitch);
    const r3: V3 = [Math.cos(this.aimYaw), 0, -Math.sin(this.aimYaw)];
    let dir: V3;
    if (under) {
      // under water: full 3D like flight, slow and floaty
      const f3: V3 = [-Math.sin(this.aimYaw) * cp, sp, -Math.cos(this.aimYaw) * cp];
      dir = add(add(scale(f3, -mz), scale(r3, mx)), [0, my, 0]);
    } else {
      const f2: V3 = [-Math.sin(this.aimYaw), 0, -Math.cos(this.aimYaw)];
      dir = add(scale(f2, -mz), scale(r3, mx));
    }
    let dl = len(dir);
    if (dl > 1) { dir = scale(dir, 1 / dl); dl = 1; }
    // strokes: speed surges with each pull and kick (breaststroke), steady for the crawl and the dolphin kick
    const sprint = this.running && dl > 0.1;
    const max = under ? (sprint ? S.underSprint : S.under) : sprint ? S.surfaceSprint : S.surface;
    const u = this.swimPhase;
    const bump = (a: number, b: number) => (u > a && u < b ? Math.sin(((u - a) / (b - a)) * Math.PI) : 0);
    const surge = sprint ? 1 : under ? 0.7 + 0.55 * bump(0.12, 0.36) + 0.35 * bump(0.74, 0.9) : 0.72 + 0.45 * bump(0.12, 0.34) + 0.4 * bump(0.42, 0.6);
    const acc = dl > 0.1 ? 1.8 : 1.0;
    const target = scale(dir, max * surge);
    const v0 = len(this.vel);
    if (under && v0 > max + 0.5) {
      // shooting through the water (a plunge's momentum): the water's drag takes the speed (as its square), and her
      // heading turns where she steers at a limited rate — pitching up she curves round and up toward the light
      const d0 = scale(this.vel, 1 / v0);
      let d1 = d0;
      if (dl > 0.1) {
        const want = scale(dir, 1 / dl);
        const ang = Math.acos(clamp(dot(d0, want), -1, 1));
        const ax = cross(d0, want), al = len(ax);
        if (ang > 1e-4 && al > 1e-6) d1 = rotateAxis(d0, scale(ax, 1 / al), Math.min(ang, T.turn * dt * (0.6 + 0.4 * dl)));
        else if (ang > 3) d1 = want;
      }
      // (the bed coming up along her path: her heading curves out along it rather than smacking into it — the speed kept
      // for the climb back out)
      const v1 = Math.max(max + 0.5, v0 / (1 + T.plungeK * v0 * dt));
      let need = -Infinity;
      for (const t of [0.08, 0.18, 0.32]) {
        const q = add(this.pos, scale(this.vel, t));
        need = Math.max(need, (W.groundAt(q[0], q[2], q[1] + 0.3) + 0.25 - this.pos[1]) / t);
      }
      const wy = clamp(need / v1, -1, 0.9);
      if (wy > d1[1]) {
        const ny = lerp(d1[1], wy, 1 - Math.exp(-dt * 14)), h = Math.hypot(d1[0], d1[2]), nh = Math.sqrt(Math.max(1 - ny * ny, 0));
        if (h > 1e-4) d1 = [d1[0] * nh / h, ny, d1[2] * nh / h];
      }
      this.vel = scale(d1, v1);
    } else {
      this.vel[0] = damp(this.vel[0], target[0], acc, dt);
      this.vel[2] = damp(this.vel[2], target[2], acc, dt);
      if (under) {
        this.vel[1] = damp(this.vel[1], target[1], acc, dt);
        // (idle, she drifts up)
        if (dl < 0.1) this.vel[1] += 0.35 * dt;
      } else {
        // floating at the surface: a buoyant spring to her float line, a gentle bob treading water
        const rest = Math.max(level - FLOAT, g) + Math.sin(this.jumpT * 1.6) * 0.025 * (1 - Math.min(hs, 1));
        this.vel[1] += ((rest - this.pos[1]) * 14 - this.vel[1] * 5) * dt;
      }
    }
    this.speed = Math.hypot(this.vel[0], this.vel[2]);
    const v3 = len(this.vel);
    this.swimSpeed = v3;
    // facing
    let wantYaw = this.yaw;
    if (this.faceAim) wantYaw = this.aimYaw;
    else if (this.speed > 0.25) wantYaw = Math.atan2(-this.vel[0], -this.vel[2]);
    this.yaw += angDiff(this.yaw, wantYaw) * (1 - Math.exp(-dt * (v3 > 6 ? 7 : 4)));
    const yawRate = angDiff(this.lastYaw, this.yaw) / Math.max(dt, 1e-3);
    this.lastYaw = this.yaw;
    // the stroke cycle
    const moving = smoothstep(0.15, 0.9, under ? v3 : this.speed);
    const rate = under ? (sprint ? 0.9 + 0.15 * Math.min(v3, 6) : 0.4 + 0.1 * Math.min(v3, 6)) : sprint ? 0.5 + 0.12 * this.speed : 0.55 + 0.2 * this.speed;
    const prevU = this.swimPhase;
    this.swimPhase = (this.swimPhase + dt * lerp(0.7, rate, moving)) % 1;
    const cross1 = (c: number) => (prevU < c && this.swimPhase >= c) || (prevU > this.swimPhase && (c > prevU || this.swimPhase >= c));
    if (moving > 0.5 && (cross1(sprint && !under ? 0.02 : 0.12) || (sprint && !under && cross1(0.52)))) this.onSwim?.('stroke', this.pos);
    // body lean: surface strokes lie forward (crawl flatter than breaststroke), treading water stands; under water the
    // body follows the path in 3D (head first along it, shooting through after a plunge)
    const fwdSpeed = this.vel[0] * -Math.sin(this.yaw) + this.vel[2] * -Math.cos(this.yaw);
    let wantPitch: number;
    if (under) {
      const path = Math.atan2(this.vel[1], Math.max(fwdSpeed, 0.05));
      wantPitch = lerp(0.3, clamp(Math.PI / 2 - path, 0, 2.9), smoothstep(0.3, 1.4, v3));
    } else wantPitch = lerp(0.12, sprint ? 1.42 : 1.28, smoothstep(0.2, 1.1, fwdSpeed));
    if (this.faceAim) wantPitch *= 0.3;
    this.flyPitch = damp(this.flyPitch, wantPitch, v3 > 6 ? 6 : 2.6, dt);
    this.flyRoll = damp(this.flyRoll, clamp(-yawRate * Math.min(this.speed, 12) * 0.08, -0.5, 0.5), 3, dt);
    // integrate: the lake bed is a floor (lying flat she skims along it)
    let np: V3 = add(this.pos, scale(this.vel, dt));
    np = W.move(this.pos, np);
    const ng = W.groundAt(np[0], np[2], np[1] + 0.3);
    const flat = Math.abs(Math.sin(clamp(this.flyPitch, 0, Math.PI)));
    const floor = ng + 0.1 - 0.55 * flat;
    if (np[1] < floor) { np[1] = floor; if (this.vel[1] < 0) this.vel[1] = 0; }
    this.pos = np;
    // her head's depth
    const headY = np[1] + 1.03 + 0.54 * Math.cos(this.flyPitch);
    this.swimDepth = under ? Math.max(0, level - headY) : 0;
    this.wade = 0;
    this.jumpT += dt;
    this.altitude = 0;
    // bursting out: rising fast, her middle through the surface — momentum makes a leap. Flight still needs the
    // deliberate double-press once she is in open air.
    if (under && this.vel[1] > BREACH_V && np[1] + CORE > level + 0.05) {
      this.leaveWater(true);
      this.leaping = true; this.onGround = false; this.outT = 0.5; this.jumpT = 0;
      return;
    }
    // back up to the surface (rising slowly, not pushing down): floating there
    if (under && np[1] > level - FLOAT && this.vel[1] >= 0 && this.vel[1] <= BREACH_V && my >= 0) {
      this.swimming = 1;
      this.swimDepth = 0;
      this.onSwim?.('surface', this.pos);
    }
  }

  get forward(): V3 { return [-Math.sin(this.yaw), 0, -Math.cos(this.yaw)]; }
  get right(): V3 { return norm([Math.cos(this.yaw), 0, -Math.sin(this.yaw)]); }
}
