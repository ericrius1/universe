// The water the builders' parts hold (ArchPart.water: the Haven's pools, channels and cascades, the city's fountains
// and pools) drawn as one mesh: each pool's outline and each channel's strip a sheet at its level, each cascade a sheet
// falling from its lip to its foot. water.wgsl shades them: clear over the shallows and teal over the deep, the sky
// mirrored at a glance and the sun's glint on a breeze's ripple, a cascade's streaks falling; over the floors and walls
// they let show through (premultiplied, after the opaque world).
import type { Kit, RenderPass, StorageBuffer } from '@ericrius1/weft';
import shader from './water.wgsl';
import type { WaterBody } from '../arch/types';
import type { V2 } from '../world/layout';
import { triangulate } from '../arch/builder';

export class Water {
  private verts: StorageBuffer;
  /** the mesh's vertices (three a triangle) */
  readonly count: number;

  constructor(kit: Kit, bodies: WaterBody[]) {
    const v = waterMesh(bodies);
    this.count = v.length / 4;
    this.verts = kit.storage({ label: 'water.verts', data: this.count ? v : new Float32Array(4), usage: ['storage'] });
  }

  /** into the scene pass, after the opaque world */
  draw(pass: RenderPass) {
    pass.draw(shader, { label: 'water', count: this.count, cull: 'none', blend: 'premultiplied', depthWrite: false, enabled: () => this.count > 0, bind: { verts: this.verts } as never });
  }
}

/** every body as triangles, four floats a vertex: its position, and a sheet's depth of water under it (m) or, on a
 *  cascade's sheet, -1 less how far down it the vertex is (0 its lip .. 1 its foot) */
export function waterMesh(bodies: WaterBody[]): Float32Array {
  const out: number[] = [];
  const quad = (p: number[][]) => { for (const k of [0, 1, 2, 0, 2, 3]) out.push(...p[k]); };
  for (const w of bodies) {
    if (w.kind === 'pool') {
      const t = triangulate(w.poly);
      for (const k of t) out.push(w.poly[k][0], w.level, w.poly[k][1], w.depth);
    } else if (w.kind === 'channel') {
      const h = w.width / 2;
      for (let i = 1; i < w.path.length; i++) {
        const a: V2 = w.path[i - 1], b: V2 = w.path[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 1e-3) continue;
        const nx = (-(b[1] - a[1]) / L) * h, nz = ((b[0] - a[0]) / L) * h;
        quad([[a[0] + nx, w.level, a[1] + nz, w.depth], [b[0] + nx, w.level, b[1] + nz, w.depth], [b[0] - nx, w.level, b[1] - nz, w.depth], [a[0] - nx, w.level, a[1] - nz, w.depth]]);
      }
    } else {
      quad([[w.a[0], w.top, w.a[1], -1], [w.b[0], w.top, w.b[1], -1], [w.b[0], w.bottom, w.b[1], -2], [w.a[0], w.bottom, w.a[1], -2]]);
    }
  }
  return new Float32Array(out);
}
