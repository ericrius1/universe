// The two culture systems you can stand in. Everything the world looks like, and everything a compound is able to
// do, follows from these: how the cells are arranged, who else is in the well, whether there is a bile canaliculus
// at all, and how much of the cell's own chemistry is still working on the day you dose it.

export interface System {
  id: 'phh2d' | 'truvivo';
  name: string;
  made: string;
  /** the line under the name */
  tag: string;
  /** the long description for the reader */
  about: string[];
  /** how long you can keep it, in days, and the day it is usually dosed */
  lifeDays: number;
  dosedOnDay: number;
  /** the longest exposure the system can be asked for, in hours */
  maxHours: number;
  /** CYP and conjugation activity as a fraction of a fresh hepatocyte, against days in culture */
  cypAt(dayInCulture: number): number;
  /** how much of a canalicular network there is, 0..1 */
  canaliculi: number;
  /** are there other kinds of cell in the well */
  feeders: boolean;
  /** cells spread flatter and wider over time in 2D; 1 = cuboidal, higher = more spread */
  spread: number;
  /** mean cell diameter, µm */
  cellSize: number;
  /** how strongly cells cluster into islands (0 = an even lawn, 1 = tight colonies) */
  colony: number;
  /** what you would notice, standing in it */
  inTheWell: string;
  /** the numbers for the panel */
  facts: [string, string][];
}

export const SYSTEMS: Record<System['id'], System> = {
  phh2d: {
    id: 'phh2d',
    name: '2D pooled PHH',
    made: 'pooled cryoplateable primary human hepatocytes, e.g. BioIVT LiverPool',
    tag: 'five or ten donors in one vial · about five days',
    about: [
      'Primary human hepatocytes taken from several donors and pooled — five or ten of them in the standard ' +
        'cryoplateable formats, more in suspension — so that one vial averages out the enormous variation between ' +
        'one person\'s liver and the next. The pool is assembled to hit target enzyme activities rather than ' +
        'thrown together, which is why a lot can be ordered against a specification.',
      'They are thawed, counted and plated onto collagen in 96- or 384-well plates, and four to twenty-four hours ' +
        'later many protocols lay a second layer of extracellular matrix over the top. That sandwich is what ' +
        'persuades the cells to stay cuboidal, keep their borders crisp and build bile pockets between ' +
        'themselves — without it they simply spread out and flatten.',
      'Then the clock starts. These cells are not dividing and they are not being held in place by anything they ' +
        'recognise, and they begin to forget what they were: within twenty-four hours a published proteomic ' +
        'comparison found about fourteen per cent of the detected proteome significantly changed. Cytochrome P450 ' +
        'activity falls steeply over the first two or three days, albumin and urea fall with it, polarity goes, and ' +
        'the cells creep toward a flattened, mesenchymal look. The sandwich delays this; it does not prevent it.',
      'So the assay is acute. Dose at 24 or 48 hours after plating, read at 24 or 48 hours after that, and get out. ' +
        'The lot is qualified to be confluent and viable at day five, and that is about the end of it.',
      'The cost shows up in the numbers you have to use. Acetaminophen in this system is studied at five, ten and ' +
        'twenty millimolar, because there is not enough CYP2E1 left to make much of the reactive metabolite that ' +
        'does the damage. Anything whose toxicity takes a week to build, or needs a working bile canaliculus, or ' +
        'needs an enzyme the culture has already shut down, is hard to see here at all.',
    ],
    lifeDays: 5,
    dosedOnDay: 1,
    maxHours: 72,
    cypAt: (d) => Math.max(0.1, 0.1 + 0.9 * Math.exp(-d / 1.1)),
    canaliculi: 0.22,
    feeders: false,
    spread: 1.55,
    cellSize: 34,
    colony: 0.12,
    inTheWell:
      'A single flat sheet of liver cells and nothing else alive in the well. Wide polygons packed edge to edge ' +
      'like paving, many of them with two nuclei, the borders going soft where the cells have begun to spread. ' +
      'Short blind pockets of canaliculus here and there between neighbours rather than a network that goes ' +
      'anywhere. Collagen underneath, medium above, and a clock running.',
    facts: [
      ['donors pooled', '5 or 10'],
      ['format', '96 / 384 / 1536-well'],
      ['usable', '~5 days'],
      ['dosed', '24–48 h after plating'],
      ['exposure', '24–48 h, single dose'],
      ['CYP at day 3', '~15% of fresh'],
      ['canaliculi', 'pockets, in sandwich only'],
    ],
  },
  truvivo: {
    id: 'truvivo',
    name: 'TruVivo',
    made: 'LifeNet Health LifeSciences — primary human hepatocytes with human feeder cells',
    tag: 'hepatocyte islands in a human feeder lawn · weeks',
    about: [
      'The same primary human hepatocytes, plated with primary human feeder cells — stromal and endothelial — and ' +
        'no animal feeder layer and no matrix overlay. The hepatocytes find each other and gather into compact ' +
        'colonies, islands of cuboidal cells sitting in a lawn of flatter, longer feeder cells that surround every ' +
        'one of them.',
      'What the company found, and published in 2023, is that this arrangement holds. Healthy morphology for a ' +
        'month or more. Extensive anastomosing networks of bile canaliculi — not pockets, networks — with tight ' +
        'junctions and gap junctions, established early and still working weeks later. Albumin, urea and basal ' +
        'phase I and II metabolism stable from about day five for at least a fortnight, and significantly higher ' +
        'than the same donors in a sandwich monoculture. Uptake transporters hold up too: a comparison at day eight ' +
        'put TruVivo at 61–100% of its starting transporter activity where plated hepatocytes alone ran 4–70%.',
      'That changes what you can ask. You dose on day seven, when the culture has settled, and you dose again every ' +
        'day for a week or more. A compound whose damage accumulates slowly has time to accumulate it. A compound ' +
        'that has to be turned into something else first meets a cell that can still do the turning. A compound ' +
        'that blocks bile export has a canaliculus to block.',
      'It is a 2D+ system, not an organ. The feeder cells are human but proprietary; much of the long-dated ' +
        'performance data sits in posters rather than papers; and independent comparisons against other long-lived ' +
        'formats are mixed. The honest claim is a monolayer-like culture that keeps being a liver cell for weeks ' +
        'instead of days, which for toxicity is most of what was missing.',
    ],
    lifeDays: 30,
    dosedOnDay: 7,
    maxHours: 336,
    cypAt: (d) => (d < 4 ? 0.78 + 0.05 * d : 0.92 - 0.004 * Math.max(0, d - 14)),
    canaliculi: 1,
    feeders: true,
    spread: 1,
    cellSize: 23,
    colony: 0.85,
    inTheWell:
      'Islands. Compact cuboidal hepatocytes packed into colonies, each colony ringed and separated by a lawn of ' +
      'longer, flatter human feeder cells that are plainly a different kind of thing. Running between the ' +
      'hepatocytes, a branching canalicular network that actually joins up — lumens meeting lumens, sealed along ' +
      'their length, pulsing open and shut on their own every twenty or thirty minutes.',
    facts: [
      ['cells in the well', 'PHH + human stromal + endothelial'],
      ['format', '96 / 384-well'],
      ['healthy morphology', '≥30 days'],
      ['function stable', 'day 5 → ≥2 weeks'],
      ['dosed', 'day 7, re-dosed daily'],
      ['exposure', '2–10+ days, repeat'],
      ['CYP at day 14', '~90% of fresh'],
      ['canaliculi', 'anastomosing network'],
    ],
  },
};

export const SYSTEM_LIST = [SYSTEMS.phh2d, SYSTEMS.truvivo];

/** the difference, as the reader shows it */
export const COMPARISON: [string, string, string][] = [
  ['What is in the well', 'Hepatocytes only, from a pool of five or ten donors.', 'Hepatocytes plus primary human stromal and endothelial feeder cells.'],
  ['Shape', 'Wide polygons, flattening and spreading as the days pass; borders blur without a matrix overlay.', 'Compact cuboidal cells gathered into discrete colonies in a feeder lawn.'],
  ['Bile canaliculi', 'Short blind pockets between neighbours, and only in a sandwich; they degrade.', 'A branching network with tight and gap junctions, stable and functional for weeks.'],
  ['Metabolic competence', 'High at thaw, most of it gone within two or three days.', 'Settles by day five and holds for a fortnight or more.'],
  ['How long it lives', 'About five days.', 'Four to six weeks.'],
  ['How you dose it', 'Once, 24 or 48 hours after plating; read at 24 or 48 hours.', 'From day seven, again every day, for a week to ten days.'],
  ['Acetaminophen', 'Needs millimolar — 5, 10, 20 mM — because little CYP2E1 is left to make NAPQI.', 'The same lesion at lower concentrations, because the enzyme is still there.'],
  ['Cholestatic compounds', 'Hard to see: there is barely a canaliculus to close.', 'Visible directly — the lumen clamps shut and stops clearing its dye.'],
  ['Slow, accumulating toxicity', 'Largely invisible in a two-day window.', 'Given a week or two, it accumulates where you can see it.'],
];
