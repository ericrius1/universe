// The cell's story, in order: one protein's life, from the gene in the nucleus that spells it to its place in the
// cell's surface, and the power that pays for every step (from Cell, ui/story.ts, where it was written). Each chapter is a
// place (ui/places.ts) with what's happening there, things to look for (each lights up in the view when chosen: the
// spotlight, post.wgsl) and something to know. Above it the cosmos's chapters (cosmos/story.ts) come first, so the
// guide tells one story from the edge of what can be seen down to a molecule: STORY.
//
// Plain data: no code of the cell's comes in with it (a spot names a molecule by name; the cell's own chunk turns it
// into the shader's code, ui/spot.ts), so the guide is here before the cell is.
import { Kind, FilKind } from '../world/layout';
import { COSMOS_STORY, type CosmosChapter, type Thing } from '../cosmos/story';

/** something in the cell to light up: an organelle's kind, a filament's, or a molecule's (by its name in
 *  world/molecules.ts MOLS) */
export type Spot = { org: Kind } | { fil: FilKind } | { mol: string };
export interface CellChapter {
  place: string;
  short: string;
  part: string;
  title: string;
  scale: string;
  like: string;
  text: string;
  look: { t: string; spot?: Spot[] }[];
  know?: string;
  /** a button's id here (hud.ts), and its label */
  act?: { act: string; label: string };
}

/** a chapter as the guide shows it: above the cell or in it */
export type Chapter = (CosmosChapter & { act?: undefined }) | (CellChapter & { how?: undefined; instrument?: undefined });
export type Look = { t: string; spot?: (Thing | Spot)[] };

export const CELL_STORY: CellChapter[] = [
  {
    place: 'tissue', short: 'Tissue', part: 'Into the body', title: 'Human tissue', scale: '100 µm', like: 'about the width of a hair',
    text: 'These are the cornea\'s outer cells, the clear skin over the eye. Each rounded shape is one cell, about 20 µm across: five side by side would span a hair. You are made of about 37 trillion of them, and almost every one runs the same machinery. This story follows one protein through one of them, from the gene that spells it to its place in the cell\'s surface.',
    look: [
      { t: 'The dark core in each cell is its nucleus, where the instructions are kept.', spot: [{ org: Kind.NeighborNucleus }, { org: Kind.Nucleus }] },
      { t: 'The wavy fibres underneath are collagen, the rope that holds tissue together.', spot: [{ fil: FilKind.Collagen }] },
    ],
  },
  {
    place: 'cell', short: 'The cell', part: 'The factory', title: 'One cell, cut open', scale: '20 µm', like: 'a fifth of a hair\'s width',
    text: 'A cell runs like a factory. The nucleus keeps the instructions. The folded sheets of the endoplasmic reticulum (the ER) build proteins, and the Golgi finishes and ships them. Mitochondria make the energy, and a skeleton of filaments holds it all in shape and carries cargo. Every protein starts in the nucleus, so that\'s where we go next.',
    look: [
      { t: 'The big round body: the nucleus.', spot: [{ org: Kind.Nucleus }] },
      { t: 'The sheets folded round it: the ER.', spot: [{ org: Kind.ER }] },
      { t: 'The stack of curved sacs: the Golgi.', spot: [{ org: Kind.Golgi }] },
      { t: 'The sausage shapes: mitochondria.', spot: [{ org: Kind.Mito }] },
    ],
    act: { act: 'fluo', label: '◉ See it as a microscope does' },
  },
  {
    place: 'nucleus', short: 'Nucleus', part: 'The instructions', title: 'The nucleus', scale: '7 µm', like: 'a fifteenth of a hair\'s width',
    text: 'The whole genome is in here: 46 chromosomes, 6.4 billion letters of DNA, two metres of it if stretched end to end, folded into a ball a few microns across. A gene is a stretch of those letters that spells out one protein. The cell never sends the original out: it makes a copy.',
    look: [
      { t: 'The tangled threads are chromatin: DNA packed with proteins.', spot: [{ fil: FilKind.Chromatin }] },
      { t: 'The dense spot is the nucleolus, where ribosomes are assembled.', spot: [{ org: Kind.Nucleolus }] },
    ],
    know: 'Every cell in your body but red blood cells carries the same two metres of DNA.',
  },
  {
    place: 'dna', short: 'DNA', part: 'Copying a gene', title: 'DNA', scale: '20 nm', like: 'five thousand times thinner than a hair',
    text: 'DNA is wound round spools of histone proteins, the nucleosomes, like thread on bobbins. Where a gene is needed the spools loosen, and RNA polymerase runs along the double helix, reading one strand and writing a matching copy in RNA, tens of letters a second. That copy, messenger RNA, will carry the recipe out of the nucleus.',
    look: [
      { t: 'Each bead is a nucleosome: DNA wound 1.65 times round eight histones.', spot: [{ mol: 'nucleosome' }] },
      { t: 'Between the beads, the bare double helix: a letter every 0.34 nm.', spot: [{ mol: 'dnabp' }] },
    ],
  },
  {
    place: 'pore', short: 'Nuclear pores', part: 'Out of the nucleus', title: 'Nuclear pores', scale: '120 nm', like: 'about the size of a virus',
    text: 'The nucleus is wrapped in two membranes, and the messenger RNA can\'t cross them. It leaves through a pore: a gate built of about a thousand proteins. Small molecules slip through freely; big cargo like messenger RNA is escorted through a mesh of loose threads that fills the channel.',
    look: [
      { t: 'Each ring is one pore, built with eight-fold symmetry.', spot: [{ mol: 'npc' }] },
    ],
    know: 'A nucleus has a few thousand pores, each passing up to a thousand molecules a second.',
  },
  {
    place: 'er', short: 'Rough ER', part: 'Building the protein', title: 'Ribosomes on the rough ER', scale: '300 nm', like: 'a few hundred times thinner than a hair',
    text: 'Out in the cell a ribosome finds the messenger RNA and reads it three letters at a time. Each triplet calls for one of 20 amino acids, and the ribosome chains them on, about five a second. Proteins bound for the surface or for export are made here, on the ER: the ribosome threads the growing chain straight through the membrane into the ER, where it folds.',
    look: [
      { t: 'Each knob on the sheet is a ribosome, threading a new protein into the ER.', spot: [{ mol: 'ribosome' }] },
    ],
    know: 'A cell has about ten million ribosomes.',
  },
  {
    place: 'golgi', short: 'Golgi', part: 'Finishing and shipping', title: 'The Golgi', scale: '1 µm', like: 'a hundredth of a hair\'s width',
    text: 'Bubbles of membrane, vesicles, carry the new proteins from the ER to the Golgi, a stack of flattened sacs. As a protein passes from the near face of the stack to the far one, enzymes in each sac add and trim its sugar chains, tags that say what it is. At the far face it is sorted by those tags into vesicles addressed to the surface, to the lysosomes or out of the cell.',
    look: [
      { t: 'The stack of curved sacs.', spot: [{ org: Kind.Golgi }] },
      { t: 'The bubbles round it are vesicles, carrying cargo in and out.', spot: [{ org: Kind.Vesicle }] },
    ],
    know: 'Insulin and antibodies get their finishing touches here.',
  },
  {
    place: 'mt', short: 'Microtubules', part: 'Delivery', title: 'Microtubules', scale: '100 nm', like: 'a thousand times thinner than a hair',
    text: 'Vesicles don\'t drift to where they\'re going: they are hauled. Microtubules are hollow tracks of tubulin, 25 nm wide, running out from the middle of the cell. Kinesin, a motor with two feet, walks along them toward the edge, 8 nm a step, cargo in tow, and each step burns one molecule of ATP.',
    look: [
      { t: 'The tubes are microtubules: thirteen rows of tubulin make each wall.', spot: [{ fil: FilKind.Microtubule }, { mol: 'tubulin' }] },
      { t: 'A kinesin: two heads stepping hand over hand.', spot: [{ mol: 'kinhead' }, { mol: 'kinstalk' }] },
    ],
  },
  {
    place: 'membrane', short: 'The surface', part: 'Arrival', title: 'The cell\'s surface', scale: '50 nm', like: 'two thousand times thinner than a hair',
    text: 'At the edge the vesicle merges with the plasma membrane, and the protein it carried becomes part of the cell\'s skin. Our protein might be a receptor that senses a hormone, a pump that moves salts, or a gate that lets sugar in. The membrane itself is two layers of fatty lipids, 5 nm thick, their oily tails turned inward, coated outside with sugars.',
    look: [
      { t: 'Receptors: the β2 receptor senses adrenaline.', spot: [{ mol: 'gpcr' }] },
      { t: 'Pumps: the sodium-potassium pump keeps the cell charged.', spot: [{ mol: 'nakatpase' }] },
      { t: 'Gates: GLUT1 lets glucose in.', spot: [{ mol: 'glut1' }] },
    ],
    know: 'The sodium-potassium pump alone uses about a fifth of your body\'s energy at rest.',
  },
  {
    place: 'mito', short: 'Mitochondrion', part: 'Paying for it', title: 'A mitochondrion', scale: '2 µm', like: 'a fiftieth of a hair\'s width',
    text: 'Every step of this story cost energy: copying, building, hauling. The cell pays in ATP, and most of it is made here. A mitochondrion burns sugar and fat with the oxygen you breathe, and uses the energy to pump protons across its folded inner membrane, the cristae. Once a free-living bacterium, it still keeps a small genome of its own.',
    look: [
      { t: 'The folds inside are the cristae, lined with the machinery.', spot: [{ org: Kind.Crista }] },
    ],
  },
  {
    place: 'atp', short: 'ATP synthase', part: 'The motor', title: 'ATP synthase', scale: '50 nm', like: 'two thousand times thinner than a hair',
    text: 'The protons pumped across the crista flow back through ATP synthase, a motor set in the membrane. The flow spins its rotor about a hundred turns a second, and each turn makes three ATP in its head. That ATP powers everything you have just seen, in every one of your cells, all the time.',
    look: [
      { t: 'Each mushroom is a motor: the rotor in the membrane, the head above.', spot: [{ mol: 'atpsynthase' }] },
      { t: 'The L-shaped giants are Complex I, where the proton pumping starts.', spot: [{ mol: 'complex1' }] },
    ],
    know: 'You make and recycle about your own weight in ATP every day.',
  },
];

/** the whole story, from the top to the bottom */
export const STORY: Chapter[] = [...COSMOS_STORY, ...CELL_STORY];
export const chapterAt = (place: string) => STORY.findIndex((c) => c.place === place);
/** whether a chapter is told in the cell (its places have no 'u:') */
export const inCell = (c: Chapter) => !c.place.startsWith('u:');
