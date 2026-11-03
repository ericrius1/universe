// The third-person camera behind her (after the waterbending game's): the aim's yaw and pitch, where the mouse (or a
// finger) puts them, followed by a critically damped spring — stiff on foot, looser in flight so the picture leans
// into her turns a beat behind her; a little over her shoulder walking, centred and higher flying, pulled back with
// speed, the field of view opening with it, banking with her. It never passes through the house, a trunk or the
// ground: the way back from her head is cast against them and the camera stops short (quick to pull in, slow to let
// back out). Over and in the water: skimming it rides a little higher, looking down the length of her wake; it keeps
// out of the water while she isn't under it and follows her through the surface when she goes in — eased across, it
// crosses when its own path does, a beat after her, and back out the same way — a little closer under water, and never
// on the water's plane (the lens is in the air or in the water).
import type { Camera } from '@ericrius1/weft';
import { type V3, add, sub, scale, norm, cross, clamp, lerp, smoothstep, damp, cdSpring, len } from './math';
import type { HeroWorld } from './world';

/** the view's height (rad) before flight's kick: 55 degrees */
const userFov = () => (55 * Math.PI) / 180;

export interface CamSubject {
  pos: V3; yaw: number; head: V3; vel: V3; speed: number; flying: boolean; boostK: number; flyRoll: number; aiming: boolean;
  /** swimming (0 no, 1 at the surface, 2 under) and the water's level where she is */
  swim?: number; water?: number | null;
  /** how far she's skimming the water (0..1), the water under her in flight (null: none near) */
  skim?: number; overWater?: number | null;
}

export class HeroCamera {
  /** the aim (the mouse moves it) */
  yaw = 0;
  pitch = -0.15;
  /** distance behind her (the wheel sets it) */
  dist = 3.4;
  /** extra field of view (rad) from speed */
  fovKick = 0;
  baseFov = userFov();
  private vYaw = 0; private vPitch = 0; private vYawV = 0; private vPitchV = 0;
  private flyCam = 0; private aimCam = 0; private underCam = 0; private skimCam = 0;
  /** the lens is under the water; how far it's being lifted out of it (eased: it follows her up through the surface) */
  private lensUnder = false; private lensLift = 0;
  /** (after a fast plunge it waits above the water a moment — the crown, the cavity — before following her down) */
  private holdAbove = 0; private swimWas = 0;
  /** a held shot: after a fast plunge the view waits where it was, on the crater (the crown, the jet), then goes down
   *  after her; bursting out it stays low by the water a beat, drifting after her, looking up at her as she climbs out
   *  of the column. Then eased back to the follow view (`back`: how far, 1 at its start) */
  private held: { t: number; eye: V3; at: V3 | null; drift: V3 } | null = null;
  private back = 0; private backEye: V3 = [0, 0, 0]; private backDir: V3 = [0, 0, -1];
  private distS = -1;
  private smooth: V3 | null = null;
  /** where she was last frame (the smoothing rides along by what she actually moved) */
  private lastPos: V3 | null = null;
  private roll = 0;
  /** is a mirror close before her, along the view (interior/mirrors.ts; main.ts sets it)? Then the camera keeps over
   *  her shoulder and rises a little, so her reflection shows past her head (straight behind her, close in a small
   *  bathroom, her head would hide it) */
  mirrorAhead: ((pos: V3, fwd: V3) => boolean) | null = null;
  private mirrorCam = 0;
  /** a view orbiting her that leaves the aim alone (photos, checks): yaw from her facing, pitch, distance, height */
  orbit: { yaw: number; pitch: number; dist: number; h?: number; /** (its middle, when it's not her: a yoga mat's) */ at?: V3 } | null = null;

  /** look at once from behind her (a cut) */
  reset(yaw: number) { this.yaw = yaw; this.vYaw = yaw; this.vPitch = this.pitch; this.vYawV = this.vPitchV = 0; this.smooth = null; this.distS = -1; this.lensLift = 0; this.held = null; this.back = 0; }

  update(dt: number, cam: Camera, h: CamSubject, world: HeroWorld) {
    this.pitch = clamp(this.pitch, -1.3, 0.85);
    // (shooting through the water after a plunge it keeps flight's framing until she's slowed to a swim)
    this.flyCam = damp(this.flyCam, h.flying || (h.swim === 2 && h.speed > 4.5) ? 1 : 0, 2.5, dt);
    const skimV = h.flying ? (h.skim ?? 0) * smoothstep(6, 18, h.speed) : 0;
    this.skimCam = damp(this.skimCam, skimV, skimV > this.skimCam ? 1.6 : 0.8, dt);
    this.aimCam = damp(this.aimCam, h.aiming ? 1 : 0, 4, dt);
    const wv = lerp(24, 11, this.flyCam * (1 - this.aimCam));
    const dy = Math.atan2(Math.sin(this.yaw - this.vYaw), Math.cos(this.yaw - this.vYaw));
    [this.vYaw, this.vYawV] = cdSpring(this.vYaw, this.vYawV, this.vYaw + dy, wv, dt);
    [this.vPitch, this.vPitchV] = cdSpring(this.vPitch, this.vPitchV, this.pitch, wv, dt);
    const cp = Math.cos(this.vPitch), sp = Math.sin(this.vPitch);
    const fwd: V3 = [-Math.sin(this.vYaw) * cp, sp, -Math.cos(this.vYaw) * cp];
    const right = norm(cross(fwd, [0, 1, 0]));
    // the pivot: a little over her head walking, higher flying (she sits low in the frame, the way ahead open), a little
    // higher facing a mirror close by; under a ceiling, kept under it
    this.mirrorCam = damp(this.mirrorCam, !h.flying && this.mirrorAhead?.(h.pos, fwd) ? 1 : 0, 3, dt);
    const base: V3 = [h.pos[0], h.pos[1] + 0.3, h.pos[2]];
    const py = 1.25 + 0.7 * this.flyCam * (1 - this.aimCam) + 0.14 * this.mirrorCam + 0.45 * this.skimCam * (1 - this.aimCam);
    const pivot: V3 = [h.pos[0], base[1] + py * world.clearAlong(base, [h.pos[0], base[1] + py, h.pos[2]], 0.25), h.pos[2]];
    const off = lerp(lerp(0.32, 0.55, this.aimCam), 0.0, this.flyCam * (1 - this.aimCam));
    // (the shoulder point itself kept clear of a wall beside her)
    const head: V3 = [h.pos[0], pivot[1], h.pos[2]];
    const want = add(pivot, scale(right, off));
    let shoulder = add(head, scale(sub(want, head), world.clearAlong(head, want, 0.18)));
    this.underCam = damp(this.underCam, h.swim === 2 ? 1 : 0, 3, dt);
    // (under water it comes in close: the lake's murk hides her past a few metres, more so shooting through it fast)
    let dist = this.dist * (1 - 0.15 * this.aimCam) * (1 + this.flyCam * (0.25 + Math.min(h.speed, 40) * 0.012 + 0.3 * h.boostK));
    dist = lerp(dist, Math.min(dist, 2.6), this.underCam);
    let clear = world.clearAlong(shoulder, sub(shoulder, scale(fwd, dist)), 0.22);
    // (close in — a stairwell, a corridor — she's kept nearer the middle: the shoulder offset shrinks with the room)
    if (clear * dist < 1.4 && off > 0) {
      shoulder = add(head, scale(sub(shoulder, head), Math.max(clamp((clear * dist - 0.4) / 1.0, 0, 1), this.mirrorCam)));
      clear = world.clearAlong(shoulder, sub(shoulder, scale(fwd, dist)), 0.22);
    }
    dist *= clear;
    dist = Math.max(dist, 0.35);
    this.distS = this.distS < 0 ? dist : damp(this.distS, dist, dist < this.distS ? 18 : 2.5, dt);
    // (never further than what's clear now: easing out never pushes it through anything)
    const d = Math.min(this.distS, dist);
    let eye = sub(shoulder, scale(fwd, d));
    // flying it rides along with her so speed never drags it back; walking a light smoothing keeps it steady. (By her
    // step, not vel * dt: held by the ground, a wall or the water, her velocity isn't her motion, and the lag that left
    // changed with every frame's length — a tremble under uneven frame times)
    if (this.smooth && this.lastPos && this.flyCam > 0.01) this.smooth = add(this.smooth, scale(sub(h.pos, this.lastPos), this.flyCam));
    this.lastPos = [h.pos[0], h.pos[1], h.pos[2]];
    if (!this.smooth || len(sub(this.smooth, eye)) > 8) this.smooth = eye;
    const k = 1 - Math.exp(-dt * 30), ky = 1 - Math.exp(-dt * 16);
    this.smooth = [this.smooth[0] + (eye[0] - this.smooth[0]) * k, this.smooth[1] + (eye[1] - this.smooth[1]) * ky, this.smooth[2] + (eye[2] - this.smooth[2]) * k];
    // (the smoothing may lag behind a wall: what's clear from her shoulder wins)
    const sd = len(sub(this.smooth, shoulder));
    eye = sd > d + 0.02 ? add(shoulder, scale(norm(sub(this.smooth, shoulder)), d)) : this.smooth;
    // (out of the water while she isn't under it — lifted out at once from the air's side, eased up out of it after her
    // when it's under — and never on its plane: it crosses only once where it's going is clear of the surface on the
    // other side)
    if (h.water !== undefined && h.water !== null) {
      const wl = h.water, B = 0.12;
      if (h.swim === 2 && this.swimWas !== 2 && !this.lensUnder && h.speed > 6) this.holdAbove = 0.45;
      this.holdAbove = Math.max(0, this.holdAbove - dt);
      const lift = h.swim !== 2 || this.holdAbove > 0 ? Math.max(0, wl + 0.25 - eye[1]) : 0;
      this.lensLift = this.lensUnder ? damp(this.lensLift, lift, lift > this.lensLift ? 9 : 20, dt) : lift;
      let y = eye[1] + this.lensLift;
      if (this.lensUnder ? y > wl + B : y < wl - B) this.lensUnder = !this.lensUnder;
      y = this.lensUnder ? Math.min(y, wl - B) : Math.max(y, wl + B);
      eye = [eye[0], y, eye[2]];
    } else { this.lensUnder = false; this.lensLift = 0; }
    // (the held shots: going in fast; bursting out)
    const sw = h.swim ?? 0, last: V3 = [cam.position[0], cam.position[1], cam.position[2]];
    if (h.water != null && !this.orbit) {
      if (sw === 2 && this.swimWas === 0 && h.speed > 6) this.held = { t: 0.6, eye: [last[0], Math.max(last[1], h.water + 0.5), last[2]], at: [h.pos[0], h.water + 0.6, h.pos[2]], drift: [0, 0, 0] };
      else if (sw === 0 && this.swimWas === 2 && h.speed > 4) this.held = { t: 0.9, eye: [last[0], Math.max(last[1], h.water + 0.45), last[2]], at: null, drift: [h.vel[0] * 0.3, 0, h.vel[2] * 0.3] };
    }
    this.swimWas = sw;
    this.roll = damp(this.roll, h.flying ? clamp(h.flyRoll * 0.35, -0.22, 0.22) * (1 - this.aimCam) : 0, 3, dt);
    const fovWant = h.flying ? 0.06 * smoothstep(14, 30, h.speed) + 0.36 * Math.pow(smoothstep(40, 315, h.speed), 0.8) : 0;
    this.fovKick = damp(this.fovKick, fovWant, 2.5, dt);
    if (this.orbit) {
      const o = this.orbit;
      const c: V3 = o.at ? [o.at[0], o.at[1], o.at[2]] : [h.pos[0], h.pos[1] + (o.h ?? 1.1), h.pos[2]];
      // (in a room the orbit stops short of the walls; where they're close it swings round toward behind her and up,
      // to the first place with room for it, rather than pushing in through her)
      let best: V3 = c, bestD = -1;
      for (let k = 0; k <= 6; k++) {
        const a = h.yaw + o.yaw * (1 - k / 6), pitch = o.pitch + 0.08 * k;
        const want: V3 = add(c, [Math.sin(a) * Math.cos(pitch) * o.dist, Math.sin(pitch) * o.dist, Math.cos(a) * Math.cos(pitch) * o.dist]);
        const d = world.clearAlong(c, want, 0.2) * o.dist;
        if (d > bestD) { bestD = d; best = add(c, scale(sub(want, c), d / o.dist)); }
        if (d >= Math.min(0.8, o.dist * 0.9)) break;
      }
      const e = best;
      cam.lookAt(e, c);
      cam.roll = 0;
      cam.fovY = this.baseFov;
      return;
    }
    // (skimming, the view looks a little further down the water than she steers: her wake and the spray in it)
    let look: V3 = this.skimCam > 1e-3 ? norm(add(fwd, [0, -0.13 * this.skimCam * (1 - this.aimCam), 0])) : fwd;
    if (this.held) {
      const H = this.held;
      H.t -= dt;
      H.eye = add(H.eye, scale(H.drift, dt));
      const at: V3 = H.at ?? h.head;
      const dir = norm(sub(at, H.eye));
      this.backEye = H.eye; this.backDir = dir;
      if (H.t <= 0) { this.held = null; this.back = 1; }
      cam.lookAt(H.eye, add(H.eye, dir));
      cam.roll = 0;
      cam.fovY = this.baseFov + this.fovKick;
      return;
    }
    if (this.back > 0) {
      // (eased back from the held shot to following her)
      this.back = Math.max(0, this.back - dt / 0.45);
      const k = smoothstep(0, 1, this.back);
      eye = [lerp(eye[0], this.backEye[0], k), lerp(eye[1], this.backEye[1], k), lerp(eye[2], this.backEye[2], k)];
      look = norm([lerp(look[0], this.backDir[0], k), lerp(look[1], this.backDir[1], k), lerp(look[2], this.backDir[2], k)]);
      // (never on the water's plane on the way)
      if (h.water != null && Math.abs(eye[1] - h.water) < 0.12) eye = [eye[0], h.water + (this.lensUnder ? -0.12 : 0.12), eye[2]];
    }
    cam.lookAt(eye, add(eye, look));
    cam.roll = this.roll;
    cam.fovY = this.baseFov + this.fovKick;
  }

  /** the aim's ray from the camera (where bending sends the water) */
  aimDir(): V3 {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return [-Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp];
  }
}
