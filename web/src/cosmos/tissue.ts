// The tissue at the bottom of the dive: a sheet of cells ~20 µm across on a jittered hexagonal lattice in the plane
// y = 0 (nm), the first cell at its centre. One sheet, drawn three ways so the hand-over between the cosmos and the
// cell's world is one picture: the cell's world builds its nearest cells from it (world/layout.ts) and paints the rest
// beyond them (shaders/post.wgsl), and the cosmos paints all of it on Lyra's cornea round the dive's target
// (figure.wgsl), the eye frame's axes the cell world's (frames.ts). shaders/tissue.wgsl has the same lattice and hash.
export const TISSUE = {
  /** the lattice's spacing (nm) */
  spacing: 21000,
  /** the cells within this of the centre are the cell world's own (meshes); beyond, painted */
  near: 48000,
};

const h32 = (x: number) => {
  const v = (Math.imul(x >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((v >>> ((v >>> 28) + 4)) ^ v) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
};
/** 0..1 from a lattice site and a channel */
export const tissueRand = (i: number, j: number, k: number) => h32((i >>> 0) ^ h32((j >>> 0) ^ h32(k >>> 0))) / 4294967296;

export interface TissueCell {
  /** its middle (nm) */
  at: [number, number, number];
  /** its size (1: an 8.8 x 6.4 x 8.6 µm half-extent blob) */
  s: number;
  /** its nucleus, from its middle (nm) */
  nucleus: [number, number, number];
}

/** the cell at lattice site (i, j) */
export function tissueCell(i: number, j: number): TissueCell {
  const sp = TISSUE.spacing, R = (k: number) => tissueRand(i, j, k);
  let x = (i + 0.5 * (j & 1)) * sp, z = j * sp * 0.8660254;
  if (i !== 0 || j !== 0) { x += (R(0) - 0.5) * 0.12 * sp; z += (R(1) - 0.5) * 0.12 * sp; }
  const y = i === 0 && j === 0 ? 0 : -1800 + 3000 * R(3);
  const s = 0.8 + 0.2 * R(2);
  // (the nucleus off its middle a little, any way)
  const a = R(4) * Math.PI * 2, c = R(5) * 2 - 1, r = Math.sqrt(1 - c * c);
  return { at: [x, y, z], s, nucleus: [Math.cos(a) * r * 1500, c * 1500, Math.sin(a) * r * 1500] };
}

/** the sheet's cells within `radius` of the centre (nm), the centre's own first */
export function tissueNear(radius: number): TissueCell[] {
  const sp = TISSUE.spacing, n = Math.ceil(radius / sp) + 1, out: TissueCell[] = [];
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    const c = tissueCell(i, j);
    if (Math.hypot(c.at[0], c.at[2]) < radius) out.push(c);
  }
  return out.sort((a, b) => Math.hypot(a.at[0], a.at[2]) - Math.hypot(b.at[0], b.at[2]));
}
