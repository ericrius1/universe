// The crystal caverns under the citadel, built into the Haven's part (haven.ts calls buildCaverns last, so the surface
// over them is laid first) in their own frame (caverns/plan.ts: along the tunnel, the halls under the temple): the gate
// at the back of its alcove in the plateau's south-south-west skin on the ring road, the tunnel stepping down its long
// gallery under the plateau, the colonnade, the crystal hall with its glowing waterfall and pool, the grotto and the
// shrine, and the ways between them. A buried temple of dark teal stone blocks: walls of recessed panels between
// square pillars under heavy lintels, beamed ceilings, paving; lit only by its crystals (caverns/crystals.ts: their
// lamps 'under', lit day and night) and the green water. Every room is a collider of its own (a storey, so no flight
// in it and the camera kept under its ceiling), its walls solid boxes (the bake's occluders too: no crystal lights the
// next room through a wall). Plan and heights from caverns/plan.ts.
import type { ArchBuilder } from '../arch/builder';
import { MAT, type LightSpot, type Mat, type V3 } from '../arch/types';
import { Frame, type Haul } from '../haven/colliders';
import { rng } from '../haven/plan';
import type { Shapes } from '../haven/shapes';
import { lantern } from '../haven/terraces';
import type { V2 } from '../world/layout';
import { crystalCluster, type Cluster } from './crystals';
import {
  COLONNADE, FALL, GROTTO, HALL, HF, PORTAL, POOL, SHRINE, STAIR, TH, TOP, U0, WALL_T, WAYS, Y, at as worldAt,
  treadY as treadAt, type Rect, type Room, type Way,
} from './plan';
import { PAR } from '../haven/dwellings';
import { SKIN, TOP as PLATEAU_TOP } from '../haven/plan';

/** inside the caverns' frame (buildCaverns sets it: plan u along local x, v along local z, heights the world's): plan
 *  (u, v) -> local (x, z), and with a height over the datum a local point */
const at = (u: number, v: number): V2 => [u, v];
const P = (u: number, dy: number, v: number): V3 => [u, Y(dy), v];
/** a planar polygon of local points facing the side of `want` (local), its uv measured from `uvo` (Shapes.face's, with
 *  the uv's origin) */
function face(c: Ctx, pts: V3[], mat: Mat, want: V3, uvo?: V3) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], q = pts[(i + 1) % pts.length];
    nx += (a[1] - q[1]) * (a[2] + q[2]); ny += (a[2] - q[2]) * (a[0] + q[0]); nz += (a[0] - q[0]) * (a[1] + q[1]);
  }
  const w = nx * want[0] + ny * want[1] + nz * want[2] < 0 ? [...pts].reverse() : pts;
  c.b.polyW(w.map((p) => c.b.xf(p)), mat, uvo && c.b.xf(uvo));
}
/** a collider in the caverns' plan (its x along u, its y along v, heights the world's) */
const frame = (name: string) => new Frame(name, ...worldAt(0, 0), TH);
const E: V3 = [1, 0, 0], Wd: V3 = [-1, 0, 0], S: V3 = [0, 0, 1], N: V3 = [0, 0, -1], UP: V3 = [0, 1, 0], DOWN: V3 = [0, -1, 0];

/** the crystals' light (linear): a cool emerald-mint */
const GREEN: V3 = [0.3, 1.0, 0.6];

type Side = 'n' | 's' | 'w' | 'e';
/** an opening in a wall: from a to b along it (m from its start), up to y (over the mesa's top) */
interface Opening { a: number; b: number; y: number }

/** what the builders of the rooms share: the builder, the haul, the collider being filled */
interface Ctx { s: Shapes; b: ArchBuilder; haul: Haul }

export function buildCaverns(s: Shapes, haul: Haul) {
  const c: Ctx = { s, b: s.b, haul };
  // (the builder's frame the plan's: local +x along u, +z along v)
  const [ox, oz] = worldAt(0, 0);
  s.b.push().at(ox, 0, oz, -TH);
  gate(c);
  tunnel(c);
  colonnade(c);
  hall(c);
  grotto(c);
  shrine(c);
  for (const w of WAYS) way(c, w);
  s.b.pop();
}

// ---------------------------------------------------------------- lights, crystals
function light(c: Ctx, p: V3, candela: number, radius = 12, color: V3 = GREEN) {
  c.haul.lights.push({ p: c.b.xf(p), color, candela, when: 'under', radius } satisfies LightSpot);
}
/** a cluster grown from a plan point at a height, its light (none at candela 0); a post to walk round when it's big */
function cluster(c: Ctx, F: Frame | null, u: number, dy: number, v: number, o: Cluster, candela: number, radius = 12) {
  // (grown in the world: its root and its axis turned out of the plan, its light handed back the world's)
  const lp = crystalCluster(c.b, c.b.xf(P(u, dy, v)), { ...o, ...(o.axis ? { axis: c.b.xd(o.axis) } : {}) });
  if (candela > 0) c.haul.lights.push({ p: lp, color: GREEN, candela, when: 'under', radius } satisfies LightSpot);
  const up = (o.axis ?? [0, 1, 0])[1] > 0.6;
  if (F && up && o.size > 1.1) { const h = o.size * 0.22; F.solid(u - h, v - h, u + h, v + h, Y(dy), Y(dy + o.size * 0.8)); }
}

// ---------------------------------------------------------------- walls
/** a wall's frame: where it starts (plan), the yaw that runs its local x along it and its local z into the room, its
 *  length; and a plan point's distance along it */
function wallFrame(r: Rect, side: Side) {
  switch (side) {
    case 'n': return { u: r.u0, v: r.v0, yaw: 0, L: r.u1 - r.u0, along: (u: number, _v: number) => u - r.u0 };
    case 's': return { u: r.u1, v: r.v1, yaw: Math.PI, L: r.u1 - r.u0, along: (u: number, _v: number) => r.u1 - u };
    case 'w': return { u: r.u0, v: r.v1, yaw: Math.PI / 2, L: r.v1 - r.v0, along: (_u: number, v: number) => r.v1 - v };
    case 'e': return { u: r.u1, v: r.v0, yaw: -Math.PI / 2, L: r.v1 - r.v0, along: (_u: number, v: number) => v - r.v0 };
  }
}
/** an opening in a wall from a plan span (across its width: two u for 'n'/'s', two v for 'w'/'e') */
function open(r: Rect, side: Side, p0: number, p1: number, y: number): Opening {
  const f = wallFrame(r, side);
  const ends = side === 'n' || side === 's' ? [f.along(p0, 0), f.along(p1, 0)] : [f.along(0, p0), f.along(0, p1)];
  return { a: Math.min(...ends), b: Math.max(...ends), y };
}
/** the spans of a length not in any opening (or in one lower than y, when given) */
function spans(L: number, ops: Opening[], above?: number): [number, number][] {
  const cut = ops.filter((o) => above === undefined || o.y > above).sort((p, q) => p.a - q.a);
  const out: [number, number][] = [];
  let x = 0;
  for (const o of cut) { if (o.a > x + 1e-3) out.push([x, o.a]); x = Math.max(x, o.b); }
  if (x < L - 1e-3) out.push([x, L]);
  return out;
}

interface WallStyle {
  /** the lintel's foot over the floor (m); the bay (m between pillars) */
  lintel: number;
  bay: number;
  /** raw rock (the grotto): no pillars, panels or lintel */
  raw?: boolean;
}

/** one wall of a room, its face toward the room: the stone face from below the floor to the ceiling round its
 *  openings; on it a plinth, square pillars at each bay under a heavy lintel, a raised frame round each bay's recessed
 *  panel, pilasters over the pillars up to a cornice under the ceiling, a lintel block over each opening. Its body
 *  behind (WALL_T) and its pillars are solid in F */
function wall(c: Ctx, F: Frame, room: Room, side: Side, ops: Opening[], st: WallStyle) {
  const b = c.b, f = wallFrame(room, side), L = f.L;
  const fl = Y(room.floor), ce = Y(room.ceil), LY = fl + st.lintel;
  const [wx, wz] = at(f.u, f.v);
  b.push().at(wx, 0, wz, f.yaw);
  const face = (x0: number, x1: number, y0: number, y1: number, mat: Mat) => {
    if (x1 - x0 > 1e-3 && y1 - y0 > 1e-3) b.quad([x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0], mat);
  };
  const proud = (x0: number, x1: number, y0: number, y1: number, d: number, mat: Mat) => {
    if (x1 - x0 > 1e-3 && y1 - y0 > 1e-3) b.box(x0, y0, 0, x1, y1, d, mat, { skip: ['n'] });
  };
  const back = st.raw ? MAT.CAVE_ROCK : MAT.CAVE;
  // the face, round the openings (over each, from its head up)
  for (const [x0, x1] of spans(L, ops)) face(x0, x1, fl - 0.4, ce + 0.3, back);
  for (const o of ops) face(o.a, o.b, Y(o.y), ce + 0.3, back);
  if (!st.raw) {
    const trim = MAT.CAVE_TRIM;
    for (const [x0, x1] of spans(L, ops)) proud(x0, x1, fl - 0.1, fl + 0.7, 0.35, trim);
    // the pillars: one at each bay's edge, none in an opening, one each side of every opening
    const nb = Math.max(1, Math.round(L / st.bay)), xs: number[] = [];
    const clear = (x: number) => ops.every((o) => x + 1.1 < o.a || x - 1.1 > o.b);
    for (let k = 0; k <= nb; k++) { const x = (k * L) / nb; if (clear(x)) xs.push(x); }
    for (const o of ops) for (const x of [o.a - 0.95, o.b + 0.95]) if (x > 0.5 && x < L - 0.5 && xs.every((q) => Math.abs(q - x) > 2.2)) xs.push(x);
    xs.sort((p, q) => p - q);
    for (const x of xs) {
      const x0 = Math.max(0, x - 0.8), x1 = Math.min(L, x + 0.8);
      proud(Math.max(0, x - 0.95), Math.min(L, x + 0.95), fl - 0.1, fl + 1.0, 1.1, trim);
      proud(x0, x1, fl + 1.0, LY - 0.7, 0.9, trim);
      proud(Math.max(0, x - 0.95), Math.min(L, x + 0.95), LY - 0.7, LY, 1.1, trim);
      if (ce - LY > 4) proud(Math.max(0, x - 0.6), Math.min(L, x + 0.6), LY + 1.6, ce - 0.9, 0.45, trim);
      F.solid(...wallBox(room, side, x0, x1, 0, 0.95), fl, LY);
    }
    // the lintel, broken only by an opening taller than it
    for (const [x0, x1] of spans(L, ops, LY)) proud(x0, x1, LY, LY + 1.6, 0.8, trim);
    if (ce - LY > 3) for (const [x0, x1] of spans(L, ops, ce - 1)) proud(x0, x1, ce - 0.9, ce, 0.7, trim);
    // each bay's panel: a raised frame round the recess, below the lintel
    for (let k = 0; k + 1 < xs.length; k++) {
      const a = xs[k] + 1.35, z = xs[k + 1] - 1.35;
      if (z - a < 1.2 || !ops.every((o) => z < o.a || a > o.b)) continue;
      const y0 = fl + 1.45, y1 = LY - 1.15;
      proud(a, z, y0, y0 + 0.3, 0.18, trim);
      proud(a, z, y1 - 0.3, y1, 0.18, trim);
      proud(a, a + 0.3, y0 + 0.3, y1 - 0.3, 0.18, trim);
      proud(z - 0.3, z, y0 + 0.3, y1 - 0.3, 0.18, trim);
    }
    // a heavy block over each opening lower than the lintel
    for (const o of ops) if (Y(o.y) + 1.1 <= LY) proud(Math.max(0, o.a - 1.0), Math.min(L, o.b + 1.0), Y(o.y), Y(o.y) + 1.1, 0.9, trim);
  }
  b.pop();
  // the wall's body (and its plinth's reach), solid round the openings
  for (const [x0, x1] of spans(L, ops)) F.solid(...wallBox(room, side, x0, x1, -WALL_T, st.raw ? 0.2 : 0.4), fl - 1, ce + 1);
  for (const o of ops) F.solid(...wallBox(room, side, o.a, o.b, -WALL_T, 0), Y(o.y), ce + 1);
}
/** a box against a wall in plan (the room's frame: u, v): from x0 to x1 along it, from z0 to z1 out from its face
 *  (negative: into the rock behind it) */
function wallBox(r: Rect, side: Side, x0: number, x1: number, z0: number, z1: number): [number, number, number, number] {
  switch (side) {
    case 'n': return [r.u0 + x0, r.v0 + z0, r.u0 + x1, r.v0 + z1];
    case 's': return [r.u1 - x1, r.v1 - z1, r.u1 - x0, r.v1 - z0];
    case 'w': return [r.u0 + z0, r.v1 - x1, r.u0 + z1, r.v1 - x0];
    case 'e': return [r.u1 - z1, r.v0 + x0, r.u1 - z0, r.v0 + x1];
  }
}

/** a room's ceiling (beams across its short way at each bay) and floor (round any holes: rects in plan), its frame */
function shell(c: Ctx, room: Room, o: { bay: number; holes?: Rect[]; floorMat?: Mat; ceilMat?: Mat; beams?: boolean }): Frame {
  const b = c.b, fl = Y(room.floor), ce = Y(room.ceil);
  const F = frame(`caverns.${room.name}`);
  const rect = (r: Rect, y: number, mat: Mat, down: boolean) => {
    const pts: V2[] = [at(r.u0, r.v0), at(r.u1, r.v0), at(r.u1, r.v1), at(r.u0, r.v1)];
    b.slab(pts, y, mat, down);
  };
  rect(room, ce, o.ceilMat ?? MAT.CAVE, true);
  for (const r of cutRect(room, o.holes ?? [])) { rect(r, fl, o.floorMat ?? MAT.CAVE_FLOOR, false); F.floor(r.u0, r.v0, r.u1, r.v1, fl, false); }
  if (o.beams !== false) {
    const alongU = room.u1 - room.u0 >= room.v1 - room.v0;
    const L = alongU ? room.u1 - room.u0 : room.v1 - room.v0, n = Math.max(1, Math.round(L / o.bay));
    for (let k = 1; k < n; k++) {
      const t = (k * L) / n;
      const r: Rect = alongU ? { u0: room.u0 + t - 0.6, u1: room.u0 + t + 0.6, v0: room.v0, v1: room.v1 } : { u0: room.u0, u1: room.u1, v0: room.v0 + t - 0.6, v1: room.v0 + t + 0.6 };
      ubox(c, r, ce - 1.1, ce + 0.05, MAT.CAVE_TRIM, { skip: ['top'] });
    }
  }
  // (its ceiling solid for the camera and for the bake: nothing lights the room above through it)
  F.solid(room.u0 - WALL_T, room.v0 - WALL_T, room.u1 + WALL_T, room.v1 + WALL_T, ce, ce + 2);
  return F;
}
/** a rect less some holes, as rects (the holes cut across the whole of one axis's bands) */
function cutRect(r: Rect, holes: Rect[]): Rect[] {
  let out: Rect[] = [r];
  for (const h of holes) {
    const next: Rect[] = [];
    for (const q of out) {
      if (h.u1 <= q.u0 || h.u0 >= q.u1 || h.v1 <= q.v0 || h.v0 >= q.v1) { next.push(q); continue; }
      if (h.v0 > q.v0) next.push({ ...q, v1: h.v0 });
      if (h.v1 < q.v1) next.push({ ...q, v0: h.v1 });
      const v0 = Math.max(q.v0, h.v0), v1 = Math.min(q.v1, h.v1);
      if (h.u0 > q.u0) next.push({ u0: q.u0, u1: h.u0, v0, v1 });
      if (h.u1 < q.u1) next.push({ u0: h.u1, u1: q.u1, v0, v1 });
    }
    out = next;
  }
  return out;
}
/** an axis-aligned box in plan (u, v) between two world heights */
function ubox(c: Ctx, r: Rect, y0: number, y1: number, mat: Mat, o: { skip?: string[]; top?: Mat } = {}) {
  const [x0, z0] = at(r.u0, r.v0), [x1, z1] = at(r.u1, r.v1);
  c.b.box(x0, y0, z0, x1, y1, z1, mat, o);
}
/** a free-standing square pillar (base, shaft, capital) from a floor to a height, solid in F */
function pillar(c: Ctx, F: Frame, u: number, v: number, half: number, fl: number, top: number) {
  const r = (h: number): Rect => ({ u0: u - h, u1: u + h, v0: v - h, v1: v + h });
  ubox(c, r(half + 0.3), fl - 0.1, fl + 1.1, MAT.CAVE_TRIM, { skip: ['bottom'] });
  ubox(c, r(half), fl + 1.1, top - 0.9, MAT.CAVE_TRIM, { skip: ['bottom', 'top'] });
  ubox(c, r(half + 0.3), top - 0.9, top, MAT.CAVE_TRIM, { skip: ['top'] });
  F.solid(u - half - 0.3, v - half - 0.3, u + half + 0.3, v + half + 0.3, fl, top);
}

// ---------------------------------------------------------------- the gate in its alcove
/** the gate at the back of its alcove in the plateau's skin: the alcove's floor out to the ring road, its side walls of
 *  the rock stepping down with the skin (the plateau's top, the ledge path, the ring road), the gate's front from the
 *  floor to the plateau's top: a cream ashlar face between teal-banded pilasters, a pointed arch in a gold-edged frame
 *  over the tunnel's mouth, a teal tympanum with a gold diamond, crystals in niches either side, lamps in the alcove */
function gate(c: Ctx) {
  const { b, s } = c;
  const G = PORTAL, fl = Y(G.floor), hw = G.half, wt = WALL_T, u0 = U0 - hw, u1 = U0 + hw;
  const S = STAIR, top = PLATEAU_TOP + PAR, ledge = SKIN.ledge + 1.0;
  const F = frame('caverns.gate');
  // the floor (to the ring road's edge: the ring's outline a vertex on the axis, chords either side)
  const edge = (u: number) => G.mouth + Math.abs(u - U0) * Math.tan((3.25 * Math.PI) / 180);
  b.slab([at(u0 + wt, G.face), at(u1 - wt, G.face), at(u1 - wt, edge(u1 - wt)), at(U0, G.mouth), at(u0 + wt, edge(u0 + wt))], fl, MAT.PAVING);
  F.floor(u0 + wt, G.mouth, u1 - wt, G.face, fl);
  // (and on through the gate's depth, its threshold, to the tunnel's floor)
  b.slab([at(S.u0, G.face), at(S.u1, G.face), at(S.u1, G.back), at(S.u0, G.back)], fl, MAT.CAVE_FLOOR);
  F.floor(S.u0, G.face - 0.5, S.u1, G.back + 0.5, fl);
  // the side walls: by the plateau's top, by the ledge path, a low wall out to the ring road
  const steps: [number, number, number][] = [[G.face, -SKIN.upper, top], [-SKIN.upper, -SKIN.lower, ledge], [-SKIN.lower, G.mouth + 0.6, fl + 0.9]];
  for (const sg of [-1, 1]) {
    const ui = sg < 0 ? u0 + wt : u1 - wt, uo = sg < 0 ? u0 : u1;
    for (const [va, vb, y] of steps) {
      ubox(c, { u0: Math.min(ui, uo), u1: Math.max(ui, uo), v0: vb, v1: va }, fl - 0.6, y - 0.14, MAT.ROCK, { skip: ['bottom', 'top'] });
      ubox(c, { u0: Math.min(ui, uo), u1: Math.max(ui, uo), v0: vb, v1: va }, y - 0.14, y, MAT.CREAM, { skip: ['bottom'] });
      F.solid(Math.min(ui, uo), vb, Math.max(ui, uo), va, fl - 1, y);
    }
  }
  // the gate's body: its front over the tunnel's mouth (an arch's opening), its top under a cornice at the plateau's
  // parapets' height
  const mo = S.u1 - S.u0, spring = fl + 5.0, crown = spring + mo / 2 * 1.15;
  const arch = (k: number, w: number): V3[] => Array.from({ length: k + 1 }, (_, i) => {
    const t = i / k, a = Math.PI * t, x = Math.cos(a) * w, y = Math.sin(a) * (crown - spring) * (w / (mo / 2));
    // (a tall round head: a half ellipse)
    return P(U0 + x, y + spring - TOP, G.face);
  });
  // (each half of the face round its half of the arch, from the jamb's foot up the curve to the crown)
  const curve = arch(16, mo / 2);
  b.with({ tint: [1.02, 0.98, 0.94] }, () => {
    face(c, [P(u0 + wt, G.floor - 0.6, G.face), P(S.u0, G.floor - 0.6, G.face), ...curve.slice(8).reverse(), P(U0, top - 0.6 - TOP, G.face), P(u0 + wt, top - 0.6 - TOP, G.face)], MAT.ASHLAR, [0, 0, -1]);
    face(c, [P(S.u1, G.floor - 0.6, G.face), P(u1 - wt, G.floor - 0.6, G.face), P(u1 - wt, top - 0.6 - TOP, G.face), P(U0, top - 0.6 - TOP, G.face), ...curve.slice(0, 9).reverse()], MAT.ASHLAR, [0, 0, -1]);
  });
  // the reveal through the gate's depth and its soffit (the tunnel's own walls go on behind)
  for (const [u, sg] of [[S.u0, 1], [S.u1, -1]] as [number, number][]) face(c, [P(u, G.floor - 0.6, G.face), P(u, G.floor - 0.6, G.back), P(u, spring - TOP, G.back), P(u, spring - TOP, G.face)], MAT.CAVE_TRIM, [sg, 0, 0]);
  const ring = arch(16, mo / 2);
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], q = ring[i + 1], back = (p: V3): V3 => [p[0], p[1], G.back];
    face(c, [a, q, back(q), back(a)], MAT.CAVE_TRIM, [U0 - (a[0] + q[0]) / 2, spring - (a[1] + q[1]) / 2, 0]);
  }
  // the frame round the arch: cream jambs, a gold edge, a teal tympanum panel over it with a gold diamond
  const fr = 0.12;
  ubox(c, { u0: S.u0 - 1.0, u1: S.u0, v0: G.face - 0.4, v1: G.face }, fl, spring + 0.4, MAT.CREAM, { skip: ['bottom', 's'] });
  ubox(c, { u0: S.u1, u1: S.u1 + 1.0, v0: G.face - 0.4, v1: G.face }, fl, spring + 0.4, MAT.CREAM, { skip: ['bottom', 's'] });
  b.with({ glow: 0.0 }, () => {
    const tp = (u: number, y: number): V3 => P(u, y - TOP, G.face - fr);
    face(c, [tp(U0 - mo / 2 - 1.0, crown + 0.5), tp(U0 + mo / 2 + 1.0, crown + 0.5), tp(U0 + mo / 2 + 1.0, crown + 4.5), tp(U0 - mo / 2 - 1.0, crown + 4.5)], MAT.TEAL, [0, 0, -1]);
    const d = (u: number, y: number, k: number): V3 => P(u, y - TOP, G.face - fr - k);
    const dc = crown + 2.5;
    face(c, [d(U0, dc - 1.4, 0.02), d(U0 + 1.0, dc, 0.02), d(U0, dc + 1.4, 0.02), d(U0 - 1.0, dc, 0.02)], MAT.GOLD, [0, 0, -1]);
  });
  // pilasters at the gate's edges, banded teal, a cornice along its top
  for (const u of [u0 + wt + 0.8, u1 - wt - 0.8]) {
    ubox(c, { u0: u - 0.8, u1: u + 0.8, v0: G.face - 0.5, v1: G.face }, fl, top - 1.2, MAT.CREAM, { skip: ['bottom', 's'] });
    for (let y = fl + 4; y < top - 3; y += 6) ubox(c, { u0: u - 0.85, u1: u + 0.85, v0: G.face - 0.55, v1: G.face }, y, y + 0.5, MAT.TEAL, { skip: ['s'] });
  }
  ubox(c, { u0: u0 + wt, u1: u1 - wt, v0: G.face - 0.7, v1: G.face }, top - 1.2, top - 0.6, MAT.CREAM, { skip: ['s'] });
  ubox(c, { u0: u0 + wt - 0.1, u1: u1 - wt + 0.1, v0: G.face - 0.4, v1: G.back }, top - 0.6, top, MAT.CREAM, { skip: ['bottom'] });
  F.solid(u0 + wt, G.face, S.u0, G.back, fl - 1, top).solid(S.u1, G.face, u1 - wt, G.back, fl - 1, top).solid(S.u0, G.face, S.u1, G.back, spring, top);
  // crystals at the pilasters' feet either side of the arch, the green light from the tunnel's mouth, two lamp posts
  for (const sg of [-1, 1]) {
    const u = U0 + sg * (hw - wt - 0.8);
    cluster(c, F, u, G.floor, G.face - 1.6, { size: 1.6, seed: 500 + sg, hue: 0.6 + 0.1 * sg, count: 6, spread: 0.3 }, 120, 10);
    const lp = at(U0 + sg * (hw - wt - 0.8), G.face - 6);
    b.place('lantern-post', [lp[0], fl, lp[1]], { yaw: Math.PI, scale: 1.25 });
  }
  light(c, P(U0, G.floor + 3.0, G.face + 3), 160, 14);
  c.haul.colliders.push(F.done());
}

// ---------------------------------------------------------------- the tunnel
/** the tunnel in from the gate to the colonnade's door: a gallery of teal stone stepping down in its flights, its
 *  ceiling over each level (stepping down at each flight's foot), beams across it on pilasters, a crystal on a corbel
 *  every few bays, either side in turn */
function tunnel(c: Ctx) {
  const { b } = c, S = STAIR, w = S.u1 - S.u0, v0 = PORTAL.back, v1 = S.foot;
  const F = frame('caverns.tunnel');
  // the stretches: level, or a flight (from v0 to v1, the floor from y0 to y1)
  type Stretch = { v0: number; v1: number; y0: number; y1: number; flight: boolean };
  const st: Stretch[] = [];
  let v = v0;
  for (const f of S.flights) {
    st.push({ v0: v, v1: f.v0, y0: f.y0, y1: f.y0, flight: false });
    st.push({ v0: f.v0, v1: f.v1, y0: f.y0, y1: f.y1, flight: true });
    v = f.v1;
  }
  st.push({ v0: v, v1, y0: HF, y1: HF, flight: false });
  const ceilOf = (k: number) => st[k].y0 + S.ceil;
  for (const [k, q] of st.entries()) {
    const ce = Y(ceilOf(k));
    if (q.flight) {
      const n = Math.round((q.y0 - q.y1) / 0.16);
      const [xb, zb] = at(U0, q.v1), [xt, zt] = at(U0, q.v0);
      b.stairs(xb, Y(q.y1), zb, xt, Y(q.y0), zt, w, n, MAT.CAVE_FLOOR, { side: MAT.CAVE_FLOOR, foot: Y(q.y1) - 0.5 });
      F.stair(S.u0, q.v0, S.u1, q.v1, Y(q.y1), q.y0 - q.y1, 1, -1);
    } else {
      b.slab([at(S.u0, q.v0), at(S.u1, q.v0), at(S.u1, q.v1), at(S.u0, q.v1)], Y(q.y0), MAT.CAVE_FLOOR);
      F.floor(S.u0, q.v0, S.u1, q.v1, Y(q.y0), false);
      // a runner of paler stone down the middle
      ubox(c, { u0: U0 - 1.6, u1: U0 + 1.6, v0: q.v0 + 0.4, v1: q.v1 - 0.4 }, Y(q.y0), Y(q.y0) + 0.03, MAT.CAVE_TRIM, { skip: ['bottom'] });
    }
    // the walls, from under the floor to the ceiling, either side
    const lo = Math.min(q.y0, q.y1) - 0.8;
    face(c, [P(S.u0, lo, q.v1), P(S.u0, lo, q.v0), P(S.u0, ceilOf(k) + 0.05, q.v0), P(S.u0, ceilOf(k) + 0.05, q.v1)], MAT.CAVE, E);
    face(c, [P(S.u1, lo, q.v0), P(S.u1, lo, q.v1), P(S.u1, ceilOf(k) + 0.05, q.v1), P(S.u1, ceilOf(k) + 0.05, q.v0)], MAT.CAVE, Wd);
    // the ceiling, and where it steps down past a flight, the step
    b.slab([at(S.u0, q.v0), at(S.u1, q.v0), at(S.u1, q.v1), at(S.u0, q.v1)], ce, MAT.CAVE, true);
    if (k + 1 < st.length && ceilOf(k + 1) < ceilOf(k) - 0.05) face(c, [P(S.u0, ceilOf(k + 1), q.v1), P(S.u1, ceilOf(k + 1), q.v1), P(S.u1, ceilOf(k), q.v1), P(S.u0, ceilOf(k), q.v1)], MAT.CAVE, N);
    F.solid(S.u0 - WALL_T, q.v0, S.u0, q.v1, Y(lo) - 1, ce + 0.5).solid(S.u1, q.v0, S.u1 + WALL_T, q.v1, Y(lo) - 1, ce + 0.5);
    F.solid(S.u0 - WALL_T, q.v0, S.u1 + WALL_T, q.v1, ce, ce + 1.5);
    // beams across on pilasters, every few metres (the level stretches')
    if (!q.flight) for (let bv = q.v0 + 4.25; bv < q.v1 - 1; bv += 4.25) {
      ubox(c, { u0: S.u0, u1: S.u1, v0: bv - 0.5, v1: bv + 0.5 }, ce - 0.9, ce + 0.02, MAT.CAVE_TRIM, { skip: ['top', 'w', 'e'] });
      for (const u of [S.u0, S.u1 - 0.5]) ubox(c, { u0: u, u1: u + 0.5, v0: bv - 0.5, v1: bv + 0.5 }, Y(q.y0) - 0.1, ce - 0.88, MAT.CAVE_TRIM, { skip: ['bottom', 'top', u === S.u0 ? 'w' : 'e'] });
    }
  }
  // the gallery's far end over the colonnade's door
  face(c, [P(S.u0, HF + 8.3, v1), P(S.u1, HF + 8.3, v1), P(S.u1, HF + S.ceil + 0.05, v1), P(S.u0, HF + S.ceil + 0.05, v1)], MAT.CAVE, N);
  // the crystals on their corbels, either side in turn, every five bays or so
  let i = 0;
  for (let cv = v0 + 9; cv < v1 - 6; cv += 21, i++) {
    if (st.some((q) => q.flight && cv > q.v0 - 2 && cv < q.v1 + 2)) continue;
    const sg = i % 2 ? 1 : -1, u = sg < 0 ? S.u0 : S.u1, y = treadAt(cv) + 2.6, out = sg < 0 ? 1 : -1;
    ubox(c, { u0: Math.min(u, u + out * 0.7), u1: Math.max(u, u + out * 0.7), v0: cv - 0.45, v1: cv + 0.45 }, Y(y) - 0.35, Y(y), MAT.CAVE_TRIM, { skip: [sg < 0 ? 'w' : 'e'] });
    cluster(c, null, u + out * 0.35, y, cv, { size: 1.0 + (i % 3) * 0.2, axis: [out * 0.45, 1, 0], seed: 60 + i, hue: 0.4 + 0.15 * (i % 3), count: 6 }, 90, 11);
  }
  const sc = F.done();
  sc.levels = Object.fromEntries(st.filter((q) => !q.flight).map((q, k) => [`gallery${k}`, { height: Y(q.y0), ceiling: S.ceil }]));
  c.haul.colliders.push(sc);
}

// ---------------------------------------------------------------- the colonnade
function colonnade(c: Ctx) {
  const R = COLONNADE, fl = Y(R.floor), ce = Y(R.ceil);
  const F = shell(c, R, { bay: 4.3, beams: false });
  const st: WallStyle = { lintel: 8.4, bay: 4.3 };
  const foot = WAYS[0], door = WAYS[1];
  wall(c, F, R, 'n', [open(R, 'n', foot.u0, foot.u1, foot.head)], st);
  wall(c, F, R, 's', [open(R, 's', door.u0, door.u1, door.head)], st);
  wall(c, F, R, 'w', [], st);
  wall(c, F, R, 'e', [], st);
  // two rows of square pillars down its length under architraves, beams across between them
  const rows = [U0 - 5.5, U0 + 5.5], vs = [4.3, 8.6, 12.9, 17.2].map((d) => R.v0 + d);
  for (const u of rows) {
    for (const v of vs) pillar(c, F, u, v, 0.75, fl, fl + 9.2);
    ubox(c, { u0: u - 0.8, u1: u + 0.8, v0: R.v0, v1: R.v1 }, fl + 9.2, ce + 0.02, MAT.CAVE_TRIM, { skip: ['top'] });
  }
  for (const v of vs) ubox(c, { u0: R.u0, u1: R.u1, v0: v - 0.5, v1: v + 0.5 }, ce - 1.0, ce + 0.02, MAT.CAVE_TRIM, { skip: ['top'] });
  // a runner of paler stone down the nave
  ubox(c, { u0: U0 - 2.2, u1: U0 + 2.2, v0: R.v0 + 0.4, v1: R.v1 - 0.4 }, fl, fl + 0.04, MAT.CAVE_TRIM, { skip: ['bottom'] });
  // crystals in the aisles, either side of the hall's door
  const cl: [number, number, number, number][] = [[R.u0 + 2.2, -50.2, 1.6, 140], [R.u1 - 2.2, -46.0, 1.8, 140], [R.u0 + 2.0, -41.8, 2.0, 150], [R.u1 - 2.4, -37.6, 1.5, 130], [door.u0 - 2.6, R.v1 - 1.8, 2.2, 170], [door.u1 + 2.6, R.v1 - 1.8, 2.0, 170]];
  cl.forEach(([u, v, size, cd], i) => cluster(c, F, u, R.floor, v, { size, seed: 100 + i, hue: 0.3 + ((0.12 * i) % 0.6), spread: 0.35 }, cd, 12));
  c.haul.colliders.push(room(F, R));
}

/** a room's collider: its floors a storey under its ceiling */
function room(F: Frame, R: Room) {
  const sc = F.done();
  sc.levels = { floor: { height: Y(R.floor), ceiling: R.ceil - R.floor } };
  return sc;
}

// ---------------------------------------------------------------- the crystal hall
function hall(c: Ctx) {
  const R = HALL, fl = Y(R.floor), ce = Y(R.ceil);
  const pool: Rect = { u0: POOL.u0, u1: POOL.u1, v0: POOL.v0, v1: POOL.v1 };
  const F = shell(c, R, { bay: 6, holes: [pool], beams: false });
  const st: WallStyle = { lintel: 9.5, bay: 6 };
  const door = WAYS[1], gw = WAYS[2], sw = WAYS[3];
  wall(c, F, R, 'n', [open(R, 'n', door.u0, door.u1, door.head)], st);
  wall(c, F, R, 'w', [open(R, 'w', gw.v0, gw.v1, gw.head)], st);
  wall(c, F, R, 'e', [open(R, 'e', sw.v0, sw.v1, sw.head)], st);
  wall(c, F, R, 's', [open(R, 's', FALL.u0, FALL.u1, FALL.lip + 1.0)], st);
  // four great pillars under a frame of lintels, the ceiling's beams on them
  const pu = [11, 29], pvs = [-20.5, -7.5];
  for (const u of pu) for (const v of pvs) pillar(c, F, u, v, 1.2, fl, fl + 12.8);
  for (const u of pu) ubox(c, { u0: u - 1.3, u1: u + 1.3, v0: R.v0, v1: R.v1 }, fl + 12.8, ce + 0.02, MAT.CAVE_TRIM, { skip: ['top'] });
  for (const v of pvs) ubox(c, { u0: R.u0, u1: R.u1, v0: v - 1.3, v1: v + 1.3 }, fl + 12.8, ce + 0.02, MAT.CAVE_TRIM, { skip: ['top'] });
  // the floor's inlay: a paler square round the middle, a cross to the doors
  for (const r of [{ u0: U0 - 7.5, u1: U0 + 7.5, v0: -21.5, v1: -20.9 }, { u0: U0 - 7.5, u1: U0 + 7.5, v0: -6.6, v1: -6.0 }, { u0: U0 - 7.5, u1: U0 - 6.9, v0: -21.5, v1: -6.0 }, { u0: U0 + 6.9, u1: U0 + 7.5, v0: -21.5, v1: -6.0 }, { u0: U0 - 1.6, u1: U0 + 1.6, v0: R.v0 + 0.4, v1: -21.5 }]) {
    ubox(c, r, fl, fl + 0.03, MAT.CAVE_TRIM, { skip: ['bottom'] });
  }
  waterfall(c, F);
  // crystals: great clusters in the corners and either side of the pool, a few out of the walls, two hanging from the
  // ceiling, small ones at the near pillars' feet
  const cl: { u: number; v: number; dy?: number; o: Partial<Cluster> & { size: number }; cd: number; r?: number }[] = [
    { u: R.u0 + 3.0, v: R.v0 + 3.0, o: { size: 5.0, giant: true }, cd: 300, r: 16 },
    { u: R.u1 - 3.0, v: R.v0 + 3.0, o: { size: 4.4, giant: true }, cd: 280, r: 16 },
    { u: R.u0 + 3.2, v: R.v1 - 3.4, o: { size: 5.6, giant: true }, cd: 320, r: 16 },
    { u: R.u1 - 3.2, v: R.v1 - 3.4, o: { size: 5.2, giant: true }, cd: 320, r: 16 },
    { u: POOL.u0 - 1.6, v: POOL.v1 - 1.6, o: { size: 3.4 }, cd: 0 },
    { u: POOL.u1 + 1.6, v: POOL.v1 - 1.6, o: { size: 3.6 }, cd: 0 },
    { u: R.u0 + 0.5, v: -20.6, dy: 3.6, o: { size: 2.8, axis: [1, 0.5, 0], spread: 0.4 }, cd: 170, r: 13 },
    { u: R.u1 - 0.5, v: -20.6, dy: 4.0, o: { size: 2.8, axis: [-1, 0.5, 0], spread: 0.4 }, cd: 170, r: 13 },
    { u: R.u0 + 0.5, v: -2.9, dy: 6.0, o: { size: 2.2, axis: [1, 0.3, 0.2], spread: 0.4 }, cd: 0 },
    { u: R.u1 - 0.5, v: -2.9, dy: 5.2, o: { size: 2.4, axis: [-1, 0.35, -0.1], spread: 0.4 }, cd: 0 },
    { u: 14.5, v: -14, dy: 15 - 0.05, o: { size: 3.2, axis: [0.15, -1, 0.1] }, cd: 170, r: 14 },
    { u: 25.5, v: -12, dy: 15 - 0.05, o: { size: 2.8, axis: [-0.1, -1, -0.15] }, cd: 150, r: 14 },
    { u: 11 + 2.0, v: -20.5 + 2.0, o: { size: 1.8 }, cd: 0 },
    { u: 29 - 2.0, v: -20.5 + 2.0, o: { size: 1.6 }, cd: 0 },
    { u: 11 + 2.0, v: -7.5 - 2.0, o: { size: 1.4 }, cd: 0 },
    { u: 29 - 2.0, v: -7.5 - 2.0, o: { size: 1.9 }, cd: 0 },
    { u: R.u0 + 9, v: R.v0 + 1.2, o: { size: 2.0, axis: [0.2, 1, 0.5] }, cd: 0 },
    { u: R.u1 - 9, v: R.v0 + 1.2, o: { size: 2.3, axis: [-0.2, 1, 0.5] }, cd: 0 },
  ];
  cl.forEach((k, i) => cluster(c, F, k.u, R.floor + (k.dy ?? 0), k.v, { seed: 200 + i, hue: 0.25 + ((i * 0.37) % 0.6), ...k.o }, k.cd, k.r));
  c.haul.colliders.push(room(F, R));
}

/** the waterfall: an alcove in the hall's south wall, its back wet rock, a dark slot high in it where the green water
 *  comes out, the sheet falling into the pool (sunk in the hall's floor, out into the alcove) with a crown of foam where
 *  it lands; the pool's coping round the hall's side; the light of the falling water */
function waterfall(c: Ctx, F: Frame) {
  const { b } = c, R = HALL, fl = Y(R.floor), A = FALL, top = Y(A.lip + 1.0);
  const water = Y(POOL.level), bottom = Y(POOL.floor);
  // the alcove: its two sides and back of wet rock, its ceiling, from the pool's floor up
  b.with({ tint: [0.8, 0.9, 0.9] }, () => {
    face(c, [P(A.u0, POOL.floor, R.v1), P(A.u0, POOL.floor, A.v1), P(A.u0, A.lip + 1.0, A.v1), P(A.u0, A.lip + 1.0, R.v1)], MAT.CAVE_ROCK, E);
    face(c, [P(A.u1, POOL.floor, A.v1), P(A.u1, POOL.floor, R.v1), P(A.u1, A.lip + 1.0, R.v1), P(A.u1, A.lip + 1.0, A.v1)], MAT.CAVE_ROCK, Wd);
    face(c, [P(A.u0, POOL.floor, A.v1), P(A.u1, POOL.floor, A.v1), P(A.u1, A.lip + 1.0, A.v1), P(A.u0, A.lip + 1.0, A.v1)], MAT.CAVE_ROCK, N);
  });
  ubox(c, { u0: A.u0, u1: A.u1, v0: R.v1, v1: A.v1 }, top, top + 0.4, MAT.CAVE_ROCK, { skip: ['top', 'n', 's', 'w', 'e'] });
  // ledges of rock stepping down the back either side of the fall
  const r = rng(808);
  for (let k = 0; k < 6; k++) {
    const sg = k % 2 ? 1 : -1, y = A.lip - 1.5 - k * 1.9 + r() * 0.6, w = 0.8 + r() * 0.9;
    const u = U0 + sg * (A.width / 2 + 0.4 + r() * 0.8);
    ubox(c, { u0: u - w, u1: u + w, v0: A.v1 - 0.7 - r() * 0.5, v1: A.v1 }, Y(y) - 0.5 - r() * 0.6, Y(y), MAT.CAVE_ROCK, { skip: ['s'] });
  }
  // the slot it pours from
  b.with({ ao: 0.2 }, () => face(c, [P(U0 - 2.1, A.lip, A.v1 - 0.02), P(U0 + 2.1, A.lip, A.v1 - 0.02), P(U0 + 2.1, A.lip + 0.9, A.v1 - 0.02), P(U0 - 2.1, A.lip + 0.9, A.v1 - 0.02)], MAT.INTERIOR, N));
  ubox(c, { u0: U0 - 2.3, u1: U0 + 2.3, v0: A.v1 - 0.9, v1: A.v1 }, Y(A.lip) - 0.25, Y(A.lip), MAT.CAVE_TRIM, { skip: ['s', 'top'] });
  // the sheet: one plane leaning out a little as it falls, spreading (its uv: metres across, and up from the pool)
  const half = A.width / 2 + 0.4, wb = half * 1.18, uvo = P(U0 - wb, POOL.level, A.v1 - 1.7);
  b.with({ glow: 0.9 }, () => {
    face(c, [P(U0 - wb, POOL.level, A.v1 - 1.7), P(U0 + wb, POOL.level, A.v1 - 1.7), P(U0 + half, A.lip, A.v1 - 0.85), P(U0 - half, A.lip, A.v1 - 0.85)], MAT.GLOWATER, N, uvo);
    // the crown of foam where it lands
    const [lx, lz] = at(U0, A.v1 - 1.7);
    b.lathe(lx, water - 0.05, lz, [[2.4, 0], [1.9, 0.45], [1.3, 0.75], [0.9, 0.6]], 14, MAT.GLOWATER);
  });
  // the pool: its basin's sides and floor, the water (uv: metres from where the fall lands, plus 12 so it stays whole),
  // the coping round it on the hall's side
  const pr: Rect = { u0: POOL.u0, u1: POOL.u1, v0: POOL.v0, v1: A.v1 };
  face(c, [P(pr.u0, POOL.floor, pr.v0), P(pr.u1, POOL.floor, pr.v0), P(pr.u1, R.floor, pr.v0), P(pr.u0, R.floor, pr.v0)], MAT.CAVE_TRIM, S);
  face(c, [P(pr.u0, POOL.floor, pr.v0), P(pr.u0, POOL.floor, R.v1), P(pr.u0, R.floor, R.v1), P(pr.u0, R.floor, pr.v0)], MAT.CAVE_TRIM, E);
  face(c, [P(pr.u1, POOL.floor, pr.v0), P(pr.u1, POOL.floor, R.v1), P(pr.u1, R.floor, R.v1), P(pr.u1, R.floor, pr.v0)], MAT.CAVE_TRIM, Wd);
  c.b.slab([at(pr.u0, pr.v0), at(pr.u1, pr.v0), at(pr.u1, pr.v1), at(pr.u0, pr.v1)], bottom, MAT.CAVE_ROCK);
  const [ix, iz] = at(U0, A.v1 - 1.7);
  const wo: V3 = [ix - 12, water, iz - 12];
  b.with({ glow: 0.85 }, () => {
    const q = (u: number, v: number): V3 => P(u, POOL.level, v);
    face(c, [q(pr.u0, pr.v1), q(pr.u1, pr.v1), q(pr.u1, pr.v0), q(pr.u0, pr.v0)], MAT.GLOWATER, UP, wo);
  });
  const cw = 0.7, ch = fl + 0.4;
  ubox(c, { u0: pr.u0 - cw, u1: pr.u1 + cw, v0: pr.v0 - cw, v1: pr.v0 }, fl - 0.05, ch, MAT.CAVE_TRIM, { skip: ['bottom'] });
  ubox(c, { u0: pr.u0 - cw, u1: pr.u0, v0: pr.v0, v1: R.v1 }, fl - 0.05, ch, MAT.CAVE_TRIM, { skip: ['bottom'] });
  ubox(c, { u0: pr.u1, u1: pr.u1 + cw, v0: pr.v0, v1: R.v1 }, fl - 0.05, ch, MAT.CAVE_TRIM, { skip: ['bottom'] });
  F.solid(pr.u0 - cw, pr.v0 - cw, pr.u1 + cw, pr.v0, fl - 0.05, ch + 0.3).solid(pr.u0 - cw, pr.v0, pr.u0, R.v1, fl - 0.05, ch + 0.3).solid(pr.u1, pr.v0, pr.u1 + cw, R.v1, fl - 0.05, ch + 0.3);
  // (jumped into, she stands on the water as on ice — the glow is opaque)
  F.floor(pr.u0, pr.v0, pr.u1, R.v1, water, false);
  // the light of the fall: at its lip, half way down, where it lands
  light(c, P(U0, A.lip - 0.6, A.v1 - 2.2), 220, 15);
  light(c, P(U0, A.lip - 6.5, A.v1 - 2.6), 240, 15);
  light(c, P(U0, POOL.level + 1.4, POOL.v0 + 3.5), 300, 16);
}

// ---------------------------------------------------------------- the grotto
function grotto(c: Ctx) {
  const R = GROTTO, fl = Y(R.floor);
  const F = shell(c, R, { bay: 6, floorMat: MAT.CAVE_ROCK, ceilMat: MAT.CAVE_ROCK, beams: false });
  const gw = WAYS[2];
  const st: WallStyle = { lintel: 0, bay: 0, raw: true };
  wall(c, F, R, 'n', [], st);
  wall(c, F, R, 's', [], st);
  wall(c, F, R, 'w', [], st);
  wall(c, F, R, 'e', [open(R, 'e', gw.v0, gw.v1, gw.head)], st);
  // the rock: outcrops along the walls, a few boulders, ledges up the ceiling
  const r = rng(909);
  const walls: [Side, number][] = [['n', R.u1 - R.u0], ['s', R.u1 - R.u0], ['w', R.v1 - R.v0], ['e', R.v1 - R.v0]];
  for (const [side, L] of walls) {
    // (each kept off its neighbours' faces: two overlapping outcrops' sides, fronts or tops a few millimetres apart
    // fought)
    const laid: [number, number, number, number][] = [];
    const near = (p: number, q: number) => Math.abs(p - q) < 0.04;
    for (let x = 0.8; x < L - 0.8; x += 2.2 + r() * 2.6) {
      if (side === 'e') { const v = R.v0 + x; if (v > gw.v0 - 1.4 && v < gw.v1 + 1.4) continue; }
      let w = 0.8 + r() * 1.6, d = 0.5 + r() * 1.6, h = 2 + r() * 7.5;
      for (const [a, b2, dd, hh] of laid) {
        if (x - w > b2 || x + w < a) continue;
        if ([a, b2].some((e) => near(x - w, e) || near(x + w, e))) w += 0.09;
        if (near(d, dd)) d += 0.09;
        if (near(h, hh)) h += 0.09;
      }
      laid.push([x - w, x + w, d, h]);
      const box = wallBox(R, side, x - w, x + w, 0, d);
      ubox(c, { u0: box[0], v0: box[1], u1: box[2], v1: box[3] }, fl - 0.2, Math.min(Y(R.ceil) + 0.02, fl + h), MAT.CAVE_ROCK, { skip: ['bottom'] });
      F.solid(...box, fl - 0.2, fl + h);
    }
  }
  for (let k = 0; k < 9; k++) {
    const u = R.u0 + 3 + r() * (R.u1 - R.u0 - 6), v = R.v0 + 3 + r() * (R.v1 - R.v0 - 6), w = 0.8 + r() * 1.8;
    ubox(c, { u0: u - w, u1: u + w, v0: v - w * 0.8, v1: v + w * 0.8 }, Y(R.ceil) - 0.6 - r() * 2.2, Y(R.ceil) + 0.02, MAT.CAVE_ROCK, { skip: ['top'] });
  }
  // a giant in the middle, great clusters round the walls, crystals hanging from the roof, small ones everywhere
  const mid: [number, number] = [(R.u0 + R.u1) / 2 - 1, (R.v0 + R.v1) / 2 + 1];
  cluster(c, F, mid[0], R.floor, mid[1], { size: 7.5, giant: true, seed: 300, hue: 0.65 }, 520, 20);
  const big: [number, number, number, V3?][] = [
    [R.u0 + 3, R.v0 + 3.5, 3.6], [R.u0 + 2.6, R.v1 - 4, 3.0], [R.u1 - 4.5, R.v0 + 3, 3.2], [mid[0] - 2, R.v1 - 2.6, 2.6],
    [R.u0 + 1.0, (R.v0 + R.v1) / 2, 2.4, [1, 0.6, 0.1]], [mid[0] + 4, R.v0 + 1.0, 2.2, [0.1, 0.6, 1]],
  ];
  big.forEach(([u, v, size, axis], i) => cluster(c, F, u, R.floor + (axis ? 2.5 : 0), v, { size, axis, seed: 310 + i, hue: 0.2 + 0.13 * i }, 200, 14));
  for (let k = 0; k < 4; k++) {
    const u = R.u0 + 4 + k * 5.2 + r() * 1.5, v = R.v0 + 5 + r() * (R.v1 - R.v0 - 10);
    cluster(c, null, u, R.ceil - 0.1, v, { size: 1.6 + r() * 1.4, axis: [r() - 0.5, -1, r() - 0.5], seed: 330 + k, hue: 0.5 }, k % 2 ? 110 : 0, 12);
  }
  for (let k = 0; k < 10; k++) {
    const u = R.u0 + 1.5 + r() * (R.u1 - R.u0 - 3), v = R.v0 + 1.5 + r() * (R.v1 - R.v0 - 3);
    if (Math.hypot(u - mid[0], v - mid[1]) < 4.5) continue;
    cluster(c, null, u, R.floor, v, { size: 0.6 + r() * 0.9, seed: 350 + k, hue: r() }, 0);
  }
  c.haul.colliders.push(room(F, R));
}

// ---------------------------------------------------------------- the shrine
function shrine(c: Ctx) {
  const R = SHRINE, fl = Y(R.floor);
  const F = shell(c, R, { bay: 4, beams: true });
  const sw = WAYS[3], st: WallStyle = { lintel: 7.2, bay: 4 };
  // the niche in its east wall: a deep recess holding the great crystal on its pedestal
  const nv0 = (R.v0 + R.v1) / 2 - 2.6, nv1 = (R.v0 + R.v1) / 2 + 2.6, nd = 2.4, nh = R.floor + 7.0;
  wall(c, F, R, 'e', [open(R, 'e', nv0, nv1, nh)], st);
  wall(c, F, R, 'w', [open(R, 'w', sw.v0, sw.v1, sw.head)], st);
  wall(c, F, R, 'n', [], st);
  wall(c, F, R, 's', [], st);
  const Nr: Rect = { u0: R.u1, u1: R.u1 + nd, v0: nv0, v1: nv1 };
  face(c, [P(Nr.u1, R.floor, Nr.v0), P(Nr.u1, R.floor, Nr.v1), P(Nr.u1, nh, Nr.v1), P(Nr.u1, nh, Nr.v0)], MAT.CAVE_TRIM, Wd);
  face(c, [P(Nr.u0, R.floor, Nr.v0), P(Nr.u1, R.floor, Nr.v0), P(Nr.u1, nh, Nr.v0), P(Nr.u0, nh, Nr.v0)], MAT.CAVE, S);
  face(c, [P(Nr.u1, R.floor, Nr.v1), P(Nr.u0, R.floor, Nr.v1), P(Nr.u0, nh, Nr.v1), P(Nr.u1, nh, Nr.v1)], MAT.CAVE, N);
  face(c, [P(Nr.u0, nh, Nr.v0), P(Nr.u1, nh, Nr.v0), P(Nr.u1, nh, Nr.v1), P(Nr.u0, nh, Nr.v1)], MAT.CAVE, DOWN);
  face(c, [P(Nr.u0, R.floor, Nr.v0), P(Nr.u1, R.floor, Nr.v0), P(Nr.u1, R.floor, Nr.v1), P(Nr.u0, R.floor, Nr.v1)], MAT.CAVE_FLOOR, UP);
  F.floor(Nr.u0, Nr.v0, Nr.u1, Nr.v1, fl, false);
  F.solid(Nr.u1, Nr.v0 - 1, Nr.u1 + 1, Nr.v1 + 1, fl - 1, Y(nh) + 1).solid(Nr.u0, Nr.v0 - 1, Nr.u1, Nr.v0, fl - 1, Y(nh) + 1).solid(Nr.u0, Nr.v1, Nr.u1, Nr.v1 + 1, fl - 1, Y(nh) + 1);
  // the pedestal (three steps), the great crystal on it, an altar before the niche, crystals either side of it
  const pc: [number, number] = [Nr.u0 + nd / 2 - 0.2, (nv0 + nv1) / 2];
  for (const [h, w] of [[0.3, 1.7], [0.6, 1.35], [0.9, 1.0]] as [number, number][]) ubox(c, { u0: pc[0] - w, u1: pc[0] + w, v0: pc[1] - w, v1: pc[1] + w }, fl, fl + h, MAT.CAVE_TRIM, { skip: ['bottom'] });
  F.solid(pc[0] - 1.7, pc[1] - 1.7, pc[0] + 1.7, pc[1] + 1.7, fl, fl + 6);
  cluster(c, null, pc[0], R.floor + 0.9, pc[1], { size: 5.2, giant: true, seed: 400, hue: 0.85, count: 5, spread: 0.12 }, 360, 16);
  const al: Rect = { u0: R.u1 - 4.4, u1: R.u1 - 3.0, v0: pc[1] - 1.8, v1: pc[1] + 1.8 };
  ubox(c, al, fl, fl + 1.05, MAT.CAVE_TRIM, { skip: ['bottom'] });
  ubox(c, { u0: al.u0 - 0.15, u1: al.u1 + 0.15, v0: al.v0 - 0.15, v1: al.v1 + 0.15 }, fl + 1.05, fl + 1.2, MAT.GOLD, { skip: ['bottom'] });
  F.solid(al.u0 - 0.15, al.v0 - 0.15, al.u1 + 0.15, al.v1 + 0.15, fl, fl + 1.2);
  for (const sg of [-1, 1]) cluster(c, F, R.u1 - 1.6, R.floor, pc[1] + sg * 5.4, { size: 2.2, seed: 410 + sg, hue: 0.55 }, 150, 12);
  c.haul.colliders.push(room(F, R));
}

// ---------------------------------------------------------------- the ways between them
/** a way through the walls between two rooms: its sides, its head, its floor (or steps between the two floors), solid
 *  sides and head for the walker and the camera */
function way(c: Ctx, w: Way) {
  const F = frame(`caverns.${w.name}`);
  const head = Y(w.head), lo = Math.min(w.y0, w.y1), hi = Math.max(w.y0, w.y1);
  const r: Rect = w;
  if (w.axis === 'v') {
    face(c, [P(r.u0, lo - 0.2, r.v1), P(r.u0, lo - 0.2, r.v0), P(r.u0, w.head, r.v0), P(r.u0, w.head, r.v1)], MAT.CAVE_TRIM, E);
    face(c, [P(r.u1, lo - 0.2, r.v0), P(r.u1, lo - 0.2, r.v1), P(r.u1, w.head, r.v1), P(r.u1, w.head, r.v0)], MAT.CAVE_TRIM, Wd);
    F.solid(r.u0 - 1, r.v0, r.u0, r.v1, Y(lo) - 1, head + 1).solid(r.u1, r.v0, r.u1 + 1, r.v1, Y(lo) - 1, head + 1);
  } else {
    face(c, [P(r.u0, lo - 0.2, r.v0), P(r.u1, lo - 0.2, r.v0), P(r.u1, w.head, r.v0), P(r.u0, w.head, r.v0)], MAT.CAVE_TRIM, S);
    face(c, [P(r.u1, lo - 0.2, r.v1), P(r.u0, lo - 0.2, r.v1), P(r.u0, w.head, r.v1), P(r.u1, w.head, r.v1)], MAT.CAVE_TRIM, N);
    F.solid(r.u0, r.v0 - 1, r.u1, r.v0, Y(lo) - 1, head + 1).solid(r.u0, r.v1, r.u1, r.v1 + 1, Y(lo) - 1, head + 1);
  }
  c.b.slab([at(r.u0, r.v0), at(r.u1, r.v0), at(r.u1, r.v1), at(r.u0, r.v1)], head, MAT.CAVE, true);
  F.solid(r.u0 - 1, r.v0 - 1, r.u1 + 1, r.v1 + 1, head, head + 1.5);
  if (hi - lo < 0.05) {
    c.b.slab([at(r.u0, r.v0), at(r.u1, r.v0), at(r.u1, r.v1), at(r.u0, r.v1)], Y(lo), MAT.CAVE_FLOOR);
    F.floor(r.u0, r.v0, r.u1, r.v1, Y(lo), false);
  } else {
    // (along u: level at each end, steps in the middle three metres from the lower floor's end to the higher's)
    const m = (r.u0 + r.u1) / 2, lowWest = w.y0 < w.y1, a = m - 1.5, z = m + 1.5;
    const [ax, az] = at(lowWest ? a : z, (r.v0 + r.v1) / 2), [zx, zz] = at(lowWest ? z : a, (r.v0 + r.v1) / 2);
    c.b.stairs(ax, Y(lo), az, zx, Y(hi), zz, r.v1 - r.v0, Math.round((hi - lo) / 0.17), MAT.CAVE_FLOOR, { side: MAT.CAVE_FLOOR, foot: Y(lo) - 0.3 });
    const lowEnd: Rect = lowWest ? { ...r, u1: a } : { ...r, u0: z }, highEnd: Rect = lowWest ? { ...r, u0: z } : { ...r, u1: a };
    for (const [q, y] of [[lowEnd, lo], [highEnd, hi]] as [Rect, number][]) {
      c.b.slab([at(q.u0, q.v0), at(q.u1, q.v0), at(q.u1, q.v1), at(q.u0, q.v1)], Y(y), MAT.CAVE_FLOOR);
      F.floor(q.u0, q.v0, q.u1, q.v1, Y(y), false);
    }
    F.stair(a, r.v0, z, r.v1, Y(lo), hi - lo, 0, lowWest ? 1 : -1);
    ubox(c, { u0: a, u1: z, v0: r.v0, v1: r.v1 }, Y(lo) - 0.3, Y(lo), MAT.CAVE_FLOOR, { skip: ['top', 'bottom', 'n', 's'] });
  }
  const sc = F.done();
  sc.levels = { lo: { height: Y(lo), ceiling: w.head - lo }, ...(hi - lo > 0.05 ? { hi: { height: Y(hi), ceiling: w.head - hi } } : {}) };
  c.haul.colliders.push(sc);
}
