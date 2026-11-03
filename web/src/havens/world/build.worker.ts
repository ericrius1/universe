// The world's parts made off the main thread (build.ts asks): the city or the Haven built whole (their builders take a
// second of CPU and a few hundred MB of scratch arrays each), its mesh's arrays handed back moved, not copied; the
// Haven's floor under each terrain level's texels (haven.ts havenGround, ~1 µs a texel, two million of them); or the
// flora grown and planted in the parts' beds (flora/scatter.ts: some 300,000 plants, two seconds), its GPU data
// handed back moved.
import { buildCity } from '../city/city';
import { buildHaven, havenGround } from '../haven/haven';
import { terraceFloor } from '../haven/plan';
import { growFlora } from '../flora/species';
import { meshHeights, scatterBeds } from '../flora/scatter';
import { floraBuffers, type FloraBuffers } from '../flora/buffers';
import type { ArchPart, GardenBed } from '../arch/types';
import { FLOOR_Y } from './layout';
import type { HeightLevel } from './terrain';

export type BuildJob = { job: 'city' | 'haven' } | { job: 'carve'; levels: HeightLevel[]; box: [number, number, number, number] } | { job: 'flora'; beds: GardenBed[] };

/** one level's texels in the box: the first column and row, the width and height, the Haven's floor at each (NaN where
 *  it leaves the ground alone) */
export interface CarveGrid { c0: number; r0: number; w: number; h: number; floor: Float32Array }

export type BuildDone = { part: ArchPart; ms: number } | { carve: CarveGrid[]; ms: number } | { flora: FloraBuffers; count: number; ms: number };

self.onmessage = (e: MessageEvent<BuildJob>) => {
  const t0 = performance.now(), j = e.data;
  if (j.job === 'carve') {
    const carve = j.levels.map((L) => grid(L, j.box));
    self.postMessage({ carve, ms: performance.now() - t0 } satisfies BuildDone, { transfer: carve.map((g) => g.floor.buffer) });
    return;
  }
  if (j.job === 'flora') {
    const grown = growFlora();
    // (the ground beside a bed, for the side a wall's vines hang down: the terrace's own floor in the gardens, the
    // carved ground elsewhere in the Haven, the canyon floor in the city)
    const ground = (x: number, z: number) => terraceFloor(x, z) ?? havenGround(x, z) ?? FLOOR_Y;
    const plants = scatterBeds(j.beds, { heights: meshHeights(grown), ground });
    const flora = floraBuffers(grown, plants);
    const moved = [flora.verts.buffer, flora.indices.buffer, flora.species.buffer, flora.instances, flora.args.buffer] as ArrayBuffer[];
    self.postMessage({ flora, count: plants.length, ms: performance.now() - t0 } satisfies BuildDone, { transfer: moved });
    return;
  }
  const part = j.job === 'city' ? buildCity() : buildHaven(), m = part.mesh;
  const moved = new Set([m.pos.buffer, m.nrm.buffer, m.uv.buffer, m.mat.buffer, m.tint.buffer, m.ao.buffer, m.glow.buffer, m.idx.buffer]);
  self.postMessage({ part, ms: performance.now() - t0 } satisfies BuildDone, { transfer: [...moved] as ArrayBuffer[] });
};

/** the Haven's floor at a level's texel centres inside the box (terrain.ts's texel layout) */
function grid(L: HeightLevel, box: [number, number, number, number]): CarveGrid {
  const texel = (2 * L.half) / L.px;
  const col = (x: number) => (x - L.cx + L.half) / texel - 0.5, row = (z: number) => (z - L.cz + L.half) / texel - 0.5;
  const c0 = Math.max(0, Math.floor(col(box[0]))), c1 = Math.min(L.px - 1, Math.ceil(col(box[2])));
  const r0 = Math.max(0, Math.floor(row(box[1]))), r1 = Math.min(L.px - 1, Math.ceil(row(box[3])));
  const w = Math.max(0, c1 - c0 + 1), h = Math.max(0, r1 - r0 + 1), floor = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    const z = L.cz + (r0 + r + 0.5) * texel - L.half;
    for (let c = 0; c < w; c++) floor[r * w + c] = havenGround(L.cx + (c0 + c + 0.5) * texel - L.half, z) ?? NaN;
  }
  return { c0, r0, w, h, floor };
}
