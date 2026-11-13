// The guide at work over the whole zoom: the chapters this window tells (story.ts), the one the view is at followed
// while the guide is open, a "Look for" lit — in the cell by the spotlight (post.wgsl, what ui/spot.ts codes), above it
// by a marker on the screen (things.ts) — the instruments (instruments/), the address the crumbs read on the way down,
// and a window's welcome. Closed, it costs nothing a frame but a comparison or two.
import type { App } from '../app';
import type { Card } from './info';
import { Guide } from './guide';
import { STORY, chapterAt, inCell, type Look, type Spot } from './story';
import { Things, Marks, type Found } from './things';
import { Instruments } from './instruments/index';
import { ADDRESS, type Thing } from '../cosmos/story';
import { COSMOS_PLACES } from '../app';
import { inWindow } from '../windows';
import { vec3 } from 'math';

const params = new URLSearchParams(location.search);
/** how long a look-for item stays lit (s): in the cell, above it */
const SPOT_S = 4.5, MARK_S = 9;

/** the address as the crumbs read it on the way down, coarsest first (`short`: the place at the bottom of the dive) */
export function address(l: number, short: string): string[] {
  if (l > 24.6) return [ADDRESS[0]];
  // (the rest without their "The", so the line stays short)
  const a = ADDRESS.map((s, i) => (i ? s.replace(/^The /, '') : 'Universe'));
  const n = l > 23.2 ? 2 : l > 21.8 ? 3 : l > 18.6 ? 4 : l > 15.6 ? 5 : l > 9.9 ? 6 : 7;
  const c = a.slice(0, n);
  if (l <= 4.6) c.push(short);
  if (l <= -1.1) c.push('An eye');
  return c;
}

export class Guiding {
  readonly guide: Guide;
  readonly things: Things;
  private marks: Marks;
  readonly instruments: Instruments;
  /** the spotlight in the cell: what it lights (G.spots), how strongly now (eased), until when (s, its own clock) */
  readonly spot = { code: 0, k: 0, until: 0, clock: 0 };
  /** what's marked above the cell, and until when */
  private marked: { found: Found[]; until: number } | null = null;
  private followAt = 0;
  private welcome: HTMLElement | null = null;
  private readonly phone = matchMedia('(max-width: 760px)').matches;

  constructor(private app: App, ui: HTMLElement) {
    this.guide = new Guide(ui, this.phone);
    this.things = new Things(app.kit, app.cosmos);
    this.marks = new Marks(ui);
    this.instruments = new Instruments(ui, {
      base: import.meta.env.BASE_URL, cosmos: app.cosmos, kit: app.kit,
      logS: () => (app.realm === 'cosmos' ? this.heightLog() : null),
    });
    const g = this.guide;
    g.onStep = (i) => this.step(i);
    g.onLook = (look, k) => this.look(look, k);
    g.onAct = (a) => app.button(a);
    g.onInstrument = (c) => { if (c.instrument) { void this.instruments.show(c.instrument); app.sound('click'); } };
    g.onFlyCloser = () => { g.fold(true); app.flyCloser(); };
    g.onClose = () => { this.instruments.close(false); this.unlight(); app.hud.setActive('guide', false); };
    this.instruments.onClose = () => {};
    this.order();
  }

  /** the window's chapters: those above the cell whose place it takes in, the cell's if it has the cell */
  order() {
    const w = this.app.realms.window, cellOk = this.app.realms.wants('cell');
    this.guide.order = STORY.map((c, i) => [c, i] as const).filter(([c]) => {
      if (inCell(c)) return cellOk;
      const p = COSMOS_PLACES.find((q) => q.id === c.place);
      return !!p && inWindow(w, p.logS, 0.05);
    }).map(([, i]) => i);
    this.app.hud.show('guide', this.guide.order.length > 0 && !params.has('dome'));
  }

  /** the guide open (at the chapter the view is at) or closed */
  toggle() {
    const g = this.guide;
    if (g.open) { g.close(); return; }
    if (!g.order.length) return;
    this.dismissWelcome();
    g.showChapter(this.nearest() ?? g.order[0], this.phone);
    this.app.hud.setActive('guide', true);
  }
  /** open at a chapter (from the welcome) */
  open(i = this.guide.order[0]) { this.dismissWelcome(); this.guide.showChapter(i); this.app.hud.setActive('guide', true); }

  /** to a chapter: the view flies to its place */
  step(i: number) {
    const c = STORY[i];
    if (!c) return;
    this.unlight();
    this.instruments.close(false);
    this.guide.showChapter(i, this.guide.folded);
    this.app.goTo(c.place);
  }
  /** the next or the previous chapter of the window's ([ and ]) */
  nudge(d: number) {
    const o = this.guide.order, at = o.indexOf(this.guide.chapter);
    const i = o[at + d];
    if (i !== undefined) this.step(i);
  }

  /** a look-for item: what it names lit (in the cell) or marked (above it) a few seconds */
  look(look: Look, k: number) {
    const spots = look.spot ?? [];
    const chap = STORY[this.guide.chapter];
    this.unlight();
    if (chap && inCell(chap)) {
      const cell = this.app.cell;
      if (!cell || this.app.realm !== 'cell') { this.guide.setMissing(k, 'Down in the cell: fly there first.'); return; }
      this.spot.code = cell.spot(spots as Spot[]);
      this.spot.until = this.spot.code ? this.spot.clock + SPOT_S : 0;
    } else {
      const found = (spots as Thing[]).map((t) => this.things.find(t)).filter((f): f is Found => !!f);
      if (!found.length) { this.guide.setMissing(k, 'Not drawn here yet.'); return; }
      if (!found.some((f) => this.things.mark(f))) this.guide.setMissing(k, 'Not in view from here: try its chapter\'s place.');
      this.marked = { found, until: this.spot.clock + MARK_S };
    }
    this.guide.setLit(k);
    this.guide.fold(true);
    this.app.sound('hover', 0.8);
  }
  private unlight() {
    this.spot.until = 0;
    this.marked = null;
    this.marks.show([]);
    this.guide.setLit(-1);
  }

  /** a thing tapped in the cell: its card in the guide, if the guide's open (true: it took it) */
  thing(card: Card, id: number): boolean {
    if (!this.guide.open || !this.app.cell) return false;
    const place = this.app.cell.chapterPlace(id);
    this.guide.showThing(card, place ? chapterAt(place) : -1);
    return true;
  }
  /** a tap on nothing in the cell: from a thing's card back to its chapter */
  untapped() { if (this.guide.mode === 'thing' && this.guide.chapter >= 0) this.guide.showChapter(this.guide.chapter); }

  /** the visitor moved the view: a phone's sheet folds out of the way, a welcome gives way */
  onUser() { this.guide.fold(true); this.dismissWelcome(); }

  /** each frame: the spotlight eased, the marks moved, an open instrument's readout, the chapter followed */
  frame(dt: number) {
    const sp = this.spot;
    sp.clock += dt;
    const lit = sp.clock < sp.until;
    sp.k += ((lit ? 1 : 0) - sp.k) * (1 - Math.exp(-dt * (lit ? 5 : 2.5)));
    if (sp.k < 0.002 && !lit) sp.k = 0;
    if (!lit && sp.until > 0) { sp.until = 0; if (!this.marked) this.guide.setLit(-1); }
    if (this.marked) {
      if (sp.clock > this.marked.until || this.app.realm !== 'cosmos') { this.unlight(); }
      else this.marks.show(this.marked.found.map((f) => this.things.mark(f)).filter((m) => !!m) as never);
    }
    if (this.instruments.open) this.instruments.tick();
    if (this.guide.mode === 'chapter' && !this.app.tour.active && (this.followAt -= dt) <= 0) {
      this.followAt = 0.5;
      if (!this.app.flying()) {
        const i = this.nearest();
        if (i !== null && i !== this.guide.chapter) { this.unlight(); this.instruments.close(false); this.guide.showChapter(i, this.guide.folded); }
      }
    }
  }

  /** the window's chapter the view is at, if it's at one */
  private nearest(): number | null {
    const app = this.app, o = this.guide.order;
    if (app.realm === 'cosmos') {
      const l = app.cosmos.controls.logS;
      let best: number | null = null, d = 0.9;
      for (const i of o) {
        const c = STORY[i];
        if (inCell(c)) continue;
        const p = COSMOS_PLACES.find((q) => q.id === c.place);
        if (p && Math.abs(p.logS - l) < d) { d = Math.abs(p.logS - l); best = i; }
      }
      return best;
    }
    const c = app.controls;
    if (!c) return null;
    let best: number | null = null, score = 2.2;
    for (const i of o) {
      const ch = STORY[i];
      if (!inCell(ch)) continue;
      const p = app.places.get(ch.place);
      if (!p) continue;
      const s = app.fit(p.scale);
      const k = Math.abs(Math.log(c.scale / s)) + vec3.distance(c.pivot, p.at) / Math.max(c.scale, s);
      if (k < score) { score = k; best = i; }
    }
    return best;
  }

  /** the view's height above the ground (log10 m): the view distance, less the Earth's radius where the view is on
   *  the Earth's middle (frames.ts earthPivot) */
  private heightLog() {
    const cc = this.app.cosmos.controls, L = this.app.cosmos.ladder;
    const [a, b] = L.earthPivot, t = Math.max(0, Math.min(1, (cc.logS - a) / (b - a))), k = t * t * (3 - 2 * t);
    return Math.log10(Math.max(1, cc.S - k * L.earthR * 1000));
  }

  /** a window opened by a link greets with its name and line and how to move (it may be the first a stranger sees) */
  greet(ui: HTMLElement) {
    const w = this.app.realms.window;
    if (w.id === 'universe' || params.has('notitle') || params.has('film') || params.has('dome')) return false;
    const touch = matchMedia('(pointer: coarse)').matches;
    const inCellWin = w.top !== null && w.top <= -3.8;
    const move = touch ? `Pinch to ${inCellWin ? 'dive in' : 'fall'}, drag to look round.` : `Scroll to ${inCellWin ? 'dive in' : 'fall'}, drag to look round.`;
    const s = document.createElement('div');
    s.className = 'welcome';
    s.innerHTML = `<div class="wl-k">Universe · one window onto it</div>
      <h1 class="wl-name"></h1><p class="wl-line"></p><p class="wl-move">${move}</p>
      <div class="wl-acts"><button class="btn wl-go">Begin</button>${this.guide.order.length ? '<button class="btn wl-guide"><b>◇</b> Read the guide</button>' : ''}</div>`;
    s.querySelector('.wl-name')!.textContent = w.name;
    s.querySelector('.wl-line')!.textContent = w.line;
    s.addEventListener('click', (e) => e.stopPropagation());
    s.querySelector('.wl-go')!.addEventListener('click', () => this.dismissWelcome());
    s.querySelector('.wl-guide')?.addEventListener('click', () => this.open());
    ui.append(s);
    this.welcome = s;
    document.body.classList.add('welcoming');
    requestAnimationFrame(() => s.classList.add('on'));
    return true;
  }
  dismissWelcome() {
    const s = this.welcome;
    if (!s) return;
    this.welcome = null;
    document.body.classList.remove('welcoming');
    s.classList.remove('on');
    setTimeout(() => s.remove(), 700);
  }
  get welcoming() { return !!this.welcome; }
}

