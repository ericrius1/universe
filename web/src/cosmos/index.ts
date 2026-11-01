// Everything above the cell: the ladder of frames, the camera that zooms down it, the renderer and its levels.
// Self-contained (nothing here reaches outside cosmos/): the Universe app drives it on its canvas, and a planetarium
// (Boulder's Fiske) on its dome, through `dome` — a fisheye drawn into the dome's own texture — and with no input of
// its own (its console flies the camera). The host either lets it run its frame (`frame`) or takes its GPU work
// into its own (`update` then `run`).
import type { Kit } from '@ericrius1/weft';
import { Ladder } from './frames';
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
  /** where the real ground round the spot is (a folder's URL: earth.json and its files; default ./data/earth/) */
  data?: string;
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
  time = 0;
  private loading = false;

  constructor(readonly kit: Kit, o: CosmosOptions = {}) {
    this.ladder = new Ladder(o.time ?? moment());
    this.controls = new CosmosControls(kit.canvas, this.ladder, o.input ?? true);
    this.r = new CosmosRenderer(kit, this.ladder, o.dome ?? null);
    this.web = new Web(kit, this.r, this.ladder);
    this.galaxy = new Galaxy(kit, this.r, this.ladder);
    this.local = new Local(kit, this.r, this.ladder);
    this.solar = new Solar(kit, this.r, this.ladder);
    this.data = new EarthData(kit, o.data ?? new URL('data/earth/', document.baseURI).href);
    this.air = new Air(kit, this.r, this.ladder);
    this.earth = new Earth(kit, this.r, this.ladder, this.air, this.data);
    this.surface = new Surface(kit, this.r, this.ladder, this.air, this.data);
  }

  /** where the view is, coarsest first */
  crumbs(): string[] {
    const l = this.controls.logS;
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
    c.push('Boulder');
    if (l > -1.1) return c;
    c.push('Skin');
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
    // the stars behind the levels below: hidden by a daytime sky over the meadow, and by the skin filling the view
    const sf = this.surface;
    sf.update(S);
    const sky = (1 - sf.ground.weight * (1 - sf.night)) * (1 - sf.skin.weight);
    this.galaxy.sky = sky;
    this.local.sky = sky;
    this.web.update(S);
    this.galaxy.update(S);
    this.local.update(S);
    this.solar.update(S);
    // (the ground round the spot, fetched once the dive comes within reach of it)
    if (!this.loading && c.logS < 12) { this.loading = true; void this.data.load().catch((e) => console.warn('cosmos: the ground failed to load', e)); }
    this.earth.update(S);
    this.air.on = this.earth.lv.weight > 0.002 || sf.ground.weight > 0.002;
    if (this.air.on) this.air.update(this.earth.lv, this.earth.sun);
    this.r.over = alpha < 1;
    this.r.P.set({ alpha });
  }
}
