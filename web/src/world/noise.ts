// Hash and value noise, bit-for-bit the same as shaders/noise.wgsl: the meshes built here and the molecules the GPU
// places on them read the same surfaces. PCG3D (Jarzynski & Olano 2020) on u32 lattice coordinates; value noise is
// trilinear over hashed corners with a quintic fade.
export type V3 = [number, number, number];

export function pcg3(x: number, y: number, z: number): V3 {
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  z = (Math.imul(z, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0; z = (z ^ (z >>> 16)) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0;
  return [x, y, z];
}
const U = 1 / 4294967296;
/** three uniform numbers in [0, 1) from integer coordinates */
export const hash3 = (x: number, y: number, z: number): V3 => { const h = pcg3(x | 0, y | 0, z | 0); return [h[0] * U, h[1] * U, h[2] * U]; };

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const corner = (x: number, y: number, z: number) => pcg3(x | 0, y | 0, z | 0)[0] * U * 2 - 1;

/** value noise in [-1, 1] */
export function vnoise(px: number, py: number, pz: number): number {
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  const fx = fade(px - ix), fy = fade(py - iy), fz = fade(pz - iz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(corner(ix, iy, iz), corner(ix + 1, iy, iz), fx), l(corner(ix, iy + 1, iz), corner(ix + 1, iy + 1, iz), fx), fy),
    l(l(corner(ix, iy, iz + 1), corner(ix + 1, iy, iz + 1), fx), l(corner(ix, iy + 1, iz + 1), corner(ix + 1, iy + 1, iz + 1), fx), fy),
    fz);
}

/** a few octaves of value noise, amplitude halving, frequency doubling (offset per octave so they don't line up) */
export function fbm(px: number, py: number, pz: number, octaves: number): number {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) {
    s += a * vnoise(px * f + i * 17.13, py * f + i * 7.71, pz * f + i * 3.37);
    a *= 0.5; f *= 2.03;
  }
  return s;
}

/** a seeded random stream for building the world */
export class Rng {
  private i = 0;
  constructor(readonly seed: number) {}
  next() { return hash3(this.seed, this.i++, 0x5eed)[0]; }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  int(a: number, b: number) { return Math.floor(this.range(a, b + 1 - 1e-9)); }
  pick<T>(xs: readonly T[]) { return xs[Math.floor(this.next() * xs.length)]; }
  /** a uniformly random unit vector */
  dir(): V3 {
    const z = this.range(-1, 1), a = this.range(0, Math.PI * 2), r = Math.sqrt(1 - z * z);
    return [r * Math.cos(a), r * Math.sin(a), z];
  }
  gauss() { return Math.sqrt(-2 * Math.log(1 - this.next())) * Math.cos(2 * Math.PI * this.next()); }
}
