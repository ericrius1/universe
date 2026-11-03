// The open market inside the arcades: the avenue's and the cross street's paving, and everywhere else stalls. They
// stand in runs of three to five under one awning each (one cloth, one colour: striped or solid by turns, so the
// square from above is a quilt of them), the runs in rows along east-west lines, back to back in pairs with aisles
// between; the rows nearest the avenue face it all along its length, so it's lined with stalls from gate to gate.
// Where a run is left out a peaked tent stands, or rugs are laid out on the paving, or a palm grows in a planter.
// Lanterns hang under the awnings and strings of them cross the aisles and the avenue on tall poles.
// Each stall: posts, a counter and its goods, the run's back cloth behind it. Laid in the market's frame (a run's own
// frame turned to face north or south), its colliders one per quarter of the square.
import { MAT, type V3 } from '../../arch/types';
import type { V2 } from '../../world/layout';
import type { City, Collide } from '../ctx';
import { inside } from '../geom';
import { lanternBody, planter } from '../props';
import { Rng } from '../rng';
import { GOODS, lay } from './goods';
import { CLOTH, DYES, block, cloth, strand } from './kit';
import { AVENUE, COURT, CROSS, FLOOR_POLY, GATES, HALL, PAVE } from './plan';

/** a stall's width and depth, the run's back posts' and front posts' heights, the aisles' width */
const W = 3.4, D = 2.8, HB = 2.8, HF = 2.3, AISLE = 9;
/** the first line's back (its front rows face the avenue a walk's width off it) and the lines' pitch */
const Z0 = AVENUE.half + 1.6 + D, PITCH = 2 * D + AISLE;

/** is a plan rectangle clear of the ways, the hall, the courts and the arcades' walk */
function clear(x0: number, z0: number, x1: number, z1: number, margin = 0): boolean {
  const pts: V2[] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  if (!pts.every((p) => inside(p, FLOOR_POLY))) return false;
  if (Math.min(Math.abs(x0), Math.abs(x1)) < CROSS.half + 1.6 + margin || (x0 < 0 && x1 > 0)) return false;
  if (Math.min(Math.abs(z0), Math.abs(z1)) < AVENUE.half + 0.4 || (z0 < 0 && z1 > 0)) return false;
  const near = (cx: number, cz: number, r: number) => pts.some(([x, z]) => Math.hypot(x - cx, z - cz) < r) || (Math.max(x0, Math.min(cx, x1)) - cx) ** 2 + (Math.max(z0, Math.min(cz, z1)) - cz) ** 2 < r * r;
  if (near(0, 0, HALL.r + 4 + margin)) return false;
  for (const q of [COURT.east, COURT.west]) if (near(q.x, q.z, q.r + 3 + margin)) return false;
  return true;
}

export function buildStalls(c: City, rng: Rng) {
  const b = c.b;
  b.owner('stalls', () => {
    b.owner('ways', () => ways(c));
    const cols = new Map<string, Collide>();
    const colOf = (x: number, z: number) => {
      const k = `${z < 0 ? 'n' : 's'}${x < 0 ? 'w' : 'e'}`;
      if (!cols.has(k)) cols.set(k, c.collide(`city/market-${k}`));
      return cols.get(k)!;
    };
    let n = 0;
    // the runs kept along each row (by side of the avenue, line, and whether it faces the avenue): for the sails
    const kept = new Map<string, [number, number][]>();
    const keep = (sz: number, i: number, f: boolean, xa: number, xb: number) => { const k = `${sz},${i},${f}`; if (!kept.has(k)) kept.set(k, []); kept.get(k)!.push([xa, xb]); };
    // the lines of rows, each side of the avenue: a line's runs back to back, the one facing the avenue (or the aisle
    // toward it) and the one facing away
    for (const sz of [-1, 1] as const) {
      for (let i = 0; ; i++) {
        const zb = sz * (Z0 + i * PITCH);
        if (Math.abs(zb) - D > 92) break;
        const fz = (x0: number, x1: number) => clear(x0 - 0.2, zb - sz * (D + 1.0), x1 + 0.2, zb - sz * 0.1);
        const bz = (x0: number, x1: number) => clear(x0 - 0.2, zb + sz * 0.1, x1 + 0.2, zb + sz * (D + 1.0));
        for (const sx of [-1, 1] as const) {
          // the stretches of the line free for a stall (in front or behind), out from the cross street to the arcades,
          // each filled with runs of three to five stalls, gaps between them, the whole centred in it
          for (const [s0, s1] of free((u) => { const xa = sx > 0 ? u : -u - W; return fz(xa, xa + W) || bz(xa, xa + W); })) {
            const runs: number[] = [];
            let left = s1 - s0;
            while (left >= 2 * W) { const k = Math.min(rng.int(3, 5), Math.floor(left / W)); runs.push(k); left -= k * W + 4; }
            let u = s0 + Math.max(0, left + 4) / 2;
            for (const k of runs) {
              const len = k * W, xa = sx > 0 ? u : -u - len, xb = xa + len;
              u += len + 4;
              // (each piece's own randomness, from where it stands: what it carries never moves what stands where)
              const at = (j: number) => (Math.round(xa * 7) * 7919 + Math.round(zb * 3) * 104729 + j * 31) >>> 0;
              const front = fz(xa, xb), back = bz(xa, xb);
              // (the avenue's rows are all there; the others now and then left out for rugs, a palm, or with the
              // run behind it, a tent)
              const keepF = front && (i === 0 || rng.chance(0.58)), keepB = back && rng.chance(0.54);
              const col = colOf(xa, zb);
              if (keepF) { n = run(c, col, xa, zb, len, k, -sz as 1 | -1, !keepB, at(1), n, i === 0 ? 3 : i === 1 ? 2 : 1); keep(sz, i, true, xa, xb); }
              if (keepB) { n = run(c, col, xa, zb, len, k, sz, !keepF, at(2), n, i === 0 ? 2 : 1); keep(sz, i, false, xa, xb); }
              if (keepF && keepB) b.owner('run', () => posts(c, xa, zb, len, k));
              // what stands where a run isn't
              const cx = (xa + xb) / 2;
              if (front && back && !keepF && !keepB && rng.chance(0.7)) tent(c, col, cx, zb, new Rng(at(3)));
              else for (const [ok, isKept, s] of [[front, keepF, -sz], [back, keepB, sz]] as const) {
                if (!ok || isKept) continue;
                const cz = zb + s * (D / 2 + 0.3), pick = rng.next();
                if (pick < 0.55) rugs(c, xa + 0.4, xb - 0.4, cz, new Rng(at(4 + s)));
                else if (pick < 0.8) { planter(c, cx, cz, 1.2, 0.6, 'palms', PAVE.square); col.solid(cx - 1.2, cz - 1.2, cx + 1.2, cz + 1.2, 0, 0.7); }
              }
            }
          }
        }
      }
    }
    b.owner('sails', () => {
      for (const sz of [-1, 1]) for (let i = 0; i < 8; i++) {
        const A = kept.get(`${sz},${i},false`) ?? [], B = kept.get(`${sz},${i + 1},true`) ?? [];
        const z0 = sz * (Z0 + i * PITCH + D + 1.3), z1 = sz * (Z0 + (i + 1) * PITCH - D - 1.3);
        for (const [a0, a1] of A) for (const [b0, b1] of B) {
          const x0 = Math.max(a0, b0) + 0.5, x1 = Math.min(a1, b1) - 0.5;
          if (x1 - x0 < 4.5) continue;
          aisle(c, colOf(x0, z0), x0, x1, Math.min(z0, z1), Math.max(z0, z1), rng);
        }
      }
    });
    b.owner('lanterns', () => strings(c, rng));
  });
}

/** the stretches [from, to] of distance out from the cross street (0 to 100 m, in half metres) where a stall standing
 *  at u is clear, its width included */
function free(ok: (u: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let u = 0; u <= 100; u += 0.5) {
    const k = ok(u);
    if (k && start < 0) start = u;
    if ((!k || u + 0.5 > 100) && start >= 0) { const e = k ? u : u - 0.5; if (e > start) out.push([start, e + W]); start = -1; }
  }
  return out;
}

/** the avenue's paving through the market from gate to gate, the cross street's from the hall to the north and south
 *  gates: each a step over the square's, its edges */
function ways(c: City) {
  const b = c.b, y = PAVE.avenue, e = GATES.find((g) => g.name === 'east')!, s = GATES.find((g) => g.name === 'south')!;
  const strip = (pts: V2[]) => {
    b.with({ tint: [1.08, 0.97, 0.86] }, () => b.slab(pts, y, MAT.PAVING));
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      // (its edge down to the square, facing out)
      b.patch([[p[0], PAVE.square, p[1]], [q[0], PAVE.square, q[1]], [q[0], y, q[1]], [p[0], y, p[1]]], [0, 1, 2, 0, 2, 3], MAT.ASHLAR, [q[1] - p[1], 0, p[0] - q[0]]);
    }
  };
  const A = AVENUE.half, ri = HALL.r * Math.cos(Math.PI / 8);
  strip([[-e.inner, -A], [e.inner, -A], [e.inner, A], [-e.inner, A]]);
  for (const sz of [-1, 1]) strip(sz > 0 ? [[-CROSS.half, ri], [CROSS.half, ri], [CROSS.half, s.inner], [-CROSS.half, s.inner]] : [[-CROSS.half, -s.inner], [CROSS.half, -s.inner], [CROSS.half, -ri], [-CROSS.half, -ri]]);
}

/** a run of k stalls along x from xa (len long), its back on z = zb, its front toward `side` (±z); `alone`: no run
 *  back to back with it (its back cloth both ways, its back posts its own) */
function run(c: City, col: Collide, xa: number, zb: number, len: number, k: number, side: 1 | -1, alone: boolean, seed: number, n0: number, goods: number): number {
  const b = c.b, rng = new Rng(seed);
  let n = n0;
  b.owner('run', () => b.group(() => {
    // (the run's frame: x along it from its start, z out its front: turned half round for a run facing north)
    if (side > 0) b.at(xa, 0, zb); else b.at(xa + len, 0, zb, Math.PI);
    const y = PAVE.square, solid = (n + Math.round(xa)) % 2 === 0;
    const tint = solid ? DYES[(n * 3 + k) % DYES.length] : CLOTH[(n * 5 + k) % CLOTH.length];
    // the awning: one cloth over the run from over its back down past its front, its valance
    const lift = rng.range(-0.12, 0.25), yb = y + HB + 0.05 + lift, yf = y + HF - 0.15 + lift, out = D + rng.range(0.7, 1.1);
    const at = (z: number) => yb + ((yf - yb) * z) / out;
    b.with({ tint }, () => {
      cloth(b, [[[-0.12, yb, 0.02], [len + 0.12, yb, 0.02]], [[-0.12, yf, out], [len + 0.12, yf, out]]], solid ? MAT.PAINT : MAT.CLOTH);
      cloth(b, [[[-0.12, yf, out], [len + 0.12, yf, out]], [[-0.12, yf - 0.32, out], [len + 0.12, yf - 0.32, out]]], solid ? MAT.PAINT : MAT.CLOTH);
    });
    // the back cloth (a darker shade of the awning's), its posts if it stands alone; the front posts
    b.with({ tint: [tint[0] * 0.75, tint[1] * 0.75, tint[2] * 0.75] }, () => {
      const q: V3[] = [[0, y, 0.02], [len, y, 0.02], [len, at(0.02) - 0.02, 0.02], [0, at(0.02) - 0.02, 0.02]];
      b.poly(q, solid ? MAT.PAINT : MAT.CLOTH);
      if (alone) b.poly([...q].reverse(), solid ? MAT.PAINT : MAT.CLOTH);
    });
    for (let i = 0; i <= k; i++) {
      const px = Math.min(len - 0.06, Math.max(0.06, i * W));
      block(b, px - 0.06, y, D - 0.14, px + 0.06, at(D - 0.08) - 0.02, D - 0.02, MAT.WOOD, ['top']);
      if (alone) block(b, px - 0.06, y, -0.06, px + 0.06, at(0) - 0.02, 0.06, MAT.WOOD, ['top']);
    }
    // the stalls: a counter, its goods, now and then crates beside it, a lamp under the awning
    for (let i = 0; i < k; i++, n++) {
      const x0 = i * W + 0.1, x1 = (i + 1) * W - 0.1, kind = GOODS[(n * 7 + rng.int(0, 3)) % GOODS.length];
      block(b, x0, y, D - 0.78, x1, 0.95, D - 0.12, MAT.WOOD);
      // (cloth and rugs hung on the back cloth behind it, PROUD of it, now and then)
      if (rng.chance(0.45)) for (const u of [x0 + 0.25, x0 + 1.15, x0 + 2.05]) {
        if (rng.chance(0.3)) continue;
        const pm = rng.chance(0.5), yb = y + rng.range(0.7, 1.2), yt = at(0.04) - 0.15;
        b.with({ tint: rng.pick(pm ? DYES : CLOTH) }, () => b.patch([[u, yb, 0.045], [u + 0.78, yb, 0.045], [u + 0.78, yt, 0.045], [u, yt, 0.045]], [0, 1, 2, 0, 2, 3], pm ? MAT.PAINT : MAT.CLOTH, [0, 0, 1]));
      }
      lay(c, kind, x0 + 0.1, x1 - 0.1, D - 0.15, 0.55, 0.95, rng, goods);
      if (rng.chance(0.16)) {
        const cx = rng.chance(0.5) ? x0 + 0.4 : x1 - 0.4;
        block(b, cx - 0.32, y, D + 0.08, cx + 0.32, y + 0.5, D + 0.62, MAT.WOOD);
        if (rng.chance(0.5)) b.with({ tint: rng.pick(DYES) }, () => block(b, cx - 0.26, y + 0.5, D + 0.14, cx + 0.22, y + 0.82, D + 0.56, MAT.PAINT));
      }
      if ((n + i) % 2 === 0) lanternBody(c, [(x0 + x1) / 2, at(D * 0.55) - 0.45, D * 0.55], 0.15, CLOTH[(n * 3) % CLOTH.length]);
      if (n % 19 === 4) c.light([(x0 + x1) / 2, 2.0, D + 0.4], 60, { radius: 9 });
    }
  }));
  // its colliders: the counters, the back cloth
  col.solid(xa, side > 0 ? zb + D - 0.8 : zb - D + 0.12, xa + len, side > 0 ? zb + D - 0.12 : zb - D + 0.8, 0, 0.95);
  col.solid(xa, zb - 0.08, xa + len, zb + 0.08, 0, HB);
  return n;
}

/** over an aisle from x0 to x1 between z0 and z1 where runs face each other across it: strings of lanterns across it
 *  every ten metres or so on tall poles either side, and now and then a sail of cloth sagging between four of them */
function aisle(c: City, col: Collide, x0: number, x1: number, z0: number, z1: number, rng: Rng) {
  const b = c.b, y = PAVE.square, h = 4.5 + rng.range(-0.2, 0.3);
  const n = Math.max(1, Math.round((x1 - x0) / 10)), xs = Array.from({ length: n + 1 }, (_, k) => x0 + (k * (x1 - x0)) / n);
  for (const px of xs) for (const pz of [z0, z1]) {
    b.cylinder(px, pz, 0.08, y, y + h + 0.15, 5, MAT.WOOD, { r1: 0.06, top: null });
    col.solid(px - 0.1, pz - 0.1, px + 0.1, pz + 0.1, 0, h);
  }
  // (a sail between the first two pairs of poles, half the time)
  if (rng.chance(0.55)) {
    const sa = xs[0], sb = xs[1], sm = (sa + sb) / 2, zm = (z0 + z1) / 2, sag = 0.4;
    const solid = rng.chance(0.65), tint = solid ? rng.pick(DYES) : rng.pick(CLOTH);
    const row = (z: number, dip: number): V3[] => [[sa, y + h - dip, z], [sm, y + h - dip - sag * 0.6, z], [sb, y + h - dip, z]];
    b.with({ tint }, () => cloth(b, [row(z0, 0), row(zm, sag), row(z1, 0)], solid ? MAT.PAINT : MAT.CLOTH));
  }
  const tints: V3[] = [[1.3, 0.55, 0.2], [1.3, 0.85, 0.25], [1.15, 0.3, 0.25], [0.35, 0.8, 0.75]];
  xs.forEach((px, k) => strand(c, [px, y + h - 0.25, z0], [px + rng.range(-0.6, 0.6), y + h - 0.25, z1], 0.55, 1.6, tints, k % 2 ? [] : [2]));
}

/** the back posts two runs back to back share */
function posts(c: City, xa: number, zb: number, len: number, k: number) {
  const b = c.b, y = PAVE.square;
  for (let i = 0; i <= k; i++) {
    const px = xa + Math.min(len - 0.06, Math.max(0.06, i * W));
    block(b, px - 0.06, y, zb - 0.06, px + 0.06, y + HB - 0.15, zb + 0.06, MAT.WOOD);
  }
}

/** a tall peaked tent on four posts, open at the sides, a rug under it and a lamp hung in it */
function tent(c: City, col: Collide, x: number, z: number, rng: Rng) {
  const b = c.b, y = PAVE.square, s = rng.range(1.5, 1.9), h = 2.5, peak = h + rng.range(1.8, 2.6);
  b.owner('tent', () => {
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      block(b, x + sx * s - 0.07, y, z + sz * s - 0.07, x + sx * s + 0.07, y + h, z + sz * s + 0.07, MAT.WOOD, ['top']);
      col.solid(x + sx * s - 0.1, z + sz * s - 0.1, x + sx * s + 0.1, z + sz * s + 0.1, 0, h);
    }
    const t = rng.pick(rng.chance(0.5) ? CLOTH : DYES), R = (s + 0.3) * Math.SQRT2;
    // (its roof a pyramid square to its posts: a four-sided cone turned an eighth round)
    b.with({ tint: t }, () => b.group(() => {
      b.at(x, 0, z, Math.PI / 4);
      b.cylinder(0, 0, R, y + h, y + peak, 4, rng.chance(0.5) ? MAT.CLOTH : MAT.PAINT, { r1: 0.04, top: null, bottom: true });
      b.cylinder(0, 0, R, y + h - 0.4, y + h, 4, MAT.CLOTH, { top: null });
    }));
    b.place('finial-ball', [x, y + peak - 0.05, z], { scale: 0.45 });
    b.with({ tint: rng.pick(CLOTH) }, () => b.panel([[x - s * 0.8, y, z + s * 0.6], [x + s * 0.8, y, z + s * 0.6], [x + s * 0.8, y, z - s * 0.6], [x - s * 0.8, y, z - s * 0.6]], MAT.CLOTH));
    lanternBody(c, [x, y + h - 0.35, z], 0.2, rng.pick(CLOTH));
  });
}

/** rugs laid out on the paving side by side, each PROUD of it (or of the one under it) */
function rugs(c: City, x0: number, x1: number, z: number, rng: Rng) {
  const b = c.b, y = PAVE.square;
  b.owner('rugs', () => {
    const n = Math.max(1, Math.floor((x1 - x0) / 2.1));
    for (let i = 0; i < n; i++) {
      const u0 = x0 + (i * (x1 - x0)) / n + 0.1, u1 = x0 + ((i + 1) * (x1 - x0)) / n - 0.1, h = rng.range(1.1, 1.4);
      b.with({ tint: rng.pick(i & 1 ? DYES : CLOTH) }, () => b.panel([[u0, y, z + h], [u1, y, z + h], [u1, y, z - h], [u0, y, z - h]], i & 1 ? MAT.PAINT : MAT.CLOTH));
      // (a rolled one lying across it, now and then)
      if (rng.chance(0.4)) b.with({ tint: rng.pick(CLOTH) }, () => block(b, u0 + 0.2, y + 0.02, z - 0.15, u1 - 0.2, y + 0.26, z + 0.15, MAT.CLOTH));
    }
  });
}

/** strings of lanterns across the avenue on tall poles either side of it, between the hall, the courts and the gates */
function strings(c: City, rng: Rng) {
  const b = c.b, y = PAVE.avenue, h = 5.2, zp = AVENUE.half + 0.15;
  const pole = (x: number, z: number) => {
    b.cylinder(x, z, 0.09, y, y + h, 6, MAT.WOOD, { r1: 0.06, top: null });
    b.place('finial-ball', [x, y + h - 0.02, z], { scale: 0.3 });
  };
  const tints: V3[] = [[1.3, 0.55, 0.2], [1.3, 0.85, 0.25], [1.15, 0.3, 0.25], [0.35, 0.8, 0.75]];
  const e = GATES.find((g) => g.name === 'east')!;
  for (const sx of [-1, 1]) for (const [a, z] of [[HALL.r + 3, COURT.east.x - COURT.east.r - 2], [COURT.east.x + COURT.east.r + 2, e.inner - 3]]) {
    const L = z - a, n = Math.max(1, Math.round(L / 9));
    for (let i = 0; i <= n; i++) {
      const x = sx * (a + (i * L) / n);
      pole(x, -zp); pole(x, zp);
      strand(c, [x, y + h - 0.3, -zp], [x + sx * rng.range(-1.5, 1.5), y + h - 0.3, zp], 1.1, 1.6, tints, [5], 90, 14);
    }
  }
}
