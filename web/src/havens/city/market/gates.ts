// The market's four gates, where its outline meets the axes (plan.ts GATES): each a domed crossing, as the old
// bazaars' chahar-suqs are, where the souk's street passes the gate's way under a dome. A square block of thick walls:
//   - its outer face to the town: a grand portal (parts' portal: a pointed arch in a tiled field framed in tile border,
//     an archivolt of red and cream, a crested cornice, lanterns either side) — open on the avenue at the east and the
//     west (market-in from the ring road, market-out toward the tip), its gold lattice doors shut at the north and the
//     south, which face the town's back lanes;
//   - its inner face onto the market: the same portal's arch, open;
//   - its flanks: an arch each way for the souk's street, ringed in red and cream;
//   - inside, a room under a painted ceiling; over it the roof, a parapet with stepped merlons, a dome on a drum of lit
//     windows; and at its outer corners two round towers with little domes, the gate between them (ref 6).
// Laid in the gate's own frame: x across its way, z out along the axis from its inner face (0) to its outer (depth).
import { portal, pierced, type Bay } from '../../arch/parts';
import { archCurve, segsFor } from '../../arch/parts/arches';
import { MAT, TILE_PAL } from '../../arch/types';
import type { City } from '../ctx';
import { domeOf, gon, ring, shaft } from './kit';
import { GATES, PAVE, STREET, type Gate } from './plan';

export function buildGates(c: City) {
  const b = c.b;
  b.owner('gate', () => {
    for (const g of GATES) b.group(() => {
      // (the frame: z out along the axis, x across it, from the inner face's middle)
      b.at(g.axis[0] * g.inner, 0, g.axis[1] * g.inner, Math.atan2(g.axis[0], g.axis[1]));
      gate(c, g);
    });
  });
}

function gate(c: City, g: Gate) {
  const b = c.b, D = g.outer - g.inner, H = g.half, t = g.wall, h = g.h, great = g.open;
  const col = c.collide(`city/market-gate-${g.name}`);
  const det = great ? 'near' : 'mid';
  // the way: the portals' arch, and the bay the walls leave open for it
  const segs = segsFor(det, g.way.w), crown = archCurve('pointed', g.way.w, segs).crown, ys = g.way.h - crown;
  const way: Bay = { x: H, span: g.way.w, sill: 0, spring: ys, kind: 'pointed', segs };
  // the souk street's arch in each flank: its span the street's but a little, its crown under the canopy
  const zs = g.street - g.inner, sw = STREET.half * 2 - 0.9, ssegs = 10, scrown = archCurve('pointed', sw, ssegs).crown, sys = 6.3 - scrown;
  b.with({ tint: [1.0, 0.9, 0.82] }, () => {
    // the inner wall (pierced by the way) and the outer (pierced on the avenue, whole where it's shut)
    b.group(() => { b.at(-H, 0, t / 2); pierced(b, 2 * H, h, t, [way], MAT.PLASTER, { top: null, soffit: MAT.ASHLAR }); });
    if (great) b.group(() => { b.at(-H, 0, D - t / 2); pierced(b, 2 * H, h, t, [way], MAT.PLASTER, { top: null, soffit: MAT.ASHLAR }); });
    else b.box(-H, 0, D - t, H, h, D, MAT.PLASTER, { skip: ['top', 'bottom'] });
    // the flanks, between them, each pierced by the street's arch (their front to the souk)
    for (const sx of [1, -1] as const) b.group(() => {
      const len = D - 2 * t;
      if (sx > 0) b.at(H - t / 2, 0, D - t, Math.PI / 2); else b.at(-H + t / 2, 0, t, -Math.PI / 2);
      const x = sx > 0 ? D - t - zs : zs - t;
      b.with({ pal: TILE_PAL.HOUSE }, () => pierced(b, len, h, t, [{ x, span: sw, sill: 0, spring: sys, kind: 'pointed', segs: ssegs }], MAT.PLASTER, { top: null, ends: false, spandrel: MAT.TILE }));
      for (const side of [1, -1]) b.group(() => {
        if (side < 0) b.at(len, 0, 0, Math.PI);
        ring(b, 'pointed', sw, ssegs, side > 0 ? x : len - x, sys, t / 2 + 0.025, 0.24, MAT.CREAM, MAT.RED);
      });
    });
  });
  // the roof over it all, its parapet round the edge (capped, merlons on it), the room's painted ceiling
  b.slab([[-H, 0], [H, 0], [H, D], [-H, D]], h, MAT.PLASTER);
  const pin = 0.12, pt = 0.45, ph = 0.85;
  b.wall([[-H + pin + pt / 2, pt / 2 + pin], [H - pin - pt / 2, pt / 2 + pin], [H - pin - pt / 2, D - pin - pt / 2], [-H + pin + pt / 2, D - pin - pt / 2]], h, h + ph, pt, MAT.PLASTER, { closed: true, cap: MAT.CREAM, capH: 0.16, capOut: 0.06 });
  for (const [ax, az, bx, bz] of [[-H, pin + pt / 2, H, pin + pt / 2], [-H, D - pin - pt / 2, H, D - pin - pt / 2], [H - pin - pt / 2, 0, H - pin - pt / 2, D], [-H + pin + pt / 2, 0, -H + pin + pt / 2, D]]) {
    const L = Math.hypot(bx - ax, bz - az), n = Math.floor((L - 1.4) / 1.05);
    for (let k = 0; k <= n; k++) { const f = (0.7 + (k * (L - 1.4)) / Math.max(1, n)) / L; b.place('merlon-stepped', [ax + (bx - ax) * f, h + ph + 0.16, az + (bz - az) * f], { yaw: Math.abs(bx - ax) > 1 ? 0 : Math.PI / 2 }); }
  }
  const hc = h - 0.7;
  b.with({ glow: 0 }, () => b.slab([[-H + t, t], [H - t, t], [H - t, D - t], [-H + t, D - t]], hc, MAT.LAVENDER, true));
  // the floor: the room's and the ways' through the walls, a kerb round it
  b.with({ tint: [0.98, 0.84, 0.7] }, () => b.slab([[-H, 0], [H, 0], [H, D], [-H, D]], PAVE.hall, MAT.PAVING));
  // (its edge where it shows: across the ways' and the streets' openings)
  const kerb = (pts: [number, number, number][], out: [number, number, number]) => b.patch(pts, [0, 1, 2, 0, 2, 3], MAT.ASHLAR, out);
  const hw = g.way.w / 2, k0 = PAVE.square;
  kerb([[-hw, k0, 0], [hw, k0, 0], [hw, PAVE.hall, 0], [-hw, PAVE.hall, 0]], [0, 0, -1]);
  if (great) kerb([[-hw, 0, D], [hw, 0, D], [hw, PAVE.hall, D], [-hw, PAVE.hall, D]], [0, 0, 1]);
  for (const sx of [-1, 1]) kerb([[sx * H, 0.11, zs - sw / 2], [sx * H, 0.11, zs + sw / 2], [sx * H, PAVE.hall, zs + sw / 2], [sx * H, PAVE.hall, zs - sw / 2]], [sx, 0, 0]);
  // the dome on its drum over the room's middle, its windows lit at night
  const r = Math.min(H - t, (D - 2 * t) / 2) - 0.5;
  b.group(() => {
    b.at(0, h, D / 2);
    domeOf(b, { r, kind: great ? 'pointed' : 'round', rise: great ? r * 1.12 : undefined, drum: great ? 1.6 : 1.2, detail: 'mid', seed: g.k + 3, glaze: [1, 1, 1] });
  });
  // the portals: onto the town (open or shut) and onto the market (their crests' merlons and their lanterns placed,
  // instanced, as the portal lays them)
  b.group(() => { b.at(0, 0, D); grand(c, g.way.w, g.way.h, great ? 'passage' : 'lattice', det, g.k, true); });
  b.group(() => { b.at(0, 0, 0, Math.PI); grand(c, g.way.w, g.way.h, 'passage', 'mid', g.k + 1, great); });
  // the towers at its outer corners, each an eight-sided shaft with a cornice and a little dome
  const tr = great ? 1.8 : 1.6, tz = D - (great ? 2.16 : 2.0), tx = H + (great ? 0.8 : 1.6), th = h + (great ? 4.2 : 3.4);
  for (const sx of [-1, 1]) {
    const x = sx * tx;
    b.with({ tint: [1.0, 0.9, 0.8] }, () => shaft(b, x, tz, tr, 0, th, MAT.PLASTER, 8));
    // (a cream band at the parapet's height, the cornice its top)
    shaft(b, x, tz, tr + 0.06, h - 0.3, h + 0.15, MAT.CREAM, 8);
    const ring8 = gon(x, tz, tr + 0.06, 8, Math.PI / 8);
    b.slab(ring8, h - 0.3, MAT.CREAM, true);
    b.slab(ring8, h + 0.15, MAT.CREAM);
    // (the cap the dome stands on: its underside the overhang the shaft shows from below)
    b.box(x - tr - 0.12, th, tz - tr - 0.12, x + tr + 0.12, th + 0.35, tz + tr + 0.12, MAT.CREAM);
    b.group(() => { b.at(x, th + 0.35, tz); domeOf(b, { r: tr * 0.82, kind: 'onion', drum: 0.5, detail: 'far', seed: g.k * 2 + sx + 9, glaze: [1, 1, 1] }); });
    // two slits of window up it, lit
    for (const wy of [h * 0.45, h + 1.6]) b.with({ glow: 0.7 }, () => {
      const a = Math.atan2(0, sx), wx = x + Math.cos(a) * (tr * Math.cos(Math.PI / 8) + 0.02);
      b.patch([[wx, wy, tz - 0.22], [wx, wy, tz + 0.22], [wx, wy + 1.1, tz + 0.22], [wx, wy + 1.1, tz - 0.22]], [0, 1, 2, 0, 2, 3], MAT.WINDOW, [sx, 0, 0]);
    });
    col.solid(x - tr, tz - tr, x + tr, tz + tr, 0, th);
  }
  // its colliders: the walls beside the openings, the room's floor
  const half = g.way.w / 2;
  for (const z0 of great ? [0, D - t] : [0]) { col.solid(-H, z0, -half, z0 + t, 0, h); col.solid(half, z0, H, z0 + t, 0, h); col.solid(-half, z0, half, z0 + t, ys + crown, h); }
  if (!great) col.solid(-H, D - t, H, D, 0, h);
  for (const sx of [-1, 1]) {
    const x0 = sx > 0 ? H - t : -H, x1 = sx > 0 ? H : -H + t;
    col.solid(x0, t, x1, zs - sw / 2, 0, h);
    col.solid(x0, zs + sw / 2, x1, D - t, 0, h);
  }
  col.floor(-H, 0, H, D, PAVE.hall, false);
}

/** a grand portal on a face (the frame's z 0, facing +z) with its threshold at the ground: the parts' portal, its
 *  cornice's crest of stepped merlons and the lanterns either side of it placed instanced where it would lay them */
export function grand(c: City, w: number, h: number, fill: 'passage' | 'lattice' | 'open', detail: 'near' | 'mid', seed: number, crest: boolean) {
  const b = c.b;
  portal(b, { w, h, depth: 0, fill, steps: 0, detail, seed, pal: TILE_PAL.HALL, crest: false, lanterns: false });
  // (its field's and border's reach: portal()'s own numbers)
  const Wo = w / 2 + 0.3 + 0.32 + 0.36, Ho = h + 0.3 + 0.32 + 0.36;
  if (crest) {
    const n = Math.max(3, Math.round((2 * Wo + 0.4) / 0.62)), step = (2 * Wo + 0.4) / n;
    for (let k = 0; k < n; k++) b.place('merlon-stepped', [-Wo - 0.2 + step * (k + 0.5), Ho + 0.3, 0.14], { scale: 0.66 });
  }
  for (const s of [-1, 1]) b.place('lantern-wall', [s * (Wo + 0.55), Math.min(2.6, h * 0.6), 0]);
}
