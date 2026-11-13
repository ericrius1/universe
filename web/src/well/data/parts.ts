// Everything you can point at, and what it says. `id` matches the id the renderer writes into its pick buffer, so
// looking at a thing and reading about it are the same act.
//
// `state` turns the live lesion axes into the second paragraph: what this particular organelle is doing right now,
// in this well, at this hour. That is the whole trick of the place — the same mitochondrion says something
// different depending on what it has been given.

import type { Axes } from './compounds';

export interface Part {
  id: number;
  key: string;
  name: string;
  kind: string;
  /** what it is */
  text: string;
  /** numbers that are always true of it */
  facts?: [string, string][];
  /** what it is doing now */
  state?: (a: Axes) => string | null;
}

/** the ids the shaders write; keep in step with pick.wgsl */
export const PART = {
  none: 0,
  cytosol: 1,
  nucleus: 2,
  nucleolus: 3,
  mito: 4,
  rer: 5,
  ser: 6,
  golgi: 7,
  lysosome: 8,
  peroxisome: 9,
  lipid: 10,
  glycogen: 11,
  canaliculus: 12,
  junction: 13,
  membrane: 14,
  feeder: 15,
  collagen: 16,
  medium: 17,
  well: 18,
  plate: 19,
  neighbour: 20,
  lamellar: 21,
  foci: 22,
  bleb: 23,
} as const;

const pc = (v: number) => `${Math.round(v * 100)}%`;

export const PARTS: Part[] = [
  {
    id: PART.nucleus,
    key: 'nucleus',
    name: 'Nucleus',
    kind: 'organelle',
    text:
      'Five to ten micrometres across, wrapped in a double membrane punched through with nuclear pores. Between a ' +
      'tenth and a third of human hepatocytes carry two of these — the cell went through the motions of dividing ' +
      'and did not finish — and many are polyploid besides. In a healthy cell the chromatin is dispersed and even, ' +
      'because most of the genome is being read.',
    facts: [
      ['diameter', '5–10 µm'],
      ['two per cell', '10–30% of cells'],
      ['stain', 'Hoechst 33342'],
    ],
    state: (a) => {
      if (a.condense > 0.3)
        return `Condensing. The chromatin is pulling into bright lumps against the envelope (${pc(a.condense)}), ` +
          `which is what an apoptotic nucleus does — and shortly it will break into separate pieces. Hoechst gets ` +
          `brighter and smaller, not dimmer and bigger.`;
      if (a.karyolysis > 0.3)
        return `Pale and swollen (${pc(a.karyolysis)}). The detail is going rather than gathering — karyolysis, the ` +
          `necrotic ending. Hoechst dims and spreads, the exact opposite of the apoptotic nucleus.`;
      if (a.dna > 0.2)
        return `Intact, but marked. ${Math.round(2 + a.dna * 26)} γH2AX foci are lit in the nucleoplasm — each one a ` +
          `double-strand break being flagged — and p53 is gathering.`;
      return null;
    },
  },
  {
    id: PART.nucleolus,
    key: 'nucleolus',
    name: 'Nucleolus',
    kind: 'in the nucleus',
    text:
      'Not a compartment with a membrane but a dense knot where ribosomal RNA is transcribed and ribosomes are ' +
      'assembled — a condensate held together by what it is doing. A hepatocyte, which exports protein for a ' +
      'living, keeps a large and obvious one.',
    state: (a) =>
      a.dna > 0.3
        ? 'Remodelling. Nucleolar stress is one of the first things a genotoxic insult does to the look of a nucleus.'
        : a.erStress > 0.5
          ? 'Quieter. With the unfolded protein response running, translation is being throttled and ribosome ' +
            'production with it.'
          : null,
  },
  {
    id: PART.mito,
    key: 'mito',
    name: 'Mitochondrion',
    kind: 'organelle',
    text:
      'Half a micrometre to one and a half long, two membranes, the inner one folded into tightly stacked cristae ' +
      'where the respiratory chain sits. A hepatocyte carries somewhere between eight hundred and two thousand of ' +
      'them — counts differ by a factor of two between sources — filling perhaps a fifth of the cytoplasm, joined ' +
      'into a loose network that is constantly fusing and dividing. They are where most drug toxicity ends up, ' +
      'whatever it started as.',
    facts: [
      ['length', '0.5–1.5 µm'],
      ['per cell', '~800–2,000'],
      ['of cytoplasm', '13–20%'],
      ['stain', 'TMRM / TMRE'],
    ],
    state: (a) => {
      const bits: string[] = [];
      if (a.depol > 0.15)
        bits.push(
          `The membrane potential is ${pc(1 - a.depol)} of normal — TMRM is washing out of the matrix into the ` +
            `cytosol, which is the single most sensitive readout in this whole plate.`,
        );
      if (a.swell > 0.2) bits.push(`The matrix has cleared and the cristae are rarefying (${pc(a.swell)}).`);
      if (a.frag > 0.25) bits.push(`The network has come apart into short rods and dots (${pc(a.frag)}).`);
      if (a.atpLoss > 0.3) bits.push(`ATP is down to ${pc(1 - a.atpLoss)}; past about half, nothing else in the cell can be maintained.`);
      return bits.length ? bits.join(' ') : null;
    },
  },
  {
    id: PART.rer,
    key: 'rer',
    name: 'Rough endoplasmic reticulum',
    kind: 'organelle',
    text:
      'Flattened sheets studded with ribosomes, stacked in parallel around the nucleus. This is where every protein ' +
      'the liver exports is made and folded — albumin above all, which a hepatocyte turns out at a rate of around ' +
      'a hundred thousand molecules a minute. It is also the first thing to notice when folding stops working.',
    facts: [['stain', 'concanavalin A / ER-Tracker']],
    state: (a) =>
      a.erStress > 0.2
        ? `Distended (${pc(a.erStress)}). The cisternae are rounding out, ribosomes are coming off so the rough ER ` +
          `goes smooth, and the unfolded protein response is running: BiP and ATF4 up, CHOP behind them. Past a day ` +
          `of CHOP the cell stops adapting and starts dying.`
        : null,
  },
  {
    id: PART.ser,
    key: 'ser',
    name: 'Smooth endoplasmic reticulum',
    kind: 'organelle',
    text:
      'Tubular, ribosome-free, continuous with the rough ER and threaded through the glycogen fields. This is where ' +
      'the cytochrome P450 enzymes live — CYP3A4, 2E1, 1A2, 2C9 — which is to say this is where most of the ' +
      'compounds in this plate are turned into whatever actually does the damage. Nothing here is poisonous until ' +
      'this membrane makes it so.',
    facts: [['holds', 'CYP450s, UGTs'], ['grows', 'on enzyme induction']],
    state: (a) => (a.gsh < 0.75 ? 'Busy. Whatever is being made here is being conjugated as fast as the cell can manage.' : null),
  },
  {
    id: PART.golgi,
    key: 'golgi',
    name: 'Golgi apparatus',
    kind: 'organelle',
    text:
      'A stack of flattened cisternae sitting between the ER and the canaliculus, where proteins get their final ' +
      'sugars and are sorted to where they are going. In a polarised hepatocyte it sits on the canalicular side, ' +
      'because that is the direction most of its traffic goes.',
    state: (a) => (a.erStress > 0.4 ? `Fragmenting and dispersing (${pc(a.erStress)}) as the traffic through it stalls.` : null),
  },
  {
    id: PART.lysosome,
    key: 'lysosome',
    name: 'Lysosome',
    kind: 'organelle',
    text:
      'Two or three hundred per cell, crowded near the bile canaliculus, each one an acid bag at about pH 4.7 full ' +
      'of enzymes that take things apart. Being acidic makes them a trap: any weak base that can cross a membrane ' +
      'uncharged gets protonated inside and cannot get out again, so it concentrates there hundreds of times over. ' +
      'Half the drugs that cause phospholipidosis do it for exactly that reason.',
    facts: [['per cell', '~200–300'], ['interior', 'pH ~4.7'], ['stain', 'LysoTracker']],
    state: (a) => {
      if (a.pld > 0.3) return `Loaded. Lamellar bodies — concentric whorls of undigestible membrane — are filling them (${pc(a.pld)}).`;
      if (a.lyso > 0.3) return `Swollen and bright (${pc(a.lyso)}). Something weak and basic is accumulating in here.`;
      return null;
    },
  },
  {
    id: PART.lamellar,
    key: 'lamellar',
    name: 'Lamellar body',
    kind: 'lesion',
    text:
      'Half a micrometre to two across, concentric rings of membrane wound like the rings of a tree, sitting inside ' +
      'a swollen lysosome. It is phospholipid the cell cannot digest, because the drug that accumulated in here has ' +
      'inhibited the phospholipase that would have done it and bound the lipid into complexes besides. This is ' +
      'phospholipidosis, and it is worth being clear that it is not in itself death: cells carry these for a long ' +
      'time and keep working. It is a lesion, and whether it matters is still argued.',
    facts: [['diameter', '0.5–2 µm'], ['stain', 'HCS LipidTOX phospholipidosis']],
  },
  {
    id: PART.peroxisome,
    key: 'peroxisome',
    name: 'Peroxisome',
    kind: 'organelle',
    text:
      'Two to six hundred per cell, a fifth to one micrometre across, one membrane, a denser matrix than anything ' +
      'around it. They oxidise very-long-chain fatty acids, which makes hydrogen peroxide, which the catalase ' +
      'packed in here immediately destroys. A quiet organelle that mostly only becomes interesting when fat ' +
      'metabolism is in trouble.',
    facts: [['per cell', '~200–600'], ['diameter', '0.2–1 µm']],
  },
  {
    id: PART.lipid,
    key: 'lipid',
    name: 'Lipid droplet',
    kind: 'organelle',
    text:
      'A core of triglyceride and cholesterol ester wrapped in a single layer of phospholipid — half a membrane, ' +
      'not a whole one. A healthy hepatocyte carries a few small ones. Fat accumulates when it comes in faster than ' +
      'it is burned or exported, and the pattern says something about why: many small droplets with the nucleus ' +
      'left in the middle means the burning has stopped, and one large one shoving the nucleus aside means it has ' +
      'been accumulating slowly for a long time.',
    facts: [['stain', 'BODIPY 493/503 · LipidTOX neutral lipid']],
    state: (a) => {
      if (a.lipid < 0.15) return null;
      return a.micro > 0.5
        ? `Microvesicular (${pc(a.lipid)}): many small droplets filling the cytoplasm, the nucleus still central. ` +
          `The classic picture of mitochondrial β-oxidation in trouble.`
        : `Accumulating (${pc(a.lipid)}), coalescing toward larger droplets.`;
    },
  },
  {
    id: PART.glycogen,
    key: 'glycogen',
    name: 'Glycogen',
    kind: 'store',
    text:
      'Rosettes a hundred to two hundred nanometres across, each an aggregate of twenty or thirty smaller ' +
      'particles, in fields threaded through with smooth ER. This is the body\'s blood-sugar buffer, and it is the ' +
      'first thing a hepatocyte spends when it is in trouble — glycogen fields dissolving is one of the earliest ' +
      'signs on an electron micrograph that something has gone wrong.',
    facts: [['rosette', '100–200 nm']],
    state: (a) => (a.atpLoss > 0.3 || a.swell > 0.4 ? 'Dissolving. The fields are breaking up as the cell spends what it has.' : null),
  },
  {
    id: PART.canaliculus,
    key: 'canaliculus',
    name: 'Bile canaliculus',
    kind: 'structure',
    text:
      'Not a tube the cell made but a groove between two cells, sealed along both sides by tight junctions: half a ' +
      'micrometre to two and a half across, lined with stubby microvilli, ringed by a dense belt of actin. Bile ' +
      'acids are pumped into it by BSEP against a thousand-fold gradient. And it moves — in a healthy polarised ' +
      'culture the lumen squeezes shut and opens again every twenty or thirty minutes, driven by myosin light ' +
      'chain phosphorylation cycling on and off. That pulse is the surest sign a culture is alive and still knows ' +
      'which way is up.',
    facts: [
      ['width', '0.5–2.5 µm'],
      ['contracts', 'every 20–30 min'],
      ['pump', 'BSEP (ABCB11)'],
      ['stain', 'CDF / CLF efflux'],
    ],
    state: (a) => {
      if (a.constrict < 0.15 && a.effluxLoss < 0.15) return null;
      const bits: string[] = [];
      if (a.constrict > 0.15)
        bits.push(
          `Constricted (${pc(a.constrict)}) — narrow, kinked, the actin ring thickened — and the contraction rhythm ` +
            `has stopped.`,
        );
      if (a.effluxLoss > 0.15) bits.push(`The lumen is only filling to ${pc(1 - a.effluxLoss)} of normal: export is failing, so bile acids are building up inside the cell instead.`);
      else if (a.constrict > 0.4) bits.push('The pump itself is untouched, though — this lesion is mechanical, not a blocked transporter.');
      return bits.join(' ');
    },
  },
  {
    id: PART.junction,
    key: 'junction',
    name: 'Tight junction',
    kind: 'structure',
    text:
      'The seal that runs along both sides of the canaliculus and makes it a separate compartment — strands of ' +
      'claudin and occludin zippering two membranes together, with ZO-1 holding them to the cytoskeleton. Without ' +
      'it there is no inside and outside and no bile.',
    facts: [['marker', 'ZO-1']],
  },
  {
    id: PART.membrane,
    key: 'membrane',
    name: 'Plasma membrane',
    kind: 'structure',
    text:
      'The cell\'s edge, and the most literal readout in toxicology: when it fails, lactate dehydrogenase comes out ' +
      'into the medium and propidium iodide goes in, and those two measurements are most of what "cytotoxicity" ' +
      'has meant for forty years.',
    facts: [['failure', 'LDH out · PI in']],
    state: (a) => {
      if (a.leak > 0.25) return `Failing (${pc(a.leak)}). LDH is in the medium and the dyes are getting in.`;
      if (a.oncosis > 0.25) return `Bulging. Large clear blebs that sit there rather than churn — the swelling of a necrotic cell, not the boiling of an apoptotic one.`;
      if (a.caspase > 0.3) return `Blebbing hard — but these churn and retract and pinch off as apoptotic bodies, and the membrane is still intact: phosphatidylserine has flipped to the outside while the dyes are still shut out.`;
      return null;
    },
  },
  {
    id: PART.bleb,
    key: 'bleb',
    name: 'Bleb',
    kind: 'lesion',
    text:
      'A bulge where the membrane has come away from the cytoskeleton underneath. Which kind it is tells you how ' +
      'the cell is dying. An apoptotic bleb boils — it forms, retracts, forms again, and eventually pinches off a ' +
      'membrane-wrapped parcel that a neighbour will eat without complaint. A necrotic bleb just grows, clear and ' +
      'still, as water follows failing ion gradients in, until it bursts and spills the contents into the well.',
  },
  {
    id: PART.cytosol,
    key: 'cytosol',
    name: 'Cytosol',
    kind: 'compartment',
    text:
      'Not water. About a fifth protein by weight, crowded enough that a molecule diffusing through it is ' +
      'constantly bumping into something, threaded with cytoskeleton and strung through with every membrane in the ' +
      'cell. It also holds the glutathione — five to ten millimolar of it, the cell\'s standing account against ' +
      'anything reactive.',
    facts: [['glutathione', '5–10 mM'], ['protein', '~20% by weight'], ['stain', 'monochlorobimane']],
    state: (a) => {
      if (a.gsh > 0.15)
        return `Glutathione is down to ${pc(1 - a.gsh)} of where it started. While there is any to spare, reactive ` +
          `metabolites are conjugated and nothing happens. Past about eighty per cent depletion they start binding ` +
          `protein instead, and that is where toxicity begins.`;
      if (a.ros > 0.3) return `Oxidising (${pc(a.ros)}). CellROX is lighting up.`;
      return null;
    },
  },
  {
    id: PART.foci,
    key: 'foci',
    name: 'γH2AX focus',
    kind: 'lesion',
    text:
      'A spot of phosphorylated histone H2AX, perhaps half a micrometre across, marking one double-strand break in ' +
      'the DNA. Thousands of H2AX molecules are phosphorylated around a single break, which is why one break makes ' +
      'a spot you can see. Count the spots per nucleus and you have counted the damage.',
    facts: [['≈', 'one focus, one break']],
  },
  {
    id: PART.feeder,
    key: 'feeder',
    name: 'Feeder cell',
    kind: 'the other cells',
    text:
      'Primary human stromal and endothelial cells, surrounding every hepatocyte island. They are not passengers: ' +
      'in co-culture they are what persuades the hepatocytes to stay cuboidal, keep their enzymes switched on and ' +
      'build a canalicular network that lasts weeks rather than days. Exactly which cells they are is proprietary. ' +
      'In plain monoculture there is nothing else in the well at all.',
    facts: [['in TruVivo', 'stromal + endothelial'], ['in 2D PHH', 'none']],
  },
  {
    id: PART.collagen,
    key: 'collagen',
    name: 'Collagen I',
    kind: 'the floor',
    text:
      'The coating on the bottom of the well. A hepatocyte will not attach to bare polystyrene; it needs something ' +
      'its integrins recognise. In a sandwich culture a second layer of matrix goes on top four to twenty-four ' +
      'hours after plating, and being held from both sides is what keeps the cell cuboidal and polarised instead ' +
      'of letting it spread out flat.',
  },
  {
    id: PART.medium,
    key: 'medium',
    name: 'Culture medium',
    kind: 'the well',
    text:
      'Buffered salts, glucose, amino acids, insulin, dexamethasone and whatever else the protocol calls for, sitting ' +
      'two or three millimetres deep over the cells. The compound is in here, at the concentration on the label, and ' +
      'one detail of the recipe decides whole experiments: swap the glucose for galactose and the cells can no ' +
      'longer make ATP by glycolysis, so anything that damages mitochondria suddenly kills them. That one swap is ' +
      'how a mitochondrial liability is unmasked.',
    facts: [['depth', '~2–3 mm'], ['glucose → galactose', 'unmasks mitochondrial toxicity']],
  },
  {
    id: PART.well,
    key: 'well',
    name: 'A well',
    kind: 'the plate',
    text:
      'One of ninety-six. Six and a half millimetres across, holding a couple of hundred microlitres, with somewhere ' +
      'between twenty and a hundred thousand cells on the bottom of it. Every well on this plate is one ' +
      'compound at one concentration: twelve compounds across the columns, and down each column a dilution series ' +
      'from high at the top to nothing at all in row H.',
    facts: [['across', '6.4 mm'], ['volume', '100–250 µL'], ['cells', '20k–100k']],
  },
  {
    id: PART.plate,
    key: 'plate',
    name: '96-well plate',
    kind: 'the plate',
    text:
      'A hundred and twenty-eight millimetres by eighty-five, a standard the whole field agreed on so that robots ' +
      'could handle it. Eight rows, twelve columns, nine millimetres between centres. Everything about how a ' +
      'toxicity screen is designed — one compound per column, a dose series down the rows, controls at the ' +
      'edges — is a consequence of this rectangle.',
    facts: [['footprint', '127.8 × 85.5 mm'], ['pitch', '9 mm'], ['rows × columns', '8 × 12']],
  },
  {
    id: PART.neighbour,
    key: 'neighbour',
    name: 'The cell next door',
    kind: 'the monolayer',
    text:
      'How the dying is distributed is itself a readout. Necrosis spreads: a cell that bursts spills its contents ' +
      'onto its neighbours, and you get contiguous patches of dead cells. Apoptosis does not: the dying cells are ' +
      'scattered singles among perfectly healthy neighbours, because each one is taken apart tidily and wrapped ' +
      'before anything leaks. You can tell the two apart from across the well without a single stain.',
  },
];

export const partById = new Map(PARTS.map((p) => [p.id, p]));
export const partByKey = new Map(PARTS.map((p) => [p.key, p]));
