// The cell, laid out once from a seed: every organelle as an analytic shape (a star-shaped blob, a capsule or a bent
// disc, each with a noisy surface), and the filaments as polylines. Units are nanometres; the cell sits at the origin.
// The same shapes are evaluated on the GPU (shaders/world.wgsl, sdOrganelle) to put molecules on and inside them, so
// every surface function here has a twin there.
import { TISSUE, tissueNear, tissueRand } from '../cosmos/tissue';
import { Rng, fbm, vnoise, type V3 } from './noise';

export const enum Kind {
  Cell = 0, Nucleus = 1, Nucleolus = 2, Mito = 3, Crista = 4, ER = 5, Golgi = 6, Lysosome = 7, Peroxisome = 8,
  Endosome = 9, Vesicle = 10, Droplet = 11, Neighbor = 12, NeighborNucleus = 13,
}
export const enum Shape { Blob = 0, Capsule = 1, Disc = 2 }

export interface Organelle {
  kind: Kind;
  shape: Shape;
  /** blob: centre; capsule: one end of the axis; disc: centre */
  a: V3;
  /** blob: semi-axes; capsule: the other end; disc: unit normal (toward the bowl's inside) */
  b: V3;
  /** capsule / disc radius (blob: its mean radius, for noise scale and bounds) */
  r: number;
  /** surface noise amplitude (nm; disc: fraction of the radius, on its outline) */
  amp: number;
  /** surface noise frequency (cycles per nm) */
  freq: number;
  seed: number;
  /** membrane: a shell this thick (blob/capsule); disc: its full thickness */
  thick: number;
  /** disc: radius of the sphere it is bent on */
  bend: number;
  /** index of the organelle this one sits inside (-1: none) */
  parent: number;
  /** bounding sphere */
  center: V3;
  bound: number;
}

export interface Filament {
  kind: FilKind;
  points: V3[];
  radius: number;
}
export const enum FilKind { Microtubule = 0, Actin = 1, Intermediate = 2, Chromatin = 3, Collagen = 4 }

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const v3 = { add, sub, mul, dot, len, norm, cross };

/** a disc's tangent frame (the same on the GPU: discFrame in world.wgsl) */
export function discFrame(n: V3): [V3, V3] {
  const t1 = norm(cross(n, Math.abs(n[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0]));
  return [t1, cross(n, t1)];
}

// ------------------------------------------------------------------ surfaces (twins of world.wgsl)
/** a blob's radius along unit direction u (ellipsoid semi-axes + noise on the direction) */
export function blobRadius(o: Organelle, u: V3): number {
  const e = 1 / Math.sqrt((u[0] / o.b[0]) ** 2 + (u[1] / o.b[1]) ** 2 + (u[2] / o.b[2]) ** 2);
  const k = o.r * o.freq;
  return e + o.amp * fbm(u[0] * k + o.seed, u[1] * k, u[2] * k, 3);
}
/** a capsule's radius at a point of its undisplaced surface */
export function capsuleRadius(o: Organelle, s: V3): number {
  return o.r + o.amp * fbm(s[0] * o.freq + o.seed, s[1] * o.freq, s[2] * o.freq, 2);
}
/** a disc's outline radius at azimuth (cos, sin) */
export function discRim(o: Organelle, c: number, s: number): number {
  return o.r * (1 + o.amp * (vnoise(c * 2.3 + o.seed, s * 2.3, o.seed * 0.37) * 0.7 + vnoise(c * 5.1, s * 5.1 + o.seed, 1.7) * 0.3));
}

/** signed distance (approximate, exact on the surface) to the organelle's outer surface; negative inside */
export function sdOrganelle(o: Organelle, p: V3): number {
  if (o.shape === Shape.Blob) {
    const q = sub(p, o.a), d = len(q);
    if (d < 1e-6) return -o.r;
    return d - blobRadius(o, mul(q, 1 / d));
  }
  if (o.shape === Shape.Capsule) {
    const ab = sub(o.b, o.a), t = Math.max(0, Math.min(1, dot(sub(p, o.a), ab) / dot(ab, ab)));
    const s = add(o.a, mul(ab, t)), q = sub(p, s), d = len(q);
    if (d < 1e-6) return -o.r;
    return d - capsuleRadius(o, add(s, mul(q, o.r / d)));
  }
  const n = o.b, sc = add(o.a, mul(n, o.bend)), q = sub(p, sc), rho = len(q);
  const v = mul(q, 1 / rho);
  const [t1, t2] = discFrame(n);
  const pc = dot(v, t1), ps = dot(v, t2), pl = Math.hypot(pc, ps) || 1;
  const alpha = Math.atan2(pl, -dot(v, n));
  const rim = discRim(o, pc / pl, ps / pl);
  const arc = Math.max(0, alpha - rim / o.bend) * o.bend;
  return Math.hypot(arc, rho - o.bend) - o.thick / 2;
}

// ------------------------------------------------------------------ the cutaway
/** the wedge cut out of the cell: vertical, centred on `yaw` (the first view's direction), `half` radians each side */
export const WEDGE = { yaw: 0.62, half: 0.9, center: [0, 600, 0] as V3, radius: 12500 };
/** how far inside the wedge a point is (radians past its edge; negative = outside it) */
export function wedgeDepth(p: V3): number {
  const x = p[0] - WEDGE.center[0], z = p[2] - WEDGE.center[2];
  if (Math.hypot(x, p[1] - WEDGE.center[1], z) > WEDGE.radius) return -10;
  const a = Math.atan2(x, z) - WEDGE.yaw;
  return WEDGE.half - Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
}

// ------------------------------------------------------------------ the layout
export interface World {
  organelles: Organelle[];
  filaments: Filament[];
  centrosome: V3;
  cell: Organelle;
  nucleus: Organelle;
  /** named places for the tour and the menu */
  places: Record<string, { at: V3; scale: number; organelle?: number }>;
}

export function buildWorld(seed = 7): World {
  const rng = new Rng(seed);
  const O: Organelle[] = [];
  const push = (o: Omit<Organelle, 'center' | 'bound'>) => {
    let center: V3, bound: number;
    if (o.shape === Shape.Blob) { center = o.a; bound = Math.max(...o.b) + Math.abs(o.amp) + o.thick; }
    else if (o.shape === Shape.Capsule) { center = mul(add(o.a, o.b), 0.5); bound = len(sub(o.b, o.a)) / 2 + o.r + Math.abs(o.amp); }
    else {
      // (the bowl's chord: the rim sits on the bend sphere, at most r(1+amp) along it)
      const rr = o.r * (1 + Math.abs(o.amp)), sag = o.bend - Math.sqrt(Math.max(0, o.bend * o.bend - rr * rr));
      center = add(o.a, mul(o.b, sag / 2)); bound = Math.hypot(rr, sag / 2) + o.thick;
    }
    O.push({ ...o, center, bound });
    return O.length - 1;
  };

  // the cell: a rounded blob ~19 µm across, flattened a little top to bottom
  const cellI = push({ kind: Kind.Cell, shape: Shape.Blob, a: [0, 0, 0], b: [9600, 7000, 8800], r: 8500, amp: 700, freq: 1 / 5200, seed: 3.1, thick: 6, bend: 0, parent: -1 });
  const cell = O[cellI];
  // the nucleus, off centre, with a nucleolus
  const nucC: V3 = [-1400, 400, -600];
  const nucI = push({ kind: Kind.Nucleus, shape: Shape.Blob, a: nucC, b: [3500, 3000, 3300], r: 3250, amp: 160, freq: 1 / 2600, seed: 11.7, thick: 40, bend: 0, parent: cellI });
  const nucleus = O[nucI];
  push({ kind: Kind.Nucleolus, shape: Shape.Blob, a: add(nucC, [700, 500, 300]), b: [1000, 880, 940], r: 940, amp: 140, freq: 1 / 700, seed: 5.3, thick: 0, bend: 0, parent: nucI });
  push({ kind: Kind.Nucleolus, shape: Shape.Blob, a: add(nucC, [-900, -700, 600]), b: [560, 520, 500], r: 520, amp: 90, freq: 1 / 500, seed: 9.9, thick: 0, bend: 0, parent: nucI });

  const inCell = (p: V3, margin: number) => sdOrganelle(cell, p) < -margin;
  const clearOf = (p: V3, r: number, skip = -1) => {
    for (let i = 1; i < O.length; i++) {
      const o = O[i];
      if (i === skip || o.kind === Kind.Crista || o.kind === Kind.Nucleolus || o.kind === Kind.Neighbor || o.kind === Kind.NeighborNucleus) continue;
      if (len(sub(p, o.center)) > o.bound + r) continue;
      if (sdOrganelle(o, p) < r) return false;
    }
    return true;
  };
  const randomIn = (margin: number): V3 => {
    for (;;) {
      const p: V3 = [rng.range(-9500, 9500), rng.range(-7000, 7000), rng.range(-8800, 8800)];
      if (inCell(p, margin)) return p;
    }
  };

  // rough ER: sheets curved around the nucleus, layered outward, each bent on a sphere about the nucleus' centre
  for (let i = 0; i < 30; i++) {
    const d = rng.dir();
    const layer = rng.int(0, 2);
    const rad = 3500 + 260 + layer * 230 + rng.range(-40, 40);
    const c = add(nucC, mul(d, rad));
    if (!inCell(c, 600)) continue;
    push({ kind: Kind.ER, shape: Shape.Disc, a: c, b: mul(d, -1), r: rng.range(650, 1300), amp: 0.32, freq: 0, seed: rng.range(0, 100), thick: 48, bend: rad, parent: cellI });
  }

  // the Golgi: a stack of curved cisternae on one side of the nucleus, the concave face toward it — set where the
  // wedge's edge slices through it, so the open cell shows the stack in section
  let golgiDir: V3 = [1, 0, 0], best = 9;
  for (let k = 0; k < 360; k++) {
    const a = (k / 360) * Math.PI * 2;
    const d = norm([Math.sin(a), 0.32, Math.cos(a)]);
    const c = add(nucC, mul(d, 3500 + 1450 + 300));
    const miss = Math.abs(wedgeDepth(c) + 0.08);
    if (miss < best && c[0] * Math.sin(WEDGE.yaw) + c[2] * Math.cos(WEDGE.yaw) > 0) { best = miss; golgiDir = d; }
  }
  const golgiBase = add(nucC, mul(golgiDir, 3500 + 1450));
  for (let i = 0; i < 7; i++) {
    const c = add(golgiBase, mul(golgiDir, i * 95));
    push({ kind: Kind.Golgi, shape: Shape.Disc, a: c, b: mul(golgiDir, -1), r: 1250 - Math.abs(i - 3) * 110 + rng.range(-60, 60), amp: 0.16, freq: 0, seed: 40 + i * 3.3, thick: 42, bend: 1800 + i * 95, parent: cellI });
  }
  // the centrosome sits between the nucleus and the Golgi
  const centrosome = add(nucC, mul(golgiDir, 3500 + 750));

  // mitochondria: capsules a micron or more long, scattered through the cytoplasm, each with cristae across it
  let tries = 0, mitos = 0;
  while (mitos < 30 && tries++ < 4000) {
    const L = rng.range(1100, 3400), r = rng.range(230, 330);
    const c = randomIn(L / 2 + r + 300), d = rng.dir();
    const a = add(c, mul(d, -L / 2)), b = add(c, mul(d, L / 2));
    if (!inCell(a, r + 250) || !inCell(b, r + 250)) continue;
    if (!clearOf(a, r + 120) || !clearOf(b, r + 120) || !clearOf(c, r + 120)) continue;
    const mi = push({ kind: Kind.Mito, shape: Shape.Capsule, a, b, r, amp: 26, freq: 1 / 650, seed: rng.range(0, 100), thick: 28, bend: 0, parent: cellI });
    mitos++;
    // lamellar cristae: discs across the axis, ~120 nm apart, each a fold of the inner membrane
    const n = Math.floor(L / 120);
    for (let k = 1; k < n; k++) {
      const t = k / n + rng.range(-0.15, 0.15) / n;
      const p = add(a, mul(sub(b, a), t));
      const tilt = norm(add(d, mul(rng.dir(), 0.25)));
      push({ kind: Kind.Crista, shape: Shape.Disc, a: add(p, mul(rng.dir(), r * 0.12)), b: tilt, r: r * rng.range(0.8, 0.92), amp: 0.16, freq: 0, seed: rng.range(0, 100), thick: 22, bend: 1e5, parent: mi });
    }
  }

  // small round organelles: lysosomes, peroxisomes, endosomes, lipid droplets, vesicles
  const blobs: [Kind, number, number, number, number][] = [
    [Kind.Lysosome, 16, 220, 460, 18],
    [Kind.Peroxisome, 12, 140, 260, 10],
    [Kind.Endosome, 10, 240, 420, 22],
    [Kind.Droplet, 5, 280, 520, 6],
    [Kind.Vesicle, 90, 45, 95, 3],
  ];
  for (const [kind, count, r0, r1, amp] of blobs) {
    let made = 0, t = 0;
    while (made < count && t++ < 5000) {
      const r = rng.range(r0, r1);
      // vesicles crowd round the Golgi and out along the microtubules; the rest anywhere
      const p = kind === Kind.Vesicle && rng.next() < 0.45 ? add(golgiBase, mul(rng.dir(), rng.range(1300, 2400))) : randomIn(r + 200);
      if (!inCell(p, r + 150) || !clearOf(p, r + 60)) continue;
      const s = rng.range(0.85, 1.15);
      push({ kind, shape: Shape.Blob, a: p, b: [r * s, r / s, r * rng.range(0.9, 1.1)], r, amp, freq: 1 / (r * 1.6), seed: rng.range(0, 100), thick: kind === Kind.Droplet ? 3 : 6, bend: 0, parent: cellI });
      made++;
    }
  }

  // neighbours: the tissue's sheet round the first cell (cosmos/tissue.ts, which the cosmos paints on Lyra's cornea and
  // shaders/post.wgsl paints beyond these): its nearest cells as cells of their own (no insides beyond a nucleus)
  tissueNear(TISSUE.near).slice(1).forEach((t, k) => {
    const s = t.s, c = t.at;
    const ni = push({ kind: Kind.Neighbor, shape: Shape.Blob, a: c, b: [8800 * s, 6400 * s, 8600 * s], r: 7800 * s, amp: 900, freq: 1 / 5200, seed: tissueRand(k, 1, 7) * 100, thick: 6, bend: 0, parent: -1 });
    push({ kind: Kind.NeighborNucleus, shape: Shape.Blob, a: add(c, t.nucleus), b: [3000 * s, 2700 * s, 2900 * s], r: 2900 * s, amp: 150, freq: 1 / 2600, seed: tissueRand(k, 2, 7) * 100, thick: 40, bend: 0, parent: ni });
  });
  // (the draws the ring of neighbours used to take, still taken: everything made after them — the filaments, the
  // collagen — comes out as it always has)
  for (let i = 0; i < 14; i++) { for (let k = 0; k < 6; k++) rng.range(0, 1); rng.dir(); }

  // ------------------------------------------------------------------ filaments
  const F: Filament[] = [];
  const nucD = (p: V3) => sdOrganelle(nucleus, p);
  const cellD = (p: V3) => sdOrganelle(cell, p);
  // microtubules: from the centrosome out to the cortex, stiff (persistence length ~ mm, so nearly straight), bending
  // round the nucleus and along the membrane where they reach it
  for (let i = 0; i < 84; i++) {
    let d = rng.dir();
    if (nucD(add(centrosome, mul(d, 900))) < 100) d = norm(add(d, mul(golgiDir, 1.6)));
    let p: V3 = add(centrosome, mul(d, 120));
    const pts: V3[] = [p];
    let along = 0;
    for (let s = 0; s < 120; s++) {
      d = norm(add(d, mul(rng.dir(), 0.12)));
      let q = add(p, mul(d, 220));
      const dn = nucD(q);
      if (dn < 160) {
        // slide round the nucleus
        const g = norm(sub(q, nucC));
        d = norm(sub(d, mul(g, dot(d, g) * 1.2)));
        q = add(p, mul(d, 220));
      }
      const dc = cellD(q);
      if (dc > -260) {
        // at the cortex: turn along the membrane, then stop after a while
        const g = norm(q);
        d = norm(sub(d, mul(g, dot(d, g) * 1.3)));
        q = add(p, mul(d, 220));
        along++;
        if (along > rng.int(2, 9) || cellD(q) > -120) break;
      }
      p = q;
      pts.push(p);
    }
    if (pts.length > 4) F.push({ kind: FilKind.Microtubule, points: pts, radius: 12.5 });
  }
  // actin: a cortical mesh just under the membrane, short filaments tangent to it
  for (let i = 0; i < 520; i++) {
    const u = rng.dir();
    const R = blobRadius(cell, u);
    let p = mul(u, R - rng.range(90, 320));
    let d = norm(cross(u, rng.dir()));
    const pts: V3[] = [p];
    const n = rng.int(5, 14);
    for (let s = 0; s < n; s++) {
      d = norm(add(d, mul(rng.dir(), 0.25)));
      const g = norm(p);
      d = norm(sub(d, mul(g, dot(d, g))));
      p = add(p, mul(d, 160));
      const uu = norm(p);
      p = mul(uu, blobRadius(cell, uu) - rng.range(90, 320));
      pts.push(p);
    }
    F.push({ kind: FilKind.Actin, points: pts, radius: 3.5 });
  }
  // intermediate filaments (vimentin): a loose cage round the nucleus, wavy, reaching out into the cytoplasm
  for (let i = 0; i < 46; i++) {
    let d = rng.dir();
    let p = add(nucC, mul(d, 3500 + rng.range(150, 600)));
    let t = norm(cross(d, rng.dir()));
    const pts: V3[] = [p];
    for (let s = 0; s < 60; s++) {
      t = norm(add(t, mul(rng.dir(), 0.35)));
      const g = norm(sub(p, nucC));
      const out = nucD(p) < 300 ? 0.4 : -0.05;
      t = norm(add(t, mul(g, out)));
      const q = add(p, mul(t, 200));
      if (cellD(q) > -250) break;
      p = q;
      pts.push(p);
    }
    if (pts.length > 4) F.push({ kind: FilKind.Intermediate, points: pts, radius: 5 });
  }
  // chromatin: in the nucleus, fibres meandering in territories (seen whole as the nucleus' texture; up close, each
  // carries nucleosomes on its DNA)
  for (let i = 0; i < 240; i++) {
    let p = add(nucC, mul(rng.dir(), rng.range(300, 2800)));
    if (nucD(p) > -250) continue;
    let d = rng.dir();
    const pts: V3[] = [p];
    for (let s = 0; s < 70; s++) {
      d = norm(add(d, mul(rng.dir(), 0.7)));
      let q = add(p, mul(d, 90));
      if (nucD(q) > -120) { d = norm(sub(nucC, p)); q = add(p, mul(d, 90)); }
      p = q;
      pts.push(p);
    }
    F.push({ kind: FilKind.Chromatin, points: pts, radius: 15 });
  }
  // collagen: a loose mat of fibrils under the cells (the basement membrane and the matrix below it), wavy, banded
  for (let i = 0; i < 46; i++) {
    let p: V3 = [rng.range(-46000, 46000), rng.range(-12500, -9500), rng.range(-46000, 46000)];
    const a = rng.range(0, Math.PI * 2);
    let d: V3 = [Math.cos(a), rng.range(-0.05, 0.05), Math.sin(a)];
    const pts: V3[] = [p];
    for (let s = 0; s < 70; s++) {
      d = norm(add(d, mul(rng.dir(), 0.1)));
      d[1] *= 0.3;
      d = norm(d);
      p = add(p, mul(d, 700));
      if (Math.abs(p[0]) > 52000 || Math.abs(p[2]) > 52000) break;
      pts.push(p);
    }
    F.push({ kind: FilKind.Collagen, points: pts, radius: 55 });
  }

  const mitoI = O.findIndex((o) => o.kind === Kind.Mito);
  const golgiI = O.findIndex((o) => o.kind === Kind.Golgi);
  const places: World['places'] = {
    tissue: { at: [0, 0, 0], scale: 46000 },
    cell: { at: [0, 0, 0], scale: 30000, organelle: cellI },
    nucleus: { at: nucC, scale: 9000, organelle: nucI },
    mitochondrion: { at: O[mitoI].center, scale: 4500, organelle: mitoI },
    golgi: { at: O[golgiI].center, scale: 5000, organelle: golgiI },
    centrosome: { at: centrosome, scale: 2500 },
  };
  return { organelles: O, filaments: F, centrosome, cell, nucleus, places };
}
