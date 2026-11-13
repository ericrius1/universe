// The molecular field's CPU half: each frame it picks the ladder of chunk sizes for the zoom, finds the filament
// segments near the focus (a grid built once), uploads the app's actors, and runs field.wgsl's passes — clear, crowd,
// lattice, actors, finish — before the scene; the scene then draws every (type, level of detail) list with one
// indirect draw each. Densities and compositions come from molecules.ts.
import type { Kit, StorageBuffer, UniformBuffer } from '@ericrius1/weft';
import { StructArray } from '@ericrius1/weft';
import type { Vec3 } from 'math';
import fieldShader from '../../shaders/field.wgsl';
import beadShader from '../../shaders/beads.wgsl';
import molShader from '../../shaders/molecules.wgsl';
import type { Renderer } from '../engine/renderer';
import { COMPARTMENTS, COMPOSITION, DENSITY, MEMBRANE, MOL, MOLS, type Molecules } from './molecules';
import type { FilamentSet } from './filaments';
import { FilKind } from './layout';
import { rel } from '../engine/origin';

const CAP = 16384;
const NLISTS = MOLS.length * 3;
const ROW = 12;
const ROWS = 32;
const MAX_ACTORS = 4096;
/** the finest chunk (nm): with K molecules each, as dense as a real cytoplasm (~3 per 1000 nm³) */
const C0 = 19;
const GRID = 1500;
/** chromatin's nucleosomes outlast the rest of the lattice (molecules while they're big on screen: world.wgsl
 *  nucleosome), till the view is this wide (nm) */
const CHROMATIN_MAX = 12000;
/** the furthest round the focus the other filaments are decorated with their molecules (nm) */
const LATTICE_MAX = 2000;

export class Field {
  readonly F: UniformBuffer<any>;
  readonly actors: StructArray<any>;
  actorCount = 0;
  private segList: StorageBuffer;
  private actorBuf: StorageBuffer;
  private counts: StorageBuffer;
  private segCount = 0;
  private total = 0;
  private grid = new Map<string, number[]>();
  private segIds: Uint32Array;
  /** every chromatin segment: always the start of the list (world.wgsl nucMolecule picks the nucleosomes to make), the
   *  lattice's other segments near the focus after them */
  private chromatin: Uint32Array;
  private kinds: Uint32Array;
  /** molecules per chunk: the density/cost dial */
  perChunk: number;
  /** the least radius (nm) it's made out to round the focus, whatever the zoom: a film's (src/loop.ts) — close in, the
   *  crowd is there already, in the haze, rather than made as the zoom comes out to it */
  minRadius = 0;
  /** a film's (src/loop.ts): how many levels later the finer crowd thins out (molecules go when smaller on screen, at the
   *  cost of more of them), the most chunks a side a level is made over, and molecules kept from the lens by their own
   *  size rather than a share of the view (emit) */
  lag = 0;
  chunksMax = 20;
  nearByRadius = false;
  maxInst: number;
  /** stats for the HUD */
  instances = 0;

  constructor(private kit: Kit, r: Renderer, readonly mols: Molecules, private fil: FilamentSet, quality: number) {
    const k = kit;
    this.perChunk = quality >= 1 ? 14 : 8;
    this.maxInst = quality >= 1 ? 196608 : 65536;
    this.F = k.uniforms(fieldShader.structs.Field, 'field');
    const insts = k.storage({ label: 'mol.insts', size: this.maxInst * 48 });
    const lists = k.storage({ label: 'mol.lists', size: NLISTS * CAP * 4 });
    const counts = (this.counts = k.storage({ label: 'mol.counts', size: (NLISTS + 1) * 4 }));
    const args = k.storage({ label: 'mol.args', size: NLISTS * 16, usage: ['storage', 'indirect', 'copy-dst', 'copy-src'] });
    const kinds = (this.kinds = new Uint32Array(fil.data.buffer, fil.data.byteOffset, fil.data.length));
    this.chromatin = Uint32Array.from({ length: fil.count }, (_, s) => s).filter((s) => kinds[s * 12 + 8] === FilKind.Chromatin);
    this.segList = k.storage({ label: 'mol.segList', size: fil.count * 4 });
    this.segList.write(this.chromatin);
    this.segIds = new Uint32Array(fil.count - this.chromatin.length);
    this.actors = new StructArray(molShader.structs.Inst, MAX_ACTORS);
    this.actorBuf = k.storage({ label: 'mol.actors', size: MAX_ACTORS * 48 });
    const segs = k.storage({ label: 'mol.segs', data: fil.data, stride: 48 });
    const { comps, meta } = this.compositions();

    const bind = { types: mols.typeTable, insts, lists, counts, args, F: this.F, comps, compMeta: meta, segs, segList: this.segList, actorIn: this.actorBuf };
    const clear = k.compute(fieldShader, { label: 'field.clear', entry: 'clear', bind: { counts }, threads: [NLISTS + 1] });
    const crowd = k.compute(fieldShader, { label: 'field.crowd', entry: 'crowd', bind, threads: () => [this.total], enabled: () => this.total > 0 });
    const lattice = k.compute(fieldShader, { label: 'field.lattice', entry: 'lattice', bind, threads: () => [this.segCount], enabled: () => this.segCount > 0 });
    const actors = k.compute(fieldShader, { label: 'field.actors', entry: 'actors', bind, threads: () => [this.actorCount], enabled: () => this.actorCount > 0 });
    const finish = k.compute(fieldShader, { label: 'field.finish', entry: 'finish', bind: { types: mols.typeTable, counts, args }, threads: [NLISTS] });
    r.before.push(clear, crowd, lattice, actors, finish);

    if (!k.features.has('indirect-first-instance')) console.warn('cell: no indirect-first-instance — molecules will not draw correctly');
    // (each bead twice: its depth first of all in the scene — so what it hides isn't shaded either — then lit where it's
    // the nearest, renderer.ts beads)
    const beadBind = { types: mols.typeTable, insts, lists, beads: mols.beads, beadInfo: mols.beadInfo };
    const encode = (pe: GPURenderPassEncoder) => { for (let i = 0; i < NLISTS; i++) pe.drawIndirect(args.gpu, i * 16); };
    r.scene.draw(beadShader, { label: 'molecules.depth', vertex: 'vs_depth', fragment: 'fs_depth', bind: beadBind, cull: 'none', encode });
    r.scene.draws.unshift(r.scene.draws.pop()!);
    r.beads.draw(beadShader, { label: 'molecules', vertex: 'vs', fragment: 'fs', bind: { ...beadBind, beadDepth: r.depth }, cull: 'none', depthWrite: false, encode });

    // the filament segments that carry molecules, bucketed for the per-frame search
    const d = fil.data, u = new Uint32Array(d.buffer, d.byteOffset, d.length);
    for (let i = 0; i < fil.count; i++) {
      const o = i * 12, kind = u[o + 8];
      if (kind !== FilKind.Microtubule && kind !== FilKind.Actin && kind !== FilKind.Chromatin) continue;
      const key = `${Math.floor((d[o] + d[o + 4]) / 2 / GRID)},${Math.floor((d[o + 1] + d[o + 5]) / 2 / GRID)},${Math.floor((d[o + 2] + d[o + 6]) / 2 / GRID)}`;
      let l = this.grid.get(key);
      if (!l) this.grid.set(key, (l = []));
      l.push(i);
    }
  }

  private compositions() {
    const comps = new ArrayBuffer(ROWS * ROW * 8), cu = new Uint32Array(comps), cf = new Float32Array(comps);
    const meta = new Float32Array(ROWS * 4);
    const fill = (row: number, mols: [string, number][], density: number, offset: number) => {
      const sum = mols.reduce((a, m) => a + m[1], 0);
      let acc = 0;
      mols.slice(0, ROW).forEach(([name, w], i) => {
        acc += w / sum;
        cu[(row * ROW + i) * 2] = MOL[name as keyof typeof MOL];
        cf[(row * ROW + i) * 2 + 1] = acc;
      });
      meta.set([Math.min(1, density), Math.min(ROW, mols.length), offset, 0], row * 4);
    };
    COMPARTMENTS.forEach((c, i) => fill(i, COMPOSITION[c], DENSITY[c], 0));
    for (const [kind, m] of Object.entries(MEMBRANE)) fill(16 + Number(kind), m!.mols, m!.density, m!.offset);
    return { comps: this.kit.storage({ label: 'mol.comps', data: new Uint8Array(comps) }), meta: this.kit.storage({ label: 'mol.compMeta', data: meta }) };
  }

  /** what the last frame made, read back (a check, not for every frame): instances in all, and the fullest
   *  (type, level) list — one past CAP drops the rest */
  async stats() {
    const c = new Uint32Array(await this.counts.read());
    let fullest = 0, over = 0, which = 0;
    for (let i = 0; i < NLISTS; i++) { if (c[i] > fullest) { fullest = c[i]; which = i; } if (c[i] > CAP) over++; }
    return { insts: c[NLISTS], maxInst: this.maxInst, fullest, of: `${MOLS[Math.floor(which / 3)]} lod${which % 3}`, cap: CAP, over, segs: this.segCount };
  }

  /** set up this frame's generation round the focus at the camera's scale (absolute positions: the chunks are found
   *  by them, the GPU gets them relative to the origin) */
  update(focus: Vec3, eye: Vec3, scale: number, pxAngle: number) {
    const R = Math.max(scale * 2.6, this.minRadius);
    const level = Math.max(0, Math.log2((0.65 * scale) / C0) - this.lag);
    const base = Math.floor(level);
    const K = this.perChunk;
    const lv: number[][] = [], lf: number[] = [], starts: number[] = [];
    let total = 0;
    // (beyond ~20 µm no molecule is a pixel: the crowd rests)
    const crowdOn = scale < 20000;
    for (let i = 0; i < 4; i++) {
      const L = base + i, cL = C0 * Math.pow(2, L);
      const n = Math.min(this.chunksMax, Math.floor((2 * R) / cL) + 2);
      lv.push([Math.floor((focus[0] - R) / cL), Math.floor((focus[1] - R) / cL), Math.floor((focus[2] - R) / cL), n]);
      lf.push(L);
      starts.push(total);
      if (crowdOn) total += n * n * n * K;
    }
    this.total = total;
    // filament segments near the focus, when their molecules are big enough to see — after chromatin's, all of them,
    // while its nucleosomes might be
    const latticeOn = Math.min(1, Math.max(0, (2600 - scale) / 1400));
    let n = 0;
    // (out to 2 µm at most: further, a microtubule's tubulin would be bumps on its tube, and too many of them)
    const RL = Math.min(R, LATTICE_MAX);
    if (latticeOn > 0) {
      const g = GRID, cx = Math.floor(focus[0] / g), cy = Math.floor(focus[1] / g), cz = Math.floor(focus[2] / g);
      const reach = Math.ceil(RL / g) + 1;
      const d = this.fil.data;
      outer: for (let x = cx - reach; x <= cx + reach; x++) for (let y = cy - reach; y <= cy + reach; y++) for (let z = cz - reach; z <= cz + reach; z++) {
        const l = this.grid.get(`${x},${y},${z}`);
        if (!l) continue;
        for (const s of l) {
          const o = s * 12;
          if (this.kinds[o + 8] === FilKind.Chromatin) continue;
          // (the focus's distance to the segment itself, not its middle: a long one passing right by counts)
          const ax = d[o + 4] - d[o], ay = d[o + 5] - d[o + 1], az = d[o + 6] - d[o + 2];
          const px = focus[0] - d[o], py = focus[1] - d[o + 1], pz = focus[2] - d[o + 2];
          const u = Math.max(0, Math.min(1, (px * ax + py * ay + pz * az) / Math.max(1e-9, ax * ax + ay * ay + az * az)));
          if (Math.hypot(px - ax * u, py - ay * u, pz - az * u) - d[o + 11] > RL) continue;
          this.segIds[n++] = s;
          if (n >= this.segIds.length) break outer;
        }
      }
      if (n) this.segList.write(this.segIds.subarray(0, n), this.chromatin.length * 4);
    }
    this.segCount = scale < CHROMATIN_MAX ? this.chromatin.length + n : 0;
    if (this.actorCount) this.actorBuf.write(new Uint8Array(this.actors.data, 0, this.actorCount * this.actors.stride));
    const P = this.kit.camera.planes;
    const pl = (i: number) => [P[i * 4], P[i * 4 + 1], P[i * 4 + 2], P[i * 4 + 3]];
    this.F.set({
      focus: rel(focus), radius: R, camPos: rel(eye), clear: scale * 0.42, level, c0: C0, perChunk: K, maxInst: this.maxInst,
      lv0: lv[0], lv1: lv[1], lv2: lv[2], lv3: lv[3], lf, starts, total, segCount: this.segCount, actorCount: this.actorCount,
      seed: 7, pxAngle, lod0: 34, lod1: 9, cull: 0.45,
      p0: pl(0), p1: pl(1), p2: pl(2), p3: pl(3), p4: pl(4), p5: pl(5), latticeOn, wobble: 0.18, latticeR: RL, nearByRadius: this.nearByRadius ? 1 : 0,
    });
  }
}
