// The face-on map of the Milky Way (data/sky/milkyway_faceon.webp, its dust in milkyway_dust.webp: NASA/JPL-Caltech/
// R. Hurt (SSC), an artist's concept built on Spitzer's survey) as the galaxy level reads it, and its stars drawn from
// it, so the points and the march's glow agree. Imported by the worker that decodes it (deepsky.worker.ts): nothing
// here touches the GPU.
//
// The map's frame (milkyway_faceon.json): seen from the north galactic pole, the centre in the middle, the Sun at
// (0.5, 0.695), l = 0 up from the Sun and l = 90° to the left, 39.25 kpc across. That puts the Sun 0.195 × 39.25 =
// 7.65 kpc from the centre; the ladder has it at 8.2 (frames.ts, Bland-Hawthorn & Gerhard 2016). The map is scaled up
// by 8.2 / 7.65 (7%) about the centre so its Sun is the ladder's, and everything on it, the arms, the bar, the size of
// the disc, grows with it: 42.05 kpc across. In the galaxy's axes (−x toward the centre from the Sun, z toward l = 90°)
// a point (x, z) is at u = 0.5 − z / W, v = 0.5 + x / W (c_galaxy.wgsl MAP_W).
export const MAP_SUN_V = 0.695;
export const MAP_W = (39.25 * 8.2) / ((MAP_SUN_V - 0.5) * 39.25);

/** the light's scale height (kpc) at a radius: a thin disc, swelling round the bar and bulge (c_galaxy.wgsl) */
export const scaleHeight = (r: number) => 0.2 + 0.55 * Math.exp(-(r * r) / (2.4 * 2.4));

const lin = (b: number) => Math.pow(b / 255, 2.2);

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const gauss = () => { const u = Math.max(1e-9, next()), v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return { next, gauss };
}

/** a star's colour from its temperature (K), roughly a black body's (as blackbody() in cosmos.wgsl) */
function temp(t: number) {
  const x = t / 100;
  const R = x <= 66 ? 1 : Math.min(1, 1.293 * Math.pow(x - 60, -0.1332));
  const G = x <= 66 ? Math.max(0, Math.min(1, 0.39 * Math.log(x) - 0.634)) : Math.min(1, 1.13 * Math.pow(x - 60, -0.0755));
  const B = x >= 66 ? 1 : x <= 19 ? 0 : Math.max(0, Math.min(1, 0.543 * Math.log(x - 10) - 1.196));
  const c = [R, G, B].map((v) => Math.pow(v, 2.2)), m = Math.max(...c);
  return c.map((v) => v / m);
}

/** `n` stars drawn from the map's light (`rgba`: its pixels, `w` × `h`), as a point set's records (levels/points.ts:
 *  x, y, z, size, r, g, b, luminosity; kpc, the galaxy's axes), with the globular clusters in a halo round the centre */
export function starsFromMap(rgba: Uint8Array, w: number, h: number, n: number, seed = 42): Float32Array {
  // the light on a coarse grid (each cell the sum of its pixels'), and its running total to draw cells from
  const G = 256, kx = w / G, ky = h / G;
  const cell = new Float64Array(G * G);
  for (let y = 0; y < h; y++) {
    const row = Math.min(G - 1, Math.floor(y / ky)) * G;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      cell[row + Math.min(G - 1, Math.floor(x / kx))] += lin(rgba[i]) * 0.3 + lin(rgba[i + 1]) * 0.5 + lin(rgba[i + 2]) * 0.2;
    }
  }
  const cdf = new Float64Array(G * G);
  let sum = 0;
  for (let i = 0; i < G * G; i++) { sum += cell[i]; cdf[i] = sum; }
  const r = rng(seed);
  const out = new Float32Array(n * 8);
  const sun = [8.2, 0.02, 0];
  let k = 0;
  const push = (x: number, y: number, z: number, c: number[], lum: number) => { out.set([x, y, z, 0, c[0], c[1], c[2], lum], k * 8); k++; };
  const clusters = 160, perCluster = 40, disc = n - clusters * perCluster;
  for (let tries = 0; k < disc && tries < disc * 4; tries++) {
    // a cell by its light, a place in it, the map's colour there
    const q = r.next() * sum;
    let lo = 0, hi = G * G - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < q) lo = m + 1; else hi = m; }
    const u = ((lo % G) + r.next()) / G, v = (Math.floor(lo / G) + r.next()) / G;
    const x = (v - 0.5) * MAP_W, z = (0.5 - u) * MAP_W;
    const rad = Math.hypot(x, z);
    // (out of the plane as the light is: an exponential layer)
    const y0 = scaleHeight(rad) * Math.log(Math.max(1e-6, r.next())) * (r.next() < 0.5 ? -1 : 1);
    // (none in the Sun's own bubble: the neighbourhood's stars are drawn by their own level)
    if (Math.hypot(x - sun[0], y0 - sun[1], z - sun[2]) < 0.25) continue;
    const pi = (Math.min(h - 1, Math.floor(v * h)) * w + Math.min(w - 1, Math.floor(u * w))) * 4;
    const mc = [lin(rgba[pi]), lin(rgba[pi + 1]), lin(rgba[pi + 2])];
    const mm = Math.max(mc[0], mc[1], mc[2], 1e-4);
    // (blue where the map is blue: the young arms, their stars hot and bright; warm in the bar and bulge)
    const blue = Math.max(0, Math.min(1, (mc[2] / mm - mc[0] / mm) * 2.5 + 0.3));
    const hot = r.next() < 0.1 + 0.6 * blue;
    // (the young ones in a thinner layer)
    const y = y0 * (hot ? 0.5 : 1);
    const t = hot ? 6500 + Math.pow(r.next(), 2) * 25000 : 3200 + r.next() * 3200;
    const tc = temp(t);
    const c = [0, 1, 2].map((j) => (mc[j] / mm) * 0.55 + tc[j] * 0.45);
    push(x, y, z, c, Math.exp(r.gauss()) * (hot ? 3 : 1));
  }
  for (let i = 0; i < clusters; i++) {
    const rad = Math.abs(r.gauss()) * 6 + 0.5, th = Math.acos(2 * r.next() - 1), ph = r.next() * Math.PI * 2;
    const cx = rad * Math.sin(th) * Math.cos(ph), cy = rad * Math.cos(th), cz = rad * Math.sin(th) * Math.sin(ph);
    for (let j = 0; j < perCluster && k < n; j++) push(cx + r.gauss() * 0.012, cy + r.gauss() * 0.012, cz + r.gauss() * 0.012, [1.0, 0.85, 0.6], 0.6);
  }
  return out;
}
