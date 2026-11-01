// The film (?film=<name>): a scripted journey through the places, rendered frame by frame at a fixed step whatever the
// machine's speed. Each frame is stepped by hand, read back from the GPU, its caption and scale drawn on in 2D, and
// posted as a JPEG to the dev server (vite.config.ts: film/<name>/frames); the soundtrack is the same generative score
// rendered offline along the same cues (film/<name>/audio.wav). tools/film.mjs drives it and encodes the result.
import type { Capture } from '@ericrius1/weft';
import { vec3, type Vec3 } from 'math';
import type { App } from './main';
import { Score, type FilmCue } from './audio/score';
import { fmtLength } from './ui/hud';

interface Shot {
  place?: string;
  /** seconds flying in (0: a cut) and held after */
  fly: number;
  hold: number;
  /** while held: turn (rad/s) and zoom (log-scale per s, negative pushes in) */
  orbit?: number;
  zoom?: number;
  cut?: number;
  /** follow a walking kinesin (index into the walkers' convoys) */
  follow?: number;
  scale?: number;
  title?: string;
  caption?: string;
  compartment: string;
  event?: string;
}

const SHOTS: Record<string, Shot[]> = {
  trailer: [
    { place: 'tissue', scale: 90000, fly: 0, hold: 3.4, zoom: -0.12, cut: 0, title: 'Cell', caption: 'a journey through ten thousand times smaller', compartment: 'outside' },
    { place: 'cell', fly: 4.0, hold: 1.8, orbit: 0.06, cut: 1, caption: 'one human cell · 20 µm', compartment: 'outside', event: 'fly' },
    { place: 'nucleus', fly: 3.4, hold: 1.6, orbit: 0.05, caption: 'the nucleus · 7 µm', compartment: 'cytosol', event: 'fly' },
    { place: 'pore', fly: 3.6, hold: 2.2, orbit: 0.05, zoom: -0.05, caption: 'nuclear pores · 120 nm', compartment: 'cytosol', event: 'arrive' },
    { place: 'dna', fly: 3.6, hold: 3.6, orbit: 0.09, zoom: -0.04, caption: 'DNA wound on nucleosomes · 10 nm', compartment: 'nucleus', event: 'arrive' },
    { place: 'mito', fly: 4.4, hold: 1.4, orbit: 0.06, caption: 'a mitochondrion · 2 µm', compartment: 'cytosol', event: 'fly' },
    { place: 'atp', fly: 3.4, hold: 3.3, orbit: 0.07, zoom: -0.08, caption: 'ATP synthase, spinning · 20 nm', compartment: 'mito', event: 'arrive' },
    { follow: 6, scale: 150, fly: 3.8, hold: 4.0, caption: 'kinesin walking a microtubule · 8 nm steps', compartment: 'cytosol', event: 'fly' },
    { place: 'membrane', fly: 3.6, hold: 2.2, orbit: 0.06, caption: 'the membrane · 5 nm', compartment: 'cytosol', event: 'arrive' },
    { place: 'tissue', scale: 75000, fly: 4.6, hold: 3.1, orbit: 0.03, title: 'Cell', caption: 'ericlevin.dev/cell', compartment: 'outside', event: 'fly' },
  ],
};

export class Film {
  readonly fps = 30;
  private shots: Shot[];
  private starts: number[] = [];
  readonly total: number;
  private frameNo = 0;
  private shot = -1;
  private holdT = 0;
  private flying = false;
  private c2d: OffscreenCanvas | null = null;
  private readonly _film_p = vec3.create();

  constructor(private app: App, private capture: Capture, readonly name: string) {
    this.shots = SHOTS[name] ?? SHOTS.trailer;
    let t = 0;
    for (const s of this.shots) { this.starts.push(t); t += s.fly + s.hold; }
    this.total = Math.round(t * this.fps);
  }

  private target(s: Shot): { at: Vec3; scale: number; yaw: number; pitch: number } {
    if (s.follow !== undefined) {
      const w = this.app.walkers;
      w.convoyAt(s.follow, this.app.bioTime + s.fly * 0.02, this._film_p);
      return { at: vec3.clone(this._film_p), scale: s.scale ?? 150, yaw: this.app.controls.yaw + 0.6, pitch: -0.32 };
    }
    const p = this.app.places.get(s.place!)!;
    return { at: p.at, scale: s.scale ?? p.scale, yaw: p.yaw, pitch: p.pitch };
  }

  /** move the camera for this frame (called by the app before it updates the camera) */
  direct(dt: number) {
    const t = this.frameNo / this.fps;
    const c = this.app.controls;
    let i = this.shot;
    while (i + 1 < this.shots.length && t >= this.starts[i + 1]) i++;
    if (i !== this.shot) {
      this.shot = i;
      const s = this.shots[i];
      const tg = this.target(s);
      if (s.cut !== undefined) this.app.cutTarget = s.cut;
      if (s.fly <= 0) { c.set(tg.at, tg.scale, tg.yaw, tg.pitch); this.flying = false; if (s.cut !== undefined) this.app.cut = s.cut; }
      else { c.flyTo(tg.at, tg.scale, { yaw: tg.yaw, pitch: tg.pitch, duration: s.fly }); this.flying = true; }
      this.holdT = 0;
    }
    const s = this.shots[this.shot];
    if (this.flying && !c.flying) this.flying = false;
    if (!this.flying) {
      this.holdT += dt;
      if (s.follow !== undefined) {
        // keep the walker centred
        this.app.walkers.convoyAt(s.follow, this.app.bioTime, this._film_p);
        vec3.lerp(c.pivot, c.pivot, this._film_p, 1 - Math.exp(-dt * 6));
        c.orbit(0.05 * dt, 0);
      } else {
        if (s.orbit) c.orbit(s.orbit * dt, 0);
        if (s.zoom) c.scale *= Math.exp(s.zoom * dt);
      }
    }
  }

  /** the captions of this moment, faded in after a shot lands and out before the next */
  private overlay(img: ImageData): OffscreenCanvas {
    const W = img.width, H = img.height;
    const cv = (this.c2d ??= new OffscreenCanvas(W, H));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d')!;
    g.putImageData(img, 0, 0);
    const t = this.frameNo / this.fps;
    const s = this.shots[this.shot];
    const t0 = this.starts[this.shot] + s.fly * 0.55, t1 = this.starts[this.shot] + s.fly + s.hold;
    const a = Math.max(0, Math.min(1, (t - t0) / 0.7, (t1 - t) / 0.5));
    const u = H / 1080;
    if (a > 0) {
      g.save();
      g.globalAlpha = a;
      g.textAlign = 'center';
      g.shadowColor = 'rgba(0,0,0,0.85)';
      g.shadowBlur = 24 * u;
      if (s.title) {
        // a dark breath behind the title, high in the frame, above the cells
        const ty = H * 0.25;
        const halo = g.createRadialGradient(W / 2, ty, 0, W / 2, ty, 520 * u);
        halo.addColorStop(0, 'rgba(0,0,0,0.55)'); halo.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = halo;
        g.fillRect(0, 0, W, H * 0.6);
        const grd = g.createLinearGradient(W / 2 - 220 * u, 0, W / 2 + 220 * u, 0);
        grd.addColorStop(0, '#ffe2d0'); grd.addColorStop(0.5, '#ffac86'); grd.addColorStop(1, '#bdb2ff');
        g.fillStyle = grd;
        g.font = `300 ${Math.round(190 * u)}px Fraunces, Georgia, serif`;
        g.fillText(s.title, W / 2, ty + 40 * u);
        g.fillStyle = 'rgba(244,237,230,0.92)';
        g.font = `italic 300 ${Math.round(38 * u)}px Fraunces, Georgia, serif`;
        if (s.caption) g.fillText(s.caption, W / 2, ty + 110 * u);
      } else if (s.caption) {
        g.fillStyle = 'rgba(244,237,230,0.95)';
        g.font = `300 ${Math.round(40 * u)}px Fraunces, Georgia, serif`;
        g.fillText(s.caption, W / 2, H - 92 * u);
      }
      g.restore();
    }
    // a small scale bar in the corner throughout
    const c = this.app.controls, kit = this.app.kit;
    const fovW = 2 * c.scale * Math.tan(kit.camera.fovY / 2) * (W / H);
    const nmPerPx = fovW / W, target = nmPerPx * 180 * u;
    const p10 = Math.pow(10, Math.floor(Math.log10(target)));
    const L = [1, 2, 5, 10].map((k) => k * p10).filter((x) => x <= target).pop() ?? p10;
    const bw = L / nmPerPx;
    g.save();
    g.globalAlpha = 0.85;
    g.strokeStyle = '#f4ede6'; g.lineWidth = 2 * u;
    g.beginPath(); g.moveTo(60 * u, H - 64 * u); g.lineTo(60 * u, H - 58 * u); g.lineTo(60 * u + bw, H - 58 * u); g.lineTo(60 * u + bw, H - 64 * u); g.stroke();
    g.fillStyle = '#f4ede6'; g.font = `600 ${Math.round(20 * u)}px "JetBrains Mono", monospace`;
    g.fillText(fmtLength(L), 60 * u, H - 74 * u);
    g.restore();
    return cv;
  }

  /** render the whole film: frames to the dev server, then the soundtrack */
  async run() {
    const post = (path: string, body: Blob | string, q = '') => fetch(`/__film${path}?name=${encodeURIComponent(this.name)}${q}`, { method: 'POST', body });
    await document.fonts.load(`300 40px Fraunces`).catch(() => {});
    await document.fonts.load(`600 20px "JetBrains Mono"`).catch(() => {});
    const w = window as unknown as Record<string, unknown>;
    for (this.frameNo = 0; this.frameNo < this.total; this.frameNo++) {
      const img = await this.capture.step(1 / this.fps);
      const blob = await this.overlay(img).convertToBlob({ type: 'image/jpeg', quality: 0.93 });
      await post('/frame', blob, `&i=${this.frameNo}`);
      w.__film = { frame: this.frameNo, total: this.total, shot: this.shot, done: false };
    }
    const cues: FilmCue[] = this.shots.map((s, i) => ({ t: this.starts[i] + s.fly, scale: s.scale ?? this.app.places.get(s.place ?? 'tissue')!.scale, compartment: s.compartment, event: s.event }));
    cues.unshift({ t: 0, scale: this.shots[0].scale ?? 90000, compartment: this.shots[0].compartment });
    const wav = await Score.renderFilm(this.total / this.fps, cues);
    await post('/audio', wav);
    await post('/meta', JSON.stringify({ name: this.name, fps: this.fps, frames: this.total, shots: this.shots.length }));
    w.__film = { frame: this.total, total: this.total, shot: this.shot, done: true };
  }
}
