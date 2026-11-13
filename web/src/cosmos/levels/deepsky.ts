// What the deep sky's levels share: the catalogues' axes turned into the ladder's, the data fetched the first time a
// level shows, and an image's bytes decoded off the main thread (deepsky.worker.ts).
//
// The catalogues (data/galaxies: 2MRS, the density, the Local Group, the named structures) are heliocentric in
// equatorial J2000 axes; the microwave background's map is in galactic coordinates; the levels are in the galaxy's axes
// (−x toward the centre, y the north galactic pole, z toward l = 90°: levels/local.ts galDir) or the cosmos frame's,
// which is the galaxy's turned by the ladder (frames.ts: its disc tilted in the cosmic web) about the galactic centre.
// The turn between equatorial and galactic is the IAU's (as c_galaxy.wgsl GAL_C, GAL_L90, GAL_NP).
import { vec3, type Vec3 } from 'math';
import type { Ladder } from '../frames';

/** the galactic centre (l = 0, b = 0), l = 90° and the north galactic pole as unit vectors in equatorial J2000 axes */
export const GAL_C: Vec3 = [-0.0548755604, -0.8734370902, -0.4838350155];
export const GAL_L90: Vec3 = [0.4941094279, -0.44482963, 0.7469822445];
export const GAL_NP: Vec3 = [-0.867666149, -0.1980763734, 0.4559837762];

/** an equatorial direction (or point) in the galaxy's axes */
export function eqToGal(e: ArrayLike<number>, out: Vec3 = [0, 0, 0]): Vec3 {
  const x = e[0], y = e[1], z = e[2];
  const gx = x * GAL_C[0] + y * GAL_C[1] + z * GAL_C[2];
  const gy = x * GAL_L90[0] + y * GAL_L90[1] + z * GAL_L90[2];
  const gz = x * GAL_NP[0] + y * GAL_NP[1] + z * GAL_NP[2];
  out[0] = -gx; out[1] = gz; out[2] = gy;
  return out;
}

/** galactic longitude and latitude (deg) of a direction in the galaxy's axes */
export function lbOf(g: ArrayLike<number>): [number, number] {
  const r = Math.hypot(g[0], g[1], g[2]) || 1;
  return [((Math.atan2(g[2], -g[0]) * 180) / Math.PI + 360) % 360, (Math.asin(g[1] / r) * 180) / Math.PI];
}

/** the catalogues' heliocentric equatorial megaparsecs to the cosmos frame's (and back, for the shaders) */
export class SkyAxes {
  /** galaxy axes → cosmos axes, as rows (m[i] · v is the cosmos frame's i-th component) */
  readonly gal: Vec3[];
  /** the Sun in the cosmos frame (Mpc) */
  readonly sun: Vec3;
  constructor(ladder: Ladder) {
    const q = ladder.galaxy.rot;
    const cols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((v) => vec3.transformQuat([0, 0, 0], v as Vec3, q));
    this.gal = [0, 1, 2].map((i) => [cols[0][i], cols[1][i], cols[2][i]] as Vec3);
    this.sun = ladder.pointInto(ladder.local, ladder.cosmos, [0, 0, 0]);
  }
  /** a direction in the galaxy's axes into the cosmos frame's */
  galToCosmos(g: ArrayLike<number>, out: Vec3 = [0, 0, 0]): Vec3 {
    const m = this.gal;
    const x = g[0], y = g[1], z = g[2];
    out[0] = m[0][0] * x + m[0][1] * y + m[0][2] * z;
    out[1] = m[1][0] * x + m[1][1] * y + m[1][2] * z;
    out[2] = m[2][0] * x + m[2][1] * y + m[2][2] * z;
    return out;
  }
  /** a heliocentric equatorial point (Mpc) in the cosmos frame (Mpc) */
  eqToCosmos(e: ArrayLike<number>, out: Vec3 = [0, 0, 0]): Vec3 {
    this.galToCosmos(eqToGal(e, out), out);
    out[0] += this.sun[0]; out[1] += this.sun[1]; out[2] += this.sun[2];
    return out;
  }
  /** for a shader: the cosmos frame (Mpc) to heliocentric equatorial (Mpc), as three rows (w: the translation), and the
   *  cosmos frame's axes to the galaxy's (three rows) */
  uniforms() {
    // cosmos → galaxy is the transpose of galaxy → cosmos; galaxy → equatorial: e = −g.x C + g.z L90 + g.y NP
    const toGal = [0, 1, 2].map((i) => [this.gal[0][i], this.gal[1][i], this.gal[2][i]]);
    const g2e = [0, 1, 2].map((i) => [-GAL_C[i], GAL_NP[i], GAL_L90[i]]);
    const A = [0, 1, 2].map((i) => [0, 1, 2].map((j) => g2e[i][0] * toGal[0][j] + g2e[i][1] * toGal[1][j] + g2e[i][2] * toGal[2][j]));
    const t = A.map((r) => -(r[0] * this.sun[0] + r[1] * this.sun[1] + r[2] * this.sun[2]));
    return {
      ex: [...A[0], t[0]] as [number, number, number, number],
      ey: [...A[1], t[1]] as [number, number, number, number],
      ez: [...A[2], t[2]] as [number, number, number, number],
      gx: [...toGal[0], 0] as [number, number, number, number],
      gy: [...toGal[1], 0] as [number, number, number, number],
      gz: [...toGal[2], 0] as [number, number, number, number],
    };
  }
}

/** a data file's URL (the page's data/ folder) */
export const dataUrl = (file: string) => new URL(`data/${file}`, document.baseURI).href;

export async function fetchJson<T>(file: string): Promise<T> {
  const r = await fetch(dataUrl(file));
  if (!r.ok) throw new Error(`${file}: ${r.status}`);
  return r.json() as Promise<T>;
}
export async function fetchBytes(file: string): Promise<ArrayBuffer> {
  const r = await fetch(dataUrl(file));
  if (!r.ok) throw new Error(`${file}: ${r.status}`);
  return r.arrayBuffer();
}

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { ok: (v: DecodedImage) => void; fail: (e: Error) => void }>();
export interface DecodedImage { width: number; height: number; data: Uint8Array; stars: Float32Array | null }

/** an image's bytes, decoded and (at most `max` a side) shrunk off the main thread: 'gray' its first channel, 'rgba'
 *  the first file's colour with the second's first channel as alpha (the face-on map and its dust), and `stars` of
 *  the Milky Way's drawn from it (galaxymap.ts) */
export function decodeImage(files: string[], mode: 'gray' | 'rgba', max = 0, stars = 0): Promise<DecodedImage> {
  if (!worker) {
    worker = new Worker(new URL('./deepsky.worker.ts', import.meta.url), { type: 'module', name: 'deepsky' });
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { id: number; error?: string } & DecodedImage;
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      if (m.error) w.fail(new Error(m.error)); else w.ok({ width: m.width, height: m.height, data: m.data, stars: m.stars ?? null });
    };
  }
  const id = nextId++;
  return new Promise((ok, fail) => {
    waiting.set(id, { ok, fail });
    worker!.postMessage({ id, urls: files.map(dataUrl), mode, max, stars });
  });
}

/** a named thing a guide can point at: where it is in its level's frame (the cosmos frame, megaparsecs) */
export interface NamedPlace {
  name: string;
  /** cluster, supercluster, void, wall; or the Local Group's types: spiral, elliptical, irregular, spheroidal */
  kind: string;
  /** another name it goes by (M31) */
  aka?: string;
  /** the frame its place is in, and the place */
  frame: 'cosmos';
  at: Vec3;
  /** from the Sun (Mpc) */
  distanceMpc: number;
  /** where it is on our sky (deg) */
  l: number;
  b: number;
}
