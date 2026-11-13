// The bodies of the solar system, as data: where each is at a moment (AU, the solar frame: x the vernal equinox of
// J2000, y the ecliptic pole), how big, and which way it faces. The eight planets on their mean elements (frames.ts
// PLANETS), the Moon (frames.ts moonPos), the dwarf planets and Halley's comet on their osculating elements, the two
// Voyagers moved on along their velocity from JPL's state vectors (data/orbits/orbits.json: they've coasted in nearly
// straight lines since their last flybys, Saturn's in 1980 and Neptune's in 1989). Which way a planet faces is the IAU's
// (Archinal et al. 2018, "Report of the IAU Working Group on Cartographic Coordinates and Rotational Elements: 2015"):
// its pole's right ascension and declination in the ICRF and its prime meridian's angle W, both as linear terms in time
// (the small periodic terms for Mars and Neptune left out: a fraction of a degree).
import type { Vec3 } from 'math';
import { AU, OBLIQUITY, PLANETS, orbitPoint, planetPos, moonPos } from './frames';

const DEG = Math.PI / 180;

export type BodyKind = 'star' | 'planet' | 'moon' | 'dwarf' | 'comet' | 'spacecraft';

/** a body's orientation: its pole's RA and Dec (deg, ICRF, each with a rate per Julian century) and its prime meridian
 *  W = w0 + wd · days (deg) */
interface Spin { ra: [number, number]; dec: [number, number]; w: [number, number] }

const SPIN: Record<string, Spin> = {
  sun: { ra: [286.13, 0], dec: [63.87, 0], w: [84.176, 14.1844] },
  mercury: { ra: [281.0103, -0.0328], dec: [61.4155, -0.0049], w: [329.5988, 6.1385108] },
  venus: { ra: [272.76, 0], dec: [67.16, 0], w: [160.2, -1.4813688] },
  mars: { ra: [317.269202, -0.10927547], dec: [54.432516, -0.05827105], w: [176.049863, 350.891982443297] },
  jupiter: { ra: [268.056595, -0.006499], dec: [64.495303, 0.002413], w: [284.95, 870.536] },
  saturn: { ra: [40.589, -0.036], dec: [83.537, -0.004], w: [38.9, 810.7939024] },
  uranus: { ra: [257.311, 0], dec: [-15.175, 0], w: [203.81, -501.1600928] },
  neptune: { ra: [299.36, 0], dec: [43.46, 0], w: [249.978, 541.1397757] },
};

/** equatorial radius (km) and flattening, where the mean radius in PLANETS isn't the shape (the giants are squashed) */
const SHAPE: Record<string, [number, number]> = {
  sun: [695700, 0], mercury: [2440.53, 0], venus: [6051.8, 0], earth: [6378.137, 0.00335], mars: [3396.19, 0.00589],
  jupiter: [71492, 0.06487], saturn: [60268, 0.09796], uranus: [25559, 0.02293], neptune: [24764, 0.01708], moon: [1737.4, 0],
};

/** the small bodies' sizes (km, mean radius; Haumea's is its mean of a very elongated shape; Halley's nucleus) */
const SMALL_R: Record<string, number> = { ceres: 469.7, pluto: 1188.3, eris: 1163, haumea: 780, makemake: 715, sedna: 500, halley: 5.5 };

export interface Body {
  id: string;
  name: string;
  kind: BodyKind;
  /** equatorial radius (km) and flattening */
  r: number;
  flat: number;
}

/** a small body's osculating elements at an epoch (orbits.json smallBodies) */
interface Elements { a_AU: number; e: number; i_deg: number; node_deg: number; peri_deg: number; M_deg: number; epochJD_TDB: number; n_degPerDay: number }
/** a spacecraft's state at an epoch (orbits.json spacecraft) */
interface State { positionAU: number[]; velocityAUperDay: number[]; epochJD_TDB: number }
export interface OrbitsJson { spacecraft: { items: (State & { name: string })[] }; smallBodies: { items: (Elements & { name: string })[] } }

const J2000_JD = 2451545.0;
const idOf = (name: string) => name.toLowerCase().replace(/\s+/g, '');

/** an ICRF (equatorial J2000) direction into the solar frame's axes (x, y, z) = (X, Z, −Y) of the ecliptic */
export function icrfToSolar(v: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
  const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
  const X = v[0], Y = v[1] * c + v[2] * s, Z = -v[1] * s + v[2] * c;
  out[0] = X; out[1] = Z; out[2] = -Y;
  return out;
}

export class Bodies {
  readonly list: Body[] = [];
  private readonly byId = new Map<string, Body>();
  private elements = new Map<string, Elements>();
  private states = new Map<string, State>();
  /** the small bodies are in (orbits.json) */
  loaded = false;

  constructor() {
    this.add({ id: 'sun', name: 'The Sun', kind: 'star', r: SHAPE.sun[0], flat: 0 });
    for (const p of PLANETS) this.add({ id: p.id, name: p.name, kind: 'planet', r: SHAPE[p.id][0], flat: SHAPE[p.id][1] });
    this.add({ id: 'moon', name: 'The Moon', kind: 'moon', r: SHAPE.moon[0], flat: 0 });
  }
  private add(b: Body) { this.list.push(b); this.byId.set(b.id, b); }

  /** the small bodies and the spacecraft, from orbits.json */
  take(o: OrbitsJson) {
    if (this.loaded) return;
    for (const s of o.smallBodies.items) {
      const id = idOf(s.name);
      this.elements.set(id, s);
      this.add({ id, name: s.name === 'Halley' ? 'Halley\'s comet' : s.name, kind: id === 'halley' ? 'comet' : 'dwarf', r: SMALL_R[id] ?? 300, flat: 0 });
    }
    for (const s of o.spacecraft.items) {
      const id = idOf(s.name);
      this.states.set(id, s);
      this.add({ id, name: s.name, kind: 'spacecraft', r: 0.0037, flat: 0 });
    }
    this.loaded = true;
  }

  get(id: string) { return this.byId.get(id) ?? null; }

  /** where a body is on a day (days since J2000), heliocentric (AU, the solar frame); null if it isn't known */
  at(id: string, day: number, out: Vec3 = [0, 0, 0]): Vec3 | null {
    if (id === 'sun') { out[0] = out[1] = out[2] = 0; return out; }
    const p = PLANETS.find((q) => q.id === id);
    if (p) return planetPos(p, day, out);
    if (id === 'moon') {
      planetPos(PLANETS[2], day, out);
      moonPos(day, _m);
      for (let i = 0; i < 3; i++) out[i] += (_m[i] * 1000) / AU;
      return out;
    }
    const el = this.elements.get(id);
    if (el) {
      const M = (el.M_deg + el.n_degPerDay * (day + J2000_JD - el.epochJD_TDB)) * DEG, e = el.e;
      let E = M + e * Math.sin(M);
      for (let k = 0; k < 30; k++) { const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= dE; if (Math.abs(dE) < 1e-12) break; }
      return orbitPoint(el.a_AU, e, el.i_deg, el.peri_deg + el.node_deg, el.node_deg, E, out);
    }
    const st = this.states.get(id);
    if (st) {
      // (ecliptic J2000 state, carried on along its velocity, into the frame's axes)
      const dt = day + J2000_JD - st.epochJD_TDB, P = st.positionAU, V = st.velocityAUperDay;
      const X = P[0] + V[0] * dt, Y = P[1] + V[1] * dt, Z = P[2] + V[2] * dt;
      out[0] = X; out[1] = Z; out[2] = -Y;
      return out;
    }
    return null;
  }

  /** a small body's orbit (its elements), for drawing it whole: a, e, i, longitude of perihelion, node (deg) */
  orbitOf(id: string): [number, number, number, number, number] | null {
    const el = this.elements.get(id);
    return el ? [el.a_AU, el.e, el.i_deg, el.peri_deg + el.node_deg, el.node_deg] : null;
  }
  /** a spacecraft's state: where it is and where it's going (AU, AU a day; the frame's axes) at a day */
  stateOf(id: string, day: number): { at: Vec3; v: Vec3 } | null {
    const st = this.states.get(id);
    if (!st) return null;
    const at = this.at(id, day)!, V = st.velocityAUperDay;
    return { at, v: [V[0], V[2], -V[1]] };
  }

  /** which way a planet (or the Sun) faces on a day: its north pole and its prime meridian (unit vectors, the solar
   *  frame); false if the IAU gives it no rotation here */
  spin(id: string, day: number, pole: Vec3, meridian: Vec3): boolean {
    const s = SPIN[id];
    if (!s) return false;
    const T = day / 36525;
    const ra = (s.ra[0] + s.ra[1] * T) * DEG, dec = (s.dec[0] + s.dec[1] * T) * DEG, W = ((s.w[0] + s.w[1] * day) % 360) * DEG;
    const p: Vec3 = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
    // (the node of its equator on the ICRF's, then W round the pole from there, eastward)
    const q: Vec3 = [-Math.sin(ra), Math.cos(ra), 0];
    const pq: Vec3 = [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    const m: Vec3 = [q[0] * Math.cos(W) + pq[0] * Math.sin(W), q[1] * Math.cos(W) + pq[1] * Math.sin(W), q[2] * Math.cos(W) + pq[2] * Math.sin(W)];
    icrfToSolar(p, pole);
    icrfToSolar(m, meridian);
    return true;
  }
}
const _m: Vec3 = [0, 0, 0];

/** a float to the bits of a half float (round to nearest), for the half-float textures the levels fill by hand */
export function half(x: number): number {
  const f = new Float32Array([x]), u = new Uint32Array(f.buffer)[0];
  const s = (u >>> 16) & 0x8000, e = ((u >>> 23) & 0xff) - 127 + 15, m = u & 0x7fffff;
  if (e <= 0) return s;
  if (e >= 31) return s | 0x7c00;
  return s | ((e << 10) + ((m + 0x1000) >>> 13));
}
