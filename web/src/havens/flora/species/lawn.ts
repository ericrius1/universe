// The garden lawn, as tiles of dense fine blades planted on a jittered grid over a lawn bed (the haven's LAWN surface
// carries the lawn's colour beyond where they're drawn). Each blade swings about its own root on its own beat; the
// light levels keep a third and then a tenth of the blades, each wider, so the tile's coverage holds as it thins.
import { FloraMesh, PART, clamp, lerp3, rng, vary, type V3 } from '../mesh';
import { C } from '../palette';
import type { Lod } from './forms';
import type { SpeciesDef } from './def';

/** the tile's radius (m): tiles planted LAWN_STEP apart overlap a little, so no seams show */
export const LAWN_RADIUS = 0.36;
export const LAWN_STEP = 0.5;

function lawnTile(seed: number, lod: Lod): FloraMesh {
  const r = rng(seed);
  const m = new FloraMesh();
  const blades = 150;
  // (the light levels: every third blade, then every tenth, wider; the same blades where they stand)
  const every = lod === 0 ? 1 : lod === 1 ? 3 : 10;
  const segs = lod === 0 ? 2 : 1;
  const wide = lod === 0 ? 1 : lod === 1 ? 2.2 : 4.5;
  for (let k = 0; k < blades; k++) {
    const a = r.next() * Math.PI * 2, rr = LAWN_RADIUS * Math.sqrt(r.next());
    const base: V3 = [Math.cos(a) * rr, -0.01, Math.sin(a) * rr];
    const lean = r.range(0.04, 0.4), la = r.next() * Math.PI * 2;
    const dir: V3 = [Math.cos(la) * Math.sin(lean), Math.cos(lean), Math.sin(la) * Math.sin(lean)];
    const h = r.range(0.06, 0.11), w = r.range(0.009, 0.013), droop = r.range(0.15, 0.7), ph = r.next(), tone = r.next();
    // (a few paler, drier blades through the green, and darker ones low in it)
    const tip = tone < 0.1 ? C.lawnDry : vary(lerp3(C.lawnMid, C.lawnTip, clamp(tone * 1.3, 0, 1)), r, 0.08, 0.02);
    m.skip = k % every !== 0;
    m.on(base, ph, () => m.blade(base, dir, h, w * wide, droop, segs, PART.blade, vary(C.lawnRoot, r, 0.1, 0.01), tip, { flex0: 0, flex1: 1, flutter: 0.4, ao0: 0.45, ao1: 1, rand: r.next() }));
  }
  m.skip = false;
  return m;
}

export const lawn: SpeciesDef = {
  name: 'lawn', about: 'a tile of garden lawn: dense fine blades, deep at the root to bright tips',
  variants: 3, grow: (s, lod) => lawnTile(s, lod),
  lod: [10, 26, 48], size: [0.08, 0.13],
  wind: [0.3, 1.2, 0.5, 4], look: [0.6, 0.5, 0.8, 0.15], yields: 1, burn: [1, 0.6, 0.85, 90], shadows: false,
};
