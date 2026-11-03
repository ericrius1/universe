// The world's parts made off the main thread (build.worker.ts), each in a worker of its own so they're made side by side
// while the GPU makes the land: the city and the Haven (ArchParts for the arch renderer), the flora planted in their
// beds once they're in, and the Haven's floor laid into the terrain — on every level, wherever the Haven has a floor
// (haven.ts havenGround: its terraces, its causeways' footings, the stair's notch and its courts, the ring round the
// temple; never the slab sectors, whose slabs are the land's) the ground is that floor, carved down where the plateau
// stands higher and raised where it falls away below what the walls reach, so no wall floats and no terrace is
// buried.
import type { ArchPart, GardenBed } from '../arch/types';
import type { FloraBuffers } from '../flora/buffers';
import type { HeightLevel, Terrain } from './terrain';
import type { BuildDone, BuildJob, CarveGrid } from './build.worker';
import { GARDENS, STAIR, TEMPLE } from './layout';

/** the box the Haven's floors lie in (havenGround is null outside it): round the temple, past the gardens' reach to the
 *  ring road's inner edge (the causeways' feet, the dwellings' doors and the caverns' portal meet it there), and south
 *  over the grand stair's lowest flights to its foot on the ring road */
const REACH = Math.max(...GARDENS.wedges.map((w) => w.r1)) + 22;
export const HAVEN_BOX: [number, number, number, number] = [TEMPLE.x - REACH, TEMPLE.z - REACH, TEMPLE.x + REACH, Math.max(TEMPLE.z + REACH, STAIR.landings[0][1] + 12)];

/** the first worker's script in (it says so as it starts), so the others take it from the cache: a page's first load
 *  has nothing cached, and workers started together each fetched the same 160 KB script for themselves */
let loaded: Promise<void> | null = null;

/** the builders' workers' script in (or no worker asked for yet): what the load fetches before anything heavier */
export const workersIn = (): Promise<void> => loaded ?? Promise.resolve();

function run(job: BuildJob, name: string): Promise<BuildDone> {
  const spawn = () => new Worker(new URL('./build.worker.ts', import.meta.url), { type: 'module', name });
  const go = (w: Worker) => new Promise<BuildDone>((resolve, reject) => {
    w.onmessage = (e: MessageEvent<BuildDone | { loaded: true }>) => { if ('loaded' in e.data) return; resolve(e.data); w.terminate(); };
    w.onerror = (e) => { reject(new Error(`${name}: ${e.message}`)); w.terminate(); };
    w.postMessage(job);
  });
  if (loaded) return loaded.then(() => go(spawn()));
  const w = spawn();
  loaded = new Promise<void>((res) => {
    w.addEventListener('message', (e: MessageEvent) => { if (e.data && 'loaded' in e.data) res(); });
    // (one that fails to start doesn't hold the others back)
    w.addEventListener('error', () => res());
  });
  return go(w);
}

/** the city or the Haven, built in a worker (its mesh cut there into `regions` to bake side by side); how long it took
 *  there (ms) */
export async function buildPart(which: 'city' | 'haven', regions = 1): Promise<{ part: ArchPart; ms: number }> {
  const done = await run({ job: which, regions }, `build.${which}`);
  if (!('part' in done)) throw new Error(`build: no ${which}`);
  return done;
}

/** the Haven's floors under every level's texels, worked out in `workers` side by side (each every n-th row: the
 *  costly middle shared evenly), their rows put back together (start it early: it needs nothing but the levels' layout;
 *  two million texels, a second's work for one) */
export async function havenFloors(levels: HeightLevel[], workers = 1): Promise<{ carve: CarveGrid[]; ms: number }> {
  const of = Math.max(1, workers);
  const shares = await Promise.all(Array.from({ length: of }, (_, part) => run({ job: 'carve', levels, box: HAVEN_BOX, part, of }, `build.carve${part}`)));
  const grids = shares.map((d) => { if (!('carve' in d)) throw new Error('build: no carve'); return d.carve; });
  const carve = grids[0].map((g0, i): CarveGrid => {
    const { c0, r0, w, h } = g0, floor = new Float32Array(w * h);
    grids.forEach((gs, part) => {
      const g = gs[i];
      for (let r = part, k = 0; r < h; r += of, k++) floor.set(g.floor.subarray(k * w, (k + 1) * w), r * w);
    });
    return { c0, r0, w, h, floor };
  });
  return { carve, ms: Math.max(...shares.map((d) => d.ms)) };
}

/** the flora grown and planted in the beds (the city's and the Haven's), in a worker: its GPU data, how many plants,
 *  how long it took there (ms) */
export async function plantFlora(beds: GardenBed[]): Promise<{ flora: FloraBuffers; count: number; ms: number }> {
  const done = await run({ job: 'flora', beds }, 'build.flora');
  if (!('flora' in done)) throw new Error('build: no flora');
  return done;
}

/** the Haven's floors laid into the terrain (its heights in): the ground is the floor wherever there is one */
export function carveHaven(terrain: Terrain, floors: CarveGrid[]) {
  terrain.edit(HAVEN_BOX, (x, z, h, i) => {
    const L = terrain.levels[i], g = floors[i];
    const c = Math.round((x - L.cx + L.half) / L.texel - 0.5) - g.c0, r = Math.round((z - L.cz + L.half) / L.texel - 0.5) - g.r0;
    const f = c >= 0 && c < g.w && r >= 0 && r < g.h ? g.floor[r * g.w + c] : NaN;
    return Number.isNaN(f) ? h : f;
  });
}
