// Vector helpers for the heroine: weft's, plus a rotation about an axis, an ease, a smooth bump, a critically damped
// spring stepped exactly, and the second-order follower (t3ssel8r's) that gives hands and head their follow-through.
export { add, sub, scale, dot, cross, len, dist, norm, lerp, lerp3, clamp, saturate, smoothstep, angDiff, type V3 } from '@ericrius1/weft';
import { cross, dot, type V3 } from '@ericrius1/weft';

/** v turned by a about the unit axis k (Rodrigues) */
export function rotateAxis(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a);
  const kv = cross(k, v), kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}

/** toward a target at rate k (1/s), frame-rate independent */
export const damp = (cur: number, target: number, k: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-k * dt));
export const damp3 = (cur: V3, target: V3, k: number, dt: number): V3 => {
  const t = 1 - Math.exp(-k * dt);
  return [cur[0] + (target[0] - cur[0]) * t, cur[1] + (target[1] - cur[1]) * t, cur[2] + (target[2] - cur[2]) * t];
};
export const ease = (t: number) => t * t * (3 - 2 * t);
/** the inverse of `ease` on 0..1: how far along a wind-up is for a value it has reached */
export const unease = (k: number) => { let a = 0, b = 1; for (let i = 0; i < 16; i++) { const m = (a + b) / 2; if (ease(m) < k) a = m; else b = m; } return (a + b) / 2; };
/** flight's throttle on its way to the cruise (0..1 of its wind-up -> 0..1 of the way from the start's pace to the
 *  cruise's): barely past a hop's pace the first two seconds, for fine moves, then on up to the cruise as ever (the
 *  user, 2026-10-29: "slow down the acceleration a bit in the first few seconds of flying") */
export const throttle = (t: number) => ease(t) ** 1.6;
/** the inverse of `throttle`: how far along the wind-up is for a pace it has reached */
export const unthrottle = (k: number) => unease(k ** (1 / 1.6));
/** minimum jerk 0..1: how a reaching hand or a swinging foot travels (zero velocity and acceleration at both ends) */
export const minJerk = (t: number) => { const u = t < 0 ? 0 : t > 1 ? 1 : t; return u * u * u * (10 - 15 * u + 6 * u * u); };
/** a half sine between a and b, else 0 */
export const bump = (u: number, a: number, b: number) => (u > a && u < b ? Math.sin(((u - a) / (b - a)) * Math.PI) : 0);
export const rej = (v: V3, n: V3): V3 => { const d = dot(v, n); return [v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d]; };

/** a critically damped spring toward `target` (natural frequency w, 1/s), stepped exactly: the value and its velocity */
export function cdSpring(x: number, v: number, target: number, w: number, dt: number): [number, number] {
  const e0 = x - target, ex = Math.exp(-w * dt), j = v + w * e0;
  return [target + (e0 + j * dt) * ex, (v - w * j * dt) * ex];
}

/** second-order follower: frequency f (Hz), damping z, response r (overshoot / anticipation) */
export class Spring3 {
  y: V3; yd: V3 = [0, 0, 0]; xp: V3;
  k1: number; k2: number; k3: number;
  constructor(f: number, z: number, r: number, x0: V3) {
    this.k1 = z / (Math.PI * f); this.k2 = 1 / ((2 * Math.PI * f) ** 2); this.k3 = (r * z) / (2 * Math.PI * f);
    this.y = [...x0] as V3; this.xp = [...x0] as V3;
  }
  reset(x: V3) { this.y = [...x] as V3; this.xp = [...x] as V3; this.yd = [0, 0, 0]; }
  /** carry the state with a moving frame (flying, it follows her body, not the world) */
  shift(d: V3) { for (let i = 0; i < 3; i++) { this.y[i] += d[i]; this.xp[i] += d[i]; } }
  update(dt: number, x: V3): V3 {
    const k2 = Math.max(this.k2, 1.1 * ((dt * dt) / 4 + (dt * this.k1) / 2), dt * this.k1);
    for (let i = 0; i < 3; i++) {
      const xd = (x[i] - this.xp[i]) / dt;
      this.y[i] += dt * this.yd[i];
      this.yd[i] += (dt * (x[i] + this.k3 * xd - this.y[i] - this.k1 * this.yd[i])) / k2;
    }
    this.xp = [...x] as V3;
    return [...this.y] as V3;
  }
}
