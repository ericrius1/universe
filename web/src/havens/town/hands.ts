// The cast's hands, skinned to grip (boulder's town/hands.ts, its fiddle's fix left there). The meshes weight each
// finger's skin mostly to the hand bone — its own joints carry a tenth (the first) to a third (the last) — so the rig's
// fingers curl and the skin hardly follows: an open hand round a cup, a glider's grip. When a body loads, each vertex
// of a hand (those wholly on that hand's own bones: the wrist's blend into the forearm is left as it is) is given to
// the bone it lies along in the bind pose — the palm to the hand (the lines from the wrist to each knuckle), a
// finger's skin to its joint — and blended half and half across each knuckle and joint. Both levels of detail.
import type { HeroAsset } from '../hero/asset';
import type { V3 } from '../hero/math';

const FINGERS = ['index', 'middle', 'ring', 'pinky'];

interface Seg { b: number; up: number; down: number; h: V3; t: V3; hand: boolean }

/** each hand's skin given to the bones it lies along; returns how many vertices changed (no allocation per vertex:
 *  it runs as each body loads) */
export function fitHands(a: HeroAsset): number {
  const H = a.header, lo = H.qmin, span = [H.qmax[0] - lo[0], H.qmax[1] - lo[1], H.qmax[2] - lo[2]];
  const dv = new DataView(a.verts.buffer, a.verts.byteOffset, a.verts.byteLength);
  const V = a.verts;
  let moved = 0;
  for (const T of ['L', 'R']) {
    const hand = a.index['hand' + T];
    if (hand === undefined || a.index['index1' + T] === undefined) continue;
    const own = new Uint8Array(256);
    own[hand] = 1;
    const segs: Seg[] = [];
    const wrist = a.bones[hand].head;
    // (the palm: lines from the wrist to each finger's first knuckle, and to the thumb's base)
    for (const f of [...FINGERS, 'thumb']) {
      const i = a.index[f + '1' + T];
      if (i !== undefined) segs.push({ b: hand, up: -1, down: -1, h: wrist, t: a.bones[i].head, hand: true });
    }
    for (const f of ['thumb', ...FINGERS]) {
      for (let j = 1; j <= 3; j++) {
        const i = a.index[f + j + T];
        if (i === undefined) continue;
        own[i] = 1;
        const up = j === 1 ? hand : a.index[f + (j - 1) + T] ?? hand;
        const down = a.index[f + (j + 1) + T] ?? -1;
        segs.push({ b: i, up, down, h: a.bones[i].head, t: a.bones[i].tail, hand: false });
      }
    }
    // (each segment's start, direction and its length squared, flat)
    const G = new Float64Array(segs.length * 7);
    segs.forEach((s, k) => {
      const d0 = s.t[0] - s.h[0], d1 = s.t[1] - s.h[1], d2 = s.t[2] - s.h[2];
      G.set([s.h[0], s.h[1], s.h[2], d0, d1, d2, d0 * d0 + d1 * d1 + d2 * d2 || 1e-9], k * 7);
    });
    for (let v = 0, o = 0; v < H.verts; v++, o += 24) {
      let all = 0, mine = 0;
      for (let k = 0; k < 4; k++) { const w = V[o + 20 + k]; all += w; if (w && own[V[o + 16 + k]]) mine += w; }
      if (all === 0 || mine < all * 0.98) continue;
      const p0 = lo[0] + (dv.getUint16(o, true) / 65535) * span[0];
      const p1 = lo[1] + (dv.getUint16(o + 2, true) / 65535) * span[1];
      const p2 = lo[2] + (dv.getUint16(o + 4, true) / 65535) * span[2];
      // (the nearest segment; the hand's on a tie, so a knuckle's own skin stays with the palm)
      let best = -1, bt = 0, bd = Infinity;
      for (let k = 0, g = 0; k < segs.length; k++, g += 7) {
        const u = Math.max(0, Math.min(1, ((p0 - G[g]) * G[g + 3] + (p1 - G[g + 1]) * G[g + 4] + (p2 - G[g + 2]) * G[g + 5]) / G[g + 6]));
        const q0 = G[g] + G[g + 3] * u - p0, q1 = G[g + 1] + G[g + 4] * u - p1, q2 = G[g + 2] + G[g + 5] * u - p2;
        const dd = q0 * q0 + q1 * q1 + q2 * q2;
        if (dd < bd - (segs[k].hand ? -1e-10 : 1e-10)) { bd = dd; best = k; bt = u; }
      }
      if (best < 0) continue;
      const S = segs[best];
      // (half and half across a joint: the first fifth of a bone with the one before, the last fifth with the next)
      let b2 = S.b, w2 = 0;
      if (!S.hand) {
        if (bt < 0.2 && S.up >= 0) { b2 = S.up; w2 = 0.5 * (0.2 - bt) / 0.2; }
        else if (bt > 0.8 && S.down >= 0) { b2 = S.down; w2 = 0.5 * (bt - 0.8) / 0.2; }
      }
      const w1 = Math.round((1 - w2) * 255);
      V[o + 16] = S.b; V[o + 17] = b2; V[o + 18] = S.b; V[o + 19] = S.b;
      V[o + 20] = w1; V[o + 21] = 255 - w1; V[o + 22] = 0; V[o + 23] = 0;
      moved++;
    }
  }
  return moved;
}
