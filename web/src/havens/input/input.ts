// The gamepad, read once a frame (boulder's input layer, its device switching and glyphs left there): this frame's pad
// (standard mapping): down(b), hit(b) (pressed this frame), up(b), held(b) (seconds), value(b) and trigger(b) (the
// triggers), axes, stick('L' | 'R') (a radial dead zone); rumble(s, w, ms) a buzz, where the browser has one (Chrome).
// The pad's buttons, standard mapping:

/** a stick's dead zone (of its throw) */
const DEAD_ZONE = 0.15;

export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

const N = 17;
const REST: readonly number[] = [0, 0, 0, 0];

/** the gamepad this frame (the standard-mapped one used last) */
export class PadState {
  connected = false;
  /** the Gamepad itself (its rumble) */
  gp: Gamepad | null = null;
  /** at rest for everyone (the game menu has the pad), but what reads it `through` */
  muted = false;
  private open = false;
  private ax = [0, 0, 0, 0];
  private now = new Array<boolean>(N).fill(false);
  private was = new Array<boolean>(N).fill(false);
  private vals = new Float32Array(N);
  private since = new Float64Array(N);
  private index = -1;
  private clock = 0;

  /** read the pad (once a frame): true when it was used (a press, a stick or a trigger well over) */
  poll(dt: number): boolean {
    this.clock += dt;
    const pads = navigator.getGamepads?.() ?? [];
    let gp: Gamepad | null = null;
    // (the one in use stays; another takes over when one of its buttons goes down)
    for (const p of pads) if (p && p.connected && p.mapping === 'standard' && p.index !== this.index && p.buttons.some((b) => b.pressed)) gp = p;
    gp ??= [...pads].find((p) => p && p.connected && p.mapping === 'standard' && p.index === this.index) ?? null;
    gp ??= [...pads].find((p) => p && p.connected && p.mapping === 'standard') ?? null;
    this.gp = gp;
    this.connected = !!gp;
    this.index = gp?.index ?? -1;
    let used = false;
    for (let i = 0; i < N; i++) {
      const b = gp?.buttons[i];
      this.was[i] = this.now[i];
      this.now[i] = !!b?.pressed;
      this.vals[i] = b?.value ?? 0;
      if (this.now[i] && !this.was[i]) { this.since[i] = this.clock; used = true; }
    }
    for (let i = 0; i < 4; i++) this.ax[i] = gp?.axes[i] ?? 0;
    if (gp && (this.vals[6] > 0.25 || this.vals[7] > 0.25 || this.ax.some((a) => Math.abs(a) > 0.5))) used = true;
    return used;
  }

  /** read it for real while it's muted (the game menu) */
  through(fn: () => void) { this.open = true; try { fn(); } finally { this.open = false; } }
  private get quiet() { return this.muted && !this.open; }

  /** the sticks' axes (x right, y down; the standard mapping's) */
  get axes(): readonly number[] { return this.quiet ? REST : this.ax; }
  down(b: number) { return !this.quiet && this.now[b]; }
  /** pressed this frame */
  hit(b: number) { return !this.quiet && this.now[b] && !this.was[b]; }
  /** let go this frame */
  up(b: number) { return !this.quiet && !this.now[b] && this.was[b]; }
  /** how long it's been held (s), 0 when it's up */
  held(b: number) { return !this.quiet && this.now[b] ? this.clock - this.since[b] : 0; }
  /** how far it's pressed (0–1: the triggers) */
  value(b: number) { return this.quiet ? 0 : this.vals[b]; }
  /** a trigger past a small dead zone (a resting trigger's few percent count for nothing), 0–1 */
  trigger(b: number) { const v = this.value(b); return v < 0.06 ? 0 : (v - 0.06) / 0.94; }
  /** a stick (x right, y up), with a radial dead zone (a little less on the right): inside `dz`
   *  nothing, then 0–1 out to 0.95, its way kept */
  stick(side: 'L' | 'R', dz = side === 'L' ? DEAD_ZONE : DEAD_ZONE * 0.8): [number, number] {
    const a = this.axes, x = a[side === 'L' ? 0 : 2], y = -a[side === 'L' ? 1 : 3], m = Math.hypot(x, y);
    if (m <= dz) return [0, 0];
    const k = Math.min(1, (m - dz) / (0.95 - dz)) / m;
    return [x * k, y * k];
  }
  /** a button up for good (a menu took it): no edge for it until it's pressed again */
  swallow(b: number) { this.was[b] = this.now[b]; }
}

/** a buzz in the hands (0–1 for the heavy and the light motor, ms long); a weaker one doesn't cut a stronger one short */
let buzzUntil = 0, buzzAt = 0, buzzLevel = 0;
export function rumble(strong: number, weak = strong, ms = 120) {
  const gp = pad.gp as (Gamepad & { vibrationActuator?: { playEffect?(t: string, p: object): Promise<unknown> } }) | null;
  const a = gp?.vibrationActuator;
  if (!a?.playEffect) return;
  const t = performance.now(), level = Math.max(strong, weak);
  if ((t < buzzUntil && level < buzzLevel) || t - buzzAt < 60) return;
  buzzAt = t; buzzUntil = t + ms; buzzLevel = level;
  const c = (v: number) => Math.max(0, Math.min(1, v));
  a.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: c(strong), weakMagnitude: c(weak) }).catch(() => {});
}

/** the pad, for everyone (poll it first thing each frame) */
export const pad = new PadState();
