// The town's pools (round 6, B3e): the turquoise ellipses between the ridges in every point (layout.ts POOLS, all but
// the last, which is the canal's tank: water.ts), laid under 'pools'. The land digs each one's bed (2.4 m down inside
// a 1.5 m bank, the outline on the town's flat floor); this lays what's built round it, in the pool's own frame (x
// along its long axis): a cream coping on the outline, its face to the water tiled in a band of interlaced stars down
// below the waterline; a ring of warm paving round it; at one end a landing a step down from the coping and a flight
// of steps from it down into the water, for bathing and for drawing water; a lamp or two beside it (instanced, as the
// town's are); the water at -0.25, 2.15 m deep; and in about half of them a raft of lotus at the far end.
import { MAT, TILE_PAL, type V3 } from '../arch/types';
import { flight } from '../arch/parts';
import { POOLS, type Pool, type V2 } from '../world/layout';
import type { City } from './ctx';
import { PAVE, between, face, lampAt } from './water';

/** the water's level and its depth (to the land's bed at -2.4); the coping (its width, its top, how far down its face
 *  to the water goes), the paving round it (out from the outline), the landing's height and its steps' rise */
const POOL = { level: -0.25, depth: 2.15, cope: 0.7, top: 0.28, face: -0.75, paving: 2.6, landing: 0.08, rise: 1.2, stepW: 2.4 };
const TILES = [TILE_PAL.FOUNTAIN, TILE_PAL.HOUSE_BLUE, TILE_PAL.PALACE] as const;
const PAVE_TINT: V3 = [1.06, 0.93, 0.8];

/** every town pool (the tank is the canal's) */
export function buildPools(c: City) {
  POOLS.forEach((q, i) => { if (q.kind === 'pool') c.b.owner(`pool-${i}`, () => townPool(c, q, i)); });
}

/** a pool's ring d out from its outline in its own frame (its points turning from +x toward +z: clockwise from
 *  above), n of them */
const ring = (q: Pool, d: number, n: number): V2[] => Array.from({ length: n }, (_, k) => {
  const t = (k / n) * Math.PI * 2;
  return [(q.rx + d) * Math.cos(t), (q.rz + d) * Math.sin(t)] as V2;
});

function townPool(c: City, q: Pool, i: number) {
  const b = c.b, n = q.rx > 11 ? 44 : 36, o: V2 = [0, 0];
  const hash = ((i * 2654435761) >>> 0) / 4294967296;
  b.group(() => {
    // (the pool's frame: x along its long axis, as layout.ts poolPoly turns it)
    b.at(q.x, 0, q.z, -q.rot);
    const col = c.collide(`city/pool-${i}`);
    const E0 = ring(q, 0, n), E1 = ring(q, POOL.cope, n), E2 = ring(q, POOL.paving, n);
    // the coping: its top, its face to the water (tiled), its face onto the paving
    between(b, E1, E0, o, POOL.top, MAT.CREAM);
    b.with({ tint: PAVE_TINT }, () => between(b, E2, E1, o, PAVE, MAT.PAVING));
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      b.with({ pal: TILES[i % TILES.length] }, () => face(b, E0[j], E0[k], POOL.face, POOL.top, MAT.TILE_BAND));
      face(b, E1[k], E1[j], PAVE, POOL.top, MAT.CREAM);
      face(b, E2[k], E2[j], -0.05, PAVE, MAT.ASHLAR);
    }
    // the landing at the far end (+x) a step down from the coping, out to the outline; the steps from it into the
    // water
    const hw = POOL.stepW / 2, ut = q.rx * Math.sqrt(1 - (hw / q.rz) ** 2) - 0.25, foot = POOL.landing - POOL.rise;
    const arc = E0.filter(([x, z]) => x > 0 && Math.abs(z) < hw - 1e-6).sort((p, r) => p[1] - r[1]);
    const ex = q.rx * Math.sqrt(1 - (hw / q.rz) ** 2);
    const land: V2[] = [[ut, -hw], [ex, -hw], ...arc, [ex, hw], [ut, hw]];
    b.slab(land, POOL.landing, MAT.CREAM);
    face(b, [ut, -hw], [ex, -hw], foot, POOL.landing, MAT.CREAM);
    face(b, [ex, hw], [ut, hw], foot, POOL.landing, MAT.CREAM);
    const steps = Math.round(POOL.rise / 0.17), run = steps * 0.32;
    b.group(() => {
      b.at(ut - run, foot, 0, -Math.PI / 2);
      flight(b, { rise: POOL.rise, width: POOL.stepW, cheek: 'none', every: 99, mat: MAT.CREAM, side: MAT.CREAM, seed: i });
    });
    col.stair(ut - run, -hw, ut, hw, foot, POOL.rise, 0, 1).floor(ut, -hw, ex, hw, POOL.landing);
    // the water, the lotus at the near end of half of them, a lamp either side
    c.pool(E0, POOL.level, POOL.depth);
    if (hash < 0.55) c.bed(ring({ ...q, rx: q.rx * 0.38, rz: q.rz * 0.5 }, 0, 12).map(([x, z]) => [x - q.rx * 0.45, z] as V2), POOL.level, 'lotus', 0.4);
    // (a lamp either side of the bigger ones, one by the smaller: the water's lights are few)
    for (const s of q.rx >= 12 ? [-1, 1] : [hash < 0.5 ? -1 : 1]) lampAt(b, 0, PAVE, s * (q.rz + (POOL.cope + POOL.paving) / 2), 1.1);
  });
}
