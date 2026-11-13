// A picture of every place in the zoom as it stands, and one contact sheet of them, from the kept GPU Chrome
// (CDP=<port>, tools/keepchrome.mjs) against a built page (PORT or ORIGIN): for looking at a change before and after
// (run it on each build into two folders and put the sheets side by side). The frames are read back from the GPU by
// the app (no interface); UI=1 adds a second picture of each with the page's interface over it.
// It takes the GPU lock tools/bench.mjs takes, so a timing run elsewhere isn't disturbed.
//
//   node tools/shots.mjs <outDir> [query] [width] [height]
//     env  CDP, PORT or ORIGIN · ONLY=web,cell:dna some places · UI=1 · COLS=4 the sheet's columns · FRAMES=50 to settle
import puppeteer from 'puppeteer-core';
import { lock, unlock } from './gpulock.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [out, query = '', w = '1280', h = '800'] = process.argv.slice(2);
if (!out) { console.error('shots: node tools/shots.mjs <outDir> [query] [width] [height]'); process.exit(2); }
mkdirSync(out, { recursive: true });
const origin = process.env.ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? '5751'}`;
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const settle = Number(process.env.FRAMES ?? 50);

// (zoom as log10 metres, pitch, name: as tools/bench.mjs has them)
const SPOTS = [[28.3, -0.08, 'keepers'], [27.3, -0.3, 'our marble'], [26.95, -0.25, 'universe'], [25.6, -0.3, 'web, whole'], [24.3, -0.4, 'web'],
  [22.6, -0.6, 'local group'], [21.35, -0.75, 'milky way'], [20.0, -0.55, 'entering the disc'], [17.7, -0.3, 'neighbours'], [15.0, -0.5, 'past the planets'],
  [13, -0.62, 'solar system'], [11.2, -0.5, 'inner planets'], [8.9, -0.2, 'earth and moon'], [7.35, -0.15, 'earth'], [5.3, -0.4, 'coming down'],
  [3.5, -0.42, 'gardens, 3 km'], [1.4, -0.6, 'gardens, 25 m'], [0.35, -0.95, 'her, 2 m'], [-1.75, -1.1, 'her eye'], [-3.6, -1.1, 'cornea']];
const file = (i, name) => `${String(i).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-')}`;

await lock('shots');
let code = 0;
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${process.env.CDP ?? 9740}`, defaultViewport: null, protocolTimeout: 0 });
const tag = `about:blank#shots-${process.pid}-${Date.now()}`;
const s = await browser.target().createCDPSession();
await s.send('Target.createTarget', { url: tag, newWindow: true, width: Number(w), height: Number(h) });
const page = await (await browser.waitForTarget((t) => t.url() === tag, { timeout: 15000 })).page();
const made = [];
try {
  await page.setViewport({ width: Number(w), height: Number(h), deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') console.error(`[error] ${m.text()}`); });
  await page.goto(`${origin}/?noautores&gov=off&${process.env.UI ? '' : 'notitle&'}${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__ready === true || window.__failed, { timeout: 180000, polling: 250 });
  const dead = await page.evaluate(() => window.__failed ?? null);
  if (dead) throw new Error(`the page failed: ${dead}`);
  await page.waitForFunction(() => !window.app.gardens || window.app.gardens.ready, { timeout: 240000, polling: 500 });
  const shot = async (name) => {
    await page.evaluate((n) => window.__frames(n), settle);
    const url = await page.evaluate(() => window.__capture.blob('image/jpeg', 0.88).then((b) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); })));
    writeFileSync(join(out, `${name}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
    if (process.env.UI) await page.screenshot({ path: join(out, `${name}.ui.jpg`), type: 'jpeg', quality: 86 });
    made.push(name);
  };
  let i = 0;
  for (const [l, pitch, name] of SPOTS) {
    i++;
    if (only && !only.includes(name)) continue;
    await page.evaluate((l, pitch) => { window.app.setRealm('cosmos', true); window.app.cosmos.controls.set(l, 0.4, pitch); }, l, pitch);
    await shot(file(i, name));
  }
  for (const id of await page.evaluate(() => [...window.app.places.keys()])) {
    i++;
    if (only && !only.includes('cell:' + id)) continue;
    await page.evaluate((id) => { const { app } = window; const p = app.places.get(id); app.setRealm('cell', true); app.controls.set(p.at, app.fit(p.scale), p.yaw, p.pitch); }, id);
    await shot(file(i, 'cell-' + id));
  }
  // the sheet: every picture with its name, one image
  const cols = Number(process.env.COLS ?? 4), cw = 480;
  const cells = made.map((n) => `<figure><img src="data:image/jpeg;base64,${readFileSync(join(out, `${n}.jpg`)).toString('base64')}"><figcaption>${n}</figcaption></figure>`).join('');
  const sheet = await browser.newPage();
  await sheet.setViewport({ width: cols * (cw + 4) + 4, height: 600, deviceScaleFactor: 1 });
  await sheet.setContent(`<body style="margin:0;background:#111;font:12px ui-monospace,monospace;color:#ffd24a"><div style="display:grid;grid-template-columns:repeat(${cols},${cw}px);gap:4px;padding:4px">${cells}</div>
    <style>figure{margin:0;position:relative}img{width:${cw}px;display:block}figcaption{position:absolute;left:6px;top:4px;text-shadow:0 0 4px #000,0 0 4px #000}</style></body>`, { waitUntil: 'load' });
  await sheet.screenshot({ path: join(out, 'sheet.jpg'), fullPage: true, type: 'jpeg', quality: 84 });
  await sheet.close();
  console.log(`shots: ${made.length} pictures and sheet.jpg in ${out}`);
} catch (e) {
  console.error('shots:', e.message.split('\n')[0]);
  code = 1;
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
  unlock();
}
process.exit(code);
