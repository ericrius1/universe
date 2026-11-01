// The organelles on the GPU: their shapes as one storage buffer (the shared world group every shader reads), their
// meshes as one vertex and one index buffer, and the draws — outer surfaces, the inner walls of the membranes, and
// the cut faces where the wedge opens the cell.
import { StructArray, type Kit, type StorageBuffer } from '@ericrius1/weft';
import worldShader from '../../shaders/world.wgsl';
import organelleShader from '../../shaders/organelle.wgsl';
import type { Renderer } from '../engine/renderer';
import { type World, Kind } from './layout';
import { buildMeshes, type MeshSet } from './meshes';

export function packOrganelles(kit: Kit, world: World): StorageBuffer {
  const O = world.organelles;
  const arr = new StructArray(worldShader.structs.Organelle, O.length);
  O.forEach((o, i) => {
    let depth = 0;
    for (let p = o.parent; p >= 0; p = O[p].parent) depth++;
    arr.set(i, {
      a: o.a, kind: o.kind, b: o.b, shape: o.shape, r: o.r, amp: o.amp, freq: o.freq, seed: o.seed,
      thick: o.thick, bend: o.bend, parent: o.parent, depth, center: o.center, bound: o.bound,
    });
  });
  return kit.storage({ label: 'organelles', data: new Uint8Array(arr.data), stride: arr.stride });
}

export class Organelles {
  mesh: MeshSet;
  constructor(kit: Kit, r: Renderer, world: World, quality: number) {
    const t0 = performance.now();
    this.mesh = buildMeshes(world.organelles, quality);
    console.log(`organelle meshes: ${(this.mesh.vertices.length / 8 / 1e3).toFixed(0)}k vertices, ${(this.mesh.indices.length / 3 / 1e3).toFixed(0)}k triangles in ${(performance.now() - t0).toFixed(0)} ms`);
    const verts = kit.storage({ label: 'organelle.v', data: this.mesh.vertices, stride: 32 });
    const indices = kit.storage({ label: 'organelle.i', data: this.mesh.indices, usage: ['index', 'storage', 'copy-dst'] });
    const all = this.mesh.indices.length, shells = this.mesh.shellCount;
    const ib = { buffer: indices, format: 'uint32' as const };
    const s = r.scene;
    const g = r.globals;
    const cutOn = () => (g.get('cut') as number) > 0;
    const solidOn = () => (g.get('shellSolid') as number) > 0.001;
    const glassOn = () => (g.get('shellSolid') as number) < 0.999;
    // cisternae, cristae, nucleoli, droplets: always solid (the shells come first in the index buffer)
    s.draw(organelleShader, { label: 'organelles', vertex: 'vs_outer', fragment: 'fs_outer', bind: { verts }, indices: ib, count: all - shells, first: shells, cull: 'back' });
    // membranes: solid up close (their inner walls too), glass from afar
    s.draw(organelleShader, { label: 'membranes', vertex: 'vs_outer', fragment: 'fs_outer', bind: { verts }, indices: ib, count: shells, cull: 'back', enabled: solidOn });
    s.draw(organelleShader, { label: 'membranes.inner', vertex: 'vs_inner', fragment: 'fs_inner', bind: { verts }, indices: ib, count: shells, cull: 'front', enabled: solidOn });
    s.draw(organelleShader, { label: 'organelles.cut', vertex: 'vs_cap', fragment: 'fs_cap', bind: { verts }, indices: ib, count: all, cull: 'front', enabled: cutOn });
    s.draw(organelleShader, { label: 'organelles.cut.inner', vertex: 'vs_cap_inner', fragment: 'fs_cap', bind: { verts }, indices: ib, count: shells, cull: 'back', enabled: cutOn });
    const add: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
    const keep: GPUBlendState = { color: { srcFactor: 'zero', dstFactor: 'one-minus-src' }, alpha: { srcFactor: 'zero', dstFactor: 'one-minus-src' } };
    r.glass.draw(organelleShader, { label: 'membranes.glass', vertex: 'vs_outer', fragment: 'fs_glass', bind: { verts }, indices: ib, count: shells, cull: 'none', blend: [add, keep], depthWrite: false, enabled: glassOn });
  }
}

export const KIND_NAMES: Record<number, string> = {
  [Kind.Cell]: 'plasma membrane', [Kind.Nucleus]: 'nucleus', [Kind.Nucleolus]: 'nucleolus', [Kind.Mito]: 'mitochondrion',
  [Kind.Crista]: 'crista', [Kind.ER]: 'endoplasmic reticulum', [Kind.Golgi]: 'Golgi apparatus', [Kind.Lysosome]: 'lysosome',
  [Kind.Peroxisome]: 'peroxisome', [Kind.Endosome]: 'endosome', [Kind.Vesicle]: 'vesicle', [Kind.Droplet]: 'lipid droplet',
  [Kind.Neighbor]: 'a neighbouring cell', [Kind.NeighborNucleus]: "a neighbour's nucleus",
};
