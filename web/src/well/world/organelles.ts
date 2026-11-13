// What is inside a cell, as instances. Each record is a shape the fragment shader intersects analytically — a
// sphere, a capsule along an axis, or a flattened ellipsoid — so a mitochondrion is perfectly smooth however close
// you fly to it, and a cell's worth of them costs a few thousand quads.
//
// Nothing in here knows about toxicity. The instance says where the organelle is and what kind it is; the shader
// swells it, rounds it, breaks it up, dims it or fills it with whorls from the lesion axes handed to it in a
// uniform. That way the hour dial moves the whole cell with no work on the processor at all.

import type { Cell } from './field';

export const K = {
  mito: 0,
  lysosome: 1,
  peroxisome: 2,
  lipid: 3,
  glycogen: 4,
  nucleus: 5,
  nucleolus: 6,
  foci: 7,
  bleb: 8,
  golgi: 9,
  erTube: 10,
  erSheet: 11,
} as const;

/** floats per instance: p.xyzw (centre, radius) · a.xyzw (axis, half length) · k.xyzw (kind, cell, seed, order) */
export const ORG_FLOATS = 12;
export const ORG_BYTES = ORG_FLOATS * 4;

class Rand {
  constructor(private s: number) { this.s = (s * 2654435761) >>> 0; }
  next() {
    this.s ^= this.s << 13; this.s >>>= 0;
    this.s ^= this.s >>> 17;
    this.s ^= this.s << 5; this.s >>>= 0;
    return this.s / 4294967296;
  }
  range(a: number, b: number) { return a + this.next() * (b - a); }
  dir(): [number, number, number] {
    const z = this.range(-1, 1), t = this.range(0, Math.PI * 2), r = Math.sqrt(Math.max(0, 1 - z * z));
    return [r * Math.cos(t), z, r * Math.sin(t)];
  }
}

const profile = (t: number) => 0.13 + 0.87 * Math.pow(Math.sin((t * Math.PI) / 2), 0.68);

/** the counts the world draws. A real hepatocyte carries eight hundred to two thousand mitochondria; drawing a
 *  quarter of them keeps the frame rate and the look, and the tooltip says the true figure. */
const COUNT = {
  mito: 230,
  erTube: 110,
  erSheet: 30,
  golgi: 11,
  lysosome: 58,
  peroxisome: 66,
  lipid: 76,
  glycogen: 170,
  foci: 24,
  bleb: 20,
};

const FEEDER = { mito: 34, erTube: 22, lysosome: 12, peroxisome: 10 };

export interface CellOrgs {
  data: Float32Array;
  count: number;
}

const cache = new Map<string, CellOrgs>();

export function cellOrgs(c: Cell, key: string): CellOrgs {
  const id = `${key}:${c.i}`;
  const hit = cache.get(id);
  if (hit) return hit;

  const out: number[] = [];
  const rnd = new Rand(c.i * 2166136261 + 17);
  const R = c.r * 0.9;
  let order = 0;

  const put = (
    x: number, y: number, z: number, r: number,
    ax: number, ay: number, az: number, len: number,
    kind: number, ord = 0,
  ) => {
    out.push(x, y, z, r, ax, ay, az, len, kind, c.i, rnd.next() * 1000, ord);
  };

  /** a point inside the pillow, outside the nuclei */
  const inside = (margin = 1.0, lowBias = 0): [number, number, number] => {
    for (let tries = 0; tries < 24; tries++) {
      const a = rnd.range(0, Math.PI * 2);
      const d = R * Math.sqrt(rnd.next());
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      const ceil = c.h * profile(Math.max(0, 1 - d / c.r));
      const lo = ceil * 0.12, hi = ceil * 0.94;
      if (hi - lo < margin * 2) continue;
      const u = lowBias > 0 ? Math.pow(rnd.next(), 1 + lowBias) : rnd.next();
      const y = lo + margin + u * Math.max(0.01, hi - lo - margin * 2);
      let clear = true;
      for (const n of c.nuclei) {
        if ((x - n.x) ** 2 + (y - n.y) ** 2 + (z - n.z) ** 2 < (n.r + margin) ** 2) { clear = false; break; }
      }
      if (clear) return [x, y, z];
    }
    return [c.x, c.h * 0.5, c.z];
  };

  // (the nuclei themselves are in the field-wide buffer, since every cell shows one however far off it is)
  if (c.hepatocyte) {
    // γH2AX foci: inside the nucleus, lit only when the DNA has been hit
    order = 0;
    for (let i = 0; i < COUNT.foci; i++) {
      const n = c.nuclei[i % c.nuclei.length];
      const d = rnd.dir();
      const rr = n.r * 0.85 * Math.cbrt(rnd.next());
      put(n.x + d[0] * rr, n.y + d[1] * rr, n.z + d[2] * rr, 0.17, 0, 1, 0, 0, K.foci, order++ / COUNT.foci);
    }

    // mitochondria: short rods, laid along no particular direction, a fifth of the cytoplasm
    order = 0;
    for (let i = 0; i < COUNT.mito; i++) {
      const [x, y, z] = inside(0.5);
      const d = rnd.dir();
      const hl = rnd.range(0.18, 0.58);
      put(x, y, z, rnd.range(0.2, 0.33), d[0], d[1], d[2], hl, K.mito, order++ / COUNT.mito);
    }

    // the endoplasmic reticulum: sheets stacked round the nucleus, tubules running out from them
    const n0 = c.nuclei[0];
    order = 0;
    for (let i = 0; i < COUNT.erSheet; i++) {
      const a = rnd.range(0, Math.PI * 2);
      const d = n0.r * rnd.range(1.15, 2.1);
      const x = n0.x + Math.cos(a) * d, z = n0.z + Math.sin(a) * d;
      const ceil = c.h * profile(Math.max(0, 1 - Math.hypot(x - c.x, z - c.z) / c.r));
      if (ceil < 1.2) continue;
      const y = rnd.range(ceil * 0.2, ceil * 0.82);
      const tilt = rnd.range(-0.5, 0.5);
      const nx = Math.cos(a) * tilt, nz = Math.sin(a) * tilt;
      const l = Math.hypot(nx, 1, nz);
      put(x, y, z, rnd.range(1.3, 2.4), nx / l, 1 / l, nz / l, rnd.range(0.1, 0.17), K.erSheet, order++ / COUNT.erSheet);
    }
    order = 0;
    for (let i = 0; i < COUNT.erTube; i++) {
      const [x, y, z] = inside(0.4);
      const d = rnd.dir();
      put(x, y, z, rnd.range(0.1, 0.17), d[0], d[1] * 0.4, d[2], rnd.range(0.5, 1.5), K.erTube, order++ / COUNT.erTube);
    }

    // the Golgi: a stack of flattened cisternae, out toward the cell's edge where the canaliculus is
    {
      const a = rnd.range(0, Math.PI * 2);
      const gx = c.x + Math.cos(a) * c.r * 0.6, gz = c.z + Math.sin(a) * c.r * 0.6;
      const ceil = c.h * profile(Math.max(0, 1 - 0.6));
      for (let i = 0; i < COUNT.golgi; i++) {
        const k = i / COUNT.golgi;
        put(gx + Math.cos(a) * k * 0.4, ceil * 0.52 + (k - 0.5) * 1.5, gz + Math.sin(a) * k * 0.4,
          rnd.range(1.1, 1.6), 0.08, 1, 0.05, 0.075, K.golgi, k);
      }
    }

    order = 0;
    for (let i = 0; i < COUNT.lysosome; i++) {
      const [x, y, z] = inside(0.4);
      put(x, y, z, rnd.range(0.22, 0.44), 0, 1, 0, 0, K.lysosome, order++ / COUNT.lysosome);
    }
    order = 0;
    for (let i = 0; i < COUNT.peroxisome; i++) {
      const [x, y, z] = inside(0.3);
      put(x, y, z, rnd.range(0.12, 0.3), 0, 1, 0, 0, K.peroxisome, order++ / COUNT.peroxisome);
    }
    order = 0;
    for (let i = 0; i < COUNT.lipid; i++) {
      const [x, y, z] = inside(0.4);
      put(x, y, z, rnd.range(0.28, 0.62), 0, 1, 0, 0, K.lipid, order++ / COUNT.lipid);
    }
    order = 0;
    for (let i = 0; i < COUNT.glycogen; i++) {
      const [x, y, z] = inside(0.2, 0.3);
      put(x, y, z, rnd.range(0.055, 0.11), 0, 1, 0, 0, K.glycogen, order++ / COUNT.glycogen);
    }

    // blebs: on the surface, so they only appear where a membrane could bulge
    order = 0;
    for (let i = 0; i < COUNT.bleb; i++) {
      const a = rnd.range(0, Math.PI * 2);
      const d = c.r * rnd.range(0.45, 0.95);
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      const ceil = c.h * profile(Math.max(0, 1 - d / c.r));
      put(x, ceil * rnd.range(0.7, 1.0), z, rnd.range(0.7, 1.7), 0, 1, 0, 0, K.bleb, order++ / COUNT.bleb);
    }
  } else {
    order = 0;
    for (let i = 0; i < FEEDER.mito; i++) {
      const [x, y, z] = inside(0.25);
      const d = rnd.dir();
      put(x, y, z, rnd.range(0.16, 0.26), d[0], d[1] * 0.3, d[2], rnd.range(0.2, 0.5), K.mito, order++ / FEEDER.mito);
    }
    for (let i = 0; i < FEEDER.erTube; i++) {
      const [x, y, z] = inside(0.2);
      const d = rnd.dir();
      put(x, y, z, 0.1, d[0], d[1] * 0.3, d[2], rnd.range(0.4, 1.1), K.erTube, i / FEEDER.erTube);
    }
    for (let i = 0; i < FEEDER.lysosome; i++) {
      const [x, y, z] = inside(0.25);
      put(x, y, z, rnd.range(0.18, 0.3), 0, 1, 0, 0, K.lysosome, i / FEEDER.lysosome);
    }
    for (let i = 0; i < FEEDER.peroxisome; i++) {
      const [x, y, z] = inside(0.2);
      put(x, y, z, rnd.range(0.1, 0.2), 0, 1, 0, 0, K.peroxisome, i / FEEDER.peroxisome);
    }
  }

  const res = { data: new Float32Array(out), count: out.length / ORG_FLOATS };
  cache.set(id, res);
  return res;
}

export function clearOrgCache() { cache.clear(); }

/** every cell's nuclei alone — what the far half of the field shows */
export function nucleiOnly(cells: Cell[]): CellOrgs {
  const out: number[] = [];
  for (const c of cells) {
    for (let k = 0; k < c.nuclei.length; k++) {
      const n = c.nuclei[k];
      out.push(n.x, n.y, n.z, n.r, 0, 1, 0, 0, K.nucleus, c.i, (c.seed * 997) % 1000, 0);
      const a = c.seed * 6.283 + k;
      out.push(
        n.x + Math.cos(a) * n.r * 0.3, n.y + n.r * 0.12, n.z + Math.sin(a) * n.r * 0.3,
        n.r * 0.27, 0, 1, 0, 0, K.nucleolus, c.i, (c.seed * 331) % 1000, 0,
      );
    }
  }
  return { data: new Float32Array(out), count: out.length / ORG_FLOATS };
}
