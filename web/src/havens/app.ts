// What the running game is made of (main.ts builds it; the panel, the dev handle and the tools read it): the kit, the
// ground, the environment (sky, clock, light, shadows), the post chain, the scene's draw order, the player and who
// they are, the builders' parts, the rocks and the flora, and how long each took to load. window.app holds it while the
// page runs.
import type { Kit, RenderPass } from '@ericrius1/weft';
import type { Terrain } from './world/terrain';
import type { Env } from './world/env';
import type { Post } from './post/post';
import type { Slots } from './util/slots';
import type { CastPlayer } from './hero/cast';
import type { Cast } from './play/cast';
import type { FireFx } from './iroh/fire';
import type { ArchRenderer } from './arch/arch';
import type { Rocks } from './rocks/rocks';
import type { Flora } from './flora/flora';

/** the scene pass's draw order: each part of the world draws into its slot whenever it's built (util/slots.ts) */
export const SCENE_ORDER = [
  'terrain', 'land', 'haven', 'city', 'rocks', 'flora', 'hero', 'glider', 'opaque',
  'sky', 'stars', 'aurora', 'water', 'air', 'fire', 'smoke', 'glass', 'late',
] as const;
export type SceneSlot = (typeof SCENE_ORDER)[number];

export interface App {
  kit: Kit;
  terrain: Terrain;
  env: Env;
  post: Post;
  /** the scene pass (4x MSAA HDR, reversed depth) and its slots */
  scene: RenderPass;
  order: Slots<SceneSlot>;
  /** the player's body for the whole cast, and who of them it is */
  player: CastPlayer;
  cast: Cast;
  fire: FireFx;
  /** the city's and the Haven's architecture; the rocks; the gardens' flora (none with the test village) */
  arch: ArchRenderer;
  rocks: Rocks;
  flora: Flora | null;
  /** when each part of the world was in (ms since the page was asked for: kit, canyon, carve, cityBuilt, city,
   *  havenBuilt, haven, rocks, world, ready) */
  load: LoadTimes;
  stats: { fps: number; ms: number; nodes: number };
}

export type LoadTimes = Record<string, number>;
