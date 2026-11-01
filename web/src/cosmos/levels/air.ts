// The Earth's air (shaders/airlut.wgsl, air.wgsl: Boulder's tables): made once, the sky as the camera sees it each
// frame, sampled by the levels that look through it (the Earth, the ground). The camera's own frame — its zenith the
// way up from the planet's centre — is worked out here in doubles from the Earth level's view, and told to each of
// those levels in its own axes and units.
import type { Kit, Texture, UniformBuffer } from '@ericrius1/weft';
import { vec3, type Vec3 } from 'math';
import lutShader from '../shaders/airlut.wgsl';
import type { CosmosRenderer, Level } from '../renderer';
import type { Ladder } from '../frames';

export class Air {
  readonly transmittance: Texture;
  readonly multiScat: Texture;
  readonly skyView: Texture;
  private lut: UniformBuffer<any>;
  private views = new Map<Level, UniformBuffer<any>>();
  private made = false;
  /** a level that looks through it shows (the tables are only worked on then) */
  on = false;
  /** the camera's frame in the Earth's axes, and its radius (km) */
  private readonly ax: Vec3 = [1, 0, 0];
  private readonly ay: Vec3 = [0, 1, 0];
  private readonly az: Vec3 = [0, 0, 1];
  private vh = 7000;
  private readonly v: Vec3 = [0, 0, 0];

  constructor(private kit: Kit, R: CosmosRenderer, private ladder: Ladder) {
    const tex = (label: string, size: [number, number]) => kit.texture({ label, format: 'rgba16float', size, usage: ['sample', 'storage'] });
    this.transmittance = tex('air.transmittance', [256, 64]);
    this.multiScat = tex('air.multiScat', [32, 32]);
    this.skyView = tex('air.skyView', [192, 108]);
    this.lut = kit.uniforms(lutShader.structs.AirLut, 'air.lut');
    const AL = this.lut;
    const once = () => this.on && !this.made;
    R.before.push(
      kit.compute(lutShader, { label: 'air.transmittance', entry: 'transmittance', threads: [256, 64], bind: { outTex: this.transmittance }, enabled: once }),
      kit.compute(lutShader, { label: 'air.multiScat', entry: 'multiScat', workgroups: [32, 32], bind: { tLut: this.transmittance, outTex: this.multiScat }, enabled: () => { const k = once(); if (k) this.made = true; return k; } }),
      kit.compute(lutShader, { label: 'air.skyView', entry: 'skyView', threads: [192, 108], bind: { tLut: this.transmittance, msLut: this.multiScat, outTex: this.skyView, AL }, enabled: () => this.on }),
    );
  }

  /** a level's bindings for air.wgsl (its own view of the camera's frame) */
  bind(lv: Level) {
    let u = this.views.get(lv);
    if (!u) { u = this.lv(lv); this.views.set(lv, u); }
    return { tLut: this.transmittance, msLut: this.multiScat, svLut: this.skyView, AV: u };
  }
  private lv(lv: Level) { return this.kit.uniforms(lutShader.structs.AirView, `air.${lv.id}`); }

  /** this frame: the camera's frame from the Earth level's view (km, the Earth's centre at its frame's origin), the sun
   *  (the Earth's axes), each level's view of them */
  update(earth: Level, sunEarth: Vec3) {
    const lad = this.ladder;
    for (let i = 0; i < 3; i++) this.v[i] = earth.eye[i] + earth.origin[i];
    this.vh = Math.max(vec3.length(this.v), 6360.01);
    vec3.normalize(this.ay, this.v);
    // (any east: the tables only care for the sun's height and its azimuth from the view's)
    vec3.cross(this.ax, Math.abs(this.ay[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], this.ay);
    vec3.normalize(this.ax, this.ax);
    vec3.cross(this.az, this.ax, this.ay);
    const sun: Vec3 = [vec3.dot(sunEarth, this.ax), vec3.dot(sunEarth, this.ay), vec3.dot(sunEarth, this.az)];
    this.lut.set({ sun: [sun[0], sun[1], sun[2], 1], cam: [this.vh, 0, 0, 0] });
    for (const [lv, u] of this.views) {
      const f = lv.frame, kmPer = f.unit / 1000;
      const into = (v: Vec3): Vec3 => lad.dirInto(lad.earth, f, v);
      // the Earth's centre in the level's units, relative to its origin
      const c = lad.pointInto(lad.earth, f, [0, 0, 0]);
      u.set({
        ax: [...into(this.ax), 0], ay: [...into(this.ay), 0], az: [...into(this.az), 0],
        cam: [this.vh, kmPer, 1, 0], center: [c[0] - lv.origin[0], c[1] - lv.origin[1], c[2] - lv.origin[2], 0],
        sun: [sun[0], sun[1], sun[2], 0],
      });
    }
  }
}
