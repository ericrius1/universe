// The small parts a builder places instanced instead of laying into its mesh (README.md, "Mesh or instanced"): each by
// a name, laid at its default size at each detail level by the parts' own call. A builder hands over placements
// (ArchPart.instances: a name, a place, a yaw, a scale, a tint) and the world makes the prototypes it names once and
// draws them all (instances.ts), their lamps lighting the walls round them as a laid lantern's would. A placement's
// scale sizes the default one (a merlon 0.55 m wide, 0.75 tall and 0.4 thick, a lamp post 2.2 m to its lantern's
// foot: 1.2 for one a fifth bigger); a part whose options change its shape and not just its size (a grille fitted to
// its window) is laid into the mesh instead.
import type { ArchBuilder } from '../builder';
import type { Detail, Laid } from './kit';
import { baluster, type BalusterKind } from './balustrade';
import { grillePart, type GrilleKind } from './openings';
import { lantern, type LanternKind } from './lanterns';
import { bracket, finialPart, merlon, type BracketKind, type FinialKind, type MerlonKind } from './roofs';

type Lay = (b: ArchBuilder, d: Detail) => Laid | void;

const each = <K extends string>(kinds: readonly K[], lay: (k: K) => Lay) => Object.fromEntries(kinds.map((k) => [k, lay(k)])) as Record<K, Lay>;
const prefixed = <K extends string, P extends string>(p: P, r: Record<K, Lay>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [`${p}-${k}`, v])) as Record<`${P}-${K}`, Lay>;

/** every prototype a builder may name: `merlon-stepped`, `lantern-wall`, `finial-lotus`, … (each kind of each small
 *  part, at its defaults) */
export const PROTOS = {
  ...prefixed('merlon', each<MerlonKind>(['square', 'stepped', 'pointed', 'rounded'], (kind) => (b, d) => merlon(b, { kind, detail: d }))),
  ...prefixed('lantern', each<LanternKind>(['cage', 'paper', 'hanging', 'wall', 'post'], (kind) => (b, d) => lantern(b, { kind, detail: d }))),
  ...prefixed('finial', each<FinialKind>(['ball', 'spire', 'lotus'], (kind) => (b, d) => finialPart(b, { kind, detail: d }))),
  ...prefixed('bracket', each<BracketKind>(['stepped', 'scroll', 'beam', 'knee'], (kind) => (b, d) => bracket(b, { kind, detail: d }))),
  ...prefixed('baluster', each<BalusterKind>(['turned', 'square', 'lattice'], (kind) => (b, d) => baluster(b, { kind, detail: d }))),
  ...prefixed('grille', each<GrilleKind>(['diamond', 'square', 'bars'], (kind) => (b, d) => grillePart(b, { kind, detail: d }))),
};
export type ProtoName = keyof typeof PROTOS;
