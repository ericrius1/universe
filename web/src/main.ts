// Universe: one continuous zoom from the edge of the observable universe to a single molecule. Above the cell the
// cosmos draws (cosmos/); from the skin down, a human cell from the outside in, one world measured in nanometres.
// Boot: the GPU, the window onto the zoom (windows.ts: ?w=, ?from=&to=, the whole universe with neither), the cosmos's
// renderer and camera, the app (app.ts); then the window's realms (realms.ts), what's in view at the start first — the
// first frame drawn as soon as those are in — and the rest behind it: the cosmos's levels, the cell (cell.ts: the world,
// its systems, its molecules), Seven Havens' gardens. Every frame the app's.
import { createKit, Capture, AutoResolution, WebGPUUnavailable, Taau as WeftTaau, type Kit } from '@ericrius1/weft';
import { Taau as Taau2 } from './engine/taau2';
// (?taau2: the prototype fix in engine/taau2 — a smooth upsample where the history can't be used)
const Taau = new URLSearchParams(location.search).has('taau2') ? (Taau2 as unknown as typeof WeftTaau) : WeftTaau;
import { trackGpuMemory, gpuMemory } from '@ericrius1/loom/ui/stats';
import { makeDebug } from './ui/debug';
import { startReport } from './ui/report';
import { Gardens, HAVENS, HAVENS_DATA, HAVENS_WORDS, prepareGardens } from './gardens';
import { FramePace } from './engine/pace';
import { origin } from './engine/origin';
import { Cosmos, moment, type CosmosRealm } from './cosmos';
import { Governor } from './ui/governor';
import { lightGpu } from './ui/gpu';
import { App, GARDENS } from './app';
import { Realms } from './realms';
import { Loop } from './loop';
import { CELL_TOP, UNIVERSE, windowOf, type RealmId } from './windows';
import type { Renderer } from './engine/renderer';
export type { App };

const $ = (id: string) => document.getElementById(id)!;
const status = (msg: string, f: number) => { $('ld-msg').textContent = msg; ($('ld-bar') as HTMLElement).style.width = `${Math.round(f * 100)}%`; };
const params = new URLSearchParams(location.search);
const BASE = import.meta.env.BASE_URL;
const frame = () => new Promise((res) => requestAnimationFrame(res));
const W = window as unknown as Record<string, unknown>;

async function boot() {
  const canvas = $('c') as HTMLCanvasElement;
  const dome = params.has('dome');
  // the window onto the zoom (a film, a dome: the whole of it)
  const win = params.has('film') || dome ? UNIVERSE : windowOf(params);
  if (win.id !== 'universe') document.title = `${win.name} · Universe`;
  // (Seven Havens' gardens, where the dive ends: their code fetched and their builders at work from now, while the rest
  // loads — gardens.ts — if the window takes them in)
  const realmsWanted = new Realms(win, { gardens: GARDENS, beyond: !dome, build: async () => {} });
  if (realmsWanted.wants('gardens')) void prepareGardens(BASE);
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

  // (?dome: the planetarium's fisheye on a square canvas, as Fiske's dome gets it; ?now the real moment, ?utc=<h> an hour)
  if (dome) Object.assign(canvas.style, { width: '100vmin', height: '100vmin', left: 'calc(50vw - 50vmin)', top: 'calc(50vh - 50vmin)', position: 'fixed' });
  const time = params.has('now') ? Date.now() : moment(Number(params.get('utc') ?? 17.5));
  // (a phone marches the volumes at the top of the zoom at half its resolution: they're soft, and the costliest there)
  const cosmos = new Cosmos(kit, {
    time, dome: dome ? { size: Number(params.get('dome') || 1024), out: 'screen' } : undefined, volumeScale: mobile || light ? 0.5 : 1,
    // (past the edge of the universe, the keepers' world: not on a dome; a phone's lighter and at a little less resolution)
    beyond: dome ? undefined : { assets: new URL('data/beyond/', document.baseURI).href, hi: !mobile && !light && !params.has('lo'), scale: mobile || light ? 0.75 : 1 },
    ...(GARDENS ? { place: HAVENS, short: HAVENS_WORDS.short, data: `${new URL(HAVENS_DATA, document.baseURI).href}`, meadow: false } : {}),
  });

  // the realms, built as the window needs them
  let app: App;
  let pipelines = 0;
  const compiled = async () => { const r = await kit.ready(); pipelines = r.pipelines; return r; };
  // (the jewel, the loop's bead of glass with the keepers' world in it: src/loop.ts — the loop film's, and the app's own
  // zoom round the same loop over the gardens; its pipelines not compiled for other films)
  const jewel = () => {
    if (!app.cell || !cosmos.beyond || app.r.jewelU) return;
    if (params.get('film') === 'loop' || (realms.seamed && !params.has('film'))) app.r.jewel(cosmos.beyond.out, !mobile);
  };
  const build = async (id: RealmId) => {
    const t0 = performance.now();
    if (id === 'cell') {
      const { buildCell } = await import('./cell');
      const cell = await buildCell(kit, canvas, { base: BASE, quality, frame, status: (m, f) => { if (!started) status(m, f); } });
      app.attachCell(cell);
      jewel();
      taau(kit, app, cosmos, cell.r, dome);
      if (!started) status('nearly there…', 0.7);
      const ready = await compiled();
      console.log(`cell: ${ready.pipelines} pipelines in ${(performance.now() - t0).toFixed(0)} ms (${ready.failed} failed)`);
    } else if (id === 'gardens') {
      // Seven Havens' gardens, where the dive ends (gardens.ts; ?nogardens the meadow outside Boulder as before, and
      // never on a dome)
      (app.gardens = new Gardens(kit, cosmos, BASE)).start();
      await new Promise<void>((r) => { const t = setInterval(() => { if (app.gardens!.ready) { clearInterval(t); r(); } }, 50); });
    } else if (id === 'well') {
      // the well of liver cells, the second way down from the Earth: its code (lab/, and Hepatocyte's own, src/well) a
      // chunk of its own; a phone's settings on a phone
      const { buildWell } = await import('./lab/lab');
      app.attachWell(buildWell(kit, cosmos, { phone: mobile }));
      const ready = await compiled();
      console.log(`well: ${ready.pipelines} pipelines in ${(performance.now() - t0).toFixed(0)} ms (${ready.failed} failed)`);
    } else {
      await cosmos.build([id as CosmosRealm]);
      if (id === 'beyond') jewel();
      await compiled();
    }
  };
  let started = false;
  const realms = new Realms(win, { gardens: GARDENS, beyond: !dome, build, onIn: () => app?.realmIn() });
  // (the ground's own data only if it's seen: under the gardens, in a window that opens below where they fill the frame,
  // it never is)
  cosmos.groundData = realms.wants('earth');
  app = new App(kit, cosmos, realms);
  if (realms.seamed && !params.has('film')) app.seamed();
  // (?scale=<x> fixes the render scale, no AutoResolution)
  if (params.has('scale')) kit.renderScale = Number(params.get('scale'));

  // what's in view at the start first; the first frame as soon as it's in
  const startAt = app.realm === 'cell' ? CELL_TOP - 1 : cosmos.controls.logS;
  const run = realms.run(startAt);
  const t0 = performance.now();
  await run.first;
  console.log(`window ${win.id}: ${realms.at(startAt).join(', ')} in by ${Math.round(performance.now())} ms (${pipelines} pipelines in ${(performance.now() - t0).toFixed(0)} ms)`);
  status('', 1);

  const capture = new Capture(kit);
  // hold the frame rate on smaller GPUs by trading resolution: by the GPU's timestamps where it has them, by the
  // frames' intervals where it hasn't (a phone's Safari; ?pace for the latter anywhere)
  let pace: FramePace | null = null;
  if (!params.has('film') && !params.has('noautores') && !params.has('scale')) {
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
  // debug mode (; or ?debug / ?stats, never in the normal interface: ui/debug.ts, the site's shared copy): frame rate and
  // time, GPU time and memory, the drawn size
  const debug = makeDebug({ kit: () => kit, canvas: () => kit.canvas as HTMLCanvasElement, gpuBytes: () => gpuMemory.bytes, corner: 'bottom-left' });
  debug.rows('universe', () => [
    ['gpu objects', `${gpuMemory.textures} tex · ${gpuMemory.buffers} buf`],
    ...[...gpuMemory.by].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => [k, `${(v / 1e6).toFixed(0)} MB`] as [string, string]),
  ]);
  // (a device's report back to the dev server, and the dive flown by itself: ui/report.ts)
  // (and on a page come through a tunnel to this machine — a phone's: its query lost on the tunnel's warning page)
  const tunnel = /ngrok/.test(location.host);
  const reporting = params.has('report') || params.has('auto') || tunnel;
  // the window's own numbers (tools/windows.mjs): when its first frame was drawn, when it was all in, what it compiled
  const stats = { window: win.id, first: 0, all: 0, pipelines: 0, realms: realms.times, gpuBytes: 0 };
  let firstSeen = false;
  const loop = () => kit.loop(({ dt }) => {
    pace?.update(kit); app.frame(dt);
    governor?.frame(kit);
    debug.tick();
    if (!firstSeen) { firstSeen = true; stats.first = Math.round(performance.now()); }
  });
  const film = params.get('film');
  if (film !== null) {
    // films step their own frames: no live loop, no visitor at the controls; they wait for everything, the gardens' night
    // sky's files and all
    kit.manual = true;
    status('nearly there…', 0.8);
    await run.all;
    loop();
    app.controls.driven = true;
    // (the journey flies both cameras, the cosmos's and the cell's: it goes first, before either)
    const name = film || 'trailer';
    const f = name === 'journey' ? new (await import('./journey')).Journey(app, capture)
      : name === 'loop' ? new Loop(app, capture)
      : new (await import('./film')).Film(app, capture, name);
    if ('direct' in f && (name === 'journey' || name === 'loop')) app.journey = (dt) => f.direct(dt);
    else app.director = (dt) => f.direct(dt);
    W.__filmObj = f;
    if (app.gardens) await new Promise<void>((r) => { const t = setInterval(() => { if (app.gardens!.ready && app.gardens!.loaded) { clearInterval(t); r(); } }, 100); });
    // (?test: stepped by hand, a frame at a time, for a look at a moment: __filmObj.seek)
    if (!params.has('test')) void f.run();
  } else loop();
  started = true;
  $('loading').classList.add('gone');
  if (reporting) startReport(kit, app, params.has('auto') || tunnel);
  // the tools' hooks (tools/shoot.mjs, tools/film.mjs, tools/windows.mjs)
  Object.assign(window, {
    app, kit,
    __frames: (n: number) => capture.frames(n),
    __grab: () => capture.grab(),
    __capture: capture,
    __perf: () => ({ gpuMs: +kit.profiler.frameMs.toFixed(2), scale: +(app.cell ? app.controls.scale : 0).toFixed(1), render: kit.size.render }),
    __window: stats,
  });
  // (the tools' __ready once everything but the gardens is in: they wait for the gardens themselves)
  const allButGardens = realms.list().filter((id) => id !== 'gardens');
  const waitAll = async () => {
    while (!allButGardens.every((id) => realms.isReady(id))) await new Promise((r) => setTimeout(r, 50));
    W.__ready = true;
    await run.all;
    stats.all = Math.round(performance.now());
    stats.pipelines = pipelines;
    stats.gpuBytes = gpuMemory.bytes;
    W.__allIn = true;
  };
  await waitAll();
}

/** (?taau: temporal anti-aliasing with upscaling over the film's HDR, before its bloom — the cell's frames alone are
 *  jittered and reprojected: kit.camera is the cell's; the cosmos's levels march their own rays. Made with the cell) */
function taau(kit: Kit, app: App, cosmos: Cosmos, r: Renderer, dome: boolean) {
  if ((params.has('taau') || params.has('taau2')) && !dome && !params.has('film')) {
    const t = app.taau = new Taau(kit, cosmos.r.hdr, r.depth);
    if (params.has('taaudebug')) t.params.debug = true;
    // (the floating origin moves each frame to the focus: last frame's view-projection taken over to this frame's
    // origin — prevVP · T(origin now − origin then) — or the history would be reprojected by the origin's step)
    const last: [number, number, number] = [origin[0], origin[1], origin[2]];
    const shift = kit.action(() => {
      const dx = origin[0] - last[0], dy = origin[1] - last[1], dz = origin[2] - last[2];
      last[0] = origin[0]; last[1] = origin[1]; last[2] = origin[2];
      const P = (t as unknown as { prevVP: Float32Array }).prevVP;
      if ((!dx && !dy && !dz) || (window as unknown as { __noShift?: boolean }).__noShift) return;
      for (let r = 0; r < 4; r++) P[12 + r] += P[r] * dx + P[4 + r] * dy + P[8 + r] * dz;
    }, 'taau.origin');
    cosmos.r.useTaau(t, [shift]);
  }
}

addEventListener('error', (e) => { if (!W.__ready) W.__failed = String(e.error?.stack ?? e.message); });
boot().catch((e) => {
  console.error(e);
  const msg = e instanceof WebGPUUnavailable ? `${e.message} Try a recent Chrome, Edge or Safari.` : `Something went wrong: ${(e as Error).message}`;
  $('ld-msg').textContent = msg;
  W.__failed = String(e);
});
