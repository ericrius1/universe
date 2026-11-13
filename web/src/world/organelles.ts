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
import { rel } from '../engine/origin';
import type { Vec3 } from 'math';

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
    // (only the organelles in view: the meshes are millions of triangles, made once at their finest, and a draw of all of
    // them — five times a frame, inner walls and cut faces too — is much of a close-up's frame however little shows.
    // Each draw's range of the index buffer is walked organelle by organelle, their bounding spheres against the
    // camera's frustum (once a frame), and the visible ones drawn, neighbours in the buffer as one call)
    const O = world.organelles;
    const spans = this.mesh.ranges.map(([first, count], i) => ({ first, count, o: O[i] })).filter((x) => x.count > 0).sort((a, b) => a.first - b.first);
    const seen = new Uint8Array(spans.length);
    let seenFrame = -1;
    const c: Vec3 = [0, 0, 0];
    const look = () => {
      if (seenFrame === kit.frameIndex) return;
      seenFrame = kit.frameIndex;
      for (let i = 0; i < spans.length; i++) seen[i] = kit.camera.sees(rel(spans[i].o.center, c), spans[i].o.bound) ? 1 : 0;
    };
    // (the cut faces' draws: only the organelles in view the wedge's faces cross — organelle.wgsl reachesCut — so the
    // meshes of the many it takes away whole, or never reaches, aren't drawn twice more for nothing)
    const cutSeen = new Uint8Array(spans.length);
    let cutFrame = -1;
    const lookCut = () => {
      look();
      if (cutFrame === kit.frameIndex) return;
      cutFrame = kit.frameIndex;
      const cc = g.get('cutCenter') as ArrayLike<number>, n1 = g.get('cutN1') as ArrayLike<number>, n2 = g.get('cutN2') as ArrayLike<number>;
      const R = g.get('cutRadius') as number;
      for (let i = 0; i < spans.length; i++) {
        const o = spans[i].o;
        if (!seen[i] || o.kind === Kind.Neighbor || o.kind === Kind.NeighborNucleus) { cutSeen[i] = 0; continue; }
        rel(o.center, c);
        const qx = c[0] - cc[0], qy = c[1] - cc[1], qz = c[2] - cc[2];
        const m = Math.min(qx * n1[0] + qy * n1[1] + qz * n1[2], qx * n2[0] + qy * n2[1] + qz * n2[2]);
        cutSeen[i] = Math.hypot(qx, qy, qz) - o.bound <= R && m > -o.bound && m < o.bound ? 1 : 0;
      }
    };
    const ranged = (lo: number, hi: number, cut = false) => {
      const a = spans.findIndex((x) => x.first >= lo), b = spans.findIndex((x) => x.first >= hi);
      const i0 = a < 0 ? spans.length : a, i1 = b < 0 ? spans.length : b;
      return (pe: GPURenderPassEncoder) => {
        const vis = cut ? (lookCut(), cutSeen) : (look(), seen);
        let start = -1, end = -1;
        for (let i = i0; i < i1; i++) {
          if (!vis[i]) continue;
          const x = spans[i];
          if (x.first === end) { end += x.count; continue; }
          if (end > start) pe.drawIndexed(end - start, 1, start, 0, 0);
          start = x.first; end = x.first + x.count;
        }
        if (end > start) pe.drawIndexed(end - start, 1, start, 0, 0);
      };
    };
    const solid = (label: string, vertex: string, fragment: string, first: number, end: number, cull: GPUCullMode, on: () => boolean, plain: () => boolean) => {
      if (end <= first) return;
      const encode = ranged(first, end);
      s.draw(organelleShader, { label, vertex, fragment, bind, indices: ib, cull, constants: { CLIP: 0 }, enabled: () => on() && plain(), encode });
      s.draw(organelleShader, { label: `${label}.clip`, vertex, fragment, bind, indices: ib, cull, enabled: () => on() && !plain(), encode });
    };
    // cisternae, cristae, nucleoli, droplets: always solid (the shells come first in the index buffer)
    solid('organelles', 'vs_outer', 'fs_outer', shells, solidCut, 'back', () => true, () => true);
    solid('organelles.cuttable', 'vs_outer', 'fs_outer', solidCut, all, 'back', () => true, () => !cutOn());
    // membranes: solid up close (their inner walls too), glass from afar
    solid('membranes', 'vs_outer', 'fs_outer', 0, shellCut, 'back', solidOn, solidAll);
    solid('membranes.cuttable', 'vs_outer', 'fs_outer', shellCut, shells, 'back', solidOn, whole);
    solid('membranes.inner', 'vs_inner', 'fs_inner', 0, shellCut, 'front', solidOn, solidAll);
    solid('membranes.inner.cuttable', 'vs_inner', 'fs_inner', shellCut, shells, 'front', solidOn, whole);
    // (the cut faces: only what the wedge can reach)
    const capShells = ranged(shellCut, shells, true), capSolids = ranged(solidCut, all, true);
    s.draw(organelleShader, { label: 'organelles.cut', vertex: 'vs_cap', fragment: 'fs_cap', bind, indices: ib, cull: 'front', enabled: cutOn, encode: (pe) => { capShells(pe); capSolids(pe); } });
    s.draw(organelleShader, { label: 'organelles.cut.inner', vertex: 'vs_cap_inner', fragment: 'fs_cap', bind, indices: ib, cull: 'back', enabled: cutOn, encode: capShells });
    const add: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
    const keep: GPUBlendState = { color: { srcFactor: 'zero', dstFactor: 'one-minus-src' }, alpha: { srcFactor: 'zero', dstFactor: 'one-minus-src' } };
    r.glass.draw(organelleShader, { label: 'membranes.glass', vertex: 'vs_outer', fragment: 'fs_glass', bind, indices: ib, cull: 'none', blend: [add, keep], depthWrite: false, enabled: glassOn, encode: ranged(0, shells) });
  }
}

export const KIND_NAMES: Record<number, string> = {
  [Kind.Cell]: 'plasma membrane', [Kind.Nucleus]: 'nucleus', [Kind.Nucleolus]: 'nucleolus', [Kind.Mito]: 'mitochondrion',
  [Kind.Crista]: 'crista', [Kind.ER]: 'endoplasmic reticulum', [Kind.Golgi]: 'Golgi apparatus', [Kind.Lysosome]: 'lysosome',
  [Kind.Peroxisome]: 'peroxisome', [Kind.Endosome]: 'endosome', [Kind.Vesicle]: 'vesicle', [Kind.Droplet]: 'lipid droplet',
  [Kind.Neighbor]: 'a neighbouring cell', [Kind.NeighborNucleus]: "a neighbour's nucleus",
};
