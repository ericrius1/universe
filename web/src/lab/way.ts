// The second way down from the Earth: to a lab bench in San Francisco and a plate of liver cells on it (lab/lab.ts
// draws it, with Hepatocyte's own code: src/well). What the rest of the page needs to know of it without its code: where
// it is, where its fog closes and opens, how the camera looks down as it goes, and its places. Small, and in the page's
// own chunk; the well's code is fetched only when a window takes it in (windows.ts, realms.ts).
//
// Between the Earth seen from a few kilometres up and the bench at a metre nothing is modelled, and the page doesn't
// pretend otherwise: the way down goes through San Francisco's fog, a white-out that closes above about ten kilometres
// and opens a few metres over the bench, and the way back up goes through it again.
import type { Place } from '../cosmos/frames';
import type { CosmosPlace } from '../cosmos/places';

/** where on Earth: a lab bench in San Francisco, a few metres up in a building near the sea */
export const BENCH: Place = { lat: 37.77, lon: -122.42, name: 'A lab bench in San Francisco', km: 0.016 };

/** the fog over the zoom (log10 m): it starts closing at CLOSE[0], it's white from CLOSE[1] down to OPEN[0], and it's
 *  gone by OPEN[1], a couple of metres over the bench */
export const FOG_CLOSE: [number, number] = [4.75, 4.05];
export const FOG_OPEN: [number, number] = [0.9, 0.28];
/** the bottom of the way: among the organelles of one cell, half a micrometre from the camera's target */
export const WELL_BOTTOM = -6.3;

const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
/** how white the fog is at a zoom (0 clear, 1 nothing else seen) */
export function fogAt(l: number) {
  return (1 - smooth((l - FOG_CLOSE[1]) / (FOG_CLOSE[0] - FOG_CLOSE[1]))) * smooth((l - FOG_OPEN[1]) / (FOG_OPEN[0] - FOG_OPEN[1]));
}

/** how far the view looks down at a zoom (rad, the camera's pitch with nothing of the visitor's in it): steeply into the
 *  bore from over the bench, flattening over the sheet of cells, nearly level inside one (Hepatocyte's host.ts), and how
 *  far the visitor can tilt it from that: a little down the bore, where the plastic's in the way, more out in the open */
// (over the sheet of cells, where the picture is a microscope's, the view stays looking nearly straight down at it as a
// microscope does, and tilts up into the oblique only as the modelled view takes over, a few cells across)
const PITCH: [number, number, number][] = [
  [1, -0.85, 0.65], [0, -0.85, 0.65], [-1.1, -1.25, 0.3], [-1.3, -1.32, 0.1], [-2.6, -1.38, 0.1], [-3.6, -1.3, 0.2],
  [-4.2, -0.7, 0.45], [-4.7, -0.42, 0.6], [-6.3, -0.25, 0.6],
];
function along(l: number, k: 1 | 2) {
  if (l >= PITCH[0][0]) return PITCH[0][k];
  for (let i = 0; i < PITCH.length - 1; i++) {
    const a = PITCH[i], b = PITCH[i + 1];
    if (l <= a[0] && l >= b[0]) { const t = (a[0] - l) / (a[0] - b[0]); return a[k] + (b[k] - a[k]) * t * t * (3 - 2 * t); }
  }
  return PITCH[PITCH.length - 1][k];
}
export const pitchAt = (l: number) => along(l, 1);
export const tiltAt = (l: number) => along(l, 2);

/** the way's places, as the dock and the intros know places above the cell (the bench is 'u:bench', the rest start 'u:well') */
const place = (id: string, name: string, short: string, logS: number, line: string, size: string): CosmosPlace =>
  ({ id, name, short, logS, yaw: 0.5, pitch: pitchAt(logS), line, size });
export const WELL_PLACES: CosmosPlace[] = [
  place('u:bench', BENCH.name, 'Lab bench', 0, 'A plate of human liver cells, ninety-six wells, a different dose in each.', '1 m'),
  place('u:well-plate', 'Down a well', 'A well', -1.6, 'Each well a few millimetres across, a pool of medium over a floor of cells.', '3 cm'),
  place('u:well-cells', 'A field of liver cells', 'The cells', -3.6, 'Human hepatocytes in a sheet, their canaliculi glowing between them.', '250 µm'),
  place('u:well-cell', 'Inside a liver cell', 'Inside one', -5.6, 'Mitochondria, lipid droplets and the nucleus, at work.', '3 µm'),
];
/** whether a place above the cell is on the well's way (else on the main line's, or on both above the fork) */
export const onWellWay = (id: string) => id === 'u:bench' || id.startsWith('u:well');
