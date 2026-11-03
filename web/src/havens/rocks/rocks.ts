// The rocks on the GPU: every prototype's levels of detail packed into one vertex array and one index array (pack.ts),
// the placed field's instances in a storage array, and each frame the visible ones sorted by prototype and level of
// detail into a list (rockdata.wgsl). A rock's level comes from how big it looks (its bounding sphere over its
// distance); too small and it isn't drawn; outside the view it isn't drawn. The view's list and one per shadow cascade
// (by distance alone, coarser, the smallest left out of the far cascades) share the one list buffer. Rocks draw with
// rocks.wgsl, crystals with crystal.wgsl, both opaque; both cast shadows through rockdata.wgsl's vsShadow.
//   const cat = await catalogInWorker();                 // or buildCatalog() (catalog.ts), ~0.7 s of CPU
//   const field = placeRocks(cat, ground);               // place.ts: the land's heightAt / slopeAt
//   const tex = { strata, flutes, sand };                // sandstone_strata, cliff_flutes, desert_sand (sRGB, with
//                                                        //   mips): the land's own (land.ts layer), or loaded alone
//   const rocks = new Rocks(kit, cat, field, tex);       // after kit.shareGroup(WORLD_GROUP, ...)
//   order.into('rocks', () => rocks.draw(scene));
//   shadows.passes.forEach((p, i) => rocks.drawShadow(p, i));
//   each frame, once the camera's matrices are updated: rocks.update(camera);
import type { Camera, Kit, RenderPass, StorageBuffer, TexView, Texture, V3 } from '@ericrius1/weft';
import crystalShader from './crystal.wgsl';
import rockShader from './rocks.wgsl';
import type { Catalog } from './catalog';
import { CRYSTAL_LOOK, ROCK_LOOK } from './look';
import { packRocks, type Range } from './pack';
import type { Field } from './place';

export interface RockTextures { strata: Texture | TexView; flutes: Texture | TexView; sand: Texture | TexView }

/** how big a rock must look (bounding radius over distance) for each level of detail (a prototype with fewer levels
 *  keeps its coarsest); smaller isn't drawn */
const LOD_SIZE = [0.07, 0.02, 0.0065, 0.0025];
const LEVELS = LOD_SIZE.length;
/** how far from the camera (m, past a rock's own radius) each shadow cascade takes casters, and the smallest a caster
 *  may look to be taken */
const SHADOW_REACH = [40, 90, 220, 560];
const SHADOW_SIZE = [0, 0.004, 0.008, 0.012];
/** the rocks binned in squares of the ground this wide (m): a frame passes over a square none of whose rocks could be
 *  drawn or cast whole (a few hundred of the ~16,500 are ever in a list at once; each was looked at every frame) */
const CELL = 96;

/** the stone's look and the crystals' (look.ts; the '/' panel can tweak these: rocks.wgsl RockU, crystal.wgsl CrystalU) */
const rockLook = (kit: Kit) => kit.uniforms(rockShader.structs.RockU, 'rocks').set(ROCK_LOOK);
const crystalLook = (kit: Kit) => kit.uniforms(crystalShader.structs.CrystalU, 'crystals').set(CRYSTAL_LOOK);

/** the catalogue built off the main thread (rocks.worker.ts) */
export function catalogInWorker(): Promise<Catalog> {
  const w = new Worker(new URL('./rocks.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    w.onmessage = (e: MessageEvent<Catalog>) => { resolve(e.data); w.terminate(); };
    w.onerror = (e) => { reject(new Error(e.message)); w.terminate(); };
    w.postMessage(null);
  });
}

export class Rocks {
  readonly rockU: ReturnType<typeof rockLook>;
  readonly crystalU: ReturnType<typeof crystalLook>;
  private verts: StorageBuffer;
  private idx: StorageBuffer;
  private insts: StorageBuffer;
  private vis: StorageBuffer;
  private recs: StorageBuffer;
  /** per prototype, per level: its index range and base vertex */
  private ranges: Range[][];
  private isCrystal: boolean[];
  /** per instance: its bounding sphere (centre, radius) and prototype */
  private sphere: Float32Array;
  private protoOf: Uint16Array;
  /** this frame's lists: per list (0 the view, 1..4 the cascades) the draws [prototype, level, first, count] */
  private lists: number[][] = [[], [], [], [], []];
  private visData: Uint32Array;
  private bucket: Int32Array;
  /** each list's count and next free place per prototype and level, and a point to ask the frustum about (reused every
   *  frame: nothing is allocated per rock) */
  private counts: Int32Array;
  private starts: Int32Array;
  private at: V3 = [0, 0, 0];
  /** the squares: their rocks' indices square after square, where each square's run starts, a sphere round each
   *  square's rocks (centre, radius) and the largest rock's radius; and this frame's rocks in squares that could count */
  private cellOrder: Int32Array;
  private cellStart: Int32Array;
  private cellSphere: Float32Array;
  private cellR: Float32Array;
  private live: Int32Array;
  /** triangles in the view this frame (for the stats) */
  triangles = 0;
  /** rocks drawn in the view this frame */
  drawn = 0;

  constructor(kit: Kit, readonly cat: Catalog, readonly field: Field, private tex: RockTextures) {
    const k = packRocks(cat, field.rocks);
    const N = field.rocks.length;
    this.ranges = k.ranges;
    this.isCrystal = k.isCrystal;
    this.sphere = k.sphere;
    this.protoOf = k.protoOf;
    this.visData = new Uint32Array(Math.max(1, N * 5));
    this.bucket = new Int32Array(N * 5);
    this.counts = new Int32Array(5 * cat.protos.length * LEVELS);
    this.starts = new Int32Array(5 * cat.protos.length * LEVELS);
    const S = this.sphere, cells = new Map<number, number[]>();
    for (let i = 0; i < N; i++) {
      const k = (Math.floor(S[i * 4] / CELL) + 32768) * 65536 + Math.floor(S[i * 4 + 2] / CELL) + 32768;
      const c = cells.get(k);
      if (c) c.push(i); else cells.set(k, [i]);
    }
    this.cellOrder = new Int32Array(N);
    this.cellStart = new Int32Array(cells.size + 1);
    this.cellSphere = new Float32Array(cells.size * 4);
    this.cellR = new Float32Array(cells.size);
    this.live = new Int32Array(N);
    let at = 0, ci = 0;
    for (const ids of cells.values()) {
      // (the box round the square's rocks, whole: a sphere round it holds every one)
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      let rMax = 0;
      this.cellStart[ci] = at;
      for (const i of ids) {
        const r = S[i * 4 + 3];
        for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], S[i * 4 + a] - r); hi[a] = Math.max(hi[a], S[i * 4 + a] + r); }
        rMax = Math.max(rMax, r);
        this.cellOrder[at++] = i;
      }
      for (let a = 0; a < 3; a++) this.cellSphere[ci * 4 + a] = (lo[a] + hi[a]) / 2;
      this.cellSphere[ci * 4 + 3] = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
      this.cellR[ci++] = rMax;
    }
    this.cellStart[ci] = at;
    this.verts = kit.storage({ label: 'rocks.verts', data: new Uint8Array(k.verts) });
    this.idx = kit.storage({ label: 'rocks.idx', data: k.idx, usage: ['index', 'copy-dst'] });
    this.insts = kit.storage({ label: 'rocks.insts', data: k.insts });
    this.vis = kit.storage({ label: 'rocks.vis', size: this.visData.byteLength });
    this.recs = kit.storage({ label: 'rocks.crystals', data: k.recs });
    this.rockU = rockLook(kit);
    this.crystalU = crystalLook(kit);
  }

  /** this frame's levels of detail and lists, for a camera that has just moved (its frustum planes current) */
  update(cam: Camera) {
    const S = this.sphere, N = this.protoOf.length, P = this.cat.protos.length, G = P * LEVELS;
    const [cx, cy, cz] = cam.position;
    const fov = Math.tan(cam.fovY / 2) / Math.tan(Math.PI / 6);
    // each instance's level per list (-1 not in it), counted into its prototype's bucket
    const counts = this.counts, q = this.at;
    counts.fill(0);
    this.triangles = 0; this.drawn = 0;
    const C = this.cellR.length, CS = this.cellSphere, live = this.live;
    let M = 0;
    for (let ci = 0; ci < C; ci++) {
      // (the nearest any of the square's rocks can be, and so the biggest any can look: too small to draw anywhere or
      // out of the view, and past every cascade's reach or too small for it, the square is passed over)
      const ex = CS[ci * 4] - cx, ey = CS[ci * 4 + 1] - cy, ez = CS[ci * 4 + 2] - cz, rMax = this.cellR[ci];
      const dMin = Math.max(1, Math.sqrt(ex * ex + ey * ey + ez * ez) - CS[ci * 4 + 3]), big = rMax / dMin;
      q[0] = CS[ci * 4]; q[1] = CS[ci * 4 + 1]; q[2] = CS[ci * 4 + 2];
      let may = big / fov > LOD_SIZE[LEVELS - 1] && cam.sees(q, CS[ci * 4 + 3]);
      for (let c = 0; c < 4 && !may; c++) may = dMin - rMax < SHADOW_REACH[c] && big > SHADOW_SIZE[c];
      if (!may) continue;
      for (let j = this.cellStart[ci]; j < this.cellStart[ci + 1]; j++) live[M++] = this.cellOrder[j];
    }
    for (let m = 0; m < M; m++) {
      const i = live[m];
      const x = S[i * 4], y = S[i * 4 + 1], z = S[i * 4 + 2], r = S[i * 4 + 3];
      const dx = x - cx, dy = y - cy, dz = z - cz;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
      const size = (r / d) * (1 / fov);
      const p = this.protoOf[i];
      let lod = -1;
      for (let k = 0; k < LOD_SIZE.length; k++) if (size > LOD_SIZE[k]) { lod = k; break; }
      if (lod >= 0) lod = Math.min(lod, this.ranges[p].length - 1);
      q[0] = x; q[1] = y; q[2] = z;
      const view = lod >= 0 && cam.sees(q, r) ? lod : -1;
      this.bucket[i] = view;
      if (view >= 0) counts[p * LEVELS + view]++;
      for (let c = 0; c < 4; c++) {
        const inC = d - r < SHADOW_REACH[c] && r / d > SHADOW_SIZE[c] ? Math.min(Math.max(lod, c >= 2 ? 1 : 0), this.ranges[p].length - 1) : -1;
        this.bucket[(c + 1) * N + i] = inC;
        if (inC >= 0) counts[(c + 1) * G + p * LEVELS + inC]++;
      }
    }
    // the lists: draws in prototype order, their instances packed one draw after another
    let at = 0;
    const st = this.starts;
    this.lists.forEach((list, li) => {
      list.length = 0;
      for (let g = 0; g < G; g++) {
        const n = counts[li * G + g];
        if (!n) continue;
        st[li * G + g] = at;
        list.push(Math.floor(g / LEVELS), g % LEVELS, at, n);
        at += n;
      }
    });
    for (let li = 0; li < 5; li++) {
      for (let m = 0; m < M; m++) {
        const i = live[m], l = this.bucket[li * N + i];
        if (l < 0) continue;
        this.visData[st[li * G + this.protoOf[i] * LEVELS + l]++] = i;
      }
    }
    if (at) this.vis.write(this.visData.subarray(0, at));
    const v = this.lists[0];
    for (let k = 0; k < v.length; k += 4) { this.drawn += v[k + 3]; this.triangles += (this.ranges[v[k]][v[k + 1]].count / 3) * v[k + 3]; }
  }

  /** a list's draws of rocks (crystal: false) or crystals (true) */
  private encode(pe: GPURenderPassEncoder, list: number, crystal: boolean | null) {
    const L = this.lists[list];
    for (let k = 0; k < L.length; k += 4) {
      const p = L[k];
      if (crystal !== null && this.isCrystal[p] !== crystal) continue;
      const r = this.ranges[p][L[k + 1]];
      pe.drawIndexed(r.count, L[k + 3], r.first, r.base, L[k + 2]);
    }
  }

  /** the rocks, then the crystals, into the scene */
  draw(pass: RenderPass) {
    const data = { rockVerts: this.verts, rockInsts: this.insts, rockVis: this.vis };
    pass.draw(rockShader, {
      label: `${pass.label}.rocks`, vertex: 'vs', fragment: 'fs', cull: 'back', indices: { buffer: this.idx, format: 'uint32' },
      bind: { ...data, RU: this.rockU, strataTex: this.tex.strata, flutesTex: this.tex.flutes, sandTex: this.tex.sand },
      enabled: () => this.lists[0].length > 0, encode: (pe) => this.encode(pe, 0, false),
    });
    pass.draw(crystalShader, {
      label: `${pass.label}.crystals`, vertex: 'vs', fragment: 'fs', cull: 'back', indices: { buffer: this.idx, format: 'uint32' },
      bind: { ...data, CU: this.crystalU, crystalRecs: this.recs },
      enabled: () => this.lists[0].length > 0, encode: (pe) => this.encode(pe, 0, true),
    });
  }

  /** the casters within a shadow cascade's reach, rocks and crystals together */
  drawShadow(pass: RenderPass, cascade: number) {
    pass.draw(rockShader, {
      label: `${pass.label}.rocks`, vertex: 'vsShadow', fragment: null, cull: 'none', indices: { buffer: this.idx, format: 'uint32' },
      bind: { rockVerts: this.verts, rockInsts: this.insts, rockVis: this.vis },
      enabled: () => this.lists[cascade + 1].length > 0, encode: (pe) => this.encode(pe, cascade + 1, null),
    });
  }
}
