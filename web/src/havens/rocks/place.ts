// Where the rocks go: the catalogue's prototypes placed over the canyon from the shared layout (world/layout.ts), the
// land's own lines (the river's channel and the side canyons as canyon.ts cut them: they wander off the layout's) and
// the ground (heightAt, slopeAt: the terrain as the land filled it). Everything is decided from one seed, so the field is
// the same on every load. Nothing goes inside the city wall, on the grand stair, in the river or on its banks, on the
// road out of the gate, or on the Haven (the temple, its gardens and the promontory they stand on); ground is read for
// what it is:
//   - talus: boulders and fallen slabs piled at the feet of cliffs (where a flat floor or bench meets a steep rise),
//     thickest and biggest close in, thinning outward in fans; a few strays on the open flats;
//   - hoodoo fields: groves of hoodoos (and a table or two) on the floors of the wide canyons and on the plateau back
//     from the rim, the tallest in the middle;
//   - mushroom rocks: on each of the land's own hoodoo pillars (as tall as it, its cap over its top), scattered on the
//     floors and the plateau near the rim, a few giants as landmarks, and a grove on the plateau's far horizon (ref 3's
//     silhouettes);
//   - spires: framing the mouths of the side canyons and standing along them by the walls (never in the middle, where
//     you fly), a few by the river and on the rim;
//   - ledges: thick plates set into the rim, half out over the drop;
//   - crystals: fields of clusters along the rim overlooking the canyon, and glowing grottos (giant crystals and many
//     clusters, a light at night) at cliff feet in the side canyons;
//   - arches: one bridging the west slot canyon, one free on the south canyon's floor, one on the plateau.
// Each placed rock is a prototype, a position, a turn, a lean and a scale; the big ones hand over posts (upright
// cylinders a walker can't pass) and tops (to stand on), in world metres, and the grottos their lights.
import type { LightSpot } from '../arch/types';
import { centreLines, hoodoosIn, riverDistance } from '../land/canyon';
import { BASIN, GATE, MESA, RIM_Y, SIDE_CANYONS, STAIR, TEMPLE, WALL, type V2 } from '../world/layout';
import type { Catalog } from './catalog';
import { gauss, Noise3, pick, range, rng } from './noise';
import type { Kind } from './proto';

/** the ground the rocks stand on */
export interface Ground {
  heightAt(x: number, z: number): number;
  /** rise over run */
  slopeAt(x: number, z: number): number;
}

/** one placed rock: its prototype; where its origin (the ground line on its axis) sits; a lean about x then z (rad),
 *  then a turn about y (rad, +x toward -z); a scale; a seed 0..1 (its colours' shift); its night glow (crystals 0..1);
 *  the height of the ground it stands on (its sand stain rises from there; a ledge, out over a drop, has none) */
export interface Rock { proto: number; x: number; y: number; z: number; yaw: number; tilt: [number, number]; scale: number; seed: number; glow: number; ground: number }

/** an upright cylinder a walker can't pass (world metres): centre, foot, top, radius */
export interface WorldPost { x: number; z: number; y0: number; y1: number; r: number }
/** a flat top to stand on (world metres) */
export interface WorldTop { x: number; z: number; r: number; y: number }

export interface Field { rocks: Rock[]; posts: WorldPost[]; tops: WorldTop[]; lights: LightSpot[] }

/** the region rocks are placed in (m) */
const BOUNDS = { x0: -3600, x1: 3600, z0: -2600, z1: 3600 };
/** ground lower than this (m) is the canyon's floor */
const FLOOR_MAX = 30;
/** where the giant mushroom rocks stand (each within ~200 m of its mark, where the ground allows): landmarks seen from
 *  the city and the Haven, on the plateau either side of the promontory, beyond the side canyons and past the river */
const GIANTS: V2[] = [[-1150, -1250], [1250, -1150], [1900, 900], [-2100, 1300], [600, 2300], [-700, 2600]];
/** the far groves of mushroom rocks on the plateau's horizon behind the Haven (ref 3) */
const GROVES: V2[] = [[-2600, -2000], [2700, -1900]];

const segD = (x: number, z: number, a: V2, b: V2) => {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
};
const lineD = (x: number, z: number, path: V2[]) => { let d = Infinity; for (let i = 1; i < path.length; i++) d = Math.min(d, segD(x, z, path[i - 1], path[i])); return d; };
const inEll = (x: number, z: number, cx: number, cz: number, rx: number, rz: number) => ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 < 1;
const STAIR_PATH: V2[] = STAIR.landings.map(([x, z]) => [x, z]);
const MESA_ZC = (MESA.tipZ + MESA.neckZ) / 2, MESA_RZ = (MESA.tipZ - MESA.neckZ) / 2;

/** the river's channel and its banks either side of the land's centre line (canyon.ts: down to the floor by here, m) */
const RIVER_BANKS = 26;

/** somewhere the rocks keep out of, for a rock of reach r: the city and a margin round its wall, the road out of the
 *  gate, the stair, the river's channel and banks (where the land cut them), the Haven (temple, gardens) and the
 *  promontory they stand on */
export function keepOut(x: number, z: number, r = 0): boolean {
  if (inEll(x, z, WALL.cx, WALL.cz, WALL.rx + 40 + r, WALL.rz + 40 + r)) return true;
  if (Math.abs(x - GATE.x) < 30 + r && z > GATE.z && z < GATE.z + 420) return true;
  if (lineD(x, z, STAIR_PATH) < STAIR.width / 2 + 35 + r) return true;
  if (riverDistance(x, z) < RIVER_BANKS + r) return true;
  if (Math.hypot(x - TEMPLE.x, z - TEMPLE.z) < 380 + r) return true;
  return inEll(x, z, MESA.cx, MESA_ZC, MESA.halfWidth + 40 + r, MESA_RZ + 40 + r);
}

/** a uniform spatial hash of what's placed, for spacing */
class Spacing {
  private cells = new Map<number, number[]>();
  private pts: number[] = [];
  constructor(private cell = 24) {}
  private key(i: number, j: number) { return (i + 4096) * 8192 + (j + 4096); }
  add(x: number, z: number, r: number) {
    const id = this.pts.length / 3;
    this.pts.push(x, z, r);
    const c = this.cell, r0 = Math.ceil(r / c);
    const ci = Math.floor(x / c), cj = Math.floor(z / c);
    for (let i = ci - r0; i <= ci + r0; i++) for (let j = cj - r0; j <= cj + r0; j++) {
      const k = this.key(i, j);
      let a = this.cells.get(k);
      if (!a) this.cells.set(k, (a = []));
      a.push(id);
    }
  }
  /** is a rock of reach r at (x, z) clear of the others, allowing them to overlap by `give` of their reaches */
  clear(x: number, z: number, r: number, give = 0.15): boolean {
    const a = this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!a) return true;
    for (const id of a) {
      const px = this.pts[id * 3], pz = this.pts[id * 3 + 1], pr = this.pts[id * 3 + 2];
      if (Math.hypot(x - px, z - pz) < (r + pr) * (1 - give)) return false;
    }
    return true;
  }
}

/** what a piece of ground is: its height and slope, the nearest steep rise within reach (its distance, or Infinity),
 *  and the biggest drop within reach (m, its direction) */
interface Site { h: number; s: number; rise: number; drop: number; out: number }

/** placeRocks, a step at a time (a yield in each of its loops' turns): placeRocksSliced runs it a few milliseconds at
 *  a time for a page that mustn't stall (embed.ts) */
export function* placeRocksSteps(cat: Catalog, ground: Ground, seed = 1): Generator<void, Field> {
  const r = rng(seed);
  const noise = new Noise3(seed + 77);
  const rocks: Rock[] = [];
  const lights: LightSpot[] = [];
  const space = new Spacing();
  const P = cat.protos;
  const DIRS = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);

  const site = (x: number, z: number, reach = 30): Site => {
    const h = ground.heightAt(x, z), s = ground.slopeAt(x, z);
    let rise = Infinity, drop = 0, out = 0;
    for (const d of [reach * 0.2, reach * 0.45, reach]) {
      for (let k = 0; k < 8; k++) {
        const q = ground.heightAt(x + DIRS[k][0] * d, z + DIRS[k][1] * d) - h;
        if (q > 0.8 * d + 2 && d < rise) rise = d;
        if (-q > drop) { drop = -q; out = (k * Math.PI) / 4; }
      }
    }
    return { h, s, rise, drop, out };
  };
  /** the lowest ground under a rock's footprint (so it never floats on a slope) */
  // (the lowest of the ground under it: its middle, and two rings out toward its foot's edge)
  const footY = (x: number, z: number, rad: number) => {
    let y = ground.heightAt(x, z);
    for (const f of [1, 1.5]) for (let k = 0; k < 8; k++) y = Math.min(y, ground.heightAt(x + DIRS[k][0] * rad * f, z + DIRS[k][1] * rad * f));
    return y;
  };
  /** place one: its reach on the ground (m) keeps the spacing; false if it doesn't fit */
  const put = (proto: number, x: number, z: number, scale: number, o: { yaw?: number; tilt?: [number, number]; sink?: number; glow?: number; give?: number; y?: number; free?: boolean } = {}) => {
    const reach = P[proto].radius * scale;
    if (!o.free && (keepOut(x, z, reach * 0.6) || !space.clear(x, z, reach, o.give ?? 0.15))) return false;
    const foot = o.y ?? footY(x, z, reach * 0.6);
    const y = foot - (o.sink ?? 0) * P[proto].height * scale;
    rocks.push({ proto, x, y, z, yaw: o.yaw ?? r() * Math.PI * 2, tilt: o.tilt ?? [0, 0], scale, seed: r(), glow: o.glow ?? 0, ground: P[proto].kind === 'ledge' ? -1e4 : foot });
    space.add(x, z, reach);
    return true;
  };
  const sized = (kind: Kind, pickT: number) => cat.of[kind][Math.min(cat.of[kind].length - 1, Math.floor(pickT * cat.of[kind].length))];
  // the side canyons' centre lines as the land cut them (they wander off the layout's), each from the basin outward
  const lines = centreLines(20);
  const sideLines: V2[][] = [[...lines.west].reverse(), lines.east, lines.south];
  /** in a slot's flying lane (the west and east slots' middles, kept clear of anything big: the flight's look-ahead
   *  sees only the ground) */
  const inLane = (x: number, z: number, reach: number) => [0, 1].some((i) => lineD(x, z, sideLines[i]) < SIDE_CANYONS[i].halfWidth * 0.6 + reach);

  // ---- the land's own hoodoo pillars first (canyon.ts: a heightfield has no overhangs), each made a mushroom rock: the
  // catalogue's nearest in height, scaled to the pillar and standing in it, so its cap overhangs the pillar's top
  // (ref 4) and, smoothed far off as the ground's patches are, the pillar never leaves a cap in the air
  for (const ho of hoodoosIn(BOUNDS.x0, BOUNDS.z0, BOUNDS.x1, BOUNDS.z1)) {
    yield;
    let foot = Infinity;
    for (let k = 0; k < 8; k++) foot = Math.min(foot, ground.heightAt(ho.x + DIRS[k][0] * ho.r * 2, ho.z + DIRS[k][1] * ho.r * 2));
    const rise = ground.heightAt(ho.x, ho.z) - foot;
    if (rise < 6 || rise > 64 || keepOut(ho.x, ho.z, ho.r)) continue;
    const proto = cat.of.mushroom.reduce((best, p) => (Math.abs(P[p].height - rise) < Math.abs(P[best].height - rise) ? p : best));
    put(proto, ho.x, ho.z, (rise + 0.6) / P[proto].height, { y: foot, free: true });
  }

  // ---- arches first (they need room): across the west slot, free on the south canyon's floor, on the plateau
  {
    const west = SIDE_CANYONS[0];
    const [a, b] = [west.path[1], west.path[2]];
    const x = a[0] + (b[0] - a[0]) * 0.45, z = a[1] + (b[1] - a[1]) * 0.45;
    const along = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const proto = cat.of.arch[1];
    // (spanning the slot: the fin's length across it, its opening the slot's width, its ends in the walls)
    const scale = (west.halfWidth * 2 + 6) / (P[proto].span ?? P[proto].radius);
    put(proto, x, z, scale, { yaw: -(along + Math.PI / 2), y: ground.heightAt(x, z), free: true });
    const south = SIDE_CANYONS[2];
    const [c, d] = [south.path[2], south.path[3]];
    const sx = c[0] + (d[0] - c[0]) * 0.3, sz = c[1] + (d[1] - c[1]) * 0.3;
    put(cat.of.arch[2], sx, sz, 1, { yaw: -Math.atan2(d[1] - c[1], d[0] - c[0]) });
    for (let tries = 0; tries < 200; tries++) {
      const px = range(r, 400, 1400), pz = range(r, -1500, -700);
      const st = site(px, pz, 60);
      if (st.h > RIM_Y - 20 && st.s < 0.15 && st.drop < 10 && put(cat.of.arch[0], px, pz, 1)) break;
    }
  }

  // ---- spires framing the side canyons: a pair at each mouth, then by the walls along them, either side in turn
  SIDE_CANYONS.forEach((c, ci) => {
    const path = sideLines[ci];
    let side = r() < 0.5 ? 1 : -1;
    let walked = 0, next = 30;
    for (let i = 1; i < path.length; i++) {
      const [a, b] = [path[i - 1], path[i]];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
      for (; next < walked + L; next += range(r, 160, 320)) {
        const t = next - walked, mouth = next < 200;
        for (const sd of mouth ? [1, -1] : [side]) {
          const proto = sized('spire', mouth ? range(r, 0.6, 1) : r());
          // (in a slot no wider than its wall's share: the lane between stays open)
          const scale = c.halfWidth < 60 ? Math.min(range(r, 0.8, 1.15) * 0.85, (c.halfWidth * 0.3) / P[proto].radius) : range(r, 0.8, 1.15);
          const off = Math.max(8, c.halfWidth - P[proto].radius * scale * 0.9 - 2);
          put(proto, a[0] + ux * t - uz * off * sd, a[1] + uz * t + ux * off * sd, scale, { give: 0.05 });
        }
        side = -side;
      }
      walked += L;
    }
  });

  // ---- hoodoo fields and mushroom groves: centres on the floors of the wide canyons and on the plateau near the rim
  const fieldCentres: { x: number; z: number }[] = [];
  for (let tries = 0; tries < 4000 && fieldCentres.length < 16; tries++) {
    yield;
    const x = range(r, BOUNDS.x0 + 300, BOUNDS.x1 - 300), z = range(r, BOUNDS.z0 + 300, BOUNDS.z1 - 300);
    if (keepOut(x, z, 50) || inEll(x, z, BASIN.cx, BASIN.cz, BASIN.rx + 80, BASIN.rz + 80) || inLane(x, z, 60)) continue;
    const st = site(x, z, 50);
    const floor = st.h < FLOOR_MAX && st.s < 0.2 && st.rise > 45;
    const plateau = st.h > RIM_Y - 20 && st.s < 0.2 && st.drop < 5 && nearRim(x, z, 500);
    if (!floor && !plateau) continue;
    if (fieldCentres.some((f) => Math.hypot(f.x - x, f.z - z) < 450)) continue;
    fieldCentres.push({ x, z });
  }
  function nearRim(x: number, z: number, d: number) {
    for (let k = 0; k < 8; k++) if (ground.heightAt(x + DIRS[k][0] * d, z + DIRS[k][1] * d) < RIM_Y - 60) return true;
    return false;
  }
  fieldCentres.forEach((f, i) => {
    const mushrooms = i % 3 === 2;
    const R = range(r, 60, 140), h0 = ground.heightAt(f.x, f.z);
    const n = Math.round(range(r, 10, mushrooms ? 16 : 30));
    for (let k = 0, placed = 0; k < n * 6 && placed < n; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R;
      const x = f.x + Math.cos(a) * d, z = f.z + Math.sin(a) * d;
      const st = site(x, z, 20);
      if (st.s > 0.3 || Math.abs(st.h - h0) > 10 || st.rise < 20 || inLane(x, z, 10)) continue;
      // (the tallest toward the middle)
      const t = Math.min(1, Math.max(0, 1 - d / R + gauss(r) * 0.25));
      const kind: Kind = mushrooms ? (r() < 0.2 ? 'table' : 'mushroom') : r() < 0.06 ? 'table' : r() < 0.12 ? 'mushroom' : 'hoodoo';
      const proto = sized(kind, kind === 'mushroom' ? t * 0.7 : t);
      if (put(proto, x, z, range(r, 0.8, 1.2), { give: 0.1 })) placed++;
    }
  });

  // ---- mushroom rocks scattered, and the giants (landmarks seen from the city) and the far grove (ref 3)
  for (let tries = 0, n = 0; tries < 3000 && n < 70; tries++) {
    yield;
    const x = range(r, BOUNDS.x0, BOUNDS.x1), z = range(r, BOUNDS.z0, BOUNDS.z1);
    const st = site(x, z, 40);
    const floor = st.h < FLOOR_MAX && st.s < 0.25 && st.rise > 25;
    const plateau = st.h > RIM_Y - 15 && st.s < 0.25 && st.drop < 8;
    if ((!floor && !(plateau && nearRim(x, z, 300))) || inLane(x, z, 20)) continue;
    if (put(sized('mushroom', Math.pow(r(), 1.6) * 0.72), x, z, range(r, 0.8, 1.2))) n++;
  }
  for (const [gx, gz] of GIANTS) {
    yield;
    for (let k = 0; k < 40; k++) {
      const x = gx + gauss(r) * 120, z = gz + gauss(r) * 120;
      const st = site(x, z, 60);
      if (st.s < 0.2 && st.drop < 15 && put(sized('mushroom', range(r, 0.86, 1)), x, z, range(r, 0.9, 1.15))) break;
    }
  }
  for (const [cx, cz] of GROVES) {
    yield;
    for (let k = 0, n = 0; k < 120 && n < 12; k++) {
      const x = cx + gauss(r) * 260, z = cz + gauss(r) * 200;
      if (ground.slopeAt(x, z) < 0.25 && put(sized('mushroom', range(r, 0.4, 1)), x, z, range(r, 0.9, 1.3))) n++;
    }
  }

  // ---- crystal grottos at cliff feet in the side canyons: giants against the wall, clusters round them, a light
  const grottos: V2[] = [];
  SIDE_CANYONS.forEach((c, ci) => {
    const path = sideLines[ci];
    for (let tries = 0; tries < 400 && grottos.filter((g) => lineD(g[0], g[1], path) < c.halfWidth + 30).length < 2; tries++) {
      const i = 1 + Math.floor(r() * (path.length - 1));
      const [a, b] = [path[i - 1], path[i]];
      const t = range(r, 0.15, 0.85), sd = r() < 0.5 ? 1 : -1;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
      const x = a[0] + (b[0] - a[0]) * t - uz * (c.halfWidth - 10) * sd, z = a[1] + (b[1] - a[1]) * t + ux * (c.halfWidth - 10) * sd;
      if (keepOut(x, z, 30) || grottos.some((g) => Math.hypot(g[0] - x, g[1] - z) < 700)) continue;
      const st = site(x, z, 40);
      if (st.h > FLOOR_MAX || st.rise > 40) continue;
      grottos.push([x, z]);
      const toWall = Math.atan2(-ux * sd, uz * sd);
      for (let g = 0; g < (r() < 0.5 ? 2 : 1); g++) {
        put(sized('crystal', range(r, 0.67, 1)), x + gauss(r) * 4, z + gauss(r) * 4, range(r, 0.8, 1.1), { tilt: [gauss(r) * 0.12, gauss(r) * 0.12], sink: 0.08, glow: 1, give: 0.4, yaw: toWall + gauss(r) });
      }
      for (let k = 0, n = 0; k < 80 && n < 14; k++) {
        const a2 = r() * Math.PI * 2, d = range(r, 3, 18);
        if (put(sized('crystal', Math.pow(r(), 1.5) * 0.66), x + Math.cos(a2) * d, z + Math.sin(a2) * d, range(r, 0.8, 1.3), { tilt: [gauss(r) * 0.2, gauss(r) * 0.2], sink: 0.1, glow: range(r, 0.6, 1), give: 0.3 })) n++;
      }
      lights.push({ p: [x, ground.heightAt(x, z) + 4, z], color: [0.3, 0.95, 0.85], candela: 1400, when: 'night', radius: 45 });
    }
  });

  // ---- the rim: ledges set into it and crystal fields back from it
  for (let tries = 0, ledges = 0, fields = 0; tries < 30000 && (ledges < 140 || fields < 45); tries++) {
    yield;
    const x = range(r, BOUNDS.x0, BOUNDS.x1), z = range(r, BOUNDS.z0, BOUNDS.z1);
    const st = site(x, z, 18);
    if (st.h < RIM_Y - 12 || st.s > 0.35 || st.drop < 25 || keepOut(x, z, 20)) continue;
    const ox = Math.cos(st.out), oz = Math.sin(st.out);
    if (ledges < 140 && r() < 0.5) {
      const proto = pick(r, cat.of.ledge);
      const W = P[proto].radius;
      const sc = range(r, 0.8, 1.2);
      // (its long axis along the rim, half of it out over the drop; its top a little proud of the plateau)
      if (put(proto, x + ox * W * sc * 0.25, z + oz * W * sc * 0.25, sc, { yaw: -(st.out + Math.PI / 2), y: st.h - 0.15, give: 0.3 })) ledges++;
    } else if (fields < 45) {
      fields++;
      const n = Math.round(range(r, 4, 13));
      for (let k = 0; k < n * 3; k++) {
        const a = r() * Math.PI * 2, d = range(r, 2, 40);
        const cx = x - ox * d * 0.7 + Math.cos(a) * d * 0.5, cz = z - oz * d * 0.7 + Math.sin(a) * d * 0.5;
        if (ground.slopeAt(cx, cz) > 0.4) continue;
        put(sized('crystal', Math.pow(r(), 1.4) * 0.66), cx, cz, range(r, 0.75, 1.3), { tilt: [gauss(r) * 0.15, gauss(r) * 0.15], sink: 0.12, glow: r() < 0.2 ? 0.35 : 0, give: 0.3 });
      }
    }
  }

  // ---- talus at the feet of the cliffs (and benches), and strays on the flats
  /** the distance to the nearest steep rise from flat ground at (x, z) (Infinity: none within 32 m) */
  const riseNear = (x: number, z: number) => {
    const h = ground.heightAt(x, z);
    for (const d of [6, 14, 24, 32]) for (let k = 0; k < 8; k++) {
      if (ground.heightAt(x + DIRS[k][0] * d, z + DIRS[k][1] * d) - h > 0.8 * d + 2) return d;
    }
    return Infinity;
  };
  const cell = 7;
  for (let gx = BOUNDS.x0; gx < BOUNDS.x1; gx += cell * 8) {
    yield;
    for (let gz = BOUNDS.z0; gz < BOUNDS.z1; gz += cell * 8) {
      // (a block of cells with no cliff near is skipped whole, but for a stray boulder now and then)
      const cx = gx + cell * 4, cz = gz + cell * 4;
      const coarse = site(cx, cz, 60);
      if (coarse.rise === Infinity && coarse.drop < 20) {
        if (r() < 0.05) {
          const x = cx + range(r, -20, 20), z = cz + range(r, -20, 20);
          if (ground.slopeAt(x, z) < 0.3) put(sized('boulder', r()), x, z, 0.4 + 2.5 * Math.pow(r(), 2.5), { tilt: [gauss(r) * 0.25, gauss(r) * 0.25], sink: 0.2 });
        }
        continue;
      }
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
        const x = gx + (i + r()) * cell, z = gz + (j + r()) * cell;
        const u = r();
        if (keepOut(x, z, 2) || ground.slopeAt(x, z) > 0.45) continue;
        const rise = riseNear(x, z);
        if (rise === Infinity) continue;
        const fan = 0.6 + 0.7 * (0.5 + 0.5 * noise.fbm(x * 0.012, 0, z * 0.012, 2) * 1.6);
        if (u > 0.92 * Math.exp(-rise / 14) * fan) continue;
        // (the biggest blocks lie close under the cliff)
        const big = Math.exp(-rise / 20);
        const size = 0.4 + (1.2 + 6.5 * big) * Math.pow(r(), 3);
        const isSlab = r() < 0.22;
        const proto = isSlab ? pick(r, cat.of.slab) : pick(r, cat.of.boulder);
        const tilt: [number, number] = isSlab ? [gauss(r) * 0.35, gauss(r) * 0.35] : [gauss(r) * 0.3, gauss(r) * 0.3];
        put(proto, x, z, size, { tilt, sink: isSlab ? 0.15 : range(r, 0.12, 0.3), give: 0.35 });
      }
    }
  }

  return { rocks, lights, ...colliders(cat, rocks) };
}

/** every rock in the canyon, placed on the ground as it is (the catalogue's prototypes, `seed`'s choices) */
export function placeRocks(cat: Catalog, ground: Ground, seed = 1): Field {
  const g = placeRocksSteps(cat, ground, seed);
  for (;;) { const s = g.next(); if (s.done) return s.value; }
}

/** the same, a few milliseconds (`budget`) at a time, the page's frames between */
export async function placeRocksSliced(cat: Catalog, ground: Ground, seed = 1, budget = 6): Promise<Field> {
  const g = placeRocksSteps(cat, ground, seed);
  let t = performance.now();
  for (;;) {
    const s = g.next();
    if (s.done) return s.value;
    if (performance.now() - t > budget) { await new Promise((r) => setTimeout(r)); t = performance.now(); }
  }
}

/** the posts and tops of the placed rocks in world metres (the small ones none; a leaning block one post round its
 *  middle, no top) */
export function colliders(cat: Catalog, rocks: Rock[]): { posts: WorldPost[]; tops: WorldTop[] } {
  const posts: WorldPost[] = [], tops: WorldTop[] = [];
  for (const k of rocks) {
    const p = cat.protos[k.proto];
    if (p.height * k.scale < 0.6 && p.kind !== 'ledge') continue;
    const c = Math.cos(k.yaw), s = Math.sin(k.yaw);
    const leaning = Math.abs(k.tilt[0]) + Math.abs(k.tilt[1]) > 0.12;
    if (leaning) {
      const h = p.height * k.scale * Math.cos(Math.min(1.2, Math.abs(k.tilt[0]) + Math.abs(k.tilt[1])));
      posts.push({ x: k.x, z: k.z, y0: k.y, y1: k.y + Math.max(h, 0.5), r: p.radius * k.scale * 0.65 });
      continue;
    }
    for (const q of p.posts) {
      posts.push({ x: k.x + (c * q.x + s * q.z) * k.scale, z: k.z + (-s * q.x + c * q.z) * k.scale, y0: k.y + q.y0 * k.scale, y1: k.y + q.y1 * k.scale, r: q.r * k.scale });
    }
    for (const q of p.tops) {
      tops.push({ x: k.x + (c * q.x + s * q.z) * k.scale, z: k.z + (-s * q.x + c * q.z) * k.scale, r: q.r * k.scale, y: k.y + q.y * k.scale });
    }
  }
  return { posts, tops };
}

/** a rock's object-to-world transform as a 3x4 row-major matrix: scale, lean about x then z, turn about y, move */
export function matrixOf(k: Rock): number[] {
  const [tx, tz] = k.tilt, s = k.scale;
  const cx = Math.cos(tx), sx = Math.sin(tx), cz = Math.cos(tz), sz = Math.sin(tz), cy = Math.cos(k.yaw), sy = Math.sin(k.yaw);
  // R = Ry · Rz · Rx (applied to a point: lean about x, then about z, then the turn)
  const rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  const rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  const ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const mul = (a: number[][], b: number[][]) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
  const m = mul(ry, mul(rz, rx));
  return [m[0][0] * s, m[0][1] * s, m[0][2] * s, k.x, m[1][0] * s, m[1][1] * s, m[1][2] * s, k.y, m[2][0] * s, m[2][1] * s, m[2][2] * s, k.z];
}

