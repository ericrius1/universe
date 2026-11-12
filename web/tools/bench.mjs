// What every place in the zoom costs on this machine, and what owns each frame: for each place above the cell and in
// it, the GPU's time for a frame (weft's timestamps, the lower quartile of 36 frames after 30 to settle) at a held
// render scale, from the kept GPU Chrome (CDP=<port>, tools/keepchrome.mjs) against a built page (PORT or ORIGIN).
// Per-pass timestamps mean little on a tile GPU (every pass reads about the frame's total), so a part's cost is the
// frame with it and the frame without: PARTS=1 leaves out each level above the cell in turn, and in the cell the
// see-through membranes, the occlusion, the depth of field and the crowd.
//
// One GPU job at a time: two pages timing at once time each other. The run takes a lock (a directory under the
// system's temporary folder) and waits for whoever has it.
//
//   node tools/bench.mjs [query] [width] [height] [dpr]
//     env  CDP, PORT or ORIGIN · PHONE=1 a phone's user agent and settings · SCALES=1,0.5 the render scales timed
//          PARTS=1 each part left out in turn · ONLY=web,cell:dna some places · OUT=file.json the numbers kept
//          BASE=file.json compared with a kept run: a place more than 15% and 3 ms slower fails the run (exit 1)
import puppeteer from 'puppeteer-core';
import { mkdirSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [query = '', w = '1710', h = '1000', dpr = '2'] = process.argv.slice(2);
const origin = process.env.ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? '5751'}`;
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const phone = !!process.env.PHONE;
const scales = (process.env.SCALES ?? '1').split(',').map(Number);
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;

// ---------------------------------------------------------------- the lock
const LOCK = join(tmpdir(), 'universe-gpu.lock');
async function lock() {
  for (let waited = 0; ; waited += 2) {
    try { mkdirSync(LOCK); return; } catch {
      // (a run that died holding it: twenty-five minutes is longer than any run)
      try { if (Date.now() - statSync(LOCK).mtimeMs > 25 * 60e3) { rmSync(LOCK, { recursive: true, force: true }); continue; } } catch { continue; }
      if (waited % 30 === 0) console.error(`bench: waiting for the GPU (${LOCK})…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
const unlock = () => { try { rmSync(LOCK, { recursive: true, force: true }); } catch { /* gone */ } };
process.on('SIGINT', () => { unlock(); process.exit(130); });
process.on('SIGTERM', () => { unlock(); process.exit(143); });

await lock();
let failed = false;
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${process.env.CDP ?? 9740}`, defaultViewport: null, protocolTimeout: 0 });
const tag = `about:blank#bench-${process.pid}-${Date.now()}`;
const s = await browser.target().createCDPSession();
await s.send('Target.createTarget', { url: tag, newWindow: true, width: Number(w), height: Number(h) });
const page = await (await browser.waitForTarget((t) => t.url() === tag, { timeout: 15000 })).page();
try {
  if (phone) await page.setUserAgent(IPHONE);
  await page.setViewport({ width: Number(w), height: Number(h), deviceScaleFactor: Number(dpr), isMobile: phone, hasTouch: phone });
  page.on('console', (m) => { if (m.type() === 'error') console.error(`[error] ${m.text()}`); });
  await page.goto(`${origin}/?noautores&notitle&gov=off&${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__ready === true || window.__failed, { timeout: 180000, polling: 250 });
  const dead = await page.evaluate(() => window.__failed ?? null);
  if (dead) throw new Error(`the page failed: ${dead}`);
  // (the gardens in before anything's timed: their compiles would be in the first places' frames)
  await page.waitForFunction(() => !window.app.gardens || window.app.gardens.ready, { timeout: 240000, polling: 500 });
  const rows = await page.evaluate(async (scales, parts, only) => {
    const { app, kit } = window;
    kit.profiler.force = true;
    const frames = (n) => new Promise((res) => { let i = 0; const f = () => (++i >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const measure = async () => {
      await frames(30);
      const start = kit.profiler.serial, t = [];
      while (kit.profiler.serial < start + 36) {
        await frames(1);
        if (t.length < kit.profiler.serial - start) t.push(kit.profiler.lastFrameMs);
      }
      t.sort((a, b) => a - b);
      return +t[t.length >> 2].toFixed(1);
    };
    const base0 = kit.renderScale;
    const out = [];
    const timed = async (name, without) => {
      const r = { name, render: kit.size.render.join('×'), ms: {}, parts: {} };
      for (const sc of scales) { kit.renderScale = base0 * sc; r.ms[sc] = await measure(); }
      kit.renderScale = base0 * scales[0];
      r.render = kit.size.render.join('×');
      if (parts) for (const [part, off, on] of without()) { off(); r.parts[part] = +(r.ms[scales[0]] - await measure()).toFixed(1); on(); }
      kit.renderScale = base0;
      out.push(r);
    };
    const cc = app.cosmos.controls;
    // (zoom as log10 metres, pitch, name: the places, and the stretches between them a dive crosses)
    const SPOTS = [[28.3, -0.08, 'keepers'], [27.3, -0.3, 'our marble'], [26.95, -0.25, 'universe'], [25.6, -0.3, 'web, whole'], [24.3, -0.4, 'web'],
      [22.6, -0.6, 'local group'], [21.35, -0.75, 'milky way'], [20.0, -0.55, 'entering the disc'], [17.7, -0.3, 'neighbours'], [15.0, -0.5, 'past the planets'],
      [13, -0.62, 'solar system'], [11.2, -0.5, 'inner planets'], [8.9, -0.2, 'earth and moon'], [7.35, -0.15, 'earth'], [5.3, -0.4, 'coming down'],
      [3.5, -0.42, 'gardens, 3 km'], [1.4, -0.6, 'gardens, 25 m'], [0.35, -0.95, 'her, 2 m'], [-1.75, -1.1, 'her eye'], [-3.6, -1.1, 'cornea']];
    for (const [l, pitch, name] of SPOTS) {
      if (only && !only.includes(name)) continue;
      app.setRealm('cosmos', true);
      cc.set(l, 0.4, pitch);
      await timed(name, () => app.cosmos.r.levels.filter((x) => x.on()).map((lv) => { const on = lv.on; return [lv.id, () => { lv.on = () => false; }, () => { lv.on = on; }]; }));
    }
    const pass = (label) => (app.r.items ?? []).find((p) => p && p.label === label);
    for (const p of app.places.values()) {
      const name = 'cell:' + p.id;
      if (only && !only.includes(name)) continue;
      app.setRealm('cell', true);
      app.controls.set(p.at, app.fit(p.scale), p.yaw, p.pitch);
      await timed(name, () => {
        const K = app.field.perChunk, list = [];
        for (const label of ['glass', 'ao']) { const q = pass(label); if (q) { const was = q.enabled; list.push([label, () => { q.enabled = () => false; }, () => { q.enabled = was; }]); } }
        list.push(['focus', () => { app.dof = 0; }, () => { app.dof = 1; }]);
        list.push(['crowd', () => { app.field.perChunk = 0; }, () => { app.field.perChunk = K; }]);
        return list;
      });
    }
    return out;
  }, scales, !!process.env.PARTS, only);

  const base = process.env.BASE ? JSON.parse(readFileSync(process.env.BASE, 'utf8')) : null;
  for (const r of rows) {
    const ms = scales.map((sc) => `${scales.length > 1 ? `@${sc} ` : ''}${String(r.ms[sc]).padStart(5)}`).join('  ');
    const parts = Object.entries(r.parts).filter(([, v]) => Math.abs(v) >= 1.5).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');
    let cmp = '';
    const was = base?.places?.[r.name]?.[scales[0]];
    if (was != null) {
      const now = r.ms[scales[0]], slower = now > was * 1.15 && now > was + 3;
      if (slower) failed = true;
      cmp = `  was ${String(was).padStart(5)}${slower ? '  SLOWER' : now < was * 0.85 && now < was - 3 ? '  faster' : ''}`;
    }
    console.log(`${r.name.padEnd(20)} ${ms} ms  ${r.render}${cmp}${parts ? `  ${parts}` : ''}`);
  }
  if (process.env.OUT) {
    const places = Object.fromEntries(rows.map((r) => [r.name, r.ms]));
    writeFileSync(process.env.OUT, JSON.stringify({ when: new Date().toISOString(), query, size: `${w}x${h}@${dpr}`, phone, places, parts: Object.fromEntries(rows.map((r) => [r.name, r.parts])) }, null, 1) + '\n');
  }
} catch (e) {
  console.error('bench:', e.message.split('\n')[0]);
  failed = true;
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
  unlock();
}
process.exit(failed ? 1 : 0);
