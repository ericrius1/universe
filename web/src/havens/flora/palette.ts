// The flora's colours (art/BIBLE.md: the gardens are the only saturated greens and blossoms in a red world, and must
// sing against it). Linear rgb from sRGB hex. Leaves are baked into the meshes; petals and bracts are baked as their
// shading only (near white) and take each instance's bloom colour, picked here from a bed's colour family, so one
// tulip mesh blooms pink in one bed and gold in the next and no two in a drift are quite the same.
import { hex, type V3 } from './mesh';

export const C = {
  // the lawn: deep at the root to a bright yellow-green at the tips (bible lawn #7DAA4A)
  lawnRoot: hex('#3d6a2a'), lawnMid: hex('#679a3c'), lawnTip: hex('#a9cf5e'), lawnDry: hex('#b9c06a'),
  // leaves: the flowers' fresh greens, the shrubs' deep leaf (bible #3F6E3A), the strap leaves' blue-green
  leaf: hex('#4f8a37'), leafLight: hex('#7fb04c'), leafDeep: hex('#2f5a2a'), leafBlue: hex('#5f8f6a'), leafYellow: hex('#9cbc4a'),
  box: hex('#3f7a35'), boxLight: hex('#74a548'), boxDeep: hex('#24482a'),
  // the cypress: dark, cool, the concept's exclamation marks
  cypress: hex('#27462a'), cypressLight: hex('#456c3c'), cypressDeep: hex('#112114'),
  // bark
  barkBlossom: hex('#4a3330'), barkBlossomLight: hex('#6e5048'), barkOlive: hex('#6c6156'), barkOliveLight: hex('#958b7c'),
  barkPom: hex('#6a4b38'), barkCypress: hex('#5a4232'), stemGreen: hex('#4c7a34'), wood: hex('#5d4636'),
  // the olive's silver-green, the pomegranate's glossy dark leaf and scarlet flowers, its fruit
  olive: hex('#86937a'), oliveSilver: hex('#c3c8b0'), pom: hex('#2f5e2a'), pomFlower: hex('#e2452f'), pomFruit: hex('#b8322a'),
  // the date palm: fronds, the older drooping ones, the trunk's leaf-base rings, the dates
  frond: hex('#5f9440'), frondTip: hex('#9cbc52'), frondOld: hex('#a59a5c'), palmTrunk: hex('#7e5f42'), palmRing: hex('#5a4230'), dates: hex('#d9822b'),
  // bougainvillea's leaves among its bracts (the bracts take the bloom colour)
  bougLeaf: hex('#3e6b32'),
  // the lotus: pads, their paler centres and reddish undersides, the seed pod
  pad: hex('#4f8a3a'), padLight: hex('#7cae4e'), padUnder: hex('#7a4a3a'), lotusPod: hex('#e3c23c'),
  // flowers' hearts
  discGold: hex('#e9b830'), discBrown: hex('#6b3a1e'), discOrange: hex('#d9762a'), stamen: hex('#f2c84a'), anther: hex('#9a4a1a'),
  // the canyon's own: scrub, bunchgrass, agave
  scrub: hex('#868c76'), scrubLight: hex('#afb39a'), scrubStem: hex('#6b5b48'), tuft: hex('#b8ae74'), tuftBase: hex('#7e8c52'),
  agave: hex('#6f9a8c'), agaveEdge: hex('#c9b96c'), agaveBase: hex('#4f7266'),
  // urns: terracotta, bronze, cream stone; the soil in them
  terracotta: hex('#b4593a'), bronze: hex('#8c6b3a'), creamStone: hex('#d8c7a3'), potSoil: hex('#3a2a20'),
  fern: hex('#4e8a3e'), fernTip: hex('#86b052'),
  // the shading baked into petals (multiplied by the bloom colour): white at the tip, a touch warm toward the base
  petalTip: [1, 1, 1] as V3, petalBase: hex('#e8dcd2'), petalBaseWarm: hex('#f3dca0'),
} as const;

/** the colour families a flower bed is planted in (GardenBed.palette) */
export type Family = 'pink' | 'white' | 'gold' | 'purple' | 'mixed';

/** blooms by family (sRGB hex; each instance takes one, varied a little) */
export const BLOOMS: Record<Exclude<Family, 'mixed'>, string[]> = {
  pink: ['#e58fb0', '#f2a7c3', '#d9668f', '#f7c6d6', '#c94f7c', '#ee8aa8'],
  white: ['#f7f3ea', '#fbf8f2', '#f3ebd8', '#eee6f2', '#f6efe0'],
  gold: ['#f2c14e', '#f5a623', '#ffd75e', '#e8892b', '#f7cf3a'],
  purple: ['#8e5ce0', '#a77bd8', '#6b4aa8', '#c58be0', '#7a3fa0', '#9b6fd0'],
};
/** the blossom trees' pinks and whites (bible blossom pink #E58FB0) */
export const BLOSSOM = { pink: ['#e58fb0', '#f0a6c0', '#ea9ab8', '#f4b8cc'], white: ['#f8f1f0', '#f6e6ec', '#fbf6f2'] };
/** bougainvillea's magentas (bible #C2378A) */
export const BOUGAINVILLEA = ['#c2378a', '#d6479b', '#b02c7c', '#cf3f93', '#e05aa8'];
/** lotus pinks */
export const LOTUS = ['#f2a7c3', '#f5b8cf', '#ee98b8', '#f8d0de'];
