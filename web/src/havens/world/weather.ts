// The day's weather over the site: a high-desert climatology (how often each sky comes in each month) picks each
// day's sky from a hash of the date, and a recipe turns that kind into clouds — layers (their height, cover,
// thickness, texture), a field of cumulus that builds over the plateau through the afternoon, thunderstorms,
// lenticular wave clouds over the high ground west — and the wind aloft. The same date always gets the same sky.
// (From boulder, its Colorado climatology swapped for the Seven Havens': mostly fair — clear, a few painted heaps, a
// mackerel sky — the storms rare, never grey for long.)
//   clear              nothing
//   fair cumulus       small heaps from late morning, born over the plateau, drifting on with the wind
//   towering cumulus   bigger, taller heaps; a few trail virga
//   thunderstorm       towering cumulus and a few cumulonimbus with anvils and rain shafts, the monsoon's afternoons
//   stratocumulus      a low lumpy deck, grey bases, gaps of blue
//   altocumulus        a mid-level mackerel sky of small cloudlets
//   cirrus             mares' tails high up, streaked along the wind
//   chinook            lenticular stacks standing over the high ground and a wave-cloud deck to the west ending in a
//                      clean line, with clear sky beneath
//   overcast           a low grey lid over the canyon
//   altostratus        a thin grey veil, a watery sun through it

export const SKY_KINDS = ['clear', 'fair cumulus', 'towering cumulus', 'thunderstorm', 'stratocumulus', 'altocumulus', 'cirrus', 'chinook', 'overcast', 'altostratus'] as const;
export type SkyKind = typeof SKY_KINDS[number];

/** a layer: m above the site's ground; tau the optical depth at full density; scale the noise tile (m); lumpy 0 smooth
 *  sheet .. 1 separate cells; streak 0 .. 1 fibres along the wind; halo a 22-degree ring (cirrostratus); band the
 *  deck only east of [edge (m east), feather (m)]: the chinook arch, the clear slot over the mountains west of it */
export interface LayerSpec { cover: number; base: number; thick: number; tau: number; scale: number; lumpy: number; streak: number; halo: number; band?: [number, number] }
/** the cumulus field: cover (clouds per cell), base (m above the site), size (m across), tall (height over width),
 *  hours the first ones form and the last die, how strongly they favour the plateau, the share that trail virga,
 *  their darkness */
export interface CumulusSpec { cover: number; base: number; size: number; tall: number; start: number; end: number; plateau: number; virga: number; dark: number }
/** storms: how many, their base and top (m above the site), the hours they're born between */
export interface StormSpec { count: number; base: number; top: number; start: number; end: number }
export interface LensSpec { count: number; base: number }
export type DeckSlot = 'low' | 'mid' | 'high' | 'wave';
export interface Recipe {
  kind: SkyKind;
  low: LayerSpec | null; mid: LayerSpec | null; high: LayerSpec | null; wave: LayerSpec | null;
  cumulus: CumulusSpec | null; storms: StormSpec | null; lenses: LensSpec | null;
  /** wind aloft: m/s and the direction it blows from (degrees, 270 = from the west) */
  wind: number; windFrom: number;
  /** the clouds' overall brightness from below (their diffuse transmittance, for the ground's light) */
  brightness: number;
}

/** weights per month (Jan..Dec) for each kind, in SKY_KINDS order: the Seven Havens' — clear or a few fair heaps most
 *  days, a mackerel sky or mares' tails now and then, a summer's towering afternoon, a storm or a grey lid rarely */
const CLIMATE: number[][] = [
  // clear fair tower storm  Sc  Ac  Ci chin  ovc  As
  [34, 22, 0, 0, 2, 18, 18, 4, 0, 2],
  [32, 24, 0, 0, 2, 18, 18, 4, 0, 2],
  [30, 28, 2, 0, 2, 18, 16, 3, 0, 1],
  [30, 30, 4, 0, 1, 18, 14, 2, 0, 1],
  [30, 32, 6, 1, 1, 16, 12, 1, 0, 1],
  [30, 34, 8, 2, 1, 14, 10, 0, 0, 1],
  [26, 34, 12, 4, 1, 14, 8, 0, 0, 1],
  [26, 34, 12, 4, 1, 14, 8, 0, 0, 1],
  [30, 34, 6, 1, 1, 16, 10, 0, 0, 1],
  [32, 28, 2, 0, 2, 18, 14, 2, 0, 2],
  [34, 24, 0, 0, 2, 18, 16, 4, 0, 2],
  [34, 22, 0, 0, 2, 18, 18, 4, 0, 2],
];

/** a small seeded generator (mulberry32) */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const daySeed = (year: number, day: number, salt: number) => (Math.imul(year, 2654435761) ^ Math.imul(day + 1, 40503) ^ Math.imul(salt + 7, 83492791)) >>> 0;

/** the kind of sky on a day of the year (0-based), from the climatology between the months either side */
export function dailyKind(year: number, day: number, salt = 0): SkyKind {
  // (two days in a row are often alike: the weather comes in spells — a third of the days keep yesterday's)
  const r = rng(daySeed(year, day, salt) ^ 0x2545f491);
  return pickKind(year, r() < 0.33 ? day - 1 : day, salt);
}
function pickKind(year: number, day: number, salt: number): SkyKind {
  const m = ((day / 365) * 12 - 0.5 + 12) % 12, m0 = Math.floor(m), f = m - m0;
  const w = CLIMATE[m0].map((v, i) => v * (1 - f) + CLIMATE[(m0 + 1) % 12][i] * f);
  let x = rng(daySeed(year, day, salt))() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) { x -= w[i]; if (x <= 0) return SKY_KINDS[i]; }
  return 'clear';
}

/** summer's convection: 0 in winter .. 1 in July (the cumulus base rises, the heaps grow taller) */
const summer = (day: number) => 0.5 - 0.5 * Math.cos(((day - 15) / 365) * Math.PI * 2);

/** the clouds for a kind of sky, varied by the day's seed */
export function recipe(kind: SkyKind, seed: number, day: number): Recipe {
  const r = rng(seed ^ 0x9e3779b9);
  const between = (a: number, b: number) => a + (b - a) * r();
  const s = summer(day);
  const out: Recipe = { kind, low: null, mid: null, high: null, wave: null, cumulus: null, storms: null, lenses: null, wind: between(6, 13), windFrom: between(245, 300), brightness: 0.5 };
  const cirrus = (cover: number): LayerSpec => ({ cover, base: between(6500, 9000), thick: between(300, 700), tau: between(0.08, 0.35), scale: between(10000, 16000), lumpy: 0, streak: 1, halo: 0 });
  const cuBase = 1500 + 900 * s + between(-200, 250);
  switch (kind) {
    case 'clear': break;
    case 'fair cumulus':
      out.cumulus = { cover: between(0.45, 0.85), base: cuBase, size: between(900, 1600), tall: between(0.45, 0.75), start: between(10.3, 11.8), end: between(18.6, 19.8), plateau: between(0.5, 0.85), virga: 0, dark: 0.1 };
      if (r() < 0.35) out.high = cirrus(between(0.15, 0.4));
      out.brightness = 0.55;
      break;
    case 'towering cumulus':
      out.cumulus = { cover: between(0.4, 0.7), base: cuBase, size: between(1300, 2200), tall: between(0.9, 1.5), start: between(10.2, 11.4), end: between(18.5, 20), plateau: between(0.55, 0.9), virga: between(0.1, 0.3), dark: 0.3 };
      if (r() < 0.3) out.mid = { cover: between(0.2, 0.4), base: between(3600, 4800), thick: 250, tau: between(1.5, 3.5), scale: between(2600, 3800), lumpy: 1, streak: 0, halo: 0 };
      out.brightness = 0.45;
      break;
    case 'thunderstorm':
      out.cumulus = { cover: between(0.5, 0.85), base: cuBase, size: between(1000, 1600), tall: between(0.8, 1.4), start: between(10.2, 11.2), end: between(19, 21), plateau: between(0.6, 0.9), virga: between(0.15, 0.35), dark: 0.35 };
      out.storms = { count: Math.round(between(2, 4.6)), base: cuBase - 150, top: between(8500, 10500), start: between(13, 14.5), end: between(19.5, 22) };
      out.high = { ...cirrus(between(0.2, 0.45)), base: between(8000, 9500) };
      out.wind = between(7, 12);
      out.brightness = 0.35;
      break;
    case 'stratocumulus':
      out.low = { cover: between(0.6, 0.95), base: between(800, 1700), thick: between(450, 800), tau: between(8, 16), scale: between(9000, 14000), lumpy: between(0.75, 1), streak: 0, halo: 0 };
      out.brightness = 0.32;
      break;
    case 'altocumulus':
      out.mid = { cover: between(0.3, 0.55), base: between(3200, 5200), thick: between(150, 300), tau: between(2, 5), scale: between(3500, 6000), lumpy: 1, streak: between(0, 0.25), halo: 0 };
      if (r() < 0.4) out.high = cirrus(between(0.2, 0.5));
      out.brightness = 0.55;
      break;
    case 'cirrus':
      out.high = cirrus(between(0.3, 0.75));
      if (r() < 0.3) out.high.halo = between(0.5, 1);
      out.wind = between(15, 35);
      out.brightness = 0.85;
      break;
    case 'chinook':
      out.lenses = { count: Math.round(between(2, 5.4)), base: between(3200, 5600) };
      out.wave = { cover: between(0.85, 1), base: between(3600, 4600), thick: between(500, 900), tau: between(5, 10), scale: between(14000, 22000), lumpy: between(0.2, 0.45), streak: between(0.25, 0.5), halo: 0, band: [between(-3160, 3340), between(900, 2200)] };
      if (r() < 0.5) out.high = cirrus(between(0.2, 0.45));
      out.wind = between(20, 32); out.windFrom = between(260, 290);
      out.brightness = 0.6;
      break;
    case 'overcast':
      out.low = { cover: 1, base: between(250, 1000), thick: between(800, 1500), tau: between(16, 32), scale: between(10000, 16000), lumpy: between(0.2, 0.4), streak: 0, halo: 0 };
      // (upslope: the wind comes from the plains)
      out.wind = between(3, 8); out.windFrom = between(40, 100);
      out.brightness = 0.26;
      break;
    case 'altostratus':
      out.mid = { cover: between(0.9, 1), base: between(3500, 5000), thick: 1000, tau: between(2.5, 5.5), scale: between(16000, 24000), lumpy: between(0.05, 0.2), streak: between(0, 0.3), halo: 0 };
      if (r() < 0.3) out.low = { cover: between(0.25, 0.5), base: between(1000, 1800), thick: 400, tau: between(3, 6), scale: between(9000, 14000), lumpy: 0.85, streak: 0, halo: 0 };
      out.brightness = 0.42;
      break;
  }
  return out;
}
