// The world's parts made off the main thread (build.worker.ts), each in a worker of its own so they're made side by side
// while the GPU cuts the canyon: the city and the Haven (ArchParts for the arch renderer), the flora planted in their
// beds once they're in, and the Haven's floor laid into the terrain — on every level, wherever the Haven has a floor
// (haven.ts havenGround: its terraces, its causeways' footings, the stair's notch and its courts, the ring round the
// temple) the ground is that floor, carved down where the canyon stands higher and raised where it falls away below
// what the walls reach (the notch's courts over the canyon's gorge), so no wall floats and no terrace is buried.
import type { ArchPart, GardenBed } from '../arch/types';
import type { FloraBuffers } from '../flora/buffers';
import type { HeightLevel, Terrain } from './terrain';
import type { BuildDone, BuildJob, CarveGrid } from './build.worker';
import { GARDENS, STAIR, TEMPLE } from './layout';

/** the box the Haven's floors lie in (havenGround is null outside it): round the temple, past the gardens' reach, and
 *  south over the grand stair's lowest flights to its first landing */
const REACH = Math.max(...GARDENS.wedges.map((w) => w.r1)) + 15;
export const HAVEN_BOX: [number, number, number, number] = [TEMPLE.x - REACH, TEMPLE.z - REACH, TEMPLE.x + REACH, Math.max(TEMPLE.z + REACH, STAIR.landings[0][1] + 12)];

function run(job: BuildJob, name: string): Promise<BuildDone> {
  const w = new Worker(new URL('./build.worker.ts', import.meta.url), { type: 'module', name });
  return new Promise((resolve, reject) => {
    w.onmessage = (e: MessageEvent<BuildDone>) => { resolve(e.data); w.terminate(); };
    w.onerror = (e) => { reject(new Error(`${name}: ${e.message}`)); w.terminate(); };
    w.postMessage(job);
  });
}

/** the city or the Haven, built in a worker; how long it took there (ms) */
export async function buildPart(which: 'city' | 'haven'): Promise<{ part: ArchPart; ms: number }> {
  const done = await run({ job: which }, `build.${which}`);
  if (!('part' in done)) throw new Error(`build: no ${which}`);
  return done;
}

/** the Haven's floors under every level's texels, worked out in a worker (start it early: it needs nothing but the
 *  levels' layout) */
export async function havenFloors(levels: HeightLevel[]): Promise<{ carve: CarveGrid[]; ms: number }> {
  const done = await run({ job: 'carve', levels, box: HAVEN_BOX }, 'build.carve');
  if (!('carve' in done)) throw new Error('build: no carve');
  return done;
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
