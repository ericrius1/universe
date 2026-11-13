// The monolayer: a field of cells on the floor of a well, built as real geometry so that the border between two
// cells is a real crease and the bile canaliculus in it is a real tube.
//
// The sites are a jittered grid, one per grid square, so a cell's index is its square and a lookup into the state
// buffer is free. Each site's territory is the Voronoi cell — the square clipped by the perpendicular bisector to
// every neighbour — then pulled in by a micrometre to leave the groove where the membranes meet. Over that
// footprint sits a pillow: a rim ring, two intermediate rings and an apex, with a skirt dropping to the floor.
//
// Units are micrometres throughout, y up. That turns out to be a good human scale to fly at: a mitochondrion is
// about a metre long, a cell is a thirty-metre room, and the floor of the well is a plaza.

import { Scratch } from './mesh';
import type { System } from '../data/systems';

export interface Cell {
  i: number;
  /** the grid square */
  gx: number;
  gz: number;
  /** centre, µm */
  x: number;
  z: number;
  /** the Voronoi polygon, and the same pulled in to leave the groove */
  poly: [number, number][];
  inset: [number, number][];
  /** the neighbour across each edge k (poly[k] → poly[k+1]), or -1 at the field's edge */
  nbr: number[];
  hepatocyte: boolean;
  /** mean radius and apex height, µm */
  r: number;
  h: number;
  /** nuclei, in world µm */
  nuclei: { x: number; y: number; z: number; r: number }[];
  seed: number;
  /** 0..1, how deep inside a hepatocyte island this cell sits */
  island: number;
}

export interface Canal {
  /** the two cells it runs between */
  a: number;
  b: number;
  /** a blind pocket rather than part of a network: it stops short at both ends */
  pocket: boolean;
  /** the ends, µm */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
}

export interface Field {
  extent: number;
  pitch: number;
  cols: number;
  cells: Cell[];
  canals: Canal[];
  /** grid square → cell index */
  at(gx: number, gz: number): Cell | undefined;
  /** the cell whose territory contains a point, or undefined off the field */
  pick(x: number, z: number): Cell | undefined;
}

const hash = (a: number, b: number, c = 0) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b ^ 0xc2b2ae35, 0x27d4eb2f) ^ Math.imul(c + 1, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

/** smooth value noise on the grid, for the hepatocyte islands */
const noise2 = (x: number, y: number, seed: number) => {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
};

/** clip a convex polygon by the half-plane of points nearer `p` than `q` */
function clipBisector(poly: [number, number][], px: number, pz: number, qx: number, qz: number) {
  const mx = (px + qx) / 2, mz = (pz + qz) / 2;
  const dx = qx - px, dz = qz - pz;
  const side = (x: number, z: number) => (x - mx) * dx + (z - mz) * dz;
  const out: [number, number][] = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length];
    const sa = side(a[0], a[1]), sb = side(b[0], b[1]);
    if (sa <= 0) out.push(a);
    if (sa * sb < 0) {
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

export function buildField(system: System, seedBase = 7): Field {
  const pitch = system.cellSize;
  const extent = Math.round(520 / pitch) * pitch;
  const cols = Math.round(extent / pitch);
  const half = extent / 2;

  const sx: number[] = [], sz: number[] = [];
  for (let gz = 0; gz < cols; gz++) {
    for (let gx = 0; gx < cols; gx++) {
      const j = 0.33 * pitch;
      sx.push(-half + (gx + 0.5) * pitch + (hash(gx, gz, seedBase) * 2 - 1) * j);
      sz.push(-half + (gz + 0.5) * pitch + (hash(gx, gz, seedBase + 31) * 2 - 1) * j);
    }
  }

  const cells: Cell[] = [];
  for (let gz = 0; gz < cols; gz++) {
    for (let gx = 0; gx < cols; gx++) {
      const i = gz * cols + gx;
      const px = sx[i], pz = sz[i];
      // the starting territory: a box round the site, kept inside the field so the edge cells are not giants
      const x0 = Math.max(px - pitch * 1.4, -half), x1 = Math.min(px + pitch * 1.4, half);
      const z0 = Math.max(pz - pitch * 1.4, -half), z1 = Math.min(pz + pitch * 1.4, half);
      let poly: [number, number][] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
      const neigh: number[] = [];
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (!dx && !dz) continue;
          const nx = gx + dx, nz = gz + dz;
          if (nx < 0 || nz < 0 || nx >= cols || nz >= cols) continue;
          const j = nz * cols + nx;
          neigh.push(j);
          poly = clipBisector(poly, px, pz, sx[j], sz[j]);
          if (poly.length < 3) break;
        }
      }
      if (poly.length < 3) continue;

      // which neighbour each edge faces: the one that is as near the edge's midpoint as this site is
      const nbr: number[] = [];
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length];
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        const d0 = Math.hypot(mx - px, mz - pz);
        let best = -1, bestErr = 0.08 * pitch;
        for (const j of neigh) {
          const e = Math.abs(Math.hypot(mx - sx[j], mz - sz[j]) - d0);
          if (e < bestErr) { bestErr = e; best = j; }
        }
        nbr.push(best);
      }

      // the hepatocyte islands: a low-frequency field, in the co-culture only
      const n = noise2(gx / 3.1, gz / 3.1, seedBase + 97) * 0.65 + noise2(gx / 1.6, gz / 1.6, seedBase + 131) * 0.35;
      const island = system.colony > 0.4 ? Math.max(0, Math.min(1, (n - 0.34) * 2.6)) : 1;
      const hepatocyte = system.colony > 0.4 ? island > 0.08 : true;

      let r = 0;
      for (const v of poly) r += Math.hypot(v[0] - px, v[1] - pz);
      r /= poly.length;

      const gap = hepatocyte ? 1.15 : 0.8;
      const inset = poly.map((v) => {
        const dx = v[0] - px, dz = v[1] - pz;
        const d = Math.hypot(dx, dz) || 1;
        const k = Math.max(0.25, 1 - gap / d);
        return [px + dx * k, pz + dz * k] as [number, number];
      });

      const seed = hash(gx, gz, seedBase + 211);
      // a hepatocyte is cuboidal where it is held and flat where it is not; a feeder cell is always a thin sheet
      const h = hepatocyte ? (r * 0.86) / system.spread : r * 0.17;

      const nuclei: Cell['nuclei'] = [];
      if (hepatocyte) {
        const two = seed > 0.78;
        const nr = Math.min(r * (two ? 0.22 : 0.27), pitch * 0.2);
        if (two) {
          const a = seed * 6.28;
          for (const s of [-1, 1]) nuclei.push({ x: px + Math.cos(a) * nr * s * 1.05, y: h * 0.5, z: pz + Math.sin(a) * nr * s * 1.05, r: nr });
        } else {
          nuclei.push({ x: px + (seed - 0.5) * r * 0.2, y: h * 0.52, z: pz + (hash(gx, gz, 17) - 0.5) * r * 0.2, r: nr });
        }
      } else {
        nuclei.push({ x: px, y: h * 0.62, z: pz, r: Math.min(r * 0.24, pitch * 0.17) });
      }

      cells.push({ i, gx, gz, x: px, z: pz, poly, inset, nbr, hepatocyte, r, h, nuclei, seed, island });
    }
  }

  const byIndex = new Map(cells.map((c) => [c.i, c]));

  // the canalicular network: along the border between two hepatocytes. In the co-culture nearly every such border
  // carries one, so the lumens meet at the Voronoi vertices and the network joins up and goes somewhere. In a flat
  // monoculture only a few do, and what you get is blind pockets.
  const canals: Canal[] = [];
  const seen = new Set<number>();
  for (const c of cells) {
    if (!c.hepatocyte) continue;
    for (let k = 0; k < c.poly.length; k++) {
      const j = c.nbr[k];
      if (j < 0 || j <= c.i) continue;
      const o = byIndex.get(j);
      if (!o || !o.hepatocyte) continue;
      const key = c.i * 1e6 + j;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = c.poly[k], b = c.poly[(k + 1) % c.poly.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < pitch * 0.18) continue;
      const p = system.canaliculi;
      if (hash(c.i, j, 503) > p * (0.55 + 0.45 * Math.min(c.island, o.island))) continue;
      const pocket = system.canaliculi < 0.6;
      canals.push({ a: c.i, b: j, pocket, x0: a[0], z0: a[1], x1: b[0], z1: b[1], y: Math.min(c.h, o.h) * 0.3 });
    }
  }

  return {
    extent,
    pitch,
    cols,
    cells,
    canals,
    at: (gx, gz) => (gx < 0 || gz < 0 || gx >= cols || gz >= cols ? undefined : byIndex.get(gz * cols + gx)),
    pick(x, z) {
      const gx = Math.floor((x + half) / pitch), gz = Math.floor((z + half) / pitch);
      let best: Cell | undefined, bd = Infinity;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const c = this.at(gx + dx, gz + dz);
          if (!c) continue;
          const d = (c.x - x) ** 2 + (c.z - z) ** 2;
          if (d < bd) { bd = d; best = c; }
        }
      return best;
    },
  };
}

// ---------------------------------------------------------------------------------------------- the geometry

const RINGS = [0, 0.4, 0.72] as const;
const profile = (t: number) => 0.13 + 0.87 * Math.pow(Math.sin((t * Math.PI) / 2), 0.68);

export function fieldScratch(f: Field): { mesh: Scratch; canals: Scratch; flat: number } {
  const m = new Scratch();

  for (const c of f.cells) {
    const n = c.inset.length;
    const ringIdx: number[][] = [];
    for (const t of RINGS) {
      const row: number[] = [];
      for (const v of c.inset) {
        const x = c.x + (v[0] - c.x) * (1 - t);
        const z = c.z + (v[1] - c.z) * (1 - t);
        row.push(m.vertex(x, c.h * profile(t), z, t, 0, c.i));
      }
      ringIdx.push(row);
    }
    const apex = m.vertex(c.x, c.h * profile(1), c.z, 1, 0, c.i);
    // the skirt: the same rim, dropped to the floor, so the groove between two cells has a wall
    const foot: number[] = [];
    for (const v of c.inset) foot.push(m.vertex(v[0], 0, v[1], 0, 1, c.i));

    for (let r = 0; r < ringIdx.length - 1; r++)
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        m.tri(ringIdx[r][k], ringIdx[r + 1][k], ringIdx[r][k2]);
        m.tri(ringIdx[r][k2], ringIdx[r + 1][k], ringIdx[r + 1][k2]);
      }
    const last = ringIdx[ringIdx.length - 1];
    for (let k = 0; k < n; k++) m.tri(last[k], apex, last[(k + 1) % n]);
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      m.tri(foot[k], ringIdx[0][k], foot[k2]);
      m.tri(foot[k2], ringIdx[0][k], ringIdx[0][k2]);
    }
  }
  const flat = m.smooth();

  // the canaliculi: a tube along each border, and a knot where three of them meet
  const q = new Scratch();
  const SEG = 7;
  const knots = new Map<string, [number, number, number, number]>();
  for (const c of f.canals) {
    // a pocket stops short of both ends: it goes nowhere, which is the whole point of it
    const t0 = c.pocket ? 0.26 : 0, t1 = c.pocket ? 0.74 : 1;
    const fx0 = c.x0 + (c.x1 - c.x0) * t0, fz0 = c.z0 + (c.z1 - c.z0) * t0;
    const dx = (c.x1 - c.x0) * (t1 - t0), dz = (c.z1 - c.z0) * (t1 - t0);
    const len = Math.hypot(dx, dz) || 1;
    const ax = dx / len, az = dz / len;
    const r = c.pocket ? 0.38 : 0.46;
    const base = q.count;
    for (let s = 0; s <= 1; s++) {
      for (let k = 0; k < SEG; k++) {
        const a = (k / SEG) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        // the tube's circle, in the plane normal to the border it runs along
        const ox = -az * ca, oz = ax * ca, oy = sa;
        q.vertex(fx0 + dx * s + ox * r, c.y + oy * r, fz0 + dz * s + oz * r, s, k / SEG, c.a, [ox, oy, oz]);
      }
    }
    for (let k = 0; k < SEG; k++) {
      const k2 = (k + 1) % SEG;
      q.tri(base + k, base + SEG + k, base + k2);
      q.tri(base + k2, base + SEG + k, base + SEG + k2);
    }
    if (!c.pocket) {
      knots.set(`${Math.round(c.x0 * 4)},${Math.round(c.z0 * 4)}`, [c.x0, c.y, c.z0, c.a]);
      knots.set(`${Math.round(c.x1 * 4)},${Math.round(c.z1 * 4)}`, [c.x1, c.y, c.z1, c.a]);
    } else {
      for (const [ex, ez] of [[fx0, fz0], [fx0 + dx, fz0 + dz]]) {
        const bs = q.count;
        for (let j = 0; j <= 3; j++) {
          const phi = (j / 3) * Math.PI;
          for (let k = 0; k <= 5; k++) {
            const th = (k / 5) * Math.PI * 2;
            const nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
            q.vertex(ex + nx * r, c.y + ny * r, ez + nz * r, 0.5, k / 5, c.a, [nx, ny, nz]);
          }
        }
        for (let j = 0; j < 3; j++)
          for (let k = 0; k < 5; k++) {
            const a2 = bs + j * 6 + k;
            q.tri(a2, a2 + 6, a2 + 1);
            q.tri(a2 + 1, a2 + 6, a2 + 7);
          }
      }
    }
  }
  for (const [, [x, y, z, cell]] of knots) {
    const base = q.count;
    const R = 0.5;
    for (let j = 0; j <= 4; j++) {
      const phi = (j / 4) * Math.PI;
      for (let k = 0; k <= 6; k++) {
        const th = (k / 6) * Math.PI * 2;
        const nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
        q.vertex(x + nx * R, y + ny * R, z + nz * R, 0.5, k / 6, cell, [nx, ny, nz]);
      }
    }
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 6; k++) {
        const a = base + j * 7 + k, b = a + 1, c2 = a + 7, d = c2 + 1;
        q.tri(a, c2, b);
        q.tri(b, c2, d);
      }
  }

  return { mesh: m, canals: q, flat };
}
