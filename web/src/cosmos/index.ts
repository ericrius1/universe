// Everything above the cell: the ladder of frames, the camera that zooms down it, the renderer and its levels.
// Self-contained (nothing here reaches outside cosmos/): the Universe app drives it on its canvas, and a planetarium
// (Boulder's Fiske) on its dome, through `dome` — a fisheye drawn into the dome's own texture — and with no input of
// its own (its console flies the camera). The host either lets it run its frame (`frame`) or takes its GPU work
// into its own (`update` then `run`).
import type { Kit } from '@ericrius1/weft';
import { Ladder, type Place } from './frames';
import { WHO } from './figure/figure';
import { CosmosControls } from './controls';
import { CosmosRenderer, type DomeOptions } from './renderer';
import { Web } from './levels/web';
import { Galaxy } from './levels/galaxy';
import { Local } from './levels/local';
import { Solar } from './levels/solar';
import { Earth } from './levels/earth';
import { Surface } from './levels/surface';
import { Air } from './levels/air';
import { EarthData } from './levels/earthdata';
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

export class Cosmos {
  readonly ladder: Ladder;
  readonly controls: CosmosControls;
  readonly r: CosmosRenderer;
  readonly web: Web;
  readonly galaxy: Galaxy;
  readonly local: Local;
  readonly solar: Solar;
  readonly earth: Earth;
  readonly surface: Surface;
  readonly air: Air;
  readonly data: EarthData;
  readonly beyond: Beyond | null = null;
  time = 0;
  /** the place's name in the crumbs */
  readonly short: string;
  private loading = false;

  constructor(readonly kit: Kit, o: CosmosOptions = {}) {
    this.ladder = new Ladder(o.time ?? moment(), o.place);
    this.short = o.short ?? 'Boulder';
    this.controls = new CosmosControls(kit.canvas, this.ladder, o.input ?? true);
    this.r = new CosmosRenderer(kit, this.ladder, o.dome ?? null, o.volumeScale ?? 1);
    this.web = new Web(kit, this.r, this.ladder);
    this.galaxy = new Galaxy(kit, this.r, this.ladder);
    this.local = new Local(kit, this.r, this.ladder);
    this.solar = new Solar(kit, this.r, this.ladder);
    const data = o.data ?? new URL('data/earth/', document.baseURI).href;
    this.data = new EarthData(kit, typeof data === 'string' ? (f) => data + f : data);
    this.air = new Air(kit, this.r, this.ladder);
    this.earth = new Earth(kit, this.r, this.ladder, this.air, this.data);
    this.surface = new Surface(kit, this.r, this.ladder, this.air, this.data, o.figure ?? new URL(`data/figure/${WHO.file}`, document.baseURI).href, o.meadow ?? true);
    if (o.beyond) {
      this.beyond = new Beyond(kit, this.r, this.ladder, o.beyond);
      // (out to just inside their sky; the view easing off our marble onto the middle of their world as it goes)
      this.controls.max = logSOf(WORLD_R * 0.86);
      this.ladder.beyond = { at: [WORLD_C[0] * M_PER_CM, WORLD_C[1] * M_PER_CM, WORLD_C[2] * M_PER_CM], from: logSOf(25), to: logSOf(110) };
    }
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
    const c = this.controls;
    c.update(dt);
    this.r.update(c, this.time);
    const S = c.S;
    // the stars behind the levels below: hidden by a daytime sky over the meadow
    const sf = this.surface;
    sf.update(S);
    const sky = 1 - sf.ground.weight * (1 - sf.night);
    this.galaxy.sky = sky;
    this.local.sky = sky;
    this.web.update(S);
    this.galaxy.update(S);
    this.local.update(S);
    this.solar.update(S);
    // (the ground round the spot, fetched once the dive comes within reach of it)
    if (!this.loading && c.logS < 12) { this.loading = true; void this.data.load().catch((e) => console.warn('cosmos: the ground failed to load', e)); }
    // (and whoever lies in the meadow, once it comes within a few kilometres)
    if (c.logS < 4) void sf.figure.load().catch((e) => console.warn('cosmos: the figure failed to load', e));
    this.earth.update(S);
    // (not under a host's picture that fills the frame: its own air, not this one's, is what's seen)
    this.air.on = (this.earth.lv.weight > 0.002 || sf.ground.weight > 0.002) && !this.r.covered;
    if (this.air.on) this.air.update(this.earth.lv, this.earth.sun);
    this.beyond?.update(c.logS, dt);
    this.r.over = alpha < 1;
    this.r.alpha = alpha;
  }
}
