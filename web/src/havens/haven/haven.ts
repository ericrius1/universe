// The Haven: the golden lotus temple on its mesa and the terraced gardens stepping down round it, the causeways between
// the garden wedges, the grand stair up the promontory's south face and the dwellings cut into the rock beside it, all
// built to the shared layout (TEMPLE, MESA, GARDENS, STAIR) into one ArchPart (with the crystal caverns under the
// temple and their stair pavilion on the forecourt: caverns/): the mesh, a walking collider per
// structure, the lanterns and lights, the pools, channels and cascades, and the planting beds for the flora.
// Deterministic: variation comes from seeded streams (plan.ts rng).
import { ArchBuilder } from '../arch/builder';
import type { ArchPart } from '../arch/types';
import type { Haul } from './colliders';
import { Shapes } from './shapes';
import { buildStair } from './stair';
import { buildCauseways } from './causeways';
import { buildCourts } from './courts';
import { buildDwellings } from './dwellings';
import { buildTemple } from './temple';
import { buildTerraces } from './terraces';
import { buildCaverns } from '../caverns/build';

export { havenGround } from './plan';
export { planToWorld } from './colliders';

export function buildHaven(): ArchPart {
  const b = new ArchBuilder();
  const s = new Shapes(b);
  const haul: Haul = { colliders: [], lights: [], water: [], beds: [] };
  b.owner('temple', () => buildTemple(s, haul));
  b.owner('terraces', () => buildTerraces(s, haul));
  b.owner('causeways', () => buildCauseways(s, haul));
  b.owner('stair', () => buildStair(s, haul));
  b.owner('courts', () => buildCourts(s, haul));
  b.owner('dwellings', () => buildDwellings(s, haul));
  // (under the temple, last: the surface over them laid first)
  b.owner('caverns', () => buildCaverns(s, haul));
  return { name: 'haven', mesh: b.finish(), ...haul, instances: b.placements };
}
