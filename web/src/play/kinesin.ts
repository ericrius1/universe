// Walk the line: you are kinesin-1, hauling a vesicle along a microtubule toward the cell's edge. Your two heads take
// turns: the trailing head swings 16 nm past the leading one (the whole motor moves 8 nm), but only once the leading
// head has caught an ATP from the soup round it — that binding is what throws the back head forward. Press the
// trailing head's side (←/→, A/D, or tap that half of the screen) when the ATP light is on; wrong head or no ATP and
// you stumble. Tau proteins sit on the lattice here and there: side-step (↑/↓, W/S, or swipe) to the neighbouring
// protofilament, as real kinesins do. Haul the cargo 80 steps (640 nm) before the clock runs out.
// Drawn here: the heads land on the tubulin lattice field.wgsl lays down (same frame as walkers.ts onTrack, dimer
// centres every 8 nm, each protofilament 0.92 nm further along), the stalk and vesicle ride between them, ATP and the
// spent ADP + phosphate are clusters of tinted balls. Simplified: ATP drawn ~1.6× size; real kinesin steps ~100 times a
// second, so the clock here runs about a hundred times slower than life.
import { vec3, quat, type Vec3, type Quat } from 'math';
import { registerGame, type Game, type GameCtx } from './game';
import { tracksOf, onTrack, frameQuat, type Track } from '../world/walkers';
import { MOL } from '../world/molecules';
import { Rng } from '../world/noise';
import { rel } from '../engine/origin';

const STEPS = 80;
const LIMIT = 60;
const STEP_TIME = 0.22;
const SIDE_TIME = 0.32;
const ATP_COUNT = 9;
const ATP_K = 2.0;
const MT_R = 12.5;
const HEAD_R = 3.4;
const VESICLE_R = 46;

const rgba = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255 | ((n >> 8) & 255) << 8 | (n & 255) << 16 | 255 << 24) >>> 0;
};
const C_ADENINE = rgba('#6f8dff'), C_RIBOSE = rgba('#f2e6cf'), C_PHOS = rgba('#ffae3a'), C_TAU = rgba('#c58cff'), C_TAU2 = rgba('#ff7fc8');
// one ATP, along its own x axis: adenine, ribose, then the three phosphates (α β γ)
const ATP_BALLS: [number, number, number, number, number][] = [
  [-1.05, 0.35, 0, 0.5, C_ADENINE], [-0.55, -0.15, 0, 0.42, C_ADENINE], [0.05, 0, 0, 0.42, C_RIBOSE],
  [0.62, 0, 0, 0.34, C_PHOS], [1.15, 0, 0, 0.34, C_PHOS], [1.68, 0, 0, 0.34, C_PHOS],
];

interface Floater { home: Vec3; phase: Vec3; amp: number; spin: Quat; fade: number }
interface Debris { pos: Vec3; vel: Vec3; age: number; spin: Quat; balls: number }
interface Block { pf: number; j: number; seed: number; fade: number }

const _k_axis = vec3.create(), _k_t = vec3.create(), _k_r = vec3.create(), _k_b = vec3.create(), _k_p = vec3.create();
const _k_q = quat.create(), _k_q2 = quat.create(), _k_off = vec3.create(), _k_eye = vec3.create(), _k_look = vec3.create();
const _k_head = vec3.create(), _k_lead = vec3.create(), _k_trail = vec3.create(), _k_tmp = vec3.create();
const _k_atp = vec3.create(), _k_rot = [0, 0, 0, 1] as Quat, _k_R = vec3.create(), _k_Bn = vec3.create(), _k_top = vec3.create();
const Y: Vec3 = [0, 1, 0];

const STYLE = `
.kg-top { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); width: min(560px, calc(100vw - 32px)); text-align: center;
  background: rgba(14, 11, 18, 0.62); border: 1px solid var(--line); border-radius: 14px; padding: 12px 18px 12px; backdrop-filter: blur(16px) saturate(1.3); }
.kg-title { font: 400 22px/1.1 var(--serif); }
.kg-title em { font-style: italic; color: var(--accent); }
.kg-bar { height: 6px; border-radius: 3px; background: rgba(255,255,255,0.08); margin: 10px 0 8px; overflow: hidden; }
.kg-bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #ff9a3c, #ffd27a); transition: width 0.2s; }
.kg-stats { display: flex; justify-content: space-between; gap: 10px; font: 12px var(--mono); color: var(--dim); flex-wrap: wrap; }
.kg-stats b { color: var(--ink); font-weight: 600; }
.kg-x { position: absolute; top: 14px; right: 16px; width: 38px; height: 38px; border-radius: 50%; border: 1px solid var(--line); background: var(--glass);
  color: var(--ink); font-size: 20px; cursor: pointer; backdrop-filter: blur(12px); }
.kg-pad { position: absolute; bottom: 22px; width: min(34vw, 220px); height: 92px; border-radius: 18px; border: 1px solid var(--line);
  background: rgba(14, 11, 18, 0.5); color: var(--ink); font: 600 15px var(--sans); cursor: pointer; backdrop-filter: blur(12px);
  display: flex; align-items: center; justify-content: center; gap: 10px; transition: background 0.15s, border-color 0.15s, transform 0.1s, box-shadow 0.2s; touch-action: manipulation; user-select: none; }
.kg-pad.l { left: 18px; } .kg-pad.r { right: 18px; }
.kg-pad .k { font: 600 12px var(--mono); color: var(--faint); border: 1px solid var(--line); border-radius: 6px; padding: 2px 6px; }
.kg-pad.next { border-color: rgba(255, 170, 110, 0.85); background: rgba(255, 140, 70, 0.18); box-shadow: 0 0 26px rgba(255, 150, 80, 0.35); }
.kg-pad:active { transform: scale(0.97); }
.kg-mid { position: absolute; bottom: 22px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; }
.kg-atp { font: 600 12px var(--mono); letter-spacing: 0.06em; padding: 7px 14px; border-radius: 999px; border: 1px solid var(--line); background: rgba(14,11,18,0.55);
  color: var(--faint); transition: all 0.15s; white-space: nowrap; }
.kg-atp.on { color: #1a0f05; background: #ffb13a; border-color: #ffd27a; box-shadow: 0 0 22px rgba(255, 177, 58, 0.7); }
.kg-side { display: flex; gap: 8px; }
.kg-side button { width: 54px; height: 44px; border-radius: 12px; border: 1px solid var(--line); background: rgba(14,11,18,0.5); color: var(--ink); font-size: 16px; cursor: pointer; backdrop-filter: blur(10px); touch-action: manipulation; }
.kg-side button.warn { border-color: #c58cff; box-shadow: 0 0 18px rgba(197, 140, 255, 0.55); }
.kg-msg { position: absolute; top: 30%; left: 50%; transform: translate(-50%, -50%); font: 400 clamp(20px, 3vw, 30px) var(--serif); color: var(--ink);
  text-shadow: 0 2px 20px rgba(0,0,0,0.9); opacity: 0; transition: opacity 0.25s; pointer-events: none; text-align: center; }
.kg-msg.on { opacity: 1; }
.kg-card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(460px, calc(100vw - 32px)); background: rgba(14, 11, 18, 0.82);
  border: 1px solid var(--line); border-radius: 16px; padding: 22px 24px 18px; backdrop-filter: blur(18px) saturate(1.3); }
.kg-card h2 { margin: 0 0 4px; font: 400 28px/1.1 var(--serif); }
.kg-card h2 em { font-style: italic; color: var(--accent); }
.kg-card p { margin: 8px 0; font-size: 13.5px; line-height: 1.55; color: rgba(244,237,230,0.86); }
.kg-card .big { font: 600 30px var(--mono); color: var(--accent); margin: 6px 0 2px; }
.kg-card ul { margin: 8px 0; padding-left: 18px; font-size: 13px; line-height: 1.5; color: var(--dim); }
.kg-card .acts { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.kg-card .note { font: 11px var(--mono); color: var(--faint); }
@media (max-width: 760px) { .kg-pad { height: 78px; font-size: 13px; } .kg-pad .k { display: none; } .kg-title { font-size: 18px; } }
`;

function injectStyle() {
  if (document.getElementById('kg-style')) return;
  const s = document.createElement('style');
  s.id = 'kg-style';
  s.textContent = STYLE;
  document.head.append(s);
}

class KinesinGame implements Game {
  id = 'kinesin';
  role = 'Kinesin-1 motor protein';
  title = 'Walk the line';
  blurb = 'Step hand over hand down a microtubule, one ATP per step, hauling cargo to the cell\'s edge.';
  art = 'kinesin';

  private ctx!: GameCtx;
  private track!: Track;
  private tint = 424242;
  private rng = new Rng(17);
  // the walk: n steps done, the motor's base on the lattice (dimer index), the step in flight
  private n = 0;
  private j0 = 0;
  private stepT = 1;
  /** which head trails (0 = left, 1 = right): it's the one to press */
  private trailing = 0;
  private pf = 4;
  private pfFrom = 4;
  private pfTo = 4;
  private sideT = 1;
  private atpBound = false;
  private atpFly = 1;
  private atpFrom = vec3.create();
  private atpFrom2: Quat = quat.create();
  private bindIn = 0.4;
  private stall = 0;
  private shake = 0;
  private atpUsed = 0;
  private stumbles = 0;
  private sidesteps = 0;
  private time = 0;
  private running = false;
  private over = false;
  private blocks: Block[] = [];
  private nextBlock = 10;
  private floaters: Floater[] = [];
  private debris: Debris[] = [];
  private camEye = vec3.create();
  private camAt = vec3.create();
  private camReady = false;
  private savedPerChunk = 0;
  private el: Record<string, HTMLElement> = {};
  private msgTimer = 0;
  private swipe: { y: number; x: number; id: number } | null = null;
  private onKey = (e: KeyboardEvent) => this.key(e);
  private onDown = (e: PointerEvent) => { this.swipe = { x: e.clientX, y: e.clientY, id: e.pointerId }; };
  private onUp = (e: PointerEvent) => this.tap(e);

  start(ctx: GameCtx) {
    this.ctx = ctx;
    injectStyle();
    this.reset();
    ctx.controls.driven = true;
    // a thinner crowd so the track stays in view
    this.savedPerChunk = ctx.field.perChunk;
    ctx.field.perChunk = Math.max(3, Math.round(this.savedPerChunk * 0.22));
    this.buildUi();
    this.intro();
    addEventListener('keydown', this.onKey);
    ctx.kit.canvas.addEventListener('pointerdown', this.onDown);
    addEventListener('pointerup', this.onUp);
  }

  stop() {
    removeEventListener('keydown', this.onKey);
    this.ctx.kit.canvas.removeEventListener('pointerdown', this.onDown);
    removeEventListener('pointerup', this.onUp);
    this.ctx.field.perChunk = this.savedPerChunk;
    this.ctx.field.actorCount = 0;
    this.ctx.kit.camera.roll = 0;
    this.running = false;
  }

  // ---------------------------------------------------------------- setup
  private reset() {
    const ctx = this.ctx;
    const tracks = tracksOf(ctx.world, ctx.fil);
    const pick = this.pickTrack(tracks);
    this.track = tracks[pick.track];
    this.j0 = Math.floor(pick.s / 8);
    this.n = 0;
    this.stepT = 1;
    this.trailing = 0;
    this.pf = this.pfFrom = this.pfTo = pick.pf;
    this.sideT = 1;
    this.atpBound = false;
    this.atpFly = 1;
    this.bindIn = 0.5;
    this.stall = 0;
    this.atpUsed = 0;
    this.stumbles = 0;
    this.sidesteps = 0;
    this.time = 0;
    this.over = false;
    this.running = false;
    this.blocks = [];
    this.nextBlock = 9;
    this.debris = [];
    this.camReady = false;
    const rng = this.rng;
    this.floaters = [];
    for (let i = 0; i < ATP_COUNT; i++) {
      this.floaters.push({ home: [rng.range(-38, 38), rng.range(-30, 34), rng.range(-26, 60)], phase: [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)], amp: rng.range(4, 9), spin: quat.normalize(quat.create(), [rng.gauss(), rng.gauss(), rng.gauss(), rng.gauss()]), fade: 1 });
    }
  }

  /** a long microtubule in open cytoplasm, out of the cutaway wedge and clear of the other convoys */
  private pickTrack(tracks: Track[]) {
    const ctx = this.ctx;
    // (the walkers' convoys, rebuilt the way walkers.ts makes them, so we start where none is near)
    const convoys: { track: number; s0: number; speed: number }[] = [];
    const cr = new Rng(91);
    tracks.forEach((tr, i) => {
      if (tr.length < 2500) return;
      const n = cr.next() < 0.5 ? 1 : 2;
      for (let k = 0; k < n; k++) { const s0 = cr.range(0, tr.length), speed = cr.range(600, 950); cr.range(32, 60); cr.int(0, 12); cr.int(0, 1e6); convoys.push({ track: i, s0, speed }); }
    });
    const bio = ctx.bioTime();
    const wd: Vec3 = [Math.sin(0.62), 0, Math.cos(0.62)];
    const openSide = (p: Vec3) => {
      const qx = p[0], qz = p[2], l = Math.hypot(qx, p[1] - 600, qz);
      if (l > 12500) return true;
      const h = Math.hypot(qx, qz) || 1;
      return (qx * wd[0] + qz * wd[2]) / h < Math.cos(1.25);
    };
    const order = tracks.map((t, i) => i).filter((i) => tracks[i].length > 4000);
    for (let attempt = 0; attempt < order.length * 6; attempt++) {
      const ti = order[(attempt * 7 + 3) % order.length];
      const tr = tracks[ti];
      const s = 1200 + ((attempt * 977) % Math.max(1, tr.length - 3000));
      let ok = true;
      for (let d = -100; d <= 900 && ok; d += 100) { onTrack(ctx.fil, tr, s + d, 0, _k_p, _k_t, _k_r); ok = openSide(_k_p); }
      for (const c of convoys) {
        if (c.track !== ti || !ok) continue;
        const span = tr.length - 300;
        const cs = 150 + ((c.s0 + c.speed * bio) % span + span) % span;
        if (cs > s - 700 && cs < s + 1500) ok = false;
      }
      if (ok) return { track: ti, s, pf: 4 };
    }
    return { track: order[0], s: 1500, pf: 4 };
  }

  // ---------------------------------------------------------------- interface
  private buildUi() {
    const p = this.ctx.panel;
    p.innerHTML = `
      <div class="kg-top">
        <div class="kg-title">Walk the line · <em>kinesin-1</em></div>
        <div class="kg-bar"><i></i></div>
        <div class="kg-stats"><span>time <b data-k="time">60.0</b></span><span>steps <b data-k="steps">0</b>/${STEPS}</span><span>ATP <b data-k="atp">0</b></span><span><b data-k="rate">0.0</b> steps/s · real: 100</span></div>
      </div>
      <button class="kg-x" title="Leave (Esc)">×</button>
      <button class="kg-pad l"><span class="k">← A</span>Left head</button>
      <button class="kg-pad r">Right head<span class="k">D →</span></button>
      <div class="kg-mid">
        <div class="kg-atp">waiting for ATP…</div>
        <div class="kg-side"><button data-d="1" title="Side-step (↑ / W)">▲</button><button data-d="-1" title="Side-step (↓ / S)">▼</button></div>
      </div>
      <div class="kg-msg"></div>`;
    const q = (s: string) => p.querySelector(s) as HTMLElement;
    this.el = { bar: q('.kg-bar i'), time: q('[data-k=time]'), steps: q('[data-k=steps]'), atp: q('[data-k=atp]'), rate: q('[data-k=rate]'),
      left: q('.kg-pad.l'), right: q('.kg-pad.r'), atpLight: q('.kg-atp'), msg: q('.kg-msg'), side: q('.kg-side') };
    q('.kg-x').addEventListener('click', () => this.ctx.exit());
    const press = (side: number) => (e: Event) => { e.preventDefault(); e.stopPropagation(); this.press(side); };
    this.el.left.addEventListener('pointerdown', press(0));
    this.el.right.addEventListener('pointerdown', press(1));
    for (const b of p.querySelectorAll<HTMLButtonElement>('.kg-side button')) b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.side(Number(b.dataset.d)); });
  }

  private card(html: string) {
    const c = document.createElement('div');
    c.className = 'kg-card';
    c.innerHTML = html;
    c.addEventListener('pointerdown', (e) => e.stopPropagation());
    c.addEventListener('pointerup', (e) => e.stopPropagation());
    this.ctx.panel.append(c);
    return c;
  }

  private intro() {
    const c = this.card(`
      <h2>You are <em>kinesin-1</em></h2>
      <p>A motor protein with two heads, walking a microtubule toward the cell's edge with a vesicle of cargo on your back.</p>
      <ul>
        <li>When the <b>ATP</b> light is on, press the <b>trailing head</b> (the glowing side): ← / A or → / D, or tap that side.</li>
        <li>Heads take turns — press the same side twice and you stumble.</li>
        <li>A <b>tau</b> protein in your lane? Side-step: ↑ / ↓ (W / S), or swipe.</li>
      </ul>
      <p>Haul the vesicle <b>${STEPS} steps</b> (640 nm) in ${LIMIT} seconds.</p>
      <div class="acts"><button class="btn btn-play" data-go>Start walking</button><button class="btn" data-back>Back to the cell</button></div>`);
    c.querySelector('[data-go]')!.addEventListener('click', () => { c.remove(); this.running = true; this.ctx.sound('click'); });
    c.querySelector('[data-back]')!.addEventListener('click', () => this.ctx.exit());
  }

  private say(text: string, secs = 1.1) {
    this.el.msg.innerHTML = text;
    this.el.msg.classList.add('on');
    this.msgTimer = secs;
  }

  private finish(won: boolean) {
    this.over = true;
    this.running = false;
    this.ctx.sound(won ? 'win' : 'bad');
    if (won) this.ctx.sound('pop');
    const rate = this.n / Math.max(this.time, 0.01);
    const c = this.card(won ? `
      <h2>Cargo <em>delivered</em></h2>
      <div class="big">${this.time.toFixed(1)} s</div>
      <p class="note">${rate.toFixed(1)} steps/s · ${this.atpUsed} ATP · ${this.stumbles} stumbles · ${this.sidesteps} side-steps</p>
      <p>A real kinesin covers those 640 nm in about <b>0.8 s</b> — a hundred steps a second, each one 8 nm and one ATP — and can keep going for a micron or more before letting go.</p>
      <p>Kinesin was discovered in 1985 in the giant axons of squid, where it carries cargo a metre down your own nerves.</p>
      <p class="note">Simplified: ATP drawn larger than life; the clock runs ~100× slow; real heads bind β-tubulin, step strictly along one protofilament and side-step only now and then.</p>
      <div class="acts"><button class="btn btn-play" data-again>Play again</button><button class="btn" data-back>Back to the cell</button></div>` : `
      <h2>Out of <em>time</em></h2>
      <div class="big">${this.n} / ${STEPS}</div>
      <p>The vesicle got ${this.n * 8} nm. Wait for the ATP light, then press the glowing head — the heads take turns.</p>
      <div class="acts"><button class="btn btn-play" data-again>Try again</button><button class="btn" data-back>Back to the cell</button></div>`);
    c.querySelector('[data-again]')!.addEventListener('click', () => { c.remove(); this.reset(); this.running = true; this.ctx.sound('click'); });
    c.querySelector('[data-back]')!.addEventListener('click', () => this.ctx.exit());
  }

  // ---------------------------------------------------------------- input
  private key(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') { e.preventDefault(); this.press(0); }
    else if (k === 'arrowright' || k === 'd') { e.preventDefault(); this.press(1); }
    else if (k === 'arrowup' || k === 'w') { e.preventDefault(); this.side(1); }
    else if (k === 'arrowdown' || k === 's') { e.preventDefault(); this.side(-1); }
    else if ((k === ' ' || k === 'enter') && !this.running && !this.over) { const go = this.ctx.panel.querySelector<HTMLButtonElement>('[data-go]'); go?.click(); }
  }
  private tap(e: PointerEvent) {
    const s = this.swipe;
    this.swipe = null;
    if (!s || s.id !== e.pointerId || !this.running) return;
    const dy = e.clientY - s.y, dx = e.clientX - s.x;
    if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx)) { this.side(dy < 0 ? 1 : -1); return; }
    if (Math.abs(dx) + Math.abs(dy) < 14) this.press(e.clientX < innerWidth / 2 ? 0 : 1);
  }

  private blockedAhead() {
    const land = this.j0 + this.n + 2;
    const pf = Math.round(this.pfTo);
    return this.blocks.find((b) => b.j === land && ((b.pf - pf) % 13 + 13) % 13 === 0) ?? null;
  }

  private press(side: number) {
    if (!this.running || this.over) return;
    if (this.stepT < 1 || this.sideT < 1 || this.stall > 0) return;
    if (side !== this.trailing) { this.stumble('Wrong head — the <em>other</em> one trails'); return; }
    if (!this.atpBound || this.atpFly < 1) { this.stumble('No ATP yet — wait for the light'); return; }
    if (this.blockedAhead()) { this.stumble('Tau in your lane! Side-step ▲ / ▼'); return; }
    // the step: ATP on the leading head throws the trailing head forward
    this.stepT = 0;
    this.atpBound = false;
    this.atpUsed++;
    this.bindIn = this.waitForAtp();
    this.spawnSpent();
    this.ctx.sound('step');
  }

  private side(d: number) {
    if (!this.running || this.over || this.sideT < 1 || this.stepT < 1) return;
    this.pfFrom = this.pf;
    this.pfTo = this.pfTo + d;
    this.sideT = 0;
    this.sidesteps++;
    this.ctx.sound('click');
  }

  private stumble(why: string) {
    this.stumbles++;
    this.stall = 0.35;
    this.shake = 1;
    this.say(why);
    this.ctx.sound('bad');
  }

  private waitForAtp() { return 0.12 + -Math.log(1 - this.rng.next() * 0.98) * 0.3; }

  /** the spent nucleotide leaves the head that just pushed off: ADP and a phosphate drifting away */
  private spawnSpent() {
    const rng = this.rng;
    for (let k = 0; k < 2; k++) {
      const d: Debris = { pos: vec3.clone(this.atpFrom), vel: [rng.range(-6, 6), rng.range(4, 10), rng.range(-6, 6)], age: 0, spin: quat.normalize(quat.create(), [rng.gauss(), rng.gauss(), rng.gauss(), rng.gauss()]), balls: k === 0 ? 5 : 1 };
      this.debris.push(d);
    }
  }

  // ---------------------------------------------------------------- the world
  /** a point on your protofilament at lattice index j (fractional ok), its tangent and radial */
  private lattice(j: number, pf: number, out: Vec3) {
    const s = j * 8 + pf * 0.923 + 2;
    onTrack(this.ctx.fil, this.track, s, pf, out, _k_t, _k_r);
    return out;
  }

  private add(type: number, p: Vec3, q: Quat, scale: number, tint: number, id = 0) {
    const f = this.ctx.field;
    if (f.actorCount >= f.actors.count) return;
    f.actors.set(f.actorCount++, { pos: rel(p), scale, rot: q, mtype: type, lod: 0, tint, id: 0x80000000 | (type << 16) | (id & 0x7fff) });
  }

  /** an ATP (or ADP: four balls; a lone phosphate: one) at p, turned by q, k times life size */
  private nucleotide(p: Vec3, q: Quat, balls: number, k: number) {
    const first = balls === 1 ? 5 : 0, last = balls === 1 ? 6 : balls === 5 ? 5 : 6;
    for (let i = first; i < last; i++) {
      const b = ATP_BALLS[i];
      vec3.set(_k_off, b[0] * k, b[1] * k, b[2] * k);
      vec3.transformQuat(_k_off, _k_off, q);
      vec3.add(_k_tmp, p, _k_off);
      this.add(MOL.ball, _k_tmp, _k_rot, b[3] * k, b[4]);
    }
  }

  update(dt: number) {
    const ctx = this.ctx;
    const f = ctx.field;
    f.actorCount = 0;
    if (this.running) {
      this.time += dt;
      if (this.time >= LIMIT) { this.time = LIMIT; this.finish(false); }
    }
    this.stall = Math.max(0, this.stall - dt);
    this.shake = Math.max(0, this.shake - dt * 3);
    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) this.el.msg.classList.remove('on'); }
    // the step in flight
    if (this.stepT < 1) {
      this.stepT = Math.min(1, this.stepT + dt / STEP_TIME);
      if (this.stepT >= 1) {
        this.n++;
        this.trailing ^= 1;
        if (this.n >= STEPS && !this.over) this.finish(true);
      }
    }
    if (this.sideT < 1) {
      this.sideT = Math.min(1, this.sideT + dt / SIDE_TIME);
      const e = this.sideT * this.sideT * (3 - 2 * this.sideT);
      this.pf = this.pfFrom + (this.pfTo - this.pfFrom) * e;
    }
    // roadblocks ahead
    if (this.running && this.n + 6 >= this.nextBlock && this.nextBlock < STEPS - 4) {
      this.blocks.push({ pf: Math.round(this.pfTo), j: this.j0 + this.nextBlock + 4 + (this.nextBlock % 2), seed: this.nextBlock, fade: 0 });
      this.nextBlock += this.rng.int(13, 20);
    }
    // waiting for ATP
    if (this.running && !this.atpBound && this.stepT >= 1) {
      this.bindIn -= dt;
      if (this.bindIn <= 0) this.catchAtp();
    }

    // the motor's pose: the leading head at base+1, the trailing one swinging from base to base+2
    const ease = this.stepT >= 1 ? 0 : this.stepT * this.stepT * (3 - 2 * this.stepT);
    const base = this.j0 + this.n;
    const pf = this.pf;
    const jitter = this.shake * Math.sin(this.time * 70) * 1.2;
    this.lattice(base + 1, pf, _k_axis);
    const T = _k_b, R = _k_R;
    vec3.copy(T, _k_t); vec3.copy(R, _k_r);
    vec3.scaleAndAdd(_k_lead, _k_axis, R, MT_R + HEAD_R);
    const tj = base + 2 * ease;
    this.lattice(tj, pf, _k_axis);
    const lift = Math.sin(ease * Math.PI) * 7;
    vec3.scaleAndAdd(_k_trail, _k_axis, _k_r, MT_R + HEAD_R + lift + jitter);
    // sideways swing: the moving head arcs round the far side a little
    const Bn = vec3.cross(_k_Bn, T, R);
    vec3.scaleAndAdd(_k_trail, _k_trail, Bn, Math.sin(ease * Math.PI) * 3.5 * (this.trailing ? 1 : -1));
    frameQuat(_k_q, T, R);
    this.add(MOL.kinhead, _k_lead, _k_q, 1, this.tint, 1);
    quat.setAxisAngle(_k_q2, T, Math.sin(ease * Math.PI) * 0.6);
    quat.multiply(_k_q2, _k_q2, _k_q);
    this.add(MOL.kinhead, _k_trail, _k_q2, 1, this.tint, 2);
    // the stalk rises from between the heads; the vesicle rides on top
    vec3.lerp(_k_head, _k_lead, _k_trail, 0.5);
    this.lattice(base + 0.5 + ease, pf, _k_axis);
    vec3.scaleAndAdd(_k_p, _k_axis, _k_r, MT_R + 6);
    this.add(MOL.kinstalk, _k_p, _k_q, 1, this.tint, 3);
    const top = vec3.scaleAndAdd(_k_top, _k_p, _k_r, 56 + VESICLE_R * 0.92);
    this.add(MOL.vesicle, top, quat.identity(_k_q2), VESICLE_R, this.tint, 4);

    // ATP: free ones drifting round the motor; the caught one flying in to the leading head's pocket
    const pocket = vec3.scaleAndAdd(_k_atp, _k_lead, R, 2.6);
    vec3.scaleAndAdd(pocket, pocket, T, 1.8);
    const t = this.time + 3;
    for (let i = 0; i < this.floaters.length; i++) {
      const fl = this.floaters[i];
      fl.fade = Math.min(1, fl.fade + dt * 1.5);
      vec3.set(_k_off, fl.home[0] + Math.sin(t * 0.7 + fl.phase[0]) * fl.amp, fl.home[1] + Math.sin(t * 0.53 + fl.phase[1]) * fl.amp, fl.home[2] + Math.sin(t * 0.61 + fl.phase[2]) * fl.amp);
      // (the floaters' frame follows the motor: x along the track, y radial)
      vec3.copy(_k_p, _k_lead);
      vec3.scaleAndAdd(_k_p, _k_p, T, _k_off[2]);
      vec3.scaleAndAdd(_k_p, _k_p, R, _k_off[1] + 14);
      vec3.scaleAndAdd(_k_p, _k_p, Bn, _k_off[0]);
      quat.setAxisAngle(_k_q2, Y, t * 0.4 + i);
      quat.multiply(_k_q2, fl.spin, _k_q2);
      this.nucleotide(_k_p, _k_q2, 6, ATP_K * fl.fade);
    }
    if (this.atpBound || this.atpFly < 1) {
      this.atpFly = Math.min(1, this.atpFly + dt / 0.16);
      const e = this.atpFly * this.atpFly * (3 - 2 * this.atpFly);
      vec3.lerp(_k_p, this.atpFrom, pocket, e);
      quat.slerp(_k_q2, this.atpFrom2, _k_q, e);
      this.nucleotide(_k_p, _k_q2, 6, ATP_K * (1 + 0.25 * e));
    }
    if (this.atpBound) vec3.copy(this.atpFrom, pocket);
    // spent ADP and phosphate drifting off
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.age += dt;
      if (d.age > 2.5) { this.debris.splice(i, 1); continue; }
      vec3.scaleAndAdd(d.pos, d.pos, d.vel, dt);
      this.nucleotide(d.pos, d.spin, d.balls, ATP_K * Math.min(1, (2.5 - d.age) * 2));
    }
    // tau on the lattice: a disordered chain lying along its protofilament
    for (const b of this.blocks) {
      b.fade = Math.min(1, b.fade + dt * 2);
      if (b.j < base - 3) continue;
      for (let k = 0; k < 13; k++) {
        const jj = b.j - 0.5 + k * 0.1;
        this.lattice(jj, b.pf, _k_axis);
        const w = Math.sin(k * 1.7 + b.seed + this.time * 2) * 1.1;
        vec3.scaleAndAdd(_k_p, _k_axis, _k_r, MT_R + 1.6 + Math.abs(w) * 0.6);
        const bn = vec3.cross(_k_tmp, _k_t, _k_r);
        vec3.scaleAndAdd(_k_p, _k_p, bn, w);
        this.add(MOL.ball, _k_p, _k_rot, 1.25 * b.fade, k % 4 === 0 ? C_TAU2 : C_TAU);
      }
    }

    // the camera: behind, above and to the side, looking along the track at the heads
    vec3.lerp(_k_look, _k_lead, _k_trail, 0.5);
    vec3.scaleAndAdd(_k_look, _k_look, R, 22);
    vec3.scaleAndAdd(_k_look, _k_look, T, 10);
    vec3.copy(_k_eye, _k_look);
    const sway = Math.sin(this.time * 0.35);
    vec3.scaleAndAdd(_k_eye, _k_eye, T, -44 + sway * 8);
    vec3.scaleAndAdd(_k_eye, _k_eye, R, 20 + sway * 4);
    vec3.scaleAndAdd(_k_eye, _k_eye, Bn, 112);
    const k = this.camReady ? 1 - Math.exp(-dt * 5) : 1;
    vec3.lerp(this.camEye, this.camEye, _k_eye, k);
    vec3.lerp(this.camAt, this.camAt, _k_look, k);
    const c = ctx.controls;
    vec3.subtract(_k_tmp, this.camAt, this.camEye);
    const dist = vec3.length(_k_tmp);
    vec3.scale(_k_tmp, _k_tmp, 1 / dist);
    vec3.copy(c.pivot, this.camAt);
    c.scale = dist;
    c.yaw = Math.atan2(-_k_tmp[0], -_k_tmp[2]);
    c.pitch = Math.asin(Math.max(-1, Math.min(1, _k_tmp[1])));
    // roll so the track runs left to right on screen (toward its plus end) and the cargo rides above
    c.basis();
    const tf = vec3.dot(T, c.forward);
    vec3.scaleAndAdd(_k_off, T, c.forward, -tf);
    const want = Math.atan2(vec3.dot(_k_off, c.up), vec3.dot(_k_off, c.right));
    const cam = ctx.kit.camera;
    cam.roll += Math.atan2(Math.sin(want - cam.roll), Math.cos(want - cam.roll)) * (this.camReady ? 1 - Math.exp(-dt * 4) : 1);
    this.camReady = true;

    // the interface
    const el = this.el;
    el.bar.style.width = `${(this.n / STEPS) * 100}%`;
    el.time.textContent = (LIMIT - this.time).toFixed(1);
    el.steps.textContent = String(this.n);
    el.atp.textContent = String(this.atpUsed);
    el.rate.textContent = (this.n / Math.max(this.time, 0.5)).toFixed(1);
    const idle = this.running ? '' : '0.25';
    if (el.left.style.opacity !== idle) for (const e of [el.left, el.right, el.atpLight.parentElement!]) { e.style.opacity = idle; e.style.pointerEvents = idle ? 'none' : ''; }
    el.left.classList.toggle('next', this.running && this.trailing === 0);
    el.right.classList.toggle('next', this.running && this.trailing === 1);
    const ready = this.atpBound && this.atpFly >= 1;
    el.atpLight.classList.toggle('on', ready);
    el.atpLight.textContent = ready ? 'ATP bound — step!' : 'waiting for ATP…';
    const blocked = !!this.blockedAhead();
    for (const b of el.side.querySelectorAll('button')) b.classList.toggle('warn', blocked);
  }

  /** the nearest free ATP flies into the leading head's pocket */
  private catchAtp() {
    let best = 0, bd = 1e9;
    for (let i = 0; i < this.floaters.length; i++) {
      const h = this.floaters[i].home;
      const d = h[0] * h[0] + (h[1] + 14) * (h[1] + 14) + h[2] * h[2];
      if (d < bd) { bd = d; best = i; }
    }
    const fl = this.floaters[best];
    // where it is now, in the world (the same frame the floaters are drawn in)
    const T = _k_t, R = _k_r;
    this.lattice(this.j0 + this.n + 1, this.pf, _k_axis);
    vec3.scaleAndAdd(_k_p, _k_axis, R, MT_R + HEAD_R);
    const Bn = vec3.cross(_k_Bn, T, R);
    const t = this.time + 3;
    vec3.scaleAndAdd(_k_p, _k_p, T, fl.home[2] + Math.sin(t * 0.61 + fl.phase[2]) * fl.amp);
    vec3.scaleAndAdd(_k_p, _k_p, R, fl.home[1] + Math.sin(t * 0.53 + fl.phase[1]) * fl.amp + 14);
    vec3.scaleAndAdd(_k_p, _k_p, Bn, fl.home[0] + Math.sin(t * 0.7 + fl.phase[0]) * fl.amp);
    vec3.copy(this.atpFrom, _k_p);
    quat.copy(this.atpFrom2, fl.spin);
    // and a fresh one drifts in from the soup to take its place
    const rng = this.rng;
    fl.home = [rng.range(-38, 38), rng.range(-30, 34), rng.range(-20, 60)];
    fl.fade = 0;
    this.atpBound = true;
    this.atpFly = 0;
  }
}

registerGame(new KinesinGame());
