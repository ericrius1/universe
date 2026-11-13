// What the spotlight lights, for the cell's shaders (G.spots, world.wgsl): up to two kinds, 16 bits each, the class in
// the top two (1 organelle, 2 filament, 3 molecule) and the kind below. In the cell's own chunk, since it reads the
// molecules' list (world/molecules.ts MOLS).
import { Kind, FilKind } from '../world/layout';
import { MOLS, type MolName } from '../world/molecules';
import type { Spot } from './story';

export function spotCode(spots: Spot[] = []): number {
  const one = (s: Spot) => 'org' in s ? (1 << 14) | s.org : 'fil' in s ? (2 << 14) | s.fil : (3 << 14) | Math.max(0, (MOLS as readonly string[]).indexOf(s.mol));
  return spots.slice(0, 2).reduce((code, s, i) => code | (one(s) << (16 * i)), 0) >>> 0;
}

/** the chapter's place a thing does its work in (story.ts): tapped anywhere, it can take you there */
const ORG_CHAPTER: Partial<Record<Kind, string>> = {
  [Kind.Cell]: 'membrane', [Kind.Nucleus]: 'nucleus', [Kind.Nucleolus]: 'nucleus', [Kind.Mito]: 'mito', [Kind.Crista]: 'atp', [Kind.ER]: 'er',
  [Kind.Golgi]: 'golgi', [Kind.Vesicle]: 'golgi', [Kind.Neighbor]: 'tissue', [Kind.NeighborNucleus]: 'tissue',
};
const FIL_CHAPTER: Partial<Record<FilKind, string>> = { [FilKind.Microtubule]: 'mt', [FilKind.Chromatin]: 'dna', [FilKind.Collagen]: 'tissue' };
const MOL_CHAPTER: Partial<Record<MolName, string>> = {
  ribosome: 'er', trna: 'er', nucleosome: 'dna', polymerase: 'dna', dnabp: 'dna', npc: 'pore', tubulin: 'mt', kinhead: 'mt', kinstalk: 'mt',
  vesicle: 'mt', gpcr: 'membrane', nakatpase: 'membrane', glut1: 'membrane', atpsynthase: 'atp', complex1: 'atp', complex4: 'atp', cytc: 'atp', vdac: 'mito',
};
/** a picked id (organelle index + 1; 0x4… filament; 0x8… molecule) to its chapter's place, or null */
export function chapterPlace(id: number, kindOf: (org: number) => number): string | null {
  if (!id) return null;
  if (id & 0x80000000) return MOL_CHAPTER[MOLS[(id >>> 16) & 0x7fff] as MolName] ?? null;
  if (id & 0x40000000) return FIL_CHAPTER[((id >>> 16) & 0xff) as FilKind] ?? null;
  return ORG_CHAPTER[kindOf(id - 1) as Kind] ?? null;
}
