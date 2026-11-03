// Aang drawn as the show draws him, by Katara's shader (hero/hero.wgsl, its ink and paint): his colour model per palette
// slot (the lit fill and its shade, display sRGB, taken off the show's own model sheet: a warm peach skin, the
// yellow-orange tunic and trousers, the red-orange cape, sash and cuffs, brown boots; the tea things), kept, like her
// whites, a hair under where the bloom would halo them; his face as the show draws it (big dark-brown eyes under a strong
// upper lid, full arched brows, a wide gentle smile that opens into a grin), his head rounder than the build's egg (the
// jaw tapered to a chin, the ears larger and standing out: hero.wgsl sculptPt); and his arrows, placed from his own
// skeleton and face landmarks.
import type { CastLook } from '../hero/hero';
import type { HeroAsset } from '../hero/asset';
import { type V3, sub, norm, cross, scale } from '../hero/math';

// fill, shade multiplier (per slot): 0 skin, 1 tunic, 2 trousers, 4 boots, 5 cuffs, 6 ears (skin), 7 sash, 8 tray,
// 9 tea, 12 the cup and the teapot, 13 cape, 14 cushion
const SKIN: [V3, V3] = [[0.9, 0.7, 0.54], [0.77, 0.73, 0.7]];
const SAFFRON: [V3, V3] = [[0.88, 0.65, 0.36], [0.68, 0.67, 0.75]];
const RED: [V3, V3] = [[0.73, 0.31, 0.22], [0.66, 0.74, 0.78]];
const MODEL: Record<number, [V3, V3]> = {
  0: SKIN, 1: SAFFRON, 2: [[0.87, 0.64, 0.35], SAFFRON[1]], 4: [[0.46, 0.3, 0.2], [0.66, 0.66, 0.76]], 5: RED, 6: SKIN,
  7: [[0.7, 0.29, 0.2], RED[1]], 8: [[0.55, 0.36, 0.22], [0.7, 0.66, 0.74]], 9: [[0.6, 0.39, 0.14], [0.72, 0.68, 0.74]],
  12: [[0.72, 0.84, 0.76], [0.72, 0.76, 0.86]], 13: RED, 14: [[0.6, 0.24, 0.2], [0.7, 0.68, 0.78]],
};

export function aangLook(a: HeroAsset): CastLook {
  const cel: number[][] = [], shade: number[][] = [];
  for (let i = 0; i < 16; i++) {
    const m = MODEL[i];
    cel.push(m ? [...m[0], 1] : [0, 0, 0, 0]);
    shade.push(m ? [...m[1], 1] : [0, 0, 0, 0]);
  }
  const h = a.header, E = h.eye, b = (n: string) => a.bones[a.index[n]];
  // the head's arrow: its tip just above the eyes between the brows, its band about a fifth of the head's width
  const tip = E.y + E.r * 1.55;
  const head = [E.x * 0.42, tip, E.x * 1.0, E.x * 0.86];
  // the left arm's: along the back of the forearm and hand (the right's mirrored): elbow, wrist, the middle knuckle;
  // the back of the hand's way, opposite the palm (the bind pose's palms face the thighs)
  const el = b('farmL').head, wr = b('farmL').tail, kn = a.index.middle1L !== undefined ? b('middle1L').head : b('handL').tail;
  const d = norm(sub(b('handL').tail, b('handL').head));
  const thumb = norm(sub([0, 0, 1], scale(d, d[2])));
  const back = scale(norm(cross(d, thumb)), -1);
  const s = h.height / 1.66;
  const mark = [head, [...el, 0.0085 * s], [...wr, 0.019 * s], [...kn, 0], [...back, 0], [-0.006 * s, b('neck').head[1] + 0.02 * s, 0, 0]];
  // (his baggy cloth posed far from the bind pose its occlusion was baked in: little of it; a little more of him lit;
  // his figure lit or shaded as one)
  // (his ears, palette slot 6: where they meet his head, from the mesh)
  const dv = new DataView(a.verts.buffer, a.verts.byteOffset);
  let n = 0, ey = 0, ez = 0, ex = 1;
  for (let i = 0; i < h.verts; i++) {
    const o = i * 24;
    if ((dv.getUint16(o + 6, true) & 0xff) !== 6) continue;
    const y = h.qmin[1] + (dv.getUint16(o + 2, true) / 65535) * (h.qmax[1] - h.qmin[1]);
    if (y < E.y - 0.15) continue;
    const x = Math.abs(h.qmin[0] + (dv.getUint16(o, true) / 65535) * (h.qmax[0] - h.qmin[0]));
    n++; ey += y; ez += h.qmin[2] + (dv.getUint16(o + 4, true) / 65535) * (h.qmax[2] - h.qmin[2]); ex = Math.min(ex, x);
  }
  const ear = n ? [ex, ey / n, ez / n, 0] : [0, 0, 0, 0];
  const sculpt = [[0.05, 0.26, 0.008 * s, 0.06], [n ? 6 : -1, 0.14, 0.005 * s, 0.004 * s], ear];
  return { cast: [0.2, 0.42, 0, 1], iris: [0.35, 0.26, 0.21, 1], mouth: [1.85, 1.1, 1, 1], shading: [0.3, 0.08, 1, 1], cel, shade, mark, sculpt };
}
