// Holding the frame rate where the GPU can't time itself. weft's AutoResolution steps the resolution by the GPU's own
// timestamps, and a phone's Safari has none: there it never moved, and a phone drew every scale at the one resolution
// it started at. This one watches the frames' intervals instead (what the visitor sees): when they run long the
// resolution comes down; when they've kept to the display's own rate a while, it goes back up a step, and a step up
// that cost frames isn't tried again for a while.
import type { Kit } from '@ericrius1/weft';

export class FramePace {
  min = 0.4;
  max = 0.8;
  /** a frame counts as late past the display's own interval (60 Hz at the fastest: a 120 Hz phone isn't held to it)
   *  times this */
  slack = 1.25;
  private times: number[] = [];
  private last = 0;
  private t = 0;
  private good = 0;
  /** frames to let pass first (the first ones stall as pipelines and textures arrive) */
  private warm = 90;
  /** the display's interval: the shortest a second's frames have kept to lately */
  private best = 1 / 60;
  /** when the resolution last stepped up, and to what */
  private upAt = -Infinity;
  private upTo = 0;
  /** a scale that ran late just after it was stepped up to, and until when it's not tried again */
  private ceiling = Infinity;
  private ceilingUntil = 0;

  constructor(opts: Partial<Pick<FramePace, 'min' | 'max'>> = {}) { Object.assign(this, opts); }

  update(kit: Kit) {
    const now = performance.now() / 1000;
    const dt = this.last ? now - this.last : 0;
    this.last = now;
    // (a hidden tab, a stall while something loads: not the GPU's pace)
    if (dt <= 0 || dt > 0.25 || --this.warm > 0) return;
    this.times.push(dt);
    this.t += dt;
    if (this.t < 1 || this.times.length < 30) return;
    const sorted = this.times.sort((a, b) => a - b);
    const p25 = sorted[Math.floor(sorted.length * 0.25)], p75 = sorted[Math.floor(sorted.length * 0.75)];
    this.times = [];
    this.t = 0;
    // (a window's quicker frames, not one odd pair of them: and drifting back up, should the display slow)
    this.best = Math.min(p25, this.best * 1.02);
    const s = kit.renderScale, budget = Math.max(this.best, 1 / 60) * this.slack;
    let next = s;
    if (p75 > budget) {
      this.good = 0;
      if (now - this.upAt < 4) { this.ceiling = this.upTo; this.ceilingUntil = now + 20; }
      // down by about what it'd take to keep up (GPU time ~ pixels), a step at least
      next = Math.max(this.min, Math.min(s - 0.04, s * Math.sqrt(budget / p75)));
    } else if (++this.good >= 3) {
      // on time three seconds running: a step up, short of a scale that just ran late
      this.good = 0;
      next = Math.min(this.max, now < this.ceilingUntil ? this.ceiling - 0.02 : Infinity, s + 0.04);
    }
    next = Math.round(next / 0.02) * 0.02;
    if (Math.abs(next - s) < 0.02) return;
    if (next > s) { this.upAt = now; this.upTo = next; }
    kit.renderScale = next;
  }
}
