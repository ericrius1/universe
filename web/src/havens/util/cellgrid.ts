// Indices bucketed by square cells of the plane (the trees' trunks for what walks among them: hero/world.ts,
// wildlife/world.ts; the bikes' ways and buildings: bikes/roads.ts), built once and kept as three typed arrays: the
// occupied cells' keys in order, where each cell's items start, and the items (in each cell in the order of their
// indices). A Map of arrays held the same in tens of MB for the valley's trees, and as many objects for every major
// collection to trace.
//   const g = CellGrid.points(4, x, z, (i) => h[i] > 3);
//   for (let k = g.at(cx, cz), e = g.end; k < e; k++) use(g.items[k]);
const sharedGrids = new WeakMap<object, Map<number, CellGrid>>();

export class CellGrid {
  private keys: Float64Array;
  private starts: Uint32Array;
  readonly items: Uint32Array;
  /** one past the last item of the cell `at` found */
  end = 0;

  /** `both`: each (cell, item) as the cell's key times `scale` plus the item */
  private constructor(readonly cell: number, both: Float64Array, scale: number) {
    both.sort();
    const m = both.length;
    this.items = new Uint32Array(m);
    const keys = new Float64Array(m), starts = new Uint32Array(m + 1);
    let cells = 0, last = -1;
    for (let j = 0; j < m; j++) {
      const k = Math.floor(both[j] / scale);
      this.items[j] = both[j] - k * scale;
      if (k !== last) { keys[cells] = k; starts[cells++] = j; last = k; }
    }
    starts[cells] = m;
    this.keys = keys.slice(0, cells);
    this.starts = starts.slice(0, cells + 1);
  }

  /** n items, each in the cells `each` puts it in (put(cx, cz, i), any order; `each` is run twice: to count, to fill) */
  static of(cell: number, n: number, each: (put: (cx: number, cz: number, i: number) => void) => void) {
    let m = 0;
    each(() => { m++; });
    const scale = 2 ** Math.ceil(Math.log2(n + 1)), both = new Float64Array(m);
    let j = 0;
    each((cx, cz, i) => { both[j++] = CellGrid.key(cx, cz) * scale + i; });
    return new CellGrid(cell, both, scale);
  }

  /** points: each kept one in the cell it stands in (every one: one grid shared by all who ask for the same points
   *  and cell, as the bikes and the wildlife do the trees') */
  static points(cell: number, x: ArrayLike<number>, z: ArrayLike<number>, keep?: (i: number) => boolean) {
    const shared = !keep && typeof x === 'object' ? sharedGrids.get(x as object)?.get(cell) : undefined;
    if (shared) return shared;
    const g = CellGrid.of(cell, x.length, (put) => {
      for (let i = 0; i < x.length; i++) if (!keep || keep(i)) put(Math.floor(x[i] / cell), Math.floor(z[i] / cell), i);
    });
    if (!keep && typeof x === 'object') {
      let m = sharedGrids.get(x as object);
      if (!m) sharedGrids.set(x as object, (m = new Map()));
      m.set(cell, g);
    }
    return g;
  }

  /** boxes: each in every cell its box (x0, z0, x1, z1) touches */
  static boxes(cell: number, n: number, box: (i: number, out: Float64Array) => void) {
    const b = new Float64Array(4);
    return CellGrid.of(cell, n, (put) => {
      for (let i = 0; i < n; i++) {
        box(i, b);
        for (let cx = Math.floor(b[0] / cell); cx <= Math.floor(b[2] / cell); cx++) for (let cz = Math.floor(b[1] / cell); cz <= Math.floor(b[3] / cell); cz++) put(cx, cz, i);
      }
    });
  }

  static key(cx: number, cz: number) { return (cx + 4096) * 8192 + (cz + 4096); }

  /** the first of cell (cx, cz)'s items in `items`, `end` one past its last (an empty cell: both 0) */
  at(cx: number, cz: number) {
    const k = CellGrid.key(cx, cz), K = this.keys;
    let lo = 0, hi = K.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, v = K[mid];
      if (v < k) lo = mid + 1;
      else if (v > k) hi = mid - 1;
      else { this.end = this.starts[mid + 1]; return this.starts[mid]; }
    }
    this.end = 0;
    return 0;
  }
}
