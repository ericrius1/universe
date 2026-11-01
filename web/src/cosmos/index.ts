// Everything above the cell: the ladder of frames, the camera that zooms down it, the renderer and its levels.
import type { Kit } from '@ericrius1/weft';
import { Ladder } from './frames';
import { CosmosControls } from './controls';
import { CosmosRenderer } from './renderer';
import { Web } from './levels/web';
import { Galaxy } from './levels/galaxy';
import { Local } from './levels/local';
import { Solar } from './levels/solar';
import { Earth } from './levels/earth';
import { Surface } from './levels/surface';

/** the moment: mid-morning in Boulder today (17:30 UTC), or ?utc=<hours>, or ?now for the real one */
function moment() {
  const q = new URLSearchParams(location.search);
  if (q.has('now')) return Date.now();
  const d = new Date();
  const h = Number(q.get('utc') ?? 17.5);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + h * 3600000;
}

export class Cosmos {
  readonly ladder = new Ladder(moment());
  readonly controls: CosmosControls;
  readonly r: CosmosRenderer;
  readonly web: Web;
  readonly galaxy: Galaxy;
  readonly local: Local;
  readonly solar: Solar;
  readonly earth: Earth;
  readonly surface: Surface;
  time = 0;

  constructor(readonly kit: Kit) {
    this.controls = new CosmosControls(kit.canvas, this.ladder);
    this.r = new CosmosRenderer(kit, this.ladder);
    this.web = new Web(kit, this.r, this.ladder);
    this.galaxy = new Galaxy(kit, this.r, this.ladder);
    this.local = new Local(kit, this.r, this.ladder);
    this.solar = new Solar(kit, this.r, this.ladder);
    this.earth = new Earth(this.r, this.ladder);
    this.surface = new Surface(this.r, this.ladder);
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
    this.earth.update();
    this.r.over = alpha < 1;
    this.r.P.set({ alpha });
    this.r.frame();
  }
}
