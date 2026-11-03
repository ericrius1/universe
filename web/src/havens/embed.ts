// Seven Havens drawn inside another app on its kit (Universe: the dive from the edge of the universe ends in the
// gardens): the canyon, the Haven and its gardens, the city, the rocks, the flora and the water, under the canyon's
// own sky and through its own post chain into a texture (`out`, the canvas's format) the host lays over its frame. No
// player, cast, bending, input or interface; the device's profile as the game's (util/tier.ts).
//
// The host owns the kit and its camera. Each frame it's on: `use()` (the kit's globals are the World uniform while the
// canyon draws: env.ts), the camera set to the host's view in the canyon's metres (x east, y up, z south) and the
// clock to the host's moment (`time`), then `update(dt, pushers)`, `passes()` run among its own, and `after()` once
// they're sent; `unuse()` gives the host its globals back. `overlay` is the pass right after the scene (its colour the
// scene's HDR, `sceneZ` its distances) for what the host draws into the canyon itself.
import { type Kit, type RenderPass, type RunEntry, type Texture } from '@ericrius1/weft';
import { SCENE_ORDER, type SceneSlot } from './app';
import { Terrain } from './world/terrain';
import { Env } from './world/env';
import { buildPart, carveHaven, havenFloors, plantFlora } from './world/build';
import { Land } from './land/land';
import { VIEW_LEVELS } from './land/levels';
import { Post } from './post/post';
import { Slots } from './util/slots';
import { tier } from './util/tier';
import { ArchRenderer } from './arch/arch';
import { Rocks, catalogInWorker } from './rocks/rocks';
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

export class Haven {
  readonly land: Land;
  readonly terrain: Terrain;
  readonly env: Env;
  readonly post: Post;
  readonly scene: RenderPass;
  readonly order: Slots<SceneSlot>;
  readonly arch: ArchRenderer;
  /** the picture, post-processed, in the canvas's format */
  readonly out: Texture;
  /** the scene's HDR and depth (multisampled with MSAA), and its distances after the scene (post/fx.ts sceneZ) */
  readonly hdr: Texture;
  readonly depth: Texture;
  readonly samples: number;
  rocks: Rocks | null = null;
  flora: Flora | null = null;
  water: Water | null = null;
  /** everything built and planted (the pipelines are the host's to compile: kit.ready) */
  readonly built: Promise<void>;
  private hostGlobals: Kit['globals'];

  constructor(readonly kit: Kit, o: HavenOptions = {}) {
    const withCity = o.city ?? true;
    const lean = o.lean ?? tier.phone;
    if (lean) tier.maxImage = Math.min(tier.maxImage, 1024);
    this.hostGlobals = kit.globals;
    // the builders' work off the main thread from the start, as the game's (main.ts)
    const city = withCity ? buildPart('city') : null;
    const haven = buildPart('haven');
    const catalog = catalogInWorker();

    const land = this.land = new Land(kit, lean ? VIEW_LEVELS : undefined);
    const floors = havenFloors(land.levels);
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
    this.out = kit.texture({ label: 'haven.out', format: kit.format, size: 'render', usage: ['render', 'sample'] });
    const post = this.post = new Post(kit, this.hdr, this.depth, tier.bloomLevels, this.out);
    post.motionBlur.allowed = false;
    env.clouds.attach(post.fx.overlay, post.fx.sceneZ);
    order.into('terrain', () => land.draw(terrain, scene));
    void env.draw(scene, (slot, fn) => order.into(slot, fn));

    const arch = this.arch = new ArchRenderer(kit, env, scene, order);
    const carved = terrain.ready.then(async () => carveHaven(terrain, (await floors).carve));
    const placed = (built: ReturnType<typeof buildPart> | null, slot: 'city' | 'haven') => built?.then(({ part }) => arch.add(part, slot, lean ? { rounds: 0 } : {})) ?? Promise.resolve();
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
    const floraIn = Promise.all([city ?? Promise.resolve(null), haven]).then(async ([c, h]) => {
      const { flora: buffers, count } = await plantFlora([...h.part.beds, ...(c?.part.beds ?? [])]);
      const flora = this.flora = new Flora(kit, buffers, count);
      flora.settings.quality = tier.floraReach;
      flora.settings.shadowCascades = tier.floraShadows;
      flora.settings.dissolve = false;
      order.into('flora', () => flora.draw(scene, samples));
      flora.drawShadows(env.shadows.passes);
    });
    this.built = Promise.all([parts, rocksIn, floraIn, env.loaded]).then(() => {
      const water = this.water = new Water(kit, arch.parts.flatMap((p) => p.water));
      order.into('water', () => water.draw(scene));
    });
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
    const cam = this.kit.camera;
    // (the view's matrices first: the cascades fit the camera as it is, as the game's frame has them)
    this.kit.mainView.update(true);
    this.env.update(dt, cam);
    this.terrain.select(cam);
    this.rocks?.update(cam);
    this.flora?.update(pushers);
  }

  /** this frame's GPU work, to run with the host's */
  passes(): RunEntry[] {
    return [...(this.flora?.passes() ?? []), ...this.env.passes(), this.scene, ...this.post.fx.pre(), ...this.post.run()];
  }

  /** once the frame is sent (the exposure's readbacks) */
  after() { this.env.after(); }

  /** the pass after the scene that draws into its HDR, and the scene's distances (post/fx.ts) */
  get overlay() { return this.post.fx.overlay; }
  get sceneZ() { return this.post.fx.sceneZ; }
}
