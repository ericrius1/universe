// Where the sun and moon are over the site at a local clock time (NOAA's solar position, Schlyter's moon: well under
// a tenth of a degree for the sun, which is what the shadows need). World axes: x east, y up, z south.
import type { V3 } from '@ericrius1/weft';

const D2R = Math.PI / 180;

export interface Place { latitude: number; longitude: number; utcOffset: number }

export function julian(year: number, month: number, day: number, utcHours: number) {
  let y = year, m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + utcHours / 24 + B - 1524.5;
}

/** the sun's direction (unit vector toward it), altitude and azimuth (degrees, from north toward east) */
export function sunPosition(p: Place, year: number, month: number, day: number, localHours: number) {
  const jd = julian(year, month, day, localHours - p.utcOffset);
  const T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * D2R) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * D2R) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * D2R) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * D2R);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * D2R);
  const decl = Math.asin(Math.sin(eps * D2R) * Math.sin(lambda * D2R));
  const y = Math.tan((eps / 2) * D2R) ** 2;
  const eqTime = 4 / D2R * (y * Math.sin(2 * L0 * D2R) - 2 * e * Math.sin(M * D2R) + 4 * e * y * Math.sin(M * D2R) * Math.cos(2 * L0 * D2R)
    - 0.5 * y * y * Math.sin(4 * L0 * D2R) - 1.25 * e * e * Math.sin(2 * M * D2R));
  const tst = ((localHours - p.utcOffset) * 60 + eqTime + 4 * p.longitude) % 1440;
  const ha = (tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180) * D2R;
  const lat = p.latitude * D2R;
  const cosZ = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  let az = Math.acos(Math.max(-1, Math.min(1, (Math.sin(lat) * Math.cos(zen) - Math.sin(decl)) / (Math.cos(lat) * Math.sin(zen)))));
  az = ha > 0 ? az + Math.PI : Math.PI - az; // from north, clockwise
  const alt = Math.PI / 2 - zen;
  // refraction lifts the sun near the horizon (~0.5 deg at 0), easing out smoothly between 1 and 4 degrees under it (a
  // time-lapse's sun never jumps)
  const altDeg = alt / D2R;
  const refr = refraction(altDeg);
  const a = (altDeg + refr) * D2R;
  const dir: V3 = [Math.cos(a) * Math.sin(az), Math.sin(a), -Math.cos(a) * Math.cos(az)];
  return { dir, altitude: altDeg + refr, azimuth: az / D2R };
}

/** the atmosphere's refraction at a true altitude (degrees, Saemundsson's), below -1 degree a cubic down to none at -4
 *  matching its value and slope there */
function refraction(h: number) {
  const R = (a: number) => 1.02 / Math.tan((a + 10.3 / (a + 5.11)) * D2R) / 60;
  if (h >= -1) return R(h);
  const x = (h + 4) / 3;
  return x <= 0 ? 0 : 0.6466 * (3 * x * x - 2 * x * x * x - 0.7777 * (x * x * x - x * x));
}

/** the moon's direction (Schlyter's elements with the main perturbations) and illuminated fraction */
export function moonPosition(p: Place, year: number, month: number, day: number, localHours: number) {
  const jd = julian(year, month, day, localHours - p.utcOffset);
  const d = jd - 2451543.5;
  const n360 = (x: number) => ((x % 360) + 360) % 360;
  const N = n360(125.1228 - 0.0529538083 * d) * D2R, i = 5.1454 * D2R, w = n360(318.0634 + 0.1643573223 * d) * D2R;
  const a = 60.2666, e = 0.0549, M = n360(115.3654 + 13.0649929509 * d) * D2R;
  let E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
  for (let k = 0; k < 5; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xv = a * (Math.cos(E) - e), yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const v = Math.atan2(yv, xv), r = Math.hypot(xv, yv);
  const xh = r * (Math.cos(N) * Math.cos(v + w) - Math.sin(N) * Math.sin(v + w) * Math.cos(i));
  const yh = r * (Math.sin(N) * Math.cos(v + w) + Math.cos(N) * Math.sin(v + w) * Math.cos(i));
  const zh = r * Math.sin(v + w) * Math.sin(i);
  const lon = Math.atan2(yh, xh), latE = Math.atan2(zh, Math.hypot(xh, yh));
  const ecl = (23.4393 - 3.563e-7 * d) * D2R;
  const xe = Math.cos(lon) * Math.cos(latE), ye = Math.sin(lon) * Math.cos(latE), ze = Math.sin(latE);
  const ra = Math.atan2(ye * Math.cos(ecl) - ze * Math.sin(ecl), xe);
  const dec = Math.asin(ye * Math.sin(ecl) + ze * Math.cos(ecl));
  const T = (jd - 2451545) / 36525;
  const gmst = n360(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T);
  const ha = (gmst + p.longitude) * D2R - ra;
  const lat = p.latitude * D2R;
  const alt = Math.asin(Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha) * Math.cos(dec), Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(ha));
  const Ms = n360(356.047 + 0.9856002585 * d) * D2R, ws = n360(282.9404 + 4.70935e-5 * d) * D2R;
  const elong = Math.acos(Math.cos(lon - (Ms + ws)) * Math.cos(latE));
  const dir: V3 = [Math.cos(alt) * Math.sin(az), Math.sin(alt), -Math.cos(alt) * Math.cos(az)];
  return { dir, illum: (1 - Math.cos(elong)) / 2 };
}

/** local sidereal time (degrees) */
export function localSidereal(p: Place, year: number, month: number, day: number, localHours: number) {
  const jd = julian(year, month, day, localHours - p.utcOffset);
  const T = (jd - 2451545) / 36525;
  const g = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T;
  return (((g + p.longitude) % 360) + 360) % 360;
}

/** equatorial unit vectors -> world (x east, y up, z south): the three basis columns for the shaders */
export function equatorialBasis(p: Place, year: number, month: number, day: number, localHours: number): [number, number, number, number][] {
  const lst = localSidereal(p, year, month, day, localHours);
  const lat = p.latitude * D2R;
  const toWorld = (raDeg: number, decDeg: number): [number, number, number, number] => {
    const ha = (lst - raDeg) * D2R, d = decDeg * D2R;
    const alt = Math.asin(Math.sin(d) * Math.sin(lat) + Math.cos(d) * Math.cos(lat) * Math.cos(ha));
    const az = Math.atan2(-Math.sin(ha) * Math.cos(d), Math.cos(lat) * Math.sin(d) - Math.sin(lat) * Math.cos(d) * Math.cos(ha));
    return [Math.cos(alt) * Math.sin(az), Math.sin(alt), -Math.cos(alt) * Math.cos(az), 0];
  };
  return [toWorld(0, 0), toWorld(90, 0), toWorld(0, 90)];
}

/** day of the year (0-based) <-> calendar date */
export function dayOfYear(year: number, month: number, day: number) {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86400000);
}
export function dateOf(year: number, doy: number) {
  const d = new Date(Date.UTC(year, 0, 1) + Math.floor(doy) * 86400000);
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dateLabel(year: number, doy: number) { const d = dateOf(year, doy); return `${MONTHS[d.month - 1]} ${d.day}`; }
