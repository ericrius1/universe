// Aang's glider (glider.wgsl draws it in the cast's ink and paint): his wooden staff opened out — red-orange wings swept
// back from its head to their tips, their edges ribbed in yellow-brown, a small tail at its foot — built here once as a
// few hundred triangles (its own frame: x its right, y up, z back along the staff), and carried wherever `at` puts it
// (play/powers.ts: over him while he glides as the player, his hands on the staff). Drawn only while it's out, as far
// open as `at` says: the wings and the tail fan out from along the staff as he takes off (the shader folds them).
import type { Kit, RenderPass, StorageBuffer, UniformBuffer } from '@ericrius1/weft';
import shader from './glider.wgsl';
import { type V3, sub, cross, norm, clamp, smoothstep } from '../hero/math';

/** where it is: its middle (the hands' grip) and its frame (right, up, back), world; how far it's open (0 folded along
 *  the staff .. 1, the default; a little past as it snaps open) */
export interface GliderAt { o: V3; x: V3; y: V3; z: V3; open?: number }

/** its fanning open as he takes off (s) */
export const OPEN_T = 0.32;
/** how far open it is t (s) into a take-off: fanned out over OPEN_T, a little past open as it snaps, then settled */
export const openAt = (t: number) => smoothstep(0, OPEN_T, t) + 0.07 * Math.sin(Math.PI * clamp((t - OPEN_T * 0.7) / 0.22, 0, 1));

function build(): Float32Array {
  const out: number[] = [];
  // (each face wound counter-clockwise seen from outside, its normal the outward one given)
  const tri = (a: V3, b: V3, c: V3, col: number, n: V3) => {
    const f = cross(sub(b, a), sub(c, a));
    const pts = f[0] * n[0] + f[1] * n[1] + f[2] * n[2] >= 0 ? [a, b, c] : [a, c, b];
    for (const p of pts) out.push(p[0], p[1], p[2], col, n[0], n[1], n[2], 0);
  };
  const quad = (a: V3, b: V3, c: V3, d: V3, col: number, n: V3) => { tri(a, b, c, col, n); tri(a, c, d, col, n); };
  // a flat plate: a planform (x, z) at height y (with dihedral k: y + k |x|), its thickness th: top, bottom and rim
  const plate = (pts: [number, number][], y: number, k: number, th: number, col: number) => {
    const top = pts.map(([x, z]): V3 => [x, y + k * Math.abs(x) + th / 2, z]);
    const bot = pts.map(([x, z]): V3 => [x, y + k * Math.abs(x) - th / 2, z]);
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    for (let i = 1; i + 1 < pts.length; i++) { tri(top[0], top[i], top[i + 1], col, [0, 1, 0]); tri(bot[0], bot[i], bot[i + 1], col, [0, -1, 0]); }
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const m: V3 = [(pts[i][0] + pts[j][0]) / 2 - cx, 0, (pts[i][1] + pts[j][1]) / 2 - cz];
      quad(top[i], bot[i], bot[j], top[j], col, norm(m));
    }
  };
  // the staff: an eight-sided rod from its head (forward, -z) to its foot
  const r = 0.018, z0 = -0.95, z1 = 0.78, n = 8;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const p = (a: number, z: number): V3 => [Math.cos(a) * r, Math.sin(a) * r, z];
    quad(p(a0, z0), p(a1, z0), p(a1, z1), p(a0, z1), 1, [Math.cos(am), Math.sin(am), 0]);
    // (the grip: a short bar across under the staff where his hands hold it)
    const g = (a: number, x: number): V3 => [x, -0.05 + Math.cos(a) * 0.014, 0.02 + Math.sin(a) * 0.014];
    quad(g(a0, -0.17), g(a1, -0.17), g(a1, 0.17), g(a0, 0.17), 1, [0, Math.cos(am), Math.sin(am)]);
  }
  for (const x of [-0.17, 0.17]) quad([x, -0.05, 0.02], [x, 0, 0.02], [x, 0, 0.034], [x, -0.05, 0.034], 1, [Math.sign(x), 0, 0]);
  for (const side of [1, -1]) {
    const s = (pts: [number, number][]): [number, number][] => pts.map(([x, z]): [number, number] => [x * side, z]);
    // the wing: swept back from beside the staff's head to its tip, its trailing edge back in to the staff
    plate(s([[0.02, -0.78], [1.02, 0.12], [0.94, 0.3], [0.02, 0.34]]), 0.012, 0.07, 0.012, 0);
    // its leading edge's rib
    plate(s([[0.02, -0.8], [1.04, 0.1], [1.0, 0.13], [0.02, -0.75]]), 0.016, 0.07, 0.02, 2);
    // the tail
    plate(s([[0.02, 0.5], [0.3, 0.72], [0.28, 0.78], [0.02, 0.76]]), 0.006, 0.03, 0.01, 0);
  }
  return new Float32Array(out);
}

export class Glider {
  /** where it is this frame (null: folded away, not drawn) */
  at: GliderAt | null = null;
  /** the post chain's grade (post.ts settings), for the display lock */
  grade: { exposure: number; saturation: number; contrast: number; punchy: number; warmth: number; bloom: number } | null = null;
  private buf: StorageBuffer;
  private u: UniformBuffer<any>;
  private n: number;

  constructor(kit: Kit) {
    const v = build();
    this.n = v.length / 8;
    this.buf = kit.storage({ label: 'glider.verts', data: v });
    this.u = kit.uniforms(shader.structs.GliderU, 'glider');
  }

  /** into the scene pass with the opaque world: its fills, then its ink line */
  draw(pass: RenderPass) {
    const common = { count: this.n, bind: { GU: this.u, verts: this.buf } as never, enabled: () => !!this.at };
    pass.draw(shader, { ...common, label: `${pass.label}.glider`, vertex: 'vsFill', fragment: 'fsFill', cull: 'none' });
    pass.draw(shader, { ...common, label: `${pass.label}.glider.ink`, vertex: 'vsInk', fragment: 'fsInk', cull: 'front' });
  }

  update() {
    const a = this.at, g = this.grade;
    if (!a) return;
    this.u.set({
      o: [a.o[0], a.o[1], a.o[2], 0], x: [a.x[0], a.x[1], a.x[2], 0], y: [a.y[0], a.y[1], a.y[2], 0], z: [a.z[0], a.z[1], a.z[2], 0],
      grade: g ? [g.exposure, g.saturation, g.contrast, g.punchy] : [0, 1, 1, 0], grade2: g ? [g.warmth, g.bloom, 0, 0] : [0, 0, 0, 0],
      toon: [2.4, 0, 0, 0], shape: [a.open ?? 1, 0, 0, 0],
    });
  }
}
