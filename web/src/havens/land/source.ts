// The canyon as the terrain's height source: the nested levels (levels.ts) filled from canyon.ts on the CPU or from
// canyon.wgsl (through fill.wgsl) on the GPU. A HeightSource is what the terrain (the foundation's port of boulder's)
// asks for: its levels and a fill per level. The GPU one fills a whole 3072² level in milliseconds; it can also write
// each level straight into the terrain's r32float height array and an rgba8 material array (ground.wgsl's `info`,
// INFO_STEP times coarser) and hand the heights back for the CPU's copy (walking, placing things, the quadtree's
// bounds). The buffers it fills through are one level's worth, reused level by level.
import { RawItem, type Compute, type Kit, type RunItem, type StorageBuffer, type Texture } from '@ericrius1/weft';
import fillShader from './fill.wgsl';
import { canyonHeight } from './canyon';
import { INFO_STEP, LEVELS, texelCentre, texelOf, type HeightLevelSpec } from './levels';
import { CANYON_TABLES } from './tables.data';

export interface HeightSource {
  levels: HeightLevelSpec[];
  /** level `level`'s heights: px² floats, row-major, rows going south (+z), texel (i, j) at levels.ts texelCentre */
  fill(level: number, out: Float32Array): void | Promise<void>;
}

/** rows [r0, r0 + rows) of a level's heights into `out` (rows x px), on the CPU */
export function fillRows(L: HeightLevelSpec, r0: number, rows: number, out: Float32Array) {
  const t = texelOf(L);
  for (let r = 0; r < rows; r++) {
    for (let c = 0, k = r * L.px; c < L.px; c++, k++) {
      const [x, z] = texelCentre(L, c, r0 + r);
      out[k] = canyonHeight(x, z, t);
    }
  }
}

/** the canyon on the CPU, texel by texel (~1.5 s per million texels on one core: tools, tests and small refills; a
 *  whole 3072² level takes ~14 s, so the game fills on the GPU) */
export const canyonCpu: HeightSource = {
  levels: LEVELS,
  fill(level, out) { fillRows(LEVELS[level], 0, LEVELS[level].px, out); },
};

const fillUniforms = (kit: Kit) => kit.uniforms(fillShader.structs.CanyonFill, 'canyon.fill');

/** the canyon on the GPU (once its own pipelines have compiled) */
export class CanyonGpu implements HeightSource {
  /** one level's heights (f32), hints (u32, fill.wgsl) and material (rgba8 in u32), reused level by level */
  readonly heights: StorageBuffer;
  readonly hints: StorageBuffer;
  readonly info: StorageBuffer;
  /** the canyon's tables, read per texel from a buffer (tables.wgsl canyonTables) */
  readonly tables: StorageBuffer;
  /** the fill and the material, one pipeline each for every level (the levels are filled one after another, the level
   *  set into `u` before each: a pipeline a level was five compiles of a two-second shader, side by side, on the load's
   *  critical path) */
  private u: ReturnType<typeof fillUniforms>;
  private fillPass: Compute;
  private infoPass: Compute;

  constructor(readonly kit: Kit, readonly levels: HeightLevelSpec[] = LEVELS, readonly infoStep = INFO_STEP) {
    const px = Math.max(...levels.map((L) => L.px)), ipx = Math.ceil(px / infoStep);
    if (levels.some((L) => L.px !== px)) throw new Error('canyon: every level must be the same size in texels');
    this.heights = kit.storage({ label: 'canyon.heights', size: px * px * 4 });
    this.tables = kit.storage({ label: 'canyon.tables', data: CANYON_TABLES, usage: ['storage'] });
    this.hints = kit.storage({ label: 'canyon.hints', size: px * px * 4 });
    this.info = kit.storage({ label: 'canyon.info', size: ipx * ipx * 4 });
    const u = this.u = fillUniforms(kit);
    this.fillPass = kit.compute(fillShader, {
      label: 'canyon.fill', entry: 'fill', threads: [px, px],
      bind: { canyonFill: u, canyonHeights: this.heights, canyonHints: this.hints, canyonTables: this.tables },
    });
    this.infoPass = kit.compute(fillShader, {
      label: 'canyon.info', entry: 'info', threads: [px / infoStep, px / infoStep],
      bind: { canyonFill: u, canyonHeights: this.heights, canyonHints: this.hints, canyonInfo: this.info },
    });
  }

  /** the run items that fill level i, and copy it into layer i of `heightTex` (r32float, px² per layer) and of
   *  `infoTex` (rgba8unorm, (px / infoStep)² per layer) when given */
  items(i: number, heightTex?: Texture, infoTex?: Texture): RunItem[] {
    const L = this.levels[i], ipx = L.px / this.infoStep;
    // (level i's frame, written before the run that reads it: the one before has been read back by now)
    this.u.set({ centre: [L.cx, L.cz], half: L.half, texel: texelOf(L), px: L.px, infoStep: this.infoStep });
    const out: RunItem[] = [this.fillPass];
    if (heightTex) {
      out.push(new RawItem((enc) => enc.copyBufferToTexture({ buffer: this.heights.gpu, bytesPerRow: L.px * 4, rowsPerImage: L.px },
        { texture: heightTex.gpu, origin: [0, 0, i] }, [L.px, L.px, 1]), `canyon.heights${i}`));
    }
    if (infoTex) {
      out.push(this.infoPass);
      out.push(new RawItem((enc) => enc.copyBufferToTexture({ buffer: this.info.gpu, bytesPerRow: ipx * 4, rowsPerImage: ipx },
        { texture: infoTex.gpu, origin: [0, 0, i] }, [ipx, ipx, 1]), `canyon.info${i}`));
    }
    return out;
  }

  /** its own pipelines compiled — only those: kit.ready() waits for every pipeline the page has declared by then, the
   *  whole game's shaders by the time it looks again, and the canyon (the carve, the rocks, the spawn behind it) waited
   *  two to three seconds of the load on them */
  private async compiled() {
    await Promise.allSettled([this.fillPass, this.infoPass].map((c) => c.pipe.pending).filter(Boolean));
  }

  /** fill level i on the GPU and read its heights back into `out` */
  async fill(level: number, out: Float32Array) {
    const L = this.levels[level];
    await this.compiled();
    this.kit.run(this.items(level));
    out.set(new Float32Array(await this.heights.read(0, L.px * L.px * 4)));
  }

  /** fill every level into the textures (heights and material), handing each level's heights to `onLevel` as they come
   *  back for the CPU's copy; resolves with the milliseconds the GPU took */
  async fillAll(heightTex: Texture, infoTex: Texture | undefined, onLevel: (level: number, heights: Float32Array) => void): Promise<number> {
    await this.compiled();
    let ms = 0;
    for (let i = 0; i < this.levels.length; i++) {
      const L = this.levels[i], t0 = performance.now();
      this.kit.run(this.items(i, heightTex, infoTex));
      const heights = new Float32Array(await this.heights.read(0, L.px * L.px * 4));
      ms += performance.now() - t0;
      onLevel(i, heights);
    }
    return ms;
  }

  /** its buffers and passes freed (once the levels are in: a level's worth of each, ~85 MB at 3072²) */
  release() { this.kit.release(this.heights, this.hints, this.info, this.tables, this.fillPass, this.infoPass); }
}
