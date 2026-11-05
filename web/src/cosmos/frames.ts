// The ladder of frames from the observable universe down to the surface of an eye: each frame has its own unit (megaparsecs
// at the top, millimetres at the bottom) and sits in its parent at a position and a rotation, so no frame ever holds a
// number much bigger than a few thousand of its units. Below the eye is the cell's own world (nanometres, y up, the
// same axes as the eye's).
//
// Zooming follows one nested chain, as in Powers of Ten: the target is a point on the eye of someone lying on their
// back in a meadow in Boulder, looking up (over the iris, a few millimetres from the pupil), Colorado, on the Earth, in the solar system, in the Orion Arm of the Milky Way, in the cosmic web.
// `target` in each frame is that point in the frame's units (doubles); each frame's GPU work happens relative to it
// rounded to float32 (its own floating origin, as in ../engine/origin.ts).
//
// Axes: every frame is y-up in its own terms: the galaxy's y is the galactic pole, the solar system's the ecliptic
// pole, the Earth's its spin axis, the ground's and the eye's the local vertical. The camera's reference orientation
// glides between frames as you zoom (frames.ts reference()), so each one is seen square-on at its own scale.
import { quat, vec3, type Quat, type Vec3 } from 'math';
import { FIGURE_EYE, FIGURE_NORMAL } from './figure/pose';

export const MPC = 3.0857e22, KPC = 3.0857e19, PC = 3.0857e16, LY = 9.4607e15, AU = 1.495978707e11, KM = 1e3, M = 1, MM = 1e-3, NM = 1e-9;
const DEG = Math.PI / 180;

export interface Frame {
  id: string;
  name: string;
  /** metres per unit */
  unit: number;
  parent: Frame | null;
  /** origin in the parent's units */
  at: Vec3;
  /** local → parent */
  rot: Quat;
  /** log10 of the view distance (m) at which this frame is the camera's reference */
  home: number;
  /** local → the top frame (computed) */
  q: Quat;
  /** the zoom's target point in this frame's units (computed) */
  target: Vec3;
}

const frame = (id: string, name: string, unit: number, parent: Frame | null, home: number, at: Vec3 = [0, 0, 0], rot: Quat = quat.create()): Frame =>
  ({ id, name, unit, parent, at, rot, home, q: quat.create(), target: [0, 0, 0] });

const axis = (x: number, y: number, z: number, a: number) => quat.setAxisAngle(quat.create(), [x, y, z], a);

/** where on Earth the dive ends: its latitude and longitude (deg), its name, its ground above the sea (km) */
export interface Place { lat: number; lon: number; name: string; km: number }
/** Chautauqua's meadow in Boulder, Colorado, below the Flatirons (data/earth has its ground): the default, and the
 *  dome's (Boulder's Fiske) */
export const BOULDER: Place = { lat: 39.99652, lon: -105.28596, name: 'Boulder, Colorado', km: 1.759 };
export const PLACE = BOULDER;
/** the Earth's radius at Boulder's meadow (km): the air's sea-level sphere (air.wgsl R_BOTTOM) and its 1759 m (a
 *  ladder's own place: Ladder.earthR) */
export const EARTH_R = 6360 + BOULDER.km;
/** the target on Eli's drawn right eye, in the ground frame (m): in the iris, on the skin it's drawn on
 *  (figure/pose.ts) */
export const EYE: Vec3 = [FIGURE_EYE[0], FIGURE_EYE[1], FIGURE_EYE[2]];
/** the eye frame in the ground's: turned so its up is her skin's at the target (the camera's reference there, and the
 *  tissue's sheet in its x, z: cosmos/tissue.ts, the cell world's axes) */
export const EYE_ROT: Quat = quat.rotationTo(quat.create(), [0, 1, 0], [FIGURE_NORMAL[0], FIGURE_NORMAL[1], FIGURE_NORMAL[2]]);

/** days since J2000.0 (2000-01-01 12:00 TT) */
export const daysJ2000 = (ms: number) => (ms - Date.UTC(2000, 0, 1, 12)) / 86400000;

// ---------------------------------------------------------------- the planets (J2000 mean elements and their rates per
// century: a (AU), e, i, L, long. of perihelion, long. of ascending node (deg); Standish, JPL "Keplerian elements for
// approximate positions of the major planets", 1800–2050)
export const PLANETS = [
  { id: 'mercury', name: 'Mercury', r: 2439.7, el: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], d: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081], color: [0.55, 0.52, 0.5] },
  { id: 'venus', name: 'Venus', r: 6051.8, el: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], d: [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418], color: [0.95, 0.85, 0.62] },
  { id: 'earth', name: 'Earth', r: 6371.0, el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], d: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0], color: [0.3, 0.5, 0.9] },
  { id: 'mars', name: 'Mars', r: 3389.5, el: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], d: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343], color: [0.85, 0.45, 0.28] },
  { id: 'jupiter', name: 'Jupiter', r: 69911, el: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], d: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106], color: [0.85, 0.75, 0.6] },
  { id: 'saturn', name: 'Saturn', r: 58232, el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], d: [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794], color: [0.9, 0.82, 0.6] },
  { id: 'uranus', name: 'Uranus', r: 25362, el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], d: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589], color: [0.62, 0.84, 0.9] },
  { id: 'neptune', name: 'Neptune', r: 24622, el: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], d: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.05549508], color: [0.35, 0.5, 0.95] },
] as const;

/** a planet's heliocentric position (AU) in the solar frame (x: the vernal equinox, y: the ecliptic pole) */
export function planetPos(p: (typeof PLANETS)[number], d: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const T = d / 36525;
  const [a, e, i, L, w, O] = p.el.map((x, k) => x + p.d[k] * T);
  let M = ((L - w) % 360) * DEG;
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 6; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return orbitPoint(a, e, i, w, O, E, out);
}
/** a point on an orbit at eccentric anomaly E (elements in AU and degrees), in the solar frame */
export function orbitPoint(a: number, e: number, i: number, w: number, O: number, E: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const om = (w - O) * DEG, Om = O * DEG, I = i * DEG;
  const co = Math.cos(om), so = Math.sin(om), cO = Math.cos(Om), sO = Math.sin(Om), cI = Math.cos(I), sI = Math.sin(I);
  const X = (co * cO - so * sO * cI) * xp + (-so * cO - co * sO * cI) * yp;
  const Y = (co * sO + so * cO * cI) * xp + (-so * sO + co * cO * cI) * yp;
  const Z = so * sI * xp + co * sI * yp;
  // ecliptic (X, Y, Z) → the frame's (x, y, z) = (X, Z, −Y)
  out[0] = X; out[1] = Z; out[2] = -Y;
  return out;
}
/** the Moon's geocentric position (km) in the Earth's inertial terms (a circular orbit, 5.1° to the ecliptic) */
export function moonPos(d: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const L = (218.316 + 13.176396 * d) * DEG, Om = (125.08 - 0.052954 * d) * DEG, I = 5.145 * DEG;
  // in the ecliptic, then into the frame's axes (x, y, z) = (X, Z, −Y)
  const u = L - Om, r = 384400;
  const X = r * (Math.cos(Om) * Math.cos(u) - Math.sin(Om) * Math.sin(u) * Math.cos(I));
  const Y = r * (Math.sin(Om) * Math.cos(u) + Math.cos(Om) * Math.sin(u) * Math.cos(I));
  const Z = r * Math.sin(u) * Math.sin(I);
  out[0] = X; out[1] = Z; out[2] = -Y;
  return out;
}

export const OBLIQUITY = 23.4393 * DEG;

// ---------------------------------------------------------------- the ladder
export class Ladder {
  readonly cosmos = frame('cosmos', 'The observable universe', MPC, null, 25.2);
  /** the Milky Way, its disc tilted in the cosmic web */
  readonly galaxy = frame('galaxy', 'The Milky Way', KPC, this.cosmos, 21.2, [0, 0, 0], quat.multiply(quat.create(), axis(1, 0, 0, 38 * DEG), axis(0, 0, 1, -22 * DEG)));
  /** the Sun's neighbourhood: 8.2 kpc from the centre, 20 pc above the plane */
  readonly local = frame('local', 'The solar neighbourhood', PC, this.galaxy, 17.6, [8.2, 0.02, 0]);
  /** the ecliptic, 60.2° to the galactic plane */
  readonly solar = frame('solar', 'The solar system', AU, this.local, 12.6, [0, 0, 0], axis(1, 0, 0, -60.2 * DEG));
  /** the Earth, its axis tilted and turning */
  readonly earth = frame('earth', 'The Earth', KM, this.solar, 7.3);
  readonly ground = frame('ground', BOULDER.name, M, this.earth, 2.0);
  /** the eye, close: y the way it looks (straight up), the target at its origin */
  readonly eye = frame('eye', 'An eye', MM, this.ground, -2.2, [EYE[0], EYE[1], EYE[2]], EYE_ROT);
  readonly all: Frame[] = [this.cosmos, this.galaxy, this.local, this.solar, this.earth, this.ground, this.eye];
  /** days since J2000 */
  day = 0;
  /** the Earth's spin (rad, Greenwich from the equinox) */
  gmst = 0;
  /** the Sun's direction in the ground frame (the light for the Earth, the meadow and the eye) */
  readonly sunGround: Vec3 = [0, 1, 0];

  /** the Earth's radius at the spot (km): the air's sea-level sphere and the spot's ground above it */
  readonly earthR: number;
  /** over what zoom (log10 m) the view eases off the spot onto the Earth's middle (a film moves it out, where the
   *  Earth's small) */
  earthPivot: [number, number] = [6.1, 7.1];
  /** past the edge of the observable universe, where the view goes as the zoom comes out (metres, the top frame's
   *  axes) and over what zoom (log10 m) it gets there: the middle of the keepers' world (levels/beyond.ts) */
  beyond: { at: Vec3; from: number; to: number } | null = null;

  constructor(ms = Date.now(), readonly place: Place = BOULDER) {
    this.earthR = 6360 + place.km;
    this.ground.name = place.name;
    this.setTime(ms);
  }

  /** place the Earth, its spin and everything below it for a moment */
  setTime(ms: number) {
    const d = daysJ2000(ms);
    this.day = d;
    planetPos(PLANETS[2], d, this.earth.at);
    this.gmst = ((280.46061837 + 360.98564736629 * d) % 360) * DEG;
    // tilt about the equinox, then the day's turn about the axis
    quat.multiply(this.earth.rot, axis(1, 0, 0, -OBLIQUITY), axis(0, 1, 0, this.gmst));
    // the spot: its zenith, east and south as the ground's y, x and z (Earth-fixed axes: x Greenwich, y north)
    const la = this.place.lat * DEG, lo = this.place.lon * DEG;
    const up: Vec3 = [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)];
    const east: Vec3 = [-Math.sin(lo), 0, -Math.cos(lo)];
    const south = vec3.cross(vec3.create(), east, up);
    vec3.scale(this.ground.at, up, this.earthR);
    quat.fromMat3(this.ground.rot, [east[0], east[1], east[2], up[0], up[1], up[2], south[0], south[1], south[2]]);
    quat.normalize(this.ground.rot, this.ground.rot);
    this.update();
    // the Sun from the meadow: from the Earth toward the solar frame's origin, carried down
    const toSun = vec3.negate(vec3.create(), this.earth.at);
    vec3.normalize(this.sunGround, this.dirInto(this.solar, this.ground, toSun));
  }

  /** each frame's orientation in the top frame and the target in its units */
  update() {
    for (const f of this.all) {
      if (f.parent) quat.multiply(f.q, f.parent.q, f.rot);
      else quat.copy(f.q, f.rot);
      quat.normalize(f.q, f.q);
    }
    // the target: the eye frame's origin, carried up the ladder
    vec3.set(this.eye.target, 0, 0, 0);
    for (let i = this.all.length - 1; i > 0; i--) {
      const f = this.all[i], p = f.parent!;
      vec3.transformQuat(p.target, f.target, f.rot);
      vec3.scaleAndAdd(p.target, f.at, p.target, f.unit / p.unit);
    }
  }

  /** where the camera looks, as an offset from the target (metres, the top frame's axes): at each body's own scale it
   *  eases onto the body — the galaxy's centre, the Sun, the Earth's — and back onto the target as the zoom passes it,
   *  so every scale is framed on what it's about and the dive still ends on the hand */
  pivotOffset(logS: number, out: Vec3): Vec3 {
    vec3.set(out, 0, 0, 0);
    const ease = (a: number, b: number) => { const t = Math.max(0, Math.min(1, (logS - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (const [f, k] of [[this.galaxy, ease(19.4, 21.0)], [this.solar, ease(10.9, 12.3)], [this.earth, ease(this.earthPivot[0], this.earthPivot[1])]] as [Frame, number][]) {
      if (k <= 0) continue;
      // (the body sits at the frame's origin)
      vec3.transformQuat(_v, f.target, f.q);
      vec3.scaleAndAdd(out, out, _v, -k * f.unit);
    }
    const b = this.beyond;
    if (b) {
      const k = ease(b.from, b.to);
      // (off the galaxy's middle — the origin, up here — onto theirs)
      if (k > 0) vec3.scaleAndAdd(out, out, b.at, k);
    }
    return out;
  }

  /** a point from one frame into another (in doubles, through their nearest common frame: never up through the
   *  top's megaparsecs for two frames side by side) */
  pointInto(from: Frame, to: Frame, p: ArrayLike<number>, out: Vec3 = [0, 0, 0]): Vec3 {
    const up = (f: Frame) => { const a: Frame[] = []; for (let g: Frame | null = f; g; g = g.parent) a.push(g); return a; };
    const fa = up(from), ta = up(to);
    const common = fa.find((f) => ta.includes(f))!;
    vec3.copy(out, p as Vec3);
    // up from `from` to the common frame
    for (let f = from; f !== common; f = f.parent!) {
      vec3.transformQuat(out, out, f.rot);
      vec3.scaleAndAdd(out, f.at, out, f.unit / f.parent!.unit);
    }
    // and down to `to`
    const down = ta.slice(0, ta.indexOf(common)).reverse();
    for (const f of down) {
      vec3.subtract(out, out, f.at);
      vec3.transformQuat(out, out, quat.invert(_q, f.rot));
      vec3.scale(out, out, f.parent!.unit / f.unit);
    }
    return out;
  }

  /** a direction from one frame's axes into another's */
  dirInto(from: Frame, to: Frame, v: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
    vec3.transformQuat(out, v, from.q);
    const inv = quat.invert(_q, to.q);
    return vec3.transformQuat(out, out, inv);
  }

  /** the camera's reference orientation at a zoom (log10 m): each frame's own between their homes, glided */
  reference(logS: number, out: Quat): Quat {
    const F = this.all;
    if (logS >= F[0].home) return quat.copy(out, F[0].q);
    for (let i = 0; i < F.length - 1; i++) {
      const a = F[i], b = F[i + 1];
      if (logS <= a.home && logS >= b.home) {
        const t = (a.home - logS) / (a.home - b.home);
        // (held near each home, turned in between)
        const s = t * t * (3 - 2 * t);
        return quat.slerp(out, a.q, b.q, s);
      }
    }
    return quat.copy(out, F[F.length - 1].q);
  }
}
const _q = quat.create();
const _v: Vec3 = [0, 0, 0];
