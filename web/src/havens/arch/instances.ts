// The small parts that repeat by the thousand — lanterns, merlons, balusters, brackets, grilles, finials — drawn
// instanced rather than laid into a part's mesh. Each prototype is laid once per detail level by the parts library
// (arch/parts/) at its own origin, packed as the parts' meshes are (chunks.ts: the uv fitted to its faces — a lantern's
// panes get their glazing bars — the normals octahedral) and uploaded once into one vertex and one index buffer.
// An instance is a prototype, a place, a yaw, a scale and a tint; its night light is taken once, where it's placed: the
// lamps round its anchor (its prototype's middle) summed from the bake's light grid (bake.ts LightGrid; past the
// part's walls, its colliders' solids, as the bake does; not its own lamp, within it), as a colour and the way most of
// it comes from — arch.wgsl's vsInst turns that to each surface and lights it as the parts' baked vertices are lit,
// and the same fs shades it (materials, textures, tiles, glow).
// Each view (the scene and every one of the sun's cascades) culls them on the CPU as it's encoded: by 64 m cell (its
// box against the frustum), then each instance's sphere, its detail from how big it looks from the camera (near, mid,
// far; too small: not drawn; a cascade takes mid at the most and leaves out the smallest), the visible ones' indices
// written into that view's own run of one list, one indexed draw per prototype and detail with its first instance the
// run's start. The draws are kept as drawIndexedIndirect's five numbers, so a GPU cull (arch/cull.ts) can write the
// same list and the same numbers in a compute pass and draw them indirectly instead.
//   const inst = new PartInstances(arch);                         // shares the arch's uniform and textures
//   const lantern = inst.proto('lantern', (b, d) => lantern(b, { kind: 'post', detail: d }));
//   inst.place([{ proto: lantern, p: [x, y, z], yaw }, ...], { lights: part.lights, colliders: part.colliders });
//   part.lights.push(...inst.lights());                           // (before arch.add(part): the walls lit by them)
import type { Kit, StorageBuffer, View } from '@ericrius1/weft';
import shader from './arch.wgsl';
import type { ArchRenderer } from './arch';
import type { SceneSlot } from '../world/order';
import { ArchBuilder } from './builder';
import type { ArchMesh, ArchPart, LightSpot, StructureCollider, V3 } from './types';
import { pack, CELL, RGBM_RANGE } from './chunks';
import { BAKE, LightGrid, Occluders } from './bake';
import { DETAILS, type Detail, type Laid } from './parts/kit';
import { PROTOS } from './parts/protos';

/** the prototypes' vertices: the position stream (the shadows read it alone), the rest */
const POS_LAYOUT: GPUVertexBufferLayout = { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] };
const ATTR_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: 16, attributes: [
    { shaderLocation: 1, offset: 0, format: 'snorm16x2' }, { shaderLocation: 2, offset: 4, format: 'float16x2' },
    { shaderLocation: 3, offset: 8, format: 'unorm8x4' }, { shaderLocation: 4, offset: 12, format: 'uint32' },
  ],
};
/** how big an instance must look (its radius over its distance from the eye, at a 60° view) for each detail; smaller
 *  isn't drawn. The nearest cascade draws mid at the most, the others far (their texels are coarser than a mid's
 *  detail); each leaves out what looks smaller than its SHADOW_SIZE (as the rocks do) */
const LOD_SIZE = [0.045, 0.012, 0.0022];
const SHADOW_SIZE = [0.004, 0.006, 0.01, 0.014];
/** an instance record's bytes (arch.wgsl PartInst) */
const INST_BYTES = 32;
/** the most views a frame culls for (the scene and the cascades, and a few more) */
const VIEWS = 8;

/** a prototype: its details' index ranges (near, mid, far), its sphere in its own frame, its lights there */
interface Proto {
  name: string;
  lods: { first: number; count: number; base: number; triangles: number }[];
  centre: V3;
  radius: number;
  lights: LightSpot[];
}

/** an instance as it's placed: its prototype, its place, its yaw (ArchBuilder's), its scale and tint */
export interface Instance { proto: number; p: V3; yaw?: number; scale?: number; tint?: V3 }

export class PartInstances {
  readonly kit: Kit;
  private protos: Proto[] = [];
  /** the prototypes' streams and indices as they're made (uploaded at place()) */
  private P: number[] = [];
  private A: number[] = [];
  private I: number[] = [];
  private nv = 0;
  /** the instances: per instance its sphere (world centre, radius) and prototype; by cell */
  private n = 0;
  private sphere = new Float32Array(0);
  private protoOf = new Uint16Array(0);
  private cellBox = new Float32Array(0);
  private cellStart = new Int32Array(0);
  private cellOrder = new Int32Array(0);
  private own: LightSpot[] = [];
  /** the views' runs of the list: which run is whose this frame */
  private runs = new Map<string, number>();
  private frameSeen = -1;
  private list = new Uint32Array(0);
  private sorted = new Uint32Array(0);
  private counts = new Int32Array(0);
  private starts = new Int32Array(0);
  private lodOf = new Int8Array(0);
  /** each view's draws last encoded: per draw drawIndexedIndirect's five (index count, instances, first index, base
   *  vertex, first instance) */
  readonly draws = new Map<string, Uint32Array>();
  /** what was drawn per view the last frame (instances, triangles) and the CPU it took to cull and encode (ms) */
  readonly drawn = new Map<string, { instances: number; triangles: number; ms: number }>();
  private bufs: { pos: StorageBuffer; attr: StorageBuffer; idx: StorageBuffer; insts: StorageBuffer; vis: StorageBuffer } | null = null;
  hidden = false;

  constructor(readonly arch: ArchRenderer, readonly slot: SceneSlot = 'city') { this.kit = arch.kit; }

  /** a prototype from a part laid at each detail level at its own origin (`lay`: the parts library's call), packed as
   *  the parts' meshes are; its index */
  proto(name: string, lay: (b: ArchBuilder, d: Detail) => Laid | void): number {
    if (this.bufs) throw new Error('instances: prototypes are all made before place()');
    const lods: Proto['lods'] = [];
    let lights: LightSpot[] = [], lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const d of DETAILS) {
      const b = new ArchBuilder();
      const laid = b.owner(name, () => lay(b, d));
      if (d === 'near' && laid) lights = laid.lights;
      const m = b.finish();
      if (d === 'near') for (let k = 0; k < 3; k++) { lo[k] = m.bounds[0][k]; hi[k] = m.bounds[1][k]; }
      lods.push(this.packed(m));
    }
    const centre: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const radius = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
    this.protos.push({ name, lods, centre, radius, lights });
    return this.protos.length - 1;
  }

  /** a prototype's mesh packed as a part's (chunks.ts pack: its uv fitted to its faces, its normals octahedral), moved
   *  into one cell first so it's one piece, its lattice positions back to its own frame; appended to the streams */
  private packed(m: ArchMesh): Proto['lods'][number] {
    const OFF = CELL * 4 + CELL / 2, n = m.pos.length / 3;
    const pos = new Float32Array(m.pos);
    for (let i = 0; i < n; i++) { pos[i * 3] += OFF; pos[i * 3 + 2] += OFF; }
    const none = { night: new Float32Array(n * 3), fire: new Float32Array(n), fireOf: new Int32Array(n).fill(-1), fireBody: new Uint8Array(n) };
    const k = pack({ ...m, pos }, none);
    if (k.draws.length !== 3) throw new Error(`instances: a prototype is one piece (${k.draws.length / 3} here: too big or too many vertices)`);
    const [ox, oy, oz, step] = k.chunks, base = this.nv, first = this.I.length, count = k.draws[1];
    for (let v = 0; v < k.vertices; v++) {
      this.P.push(ox + k.pos[v * 4] * step - OFF, oy + k.pos[v * 4 + 1] * step, oz + k.pos[v * 4 + 2] * step - OFF);
      // (the normal, the uv, the tint and ambient as the parts' are; the material and its glow from the position's w)
      this.A.push(k.attr[v * 5], k.attr[v * 5 + 1], k.attr[v * 5 + 2], k.pos[v * 4 + 3]);
    }
    for (let i = 0; i < count; i++) this.I.push(k.idx[i]);
    // (each run of indices starts on a whole word)
    if (this.I.length & 1) this.I.push(0);
    this.nv += k.vertices;
    return { first, count, base, triangles: count / 3 };
  }

  /** the instances (all of them, once): their night light taken at each one's anchor from `lights` (the part's they
   *  stand among, and their own) past `colliders`' walls; the buffers made and the draws added */
  place(list: Instance[], o: { lights?: LightSpot[]; colliders?: StructureCollider[] } = {}) {
    if (this.bufs) throw new Error('instances: placed once');
    const n = this.n = list.length, P = this.protos;
    this.sphere = new Float32Array(n * 4);
    this.protoOf = new Uint16Array(n);
    const rec = new ArrayBuffer(Math.max(1, n) * INST_BYTES), f = new Float32Array(rec), u = new Uint32Array(rec);
    // their own lights, moved to each
    const own: LightSpot[] = [];
    list.forEach((it, i) => {
      const pr = P[it.proto], c = Math.cos(it.yaw ?? 0), s = Math.sin(it.yaw ?? 0), sc = it.scale ?? 1;
      const at = (q: V3): V3 => [it.p[0] + (c * q[0] + s * q[2]) * sc, it.p[1] + q[1] * sc, it.p[2] + (-s * q[0] + c * q[2]) * sc];
      const mid = at(pr.centre);
      this.sphere.set([mid[0], mid[1], mid[2], pr.radius * sc], i * 4);
      this.protoOf[i] = it.proto;
      for (const l of pr.lights) own.push({ ...l, p: at(l.p) });
      f[i * 8] = it.p[0]; f[i * 8 + 1] = it.p[1]; f[i * 8 + 2] = it.p[2]; f[i * 8 + 3] = it.yaw ?? 0;
      f[i * 8 + 4] = sc;
      const t = it.tint ?? [1, 1, 1];
      u[i * 8 + 5] = (q8(t[0]) | (q8(t[1]) << 8) | (q8(t[2]) << 16) | (255 << 24)) >>> 0;
    });
    this.own = own;
    // the night's light at each anchor (its own lamp, inside its sphere, left out)
    const L = anchorLight(this.sphere, [...(o.lights ?? []), ...own], o.colliders ?? []);
    for (let i = 0; i < n; i++) { u[i * 8 + 6] = L[i * 2]; u[i * 8 + 7] = L[i * 2 + 1]; }
    this.bin();
    const kit = this.kit;
    const pos = new Float32Array(this.P), attr = new Uint32Array(this.A), idx = new Uint16Array(this.I);
    this.bufs = {
      pos: kit.storage({ label: 'parts.inst.pos', data: pos, usage: ['vertex', 'copy-dst'] }),
      attr: kit.storage({ label: 'parts.inst.attr', data: attr, usage: ['vertex', 'copy-dst'] }),
      idx: kit.storage({ label: 'parts.inst.idx', data: idx, usage: ['index', 'copy-dst'] }),
      insts: kit.storage({ label: 'parts.inst.records', data: new Uint8Array(rec) }),
      vis: kit.storage({ label: 'parts.inst.vis', size: Math.max(16, n * 4 * VIEWS) }),
    };
    this.list = new Uint32Array(Math.max(1, n));
    this.sorted = new Uint32Array(Math.max(1, n));
    this.lodOf = new Int8Array(Math.max(1, n));
    this.counts = new Int32Array(P.length * 3);
    this.starts = new Int32Array(P.length * 3);
    this.draw();
  }

  /** the instances' own lights (their prototypes' moved to each): for the part they stand among (its walls lit by
   *  them, the cast lit by them: ArchRenderer.lampsNear) */
  lights(): LightSpot[] { return this.own; }

  /** the instances by 64 m cell, each cell's box round its instances' spheres */
  private bin() {
    const S = this.sphere, n = this.n, cells = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const key = (Math.floor(S[i * 4] / CELL) + 32768) * 65536 + Math.floor(S[i * 4 + 2] / CELL) + 32768;
      const c = cells.get(key);
      if (c) c.push(i); else cells.set(key, [i]);
    }
    this.cellBox = new Float32Array(cells.size * 7);
    this.cellStart = new Int32Array(cells.size + 1);
    this.cellOrder = new Int32Array(n);
    let at = 0, ci = 0;
    for (const ids of cells.values()) {
      const B = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      let rMax = 0;
      this.cellStart[ci] = at;
      for (const i of ids) {
        const r = S[i * 4 + 3];
        for (let a = 0; a < 3; a++) { B[a] = Math.min(B[a], S[i * 4 + a] - r); B[a + 3] = Math.max(B[a + 3], S[i * 4 + a] + r); }
        rMax = Math.max(rMax, r);
        this.cellOrder[at++] = i;
      }
      this.cellBox.set([...B, rMax], ci * 7);
      ci++;
    }
    this.cellStart[ci] = at;
  }

  /** the draws: into the slot of the scene, and into every one of the sun's cascades */
  private draw() {
    const B = this.bufs!, look = this.arch.look, idx = { buffer: B.idx, format: 'uint16' as GPUIndexFormat };
    this.arch.order.into(this.slot, () => this.arch.scene.draw(shader, {
      label: 'parts.instances', vertex: 'vsInst', fragment: 'fs', cull: 'back',
      vertexBuffers: [{ layout: POS_LAYOUT, buffer: B.pos }, { layout: ATTR_LAYOUT, buffer: B.attr }], indices: idx,
      bind: { partInsts: B.insts, partVis: B.vis, AU: look.AU, matTex: look.matTex } as never,
      enabled: () => !this.hidden && this.n > 0,
      encode: (pe, draw) => this.encode(pe, draw.pass.opts.view ?? this.kit.mainView, 'scene', -1),
    }));
    this.arch.env.shadows.passes.forEach((pass, c) => pass.draw(shader, {
      label: `${pass.label}.parts.instances`, vertex: 'vsInstShadow', fragment: null, cull: 'none',
      vertexBuffers: [{ layout: POS_LAYOUT, buffer: B.pos }], indices: idx, bind: { partInsts: B.insts, partVis: B.vis } as never,
      enabled: () => !this.hidden && this.n > 0,
      encode: (pe, draw) => this.encode(pe, draw.pass.opts.view ?? this.kit.mainView, pass.label, c),
    }));
  }

  /** a view's cull, its run of the list written, its draws (see the header): the scene's (cascade -1) or a cascade's */
  private encode(pe: GPURenderPassEncoder, view: View, label: string, cascade: number) {
    const t0 = performance.now();
    if (this.frameSeen !== this.kit.frameIndex) { this.frameSeen = this.kit.frameIndex; this.drawn.clear(); }
    let run = this.runs.get(label);
    if (run === undefined) { run = this.runs.size; this.runs.set(label, run); }
    if (run >= VIEWS) return;
    const pl = view.camera.planes, eye = this.kit.mainView.camera.position, cam = this.kit.mainView.camera;
    const fov = Math.tan(cam.fovY / 2) / Math.tan(Math.PI / 6);
    const S = this.sphere, CB = this.cellBox, nP = this.protos.length;
    const counts = this.counts, lodOf = this.lodOf, shadow = cascade >= 0;
    const least = shadow ? SHADOW_SIZE[Math.min(cascade, SHADOW_SIZE.length - 1)] : LOD_SIZE[2];
    counts.fill(0);
    let seen = 0;
    const live = this.list;
    for (let ci = 0; ci + 1 < this.cellStart.length; ci++) {
      const o = ci * 7;
      // (the cell's box: its corner farthest along each plane's normal inside it, or the cell's out; the nearest any of
      // it is and its biggest instance: too small to be drawn anywhere in it, it's passed over)
      let inside = true, whole = true;
      for (let k = 0; k < 24 && inside; k += 4) {
        const x = pl[k] > 0 ? CB[o + 3] : CB[o], y = pl[k + 1] > 0 ? CB[o + 4] : CB[o + 1], z = pl[k + 2] > 0 ? CB[o + 5] : CB[o + 2];
        if (pl[k] * x + pl[k + 1] * y + pl[k + 2] * z + pl[k + 3] < 0) inside = false;
        // (and its nearest corner too: the whole cell's in, its instances needn't each be asked)
        const xn = pl[k] > 0 ? CB[o] : CB[o + 3], yn = pl[k + 1] > 0 ? CB[o + 1] : CB[o + 4], zn = pl[k + 2] > 0 ? CB[o + 2] : CB[o + 5];
        if (pl[k] * xn + pl[k + 1] * yn + pl[k + 2] * zn + pl[k + 3] < 0) whole = false;
      }
      if (!inside) continue;
      const dx = Math.max(CB[o] - eye[0], 0, eye[0] - CB[o + 3]), dy = Math.max(CB[o + 1] - eye[1], 0, eye[1] - CB[o + 4]), dz = Math.max(CB[o + 2] - eye[2], 0, eye[2] - CB[o + 5]);
      const near = Math.max(1, Math.hypot(dx, dy, dz));
      if (CB[o + 6] / near / fov < least) continue;
      for (let j = this.cellStart[ci]; j < this.cellStart[ci + 1]; j++) {
        const i = this.cellOrder[j], x = S[i * 4], y = S[i * 4 + 1], z = S[i * 4 + 2], r = S[i * 4 + 3];
        if (!whole) {
          let vis = true;
          for (let k = 0; k < 24 && vis; k += 4) if (pl[k] * x + pl[k + 1] * y + pl[k + 2] * z + pl[k + 3] < -r) vis = false;
          if (!vis) continue;
        }
        const ex = x - eye[0], ey = y - eye[1], ez = z - eye[2];
        const size = r / Math.max(1, Math.sqrt(ex * ex + ey * ey + ez * ez)) / fov;
        let lod = size > LOD_SIZE[0] ? 0 : size > LOD_SIZE[1] ? 1 : size > LOD_SIZE[2] ? 2 : -1;
        if (shadow) lod = size < least ? -1 : cascade === 0 ? Math.max(lod, 1) : 2;
        if (lod < 0) continue;
        lodOf[i] = lod;
        live[seen++] = i;
        counts[this.protoOf[i] * 3 + lod]++;
      }
    }
    // the run: each prototype and detail's instances one after another, from this view's place in the list
    const base = run * this.n, st = this.starts;
    let at = 0;
    const draws: number[] = [];
    let tris = 0;
    for (let g = 0; g < nP * 3; g++) {
      st[g] = at;
      const c = counts[g];
      if (!c) continue;
      const lod = this.protos[(g / 3) | 0].lods[g % 3];
      draws.push(lod.count, c, lod.first, lod.base, base + at);
      tris += lod.triangles * c;
      at += c;
    }
    const out = this.sorted;
    for (let m = 0; m < seen; m++) { const i = live[m], g = this.protoOf[i] * 3 + lodOf[i]; out[st[g]++] = i; }
    if (seen) this.bufs!.vis.write(out.subarray(0, seen), base * 4);
    const D = new Uint32Array(draws);
    for (let k = 0; k < D.length; k += 5) pe.drawIndexed(D[k], D[k + 1], D[k + 2], D[k + 3], D[k + 4]);
    this.draws.set(label, D);
    this.drawn.set(label, { instances: seen, triangles: tris, ms: Math.round((performance.now() - t0) * 1000) / 1000 });
  }

  /** what they are and what they cost: instances, prototypes (their triangles per detail), the GPU bytes, what each
   *  view drew last frame */
  stats() {
    const B = this.bufs;
    const bytes = B ? B.pos.size + B.attr.size + B.idx.size + B.insts.size + B.vis.size : 0;
    return {
      instances: this.n,
      protos: this.protos.map((p) => ({ name: p.name, triangles: p.lods.map((l) => l.triangles), radius: Math.round(p.radius * 100) / 100 })),
      bytes, drawn: Object.fromEntries(this.drawn),
    };
  }
}

/** a tint's byte (×128: 128 is 1.0) */
const q8 = (x: number) => Math.max(0, Math.min(255, Math.round(x * 128)));

/** each anchor's night light (the spheres' middles): the lamps reaching it (BakeOptions' reach where they give none),
 *  each its candela over the square of its distance eased to nothing at its reach, none from inside the sphere (its
 *  own) or from behind one of the part's walls; as RGBM (chunks.ts's range) and the way most of it comes from (snorm8
 *  xyz, its length how much of it does), two words per anchor */
export function anchorLight(S: Float32Array, lights: LightSpot[], colliders: StructureCollider[]): Uint32Array {
  const n = S.length / 4, out = new Uint32Array(n * 2);
  if (!lights.length) return out;
  const L = new LightGrid(lights.filter((l) => l.when !== 'fire')), occ = colliders.length ? new Occluders(colliders) : null;
  const g = L.grid, cell = g.cell, LP = L.p, near2 = BAKE.near * BAKE.near;
  const walls = new Map<number, Int32Array>();
  for (let i = 0; i < n; i++) {
    const px = S[i * 4], py = S[i * 4 + 1], pz = S[i * 4 + 2], own = S[i * 4 + 3];
    let r = 0, gg = 0, b = 0, wx = 0, wy = 0, wz = 0, w = 0;
    for (let k = g.at(Math.floor(px / cell), Math.floor(pz / cell)), e = g.end; k < e; k++) {
      const l = g.items[k];
      const dx = LP[l * 3] - px, dy = LP[l * 3 + 1] - py, dz = LP[l * 3 + 2] - pz, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= L.r2[l] || d2 < own * own) continue;
      if (occ) {
        let ws = walls.get(l);
        if (!ws) walls.set(l, (ws = occ.near(LP.subarray(l * 3, l * 3 + 3), Math.sqrt(L.r2[l]), BAKE.narrow)));
        let cut = false;
        for (let q = 0; q < ws.length && !cut; q++) cut = occ.cut(ws[q], px, py, pz, LP[l * 3], LP[l * 3 + 1], LP[l * 3 + 2]);
        if (cut) continue;
      }
      const f = 1 - d2 / L.r2[l], E = (L.cd[l] * f * f) / Math.max(d2, near2), d = Math.sqrt(d2);
      const er = L.rgb[l * 3] * E, eg = L.rgb[l * 3 + 1] * E, eb = L.rgb[l * 3 + 2] * E, y = 0.2126 * er + 0.7152 * eg + 0.0722 * eb;
      r += er; gg += eg; b += eb;
      wx += (dx / d) * y; wy += (dy / d) * y; wz += (dz / d) * y; w += y;
    }
    out[i * 2] = rgbm(r, gg, b);
    const dl = w > 0 ? 1 / w : 0;
    const s8 = (x: number) => Math.round(Math.max(-1, Math.min(1, x)) * 127) & 0xff;
    out[i * 2 + 1] = (s8(wx * dl) | (s8(wy * dl) << 8) | (s8(wz * dl) << 16)) >>> 0;
  }
  return out;
}

/** a colour's RGBM bytes in one word (chunks.ts's) */
function rgbm(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b);
  if (!(mx > 1e-6)) return 0;
  const a = Math.ceil(Math.min(1, Math.sqrt(mx / RGBM_RANGE)) * 255) / 255;
  const M = a * a * RGBM_RANGE;
  const q = (x: number) => Math.min(255, Math.round((x / M) * 255));
  return (q(r) | (q(g) << 8) | (q(b) << 16) | (Math.round(a * 255) << 24)) >>> 0;
}

/** a world part's instanced placements (ArchPart.instances: the builders' b.place(), by parts/protos.ts name) made into
 *  its instances, before it's added to the arch (arch.add): each named prototype made once, every placement placed
 *  among the part's lights and walls, and their lamps' own lights added to the part's, so the bake lights the walls
 *  round them as a laid lantern's would. A name with no prototype is left out (and said once); null for none */
export function partInstances(arch: ArchRenderer, part: ArchPart, slot: SceneSlot): PartInstances | null {
  const list = part.instances;
  if (!list?.length) return null;
  const protos = PROTOS as Record<string, (b: ArchBuilder, d: Detail) => Laid | void>;
  const inst = new PartInstances(arch, slot), ids = new Map<string, number>();
  for (const q of list) {
    if (ids.has(q.proto)) continue;
    const lay = protos[q.proto];
    if (!lay) console.warn(`instances: ${part.name} places '${q.proto}', which isn't a prototype (parts/protos.ts)`);
    ids.set(q.proto, lay ? inst.proto(q.proto, lay) : -1);
  }
  const known = list.filter((q) => ids.get(q.proto)! >= 0);
  inst.place(known.map((q) => ({ proto: ids.get(q.proto)!, p: q.p, yaw: q.yaw, scale: q.scale, tint: q.tint })), { lights: part.lights, colliders: part.colliders });
  part.lights.push(...inst.lights());
  return inst;
}
