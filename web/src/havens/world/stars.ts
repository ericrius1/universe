// The night sky's stars: every star the eye can see — the telescope's catalogue (XHIP, brightest first:
// telescope/sky.bin) to magnitude 7 — and the planets where they are tonight (toys/planets.ts), as equatorial unit
// vectors with their magnitudes and colours in a storage buffer for stars.wgsl. If the catalogue can't be had: a
// bright-star list (RA hours, Dec degrees, V magnitude, B-V colour) and a made-up field of fainter stars along the
// galactic plane (both from gossamer's web/src/engine/world/astro.ts).
import type { Kit, StorageBuffer } from '@ericrius1/weft';
import { fetchAsset } from '../util/assets';
import { planets, julianDate, PLANETS } from '../toys/planets';

const D2R = Math.PI / 180;
/** floats per star (stars.wgsl Star) */
const STRIDE = 8;
/** the faintest catalogue star kept */
const FAINTEST = 7.0;
/** the planets' colours as B-V */
const PLANET_BV: Record<string, number> = { mercury: 0.9, venus: 0.78, mars: 1.45, jupiter: 0.85, saturn: 1.05, uranus: 0.55, neptune: 0.4 };

export class StarField {
  readonly buffer: StorageBuffer;
  /** stars and planets (the planets last) */
  readonly count: number;
  private planetAt: number;
  private jd = -1;
  private planetData = new Float32Array(PLANETS.length * STRIDE);

  private constructor(kit: Kit, data: Float32Array, stars: number) {
    this.planetAt = stars;
    this.count = stars + PLANETS.length;
    const all = new Float32Array(this.count * STRIDE);
    all.set(data);
    this.buffer = kit.storage({ label: 'stars', data: all });
  }

  static async load(kit: Kit): Promise<StarField> {
    let list: [number, number, number, number][];
    try {
      list = parseCatalogue(await (await fetchAsset('telescope/sky.bin')).arrayBuffer());
    } catch (e) {
      console.warn('stars: no catalogue, using the bright list and a made-up field', e);
      list = [...STARS, ...fieldStars(5000)];
    }
    const data = new Float32Array(list.length * STRIDE);
    list.forEach(([raH, dec, mag, bv], i) => {
      const ra = raH * 15 * D2R, d = dec * D2R;
      data.set([Math.cos(d) * Math.cos(ra), Math.cos(d) * Math.sin(ra), Math.sin(d), mag, bv, (i * 0.618034) % 1, 0, 0], i * STRIDE);
    });
    return new StarField(kit, data, list.length);
  }

  /** the planets for this moment (moved when the clock has moved a minute) */
  update(year: number, month: number, day: number, hour: number, utcOffset: number) {
    const jd = julianDate(year, month, day, hour, utcOffset);
    if (Math.abs(jd - this.jd) < 1 / 1440) return;
    this.jd = jd;
    planets(jd).forEach((p, i) => {
      // (a planet doesn't twinkle: seed -1)
      this.planetData.set([p.dir[0], p.dir[1], p.dir[2], p.mag, PLANET_BV[p.name] ?? 0.8, -1, 0, 0], i * STRIDE);
    });
    this.buffer.write(this.planetData, this.planetAt * STRIDE * 4);
  }
}

/** telescope/sky.bin: 'SKY1', u32 count, then columns (brightest first): ra u16[n] (2pi / 65536), dec i16[n] (90 deg /
 *  32767), mag u8[n] ((mag + 2) * 20), bv i8[n] (bv * 60) — as [ra hours, dec deg, mag, bv], to FAINTEST */
function parseCatalogue(b: ArrayBuffer): [number, number, number, number][] {
  const v = new DataView(b);
  if (v.getUint32(0, true) !== 0x31594b53) throw new Error('not a SKY1 catalogue');
  const n = v.getUint32(4, true), out: [number, number, number, number][] = [];
  const ra = new Uint16Array(b, 8, n), dec = new Int16Array(b, 8 + n * 2, n);
  const mag = new Uint8Array(b, 8 + n * 4, n), bv = new Int8Array(b, 8 + n * 5, n);
  for (let i = 0; i < n; i++) {
    const m = mag[i] / 20 - 2;
    if (m > FAINTEST) break;
    out.push([(ra[i] / 65536) * 24, (dec[i] / 32767) * 90, m, bv[i] / 60]);
  }
  if (out.length < 1000) throw new Error('short catalogue');
  return out;
}

// Bright stars: RA (hours), Dec (degrees), V magnitude, B-V colour index. Enough for the constellations to read.
export const STARS: [number, number, number, number][] = [
  [6.752, -16.716, -1.46, 0.0], [14.261, 19.182, -0.05, 1.23], [18.616, 38.784, 0.03, 0.0], [5.278, 45.998, 0.08, 0.8],
  [5.242, -8.202, 0.13, -0.03], [7.655, 5.225, 0.34, 0.42], [5.919, 7.407, 0.5, 1.85], [19.846, 8.868, 0.76, 0.22],
  [4.599, 16.509, 0.86, 1.54], [16.49, -26.432, 0.96, 1.83], [13.42, -11.161, 0.97, -0.23], [7.755, 28.026, 1.14, 1.0],
  [22.961, -29.622, 1.16, 0.09], [20.69, 45.28, 1.25, 0.09], [10.14, 11.967, 1.35, -0.11], [6.977, -28.972, 1.5, -0.21],
  [7.577, 31.888, 1.58, 0.03], [17.56, -37.104, 1.62, -0.22], [5.419, 6.35, 1.64, -0.22], [5.438, 28.608, 1.65, -0.13],
  [5.604, -1.202, 1.69, -0.18], [5.679, -1.943, 1.77, -0.21], [5.533, -0.299, 2.23, -0.22], [12.9, 55.96, 1.76, -0.02],
  [11.062, 61.751, 1.79, 1.07], [3.405, 49.861, 1.79, 0.48], [7.14, -26.393, 1.83, 0.68], [18.403, -34.385, 1.85, -0.03],
  [13.792, 49.313, 1.86, -0.19], [5.992, 44.948, 1.9, 0.08], [6.629, 16.399, 1.92, 0.0], [6.378, -17.956, 1.98, -0.24],
  [2.53, 89.264, 1.98, 0.6], [9.46, -8.659, 1.98, 1.44], [2.12, 23.463, 2.0, 1.15], [0.727, -17.987, 2.02, 1.02],
  [18.921, -26.297, 2.05, -0.13], [5.796, -9.67, 2.06, -0.18], [0.14, 29.091, 2.06, -0.11], [1.162, 35.621, 2.05, 1.58],
  [17.582, 12.56, 2.07, 0.15], [14.845, 74.156, 2.08, 1.47], [3.136, 40.956, 2.1, -0.05], [11.818, 14.572, 2.13, 0.09],
  [2.065, 42.33, 2.1, 1.37], [13.399, 54.925, 2.04, 0.02], [11.031, 56.383, 2.37, -0.02], [11.897, 53.695, 2.44, 0.0],
  [12.257, 57.033, 3.31, 0.08], [0.153, 59.15, 2.27, 0.34], [0.675, 56.537, 2.24, 1.17], [0.945, 60.717, 2.15, -0.15],
  [1.43, 60.235, 2.68, 0.13], [1.907, 63.67, 3.37, -0.15], [21.31, 62.585, 2.45, 0.22], [21.736, 9.875, 2.39, 1.52],
  [23.063, 28.083, 2.42, 1.67], [23.079, 15.205, 2.48, -0.04], [0.22, 15.184, 2.83, -0.23], [20.37, 40.257, 2.23, 0.67],
  [20.77, 33.97, 2.48, 1.03], [19.512, 27.96, 3.05, 1.13], [17.943, 51.489, 2.23, 1.52], [17.507, 52.301, 2.79, 0.98],
  [15.578, 26.715, 2.23, -0.02], [14.75, 27.074, 2.37, 0.97], [15.738, 6.426, 2.63, 1.17], [14.848, -16.042, 2.75, 0.15],
  [17.173, -15.725, 2.43, 0.06], [3.038, 4.09, 2.53, 1.64], [3.791, 24.105, 2.87, -0.09], [3.763, 24.367, 3.7, -0.07],
  [3.772, 23.948, 3.87, -0.1], [3.749, 24.113, 4.18, -0.1], [3.819, 24.053, 3.62, -0.08], [5.627, 21.142, 3.0, -0.19],
  [5.545, -17.822, 2.58, 0.21], [5.471, -20.759, 2.84, 0.81], [22.096, -0.32, 2.95, 0.98], [21.526, -5.571, 2.9, 0.83],
  [21.784, -16.127, 2.85, 0.18], [13.036, 10.959, 2.85, 0.94], [12.694, -1.449, 2.74, 0.36], [10.333, 19.842, 2.0, 1.13],
  [11.235, 20.524, 2.56, 0.12], [13.911, 18.398, 2.68, 0.58], [12.934, 38.318, 2.88, -0.12], [14.073, 64.376, 3.65, -0.05],
  [15.345, 71.834, 3.0, 0.05], [16.504, 21.49, 2.77, 0.94], [16.688, 31.603, 2.81, 0.65], [19.771, 10.613, 2.72, 1.5],
  [19.75, 45.131, 2.87, -0.03], [18.835, 33.363, 3.5, 0.0], [18.982, 32.69, 3.25, -0.05], [18.35, -29.828, 2.7, 1.38],
  [19.044, -29.88, 2.6, 0.08], [18.466, -25.422, 2.8, 1.04], [16.006, -22.622, 2.3, -0.12], [16.091, -19.806, 2.6, -0.07],
  [17.622, -42.998, 1.86, 0.4], [18.097, -30.424, 2.98, 1.0], [17.244, 14.39, 3.1, 1.16], [17.725, 4.567, 2.76, 1.17],
  [1.629, -57.237, 0.46, -0.16], [22.137, -46.961, 1.74, -0.07], [0.438, -42.306, 2.4, 1.09], [9.133, -43.433, 2.21, 1.66],
  [4.33, 15.627, 3.65, 0.99], [4.477, 15.871, 3.4, 0.17], [4.382, 17.543, 3.84, 0.98], [3.964, 40.01, 2.9, -0.2],
  [3.715, 47.788, 3.0, -0.13], [23.655, 77.632, 3.21, 1.03], [21.478, 70.561, 3.23, -0.2], [20.188, -0.821, 3.2, 1.3],
  [10.123, 16.763, 3.5, -0.03], [9.764, 23.774, 2.98, 0.81], [11.161, 44.498, 3.0, 1.14], [10.372, 41.499, 3.45, 0.03],
  [8.976, 11.858, 4.25, 1.08], [8.275, 9.186, 3.52, 1.48], [7.302, 16.54, 3.58, -0.1], [6.383, 22.507, 2.87, 1.64],
  [6.248, 22.514, 3.31, 1.62], [7.335, 21.982, 3.53, 0.0], [7.721, 28.884, 3.57, 1.12], [19.425, 3.115, 3.36, 0.32],
];

/** brighter-than-naked-eye limit procedural stars, denser along the Milky Way (deterministic) */
export function fieldStars(count: number): [number, number, number, number][] {
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  // galactic north pole and centre in equatorial coordinates
  const gnp = [192.85948 * D2R, 27.12825 * D2R];
  const pole = [Math.cos(gnp[1]) * Math.cos(gnp[0]), Math.cos(gnp[1]) * Math.sin(gnp[0]), Math.sin(gnp[1])];
  const out: [number, number, number, number][] = [];
  while (out.length < count) {
    const z = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    const v = [r * Math.cos(t), r * Math.sin(t), z];
    const b = Math.asin(v[0] * pole[0] + v[1] * pole[1] + v[2] * pole[2]);
    // concentrate towards the galactic plane
    if (rnd() > 0.25 + 0.75 * Math.exp(-(b * b) / 0.08)) continue;
    const ra = (Math.atan2(v[1], v[0]) / D2R + 360) % 360 / 15, dec = Math.asin(z) / D2R;
    const mag = 3.6 + Math.pow(rnd(), 0.55) * 2.6;
    out.push([ra, dec, mag, rnd() * 1.6 - 0.2]);
  }
  return out;
}
