// The cast's own powers when they're the player (hero/cast.ts `power`, asked each frame for the arms' pose; Katara's
// is the waterbending). Aang's air: a click strikes with both palms where you look and sends a gust of wind; his run
// (Shift) is the air scooter — he sits on a whirling ball of air and it carries him, quick and smooth (aang/air.ts
// draws the air, as for Aang on the deck). Iroh's fire: a click is a punch that
// throws a jet of fire where you look; held, he cups a small flame between his palms (a light in the dark). Gliding,
// Aang holds his glider's grip over his head (`hold`, and aang/glider.ts drawn at his hands: gliderAt). Taking off, as
// in the show, it snaps open over his head as his hands come up to it, with a burst of air under him; landing, it
// folds away as his hands let go.
import { type V3, add, sub, scale, norm, cross, len, clamp, lerp3, smoothstep, damp, ease } from '../hero/math';
import type { BendPose, HandGoal, HoldPose, SeatPose, HeroRig } from '../hero/rig';
import type { HeroPlayer } from '../hero/player';
import type { Who } from '../hero/hero';
import type { AirFx } from '../aang/air';
import { noFx, type MoveFx } from '../aang/fx';
import type { FireFx } from '../iroh/fire';
import { type GliderAt, openAt } from '../aang/glider';

/** a click held this long (s) is a hold (Iroh's flame), not a strike */
const HOLD = 0.32;
const IDLE: BendPose = { mode: 'idle', target: [0, 0, 0], intensity: 0, t: 0 };
/** the glider folding away as he lands (s) */
const FOLD_T = 0.22;

/** the player as the powers see them (hero/cast.ts CastPlayer): who they are, their body and its joints */
export interface Wearer {
  readonly who: Who;
  readonly active: boolean;
  readonly player: HeroPlayer;
  readonly rig: HeroRig;
  readonly chest: V3;
  readonly forward: V3;
  /** carried by something else (none yet: always null) */
  readonly ride: null;
}

export interface PowerDeps {
  air: () => AirFx | null;
  fire: FireFx | null;
  /** the season's day of the year (the leaves the air lifts) */
  doy: () => number;
}

export class Powers {
  /** the air scooter's seat (Aang on its ball), while he rides it */
  scooter: SeatPose | null = null;
  /** his hands on his glider's grip over his head, while he glides */
  hold: HoldPose | null = null;
  private t = 0;
  /** the click: held since (s; -1 up), and the strike it started (s since; -1 none) */
  private downT = -1;
  private strikeT = -1;
  private aim: V3 = [0, 0, -1];
  private scootK = 0;
  /** a scripted take-off's wind-up: 0 none; to 1 crouching to spring, the arms swung down and back; on to 2 sprung (a
   *  burst of air under him), the arms swinging forward and up overhead to the glider's grip. Gliding takes over from
   *  there */
  windup = 0;
  /** how long he's glided (s; -1 not gliding) and since he landed (s; -1 not folding it away), the glider's pitch with
   *  his path, and where it was over him as he landed (folded away there, carried with him) */
  private glideT = -1;
  private foldT = -1;
  private pitch = 0;
  private last: { at: GliderAt; pos: V3 } | null = null;
  /** how far his hands are on the glider's grip this frame (gliding 1; landing, letting go; 0 off it): the hold itself
   *  is put once he's moved (place) — and where he was when it was last put (the rig's root then: its head, J.head, is
   *  where it was then) */
  private gripW = 0;
  private placedAt: V3 | null = null;
  /** the strike's fire thrown */
  private fired = false;
  /** told of each jet of fire Iroh throws (where from, which way): where the scorch marks will come from */
  onFire: ((from: V3, dir: V3) => void) | null = null;

  constructor(private k: Wearer, private d: PowerDeps) {}

  /** this frame's pose for the arms (null: none): `down` the click (or the pad's trigger), `aim` where the view looks */
  update(dt: number, down: boolean, aim: V3): BendPose | null {
    this.t += dt;
    const who = this.k.who;
    if (down) this.downT = this.downT < 0 ? 0 : this.downT + dt;
    // (a strike on the press; Iroh's flame once it's held)
    const pressed = down && this.downT === 0;
    if (pressed && this.strikeT < 0) { this.strikeT = 0; this.fired = false; this.aim = norm(aim); }
    if (!down) this.downT = -1;
    if (this.strikeT >= 0) { this.strikeT += dt; if (this.strikeT > 0.6) this.strikeT = -1; }
    const pose = who === 'aang' ? this.airbend(dt) : who === 'iroh' ? this.firebend() : null;
    if (who !== 'aang') { this.scooter = null; this.scootK = 0; this.hold = null; this.glideT = this.foldT = -1; this.gripW = 0; this.placedAt = null; }
    return pose;
  }

  private strike(): BendPose | null {
    if (this.strikeT < 0) return null;
    const c = this.k.chest;
    return { mode: 'push', target: add(c, scale(this.aim, 3)), intensity: 1, t: this.strikeT };
  }

  // ---------------------------------------------------------------- Aang
  private airbend(dt: number): BendPose | null {
    const k = this.k, P = k.player, J = k.rig.J;
    const pose = this.strike();
    // the air scooter: running on the ground, he's up on its ball
    const riding = P.running && P.onGround && !P.flying && !P.swimming && !k.ride;
    this.scootK = Math.max(0, Math.min(1, this.scootK + (riding ? dt / 0.25 : -dt / 0.3)));
    this.scooter = this.scootK > 0.01 ? this.seatOnBall(this.scootK) : null;
    const fx: MoveFx = noFx();
    // (the ball's centre in his body frame, as the deck's Aang gives it: it was given in the world's, and drawn some
    // 100 m over him, out of sight — he squatted on nothing, only a whirlwind's ribbons dragged out behind him in
    // zigzags along the ground)
    if (this.scootK > 0.01) { fx.ball = this.scootK; fx.ballAt = [0, 0.3, 0]; fx.ballR = 0.32; }
    // (a strike: both palms out, a gust off each at its height)
    if (this.strikeT >= 0) {
      const g = this.strikeT > 0.12 && this.strikeT < 0.3 ? 1 : 0;
      fx.gust = [g, g];
    }
    // gliding: his hands up on the glider's grip over his head (the glider goes where they end up: gliderAt); taking
    // off, a burst of air under him as it catches (a scripted leap's, as he springs); landing, his hands let go as it
    // folds away (the hold itself put once he's moved this frame: place)
    const gliding = P.flying && !k.ride;
    if (gliding) { this.glideT = this.glideT < 0 ? 0 : this.glideT + dt; this.foldT = -1; }
    else { this.foldT = this.glideT >= 0 ? 0 : this.foldT >= 0 ? this.foldT + dt : -1; this.glideT = -1; }
    if (this.windup > 0 ? this.windup > 1 && this.windup < 1.2 : gliding && this.glideT < 0.15) fx.puff = 1;
    // (the glider's nose up a little as he climbs, down as he dives)
    const hs = Math.hypot(P.vel[0], P.vel[2]), pitch = clamp(Math.atan2(P.vel[1], Math.max(hs, 1)) * 0.4, -0.3, 0.3);
    this.pitch = this.glideT === 0 ? pitch : damp(this.pitch, pitch, 4, dt);
    const letGo = this.foldT >= 0 && this.foldT < FOLD_T ? 1 - ease(this.foldT / FOLD_T) : 0;
    this.gripW = gliding ? 1 : letGo > 0 && !k.ride ? letGo : 0;
    const palm = (h: V3) => norm(add(sub(h, J.chest), scale(this.aim, 0.8)));
    this.d.air()?.update(dt, {
      t: this.t, beat: 0, root: P.pos, yaw: P.yaw, fx, rise: -1, level: 0, doy: this.d.doy(), shown: true,
      J: { handL: J.handL, handR: J.handR, palmL: palm(J.handL), palmR: palm(J.handR), footL: J.footL, footR: J.footR, chest: J.chest, pelvis: J.pelvis },
    });
    return pose;
  }

  /** his hands' hold this frame — on the glider's grip, or a scripted leap's wind-up — put once he's moved
   *  (CastPlayer.update, after the player's step, before the rig's pose): put before, the grip trailed his body by a frame's
   *  travel, more or less as the frame's time varied, and the glider shook in his hands */
  place() {
    this.hold = this.gripW > 0 ? this.grip(this.gripW) : this.windup > 0 ? this.wound(this.windup) : null;
    this.placedAt = [...this.k.player.pos] as V3;
  }

  /** the hands on the glider's grip: a bar across over his head, held from below, the fingers over it (w: how far
   *  they're on it) — over his head along his body (he flies lying along his way: the world's up there is behind his
   *  back, where his arms fold it round under his chest) */
  private grip(w: number): HoldPose {
    const P = this.k.player, J = this.k.rig.J, y = P.yaw;
    // (last frame's head, carried on by how far he's flown since — not over a jump, a trip on the map: there the rig
    // starts over where he is)
    const d = this.placedAt ? sub(P.pos, this.placedAt) : null;
    const head = d && len(d) < 3 + len(P.vel) * 0.1 ? add(J.head, d) : J.head;
    // his body's up (pelvis to chest) and front (his belly's way)
    const sp = sub(J.chest, J.pelvis), left: V3 = [-Math.cos(y), 0, Math.sin(y)];
    const up: V3 = len(sp) > 0.05 ? norm(sp) : [0, 1, 0], front = norm(cross(left, up));
    const hand = (s: number): HandGoal => ({
      palm: add(this.reach(head, front, up), scale(left, s * 0.15)), fwd: norm(add(scale(up, 0.7), scale(front, 0.5))),
      down: norm(add(scale(front, 0.6), scale(up, 0.8))), tips: [null, null, null, null, null], curl: 0.8,
    });
    // (where the hands go in the world, his lean and all: the rig takes them into his upright body)
    return { hands: [hand(1), hand(-1)], w: [w, w], stoop: 0, leaned: true };
  }
  /** the grip's middle: over his head (along `up`: the world's, or his body's), a little before it */
  private reach(head: V3, fwd: V3, up: V3 = [0, 1, 0]): V3 { return add(add(head, scale(up, 0.3)), scale(fwd, 0.04)); }

  /** a scripted leap's wind-up as a hold (`windup`): crouched to spring, the arms swung down and back behind his hips
   *  (u to 1); then sprung, the crouch let go, the arms swinging through in front of him and on up overhead to the
   *  glider's grip (to 2) — a jump's own arm swing, ending where his hands take the glider */
  private wound(u: number): HoldPose {
    const P = this.k.player, y = P.yaw, J = this.k.rig.J;
    const fwd: V3 = [-Math.sin(y), 0, -Math.cos(y)], left: V3 = [-Math.cos(y), 0, Math.sin(y)];
    const sw = ease(clamp(u - 1, 0, 1)), a = 1 - sw;
    const hand = (s: number): HandGoal => {
      const back = add(J.pelvis, add(scale(fwd, -0.24), add(scale(left, s * 0.2), [0, -0.08, 0])));
      const low = add(J.pelvis, add(scale(fwd, 0.36), add(scale(left, s * 0.18), [0, 0.02, 0])));
      const top = add(this.reach(J.head, fwd), scale(left, s * 0.15));
      return {
        palm: add(add(scale(back, a * a), scale(low, 2 * a * sw)), scale(top, sw * sw)),
        fwd: norm(lerp3(add([0, -1, 0], scale(fwd, -0.4)), add([0, 0.7, 0], scale(fwd, 0.5)), sw)),
        down: norm(lerp3(add(scale(fwd, -1), [0, 0.2, 0]), add(scale(fwd, 0.6), [0, 0.8, 0]), sw)),
        tips: [null, null, null, null, null], curl: 0.35 + 0.45 * sw,
      };
    };
    const w = Math.min(1, u * 2.5);
    return { hands: [hand(1), hand(-1)], w: [w, w], stoop: ease(clamp(u, 0, 1)) * (1 - smoothstep(1, 1.2, u)), bend: 1 };
  }

  /** the glider, while Aang glides: over his hands (after his rig's pose this frame), its staff along his way, rolled
   *  with his turns, its nose pitched a little with his path. Taking off it snaps open over his head, where his hands
   *  are reaching for it, and is in them once they're there; landing, it folds away there over him as they let go */
  gliderAt(): GliderAt | null {
    const k = this.k, P = k.player;
    if (k.who !== 'aang' || !k.active || k.ride) { this.last = null; return null; }
    if (!P.flying) {
      // (the frame he lands the fold hasn't begun its count: at its start)
      const L = this.last, f = Math.max(this.foldT, 0);
      if (!L || f >= FOLD_T) { this.last = null; return null; }
      return { ...L.at, o: add(L.at.o, sub(P.pos, L.pos)), open: 1 - ease(f / FOLD_T) };
    }
    const J = k.rig.J, y = P.yaw, t = Math.max(this.glideT, 0);
    const back: V3 = [Math.sin(y), 0, Math.cos(y)], fwd: V3 = [-back[0], 0, -back[2]];
    const rl = P.flyRoll, up0: V3 = norm([Math.cos(y) * Math.sin(rl), Math.cos(rl), -Math.sin(y) * Math.sin(rl)]);
    const x = norm(cross(up0, back));
    // (pitched about its right: the staff's head raised, its foot lowered)
    const c = Math.cos(this.pitch), s = Math.sin(this.pitch);
    const z = norm(sub(scale(cross(x, up0), c), scale(up0, s))), up = norm(cross(z, x));
    const hands = scale(add(J.handL, J.handR), 0.5);
    const o = add(lerp3(this.reach(J.head, fwd), hands, smoothstep(0.08, 0.3, t)), scale(up, 0.06));
    const at: GliderAt = { o, x, y: up, z, open: openAt(t) };
    this.last = { at, pos: [...P.pos] as V3 };
    return at;
  }

  /** sitting on the scooter's ball: his seat on its top, his feet on its sides, his hands out for balance (k: how far
   *  he's up on it) */
  private seatOnBall(k: number): SeatPose {
    const P = this.k.player, y = P.yaw;
    const fwd: V3 = [-Math.sin(y), 0, -Math.cos(y)], left: V3 = [-Math.cos(y), 0, Math.sin(y)];
    const at = (x: number, h: number, z: number): V3 => add(P.pos, add(add(scale(left, x), [0, h, 0]), scale(fwd, z)));
    const sway = 0.03 * Math.sin(this.t * 2.3);
    const hand = (s: number): HandGoal => ({ palm: at(s * 0.42, 1.02 + sway * s, 0.1), fwd: norm(add(scale(left, s), [0, -0.2, 0])), down: [0, -1, 0], tips: [null, null, null, null, null] });
    return {
      pelvis: at(0, 0.76, -0.04), yaw: y, feet: [at(0.15, 0.44, 0.12), at(-0.15, 0.44, 0.12)], hands: [hand(1), hand(-1)],
      look: at(0, 1.1, 6), lean: 0.12, w: k,
    };
  }

  // ---------------------------------------------------------------- Iroh
  private firebend(): BendPose | null {
    const k = this.k, J = k.rig.J, fire = this.d.fire;
    // held: a flame cupped between his palms, before his chest
    if (this.downT > HOLD) {
      const mid = scale(add(J.handL, J.handR), 0.5);
      fire?.hold('player', add(mid, [0, 0.03, 0]), 0.12, Math.min(1, (this.downT - HOLD) / 0.3));
      return { mode: 'hold', target: add(J.chest, scale(norm(add(k.forward, [0, -0.3, 0])), 0.35)), intensity: 1, t: this.downT, orb: 0.07 };
    }
    // a strike: the fist out, a jet of fire from it as it lands
    const pose = this.strike();
    if (pose && fire && this.strikeT >= 0.1 && !this.fired) {
      this.fired = true;
      const fist = J.handR, dir = norm(sub(add(J.chest, scale(this.aim, 3)), fist));
      fire.burst(add(fist, scale(dir, 0.08)), dir, { count: 18, speed: 13, size: 0.16 });
      this.onFire?.(add(fist, scale(dir, 0.08)), dir);
    }
    return pose ?? (this.downT >= 0 ? IDLE : null);
  }
}
