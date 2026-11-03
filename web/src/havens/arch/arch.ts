// The builders' architecture drawn and walked: what the city, the temple and its gardens hand over (types.ts ArchPart),
// one call per part — `add(part, slot)`. Its mesh goes to a worker of its own (bake.worker.ts: parts bake side by side)
// that refines it where its lights fall, bakes the night's light into its vertices (past its own walls only) and cuts
// it into pieces on a lattice (bake.ts, chunks.ts); back here the pieces are uploaded (two vertex streams: the
// positions alone for the shadow passes, the rest for the scene) and drawn into the part's slot of the scene and into
// every one of the sun's cascades — each piece only where that view holds it, one indexed draw per piece. The GPU
// culls them (cull.ts): each piece's box against each view's frustum, and the scene's against what stands in front of
// it too; the draws are recorded once into render bundles and drawn as the GPU's numbers say, so the CPU never walks
// the pieces (`passes()` goes in the frame's run before the shadows). Where the GPU can't (no first instance from an
// indirect draw's arguments) or settings.cull is 0, the CPU tests each piece's box each frame as it used to.
// arch.wgsl lights and paints it, its materials from materials.ts, its textures one array of the painted ones
// (public/assets/tex, 1024² with mips). The part's colliders join one CollisionSet (collide.ts) the player's world asks
// by where she is (walk), with a ray against them all (raycast). Its braziers ('fire' lights) light only once fire
// reaches them (ignite) and go out under water (douse). Its lights near a point, as the world's dynamic lamps, light
// the characters as the bake lights the walls (lampsNear).
import { Ref, RunAction, mat4Mul, type Draw, type DrawBundle, type Kit, type RenderPass, type RunEntry, type StorageBuffer, type Texture, type UniformBuffer, type View } from '@ericrius1/weft';
import shader from './arch.wgsl';
import { Cull, CullSet, SCENE, OCCLUDERS, EVERY, CASCADE0, type CullCount } from './cull';
import type { Env } from '../world/env';
import type { Slots } from '../util/slots';
import type { SceneSlot } from '../world/order';
import type { HeroWorld } from '../hero/world';
import type { ArchPart, GardenBed, LightSpot, V3, WaterBody } from './types';
import { CollisionSet, type RayHit } from './collide';
import { TEXTURES, materialRows, paletteRows } from './materials';
import { POS_BYTES, ATTR_BYTES, STEP, mergePacked, type Packed } from './chunks';
import type { BakeOptions } from './bake';
import { tier } from '../util/tier';
import type { BakeJob, BakeDone, BakeFailed } from './bake.worker';
import { asset, loadBlob } from '../util/assets';
import { solidTexture, textureFromBitmaps } from '../util/textures';

const POS_LAYOUT: GPUVertexBufferLayout = { arrayStride: POS_BYTES, attributes: [{ shaderLocation: 0, offset: 0, format: 'uint16x4' }] };
const ATTR_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: ATTR_BYTES, attributes: [
    { shaderLocation: 1, offset: 0, format: 'snorm16x2' }, { shaderLocation: 2, offset: 4, format: 'float16x2' },
    { shaderLocation: 3, offset: 8, format: 'unorm8x4' }, { shaderLocation: 4, offset: 12, format: 'unorm8x4' },
    { shaderLocation: 5, offset: 16, format: 'uint32' },
  ],
};
/** the texture array's layers' size (px) */
const TEX_PX = tier.archTexPx;
/** a world.lamps entry's w for a part's own light (lampsNear): all round, as 9 is, and baked already (arch.wgsl's
 *  ARCH_LAMP) */
const ARCH_LAMP = 10;

/** the cull at first (?cull=cpu|frustum|gpu: ArchRenderer.settings.cull) */
const CULL_MODE = ({ cpu: 0, frustum: 1, gpu: 2 } as Record<string, number>)[new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('cull') ?? 'gpu'] ?? 2;

/** no walk-in room (ArchU.room) */
const NO_ROOM: [number, number, number, number][] = Array.from({ length: 6 }, () => [0, 0, 0, 0]);

/** what became of a part: its triangles as handed over and as drawn (refined round its lights), its vertices and
 *  pieces, its lights and fires, its GPU bytes, how long each step took (ms) */
export interface ArchStats {
  name: string;
  triangles: number;
  drawn: number;
  vertices: number;
  pieces: number;
  lights: number;
  fires: number;
  colliders: number;
  bytes: number;
  ms: { refine: number; light: number; pack: number; worker: number; upload: number };
}

/** a part as drawn: its buffers, its pieces' boxes and draws, its fires */
interface Drawn {
  name: string;
  pos: StorageBuffer;
  attr: StorageBuffer;
  idx: StorageBuffer;
  chunks: StorageBuffer;
  fireBuf: StorageBuffer;
  fireData: Float32Array;
  fireLights: LightSpot[];
  boxes: Float32Array;
  draws: Uint32Array;
  /** per piece, the index count of its occluders (chunks.ts: its first triangles) */
  solid: Uint32Array;
  count: number;
  /** its pieces in the GPU's cull (none: culled on the CPU) */
  set: CullSet | null;
  /** not drawn (show(false)) */
  hidden: boolean;
}

/** a part as kept: what the flora and the water read (its beds, its pools), its lights */
export interface ArchPartInfo { name: string; slot: SceneSlot; lights: LightSpot[]; water: WaterBody[]; beds: GardenBed[]; stats: ArchStats | null }

export class ArchRenderer {
  readonly collision = new CollisionSet();
  readonly parts: ArchPartInfo[] = [];
  /** the look's knobs: the lamps' light on screen per candela at 1 m, the exposure it's held at, the glows' strength,
   *  the lights on (-1 by the sun, else 0..1), the shade's lean to violet, the painted wander, the canyon floor's
   *  bounce, a debug view (1 the pieces, 2 the night's light alone, 3 the albedo, 4 the normals, 5 the GPU cull's
   *  verdicts, frozen where they were made: every piece drawn, those it drew as they are, those the occluders hid red,
   *  those out of the view blue — fly off and look; 6 the painted detail alone, 7 the height over the ground it's
   *  painted by). The painted detail's (arch.wgsl's; each material's own in materials.ts): all of it (0 off: the look
   *  before it), the textures' relief, the cut blocks' joints, the grime low on the walls and in their creases, the
   *  streaks down them, the dust on what faces up and the sun's fading, the plaster's marks (its dado, trowel strokes,
   *  patches, cracks); and whether it's drawn in full (the phone's 0: no relief, no finest marks). And the cull (0 the
   *  CPU's, each frame; 1 the GPU's, the views' frustums; 2 the GPU's, and what stands in front: ?cull=cpu|frustum|gpu) */
  readonly settings = {
    lamps: 0.4, hold: 4, glow: 1.4, on: -1, violet: 0.75, wander: 1, bounce: 1, debug: 0,
    paint: 1, relief: 1, masonry: 1, grime: 1, streaks: 1, dust: 1, marks: 1, paintFull: tier.phone ? 0 : 1,
    cull: CULL_MODE,
  };
  /** the GPU's cull of the pieces (cull.ts): its occluders' pass and its settings */
  readonly cull: Cull;
  /** the walk-in room whose inside is lit as an inside (arch.wgsl ArchU.room: room/room.ts sets it), or none */
  room: [number, number, number, number][] | null = null;
  /** the pieces drawn and their triangles, per view, the last frame */
  readonly drawn = new Map<string, { pieces: number; triangles: number }>();
  /** every part added so far is drawn (its bake back and uploaded) */
  get ready(): Promise<void> { return Promise.all(this.pending).then(() => {}); }

  private u: UniformBuffer<any>;
  /** the scene's eye, for positions relative to it (arch.wgsl ArchEye) */
  private eyeU: UniformBuffer<any>;
  private eyeView = new Float64Array(16);
  private tex: Texture;
  private texRef: Ref<Texture>;
  private nextJob = 1;
  private pending: Promise<unknown>[] = [];
  private drawnParts: Drawn[] = [];
  private frameSeen = -1;
  /** the GPU's draws: the scene's bundle in each slot, each cascade's, the occluders'; the scene's draws (bound to the
   *  textures directly, not through the Ref: a bundle would be checked every frame for it moving) */
  private bundles = new Map<string, DrawBundle>();
  private lit: Draw<typeof shader>[] = [];
  private knob = new RunAction(() => { this.knobs(); this.eye(); }, 'arch.knobs');

  /** `after`: the painted textures fetched once it's done (main.ts: the builders' workers' script in first, the slowest
   *  of the load waiting on it), and then at a low priority: the parts are drawn plain till they're in */
  constructor(readonly kit: Kit, readonly env: Env, readonly scene: RenderPass, readonly order: Slots<SceneSlot>, after?: Promise<unknown>) {
    this.u = kit.uniforms(shader.structs.ArchU, 'arch');
    this.eyeU = kit.uniforms(shader.structs.ArchEye, 'arch.eye');
    this.cull = new Cull(kit, env.shadows.views, (k) => { const on = env.shadows.passes[k]?.enabled; return typeof on === 'function' ? on() : !!on; });
    if (!this.cull.supported) this.settings.cull = 0;
    this.refresh();
    const tex = this.tex = solidTexture(kit, [205, 160, 128, 255], TEXTURES.length, 'arch.textures.none');
    this.texRef = new Ref(() => this.tex);
    Promise.resolve(after).then(() => loadLayers(kit)).then((t) => {
      this.tex = t;
      for (const d of this.lit) d.set('matTex', t);
      tex.destroy();
    }, (e) => console.warn('arch: the textures did not load', e));
  }

  /** the GPU's cull this frame */
  get gpu() { return this.cull.supported && this.settings.cull > 0; }

  /** the frame's run, before the shadows and the scene: the knobs, and the GPU's cull of the pieces (cull.ts) */
  passes(): RunEntry[] { return this.gpu ? [this.knob, ...this.cull.passes()] : [this.knob]; }

  /** what the parts' instances (instances.ts) are shaded with, shared with the parts: the uniform (materials, palettes,
   *  the night's knobs) and the painted textures */
  get look() { return { AU: this.u, matTex: this.texRef }; }

  /** the materials and the tiles' palettes (materials.ts, read again: edit MATERIALS or PALETTES, then call this) and
   *  the settings into the uniform */
  refresh() {
    this.u.set({ mats: materialRows() as never, pal: paletteRows() as never });
    this.knobs();
  }

  /** the settings into the uniform (each frame, before anything draws: the panel may have moved them) */
  private knobs() {
    const s = this.settings;
    this.u.set({
      night: [s.lamps, s.hold, s.glow, s.on], look: [s.violet, s.wander, s.debug, s.bounce], room: (this.room ?? NO_ROOM) as never,
      paint: [s.paint, s.relief, s.masonry, s.paintFull], wear: [s.grime, s.streaks, s.dust, s.marks],
    });
    this.u.upload();
    this.cull.settings.occlusion = s.cull >= 2;
    this.cull.settings.freeze = s.debug === 5;
  }

  /** the scene's eye snapped to the pieces' lattice, and the view-projection from there (its last fraction of a step
   *  in the translation, worked out in doubles): the scene's vertices taken relative to the eye, exactly (arch.wgsl
   *  ArchEye) */
  private eye() {
    const c = this.kit.mainView.camera, p = c.position, V = c.view, E = this.eyeView;
    const at = [Math.round(p[0] / STEP) * STEP, Math.round(p[1] / STEP) * STEP, Math.round(p[2] / STEP) * STEP];
    const lo = [p[0] - at[0], p[1] - at[1], p[2] - at[2]];
    E.set(V);
    for (let r = 0; r < 3; r++) E[12 + r] = -(V[r] * lo[0] + V[4 + r] * lo[1] + V[8 + r] * lo[2]);
    this.eyeU.set({ at: [at[0], at[1], at[2], 0], viewProj: mat4Mul(c.proj, E) });
    this.eyeU.upload();
  }

  /** the player's world walks every part's colliders from now on (only those near her are asked) */
  walk(world: HeroWorld) {
    world.moreNear = (x, z, r) => this.collision.near(x, z, r);
  }

  /** a part, drawn into `slot` of the scene and into the sun's cascades, its night light baked, its colliders walked,
   *  its pools and beds kept for the water and the flora. The mesh's arrays are handed to the bake (moved, not copied:
   *  they're empty after) */
  add(part: ArchPart, slot: SceneSlot = 'city', options: Partial<BakeOptions> = {}): Promise<ArchStats> {
    this.collision.add(part.colliders);
    const info: ArchPartInfo = { name: part.name, slot, lights: part.lights, water: part.water, beds: part.beds, stats: null };
    this.parts.push(info);
    const t0 = performance.now();
    // (a part cut into regions bakes them side by side, a worker each, and their packs are made one again: the same
    // pieces as its one bake's)
    const meshes = part.regions ?? [part.mesh];
    const triangles = meshes.reduce((n, m) => n + m.idx.length / 3, 0);
    const job = Promise.all(meshes.map((mesh) => this.bake({ id: this.nextJob++, mesh, lights: part.lights, colliders: part.colliders, options }))).then((dones) => {
      const t1 = performance.now();
      const fireLights = part.lights.filter((l) => l.when === 'fire');
      const packed = mergePacked(dones.map((x) => x.packed));
      const d = this.upload(part.name, packed, fireLights);
      this.draw(d, slot);
      const bytes = d.pos.size + d.attr.size + d.idx.size + d.chunks.size + d.fireBuf.size;
      const most = (k: 'refine' | 'light' | 'pack') => Math.max(...dones.map((x) => x.ms[k]));
      info.stats = {
        name: part.name, triangles, drawn: packed.triangles, vertices: packed.vertices, pieces: d.count, lights: part.lights.length,
        fires: fireLights.length, colliders: part.colliders.length, bytes,
        ms: { refine: most('refine'), light: most('light'), pack: most('pack'), worker: t1 - t0, upload: performance.now() - t1 },
      };
      return info.stats;
    });
    this.pending.push(job.catch(() => {}));
    return job;
  }

  /** a part's bake in a worker of its own (parts bake side by side), gone once it's done */
  private bake(job: BakeJob): Promise<BakeDone> {
    const w = new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module', name: `arch.bake${job.id}` });
    const m = job.mesh;
    return new Promise<BakeDone>((resolve, reject) => {
      w.onmessage = (e: MessageEvent<BakeDone | BakeFailed>) => {
        if ('error' in e.data) reject(new Error(`arch: the bake failed: ${e.data.error}`));
        else resolve(e.data);
      };
      w.onerror = (e) => reject(new Error(`arch: the bake's worker: ${e.message}`));
      // (each buffer once: arrays may share one)
      const moved = new Set([m.pos.buffer, m.nrm.buffer, m.uv.buffer, m.mat.buffer, m.tint.buffer, m.ao.buffer, m.glow.buffer, m.idx.buffer]);
      w.postMessage(job, [...moved] as Transferable[]);
    }).finally(() => w.terminate());
  }

  private upload(name: string, p: Packed, fireLights: LightSpot[]): Drawn {
    const kit = this.kit;
    // (each fire's colour, and how lit it is: out till fire reaches it; its strength is baked per vertex)
    const fireData = new Float32Array(Math.max(1, fireLights.length) * 4);
    fireLights.forEach((l, i) => fireData.set([l.color[0], l.color[1], l.color[2], 0], i * 4));
    const d: Drawn = {
      name,
      pos: kit.storage({ label: `arch.${name}.pos`, data: p.pos, usage: ['vertex', 'copy-dst'] }),
      attr: kit.storage({ label: `arch.${name}.attr`, data: p.attr, usage: ['vertex', 'copy-dst'] }),
      idx: kit.storage({ label: `arch.${name}.idx`, data: p.idx, usage: ['index', 'copy-dst'] }),
      chunks: kit.storage({ label: `arch.${name}.chunks`, data: p.chunks }),
      fireBuf: kit.storage({ label: `arch.${name}.fires`, data: fireData }),
      fireData, fireLights, boxes: p.boxes, draws: p.draws, solid: p.solid, count: p.draws.length / 3, set: null, hidden: false,
    };
    this.drawnParts.push(d);
    return d;
  }

  /** a part's draws: into its slot of the scene, and into each of the sun's cascades (all of them: buildings cast far).
   *  The GPU's: one draw a view whose arguments the cull writes, a piece each, baked into that view's bundle (the
   *  scene's in the part's slot) — and into the occluders' pass, depth-only, culled from the back as the scene's are
   *  (a wall seen from behind hides nothing there). The CPU's: the same views, each piece's box tested every frame */
  private draw(d: Drawn, slot: SceneSlot) {
    const idx = { buffer: d.idx, format: 'uint16' as GPUIndexFormat };
    const scene = { vertexBuffers: [{ layout: POS_LAYOUT, buffer: d.pos }, { layout: ATTR_LAYOUT, buffer: d.attr }], indices: idx };
    const depth = { vertex: 'vsShadow', fragment: null, vertexBuffers: [{ layout: POS_LAYOUT, buffer: d.pos }], indices: idx, bind: { chunks: d.chunks } as never };
    this.order.into(slot, () => this.scene.draw(shader, {
      label: `arch.${d.name}`, vertex: 'vs', fragment: 'fs', cull: 'back', ...scene,
      bind: { chunks: d.chunks, AU: this.u, AE: this.eyeU, matTex: this.texRef, fires: d.fireBuf } as never,
      enabled: () => !d.hidden && !this.gpu,
      encode: (pe, draw) => this.pieces(pe, d, draw.pass.opts.view ?? this.kit.mainView, 'scene'),
    }));
    this.env.shadows.passes.forEach((pass) => pass.draw(shader, {
      label: `${pass.label}.arch.${d.name}`, cull: 'none', ...depth,
      enabled: () => !d.hidden && !this.gpu,
      encode: (pe, draw) => this.pieces(pe, d, draw.pass.opts.view ?? this.kit.mainView, pass.label),
    }));
    if (!this.cull.supported) return;
    const set = d.set = this.cull.add(d.name, d.boxes, d.draws, d.solid);
    this.lit.push(this.bundle(`arch.${slot}`, () => this.order.into(slot, () => this.scene.bundle(`arch.${slot}`))).draw(shader, {
      label: `arch.${d.name}`, vertex: 'vs', fragment: 'fs', cull: 'back', ...scene,
      bind: { chunks: d.chunks, AU: this.u, AE: this.eyeU, matTex: this.tex, fires: d.fireBuf } as never,
      enabled: () => !d.hidden, indirect: set.indirect(() => (this.settings.debug === 5 ? EVERY : SCENE)),
    }));
    this.bundle('arch.occluders', () => this.cull.prez.bundle('arch.occluders')).draw(shader, {
      label: `arch.occluders.${d.name}`, cull: 'back', ...depth, enabled: () => !d.hidden, indirect: set.indirect(OCCLUDERS),
    });
    this.env.shadows.passes.forEach((pass, k) => this.bundle(`${pass.label}.arch`, () => pass.bundle(`${pass.label}.arch`)).draw(shader, {
      label: `${pass.label}.arch.${d.name}`, cull: 'none', ...depth, enabled: () => !d.hidden, indirect: set.indirect(CASCADE0 + k),
    }));
  }

  /** a bundle of the GPU's draws (made the first time it's asked for), drawn while the GPU culls */
  private bundle(label: string, make: () => DrawBundle) {
    let b = this.bundles.get(label);
    if (!b) {
      this.bundles.set(label, b = make());
      b.enabled = () => this.gpu;
    }
    return b;
  }

  /** a part's pieces in a view's frustum (their boxes, not spheres round them: a cascade's light box is a thin column
   *  reaching far toward the sun, and a 64 m piece's sphere meets it where the piece itself is well under it), each one
   *  indexed draw (its lattice by the instance index) */
  private pieces(pe: GPURenderPassEncoder, d: Drawn, view: View, label: string) {
    if (this.frameSeen !== this.kit.frameIndex) {
      this.frameSeen = this.kit.frameIndex;
      this.drawn.clear();
    }
    const pl = view.camera.planes, B = d.boxes, D = d.draws;
    let pieces = 0, tris = 0;
    for (let i = 0; i < d.count; i++) {
      const o = i * 6;
      let seen = true;
      // (the box's corner farthest along each plane's normal, inside it or the box is out)
      for (let k = 0; k < 24 && seen; k += 4) {
        const x = pl[k] > 0 ? B[o + 3] : B[o], y = pl[k + 1] > 0 ? B[o + 4] : B[o + 1], z = pl[k + 2] > 0 ? B[o + 5] : B[o + 2];
        if (pl[k] * x + pl[k + 1] * y + pl[k + 2] * z + pl[k + 3] < 0) seen = false;
      }
      if (!seen) continue;
      pe.drawIndexed(D[i * 3 + 1], 1, D[i * 3], D[i * 3 + 2], i);
      pieces++;
      tris += D[i * 3 + 1] / 3;
    }
    const was = this.drawn.get(label);
    this.drawn.set(label, { pieces: (was?.pieces ?? 0) + pieces, triangles: (was?.triangles ?? 0) + tris });
  }

  /** every part's fires within r of p lit (or `lit` 0..1); how many were */
  ignite(p: V3, r: number, lit = 1): number {
    let n = 0;
    for (const d of this.drawnParts) {
      let changed = false;
      d.fireLights.forEach((l, i) => {
        if (Math.hypot(l.p[0] - p[0], l.p[1] - p[1], l.p[2] - p[2]) > r) return;
        d.fireData[i * 4 + 3] = lit;
        changed = true;
        n++;
      });
      if (changed) d.fireBuf.write(d.fireData);
    }
    return n;
  }

  /** every part's fires within r of p put out */
  douse(p: V3, r: number): number { return this.ignite(p, r, 0); }

  /** draw the parts or not (their colliders stay) */
  show(on: boolean) { for (const d of this.drawnParts) d.hidden = !on; }

  /** where the underground lights ('under': the caverns' crystals) reach the characters: only from inside (null: from
   *  anywhere). Their light comes through no floor */
  underground: ((p: V3) => boolean) | null = null;

  /** the parts' `n` nearest lights to p that are lit now (and any `more`: lights of the world's that aren't a part's, the
   *  rocks' grottos), as world.lamps entries (two vec4s each: [x, y, z, strength], [r, g, b, w]): what lights the
   *  characters as the baked light lights the walls (world.wgsl outdoorLamps). Their strength held as the baked light's
   *  is: `exposure` the eye's (env.exposure), `sunY` the sun's height (env.state.sun.dir[1]) for when the lights are on.
   *  w is 9 (all round) for the world's others and ARCH_LAMP for a part's own: lit all round as well, but its light is in
   *  the parts' bake already, so arch.wgsl leaves it out (summed again it doubled every pool within 14 m of her, past
   *  the walls and stall cloths the bake stops it at, each lamp's pool popping to half as she walked out of its eight) */
  lampsNear(p: V3, n: number, exposure: number, sunY: number, more: LightSpot[] = []): [number, number, number, number][] {
    const s = this.settings, x = Math.min(1, Math.max(0, (0.06 - sunY) / 0.14));
    const on = s.on >= 0 ? s.on : x * x * (3 - 2 * x), hold = Math.min(exposure, s.hold) / (s.hold * Math.max(exposure, 1e-6));
    const near: { l: LightSpot; d: number; k: number; w: number }[] = [];
    // (an underground light is lit day and night and held as the night holds the lamps: 1 / the exposure)
    const inside = this.underground?.(p) ?? true, deep = 1 / Math.max(exposure, 1e-6);
    const consider = (w: number) => (l: LightSpot) => {
      if (l.when === 'under' && !inside) return;
      const d = Math.hypot(l.p[0] - p[0], l.p[1] - p[1], l.p[2] - p[2]);
      if (d > (l.radius ?? 30)) return;
      const k = l.when === 'fire' ? this.fireLit(l) : l.when === 'under' ? deep / hold : on;
      if (k > 0) near.push({ l, d, k, w });
    };
    for (const part of this.parts) part.lights.forEach(consider(ARCH_LAMP));
    more.forEach(consider(9));
    near.sort((a, b) => a.d - b.d);
    return near.slice(0, n).flatMap(({ l, k, w }) => [[l.p[0], l.p[1], l.p[2], l.candela * s.lamps * hold * k], [l.color[0], l.color[1], l.color[2], w]] as [number, number, number, number][]);
  }

  /** how lit a fire light is (ignite) */
  private fireLit(l: LightSpot) {
    for (const d of this.drawnParts) { const i = d.fireLights.indexOf(l); if (i >= 0) return d.fireData[i * 4 + 3]; }
    return 0;
  }

  /** the first of the parts' solids, floors or stairs a ray meets within `max` m (collide.ts) */
  raycast(o: V3, d: V3, max = 200): RayHit | null { return this.collision.raycast(o, d, max); }

  /** what each part became, and what was drawn last frame (the GPU's counts a frame or two late) */
  stats() {
    return { parts: this.parts.map((p) => p.stats), drawn: Object.fromEntries(this.gpu ? this.gpuDrawn() : this.drawn) };
  }

  /** the GPU cull's counts by view (as the CPU's are named: scene, shadow0..; and the occluders' pass), and the scene's
   *  pieces the occluders hid */
  private gpuDrawn(): Map<string, CullCount> {
    const c = this.cull.drawn, out = new Map<string, CullCount>();
    const at = (r: number) => c.get(r) ?? { pieces: 0, triangles: 0 };
    out.set('scene', at(SCENE));
    this.env.shadows.passes.forEach((p, k) => out.set(p.label, at(CASCADE0 + k)));
    out.set('occluders', at(OCCLUDERS));
    out.set('hidden', this.cull.hidden);
    return out;
  }

  /** the cull's way and counts, for the dev handle's perf() */
  cullStats() {
    return { cull: this.gpu ? (this.settings.cull >= 2 ? 'gpu+occlusion' : 'gpu') : 'cpu', occluding: this.gpu && this.cull.occluding, paying: this.cull.paying, pieces: this.cull.total || this.drawnParts.reduce((n, d) => n + d.count, 0), drawn: Object.fromEntries(this.gpu ? this.gpuDrawn() : this.drawn) };
  }
}

/** the painted textures as one array (each 1024², the frieze's band squeezed square: chunks.ts fits each band at its
 *  picture's aspect); a phone's (512²) from the files made that size (tools/tex-small.sh: a quarter of the bytes) */
async function loadLayers(kit: Kit): Promise<Texture> {
  const dir = TEX_PX <= 512 ? 'tex/512' : 'tex';
  const bitmaps = await Promise.all(TEXTURES.map(async (name) => createImageBitmap(await loadBlob(asset(`${dir}/${name}.webp`), 'low'), {
    resizeWidth: TEX_PX, resizeHeight: TEX_PX, resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none',
  })));
  return textureFromBitmaps(kit, bitmaps, { srgb: true, mips: true, label: 'arch.textures' });
}
