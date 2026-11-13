// The well: a plate of liver cells on a lab bench in San Francisco, from about a metre over the bench down among the
// organelles of one cell, drawn by Hepatocyte's own code (src/well, its embed.ts: tools/hepatocyte-sync.mjs) on this
// kit and laid into the cosmos's frame (Hepatocyte.layer: its HDR, before the bloom), with the lab round it (bench.wgsl)
// and San Francisco's fog over the way down to it (fog.wgsl, lab/way.ts). A realm of its own (windows.ts, realms.ts):
// this module and the well's code are one chunk, fetched and built only when a window takes the well in.
//
// The camera is the cosmos's: one zoom in log10 metres, its yaw and its pitch, as everywhere else. The way down is the
// cosmos's camera going on below where the cell would take it (the controls' bottom), so the zoom is one axis from the
// edge of everything to inside a liver cell. Here it orbits a point inside one hepatocyte near the middle of the chosen
// well's floor, at the zoom's distance, looking down as Hepatocyte's own host does (steeply into the bore from over the
// bench, flattening over the sheet of cells, nearly level inside one: way.ts pitchAt) by however far the visitor has
// tilted it (as far as the bore lets them). While it draws, the kit's globals are the well's (Hepatocyte.use) and its
// camera the well's, in the well's micrometres; the cosmos's are back after (after()).
//
// When the well and the fog fill the frame none of the cosmos's own work is done (its renderer's hostOnly): the well's
// frame, the lab and the fog are laid into its HDR alone, through its bloom and film (cosmos/renderer.ts lay), mixed
// toward the well's own look as it comes.
import type { Kit, RenderPass, RunEntry } from '@ericrius1/weft';
import { Hepatocyte } from '../well/embed';
import benchShader from './bench.wgsl';
import fogShader from './fog.wgsl';
import type { Cosmos } from '../cosmos';
import { COSMOS_FILM, mixFilm, type Film } from '../cosmos/film';
import { FOG_OPEN, fogAt, pitchAt, tiltAt } from './way';

export { Hepatocyte };

/** the plate's numbers (mm, Hepatocyte's embed.ts): its footprint's half, and the bench under it */
const PLATE_HALF: [number, number] = [63.9, 42.75];
const BENCH_Y = -11.2;

/** the well's look in the film: a little more colour than the cosmos's (its own film's lift, embed.ts film()), a lighter
 *  vignette and grain */
const WELL_FILM: Partial<Film> = { saturation: 1.22, contrast: 1.12, vignette: 0.28, grain: 0.006 };

export interface LabOptions {
  /** a phone (Hepatocyte's lighter settings: fewer cells with their organelles drawn round the eye) */
  phone: boolean;
}

export class Lab {
  /** Hepatocyte's world: its plate, its field of cells, its store (what's in the well), what's under a point (pickAt,
   *  picked, describe) */
  readonly hep: Hepatocyte;
  /** how much of the frame is the well's this time (0 above the fog, 1 below it), and the fog's */
  shows = 0;
  fog = 0;
  /** drawing this frame (update ran: after() gives the kit back) */
  private drawing = false;
  private readonly benchU;
  private readonly fogU;
  private readonly bench: RenderPass;
  private readonly fogPass: RenderPass;
  private readonly layer: RenderPass;
  /** the cosmos's own film (as the gardens keep it), and the renderer's lay as it was before this one's was put in front of it */
  private readonly base: Film;
  private hostLay: (() => RunEntry[]) | null = null;
  private readonly lay = () => [...(this.hostLay?.() ?? []), ...this.work()];
  /** the point the camera orbits (world µm: inside a hepatocyte near the middle of the well's floor) and the eye */
  private readonly target: [number, number, number];
  private readonly eye: [number, number, number] = [0, 0, 0];
  private readonly view = new Float32Array(16);
  /** the visitor's tilt from the zoom's own pitch, and the pitch as last set */
  private tilt = 0;
  private lastPitch: number | null = null;
  private near = 0.05;
  private time = 0;

  constructor(private kit: Kit, private cosmos: Cosmos, o: LabOptions) {
    const R = cosmos.r;
    this.base = { ...COSMOS_FILM };
    const hep = this.hep = new Hepatocyte(kit, { hosted: true, detailCells: o.phone ? 7 : 13 });
    const home = hep.homeCell();
    this.target = [home.x - home.r * 0.3, home.h * 0.42, home.z - home.r * 0.35];
    this.benchU = kit.uniforms(benchShader.structs.BenchU, 'lab.bench');
    this.fogU = kit.uniforms(fogShader.structs.FogU, 'lab.fog');
    // (the lab first, over everything: the cosmos's scene isn't drawn under it)
    this.bench = kit.pass({ label: 'lab.bench', color: [{ target: R.hdr, clear: [0, 0, 0, 1] }] });
    this.bench.fullscreen(benchShader, { bind: { B: this.benchU } });
    this.layer = hep.layer(R.hdr);
    this.fogPass = kit.pass({ label: 'lab.fog', color: [{ target: R.hdr, clear: false }] });
    this.fogPass.fullscreen(fogShader, { blend: 'premultiplied', bind: { F: this.fogU } });
  }

  /** what's laid into the cosmos's frame this time: the lab and the well once the fog opens over them, the fog */
  private work(): RunEntry[] {
    if (!this.drawing) return [];
    const out: RunEntry[] = [];
    if (this.cosmos.r.hostOnly) out.push(this.bench);
    if (this.shows > 0) out.push(...this.hep.passes(), this.layer);
    if (this.fog > 0.001) out.push(this.fogPass);
    return out;
  }

  /** this frame, on the well's way down (after the cosmos's update: its camera is this frame's) */
  update(dt: number) {
    const c = this.cosmos, R = c.r, cc = c.controls, kit = this.kit, cam = kit.camera, hep = this.hep;
    // (in front of whatever else lays into the frame: the cell's, which isn't drawn on this way)
    if (R.lay !== this.lay) { this.hostLay = R.lay; R.lay = this.lay; }
    const l = cc.logS;
    this.time += dt;
    this.fog = fogAt(l);
    // the well's in the frame once the fog opens over it; the cosmos's isn't once the fog's closed over it
    this.shows = l < FOG_OPEN[0] ? 1 : 0;
    R.hostOnly = this.fog >= 0.999 || this.shows > 0;
    this.drawing = true;
    // the fog's light: the sky over the city (dim at night)
    const sunUp = c.ladder.sunGround[1];
    const day = Math.max(0.06, Math.min(1, (sunUp + 0.1) / 0.35));
    this.fogU.set({ amount: this.fog, zoom: l, time: this.time, aspect: kit.size.render[0] / Math.max(1, kit.size.render[1]), color: [1.45 * day, 1.5 * day, 1.58 * day] });
    R.film = this.shows > 0 ? mixFilm(this.base, { ...this.base, ...WELL_FILM }, 1 - this.fog) : this.base;
    if (!this.shows) { this.lastPitch = null; return; }

    // the camera: the zoom's own pitch for where it is, tilted by the visitor as far as the bore lets them; their yaw
    const sched = pitchAt(l), most = tiltAt(l);
    if (cc.flying) this.tilt *= Math.exp(-dt * 3);
    else if (this.lastPitch === null) this.tilt = cc.pitch - sched;
    else this.tilt += cc.pitch - this.lastPitch;
    this.tilt = Math.max(-most, Math.min(most, this.tilt));
    const pitch = Math.max(-1.52, Math.min(0.3, sched + this.tilt));
    if (!cc.flying) cc.pitch = pitch;
    this.lastPitch = cc.pitch;
    const yaw = cc.yaw, cp = Math.cos(pitch);
    const f = [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
    const r = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const d = Math.pow(10, l + 6);
    for (let i = 0; i < 3; i++) this.eye[i] = this.target[i] - f[i] * d;
    // (the view's turn alone: the world puts its translation in against its floating origin, embed.ts update)
    this.view.set([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, 0, 0, 0, 1]);
    if (cam.viewOverride !== (this.view as never)) this.near = cam.near;
    cam.viewOverride = this.view as never;
    cam.near = Math.max(0.002, d * 0.02);
    hep.use();
    hep.update(dt, this.eye);
    hep.shows = 1;
    // the lab round it: in the plate's millimetres, from the same eye, gone once the eye's down in a well
    const e = hep.toPlate(this.eye);
    const [W, H] = kit.size.render;
    this.benchU.set({
      eye: e, tanHalf: Math.tan(cam.fovY / 2), fwd: f as never, aspect: W / Math.max(1, H), right: r as never, benchY: BENCH_Y,
      up: u as never, shows: 1, plate: PLATE_HALF, light: 1, spare: 0,
    });
  }

  /** once the frame's sent: the kit's globals and camera given back */
  after() {
    if (!this.drawing) return;
    this.drawing = false;
    this.cosmos.r.hostOnly = false;
    if (this.kit.camera.viewOverride === (this.view as never)) { this.kit.camera.viewOverride = null; this.kit.camera.near = this.near; }
    this.hep.unuse();
  }

  /** the way went back to the main line: the cosmos's film as it was */
  leave() {
    this.after();
    this.shows = this.fog = 0;
    this.lastPitch = null;
    this.cosmos.r.film = { ...this.base };
  }
}

/** build the well (its world's buffers and pipelines: kit.ready() after compiles them) */
export function buildWell(kit: Kit, cosmos: Cosmos, o: LabOptions) { return new Lab(kit, cosmos, o); }
