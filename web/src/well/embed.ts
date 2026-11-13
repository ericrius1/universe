// Hepatocyte as a world another app can host on its own kit: the plate on its bench, the wells, and on the floor of the
// chosen one the field of cells, their canaliculi and what is inside them, with the state of the well that decides all
// of it (the Store: the culture system, the compound, the concentration, the hour, the stains, the register). Its own
// page (main.ts) is one host of it; host.html (host.ts) is another; Universe's lab bench is meant to be a third.
//
// One world in one unit. Everything is in micrometres, y up, x along the plate's columns and z down its rows, with
// the origin at the middle of the chosen well's floor: the field of cells is laid out about that point (world/field.ts
// already is), and the plate (laid out in millimetres about the middle of its top face, plate.wgsl) is put where it
// really is round it, 8.96 mm above. So a camera can go from a metre over the bench down the bore, through the
// meniscus, onto the sheet of cells and into one without a cut, and the plate's own picture of the cells on that
// well's floor gives way to the real ones as it comes (`veil`).
//
// The origin floats. A host hands over the eye in the world's frame (doubles); while the field is in sight the GPU's
// origin is the well's floor, so nothing the field's shaders compare is ever more than a few millimetres; once the field
// is out of sight (more than ~9 mm off) the GPU's origin is the eye itself and the plate is drawn camera-relative
// (plate.wgsl's `shift`, worked out here in doubles). The GPU never holds a coordinate bigger than ~1 cm except as the
// plate's own distance from an eye that is that far away.
//
// The field is half a millimetre of real cells in a floor 6.4 mm across. Past its edge the floor of the well is the
// plate's picture of it (a sheet of cells in the well's colour, plate.wgsl), still there under the medium's haze when
// you're down among the cells; the collagen is laid under the field only.
//
// Each frame a host: sets the kit's camera's orientation, field of view and near plane; calls `use()` (the world's
// uniforms become the kit's globals); `update(dt, eye)`; runs `passes()` (then `layer(target)` when hosted); and calls
// `unuse()` once they're sent, which gives the host its globals back.
import { isPhone, type Kit, type RenderPass, type RunEntry, type Texture } from '@ericrius1/weft';
import orgShader from './shaders/organelles.wgsl';
import fieldShader from './shaders/field.wgsl';
import stageShader from './shaders/stage.wgsl';
import plateShader from './shaders/plate.wgsl';
import bloomShader from './shaders/bloom.wgsl';
import postShader from './shaders/post.wgsl';
import layerShader from './shaders/layer.wgsl';

import { buildField, fieldScratch, type Cell, type Field } from './world/field';
import { cellOrgs, clearOrgCache, nucleiOnly, ORG_FLOATS } from './world/organelles';
import { COLS, ROWS, Store } from './world/state';
import { describe, describeDominant, type Look } from './world/describe';
import { PART, PARTS, partById } from './data/parts';
import { AXES, COMPOUNDS, PLATE_COLUMNS } from './data/compounds';
import { SYSTEMS, SYSTEM_LIST } from './data/systems';

export { Store, ROWS, COLS, describe, describeDominant, PART, PARTS, partById, COMPOUNDS, PLATE_COLUMNS, SYSTEMS, SYSTEM_LIST };
export type { Look, Cell, Field };
export { fmtDose, fmtHours } from './world/state';

type V3 = [number, number, number];

// ------------------------------------------------------------------------------------------------- the plate's numbers

/** micrometres to the millimetre */
export const UM = 1000;
/** between well centres, the bore, the plate's depth (mm) */
export const PITCH = 9;
export const BORE = 6.4;
export const PLATE_DEPTH = 11.2;
/** how full a well is, as a share of its depth */
export const FILL = 0.34;
/** a well's floor and the meniscus over it, below the plate's top face (mm) */
export const FLOOR_Y = -PLATE_DEPTH * 0.8;
export const MENISCUS_Y = FLOOR_Y * (1 - FILL);
/** the plate's top face and the meniscus, above the well's floor (µm) */
const TOP_UM = -FLOOR_Y * UM;
const MENISCUS_UM = (MENISCUS_Y - FLOOR_Y) * UM;

/** where the real cells take over from the plate's picture of them: the field's distance from the eye (µm) over
 *  which the picture gives way, and past which the field isn't drawn at all */
const VEIL_NEAR = 2500;
const VEIL_FAR = 9000;

/** what the shaders write into the pick target (kind << 20 | cell) to what it is */
const KIND_TO_PART: Record<number, number> = {
  1: PART.mito, 2: PART.lysosome, 3: PART.peroxisome, 4: PART.lipid, 5: PART.glycogen,
  6: PART.nucleus, 7: PART.nucleolus, 8: PART.foci, 9: PART.bleb, 10: PART.golgi,
  11: PART.ser, 12: PART.rer, 13: PART.canaliculus, 15: PART.membrane, 17: PART.collagen,
  18: PART.well, 19: PART.plate,
};

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export interface HepatocyteOptions {
  /** the state of the well (default: a new one) */
  store?: Store;
  /** laid into a host's HDR for the host's film to finish (`layer`): the scene cleared to nothing, no air behind it, no
   *  bloom or film of its own. Otherwise it finishes its own frame to the screen, as its page does */
  hosted?: boolean;
  /** how many cells round the eye have their organelles drawn (default 13, 7 on a phone) */
  detailCells?: number;
}

/** what is under a point of the picture */
export interface Picked {
  /** what it is (data/parts.ts PART), 0 for nothing */
  part: number;
  /** the field's cell it belongs to (or the well's index, on the plate) */
  cell: number;
  /** the well under it, on the plate, or null */
  well: number | null;
}

export class Hepatocyte {
  readonly store: Store;
  readonly hosted: boolean;
  /** the scene's light (HDR, premultiplied), its depth, and what is where (kind << 20 | cell) */
  readonly hdr: Texture;
  readonly depth: Texture;
  readonly pick: Texture;
  readonly scene: RenderPass;
  /** the field of cells on the chosen well's floor (rebuilt when the culture system changes) */
  field: Field;

  /** this frame's eye in the world's frame (µm), and the GPU's origin in it */
  readonly eye: V3 = [0, 0, 0];
  readonly origin: V3 = [0, 0, 0];
  /** the well whose floor the world's origin is (the store's chosen well) */
  anchor = 0;
  /** how much of the plate's picture of the cells is still laid over the real ones: 1 far off, 0 close in */
  veil = 1;
  /** the medium's haze per micrometre, by how far above the floor the eye is */
  fogK = 0;
  /** the page's film: the white flash and the opening fade (0..1); the bloom's amount (null: the register's) */
  readonly post = { flash: 0, fade: 0, bloom: null as number | null };

  private readonly kit: Kit;
  private readonly hostGlobals: Kit['globals'];
  private readonly G;
  private readonly PL;
  private readonly PU;
  private readonly BU;
  private readonly LU;
  private readonly bloomTex: Texture[] = [];
  private readonly own: RunEntry[];
  private canalPhase = 0;
  private fieldOn = false;
  private bodyOn = true;

  // the field's buffers
  private readonly detailCells: number;
  private readonly mesh;
  private readonly canalMesh;
  private readonly cellBuf;
  private readonly nucBuf;
  private readonly orgBuf;
  private readonly scratch: Float32Array;
  private nucCount = 0;
  private orgCount = 0;
  private fieldKey: string;
  private detailKey = '';
  private lastDetailAt = -1e9;
  private lastDetailPos: [number, number] = [1e9, 1e9];

  // the plate's
  private readonly wellBuf;
  private readonly wellData = new Float32Array(8 * 96);

  // picking
  private pickPending = false;
  private pickValue = 0;

  constructor(kit: Kit, o: HepatocyteOptions = {}) {
    this.kit = kit;
    this.hostGlobals = kit.globals;
    const store = this.store = o.store ?? new Store();
    const hosted = this.hosted = !!o.hosted;
    this.detailCells = o.detailCells ?? (isPhone() ? 7 : 13);

    this.hdr = kit.texture({ label: 'hep.hdr', format: 'rgba16float', size: 'render' });
    this.depth = kit.texture({ label: 'hep.depth', format: 'depth32float', size: 'render' });
    this.pick = kit.texture({ label: 'hep.pick', format: 'r32uint', size: 'render' });

    const G = this.G = kit.uniforms(orgShader.structs.World, 'hep.world');
    const PL = this.PL = kit.uniforms(plateShader.structs.PlateU, 'hep.plate');
    this.PU = kit.uniforms(postShader.structs.PostU, 'hep.post');
    this.BU = [0, 1, 2, 3, 4].map((i) => kit.uniforms(bloomShader.structs.BloomU, `hep.bloom${i}`));
    this.LU = kit.uniforms(layerShader.structs.LayerU, 'hep.layer');
    this.LU.set({ shows: 1 });

    // ---- the field
    this.fieldKey = store.systemId;
    const field = this.field = buildField(store.system);
    const scr = fieldScratch(field);
    if (scr.flat) console.log(`field: ${scr.flat} vertices had no normal of their own (every triangle on them degenerate); stood up`);
    const mesh = this.mesh = scr.mesh.upload(kit, 'field');
    const canalMesh = this.canalMesh = scr.canals.upload(kit, 'canals');
    const cellBuf = this.cellBuf = kit.storage({ label: 'cells', size: 64 * 4096 });
    const nucBuf = this.nucBuf = kit.storage({ label: 'nuclei', size: 4 * ORG_FLOATS * 4000 });
    const MAX_ORG = 15000;
    const orgBuf = this.orgBuf = kit.storage({ label: 'orgs', size: 4 * ORG_FLOATS * MAX_ORG });
    this.scratch = new Float32Array(ORG_FLOATS * MAX_ORG);
    this.writeCells();

    // ---- the plate
    const wellBuf = this.wellBuf = kit.storage({ label: 'wells', size: 32 * 96 });
    PL.set({
      rows: ROWS, cols: COLS, pitch: PITCH, bore: BORE,
      depth: PLATE_DEPTH, fill: FILL, hover: -1, chosen: -1,
      originX: -((COLS - 1) * PITCH) / 2, originZ: -((ROWS - 1) * PITCH) / 2, lift: 0, spare: 0,
      shift: [0, 0, 0], unit: UM, veil: 1, fieldHalf: field.extent / 2,
    });
    this.writeWells();

    store.on((what) => {
      if (what === 'system') { this.rebuildField(); this.writeWells(); }
      if (what === 'well' || what === 'hours' || what === 'hover') this.writeWells();
    });

    // ---- the frame. The cells first, then the wells over them: the chosen well's floor is laid over the cells while
    // its picture of them is still showing, and the meniscus is seen through
    const scene = this.scene = kit.pass({
      label: 'hep.scene',
      color: [
        { target: this.hdr, clear: hosted ? [0, 0, 0, 0] : [1, 1, 1, 1] },
        { target: this.pick, clear: [0, 0, 0, 0] },
      ],
      depth: { target: this.depth, clear: 0 },
    });
    const inField = () => this.fieldOn;
    const wells = { wells: wellBuf, P: PL };
    if (!hosted) scene.fullscreen(stageShader, { label: 'air', fragment: 'fs_sky' });
    scene.draw(plateShader, { label: 'plate.body', vertex: 'vs_body', fragment: 'fs_body', count: 36, cull: 'none', enabled: () => this.bodyOn, bind: wells });
    scene.draw(stageShader, { label: 'floor', vertex: 'vs_floor', fragment: 'fs_floor', count: 6, cull: 'none', enabled: inField, bind: { cells: cellBuf } });
    scene.draw(stageShader, {
      label: 'canals', vertex: 'vs_canal', fragment: 'fs_canal', cull: 'none', enabled: inField,
      bind: { cverts: canalMesh.vertices, cells: cellBuf },
      indices: { buffer: canalMesh.indices, format: 'uint32' },
      count: () => canalMesh.count,
    });
    scene.draw(orgShader, { label: 'nuclei', count: 6, instances: () => this.nucCount, cull: 'none', enabled: inField, bind: { orgs: nucBuf, cells: cellBuf } });
    scene.draw(orgShader, { label: 'organelles', count: 6, instances: () => this.orgCount, cull: 'none', enabled: inField, bind: { orgs: orgBuf, cells: cellBuf } });
    scene.draw(fieldShader, {
      label: 'cells.skirt', constants: { SKIRT: 1 }, cull: 'none', enabled: inField,
      bind: { verts: mesh.vertices, cells: cellBuf },
      indices: { buffer: mesh.indices, format: 'uint32' },
      count: () => mesh.count,
    });
    scene.draw(fieldShader, {
      label: 'cells.body', constants: { SKIRT: 0 }, cull: 'none', enabled: inField,
      blend: ['premultiplied', 'opaque'], writeMask: [0xf, 0], depthWrite: true,
      bind: { verts: mesh.vertices, cells: cellBuf },
      indices: { buffer: mesh.indices, format: 'uint32' },
      count: () => mesh.count,
    });
    scene.draw(plateShader, { label: 'plate.wells', vertex: 'vs_well', fragment: 'fs_well', count: 28 * 15, instances: 96, cull: 'none', blend: ['premultiplied', 'opaque'], bind: wells });

    if (hosted) {
      this.own = [scene];
    } else {
      // its own bloom and film, to the screen
      const BU = this.BU;
      const bloomTex = this.bloomTex;
      [0.25, 0.125, 0.0625].forEach((s, i) => bloomTex.push(kit.texture({ label: `hep.bloom${i}`, format: 'rgba16float', size: 'render', scale: s })));
      const down = [this.hdr, bloomTex[0], bloomTex[1]].map((src, i) => {
        const p = kit.pass({ label: `bloom.down${i}`, color: [{ target: bloomTex[i], clear: [0, 0, 0, 1] }] });
        p.fullscreen(bloomShader, { fragment: 'fs_down', constants: { FIRST: i === 0 ? 1 : 0 }, bind: { src, B: BU[i] } });
        return p;
      });
      const up = [2, 1].map((from, k) => {
        const p = kit.pass({ label: `bloom.up${k}`, color: [{ target: bloomTex[from - 1] }] });
        p.fullscreen(bloomShader, { fragment: 'fs_up', blend: 'add', bind: { src: bloomTex[from], B: BU[3 + k] } });
        return p;
      });
      const out = kit.pass({ label: 'out', color: [{ target: 'screen', clear: [1, 1, 1, 1] }] });
      out.fullscreen(postShader, {
        bind: { hdr: this.hdr, bloom: bloomTex[0], PU: this.PU },
        constants: { HDR: kit.hdr.enabled ? 1 : 0, P3: kit.hdr.colorSpace === 'display-p3' ? 1 : 0 },
      });
      this.own = [scene, ...down, ...up, out];
    }

    // (the world's uniforms were made the kit's globals nowhere yet: the host's stay until use())
    G.set({ exposure: 1.08, dim: 1, detail: 1, tint: [1, 1, 1], sun: [0.35, 0.86, 0.38], focus: [0, 0, 0, -1], fieldHalf: field.extent / 2 });
  }

  // ------------------------------------------------------------------------------------------------ the host's side

  /** the world's uniforms as the kit's globals (while it draws), and the host's back */
  use() { if (this.kit.globals !== this.G) this.kit.setGlobals(this.G); }
  unuse() { if (this.kit.globals !== this.hostGlobals) this.kit.setGlobals(this.hostGlobals as never); }

  /** a well's centre on the plate (mm, about the middle of its top face) */
  wellCentre(i: number): [number, number] {
    return [-((COLS - 1) * PITCH) / 2 + (i % COLS) * PITCH, -((ROWS - 1) * PITCH) / 2 + Math.floor(i / COLS) * PITCH];
  }
  /** where a well's floor is on the plate (mm): a host puts the plate on its bench by this */
  wellFloor(i: number): V3 { const [x, z] = this.wellCentre(i); return [x, FLOOR_Y, z]; }

  /** a point on the plate (mm, about the middle of its top face) in the world's frame (µm), and back */
  fromPlate(p: ArrayLike<number>): V3 {
    const [ax, az] = this.wellCentre(this.store.wellIndex());
    return [(p[0] - ax) * UM, (p[1] - FLOOR_Y) * UM, (p[2] - az) * UM];
  }
  toPlate(w: ArrayLike<number>): V3 {
    const [ax, az] = this.wellCentre(this.store.wellIndex());
    return [w[0] / UM + ax, w[1] / UM + FLOOR_Y, w[2] / UM + az];
  }
  /** a point in the world's frame where the GPU has it this frame (less the floating origin) */
  gpu(w: ArrayLike<number>): V3 { return [w[0] - this.origin[0], w[1] - this.origin[1], w[2] - this.origin[2]]; }

  /** the hepatocyte the page's links and tours start from: one near the middle of the field */
  homeCell(): Cell {
    const f = this.field;
    return f.cells.find((c) => c.hepatocyte && Math.hypot(c.x, c.z) < f.pitch * 2) ?? f.cells[0];
  }

  /** the cell an eye (world µm) is inside, if any: under its roof and within its footprint is all it takes */
  insideCell(eye: ArrayLike<number>): number | null {
    const c = this.field.pick(eye[0], eye[2]);
    if (!c) return null;
    const d = Math.hypot(eye[0] - c.x, eye[2] - c.z);
    if (d > c.r * 0.96) return null;
    const t = Math.max(0, 1 - d / c.r);
    const roof = c.h * (0.13 + 0.87 * Math.pow(Math.sin((t * Math.PI) / 2), 0.68));
    return eye[1] > 0.1 && eye[1] < roof * 0.96 ? c.i : null;
  }

  /** whether an eye (world µm) is down in the medium of the chosen well */
  inMedium(eye: ArrayLike<number> = this.eye) {
    return eye[1] < MENISCUS_UM && Math.hypot(eye[0], eye[2]) < (BORE / 2) * UM;
  }

  /** this frame, after the host has set the kit's camera's orientation, field of view and near plane: the eye (world
   *  µm, doubles) placed against the floating origin, the clock run on if it's playing, the cells round the eye given
   *  their organelles, and the uniforms */
  update(dt: number, eye: ArrayLike<number>) {
    const store = this.store, cam = this.kit.camera;
    this.eye[0] = eye[0]; this.eye[1] = eye[1]; this.eye[2] = eye[2];
    this.anchor = store.wellIndex();

    // ---- where the real cells take over, and where the GPU's origin is
    const far = Math.hypot(eye[0], eye[1], eye[2]);
    this.veil = smooth(VEIL_NEAR, VEIL_FAR, far);
    this.fieldOn = this.veil < 0.999;
    if (this.fieldOn) this.origin.fill(0);
    else { this.origin[0] = eye[0]; this.origin[1] = eye[1]; this.origin[2] = eye[2]; }
    const p = this.gpu(eye);
    cam.position = p;
    const v = cam.viewOverride;
    if (v) {
      v[12] = -(v[0] * p[0] + v[4] * p[1] + v[8] * p[2]);
      v[13] = -(v[1] * p[0] + v[5] * p[1] + v[9] * p[2]);
      v[14] = -(v[2] * p[0] + v[6] * p[1] + v[10] * p[2]);
    }

    // ---- the cells round the eye, and the one it's in
    const was = store.inside;
    if (this.fieldOn) { this.updateDetail(); store.inside = this.insideCell(eye); } else store.inside = null;
    if (was !== store.inside) store.emit('inside');

    // ---- time, when it is running
    if (store.playing) {
      const span = store.maxHours;
      store.setHours(store.hours + dt * span * 0.035);
      if (store.hours >= span - 0.01) { store.playing = false; store.emit('play'); }
    }

    // ---- the haze: the medium's, thick down among the cells and thinning to nothing by the meniscus and the air over it
    const alt = eye[1];
    this.fogK = store.inside !== null ? 0.021
      : alt <= 150 ? 0.004
      : 0.004 * Math.pow(150 / alt, 1.3) * (1 - smooth(5000, 9000, alt));
    // the plate's body is drawn unless it's lost in that haze from where the eye is
    this.bodyOn = !this.inMedium(eye) || this.fogK * (TOP_UM - alt) < 7;

    // ---- the state of the well, into the shaders
    const a = store.axes();
    const stainOn = (k: string) => (store.stains.has(k as never) ? 1 : 0);
    this.canalPhase += dt * (Math.PI * 2) / 22;   // a lumen contracts every twenty or thirty minutes; here, every 22 s
    const sys = store.system;
    const field = this.field;
    this.G.set({
      ...(Object.fromEntries(AXES.map((k) => [k, a[k]])) as Record<string, number>),
      mode: store.mode === 'fluor' ? 1 : 0,
      fogK: this.fogK,
      exposure: store.mode === 'fluor' ? 1.22 : 1.08,
      white: 0,
      hour: store.hours,
      stain: [stainOn('hoechst'), stainOn('tmrm'), stainOn('lipid'), stainOn('pld')],
      stain2: [stainOn('cdf'), stainOn('rox'), stainOn('pi'), 0],
      sun: [0.35, 0.86, 0.38],
      spread: sys.spread,
      focus: store.inside !== null
        ? (() => { const c = field.cells.find((x) => x.i === store.inside)!; return [c.x, c.h, c.z, c.r]; })()
        : [0, 0, 0, -1],
      tint: [1, 1, 1],
      feeders: sys.feeders ? 1 : 0,
      cellSize: sys.cellSize,
      canalPhase: this.canalPhase,
      detail: 1,
      dim: 1,
      fieldHalf: field.extent / 2,
    });
    // the plate, put where it is from the GPU's origin (doubles here, a small number there)
    const at = this.gpu(this.fromPlate([0, 0, 0]));
    const soft = smooth(200, 1200, far);
    this.PL.set({ shift: at, chosen: this.anchor, veil: this.veil, soft, lift: 0.05 + 40 * Math.max(this.veil, soft), fieldHalf: field.extent / 2 });

    if (!this.hosted) {
      // ---- the bloom chain's texel sizes, and the film
      const [rw, rh] = this.kit.size.render;
      const BU = this.BU;
      const sizes: [number, number][] = [[rw, rh], [rw * 0.25, rh * 0.25], [rw * 0.125, rh * 0.125]];
      for (let i = 0; i < 3; i++) BU[i].set({ texel: [1 / Math.max(1, sizes[i][0]), 1 / Math.max(1, sizes[i][1])], threshold: store.mode === 'fluor' ? 0.62 : 0.9, radius: 1 });
      BU[3].set({ texel: [1 / Math.max(1, rw * 0.0625), 1 / Math.max(1, rh * 0.0625)], threshold: 0, radius: 1.2 });
      BU[4].set({ texel: [1 / Math.max(1, rw * 0.125), 1 / Math.max(1, rh * 0.125)], threshold: 0, radius: 1.2 });
      this.PU.set({
        bloomAmount: this.post.bloom ?? (store.mode === 'fluor' ? 0.4 : 0.26),
        grain: store.mode === 'fluor' ? 0.012 : 0.006,
        vignette: store.mode === 'fluor' ? 0.5 : 0.18,
        chroma: 0.6,
        flash: this.post.flash,
        fade: this.post.fade,
        sharpen: 0,
        spare: 0,
      });
    }
  }

  /** this frame's GPU work: its scene, and on its own page its bloom and film to the screen too */
  passes(): RunEntry[] { return this.own; }

  /** the picture laid into a host's HDR (its film's units: this one's exposure applied), over what's there by `shows`.
   *  Hosted worlds only; run it after `passes()` */
  layer(target: Texture): RenderPass {
    const p = this.kit.pass({ label: 'hep.layer', color: [{ target, clear: false }] });
    p.fullscreen(layerShader, { blend: 'premultiplied', bind: { src: this.hdr, L: this.LU } });
    return p;
  }
  private showing = 1;
  get shows() { return this.showing; }
  set shows(w: number) { this.showing = w; this.LU.set({ shows: w }); }

  /** the scene's light to the screen's (what the layer multiplies by), and the lift in colour its own film gives */
  get exposure() { return this.store.mode === 'fluor' ? 1.22 : 1.08; }
  film() { return { exposure: this.exposure, saturation: this.store.mode === 'fluor' ? 1 : 1.3 }; }

  // --------------------------------------------------------------------------------------------- what's under a point

  /** read what is under a pixel of the render target (async: the answer is the next `picked()`'s) */
  pickAt(x: number, y: number) {
    if (this.pickPending) return;
    this.pickPending = true;
    const [w, h] = this.kit.size.render;
    x = Math.max(0, Math.min(w - 1, Math.round(x)));
    y = Math.max(0, Math.min(h - 1, Math.round(y)));
    void this.pick.readTexel(x, y).then((buf) => {
      if (buf) this.pickValue = new Uint32Array(buf)[0];
      this.pickPending = false;
    }, () => { this.pickPending = false; });
  }
  /** what was under the last point read */
  picked(): Picked {
    const kind = this.pickValue >>> 20;
    const cell = this.pickValue & 0xfffff;
    const part = KIND_TO_PART[kind] ?? (this.store.inside !== null ? PART.cytosol : this.inMedium() ? PART.medium : 0);
    return { part, cell, well: kind === 18 ? cell : null };
  }
  /** what the store says is being looked at, in words (data/parts.ts, world/describe.ts) */
  describe(): Look { return describe(this.store); }

  // ----------------------------------------------------------------------------------------------- the field's upkeep

  private writeCells() {
    const field = this.field;
    const d = new Float32Array(8 * (field.cells[field.cells.length - 1].i + 1));
    for (const c of field.cells) {
      const o = c.i * 8;
      d[o] = c.x; d[o + 1] = c.h; d[o + 2] = c.z; d[o + 3] = c.r;
      d[o + 4] = c.hepatocyte ? 1 : 0; d[o + 5] = c.island; d[o + 6] = c.seed; d[o + 7] = 0;
    }
    this.cellBuf.write(d);
    const n = nucleiOnly(field.cells);
    this.nucBuf.write(n.data);
    this.nucCount = n.count;
  }

  private rebuildField() {
    const store = this.store;
    if (this.fieldKey === store.systemId) return;
    this.fieldKey = store.systemId;
    clearOrgCache();
    this.field = buildField(store.system);
    const s2 = fieldScratch(this.field);
    s2.mesh.writeInto(this.mesh);
    s2.canals.writeInto(this.canalMesh);
    this.writeCells();
    this.detailKey = '';
    this.updateDetail(true);
  }

  /** the organelles of the cells nearest the eye */
  updateDetail(force = false) {
    const [cx, , cz] = this.eye;
    const field = this.field;
    if (!force) {
      if (performance.now() - this.lastDetailAt < 110) return;
      if (Math.hypot(cx - this.lastDetailPos[0], cz - this.lastDetailPos[1]) < field.pitch * 0.2) return;
    }
    this.lastDetailAt = performance.now();
    this.lastDetailPos = [cx, cz];
    const near = field.cells
      .map((c) => ({ c, d: (c.x - cx) ** 2 + (c.z - cz) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.detailCells)
      .map((x) => x.c);
    const key = near.map((c) => c.i).join(',');
    if (key === this.detailKey) return;
    this.detailKey = key;
    let n = 0;
    const scratch = this.scratch;
    for (const c of near) {
      const o = cellOrgs(c, this.fieldKey);
      if ((n + o.count) * ORG_FLOATS > scratch.length) break;
      scratch.set(o.data, n * ORG_FLOATS);
      n += o.count;
    }
    this.orgBuf.write(scratch.subarray(0, n * ORG_FLOATS));
    this.orgCount = n;
  }

  /** the colour of each well (the worst thing happening in it), its viability, and whether it's the hovered one */
  private writeWells() {
    const store = this.store, wellData = this.wellData;
    for (const w of store.plate()) {
      const o = w.index * 8;
      const dom = w.axes;
      let r = 0.93, g = 0.5, b = 0.3;
      const worst = Math.max(dom.leak, dom.karyolysis, dom.condense);
      if (worst > 0.2) { r = 0.78; g = 0.26 + 0.2 * (1 - worst); b = 0.26; }
      else if (dom.lipid > 0.25) { r = 0.95; g = 0.82; b = 0.32; }
      else if (dom.pld > 0.25) { r = 0.85; g = 0.46; b = 0.9; }
      else if (dom.constrict > 0.25) { r = 0.35; g = 0.82; b = 0.74; }
      else if (dom.dna > 0.25) { r = 0.3; g = 0.86; b = 0.84; }
      else if (dom.depol > 0.25) { r = 0.97; g = 0.6; b = 0.22; }
      wellData[o] = w.viability;
      wellData[o + 1] = (w.compound.hue % 360) / 360;
      wellData[o + 2] = w.dose > 0 ? Math.min(1, Math.log10(1 + w.dose) / 4) : 0;
      wellData[o + 3] = store.hoverWell === w.index ? 1 : store.wellIndex() === w.index ? 0.55 : 0;
      wellData[o + 4] = r; wellData[o + 5] = g; wellData[o + 6] = b; wellData[o + 7] = 1;
    }
    this.wellBuf.write(wellData);
  }

  /** the debugging view of the field (counts, the cells with organelles) */
  dbg() { return { orgCount: this.orgCount, nucCount: this.nucCount, detailKey: this.detailKey, field: this.field, eye: this.eye, origin: this.origin, veil: this.veil, fogK: this.fogK }; }
}
