// The player's body for the whole cast (boulder's hero/katara.ts, slimmed to the walking, flying and bending body):
// one HeroPlayer — WASD or the arrows walk relative to the camera, Shift runs, Space jumps and a second press in the
// air takes off; flying, Space or Q rises, E sinks (held near the ground, lands), Shift boosts — and one HeroCamera
// following it (the mouse or a finger looks, the wheel sets its distance). wear(who) puts on Katara's, Aang's or
// Iroh's mesh, rig and gait, keeping where they are and how they're moving (a switch mid-flight flies on). A click
// (under the pointer lock) or B is the power: Katara's waterbending near water (hero/bend/bending.ts: the right button
// freezes, Q swirls, R raises a wave, E melts, 1-6 the forms), Aang's gust (Shift on foot rides his air scooter, flying
// he glides), Iroh's fire (a jet; held, a flame between his palms) — play/powers.ts. Each frame in katara.ts's order:
// the look into the aim, the input, the bending's or the powers' arm pose, the player's step, Aang's grip put where he
// is now, the rig posed, the mesh (its jaw, its skirt, the cloth's push in flight), the glider at his hands, the
// camera; after the view's matrices, the motion blur's shutter and where the body is on screen (kept sharp).
import type { Camera, Kit, V3 } from '@ericrius1/weft';
import { add, len, clamp, smoothstep } from './math';
import type { HeroMesh, Who } from './hero';
import { HeroRig, type BendPose } from './rig';
import { HeroPlayer, type MoveInput } from './player';
import { HeroCamera } from './camera';
import type { HeroWorld } from './world';
import type { MotionBlur } from '../post/motionblur';
import type { Powers } from '../play/powers';
import type { Bending } from './bend/bending';
import type { Glider } from '../aang/glider';
import type { Look } from '../input/look';
import { pad, rumble, BTN } from '../input/input';
import { pointer } from '../ui/pointer';
import { FLEX } from '../body/anatomy';

/** the arms at rest (no power) */
const STILL: BendPose = { mode: 'idle', target: [0, 0, 0], intensity: 0, t: 0 };
/** how each of the cast moves (HeroPlayer.tune): Aang light and quick, high jumps, gliding as fast as she flies; Iroh
 *  at an easy stroll, a heavier jog, small jumps. Everyone flies, each at their own pace: Iroh unhurried */
export const GAIT: Record<Who, Partial<HeroPlayer['tune']>> = {
  katara: {},
  aang: { walk: 1.75, run: 6.4, jump: 6.4 },
  iroh: { walk: 1.1, run: 3.1, jump: 3.4, start: 3, cruise: 28, cruiseRamp: 7, boost: 220, boostRamp: 5 },
};

export class CastPlayer {
  /** whose body this is (Katara's own, or another of the cast's worn: wear()) */
  who: Who = 'katara';
  /** played (always, here: there's no first-person walker to hand over to) */
  readonly active = true;
  /** carried by something else (nothing carries the player yet) */
  readonly ride = null;
  rig: HeroRig;
  readonly player: HeroPlayer;
  readonly camera = new HeroCamera();
  /** the powers of whoever else of the cast this is (Aang's air, Iroh's fire) */
  power: Powers | null = null;
  /** Katara's waterbending */
  bending: Bending | null = null;
  /** the post chain's motion blur: fast flight's feel (none on foot) */
  blur: MotionBlur | null = null;
  /** Aang's glider, put at his hands while he glides */
  glider: Glider | null = null;
  /** K: the next of the cast (play/cast.ts) */
  onK: (() => void) | null = null;
  /** the keys and the mouse left alone (a shot set up by hand: dev/hooks.ts); the step and the pose go on, moved by
   *  `script` (the stick, run, up and down; the power held) */
  held = false;
  script: { move?: Partial<MoveInput>; power?: boolean } | null = null;
  /** the view is someone else's (a shot's camera: dev/views.ts): the follow camera leaves it alone */
  freeCamera = false;
  /** the cloth's wind (RigInput.wind: the chains, the hems) */
  wind: V3 = [1.2, 0, 0.8];
  /** the bodies that can be worn: each its mesh, its rig (made from it) and its skirt's room round the legs */
  private bodies = new Map<Who, { mesh: HeroMesh; rig: HeroRig; pad: number }>();
  private tune0: HeroPlayer['tune'];
  private keys = new Set<string>();
  private jumpHit = false;
  /** the mouse's button held under the lock, or B: the power */
  private bendDown = false;
  private time = 0;
  private legPad = 0;
  private lastChest: V3 | null = null;

  constructor(readonly kit: Kit, public mesh: HeroMesh, readonly world: HeroWorld, private cam: Camera, canvas: HTMLCanvasElement, private look: Look) {
    this.rig = new HeroRig(mesh.asset);
    this.bodies.set('katara', { mesh, rig: this.rig, pad: mesh.legPad });
    this.player = new HeroPlayer(world);
    this.tune0 = { ...this.player.tune };
    this.player.onLand = (_p, impact) => { if (impact > 4) rumble(Math.min(1, impact / 16), Math.min(1, impact / 10), 90 + Math.min(220, impact * 10)); };
    this.mesh.visible = true;
    addEventListener('keydown', (e) => this.keydown(e));
    addEventListener('keyup', (e) => { this.keys.delete(e.code); if (e.code === 'KeyB') this.bendDown = false; });
    addEventListener('blur', () => { this.keys.clear(); this.bendDown = false; });
    // (a click under the lock is the power; without it, it takes the lock: ui/pointer.ts)
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0 && document.pointerLockElement === canvas && !this.held) this.bendDown = true; });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.bendDown = this.keys.has('KeyB'); });
    canvas.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch' && document.pointerLockElement !== canvas) pointer.lock(canvas); });
    // (the wheel is the camera's distance, or the held water's reach while she holds some)
    canvas.addEventListener('wheel', (e) => { if (!this.bending?.wheelTaken) this.camera.dist = clamp(this.camera.dist * Math.exp(e.deltaY * 0.0012), 1.2, 9); }, { passive: true });
  }

  private keydown(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.closest?.('.tp-dfwv, input, textarea, select, [contenteditable]') || this.held) return;
    if (e.code === 'KeyK' && !e.repeat) { this.onK?.(); return; }
    this.keys.add(e.code);
    if (e.repeat) return;
    if (e.code === 'Space') { this.jumpHit = true; e.preventDefault(); }
    if (e.code === 'KeyB') this.bendDown = true;
  }

  /** another of the cast's bodies that can be worn (their mesh; its rig made here, as supple as they are) */
  addBody(who: Who, mesh: HeroMesh) {
    if (this.bodies.has(who)) return;
    const rig = new HeroRig(mesh.asset);
    rig.flex = FLEX[who] ?? 1;
    this.bodies.set(who, { mesh, rig, pad: mesh.legPad });
  }
  has(who: Who) { return this.bodies.has(who); }

  /** be someone else of the cast (their body, their gait), where this one stands; false if their body isn't in yet */
  wear(who: Who): boolean {
    const b = this.bodies.get(who);
    if (!b) return false;
    if (who === this.who) return true;
    const was = this.mesh;
    was.visible = false;
    // (the water she holds falls back as she becomes someone else)
    if (this.who === 'katara') this.bending?.drop();
    this.who = who;
    this.mesh = b.mesh;
    this.rig = b.rig;
    // (the tune rebuilt from the defaults: Aang's numbers never leak into Iroh's)
    Object.assign(this.player.tune, this.tune0, GAIT[who]);
    this.player.canFly = true;
    this.legPad = b.pad;
    this.mesh.far = false;
    this.rig.snap();
    this.mesh.visible = true;
    return true;
  }

  /** here, facing `yaw` (0 faces -z), on the ground */
  placeAt(p: V3, yaw: number) {
    this.player.place(p, yaw);
    this.camera.reset(yaw);
    this.rig.snap();
    this.cam.cut();
  }

  /** in the air here, facing `yaw`, moving at `vel`: flying on from there */
  airAt(p: V3, yaw: number, vel: V3) {
    const P = this.player;
    P.flyAt(p, yaw, vel);
    this.camera.reset(yaw);
    this.rig.snap();
    this.cam.cut();
  }

  /** the input this frame: the keys, and the pad's sticks and buttons */
  private input(dt: number): MoveInput {
    const k = this.keys, air = this.player.flying;
    let x = 0, z = 0, y = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) z += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) z -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    // (in the air Q rises and E sinks — down onto the ground it lands; on foot or in the water C goes down)
    if (k.has('Space') || (air && k.has('KeyQ'))) y += 1;
    if (air ? k.has('KeyE') : k.has('KeyC') || k.has('ControlLeft')) y -= 1;
    let run = k.has('ShiftLeft') || k.has('ShiftRight');
    let jump = this.jumpHit;
    this.jumpHit = false;
    if (pad.connected) {
      // the left stick moves (its throw curved: fine at the start), the right one looks (an expo curve, the field of
      // view's pace); A jumps (a second press takes off) and holds to rise, B sinks, the left trigger runs, the right
      // boosts in flight; Y is K
      const [sx, sy] = pad.stick('L'), m = Math.hypot(sx, sy), c = m > 0 ? Math.pow(m, 0.4) : 0;
      x += sx * c; z += sy * c;
      const [rx, ry] = pad.stick('R'), rm = Math.hypot(rx, ry);
      if (rm > 0) {
        const kk = ((0.25 * rm + 0.75 * rm * rm * rm) / rm) * (this.cam.fovY / 0.96) * dt;
        this.look.turn(-rx * kk * 2.6, -ry * kk * 1.7);
      }
      if (pad.hit(BTN.A)) jump = true;
      if (pad.down(BTN.A)) y += 1;
      if (air && pad.down(BTN.B)) y -= 1;
      if (pad.value(BTN.LT) > 0.3 || (air && pad.value(BTN.RT) > 0.3)) run = true;
      if (pad.hit(BTN.Y)) this.onK?.();
    }
    return { x: clamp(x, -1, 1), z: clamp(z, -1, 1), y: clamp(y, -1, 1), run, jump, fly: false };
  }

  /** every frame (before the camera's matrices are taken) */
  update(dt: number) {
    this.time += dt;
    const c = this.cam, P = this.player;
    // the look's turn gathered since last frame (the mouse, a finger, the pad's right stick) into the aim
    const [dy, dp] = this.look.take();
    if (!this.held) { this.camera.yaw += dy; this.camera.pitch += dp; }
    P.aimYaw = this.camera.yaw;
    P.aimPitch = this.camera.pitch;
    const seat = this.who === 'aang' ? this.power?.scooter ?? null : null;
    const inp = this.input(dt);
    if (this.held) Object.assign(inp, { x: 0, z: 0, y: 0, run: false, jump: false }, this.script?.move);
    // (the powers: the click, B or the pad's right bumper — Katara's the water, Aang's and Iroh's their own)
    const down = this.held ? !!this.script?.power : this.bendDown || (pad.connected && pad.down(BTN.RB));
    const J = this.rig.J, B = this.bending;
    if (this.who === 'katara' && B) {
      B.update(dt, {
        down, swirl: !this.held && this.keys.has('KeyQ') && !P.flying, busy: P.swimming === 2,
        chest: J.chest, aimFrom: [c.position[0], c.position[1], c.position[2]], aimDir: this.camera.aimDir(), handL: J.handL, handR: J.handR,
      });
    }
    const power = this.who !== 'katara' && this.power ? this.power.update(dt, down, this.camera.aimDir()) : null;
    const pose = this.who === 'katara' && B ? B.pose : power ?? STILL;
    P.faceAim = this.who === 'katara' && !!B?.aiming;
    P.update(dt, inp);
    // (Aang's hands on his glider's grip: put where he is now he's moved)
    if (this.who === 'aang') this.power?.place();
    const ground = (x: number, z: number) => this.world.groundAt(x, z, P.pos[1] + 0.3);
    this.rig.update({
      dt, time: this.time, pos: P.pos, yaw: P.yaw, vel: P.vel, speed: P.speed, running: P.running, onGround: P.onGround,
      wade: P.wade, landImpact: P.landImpact, pose, look: null, wind: this.wind, ground,
      flying: P.flying, flyPitch: P.flyPitch, flyRoll: P.flyRoll, boost: P.boostK, seat, glider: this.who === 'aang' && P.flying ? 1 : 0,
      hold: this.who === 'aang' ? this.power?.hold ?? null : null,
      swim: P.swimPose, swimPhase: P.swimPhase, waterLevel: P.waterSurface, body: null, posed: null,
    });
    P.landImpact = 0;
    this.mesh.jaw = this.rig.jawOpen;
    // (on the scooter's ball, the skirt drapes over the thighs and knees as sitting anywhere)
    this.mesh.legPad = this.legPad + (seat ? 0.045 * seat.w : 0);
    // (the air streaming past pushes the loose cloth back a little: at most 5 cm at the hem however fast they fly, eased
    // in and out over half a second)
    const sv = P.flying ? Math.hypot(P.vel[0], P.vel[1], P.vel[2]) : 0, sk = sv > 1e-3 ? -Math.min(sv * 0.004, 0.05) / sv : 0;
    const sw = [P.vel[0] * sk, P.vel[1] * sk, P.vel[2] * sk], se = 1 - Math.exp(-2 * dt);
    this.mesh.sway = [this.mesh.sway[0] + (sw[0] - this.mesh.sway[0]) * se, this.mesh.sway[1] + (sw[1] - this.mesh.sway[1]) * se, this.mesh.sway[2] + (sw[2] - this.mesh.sway[2]) * se];
    this.mesh.update(this.rig);
    // (the glider over his hands, after his rig's pose this frame)
    if (this.glider && this.power) { this.glider.at = this.power.gliderAt(); this.glider.update(); }
    if (this.freeCamera) return;
    const head = this.rig.joint('head') ?? add(P.pos, [0, 1.5, 0]);
    this.camera.update(dt, c, {
      pos: P.pos, yaw: P.yaw, head, vel: P.vel, speed: len(P.vel), flying: P.flying, boostK: P.boostK, flyRoll: P.flyRoll, aiming: P.faceAim,
      swim: P.swimming, water: P.swimming ? P.waterSurface : this.world.waterLevel(P.pos[0], P.pos[2]), skim: P.skim, overWater: P.overWater,
    }, this.world);
  }

  /** after the view's matrices are taken: the motion blur's shutter, and where the body is on screen (kept sharp) */
  afterView(w: number, h: number) {
    const B = this.blur;
    if (!B) return;
    if (this.freeCamera) { B.settings.shutter = 0; B.speed.w = 0; B.her = null; return; }
    const c = this.cam, P = this.player;
    // the camera's swing blurred only in fast flight, past the cruise (on foot, hovering and cruising the picture stays
    // crisp), and the speed lines in fast flight (dealt anew fifteen times a second), strongest at the boost
    const sp = len(P.vel);
    B.settings.shutter = P.flying ? 0.5 * smoothstep(P.tune.cruise * 1.05, P.tune.cruise * 2.3, sp) : 0;
    B.speed.w = P.flying ? clamp((sp - 60) / 220, 0, 1) * 0.6 : 0;
    B.speed.deal = Math.floor(this.time * 15 + 0.25);
    const proj = (m: Float32Array, p: V3): [number, number, number] | null => {
      const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
      const ww = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      return ww > 1e-4 ? [(x / ww * 0.5 + 0.5) * w, (0.5 - y / ww * 0.5) * h, ww] : null;
    };
    const chest = this.rig.J.chest;
    const now = proj(c.viewProj, chest), before = proj(c.prevViewProj, this.lastChest ?? chest);
    this.lastChest = [...chest] as V3;
    if (!now) { B.her = null; return; }
    const d = Math.hypot(chest[0] - c.position[0], chest[1] - c.position[1], chest[2] - c.position[2]);
    const r = (1.0 / Math.max(d, 0.3)) * (h / 2) / Math.tan(c.fovY / 2);
    B.her = { x: now[0], y: now[1], r, d, vx: before ? now[0] - before[0] : 0, vy: before ? now[1] - before[1] : 0 };
  }

  /** the chest (where a flame is cupped) */
  get chest(): V3 { return this.rig.J.chest; }
  get pos(): V3 { return this.player.pos; }
  /** the facing as a vector */
  get forward(): V3 { return this.player.forward; }
}
