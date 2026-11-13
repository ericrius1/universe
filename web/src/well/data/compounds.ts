// The twelve tool compounds, as a working pharmacodynamic model rather than a table of prose: each one says which
// lesions it causes, how hard (an EC50 on each axis), how fast, and whether the cell has to metabolise it first.
// The world reads the axes — nothing in the renderer knows a compound's name.
//
// The numbers are the ones these compounds are used at in cultured human hepatocytes, from the literature; where
// sources disagree (they often do, by a factor of two or three) the value here is the middle of the published range
// and the note says so. This is a teaching model of a cell culture, not a prediction of anything.

/** every lesion the cell can show. 0 = none, 1 = as far as this axis goes. */
export interface Axes {
  /** glutathione drawn down (mBCl goes dark) */
  gsh: number;
  /** mitochondrial membrane potential lost (TMRM washes out) */
  depol: number;
  /** mitochondria round up, matrix clears, cristae rarefy */
  swell: number;
  /** the mitochondrial network breaks into short rods and dots */
  frag: number;
  /** reactive oxygen (CellROX) */
  ros: number;
  /** ATP gone */
  atpLoss: number;
  /** neutral lipid droplets (BODIPY / LipidTOX) */
  lipid: number;
  /** droplets small and many rather than few and large */
  micro: number;
  /** phospholipidosis: lamellar bodies in swollen lysosomes */
  pld: number;
  /** ER cisternae distended, ribosomes shed, Golgi dispersed */
  erStress: number;
  /** the bile canaliculus constricted and its rhythm stopped */
  constrict: number;
  /** canalicular efflux lost (CDF no longer fills the lumen) */
  effluxLoss: number;
  /** executioner caspases active */
  caspase: number;
  /** chromatin condensed, then the nucleus broken into pieces */
  condense: number;
  /** the opposite: the nucleus pale and swollen, detail lost */
  karyolysis: number;
  /** blebbing — dynamic (apoptotic) rides on `caspase`, still blebs on `oncosis` */
  oncosis: number;
  /** plasma membrane gone (PI / SYTOX in, LDH out) */
  leak: number;
  /** DNA damage: foci in the nucleoplasm, then micronuclei */
  dna: number;
  /** lysosomes swollen, then leaking */
  lyso: number;
}

export const AXES: (keyof Axes)[] = [
  'gsh', 'depol', 'swell', 'frag', 'ros', 'atpLoss', 'lipid', 'micro', 'pld', 'erStress',
  'constrict', 'effluxLoss', 'caspase', 'condense', 'karyolysis', 'oncosis', 'leak', 'dna', 'lyso',
];

export const zeroAxes = (): Axes => Object.fromEntries(AXES.map((a) => [a, 0])) as unknown as Axes;

/** one lesion of one compound: how much of it, at what concentration, how fast, after how long a wait */
interface Lesion {
  /** the axis it moves */
  on: keyof Axes;
  /** the concentration (µM) at which it reaches half of `max` */
  ec50: number;
  /** how far it goes at saturating concentration (0..1) */
  max: number;
  /** the time constant in hours: the lesion is 63% of the way there after this long */
  tau: number;
  /** hours before anything happens at all */
  lag?: number;
  /** Hill slope; steep (4+) for the all-or-nothing ones */
  n?: number;
  /** this lesion needs a metabolite: it scales with the culture's remaining CYP activity */
  needsCyp?: boolean;
  /** the lesion peaks and then falls back as the cell dies and the signal is lost (accumulation readouts) */
  bell?: boolean;
}

export interface Compound {
  id: string;
  name: string;
  /** what it is used for in a screen */
  role: string;
  /** the class in two or three words */
  klass: string;
  /** the mechanism, as a paragraph */
  mech: string;
  /** what you see, in order, as a paragraph */
  look: string;
  /** how the cell ends */
  death: string;
  /** the usual concentrations and exposure */
  dosing: string;
  /** the readouts it lights up, in the order they move */
  channels: string[];
  /** does it need to be metabolised first */
  cyp: 'none' | 'partly' | 'yes' | 'absolutely';
  /** a short line for the chip and the plate */
  blurb: string;
  /** the concentration series down the plate's rows, µM, high to low, the last one vehicle */
  series: number[];
  /** the colour the plate and the readouts use for it */
  hue: number;
  lesions: Lesion[];
  /** what a long-lived, metabolically competent culture shows that a two-day 2D culture misses */
  modelNote: string;
}

const ser = (top: number, steps = 7): number[] => {
  // a half-log series down from the top concentration, and vehicle in the last row
  const out: number[] = [];
  for (let i = 0; i < steps; i++) out.push(top / Math.pow(10, i * 0.5));
  out.push(0);
  return out;
};

export const COMPOUNDS: Compound[] = [
  {
    id: 'vehicle',
    name: 'Vehicle',
    klass: 'DMSO 0.1%',
    role: 'The control. Nothing is added but the solvent everything else arrives in.',
    mech:
      'Dimethyl sulfoxide is what the other twelve are dissolved in, so every well gets the same 0.1% of it and the ' +
      'control wells get only that. Past about 0.5% it induces CYP2E1 and starts to matter on its own, which is why ' +
      'the whole plate is held at or under 0.1%.',
    look:
      'A hepatocyte at rest: polygonal, 20–40 µm across, flattened to five or ten micrometres in 2D culture. One or ' +
      'two round nuclei with a bright nucleolus; between a tenth and a third of the cells carry two. Eight hundred to ' +
      'two thousand mitochondria, each half a micrometre to one and a half, oval, cristae stacked tight, joined into a ' +
      'loose network. Rough ER in ribosome-studded stacks around the nucleus, smooth ER threading fields of glycogen ' +
      'rosettes. A few hundred peroxisomes and as many lysosomes, the lysosomes crowded near the bile canaliculus. ' +
      'And the canaliculus itself: a lumen between neighbouring cells, under a micrometre across, lined with stubby ' +
      'microvilli, ringed by an actin belt, sealed by tight junctions — and squeezing shut and opening again every ' +
      'twenty or thirty minutes, all by itself. That rhythm is the surest sign a culture is alive and still polarised.',
    death: 'None. Over days in 2D the cells simply forget what they were.',
    dosing: '0.1% v/v in every well',
    channels: [],
    cyp: 'none',
    blurb: 'the control',
    series: [0, 0, 0, 0, 0, 0, 0, 0],
    hue: 150,
    lesions: [],
    modelNote:
      'The vehicle well is where the two systems differ most plainly, with nothing added at all: by 72 hours the 2D ' +
      'culture has lost most of its CYP activity, flattened, and let its canaliculi go, while the co-culture is still ' +
      'making albumin and urea and still pulsing.',
  },
  {
    id: 'apap',
    name: 'Acetaminophen',
    klass: 'reactive metabolite · necrosis',
    role: 'The reference for toxicity that the cell makes itself — the parent molecule is nearly harmless.',
    mech:
      'CYP2E1, with help from 1A2 and 3A4, turns a small fraction of it into NAPQI, a quinone imine that glutathione ' +
      'mops up. While there is glutathione to spare nothing happens. Past about 80% depletion, NAPQI starts binding ' +
      'mitochondrial proteins instead — glutamate dehydrogenase, aldehyde dehydrogenase, the ATP synthase α subunit. ' +
      'Superoxide and nitric oxide make peroxynitrite; JNK is phosphorylated and moves to Sab on the outer ' +
      'mitochondrial membrane, which amplifies the whole thing; and the permeability transition pore opens.',
    look:
      'For the first hour or two, nothing you could photograph — only the glutathione probe going dark. Then the ' +
      'mitochondria round up, their matrix clears, the cristae rarefy and go. Glycogen fields dissolve; the ER ' +
      'vesiculates. The cell swells rather than shrinks, and throws large clear blebs that sit there instead of ' +
      'churning. The canaliculus collapses. The nucleus goes pale and swollen and loses its detail — karyolysis, the ' +
      'opposite of what an apoptotic nucleus does. Then the blebs burst, and the dead cells are in contiguous ' +
      'patches, not scattered singles.',
    death: 'Oncotic necrosis. Caspase-3/7 stays flat, which is how you tell it from staurosporine.',
    dosing: '1–20 mM for 24–48 h; TC50 in plated human hepatocytes is around 4–8 mM. Human cells peak at about 48 h.',
    channels: ['GSH (mBCl)', 'CellROX', 'TMRM', 'ATP', 'Hoechst area', 'PI / LDH'],
    cyp: 'yes',
    blurb: 'GSH → mitochondria → necrosis',
    series: ser(20000),
    hue: 22,
    lesions: [
      { on: 'gsh', ec50: 2200, max: 1, tau: 3, n: 2, needsCyp: true },
      { on: 'ros', ec50: 5000, max: 0.85, tau: 6, lag: 2, needsCyp: true },
      { on: 'depol', ec50: 5200, max: 1, tau: 8, lag: 3, n: 3, needsCyp: true },
      { on: 'swell', ec50: 5200, max: 1, tau: 9, lag: 3, n: 3, needsCyp: true },
      { on: 'atpLoss', ec50: 5600, max: 1, tau: 11, lag: 4, n: 3, needsCyp: true },
      { on: 'erStress', ec50: 7000, max: 0.5, tau: 12, lag: 5, needsCyp: true },
      { on: 'constrict', ec50: 6500, max: 0.7, tau: 12, lag: 6, needsCyp: true },
      { on: 'effluxLoss', ec50: 6500, max: 0.9, tau: 12, lag: 6, needsCyp: true },
      { on: 'oncosis', ec50: 6000, max: 1, tau: 12, lag: 6, n: 3, needsCyp: true },
      { on: 'karyolysis', ec50: 6200, max: 1, tau: 14, lag: 7, n: 3, needsCyp: true },
      { on: 'leak', ec50: 6400, max: 1, tau: 16, lag: 9, n: 4, needsCyp: true },
    ],
    modelNote:
      'This is the compound that most punishes a culture for forgetting its enzymes. In cells that have been in 2D ' +
      'for three days, millimolar concentrations are needed before anything moves, because there is little CYP2E1 ' +
      'left to make NAPQI. Keep the cells competent and the same lesion appears lower and sooner.',
  },
  {
    id: 'amiodarone',
    name: 'Amiodarone',
    klass: 'cationic amphiphile · phospholipidosis',
    role: 'The reference for a lesion that is not death: the cell fills with membrane it cannot digest.',
    mech:
      'A weak base with a greasy tail. It diffuses in neutral, is protonated inside the acid lysosome and cannot ' +
      'leave, so it concentrates there hundreds of times over. Trapped, it inhibits lysosomal phospholipase A and ' +
      'binds the phospholipids themselves into complexes no enzyme will touch. Separately it inhibits carnitine ' +
      'palmitoyltransferase-1 and so fatty-acid oxidation, inhibits the respiratory chain, and turns lipogenic genes ' +
      'up. Its CYP3A4 metabolite, mono-N-desethylamiodarone, is worse than the parent.',
    look:
      'Within hours the lysosomes swell and brighten. By a day or two they are full of lamellar bodies — half a ' +
      'micrometre to two across, concentric whorls of membrane wound like the rings of a tree — and myelin figures ' +
      'spill between them. At the same time neutral lipid droplets appear, small and many at first. The mitochondria ' +
      'swell and lose cristae, and at higher concentrations the ER dilates. The cell is visibly loaded long before ' +
      'it is dying.',
    death: 'Phospholipidosis itself is sub-lethal. Necrosis and apoptosis follow only above roughly 30–50 µM.',
    dosing: '1–10 µM over 48 h for the phospholipidosis; 20–100 µM before cells die.',
    channels: ['LipidTOX phospholipidosis', 'BODIPY neutral lipid', 'TMRM', 'ATP'],
    cyp: 'partly',
    blurb: 'lamellar bodies, then droplets',
    series: ser(100),
    hue: 265,
    lesions: [
      { on: 'lyso', ec50: 2.2, max: 1, tau: 6, n: 1.6 },
      { on: 'pld', ec50: 3.2, max: 1, tau: 14, lag: 2, n: 1.8 },
      { on: 'lipid', ec50: 7, max: 0.85, tau: 16, lag: 3, bell: true },
      { on: 'micro', ec50: 7, max: 0.75, tau: 10, lag: 3 },
      { on: 'depol', ec50: 26, max: 0.9, tau: 10, n: 2, needsCyp: true },
      { on: 'swell', ec50: 30, max: 0.8, tau: 12, n: 2 },
      { on: 'ros', ec50: 34, max: 0.6, tau: 10 },
      { on: 'erStress', ec50: 48, max: 0.6, tau: 14 },
      { on: 'atpLoss', ec50: 45, max: 0.9, tau: 16, lag: 4, n: 2.5 },
      { on: 'caspase', ec50: 52, max: 0.6, tau: 14, lag: 6, n: 3 },
      { on: 'oncosis', ec50: 58, max: 0.8, tau: 18, lag: 8, n: 3 },
      { on: 'leak', ec50: 60, max: 1, tau: 20, lag: 10, n: 3 },
    ],
    modelNote:
      'Lamellar bodies have been photographed by electron microscopy in long-lived three-dimensional liver cultures ' +
      'at 2.5–10 µM where flat two-day cultures showed none at all: the lesion needs time to accumulate, and a ' +
      'two-day assay does not give it any.',
  },
  {
    id: 'valproate',
    name: 'Valproic acid',
    klass: 'fatty acid · microvesicular steatosis',
    role: 'The reference for a cell that is unmistakably sick and barely dying at all.',
    mech:
      'A branched short-chain fatty acid. It sequesters coenzyme A and carnitine; its 4-ene and 2,4-dien metabolites ' +
      'inhibit β-oxidation enzymes and drain mitochondrial glutathione; and it inhibits histone deacetylases. How ' +
      'much of the fat is a blocked exit and how much is a widened entrance is actively argued — recent work in ' +
      'human hepatocytes puts more of it on increased fatty-acid uptake through NRF2 and FATP2 and on triglyceride ' +
      'synthesis than on the oxidation block.',
    look:
      'By a day at millimolar concentrations the cytoplasm is crowded with small uniform droplets, well under a ' +
      'micrometre each, filling the cell while the nucleus stays where it is — the microvesicular pattern, quite ' +
      'unlike the single fat globule that shoves a nucleus aside. The mitochondria round and swell with a cleared ' +
      'matrix. Glycogen falls. Over a week or two of repeated dosing the droplets coalesce toward larger ones, and ' +
      'still very little dies.',
    death: 'Almost none in the therapeutic range; necrosis only past 5–10 mM.',
    dosing: '0.1–1 mM dosed again and again over 14 days; 1–10 mM for a 24-hour acute read.',
    channels: ['BODIPY neutral lipid', 'TMRM', 'ATP (flat)', 'LDH (flat)'],
    cyp: 'partly',
    blurb: 'fat, and almost no death',
    series: ser(10000),
    hue: 46,
    lesions: [
      { on: 'lipid', ec50: 420, max: 1, tau: 20, n: 1.6, needsCyp: true },
      { on: 'micro', ec50: 420, max: 1, tau: 12, n: 1.6 },
      { on: 'swell', ec50: 1500, max: 0.7, tau: 18, n: 1.6 },
      { on: 'depol', ec50: 2600, max: 0.55, tau: 18, n: 1.6 },
      { on: 'gsh', ec50: 2400, max: 0.6, tau: 16, needsCyp: true },
      { on: 'ros', ec50: 3400, max: 0.45, tau: 16 },
      { on: 'atpLoss', ec50: 6500, max: 0.8, tau: 20, lag: 6, n: 2.5 },
      { on: 'oncosis', ec50: 8000, max: 0.8, tau: 24, lag: 10, n: 3 },
      { on: 'leak', ec50: 8500, max: 0.9, tau: 26, lag: 12, n: 3 },
    ],
    modelNote:
      'A compound that needs to be given again and again. A single 24-hour dose at a concentration anyone would call ' +
      'relevant does very little; two weeks of repeat dosing at a third of a millimolar fills the cells with fat. ' +
      'Only a culture that lives that long can be asked the question.',
  },
  {
    id: 'cyclosporin',
    name: 'Cyclosporin A',
    klass: 'transporter inhibitor · cholestasis',
    role: 'The reference for a blocked bile export pump.',
    mech:
      'It inhibits BSEP, the pump that puts bile acids into the canaliculus, and MRP2 and NTCP with it, so bile acids ' +
      'build up inside the cell. It also activates Rho kinase, which keeps myosin light chain 2 phosphorylated and ' +
      'the actin ring round the canaliculus permanently tight. It induces the unfolded protein response and ' +
      'oxidative stress, and inhibits respiration in the tens of micromolar. Worth saying plainly, because it is ' +
      'easy to get backwards: cyclosporin binds cyclophilin D and *blocks* the mitochondrial permeability ' +
      'transition. It is not a pore opener.',
    look:
      'Within an hour or three the canaliculi constrict — narrow, kinked lumens with a thickened actin ring — and ' +
      'the spontaneous opening and closing stops dead. The fluorescent bile-acid analogue no longer fills the lumen. ' +
      'Over a day or two bile acids accumulate inside, the ER dilates, droplets appear, mitochondria swell.',
    death: 'Apoptosis and necrosis, but only well above the concentration that shuts the canaliculus.',
    dosing: '50 µM for 3–4 h for the acute canalicular picture; 1–10 µM dosed repeatedly, ideally with bile acids added.',
    channels: ['CDF / CLF efflux', 'F-actin + ZO-1', 'canalicular area over time', 'CHOP / BiP', 'TMRM'],
    cyp: 'none',
    blurb: 'the canaliculus clamps shut',
    series: ser(100),
    hue: 196,
    lesions: [
      { on: 'constrict', ec50: 4.5, max: 1, tau: 1.4, n: 2 },
      { on: 'effluxLoss', ec50: 5.5, max: 1, tau: 2.2, n: 2 },
      { on: 'erStress', ec50: 16, max: 0.8, tau: 10, lag: 2 },
      { on: 'ros', ec50: 22, max: 0.6, tau: 10 },
      { on: 'lipid', ec50: 28, max: 0.5, tau: 16, lag: 4 },
      { on: 'swell', ec50: 40, max: 0.7, tau: 14, lag: 3 },
      { on: 'depol', ec50: 48, max: 0.7, tau: 14, lag: 3 },
      { on: 'caspase', ec50: 62, max: 0.8, tau: 14, lag: 6, n: 3 },
      { on: 'condense', ec50: 64, max: 0.9, tau: 16, lag: 7, n: 3 },
      { on: 'leak', ec50: 80, max: 0.8, tau: 24, lag: 14, n: 3 },
    ],
    modelNote:
      'The canaliculus has to exist before you can block it. In a flat culture without a Matrigel overlay there is ' +
      'barely any canalicular network to look at, and the most informative readout this compound has — the lumen ' +
      'squeezing shut and never opening again — simply is not there to be measured.',
  },
  {
    id: 'chlorpromazine',
    name: 'Chlorpromazine',
    klass: 'phenothiazine · cholestasis',
    role: 'Cholestasis by a different route: the cytoskeleton, not the pump.',
    mech:
      'It roughly doubles Rho kinase activity, which keeps myosin light chain 2 phosphorylated and the pericanalicular ' +
      'actin ring contracted. What makes it the instructive twin of cyclosporin is what it does not do: it does not ' +
      'inhibit the bile-acid pump. The lesion is mechanical. On top of that it is a cationic amphiphile like ' +
      'amiodarone, so lysosomes load up, and oxidative stress carries a good deal of the damage.',
    look:
      'Inside an hour the contraction rhythm stops and the canaliculi constrict and kink. By three or four hours the ' +
      'lumen no longer clears its dye. By a day there are lamellar bodies in the lysosomes, reactive oxygen, ' +
      'depolarised mitochondria, droplets, and cells starting to round up.',
    death: 'Mixed apoptosis and necrosis above roughly 25 µM.',
    dosing: '50 µM for 3–4 h acutely; cytotoxic in human hepatocytes around 9 µM (reports span 3–35); 0.1–0.2 µM for 14-day repeat dosing.',
    channels: ['CDF / CLF efflux', 'F-actin', 'LipidTOX phospholipidosis', 'CellROX', 'TMRM', 'PI'],
    cyp: 'none',
    blurb: 'cholestasis without touching the pump',
    series: ser(50),
    hue: 212,
    lesions: [
      { on: 'constrict', ec50: 3.5, max: 1, tau: 0.8, n: 2 },
      { on: 'effluxLoss', ec50: 6, max: 0.85, tau: 3, n: 2 },
      { on: 'lyso', ec50: 6, max: 0.9, tau: 8 },
      { on: 'pld', ec50: 9, max: 0.8, tau: 16, lag: 3 },
      { on: 'ros', ec50: 8, max: 0.95, tau: 8 },
      { on: 'depol', ec50: 11, max: 0.9, tau: 10, n: 2 },
      { on: 'swell', ec50: 13, max: 0.8, tau: 12 },
      { on: 'lipid', ec50: 14, max: 0.6, tau: 16, lag: 4 },
      { on: 'atpLoss', ec50: 15, max: 0.9, tau: 14, lag: 4, n: 2.5 },
      { on: 'caspase', ec50: 16, max: 0.7, tau: 14, lag: 6, n: 3 },
      { on: 'condense', ec50: 17, max: 0.8, tau: 15, lag: 7, n: 3 },
      { on: 'oncosis', ec50: 22, max: 0.8, tau: 18, lag: 8, n: 3 },
      { on: 'leak', ec50: 20, max: 1, tau: 20, lag: 9, n: 3 },
    ],
    modelNote:
      'Put the two cholestatic compounds side by side and the difference is visible: both clamp the canaliculus, ' +
      'only cyclosporin also stops the pump. Repeat-dose work runs this one at a couple of hundred nanomolar for ' +
      'two weeks — two hundred times below its acute concentration — which again needs a culture that lasts.',
  },
  {
    id: 'troglitazone',
    name: 'Troglitazone',
    klass: 'withdrawn drug · mixed mechanism',
    role: 'The compound everyone benchmarks against, because nothing before it caught it.',
    mech:
      'Several things at once, which is the point. The parent drug drops the mitochondrial membrane potential within ' +
      'minutes and inhibits respiration; it opens the permeability transition and overproduces hydrogen peroxide; ' +
      'CYP3A4 makes quinone and epoxide metabolites; and sulfotransferase makes troglitazone sulfate, which is a ' +
      'competitive inhibitor of the bile-acid pump and is the more toxic species of the two.',
    look:
      'Mitochondria first, and early: they depolarise and swell before anything else has moved. Over the first day ' +
      'the canalicular network regresses and stops clearing its dye, the ER stresses, droplets appear, reactive ' +
      'oxygen rises. Then rounding, blebbing, and the slide into secondary necrosis.',
    death: 'Apoptosis, then secondary necrosis.',
    dosing: '10–100 µM over 24–48 h. In one human liver cell line the parent is toxic at 41 µM and its sulfate at 22 µM.',
    channels: ['TMRM (first)', 'CellROX', 'GSH', 'CDF', 'caspase-3/7', 'ATP', 'LDH'],
    cyp: 'yes',
    blurb: 'mitochondria and the pump together',
    series: ser(100),
    hue: 338,
    lesions: [
      { on: 'depol', ec50: 13, max: 1, tau: 1.6, n: 2 },
      { on: 'swell', ec50: 16, max: 0.95, tau: 4 },
      { on: 'ros', ec50: 18, max: 0.9, tau: 5 },
      { on: 'gsh', ec50: 24, max: 0.8, tau: 8, needsCyp: true },
      { on: 'effluxLoss', ec50: 20, max: 0.9, tau: 8, needsCyp: true },
      { on: 'constrict', ec50: 26, max: 0.6, tau: 10, lag: 2, needsCyp: true },
      { on: 'erStress', ec50: 30, max: 0.7, tau: 10, lag: 2 },
      { on: 'lipid', ec50: 34, max: 0.6, tau: 14, lag: 4 },
      { on: 'atpLoss', ec50: 28, max: 1, tau: 10, lag: 2, n: 2.5 },
      { on: 'caspase', ec50: 30, max: 1, tau: 10, lag: 4, n: 3, needsCyp: true },
      { on: 'condense', ec50: 32, max: 1, tau: 12, lag: 5, n: 3 },
      { on: 'frag', ec50: 22, max: 0.8, tau: 8, lag: 2 },
      { on: 'leak', ec50: 38, max: 0.9, tau: 20, lag: 12, n: 3 },
    ],
    modelNote:
      'Two separate lesions, each on its own too mild to notice, in a liver that is already carrying the other. ' +
      'Every mechanism-first screen now in use was built partly so that this compound would not get through again.',
  },
  {
    id: 'rotenone',
    name: 'Rotenone',
    klass: 'complex I inhibitor',
    role: 'The clean mitochondrial positive control, and half of the glucose/galactose test.',
    mech:
      'It binds the ubiquinone site of complex I and stops it. NADH cannot be oxidised, the proton pumps upstream ' +
      'stall, and electrons leak off the flavin as superoxide. Nothing else is touched.',
    look:
      'Within minutes the potential falls and the mitochondria round up. Over the first hours the network comes ' +
      'apart into short rods and then dots; matrices swell, cristae go; reactive oxygen rises. What happens next ' +
      'depends entirely on the sugar in the medium: in glucose the cell switches to glycolysis and carries on almost ' +
      'unchanged, and in galactose, where it cannot, ATP collapses and the cell swells, blebs and bursts.',
    death: 'Necrosis in galactose. Next to nothing in glucose — which is the experiment.',
    dosing: '0.1–10 µM for 2–24 h; ATP falls with an IC50 near 0.17 µM in galactose-grown liver cells.',
    channels: ['TMRM', 'CellROX', 'ATP in galactose vs glucose', 'LDH'],
    cyp: 'none',
    blurb: 'complex I, and the sugar switch',
    series: ser(10),
    hue: 10,
    lesions: [
      { on: 'depol', ec50: 0.12, max: 1, tau: 0.4, n: 2.5 },
      { on: 'swell', ec50: 0.2, max: 0.9, tau: 2 },
      { on: 'frag', ec50: 0.2, max: 1, tau: 2.5 },
      { on: 'ros', ec50: 0.2, max: 1, tau: 1.5 },
      { on: 'atpLoss', ec50: 0.5, max: 0.75, tau: 6, n: 2 },
      { on: 'oncosis', ec50: 1.6, max: 0.7, tau: 16, lag: 8, n: 3 },
      { on: 'leak', ec50: 2.2, max: 0.7, tau: 20, lag: 10, n: 3 },
    ],
    modelNote:
      'Mechanism-pure, so it behaves the same in any culture. It is in the plate as a ruler: whatever TMRM does ' +
      'here is what full depolarisation looks like on this instrument today.',
  },
  {
    id: 'fccp',
    name: 'FCCP',
    klass: 'protonophore · uncoupler',
    role: 'The depolarisation control. Every TMRM assay ends with a well of this.',
    mech:
      'It carries protons straight across the inner membrane, so the gradient the electron chain works to build ' +
      'simply drains away. The potential collapses in seconds. Respiration goes flat out and achieves nothing; the ' +
      'ATP synthase runs backwards and hydrolyses ATP instead of making it; AMP kinase notices.',
    look:
      'Seconds. The potential-sensitive dye washes out of the mitochondria into the cytosol — the fastest visible ' +
      'event in the whole plate. Within minutes the matrices swell and the cristae unstack; within the hour the ' +
      'network is fragmented into spheres, and mitophagy starts collecting them. The nucleus and the canaliculus ' +
      'stay perfectly normal, which is worth seeing: a cell can be in bioenergetic ruin and look structurally fine.',
    death: 'None at 1 µM, which is how it is usually used. Necrosis at high doses over hours.',
    dosing: '1–10 µM; 10 µM is the standard depolarising control.',
    channels: ['TMRM (definitive)', 'ATP', 'mitochondrial form factor', 'PI (high dose only)'],
    cyp: 'none',
    blurb: 'the potential, gone in seconds',
    series: ser(10),
    hue: 2,
    lesions: [
      { on: 'depol', ec50: 0.35, max: 1, tau: 0.05, n: 3 },
      { on: 'swell', ec50: 0.8, max: 0.85, tau: 0.5 },
      { on: 'frag', ec50: 0.9, max: 1, tau: 1 },
      { on: 'atpLoss', ec50: 2.4, max: 0.85, tau: 3, n: 2 },
      { on: 'ros', ec50: 3, max: 0.35, tau: 4 },
      { on: 'oncosis', ec50: 7, max: 0.6, tau: 18, lag: 8, n: 3 },
      { on: 'leak', ec50: 8, max: 0.6, tau: 22, lag: 12, n: 3 },
    ],
    modelNote:
      'Identical in both systems. It is the zero on the potential scale.',
  },
  {
    id: 'staurosporine',
    name: 'Staurosporine',
    klass: 'kinase inhibitor · apoptosis',
    role: 'The apoptosis positive control, and the clearest counterexample to acetaminophen.',
    mech:
      'A broad kinase inhibitor that hits protein kinase C and a great many others. Bax and Bak open the ' +
      'mitochondria, cytochrome c comes out, caspase-9 cleaves caspase-3 and -7. In hepatocytes both the -8 and -9 ' +
      'arms show up, and some of the killing is caspase-independent besides.',
    look:
      'The cell retracts and rounds, giving up its polygonal spread, within a few hours. The mitochondrial network ' +
      'fragments and lets cytochrome c go; the caspase reporter lights up between six and sixteen hours. The nucleus ' +
      'shrinks, the chromatin condenses into bright lumps against the envelope, and then breaks into separate ' +
      'pieces. The membrane blebs — but these blebs boil, churning and retracting, and pinch off as apoptotic bodies, ' +
      'quite unlike the slow swelling bulges of a necrotic cell. Phosphatidylserine flips to the outside while the ' +
      'membrane is still intact and the dye still shut out. Only late, past sixteen hours, does the membrane finally ' +
      'fail. And the dying cells are scattered singles among healthy neighbours, not a patch.',
    death: 'Apoptosis, the textbook example, then secondary necrosis.',
    dosing: '0.1–2 µM, usually 1 µM, over 4–24 h. Hepatocytes are less easily pushed into it than lymphoid lines.',
    channels: ['caspase-3/7', 'Hoechst condensation', 'annexin V', 'TMRM', 'PI (late)'],
    cyp: 'none',
    blurb: 'apoptosis, scattered and tidy',
    series: ser(3),
    hue: 288,
    lesions: [
      { on: 'frag', ec50: 0.09, max: 0.95, tau: 3, lag: 1 },
      { on: 'depol', ec50: 0.12, max: 0.85, tau: 4, lag: 1 },
      { on: 'caspase', ec50: 0.1, max: 1, tau: 4, lag: 2, n: 2.5 },
      { on: 'condense', ec50: 0.12, max: 1, tau: 5, lag: 3, n: 2.5 },
      { on: 'atpLoss', ec50: 0.4, max: 0.7, tau: 12, lag: 6 },
      { on: 'leak', ec50: 0.3, max: 0.85, tau: 14, lag: 12, n: 2.5 },
    ],
    modelNote:
      'Death that is paid for and tidied up. Identical in both systems, since no enzyme is needed to turn it on.',
  },
  {
    id: 'tunicamycin',
    name: 'Tunicamycin',
    klass: 'glycosylation inhibitor · ER stress',
    role: 'The reference for the unfolded protein response.',
    mech:
      'It inhibits the enzyme that puts the first sugar on a nascent N-linked glycan. Glycoproteins that cannot be ' +
      'glycosylated cannot fold, and a hepatocyte, which exports protein for a living, has a great many of them. The ' +
      'misfolded load trips all three arms of the unfolded protein response: PERK through eIF2α to ATF4 and CHOP, ' +
      'IRE1α splicing XBP1, and ATF6.',
    look:
      'For the first hours, nothing to look at, only transcripts moving — BiP and ATF4 up by six hours, CHOP behind ' +
      'them. Then the ER cisternae distend and round out, ribosomes come off the rough ER so it goes smooth, whorls ' +
      'of ER appear, and the Golgi fragments and scatters. Secretion stalls, so lipid accumulates. Past a day CHOP ' +
      'has been on long enough to kill, and the cell condenses and blebs.',
    death: 'Apoptosis, with autophagy early on.',
    dosing: '0.1–10 µM over 6–48 h; 100 nM already induces strongly in hepatocytes.',
    channels: ['CHOP / BiP / XBP1', 'ER-tracker morphology', 'BODIPY lipid', 'caspase-3/7', 'ATP'],
    cyp: 'none',
    blurb: 'the ER swells and stalls',
    series: ser(10),
    hue: 172,
    lesions: [
      { on: 'erStress', ec50: 0.09, max: 1, tau: 8, lag: 2, n: 2 },
      { on: 'lipid', ec50: 0.3, max: 0.6, tau: 16, lag: 6 },
      { on: 'swell', ec50: 1.2, max: 0.6, tau: 16, lag: 8 },
      { on: 'depol', ec50: 1.6, max: 0.6, tau: 16, lag: 10 },
      { on: 'caspase', ec50: 0.8, max: 0.95, tau: 14, lag: 10, n: 2.5 },
      { on: 'condense', ec50: 0.9, max: 0.95, tau: 16, lag: 12, n: 2.5 },
      { on: 'atpLoss', ec50: 2, max: 0.75, tau: 18, lag: 12 },
      { on: 'leak', ec50: 2, max: 0.8, tau: 26, lag: 20, n: 2.5 },
    ],
    modelNote:
      'Needs no metabolism, but it needs a cell that is still exporting protein. A dedifferentiated culture that has ' +
      'largely stopped making albumin has less to lose and shows less.',
  },
  {
    id: 'aflatoxin',
    name: 'Aflatoxin B1',
    klass: 'genotoxicant · CYP-activated',
    role: 'The assay that proves a culture still has its enzymes. Nothing else in the plate is as unforgiving.',
    mech:
      'CYP3A4, with 1A2, turns it into the exo-8,9-epoxide, which attacks guanine in DNA. The adduct trips the ' +
      'damage-response kinases, p53 accumulates, p21 and BTG2 come up. Without that first step the molecule is ' +
      'essentially inert.',
    look:
      'At low concentrations, no organelle changes at all for hours — the whole event is in the nucleus. Between ' +
      'four and twenty-four hours, punctate γH2AX foci appear scattered through the nucleoplasm, a dozen or two ' +
      'per nucleus, each one a double-strand break being marked. p53 gathers. The nucleolus remodels and the nucleus ' +
      'enlarges. Over the following days, in any cell that tries to divide, micronuclei appear: small bright ' +
      'satellites beside the main nucleus, whole chromosomes or fragments that missed the boat. Only at high ' +
      'concentrations do the mitochondria and ER swell and the chromatin finally condense.',
    death: 'Arrest and senescence at low concentration; apoptosis at high.',
    dosing: '0.03–3 µM over 24 h, or a week of repeat dosing for a stronger signal, in a metabolically competent model.',
    channels: ['γH2AX foci', 'micronuclei', 'p53 / p21', 'Hoechst morphometry'],
    cyp: 'absolutely',
    blurb: 'invisible without CYP3A4',
    series: ser(3),
    hue: 88,
    lesions: [
      { on: 'dna', ec50: 0.22, max: 1, tau: 8, lag: 2, n: 2.2, needsCyp: true },
      { on: 'ros', ec50: 0.6, max: 0.5, tau: 12, needsCyp: true },
      { on: 'erStress', ec50: 1.6, max: 0.5, tau: 16, lag: 8, needsCyp: true },
      { on: 'swell', ec50: 1.8, max: 0.6, tau: 16, lag: 8, needsCyp: true },
      { on: 'depol', ec50: 2, max: 0.6, tau: 16, lag: 10, needsCyp: true },
      { on: 'caspase', ec50: 1.9, max: 0.8, tau: 18, lag: 12, n: 2.5, needsCyp: true },
      { on: 'condense', ec50: 2, max: 0.85, tau: 20, lag: 14, n: 2.5, needsCyp: true },
      { on: 'leak', ec50: 2.6, max: 0.7, tau: 30, lag: 22, n: 2.5, needsCyp: true },
    ],
    modelNote:
      'Put this compound on a culture that has been flat for three days and it does next to nothing, because there ' +
      'is almost no CYP3A4 left to turn it on. The same concentration on a culture that has kept its enzymes marks ' +
      'every nucleus. Nothing demonstrates the difference between the two systems as sharply.',
  },
  {
    id: 'diclofenac',
    name: 'Diclofenac',
    klass: 'NSAID · reactive metabolite',
    role: 'The idiosyncratic one: toxic in a dish only well above anything a person sees, and hard to predict.',
    mech:
      'Two reactive routes. UGT2B7 makes an acyl glucuronide that is protein-reactive and is then actively ' +
      'concentrated into the canaliculus, where it is most reactive of all. CYP2C9 and 3A4 make hydroxy metabolites ' +
      'that go on to quinone imines, which drain glutathione and redox-cycle. Both open the permeability transition, ' +
      'and in human hepatocytes the step that matters is a rise in cytosolic calcium rather than uncoupling. ' +
      'Lysosomes become leaky and talk to the mitochondria. There is mild pump inhibition and ER stress on top.',
    look:
      'Between two and six hours glutathione falls, the mitochondria depolarise and swell, reactive oxygen rises, ' +
      'and the acidic compartments dim as the lysosomes leak. Through the first day the cytoplasm vacuolates and the ' +
      'cells round up, and then the dose decides the ending: apoptotic blebbing and condensed chromatin in the ' +
      'middle of the range, oncotic swelling and lysis at the top of it. Repeat dosing degrades the canalicular ' +
      'network.',
    death: 'A dose-dependent switch from apoptosis to necrosis.',
    dosing: '100–1000 µM over 24–48 h; primary human hepatocytes are more sensitive than cell lines, roughly 50–300 µM.',
    channels: ['GSH (mBCl)', 'TMRM', 'CellROX', 'LysoTracker', 'caspase-3/7', 'PI / LDH', 'ATP'],
    cyp: 'yes',
    blurb: 'two reactive routes at once',
    series: ser(1000),
    hue: 320,
    lesions: [
      { on: 'gsh', ec50: 110, max: 0.95, tau: 4, needsCyp: true },
      { on: 'lyso', ec50: 160, max: 0.9, tau: 6, needsCyp: true },
      { on: 'depol', ec50: 150, max: 1, tau: 5, n: 2, needsCyp: true },
      { on: 'swell', ec50: 170, max: 0.9, tau: 7 },
      { on: 'ros', ec50: 160, max: 0.9, tau: 5, needsCyp: true },
      { on: 'erStress', ec50: 260, max: 0.6, tau: 12, lag: 4 },
      { on: 'effluxLoss', ec50: 300, max: 0.7, tau: 14, lag: 6, needsCyp: true },
      { on: 'atpLoss', ec50: 220, max: 1, tau: 10, lag: 3, n: 2.5 },
      { on: 'caspase', ec50: 240, max: 0.9, tau: 12, lag: 5, n: 3, needsCyp: true },
      { on: 'condense', ec50: 250, max: 0.8, tau: 14, lag: 6, n: 3 },
      { on: 'oncosis', ec50: 520, max: 0.9, tau: 16, lag: 7, n: 3 },
      { on: 'karyolysis', ec50: 560, max: 0.8, tau: 18, lag: 9, n: 3 },
      { on: 'leak', ec50: 420, max: 1, tau: 18, lag: 8, n: 3 },
    ],
    modelNote:
      'Positive in every long-lived three-dimensional model tested and easy to miss in a flat two-day one — it needs ' +
      'both the conjugating enzyme and the exporter that concentrates the product where it does its damage.',
  },
];

export const byId = (id: string) => COMPOUNDS.find((c) => c.id === id) ?? COMPOUNDS[0];

/** the twelve that go in the plate's columns (the vehicle is the bottom row of every one) */
export const PLATE_COLUMNS = COMPOUNDS.filter((c) => c.id !== 'vehicle');

const hill = (x: number, ec50: number, n: number) => {
  if (x <= 0) return 0;
  const a = Math.pow(x / ec50, n);
  return a / (1 + a);
};

export interface Exposure {
  compound: Compound;
  /** µM */
  dose: number;
  /** hours since dosing */
  hours: number;
  /** the culture's remaining CYP activity at this moment, 0..1 */
  cyp: number;
}

/** run a compound's lesions out to a moment in time and return where every axis stands */
export function axesFor(e: Exposure): Axes {
  const out = zeroAxes();
  for (const l of e.compound.lesions) {
    // a lesion that needs a metabolite only gets as much of the compound as the culture can still turn over,
    // and the fall-off is steeper than linear because the conjugating enzymes go with the oxidising ones
    const dose = l.needsCyp ? e.dose * (0.02 + 0.98 * Math.pow(e.cyp, 1.3)) : e.dose;
    const amount = l.max * hill(dose, l.ec50, l.n ?? 1.5);
    if (amount < 1e-4) continue;
    const t = Math.max(0, e.hours - (l.lag ?? 0));
    let progress = 1 - Math.exp(-t / l.tau);
    if (l.bell) {
      // an accumulation readout: it climbs, peaks, and falls away again as the cell that held it gives up
      const decay = 1 - Math.exp(-Math.max(0, t - l.tau * 3) / (l.tau * 2.5));
      progress *= 1 - 0.75 * decay;
    }
    out[l.on] = Math.min(1, out[l.on] + amount * progress);
  }
  return out;
}

/** how much of the population is still alive and attached */
export function viability(a: Axes): number {
  const killed = 1 - (1 - a.leak) * (1 - 0.75 * a.caspase) * (1 - 0.8 * a.oncosis);
  return Math.max(0, 1 - killed);
}

/** the single worst thing happening, for a one-line label */
export function dominant(a: Axes): { key: keyof Axes; label: string; value: number } {
  const named: [keyof Axes, string][] = [
    ['leak', 'membrane failure'],
    ['karyolysis', 'necrosis'],
    ['condense', 'apoptosis'],
    ['caspase', 'caspases active'],
    ['dna', 'DNA damage'],
    ['pld', 'phospholipidosis'],
    ['constrict', 'cholestasis'],
    ['lipid', 'steatosis'],
    ['erStress', 'ER stress'],
    ['atpLoss', 'ATP falling'],
    ['depol', 'depolarised'],
    ['gsh', 'glutathione down'],
    ['ros', 'oxidative stress'],
    ['lyso', 'lysosomes loaded'],
  ];
  let best: { key: keyof Axes; label: string; value: number } = { key: 'gsh', label: 'unremarkable', value: 0 };
  for (const [key, label] of named) {
    const v = a[key];
    if (v > best.value + 0.001) best = { key, label, value: v };
  }
  if (best.value < 0.12) return { key: best.key, label: 'unremarkable', value: best.value };
  return best;
}
