// Everything above the cell: the ladder of frames, the camera that zooms down it, the renderer and its levels.
// Self-contained (nothing here reaches outside cosmos/): the Universe app drives it on its canvas, and a planetarium
// (Boulder's Fiske) on its dome, through `dome` — a fisheye drawn into the dome's own texture — and with no input of
// its own (its console flies the camera). The host either lets it run its frame (`frame`) or takes its GPU work
// into its own (`update` then `run`).
//
// Its levels are realms, each built only when asked for (`build`: its code a chunk of its own, fetched then), so a
// host can open any stretch of the zoom without the rest: Universe's windows (windows.ts). `build()` with nothing
// given builds them all. What isn't built isn't drawn; a host keeps the zoom out of it (controls.floor, ceiling).
import type { Kit, RunEntry } from '@ericrius1/weft';
import { Ladder, type Place } from './frames';
import { CAST } from './figure/cast';
import { FIGURE } from './figure/pose';
import { CosmosControls } from './controls';
import { CosmosRenderer, type DomeOptions } from './renderer';
import type { Web } from './levels/web';
import type { Galaxy } from './levels/galaxy';
import type { Local } from './levels/local';
import type { Solar } from './levels/solar';
import type { Earth } from './levels/earth';
import type { Surface } from './levels/surface';
import type { Air } from './levels/air';
import type { EarthData } from './levels/earthdata';
import { Beyond, logSOf, M_PER_CM, WORLD_C, WORLD_R, type BeyondOptions } from './levels/beyond';

/** a moment: today at `utcHours` (default mid-morning in Boulder, 17:30 UTC) */
export function moment(utcHours = 17.5) {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + utcHours * 3600000;
}

export interface CosmosOptions {
  /** draw a planetarium's fisheye into a texture instead of the screen */
  dome?: DomeOptions;
  /** listen to the page's pointer, wheel and keys (false: the host flies the camera) */
  input?: boolean;
  /** the moment (ms) the Earth, its Sun and the planets are placed for */
  time?: number;
  /** where on Earth the dive ends (default Boulder's meadow: frames.ts BOULDER), its ground in `data` */
  place?: Place;
  /** what the place is called in the crumbs (default 'Boulder') */
  short?: string;
  /** where the real ground round the spot is: a folder's URL (earth.json and its files; default ./data/earth/), or a
   *  file's name to its URL (a host whose files live elsewhere: Boulder's asset()) */
  data?: string | ((file: string) => string);
  /** the mesh of whoever lies in the meadow, Boulder's DNC1 file (default ./data/figure/<theirs>, figure/cast.ts) */
  figure?: string;
  /** the resolution the volumes (the cosmic web, the microwave background, the Milky Way) march at, a fraction of the
   *  frame's: below 1 for a phone (default 1; a dome always 1) */
  volumeScale?: number;
  /** the meadow at the bottom of the dive, whoever lies there drawn into it (default true; false: a host draws its own
   *  ground there and lays them into it — Universe's gardens — the meadow only a stand-in close up while that loads) */
  meadow?: boolean;
  /** past the edge of the observable universe, the keepers' world (levels/beyond.ts): its pictures, a phone's or a
   *  desktop's, its resolution (default none: the zoom stops at the edge) */
  beyond?: BeyondOptions;
}
export type { DomeOptions };

/** the realms above the cell, in the order they draw (coarsest first; the keepers' world after the scene) */
export type CosmosRealm = 'web' | 'galaxy' | 'local' | 'solar' | 'earth' | 'ground' | 'beyond';
export const COSMOS_REALMS: CosmosRealm[] = ['web', 'galaxy', 'local', 'solar', 'earth', 'ground', 'beyond'];

export class Cosmos {
  readonly ladder: Ladder;
  readonly controls: CosmosControls;
  readonly r: CosmosRenderer;
  // (each there once its realm is built: `has`)
  web!: Web;
  galaxy!: Galaxy;
  local!: Local;
  solar!: Solar;
  earth!: Earth;
  surface!: Surface;
  /** the Earth's air and its ground's data: made with the Earth or the ground, whichever is first */
  air!: Air;
  data!: EarthData;
  beyond: Beyond | null = null;
  time = 0;
  /** the time dial: how fast the ephemeris runs (1: the page's moment, held — at one second a second nothing moves that
   *  could be seen; 86,400: a day a second). Only the planets, the Moon, the small bodies and the Earth along its orbit
   *  move with it: the Earth's spin, the ground, its sun and the gardens' clock keep the page's moment */
  timeScale = 1;
  /** the ephemeris's moment (ms since 1970, UTC): the page's, run on by the dial */
  get when() { return Date.UTC(2000, 0, 1, 12) + this.ladder.eday * 86400000; }
  /** the ephemeris back to the page's moment */
  resetTime() { this.ladder.setEphemeris(this.ladder.day); }
  /** the place's name in the crumbs */
  readonly short: string;
  /** the ground's own data fetched when the dive nears it (false: a host's ground covers it wherever it's seen —
   *  Universe's gardens, in a window that opens below where they fill the frame) */
  groundData = true;
  private loading = false;
  private readonly built = new Set<CosmosRealm>();
  private readonly building = new Map<CosmosRealm, Promise<void>>();
  /** what each realm's draws and passes are, for keeping them in its order however they were built */
  private readonly rank = new Map<unknown, number>();
  private airMade: Promise<void> | null = null;

  constructor(readonly kit: Kit, private o: CosmosOptions = {}) {
    this.ladder = new Ladder(o.time ?? moment(), o.place);
    this.short = o.short ?? 'Boulder';
    this.controls = new CosmosControls(kit.canvas, this.ladder, o.input ?? true);
    this.r = new CosmosRenderer(kit, this.ladder, o.dome ?? null, o.volumeScale ?? 1);
    if (o.beyond) {
      // (out to just inside their sky; the view easing off our marble onto the middle of their world as it goes)
      this.controls.max = logSOf(WORLD_R * 0.86);
      this.ladder.beyond = { at: [WORLD_C[0] * M_PER_CM, WORLD_C[1] * M_PER_CM, WORLD_C[2] * M_PER_CM], from: logSOf(25), to: logSOf(110) };
    }
  }

  /** whether a realm is built */
  has(id: CosmosRealm) { return this.built.has(id); }
  /** whether a realm can be built here (the keepers' world only when asked for: `beyond`) */
  can(id: CosmosRealm) { return id !== 'beyond' || !!this.o.beyond; }

  /** build realms (all of them, with nothing given): their code fetched, their levels made and put in their place in
   *  the draw order. Resolves once they're made; their pipelines compile after (kit.ready) */
  async build(ids: CosmosRealm[] = COSMOS_REALMS) {
    await Promise.all(ids.filter((id) => this.can(id)).map((id) => this.realm(id)));
  }

  private realm(id: CosmosRealm): Promise<void> {
    let p = this.building.get(id);
    if (p) return p;
    const kit = this.kit, R = this.r, L = this.ladder, o = this.o;
    p = (async () => {
      if (id === 'web') { const { Web } = await import('./levels/web'); this.put(id, () => { this.web = new Web(kit, R, L); }); }
      else if (id === 'galaxy') { const { Galaxy } = await import('./levels/galaxy'); this.put(id, () => { this.galaxy = new Galaxy(kit, R, L); }); }
      else if (id === 'local') { const { Local } = await import('./levels/local'); this.put(id, () => { this.local = new Local(kit, R, L); }); }
      else if (id === 'solar') {
        const { Solar } = await import('./levels/solar');
        this.put(id, () => { this.solar = new Solar(kit, R, L); });
        // (the camera's focus finds the bodies through it)
        this.controls.locate = (b, out) => this.solar.locate(b, out);
        this.controls.focusable = () => this.solar.ids();
      }
      else if (id === 'earth') {
        const [{ Earth }] = await Promise.all([import('./levels/earth'), this.makeAir()]);
        this.put(id, () => { this.earth = new Earth(kit, R, L, this.air, this.data); });
      } else if (id === 'ground') {
        const [{ Surface }] = await Promise.all([import('./levels/surface'), this.makeAir()]);
        const fig = o.figure ?? new URL(`data/figure/${CAST[FIGURE].file}`, document.baseURI).href;
        this.put(id, () => { this.surface = new Surface(kit, R, L, this.air, this.data, fig, o.meadow ?? true); });
      } else if (id === 'beyond' && o.beyond) {
        const b = o.beyond;
        this.put(id, () => { this.beyond = new Beyond(kit, R, L, b); });
      }
      this.built.add(id);
    })();
    this.building.set(id, p);
    return p;
  }
  /** the air and the ground's data, shared by the Earth and the ground (drawn in the Earth's place) */
  private makeAir() {
    return (this.airMade ??= (async () => {
      const [{ Air }, { EarthData }] = await Promise.all([import('./levels/air'), import('./levels/earthdata')]);
      const data = this.o.data ?? new URL('data/earth/', document.baseURI).href;
      this.put('earth', () => {
        this.data = new EarthData(this.kit, typeof data === 'string' ? (f) => data + f : data);
        this.air = new Air(this.kit, this.r, this.ladder);
      });
    })());
  }
  /** make a realm's levels, then its draws and passes put in the realm's place in the order (stably: within a realm, as
   *  made) */
  private put(id: CosmosRealm, make: () => void) {
    const R = this.r, k = COSMOS_REALMS.indexOf(id);
    const lists: unknown[][] = [R.scene.draws, R.before, R.after, R.levels];
    const n = lists.map((l) => l.length);
    make();
    lists.forEach((l, i) => { for (let j = n[i]; j < l.length; j++) this.rank.set(l[j], k); });
    const by = (a: unknown, b: unknown) => (this.rank.get(a) ?? -1) - (this.rank.get(b) ?? -1);
    R.scene.draws.sort(by);
    (R.before as RunEntry[]).sort(by);
    (R.after as RunEntry[]).sort(by);
    R.levels.sort(by);
  }

  /** where the view is, coarsest first */
  crumbs(): string[] {
    const l = this.controls.logS;
    if (this.beyond && l > 27.4) return l > 27.95 ? ['Beyond', 'The keepers'] : ['Beyond', 'A marble'];
    if (l > 24.6) return ['The observable universe'];
    const c = ['Universe'];
    if (l > 21.8) { c.push('The cosmic web', l > 23.2 ? 'Superclusters' : 'The Local Group'); return c; }
    c.push('Milky Way');
    if (l > 18.6) return c;
    c.push('Orion Arm');
    if (l > 15.6) return c;
    c.push('Solar system');
    if (l > 9.9) return c;
    c.push('Earth');
    if (l > 4.6) return c;
    c.push(this.short);
    if (l > -1.1) return c;
    c.push('An eye');
    return c;
  }

  /** the view distance (m) */
  get S() { return this.controls.S; }

  /** a frame: the camera, every level's view, the draw (over the cell's frame with `alpha` < 1) */
  frame(dt: number, alpha = 1) {
    this.update(dt, alpha);
    this.r.frame();
  }

  /** this frame's GPU work, after `update`, for a host to run with its own */
  run() { return this.r.run(); }

  /** the camera and every level's view for this frame */
  update(dt: number, alpha = 1) {
    this.time += dt;
    const c = this.controls, B = this.built;
    if (this.timeScale !== 1 && dt > 0) this.ladder.setEphemeris(this.ladder.eday + (dt * this.timeScale) / 86400);
    c.fovY = this.kit.camera.fovY;
    c.update(dt);
    this.r.update(c, this.time);
    const S = c.S;
    // the stars behind the levels below: hidden by a daytime sky over the meadow
    const sf = B.has('ground') ? this.surface : null;
    sf?.update(S);
    const sky = sf ? 1 - sf.ground.weight * (1 - sf.night) : 1;
    if (B.has('galaxy')) this.galaxy.sky = sky;
    if (B.has('local')) this.local.sky = sky;
    if (B.has('web')) this.web.update(S);
    if (B.has('galaxy')) this.galaxy.update(S);
    if (B.has('local')) this.local.update(S);
    if (B.has('solar')) { this.solar.earthShare = B.has('earth') && this.earth.ready ? 1 : 0; this.solar.update(S); }
    // (the ground round the spot, fetched once the dive comes within reach of it)
    if (!this.loading && this.data && c.logS < 12 && (B.has('earth') || this.groundData)) { this.loading = true; void this.data.load().catch((e) => console.warn('cosmos: the ground failed to load', e)); }
    // (and whoever lies in the meadow, once it comes within a few kilometres)
    if (sf && c.logS < 4) void sf.figure.load().catch((e) => console.warn('cosmos: the figure failed to load', e));
    if (B.has('earth')) this.earth.update(S);
    // (not under a host's picture that fills the frame: its own air, not this one's, is what's seen)
    if (this.air) {
      const ew = B.has('earth') && this.earth.shown ? this.earth.lv.weight : 0;
      // (the Earth's level gives the air its view: without it — a window below it, where a host's ground covers this
      // one's — there's no air)
      this.air.on = (ew > 0.002 || (!!sf && sf.ground.weight > 0.002)) && !this.r.covered && B.has('earth');
      if (this.air.on) this.air.update(this.earth.lv, this.earth.sun);
    }
    this.beyond?.update(c.logS, dt);
    this.r.over = alpha < 1;
    this.r.alpha = alpha;
  }
}
