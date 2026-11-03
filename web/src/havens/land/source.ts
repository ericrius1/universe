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

/** the canyon on the GPU (after kit.ready(): the fill's pipelines compile with the rest) */
export class CanyonGpu implements HeightSource {
  /** one level's heights (f32), hints (u32, fill.wgsl) and material (rgba8 in u32), reused level by level */
  readonly heights: StorageBuffer;
  readonly hints: StorageBuffer;
  readonly info: StorageBuffer;
  private fills: Compute[] = [];
  private infos: Compute[] = [];

  constructor(readonly kit: Kit, readonly levels: HeightLevelSpec[] = LEVELS, readonly infoStep = INFO_STEP) {
    const px = Math.max(...levels.map((L) => L.px)), ipx = Math.ceil(px / infoStep);
    this.heights = kit.storage({ label: 'canyon.heights', size: px * px * 4 });
    this.hints = kit.storage({ label: 'canyon.hints', size: px * px * 4 });
    this.info = kit.storage({ label: 'canyon.info', size: ipx * ipx * 4 });
    levels.forEach((L, i) => {
      const u = kit.uniforms(fillShader.structs.CanyonFill, `canyon.fill${i}`);
      u.set({ centre: [L.cx, L.cz], half: L.half, texel: texelOf(L), px: L.px, infoStep });
      this.fills.push(kit.compute(fillShader, {
        label: `canyon.fill${i}`, entry: 'fill', threads: [L.px, L.px],
        bind: { canyonFill: u, canyonHeights: this.heights, canyonHints: this.hints },
      }));
      this.infos.push(kit.compute(fillShader, {
        label: `canyon.info${i}`, entry: 'info', threads: [L.px / infoStep, L.px / infoStep],
        bind: { canyonFill: u, canyonHeights: this.heights, canyonHints: this.hints, canyonInfo: this.info },
      }));
    });
  }

  /** the run items that fill level i, and copy it into layer i of `heightTex` (r32float, px² per layer) and of
   *  `infoTex` (rgba8unorm, (px / infoStep)² per layer) when given */
  items(i: number, heightTex?: Texture, infoTex?: Texture): RunItem[] {
    const L = this.levels[i], ipx = L.px / this.infoStep;
    const out: RunItem[] = [this.fills[i]];
    if (heightTex) {
      out.push(new RawItem((enc) => enc.copyBufferToTexture({ buffer: this.heights.gpu, bytesPerRow: L.px * 4, rowsPerImage: L.px },
        { texture: heightTex.gpu, origin: [0, 0, i] }, [L.px, L.px, 1]), `canyon.heights${i}`));
    }
    if (infoTex) {
      out.push(this.infos[i]);
      out.push(new RawItem((enc) => enc.copyBufferToTexture({ buffer: this.info.gpu, bytesPerRow: ipx * 4, rowsPerImage: ipx },
        { texture: infoTex.gpu, origin: [0, 0, i] }, [ipx, ipx, 1]), `canyon.info${i}`));
    }
    return out;
  }

  /** fill level i on the GPU and read its heights back into `out` */
  async fill(level: number, out: Float32Array) {
    const L = this.levels[level];
    await this.kit.ready();
    this.kit.run(this.items(level));
    out.set(new Float32Array(await this.heights.read(0, L.px * L.px * 4)));
  }

  /** fill every level into the textures (heights and material), handing each level's heights to `onLevel` as they come
   *  back for the CPU's copy; resolves with the milliseconds the GPU took */
  async fillAll(heightTex: Texture, infoTex: Texture | undefined, onLevel: (level: number, heights: Float32Array) => void): Promise<number> {
    await this.kit.ready();
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
  release() { this.kit.release(this.heights, this.hints, this.info, ...this.fills, ...this.infos); }
}
