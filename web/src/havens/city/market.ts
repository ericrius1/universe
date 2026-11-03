// The west point's grand market (layout.ts MARKET, its claim the sixteen-gon round its ellipse; ref 2 and the city's
// night concept): a bazaar on the scale of a district, the town's most alive place. Round its whole edge run the souks
// (market/souk.ts), a covered street of shops behind an arcade, its canopy of cloth in every colour; four domed gates
// stand where the outline meets the axes (market/gates.ts), the avenue in from the ring road through the east one and
// out toward the tip through the west, the north and south ones shut to the town behind lattice doors. At the heart the
// great hall (market/hall.ts) lifts its blue dome over the avenue, which runs through it; on the avenue either side
// of it a fountain court and a ring of domed pavilions (market/courts.ts); everywhere else stalls under striped
// awnings, tents, rugs laid out and lantern strings over the aisles (market/stalls.ts). Its plan is market/plan.ts.
// Everything is laid in the market's frame (x east, z south from its centre, y up from FLOOR_Y) under the city's
// 'market' owner, each piece under its own ('market/souk', 'market/gate', 'market/hall', …).
import { MAT } from '../arch/types';
import { FLOOR_Y, MARKET } from '../world/layout';
import type { City } from './ctx';
import { Rng } from './rng';
import { buildCourts } from './market/courts';
import { buildGates } from './market/gates';
import { buildHall } from './market/hall';
import { buildSouks } from './market/souk';
import { buildStalls } from './market/stalls';
import { OUT, PAVE, corner, INNER } from './market/plan';

export function buildMarket(c: City, seed: number) {
  const b = c.b;
  b.group(() => {
    b.at(MARKET.x, FLOOR_Y, MARKET.z);
    // the square's paving inside the arcades
    b.owner('square', () => b.with({ tint: [1.02, 0.92, 0.82] }, () => b.slab(OUT.map((_, k) => corner(k, INNER.edge)), PAVE.square, MAT.PAVING)));
    buildSouks(c, seed + 1);
    buildGates(c);
    buildHall(c, new Rng(seed + 2));
    buildCourts(c, new Rng(seed + 3));
    buildStalls(c, new Rng(seed + 4));
  });
}
