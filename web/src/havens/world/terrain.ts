// The ground: heights in nested square levels (finest first, each round its own centre, all the same size in texels)
// that a HeightSource fills on the GPU — the land's canyon (land/land.ts) — kept there (world.wgsl terrainHeight) for
// drawing and for the heightfield's shadow, with mips so a far patch reads them smoothed to its spacing
// (terrainHeightAt), and on the CPU for walking, flying and placing things (16 bits a texel over each level's own
// range: millimetres, half a float's memory); and the CDLOD quadtree (terrainpatch.wgsl) that picks which patches to
// draw each frame. The look is the land's: draw() takes its shader (one including terrainpatch.wgsl and adding its
// fragment stage) and its own extra bindings.
import type { Kit, RenderPass, Shader, StorageBuffer, Texture, UniformBuffer, Camera, V3 } from '@ericrius1/weft';
import patchShader from './terrainpatch.wgsl';
import { generateMips } from '../util/textures';

/** the nested levels' count (world.wgsl TERRAIN_LEVELS, the World uniform's terrainLevels) */
export const TERRAIN_LEVELS = 5;

/** one level: a square `half` metres each way round its centre (cx, cz), px x px texels */
export interface HeightLevel { half: number; px: number; cx: number; cz: number }

/** where the heights come from. `levels`: exactly TERRAIN_LEVELS, finest first, each inside the next, all the same px.
 *  `fill(heights, level)`: every level into the terrain's r32float array on the GPU (layer i: level i; texel (c, r) at
 *  x = cx - half + (c + 0.5) * texel, z = cz - half + (r + 0.5) * texel, texel = 2 * half / px, metres above the
 *  plaza's ground), each level's heights handed back as they come for the CPU's copy */
export interface HeightSource {
  readonly levels: HeightLevel[];
  fill(heights: Texture, level: (i: number, h: Float32Array) => void | Promise<void>): Promise<void>;
}

/** a level's heights on the CPU, as the GPU's sampler reads them: 16 bits a texel between the level's lowest and highest
 *  ground (a few millimetres a step) */
export class HeightGrid {
  readonly q: Uint16Array;
  readonly texel: number;
  /** its lowest and highest ground (m) */
  min = 0;
  max = 0;
  private step = 1e-3 / 65535;
  constructor(readonly half: number, readonly px: number, readonly cx: number, readonly cz: number) {
    this.q = new Uint16Array(px * px);
    this.texel = (2 * half) / px;
  }
  /** how far out in the level a point is (1 at its edge) */
  edge(x: number, z: number) { return Math.max(Math.abs(x - this.cx), Math.abs(z - this.cz)) / this.half; }
  /** every texel's height, from floats (the GPU's) */
  set(h: Float32Array) {
    let lo = Infinity, hi = -Infinity;
    for (const v of h) { if (v < lo) lo = v; if (v > hi) hi = v; }
    this.keep(lo, hi);
    for (let k = 0; k < h.length; k++) this.put(k, h[k]);
  }
  /** the same, a few milliseconds at a time (the page's frames between: the levels come in while it runs) */
  async setSliced(h: Float32Array, budget = 6) {
    let lo = Infinity, hi = -Infinity;
    let t = performance.now();
    const yieldIf = async () => { if (performance.now() - t > budget) { await new Promise((r) => setTimeout(r)); t = performance.now(); } };
    for (let k0 = 0; k0 < h.length; k0 += 1 << 18) {
      const k1 = Math.min(h.length, k0 + (1 << 18));
      for (let k = k0; k < k1; k++) { const v = h[k]; if (v < lo) lo = v; if (v > hi) hi = v; }
      await yieldIf();
    }
    this.keep(lo, hi);
    for (let k0 = 0; k0 < h.length; k0 += 1 << 17) {
      const k1 = Math.min(h.length, k0 + (1 << 17));
      for (let k = k0; k < k1; k++) this.put(k, h[k]);
      await yieldIf();
    }
  }
  /** texel k's height */
  at(k: number) { return this.min + this.q[k] * this.step; }
  /** texel k to a height inside the level's range (widen it first: range) */
  put(k: number, h: number) { this.q[k] = Math.round((h - this.min) / this.step); }
  /** the range widened to hold lo..hi, every texel kept at its height */
  range(lo: number, hi: number) {
    if (lo >= this.min && hi <= this.max) return;
    const was = Float32Array.from(this.q, (v) => this.min + v * this.step);
    this.keep(Math.min(lo, this.min), Math.max(hi, this.max));
    for (let k = 0; k < was.length; k++) this.put(k, was[k]);
  }
  private keep(lo: number, hi: number) {
    this.min = lo;
    this.max = hi;
    this.step = Math.max(hi - lo, 1e-3) / 65535;
  }
  /** the height at (x, z), bilinear between texel centres, clamped at the edge */
  sample(x: number, z: number) {
    const n = this.px;
    let c = (x - this.cx + this.half) / this.texel - 0.5, r = (z - this.cz + this.half) / this.texel - 0.5;
    c = Math.max(0, Math.min(n - 1.001, c));
    r = Math.max(0, Math.min(n - 1.001, r));
    const c0 = Math.floor(c), r0 = Math.floor(r), fc = c - c0, fr = r - r0;
    const d = this.q, k = r0 * n + c0;
    return this.min + ((d[k] * (1 - fc) + d[k + 1] * fc) * (1 - fr) + (d[k + n] * (1 - fc) + d[k + n + 1] * fc) * fr) * this.step;
  }
}

const ROOT = 131072;
const LEAF = 16;
const GRID = 32;
/** a patch's quads: its grid's and its skirt's round them */
const QUADS = (GRID + 2) * (GRID + 2);
const MAX_NODES = 2048;

export class Terrain {
  readonly heightTex: Texture;
  readonly levels: HeightGrid[];
  readonly u: UniformBuffer<any>;
  readonly nodes: StorageBuffer;
  private ibuf: StorageBuffer;
  private nodeData = new Float32Array(MAX_NODES * 4);
  nodeCount = 0;
  range0 = LEAF * 2.6;
  morphStart = 0.62;
  private bounds = new Map<string, [number, number]>();
  private levelsCount = Math.round(Math.log2(ROOT / LEAF));
  /** the heights are in (heightAt works, and the ground can be drawn) */
  readonly ready: Promise<void>;
  /** called when the heights change (new heights, an edit): what stands on the ground or shades it updates */
  onChange: (() => void)[] = [];

  private constructor(readonly kit: Kit, source: HeightSource) {
    const L = source.levels;
    if (L.length !== TERRAIN_LEVELS) throw new Error(`terrain: ${L.length} levels, not ${TERRAIN_LEVELS}`);
    const px = L[0].px;
    if (L.some((l) => l.px !== px)) throw new Error('terrain: every level must be the same size in texels');
    this.levels = L.map((l) => new HeightGrid(l.half, px, l.cx, l.cz));
    this.heightTex = kit.texture({ label: 'terrain.heights', format: 'r32float', size: [px, px, TERRAIN_LEVELS], mips: 'full', view: '2d-array' });
    this.u = kit.uniforms(patchShader.structs.TerrainU, 'terrain');
    this.u.set({ grid: [GRID, this.range0, this.morphStart, 6371000] });
    this.nodes = kit.storage({ label: 'terrain.nodes', size: MAX_NODES * 16 });
    // (the patch's grid inside a ring of its skirt's vertices: terrainpatch.wgsl)
    const W = GRID + 3, idx = new Uint32Array(QUADS * 6);
    let o = 0;
    for (let z = 0; z < W - 1; z++) for (let x = 0; x < W - 1; x++) {
      const a = z * W + x, b = a + 1, c = a + W, d = c + 1;
      // alternate the diagonals so the patch has no directional bias
      if ((x + z) & 1) { idx.set([a, c, b, b, c, d], o); } else { idx.set([a, c, d, a, d, b], o); }
      o += 6;
    }
    this.ibuf = kit.storage({ label: 'terrain.index', data: idx, usage: ['index', 'copy-dst'] });
    this.ready = this.load(source);
  }

  /** the ground from a source: drawable and shareable at once, its heights in when `ready` resolves */
  static create(kit: Kit, source: HeightSource) { return new Terrain(kit, source); }

  /** every level's heights from a source (the same levels' layout), on the GPU and the CPU */
  async load(source: HeightSource) {
    await source.fill(this.heightTex, (i, h) => this.levels[i].setSliced(h));
    this.changed();
  }

  /** the World uniform's terrain fields: each level's [half, texel, cx, cz], and the highest and lowest ground */
  get world() {
    return {
      terrainLevels: this.levels.map((L) => [L.half, L.texel, L.cx, L.cz]) as never,
      ground: [Math.max(...this.levels.map((L) => L.max)), Math.min(...this.levels.map((L) => L.min)), 0, 0] as [number, number, number, number],
    };
  }

  /** a local change to the ground (a terrace graded, a crater): every level's texels in the box (world x0, z0, x1, z1)
   *  get a new height from their old (f is told the level too), on the CPU and the GPU */
  edit(box: [number, number, number, number], f: (x: number, z: number, h: number, level: number) => number) {
    this.levels.forEach((L, i) => {
      const n = L.px;
      const col = (x: number) => (x - L.cx + L.half) / L.texel - 0.5, row = (z: number) => (z - L.cz + L.half) / L.texel - 0.5;
      const c0 = Math.max(0, Math.floor(col(box[0]))), c1 = Math.min(n - 1, Math.ceil(col(box[2])));
      const r0 = Math.max(0, Math.floor(row(box[1]))), r1 = Math.min(n - 1, Math.ceil(row(box[3])));
      if (c1 < c0 || r1 < r0) return;
      const w = c1 - c0 + 1, h = r1 - r0 + 1, out = new Float32Array(w * h);
      let lo = Infinity, hi = -Infinity;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const v = f(L.cx + (c + 0.5) * L.texel - L.half, L.cz + (r + 0.5) * L.texel - L.half, L.at(r * n + c), i);
        out[(r - r0) * w + (c - c0)] = v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      L.range(lo, hi);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) L.put(r * n + c, out[(r - r0) * w + (c - c0)]);
      this.heightTex.write(out, { layer: i, origin: [c0, r0], width: w, height: h });
    });
    this.changed();
  }

  private changed() {
    generateMips(this.kit, this.heightTex);
    this.bounds.clear();
    for (const f of this.onChange) f();
  }

  /** metres above the plaza's ground at (x, z): the finest level holding the point, blended into the next coarser over
   *  its outer 15% (as world.wgsl's terrainHeight) */
  heightAt(x: number, z: number): number { return this.blendOut(0, x, z); }

  private blendOut(i: number, x: number, z: number): number {
    const L = this.levels, last = L.length - 1;
    while (i < last && L[i].edge(x, z) >= 1) i++;
    const h = L[i].sample(x, z);
    if (i === last) return h;
    const t = smooth(0.85, 0.98, L[i].edge(x, z));
    return t > 0 ? h * (1 - t) + this.blendOut(i + 1, x, z) * t : h;
  }

  normalAt(x: number, z: number, eps = 0.5): V3 {
    const hx = this.heightAt(x + eps, z) - this.heightAt(x - eps, z);
    const hz = this.heightAt(x, z + eps) - this.heightAt(x, z - eps);
    const l = Math.hypot(hx, 2 * eps, hz);
    return [-hx / l, (2 * eps) / l, -hz / l];
  }

  /** a node's height range (sampled 5x5 with a margin, cached) */
  private nodeBounds(x0: number, z0: number, size: number): [number, number] {
    const key = `${x0},${z0},${size}`;
    let b = this.bounds.get(key);
    if (!b) {
      let lo = Infinity, hi = -Infinity;
      for (let j = 0; j <= 4; j++) for (let i = 0; i <= 4; i++) {
        const h = this.heightAt(x0 + (size * i) / 4, z0 + (size * j) / 4);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      const m = 2 + size * 0.04;
      b = [lo - m, hi + m];
      if (this.bounds.size > 50000) this.bounds.clear();
      this.bounds.set(key, b);
    }
    return b;
  }

  /** choose this frame's patches for a camera (frustum-culled unless `all`) */
  select(cam: Camera, all = false) {
    const p = cam.position;
    let n = 0;
    const data = this.nodeData;
    const range = (L: number) => this.range0 * 2 ** L;
    const visit = (x0: number, z0: number, size: number, L: number) => {
      if (n >= MAX_NODES) return;
      const [lo, hi] = this.nodeBounds(x0, z0, size);
      const cx = x0 + size / 2, cz = z0 + size / 2, cy = (lo + hi) / 2;
      const rad = Math.hypot(size / 2, size / 2, (hi - lo) / 2);
      const sag = size > 4000 ? size * size / 8 / 6371000 : 0;
      if (!all && !cam.sees([cx, cy - sag, cz], rad + sag)) return;
      // does the sphere of the finer level's range reach this node's box?
      const dx = Math.max(x0 - p[0], 0, p[0] - (x0 + size));
      const dy = Math.max(lo - p[1], 0, p[1] - hi);
      const dz = Math.max(z0 - p[2], 0, p[2] - (z0 + size));
      const dist = Math.hypot(dx, dy, dz);
      if (L === 0 || dist > range(L - 1)) {
        data.set([x0, z0, size, L], n * 4);
        n++;
        return;
      }
      const h = size / 2;
      visit(x0, z0, h, L - 1); visit(x0 + h, z0, h, L - 1); visit(x0, z0 + h, h, L - 1); visit(x0 + h, z0 + h, h, L - 1);
    };
    visit(-ROOT / 2, -ROOT / 2, ROOT, this.levelsCount);
    this.nodeCount = n;
    this.nodes.write(data.subarray(0, n * 4));
    return n;
  }

  /** the ground drawn into a pass by `shader` (one including terrainpatch.wgsl) with its own bindings besides T and
   *  nodes */
  draw(pass: RenderPass, shader: Shader, bind: Record<string, unknown> = {}, constants: Record<string, number> = {}) {
    return pass.draw(shader, {
      label: 'terrain', count: QUADS * 6, instances: () => this.nodeCount, constants,
      indices: { buffer: this.ibuf, format: 'uint32' }, cull: 'back', bind: { T: this.u, nodes: this.nodes, ...bind } as never,
    });
  }
}

function smooth(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
