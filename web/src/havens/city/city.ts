// The walled city in the canyon's basin (layout.ts: BASIN, WALL, GATE, PLAZA, AVENUE, GRAND_HALL, PALACE, MARKET), built
// at load from one seed: the street plan (plan.ts) and its houses, the courtyards and squares, the wall with its towers
// and gates, the plaza with its fountain and the avenue, the grand hall, the palace with its lattice spire and the
// market. Everything is laid into one ArchBuilder and handed over as an ArchPart. Its colliders are StructureColliders
// whose plan maps to the world by ArchBuilder's yaw (planToWorld column-major [c,0,-s,0, 0,1,0,0, s,0,c,0, ox,oy,oz,1]),
// and ctx.ts's colliderBounds gives each one's box for a broadphase. It also hands over its night lights, its pools and
// its garden beds. The grand stair's foot (STAIR's first landing) is left open between the north towers.
import type { ArchPart } from '../arch/types';
import { FLOOR_Y } from '../world/layout';
import { City } from './ctx';
import { buildFloor, courtyard, localSquare, paveStreets, streetLife } from './ground';
import { buildHall } from './hall';
import { Skyline, house } from './houses';
import { buildMarket } from './market';
import { buildPalace } from './palace';
import { type Lot, planCity } from './plan';
import { buildPlaza, buildWays } from './plaza';
import { buildWall } from './wall';

const SEED = 0x5e7e4;

export function buildCity(): ArchPart {
  const c = new City();
  const plan = planCity(SEED);
  const sky = new Skyline();
  buildFloor(c);
  paveStreets(c, plan.streets);
  for (const piece of plan.pieces) {
    c.b.group(() => {
      c.b.at(piece.o[0], FLOOR_Y, piece.o[1], piece.yaw);
      // (a block's lots in runs of a few dozen per collider: neighbours in the split order are neighbours on the
      // ground, so each collider stays small and a broadphase on their bounds finds few)
      let col = c.collide(`city/block-${piece.id}-0`);
      const courts = piece.lots.filter((l) => l.kind === 'court');
      piece.lots.forEach((lot, k) => {
        if (k > 0 && k % 24 === 0) col = c.collide(`city/block-${piece.id}-${k / 24}`);
        if (lot.kind === 'house') house(c, col, lot, courtEdges(lot, courts), piece, sky);
        else courtyard(c, col, lot);
      });
    });
  }
  plan.squares.filter((q) => q.kind === 'local').forEach((q, i) => localSquare(c, q.poly, i, SEED));
  streetLife(c, plan, sky, SEED + 2);
  buildPlaza(c);
  buildWays(c);
  buildHall(c);
  buildPalace(c);
  buildMarket(c, SEED + 3);
  buildWall(c, SEED + 1);
  c.sealColliders();
  return { name: 'city', mesh: c.b.finish(), colliders: c.colliders, lights: c.lights, water: c.water, beds: c.beds };
}

/** which of a lot's party edges look onto a courtyard of its block */
function courtEdges(lot: Lot, courts: Lot[]): boolean[] {
  const p = lot.poly.p;
  return p.map((a, i) => {
    if (lot.poly.f[i] !== 0) return false;
    const b = p[(i + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const m: [number, number] = [(a[0] + b[0]) / 2 + ((b[1] - a[1]) / L) * 0.5, (a[1] + b[1]) / 2 - ((b[0] - a[0]) / L) * 0.5];
    return courts.some((q) => insideConvex(m, q.poly.p));
  });
}

function insideConvex(pt: [number, number], p: [number, number][]): boolean {
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    if ((b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]) < 0) return false;
  }
  return true;
}
