// Seeded randomness for the rock generators, so every rock is the same on every load: a small fast generator
// (mulberry32) with helpers for ranges and picks, and 3D gradient noise (Perlin's improved noise over a
// permutation shuffled by the seed) with fractal sums. Outlines that must close round a circle sample the 3D noise on
// that circle, which makes them periodic for free.

export type Rand = () => number;

/** a uniform generator in [0, 1) from a 32-bit seed (mulberry32) */
export function rng(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const range = (r: Rand, a: number, b: number) => a + (b - a) * r();
export const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length];
/** roughly normal (the sum of three uniforms), mean 0, deviation ~1 */
export const gauss = (r: Rand) => (r() + r() + r() - 1.5) * 2;

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function grad(h: number, x: number, y: number, z: number) {
  const k = h & 15;
  const u = k < 8 ? x : y;
  const v = k < 4 ? y : k === 12 || k === 14 ? x : z;
  return ((k & 1) === 0 ? u : -u) + ((k & 2) === 0 ? v : -v);
}

/** 3D gradient noise, about -1..1, with its own seeded permutation */
export class Noise3 {
  private p = new Uint8Array(512);

  constructor(seed: number) {
    const r = rng(seed);
    const q = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = q[i]; q[i] = q[j]; q[j] = t; }
    for (let i = 0; i < 512; i++) this.p[i] = q[i & 255];
  }

  at(x: number, y: number, z: number): number {
    const p = this.p;
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[xi] + yi, AA = p[A] + zi, AB = p[A + 1] + zi;
    const B = p[xi + 1] + yi, BA = p[B] + zi, BB = p[B + 1] + zi;
    return lerp(
      lerp(lerp(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u), lerp(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u), lerp(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u), v),
      w,
    );
  }

  /** a fractal sum of `oct` octaves, each `lac` times finer and `gain` times weaker; normalised to about -1..1 */
  fbm(x: number, y: number, z: number, oct = 4, lac = 2.03, gain = 0.5): number {
    let s = 0, a = 1, n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * this.at(x, y, z);
      n += a;
      x *= lac; y *= lac; z *= lac;
      a *= gain;
    }
    return s / n;
  }

  /** noise round a circle: angle θ at radius `freq` (lobes ~ freq), offset `w` along the third axis (a different
   *  circle per w), so the result closes on itself */
  ring(theta: number, freq: number, w: number, oct = 3): number {
    return this.fbm(Math.cos(theta) * freq, w, Math.sin(theta) * freq, oct);
  }
}
