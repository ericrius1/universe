// The world's environment (boulder's main.ts world setup and the sky half of its frame): the World uniform every lit
// shader reads (group 0, world.wgsl: the kit's globals — a host with globals of its own swaps them) and the shared group (WORLD_GROUP: 3, so a host with its own shared group 1 —
// Universe — can draw it on the same kit) — the atmosphere's tables, the sun's shadow cascades, the
// sky's irradiance, the terrain's heights and their shadow, the clouds' shadow, the weather, the aurora's dome; the
// clock and what it says of the sun and the moon at the site; the exposure an eye would settle on (a grey card facing
// up mapped to middle grey by day, darker as the light fails: night stays night); and the sky's own draws (the sky,
// the stars, the aurora's curtains). Each frame: update() before the view's matrices, passes() before the scene,
// after() once the frame is sent (the readbacks the exposure lives on).
import { Ref, type Camera, type Kit, type RenderPass, type RunEntry, type UniformBuffer, type V3 } from '@ericrius1/weft';
import worldShader from './world.wgsl';
import skyShader from './sky.wgsl';
import starShader from './stars.wgsl';
import { Atmosphere } from './atmosphere';
import { Shadows } from './shadows';
import { Clouds } from './clouds';
import { Aurora } from './aurora';
import { Sky } from './sky';
import { StarField } from './stars';
import { advance, skyState, MOON_FULL, type ClockState } from './clock';
import { airAt, cardFor, cloudPaintAt, DAYLIGHT_DEFAULT } from './daylight';
import { dayOfYear, type Place } from './sun';
import { TERRAIN_LEVELS, type Terrain } from './terrain';
import { STAR } from './layout';
import { loadImageTexture, solidTexture } from '../util/textures';
import { asset } from '../util/assets';
import { caveUniform } from '../caverns/plan';

import { WORLD_GROUP } from './group';
export { WORLD_GROUP };

/** the site: a fictional high desert at ~33° N (its sun and moon, its stars), on mountain standard time all year; the
 *  canyon floor's height above the sea (km: the atmosphere's) */
export const SITE: Place = { latitude: 33.2, longitude: -111.6, utcOffset: -7 };
export const SITE_KM = 1.1;
/** the default day: a late-summer full moon — the sun up at six, golden by six in the evening, gone at seven, the moon
 *  rising in the east as the dusk deepens and up all night — and how long a whole day takes (real seconds) */
export const DAY = { year: 2026, doy: dayOfYear(2026, 8, 28), hour: 16, seconds: 20 * 60 };

type Sky4 = [number, number, number, number];

/** the caverns under the Haven: where neither the sun nor the sky reaches (world.wgsl underground()) */
const CAVE = caveUniform();

export class Env {
  readonly world: UniformBuffer<any>;
  readonly atmo: Atmosphere;
  readonly shadows: Shadows;
  readonly clouds: Clouds;
  readonly aurora: Aurora;
  /** the sky's show: an aurora preset, a substorm, a clear night (world/sky.ts) */
  readonly sky: Sky;
  readonly weatherU: UniformBuffer<any>;
  stars: StarField | null = null;
  /** the clock: the date and the hour; hours per real second (the day's pace) and days per second */
  readonly time: ClockState = { year: DAY.year, doy: DAY.doy, hour: DAY.hour, hourSpeed: 24 / DAY.seconds, daySpeed: 0 };
  /** the air (mie haze — the desert's dust, times the day's own — and the rayleigh scattering, both remaking the
   *  atmosphere's tables), the ambient's and the sun's strength, the wind (m/s). The haze at 0.6: at 1 the middle
   *  distance (the city from the Haven, the canyon from the air) went under a flat mauve veil; at 0.4 the golden hour
   *  lost its glow */
  readonly look = { haze: 0.6, rayleigh: 1.4, ambient: 1.0, sun: 1.0, wind: 3.5 };
  /** the light over the day (world/daylight.ts): the sky's havens-ness, the dust, the exposure's white card by day and
   *  by night */
  readonly daylight = { ...DAYLIGHT_DEFAULT };
  /** the night sky: the stars, the milky way, the airglow and the city's glow, a moonless night's light; the moon's
   *  size (times its true size: the show's moon is a big one; its light is the same whatever its size) */
  readonly night = { stars: 1.0, milkyWay: 1.0, glow: 1.0, ambient: 0.0004, moonSize: 9 };
  /** the wind's way (x, z) */
  windDir: [number, number] = [0.8, 0.6];
  /** up to 8 lamps lighting the world this frame (world.wgsl outdoorLamps): each [x, y, z, strength], [r, g, b, wall
   *  or 9]; the fire sets them */
  lamps: Sky4[] = [];
  /** the eye's exposure (scene radiance -> the screen), eased toward what the light calls for; jumped there on a cut */
  exposure = 8;
  resetExposure = true;
  /** the eye opened wider than the light calls for (a factor: indoors, room/room.ts — a room's dimmer light read as
   *  the eye would after a moment in it) */
  exposureGain = 1;
  /** this frame's sky (the sun, the moon, the key light, how dark it is) */
  state = skyState(this.time, SITE);
  private milky: Ref<ReturnType<typeof solidTexture>>;
  /** the stars' catalogue (or the made-up field), drawn once it's in */
  readonly starsLoad: Promise<StarField>;
  /** the night sky's files are in (the Milky Way, the stars' catalogue), or given up on */
  readonly loaded: Promise<void>;
  /** what the first view doesn't need fetched from now on (the Milky Way): call once the world's made */
  later: () => void = () => {};
  /** the CPU copies the exposure reads: the transmittance table (whenever the air's tables are rebuilt: its version),
   *  the sky's light straight up (every few frames) */
  private tLut: Float32Array | null = null;
  private tLutVersion = -1;
  private skyUp = 0.05;
  private reading = false;
  private readHour = -1;
  private frame = 0;
  /** when the clock was last moved by hand: the eye keeps up with it for a moment */
  private lastScrub = -1e9;
  private clockWas = [this.time.hour, this.time.doy];

  constructor(readonly kit: Kit, readonly terrain: Terrain) {
    this.world = kit.uniforms(worldShader.structs.World, 'world');
    kit.setGlobals(this.world);
    this.atmo = new Atmosphere(kit);
    this.shadows = new Shadows(kit, TERRAIN_LEVELS);
    this.clouds = new Clouds(kit);
    this.aurora = new Aurora(kit);
    this.sky = new Sky(this.aurora, this.clouds);
    // (no weather yet: no rain, no lightning, dry ground — the weather's uniform at rest)
    this.weatherU = kit.uniforms(worldShader.structs.WeatherU, 'weather');
    kit.shareGroup(WORLD_GROUP, worldShader, {
      transmittanceLut: this.atmo.transmittance, multiScatLut: this.atmo.multiScat, skyViewLut: this.atmo.skyView, aerialLut: this.atmo.aerial,
      shadowMap: this.shadows.map, skyIrradiance: this.atmo.irradiance, heights: terrain.heightTex, terrainShadow: this.shadows.terrain,
      ...this.clouds.shared, weatherU: this.weatherU, auroraDome: this.aurora.dome,
    }, 'world');
    this.shadows.init();
    this.clouds.init();
    this.aurora.init();
    // (the ground's shadow drawn again once its heights change)
    terrain.onChange.push(() => this.shadows.invalidate());
    // (the Milky Way drawn as soon as it's in — asked for once the world's made (later()), its 2.5 MB not in the way of
    // what the first view needs; the stars' catalogue, or a bright list and a made-up field)
    const none = solidTexture(kit, [0, 0, 0, 0], 1, 'milkyway.none');
    let milky = none;
    this.milky = new Ref(() => milky);
    const asked = new Promise<void>((r) => { this.later = r; });
    const milkyLoad = asked.then(() => loadImageTexture(kit, asset('sky/milkyway.webp'), { mips: true, label: 'milkyway' })).then((t) => { milky = t; }, (e) => console.warn('sky: no milky way', e));
    this.starsLoad = StarField.load(kit);
    this.loaded = Promise.all([milkyLoad, this.starsLoad]).then(() => {});
  }

  /** the sky's draws into the scene: the sky behind everything, the stars, the aurora's curtains (where nothing else
   *  was drawn) */
  async draw(scene: RenderPass, into: (slot: 'sky' | 'stars' | 'aurora', fn: () => void) => void) {
    into('sky', () => scene.fullscreen(skyShader, { label: 'sky', depthCompare: 'greater-equal', depthWrite: false, bind: { milkyTex: this.milky } as never }));
    into('aurora', () => this.aurora.draw(scene));
    const stars = this.stars = await this.starsLoad;
    into('stars', () => scene.draw(starShader, {
      label: 'stars', topology: 'triangle-strip', count: 4, instances: stars.count, cull: 'none', blend: 'add',
      depthWrite: false, depthCompare: 'greater-equal', bind: { stars: stars.buffer } as never, enabled: () => this.state.night > 0.001,
    }));
  }

  /** this frame's clock, sky, light and exposure, and the World uniform (before the view's matrices are taken: the
   *  cascades fit the camera as it is now) */
  update(dt: number, cam: Camera) {
    const t = this.time, kit = this.kit;
    // (the clock moved by hand since the last frame — the panel, the dev handle — has the eye keep up with it)
    if (Math.abs(t.hour - this.clockWas[0]) + Math.abs(t.doy - this.clockWas[1]) * 24 > 0.02) this.lastScrub = performance.now();
    advance(t, dt);
    this.clockWas = [t.hour, t.doy];
    const sky = this.state = skyState(t, SITE);
    this.stars?.update(t.year, sky.month, sky.day, t.hour, sky.utcOffset);
    // the atmosphere lit by both: the sun's sky (its twilight) and the moon's
    this.atmo.setLights(sky.sun.dir, this.look.sun, sky.moon.dir, sky.moonSky * this.look.sun);
    this.atmo.setAir(airAt(t.hour, sky.sun.altitude, this.daylight));
    this.clouds.paint = cloudPaintAt(sky.sun.altitude, this.daylight);
    const key = sky.key, keyScale = key.scale * this.look.sun, night = sky.night;
    this.clouds.update(t, cam.position as V3, key.dir, cam.fovY, kit.size.render[1], this.night.glow * 0.001);
    // exposure: a grey card facing up maps to middle grey; darker than that as the light fails (night stays night)
    const sT = this.sunTransmittance(key.dir[1], cam.position[1]);
    const keyL = (0.2126 * sT[0] + 0.7152 * sT[1] + 0.0722 * sT[2]) * keyScale;
    const E = this.clouds.light(keyL * Math.max(key.dir[1], 0) / Math.PI, Math.max(this.skyUp, 0) * this.look.ambient) + this.night.ambient * 0.6 * night + this.aurora.light;
    // (world/daylight.ts: night is night, but the land still reads)
    const Ec = Math.max(E, 1e-7);
    const goal = (cardFor(Ec, night, this.daylight) / Ec) * this.exposureGain;
    // (while the clock is moved by hand the eye keeps up with it, so a scrub into the night, or back into the day,
    // doesn't go black, or white, first)
    const keepUp = performance.now() - this.lastScrub < 400;
    this.exposure = this.frame < 3 || this.resetExposure ? goal : Math.exp(Math.log(this.exposure) + (Math.log(goal) - Math.log(this.exposure)) * Math.min(1, dt * (keepUp ? 20 : 2.5)));
    this.resetExposure = false;
    this.shadows.update(cam, key.dir);
    this.aurora.update(dt, t, night, this.exposure);
    const lamps: Sky4[] = Array.from({ length: 16 }, () => [0, 0, 0, 0]);
    this.lamps.slice(0, 16).forEach((l, i) => { lamps[i] = l; });
    // (the town's glow on the night sky and the clouds' bases: toward the star's centre from outside the town, all
    // round inside it — the town fills the star out to its tips, 800 m, so the glow gathers toward its middle only
    // from past about 650 m out, and all of it from out on the plain)
    const dx = STAR.cx - cam.position[0], dz = STAR.cz - cam.position[2], dc = Math.hypot(dx, dz);
    const moonR = 0.00455 * this.night.moonSize;
    const focus = Math.min(1, Math.max(0, (dc - 650) / 850));
    this.world.set({
      sunDir: key.dir, sunCos: key.dir[1], moonDir: sky.moon.dir, exposure: this.exposure,
      wind: [this.windDir[0], this.windDir[1], this.look.wind, kit.time], cascades: this.shadows.matrices as never, splits: this.shadows.splits,
      shadowParams: [this.shadows.texelSize0, 0.00002, 1.6, key.dir[1] > -0.05 && keyScale > 1e-4 ? this.shadows.count : 0],
      site: [SITE_KM, 6371, kit.time, t.hour / 24],
      haze: [this.look.haze, this.look.rayleigh, this.look.ambient, keyScale],
      ...this.terrain.world,
      sunTrue: [...sky.sun.dir, night], moon: [sky.moon.illum, moonR, key.moon ? 1 : 0, (MOON_FULL * this.look.sun) / (Math.PI * moonR * moonR)],
      night: [this.night.stars, this.night.milkyWay, this.night.glow, this.night.ambient * night],
      eqX: sky.eq[0], eqY: sky.eq[1], eqZ: sky.eq[2],
      ...this.aurora.world,
      lamps: lamps as never,
      glow: [dc > 1 ? dx / dc : 0, focus, dc > 1 ? dz / dc : 0, 1],
      cave: CAVE as never,
    });
  }

  /** the passes before the scene: the atmosphere's tables, the ground's shadow, the cascades, the clouds' shadow, the
   *  aurora's dome */
  passes(): RunEntry[] {
    const key = this.state.key.dir;
    return [...this.atmo.passes(), ...this.shadows.terrainPasses(key), ...this.shadows.passes, ...this.clouds.passes(), ...this.aurora.passes()];
  }

  /** once the frame is sent: the transmittance table read back whenever it's been rebuilt, the sky's light straight up
   *  every few frames (as often as one comes back while the clock is moved by hand) */
  after() {
    this.frame++;
    if (this.reading) return;
    const v = this.atmo.version;
    if (v > 0 && v !== this.tLutVersion && this.frame > 2) {
      this.reading = true;
      this.atmo.transmittance.read().then((b) => {
        const h = new Uint16Array(b), t = new Float32Array(h.length);
        for (let i = 0; i < h.length; i++) t[i] = half(h[i]);
        this.tLut = t;
        this.tLutVersion = v;
        this.reading = false;
      });
      return;
    }
    const keepUp = performance.now() - this.lastScrub < 400;
    if (this.frame % (keepUp ? 2 : 10) === 0 || Math.abs(this.time.hour - this.readHour) > 0.002) {
      this.reading = true;
      this.readHour = this.time.hour;
      this.atmo.irradiance.read(0, 64).then((b) => {
        const f = new Float32Array(b);
        // irradiance/pi straight up: c0 + c1 (the y band)
        const up = [f[0] + f[4], f[1] + f[5], f[2] + f[6]];
        this.skyUp = 0.2126 * up[0] + 0.7152 * up[1] + 0.0722 * up[2];
        this.reading = false;
      });
    }
  }

  /** the key light's transmittance down to the camera's height, for a zenith cosine (the CPU copy of the table, as
   *  world.wgsl's transmittanceToSpace reads it, with the earth's shadow) */
  private sunTransmittance(mu: number, camY: number): V3 {
    const tLut = this.tLut;
    if (!tLut) return [0.8, 0.75, 0.6];
    const RB = 6360, RT = 6460, r = RB + SITE_KM + camY / 1000;
    const H = Math.sqrt(RT * RT - RB * RB), rho = Math.sqrt(Math.max(0, r * r - RB * RB));
    const disc = r * r * (mu * mu - 1) + RT * RT, d = Math.max(0, -r * mu + Math.sqrt(Math.max(disc, 0)));
    const u = (d - (RT - r)) / (rho + H - (RT - r)), v = rho / H;
    const fx = Math.min(255, Math.max(0, u * 256 - 0.5)), fy = Math.min(63, Math.max(0, v * 64 - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(255, x0 + 1), y1 = Math.min(63, y0 + 1), ax = fx - x0, ay = fy - y0;
    const horizon = -Math.sqrt(Math.max(0, 1 - (RB / r) ** 2));
    const k = Math.min(1, Math.max(0, (mu - horizon + 0.0045) / 0.009)), earth = k * k * (3 - 2 * k);
    const at = (x: number, y: number, c: number) => tLut[(y * 256 + x) * 4 + c];
    const T = (c: number) => (at(x0, y0, c) * (1 - ax) + at(x1, y0, c) * ax) * (1 - ay) + (at(x0, y1, c) * (1 - ax) + at(x1, y1, c) * ax) * ay;
    return [T(0) * earth, T(1) * earth, T(2) * earth];
  }
}

/** a half float's value */
function half(h: number) {
  const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff;
  return (s ? -1 : 1) * (e === 0 ? 6.103515625e-5 * (f / 1024) : e === 31 ? (f ? NaN : Infinity) : 2 ** (e - 15) * (1 + f / 1024));
}
