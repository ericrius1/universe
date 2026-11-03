// Time at the site: a date and a local clock time -> the sun, the moon, which of them lights the world, the night's
// darkness, the stars' rotation. Time-lapse runs both clocks.
import type { V3 } from '@ericrius1/weft';
import { sunPosition, moonPosition, equatorialBasis, dateOf, type Place } from './sun';

export interface ClockState {
  year: number;
  /** day of the year, 0 = Jan 1 (fractional while time-lapsing) */
  doy: number;
  /** local clock hours (0-24) */
  hour: number;
  /** time-lapse: clock hours per real second, days per real second */
  hourSpeed: number;
  daySpeed: number;
  /** the calendar day the sky shows, when it's held (the season, doy, moving on beneath it while the sun, the moon,
   *  the stars and the clouds' day stay on one day); else the day of the year's */
  day?: number;
}

/** the calendar day the sky shows (sun, moon, stars, the clouds' and the weather's day) */
export function skyDay(c: ClockState) { return Math.floor(c.day ?? c.doy); }

/** the moon's light at full, in the world's units of sunlight (the night is lifted into range: the exposure adapts) */
export const MOON_FULL = 0.12;

export function advance(c: ClockState, dt: number) {
  if (c.hourSpeed) {
    c.hour += c.hourSpeed * dt;
    while (c.hour >= 24) { c.hour -= 24; c.doy += 1; }
    while (c.hour < 0) { c.hour += 24; c.doy -= 1; }
  }
  if (c.daySpeed) c.doy += c.daySpeed * dt;
  c.doy = ((c.doy % 365) + 365) % 365;
}

export function skyState(c: ClockState, place: Place) {
  const { month, day } = dateOf(c.year, skyDay(c));
  const sun = sunPosition(place, c.year, month, day, c.hour);
  const moon = moonPosition(place, c.year, month, day, c.hour);
  const eq = equatorialBasis(place, c.year, month, day, c.hour);
  const night = smooth(-0.03, -0.2, sun.dir[1]);
  // the moon's light (its phase: a crescent is a few per cent of the full moon), for the sky it lights and the land
  const moonLight = MOON_FULL * Math.pow(moon.illum, 3);
  const moonScale = moonLight * smooth(-0.04, 0.06, moon.dir[1]);
  // (the sky it lights, left out by day when nothing of it can be seen)
  const moonSky = moonLight * (1 - smooth(2, 6, sun.altitude));
  // the key light: the sun until it's well down (its light gone even from the highest clouds), then the moon if it's up,
  // its light coming in as the twilight fades (the sky still outshines it there: the hand-over can't be seen) — a
  // moonlit sky is a dim blue day
  const sunKey = sun.altitude > -4;
  const key = sunKey ? { dir: sun.dir, scale: 1, moon: false } : { dir: moon.dir as V3, scale: Math.max(moonScale * smooth(-4, -9, sun.altitude), 1e-6), moon: true };
  return { month, day, utcOffset: place.utcOffset, sun, moon, moonSky, key, night, eq };
}

function smooth(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export interface AuroraSettings {
  /** strength (0: none) and the share of clear nights that have one (1: every night, as set here); the veil by day (0
   *  none .. 1 as strong as the night's: high in the sky, soft, its rays smoothed away) */
  intensity: number; frequency: number; day: number;
  /** how far south the arcs come (0 low on the northern horizon .. 1 overhead), their height (x), how fast they move
   *  (x), how often they surge (substorms, x), the rays' contrast, the folds, the sheets' thickness (km: soft folds) */
  reach: number; height: number; speed: number; surges: number; rays: number; folds: number; thickness: number;
  /** the colours, from the hem up: the lower edge, the body, the band above it, the crown at the top; and the hem's flare
   *  in a surge */
  teal: Rgb; green: Rgb; violet: Rgb; crown: Rgb; hem: Rgb;
}
type Rgb = { r: number; g: number; b: number };

/** the show's palette (art/BIBLE.md; refs 6, 7, 8): a teal hem (#4FE0C0), a green body, violet above (#8E5CE0), a
 *  magenta crown (#D46BD8), the surge's hem flaring pink — linear light */
const HAVENS = {
  teal: { r: 0.08, g: 0.75, b: 0.53 }, green: { r: 0.12, g: 0.95, b: 0.36 }, violet: { r: 0.27, g: 0.11, b: 0.75 },
  crown: { r: 0.66, g: 0.15, b: 0.69 }, hem: { r: 0.95, g: 0.3, b: 0.8 },
};
/** the earth's: oxygen green, violet-magenta above, oxygen red at the top, the nitrogen fringe pink */
const EARTH = {
  teal: { r: 0.1, g: 1.0, b: 0.3 }, green: { r: 0.1, g: 1.0, b: 0.3 }, violet: { r: 0.55, g: 0.16, b: 1.0 },
  crown: { r: 1.0, g: 0.07, b: 0.14 }, hem: { r: 1.0, g: 0.2, b: 0.55 },
};

/** the default: every night has one, well up in the north, now and then a strong one, a veil of it by day (the Seven
 *  Havens' sky: its aurora is the world's signature) — broad soft ribbons in the show's colours */
export const AURORA_DEFAULT: AuroraSettings = {
  intensity: 1.2, frequency: 1, day: 0.4, reach: 0.62, height: 1, speed: 1, surges: 1, rays: 0.4, folds: 1.35, thickness: 48, ...HAVENS,
};

export const AURORA_PRESETS: Record<string, Partial<AuroraSettings>> = {
  'every night': AURORA_DEFAULT,
  // the show's storm: bright curtains coming overhead, surging often, the day's veil strong
  'havens storm': { ...AURORA_DEFAULT, intensity: 1.6, day: 0.5, reach: 0.86, height: 1.15, speed: 1.15, surges: 1.6, rays: 0.7, folds: 1.6, thickness: 34 },
  // the city at night (concept_city_night): emerald curtains with violet and magenta crowns, rayed
  'emerald': { ...AURORA_DEFAULT, intensity: 1.35, reach: 0.72, height: 1.2, rays: 1.0, folds: 1.2, thickness: 34, teal: { r: 0.05, g: 0.9, b: 0.4 }, green: { r: 0.05, g: 1.0, b: 0.25 } },
  // a faint homogeneous arc, barely moving
  'quiet arc': { ...AURORA_DEFAULT, intensity: 0.6, day: 0.15, reach: 0.45, height: 0.85, speed: 0.4, surges: 0.25, rays: 0.3, folds: 0.35, thickness: 75 },
  // a once-in-centuries storm: curtains overhead
  'overhead curtains': { ...AURORA_DEFAULT, intensity: 1.4, reach: 0.92, height: 1.05, speed: 1, surges: 1.2, rays: 1.1, folds: 1.3, thickness: 26 },
  // for films: high and vivid, surging every minute or two
  'showcase': { ...AURORA_DEFAULT, intensity: 1.1, day: 0.6, reach: 0.8, height: 1.15, speed: 1.1, surges: 1.6, rays: 0.6, folds: 1.5, thickness: 34 },
  // the earth's colours: a big storm seen from the low latitudes (as May and October 2024), a red glow high in the north
  'earthly': { ...AURORA_DEFAULT, ...EARTH, intensity: 1.1, day: 0, reach: 0.5, height: 1.3, speed: 0.9, surges: 1, rays: 1, folds: 0.9, thickness: 40 },
  'off': { intensity: 0 },
};
