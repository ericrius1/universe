// The app over the whole zoom: the cosmos's camera above the cell and the cell's in it, handed over at the skin; the
// interface; every frame's work. Each part of it is a realm (main.ts builds them, windows.ts says which): the cosmos's
// levels arrive in it as they're built, and the cell's realm with attachCell — until then it isn't there (a window above
// the cell has none), and the zoom is held short of whatever hasn't come in (holds()).
import { Capture, type Kit, type RunEntry } from '@ericrius1/weft';
import { vec3, type Vec3 } from 'math';
import type { World } from './world/layout';
import type { Field } from './world/field';
import type { Walkers } from './world/walkers';
import type { FilamentSet } from './world/filaments';
import type { Molecules } from './world/molecules';
import type { Renderer } from './engine/renderer';
import type { Controls, Pick } from './engine/camera';
import type { CosmosControls } from './cosmos/controls';
import type { Taau } from '@ericrius1/weft';
import type { Place } from './ui/places';
import type { Card } from './ui/info';
import type { Game, GameCtx } from './play/game';
import type { Cell } from './cell';
import { Hud } from './ui/hud';
import { controls as interfaceToggle } from './ui/controls';
import { picture } from './ui/picture';
import { Tour, TOUR, type Stop } from './ui/tour';
import { Intro, SIZE } from './ui/intro';
import { FlyUi } from './ui/fly';
import { Gardens, HAVENS_CAPTIONS, HAVENS_WORDS } from './gardens';
import { Score } from './audio/score';
import { CELL_FILM, mixFilm, type Film as Look } from './cosmos/film';
import { approach, JEWEL, SEAM, jewelS, jewelZ, seamMix, cellWay } from './loop';
import { JEWEL_GLASS, WORLD_C, WORLD_R, logSOf, type BeyondView } from './cosmos/levels/beyond';
import { setOrigin, rel, origin, gpuTime } from './engine/origin';
import type { Cosmos } from './cosmos';
import { NM } from './cosmos/frames';
import { COSMOS_PLACES as BOULDER_PLACES, cosmosPlaces, type CosmosPlace } from './cosmos/places';
import { CELL_TOP, inWindow, whole, type ZoomWindow } from './windows';
import type { Realms } from './realms';
import { Guiding, address } from './ui/guiding';
import { WELL_PLACES, WELL_BOTTOM, BENCH, FOG_CLOSE, onWellWay, pitchAt } from './lab/way';
import type { Lab, Hepatocyte } from './lab/lab';
import type { Way } from './windows';
import type { Place as LadderPlace } from './cosmos/frames';

/** a view distance (log10 m) to the width of the view across the screen (log10 nm), about */
const FOV_NM = 9.2;
/** the well's way (lab/way.ts): where the two ways down part (the main line's places below it are its own), where the
 *  dive's spot is moved from one to the other (the Earth seen whole: the view on its middle), and above where, zooming
 *  out on the well's, the main line's live again */
const WAY_FORK = 4.9, WAY_TURN = 7.15, WAY_BACK = 7.6;

const asPlace = (p: CosmosPlace): Place => ({ id: p.id, name: p.name, scale: 0, at: [0, 0, 0], yaw: p.yaw, pitch: p.pitch, line: p.line, art: '' });

const $ = (id: string) => document.getElementById(id)!;
const params = new URLSearchParams(location.search);
const BASE = import.meta.env.BASE_URL;
const NO_ORIGIN = params.has('noorigin');
// the dive ends in Seven Havens' gardens (gardens.ts), or under ?nogardens (and on a dome) in Boulder's meadow as before
export const GARDENS = !params.has('nogardens') && !params.has('dome');
// (and past the edge of the universe, where the zoom goes on now: the keepers' world, cosmos/levels/beyond.ts; not on a
// dome, which stops at the edge)
const BEYOND_PLACE: CosmosPlace = {
  // (inside their sky, short of where zooming out leaves it for the jewel: src/loop.ts SEAM)
  id: 'u:beyond', name: 'Beyond', short: 'Beyond', logS: logSOf(140), yaw: 0.3, pitch: -0.08, size: '2 m',
  line: 'What holds it all.',
};
export const COSMOS_PLACES = [...(params.has('dome') ? [] : [BEYOND_PLACE]), ...(GARDENS ? cosmosPlaces(HAVENS_WORDS) : BOULDER_PLACES), ...(params.has('dome') ? [] : WELL_PLACES)];
if (GARDENS) for (const s of TOUR) {
  if (s.place === 'u:boulder') s.caption = HAVENS_CAPTIONS.tourSpot;
  else if (s.place === 'u:person' && s.caption.startsWith('<small>')) s.caption = HAVENS_CAPTIONS.tourPerson;
}
// (the whole tour, kept: the window's is the stops in it)
const FULL_TOUR: Stop[] = [...TOUR];
// the places above the cell, as the dock and the intros know places
for (const p of COSMOS_PLACES) SIZE[p.id] = p.size;

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
  /** the temporal upscaler (?taau), or null */
  taau: Taau | null = null;
  /** the last frame's CPU time (ms) above the cell: the cosmos's views, the gardens' update, the GPU work recorded */
  readonly cpu = { cosmos: 0, gardens: 0, run: 0 };
  cut = 0;
  /** the visitor's been told something's still loading (cosmosHud) */
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
  /** the cell's places (none until its realm is in) */
  readonly places = new Map<string, Place>();
  readonly tour: Tour;
  readonly intro: Intro;
  /** the guide: the story in chapters, what to look for, the instruments (ui/guiding.ts) */
  readonly guiding: Guiding;
  flyUi: FlyUi | null = null;
  game: Game | null = null;
  /** the music: "Cosmic Drift", 20 min of Suno stems blended, round and round (audio/score.ts) */
  readonly score = new Score(params.has('film') ? undefined : { url: `${BASE}data/score/cosmic-drift.m4a` });
  /** a film's camera, run before the camera updates */
  director: ((dt: number) => void) | null = null;
  /** the journey's camera (both realms'), run before either */
  journey: ((dt: number) => void) | null = null;
  private lastHoverTitle = '';
  private haze: Haze = [[...HAZE.outside[0]] as Vec3, [...HAZE.outside[1]] as Vec3];
  private probing = false;
  private lastPick: (Pick & { x: number; y: number }) | null = null;
  private wedgeDir: Vec3 = [0, 0, 1];
  private selectedPick: Pick | null = null;
  private gamePanel: HTMLElement;
  /** the place last flown to, while the view is still there */
  private at: Place | null = null;

  /** the cell's realm, once it's in (attachCell): its world, renderer, camera and systems */
  cell: Cell | null = null;
  // (the cell's parts, there once it's in: films and the tools reach them here)
  r!: Renderer;
  world!: World;
  controls!: Controls;
  field!: Field;
  walkers!: Walkers;
  fil!: FilamentSet;
  mols!: Molecules;

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
  /** the top of the cosmos's zoom with nothing in the way (the window's own is under it: applyWindow) */
  private fullMax: number;
  /** the window was let out to everything (expand) */
  private widened = false;

  constructor(readonly kit: Kit, readonly cosmos: Cosmos, readonly realms: Realms) {
    this.fullMax = cosmos.controls.max;
    const w = realms.window;
    // the visit starts where the window does: at the edge of the observable universe unless a place in the cell was
    // asked for (or the window is the cell's)
    const inCell = (params.has('place') || w.start <= CELL_TOP) && realms.wants('cell');
    if (inCell) this.setRealm('cell', true);
    else {
      this.setRealm('cosmos', true);
      const s = params.get('s');
      cosmos.controls.set(s ? Number(s) : w.id === 'universe' ? cosmos.controls.start : w.start);
    }
    this.applyWindow();
    this.wayInit();

    const ui = $('ui');
    this.hud = new Hud(ui, this.dockPlaces(), BASE);
    // (a window narrower than everything: its name, and the one quiet way out to the whole universe)
    this.hud.setWindow(whole(w) ? null : { name: w.name, line: w.line, top: (w.top ?? Infinity) + FOV_NM, bottom: (w.bottom ?? -Infinity) + FOV_NM });
    this.hud.onWiden = () => this.expand();
    this.hud.setCell(realms.wants('cell'));
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
    this.tour = new Tour({
      fly: (id, done) => this.tourFly(id, done),
      orbit: (a) => (this.realm === 'cosmos' ? cosmos.controls : this.controls).orbit(a, 0),
      cancel: () => { this.controls?.cancelFlight(); cosmos.controls.cancelFlight(); },
    }, (s) => {
      this.hud.setCaption(s ? s.caption : '');
      this.hud.setActive('tour', !!s);
      if (s?.cut) this.cutTarget = 1;
    });
    this.fitTour();
    this.guiding = new Guiding(this, ui);
    // one film for the whole dive (cosmos/film.ts): the cell's frame laid into the cosmos's HDR — under the cosmos's own
    // as the two hand over, alone below them — and graded with it, the cell's film mixed in by its share
    cosmos.r.host = (f) => (this.mix < 1 ? mixFilm(this.cellFilm, f, 1 - this.cellShare) : f);
    this.wire();
    this.hud.setActive('cut', true);
    // browsers only start audio from a gesture — an iPhone not from a touch's start, only its end — and stop it when the
    // page is left: woken by the next gesture until it's heard
    const wake = () => {
      if (this.score.running || this.score.muted) return;
      this.score.start();
      this.hud.setActive('sound', !this.score.muted);
    };
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) addEventListener(ev, wake, { passive: true });
    if (params.has('notitle') || params.has('film')) this.hud.setChrome(false);
    else if (!this.guiding.greet(ui)) setTimeout(() => { if (!this.controls?.fly) this.hud.toast(this.realm === 'cosmos' ? 'Scroll or pinch to fall' : 'Scroll or pinch to dive in', 6000); }, 2200);
  }

  /** the cell's realm, in: its camera set where the visit starts in it, its handlers wired, its frame laid into the
   *  cosmos's */
  attachCell(cell: Cell) {
    this.cell = cell;
    ({ r: this.r, world: this.world, controls: this.controls, field: this.field, walkers: this.walkers, fil: this.fil, mols: this.mols } = cell);
    for (const p of cell.places) this.places.set(p.id, p);
    const controls = this.controls;
    const start = this.places.get(params.get('place') ?? this.realms.window.place ?? 'tissue') ?? this.places.get('tissue')!;
    controls.set(start.at, this.fit(start.scale), start.yaw, start.pitch);
    // the wedge opens toward where the visitor first looks from
    this.wedgeDir = [Math.sin(cell.wedge.yaw), 0, Math.cos(cell.wedge.yaw)];
    this.cut = start.id === 'tissue' ? 0 : 1;
    if (params.has('nocut')) this.cutTarget = this.cut = 0;
    this.setRealm(this.realm, true);
    // flying: on a touch screen the on-screen stick (and no pointer lock), with a mouse the lock
    this.flyUi = new FlyUi($('ui'), controls, matchMedia('(pointer: coarse)').matches || params.has('touch'));
    this.flyUi.onLeave = () => this.setFly(false);
    const lay = this.r.layInto(this.cosmos.r.hdr);
    this.cosmos.r.lay = () => (this.mix < 1 ? [lay] : []);
    this.wireCell();
    if (this.seamOn) this.seamCell();
    this.applyWindow();
    this.hud.setPlaces(this.dockPlaces());
    this.hud.setCell(true);
    this.fitTour();
    this.guiding.order();
  }

  // ---- The well: the second way down from the Earth (lab/: Hepatocyte's own code, src/well), through San Francisco's
  // fog to a plate of liver cells on a lab bench and on down into one cell, the cosmos's camera all the way (its
  // controls' bottom below where the cell would take over). One way down is live at a time (realms.ts way): the main
  // line's, or the well's. Taking the other goes up to the Earth seen whole first, where the view is on the Earth's
  // middle, so moving the dive's spot (the ladder's place) to the bench or back shows nothing; zooming out past the
  // Earth on the well's way puts the main line back.
  /** the well's realm once it's in (lab/lab.ts), and Hepatocyte's world in it: its store (what's in the well),
   *  pickAt(x, y) and picked() (what's under a point of the render target), describe() (what's being looked at) */
  lab: Lab | null = null;
  well: Hepatocyte | null = null;
  /** the main line's place (Seven Havens') while the bench has the ladder, and its guide down onto her */
  private havensPlace: LadderPlace | null = null;
  private havensGuide: CosmosControls['guide'] = null;

  /** the well's realm, in */
  attachWell(lab: Lab) {
    this.lab = lab;
    this.well = lab.hep;
  }
  /** take the view to the lab bench in San Francisco (from anywhere: up to the Earth first, if the main line's live) */
  toBench() { this.goToCosmos('u:bench'); }
  /** and back: up through the fog to the Earth, the main line live again (the window let out first, if it's the well's) */
  fromBench() {
    if (!whole(this.realms.window)) this.expand();
    this.wayTo('havens', () => this.goToCosmos('u:earth'));
  }
  /** the way a window opens on: the bench's place and the camera looking down at it, if it's the well's */
  private wayInit() {
    if (this.realms.way !== 'well') return;
    this.setPlace('well');
    const w = this.realms.window, s = params.get('s');
    if (w.start <= FOG_CLOSE[0]) { const l = s ? Number(s) : w.start; this.cosmos.controls.set(l, 0.5, pitchAt(l)); }
  }
  /** the dive's spot on the Earth: the bench, or the main line's */
  private setPlace(way: Way) {
    const L = this.cosmos.ladder as unknown as { place: LadderPlace; day: number; ground: { name: string }; setTime(ms: number): void };
    this.havensPlace ??= L.place;
    L.place = way === 'well' ? BENCH : this.havensPlace;
    L.ground.name = L.place.name;
    L.setTime(Date.UTC(2000, 0, 1, 12) + L.day * 86400000);
  }
  /** make a way the live one, here and now (wayTo goes where that's seen to be nothing first) */
  private setWay(way: Way) {
    if (way === this.realms.way) return;
    const cc = this.cosmos.controls;
    void this.realms.setWay(way, cc.logS);
    this.setPlace(way);
    if (way === 'havens') {
      cc.guide = this.havensGuide;
      this.lab?.leave();
      if (this.cosmos.has('earth')) { this.cosmos.earth.reach(null); this.cosmos.earth.spotGround = true; }
      if (this.cosmos.has('ground')) this.cosmos.surface.hidden = false;
    }
    this.applyWindow();
    this.hud.setPlaces(this.dockPlaces());
    this.fitTour();
  }
  /** take a way: up to the Earth seen whole if the view's below it, the way changed there, then `then` */
  private wayTo(way: Way, then: () => void) {
    const cc = this.cosmos.controls;
    const go = () => { this.setWay(way); then(); };
    if (this.realm === 'cell') { this.leaveCell(); if (this.realm === 'cell') return; }
    if (cc.logS >= WAY_TURN - 0.01) go();
    else { cc.flyTo(WAY_TURN, { done: go }); this.sound('fly'); }
  }
  /** a place on the other way: taken there that way (true), or not (false: go on as usual) */
  private wayFor(p: CosmosPlace): boolean {
    const way: Way | null = onWellWay(p.id) ? 'well' : p.logS < WAY_FORK ? 'havens' : null;
    if (!way || way === this.realms.way || !whole(this.realms.window)) return false;
    this.tour.stop();
    this.wayTo(way, () => this.goToCosmos(p.id));
    return true;
  }
  /** whether a place is in the dock: those below the fork on the live way only, but the doors to the other (the bench,
   *  Seven Havens) wherever the window has both ways */
  private placeOnWay(p: CosmosPlace) {
    const way: Way | null = onWellWay(p.id) ? 'well' : p.logS < WAY_FORK ? 'havens' : null;
    const w = this.realms.window.way;
    if (!way) return true;
    if (w) return way === w;
    return way === this.realms.way || p.id === 'u:bench' || p.id === 'u:boulder';
  }
  /** this frame, below the cosmos's levels (after their update): the gardens on the main line, the well on its own */
  private below(dt: number) {
    const cc = this.cosmos.controls, c = this.cosmos;
    if (this.realms.way === 'well' && whole(this.realms.window) && cc.logS > WAY_BACK && !cc.flying) this.setWay('havens');
    if (this.realms.way === 'havens') { this.gardens?.update(dt); return; }
    // (the main line's guide down onto her kept for it: the well's camera looks down as the well's way says, lab/lab.ts)
    if (cc.guide) { this.havensGuide = cc.guide; cc.guide = null; }
    // the Earth on this way: seen down into the fog, and without the main line's own ground round the spot on it (its
    // real ground is Seven Havens', and the spot's at the bench now); her meadow not drawn
    if (c.has('earth')) { c.earth.reach([4.3, 4.0]); c.earth.spotGround = false; }
    if (c.has('ground')) c.surface.hidden = true;
    if (this.lab && this.realms.isReady('well')) this.lab.update(dt);
  }
  private belowAfter() { this.gardens?.after(); this.lab?.after(); }
  /** where the view is on the well's way, coarsest first (null: the cosmos's own) */
  private wellCrumbs(): string[] | null {
    const l = this.cosmos.controls.logS;
    if (this.realms.way !== 'well' || l > FOG_CLOSE[0]) return null;
    const c = ['Universe', 'Milky Way', 'Orion Arm', 'Solar system', 'Earth', 'San Francisco'];
    if (l > 0.9) return [...c, 'In the fog'];
    c.push('A lab bench');
    if (l > -0.9) return c;
    c.push('A plate of liver cells');
    if (l > -1.9) return c;
    c.push('A well');
    if (l > -2.7) return c;
    c.push(this.well?.store.inside != null ? 'Inside a liver cell' : 'A field of liver cells');
    // (and what the picture is, when it's an instrument's or the model's: the well's look, labelled as simulated)
    const shown = this.well?.lookNow.label;
    if (shown) c[c.length - 1] += ` (${shown})`;
    return c;
  }

  /** the dock's places: those in the window, above the cell and in it */
  private dockPlaces(): Place[] {
    const w = this.realms.window;
    // (the keepers' world past the edge only where it's built: not on a dome)
    const up = COSMOS_PLACES.filter((p) => inWindow(w, p.logS, 0.05) && (p.logS <= 26.97 || this.realms.wants('beyond')) && this.placeOnWay(p));
    const down = [...this.places.values()].filter((p) => inWindow(w, Math.log10(this.fit(p.scale) * NM), 0.3));
    return [...up.map(asPlace), ...down];
  }
  /** the tour: its stops in the window (none if fewer than two; the cell's kept while it's still coming in) */
  private fitTour() {
    const ids = new Set(this.dockPlaces().map((p) => p.id));
    const coming = this.realms.wants('cell') && !this.cell;
    const stops = FULL_TOUR.filter((s) => ids.has(s.place) || (coming && !s.place.startsWith('u:')));
    TOUR.splice(0, TOUR.length, ...(stops.length >= 2 ? stops : []));
    this.hud.show('tour', TOUR.length >= 2);
  }

  /** the window's range on both cameras: the cosmos's zoom from the window's top to its bottom (or to the cell), the
   *  cell's from its top (the tissue's widest view, or less) to its bottom */
  private applyWindow() {
    const w = this.realms.window, cc = this.cosmos.controls;
    cc.max = Math.min(this.fullMax, w.top ?? Infinity);
    cc.bottom = this.realms.way === 'well' ? w.bottom ?? WELL_BOTTOM : w.bottom !== null && w.bottom > cc.min ? w.bottom : !this.realms.wants('cell') ? cc.min : null;
    const c = this.controls;
    if (!c) return;
    c.maxScale = w.top !== null && w.top < CELL_TOP ? Math.pow(10, w.top) / NM : 160000;
    if (!this.seamOn) c.minScale = w.bottom !== null && w.bottom < CELL_TOP ? Math.max(1.2, Math.pow(10, w.bottom) / NM) : 1.2;
  }

  /** let the window out to the whole universe: what's missing built behind it, the zoom let through as each part comes
   *  in */
  expand() {
    if (this.widened || whole(this.realms.window)) return;
    this.widened = true;
    void this.realms.expand(this.realm === 'cosmos' ? this.cosmos.controls.logS : CELL_TOP - 1);
    // (the keepers' world and the round of the loop, if the whole universe has them)
    if (this.realms.seamed && !this.seamOn) this.seamed();
    this.fullMax = this.seamOn ? SEAM.Z_END : this.fullMax;
    this.applyWindow();
    this.hud.setWindow(null);
    this.hud.setCell(true);
    this.hud.setPlaces(this.dockPlaces());
    this.fitTour();
    this.guiding.order();
    this.hud.toast('The whole universe, coming in behind you…', 4000);
  }
  /** a realm's in (main.ts's realms): the dock and the tour take in its places */
  realmIn() {
    this.applyWindow();
    this.hud.setPlaces(this.dockPlaces());
    this.fitTour();
    this.guiding.order();
  }

  /** the zoom held short of what hasn't come in: the cosmos's floor below it, its ceiling above */
  private holds() {
    const cc = this.cosmos.controls;
    const h = this.realms.holds(cc.logS);
    // (round the loop by hand, out past the keepers' sky onto the jewel: the cell has to be in)
    if (this.seamOn && !this.cell) h.ceiling = Math.min(h.ceiling ?? Infinity, SEAM.DOWN[0]);
    cc.floor = h.floor;
    cc.ceiling = h.ceiling;
  }

  /** hand the camera to the cosmos or the cell (`now`: without the crossfade) */
  setRealm(realm: 'cosmos' | 'cell', now = false) {
    if (realm !== this.realm) this.taau?.cut();
    this.realm = realm;
    if (this.controls) this.controls.enabled = realm === 'cell';
    this.cosmos.controls.enabled = realm === 'cosmos';
    if (now) this.mix = realm === 'cosmos' ? 1 : 0;
  }
  /** the zoom round the loop by hand (main boot, over the gardens): the jewel in the strand, the zoom's top past the
   *  keepers' sky to the loop film's last view, and the cell's way in down to the jewel */
  seamed() {
    this.seamOn = true;
    this.jewel = JEWEL;
    this.fullMax = SEAM.Z_END;
    this.applyWindow();
    if (this.cell) this.seamCell();
  }
  private seamCell() {
    this.controls.guide = { arrive: SEAM.S0 * 0.95, at: (s) => this.cellGuide(s) };
  }
  /** where zooming in by hand takes the cell's camera: the film's way down while diving — and back to it, a moment after
   *  a look round, however the visitor turned (`settle`: the dive always ends on the jewel) — else onto the jewel when
   *  it's near and ahead (null: the visitor's own zoom, toward what's under the cursor) */
  private cellGuide(s: number): { pivot: Vec3; yaw: number; pitch: number; exact?: boolean; settle?: boolean } | null {
    const c = this.controls, j = JEWEL;
    if (this.realm !== 'cell' || c.flying || c.fly || this.tour.active) { this.diving = false; return null; }
    // (diving, it's on the film's way already — it came in at the tissue's own place — so the pivot keeps to it exactly)
    if (this.diving) return { ...cellWay(this.places as Map<string, { at: Vec3 }>, Math.log10(s * NM)), exact: true, settle: true };
    const d = vec3.distance(c.position, j.at);
    if (d > 4 * s) return null;
    const ahead = ((j.at[0] - c.position[0]) * c.forward[0] + (j.at[1] - c.position[1]) * c.forward[1] + (j.at[2] - c.position[2]) * c.forward[2]) / Math.max(d, 1e-9);
    return ahead > 0.94 ? { pivot: j.at, yaw: c.yaw, pitch: c.pitch } : null;
  }
  /** the loop's seam by hand (src/loop.ts SEAM): out past the keepers' sky the cell's camera comes onto the jewel as far
   *  out as the cosmos's is from their world's middle, the two crossing as in the film, and the cell has it once it's
   *  more than half; in on the jewel past the film's first view the cosmos comes in round it the same way. True while
   *  it sets the crossing itself */
  private seam(dt: number): boolean {
    if (!this.cell) return false;
    const c = this.controls, cc = this.cosmos.controls, J = JEWEL, D = SEAM.DOWN;
    // (a flight to a place, the free flight or the tour is the visitor leaving the dive: without this the dive's way
    // kept its hold — the camera asks the guide only between flights — and once a flight landed the view settled
    // back onto the dive's way at that zoom, so every place's button after a dive from above led to the same spot)
    if (c.flying || c.fly || this.tour.active) this.diving = false;
    let off = vec3.distance(c.pivot, J.at);
    // (diving down to the jewel, or on it, the pivot is the dive's: a touch doesn't move it onto what's under the finger,
    // nor a pinch's drift pan it)
    c.keepPivot = this.realm === 'cell' && (this.diving || (off < c.scale * 2 && c.scale < SEAM.S0 * 4));
    // (on the jewel and zooming in, the view comes onto its middle as it goes: a pinch left it a hair to one side, and the
    // zoom went on into the glass and stopped there, never crossing)
    if (this.realm === 'cell' && off < c.scale * 2 && c.zoomingIn && !c.flying) {
      const k = 1 - Math.exp(-dt * 8);
      for (let i = 0; i < 3; i++) c.pivot[i] += (J.at[i] - c.pivot[i]) * k;
      off = vec3.distance(c.pivot, J.at);
    }
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
    // (into the jewel, out into the keepers' world: it has to be in)
    if (!this.cosmos.beyond || !this.realms.isReady('beyond')) return false;
    vec3.copy(c.pivot, J.at);
    const m = seamMix(z);
    cc.set(z, c.yaw, c.pitch);
    this.mix = m;
    if (m >= 0.5) this.setRealm('cosmos');
    return true;
  }
  /** from the skin into the tissue: the cell's camera where the cosmos's was */
  enterCell() {
    if (this.realm === 'cell' || !this.cell) return;
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
  /** whether the cosmos can take the camera from the cell: the window goes up past it, and what it draws at the skin is in */
  private canLeave() { return (this.realms.window.top ?? Infinity) > CELL_TOP && this.realms.readyAt(CELL_TOP + 0.05); }
  /** out of the tissue: the cosmos's camera where the cell's was (`tour`: the tour's own way out, which goes on) */
  leaveCell(tour = false) {
    if (this.realm === 'cosmos' || this.game) return;
    if (!this.canLeave()) {
      if ((this.realms.window.top ?? Infinity) > CELL_TOP) this.hud.toast('The rest of it is still coming in…', 2400);
      return;
    }
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
    const hud = this.hud;
    this.cosmos.controls.onBelow = () => this.enterCell();
    // (zooming in by hand over the gardens, the view comes round to the film's way down onto her: from her feet' side,
    // her face the right way up, never over the crown of her head)
    if (GARDENS) this.cosmos.controls.guide = { band: [this.cosmos.controls.min, 2.6], arrive: 0.3, at: approach };
    this.cosmos.controls.onUser = () => { if (this.tour.active) this.tour.stop(); this.guiding.onUser(); };
    hud.onCardFly = () => this.flyCloser();
    hud.onPlace = (id) => this.goTo(id);
    hud.onPlay = (id) => this.startGame(id);
    hud.onButton = (id) => this.button(id);
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (this.game) { if (k === 'escape') this.stopGame(); return; }
      if (k === 't') { if (TOUR.length) this.button('tour'); }
      else if (k === 'i') this.button('guide');
      else if ((k === ']' || k === '[') && this.guiding.guide.open) this.guiding.nudge(k === ']' ? 1 : -1);
      else if (!this.cell && 'fcmp'.includes(k)) return;
      else if (k === 'f') this.button('fly');
      else if (k === 'c') this.button('cut');
      else if (k === 'm') this.button('fluo');
      else if (k === 'h' || k === '?') this.button('help');
      else if (k === 'p') this.button('play');
      else if (k === 'escape') { this.setFly(false); this.tour.stop(); hud.showCard(null); this.guiding.instruments.close(); if (!this.guiding.instruments.open) this.guiding.guide.close(); hud.toggleHelp(false); this.intro.hide(true); this.selected = 0; }
      else if (k >= '1' && k <= '9') { const p = [...this.places.values()][Number(k) - 1]; if (p) this.goTo(p.id); }
    });
  }
  /** the cell's camera's handlers (once it's in) */
  private wireCell() {
    const c = this.controls, hud = this.hud;
    c.onAbove = () => this.leaveCell();
    c.pick = (x, y) => {
      const p = this.lastPick;
      if (!p || Math.hypot(p.x - x, p.y - y) > 30) return null;
      return p;
    };
    c.onUser = this.cosmos.controls.onUser;
    c.onClick = (_x, _y, p) => {
      if (this.game) return;
      const card = p ? this.card(p.id) : null;
      this.selected = card ? p!.id : 0;
      this.selectedPick = card ? p : null;
      // (with the guide open, a thing's card is in it: nothing the cell says lies over anything else it says)
      if (card && this.guiding.thing(card, p!.id)) hud.showCard(null);
      else if (!card && this.guiding.guide.open) this.guiding.untapped();
      else hud.showCard(card);
      if (card) this.sound('click');
    };
    c.onDoubleClick = (_x, _y, p) => {
      if (!p || this.game) return;
      this.tour.stop();
      const d = vec3.distance(p.world, c.position);
      c.flyTo(p.world, Math.max(c.minScale * 2, d / 6), { speed: 1.3 });
      this.sound('fly');
    };
    c.onFly = (on) => {
      document.body.classList.toggle('flying', on);
      hud.setActive('fly', on);
      this.flyUi?.show(on);
      if (on && this.flyUi?.touch) hud.toast('Left thumb flies · drag to look', 5000);
    };
    c.onFlySpeed = (f) => hud.toast(`Flying speed ×${f < 1 ? f.toFixed(2) : f.toFixed(1)}`, 1200);
  }

  sound(name: string, s = 1) { this.score.event(name, s); }
  /** fly the cell's camera closer to the thing last tapped */
  flyCloser() {
    const p = this.selectedPick;
    if (!p || !this.cell) return;
    this.controls.flyTo(p.world, Math.max(4, vec3.distance(p.world, this.controls.position) / 5));
  }
  /** whether a camera is on its way somewhere */
  flying() { return this.realm === 'cosmos' ? this.cosmos.controls.flying : !!this.controls?.flying; }

  /** a place's distance widened on a tall screen (the field of view is vertical), so the subject still fits across */
  fit(scale: number) { const a = this.kit.size.css[0] / Math.max(1, this.kit.size.css[1]); return a < 1 ? scale / Math.pow(a, 0.65) : scale; }

  card(id: number): Card | null { return this.cell ? this.cell.card(id) : null; }

  /** first person on or off (not in a game): everything else that wants the camera or the mouse lands first */
  setFly(on: boolean) {
    if (!this.cell || on === this.controls.fly || (on && this.game)) return;
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
    this.controls.setFly(on, !this.flyUi!.touch);
    this.sound(on ? 'fly' : 'arrive');
  }

  goTo(id: string) {
    this.tour.stop();
    if (id.startsWith('u:')) { this.goToCosmos(id); return; }
    const p = this.places.get(id);
    if (!p || !this.cell) return;
    // (from above the cell: down to the skin, then on into it)
    if (this.realm === 'cosmos') {
      this.intro.show(p);
      this.cosmos.controls.flyTo(this.cosmos.controls.min, { done: () => { this.enterCell(); if (this.realm === 'cell') this.goTo(id); } });
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
    if (!p || this.wayFor(p)) return;
    if (this.realm === 'cell') { this.leaveCell(); if (this.realm === 'cell') return; }
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
      if (this.realm === 'cell') this.controls.flyTo(this.places.get('tissue')!.at, Math.pow(10, cc.min) / NM, { speed: 0.85, done: () => { this.leaveCell(true); if (this.realm === 'cosmos') fly(); else this.tour.stop(); } });
      else fly();
      return;
    }
    const p = this.places.get(id);
    if (!p) { this.tour.stop(); return; }
    const fly = () => this.controls.flyTo(p.at, this.fit(p.scale), { yaw: p.yaw, pitch: p.pitch, speed: 0.85, done });
    if (this.realm === 'cosmos') cc.flyTo(cc.min, { done: () => { this.enterCell(); if (this.realm === 'cell') fly(); else this.tour.stop(); } });
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
    if (id === 'guide') { this.setFly(false); if (this.tour.active) this.tour.stop(); this.guiding.toggle(); return; }
    if (id === 'fly') { if (this.cell) this.setFly(!this.controls.fly); return; }
    if (id === 'tour' || id === 'play' || id === 'help') this.setFly(false);
    if (id === 'tour') { if (this.tour.active) this.tour.stop(); else if (TOUR.length) { hud.showCard(null); this.guiding.guide.close(); this.intro.hide(true); this.at = null; this.cosmosAt = null; this.tour.start(); } }
    else if (id === 'cut') { this.cutTarget = this.cutTarget > 0.5 ? 0 : 1; hud.toast(this.cutTarget ? 'Cutaway: the cell opened' : 'Cutaway closed'); }
    else if (id === 'fluo') { this.fluoTarget = this.fluoTarget > 0.5 ? 0 : 1; hud.toast(this.fluoTarget ? 'Under the microscope' : 'Back to colour'); }
    else if (id === 'help') hud.toggleHelp();
    else if (id === 'play') this.playMenu();
    else if (id === 'sound') {
      // (a first tap on it, the music not heard yet, turns it on rather than off)
      if (this.score.running) this.score.setMuted(true);
      else { this.score.setMuted(false); this.score.start(); }
      hud.setActive('sound', !this.score.muted);
    }
    hud.setActive('cut', this.cutTarget > 0.5);
    hud.setActive('fluo', this.fluoTarget > 0.5);
  }

  private playMenu() {
    const games = this.cell?.games ?? [];
    const items = games.map((g) => `<button class="play-item" data-id="${g.id}"><img alt="" src="${BASE}art/${g.art}.webp" onerror="this.style.visibility='hidden'"><span><b>${g.role}</b><em>${g.title}</em><small>${g.blurb}</small></span></button>`).join('');
    this.hud.showCard({ title: 'Become part of the cell', text: games.length ? 'Pick a role. Each is a real machine, doing its real job.' : 'Coming soon.' }, `<div class="play-list">${items}</div>`);
    for (const b of document.querySelectorAll<HTMLButtonElement>('.play-item')) b.addEventListener('click', () => this.startGame(b.dataset.id!));
  }

  startGame(id: string) {
    const g = this.cell?.games.find((x) => x.id === id);
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
  where(p: Vec3): { name: string; org: number } { return this.cell ? this.cell.where(p) : { name: 'outside', org: -1 }; }

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
    this.guiding.frame(dt);
    this.holds();
    // the cross-fade between the cosmos and the cell: each draws while it shows (at the loop's seam, by the zoom: seam())
    const cc = this.cosmos.controls;
    const seam = this.seamOn && !this.mixDriven && this.seam(dt);
    if (!this.mixDriven && !seam) {
      const want = this.realm === 'cosmos' ? 1 : 0;
      this.mix += (want - this.mix) * (1 - Math.exp(-dt * 5));
      if (Math.abs(want - this.mix) < 0.004) this.mix = want;
    }
    // (no cell, no cell's frame)
    if (!this.cell) this.mix = 1;
    // (while they cross-fade, the one going keeps to the view of the one coming — the tissue's sheet is in both, cell
    // for cell, cosmos/tissue.ts — so the two are one picture all the way through; a film sets both itself)
    const fading = this.mix > 0 && this.mix < 1;
    if (!this.mixDriven && !seam && this.cell) {
      this.controls.reach = fading && this.realm === 'cosmos' ? 4 : 1;
      if (fading && this.realm === 'cosmos') this.controls.set(this.places.get('tissue')!.at, Math.min(this.controls.maxScale * 4, cc.S / NM), cc.yaw, cc.pitch);
    }
    // (the jewel crossing with the cosmos: the cosmos's scene and the keepers' world drawn first, the cell then reads
    // them, the cosmos laid over after)
    const early = fading && !!this.jewel && !!this.cosmos.beyond && cc.logS > 26;
    if (early) {
      this.cosmos.update(dt);
      this.below(dt);
      this.kit.run(this.cosmos.r.offscreen());
    }
    // (the cell's frame, laid into the film below — cosmos/renderer.ts lay — by its share; crossing with the keepers'
    // world, much darker than it, a share that comes in later, or its light would show through theirs too soon)
    this.cellShare = this.mix >= 1 ? 0 : early ? (1 - this.mix) ** 3 : 1 - this.mix;
    // (the upscaler while the cell's frame is in the picture: the camera it reprojects by is the cell's)
    if (this.taau) this.taau.params.on = this.mix < 1 && !(window as unknown as { __taauOff?: boolean }).__taauOff;
    if (this.mix < 1) { this.r.post.set({ lay: this.cellShare }); this.cellFrame(dt); }
    if (fading && this.realm === 'cell' && !this.mixDriven && !seam) cc.follow(Math.log10(this.controls.scale * NM), this.controls.yaw, this.controls.pitch);
    if (this.mix > 0) {
      // (the gardens at the bottom of the dive drawn with it, between its views and its draw: gardens.ts)
      const t0 = performance.now();
      if (!early) this.cosmos.update(dt);
      const t1 = performance.now();
      if (!early) this.below(dt);
      const t2 = performance.now();
      if (early) this.kit.run(this.cosmos.r.finish()); else this.cosmos.r.frame();
      this.belowAfter();
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
    this.hud.update({ fov: fovW, nmPerPx: fovW / kit.size.css[0], timeScale: 1, crumbs: this.wellCrumbs() ?? (this.cosmos.beyond && cc.logS > 27.4 ? this.cosmos.crumbs() : address(cc.logS, this.cosmos.short)), hover: null, mouse: cc.mouse });
    // (still at the place flown to: about as close)
    if (this.cosmosAt && !cc.flying && Math.abs(cc.logS - this.cosmosAt.logS) > 0.8) this.cosmosAt = null;
    this.hud.setHere(this.cosmosAt?.id ?? null);
    this.intro.update(dt, cc.flying, !!this.cosmosAt);
    // (held short of something still coming in — the gardens, or what a window let out is building: said so after a
    // moment, and gone once it's in)
    if (cc.held > 0.6 && !this.waitSaid) {
      this.waitSaid = true;
      const gardens = GARDENS && cc.floor !== null && cc.floor >= 3.6 && cc.floor <= 4.5 && !this.realms.isReady('gardens');
      this.hud.toast(gardens ? 'Seven Havens is still coming in…' : 'The rest of it is still coming in…', 60000);
    } else if (this.waitSaid && !cc.held) { this.waitSaid = false; this.hud.hideToast(); }
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
    const WEDGE = this.cell!.wedge;
    const half = this.cut * WEDGE.half;
    const rotY = (v: Vec3, a: number): Vec3 => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];
    const n1 = rotY(this.wedgeDir, half - Math.PI / 2), n2 = rotY(this.wedgeDir, Math.PI / 2 - half);
    const fov = kit.camera.fovY;
    // (a pixel of the picture: the canvas's under the upscaler, which gives back its detail — so what's drawn at what detail
    // is as it is at full size)
    const pxAngle = (2 * Math.tan(fov / 2)) / (this.taau?.params.on ? kit.size.canvas[1] : kit.size.render[1]);
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
      spots: this.guiding.spot.k > 0.002 ? this.guiding.spot.code : 0, spot: this.guiding.spot.k, flags: this.shrinkWhole ? 1 : 0, shellSolid: solid * solid * (3 - 2 * solid), dof: this.dof, origin, hazeBg: hb * hb * (3 - 2 * hb),
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
    if (c.fly) this.flyUi?.update(c.speed);
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
