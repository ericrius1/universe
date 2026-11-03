// The sun's shadows. Near: four cascades (the cast, the city, the temple), each a sphere around its slice of the view
// frustum (constant size, so it never swims as you turn) snapped to whole texels (so it never shimmers as you move).
// Far and for the ground itself: the heightfield's own shadow, ray-marched toward the sun per texel of every terrain
// level (with the earth's curvature and the sun's 0.53 degree disc for soft edges), redone only when the sun has moved.
// The last cascade in use (the farthest, where a frame's motion is far under a texel) is redrawn every other frame,
// its light matrix held in between — not across a cut, a quick turn or a moving sun, nor while `lazy` is off. It
// reaches farther as the sun sinks: the city's, the temple's and the terraces' shadows grow long across the basin at
// golden hour and dawn, far past where the near cascades end (the heightfield's shadow holds only the ground's own).
import { Camera, mat4, mat4Mul, mat4Invert, lookAt, type Kit, type RenderPass, type Texture, type UniformBuffer, type V3, type View } from '@ericrius1/weft';
import tshadow from './terrainshadow.wgsl';
import { solidTexture } from '../util/textures';
import { tier } from '../util/tier';
import { WORLD_GROUP } from './group';

export const CASCADES = 4;
export const SHADOW_PX = tier.shadowPx;
/** the tallest thing that casts into the cascades (m): the temple's base, petals and needle */
const CASTER_H = 220;

export class Shadows {
  readonly views: View[] = [];
  readonly passes: RenderPass[] = [];
  readonly map: Texture;
  readonly dummy: Texture;
  splits = [10, 34, 120, 480];
  /** the last cascade's far end (m) with the sun high, and with it low (under ~10 degrees; between them as it sinks) */
  farHigh = 480;
  farLow = 1800;
  matrices: Float32Array[] = [];
  radii: number[] = [];
  /** the cascades in use (world.wgsl reads the count: shadowParams.w), and whether each is drawn this frame */
  count = tier.cascades;
  private due = Array.from({ length: CASCADES }, () => true);
  private frame = 0;
  private tTick = 0;
  /** the last cascade drawn every other frame (off for shots); where the eye was, where it looked and where the sun
   *  was when it was last drawn */
  lazy = true;
  private lazyAt: V3 = [0, 0, 0];
  private lazyFwd: V3 = [0, 0, 0];
  private lazySun: V3 = [0, 0, 0];
  // the heightfield shadow
  readonly terrain: Texture;
  readonly terrainDummy: Texture;
  private tPasses: RenderPass[] = [];
  private tU: UniformBuffer<any>[] = [];
  private lastSun: V3 = [0, -1, 0];
  private pending: number[] = [];
  /** the heightfield's shadow redone round and round, a level a frame, however little the sun has moved: no sudden
   *  change when it has moved far enough at last (off: all levels again in a step each time the sun has moved
   *  0.0015 rad — a hill's shadow edge jumped metres across the meadow and the house, its rooms' sun with it) */
  steady = true;
  /** the heightfield's levels redrawn at most one every this many frames (util/tier.ts) */
  terrainEvery = tier.terrainEvery;
  /** the heightfield's shadow redrawn whole every frame the light moves (a time-lapse shot; tPasses' order is fine
   *  to coarse) */
  everyFrame = false;
  /** in play (`lazy`), a level is redrawn only once the sun has moved this far (rad) since it was drawn (a level is a
   *  whole map ray-marched toward the sun: 0.6-0.9 ms of a 5090's frame at 2048 px); a scrubbed clock still redraws
   *  one every frame */
  still = 1e-4;
  /** the sun each level was last drawn for */
  private levelSun: (V3 | null)[] = [];
  /** the ground changed under them (new heights, an edit): every level again, a frame each */
  invalidate() { this.levelSun = []; }

  constructor(readonly kit: Kit, readonly levels: number) {
    this.map = kit.texture({ label: 'shadowMap', format: 'depth32float', size: [SHADOW_PX, SHADOW_PX, CASCADES], view: '2d-array' });
    this.dummy = kit.texture({ label: 'shadowMap.dummy', format: 'depth32float', size: [4, 4, CASCADES], view: '2d-array' });
    this.terrain = kit.texture({ label: 'terrainShadow', format: 'r8unorm', size: [tier.terrainShadowPx, tier.terrainShadowPx, levels], view: '2d-array' });
    this.terrainDummy = solidTexture(kit, [255, 255, 255, 255], levels, 'terrainShadow.dummy');
  }

  /** the passes (after the shared world group exists: they use it) */
  init() {
    const kit = this.kit;
    for (let i = 0; i < CASCADES; i++) {
      const cam = new Camera();
      cam.ortho = { halfWidth: 10, halfHeight: 10 };
      const v = kit.view(cam, [SHADOW_PX, SHADOW_PX], `cascade${i}`);
      this.views.push(v);
      this.passes.push(kit.pass({ label: `shadow${i}`, depth: { target: this.map.layer(i), clear: 0 }, view: v, shared: { [WORLD_GROUP]: { shadowMap: this.dummy } }, enabled: () => i < this.count && this.due[i] }));
      this.matrices.push(mat4());
    }
    for (let i = 0; i < this.levels; i++) {
      const u = kit.uniforms(tshadow.structs.TSU, `terrainShadow${i}`);
      u.set({ level: [i, 0, 0, 0] });
      const p = kit.pass({ label: `terrainShadow${i}`, color: [{ target: this.terrain.layer(i), clear: [1, 1, 1, 1] }], shared: { [WORLD_GROUP]: { terrainShadow: this.terrainDummy, shadowMap: this.dummy } } });
      p.fullscreen(tshadow, { label: `terrainShadow${i}`, bind: { TS: u } as never });
      this.tU.push(u);
      this.tPasses.push(p);
    }
  }

  /** fit the cascades to the camera for a sun direction */
  update(cam: Camera, sun: V3) {
    const low = 1 - Math.min(1, Math.max(0, (sun[1] - 0.17) / (0.42 - 0.17)));
    this.splits[CASCADES - 1] = this.farHigh + (this.farLow - this.farHigh) * low * low * (3 - 2 * low);
    const tanY = Math.tan(cam.fovY / 2), tanX = tanY * cam.aspect;
    const f = cam.forward, p = cam.position;
    let near = cam.near;
    const up: V3 = Math.abs(sun[1]) > 0.99 ? [0, 0, -1] : [0, 1, 0];
    // the light's rotation (eye at the origin): snapping happens in this frame
    const rot = lookAt([0, 0, 0], [-sun[0], -sun[1], -sun[2]], up);
    const inv = mat4Invert(rot);
    const lazy = this.count - 1, odd = (this.frame++ & 1) === 1, was = this.radii;
    // Sustained-laptop profiles alternate their two far cascades. The nearest two still update every frame, and a cut,
    // quick turn or moving sun refreshes every cascade immediately.
    const mid = tier.staggerFarCascades && this.count > 2 ? this.count - 2 : -1;
    this.radii = [];
    for (let i = 0; i < CASCADES; i++) {
      const far = this.splits[i];
      // (the last one in use every other frame: its map and matrix as they were — unless the eye has jumped (a cut) or
      // turned more than 5 degrees, or the sun has moved)
      const a = this.lazyAt, g = this.lazyFwd, s = this.lazySun;
      this.due[i] = !(((i === lazy && odd) || (i === mid && !odd)) && this.lazy && was[i] !== undefined && Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]) < was[i] * 0.1
        && f[0] * g[0] + f[1] * g[1] + f[2] * g[2] > 0.996 && sun[0] * s[0] + sun[1] * s[1] + sun[2] * s[2] > 0.99999998);
      if (!this.due[i]) { this.radii.push(was[i]); near = far; continue; }
      if (i === lazy) { this.lazyAt = [p[0], p[1], p[2]]; this.lazyFwd = [f[0], f[1], f[2]]; this.lazySun = [sun[0], sun[1], sun[2]]; }
      // the slice's bounding sphere: centre on the view axis, radius from the slice's far corners (rotation-invariant)
      const k = tanX * tanX + tanY * tanY;
      const zc = Math.min(far, ((near + far) / 2) * (1 + k));
      const rFar = Math.hypot(far - zc, far * Math.sqrt(k));
      const rNear = Math.hypot(near - zc, near * Math.sqrt(k));
      let r = Math.max(rFar, rNear);
      r = Math.ceil(r * 16) / 16;
      const c: V3 = [p[0] + f[0] * zc, p[1] + f[1] * zc, p[2] + f[2] * zc];
      // snap the centre to whole texels in light space
      const texel = (2 * r) / SHADOW_PX;
      const lc = [rot[0] * c[0] + rot[4] * c[1] + rot[8] * c[2], rot[1] * c[0] + rot[5] * c[1] + rot[9] * c[2], rot[2] * c[0] + rot[6] * c[1] + rot[10] * c[2]];
      lc[0] = Math.floor(lc[0] / texel) * texel;
      lc[1] = Math.floor(lc[1] / texel) * texel;
      const sc: V3 = [inv[0] * lc[0] + inv[4] * lc[1] + inv[8] * lc[2], inv[1] * lc[0] + inv[5] * lc[1] + inv[9] * lc[2], inv[2] * lc[0] + inv[6] * lc[1] + inv[10] * lc[2]];
      // the light's eye only as far sunward as a caster could still reach the box: nothing here stands over ~CASTER_H
      // (the temple's needle on its base), and its shadow lies at most CASTER_H / sin(altitude) along the sun's ray (the
      // canyon's walls are the heightfield's)
      const D = Math.min(6000, Math.max(250, CASTER_H / Math.max(Math.abs(sun[1]), 0.03)));
      const eye: V3 = [sc[0] + sun[0] * D, sc[1] + sun[1] * D, sc[2] + sun[2] * D];
      const v = this.views[i];
      v.camera.viewOverride = lookAt(eye, sc, up);
      v.camera.ortho = { halfWidth: r, halfHeight: r };
      v.camera.near = 1;
      v.camera.far = D + r + 200;
      v.camera.update(SHADOW_PX, SHADOW_PX);
      this.matrices[i] = new Float32Array(v.camera.viewProj);
      this.radii.push(r);
      near = far;
    }
  }

  /** the heightfield shadow's passes for this frame: all levels again once the sun has moved enough, a level a frame */
  terrainPasses(sun: V3): RenderPass[] {
    const moved = Math.acos(Math.min(1, sun[0] * this.lastSun[0] + sun[1] * this.lastSun[1] + sun[2] * this.lastSun[2]));
    // (a time-lapse shot: every level again each frame the light has moved at all, so the shadow's edge never steps or
    // flickers between levels drawn at different moments)
    if (this.everyFrame && moved > 0) {
      this.lastSun = [...sun]; this.pending = [];
      for (let i = 0; i < this.levels; i++) this.levelSun[i] = [...sun];
      return [...this.tPasses].reverse();
    }
    // (in play: the level the sun has moved furthest from since it was drawn, once that's over `still`; coarse first)
    if (this.lazy && this.steady) {
      if (this.terrainEvery > 1 && this.tTick++ % this.terrainEvery) return [];
      let pick = -1, most = this.still;
      for (let i = this.levels - 1; i >= 0; i--) {
        const s = this.levelSun[i];
        const a = s ? Math.acos(Math.min(1, sun[0] * s[0] + sun[1] * s[1] + sun[2] * s[2])) : 4;
        if (a > most) { most = a; pick = i; }
      }
      if (pick < 0) return [];
      this.levelSun[pick] = [...sun];
      this.pending = [];
      return [this.tPasses[pick]];
    }
    if (moved > 0.0015 || (this.steady && !this.pending.length && moved > 0)) {
      this.lastSun = [...sun];
      this.pending = Array.from({ length: this.levels }, (_, i) => this.levels - 1 - i);
    }
    if (this.terrainEvery > 1 && this.tTick++ % this.terrainEvery) return [];
    const i = this.pending.shift();
    if (i !== undefined) this.levelSun[i] = [...sun];
    return i === undefined ? [] : [this.tPasses[i]];
  }

  /** whether cascade i is drawn this frame */
  drawn(i: number) { return i < this.count && this.due[i]; }

  get texelSize0() { return (2 * (this.radii[0] ?? 10)) / SHADOW_PX; }

  /** cascade i's light view-projection (for the tree cull) */
  viewProj(i: number) { return this.matrices[i]; }
}

export { mat4Mul };
