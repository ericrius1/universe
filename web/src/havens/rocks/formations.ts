// The standing formations, each a stack of beds revolved about its wandering axis (strata.ts), at four levels of detail
// from one seed (the last, for far silhouettes, with beds of one radius merged): hoodoos (ref 4's middle: a pinched, two-legged stem widening up into a stack of ragged plates, a neck
// and a broad caprock; or a Bryce-like totem of thin alternating beds; or a squat goblin), mushroom rocks (ref 4, ref
// 3's horizon: a broad flat cap of two or three hard beds, off-centre, overhanging a stem that flares like a trumpet
// into it), tables (ref 4's right: one cap on two or three legs), spires (ref 8: tall knobbly pinnacles, pointed or with
// a small caprock, leaning) and ledges (thick ragged plates to set into the rim, overhanging the drop). Each is in its
// own metres with the ground line at y = 0 (the foot buried below it) and returns its posts and tops in the same frame.
// LOD 0 keeps within a triangle budget (BUDGET, more for the giants) by taking fewer steps round.
import { MeshKit, revolve, type Outline } from './mesh';
import { range, rng, type Rand } from './noise';
import { postsOf, type Post, type Proto, type Top } from './proto';
import { ellipse, LODS, mul, Outlines, profile, shifted, stepsAt, top, waves, type Bed, type Lod } from './strata';

/** LOD 0 triangles for one formation, and for a giant (over GIANT m tall) */
export const BUDGET = 19000, GIANT_BUDGET = 56000, GIANT = 40;

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** each formation's beds get ids of their own (the shader colours a bed by its id) */
const idBase = (seed: number) => (seed % 997) * 64;

/** angle steps at LOD 0: one per `step` m round a ring of circumference c, within [lo, hi], and no more than `budget`
 *  triangles allow over `rings` rings; a multiple of 8 */
function steps0(c: number, step: number, lo: number, hi: number, rings: number, budget: number) {
  const n = Math.min(hi, Math.max(lo, c / step), budget / (2 * rings));
  return Math.max(16, Math.floor(n / 8) * 8);
}
const budgetOf = (h: number) => (h > GIANT ? GIANT_BUDGET : BUDGET);

interface Built { kit: MeshKit; posts: Post[]; tops: Top[]; height: number; radius: number }

/** a prototype from a builder run once per level of detail (the same seed, so the same rock coarser) */
function proto(kind: Proto['kind'], name: string, seed: number, build: (lod: Lod) => Built): Proto {
  const b = LODS.map((lod) => build(lod));
  return { kind, name, seed, lods: b.map((x) => x.kit.finish()), height: b[0].height, radius: b[0].radius, posts: b[0].posts, tops: b[0].tops };
}

/** the beds of a stack from y0 to y1 (see StackSpec), appended to `beds` */
interface StackSpec {
  y0: number; y1: number; h: number;
  /** thickness range (m) */
  thick: [number, number];
  /** the chance a bed at height y is hard (never three hard in a row) */
  pHard: (y: number) => number;
  /** radius against env(y): hard beds (by height), soft beds */
  hardOut: (y: number) => [number, number];
  softOut: [number, number];
  /** a soft bed's recess, a hard bed's bulge, a hard bed's edge roundness (fraction of its thickness) */
  sag: [number, number]; bulge: [number, number]; round: [number, number];
  env: (y: number) => number;
  /** an extra outline factor by height (a pinched waist) */
  shape?: (y: number) => Outline;
  corners: [number, number]; jag: [number, number];
  flutes: { k: number; f: number };
  firstSoft?: boolean;
}
function stack(r: Rand, ol: Outlines, id0: number, s: StackSpec, beds: Bed[] = []): Bed[] {
  let y = s.y0, run = 0;
  while (y < s.y1 - 0.05) {
    let t = range(r, s.thick[0], s.thick[1]);
    if (s.y1 - (y + t) < s.thick[0] * 0.6) t = s.y1 - y;
    const ym = y + t / 2;
    const hard = !(s.firstSoft && beds.length === 0) && run < 2 && r() < s.pHard(ym);
    run = hard ? run + 1 : 0;
    const [lo, hi] = hard ? s.hardOut(ym) : s.softOut;
    const out = range(r, lo, hi);
    const id = id0 + beds.length;
    const own = hard
      ? ol.hard(r, id, Math.round(range(r, s.corners[0], s.corners[1])), range(r, s.jag[0], s.jag[1]), 0.04, 0.35)
      : ol.soft(id, 0.035, s.flutes.k, s.flutes.f);
    const o = mul(ol.body(ym, s.h), own);
    beds.push({
      y0: y, y1: y + t, r0: s.env(y) * out, r1: s.env(y + t) * out, hard, o: s.shape ? mul(o, s.shape(ym)) : o, dy: () => 0, id,
      sag: hard ? range(r, s.bulge[0], s.bulge[1]) : range(r, s.sag[0], s.sag[1]), round: range(r, s.round[0], s.round[1]), flags: 0,
    });
    y += t;
  }
  return beds;
}

/** a hard plate of explicit size, its outline times `shape` */
function plate(r: Rand, ol: Outlines, id: number, y0: number, y1: number, r0: number, r1: number, round: number, h: number, shape: Outline = () => 1, jag = 0.12): Bed {
  const o = mul(mul(ol.body((y0 + y1) / 2, h), ol.hard(r, id, Math.round(range(r, 7, 12)), jag, 0.05, 0.3, 0.12)), shape);
  return { y0, y1, r0, r1, hard: true, o, dy: () => 0, id, sag: range(r, 0.02, 0.05), round, flags: 0 };
}

/** the posts of a bed stack (its mean radius per bed, merged where alike) about an axis */
const postsOfBeds = (beds: Bed[], axis: (y: number) => [number, number] = () => [0, 0]) =>
  postsOf(beds.map((b) => ({ y0: b.y0, y1: b.y1, r: ((b.r0 + b.r1) / 2) * (1 - (b.hard ? 0 : b.sag) * 0.6) })))
    .map((p) => { const [x, z] = axis((p.y0 + p.y1) / 2); return { ...p, x, z }; });

/** reach from the axis: the widest bed's outline at its widest, plus how far the axis strays */
const reachOf = (beds: Bed[], axis: (y: number) => [number, number] = () => [0, 0]) => {
  let m = 0;
  for (const b of beds) {
    const [ax, az] = axis((b.y0 + b.y1) / 2);
    for (let i = 0; i < 64; i++) m = Math.max(m, Math.max(b.r0, b.r1) * b.o((i / 64) * Math.PI * 2) + Math.hypot(ax, az));
  }
  return m;
};

/** where a shifted cap's middle sits (its outline's centroid, sampled) */
function centreOf(o: Outline, r: number): [number, number] {
  let x = 0, z = 0;
  for (let i = 0; i < 64; i++) { const t = (i / 64) * Math.PI * 2, q = o(t) * r; x += Math.cos(t) * q; z += Math.sin(t) * q; }
  return [x / 64, z / 64];
}

/** A hoodoo, height H (6-30 m). */
export function hoodoo(seed: number, H: number): Proto {
  return proto('hoodoo', `hoodoo-${seed}`, seed, (lod) => {
    const r = rng(seed);
    const ol = new Outlines(seed, range(r, 0.12, 0.2));
    const style = r();
    const totem = style < 0.3, goblin = style > 0.75;
    const R0 = H * (totem ? range(r, 0.11, 0.14) : goblin ? range(r, 0.19, 0.25) : range(r, 0.11, 0.14));
    const sink = 0.5 + H * 0.04;
    const capT = H * range(r, 0.08, 0.13), neckT = H * (goblin ? range(r, 0.03, 0.06) : range(r, 0.05, 0.1));
    const yCap = H - capT, yNeck = yCap - neckT;
    const env = (y: number) => {
      const u = Math.max(0, y) / H;
      const shape = totem ? 1 - 0.15 * u : goblin ? 1 - 0.35 * u * u : 0.82 + 0.6 * smooth(0.12, 0.7, u);
      return R0 * (1 + 0.5 * Math.exp(-(y + sink) / (0.05 * H + 0.4))) * shape;
    };
    const axis = ol.wander(R0 * (totem ? 0.25 : 0.35), H);
    const legs = !totem && r() < 0.7;
    const a0 = r() * Math.PI, pinch = range(r, 0.22, 0.4);
    const k = Math.max(4, Math.round((2 * Math.PI * R0) / range(r, 2.2, 3.6)));
    const beds = stack(r, ol, idBase(seed), {
      y0: -sink, y1: yNeck, h: H, env,
      thick: totem ? [H * 0.05, H * 0.11] : goblin ? [H * 0.09, H * 0.18] : [H * 0.045, H * 0.1],
      pHard: (y) => (y < 0.3 ? 0 : totem ? 0.35 : goblin ? 0.25 : y / H > 0.3 ? 0.6 : 0.1),
      hardOut: (y) => (totem ? [1.06, 1.2] : goblin ? [1.03, 1.12] : y / H > 0.3 ? [1.15, 1.42] : [1.05, 1.16]),
      softOut: totem ? [0.78, 1.0] : goblin ? [0.86, 1.0] : [0.8, 0.92],
      sag: goblin ? [0.04, 0.1] : totem ? [0.1, 0.2] : [0.06, 0.14], bulge: [0.02, 0.06], round: [0.22, 0.38],
      shape: legs ? (y) => ol.pinch(a0, pinch * (1 - smooth(0.0, 0.42, y / H))) : undefined,
      corners: [6, 10], jag: [0.08, 0.2], flutes: { k, f: goblin ? 0.02 : range(r, 0.03, 0.07) }, firstSoft: true,
    });
    // the neck, worn thin under the cap, then the caprock (in one or two beds), wider at its top and a little off-centre
    const id = idBase(seed) + beds.length;
    beds.push({
      y0: yNeck, y1: yCap, r0: env(yNeck) * range(r, 0.6, 0.78), r1: env(yCap) * range(r, 0.5, 0.66), hard: false,
      o: mul(ol.body(yNeck, H), ol.soft(id, 0.05, k, 0.05)), dy: () => 0, id, sag: range(r, 0.05, 0.12), round: 0.2, flags: 0,
    });
    const capR = env(yCap) * (goblin ? range(r, 0.9, 1.15) : totem ? range(r, 1.1, 1.4) : range(r, 1.2, 1.5));
    const flare = range(r, 1.05, 1.3);
    const capShape = mul(shifted(range(r, 0.04, 0.16), r() * 6.28), ellipse(range(r, 1.0, 1.3), r() * 6.28));
    if (capT > 1.6 && r() < 0.6) {
      const ys = yCap + capT * range(r, 0.55, 0.7);
      beds.push(plate(r, ol, id + 1, yCap, ys, capR, capR * flare, range(r, 0.25, 0.4), H, capShape));
      const rs = capR * flare * range(r, 0.8, 0.92);
      beds.push(plate(r, ol, id + 2, ys, H, rs, rs * range(r, 0.92, 1.0), range(r, 0.3, 0.45), H, capShape));
    } else beds.push(plate(r, ol, id + 1, yCap, H, capR, capR * flare, range(r, 0.25, 0.4), H, capShape));
    waves(beds, ol);
    const kit = new MeshKit();
    const pts = profile(beds, lod);
    pts.push(...top(pts, lod, capT * range(r, 0.04, 0.14), capT * 0.05, ol.noise, seed));
    const n0 = steps0(2 * Math.PI * Math.max(capR, R0 * 1.4), 0.4, 48, 112, profile(beds, LODS[0]).length + 4, budgetOf(H));
    revolve(kit, pts, { n: stepsAt(n0, lod), phase: (seed % 17) * 0.37, axis });
    const [ax, az] = axis(H), [cx, cz] = centreOf(capShape, capR);
    return { kit, posts: postsOfBeds(beds, axis), tops: [{ x: ax + cx, z: az + cz, r: capR * 0.75, y: H }], height: H, radius: reachOf(beds, axis) };
  });
}

/** A mushroom rock, height H (6-60 m): a broad cap on a stem that flares into it. */
export function mushroom(seed: number, H: number): Proto {
  return proto('mushroom', `mushroom-${seed}`, seed, (lod) => {
    const r = rng(seed);
    const ol = new Outlines(seed, range(r, 0.1, 0.15));
    const Rc = H * range(r, 0.45, 0.72), Tc = H * range(r, 0.09, 0.14);
    const yC = H - Tc;
    const Rs = Rc * range(r, 0.2, 0.3);
    const sink = 0.5 + H * 0.03;
    // (the trumpet opens to about half the cap: the cap overhangs it all round)
    const trumpet = (Rc * range(r, 0.42, 0.58)) / Rs - 1;
    const env = (y: number) => Rs * (1 + 0.8 * Math.exp(-(y + sink) / (0.05 * H + 0.4)) + trumpet * smooth(0.4, 1, y / yC) ** 2);
    const axis = ol.wander(Rs * 0.4, H);
    const k = Math.max(4, Math.round((2 * Math.PI * Rs) / range(r, 2.2, 3.4)));
    const beds = stack(r, ol, idBase(seed), {
      y0: -sink, y1: yC, h: H, env, thick: [H * 0.05, H * 0.12],
      pHard: (y) => (y < 0.3 || y > yC * 0.8 ? 0 : 0.25),
      hardOut: () => [1.05, 1.14], softOut: [0.9, 1.0], sag: [0.05, 0.1], bulge: [0.02, 0.04], round: [0.25, 0.4],
      corners: [7, 11], jag: [0.06, 0.14], flutes: { k, f: range(r, 0.05, 0.1) }, firstSoft: true,
    });
    const stemBeds = beds.slice();
    // the cap: off-centre and a little oval; a lower bed flaring out to the rim (undercut beneath), one or two more
    // stepping in, edges rounded
    const capShape = mul(shifted(range(r, 0.06, 0.2), r() * 6.28), ellipse(range(r, 1.0, 1.35), r() * 6.28));
    const id = idBase(seed) + beds.length;
    const yA = yC + Tc * range(r, 0.5, 0.65);
    const rb = Rc * range(r, 0.86, 0.95);
    beds.push(plate(r, ol, id, yC, yA, Rc * range(r, 0.82, 0.9), Rc, range(r, 0.28, 0.4), H, capShape, range(r, 0.08, 0.16)));
    let rTop = rb;
    if (r() < 0.6) {
      const yB = yA + (H - yA) * range(r, 0.5, 0.65);
      beds.push(plate(r, ol, id + 1, yA, yB, rb, rb, range(r, 0.3, 0.4), H, capShape));
      rTop = rb * range(r, 0.86, 0.95);
      beds.push(plate(r, ol, id + 2, yB, H, rTop, rTop * 0.98, 0.4, H, capShape));
    } else beds.push(plate(r, ol, id + 1, yA, H, rb, rb * 0.96, range(r, 0.3, 0.45), H, capShape));
    waves(beds, ol, 0.12, 0.5);
    const kit = new MeshKit();
    const pts = profile(beds, lod);
    pts.push(...top(pts, lod, Tc * range(r, 0.03, 0.1), Tc * 0.05, ol.noise, seed));
    const n0 = steps0(2 * Math.PI * Rc, 0.6, 64, 176, profile(beds, LODS[0]).length + 4, budgetOf(H));
    revolve(kit, pts, { n: stepsAt(n0, lod), phase: (seed % 17) * 0.37, axis });
    const [ax, az] = axis(H), [cx, cz] = centreOf(capShape, Rc);
    const posts = [...postsOfBeds(stemBeds, axis), { x: ax + cx, z: az + cz, y0: yC, y1: H, r: Rc * 0.8 }];
    return { kit, posts, tops: [{ x: ax + cx, z: az + cz, r: rTop * 0.8, y: H }], height: H, radius: reachOf(beds, axis) };
  });
}

/** A table: one broad cap (H tall in all) held up on two or three legs (ref 4's right). */
export function table(seed: number, H: number): Proto {
  return proto('table', `table-${seed}`, seed, (lod) => {
    const r = rng(seed);
    const ol = new Outlines(seed, range(r, 0.1, 0.14));
    const legs = r() < 0.55 ? 2 : 3;
    const aspect = legs === 2 ? range(r, 1.4, 1.9) : range(r, 1.05, 1.3);
    const Rc = H * range(r, 0.55, 0.8), Tc = H * range(r, 0.12, 0.17);
    const yC = H - Tc;
    const shape = ellipse(aspect);
    const kit = new MeshKit();
    const posts: Post[] = [];
    // the legs, under the cap's long axis (or round it), each flaring at its foot and up into the cap
    const spread = Rc * range(r, 0.42, 0.55);
    for (let g = 0; g < legs; g++) {
      const a = legs === 2 ? g * Math.PI + range(r, -0.25, 0.25) : (g / 3) * Math.PI * 2 + range(r, -0.3, 0.3);
      const d = spread * (legs === 2 ? 1 : 0.8) * range(r, 0.85, 1.1);
      const lx = Math.cos(a) * d, lz = (Math.sin(a) * d) / aspect;
      const Rs = Rc * range(r, 0.13, 0.19), flare = range(r, 1.3, 1.9);
      const sink = 0.5 + H * 0.03;
      const lol = new Outlines(seed + 101 * (g + 1), 0.14);
      const env = (y: number) => Rs * (1 + 0.7 * Math.exp(-(y + sink) / (0.05 * H + 0.4)) + flare * smooth(0.45, 1, y / yC) ** 2);
      const wob = lol.wander(Rs * 0.45, H, g);
      const legAxis = (y: number): [number, number] => { const [wx, wz] = wob(y); return [lx + wx, lz + wz]; };
      const legBeds = stack(r, lol, idBase(seed) + 32 + g * 10, {
        y0: -sink, y1: yC + Tc * 0.3, h: H, env, thick: [H * 0.07, H * 0.15], pHard: () => 0.2,
        hardOut: () => [1.04, 1.12], softOut: [0.9, 1.0], sag: [0.05, 0.1], bulge: [0.02, 0.04], round: [0.25, 0.35],
        corners: [6, 9], jag: [0.06, 0.12], flutes: { k: Math.max(4, Math.round((2 * Math.PI * Rs) / 2.6)), f: 0.06 }, firstSoft: true,
      });
      waves(legBeds, lol);
      const pts = profile(legBeds, lod);
      pts.push(...top(pts, lod, 0, 0, lol.noise, seed + g));
      const n0 = steps0(2 * Math.PI * Rs * 2.5, 0.45, 32, 96, profile(legBeds, LODS[0]).length + 4, budgetOf(H) * 0.18);
      revolve(kit, pts, { n: stepsAt(n0, lod), phase: g * 1.3, axis: legAxis });
      posts.push(...postsOfBeds(legBeds.filter((b) => b.y1 <= yC), legAxis));
    }
    // the cap: a closed slab of two beds over them, the lower flaring to the rim
    const id = idBase(seed) + 60;
    const yA = yC + Tc * range(r, 0.5, 0.65);
    const beds: Bed[] = [
      plate(r, ol, id, yC, yA, Rc * 0.88, Rc, range(r, 0.3, 0.4), H, shape),
      plate(r, ol, id + 1, yA, H, Rc * range(r, 0.86, 0.94), Rc * range(r, 0.82, 0.9), range(r, 0.3, 0.45), H, shape),
    ];
    waves(beds, ol, 0.1, 0.4);
    const pts = profile(beds, lod, { bottom: Tc * 0.06 });
    pts.push(...top(pts, lod, Tc * 0.05, Tc * 0.05, ol.noise, seed));
    const n0 = steps0(2 * Math.PI * Rc, 0.6, 64, 176, profile(beds, LODS[0]).length + 4, budgetOf(H) * 0.45);
    revolve(kit, pts, { n: stepsAt(n0, lod), phase: (seed % 17) * 0.37 });
    posts.push({ x: 0, z: 0, y0: yC, y1: H, r: (Rc / aspect) * 0.9 });
    return { kit, posts, tops: [{ x: 0, z: 0, r: (Rc / aspect) * 0.85, y: H }], height: H, radius: reachOf(beds) };
  });
}

/** A spire, height H (15-90 m): a tall knobbly pinnacle, widest low down, pointed or capped, leaning. */
export function spire(seed: number, H: number): Proto {
  return proto('spire', `spire-${seed}`, seed, (lod) => {
    const r = rng(seed);
    const ol = new Outlines(seed, range(r, 0.12, 0.18));
    const Rb = H * range(r, 0.075, 0.11);
    const sink = 0.5 + H * 0.03;
    const pointed = r() < 0.55;
    const yTop = H * range(r, 0.86, 0.92);
    const neckAt = range(r, 0.5, 0.7), bulge = range(r, 0.1, 0.3), bulgeAt = range(r, 0.2, 0.45);
    const lump = range(r, 0.08, 0.18), lumpK = range(r, 1.4, 2.6), lumpPh = r() * 6.28;
    const env = (y: number) => {
      const u = Math.max(0, y) / H;
      const taper = 1 - 0.6 * smooth(neckAt, 1.0, u) - 0.12 * u;
      const lumps = 1 + lump * Math.sin(Math.PI * 2 * u * lumpK + lumpPh);
      return Rb * (1 + 0.45 * Math.exp(-(y + sink) / (0.04 * H + 0.4))) * taper * lumps * (1 + bulge * Math.sin(Math.PI * Math.min(1, u / (2 * bulgeAt))));
    };
    const lean: [number, number] = [range(r, -0.07, 0.07) * H, range(r, -0.07, 0.07) * H];
    const wob = ol.wander(Rb * 0.4, H);
    const axis = (y: number): [number, number] => { const u = Math.max(0, y) / H, [wx, wz] = wob(y); return [lean[0] * u * u + wx, lean[1] * u * u + wz]; };
    const k = Math.max(4, Math.round((2 * Math.PI * Rb) / range(r, 2.0, 3.2)));
    const beds = stack(r, ol, idBase(seed), {
      y0: -sink, y1: yTop, h: H, env, thick: [H * 0.04, H * 0.1],
      pHard: (y) => (y < 0.3 ? 0 : 0.3), hardOut: () => [1.06, 1.18], softOut: [0.82, 0.95],
      sag: [0.06, 0.13], bulge: [0.02, 0.05], round: [0.25, 0.4],
      corners: [5, 8], jag: [0.08, 0.18], flutes: { k, f: range(r, 0.05, 0.1) }, firstSoft: true,
    });
    let topR = env(yTop);
    if (!pointed) {
      // a small caprock on a short neck
      const id = idBase(seed) + beds.length;
      const ny = yTop + (H - yTop) * 0.35;
      beds.push({ y0: yTop, y1: ny, r0: env(yTop) * 0.8, r1: env(ny) * 0.65, hard: false, o: mul(ol.body(yTop, H), ol.soft(id, 0.04, k, 0.04)), dy: () => 0, id, sag: 0.08, round: 0.2, flags: 0 });
      topR = env(ny) * range(r, 1.4, 1.9);
      beds.push(plate(r, ol, id + 1, ny, H, topR, topR * range(r, 1.0, 1.15), 0.35, H, shifted(range(r, 0.05, 0.2), r() * 6.28)));
    }
    waves(beds, ol);
    const kit = new MeshKit();
    const pts = profile(beds, lod);
    if (pointed) pts.push(...top(pts, lod, (H - yTop) * 0.8, (H - yTop) * 0.06, ol.noise, seed, 2));
    else pts.push(...top(pts, lod, (H - yTop) * 0.05, 0.05, ol.noise, seed));
    const n0 = steps0(2 * Math.PI * Rb * 1.5, 0.5, 40, 88, profile(beds, LODS[0]).length + 4, budgetOf(H));
    revolve(kit, pts, { n: stepsAt(n0, lod), phase: (seed % 17) * 0.37, axis });
    const [tx, tz] = axis(H);
    return { kit, posts: postsOfBeds(beds, axis), tops: pointed ? [] : [{ x: tx, z: tz, r: topR * 0.7, y: H }], height: H, radius: reachOf(beds, axis) };
  });
}

/** A ledge: a thick ragged plate (long radius W, along x) to set into the rim, its top at y = 0.4 (place.ts sets it
 *  half out over the drop). */
export function ledge(seed: number, W: number): Proto {
  return proto('ledge', `ledge-${seed}`, seed, (lod) => {
    const r = rng(seed);
    const ol = new Outlines(seed, range(r, 0.1, 0.14));
    const aspect = range(r, 1.5, 2.4);
    const T = W * range(r, 0.12, 0.2);
    const shape = ellipse(aspect);
    const id = idBase(seed);
    const yTop = 0.4, yBot = yTop - T;
    const ym = yBot + T * range(r, 0.45, 0.6);
    const beds: Bed[] = [
      plate(r, ol, id, yBot, ym, W * 0.9, W, range(r, 0.25, 0.4), T, shape, range(r, 0.1, 0.2)),
      plate(r, ol, id + 1, ym, yTop, W * range(r, 0.86, 0.95), W * range(r, 0.82, 0.92), range(r, 0.3, 0.45), T, shape),
    ];
    waves(beds, ol, 0.1, 0.25);
    const kit = new MeshKit();
    const pts = profile(beds, lod, { bottom: T * 0.05 });
    pts.push(...top(pts, lod, T * 0.02, T * 0.03, ol.noise, seed));
    const n0 = steps0(2 * Math.PI * W, 0.5, 48, 128, profile(beds, LODS[0]).length + 4, BUDGET * 0.4);
    revolve(kit, pts, { n: stepsAt(n0, lod), phase: (seed % 17) * 0.37, ground: yBot });
    return { kit, posts: [], tops: [{ x: 0, z: 0, r: (W / aspect) * 0.85, y: yTop }], height: yTop, radius: reachOf(beds) };
  });
}
