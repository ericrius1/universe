// A frame of the app from the kept GPU Chrome (CDP=<port>, tools/keepchrome.mjs), read back from the GPU by the app
// itself (window.__grab). The page's console errors are printed; a page script (optional, a file or inline JS after
// "js:") runs once the app is ready, before the grab — it may return a number of frames to wait first (default 40).
//   node tools/shoot.mjs <out.png> [query] [width] [height] [script]     (env: CDP, PORT or ORIGIN; UI=1 adds the interface)
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [out, query = '', w = '1600', h = '900', script] = process.argv.slice(2);
const width = Number(w), height = Number(h);
const origin = process.env.ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? '5740'}`;
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${process.env.CDP ?? 9740}`, defaultViewport: null, protocolTimeout: 0 });
const tag = `about:blank#shoot-${process.pid}-${Date.now()}`;
const s = await browser.target().createCDPSession();
await s.send('Target.createTarget', { url: tag, newWindow: true, width, height });
const page = await (await browser.waitForTarget((t) => t.url() === tag, { timeout: 15000 })).page();
const within = (p, ms) => Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
const done = async (code) => {
  await within(page.close(), 5000);
  await within(s.send('Target.closeTarget', { targetId: page.target()._targetId }), 3000);
  await within(browser.disconnect(), 2000);
  process.exit(code);
};
const timer = setTimeout(() => { console.error('shoot: timed out'); void done(2); }, 240000);
try {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warn' || process.env.LOG) console.log(`[${t}] ${m.text()}`); });
  const cdp = await page.createCDPSession();
  await cdp.send('Runtime.enable');
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails: d }) => {
    const at = (d.stackTrace?.callFrames ?? []).slice(0, 6).map((f) => `  at ${f.functionName || '?'} ${f.url.replace(/^.*\/\/[^/]+/, '')}:${f.lineNumber + 1}:${f.columnNumber + 1}`).join('\n');
    console.log(`[exception] ${d.exception?.description?.split('\n')[0] ?? d.text}\n${at}`);
  });
  const t0 = Date.now();
  await page.goto(`${origin}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__ready === true || window.__failed, { timeout: 180000, polling: 250 });
  const failed = await page.evaluate(() => window.__failed ?? null);
  if (failed) { console.log('app failed:', failed); await done(1); }
  console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  let wait = 40;
  if (script) {
    const code = script.startsWith('js:') ? script.slice(3) : existsSync(script) ? readFileSync(script, 'utf8') : script;
    const r = await page.evaluate(code);
    if (typeof r === 'number') wait = r;
    else if (r !== undefined) console.log('script:', JSON.stringify(r).slice(0, 2000));
  }
  await page.evaluate((n) => window.__frames(n), wait);
  const url = await page.evaluate(() => window.__grab());
  writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  // UI=1: the page's interface (DOM, transparent) laid over the GPU frame
  if (process.env.UI) {
    const ui = out.replace(/\.png$/, '.ui.png');
    await page.evaluate(() => { document.getElementById('c').style.visibility = 'hidden'; document.body.style.background = 'transparent'; document.documentElement.style.background = 'transparent'; });
    await page.screenshot({ path: ui, omitBackground: true });
    await page.evaluate(() => { document.getElementById('c').style.visibility = ''; document.body.style.background = ''; document.documentElement.style.background = ''; });
    execFileSync('python', ['-c', `from PIL import Image; a=Image.open(r'${out}').convert('RGBA'); b=Image.open(r'${ui}').convert('RGBA').resize(a.size); Image.alpha_composite(a,b).convert('RGB').save(r'${out}')`]);
  }
  const perf = await page.evaluate(() => window.__perf?.() ?? null);
  if (perf) console.log('perf:', JSON.stringify(perf));
  console.log('wrote', out);
  clearTimeout(timer);
  await done(0);
} catch (e) {
  console.error('shoot:', e.message.split('\n')[0]);
  clearTimeout(timer);
  await done(1);
}
