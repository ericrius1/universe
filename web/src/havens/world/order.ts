/** the scene pass's draw order: each part of the world draws into its slot whenever it's built (util/slots.ts). Apart
 *  from app.ts (the running game, all of it) so what draws into the scene — the parts, a host's embed — needn't reach it */
export const SCENE_ORDER = [
  'terrain', 'land', 'haven', 'city', 'rocks', 'flora', 'hero', 'glider', 'bison', 'opaque',
  'sky', 'stars', 'aurora', 'water', 'air', 'fire', 'smoke', 'glass', 'late',
] as const;
export type SceneSlot = (typeof SCENE_ORDER)[number];
