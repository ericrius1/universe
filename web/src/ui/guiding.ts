// The guide at work over the whole zoom: the chapters this window tells (story.ts), the quiet "Learn more" beacon
// whenever you are near a place (never duplicating the Intro), the one the view is at followed while the guide is open,
// a "Bring into focus" item lit — in the cell by the spotlight (post.wgsl, what ui/spot.ts codes), above it by a
// luminous solarpunk astrolabe mark on the screen (things.ts) plus smooth camera turn or solar-body focus — the
// instruments (instruments/), the address the crumbs read on the way down, and a window's welcome.
import type { App } from '../app';
import type { Card } from './info';
import { Guide } from './guide';
import { LEARN_ICON } from './intro';
import { STORY, chapterAt, inCell, type Look, type Spot } from './story';
import { Things, Marks, type Found } from './things';
import { Instruments } from './instruments/index';
import { ADDRESS, type Thing } from '../cosmos/story';
import { COSMOS_PLACES } from '../app';
import { inWindow } from '../windows';
import { vec3 } from 'math';

const params = new URLSearchParams(location.search);
/** how long a look-for item stays lit (s): in the cell, above it */
const SPOT_S = 8.5, MARK_S = 11.5;

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
  /** which look index is currently lit (-1 none, -2 reveal all) */
  private litIdx = -1;
  private followAt = 0;
  private peekAt = 0;
  private peekChap = -1;
  private welcome: HTMLElement | null = null;
  private peekEl: HTMLButtonElement;
  private focusPill: HTMLDivElement;
  private focusedLabel = '';
  private returnLogS: number | null = null;
  private readonly phone = matchMedia('(max-width: 760px)').matches;

  constructor(private app: App, ui: HTMLElement) {
    // (the marks under the guide's panel)
    this.marks = new Marks(ui);
    this.guide = new Guide(ui, this.phone);
    this.things = new Things(app.kit, app.cosmos);
    this.instruments = new Instruments(ui, {
      base: import.meta.env.BASE_URL, cosmos: app.cosmos, kit: app.kit,
      logS: () => (app.realm === 'cosmos' ? this.heightLog() : null),
    });

    // compact floating "Deep dive" beacon: always gently available above the dock when Intro isn't showing
    this.peekEl = document.createElement('button');
    this.peekEl.type = 'button';
    this.peekEl.className = 'peek';
    this.peekEl.innerHTML = `${LEARN_ICON}<span class="peek-name"></span><span class="peek-cue">Deep dive ↗</span>`;
    this.peekEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const ch = STORY[this.peekChap];
      if (ch) this.openFor(ch.place);
    });
    ui.append(this.peekEl);

    // floating pill while focused on a specific solar-system body (Jupiter, Saturn, etc.)
    this.focusPill = document.createElement('div');
    this.focusPill.className = 'focus-pill';
    this.focusPill.innerHTML = `<span class="fp-dot"></span><span class="fp-label"></span><button type="button" class="fp-back">Return to overview ↺</button>`;
    this.focusPill.addEventListener('click', (e) => e.stopPropagation());
    this.focusPill.querySelector('.fp-back')!.addEventListener('click', () => this.clearFocus(true));
    ui.append(this.focusPill);

    const g = this.guide;
    g.onStep = (i) => this.step(i);
    g.onLook = (look, k) => void this.look(look, k);
    g.onFocusBody = (bodyId, label) => this.focusBody(bodyId, label);
    g.onRevealAll = () => void this.revealAll(false);
    g.onAct = (a) => {
      if (a.startsWith('play:')) {
        g.close();
        app.startGame(a.slice(5));
        return;
      }
      app.button(a);
    };
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
      if (!p) return false;
      if (p.logS > 26.97 && !this.app.realms.wants('beyond')) return false;
      return inWindow(w, p.logS, 0.05);
    }).map(([, i]) => i);
    this.app.hud.show('guide', this.guide.order.length > 0 && !params.has('dome'));
  }

  /** the guide open (at the closest chapter to the current view) or closed */
  toggle() {
    const g = this.guide;
    if (g.open) { g.close(); return; }
    if (!g.order.length) return;
    this.dismissWelcome();
    const idx = this.closest() ?? g.order[0];
    this.openAt(idx, true);
  }
  /** open at a chapter (from the welcome) */
  open(i = this.guide.order[0]) { this.dismissWelcome(); this.openAt(i, true); }

  /** open the deep-dive guide for a specific place (from Intro's "Learn more" or the quiet beacon), and visually bring
   *  its hero feature(s) into focus right away */
  openFor(placeId: string) {
    const i = chapterAt(placeId);
    if (i < 0) { this.toggle(); return; }
    this.dismissWelcome();
    this.app.hud.showCard(null);
    this.app.sound('click');
    this.openAt(i, true);
  }

  private openAt(i: number, autoFocus: boolean) {
    const c = STORY[i];
    if (!c) return;
    this.unlight();
    this.guide.showChapter(i);
    this.guide.setFocusedBody(this.app.cosmos.controls.focused);
    this.app.hud.setActive('guide', true);
    if (autoFocus) void this.autoIlluminate(i);
  }

  /** gently bring the current chapter's key visual landmarks into focus when going deeper */
  private async autoIlluminate(i: number) {
    const c = STORY[i];
    if (!c) return;
    if (inCell(c)) {
      if (!this.app.cell || this.app.realm !== 'cell') return;
      // if inspecting an interior organelle while the cell is closed, gently open the cutaway
      if (['cell', 'nucleus', 'mito', 'er', 'golgi', 'atp'].includes(c.place) && this.app.cutTarget < 0.5) {
        this.app.cutTarget = 1;
        this.app.hud.setActive('cut', true);
      }
      const first = c.look.findIndex((l) => l.spot?.length);
      if (first >= 0) {
        const spots = c.look[first].spot as Spot[];
        this.spot.code = this.app.cell.spot(spots);
        this.spot.until = this.spot.code ? this.spot.clock + 5.5 : 0;
        if (this.spot.code) { this.litIdx = first; this.guide.setLit(first); }
      }
    } else if (this.app.realm === 'cosmos') {
      await this.revealAll(true);
    }
  }

  /** illuminate every visible landmark of the current cosmos chapter at once (`quiet`: don't toggle off or complain) */
  async revealAll(quiet = false) {
    const ch = this.guide.chapter;
    const c = STORY[ch];
    if (!c || inCell(c) || this.app.realm !== 'cosmos') return;
    if (!quiet && this.litIdx === -2) { this.unlight(); return; }
    const allThings: Thing[] = [];
    for (const l of c.look) if (l.spot?.length) allThings.push(...(l.spot as Thing[]));
    if (!allThings.length) return;
    await this.things.prepare(allThings);
    if (this.guide.chapter !== ch || !this.guide.open) return;
    const found: Found[] = [];
    const seen = new Set<string>();
    for (const t of allThings) {
      const f = this.things.find(t);
      if (!f) continue;
      const key = `${f.name ?? ''}:${f.at[0].toFixed(3)},${f.at[1].toFixed(3)},${f.at[2].toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (this.things.mark(f)) found.push(f);
    }
    if (!found.length) {
      if (!quiet) this.app.hud.toast('Move closer to this chapter\'s scale to see its landmarks', 2400);
      return;
    }
    this.marked = { found, until: this.spot.clock + MARK_S };
    this.litIdx = -2;
    this.guide.setLit(-2);
    if (!quiet) { this.guide.fold(true); this.app.sound('hover', 0.8); }
  }

  /** smoothly glide the camera onto a solar-system body (Jupiter, Saturn, Mars, Pluto, Voyager 1, Moon, Sun) */
  focusBody(bodyId: string, label: string) {
    if (this.app.realm !== 'cosmos') {
      this.app.goToCosmos('u:solar');
      return;
    }
    const cc = this.app.cosmos.controls;
    if (cc.focused === bodyId) { this.clearFocus(true); return; }
    const near = cc.focusDistance(bodyId);
    if (near === null) {
      this.app.hud.toast('Still loading that world\'s orbit…', 2000);
      return;
    }
    if (!cc.focused) this.returnLogS = cc.logS;
    // frame the body beautifully: ~3.5× its radius for planets (wider for Saturn's rings / Voyager / Sun)
    const pad = bodyId === 'saturn' ? 0.72 : bodyId === 'sun' ? 0.85 : bodyId === 'voyager1' ? 0.6 : 0.52;
    const targetLogS = Math.min(13.2, near + pad);
    if (cc.focus(bodyId, { logS: targetLogS })) {
      this.focusedLabel = label;
      this.guide.setFocusedBody(bodyId);
      this.guide.fold(true);
      this.app.sound('fly');
      // also ring it softly while gliding in
      const f = this.things.find({ body: bodyId });
      if (f) this.marked = { found: [f], until: this.spot.clock + MARK_S };
    }
  }

  /** release solar-body focus (optionally gliding smoothly back to the overview zoom) */
  clearFocus(returnToOverview = false) {
    const cc = this.app.cosmos.controls;
    if (!cc.focused) return;
    const logS = returnToOverview ? (this.returnLogS ?? 13.0) : undefined;
    this.returnLogS = null;
    this.focusedLabel = '';
    cc.focus(null, logS !== undefined ? { logS } : {});
    this.guide.setFocusedBody(null);
    this.focusPill.classList.remove('on');
    if (returnToOverview) this.app.sound('fly');
  }

  /** to a chapter: the view flies to its place */
  step(i: number) {
    const c = STORY[i];
    if (!c) return;
    this.unlight();
    this.clearFocus(false);
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

  /** a look-for item: what it names lit (in the cell) or marked + framed in view (above it) */
  async look(look: Look, k: number) {
    const spots = look.spot ?? [];
    const chap = STORY[this.guide.chapter];
    // clicking an already-lit single item toggles it cleanly off
    if (this.litIdx === k && (this.spot.until > this.spot.clock || this.marked)) {
      this.unlight();
      return;
    }
    this.unlight();
    if (chap && inCell(chap)) {
      const cell = this.app.cell;
      if (!cell || this.app.realm !== 'cell') { this.guide.setMissing(k, 'Down in the cell: fly there first.'); return; }
      this.spot.code = cell.spot(spots as Spot[]);
      this.spot.until = this.spot.code ? this.spot.clock + SPOT_S : 0;
    } else {
      const ch = this.guide.chapter;
      await this.things.prepare(spots as Thing[]);
      if (this.guide.chapter !== ch) return;
      const found = (spots as Thing[]).map((t) => this.things.find(t)).filter((f): f is Found => !!f);
      if (!found.length) { this.guide.setMissing(k, 'Not drawn here yet.'); return; }
      // if none of the targets are on screen right now, smoothly turn the camera to bring the first into centre view!
      if (!found.some((f) => this.things.mark(f))) {
        const dir = this.things.directionOf(found[0]);
        if (dir && this.app.realm === 'cosmos') {
          const cc = this.app.cosmos.controls;
          const { yaw, pitch } = cc.anglesFor(dir);
          cc.flyTo(cc.logS, { yaw, pitch, duration: 1.25 });
        } else {
          this.guide.setMissing(k, 'Not in view from here: try its chapter\'s place.');
        }
      }
      this.marked = { found, until: this.spot.clock + MARK_S };
    }
    this.litIdx = k;
    this.guide.setLit(k);
    this.guide.fold(true);
    this.app.sound('hover', 0.8);
  }
  private unlight() {
    this.spot.until = 0;
    this.marked = null;
    this.litIdx = -1;
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

  /** each frame: the spotlight eased, the marks moved, an open instrument's readout, the quiet beacon & chapter followed */
  frame(dt: number, introShowing = false) {
    const sp = this.spot;
    sp.clock += dt;
    const lit = sp.clock < sp.until;
    sp.k += ((lit ? 1 : 0) - sp.k) * (1 - Math.exp(-dt * (lit ? 5 : 2.5)));
    if (sp.k < 0.002 && !lit) sp.k = 0;
    if (!lit && sp.until > 0) { sp.until = 0; if (!this.marked) { this.litIdx = -1; this.guide.setLit(-1); } }
    if (this.marked) {
      if (sp.clock > this.marked.until || this.app.realm !== 'cosmos') { this.unlight(); }
      else this.marks.show(this.marked.found.map((f) => this.things.mark(f)).filter((m) => !!m) as never);
    }
    if (this.instruments.open) this.instruments.tick();

    // solar-system body focus pill sync
    const focused = this.app.realm === 'cosmos' ? this.app.cosmos.controls.focused : null;
    if (focused) {
      const label = this.focusedLabel || focused.charAt(0).toUpperCase() + focused.slice(1);
      const lblEl = this.focusPill.querySelector('.fp-label')!;
      if (lblEl.textContent !== `Focused on ${label}`) lblEl.textContent = `Focused on ${label}`;
      this.focusPill.classList.add('on');
    } else if (this.focusPill.classList.contains('on')) {
      this.focusPill.classList.remove('on');
      this.focusedLabel = '';
      this.guide.setFocusedBody(null);
    }

    // compact "Deep dive" beacon: always visible for the closest location when Intro isn't showing and Guide is closed
    const canPeek = !introShowing && !this.guide.open && !this.app.tour.active && !this.app.game && !this.welcoming && !params.has('dome');
    if (!canPeek) {
      this.peekEl.classList.remove('on');
    } else if ((this.peekAt -= dt) <= 0) {
      this.peekAt = 0.2;
      const idx = this.app.flying() ? null : this.closest();
      if (idx !== null && STORY[idx]) {
        if (this.peekChap !== idx) {
          this.peekChap = idx;
          const ch = STORY[idx];
          const spots = ch.look.filter((l) => l.spot?.length).length;
          this.peekEl.querySelector('.peek-name')!.textContent = ch.title;
          this.peekEl.querySelector('.peek-cue')!.textContent = spots > 0 ? `Deep dive · ${spots} ↗` : 'Deep dive ↗';
          this.peekEl.title = `Deep dive into ${ch.title}`;
        }
        this.peekEl.classList.add('on');
      } else {
        this.peekEl.classList.remove('on');
      }
    }

    if (this.guide.mode === 'chapter' && !this.app.tour.active && (this.followAt -= dt) <= 0) {
      this.followAt = 0.5;
      if (!this.app.flying() && !focused) {
        const i = this.nearest();
        if (i !== null && i !== this.guide.chapter) { this.unlight(); this.instruments.close(false); this.guide.showChapter(i, this.guide.folded); }
      }
    }
  }

  /** the window's chapter the view is at, if it's closely at one (for auto-following while the guide is open) */
  private nearest(): number | null {
    const app = this.app, o = this.guide.order;
    if (app.realm === 'cosmos') {
      const l = app.cosmos.controls.logS;
      let best: number | null = null, d = 0.95;
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

  /** the closest chapter in the current realm with no dead zones (for the persistent Deep dive beacon & button) */
  private closest(): number | null {
    const app = this.app, o = this.guide.order;
    if (app.realm === 'cosmos') {
      const l = app.cosmos.controls.logS;
      let best: number | null = null, d = Infinity;
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
    let best: number | null = null, score = Infinity;
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
      <div class="wl-acts"><button class="btn wl-go" type="button">Begin</button>${this.guide.order.length ? '<button class="btn wl-guide" type="button"><b>◇</b> Read the guide</button>' : ''}</div>`;
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
