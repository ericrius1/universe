// The light of Seven Havens over the day (art/BIBLE.md, 'Light over the day'): what the air holds hour by hour, and
// the exposure an eye settles on in each light. The air: the desert's dust pooled low and cool in the canyons at dawn,
// lifting and thickening through the day into the afternoon's golden haze, settling after dark (atmosphere.wgsl's
// dust layer: its density over the canyon floor and its scale height); a teal sky (the Rayleigh scattering's
// havens-ness); the moon's sky and light as the eye takes them, navy and blue-violet. The exposure: a level white card
// mapped to the screen — by day near the top of the range without washing noon out, at golden hour a touch brighter so
// it glows, by night far down (dark enough that a lantern sings) but not so far the land and the cast don't read.
import type { V3 } from '@ericrius1/weft';
import type { Air } from './atmosphere';

/** the look's knobs (the panel's 'air' and 'exposure' folders) */
export interface Daylight {
  /** the sky's havens-ness: 0 the earth's blue .. 1 the other Boulder's sea green */
  havens: number;
  /** the dust, times the day's own (0 clear air) */
  dust: number;
  /** the painted sky: the dome's brightness with the sun well up (times the air's own: 1 as the air makes it), and its
   *  light on the land (the sky's ambient, times the air's own) */
  sky: number;
  skyLight: number;
  /** the clouds as painted: how bright their lit sides are with the sun well up (times the air's own light) */
  clouds: number;
  /** a white card's place on the screen by day (pre-tone-map: 1 is white) and by a moonlit night */
  dayCard: number;
  nightCard: number;
}

export const DAYLIGHT_DEFAULT: Daylight = { havens: 0.75, dust: 1, sky: 8, skyLight: 1.3, clouds: 2.4, dayCard: 0.5, nightCard: 0.065 };

/** the dust through the day: [hour, density over the canyon floor (/km), scale height (km)] — the night's settled
 *  layer; dawn's shallow and pooled; the morning's lifting; the afternoon's deep golden haze */
const DUST: [number, number, number][] = [
  [0, 0.09, 0.55], [4.5, 0.09, 0.4], [6.2, 0.12, 0.25], [8.5, 0.1, 0.55], [12, 0.12, 0.95], [15, 0.15, 1.25],
  [18, 0.18, 1.4], [20, 0.13, 1.0], [24, 0.09, 0.55],
];

/** the dust's colour: the light it scatters (its albedo by channel — it takes the blues) */
const DUST_COLOR: V3 = [1.0, 0.76, 0.45];
/** the moon's sky as the eye takes it (its light in the air, the sky's ambient): navy toward indigo */
const NIGHT_SKY: V3 = [0.45, 0.55, 1.5];
/** the painted dome's lean with the sun high: toward the show's teal-green; and the sky's light on the land's: toward
 *  lavender (the shadows on the red rock go violet: blue over red, so on the red stone they deepen toward maroon and
 *  violet, not toward crimson) */
const TEAL: V3 = [0.82, 1.0, 0.8];
const LAVENDER: V3 = [1.12, 1.0, 1.36];
/** the twilight's lean, the sun just under the horizon either side of the night: brighter, and magenta toward violet
 *  (the dawn's pink and lavender, the dusk's magenta and violet) */
const TWILIGHT: V3 = [1.9, 1.0, 1.7];
/** golden hour's lean: rose (between the sun's amber and the teal overhead a painter goes through peach and lavender,
 *  never the olive the two would mix to) */
const GOLDEN: V3 = [1.14, 0.92, 1.08];
/** the haze over the land with the sun low (the gain on its light scattered in the air between the eye and the ground):
 *  the morning's cool, lavender, the dust pooled in the canyons blue-violet; the evening's gold (the dust's own colour,
 *  not the rose the painted dome leans to then) */
const HAZE_DAWN: V3 = [0.72, 0.84, 1.24];
const HAZE_GOLDEN: V3 = [1.04, 1.0, 0.84];
/** the sky's light on the land with the sun low, on top of the lavender: the dawn's shadows lilac (the twilight's pink in
 *  the sky's light would turn the red rock in them pink), the evening's a little cooler under the gold */
const SHADE_DAWN: V3 = [0.62, 0.84, 1.5];
const SHADE_GOLDEN: V3 = [0.94, 0.96, 1.12];
/** the clouds' shaded sides and bellies: lavender by day, more so toward a low sun */
const BELLY_DAY: V3 = [1.04, 0.94, 1.16];
const BELLY_LOW: V3 = [1.12, 0.86, 1.3];

/** the air at an hour, the sun at an altitude (degrees): the painted dome brightest with the sun well up, as the air
 *  makes it once the sun is down (the twilight's own colours) */
export function airAt(hour: number, sunAlt: number, d: Daylight): Air {
  const h = ((hour % 24) + 24) % 24;
  let k = 0;
  while (k < DUST.length - 2 && DUST[k + 1][0] <= h) k++;
  const a = DUST[k], b = DUST[k + 1], f = (h - a[0]) / (b[0] - a[0]), s = f * f * (3 - 2 * f);
  // (the dome brightest and greenest with the sun high; toward a low sun the air's own colours, the gold and amber)
  const up = smooth(5, 45, sunAlt), g = smooth(-2, 35, sunAlt), tw = smooth(-16, -6, sunAlt) * (1 - smooth(-2, 4, sunAlt));
  const gold = smooth(-1, 5, sunAlt) * (1 - smooth(12, 24, sunAlt));
  // (the deep twilight, its glow sunk under the rims: lifted, so the dusk over the canyon stays violet a while)
  const deep = smooth(-15, -9, sunAlt) * (1 - smooth(-6, -2, sunAlt));
  const paint = TEAL.map((c, i) => (1 + (d.sky - 1) * up) * (1 + (c - 1) * g) * (1 + (TWILIGHT[i] - 1) * tw) * (1 + (GOLDEN[i] - 1) * gold) * (1 + 1.5 * deep)) as V3;
  const lit = smooth(-6, 10, sunAlt);
  const low = smooth(-6, 2, sunAlt) * (1 - smooth(10, 22, sunAlt));
  const morning = h < 12;
  const shade = LAVENDER.map((c, i) => (1 + (d.skyLight * c - 1) * lit) * (1 + ((morning ? SHADE_DAWN : SHADE_GOLDEN)[i] - 1) * low)) as V3;
  const haze = (morning ? HAZE_DAWN : HAZE_GOLDEN).map((c) => 1 + (c - 1) * low) as V3;
  return {
    havens: d.havens, dust: (a[1] + (b[1] - a[1]) * s) * d.dust, dustHeight: a[2] + (b[2] - a[2]) * s,
    dustColor: DUST_COLOR, night: NIGHT_SKY, paint, farKm: 10, shade, haze,
  };
}

/** how the clouds are painted with the sun at an altitude (degrees): their lit sides brighter than the air would light
 *  them, as the dome is (by night as they are), their shaded sides and bellies lavender, deepest at golden hour */
export function cloudPaintAt(sunAlt: number, d: Daylight) {
  const up = smooth(-4, 20, sunAlt), low = smooth(-6, 2, sunAlt) * (1 - smooth(8, 25, sunAlt));
  const belly = BELLY_DAY.map((c, i) => 1 + (c + (BELLY_LOW[i] - c) * low - 1) * smooth(-6, 0, sunAlt)) as V3;
  return { lit: 1 + (d.clouds - 1) * up, shade: 1 + (d.clouds * 0.7 - 1) * up, belly };
}

function smooth(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** a level white card's value on the screen (before the tone map) in light E (its radiance: irradiance over pi, in the
 *  world's units of sunlight), by how dark it is (0 day .. 1 full night). By day the card rises only slowly with the
 *  light (noon isn't a white sheet, an overcast isn't grey mush); by night a full moon's card sits a few stops under
 *  the day's and a moonless night's lower still */
export function cardFor(E: number, night: number, d: Daylight) {
  const day = d.dayCard * Math.pow(E / 0.3, 0.14);
  const dark = d.nightCard * Math.pow(E / 0.012, 0.16);
  return Math.exp(Math.log(day) * (1 - night) + Math.log(dark) * night);
}
