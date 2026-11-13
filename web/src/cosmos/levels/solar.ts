// The solar system (AU): the Sun, the eight planets where they are on their real orbits (J2000 elements), the Moon, the
// dwarf planets and Halley's comet on theirs, the Voyagers where they are (cosmos/bodies.ts, data/orbits/orbits.json),
// the orbits themselves, the asteroid belt, the Kuiper belt and the Oort cloud far out. Mercury, Mars, Jupiter and
// Saturn from their maps (data/planets/, fetched once one of them is more than a few pixels across), Saturn's rings
// from their measured optical depth. Close to the Earth, its own level takes over from the dot this one draws.
//
// Everything a body needs is worked out here in doubles relative to the camera (shaders/c_solar.wgsl), so a planet
// stays sharp close up wherever the camera's focus has taken it (controls.ts focus()): the level's floating origin is
// the zoom's target on the Earth, nine AU from Saturn.
import { Ref, generateMips, type Kit, type StorageBuffer, type Texture } from '@ericrius1/weft';
import { vec3, type Vec3 } from 'math';
import solarShader from '../shaders/c_solar.wgsl';
import type { CosmosRenderer, Level } from '../renderer';
import { PointSet, drawPoints, rng } from './points';
import { AU, PLANETS, orbitPoint, type Ladder } from '../frames';
import { Bodies, half, type BodyKind, type OrbitsJson } from '../bodies';

const SEGS = 360;
/** what each is in the shader (c_solar.wgsl K_*) */
const KIND: Record<string, number> = { mercury: 0, venus: 1, earth: 2, mars: 0, jupiter: 3, saturn: 4, uranus: 5, neptune: 5, moon: 6 };
/** the maps, a layer each (data/planets/) */
const MAPS = ['mercury', 'mars', 'jupiter', 'saturn'];
const B_FLOATS = 16;
/** the bodies drawn, in order: the planets, the Moon, then the small bodies and the spacecraft as they come in */
const MAX_BODIES = 24;

/** a body as the guide's engineer sees it: what it is, where it is now (the solar frame's AU, heliocentric — the level's
 *  frame — and relative to the level's floating origin), how far from the Sun */
export interface SolarBody { id: string; name: string; kind: BodyKind; at: Vec3; rel: Vec3; sunAU: number; radiusKm: number }

export class Solar {
  readonly lv: Level;
  readonly belts: Level;
  readonly pts = new PointSet(42000);
  readonly bodies = new Bodies();
  private buf: StorageBuffer;
  private bdata = new Float32Array(MAX_BODIES * B_FLOATS);
  private order: string[] = [...PLANETS.map((p) => p.id), 'moon'];
  private readonly pos: Vec3 = [0, 0, 0];
  private readonly pole: Vec3 = [0, 1, 0];
  private readonly mer: Vec3 = [1, 0, 0];
  private maps: Texture;
  private ringTau: Texture;
  private mapsAsked = false;
  private orbitBuf: StorageBuffer;
  private orbitCount = 0;
  /** the Earth's own level draws the Earth and the Moon (its maps are in): this one's are hidden once they'd be a disc */
  earthShare = 0;

  constructor(private kit: Kit, private R: CosmosRenderer, private ladder: Ladder) {
    this.lv = R.level('solar', ladder.solar, [17.2, 16.2, 6.6, 5.9]);
    this.belts = R.level('solar.belts', ladder.solar, [17.6, 16.6, 10.6, 9.8]);
    this.buf = kit.storage({ label: 'solar.bodies', data: this.bdata, stride: B_FLOATS * 4 });
    const blank = kit.texture({ label: 'solar.maps.none', format: 'rgba8unorm-srgb', size: [1, 1, MAPS.length], view: '2d-array', usage: ['sample', 'copy-dst'] });
    blank.write(new Uint8Array([128, 128, 128, 255]), { layer: 0 });
    this.maps = blank;
    this.ringTau = kit.texture({ label: 'solar.rings.none', format: 'r16float', size: [1, 1], usage: ['sample', 'copy-dst'] });
    const orbits = this.orbits();
    this.orbitBuf = kit.storage({ label: 'orbits', data: orbits, stride: 16 });
    this.orbitCount = orbits.length / 4;
    const L = this.lv.L, on = this.lv.on;
    R.scene.draw(solarShader, { label: 'orbits', vertex: 'vs_orbit', fragment: 'fs_orbit', topology: 'line-list', bind: { L, orbit: this.orbitBuf }, count: () => (this.orbitCount - 1) * 2, blend: 'premultiplied', cull: 'none', enabled: on });
    this.populate();
    drawPoints(kit, R, this.belts, this.pts, 'belts');
    R.scene.fullscreen(solarShader, { label: 'sun', fragment: 'fs_sun', bind: { L }, blend: 'premultiplied', enabled: on });
    R.scene.draw(solarShader, {
      label: 'planets', vertex: 'vs_planet', fragment: 'fs_planet', count: 6, instances: MAX_BODIES, blend: 'premultiplied', cull: 'none', enabled: on,
      bind: { L, bodies: this.buf, maps: new Ref(() => this.maps), ringTau: new Ref(() => this.ringTau) } as never,
    });
    void this.loadSmall();
    void this.loadRings();
  }

  /** the orbits as strips joined end to end (their index in w): the planets', then the small bodies' and the
   *  Voyagers' once they're in */
  private orbits(): Float32Array {
    const out: number[] = [];
    const T = this.ladder.day / 36525;
    PLANETS.forEach((p, k) => {
      const [a, e, i, , w, O] = p.el.map((x, j) => x + p.d[j] * T);
      for (let s = 0; s <= SEGS; s++) { orbitPoint(a, e, i, w, O, (s / SEGS) * Math.PI * 2, this.pos); out.push(this.pos[0], this.pos[1], this.pos[2], k); }
    });
    // (the dwarf planets 8.., Halley 14, the Voyagers 15, 16: c_solar.wgsl's colours by index)
    const small = ['ceres', 'pluto', 'eris', 'haumea', 'makemake', 'sedna', 'halley'];
    small.forEach((id, j) => {
      const el = this.bodies.orbitOf(id);
      if (!el) return;
      // (more points along a long ellipse, and crowded toward its perihelion where it turns fastest)
      const n = el[1] > 0.5 ? 900 : SEGS;
      for (let s = 0; s <= n; s++) {
        const u = s / n, E = Math.PI * 2 * u + (el[1] > 0.5 ? -Math.sin(Math.PI * 2 * u) * 0.9 : 0);
        orbitPoint(el[0], el[1], el[2], el[3], el[4], E, this.pos);
        out.push(this.pos[0], this.pos[1], this.pos[2], 8 + j);
      }
    });
    // the Voyagers since their last flybys (Saturn's for Voyager 1, November 1980; Neptune's for Voyager 2, August
    // 1989): straight out along their velocity, which is what they've done since
    [['voyager1', 2444560.5], ['voyager2', 2447768.5]].forEach(([id, jd], j) => {
      const st = this.bodies.stateOf(id as string, this.ladder.eday);
      if (!st) return;
      const back = (jd as number) - 2451545 - this.ladder.eday;
      for (let s = 0; s <= 16; s++) {
        const t = back * (1 - s / 16);
        out.push(st.at[0] + st.v[0] * t, st.at[1] + st.v[1] * t, st.at[2] + st.v[2] * t, 15 + j);
      }
    });
    return new Float32Array(out);
  }

  private async loadSmall() {
    try {
      const r = await fetch(new URL('data/orbits/orbits.json', document.baseURI).href);
      if (!r.ok) throw new Error(`orbits.json ${r.status}`);
      this.bodies.take((await r.json()) as OrbitsJson);
      for (const b of this.bodies.list) if (!this.order.includes(b.id) && b.id !== 'sun') this.order.push(b.id);
      const o = this.orbits();
      this.orbitBuf.ensure(o.byteLength);
      this.orbitBuf.write(o);
      this.orbitCount = o.length / 4;
    } catch (e) { console.warn('solar: the small bodies failed to load', e); }
  }

  /** Saturn's rings' optical depth along their radius (saturn_rings_tau.bin), as half floats with a chain of mips: each
   *  coarser step the depth that lets through the average of what the finer ones do face on (so a ringlet and a gap
   *  side by side neither vanish nor go solid as the rings get small) */
  private async loadRings() {
    try {
      const r = await fetch(new URL('data/planets/saturn_rings_tau.bin', document.baseURI).href);
      if (!r.ok) throw new Error(`rings ${r.status}`);
      const tau = new Float32Array(await r.arrayBuffer());
      const n = tau.length;
      const t = this.kit.texture({ label: 'solar.rings', format: 'r16float', size: [n, 1], mips: 'full', usage: ['sample', 'copy-dst'] });
      let T = Float32Array.from(tau, (x) => Math.exp(-x));
      for (let k = 0; k < t.mips; k++) {
        const w = Math.max(1, n >> k);
        if (k > 0) {
          const prev = T, next = new Float32Array(w);
          for (let i = 0; i < w; i++) { const a = prev[Math.min(prev.length - 1, i * 2)], b = prev[Math.min(prev.length - 1, i * 2 + 1)]; next[i] = (a + b) / 2; }
          T = next;
        }
        const h = new Uint16Array(w);
        for (let i = 0; i < w; i++) h[i] = half(-Math.log(Math.max(T[i], 1e-4)));
        t.write(h, { mip: k, width: w, height: 1 });
      }
      this.ringTau = t;
    } catch (e) { console.warn('solar: Saturn\'s rings failed to load', e); }
  }

  /** the maps of Mercury, Mars, Jupiter and Saturn, a layer each of one array (2048 × 1024; 1024 on a phone or a light
   *  GPU), their mips made on the GPU */
  private async loadMaps() {
    const W = this.R.light ? 1024 : 2048, H = W / 2;
    try {
      const bmps = await Promise.all(MAPS.map(async (id) => {
        const r = await fetch(new URL(`data/planets/${id}_2k.webp`, document.baseURI).href);
        if (!r.ok) throw new Error(`${id} ${r.status}`);
        return createImageBitmap(await r.blob(), { resizeWidth: W, resizeHeight: H, resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      }));
      const t = this.kit.texture({ label: 'solar.maps', format: 'rgba8unorm-srgb', size: [W, H, MAPS.length], view: '2d-array', mips: 'full', usage: ['sample', 'copy-dst', 'render'] });
      bmps.forEach((b, i) => this.kit.queue.copyExternalImageToTexture({ source: b }, { texture: t.gpu, origin: [0, 0, i] }, [W, H, 1]));
      generateMips(this.kit, t);
      this.maps = t;
    } catch (e) { console.warn('solar: the planets\' maps failed to load', e); }
  }

  private populate() {
    const r = rng(3), P = this.pts;
    const ring = (n: number, r0: number, r1: number, thick: number, c: number[], lum: number) => {
      for (let i = 0; i < n; i++) {
        const rad = r0 + (r1 - r0) * Math.sqrt(r.next()), th = r.next() * Math.PI * 2;
        P.push(rad * Math.cos(th), r.gauss() * thick * rad, rad * Math.sin(th), 0, c[0], c[1], c[2], lum * (0.4 + r.next()));
      }
    };
    ring(16000, 2.15, 3.3, 0.06, [0.75, 0.68, 0.6], 0.25);
    ring(12000, 30, 50, 0.08, [0.6, 0.7, 0.85], 2.5);
    // the Oort cloud: a sphere of comets, 2,000 to 50,000 AU
    for (let i = 0; i < 3500; i++) {
      const rad = 2000 * Math.pow(25, r.next()), th = Math.acos(2 * r.next() - 1), ph = r.next() * Math.PI * 2;
      P.push(rad * Math.sin(th) * Math.cos(ph), rad * Math.cos(th), rad * Math.sin(th) * Math.sin(ph), 0, 0.6, 0.75, 1.0, 1.2 * (0.3 + r.next()));
    }
  }

  // ---------------------------------------------------------------- where things are, for the camera and the guide
  /** a body's centre as an offset from the zoom's target (metres, the top frame's axes) into `out`, and its radius (m);
   *  null if there's no such body (controls.ts locate) */
  locate(id: string, out: Vec3): number | null {
    const b = this.bodies.get(id);
    if (!b || !this.bodies.at(id, this.ladder.eday, this.pos)) return null;
    const t = this.ladder.solar.target;
    for (let i = 0; i < 3; i++) out[i] = (this.pos[i] - t[i]) * AU;
    vec3.transformQuat(out, out, this.ladder.solar.q);
    return b.r * 1000;
  }
  /** where a named body is now, for the guide's marks (ui/things.ts FindsThings): any of the bodies by its id (the Sun,
   *  the planets, the Moon, "ceres", "pluto", "eris", "haumea", "makemake", "sedna", "halley", "voyager1",
   *  "voyager2"), heliocentric in the solar frame's AU on the ephemeris's day; null for anything else */
  find(kind: string, name: string): { frame: Ladder['solar']; at: Vec3; r?: number; name?: string } | null {
    if (kind !== 'body') return null;
    const b = this.bodies.get(name);
    const at = b && this.bodies.at(name, this.ladder.eday, [0, 0, 0]);
    if (!b || !at) return null;
    return { frame: this.ladder.solar, at, r: (b.r * 1000) / AU, name: b.name };
  }
  /** the ids a zoom toward the cursor can settle on */
  ids() { return this.order.filter((id) => id !== 'earth'); }
  /** every body, where it is now: the guide's engineer labels and selects them */
  list(): SolarBody[] {
    const o = this.lv.origin;
    return this.bodies.list.map((b) => {
      const at = this.bodies.at(b.id, this.ladder.eday, [0, 0, 0]) ?? [0, 0, 0];
      return { id: b.id, name: b.name, kind: b.kind, at, rel: [at[0] - o[0], at[1] - o[1], at[2] - o[2]] as Vec3, sunAU: vec3.length(at), radiusKm: b.r };
    });
  }

  update(S: number) {
    const Sau = S / AU, lv = this.lv, o = lv.origin, e = lv.eye, l = Math.log10(S);
    const d = this.ladder.eday, B = this.bodies;
    const [, H] = this.R.size();
    const pxA = this.R.dome ? Math.PI / this.R.size()[0] : (2 * Math.tan(this.kit.camera.fovY / 2)) / H;
    let wantMaps = false;
    const earthAt: Vec3 = [0, 0, 0];
    B.at('earth', d, earthAt);
    this.bdata.fill(0);
    this.order.forEach((id, k) => {
      if (k >= MAX_BODIES) return;
      const b = B.get(id);
      if (!b || !B.at(id, d, this.pos)) return;
      // relative to the camera, in doubles
      const rel: Vec3 = [this.pos[0] - o[0] - e[0], this.pos[1] - o[1] - e[1], this.pos[2] - o[2] - e[2]];
      const dist = vec3.length(rel), r = (b.r * 1000) / AU;
      const rpx = r / Math.max(dist * pxA, 1e-30);
      // (the Earth and the Moon: hidden once the Earth's own level draws them as discs)
      const hide = (id === 'earth' || id === 'moon') && this.earthShare > 0 && l < 9.4 && rpx >= 0.75;
      const p = PLANETS.find((q) => q.id === id);
      const kind = KIND[id] ?? (b.kind === 'spacecraft' ? 8 : 7);
      const layer = MAPS.indexOf(id);
      if (layer >= 0 && rpx > 3) wantMaps = true;
      // which way it faces: the IAU's for the planets; the Moon its near side to the Earth, its pole the ecliptic's
      if (!B.spin(id, d, this.pole, this.mer)) {
        vec3.set(this.pole, 0, 1, 0);
        if (id === 'moon') {
          vec3.subtract(this.mer, earthAt, this.pos);
          this.mer[1] = 0;
          vec3.normalize(this.mer, this.mer);
        } else vec3.set(this.mer, 1, 0, 0);
      }
      const color = p?.color ?? (b.kind === 'spacecraft' ? [0.85, 0.9, 1.0] : id === 'moon' ? [0.55, 0.55, 0.55] : b.kind === 'comet' ? [0.7, 0.8, 0.9] : [0.7, 0.66, 0.6]);
      this.bdata.set([rel[0], rel[1], rel[2], hide ? 0 : r, color[0], color[1], color[2], kind, this.pole[0], this.pole[1], this.pole[2], b.flat, this.mer[0], this.mer[1], this.mer[2], layer], k * B_FLOATS);
    });
    this.buf.write(this.bdata);
    if (wantMaps && !this.mapsAsked) { this.mapsAsked = true; void this.loadMaps(); }
    // the Sun relative to the camera; its brightness held as the zoom changes
    const sunGain = 0.35;
    const orbitA = 0.16 * Math.min(1, Math.max(0, (l - 10.2) / 1.5)) * Math.min(1, Math.max(0, (16.4 - l) / 1.2));
    lv.L.set({ sunPos: [-o[0] - e[0], -o[1] - e[1], -o[2] - e[2]], a: [sunGain, 1.0, orbitA, 0] });
    this.belts.L.set({ a: [0.0045 * Math.max(Sau, 3) ** 2, 0, Math.max(Sau * 0.004, 0.002), 1] });
  }
}
