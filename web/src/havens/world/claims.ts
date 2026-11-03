// Who builds where: the world cut into districts, each district's ground claimed by the owners that build on it, and
// the places where districts meet (ports) fixed in the shared plan, so builders working side by side meet by design.
// The rules (tools/geo-check.ts holds every build to them, and fails the build when one is broken):
//   - a claim is a plan polygon over a height range, held by one owner (an ArchBuilder.owner name: 'hall' holds what's
//     laid under 'hall' and 'hall/roof'). Two owners' 'build' claims never overlap; a 'way' (a street, a stair, a
//     causeway) may cross another's ground only where that one leaves a 'way' open for it; a 'keep' is held empty.
//   - every triangle an owner lays stands inside one of its own claims (a hand's breadth of slack at the edges).
//   - a port is where two districts' ways meet: its centre, its floor's height, its width and the way it faces. Both
//     sides build their way to it exactly (its floor walkable at its height within a few centimetres).
//   - each district has a budget: triangles as handed over, lights, colliders. The world's whole is the phone's.
// The world's layout (layout.ts) lists the claims, ports and budgets (CLAIMS, PORTS, BUDGETS).
import type { V2 } from './layout';

export type V3 = [number, number, number];

/** 'build': the owner's own ground; 'way': a passage that may cross others' 'way' openings; 'keep': held empty (a
 *  view, a clearing, the rock over the caverns) — nothing may be laid in it but by its owner */
export type ClaimKind = 'build' | 'way' | 'keep';

export interface Claim {
  /** unique name ('south/hall') */
  id: string;
  /** the district it's in ('south', 'citadel', 'east-tip', …) */
  district: string;
  /** the ArchBuilder owner that may lay in it (its triangles: owner or owner/…); '*' for a 'keep' nobody may */
  owner: string;
  kind: ClaimKind;
  /** its plan outline (world x, z), any winding */
  poly: V2[];
  /** its height range [bottom, top] (world y) */
  y: [number, number];
}

/** where two districts' ways meet: both build to it */
export interface Port {
  id: string;
  /** the two districts it joins */
  between: [string, string];
  /** its centre on the floor (world x, y, z) */
  p: V3;
  /** its width across (m) */
  width: number;
  /** the way through it, in plan (unit x, z) */
  dir: V2;
}

/** a district's budget: what its owners may hand over between them */
export interface Budget {
  district: string;
  /** triangles as built (before the bake refines round the lights) */
  triangles: number;
  lights: number;
  colliders: number;
}

/** an owner's claim on a triangle laid by `name` (an owner path: 'hall/roof' is the 'hall' claim's) */
export const ownedBy = (claimOwner: string, name: string) => claimOwner === '*' || name === claimOwner || name.startsWith(`${claimOwner}/`);

/** a point in a plan polygon (even-odd) */
export function inPoly(p: V2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** the distance from a plan point to a polygon's outline */
export function edgeDistance(p: V2[], x: number, z: number): number {
  let d = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const ax = p[j][0], az = p[j][1], ex = p[i][0] - ax, ez = p[i][1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
    d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return d;
}

/** a world point in a claim: in its outline (or within `slack` of it) and its height range (give or take `slack`) */
export function inClaim(c: Claim, x: number, y: number, z: number, slack = 0): boolean {
  if (y < c.y[0] - slack || y > c.y[1] + slack) return false;
  return inPoly(c.poly, x, z) || (slack > 0 && edgeDistance(c.poly, x, z) <= slack);
}

/** the claims an owner may lay under: its own and those of the owners it's laid under ('hall/roof' lays in 'hall''s);
 *  a 'keep' is nobody's to build in */
export const claimsOf = (claims: Claim[], name: string) => claims.filter((c) => c.kind !== 'keep' && c.owner !== '*' && ownedBy(c.owner, name));
