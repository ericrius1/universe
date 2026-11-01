// The floating origin. The CPU keeps every position in doubles (`math`'s vec3 are plain arrays of numbers); the GPU
// works in float32, which near 10 µm from the world's origin can only step by ~0.001 nm — about a pixel when the view
// is a nanometre across. So the GPU never sees an absolute position it does arithmetic on: each frame the origin moves
// to the focus (rounded to a float32, so the CPU and the GPU agree on it exactly), the camera sits at eye − origin, and
// every shader subtracts G.origin from an absolute position the moment it loads one (organelles, meshes, filament
// segments, the molecular field's chunks). Those stored values keep their own rounding, but it is the same every
// frame: nothing moves unless the world does. Motion (the molecules' wobble, the walkers, a game's actors) is added
// after the subtraction, so it is never quantised to the coarse steps of a big number. Noise that patterns a surface
// is still sampled at the absolute point (p + G.origin): at the frequencies it runs at, its rounding is invisible.
import type { Vec3 } from 'math';

/** this frame's origin (nm), exactly representable in float32 */
export const origin: Vec3 = [0, 0, 0];

/** move the origin to `p` (rounded to float32) */
export function setOrigin(p: Vec3) {
  origin[0] = Math.fround(p[0]); origin[1] = Math.fround(p[1]); origin[2] = Math.fround(p[2]);
}

/** an absolute position relative to the origin (in doubles, so exact until it's written to the GPU) */
export function rel(p: ArrayLike<number>, out: Vec3 = [0, 0, 0]): Vec3 {
  out[0] = p[0] - origin[0]; out[1] = p[1] - origin[1]; out[2] = p[2] - origin[2];
  return out;
}

/** a position relative to the origin back to absolute */
export function abs(p: ArrayLike<number>, out: Vec3 = [0, 0, 0]): Vec3 {
  out[0] = p[0] + origin[0]; out[1] = p[1] + origin[1]; out[2] = p[2] + origin[2];
  return out;
}

/** biological time as the GPU gets it: wrapped so a float32 still resolves a frame's step at the slowest time scale
 *  (a hundredth: ~0.2 ms). 1024 s is a whole number of turns for everything that spins (ATP synthase's 150 Hz). */
export const TIME_WRAP = 1024;
export const gpuTime = (t: number) => t - Math.floor(t / TIME_WRAP) * TIME_WRAP;
