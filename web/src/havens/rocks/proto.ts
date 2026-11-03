// What a generator hands over: one rock (or crystal cluster) as a prototype the field instances many times — its meshes
// at its levels of detail (four for the standing formations, three for blocks, arches and crystals), its size, and in its own metres the cylinders a walker bumps into and the tops she can
// stand on. Kinds name the families place.ts places and the shaders tell apart.
import type { RockMesh } from './mesh';

export type Kind = 'hoodoo' | 'mushroom' | 'table' | 'spire' | 'boulder' | 'slab' | 'ledge' | 'arch' | 'crystal';

/** a solid upright cylinder: centre (x, z), from y0 to y1, radius r (what a walker is pushed out of) */
export interface Post { x: number; z: number; y0: number; y1: number; r: number }

/** a flat top to stand on: centre (x, z), radius r, at height y */
export interface Top { x: number; z: number; r: number; y: number }

/** a crystal of a cluster (for the shader's thickness and glow): its foot, unit axis, radius, length, a seed 0..1 */
export interface Crystal { base: [number, number, number]; axis: [number, number, number]; r: number; len: number; seed: number }

export interface Proto {
  kind: Kind;
  name: string;
  seed: number;
  /** its levels of detail, near to far */
  lods: RockMesh[];
  /** its height above the ground line and its reach from the axis (m, before an instance's scale) */
  height: number;
  radius: number;
  posts: Post[];
  tops: Top[];
  /** a crystal cluster's crystals (the bed coordinate of its vertices indexes these) */
  crystals?: Crystal[];
  /** an arch's opening at the ground (m) */
  span?: number;
}

/** the cylinders down a stack of beds: consecutive beds of about the same radius merged into one post, a little inside
 *  the stone (the outline's hollows) so a walker stops at the rock, not short of it */
export function postsOf(spans: { y0: number; y1: number; r: number }[]): Post[] {
  const out: Post[] = [];
  let cur: { y0: number; y1: number; r: number } | null = null;
  for (const s of spans) {
    if (s.y1 <= 0) continue;
    const y0 = Math.max(0, s.y0);
    if (cur && Math.abs(s.r - cur.r) < cur.r * 0.22) { cur.y1 = s.y1; cur.r = Math.min(cur.r, s.r); continue; }
    if (cur) out.push({ x: 0, z: 0, y0: cur.y0, y1: cur.y1, r: cur.r * 0.86 });
    cur = { y0, y1: s.y1, r: s.r };
  }
  if (cur) out.push({ x: 0, z: 0, y0: cur.y0, y1: cur.y1, r: cur.r * 0.86 });
  return out;
}
