// The journey (?film=journey): one take under two minutes, out and in and out again — from someone lying in the grass at
// Chautauqua out past the Earth, the Sun and the Milky Way to the edge of the observable universe, all the way back down
// into their eye, through its iris and the cornea's living cells into one of them, to the DNA wound on its
// nucleosomes, and all the way out again. Rendered as the
// films are (film.ts): each frame stepped by hand, read back, captioned, posted to the dev server, the score rendered
// offline along the same cues; tools/film.mjs drives it and encodes it.
//
// Above the cell the camera is the cosmos's (its zoom in decades, eased between the places, slowing at each); in the
// cell it's the cell's, flown between its places; the hand-over each way is the app's own (enterCell, leaveCell).
import type { Capture } from '@ericrius1/weft';
import type { App } from './main';
import { Score, type FilmCue } from './audio/score';
import { fmtLength } from './ui/hud';
import { NM } from './cosmos/frames';

/** above the cell: from one zoom (log10 m) and pitch to another, or held (to = from) */
interface Up { kind: 'up'; l0: number; l1: number; p0: number; p1: number; dur: number; title?: string; caption?: string }
/** in the cell: fly to a place and hold there (or, `out`, back up to the tissue's widest view) */
interface In { kind: 'in'; place?: string; out?: boolean; fly: number; hold: number; zoom?: number; caption?: string; compartment: string }
type Shot = Up | In;

const up = (l0: number, l1: number, p0: number, p1: number, dur: number, caption?: string, title?: string): Up => ({ kind: 'up', l0, l1, p0, p1, dur, caption, title });
// (the places above the cell: zoom, pitch)
const LYING = [0.35, -0.95], BOULDER = [3.5, -0.42], EARTH = [7.3, -0.15], SOLAR = [13.0, -0.62], STARS = [17.6, -0.3];
const GALAXY = [21.3, -0.75], WEB = [24.3, -0.4], EDGE = [26.95, -0.25], FACE = [-0.75, -1.2], EYE = [-1.75, -1.1], IRIS = [-2.45, -1.1], CELLS = [-3.62, -1.05], DOOR = [-3.84, -1.05];
const go = (a: number[], b: number[], dur: number) => up(a[0], b[0], a[1], b[1], dur);
const hold = (a: number[], dur: number, caption?: string, title?: string) => up(a[0], a[0] - dur * 0.015, a[1], a[1], dur, caption, title);

const SHOTS: Shot[] = [
  // out (under two minutes, all of it: the places held a breath, the empty decades crossed quickly)
  hold(LYING, 3.5, 'from someone lying in the grass, to the edge of everything, and back', 'Universe'),
  go(LYING, BOULDER, 4.5), hold(BOULDER, 1.0, 'Boulder, Colorado · the Flatirons'),
  go(BOULDER, EARTH, 4.5), hold(EARTH, 1.2, 'the Earth'),
  go(EARTH, SOLAR, 4), hold(SOLAR, 1.2, 'the solar system, where its planets are today'),
  go(SOLAR, STARS, 3.2), hold(STARS, 0.8, 'the Sun\u2019s neighbours'),
  go(STARS, GALAXY, 3.2), hold(GALAXY, 1.4, 'the Milky Way · 100,000 light-years'),
  go(GALAXY, WEB, 3), hold(WEB, 0.8, 'the cosmic web'),
  go(WEB, EDGE, 3), hold(EDGE, 2.2, 'the observable universe · 93 billion light-years'),
  // and all the way in
  go(EDGE, WEB, 2.5), go(WEB, GALAXY, 2.8), go(GALAXY, STARS, 2.8), go(STARS, SOLAR, 2.8), go(SOLAR, EARTH, 3.2),
  go(EARTH, BOULDER, 3.5), go(BOULDER, LYING, 3), hold(LYING, 0.4), go(LYING, FACE, 1.6), hold(FACE, 0.6, 'looking up into the sky'),
  go(FACE, EYE, 1.8), hold(EYE, 0.6, 'an eye'), go(EYE, IRIS, 1.8), hold(IRIS, 0.8, 'the iris · its fibres and crypts'),
  go(IRIS, CELLS, 2.4), hold(CELLS, 0.6, 'the cornea\u2019s living cells'), go(CELLS, DOOR, 1.0),
  { kind: 'in', place: 'cell', fly: 4, hold: 1.0, caption: 'one human cell, cut open · 20 µm', compartment: 'outside' },
  { kind: 'in', place: 'nucleus', fly: 3.8, hold: 0.8, caption: 'its nucleus · 7 µm', compartment: 'cytosol' },
  { kind: 'in', place: 'dna', fly: 4.5, hold: 4.5, zoom: -0.05, caption: 'DNA wound on nucleosomes · 10 nm', compartment: 'nucleus' },
  // and all the way out
  { kind: 'in', out: true, fly: 6, hold: 0, compartment: 'outside' },
  go(DOOR, IRIS, 2.0), go(IRIS, FACE, 2.2), go(FACE, LYING, 1.2), go(LYING, BOULDER, 2.8), go(BOULDER, EARTH, 3), go(EARTH, SOLAR, 3),
  go(SOLAR, GALAXY, 3.5), go(GALAXY, EDGE, 3.5), hold(EDGE, 3.5, 'ericlevin.dev/universe', 'Universe'),
];

const smoother = (u: number) => u * u * u * (u * (u * 6 - 15) + 10);

export class Journey {
  readonly fps = 30;
  private starts: number[] = [];
  readonly total: number;
  private frameNo = 0;
  private shot = -1;
  private t = 0;
  /** the cosmos's turn about the view (rad): a slow drift all the way */
  private yaw = 0.4;
  private c2d: OffscreenCanvas | null = null;

  constructor(private app: App, private capture: Capture) {
    let t = 0;
    for (const s of SHOTS) { this.starts.push(t); t += s.kind === 'up' ? s.dur : s.fly + s.hold; }
    this.total = Math.round(t * this.fps);
    app.cosmos.controls.driven = true;
    app.controls.driven = true;
  }

  /** this frame's camera (the app calls it before either camera updates) */
  direct(dt: number) {
    const app = this.app, cc = app.cosmos.controls, c = app.controls;
    const t = this.t;
    this.t += dt;
    let i = Math.max(this.shot, 0);
    while (i + 1 < SHOTS.length && t >= this.starts[i + 1]) i++;
    const s = SHOTS[i], u = Math.min(1, (t - this.starts[i]) / (s.kind === 'up' ? s.dur : s.fly + s.hold));
    const fresh = i !== this.shot;
    this.shot = i;
    if (s.kind === 'up') {
      // back out of the cell: the cosmos takes the camera where the cell's is
      if (app.realm === 'cell') { app.leaveCell(); this.yaw = c.yaw; }
      this.yaw += dt * 0.03;
      const k = s.l0 === s.l1 ? u : smoother(u);
      cc.set(s.l0 + (s.l1 - s.l0) * k, this.yaw, s.p0 + (s.p1 - s.p0) * k);
      return;
    }
    if (app.realm === 'cosmos') app.enterCell();
    if (fresh) {
      if (s.out) c.flyTo(app.places.get('tissue')!.at, c.maxScale * 0.9, { yaw: c.yaw + 0.5, pitch: -0.9, duration: s.fly });
      else {
        const p = app.places.get(s.place!)!;
        c.flyTo(p.at, app.fit(p.scale), { yaw: p.yaw, pitch: p.pitch, duration: s.fly });
      }
    }
    if (!c.flying) {
      c.orbit(0.05 * dt, 0);
      if (s.zoom) c.scale *= Math.exp(s.zoom * dt);
    }
  }

  /** the view's width (nm), whichever camera has it */
  private viewNm() {
    const app = this.app;
    return app.realm === 'cosmos' ? app.cosmos.S / NM : app.controls.scale;
  }

  /** a shot's caption (and title), faded in once it's held and out before the next */
  private overlay(img: ImageData): OffscreenCanvas {
    const W = img.width, H = img.height;
    const cv = (this.c2d ??= new OffscreenCanvas(W, H));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d')!;
    g.putImageData(img, 0, 0);
    const t = this.frameNo / this.fps, s = SHOTS[this.shot], u = H / 1080;
    const t0 = this.starts[this.shot] + (s.kind === 'in' ? s.fly * 0.6 : 0.2);
    const t1 = this.starts[this.shot] + (s.kind === 'in' ? s.fly + s.hold : s.dur);
    const a = Math.max(0, Math.min(1, (t - t0) / 0.7, (t1 - t) / 0.5));
    const caption = s.caption, title = s.kind === 'up' ? s.title : undefined;
    if (a > 0 && (caption || title)) {
      g.save();
      g.globalAlpha = a;
      g.textAlign = 'center';
      g.shadowColor = 'rgba(0,0,0,0.85)';
      g.shadowBlur = 24 * u;
      if (title) {
        const ty = H * 0.3;
        const halo = g.createRadialGradient(W / 2, ty, 0, W / 2, ty, 560 * u);
        halo.addColorStop(0, 'rgba(0,0,0,0.5)'); halo.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = halo;
        g.fillRect(0, 0, W, H * 0.7);
        // (the gold, cyan and violet of ericlevin.dev's mark)
        const grd = g.createLinearGradient(W / 2 - 300 * u, 0, W / 2 + 300 * u, 0);
        grd.addColorStop(0, '#f2d27a'); grd.addColorStop(0.5, '#8fe9f2'); grd.addColorStop(1, '#c8a6ff');
        g.fillStyle = grd;
        g.font = `300 ${Math.round(170 * u)}px Fraunces, Georgia, serif`;
        g.fillText(title, W / 2, ty + 40 * u);
        g.fillStyle = 'rgba(244,240,232,0.92)';
        g.font = `italic 300 ${Math.round(36 * u)}px Fraunces, Georgia, serif`;
        if (caption) g.fillText(caption, W / 2, ty + 106 * u);
      } else if (caption) {
        g.fillStyle = 'rgba(244,240,232,0.95)';
        g.font = `300 ${Math.round(40 * u)}px Fraunces, Georgia, serif`;
        g.fillText(caption, W / 2, H - 92 * u);
      }
      g.restore();
    }
    // a scale bar in the corner throughout, a round length about a sixth of the frame
    const kit = this.app.kit;
    const fovW = 2 * this.viewNm() * Math.tan(kit.camera.fovY / 2) * (W / H);
    const nmPerPx = fovW / W, target = nmPerPx * 180 * u;
    const p10 = Math.pow(10, Math.floor(Math.log10(target)));
    const L = [1, 2, 5, 10].map((k) => k * p10).filter((x) => x <= target).pop() ?? p10;
    const bw = L / nmPerPx;
    g.save();
    g.globalAlpha = 0.85;
    g.strokeStyle = '#f4f0e8'; g.lineWidth = 2 * u;
    g.beginPath(); g.moveTo(60 * u, H - 64 * u); g.lineTo(60 * u, H - 58 * u); g.lineTo(60 * u + bw, H - 58 * u); g.lineTo(60 * u + bw, H - 64 * u); g.stroke();
    g.fillStyle = '#f4f0e8'; g.font = `600 ${Math.round(20 * u)}px "JetBrains Mono", monospace`;
    g.fillText(fmtLength(L), 60 * u, H - 74 * u);
    g.restore();
    return cv;
  }

  /** the score's cues: each shot's scale (nm, the cell's widest above it) and where it is */
  private cues(): FilmCue[] {
    return SHOTS.map((s, i): FilmCue => {
      const t = this.starts[i];
      if (s.kind === 'up') return { t, scale: Math.min(Math.pow(10, s.l1) / NM, 160000), compartment: 'outside', event: s.l0 === s.l1 ? 'arrive' : 'fly' };
      const p = s.place ? this.app.places.get(s.place)! : null;
      return { t: t + s.fly, scale: p ? p.scale : 150000, compartment: s.compartment, event: 'arrive' };
    });
  }

  /** render the whole film: the ground fetched first, then the frames to the dev server, then the soundtrack */
  async run() {
    const post = (path: string, body: Blob | string, q = '') => fetch(`/__film${path}?name=journey${q}`, { method: 'POST', body });
    await document.fonts.load(`300 40px Fraunces`).catch(() => {});
    await document.fonts.load(`600 20px "JetBrains Mono"`).catch(() => {});
    // (the first frame asks for the ground round the spot: wait till it's in)
    const save = this.t;
    for (let k = 0; k < 600 && !this.app.cosmos.data.ready; k++) { await this.capture.step(0); await new Promise((r) => setTimeout(r, 50)); }
    this.t = save;
    const w = window as unknown as Record<string, unknown>;
    for (this.frameNo = 0; this.frameNo < this.total; this.frameNo++) {
      const img = await this.capture.step(1 / this.fps);
      const blob = await this.overlay(img).convertToBlob({ type: 'image/jpeg', quality: 0.93 });
      await post('/frame', blob, `&i=${this.frameNo}`);
      w.__film = { frame: this.frameNo, total: this.total, shot: this.shot, done: false };
    }
    const wav = await Score.renderFilm(this.total / this.fps, this.cues());
    await post('/audio', wav);
    await post('/meta', JSON.stringify({ name: 'journey', fps: this.fps, frames: this.total, shots: SHOTS.length }));
    w.__film = { frame: this.total, total: this.total, shot: this.shot, done: true };
  }
}
