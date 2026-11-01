// Play: become part of the cell. A game takes over the camera and the screen's lower half for a while, drives its own
// actors into the molecular field, and hands control back when it ends (or Esc). Each game registers itself here.
import type { Kit } from '@ericrius1/weft';
import type { Controls } from '../engine/camera';
import type { Field } from '../world/field';
import type { FilamentSet } from '../world/filaments';
import type { World } from '../world/layout';
import type { Molecules } from '../world/molecules';
import type { Hud } from '../ui/hud';

export interface GameCtx {
  kit: Kit;
  controls: Controls;
  field: Field;
  world: World;
  fil: FilamentSet;
  mols: Molecules;
  hud: Hud;
  /** a panel for the game's own interface (empty, shown while it runs) */
  panel: HTMLElement;
  /** the biological clock (seconds; slowed with zoom) and how fast it runs now */
  bioTime: () => number;
  /** play a sound cue (the score's events: 'good', 'bad', 'step', 'atp', 'win', 'pop', 'click') */
  sound: (name: string, strength?: number) => void;
  /** end the game and give the world back */
  exit: () => void;
}

export interface Game {
  id: string;
  /** who you become */
  role: string;
  title: string;
  blurb: string;
  /** the art card (public/art/<art>.webp) */
  art: string;
  start(ctx: GameCtx): void;
  update(dt: number): void;
  stop(): void;
}

export const GAMES: Game[] = [];
export function registerGame(g: Game) { GAMES.push(g); }
