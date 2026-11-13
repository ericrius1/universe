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
//          AGAINST=<port or origin> a second build (the one before a change, say) timed place by place beside this one,
//          one page frozen while the other is timed, their order swapped each place: on a laptop that warms, and with
//          others at work on it, a kept run can be half as fast again as the same code an hour later, and only two
//          builds timed in the same minute compare. With it, a place fails if it's slower than the other build's
import puppeteer from 'puppeteer-core';
import { lock, unlock } from './gpulock.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const [query = '', w = '1710', h = '1000', dpr = '2'] = process.argv.slice(2);
const origin = process.env.ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? '5751'}`;
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const phone = !!process.env.PHONE;
const scales = (process.env.SCALES ?? '1').split(',').map(Number);
// (ONLY: places by name, separated by commas — or by semicolons, for the places with a comma in their name)
const only = process.env.ONLY ? process.env.ONLY.split(process.env.ONLY.includes(';') ? ';' : ',').map((x) => x.trim()) : null;
const against = process.env.AGAINST ? (/^\d+$/.test(process.env.AGAINST) ? `http://127.0.0.1:${process.env.AGAINST}` : process.env.AGAINST) : null;


await lock('bench');
let failed = false;
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${process.env.CDP ?? 9740}`, defaultViewport: null, protocolTimeout: 0 });
const s = await browser.target().createCDPSession();
const pages = [];
/** a page on a build, loaded and everything in (the gardens too: their compiles would be in the first places' frames) */
async function open(at) {
  const tag = `about:blank#bench-${process.pid}-${Date.now()}-${pages.length}`;
  await s.send('Target.createTarget', { url: tag, newWindow: true, width: Number(w), height: Number(h) });
  const page = await (await browser.waitForTarget((t) => t.url() === tag, { timeout: 15000 })).page();
  pages.push({ page, at });
  if (phone) await page.setUserAgent(IPHONE);
  await page.setViewport({ width: Number(w), height: Number(h), deviceScaleFactor: Number(dpr), isMobile: phone, hasTouch: phone });
  page.on('console', (m) => { if (m.type() === 'error') console.error(`[error] ${m.text()}`); });
  await page.goto(`${at}/?noautores&notitle&gov=off&${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__ready === true || window.__failed, { timeout: 180000, polling: 250 });
  const dead = await page.evaluate(() => window.__failed ?? null);
  if (dead) throw new Error(`the page at ${at} failed: ${dead}`);
  await page.waitForFunction(() => !window.app.gardens || window.app.gardens.ready, { timeout: 240000, polling: 500 });
  return pages[pages.length - 1];
}
/** a page held (its frames kept back, so it draws nothing) or let go again: only one draws at a time. Held by its own
 *  requestAnimationFrame (window.__hold, made in install): Chrome's lifecycle 'frozen' would do, but a headless page
 *  thawed from it stays hidden and never draws again */
const frozen = (p, on) => p.page.evaluate((on) => window.__hold(on), on);
/** what a page can time: its places by name, each set up and timed when asked (window.__bench) */
const install = (only) => {
  const { app, kit } = window;
  kit.profiler.force = true;
  // (holding the page: the frames it asks for kept till it's let go)
  const raf = window.requestAnimationFrame.bind(window);
  let kept = null;
  window.requestAnimationFrame = (f) => (kept ? (kept.push(f), 0) : raf(f));
  window.__hold = (on) => { if (on) kept ??= []; else { const q = kept ?? []; kept = null; for (const f of q) raf(f); } };
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
  const cc = app.cosmos.controls;
  // (zoom as log10 metres, pitch, name: the places, and the stretches between them a dive crosses)
  const SPOTS = [[28.3, -0.08, 'keepers'], [27.3, -0.3, 'our marble'], [26.95, -0.25, 'universe'], [25.6, -0.3, 'web, whole'], [24.3, -0.4, 'web'],
    [22.6, -0.6, 'local group'], [21.35, -0.75, 'milky way'], [20.0, -0.55, 'entering the disc'], [17.7, -0.3, 'neighbours'], [15.0, -0.5, 'past the planets'],
    [13, -0.62, 'solar system'], [11.2, -0.5, 'inner planets'], [8.9, -0.2, 'earth and moon'], [7.35, -0.15, 'earth'], [5.3, -0.4, 'coming down'],
    [3.5, -0.42, 'gardens, 3 km'], [1.4, -0.6, 'gardens, 25 m'], [0.35, -0.95, 'her, 2 m'], [-1.75, -1.1, 'her eye'], [-3.6, -1.1, 'cornea']];
  // (on the well's way, ?w=hepatocyte: its own stretch, the camera looking down as the way does: lab/way.ts)
  if (app.realms?.way === 'well') SPOTS.splice(0, SPOTS.length, [0, -0.85, 'well: bench'], [-0.7, -0.85, 'well: plate'], [-1.6, -1.3, 'well: down a well'],
    [-2.2, -1.32, 'well: meniscus'], [-3.1, -0.9, 'well: field'], [-3.9, -0.6, 'well: cells'], [-4.6, -0.42, 'well: one cell'], [-5.7, -0.3, 'well: organelles'], [-6.3, -0.25, 'well: deep']);
  /** each place: go there, and say what can be left out of it (a part's name, off, on) */
  const go = new Map();
  for (const [l, pitch, name] of SPOTS) go.set(name, () => {
    app.setRealm('cosmos', true);
    cc.set(l, 0.4, pitch);
    return () => app.cosmos.r.levels.filter((x) => x.on()).map((lv) => { const on = lv.on; return [lv.id, () => { lv.on = () => false; }, () => { lv.on = on; }]; });
  });
  const pass = (label) => (app.r?.items ?? []).find((p) => p && p.label === label);
  for (const p of app.places?.values?.() ?? []) go.set('cell:' + p.id, () => {
    app.setRealm('cell', true);
    app.controls.set(p.at, app.fit(p.scale), p.yaw, p.pitch);
    return () => {
      const K = app.field.perChunk, list = [];
      for (const label of ['glass', 'ao']) { const q = pass(label); if (q) { const was = q.enabled; list.push([label, () => { q.enabled = () => false; }, () => { q.enabled = was; }]); } }
      list.push(['focus', () => { app.dof = 0; }, () => { app.dof = 1; }]);
      list.push(['crowd', () => { app.field.perChunk = 0; }, () => { app.field.perChunk = K; }]);
      return list;
    };
  });
  window.__bench = {
    async time(name, scales, parts) {
      const set = go.get(name);
      if (!set) return null;
      const without = set();
      const r = { name, render: '', ms: {}, parts: {} };
      for (const sc of scales) { kit.renderScale = base0 * sc; r.ms[sc] = await measure(); }
      kit.renderScale = base0 * scales[0];
      r.render = kit.size.render.join('×');
      if (parts) for (const [part, off, on] of without()) { off(); r.parts[part] = +(r.ms[scales[0]] - await measure()).toFixed(1); on(); }
      kit.renderScale = base0;
      return r;
    },
  };
  return [...go.keys()].filter((n) => !only || only.includes(n));
};
const time = (p, name, parts) => p.page.evaluate((n, sc, pt) => window.__bench.time(n, sc, pt), name, scales, parts);

// (a run that hangs stops itself and closes its pages, well inside the lock's own limit)
const deadline = setTimeout(async () => {
  console.error('bench: 18 minutes and not done: stopping');
  for (const p of pages) await p.page.close().catch(() => {});
  unlock();
  process.exit(2);
}, 18 * 60e3);
deadline.unref();
try {
  const mine = await open(origin);
  const names = await mine.page.evaluate(install, only);
  let ref = null;
  if (against) {
    await frozen(mine, true);
    ref = await open(against);
    await ref.page.evaluate(install, only);
  }
  const rows = [];
  for (const [i, name] of names.entries()) {
    // (the other build's turn first at every other place, so neither is always the one timed on the warmer laptop)
    const turn = async (p, parts) => {
      if (ref) { await frozen(p === mine ? ref : mine, true); await frozen(p, false); }
      return time(p, name, parts);
    };
    let r, other = null;
    if (ref && i % 2) { other = await turn(ref, false); r = await turn(mine, !!process.env.PARTS); }
    else { r = await turn(mine, !!process.env.PARTS); if (ref) other = await turn(ref, false); }
    r.ref = other?.ms ?? null;
    rows.push(r);
    console.error(`  ${name}: ${r.ms[scales[0]]}${other ? ` beside ${other.ms[scales[0]]}` : ''}`);
  }

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
    if (r.ref) {
      const now = r.ms[scales[0]], was = r.ref[scales[0]], slower = now > was * 1.15 && now > was + 3;
      if (slower) failed = true;
      cmp += `  beside ${String(was).padStart(5)} (×${(now / was).toFixed(2)})${slower ? '  SLOWER' : ''}`;
    }
    console.log(`${r.name.padEnd(20)} ${ms} ms  ${r.render}${cmp}${parts ? `  ${parts}` : ''}`);
  }
  if (process.env.OUT) {
    const places = Object.fromEntries(rows.map((r) => [r.name, r.ms]));
    const beside = against ? { against, beside: Object.fromEntries(rows.map((r) => [r.name, r.ref])) } : {};
    writeFileSync(process.env.OUT, JSON.stringify({ when: new Date().toISOString(), query, size: `${w}x${h}@${dpr}`, phone, places, parts: Object.fromEntries(rows.map((r) => [r.name, r.parts])), ...beside }, null, 1) + '\n');
  }
} catch (e) {
  console.error('bench:', e.message.split('\n')[0]);
  failed = true;
} finally {
  for (const p of pages) await p.page.close().catch(() => {});
  await browser.disconnect();
  unlock();
}
process.exit(failed ? 1 : 0);
