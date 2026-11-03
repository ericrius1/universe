// The builders' architecture drawn and walked: what the city, the temple and its gardens hand over (types.ts ArchPart),
// one call per part — `add(part, slot)`. Its mesh goes to a worker of its own (bake.worker.ts: parts bake side by side)
// that refines it where its lights fall, bakes the night's light into its vertices (past its own walls only) and cuts
// it into pieces on a lattice (bake.ts, chunks.ts); back here the pieces are uploaded (two vertex streams: the
// positions alone for the shadow passes, the rest for the scene) and drawn into the part's slot of the scene and into
// every one of the sun's cascades — each piece only where that view's frustum holds it, one indexed draw per piece.
// arch.wgsl lights and paints it, its materials from materials.ts, its textures one array of the painted ones
// (public/assets/tex, 1024² with mips). The part's colliders join one CollisionSet (collide.ts) the player's world asks
// by where she is (walk), with a ray against them all (raycast). Its braziers ('fire' lights) light only once fire
// reaches them (ignite) and go out under water (douse). Its lights near a point, as the world's dynamic lamps, light
// the characters as the bake lights the walls (lampsNear).
import { Ref, type Kit, type RenderPass, type StorageBuffer, type Texture, type UniformBuffer, type View } from '@ericrius1/weft';
import shader from './arch.wgsl';
import type { Env } from '../world/env';
import type { Slots } from '../util/slots';
import type { SceneSlot } from '../app';
import type { HeroWorld } from '../hero/world';
import type { ArchPart, GardenBed, LightSpot, V3, WaterBody } from './types';
import { CollisionSet, type RayHit } from './collide';
import { TEXTURES, materialRows } from './materials';
import { POS_BYTES, ATTR_BYTES, type Packed } from './chunks';
import type { BakeOptions } from './bake';
import type { BakeJob, BakeDone, BakeFailed } from './bake.worker';
import { asset, loadBlob } from '../util/assets';
import { solidTexture, textureFromBitmaps } from '../util/textures';
import { tier } from '../util/tier';

const POS_LAYOUT: GPUVertexBufferLayout = { arrayStride: POS_BYTES, attributes: [{ shaderLocation: 0, offset: 0, format: 'uint16x4' }] };
const ATTR_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: ATTR_BYTES, attributes: [
    { shaderLocation: 1, offset: 0, format: 'snorm16x2' }, { shaderLocation: 2, offset: 4, format: 'float16x2' },
    { shaderLocation: 3, offset: 8, format: 'unorm8x4' }, { shaderLocation: 4, offset: 12, format: 'unorm8x4' },
    { shaderLocation: 5, offset: 16, format: 'uint32' },
  ],
};
/** the texture array's layers' size (px; a phone's half: 17 MB, not 67: util/tier.ts) */
const TEX_PX = tier.phone ? 512 : 1024;

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
  count: number;
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
   *  bounce, a debug view (1 the pieces, 2 the night's light alone, 3 the albedo, 4 the normals) */
  readonly settings = { lamps: 0.24, hold: 4, glow: 0.8, on: -1, violet: 0.75, wander: 1, bounce: 1, debug: 0 };
  /** the pieces drawn and their triangles, per view, the last frame */
  readonly drawn = new Map<string, { pieces: number; triangles: number }>();
  /** every part added so far is drawn (its bake back and uploaded) */
  get ready(): Promise<void> { return Promise.all(this.pending).then(() => {}); }

  private u: UniformBuffer<any>;
  private tex: Texture;
  private texRef: Ref<Texture>;
  private nextJob = 1;
  private pending: Promise<unknown>[] = [];
  private drawnParts: Drawn[] = [];
  private frameSeen = -1;

  constructor(readonly kit: Kit, readonly env: Env, readonly scene: RenderPass, readonly order: Slots<SceneSlot>) {
    this.u = kit.uniforms(shader.structs.ArchU, 'arch');
    this.refresh();
    const tex = this.tex = solidTexture(kit, [205, 160, 128, 255], TEXTURES.length, 'arch.textures.none');
    this.texRef = new Ref(() => this.tex);
    loadLayers(kit).then((t) => { this.tex = t; tex.destroy(); }, (e) => console.warn('arch: the textures did not load', e));
  }

  /** the materials (materials.ts, read again: edit MATERIALS, then call this) and the settings into the uniform */
  refresh() {
    this.u.set({ mats: materialRows() as never });
    this.knobs();
  }

  /** the settings into the uniform (each frame: the panel may have moved them) */
  private knobs() {
    const s = this.settings;
    this.u.set({ night: [s.lamps, s.hold, s.glow, s.on], look: [s.violet, s.wander, s.debug, s.bounce] });
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
    const triangles = part.mesh.idx.length / 3;
    const job = this.bake({ id: this.nextJob++, mesh: part.mesh, lights: part.lights, colliders: part.colliders, options }).then((done) => {
      const t1 = performance.now();
      const fireLights = part.lights.filter((l) => l.when === 'fire');
      const d = this.upload(part.name, done.packed, fireLights);
      this.draw(d, slot);
      const bytes = d.pos.size + d.attr.size + d.idx.size + d.chunks.size + d.fireBuf.size;
      info.stats = {
        name: part.name, triangles, drawn: done.packed.triangles, vertices: done.packed.vertices, pieces: d.count, lights: part.lights.length,
        fires: fireLights.length, colliders: part.colliders.length, bytes,
        ms: { ...done.ms, worker: t1 - t0, upload: performance.now() - t1 },
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
      fireData, fireLights, boxes: p.boxes, draws: p.draws, count: p.draws.length / 3, hidden: false,
    };
    this.drawnParts.push(d);
    return d;
  }

  /** a part's draws: into its slot of the scene, and into each of the sun's cascades (all of them: buildings cast far) */
  private draw(d: Drawn, slot: SceneSlot) {
    const idx = { buffer: d.idx, format: 'uint16' as GPUIndexFormat };
    this.order.into(slot, () => this.scene.draw(shader, {
      label: `arch.${d.name}`, vertex: 'vs', fragment: 'fs', cull: 'back',
      vertexBuffers: [{ layout: POS_LAYOUT, buffer: d.pos }, { layout: ATTR_LAYOUT, buffer: d.attr }], indices: idx,
      bind: { chunks: d.chunks, AU: this.u, matTex: this.texRef, fires: d.fireBuf } as never,
      enabled: () => !d.hidden,
      encode: (pe, draw) => this.pieces(pe, d, draw.pass.opts.view ?? this.kit.mainView, 'scene'),
    }));
    this.env.shadows.passes.forEach((pass) => pass.draw(shader, {
      label: `${pass.label}.arch.${d.name}`, vertex: 'vsShadow', fragment: null, cull: 'none',
      vertexBuffers: [{ layout: POS_LAYOUT, buffer: d.pos }], indices: idx, bind: { chunks: d.chunks } as never,
      enabled: () => !d.hidden,
      encode: (pe, draw) => this.pieces(pe, d, draw.pass.opts.view ?? this.kit.mainView, pass.label),
    }));
  }

  /** a part's pieces in a view's frustum (their boxes, not spheres round them: a cascade's light box is a thin column
   *  reaching far toward the sun, and a 64 m piece's sphere meets it where the piece itself is well under it), each one
   *  indexed draw (its lattice by the instance index) */
  private pieces(pe: GPURenderPassEncoder, d: Drawn, view: View, label: string) {
    if (this.frameSeen !== this.kit.frameIndex) {
      this.frameSeen = this.kit.frameIndex;
      this.drawn.clear();
      this.knobs();
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

  /** the parts' `n` nearest lights to p that are lit now (and any `more`: lights of the world's that aren't a part's, the
   *  rocks' grottos), as world.lamps entries (two vec4s each: [x, y, z, strength], [r, g, b, 9]): what lights the
   *  characters as the baked light lights the walls (world.wgsl outdoorLamps). Their strength held as the baked light's
   *  is: `exposure` the eye's (env.exposure), `sunY` the sun's height (env.state.sun.dir[1]) for when the lights are on */
  lampsNear(p: V3, n: number, exposure: number, sunY: number, more: LightSpot[] = []): [number, number, number, number][] {
    const s = this.settings, x = Math.min(1, Math.max(0, (0.06 - sunY) / 0.14));
    const on = s.on >= 0 ? s.on : x * x * (3 - 2 * x), hold = Math.min(exposure, s.hold) / (s.hold * Math.max(exposure, 1e-6));
    const near: { l: LightSpot; d: number; k: number }[] = [];
    const consider = (l: LightSpot) => {
      const d = Math.hypot(l.p[0] - p[0], l.p[1] - p[1], l.p[2] - p[2]);
      if (d > (l.radius ?? 30)) return;
      const k = l.when === 'fire' ? this.fireLit(l) : on;
      if (k > 0) near.push({ l, d, k });
    };
    for (const part of this.parts) part.lights.forEach(consider);
    more.forEach(consider);
    near.sort((a, b) => a.d - b.d);
    return near.slice(0, n).flatMap(({ l, k }) => [[l.p[0], l.p[1], l.p[2], l.candela * s.lamps * hold * k], [l.color[0], l.color[1], l.color[2], 9]] as [number, number, number, number][]);
  }

  /** how lit a fire light is (ignite) */
  private fireLit(l: LightSpot) {
    for (const d of this.drawnParts) { const i = d.fireLights.indexOf(l); if (i >= 0) return d.fireData[i * 4 + 3]; }
    return 0;
  }

  /** the first of the parts' solids, floors or stairs a ray meets within `max` m (collide.ts) */
  raycast(o: V3, d: V3, max = 200): RayHit | null { return this.collision.raycast(o, d, max); }

  /** what each part became, and what was drawn last frame */
  stats() {
    return { parts: this.parts.map((p) => p.stats), drawn: Object.fromEntries(this.drawn) };
  }
}

/** the painted textures as one array (each 1024², the frieze's band squeezed square: chunks.ts fits each band at its
 *  picture's aspect) */
async function loadLayers(kit: Kit): Promise<Texture> {
  const bitmaps = await Promise.all(TEXTURES.map(async (name) => createImageBitmap(await loadBlob(asset(`tex/${name}.webp`)), {
    resizeWidth: TEX_PX, resizeHeight: TEX_PX, resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none',
  })));
  return textureFromBitmaps(kit, bitmaps, { srgb: true, mips: true, label: 'arch.textures' });
}
