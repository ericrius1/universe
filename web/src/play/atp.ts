// Spin the turbine: you are ATP synthase, set into a crista of a mitochondrion. Protons crowding the crista's inside
// want to get out into the matrix, and the only way through is your c-ring: each one that passes turns it an eighth of
// a turn. Crank the rotor the synthesis way (counter-clockwise seen from the matrix — the dial, → / D held, or a
// sideways drag) and every third of a turn your head squeezes ADP and phosphate into one ATP and lets it go. Crank it
// backwards and you run as a pump: burning ATP to push protons back. Make 30 ATP in 45 seconds.
// Drawn: the real bovine ATP synthase (PDB 6ZPO) in the crista membrane, its rotor (c-ring, γ, δ, ε) turned by the
// player through the actor's tint (id bit 0x8000 — beads.wgsl); protons as small bright balls leaving at the membrane
// by the stator, ATP / ADP / phosphate as clusters of tinted balls at the three catalytic sites. Simplified: the
// proton path through the a-subunit and the c-ring lies inside the membrane, so only their exits are shown; protons and
// nucleotides drawn a little larger than life; the real motor turns ~150 times a second.
import { vec3, quat, type Vec3, type Quat } from 'math';
import { registerGame, type Game, type GameCtx } from './game';
import { frameQuat } from '../world/walkers';
import { MOL } from '../world/molecules';
import { Kind } from '../world/layout';
import { buildPlaces } from '../ui/places';
import { Rng } from '../world/noise';
import { rel } from '../engine/origin';

const GOAL = 30;
const LIMIT = 45;
const C_SUBUNITS = 8;
const REAL_RPS = 150;

const rgba = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255 | ((n >> 8) & 255) << 8 | (n & 255) << 16 | 255 << 24) >>> 0;
};
const C_ADENINE = rgba('#6f8dff'), C_RIBOSE = rgba('#f2e6cf'), C_PHOS = rgba('#ffae3a'), C_PROTON = rgba('#ff5a3c'), C_PROTON2 = rgba('#ffd0a0');
// a nucleotide along its own x: adenine (two rings), ribose, phosphates α β γ
const NUC: [number, number, number, number, number][] = [
  [-1.05, 0.35, 0, 0.5, C_ADENINE], [-0.55, -0.15, 0, 0.42, C_ADENINE], [0.05, 0, 0, 0.42, C_RIBOSE],
  [0.62, 0, 0, 0.34, C_PHOS], [1.15, 0, 0, 0.34, C_PHOS], [1.68, 0, 0, 0.34, C_PHOS],
];

interface Bit { pos: Vec3; vel: Vec3; age: number; life: number; spin: Quat; kind: number }   // kind: 0 ATP, 1 ADP, 2 Pi, 3 proton
const K_ATP = 0, K_ADP = 1, K_PI = 2, K_H = 3;

const _a_p = vec3.create(), _a_off = vec3.create(), _a_tmp = vec3.create(), _a_eye = vec3.create(), _a_look = vec3.create();
const _a_q = quat.create(), _a_q2 = quat.create(), _a_id: Quat = [0, 0, 0, 1];

const STYLE = `
.ag-top { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); width: min(560px, calc(100vw - 32px)); text-align: center;
  background: rgba(14, 11, 18, 0.62); border: 1px solid var(--line); border-radius: 14px; padding: 12px 18px; backdrop-filter: blur(16px) saturate(1.3); }
.ag-title { font: 400 22px/1.1 var(--serif); }
.ag-title em { font-style: italic; color: var(--accent); }
.ag-count { font: 600 30px var(--mono); color: #ffcf5a; margin: 6px 0 2px; text-shadow: 0 0 18px rgba(255, 190, 80, 0.5); transition: transform 0.12s; }
.ag-count.pop { transform: scale(1.18); }
.ag-count small { font-size: 14px; color: var(--faint); }
.ag-stats { display: flex; justify-content: space-between; gap: 10px; font: 12px var(--mono); color: var(--dim); flex-wrap: wrap; }
.ag-stats b { color: var(--ink); font-weight: 600; }
.ag-gauge { position: relative; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.08); margin-top: 9px; }
.ag-gauge i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; background: linear-gradient(90deg, #ff9a3c, #ffd27a); width: 0; }
.ag-gauge span { position: absolute; right: 0; top: 9px; font: 10.5px var(--mono); color: var(--faint); }
.ag-gauge em { position: absolute; left: 0; top: 9px; font: normal 10.5px var(--mono); color: var(--faint); }
.ag-x { position: absolute; top: 14px; right: 16px; width: 38px; height: 38px; border-radius: 50%; border: 1px solid var(--line); background: var(--glass);
  color: var(--ink); font-size: 20px; cursor: pointer; backdrop-filter: blur(12px); }
.ag-dialbox { position: absolute; right: 22px; bottom: 22px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.ag-dial { width: min(210px, 42vw); height: min(210px, 42vw); border-radius: 50%; background: rgba(14, 11, 18, 0.55); border: 1px solid var(--line);
  backdrop-filter: blur(12px); cursor: grab; touch-action: none; }
.ag-dial:active { cursor: grabbing; }
.ag-hint { font: 11.5px var(--sans); color: var(--dim); text-align: center; max-width: 220px; line-height: 1.35; }
.ag-mode { position: absolute; left: 22px; bottom: 26px; font: 12px var(--mono); padding: 7px 13px; border-radius: 999px; border: 1px solid var(--line);
  background: rgba(14,11,18,0.55); color: var(--faint); transition: all 0.2s; }
.ag-mode.syn { color: #1a0f05; background: #ffcf5a; border-color: #ffe39a; box-shadow: 0 0 20px rgba(255, 200, 90, 0.5); }
.ag-mode.pump { color: #fff; background: #c0392b; border-color: #ff7a6a; box-shadow: 0 0 20px rgba(255, 80, 60, 0.5); }
.ag-msg { position: absolute; top: 27%; left: 50%; transform: translate(-50%, -50%); font: 400 clamp(19px, 2.8vw, 28px) var(--serif); text-align: center;
  text-shadow: 0 2px 20px rgba(0,0,0,0.9); opacity: 0; transition: opacity 0.3s; pointer-events: none; max-width: 80vw; }
.ag-msg.on { opacity: 1; }
.ag-card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(460px, calc(100vw - 32px)); background: rgba(14, 11, 18, 0.82);
  border: 1px solid var(--line); border-radius: 16px; padding: 22px 24px 18px; backdrop-filter: blur(18px) saturate(1.3); }
.ag-card h2 { margin: 0 0 4px; font: 400 28px/1.1 var(--serif); }
.ag-card h2 em { font-style: italic; color: var(--accent); }
.ag-card p { margin: 8px 0; font-size: 13.5px; line-height: 1.55; color: rgba(244,237,230,0.86); }
.ag-card ul { margin: 8px 0; padding-left: 18px; font-size: 13px; line-height: 1.5; color: var(--dim); }
.ag-card .big { font: 600 30px var(--mono); color: var(--accent); margin: 6px 0 2px; }
.ag-card .acts { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.ag-card .note { font: 11px var(--mono); color: var(--faint); }
@media (max-width: 760px) { .ag-title { font-size: 18px; } .ag-mode { bottom: auto; top: 150px; left: 14px; } }
`;

function injectStyle() {
  if (document.getElementById('ag-style')) return;
  const s = document.createElement('style');
  s.id = 'ag-style';
  s.textContent = STYLE;
  document.head.append(s);
}

class AtpGame implements Game {
  id = 'atp';
  role = 'ATP synthase';
  title = 'Spin the turbine';
  blurb = 'A rotary motor in the mitochondrion: let protons turn you, and make the cell\'s energy, three ATP a turn.';
  art = 'atp';

  private ctx!: GameCtx;
  private rng = new Rng(29);
  // where the motor stands: its middle in the membrane, the membrane's normal (toward the matrix), a tangent
  private origin = vec3.create();
  private n = vec3.create();
  private t1 = vec3.create();
  private t2 = vec3.create();
  private frame = quat.create();
  /** rotor turns made, + the synthesis way */
  private turn = 0;
  private omega = 0;
  private omegaShown = 0;
  private peak = 0;
  private drive = 0;
  private lastThird = 0;
  private lastEighth = 0;
  private made = 0;
  private burned = 0;
  private time = 0;
  private running = false;
  private over = false;
  private bits: Bit[] = [];
  private mode = 0;
  private modeHold = 0;
  private savedPerChunk = 0;
  private camAngle = 0;
  private neighbours: { pos: Vec3; phase: number }[] = [];
  private drifters: { pos: Vec3; vel: Vec3; type: number; spin: Quat }[] = [];
  private el: Record<string, HTMLElement> = {};
  private dial!: HTMLCanvasElement;
  private dctx!: CanvasRenderingContext2D;
  private dialDrag: { id: number; a: number } | null = null;
  private canvasDrag: { id: number; x: number } | null = null;
  private keys = new Set<string>();
  private msgTimer = 0;
  private told = false;
  private onKeyDown = (e: KeyboardEvent) => { const k = e.key.toLowerCase(); if (['arrowleft', 'arrowright', 'a', 'd'].includes(k)) { e.preventDefault(); this.keys.add(k); } if ((k === ' ' || k === 'enter') && !this.running && !this.over) this.ctx.panel.querySelector<HTMLButtonElement>('[data-go]')?.click(); };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private onCanvasDown = (e: PointerEvent) => { this.canvasDrag = { id: e.pointerId, x: e.clientX }; };
  private onMove = (e: PointerEvent) => this.move(e);
  private onUp = (e: PointerEvent) => { if (this.dialDrag?.id === e.pointerId) this.dialDrag = null; if (this.canvasDrag?.id === e.pointerId) this.canvasDrag = null; };

  start(ctx: GameCtx) {
    this.ctx = ctx;
    injectStyle();
    this.place();
    this.reset();
    ctx.controls.driven = true;
    this.savedPerChunk = ctx.field.perChunk;
    // (the field's crowd off: this stage is set by hand — a row of neighbours behind, a few enzymes in the matrix)
    ctx.field.perChunk = 0;
    this.buildUi();
    this.intro();
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    ctx.kit.canvas.addEventListener('pointerdown', this.onCanvasDown);
    addEventListener('pointermove', this.onMove);
    addEventListener('pointerup', this.onUp);
    addEventListener('pointercancel', this.onUp);
  }

  stop() {
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    this.ctx.kit.canvas.removeEventListener('pointerdown', this.onCanvasDown);
    removeEventListener('pointermove', this.onMove);
    removeEventListener('pointerup', this.onUp);
    removeEventListener('pointercancel', this.onUp);
    this.ctx.field.perChunk = this.savedPerChunk;
    this.ctx.field.actorCount = 0;
    this.ctx.kit.camera.roll = 0;
    this.running = false;
  }

  /** stand on the crista the 'atp' place looks at (a mitochondrion outside the cutaway), F1 head into the matrix */
  private place() {
    const w = this.ctx.world;
    const p = buildPlaces(w).find((x) => x.id === 'atp')!;
    let crista = w.organelles.find((o) => o.kind === Kind.Crista && vec3.distance(vec3.scaleAndAdd(_a_tmp, o.a as Vec3, o.b as Vec3, o.thick / 2), p.at as Vec3) < 0.01);
    crista ??= w.organelles.find((o) => o.kind === Kind.Crista)!;
    vec3.copy(this.n, crista.b as Vec3);
    // (the membrane's middle: 2.5 nm in from the crista's face)
    vec3.scaleAndAdd(this.origin, crista.a as Vec3, this.n, crista.thick / 2 - 2.5);
    vec3.normalize(this.t1, vec3.cross(this.t1, this.n, Math.abs(this.n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    vec3.cross(this.t2, this.n, this.t1);
    frameQuat(this.frame, this.t1, this.n);
    // ATP synthase lines the crista in rows of dimers: two rows behind ours (seen from the camera's side)
    const rng = new Rng(5);
    this.neighbours = [];
    for (const [x, zs] of [[-34, [-70, -48, -22, 0, 22, 48, 70]], [-66, [-80, -58, -30, -8, 16, 40, 64, 88]]] as [number, number[]][]) {
      for (const z of zs) this.neighbours.push({ pos: this.local(vec3.create(), x + rng.range(-3, 3), 0, z + rng.range(-3, 3)), phase: rng.range(0, 1) });
    }
    // and a few matrix enzymes drifting far behind (citrate synthase, GAPDH)
    this.drifters = [];
    for (let i = 0; i < 14; i++) {
      const pos = this.local(vec3.create(), rng.range(-170, -60), rng.range(14, 70), rng.range(-120, 120));
      this.drifters.push({ pos, vel: [rng.range(-2, 2), rng.range(-1, 1), rng.range(-2, 2)], type: rng.next() < 0.7 ? MOL.citratesynthase : MOL.gapdh, spin: quat.normalize(quat.create(), [rng.gauss(), rng.gauss(), rng.gauss(), rng.gauss()]) });
    }
  }

  private reset() {
    this.turn = 0;
    this.omega = 0;
    this.omegaShown = 0;
    this.peak = 0;
    this.lastThird = 0;
    this.lastEighth = 0;
    this.made = 0;
    this.burned = 0;
    this.time = 0;
    this.over = false;
    this.running = false;
    this.bits = [];
    this.mode = 0;
    this.told = false;
    // ADP and phosphate waiting at the empty sites
    for (let k = 0; k < 3; k++) this.spawnSite(k, K_ADP, true);
  }

  // ---------------------------------------------------------------- interface
  private buildUi() {
    const p = this.ctx.panel;
    p.innerHTML = `
      <div class="ag-top">
        <div class="ag-title">Spin the turbine · <em>ATP synthase</em></div>
        <div class="ag-count"><span data-k="made">0</span><small> / ${GOAL} ATP</small></div>
        <div class="ag-stats"><span>time <b data-k="time">${LIMIT}.0</b></span><span><b data-k="rps">0.00</b> turns/s</span><span>H⁺ through <b data-k="h">0</b></span></div>
        <div class="ag-gauge"><i></i><em>you</em><span>real motor: ${REAL_RPS} turns/s</span></div>
      </div>
      <button class="ag-x" title="Leave (Esc)">×</button>
      <div class="ag-mode">idle</div>
      <div class="ag-dialbox"><canvas class="ag-dial" width="420" height="420"></canvas><div class="ag-hint">crank the c-ring counter-clockwise ↺ (seen from the matrix) · or hold → / D</div></div>
      <div class="ag-msg"></div>`;
    const q = (s: string) => p.querySelector(s) as HTMLElement;
    this.el = { made: q('[data-k=made]'), count: q('.ag-count'), time: q('[data-k=time]'), rps: q('[data-k=rps]'), h: q('[data-k=h]'), gauge: q('.ag-gauge i'), mode: q('.ag-mode'), msg: q('.ag-msg') };
    q('.ag-x').addEventListener('click', () => this.ctx.exit());
    this.dial = q('.ag-dial') as HTMLCanvasElement;
    this.dctx = this.dial.getContext('2d')!;
    this.dial.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.dial.setPointerCapture(e.pointerId);
      this.dialDrag = { id: e.pointerId, a: this.dialAngle(e) };
    });
  }

  private dialAngle(e: PointerEvent) {
    const r = this.dial.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  }

  private move(e: PointerEvent) {
    if (!this.running) return;
    if (this.dialDrag && this.dialDrag.id === e.pointerId) {
      const a = this.dialAngle(e);
      let d = a - this.dialDrag.a;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.dialDrag.a = a;
      // (screen y runs down: an angle going down is counter-clockwise to the eye — the synthesis way)
      this.crank(-d / (Math.PI * 2));
    } else if (this.canvasDrag && this.canvasDrag.id === e.pointerId) {
      const dx = e.clientX - this.canvasDrag.x;
      this.canvasDrag.x = e.clientX;
      this.crank(dx / 900);
    }
  }

  /** turn the rotor by `rev` revolutions (+ synthesis) */
  private crank(rev: number) {
    this.drive += rev;
  }

  private card(html: string) {
    const c = document.createElement('div');
    c.className = 'ag-card';
    c.innerHTML = html;
    c.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.ctx.panel.append(c);
    return c;
  }

  private intro() {
    const c = this.card(`
      <h2>You are <em>ATP synthase</em></h2>
      <p>A rotary motor in the inner membrane of a mitochondrion. Food burned by the respiratory chain has pumped protons into the crista beneath you; they can only get back out through your c-ring, turning it as they go.</p>
      <ul>
        <li>Crank the dial <b>counter-clockwise</b> (or hold <b>→ / D</b>): eight protons pass per turn.</li>
        <li>Every third of a turn your head binds ADP + phosphate and squeezes out one <b>ATP</b>.</li>
        <li>Turn it backwards and you become a pump, burning ATP.</li>
      </ul>
      <p>Make <b>${GOAL} ATP</b> in ${LIMIT} seconds.</p>
      <div class="acts"><button class="btn btn-play" data-go>Start spinning</button><button class="btn" data-back>Back to the cell</button></div>`);
    c.querySelector('[data-go]')!.addEventListener('click', () => { c.remove(); this.running = true; this.ctx.sound('click'); });
    c.querySelector('[data-back]')!.addEventListener('click', () => this.ctx.exit());
  }

  private say(text: string, secs = 1.6) {
    this.el.msg.innerHTML = text;
    this.el.msg.classList.add('on');
    this.msgTimer = secs;
  }

  private finish() {
    this.over = true;
    this.running = false;
    const won = this.made >= GOAL;
    this.ctx.sound(won ? 'win' : 'bad');
    const c = this.card(`
      <h2>${won ? 'Fully <em>charged</em>' : 'Out of <em>time</em>'}</h2>
      <div class="big">${this.made} ATP</div>
      <p class="note">${this.time.toFixed(1)} s · peak ${this.peak.toFixed(2)} turns/s${this.burned ? ` · ${this.burned} burned pumping` : ''}</p>
      <p>The real motor turns about <b>${REAL_RPS} times a second</b> — some 450 ATP a second from each one, and a mitochondrion holds thousands. Together they make about <b>your body weight in ATP every day</b>, each molecule recycled a thousand times or so.</p>
      <p>Paul Boyer worked out that the head makes ATP by changing shape as it turns; John Walker solved its structure. They shared the 1997 Nobel Prize in Chemistry.</p>
      <p class="note">Simplified: the protons' path through the a-subunit and c-ring is inside the membrane, so only their exits are drawn; molecules a little larger than life; the clock runs slow.</p>
      <div class="acts"><button class="btn btn-play" data-again>${won ? 'Play again' : 'Try again'}</button><button class="btn" data-back>Back to the cell</button></div>`);
    c.querySelector('[data-again]')!.addEventListener('click', () => { c.remove(); this.reset(); this.running = true; this.ctx.sound('click'); });
    c.querySelector('[data-back]')!.addEventListener('click', () => this.ctx.exit());
  }

  // ---------------------------------------------------------------- the machine
  /** world position of a point in the motor's frame (x, y up the axis, z) */
  private local(out: Vec3, x: number, y: number, z: number) {
    vec3.copy(out, this.origin);
    vec3.scaleAndAdd(out, out, this.t1, x);
    vec3.scaleAndAdd(out, out, this.n, y);
    return vec3.scaleAndAdd(out, out, this.t2, z);
  }

  /** catalytic site k of the three (they take turns as the rotor goes round): its place on the head */
  private site(out: Vec3, k: number, lift = 0) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    return this.local(out, Math.cos(a) * (6.2 + lift), 11.5 + lift * 0.6, Math.sin(a) * (6.2 + lift));
  }

  private spawnSite(k: number, kind: number, waiting: boolean) {
    const rng = this.rng;
    const b: Bit = { pos: this.site(vec3.create(), k, waiting ? 2.5 : 0), vel: [0, 0, 0], age: 0, life: waiting ? 1e9 : 3, spin: quat.normalize(quat.create(), [rng.gauss(), rng.gauss(), rng.gauss(), rng.gauss()]), kind };
    if (!waiting) {
      // drift away from the head into the matrix
      vec3.subtract(_a_tmp, b.pos, this.local(_a_p, 0, 11.5, 0));
      vec3.normalize(_a_tmp, _a_tmp);
      vec3.scaleAndAdd(b.vel, b.vel, _a_tmp, rng.range(7, 11));
      vec3.scaleAndAdd(b.vel, b.vel, this.n, rng.range(2, 5));
    }
    this.bits.push(b);
    return b;
  }

  private proton(out: boolean) {
    const rng = this.rng;
    // they leave (synthesis) or are pulled in (pumping) at the membrane's surface beside the stator
    const ang = rng.range(-0.5, 0.5);
    const p = this.local(vec3.create(), Math.cos(ang) * 7, 3, Math.sin(ang) * 7);
    const away = this.local(vec3.create(), Math.cos(ang) * 16, 6 + rng.range(0, 6), Math.sin(ang) * 16);
    vec3.subtract(away, away, p);
    const b: Bit = { pos: out ? p : vec3.scaleAndAdd(vec3.create(), p, away, 1), vel: vec3.scale(away, away, (out ? 1 : -1) * rng.range(0.8, 1.3)), age: 0, life: 1, spin: quat.create(), kind: K_H };
    this.bits.push(b);
  }

  private add(type: number, p: Vec3, q: Quat, scale: number, tint: number, id = 0) {
    const f = this.ctx.field;
    if (f.actorCount >= f.actors.count) return;
    f.actors.set(f.actorCount++, { pos: rel(p), scale, rot: q, mtype: type, lod: 0, tint, id: 0x80000000 | (type << 16) | id });
  }

  private nucleotide(p: Vec3, q: Quat, kind: number, k: number) {
    const first = kind === K_PI ? 5 : 0, last = kind === K_ATP ? 6 : kind === K_ADP ? 5 : 6;
    for (let i = first; i < last; i++) {
      const b = NUC[i];
      vec3.set(_a_off, b[0] * k, b[1] * k, b[2] * k);
      vec3.transformQuat(_a_off, _a_off, q);
      vec3.add(_a_tmp, p, _a_off);
      this.add(MOL.ball, _a_tmp, _a_id, b[3] * k, b[4]);
    }
  }

  update(dt: number) {
    const ctx = this.ctx;
    ctx.field.actorCount = 0;
    if (this.running) {
      this.time += dt;
      if (this.time >= LIMIT) { this.time = LIMIT; this.finish(); }
    }
    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) this.el.msg.classList.remove('on'); }
    // the rotor: direct cranks (dial, drag) plus held keys as a torque against friction
    let torque = 0;
    if (this.running) {
      if (this.keys.has('arrowright') || this.keys.has('d')) torque += 2.4;
      if (this.keys.has('arrowleft') || this.keys.has('a')) torque -= 2.4;
    }
    this.omega += torque * dt;
    this.omega *= Math.exp(-dt * 1.6);
    const before = this.turn;
    this.turn += this.omega * dt + (this.running ? this.drive : 0);
    this.drive = 0;
    const d = this.turn - before;
    const inst = dt > 0 ? d / dt : 0;
    this.omegaShown += (inst - this.omegaShown) * (1 - Math.exp(-dt * 4));
    this.peak = Math.max(this.peak, this.omegaShown);
    const m = this.omegaShown > 0.02 ? 1 : this.omegaShown < -0.02 ? -1 : 0;
    if (m !== this.mode) { this.modeHold += dt; if (this.modeHold > 0.15) { this.mode = m; this.modeHold = 0; } } else this.modeHold = 0;

    // every eighth of a turn a proton crosses; every third, an ATP made (or, backwards, one burned)
    const eighth = Math.floor(this.turn * C_SUBUNITS);
    while (eighth > this.lastEighth) { this.lastEighth++; this.proton(true); }
    while (eighth < this.lastEighth) { this.lastEighth--; this.proton(false); }
    const third = Math.floor(this.turn * 3);
    while (third > this.lastThird) {
      this.lastThird++;
      const k = ((this.lastThird % 3) + 3) % 3;
      // the waiting ADP + Pi at that site leave as ATP
      const w = this.bits.findIndex((b) => b.life > 1e8 && b.kind === K_ADP && vec3.distance(b.pos, this.site(_a_p, k, 2.5)) < 0.5);
      if (w >= 0) this.bits.splice(w, 1);
      this.spawnSite(k, K_ATP, false);
      // (and fresh ADP + phosphate take the empty site)
      this.spawnSite(k, K_ADP, true);
      if (this.running) {
        this.made++;
        ctx.sound('atp');
        this.el.count.classList.add('pop');
        setTimeout(() => this.el.count.classList.remove('pop'), 120);
        if (this.made === 1 && !this.told) { this.told = true; this.say('One ATP! Three per turn — keep it spinning'); }
        if (this.made >= GOAL && !this.over) this.finish();
      }
    }
    while (third < this.lastThird) {
      this.lastThird--;
      const k = ((this.lastThird % 3) + 3) % 3;
      // pumping: an ATP is taken in and split, ADP and phosphate let go
      const b = this.spawnSite(k, K_ADP, false);
      vec3.scale(b.vel, b.vel, 0.7);
      const pi = this.spawnSite(k, K_PI, false);
      vec3.scale(pi.vel, pi.vel, 1.2);
      if (this.running) {
        this.burned++;
        this.made = Math.max(0, this.made - 1);
        ctx.sound('bad', 0.6);
        this.say('Backwards: you\'re a pump now, burning ATP to push protons back', 2.2);
      }
    }

    // the motor, its rotor at the player's angle (tenths of a degree; beads.wgsl turns it by -angle about +Y, so
    // synthesis — counter-clockwise from the matrix side — is the angle going down)
    const tenths = ((Math.round(-this.turn * 3600) % 3600) + 3600) % 3600;
    this.add(MOL.atpsynthase, this.origin, this.frame, 1, tenths, 0x8000);
    // the neighbours turn on their own, the synthesis way, ~1.5 turns a second (life's 150, slowed)
    const tt = performance.now() / 1000;
    for (const nb of this.neighbours) {
      const ang = ((Math.round(-(tt * 1.5 + nb.phase) * 3600) % 3600) + 3600) % 3600;
      this.add(MOL.atpsynthase, nb.pos, this.frame, 1, ang, 0x8000);
    }
    for (const d of this.drifters) {
      vec3.scaleAndAdd(d.pos, d.pos, d.vel, dt);
      quat.setAxisAngle(_a_q2, this.n, dt * 0.2);
      quat.multiply(d.spin, _a_q2, d.spin);
      this.add(d.type, d.pos, d.spin, 1, 0);
    }
    // nucleotides and protons
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      b.age += dt;
      if (b.age > b.life) { this.bits.splice(i, 1); continue; }
      vec3.scaleAndAdd(b.pos, b.pos, b.vel, dt);
      const fade = Math.min(1, (b.life - b.age) * 2, b.age * 6 + 0.2);
      if (b.kind === K_H) {
        this.add(MOL.ball, b.pos, _a_id, 0.55 * fade, C_PROTON);
        vec3.scaleAndAdd(_a_p, b.pos, b.vel, -0.06);
        this.add(MOL.ball, _a_p, _a_id, 0.32 * fade, C_PROTON2);
      } else {
        quat.setAxisAngle(_a_q2, this.n, b.age * 1.5);
        quat.multiply(_a_q, _a_q2, b.spin);
        this.nucleotide(b.pos, _a_q, b.kind, 1.7 * fade);
      }
    }

    // the camera: level with the membrane, a little above it, circling slowly
    this.camAngle += dt;
    const sway = 0.3 + 0.32 * Math.sin(this.camAngle * 0.13);
    const ca = Math.cos(sway), sa = Math.sin(sway);
    this.local(_a_look, 0, 9.5, 0);
    this.local(_a_eye, ca * 40, 15, sa * 40);
    const c = ctx.controls;
    vec3.subtract(_a_tmp, _a_look, _a_eye);
    const dist = vec3.length(_a_tmp);
    vec3.scale(_a_tmp, _a_tmp, 1 / dist);
    vec3.copy(c.pivot, _a_look);
    c.scale = dist;
    c.yaw = Math.atan2(-_a_tmp[0], -_a_tmp[2]);
    c.pitch = Math.asin(Math.max(-1, Math.min(1, _a_tmp[1])));
    // roll so the membrane lies flat across the screen, the head up
    c.basis();
    vec3.scaleAndAdd(_a_off, this.n, c.forward, -vec3.dot(this.n, c.forward));
    ctx.kit.camera.roll = Math.atan2(-vec3.dot(_a_off, c.right), vec3.dot(_a_off, c.up));

    // the interface
    const el = this.el;
    el.made.textContent = String(this.made);
    el.time.textContent = (LIMIT - this.time).toFixed(1);
    el.rps.textContent = this.omegaShown.toFixed(2);
    el.h.textContent = String(Math.max(0, this.lastEighth));
    // (a log gauge: 0.05 to 150 turns a second)
    const g = Math.max(0, Math.min(1, Math.log10(Math.max(this.omegaShown, 0.05) / 0.05) / Math.log10(REAL_RPS / 0.05)));
    el.gauge.style.width = `${(g * 100).toFixed(1)}%`;
    el.mode.className = `ag-mode${this.mode > 0 ? ' syn' : this.mode < 0 ? ' pump' : ''}`;
    el.mode.textContent = this.mode > 0 ? 'synthesis: ADP + Pi → ATP' : this.mode < 0 ? 'pump mode: ATP → ADP + Pi' : 'idle';
    this.drawDial();
  }

  /** the c-ring seen from the matrix: eight c-subunits turning, protons riding the ones that hold them */
  private drawDial() {
    const g = this.dctx, W = this.dial.width, cx = W / 2, R = W * 0.33;
    g.clearRect(0, 0, W, W);
    const rot = -this.turn * Math.PI * 2;
    // the synthesis arrow
    g.strokeStyle = 'rgba(255, 207, 90, 0.35)';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(cx, cx, R * 1.32, -0.3, -2.4, true);
    g.stroke();
    const ax = cx + Math.cos(-2.4) * R * 1.32, ay = cx + Math.sin(-2.4) * R * 1.32;
    g.fillStyle = 'rgba(255, 207, 90, 0.6)';
    g.beginPath();
    g.moveTo(ax - 14, ay + 4); g.lineTo(ax + 6, ay - 14); g.lineTo(ax + 10, ay + 10); g.fill();
    // the stator (a-subunit) at the right: where protons pass
    g.fillStyle = 'rgba(255, 106, 61, 0.55)';
    g.beginPath();
    g.ellipse(cx + R * 1.12, cx, R * 0.22, R * 0.36, 0, 0, Math.PI * 2);
    g.fill();
    for (let k = 0; k < C_SUBUNITS; k++) {
      const a = rot + (k / C_SUBUNITS) * Math.PI * 2;
      const x = cx + Math.cos(a) * R, y = cx + Math.sin(a) * R;
      g.fillStyle = k === 0 ? '#ffd27a' : '#e9a24a';
      g.beginPath(); g.arc(x, y, R * 0.3, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(20, 10, 5, 0.5)'; g.lineWidth = 3; g.stroke();
      // a proton on the half of the ring that's carrying them round
      const side = Math.cos(a - Math.PI);
      if (side > -0.2) {
        g.fillStyle = '#ff5a3c';
        g.beginPath(); g.arc(cx + Math.cos(a) * R * 1.02, cx + Math.sin(a) * R * 1.02, R * 0.1, 0, Math.PI * 2); g.fill();
      }
    }
    // the central stalk (γ), off-centre like the real one
    g.fillStyle = '#f2e6cf';
    g.beginPath(); g.arc(cx + Math.cos(rot) * R * 0.18, cx + Math.sin(rot) * R * 0.18, R * 0.22, 0, Math.PI * 2); g.fill();
  }
}

registerGame(new AtpGame());
