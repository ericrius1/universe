// The noise the marches above the cell read (the cosmic web's cells, the Milky Way's octaves), baked once into
// tiling 3D textures by a compute pass the first frame its pipeline is ready (shaders/c_noisebake.wgsl), and read
// back with a tap a step (shaders/noisetex.wgsl). One set per renderer, shared by every level that asks.
import type { Kit, Texture } from '@ericrius1/weft';
import bakeShader from './shaders/c_noisebake.wgsl';
import type { CosmosRenderer } from './renderer';

export interface NoiseTex { cellTex: Texture; valTex: Texture; codeTex: Texture }

const NC = 32, NV = 128;
const made = new WeakMap<CosmosRenderer, NoiseTex>();

export function noiseTex(kit: Kit, R: CosmosRenderer): NoiseTex {
  const have = made.get(R);
  if (have) return have;
  const cellTex = kit.texture({ label: 'cosmos.noise.cell', format: 'rgba32uint', size: [NC, NC, NC], dimension: '3d', usage: ['sample', 'storage'] });
  const codeTex = kit.texture({ label: 'cosmos.noise.code', format: 'r32uint', size: [NC, NC, NC], dimension: '3d', usage: ['sample', 'storage'] });
  const valTex = kit.texture({ label: 'cosmos.noise.val', format: 'rgba8unorm', size: [NV, NV, NV], dimension: '3d', usage: ['sample', 'storage'] });
  let baked = false;
  const c = kit.compute(bakeShader, { label: 'cosmos.noise.bake', entry: 'bake', bind: { cellOut: cellTex, valOut: valTex, codeOut: codeTex }, threads: [NV, NV, NV], enabled: () => !baked });
  // (done once it has run: until its pipeline is made it's passed over, and asked again next frame)
  R.before.push(c, kit.action(() => { if (c.pipe.pipeline) baked = true; }, 'cosmos.noise.baked'));
  const t = { cellTex, valTex, codeTex };
  made.set(R, t);
  return t;
}
