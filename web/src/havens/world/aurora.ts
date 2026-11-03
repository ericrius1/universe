// The aurora (aurora.wgsl): each night's display — from the date (the share of clear nights that have one is the
// panel's frequency; some nights are quiet, now and then one is strong) or as the panel sets it — as curtains: arcs
// along the magnetic east-west, the equatorward one brightest, the others poleward of it. By day a veil of it stays,
// high in the sky and soft (the Seven Havens' sky is never without it), strengthening into the night's curtains as the
// dusk deepens, the arcs settling north as they brighten. Every few minutes a substorm:
// the arcs surge (the equatorward first, the brightening spreading poleward), push toward the camera, fold and curl,
// their rays race, a pink fringe lights their lower edges, then they settle back to a quiet glow. The aurora keeps its
// own clock (real seconds times the speed: a time-lapse doesn't make it frantic); `restart()` (app.sky.showcase does it)
// starts it afresh, so a film's frames come out the same.
// Drawn into the scene where the sky shows (after the stars), and into a small dome map of the sky that reflections and
// the light on the ground read (world.wgsl's skyRadiance and skyAmbient).
import type { Kit, RenderPass, RunEntry, Texture, UniformBuffer } from '@ericrius1/weft';
import { MipChain } from '@ericrius1/weft';
import auroraShader from './aurora.wgsl';
import { AURORA_DEFAULT, skyDay, type AuroraSettings, type ClockState } from './clock';
import { WORLD_GROUP } from './group';
import { tier } from '../util/tier';

/** the dome map's size, the curtains (each drawn as two sheets), columns per ribbon (aurora.wgsl COLS) */
const DOME = 512;
const CURTAINS = 6;
const COLS = 1024;
/** the site's magnetic declination: magnetic north lies 8 degrees east of true north */
const DECLINATION = (8 * Math.PI) / 180;
/** the arcs' half-length (km) */
const SPAN = 1700;
/** the emission's scale on the screen (it's set against the exposure, as an eye adapts): a face-on curtain at
 *  intensity 1 sits a little under middle grey; the day's veil against the painted sky, which outshines middle grey
 *  several times */
const GLOW = 0.0055 * 60;
const DAY_GLOW = GLOW * 4;

interface Substorm { t: number; size: number }

export class Aurora {
  /** the panel's settings (app.aurora) */
  readonly settings: AuroraSettings = clone(AURORA_DEFAULT);
  /** the aurora over the sky, polar (the zenith in the middle), with its mips for the light on the ground */
  readonly dome: Texture;
  /** tonight's display for the panel: whether there's one and how strong */
  readonly tonight = { label: '' };
  /** this frame's: its strength (0: none; the night's alone, which lights the land), its brightness in the scene (0:
   *  nothing drawn), the substorm's surge (0..~1.3) */
  strength = 0;
  nightStrength = 0;
  brightness = 0;
  surge = 0;
  private domeDummy: Texture;
  private u: UniformBuffer<any>;
  private domePass!: RenderPass;
  private mips: MipChain;
  /** the aurora's own clock (s) */
  private clock = 0;
  private storms: Substorm[] = [];
  private nextStorm = 20;
  private stormSeed = 7;
  private nightKey = '';
  private activity = 1;
  private layout: { gap: number; bright: number; seed: number; edge: number }[] = [];
  /** per curtain, how far its motions have gone (the rates change with the surges, so they're summed frame by frame —
   *  a rate times the clock would lurch at every change): rays slid (km), folds' time, fine rays' time, flicker's time */
  private phase = Array.from({ length: CURTAINS }, () => [0, 0, 0, 0]);

  constructor(readonly kit: Kit) {
    this.dome = kit.texture({ label: 'aurora.dome', format: 'rgba16float', size: [DOME, DOME], mips: 'full', usage: ['render', 'sample'] });
    this.domeDummy = kit.texture({ label: 'aurora.dome.dummy', format: 'rgba16float', size: [4, 4], usage: ['sample'] });
    this.u = kit.uniforms(auroraShader.structs.AuroraU, 'aurora');
    this.mips = new MipChain(kit, this.dome);
  }

  /** the dome map's pass (after the shared world group exists: the pass draws into the map the group holds) */
  init() {
    this.domePass = this.kit.pass({ label: 'aurora.dome', color: [{ target: this.dome.mip(0), clear: [0, 0, 0, 0] }], shared: { [WORLD_GROUP]: { auroraDome: this.domeDummy } } });
    this.domePass.draw(auroraShader, {
      label: 'aurora.dome', vertex: 'vsDome', fragment: 'fs', topology: 'triangle-strip', count: COLS * 2, instances: CURTAINS * 2,
      blend: 'add', cull: 'none', bind: { AU: this.u } as never,
    });
  }

  /** the curtains in the scene: after the sky and the stars, only where the sky shows */
  draw(pass: RenderPass) {
    pass.draw(auroraShader, {
      label: 'aurora', vertex: 'vs', fragment: 'fs', topology: 'triangle-strip', count: COLS * 2, instances: CURTAINS * 2,
      blend: 'add', cull: 'none', depthWrite: false, depthCompare: 'greater-equal', bind: { AU: this.u } as never, enabled: () => this.brightness > 0,
    });
  }

  /** the dome map and its mips (before the scene) */
  passes(): RunEntry[] {
    // (a phone's every third frame (util/tier.ts cloudEvery): it drifts slowly, and the dome's a pass and nine mips)
    return this.brightness > 0 && this.domeTick++ % tier.cloudEvery === 0 ? [this.domePass, this.mips] : [];
  }
  private domeTick = 0;

  /** start the aurora's own clock and substorms afresh (a film's frames come out the same whatever ran before) */
  restart() {
    this.clock = 0;
    this.storms = [];
    this.nextStorm = 20;
    for (const p of this.phase) p.fill(0);
  }

  /** a substorm now */
  surgeNow(size = 1) {
    this.storms.push({ t: this.clock, size });
    this.storms.sort((a, b) => a.t - b.t);
  }

  /** this frame's aurora: the night's display, the substorms, the curtains (night: 0 day .. 1 full night) */
  update(dt: number, t: ClockState, night: number, exposure: number) {
    const A = this.settings;
    const da = dt * A.speed;
    this.clock += da;
    this.pickNight(t);
    // (the night's from nautical twilight on, as the sky darkens; the day's veil before it)
    const dark = smooth(0.55, 1, night), day = 1 - dark;
    this.nightStrength = A.intensity * this.activity * dark;
    const dayStrength = A.intensity * this.activity * A.day * day;
    this.strength = this.nightStrength + dayStrength;
    this.brightness = (this.nightStrength * GLOW + dayStrength * DAY_GLOW) / Math.max(exposure, 1e-6);
    this.surge = this.substorms(A.surges);
    if (this.brightness <= 0) return;
    const S = this.surge, T = this.clock;
    // the expansion: the minutes after an onset, when the arcs fold and curl and race
    const exp = this.storms.reduce((m, s) => Math.max(m, s.size * smooth(0, 3, T - s.t) * Math.exp(-Math.max(T - s.t - 3, 0) / 22)), 0);
    // where the arcs stand: the oval's edge from the reach (the night's activity pushing it a little south; the day's
    // veil high overhead), pressing toward the camera in a surge
    const night0 = Math.min(1, A.reach * (0.8 + 0.25 * this.activity));
    const reach = night0 + (Math.max(night0, 0.9) - night0) * day;
    const edge = 1100 * (1 - reach) - 50 * S;
    const curtains = this.layout.map((L, k) => {
      // (the surge reaches each arc a few seconds after the one before it, and the poleward ones less)
      const share = Math.pow(0.72, k);
      const own = this.substorms(A.surges, k * 4) * share;
      const drift = 18 * Math.sin(T * 0.011 + L.seed * 9) + 10 * Math.sin(T * 0.027 + L.seed * 4);
      const fold = 1 + 2.2 * own, rays = (2.5 + 2 * L.seed) * (0.7 + 0.6 * own), sk = S * share;
      const p = this.phase[k];
      p[0] += da * rays * (1 + 2 * sk);
      p[1] += da * fold;
      p[2] += da * (1 + sk);
      p[3] += da * (0.9 + 2.5 * sk);
      return {
        // (a surge brightens the body a little; its hem most — aurora.wgsl)
        a: [edge + L.gap + drift, L.bright * (1 + 0.6 * own), L.seed, share],
        b: [A.folds * (0.55 + 0.2 * k / CURTAINS + 0.45 * own), fold, rays, L.edge - 7 * own],
        p: [...p],
      };
    });
    const c = (o: { r: number; g: number; b: number }, w = 0): [number, number, number, number] => [o.r, o.g, o.b, w];
    const ce = Math.cos(DECLINATION), se = Math.sin(DECLINATION);
    this.u.set({
      // (magnetic east and north in the world's xz: x east, z south)
      frame: [ce, se, se, -ce],
      clock: [T, S, exp, this.brightness],
      shape: [Math.max(A.height, 0.2), Math.min(A.rays, 1.6), A.folds, Math.min(0.45, Math.max(0.035, A.thickness / 380))],
      teal: c(A.teal, day), green: c(A.green, SPAN), violet: c(A.violet), crown: c(A.crown), hem: c(A.hem),
      curtains: curtains as never,
    });
  }

  /** the light it adds to an open, level patch of ground (for the exposure: the night's; the day's veil lights nothing) */
  get light() { return this.nightStrength * 1.2e-5 * (1 + 1.7 * this.surge) * (0.5 + this.settings.reach); }

  /** the world uniforms' aurora fields (world.wgsl: x > 0 when the dome map holds it) */
  get world() {
    const A = this.settings;
    return {
      aurora0: [this.brightness, A.reach, A.height, this.clock], aurora1: [A.green.r, A.green.g, A.green.b, A.rays],
      aurora2: [A.crown.r, A.crown.g, A.crown.b, A.folds], aurora3: [A.hem.r, A.hem.g, A.hem.b, A.thickness],
    };
  }

  /** tonight's display (a night runs noon to noon): whether there is one (the frequency), how strong, and its arcs */
  private pickNight(t: ClockState) {
    const A = this.settings;
    const night = Math.floor(skyDay(t) + (t.hour - 12) / 24);
    const key = `${t.year}|${night}|${A.frequency}`;
    if (key === this.nightKey) return;
    this.nightKey = key;
    // (each night's display starts its clock afresh, at noon when it can't be seen: its motions stay small numbers)
    this.restart();
    const r = rng((t.year * 977 + night * 131) >>> 0);
    const draw = r(), strength = r();
    if (A.frequency >= 1) this.activity = 1;
    else this.activity = draw < A.frequency ? 0.55 + 0.75 * strength * strength : 0;
    this.tonight.label = this.activity <= 0 ? 'none tonight' : this.activity > 1.05 ? 'a strong one tonight' : this.activity > 0.8 ? 'active tonight' : 'a quiet one tonight';
    // the arcs: the first at the oval's edge, the rest poleward of it at uneven gaps, fainter
    this.layout = [];
    let gap = 0;
    for (let k = 0; k < CURTAINS; k++) {
      this.layout.push({ gap, bright: k === 0 ? 1 : (0.3 + 0.45 * r()) * Math.pow(0.85, k), seed: r(), edge: 98 + 9 * r() });
      gap += 40 + 90 * r();
    }
    this.stormSeed = (night * 7919 + t.year) >>> 0;
  }

  /** the substorms' surge at the aurora's clock (lagged by `lag` s): every couple of minutes (fewer as surges falls) an
   *  onset, a fast rise, a slow decay */
  private substorms(rate: number, lag = 0) {
    const T = this.clock - lag;
    if (rate > 0) {
      const r = rng(this.stormSeed + this.storms.length * 31);
      // (after a long spell without them, the next comes in a while: the missed ones aren't all started at once)
      if (this.nextStorm < this.clock - 300) this.nextStorm = this.clock + (20 + 60 * r()) / rate;
      while (this.nextStorm < this.clock + 1) {
        this.storms.push({ t: this.nextStorm, size: 0.6 + 0.6 * r() });
        this.nextStorm += (55 + 130 * r()) / rate;
      }
    }
    // (the ones long over are forgotten)
    while (this.storms.length && this.storms[0].t < this.clock - 300) this.storms.shift();
    let s = 0;
    for (const st of this.storms) {
      const d = T - st.t;
      if (d < 0) continue;
      // (a sharp onset — a quarter of it in 0.3 s, most in two — then minutes of decay)
      s = Math.max(s, st.size * (1 - Math.exp(-d / 1.1)) * Math.exp(-Math.max(d - 3, 0) / 45));
    }
    return s;
  }
}

function clone(a: AuroraSettings): AuroraSettings {
  return { ...a, teal: { ...a.teal }, green: { ...a.green }, violet: { ...a.violet }, crown: { ...a.crown }, hem: { ...a.hem } };
}
function smooth(a: number, b: number, x: number) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
