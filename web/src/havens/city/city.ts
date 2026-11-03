// The town on the star mesa (layout.ts: the points' districts round the citadel, PLAZA, GRAND_HALL, PALACE, MARKET, the
// ways, the rim), built at load from one seed: the street plan (plan.ts) and its houses, the courtyards, the ring road
// and the spoke avenues, the plaza with its fountain, the grand hall, the palace with its lattice spire, the market, the
// rim's lookout towers and the water gate. Everything is laid into one ArchBuilder, each part under the owner its claims
// (layout.ts CLAIMS) are held by — 'town' (its floor, its streets, its blocks, its street life nested under it),
// 'streets' (the ring road and the avenues), 'plaza', 'hall', 'palace', 'market', 'rim', 'gate' — and handed over as an
// ArchPart. Its colliders are StructureColliders whose plan maps to the world by ArchBuilder's yaw (planToWorld
// column-major [c,0,-s,0, 0,1,0,0, s,0,c,0, ox,oy,oz,1]), and ctx.ts's colliderBounds gives each one's box for a
// broadphase. It also hands over its night lights, its pools and its garden beds.
import type { ArchPart } from '../arch/types';
import { MAT } from '../arch/types';
import { FLOOR_Y, GRAND_HALL, PALACE } from '../world/layout';
import { City } from './ctx';
import { toWorld } from './geom';
import { alleyArches, buildFloor, buildWays, courtyard, gardenPlot, localSquare, streetLife } from './ground';
import { buildHall } from './hall';
import { Skyline, house } from './houses';
import { buildMarket } from './market';
import { buildPalace } from './palace';
import { type CityPlan, type Lot, planCity } from './plan';
import { buildPlaza } from './plaza';
import { buildRim, buildWaterGate } from './rim';
import { buildPools } from './pools';
import { buildWater } from './water';

const SEED = 0x5e7e4;

export function buildCity(): ArchPart {
  const c = new City();
  const plan = planCity(SEED);
  const sky = new Skyline();
  // (every lot's footprint first: a house's corner tower keeps out of the neighbours still to be built)
  for (const bl of plan.blocks) for (const pc of bl.pieces) for (const lot of pc.lots) sky.addLot(lot.poly.p.map((q) => toWorld(q, bl.o, bl.yaw)), lot);
  c.b.owner('town', () => buildTown(c, plan, sky));
  c.b.owner('streets', () => buildWays(c, plan, SEED + 5));
  c.b.owner('plaza', () => buildPlaza(c));
  c.b.owner('hall', () => turned(c, GRAND_HALL, () => buildHall(c)));
  c.b.owner('palace', () => turned(c, PALACE, () => buildPalace(c)));
  c.b.owner('market', () => buildMarket(c, SEED + 3));
  c.b.owner('rim', () => buildRim(c));
  c.b.owner('gate', () => buildWaterGate(c));
  buildWater(c);
  c.b.owner('pools', () => buildPools(c));
  c.sealColliders();
  return { name: 'city', mesh: c.b.finish(), colliders: c.colliders, lights: c.lights, water: c.water, beds: c.beds, instances: c.b.placements };
}

/** the town's fabric (owner 'town'): its floor, each superblock's houses, courtyards and gardens in its frame (one
 *  collider for all of it, the arches over its alleys among them), the local squares, the lantern strings across the
 *  streets */
function buildTown(c: City, plan: CityPlan, sky: Skyline) {
  c.b.owner('floor', () => buildFloor(c, plan.floor));
  for (const bl of plan.blocks) c.b.owner(`block-${bl.id}`, () => c.b.group(() => {
    c.b.at(bl.o[0], FLOOR_Y, bl.o[1], bl.yaw);
    const col = c.collide(`city/block-${bl.id}`);
    for (const pc of bl.pieces) {
      const courts = pc.lots.filter((l) => l.kind === 'court');
      for (const lot of pc.lots) {
        if (lot.kind === 'house') house(c, col, lot, courtEdges(lot, courts), bl, sky);
        else if (lot.kind === 'garden') c.b.owner('garden', () => gardenPlot(c, col, lot));
        else c.b.owner('court', () => courtyard(c, col, lot));
      }
    }
    c.b.owner('arches', () => alleyArches(c, col, bl, sky, SEED + 7 * bl.id));
  }));
  plan.squares.filter((q) => q.kind === 'local').forEach((q, i) => c.b.owner(`square-${i}`, () => localSquare(c, q.poly, i, SEED)));
  c.b.owner('street-life', () => streetLife(c, plan, sky, SEED + 2));
}

/** run a landmark's builder (which places itself at its anchor facing +z, south) turned about its anchor by the
 *  layout's yaw: the builder's own frame then sits at (x, z) facing the way the layout says */
function turned(c: City, a: { x: number; z: number; yaw: number }, fn: () => void) {
  c.b.group(() => {
    const cs = Math.cos(a.yaw), sn = Math.sin(a.yaw);
    // (ArchBuilder takes local (x, z) to t + (c x + s z, -s x + c z): t keeps the anchor where it is)
    c.b.at(a.x - (cs * a.x + sn * a.z), 0, a.z - (-sn * a.x + cs * a.z), a.yaw);
    fn();
  });
}

/** which of a lot's party edges look onto a courtyard of its block, all along them (an edge half on a court and half
 *  on a garden or a house isn't a court's) */
function courtEdges(lot: Lot, courts: Lot[]): boolean[] {
  const p = lot.poly.p;
  return p.map((a, i) => {
    if (lot.poly.f[i] !== 0) return false;
    const b = p[(i + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const at = (t: number): [number, number] => [a[0] + (b[0] - a[0]) * t + ((b[1] - a[1]) / L) * 0.5, a[1] + (b[1] - a[1]) * t - ((b[0] - a[0]) / L) * 0.5];
    return courts.some((q) => [0.06, 0.5, 0.94].every((t) => insideConvex(at(t), q.poly.p)));
  });
}

function insideConvex(pt: [number, number], p: [number, number][]): boolean {
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    if ((b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]) < 0) return false;
  }
  return true;
}
