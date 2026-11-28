// The loop (?film=loop): one take that ends where it begins. From the observable universe seen whole, a ball of the
// oldest light, in at one steady pace through the web, the Milky Way, the Sun, the Earth, the gardens, her and her eye,
// the cell, the nucleus and the strand of DNA; into one bead of it, where the bead turns out to be atoms; into one atom's
// cloud, empty but for its nucleus; into a proton, its quarks; on down through the long desert of scales where nothing
// new appears, to the foam of spacetime at the Planck length; and past it, where scale stops meaning anything, into an
// infinite light — which gathers into a ball, the universe new-born, cooling into the ball we began on. The last frame
// is the one before the first.
//
// The zoom is one number all the way (log10 of the view distance in metres): the cosmos's above the cell's edge, the
// cell's below it, down past the bead into the world below the atom (shaders/quantum.wgsl, drawn round the bead); and
// past the bottom, the cosmos's again from above the universe's edge — the two crossing over a band (SEAM) where the
// light below the atom is the universe's first. Stepped at a pace set by the zoom (`speed`), both cameras are set from
// it every frame (the cell's by waypoints, the cosmos's the ladder's own), the realms crossfading where they hand over.
// Rendered as the journey is (journey.ts: frames stepped by hand, posted to the dev server, the score rendered offline
// along the same cues).
import type { Capture } from '@ericrius1/weft';
import { quat, vec3, type Quat, type Vec3 } from 'math';
import type { App } from './main';
import { Score, type FilmCue } from './audio/score';
import { NM } from './cosmos/frames';

/** the bead the zoom goes into: on the strand at the middle of the DNA's place, on its near side as the DNA's place looks
 *  at it (found there: where the view's middle meets the strand, brought out by its radius; nm), and its radius. The
 *  strand's own beads give way to it there (beads.wgsl, filament.wgsl): it's drawn as its atoms (shaders/quantum.wgsl) */
export const JEWEL: { at: Vec3; r: number } = { at: [-3318.534, 460.798, -1888.848], r: 0.36 };
/** the way the cell looks at it (the DNA's place's own): the strand behind it */
const YAW0 = 0.4, PITCH0 = -0.3;

const FPS = 60;
/** the bead a third of the frame's height (view distance, nm): where the dive by hand arrives on it */
const S0 = 0.96;
const Z0 = Math.log10(S0 * NM);
/** the cell hands the camera to the cosmos round its top (-3.8), and back */
const UP = [-3.9, -3.72];
/** the seam (cosmos zoom, log10 m): above the edge of the universe, its ball shrinking to a point of light (T1) and
 *  grown back to the frame's height (T0, the film's first frame). Across it the cosmos crosses with the light below the
 *  atom (the cell's camera on the bead, `DELTA` decades further in: the same zoom, come round) */
const T0 = 27.05, T1 = 28.0;
/** the zoom below the atom at the seam's top: where the light past the Planck length gathers into the ball */
const L1 = -40;
const DELTA = T1 - L1;
/** the radius of the observable universe's ball (m: web.ts EDGE, 14,300 Mpc) */
const EDGE_M = 14300 * 3.0857e22;

/** the zoom's pace (decades a second) by the zoom: steady through the cosmos and the cell, slower where the bead turns
 *  to atoms and the nucleus to quarks, quick through the empty atom and the desert below the quark, slower at the foam,
 *  and back to the cosmos's own pace as the light comes round into the universe's ball */
const SPEED: [number, number][] = [
  [L1 - 1.2, 0.45], [L1 + 0.6, 0.6], [-37, 0.9], [-35.2, 0.6], [-34, 0.45], [-32.4, 0.7], [-30, 1.7], [-20, 1.7],
  [-17.6, 0.75], [-16.4, 0.42], [-14.2, 0.38], [-13.6, 0.85], [-11.2, 0.85], [-10.4, 0.36], [-9.4, 0.36], [-8.6, 0.46],
  [27.0, 0.46], [T1 + 0.5, 0.45],
];

// the cell's views on the way (zoom, then a place or a point, pitch); between them eased by the zoom
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
// the cosmos's pitch: its places' (journey.ts), but looking down on the gardens' canyon (not along a horizon of sand),
// through the Milky Way's disc steeply (not along its dust); level at the universe's ball
const PITCH: [number, number][] = [
  [-3.9, -1.05], [-3.62, -1.05], [-2.45, -1.1], [-1.75, -1.1], [-0.75, -1.2], [0.35, -0.95], [2.0, -1.05], [3.5, -1.0], [5.0, -0.85],
  [6.3, -0.5], [7.3, -0.15], [10.0, -0.25], [13.0, -0.35], [17.6, -0.3], [19.6, -0.95], [21.3, -0.75], [24.3, -0.4], [26.6, -0.25],
];
// the yaw: a whole turn from the universe's ball to the bead, mostly where there's least to see (the dark from the stars
// to the Earth turning with the Milky Way's band in it), the Earth seen sunlit; below the bead a slow drift as the atoms
// come apart round the eye, then held
const T2 = 2 * Math.PI;
const YAW: [number, number][] = [
  [-16, YAW0 - 0.55], [-10.6, YAW0 - 0.3], [Z0, YAW0], [-7.26, 0.5], [-5.06, 0.62], [-4.34, 0.72], [-3.8, 0.85], [-1.75, 0.95],
  [0.35, 1.0], [3.5, 0.7], [6.0, 0.15], [7.3, 0.0], [10.0, 1.6], [13.0, 3.4], [17.6, 4.7], [21.3, 0.9 + T2], [24.3, 0.7 + T2],
  [26.6, 0.75 + T2],
];

// past the gardens the camera rises along the spot's zenith, looking down on it (tilted a little, as it was looking) until
// the Earth is small: the view then eases off the spot onto the Earth's middle (ladder.earthPivot) along the line it looks
// down, so the Earth grows steadily, where the ladder's own ease (6.1 to 7.1, the Earth filling the frame) stalls the
// zoom and swings the view south over it; only once the Earth is a speck does it turn on to the yaw and pitch above
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
/** the cell's way down in the film at a zoom (log10 m): the waypoints' pivot (a place's, or a point) and pitch, eased
 *  between them by the zoom, and the film's yaw */
export function cellWay(places: Map<string, { at: Vec3 }>, z: number): { pivot: Vec3; yaw: number; pitch: number } {
  const P = (w: Way): Vec3 => (typeof w.at === 'string' ? places.get(w.at)!.at : w.at);
  let k = CELL.length - 2;
  for (let n = 0; n < CELL.length - 1; n++) if (z <= CELL[n + 1].z) { k = n; break; }
  const a = CELL[k], b = CELL[k + 1], u = smooth((z - a.z) / (b.z - a.z));
  const pa = P(a), pb = P(b);
  return { pivot: [pa[0] + (pb[0] - pa[0]) * u, pa[1] + (pb[1] - pa[1]) * u, pa[2] + (pb[2] - pa[2]) * u], yaw: through(YAW, z), pitch: a.pitch + (b.pitch - a.pitch) * u };
}
/** the loop's seam, for the app's own zoom (main.ts) as for the film: over the band DOWN (the cosmos's zoom above the
 *  edge) the cell's camera is on the bead as far below the atom as `DELTA` decades in, the two crossing by `seamMix` (the
 *  cosmos's share): all the cosmos's at DOWN[0], all the cell's at DOWN[1]. Z_END is the top of the cosmos's zoom with
 *  the loop; S0 the bead's first full view (nm) */
export const SEAM = { DOWN: [T0, T1], Z_END: T1 + 0.25, S0, DELTA };
/** the cell's distance from the bead (nm) at a cosmos zoom in the band, and back */
export const jewelS = (z: number) => Math.pow(10, z - DELTA) / NM;
export const jewelZ = (s: number) => Math.log10(s * NM) + DELTA;
export const seamMix = (z: number) => 1 - smooth((z - T0) / (T1 - T0));
/** the radius of the universe's ball in the view's own units (its distance 1) at a cosmos zoom: what the light below the
 *  atom gathers into across the seam */
export const ballR = (z: number) => EDGE_M / Math.pow(10, z);
/** the way in by hand over the gardens (main.ts: CosmosControls.guide): the film's yaw, from her feet' side (her head
 *  is toward the ground's -x), and steeper than the film's pitch from a couple of metres up through her face and eye,
 *  so the zoom comes down onto them, her face the right way up — never along the flowers over the crown of her head;
 *  back to the film's pitch in her skin, where the cell takes the camera */
const HAND_PITCH: [number, number][] = [[-3.8, -1.05], [-2.6, -1.25], [0.3, -1.25], [1.6, -1.1], [2.6, -1.05]];
export const approach = (logS: number): [number, number] => [through(YAW, logS), through(HAND_PITCH, logS)];

export class Loop {
  readonly fps = FPS;
  readonly total: number;
  /** each frame's zoom, and biology's clock at it (as the app runs it: the cell's, slowing as the zoom goes in), so any
   *  stretch of the film renders as it would in the whole of it (?from, ?until) */
  private readonly Z: number[] = [];
  private readonly BT: number[] = [];
  private frameNo = 0;

  constructor(private app: App, private capture: Capture) {
    // the zoom through the loop, stepped in at its pace from the universe's ball to the same ball come round (DELTA
    // decades on); then stretched a hair so the step past the last frame lands on the first frame's zoom exactly (the
    // loop's seam a step like every other)
    const zEnd = T0 - DELTA;
    let z = T0;
    while (z > zEnd) { this.Z.push(z); z -= through(SPEED, z) / FPS; }
    const k = (T0 - zEnd) / (T0 - z);
    for (let i = 0; i < this.Z.length; i++) this.Z[i] = T0 - (T0 - this.Z[i]) * k;
    this.total = this.Z.length;
    let bt = 0;
    for (const zz of this.Z) { this.BT.push(bt); if (zz < UP[1]) bt += Math.min(1, Math.max(0.01, Math.pow(10, zz) / NM / 10000)) / FPS; }
    app.cosmos.controls.driven = true;
    app.controls.driven = true;
    app.mixDriven = true;
    app.jewel = JEWEL;
    app.controls.minScale = jewelS(T0) * 0.5;
    // (the cell's crowd made out round the focus, so the zoom finds it in the haze; the membranes glass throughout, so
    // what's inside the cell comes out of the haze as the view narrows rather than showing through all at once as they
    // turn; and the empty background the haze's own colour while it's thick, darkening as it thins)
    app.field.minRadius = 200;
    // (the crowd never on the line the eye comes in along, so what's flown past goes out by the frame's edge rather than
    // swelling up in front of the lens; and as the crowd thins, each molecule going shrinks whole, as if off into the
    // haze, rather than to a dust of beads)
    app.field.nearByRadius = true;
    app.shrinkWhole = true;
    app.shellGlass = [0, 1];
    app.hazeBg = [150, 2500];
    // (the zoom above the edge of the universe, where the seam is)
    app.cosmos.controls.max = SEAM.Z_END;
    app.cosmos.ladder.earthPivot = EARTH_PIVOT;
    // (no constellations' figures drawn over the stars: the film's sky is the sky)
    if (app.cosmos.has('local')) app.cosmos.local.figures = 0;
  }

  /** this frame's cameras and realm (the app calls it first, before either camera updates) */
  direct(_dt: number) {
    const app = this.app, i = Math.min(this.frameNo, this.total - 1), z = this.Z[i];
    const [yaw, pitch] = this.lift(z, through(YAW, z), through(PITCH, z));
    const c = app.controls, cc = app.cosmos.controls;
    app.bioTime = this.BT[i];
    app.quantumTime = i / FPS;
    // (the cell's haze by the zoom alone: the nucleus's round the strand, the cytoplasm's, then outside)
    const zn = (nm: number) => Math.log10(nm * NM);
    const hz = z < zn(1500) ? 0 : z < zn(9000) ? smooth((z - zn(1500)) / (zn(9000) - zn(1500))) : 1 + smooth((z - zn(14000)) / (zn(30000) - zn(14000)));
    app.hazeMix = hz < 1 ? ['nucleus', 'cytosol', hz] : ['cytosol', 'outside', hz - 1];
    const cellAt = (zz: number) => cellWay(app.places as Map<string, { at: Vec3 }>, zz);
    if (z >= UP[1]) {
      // the cosmos
      cc.set(z, yaw, pitch);
      app.setRealm('cosmos');
      app.mix = 1;
    } else if (z >= UP[0]) {
      // the cell and the cosmos crossing at the skin
      const v = cellAt(z);
      c.reach = 4;
      c.set(v.pivot, Math.pow(10, z) / NM, yaw, v.pitch);
      app.cut = app.cutTarget = 0;
      const m = smooth((z - UP[0]) / (UP[1] - UP[0]));
      cc.follow(z, yaw, pitch);
      app.setRealm(m > 0.5 ? 'cosmos' : 'cell');
      app.mix = m;
    } else {
      // the cell, down to the bead and into it (the world below the atom drawn round it: App.quantumFrame); past the
      // bottom, the cosmos's ball crossing in above the edge, DELTA decades round
      const v = cellAt(z);
      c.reach = z < Z0 ? 1 : 4;
      c.set(v.pivot, Math.pow(10, z) / NM, yaw, v.pitch);
      // (the cut open while it's inside the cell, opened as the sheet of cells gives way to one)
      app.cut = app.cutTarget = 1 - smooth((z - Math.log10(15000 * NM)) / (Math.log10(40000 * NM) - Math.log10(15000 * NM)));
      const zc = z + DELTA, m = zc > T1 ? 0 : seamMix(zc);
      if (m > 0) cc.set(zc, through(YAW, 30), through(PITCH, 30));
      app.setRealm(m > 0.5 ? 'cosmos' : 'cell');
      app.mix = m;
    }
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

  /** the score's cues along the way: the scale (nm, the cell's widest above it, its smallest below) and where it is */
  private cues(): FilmCue[] {
    const out: FilmCue[] = [];
    for (let i = 0; i < this.total; i += FPS * 4) {
      const z = this.Z[i];
      const nm = Math.max(0.3, Math.min(Math.pow(10, z) / NM, 160000));
      const comp = z < Math.log10(7000 * NM) ? 'nucleus' : z < Math.log10(20000 * NM) ? 'cytosol' : 'outside';
      out.push({ t: i / FPS, scale: nm, compartment: comp, event: i === 0 ? 'arrive' : 'fly' });
    }
    return out;
  }

  /** render it: what it needs loaded first, then every frame to the dev server, then the soundtrack (a few seconds
   *  longer than the picture, for tools/loop.mjs to fold its tail over its head) */
  async run() {
    const app = this.app, post = (path: string, body: Blob | string, q = '') => fetch(`/__film${path}?name=loop${q}`, { method: 'POST', body });
    const step = async (n: number, dt = 0) => { for (let k = 0; k < n; k++) { await this.capture.step(dt); await new Promise((r) => setTimeout(r, 50)); } };
    // (the ground round the spot and her figure: asked for now, waited for)
    void app.cosmos.data.load().catch(() => {});
    void app.cosmos.surface.figure.load().catch(() => {});
    for (let k = 0; k < 900 && !app.cosmos.data.ready; k++) await step(1);
    const w = window as unknown as Record<string, unknown>;
    const q = new URLSearchParams(location.search);
    const start = Number(q.get('from') ?? 0), until = Number(q.get('until') ?? this.total);
    // (a few seconds on the first frame, the clock running, for whatever settles over time to settle)
    this.frameNo = start;
    await step(90, 1 / FPS);
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
  /** for a test: the frame at a zoom (the first at or below it) */
  frameAt(z: number) { const i = this.Z.findIndex((v) => v <= z); return i < 0 ? this.total - 1 : i; }
}
