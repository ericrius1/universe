// The guided tour: from the edge of the observable universe down through the galaxy, the Earth and someone lying in
// the grass, into their eye and one of its cells, to the DNA, and back out to them, a caption at each stop. Each leg
// flies to the next place (above the cell the cosmos's camera, in it the cell's, handed over on the way: the app's
// `fly`), holds, then moves on; any touch of the controls ends it.

export interface Stop { place: string; caption: string; hold: number; cut?: boolean; orbit?: number }

export const TOUR: Stop[] = [
  { place: 'u:universe', caption: '<small>93 billion ly</small>The observable universe: everything whose light has had time to reach us. The glowing shell is the oldest light there is.', hold: 5 },
  { place: 'u:web', caption: '<small>100 million ly</small>The cosmic web. Every point of light is a galaxy, strung along filaments round empty voids.', hold: 4 },
  { place: 'u:milkyway', caption: '<small>100,000 ly</small>The Milky Way: a barred spiral of two hundred billion stars. The Sun is out in one of its arms.', hold: 4 },
  { place: 'u:neighbourhood', caption: '<small>10 light-years</small>The Sun\'s neighbours, where they really are. The nearest, α Centauri, is 4.4 light-years away.', hold: 4 },
  { place: 'u:solar', caption: '<small>70 AU</small>The solar system, each planet where it is today.', hold: 4 },
  { place: 'u:earth', caption: '<small>10,000 km</small>The Earth: a thin blue skin of air, cities on the night side, the Moon where it is tonight.', hold: 4 },
  { place: 'u:boulder', caption: '<small>3 km</small>Boulder, Colorado: a meadow below the Flatirons, lit by the Sun where it is over Boulder now.', hold: 4 },
  { place: 'u:person', caption: '<small>2 m</small>Someone lying in the grass, looking up at all of it.', hold: 4 },
  { place: 'u:eye', caption: '<small>2 cm</small>Their eye. Over the iris, the clear cornea: a few layers of living cells.', hold: 4 },
  { place: 'tissue', caption: '<small>100 µm</small>The cornea\'s cells. Each is about a fifth the width of a hair.', hold: 5 },
  { place: 'cell', caption: '<small>10 µm</small>One cell, cut open. You are made of 37 trillion of them.', hold: 6, cut: true },
  { place: 'nucleus', caption: '<small>5 µm</small>The nucleus holds two metres of DNA, folded into a ball this small.', hold: 5 },
  { place: 'dna', caption: '<small>20 nm</small>DNA, wound twice round histone spools — the nucleosomes. Every bead here is an amino acid of a real structure.', hold: 7, orbit: 0.08 },
  { place: 'mito', caption: '<small>2 µm</small>A mitochondrion, once a free-living bacterium, now the cell\'s power plant.', hold: 5 },
  { place: 'atp', caption: '<small>50 nm</small>ATP synthase: a rotary motor spun by protons. Time here runs a hundred times slower than life.', hold: 7, orbit: 0.06 },
  { place: 'mt', caption: '<small>100 nm</small>A microtubule: a highway of tubulin. Kinesin motors walk it, hauling cargo to the cell\'s edge.', hold: 7, orbit: 0.06 },
  { place: 'membrane', caption: '<small>50 nm</small>The membrane: a film of lipids two molecules thick, studded with pumps, receptors and sugars.', hold: 6, orbit: 0.05 },
  { place: 'u:person', caption: 'And all of it, in every one of their cells, all the time.', hold: 6 },
];

/** how the tour moves the camera: fly to a place (calling `done` there), turn about it, stop wherever it is */
export interface TourCamera { fly(place: string, done: () => void): void; orbit(angle: number): void; cancel(): void }

export class Tour {
  private i = -1;
  private holding = 0;
  private orbit = 0;
  active = false;
  constructor(private camera: TourCamera, private onStop: (s: Stop | null) => void) {}

  start() {
    this.active = true;
    this.i = -1;
    this.next();
  }
  stop() {
    if (!this.active) return;
    this.active = false;
    this.camera.cancel();
    this.onStop(null);
  }
  private next() {
    this.i++;
    if (this.i >= TOUR.length) { this.stop(); return; }
    const s = TOUR[this.i], i = this.i;
    this.holding = -1;
    this.orbit = 0;
    this.onStop(s);
    // (a leg's arrival counts only while the tour is still on it)
    this.camera.fly(s.place, () => { if (this.active && this.i === i) { this.holding = s.hold; this.orbit = s.orbit ?? 0.03; } });
  }
  update(dt: number) {
    if (!this.active || this.holding < 0) return;
    this.camera.orbit(this.orbit * dt);
    this.holding -= dt;
    if (this.holding <= 0) this.next();
  }
}
