// Places to fly to, each a view of the one world: where to look from and how close, with what's there in a sentence.
// Surface places are found on the actual shapes — a spot on the nuclear envelope with a clear line of sight, a crista
// inside a mitochondrion, a stretch of open membrane — all away from the wedge the cutaway removes, and the camera
// looks across the surface at a slant, the way a microscope's light catches it.
import { vec3, type Vec3 } from 'math';
import { type World, Kind, FilKind, blobRadius, sdOrganelle, wedgeDepth, WEDGE, type Organelle } from '../world/layout';

export interface Place {
  id: string;
  name: string;
  scale: number;
  at: Vec3;
  yaw: number;
  pitch: number;
  line: string;
  art: string;
  /** a game that starts here */
  play?: string;
}
interface View { at: Vec3; scale: number; yaw: number; pitch: number }

const dirAngles = (d: Vec3) => ({ yaw: Math.atan2(-d[0], -d[2]), pitch: Math.asin(Math.max(-1, Math.min(1, d[1]))) });

/** a view of a surface point: looking down onto it at a slant (tilt 0 = straight down) */
function across(p: Vec3, n: Vec3, scale: number, tilt = 0.62, turn = 0.4): View {
  const t = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const b = vec3.cross(vec3.create(), n, t);
  const side = vec3.add(vec3.create(), vec3.scale(vec3.create(), t, Math.cos(turn)), vec3.scale(vec3.create(), b, Math.sin(turn)));
  const look = vec3.normalize(vec3.create(), vec3.add(vec3.create(), vec3.scale(vec3.create(), n, -Math.cos(tilt)), vec3.scale(vec3.create(), side, Math.sin(tilt))));
  return { at: p, scale, ...dirAngles(look) };
}
/** a view of a point from a direction (pointing from the eye to it) */
const from = (p: Vec3, look: Vec3, scale: number): View => ({ at: p, scale, ...dirAngles(vec3.normalize(vec3.create(), look)) });

function normalOf(o: Organelle, p: Vec3): Vec3 {
  const e = 0.5, d = (q: Vec3) => sdOrganelle(o, q);
  return vec3.normalize(vec3.create(), [
    d([p[0] + e, p[1], p[2]]) - d([p[0] - e, p[1], p[2]]),
    d([p[0], p[1] + e, p[2]]) - d([p[0], p[1] - e, p[2]]),
    d([p[0], p[1], p[2] + e]) - d([p[0], p[1], p[2] - e])]);
}

function fibonacci(n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * 2.39996323;
    out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return out;
}

export function buildPlaces(w: World): Place[] {
  const O = w.organelles;
  const nuc = w.nucleus, cell = w.cell;
  const others = (skip: Organelle) => O.filter((o) => o !== skip && o.kind !== Kind.Neighbor && o.kind !== Kind.NeighborNucleus && o.kind !== Kind.Cell);
  /** how clear the line from p out along n is, up to `reach` (the nearest other surface, nm) */
  const clearance = (p: Vec3, n: Vec3, reach: number, skip: Organelle) => {
    let m = 1e9;
    const list = others(skip);
    for (let t = 20; t <= reach; t += reach / 12) {
      const q = vec3.scaleAndAdd(vec3.create(), p, n, t);
      for (const o of list) {
        if (vec3.distance(q, o.center as Vec3) > o.bound + 200) continue;
        m = Math.min(m, sdOrganelle(o, q));
      }
    }
    return m;
  };
  const wedge: Vec3 = [Math.sin(WEDGE.yaw), 0, Math.cos(WEDGE.yaw)];

  // the nuclear envelope: an upper spot, outside the wedge, with the clearest view out through the ER
  let pore = { p: vec3.create(), n: vec3.create(), c: -1e9 };
  for (const u of fibonacci(400)) {
    if (u[1] < 0.25) continue;
    const p = vec3.scaleAndAdd(vec3.create(), nuc.a as Vec3, u, blobRadius(nuc, u));
    if (wedgeDepth(p) > -0.25) continue;
    const n = normalOf(nuc, p);
    const c = clearance(p, n, 500, nuc);
    if (c > pore.c) pore = { p, n, c };
  }
  // the plasma membrane: an open stretch on the upper side, away from the wedge
  let mem = { p: vec3.create(), n: vec3.create(), c: -1e9 };
  for (const u of fibonacci(300)) {
    if (u[1] < 0.15) continue;
    const p = vec3.scale(vec3.create(), u, blobRadius(cell, u));
    if (wedgeDepth(p) > -0.3) continue;
    const n = normalOf(cell, p);
    const c = clearance(p, vec3.negate(vec3.create(), n), 300, cell) + u[1] * 50;
    if (c > mem.c) mem = { p, n, c };
  }
  // chromatin well inside the nucleus and outside the wedge
  const chrom = w.filaments.filter((f) => f.kind === FilKind.Chromatin);
  let chromP: Vec3 = chrom[0].points[0] as Vec3;
  for (const f of chrom) {
    const p = f.points[Math.floor(f.points.length / 2)] as Vec3;
    if (wedgeDepth(p) < -0.35 && sdOrganelle(nuc, p) < -900 && O.every((o) => o.kind !== Kind.Nucleolus || sdOrganelle(o, p) > 400)) { chromP = p; break; }
  }
  // a mitochondrion in open cytoplasm outside the wedge, and a crista in it
  const mitos = O.filter((o) => o.kind === Kind.Mito && wedgeDepth(o.center as Vec3) < -0.25 && sdOrganelle(nuc, o.center as Vec3) > 900);
  const mito = mitos.sort((a, b) => clearance(b.center as Vec3, vec3.normalize(vec3.create(), b.center as Vec3), 1500, b) - clearance(a.center as Vec3, vec3.normalize(vec3.create(), a.center as Vec3), 1500, a))[0] ?? O.find((o) => o.kind === Kind.Mito)!;
  const mi = O.indexOf(mito);
  const cristae = O.filter((o) => o.kind === Kind.Crista && o.parent === mi);
  const crista = cristae[Math.floor(cristae.length / 2)];
  const cristaP = vec3.scaleAndAdd(vec3.create(), crista.a as Vec3, crista.b as Vec3, crista.thick / 2);
  // a sheet of rough ER outside the wedge: its face away from the nucleus
  const ers = O.filter((o) => o.kind === Kind.ER && wedgeDepth(o.a as Vec3) < -0.3);
  const er = ers.sort((a, b) => clearance(vec3.scaleAndAdd(vec3.create(), b.a as Vec3, b.b as Vec3, -b.thick / 2), vec3.negate(vec3.create(), b.b as Vec3), 400, b) - clearance(vec3.scaleAndAdd(vec3.create(), a.a as Vec3, a.b as Vec3, -a.thick / 2), vec3.negate(vec3.create(), a.b as Vec3), 400, a))[0];
  const erN = vec3.negate(vec3.create(), er.b as Vec3);
  const erP = vec3.scaleAndAdd(vec3.create(), er.a as Vec3, erN, er.thick / 2);
  const golgi = O.filter((o) => o.kind === Kind.Golgi)[3];
  // a microtubule out in open cytoplasm
  let mtP: Vec3 = w.centrosome;
  outer: for (const f of w.filaments) {
    if (f.kind !== FilKind.Microtubule) continue;
    for (let i = 4; i < f.points.length - 4; i += 3) {
      const p = f.points[i] as Vec3;
      if (wedgeDepth(p) > -0.3 || sdOrganelle(nuc, p) < 1800 || sdOrganelle(cell, p) > -900) continue;
      if (O.every((o) => o.kind === Kind.Cell || o.kind === Kind.Neighbor || o.kind === Kind.NeighborNucleus || vec3.distance(p, o.center as Vec3) > o.bound + 350 || sdOrganelle(o, p) > 350)) { mtP = p; break outer; }
    }
  }
  const P = (id: string, name: string, art: string, line: string, view: View, play?: string): Place => ({ id, name, art, line, ...view, play });
  const down = (v: Vec3, k: number): Vec3 => [v[0], v[1] - k, v[2]];
  return [
    P('tissue', 'Tissue', 'tissue', 'A sheet of human cells, each about 20 µm across — a fifth of a hair\'s width.', { at: [0, 0, 0], scale: 46000, yaw: WEDGE.yaw, pitch: -0.62 }),
    P('cell', 'The cell', 'cell', 'Cut open: the nucleus, the ER folded round it, the Golgi, mitochondria, and the cytoskeleton holding it all.', { at: [0, 300, 0], scale: 21000, yaw: WEDGE.yaw, pitch: -0.42 }),
    P('nucleus', 'Nucleus', 'nucleus', 'Two metres of DNA folded into a ball a few microns across, behind a double membrane.', from(nuc.a as Vec3, down(vec3.negate(vec3.create(), wedge), 0.45), 8800)),
    P('pore', 'Nuclear pore', 'nucleus', 'Gates in the nuclear envelope, 120 nm across, each built of ~1,000 proteins. Messenger RNA leaves through them.', across(pore.p, pore.n, 360, 0.5)),
    P('dna', 'DNA', 'dna', 'Chromatin: DNA wound round histone spools — nucleosomes — and the double helix between them.', { at: chromP, scale: 55, yaw: 0.4, pitch: -0.3 }, 'polymerase'),
    P('mito', 'Mitochondrion', 'mito', 'The power plant: an outer membrane, and an inner one folded into cristae where ATP is made.', from(mito.center as Vec3, down(vec3.normalize(vec3.create(), vec3.negate(vec3.create(), mito.center as Vec3)), 0.4), 2600)),
    P('atp', 'ATP synthase', 'atp', 'Rotary motors packed along the cristae, spun by protons, each turn making three ATP.', across(cristaP, crista.b as Vec3, 75, 0.75), 'atp'),
    P('er', 'Rough ER', 'er', 'Sheets studded with ribosomes making proteins straight into the ER.', across(erP, erN, 320, 0.8), 'ribosome'),
    P('golgi', 'Golgi', 'cell', 'A stack of flattened sacs that finishes proteins and ships them in vesicles.', from(golgi.center as Vec3, down(vec3.negate(vec3.create(), wedge), 0.5), 3600)),
    P('mt', 'Microtubules', 'kinesin', 'Tracks of tubulin 25 nm wide. Kinesin motors walk them, hauling vesicles toward the cell\'s edge.', { at: mtP, scale: 130, yaw: 1.2, pitch: -0.25 }, 'kinesin'),
    P('membrane', 'Membrane', 'membrane', 'The cell\'s skin: a lipid bilayer 5 nm thick, with receptors, pumps, channels and a coat of sugars.', across(mem.p, mem.n, 110, 1.05)),
  ];
}
