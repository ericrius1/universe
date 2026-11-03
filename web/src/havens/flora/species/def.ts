// What a species is to the flora: how to grow each of its variants at each level of detail, how far each level is
// drawn, the sizes it's planted at, and how it answers the wind, the light, a walker brushing through it and fire. The
// catalogue (index.ts) grows them all; the scatter plants them; flora.wgsl reads the numbers from the species table.
import type { FloraMesh } from '../mesh';
import type { Lod } from './forms';

export interface SpeciesDef {
  name: string;
  /** what it is (for the reader and the contact sheet) */
  about: string;
  /** seeded variants, each grown at every level of detail */
  variants: number;
  grow: (seed: number, lod: Lod, variant: number) => FloraMesh;
  /** the farthest each level is drawn (m from the camera): LOD0, LOD1 and LOD2, the last its draw distance */
  lod: [number, number, number];
  /** the heights (m) its instances are planted at: the scatter scales the mesh's own height into this range (or, when
   *  `scaled`, the range of scales on the mesh itself) */
  size: [number, number];
  /** its size is a scale on the mesh, not a height (a lotus clump's pads float whatever its flowers' height) */
  scaled?: boolean;
  /** the wind: whole-plant bend (m at the top per m/s of wind, per m of height), branch swing, leaf flutter (m), the
   *  flutter's frequency (Hz) */
  wind: [number, number, number, number];
  /** the light: translucency (sun through the leaves toward the eye), wrap (soft terminator), occlusion strength,
   *  gloss (0 matte .. 1 waxy or glazed) */
  look: [number, number, number, number];
  /** how far it gives way to someone walking through it (0 a trunk .. 1 grass) */
  yields: number;
  /** fire: how readily it burns (0 a pot .. 1 tinder), how far its leaves curl, how much it shrinks, the seconds it
   *  takes to grow back */
  burn: [number, number, number, number];
  /** drawn into the sun's shadow cascades */
  shadows: boolean;
  /** hangs down from its origin (over a wall's top edge) rather than standing on it */
  hangs?: boolean;
  /** the bloom colours (sRGB hex) its instances take when no bed family says otherwise */
  blooms?: string[];
}
