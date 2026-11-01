// Kinesin convoys: on many microtubules a kinesin walks toward the plus end (out to the cell's edge) at ~800 nm/s,
// hauling a vesicle. Seen from across the cell the vesicles crawl along the tracks; up close the two heads take turns:
// the trailing head swings forward 16 nm past the leading one (8 nm for the whole motor), mostly waiting for ATP, then
// a quick step. Positions run on the app's biological clock, so it all slows as you zoom in. They reach the field as
// actors (field.ts); the kinesin game drives one of its own.
import { vec3, quat, type Vec3, type Quat } from 'math';
import type { Field } from './field';
import type { FilamentSet } from './filaments';
import { type World, FilKind } from './layout';
import { MOL } from './molecules';
import { Rng } from './noise';

export interface Track { seg0: number; seg1: number; cum: Float32Array; length: number }
interface Convoy { track: number; s0: number; speed: number; vr: number; pf: number; tint: number }

const _w_p = vec3.create(), _w_t = vec3.create(), _w_r0 = vec3.create(), _w_r1 = vec3.create(), _w_rad = vec3.create();
const _w_a = vec3.create(), _w_b = vec3.create(), _w_q = quat.create(), _w_mid = vec3.create(), _w_tmp = vec3.create();

/** a microtubule as a path: its smoothed segments and their running length */
export function tracksOf(world: World, fil: FilamentSet): Track[] {
  const out: Track[] = [];
  const d = fil.data;
  world.filaments.forEach((f, fi) => {
    if (f.kind !== FilKind.Microtubule) return;
    const seg0 = fil.starts[fi], seg1 = fi + 1 < fil.starts.length ? fil.starts[fi + 1] : fil.count;
    const cum = new Float32Array(seg1 - seg0 + 1);
    for (let s = seg0; s < seg1; s++) cum[s - seg0 + 1] = cum[s - seg0] + d[s * 12 + 11];
    out.push({ seg0, seg1, cum, length: cum[cum.length - 1] });
  });
  return out;
}

/** a point on a track at arc length s, with its tangent and a radial direction for protofilament pf (0..12) */
export function onTrack(fil: FilamentSet, tr: Track, s: number, pf: number, out: Vec3, tangent: Vec3, radial: Vec3) {
  const c = tr.cum;
  let lo = 0, hi = c.length - 2;
  s = Math.max(0, Math.min(tr.length - 1e-3, s));
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (c[m] <= s) lo = m; else hi = m - 1; }
  const o = (tr.seg0 + lo) * 12, d = fil.data;
  const t = (s - c[lo]) / Math.max(d[o + 11], 1e-6);
  vec3.set(_w_a, d[o], d[o + 1], d[o + 2]);
  vec3.set(_w_b, d[o + 4], d[o + 5], d[o + 6]);
  vec3.lerp(out, _w_a, _w_b, t);
  vec3.normalize(tangent, vec3.subtract(tangent, _w_b, _w_a));
  // the same frame field.wgsl's lattice uses, so a head lands on its protofilament
  vec3.normalize(_w_r0, vec3.cross(_w_r0, tangent, [0.31, 1.0, 0.17]));
  vec3.cross(_w_r1, tangent, _w_r0);
  const th = (pf * Math.PI * 2) / 13;
  vec3.scaleAndAdd(radial, vec3.scale(radial, _w_r0, Math.cos(th)), _w_r1, Math.sin(th));
  return out;
}

/** a quaternion whose local X is x and local Y is y (y unit, x made orthogonal) */
export function frameQuat(out: Quat, x: Vec3, y: Vec3): Quat {
  const X = vec3.normalize(_w_tmp, vec3.scaleAndAdd(_w_tmp, x, y, -vec3.dot(x, y)));
  const Z = vec3.cross(vec3.create(), X, y);
  const m: [number, number, number, number, number, number, number, number, number] = [X[0], X[1], X[2], y[0], y[1], y[2], Z[0], Z[1], Z[2]];
  return quat.normalize(out, quat.fromMat3(out, m));
}

/** write one kinesin and its vesicle at arc length s (the stepping drawn from s's fraction of a step) */
export function emitKinesin(field: Field, fil: FilamentSet, tr: Track, s: number, pf: number, vr: number, tint: number, withMotor: boolean, fadeIn = 1) {
  const A = field.actors;
  const add = (type: number, p: Vec3, q: Quat, scale: number) => {
    if (field.actorCount >= A.count) return;
    A.set(field.actorCount++, { pos: p, scale, rot: q, mtype: type, lod: 0, tint, id: 0x80000000 | (type << 16) | (tint & 0xffff) });
  };
  const step = Math.floor(s / 8), ph = s / 8 - step;
  // mostly a dwell (waiting for ATP), then a quick swing: the motion happens in the last 30% of each step
  const m = Math.max(0, Math.min(1, (ph - 0.7) / 0.3));
  const swing = m * m * (3 - 2 * m);
  const base = step * 8;
  const lead = base + 4, trail0 = base - 4;
  const moving = trail0 + swing * 16;
  const T = _w_t, R = _w_rad;
  onTrack(fil, tr, base, pf, _w_mid, T, R);
  if (withMotor) {
    const head = (sAt: number, lift: number) => {
      onTrack(fil, tr, sAt, pf, _w_p, T, R);
      const p = vec3.scaleAndAdd(vec3.create(), _w_p, R, 12.5 + 3.4 + lift);
      add(MOL.kinhead, p, frameQuat(quat.create(), T, R), fadeIn);
    };
    // the heads alternate which is "moving" step by step
    const lift = Math.sin(swing * Math.PI) * 6;
    head(lead, 0);
    head(moving, lift);
    // the stalk rises from between the heads to the cargo
    onTrack(fil, tr, base + 2, pf, _w_p, T, R);
    const foot = vec3.scaleAndAdd(vec3.create(), _w_p, R, 12.5 + 6);
    add(MOL.kinstalk, foot, frameQuat(quat.create(), T, R), fadeIn);
  }
  onTrack(fil, tr, base + 2, pf, _w_p, T, R);
  const c = vec3.scaleAndAdd(vec3.create(), _w_p, R, 12.5 + 6 + 56 + vr * 0.92);
  add(MOL.vesicle, c, quat.identity(_w_q), vr * Math.min(1, fadeIn * 1.5));
}

export class Walkers {
  tracks: Track[];
  convoys: Convoy[] = [];
  constructor(world: World, private fil: FilamentSet, private field: Field) {
    this.tracks = tracksOf(world, fil);
    const rng = new Rng(91);
    this.tracks.forEach((tr, i) => {
      if (tr.length < 2500) return;
      const n = rng.next() < 0.5 ? 1 : 2;
      for (let k = 0; k < n; k++) this.convoys.push({ track: i, s0: rng.range(0, tr.length), speed: rng.range(600, 950), vr: rng.range(32, 60), pf: rng.int(0, 12), tint: rng.int(0, 1e6) });
    });
  }

  /** where convoy i's kinesin is at a given biological time */
  convoyAt(i: number, bioTime: number, out: Vec3) {
    const c = this.convoys[i % this.convoys.length], tr = this.tracks[c.track];
    const span = tr.length - 300;
    const s = 150 + ((c.s0 + c.speed * bioTime) % span + span) % span;
    onTrack(this.fil, tr, s, c.pf, out, _w_t, _w_rad);
    return vec3.scaleAndAdd(out, out, _w_rad, 40);
  }

  /** this frame's convoys into the field's actor list */
  update(bioTime: number, focus: Vec3, scale: number) {
    const near = scale * 3.5;
    for (const c of this.convoys) {
      const tr = this.tracks[c.track];
      const span = tr.length - 300;
      const s = 150 + ((c.s0 + c.speed * bioTime) % span + span) % span;
      // fade in at the minus end, out at the tip (the convoy loops round)
      const u = (s - 150) / span;
      const fade = Math.min(1, u * 12, (1 - u) * 12);
      onTrack(this.fil, tr, s, c.pf, _w_p, _w_t, _w_rad);
      const motor = scale < 2500 && vec3.distance(_w_p, focus) < near;
      emitKinesin(this.field, this.fil, tr, s, c.pf, c.vr, c.tint, motor, fade);
    }
  }
}
