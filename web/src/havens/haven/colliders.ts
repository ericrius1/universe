// The Haven's walking colliders: each is one of boulder's HouseCollision boxes-sets in its own plan frame (a yaw about
// an origin, plan heights = world heights since the origin sits at y 0), so curved terraces are cut into narrow
// radial strips (each one straight enough for axis-aligned boxes) and every flight, ramp and facet of the temple gets
// a frame lined up with it. A frame is authored in its plan units directly (x along its direction, y across it toward
// larger angles) and turned into a StructureCollider; planToWorld gives the matrix HouseCollider wants.
import type { GardenBed, LightSpot, StructureCollider, V3, WaterBody } from '../arch/types';
import type { V2 } from '../world/layout';

/** what the Haven's builders hand back besides the mesh */
export interface Haul { colliders: StructureCollider[]; lights: LightSpot[]; water: WaterBody[]; beds: GardenBed[] }

export class Frame {
  readonly solids: number[][] = [];
  readonly floors: number[][] = [];
  readonly stairs: number[][] = [];
  readonly doors: number[][] = [];
  private readonly c: number;
  private readonly s: number;

  /** plan +x runs along world direction a (0 east, π/2 south) from origin (x, z) */
  constructor(readonly name: string, readonly ox: number, readonly oz: number, readonly a: number) {
    // (StructureCollider's yaw is ArchBuilder's: plan x maps to world (cos yaw, -sin yaw), so yaw = -a)
    this.c = Math.cos(-a);
    this.s = Math.sin(-a);
  }

  /** world (x, z) -> plan (x, y) */
  plan(x: number, z: number): V2 {
    const dx = x - this.ox, dz = z - this.oz;
    return [this.c * dx - this.s * dz, this.s * dx + this.c * dz];
  }

  /** a floor (walkable at height h; open = under the sky) */
  floor(x0: number, y0: number, x1: number, y1: number, h: number, open = true) {
    if (x1 - x0 > 0.05 && y1 - y0 > 0.05) this.floors.push([x0, y0, x1, y1, h, open ? 1 : 0]);
    return this;
  }
  /** a solid box from height z0 to z1 */
  solid(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number) {
    if (x1 - x0 > 0.02 && y1 - y0 > 0.02 && z1 - z0 > 0.02) this.solids.push([x0, y0, x1, y1, z0, z1]);
    return this;
  }
  /** a flight (or a ramp): from base rising by rise across the box along axis 0 (x) or 1 (y), upward toward +axis when
   *  sign is 1 */
  stair(x0: number, y0: number, x1: number, y1: number, base: number, rise: number, axis: 0 | 1, sign: 1 | -1) {
    this.stairs.push([x0, y0, x1, y1, base, rise, axis, sign]);
    return this;
  }
  /** a doorway's sill and apron */
  door(x0: number, y0: number, x1: number, y1: number, h: number) {
    this.doors.push([x0, y0, x1, y1, h]);
    return this;
  }

  get empty() { return !this.solids.length && !this.floors.length && !this.stairs.length && !this.doors.length; }

  done(): StructureCollider {
    return { name: this.name, collision: { solids: this.solids, floors: this.floors, stairs: this.stairs, doors: this.doors }, origin: [this.ox, 0, this.oz], yaw: -this.a };
  }
}

/** a StructureCollider's plan -> world map as HouseCollider wants it (column-major 4x4; plan (x, h, y) -> world
 *  (x, y, z)): world = origin + (cos·x + sin·y, h, -sin·x + cos·y) with cos, sin of its yaw */
export function planToWorld(sc: StructureCollider): number[] {
  const c = Math.cos(sc.yaw), s = Math.sin(sc.yaw);
  const [ox, oy, oz] = sc.origin as V3;
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, ox, oy, oz, 1];
}
