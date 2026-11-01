// The meadow outside Boulder (metres) and the skin of the hand lying in it (millimetres): both lit by the Sun where it
// really is over Boulder now (frames.ts sunGround). Night falls on them as it falls there; the stars show through
// the ground's sky by night, and the levels above are told how much (`night`).
import { Ref, type Kit, type UniformBuffer } from '@ericrius1/weft';
import ground from '../shaders/c_ground.wgsl';
import skin from '../shaders/c_skin.wgsl';
import type { CosmosRenderer, Level } from '../renderer';
import { EARTH_R, type Ladder } from '../frames';
import type { Air } from './air';
import type { EarthData } from './earthdata';

export class Surface {
  readonly ground: Level;
  readonly skin: Level;
  /** how dark it is outside (0 day … 1 night) */
  night = 0;

  private G: UniformBuffer<any>;

  constructor(kit: Kit, R: CosmosRenderer, private ladder: Ladder, air: Air, private data: EarthData) {
    this.ground = R.level('ground', ladder.ground, [4.9, 4.65, -1.2, -1.45]);
    this.skin = R.level('skin', ladder.skin, [-1.15, -1.4, -99, -100]);
    this.G = kit.uniforms(ground.structs.GroundU, 'ground.u');
    R.scene.fullscreen(ground, {
      label: 'ground', fragment: 'fs', blend: 'premultiplied', enabled: () => this.ground.on() && data.ready,
      bind: {
        L: this.ground.L, G: this.G, nearH: new Ref(() => data.nearH), nearC: new Ref(() => data.nearC), farH: new Ref(() => data.farH),
        farC: new Ref(() => data.farC), ...air.bind(this.ground),
      } as never,
    });
    R.scene.fullscreen(skin, { label: 'skin', fragment: 'fs', bind: { L: this.skin.L }, blend: 'premultiplied', enabled: this.skin.on });
  }

  update(S: number) {
    const sun = this.ladder.sunGround;
    this.night = 1 - Math.max(0, Math.min(1, (sun[1] + 0.12) / 0.2));
    const l = Math.log10(S);
    // blades of grass once a few metres away or nearer
    const grass = Math.max(0, Math.min(1, (1.4 - l) / 0.6));
    this.ground.L.set({ sun, a: [2.4, 0, this.night, grass] });
    const m = this.data.manifest;
    if (m) this.G.set({ near: [m.near.half, m.near.min, m.near.max, 0], far: [m.far.half, m.far.min, m.far.max, 0], spot: [EARTH_R - 6360, EARTH_R * 1000, 0, 0] });
    // the plates of the stratum corneum from a millimetre down
    const fine = Math.max(0, Math.min(1, (-2.3 - l) / 0.6));
    // the living cells under the plates, as the cell's world comes near
    const reveal = Math.max(0, Math.min(1, (-3.1 - l) / 0.6));
    // (the skin's always lit a little from above: by night, as if by a lamp)
    const up = Math.max(sun[1], 0.35), k = 1 / Math.hypot(sun[0], up, sun[2]);
    this.skin.L.set({ sun: [sun[0] * k, up * k, sun[2] * k], a: [0.032, 6 + 14 * (1 - this.night), fine, reveal] });
  }
}
