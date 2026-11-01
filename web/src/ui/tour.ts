// The guided tour: from a sheet of tissue down to the DNA and out again, a caption at each stop. Each leg flies the
// optimal zoom-and-pan path to the next place, holds, then moves on; any touch of the controls ends it.
import type { Controls } from '../engine/camera';
import type { Place } from './places';

export interface Stop { place: string; caption: string; hold: number; cut?: boolean; orbit?: number }

export const TOUR: Stop[] = [
  { place: 'tissue', caption: '<small>100 µm</small>A sheet of human tissue. Each of these cells is about a fifth the width of a hair.', hold: 5 },
  { place: 'cell', caption: '<small>10 µm</small>One cell, cut open. You are made of 37 trillion of them.', hold: 6, cut: true },
  { place: 'nucleus', caption: '<small>5 µm</small>The nucleus holds two metres of DNA, folded into a ball this small.', hold: 5 },
  { place: 'pore', caption: '<small>200 nm</small>Nuclear pores: gates in its double membrane. Thousands of them let messages in and out.', hold: 6 },
  { place: 'dna', caption: '<small>20 nm</small>DNA, wound twice round histone spools — the nucleosomes. Every bead here is an amino acid of a real structure.', hold: 7, orbit: 0.08 },
  { place: 'mito', caption: '<small>2 µm</small>A mitochondrion, once a free-living bacterium, now the cell\'s power plant.', hold: 5 },
  { place: 'atp', caption: '<small>50 nm</small>ATP synthase: a rotary motor spun by protons. Time here runs a hundred times slower than life.', hold: 7, orbit: 0.06 },
  { place: 'er', caption: '<small>300 nm</small>Ribosomes on the rough ER, building proteins one amino acid at a time.', hold: 6 },
  { place: 'mt', caption: '<small>100 nm</small>A microtubule: a highway of tubulin. Kinesin motors walk it, hauling cargo to the cell\'s edge.', hold: 7, orbit: 0.06 },
  { place: 'membrane', caption: '<small>50 nm</small>The membrane: a film of lipids two molecules thick, studded with pumps, receptors and sugars.', hold: 6, orbit: 0.05 },
  { place: 'tissue', caption: 'And all of it, in every one of your cells, all the time.', hold: 6 },
];

export class Tour {
  private i = -1;
  private holding = 0;
  private orbit = 0;
  active = false;
  constructor(private controls: Controls, private places: Map<string, Place>, private onStop: (s: Stop | null) => void, private fit: (scale: number) => number = (s) => s) {}

  start() {
    this.active = true;
    this.i = -1;
    this.next();
  }
  stop() {
    if (!this.active) return;
    this.active = false;
    this.controls.cancelFlight();
    this.onStop(null);
  }
  private next() {
    this.i++;
    if (this.i >= TOUR.length) { this.stop(); return; }
    const s = TOUR[this.i];
    const p = this.places.get(s.place)!;
    this.holding = -1;
    this.orbit = 0;
    this.onStop(s);
    this.controls.flyTo(p.at, this.fit(p.scale), { yaw: p.yaw, pitch: p.pitch, speed: 0.85, done: () => { this.holding = s.hold; this.orbit = s.orbit ?? 0.03; } });
  }
  update(dt: number) {
    if (!this.active || this.holding < 0) return;
    this.controls.orbit(this.orbit * dt, 0);
    this.holding -= dt;
    if (this.holding <= 0) this.next();
  }
}
