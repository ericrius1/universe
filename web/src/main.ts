// Cell: a human cell from the outside in, eight orders of magnitude, in one continuous world measured in nanometres.
// Boot: the GPU, the world (layout.ts), its systems (organelles, filaments, molecules, walkers), the camera, the
// interface; then every frame the globals (scale, cut, haze), the molecular field, the run, and a read of what's under
// the cursor.
import { createKit, Capture, AutoResolution, WebGPUUnavailable, type Kit } from '@ericrius1/weft';
import { vec3, type Vec3 } from 'math';
import { buildWorld, sdOrganelle, Kind, WEDGE, type World } from './world/layout';
import { packOrganelles, Organelles } from './world/organelles';
import { Filaments, type FilamentSet } from './world/filaments';
import { Molecules } from './world/molecules';
import { Field } from './world/field';
import { Walkers } from './world/walkers';
import { Renderer } from './engine/renderer';
import { Controls, type Pick } from './engine/camera';
import { Hud } from './ui/hud';
import { controls as interfaceToggle } from './ui/controls';
import { buildPlaces, type Place } from './ui/places';
import { cardFor, type Card } from './ui/info';
import { Tour } from './ui/tour';
import { Intro } from './ui/intro';
import { FlyUi } from './ui/fly';
import { GAMES, type Game, type GameCtx } from './play/game';
import './play/index';
import { Score } from './audio/score';
import { Film } from './film';

const $ = (id: string) => document.getElementById(id)!;
const status = (msg: string, f: number) => { $('ld-msg').textContent = msg; ($('ld-bar') as HTMLElement).style.width = `${Math.round(f * 100)}%`; };
const params = new URLSearchParams(location.search);
const BASE = import.meta.env.BASE_URL;
const frame = () => new Promise((res) => requestAnimationFrame(res));

async function boot() {
  const canvas = $('c') as HTMLCanvasElement;
  status('waking the GPU…', 0.05);
  const mobile = /iPhone|iPad|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 900);
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
  status('compiling shaders…', 0.7);
  const t0 = performance.now();
  const ready = await kit.ready();
  console.log(`cell: ${ready.pipelines} pipelines in ${(performance.now() - t0).toFixed(0)} ms (${ready.failed} failed)`);
  status('', 1);

  const app = new App(kit, r, world, controls, field, walkers, filaments.set, mols);
  const capture = new Capture(kit);
  // hold the frame rate on smaller GPUs by trading resolution (GPU timestamps; inactive where there are none)
  if (!params.has('film') && !params.has('noautores')) kit.autoRes = new AutoResolution(mobile ? 24 : 13, { min: 0.5, max: mobile ? 0.8 : 1 });
  kit.loop(({ dt }) => app.frame(dt));
  if (params.has('film')) {
    // films step their own frames: no live loop, no visitor at the controls
    kit.manual = true;
    controls.driven = true;
    const film = new Film(app, capture, params.get('film') || 'trailer');
    app.director = (dt) => film.direct(dt);
    $('loading').classList.add('gone');
    void film.run();
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
  outside: [[0.0012, 0.0026, 0.007], [0.0006, 0.0012, 0.0035]],
  cytosol: [[0.006, 0.016, 0.026], [0.0025, 0.007, 0.012]],
  nucleus: [[0.008, 0.007, 0.03], [0.004, 0.0035, 0.015]],
  mito: [[0.016, 0.006, 0.006], [0.007, 0.0025, 0.003]],
  er: [[0.005, 0.02, 0.02], [0.002, 0.009, 0.009]],
  golgi: [[0.025, 0.018, 0.005], [0.01, 0.007, 0.002]],
};
const CRUMB: Record<string, string> = { nucleus: 'Nucleus', mito: 'Mitochondrion', er: 'Endoplasmic reticulum', golgi: 'Golgi' };

export class App {
  cut = 0;
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
  private lastHoverTitle = '';
  private haze: Haze = [[...HAZE.outside[0]] as Vec3, [...HAZE.outside[1]] as Vec3];
  private probing = false;
  private lastPick: (Pick & { x: number; y: number }) | null = null;
  private wedgeDir: Vec3;
  private selectedPick: Pick | null = null;
  private gamePanel: HTMLElement;
  /** the place last flown to, while the view is still there */
  private at: Place | null = null;

  constructor(readonly kit: Kit, readonly r: Renderer, readonly world: World, readonly controls: Controls, readonly field: Field,
    readonly walkers: Walkers, readonly fil: FilamentSet, readonly mols: Molecules) {
    const placeList = buildPlaces(world);
    this.places = new Map(placeList.map((p) => [p.id, p]));
    const start = this.places.get(params.get('place') ?? 'tissue') ?? this.places.get('tissue')!;
    controls.set(start.at, this.fit(start.scale), start.yaw, start.pitch);
    // the wedge opens toward where the visitor first looks from
    this.wedgeDir = [Math.sin(WEDGE.yaw), 0, Math.cos(WEDGE.yaw)];
    this.cut = start.id === 'tissue' ? 0 : 1;
    if (params.has('nocut')) this.cutTarget = this.cut = 0;

    const ui = $('ui');
    this.hud = new Hud(ui, placeList, BASE);
    // the interface's toggle, top right (and / anywhere), as in every project on the site: it shows unless folded away
    interfaceToggle({ name: 'cell', label: 'the interface', phone: true, onChange: (open) => document.body.classList.toggle('ui-off', !open) });
    this.gamePanel = document.createElement('div');
    this.gamePanel.className = 'gamepanel';
    ui.append(this.gamePanel);
    this.intro = new Intro(ui);
    // flying: on a touch screen the on-screen stick (and no pointer lock), with a mouse the lock
    this.flyUi = new FlyUi(ui, controls, matchMedia('(pointer: coarse)').matches || params.has('touch'));
    this.tour = new Tour(controls, this.places, (s) => {
      this.hud.setCaption(s ? s.caption : '');
      this.hud.setActive('tour', !!s);
      if (s?.cut) this.cutTarget = 1;
    }, (s) => this.fit(s));
    this.wire();
    this.hud.setActive('cut', true);
    // browsers only start audio from a gesture
    const wake = () => { this.score.start(); this.hud.setActive('sound', !this.score.muted); };
    addEventListener('pointerdown', wake, { once: true });
    addEventListener('keydown', wake, { once: true });
    if (params.has('notitle') || params.has('film')) this.hud.setChrome(false);
    else setTimeout(() => { if (!controls.fly) this.hud.toast('Scroll or pinch to dive in — all the way down to the molecules', 6000); }, 2200);
  }

  private wire() {
    const c = this.controls, hud = this.hud;
    c.pick = (x, y) => {
      const p = this.lastPick;
      if (!p || Math.hypot(p.x - x, p.y - y) > 30) return null;
      return p;
    };
    c.onUser = () => { if (this.tour.active) this.tour.stop(); };
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
    this.intro.onAct = (a) => {
      if (a.startsWith('play:')) this.startGame(a.slice(5));
      else if (a.startsWith('place:')) this.goTo(a.slice(6));
      else this.button(a);
    };
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
    const p = this.places.get(id);
    if (!p) return;
    this.setFly(false);
    this.tour.stop();
    this.hud.showCard(null);
    if (id === 'cell') this.cutTarget = 1;
    this.controls.flyTo(p.at, this.fit(p.scale), { yaw: p.yaw, pitch: p.pitch, done: () => this.sound('arrive') });
    this.hud.setCaption('');
    this.at = p;
    this.intro.show(p);
    this.sound('fly');
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
    if (id === 'tour') { if (this.tour.active) this.tour.stop(); else { hud.showCard(null); this.intro.hide(true); this.at = null; this.tour.start(); } }
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
    const c = this.controls, kit = this.kit;
    this.tour.update(dt);
    this.director?.(dt);
    if (this.game) this.game.update(dt);
    c.update(dt, kit.camera);
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
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) this.haze[i][j] += (want[i][j] - this.haze[i][j]) * k;

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
    const solid = Math.min(1, Math.max(0, (900 - S) / 600));
    this.r.globals.set({
      focus: c.pivot, scale: S, keyDir: key, level: Math.log2(Math.max(S, 1) / 30),
      cutCenter: WEDGE.center, cut: this.cut > 0.01 ? this.cut : 0, cutN1: n1, cutN2: n2, cutRadius: WEDGE.radius,
      bioTime: this.bioTime, timeScale: this.timeScale, fluo: this.fluo,
      fogColor: this.haze[0].map((x) => x * (1 - this.fluo)) as Vec3, bgColor: this.haze[1].map((x) => x * (1 - this.fluo)) as Vec3,
      fogDist: S * fogK, exposure: 0.85, clearRadius: S * 0.42, pxAngle,
      organelleCount: this.world.organelles.length, hover: this.hover, selected: this.selected, highlight: 1,
      quality: 1, flags: 0, shellSolid: solid * solid * (3 - 2 * solid), dof: this.dof,
    });
    // the molecular field: the motors walking (games add their own actors first), then generation round the focus
    if (!this.game) this.field.actorCount = 0;
    this.walkers.update(this.bioTime, c.pivot, S);
    this.field.update(c.pivot, eye, S, pxAngle);
    this.r.frame();
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

  /** read depth and id under the cursor (a frame or two late) */
  private probe() {
    if (this.probing) return;
    const kit = this.kit, [mx, my] = this.controls.mouse;
    const rect = kit.canvas.getBoundingClientRect();
    const px = ((mx - rect.left) / rect.width) * kit.size.render[0], py = ((my - rect.top) / rect.height) * kit.size.render[1];
    const inv = kit.camera.invViewProj.slice();
    this.probing = true;
    Promise.all([this.r.depth.readTexel(px, py), this.r.ids.readTexel(px, py)]).then(([d, id]) => {
      this.probing = false;
      if (!d || !id) return;
      const z = new Float32Array(d)[0], ident = new Uint32Array(id)[0];
      this.hover = ident;
      if (z <= 0) { this.lastPick = null; return; }
      const x = (px / kit.size.render[0]) * 2 - 1, y = 1 - (py / kit.size.render[1]) * 2;
      const w = inv[3] * x + inv[7] * y + inv[11] * z + inv[15];
      const world: Vec3 = [(inv[0] * x + inv[4] * y + inv[8] * z + inv[12]) / w, (inv[1] * x + inv[5] * y + inv[9] * z + inv[13]) / w, (inv[2] * x + inv[6] * y + inv[10] * z + inv[14]) / w];
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
