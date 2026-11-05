// The flora's GPU data as plain arrays (flora.ts uploads them; the GPU check in tools/gpu.ts uses the same): every
// species' variants at every level in one vertex array (8 u32 each, two vec4u) and one index array; the draw buckets
// (one per species, variant and level), each with its indirect args (index count, its instance count — counted each
// frame by floracull.wgsl — first index, base vertex, and its first instance: its place in the visible list, with room
// for every planted instance of its species and variant); the species table (floradata.wgsl FloraSp); the instances.
// `grown` is the whole catalogue in its order (growFlora()): an instance's species id is its index there.
import { INSTANCE_BYTES, packInstances, type FloraInstance } from './scatter';
import type { GrownSpecies } from './species';

/** the crossfade band before each level's end, as a share of the distance to it */
export const BAND = 0.12;
/** floats per species in the table (six vec4) */
export const SPECIES_FLOATS = 24;

export interface FloraBuffers {
  verts: Uint32Array;
  indices: Uint32Array;
  species: Float32Array;
  instances: ArrayBuffer;
  args: Uint32Array;
  /** the visible list's length (entries of two u32) */
  room: number;
  buckets: number;
  /** the buckets with anything planted in them, and those of the species that cast shadows */
  live: number[];
  casting: number[];
  vertices: number;
  triangles: number;
}

/** `meshes` false: the species' meshes left out (verts and indices empty), for a share of the planting another's
 *  meshes go with (mergeFlora) */
export function floraBuffers(grown: GrownSpecies[], plants: FloraInstance[], withMeshes = true): FloraBuffers {
  const meshes = grown.flatMap((g) => g.variants.flatMap((v) => v));
  const vcount = meshes.reduce((s, m) => s + m.vertices, 0), icount = meshes.reduce((s, m) => s + m.indices.length, 0);
  const verts = new Uint32Array(withMeshes ? vcount * 8 : 0), indices = new Uint32Array(withMeshes ? icount : 0);
  const ranges: { first: number; count: number; base: number }[] = [];
  let vo = 0, io = 0;
  for (const m of meshes) {
    if (withMeshes) {
      verts.set(m.data, vo * 8);
      indices.set(m.indices, io);
    }
    ranges.push({ first: io, count: m.indices.length, base: vo });
    vo += m.vertices; io += m.indices.length;
  }
  const buckets = ranges.length;
  const firstBucket: number[] = [];
  let b = 0;
  for (const g of grown) { firstBucket.push(b); b += g.variants.length * 3; }
  const per = new Uint32Array(buckets);
  for (const p of plants) for (let l = 0; l < 3; l++) per[firstBucket[p.species] + p.variant * 3 + l]++;
  const args = new Uint32Array(buckets * 5);
  const live: number[] = [], casting: number[] = [];
  let room = 0;
  for (let k = 0; k < buckets; k++) {
    args.set([ranges[k].count, 0, ranges[k].first, ranges[k].base, room], k * 5);
    room += per[k];
    if (per[k] > 0) {
      live.push(k);
      if (grown[firstBucket.findLastIndex((f) => f <= k)].def.shadows) casting.push(k);
    }
  }
  const species = new Float32Array(grown.length * SPECIES_FLOATS);
  const su = new Uint32Array(species.buffer);
  grown.forEach((g, i) => {
    const d = g.def, o = i * SPECIES_FLOATS;
    const reach = Math.max(...g.variants.map((v) => v[0].radius)), height = Math.max(...g.variants.map((v) => v[0].height));
    species.set([...d.wind, ...d.look, ...d.burn, d.lod[0], d.lod[1], d.lod[2], BAND, d.yields, d.hangs ? 1 : 0, reach, height], o);
    su[o + 20] = firstBucket[i]; su[o + 21] = g.variants.length;
  });
  return {
    verts, indices, species, instances: plants.length ? packInstances(plants) : new ArrayBuffer(INSTANCE_BYTES), args, room: Math.max(1, room),
    buckets, live, casting, vertices: vcount, triangles: icount / 3,
  };
}

/** shares of one planting (floraBuffers of each share's beds, the first with the meshes; `counts`: each share's
 *  plants) as one: the same buckets, their instances one after another, each bucket's room the sum of theirs */
export function mergeFlora(parts: FloraBuffers[], counts: number[]): FloraBuffers {
  const first = parts[0], n = first.buckets;
  if (parts.length === 1) return first;
  const per = new Uint32Array(n);
  parts.forEach((p, i) => {
    // (its rooms one after another: each the next's start less its own, the last the share's whole room)
    const end = counts[i] ? p.room : 0;
    for (let k = 0; k < n; k++) per[k] += (k + 1 < n ? p.args[(k + 1) * 5 + 4] : end) - p.args[k * 5 + 4];
  });
  const args = first.args.slice();
  let room = 0;
  for (let k = 0; k < n; k++) { args[k * 5 + 4] = room; room += per[k]; }
  const total = counts.reduce((a, b) => a + b, 0);
  const instances = new Uint8Array(Math.max(1, total) * INSTANCE_BYTES);
  let at = 0;
  parts.forEach((p, i) => { instances.set(new Uint8Array(p.instances, 0, counts[i] * INSTANCE_BYTES), at); at += counts[i] * INSTANCE_BYTES; });
  // (a bucket's live, or casting, wherever any share had it so)
  const union = (lists: number[][]) => [...new Set(lists.flat())].sort((a, b) => a - b);
  return {
    ...first, instances: instances.buffer, args, room: Math.max(1, room),
    live: union(parts.map((p) => p.live)), casting: union(parts.map((p) => p.casting)),
  };
}
