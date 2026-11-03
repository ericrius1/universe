// The catalogue: every species the gardens, the city and the canyon are planted with, in the order the species table
// keeps them (their index is the instance's species id), and growFlora(), which grows each one's variants at each level
// of detail from fixed seeds: the same plants on every machine, every load.
import { hash, type FloraMeshData } from '../mesh';
import type { SpeciesDef } from './def';
import { lawn } from './lawn';
import { daisies, lilies, spires, starflowers, tulips } from './flowers';
import { boxballs, hedges } from './shrubs';
import { cypresses } from './cypress';
import { blossoms, olives, pomegranates } from './trees';
import { datePalms } from './palm';
import { bougainvilleas } from './vines';
import { lotuses } from './lotus';
import { agaves, bunchgrasses, scrubs } from './desert';
import { urns } from './urns';

export type { SpeciesDef } from './def';

export const SPECIES: SpeciesDef[] = [
  lawn, daisies, lilies, tulips, starflowers, spires, boxballs, hedges, cypresses, blossoms, olives, pomegranates, datePalms,
  bougainvilleas, lotuses, scrubs, bunchgrasses, agaves, urns,
];

/** a species' index by name (the instance's species id) */
export const SPECIES_ID: Record<string, number> = Object.fromEntries(SPECIES.map((s, i) => [s.name, i]));

export interface GrownSpecies {
  def: SpeciesDef;
  /** per variant, its three levels of detail */
  variants: [FloraMeshData, FloraMeshData, FloraMeshData][];
}

/** grow every species (or the named ones) at every level */
export function growFlora(names?: string[]): GrownSpecies[] {
  return SPECIES.filter((s) => !names || names.includes(s.name)).map((def) => ({
    def,
    variants: Array.from({ length: def.variants }, (_, v) => {
      const seed = hash(SPECIES_ID[def.name] + 1, v + 1, 7);
      return [0, 1, 2].map((lod) => {
        const m = def.grow(seed, lod as 0 | 1 | 2, v);
        m.hangs = def.hangs ?? false;
        return m.build();
      }) as [FloraMeshData, FloraMeshData, FloraMeshData];
    }),
  }));
}
