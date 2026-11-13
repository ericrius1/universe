// The Milky Way (kiloparsecs): its glow and dust as a volume (shaders/c_galaxy.wgsl) read from a face-on map of it
// (data/sky/milkyway_faceon.webp and its dust: NASA/JPL-Caltech/R. Hurt's artist's concept built on Spitzer's survey,
// scaled so its Sun is the ladder's: galaxymap.ts), and its stars as points drawn from the same map, so the two agree,
// with the globular clusters in the halo. Both are made off the main thread (deepsky.worker.ts) the first time the
// galaxy comes near, and fade in as they arrive. From the Sun's place 8.2 kpc out it's the band across the sky behind
// every level below: the real one, NASA's Deep Star Maps (havens/sky/milkyway.webp, the one file the gardens' sky reads
// too), loaded the first time the galaxy shows; the drawn band stands in till it's in.
import { generateMips, loadImageTexture, solidTexture, type Kit, type Texture, type Draw, type StorageBuffer } from '@ericrius1/weft';
import galShader from '../shaders/c_galaxy.wgsl';
import type { CosmosRenderer, Level } from '../renderer';
import { PointSet, drawPoints } from './points';
import type { Ladder } from '../frames';
import { decodeImage } from './deepsky';

/** the Milky Way's stars (a phone's too: they cost little next to the march) */
const STARS = 230000;

export class Galaxy {
  readonly lv: Level;
  readonly stars: Level;
  /** its stars: room for them all, empty (and not drawn) till the map's in */
  readonly pts = new PointSet(STARS);
  private ptsBuf: StorageBuffer;
  /** the sky's visibility below (a daytime sky hides it): set by the app */
  sky = 1;
  /** the sky's picture: asked for once the galaxy shows, in once it's loaded */
  private picture: 'none' | 'asked' | 'in' = 'none';
  /** the face-on map and the stars from it: asked for once the galaxy comes near, then fading in (0..1) */
  private map: 'none' | 'asked' | 'in' = 'none';
  private mapIn = 0;
  private lastT = 0;
  private readonly draws: Draw[] = [];
  /** how far inside the disc the eye is (1: the band alone) */
  private inside = 0;
  private readonly kit: Kit;
  /** a light device's (a phone's) picture: half the size, the mip it would sample anyway */
  private readonly small: boolean;
  /** the fraction of the frame's resolution it marches at (its pixel's size on the sky, for the picture's mip) */
  private readonly vscale: number;
  /** the map's light, its dust's absorption (per its own unit through the layer), and a diffuse dust that follows the
   *  light (per unit of it): the map's lanes are only the darkest of it, and from inside the disc the rest is what
   *  keeps the far side from adding up to a white wall */
  glow = 0.5;
  dust = 2.5;
  diffuse = 1.5;

  constructor(kit: Kit, R: CosmosRenderer, ladder: Ladder) {
    this.kit = kit;
    this.small = R.light;
    this.vscale = R.volumeScale;
    this.lv = R.level('galaxy', ladder.galaxy, [23.6, 22.6, -99, -100]);
    // (the stars are a second view of the same frame, with their own gains)
    this.stars = R.level('galaxy.stars', ladder.galaxy, [23.0, 22.2, -99, -100]);
    // (inside the disc, where all it draws is the sky's band, one tap a pixel: drawn straight into the scene, not through
    // a volume's three passes; the march only from outside it)
    const vis = () => this.lv.on() && this.sky > 0.01;
    const on = () => vis() && this.inside < 0.999;
    const milkyTex = solidTexture(kit, [0, 0, 0, 1], 1, 'galaxy.sky.none');
    const faceTex = solidTexture(kit, [0, 0, 0, 0], 1, 'galaxy.map.none');
    R.volume('galaxy', on, (p) => {
      this.draws.push(p.fullscreen(galShader, { label: 'galaxy', fragment: 'fs', bind: { L: this.lv.L, milkyTex, faceTex }, blend: 'premultiplied', enabled: on }) as unknown as Draw);
    });
    this.draws.push(R.scene.fullscreen(galShader, { label: 'galaxy.band', fragment: 'fs_band', bind: { L: this.lv.L, milkyTex, faceTex }, blend: 'premultiplied', enabled: () => vis() && this.inside >= 0.999 }) as unknown as Draw);
    // (every record drawn, the empty ones passed over in its vertex shader, until they're filled)
    this.pts.count = STARS;
    this.ptsBuf = drawPoints(kit, R, this.stars, this.pts, 'galaxy.stars', () => this.stars.on() && this.sky > 0.01 && this.map === 'in');
  }

  /** the face-on map (its colour and dust as one texture) and the stars drawn from it */
  private loadMap() {
    this.map = 'asked';
    decodeImage(['sky/milkyway_faceon.webp', 'sky/milkyway_dust.webp'], 'rgba', this.small ? 1024 : 0, STARS).then((m) => {
      const t = this.kit.texture({ label: 'galaxy.map', format: 'rgba8unorm-srgb', size: [m.width, m.height], mips: 'full' });
      t.write(m.data);
      generateMips(this.kit, t);
      for (const d of this.draws) d.set('faceTex', t);
      if (m.stars) this.ptsBuf.write(m.stars);
      this.map = 'in';
    }, (e) => console.warn('galaxy: no face-on map', e));
  }

  private loadPicture() {
    this.picture = 'asked';
    const url = new URL('havens/sky/milkyway.webp', document.baseURI).href;
    loadImageTexture(this.kit, url, { mips: true, label: 'galaxy.sky', max: this.small ? 2048 : undefined }).then((t: Texture) => {
      for (const d of this.draws) d.set('milkyTex', t);
      this.picture = 'in';
    }, (e) => console.warn('galaxy: no sky picture', e));
  }

  update(S: number) {
    const Sk = S / this.lv.frame.unit;
    // the volume: steps enough for the disc seen whole, more from within it
    this.lv.weight *= this.sky;
    this.stars.weight *= this.sky;
    // (inside the disc, the sky's band takes over from the march)
    const inside = this.inside = Math.max(0, Math.min(1, (Math.log10(Sk) - 0.6) / -0.9));
    if (this.picture === 'none' && this.lv.weight > 0) this.loadPicture();
    // (the map asked for a little before the galaxy shows, from the web's middle distance in)
    if (this.map === 'none' && Math.log10(S) < 24.4) this.loadMap();
    const now = performance.now();
    if (this.map === 'in') this.mapIn = Math.min(1, this.mapIn + Math.min(0.1, (now - this.lastT) / 1000) / 0.6);
    this.lastT = now;
    // (and the march's steps fall away as it does, so the two are never both paid in full)
    // (fewer from outside it, where it's small on the screen and soft, and every ray's steps gather where it crosses the
    // plane)
    const out = Math.max(0, Math.min(1, (Math.log10(Sk) - 1.0) / 0.4));
    // (dimmer as the eye nears the plane: edge on, the whole disc's light adds up along every ray, more than the dust
    // takes back, and the exposure's the one the galaxy seen whole has)
    const near = 0.15 + 0.85 * Math.max(0, Math.min(1, (Math.log10(Sk) - 0.5) / 0.9));
    const steps = Math.max(8, Math.round((32 - 14 * out) * (1 - inside)));
    this.lv.L.set({ weight: this.lv.weight, a: [this.glow * near, this.dust, steps, inside], b: [this.diffuse, 0, 0, 0], d: [this.mapIn, 0.045, this.picture === 'in' ? 1 : 0, this.vscale] });
    // (and its stars with it: the picture holds them, and the Sun's own neighbours are drawn by their level)
    if (this.picture === 'in') this.stars.weight *= 1 - inside;
    this.stars.weight *= this.mapIn;
    this.stars.L.set({ weight: this.stars.weight, a: [0.0005 * Math.max(Sk, 12) ** 2, 0, 0.02, 1] });
  }
}
