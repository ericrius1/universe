// Windows: any stretch of the zoom, opened by itself. A window is a top and a bottom on the zoom (log10 of the view
// distance in metres, either open), a name and a line for it, and where it starts. It loads only the realms whose bands
// meet it (their code, their data, their GPU targets), so it opens fast and runs on smaller devices, and can be handed to
// someone as one piece: ?w=solar, or any stretch by hand, ?from=17&to=8.5. The whole universe is just the widest window,
// and is the one with no query. From any window the zoom can be let out to everything (App.expand), which loads the rest
// behind it.

/** a realm: one part of the zoom, built only if the window needs it (main.ts's realms) */
export type RealmId = 'beyond' | 'web' | 'galaxy' | 'local' | 'solar' | 'earth' | 'ground' | 'gardens' | 'cell' | 'well';
/** the two ways down from the Earth: the main line's, to Seven Havens and on into the cell, and the well's, through
 *  San Francisco's fog to a plate of liver cells on a lab bench (lab/way.ts) */
export type Way = 'havens' | 'well';
/** the realms below the fork that are on one way only (the rest are on both) */
export const WAY_OF: Partial<Record<RealmId, Way>> = { ground: 'havens', gardens: 'havens', cell: 'havens', well: 'well' };

/** where each realm shows on the zoom (log10 m): from `top` down to `bottom`, where its weight is above nothing. From the
 *  levels' own bands (cosmos/levels/*: their Band's a and d, the widest of a level's parts), the gardens' (gardens.ts
 *  BAND) and the cell's (below the cosmos's camera's `min`, where the cell takes over) */
export const REALM_BANDS: Record<RealmId, [number, number]> = {
  // (past the edge of the observable universe: levels/beyond.ts, 0 by 26.97)
  beyond: [Infinity, 26.97],
  // (the cosmic web and the microwave background: levels/web.ts, the points to 21.2)
  web: [Infinity, 21.2],
  // (the Milky Way and the Sun's neighbours: behind everything below them, the stars over the meadow at night)
  galaxy: [23.6, -Infinity],
  local: [20.6, -Infinity],
  // (the Sun, its planets and its belts: levels/solar.ts)
  solar: [17.6, 5.9],
  // (the Earth, its air and its ground's data: levels/earth.ts)
  earth: [10.4, 4.6],
  // (the meadow and whoever lies there, down to the cornea's cells: levels/surface.ts, figure/figure.ts)
  ground: [4.9, -3.8],
  // (Seven Havens' gardens: gardens.ts BAND)
  gardens: [4.4, -3.8],
  cell: [-3.8, -Infinity],
  // (the well: from where the fog starts closing over San Francisco down among one liver cell's organelles: lab/way.ts)
  well: [4.75, -6.3],
};
/** below this, on the well's way, the fog covers the frame (lab/way.ts FOG_CLOSE): nothing behind it is seen */
export const FOG_COVER = 4.05;
/** where the cell takes the camera (cosmos/controls.ts min) */
export const CELL_TOP = -3.8;
/** below this, the gardens cover the frame (gardens.ts BAND's b): nothing behind them is seen */
export const GARDENS_COVER = 3.7;

export interface ZoomWindow {
  id: string;
  name: string;
  line: string;
  /** the top and bottom of the zoom (log10 m; null: open, as far as the zoom goes) */
  top: number | null;
  bottom: number | null;
  /** where it starts (log10 m; at or below CELL_TOP, in the cell: `place` says where) */
  start: number;
  /** in the cell, the place it starts at */
  place?: string;
  /** the one way down it's on, if it's on one (below the fork: windows.ts Way); none, both */
  way?: Way;
}

export const WINDOWS: ZoomWindow[] = [
  { id: 'universe', name: 'Universe', line: 'From the edge of everything to the inside of a cell.', top: null, bottom: null, start: 26.95 },
  // (to the edge of the observable universe, short of the keepers' world past it; down to the nearest stars, short of
  // where the solar system's belts come in)
  { id: 'cosmos', name: 'The cosmos', line: 'The observable universe, the cosmic web, the Milky Way, the nearest stars.', top: 26.97, bottom: 17.6, start: 26.95 },
  // (from the Oort cloud's outer reach down to the Earth and the Moon round it)
  { id: 'solar', name: 'The solar system', line: 'From the Oort cloud to the Earth and the Moon, every planet where it is today.', top: 17.2, bottom: 7.0, start: 13.0 },
  { id: 'earth', name: 'The Earth', line: 'Home, the Moon where it is tonight, down to a few kilometres up.', top: 9.9, bottom: 4.9, start: 7.35 },
  // (from where the gardens fill the frame down to her eye, short of the cornea's cells)
  { id: 'havens', name: 'Seven Havens', line: 'A walled city in a red canyon, and someone lying in its flowers.', top: GARDENS_COVER, bottom: -2.2, start: 3.5, way: 'havens' },
  { id: 'cell', name: 'The cell', line: 'A human cell from the outside in, down to its molecules.', top: CELL_TOP, bottom: null, start: CELL_TOP, place: 'tissue', way: 'havens' },
  // (from a couple of metres over the bench, where the fog has gone, down among the organelles of one cell)
  { id: 'hepatocyte', name: 'A well of liver cells', line: 'Human liver cells growing in a plate on a lab bench, from a metre up to inside one.', top: 0.3, bottom: -6.3, start: -0.2, way: 'well' },
];
export const UNIVERSE = WINDOWS[0];

/** the window a page's query asks for: ?w=<id>, or ?from=<log10 m>&to=<log10 m> (either end may be left off), else the
 *  whole universe */
export function windowOf(q: URLSearchParams): ZoomWindow {
  const byId = WINDOWS.find((w) => w.id === q.get('w'));
  if (byId) return byId;
  const num = (k: string) => { const v = q.get(k); return v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v); };
  const a = num('from'), b = num('to');
  if (a === null && b === null) return UNIVERSE;
  const top = a !== null && b !== null ? Math.max(a, b) : a, bottom = a !== null && b !== null ? Math.min(a, b) : b;
  // (it starts a little inside its top, or where the whole universe does if that's in it)
  const start = top === null ? UNIVERSE.start : top <= CELL_TOP ? top : Math.min(UNIVERSE.start, top - 0.2);
  const fmt = (x: number | null) => (x === null ? '…' : String(x));
  return { id: 'custom', name: 'Universe', line: `From 10^${fmt(top)} m to 10^${fmt(bottom)} m.`, top, bottom, start: bottom !== null ? Math.max(bottom, start) : start, place: top !== null && top <= CELL_TOP ? 'tissue' : undefined };
}

/** whether a stretch of the zoom [top, bottom] meets the window (strictly: a realm whose weight is nothing at the
 *  window's edge isn't in it) */
export const meets = (w: ZoomWindow, [top, bottom]: [number, number]) => top > (w.bottom ?? -Infinity) && bottom < (w.top ?? Infinity);
/** whether a zoom is in the window */
export const inWindow = (w: ZoomWindow, l: number, slack = 0) => l <= (w.top ?? Infinity) + slack && l >= (w.bottom ?? -Infinity) - slack;
/** the whole universe (no end to it) */
export const whole = (w: ZoomWindow) => w.top === null && w.bottom === null;
