// Katara's waterbending, the waterbending game's whole set (boulder's, its sounds, its strip of buttons and the room's
// sharing left there): its brain (brain.ts) driving its water (fluid/: the MPM fluid and its screen-space look, the
// spray, the ice floes, the charge — the host's `bent`). This ties them to her: her body and aim for the brain, the
// water round her (the sources: the world's pools and channels, the stand-in's test pool) for the fluid, her arms (the
// brain's pose), the ripples, and the controls whenever there's water to bend:
//   hold the left mouse button (or B; RT)  draw the water and steer it; let go to throw it (flick the aim to whip)
//   right button (or LT)                   freeze what she holds into ice she carries (click throws it, the right
//                                          button again sets it down); empty-handed, an ice floe where she aims on
//                                          the water (hold to grow it)
//   E (X)        melt the ice she aims at or carries      Q (RB), held      a ring of water swirling round her
//   R (LB), held raise a wave; let go to send it
//   1-6 (D-pad)  the form: stream, orb, whip, octopus, vortex, a dragon of water
//   running onto the water (no key: her movement says it) it freezes under her feet as she goes — she runs on it
//   the wheel    while she holds water: how far out it goes
import { add, sub, scale, norm, clamp, type V3 } from '../math';
import type { BendPose } from '../rig';
import type { WaterSources } from './sources';
import type { HeroWorld } from '../world';
import type { HeroPlayer } from '../player';
import type { BentWater } from './fluid';
import { Bending as Brain, type Bender, type BendEvent, type BendIntent, type BendWater } from './brain';
import { BTN, pad } from '../../input/input';

export interface BendInput {
  /** the bend button held (the mouse's, B, the pad's right bumper); Q held */
  down: boolean; swirl: boolean;
  /** she can't bend now (her hands full, under water): everything let go */
  busy: boolean;
  chest: V3; aimFrom: V3; aimDir: V3;
  handL: V3; handR: V3;
}

/** the world's water as the bending needs it (the water's system; the stand-in's test pool, dev/pool.ts) */
export interface WaterHost {
  /** Katara's water itself (fluid/index.ts) */
  readonly bent: BentWater;
  /** water drawn out of a body of water (amount < 0) or landing on it (> 0) at its level: its ripples */
  splashAt(x: number, z: number, amount: number, r: number, level: number): void;
  /** open water to run onto (a lake's, not a pool's to splash through): its level there, or null */
  lakeAt(x: number, z: number): number | null;
}

/** her body and aim, as the brain wants them (refreshed every frame) */
class Her implements Bender {
  pos: V3 = [0, 0, 0]; vel: V3 = [0, 0, 0]; forward: V3 = [0, 0, -1]; right: V3 = [1, 0, 0];
  flying = false; moveDir: V3 = [0, 0, -1]; camPos: V3 = [0, 0, 0];
  aim = { dir: [0, 0, -1] as V3, dist: 40, hit: [0, 0, 0] as V3, onWater: false };
  faceAim = false;
  powerView = 0;
  constructor(private world: HeroWorld, private water: BendWater) {}
  ground(x: number, z: number) { return this.world.groundAt(x, z, this.pos[1] + 0.3); }

  set(P: HeroPlayer, from: V3, dir: V3, aim: boolean) {
    this.pos = P.pos; this.vel = P.vel; this.forward = P.forward; this.right = P.right; this.flying = P.flying;
    if (P.speed > 0.2) this.moveDir = norm([P.vel[0], 0, P.vel[2]]);
    this.camPos = from;
    if (!aim) return;
    // the aim ray, marched out to 60 m (finer near) to the ground or the water, whichever it meets first
    const surf = (p: V3) => Math.max(this.ground(p[0], p[2]), this.water.levelAt(p[0], p[2]));
    let a = 0, t = 0.5, hit = false;
    for (let i = 0; i < 160 && t < 60; i++) {
      if (from[1] + dir[1] * t <= surf(add(from, scale(dir, t)))) { hit = true; break; }
      a = t;
      t += Math.max(0.15, t * 0.04);
    }
    if (!hit) { this.aim = { dir, dist: 40, hit: add(from, scale(dir, 40)), onWater: false }; return; }
    for (let k = 0; k < 6; k++) { const m = (a + t) / 2; if (from[1] + dir[1] * m <= surf(add(from, scale(dir, m)))) t = m; else a = m; }
    const p = add(from, scale(dir, t)), g = this.ground(p[0], p[2]), wl = this.water.levelAt(p[0], p[2]);
    this.aim = { dir, dist: t, hit: [p[0], Math.max(g, wl), p[2]], onWater: wl > g };
  }
}

type Held = 'bend' | 'ice' | 'swirl' | 'wave';

export class Bending {
  readonly brain: Brain;
  /** what her body does with the water (the rig's) */
  pose: BendPose = { mode: 'idle', target: [0, 0, 0], intensity: 0, t: 0 };
  /** turn her to face the aim */
  aiming = false;
  /** a word for the player (no water in reach) */
  message = '';
  /** water in reach */
  nearWater = false;
  /** there's water to bend, or she has some, or carries ice: the forms' digits and R are the bending's */
  engaged = false;
  /** she's the one playing (CastPlayer: Katara worn) */
  active = () => false;
  private her: Her;
  private keys = new Set<string>();
  private rmb = false;
  /** held from a pad */
  private pad = new Set<Held>();
  private was = { bend: false, ice: false, wave: false };
  private formHit = 0;
  private meltHit = false;
  private wheel = 0;

  constructor(private water: WaterHost, private sources: WaterSources, world: HeroWorld, private player: HeroPlayer, canvas: HTMLCanvasElement) {
    const bent = water.bent;
    const W: BendWater = {
      levelAt: (x, z) => sources.levelAt(x, z) ?? -1e9,
      nearest: (p, r) => sources.nearest(p, r)?.point ?? null,
      impulse: (e) => { const l = sources.levelAt(e.x, e.z); if (l !== null) water.splashAt(e.x, e.z, e.amount, e.r, l); },
      floes: bent.floes,
    };
    this.her = new Her(world, W);
    this.brain = new Brain(bent.fluid, W, this.her);
    this.brain.maxHeld = bent.profile.name === 'phone' ? 5000 : 9000;
    this.brain.gatherCap = this.brain.maxHeld;
    // in flight a falls beside her gives water
    this.brain.fallsSource = () => { const f = sources.nearest(player.pos, 6); return f && f.source.kind === 'falls' ? f.point : null; };
    this.brain.onEvent = (e) => this.event(e);
    // she stands on the floes she freezes
    world.ice = (x, z, g) => bent.floes.standingAt(x, z, g);
    // each beat of a charge: the water under it rung in rings
    bent.energy.onBeat = (at, k, wl) => {
      if (wl !== null && at[1] - wl < 16) water.splashAt(at[0], at[2], -0.035 * k * (1 - clamp((at[1] - wl) / 16, 0, 1)), 1.6 + 0.6 * bent.energy.size, wl);
    };
    addEventListener('keydown', (e) => {
      if (!this.active() || (e.target as HTMLElement)?.closest?.('input, textarea, .tp-dfwv')) return;
      // (the digits are the forms while there's water to bend)
      const m = /^Digit([1-6])$/.exec(e.code);
      if (m && !e.repeat && this.engaged) { this.formHit = Number(m[1]); e.preventDefault(); return; }
      const reach = this.nearWater || this.brain.holding || this.brain.carrying;
      // (R raises a wave only where there's water to raise)
      if (e.code === 'KeyR' && reach) { this.keys.add('KeyR'); return; }
      // (E melts — on foot: flying it sinks)
      if (e.code === 'KeyE' && !e.repeat && !this.player.flying && (reach || bent.floes.list.length)) this.meltHit = true;
    }, { capture: true });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    // (the window losing focus lets the water fall back rather than throwing it where she last aimed)
    addEventListener('blur', () => { this.keys.clear(); this.rmb = false; if (this.active()) this.brain.relax(false); });
    // (mouse events, not pointer events: a button pressed while another is held — the right while the left holds the
    // water, freezing it — comes as a pointermove, never a pointerdown)
    canvas.addEventListener('mousedown', (e) => { if (this.active() && e.button === 2 && document.pointerLockElement === canvas) this.rmb = true; });
    addEventListener('mouseup', (e) => { if (e.button === 2) this.rmb = false; });
    canvas.addEventListener('contextmenu', (e) => { if (this.active()) e.preventDefault(); });
    canvas.addEventListener('wheel', (e) => { if (this.active() && this.brain.holding) this.wheel -= e.deltaY * 0.004; }, { passive: true });
  }

  get holding() { return this.brain.holding; }
  /** the wheel is the water's reach while she holds it (not the camera's distance) */
  get wheelTaken() { return this.brain.holding; }
  /** let go of what she holds (switching away from her): it falls back, the ice she carries melts */
  drop() { this.brain.relax(); this.engaged = false; }

  /** the pad's buttons for the bending (standard mapping): RB bend (the cast's power), LB freeze, R3 swirl, L3 wave, X
   *  melt, the D-pad the first four forms (the triggers are running and the boost: hero/cast.ts) */
  private readPad() {
    const P = this.pad, g = pad;
    P.clear();
    if (!g.connected) return;
    if (g.down(BTN.RB)) P.add('bend');
    if (g.down(BTN.LB)) P.add('ice');
    if (g.down(BTN.R3)) P.add('swirl');
    if (g.down(BTN.L3)) P.add('wave');
    if (g.hit(BTN.X)) this.meltHit = true;
    [BTN.UP, BTN.RIGHT, BTN.DOWN, BTN.LEFT].forEach((i, k) => { if (g.hit(i)) this.formHit = k + 1; });
  }

  /** walking on water, from her movement (no key): running on her feet, onto the water — the way ahead of her water
   *  for a couple of strides — or already on it (the ice she froze); walking in she wades and swims */
  private runsOntoWater(): boolean {
    const P = this.player, v = P.vel, sp = Math.hypot(v[0], v[2]);
    if (!P.onGround || P.flying || P.swimming || !P.running || sp < 2.5) return false;
    // (a lake's open water, not a garden pool or a creek she'd run through; under her only where she's up on the ice
    // she froze, not wading in the shallows)
    const lake = (d: number) => this.water.lakeAt(P.pos[0] + (v[0] / sp) * d, P.pos[2] + (v[2] / sp) * d) !== null;
    return (lake(1.2) && lake(2.6)) || (lake(0) && P.wade < 0.05 && this.water.bent.floes.list.length > 0);
  }

  update(dt: number, I: BendInput) {
    const B = this.brain, bent = this.water.bent, P = this.player;
    // (busy — sat down, a stone picked up, gone under — what she holds falls back)
    if (I.busy && B.holding) B.relax();
    this.readPad();
    // (her aim, marched out over the ground and the water, only where there's water to bend or she has some)
    const idle = !B.holding && !B.carrying && !bent.fluid.active && !this.sources.nearest(I.chest, 40);
    this.her.set(P, I.aimFrom, norm(I.aimDir), !idle);
    B.hands = [I.handL, I.handR];
    // the water round her for the bent water to fall back into: up to four bodies within reach
    const near: { level: number; box: [number, number, number, number] }[] = [];
    for (const s of this.sources.list) {
      if (s.kind === 'falls' || near.length >= 4) continue;
      const bb = s.bounds;
      if (bb && Math.hypot(Math.max(bb[0] - P.pos[0], 0, P.pos[0] - bb[2]), Math.max(bb[1] - P.pos[2], 0, P.pos[2] - bb[3])) > 40) continue;
      const q = s.nearest(P.pos);
      if (!q || Math.hypot(q[0] - P.pos[0], q[2] - P.pos[2]) > 40) continue;
      // (a lake over its outline's box; a creek or the garden's water, which run downhill, over a stretch round her)
      const b = s.kind === 'lake' && s.bounds ? s.bounds : [q[0] - 12, q[2] - 12, q[0] + 12, q[2] + 12];
      near.push({ level: q[1], box: [b[0], b[1], b[2], b[3]] });
    }
    bent.waters = near;
    this.nearWater = !!this.sources.nearest(I.chest, 12);
    const held = (h: Held, own: boolean) => !I.busy && (own || this.pad.has(h));
    const bend = held('bend', I.down), ice = held('ice', this.rmb), wave = held('wave', this.keys.has('KeyR'));
    const intent: BendIntent = {
      bend, bendHit: bend && !this.was.bend, bendUp: !bend && this.was.bend,
      freeze: ice, freezeHit: ice && !this.was.ice,
      meltHit: this.meltHit && !I.busy,
      swirl: held('swirl', I.swirl),
      wave, waveUp: !wave && this.was.wave,
      // (walking on water from her movement: no key)
      walk: !I.busy && this.runsOntoWater(),
      form: this.formHit, reach: this.wheel,
    };
    this.was = { bend, ice, wave };
    this.formHit = 0; this.meltHit = false; this.wheel = 0;
    B.update(dt, intent);
    this.engaged = !I.busy && (this.nearWater || B.holding || B.carrying);
    // the grid follows the action: the shape she holds (kept round her), else between her and what she's doing; in
    // flight all round what she carries
    const path = bent.fluid.path;
    let focus: V3 = add(P.pos, scale(sub(B.pose.target, P.pos), 0.4));
    if (path.length > 1) {
      const lo: V3 = [1e9, 1e9, 1e9], hi: V3 = [-1e9, -1e9, -1e9];
      for (const q of path) for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], q.p[j]); hi[j] = Math.max(hi[j], q.p[j]); }
      const c = scale(add(lo, hi), 0.5), r = bent.fluid.pathMode > 2.5 ? 7 : 4;
      focus = [clamp(c[0], P.pos[0] - r, P.pos[0] + r), c[1], clamp(c[2], P.pos[2] - r, P.pos[2] + r)];
    }
    const airborne = P.flying && B.holding;
    bent.fluid.setCenter([focus[0], airborne ? clamp(focus[1], P.pos[1] - 2.5, P.pos[1] + 2.5) : P.pos[1], focus[2]], airborne ? 0.5 : 0.35);
    // spray off a raised wave's crest
    for (const c of B.crest) bent.spray.emit({ pos: c, radius: 0.2, vel: add(scale(this.her.forward, 2.2), [0, 1.6, 0]), spread: 1.2, count: 24, kind: 'droplet', life: 0.9 });
    // (the vortex and the dragon spread what she holds along long strands, thin enough to break into beads: drawn
    // fuller, as the game draws a great orb seen from afar)
    const R = bent.render.params, full = B.holding && B.form === 'vortex' ? 1.75 : 1;
    R.heldScale += (full - R.heldScale) * Math.min(1, dt * 3);
    // the charge (its heart, its light, its motes)
    bent.charge = { charge: B.charge, holding: B.holding, orb: null, serpentEyes: B.serpentEyes, waterAt: (x, z) => this.sources.levelAt(x, z) };
    // her body
    this.pose.mode = B.pose.mode;
    this.pose.target = B.pose.target;
    this.pose.intensity = B.pose.intensity;
    this.pose.t = B.pose.t;
    this.aiming = this.her.faceAim;
    this.message = B.message;
  }

  /** a bending moment: its spray (the brain makes the ripples) */
  private event(e: BendEvent) {
    const spray = this.water.bent.spray, dir = this.her.aim.dir;
    switch (e.type) {
      case 'draw':
        spray.emit({ pos: e.pos, radius: 0.5, vel: [0, 2.5, 0], spread: 1.5, count: 130, kind: 'droplet', life: 1.2 });
        break;
      case 'launch':
        spray.emit({ pos: e.pos, radius: 0.3, vel: scale(dir, 9), spread: 2.5, count: 120, kind: 'droplet', life: 1.4 });
        break;
      case 'whip':
        spray.emit({ pos: e.pos, radius: 0.3, vel: scale(dir, 9), spread: 2.5, count: 220, kind: 'droplet', life: 1.4 });
        break;
      case 'freeze':
        spray.emit({ pos: e.pos, radius: 1.0, vel: [0, 0.6, 0], spread: 1.2, count: 500, kind: 'glitter', life: 1.6 });
        break;
      case 'shatter':
        spray.emit({ pos: e.pos, radius: 0.8, vel: [0, 2, 0], spread: 4, count: 900, kind: 'glitter', life: 2.2 });
        break;
      case 'melt':
        spray.emit({ pos: e.pos, radius: 1.2, vel: [0, 0.5, 0], spread: 0.3, count: 40, kind: 'mist', life: 2.5 });
        break;
      case 'splash':
        spray.emit({ pos: e.pos, radius: 0.8, vel: [0, 3.5, 0], spread: 2.5, count: 300, kind: 'droplet', life: 1.6 });
        break;
    }
  }
}
