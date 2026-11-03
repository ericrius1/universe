// The city's seeded randomness: mulberry32 behind a few helpers (ranges, picks, chances). Every part of the city takes
// its own stream forked from the city's seed and a salt (a block's index, a house's), so the same seed always builds the
// same city and changing one district leaves the others as they were.

export class Rng {
  private s: number;
  private readonly seed0: number;

  constructor(seed: number) { this.s = this.seed0 = seed >>> 0 || 1; }

  /** a uniform number in [0, 1) */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  /** an integer in [a, b] */
  int(a: number, b: number) { return a + Math.floor(this.next() * (b - a + 1)); }
  chance(p: number) { return this.next() < p; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
  /** a pick weighted by `w` */
  weighted<T>(arr: readonly T[], w: readonly number[]): T {
    let sum = 0;
    for (const x of w) sum += x;
    let r = this.next() * sum;
    for (let i = 0; i < arr.length; i++) { r -= w[i]; if (r < 0) return arr[i]; }
    return arr[arr.length - 1];
  }
  /** a new stream from this one's seed and a salt (independent of how much this one has been drawn) */
  fork(salt: number): Rng { return new Rng(hash2(this.seed0, salt)); }
}

/** an integer hash of two integers */
function hash2(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return h >>> 0;
}
