// Render a film (src/film.ts) in the kept GPU Chrome (CDP=<port>, tools/keepchrome.mjs): opens ?film=<name> at the
// size asked, follows window.__film until it's done (frames and the soundtrack land in ../film/<name> through the dev
// server), then encodes them with ffmpeg: H.264, the score muxed in.
//   node tools/film.mjs <name> [width] [height]
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const [name = 'trailer', w = '1920', h = '1080'] = process.argv.slice(2);
const width = Number(w), height = Number(h);
const FFMPEG = process.env.FFMPEG ?? 'C:/Users/ericr/codeprojects/tools/ffmpeg/bin/ffmpeg.exe';
const dir = resolve('..', 'film', name);
rmSync(resolve(dir, 'frames'), { recursive: true, force: true });
rmSync(resolve(dir, 'audio.wav'), { force: true });

const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${process.env.CDP ?? 9740}`, defaultViewport: null, protocolTimeout: 0 });
const tag = `about:blank#film-${process.pid}-${Date.now()}`;
const s = await browser.target().createCDPSession();
await s.send('Target.createTarget', { url: tag, newWindow: true, width, height });
const page = await (await browser.waitForTarget((t) => t.url() === tag, { timeout: 15000 })).page();
await page.setViewport({ width, height, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') console.log(`[error] ${m.text()}`); });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${process.env.PORT ?? 5740}/?film=${name}&notitle`, { waitUntil: 'domcontentloaded', timeout: 60000 });
let last = -1;
for (;;) {
  await new Promise((r) => setTimeout(r, 3000));
  const st = await page.evaluate(() => window.__film ?? (window.__failed ? { failed: window.__failed } : null)).catch(() => null);
  if (st?.failed) { console.error('film failed:', st.failed); break; }
  if (!st) continue;
  if (st.frame !== last) { last = st.frame; console.log(`shot ${st.shot} frame ${st.frame}/${st.total} (${((Date.now() - t0) / 1000).toFixed(0)} s)`); }
  if (st.done) break;
}
await page.close().catch(() => {});
await browser.disconnect().catch(() => {});

const frames = existsSync(resolve(dir, 'frames')) ? readdirSync(resolve(dir, 'frames')).filter((f) => f.endsWith('.jpg')).length : 0;
if (!frames) process.exit(1);
const out = resolve(dir, `cell-${name}.mp4`);
const args = ['-y', '-framerate', '30', '-i', resolve(dir, 'frames', 'f%05d.jpg')];
const audio = resolve(dir, 'audio.wav');
if (existsSync(audio)) args.push('-i', audio, '-c:a', 'aac', '-b:a', '256k', '-shortest');
args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out);
execFileSync(FFMPEG, args, { stdio: 'inherit' });
console.log('wrote', out, `${frames} frames, ${(frames / 30).toFixed(1)} s`);
