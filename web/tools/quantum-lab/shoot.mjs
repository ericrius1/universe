// Renders contact sheets, temporal stability strips, and a 1080p GPU timing benchmark
// for web/shaders/quantum_core.wgsl via the kept GPU Chrome (CDP port 9740).
//
// Usage: node web/tools/quantum-lab/shoot.mjs [--bench] [--only=stages|transitions|strip|bench]

import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
mkdirSync(OUT, { recursive: true });

const ORIGIN = process.env.ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? '5750'}`;
const CDP = `http://127.0.0.1:${process.env.CDP ?? '9740'}`;
const args = new Set(process.argv.slice(2));
const onlyArg = [...args].find((a) => a.startsWith('--only='))?.split('=')[1] ?? null;
const runBench = args.has('--bench') || !onlyArg || onlyArg === 'bench';

// 16 key frames covering all 10 stages (4x4 sheet)
const STAGE_SHOTS = [
  { L: -8.65, t: 0.0, label: '1a. L=-8.65 bead seam' },
  { L: -9.15, t: 0.5, label: '1b. L=-9.15 nucleotide atoms' },
  { L: -9.55, t: 1.0, label: '1c→2. L=-9.55 entering carbon' },
  { L: -10.10, t: 1.5, label: '2. L=-10.10 1s/2s/2p orbitals' },
  { L: -11.40, t: 2.0, label: '3a. L=-11.40 cloud dissolving' },
  { L: -13.00, t: 2.5, label: '3b. L=-13.00 vast emptiness' },
  { L: -14.15, t: 3.0, label: '4a. L=-14.15 C-12 nucleus' },
  { L: -14.65, t: 3.5, label: '4b→5. L=-14.65 entering proton' },
  { L: -15.20, t: 4.0, label: '5. L=-15.20 quarks & Y gluons' },
  { L: -16.60, t: 4.5, label: '6. L=-16.60 point-like quark' },
  { L: -20.50, t: 5.0, label: '7a. L=-20.50 desert (early)' },
  { L: -28.00, t: 5.5, label: '7b. L=-28.00 desert (unifying)' },
  { L: -33.20, t: 6.0, label: '8a. L=-33.20 foam emerging' },
  { L: -34.80, t: 6.5, label: '8b. L=-34.80 Planck foam' },
  { L: -37.50, t: 7.0, label: '9. L=-37.50 infinity tunnel' },
  { L: -41.00, t: 7.5, label: '10. L=-41.00 CMB ball', ballR: 0.38 },
];

// 16 transition check frames (4x4 sheet) focusing on cross-fades and stage 10 cooling
const TRANSITION_SHOTS = [
  { L: -8.90, t: 0.2, label: 'T1. L=-8.90 bead→atoms' },
  { L: -9.35, t: 0.6, label: 'T2. L=-9.35 bg darkening' },
  { L: -9.80, t: 1.2, label: 'T3. L=-9.80 atom→orbitals' },
  { L: -10.65, t: 1.8, label: 'T4. L=-10.65 inside orbitals' },
  { L: -13.85, t: 2.8, label: 'T5. L=-13.85 nucleus resolve' },
  { L: -14.95, t: 3.7, label: 'T6. L=-14.95 proton skin open' },
  { L: -15.65, t: 4.2, label: 'T7. L=-15.65 gliding to quark' },
  { L: -17.90, t: 4.8, label: 'T8. L=-17.90 quark→desert' },
  { L: -31.80, t: 5.8, label: 'T9. L=-31.80 desert→foam' },
  { L: -35.30, t: 6.7, label: 'T10. L=-35.30 foam→infinity' },
  { L: -39.20, t: 7.1, label: 'T11. L=-39.20 peak light' },
  { L: -40.00, t: 7.2, label: 'T12. L=-40.00 ball born', ballR: 0.44 },
  { L: -40.25, t: 7.3, label: 'T13. L=-40.25 white-hot', ballR: 0.42 },
  { L: -40.50, t: 7.35, label: 'T14. L=-40.50 gold cooling', ballR: 0.40 },
  { L: -40.75, t: 7.4, label: 'T15. L=-40.75 CMB emerging', ballR: 0.39 },
  { L: -41.00, t: 7.5, label: 'T16. L=-41.00 CMB final', ballR: 0.38 },
];

// Temporal stability strips: 8 consecutive frames, dL = -0.02, dt = 1/60
const STRIP_ANCHORS = [
  { name: 'orbitals', L0: -10.10, t0: 1.5 },
  { name: 'foam', L0: -34.70, t0: 6.5 },
];

async function makeSheet(browser, tiles, cols, tileW, outPath) {
  const cells = tiles.map((item) =>
    `<figure><img src="data:image/png;base64,${item.b64}"><figcaption>${item.label}</figcaption></figure>`
  ).join('');
  const sheet = await browser.newPage();
  try {
    await sheet.setViewport({ width: cols * (tileW + 4) + 4, height: 600, deviceScaleFactor: 1 });
    await sheet.setContent(`
      <body style="margin:0;background:#0a0c12;font:12px/1.2 ui-monospace,Menlo,monospace;color:#f4dfa0">
        <div style="display:grid;grid-template-columns:repeat(${cols},${tileW}px);gap:4px;padding:4px">${cells}</div>
        <style>
          figure{margin:0;position:relative;background:#000}
          img{width:${tileW}px;display:block}
          figcaption{position:absolute;left:6px;top:5px;padding:2px 5px;background:rgba(0,0,0,0.58);border-radius:3px;text-shadow:0 1px 2px #000}
        </style>
      </body>
    `, { waitUntil: 'load' });
    await sheet.screenshot({ path: outPath, fullPage: true, type: 'jpeg', quality: 90 });
  } finally {
    await sheet.close();
  }
}

let exitCode = 0;
const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null, protocolTimeout: 0 });
const tag = `about:blank#qlab-${process.pid}-${Date.now()}`;
const cdp = await browser.target().createCDPSession();
await cdp.send('Target.createTarget', { url: tag, newWindow: true, width: 960, height: 540 });
const page = await (await browser.waitForTarget((t) => t.url() === tag, { timeout: 15000 })).page();

try {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.error(`[page ${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));

  await page.setViewport({ width: 960, height: 540, deviceScaleFactor: 1 });
  await page.goto(`${ORIGIN}/tools/quantum-lab/index.html?L=-10.1&t=0`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__ready === true || window.__failed, { timeout: 30000, polling: 100 });
  const failed = await page.evaluate(() => window.__failed ?? null);
  if (failed) throw new Error(failed);

  const captureList = async (list) => {
    const tiles = [];
    for (const shot of list) {
      await page.evaluate((s) => window.__render({
        L: s.L, t: s.t, yaw: s.yaw ?? 0.4, pitch: s.pitch ?? -0.3,
        ballR: s.ballR !== undefined ? s.ballR : undefined,
      }), shot);
      const b64 = await page.screenshot({ encoding: 'base64', type: 'png' });
      tiles.push({ b64, label: shot.label });
    }
    return tiles;
  };

  if (!onlyArg || onlyArg === 'stages') {
    const tiles = await captureList(STAGE_SHOTS);
    const outPath = join(OUT, 'sheet-stages.jpg');
    await makeSheet(browser, tiles, 4, 480, outPath);
    console.log(`wrote ${outPath}`);
  }

  if (!onlyArg || onlyArg === 'transitions') {
    const tiles = await captureList(TRANSITION_SHOTS);
    const outPath = join(OUT, 'sheet-transitions.jpg');
    await makeSheet(browser, tiles, 4, 480, outPath);
    console.log(`wrote ${outPath}`);
  }

  if (!onlyArg || onlyArg === 'strip') {
    const stripTiles = [];
    for (const anchor of STRIP_ANCHORS) {
      for (let i = 0; i < 8; i++) {
        const L = anchor.L0 - i * 0.02;
        const t = anchor.t0 + i / 60;
        await page.evaluate((L, t) => window.__render({ L, t, yaw: 0.4, pitch: -0.3 }), L, t);
        const b64 = await page.screenshot({ encoding: 'base64', type: 'png' });
        stripTiles.push({ b64, label: `${anchor.name} #${i} L=${L.toFixed(2)} t=${t.toFixed(3)}` });
      }
    }
    const outPath = join(OUT, 'strip-temporal.jpg');
    await makeSheet(browser, stripTiles, 4, 480, outPath);
    console.log(`wrote ${outPath}`);
  }

  if (runBench) {
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    const benchPoints = [
      { name: 'Stage 1 (atoms)', L: -9.15 },
      { name: 'Stage 2 (orbitals)', L: -10.10 },
      { name: 'Stage 4 (nucleus)', L: -14.35 },
      { name: 'Stage 5 (quarks)', L: -15.20 },
      { name: 'Stage 7 (desert)', L: -24.00 },
      { name: 'Stage 8 (Planck foam)', L: -34.80 },
      { name: 'Stage 9 (infinity)', L: -37.50 },
      { name: 'Stage 10 (CMB seam)', L: -40.60 },
    ];
    console.log('--- 1920x1080 Benchmark (120 frames each) ---');
    for (const bp of benchPoints) {
      const r = await page.evaluate((L) => window.__bench({ L, frames: 120, stepL: -0.002 }), bp.L);
      const gpuStr = r.gpuMs != null ? `gpu=${r.gpuMs.toFixed(3)}ms` : 'gpu=n/a';
      console.log(`${bp.name.padEnd(24)} ${r.width}x${r.height}  wall=${r.wallMs.toFixed(3)}ms  ${gpuStr}`);
    }
  }
} catch (err) {
  console.error('shoot failed:', err);
  exitCode = 1;
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
process.exit(exitCode);
