// Someone of Boulder's cast lying on their back in the meadow at Chautauqua, looking up (cast.ts; pose.ts says who):
// their own mesh (Boulder's DNC1 file from its Blender pipeline, public/data/figure/) drawn as Boulder draws them (shaders/
// figure.wgsl, after its hero.wgsl). Lying still, the whole body has one skin transform (pose.ts, written by
// tools/figure-pose.mjs). The dive goes into their drawn right eye (FIGURE_EYE), which holds the zoom down to the
// cornea's cells. Drawn into Seven Havens' scene and its shadow maps (world: Universe's gardens), then once her eye
// fills the frame into its HDR alone (facePass); or, in the meadow (meadow: a planetarium's dome, ?nogardens), before
// the scene into a target of its own, four samples a pixel — its colour and coverage, and the inverse of its distance
// — which the meadow (c_ground.wgsl) lays into its grass, the blades in front of them in front.
/** who lies there */
export const WHO = CAST[FIGURE];
import { Ref, type Kit, type RenderPass, type StorageBuffer, type Texture, type UniformBuffer } from '@ericrius1/weft';
import shader from '../shaders/figure.wgsl';
import type { CosmosRenderer, Level } from '../renderer';
import { vec3 } from 'math';
import { FIGURE, FIGURE_FOCUS, FIGURE_FOCUS_N, POSE_D, POSE_R } from './pose';
import { EYE_ROT } from '../frames';
import { CAST } from './cast';

const VBYTES = 24;
// (position u16x3 + material, the normal with the baked occlusion in w, the lip mask / thickness / curvature)
const LAYOUT: GPUVertexBufferLayout = {
  arrayStride: VBYTES, attributes: [
    { shaderLocation: 0, offset: 0, format: 'uint16x4' }, { shaderLocation: 1, offset: 8, format: 'snorm8x4' },
    { shaderLocation: 2, offset: 12, format: 'snorm8x4' },
  ],
};

interface Header {
  verts: number; indices: number; stride: number; qmin: number[]; qmax: number[];
  eye: { x: number; y: number; z: number; r: number };
  face: { brow_y: number; mouth_y: number; lip_w: number; nose_tip: [number, number] };
}

async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const b = new Uint8Array(buf, 0, 2);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return buf;
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

export class Figure {
  /** what the meadow lays in: colour (premultiplied) and coverage; the inverse distance (m) and coverage (a texel of
   *  nothing each where there's no meadow) */
  readonly col: Texture;
  readonly dist: Texture;
  /** the meadow's pass (null: no meadow) */
  readonly pass: RenderPass | null;
  readonly u: UniformBuffer<any>;
  ready = false;
  /** drawn at all (not while they'd be under a few pixels: the meadow and the gardens leave them out then) */
  shown = true;
  /** drawn this frame into Seven Havens' scene (world), or alone into the frame (facePass) */
  inWorld = false;
  face = false;
  private loading = false;
  private vb: StorageBuffer | null = null;
  private ib: StorageBuffer | null = null;
  private n = 0;
  private night = 0;
  private readonly bind: Record<string, unknown>;

  /** meadow: drawn into a target of its own for the meadow to lay in (a dome's, ?nogardens) */
  constructor(private kit: Kit, ground: Level, R: CosmosRenderer, private url: string, meadow: boolean) {
    const dome = R.dome;
    const size: [number, number] | 'render' = dome ? [dome.size, dome.size] : 'render';
    const ms = (label: string, format: GPUTextureFormat) => kit.texture({ label, format, size, samples: 4 });
    const own = (label: string) => kit.texture({ label, format: 'rgba16float', size: meadow ? size : [1, 1] });
    this.col = own('figure.col');
    this.dist = own('figure.dist');
    this.u = kit.uniforms(shader.structs.HeroU, 'figure');
    this.bind = { L: ground.L, HU: this.u, F: R.P };
    this.pass = meadow ? kit.pass({
      label: 'figure',
      color: [
        { target: ms('figure.col.ms', 'rgba16float'), resolve: this.col, clear: [0, 0, 0, 0], store: false },
        { target: ms('figure.dist.ms', 'rgba16float'), resolve: this.dist, clear: [0, 0, 0, 0], store: false },
      ],
      depth: { target: ms('figure.depth', 'depth32float'), clear: 0, store: false },
      enabled: () => ground.on() && this.shown,
    }) : null;
    if (!this.pass) return;
    this.pass.draw(shader, { ...this.draw(), label: 'figure', vertex: 'vs', fragment: 'fs', cull: 'none' });
    // (the ink hull's back faces: a dome's fisheye mirrors the picture, so its winding turns over)
    this.pass.draw(shader, { ...this.draw(), label: 'figure.ink', vertex: 'vsOutline', fragment: 'fsOutline', cull: 'front', frontFace: dome ? 'cw' : 'ccw' });
  }

  private draw(enabled = () => this.ready) {
    return {
      vertexBuffers: [{ layout: LAYOUT, buffer: new Ref(() => this.vb) }], indices: { buffer: new Ref(() => this.ib), format: 'uint32' as GPUIndexFormat },
      count: () => this.n, bind: this.bind as never, enabled,
    };
  }

  /** drawn into Seven Havens' scene pass (its slot for the cast) and its shadow passes while `inWorld` */
  world(scene: RenderPass, into: (draw: () => void) => void, shadows: RenderPass[]) {
    const on = () => this.ready && this.inWorld && this.shown;
    into(() => {
      scene.draw(shader, { ...this.draw(on), label: 'figure.w', vertex: 'vs', fragment: 'fsHdr', cull: 'none' });
      scene.draw(shader, { ...this.draw(on), label: 'figure.w.ink', vertex: 'vsOutline', fragment: 'fsOutlineHdr', cull: 'front' });
    });
    for (const p of shadows) p.draw(shader, { ...this.draw(on), label: `${p.label}.figure`, vertex: 'vsShadow', fragment: null, cull: 'none' });
  }

  /** a pass that draws them alone into the frame's HDR (`target`, cleared) while `face`: her eye filling it, the
   *  world behind not seen; `depth` a single-sample depth target the render's size */
  facePass(target: Texture, depth: Texture) {
    const p = this.kit.pass({ label: 'figure.face', color: [{ target, clear: [0, 0, 0, 1] }], depth: { target: depth, clear: 0, store: false }, enabled: () => this.face && this.shown });
    p.draw(shader, { ...this.draw(), label: 'figure.face', vertex: 'vs', fragment: 'fsHdr', cull: 'none' });
    p.draw(shader, { ...this.draw(), label: 'figure.face.ink', vertex: 'vsOutline', fragment: 'fsOutlineHdr', cull: 'front' });
    return p;
  }

  /** fetch the mesh (once, when the dive comes near) */
  async load() {
    if (this.loading) return;
    this.loading = true;
    const r = await fetch(this.url);
    if (!r.ok) throw new Error(`${this.url}: ${r.status}`);
    const buf = await gunzip(await r.arrayBuffer());
    const dv = new DataView(buf);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'DNC1') throw new Error(`${this.url}: not a DNC1 character file`);
    const hl = dv.getUint32(8, true);
    const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, hl))) as Header;
    if (h.stride !== VBYTES) throw new Error(`${this.url}: stride ${h.stride}`);
    const vOff = 12 + hl, vBytes = h.verts * VBYTES;
    const verts = new Uint8Array(buf.slice(vOff, vOff + vBytes));
    const idx = new Uint32Array(buf.slice(vOff + vBytes, vOff + vBytes + h.indices * 4));
    this.vb = this.kit.storage({ label: 'figure.vb', data: verts, usage: ['vertex', 'copy-dst'] });
    this.ib = this.kit.storage({ label: 'figure.ib', data: idx, usage: ['index', 'copy-dst'] });
    this.n = idx.length;
    const W = WHO, cel: number[][] = [], shade: number[][] = [];
    for (let i = 0; i < 16; i++) {
      const m = W.model[i];
      cel.push(m ? [...m[0], 1] : [0, 0, 0, 0]);
      shade.push(m ? [...m[1], 1] : [0, 0, 0, 0]);
    }
    const e = h.eye, f = h.face;
    this.u.set({
      qmin: [h.qmin[0], h.qmin[1], h.qmin[2], f.nose_tip[0]], qmax: [h.qmax[0], h.qmax[1], h.qmax[2], 1],
      eye: [e.x, e.y, e.z, e.r], face: [f.brow_y, f.mouth_y, f.lip_w, f.nose_tip[1]],
      headR: [...POSE_R], headD: [...POSE_D],
      // (at ease, looking up into the sky)
      face2: [0, W.smile, 0, 0], face3: [0, 0, 0, 0], faceB: [0.1, 0.1, 0, 0], faceE: [0, W.lidUp, W.lidLow, 0],
      faceM: [0, 0, 0, 0], faceN: [0, 0, 0, 0], faceX: [0, W.blush, 0, 0],
      toon: [2.4, 0.4, 0, 0],
      actor: W.cast, actorIris: W.iris, actor2: W.mouth, actor3: W.shading, actor4: [0, 0, 0, 0],
      hide: [0, 1, 2, 3].map((i) => W.hide[i] ?? -1),
      focus: [...FIGURE_FOCUS, 0], focusN: [...FIGURE_FOCUS_N, 0],
      // (the tissue's sheet: the eye frame's x and z, in the ground's)
      sheetX: [...vec3.transformQuat([0, 0, 0], [1, 0, 0], EYE_ROT), 0], sheetZ: [...vec3.transformQuat([0, 0, 0], [0, 0, 1], EYE_ROT), 0],
      cel: cel as never, celShade: shade as never,
    });
    this.ready = true;
  }

  /** this frame: how far the cornea's cells show, the night, the meadow's exposure (to undo) */
  update(cells: number, night: number, exposure: number) {
    this.night = night;
    this.u.set({ deep: [cells, 0, 0, exposure], sky: [night, 0, 0, 0] });
  }

  /** where the ground frame's origin is in Seven Havens' world (m), and this frame: drawn in its scene (inWorld: with
   *  its exposure), or alone (face) */
  placeIn(spot: readonly number[], exposure: number) {
    const w = this.inWorld;
    this.u.set({ sky: [this.night, w ? 1 : 0, 0, 0], world: [spot[0], spot[1], spot[2], w ? 1 / Math.max(exposure, 1e-9) : 1] });
  }
}
