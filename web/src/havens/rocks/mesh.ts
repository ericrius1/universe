// The mesh every rock and crystal is built into: positions in the rock's own metres (y up, the ground at y = 0), and per
// vertex a bed coordinate (the stratum's id plus how far up it the vertex is, 0..1; for a crystal its index in the
// cluster plus how far along it), an ambient term (0..1) and flags. Triangles are wound counter-clockwise seen from
// outside; normals are area-weighted over the vertices a surface shares, so a surface is smooth where its vertices are
// shared and creased where a builder starts new ones (crystal facets), and short arcs of rings round a convex edge
// (strata.ts) keep a ledge's edge crisp but rounded, without a seam.
//
// `revolve` turns a profile into a surface of revolution about a vertical (optionally leaning) axis: one ring per
// profile point, each ring's radius shaped by its outline (a function of the angle), consecutive rings stitched, and a
// point of radius 0 closing it with a fan. Rings at the same height make the horizontal steps of ledges and caps; they
// are kept from crossing each other so the step faces never flip. Its ambient term is the sky a point sees past the
// overhangs above it (a ledge, a cap) and its nearness to the ground.

export type V3 = [number, number, number];

/** what a vertex is, for the shader */
export const RF = {
  HARD: 1,      // a hard bed: the ledge-formers and caprock, paler
} as const;

export interface RockMesh {
  pos: Float32Array;
  nrm: Float32Array;
  /** the bed's id plus the fraction up it (a crystal: its index plus the fraction along it) */
  bed: Float32Array;
  ao: Float32Array;
  flags: Uint8Array;
  idx: Uint32Array;
}

export class MeshKit {
  private P: number[] = [];
  private B: number[] = [];
  private A: number[] = [];
  private F: number[] = [];
  private I: number[] = [];

  vert(x: number, y: number, z: number, bed: number, ao: number, flags: number): number {
    this.P.push(x, y, z);
    this.B.push(bed);
    this.A.push(ao);
    this.F.push(flags);
    return this.P.length / 3 - 1;
  }

  tri(a: number, b: number, c: number) { this.I.push(a, b, c); }

  /** two closed rings of equal length (the profile walked from a to b), wound so the surface faces outward from the
   *  axis when a is below b, upward when b is inside a at the same height, downward when outside */
  strip(a: number[], b: number[]) {
    const n = a.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.I.push(a[i], b[i], a[j], a[j], b[i], b[j]);
    }
  }

  /** an upward-facing fan from a centre to a ring (angles increasing) */
  fanUp(c: number, ring: number[]) {
    for (let i = 0; i < ring.length; i++) this.I.push(c, ring[(i + 1) % ring.length], ring[i]);
  }

  /** a downward-facing fan */
  fanDown(c: number, ring: number[]) {
    for (let i = 0; i < ring.length; i++) this.I.push(c, ring[i], ring[(i + 1) % ring.length]);
  }

  finish(): RockMesh {
    const pos = new Float32Array(this.P);
    const idx = new Uint32Array(this.I);
    const nrm = new Float32Array(pos.length);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) { nrm[k] += nx; nrm[k + 1] += ny; nrm[k + 2] += nz; }
    }
    for (let i = 0; i < pos.length; i += 3) {
      const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
      nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
    }
    return { pos, nrm, bed: new Float32Array(this.B), ao: new Float32Array(this.A), flags: new Uint8Array(this.F), idx };
  }
}

/** a radius multiplier (or a height offset) as a function of the angle about the axis */
export type Outline = (theta: number) => number;
const flat: Outline = () => 0;

/** one point of a profile, walked from the buried foot up the side and in over the top */
export interface Pt {
  /** radius before the outline (m); 0 closes the surface at the axis */
  r: number;
  y: number;
  o: Outline;
  /** height offset round the ring (a wavy ledge); default none */
  dy?: Outline;
  /** bed coordinate: id + fraction up the bed */
  bed: number;
  flags: number;
  /** starts a new surface here: not stitched to the point before (a bed's own copy of a shared corner, so a face
   *  takes one bed's colour, not a blend of two) */
  brk?: boolean;
}

export interface RevolveOpts {
  /** angle steps round the axis */
  n: number;
  /** the axis's horizontal offset at a height (a lean); default upright through the origin */
  axis?: (y: number) => [number, number];
  /** where the ground meets it (y), for the ambient's contact darkening; default 0 */
  ground?: number;
  /** the angle of the first step (so neighbours don't line their seams up) */
  phase?: number;
}

/** a profile's radius (R[point][sample]) and height (Y) at each sample round it (angles, or a fin's two sides): the
 *  radius before the outline times the outline, the height plus the waves */
export function sampleProfile(pts: Pt[], th: number[]): { R: Float64Array[]; Y: Float64Array[] } {
  const R = pts.map((p) => Float64Array.from(th, (t) => Math.max(0, p.r * p.o(t))));
  const Y = pts.map((p) => Float64Array.from(th, (t) => p.y + (p.dy ?? flat)(t)));
  // (a step's two rings at one height: the inner kept inside the outer at every sample, so the step never folds over)
  for (let j = 1; j < pts.length; j++) {
    const a = pts[j - 1], b = pts[j];
    // (a bed's own copy of the corner before it: the same ring exactly)
    if (b.brk && a.r === b.r && a.y === b.y) { R[j] = R[j - 1].slice(); Y[j] = Y[j - 1].slice(); continue; }
    if (Math.abs(a.y - b.y) > 1e-3 || a.r === b.r || b.r === 0) continue;
    const gap = Math.abs(a.r - b.r) * 0.08;
    for (let i = 0; i < th.length; i++) {
      if (b.r < a.r) R[j][i] = Math.min(R[j][i], R[j - 1][i] - gap);
      else R[j][i] = Math.max(R[j][i], R[j - 1][i] + gap);
    }
    // (an outward step is followed by the edge rounding up and out: kept widening ring by ring where pushed out)
    if (b.r > a.r) {
      for (let k = j + 1; k < pts.length && pts[k].r > pts[k - 1].r && pts[k].y >= pts[k - 1].y; k++) {
        for (let i = 0; i < th.length; i++) R[k][i] = Math.max(R[k][i], R[k - 1][i] + 1e-3);
      }
    }
  }
  return { R, Y };
}

/** revolve a profile into the kit (see the header) */
export function revolve(kit: MeshKit, pts: Pt[], o: RevolveOpts) {
  const n = o.n, phase = o.phase ?? 0, ground = o.ground ?? 0;
  const th = Array.from({ length: n }, (_, i) => phase + (i / n) * Math.PI * 2);
  const { R, Y } = sampleProfile(pts, th);
  const height = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
  const rings: number[][] = [];
  for (let j = 0; j < pts.length; j++) {
    const p = pts[j];
    if (p.r === 0) {
      const [cx, cz] = o.axis ? o.axis(p.y) : [0, 0];
      const ao = ambientAt(R, Y, j, 0, p.y, ground, height);
      rings.push([kit.vert(cx, p.y, cz, p.bed, ao, p.flags)]);
      continue;
    }
    const ring: number[] = [];
    for (let i = 0; i < n; i++) {
      const y = Y[j][i];
      const [cx, cz] = o.axis ? o.axis(y) : [0, 0];
      const ao = ambientAt(R, Y, j, i, y, ground, height);
      ring.push(kit.vert(cx + R[j][i] * Math.cos(th[i]), y, cz + R[j][i] * Math.sin(th[i]), p.bed, ao, p.flags));
    }
    rings.push(ring);
  }
  for (let j = 1; j < rings.length; j++) {
    const a = rings[j - 1], b = rings[j];
    if (pts[j].brk) continue;
    // (the walk closes at the axis over the top when it ends there, under the bottom when it starts there)
    if (b.length === 1 && a.length > 1) kit.fanUp(b[0], a);
    else if (a.length === 1 && b.length > 1) kit.fanDown(a[0], b);
    else if (a.length > 1 && b.length > 1) kit.strip(a, b);
  }
}

/** the sky a point of ring j (angle step i, height y) sees past what overhangs it further along the profile, and how
 *  close it sits to the ground: 1 open, toward 0.2 deep under a cap */
function ambientAt(R: Float64Array[], Y: Float64Array[], j: number, i: number, y: number, ground: number, height: number): number {
  const r = R[j][i];
  let beta = Math.PI / 2;
  for (let k = j + 1; k < R.length; k++) {
    const dy = Y[k][i] - y, dr = R[k][i] - r;
    if (dy > 0.02 && dr > 0.02) beta = Math.min(beta, Math.atan2(dy, dr));
  }
  const open = Math.sqrt(beta / (Math.PI / 2));
  const t = Math.min(1, Math.max(0, (y - ground + 0.2) / (1.2 + height * 0.04)));
  const contact = 0.55 + 0.45 * t * t * (3 - 2 * t);
  return Math.max(0.12, (0.22 + 0.78 * open) * contact);
}
