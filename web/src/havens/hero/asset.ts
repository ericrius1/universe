// The heroine's mesh, as the waterbending game ships it: a DNC1 file from its Blender pipeline — a quantised skinned
// vertex stream (24 bytes: position u16x3 + material u16, normal s8x4 with baked AO in w, strand flow s8x4 (or the
// lip mask, thickness, curvature), bones u8x4, weights u8x4) and the bind skeleton (head / tail / up per bone in bind
// space: A-pose, facing +z, +x = her left, feet at y = 0).
import type { V3 } from './math';
import { fitGarments } from './garment';

export interface BoneDef { name: string; head: V3; tail: V3; up: V3 }
export interface HeroHeader {
  char: string; version: number; height: number; scale: number;
  bones: { name: string; head: number[]; tail: number[]; up: number[] }[];
  chains: Record<string, number[][]>;
  chainParents?: Record<string, string>;
  eye: { x: number; y: number; z: number; r: number };
  face: { brow_y: number; mouth_y: number; lip_w: number; nose_tip: [number, number]; chin: [number, number] };
  verts: number; indices: number; qmin: number[]; qmax: number[]; stride: number;
  /** per palette slot rgb + silk (the export's outfit colours) */
  pal?: number[][];
  iris?: number[];
  /** the hair's lock lines' axis: the pole in front of the forehead and the gather at the nape, each (y, z) in bind
   *  space */
  hairAxis?: number[];
}
export interface HeroAsset {
  header: HeroHeader;
  bones: BoneDef[];
  index: Record<string, number>;
  chains: Record<string, V3[]>;
  verts: Uint8Array<ArrayBuffer>;
  idx: Uint32Array<ArrayBuffer>;
}

export const VBYTES = 24;
export const MAX_BONES = 160;
export const CORE = ['root', 'pelvis', 'spine', 'chest', 'neck', 'head', 'clavL', 'uarmL', 'farmL', 'handL', 'clavR', 'uarmR', 'farmR', 'handR',
  'thighL', 'shinL', 'footL', 'toeL', 'thighR', 'shinR', 'footR', 'toeR'] as const;

async function gunzipIfNeeded(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const b0 = new Uint8Array(buf, 0, 2);
  if (b0[0] === 0x1f && b0[1] === 0x8b) return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return buf;
}

export async function loadHero(url: string): Promise<HeroAsset> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const buf = await gunzipIfNeeded(await r.arrayBuffer());
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'DNC1') throw new Error(`${url}: not a DNC1 character file`);
  const hl = dv.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, hl))) as HeroHeader;
  if (header.stride !== VBYTES) throw new Error(`${url}: stride ${header.stride}`);
  const vOff = 12 + hl, vBytes = header.verts * header.stride;
  const verts = new Uint8Array(buf.slice(vOff, vOff + vBytes));
  const idx = new Uint32Array(buf.slice(vOff + vBytes, vOff + vBytes + header.indices * 4));
  const bones: BoneDef[] = header.bones.map((b) => ({ name: b.name, head: b.head as V3, tail: b.tail as V3, up: b.up as V3 }));
  const index: Record<string, number> = {};
  bones.forEach((b, i) => { index[b.name] = i; });
  for (const n of CORE) if (index[n] === undefined) throw new Error(`${url}: missing bone ${n}`);
  const chains: Record<string, V3[]> = {};
  for (const [k, v] of Object.entries(header.chains ?? {})) chains[k] = v.map((p) => [p[0], p[1], p[2]] as V3);
  const a: HeroAsset = { header, bones, index, chains, verts, idx };
  // (the clothes under the hips hung from the hips' hanging frame: garment.ts)
  fitGarments(a);
  if (bones.length > MAX_BONES) throw new Error(`${url}: ${bones.length} bones > ${MAX_BONES}`);
  return a;
}
