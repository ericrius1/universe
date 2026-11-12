// The organelles on the GPU: their shapes as one storage buffer (the shared world group every shader reads), their
// meshes as one vertex and one index buffer, and the draws — outer surfaces, the inner walls of the membranes, and
// the cut faces where the wedge opens the cell.
import { StructArray, type Kit, type StorageBuffer } from '@ericrius1/weft';
import worldShader from '../../shaders/world.wgsl';
import organelleShader from '../../shaders/organelle.wgsl';
import type { Renderer } from '../engine/renderer';
import { type World, Kind } from './layout';
import { buildMeshes, type MeshSet } from './meshes';
import { pcg3 } from './noise';

/** the value noise's lattice for the organelles' shading (organelle.wgsl tvnoise): N³ corners of noise.wgsl's ncorner,
 *  tiling, as a 3D texture the hardware filters */
const NOISE_N = 64;
function noiseLattice(kit: Kit) {
  const N = NOISE_N, data = new Uint16Array(N * N * N);
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  // (to half floats: the values are in [-1, 1], so no infinities or subnormals worth keeping)
  const half = (v: number) => {
    f32[0] = v;
    const x = u32[0], sign = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 127 + 15;
    if (e <= 0) return sign;
    const m = Math.min(0x3ff, ((x >>> 13) & 0x3ff) + ((x >>> 12) & 1));
    return sign | (e << 10) | m;
  };
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) data[(z * N + y) * N + x] = half((pcg3(x, y, z)[0] / 4294967296) * 2 - 1);
  const t = kit.texture({ label: 'organelle.noise', format: 'r16float', size: [N, N, N], dimension: '3d', usage: ['sample', 'copy-dst'] });
  kit.queue.writeTexture({ texture: t.gpu }, data, { bytesPerRow: N * 2, rowsPerImage: N }, [N, N, N]);
  return t;
}

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
    const noiseTex = noiseLattice(kit);
    const all = this.mesh.indices.length, shells = this.mesh.shellCount, { shellCut, solidCut } = this.mesh;
    const ib = { buffer: indices, format: 'uint32' as const };
    const s = r.scene;
    const g = r.globals;
    const cutOn = () => (g.get('cut') as number) > 0;
    const solidOn = () => (g.get('shellSolid') as number) > 0.001;
    const glassOn = () => (g.get('shellSolid') as number) < 0.999;
    // (each solid draw twice: as it is where the wedge is open or a membrane's dithering in, and without either — so no
    // fragment of it can be discarded and the GPU hides what's behind it before shading it — the rest of the time; and
    // what the wedge can't reach — the meshes' first part of each kind, meshes.ts cuttable — never needs it for the cut)
    const solidAll = () => (g.get('shellSolid') as number) >= 0.999;
    const whole = () => !cutOn() && solidAll();
    const bind = { verts, noiseTex };
    const solid = (label: string, vertex: string, fragment: string, first: number, end: number, cull: GPUCullMode, on: () => boolean, plain: () => boolean) => {
      if (end <= first) return;
      const count = end - first;
      s.draw(organelleShader, { label, vertex, fragment, bind, indices: ib, count, first, cull, constants: { CLIP: 0 }, enabled: () => on() && plain() });
      s.draw(organelleShader, { label: `${label}.clip`, vertex, fragment, bind, indices: ib, count, first, cull, enabled: () => on() && !plain() });
    };
    // cisternae, cristae, nucleoli, droplets: always solid (the shells come first in the index buffer)
    solid('organelles', 'vs_outer', 'fs_outer', shells, solidCut, 'back', () => true, () => true);
    solid('organelles.cuttable', 'vs_outer', 'fs_outer', solidCut, all, 'back', () => true, () => !cutOn());
    // membranes: solid up close (their inner walls too), glass from afar
    solid('membranes', 'vs_outer', 'fs_outer', 0, shellCut, 'back', solidOn, solidAll);
    solid('membranes.cuttable', 'vs_outer', 'fs_outer', shellCut, shells, 'back', solidOn, whole);
    solid('membranes.inner', 'vs_inner', 'fs_inner', 0, shellCut, 'front', solidOn, solidAll);
    solid('membranes.inner.cuttable', 'vs_inner', 'fs_inner', shellCut, shells, 'front', solidOn, whole);
    s.draw(organelleShader, { label: 'organelles.cut', vertex: 'vs_cap', fragment: 'fs_cap', bind, indices: ib, count: all, cull: 'front', enabled: cutOn });
    s.draw(organelleShader, { label: 'organelles.cut.inner', vertex: 'vs_cap_inner', fragment: 'fs_cap', bind, indices: ib, count: shells, cull: 'back', enabled: cutOn });
    const add: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
    const keep: GPUBlendState = { color: { srcFactor: 'zero', dstFactor: 'one-minus-src' }, alpha: { srcFactor: 'zero', dstFactor: 'one-minus-src' } };
    r.glass.draw(organelleShader, { label: 'membranes.glass', vertex: 'vs_outer', fragment: 'fs_glass', bind, indices: ib, count: shells, cull: 'none', blend: [add, keep], depthWrite: false, enabled: glassOn });
  }
}

export const KIND_NAMES: Record<number, string> = {
  [Kind.Cell]: 'plasma membrane', [Kind.Nucleus]: 'nucleus', [Kind.Nucleolus]: 'nucleolus', [Kind.Mito]: 'mitochondrion',
  [Kind.Crista]: 'crista', [Kind.ER]: 'endoplasmic reticulum', [Kind.Golgi]: 'Golgi apparatus', [Kind.Lysosome]: 'lysosome',
  [Kind.Peroxisome]: 'peroxisome', [Kind.Endosome]: 'endosome', [Kind.Vesicle]: 'vesicle', [Kind.Droplet]: 'lipid droplet',
  [Kind.Neighbor]: 'a neighbouring cell', [Kind.NeighborNucleus]: "a neighbour's nucleus",
};
