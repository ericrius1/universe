// Organelle meshes from layout.ts's surfaces: every shape is a lathe — rows of a profile × columns round an axis — so
// one grid builder covers blobs (latitude × longitude), capsules (cap, tube, cap) and bent discs (underside, rim, top).
// Vertices sit exactly on the analytic surface the GPU places molecules on. Normals are the faces' averaged.
// Vertex (32 bytes): position, normal, organelle index, flags.
import { type Organelle, Shape, blobRadius, capsuleRadius, discFrame, discRim, v3 } from './layout';
import type { V3 } from './noise';

export const MESH_VERTEX_BYTES = 32;

export interface MeshSet {
  vertices: Float32Array;   // 8 floats per vertex (the last two read as u32)
  indices: Uint32Array;
  /** the index range of the shells (membranes drawn twice: outer and inner surface) */
  shellCount: number;
  /** per organelle: first index, index count */
  ranges: [number, number][];
}

class Grid {
  v: Float32Array;
  u: Uint32Array;
  i: Uint32Array;
  nv = 0;
  ni = 0;
  constructor(verts: number, idx: number) {
    this.v = new Float32Array(verts * 8);
    this.u = new Uint32Array(this.v.buffer);
    this.i = new Uint32Array(idx);
  }
  ensure(verts: number, idx: number) {
    if ((this.nv + verts) * 8 > this.v.length) {
      const n = new Float32Array(Math.max(this.v.length * 2, (this.nv + verts) * 8));
      n.set(this.v);
      this.v = n;
      this.u = new Uint32Array(n.buffer);
    }
    if (this.ni + idx > this.i.length) {
      const n = new Uint32Array(Math.max(this.i.length * 2, this.ni + idx));
      n.set(this.i);
      this.i = n;
    }
  }
  /** rows × cols positions (cols wrap round), triangulated, with smooth normals */
  lathe(rows: number, cols: number, pos: (i: number, j: number) => V3, org: number, flags = 0) {
    this.ensure(rows * cols, (rows - 1) * cols * 6);
    const base = this.nv, v = this.v;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const p = pos(i, j), k = (base + i * cols + j) * 8;
        v[k] = p[0]; v[k + 1] = p[1]; v[k + 2] = p[2];
        v[k + 3] = 0; v[k + 4] = 0; v[k + 5] = 0;
        this.u[k + 6] = org; this.u[k + 7] = flags;
      }
    }
    this.nv += rows * cols;
    const I = this.i;
    const at = (i: number, j: number) => base + i * cols + (j % cols);
    const acc = (a: number, b: number, c: number) => {
      const ax = v[a * 8], ay = v[a * 8 + 1], az = v[a * 8 + 2];
      const e1x = v[b * 8] - ax, e1y = v[b * 8 + 1] - ay, e1z = v[b * 8 + 2] - az;
      const e2x = v[c * 8] - ax, e2y = v[c * 8 + 1] - ay, e2z = v[c * 8 + 2] - az;
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      for (const q of [a, b, c]) { v[q * 8 + 3] += nx; v[q * 8 + 4] += ny; v[q * 8 + 5] += nz; }
    };
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < cols; j++) {
        const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
        // (rows run along the axis e1 × e2 of the columns' turn: this order faces outward, counter-clockwise from outside)
        I[this.ni++] = a; I[this.ni++] = c; I[this.ni++] = b;
        I[this.ni++] = a; I[this.ni++] = d; I[this.ni++] = c;
        acc(a, c, b); acc(a, d, c);
      }
    }
    // the poles (a row that is one point) share one normal: average across the row
    for (let i = 0; i < rows; i++) {
      const p0 = at(i, 0);
      let same = true;
      for (let j = 1; j < cols && same; j++) {
        const q = at(i, j);
        same = Math.abs(v[q * 8] - v[p0 * 8]) + Math.abs(v[q * 8 + 1] - v[p0 * 8 + 1]) + Math.abs(v[q * 8 + 2] - v[p0 * 8 + 2]) < 1e-3;
      }
      if (!same) continue;
      let sx = 0, sy = 0, sz = 0;
      for (let j = 0; j < cols; j++) { const q = at(i, j); sx += v[q * 8 + 3]; sy += v[q * 8 + 4]; sz += v[q * 8 + 5]; }
      for (let j = 0; j < cols; j++) { const q = at(i, j); v[q * 8 + 3] = sx; v[q * 8 + 4] = sy; v[q * 8 + 5] = sz; }
    }
    for (let q = base; q < this.nv; q++) {
      const k = q * 8, l = Math.hypot(v[k + 3], v[k + 4], v[k + 5]) || 1;
      v[k + 3] /= l; v[k + 4] /= l; v[k + 5] /= l;
    }
  }
}

/** how finely to tessellate: rows/columns for each shape, scaled by quality (1 = desktop) */
function detail(o: Organelle, q: number): [number, number] {
  const big = o.r > 5000 ? 1 : 0;
  if (o.shape === Shape.Blob) {
    if (big) return [Math.round(200 * q), Math.round(400 * q)];
    if (o.r > 2000) return [Math.round(110 * q), Math.round(220 * q)];
    if (o.r > 600) return [Math.round(48 * q), Math.round(96 * q)];
    return [Math.max(10, Math.round(20 * q)), Math.max(16, Math.round(36 * q))];
  }
  if (o.shape === Shape.Capsule) return [Math.round(44 * q), Math.max(16, Math.round(36 * q))];
  return [Math.max(4, Math.round((o.r > 800 ? 14 : 7) * q)), Math.max(20, Math.round((o.r > 800 ? 110 : 40) * q))];
}

function blobGrid(g: Grid, o: Organelle, idx: number, q: number) {
  const [rows, cols] = detail(o, q);
  g.lathe(rows + 1, cols, (i, j) => {
    const th = (i / rows) * Math.PI, ph = (j / cols) * Math.PI * 2;
    const u: V3 = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    return v3.add(o.a, v3.mul(u, blobRadius(o, u)));
  }, idx);
}

function capsuleGrid(g: Grid, o: Organelle, idx: number, q: number) {
  const [rows, cols] = detail(o, q);
  const ab = v3.sub(o.b, o.a), axis = v3.norm(ab);
  const [e1, e2] = discFrame(axis);
  const capRows = Math.max(4, Math.round(rows * 0.25)), tubeRows = rows - 2 * capRows;
  // profile: (axial point on the segment, direction from it as (axial, radial) weights)
  const prof: { s: V3; ax: number; ra: number }[] = [];
  for (let k = 0; k <= capRows; k++) {
    const b = (k / capRows) * Math.PI / 2;
    prof.push({ s: o.a, ax: -Math.cos(b), ra: Math.sin(b) });
  }
  for (let k = 1; k < tubeRows; k++) prof.push({ s: v3.add(o.a, v3.mul(ab, k / tubeRows)), ax: 0, ra: 1 });
  for (let k = 0; k <= capRows; k++) {
    const b = (k / capRows) * Math.PI / 2;
    prof.push({ s: o.b, ax: Math.sin(b), ra: Math.cos(b) });
  }
  g.lathe(prof.length, cols, (i, j) => {
    const p = prof[i], ph = (j / cols) * Math.PI * 2;
    const rad = v3.add(v3.mul(e1, Math.cos(ph)), v3.mul(e2, Math.sin(ph)));
    const u = v3.norm(v3.add(v3.mul(axis, p.ax), v3.mul(rad, p.ra)));
    const R = capsuleRadius(o, v3.add(p.s, v3.mul(u, o.r)));
    return v3.add(p.s, v3.mul(u, R));
  }, idx);
}

function discGrid(g: Grid, o: Organelle, idx: number, q: number) {
  const [rows, cols] = detail(o, q);
  const n = o.b, [t1, t2] = discFrame(n);
  const sc = v3.add(o.a, v3.mul(n, o.bend));
  const h = o.thick / 2;
  const rimRows = 7;
  const rims: number[] = [];
  for (let j = 0; j < cols; j++) { const ph = (j / cols) * Math.PI * 2; rims.push(discRim(o, Math.cos(ph), Math.sin(ph))); }
  // profile: (fraction out to the rim, radial offset from the bend sphere, arc beyond the rim)
  const prof: [number, number, number][] = [];
  for (let k = 0; k <= rows; k++) prof.push([k / rows, h, 0]);                       // the face away from the bend centre
  for (let k = 1; k < rimRows; k++) { const gm = (k / rimRows) * Math.PI; prof.push([1, h * Math.cos(gm), h * Math.sin(gm)]); }
  for (let k = rows; k >= 0; k--) prof.push([k / rows, -h, 0]);                      // the face toward it
  g.lathe(prof.length, cols, (i, j) => {
    const [f, off, arc] = prof[i];
    const ph = (j / cols) * Math.PI * 2;
    const alpha = (f * rims[j] + arc) / o.bend;
    const v = v3.add(v3.mul(n, -Math.cos(alpha)), v3.mul(v3.add(v3.mul(t1, Math.cos(ph)), v3.mul(t2, Math.sin(ph))), Math.sin(alpha)));
    return v3.add(sc, v3.mul(v, o.bend + off));
  }, idx);
}

/** a shell: a membrane drawn as two surfaces (this mesh and, offset inward on the GPU, its twin) */
export const isShell = (o: Organelle) => o.shape !== Shape.Disc && o.thick > 0;

export function buildMeshes(orgs: Organelle[], quality = 1): MeshSet {
  const g = new Grid(1 << 20, 1 << 22);
  const ranges: [number, number][] = orgs.map(() => [0, 0]);
  // shells first, so their inner surfaces are one contiguous index range
  const order = orgs.map((o, i) => i).sort((a, b) => Number(isShell(orgs[b])) - Number(isShell(orgs[a])));
  let shellCount = 0;
  for (const i of order) {
    const o = orgs[i], first = g.ni;
    if (o.shape === Shape.Blob) blobGrid(g, o, i, quality);
    else if (o.shape === Shape.Capsule) capsuleGrid(g, o, i, quality);
    else discGrid(g, o, i, quality);
    ranges[i] = [first, g.ni - first];
    if (isShell(o)) shellCount = g.ni;
  }
  return { vertices: g.v.slice(0, g.nv * 8), indices: g.i.slice(0, g.ni), shellCount, ranges };
}
