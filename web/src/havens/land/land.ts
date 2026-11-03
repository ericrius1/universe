// The canyon in the game: the terrain's height source (its heights made on the GPU straight into the terrain's levels:
// source.ts CanyonGpu, canyon.wgsl through fill.wgsl), the ground's material made beside them (fill.wgsl `info`, one
// layer a level), the four painted textures, and the ground drawn with them (land.wgsl: ground.wgsl's sandstone, sand
// and scree, lit as the world lights everything).
import { Ref, TexView, type Kit, type RenderPass, type Texture } from '@ericrius1/weft';
import shader from './land.wgsl';
import { CanyonGpu } from './source';
import { INFO_STEP, LEVELS, LEVEL_PX } from './levels';
import type { HeightSource, Terrain } from '../world/terrain';
import { loadImageArray, solidTexture } from '../util/textures';
import { asset } from '../util/assets';

/** the ground's painted textures, in ground.wgsl's layer order (GROUND_STRATA, GROUND_FLUTES, GROUND_SAND, GROUND_FLOOR) */
const GROUND = ['sandstone_strata', 'cliff_flutes', 'desert_sand', 'canyon_floor'] as const;

export class Land implements HeightSource {
  readonly levels = LEVELS;
  /** the ground's material per level (rgba8: sand, damp, scree, zone) */
  readonly info: Texture;
  /** the painted textures are in (or given up on) */
  readonly textures: Promise<void>;
  /** the GPU's time filling the levels, readbacks included (ms) */
  ms = 0;
  private tex: Texture;

  constructor(readonly kit: Kit) {
    const ipx = LEVEL_PX / INFO_STEP;
    this.info = kit.texture({ label: 'land.info', format: 'rgba8unorm', size: [ipx, ipx, LEVELS.length], view: '2d-array' });
    const none = this.tex = solidTexture(kit, [196, 120, 84, 255], GROUND.length, 'land.ground.none');
    this.textures = loadImageArray(kit, GROUND.map((n) => asset(`tex/${n}.webp`)), { srgb: true, mips: true, label: 'land.ground' })
      .then((t) => { this.tex = t; none.destroy(); }, (e) => console.warn('land: the ground textures did not load', e));
  }

  /** every level made on the GPU into the terrain's heights and the material beside them; the filling's buffers freed */
  async fill(heights: Texture, level: (i: number, h: Float32Array) => void) {
    const gpu = new CanyonGpu(this.kit);
    this.ms = await gpu.fillAll(heights, this.info, level);
    gpu.release();
  }

  /** one of the painted textures alone, every mip (once `textures` is in: the rocks paint with the same) */
  layer(name: (typeof GROUND)[number]) {
    return new TexView(this.tex, { dimension: '2d', baseArrayLayer: GROUND.indexOf(name), arrayLayerCount: 1 });
  }

  /** the ground into a pass, painted */
  draw(terrain: Terrain, pass: RenderPass) {
    return terrain.draw(pass, shader, { groundTex: new Ref(() => this.tex), groundInfo: this.info });
  }
}
