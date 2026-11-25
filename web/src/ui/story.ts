// The cell's story, in order: one protein's life, from the gene in the nucleus that spells it to its place in the
// cell's surface, and the power that pays for every step (from Cell, ui/story.ts, where it was written). Each chapter is a
// place (ui/places.ts) with what's happening there, crisp at-a-glance metrics, things to look for (each lights up in
// the view when chosen: the spotlight, post.wgsl) and something to know. Above it the cosmos's chapters
// (cosmos/story.ts) come first, so the guide tells one story from the edge of what can be seen down to a molecule: STORY.
//
// Plain data: no code of the cell's comes in with it (a spot names a molecule by name; the cell's own chunk turns it
// into the shader's code, ui/spot.ts), so the guide is here before the cell is.
import { Kind, FilKind } from '../world/layout';
import { COSMOS_STORY, type CosmosChapter, type Stat, type Thing } from '../cosmos/story';

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
  stats?: Stat[];
  text: string;
  look: { t: string; spot?: Spot[] }[];
  know?: string;
  /** a button's id here (hud.ts), or 'play:<game>' to launch a cell game, and its label */
  act?: { act: string; label: string };
}

/** a chapter as the guide shows it: above the cell or in it */
export type Chapter = (CosmosChapter & { act?: undefined }) | (CellChapter & { how?: undefined; instrument?: undefined });
export type Look = { t: string; spot?: (Thing | Spot)[]; focus?: string };

export const CELL_STORY: CellChapter[] = [
  {
    place: 'tissue', short: 'Tissue', part: 'Into the body', title: 'Human tissue', scale: '100 µm', like: 'about the width of a hair',
    stats: [{ v: '~20 µm', k: 'per cell' }, { v: '37 trillion', k: 'cells in you' }, { v: '67 nm', k: 'collagen bands' }],
    text: 'These are the cornea\'s outer cells, the clear skin over the eye. Each rounded shape is one cell, about 20 µm across: five side by side would span a hair. You are made of about 37 trillion of them, and almost every one runs the same machinery. This story follows one protein through one of them, from the gene that spells it to its place in the cell\'s surface.',
    look: [
      { t: 'The dark core in each cell is its nucleus, where the instructions are kept.', spot: [{ org: Kind.NeighborNucleus }, { org: Kind.Nucleus }] },
      { t: 'The wavy fibres underneath are collagen, the rope that holds tissue together.', spot: [{ fil: FilKind.Collagen }] },
    ],
    know: 'Your cornea replaces its entire outer surface of living cells roughly once every week.',
  },
  {
    place: 'cell', short: 'The cell', part: 'The living city', title: 'One cell, cut open', scale: '20 µm', like: 'a fifth of a hair\'s width',
    stats: [{ v: '~10M', k: 'ribosomes' }, { v: '100s', k: 'mitochondria' }, { v: '100× slower', k: 'time up close' }],
    text: 'A cell runs like a self-sustaining living city. The nucleus keeps the archive of instructions. The folded sheets of the endoplasmic reticulum (the ER) build proteins, and the Golgi finishes and dispatches them. Mitochondria generate clean chemical energy, and a living lattice of filaments holds it all in shape and carries cargo.',
    look: [
      { t: 'The big round body: the nucleus.', spot: [{ org: Kind.Nucleus }] },
      { t: 'The sheets folded round it: the ER.', spot: [{ org: Kind.ER }] },
      { t: 'The stack of curved sacs: the Golgi.', spot: [{ org: Kind.Golgi }] },
      { t: 'The sausage shapes: mitochondria.', spot: [{ org: Kind.Mito }] },
    ],
    act: { act: 'fluo', label: '◉ See it as a microscope does' },
  },
  {
    place: 'nucleus', short: 'Nucleus', part: 'The archive', title: 'The nucleus', scale: '7 µm', like: 'a fifteenth of a hair\'s width',
    stats: [{ v: '6.4 billion', k: 'DNA letters' }, { v: '2 metres', k: 'folded inside' }, { v: '46', k: 'chromosomes' }],
    text: 'The whole genome is in here: 46 chromosomes, 6.4 billion letters of DNA, two metres of it if stretched end to end, folded into a ball a few microns across. A gene is a stretch of those letters that spells out one protein. The cell never sends the original out: it makes a working copy.',
    look: [
      { t: 'The tangled threads are chromatin: DNA packed with proteins.', spot: [{ fil: FilKind.Chromatin }] },
      { t: 'The dense spot is the nucleolus, where ribosomes are assembled.', spot: [{ org: Kind.Nucleolus }] },
      { t: 'The double-walled nuclear envelope, pierced by thousands of gates.', spot: [{ org: Kind.Nucleus }] },
    ],
    know: 'Every cell in your body except red blood cells carries the same two metres of DNA.',
  },
  {
    place: 'dna', short: 'DNA', part: 'Copying a gene', title: 'DNA', scale: '20 nm', like: 'five thousand times thinner than a hair',
    stats: [{ v: '147 bp', k: 'per spool' }, { v: '0.34 nm', k: 'per letter' }, { v: '~40 / sec', k: 'RNA copy rate' }],
    text: 'DNA is wound round spools of histone proteins, the nucleosomes, like thread on bobbins. Where a gene is needed the spools loosen, and RNA polymerase runs along the double helix, reading one strand and writing a matching copy in RNA, tens of letters a second. That copy, messenger RNA, will carry the recipe out of the nucleus.',
    look: [
      { t: 'Each bead is a nucleosome: DNA wound 1.65 times round eight histones.', spot: [{ mol: 'nucleosome' }] },
      { t: 'Between the beads, the bare double helix: a letter every 0.34 nm.', spot: [{ mol: 'dnabp' }] },
      { t: 'RNA polymerase II unzipping the helix to copy a gene.', spot: [{ mol: 'polymerase' }] },
    ],
    know: 'Stretched end to end, all the DNA in your body would reach the Sun and back dozens of times.',
    act: { act: 'play:polymerase', label: '✦ Play as RNA polymerase' },
  },
  {
    place: 'pore', short: 'Nuclear pores', part: 'Out of the nucleus', title: 'Nuclear pores', scale: '120 nm', like: 'about the size of a virus',
    stats: [{ v: '~1,000', k: 'proteins / gate' }, { v: '8-fold', k: 'ring symmetry' }, { v: '~1,000 / s', k: 'molecules passed' }],
    text: 'The nucleus is wrapped in two membranes, and messenger RNA can\'t cross them. It leaves through a nuclear pore complex: one of the largest molecular machines in the cell, built from roughly a thousand proteins arranged in an eight-fold ring. Small molecules slip through freely; big cargo like messenger RNA is escorted through a selective mesh of disordered threads filling the channel.',
    look: [
      { t: 'Each glowing ring is one nuclear pore complex, built with eight-fold symmetry.', spot: [{ mol: 'npc' }] },
      { t: 'The nuclear envelope beneath them: a double membrane that only pores pierce.', spot: [{ org: Kind.Nucleus }] },
      { t: 'Inside the envelope, tangled chromatin fibres where messenger RNA begins its journey.', spot: [{ fil: FilKind.Chromatin }] },
    ],
    know: 'A single nucleus has a few thousand pores, each capable of escorting up to a thousand molecules every second.',
  },
  {
    place: 'er', short: 'Rough ER', part: 'Building the protein', title: 'Ribosomes on the rough ER', scale: '300 nm', like: 'a few hundred times thinner than a hair',
    stats: [{ v: '~10 million', k: 'ribosomes / cell' }, { v: '~5 / sec', k: 'amino acids added' }, { v: '20', k: 'building blocks' }],
    text: 'Out in the cell a ribosome finds the messenger RNA and reads it three letters at a time. Each triplet calls for one of 20 amino acids, and the ribosome chains them on, about five a second. Proteins bound for the surface or for export are made here, on the ER: the ribosome threads the growing chain straight through the membrane into the ER, where it folds.',
    look: [
      { t: 'Each knob on the sheet is a ribosome, threading a new protein into the ER.', spot: [{ mol: 'ribosome' }] },
      { t: 'The folded membrane sheets of the rough endoplasmic reticulum.', spot: [{ org: Kind.ER }] },
    ],
    know: 'Two thirds of a ribosome is RNA itself—its catalytic heart is an ancient molecular machine called a ribozyme.',
    act: { act: 'play:ribosome', label: '✦ Play as a ribosome' },
  },
  {
    place: 'golgi', short: 'Golgi', part: 'Finishing and shipping', title: 'The Golgi', scale: '1 µm', like: 'a hundredth of a hair\'s width',
    stats: [{ v: '4–8 sacs', k: 'per stack' }, { v: '50–100 nm', k: 'cargo vesicles' }, { v: 'Sugar tags', k: 'address labels' }],
    text: 'Bubbles of membrane, vesicles, carry the new proteins from the ER to the Golgi, a stack of flattened sacs. As a protein passes from the near face of the stack to the far one, enzymes in each sac add and trim its sugar chains, tags that say what it is. At the far face it is sorted by those tags into vesicles addressed to the surface, to the lysosomes or out of the cell.',
    look: [
      { t: 'The stack of curved sacs where enzymes refine each protein.', spot: [{ org: Kind.Golgi }] },
      { t: 'The bubbles round it are vesicles, carrying cargo in and out.', spot: [{ org: Kind.Vesicle }] },
    ],
    know: 'Insulin and antibodies get their finishing touches here.',
  },
  {
    place: 'mt', short: 'Microtubules', part: 'Delivery', title: 'Microtubules', scale: '100 nm', like: 'a thousand times thinner than a hair',
    stats: [{ v: '25 nm', k: 'tube width' }, { v: '13 rows', k: 'tubulin wall' }, { v: '8 nm / step', k: 'kinesin stride' }],
    text: 'Vesicles don\'t drift to where they\'re going: they are hauled. Microtubules are hollow tracks of tubulin, 25 nm wide, running out from the middle of the cell. Kinesin, a motor with two feet, walks along them toward the edge, 8 nm a step, cargo in tow, and each step burns one molecule of ATP.',
    look: [
      { t: 'The tubes are microtubules: thirteen rows of tubulin make each wall.', spot: [{ fil: FilKind.Microtubule }, { mol: 'tubulin' }] },
      { t: 'A kinesin: two heads stepping hand over hand.', spot: [{ mol: 'kinhead' }, { mol: 'kinstalk' }] },
      { t: 'Transport vesicles hauled overhead along the tracks.', spot: [{ mol: 'vesicle' }] },
    ],
    know: 'A kinesin motor takes roughly a hundred steps a second—scaled to human height, that is like sprinting with a bus on your back.',
    act: { act: 'play:kinesin', label: '✦ Walk as kinesin' },
  },
  {
    place: 'membrane', short: 'The surface', part: 'Arrival', title: 'The cell\'s surface', scale: '50 nm', like: 'two thousand times thinner than a hair',
    stats: [{ v: '5 nm', k: 'bilayer depth' }, { v: '20%', k: 'resting energy' }, { v: 'Fluid skin', k: 'lipid sea' }],
    text: 'At the edge the vesicle merges with the plasma membrane, and the protein it carried becomes part of the cell\'s skin. Our protein might be a receptor that senses a hormone, a pump that moves salts, or a gate that lets sugar in. The membrane itself is two layers of fatty lipids, 5 nm thick, their oily tails turned inward, coated outside with sugars.',
    look: [
      { t: 'Receptors: the β2 receptor senses adrenaline.', spot: [{ mol: 'gpcr' }] },
      { t: 'Pumps: the sodium–potassium pump keeps the cell charged.', spot: [{ mol: 'nakatpase' }] },
      { t: 'Gates: GLUT1 lets glucose in.', spot: [{ mol: 'glut1' }] },
    ],
    know: 'The sodium–potassium pump alone uses about a fifth of your body\'s energy at rest.',
  },
  {
    place: 'mito', short: 'Mitochondrion', part: 'Paying for it', title: 'A mitochondrion', scale: '2 µm', like: 'a fiftieth of a hair\'s width',
    stats: [{ v: '1–4 µm', k: 'length' }, { v: 'Own DNA', k: 'ancient symbiont' }, { v: '100s', k: 'per cell' }],
    text: 'Every step of this story cost energy: copying, building, hauling. The cell pays in ATP, and most of it is made here. A mitochondrion burns sugar and fat with the oxygen you breathe, and uses the energy to pump protons across its folded inner membrane, the cristae. Once a free-living bacterium, it still keeps a small genome of its own.',
    look: [
      { t: 'The folds inside are the cristae, lined with the energy machinery.', spot: [{ org: Kind.Crista }] },
      { t: 'The outer membrane shell studded with VDAC channels that pass fuel and ATP.', spot: [{ org: Kind.Mito }, { mol: 'vdac' }] },
    ],
    know: 'Mitochondria began as free-living bacteria that merged with an ancient ancestor cell over a billion and a half years ago.',
  },
  {
    place: 'atp', short: 'ATP synthase', part: 'The turbine', title: 'ATP synthase', scale: '50 nm', like: 'two thousand times thinner than a hair',
    stats: [{ v: '~100 rev/s', k: 'rotor speed' }, { v: '3 ATP', k: 'per full turn' }, { v: '1× body wt', k: 'recycled daily' }],
    text: 'The protons pumped across the crista flow back through ATP synthase, a living nanometre-scale turbine set in the membrane. The flow spins its rotor about a hundred turns a second, and each turn forges three ATP in its crown. That ATP powers everything you have just seen, in every one of your cells, all the time.',
    look: [
      { t: 'Each mushroom is a turbine: the rotor in the membrane, the catalytic crown above.', spot: [{ mol: 'atpsynthase' }] },
      { t: 'The L-shaped giants are Complex I, where the proton pumping starts.', spot: [{ mol: 'complex1' }] },
      { t: 'Cytochrome c oxidase hands electrons to the oxygen you breathe, making water.', spot: [{ mol: 'complex4' }] },
    ],
    know: 'You make and recycle roughly your own body weight in ATP every single day.',
    act: { act: 'play:atp', label: '✦ Spin ATP synthase' },
  },
];

/** the whole story, from the top to the bottom */
export const STORY: Chapter[] = [...COSMOS_STORY, ...CELL_STORY];
export const chapterAt = (place: string) => STORY.findIndex((c) => c.place === place);
/** whether a chapter is told in the cell (its places have no 'u:') */
export const inCell = (c: Chapter) => !c.place.startsWith('u:');
