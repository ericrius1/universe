// A scratch mesh: positions, uvs and a per-vertex index, with normals worked out from the faces at the end. It
// hands the result to weft's MeshBuilder in one go, so the vertex layout is the kit's own 40 bytes and the draw is
// an ordinary indexed draw that pulls its vertices from a storage buffer.

import { MeshBuilder, type GpuMesh, type Kit } from '@ericrius1/weft';

export class Scratch {
  readonly px: number[] = [];
  readonly py: number[] = [];
  readonly pz: number[] = [];
  readonly u: number[] = [];
  readonly v: number[] = [];
  readonly mat: number[] = [];
  readonly nx: number[] = [];
  readonly ny: number[] = [];
  readonly nz: number[] = [];
  readonly idx: number[] = [];

  get count() { return this.px.length; }

  vertex(x: number, y: number, z: number, u: number, v: number, mat: number, n?: [number, number, number]) {
    const i = this.px.length;
    this.px.push(x); this.py.push(y); this.pz.push(z);
    this.u.push(u); this.v.push(v); this.mat.push(mat);
    this.nx.push(n ? n[0] : 0); this.ny.push(n ? n[1] : 0); this.nz.push(n ? n[2] : 0);
    return i;
  }

  tri(a: number, b: number, c: number) { this.idx.push(a, b, c); }

  /** accumulate face normals into the vertices that have none of their own; returns how many had no usable
   *  one at all (every triangle touching them degenerate) and were stood up instead */
  smooth(only?: (i: number) => boolean) {
    let flat = 0;
    const ax = new Float64Array(this.count), ay = new Float64Array(this.count), az = new Float64Array(this.count);
    for (let t = 0; t < this.idx.length; t += 3) {
      const a = this.idx[t], b = this.idx[t + 1], c = this.idx[t + 2];
      const ux = this.px[b] - this.px[a], uy = this.py[b] - this.py[a], uz = this.pz[b] - this.pz[a];
      const vx = this.px[c] - this.px[a], vy = this.py[c] - this.py[a], vz = this.pz[c] - this.pz[a];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      for (const i of [a, b, c]) { ax[i] += fx; ay[i] += fy; az[i] += fz; }
    }
    for (let i = 0; i < this.count; i++) {
      if (only && !only(i)) continue;
      const l = Math.hypot(ax[i], ay[i], az[i]);
      // a vertex every one of whose triangles is degenerate gets no normal of its own. Left at zero it normalises
      // to NaN in the shader, and one NaN is enough to poison whole blocks of the picture once the bloom blur has
      // spread it — so it gets up instead.
      if (l < 1e-12) { this.nx[i] = 0; this.ny[i] = 1; this.nz[i] = 0; flat++; continue; }
      this.nx[i] = ax[i] / l; this.ny[i] = ay[i] / l; this.nz[i] = az[i] / l;
    }
    return flat;
  }

  private build() {
    const m = new MeshBuilder();
    m.color = [1, 1, 1, 1];
    for (let i = 0; i < this.count; i++) {
      m.mat = this.mat[i];
      m.vertex([this.px[i], this.py[i], this.pz[i]], [this.nx[i], this.ny[i], this.nz[i]], [this.u[i], this.v[i]]);
    }
    for (let t = 0; t < this.idx.length; t += 3) m.tri(this.idx[t], this.idx[t + 1], this.idx[t + 2]);
    return m;
  }

  upload(kit: Kit, label: string): GpuMesh { return this.build().upload(kit, label); }

  /** write into buffers that are already there, so a draw never has to be rebuilt when the field changes */
  writeInto(target: GpuMesh) {
    const { vertices, indices } = this.build().data();
    target.vertices.ensure(vertices.byteLength);
    target.indices.ensure(indices.byteLength);
    target.vertices.write(new Uint8Array(vertices));
    target.indices.write(indices);
    target.count = indices.length;
    target.vertexCount = this.count;
    return target;
  }
}
