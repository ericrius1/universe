// The atmosphere's tables (atmosphere.wgsl): two computed once (and again whenever the air changes: its havens-ness,
// its dust), three every frame, lit by the sun and the moon together (setLights each frame).
import type { Compute, Kit, RunEntry, StorageBuffer, Texture, UniformBuffer, V3 } from '@ericrius1/weft';
import atmo from './atmosphere.wgsl';

/** the air: how far toward sea green its Rayleigh scattering is (0 the earth's blue), the dust over the canyon floor
 *  (/km) and how high it reaches (its scale height, km), the dust's colour (single-scattering albedo), the moon's sky as
 *  the eye takes it (a tint on its light in the air and on the land); and the sun's sky as painted: the dome's gain by
 *  channel (the far air going to it with distance: how far off, km, it has most of it), its light on the land's, and
 *  the haze's over the land (the gain on the sun's light scattered in the air between the eye and the ground) */
export interface Air { havens: number; dust: number; dustHeight: number; dustColor: V3; night: V3; paint: V3; farKm: number; shade: V3; haze: V3 }

export class Atmosphere {
  readonly transmittance: Texture;
  readonly multiScat: Texture;
  readonly skyView: Texture;
  readonly aerial: Texture;
  readonly irradiance: StorageBuffer;
  private lights: UniformBuffer<any>;
  /** set when the medium changes: the static tables are rebuilt on the next frame */
  dirty = true;
  /** how many times the static tables have been built (a CPU copy of the transmittance knows when it's stale) */
  version = 0;
  /** the air the static tables hold (every table reads this one, so they agree) */
  private built: Air | null = null;
  private once: RunEntry[];
  private each: RunEntry[];

  constructor(readonly kit: Kit) {
    const tex = (label: string, size: [number, number] | [number, number, number], dim?: GPUTextureDimension) =>
      kit.texture({ label, format: 'rgba16float', size, dimension: dim, usage: ['sample', 'storage', 'copy-src'] });
    this.transmittance = tex('atmo.transmittance', [256, 64]);
    this.multiScat = tex('atmo.multiScat', [32, 32]);
    // (two skies one above the other: the sun's, the moon's)
    this.skyView = tex('atmo.skyView', [192, 216]);
    this.aerial = tex('atmo.aerial', [32, 32, 32], '3d');
    this.irradiance = kit.storage({ label: 'atmo.irradiance', size: 64, usage: ['storage', 'copy-dst', 'copy-src'] });
    this.lights = kit.uniforms(atmo.structs.AtmoLights, 'atmo.lights');
    const AL = this.lights;
    this.once = [
      kit.compute(atmo, { label: 'atmo.transmittance', entry: 'transmittance', threads: [256, 64], bind: { outTex: this.transmittance, AL } }),
      kit.compute(atmo, { label: 'atmo.multiScat', entry: 'multiScat', workgroups: [32, 32], bind: { tLut: this.transmittance, outTex: this.multiScat, AL } }),
    ];
    this.each = [
      kit.compute(atmo, { label: 'atmo.skyView', entry: 'skyView', threads: [192, 216], bind: { tLut: this.transmittance, msLut: this.multiScat, outTex: this.skyView, AL } }),
      kit.compute(atmo, { label: 'atmo.aerial', entry: 'aerialVolume', threads: [32, 32], bind: { tLut: this.transmittance, msLut: this.multiScat, outVol: this.aerial, AL } }),
      kit.compute(atmo, { label: 'atmo.irradiance', entry: 'irradiance', workgroups: [1], bind: { tLut: this.transmittance, svLut: this.skyView, shOut: this.irradiance, AL } }),
    ];
  }

  /** this frame's two lights: directions and strengths (0 leaves one out) */
  setLights(sun: V3, sunScale: number, moon: V3, moonScale: number) {
    this.lights.set({ sun: [...sun, sunScale], moon: [...moon, moonScale] });
  }

  /** the air: the static tables rebuilt once what they hold has moved (the havens-ness, the dust: a slow drift over
   *  the day rebuilds them every few per cent of it); the moon's tint and the painted sky, which they don't hold, every
   *  frame */
  setAir(a: Air) {
    const b = this.built;
    if (!b || b.havens !== a.havens || Math.abs(a.dust - b.dust) > b.dust * 0.04 + 1e-5 || Math.abs(a.dustHeight - b.dustHeight) > b.dustHeight * 0.04
      || a.dustColor.some((c, i) => c !== b.dustColor[i])) {
      this.built = { ...a, dustColor: [...a.dustColor], night: [...a.night] };
      this.dirty = true;
    }
    const u = this.built!;
    this.lights.set({ air: [u.havens, u.dust, u.dustHeight, 0], dust: [...u.dustColor, 0], night: [...a.night, 0], paint: [...a.paint, a.farKm], shade: [...a.shade, 0], haze: [...a.haze, 0] });
  }

  /** the passes for this frame */
  passes(): RunEntry[] {
    if (!this.dirty) return this.each;
    // (the static tables count as built only once their pipelines exist: a pass whose pipeline is still compiling
    // records nothing)
    if ((this.once as Compute[]).every((c) => c.pipe.pipeline)) { this.dirty = false; this.version++; }
    return [...this.once, ...this.each];
  }
}
