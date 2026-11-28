// Frames of the loop film (src/loop.ts) at given zooms or frame numbers, from the kept GPU Chrome (CDP=<port>,
// tools/keepchrome.mjs), the film stepped by hand (?film=loop&test): each frame grabbed after a few steps on it.
//   node tools/loop-shots.mjs <outdir> <z|#frame>... [--size 960x540] [--steps 8]
// e.g. node tools/loop-shots.mjs ../scratch/loop -9 -9.4 -10 -14.5 '#0' '#7020'
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const out = resolve(args.shift() ?? '../scratch/loop');
let size = '960x540', steps = 8;
const at = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--size') size = args[++i];
  else if (args[i] === '--steps') steps = Number(args[++i]);
  else at.push(args[i]);
}
const [width, height] = size.split('x').map(Number);
mkdirSync(out, { recursive: true });
const origin = process.env.ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? '5750'}`;
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${process.env.CDP ?? 9740}`, defaultViewport: null, protocolTimeout: 0 });
const tag = `about:blank#loopshots-${process.pid}-${Date.now()}`;
const s = await browser.target().createCDPSession();
await s.send('Target.createTarget', { url: tag, newWindow: true, width, height });
const page = await (await browser.waitForTarget((t) => t.url() === tag, { timeout: 15000 })).page();
const finish = async (code) => { await page.close().catch(() => {}); await browser.disconnect().catch(() => {}); process.exit(code); };
try {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  page.on('console', (m) => { const t = m.type(); if (t === 'error' || process.env.LOG) console.log(`[${t}] ${m.text()}`); });
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  const t0 = Date.now();
  await page.goto(`${origin}/?film=loop&test&notitle${process.env.Q ? '&' + process.env.Q : ''}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__ready === true || window.__failed, { timeout: 600000, polling: 500 });
  const failed = await page.evaluate(() => window.__failed ?? null);
  if (failed) { console.log('failed:', failed); await finish(1); }
  console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s; ${await page.evaluate(() => window.__filmObj.total)} frames`);
  // (the ground and her figure in, as the film's run waits for them)
  await page.evaluate(async () => { const a = window.app; void a.cosmos.data.load().catch(() => {}); void a.cosmos.surface.figure.load().catch(() => {}); for (let k = 0; k < 600 && !a.cosmos.data.ready; k++) await window.__capture.step(0); });
  for (const a of at) {
    const i = await page.evaluate((a) => { const f = window.__filmObj; return a.startsWith('#') ? Number(a.slice(1)) : f.frameAt(Number(a)); }, a);
    const z = await page.evaluate((i, n) => { const f = window.__filmObj; let z = 0; for (let k = n; k >= 0; k--) z = f.seek(Math.max(0, i - k)); return z; }, i, 0);
    // (a few steps on it, the clock running, for the temporal filters to settle)
    for (let k = steps; k >= 0; k--) { await page.evaluate((j) => window.__filmObj.seek(j), Math.max(0, i - k)); await page.evaluate(() => window.__capture.step(1 / 60)); }
    const url = await page.evaluate(() => window.__grab());
    const name = `f${String(i).padStart(5, '0')}_z${z.toFixed(2)}.png`;
    writeFileSync(resolve(out, name), Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote', name);
  }
  await finish(0);
} catch (e) {
  console.error('loop-shots:', e.message.split('\n')[0]);
  await finish(1);
}
