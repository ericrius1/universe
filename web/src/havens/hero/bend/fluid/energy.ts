// The water's charge (the bending's `charge`), ported from the waterbending app: the power gathered into what she
// holds, the longer she holds it — shown in it and all round it. A heart beats in it (a lub-dub, its tempo quickening as
// the charge builds: a phase advanced by the tempo, so a change of tempo never jumps the beat); render.wgsl's fsEnergy
// lights the water from within on each beat — a core of deep light, veins drifting at two depths, sparks, a white-blue
// rim. Round it: motes of light drawn in to it from all about her and swept round it (the spray's 'energy' motes,
// steered to the form's lines: spray_sim.wgsl), and its light on the water (render.ts light). The vortex as a dragon of
// water: its eyes two points of light, spray streaming off its back. On each beat `onBeat`: the brain's to answer (the
// app rang the water below in rings and thrummed).
import { clamp, damp, type V3 } from '@ericrius1/weft';
import type { Fluid } from './fluid';
import type { FluidRender } from './render';
import type { Spray } from './spray';

/** the lub-dub of one beat, x the phase into it (0..1): a strong pulse and a softer one after it */
export const lubdub = (x: number) => Math.min(1, x / 0.05) * Math.exp(-x * 9) + (x > 0.28 ? 0.6 * Math.min(1, (x - 0.28) / 0.05) * Math.exp(-(x - 0.28) * 9) : 0);

/** what the bending tells it each frame */
export interface ChargeState {
  /** the power the water she holds has gathered (Bending.charge, 0..1.2) */
  charge: number;
  /** she holds water (Bending.holding) */
  holding: boolean;
  /** an orb gathered somewhere (Bending.orbAt with the 'orb' form): its middle and radius, else null */
  orb: { p: V3; r: number } | null;
  /** the dragon of water's eyes (Bending.serpentEyes; null: no serpent) */
  serpentEyes: [V3, V3] | null;
  /** the water's surface under (x, z), or null (none) */
  waterAt: (x: number, z: number) => number | null;
}

export class Energy {
  /** the charge shown (eased), 0..1 */
  k = 0;
  /** the heart: its phase (beats) and tempo (beats a minute) */
  phase = 0;
  bpm = 48;
  /** this beat's strength (0..1, the lub-dub), for whoever wants to pulse with it */
  beat = 0;
  /** where the charge is (the held water's middle) and how big it is (m) */
  at: V3 = [0, 0, 0];
  size = 1;
  /** how much spirit water it is (0..1: render.ts spirit) */
  spirit = 0;
  /** (films) more motes and a stronger light — a finale's great orb */
  boost = 1;
  /** each beat while it's charged: where, how charged, and the water's level under it (null: none near) — the app rang
   *  the water out from under it (an impulse of -0.035 · k · nearness over 1.6 + 0.6 · size m) and thrummed */
  onBeat?: (at: V3, k: number, waterLevel: number | null) => void;
  private moteAcc = 0;
  private maneAcc = 0;
  private inAcc = 0;

  /** `eye` the camera's position (no spume off the dragon's back close to the lens) */
  constructor(readonly fluid: Fluid, readonly render: FluidRender, readonly spray: Spray, readonly eye: () => ArrayLike<number>) {}

  /** every frame, after the bending and before the fluid's, the renderer's and the spray's updates */
  update(dt: number, c: ChargeState) {
    const st = this.fluid.stats;
    const holding = c.holding && st.held > 50;
    this.k = damp(this.k, clamp(c.charge, 0, 1.2), 4, dt);
    this.spirit = this.render.spirit[3];
    // (a resting heart while it's faint; a racing one at full)
    this.bpm = 48 + 92 * this.k * this.k;
    const ph0 = this.phase;
    this.phase += (dt * this.bpm) / 60;
    // (kept small, whole beats off at a time: its fraction is what's used, and in a float far out it frays)
    if (this.phase > 1000) this.phase -= 1000;
    this.beat = lubdub(this.phase - Math.floor(this.phase));
    const orb = c.orb;
    if (holding || orb) this.at = orb ? [...orb.p] : [...st.heldCentroid];
    this.size = orb ? orb.r : clamp(0.35 * Math.cbrt(Math.max(st.held, 1)) * 0.12 + 0.6, 0.6, 3.5);
    this.spray.energy = [this.phase, this.k, this.spirit, this.size];
    // the water's own glow (fsEnergy): how bright, where
    this.render.energy = [this.k, this.phase, 1, 0];
    this.render.energyAt = [this.at[0], this.at[1], this.at[2], this.size];
    this.light(c.holding || !!orb);
    // the motes: steered to points along the form she holds (or round the orb), swept round them
    const path = this.fluid.path, pts: [number, number, number, number][] = [];
    if (orb) pts.push([orb.p[0], orb.p[1], orb.p[2], orb.r]);
    else if (holding && path.length > 1) {
      const n = Math.min(8, path.length);
      for (let i = 0; i < n; i++) { const q = path[Math.round((i * (path.length - 1)) / Math.max(n - 1, 1))].p; pts.push([q[0], q[1], q[2], 0.45 + 0.25 * this.k]); }
    } else if (holding) pts.push([this.at[0], this.at[1], this.at[2], this.size]);
    this.spray.attract = { pts, k: holding || orb ? this.k : 0, phase: this.phase };
    if ((holding || orb) && this.k > 0.08) {
      const kk = this.k * this.boost;
      // (swept round it: born close about the form)
      this.moteAcc += dt * 60 * (0.15 + 1.2 * kk * kk);
      if (this.moteAcc >= 1 && pts.length) {
        const n = Math.floor(this.moteAcc);
        this.moteAcc -= n;
        const q = pts[Math.floor(Math.random() * pts.length)];
        this.spray.emit({ pos: [q[0], q[1], q[2]], radius: q[3] * 1.5 + 0.3, vel: [0, 0.3, 0], spread: 0.8, count: n, kind: 'energy', life: 1.7 });
      }
      // (and drawn in to it from all about her — up off the water below, out of it, if there's water near beneath; out
      // of the air if not — the more the fuller it is)
      this.inAcc += dt * 60 * (kk > 0.3 ? (kk - 0.3) * 1.3 : 0);
      if (this.inAcc >= 1) {
        const n = Math.floor(this.inAcc);
        this.inAcc -= n;
        const wl = c.waterAt(this.at[0], this.at[2]);
        const R = 6 + 9 * Math.min(kk, 1.4);
        if (wl !== null && this.at[1] - wl < 18) this.spray.emit({ pos: [this.at[0], wl - R * 0.35, this.at[2]], radius: R, vel: [0, 2.5, 0], spread: 0.3, count: n, kind: 'energy', life: 1.9 });
        else this.spray.emit({ pos: [this.at[0], this.at[1], this.at[2]], radius: R, vel: [0, 0, 0], spread: 0.2, count: n, kind: 'energy', life: 1.9 });
      }
    }
    // a water dragon's eyes: two points of light; and spray streaming off its back as it swims — a mane
    const eyes = c.holding ? c.serpentEyes : null;
    if (eyes) {
      for (const e of eyes) this.spray.emit({ pos: e, radius: 0.01, vel: [0, 0, 0], spread: 0, count: 3, kind: 'energy', life: 0.05, size: 20 });
      const P = this.fluid.path, N = 18;
      if (P.length >= N * 18) {
        this.maneAcc += dt * 60 * 1.5;
        const cp = this.eye();
        while (this.maneAcc >= 1) {
          this.maneAcc -= 1;
          const i = N * 4 + Math.floor(Math.random() * N * 9), q = P[i].p, v = P[i].v;
          // (not by the lens: close up, the clots of it were great white puffs over the picture)
          if (Math.hypot(q[0] - cp[0], q[1] - cp[1], q[2] - cp[2]) < 12) continue;
          this.spray.emit({ pos: [q[0], q[1] + 0.35, q[2]], radius: 0.25, vel: [v[0] * 0.3, 1.8 + 0.06 * Math.hypot(v[0], v[2]), v[2] * 0.3], spread: 0.8, count: 4, kind: 'spume', life: 0.8, size: 1.3 });
        }
      }
    }
    // on each beat: the brain's ring on the water below, its thrum
    if (Math.floor(this.phase) !== Math.floor(ph0) && (holding || orb) && this.k > 0.25) {
      const wl = c.waterAt(this.at[0], this.at[2]);
      this.onBeat?.([...this.at], this.k, wl);
    }
  }

  /** its light, beating: on the water it's in (render.ts light, the app's point light) */
  private light(on: boolean) {
    const R = this.render;
    if (this.k < 0.05 || !on) { R.light = [0, 0, 0, 0]; return; }
    const sp = this.spirit, kk = this.k * this.boost * (0.55 + 0.45 * this.beat);
    const I = 9 * kk;
    R.light = [this.at[0], this.at[1], this.at[2], 14 + 18 * this.k];
    R.lightColor = [(0.12 * (1 - sp) + 0.05 * sp) * I, (0.55 * (1 - sp) + 0.3 * sp) * I, (1.0 * (1 - sp) + 1.7 * sp) * I, Math.max(this.size * 0.6, 0.8)];
  }
}
