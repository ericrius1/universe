// The real ground round the spot (public/data/earth-havens, beside Boulder's data/earth: what the Earth from space and the air above the spot draw, down to
// the gardens: cosmos/levels/earthdata.ts) made from Seven Havens' own canyon, so the dive comes down onto the same land
// all the way: its heights from the game's terrain (the CPU's copy, the Haven carved in), its picture the game's own
// render from straight above at noon (no haze, no clouds, no aurora: the air over it is Universe's), centred on the
// spot (gardens.ts SPOT), heights relative to the ground there. Two windows, as Boulder's were: near 8 km across
// (heights 512² at 16 m, the picture 1024² at 8 m), far 120 km (1024² at 117 m; the picture 1024²), each picture
// shot in tiles straight down from not far above them (no haze: the light's is Universe's air over it).
// Needs Seven Havens' dev server (its port 5270: npm run dev there) and its tools (a headless Chrome on the GPU).
//   node tools/ground-from-havens.mjs
import { openPage } from '../../../sevenhavens/tools/browser.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../public/data/earth-havens');
const SPOT = { x: 78.8, z: -760.0 };
// (each picture's tiles shot at a field of view their width fills from a height the canyon still draws well at: the
// near's from ~7 km, the far's from ~40 km; the relief leans a pixel or two at the tiles' edges)
const NEAR = { half: 4096, px: 512, colorPx: 1024, tiles: 4, fov: 16 };
const FAR = { half: 60000, px: 1024, colorPx: 1024, tiles: 4, fov: 40 };
const TILE = 512;

mkdirSync(out, { recursive: true });
const { page, close } = await openPage({ width: TILE, height: TILE });
page.on('pageerror', (e) => console.error('page:', e.message));
try {
  await page.goto('http://localhost:5270/?dev&profile=rtx5090', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => !!window.__havens?.ready, { timeout: 300000, polling: 250 });
  // the look of a picture from above: noon, clear, no haze or aurora, nothing of the lens
  await page.evaluate(async () => {
    const h = window.__havens, app = window.app, env = app.env;
    await h.view('haven-aerial');
    h.time(12.5);
    env.clouds.settings.enabled = false;
    env.look.haze = 0;
    env.look.rayleigh = 0;
    env.sky.preset({ intensity: 0, day: 0 });
    Object.assign(app.post.settings, { vignette: 0, grain: 0, bloom: 0.01, glow: 0 });
    Object.assign(app.post.fx.settings, { rays: 0, flare: 0, glare: 0, aberration: 0, grain: 0, halation: 0, dof: false });
    app.post.motionBlur.allowed = false;
    // (Katara out of the picture)
    app.player.placeAt([90000, 0, 90000], 0);
    app.player.freeCamera = true;
    app.flora && (app.flora.settings.dissolve = false);
  });

  // heights: the terrain's, relative to the spot's ground
  const heights = async (w) => page.evaluate(({ w, S }) => {
    const t = window.app.terrain, base = t.heightAt(S.x, S.z);
    const n = w.px, out = new Float32Array(n * n);
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = S.x - w.half + ((i + 0.5) / n) * 2 * w.half, z = S.z - w.half + ((j + 0.5) / n) * 2 * w.half;
      const h = t.heightAt(x, z) - base;
      out[j * n + i] = h; lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    const q = new Uint16Array(n * n);
    for (let k = 0; k < q.length; k++) q[k] = Math.round(((out[k] - lo) / Math.max(hi - lo, 1e-6)) * 65535);
    return { base, min: lo, max: hi, q: Array.from(q) };
  }, { w, S: SPOT });

  // the picture: tiles straight down (north up), each from the height its width fills at the window's field of view
  const picture = async (w, name) => {
    const n = w.tiles, size = (2 * w.half) / n, fov = w.fov;
    const H = (size / 2) / Math.tan((fov / 2) * Math.PI / 180);
    const files = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const cx = SPOT.x - w.half + (i + 0.5) * size, cz = SPOT.z - w.half + (j + 0.5) * size;
      await page.evaluate(async ({ cx, cz, H, fov }) => {
        const app = window.app, c = app.kit.camera, g = app.terrain.heightAt(cx, cz);
        c.position = [cx, g + H, cz];
        c.yaw = 0; c.pitch = -Math.PI / 2 + 1e-4; c.roll = 0;
        c.fovY = (fov * Math.PI) / 180;
        c.near = Math.max(0.5, H * 0.01);
        c.cut();
        app.env.resetExposure = true;
        await window.__havens.step(24);
        // (every tile at the first's exposure: no seams between them)
        window.__E0 ??= app.env.exposure;
        app.post.settings.exposure = Math.log2(window.__E0 / app.env.exposure);
        await window.__havens.step(2);
      }, { cx, cz, H, fov });
      const f = resolve(out, `.tile-${name}-${i}-${j}.png`);
      await page.screenshot({ path: f });
      files.push({ f, i, j });
    }
    // stitched and sized (Pillow)
    const full = resolve(out, `${name}.jpg`);
    const py = 'import sys, json\nfrom PIL import Image\nn, T, px, dst = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]\n'
      + 'im = Image.new("RGB", (n * T, n * T))\nfor a in json.loads(sys.argv[5]): im.paste(Image.open(a["f"]).convert("RGB").resize((T, T)), (a["i"] * T, a["j"] * T))\n'
      + 'im.resize((px, px), Image.LANCZOS).save(dst, quality=90)\n';
    execFileSync('python3', ['-c', py, String(n), String(TILE), String(w.colorPx), full, JSON.stringify(files)]);
    execFileSync('rm', ['-f', ...files.map((t) => t.f)]);
  };

  const manifest = { spot: [SPOT.x, SPOT.z], spotHeight: 0, base: 0, near: {}, far: {} };
  for (const [key, w] of [['near', NEAR], ['far', FAR]]) {
    const h = await heights(w);
    writeFileSync(resolve(out, `${key}.u16`), Buffer.from(new Uint16Array(h.q).buffer));
    manifest.base = h.base;
    manifest[key] = { half: w.half, px: w.px, min: h.min, max: h.max, heights: `${key}.u16`, color: `${key}.jpg`, colorPx: w.colorPx };
    await picture(w, key);
    console.log(`ground: ${key} ${w.half * 2 / 1000} km, heights ${h.min.toFixed(0)}..${h.max.toFixed(0)} m`);
  }
  writeFileSync(resolve(out, 'earth.json'), JSON.stringify(manifest, null, 1) + '\n');
} finally {
  await close();
}
