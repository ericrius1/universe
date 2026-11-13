// The camera above the cell: it always looks at the ladder's target (frames.ts), from a distance S anywhere from the
// edge of the observable universe to a fifth of a millimetre, at a yaw and pitch about the reference orientation of the
// frame it's in. Zoom is in decades (log10 S), eased; dragging orbits with inertia; flights glide the zoom along a
// smooth curve (fast through the empty decades, slow where things are). Below `min` the cell takes the camera.
import { quat, vec3, type Quat, type Vec3 } from 'math';
import type { Ladder } from './frames';

type Gesture = UIEvent & { scale: number };
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
/** how far above a floor the way down starts slowing into it (decades) */
const CUSHION = 1.5;

export class CosmosControls {
  /** log10 of the view distance (m) */
  logS = 25.6;
  yaw = 0.4;
  pitch = -0.55;
  readonly min = -3.8;
  /** the top of the zoom: the edge of the observable universe, or past it to the keepers' world (levels/beyond.ts) */
  max = 27.15;
  /** where a visit starts: the edge of the observable universe (the place's own view of it) */
  readonly start = 26.95;
  enabled = true;
  driven = false;
  /** how far down the zoom goes for now (null: all the way): a host's world below still loading (Universe's gardens),
   *  the dive slows into it over its last decades (CUSHION) and waits there — a flight too — and goes on once it's in.
   *  Only from above: coming up from the cell it's not in the way */
  floor: number | null = null;
  /** the same from below (null: none): a host's realm above still loading (a window opened low, let out to everything,
   *  main.ts), the way up slowing into it and waiting there */
  ceiling: number | null = null;
  /** the bottom of a window that stops above the cell (null: down to `min`, where the cell takes over): the zoom stops
   *  there, and nothing takes over below it */
  bottom: number | null = null;
  /** at the floor, the visitor still asking to go down (s): how long they've been held there */
  held = 0;
  /** the camera's orientation in the top frame, and its basis there (refreshed by update) */
  readonly q: Quat = quat.create();
  readonly forward: Vec3 = [0, 0, -1];
  readonly right: Vec3 = [1, 0, 0];
  readonly up: Vec3 = [0, 1, 0];
  /** the visitor zoomed in past `min` (the cell takes over) */
  onBelow: (() => void) | null = null;
  /** a way in (Universe's: down onto her face from her feet' side): over `band` (log10 m), zooming in by hand turns the
   *  view toward `at`'s yaw and pitch for the zoom, by as much of what's left to turn as of the zoom left to `arrive`,
   *  so it's there by then however it set out, and keeps to it below. Zooming out or holding still, the view is the
   *  visitor's */
  guide: { band: [number, number]; arrive: number; at: (logS: number) => [number, number] } | null = null;
  /** keeping to another camera this frame (follow) */
  private following = false;
  onUser: (() => void) | null = null;
  mouse: [number, number] = [0, 0];
  private zoomTarget = this.logS;
  private velYaw = 0;
  private velPitch = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch0 = 0;
  private gestureScale = 0;
  private keys = new Set<string>();
  private flight: { l0: number; l1: number; y0: number; y1: number; p0: number; p1: number; t: number; dur: number; done: (() => void) | null } | null = null;
  private readonly ref: Quat = quat.create();

  /** `input`: false when something else drives it (a planetarium's console): no listeners on the page */
  constructor(private canvas: HTMLCanvasElement, private ladder: Ladder, input = true) {
    if (!input) return;
    canvas.addEventListener('pointerdown', (e) => this.press(e));
    addEventListener('pointermove', (e) => this.drag(e));
    addEventListener('pointerup', (e) => this.release(e));
    addEventListener('pointercancel', (e) => this.release(e));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('gesturestart', (e) => { if (this.enabled) { e.preventDefault(); this.gestureScale = (e as Gesture).scale; } });
    canvas.addEventListener('gesturechange', (e) => {
      if (!this.enabled || !this.gestureScale) return;
      e.preventDefault();
      const s = (e as Gesture).scale;
      this.zoom(-Math.log10(s / this.gestureScale) * 1.6);
      this.gestureScale = s;
    });
    canvas.addEventListener('gestureend', () => { this.gestureScale = 0; });
    addEventListener('keydown', (e) => { if (!(e.target instanceof HTMLInputElement)) this.keys.add(e.key.toLowerCase()); });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
  }

  get flying() { return !!this.flight; }
  /** how far down the zoom goes: the window's bottom, or `min` */
  get lo() { return this.bottom ?? this.min; }
  get S() { return Math.pow(10, this.logS); }

  /** jump to a view */
  set(logS: number, yaw = this.yaw, pitch = this.pitch) {
    this.logS = this.zoomTarget = clamp(logS, this.lo, this.max);
    this.yaw = yaw; this.pitch = pitch; this.flight = null;
    this.velYaw = this.velPitch = 0;
  }

  /** glide to a zoom: its time from the decades crossed */
  /** keep to another camera's view (the cell's, while the two cross-fade): past `min` too, nothing set off */
  follow(logS: number, yaw: number, pitch: number) {
    this.following = true;
    this.logS = this.zoomTarget = clamp(logS, this.min - 1, this.max);
    this.yaw = yaw; this.pitch = pitch; this.flight = null;
  }
  flyTo(logS: number, o: { yaw?: number; pitch?: number; duration?: number; done?: () => void } = {}) {
    const l1 = clamp(logS, this.lo, this.max);
    const dur = o.duration ?? clamp(1.6 + Math.abs(l1 - this.logS) * 0.32, 1.6, 9);
    const y1 = o.yaw ?? this.yaw;
    // (the short way round)
    const dy = Math.atan2(Math.sin(y1 - this.yaw), Math.cos(y1 - this.yaw));
    this.flight = { l0: this.logS, l1, y0: this.yaw, y1: this.yaw + dy, p0: this.pitch, p1: o.pitch ?? this.pitch, t: 0, dur, done: o.done ?? null };
  }
  cancelFlight() { this.flight = null; this.zoomTarget = this.logS; }

  /** zoom by `decades` (+ out) */
  zoom(decades: number) {
    if (this.flight) this.cancelFlight();
    // (past `min` a little, for the cell to take over; not past a window's bottom)
    this.zoomTarget = clamp(this.zoomTarget + decades, this.bottom ?? this.min - 0.3, this.max);
    this.onUser?.();
  }

  private wheel(e: WheelEvent) {
    if (!this.enabled || this.driven) return;
    e.preventDefault();
    // a trackpad pinch arrives as ctrl-wheel; lines and pages as bigger steps
    const k = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0016;
    this.zoom(e.deltaY * k * (e.ctrlKey ? 2.2 : 1));
  }
  private press(e: PointerEvent) {
    if (!this.enabled || this.driven) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) this.pinch0 = this.spread();
    this.velYaw = this.velPitch = 0;
  }
  private spread() { const [a, b] = [...this.pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }
  private drag(e: PointerEvent) {
    this.mouse[0] = e.clientX; this.mouse[1] = e.clientY;
    const p = this.pointers.get(e.pointerId);
    if (!p || !this.enabled) return;
    if (this.pointers.size === 2) {
      p.x = e.clientX; p.y = e.clientY;
      const d = this.spread();
      if (this.pinch0 > 0 && d > 0) this.zoom(-Math.log10(d / this.pinch0) * 1.4);
      this.pinch0 = d;
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const k = 3.2 / Math.max(400, this.canvas.clientHeight);
    this.orbit(-dx * k, -dy * k);
    this.velYaw = -dx * k * 30; this.velPitch = -dy * k * 30;
    if (this.flight) this.cancelFlight();
    this.onUser?.();
  }
  private release(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch0 = 0;
  }
  orbit(dyaw: number, dpitch: number) {
    this.yaw += dyaw;
    this.pitch = clamp(this.pitch + dpitch, -1.55, 1.55);
  }

  /** how much of a step from `l` toward `to` is taken: 1, but on the way past a floor, over its cushion, slowing to
   *  nothing at it */
  private give(l: number, to: number) {
    if (this.ceiling !== null && l <= this.ceiling && to > l) {
      const x = Math.min(1, (this.ceiling - l) / CUSHION);
      return x * x * (3 - 2 * x);
    }
    if (this.floor === null || l < this.floor || to >= this.floor) return 1;
    const x = Math.min(1, (l - this.floor) / CUSHION);
    return x * x * (3 - 2 * x);
  }

  update(dt: number) {
    const was = this.logS;
    // (on the way past a floor, the zoom slows into it: a glide, not a wall)
    if (this.flight) {
      const f = this.flight;
      const fdt = dt * Math.max(0.02, this.give(was, f.l1));
      const u = Math.min(1, (f.t + fdt) / f.dur);
      // ease in and out, the zoom's speed even in decades
      const s = u * u * u * (u * (u * 6 - 15) + 10);
      const l = f.l0 + (f.l1 - f.l0) * s;
      // (held at the floor: the flight waits there)
      if (!(this.floor !== null && was >= this.floor && l < this.floor && l < was) && !(this.ceiling !== null && was <= this.ceiling && l > this.ceiling && l > was)) {
        f.t += fdt;
        this.logS = l;
        this.yaw = f.y0 + (f.y1 - f.y0) * s;
        this.pitch = f.p0 + (f.p1 - f.p0) * s;
        this.zoomTarget = this.logS;
        if (u >= 1) { this.flight = null; f.done?.(); }
      }
    } else if (!this.driven) {
      // (and what's asked for past it waits a little below it: once it's gone, the zoom goes on that far, not with a lurch
      // all the way to wherever the wheel got to meanwhile)
      if (this.floor !== null && was >= this.floor) this.zoomTarget = Math.max(this.zoomTarget, this.floor - 0.6);
      if (this.ceiling !== null && was <= this.ceiling) this.zoomTarget = Math.min(this.zoomTarget, this.ceiling + 0.6);
      this.logS += (this.zoomTarget - this.logS) * (1 - Math.exp(-dt * 7)) * this.give(was, this.zoomTarget);
      const g = this.guide;
      if (g && this.logS < was && was > g.band[0] && this.logS < g.band[1]) {
        const [y, p] = g.at(this.logS);
        const k = was <= g.arrive ? 1 : Math.min(1, (was - this.logS) / Math.max(1e-3, was - g.arrive));
        this.yaw += Math.atan2(Math.sin(y - this.yaw), Math.cos(y - this.yaw)) * k;
        this.pitch += (p - this.pitch) * k;
        this.velYaw = this.velPitch = 0;
      }
      if (!this.pointers.size) {
        const damp = Math.exp(-dt * 5);
        this.velYaw *= damp; this.velPitch *= damp;
        if (Math.abs(this.velYaw) + Math.abs(this.velPitch) > 1e-4) this.orbit(this.velYaw * dt, this.velPitch * dt);
      }
      this.keyboard(dt);
    }
    if (this.bottom === null && this.logS < this.min && this.zoomTarget < this.min && !this.driven && !this.following) { this.logS = this.min; this.onBelow?.(); }
    // (keeping to the cell's camera it goes on in past `min`, as the cell does)
    this.logS = clamp(this.logS, this.following ? this.min - 1 : this.lo, this.max);
    if (this.floor !== null && was >= this.floor) this.logS = Math.max(this.logS, this.floor);
    if (this.ceiling !== null && was <= this.ceiling) this.logS = Math.min(this.logS, this.ceiling);
    // (held: within a hair of the floor, asked to go further; or of the ceiling, asked to go up)
    const asking = this.flight ? this.flight.l1 < this.logS : this.zoomTarget < this.logS - 0.01;
    const up = this.flight ? this.flight.l1 > this.logS : this.zoomTarget > this.logS + 0.01;
    this.held = (this.floor !== null && this.logS - this.floor < 0.15 && asking) || (this.ceiling !== null && this.ceiling - this.logS < 0.15 && up) ? this.held + dt : 0;
    this.following = false;
    this.basis();
  }

  private keyboard(dt: number) {
    const k = this.keys;
    if (!k.size || !this.enabled) return;
    if (k.has('arrowleft') || k.has('a')) this.orbit(dt * 1.2, 0);
    if (k.has('arrowright') || k.has('d')) this.orbit(-dt * 1.2, 0);
    if (k.has('arrowup')) this.orbit(0, dt);
    if (k.has('arrowdown')) this.orbit(0, -dt);
    const z = (k.has('=') || k.has('+') || k.has('w') ? -1 : 0) + (k.has('-') || k.has('_') || k.has('s') ? 1 : 0);
    if (z) this.zoom(z * dt * (k.has('shift') ? 3 : 1.2));
  }

  /** the camera's basis in the top frame: yaw and pitch about the zoom's reference orientation */
  basis() {
    this.ladder.reference(this.logS, this.ref);
    const cp = Math.cos(this.pitch), sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    vec3.set(this.forward, -sy * cp, Math.sin(this.pitch), -cy * cp);
    vec3.set(this.right, cy, 0, -sy);
    vec3.cross(this.up, this.right, this.forward);
    vec3.transformQuat(this.forward, this.forward, this.ref);
    vec3.transformQuat(this.right, this.right, this.ref);
    vec3.transformQuat(this.up, this.up, this.ref);
  }
}
