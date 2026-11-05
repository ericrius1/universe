// The GPU's cost along the whole zoom, as a phone gets it (its user agent, a 390×844 screen at 3×, so the app's phone
// settings), from the kept GPU Chrome (CDP=<port>, tools/keepchrome.mjs): for each place above the cell and in it, the
// frame's GPU time and the costliest passes (weft's timestamps). Resolution held (?noautores) so places compare.
//   node tools/perf.mjs [query] [width] [height] [dpr]       (env: CDP, PORT or ORIGIN; DESKTOP=1 the desktop's settings)
import puppeteer from 'puppeteer-core';

const [query = '', w = '390', h = '844', dpr = '3'] = process.argv.slice(2);
const origin = process.env.ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? '5751'}`;
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${process.env.CDP ?? 9740}`, defaultViewport: null, protocolTimeout: 0 });
const tag = `about:blank#perf-${process.pid}-${Date.now()}`;
const s = await browser.target().createCDPSession();
await s.send('Target.createTarget', { url: tag, newWindow: true, width: Number(w), height: Number(h) });
const page = await (await browser.waitForTarget((t) => t.url() === tag, { timeout: 15000 })).page();
try {
  if (!process.env.DESKTOP) await page.setUserAgent(IPHONE);
  await page.setViewport({ width: Number(w), height: Number(h), deviceScaleFactor: Number(dpr), isMobile: !process.env.DESKTOP, hasTouch: !process.env.DESKTOP });
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[error] ${m.text()}`); });
  if (process.env.LEVELS) await page.evaluateOnNewDocument(() => { window.__levels = true; });
  await page.goto(`${origin}/?noautores&notitle&${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__ready === true || window.__failed, { timeout: 180000, polling: 250 });
  const rows = await page.evaluate(async () => {
    const { app, kit } = window;
    kit.profiler.force = true;
    const frames = (n) => new Promise((res) => { let i = 0; const f = () => (++i >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const measure = async (name) => {
      await frames(40);
      const start = kit.profiler.serial, t = [], passes = new Map();
      while (kit.profiler.serial < start + 45) {
        await frames(1);
        if (t.length < kit.profiler.serial - start) { t.push(kit.profiler.lastFrameMs); for (const [k, v] of kit.profiler.lastMs) passes.set(k, (passes.get(k) ?? 0) + v); }
      }
      t.sort((a, b) => a - b);
      const top = [...passes].map(([k, v]) => [k, v / t.length]).sort((a, b) => b[1] - a[1]).slice(0, 7);
      return { name, ms: +t[t.length >> 2].toFixed(2), render: kit.size.render.join('×'), top: top.map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ') };
    };
    // (LEVELS=1: what each level above the cell costs, the frame without it: per-pass timestamps say little on a tiler)
    const without = async (r) => {
      if (!window.__levels) return r;
      const lvs = app.cosmos.r.levels.filter((l) => l.on());
      const parts = [];
      for (const l of lvs) {
        const on = l.on;
        l.on = () => false;
        const m = await measure('');
        l.on = on;
        parts.push(`${l.id} ${(r.ms - m.ms).toFixed(1)}`);
      }
      r.top = parts.join(' · ');
      return r;
    };
    const out = [];
    const cc = app.cosmos.controls;
    const SPOTS = [[28.3, 0.3, -0.08, 'keepers'], [27.8, 0.3, -0.25, 'their hand'], [27.3, 0.4, -0.3, 'our marble'], [26.95, 0.4, -0.25, 'universe'], [24.3, 0.4, -0.4, 'web'], [21.35, 0.4, -0.75, 'milkyway'], [17.7, 0.4, -0.3, 'neighbours'],
      [13, 0.4, -0.62, 'solar'], [7.35, 0.4, -0.15, 'earth'], [5.3, 0.4, -0.4, 'earth-low'], [3.5, 0.4, -0.42, 'boulder'], [1.6, 0.4, -0.7, 'meadow'],
      [0.35, 0.4, -0.95, 'person'], [-1.75, 0.4, -1.1, 'eye'], [-2.8, 0.4, -1.1, 'iris'], [-3.6, 0.4, -1.1, 'skin cells']];
    for (const [l, yaw, pitch, name] of SPOTS) {
      app.setRealm('cosmos', true);
      cc.set(l, yaw, pitch);
      out.push(await without(await measure(name)));
    }
    if (window.__levels) return out;
    for (const p of app.places.values()) {
      app.setRealm('cell', true);
      app.controls.set(p.at, app.fit(p.scale), p.yaw, p.pitch);
      out.push(await measure('cell:' + p.id));
    }
    return out;
  });
  for (const r of rows) console.log(`${r.name.padEnd(20)} ${String(r.ms).padStart(6)} ms  ${r.render}  ${r.top}`);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
