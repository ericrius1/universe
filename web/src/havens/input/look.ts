// Looking about (boulder's camera/controls.ts, its look alone): with the pointer locked to the view (a click on the
// world locks it, ui/pointer.ts; Esc lets it go) the mouse turns the view, or drag to look without it; on a touch
// screen a finger drags it, a fast swipe turning further. The turns gather here, scaled by the field of view (narrower,
// slower), and whoever has the camera takes them each frame (take()).
import { pointer } from '../ui/pointer';

export class Look {
  /** how fast (1 the default) and whether up is down */
  scale = 1;
  invertY = false;
  private yaw = 0;
  private pitch = 0;
  private dragging = false;
  private last: [number, number] = [0, 0];
  /** the fingers on the view: where each was last, and when (ms) */
  private touches = new Map<number, [number, number, number]>();

  constructor(readonly el: HTMLElement, private fovY: () => number) {
    pointer.install(el);
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      this.dragging = true;
      this.last = [e.clientX, e.clientY];
      // (under the pointer lock there's nothing to capture, and asking throws)
      try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      if (document.pointerLockElement === el) { this.look(e.movementX, e.movementY); return; }
      // (a move with no button down ends a drag whose release never arrived, as when it was let go outside the window)
      if (!this.dragging || !e.buttons) { this.dragging = false; return; }
      this.look(e.clientX - this.last[0], e.clientY - this.last[1]);
      this.last = [e.clientX, e.clientY];
    });
    el.addEventListener('pointerup', () => { this.dragging = false; });
    el.addEventListener('pointercancel', () => { this.dragging = false; });
    el.addEventListener('touchstart', (e) => { for (const t of e.changedTouches) this.touches.set(t.identifier, [t.clientX, t.clientY, e.timeStamp]); e.preventDefault(); }, { passive: false });
    el.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        const p = this.touches.get(t.identifier);
        if (!p) continue;
        if (t.identifier === this.touches.keys().next().value) {
          // (a slow drag turns the view by as much as it moves, for aiming; a fast swipe up to 1.6 times that, to turn round)
          const dx = t.clientX - p[0], dy = t.clientY - p[1], v = Math.hypot(dx, dy) / Math.max(4, e.timeStamp - p[2]);
          const a = Math.min(1, Math.max(0, (v - 0.6) / 1.6)), gain = 1.4 * (1 + 0.6 * a * a * (3 - 2 * a));
          this.look(dx * gain, dy * gain);
        }
        this.touches.set(t.identifier, [t.clientX, t.clientY, e.timeStamp]);
      }
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchend', (e) => { for (const t of e.changedTouches) this.touches.delete(t.identifier); });
    el.addEventListener('touchcancel', (e) => { for (const t of e.changedTouches) this.touches.delete(t.identifier); });
  }

  private look(dx: number, dy: number) {
    const k = 0.0032 * this.fovY() * this.scale;
    this.turn(-dx * k, (this.invertY ? dy : -dy) * k);
  }

  /** a turn (radians: + yaw left, + pitch up), as a drag turns it: the pad's right stick */
  turn(yaw: number, pitch: number) {
    this.yaw += yaw;
    this.pitch += pitch;
  }

  /** the turn gathered since last asked, and none from now */
  take(): [number, number] {
    const t: [number, number] = [this.yaw, this.pitch];
    this.yaw = 0;
    this.pitch = 0;
    return t;
  }
}
