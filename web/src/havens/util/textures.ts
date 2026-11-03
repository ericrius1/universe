// Image and constant textures for the kit: decoded off the main thread by createImageBitmap, copied straight to the
// GPU, mip chains box-filtered on the GPU.
import type { Kit, Texture } from '@ericrius1/weft';
import { loadBlob } from './assets';
import { tier } from './tier';

export async function loadBitmap(url: string): Promise<ImageBitmap> {
  return createImageBitmap(await loadBlob(url), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

/** `max`: this image's own cap (px a side; under the tier's: util/tier.ts maxImage) */
export function textureFromBitmaps(kit: Kit, bitmaps: ImageBitmap[], o: { srgb?: boolean; mips?: boolean; label?: string; max?: number } = {}): Texture {
  const w = bitmaps[0].width, h = bitmaps[0].height;
  const make = (label: string, mw: number, mh: number) => kit.texture({
    label, format: o.srgb ? 'rgba8unorm-srgb' : 'rgba8unorm', size: [mw, mh, bitmaps.length],
    mips: o.mips ? 'full' : 1, view: bitmaps.length > 1 ? '2d-array' : undefined,
  });
  const t = make(o.label ?? 'image', w, h);
  bitmaps.forEach((b, i) => kit.queue.copyExternalImageToTexture({ source: b }, { texture: t.gpu, origin: [0, 0, i] }, [w, h, 1]));
  if (o.mips) generateMips(kit, t);
  // (a phone keeps a big mipmapped image at the first mip within its size cap: util/tier.ts)
  let k = 0;
  const cap = Math.min(tier.maxImage, o.max ?? Infinity);
  while (o.mips && Math.max(w, h) >> k > cap) k++;
  if (!k) return t;
  const fit = make(t.label, w >> k, h >> k);
  const enc = kit.device.createCommandEncoder({ label: `${t.label}.fit` });
  for (let i = 0; i < bitmaps.length; i++) enc.copyTextureToTexture({ texture: t.gpu, mipLevel: k, origin: [0, 0, i] }, { texture: fit.gpu, origin: [0, 0, i] }, [w >> k, h >> k, 1]);
  kit.queue.submit([enc.finish()]);
  generateMips(kit, fit);
  t.gpu.destroy();
  kit.textures.delete(t);
  return fit;
}

export async function loadImageTexture(kit: Kit, url: string, o: { srgb?: boolean; mips?: boolean; label?: string } = {}) {
  return textureFromBitmaps(kit, [await loadBitmap(url)], { label: url, ...o });
}

export async function loadImageArray(kit: Kit, urls: string[], o: { srgb?: boolean; mips?: boolean; label?: string; max?: number } = {}) {
  return textureFromBitmaps(kit, await Promise.all(urls.map(loadBitmap)), o);
}

/** fill every mip of every layer by box-filtering the one above (render passes: the format must be renderable). A
 *  tiny pipeline created synchronously: weft's MipChain compiles asynchronously, so a one-off run right after
 *  creating it would draw nothing. The formats the world uses are compiled in the background the first time one's
 *  asked for (warmMips), so a later first use of another — a texture arriving as you come somewhere — doesn't wait
 *  for its compile (tens of ms, the page held). */
const mipPipeSets = new WeakMap<GPUDevice, Map<string, GPURenderPipeline>>();
const mipModules = new WeakMap<GPUDevice, GPUShaderModule>();
const warmed = new WeakSet<GPUDevice>();
const pipesOf = (dev: GPUDevice) => { let m = mipPipeSets.get(dev); if (!m) mipPipeSets.set(dev, (m = new Map())); return m; };
const MIP_FORMATS: GPUTextureFormat[] = ['rgba8unorm', 'rgba8unorm-srgb', 'rgba16float', 'bgra8unorm', 'r8unorm', 'rg8unorm'];
function mipDesc(dev: GPUDevice, format: GPUTextureFormat): GPURenderPipelineDescriptor {
  let module = mipModules.get(dev);
  if (!module) {
    module = dev.createShaderModule({
      label: 'mips',
      code: `@group(0) @binding(0) var src: texture_2d<f32>; @group(0) @binding(1) var smp: sampler;
      struct O { @builtin(position) p: vec4f, @location(0) uv: vec2f }
      @vertex fn vs(@builtin(vertex_index) i: u32) -> O { let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); var o: O; o.p = vec4f(p * 2.0 - 1.0, 0.0, 1.0); o.uv = vec2f(p.x, 1.0 - p.y); return o; }
      @fragment fn fs(i: O) -> @location(0) vec4f { return textureSampleLevel(src, smp, i.uv, 0.0); }`,
    });
    mipModules.set(dev, module);
  }
  return {
    label: `mips.${format}`, layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  };
}
export function warmMips(kit: Kit) {
  const dev = kit.device, mipPipes = pipesOf(dev);
  if (warmed.has(dev)) return;
  warmed.add(dev);
  for (const f of MIP_FORMATS) {
    if (mipPipes.has(f)) continue;
    void dev.createRenderPipelineAsync(mipDesc(dev, f)).then((p) => { if (!mipPipes.has(f)) mipPipes.set(f, p); }, () => {});
  }
}
export function generateMips(kit: Kit, t: Texture) {
  const dev = kit.device, mipPipes = pipesOf(dev);
  let pipe = mipPipes.get(t.format);
  if (!pipe) mipPipes.set(t.format, pipe = dev.createRenderPipeline(mipDesc(dev, t.format)));
  warmMips(kit);
  const enc = dev.createCommandEncoder({ label: `${t.label}.mips` });
  for (let l = 0; l < t.layers; l++) {
    for (let m = 1; m < t.mips; m++) {
      const src = t.gpu.createView({ dimension: '2d', baseMipLevel: m - 1, mipLevelCount: 1, baseArrayLayer: l, arrayLayerCount: 1 });
      const dst = t.gpu.createView({ dimension: '2d', baseMipLevel: m, mipLevelCount: 1, baseArrayLayer: l, arrayLayerCount: 1 });
      const bg = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: src }, { binding: 1, resource: kit.samplers.linear }] });
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: dst, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bg);
      pass.draw(3);
      pass.end();
    }
  }
  kit.queue.submit([enc.finish()]);
}

/** a small constant texture (layers > 1: a 2D array) */
export function solidTexture(kit: Kit, rgba: [number, number, number, number], layers = 1, label = 'solid'): Texture {
  const t = kit.texture({ label, format: 'rgba8unorm', size: [4, 4, layers], view: layers > 1 ? '2d-array' : undefined });
  const px = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) px.set(rgba, i * 4);
  for (let l = 0; l < layers; l++) t.write(px, { layer: l });
  return t;
}
