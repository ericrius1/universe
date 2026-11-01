// Flying's interface (engine/camera.ts setFly): a crosshair in the middle of the view — what's under it is named beside
// it, and a click or a tap opens its card — with the speed under it while you move, and how to fly. With a mouse, the
// keys, faded once you're under way; on a touch screen boulder-mesh's controls: the lower left is the stick's (it rests
// faintly in the corner, comes to the thumb where it lands, follows a thumb that strays far, and pushed out past its
// ring goes four times as fast: the ring lights, a tail streams behind the knob), the rest of the view looks, ▲ ▼ held
// rise and sink, and × lands.
import type { Controls } from '../engine/camera';
import { fmtLength } from './hud';

/** the stick's ring (px from its middle to where the knob stops), past it by this much it's fast, and how far a thumb
 *  goes before the stick follows it */
const R = 52, FAST = 1.3, FOLLOW = 1.9;

const h = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

export class FlyUi {
  readonly el = h('div', 'fly');
  private speedEl = h('div', 'fly-speed');
  private hint = h('div', 'fly-hint');
  private zone = h('div', 'fly-zone');
  private stick = h('div', 'fly-stick', '<div class="fly-fast">Fast</div><div class="fly-knob"></div>');
  private knob: HTMLElement;
  private stickId: number | null = null;
  private base: [number, number] = [0, 0];
  private hintTimer = 0;
  private lastSpeed = '';
  /** × on a touch screen */
  onLeave: () => void = () => {};

  constructor(parent: HTMLElement, private controls: Controls, readonly touch: boolean) {
    this.knob = this.stick.querySelector('.fly-knob')!;
    this.el.classList.toggle('touch', touch);
    this.el.append(h('div', 'fly-cross'), this.speedEl);
    if (touch) {
      const up = h('button', 'fly-btn fly-up', '▲') as HTMLButtonElement, down = h('button', 'fly-btn fly-down', '▼') as HTMLButtonElement;
      const x = h('button', 'fly-btn fly-x', '×') as HTMLButtonElement;
      up.setAttribute('aria-label', 'rise'); down.setAttribute('aria-label', 'sink'); x.setAttribute('aria-label', 'land');
      this.el.append(this.zone, this.stick, up, down, x);
      this.hold(up, 1);
      this.hold(down, -1);
      x.addEventListener('click', () => this.onLeave());
      this.wireStick();
    } else {
      const k = (s: string) => `<kbd>${s}</kbd>`;
      this.hint.innerHTML = `<span>${k('W')}${k('A')}${k('S')}${k('D')} fly</span><span>${k('mouse')} look</span><span>${k('Q')}${k('E')} down · up</span>`
        + `<span>${k('Shift')} faster</span><span>${k('scroll')} speed</span><span>${k('click')} what's this</span><span>${k('Esc')} land</span>`;
      this.el.append(this.hint);
    }
    parent.append(this.el);
  }

  show(on: boolean) {
    this.el.classList.toggle('on', on);
    if (!on) { this.letGo(); return; }
    // (the keys stay up a while, then fade: the view is the world's)
    this.hint.classList.remove('quiet');
    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hint.classList.add('quiet'), 7000);
  }

  /** each frame while flying: the speed (nm/s) */
  update(speed: number) {
    const s = speed > 0.05 ? `${fmtLength(speed)}/s` : '';
    if (s === this.lastSpeed) return;
    this.lastSpeed = s;
    if (s) this.speedEl.textContent = s;
    this.speedEl.classList.toggle('on', !!s);
  }

  private hold(b: HTMLButtonElement, dir: number) {
    const v = this.controls.virtual;
    b.addEventListener('pointerdown', (e) => { try { b.setPointerCapture(e.pointerId); } catch { /* not capturable */ } v.y = dir; e.preventDefault(); });
    const off = () => { if (v.y === dir) v.y = 0; };
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
  }

  // the stick: comes to the thumb where it lands in the zone, follows it when it strays far
  private wireStick() {
    const v = this.controls.virtual;
    const move = (e: PointerEvent) => {
      let dx = e.clientX - this.base[0], dy = e.clientY - this.base[1];
      let l = Math.hypot(dx, dy);
      if (l > R * FOLLOW) {
        const k = (l - R * FOLLOW) / l;
        this.base[0] += dx * k; this.base[1] += dy * k;
        dx -= dx * k; dy -= dy * k; l = R * FOLLOW;
        this.place();
      }
      const kx = l > R ? R / l : 1;
      this.knob.style.transform = `translate(${dx * kx}px, ${dy * kx}px)`;
      // (the tail behind the knob: away from where it's pushed, longer the further)
      this.knob.style.setProperty('--a', `${(Math.atan2(-dy, -dx) * 180) / Math.PI}deg`);
      this.knob.style.setProperty('--m', Math.min(1, l / (R * FOLLOW)).toFixed(2));
      // a small dead zone, then a curve that gives fine control near the middle
      const m = Math.max(0, Math.min(1, l / R) - 0.12) / 0.88;
      const k = l > 0 ? (m * m * (1.5 - 0.5 * m)) / Math.max(l / R, 1e-4) : 0;
      v.x = (dx / R) * k;
      v.z = (-dy / R) * k;
      v.boost = l > R * FAST;
      this.stick.classList.toggle('fast', v.boost);
    };
    this.zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      try { this.zone.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      // (the ring kept whole on the screen: no nearer the edges than where it rests)
      const rest = this.stick.getBoundingClientRect();
      this.base = [Math.max(rest.left + rest.width / 2, e.clientX), Math.min(rest.top + rest.height / 2, e.clientY)];
      this.place();
      // (it grows in under the thumb)
      this.stick.classList.add('landing');
      void this.stick.offsetWidth;
      this.stick.classList.remove('landing');
      this.stick.classList.add('held');
      move(e);
      e.preventDefault();
    });
    this.zone.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) move(e); });
    const end = (e: PointerEvent) => { if (e.pointerId === this.stickId) this.letGo(); };
    this.zone.addEventListener('pointerup', end);
    this.zone.addEventListener('pointercancel', end);
  }

  private place() {
    const s = this.stick.style;
    s.left = `${this.base[0] - 64}px`;
    s.top = `${this.base[1] - 64}px`;
    s.bottom = 'auto';
  }

  private letGo() {
    this.stickId = null;
    this.knob.style.transform = '';
    this.knob.style.setProperty('--m', '0');
    this.stick.style.left = this.stick.style.top = this.stick.style.bottom = '';
    this.stick.classList.remove('held', 'fast');
    const v = this.controls.virtual;
    v.x = 0; v.z = 0; v.boost = false;
  }
}
