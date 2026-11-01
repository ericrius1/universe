// The kept headless Chrome the tools attach to (CDP=<port>): WebGPU on the PC's GPU, muted, CDP on the port given
// (9740 by default). Spawned from node, detached; each page the tools open gets a window of its own.
//   node tools/keepchrome.mjs [port]
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
const port = Number(process.argv[2] || 9740);
const prof = join(tmpdir(), 'cell-cdp-' + port);
mkdirSync(prof, { recursive: true });
const CHROME = process.env.CHROME ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome');
const p = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`,
  '--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-process-crash-limit', '--autoplay-policy=no-user-gesture-required',
  '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore', detached: true });
p.unref();
console.log('chrome', p.pid, 'on', port);
