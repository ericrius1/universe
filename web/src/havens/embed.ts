// Seven Havens drawn inside another app on its kit (Universe: the dive from the edge of the universe ends in the
// gardens): the canyon, the Haven and its gardens, the city, the rocks, the flora and the water, under the canyon's
// own sky, laid into the host's own frame (`layer`: its HDR, exposed) for the host's film to finish — its bloom, AgX and
// grade with this one's settings (`film`), so the canyon looks as it does in the game. No player, cast, bending, input
// or interface; the device's profile as the game's (util/tier.ts).
//
// The host owns the kit and its camera. Each frame it's on: `use()` (the kit's globals are the World uniform while the
// canyon draws: env.ts), the camera set to the host's view in the canyon's metres (x east, y up, z south) and the
// clock to the host's moment (`time`), then `update(dt, pushers)`, `passes()` run before its own and a layer pass after
// its scene, and `after()` once they're sent; `unuse()` gives the host its globals back. What the host draws into the
// canyon itself goes into the scene pass (`order`'s slots: Universe's figure in 'hero') and the sun's shadow passes
// (env.shadows.passes); `overlay` is the pass right after the scene (its colour the scene's HDR, `sceneZ` its
// distances). `prepare()` starts the builders' work before there's a kit (the host's page as it opens), so the Haven
// made later finds it done or under way.
import type { Film } from '@ericrius1/loom/render/film';
import { type Kit, type RenderPass, type RunEntry, type Texture } from '@ericrius1/weft';
import { SCENE_ORDER, type SceneSlot } from './world/order';
import { Terrain } from './world/terrain';
import { Env } from './world/env';
import { buildPart, carveHaven, havenFloors, plantFlora } from './world/build';
import { Land } from './land/land';
import { LEVELS, VIEW_LEVELS, type HeightLevelSpec } from './land/levels';
import { Post } from './post/post';
import { Slots } from './util/slots';
import { tier } from './util/tier';
import { ArchRenderer } from './arch/arch';
import { partInstances, type PartInstances } from './arch/instances';
import { Rocks, catalogInWorker } from './rocks/rocks';
import type { Catalog } from './rocks/catalog';
import { placeRocksSliced } from './rocks/place';
import { Flora, type Pusher } from './flora/flora';
import { Water } from './water/water';

export { tier, detected, PROFILES } from './util/tier';
export type { Pusher } from './flora/flora';
export { TEMPLE, MESA } from './world/layout';
export { setAssetRoot } from './util/assets';

export interface HavenOptions {
  /** the city in the bowl below the promontory (default true) */
  city?: boolean;
  /** a phone's economies for a host that only looks at the canyon, never walks it (default true on a phone's profile):
   *  coarser height levels away from the promontory (land/levels.ts VIEW_LEVELS), images at 1024 px at most, the
   *  buildings' night light baked without refining their meshes round the lamps */
  lean?: boolean;
}

/** the builders' work, each in workers of its own: the city and the Haven built, the rocks' catalogue, the Haven's
 *  floors under the terrain's levels, and the flora planted in the parts' beds once they're in (the beds shared out
 *  among a few workers) */
interface Builders {
  withCity: boolean;
  lean: boolean;
  levels: HeightLevelSpec[];
  city: ReturnType<typeof buildPart> | null;
  haven: ReturnType<typeof buildPart>;
  catalog: Promise<Catalog>;
  floors: ReturnType<typeof havenFloors>;
  flora: ReturnType<typeof plantFlora>;
}
let prepared: Builders | null = null;

function builders(o: HavenOptions): Builders {
  const withCity = o.city ?? true, lean = o.lean ?? tier.phone, levels = lean ? VIEW_LEVELS : LEVELS;
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const city = withCity ? buildPart('city') : null;
  const haven = buildPart('haven');
  // (the floors are what the rocks and the first view wait on: a few workers beside the parts' builders)
  const floors = havenFloors(levels, Math.min(3, Math.max(1, cores - 3)));
  const flora = Promise.all([city ?? Promise.resolve(null), haven])
    .then(([c, h]) => plantFlora([...h.part.beds, ...(c?.part.beds ?? [])], Math.min(4, Math.max(1, cores - 2))));
  return { withCity, lean, levels, city, haven, catalog: catalogInWorker(), floors, flora };
}

/** the builders started now, before the Haven is made (and before there's a kit): the host's page as it opens. Its
 *  options as the Haven's will be (a Haven made with others builds its own) */
export function prepare(o: HavenOptions = {}) { prepared ??= builders(o); }

export class Haven {
  readonly land: Land;
  readonly terrain: Terrain;
  readonly env: Env;
  readonly post: Post;
  readonly scene: RenderPass;
  readonly order: Slots<SceneSlot>;
  readonly arch: ArchRenderer;
  /** the scene's HDR and depth (multisampled with MSAA), and its distances after the scene (post/fx.ts sceneZ) */
  readonly hdr: Texture;
  readonly depth: Texture;
  readonly samples: number;
  /** the parts' small pieces drawn instanced (arch/instances.ts; null: none placed) */
  readonly parts: Partial<Record<'city' | 'haven', PartInstances | null>> = {};
  rocks: Rocks | null = null;
  flora: Flora | null = null;
  water: Water | null = null;
  /** everything built and planted (the pipelines are the host's to compile: kit.ready); the night sky's stars in, not
   *  the Milky Way (drawn as soon as it's in) */
  readonly built: Promise<void>;
  /** built, and the whole night sky in */
  readonly loaded: Promise<void>;
  private hostGlobals: Kit['globals'];

  constructor(readonly kit: Kit, o: HavenOptions = {}) {
    const withCity = o.city ?? true;
    const lean = o.lean ?? tier.phone;
    if (lean) tier.maxImage = Math.min(tier.maxImage, 1024);
    this.hostGlobals = kit.globals;
    // the builders' work off the main thread from the start, as the game's (main.ts): prepare()'s, or started now
    const b = prepared && prepared.withCity === withCity && prepared.lean === lean ? prepared : builders(o);
    prepared = null;
    const { city, haven, catalog } = b;

    const land = this.land = new Land(kit, undefined, lean ? VIEW_LEVELS : undefined);
    // (the floors made for the land's own levels: under ?land=blockout, its blockout's)
    const floors = land.levels === b.levels ? b.floors : havenFloors(land.levels);
    const terrain = this.terrain = Terrain.create(kit, land);
    const env = this.env = new Env(kit, terrain);
    // (the host's clock: still unless it moves it)
    env.time.hourSpeed = 0;
    env.time.daySpeed = 0;
    // (Env made the World uniform the kit's globals: the host's back until use())
    this.unuse();

    const samples = this.samples = tier.msaa;
    this.hdr = kit.texture({ label: 'haven.hdr', format: 'rgba16float', size: 'render' });
    this.depth = kit.texture({ label: 'haven.depth', format: 'depth32float', size: 'render', samples });
    const hdrMs = samples > 1 ? kit.texture({ label: 'haven.hdr.ms', format: 'rgba16float', size: 'render', samples }) : null;
    this.scene = kit.pass({ label: 'haven.scene', color: [hdrMs ? { target: hdrMs, clear: [0, 0, 0, 0], resolve: this.hdr, store: false } : { target: this.hdr, clear: [0, 0, 0, 0] }], depth: { target: this.depth, clear: 0 } });
    const scene = this.scene;
    const order = this.order = new Slots(scene, SCENE_ORDER, 'opaque');
    // (no bloom or final pass of its own: the host's film finishes the picture)
    const post = this.post = new Post(kit, this.hdr, this.depth, tier.bloomLevels, null);
    post.motionBlur.allowed = false;
    env.clouds.attach(post.fx.overlay, post.fx.sceneZ);
    order.into('terrain', () => land.draw(terrain, scene));
    void env.draw(scene, (slot, fn) => order.into(slot, fn));

    const arch = this.arch = new ArchRenderer(kit, env, scene, order);
    // (a few milliseconds at a time: the host's frames go on)
    const carved = terrain.ready.then(async () => carveHaven(terrain, (await floors).carve, true));
    // (its small parts drawn instanced first, as the game's: their lamps among its lights before the bake. Each part in
    // its turn as it comes in, a frame between its instancing and its add: the host's frames go on)
    let turn: Promise<unknown> = Promise.resolve();
    const placed = (built: ReturnType<typeof buildPart> | null, slot: 'city' | 'haven') => built?.then(({ part }) => {
      const mine = turn.then(async () => {
        this.parts[slot] = partInstances(arch, part, slot);
        await new Promise((r) => setTimeout(r));
        return { baked: arch.add(part, slot, lean ? { rounds: 0 } : {}) };
      });
      turn = mine;
      return mine.then((m) => m.baked);
    }) ?? Promise.resolve();
    const parts = Promise.all([placed(city, 'city'), placed(haven, 'haven')]);
    const rocksIn = Promise.all([carved, catalog, land.textures]).then(async ([, cat]) => {
      const slopeAt = (x: number, z: number) => {
        const e = 1;
        return Math.hypot(terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z), terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e)) / (2 * e);
      };
      // (placed a few milliseconds at a time: the host's frames go on)
      const field = await placeRocksSliced(cat, { heightAt: (x, z) => terrain.heightAt(x, z), slopeAt });
      const rocks = this.rocks = new Rocks(kit, cat, field, { strata: land.layer('sandstone_strata'), flutes: land.layer('cliff_flutes'), sand: land.layer('desert_sand') });
      order.into('rocks', () => rocks.draw(scene));
      env.shadows.passes.forEach((p, i) => rocks.drawShadow(p, i));
    });
    const floraIn = b.flora.then(({ flora: buffers, count }) => {
      const flora = this.flora = new Flora(kit, buffers, count);
      flora.settings.quality = tier.floraReach;
      flora.settings.shadowCascades = tier.floraShadows;
      flora.settings.dissolve = false;
      order.into('flora', () => flora.draw(scene, samples));
      flora.drawShadows(env.shadows.passes);
    });
    this.built = Promise.all([parts, rocksIn, floraIn, env.starsLoad]).then(() => {
      const water = this.water = new Water(kit, arch.parts.flatMap((p) => p.water));
      order.into('water', () => water.draw(scene));
    });
    // (what the first view doesn't need — the Milky Way, 2.5 MB — asked for once everything else is in: over a slow
    // network it held up what the host was waiting for)
    void this.built.then(() => env.later());
    this.loaded = Promise.all([this.built, env.loaded]).then(() => {});
  }

  /** the ground's height under a point (m), once the canyon's in and carved */
  heightAt(x: number, z: number) { return this.terrain.heightAt(x, z); }

  /** the canyon's World uniform as the kit's globals (while it draws), and the host's back */
  use() { if (this.kit.globals !== this.env.world) this.kit.setGlobals(this.env.world); }
  unuse() { if (this.kit.globals !== this.hostGlobals) this.kit.setGlobals(this.hostGlobals!); }

  /** the canyon's clock: the local hour, the day of the year, the year */
  time(hour: number, doy: number, year: number) {
    const t = this.env.time;
    t.hour = hour; t.doy = doy; t.year = year;
  }

  /** this frame, after the kit's camera is set to the host's view: the sky and light, the view's matrices, what's in
   *  view, the flora parted round `pushers` */
  update(dt: number, pushers: Pusher[] = []) {
    const cam = this.kit.camera, t0 = performance.now();
    // (the view's matrices first: the cascades fit the camera as it is, as the game's frame has them)
    this.kit.mainView.update(true);
    this.env.update(dt, cam);
    const t1 = performance.now();
    this.terrain.select(cam);
    const t2 = performance.now();
    this.rocks?.update(cam);
    const t3 = performance.now();
    this.flora?.update(pushers);
    this.cpu.env = t1 - t0; this.cpu.terrain = t2 - t1; this.cpu.rocks = t3 - t2;
  }
  /** the last update's CPU time (ms): the sky, light and shadows' fit; the ground's patches; the rocks' lists */
  readonly cpu = { env: 0, terrain: 0, rocks: 0 };

  /** this frame's GPU work, to run before the host's (the layer after the host's scene) */
  passes(): RunEntry[] {
    return [...(this.flora?.passes() ?? []), ...this.arch.passes(), ...this.env.passes(), this.scene, ...this.post.fx.pre(), ...this.post.run()];
  }

  /** the picture laid into the host's frame (`target`: its HDR, in its film's units), over what's there by `shows`
   *  (blended), or in place of it (whole) */
  layer(target: Texture) { return this.post.layer(target); }
  get shows() { return this.post.settings.layer; }
  set shows(w: number) { this.post.settings.layer = w; }

  /** the scene's light to the host's film units (the eye's exposure: what the layer multiplies by) */
  get exposure() { return this.env.exposure * 2 ** this.post.settings.exposure; }

  /** the film the host finishes the picture with (loom's: loom/film, render/film's Film): this post chain's look
   *  (post.wgsl fs) on the host's bloom chain of six levels, and the sun and the sky for the grade by the time of day
   *  (fx.wgsl fxGrade) */
  film(): Film {
    const s = this.post.settings, f = this.post.fx.settings, sky = this.env.state;
    const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const alt = (Math.asin(Math.max(-1, Math.min(1, sky.sun.dir[1]))) * 180) / Math.PI;
    const k = this.post.fx.bloomWeight;
    let w = 0;
    for (let i = 0, kk = 1; i < 6; i++, kk *= k) w += kk;
    return {
      exposure: 1, bloomShare: s.bloom, bloomAdd: 0, bloomNorm: 6 / w, bloomWeight: k, bloomEven: 1, knee: 0, kneeLo: 1.1, kneeHi: 3.2,
      glow: s.glow, glowFrom: s.glowFrom, halation: f.halation,
      warmth: s.warmth, punch: s.punchy, saturation: s.saturation, saturationAfter: 1,
      contrast: s.contrast, toe: 0, power: 1,
      vignette: 0, vignetteQ: s.vignette, dither: 1 + s.grain * 6, grain: f.grain, grainMids: 1,
      grade: f.grade, split: s.split, rich: s.rich,
      golden: ss(-3, 2, alt) * (1 - ss(8, 18, alt)), dusk: ss(-13, -5, alt) * (1 - ss(-3, 1, alt)), noon: ss(25, 50, alt),
      night: sky.night, cover: this.env.clouds.shownCover * ss(-4, 4, alt),
    };
  }

  /** once the frame is sent (the exposure's readbacks) */
  after() { this.env.after(); }

  /** the pass after the scene that draws into its HDR, and the scene's distances (post/fx.ts) */
  get overlay() { return this.post.fx.overlay; }
  get sceneZ() { return this.post.fx.sceneZ; }
}
