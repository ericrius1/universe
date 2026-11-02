// The camera for a world eight orders of magnitude deep: it orbits a pivot at distance `scale`, and everything about
// moving is relative to that scale. Zoom keeps the point under the cursor fixed (a homothety about it), eased
// exponentially; pressed against a surface it goes through. Dragging orbits the point that was under the pointer.
// Flights between places follow van Wijk & Nuij's optimal zoom-and-pan path (zoom out, glide, zoom in), so going from
// a ribosome to a mitochondrion across the cell passes through the scale that shows both.
// Flying (setFly) is first person instead: the view turns about the eye (the mouse under pointer lock, or a drag) and
// the eye flies (W A S D, Q / E, the on-screen stick: ui/fly.ts). The scale becomes the distance to what's under the
// crosshair, eased, and the speed follows it: fast across the tissue, nanometres a second against a membrane (never
// slower than FLY_FLOOR, so you go through it), quick again on the far side. The wheel sets a speed factor, as in
// boulder-mesh.
// Vectors are `math` tuples the controls own (forward, right, up, eye: refreshed by basis()); nothing per frame allocates.
import type { Camera } from '@ericrius1/weft';
import { vec3, wrapAngle, type Vec3 } from 'math';

export interface Pick { world: Vec3; id: number; depth: number }

/** Safari's GestureEvent (not in the DOM typings) */
type Gesture = UIEvent & { scale: number; clientX?: number; clientY?: number };

interface Flight {
  c0: Vec3; c1: Vec3; w0: number; w1: number; u1: number; S: number; r0: number; rho: number;
  yaw0: number; yaw1: number; pitch0: number; pitch1: number;
  t: number; dur: number; done: (() => void) | null;
}

const RHO = 1.42;
/** a zoom's anchor no further than this many scales from the eye (zoomAt) */
const ANCHOR_REACH = 3;
const _controls_d = vec3.create();
const _controls_m = vec3.create();
const _controls_eye = vec3.create();
const UP: Vec3 = [0, 1, 0];
/** flying: scales a second at full stick (Shift or the stick's rim: four times that), and the slowest it goes (nm/s) */
const FLY_SPEED = 0.9, FLY_BOOST = 4, FLY_FLOOR = 6;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export class Controls {
  readonly pivot: Vec3 = [0, 0, 0];
  scale = 60000;
  yaw = 0.6;
  pitch = -0.25;
  minScale = 1.2;
  maxScale = 160000;
  /** how far past maxScale it may be put (keeping to the cosmos's view while they cross-fade) */
  reach = 1;
  /** the camera's basis and eye, as of the last basis() */
  readonly forward: Vec3 = [0, 0, -1];
  readonly right: Vec3 = [1, 0, 0];
  readonly up: Vec3 = [0, 1, 0];
  readonly position: Vec3 = [0, 0, 0];
  /** wanted log-scale (zoom eases toward it) and the point zooming keeps fixed */
  private zoomTarget = Math.log(this.scale);
  private readonly zoomAnchor: Vec3 = [0, 0, 0];
  private anchored = false;
  private velYaw = 0;
  private velPitch = 0;
  private readonly flight: Flight = { c0: [0, 0, 0], c1: [0, 0, 0], w0: 1, w1: 1, u1: 0, S: 0, r0: 0, rho: RHO, yaw0: 0, yaw1: 0, pitch0: 0, pitch1: 0, t: 0, dur: 0, done: null };
  private inFlight = false;
  private keys = new Set<string>();
  private pointers = new Map<number, { x: number; y: number; t: number }>();
  private pinch0 = 0;
  /** a Safari trackpad pinch's scale so far (0: none under way) */
  private gestureScale = 0;
  private lastTap = 0;
  private readonly lastTapAt: [number, number] = [0, 0];
  private dragMoved = 0;
  mouse: [number, number] = [0, 0];
  /** set by the app: what's at a pixel (from the last read under the cursor) */
  pick: (x: number, y: number) => Pick | null = () => null;
  onClick: ((x: number, y: number, p: Pick | null) => void) | null = null;
  onDoubleClick: ((x: number, y: number, p: Pick | null) => void) | null = null;
  /** the visitor moved the camera (tours give way) */
  onUser: (() => void) | null = null;
  /** zooming out past the widest view (the world above the cell takes the camera) */
  onAbove: (() => void) | null = null;
  enabled = true;
  /** films and tours drive the camera themselves */
  driven = false;
  /** first person (setFly) */
  fly = false;
  /** the on-screen stick and buttons while flying (ui/fly.ts): x right, z forward, y up, and past the stick's rim */
  readonly virtual = { x: 0, y: 0, z: 0, boost: false };
  /** flying: the wheel's speed factor, and how fast the eye is going now (nm/s) */
  flySpeed = 1;
  speed = 0;
  /** flying started or ended (by setFly, or the browser letting go of the pointer lock: Esc) */
  onFly: ((on: boolean) => void) | null = null;
  onFlySpeed: ((factor: number) => void) | null = null;
  /** flying, the eye's velocity in its own frame (right, up, forward), in scales a second: eased toward the input */
  private readonly flyVel: Vec3 = [0, 0, 0];
  private locked = false;
  private wantLock = false;
  private fovY = 1;

  constructor(private canvas: HTMLCanvasElement) {
    document.addEventListener('pointerlockchange', () => {
      const now = document.pointerLockElement === canvas;
      // (Esc, or another window taking the focus, lets go of the lock: that lands)
      if (this.locked && !now && this.fly) this.setFly(false);
      this.locked = now;
    });
    canvas.addEventListener('pointerdown', (e) => this.press(e));
    addEventListener('pointermove', (e) => this.drag(e));
    addEventListener('pointerup', (e) => this.release(e));
    addEventListener('pointercancel', (e) => this.release(e));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    // Safari reports a trackpad pinch as gesture events rather than the ctrl-wheel the other browsers send
    canvas.addEventListener('gesturestart', (e) => this.gesture(e as Gesture, true));
    canvas.addEventListener('gesturechange', (e) => this.gesture(e as Gesture, false));
    canvas.addEventListener('gestureend', () => { this.gestureScale = 0; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.key.toLowerCase());
      // (flying, Space rises: it mustn't also press whichever button has the focus)
      if (this.fly && e.key === ' ') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
    this.basis();
  }

  /** refresh forward / right / up / position from yaw, pitch, pivot and scale */
  basis() {
    const cp = Math.cos(this.pitch), sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    vec3.set(this.forward, -sy * cp, Math.sin(this.pitch), -cy * cp);
    vec3.set(this.right, cy, 0, -sy);
    vec3.cross(this.up, this.right, this.forward);
    vec3.scaleAndAdd(this.position, this.pivot, this.forward, -this.scale);
  }
  get flying() { return this.inFlight; }

  /** jump straight to a view */
  set(pivot: Vec3, scale: number, yaw = this.yaw, pitch = this.pitch) {
    vec3.copy(this.pivot, pivot);
    this.scale = scale; this.yaw = yaw; this.pitch = pitch;
    this.zoomTarget = Math.log(scale); this.anchored = false; this.inFlight = false;
    this.basis();
  }

  /** fly to a view along the optimal zoom-and-pan path; its length sets the time */
  flyTo(pivot: Vec3, scale: number, o: { yaw?: number; pitch?: number; speed?: number; duration?: number; done?: () => void } = {}) {
    const f = this.flight;
    vec3.copy(f.c0, this.pivot);
    vec3.copy(f.c1, pivot);
    f.w0 = this.scale; f.w1 = scale;
    f.u1 = vec3.distance(f.c0, f.c1);
    f.r0 = 0;
    if (f.u1 < 1e-6 * Math.max(f.w0, f.w1)) {
      f.S = Math.abs(Math.log(f.w1 / f.w0)) / RHO;
    } else {
      const b = (wi: number, sign: number) => (f.w1 * f.w1 - f.w0 * f.w0 + sign * RHO ** 4 * f.u1 * f.u1) / (2 * wi * RHO * RHO * f.u1);
      const r = (bi: number) => Math.log(-bi + Math.sqrt(bi * bi + 1));
      f.r0 = r(b(f.w0, 1));
      f.S = (r(b(f.w1, -1)) - f.r0) / RHO;
    }
    f.yaw0 = this.yaw; f.yaw1 = this.yaw + wrapAngle((o.yaw ?? this.yaw) - this.yaw);
    f.pitch0 = this.pitch; f.pitch1 = o.pitch ?? this.pitch;
    f.t = 0;
    f.dur = o.duration ?? Math.max(0.6, Math.min(10, (0.55 + f.S * 0.62) / (o.speed ?? 1)));
    f.done = o.done ?? null;
    this.inFlight = true;
    this.anchored = false;
  }
  cancelFlight() { this.inFlight = false; this.zoomTarget = Math.log(this.scale); }

  private stepFlight(dt: number) {
    const f = this.flight;
    f.t = Math.min(f.dur, f.t + dt);
    const x = f.t / f.dur;
    const e = x * x * (3 - 2 * x);
    const s = e * f.S;
    let u = 0, w: number;
    if (f.u1 < 1e-6 * Math.max(f.w0, f.w1)) {
      w = f.w0 * Math.exp(Math.sign(f.w1 - f.w0) * RHO * s);
    } else {
      const k = f.w0 / (RHO * RHO);
      u = k * Math.cosh(f.r0) * Math.tanh(RHO * s + f.r0) - k * Math.sinh(f.r0);
      w = (f.w0 * Math.cosh(f.r0)) / Math.cosh(RHO * s + f.r0);
    }
    if (f.u1 > 0) vec3.lerp(this.pivot, f.c0, f.c1, u / f.u1);
    else vec3.copy(this.pivot, f.c1);
    this.scale = w;
    this.yaw = f.yaw0 + (f.yaw1 - f.yaw0) * e;
    this.pitch = f.pitch0 + (f.pitch1 - f.pitch0) * e;
    this.zoomTarget = Math.log(this.scale);
    if (f.t >= f.dur) {
      vec3.copy(this.pivot, f.c1);
      this.scale = f.w1;
      this.zoomTarget = Math.log(f.w1);
      this.inFlight = false;
      const done = f.done;
      f.done = null;
      done?.();
    }
  }

  // ---------------------------------------------------------------- input
  private user() { this.onUser?.(); if (this.inFlight) this.cancelFlight(); }
  private press(e: PointerEvent) {
    if (!this.enabled) return;
    // (under the pointer lock there's nothing to capture, and asking throws)
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp });
    this.dragMoved = 0;
    if (this.fly) {
      // flying with the mouse, a click on the view takes the lock back if the browser refused it at first
      if (this.wantLock && !this.locked && e.pointerType === 'mouse') this.lock();
      return;
    }
    this.mouse = [e.clientX, e.clientY];
    if (this.pointers.size === 1) {
      // orbit what's under the pointer: move the pivot there, keeping the eye where it is
      const p = this.pick(e.clientX, e.clientY);
      if (p && !this.driven) this.repivot(p.world);
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }
  /** move the pivot to a world point without moving the eye */
  repivot(p: Vec3) {
    this.basis();
    vec3.subtract(_controls_d, p, this.position);
    const l = vec3.length(_controls_d);
    if (l < this.minScale * 0.5) return;
    vec3.scale(_controls_d, _controls_d, 1 / l);
    this.yaw = Math.atan2(-_controls_d[0], -_controls_d[2]);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, _controls_d[1])));
    vec3.copy(this.pivot, p);
    this.scale = l;
    this.zoomTarget = Math.log(l);
    this.basis();
  }
  private drag(e: PointerEvent) {
    if (this.fly) { this.flyDrag(e); return; }
    this.mouse = [e.clientX, e.clientY];
    const prev = this.pointers.get(e.pointerId);
    if (!prev || !this.enabled) return;
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    prev.x = e.clientX; prev.y = e.clientY;
    this.dragMoved += Math.abs(dx) + Math.abs(dy);
    if (this.dragMoved < 4 || this.driven) return;
    this.user();
    if (this.pointers.size === 1) {
      if (e.buttons & 2 || e.shiftKey) this.pan(dx, dy);
      else { this.velYaw = -dx * 0.005; this.velPitch = -dy * 0.005; this.orbit(this.velYaw, this.velPitch); }
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      this.mouse = [cx, cy];
      if (this.pinch0 > 0 && d > 0) this.zoomAt(cx, cy, Math.log(this.pinch0 / d));
      this.pinch0 = d;
      this.pan(dx / 2, dy / 2);
    }
  }
  private release(e: PointerEvent) {
    const had = this.pointers.has(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!had || this.dragMoved > 6 || !this.enabled) return;
    // (flying, a click or a tap is on what's under the crosshair)
    const now = performance.now(), x = this.fly ? this.mouse[0] : e.clientX, y = this.fly ? this.mouse[1] : e.clientY;
    const double = now - this.lastTap < 320 && Math.hypot(x - this.lastTapAt[0], y - this.lastTapAt[1]) < 30;
    this.lastTap = double ? 0 : now;
    this.lastTapAt[0] = x; this.lastTapAt[1] = y;
    const fire = (p: Pick | null) => (double ? this.onDoubleClick : this.onClick)?.(x, y, p);
    // a tap lands without hovering first, so what's under it may not be read yet: give the read a few frames
    let tries = 0;
    const settle = () => { const p = this.pick(x, y); if (p || ++tries > 6) fire(p); else requestAnimationFrame(settle); };
    settle();
  }
  private wheel(e: WheelEvent) {
    e.preventDefault();
    if (!this.enabled || this.driven || (e.ctrlKey && this.gestureScale)) return;
    if (this.fly) {
      const k = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0016;
      this.flySpeed = clamp(this.flySpeed * Math.exp(-e.deltaY * k), 0.1, 10);
      this.onFlySpeed?.(this.flySpeed);
      return;
    }
    this.user();
    // a trackpad pinch arrives as ctrl-wheel whose deltaY is 100 × the log of the pinch: zoom by exactly that, so the
    // view follows the fingers (a two-finger swipe or a mouse wheel is the plain wheel)
    const k = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : e.ctrlKey ? 0.01 : 0.0016;
    this.zoomAt(e.clientX, e.clientY, Math.max(-0.6, Math.min(0.6, e.deltaY * k)));
  }
  private gesture(e: Gesture, start: boolean) {
    e.preventDefault();
    const was = this.gestureScale;
    this.gestureScale = e.scale;
    // touch screens pinch through pointer events (press / drag) instead
    if (start || !was || this.pointers.size || !this.enabled || this.driven || this.fly) return;
    this.user();
    this.zoomAt(e.clientX ?? this.mouse[0], e.clientY ?? this.mouse[1], Math.log(was / e.scale));
  }
  orbit(dyaw: number, dpitch: number) {
    this.yaw += dyaw;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + dpitch));
  }
  pan(dx: number, dy: number) {
    const k = (this.scale * 1.1) / this.canvas.clientHeight;
    vec3.scaleAndAdd(this.pivot, this.pivot, this.right, -dx * k);
    vec3.scaleAndAdd(this.pivot, this.pivot, this.up, dy * k);
  }

  // ---------------------------------------------------------------- flying
  /** first person on or off; `lock` takes the pointer (a mouse: a touch screen looks by dragging) */
  setFly(on: boolean, lock = false) {
    if (on === this.fly) return;
    this.fly = on;
    this.cancelFlight();
    this.anchored = false;
    this.velYaw = this.velPitch = 0;
    vec3.set(this.flyVel, 0, 0, 0);
    Object.assign(this.virtual, { x: 0, y: 0, z: 0, boost: false });
    this.speed = 0;
    this.wantLock = on && lock;
    if (on) {
      this.centre();
      if (lock) this.lock();
    } else if (this.locked) document.exitPointerLock();
    this.onFly?.(on);
  }
  private lock() {
    try { (this.canvas.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {}); } catch { /* refused: drag to look */ }
  }
  /** flying, the "cursor" is the crosshair: the middle of the view */
  private centre() {
    const r = this.canvas.getBoundingClientRect();
    this.mouse = [r.left + r.width / 2, r.top + r.height / 2];
  }
  private flyDrag(e: PointerEvent) {
    if (!this.enabled || this.driven) return;
    if (this.locked) {
      // (a browser's occasional jump of hundreds of pixels under the lock isn't a look)
      if (Math.abs(e.movementX) + Math.abs(e.movementY) < 400) this.look(e.movementX, e.movementY);
      this.user();
      return;
    }
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y, dt = e.timeStamp - prev.t;
    prev.x = e.clientX; prev.y = e.clientY; prev.t = e.timeStamp;
    this.dragMoved += Math.abs(dx) + Math.abs(dy);
    // (one finger looks; a second on the view does nothing)
    if (this.pointers.keys().next().value !== e.pointerId || this.dragMoved < 4) return;
    // a finger, as in boulder-mesh: a slow drag turns the view by as much as it moves, for aiming; a fast swipe up to
    // 1.6 times that, to turn round
    let gain = 1;
    if (e.pointerType === 'touch') {
      const a = clamp((Math.hypot(dx, dy) / Math.max(4, dt) - 0.6) / 1.6, 0, 1);
      gain = 1.4 * (1 + 0.6 * a * a * (3 - 2 * a));
    }
    this.look(dx * gain, dy * gain);
    this.user();
  }
  /** turn the view about the eye by a mouse's or a finger's move (px): right turns right, up looks up */
  private look(dx: number, dy: number) {
    const k = 0.0032 * this.fovY;
    this.turn(-dx * k, -dy * k);
  }
  /** turn about the eye (radians): the pivot stays `scale` ahead of it */
  private turn(dyaw: number, dpitch: number) {
    this.basis();
    vec3.copy(_controls_eye, this.position);
    this.yaw += dyaw;
    this.pitch = clamp(this.pitch + dpitch, -1.5, 1.5);
    this.basis();
    vec3.scaleAndAdd(this.pivot, _controls_eye, this.forward, this.scale);
  }

  private flyStep(dt: number) {
    this.centre();
    this.basis();
    // the scale: the distance to what's under the crosshair, eased in log space (faster closing in than opening out,
    // so a surface ahead isn't overrun, nor a gap glimpsed between two organelles a sudden lurch forward)
    const p = this.pick(this.mouse[0], this.mouse[1]);
    if (p) {
      const d = clamp(vec3.distance(p.world, this.position), this.minScale, this.maxScale);
      const s = this.scale * Math.pow(d / this.scale, 1 - Math.exp(-dt * (d < this.scale ? 7 : 2.5)));
      vec3.scaleAndAdd(this.pivot, this.position, this.forward, s);
      this.scale = s;
    }
    // the keys and the stick, eased in and out
    const k = this.keys, v = this.virtual;
    let mx = v.x, my = v.y, mz = v.z;
    if (k.has('w')) mz += 1;
    if (k.has('s')) mz -= 1;
    if (k.has('d')) mx += 1;
    if (k.has('a')) mx -= 1;
    if (k.has('e') || k.has(' ')) my += 1;
    if (k.has('q')) my -= 1;
    const want = FLY_SPEED * this.flySpeed * (k.has('shift') || v.boost ? FLY_BOOST : 1);
    const ease = 1 - Math.exp(-dt * 7), fv = this.flyVel;
    fv[0] += (clamp(mx, -1, 1) * want - fv[0]) * ease;
    fv[1] += (clamp(my, -1, 1) * want - fv[1]) * ease;
    fv[2] += (clamp(mz, -1, 1) * want - fv[2]) * ease;
    const unit = Math.max(this.scale, FLY_FLOOR);
    this.speed = vec3.length(fv) * unit;
    if (this.speed > 1e-3 * unit) {
      if (mx || my || mz) this.user();
      const s = unit * dt;
      vec3.scaleAndAdd(this.pivot, this.pivot, this.right, fv[0] * s);
      vec3.scaleAndAdd(this.pivot, this.pivot, UP, fv[1] * s);
      vec3.scaleAndAdd(this.pivot, this.pivot, this.forward, fv[2] * s);
    }
    // the arrows turn
    const tx = (k.has('arrowleft') ? 1 : 0) - (k.has('arrowright') ? 1 : 0), ty = (k.has('arrowup') ? 1 : 0) - (k.has('arrowdown') ? 1 : 0);
    if (tx || ty) this.turn(tx * dt * 1.4, ty * dt * 1.1);
    this.zoomTarget = Math.log(this.scale);
  }

  /** zoom by `amount` (log units, + is out) keeping the point under (x, y) where it is */
  zoomAt(x: number, y: number, amount: number) {
    if (amount > 0 && this.zoomTarget >= Math.log(this.maxScale) - 0.02 && this.onAbove) { this.onAbove(); return; }
    const p = this.pick(x, y);
    this.basis();
    if (p && amount < 0) {
      vec3.subtract(_controls_d, p.world, this.position);
      const d = vec3.length(_controls_d);
      // pressed right up against a surface: go through it instead of creeping ever closer
      if (d < this.scale * 0.08 && d < 40) {
        vec3.scale(_controls_d, _controls_d, 1 / Math.max(d, 1e-6));
        const step = Math.max(d * 2.5, 8);
        vec3.scaleAndAdd(this.pivot, this.position, _controls_d, step + this.scale);
        this.yaw = Math.atan2(-_controls_d[0], -_controls_d[2]);
        this.pitch = Math.asin(Math.max(-1, Math.min(1, _controls_d[1])));
        this.anchored = false;
        return;
      }
    }
    this.anchored = !!p;
    if (p) {
      // (the zoom keeps the anchor where it is on the screen by scaling the view about it, so the eye moves a share of
      // its distance to it each step. Among molecules the pick can find something far past the one you're looking at,
      // through a gap, hundreds of scales off: then each step would throw the eye forward many times its own view, and
      // the next pick, near again, stop it — a judder. So an anchor further than a few scales is taken on the same
      // ray, a few scales out: the same point stays under the cursor, the eye moves as the view does)
      vec3.subtract(_controls_d, p.world, this.position);
      const d = vec3.length(_controls_d), reach = this.scale * ANCHOR_REACH;
      if (d > reach) vec3.scaleAndAdd(this.zoomAnchor, this.position, _controls_d, reach / d);
      else vec3.copy(this.zoomAnchor, p.world);
    }
    this.zoomTarget = Math.max(Math.log(this.minScale), Math.min(Math.log(this.maxScale), this.zoomTarget + amount));
  }

  // ---------------------------------------------------------------- per frame
  update(dt: number, cam: Camera) {
    this.fovY = cam.fovY;
    if (this.inFlight) this.stepFlight(dt);
    else if (this.fly && !this.driven) this.flyStep(dt);
    else if (!this.driven) {
      // eased zoom about the anchor: the eye and the pivot both scale toward it
      const cur = Math.log(this.scale);
      const f = Math.exp((this.zoomTarget - cur) * (1 - Math.exp(-dt * 9)));
      if (Math.abs(f - 1) > 1e-6) {
        if (this.anchored) {
          this.basis();
          vec3.subtract(_controls_eye, this.position, this.zoomAnchor);
          vec3.scaleAndAdd(_controls_eye, this.zoomAnchor, _controls_eye, f);
          vec3.subtract(_controls_d, this.pivot, this.zoomAnchor);
          vec3.scaleAndAdd(this.pivot, this.zoomAnchor, _controls_d, f);
          this.scale = vec3.distance(this.pivot, _controls_eye);
        } else this.scale *= f;
      }
      // inertia after a drag
      if (!this.pointers.size) {
        const damp = Math.exp(-dt * 6);
        this.velYaw *= damp; this.velPitch *= damp;
        if (Math.abs(this.velYaw) + Math.abs(this.velPitch) > 1e-4) this.orbit(this.velYaw, this.velPitch);
      }
      this.keyboard(dt);
    }
    this.scale = Math.max(this.minScale, Math.min(this.maxScale * this.reach, this.scale));
    this.basis();
    vec3.copy(cam.position as Vec3, this.position);
    cam.yaw = this.yaw;
    cam.pitch = this.pitch;
    cam.near = Math.max(0.02, this.scale * 0.006);
  }

  // keys: fly (WASD, Q/E), turn (arrows), zoom (+/-), all relative to the scale
  private keyboard(dt: number) {
    const k = this.keys;
    if (!k.size) return;
    this.basis();
    const m = vec3.set(_controls_m, 0, 0, 0);
    if (k.has('w')) vec3.add(m, m, this.forward);
    if (k.has('s')) vec3.subtract(m, m, this.forward);
    if (k.has('d')) vec3.add(m, m, this.right);
    if (k.has('a')) vec3.subtract(m, m, this.right);
    if (k.has('e')) vec3.add(m, m, UP);
    if (k.has('q')) vec3.subtract(m, m, UP);
    if (vec3.squaredLength(m) > 0) {
      vec3.scaleAndAdd(this.pivot, this.pivot, m, this.scale * dt * (k.has('shift') ? 2.5 : 1));
      this.user();
    }
    if (k.has('arrowleft')) this.orbit(dt * 1.2, 0);
    if (k.has('arrowright')) this.orbit(-dt * 1.2, 0);
    if (k.has('arrowup')) this.orbit(0, dt * 1.0);
    if (k.has('arrowdown')) this.orbit(0, -dt * 1.0);
    if (k.has('=') || k.has('+')) this.zoomTarget -= dt * 1.5;
    if (k.has('-') || k.has('_')) { if (this.zoomTarget >= Math.log(this.maxScale) - 0.02 && this.onAbove) this.onAbove(); else this.zoomTarget += dt * 1.5; }
  }
}
