// "Transcribe": you are RNA polymerase II copying the GFP gene into messenger RNA, in the nucleus. The DNA is a
// straight duplex of base-pair molecules that screws through the polymerase (PDB 5FLM, turned so its own scaffold DNA
// lies along ours and its RNA faces the exit); round the active site the strands part — a bubble of ~12 base pairs —
// the coding strand looping out of the way while the template strand is read. The base to copy is shown big; press its
// partner (A→U, T→A, G→C, C→G) and a nucleotide flies in from the entry channel, pairs, and the enzyme steps on one base
// pair; the new RNA pairs with the template for 8–9 bases (the hybrid), then peels off and leaves through the exit
// channel. A wrong base makes it stall, backtrack and cut the mistake out (proofreading). After sixteen bases the rest
// of the gene is copied on fast-forward, then the polymerase passes the poly(A) signal and lets the RNA go.
// Simplified: no transcription factors or Mediator, the start is the Kozak leader just before the start codon, and the
// RNA is shown already as it will be read (cap, splicing and tail are told, not drawn).
import { vec3, quat, type Vec3, type Quat } from 'math';
import { registerGame, type GameCtx } from './game';
import { MOL } from '../world/molecules';
import { Kind } from '../world/layout';
import {
  GFP_CDS, BASE_UI, BASE_3D, PANEL_CSS, Emit, tint, css, colored, clearOfWedge, whereIs, steerCamera, fitScale, axes, beadsWhere, alignQuat,
} from './ribosome';

/** the transcript: a short leader (ending in the Kozak sequence GCCACC), the GFP coding sequence, a 3′ tail with the
 *  poly(A) signal AATAAA */
const LEADER = 'GCCACC';
const TRAILER = 'GCGGCCGCTTTAATAAAGGAATC';
const GENE = LEADER + GFP_CDS + TRAILER;
/** upstream of the start: a promoter with its TATA box ~30 bases up, in the DNA the polymerase has already passed */
const PROMOTER = 'GGTAGGCGTGTACGGTGGGAGGTCTATATAAGCAGAGCTCGTTTAGTGAACCGTCAGATC';
const PAIR_CODE: Record<string, number> = { A: 0, T: 1, G: 2, C: 3 };
const TO_RNA: Record<string, string> = { A: 'A', T: 'U', G: 'G', C: 'C' };
const DNA_PAIR: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };

const INTERACTIVE = 16;
const RISE = 0.34;
const TWIST = (36 * Math.PI) / 180;
const HYBRID = 9;
// the B-DNA base pair model's own geometry (molecules.ts dnaBasePair): backbones 0.92 nm out, 144° apart
const R_BB = 0.92, HALF = (72 * Math.PI) / 180;

type Phase = 'intro' | 'read' | 'fly' | 'step' | 'wrong' | 'auto' | 'release' | 'done';

const _p_a = vec3.create(), _p_b = vec3.create(), _p_c = vec3.create(), _p_x = vec3.create(), _p_z = vec3.create();
const _p_q = quat.create();

function codingBase(i: number): string {
  if (i >= 0) return i < GENE.length ? GENE[i] : 'ACGT'[(i * 7 + 1) & 3];
  const k = PROMOTER.length + i;
  return k >= 0 ? PROMOTER[k] : 'ACGT'[((-i) * 5 + 2) & 3];
}

class Polymerase {
  id = 'polymerase';
  role = 'RNA polymerase II';
  title = 'Transcribe';
  blurb = 'Unzip the DNA of the GFP gene and copy it into messenger RNA, letter by letter — then send it off to a ribosome.';
  art = 'dna';
  private ctx!: GameCtx;
  private emit!: Emit;
  private O = vec3.create();
  private D: Vec3 = [1, 0, 0];
  private E: Vec3 = [0, 1, 0];
  private S: Vec3 = [0, 0, 1];
  private yaw = 0;
  private qPol = quat.create();
  private posPol = vec3.create();
  private phase: Phase = 'intro';
  private t = 0;
  private time = 0;
  /** nucleotides made, and where the DNA stands (animated toward n) */
  private n = 0;
  private pos = 0;
  private autoN = 0;
  private wrongBase = '';
  private tries = 0;
  private wrong = 0;
  private startTime = 0;
  private interactiveTime = 0;
  private releaseAt = 0;
  private ui: Record<string, HTMLElement> = {};
  private keyFn = (e: KeyboardEvent) => this.key(e);
  private perChunk = 0;

  start(ctx: GameCtx) {
    this.ctx = ctx;
    this.emit = new Emit(ctx);
    css('rg-css', PANEL_CSS);
    css('pg-css', PG_CSS);
    this.place();
    this.reset();
    this.perChunk = ctx.field.perChunk;
    ctx.field.perChunk = Math.min(this.perChunk, 1);
    ctx.controls.driven = true;
    const v = this.view();
    ctx.controls.flyTo(v.pivot, fitScale(ctx, v.scale), { yaw: this.yaw, pitch: -0.1, speed: 0.9 });
    this.buildUi();
    addEventListener('keydown', this.keyFn);
  }
  stop() {
    removeEventListener('keydown', this.keyFn);
    if (this.perChunk) this.ctx.field.perChunk = this.perChunk;
    this.ctx.field.actorCount = 0;
  }
  private reset() {
    this.phase = 'intro'; this.t = 0; this.n = 0; this.pos = 0; this.autoN = 0; this.tries = 0; this.wrong = 0; this.releaseAt = 0;
  }

  /** a spot in the nucleoplasm, away from the open wedge; the DNA runs across the view, the RNA leaves upward */
  private place() {
    const w = this.ctx.world;
    const app = (window as unknown as { app?: { places: Map<string, { yaw: number }> } }).app;
    const ty = app?.places.get('tissue')?.yaw ?? 0.62;
    const away: Vec3 = [-Math.sin(ty), 0, -Math.cos(ty)];
    const nuc = w.organelles.find((o) => o.kind === Kind.Nucleus)!;
    let found = false;
    for (const r of [1500, 1100, 1900, 800, 2300]) for (const lift of [0, 500, -500]) {
      if (found) break;
      const p = vec3.scaleAndAdd(vec3.create(), nuc.a as Vec3, away, r);
      p[1] += lift;
      if (!clearOfWedge(p) || whereIs(p) !== 'nucleus') continue;
      vec3.copy(this.O, p);
      found = true;
    }
    if (!found) vec3.copy(this.O, nuc.a as Vec3);
    this.yaw = ty + Math.PI * 0.5;
    this.D = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    this.S = [Math.sin(this.yaw), 0, Math.cos(this.yaw)];
    // the polymerase, turned so its own DNA lies along ours (downstream to +D) and its RNA faces up (+E)
    const L = this.ctx.mols.types[MOL.polymerase].levels[0];
    const dna = beadsWhere(L.info, (_g, k) => k === 2), rna = beadsWhere(L.info, (_g, k) => k === 1);
    const b = L.beads;
    const at = (i: number): Vec3 => [b[i * 4], b[i * 4 + 1], b[i * 4 + 2]];
    let Dn = axes(b, dna)[0];
    const cD: Vec3 = [0, 0, 0];
    for (const i of dna) vec3.add(cD, cD, at(i));
    vec3.scale(cD, cD, 1 / Math.max(1, dna.length));
    const r5 = at(rna[0]), r3 = at(rna[rna.length - 1]);
    // the RNA's 5′ end is upstream: point the axis downstream
    if (vec3.dot(vec3.subtract(_p_a, r5, r3), Dn) > 0) Dn = vec3.scale(vec3.create(), Dn, -1);
    const active = vec3.scaleAndAdd(vec3.create(), cD, Dn, vec3.dot(vec3.subtract(_p_a, r3, cD), Dn));
    const cR: Vec3 = [0, 0, 0];
    for (const i of rna) vec3.add(cR, cR, at(i));
    vec3.scale(cR, cR, 1 / Math.max(1, rna.length));
    const Rn = vec3.subtract(vec3.create(), cR, active);
    vec3.scaleAndAdd(Rn, Rn, Dn, -vec3.dot(Rn, Dn));
    quat.copy(this.qPol, alignQuat(Rn, Dn, this.E, this.D));
    vec3.subtract(this.posPol, this.O, vec3.transformQuat(_p_a, active, this.qPol));
    // The bubble is inside the enzyme's cleft, hidden from every side. For a game you can read, the enzyme sits back
    // behind the DNA: far enough that its beads near the axis clear the bubble's front.
    let reach = 0;
    for (let i = 0; i < b.length / 4; i++) {
      vec3.transformQuat(_p_a, at(i), this.qPol);
      vec3.add(_p_a, _p_a, this.posPol);
      vec3.subtract(_p_a, _p_a, this.O);
      const along = vec3.dot(_p_a, this.D);
      const lateral = Math.hypot(vec3.dot(_p_a, this.E), vec3.dot(_p_a, this.S));
      if (Math.abs(along) < 4 && lateral < 9 && vec3.dot(_p_a, this.E) < 3) reach = Math.max(reach, vec3.dot(_p_a, this.S) + b[i * 4 + 3]);
    }
    vec3.scaleAndAdd(this.posPol, this.posPol, this.S, -(reach - 0.6));
  }
  private view() {
    const pivot = vec3.scaleAndAdd(vec3.create(), this.O, this.E, 2.5);
    vec3.scaleAndAdd(pivot, pivot, this.D, -2);
    return { pivot, scale: 23 };
  }

  // ---------------------------------------------------------------- input
  private key(e: KeyboardEvent) {
    const k = e.key.toUpperCase();
    if (k === 'A' || k === 'U' || k === 'G' || k === 'C') this.press(k);
    else if (k === 'T') this.press('U');
    else if ((k === 'ENTER' || k === ' ') && this.phase === 'intro') this.begin();
  }
  private begin() {
    if (this.phase !== 'intro') return;
    this.ui.intro?.remove();
    this.phase = 'read';
    this.t = 0;
    this.startTime = this.time;
    this.ctx.sound('click');
    this.say('Read the template base at your active site and bring its partner.');
  }
  /** the RNA base the template wants here */
  private want(i: number) { return TO_RNA[codingBase(i)]; }
  private press(b: string) {
    if (this.phase === 'intro') this.begin();
    if (this.phase !== 'read') return;
    this.tries++;
    this.t = 0;
    if (b === this.want(this.n)) {
      this.phase = 'fly';
      this.wrongBase = '';
      this.ctx.sound('good');
      const tb = DNA_PAIR[codingBase(this.n)];
      // (the leader ends where the gene's start codon begins)
      const start = this.n === LEADER.length + 2 ? ` That's ${[...'AUG'].map(colored).join('')} — the start codon a ribosome will look for.` : '';
      this.say(`${colored(tb)} pairs with ${colored(b)}.${start}`);
      this.flash(b, true);
    } else {
      this.phase = 'wrong';
      this.wrong++;
      this.wrongBase = b;
      this.ctx.sound('bad');
      const tb = DNA_PAIR[codingBase(this.n)];
      this.say(`${colored(b)} can't pair with ${colored(tb)} — the polymerase stalls, backs up and cuts it out.`);
      this.flash(b, false);
    }
  }

  // ---------------------------------------------------------------- per frame
  update(dt: number) {
    this.time += dt;
    this.t += dt;
    const ph = this.phase;
    if (ph === 'fly' && this.t > 0.22) { this.n++; this.phase = 'step'; this.t = 0; }
    else if (ph === 'step') {
      this.pos = Math.min(this.n, this.pos + dt / 0.26);
      if (this.pos >= this.n) {
        if (this.n >= INTERACTIVE) { this.phase = 'auto'; this.autoN = this.n; this.interactiveTime = this.time - this.startTime; this.t = 0; this.autoUi(); }
        else { this.phase = 'read'; }
      }
    } else if (ph === 'wrong') {
      // backtrack a base and a half, then return
      const k = Math.min(1, this.t / 1.1);
      this.pos = this.n - Math.sin(k * Math.PI) * 1.5;
      if (k >= 1) { this.pos = this.n; this.phase = 'read'; this.wrongBase = ''; }
    } else if (ph === 'auto') {
      // Pol II copies ~30–60 bases a second; here it runs up to ~70
      this.autoN += dt * Math.min(70, 4 + this.t * 14);
      this.n = Math.min(GENE.length, Math.floor(this.autoN));
      this.pos += (this.n - this.pos) * (1 - Math.exp(-dt * 14));
      if (this.n >= GENE.length && this.n - this.pos < 0.05) {
        this.phase = 'release';
        this.t = 0;
        this.releaseAt = this.n;
        this.ctx.sound('pop');
        this.say(`Past the poly(A) signal ${[...'AAUAAA'].map(colored).join('')} the RNA is cut free.`);
      }
    } else if (ph === 'release' && this.t > 3.2) this.summary();

    this.draw();
    this.camera(dt);
    this.updateUi();
  }

  /** the frame of base pair i (t = i − pos from the active site): its centre, and its x / z axes (y = D) */
  private bpFrame(t: number, c: Vec3, x: Vec3, z: Vec3) {
    vec3.scaleAndAdd(c, this.O, this.D, t * RISE);
    // the helix stays put while the DNA screws through: the angle goes with t
    const th = t * TWIST + 0.6;
    vec3.scaleAndAdd(x, vec3.scale(x, this.E, Math.cos(th)), this.S, Math.sin(th));
    vec3.cross(z, x, this.D);
  }
  /** local (x, z) in a base pair's frame → world */
  private local(c: Vec3, x: Vec3, z: Vec3, lx: number, lz: number, out: Vec3) {
    vec3.scaleAndAdd(out, c, x, lx);
    return vec3.scaleAndAdd(out, out, z, lz);
  }

  private draw() {
    const E = this.emit;
    E.begin();
    E.mol(MOL.polymerase, this.posPol, this.qPol, 1);
    const pa = [Math.cos(-HALF) * R_BB, Math.sin(-HALF) * R_BB];      // coding strand's backbone (x, z)
    const pb = [Math.cos(HALF) * R_BB, Math.sin(HALF) * R_BB];        // template's
    const ba = [pa[0] * 0.42, pa[1] * 0.42 + 0.12], bb = [pb[0] * 0.42, pb[1] * 0.42 + 0.12];
    const bubble = (t: number) => {
      const s = (a: number, b: number, x: number) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
      return s(-12.5, -9.5, t) * (1 - s(1, 3, t));
    };
    const lo = Math.floor(this.pos) - 46, hi = Math.floor(this.pos) + 46;
    const codingBB = tint('#5b7cff'), templBB = tint('#c9d6ff'), rnaBB = tint('#ff5d8f');
    for (let i = lo; i <= hi; i++) {
      const t = i - this.pos;
      const cb = codingBase(i);
      this.bpFrame(t, _p_c, _p_x, _p_z);
      const b = bubble(t);
      // fade the duplex's far ends into the haze
      const edge = Math.min(1, (46 - Math.abs(t)) / 8);
      if (b < 0.02) {
        quat.copy(_p_q, alignQuatCache(this.D, _p_x));
        E.mol(MOL.dnabp, _p_c, _p_q, edge, PAIR_CODE[cb]);
        continue;
      }
      // the parted strands: the coding strand swings out of the way, back and up; the template stays to be read
      // (the coding strand arcs up and over the bubble)
      const arc = b * (3.4 + Math.cos(((t + 4) / 7) * Math.PI) * 0.8);
      this.local(_p_c, _p_x, _p_z, pa[0], pa[1], _p_a);
      vec3.scaleAndAdd(_p_a, _p_a, this.E, arc);
      vec3.scaleAndAdd(_p_a, _p_a, this.S, -1.1 * b);
      E.ball(_p_a, 0.34, codingBB);
      this.local(_p_c, _p_x, _p_z, ba[0], ba[1], _p_b);
      vec3.scaleAndAdd(_p_b, _p_b, this.E, arc - 0.5 * b);
      vec3.scaleAndAdd(_p_b, _p_b, this.S, -1.1 * b);
      E.ball(_p_b, 0.32, tint(BASE_3D[cb]));
      const tb = DNA_PAIR[cb];
      const read = this.phase === 'read' && Math.abs(t) < 0.5;
      const pulse = read ? 1.3 + 0.25 * Math.sin(this.time * 7) : 1;
      // (the template turns its bases toward you)
      this.local(_p_c, _p_x, _p_z, pb[0], pb[1], _p_a);
      vec3.scaleAndAdd(_p_a, _p_a, this.E, -0.7 * b);
      vec3.scaleAndAdd(_p_a, _p_a, this.S, 0.6 * b);
      E.ball(_p_a, 0.34, templBB);
      this.local(_p_c, _p_x, _p_z, bb[0], bb[1], _p_b);
      vec3.scaleAndAdd(_p_b, _p_b, this.E, -0.5 * b);
      vec3.scaleAndAdd(_p_b, _p_b, this.S, 1.0 * b);
      E.ball(_p_b, 0.34 * pulse, tint(BASE_3D[tb]));
      if (read) {
        // a sparkle round the base being read
        for (let k = 0; k < 6; k++) {
          const a = this.time * 2.2 + (k / 6) * Math.PI * 2;
          vec3.scaleAndAdd(_p_a, _p_b, this.D, Math.cos(a) * 0.9);
          vec3.scaleAndAdd(_p_a, _p_a, this.E, Math.sin(a) * 0.9);
          E.ball(_p_a, 0.09, tint('#fff4e6'));
        }
      }
    }
    // the RNA: paired to the template in the hybrid, then peeling off up the exit channel
    const first = Math.max(0, this.n - 90);
    for (let j = first; j < this.n; j++) {
      const t = j - this.pos;
      const rb = this.want(j);
      if (t > -HYBRID) {
        // in the hybrid: where the coding strand was
        this.bpFrame(t, _p_c, _p_x, _p_z);
        const b = bubble(t);
        this.local(_p_c, _p_x, _p_z, pa[0], pa[1], _p_a);
        this.local(_p_c, _p_x, _p_z, ba[0], ba[1], _p_b);
        // (paired with the template, which has turned toward you)
        vec3.scaleAndAdd(_p_a, _p_a, this.S, 1.1 * b);
        vec3.scaleAndAdd(_p_b, _p_b, this.S, 1.1 * b);
      } else {
        // out of the exit channel: up and back along a loose curve, 0.6 nm a base
        const u = -HYBRID - t;
        this.bpFrame(-HYBRID, _p_c, _p_x, _p_z);
        this.local(_p_c, _p_x, _p_z, pa[0], pa[1], _p_a);
        const wig = Math.sin(u * 0.35) * Math.min(1, u / 6) * 1.6;
        vec3.scaleAndAdd(_p_a, _p_a, this.S, 1.1);
        vec3.scaleAndAdd(_p_a, _p_a, this.E, u * 0.42);
        vec3.scaleAndAdd(_p_a, _p_a, this.D, -u * 0.25 + wig);
        vec3.scaleAndAdd(_p_a, _p_a, this.S, u * 0.1);
        if (this.phase === 'release' || this.phase === 'done') vec3.scaleAndAdd(_p_a, _p_a, this.E, Math.min(this.t, 3) * 6);
        vec3.scaleAndAdd(_p_b, _p_a, this.S, 0.5);
      }
      const fade = Math.min(1, (j - first) / 12);
      E.ball(_p_a, 0.34 * fade, rnaBB);
      E.ball(_p_b, 0.3 * fade, tint(BASE_3D[rb]));
    }
    // a nucleotide on its way in from the entry channel (or the wrong one, about to be cut out)
    if (this.phase === 'fly' || this.phase === 'wrong') {
      const b = this.phase === 'fly' ? this.want(this.n) : this.wrongBase;
      const k = this.phase === 'fly' ? Math.min(1, this.t / 0.22) : Math.min(1, this.t / 0.2);
      const out = this.phase === 'wrong' && this.t > 0.6 ? (this.t - 0.6) * 12 : 0;
      this.bpFrame(this.n - this.pos, _p_c, _p_x, _p_z);
      this.local(_p_c, _p_x, _p_z, ba[0], ba[1], _p_b);
      vec3.scaleAndAdd(_p_a, this.O, this.E, -7);
      vec3.scaleAndAdd(_p_a, _p_a, this.S, 2.5);
      vec3.scaleAndAdd(_p_a, _p_a, this.D, 2);
      const e = k * k * (3 - 2 * k);
      vec3.lerp(_p_a, _p_a, _p_b, e);
      vec3.scaleAndAdd(_p_a, _p_a, this.S, out);
      vec3.scaleAndAdd(_p_a, _p_a, this.E, -out * 0.5);
      const wobble = this.phase === 'wrong' ? 1 + 0.3 * Math.sin(this.time * 30) : 1;
      E.ball(_p_a, 0.42 * wobble, tint(BASE_3D[b]));
      vec3.scaleAndAdd(_p_a, _p_a, this.S, 0.55);
      E.ball(_p_a, 0.34, rnaBB);
    }
  }

  private camera(dt: number) {
    const v = this.view();
    let scale = v.scale, pitch = -0.1;
    const pivot = v.pivot;
    if (this.phase === 'auto') { scale = 52; pitch = -0.15; }
    if (this.phase === 'release' || this.phase === 'done') { scale = 70; vec3.scaleAndAdd(pivot, pivot, this.E, 10 + Math.min(this.t, 3) * 3); pitch = -0.05; }
    steerCamera(this.ctx, pivot, scale, this.yaw + Math.sin(this.time * 0.15) * 0.14, pitch, dt, 2.2);
  }

  // ---------------------------------------------------------------- interface
  private buildUi() {
    const P = this.ctx.panel;
    const btn = (b: string) => `<button class="pg-base rg-glass" data-b="${b}" style="--c:${BASE_UI[b]}"><span>${b}</span><small>key ${b}</small></button>`;
    P.innerHTML = `
      <div class="rg-top"><div class="rg-role">You are RNA polymerase II</div><div class="rg-title">Transcribe</div>
        <div class="rg-goal">Copy the GFP gene into messenger RNA: give each template base its partner.</div></div>
      <div class="rg-stats"><div class="rg-stat">nucleotides<b data-k="n">0</b></div><div class="rg-stat">accuracy<b data-k="acc">—</b></div><div class="rg-stat">speed<b data-k="rate">—</b></div></div>
      <button class="rg-x" title="Leave (Esc)">×</button>
      <div class="rg-bottom">
        <div class="rg-msg"></div>
        <div class="pg-zip rg-glass"><div class="pg-row pg-rna"></div><div class="pg-row pg-tpl"></div></div>
        <div class="pg-bases">${['A', 'U', 'G', 'C'].map(btn).join('')}</div>
      </div>
      <div class="rg-intro rg-glass"><div class="rg-role">You are RNA polymerase II</div><h2>Transcribe</h2>
        <p>You're clamped onto the DNA of a gene. You've just pried its two strands apart; one of them — the template — runs through your active site.</p>
        <p>Read each template base and bring the RNA letter that pairs with it: <b style="color:${BASE_UI.A}">A</b>→<b style="color:${BASE_UI.U}">U</b>, <b style="color:${BASE_UI.T}">T</b>→<b style="color:${BASE_UI.A}">A</b>, <b style="color:${BASE_UI.G}">G</b>→<b style="color:${BASE_UI.C}">C</b>, <b style="color:${BASE_UI.C}">C</b>→<b style="color:${BASE_UI.G}">G</b>. Press A, U, G or C (or tap).</p>
        <div class="rg-acts"><button class="btn btn-play rg-go">Start copying</button></div></div>`;
    const q = (s: string) => P.querySelector(s) as HTMLElement;
    this.ui = { msg: q('.rg-msg'), rna: q('.pg-rna'), tpl: q('.pg-tpl'), bases: q('.pg-bases'), zip: q('.pg-zip'), intro: q('.rg-intro'),
      n: q('[data-k=n]'), acc: q('[data-k=acc]'), rate: q('[data-k=rate]'), bottom: q('.rg-bottom') };
    q('.rg-x').addEventListener('click', () => this.ctx.exit());
    q('.rg-go').addEventListener('click', () => this.begin());
    for (const b of P.querySelectorAll<HTMLButtonElement>('.pg-base')) b.addEventListener('click', () => this.press(b.dataset.b!));
  }
  private flash(b: string, good: boolean) {
    const el = this.ui.bases.querySelector(`[data-b="${b}"]`) as HTMLElement | null;
    if (!el) return;
    el.classList.remove('good', 'bad');
    void el.offsetWidth;
    el.classList.add(good ? 'good' : 'bad');
    setTimeout(() => el.classList.remove('good', 'bad'), 420);
  }
  private autoUi() {
    this.ui.bases.style.display = 'block';
    this.ui.bases.innerHTML = `<div class="rg-glass" style="padding:12px 18px;text-align:center;width:100%">
      <div style="font:13px var(--sans);color:var(--dim)">Got it. Copying the rest of the gene — ${GENE.length - INTERACTIVE} more bases. Pol II does 30–60 a second; this is close to real time.</div>
      <div class="rg-bar" style="margin:10px auto 0"><i></i></div></div>`;
    this.ui.bar = this.ui.bases.querySelector('.rg-bar i') as HTMLElement;
    this.say('');
  }
  private say(html: string) { if (this.ui.msg) this.ui.msg.innerHTML = html; }

  private updateUi() {
    const u = this.ui;
    if (!u.n) return;
    u.n.textContent = `${this.n} / ${GENE.length}`;
    u.acc.textContent = this.tries ? `${Math.round(((this.tries - this.wrong) / this.tries) * 100)}%` : '—';
    const el = this.time - this.startTime;
    u.rate.textContent = this.phase !== 'intro' && el > 0.3 ? `${(this.n / el).toFixed(1)} nt/s` : '—';
    // the zipper: the RNA made so far over the template it was read from, the base to read in the middle
    const n = this.n;
    let rna = '<i>5′</i>', tpl = '<i>3′</i>';
    for (let i = n - 8; i <= n + 6; i++) {
      const cur = i === n && this.phase !== 'release' && this.phase !== 'done';
      const tb = DNA_PAIR[codingBase(i)];
      tpl += `<span class="${cur ? 'cur' : ''}">${colored(tb)}</span>`;
      rna += `<span class="${cur ? 'cur' : ''}">${i < n && i >= 0 ? colored(this.want(i)) : cur ? '<b class="pg-q">?</b>' : '<b style="opacity:0">·</b>'}</span>`;
    }
    rna += '<i>3′</i>'; tpl += '<i>5′</i>';
    const key = rna + tpl;
    if (u.zip.dataset.k !== key) { u.rna.innerHTML = rna; u.tpl.innerHTML = tpl; u.zip.dataset.k = key; }
    if (u.bar) u.bar.style.width = `${(n / GENE.length) * 100}%`;
  }

  private summary() {
    this.phase = 'done';
    this.ctx.sound('win');
    const acc = this.tries ? Math.round(((this.tries - this.wrong) / this.tries) * 100) : 100;
    const rate = INTERACTIVE / Math.max(0.1, this.interactiveTime);
    const box = document.createElement('div');
    box.className = 'rg-sum rg-glass';
    box.innerHTML = `<div class="rg-role">Gene copied</div><h2>A messenger RNA for GFP</h2>
      <div class="nums"><div>nucleotides<b>${GENE.length}</b></div><div>your accuracy<b>${acc}%</b></div><div>your speed<b>${rate.toFixed(1)}/s</b></div></div>
      <p>RNA polymerase II copies <b>30–60 bases a second</b> and gets about <b>one in 100,000</b> wrong — it backs up and snips out mismatches like the ones you made. The longest human gene, dystrophin (2.2 million bases), takes it about 16 hours.</p>
      <p>Before your RNA can leave, it gets a <b>5′ cap</b> (a reversed G), a <b>poly(A) tail</b> of ~200 As, and — in a human gene, though not in this jellyfish one — its introns spliced out. Then it's escorted out through a <b>nuclear pore</b> to the ribosomes.</p>
      <p style="color:var(--faint);font-size:12px">Simplified: no transcription factors or Mediator, a short leader instead of the gene's own start site, and the RNA–DNA geometry idealised.</p>
      <div class="rg-acts"><button class="btn btn-play pg-next">Now translate it →</button><button class="btn pg-again">Play again</button><button class="btn rg-back">Back to the cell</button></div>`;
    this.ctx.panel.append(box);
    this.ui.bottom.style.opacity = '0';
    box.querySelector('.pg-next')!.addEventListener('click', () => {
      this.ctx.exit();
      (window as unknown as { app: { startGame(id: string): void } }).app.startGame('ribosome');
    });
    box.querySelector('.pg-again')!.addEventListener('click', () => {
      box.remove();
      this.ui.bottom.style.opacity = '1';
      this.ui.bar = undefined as unknown as HTMLElement;
      this.buildUi();
      this.reset();
      this.begin();
    });
    box.querySelector('.rg-back')!.addEventListener('click', () => this.ctx.exit());
  }
}

// one rotation per base pair: local Y along the DNA, local X the base pair's own turn (cached: the same few angles recur)
const _p_qa = quat.create();
function alignQuatCache(D: Vec3, x: Vec3): Quat {
  // (frame from axes directly: X = x, Y = D)
  const X = vec3.normalize(_p_x2, vec3.scaleAndAdd(_p_x2, x, D, -vec3.dot(x, D)));
  const Z = vec3.cross(_p_z2, X, D);
  const m: [number, number, number, number, number, number, number, number, number] = [X[0], X[1], X[2], D[0], D[1], D[2], Z[0], Z[1], Z[2]];
  return quat.normalize(_p_qa, quat.fromMat3(_p_qa, m));
}
const _p_x2 = vec3.create(), _p_z2 = vec3.create();

const PG_CSS = `
.pg-zip { padding: 8px 16px; display: flex; flex-direction: column; gap: 2px; font: 600 22px/1.15 var(--mono); }
.pg-row { display: flex; gap: 4px; align-items: center; justify-content: center; }
.pg-row i { font: 500 11px var(--mono); color: var(--faint); font-style: normal; width: 22px; text-align: center; }
.pg-row span { width: 22px; text-align: center; opacity: 0.55; transition: transform 0.2s, opacity 0.2s; }
.pg-row span.cur { opacity: 1; transform: scale(1.6); margin: 0 9px; }
.pg-tpl span.cur { text-shadow: 0 0 14px currentColor; }
.pg-q { color: #fff; animation: pg-blink 0.9s infinite; }
.pg-bases { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; width: min(620px, 100%); }
.pg-base { cursor: pointer; padding: 10px 0 8px; color: var(--c); display: flex; flex-direction: column; align-items: center; gap: 2px; transition: transform 0.12s, border-color 0.2s, background 0.2s; }
.pg-base span { font: 600 38px/1 var(--mono); text-shadow: 0 0 18px color-mix(in srgb, var(--c) 50%, transparent); }
.pg-base small { font: 10px var(--mono); color: var(--faint); }
.pg-base:hover { transform: translateY(-3px); border-color: var(--c); }
.pg-base:active { transform: scale(0.96); }
.pg-base.good { border-color: #7dff7a; background: rgba(60, 120, 60, 0.35); }
.pg-base.bad { animation: rg-shake 0.4s; border-color: #ff5a5a; }
@keyframes pg-blink { 50% { opacity: 0.25; } }
@media (max-width: 760px) { .pg-zip { font-size: 16px; } .pg-row span { width: 15px; } .pg-row span.cur { margin: 0 6px; } .pg-base span { font-size: 30px; } }
`;

registerGame(new Polymerase());
