// The realms a window needs, and building them: first what's in view where it starts (the first frame waits for
// those alone), then the rest behind it, nearest first. The zoom is held short of a realm that isn't in yet (holds:
// the cosmos's camera's floor below the view, its ceiling above), as it is above the gardens while they build.
// Letting the window out (expand) wants everything, and builds what's missing the same way.
// Below the Earth there are two ways down (windows.ts Way): the main line's, to Seven Havens and the cell, and the
// well's. Their realms overlap on the zoom, so only one way is live at a time (`way`): what shows, what holds the zoom
// and what the first frame waits for are the live way's, and the other's realms stay out of it. A window on one way
// wants that way's realms alone; the whole universe wants both.
import { REALM_BANDS, GARDENS_COVER, FOG_COVER, UNIVERSE, WAY_OF, meets, type RealmId, type Way, type ZoomWindow } from './windows';

/** the order realms are listed in (and so the order of the draw, coarsest first: cosmos/index.ts) */
const ALL: RealmId[] = ['web', 'galaxy', 'local', 'solar', 'earth', 'ground', 'beyond', 'gardens', 'cell', 'well'];

export interface RealmsOptions {
  /** Seven Havens' gardens at the bottom of the dive (they cover what's behind them below GARDENS_COVER) */
  gardens: boolean;
  /** the keepers' world past the edge (not on a dome) */
  beyond: boolean;
  /** build one realm: resolves once it's made and its pipelines are compiled */
  build: (id: RealmId) => Promise<void>;
  /** a realm's in */
  onIn?: (id: RealmId) => void;
}

export class Realms {
  /** what's wanted: the realms that meet the window, and what they need */
  private wanted = new Set<RealmId>();
  private readonly isIn = new Set<RealmId>();
  private readonly started = new Map<RealmId, Promise<void>>();
  /** when each realm came in (ms since the page opened) */
  readonly times: Partial<Record<RealmId, number>> = {};
  /** the way down that's live: the window's, or the main line's */
  way: Way;

  constructor(public window: ZoomWindow, private o: RealmsOptions) { this.way = window.way ?? 'havens'; this.want(); }

  /** whether a realm is on the live way (or on both) */
  private onWay(id: RealmId) { const w = WAY_OF[id]; return !w || w === this.way; }

  /** where a realm shows on the zoom (log10 m), [top, bottom]: the stars behind the levels below them are covered by
   *  the gardens where those fill the frame */
  band(id: RealmId): [number, number] {
    const [t, b] = REALM_BANDS[id];
    if ((id === 'galaxy' || id === 'local') && (this.o.gardens || this.window.way === 'well')) return [t, Math.max(b, this.window.way === 'well' ? FOG_COVER : GARDENS_COVER)];
    return [t, b];
  }
  private possible(id: RealmId) {
    return (id !== 'gardens' || this.o.gardens) && (id !== 'beyond' || this.o.beyond) && (!this.window.way || !WAY_OF[id] || WAY_OF[id] === this.window.way);
  }

  private want() {
    const w = this.window, set = new Set<RealmId>();
    for (const id of ALL) if (this.possible(id) && meets(w, this.band(id))) set.add(id);
    // (the gardens draw her, who's the ground's; the ground's sky and light are the Earth's, unless the gardens cover
    // it wherever the window shows it)
    if (set.has('gardens')) set.add('ground');
    if (set.has('ground') && (!this.o.gardens || (w.top ?? Infinity) > GARDENS_COVER)) set.add('earth');
    this.wanted = set;
  }

  wants(id: RealmId) { return this.wanted.has(id); }
  isReady(id: RealmId) { return this.isIn.has(id); }
  /** every realm the window wants on the live way (the other way's are built when it's taken: setWay) */
  list() { return ALL.filter((id) => this.wanted.has(id) && this.onWay(id)); }
  /** whether the whole universe has the loop's seam: the keepers' world, the gardens and the cell all in it */
  get seamed() { return this.wanted.has('beyond') && this.wanted.has('gardens') && this.wanted.has('cell'); }

  /** the realms that show at a zoom (and what they need) */
  at(l: number): RealmId[] {
    const out = new Set(this.list().filter((id) => { const [t, b] = this.band(id); return this.onWay(id) && l < t && l > b; }));
    if (out.has('gardens')) out.add('ground');
    if (out.has('ground') && this.wanted.has('earth') && l > GARDENS_COVER) out.add('earth');
    return ALL.filter((id) => out.has(id));
  }
  /** whether everything that shows at a zoom is in */
  readyAt(l: number) { return this.at(l).every((id) => this.isIn.has(id)); }

  /** the zoom's holds at `l`: below it, the top of the highest realm still to come in (floor); above it, the bottom of
   *  the lowest (ceiling) */
  holds(l: number): { floor: number | null; ceiling: number | null } {
    let floor: number | null = null, ceiling: number | null = null;
    for (const id of this.wanted) {
      if (this.isIn.has(id) || !this.onWay(id)) continue;
      const [t, b] = this.band(id);
      if (b >= l - 1e-6) ceiling = Math.min(ceiling ?? Infinity, b);
      else if (t <= l + 1e-6) floor = Math.max(floor ?? -Infinity, t);
    }
    return { floor, ceiling };
  }

  /** build the window's realms: `first` resolves once those that show at `start` are in (the first frame waits for
   *  them), `all` once everything is */
  run(start: number): { first: Promise<void>; all: Promise<void> } {
    const first = this.at(start);
    const firstIn = Promise.all(first.map((id) => this.one(id))).then(() => {});
    return { first: firstIn, all: firstIn.then(() => this.rest(start)) };
  }
  /** everything else the window wants, nearest the view first; the cell from the start (its molecules are the long
   *  wait), the gardens after it (they compile on their own scheduler: gardens.ts) */
  private async rest(l: number) {
    const dist = (id: RealmId) => { const [t, b] = this.band(id); return l > t ? l - t : l < b ? b - l : 0; };
    const left = this.list().filter((id) => !this.started.has(id)).sort((a, b) => dist(a) - dist(b));
    const cell = left.includes('cell') ? this.one('cell') : null;
    for (const id of left) if (id !== 'cell' && id !== 'gardens') await this.one(id);
    await cell;
    if (left.includes('gardens')) await this.one('gardens');
    // (anything asked for meanwhile: a window let out)
    await Promise.all([...this.started.values()]);
  }
  private one(id: RealmId): Promise<void> {
    let p = this.started.get(id);
    if (p) return p;
    p = (async () => {
      // (the gardens need her, who's the ground's)
      if (id === 'gardens') await this.one('ground');
      await this.o.build(id);
      this.isIn.add(id);
      this.times[id] = Math.round(performance.now());
      this.o.onIn?.(id);
    })();
    this.started.set(id, p);
    return p;
  }

  /** take the other way down (at `l`): what it needs and hasn't got built behind the view, nearest first */
  setWay(way: Way, l: number) {
    if (way === this.way) return Promise.resolve();
    this.way = way;
    return this.rest(l);
  }

  /** the window let out to the whole universe: what's missing built behind the view (`l`), nearest first */
  expand(l: number) {
    this.window = UNIVERSE;
    this.want();
    return this.rest(l);
  }
}
