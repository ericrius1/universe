// One of the cast on the GPU: a skinned DNC1 mesh (hero.wgsl) drawn into the scene pass and the two nearest shadow
// cascades (the lighter twin there), posed each frame from the rig's dual quaternions, with its outfit's palette —
// Katara's own colour model, or another's CastLook (aang/look.ts, iroh/look.ts). HeroMesh.load(kit, who) loads any of
// the three.
import { type Kit, type RenderPass, type StorageBuffer, type UniformBuffer } from '@ericrius1/weft';
import heroShader from './hero.wgsl';
import { MAX_BONES, VBYTES, loadHero, type HeroAsset } from './asset';
import { asset as assetUrl } from '../util/assets';
import type { HeroRig } from './rig';
import { fromLegacy, type FaceParams, type FaceState } from '../cast/face';
import { fitHands } from '../town/hands';
import { aangLook } from '../aang/look';
import { irohLook } from '../iroh/look';

/** the three who can be played */
export type Who = 'katara' | 'aang' | 'iroh';

/** linear rgb + silkiness per palette slot (skin top bottom hair shoe trim ribbon sash under eye lash lip jewel layer
 *  accessory sheer): the Water Tribe tunic */
export const WATER_TRIBE: number[][] = [
  [0.33, 0.19, 0.11, 0], [0.025, 0.06, 0.18, 0.1], [0.012, 0.016, 0.05, 0.05], [0.03, 0.016, 0.009, 0], [0.05, 0.06, 0.085, 0.05],
  [0.45, 0.62, 0.75, 0.2], [0.72, 0.7, 0.64, 0.15], [0.75, 0.73, 0.68, 0.1], [0.3, 0.17, 0.1, 0], [0.82, 0.8, 0.76, 0],
  [0.02, 0.015, 0.01, 0], [0.24, 0.1, 0.075, 0], [0.04, 0.08, 0.2, 0], [0.025, 0.06, 0.18, 0.1], [0.02, 0.035, 0.09, 0.4], [0.5, 0.6, 0.7, 0.3],
];
const IRIS = [0.07, 0.22, 0.5];

/** the drawn look of another of the cast (hero.wgsl HeroU: actor, actorIris, actor2, actor3, actor4, cel, celShade,
 *  mark; legs: his skirt kept outside his legs, as hers is) */
export interface CastLook { cast: number[]; iris: number[]; mouth: number[]; shading: number[]; age?: number[]; cel: number[][]; shade: number[][]; mark: number[][]; legs?: boolean;
  /** the head reshaped (hero.wgsl sculptPt: sculpt, sculpt2, sculpt3) */
  sculpt?: number[][]; }
/** a bind-space point through bone i's skin transform (a dual quaternion: x y z w, then the dual part; hero.wgsl dqPoint) */
function dqPoint(dq: Float32Array, i: number, p: number[]): [number, number, number] {
  const o = i * 8, rx = dq[o], ry = dq[o + 1], rz = dq[o + 2], rw = dq[o + 3], dx = dq[o + 4], dy = dq[o + 5], dz = dq[o + 6], dw = dq[o + 7];
  const cx = ry * p[2] - rz * p[1] + rw * p[0], cy = rz * p[0] - rx * p[2] + rw * p[1], cz = rx * p[1] - ry * p[0] + rw * p[2];
  return [
    p[0] + 2 * (ry * cz - rz * cy) + 2 * (rw * dx - dw * rx + ry * dz - rz * dy),
    p[1] + 2 * (rz * cx - rx * cz) + 2 * (rw * dy - dw * ry + rz * dx - rx * dz),
    p[2] + 2 * (rx * cy - ry * cx) + 2 * (rw * dz - dw * rz + rx * dy - ry * dx),
  ];
}
const NONE16 = Array.from({ length: 16 }, () => [0, 0, 0, 0]);
const NONE6 = NONE16.slice(0, 6);
const castUniforms = (c: CastLook | null) => ({
  actor: (c?.cast ?? [0, 0, 0, 0]) as never, actorIris: (c?.iris ?? [0, 0, 0, 0]) as never, actor2: (c?.mouth ?? [0, 0, 0, 0]) as never,
  actor3: (c?.shading ?? [0, 0, 0, 0]) as never, actor4: (c?.age ?? [0, 0, 0, 0]) as never,
  cel: (c?.cel ?? NONE16) as never, celShade: (c?.shade ?? NONE16) as never, mark: (c?.mark ?? NONE6) as never,
  sculpt: (c?.sculpt?.[0] ?? [0, 0, 0, 0]) as never, sculpt2: (c?.sculpt?.[1] ?? [-1, 0, 0, 0]) as never, sculpt3: (c?.sculpt?.[2] ?? [0, 0, 0, 0]) as never,
});

/** the face model's state as hero.wgsl's faceB..faceX */
const faceUniforms = (f: FaceParams) => ({
  faceB: [f.browInL, f.browInR, f.browOutL, f.browOutR] as never, faceE: [f.knit, f.lidUp, f.lidLow, f.happy] as never,
  faceM: [f.open, f.spread, f.round, f.press] as never, faceN: [f.teeth, f.tongue, f.tuck, f.smirk] as never,
  faceX: [f.frown, f.blush, 0, 0] as never,
});

const LAYOUT: GPUVertexBufferLayout = {
  arrayStride: VBYTES, attributes: [
    { shaderLocation: 0, offset: 0, format: 'uint16x4' }, { shaderLocation: 1, offset: 8, format: 'snorm8x4' },
    { shaderLocation: 2, offset: 12, format: 'snorm8x4' }, { shaderLocation: 3, offset: 16, format: 'uint8x4' },
    { shaderLocation: 4, offset: 20, format: 'unorm8x4' },
  ],
};

interface Mesh { vb: StorageBuffer; ib: StorageBuffer; n: number }

export class HeroMesh {
  readonly u: UniformBuffer<any>;
  readonly dq: StorageBuffer;
  private hi: Mesh;
  private lo: Mesh;
  visible = false;
  /** drawn with the lighter twin in the scene pass too (another of the cast, seen from far off) */
  far = false;
  /** extra room round her legs for the skirt (m): sitting, it drapes over her thighs and knees rather than through them */
  legPad = 0;
  /** her head left out of the main view (a view at her eyes), now: decided after the frame's pose went up, so the
   *  uniform's toon field is written again (uploaded with the frame) rather than a frame late */
  setHeadless(on: boolean) {
    if (on === this.headless) return;
    this.headless = on;
    this.u.set({ toon: [this.ink.width, this.ink.keyLean, on ? 1 : 0, 0] as never });
  }
  /** first person: drawn without her head (the camera closer than her head's size to it) */
  headless = false;
  /** drawn as the show draws her (ink and paint: the waterbending game's look), or with physically based shading */
  style: 'drawn' | 'classic' = new URLSearchParams(location.search).has('classic') ? 'classic' : 'drawn';
  /** the ink line's width (px at 1080 lines) and how far the drawn look's key light leans toward the camera */
  ink = { width: 2.4, keyLean: 0.4 };
  /** the post chain's grade (post.ts settings), for the drawn look's display lock */
  grade: { exposure: number; saturation: number; contrast: number; punchy: number; warmth: number; bloom: number } | null = null;
  palette: number[][];
  iris: number[];
  /** a push on loose cloth (the wind, flight), and the jaw's opening for the inside of the mouth */
  sway: [number, number, number] = [0, 0, 0];
  jaw = 0;
  look = { spec: Math.PI, nightFill: 0.25, ground: 0.14 };
  /** another of the cast drawn by this shader (hero.wgsl HeroU actor, actorIris, actor2, actor3, cel, celShade, mark): null for her */
  cast: CastLook | null = null;
  private headI: number;
  /** the skirt's clearance (hero.wgsl clearLegs): the legs' bones [thigh, shin] left then right, and the capsules */
  private legBones: number[];
  private legs = Array.from({ length: 8 }, () => [0, 0, 0, 0]);

  /** one of the cast's mesh and its lighter twin, with their look (null if they're not there): Katara her own colour
   *  model; Aang and Iroh their export's palette, iris and CastLook (Iroh's robe kept clear of his legs) */
  static async load(kit: Kit, who: Who): Promise<HeroMesh | null> {
    const base = who === 'katara' ? 'hero/hero' : `${who}/${who}`;
    try {
      const [hi, lo] = await Promise.all([loadHero(assetUrl(`${base}_hi.bin.gz`)), loadHero(assetUrl(`${base}_lo.bin.gz`)).catch(() => null)]);
      // (the fingers' skin given to their own joints, so they curl round what's held: town/hands.ts)
      for (const x of lo ? [hi, lo] : [hi]) fitHands(x);
      const m = new HeroMesh(kit, hi, lo);
      if (who === 'katara') return m;
      // (the classic look's palette is the export's; the drawn look's colour model his own: aang/look.ts, iroh/look.ts)
      m.palette = (hi.header.pal ?? m.palette).map((c) => [c[0], c[1], c[2], c[3] ?? 0]);
      if (who === 'aang') {
        m.iris = [0.2, 0.2, 0.21];
        m.cast = aangLook(hi);
      } else {
        m.iris = [0.38, 0.22, 0.06];
        m.cast = irohLook();
        // (his legs and his trousers fuller than hers: his skirt kept further off them)
        m.legPad = 0.04;
      }
      return m;
    } catch (e) {
      console.warn(`${who}: not loaded`, e);
      return null;
    }
  }

  constructor(readonly kit: Kit, readonly asset: HeroAsset, lo: HeroAsset | null) {
    const mesh = (a: HeroAsset, label: string): Mesh => ({
      vb: kit.storage({ label: `${label}.vb`, data: a.verts, usage: ['vertex', 'copy-dst'] }),
      ib: kit.storage({ label: `${label}.ib`, data: a.idx, usage: ['index', 'copy-dst'] }),
      n: a.idx.length,
    });
    this.hi = mesh(asset, 'hero');
    // (the twin must share the quantisation box: the shader dequantises with the main mesh's)
    const same = lo && lo.bones.length === asset.bones.length && lo.header.qmin.every((v, i) => Math.abs(v - asset.header.qmin[i]) < 1e-5)
      && lo.header.qmax.every((v, i) => Math.abs(v - asset.header.qmax[i]) < 1e-5);
    this.lo = same ? mesh(lo!, 'hero.lo') : this.hi;
    this.dq = kit.storage({ label: 'hero.bones', size: MAX_BONES * 32 });
    this.u = kit.uniforms(heroShader.structs.HeroU, 'hero');
    // the export's outfit colours, then the art direction the game settled on: a deep muted indigo tunic, calmer
    // pale-blue trims, a warm golden-brown skin, rose-brown lips, near-black brown hair, sky-blue beads
    const P = WATER_TRIBE.map((c) => [...c]);
    asset.header.pal?.forEach((v, i) => { if (i < 16 && v) P[i] = [v[0], v[1], v[2], v[3] ?? P[i][3]]; });
    P[0] = [0.22, 0.118, 0.062, P[0][3]];
    P[3] = [0.022, 0.012, 0.008, P[3][3]];
    P[11] = [0.125, 0.044, 0.035, 0];
    if (asset.header.pal?.[12] && asset.header.pal[12][2] > asset.header.pal[12][0] * 1.5) P[12] = [0.3, 0.56, 0.86, P[12][3]];
    if (P[1][2] > P[1][0] * 4) P[1] = [0.022, 0.036, 0.09, P[1][3]];
    if (P[5][2] > P[5][0] * 1.6) P[5] = [0.44, 0.58, 0.7, P[5][3]];
    this.palette = P;
    this.iris = asset.header.iris?.slice(0, 3) ?? IRIS;
    this.headI = asset.index.head;
    this.legBones = ['thighL', 'shinL', 'thighR', 'shinR'].map((n) => asset.index[n]);
  }

  /** her legs as tapered capsules, world space (hip -> knee, knee -> ankle), from the bones' skin transforms: thick
   *  enough to hold the leggings as a leg bends, thinner than where the skirt hangs round them standing */
  private legCapsules(dq: Float32Array) {
    const s = this.asset.header.height / 1.66;
    const R = [[0.092, 0.078], [0.078, 0.052]];
    this.legBones.forEach((bi, k) => {
      const b = this.asset.bones[bi];
      const a = dqPoint(dq, bi, b.head), t = dqPoint(dq, bi, b.tail), r = R[k % 2];
      this.legs[k * 2] = [a[0], a[1], a[2], r[0] * s + this.legPad];
      this.legs[k * 2 + 1] = [t[0], t[1], t[2], r[1] * s + this.legPad];
    });
  }

  /** in the scene pass (after the opaque world: opaque too, sheer cloth through alpha-to-coverage): drawn (the fills,
   *  then the ink line round them) or classic; the lighter twin instead while `far` */
  draw(pass: RenderPass) {
    for (const [m, far] of [[this.hi, false], [this.lo, true]] as const) {
      if (far && m === this.hi) continue;
      const on = () => this.visible && (this.far === far || this.lo === this.hi);
      const tag = far ? '.lo' : '';
      const common = {
        vertexBuffers: [{ layout: LAYOUT, buffer: m.vb }], indices: { buffer: m.ib, format: 'uint32' as GPUIndexFormat }, count: m.n,
        bind: { DQ: this.dq, HU: this.u } as never,
      };
      pass.draw(heroShader, { ...common, label: `${pass.label}.hero${tag}`, vertex: 'vs', fragment: 'fs', cull: 'none', alphaToCoverage: true, enabled: () => on() && this.style === 'classic' });
      pass.draw(heroShader, { ...common, label: `${pass.label}.hero.drawn${tag}`, vertex: 'vs', fragment: 'fsCel', cull: 'none', alphaToCoverage: true, enabled: () => on() && this.style === 'drawn' });
      pass.draw(heroShader, { ...common, label: `${pass.label}.hero.ink${tag}`, vertex: 'vsOutline', fragment: 'fsOutline', cull: 'front', enabled: () => on() && this.style === 'drawn' });
    }
  }

  /** her shadow: the two nearest cascades (she's always close to the camera) */
  drawShadow(pass: RenderPass, cascade: number) {
    if (cascade > 1) return;
    const m = this.lo;
    pass.draw(heroShader, {
      label: `${pass.label}.hero`, vertex: 'vsShadow', fragment: null, cull: 'none', count: m.n,
      vertexBuffers: [{ layout: LAYOUT, buffer: m.vb }], indices: { buffer: m.ib, format: 'uint32' },
      bind: { DQ: this.dq, HU: this.u } as never, enabled: () => this.visible,
    });
  }

  private legacyFace: FaceParams | null = null;
  /** this frame's pose and look (the rig; its face: the face model's state, or the older face's keys alone) */
  update(rig: { dq: Float32Array; nBones: number; faceState: Pick<HeroRig['faceState'], 'gaze' | 'blink' | 'face'> & { s?: FaceState } }) {
    if (!this.visible) return;
    this.dq.write(rig.dq.subarray(0, rig.nBones * 8));
    const h = this.asset.header, fs = rig.faceState, g = this.grade;
    // (her skirt, or another's who wears one: the rest of the cast drawn by this shader wear none)
    if (this.cast && !this.cast.legs) this.legs[0][3] = 0;
    else this.legCapsules(rig.dq);
    this.u.set({
      pal: this.palette.map((c) => [c[0], c[1], c[2], c[3]]) as never,
      qmin: [h.qmin[0], h.qmin[1], h.qmin[2], h.face.nose_tip?.[0] ?? h.eye.y - 0.03],
      qmax: [h.qmax[0], h.qmax[1], h.qmax[2], 1],
      eye: [h.eye.x, h.eye.y, h.eye.z, h.eye.r],
      face: [h.face.brow_y, h.face.mouth_y, h.face.lip_w, h.face.nose_tip?.[1] ?? 0.1],
      iris: [this.iris[0], this.iris[1], this.iris[2], 0.15],
      sway: [this.sway[0], this.sway[1], this.sway[2], this.jaw],
      params: [this.look.spec, this.look.nightFill, this.look.ground, 0],
      headR: Array.from(rig.dq.subarray(this.headI * 8, this.headI * 8 + 4)) as never,
      headD: Array.from(rig.dq.subarray(this.headI * 8 + 4, this.headI * 8 + 8)) as never,
      face2: [fs.blink, fs.face.smile, fs.face.browDown, fs.face.wide],
      face3: [fs.gaze[0], fs.gaze[1], fs.face.jaw, fs.face.squint],
      ...faceUniforms(fs.s ?? (this.legacyFace = fromLegacy(fs.face, this.legacyFace ?? undefined))),
      hair: (h.hairAxis?.length === 4 ? h.hairAxis : [0, 0, 0, 0]) as never,
      toon: [this.ink.width, this.ink.keyLean, this.headless ? 1 : 0, 0],
      post: g ? [g.exposure, g.saturation, g.contrast, g.punchy] : [0, 1, 1, 0],
      post2: g ? [g.warmth, g.bloom, 0, 0] : [0, 0, 0, 0],
      ...castUniforms(this.cast),
      legs: this.legs as never,
    });
  }
}
