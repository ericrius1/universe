// The planets among the stars (world/stars.ts): heliocentric positions from JPL's Keplerian elements for approximate
// positions (E. M. Standish, valid 1800-2050, good to arcminutes), seen from the Earth, in the star catalogue's J2000
// equatorial frame; each one's brightness, apparent size, phase and the tilt of its pole (Saturn's rings open by it).
const D2R = Math.PI / 180;
const OBLIQUITY = 23.43928 * D2R;

type El = [number, number, number, number, number, number];
// a (AU), e, I, L, long. perihelion, long. node (deg): values at J2000 and their rates per Julian century
const ELEMENTS: Record<string, [El, El]> = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
  earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
  mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  uranus: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
};

/** absolute magnitude H, equatorial diameter at 1 AU (arcsec), north pole (RA, Dec deg), flattening, colour (linear) */
const BODY: Record<string, { H: number; d1: number; pole: [number, number]; flat: number; color: [number, number, number] }> = {
  mercury: { H: -0.42, d1: 6.74, pole: [281.01, 61.42], flat: 0, color: [0.62, 0.56, 0.5] },
  venus: { H: -4.4, d1: 16.92, pole: [272.76, 67.16], flat: 0, color: [0.95, 0.9, 0.78] },
  mars: { H: -1.52, d1: 9.36, pole: [317.681, 52.887], flat: 0.006, color: [0.85, 0.42, 0.22] },
  jupiter: { H: -9.4, d1: 196.94, pole: [268.057, 64.495], flat: 0.065, color: [0.86, 0.78, 0.66] },
  saturn: { H: -8.88, d1: 165.6, pole: [40.589, 83.537], flat: 0.098, color: [0.9, 0.8, 0.6] },
  uranus: { H: -7.19, d1: 70.48, pole: [257.311, -15.175], flat: 0.023, color: [0.62, 0.85, 0.9] },
  neptune: { H: -6.87, d1: 68.3, pole: [299.36, 43.46], flat: 0.017, color: [0.4, 0.55, 0.95] },
};

export const PLANETS = Object.keys(BODY);

export interface PlanetView {
  name: string;
  /** unit vector, J2000 equatorial (x to RA 0, z to the north pole) */
  dir: [number, number, number];
  mag: number;
  /** apparent equatorial diameter (arcsec) */
  diameter: number;
  /** illuminated fraction and the direction (equatorial) the lit side faces, from the sun */
  phase: number;
  sunDir: [number, number, number];
  /** the pole (equatorial unit vector) and the latitude of the Earth seen from the planet (rings' opening) */
  pole: [number, number, number];
  tilt: number;
  flat: number;
  color: [number, number, number];
  distance: number;
}

const wrap180 = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;

function helio(name: string, T: number): [number, number, number] {
  const [e0, e1] = ELEMENTS[name];
  const el = e0.map((v, i) => v + e1[i] * T);
  const [a, e, I, L, wbar, node] = el;
  const w = wbar - node;
  const M = wrap180(L - wbar);
  // Kepler's equation in degrees
  const eDeg = e / D2R;
  let E = M + eDeg * Math.sin(M * D2R);
  for (let k = 0; k < 8; k++) {
    const dM = M - (E - eDeg * Math.sin(E * D2R));
    E += dM / (1 - e * Math.cos(E * D2R));
  }
  const xp = a * (Math.cos(E * D2R) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E * D2R);
  const cw = Math.cos(w * D2R), sw = Math.sin(w * D2R), cO = Math.cos(node * D2R), sO = Math.sin(node * D2R), cI = Math.cos(I * D2R), sI = Math.sin(I * D2R);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

/** ecliptic -> equatorial (J2000) */
const toEq = (v: number[]): [number, number, number] => [v[0], v[1] * Math.cos(OBLIQUITY) - v[2] * Math.sin(OBLIQUITY), v[1] * Math.sin(OBLIQUITY) + v[2] * Math.cos(OBLIQUITY)];
const unit = (v: number[]): [number, number, number] => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const radec = (ra: number, dec: number): [number, number, number] => [Math.cos(dec * D2R) * Math.cos(ra * D2R), Math.cos(dec * D2R) * Math.sin(ra * D2R), Math.sin(dec * D2R)];

/** every planet as seen from the Earth at a Julian date */
export function planets(jd: number): PlanetView[] {
  const T = (jd - 2451545) / 36525;
  const earth = helio('earth', T);
  return PLANETS.map((name) => {
    const p = helio(name, T);
    const g = [p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]];
    const dist = Math.hypot(g[0], g[1], g[2]), r = Math.hypot(p[0], p[1], p[2]);
    const b = BODY[name];
    // the phase angle (sun-planet-earth)
    const cosPhase = (p[0] * g[0] + p[1] * g[1] + p[2] * g[2]) / (r * dist);
    const phaseAngle = Math.acos(Math.max(-1, Math.min(1, cosPhase)));
    let mag = b.H + 5 * Math.log10(r * dist);
    // phase darkening: strong for the inner planets, slight for the rest
    mag += name === 'venus' || name === 'mercury' ? 0.012 * (phaseAngle / D2R) + 4e-6 * (phaseAngle / D2R) ** 3 : name === 'mars' ? 0.016 * (phaseAngle / D2R) : 0.005 * (phaseAngle / D2R);
    const dir = unit(toEq(g));
    const pole = radec(b.pole[0], b.pole[1]);
    // the Earth's latitude seen from the planet: the opening of Saturn's rings
    const tilt = Math.asin(Math.max(-1, Math.min(1, -(pole[0] * dir[0] + pole[1] * dir[1] + pole[2] * dir[2]))));
    if (name === 'saturn') mag += -2.6 * Math.abs(Math.sin(tilt)) + 1.2 * Math.sin(tilt) ** 2;
    return {
      name, dir, mag, diameter: b.d1 / dist, phase: (1 + Math.cos(phaseAngle)) / 2, sunDir: unit(toEq(p.map((v) => -v))),
      pole, tilt, flat: b.flat, color: b.color, distance: dist,
    };
  });
}

/** the Julian date of a local clock time (hours) on a calendar day with a UTC offset (hours) */
export function julianDate(year: number, month: number, day: number, localHours: number, utcOffset: number) {
  return Date.UTC(year, month - 1, day) / 86400000 + 2440587.5 + (localHours - utcOffset) / 24;
}
