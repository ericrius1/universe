// The Earth from space (kilometres, its own turning axes): shaders/c_earth.wgsl, Boulder's planet on Boulder's
// coastline map (continents.ts, painted in a worker as the cosmos is made), the real ground round the spot (earthdata.ts) and
// Boulder's air (air.ts). Its centre, the Sun, the Moon and the spot's ground axes are worked out here in doubles,
// relative to the level's origin.
import { Ref, type Kit, type Texture, type UniformBuffer } from '@ericrius1/weft';
import { quat, vec3, type Vec3 } from 'math';
import earthShader from '../shaders/c_earth.wgsl';
import type { CosmosRenderer, Level } from '../renderer';
import { moonPos, type Ladder } from '../frames';
import { mips, rasterise } from './continents';
import type { Air } from './air';
import type { EarthData } from './earthdata';

const MAP: [number, number] = [2048, 1024];

export class Earth {
  readonly lv: Level;
  readonly sun: Vec3 = [0, 0, 1];
  private readonly moon: Vec3 = [0, 0, 0];
  private readonly qi = quat.create();
  private readonly E: UniformBuffer<any>;
  private map: Texture;
  private painted = false;

  constructor(private kit: Kit, R: CosmosRenderer, private ladder: Ladder, air: Air, private data: EarthData) {
    this.lv = R.level('earth', ladder.earth, [10.4, 9.7, 4.85, 4.6]);
    this.E = kit.uniforms(earthShader.structs.EarthU, 'earth.u');
    this.map = kit.texture({ label: 'earth.map.none', format: 'rgba8unorm', size: [1, 1], usage: ['sample', 'copy-dst'] });
    R.scene.fullscreen(earthShader, {
      label: 'earth', fragment: 'fs', blend: 'premultiplied', enabled: () => this.lv.on() && data.ready && this.painted,
      bind: { L: this.lv.L, E: this.E, earthMap: new Ref(() => this.map), regionMap: new Ref(() => data.farC), regionH: new Ref(() => data.farH), ...air.bind(this.lv) } as never,
    });
    // (Boulder's coastlines painted into the map off the page's thread from now: a few hundred ms of CPU — a phone's
    // frame frozen for over a second when it was painted as the Earth came in sight)
    try {
      const w = new Worker(new URL('./continents.worker.ts', import.meta.url), { type: 'module', name: 'earth.map' });
      w.onmessage = (e: MessageEvent<Uint8Array[] | null>) => { w.terminate(); if (e.data && !this.painted) this.take(e.data); };
      w.onerror = () => w.terminate();
      w.postMessage(MAP);
    } catch { /* painted when first needed */ }
  }

  /** the map from its mips (the map first) */
  private take(chain: Uint8Array[]) {
    this.painted = true;
    const [w, h] = MAP;
    const t = this.kit.texture({ label: 'earth.map', format: 'rgba8unorm', size: [w, h], mips: 'full', usage: ['sample', 'copy-dst', 'render'] });
    for (let k = 0; k < Math.min(t.mips, chain.length); k++) t.write(chain[k], { mip: k, width: Math.max(1, w >> k), height: Math.max(1, h >> k) });
    this.map = t;
  }

  update(S: number) {
    const lad = this.ladder, o = this.lv.origin, l = Math.log10(S);
    // (painted here, now, if the worker couldn't or hasn't yet)
    if (!this.painted && this.lv.weight > 0) this.take(mips(rasterise(...MAP), ...MAP));
    // the Sun: from the Earth toward the solar system's centre, in the Earth's axes
    lad.dirInto(lad.solar, lad.earth, vec3.negate(this.sun, lad.earth.at), this.sun);
    vec3.normalize(this.sun, this.sun);
    // the Moon: about the Earth in the solar system's axes, then into the Earth's (turning) axes
    moonPos(lad.day, this.moon);
    quat.invert(this.qi, lad.earth.rot);
    vec3.transformQuat(this.moon, this.moon, this.qi);
    const doy = (((lad.day + 0.5) % 365.25) + 365.25) % 365.25;
    this.lv.L.set({
      sun: this.sun, a: [2.4, 0, Math.max(0, Math.min(1, (7.4 - l) / 1.4)), doy], b: [-o[0], -o[1], -o[2], 0],
      c: [this.moon[0] - o[0], this.moon[1] - o[1], this.moon[2] - o[2], 0],
    });
    // the spot's ground axes and place, and its window
    const m = this.data.manifest;
    if (m) {
      const ax = (v: Vec3) => lad.dirInto(lad.ground, lad.earth, v);
      const g = lad.pointInto(lad.ground, lad.earth, [0, 0, 0]);
      this.E.set({
        gx: [...ax([1, 0, 0]), 0], gy: [...ax([0, 1, 0]), 0], gz: [...ax([0, 0, 1]), 0],
        spot: [g[0] - o[0], g[1] - o[1], g[2] - o[2], m.far.half / 1000], hr: [m.far.min, m.far.max, 0, 0],
      });
    }
  }
}
