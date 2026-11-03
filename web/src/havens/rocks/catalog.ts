// The rock catalogue: every prototype the field places, built from fixed seeds so the world is the same on every load.
// Each family has a spread of sizes; instances scale a prototype by about ±25% and turn it, so a few dozen meshes make
// thousands of rocks. Building it all takes a second or so of CPU; rocks.ts does it in a worker.
import { arch } from './arch';
import { boulder, slab } from './blocks';
import { crystals } from './crystal';
import { hoodoo, ledge, mushroom, spire, table } from './formations';
import type { Kind, Proto } from './proto';

export interface Catalog {
  protos: Proto[];
  /** the prototypes of each family, by index into protos, smallest first */
  of: Record<Kind, number[]>;
}

/** the families' seeds and sizes (m: height for formations, span for arches, length of the biggest crystal for
 *  clusters; blocks are made about 1 m and scaled) */
const SPEC: { kind: Kind; make: (seed: number, size: number) => Proto; sizes: [number, number][] }[] = [
  { kind: 'hoodoo', make: hoodoo, sizes: [[11, 7], [5, 9], [23, 11], [44, 13], [31, 15], [11, 18], [57, 21], [62, 25], [70, 29]] },
  { kind: 'mushroom', make: mushroom, sizes: [[28, 8], [7, 12], [41, 16], [52, 22], [19, 30], [66, 44], [73, 58]] },
  { kind: 'table', make: table, sizes: [[3, 16], [8, 24], [13, 32]] },
  { kind: 'spire', make: spire, sizes: [[21, 24], [13, 34], [2, 46], [5, 62], [37, 82]] },
  { kind: 'boulder', make: (s) => boulder(s), sizes: [[4, 1], [12, 1], [17, 1], [31, 1], [36, 1], [45, 1], [58, 1], [63, 1]] },
  { kind: 'slab', make: (s) => slab(s), sizes: [[6, 1], [22, 1], [27, 1], [39, 1]] },
  { kind: 'ledge', make: ledge, sizes: [[4, 8], [9, 12], [15, 18]] },
  { kind: 'arch', make: arch, sizes: [[14, 28], [3, 38], [9, 52]] },
  { kind: 'crystal', make: (s, z) => crystals(s, z, { giant: z > 6 }), sizes: [[5, 0.6], [11, 0.9], [16, 1.3], [24, 1.8], [33, 2.5], [40, 3.5], [8, 9], [19, 13], [27, 18]] },
];

export function buildCatalog(): Catalog {
  const protos: Proto[] = [];
  const of = {} as Record<Kind, number[]>;
  for (const s of SPEC) {
    of[s.kind] = [];
    for (const [seed, size] of s.sizes) {
      of[s.kind].push(protos.length);
      protos.push(s.make(seed, size));
    }
  }
  return { protos, of };
}
