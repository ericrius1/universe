// What everything is: the organelles, the filaments, and (molecules.ts INFO) the molecules — a name, a size, how many
// a cell has, and what it does, for the hover tag and the info card.
import { Kind, FilKind } from '../world/layout';
import { INFO, MOLS } from '../world/molecules';

export interface Card { title: string; size?: string; count?: string; text: string; pdb?: string; play?: string }

export const ORGANELLE: Record<number, Card> = {
  [Kind.Cell]: { title: 'Plasma membrane', size: '5 nm thick', text: 'A double layer of lipids, oily tails inward, that holds the cell together and decides what gets in. Studded with receptors, pumps and channels, and coated outside with sugar chains.' },
  [Kind.Nucleus]: { title: 'Nucleus', size: '~7 µm across', count: '1 per cell', text: 'Holds the genome: 46 chromosomes, 6.4 billion letters of DNA, two metres of it if stretched out. A double membrane surrounds it, pierced by thousands of nuclear pores.' },
  [Kind.Nucleolus]: { title: 'Nucleolus', size: '1–2 µm', text: 'A dense spot in the nucleus with no membrane, where ribosomal RNA is transcribed and ribosomes are put together.' },
  [Kind.Mito]: { title: 'Mitochondrion', size: '1–4 µm long', count: 'hundreds per cell', text: 'Once a free-living bacterium, now the cell\'s power plant, with its own small genome. Food is burned with oxygen across its inner membrane to make ATP.' },
  [Kind.Crista]: { title: 'Crista', size: '~20 nm wide folds', text: 'A fold of the mitochondrion\'s inner membrane. The folds pack in more membrane for the respiratory chain and ATP synthase, which line their edges.' },
  [Kind.ER]: { title: 'Endoplasmic reticulum', size: 'sheets ~50 nm thick', text: 'A maze of membrane sheets and tubes continuous with the nuclear envelope. Ribosomes on the rough ER thread new proteins straight into it to be folded.' },
  [Kind.Golgi]: { title: 'Golgi apparatus', size: '~1 µm stack', text: 'Stacked flattened sacs where proteins from the ER get their sugar tags and are sorted into vesicles for their destinations.' },
  [Kind.Lysosome]: { title: 'Lysosome', size: '0.1–1 µm', count: 'hundreds', text: 'The recycling centre: an acid bubble of digestive enzymes that breaks down worn-out parts and whatever the cell has swallowed.' },
  [Kind.Peroxisome]: { title: 'Peroxisome', size: '~0.2–0.5 µm', text: 'Burns very long fatty acids and neutralises hydrogen peroxide with the enzyme catalase.' },
  [Kind.Endosome]: { title: 'Endosome', size: '~0.3 µm', text: 'A sorting station for things brought in from outside: some get recycled to the surface, the rest go on to lysosomes.' },
  [Kind.Vesicle]: { title: 'Vesicle', size: '50–100 nm', text: 'A small bubble of membrane carrying cargo between compartments, often hauled along microtubules by motor proteins.' },
  [Kind.Droplet]: { title: 'Lipid droplet', size: '~0.5 µm', text: 'A store of fat wrapped in a single layer of lipids.' },
  [Kind.Neighbor]: { title: 'A neighbouring cell', size: '~20 µm', text: 'Your body has about 37 trillion cells, joined to their neighbours and sitting in a matrix of collagen.' },
  [Kind.NeighborNucleus]: { title: 'A neighbour\'s nucleus', text: 'Every one of your cells (but red blood cells) carries the same genome in a nucleus like this.' },
};

export const FILAMENT: Record<number, Card> = {
  [FilKind.Microtubule]: { title: 'Microtubule', size: '25 nm wide', text: 'A hollow tube of tubulin: 13 rows of αβ dimers. Microtubules radiate from the centrosome, grow and shrink at their tips, and are the tracks motor proteins walk on.', play: 'kinesin' },
  [FilKind.Actin]: { title: 'Actin filament', size: '7 nm wide', text: 'Two strands of actin twisted together. A mesh of them under the membrane (the cortex) shapes the cell and lets it crawl.' },
  [FilKind.Intermediate]: { title: 'Intermediate filament', size: '10 nm wide', text: 'Rope-like vimentin fibres that give the cell tensile strength and cradle the nucleus.' },
  [FilKind.Chromatin]: { title: 'Chromatin', size: '~30 nm fibre', text: 'DNA wrapped round histones, coiled and folded. Packed tight where genes are off, loosened where they are being read.', play: 'polymerase' },
  [FilKind.Collagen]: { title: 'Collagen fibril', size: '~100 nm wide', text: 'The most abundant protein in your body: triple helices staggered into banded fibrils (the 67 nm bands) that hold tissues together.' },
};

const PLAY_FOR: Partial<Record<string, string>> = { ribosome: 'ribosome', atpsynthase: 'atp', kinhead: 'kinesin', kinstalk: 'kinesin', polymerase: 'polymerase', tubulin: 'kinesin', nucleosome: 'polymerase', dnabp: 'polymerase' };

/** the card for a picked id (organelle index + 1; 0x4… filament; 0x8… molecule) */
export function cardFor(id: number, kindOf: (org: number) => number): Card | null {
  if (!id) return null;
  if (id & 0x80000000) {
    const t = (id >>> 16) & 0x7fff;
    const name = MOLS[t];
    if (!name) return null;
    const m = INFO[name];
    return { title: m.name, text: m.blurb, pdb: m.pdb, play: PLAY_FOR[name] };
  }
  if (id & 0x40000000) return FILAMENT[(id >>> 16) & 0xff] ?? null;
  return ORGANELLE[kindOf(id - 1)] ?? null;
}
