// The molecules: real structures from the Protein Data Bank (pipeline/beads.py turned each into beads, one per residue,
// at three levels of detail) and a few built here — a DNA base pair, the nuclear pore complex, kinesin's parts, a
// vesicle. All packed into one bead buffer and a type table for the GPU, with the composition of every compartment:
// which molecules fill the cytosol, the nucleus, a mitochondrion's matrix; which sit in each kind of membrane.
import type { Kit, StorageBuffer } from '@ericrius1/weft';
import { vec3, type Vec3 } from 'math';
import { Rng } from './noise';
import { Kind } from './layout';

export interface MolInfo {
  name: string;
  pdb?: string;
  /** what it does, for the info card */
  blurb: string;
  /** base colour, second colour (RNA, a second part), per-chain variation */
  color: Vec3;
  color2: Vec3;
  spread: number;
  flags: number;
}
export const F_ROTOR = 1, F_MEMBRANE = 2, F_DNABP = 4, F_VESICLE = 8, F_GLOW = 16, F_FLAT = 32, F_TINT = 64;

// type ids: their order is the GPU's type index
export const MOLS = [
  'ribosome', 'gapdh', 'proteasome', 'calmodulin', 'trna', 'hexokinase', 'actin', 'ferritin', 'ubiquitin',
  'citratesynthase', 'cytc', 'albumin', 'antibody', 'gpcr', 'nakatpase', 'glut1', 'vdac', 'atpsynthase', 'complex1',
  'complex4', 'nucleosome', 'polymerase', 'tubulin', 'gfp', 'spike', 'dnabp', 'npc', 'kinhead', 'kinstalk', 'vesicle',
  'mrna', 'glycan', 'ball',
] as const;
export type MolName = typeof MOLS[number];
export const MOL: Record<MolName, number> = Object.fromEntries(MOLS.map((m, i) => [m, i])) as Record<MolName, number>;

const c = (h: string): Vec3 => {
  const n = parseInt(h.slice(1), 16);
  const f = (x: number) => { const v = x / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
};

export const INFO: Record<MolName, MolInfo> = {
  ribosome: { name: 'Ribosome (80S)', pdb: '4UG0', blurb: 'The protein factory: reads messenger RNA three letters at a time and strings amino acids into a protein, about five a second. Two thirds of it is RNA — the catalytic heart is a ribozyme. A human cell has around ten million.', color: c('#b9a7ff'), color2: c('#ff8fb1'), spread: 0.12, flags: 0 },
  gapdh: { name: 'GAPDH', pdb: '1U8F', blurb: 'Glyceraldehyde-3-phosphate dehydrogenase, step six of glycolysis — one of the most abundant proteins in the cytoplasm, a tetramer that splits sugar for energy.', color: c('#5fd0c8'), color2: c('#5fd0c8'), spread: 0.1, flags: 0 },
  proteasome: { name: 'Proteasome (20S)', pdb: '4R3O', blurb: 'The shredder: a barrel of 28 subunits that unfolds and chops up proteins tagged with ubiquitin for disposal.', color: c('#ffb648'), color2: c('#ffd27a'), spread: 0.1, flags: 0 },
  calmodulin: { name: 'Calmodulin', pdb: '1CLL', blurb: 'A calcium sensor: four calcium ions bind and it switches dozens of enzymes on.', color: c('#b6f05a'), color2: c('#b6f05a'), spread: 0.05, flags: 0 },
  trna: { name: 'Transfer RNA', pdb: '1EHZ', blurb: 'The adaptor: an L-shaped RNA carrying one amino acid at one end and, at the other, the three-letter anticodon that pairs with the matching codon on mRNA.', color: c('#ff7aa2'), color2: c('#ff7aa2'), spread: 0.05, flags: 0 },
  hexokinase: { name: 'Hexokinase', pdb: '1HKB', blurb: 'Step one of glycolysis: it grabs glucose as it enters the cell and tags it with a phosphate so it stays.', color: c('#6fb6ff'), color2: c('#6fb6ff'), spread: 0.08, flags: 0 },
  actin: { name: 'Actin', pdb: '1J6Z', blurb: 'The most abundant protein in many cells. Monomers click into double-helical filaments that push the membrane, give the cell its shape and let it crawl.', color: c('#ff6b5e'), color2: c('#ff6b5e'), spread: 0.05, flags: 0 },
  ferritin: { name: 'Ferritin', pdb: '1FHA', blurb: 'An iron store: 24 of these chains form a hollow cage that holds up to 4,500 iron atoms safely.', color: c('#ffd34d'), color2: c('#ffd34d'), spread: 0.05, flags: 0 },
  ubiquitin: { name: 'Ubiquitin', pdb: '1UBQ', blurb: 'A small tag, 76 amino acids: a chain of them on a protein marks it for the proteasome.', color: c('#ff5ad1'), color2: c('#ff5ad1'), spread: 0.05, flags: 0 },
  citratesynthase: { name: 'Citrate synthase', pdb: '1CTS', blurb: 'The first step of the citric acid cycle, in the mitochondrial matrix: it joins acetyl-CoA to oxaloacetate.', color: c('#ffa94d'), color2: c('#ffa94d'), spread: 0.08, flags: 0 },
  cytc: { name: 'Cytochrome c', pdb: '1HRC', blurb: 'A small heme protein that ferries electrons between complexes III and IV in the space between the mitochondrial membranes.', color: c('#ff4d4d'), color2: c('#ff4d4d'), spread: 0.04, flags: 0 },
  albumin: { name: 'Serum albumin', pdb: '1AO6', blurb: 'The most abundant protein in blood plasma and the fluid round cells: it carries fatty acids, hormones and drugs.', color: c('#f3e6a0'), color2: c('#f3e6a0'), spread: 0.06, flags: 0 },
  antibody: { name: 'Antibody (IgG)', pdb: '1IGT', blurb: 'A Y-shaped immune protein: its two arms grip one particular shape on a virus or bacterium and flag it.', color: c('#8fd8ff'), color2: c('#c9f0ff'), spread: 0.12, flags: 0 },
  gpcr: { name: 'β2-adrenergic receptor + G protein', pdb: '3SN6', blurb: 'A receptor reading adrenaline outside the cell and passing the message in through its G protein. A third of all drugs act on this family.', color: c('#a98bff'), color2: c('#ffb0e0'), spread: 0.2, flags: F_MEMBRANE },
  nakatpase: { name: 'Sodium–potassium pump', pdb: '4HYT', blurb: 'Spends a third of the cell\'s energy pumping 3 sodium ions out and 2 potassium in per ATP — the voltage every nerve runs on.', color: c('#3fd6a8'), color2: c('#9ff2d8'), spread: 0.15, flags: F_MEMBRANE },
  glut1: { name: 'Glucose transporter GLUT1', pdb: '4PYP', blurb: 'A gate that rocks open to one side then the other, letting glucose into the cell.', color: c('#7ee36b'), color2: c('#7ee36b'), spread: 0.05, flags: F_MEMBRANE },
  vdac: { name: 'VDAC porin', pdb: '3EMN', blurb: 'A barrel-shaped pore in the mitochondrion\'s outer membrane that lets small molecules — ATP, ADP — through.', color: c('#ffb38a'), color2: c('#ffb38a'), spread: 0.05, flags: F_MEMBRANE },
  atpsynthase: { name: 'ATP synthase', pdb: '6ZPO', blurb: 'A rotary motor. Protons flowing back through the membrane spin its rotor; each turn the head makes three ATP — the cell\'s energy currency. You make about your body weight in ATP every day.', color: c('#ffcf5a'), color2: c('#ff6a3d'), spread: 0.16, flags: F_MEMBRANE | F_ROTOR },
  complex1: { name: 'Complex I', pdb: '5LDW', blurb: 'The respiratory chain\'s entrance: an L-shaped giant of 45 proteins that takes electrons from NADH and pumps four protons across the membrane.', color: c('#7f8cff'), color2: c('#b6bfff'), spread: 0.14, flags: F_MEMBRANE },
  complex4: { name: 'Cytochrome c oxidase', pdb: '1OCC', blurb: 'The respiratory chain\'s end: it hands electrons to oxygen, making water — this is why you breathe.', color: c('#3fc3a0'), color2: c('#8fe3c9'), spread: 0.14, flags: F_MEMBRANE },
  nucleosome: { name: 'Nucleosome', pdb: '1KX5', blurb: '147 base pairs of DNA wrapped 1.65 times round eight histone proteins: the bead on the "beads on a string" that packs two metres of DNA into a nucleus a few microns across.', color: c('#ff9f8f'), color2: c('#7fa8ff'), spread: 0.14, flags: 0 },
  polymerase: { name: 'RNA polymerase II', pdb: '5FLM', blurb: 'Transcription: it unzips the DNA a dozen base pairs at a time and writes an RNA copy of a gene, about 40 letters a second.', color: c('#4fd1a5'), color2: c('#ff7aa2'), spread: 0.14, flags: 0 },
  tubulin: { name: 'Tubulin (αβ dimer)', pdb: '1JFF', blurb: 'The brick of microtubules: 13 rows of these dimers make a hollow tube 25 nm wide that grows and shrinks at its ends.', color: c('#9fffc0'), color2: c('#4fd88a'), spread: 0.0, flags: 0 },
  gfp: { name: 'Green fluorescent protein', pdb: '1EMA', blurb: 'A jellyfish protein that glows green. Biologists fuse it to other proteins to watch them inside living cells.', color: c('#7dff7a'), color2: c('#7dff7a'), spread: 0.0, flags: F_GLOW },
  spike: { name: 'Spike protein', pdb: '6VXX', blurb: 'A coronavirus\'s key: it binds a receptor on the cell and pulls the viral membrane into the cell\'s.', color: c('#ff6f61'), color2: c('#ff6f61'), spread: 0.08, flags: 0 },
  dnabp: { name: 'DNA', blurb: 'The double helix: two sugar-phosphate backbones with the bases A–T and G–C paired between them, 0.34 nm per step, ten steps a turn. Your genome is 3.1 billion of these pairs.', color: c('#5b7cff'), color2: c('#c9d6ff'), spread: 0.0, flags: F_DNABP },
  npc: { name: 'Nuclear pore complex', blurb: 'A gate through the nuclear envelope, 120 nm across, built from about 1,000 proteins in eight-fold symmetry. Its channel is a mesh of disordered threads that lets small molecules through and escorts big ones — like messenger RNA — out.', color: c('#8fb8ff'), color2: c('#ffc14d'), spread: 0.08, flags: 0 },
  kinhead: { name: 'Kinesin motor', blurb: 'A walking motor protein: two heads step hand over hand along a microtubule, 8 nm per step, one ATP per step, hauling cargo toward the cell\'s edge.', color: c('#ff9a3c'), color2: c('#ffc27a'), spread: 0.0, flags: 0 },
  kinstalk: { name: 'Kinesin stalk', blurb: 'The kinesin\'s long coiled-coil neck, linking its walking heads to the cargo.', color: c('#f2d48a'), color2: c('#f2d48a'), spread: 0.0, flags: 0 },
  vesicle: { name: 'Transport vesicle', blurb: 'A bubble of membrane carrying cargo — new proteins, hormones, neurotransmitters — from one place in the cell to another.', color: c('#ffe2a8'), color2: c('#ffe2a8'), spread: 0.0, flags: F_VESICLE },
  mrna: { name: 'Messenger RNA', blurb: 'A working copy of a gene, read by ribosomes.', color: c('#ff5d8f'), color2: c('#ff5d8f'), spread: 0.0, flags: 0 },
  ball: { name: 'Small molecule', blurb: 'An ion, a nucleotide, an amino acid, an ATP.', color: c('#ffffff'), color2: c('#ffffff'), spread: 0, flags: F_TINT },
  glycan: { name: 'Glycocalyx sugar chains', blurb: 'Branched sugars on the outer face of the membrane — the cell\'s sugar coat, a molecular ID card.', color: c('#d8f0ff'), color2: c('#d8f0ff'), spread: 0.0, flags: 0 },
};

export interface MolType {
  name: MolName;
  /** per level of detail: beads (x, y, z, r) and their group/flags */
  levels: { beads: Float32Array; info: Uint32Array }[];
  radius: number;
  groups: number;
}

// ------------------------------------------------------------------ loading the PDB beads
interface IndexEntry { pdb: string; beads: number[]; radius: number; groups: { kind: string; name: string }[]; rotor?: number[]; dnaEnds?: number[][][] }

function parseBead(buf: ArrayBuffer, entry: IndexEntry, name: MolName): MolType {
  const dv = new DataView(buf);
  let o = 8;
  const n = dv.getUint32(4, true);
  const levels: MolType['levels'] = [];
  const kinds = entry.groups.map((g) => (g.kind === 'rna' ? 1 : g.kind === 'dna' ? 2 : 0));
  const rotor = new Set(entry.rotor ?? []);
  for (let l = 0; l < n; l++) {
    const count = dv.getUint32(o, true); o += 4;
    const beads = new Float32Array(buf.slice(o, o + count * 16)); o += count * 16;
    const g16 = new Uint16Array(buf.slice(o, o + count * 2)); o += Math.ceil((count * 2) / 4) * 4;
    const info = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      const g = g16[i];
      info[i] = (g & 0xfff) | ((kinds[g] ?? 0) << 12) | (rotor.has(g) ? 1 << 14 : 0);
    }
    levels.push({ beads, info });
  }
  return { name, levels, radius: entry.radius, groups: entry.groups.length };
}

/** turn a molecule so its longest axis is +Y and its second +X (filament lattices place them by that frame) */
function principalFrame(t: MolType) {
  const b = t.levels[0].beads, n = b.length / 4;
  const m = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) m[k] += b[i * 4 + k] / n;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) for (let c2 = 0; c2 < 3; c2++) C[a][c2] += (b[i * 4 + a] - m[a]) * (b[i * 4 + c2] - m[c2]);
  // power iteration for the two largest axes
  const axis = (deflate: number[] | null) => {
    let v = [0.3, 0.8, 0.5];
    for (let it = 0; it < 60; it++) {
      let w = [0, 1, 2].map((r) => C[r][0] * v[0] + C[r][1] * v[1] + C[r][2] * v[2]);
      if (deflate) { const d = w[0] * deflate[0] + w[1] * deflate[1] + w[2] * deflate[2]; w = w.map((x, k) => x - d * deflate[k]); }
      const l = Math.hypot(w[0], w[1], w[2]) || 1;
      v = w.map((x) => x / l);
    }
    return v;
  };
  const y = axis(null), x = axis(y);
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  for (const lv of t.levels) {
    const bb = lv.beads;
    for (let i = 0; i < bb.length; i += 4) {
      const px = bb[i] - m[0], py = bb[i + 1] - m[1], pz = bb[i + 2] - m[2];
      bb[i] = px * x[0] + py * x[1] + pz * x[2];
      bb[i + 1] = px * y[0] + py * y[1] + pz * y[2];
      bb[i + 2] = px * z[0] + py * z[1] + pz * z[2];
    }
  }
}

// ------------------------------------------------------------------ built here
const level = (beads: number[], info: number[]) => ({ beads: new Float32Array(beads), info: new Uint32Array(info) });

/** a base pair of B-DNA in its own frame: the helix axis is Y; backbones 0.9 nm out, 144° apart across the minor groove */
function dnaBasePair(): MolType {
  const r = 0.92, half = (144 / 2) * Math.PI / 180;
  const pa: Vec3 = [Math.cos(-half) * r, 0, Math.sin(-half) * r], pb: Vec3 = [Math.cos(half) * r, 0, Math.sin(half) * r];
  const ba: Vec3 = [pa[0] * 0.42, 0, pa[2] * 0.42 + 0.12], bb: Vec3 = [pb[0] * 0.42, 0, pb[2] * 0.42 + 0.12];
  const L0 = level([...pa, 0.3, ...pb, 0.3, ...ba, 0.27, ...bb, 0.27, (pa[0] + ba[0]) / 2, 0, (pa[2] + ba[2]) / 2, 0.22, (pb[0] + bb[0]) / 2, 0, (pb[2] + bb[2]) / 2, 0.22],
    [0 | (2 << 12), 1 | (2 << 12), 2 | (2 << 12), 3 | (2 << 12), 2 | (2 << 12), 3 | (2 << 12)]);
  const L1 = level([...pa, 0.36, ...pb, 0.36, 0, 0, 0.18, 0.38], [0 | (2 << 12), 1 | (2 << 12), 2 | (2 << 12)]);
  const L2 = level([0, 0, 0, 1.0], [0 | (2 << 12)]);
  return { name: 'dnabp', levels: [L0, L1, L2], radius: 1.1, groups: 4 };
}

/** the nuclear pore complex: eight spokes in three stacked rings round a 40 nm channel, filaments up into the
 *  cytoplasm, a basket below, and the channel's mesh of FG threads. Y up = the cytoplasm; the origin mid-envelope. */
function nuclearPore(): MolType {
  const rng = new Rng(41);
  const B: number[] = [], I: number[] = [];
  const add = (p: Vec3, r: number, g: number) => { B.push(p[0], p[1], p[2], r); I.push(g); };
  for (let s = 0; s < 8; s++) {
    const a0 = (s / 8) * Math.PI * 2;
    for (const [y, R, g] of [[18, 52, 0], [0, 44, 1], [-18, 50, 0]] as [number, number, number][]) {
      for (let k = 0; k < 34; k++) {
        const a = a0 + rng.range(-0.3, 0.3), rr = R + rng.range(-9, 9);
        add([Math.cos(a) * rr, y + rng.range(-7, 7), Math.sin(a) * rr], rng.range(2.6, 4.6), g);
      }
    }
    // a cytoplasmic filament, and a basket strand curving in below
    for (let k = 0; k < 14; k++) {
      const t = k / 13, a = a0 + 0.15 * Math.sin(t * 5);
      add([Math.cos(a) * (50 + t * 6), 24 + t * 45, Math.sin(a) * (50 + t * 6)], 2.2, 2);
      const rb = 48 * (1 - t * 0.7);
      add([Math.cos(a0) * rb, -24 - t * 52, Math.sin(a0) * rb], 2.0, 2);
    }
  }
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; add([Math.cos(a) * 15, -78, Math.sin(a) * 15], 3, 2); }
  // the FG mesh filling the channel
  for (let k = 0; k < 260; k++) {
    const a = rng.range(0, Math.PI * 2), rr = Math.sqrt(rng.next()) * 30;
    add([Math.cos(a) * rr, rng.range(-17, 17), Math.sin(a) * rr], rng.range(1.0, 1.8), 3);
  }
  const L0 = level(B, I);
  // coarser: every fourth bead swollen; then sixteen blobs
  const b1: number[] = [], i1: number[] = [];
  for (let k = 0; k < I.length; k += 4) { b1.push(B[k * 4], B[k * 4 + 1], B[k * 4 + 2], B[k * 4 + 3] * 1.7); i1.push(I[k]); }
  const b2: number[] = [], i2: number[] = [];
  for (let s = 0; s < 8; s++) {
    const a = (s / 8) * Math.PI * 2;
    b2.push(Math.cos(a) * 50, 12, Math.sin(a) * 50, 16, Math.cos(a) * 50, -12, Math.sin(a) * 50, 16); i2.push(0, 0);
  }
  return { name: 'npc', levels: [L0, level(b1, i1), level(b2, i2)], radius: 105, groups: 4 };
}

/** a blob of beads filling an ellipsoid (kinesin's head) */
function blob(name: MolName, ax: Vec3, n: number, seed: number, groups = 1): MolType {
  const rng = new Rng(seed);
  const B: number[] = [], I: number[] = [];
  for (let k = 0; k < n; k++) {
    const d = rng.dir(), s = Math.cbrt(rng.next()) * 0.8;
    B.push(d[0] * ax[0] * s, d[1] * ax[1] * s, d[2] * ax[2] * s, Math.min(ax[0], ax[1], ax[2]) * 0.42);
    I.push(Math.floor(rng.next() * groups));
  }
  const b1 = [0, ax[1] * 0.4, 0, Math.min(ax[0], ax[2]) * 0.9, 0, -ax[1] * 0.4, 0, Math.min(ax[0], ax[2]) * 0.9];
  return { name, levels: [level(B, I), level(b1, [0, 0]), level([0, 0, 0, Math.max(...ax) * 0.8], [0])], radius: Math.max(...ax), groups };
}

/** a rod along +Y from 0 to len: two strands twisted (a coiled coil) */
function coiledCoil(name: MolName, len: number, groups = 1): MolType {
  const B: number[] = [], I: number[] = [];
  const n = Math.round(len / 0.75);
  for (let k = 0; k < n; k++) {
    const y = (k / (n - 1)) * len, a = y * 0.42;
    B.push(Math.cos(a) * 0.55, y, Math.sin(a) * 0.55, 0.55, -Math.cos(a) * 0.55, y, -Math.sin(a) * 0.55, 0.55);
    I.push(0, groups > 1 ? 1 : 0);
  }
  const b1: number[] = [], i1: number[] = [];
  for (let k = 0; k < Math.ceil(len / 3); k++) { b1.push(0, (k / Math.max(1, Math.ceil(len / 3) - 1)) * len, 0, 1.1); i1.push(0); }
  return { name, levels: [level(B, I), level(b1, i1), level([0, len / 2, 0, 1.2], [0])], radius: len, groups };
}

/** one sphere: a vesicle (shaded as membrane), an mRNA nucleotide, a sugar */
function single(name: MolName, r: number): MolType {
  const L = level([0, 0, 0, r], [0]);
  return { name, levels: [L, L, L], radius: r, groups: 1 };
}

/** a branched sugar tree on the membrane's outer face: a stem and a few branches of small beads, +Y outward */
function glycan(): MolType {
  const rng = new Rng(77);
  const B: number[] = [], I: number[] = [];
  const grow = (p: Vec3, d: Vec3, n: number, depth: number) => {
    for (let k = 0; k < n; k++) {
      vec3.scaleAndAdd(p, p, d, 0.9);
      d = vec3.normalize(vec3.create(), [d[0] + rng.range(-0.3, 0.3), d[1] + 0.15, d[2] + rng.range(-0.3, 0.3)]);
      B.push(p[0], p[1], p[2], 0.45); I.push(depth);
      if (depth < 2 && rng.next() < 0.22) grow(vec3.clone(p), vec3.normalize(vec3.create(), [rng.range(-1, 1), 0.6, rng.range(-1, 1)]), Math.floor(n * 0.6), depth + 1);
    }
  };
  grow([0, 0, 0], [0, 1, 0], 9, 0);
  return { name: 'glycan', levels: [level(B, I), level([0, 4, 0, 1.5], [0]), level([0, 4, 0, 2], [0])], radius: 9, groups: 3 };
}

// ------------------------------------------------------------------ compositions
/** what floats in each compartment, by weight (a ribosome is ~6% of these by count, but the biggest thing there) */
export const COMPARTMENTS = ['outside', 'cytosol', 'nucleus', 'nucleolus', 'matrix', 'erLumen', 'golgiLumen', 'lysosome', 'peroxisome', 'vesicle', 'intercristal', 'droplet', 'neighbor'] as const;
export type Compartment = typeof COMPARTMENTS[number];
export const COMPOSITION: Record<Compartment, [MolName, number][]> = {
  outside: [['albumin', 6], ['antibody', 1.2], ['spike', 0.03]],
  cytosol: [['ribosome', 0.9], ['gapdh', 3], ['hexokinase', 1.2], ['proteasome', 0.7], ['calmodulin', 2], ['trna', 3.5], ['actin', 1.4], ['ferritin', 0.5], ['ubiquitin', 1.5], ['gfp', 0.03]],
  nucleus: [['polymerase', 0.5], ['proteasome', 0.3], ['calmodulin', 1], ['ubiquitin', 1], ['gapdh', 0.5]],
  nucleolus: [['ribosome', 4], ['trna', 1], ['polymerase', 0.6]],
  matrix: [['citratesynthase', 4], ['gapdh', 1], ['hexokinase', 0.3], ['ribosome', 0.3]],
  erLumen: [['calmodulin', 0.5], ['albumin', 0.5]],
  golgiLumen: [['albumin', 0.6], ['antibody', 0.2]],
  lysosome: [['proteasome', 0.4], ['hexokinase', 0.6], ['ubiquitin', 1]],
  peroxisome: [['citratesynthase', 0.7], ['ferritin', 0.3]],
  vesicle: [['albumin', 0.5], ['antibody', 0.3]],
  intercristal: [['cytc', 3]],
  droplet: [],
  neighbor: [['ribosome', 0.8], ['gapdh', 3], ['trna', 3], ['proteasome', 0.6], ['calmodulin', 2]],
};
/** density relative to the cytosol */
export const DENSITY: Record<Compartment, number> = {
  outside: 0.12, cytosol: 0.8, nucleus: 0.12, nucleolus: 0.9, matrix: 0.45, erLumen: 0.15, golgiLumen: 0.2, lysosome: 0.35,
  peroxisome: 0.5, vesicle: 0.3, intercristal: 0.4, droplet: 0, neighbor: 0.7,
};
export function compartmentOf(kind: Kind | -1): Compartment {
  switch (kind) {
    case -1: return 'outside';
    case Kind.Cell: return 'cytosol';
    case Kind.Nucleus: return 'nucleus';
    case Kind.Nucleolus: return 'nucleolus';
    case Kind.Mito: return 'matrix';
    case Kind.Crista: return 'intercristal';
    case Kind.ER: return 'erLumen';
    case Kind.Golgi: return 'golgiLumen';
    case Kind.Lysosome: return 'lysosome';
    case Kind.Peroxisome: return 'peroxisome';
    case Kind.Endosome: case Kind.Vesicle: return 'vesicle';
    case Kind.Droplet: return 'droplet';
    case Kind.Neighbor: case Kind.NeighborNucleus: return 'neighbor';
  }
  return 'cytosol';
}
/** what sits in each kind of membrane (the outer side is +Y), and how thickly (relative) */
export const MEMBRANE: Partial<Record<Kind, { mols: [MolName, number][]; density: number; offset: number }>> = {
  [Kind.Cell]: { mols: [['gpcr', 1], ['nakatpase', 1], ['glut1', 1.4], ['glycan', 6]], density: 1, offset: 0 },
  [Kind.Nucleus]: { mols: [['npc', 1]], density: 0.06, offset: -20 },
  [Kind.Mito]: { mols: [['vdac', 1]], density: 0.5, offset: 0 },
  [Kind.Crista]: { mols: [['atpsynthase', 2.4], ['complex1', 0.4], ['complex4', 0.6]], density: 0.5, offset: 0 },
  [Kind.ER]: { mols: [['ribosome', 1]], density: 0.16, offset: 13 },
  [Kind.Neighbor]: { mols: [['gpcr', 1], ['nakatpase', 1], ['glut1', 1.4], ['glycan', 4]], density: 0.4, offset: 0 },
};

// ------------------------------------------------------------------ the GPU side
export class Molecules {
  types: MolType[] = [];
  beads!: StorageBuffer;
  beadInfo!: StorageBuffer;
  typeTable!: StorageBuffer;
  /** per type and level: first bead, bead count */
  ranges: [number, number][][] = [];

  static async load(kit: Kit, base: string, onProgress?: (f: number) => void): Promise<Molecules> {
    const m = new Molecules();
    const index = await (await fetch(`${base}data/mol/index.json`)).json() as Record<string, IndexEntry>;
    const built: Partial<Record<MolName, MolType>> = {
      dnabp: dnaBasePair(), npc: nuclearPore(),
      kinhead: blob('kinhead', [3.4, 3.8, 2.4], 90, 5, 2), kinstalk: coiledCoil('kinstalk', 56),
      vesicle: single('vesicle', 1), mrna: single('mrna', 0.55), glycan: glycan(), ball: single('ball', 1),
    };
    let done = 0;
    const fromPdb = MOLS.filter((n) => !built[n]);
    await Promise.all(fromPdb.map(async (name) => {
      const e = index[name];
      if (!e) throw new Error(`no bead data for ${name}`);
      const buf = await (await fetch(`${base}data/mol/${name}.bin`)).arrayBuffer();
      built[name] = parseBead(buf, e, name);
      onProgress?.(++done / fromPdb.length);
    }));
    principalFrame(built.tubulin!);
    principalFrame(built.actin!);
    m.types = MOLS.map((n) => built[n]!);
    m.upload(kit);
    return m;
  }

  private upload(kit: Kit) {
    let total = 0;
    for (const t of this.types) for (const l of t.levels) total += l.info.length;
    const beads = new Float32Array(total * 4), info = new Uint32Array(total);
    let at = 0;
    this.ranges = this.types.map((t) => t.levels.map((l) => {
      beads.set(l.beads, at * 4);
      info.set(l.info, at);
      const r: [number, number] = [at, l.info.length];
      at += l.info.length;
      return r;
    }));
    this.beads = kit.storage({ label: 'beads', data: beads, stride: 16 });
    this.beadInfo = kit.storage({ label: 'beadInfo', data: info, stride: 4 });
    // the type table (64 bytes each): lodStart, flags, lodCount, groups, color, radius, color2, spread
    const T = new ArrayBuffer(this.types.length * 64), f = new Float32Array(T), u = new Uint32Array(T);
    this.types.forEach((t, i) => {
      const o = i * 16, inf = INFO[t.name];
      for (let l = 0; l < 3; l++) { u[o + l] = this.ranges[i][l][0]; u[o + 4 + l] = this.ranges[i][l][1]; }
      u[o + 3] = inf.flags; u[o + 7] = t.groups;
      f.set(inf.color, o + 8); f[o + 11] = t.radius;
      f.set(inf.color2, o + 12); f[o + 15] = inf.spread;
    });
    this.typeTable = kit.storage({ label: 'molTypes', data: f, stride: 64 });
    console.log(`molecules: ${this.types.length} types, ${(total / 1000).toFixed(0)}k beads`);
  }
}
