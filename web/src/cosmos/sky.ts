// The real sky's data (web/public/data/sky: stars.json, names.json and lines.json say what's in each file), and what
// turns it into the galaxy's terms: the IAU's matrix from equatorial J2000 to galactic axes (the same numbers
// shaders/c_galaxy.wgsl turns the band's picture by), and a star's colour from its B−V.
import type { Vec3 } from 'math';

/** the galaxy frame's axes (−x toward the centre, y the north galactic pole, z toward l = 90°) as equatorial J2000 unit
 *  vectors (x toward right ascension 0, z the north celestial pole): the centre, l = 90° and the pole, as the IAU's
 *  matrix has them (c_galaxy.wgsl GAL_C, GAL_L90, GAL_NP) */
export const GAL_C: Vec3 = [-0.0548755604, -0.8734370902, -0.4838350155];
export const GAL_L90: Vec3 = [0.4941094279, -0.44482963, 0.7469822445];
export const GAL_NP: Vec3 = [-0.867666149, -0.1980763734, 0.4559837762];

/** an equatorial J2000 vector (x, y, z) in the galaxy frame's axes */
export function eqToGal(x: number, y: number, z: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const ex = x, ey = y, ez = z;
  out[0] = -(ex * GAL_C[0] + ey * GAL_C[1] + ez * GAL_C[2]);
  out[1] = ex * GAL_NP[0] + ey * GAL_NP[1] + ez * GAL_NP[2];
  out[2] = ex * GAL_L90[0] + ey * GAL_L90[1] + ez * GAL_L90[2];
  return out;
}
/** a galaxy-frame vector back into equatorial J2000 */
export function galToEq(g: ArrayLike<number>, out: Vec3 = [0, 0, 0]): Vec3 {
  for (let i = 0; i < 3; i++) out[i] = -g[0] * GAL_C[i] + g[1] * GAL_NP[i] + g[2] * GAL_L90[i];
  return out;
}
/** galactic longitude and latitude (deg) of a galaxy-frame direction */
export function galLB(v: ArrayLike<number>): [number, number] {
  const r = Math.hypot(v[0], v[1], v[2]) || 1;
  return [((Math.atan2(v[2], -v[0]) * 180) / Math.PI + 360) % 360, (Math.asin(v[1] / r) * 180) / Math.PI];
}

// ---------------------------------------------------------------- colour
/** a star's temperature (K) from its B−V (Ballesteros 2012, arXiv:1201.1809: a black body's through Johnson B and V) */
export const bvTemp = (bv: number) => 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));

// the CIE 1931 colour-matching functions, Wyman, Sloan & Shirley's multi-lobe fit (JCGT 2013)
const g = (x: number, mu: number, s1: number, s2: number) => { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); };
const cieX = (l: number) => 1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2);
const cieY = (l: number) => 0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1);
const cieZ = (l: number) => 1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8);

/** a black body's colour in linear sRGB, its luminance (Y) 1 */
function blackbodyRGB(T: number): [number, number, number] {
  let X = 0, Y = 0, Z = 0;
  for (let l = 380; l <= 780; l += 5) {
    const m = l * 1e-9;
    const B = 1 / (m ** 5 * (Math.exp(0.014388 / (m * T)) - 1));
    X += B * cieX(l); Y += B * cieY(l); Z += B * cieZ(l);
  }
  X /= Y; Z /= Y; Y = 1;
  return [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z];
}

/** how much of a star's colour is kept (the rest its luminance's grey): held back, as the eye and a camera see them */
export const STAR_CHROMA = 0.62;
const BV0 = -0.4, BV1 = 2.0, BVN = 121;
let lut: Float32Array | null = null;
/** a star's colour in linear sRGB from its B−V: its luminance 1 (its flux in V carries its brightness), the white
 *  point the Sun's (a Sun-like star white, a hotter one bluish, a cooler one orange), its chroma held back */
export function bvColor(bv: number, out: number[] = [0, 0, 0]): number[] {
  if (!lut) {
    lut = new Float32Array(BVN * 3);
    const sun = blackbodyRGB(bvTemp(0.65));
    for (let i = 0; i < BVN; i++) {
      const c = blackbodyRGB(bvTemp(BV0 + ((BV1 - BV0) * i) / (BVN - 1)));
      // (white balanced on the Sun, and back to a luminance of 1)
      const r = c[0] / sun[0], gg = c[1] / sun[1], b = c[2] / sun[2];
      const Y = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      for (let k = 0; k < 3; k++) lut[i * 3 + k] = 1 + ([r, gg, b][k] / Y - 1) * STAR_CHROMA;
    }
  }
  const t = Math.max(0, Math.min(BVN - 1.001, ((bv - BV0) / (BV1 - BV0)) * (BVN - 1)));
  const i = Math.floor(t), f = t - i;
  for (let k = 0; k < 3; k++) out[k] = Math.max(0, lut[i * 3 + k] * (1 - f) + lut[(i + 1) * 3 + k] * f);
  return out;
}

// ---------------------------------------------------------------- the files
export interface Star { hip: number; pos: Vec3; V: number; bv: number; flags: number }
/** a record of stars6.bin / stars8.bin (24 bytes, little-endian: x, y, z pc equatorial J2000, V, B−V, the Hipparcos
 *  number in the low 24 bits of a u32 and its flags above): parsed into the galaxy frame's axes */
export function parseStars(buf: ArrayBuffer): Star[] {
  const dv = new DataView(buf), n = Math.floor(buf.byteLength / 24), out: Star[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 24, h = dv.getUint32(o + 20, true);
    out[i] = {
      pos: eqToGal(dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)),
      V: dv.getFloat32(o + 12, true), bv: dv.getFloat32(o + 16, true), hip: h & 0xffffff, flags: h >>> 24,
    };
  }
  return out;
}

export interface StarName { name: string; designation: string; bayer?: string }
export interface Figure { name: string; genitive: string; lines: [number, number][] }
export const skyURL = (f: string) => new URL(`data/sky/${f}`, document.baseURI).href;
export async function fetchJSON<T>(f: string): Promise<T> {
  const r = await fetch(skyURL(f));
  if (!r.ok) throw new Error(`${f}: ${r.status}`);
  return r.json() as Promise<T>;
}
export async function fetchBin(f: string): Promise<ArrayBuffer> {
  const r = await fetch(skyURL(f));
  if (!r.ok) throw new Error(`${f}: ${r.status}`);
  return r.arrayBuffer();
}
