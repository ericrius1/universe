// Where water can be bent from: anything that can say where its surface is, the nearest point of it to her, which
// way it runs, and take a disturbance (ripples where water is drawn out or lands back). The world's water — the
// Haven's pools and channels and falls, the canyon's river — adds a source each to the one list (the water's builders
// do, against WaterSource); poolSource makes a round pool (the stand-in's test pool, dev/pool.ts).
import { type V3, sub, len } from '../math';

export type SourceKind = 'pool' | 'stream' | 'falls' | 'lake' | 'creek';

export interface WaterSource {
  readonly id: string;
  readonly kind: SourceKind;
  /** the surface's height over (x, z) if it's on this water, else null */
  levelAt(x: number, z: number): number | null;
  /** the nearest point of the water (its surface, or a falling sheet) to p */
  nearest(p: V3): V3 | null;
  /** which way and how fast the water runs at a point of it (m/s) */
  flowAt?(p: V3): V3;
  /** can water be drawn from it now (not frozen, the pump on) */
  available(): boolean;
  /** ripples: water drawn out (amount < 0) or landing (> 0) at a point, over a radius */
  disturb?(p: V3, amount: number, r: number): void;
  /** its extent [x0, z0, x1, z1] (a quick no for points far from it) */
  bounds?: number[];
}

export class WaterSources {
  readonly list: WaterSource[] = [];
  add(s: WaterSource) { this.list.push(s); return s; }
  /** the highest surface over (x, z), or null */
  levelAt(x: number, z: number): number | null {
    let best: number | null = null;
    for (const s of this.list) {
      const b = s.bounds;
      if (b && (x < b[0] || x > b[2] || z < b[1] || z > b[3])) continue;
      const l = s.levelAt(x, z);
      if (l !== null && (best === null || l > best)) best = l;
    }
    return best;
  }
  /** the nearest drawable water within `maxR` of p (a falls a little preferred: it's where the bending shows best) */
  nearest(p: V3, maxR: number): { source: WaterSource; point: V3; dist: number } | null {
    let best: { source: WaterSource; point: V3; dist: number } | null = null;
    for (const s of this.list) {
      // (a source whose box is already farther than maxR can't have a nearer point)
      const b = s.bounds;
      if (b && Math.hypot(Math.max(b[0] - p[0], 0, p[0] - b[2]), Math.max(b[1] - p[2], 0, p[2] - b[3])) > maxR / (s.kind === 'falls' ? 0.8 : 1)) continue;
      if (!s.available()) continue;
      const q = s.nearest(p);
      if (!q) continue;
      const d = len(sub(q, p)) * (s.kind === 'falls' ? 0.8 : 1);
      if (d <= maxR && (!best || d < best.dist)) best = { source: s, point: q, dist: d };
    }
    return best;
  }
  disturb(p: V3, amount: number, r: number) {
    for (const s of this.list) if (s.disturb && s.levelAt(p[0], p[2]) !== null) s.disturb(p, amount, r);
  }
}

/** a round pool: its surface at `level` over the disc of radius r round (cx, cz) */
export function poolSource(id: string, cx: number, cz: number, r: number, level: number, disturb?: WaterSource['disturb']): WaterSource {
  return {
    id, kind: 'pool', bounds: [cx - r, cz - r, cx + r, cz + r], disturb,
    levelAt: (x, z) => (Math.hypot(x - cx, z - cz) <= r ? level : null),
    nearest: (p) => {
      const dx = p[0] - cx, dz = p[2] - cz, d = Math.hypot(dx, dz), k = d > r * 0.92 ? (r * 0.92) / d : 1;
      return [cx + dx * k, level, cz + dz * k];
    },
    available: () => true,
  };
}
