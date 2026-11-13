// The Earth from space (kilometres, its own turning axes): shaders/c_earth.wgsl, the Earth as it is — NASA's Blue Marble
// by day, the Black Marble's city lights by night, a real day's clouds and their shadows, the relief and the sea
// (data/globe/: globe.json says what each map is) — the real ground round the spot the dive ends on (earthdata.ts, the
// same the ground level stands on, so the one hands over to the other), the air (air.ts), and the Moon from its own maps
// (data/moon/), lit by the Sun where it is and by the Earth on its dark side. Their centres, the Sun and the spot's
// ground axes are worked out here in doubles, relative to the level's origin.
//
// The maps come in once the Earth nears (from 10^12 m, as the ground's own data does): the day at 4k (2k on a phone),
// the 8k day on a computer whose GPU isn't light once the Earth is close; the Moon's once it's more than a few pixels.
import { Ref, generateMips, type Kit, type Texture, type UniformBuffer } from '@ericrius1/weft';
import { quat, vec3, type Vec3 } from 'math';
import earthShader from '../shaders/c_earth.wgsl';
import type { CosmosRenderer, Level } from '../renderer';
import { moonPos, type Ladder } from '../frames';
import type { Air } from './air';
import type { EarthData } from './earthdata';
import { half } from '../bodies';

/** a phone (as main.ts tells one: its maps at 2k), apart from a computer whose GPU is light (R.light: 4k at most) */
const PHONE = typeof navigator !== 'undefined' && (/iPhone|iPad|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 900) || new URLSearchParams(location.search).has('phone'));
const MOON_R = 1737.4;
const EARTH_KM = 6371;

export class Earth {
  readonly lv: Level;
  readonly sun: Vec3 = [0, 0, 1];
  private readonly moon: Vec3 = [0, 0, 0];
  private readonly qi = quat.create();
  private readonly E: UniformBuffer<any>;
  private day: Texture; private night: Texture; private clouds: Texture; private relief: Texture; private mask: Texture;
  private moonC: Texture; private moonH: Texture;
  /** the Earth's maps are in (its day, night, clouds, relief and sea): it's drawn from then */
  ready = false;
  /** drawn this frame: its maps in, the level showing, and the Earth or the Moon more than a speck */
  shown = false;
  /** the spot's own ground (the window round it, its picture and relief) drawn on the globe: false where the dive goes
   *  down somewhere else (the well's way, over San Francisco: the spot's ground is Seven Havens', not what's below) */
  spotGround = true;
  private asked = { base: false, big: false, moon: false };
  private readonly band0: [number, number, number, number];
  private moonIn = false;

  constructor(private kit: Kit, private R: CosmosRenderer, private ladder: Ladder, air: Air, private data: EarthData) {
    this.lv = R.level('earth', ladder.earth, [10.4, 9.7, 4.85, 4.6]);
    this.band0 = [...this.lv.band];
    this.E = kit.uniforms(earthShader.structs.EarthU, 'earth.u');
    const blank = (label: string, format: GPUTextureFormat) => kit.texture({ label, format, size: [1, 1], usage: ['sample', 'copy-dst'] });
    this.day = blank('earth.day.none', 'rgba8unorm-srgb');
    this.night = blank('earth.night.none', 'r8unorm');
    this.clouds = blank('earth.clouds.none', 'r8unorm');
    this.relief = blank('earth.relief.none', 'r8unorm');
    this.mask = blank('earth.mask.none', 'r8unorm');
    this.moonC = blank('moon.color.none', 'rgba8unorm-srgb');
    this.moonC.write(new Uint8Array([90, 90, 90, 255]));
    this.moonH = blank('moon.height.none', 'r16float');
    R.scene.fullscreen(earthShader, {
      label: 'earth', fragment: 'fs', blend: 'premultiplied', enabled: () => this.shown,
      bind: {
        L: this.lv.L, E: this.E, dayMap: new Ref(() => this.day), nightMap: new Ref(() => this.night), cloudMap: new Ref(() => this.clouds),
        reliefMap: new Ref(() => this.relief), seaMask: new Ref(() => this.mask), moonColor: new Ref(() => this.moonC), moonHeight: new Ref(() => this.moonH),
        regionMap: new Ref(() => data.farC), regionH: new Ref(() => data.farH), ...air.bind(this.lv),
      } as never,
    });
  }

  /** hold the Earth's level on further down the zoom: its weight from 1 at `full` to nothing by `gone` (log10 m; the
   *  well's way, down into San Francisco's fog), or with null back to its own */
  reach(bottom: [full: number, gone: number] | null) {
    const b = this.band0;
    this.lv.band = bottom ? [b[0], b[1], bottom[0], bottom[1]] : [...b];
  }

  // ---------------------------------------------------------------- the maps
  /** an image into a texture of its own with its mips (at most `w` wide: a phone's from a larger file) */
  private async image(file: string, format: GPUTextureFormat, w?: number): Promise<Texture> {
    const r = await fetch(new URL(file, document.baseURI).href);
    if (!r.ok) throw new Error(`${file} ${r.status}`);
    const blob = await r.blob();
    const raw = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' } as const;
    let bmp = await createImageBitmap(blob, raw);
    if (w && bmp.width > w) { const b = bmp; bmp = await createImageBitmap(b, { ...raw, resizeWidth: w, resizeHeight: w / 2, resizeQuality: 'high' }); b.close(); }
    const t = this.kit.texture({ label: file, format, size: [bmp.width, bmp.height], mips: 'full', usage: ['sample', 'copy-dst', 'render'] });
    this.kit.queue.copyExternalImageToTexture({ source: bmp }, { texture: t.gpu }, [bmp.width, bmp.height]);
    bmp.close();
    generateMips(this.kit, t);
    return t;
  }

  private async loadBase() {
    const w = PHONE ? 2048 : undefined;
    try {
      const [day, night, clouds, relief, mask] = await Promise.all([
        this.image('data/globe/day_4k.webp', 'rgba8unorm-srgb', w), this.image('data/globe/night_4k.webp', 'r8unorm', w),
        this.image('data/globe/clouds_2k.webp', 'r8unorm'), this.image('data/globe/relief_4k.webp', 'r8unorm', w),
        this.image('data/globe/mask_4k.webp', 'r8unorm', w),
      ]);
      Object.assign(this, { day, night, clouds, relief, mask });
      this.ready = true;
    } catch (e) { console.warn('earth: its maps failed to load', e); }
  }
  /** the 8k day (a computer whose GPU isn't light, the Earth close): in place of the 4k once it's in */
  private async loadBig() {
    try {
      const t = await this.image('data/globe/day_8k.webp', 'rgba8unorm-srgb');
      const old = this.day;
      this.day = t;
      this.kit.release(old);
    } catch (e) { console.warn('earth: the 8k day failed to load', e); }
  }
  /** the Moon's colour (LROC WAC) and its heights (LOLA, a 16-bit PNG decoded here: a browser gives only 8 bits of it) */
  private async loadMoon() {
    try {
      const [c, h] = await Promise.all([this.image('data/moon/color_4k.webp', 'rgba8unorm-srgb', PHONE ? 2048 : undefined), heights16('data/moon/height_1440.png')]);
      const t = this.kit.texture({ label: 'moon.height', format: 'r16float', size: [h.w, h.h], usage: ['sample', 'copy-dst'] });
      // (km above the sphere of 1737.4 km: moon.json's decode)
      const f = new Uint16Array(h.w * h.h);
      for (let i = 0; i < f.length; i++) f[i] = half(h.v[i] * 0.01 - 10);
      t.write(f);
      this.moonC = c;
      this.moonH = t;
      this.moonIn = true;
    } catch (e) { console.warn('earth: the Moon\'s maps failed to load', e); }
  }

  update(S: number) {
    const lad = this.ladder, o = this.lv.origin, l = Math.log10(S), eye = this.lv.eye;
    if (!this.asked.base && l < 12) { this.asked.base = true; void this.loadBase(); }
    if (!this.asked.big && l < 8 && this.ready && !this.R.light && !PHONE) { this.asked.big = true; void this.loadBig(); }
    // the Sun: from the Earth toward the solar system's centre, in the Earth's axes
    lad.dirInto(lad.solar, lad.earth, vec3.negate(this.sun, lad.earth.at), this.sun);
    vec3.normalize(this.sun, this.sun);
    // the Moon: about the Earth in the solar system's axes (the ephemeris's day: the time dial runs it), then into the
    // Earth's (turning) axes
    moonPos(lad.eday, this.moon);
    quat.invert(this.qi, lad.earth.rot);
    vec3.transformQuat(this.moon, this.moon, this.qi);
    // its axes: its near side (longitude 0) toward the Earth, its pole the ecliptic's (1.5° off it, near enough)
    const mz = lad.dirInto(lad.solar, lad.earth, [0, 1, 0]);
    const mx = vec3.normalize([0, 0, 0], vec3.negate([0, 0, 0], this.moon));
    vec3.normalize(mx, vec3.scaleAndAdd(mx, mx, mz, -vec3.dot(mx, mz)));
    // how big each is on the screen (px), and whether it's in front of the camera at all
    const [, H] = this.R.size();
    const pxA = this.R.dome ? Math.PI / this.R.size()[0] : (2 * Math.tan(this.kit.camera.fovY / 2)) / H;
    const toE: Vec3 = [-o[0] - eye[0], -o[1] - eye[1], -o[2] - eye[2]];
    const toM: Vec3 = [this.moon[0] - o[0] - eye[0], this.moon[1] - o[1] - eye[1], this.moon[2] - o[2] - eye[2]];
    const px = (v: Vec3, r: number) => { const d = vec3.length(v); return d <= r ? 1e9 : vec3.dot(v, this.lv.fwd) < -r && !this.R.dome ? 0 : r / (d * pxA); };
    const ePx = px(toE, EARTH_KM), mPx = px(toM, MOON_R);
    if (!this.asked.moon && mPx > 3 && this.lv.weight > 0) { this.asked.moon = true; void this.loadMoon(); }
    this.shown = this.lv.on() && this.ready && (ePx >= 0.75 || mPx >= 0.75);
    // earthshine: the Earth's light on the Moon (the Sun's 1), its Bond albedo 0.3 as a Lambertian sphere at its phase
    // seen from the Moon — about 5e-5 at full Earth: real, and so a hundred-thousandth of the Moon's sunlit side
    const em = vec3.normalize([0, 0, 0], this.moon), alpha = Math.acos(Math.max(-1, Math.min(1, vec3.dot(em, this.sun))));
    const lambert = (Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI;
    const shine = 0.3 * (2 / 3) * lambert * (EARTH_KM / vec3.length(this.moon)) ** 2;
    const doy = (((lad.day + 0.5) % 365.25) + 365.25) % 365.25;
    this.lv.L.set({
      sun: this.sun, a: [2.4, 0, Math.max(0, Math.min(1, (7.4 - l) / 1.4)), doy], b: [-o[0], -o[1], -o[2], 0],
      c: [this.moon[0] - o[0], this.moon[1] - o[1], this.moon[2] - o[2], mPx >= 0.75 ? 1 : 0],
    });
    // the spot's ground axes and place, and its window
    const m = this.data.manifest;
    const own = this.spotGround && this.data.ready;
    const ax = (v: Vec3) => lad.dirInto(lad.ground, lad.earth, v);
    const g = lad.pointInto(lad.ground, lad.earth, [0, 0, 0]);
    this.E.set({
      gx: [...ax([1, 0, 0]), 0], gy: [...ax([0, 1, 0]), 0], gz: [...ax([0, 0, 1]), 0],
      spot: [g[0] - o[0], g[1] - o[1], g[2] - o[2], m ? m.far.half / 1000 : 60], hr: [m?.far.min ?? 0, m?.far.max ?? 1, own ? 1 : 0, ePx >= 0.75 ? 1 : 0],
      mx: [...mx, this.moonIn ? 1 : 0], mz: [...mz, shine],
    });
  }
}

/** a 16-bit greyscale PNG's samples (no interlace): its zlib stream inflated by the browser, its rows unfiltered here */
async function heights16(file: string): Promise<{ w: number; h: number; v: Uint16Array }> {
  const r = await fetch(new URL(file, document.baseURI).href);
  if (!r.ok) throw new Error(`${file} ${r.status}`);
  const b = new Uint8Array(await r.arrayBuffer()), dv = new DataView(b.buffer);
  let p = 8, w = 0, h = 0;
  const idat: Uint8Array[] = [];
  while (p < b.length) {
    const len = dv.getUint32(p), type = String.fromCharCode(...b.subarray(p + 4, p + 8));
    if (type === 'IHDR') {
      w = dv.getUint32(p + 8); h = dv.getUint32(p + 12);
      if (b[p + 16] !== 16 || b[p + 17] !== 0 || b[p + 20] !== 0) throw new Error(`${file}: not a plain 16-bit greyscale PNG`);
    } else if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len));
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const z = new Blob(idat as BlobPart[]).stream().pipeThrough(new DecompressionStream('deflate'));
  const raw = new Uint8Array(await new Response(z).arrayBuffer());
  const row = w * 2, out = new Uint16Array(w * h), cur = new Uint8Array(row), prev = new Uint8Array(row);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (row + 1)], src = raw.subarray(y * (row + 1) + 1, (y + 1) * (row + 1));
    for (let i = 0; i < row; i++) {
      const a = i >= 2 ? cur[i - 2] : 0, up = prev[i], c = i >= 2 ? prev[i - 2] : 0;
      let x = src[i];
      if (f === 1) x += a;
      else if (f === 2) x += up;
      else if (f === 3) x += (a + up) >> 1;
      else if (f === 4) { const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c); x += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[i] = x & 255;
    }
    for (let x = 0; x < w; x++) out[y * w + x] = (cur[x * 2] << 8) | cur[x * 2 + 1];
    prev.set(cur);
  }
  return { w, h, v: out };
}
