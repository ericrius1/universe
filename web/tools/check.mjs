// Does every way into the page still draw? Boots each of a list of queries in the kept GPU Chrome (CDP, PORT or
// ORIGIN), waits for it to be ready, draws some frames (a film's test page by stepping its capture: it never draws by
// itself), and reports console errors and warnings, a failed boot, and a frame that came out black; a picture of each
// is kept in <outDir>. In the cell it also checks that pointing at things still names them (the id under the pointer).
//
//   node tools/check.mjs <outDir> [query…]      (with no queries: the usual ways in)
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lock, unlock } from './gpulock.mjs';

const [out, ...given] = process.argv.slice(2);
if (!out) { console.error('check: node tools/check.mjs <outDir> [query…]'); process.exit(2); }
mkdirSync(out, { recursive: true });
const origin = process.env.ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? '5751'}`;
const QUERIES = given.length ? given : ['', 'phone', 'dome=1024', 'film=journey&test', 'film=loop&test', 'film=trailer&test', 'place=atp', 'place=dna&phone', 's=13',
  'w=cosmos', 'w=solar', 'w=earth', 'w=havens', 'w=cell', 'w=cell&phone', 'from=12&to=5', 'nogardens', 'notaau&place=cell'];
const within = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: no answer in ${ms / 1000} s`)), ms))]);

await lock('check');
let bad = 0;
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${process.env.CDP ?? 9740}`, defaultViewport: null, protocolTimeout: 120000 });
const stop = setTimeout(() => { console.error('check: 20 minutes and not done: stopping'); unlock(); process.exit(2); }, 20 * 60e3);
stop.unref();
try {
  for (const q of QUERIES) {
    const phone = /(^|&)phone/.test(q), film = /(^|&)film=/.test(q), dome = /(^|&)dome/.test(q);
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    const said = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') said.push(`${m.type()}: ${m.text().slice(0, 160)}`); });
    page.on('pageerror', (e) => said.push(`pageerror: ${String(e).slice(0, 200)}`));
    let line = 'ok';
    try {
      await page.setViewport(phone ? { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : dome ? { width: 900, height: 900, deviceScaleFactor: 1 } : { width: 1280, height: 800, deviceScaleFactor: 2 });
      await page.goto(`${origin}/?notitle&${q}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => window.__ready === true || window.__failed, { timeout: 180000, polling: 250 });
      const failed = await page.evaluate(() => window.__failed ?? null);
      if (failed) throw new Error(`failed: ${String(failed).slice(0, 200)}`);
      if (film) await within(page.evaluate(async () => { for (let i = 0; i < 8; i++) await window.__capture.step(1 / 30); }), 120000, 'stepping the film');
      else await within(page.evaluate(() => window.__frames(40)), 120000, 'drawing frames');
      // (a picture, and whether there's anything in it)
      const shot = await page.screenshot({ type: 'jpeg', quality: 80 });
      writeFileSync(join(out, `${q.replace(/[^a-z0-9]+/gi, '_') || 'default'}.jpg`), shot);
      const mean = await page.evaluate(async (b64) => {
        const img = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(64, 64), g = c.getContext('2d');
        g.drawImage(img, 0, 0, 64, 64);
        const d = g.getImageData(0, 0, 64, 64).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
        return s / (d.length / 4) / 3;
      }, shot.toString('base64'));
      if (mean < 1.5) throw new Error(`a black frame (mean ${mean.toFixed(2)})`);
      // (in the cell: sweep the pointer across the frame and count the places it names something)
      if (/place=|w=cell/.test(q) && !film && !phone) {
        const vp = page.viewport();
        const names = new Set();
        let hits = 0;
        for (let i = 0; i < 24; i++) {
          await page.mouse.move(vp.width * (0.12 + 0.76 * ((i * 7) % 24) / 24), vp.height * (0.15 + 0.7 * (i / 24)));
          await page.evaluate(() => window.__frames(4));
          const h = await page.evaluate(() => ({ id: window.app.hover, title: window.app.card?.(window.app.hover)?.title ?? null }));
          if (h.id) hits++;
          if (h.title) names.add(h.title);
        }
        line = `ok · pointing names ${hits}/24 spots (${[...names].slice(0, 5).join(', ')})`;
        // (a wide view of the tissue or the whole cell has little under most of the sweep, on any build: only a close
        // place naming nothing is a fault)
        if (!hits && /place=(?!tissue|cell)/.test(q)) throw new Error('pointing names nothing');
      }
    } catch (e) { line = `FAILED ${e.message.split('\n')[0]}`; bad++; }
    console.log(`${(q || '(default)').padEnd(22)} ${line}${said.length ? `\n     ${[...new Set(said)].slice(0, 6).join('\n     ')}` : ''}`);
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }
} finally { clearTimeout(stop); await browser.disconnect(); unlock(); }
process.exit(bad ? 1 : 0);
