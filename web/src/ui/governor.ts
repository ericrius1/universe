// The governor, the same in every project on ericlevin.dev (Boulder's util/tier.ts does it its own way, on its
// profiles): whatever the device, at least 30 frames a second, its workload found from how it really runs rather than
// from what it's called. The project's dynamic resolution holds its frame rate first; when that can't even at its
// least resolution — a quarter of the frames late, slower than 30 a second, for 8 s at the floor (not in the first 20 s,
// while things load) — the governor takes a step: the project's own list, lightest last (fewer pixels a CSS pixel, its
// dearest effect off, a lighter simulation), one every 20 s at most so each step's effect is seen before the next.
// With room to spare — full resolution and the GPU's own time (timestamps it trusts) under 8 ms, enough for 60 a
// second, for half a minute — it gives the last step back, once a minute at most. Where it settles is kept for this
// browser (localStorage, by the project's name), and the next visit starts there; a guess at the device (gpu.ts
// lightGpu) is only where a first visit starts. ?gov=<n> starts at a step and holds it; ?gov=off never steps.
// Self-contained so each project carries a copy: the canonical one is PortfolioII/src/shared/governor.ts.

/** what the governor reads of a weft kit */
interface KitLike {
  dt: number;
  renderScale: number;
  profiler: { available: boolean; trusted?: boolean; frameMs: number };
}

export interface Step {
  /** what it does (for window.__governor and the notice) */
  name: string;
  /** taken (true) or given back (false) */
  set(on: boolean): void;
}

export interface GovernorOptions {
  /** the project's name: what's kept is kept under it */
  name: string;
  steps: Step[];
  /** the step a first visit starts at (0: everything on) */
  start?: number;
  /** the dynamic resolution at its least: only then is a late frame the workload's fault */
  atFloor(): boolean;
  /** and at its most (for room to spare) */
  atCeiling(): boolean;
  /** told of each step, taken or given back */
  onStep?(level: number, step: Step, taken: boolean): void;
}

const LATE = 1 / 30 * 1.2;

export class Governor {
  /** the steps taken (0: none) */
  level = 0;
  private readonly key: string;
  private readonly held: boolean;
  private share = 0;
  private starve = 0;
  private room = 0;
  private t = 0;
  private lastStep = -Infinity;
  private lastUp = -Infinity;

  constructor(readonly o: GovernorOptions) {
    this.key = `gov.${o.name}`;
    const asked = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('gov');
    this.held = asked !== null;
    let start = o.start ?? 0;
    if (asked !== null && asked !== 'off') start = Number(asked) || 0;
    else if (asked === null) try { const k = localStorage.getItem(this.key); if (k !== null && Number.isFinite(Number(k))) start = Number(k); } catch { /* nothing kept */ }
    start = Math.max(0, Math.min(o.steps.length, Math.round(start)));
    for (let i = 0; i < start; i++) o.steps[i].set(true);
    this.level = start;
    (globalThis as { __governor?: unknown }).__governor = this;
  }

  /** the steps taken, by name */
  get taken() { return this.o.steps.slice(0, this.level).map((s) => s.name); }

  /** each frame, after the dynamic resolution's own update */
  frame(kit: KitLike) {
    const dt = kit.dt;
    // (a hidden tab, a stall while something loads: not the device's pace)
    if (this.held || !dt || dt > 0.25) return;
    this.t += dt;
    if (this.t < 20) return;
    this.share += ((dt > LATE ? 1 : 0) - this.share) * 0.03;
    if (this.o.atFloor() && this.share > 0.25) this.starve += dt;
    else this.starve = Math.max(0, this.starve - dt * 0.5);
    if (this.starve > 8 && this.t - this.lastStep > 20 && this.level < this.o.steps.length) {
      this.starve = 0;
      this.room = 0;
      this.lastStep = this.t;
      const s = this.o.steps[this.level++];
      s.set(true);
      this.keep();
      this.o.onStep?.(this.level, s, true);
      return;
    }
    const p = kit.profiler;
    if (p.available && p.trusted !== false && p.frameMs > 0 && p.frameMs < 8 && this.o.atCeiling() && this.share < 0.02) this.room += dt;
    else this.room = 0;
    if (this.room > 30 && this.level > 0 && this.t - this.lastStep > 60 && this.t - this.lastUp > 60) {
      this.room = 0;
      this.lastUp = this.t;
      const s = this.o.steps[--this.level];
      s.set(false);
      this.keep();
      this.o.onStep?.(this.level, s, false);
    }
  }

  private keep() { try { localStorage.setItem(this.key, String(this.level)); } catch { /* not kept */ } }
}
