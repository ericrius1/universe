// The flora on the GPU: every species' variants at every level in one vertex buffer and one index buffer, the species
// table, the planted instances (scatter.ts), and each frame a sort (floracull.wgsl) of the instances in reach into
// indirect draws by species, variant and level. One draw into the scene and one into each shadow cascade issue them all
// (flora.wgsl). Wiring, once the world is shared (kit.shareGroup(WORLD_GROUP, ...)):
//   const grown = growFlora();
//   const plants = [...scatterBeds(beds, { heights: meshHeights(grown), walls }), ...vinesAlong(walls, heights)];
//   const flora = new Flora(kit, floraBuffers(grown, plants), plants.length);   (or the buffers made in a worker)
//   order.into('flora', () => flora.draw(scene));  flora.drawShadows(shadows.passes);
//   run: [...flora.passes(), ...shadows.passes, scene, ...]   per frame: flora.update([{ at: hero.feet, radius: 0.6 }])
import type { Kit, RenderPass, RunEntry, StorageBuffer, UniformBuffer } from '@ericrius1/weft';
import floraShader from './flora.wgsl';
import cullShader from './floracull.wgsl';
import type { V3 } from './mesh';
import type { FloraBuffers } from './buffers';

/** something parting the plants: a walker's legs (radius ~0.6 m, strength 1), an airbender's gust (bigger, stronger) */
export interface Pusher { at: V3; radius: number; strength?: number }

export class Flora {
  readonly u: UniformBuffer<any>;
  /** ... and dissolve: a plant whose crown the eye is up against dissolves (a follow camera's; off for a camera that
   *  comes down into the beds on purpose: embed.ts) */
  readonly settings = { brightness: 1, translucency: 1, quality: 1, wind: 1, gustiness: 0.7, gustSize: 16, shadowCascades: 2, dissolve: true };
  /** no plant taller than its height (m) within its radius (m) of its centre (x, z): a host's (embed.ts); null none */
  clearing: { x: number; z: number; radius: number; height: number } | null = null;
  private verts: StorageBuffer;
  private index: StorageBuffer;
  private table: StorageBuffer;
  private instances: StorageBuffer;
  private visible: StorageBuffer;
  private args: StorageBuffer;
  private items: RunEntry[];
  /** the buckets with anything planted, and those of the species that cast shadows */
  private live: number[];
  private casting: number[];
  readonly count: number;
  readonly buckets: number;

  /** the catalogue and the plants as floraBuffers makes them, and how many plants there are */
  constructor(kit: Kit, B: FloraBuffers, count: number) {
    this.buckets = B.buckets;
    this.live = B.live;
    this.casting = B.casting;
    this.count = count;
    this.verts = kit.storage({ label: 'flora.verts', data: B.verts, usage: ['storage'] });
    this.index = kit.storage({ label: 'flora.index', data: B.indices, usage: ['index'] });
    this.table = kit.storage({ label: 'flora.species', data: B.species, usage: ['storage'] });
    this.instances = kit.storage({ label: 'flora.instances', data: B.instances, usage: ['storage'] });
    this.visible = kit.storage({ label: 'flora.visible', size: B.room * 8, usage: ['storage'] });
    this.args = kit.storage({ label: 'flora.args', data: B.args, usage: ['storage', 'indirect', 'copy-dst'] });
    this.u = kit.uniforms(floraShader.structs.FloraU, 'flora');
    const bind = { FU: this.u, species: this.table, instances: this.instances, visible: this.visible, args: this.args };
    this.items = [
      kit.compute(cullShader, { label: 'flora.reset', entry: 'reset', threads: [this.buckets], bind }),
      kit.compute(cullShader, { label: 'flora.cull', entry: 'cull', threads: [Math.max(1, this.count)], bind }),
    ];
    this.update([]);
    console.log(`[flora] ${B.vertices} vertices, ${B.triangles} triangles, ${this.count} plants in ${this.live.length} draws`);
  }

  /** the sort into draws, before the shadows and the scene */
  passes(): RunEntry[] { return this.items; }

  /** into the scene pass (opaque; `samples` the pass's: 4 with MSAA) */
  draw(pass: RenderPass, samples = 4) {
    pass.draw(floraShader, {
      label: 'flora', vertex: 'vs', fragment: 'fs', cull: 'none', constants: { SAMPLES: samples },
      bind: { FU: this.u, species: this.table, instances: this.instances, visible: this.visible, verts: this.verts },
      encode: (enc) => {
        enc.setIndexBuffer(this.index.gpu, 'uint32');
        for (const k of this.live) enc.drawIndexedIndirect(this.args.gpu, k * 20);
      },
    });
  }

  /** into the sun's nearest cascades (settings.shadowCascades of them): the species that cast */
  drawShadows(passes: RenderPass[]) {
    passes.forEach((p, i) => p.draw(floraShader, {
      label: `${p.label}.flora`, vertex: 'vsShadow', fragment: 'fsShadow', cull: 'none',
      bind: { FU: this.u, species: this.table, instances: this.instances, visible: this.visible, verts: this.verts },
      enabled: () => i < this.settings.shadowCascades,
      encode: (enc) => {
        enc.setIndexBuffer(this.index.gpu, 'uint32');
        for (const k of this.casting) enc.drawIndexedIndirect(this.args.gpu, k * 20);
      },
    }));
  }

  /** per frame: what's parting the plants (up to four), and the settings */
  update(pushers: Pusher[]) {
    const s = this.settings;
    const push = [0, 1, 2, 3].map((i) => (pushers[i] ? [...pushers[i].at, pushers[i].radius] : [0, 0, 0, 0]));
    this.u.set({
      push, pushK: [0, 1, 2, 3].map((i) => pushers[i]?.strength ?? 1),
      look: [s.brightness, s.translucency, s.quality, s.dissolve ? 0 : 1],
      clearing: this.clearing ? [this.clearing.x, this.clearing.z, this.clearing.radius, this.clearing.height] : [0, 0, 0, 0], wind: [s.wind, s.gustiness, s.gustSize, 0], counts: [this.count, this.buckets, 0, 0],
    });
  }
}
