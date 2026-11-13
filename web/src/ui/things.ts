// Things you can find above the cell: a "Look for" item names a star, a constellation, a galaxy, a structure, a body
// of the solar system or a whole level (cosmos/story.ts Thing), and this says where it is on the screen now, so it can
// be marked: a thin ring round it and its name beside it, in the page's type (never a game's waypoint).
//
// It works for what the view draws today and says nothing for what it doesn't yet, so the rest comes in as it's built:
// a level that can say where a named thing is gives itself a `find` (FindsThings below), and that answer comes first.
// Until a level has one, the few things it already draws by hand are found here from the same numbers it draws them
// with (the planets and the Moon from frames.ts, the named stars from levels/local.ts NAMED, the Local Group and Virgo
// from levels/web.ts), each only once its realm is built. Nothing here costs anything while no marker is up.
import type { Kit } from '@ericrius1/weft';
import { quat, vec3, type Vec3 } from 'math';
import type { Cosmos } from '../cosmos';
import type { Frame } from '../cosmos/frames';
import { AU, PLANETS, planetPos, moonPos } from '../cosmos/frames';
import type { Thing } from '../cosmos/story';

/** where a found thing is: a point in a frame's units, and its radius there (0: a point) */
export interface Found { frame: Frame; at: Vec3; r?: number; name?: string; ring?: boolean }
/** what a level gives itself to be searched: the kind of thing ('star', 'figure', 'galaxy', 'structure', 'body') and
 *  its name as the story has it, to where it is now (null: not this level's, or not drawn) */
export interface FindsThings { find(kind: string, name: string): Found | null }

/** a mark on the screen (css px): its middle, its ring's radius, its name; a ring round an orbit is a path */
export interface Mark { x: number; y: number; r: number; name: string; path?: [number, number][] }

const kindOf = (t: Thing): [string, string] => { const k = Object.keys(t)[0]; return [k, (t as Record<string, string>)[k]]; };

/** names as the story says them, as the view's own lists have them */
const STAR_ALIAS: Record<string, string> = { 'Rigil Kentaurus': 'α Centauri', Toliman: 'α Centauri' };
const BODY_NAME: Record<string, string> = { sun: 'The Sun', 'sgr-a': 'Sagittarius A*', belt: 'The asteroid belt', moon: 'The Moon' };

export class Things {
  private readonly qi = quat.create();
  private readonly v: Vec3 = [0, 0, 0];
  private readonly off: Vec3 = [0, 0, 0];

  constructor(private kit: Kit, private cosmos: Cosmos) {}

  /** where a thing is now, in a frame's terms, or null where nothing draws it yet */
  find(t: Thing): Found | null {
    const [kind, name] = kindOf(t), c = this.cosmos, L = c.ladder;
    // (the level's own answer first, once it has one)
    for (const id of ['local', 'galaxy', 'web', 'solar', 'earth'] as const) {
      if (!c.has(id)) continue;
      const lv = c[id] as unknown as Partial<FindsThings>;
      const f = typeof lv.find === 'function' ? lv.find(kind, name) : null;
      if (f) return f;
    }
    if (kind === 'level' && name === 'web.cmb' && c.has('web')) return { frame: L.cosmos, at: [0, 0, 0], r: 14300, name: 'The microwave background', ring: true };
    if (kind === 'body') {
      if (name === 'sgr-a' && c.has('galaxy')) return { frame: L.galaxy, at: [0, 0, 0], name: BODY_NAME[name] };
      if (!c.has('solar') && !(name === 'moon' && c.has('earth'))) return null;
      if (name === 'sun') return { frame: L.solar, at: [0, 0, 0], r: 696000 / (AU / 1000), name: BODY_NAME[name] };
      if (name === 'belt') return { frame: L.solar, at: [0, 0, 0], r: 2.7, name: BODY_NAME[name], ring: true };
      if (name === 'moon') return { frame: L.earth, at: moonPos(L.day), r: 1737.4, name: BODY_NAME[name] };
      const p = PLANETS.find((q) => q.id === name);
      if (p) return { frame: L.solar, at: planetPos(p, L.day, [0, 0, 0]), r: p.r * 1000 / AU, name: p.name };
      return null;
    }
    if (kind === 'star' && c.has('local')) {
      const want = STAR_ALIAS[name] ?? name;
      return this.namedStar(want, name);
    }
    if ((kind === 'galaxy' || kind === 'structure') && c.has('web')) {
      // (as levels/web.ts places them by hand, megaparsecs round the Milky Way, until its catalogue answers)
      const at = WEB_BY_HAND[name];
      if (at) return { frame: L.cosmos, at: [...at.at] as Vec3, r: at.r, name };
    }
    return null;
  }

  private stars: Map<string, Vec3> | null = null;
  private namedStar(want: string, shown: string): Found | null {
    if (!this.stars) {
      this.stars = new Map();
      // (levels/local.ts NAMED, read off the level that draws them: no copy of its list here)
      void import('../cosmos/levels/local').then(({ NAMED, galDir }) => {
        for (const [n, l, b, d] of NAMED) { const g = galDir(l, b); this.stars!.set(n, [g[0] * d, g[1] * d, g[2] * d]); }
      });
    }
    const at = this.stars.get(want);
    return at ? { frame: this.cosmos.ladder.local, at, name: shown } : null;
  }

  /** a found thing on the screen now (css px), or null if it's behind the view, off it, or too small a part of it */
  mark(f: Found): Mark | null {
    const c = this.cosmos, cc = c.controls, kit = this.kit;
    const [W, H] = kit.size.css;
    const th = Math.tan(kit.camera.fovY / 2), asp = W / Math.max(1, H);
    // (the camera in the top frame's axes, metres from the ladder's target: as the renderer's levels have it)
    c.ladder.pivotOffset(cc.logS, this.off);
    const S = cc.S;
    const toScreen = (p: Vec3): [number, number, number] | null => {
      // the point from the target, in the top frame's axes and metres
      vec3.subtract(this.v, p, f.frame.target);
      vec3.transformQuat(this.v, this.v, f.frame.q);
      const u = f.frame.unit;
      const d: Vec3 = [this.v[0] * u - (this.off[0] - cc.forward[0] * S), this.v[1] * u - (this.off[1] - cc.forward[1] * S), this.v[2] * u - (this.off[2] - cc.forward[2] * S)];
      const z = vec3.dot(d, cc.forward);
      if (z <= 0) return null;
      const x = vec3.dot(d, cc.right) / (z * th * asp), y = vec3.dot(d, cc.up) / (z * th);
      return [(x * 0.5 + 0.5) * W, (0.5 - y * 0.5) * H, z];
    };
    if (f.ring && f.r) {
      // a ring: in its frame's plane (y up) round the point, as a path
      const path: [number, number][] = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const s = toScreen([f.at[0] + f.r * Math.cos(a), f.at[1], f.at[2] + f.r * Math.sin(a)]);
        if (s) path.push([s[0], s[1]]);
      }
      // (a shell round the view's own middle — the microwave background — is a circle on the screen: its silhouette)
      const mid = toScreen(f.at);
      if (f.name === 'The microwave background' && mid) {
        const z = mid[2], R = f.r * f.frame.unit;
        const rpx = z > R ? (R / Math.sqrt(z * z - R * R)) / th * (H / 2) : Infinity;
        if (!Number.isFinite(rpx) || rpx > Math.hypot(W, H)) return null;
        return { x: mid[0], y: mid[1], r: rpx, name: f.name };
      }
      if (path.length < 8) return null;
      const xs = path.map((p) => p[0]), ys = path.map((p) => p[1]);
      const box = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      if (box[1] < 0 || box[0] > W || box[3] < 0 || box[2] > H) return null;
      if (box[1] - box[0] < 6 && box[3] - box[2] < 6) return null;
      return { x: (box[0] + box[1]) / 2, y: box[2], r: 0, name: f.name ?? '', path };
    }
    const s = toScreen(f.at);
    if (!s) return null;
    const [x, y, z] = s;
    if (x < -40 || x > W + 40 || y < -40 || y > H + 40) return null;
    const r = f.r ? (f.r * f.frame.unit) / (z * th) * (H / 2) : 0;
    // (a thing that fills the view needs no ring)
    if (r > Math.min(W, H) * 0.45) return null;
    return { x, y, r, name: f.name ?? '' };
  }
}

/** levels/web.ts's hand-placed Local Group and Virgo (Mpc, the cosmos frame), and about how big each is */
const WEB_BY_HAND: Record<string, { at: Vec3; r: number }> = {
  Andromeda: { at: [0.42, -0.31, 0.58], r: 0.023 },
  Triangulum: { at: [0.5, -0.45, 0.52], r: 0.009 },
  LMC: { at: [-0.002, -0.032, -0.038], r: 0.0045 },
  SMC: { at: [0.004, -0.044, -0.044], r: 0.0025 },
  'Virgo Cluster': { at: [9.5, 4.2, -12.4], r: 1.5 },
};

/** the marks' layer over the view: a thin ring and a name for each, moved only while there are any */
export class Marks {
  readonly el = document.createElement('div');
  private svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private items: { el: HTMLElement; path: SVGPathElement }[] = [];

  constructor(parent: HTMLElement) {
    this.el.className = 'marks';
    this.el.setAttribute('aria-hidden', 'true');
    this.svg.setAttribute('class', 'marks-svg');
    this.el.append(this.svg);
    parent.append(this.el);
  }

  /** draw these marks (none: clear) */
  show(marks: Mark[]) {
    while (this.items.length < marks.length) {
      const el = document.createElement('div');
      el.className = 'mark';
      el.innerHTML = '<i></i><span></span>';
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      this.svg.append(path);
      this.el.append(el);
      this.items.push({ el, path });
    }
    this.items.forEach((it, i) => {
      const m = marks[i];
      if (!m) { it.el.style.display = 'none'; it.path.setAttribute('d', ''); return; }
      it.el.style.display = '';
      const span = it.el.lastElementChild as HTMLElement;
      if (span.textContent !== m.name) span.textContent = m.name;
      if (m.path) {
        it.path.setAttribute('d', m.path.map((p, k) => `${k ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(''));
        it.el.classList.add('mark-path');
      } else { it.path.setAttribute('d', ''); it.el.classList.remove('mark-path'); }
      const r = m.path ? 0 : Math.max(11, m.r * 1.35 + 6);
      it.el.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)`;
      it.el.style.setProperty('--r', `${r.toFixed(1)}px`);
    });
    this.el.classList.toggle('on', marks.length > 0);
  }
}
