// The blockout land (?land=blockout): the star mesa's shapes at their heights and nothing more, filled on the CPU (a
// worker a level: blockout.worker.ts) into the terrain's levels and the ground's material, so the district builders
// can see their ground before the real land is rebuilt (round 6, B1), and the land's fallback if it never is. From the
// layout alone (world/layout.ts): the plain flat at PLAIN_Y; the star's edge (sdStar) a straight 2.4:1 cliff down to
// it; the rim a crest inside the edge (6 m at the lip, 10 m 8 m in, nothing RIM.w in); the town's floor flat at
// FLOOR_Y; the ridges raised from it along their centre lines (their crests falling root to end, cut down where a way
// crosses them); the pools' beds 2.4 m down inside a 1.5 m bank; the canal's bed, the east tip's chute and its
// cascades' steps, the plain's channel; the plateau a disc at its top inside its edge and a steep cliff to its foot
// (from the last flank terrace's level where a flank wedge comes down to it). The Haven's floors are carved into it as
// into the real land (world/build.ts carveHaven). Its zones are the ground shader's as it reads them now: 0 natural
// rock and sand, 1 the town's floor, 6 water.
import {
  CHANNEL, FLOOR_Y, GARDENS, PLAIN_Y, PLATEAU, POOLS, RIDGES, RIDGE_CUTS, RIM, STAR, polyLength, sdStar, starReach, type V2,
} from '../world/layout';
import { INFO_STEP, LEVELS, texelCentre, texelOf, type HeightLevelSpec } from './levels';

/** is the blockout the land (?land=blockout) */
export function isBlockout(): boolean {
  try { return new URLSearchParams(globalThis.location?.search ?? '').get('land') === 'blockout'; } catch { return false; }
}

/** the levels the blockout fills: the land's own (the two finest round the star's centre) */
export const BLOCKOUT_LEVELS: HeightLevelSpec[] = LEVELS.map((L, i) => (i < 2 ? { ...L, cx: STAR.cx, cz: STAR.cz } : L));

/** the ground shader's zone codes as it reads them (ground.wgsl: zone * 17 / 255) */
const ZONE_K = 17 / 255;
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- the ridges' segments binned in 32 m cells, so a texel tests only its own few
const CELL = 32, HALF = Math.ceil((STAR.rTip + 64) / CELL), N = 2 * HALF;
interface Seg { ax: number; az: number; dx: number; dz: number; l: number; s0: number; L: number; hw0: number; hw1: number; c0: number; c1: number; cuts: [number, number][] }
const segs: Seg[] = [];
const bins: number[][] = Array.from({ length: N * N }, () => []);
RIDGES.forEach((r, i) => {
  const L = polyLength(r.pts);
  const cuts = RIDGE_CUTS.filter((c) => c.ridge === i).map((c) => [c.along, c.width / 2] as [number, number]);
  let s = 0;
  for (let k = 0; k < r.pts.length - 1; k++) {
    const a = r.pts[k], b = r.pts[k + 1], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    const sg: Seg = { ax: a[0], az: a[1], dx, dz, l, s0: s, L, hw0: r.hw[0], hw1: r.hw[1], c0: r.crest[0], c1: r.crest[1], cuts };
    const id = segs.push(sg) - 1, reach = r.hw[0] * 1.3 + 2;
    const x0 = Math.min(a[0], b[0]) - reach, x1 = Math.max(a[0], b[0]) + reach, z0 = Math.min(a[1], b[1]) - reach, z1 = Math.max(a[1], b[1]) + reach;
    for (let cz = Math.floor(z0 / CELL) + HALF; cz <= Math.floor(z1 / CELL) + HALF; cz++) for (let cx = Math.floor(x0 / CELL) + HALF; cx <= Math.floor(x1 / CELL) + HALF; cx++) {
      if (cx >= 0 && cz >= 0 && cx < N && cz < N) bins[cz * N + cx].push(id);
    }
    s += l;
  }
});
/** the ridges' height over the floor at (x, z): each a crest along its centre line (its half-width and crest falling
 *  from root to end), rounded off to nothing at 1.25 half-widths out, and down to the floor across its cuts */
function ridgesAt(x: number, z: number): number {
  const cx = Math.floor(x / CELL) + HALF, cz = Math.floor(z / CELL) + HALF;
  if (cx < 0 || cz < 0 || cx >= N || cz >= N) return 0;
  let h = 0;
  for (const id of bins[cz * N + cx]) {
    const g = segs[id];
    const u = Math.max(0, Math.min(1, ((x - g.ax) * g.dx + (z - g.az) * g.dz) / (g.l * g.l)));
    const d = Math.hypot(g.ax + g.dx * u - x, g.az + g.dz * u - z), s = g.s0 + u * g.l, t = s / g.L;
    const hw = g.hw0 + (g.hw1 - g.hw0) * t;
    if (d > hw * 1.25) continue;
    let k = (1 - smooth(0.6, 1.25, d / hw)) * (g.c0 + (g.c1 - g.c0) * t);
    for (const [at, half] of g.cuts) k *= smooth(half, half + 4, Math.abs(s - at));
    if (k > h) h = k;
  }
  return h;
}

/** the pools' beds: how far down at (x, z) (0 outside them) */
function poolsAt(x: number, z: number): number {
  let low = 0;
  for (const q of POOLS) {
    const dx = x - q.x, dz = z - q.z;
    if (Math.abs(dx) > q.rx + q.rz || Math.abs(dz) > q.rx + q.rz) continue;
    const c = Math.cos(q.rot), s = Math.sin(q.rot), u = c * dx + s * dz, v = -s * dx + c * dz;
    const e = Math.sqrt((u / q.rx) ** 2 + (v / q.rz) ** 2);
    if (e >= 1) continue;
    low = Math.min(low, -2.4 * smooth(0, 1.5, (1 - e) * Math.min(q.rx, q.rz)));
  }
  return low;
}

/** a point's distance to a polyline */
function lineDistance(path: V2[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
    const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(a[0] + dx * u - x, a[1] + dz * u - z));
  }
  return best;
}

/** the top wedges' spans (the plateau's edge stands at its top there; elsewhere a flank wedge's last terrace comes down
 *  to it) */
const TOP_SPANS = GARDENS.wedges.filter((w) => w.kind === 'top').map((w) => [w.a0, w.a1]);
const FLANK = GARDENS.wedges.find((w) => w.kind === 'flank')!;
const FLANK_LAST = PLATEAU.topY - FLANK.drop * (FLANK.steps - 1);
const EDGE_X = starReach(0);
const PLAIN_PATH = CHANNEL.plain.path;
const [PX0, PX1] = [Math.min(...PLAIN_PATH.map((p) => p[0])), Math.max(...PLAIN_PATH.map((p) => p[0]))];

/** the blockout's height at (x, z) and its zone */
export function blockoutSample(x: number, z: number): { h: number; zone: number } {
  const d = sdStar(x, z);
  // ---- the plain, and its channel
  if (d > 40) {
    if (x > PX0 - 60 && x < PX1 && Math.abs(z) < 200) {
      const c = lineDistance(PLAIN_PATH, x, z), hw = CHANNEL.plain.halfWidth;
      if (c < hw + 6) return { h: PLAIN_Y + (CHANNEL.plain.bed - PLAIN_Y) * (1 - smooth(hw, hw + 6, c)), zone: c < hw ? 6 : 0 };
    }
    return { h: PLAIN_Y, zone: 0 };
  }
  // ---- the mesa: the cliff outside the edge, the rim's crest inside it, the town's floor
  const t = -d;
  let h: number, zone = 0;
  if (d > 0) h = Math.max(PLAIN_Y, FLOOR_Y + 6 - 2.4 * d);
  else if (t < RIM.w) h = FLOOR_Y + (t < 8 ? 6 + 4 * smooth(0, 8, t) : 10 * (1 - smooth(8, RIM.w, t)));
  else { h = FLOOR_Y; zone = 1; }
  // ---- the plateau and its foot
  const r = Math.hypot(x - PLATEAU.cx, z - PLATEAU.cz);
  if (r < PLATEAU.foot) {
    let a = Math.atan2(z - PLATEAU.cz, x - PLATEAU.cx);
    if (a < 0) a += Math.PI * 2;
    const top = r <= PLATEAU.r || TOP_SPANS.some(([a0, a1]) => a >= a0 && a <= a1) ? PLATEAU.topY : FLANK_LAST;
    const p = r <= PLATEAU.r ? top : top * (1 - (r - PLATEAU.r) / (PLATEAU.foot - PLATEAU.r));
    if (p > h) { h = p; zone = 0; }
  }
  // ---- the ridges, the pools, the canal and the east tip's chute
  if (t > 0 && r > PLATEAU.foot - 2) {
    const rh = ridgesAt(x, z);
    if (rh > 0.05) { h = Math.max(h, FLOOR_Y + rh); zone = 0; }
    const low = poolsAt(x, z);
    if (low < 0) { h = FLOOR_Y + low; zone = 6; }
  }
  // (the canal from the palace's back to the gate; the chute cut through the rim at the east tip, its cascades' steps)
  if (Math.abs(z - CHANNEL.canal[0][1]) < 26 && x > CHANNEL.canal[0][0] - 4) {
    const az = Math.abs(z - CHANNEL.canal[0][1]), w = CHANNEL.width / 2;
    if (x > CHANNEL.sluice[0][0] - 20 && x < EDGE_X && h > FLOOR_Y) h = FLOOR_Y + (h - FLOOR_Y) * smooth(20, 26, az);
    if (az < w + 1.5 && x < EDGE_X) {
      const bed = FLOOR_Y + CHANNEL.bed * (1 - smooth(w, w + 1.5, az));
      if (bed < h || zone === 1) { h = Math.min(h, bed); if (az < w) zone = 6; }
    } else if (az < w + 1.5) {
      // (the cascades: the cliff's two benches, then the plunge pool on the plain)
      const [, b1, b2] = CHANNEL.cascade, out = x - EDGE_X;
      const step = out < 14 ? b1 : out < 30 ? b2 : PLAIN_Y - 2;
      h = Math.min(h, Math.max(step, PLAIN_Y - 2));
      zone = 6;
    }
  }
  return { h, zone };
}
export const blockoutHeight = (x: number, z: number) => blockoutSample(x, z).h;

/** a level's heights and its material (rgba8 in u32s, the info grid INFO_STEP times coarser: sand, damp, scree, zone),
 *  as fill.wgsl makes them for the real land */
export function blockoutLevel(L: HeightLevelSpec): { heights: Float32Array; info: Uint32Array } {
  const n = L.px, heights = new Float32Array(n * n), zones = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const [x, z] = texelCentre(L, i, j), s = blockoutSample(x, z), k = j * n + i;
    heights[k] = s.h;
    zones[k] = s.zone;
  }
  const t = texelOf(L), m = n / INFO_STEP, info = new Uint32Array(m * m);
  const H = (i: number, j: number) => heights[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const ci = i * INFO_STEP + (INFO_STEP >> 1), cj = j * INFO_STEP + (INFO_STEP >> 1);
    const gx = (H(ci + 1, cj) - H(ci - 1, cj)) / (2 * t), gz = (H(ci, cj + 1) - H(ci, cj - 1)) / (2 * t), slope = Math.hypot(gx, gz);
    const h = H(ci, cj), zone = zones[cj * n + ci];
    const flat = 1 - smooth(0.12, 0.6, slope), cliff = smooth(0.5, 2.5, slope);
    const talus = smooth(0.1, 0.5, slope) * (1 - cliff);
    // (sand deep on the plain, thin on the town's floor and the rim, none in the water)
    const sand = zone === 6 ? 0 : flat * (h < PLAIN_Y + 4 ? 0.85 : zone === 1 ? 0.3 : 0.12);
    const damp = zone === 6 ? 0.6 : 0;
    const q = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
    info[j * m + i] = q(sand) | (q(damp) << 8) | (q(talus) << 16) | (q(zone * ZONE_K) << 24);
  }
  return { heights, info };
}

/** a level of the blockout made in a worker of its own (the levels side by side, a second or two each) */
export function blockoutInWorker(L: HeightLevelSpec): Promise<{ heights: Float32Array<ArrayBuffer>; info: Uint32Array<ArrayBuffer> }> {
  const w = new Worker(new URL('./blockout.worker.ts', import.meta.url), { type: 'module', name: 'land.blockout' });
  return new Promise((resolve, reject) => {
    w.onmessage = (e: MessageEvent<{ heights: Float32Array<ArrayBuffer>; info: Uint32Array<ArrayBuffer> }>) => { resolve(e.data); w.terminate(); };
    w.onerror = (e) => { reject(new Error(`land.blockout: ${e.message}`)); w.terminate(); };
    w.postMessage(L);
  });
}
