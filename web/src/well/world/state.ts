// What the well is: which system, which compound, which concentration, how long ago it was dosed, and what you are
// looking through. Everything else in the place is derived from this, and anything that changes it says so once so
// the interface and the world can both follow.

import { axesFor, byId, dominant, PLATE_COLUMNS, viability, zeroAxes, type Axes, type Compound } from '../data/compounds';
import { SYSTEMS, type System } from '../data/systems';
import type { ChannelKey } from './palette';

export type Stage = 'intro' | 'plate' | 'dive' | 'field' | 'rising';

export interface Well {
  index: number;
  row: number;
  col: number;
  compound: Compound;
  dose: number;
  axes: Axes;
  viability: number;
  label: string;
}

/** how the cells are shown. 'auto' is each stretch of the dive in its own: the plate as it looks by eye, the sheet of
 *  cells in simulated phase contrast (what anyone at the bench sees of living cells down an inverted microscope), and
 *  inside a cell, where no light microscope reaches, the modelled view. The others hold one look wherever it can be
 *  had (the instruments only on the sheet of cells, from just under the medium's surface to a few cells across) */
export type LookId = 'auto' | 'phase' | 'bright' | 'fluor' | 'model';
export interface LookInfo {
  id: LookId;
  /** a control's name for it */
  name: string;
  /** what the picture is, for a label on it ('' for a picture that's simply what's there) */
  label: string;
  note: string;
}
export const LOOKS: LookInfo[] = [
  { id: 'auto', name: 'As seen', label: '', note: 'Each stretch as it is best seen: by eye over the plate, phase contrast on the sheet of cells, the model inside one.' },
  { id: 'phase', name: 'Phase contrast', label: 'simulated phase contrast', note: 'Living cells as an inverted microscope shows them: thick is dark, a bright halo round each cell, the canaliculi bright lines between them.' },
  { id: 'bright', name: 'Brightfield', label: 'simulated brightfield, PAS and haematoxylin', note: 'Fixed and stained: glycogen magenta (PAS), nuclei blue (haematoxylin). A cell that has spent its glycogen goes pale.' },
  { id: 'fluor', name: 'Fluorescence', label: 'simulated fluorescence', note: 'A dark field, and a thing is only as bright as the dye in it — which is what high-content imaging actually sees.' },
  { id: 'model', name: 'Modelled', label: 'modelled view', note: 'The cells as a model of them: light through each body along its path, nothing that glints under water.' },
];

export const ROWS = 8;
export const COLS = 12;

type Listener = (what: string) => void;

export class Store {
  systemId: System['id'] = 'truvivo';
  compoundId = 'apap';
  row = 2;
  hours = 24;
  playing = false;
  stage: Stage = 'intro';
  mode: 'bright' | 'fluor' = 'bright';
  /** how the cells are shown (LOOKS): set it with setLook, which keeps `mode` (the fluorescence register) with it */
  look: LookId = 'auto';
  /** what the picture is showing right now, for its label (the world sets it each frame: 'shown' when it changes) */
  shown: LookInfo = LOOKS[0];
  stains = new Set<ChannelKey>(['hoechst', 'tmrm', 'cdf']);
  /** the cell the camera is inside, if any */
  inside: number | null = null;
  /** what the crosshair is on */
  looking: { part: number; cell: number } = { part: 0, cell: -1 };
  hoverWell: number | null = null;
  tour = false;

  private listeners: Listener[] = [];
  on(fn: Listener) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }
  emit(what: string) { for (const f of this.listeners) f(what); }

  get system(): System { return SYSTEMS[this.systemId]; }
  get compound(): Compound { return byId(this.compoundId); }
  get dose(): number { return this.compound.series[Math.min(this.row, this.compound.series.length - 1)]; }
  get maxHours(): number { return this.system.maxHours; }

  /** the culture's CYP activity, averaged across the exposure rather than taken at its end: in a flat culture most
   *  of what a compound is going to be turned into is turned into it in the first few hours, before the enzymes go */
  cyp(hours = this.hours): number {
    const s = this.system;
    const d0 = s.dosedOnDay;
    const n = 9;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += s.cypAt(d0 + (hours / 24) * (i / (n - 1)));
    return sum / n;
  }

  axes(): Axes {
    if (this.compoundId === 'vehicle') return zeroAxes();
    return axesFor({ compound: this.compound, dose: this.dose, hours: this.hours, cyp: this.cyp() });
  }

  /** the ninety-six wells as they stand right now */
  plate(): Well[] {
    const out: Well[] = [];
    const cyp = this.cyp();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const compound = PLATE_COLUMNS[c % PLATE_COLUMNS.length];
        const dose = compound.series[r];
        const axes = dose > 0 ? axesFor({ compound, dose, hours: this.hours, cyp }) : zeroAxes();
        out.push({
          index: r * COLS + c,
          row: r,
          col: c,
          compound,
          dose,
          axes,
          viability: viability(axes),
          label: `${'ABCDEFGH'[r]}${c + 1}`,
        });
      }
    }
    return out;
  }

  /** the well the current selection points at */
  wellIndex(): number {
    const c = PLATE_COLUMNS.findIndex((x) => x.id === this.compoundId);
    return this.row * COLS + (c < 0 ? 0 : c);
  }

  select(compoundId: string, row: number) {
    this.compoundId = compoundId;
    this.row = Math.max(0, Math.min(ROWS - 1, row));
    this.emit('well');
  }

  setSystem(id: System['id']) {
    if (this.systemId === id) return;
    this.systemId = id;
    this.hours = Math.min(this.hours, SYSTEMS[id].maxHours);
    this.emit('system');
  }

  setLook(id: LookId) {
    const was = this.mode;
    this.look = id;
    this.mode = id === 'fluor' ? 'fluor' : 'bright';
    this.emit('look');
    if (was !== this.mode) this.emit('mode');
  }

  setHours(h: number) {
    this.hours = Math.max(0, Math.min(this.maxHours, h));
    this.emit('hours');
  }

  dominant() { return dominant(this.axes()); }
  viability() { return viability(this.axes()); }
}

export const fmtDose = (uM: number) => {
  if (uM <= 0) return 'vehicle';
  if (uM >= 1000) return `${(uM / 1000).toFixed(uM >= 10000 ? 0 : 1)} mM`;
  if (uM >= 10) return `${uM.toFixed(0)} µM`;
  if (uM >= 1) return `${uM.toFixed(1)} µM`;
  if (uM >= 0.01) return `${uM.toFixed(2)} µM`;
  return `${(uM * 1000).toFixed(0)} nM`;
};

export const fmtHours = (h: number) => {
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${(h / 24).toFixed(1)} d`;
};
