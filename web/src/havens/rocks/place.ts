// Where the rocks go: the catalogue's prototypes placed round the star mesa from the shared layout (world/layout.ts),
// the land's own lines (the plain's channel and the plateau's fissures as canyon.ts cut them) and the ground (heightAt,
// slopeAt: the terrain as the land filled it). Everything is decided from one seed, so the field is the same on every
// load. Nothing goes inside the town's building line (the town, the plateau and its citadel: only a few dim crystals
// down in the plateau's fissures), on the water gate or the lookouts, in the chute or the channel across the plain or
// on its banks; ground is read for what it is:
//   - talus: boulders and fallen slabs piled at the feet of cliffs — the mesa's all round, the outcrops' and buttes'
//     out on the plain — (where a flat floor or bench meets a steep rise), thickest and biggest close in, thinning
//     outward in fans; a few strays on the open plain;
//   - hoodoo fields: groves of hoodoos (and a table or two) out on the plain, the tallest in the middle;
//   - mushroom rocks: on each of the land's own hoodoo pillars (as tall as it, its cap over its top), scattered over the
//     plain, a few giants as landmarks 1.5-2.5 km out round the star, and a grove on each far horizon behind the
//     citadel (ref 3's silhouettes);
//   - spires: along the channel across the plain by its banks (never over it, where you fly), and framing the foot of
//     every tip's cliff but the east's (its chute's);
//   - ledges: thick plates set into the rim, half out over the cliff's drop;
//   - crystals: about thirty fields of clusters on the rim's crest, round every point; a few glowing grottos (giant
//     crystals and many clusters, a light at night) at the mesa's foot by its notches; and about twenty dim clusters
//     down in the plateau's fissures;
//   - an arch: one, free, out on the plain to the west-north-west.
// Each placed rock is a prototype, a position, a turn, a lean and a scale; the big ones hand over posts (upright
// cylinders a walker can't pass) and tops (to stand on), in world metres, and the grottos their lights.
import type { LightSpot } from '../arch/types';
import { canyonHeight, canyonInfo, channelDistance, channelLine, hoodoosIn } from '../land/canyon';
import { CHANNEL, GARDENS, GATE, PLAIN_Y, PLATEAU, POINTS, RIM, STAR, WAYS, inPoint, polar, sdStar, starReach, type V2 } from '../world/layout';
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

/** the region rocks are placed in (m): the plain all round the star */
const BOUNDS = { x0: -3600, x1: 3600, z0: -3600, z1: 3600 };
/** ground lower than this (m) is the plain's (the mesa's top, its benches and the rim are all higher) */
const FLOOR_MAX = PLAIN_Y + 30;
/** where the giant mushroom rocks stand (each within ~200 m of its mark, where the ground allows): landmarks seen from
 *  the town and the citadel, out on the plain 1.5-2.5 km round the star (none over the channel to the east) */
const GIANTS: V2[] = [polar(1700, 32), polar(2300, 82), polar(1900, 138), polar(2400, 196), polar(1600, 248), polar(2150, 302)];
/** the far groves of mushroom rocks on the plain's horizon behind the citadel (ref 3) */
const GROVES: V2[] = [[-2600, -2000], [2700, -1900]];
/** the notches whose cliffs' feet hold a crystal grotto (degrees: between the south and south-west points, the west
 *  and north-west, the north-east and east) */
const GROTTO_NOTCHES = [112.5, 202.5, 337.5].map((a) => a + STAR.rot);
/** the crystal fields on the rim's crest: two along each of the star's sixteen edges (a tip to a notch), but by the
 *  east tip's water gate; how many dim clusters go down in the plateau's fissures, at most, in each slab sector */
const CREST_FIELDS = [0.3, 0.72], FISSURE_CLUSTERS = 5;

const segD = (x: number, z: number, a: V2, b: V2) => {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
};
const lineD = (x: number, z: number, path: V2[]) => { let d = Infinity; for (let i = 1; i < path.length; i++) d = Math.min(d, segD(x, z, path[i - 1], path[i])); return d; };
const DEG = Math.PI / 180;

/** the lookout towers on the crest's foot behind the tips' squares (every point's but the east's: city/rim.ts) */
const TOWERS: V2[] = POINTS.filter((p) => p.role !== 'palace').map((p) => inPoint(p, WAYS.lookout.r, 0));
/** the chute down the east tip's cliff, from the water gate to the plunge pool the plain's channel leaves (x, its
 *  half-width either side of the gate's axis) */
const CHUTE = { x0: GATE.x - 10, x1: CHANNEL.plain.path[0][0] + 30, half: 26 };
/** the channel across the plain, its banks either side (m from its line) */
const CHANNEL_BANKS = CHANNEL.plain.halfWidth + 22;

/** somewhere the rocks keep out of, for a rock of reach r: the town's ground (everything inside its building line: the
 *  town, the ring road, the plateau and the citadel on it; the rim's crest past the line is the rocks'), the water gate
 *  and the lookouts, the chute and the plain's channel with its banks */
export function keepOut(x: number, z: number, r = 0): boolean {
  if (sdStar(x, z) < -RIM.building + r) return true;
  if (Math.hypot(x - GATE.x, z - GATE.z) < 45 + r) return true;
  for (const t of TOWERS) if (Math.hypot(x - t[0], z - t[1]) < WAYS.lookout.radius + 6 + r) return true;
  if (x > CHUTE.x0 && x < CHUTE.x1 && Math.abs(z - GATE.z) < CHUTE.half + r) return true;
  return x > CHUTE.x1 - 70 && channelDistance(x, z) < CHANNEL_BANKS + r;
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
  /** place one: its reach on the ground (m) keeps the spacing; false if it doesn't fit (`free`: placed where it's
   *  asked, the keep-outs not asked; `inside`: the keep-outs not asked, the spacing still is) */
  const put = (proto: number, x: number, z: number, scale: number, o: { yaw?: number; tilt?: [number, number]; sink?: number; glow?: number; give?: number; y?: number; free?: boolean; inside?: boolean } = {}) => {
    const reach = P[proto].radius * scale;
    if (!o.free && ((!o.inside && keepOut(x, z, reach * 0.6)) || !space.clear(x, z, reach, o.give ?? 0.15))) return false;
    const foot = o.y ?? footY(x, z, reach * 0.6);
    const y = foot - (o.sink ?? 0) * P[proto].height * scale;
    rocks.push({ proto, x, y, z, yaw: o.yaw ?? r() * Math.PI * 2, tilt: o.tilt ?? [0, 0], scale, seed: r(), glow: o.glow ?? 0, ground: P[proto].kind === 'ledge' ? -1e4 : foot });
    space.add(x, z, reach);
    return true;
  };
  const sized = (kind: Kind, pickT: number) => cat.of[kind][Math.min(cat.of[kind].length - 1, Math.floor(pickT * cat.of[kind].length))];
  /** the plain's channel's line as the land cut it, every 20 m (out to the region's edge) */
  const channel = channelLine(20).filter(([x]) => x < BOUNDS.x1);
  /** out on the plain: low, a way out from the mesa's foot (sdStar: past the cliff's ~60 m), off the channel */
  const onPlain = (x: number, z: number, h: number, out = 120, banks = 60) => h < FLOOR_MAX && sdStar(x, z) > out && channelDistance(x, z) > banks;
  /** where the mesa's cliff meets the plain going out along angle a (degrees) from the star's edge: the first point
   *  out where the ground is within 4 m of the plain and level */
  const footAlong = (a: number): V2 => {
    const c = Math.cos(a * DEG), s = Math.sin(a * DEG), r0 = starReach(a);
    for (let d = 0; d < 260; d += 3) {
      const x = STAR.cx + c * (r0 + d), z = STAR.cz + s * (r0 + d);
      if (ground.heightAt(x, z) < PLAIN_Y + 4 && ground.slopeAt(x, z) < 0.3) return [x, z];
    }
    return [STAR.cx + c * (r0 + 120), STAR.cz + s * (r0 + 120)];
  };

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

  // ---- the arch first (it needs room): free on the plain, west-north-west of the star
  for (let tries = 0; tries < 200; tries++) {
    yield;
    const [px, pz] = polar(range(r, 1200, 1500), range(r, 205, 225));
    const st = site(px, pz, 60);
    if (onPlain(px, pz, st.h, 300) && st.s < 0.15 && st.drop < 10 && put(cat.of.arch[2], px, pz, 1)) break;
  }

  // ---- spires: along the channel across the plain by its banks, either side in turn (never over it: the lane above
  // the water stays open for flying), and framing the foot of every tip's cliff but the east's
  {
    let side = r() < 0.5 ? 1 : -1, walked = 0, next = 120;
    for (let i = 1; i < channel.length; i++) {
      const [a, b] = [channel[i - 1], channel[i]];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
      for (; next < walked + L; next += range(r, 160, 320)) {
        const t = next - walked, proto = sized('spire', r()), scale = range(r, 0.8, 1.15);
        const off = CHANNEL_BANKS + P[proto].radius * scale + range(r, 4, 40);
        put(proto, a[0] + ux * t - uz * off * side, a[1] + uz * t + ux * off * side, scale, { give: 0.05 });
        side = -side;
      }
      walked += L;
    }
  }
  for (const p of POINTS) {
    yield;
    if (p.role === 'palace') continue;
    const [fx, fz] = footAlong(p.tip), c = Math.cos(p.tip * DEG), s = Math.sin(p.tip * DEG);
    for (const sd of [1, -1]) {
      for (let k = 0; k < 12; k++) {
        const out = range(r, 18, 60), across = sd * range(r, 40, 85), proto = sized('spire', range(r, 0.45, 1));
        if (put(proto, fx + c * out - s * across, fz + s * out + c * across, range(r, 0.8, 1.1), { give: 0.05 })) break;
      }
    }
  }

  // ---- hoodoo fields and mushroom groves: centres out on the plain
  const fieldCentres: { x: number; z: number }[] = [];
  for (let tries = 0; tries < 4000 && fieldCentres.length < 16; tries++) {
    yield;
    const x = range(r, BOUNDS.x0 + 300, BOUNDS.x1 - 300), z = range(r, BOUNDS.z0 + 300, BOUNDS.z1 - 300);
    if (keepOut(x, z, 50)) continue;
    const st = site(x, z, 50);
    if (!onPlain(x, z, st.h, 250, 160) || st.s > 0.2 || st.rise < 45) continue;
    if (fieldCentres.some((f) => Math.hypot(f.x - x, f.z - z) < 450)) continue;
    fieldCentres.push({ x, z });
  }
  fieldCentres.forEach((f, i) => {
    const mushrooms = i % 3 === 2;
    const R = range(r, 60, 140), h0 = ground.heightAt(f.x, f.z);
    const n = Math.round(range(r, 10, mushrooms ? 16 : 30));
    for (let k = 0, placed = 0; k < n * 6 && placed < n; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R;
      const x = f.x + Math.cos(a) * d, z = f.z + Math.sin(a) * d;
      const st = site(x, z, 20);
      if (st.s > 0.3 || Math.abs(st.h - h0) > 10 || st.rise < 20 || channelDistance(x, z) < CHANNEL_BANKS + 10) continue;
      // (the tallest toward the middle)
      const t = Math.min(1, Math.max(0, 1 - d / R + gauss(r) * 0.25));
      const kind: Kind = mushrooms ? (r() < 0.2 ? 'table' : 'mushroom') : r() < 0.06 ? 'table' : r() < 0.12 ? 'mushroom' : 'hoodoo';
      const proto = sized(kind, kind === 'mushroom' ? t * 0.7 : t);
      if (put(proto, x, z, range(r, 0.8, 1.2), { give: 0.1 })) placed++;
    }
  });

  // ---- mushroom rocks scattered over the plain, and the giants (landmarks seen from the town) and the far groves
  // (ref 3)
  for (let tries = 0, n = 0; tries < 3000 && n < 70; tries++) {
    yield;
    const x = range(r, BOUNDS.x0, BOUNDS.x1), z = range(r, BOUNDS.z0, BOUNDS.z1);
    const st = site(x, z, 40);
    if (!onPlain(x, z, st.h) || st.s > 0.25 || st.rise < 25) continue;
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

  // ---- crystal grottos at the mesa's foot by its notches: giants against the cliff, clusters round them, a light
  for (const a of GROTTO_NOTCHES) {
    // (back in from the foot to where the wall itself rises — past the sand drifted against it — and 5 m out from
    // there, in the notch's corner; the giants lean back toward the wall)
    const [fx, fz] = footAlong(a), c = Math.cos(a * DEG), s = Math.sin(a * DEG);
    let back = 0;
    while (back < 60 && ground.heightAt(fx - c * back, fz - s * back) < PLAIN_Y + 8) back++;
    const x = fx - c * (back - 5), z = fz - s * (back - 5), toWall = Math.atan2(c, s);
    for (let g = 0; g < (r() < 0.5 ? 2 : 1); g++) {
      put(sized('crystal', range(r, 0.67, 1)), x + gauss(r) * 4, z + gauss(r) * 4, range(r, 0.8, 1.1), { tilt: [gauss(r) * 0.12, gauss(r) * 0.12], sink: 0.08, glow: 1, give: 0.4, yaw: toWall + gauss(r) });
    }
    for (let k = 0, n = 0; k < 80 && n < 14; k++) {
      const a2 = r() * Math.PI * 2, d = range(r, 3, 18);
      if (put(sized('crystal', Math.pow(r(), 1.5) * 0.66), x + Math.cos(a2) * d, z + Math.sin(a2) * d, range(r, 0.8, 1.3), { tilt: [gauss(r) * 0.2, gauss(r) * 0.2], sink: 0.1, glow: range(r, 0.6, 1), give: 0.3 })) n++;
    }
    lights.push({ p: [x, ground.heightAt(x, z) + 4, z], color: [0.3, 0.95, 0.85], candela: 1400, when: 'night', radius: 45 });
  }

  // ---- the rim: ledges set into it all round, half out over the cliff's drop, and crystal fields on its crest
  /** a spot on the rim's edge near angle a (degrees): on the crest, the cliff's drop within reach, and which way out */
  const rimSpot = (a: number, inset: number) => {
    const [x, z] = polar(starReach(a, inset), a);
    const st = site(x, z, 18);
    return st.h > -3 && st.s < 0.35 && st.drop > 25 ? { x, z, st } : null;
  };
  for (let tries = 0, ledges = 0; tries < 6000 && ledges < 100; tries++) {
    yield;
    const spot = rimSpot(r() * 360, range(r, -4, 6));
    if (!spot) continue;
    const { x, z, st } = spot, ox = Math.cos(st.out), oz = Math.sin(st.out);
    const proto = pick(r, cat.of.ledge);
    const W = P[proto].radius;
    const sc = range(r, 0.8, 1.2);
    // (its long axis along the rim, half of it out over the drop; its top a little proud of the crest)
    if (put(proto, x + ox * W * sc * 0.25, z + oz * W * sc * 0.25, sc, { yaw: -(st.out + Math.PI / 2), y: st.h - 0.15, give: 0.3 })) ledges++;
  }
  /** the star's outward way at (x, z) (sdStar's gradient, level) */
  const outward = (x: number, z: number): V2 => {
    const gx = sdStar(x + 1, z) - sdStar(x - 1, z), gz = sdStar(x, z + 1) - sdStar(x, z - 1), L = Math.hypot(gx, gz) || 1;
    return [gx / L, gz / L];
  };
  // (the fields from a stream of their own: where they lie doesn't move when anything placed before them does, so the
  // views among them — dev/views.ts rim-crystals — find them)
  const rc = rng(seed + 31);
  for (let e = 0; e < 16; e++) {
    yield;
    // (the edge from a tip to a notch, or back: two fields along it, on the crest 6-16 m in from the edge where it's
    // level enough and still on top)
    const a0 = STAR.rot + 22.5 * e;
    for (const f of CREST_FIELDS) {
      const a = a0 + 22.5 * f + range(rc, -2, 2);
      // (none by the water gate on the east tip)
      if (Math.abs(((a - STAR.rot + 540) % 360) - 180) < 9) continue;
      let spot: V2 | null = null;
      for (let k = 0; k < 16 && !spot; k++) {
        const aa = a + range(rc, -2.5, 2.5), [x, z] = polar(starReach(aa, range(rc, 6, 16)), aa);
        if (ground.heightAt(x, z) > -1 && ground.slopeAt(x, z) < 0.4 && !keepOut(x, z, 4)) spot = [x, z];
      }
      if (!spot) continue;
      const [x, z] = spot, [ox, oz] = outward(x, z);
      const n = Math.round(range(rc, 5, 13));
      for (let k = 0; k < n * 3; k++) {
        // (spread along the crest more than across it: back from the edge, never out over it)
        const along = range(rc, -18, 18), d = range(rc, 0, 12);
        const cx = x - ox * d - oz * along, cz = z - oz * d + ox * along;
        if (ground.slopeAt(cx, cz) > 0.4 || ground.heightAt(cx, cz) < -1) continue;
        put(sized('crystal', Math.pow(rc(), 1.4) * 0.66), cx, cz, range(rc, 0.75, 1.3), { tilt: [gauss(rc) * 0.15, gauss(rc) * 0.15], sink: 0.12, glow: rc() < 0.2 ? 0.35 : 0, give: 0.3 });
      }
    }
  }

  // ---- dim crystal clusters down in the plateau's fissures (the land's: canyon.ts's zone 9, where the ground the town
  // and the Haven left is still the land's own), a few in each slab sector, spread apart
  for (const w of GARDENS.wedges) {
    yield;
    if (w.kind !== 'top') continue;
    const spots: V2[] = [];
    for (let tries = 0; tries < 900 && spots.length < FISSURE_CLUSTERS; tries++) {
      const a = w.a0 + (w.a1 - w.a0) * range(r, 0.12, 0.88), rr = range(r, w.r1 + 24, PLATEAU.r - 12);
      const x = PLATEAU.cx + Math.cos(a) * rr, z = PLATEAU.cz + Math.sin(a) * rr;
      if (spots.some((q) => Math.hypot(q[0] - x, q[1] - z) < 26)) continue;
      const info = canyonInfo(x, z);
      if (info.zone !== 9 || info.h > PLATEAU.topY - 4 || Math.abs(ground.heightAt(x, z) - canyonHeight(x, z)) > 0.3) continue;
      const proto = sized('crystal', Math.pow(r(), 1.3) * 0.5), sc = range(r, 0.7, 1);
      if (P[proto].radius * sc > 1.6) continue;
      if (put(proto, x, z, sc, { tilt: [gauss(r) * 0.15, gauss(r) * 0.15], sink: 0.12, glow: range(r, 0.25, 0.45), give: 0.3, inside: true })) spots.push([x, z]);
    }
  }

  // ---- talus at the feet of the cliffs (the mesa's, the outcrops' and their benches), and strays on the flats
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
      // (a block of cells with no cliff near is skipped whole, but for a stray boulder now and then; the town's skipped
      // whole: nothing's placed there)
      const cx = gx + cell * 4, cz = gz + cell * 4;
      if (sdStar(cx, cz) < -RIM.building - 40) continue;
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

