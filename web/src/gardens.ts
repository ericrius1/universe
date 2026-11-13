// The dive ends in Seven Havens' gardens: the canyon, the golden temple on its promontory and the terraced gardens
// round it, drawn by Seven Havens' own code (src/havens, its embed.ts: tools/havens-sync.mjs) on this kit, under its
// own sky, and laid into the cosmos's frame (Haven.layer: its HDR, before the bloom) from a few kilometres up down to
// her eye — one frame and one film from the edge of the universe to her eye (cosmos/film.ts: the cosmos's settings
// above, Seven Havens' below, mixed as the gardens come in). She lies in a bed of pink flowers beside the temple, drawn
// into the canyon's own scene (figure.ts world: lit by its sun, in its shadow maps); the flowers part round her and sway
// in the canyon's wind. Once her eye fills the frame the canyon isn't drawn: she's drawn alone (figure.ts facePass), on
// down to the cornea's cells. It's fetched and built in the background from the moment the page opens (prepareGardens:
// its code a chunk of its own, its builders in workers while the cell loads; then its GPU side and its pipelines once
// the cell's in, or at once in a window that opens on them: windows.ts); until it's in, the dive slows into a floor a
// little above it and waits there (controls.floor, from realms.ts).
//
// The camera is the cosmos's: the ground level's view (metres, x east, y up, z south — the canyon's axes too), moved
// to where she lies in the canyon; the canyon's clock is the cosmos's moment at the canyon's site. While the gardens
// draw, the kit's globals are the canyon's World uniform and its camera theirs (Haven.use); the cell's back after.
import { SerialCompiler, type Kit } from '@ericrius1/weft';
import { vec3, type Vec3 } from 'math';
import type { Haven, Pusher } from '@havens/embed';
import { bandWeight, type Band } from './cosmos/renderer';
import { COSMOS_FILM, mixFilm, type Film } from './cosmos/film';
import type { Cosmos } from './cosmos';
import { POSE_R } from './cosmos/figure/pose';
import type { Place } from './cosmos/frames';
import type { SpotWords } from './cosmos/places';

/** the pipelines compiled `lanes` at a time, each timed: the slowest named in the log (a phone's report reads it). One
 *  lane is weft's SerialCompiler, one a frame: WebKit (Safari, and every browser on an iPhone) compiles them one by one
 *  and its GPU process answers nothing else meanwhile. Chrome compiles them on a pool of threads, so a few at once there:
 *  one at a time and a frame apart, a first visit's (nothing cached) took five seconds on a Mac */
class TimedCompiler extends SerialCompiler {
  readonly times: [string, number][] = [];
  private busy = 0;
  private waiting: (() => void)[] = [];
  constructor(kit: Kit, private lanes: number) { super(kit); }
  compile(rec: Parameters<SerialCompiler['compile']>[0], start: () => Promise<unknown>): Promise<unknown> {
    const timed = () => { const t = performance.now(); return start().finally(() => this.times.push([rec.label, performance.now() - t])); };
    if (this.lanes <= 1) return super.compile(rec, timed);
    return new Promise((res) => {
      const go = () => { this.busy++; res(timed().finally(() => { this.busy--; this.waiting.shift()?.(); })); };
      if (this.busy < this.lanes) go(); else this.waiting.push(go);
    });
  }
  slowest(n: number) { return [...this.times].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, ms]) => `${k} ${Math.round(ms)}`).join(', '); }
}
const WEBKIT = /iPhone|iPad/.test(navigator.userAgent) || (/AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg\//.test(navigator.userAgent));

/** Seven Havens' code, its builders started: asked for as the page opens (main.ts, before the cell's own boot), so its
 *  chunk comes in and its workers build the city and the Haven, their floors under the land and the flora in their beds
 *  while the cell loads; the Haven made later (Gardens.start) takes what they've done */
let havens: Promise<typeof import('@havens/embed')> | null = null;
export function prepareGardens(assets: string) {
  return (havens ??= import('@havens/embed').then((m) => {
    m.setAssetRoot(`${assets}havens`);
    m.prepare();
    return m;
  }));
}

/** where on Earth: Seven Havens' own site (its world/env.ts SITE, the Sonoran desert's red rock east of Phoenix), its
 *  ground the spot's (the canyon's floor 1.1 km above the sea, the star mesa's plateau 31 m over it); the ground round
 *  it, from the canyon itself (tools/ground-from-havens.mjs) */
export const HAVENS: Place = { lat: 33.2, lon: -111.6, name: 'Seven Havens', km: 1.132 };
export const HAVENS_DATA = 'data/earth-havens/';
export const HAVENS_WORDS: SpotWords = {
  name: 'Seven Havens', short: 'Seven Havens', line: 'A walled city in a red canyon, a golden temple above it.',
  person: 'Lying in the flowers', personShort: 'In the flowers', personLine: 'Someone in the flowers, looking up.',
};
/** the tour's and the journey's words there */
export const HAVENS_CAPTIONS = {
  tourSpot: '<small>3 km</small>Seven Havens: a walled city in a red canyon, a golden temple above it.',
  tourPerson: '<small>2 m</small>Someone in the flowers, looking up at all of it.',
  journeySpot: 'Seven Havens · the temple and its gardens',
  journeyLying: 'from someone lying in the flowers, to the edge of everything, and back',
};

/** where the spot's ground is in the canyon (its metres): the pink flower bed beside the citadel's temple on its east
 *  (Seven Havens' haven builder's raised bed, 217 m², its soil at 32.25 m on the star mesa's plateau), the petals over
 *  her */
export const SPOT: Vec3 = [78.8, 32.25, 0.0];
/** the canyon's site (Seven Havens' world/env.ts SITE): its clock's offset from UTC (h) */
const UTC_OFFSET = -7;
/** over the zoom (log10 m): in from a few kilometres up (its film too), on down to her eye; the dive held above it until
 *  it's in */
const BAND: Band = [4.4, 3.7, -99, -100];
/** where her eye fills the frame (log10 m): the canyon cut there (nothing but her skin in view), she alone below */
const EYE = -1.75;

export class Gardens {
  haven: Haven | null = null;
  /** built and compiled */
  ready = false;
  /** and the night sky's files in too (the Milky Way: what a film waits for, never the dive) */
  loaded = false;
  /** how much shows this frame (0..1) */
  weight = 0;
  private drawing = false;
  /** the cell's near plane, given back when the gardens stop drawing */
  private near = 0.05;
  private building = false;
  /** the cosmos's own film, and Seven Havens' (this frame's) */
  private readonly base: Film;
  private film: Film = { ...COSMOS_FILM };
  private readonly view = new Float32Array(16);
  /** her body's line in the ground frame (feet to head) and where her middle is, for the flowers to part round */
  private readonly along: Vec3;

  constructor(private kit: Kit, private cosmos: Cosmos, private assets: string) {
    this.base = { ...cosmos.r.film };
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
      const { Haven } = await prepareGardens(this.assets);
      // (its pipelines a few at a time while it's built, one a frame apart on WebKit: asked for all at once, a phone's
      // GPU process compiled them back to back and showed no frame for 10 s; the host's own compiled as before once
      // it's in)
      const was = kit.compiler, serial = new TimedCompiler(kit, WEBKIT ? 1 : 3);
      kit.compiler = serial;
      const say = (what: string) => console.log(`gardens: ${what} at ${Math.round(performance.now() - t0)} ms`);
      say('code in');
      const h = this.haven = new Haven(kit);
      void h.loaded.then(() => { this.loaded = true; });
      await h.built;
      say('built');
      // (a clearing round her in the bed: no tree or shrub over her, the flowers left)
      if (h.flora) h.flora.clearing = { x: SPOT[0], z: SPOT[2], radius: 3, height: 0.9 };
      // her, in its scene and its shadow maps; alone once her eye fills the frame (the depth the canyon's where it has one
      // sample a pixel: it isn't drawn then)
      fig.world(h.scene, (draw) => h.order.into('hero', draw), h.env.shadows.passes);
      const face = fig.facePass(R.hdr, h.samples === 1 ? h.depth : kit.texture({ label: 'figure.face.depth', format: 'depth32float', size: 'render' }));
      // (over the cosmos's scene while they cross-fade; while they fill the frame, in place of it: its levels not drawn,
      // cosmos/renderer.ts covered)
      const { over, whole } = h.layer(R.hdr);
      R.first = () => (this.drawing ? h.passes() : []);
      R.afterScene = () => (this.drawing ? [R.covered ? whole : over] : fig.face ? [face] : []);
      const c0 = performance.now();
      const compiled = await kit.ready();
      kit.compiler = was;
      say(`compiled (${compiled.pipelines} pipelines, ${Math.round(performance.now() - c0)} ms; slowest ${serial.slowest(8)})`);
      this.ready = true;
      console.log(`gardens: in ${Math.round(performance.now() - t0)} ms`);
    })().catch((e) => console.warn('gardens: failed to build', e));
  }

  /** this frame (after the cosmos's update: its levels' views are this frame's) */
  update(dt: number) {
    const c = this.cosmos, h = this.haven, kit = this.kit, R = c.r, fig = c.surface.figure;
    const ground = c.surface.ground, l = c.controls.logS;
    // (the dive is held a little above the gardens until they're in: main.ts's realms, by their band's top)
    this.weight = this.ready && h && !R.dome ? bandWeight(l, BAND) * (ground.weight > 0.002 ? 1 : 0) : 0;
    const was = this.drawing;
    // (the canyon drawn down to her eye; she alone past it)
    fig.face = this.weight > 0.002 && l < EYE;
    this.drawing = fig.inWorld = this.weight > 0.002 && !fig.face;
    c.surface.hidden = this.weight > 0.998;
    R.covered = this.weight > 0.998;
    // the film: Seven Havens' as the gardens come in (as it last was, past her eye)
    R.film = this.weight > 0 ? mixFilm(this.base, this.film, this.weight) : this.base;
    if (!this.drawing || !h) {
      if (was && h) { h.unuse(); kit.camera.viewOverride = null; kit.camera.near = this.near; }
      if (fig.face) fig.placeIn(SPOT, 1);
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
    h.shows = this.weight;
    fig.placeIn(SPOT, h.exposure);
    // (its film's settings over the cosmos's: what it doesn't set, the cosmos's — the bloom's knee)
    this.film = { ...this.base, ...h.film() };
    R.film = mixFilm(this.base, this.film, this.weight);
  }

  /** once the frame is sent */
  after() { if (this.drawing) this.haven?.after(); }
}
