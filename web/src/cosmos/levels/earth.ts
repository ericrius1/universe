// The Earth from space (kilometres, its own turning axes): shaders/c_earth.wgsl draws it, its air, its clouds and the
// Moon. Its centre, the Sun's direction and the Moon are worked out here in doubles, relative to the level's origin.
import { quat, vec3, type Vec3 } from 'math';
import earthShader from '../shaders/c_earth.wgsl';
import type { CosmosRenderer, Level } from '../renderer';
import { moonPos, type Ladder } from '../frames';

export class Earth {
  readonly lv: Level;
  private readonly sun: Vec3 = [0, 0, 1];
  private readonly moon: Vec3 = [0, 0, 0];
  private readonly qi = quat.create();

  constructor(R: CosmosRenderer, private ladder: Ladder) {
    this.lv = R.level('earth', ladder.earth, [10.4, 9.7, 4.7, 4.1]);
    R.scene.fullscreen(earthShader, { label: 'earth', fragment: 'fs', bind: { L: this.lv.L }, blend: 'premultiplied', enabled: this.lv.on });
  }

  update(S: number) {
    const lad = this.ladder, o = this.lv.origin;
    // the Sun: from the Earth toward the solar system's centre, in the Earth's axes
    lad.dirInto(lad.solar, lad.earth, vec3.negate(this.sun, lad.earth.at), this.sun);
    vec3.normalize(this.sun, this.sun);
    // the Moon: in the solar system's axes about the Earth, then into the Earth's (turning) axes
    moonPos(lad.day, this.moon);
    quat.invert(this.qi, lad.earth.rot);
    vec3.transformQuat(this.moon, this.moon, this.qi);
    this.lv.L.set({
      sun: this.sun, a: [0.2, 6.0, Math.max(0, Math.min(1, (7.4 - Math.log10(S)) / 1.4)), 0], b: [-o[0], -o[1], -o[2], 0],
      c: [this.moon[0] - o[0], this.moon[1] - o[1], this.moon[2] - o[2], 0],
    });
  }
}
