// The camera above the cell: it always looks at the ladder's target (frames.ts), from a distance S anywhere from the
// edge of the observable universe to a fifth of a millimetre, at a yaw and pitch about the reference orientation of the
// frame it's in. Zoom is in decades (log10 S), eased; dragging orbits with inertia; flights glide the zoom along a
// smooth curve (fast through the empty decades, slow where things are). Below `min` the cell takes the camera.
import { quat, vec3, type Quat, type Vec3 } from 'math';
import type { Ladder } from './frames';

type Gesture = UIEvent & { scale: number };
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export class CosmosControls {
  /** log10 of the view distance (m) */
  logS = 25.6;
  yaw = 0.4;
  pitch = -0.55;
  readonly min = -3.8;
  readonly max = 27.15;
  enabled = true;
  driven = false;
  /** the camera's orientation in the top frame, and its basis there (refreshed by update) */
  readonly q: Quat = quat.create();
  readonly forward: Vec3 = [0, 0, -1];
  readonly right: Vec3 = [1, 0, 0];
  readonly up: Vec3 = [0, 1, 0];
  /** the visitor zoomed in past `min` (the cell takes over) */
  onBelow: (() => void) | null = null;
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
  get S() { return Math.pow(10, this.logS); }

  /** jump to a view */
  set(logS: number, yaw = this.yaw, pitch = this.pitch) {
    this.logS = this.zoomTarget = clamp(logS, this.min, this.max);
    this.yaw = yaw; this.pitch = pitch; this.flight = null;
    this.velYaw = this.velPitch = 0;
  }

  /** glide to a zoom: its time from the decades crossed */
  flyTo(logS: number, o: { yaw?: number; pitch?: number; duration?: number; done?: () => void } = {}) {
    const l1 = clamp(logS, this.min, this.max);
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
    this.zoomTarget = clamp(this.zoomTarget + decades, this.min - 0.3, this.max);
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

  update(dt: number) {
    if (this.flight) {
      const f = this.flight;
      f.t += dt;
      const u = Math.min(1, f.t / f.dur);
      // ease in and out, the zoom's speed even in decades
      const s = u * u * u * (u * (u * 6 - 15) + 10);
      this.logS = f.l0 + (f.l1 - f.l0) * s;
      this.yaw = f.y0 + (f.y1 - f.y0) * s;
      this.pitch = f.p0 + (f.p1 - f.p0) * s;
      this.zoomTarget = this.logS;
      if (u >= 1) { this.flight = null; f.done?.(); }
    } else if (!this.driven) {
      this.logS += (this.zoomTarget - this.logS) * (1 - Math.exp(-dt * 7));
      if (!this.pointers.size) {
        const damp = Math.exp(-dt * 5);
        this.velYaw *= damp; this.velPitch *= damp;
        if (Math.abs(this.velYaw) + Math.abs(this.velPitch) > 1e-4) this.orbit(this.velYaw * dt, this.velPitch * dt);
      }
      this.keyboard(dt);
    }
    if (this.logS < this.min && this.zoomTarget < this.min && !this.driven) { this.logS = this.min; this.onBelow?.(); }
    this.logS = clamp(this.logS, this.min, this.max);
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
