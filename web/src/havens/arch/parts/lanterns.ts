// Lanterns, each with its light (Laid.lights: in the world, at its body's middle) and its glow at night:
//   'cage'     a pierced-brass lantern (the town's Moroccan kind): a six-sided body of warm glass between gold bands,
//              gold posts at its corners, a pointed gold roof with a ball and a ring over it, a gold bowl and a drop
//              under it — centred on the origin
//   'paper'    a paper lantern: a lit drum of cloth (striped as the awnings are) swelling at its middle, wooden rims and
//              a red tassel — centred on the origin
//   'hanging'  a cage on a chain from a hook at the origin, `drop` below it
//   'wall'     a cage on a curled iron bracket out of a wall: the bracket's root on the wall's face at the origin (x along
//              the wall, z out), the lantern hung from its arm's end
//   'post'     a cage on an iron post on a stone foot, standing at the origin (a street's, a stair's, a terrace's)
// Near: every band and post, the roofs and bowls turned smooth and fluted; mid the body, its bands and roof in fewer
// sides; far a lit box under a pyramid (about 16 triangles). The small one that repeats by the thousand: instanced.
import type { ArchBuilder } from '../builder';
import { MAT, type V3 } from '../types';
import { annulus, begin, byDetail, CLOTHS, facets, GLASS, lightAt, proud, revolve, type Detail, type Laid, type PartOpts } from './kit';

export type LanternKind = 'cage' | 'paper' | 'hanging' | 'wall' | 'post';

export interface LanternOpts extends PartOpts {
  kind?: LanternKind;
  /** the body's height (m; 0.36 a cage's, 0.42 a paper one's) */
  s?: number;
  /** the glass's or the paper's tint (by the seed if not given) */
  tint?: V3;
  /** how lit at night (1) and its light (candela; 0: none, as in a string where one in a few carries one) */
  lit?: number;
  candela?: number;
  /** a hanging one's chain (0.5), a post's height to the body's foot (2.2) */
  drop?: number;
  post?: number;
}

const IRON: V3 = [0.3, 0.27, 0.26];
/** how far a cage's roof, its ball and its ring stand over its body (in its body's heights) */
const ABOVE = 1.11;

/** a lantern (see the header) */
export function lantern(b: ArchBuilder, o: LanternOpts = {}): Laid {
  return b.owner('lantern', () => {
    const { d, rng } = begin(o);
    const kind = o.kind ?? 'cage', lit = o.lit ?? 1;
    const s = o.s ?? (kind === 'paper' ? 0.42 : 0.36);
    const tint = o.tint ?? (kind === 'paper' ? rng.pick(CLOTHS.slice(0, 4)) : rng.pick(GLASS));
    const cd = o.candela ?? (kind === 'post' ? 70 : kind === 'paper' ? 35 : 55);
    let mid: V3 = [0, 0, 0];
    if (kind === 'paper') paper(b, s, tint, lit, d);
    else if (kind === 'cage') cage(b, s, tint, lit, d, false);
    else if (kind === 'hanging') {
      const drop = o.drop ?? 0.5;
      chain(b, 0, 0, 0, drop, d);
      mid = [0, -drop - ABOVE * s - s / 2, 0];
      b.group(() => { b.at(mid[0], mid[1], mid[2]); cage(b, s, tint, lit, d, false); });
    } else if (kind === 'wall') {
      const arm = 0.52;
      bracketArm(b, arm, d);
      mid = [0, -0.07 - ABOVE * s - s / 2, arm - 0.08];
      chain(b, 0, -0.02, arm - 0.08, 0.05, d);
      b.group(() => { b.at(mid[0], mid[1], mid[2]); cage(b, s, tint, lit, d, false); });
    } else {
      const h = o.post ?? 2.2;
      lampPost(b, h, d);
      mid = [0, h + s * 0.08 + s / 2, 0];
      b.group(() => { b.at(0, mid[1], 0); cage(b, s, tint, lit, d, true); });
    }
    const lights = cd > 0 && lit > 0 ? [lightAt(b, [mid[0], mid[1] - s * 0.2, mid[2]], cd * lit, { radius: kind === 'post' ? 10 : 9 })] : [];
    return { lights, top: kind === 'post' ? mid[1] + s * 1.4 : 0 };
  });
}

/** a cage body centred on the origin, s tall: the glass between gold bands, its roof and its bowl (or a flat foot on a
 *  post) */
function cage(b: ArchBuilder, s: number, tint: V3, lit: number, d: Detail, onPost: boolean) {
  const n = byDetail(d, 6, 6, 4), rb = s * 0.36, ph = n === 4 ? Math.PI / 4 : 0;
  const y0 = -s / 2, y1 = s / 2, band = s * 0.08;
  b.with({ tint, glow: lit }, () => facets(b, 0, 0, rb, rb, y0, y1, n, MAT.WINDOW, ph));
  if (d === 'far') {
    // a pyramid roof, a plain foot
    facets(b, 0, 0, rb * 1.15, 0.001, y1, y1 + s * 0.5, 4, MAT.GOLD, ph);
    annulus(b, 0, 0, 0, rb * 1.15, y1, 4, MAT.GOLD, true, ph);
    annulus(b, 0, 0, 0, rb, y0, 4, MAT.GOLD, true, ph);
    return;
  }
  const sides = byDetail(d, 12, 8, 4);
  // the bands over and under the glass
  facets(b, 0, 0, rb * 1.12, rb * 1.12, y1, y1 + band, n, MAT.GOLD, ph);
  annulus(b, 0, 0, rb, rb * 1.12, y1, n, MAT.GOLD, true, ph);
  facets(b, 0, 0, rb * 1.12, rb * 1.12, y0 - band, y0, n, MAT.GOLD, ph);
  annulus(b, 0, 0, rb, rb * 1.12, y0, n, MAT.GOLD, false, ph);
  // its corners' posts
  if (d === 'near') for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + ph;
    facets(b, Math.cos(a) * rb, Math.sin(a) * rb, 0.016, 0.016, y0, y1, 4, MAT.GOLD, a + Math.PI / 4);
  }
  // the roof: a pointed dome, fluted near; its ball and its ring
  const yr = y1 + band, r = rb * 1.08;
  annulus(b, 0, 0, r, rb * 1.12, yr, n, MAT.GOLD, false, ph);
  const flute = d === 'near' ? (a: number) => 1 - 0.07 * Math.pow(Math.abs(Math.sin(a * 6)), 0.6) : undefined;
  revolve(b, 0, yr, 0, [[r, 0], [r * 0.97, s * 0.12], [r * 0.82, s * 0.27], [r * 0.55, s * 0.42], [r * 0.25, s * 0.56], [r * 0.08, s * 0.66], [0.012, s * 0.72]], sides, MAT.GOLD, { lobe: flute });
  const yb = yr + s * 0.72;
  revolve(b, 0, yb, 0, [[0.012, 0], [s * 0.05, s * 0.02], [s * 0.065, s * 0.07], [s * 0.05, s * 0.12], [0.012, s * 0.14], [0.001, s * 0.15]], byDetail(d, 8, 6, 4), MAT.GOLD);
  if (d === 'near') {
    // the ring it hangs by: a flat loop, both its faces
    const ry = yb + s * 0.15 + s * 0.08, rr = s * 0.08, t = 0.012, m = 8;
    for (let k = 0; k < m; k++) {
      const a0 = (k / m) * Math.PI * 2, a1 = ((k + 1) / m) * Math.PI * 2;
      const p = (a: number, rad: number): V3 => [Math.cos(a) * rad, ry + Math.sin(a) * rad, 0];
      const q = (v: V3, z: number): V3 => [v[0], v[1], z];
      b.quad(q(p(a0, rr), t), q(p(a0, rr + t * 1.6), t), q(p(a1, rr + t * 1.6), t), q(p(a1, rr), t), MAT.GOLD);
      b.quad(q(p(a1, rr), -t), q(p(a1, rr + t * 1.6), -t), q(p(a0, rr + t * 1.6), -t), q(p(a0, rr), -t), MAT.GOLD);
    }
  }
  if (onPost) { annulus(b, 0, 0, 0, rb * 1.12, y0 - band, n, MAT.GOLD, true, ph); return; }
  // the bowl under it and its drop
  const yd = y0 - band;
  annulus(b, 0, 0, r, rb * 1.12, yd, n, MAT.GOLD, true, ph);
  revolve(b, 0, yd, 0, [[0.001, -s * 0.42], [0.014, -s * 0.4], [s * 0.035, -s * 0.34], [0.012, -s * 0.28], [r * 0.28, -s * 0.2], [r * 0.7, -s * 0.1], [r * 0.95, -s * 0.03], [r, 0]], sides, MAT.GOLD, { fallback: [0, -1, 0] });
}

/** a paper body centred on the origin: the lit drum, its rims, its tassel */
function paper(b: ArchBuilder, s: number, tint: V3, lit: number, d: Detail) {
  const r = s * 0.42, y0 = -s / 2, y1 = s / 2;
  const sides = byDetail(d, 14, 8, 4);
  b.with({ tint, glow: lit }, () => {
    if (d === 'near') revolve(b, 0, 0, 0, [[r * 0.78, y0], [r * 0.93, y0 + s * 0.14], [r, 0], [r * 0.93, y1 - s * 0.14], [r * 0.78, y1]], sides, MAT.CLOTH);
    else facets(b, 0, 0, r * 0.85, r * 0.85, y0, y1, sides, MAT.CLOTH, sides === 4 ? Math.PI / 4 : 0);
  });
  if (d === 'far') {
    facets(b, 0, 0, r * 0.95, 0.001, y1, y1 + s * 0.15, 4, MAT.WOOD, Math.PI / 4);
    annulus(b, 0, 0, 0, r * 0.85, y0, 4, MAT.WOOD, true, Math.PI / 4);
    return;
  }
  // the rims: a short wooden ring at each end, closed
  const rr = r * 0.86, t = s * 0.07;
  for (const [ya, yb, up] of [[y1 - t * 0.4, y1 + t, true], [y0 - t, y0 + t * 0.4, false]] as const) {
    b.cylinder(0, 0, rr, ya, yb, sides, MAT.WOOD, { top: null });
    annulus(b, 0, 0, 0, rr, up ? yb : ya, sides, MAT.WOOD, !up);
  }
  // a knob on top to hang it by, a tassel under it
  b.cylinder(0, 0, s * 0.04, y1 + t, y1 + t + s * 0.08, 6, MAT.WOOD);
  if (d === 'near') b.with({ tint: [1.15, 0.3, 0.2] }, () => {
    b.cylinder(0, 0, 0.012, y0 - t - s * 0.08, y0 - t, 5, MAT.CLOTH, { top: null });
    b.cylinder(0, 0, 0.035, y0 - t - s * 0.32, y0 - t - s * 0.08, 6, MAT.CLOTH, { top: null, r1: 0.014, bottom: true });
  });
}

/** a chain from (x, y, z) down `len`: links (near) or a rod */
function chain(b: ArchBuilder, x: number, y: number, z: number, len: number, d: Detail) {
  b.with({ tint: IRON }, () => {
    if (d !== 'near') { b.box(x - 0.008, y - len, z - 0.008, x + 0.008, y, z + 0.008, MAT.WOOD, { skip: ['top', 'bottom'] }); return; }
    const L = 0.06, n = Math.max(1, Math.round(len / L));
    for (let k = 0; k < n; k++) {
      const ya = y - (k * len) / n, yb = y - ((k + 1) * len) / n, turn = k & 1;
      // (each link a flat oval, every other one turned a quarter: two thin bars)
      for (const s of [-1, 1]) {
        const dx = turn ? 0 : s * 0.012, dz = turn ? s * 0.012 : 0;
        b.box(x + dx - 0.004, yb, z + dz - 0.004, x + dx + 0.004, ya, z + dz + 0.004, MAT.WOOD, { skip: ['top', 'bottom'] });
      }
    }
  });
}

/** an iron bracket out of a wall's face: a plate on the wall, an arm out `arm` at y 0, a curl (or a straight brace)
 *  under it */
function bracketArm(b: ArchBuilder, arm: number, d: Detail) {
  b.with({ tint: IRON }, () => {
    proud(b, -0.05, -0.32, 0.05, 0.06, 0.025, MAT.WOOD);
    b.box(-0.016, -0.02, 0.025, 0.016, 0.02, arm, MAT.WOOD, { skip: ['n'] });
    if (d === 'far') return;
    // the curl: a bar bent through a quarter turn under the arm, from the plate up to it
    const n = d === 'near' ? 8 : 3, cx = 0.27, cy = -0.3, R = 0.27;
    barYZ(b, Array.from({ length: n + 1 }, (_, k) => { const a = Math.PI - (k / n) * (Math.PI * 0.5); return [0, cy + Math.sin(a) * R, cx + Math.cos(a) * R + 0.025] as V3; }), 0.014);
    if (d === 'near') {
      // a small scroll at the arm's tip
      const tip = arm - 0.02;
      barYZ(b, Array.from({ length: 7 }, (_, k) => { const a = -Math.PI / 2 + (k / 6) * Math.PI * 1.3, rr = 0.045 * (1 - k / 9); return [0, -0.045 + Math.sin(a) * rr + 0.03, tip - 0.06 + Math.cos(a) * rr] as V3; }), 0.01);
    }
  });
}

/** a square bar (half its width w) bent along points in the y–z plane: its four sides, each one strip mitred at the
 *  bends (so no two segments' faces lie over each other there), its ends */
function barYZ(b: ArchBuilder, pts: V3[], w: number) {
  const n = pts.length;
  // (each point's offset across the bar in y–z: the mitre of its two segments' normals)
  const off = pts.map((_, i) => {
    const seg = (j: number) => { const a = pts[Math.max(0, j)], c = pts[Math.min(n - 1, j + 1)], L = Math.hypot(c[1] - a[1], c[2] - a[2]) || 1; return [-(c[2] - a[2]) / L, (c[1] - a[1]) / L]; };
    const p = seg(i === 0 ? 0 : i - 1), q = seg(i === n - 1 ? n - 2 : i), k = 1 + p[0] * q[0] + p[1] * q[1];
    return [((p[0] + q[0]) / Math.max(k, 0.2)) * w, ((p[1] + q[1]) / Math.max(k, 0.2)) * w];
  });
  const at = (i: number, sx: number, sn: number): V3 => [pts[i][0] + sx * w, pts[i][1] + sn * off[i][0], pts[i][2] + sn * off[i][1]];
  const ring: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (let r = 0; r < 4; r++) {
    const [s0, n0] = ring[r], [s1, n1] = ring[(r + 1) % 4];
    for (let i = 0; i + 1 < n; i++) b.poly([at(i, s0, n0), at(i + 1, s0, n0), at(i + 1, s1, n1), at(i, s1, n1)], MAT.WOOD);
  }
  b.poly(ring.map(([s, t]) => at(n - 1, s, t)).reverse(), MAT.WOOD);
  b.poly(ring.map(([s, t]) => at(0, s, t)), MAT.WOOD);
}

/** a lamp post: a stone foot, an iron shaft with a collar, a plate for the lantern at h */
function lampPost(b: ArchBuilder, h: number, d: Detail) {
  const fw = 0.17, fh = 0.32;
  b.box(-fw, 0, -fw, fw, fh, fw, MAT.ASHLAR, { skip: ['bottom', 'top'] });
  if (d === 'near') {
    // the foot's top bevelled up to the shaft
    facets(b, 0, 0, fw * Math.SQRT2, 0.08, fh, fh + 0.1, 4, MAT.ASHLAR, Math.PI / 4);
    annulus(b, 0, 0, 0.04, 0.08, fh + 0.1, 4, MAT.ASHLAR, false, Math.PI / 4);
  } else annulus(b, 0, 0, 0, fw * Math.SQRT2, fh, 4, MAT.ASHLAR, false, Math.PI / 4);
  const y0 = d === 'near' ? fh + 0.1 : fh;
  const sides = byDetail(d, 8, 6, 4);
  b.with({ tint: IRON }, () => {
    b.cylinder(0, 0, 0.055, y0, h - 0.06, sides, MAT.WOOD, { top: null, r1: 0.04 });
    if (d !== 'far') {
      b.cylinder(0, 0, 0.075, y0 + 0.25, y0 + 0.31, sides, MAT.WOOD);
      annulus(b, 0, 0, 0.05, 0.075, y0 + 0.25, sides, MAT.WOOD, true);
    }
  });
  // the plate the lantern stands on
  b.cylinder(0, 0, 0.1, h - 0.06, h, byDetail(d, 8, 6, 4), MAT.GOLD, { top: null });
  annulus(b, 0, 0, 0.04, 0.1, h - 0.06, byDetail(d, 8, 6, 4), MAT.GOLD, true);
}
