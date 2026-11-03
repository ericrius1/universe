// Camera motion blur and flight's speed lines (motionblur.wgsl), the first step of the post chain when it's on: a
// fullscreen pass from the resolved scene and its depth into its own target, which the rest of the chain then reads.
// The shutter and the lines' weight are set by whoever drives the camera (the player: the blur and the lines only in
// fast flight); both 0 leave the image alone at no cost.
import type { Kit, RenderPass, Texture, UniformBuffer } from '@ericrius1/weft';
import shader4 from './motionblur.wgsl';
import shader1 from './motionblur1.wgsl';
import { tier } from '../util/tier';

const shader = tier.msaa === 4 ? shader4 : shader1;

export class MotionBlur {
  readonly out: Texture;
  private u: UniformBuffer<any>;
  private pass: RenderPass;
  /** shutter (1 = a frame's motion), the longest smear (px at 1080 lines), the near mask (m), taps */
  settings = { shutter: 0, maxPx: 40, near0: 1.2, near1: 3.5, taps: 10 };
  /** the speed lines: weight (0 off), lines round, their reach and the clear middle (of the picture's height), where
   *  the middle is (of its height, from the top), and which deal of them shows (re-dealt to flicker) */
  speed = { w: 0, lines: 150, reach: 0.7, clear: 0.36, middle: 0.48, deal: 0 };
  /** the player's circle on screen (px), its radius (px), their distance (m), their own motion (px); null: none */
  her: { x: number; y: number; r: number; d: number; vx: number; vy: number } | null = null;

  constructor(kit: Kit, hdr: Texture, depth: Texture) {
    this.out = kit.texture({ label: 'hdr.blurred', format: 'rgba16float', size: tier.motionBlur ? 'render' : [1, 1] });
    this.u = kit.uniforms(shader.structs.MotionU, 'motionblur');
    this.pass = kit.pass({ label: 'motionblur', color: [{ target: this.out, clear: false }] });
    // (where the profile has none, nothing to draw: its pipeline not compiled)
    if (tier.motionBlur) this.pass.fullscreen(shader, { label: 'motionblur', bind: { MU: this.u, src: hdr, depth } as never });
  }

  /** the panel's switch: off, none at all (and off from the start where the device's profile has none: util/tier.ts) */
  allowed = tier.motionBlur;
  /** is it doing anything this frame */
  get active() { return this.allowed && (this.settings.shutter > 0.001 || this.speed.w > 0.001); }

  run(height: number): RenderPass[] {
    if (!this.active) return [];
    const s = this.settings, h = this.her;
    this.u.set({
      a: [s.shutter, s.maxPx * height / 1080, s.near0, s.near1],
      her: h ? [h.x, h.y, h.r, h.d] : [0, 0, 0, 0],
      herV: h ? [h.vx, h.vy, s.taps, 0] : [0, 0, s.taps, 0],
      speed: [this.speed.w, this.speed.lines, this.speed.reach, this.speed.clear],
      deal: [this.speed.deal, this.speed.middle, 0, 0],
    });
    return [this.pass];
  }
}
