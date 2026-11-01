// "Read the code": you are a ribosome translating the gene for green fluorescent protein. A free ribosome (the real
// human 80S, PDB 4UG0, with its initiator tRNA already in the P site) sits in the cytosol above a sheet of rough ER;
// an mRNA threads across its small subunit. The codon in the A site is shown big; tRNAs (1EHZ) drift in front, each
// with its amino acid, and you pick the one whose anticodon pairs with the codon. A right pick docks, the peptide bond
// moves the growing chain onto it, and the ribosome steps three bases along; a wrong one is rejected. After a dozen,
// the rest of the gene is translated on fast-forward; at the stop codon a release factor frees the chain, which folds
// into GFP's barrel (its beads morph onto 1EMA's residues) and lights up.
// The ribosome's frame comes from its own structure: the subunit axis from the 28S and 18S rRNA centroids, the mRNA's
// direction from the P-site tRNA's L plane, the exit tunnel from the tRNA's acceptor end through the large subunit.
// Simplified: one tRNA per amino acid (no wobble, no EF-Tu/GTP), translocation as a slide, the E-site tRNA as a puff.
// Also here, for both central-dogma games (polymerase.ts imports them): the GFP gene, the genetic code, the colours.
import { vec3, quat, type Vec3, type Quat } from 'math';
import { registerGame, type GameCtx } from './game';
import { MOL } from '../world/molecules';
import { frameQuat } from '../world/walkers';
import { Kind, type World } from '../world/layout';

// ------------------------------------------------------------------ the gene and the code
/** Aequorea victoria GFP, the wild-type coding sequence (gfp10 cDNA, 238 codons + TAA); it translates exactly to
 *  UniProt P42212. (1EMA, the structure the protein folds into here, is the S65T variant.) */
export const GFP_CDS =
  'ATGAGTAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGGTGAAGGTGATGCAACATACGGAAAACTTACCCTTAAATTTATTTGCACTACTGGAAAACTACCTGTTCCATGGCCAACACTTGTCACTACTTTCTCTTATGGTGTTCAATGCTTTTCAAGATACCCAGATCATATGAAACAGCATGACTTTTTCAAGAGTGCCATGCCCGAAGGTTATGTACAGGAAAGAACTATATTTTTCAAAGATGACGGGAACTACAAGACACGTGCTGAAGTCAAGTTTGAAGGTGATACCCTTGTTAATAGAATCGAGTTAAAAGGTATTGATTTTAAAGAAGATGGAAACATTCTTGGACACAAATTGGAATACAACTATAACTCACACAATGTATACATCATGGCAGACAAACAAAAGAATGGAATCAAAGTTAACTTCAAAATTAGACACAACATTGAAGATGGAAGCGTTCAACTAGCAGACCATTATCAACAAAATACTCCAATTGGCGATGGCCCTGTCCTTTTACCAGACAACCATTACCTGTCCACACAATCTGCCCTTTCGAAAGATCCCAACGAAAAGAGAGACCACATGGTCCTTCTTGAGTTTGTAACAGCTGCTGGGATTACACATGGCATGGATGAACTATACAAATAA';
export const GFP_RNA = GFP_CDS.replace(/T/g, 'U');

const BASES = 'UCAG';
const AAS = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
/** the standard genetic code: RNA codon → one-letter amino acid ('*' stop) */
export const CODE: Record<string, string> = {};
for (let i = 0; i < 64; i++) CODE[BASES[i >> 4] + BASES[(i >> 2) & 3] + BASES[i & 3]] = AAS[i];

export type AaClass = 'hydrophobic' | 'polar' | 'positive' | 'negative' | 'special';
export const AA: Record<string, { three: string; name: string; cls: AaClass }> = {
  A: { three: 'Ala', name: 'Alanine', cls: 'hydrophobic' }, R: { three: 'Arg', name: 'Arginine', cls: 'positive' },
  N: { three: 'Asn', name: 'Asparagine', cls: 'polar' }, D: { three: 'Asp', name: 'Aspartate', cls: 'negative' },
  C: { three: 'Cys', name: 'Cysteine', cls: 'special' }, E: { three: 'Glu', name: 'Glutamate', cls: 'negative' },
  Q: { three: 'Gln', name: 'Glutamine', cls: 'polar' }, G: { three: 'Gly', name: 'Glycine', cls: 'special' },
  H: { three: 'His', name: 'Histidine', cls: 'positive' }, I: { three: 'Ile', name: 'Isoleucine', cls: 'hydrophobic' },
  L: { three: 'Leu', name: 'Leucine', cls: 'hydrophobic' }, K: { three: 'Lys', name: 'Lysine', cls: 'positive' },
  M: { three: 'Met', name: 'Methionine', cls: 'hydrophobic' }, F: { three: 'Phe', name: 'Phenylalanine', cls: 'hydrophobic' },
  P: { three: 'Pro', name: 'Proline', cls: 'special' }, S: { three: 'Ser', name: 'Serine', cls: 'polar' },
  T: { three: 'Thr', name: 'Threonine', cls: 'polar' }, W: { three: 'Trp', name: 'Tryptophan', cls: 'hydrophobic' },
  Y: { three: 'Tyr', name: 'Tyrosine', cls: 'polar' }, V: { three: 'Val', name: 'Valine', cls: 'hydrophobic' },
};
export const CLASS_HEX: Record<AaClass, string> = { hydrophobic: '#f5c542', polar: '#5fd38a', positive: '#5a8cff', negative: '#ff5a5a', special: '#c9c9d6' };
/** the interface's letters (saturated) and the 3D balls' (the DNA base pair model's own colours, in sRGB) */
export const BASE_UI: Record<string, string> = { A: '#ff6b5e', U: '#ffd23f', T: '#ffd23f', G: '#59e07a', C: '#5aa2ff' };
export const BASE_3D: Record<string, string> = { A: '#ff9888', U: '#ffe97a', T: '#ffe97a', G: '#93f3a8', C: '#9ec9ff' };
export const PAIR_RNA: Record<string, string> = { A: 'U', U: 'A', G: 'C', C: 'G', T: 'A' };
export const PAIR_DNA: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };

/** a colour for a tinted ball: sRGB bytes packed r, g, b, a (low to high) */
export function tint(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (((n >> 16) & 255) | (((n >> 8) & 255) << 8) | ((n & 255) << 16) | (255 << 24)) >>> 0;
}
export const colored = (b: string) => `<b style="color:${BASE_UI[b] ?? '#fff'}">${b}</b>`;

// ------------------------------------------------------------------ shared machinery
/** add a stylesheet once */
export function css(id: string, text: string) {
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = text;
  document.head.append(s);
}

/** writes this frame's actors into the field */
export class Emit {
  constructor(private ctx: GameCtx) {}
  begin() { this.ctx.field.actorCount = 0; }
  mol(type: number, pos: Vec3, rot: Quat, scale = 1, t = 0, id = 0) {
    const f = this.ctx.field;
    if (f.actorCount >= f.actors.count || scale <= 0.001) return;
    f.actors.set(f.actorCount++, { pos, scale, rot, mtype: type, lod: 0, tint: t >>> 0, id: (id || (0x80000000 | (type << 16))) >>> 0 });
  }
  ball(pos: Vec3, r: number, t: number) { this.mol(MOL.ball, pos, IDQ, r, t); }
}
const IDQ: Quat = [0, 0, 0, 1];

/** is a point well clear of the wedge the cell is cut open with (so the game's actors aren't cut away)? */
export function clearOfWedge(p: Vec3, margin = 0.35): boolean {
  const app = (window as unknown as { app?: { places: Map<string, { yaw: number }> } }).app;
  const yaw = app?.places.get('tissue')?.yaw ?? 0.62;
  const w = [Math.sin(yaw), Math.cos(yaw)];
  const qx = p[0], qz = p[2], l = Math.hypot(qx, qz) || 1;
  const ang = Math.acos(Math.max(-1, Math.min(1, (qx * w[0] + qz * w[1]) / l)));
  return ang > 0.9 + margin;
}
export function whereIs(p: Vec3): string {
  const app = (window as unknown as { app?: { where(p: Vec3): { name: string } } }).app;
  return app?.where(p).name ?? '?';
}

/** ease the driven camera toward a view (log-space for the scale, the short way round for the yaw) */
export function steerCamera(ctx: GameCtx, pivot: Vec3, scale: number, yaw: number, pitch: number, dt: number, rate = 2.5) {
  const c = ctx.controls;
  if (c.flying) return;
  scale = fitScale(ctx, scale);
  const k = 1 - Math.exp(-dt * rate);
  vec3.lerp(c.pivot, c.pivot, pivot, k);
  c.scale = Math.exp(Math.log(c.scale) + (Math.log(scale) - Math.log(c.scale)) * k);
  c.yaw += Math.atan2(Math.sin(yaw - c.yaw), Math.cos(yaw - c.yaw)) * k;
  c.pitch += (pitch - c.pitch) * k;
}

/** a view distance made for a landscape screen, pulled back on a portrait one (whose width is the narrow side) */
export function fitScale(ctx: GameCtx, scale: number) {
  const [w, h] = ctx.kit.size.css;
  const aspect = w / Math.max(1, h);
  return aspect < 1 ? scale * Math.pow(1 / aspect, 0.65) : scale;
}

/** a world point to css pixels on the canvas (null behind the eye) */
export function project(ctx: GameCtx, p: Vec3, out: [number, number]): [number, number] | null {
  const m = ctx.kit.camera.viewProj;
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  if (w <= 1e-6) return null;
  const r = ctx.kit.canvas.getBoundingClientRect();
  out[0] = r.left + (x / w * 0.5 + 0.5) * r.width;
  out[1] = r.top + (0.5 - y / w * 0.5) * r.height;
  return out;
}

/** the centroid of the beads in [i0, i1) of a bead array (x, y, z, r) */
function centroid(b: Float32Array, idx: number[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const i of idx) { c[0] += b[i * 4]; c[1] += b[i * 4 + 1]; c[2] += b[i * 4 + 2]; }
  return vec3.scale(c, c, 1 / Math.max(1, idx.length));
}
/** the principal axes of a set of beads (largest first) by power iteration */
export function axes(b: Float32Array, idx: number[]): [Vec3, Vec3, Vec3] {
  const m = centroid(b, idx);
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const i of idx) {
    const d = [b[i * 4] - m[0], b[i * 4 + 1] - m[1], b[i * 4 + 2] - m[2]];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] += d[r] * d[c];
  }
  const power = (defl: Vec3[]) => {
    let v: Vec3 = [0.31, 0.83, 0.47];
    for (let it = 0; it < 80; it++) {
      const w: Vec3 = [C[0] * v[0] + C[1] * v[1] + C[2] * v[2], C[3] * v[0] + C[4] * v[1] + C[5] * v[2], C[6] * v[0] + C[7] * v[1] + C[8] * v[2]];
      for (const d of defl) vec3.scaleAndAdd(w, w, d, -vec3.dot(w, d));
      v = vec3.normalize(w, w);
    }
    return v;
  };
  const a = power([]), b2 = power([a]);
  return [a, b2, vec3.normalize(vec3.create(), vec3.cross(vec3.create(), a, b2))];
}
export function beadsWhere(info: Uint32Array, test: (group: number, kind: number) => boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < info.length; i++) if (test(info[i] & 0xfff, (info[i] >> 12) & 3)) out.push(i);
  return out;
}
/** the rotation taking a native frame (x, y) onto a world frame (x', y') */
export function alignQuat(nx: Vec3, ny: Vec3, wx: Vec3, wy: Vec3): Quat {
  const qn = frameQuat(quat.create(), nx, ny), qw = frameQuat(quat.create(), wx, wy);
  return quat.normalize(quat.create(), quat.multiply(quat.create(), qw, quat.conjugate(quat.create(), qn)));
}

/** the shared panel styles (rg-*; the polymerase game adds its own pg-*) */
export const PANEL_CSS = `
.rg-top { position: absolute; top: 18px; left: 50%; transform: translateX(-50%); text-align: center; pointer-events: none; width: min(760px, 92vw); }
.rg-role { font: 500 11px var(--mono); letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent); }
.rg-title { font: 300 clamp(22px, 3.2vw, 34px)/1.1 var(--serif); margin-top: 4px; }
.rg-goal { font-size: 13px; color: var(--dim); margin-top: 6px; }
.rg-stats { position: absolute; top: 18px; left: 20px; display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
.rg-stat { font: 11px var(--mono); color: var(--faint); }
.rg-stat b { display: block; font: 600 20px var(--mono); color: var(--ink); }
.rg-x { position: absolute; top: 14px; right: 16px; width: 40px; height: 40px; border-radius: 50%; background: var(--glass); border: 1px solid var(--line);
  color: var(--ink); font-size: 20px; cursor: pointer; backdrop-filter: blur(12px); }
.rg-bottom { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); width: min(980px, calc(100vw - 20px)); display: flex; flex-direction: column; gap: 10px; align-items: center; }
.rg-glass { background: rgba(14, 11, 18, 0.66); border: 1px solid var(--line); border-radius: 16px; backdrop-filter: blur(16px) saturate(1.3); -webkit-backdrop-filter: blur(16px) saturate(1.3); }
.rg-strip { padding: 10px 16px; display: flex; gap: 14px; align-items: flex-end; justify-content: center; font: 600 22px var(--mono); letter-spacing: 0.04em; flex-wrap: nowrap; overflow: hidden; max-width: 100%; }
.rg-codon { display: flex; flex-direction: column; align-items: center; gap: 3px; opacity: 0.45; transition: opacity 0.25s, transform 0.25s; }
.rg-codon small { font: 500 9.5px var(--mono); letter-spacing: 0.1em; color: var(--faint); text-transform: uppercase; }
.rg-codon.a { opacity: 1; transform: scale(1.5); margin: 0 18px; }
.rg-codon.p, .rg-codon.e { opacity: 0.8; }
.rg-choices { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; width: 100%; }
.rg-choice { position: relative; padding: 12px 10px 10px; cursor: pointer; color: var(--ink); text-align: center; transition: transform 0.15s, border-color 0.2s, background 0.2s; }
.rg-choice:hover { transform: translateY(-3px); border-color: rgba(255, 190, 160, 0.5); }
.rg-choice.bad { animation: rg-shake 0.4s; border-color: #ff5a5a; }
.rg-choice.good { border-color: #7dff7a; background: rgba(60, 120, 60, 0.35); }
.rg-choice .k { position: absolute; top: 6px; left: 9px; font: 600 11px var(--mono); color: var(--faint); }
.rg-choice .ac { font: 600 26px var(--mono); letter-spacing: 0.08em; }
.rg-choice .ends { font: 10px var(--mono); color: var(--faint); }
.rg-choice .aa { margin-top: 4px; font-size: 13px; }
.rg-choice .aa i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; vertical-align: 0; }
.rg-msg { min-height: 26px; font: 300 19px var(--serif); text-shadow: 0 2px 14px #000; text-align: center; }
.rg-badge { position: absolute; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%; background: rgba(14, 11, 18, 0.75);
  border: 1px solid rgba(255, 220, 200, 0.5); font: 600 12px/24px var(--mono); text-align: center; color: var(--ink); pointer-events: none; transition: opacity 0.2s; }
.rg-bar { width: min(560px, 90vw); height: 6px; border-radius: 3px; background: rgba(255, 255, 255, 0.08); overflow: hidden; }
.rg-bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #ff9e7a, #7dff7a); }
.rg-intro, .rg-sum { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(520px, 92vw); padding: 24px 26px; text-align: left; }
.rg-intro h2, .rg-sum h2 { margin: 0 0 6px; font: 400 30px/1.1 var(--serif); }
.rg-intro p, .rg-sum p { font-size: 14px; line-height: 1.55; color: rgba(244, 237, 230, 0.86); margin: 8px 0; }
.rg-sum .nums { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 14px 0; }
.rg-sum .nums div { font: 11px var(--mono); color: var(--faint); }
.rg-sum .nums b { display: block; font: 600 22px var(--mono); color: var(--ink); }
.rg-acts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.rg-acts .btn { font-size: 14px; padding: 10px 16px; }
@keyframes rg-shake { 0%, 100% { transform: none; } 25% { transform: translateX(-8px); } 75% { transform: translateX(8px); } }
@media (max-width: 760px) {
  .rg-choices { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rg-stats { top: 112px; left: 14px; flex-direction: row; gap: 16px; }
  .rg-stat b { font-size: 15px; }
  .rg-strip { font-size: 17px; gap: 8px; }
  .rg-codon.a { margin: 0 10px; }
}
`;

// ------------------------------------------------------------------ the ribosome's own frame
interface RiboFrame {
  /** native (bead) frame: subunit axis (large → small), mRNA direction, P-site codon point, peptidyl centre, tunnel */
  axis: Vec3; mrna: Vec3; pCodon: Vec3; ptc: Vec3; tunnel: Vec3;
  /** the P-site tRNA's pose in the native frame, and the 1EHZ tRNA's rotation onto it */
  tq: Quat; tpos: Vec3;
}
let frameCache: RiboFrame | null = null;

function ribosomeFrame(ctx: GameCtx): RiboFrame {
  if (frameCache) return frameCache;
  const L = ctx.mols.types[MOL.ribosome].levels[0];
  const b = L.beads, info = L.info;
  // the rRNAs and the tRNA by size: the 28S is the largest RNA, the 18S the next, the initiator tRNA the smallest
  const counts = new Map<number, number>();
  for (let i = 0; i < info.length; i++) if (((info[i] >> 12) & 3) === 1) counts.set(info[i] & 0xfff, (counts.get(info[i] & 0xfff) ?? 0) + 1);
  const rnas = [...counts.entries()].sort((x, y) => y[1] - x[1]);
  const g28 = rnas[0][0], g18 = rnas[1][0], gt = rnas[rnas.length - 1][0];
  const cL = centroid(b, beadsWhere(info, (g) => g === g28)), cS = centroid(b, beadsWhere(info, (g) => g === g18));
  const tIdx = beadsWhere(info, (g) => g === gt);
  const cT = centroid(b, tIdx);
  const axis = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), cS, cL));
  // the tRNA's ends: its anticodon reaches toward the small subunit, its acceptor end into the large one
  let ac = tIdx[0], acc = tIdx[0];
  for (const i of tIdx) {
    const d = (b[i * 4] - cT[0]) * axis[0] + (b[i * 4 + 1] - cT[1]) * axis[1] + (b[i * 4 + 2] - cT[2]) * axis[2];
    const da = (b[ac * 4] - cT[0]) * axis[0] + (b[ac * 4 + 1] - cT[1]) * axis[1] + (b[ac * 4 + 2] - cT[2]) * axis[2];
    const dc = (b[acc * 4] - cT[0]) * axis[0] + (b[acc * 4 + 1] - cT[1]) * axis[1] + (b[acc * 4 + 2] - cT[2]) * axis[2];
    if (d > da) ac = i;
    if (d < dc) acc = i;
  }
  const near = (c: number) => tIdx.filter((i) => Math.hypot(b[i * 4] - b[c * 4], b[i * 4 + 1] - b[c * 4 + 1], b[i * 4 + 2] - b[c * 4 + 2]) < 1.6);
  const acP = centroid(b, near(ac)), accP = centroid(b, near(acc));
  // the mRNA runs along the normal of the tRNA's L
  const [, , lnorm] = axes(b, tIdx);
  const mrna = vec3.normalize(vec3.create(), vec3.scaleAndAdd(vec3.create(), lnorm, axis, -vec3.dot(lnorm, axis)));
  const pCodon = vec3.scaleAndAdd(vec3.create(), acP, axis, 0.9);
  const ptc = accP;
  const tunnel = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), vec3.scaleAndAdd(vec3.create(), cL, axis, -6), ptc));
  // the 1EHZ tRNA's own frame (by sequence: anticodon nucleotides 34-36, acceptor 74-76) onto the P-site tRNA's
  const T = ctx.mols.types[MOL.trna].levels[0].beads;
  const nAc = centroid(T, [66, 67, 68, 69, 70, 71]), nAcc = centroid(T, [146, 147, 148, 149, 150, 151]);
  const nAll = centroid(T, [...Array(T.length / 4).keys()]);
  const nY = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), nAc, nAcc));
  const nX = vec3.subtract(vec3.create(), nAll, vec3.lerp(vec3.create(), nAc, nAcc, 0.5));
  const wY = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), acP, accP));
  const wX = vec3.subtract(vec3.create(), cT, vec3.lerp(vec3.create(), acP, accP, 0.5));
  const tq = alignQuat(nX, nY, wX, wY);
  // place it so its anticodon sits where the native one does
  const tpos = vec3.subtract(vec3.create(), acP, vec3.transformQuat(vec3.create(), nAc, tq));
  frameCache = { axis, mrna, pCodon, ptc, tunnel, tq, tpos };
  return frameCache;
}

// ------------------------------------------------------------------ the game
type Phase = 'intro' | 'choose' | 'dock' | 'reject' | 'shift' | 'auto' | 'release' | 'fold' | 'done';
interface Choice { aa: string; anti: string; good: boolean; home: Vec3; pos: Vec3; rot: Quat; spin: number; out: number }

const INTERACTIVE = 12;
const PITCH = 1.8;       // nm between codons on the mRNA in the ribosome
const NT = PITCH / 3;

// module scratch
const _r_a = vec3.create(), _r_b = vec3.create(), _r_c = vec3.create(), _r_q = quat.create(), _r_q2 = quat.create();
const _r_px: [number, number] = [0, 0];

class Ribosome {
  id = 'ribosome';
  role = 'Ribosome';
  title = 'Read the code';
  blurb = 'Translate the gene for green fluorescent protein, codon by codon. Match each tRNA to the codon — then watch your protein fold and glow.';
  art = 'er';
  private ctx!: GameCtx;
  private emit!: Emit;
  private fr!: RiboFrame;
  private q = quat.create();          // native → world
  private O = vec3.create();          // where the ribosome is
  private up: Vec3 = [0, 1, 0];
  private right: Vec3 = [1, 0, 0];
  /** toward the camera, and how far the decoding site is drawn out onto the ribosome's face */
  private toCam: Vec3 = [0, 0, 1];
  private front = vec3.create();
  private yaw = 0;
  private phase: Phase = 'intro';
  private t = 0;                      // seconds in this phase
  private time = 0;
  /** amino acids in the chain; the A-site codon is codon n (0 is the AUG in the P site) */
  private n = 1;
  /** where the mRNA stands (codons, animated through translocation) */
  private slide = 0;
  private choices: Choice[] = [];
  private picked = -1;
  private tries = 0;
  private wrong = 0;
  private startTime = 0;
  private interactiveTime = 0;
  private chainPath: Vec3[] = [];
  private autoN = 0;
  private chain: Vec3[] = [];
  private folded: Vec3[] = [];
  private gfpPos = vec3.create();
  private gfpRot = quat.create();
  private leaving: { pos: Vec3; rot: Quat; t: number; aa: string }[] = [];
  private ui: Record<string, HTMLElement> = {};
  private keyFn = (e: KeyboardEvent) => this.key(e);
  private perChunk = 0;
  private fov0 = 0;

  start(ctx: GameCtx) {
    this.ctx = ctx;
    this.emit = new Emit(ctx);
    this.fr = ribosomeFrame(ctx);
    this.fov0 = ctx.kit.camera.fovY;
    css('rg-css', PANEL_CSS);
    this.place();
    this.reset();
    this.perChunk = ctx.field.perChunk;
    ctx.field.perChunk = Math.min(this.perChunk, 1);
    ctx.controls.driven = true;
    ctx.controls.flyTo(this.view().pivot, fitScale(ctx, 58), { yaw: this.yaw, pitch: -0.12, speed: 0.9 });
    this.buildUi();
    addEventListener('keydown', this.keyFn);
  }
  stop() {
    removeEventListener('keydown', this.keyFn);
    if (this.perChunk) this.ctx.field.perChunk = this.perChunk;
    this.ctx.field.actorCount = 0;
    this.ctx.kit.camera.fovY = this.fov0;
  }

  /** a spot in the cytosol above a sheet of rough ER, clear of the open wedge */
  private place() {
    const w: World = this.ctx.world;
    const ers = w.organelles.filter((o) => o.kind === Kind.ER);
    let found = false;
    for (const er of ers) {
      const p = vec3.scaleAndAdd(vec3.create(), er.a as Vec3, er.b as Vec3, -(er.thick / 2 + 75));
      if (!clearOfWedge(p) || whereIs(p) !== 'cytosol') continue;
      vec3.copy(this.O, p);
      found = true;
      break;
    }
    if (!found) vec3.set(this.O, -1400 - 3900 * 0.6, 400, -600 - 3900 * 0.8);
    // the camera looks across the ribosome with the mRNA running left to right
    const app = (window as unknown as { app?: { places: Map<string, { yaw: number }> } }).app;
    this.yaw = (app?.places.get('tissue')?.yaw ?? 0.62) + Math.PI * 0.85;
    this.right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    this.toCam = [Math.sin(this.yaw), 0, Math.cos(this.yaw)];
    // native subunit axis → up, native mRNA direction → screen right
    const qa = alignQuat(this.fr.mrna, this.fr.axis, this.right, this.up);
    quat.copy(this.q, qa);
    // The decoding site is deep in the cleft between the subunits, out of sight from any side. For a game you can
    // read, the mRNA, the tRNA sites and the chain's start are drawn out onto the face toward you: as far forward as
    // the ribosome's own beads reach near the codon, plus a little.
    const L = this.ctx.mols.types[MOL.ribosome].levels[0].beads;
    const pc = this.world(this.fr.pCodon, vec3.create());
    let reach = 0;
    for (let i = 0; i < L.length; i += 4) {
      const w = this.world([L[i], L[i + 1], L[i + 2]], _r_a);
      vec3.subtract(w, w, pc);
      const along = vec3.dot(w, this.toCam);
      const lateral = Math.hypot(vec3.dot(w, this.right), vec3.dot(w, this.up));
      if (lateral < 7) reach = Math.max(reach, along + L[i + 3]);
    }
    vec3.scale(this.front, this.toCam, reach + 1.2);
    // the chain's path: from the peptidyl centre down the front of the large subunit, then a dangling, wandering coil
    this.chainPath = [];
    const p = vec3.add(vec3.create(), this.world(this.fr.ptc, vec3.create()), this.front);
    let s = 0, wob = 0.7;
    const d = vec3.normalize(vec3.create(), vec3.scaleAndAdd(vec3.create(), vec3.scale(vec3.create(), this.up, -1), this.toCam, 0.1));
    for (let i = 0; i < 260; i++) {
      this.chainPath.push(vec3.clone(p));
      if (s > 9) {
        // outside: a loose coil sinking away below the ribosome, wandering sideways, never toward the eye
        const h = Math.sin(i * 1.7) * 0.6 + Math.sin(i * 0.43 + 1.3);
        const k = Math.cos(i * 1.1) * 0.6 + Math.sin(i * 0.29 + 0.2);
        vec3.scaleAndAdd(d, d, this.right, h * wob * 0.45);
        vec3.scaleAndAdd(d, d, this.toCam, -Math.abs(k) * wob * 0.25);
        vec3.scaleAndAdd(d, d, this.up, -0.22);
        vec3.normalize(d, d);
      }
      vec3.scaleAndAdd(p, p, d, 0.38);
      s += 0.38;
      wob = Math.min(1.4, wob + 0.004);
    }
  }
  /** native ribosome point → world */
  private world(pn: Vec3, out: Vec3): Vec3 { return vec3.add(out, this.O, vec3.transformQuat(out, pn, this.q)); }
  /** native point → world, drawn out onto the face toward the camera */
  private site(pn: Vec3, out: Vec3): Vec3 { return vec3.add(out, this.world(pn, out), this.front); }
  private view() {
    const pivot = this.site(this.fr.pCodon, vec3.create());
    vec3.scaleAndAdd(pivot, pivot, this.up, -11);
    vec3.scaleAndAdd(pivot, pivot, this.toCam, 6);
    return { pivot, scale: 58 };
  }

  private reset() {
    this.phase = 'intro'; this.t = 0; this.n = 1; this.slide = 0; this.tries = 0; this.wrong = 0; this.picked = -1;
    this.leaving = []; this.folded = []; this.interactiveTime = 0;
    // the chain starts as the initiator's methionine
    this.chain = [vec3.create()];
    this.newChoices();
  }

  // ---------------------------------------------------------------- choices
  private codon(i: number) { return GFP_RNA.slice(i * 3, i * 3 + 3); }
  private newChoices() {
    const cod = this.codon(this.n);
    const aa = CODE[cod];
    const anti = [...cod].map((b) => PAIR_RNA[b]).join('');
    const opts: { aa: string; anti: string; good: boolean }[] = [{ aa, anti, good: true }];
    // decoys: one base off (a near miss the eye has to catch), each a different amino acid
    let guard = 0;
    while (opts.length < 4 && guard++ < 200) {
      const k = Math.floor(Math.random() * 3), nb = 'AUGC'[Math.floor(Math.random() * 4)];
      const c2 = cod.slice(0, k) + nb + cod.slice(k + 1);
      const a2 = CODE[c2];
      if (!a2 || a2 === '*' || opts.some((o) => o.aa === a2)) continue;
      opts.push({ aa: a2, anti: [...c2].map((b) => PAIR_RNA[b]).join(''), good: false });
    }
    while (opts.length < 4) {
      const c2 = Object.keys(CODE)[Math.floor(Math.random() * 64)];
      if (CODE[c2] === '*' || opts.some((o) => o.aa === CODE[c2])) continue;
      opts.push({ aa: CODE[c2], anti: [...c2].map((b) => PAIR_RNA[b]).join(''), good: false });
    }
    opts.sort(() => Math.random() - 0.5);
    const centre = this.site(this.fr.pCodon, vec3.create());
    this.choices = opts.map((o, i) => {
      const home = vec3.clone(centre);
      vec3.scaleAndAdd(home, home, this.right, (i - 1.5) * 10.5);
      vec3.scaleAndAdd(home, home, this.up, -21 + (i % 2) * 2.5);
      // toward the camera, in front of the ribosome
      vec3.scaleAndAdd(home, home, this.toCam, 15);
      return { ...o, home, pos: vec3.clone(home), rot: quat.create(), spin: Math.random() * 6, out: 0 };
    });
    this.picked = -1;
    this.renderChoices();
  }

  // ---------------------------------------------------------------- input
  private key(e: KeyboardEvent) {
    if (e.key >= '1' && e.key <= '4') this.pick(Number(e.key) - 1);
    else if ((e.key === 'Enter' || e.key === ' ') && this.phase === 'intro') this.begin();
  }
  private begin() {
    if (this.phase !== 'intro') return;
    this.ui.intro?.remove();
    this.phase = 'choose';
    this.t = 0;
    this.startTime = this.time;
    this.ctx.sound('click');
    this.say(`The start codon ${[...'AUG'].map(colored).join('')} is already read: methionine sits in the P site. Next codon →`);
  }
  private pick(i: number) {
    if (this.phase === 'intro') this.begin();
    if (this.phase !== 'choose' || !this.choices[i]) return;
    this.tries++;
    this.picked = i;
    this.t = 0;
    const c = this.choices[i];
    const card = this.ui.choices.children[i] as HTMLElement;
    if (c.good) {
      this.phase = 'dock';
      card.classList.add('good');
      this.ctx.sound('good');
      this.say(`${AA[c.aa].name} — the anticodon pairs. Peptide bond!`);
    } else {
      this.phase = 'reject';
      this.wrong++;
      card.classList.remove('bad'); void card.offsetWidth; card.classList.add('bad');
      this.ctx.sound('bad');
      const cod = this.codon(this.n);
      this.say(`${[...c.anti].map(colored).join('')} doesn't pair with ${[...cod].map(colored).join('')} — rejected.`);
    }
  }

  // ---------------------------------------------------------------- per frame
  update(dt: number) {
    this.time += dt;
    this.t += dt;
    const ph = this.phase;
    if (ph === 'dock' && this.t > 0.6) { this.addResidue(); this.phase = 'shift'; this.t = 0; }
    else if (ph === 'reject' && this.t > 0.7) { this.choices[this.picked].out = 0; this.phase = 'choose'; this.picked = -1; }
    else if (ph === 'shift') {
      this.slide = Math.min(this.n - 1, this.slide + dt / 0.45);
      if (this.t > 0.5) {
        this.slide = this.n - 1;
        if (this.n > INTERACTIVE) { this.phase = 'auto'; this.interactiveTime = this.time - this.startTime; this.t = 0; this.autoN = this.n; this.autoUi(); }
        else { this.phase = 'choose'; this.newChoices(); }
      }
    } else if (ph === 'auto') this.auto(dt);
    else if (ph === 'release' && this.t > 2.2) this.startFold();
    else if (ph === 'fold' && this.t > 5.5 && !this.ui.sum) this.summary();

    this.draw(dt);
    this.camera(dt);
    this.updateUi();
  }

  private addResidue() {
    const aa = CODE[this.codon(this.n)];
    this.chain.push(vec3.create());
    this.n++;
    // the old P-site tRNA leaves from the E site
    const pose = this.tRnaPose(-1, vec3.create(), quat.create());
    this.leaving.push({ pos: vec3.clone(pose), rot: quat.clone(_r_q), t: 0, aa });
    if (this.leaving.length > 4) this.leaving.shift();
  }

  private auto(dt: number) {
    // the rest of the gene, fast: about 5 amino acids a second in life, here speeding up to 45 a second
    this.autoN += dt * Math.min(45, 3 + this.t * 9);
    while (this.n < Math.min(238, Math.floor(this.autoN))) this.addResidue();
    this.slide += (this.n - 1 - this.slide) * (1 - Math.exp(-dt * 12));
    if (this.n >= 238 && Math.abs(this.slide - (this.n - 1)) < 0.05) {
      this.phase = 'release';
      this.t = 0;
      this.ctx.sound('pop');
      this.say(`Stop codon ${[...'UAA'].map(colored).join('')}: no tRNA reads it. A release factor frees the chain.`);
    }
  }

  private startFold() {
    this.phase = 'fold';
    this.t = 0;
    // GFP's barrel, built from its beads (one per residue), gathering in front of the ribosome — on the line of sight
    // the game has kept clear, so nothing from the crowd steps between
    const g = this.ctx.mols.types[MOL.gfp].levels[0].beads;
    vec3.scaleAndAdd(this.gfpPos, this.view().pivot, this.toCam, 6);
    quat.setAxisAngle(this.gfpRot, vec3.normalize(_r_a, [0.3, 1, 0.2]), 0.8);
    const nb = g.length / 4;
    this.folded = this.chain.map((_, i) => {
      const k = Math.min(nb - 1, Math.round((i * (nb - 1)) / Math.max(1, this.chain.length - 1)));
      const p = vec3.transformQuat(vec3.create(), [g[k * 4], g[k * 4 + 1], g[k * 4 + 2]], this.gfpRot);
      return vec3.add(p, p, this.gfpPos);
    });
    this.say('Released, the chain folds on its own into a barrel of eleven strands — and its chromophore lights.');
    this.ui.choices.innerHTML = '';
    this.ui.strip.style.opacity = '0';
  }

  /** a tRNA in site k (0 = A, -1 = P, -2 = E): its position (and rotation into _r_q) */
  private tRnaPose(k: number, out: Vec3, rot: Quat): Vec3 {
    const f = this.fr;
    // the native P-site pose, shifted along the mRNA by k codons
    vec3.scaleAndAdd(_r_a, f.tpos, f.mrna, (k + 1) * PITCH);
    this.site(_r_a, out);
    quat.multiply(rot, this.q, f.tq);
    quat.copy(_r_q, rot);
    return out;
  }
  private aaBall(pos: Vec3, rot: Quat, out: Vec3) {
    const T = this.ctx.mols.types[MOL.trna].levels[0].beads;
    vec3.transformQuat(out, [T[150 * 4], T[150 * 4 + 1], T[150 * 4 + 2]], rot);
    return vec3.add(out, out, pos);
  }

  private draw(dt: number) {
    const E = this.emit, f = this.fr;
    E.begin();
    // the ribosome
    E.mol(MOL.ribosome, this.O, this.q, 1);
    // the mRNA: a nucleotide every 0.6 nm, bases toward the decoding site; it slides as the ribosome steps
    const base0 = (this.slide) * 3;        // the P-site codon's first nucleotide
    const pc = this.site(f.pCodon, _r_b);
    const mdir = this.right;
    const pulse = 1 + 0.25 * Math.sin(this.time * 6);
    const ph0 = this.phase;
    for (let m = Math.max(-18, Math.floor(base0) - 40); m < Math.min(GFP_RNA.length + 18, base0 + 46); m++) {
      const x = (m - base0 - 1) * NT;
      // away from the ribosome the strand loosens and curves off
      const off = Math.max(0, Math.abs(x) - 7);
      vec3.scaleAndAdd(_r_a, pc, mdir, x);
      vec3.scaleAndAdd(_r_a, _r_a, this.up, off * off * 0.025 + Math.sin(m * 0.7) * off * 0.06);
      const b = m >= 0 && m < GFP_RNA.length ? GFP_RNA[m] : 'AUGC'[(m * 7 + 3) & 3];
      const inA = this.phase === 'choose' && m >= this.n * 3 && m < this.n * 3 + 3;
      E.ball(_r_a, inA ? 0.42 : 0.32, tint('#ff5d8f'));
      vec3.scaleAndAdd(_r_c, _r_a, this.up, inA ? -0.75 : -0.55);
      E.ball(_r_c, inA ? 0.5 * pulse : 0.3, tint(BASE_3D[b]));
    }
    // a dotted line from the A-site codon down to where its tRNA will dock
    if (ph0 === 'choose') {
      const site = this.tRnaPose(0, _r_b, _r_q2);
      vec3.scaleAndAdd(_r_c, pc, mdir, (this.n * 3 + 1 - base0 - 1) * NT);
      for (let k = 1; k < 9; k++) {
        const u = ((k + this.time * 2.5) % 9) / 9;
        vec3.lerp(_r_a, _r_c, site, u);
        E.ball(_r_a, 0.16 * Math.sin(u * Math.PI), tint('#fff4e6'));
      }
    }
    // tRNAs: the floating choices, the one docking, the ones leaving
    const ph = this.phase;
    if (ph === 'choose' || ph === 'dock' || ph === 'reject') {
      this.choices.forEach((c, i) => {
        c.spin += dt * 0.4;
        const bob = Math.sin(this.time * 1.3 + i * 1.7) * 0.8;
        const aRot = quat.setAxisAngle(_r_q2, vec3.normalize(_r_c, [0.2, 1, 0.1]), c.spin);
        if (i === this.picked && ph === 'dock') {
          // fly into the A site
          const k = Math.min(1, this.t / 0.55), e = k * k * (3 - 2 * k);
          const target = this.tRnaPose(0, vec3.create(), quat.create());
          vec3.lerp(c.pos, c.home, target, e);
          quat.slerp(c.rot, aRot, _r_q, e);
        } else if (i === this.picked && ph === 'reject') {
          // nudged toward the site, then shoved back out
          const k = this.t / 0.7;
          const target = this.tRnaPose(0, vec3.create(), quat.create());
          vec3.lerp(c.pos, c.home, target, Math.sin(k * Math.PI) * 0.45);
          quat.copy(c.rot, aRot);
        } else {
          vec3.scaleAndAdd(c.pos, c.home, this.up, bob);
          quat.copy(c.rot, aRot);
          if (ph === 'dock') return;   // the others drift off as the right one docks
        }
        E.mol(MOL.trna, c.pos, c.rot, 1);
        E.ball(this.aaBall(c.pos, c.rot, _r_a), 1.15, tint(CLASS_HEX[AA[c.aa].cls]));
      });
    }
    // the tRNA now in the P site (it took the chain), after the first step
    if (this.n > 1 && ph !== 'fold' && ph !== 'done') {
      const k = ph === 'shift' ? Math.min(1, this.t / 0.45) : 1;
      const pos = this.tRnaPose(-k, vec3.create(), quat.create());
      E.mol(MOL.trna, pos, _r_q, 1);
    }
    for (const l of this.leaving) {
      l.t += dt;
      const k = l.t / 1.6;
      if (k >= 1) continue;
      const p = vec3.scaleAndAdd(_r_a, l.pos, this.up, k * 9);
      vec3.scaleAndAdd(p, p, this.right, -k * 10);
      E.mol(MOL.trna, p, l.rot, 1 - k * k);
    }
    // the chain: newest residue at the peptidyl centre, older ones down the tunnel and out
    const n = this.chain.length;
    if (ph === 'fold' || ph === 'done') {
      const k = Math.min(1, this.t / 3.2);
      for (let i = 0; i < n; i++) {
        // fold from the N-terminus on: each residue settles a little after the one before
        const ki = Math.max(0, Math.min(1, k * 1.6 - (i / n) * 0.6));
        const e = ki * ki * (3 - 2 * ki);
        const from = this.chainPath[Math.min(this.chainPath.length - 1, n - 1 - i + 2)];
        vec3.lerp(_r_a, from, this.folded[i], e);
        vec3.scaleAndAdd(_r_a, _r_a, this.up, -e * (1 - e) * 4);
        const shrink = this.t > 3.4 ? Math.max(0, 1 - (this.t - 3.4) / 0.8) : 1;
        E.ball(_r_a, 0.4 * shrink, tint(CLASS_HEX[AA[CODE[this.codon(i)]].cls]));
      }
      if (this.t > 3.2) E.mol(MOL.gfp, this.gfpPos, this.gfpRot, Math.min(1, (this.t - 3.2) / 0.7));
    } else {
      const released = ph === 'release' ? Math.min(1, this.t / 2) : 0;
      for (let i = 0; i < n; i++) {
        const along = n - 1 - i + released * 6;
        const pi = Math.min(this.chainPath.length - 1, Math.floor(along));
        vec3.lerp(_r_a, this.chainPath[pi], this.chainPath[Math.min(this.chainPath.length - 1, pi + 1)], along - pi);
        E.ball(_r_a, 0.42, tint(CLASS_HEX[AA[CODE[this.codon(i)]].cls]));
      }
    }
  }

  private camera(dt: number) {
    const v = this.view();
    const ph = this.phase;
    let scale = v.scale, pivot = v.pivot, pitch = -0.12;
    if (ph === 'auto') { scale = 85; vec3.scaleAndAdd(pivot, pivot, this.up, -10); }
    if (ph === 'release') { scale = 75; vec3.scaleAndAdd(pivot, pivot, this.up, -12); }
    // (no closer than ~57 nm: the molecular field's finest level would fade in round the camera)
    if (ph === 'fold' || ph === 'done') { pivot = vec3.clone(this.gfpPos); scale = 60; }
    const sway = ph === 'fold' || ph === 'done' ? 0 : Math.sin(this.time * 0.17) * 0.12;
    // the finale narrows the lens instead of moving in: the same distance keeps the crowd as it was, while the
    // protein grows on screen (and so is drawn in full detail)
    const cam = this.ctx.kit.camera;
    const fov = ph === 'fold' || ph === 'done' ? 0.49 : this.fov0;
    cam.fovY += (fov - cam.fovY) * (1 - Math.exp(-dt * 1.2));
    steerCamera(this.ctx, pivot, scale, this.yaw + sway, pitch, dt, ph === 'fold' ? 1.4 : 2.2);
  }

  // ---------------------------------------------------------------- interface
  private buildUi() {
    const P = this.ctx.panel;
    P.innerHTML = `
      <div class="rg-top"><div class="rg-role">You are a ribosome</div><div class="rg-title">Read the code</div>
        <div class="rg-goal">Build green fluorescent protein: pick the tRNA whose anticodon pairs with the codon in your A site.</div></div>
      <div class="rg-stats"><div class="rg-stat">amino acids<b data-k="n">1</b></div><div class="rg-stat">accuracy<b data-k="acc">—</b></div><div class="rg-stat">speed<b data-k="rate">—</b></div></div>
      <button class="rg-x" title="Leave (Esc)">×</button>
      <div class="rg-bottom">
        <div class="rg-msg"></div>
        <div class="rg-strip rg-glass"></div>
        <div class="rg-choices"></div>
      </div>
      <div class="rg-intro rg-glass"><div class="rg-role">You are a ribosome</div><h2>Read the code</h2>
        <p>A messenger RNA copied from the GFP gene threads through you. Three letters at a time — a codon — it asks for one amino acid.</p>
        <p>Transfer RNAs bring them. Each carries an anticodon that pairs with exactly one codon: <b style="color:${BASE_UI.A}">A</b>–<b style="color:${BASE_UI.U}">U</b>, <b style="color:${BASE_UI.G}">G</b>–<b style="color:${BASE_UI.C}">C</b>. Pick the one that fits (click it, or press 1–4).</p>
        <div class="rg-acts"><button class="btn btn-play rg-go">Begin translating</button></div></div>`;
    const q = (s: string) => P.querySelector(s) as HTMLElement;
    this.ui = { msg: q('.rg-msg'), strip: q('.rg-strip'), choices: q('.rg-choices'), intro: q('.rg-intro'), n: q('[data-k=n]'), acc: q('[data-k=acc]'), rate: q('[data-k=rate]'), bottom: q('.rg-bottom') };
    q('.rg-x').addEventListener('click', () => this.ctx.exit());
    q('.rg-go').addEventListener('click', () => this.begin());
    // numbered badges that follow the floating tRNAs
    for (let i = 0; i < 4; i++) {
      const b = document.createElement('div');
      b.className = 'rg-badge';
      b.textContent = String(i + 1);
      P.append(b);
      this.ui[`badge${i}`] = b;
    }
    this.renderChoices();
  }
  private renderChoices() {
    const el = this.ui.choices;
    if (!el) return;
    el.innerHTML = this.choices.map((c, i) => {
      const a = AA[c.aa];
      return `<button class="rg-choice rg-glass" data-i="${i}"><span class="k">${i + 1}</span>
        <div class="ends">3′ anticodon 5′</div><div class="ac">${[...c.anti].map(colored).join('')}</div>
        <div class="aa"><i style="background:${CLASS_HEX[a.cls]}"></i>${a.three} · ${a.name}</div></button>`;
    }).join('');
    for (const b of el.querySelectorAll<HTMLButtonElement>('.rg-choice')) b.addEventListener('click', () => this.pick(Number(b.dataset.i)));
  }
  private autoUi() {
    this.ui.choices.style.display = 'block';
    this.ui.choices.innerHTML = `<div class="rg-glass" style="padding:12px 18px;text-align:center;width:100%">
      <div style="font:13px var(--sans);color:var(--dim)">You've got the hang of it. Translating the other ${238 - INTERACTIVE} codons — real ribosomes add about 5 amino acids a second; this is sped up.</div>
      <div class="rg-bar" style="margin:10px auto 0"><i></i></div></div>`;
    this.ui.bar = this.ui.choices.querySelector('.rg-bar i') as HTMLElement;
    this.say('');
  }
  private say(html: string) { if (this.ui.msg) this.ui.msg.innerHTML = html; }

  private updateUi() {
    const u = this.ui;
    if (!u.n) return;
    u.n.textContent = `${this.n} / 238`;
    u.acc.textContent = this.tries ? `${Math.round(((this.tries - this.wrong) / this.tries) * 100)}%` : '—';
    const el = this.phase === 'auto' ? this.interactiveTime : this.time - this.startTime;
    u.rate.textContent = this.phase !== 'intro' && el > 0 ? `${((this.n - 1) / Math.max(el, 0.1)).toFixed(1)} aa/s` : '—';
    // the strip: E, P, A codons and what's coming
    const c0 = Math.max(0, this.n - 2);
    let html = '';
    for (let i = c0; i < Math.min(239, c0 + 6); i++) {
      const cls = i === this.n ? 'a' : i === this.n - 1 ? 'p' : i === this.n - 2 ? 'e' : '';
      const label = i === this.n ? 'A site' : i === this.n - 1 ? 'P site' : i === this.n - 2 ? 'E site' : '';
      html += `<div class="rg-codon ${cls}"><small>${label}&nbsp;</small><span>${[...this.codon(i)].map(colored).join('')}</span></div>`;
    }
    if (u.strip.dataset.k !== html) { u.strip.innerHTML = html; u.strip.dataset.k = html; }
    if (u.bar) u.bar.style.width = `${(this.n / 238) * 100}%`;
    // badges over the 3D tRNAs while choosing
    for (let i = 0; i < 4; i++) {
      const b = u[`badge${i}`];
      const c = this.choices[i];
      const show = c && (this.phase === 'choose' || (this.phase === 'reject' && i === this.picked)) && !this.ctx.controls.flying;
      const s = show ? project(this.ctx, vec3.scaleAndAdd(_r_a, c.pos, this.up, 5.5), _r_px) : null;
      b.style.opacity = s ? '1' : '0';
      if (s) b.style.transform = `translate(${s[0]}px, ${s[1]}px)`;
    }
  }

  private summary() {
    this.phase = 'done';
    this.ctx.sound('win');
    const acc = this.tries ? Math.round(((this.tries - this.wrong) / this.tries) * 100) : 100;
    const rate = INTERACTIVE / Math.max(0.1, this.interactiveTime);
    const box = document.createElement('div');
    box.className = 'rg-sum rg-glass';
    box.innerHTML = `<div class="rg-role">Protein made</div><h2>Green fluorescent protein</h2>
      <div class="nums"><div>amino acids<b>238</b></div><div>your accuracy<b>${acc}%</b></div><div>your speed<b>${rate.toFixed(1)}/s</b></div></div>
      <p>A real ribosome adds about <b>5 amino acids a second</b> and picks the wrong tRNA only about <b>once in 10,000</b> — it checks the codon–anticodon fit twice before committing.</p>
      <p>GFP's glow comes from three of the amino acids you placed — <b>Ser65, Tyr66, Gly67</b> — which, once the barrel folds round them, react with oxygen to form the chromophore.</p>
      <p style="color:var(--faint);font-size:12px">Simplified: one tRNA per amino acid (cells have ~45 kinds, with wobble pairing), no elongation factors, and folding sped up from milliseconds to seconds.</p>
      <div class="rg-acts"><button class="btn btn-play rg-again">Play again</button><button class="btn rg-back">Back to the cell</button></div>`;
    this.ctx.panel.append(box);
    this.ui.sum = box;
    this.ui.bottom.style.opacity = '0';
    box.querySelector('.rg-again')!.addEventListener('click', () => {
      box.remove();
      this.ui.sum = undefined as unknown as HTMLElement;
      this.ui.bottom.style.opacity = '1';
      this.ui.strip.style.opacity = '1';
      this.ui.choices.style.display = '';
      this.ui.bar = undefined as unknown as HTMLElement;
      this.reset();
      this.begin();
    });
    box.querySelector('.rg-back')!.addEventListener('click', () => this.ctx.exit());
  }
}

registerGame(new Ribosome());
