// The cell's realm: the world (world/layout.ts), its systems (organelles, filaments, molecules, walkers), its renderer and
// camera, its places, its cards and its games — a chunk of its own, fetched and built only when the window takes in the
// cell (windows.ts; main.ts builds it, App.attachCell takes it). The app reaches the cell's code only through this.
import type { Kit } from '@ericrius1/weft';
import type { Vec3 } from 'math';
import { buildWorld, sdOrganelle, Kind, WEDGE, type World } from './world/layout';
import { packOrganelles, Organelles } from './world/organelles';
import { Filaments, type FilamentSet } from './world/filaments';
import { Molecules } from './world/molecules';
import { Field } from './world/field';
import { Walkers } from './world/walkers';
import { Renderer } from './engine/renderer';
import { Controls } from './engine/camera';
import { buildPlaces, type Place } from './ui/places';
import { cardFor, type Card } from './ui/info';
import { GAMES } from './play/game';
import './play/index';

export interface Cell {
  world: World;
  r: Renderer;
  controls: Controls;
  field: Field;
  walkers: Walkers;
  fil: FilamentSet;
  mols: Molecules;
  places: Place[];
  /** the wedge the cutaway opens */
  wedge: typeof WEDGE;
  games: typeof GAMES;
  /** an organelle's or a molecule's card */
  card(id: number): Card | null;
  /** the compartment a point is in (the innermost organelle containing it), and that organelle's index */
  where(p: Vec3): { name: string; org: number };
}

/** lay out the cell, build its membranes, fetch its molecules (`status` says how far along) */
export async function buildCell(kit: Kit, canvas: HTMLCanvasElement, o: { base: string; quality: number; status: (msg: string, f: number) => void; frame: () => Promise<unknown> }): Promise<Cell> {
  const { status, quality } = o;
  status('laying out the cell…', 0.12);
  await o.frame();
  const world = buildWorld();
  const r = new Renderer(kit, packOrganelles(kit, world), quality);
  status('building membranes…', 0.25);
  await o.frame();
  new Organelles(kit, r, world, quality);
  const filaments = new Filaments(kit, r, world);
  const pdbMsg = 'gathering molecules…';
  status(pdbMsg, 0.4);
  const mols = await Molecules.load(kit, o.base, (f) => status(pdbMsg, 0.4 + f * 0.25));
  const field = new Field(kit, r, mols, filaments.set, quality);
  const walkers = new Walkers(world, filaments.set, field);
  const controls = new Controls(canvas);
  return {
    world, r, controls, field, walkers, fil: filaments.set, mols, places: buildPlaces(world), wedge: WEDGE, games: GAMES,
    card: (id) => cardFor(id, (i) => world.organelles[i]?.kind ?? -1),
    where: (p) => where(world, p),
  };
}

function where(world: World, p: Vec3): { name: string; org: number } {
  const O = world.organelles;
  let best = -1, depth = -1;
  for (let i = 0; i < O.length; i++) {
    const o = O[i];
    if (Math.hypot(p[0] - o.center[0], p[1] - o.center[1], p[2] - o.center[2]) > o.bound) continue;
    if (sdOrganelle(o, p) < 0) {
      let d = 0;
      for (let q = o.parent; q >= 0; q = O[q].parent) d++;
      if (d > depth) { depth = d; best = i; }
    }
  }
  if (best < 0) return { name: 'outside', org: -1 };
  const k = O[best].kind;
  const name = k === Kind.Nucleus || k === Kind.Nucleolus ? 'nucleus' : k === Kind.Mito || k === Kind.Crista ? 'mito'
    : k === Kind.ER ? 'er' : k === Kind.Golgi ? 'golgi' : k === Kind.Neighbor || k === Kind.NeighborNucleus ? 'neighbor' : 'cytosol';
  return { name, org: best };
}
