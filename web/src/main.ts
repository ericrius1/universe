// Universe: one continuous zoom from the edge of the observable universe to a single molecule. Above the cell the
// cosmos draws (cosmos/); from the skin down, a human cell from the outside in, one world measured in nanometres.
// Boot: the GPU, the world (layout.ts), its systems (organelles, filaments, molecules, walkers), the camera, the
// interface; then every frame the globals (scale, cut, haze), the molecular field, the run, and a read of what's under
// the cursor.
import { createKit, Capture, AutoResolution, WebGPUUnavailable, type Kit, type RunEntry } from '@ericrius1/weft';
import { vec3, type Vec3 } from 'math';
import { buildWorld, sdOrganelle, Kind, WEDGE, type World } from './world/layout';
import { packOrganelles, Organelles } from './world/organelles';
import { Filaments, type FilamentSet } from './world/filaments';
import { Molecules } from './world/molecules';
import { Field } from './world/field';
import { Walkers } from './world/walkers';
import { Renderer } from './engine/renderer';
import { Controls, type Pick } from './engine/camera';
import { FramePace } from './engine/pace';
import { Hud } from './ui/hud';
import { controls as interfaceToggle } from './ui/controls';
import { picture } from './ui/picture';
import { buildPlaces, type Place } from './ui/places';
import { cardFor, type Card } from './ui/info';
import { Tour } from './ui/tour';
import { Intro } from './ui/intro';
import { FlyUi } from './ui/fly';
import { StatsBox, trackGpuMemory } from '@ericrius1/loom/ui/stats';
import { startReport } from './ui/report';
import { Gardens, HAVENS, HAVENS_CAPTIONS, HAVENS_DATA, HAVENS_WORDS, prepareGardens } from './gardens';
import { TOUR } from './ui/tour';
import { GAMES, type Game, type GameCtx } from './play/game';
import './play/index';
import { Score } from './audio/score';
import { Film } from './film';
import { CELL_FILM, mixFilm, type Film as Look } from './cosmos/film';
import { Journey } from './journey';
import { Loop, approach, JEWEL, SEAM, jewelS, jewelZ, seamMix, cellWay } from './loop';
import { JEWEL_GLASS, WORLD_C, WORLD_R, logSOf, type BeyondView } from './cosmos/levels/beyond';
import { setOrigin, rel, origin, gpuTime } from './engine/origin';
import { Cosmos, moment } from './cosmos';
import { NM } from './cosmos/frames';
import { COSMOS_PLACES as BOULDER_PLACES, cosmosPlaces, type CosmosPlace } from './cosmos/places';
import { SIZE } from './ui/intro';
import { Governor } from './ui/governor';
import { lightGpu } from './ui/gpu';

const asPlace = (p: CosmosPlace): Place => ({ id: p.id, name: p.name, scale: 0, at: [0, 0, 0], yaw: p.yaw, pitch: p.pitch, line: p.line, art: '' });

const $ = (id: string) => document.getElementById(id)!;
const status = (msg: string, f: number) => { $('ld-msg').textContent = msg; ($('ld-bar') as HTMLElement).style.width = `${Math.round(f * 100)}%`; };
const params = new URLSearchParams(location.search);
const BASE = import.meta.env.BASE_URL;
const NO_ORIGIN = params.has('noorigin');
// the dive ends in Seven Havens' gardens (gardens.ts), or under ?nogardens (and on a dome) in Boulder's meadow as before
const GARDENS = !params.has('nogardens') && !params.has('dome');
// (and past the edge of the universe, where the zoom goes on now: the keepers' world, cosmos/levels/beyond.ts; not on a
// dome, which stops at the edge)
const BEYOND_PLACE: CosmosPlace = {
  // (inside their sky, short of where zooming out leaves it for the jewel: src/loop.ts SEAM)
  id: 'u:beyond', name: 'Beyond', short: 'Beyond', logS: logSOf(140), yaw: 0.3, pitch: -0.08, size: '2 m',
  line: 'Our universe, a marble over someone\'s palm: the keepers, and the universes they keep.',
};
const COSMOS_PLACES = [...(params.has('dome') ? [] : [BEYOND_PLACE]), ...(GARDENS ? cosmosPlaces(HAVENS_WORDS) : BOULDER_PLACES)];
if (GARDENS) for (const s of TOUR) {
  if (s.place === 'u:boulder') s.caption = HAVENS_CAPTIONS.tourSpot;
  else if (s.place === 'u:person' && s.caption.startsWith('<small>')) s.caption = HAVENS_CAPTIONS.tourPerson;
}
// the places above the cell, as the dock and the intros know places
for (const p of COSMOS_PLACES) SIZE[p.id] = p.size;
const frame = () => new Promise((res) => requestAnimationFrame(res));

async function boot() {
  const canvas = $('c') as HTMLCanvasElement;
  // (Seven Havens' gardens, where the dive ends: their code fetched and their builders at work from now, while the cell
  // loads — gardens.ts)
  if (GARDENS) void prepareGardens(BASE);
  status('waking the GPU…', 0.05);
  // (?phone: a phone's settings anywhere)
  const mobile = /iPhone|iPad|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 900) || params.has('phone');
  // (a computer whose GPU is light — ui/gpu.ts: a base M1 or M2, as in a MacBook Air; graphics on the processor — has
  // the phone's volumes and the keepers' world as a phone draws them, on the computer's interface; the governor finds
  // the rest from how it runs)
  const light = !mobile && !params.has('film') && lightGpu();
  trackGpuMemory();
  const kit = await createKit(canvas, { maxPixelRatio: mobile ? 2 : 1.5, renderScale: mobile ? 0.7 : 1 });
  const quality = Number(params.get('q') ?? (mobile ? 0.5 : 1));

  status('laying out the cell…', 0.12);
  await frame();
  const world = buildWorld();
  const r = new Renderer(kit, packOrganelles(kit, world));
  status('building membranes…', 0.25);
  await frame();
  new Organelles(kit, r, world, quality);
  const filaments = new Filaments(kit, r, world);
  const pdbMsg = 'fetching molecules from the Protein Data Bank…';
  status(pdbMsg, 0.4);
  const mols = await Molecules.load(kit, BASE, (f) => status(pdbMsg, 0.4 + f * 0.25));
  const field = new Field(kit, r, mols, filaments.set, quality);
  const walkers = new Walkers(world, filaments.set, field);

  const controls = new Controls(canvas);
  status('laying out the universe…', 0.62);
  await frame();
  // (?dome: the planetarium's fisheye on a square canvas, as Fiske's dome gets it; ?now the real moment, ?utc=<h> an hour)
  const dome = params.has('dome');
  if (dome) Object.assign(canvas.style, { width: '100vmin', height: '100vmin', left: 'calc(50vw - 50vmin)', top: 'calc(50vh - 50vmin)', position: 'fixed' });
  const time = params.has('now') ? Date.now() : moment(Number(params.get('utc') ?? 17.5));
  // (a phone marches the volumes at the top of the zoom at half its resolution: they're soft, and the costliest there)
  const cosmos = new Cosmos(kit, {
    time, dome: dome ? { size: Number(params.get('dome') || 1024), out: 'screen' } : undefined, volumeScale: mobile || light ? 0.5 : 1,
    // (past the edge of the universe, the keepers' world: not on a dome; a phone's lighter and at a little less resolution)
    beyond: dome ? undefined : { assets: new URL('data/beyond/', document.baseURI).href, hi: !mobile && !light && !params.has('lo'), scale: mobile || light ? 0.75 : 1 },
    ...(GARDENS ? { place: HAVENS, short: HAVENS_WORDS.short, data: `${new URL(HAVENS_DATA, document.baseURI).href}`, meadow: false } : {}),
  });
  status('compiling shaders…', 0.7);
  const t0 = performance.now();
  const ready = await kit.ready();
  console.log(`cell: ${ready.pipelines} pipelines in ${(performance.now() - t0).toFixed(0)} ms (${ready.failed} failed)`);
  status('', 1);

  // (the jewel, the loop's bead of glass with the keepers' world in it: src/loop.ts — the loop film's, and the app's own
  // zoom round the same loop over the gardens; its pipelines not compiled for other films)
  const SEAMED = GARDENS && !!cosmos.beyond && !params.has('film');
  if (cosmos.beyond && (params.get('film') === 'loop' || SEAMED)) r.jewel(cosmos.beyond.out, !mobile);
  const app = new App(kit, r, world, controls, field, walkers, filaments.set, mols, cosmos);
  // Seven Havens' gardens, where the dive ends: the rest of them made as soon as the cell's in (gardens.ts; ?nogardens
  // the meadow outside Boulder as before, and never on a dome)
  if (SEAMED) app.seamed();
  if (GARDENS) (app.gardens = new Gardens(kit, cosmos, BASE)).start();
  const capture = new Capture(kit);
  // hold the frame rate on smaller GPUs by trading resolution: by the GPU's timestamps where it has them, by the
  // frames' intervals where it hasn't (a phone's Safari; ?pace for the latter anywhere)
  let pace: FramePace | null = null;
  if (!params.has('film') && !params.has('noautores')) {
    if (kit.profiler.available && !params.has('pace')) kit.autoRes = new AutoResolution(mobile ? 24 : 13, { min: 0.5, max: mobile ? 0.8 : 1 });
    else pace = new FramePace({ min: mobile ? 0.4 : 0.5, max: mobile ? 0.8 : 1 });
  }
  // (and where even the least resolution can't hold 30 frames a second, the governor makes it lighter a step at a time,
  // each given back with room to spare, where it settles kept for the next visit: ui/governor.ts; a light GPU starts a
  // step in)
  const res = () => kit.autoRes ?? pace;
  const ratio = mobile ? 2 : 1.5, least = mobile ? 0.4 : 0.5;
  const governor = res() ? new Governor({
    name: 'universe',
    start: light ? 1 : 0,
    steps: [
      { name: 'fewer pixels', set: (on) => { kit.maxPixelRatio = on ? ratio - 0.25 : ratio; } },
      { name: 'fewer pixels still', set: (on) => { kit.maxPixelRatio = on ? Math.max(1, ratio - 0.5) : ratio - 0.25; } },
      { name: 'a lower least resolution', set: (on) => { const r = res(); if (r) r.min = on ? 0.33 : least; } },
    ],
    atFloor: () => kit.renderScale <= (res()?.min ?? 0) + 0.011,
    atCeiling: () => kit.renderScale >= (res()?.max ?? 1) - 0.011,
    onStep: (n, s, taken) => console.info(`governor: ${taken ? '' : 'back: '}${s.name} (step ${n})`),
  }) : null;
  // (the frame rate and the GPU's numbers with the interface, as on the site's other worlds; not in a film)
  const fps = { fps: 0, ms: 0 };
  const stats = new StatsBox({
    get fps() { return fps.fps; }, get ms() { return fps.ms; },
    gpuMs: () => (kit.profiler.active ? kit.profiler.frameMs : 0), scale: () => kit.renderScale,
  }, () => !params.has('film') && !document.body.classList.contains('ui-off') && !document.body.classList.contains('nochrome'));
  let fpsT = 0, fpsN = 0;
  // (a device's report back to the dev server, and the dive flown by itself: ui/report.ts)
  // (and on a page come through a tunnel to this machine — a phone's: its query lost on the tunnel's warning page)
  const tunnel = /ngrok/.test(location.host);
  if (params.has('report') || params.has('auto') || tunnel) startReport(kit, app, params.has('auto') || tunnel);
  kit.loop(({ dt }) => {
    pace?.update(kit); app.frame(dt);
    governor?.frame(kit);
    stats.update(performance.now());
    fpsT += dt; fpsN++;
    if (fpsT > 0.5) { fps.fps = fpsN / fpsT; fps.ms = (fpsT / fpsN) * 1000; fpsT = 0; fpsN = 0; }
  });
  if (params.has('film')) {
    // films step their own frames: no live loop, no visitor at the controls
    kit.manual = true;
    controls.driven = true;
    // (the journey flies both cameras, the cosmos's and the cell's: it goes first, before either)
    const name = params.get('film') || 'trailer';
    const film = name === 'journey' ? new Journey(app, capture) : name === 'loop' ? new Loop(app, capture) : new Film(app, capture, name);
    if (film instanceof Journey || film instanceof Loop) app.journey = (dt) => film.direct(dt);
    else app.director = (dt) => film.direct(dt);
    (window as unknown as Record<string, unknown>).__filmObj = film;
    $('loading').classList.add('gone');
    // (a film waits for the gardens, the night sky's files and all)
    if (app.gardens) await new Promise<void>((r) => { const t = setInterval(() => { if (app.gardens!.ready && app.gardens!.loaded) { clearInterval(t); r(); } }, 100); });
    // (?test: stepped by hand, a frame at a time, for a look at a moment: __filmObj.seek)
    if (!params.has('test')) void film.run();
  }
  $('loading').classList.add('gone');
  // the tools' hooks (tools/shoot.mjs, tools/film.mjs)
  Object.assign(window, {
    app, kit,
    __frames: (n: number) => capture.frames(n),
    __grab: () => capture.grab(),
    __capture: capture,
    __perf: () => ({ gpuMs: +kit.profiler.frameMs.toFixed(2), scale: +controls.scale.toFixed(1), render: kit.size.render }),
    __ready: true,
  });
}

// the haze inside each compartment: (colour, background)
type Haze = [Vec3, Vec3];
const HAZE: Record<string, Haze> = {
  // (the tissue at the bottom of the dive, Lyra's cornea: a dim mauve, her eye's violet in it)
  outside: [[0.05, 0.034, 0.062], [0.028, 0.019, 0.037]],
  cytosol: [[0.006, 0.016, 0.026], [0.0025, 0.007, 0.012]],
  nucleus: [[0.008, 0.007, 0.03], [0.004, 0.0035, 0.015]],
  mito: [[0.016, 0.006, 0.006], [0.007, 0.0025, 0.003]],
  er: [[0.005, 0.02, 0.02], [0.002, 0.009, 0.009]],
  golgi: [[0.025, 0.018, 0.005], [0.01, 0.007, 0.002]],
};
const CRUMB: Record<string, string> = { nucleus: 'Nucleus', mito: 'Mitochondrion', er: 'Endoplasmic reticulum', golgi: 'Golgi' };

export class App {
  /** Seven Havens' gardens at the bottom of the dive (gardens.ts) */
  gardens: Gardens | null = null;
  /** the last frame's CPU time (ms) above the cell: the cosmos's views, the gardens' update, the GPU work recorded */
  readonly cpu = { cosmos: 0, gardens: 0, run: 0 };
  cut = 0;
  /** the visitor's been told the gardens are still loading (cosmosHud) */
  private waitSaid = false;
  cutTarget = 1;
  fluo = 0;
  fluoTarget = 0;
  dof = 1;
  bioTime = 0;
  timeScale = 1;
  hover = 0;
  selected = 0;
  compartmentName = 'outside';
  readonly hud: Hud;
  readonly places: Map<string, Place>;
  readonly tour: Tour;
  readonly intro: Intro;
  readonly flyUi: FlyUi;
  game: Game | null = null;
  readonly score = new Score();
  /** a film's camera, run before the camera updates */
  director: ((dt: number) => void) | null = null;
  /** the journey's camera (both realms'), run before either */
  journey: ((dt: number) => void) | null = null;
  private lastHoverTitle = '';
  private haze: Haze = [[...HAZE.outside[0]] as Vec3, [...HAZE.outside[1]] as Vec3];
  private probing = false;
  private lastPick: (Pick & { x: number; y: number }) | null = null;
  private wedgeDir: Vec3;
  private selectedPick: Pick | null = null;
  private gamePanel: HTMLElement;
  /** the place last flown to, while the view is still there */
  private at: Place | null = null;

  /** which camera has the controls: the world above the cell, or the cell's */
  realm: 'cosmos' | 'cell' = 'cosmos';
  /** how much of the frame is the cosmos's (eased toward 1 above the cell, 0 in it; a film's own: mixDriven) */
  mix = 1;
  mixDriven = false;
  /** one bead made glass, the keepers' world inside it (src/loop.ts): its middle (nm) and radius */
  jewel: { at: Vec3; r: number } | null = null;
  /** the zoom goes round the loop by hand as the loop film does (seamed()): out of the keepers' world onto the jewel, into
   *  the jewel out into their world */
  private seamOn = false;
  /** zooming straight in from the skin, untouched since: the cell's zoom keeps to the film's way down to the jewel */
  private diving = false;
  /** a film's: molecules fading shrink whole, not their beads in place (beads.wgsl) */
  shrinkWhole = false;
  /** the cell's film (cosmos/film.ts): its frame is laid into the cosmos's and graded with it, this mixed in by its share */
  cellFilm: Look = CELL_FILM;
  private cellWork: RunEntry[] = [];
  /** the cell's share of the frame this time, laid in and in the film (App.frame) */
  private cellShare = 0;
  /** the zoom (nm) over which the membranes go from solid to glass (a film's own: src/loop.ts) */
  shellGlass: [number, number] = [300, 900];
  /** a film's: the zoom (nm) over which the empty background goes from the haze's own colour to its darker one */
  hazeBg: [number, number] | null = null;
  /** a film's own haze, from one compartment's toward another's (the same at the same zoom, unlike the eased one) */
  hazeMix: [string, string, number] | null = null;

  constructor(readonly kit: Kit, readonly r: Renderer, readonly world: World, readonly controls: Controls, readonly field: Field,
    readonly walkers: Walkers, readonly fil: FilamentSet, readonly mols: Molecules, readonly cosmos: Cosmos) {
    const placeList = buildPlaces(world);
    this.places = new Map(placeList.map((p) => [p.id, p]));
    const start = this.places.get(params.get('place') ?? 'tissue') ?? this.places.get('tissue')!;
    controls.set(start.at, this.fit(start.scale), start.yaw, start.pitch);
    // the wedge opens toward where the visitor first looks from
    this.wedgeDir = [Math.sin(WEDGE.yaw), 0, Math.cos(WEDGE.yaw)];
    this.cut = start.id === 'tissue' ? 0 : 1;
    // the visit starts at the edge of the observable universe unless a place in the cell was asked for
    if (params.has('place')) this.setRealm('cell', true);
    else {
      this.setRealm('cosmos', true);
      const s = params.get('s');
      cosmos.controls.set(s ? Number(s) : cosmos.controls.start);
    }
    if (params.has('nocut')) this.cutTarget = this.cut = 0;

    const ui = $('ui');
    this.hud = new Hud(ui, [...COSMOS_PLACES.map(asPlace), ...placeList], BASE);
    // the interface's toggle, top right (and / anywhere), as in every project on the site: it shows unless folded away
    interfaceToggle({ name: 'cell', label: 'the interface', phone: true, onChange: (open) => document.body.classList.toggle('ui-off', !open) });
    // a picture of the view (G, or the camera beside the toggle): the frame as drawn, none of the page's interface; a
    // game has the keys while it's on
    let capture: Capture | null = null;
    picture({
      name: 'universe', letter: () => !this.game, sound: () => this.score.out,
      grab: () => (capture ??= new Capture(this.kit)).blob('image/jpeg', 0.92),
    });
    this.gamePanel = document.createElement('div');
    this.gamePanel.className = 'gamepanel';
    ui.append(this.gamePanel);
    this.intro = new Intro(ui);
    // flying: on a touch screen the on-screen stick (and no pointer lock), with a mouse the lock
    this.flyUi = new FlyUi(ui, controls, matchMedia('(pointer: coarse)').matches || params.has('touch'));
    this.tour = new Tour({
      fly: (id, done) => this.tourFly(id, done),
      orbit: (a) => (this.realm === 'cosmos' ? cosmos.controls : controls).orbit(a, 0),
      cancel: () => { controls.cancelFlight(); cosmos.controls.cancelFlight(); },
    }, (s) => {
      this.hud.setCaption(s ? s.caption : '');
      this.hud.setActive('tour', !!s);
      if (s?.cut) this.cutTarget = 1;
    });
    // one film for the whole dive (cosmos/film.ts): the cell's frame laid into the cosmos's HDR — under the cosmos's own
    // as the two hand over, alone below them — and graded with it, the cell's film mixed in by its share
    const lay = r.layInto(cosmos.r.hdr);
    cosmos.r.lay = () => (this.mix < 1 ? [lay] : []);
    cosmos.r.host = (f) => (this.mix < 1 ? mixFilm(this.cellFilm, f, 1 - this.cellShare) : f);
    this.wire();
    this.hud.setActive('cut', true);
    // browsers only start audio from a gesture
    const wake = () => { this.score.start(); this.hud.setActive('sound', !this.score.muted); };
    addEventListener('pointerdown', wake, { once: true });
    addEventListener('keydown', wake, { once: true });
    if (params.has('notitle') || params.has('film')) this.hud.setChrome(false);
    else setTimeout(() => { if (!controls.fly) this.hud.toast(this.realm === 'cosmos' ? 'Scroll or pinch to fall from the edge of the universe to a single molecule' : 'Scroll or pinch to dive in — all the way down to the molecules', 6000); }, 2200);
  }

  /** hand the camera to the cosmos or the cell (`now`: without the crossfade) */
  setRealm(realm: 'cosmos' | 'cell', now = false) {
    this.realm = realm;
    this.controls.enabled = realm === 'cell';
    this.cosmos.controls.enabled = realm === 'cosmos';
    if (now) this.mix = realm === 'cosmos' ? 1 : 0;
  }
  /** the zoom round the loop by hand (main boot, over the gardens): the jewel in the strand, the zoom's top past the
   *  keepers' sky to the loop film's last view, and the cell's way in down to the jewel */
  seamed() {
    this.seamOn = true;
    this.jewel = JEWEL;
    this.cosmos.controls.max = SEAM.Z_END;
    this.controls.guide = { arrive: SEAM.S0 * 0.95, at: (s) => this.cellGuide(s) };
  }
  /** where zooming in by hand takes the cell's camera: the film's way down while diving, else onto the jewel when it's
   *  near and ahead (null: the visitor's own zoom, toward what's under the cursor) */
  private cellGuide(s: number): { pivot: Vec3; yaw: number; pitch: number; exact?: boolean } | null {
    const c = this.controls, j = JEWEL;
    if (this.realm !== 'cell' || c.flying || this.tour.active) { this.diving = false; return null; }
    if (c.turned > 40) this.diving = false;
    // (diving, it's on the film's way already — it came in at the tissue's own place — so the pivot keeps to it exactly)
    if (this.diving) return { ...cellWay(this.places as Map<string, { at: Vec3 }>, Math.log10(s * NM)), exact: true };
    const d = vec3.distance(c.position, j.at);
    if (d > 4 * s) return null;
    const ahead = ((j.at[0] - c.position[0]) * c.forward[0] + (j.at[1] - c.position[1]) * c.forward[1] + (j.at[2] - c.position[2]) * c.forward[2]) / Math.max(d, 1e-9);
    return ahead > 0.94 ? { pivot: j.at, yaw: c.yaw, pitch: c.pitch } : null;
  }
  /** the loop's seam by hand (src/loop.ts SEAM): out past the keepers' sky the cell's camera comes onto the jewel as far
   *  out as the cosmos's is from their world's middle, the two crossing as in the film, and the cell has it once it's
   *  more than half; in on the jewel past the film's first view the cosmos comes in round it the same way. True while
   *  it sets the crossing itself */
  private seam(): boolean {
    const c = this.controls, cc = this.cosmos.controls, J = JEWEL, D = SEAM.DOWN;
    const off = vec3.distance(c.pivot, J.at);
    // (as near as the cosmos takes it from, on the jewel; the keepers' world ready for it before it's needed)
    c.minScale = off < c.scale * 2 || this.diving ? jewelS(D[0]) : 1.2;
    if (this.realm === 'cell' && c.scale < 300 && vec3.distance(c.position, J.at) < 60 * c.scale) this.cosmos.beyond?.load();
    if (this.realm === 'cosmos') {
      if (cc.flying || cc.logS <= D[0]) return false;
      const z = cc.logS, m = seamMix(z);
      c.reach = 1;
      c.set(J.at, jewelS(z), cc.yaw, cc.pitch);
      this.mix = m;
      if (m < 0.5) { this.setRealm('cell'); this.diving = true; c.turned = 0; }
      return true;
    }
    if (off > c.scale * 0.05 || c.flying || c.scale >= SEAM.S0) return false;
    const z = jewelZ(c.scale);
    if (z >= D[1]) return false;
    vec3.copy(c.pivot, J.at);
    const m = seamMix(z);
    cc.set(z, c.yaw, c.pitch);
    this.mix = m;
    if (m >= 0.5) this.setRealm('cosmos');
    return true;
  }
  /** from the skin into the tissue: the cell's camera where the cosmos's was */
  enterCell() {
    if (this.realm === 'cell') return;
    this.diving = true;
    this.controls.turned = 0;
    const cc = this.cosmos.controls, t = this.places.get('tissue')!;
    this.setFly(false);
    // (at the cosmos's own distance: the tissue's sheet is where its cornea's was, cell for cell: cosmos/tissue.ts)
    this.controls.set(t.at, Math.min(this.controls.maxScale, cc.S / NM), cc.yaw, cc.pitch);
    this.cutTarget = 0;
    this.setRealm('cell');
    this.sound('arrive');
  }
  /** out of the tissue: the cosmos's camera where the cell's was (`tour`: the tour's own way out, which goes on) */
  leaveCell(tour = false) {
    if (this.realm === 'cosmos' || this.game) return;
    const c = this.controls;
    this.setFly(false);
    if (!tour) this.tour.stop();
    this.intro.hide(true);
    // (exactly where the cell's was: the tissue's sheet is the same in both, cell for cell)
    this.cosmos.controls.set(Math.max(this.cosmos.controls.min + 0.005, Math.log10(c.scale * NM)), c.yaw, c.pitch);
    this.setRealm('cosmos');
    this.sound('fly');
  }

  private wire() {
    const c = this.controls, hud = this.hud;
    c.onAbove = () => this.leaveCell();
    this.cosmos.controls.onBelow = () => this.enterCell();
    // (zooming in by hand over the gardens, the view comes round to the film's way down onto her: from her feet' side,
    // her face the right way up, never over the crown of her head)
    if (GARDENS) this.cosmos.controls.guide = { band: [this.cosmos.controls.min, 2.6], arrive: 0.3, at: approach };
    c.pick = (x, y) => {
      const p = this.lastPick;
      if (!p || Math.hypot(p.x - x, p.y - y) > 30) return null;
      return p;
    };
    c.onUser = this.cosmos.controls.onUser = () => { if (this.tour.active) this.tour.stop(); };
    c.onClick = (_x, _y, p) => {
      if (this.game) return;
      const card = p ? this.card(p.id) : null;
      this.selected = card ? p!.id : 0;
      this.selectedPick = card ? p : null;
      hud.showCard(card);
      if (card) this.sound('click');
    };
    c.onDoubleClick = (_x, _y, p) => {
      if (!p || this.game) return;
      this.tour.stop();
      const d = vec3.distance(p.world, c.position);
      c.flyTo(p.world, Math.max(c.minScale * 2, d / 6), { speed: 1.3 });
      this.sound('fly');
    };
    hud.onCardFly = () => {
      const p = this.selectedPick;
      if (!p) return;
      c.flyTo(p.world, Math.max(4, vec3.distance(p.world, c.position) / 5));
    };
    hud.onPlace = (id) => this.goTo(id);
    hud.onPlay = (id) => this.startGame(id);
    hud.onButton = (id) => this.button(id);
    c.onFly = (on) => {
      document.body.classList.toggle('flying', on);
      hud.setActive('fly', on);
      this.flyUi.show(on);
      if (on && this.flyUi.touch) hud.toast('Left thumb flies · drag to look', 5000);
    };
    c.onFlySpeed = (f) => hud.toast(`Flying speed ×${f < 1 ? f.toFixed(2) : f.toFixed(1)}`, 1200);
    this.flyUi.onLeave = () => this.setFly(false);
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (this.game) { if (k === 'escape') this.stopGame(); return; }
      if (k === 't') this.button('tour');
      else if (k === 'f') this.button('fly');
      else if (k === 'c') this.button('cut');
      else if (k === 'm') this.button('fluo');
      else if (k === 'h' || k === '?') this.button('help');
      else if (k === 'p') this.button('play');
      else if (k === 'escape') { this.setFly(false); this.tour.stop(); hud.showCard(null); hud.toggleHelp(false); this.intro.hide(true); this.selected = 0; }
      else if (k >= '1' && k <= '9') { const p = [...this.places.values()][Number(k) - 1]; if (p) this.goTo(p.id); }
    });
  }

  sound(name: string, s = 1) { this.score.event(name, s); }

  /** a place's distance widened on a tall screen (the field of view is vertical), so the subject still fits across */
  fit(scale: number) { const a = this.kit.size.css[0] / Math.max(1, this.kit.size.css[1]); return a < 1 ? scale / Math.pow(a, 0.65) : scale; }

  card(id: number): Card | null { return cardFor(id, (i) => this.world.organelles[i]?.kind ?? -1); }

  /** first person on or off (not in a game): everything else that wants the camera or the mouse lands first */
  setFly(on: boolean) {
    if (on === this.controls.fly || (on && this.game)) return;
    if (on) {
      this.tour.stop();
      this.hud.showCard(null);
      this.hud.toggleHelp(false);
      this.hud.hideToast();
      this.intro.hide(true);
      this.selected = 0;
      // (Space rises: it mustn't press the button that has the focus)
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
    this.controls.setFly(on, !this.flyUi.touch);
    this.sound(on ? 'fly' : 'arrive');
  }

  goTo(id: string) {
    this.tour.stop();
    if (id.startsWith('u:')) { this.goToCosmos(id); return; }
    const p = this.places.get(id);
    if (!p) return;
    // (from above the cell: down to the skin, then on into it)
    if (this.realm === 'cosmos') {
      this.intro.show(p);
      this.cosmos.controls.flyTo(this.cosmos.controls.min, { done: () => { this.enterCell(); this.goTo(id); } });
      this.sound('fly');
      return;
    }
    this.setFly(false);
    this.hud.showCard(null);
    if (id === 'cell') this.cutTarget = 1;
    this.controls.flyTo(p.at, this.fit(p.scale), { yaw: p.yaw, pitch: p.pitch, done: () => this.sound('arrive') });
    this.hud.setCaption('');
    this.at = p;
    this.intro.show(p);
    this.sound('fly');
  }

  /** fly the cosmos's camera to one of its places (out of the cell first, if need be) */
  private cosmosAt: CosmosPlace | null = null;
  goToCosmos(id: string) {
    const p = COSMOS_PLACES.find((q) => q.id === id);
    if (!p) return;
    if (this.realm === 'cell') this.leaveCell();
    this.hud.showCard(null);
    this.cosmos.controls.flyTo(p.logS, { pitch: p.pitch, done: () => this.sound('arrive') });
    this.cosmosAt = p;
    this.intro.show(asPlace(p));
    this.sound('fly');
  }

  /** the tour's legs: to a place above the cell or in it, the camera handed over on the way (out of the cell by the
   * tissue's widest view, where the cosmos's camera takes over; into it by the skin, as goTo goes) */
  private tourFly(id: string, done: () => void) {
    const cc = this.cosmos.controls, up = COSMOS_PLACES.find((q) => q.id === id);
    if (up) {
      const fly = () => cc.flyTo(up.logS, { pitch: up.pitch, done });
      if (this.realm === 'cell') this.controls.flyTo(this.places.get('tissue')!.at, Math.pow(10, cc.min) / NM, { speed: 0.85, done: () => { this.leaveCell(true); fly(); } });
      else fly();
      return;
    }
    const p = this.places.get(id)!;
    const fly = () => this.controls.flyTo(p.at, this.fit(p.scale), { yaw: p.yaw, pitch: p.pitch, speed: 0.85, done });
    if (this.realm === 'cosmos') cc.flyTo(cc.min, { done: () => { this.enterCell(); fly(); } });
    else fly();
  }

  /** whether the view is still at a place: about as close, and looking round somewhere near it */
  private near(p: Place) {
    const S = this.controls.scale, s = this.fit(p.scale);
    return Math.abs(Math.log(S / s)) < Math.log(4) && vec3.distance(this.controls.pivot, p.at) < Math.max(S, s) * 1.5;
  }

  button(id: string) {
    const hud = this.hud;
    this.sound('click');
    if (id === 'fly') { this.setFly(!this.controls.fly); return; }
    if (id === 'tour' || id === 'play' || id === 'help') this.setFly(false);
    if (id === 'tour') { if (this.tour.active) this.tour.stop(); else { hud.showCard(null); this.intro.hide(true); this.at = null; this.cosmosAt = null; this.tour.start(); } }
    else if (id === 'cut') { this.cutTarget = this.cutTarget > 0.5 ? 0 : 1; hud.toast(this.cutTarget ? 'Cutaway: the cell opened' : 'Cutaway closed'); }
    else if (id === 'fluo') { this.fluoTarget = this.fluoTarget > 0.5 ? 0 : 1; hud.toast(this.fluoTarget ? 'Fluorescence microscope: DAPI, MitoTracker, tubulin, phalloidin' : 'Back to colour'); }
    else if (id === 'help') hud.toggleHelp();
    else if (id === 'play') this.playMenu();
    else if (id === 'sound') { this.score.start(); this.score.setMuted(!this.score.muted); hud.setActive('sound', !this.score.muted); }
    hud.setActive('cut', this.cutTarget > 0.5);
    hud.setActive('fluo', this.fluoTarget > 0.5);
  }

  private playMenu() {
    const items = GAMES.map((g) => `<button class="play-item" data-id="${g.id}"><img alt="" src="${BASE}art/${g.art}.webp" onerror="this.style.visibility='hidden'"><span><b>${g.role}</b><em>${g.title}</em><small>${g.blurb}</small></span></button>`).join('');
    this.hud.showCard({ title: 'Become part of the cell', text: GAMES.length ? 'Pick a role. Each is a real molecular machine doing its real job, a little slowed down.' : 'Coming soon.' }, `<div class="play-list">${items}</div>`);
    for (const b of document.querySelectorAll<HTMLButtonElement>('.play-item')) b.addEventListener('click', () => this.startGame(b.dataset.id!));
  }

  startGame(id: string) {
    const g = GAMES.find((x) => x.id === id);
    if (!g) { this.hud.toast('That game is still being built'); return; }
    this.setFly(false);
    this.stopGame();
    this.tour.stop();
    this.hud.showCard(null);
    this.hud.hideToast();
    this.intro.hide(true);
    this.at = null;
    this.hud.setChrome(false);
    this.gamePanel.innerHTML = '';
    this.gamePanel.classList.add('on');
    this.game = g;
    const ctx: GameCtx = {
      kit: this.kit, controls: this.controls, field: this.field, world: this.world, fil: this.fil, mols: this.mols, hud: this.hud,
      panel: this.gamePanel, bioTime: () => this.bioTime, sound: (n, s) => this.sound(n, s), exit: () => this.stopGame(),
    };
    g.start(ctx);
  }
  stopGame() {
    if (!this.game) return;
    const g = this.game;
    this.game = null;
    g.stop();
    // the visitor takes over the camera where the game left it (not mid-way through its opening flight, nor easing
    // back to a zoom from before the game)
    this.controls.driven = false;
    this.controls.cancelFlight();
    this.kit.camera.roll = 0;
    this.gamePanel.classList.remove('on');
    this.gamePanel.innerHTML = '';
    this.hud.setChrome(!params.has('notitle'));
  }

  /** the compartment a point is in (the innermost organelle containing it), and that organelle's index */
  where(p: Vec3): { name: string; org: number } {
    const O = this.world.organelles;
    let best = -1, depth = -1;
    for (let i = 0; i < O.length; i++) {
      const o = O[i];
      if (Math.hypot(p[0] - o.center[0], p[1] - o.center[1], p[2] - o.center[2]) > o.bound) continue;
      if (sdOrganelle(o, p) < 0) {
        let d = 0;
        for (let q = o.parent; q >= 0; q = O[q].parent) d++;
        if (d > depth) { depth = d; best = i; }
      }
    }
    if (best < 0) return { name: 'outside', org: -1 };
    const k = O[best].kind;
    const name = k === Kind.Nucleus || k === Kind.Nucleolus ? 'nucleus' : k === Kind.Mito || k === Kind.Crista ? 'mito'
      : k === Kind.ER ? 'er' : k === Kind.Golgi ? 'golgi' : k === Kind.Neighbor || k === Kind.NeighborNucleus ? 'neighbor' : 'cytosol';
    return { name, org: best };
  }

  private crumbs(S: number, at: { name: string; org: number }): string[] {
    if (S > 30000) return ['Human tissue'];
    if (at.name === 'outside') return ['Tissue', S > 3000 ? 'Between cells' : 'Outside the cell'];
    if (at.name === 'neighbor') return ['Tissue', 'A neighbouring cell'];
    const c = ['Tissue', 'Cell'];
    if (CRUMB[at.name]) c.push(CRUMB[at.name]);
    if (at.name === 'nucleus' && S < 600) c.push(S < 40 ? 'DNA' : 'Chromatin');
    else if (at.name === 'mito' && S < 600) c.push('Cristae');
    else if (S < 120) c.push('Molecules');
    return c;
  }

  frame(dt: number) {
    // (the keepers' world drawn from the cosmos's own camera unless the jewel asks otherwise this frame: jewelFrame)
    if (this.cosmos.beyond) this.cosmos.beyond.view = null;
    this.journey?.(dt);
    this.tour.update(dt);
    // the cross-fade between the cosmos and the cell: each draws while it shows (at the loop's seam, by the zoom: seam())
    const cc = this.cosmos.controls;
    const seam = this.seamOn && !this.mixDriven && this.seam();
    if (!this.mixDriven && !seam) {
      const want = this.realm === 'cosmos' ? 1 : 0;
      this.mix += (want - this.mix) * (1 - Math.exp(-dt * 5));
      if (Math.abs(want - this.mix) < 0.004) this.mix = want;
    }
    // (while they cross-fade, the one going keeps to the view of the one coming — the tissue's sheet is in both, cell
    // for cell, cosmos/tissue.ts — so the two are one picture all the way through; a film sets both itself)
    const fading = this.mix > 0 && this.mix < 1;
    if (!this.mixDriven && !seam) {
      this.controls.reach = fading && this.realm === 'cosmos' ? 4 : 1;
      if (fading && this.realm === 'cosmos') this.controls.set(this.places.get('tissue')!.at, Math.min(this.controls.maxScale * 4, cc.S / NM), cc.yaw, cc.pitch);
    }
    // (the jewel crossing with the cosmos: the cosmos's scene and the keepers' world drawn first, the cell then reads
    // them, the cosmos laid over after)
    const early = fading && !!this.jewel && !!this.cosmos.beyond && cc.logS > 26;
    if (early) {
      this.cosmos.update(dt);
      this.gardens?.update(dt);
      this.kit.run(this.cosmos.r.offscreen());
    }
    // (the cell's frame, laid into the film below — cosmos/renderer.ts lay — by its share; crossing with the keepers'
    // world, much darker than it, a share that comes in later, or its light would show through theirs too soon)
    this.cellShare = this.mix >= 1 ? 0 : early ? (1 - this.mix) ** 3 : 1 - this.mix;
    if (this.mix < 1) { this.r.post.set({ lay: this.cellShare }); this.cellFrame(dt); }
    if (fading && this.realm === 'cell' && !this.mixDriven && !seam) cc.follow(Math.log10(this.controls.scale * NM), this.controls.yaw, this.controls.pitch);
    if (this.mix > 0) {
      // (the gardens at the bottom of the dive drawn with it, between its views and its draw: gardens.ts)
      const t0 = performance.now();
      if (!early) this.cosmos.update(dt);
      const t1 = performance.now();
      if (!early) this.gardens?.update(dt);
      const t2 = performance.now();
      if (early) this.kit.run(this.cosmos.r.finish()); else this.cosmos.r.frame();
      this.gardens?.after();
      // (the frame's CPU time, its parts: the report's, ui/report.ts)
      this.cpu.cosmos = t1 - t0; this.cpu.gardens = t2 - t1; this.cpu.run = performance.now() - t2;
      if (this.realm === 'cosmos') this.cosmosHud(dt);
    } else {
      // (the cell alone: its frame and the film's, none of the cosmos's own work, one submission)
      const R = this.cosmos.r;
      R.hostOnly = true;
      this.kit.run([...this.cellWork, ...R.run()]);
      R.hostOnly = false;
    }
  }

  private cosmosHud(dt: number) {
    const cc = this.cosmos.controls, kit = this.kit;
    const S = this.cosmos.S / NM;
    const fovW = 2 * S * Math.tan(kit.camera.fovY / 2) * (kit.size.css[0] / kit.size.css[1]);
    this.hud.update({ fov: fovW, nmPerPx: fovW / kit.size.css[0], timeScale: 1, crumbs: this.cosmos.crumbs(), hover: null, mouse: cc.mouse });
    // (still at the place flown to: about as close)
    if (this.cosmosAt && !cc.flying && Math.abs(cc.logS - this.cosmosAt.logS) > 0.8) this.cosmosAt = null;
    this.hud.setHere(this.cosmosAt?.id ?? null);
    this.intro.update(dt, cc.flying, !!this.cosmosAt);
    // (held over the gardens while they're still coming in: said so after a moment, and gone once they're in)
    if (cc.held > 0.6 && !this.waitSaid) { this.waitSaid = true; this.hud.toast('Seven Havens is still loading in, hang on a sec…', 60000); }
    else if (this.waitSaid && !cc.held) { this.waitSaid = false; this.hud.hideToast(); }
  }

  private cellFrame(dt: number) {
    const c = this.controls, kit = this.kit;
    // the floating origin for this frame: where the camera looked last (everything the GPU gets is relative to it;
    // ?noorigin keeps it at the world's origin, the old float32 trouble, for comparison)
    if (!NO_ORIGIN) setOrigin(c.pivot);
    this.director?.(dt);
    if (this.game) this.game.update(dt);
    c.update(dt, kit.camera);
    rel(c.position, kit.camera.position as Vec3);
    const S = c.scale;
    // biology slows as you zoom in: real time at the scale of the cell, a hundredth of it among the molecules
    this.timeScale = Math.min(1, Math.max(0.01, S / 10000));
    this.bioTime += dt * this.timeScale;
    const ease = (x: number, to: number, rate: number) => x + (to - x) * (1 - Math.exp(-dt * rate));
    this.cut = ease(this.cut, this.cutTarget, 2.2);
    this.fluo = ease(this.fluo, this.fluoTarget, 4);

    const eye = c.position;
    const here = this.where(eye);
    this.compartmentName = here.name === 'neighbor' ? 'cytosol' : here.name;
    const want = HAZE[this.compartmentName] ?? HAZE.cytosol;
    const k = 1 - Math.exp(-dt * 2.5);
    const hm = this.hazeMix;
    if (hm) {
      const a = HAZE[hm[0]], b = HAZE[hm[1]];
      for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) this.haze[i][j] = a[i][j] + (b[i][j] - a[i][j]) * hm[2];
    } else for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) this.haze[i][j] += (want[i][j] - this.haze[i][j]) * k;

    // a key light from over the viewer's left shoulder
    const f = c.forward, rt = c.right, up = c.up;
    const key: Vec3 = [-rt[0] * 0.55 + up[0] * 0.75 - f[0] * 0.35, -rt[1] * 0.55 + up[1] * 0.75 - f[1] * 0.35, -rt[2] * 0.55 + up[2] * 0.75 - f[2] * 0.35];
    // the wedge: two vertical half-spaces round wedgeDir, half-angle up to ~52°
    const half = this.cut * WEDGE.half;
    const rotY = (v: Vec3, a: number): Vec3 => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];
    const n1 = rotY(this.wedgeDir, half - Math.PI / 2), n2 = rotY(this.wedgeDir, Math.PI / 2 - half);
    const fov = kit.camera.fovY;
    const pxAngle = (2 * Math.tan(fov / 2)) / kit.size.render[1];
    const outside = this.compartmentName === 'outside';
    const fogK = outside ? 6 : 1.4 + 1.6 * Math.min(1, Math.max(0, Math.log10(S / 100) / 2));
    const [g0, g1] = this.shellGlass;
    const solid = Math.min(1, Math.max(0, (g1 - S) / (g1 - g0)));
    const hb = this.hazeBg ? Math.min(1, Math.max(0, Math.log(this.hazeBg[1] / S) / Math.log(this.hazeBg[1] / this.hazeBg[0]))) : 0;
    this.r.globals.set({
      focus: rel(c.pivot), scale: S, keyDir: key, level: Math.log2(Math.max(S, 1) / 30),
      cutCenter: rel(WEDGE.center), cut: this.cut > 0.01 ? this.cut : 0, cutN1: n1, cutN2: n2, cutRadius: WEDGE.radius,
      bioTime: gpuTime(this.bioTime), timeScale: this.timeScale, fluo: this.fluo,
      fogColor: this.haze[0].map((x) => x * (1 - this.fluo)) as Vec3, bgColor: this.haze[1].map((x) => x * (1 - this.fluo)) as Vec3,
      fogDist: S * fogK, clearRadius: S * 0.42, pxAngle,
      organelleCount: this.world.organelles.length, hover: this.hover, selected: this.selected, highlight: 1,
      quality: 1, flags: this.shrinkWhole ? 1 : 0, shellSolid: solid * solid * (3 - 2 * solid), dof: this.dof, origin, hazeBg: hb * hb * (3 - 2 * hb),
    });
    this.r.globals.set({ jewel: this.jewel ? [...rel(this.jewel.at), this.jewel.r] as never : [0, 0, 0, 0] });
    // how far off a nucleosome (10.74 nm) and a base pair (1.1 nm) still count as over 9 px, the haze taken in
    // (world.wgsl lodPx: falls with distance, so halving finds it)
    const fogDist = S * fogK;
    const reach = (r: number) => {
      let lo = 0, hi = r / (9 * pxAngle);
      for (let i = 0; i < 40; i++) { const d = (lo + hi) / 2; if ((r / (d * pxAngle)) * Math.exp((-0.5 * d) / fogDist) > 9) lo = d; else hi = d; }
      return lo;
    };
    // (chromatin's reach round the focus: everywhere, but round a film's jewel made out from it as the view widens — the
    // strands round the bead the eye has just left not flying past the lens — open by ~15 nm)
    // (by hand, only round the jewel: away from it, a strand anywhere as it always is)
    const away = this.seamOn && this.jewel ? Math.exp(Math.min(60, Math.max(0, vec3.distance(c.position, this.jewel.at) / S - 3))) : 1;
    const chrom = this.jewel ? Math.min(1e30, 2.6 * S * (1 + (S / 4) ** 3) * away) : 1e30;
    this.r.globals.set({ lodReach: [reach(10.74), reach(1.1), chrom, 0] as never });
    this.jewelFrame(dt);
    // the molecular field: the motors walking (games add their own actors first), then generation round the focus
    if (!this.game) this.field.actorCount = 0;
    this.walkers.update(this.bioTime, c.pivot, S);
    this.field.update(c.pivot, eye, S, pxAngle);
    // (run with the film's work after it when the cell's alone — App.frame — else now, before the cosmos moves the camera)
    if (this.mix > 0) this.r.frame(); else this.cellWork = this.r.work();
    this.probe();

    // the interface
    const fovW = 2 * S * Math.tan(fov / 2) * (kit.size.css[0] / kit.size.css[1]);
    const hover = this.game ? null : this.card(this.hover);
    if ((hover?.title ?? '') !== this.lastHoverTitle) { this.lastHoverTitle = hover?.title ?? ''; if (hover) this.sound('hover', 0.6); }
    this.hud.update({
      fov: fovW, nmPerPx: fovW / kit.size.css[0], timeScale: this.timeScale,
      crumbs: this.crumbs(S, this.where(c.pivot)), hover, mouse: c.mouse,
    });
    this.score.update(dt, S, this.compartmentName);
    if (c.fly) this.flyUi.update(c.speed);
    if (this.at && !c.flying && !this.near(this.at)) this.at = null;
    this.intro.update(dt, c.flying, !!this.at);
    this.hud.setHere(this.at?.id ?? null);
  }

  /** the jewel this frame (src/loop.ts): the keepers' world drawn from where this camera is, as it would be in their
   *  world (the jewel's glass their sky's radius times JEWEL_GLASS), for the jewel's pass to see through */
  private jewelFrame(dt: number) {
    const r = this.r, b = this.cosmos.beyond, j = this.jewel, J = r.jewelU;
    r.first = () => [];
    const c = this.controls, kit = this.kit;
    // (not while it'd be under a pixel)
    const dist = j ? Math.hypot(c.position[0] - j.at[0], c.position[1] - j.at[1], c.position[2] - j.at[2]) : 0;
    const px = j ? j.r / Math.max(dist, 1e-6) / ((2 * Math.tan(kit.camera.fovY / 2)) / kit.size.render[1]) : 0;
    r.jewelOn = !!(j && b && b.ready && J) && px > 0.5;
    if (!r.jewelOn || !j || !b || !J) return;
    J.set({ center: rel(j.at), radius: j.r, inner: [1.8, 1.45, 0.74, 0], tint: [0.7, 0.75, 0.92, 1], flags: [1, 0, 0, 0] });
    // (crossing with the cosmos, its own camera — the same view — draws their world: App.frame)
    if (this.mix > 0) { b.view = null; return; }
    const k = j.r / JEWEL_GLASS / WORLD_R;
    const eye: Vec3 = [WORLD_C[0] + (c.position[0] - j.at[0]) / k, WORLD_C[1] + (c.position[1] - j.at[1]) / k, WORLD_C[2] + (c.position[2] - j.at[2]) / k];
    const fov = kit.camera.fovY, [W, H] = kit.size.render, th = Math.tan(fov / 2);
    const view: BeyondView = { eye, fwd: [...c.forward] as Vec3, right: [...c.right] as Vec3, up: [...c.up] as Vec3, tanHalf: th, aspect: W / Math.max(1, H), pxAngle: (2 * th) / H };
    b.view = view;
    b.universe = false;
    b.update(this.cosmos.controls.logS, dt);
    r.first = () => (b.on ? this.cosmos.r.after : []);
  }

  /** read depth and id under the cursor (a frame or two late) */
  private probe() {
    if (this.probing) return;
    const kit = this.kit, [mx, my] = this.controls.mouse;
    const rect = kit.canvas.getBoundingClientRect();
    const px = ((mx - rect.left) / rect.width) * kit.size.render[0], py = ((my - rect.top) / rect.height) * kit.size.render[1];
    const inv = kit.camera.invViewProj.slice();
    // (unprojected relative to this frame's origin)
    const o: Vec3 = [origin[0], origin[1], origin[2]];
    this.probing = true;
    Promise.all([this.r.depth.readTexel(px, py), this.r.ids.readTexel(px, py)]).then(([d, id]) => {
      this.probing = false;
      if (!d || !id) return;
      const z = new Float32Array(d)[0], ident = new Uint32Array(id)[0];
      this.hover = ident;
      if (z <= 0) { this.lastPick = null; return; }
      const x = (px / kit.size.render[0]) * 2 - 1, y = 1 - (py / kit.size.render[1]) * 2;
      const w = inv[3] * x + inv[7] * y + inv[11] * z + inv[15];
      const world: Vec3 = [(inv[0] * x + inv[4] * y + inv[8] * z + inv[12]) / w + o[0], (inv[1] * x + inv[5] * y + inv[9] * z + inv[13]) / w + o[1], (inv[2] * x + inv[6] * y + inv[10] * z + inv[14]) / w + o[2]];
      this.lastPick = { world, id: ident, depth: z, x: mx, y: my };
    }, () => { this.probing = false; });
  }
}

addEventListener('error', (e) => { if (!(window as unknown as Record<string, unknown>).__ready) (window as unknown as Record<string, unknown>).__failed = String(e.error?.stack ?? e.message); });
boot().catch((e) => {
  console.error(e);
  const msg = e instanceof WebGPUUnavailable ? `${e.message} Try a recent Chrome, Edge or Safari.` : `Something went wrong: ${(e as Error).message}`;
  $('ld-msg').textContent = msg;
  (window as unknown as Record<string, unknown>).__failed = String(e);
});
