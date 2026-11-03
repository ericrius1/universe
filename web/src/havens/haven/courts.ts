// The courts in the stair's notch (plan.ts COURTS): the spaces the grand stair's zig-zag leaves between its flights
// are garden courts, each level with the landing it opens off by a short bridge: paved, with raised planters (one
// round a lotus pool), cypresses at the planters' corners, a parapet with piers and lanterns where a court stands over its
// surroundings and a retaining wall where the ground beside rises over it; where a court meets the notch's cut rock
// face it simply abuts it.
import { MAT } from '../arch/types';
import type { V2 } from '../world/layout';
import { Frame, type Haul } from './colliders';
import { COURTS, LANDINGS, LANDING_R, NOTCH_EAST, NOTCH_WEST, WALK, courtDoor, notchFloor, pointIn, rng, type Court } from './plan';
import type { Shapes } from './shapes';
import { lantern } from './terraces';

const RAIL = 1.1;
/** a court's bridge from its landing: half its width */
export const COURT_BRIDGE_HALF = 2.2;

export function buildCourts(s: Shapes, haul: Haul) {
  COURTS.forEach((c, k) => court(s, haul, c, k));
}

/** does a point lie on the notch's edge (where a court abuts the cut rock face)? */
function onCut(p: V2): boolean {
  for (const line of [NOTCH_EAST, NOTCH_WEST]) for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
    if (Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]) < 0.2) return true;
  }
  return false;
}

function court(s: Shapes, haul: Haul, c: Court, k: number) {
  const b = s.b, wk = c.floor + WALK, rnd = rng(k, 91), n = c.poly.length;
  const door = courtDoor(c);
  const nearDoor = (r: V2, d: number) => Math.hypot(r[0] - door[0], r[1] - door[1]) < d;
  s.slab(c.poly, wk, MAT.PAVING);
  // (the outlines run counter-clockwise on the map: inside on the left of travel, outward faces look right)
  for (let i = 0; i < n; i++) {
    const p = c.poly[i], q = c.poly[(i + 1) % n];
    if (onCut(p) && onCut(q)) continue;
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]), steps = Math.max(1, Math.ceil(L / 1.5));
    const path: V2[] = Array.from({ length: steps + 1 }, (_, j) => [p[0] + ((q[0] - p[0]) * j) / steps, p[1] + ((q[1] - p[1]) * j) / steps]);
    const g = path.map((r) => notchFloor(r[1]));
    s.strip(path, g.map((y) => Math.min(y, c.floor) - 3), path.map(() => wk - 0.3), MAT.PLASTER, true).strip(path, wk - 0.3, wk, MAT.CREAM, true);
    if (g.every((y) => y < c.floor - 0.5)) {
      // over its surroundings: a parapet, broken at the way in, piers with lanterns along it
      // (o: d metres in from the edge, to the left of travel on the map, so the parapet stands on the court's rim with
      // its faces out of its body)
      const tx = (q[0] - p[0]) / L, tz = (q[1] - p[1]) / L;
      const o = (r: V2, d: number): V2 => [r[0] + tz * d, r[1] - tx * d];
      for (const run of keepRuns(path, (r) => !nearDoor(r, 2.4))) {
        const outer = run.map((r) => o(r, 0)), inner = run.map((r) => o(r, 0.45));
        s.strip(outer, wk, wk + RAIL - 0.12, MAT.PLASTER, true).strip(outer, wk + RAIL - 0.12, wk + RAIL, MAT.CREAM, true);
        s.strip(inner, wk, wk + RAIL - 0.12, MAT.PLASTER, false).strip(inner, wk + RAIL - 0.12, wk + RAIL, MAT.CREAM, false);
        s.flat(inner, outer, wk + RAIL, wk + RAIL, MAT.CREAM);
        for (const [e, sg] of [[run[0], -1], [run[run.length - 1], 1]] as [V2, number][]) {
          if (!nearDoor(e, 2.6)) continue;
          const a = o(e, 0), a2 = o(e, 0.45);
          s.face([[a[0], wk, a[1]], [a2[0], wk, a2[1]], [a2[0], wk + RAIL, a2[1]], [a[0], wk + RAIL, a[1]]], MAT.CREAM, [sg * tx, 0, sg * tz]);
        }
      }
      const m = Math.max(1, Math.floor(L / 14));
      for (let j = 1; j < m; j++) {
        const t = j / m, cpt = o([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], 0.22);
        if (nearDoor(cpt, 3)) continue;
        s.pier(cpt[0], cpt[1], Math.atan2(tz, tx), 0.38, wk, wk + 1.5, MAT.ASHLAR, MAT.CREAM);
        if (j % 2 === 1) lantern(s, haul, cpt, Math.atan2(tz, tx), wk + 1.5, 0.9);
        // a cream pilaster down the face below each pier, where the face stands tall
        const g0 = notchFloor(cpt[1]);
        if (wk - g0 > 6) {
          const f: V2 = [cpt[0] - tz * 0.4, cpt[1] + tx * 0.4];
          s.obox(f[0], f[1], Math.atan2(tz, tx), 0.55, 0.2, g0 - 1, wk - 0.3, MAT.ASHLAR, { skip: ['bottom'] });
        }
      }
    } else {
      // the ground beside rises over the court: the wall holds it back, its face toward the court
      s.strip(path, wk, g.map((y) => Math.max(wk + 0.01, y + 1.2)), MAT.PLASTER, false);
    }
  }
  // the bridge from the landing's edge to the way in
  const [lx, lz] = LANDINGS[c.landing];
  const dir = Math.atan2(door[1] - lz, door[0] - lx);
  const e: V2 = [lx + Math.cos(dir) * (LANDING_R - 0.6), lz + Math.sin(dir) * (LANDING_R - 0.6)];
  const len = Math.hypot(door[0] - e[0], door[1] - e[1]) + 1.2;
  s.obox((door[0] + e[0]) / 2, (door[1] + e[1]) / 2, dir, len / 2, COURT_BRIDGE_HALF, wk - 0.5, wk + 0.02, MAT.CREAM, { top: MAT.PAVING });
  // the beds: raised planters on the paving, the largest round a lotus pool, the rest flowers or shrubs round a
  // blossom tree, a cypress at each bed's corners
  let largest = 0;
  const areaOf = (bd: number[]) => (bd[2] - bd[0]) * (bd[3] - bd[1]);
  c.beds.forEach((bd, i) => { if (areaOf(bd) > areaOf(c.beds[largest])) largest = i; });
  const soil = wk + 0.5, rim = wk + 0.65;
  c.beds.forEach(([x0, z0, x1, z1], i) => {
    // (a rectangle listed x then z increasing runs clockwise on a north-up map: reversed it runs as the outlines do)
    const rect = (d: number): V2[] => [[x0 + d, z0 + d], [x1 - d, z0 + d], [x1 - d, z1 - d], [x0 + d, z1 - d]];
    const ccw = (d: number) => rect(d).reverse();
    s.ring(ccw(0), ccw(0.4), wk, soil, rim, MAT.PLASTER, MAT.CREAM, 0.14);
    if (i === largest) {
      s.slab(ccw(0.4), soil, MAT.LAWN);
      haul.beds.push({ poly: rect(0.4), y: soil, kind: 'lawn', density: 1 });
      s.ring(ccw(2.4), ccw(2.8), soil, soil - 0.45, soil + 0.3, MAT.CREAM, MAT.CREAM, 0.1);
      s.slab(ccw(2.8), soil - 0.45, MAT.POOL);
      haul.water.push({ kind: 'pool', poly: rect(2.8), level: soil + 0.15, depth: 0.6 });
      haul.beds.push({ poly: rect(2.8), y: soil + 0.15, kind: 'lotus', density: 0.4 });
    } else {
      s.slab(ccw(0.4), soil, MAT.SOIL);
      haul.beds.push({ poly: rect(0.4), y: soil, kind: rnd() < 0.5 ? 'flowers' : 'shrubs', density: 0.9, palette: (['pink', 'white', 'gold', 'mixed'] as const)[(i + k) % 4] });
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      haul.beds.push({ poly: [[cx - 1.4, cz - 1.4], [cx + 1.4, cz - 1.4], [cx + 1.4, cz + 1.4], [cx - 1.4, cz + 1.4]], y: soil, kind: 'blossom', density: 1 });
    }
    for (const [x, z] of [[x0 - 1.2, z0 - 1.2], [x1 + 1.2, z0 - 1.2], [x1 + 1.2, z1 + 1.2], [x0 - 1.2, z1 + 1.2]]) {
      if (!pointIn(c.poly, x, z) || nearDoor([x, z], 3)) continue;
      haul.beds.push({ poly: [[x - 0.7, z - 0.7], [x + 0.7, z - 0.7], [x + 0.7, z + 0.7], [x - 0.7, z + 0.7]], y: wk + 0.4, kind: 'cypress', density: 1 });
      b.cylinder(x, z, 0.75, wk, wk + 0.4, 10, MAT.CREAM, { top: MAT.SOIL });
    }
  });
  colliders(haul, c, k, door, e);
}

/** a court's walking collider: its floor in strips inside the outline, the beds a step down, the parapets and walls
 *  along its edges (in frames along them, broken at the way in), the bridge from the landing */
function colliders(haul: Haul, c: Court, k: number, door: V2, e: V2) {
  const F = new Frame(`haven.court${k}`, 0, 0, 0);
  const wk = c.floor + WALK;
  const zs = c.poly.map((p) => p[1]), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const span = (zz: number) => {
    const xs: number[] = [];
    for (let i = 0, j = c.poly.length - 1; i < c.poly.length; j = i++) {
      const p = c.poly[i], q = c.poly[j];
      if ((p[1] > zz) !== (q[1] > zz)) xs.push(p[0] + ((zz - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
    }
    xs.sort((a, b) => a - b);
    return xs.length >= 2 ? [xs[0], xs[xs.length - 1]] : null;
  };
  for (let z = z0; z < z1; z += 1) {
    const a = span(z + 0.02), b = span(Math.min(z1, z + 1) - 0.02);
    if (a && b) F.floor(Math.max(a[0], b[0]), z, Math.min(a[1], b[1]), Math.min(z1, z + 1), wk);
  }
  // (the raised planters are solid to walk into: low enough to climb onto with a jump)
  for (const [x0, bz0, x1, bz1] of c.beds) F.solid(x0, bz0, x1, bz1, wk - 0.1, wk + 0.65);
  haul.colliders.push(F.done());
  for (let i = 0; i < c.poly.length; i++) {
    const p = c.poly[i], q = c.poly[(i + 1) % c.poly.length];
    if (onCut(p) && onCut(q)) continue;
    const E = new Frame(`haven.court${k}.edge${i}`, p[0], p[1], Math.atan2(q[1] - p[1], q[0] - p[0]));
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const bot = Math.min(notchFloor(p[1]), notchFloor(q[1]), c.floor) - 3;
    const dp = E.plan(door[0], door[1]);
    if (Math.abs(dp[1]) < 1 && dp[0] > -2.4 && dp[0] < L + 2.4) {
      E.solid(0, -0.5, Math.max(0, dp[0] - 2.4), 0.5, bot, wk + RAIL).solid(Math.min(L, dp[0] + 2.4), -0.5, L, 0.5, bot, wk + RAIL);
    } else E.solid(0, -0.5, L, 0.5, bot, wk + RAIL);
    haul.colliders.push(E.done());
  }
  const dir = Math.atan2(door[1] - e[1], door[0] - e[0]);
  const B = new Frame(`haven.court${k}.bridge`, e[0], e[1], dir);
  B.floor(-0.6, -COURT_BRIDGE_HALF, Math.hypot(door[0] - e[0], door[1] - e[1]) + 2.6, COURT_BRIDGE_HALF, wk);
  haul.colliders.push(B.done());
}

/** the runs of a path's points kept by a test */
function keepRuns(path: V2[], keep: (p: V2) => boolean): V2[][] {
  const out: V2[][] = [];
  let cur: V2[] = [];
  for (const p of path) { if (keep(p)) cur.push(p); else { if (cur.length > 1) out.push(cur); cur = []; } }
  if (cur.length > 1) out.push(cur);
  return out;
}
