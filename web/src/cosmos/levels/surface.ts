// The meadow outside Boulder (metres) and Eli lying in it, looking up (figure/figure.ts), down to their eye and the
// cornea's cells: lit by the Sun where it really is over Boulder now (frames.ts sunGround). Night falls on them as it
// falls there; the stars show through the ground's sky by night, and the levels above are told how much (`night`).
import { Ref, type Kit, type UniformBuffer } from '@ericrius1/weft';
import ground from '../shaders/c_ground.wgsl';
import type { CosmosRenderer, Level } from '../renderer';
import { EARTH_R, type Ladder } from '../frames';
import { Figure } from '../figure/figure';
import type { Air } from './air';
import type { EarthData } from './earthdata';

const EXPOSURE = 2.4;

export class Surface {
  readonly ground: Level;
  readonly figure: Figure;
  /** how dark it is outside (0 day … 1 night) */
  night = 0;

  private G: UniformBuffer<any>;

  constructor(kit: Kit, R: CosmosRenderer, private ladder: Ladder, air: Air, private data: EarthData, figureUrl: string) {
    // (the meadow holds the dive all the way in: Eli's eye and its cells are drawn with it)
    this.ground = R.level('ground', ladder.ground, [4.9, 4.65, -99, -100]);
    this.figure = new Figure(kit, this.ground, R.dome, figureUrl);
    R.before.push(this.figure.pass);
    this.G = kit.uniforms(ground.structs.GroundU, 'ground.u');
    const fig = this.figure;
    R.scene.fullscreen(ground, {
      label: 'ground', fragment: 'fs', blend: 'premultiplied', enabled: () => this.ground.on() && data.ready,
      bind: {
        L: this.ground.L, G: this.G, nearH: new Ref(() => data.nearH), nearC: new Ref(() => data.nearC), farH: new Ref(() => data.farH),
        farC: new Ref(() => data.farC), figCol: fig.col, figDist: fig.dist, ...air.bind(this.ground),
      } as never,
    });
  }

  update(S: number) {
    const sun = this.ladder.sunGround;
    this.night = 1 - Math.max(0, Math.min(1, (sun[1] + 0.12) / 0.2));
    const l = Math.log10(S);
    // blades of grass once a few metres away or nearer
    const grass = Math.max(0, Math.min(1, (1.4 - l) / 0.6));
    this.ground.L.set({ sun, a: [EXPOSURE, 0, this.night, grass] });
    const m = this.data.manifest;
    if (m) this.G.set({ near: [m.near.half, m.near.min, m.near.max, 0], far: [m.far.half, m.far.min, m.far.max, 0], spot: [EARTH_R - 6360, EARTH_R * 1000, 0, 0] });
    // the cornea's living cells, as the cell's world comes near
    const cells = Math.max(0, Math.min(1, (-3.1 - l) / 0.6));
    this.figure.update(cells, this.night, EXPOSURE);
  }
}
