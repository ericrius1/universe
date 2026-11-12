// What each window onto the zoom costs to open (src/windows.ts): for every preset, a cold load in the kept GPU Chrome
// (CDP=<port>, tools/keepchrome.mjs) in a fresh incognito context, so nothing is cached, against a built page (PORT or
// ORIGIN). Every request goes through a counting proxy here, the workers' too: the bytes of script and of data fetched
// (and which of the heavy things came: the molecules, the gardens' chunk and their files, the Earth's ground, the
// keepers' pictures, her mesh), the time to the first frame and to everything in, the pipelines compiled and the GPU
// memory held once it's all in. Then whether the zoom keeps to the window, and whether letting it out (app.expand())
// reaches the whole zoom: up to the top of everything and down into the cell.
//
// One GPU job at a time: it takes the same lock as tools/bench.mjs and waits for whoever has it.
//
//   node tools/windows.mjs [ids…]
//     env  CDP, PORT or ORIGIN · W=1710 H=1000 DPR=2 · EXPAND=0 to skip letting each out · OUT=dir a picture of each
//          window's first view, and windows.json · UI=1 with the interface (and a screenshot of it)
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const origin = process.env.ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? '5751'}`;
const W = Number(process.env.W ?? 1710), H = Number(process.env.H ?? 1000), DPR = Number(process.env.DPR ?? 2);
const IDS = process.argv.slice(2).length ? process.argv.slice(2) : ['universe', 'cosmos', 'solar', 'earth', 'havens', 'cell'];
const EXPAND = process.env.EXPAND !== '0';
const OUT = process.env.OUT ?? null;
if (OUT) mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- the lock (tools/bench.mjs's)
const LOCK = join(tmpdir(), 'universe-gpu.lock');
async function lock() {
  for (let waited = 0; ; waited += 2) {
    try { mkdirSync(LOCK); return; } catch {
      try { if (Date.now() - statSync(LOCK).mtimeMs > 25 * 60e3) { rmSync(LOCK, { recursive: true, force: true }); continue; } } catch { continue; }
      if (waited % 30 === 0) console.error(`windows: waiting for the GPU (${LOCK})…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
const unlock = () => { try { rmSync(LOCK, { recursive: true, force: true }); } catch { /* gone */ } };
process.on('SIGINT', () => { unlock(); process.exit(130); });
process.on('SIGTERM', () => { unlock(); process.exit(143); });

// ---------------------------------------------------------------- the counting proxy
let log = [];
const up = new URL(origin);
const proxy = http.createServer((req, res) => {
  const r = http.request({ host: up.hostname, port: up.port, path: req.url, method: req.method, headers: { ...req.headers, host: up.host } }, (u) => {
    res.writeHead(u.statusCode ?? 502, u.headers);
    let n = 0;
    u.on('data', (c) => { n += c.length; res.write(c); });
    u.on('end', () => { res.end(); log.push({ path: decodeURIComponent(req.url.split('?')[0]), type: String(u.headers['content-type'] ?? ''), bytes: n }); });
  });
  r.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(r);
});
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
const via = `http://127.0.0.1:${proxy.address().port}`;

/** what a request was: script (the app's chunks and workers), the page (its HTML and style), or data (everything else) */
const kind = (e) => /\.m?js$/.test(e.path) || /javascript/.test(e.type) ? 'script' : /\.html?$|\/$|\.css$/.test(e.path) || /text\/(html|css)/.test(e.type) ? 'page' : 'data';
/** the heavy things a window might fetch, by where they live */
const HEAVY = [
  ['molecules', (p) => p.includes('/data/mol/')],
  ['gardens chunk', (p) => /\/assets\/embed-/.test(p)],
  ['gardens files', (p) => p.includes('/havens/')],
  ['ground', (p) => p.includes('/data/earth')],
  ['keepers', (p) => p.includes('/data/beyond/')],
  ['her', (p) => p.includes('/data/figure/')],
  ['cell code', (p) => /\/assets\/cell-/.test(p)],
];
const MB = (b) => (b / 1e6).toFixed(2);

await lock();
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${process.env.CDP ?? 9740}`, defaultViewport: null, protocolTimeout: 0 });
const rows = [];
try {
  for (const id of IDS) {
    log = [];
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    try {
      await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
      // (when the page says it's ready, and when it's all in: a page from before windows has no __window, and its first
      // frame is drawn as it says it's ready)
      await page.evaluateOnNewDocument(() => {
        const at = {};
        for (const k of ['__ready', '__allIn']) {
          let v;
          Object.defineProperty(window, k, { configurable: true, get: () => v, set: (x) => { v = x; at[k] ??= Math.round(performance.now()); } });
        }
        window.__at = at;
      });
      const q = id === 'universe' ? '' : `w=${id}&`;
      await page.goto(`${via}/?${q}${process.env.UI ? '' : 'notitle&'}gov=off`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => window.__allIn === true || window.__failed || (window.__ready && !window.__window && (!window.app.gardens || window.app.gardens.ready)), { timeout: 300000, polling: 100 });
      const dead = await page.evaluate(() => window.__failed ?? null);
      if (dead) throw new Error(`the page failed: ${dead}`);
      // (a few frames on, for the GPU memory as it's held)
      await page.evaluate(() => window.__frames(10));
      const st = await page.evaluate(async () => {
        const old = !window.__window;
        // (a page from before windows: everything in when the gardens are, its first frame when it said it was ready)
        const s = window.__window ?? { first: window.__at.__ready, all: Math.round(performance.now()), gpuBytes: null };
        return { ...s, old, pipelinesNow: (await window.kit.ready()).pipelines };
      });
      if (OUT) {
        const url = await page.evaluate(() => window.__capture.blob('image/jpeg', 0.85).then((b) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); })));
        writeFileSync(join(OUT, `${id}.jpg`), Buffer.from(String(url).split(',')[1], 'base64'));
        // (UI=1: the page as it's seen, its interface over it)
        if (process.env.UI) await page.screenshot({ path: join(OUT, `${id}-ui.png`) });
      }
      const fetched = { script: 0, data: 0, page: 0 };
      for (const e of log) fetched[kind(e)] += e.bytes;
      const heavy = HEAVY.filter(([, f]) => log.some((e) => f(e.path))).map(([n]) => n);
      // whether the zoom keeps to the window: as far out and as far in as it goes
      const range = await page.evaluate(async () => {
        const { app } = window, cc = app.cosmos.controls;
        const frames = (n) => window.__frames(n);
        const out = { top: null, bottom: null, realm: app.realm };
        if (app.realm === 'cosmos') {
          cc.zoom(60); await frames(150); out.top = +cc.logS.toFixed(2);
          cc.zoom(-90); await frames(200); out.bottom = app.realm === 'cell' ? 'cell' : +cc.logS.toFixed(2);
        } else {
          const c = app.controls;
          for (let i = 0; i < 40; i++) { c.zoomAt(innerWidth / 2, innerHeight / 2, 1); await frames(4); }
          out.top = app.realm === 'cosmos' ? +cc.logS.toFixed(2) : +Math.log10(c.scale * 1e-9).toFixed(2);
        }
        return out;
      });
      // (and what going the whole way through the window fetched beyond what opening it did)
      const roamed = HEAVY.filter(([n, f]) => !heavy.includes(n) && log.some((e) => f(e.path))).map(([n]) => n);
      let expand = null;
      if (EXPAND && id !== 'universe') {
        expand = await page.evaluate(async () => {
          const { app } = window, t0 = performance.now();
          app.expand();
          const all = () => app.realms.list().every((r) => app.realms.isReady(r));
          while (!all()) await window.__frames(5);
          const ms = Math.round(performance.now() - t0);
          const cc = app.cosmos.controls;
          // (out of the cell first, if it opened there)
          if (app.realm === 'cell') { app.leaveCell(); await window.__frames(30); }
          cc.zoom(80); await window.__frames(240);
          const top = +cc.logS.toFixed(2), realmUp = app.realm;
          // (and down: to the skin, and on in)
          if (app.realm === 'cosmos') { cc.set(cc.min + 0.02); cc.zoom(-1); await window.__frames(40); }
          return { ms, top: realmUp === 'cell' ? 'jewel' : top, cell: app.realm === 'cell', realms: app.realms.list().length };
        });
      }
      rows.push({ id, ...fetched, heavy, roamed, first: st.first, all: st.all, pipelines: st.pipelinesNow, gpu: st.gpuBytes, range, expand, errors: errors.slice(0, 3) });
      console.error(`${id}: done`);
    } catch (e) {
      rows.push({ id, failed: String(e.message).split('\n')[0], errors });
    } finally {
      await page.close().catch(() => {});
      await ctx.close().catch(() => {});
    }
  }
} finally {
  await browser.disconnect();
  unlock();
  proxy.close();
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('window', 9)} ${pad('script MB', 10)}${pad('data MB', 9)}${pad('first ms', 9)}${pad('all ms', 8)}${pad('pipes', 6)}${pad('GPU MB', 8)}${pad('range', 18)}${pad('expand', 22)}fetched`);
for (const r of rows) {
  if (r.failed) { console.log(`${pad(r.id, 9)} FAILED: ${r.failed} ${r.errors?.join(' | ') ?? ''}`); continue; }
  const range = `${r.range.top ?? '…'} → ${r.range.bottom ?? '…'}`;
  const ex = r.expand ? `${r.expand.ms}ms ↑${r.expand.top}${r.expand.cell ? ' ↓cell' : ' NO CELL'}` : '';
  console.log(`${pad(r.id, 9)} ${pad(MB(r.script), 10)}${pad(MB(r.data), 9)}${pad(r.first, 9)}${pad(r.all, 8)}${pad(r.pipelines, 6)}${pad(r.gpu == null ? 'n/a' : MB(r.gpu).replace(/\.\d+$/, ''), 8)}${pad(range, 18)}${pad(ex, 22)}${r.heavy.join(', ') || '-'}${r.roamed.length ? ` (+ going through: ${r.roamed.join(', ')})` : ''}${r.errors.length ? `  ERRORS: ${r.errors.join(' | ')}` : ''}`);
}
if (OUT) writeFileSync(join(OUT, 'windows.json'), JSON.stringify({ when: new Date().toISOString(), size: `${W}x${H}@${DPR}`, rows }, null, 1) + '\n');
process.exit(rows.some((r) => r.failed || r.errors?.length) ? 1 : 0);
