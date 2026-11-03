// The clouds: each day's sky from the weather (weather.ts), built the way Stormbreak builds its clouds — not a
// ray-marched volume but cheap pieces that keep their shape:
//   puffs   cumulus and cumulonimbus as fixed clusters of soft lit sprites (cloudpuffs.wgsl). The sky is a grid of
//           cells drifting with the wind; each cell's clouds come from a hash of the cell and the day (the same sky
//           every time, in every shot), built when the camera comes within range and dropped when it leaves. Each
//           cloud is born at an hour of the afternoon over the sunbaked plateau round the canyon, grows (its upper puffs
//           coming in as it builds), drifts on with the wind and dies. Each frame the puffs in range are listed, faded
//           far off, and sorted back to front.
//   lenses  lenticular wave clouds: ellipsoids ray-traced in the same pass, standing still over the high ground west
//   layers  up to four decks (cloudlayers.wgsl), a slab each, composited per pixel
// and the light they leave the world: the cloud shadow map (rendered every frame from all three; world.wgsl's
// sunLight reads it), the grey dome's ambient under an overcast, and the exposure's view of both.
import type { Kit, RenderPass, RunEntry, StorageBuffer, Texture, UniformBuffer, V3 } from '@ericrius1/weft';
import { MipChain } from '@ericrius1/weft';
import layersShader from './cloudlayers.wgsl';
import puffShader from './cloudpuffs.wgsl';
import noiseShader from './cloudnoise.wgsl';
import worldShader from './world.wgsl';
import { SKY_KINDS, dailyKind, daySeed, recipe, rng, type DeckSlot, type LayerSpec, type Recipe, type SkyKind } from './weather';
import { dateLabel } from './sun';
import { skyDay, type ClockState } from './clock';
import { tier } from '../util/tier';
import { WORLD_GROUP } from './group';

/** the sky's grid (m), how far the puffs reach (m), floats per sprite (cloudpuffs.wgsl Puff), the most sprites */
const CELL = 2500;
const RANGE = 42000;
const STORM_RANGE = 110000;
const STRIDE = 16;
/** distance buckets for the back-to-front sort (finer near the camera) */
const SORT_BUCKETS = 4096;
const CAP = 20000;
/** the clouds' clock: at most this many times real time (a fast time-lapse carries them along briskly instead of
 *  strobing), snapped back to the clock when it jumps more than JUMP seconds in a frame (a cut, a scrub) */
const SPEED_CAP = 120;
const JUMP = 1800;
/** the decks' drift is wrapped every WRAP of their tiles */
const WRAP = 200;
/** the cloud shadow map: texels, and the ground it covers round the camera (m) */
const SHADOW_PX = 512;
const SHADOW_EXTENT = 48000;
const SLOTS = ['low', 'mid', 'high', 'wave'] as const;
interface FadingSky { at: number; w0: number; rec: Recipe | null; cells: Map<string, CloudDef[]>; storms: CloudDef[]; lenses: Lens[] }
/** a change of the day's sky (the weather's, the kind picked) crossfades over this many seconds: the decks from how
 *  they looked, the old clouds fading out as the new ones fade in */
const MORPH_S = 6;

interface PuffDef { dx: number; dy: number; dz: number; r: number; seed: number; rel: number; kind: number; len: number; ceil?: number }
/** a cloud in the drifted sky: where in it, its base and size, when it's born and how long it lives (hours), its
 *  darkness, its puffs (offsets from the centre of its base), how fast it moves with the wind */
interface CloudDef { x: number; z: number; base: number; w: number; h: number; tb: number; life: number; dark: number; puffs: PuffDef[]; anvil: number; drift: number }
interface Lens { x: number; z: number; y: number; a: number; b: number; c: number; yaw: number; tau: number; seed: number }

export interface CloudSettings {
  /** 'auto' (the day's weather) or one of SKY_KINDS */
  weather: string;
  /** cover and cloud heights, times the day's */
  cover: number; height: number;
  /** wind aloft (m/s) and where it blows from (degrees): -1 the day's */
  wind: number; windFrom: number;
  /** how dark the cloud shadows are on the ground (0 none) */
  shadows: number;
  /** another sky for the same day */
  seed: number;
  enabled: boolean;
  /** how much of the sky's cloud is there (1 all of it .. 0 none): a sky clearing at dusk, smoothly (the sky isn't
   *  rebuilt for it) */
  fade: number;
}

export class Clouds {
  settings: CloudSettings = { weather: 'auto', cover: 1, height: 1, wind: -1, windFrom: -1, shadows: 1, seed: 0, enabled: true, fade: 1 };
  /** how they're painted (world/daylight.ts sets it each frame): the lit side's gain, the shaded side's and the belly's,
   *  the shade's tint */
  paint: { lit: number; shade: number; belly: V3 } = { lit: 1, shade: 1, belly: [1, 1, 1] };
  /** what the panel shows: the date and its sky */
  readonly today = { sky: '' };
  /** the next change of sky is a cut, not a crossfade */
  private cut = false;
  /** the crossfades under way: the decks as they were; the skies of clouds that were, each fading from its weight then
   *  (at most two: a change in the middle of one), and when today's clouds began fading in (-inf: they're all in) */
  private morphDecks: { at: number; mix: number; decks: Record<DeckSlot, LayerSpec | null> } | null = null;
  private fadingSkies: FadingSky[] = [];
  private bornAt = -Infinity;
  private keyDay = '';
  readonly shadowTex: Texture;
  readonly skyU: UniformBuffer<any>;
  readonly layersU: UniformBuffer<any>;
  readonly noise: Texture;
  private shadowDummy: Texture;
  private puffBuf: StorageBuffer;
  private data = new Float32Array(CAP * STRIDE);
  private sorted = new Float32Array(CAP * STRIDE);
  private bucket = new Uint16Array(CAP);
  private counts = new Uint32Array(SORT_BUCKETS + 1);
  private order = new Uint32Array(CAP);
  private n = 0;
  /** when the sprites were last listed: the camera, the hour, the frames since, the sky */
  private listed = { cam: [0, -1e9, 0] as V3, hour: -1, frames: 0, key: '', drift: [0, 0] as [number, number] };
  private shadowPass!: RenderPass;
  private shadowTick = 0;
  private bake: RunEntry[] = [];
  private baked = 0;

  private key = '';
  private rec: Recipe | null = null;
  private prev: Recipe | null = null;
  private cells = new Map<string, CloudDef[]>();
  private storms: CloudDef[] = [];
  private lenses: Lens[] = [];
  /** the clouds' clock (s), the clock's seconds it follows, the kit's time at the last frame */
  private cloudT = NaN;
  private lapse = 0;
  private lastTs = NaN;
  private lastKit = 0;
  /** the wind's drift: d = vel * t + phase (m), t the clouds' clock */
  private vel: [number, number] = [0, 0];
  private phase: [number, number] = [0, 0];
  private drift: [number, number] = [0, 0];
  private seed = 1;
  /** this frame's sky, for the shadow lookups beyond the map, the ambient and the exposure */
  private dome = { cover: 0, diffuse: 0.5, base: 2.5, direct: 1 };
  /** how much of the sky's cloud is still over the camera (0 once it's climbed out over the tops: the exposure's) */
  private over = 1;
  /** how much of the sky's dome the clouds cover this frame (0..1) */
  get skyCover() { return this.dome.cover; }
  /** as the sky shows it (cloudSky.dome.x: the post's grade reads it) */
  get shownCover() { return this.dome.cover * this.over; }
  private puffBand = 2500;

  constructor(readonly kit: Kit) {
    this.shadowTex = kit.texture({ label: 'cloudShadow', format: 'rgba16float', size: [SHADOW_PX, SHADOW_PX], usage: ['render', 'sample', 'copy-src'] });
    this.shadowDummy = kit.texture({ label: 'cloudShadow.dummy', format: 'rgba16float', size: [4, 4], usage: ['render', 'sample'] });
    this.skyU = kit.uniforms(worldShader.structs.CloudSky, 'cloudSky');
    this.skyU.set({ map: [SHADOW_EXTENT, 1, 1, 0] });
    this.layersU = kit.uniforms(layersShader.structs.CloudLayers, 'cloudLayers');
    this.noise = kit.texture({ label: 'cloudNoise', format: 'rgba8unorm', size: [512, 512], mips: 'full', usage: ['storage', 'sample', 'render'] });
    this.puffBuf = kit.storage({ label: 'cloudPuffs', size: CAP * STRIDE * 4, usage: ['storage', 'copy-dst'] });
  }

  /** the shared world group's entries */
  get shared() { return { cloudShadowTex: this.shadowTex, cloudSky: this.skyU }; }

  /** the shadow pass (after the shared world group exists) */
  init() {
    const kit = this.kit;
    this.bake = [
      kit.compute(noiseShader, { label: 'clouds.noise', entry: 'bake', threads: [512, 512], bind: { noiseOut: this.noise.mip(0) } as never }),
      new MipChain(kit, this.noise),
    ];
    this.shadowPass = kit.pass({ label: 'clouds.shadow', color: [{ target: this.shadowTex, clear: [1, 1, 1, 6e4] }], shared: { [WORLD_GROUP]: { cloudShadowTex: this.shadowDummy } } });
    const shadowBlend: GPUBlendState = { color: { srcFactor: 'zero', dstFactor: 'src', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'min' } };
    this.shadowPass.fullscreen(layersShader, { label: 'clouds.shadow.layers', fragment: 'fsShadow', blend: shadowBlend, bind: { CL: this.layersU, cloudNoise: this.noise } as never, enabled: () => this.anyLayer() });
    this.shadowPass.draw(puffShader, {
      label: 'clouds.shadow.puffs', vertex: 'vsShadow', fragment: 'fsShadow', count: 6, instances: () => this.n, blend: shadowBlend, cull: 'none',
      bind: { CL: this.layersU, cloudNoise: this.noise, puffs: this.puffBuf } as never, enabled: () => this.n > 0,
    });
  }

  /** the composite over the finished scene, drawn into a pass over it (post/fx.ts's overlay): decks beyond the
   *  puffs, the puffs, decks in front of them */
  attach(pass: RenderPass, sceneZ: Texture) {
    // (premultiplied; alpha keeps what the clouds let through)
    const blend: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
    const layerBind = { CL: this.layersU, cloudNoise: this.noise, sceneZ } as never;
    const layers = () => this.settings.enabled && this.settings.fade > 0 && this.anyLayer();
    pass.fullscreen(layersShader, { label: 'clouds.layers.far', blend, bind: layerBind, constants: { FRONT: 0 }, enabled: layers });
    pass.draw(puffShader, {
      label: 'clouds.puffs', vertex: 'vs', fragment: 'fs', count: 6, instances: () => this.n, blend, cull: 'none',
      bind: { CL: this.layersU, cloudNoise: this.noise, sceneZ, puffs: this.puffBuf } as never, enabled: () => this.settings.enabled && this.n > 0,
    });
    pass.fullscreen(layersShader, { label: 'clouds.layers.near', blend, bind: layerBind, constants: { FRONT: 1 }, enabled: layers });
  }

  private anyLayer() {
    const m = this.morphDecks;
    return SLOTS.some((s) => (this.rec?.[s]?.cover ?? 0) > 0 || (this.prev?.[s]?.cover ?? 0) > 0 || (m?.decks[s]?.cover ?? 0) > 0);
  }

  /** the passes before the scene: the noise (once) and the shadow map */
  passes(): RunEntry[] {
    if (this.baked < 3) {
      // (counted once the bake's pipeline exists: a pass whose pipeline is still compiling records nothing)
      if ((this.bake[0] as unknown as { pipe: { pipeline: unknown } }).pipe.pipeline) this.baked++;
      return [...this.bake, this.settings.enabled && this.shadowPass];
    }
    // The shadow drifts only about a metre between scheduled updates; profiles trade its cadence for sustained load.
    return [this.settings.enabled && this.skyOn() && this.shadowTick++ % tier.cloudEvery === 0 && this.shadowPass];
  }

  private skyOn() { return this.n > 0 || this.anyLayer(); }

  /** the day's recipe (and yesterday's, for the hand-over in the small hours) */
  private pickSky(t: ClockState) {
    const s = this.settings;
    const day = skyDay(t);
    const k = `${t.year}|${day}|${s.weather}|${s.seed}|${s.cover}|${s.height}`;
    if (k === this.key) return;
    // (the same day's sky changing crossfades; a new day, a new seed is a cut)
    if (this.keyDay === `${t.year}|${day}|${s.seed}`) this.morph(t, true);
    else { this.cut = true; this.endMorph(); }
    this.keyDay = `${t.year}|${day}|${s.seed}`;
    this.key = k;
    const kindOf = (d: number): SkyKind => s.weather === 'auto' ? dailyKind(t.year, d, s.seed) : s.weather as SkyKind;
    const make = (d: number) => this.scaled(recipe(kindOf(d), daySeed(t.year, d, s.seed + 11), d));
    this.rec = make(day);
    this.prev = s.weather === 'auto' ? make(day - 1) : null;
    this.seed = daySeed(t.year, day, s.seed + 101);
    this.today.sky = `${dateLabel(t.year, day)} · ${this.rec.kind}`;
    this.cells = new Map();
    this.buildStorms(day);
    this.buildLenses();
  }

  /** a crossfade from the sky as it looks now: its decks, and (`puffs`, when the clouds are rebuilt) its clouds. A change
   *  in the middle of one fades out whichever clouds showed most */
  private morph(t: ClockState, puffs: boolean) {
    if (this.cut) { this.endMorph(); return; }
    const now = this.kit.time;
    const f = this.prev ? smooth(1, 5, t.hour) : 1;
    const decks = { low: null, mid: null, high: null, wave: null } as Record<DeckSlot, LayerSpec | null>;
    for (const slot of SLOTS) decks[slot] = this.deck(slot, f);
    this.morphDecks = { at: now, mix: 0, decks };
    if (!puffs || this.bornAt === now) return;
    // (each sky fades on from the weight it has now; the faintest goes when there'd be more than two)
    const skies = this.fadingSkies.map((k) => ({ ...k, w0: this.weightOf(k), at: now }));
    skies.push({ at: now, w0: this.weightOf(null), rec: this.rec, cells: this.cells, storms: this.storms, lenses: this.lenses });
    this.fadingSkies = skies.filter((k) => k.w0 > 0.02).sort((a, b) => b.w0 - a.w0).slice(0, 2);
    this.bornAt = now;
  }
  private endMorph() { this.morphDecks = null; this.fadingSkies = []; this.bornAt = -Infinity; }
  /** a fading sky's weight now, or (null) today's clouds' */
  private weightOf(k: FadingSky | null) {
    const t = this.kit.time;
    return k ? k.w0 * (1 - smooth(0, MORPH_S, t - k.at)) : smooth(0, MORPH_S, t - this.bornAt);
  }

  /** a recipe with the panel's cover and height applied */
  private scaled(r: Recipe): Recipe {
    const s = this.settings;
    const L = (l: LayerSpec | null) => l && { ...l, cover: Math.min(1, l.cover * s.cover), base: l.base * s.height };
    return {
      ...r, low: L(r.low), mid: L(r.mid), high: L(r.high), wave: L(r.wave),
      cumulus: r.cumulus && { ...r.cumulus, cover: r.cumulus.cover * s.cover, base: r.cumulus.base * s.height },
      storms: r.storms && { ...r.storms, count: Math.round(r.storms.count * Math.min(s.cover, 2)), base: r.storms.base * s.height },
      lenses: r.lenses && { ...r.lenses, count: Math.round(r.lenses.count * Math.min(s.cover, 2)), base: r.lenses.base * s.height },
    };
  }

  /** the clock's seconds (days and hours: deterministic, scrubbing moves the sky with it) */
  private simSeconds(t: ClockState) { return (skyDay(t) * 24 + t.hour) * 3600; }

  /** put the clouds' clock back on the clock and their drift back to rest, a cut (a shot's start: the same clouds
   *  whatever ran before, whatever winds blew, no crossfade from them) */
  resync() {
    this.cloudT = NaN;
    this.vel = [0, 0];
    this.phase = [0, 0];
    this.cells.clear();
    this.listed.frames = 1e9;
    this.cut = true;
    this.endMorph();
  }

  /** the clouds' clock: the clock's seconds, but never more than SPEED_CAP times faster than real time (the kit's steps, so
   *  a shot's frames are always the same), back on the clock whenever it jumps */
  private cloudSeconds(t: ClockState) {
    const ts = this.simSeconds(t), now = this.kit.time;
    const dt = Math.max(0, now - this.lastKit), d = ts - this.lastTs;
    this.lastKit = now;
    this.lastTs = ts;
    // (how much of a time-lapse this is: 0 at real time .. 1 from 300x, eased over a quarter second — cloudsky.wgsl
    // merges a low sun's cloud shadows only then)
    if (dt > 0 && Number.isFinite(d)) this.lapse += (smooth(30, 300, Math.abs(d) / dt) - this.lapse) * Math.min(1, dt / 0.25);
    if (!Number.isFinite(this.cloudT) || !Number.isFinite(d) || Math.abs(d) > JUMP) this.cloudT = ts;
    else this.cloudT += Math.max(-SPEED_CAP * dt, Math.min(SPEED_CAP * dt, d));
    return this.cloudT;
  }

  private setWind(t: ClockState) {
    const r = this.rec!;
    const speed = this.settings.wind >= 0 ? this.settings.wind : r.wind;
    const from = this.settings.windFrom >= 0 ? this.settings.windFrom : r.windFrom;
    const to = ((from + 180) * Math.PI) / 180;
    const v: [number, number] = [Math.sin(to) * speed, -Math.cos(to) * speed];
    const ts = this.cloudSeconds(t);
    if (v[0] !== this.vel[0] || v[1] !== this.vel[1]) {
      // (a new wind keeps the sky where it is now)
      const d = [this.vel[0] * ts + this.phase[0], this.vel[1] * ts + this.phase[1]];
      this.vel = v;
      this.phase = [d[0] - v[0] * ts, d[1] - v[1] * ts];
      // (the clouds placed by it are built again: the ones there fade out as they come in)
      this.morph(t, true);
      this.cells = new Map();
      this.buildStorms(skyDay(t));
    }
    this.drift = [v[0] * ts + this.phase[0], v[1] * ts + this.phase[1]];
  }
  private driftAt(day: number, hour: number, k = 1): [number, number] {
    const ts = (day * 24 + hour) * 3600;
    return [(this.vel[0] * ts + this.phase[0]) * k, (this.vel[1] * ts + this.phase[1]) * k];
  }

  // ------------------------------------------------------------------ cumulus
  /** where convection starts: the sunbaked plateau round the canyon, over the basin later and less */
  private plateauWeight(x: number, z: number, early: boolean, bias: number) {
    const m = smooth(1500, 6000, Math.hypot(x, z));
    const w = (1 - bias) + bias * m;
    return early ? w * smooth(4000, 12000, Math.hypot(x, z)) : w;
  }

  private build(ix: number, iz: number, day: number): CloudDef[] {
    const cu = this.rec!.cumulus;
    if (!cu) return [];
    const r = rng(cellSeed(ix, iz, this.seed));
    const out: CloudDef[] = [];
    // (in clumps: a slow field over the cells leaves stretches of open sky and fills others)
    const f = Math.sin(ix * 0.31 + this.seed * 0.001) * Math.cos(iz * 0.23 - this.seed * 0.0007) + 0.5 * Math.sin((ix + iz) * 0.57 + 1.3);
    const patch = 0.35 + 1.4 * smooth(-0.9, 1.2, f);
    // (more candidates than clouds: the ones born over the basin in the morning are mostly turned away)
    const want = cu.cover * patch * 3;
    const count = Math.floor(want) + (r() < want - Math.floor(want) ? 1 : 0);
    for (let k = 0; k < count; k++) {
      const x = (ix + r()) * CELL, z = (iz + r()) * CELL;
      // born through the afternoon, most in the early afternoon; a cell lives an hour or two
      const span = cu.end - 1 - cu.start;
      const tb = cu.start + span * Math.pow(r(), 1.25);
      const life = 0.6 + 1.6 * r();
      const born = this.driftAt(day, tb);
      if (r() > this.plateauWeight(x + born[0], z + born[1], tb < cu.start + 1.4, cu.plateau)) continue;
      // a size off a long tail: mostly middling heaps, now and then a big one (bigger later in the day)
      const late = smooth(cu.start, cu.end - 2, tb);
      const W = cu.size * (0.7 + 1.3 * Math.pow(r(), 2)) * (0.85 + 0.35 * late);
      const H = W * cu.tall * (0.55 + 0.55 * r()) * (0.8 + 0.5 * late);
      const c: CloudDef = { x, z, base: cu.base + (r() - 0.5) * 120, w: W, h: H, tb, life, dark: cu.dark * (0.7 + 0.6 * r()), puffs: [], anvil: 0, drift: 1 };
      heap(c, r);
      if (r() < cu.virga * (0.5 + late)) virga(c, r, 3 + Math.floor(r() * 4), Math.min(c.base * 0.7, 600 + 900 * r()), 0.6);
      c.puffs.sort((a, b) => b.r - a.r);
      out.push(c);
    }
    return out;
  }

  /** the day's thunderstorms: born over the high ground west in the early afternoon, carried on with the wind */
  private buildStorms(day: number) {
    this.storms = [];
    const st = this.rec?.storms;
    if (!st || !this.rec) return;
    const r = rng(this.seed ^ 0x51ed27);
    for (let k = 0; k < st.count; k++) {
      // (most born early: mature through the late afternoon)
      const tb = st.start + (st.end - st.start - 3) * Math.pow(r(), 1.4);
      const bx = -4160 - 30000 * r(), bz = (r() - 0.5) * 70000;
      // (storms crawl: well under the wind aloft)
      const born = this.driftAt(day, tb, 0.45);
      const W = 5000 + 4000 * r();
      const c: CloudDef = { x: bx - born[0], z: bz - born[1], base: st.base + (r() - 0.5) * 200, w: W, h: st.top - st.base, tb, life: 2.2 + 1.8 * r(), dark: 0.75, puffs: [], anvil: 1, drift: 0.45 };
      tower(c, r, this.vel);
      virga(c, r, 8 + Math.floor(r() * 6), c.base + 300, 1.6);
      c.puffs.sort((a, b) => b.r - a.r);
      this.storms.push(c);
    }
  }

  /** lenticular stacks over the high ground west: still, whatever the wind */
  private buildLenses() {
    this.lenses = [];
    const ls = this.rec?.lenses;
    if (!ls) return;
    const r = rng(this.seed ^ 0x1e75);
    for (let k = 0; k < ls.count; k++) {
      const x = -6160 - 19000 * r(), z = (r() - 0.5) * 50000;
      // (the long axis along the range, north-south, give or take)
      const yaw = Math.PI / 2 + (r() - 0.5) * 0.6;
      const a = 4000 + 7000 * r(), c = 1200 + 2300 * r(), b = 220 + 380 * r();
      const plates = 1 + Math.floor(r() * 3);
      let y = ls.base + (r() - 0.5) * 1200;
      for (let p = 0; p < plates; p++) {
        const s = 1 - p * (0.15 + 0.15 * r());
        this.lenses.push({ x: x + (r() - 0.5) * 600, z: z + (r() - 0.5) * 1200, y, a: a * s, b: b * (0.8 + 0.4 * r()), c: c * s, yaw: yaw + (r() - 0.5) * 0.1, tau: 5 + 9 * r(), seed: r() });
        y += b * (2.1 + 0.8 * r());
      }
    }
  }

  // ------------------------------------------------------------------ each frame
  /** this frame's sky: the recipe, the wind, the sprites round the camera, the uniforms */
  update(t: ClockState, cam: V3, key: V3, fovY: number, renderH: number, cityGlow: number) {
    this.pickSky(t);
    if (this.morphDecks) this.morphDecks.mix = smooth(0, MORPH_S, this.kit.time - this.morphDecks.at);
    if (this.morphDecks && this.morphDecks.mix >= 1) this.morphDecks = null;
    const fading = this.fadingSkies.length > 0;
    if (fading && this.weightOf(null) >= 1) this.fadingSkies = [];
    this.setWind(t);
    this.cut = false;
    const day = skyDay(t), hour = t.hour;
    // (listed again when the camera has moved, the clock has moved on (every frame in a time-lapse: the clouds grow and
    // die smoothly) or every few frames: between, the shaders carry them on with the wind)
    const L = this.listed;
    const moved = Math.hypot(cam[0] - L.cam[0], cam[1] - L.cam[1], cam[2] - L.cam[2]);
    if (!this.settings.enabled) this.n = 0;
    else if (moved > 25 || Math.abs(hour - L.hour) > 0.003 || ++L.frames >= (fading ? 3 : 6) || L.key !== this.key) {
      this.listSprites(cam, day, hour);
      L.cam = [cam[0], cam[1], cam[2]]; L.hour = hour; L.frames = 0; L.key = this.key; L.drift = [this.drift[0], this.drift[1]];
    }
    this.fillLayers(cam, t, fovY, renderH, cityGlow);
    this.fillSky(cam, key, hour);
  }

  private listSprites(cam: V3, day: number, hour: number) {
    const d = this.data;
    let n = 0;
    // (the last float: how the sprite moves with the wind's drift, which the shaders carry on between listings)
    let drifts = 0;
    const push = (x: number, y: number, z: number, r: number, ox: number, oy: number, oz: number, base: number, seed: number, alpha: number, dark: number, kind: number, a0 = 0, a1 = 0, a2 = 0) => {
      if (n >= CAP) return;
      const o = n * STRIDE;
      d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = r;
      d[o + 4] = ox; d[o + 5] = oy; d[o + 6] = oz; d[o + 7] = base;
      d[o + 8] = seed; d[o + 9] = alpha; d[o + 10] = dark; d[o + 11] = kind;
      d[o + 12] = a0; d[o + 13] = a1; d[o + 14] = a2; d[o + 15] = kind === 1 ? 0 : drifts;
      n++;
    };
    const fall = (x: number, z: number) => ((x - cam[0]) ** 2 + (z - cam[2]) ** 2) / (2 * 6.371e6);
    // (the new sky's share in a crossfade)
    const pm = this.fadingSkies.length ? this.weightOf(null) : 1;
    const emit = (c: CloudDef, range = RANGE, weight = 1) => {
      // its life: building (the upper puffs come in as it grows), mature, dying from the top down
      const g = c.life * 0.35, dcy = c.life * 0.3;
      const dev = smooth(c.tb, c.tb + g, hour) * (1 - smooth(c.tb + c.life - dcy, c.tb + c.life, hour));
      if (dev <= 0.01) return;
      const cx = c.x + this.drift[0] * c.drift, cz = c.z + this.drift[1] * c.drift;
      drifts = c.drift;
      const dist = Math.hypot(cx - cam[0], c.base - cam[1], cz - cam[2]);
      if (dist > range + c.w) return;
      const fade = (1 - smooth(range * 0.72, range, dist)) * weight;
      // (far off, only the biggest puffs — the outline is all a few pixels can show — the small ones fading out over
      // a few kilometres, never cut)
      // (a big cloud keeps its detail farther out)
      const ls = Math.max(1, c.w / 1400);
      const f16 = 1 - smooth(13000 * ls, 19000 * ls, dist), f8 = 1 - smooth(6000 * ls, 10000 * ls, dist);
      const lift = 0.45 + 0.55 * dev, grow = 0.6 + 0.4 * dev;
      // (the whole cloud fades in as it forms and out as it evaporates: its lowest puffs never pop in or out)
      const whole = smooth(0.01, 0.3, dev);
      const base = c.base - fall(cx, cz);
      for (let k = 0; k < c.puffs.length; k++) {
        const p = c.puffs[k];
        const lod = k < 10 ? 1 : k < 24 ? f16 : f8;
        const a = fade * lod * whole * this.settings.fade * smooth(p.rel - 0.25, p.rel + 0.05, dev * 1.15);
        if (a <= 0.003) continue;
        if (p.kind === 2) {
          // (rain falls once the cloud is grown)
          const va = a * smooth(0.6, 0.9, dev);
          if (va > 0.003) push(cx + p.dx, base + 20, cz + p.dz, p.r, p.len * (0.5 + 0.5 * dev), 0, 0, base, p.seed, va, c.dark, 2);
          continue;
        }
        // (an anvil spreads downwind as the storm matures)
        const spread = c.anvil && p.dy > c.h * 0.84 ? 0.35 + 0.65 * smooth(0.5, 1, dev) : 1;
        push(cx + p.dx * spread, base + p.dy * lift, cz + p.dz * spread, p.r * grow, p.dx / (c.w * 0.5), p.dy / Math.max(c.h, 1), p.dz / (c.w * 0.5), base, p.seed, a, c.dark, 0, p.ceil ? base + p.ceil * lift : 0);
      }
    };
    // the cells in range (in the drifted sky)
    if (this.rec?.cumulus) {
      const ux = cam[0] - this.drift[0], uz = cam[2] - this.drift[1];
      const c0x = Math.floor((ux - RANGE) / CELL), c1x = Math.floor((ux + RANGE) / CELL);
      const c0z = Math.floor((uz - RANGE) / CELL), c1z = Math.floor((uz + RANGE) / CELL);
      const seen = new Set<string>();
      for (let ix = c0x; ix <= c1x; ix++) for (let iz = c0z; iz <= c1z; iz++) {
        const key = `${ix},${iz}`;
        seen.add(key);
        let list = this.cells.get(key);
        if (!list) { list = this.build(ix, iz, day); this.cells.set(key, list); }
        for (const c of list) emit(c, RANGE, pm);
      }
      for (const k of this.cells.keys()) if (!seen.has(k)) this.cells.delete(k);
    }
    // (a thunderstorm stands out a long way off)
    for (const c of this.storms) emit(c, STORM_RANGE, pm);
    // the lenses, breathing a little
    const ts = (day * 24 + hour) * 3600;
    const lens = (l: Lens, weight: number) => {
      const dist = Math.hypot(l.x - cam[0], l.y - cam[1], l.z - cam[2]);
      if (dist > 90000) return;
      const br = 1 + 0.05 * Math.sin(ts / 1100 + l.seed * 40);
      const a = l.a * br, c = l.c * br;
      push(l.x, l.y - fall(l.x, l.z), l.z, Math.max(a, c, l.b), a, l.b, c, l.y, l.seed, (1 - smooth(60000, 90000, dist)) * weight * this.settings.fade, 0, 1, Math.cos(l.yaw), Math.sin(l.yaw), l.tau);
    };
    for (const l of this.lenses) lens(l, pm);
    // (the sky that was, fading out: the clouds already built round the camera)
    for (const k of this.fadingSkies) {
      const w = this.weightOf(k);
      for (const list of k.cells.values()) for (const c of list) emit(c, RANGE, w);
      for (const c of k.storms) emit(c, STORM_RANGE, w);
      for (const l of k.lenses) lens(l, w);
    }
    // back to front: a counting sort over distance buckets (by the square root of the distance: finer near)
    const bk = this.bucket, counts = this.counts, order = this.order;
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE;
      const dist = Math.hypot(d[o] - cam[0], d[o + 1] - cam[1], d[o + 2] - cam[2]);
      const b = SORT_BUCKETS - 1 - Math.min(SORT_BUCKETS - 1, Math.floor(Math.sqrt(dist / STORM_RANGE) * SORT_BUCKETS));
      bk[i] = b; counts[b + 1]++;
    }
    for (let b = 0; b < SORT_BUCKETS; b++) counts[b + 1] += counts[b];
    for (let i = 0; i < n; i++) order[counts[bk[i]]++] = i;
    const s = this.sorted;
    for (let i = 0; i < n; i++) s.set(d.subarray(order[i] * STRIDE, order[i] * STRIDE + STRIDE), i * STRIDE);
    this.n = n;
    if (n) this.puffBuf.write(s.subarray(0, n * STRIDE));
  }

  /** the decks: today's, handed over from yesterday's between 01:00 and 05:00 */
  private fillLayers(cam: V3, t: ClockState, fovY: number, renderH: number, cityGlow: number) {
    const f = this.prev ? smooth(1, 5, t.hour) : 1;
    const to = ((((this.settings.windFrom >= 0 ? this.settings.windFrom : this.rec!.windFrom) + 180) * Math.PI) / 180);
    const w: [number, number] = [Math.sin(to), -Math.cos(to)];
    const along = this.drift[0] * w[0] + this.drift[1] * w[1];
    const across = w[0] * this.drift[1] - w[1] * this.drift[0];
    const L: number[][] = [];
    SLOTS.forEach((slot, k) => {
      const l = faded(this.deck(slot, f), this.settings.fade);
      if (!l || !this.settings.enabled) { L.push([0, 0, 0, 0], [1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]); return; }
      // (drawn after the puffs: a deck below them seen from under it, above them seen from over it — or one the eye is
      // in, fog, the nearest of all)
      const front = cam[1] < l.base ? l.base < this.puffBand : cam[1] < l.base + l.thick || l.base > this.puffBand;
      const tile = l.scale;
      // (the drift wrapped where every octave of the deck's noise repeats (cloudlayer.wgsl scales it by 0.23, 0.55,
      // 3.4, 5.3 and more: all whole over 200 tiles), never where one of them would jump)
      L.push([l.base, l.thick, l.cover, l.tau], [tile, l.lumpy, l.streak, l.halo],
        [mod(along, tile * WRAP), mod(across, tile * WRAP), l.band ? l.band[0] : 0, l.band ? l.band[1] : 0],
        [front ? 1 : 0, k * 0.37 + 0.13, 1, 0]);
    });
    this.layersU.set({
      L: [0, 1, 2, 3].map((k) => ({ a: L[k * 4], b: L[k * 4 + 1], c: L[k * 4 + 2], d: L[k * 4 + 3] })) as never,
      // (zw: how far the wind has carried the sky since the sprites were listed: they glide on between listings)
      wind: [w[0], w[1], this.drift[0] - this.listed.drift[0], this.drift[1] - this.listed.drift[1]],
      misc: [cityGlow, (2 * Math.tan(fovY / 2)) / Math.max(renderH, 1), 0, 0],
      paint: [this.paint.lit, this.paint.shade, 0, 0], belly: [...this.paint.belly, 0],
    });
  }

  /** a slot's deck at an hour: the day's (the weather's hour by hour), handed over from yesterday's in the small hours */
  private deck(slot: DeckSlot, f: number): LayerSpec | null {
    const b = this.rec?.[slot] ?? null;
    const a = f < 1 ? this.prev?.[slot] ?? null : null;
    const l = f < 1 ? blendLayer(a, b, f) : b;
    // (crossfading from how the sky looked)
    const m = this.morphDecks;
    return m ? morphLayer(m.decks[slot], l, m.mix) : l;
  }

  /** the shadow map's frame, and the sky's cover for the ambient and the exposure */
  private fillSky(cam: V3, key: V3, hour: number) {
    const L = key;
    let e1: V3 = [L[2], 0, -L[0]];
    const l1 = Math.hypot(e1[0], e1[2]);
    e1 = l1 < 1e-4 ? [1, 0, 0] : [e1[0] / l1, 0, e1[2] / l1];
    const e2: V3 = [e1[1] * L[2] - e1[2] * L[1], e1[2] * L[0] - e1[0] * L[2], e1[0] * L[1] - e1[1] * L[0]];
    const texel = SHADOW_EXTENT / SHADOW_PX;
    const u0 = Math.floor((cam[0] * e1[0] + cam[1] * e1[1] + cam[2] * e1[2]) / texel) * texel;
    const v0 = Math.floor((cam[0] * e2[0] + cam[1] * e2[1] + cam[2] * e2[2]) / texel) * texel;
    // the sky's cover: each deck's opaque share, the heaps' share of the sky at this hour
    const mu = Math.max(L[1], 0.05);
    let clear = 1, direct = 1, wsum = 0, dsum = 0, base = 0;
    const f = this.prev ? smooth(1, 5, hour) : 1;
    let low = 1e9, top = 0;
    for (const slot of SLOTS) {
      const l = faded(this.deck(slot, f), this.settings.fade);
      if (!l || l.cover <= 0) continue;
      top = Math.max(top, l.base + l.thick);
      const op = l.cover * (1 - Math.exp(-l.tau * 0.6));
      clear *= 1 - op;
      direct *= 1 - l.cover * (1 - Math.exp(-0.28 * l.tau * 0.9 / mu));
      const R = (0.113 * l.tau) / (1 + 0.113 * l.tau);
      wsum += op; dsum += op * (1 - R); base += op * l.base;
      low = Math.min(low, l.base);
    }
    // (the heaps, storms and lenses: the new sky's and, in a crossfade, the old one's, each by its share)
    const heaps = (r: Recipe | null, share: number) => {
      const cu = r?.cumulus, fd = this.settings.fade;
      if (cu) {
        const env = smooth(cu.start, cu.start + 2.5, hour) * (1 - smooth(cu.end - 1.5, cu.end, hour)) * fd;
        const op = Math.min(0.6, cu.cover * env * (cu.size / 1000) ** 2 * 0.22 * (1 + cu.tall)) * share;
        clear *= 1 - op; direct *= 1 - op * 0.9;
        wsum += op; dsum += op * r!.brightness; base += op * cu.base;
        low = Math.min(low, cu.base);
      }
      const st = r?.storms;
      if (st) {
        const env = smooth(st.start, st.start + 2, hour) * (1 - smooth(st.end - 1, st.end, hour)) * fd;
        const op = Math.min(0.35, st.count * 0.07 * env) * share;
        clear *= 1 - op; direct *= 1 - op;
        wsum += op; dsum += op * 0.1; base += op * st.base;
      }
      if (r?.lenses) { const op = Math.min(0.2, r.lenses.count * 0.03) * fd * share; clear *= 1 - op; wsum += op; dsum += op * 0.6; base += op * r.lenses.base; }
    };
    heaps(this.rec, this.fadingSkies.length ? this.weightOf(null) : 1);
    for (const k of this.fadingSkies) heaps(k.rec, this.weightOf(k));
    const cu = this.rec?.cumulus;
    // (the heaps' tops a few km over their bases, a storm's at the tropopause)
    if (cu) top = Math.max(top, cu.base + 3000);
    if (this.rec?.storms) top = Math.max(top, 13000);
    if (this.rec?.lenses) top = Math.max(top, this.rec.lenses.base + 1500);
    this.over = 1 - smooth(top + 1000, top + 3000, cam[1]);
    const on = this.settings.enabled;
    const cover = on ? 1 - clear : 0;
    this.puffBand = cu ? cu.base + 1000 : this.rec?.lenses ? this.rec.lenses.base : 2500;
    this.dome = { cover, diffuse: wsum > 0 ? dsum / wsum : 0.5, base: wsum > 0 ? base / wsum : 2000, direct: on ? direct : 1 };
    const s = this.settings.shadows;
    this.skyU.set({
      e1: [...e1, u0], e2: [...e2, v0],
      map: [SHADOW_EXTENT, s, this.dome.direct, on && this.skyOn() ? 1 : 0],
      // (climbed out over the tops, what's lit near the camera is under a clear sky: cloudsky.wgsl cloudAmbient)
      dome: [cover * this.over, this.dome.diffuse, 1.8488 + this.dome.base / 1000, this.lapse],
    });
  }

  /** the light on a level patch of ground under this sky, for the exposure: the key light's share (irradiance over
   *  pi) cut by the clouds' mean, and the sky's turned partly to the clouds' grey */
  light(keyE: number, skyE: number) {
    // (climbed out over the clouds, they're under the card: its light is the clear sky's)
    const c = this.dome.cover * this.over, s = this.settings.shadows * this.over;
    const direct = 1 - (1 - this.dome.direct) * s;
    const under = (keyE + skyE) * this.dome.diffuse;
    return keyE * direct + skyE * (1 - c) + under * c;
  }

  /** the panel's list of skies */
  static kinds() { return ['auto', ...SKY_KINDS]; }
}

/** a cumulus heap (after Stormbreak): broad puffs across the base, their bottoms cut flat by the condensation level,
 *  then a lumpy crown piled toward the middle; `rel` is how far up each sits (the order they come in as it grows) */
function heap(c: CloudDef, r: () => number) {
  const W = c.w, H = c.h;
  const ang = r() * Math.PI, ca = Math.cos(ang), sa = Math.sin(ang), stretch = 0.55 + 0.45 * r();
  const ellipse = (u: number, v: number): [number, number] => [(u * ca - v * stretch * sa) * W * 0.5, (u * sa + v * stretch * ca) * W * 0.5];
  // (seen from the ground the base is what shows: enough of them to close it)
  const nb = Math.max(7, Math.round(W / 70));
  for (let i = 0; i < nb; i++) {
    const a = r() * Math.PI * 2, q = 0.1 + 0.85 * Math.sqrt(r());
    const [dx, dz] = ellipse(Math.cos(a) * q, Math.sin(a) * q);
    const pr = W * (0.15 + 0.09 * r()) * (1 - 0.3 * q);
    c.puffs.push({ dx, dy: pr * 0.45, dz, r: pr, seed: r(), rel: 0, kind: 0, len: 0 });
  }
  const nt = Math.max(6, Math.round(W / 50 * Math.min(1.8, 0.6 + c.h / W)));
  const lean: [number, number] = [(r() - 0.5) * 0.4, (r() - 0.5) * 0.4];
  for (let i = 0; i < nt; i++) {
    const a = r() * Math.PI * 2, q = Math.pow(r(), 0.7) * 0.72;
    const [dx, dz] = ellipse(Math.cos(a) * q + lean[0], Math.sin(a) * q + lean[1]);
    const top = Math.pow(Math.max(0, 1 - q * q * 1.6), 0.7);
    const dy = H * top * (0.4 + 0.6 * r());
    const pr = W * (0.08 + 0.09 * r()) * (1 - 0.3 * dy / Math.max(H, 1));
    const y = Math.max(dy, pr * 0.7);
    c.puffs.push({ dx, dy: y, dz, r: pr, seed: r(), rel: Math.min(1, y / Math.max(H, 1)), kind: 0, len: 0 });
  }
}

/** a cumulonimbus: a broad dark base, a column of billows to the tropopause, an anvil spread flat downwind */
function tower(c: CloudDef, r: () => number, wind: [number, number]) {
  const W = c.w, H = c.h;
  const wl = Math.hypot(wind[0], wind[1]) || 1, wx = wind[0] / wl, wz = wind[1] / wl;
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2, q = Math.sqrt(r()) * 0.5;
    const pr = W * (0.1 + 0.07 * r());
    c.puffs.push({ dx: Math.cos(a) * q * W, dy: pr * 0.4, dz: Math.sin(a) * q * W, r: pr, seed: r(), rel: 0, kind: 0, len: 0 });
  }
  for (let i = 0; i < 170; i++) {
    const h = Math.pow(r(), 0.8);
    const rad = W * 0.42 * (1 - 0.3 * h);
    const a = r() * Math.PI * 2, q = Math.sqrt(r());
    const pr = W * (0.08 + 0.07 * r()) * (1 - 0.25 * h);
    // (the tower leans downwind with height)
    c.puffs.push({ dx: Math.cos(a) * q * rad + wx * h * W * 0.25, dy: H * 0.85 * h, dz: Math.sin(a) * q * rad + wz * h * W * 0.25, r: pr, seed: r(), rel: h * 0.85, kind: 0, len: 0 });
  }
  // the anvil: wide, thin, its downwind edge farthest out
  for (let i = 0; i < 90; i++) {
    const along = -0.3 + 2.4 * Math.pow(r(), 0.8), side = (r() - 0.5) * (1.1 + 0.6 * along);
    const pr = W * (0.13 + 0.1 * r());
    const dx = (wx * along - wz * side) * W, dz = (wz * along + wx * side) * W;
    // (its top cut flat: the tropopause stops it)
    c.puffs.push({ dx, dy: H * (0.86 + 0.06 * r()) - pr * 0.15 * along, dz, r: pr, seed: r(), rel: 0.6 + 0.2 * r(), kind: 0, len: 0, ceil: H * 0.96 });
  }
}

/** rain or virga: sheets hanging from under the base */
function virga(c: CloudDef, r: () => number, count: number, len: number, width: number) {
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, q = Math.sqrt(r()) * 0.35;
    c.puffs.push({ dx: Math.cos(a) * q * c.w, dy: 0, dz: Math.sin(a) * q * c.w, r: c.w * (0.06 + 0.06 * r()) * width, seed: r(), rel: 0.5, kind: 2, len: len * (0.7 + 0.5 * r()) });
  }
}

/** a deck melting away (`fade` 1 .. 0): it thins as it breaks up, so its last cells dim evenly rather than shrinking to
 *  bright dense cores */
function faded(l: LayerSpec | null, fade: number): LayerSpec | null {
  return !l || fade >= 1 ? l : { ...l, cover: l.cover * Math.sqrt(fade), tau: l.tau * fade };
}

/** two days' decks in the same slot, eased from one to the other */
function blendLayer(a: LayerSpec | null, b: LayerSpec | null, f: number): LayerSpec | null {
  if (!a && !b) return null;
  if (!a) return { ...b!, cover: b!.cover * f };
  if (!b) return { ...a, cover: a.cover * (1 - f) };
  if (f >= 1) return b;
  const m = (x: number, y: number) => x + (y - x) * f;
  return { cover: m(a.cover, b.cover), base: m(a.base, b.base), thick: m(a.thick, b.thick), tau: m(a.tau, b.tau), scale: f < 0.5 ? a.scale : b.scale,
    lumpy: m(a.lumpy, b.lumpy), streak: m(a.streak, b.streak), halo: m(a.halo, b.halo), band: f < 0.5 ? a.band : b.band };
}

/** a deck in a changing sky: one that comes or goes thickens or thins as it spreads or breaks up (never a hard-edged
 *  scatter of thin cells), and a deck on the ground (fog) only thickens or thins, so it never stands in walls round the
 *  eye */
function morphLayer(a: LayerSpec | null, b: LayerSpec | null, f: number): LayerSpec | null {
  // (two fogs, say a thin scatter into a thick fog: the fuller cover from the start, the other's thickness spread over
  // it, the thickness blended on a log scale — never a partial cover, which stands round the eye as walls of fog)
  if (a && b && (a.base < 150 || b.base < 150)) {
    const cover = Math.max(a.cover, b.cover), m = (x: number, y: number) => x + (y - x) * f;
    const ta = Math.max(a.tau * a.cover / cover, 1e-3), tb = Math.max(b.tau * b.cover / cover, 1e-3);
    return { ...(f < 0.5 ? a : b), cover, base: m(a.base, b.base), thick: m(a.thick, b.thick), tau: Math.exp(m(Math.log(ta), Math.log(tb))) };
  }
  if (a && b) return blendLayer(a, b, f);
  const l = a ?? b;
  if (!l) return null;
  // (its thickness eased in as the light through it goes: a fog's mostly in the last of the fade, a deck's over it all)
  const k = a ? 1 - f : f;
  return l.base < 150 ? { ...l, tau: l.tau * k * k * k } : { ...l, cover: l.cover * (0.5 + 0.5 * k), tau: l.tau * k * k };
}

const cellSeed = (ix: number, iz: number, salt: number) => (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663) ^ Math.imul(salt, 83492791)) >>> 0;
const mod = (x: number, m: number) => ((x % m) + m) % m;
function smooth(a: number, b: number, x: number) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
