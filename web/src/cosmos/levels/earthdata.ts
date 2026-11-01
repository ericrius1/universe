// The real ground round the spot the dive ends on (Chautauqua's meadow in Boulder, below the Flatirons): two windows
// cut from Boulder's own terrain (its lidar and survey heights, its aerial pictures), centred on the spot, in metres
// east (x) and south (z) of it, heights relative to the spot's ground:
//   far    120 km across: heights 1024² (117 m a pixel) and the picture 1024² — the Earth from space hands over to it
//   near   8 km across: heights 512² (16 m) and the picture 1024² (8 m) — the Flatirons, the town, the meadow
// Small (3.3 MB together, data/earth/earth.json lists them); the dive never goes anywhere else. The heights come in
// as 16-bit steps between each window's lowest and highest and go to the GPU as floats in 0..1 (a half float's steps,
// near its top, would terrace the meadow in 0.4 m contours); the shaders filter them themselves.
import type { Kit, Texture } from '@ericrius1/weft';

export interface EarthWindow { half: number; px: number; min: number; max: number; heights: string; color: string; colorPx: number }
export interface EarthManifest { spot: [number, number]; spotHeight: number; base: number; near: EarthWindow; far: EarthWindow }

export class EarthData {
  manifest: EarthManifest | null = null;
  nearH: Texture; farH: Texture; nearC: Texture; farC: Texture;
  /** everything's in */
  ready = false;

  constructor(private kit: Kit, private base: string) {
    const blank = (label: string, format: GPUTextureFormat) => kit.texture({ label, format, size: [1, 1], usage: ['sample', 'copy-dst'] });
    this.nearH = blank('earth.near.h', 'r32float');
    this.farH = blank('earth.far.h', 'r32float');
    this.nearC = blank('earth.near.c', 'rgba8unorm');
    this.farC = blank('earth.far.c', 'rgba8unorm');
  }

  async load() {
    const get = async (f: string) => { const r = await fetch(this.base + f); if (!r.ok) throw new Error(`earth data: ${f} ${r.status}`); return r; };
    const m = (await (await get('earth.json')).json()) as EarthManifest;
    const heights = async (w: EarthWindow, label: string) => {
      const q = new Uint16Array(await (await get(w.heights)).arrayBuffer());
      const h = new Float32Array(q.length);
      for (let i = 0; i < q.length; i++) h[i] = q[i] / 65535;
      const t = this.kit.texture({ label, format: 'r32float', size: [w.px, w.px], usage: ['sample', 'copy-dst'] });
      t.write(h);
      return t;
    };
    const color = async (w: EarthWindow, label: string) => {
      const bmp = await createImageBitmap(await (await get(w.color)).blob());
      // (kept as sRGB bytes: the shaders decode, as they would an sRGB texture, after sampling its mips)
      const t = this.kit.texture({ label, format: 'rgba8unorm', size: [bmp.width, bmp.height], mips: 'full', usage: ['sample', 'copy-dst', 'render'] });
      // (its mips made here, each a resize of the picture: no pipeline to wait for)
      for (let k = 0, w = bmp.width; k < t.mips; k++, w = Math.max(1, w >> 1)) {
        const im = k === 0 ? bmp : await createImageBitmap(bmp, { resizeWidth: w, resizeHeight: w, resizeQuality: 'high' });
        this.kit.queue.copyExternalImageToTexture({ source: im }, { texture: t.gpu, mipLevel: k }, [w, w]);
      }
      return t;
    };
    [this.nearH, this.farH, this.nearC, this.farC] = await Promise.all([heights(m.near, 'earth.near.h'), heights(m.far, 'earth.far.h'), color(m.near, 'earth.near.c'), color(m.far, 'earth.far.c')]);
    this.manifest = m;
    this.ready = true;
  }
}
