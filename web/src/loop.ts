// The loop (?film=loop): one take that ends where it begins. From close on one bead of the DNA — glass, here, and the
// keepers' world inside it — out at one steady speed through the strand, the nucleus, the cell, her eye and her, the
// gardens, the Earth, the Sun, the Milky Way, the web, the edge of the observable universe; past it, slowing, to our
// universe in a marble over a keeper's palm; on out, slower, as the two of them and the thread of universes between
// them come into view, slower still a while with them all in it; then gathering speed out of their world — whose sky turns out to be the
// inside of a marble too, and that marble the bead we began on, in the strand in the nucleus in the cell in her eye. The
// last frame is the one before the first.
//
// The zoom is one number all the way (log10 of the view distance in metres, ours below the cell's edge and the cosmos's
// above it, the keepers' world continuing ours past the universe's edge: beyond.ts's scale), stepped at a constant rate
// but for the keepers'; both cameras are set from it every frame (the cell's by waypoints, the cosmos's the ladder's own
// but for where it looks among the keepers), the realms crossfading where they hand over. Rendered as the journey is
// (journey.ts: frames stepped by hand, posted to the dev server, the score rendered offline along the same cues).
import type { Capture } from '@ericrius1/weft';
import { quat, vec3, type Quat, type Vec3 } from 'math';
import type { App } from './main';
import { Score, type FilmCue } from './audio/score';
import { NM } from './cosmos/frames';
import { JEWEL_GLASS, M_PER_CM, logSOf, WORLD_C, WORLD_R, ORB_R } from './cosmos/levels/beyond';

/** the bead made glass: on the strand at the middle of the DNA's place, on its near side as the DNA's place looks at it
 *  (found there: where the view's middle meets the strand, brought out by its radius; nm), and its radius */
export const JEWEL: { at: Vec3; r: number } = { at: [-3318.534, 460.798, -1888.848], r: 0.36 };
/** the way the first frame looks at it (the DNA's place's own): the strand behind it */
const YAW0 = 0.4, PITCH0 = -0.3;

const FPS = 30;
/** decades a second, everywhere but at the keepers */
const K = 0.42;
/** the first frame: the jewel two-thirds of the frame's height (the view distance, nm) */
const S0 = 0.96;
const Z0 = Math.log10(S0 * NM);
/** nm (the cell's) per cm (the keepers'): the jewel's glass is their sky's radius times JEWEL_GLASS */
const NM_PER_CM = JEWEL.r / JEWEL_GLASS / WORLD_R;
/** the last frame's zoom in the keepers' terms: the first frame's, the jewel seen from as far */
const Z_END = logSOf(S0 / NM_PER_CM);
/** the cell hands the camera to the cosmos round its top (-3.8), and the cosmos back to the cell (the jewel) before the
 *  camera leaves the keepers' sky: inside it the two are one picture, and the cell's own glass takes it out */
const UP = [-3.9, -3.72];
const DOWN = [logSOf(WORLD_R * 0.62), logSOf(WORLD_R * 0.97)];
/** at the keepers (log10 m): slowing from the edge of the universe (A) to our marble over the palm, a third of the frame
 *  (B), on out at V_REV as the keepers come into view, easing to V_HOLD as they're all in it (R), held there
 *  for T_HOLD seconds, then gathering speed (from G) back to K a little before the last frame (Z_END - K_TAIL), so the
 *  end's zoom runs into the start's at the start's own speed */
const zA = 26.55, zB = logSOf(ORB_R * 4.5), zR = logSOf(115);
const V_REV = 0.14, V_HOLD = 0.035, T_HOLD = 6, K_TAIL = 0.1;
/** (the reveal's speed eased down to the hold's over this much zoom before R) */
const R_EASE = 0.3;
const zG = zR + V_HOLD * T_HOLD;
/** where the view eases off our marble onto the middle of their world (their world's, by the time the cell's jewel
 *  takes over: DOWN): a drift of its centre as the frame widens round it, never a turn toward anything */
const LOOK = [logSOf(18), logSOf(140)];

// the cell's views on the way out (zoom, then a place or a point, yaw, pitch); between them eased by the zoom
interface Way { z: number; at: Vec3 | string; pitch: number }
const CELL: Way[] = [
  { z: Z0, at: JEWEL.at, pitch: PITCH0 },
  { z: Math.log10(11 * NM), at: JEWEL.at, pitch: PITCH0 },
  { z: Math.log10(55 * NM), at: 'dna', pitch: PITCH0 },
  { z: Math.log10(1500 * NM), at: 'dna', pitch: -0.38 },
  { z: Math.log10(8800 * NM), at: 'nucleus', pitch: -0.42 },
  { z: Math.log10(21000 * NM), at: 'cell', pitch: -0.42 },
  { z: Math.log10(46000 * NM), at: 'tissue', pitch: -0.62 },
  { z: UP[1], at: 'tissue', pitch: -1.05 },
];
// the cosmos's pitch on the way out: its places' (journey.ts), but looking down on the gardens' canyon as it climbs (not
// along a horizon of sand), up out of the Milky Way's disc steeply (not through its dust); then barely moving at the keepers
const PITCH: [number, number][] = [
  [-3.9, -1.05], [-3.62, -1.05], [-2.45, -1.1], [-1.75, -1.1], [-0.75, -1.2], [0.35, -0.95], [2.0, -1.05], [3.5, -1.0], [5.0, -0.85],
  [6.3, -0.5], [7.3, -0.15], [10.0, -0.25], [13.0, -0.35], [17.6, -0.3], [19.6, -0.95], [21.3, -0.75], [24.3, -0.4], [26.6, -0.25],
  [Z_END, PITCH0],
];
// the yaw: one whole turn over the loop, mostly where there's least to see (the dark from the Earth to the stars turning
// with the Milky Way's band in it), the Earth seen sunlit, and the keepers from in front of the first, the way that
// barely turns from the edge of the universe to the last frame
const T2 = 2 * Math.PI;
const YAW: [number, number][] = [
  [Z0, YAW0], [-7.26, 0.5], [-5.06, 0.62], [-4.34, 0.72], [-3.8, 0.85], [-1.75, 0.95], [0.35, 1.0], [3.5, 0.7], [6.0, 0.15], [7.3, 0.0],
  [10.0, 1.6], [13.0, 3.4], [17.6, 4.7], [21.3, 0.9 + T2], [24.3, 0.7 + T2], [26.6, 0.75 + T2],
  [Z_END, YAW0 + T2],
];

// past the gardens the camera rises along the spot's zenith, looking down on it (tilted a little, as it was looking) until
// the Earth is small: the view then eases off the spot onto the Earth's middle (ladder.earthPivot) along the line it looks
// down, so the Earth falls away steadily, where the ladder's own ease (6.1 to 7.1, the Earth filling the frame) stalls
// the zoom and swings the view south over it; only once the Earth is a speck does it turn on to the yaw and pitch above
const LIFT = [3.5, 5.0, 8.4, 9.6], LIFT_YAW = 0.7, LIFT_PITCH = -1.25, EARTH_PIVOT: [number, number] = [7.7, 8.7];
const _q = quat.create(), _qi = quat.create(), _a: Vec3 = [0, 0, 0], _b: Vec3 = [0, 0, 0];
/** a view direction (yaw, pitch about a reference orientation) in the top frame */
function dir(yaw: number, pitch: number, ref: Quat, out: Vec3) {
  vec3.set(out, -Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  return vec3.transformQuat(out, out, ref);
}

const smooth = (u: number) => { const x = Math.min(1, Math.max(0, u)); return x * x * x * (x * (x * 6 - 15) + 10); };
/** a value through (z, v) waypoints at z, eased between each pair */
function through(ways: [number, number][], z: number) {
  if (z <= ways[0][0]) return ways[0][1];
  for (let i = 0; i < ways.length - 1; i++) {
    const [a, va] = ways[i], [b, vb] = ways[i + 1];
    if (z <= b) return va + (vb - va) * smooth((z - a) / (b - a));
  }
  return ways[ways.length - 1][1];
}
/** where the cosmos's camera looks among the keepers at a zoom (their world, cm): our marble, drifting to their
 *  world's middle */
function lookAt(z: number): Vec3 {
  const u = smooth((z - LOOK[0]) / (LOOK[1] - LOOK[0])), c = WORLD_C as Vec3;
  return [c[0] * u, c[1] * u, c[2] * u];
}
/** the zoom's speed at a zoom: steady but at the keepers */
function speed(z: number) {
  if (z < zA) return K;
  if (z < zB) return K + (V_REV - K) * smooth((z - zA) / (zB - zA));
  if (z < zR) return V_REV + (V_HOLD - V_REV) * smooth((z - (zR - R_EASE)) / R_EASE);
  if (z < zG) return V_HOLD;
  const zK = Z_END - K_TAIL;
  if (z < zK) return V_HOLD + (K - V_HOLD) * smooth((z - zG) / (zK - zG));
  return K;
}

export class Loop {
  readonly fps = FPS;
  readonly total: number;
  /** each frame's zoom */
  private readonly Z: number[] = [];
  private frameNo = 0;

  constructor(private app: App, private capture: Capture) {
    // the zoom through the loop, stepped at its speed; then stretched a hair so the step past the last frame lands on
    // the first frame's zoom exactly (the loop's seam a step like every other)
    let z = Z0;
    while (z < Z_END) { this.Z.push(z); z += speed(z) / FPS; }
    const k = (Z_END - Z0) / (z - Z0);
    for (let i = 0; i < this.Z.length; i++) this.Z[i] = Z0 + (this.Z[i] - Z0) * k;
    this.total = this.Z.length;
    app.cosmos.controls.driven = true;
    app.controls.driven = true;
    app.mixDriven = true;
    app.jewel = JEWEL;
    app.controls.minScale = 0.25;
    // (the cell's crowd made out round the focus from the first frame, so zooming out finds it there in the haze; the
    // membranes glass throughout, so what's beyond the nucleus comes out of the haze as the view widens rather than
    // showing through all at once as they turn; and the empty background the haze's own colour while it's thick, as
    // the solid membranes behind everything made it, darkening as it thins)
    app.field.minRadius = 200;
    // (the crowd never on the line the eye backs away along, so what's flown past comes in from the frame's edge and goes
    // rather than swelling up in front of the lens; and as the crowd thins, each molecule going shrinks whole, as if off
    // into the haze, rather than to a dust of beads)
    app.field.nearByRadius = true;
    app.shrinkWhole = true;
    app.shellGlass = [0, 1];
    app.hazeBg = [150, 2500];
    // (the zoom past the keepers' sky: out to where the jewel hands back)
    app.cosmos.controls.max = Z_END + 0.2;
    app.cosmos.ladder.earthPivot = EARTH_PIVOT;
    // the keepers' every motion a whole number of turns in the loop
    if (app.cosmos.beyond) app.cosmos.beyond.C.cycle = this.total / FPS;
  }

  /** this frame's cameras and realm (the app calls it first, before either camera updates) */
  direct(_dt: number) {
    const app = this.app, i = Math.min(this.frameNo, this.total - 1), z = this.Z[i];
    const [yaw, pitch] = this.lift(z, through(YAW, z), through(PITCH, z));
    const c = app.controls, cc = app.cosmos.controls, b = app.cosmos.beyond;
    if (b) b.clock = i / FPS;
    // (where the cosmos's camera looks among the keepers: our marble, then the middle of their world)
    const M = M_PER_CM, at = lookAt(z);
    app.cosmos.ladder.beyond = { at: [at[0] * M, at[1] * M, at[2] * M], from: 26.85, to: 26.9 };
    // (the cell's haze by the zoom alone: the nucleus's round the strand, the cytoplasm's, then outside — so the last
    // frame's is the first's)
    const zn = (nm: number) => Math.log10(nm * NM);
    const hz = z < zn(1500) ? 0 : z < zn(9000) ? smooth((z - zn(1500)) / (zn(9000) - zn(1500))) : 1 + smooth((z - zn(14000)) / (zn(30000) - zn(14000)));
    app.hazeMix = z > DOWN[0] ? ['nucleus', 'nucleus', 0] : hz < 1 ? ['nucleus', 'cytosol', hz] : ['cytosol', 'outside', hz - 1];
    const cellAt = (zz: number) => {
      // (the waypoints' pivots by the zoom: a place's, or a point)
      const P = (w: Way): Vec3 => (typeof w.at === 'string' ? app.places.get(w.at)!.at as Vec3 : w.at);
      let k = CELL.length - 2;
      for (let n = 0; n < CELL.length - 1; n++) if (zz <= CELL[n + 1].z) { k = n; break; }
      const a = CELL[k], bb = CELL[k + 1], u = smooth((zz - a.z) / (bb.z - a.z));
      const pa = P(a), pb = P(bb);
      const pivot: Vec3 = [pa[0] + (pb[0] - pa[0]) * u, pa[1] + (pb[1] - pa[1]) * u, pa[2] + (pb[2] - pa[2]) * u];
      return { pivot, pitch: a.pitch + (bb.pitch - a.pitch) * u };
    };
    if (z < UP[1]) {
      // the cell (and the cosmos with it as they cross)
      const v = cellAt(Math.min(z, UP[1]));
      c.reach = 4;
      c.set(v.pivot, Math.pow(10, z) / NM, yaw, v.pitch);
      // (the cut open while it's inside the cell, shut by the time the sheet of cells is in view)
      app.cut = app.cutTarget = 1 - smooth((z - Math.log10(15000 * NM)) / (Math.log10(40000 * NM) - Math.log10(15000 * NM)));
      const m = smooth((z - UP[0]) / (UP[1] - UP[0]));
      if (m > 0) cc.follow(z, yaw, pitch);
      app.setRealm(m > 0.5 ? 'cosmos' : 'cell');
      app.mix = m;
    } else if (z < DOWN[0]) {
      cc.set(z, yaw, pitch);
      app.setRealm('cosmos');
      app.mix = 1;
    } else {
      // the keepers' sky left behind: the cell's camera on the jewel as far out as the cosmos's is from their world's
      // middle, the two crossing over
      const s = (Math.pow(10, z) / M) * NM_PER_CM;
      c.reach = 1;
      c.set(JEWEL.at, s, yaw, pitch);
      const m = 1 - smooth((z - DOWN[0]) / (DOWN[1] - DOWN[0]));
      if (m > 0) cc.set(z, yaw, pitch);
      app.setRealm(m > 0.5 ? 'cosmos' : 'cell');
      app.mix = m;
      // (the molecules round it where they were at the first frame: biology's clock run back to it)
      app.bioTime = -(this.total - i) / FPS * 1e-4;
    }
    if (i === 0) app.bioTime = 0;
  }

  /** the yaw and pitch at a zoom, risen over the spot past the gardens (LIFT) */
  private lift(z: number, yaw: number, pitch: number): [number, number] {
    const w = smooth((z - LIFT[0]) / (LIFT[1] - LIFT[0])) * (1 - smooth((z - LIFT[2]) / (LIFT[3] - LIFT[2])));
    if (w <= 0) return [yaw, pitch];
    const L = this.app.cosmos.ladder, ref = L.reference(z, _q);
    // (the two directions in the top frame, the way between them turned through at an even rate)
    const a = dir(yaw, pitch, ref, _a), b = dir(LIFT_YAW, LIFT_PITCH, L.ground.q, _b);
    const th = Math.acos(Math.min(1, Math.max(-1, vec3.dot(a, b))));
    if (th > 1e-5) {
      const s = Math.sin(th), ka = Math.sin((1 - w) * th) / s, kb = Math.sin(w * th) / s;
      vec3.set(a, a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb);
    }
    // (back into the zoom's reference orientation)
    const d = vec3.transformQuat(a, a, quat.invert(_qi, ref));
    return [Math.atan2(-d[0], -d[2]), Math.asin(Math.min(1, Math.max(-1, d[1])))];
  }

  /** the score's cues along the way: the scale (nm, the cell's widest above it) and where it is */
  private cues(): FilmCue[] {
    const out: FilmCue[] = [];
    for (let i = 0; i < this.total; i += FPS * 4) {
      const z = this.Z[i];
      const nm = Math.min(Math.pow(10, z) / NM, 160000);
      const comp = z < Math.log10(7000 * NM) ? 'nucleus' : z < Math.log10(20000 * NM) ? 'cytosol' : 'outside';
      out.push({ t: i / FPS, scale: z > DOWN[1] ? 3 : nm, compartment: z > DOWN[1] ? 'nucleus' : comp, event: i === 0 ? 'arrive' : 'fly' });
    }
    return out;
  }

  /** render it: what it needs loaded first, then every frame to the dev server, then the soundtrack (a few seconds
   *  longer than the picture, for tools/loop.mjs to fold its tail over its head) */
  async run() {
    const app = this.app, post = (path: string, body: Blob | string, q = '') => fetch(`/__film${path}?name=loop${q}`, { method: 'POST', body });
    const step = async (n: number, dt = 0) => { for (let k = 0; k < n; k++) { await this.capture.step(dt); await new Promise((r) => setTimeout(r, 50)); } };
    // (the ground round the spot, her figure, the keepers' world: asked for now, waited for)
    void app.cosmos.data.load().catch(() => {});
    void app.cosmos.surface.figure.load().catch(() => {});
    app.cosmos.beyond?.load();
    for (let k = 0; k < 900 && !(app.cosmos.data.ready && (app.cosmos.beyond?.ready ?? true)); k++) await step(1);
    // (a few seconds on the first frame, the clock running, for whatever settles over time to settle)
    await step(90, 1 / FPS);
    const w = window as unknown as Record<string, unknown>;
    const q = new URLSearchParams(location.search);
    const start = Number(q.get('from') ?? 0), until = Number(q.get('until') ?? this.total);
    for (this.frameNo = start; this.frameNo < until; this.frameNo++) {
      const img = await this.capture.step(1 / this.fps);
      const cv = new OffscreenCanvas(img.width, img.height);
      cv.getContext('2d')!.putImageData(img, 0, 0);
      const blob = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.93 });
      await post('/frame', blob, `&i=${this.frameNo}`);
      w.__film = { frame: this.frameNo, total: this.total, shot: 0, done: false };
    }
    if (start === 0 && until === this.total) {
      const wav = await Score.renderFilm(this.total / this.fps + 4, this.cues());
      await post('/audio', wav);
    }
    await post('/meta', JSON.stringify({ name: 'loop', fps: this.fps, frames: this.total }));
    w.__film = { frame: this.total, total: this.total, shot: 0, done: true };
  }

  /** for a test: the camera at frame i (and its zoom) */
  seek(i: number) { this.frameNo = i; return this.Z[Math.min(i, this.total - 1)]; }
}
