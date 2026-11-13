// What a thing says about itself: the words for whatever the crosshair is on, or for the well under the pointer on the
// plate. Plain data, no page: the page's card reads it, and so can any host the world is laid into.

import type { Axes } from '../data/compounds';
import { partById, PART } from '../data/parts';
import { fmtDose, fmtHours, type Store } from './state';

const pc = (v: number) => `${Math.round(v * 100)}%`;

export interface Look { title: string; kind: string; body: string; state?: string | null; facts: [string, string][] }

/** what the crosshair is on, or the well the pointer is over on the plate: a title, what kind of thing it is, what it
 *  is, what it is doing now in this well at this hour, and the numbers that are always true of it */
export function describe(store: Store): Look {
  const a = store.axes();
  const p = store.looking.part;
  if (store.stage === 'plate' || store.stage === 'dive' || store.stage === 'rising') {
    const w = store.hoverWell;
    if (w === null) {
      const part = partById.get(PART.plate)!;
      return { title: part.name, kind: part.kind, body: part.text, facts: part.facts ?? [] };
    }
    const well = store.plate()[w];
    const dom = well.dose > 0 ? well.compound.blurb : 'nothing added but the solvent';
    return {
      title: `${well.label} — ${well.compound.name}`,
      kind: well.dose > 0 ? well.compound.klass : 'vehicle control',
      body: `${fmtDose(well.dose)}, ${fmtHours(store.hours)} after dosing. ${well.dose > 0 ? `This column is ${dom}.` : 'Row H is the control: the same 0.1% DMSO, and nothing else.'}`,
      facts: [
        ['viability', pc(well.viability)] as [string, string],
        ['dominant lesion', well.dose > 0 ? describeDominant(well.axes) : 'none'],
      ],
    };
  }
  const part = partById.get(p) ?? partById.get(PART.cytosol)!;
  const state = part.state?.(a) ?? null;
  return { title: part.name, kind: part.kind, body: part.text, state, facts: part.facts ?? [] };
}

/** the worst thing happening in a well, in a word or two */
export function describeDominant(a: Axes): string {
  const named: [number, string][] = [
    [a.leak, 'membrane failure'], [a.karyolysis, 'necrosis'], [a.condense, 'apoptosis'],
    [a.dna, 'DNA damage'], [a.pld, 'phospholipidosis'], [a.constrict, 'cholestasis'],
    [a.lipid, 'steatosis'], [a.erStress, 'ER stress'], [a.depol, 'depolarisation'],
    [a.gsh, 'glutathione loss'], [a.ros, 'oxidative stress'],
  ];
  let best = named[0];
  for (const n of named) if (n[0] > best[0]) best = n;
  return best[0] > 0.12 ? best[1] : 'unremarkable';
}

