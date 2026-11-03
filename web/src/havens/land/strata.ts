// The strata: one table of the canyon's rock layers from the floor up, the same everywhere (they lie flat), turned
// into a terrace function T that maps a smooth "base height" to the stepped ground. Going up a wall the base height
// rises steadily; T holds it nearly flat across a bench (the top of a hard bed), lets it climb a scree slope (the soft
// bed above, concave at its foot), then shoots it up a cliff (the next hard bed). So every canyon wall, butte and
// hoodoo steps at the same heights, and the ground shader's colour bands (by height) line up with the benches.
// T is piecewise linear over knots (continuous, so the GPU and the CPU never land on different steps), and so is its
// inverse, which the promontory uses to start a stepped cliff exactly at a garden's edge. Knots are f32-rounded so
// the WGSL copy (tables.wgsl, generated) holds the same numbers.

/** a segment of the profile: what it is, how much height it takes and how much base height (its width at slope 1) */
type Kind = 0 | 1 | 2;   // 0 bench, 1 scree (soft bed: a concave slope), 2 cliff
const BENCH = 0, SCREE = 1, CLIFF = 2;
const LOW: [Kind, number, number][] = [
  // the floor's apron, then six hard beds with their benches up to the plateau's caprock
  [SCREE, 8, 24],
  [CLIFF, 16, 2.0], [BENCH, 0.6, 16], [SCREE, 6.4, 6],
  [CLIFF, 19, 2.2], [BENCH, 0.5, 11], [SCREE, 5.5, 5],
  [CLIFF, 17, 2.0], [BENCH, 0.5, 9], [SCREE, 6.5, 6],
  [CLIFF, 24, 2.6], [BENCH, 0.6, 18], [SCREE, 5.4, 5],
  [CLIFF, 17, 2.0], [BENCH, 0.5, 10], [SCREE, 6.5, 6],
  [CLIFF, 16, 1.9], [BENCH, 0.5, 12], [SCREE, 5.5, 5],
  [CLIFF, 19, 2.2],
];
const HIGH: [Kind, number, number][] = [
  // the plateau (a wide bench at the rim), then the beds the buttes and the far mesas are made of
  [BENCH, 0.6, 22], [SCREE, 7.4, 6],
  [CLIFF, 17, 2.0], [BENCH, 0.5, 12], [SCREE, 6.5, 5],
  [CLIFF, 22, 2.2], [BENCH, 0.5, 10], [SCREE, 6.5, 5],
  [CLIFF, 26, 2.5], [BENCH, 0.5, 11], [SCREE, 7.5, 6],
  [CLIFF, 30, 2.8], [BENCH, 0.6, 12], [SCREE, 8.4, 6],
  [CLIFF, 34, 3.0], [BENCH, 0.6, 12], [SCREE, 8.0, 6],
  [CLIFF, 38, 3.2], [BENCH, 0.6, 12], [SCREE, 9.4, 6],
  [CLIFF, 45, 3.5], [BENCH, 0.6, 13], [SCREE, 9.4, 6],
  [CLIFF, 50, 3.8], [BENCH, 0.6, 13], [SCREE, 10, 6],
  [CLIFF, 60, 4.2],
];

/** the rim's height: the LOW beds add up to it, and the base height there is pinned to it too */
export const STRATA_RIM = LOW.reduce((s, [, dy]) => s + dy, 0);

/** the knots: base height (sorted), ground height, and each segment's kind (between knot i and i+1) */
export const STRATA_F: number[] = [];
export const STRATA_Y: number[] = [];
export const STRATA_K: number[] = [];

(function build() {
  const lowWidth = LOW.reduce((s, [, , dF]) => s + dF, 0);
  // (widths scaled so the rim's base height is the rim's height: the canyon floor and the rim are fixed points)
  const scale = STRATA_RIM / lowWidth;
  let F = 0, y = 0;
  STRATA_F.push(0); STRATA_Y.push(0);
  for (const [kind, dy, dF0] of [...LOW, ...HIGH]) {
    const dF = dF0 * scale;
    // (scree is concave: steepening as it climbs to the cliff above, in three pieces)
    const parts = kind === SCREE ? [[0.4, 0.2], [0.75, 0.55], [1, 1]] : [[1, 1]];
    for (const [fu, fy] of parts) {
      STRATA_F.push(Math.fround(F + dF * fu));
      STRATA_Y.push(Math.fround(y + dy * fy));
      STRATA_K.push(kind);
    }
    F += dF; y += dy;
  }
})();

const N = STRATA_F.length;

/** the segment holding base height H (binary search; 0 below the first knot, N - 2 past the last) */
function segF(H: number): number {
  let lo = 0, hi = N - 2;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (STRATA_F[m] <= H) lo = m; else hi = m - 1;
  }
  return lo;
}

function segY(Y: number): number {
  let lo = 0, hi = N - 2;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (STRATA_Y[m] <= Y) lo = m; else hi = m - 1;
  }
  return lo;
}

/** the kind of segment the last terrace() landed on (-1: below the floor or above the table) */
export let terraceKind = -1;
/** how far along that segment (0..1) */
export let terraceAlong = 0;

/** the stepped ground for a base height (identity below the floor and above the table's top) */
export function terrace(H: number): number {
  if (H <= 0) { terraceKind = -1; return H; }
  const top = STRATA_F[N - 1];
  if (H >= top) { terraceKind = -1; return STRATA_Y[N - 1] + (H - top); }
  const i = segF(H);
  const t = (H - STRATA_F[i]) / (STRATA_F[i + 1] - STRATA_F[i]);
  terraceKind = STRATA_K[i];
  terraceAlong = t;
  return STRATA_Y[i] + (STRATA_Y[i + 1] - STRATA_Y[i]) * t;
}

/** the base height whose terrace is ground height Y (T's inverse) */
export function unterrace(Y: number): number {
  if (Y <= 0) return Y;
  const top = STRATA_Y[N - 1];
  if (Y >= top) return STRATA_F[N - 1] + (Y - top);
  const i = segY(Y);
  const t = (Y - STRATA_Y[i]) / (STRATA_Y[i + 1] - STRATA_Y[i]);
  return STRATA_F[i] + (STRATA_F[i + 1] - STRATA_F[i]) * t;
}
