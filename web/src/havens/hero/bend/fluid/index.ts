// Katara's water as one thing for main.ts — the waterbending app's engine: the fluid sim (fluid.ts), its screen-space
// look (render.ts), the spray (spray.ts), the ice floes (floes.ts) and the charge (energy.ts), sized by fluidProfile.
// The bending brain drives `fluid`, `floes`, `spray` and `energy` as the app's drove its own; this wires them into the
// frame — what draws into which pass, and the order of each frame's updates and passes. Everything is idle (no passes,
// no draws) while there's no water about.
import type { Kit, RenderPass, RunEntry, Texture } from '@ericrius1/weft';
import { Fluid, fluidProfile, type FluidProfile, type WaterLevel } from './fluid';
import { FluidRender } from './render';
import { Spray } from './spray';
import { Floes } from './floes';
import { Energy, type ChargeState } from './energy';

export { Fluid, fluidProfile, MAX_PATH, MAX_GROUPS, MAX_LANDINGS, PARTICLE_BYTES } from './fluid';
export type { FluidProfile, FluidStats, IceGroup, PathPoint, Splash, WaterLevel } from './fluid';
export { FluidRender } from './render';
export { Spray } from './spray';
export type { Emit, SprayKind, Attract } from './spray';
export { Floes } from './floes';
export type { Floe } from './floes';
export { Energy, lubdub } from './energy';
export type { ChargeState } from './energy';

export class BentWater {
  readonly profile: FluidProfile;
  readonly spray: Spray;
  readonly fluid: Fluid;
  readonly render: FluidRender;
  readonly floes: Floes;
  readonly energy: Energy;
  /** the bending's charge this frame (null: the charge rests) — update's when it isn't given one */
  charge: ChargeState | null = null;

  constructor(readonly kit: Kit, profile = fluidProfile()) {
    this.profile = profile;
    this.spray = new Spray(kit, profile.spray);
    this.fluid = new Fluid(kit, profile, this.spray);
    this.render = new FluidRender(kit, this.fluid);
    this.floes = new Floes(kit);
    this.energy = new Energy(this.fluid, this.render, this.spray, () => kit.camera.position);
  }

  /** the water round her, up to four bodies of it (the brain sets it from the sources): where the bent water and the
   *  spray fall back in */
  set waters(w: WaterLevel[]) { this.fluid.waters = w; this.spray.waters = w; }
  get waters() { return this.fluid.waters; }

  /** setup: the floes into the scene pass (opaque) */
  drawScene(scene: RenderPass) { this.floes.draw(scene); }

  /** setup: the bent water's and the floes' shadows, for each of shadows.passes */
  drawShadow(pass: RenderPass, cascade: number) {
    this.render.drawShadow(pass, cascade);
    this.floes.drawShadow(pass, cascade);
  }

  /** setup: into the pass over the finished scene (post.fx.overlay), after the clouds — the bent water's composite, the
   *  charge's light in it, then the spray. `hdr` is the scene it targets, `sceneZ` its distances (post.fx.sceneZ) */
  drawOverlay(overlay: RenderPass, hdr: Texture, sceneZ: Texture) {
    this.render.draw(overlay, hdr, sceneZ);
    this.spray.draw(overlay, sceneZ, this.render.depth, this.render.depthScale, () => this.render.active);
  }

  /** every frame, after the bending brain (it set its requests, its path, the waters, the charge) */
  update(dt: number, charge = this.charge) {
    if (charge) this.energy.update(dt, charge);
    this.fluid.update(dt);
    this.render.update(dt);
    this.spray.update(dt, this.fluid.running);
    this.floes.update(dt);
  }

  /** the sims, before the scene (the fluid's, then the spray's: it takes the fluid's splash events); main.ts runs
   *  them before the shadow passes, so the bent water's shadow is this frame's */
  simPasses(): RunEntry[] { return [...this.fluid.passes(), ...this.spray.passes()]; }

  /** the screen-space passes: after the scene's distances (post.fx.sceneZ's pass) and before the overlay */
  renderPasses(): RunEntry[] { return this.render.passes(); }
}
