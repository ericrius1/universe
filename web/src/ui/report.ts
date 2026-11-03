// A device's own account of how the page runs, sent back to the dev server (?report: vite.config.ts reportSink, into
// logs/report.jsonl), for testing on a phone the tools can't drive: once at boot what it is (its browser, its screen,
// its GPU's limits, the profile picked), then each second the frame rate, the frames' spread and the stalls (frames
// over 50 ms, with where the zoom was), the render scale, the GPU memory held (and its biggest holders every few
// seconds), where the dive is and whether the gardens are in, and any errors. A page that dies (a phone's tab killed
// for its memory) just stops reporting; the reload starts a new session. ?auto flies the dive by itself, round and
// round: down from the top to the gardens, her face, her eye, and back up to the Earth.
import type { Kit } from '@ericrius1/weft';
import type { App } from '../main';
import { gpuMemory } from './stats';

const MB = (b: number) => Math.round(b / 1e5) / 10;

export function startReport(kit: Kit, app: App, auto: boolean) {
  const session = Math.random().toString(36).slice(2, 8);
  const t0 = performance.now();
  const send = (kind: string, data: Record<string, unknown>) => {
    void fetch(`${import.meta.env.BASE_URL}__report`, {
      method: 'POST', keepalive: true,
      body: JSON.stringify({ session, kind, t: Math.round(performance.now() - t0), ...data }),
    }).catch(() => {});
  };
  const errors: string[] = [];
  for (const k of ['error', 'warn'] as const) {
    const was = console[k].bind(console);
    console[k] = (...a: unknown[]) => { errors.push(`${k}: ${a.map(String).join(' ').slice(0, 300)}`); was(...a); };
  }
  addEventListener('error', (e) => errors.push(`pageerror: ${e.message}`));
  addEventListener('unhandledrejection', (e) => errors.push(`rejection: ${String(e.reason).slice(0, 300)}`));
  const was = console.log.bind(console);
  console.log = (...a: unknown[]) => { const s = a.map(String).join(' '); if (/gardens|profile/.test(s)) errors.push(`log: ${s.slice(0, 200)}`); was(...a); };

  const lim = kit.device.limits;
  send('boot', {
    ua: navigator.userAgent, screen: [screen.width, screen.height], dpr: devicePixelRatio, css: kit.size.css, render: kit.size.render,
    limits: { maxBufferSize: lim.maxBufferSize, maxStorage: lim.maxStorageBufferBindingSize, maxTex2D: lim.maxTextureDimension2D },
    timestamps: kit.profiler.available, auto,
  });

  // the frames: their intervals this second, and the stalls
  let iv: number[] = [], last = performance.now(), n = 0;
  const stalls: string[] = [];
  const tick = (t: number) => {
    const d = t - last; last = t; iv.push(d);
    if (d > 50) stalls.push(`${Math.round(d)}ms@${app.cosmos.controls.logS.toFixed(1)}`);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setInterval(() => {
    const s = iv.slice().sort((a, b) => a - b), q = (p: number) => s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
    const g = app.gardens;
    send('second', {
      fps: iv.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: Math.round(q(1)), stalls: stalls.splice(0),
      scale: +kit.renderScale.toFixed(2), render: kit.size.render, vramMB: MB(gpuMemory.bytes), logS: +app.cosmos.controls.logS.toFixed(2),
      realm: app.realm, gardens: g ? (g.ready ? +g.weight.toFixed(2) : 'building') : 'off', errors: errors.splice(0),
      ...(++n % 5 === 0 ? { top: [...gpuMemory.by].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k} ${MB(v)}`) } : {}),
    });
    iv = [];
  }, 1000);
  addEventListener('pagehide', () => send('gone', {}));

  if (auto) void dive(app, (s) => send('leg', { leg: s }));
}

/** at the gardens from above, what each part costs: the frame (the GPU's time where it can time itself, and the
 *  frames' intervals) with each switched off in turn, the resolution held still meanwhile */
async function experiment(app: App) {
  const kit = (window as unknown as { kit: Kit }).kit, h = app.gardens?.haven;
  if (!h) return {};
  const auto = kit.autoRes, scale = kit.renderScale;
  kit.autoRes = null;
  kit.profiler.force = true;
  const measure = async () => {
    await new Promise((r) => setTimeout(r, 700));
    const t0 = performance.now(), s0 = kit.profiler.serial;
    let gpu = 0, n = 0, last = s0, frames = 0;
    await new Promise<void>((r) => { const f = () => { frames++; if (kit.profiler.serial !== last) { last = kit.profiler.serial; gpu += kit.profiler.lastFrameMs; n++; } if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); });
    return `${(gpu / Math.max(1, n)).toFixed(1)}ms/${Math.round(frames / 2)}fps`;
  };
  const parts = (h.arch as unknown as { drawnParts: { name: string; hidden: boolean }[] }).drawnParts;
  const env = h.env, aur = { ...env.aurora.settings };
  const tries: [string, () => void, () => void][] = [
    ['city', () => parts.filter((p) => p.name === 'city').forEach((p) => { p.hidden = true; }), () => parts.forEach((p) => { p.hidden = false; })],
    ['haven', () => parts.filter((p) => p.name === 'haven').forEach((p) => { p.hidden = true; }), () => parts.forEach((p) => { p.hidden = false; })],
    ['shadows', () => { env.shadows.count = 0; }, () => { env.shadows.count = 3; }],
    ['clouds', () => { env.clouds.settings.enabled = false; }, () => { env.clouds.settings.enabled = true; }],
    ['flora', () => { if (h.flora) h.flora.settings.quality = 0.001; }, () => { if (h.flora) h.flora.settings.quality = 0.5; }],
    ['aurora', () => { env.sky.preset({ ...aur, intensity: 0, day: 0 }); }, () => { env.sky.preset(aur); }],
    ['half res', () => { kit.renderScale = scale * 0.6; }, () => { kit.renderScale = scale; }],
  ];
  const out: Record<string, string> = { scale: scale.toFixed(2), base: await measure() };
  for (const [k, off, on] of tries) { off(); out[k] = await measure(); on(); }
  out.again = await measure();
  kit.autoRes = auto;
  return out;
}

/** the dive by itself: down to the gardens once they're in, her face, her eye; back up; again */
async function dive(app: App, say: (s: string) => void) {
  const c = app.cosmos.controls;
  const fly = (logS: number, pitch: number, duration?: number) => new Promise<void>((r) => c.flyTo(logS, { pitch, duration, done: r }));
  const hold = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
  while (!app.gardens?.ready) await hold(0.5);
  for (let round = 1; ; round++) {
    say(`round ${round}: down`);
    await fly(7.3, -0.15); await hold(2);
    await fly(3.5, -0.42); say('gardens 3 km'); await hold(4);
    if (round === 2 || round === 4) say(JSON.stringify(await experiment(app)));
    await fly(1.4, -0.6); say('temple 25 m'); await hold(4);
    await fly(0.35, -0.95); say('her 2 m'); await hold(5);
    await fly(-1.75, -1.1); say('her eye'); await hold(3);
    say('up');
    await fly(3.5, -0.42); await hold(2);
    await fly(7.3, -0.15, 6); await hold(2);
  }
}
