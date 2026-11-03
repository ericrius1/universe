// The bake off the main thread (arch.ts posts each part here): its mesh, lights and colliders in; the mesh refined
// where the lights fall, each vertex's light summed past the walls (bake.ts), cut and packed for the GPU (chunks.ts)
// out, its buffers moved back rather than copied.
import { LightGrid, Occluders, refine, bakeLight, BAKE, type BakeOptions } from './bake';
import { pack, type Packed } from './chunks';
import type { ArchMesh, LightSpot, StructureCollider } from './types';

/** a part's mesh, its lights, and its colliders (their solids stand between lights and surfaces) */
export interface BakeJob { id: number; mesh: ArchMesh; lights: LightSpot[]; colliders: StructureCollider[]; options?: Partial<BakeOptions> }
export interface BakeDone { id: number; packed: Packed; refined: number; ms: { refine: number; light: number; pack: number } }
export interface BakeFailed { id: number; error: string }

const scope = self as unknown as { onmessage: ((e: MessageEvent<BakeJob>) => void) | null; postMessage(m: BakeDone | BakeFailed, transfer?: Transferable[]): void };

scope.onmessage = (e) => {
  const { id, mesh, lights, colliders, options } = e.data;
  try {
    const o = { ...BAKE, ...options };
    const grid = new LightGrid(lights, o);
    const t0 = performance.now();
    const fine = refine(mesh, grid, o);
    const t1 = performance.now();
    const light = bakeLight(fine, grid, new Occluders(colliders), o);
    const t2 = performance.now();
    const packed = pack(fine, light);
    const t3 = performance.now();
    const done: BakeDone = { id, packed, refined: fine.idx.length / 3, ms: { refine: t1 - t0, light: t2 - t1, pack: t3 - t2 } };
    scope.postMessage(done, [packed.pos.buffer, packed.attr.buffer, packed.idx.buffer, packed.chunks.buffer, packed.boxes.buffer, packed.draws.buffer]);
  } catch (err) {
    scope.postMessage({ id, error: String((err as Error)?.stack ?? err) });
  }
};
