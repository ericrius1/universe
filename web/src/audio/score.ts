// The cell's sound: a generative score in pure Web Audio — no samples. Two pads of detuned voices (a low one that
// belongs to the view from outside, a high one to the inside) breathe through slow filters; their chord follows the
// compartment (the nucleus darker, a mitochondrion warmer and pulsing) and their register, brightness and texture
// follow the zoom: wide, low and slow over the tissue, a breathing pad among the organelles, and at the molecular
// scale a fine shimmer of sine grains and the soft crackle of Brownian motion, denser the closer you go. Glassy FM
// bells ring now and then; crossing a power of ten rings a low one. Everything runs through one bus: a generated
// reverb (a convolver over a seeded noise tail), a high-pass, a gentle compressor.
//
// One engine drives both the live score (an AudioContext, stepped from the app's frames) and the film's soundtrack
// (an OfflineAudioContext stepped through a cue list): the same control steps and a seeded random stream, so a film
// renders the same every time.

type Ctx = BaseAudioContext;

/** control rate: parameters and random events are decided this often (s) */
const CONTROL = 0.05;
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// chords per compartment (MIDI, low register; the high pad plays them an octave or two up). Voice i always takes
// tone i, so a change of place is five voices gliding to their nearest new note.
const CHORDS: Record<string, number[]> = {
  outside: [38, 45, 52, 57, 64],   // D A E A E — open, suspended, wide
  cytosol: [38, 45, 54, 57, 64],   // D add9 — warm
  nucleus: [38, 45, 53, 60, 64],   // D minor 9 — darker
  mito: [41, 48, 57, 60, 67],      // F add9 — warmer, brighter
  er: [34, 41, 50, 57, 64],        // B♭ maj7♯11 — dreamy
  golgi: [43, 50, 57, 59, 66],     // G maj9
};
const chordOf = (c: string) => CHORDS[c] ?? CHORDS.cytosol;

interface Voice { o1: OscillatorNode; o2: OscillatorNode; drift: OscillatorNode; g: GainNode }
interface Pad { voices: Voice[]; filter: BiquadFilterNode; gain: GainNode; lfo: OscillatorNode; lfoDepth: GainNode; octave: number }

class Engine {
  readonly rnd: () => number;
  readonly master: GainNode;
  private bus: GainNode;
  private wet: GainNode;
  private noise: AudioBuffer;
  private low: Pad;
  private high: Pad;
  private sub: OscillatorNode;
  private subGain: GainNode;
  private breath: OscillatorNode;
  private breathDepth: GainNode;
  private pulse: OscillatorNode;
  private pulseDepth: GainNode;
  private pulseGain: GainNode;
  private air: AudioBufferSourceNode;
  private airFilter: BiquadFilterNode;
  private airGain: GainNode;
  private crackle: { src: AudioBufferSourceNode; gain: GainNode }[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private last = new Map<AudioParam, number>();
  private comp = '';
  private lz = 4;
  private decade = NaN;
  private tickCooldown = 0;
  /** ring a low bell at each power of ten crossed */
  autoTicks = true;

  constructor(readonly ctx: Ctx, seed: number) {
    this.rnd = mulberry32(seed);
    const c = ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.55;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.012; comp.release.value = 0.45;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 28; hp.Q.value = 0.6;
    this.bus = c.createGain();
    this.wet = c.createGain();
    const verb = c.createConvolver();
    verb.buffer = this.impulse(4.6);
    const verbOut = c.createGain();
    verbOut.gain.value = 0.42;
    this.bus.connect(hp);
    this.wet.connect(verb).connect(verbOut).connect(hp);
    hp.connect(comp).connect(this.master).connect(c.destination);

    this.noise = this.noiseBuffer(2);
    this.low = this.pad(-0, 'sawtooth', 0.18);
    this.high = this.pad(12, 'triangle', 0.32);
    this.low.gain.connect(this.bus); this.low.gain.connect(this.send(0.55));
    this.pulseGain = c.createGain();
    this.high.gain.connect(this.pulseGain);
    this.pulseGain.connect(this.bus); this.pulseGain.connect(this.send(0.7));

    this.sub = c.createOscillator();
    this.sub.type = 'sine';
    this.subGain = c.createGain();
    this.subGain.gain.value = 0;
    this.sub.connect(this.subGain).connect(this.bus);

    // breathing: a slow swell on both pads' level
    this.breath = c.createOscillator();
    this.breath.frequency.value = 0.072;
    this.breathDepth = c.createGain();
    this.breathDepth.gain.value = 0.05;
    this.breath.connect(this.breathDepth);
    this.breathDepth.connect(this.low.gain.gain);
    this.breathDepth.connect(this.high.gain.gain);
    // a mitochondrion's pulse: tremolo on the high pad
    this.pulse = c.createOscillator();
    this.pulse.frequency.value = 1.45;
    this.pulseDepth = c.createGain();
    this.pulseDepth.gain.value = 0;
    this.pulse.connect(this.pulseDepth).connect(this.pulseGain.gain);

    // the extracellular sea: soft filtered noise, mostly from outside
    this.air = c.createBufferSource();
    this.air.buffer = this.noise; this.air.loop = true;
    this.airFilter = c.createBiquadFilter();
    this.airFilter.type = 'bandpass'; this.airFilter.frequency.value = 420; this.airFilter.Q.value = 0.5;
    this.airGain = c.createGain();
    this.airGain.gain.value = 0;
    this.air.connect(this.airFilter).connect(this.airGain);
    this.airGain.connect(this.bus); this.airGain.connect(this.send(0.8));

    // Brownian crackle: two loops of sparse clicks (a few a second, and dozens), faded in near the molecules
    for (const [len, rate] of [[5.3, 7], [3.7, 70]]) {
      const src = c.createBufferSource();
      src.buffer = this.crackleBuffer(len, rate);
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = 900; f.Q.value = 0.4;
      const g = c.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g);
      g.connect(this.bus); g.connect(this.send(0.35));
      this.crackle.push({ src, gain: g });
    }
    this.sources.push(this.sub, this.breath, this.pulse, this.air, ...this.crackle.map((x) => x.src));
  }

  private send(amount: number) {
    const g = this.ctx.createGain();
    g.gain.value = amount;
    g.connect(this.wet);
    return g;
  }

  private pad(octave: number, type: OscillatorType, level: number): Pad {
    const c = this.ctx;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass'; filter.Q.value = 0.55; filter.frequency.value = 600;
    const gain = c.createGain();
    gain.gain.value = 0;
    filter.connect(gain);
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.045 + this.rnd() * 0.03;
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 180;
    lfo.connect(lfoDepth).connect(filter.frequency);
    const voices: Voice[] = [];
    for (let i = 0; i < 5; i++) {
      const o1 = c.createOscillator(), o2 = c.createOscillator();
      o1.type = type; o2.type = 'triangle';
      o1.detune.value = -7 + this.rnd() * 3; o2.detune.value = 5 + this.rnd() * 3;
      const a = c.createGain(), b = c.createGain(), g = c.createGain();
      a.gain.value = type === 'sawtooth' ? 0.22 : 0.4; b.gain.value = 0.5; g.gain.value = level / 5;
      // each voice wanders a few cents on its own, slowly: the chorus of living things
      const drift = c.createOscillator();
      drift.frequency.value = 0.04 + this.rnd() * 0.11;
      const dd = c.createGain();
      dd.gain.value = 3 + this.rnd() * 4;
      drift.connect(dd); dd.connect(o1.detune); dd.connect(o2.detune);
      o1.connect(a).connect(g); o2.connect(b).connect(g);
      g.connect(filter);
      voices.push({ o1, o2, drift, g });
      this.sources.push(o1, o2, drift);
    }
    this.sources.push(lfo);
    return { voices, filter, gain, lfo, lfoDepth, octave };
  }

  private impulse(seconds: number): AudioBuffer {
    const sr = this.ctx.sampleRate, n = Math.floor(seconds * sr);
    const b = this.ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        // decaying noise that darkens as it goes (a one-pole low-pass closing over time); a short pre-delay
        const k = 0.55 * Math.exp(-t * 1.6) + 0.04;
        lp += (this.rnd() * 2 - 1 - lp) * k;
        d[i] = t < 0.012 ? 0 : lp * Math.exp(-t * 1.55) * 0.9;
      }
    }
    return b;
  }

  private noiseBuffer(seconds: number): AudioBuffer {
    const sr = this.ctx.sampleRate, n = Math.floor(seconds * sr);
    const b = this.ctx.createBuffer(1, n, sr);
    const d = b.getChannelData(0);
    // gently pink: a sum of two one-pole filtered whites
    let a = 0, c = 0;
    for (let i = 0; i < n; i++) {
      const w = this.rnd() * 2 - 1;
      a = 0.97 * a + 0.03 * w; c = 0.6 * c + 0.4 * w;
      d[i] = (a * 3 + c * 0.6) * 0.5;
    }
    return b;
  }

  private crackleBuffer(seconds: number, rate: number): AudioBuffer {
    const sr = this.ctx.sampleRate, n = Math.floor(seconds * sr);
    const b = this.ctx.createBuffer(2, n, sr);
    const L = b.getChannelData(0), R = b.getChannelData(1);
    let t = 0;
    for (;;) {
      t += -Math.log(1 - this.rnd()) / rate;
      const i0 = Math.floor(t * sr);
      if (i0 >= n) break;
      const amp = (0.15 + 0.85 * this.rnd() ** 2) * (this.rnd() < 0.5 ? -1 : 1);
      const len = Math.floor(sr * (0.0006 + this.rnd() * 0.0025));
      const pan = this.rnd();
      for (let k = 0; k < len && i0 + k < n; k++) {
        const v = amp * Math.exp(-k / (len * 0.3)) * (this.rnd() * 2 - 1);
        L[i0 + k] += v * (1 - pan); R[i0 + k] += v * pan;
      }
    }
    return b;
  }

  /** start every running source at time t, primed to a place */
  start(t: number, scale: number, compartment: string) {
    this.lz = Math.log10(Math.max(1, scale));
    this.comp = '';
    this.setChord(compartment, t, true);
    this.control(t, 0, scale, compartment, true);
    for (const s of this.sources) s.start(t);
  }

  /** a parameter toward a value (skipped when it hasn't moved, so live play doesn't pile up automation) */
  private to(p: AudioParam, v: number, t: number, tau: number, prime = false) {
    if (prime) { p.setValueAtTime(v, t); this.last.set(p, v); return; }
    const was = this.last.get(p);
    if (was !== undefined && Math.abs(was - v) <= Math.abs(was) * 0.004 + 1e-5) return;
    this.last.set(p, v);
    p.setTargetAtTime(v, t, tau);
  }

  private setChord(compartment: string, t: number, prime = false) {
    if (compartment === this.comp) return;
    this.comp = compartment;
    const ch = chordOf(compartment);
    const glide = (pad: Pad, i: number, m: number) => {
      const v = pad.voices[i], f = mtof(m + pad.octave + (pad.octave && i >= 3 ? 12 : 0));
      // (staggered: the chord blooms voice by voice)
      const at = t + (prime ? 0 : i * 0.18 + (pad.octave ? 0.4 : 0));
      if (prime) { v.o1.frequency.setValueAtTime(f, t); v.o2.frequency.setValueAtTime(f * 1.001, t); }
      else { v.o1.frequency.setTargetAtTime(f, at, 1.1); v.o2.frequency.setTargetAtTime(f * 1.001, at, 1.1); }
    };
    ch.forEach((m, i) => { glide(this.low, i, m); glide(this.high, i, m); });
    const root = mtof(ch[0] - 12);
    if (prime) this.sub.frequency.setValueAtTime(root, t); else this.sub.frequency.setTargetAtTime(root, t, 1.5);
    this.to(this.pulseDepth.gain, compartment === 'mito' ? 0.22 : 0, t, 0.8, prime);
    this.to(this.breathDepth.gain, compartment === 'outside' ? 0.04 : 0.16, t, 1.2, prime);
  }

  /** one control step at time t: parameters follow the zoom and the place; random events are drawn for [t, t+dt) */
  control(t: number, dt: number, scale: number, compartment: string, prime = false) {
    const raw = Math.log10(Math.max(1, scale));
    this.lz = prime ? raw : this.lz + (raw - this.lz) * (1 - Math.exp(-dt * 2.5));
    const lz = this.lz;
    const far = smooth(3.6, 4.6, lz);                       // the tissue, the whole cell
    const near = 1 - smooth(1.4, 2.7, lz);                  // macromolecules and closer
    const mid = clamp01(1 - far - near);
    this.setChord(compartment, t, prime);
    const outside = compartment === 'outside';
    this.to(this.low.gain.gain, (0.34 + 0.5 * far) * (1 - 0.55 * near), t, 0.6, prime);
    this.to(this.high.gain.gain, (0.4 + 0.75 * (1 - far)) * (1 - 0.25 * near), t, 0.6, prime);
    this.to(this.low.filter.frequency, 320 + 600 * (1 - far) + 250 * near, t, 0.5, prime);
    this.to(this.high.filter.frequency, 900 + 1700 * (1 - far) + 1100 * near, t, 0.5, prime);
    this.to(this.subGain.gain, 0.025 + 0.075 * far, t, 0.8, prime);
    this.to(this.airGain.gain, (outside ? 0.05 : 0.012) * (0.4 + 0.6 * far), t, 1.0, prime);
    this.to(this.airFilter.frequency, outside ? 380 : 900, t, 1.0, prime);
    this.to(this.crackle[0].gain.gain, 0.5 * near + 0.05 * mid, t, 0.4, prime);
    this.to(this.crackle[1].gain.gain, 0.32 * near * near, t, 0.4, prime);
    if (prime || dt <= 0) { this.decade = Math.floor(raw); return; }

    // a power of ten crossed (with a little hysteresis, and not too often)
    this.tickCooldown -= dt;
    const d = Math.floor(raw);
    if (d !== this.decade && Math.abs(raw - Math.round(raw)) > 0.03) {
      if (this.autoTicks && this.tickCooldown <= 0 && !Number.isNaN(this.decade)) { this.event('zoomTick', 0.8, t); this.tickCooldown = 0.7; }
      this.decade = d;
    }
    // bells now and then; grains at the molecular scale
    const bells = 0.05 + 0.04 * far + 0.16 * mid + 0.08 * near;
    for (let n = this.poisson(bells * dt); n > 0; n--) this.bell(this.toneHigh(5, 6), 0.035 + this.rnd() * 0.035, t + this.rnd() * dt, 4 + this.rnd() * 3);
    const grains = 30 * near + 2 * mid;
    for (let n = this.poisson(grains * dt); n > 0; n--) this.grain(t + this.rnd() * dt, near);
  }

  private poisson(lambda: number) {
    const L = Math.exp(-lambda);
    let n = 0, p = this.rnd();
    while (p > L) { n++; p *= this.rnd(); }
    return n;
  }
  /** a chord tone in octaves lo..hi (MIDI) */
  private toneHigh(lo: number, hi: number) {
    const ch = chordOf(this.comp);
    const m = ch[Math.floor(this.rnd() * ch.length)] % 12;
    const oct = lo + Math.floor(this.rnd() * (hi - lo + 1));
    return 12 * (oct + 1) + m + 2;   // (+2: the chords are spelled from C; D is the home)
  }

  private panner(pan: number) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    return p;
  }
  private out(node: AudioNode, wet: number, pan = 0) {
    const p = this.panner(pan);
    node.connect(p);
    p.connect(this.bus);
    if (wet > 0) p.connect(this.send(wet));
  }

  /** a glassy FM bell: a carrier, a modulator at 3.5×, its index falling fast (bright strike, pure ring) */
  bell(midi: number, amp: number, t: number, decay: number, ratio = 3.5, pan = this.rnd() * 1.4 - 0.7) {
    const c = this.ctx, f = mtof(midi);
    const car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain();
    car.frequency.value = f; mod.frequency.value = f * ratio;
    mg.gain.setValueAtTime(f * 1.6, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.02, t + 0.9);
    mod.connect(mg).connect(car.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    car.connect(g);
    // a quieter inharmonic partial for shimmer
    const p2 = c.createOscillator(), g2 = c.createGain();
    p2.frequency.value = f * 2.76;
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(amp * 0.18, t + 0.003);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + decay * 0.35);
    p2.connect(g2);
    this.out(g, 0.9, pan);
    this.out(g2, 0.9, pan);
    for (const o of [car, mod, p2]) { o.start(t); o.stop(t + decay + 0.1); }
  }

  private grain(t: number, near: number) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.value = mtof(this.toneHigh(6, 8)) * (1 + (this.rnd() - 0.5) * 0.004);
    const len = 0.05 + this.rnd() * 0.12;
    const a = (0.016 + this.rnd() * 0.026) * (0.5 + 0.5 * near);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(a, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g);
    this.out(g, 0.6, this.rnd() * 1.8 - 0.9);
    o.start(t); o.stop(t + len + 0.02);
  }

  private noiseBurst(t: number, len: number, f: number, q: number, amp: number, wet = 0.3, f2?: number) {
    const c = this.ctx, s = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise;
    bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(f, t);
    if (f2) bp.frequency.exponentialRampToValueAtTime(f2, t + len);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + Math.min(0.01, len * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(bp).connect(g);
    this.out(g, wet, this.rnd() * 0.6 - 0.3);
    s.start(t, this.rnd() * 1.5); s.stop(t + len + 0.05);
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, glide: number, attack: number, decay: number, amp: number, wet: number, lp?: [number, number]) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + glide);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    let node: AudioNode = o;
    if (lp) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = 0.7;
      f.frequency.setValueAtTime(lp[0], t);
      f.frequency.exponentialRampToValueAtTime(lp[1], t + attack + decay * 0.5);
      o.connect(f);
      node = f;
    }
    node.connect(g);
    this.out(g, wet, this.rnd() * 0.5 - 0.25);
    o.start(t); o.stop(t + attack + decay + 0.05);
  }

  /** a harp-like pluck (triangle through a closing low-pass) */
  private pluck(t: number, midi: number, amp: number) {
    this.tone(t, 'triangle', mtof(midi), mtof(midi), 0, 0.004, 1.3, amp, 0.6, [5200, 700]);
  }

  event(name: string, strength: number, t: number) {
    const s = Math.max(0, Math.min(2, strength));
    const ch = chordOf(this.comp);
    switch (name) {
      case 'click': this.tone(t, 'sine', 1650, 1500, 0.03, 0.002, 0.05, 0.05 * s, 0.4); this.bell(ch[2] % 12 + 86, 0.012 * s, t, 1.2); break;
      case 'hover': this.tone(t, 'sine', 2640, 2640, 0, 0.003, 0.03, 0.012 * s, 0.5); break;
      case 'fly':
        this.noiseBurst(t, 1.7, 260, 1.1, 0.09 * s, 0.6, 2300);
        this.bell(ch[4] + 24, 0.03 * s, t + 0.25, 3.5);
        break;
      case 'arrive': [ch[0] + 36, ch[2] + 24, ch[4] + 24].forEach((m, i) => this.bell(m, 0.035 * s, t + i * 0.07, 3.5 + i)); break;
      case 'atp': this.bell(ch[2] % 12 + 86, 0.045 * s, t, 1.3, 3.5, 0.3); this.bell(ch[4] % 12 + 93, 0.03 * s, t + 0.06, 1.0, 3.5, -0.3); break;
      case 'step':
        this.tone(t, 'sine', 1150, 680, 0.025, 0.001, 0.045, 0.09 * s, 0.15);
        this.noiseBurst(t, 0.018, 2600, 2.5, 0.05 * s, 0.1);
        break;
      case 'good': [0, 2, 4].forEach((k, i) => this.pluck(t + i * 0.055, ch[k] + 24, 0.07 * s)); break;
      case 'bad':
        this.tone(t, 'sine', 120, 52, 0.25, 0.004, 0.32, 0.22 * s, 0.1, [500, 160]);
        this.noiseBurst(t, 0.12, 180, 0.8, 0.05 * s, 0.05);
        break;
      case 'pop': this.tone(t, 'sine', 520, 1700, 0.06, 0.002, 0.07, 0.11 * s, 0.4); break;
      case 'win':
        [0, 1, 2, 3, 4, 2, 4].forEach((k, i) => this.pluck(t + i * 0.11, ch[k] + (i < 5 ? 24 : 36), 0.065 * s));
        [ch[0] + 24, ch[2] + 24, ch[4] + 24].forEach((m, i) => this.bell(m, 0.03 * s, t + 0.8 + i * 0.05, 5));
        break;
      case 'zoomTick': {
        // a low soft bell, its pitch stepping with the decade
        const steps = [0, 2, 4, 7, 9, 12];
        const dz = Math.max(0, Math.min(5, Math.floor(this.lz)));
        this.bell(ch[0] + 24 + steps[5 - dz], 0.06 * s, t, 6.5, 1.4, 0);
        break;
      }
    }
  }

  /** the film's envelope: swell in, fade out */
  shape(seconds: number) {
    const g = this.master.gain, top = g.value;
    g.setValueAtTime(0, 0);
    g.linearRampToValueAtTime(top * 0.6, 2.0);
    g.linearRampToValueAtTime(top, 4.5);
    g.setValueAtTime(top, Math.max(4.6, seconds - 4.5));
    g.linearRampToValueAtTime(0, seconds - 0.1);
  }

  stopAll(t: number) { for (const s of this.sources) { try { s.stop(t); } catch { /* already stopped */ } } }
}

export interface FilmCue { t: number; scale: number; compartment: string; event?: string }

export class Score {
  private ctx: AudioContext | null = null;
  private engine: Engine | null = null;
  private acc = 0;
  private scale = 46000;
  private compartment = 'outside';
  private _muted = false;

  /** call from a user gesture: makes (or wakes) the audio context and starts the score */
  start() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'playback' });
      this.engine = new Engine(this.ctx, (Date.now() & 0xffff) ^ 0x5eed);
      const g = this.engine.master.gain, top = g.value;
      g.value = 0;
      this.engine.start(this.ctx.currentTime + 0.05, this.scale, this.compartment);
      g.setTargetAtTime(this._muted ? 0 : top, this.ctx.currentTime + 0.05, 1.2);
      this.top = top;
    }
    if (this.ctx.state === 'suspended' && !this._muted) void this.ctx.resume();
  }
  private top = 0.55;

  get muted() { return this._muted; }
  get started() { return !!this.ctx; }

  setMuted(m: boolean) {
    this._muted = m;
    if (!this.ctx || !this.engine) return;
    const t = this.ctx.currentTime;
    this.engine.master.gain.cancelScheduledValues(t);
    this.engine.master.gain.setTargetAtTime(m ? 0 : this.top, t, m ? 0.08 : 0.6);
    if (m) setTimeout(() => { if (this._muted) void this.ctx?.suspend(); }, 400);
    else void this.ctx.resume();
  }

  /** every frame: the camera's distance to what it looks at (nm) and the compartment it's in */
  update(dt: number, scale: number, compartment: string) {
    this.scale = scale;
    this.compartment = compartment;
    if (!this.ctx || !this.engine || this._muted || this.ctx.state !== 'running') return;
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= CONTROL) {
      this.acc -= CONTROL;
      this.engine.control(this.ctx.currentTime + 0.06, CONTROL, scale, compartment);
    }
  }

  /** a one-shot: click, hover, fly, arrive, atp, step, good, bad, pop, win, zoomTick */
  event(name: string, strength = 1) {
    if (!this.ctx || !this.engine || this._muted || this.ctx.state !== 'running') return;
    this.engine.event(name, strength, this.ctx.currentTime + 0.01);
  }

  /** ring a low bell at each power of ten the zoom crosses (on by default) */
  set autoTicks(on: boolean) { if (this.engine) this.engine.autoTicks = on; }

  /** the film's soundtrack, rendered offline from a cue list (scale interpolated log-linearly between cues; each
   *  cue's compartment holds until the next; its event rings at its time): a 48 kHz 16-bit stereo WAV */
  static async renderFilm(seconds: number, cues: FilmCue[]): Promise<Blob> {
    const sr = 48000;
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
    const e = new Engine(ctx, 1234567);
    const cs = [...cues].sort((a, b) => a.t - b.t);
    const at = (t: number) => {
      let i = 0;
      while (i < cs.length - 1 && cs[i + 1].t <= t) i++;
      const a = cs[i], b = cs[Math.min(i + 1, cs.length - 1)];
      if (!a) return { scale: 46000, compartment: 'outside' };
      const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
      const s = Math.exp(Math.log(a.scale) + (Math.log(b.scale) - Math.log(a.scale)) * (t < a.t ? 0 : k));
      return { scale: s, compartment: a.compartment };
    };
    const first = at(0);
    e.start(0, first.scale, first.compartment);
    e.shape(seconds);
    let ci = 0;
    for (let t = 0; t < seconds; t += CONTROL) {
      while (ci < cs.length && cs[ci].t < t + CONTROL) {
        if (cs[ci].event && cs[ci].t < seconds) e.event(cs[ci].event!, 1, Math.max(0, cs[ci].t));
        ci++;
      }
      const s = at(t);
      e.control(t, CONTROL, s.scale, s.compartment);
    }
    e.stopAll(seconds);
    const buf = await ctx.startRendering();
    return wav(buf, -1.5);
  }
}

/** an AudioBuffer as a 16-bit PCM WAV, its peak normalised to `peakDb` (boosted by at most `maxBoostDb`) */
function wav(b: AudioBuffer, peakDb: number, maxBoostDb = 9): Blob {
  const ch = b.numberOfChannels, n = b.length, data = Array.from({ length: ch }, (_, i) => b.getChannelData(i));
  let peak = 0;
  for (const d of data) for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  const limit = Math.pow(10, peakDb / 20);
  const k = peak > 0 ? Math.min(limit / peak, Math.pow(10, maxBoostDb / 20)) : 1;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, b.sampleRate, true);
  out.setUint32(28, b.sampleRate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i] * k)); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  return new Blob([out.buffer], { type: 'audio/wav' });
}
