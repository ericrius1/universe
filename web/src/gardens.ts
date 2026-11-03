// The dive ends in Seven Havens' gardens: the canyon, the golden temple on its promontory and the terraced gardens
// round it, drawn by Seven Havens' own code (src/havens, its embed.ts: tools/havens-sync.mjs) on this kit, under its
// own sky and through its own post chain, and laid over the cosmos's frame (gardens.wgsl) from a few kilometres up
// down to her face — the meadow (cosmos/levels/surface.ts) hidden under it, and taking over again once her eye fills
// the frame. She lies in a bed of pink flowers beside the temple; they part round her and sway in the canyon's wind.
// It's fetched and built in the background once the page runs (its code a chunk of its own, its builders in workers,
// its pipelines compiled), the meadow showing in its place until it's in.
//
// The camera is the cosmos's: the ground level's view (metres, x east, y up, z south — the canyon's axes too), moved
// to where she lies in the canyon; the canyon's clock is the cosmos's moment at the canyon's site. While the gardens
// draw, the kit's globals are the canyon's World uniform and its camera theirs (Haven.use); the cell's back after.
import { SerialCompiler, type Kit, type UniformBuffer } from '@ericrius1/weft';
import { vec3, type Vec3 } from 'math';
import type { Haven, Pusher } from '@havens/embed';
import shader from './gardens.wgsl';
import { bandWeight, type Band } from './cosmos/renderer';
import type { Cosmos } from './cosmos';
import { POSE_R } from './cosmos/figure/pose';
import type { Place } from './cosmos/frames';
import type { SpotWords } from './cosmos/places';

/** where on Earth: Seven Havens' own site (its world/env.ts SITE, the Sonoran desert's red rock east of Phoenix), its
 *  ground the spot's (the canyon's floor 1.1 km above the sea, the star mesa's plateau 31 m over it); the ground round
 *  it, from the canyon itself (tools/ground-from-havens.mjs) */
export const HAVENS: Place = { lat: 33.2, lon: -111.6, name: 'Seven Havens', km: 1.132 };
export const HAVENS_DATA = 'data/earth-havens/';
export const HAVENS_WORDS: SpotWords = {
  name: 'Seven Havens', short: 'Seven Havens', line: 'A walled city in a red canyon, and on its promontory a golden temple in terraced gardens.',
  person: 'Lying in the flowers', personShort: 'In the flowers', personLine: 'Someone on their back in the flower beds beside the temple, looking up at the sky.',
};
/** the tour's and the journey's words there */
export const HAVENS_CAPTIONS = {
  tourSpot: '<small>3 km</small>Seven Havens: a walled city in a red sandstone canyon, and above it on its promontory the golden temple in its terraced gardens.',
  tourPerson: '<small>2 m</small>Someone lying among the flowers beside the temple, looking up at all of it.',
  journeySpot: 'Seven Havens · the temple and its gardens',
};

/** where the spot's ground is in the canyon (its metres): the pink flower bed beside the citadel's temple on its east
 *  (Seven Havens' haven builder's raised bed, 217 m², its soil at 32.25 m on the star mesa's plateau), the petals over
 *  her */
export const SPOT: Vec3 = [78.8, 32.25, 0.0];
/** the canyon's site (Seven Havens' world/env.ts SITE): its clock's offset from UTC (h) */
const UTC_OFFSET = -7;
/** over the zoom (log10 m): in from a few kilometres up, out once her eye fills the frame (a cut: nothing but her
 *  skin is in view there, and the meadow lays her in as the gardens do) */
const BAND: Band = [4.4, 3.7, -1.7, -1.75];

export class Gardens {
  haven: Haven | null = null;
  /** built and compiled */
  ready = false;
  /** how much shows this frame (0..1) */
  weight = 0;
  private drawing = false;
  /** the cell's near plane, given back when the gardens stop drawing */
  private near = 0.05;
  private u: UniformBuffer<any>;
  private building = false;
  private readonly view = new Float32Array(16);
  /** her body's line in the ground frame (feet to head) and where her middle is, for the flowers to part round */
  private readonly along: Vec3;

  constructor(private kit: Kit, private cosmos: Cosmos, private base: string) {
    this.u = kit.uniforms(shader.structs.HavenU, 'gardens');
    // (the bind-space up of the figure — feet to head — as she lies: figure/pose.ts)
    this.along = vec3.transformQuat(vec3.create(), [0, 1, 0], [...POSE_R] as never) as Vec3;
  }

  /** start building in the background (once) */
  start() {
    if (this.building) return;
    this.building = true;
    void (async () => {
      const t0 = performance.now();
      const kit = this.kit, R = this.cosmos.r, fig = this.cosmos.surface.figure;
      const { Haven, setAssetRoot } = await import('@havens/embed');
      // (its pipelines one at a time, a frame apart, while it's built: asked for all at once, a phone's GPU process
      // compiled them back to back and showed no frame for 10 s; the host's own compiled as before once it's in)
      const was = kit.compiler;
      kit.compiler = new SerialCompiler(kit);
      const say = (what: string) => console.log(`gardens: ${what} at ${Math.round(performance.now() - t0)} ms`);
      say('code in');
      setAssetRoot(`${this.base}havens`);
      const h = this.haven = new Haven(kit);
      await h.built;
      say('built');
      // (a clearing round her in the bed: no tree or shrub over her, the flowers left)
      if (h.flora) h.flora.clearing = { x: SPOT[0], z: SPOT[2], radius: 3, height: 0.9 };
      const ground = this.cosmos.surface.ground;
      // (over the cosmos's frame while they cross-fade; while they fill it, alone: the cosmos's scene, bloom and final
      // pass not run at all, cosmos/renderer.ts covered)
      const bind = { L: ground.L, HV: this.u, havenTex: h.out, sceneZ: h.sceneZ, figCol: fig.col, figDist: fig.dist } as never;
      const lay = kit.pass({ label: 'gardens', color: [{ target: 'screen', clear: false }] });
      lay.fullscreen(shader, { label: 'gardens', blend: 'alpha', bind });
      const whole = kit.pass({ label: 'gardens.whole', color: [{ target: 'screen', clear: [0, 0, 0, 1] }] });
      whole.fullscreen(shader, { label: 'gardens.whole', bind });
      R.first = () => (this.drawing ? h.passes() : []);
      R.last = () => (this.drawing ? [R.covered ? whole : lay] : []);
      const c0 = performance.now();
      const compiled = await kit.ready();
      kit.compiler = was;
      say(`compiled (${compiled.pipelines} pipelines, ${Math.round(performance.now() - c0)} ms)`);
      this.ready = true;
      console.log(`gardens: in ${Math.round(performance.now() - t0)} ms`);
    })().catch((e) => console.warn('gardens: failed to build', e));
  }

  /** this frame (after the cosmos's update: its levels' views are this frame's) */
  update(dt: number) {
    const c = this.cosmos, h = this.haven, kit = this.kit;
    const ground = c.surface.ground;
    this.weight = this.ready && h && !c.r.dome ? bandWeight(c.controls.logS, BAND) * (ground.weight > 0.002 ? 1 : 0) : 0;
    const was = this.drawing;
    this.drawing = this.weight > 0.002;
    c.surface.hidden = this.weight > 0.998;
    c.r.covered = this.weight > 0.998 && !c.r.over;
    c.surface.figure.display = this.drawing;
    if (!this.drawing || !h) {
      if (was && h) { h.unuse(); kit.camera.viewOverride = null; kit.camera.near = this.near; }
      c.r.covered = false;
      return;
    }
    if (!was) this.near = kit.camera.near;
    h.use();
    // the camera: the ground level's view, at the spot in the canyon
    const cam = kit.camera, e = ground.eye, o = ground.origin, f = ground.fwd, r = ground.right, u = ground.up;
    const p: Vec3 = [o[0] + e[0] + SPOT[0], o[1] + e[1] + SPOT[1], o[2] + e[2] + SPOT[2]];
    const v = this.view;
    v.set([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0,
      -(r[0] * p[0] + r[1] * p[1] + r[2] * p[2]), -(u[0] * p[0] + u[1] * p[1] + u[2] * p[2]), f[0] * p[0] + f[1] * p[1] + f[2] * p[2], 1]);
    cam.viewOverride = v as never;
    cam.position = p;
    // (near enough for her lashes, far enough for the canyon's depth)
    cam.near = Math.min(0.1, Math.max(0.0005, c.S * 0.02));
    // the clock: the cosmos's moment at the canyon's site
    const at = new Date(Date.UTC(2000, 0, 1, 12) + c.ladder.day * 86400000 + UTC_OFFSET * 3600000);
    const y = at.getUTCFullYear(), doy = (at.getTime() - Date.UTC(y, 0, 1)) / 86400000;
    h.time(at.getUTCHours() + at.getUTCMinutes() / 60 + at.getUTCSeconds() / 3600, Math.floor(doy), y);
    // the flowers parted round her: her head, her middle, her legs
    const a = this.along, push: Pusher[] = [0.1, -0.55, -1.15].map((k) => ({ at: [SPOT[0] + a[0] * k, SPOT[1] + 0.1, SPOT[2] + a[2] * k], radius: 0.6, strength: 1.5 }));
    h.update(dt, push);
    this.u.set({ a: [this.weight, c.surface.figure.shown ? 1 : 0, 0, 0] });
  }

  /** once the frame is sent */
  after() { if (this.drawing) this.haven?.after(); }
}
