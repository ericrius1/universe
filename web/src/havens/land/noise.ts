// The canyon's hashes and noise, written so the GPU's copies in canyon.wgsl give the same numbers: integer hashes
// (Math.imul wraps exactly as WGSL's u32 multiply does), floats made from 24 of a hash's bits (exact in f32 and f64),
// quintic-faded gradient noise whose gradients come straight from the hash bits, and no trigonometry anywhere (a
// GPU's sin of a large argument is not a CPU's). Noise is asked for in metres with a wavelength, and finds its lattice
// cell and the fraction across it from the metres themselves ((x - cell * wave) / wave): x / wave at 60 km would keep
// only ~1e-5 of the fraction in f32, this keeps ~1e-7, so the GPU's far levels agree with the CPU's. Each function
// here has a twin in canyon.wgsl named with a cn prefix.

/** a 32-bit hash of an integer lattice point and a seed */
export function hashU(ix: number, iz: number, s: number): number {
  let h = Math.imul(ix, 0x27d4eb2f) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(s, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** a hash as a float in [0, 1): its top 24 bits */
export function hashF(ix: number, iz: number, s: number): number {
  return (hashU(ix, iz, s) >>> 8) / 16777216;
}

/** a corner's gradient (each component in [-1, 1) from 16 bits) dotted with the offset to the point */
function grad(h: number, dx: number, dz: number): number {
  return ((h & 0xffff) / 32768 - 1) * dx + ((h >>> 16) / 32768 - 1) * dz;
}

/** 2D gradient noise at (x, z) metres with wavelength `wave` metres, about -0.8..0.8, zero on the lattice */
export function noise(x: number, z: number, wave: number, s: number): number {
  const cx = Math.floor(x / wave), cz = Math.floor(z / wave);
  const fx = (x - cx * wave) / wave, fz = (z - cz * wave) / wave;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const n00 = grad(hashU(cx, cz, s), fx, fz);
  const n10 = grad(hashU(cx + 1, cz, s), fx - 1, fz);
  const n01 = grad(hashU(cx, cz + 1, s), fx, fz - 1);
  const n11 = grad(hashU(cx + 1, cz + 1, s), fx - 1, fz - 1);
  return n00 + u * (n10 - n00) + v * (n01 - n00) + u * v * (n00 - n10 - n01 + n11);
}

/** the derivative of the last noise1, per wavelength */
export let noise1D = 0;

/** 1D gradient noise at t metres with wavelength `wave`, about -0.5..0.5, and its derivative (noise1D) */
export function noise1(t: number, wave: number, s: number): number {
  const i = Math.floor(t / wave), f = (t - i * wave) / wave;
  const g0 = (hashU(i, 0, s) >>> 8) / 8388608 - 1, g1 = (hashU(i + 1, 0, s) >>> 8) / 8388608 - 1;
  const n0 = g0 * f, n1 = g1 * (f - 1);
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  const du = 30 * f * f * (f - 1) * (f - 1);
  noise1D = g0 + du * (n1 - n0) + u * (g1 - g0);
  return n0 + u * (n1 - n0);
}

/** fractal gradient noise: `oct` octaves from wavelength `wave` (m) halving each time, each its own seed and shifted
 *  off the last's lattice; octaves shorter than `minWave` fade out (a coarse level can't hold them) */
export function fbm(x: number, z: number, wave: number, oct: number, s: number, minWave: number): number {
  let a = 0.5, sum = 0, w = wave;
  for (let i = 0; i < oct; i++) {
    sum += a * noise(x + i * 0.37 * w, z - i * 0.61 * w, w, s + i) * smoothstep(minWave, 2 * minWave, w);
    a *= 0.5; w *= 0.5;
  }
  return sum;
}

export function clamp(x: number, a: number, b: number): number { return x < a ? a : x > b ? b : x; }
export function mix(a: number, b: number, t: number): number { return a + (b - a) * t; }
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
/** polynomial smooth minimum: within `k` of each other the two blend into a rounded floor */
export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
/** smooth maximum, the mirror of smin */
export function smax(a: number, b: number, k: number): number { return -smin(-a, -b, k); }
