// A pass's draw order when its features arrive in any order (the startup builds them in parallel; some stream in
// later). Named slots — empty markers in the pass's draw list — hold each feature's place: a feature's draws go into
// its slot whenever it's built (`into`), so the order (the opaque things, the sky, then the stars, the glass and the
// water) comes out the same whichever loads first. A draw made outside `into` lands in the fallback slot (the end of
// the opaque things), so a new opaque feature drawn the plain way is still in the right place.
import type { Draw, RenderPass } from '@ericrius1/weft';

export class Slots<N extends string> {
  private marks = new Map<N, Draw>();
  private target: N | null = null;

  /** fallback: where a draw made outside `into` goes */
  constructor(readonly pass: RenderPass, names: readonly N[], public fallback: N) {
    for (const n of names) {
      const mark = { label: `slot:${n}`, enabled: false, encode() {} } as unknown as Draw;
      this.marks.set(n, mark);
      pass.draws.push(mark);
    }
    // (every draw the pass makes, fullscreen ones too, is moved to the slot being filled)
    const draw = pass.draw.bind(pass);
    pass.draw = ((shader, opts) => {
      const d = draw(shader, opts);
      const list = pass.draws;
      list.splice(list.lastIndexOf(d as unknown as Draw), 1);
      list.splice(list.indexOf(this.marks.get(this.target ?? this.fallback)!), 0, d as unknown as Draw);
      return d;
    }) as RenderPass['draw'];
    // (and every bundle of static draws it makes: the parts', culled on the GPU)
    const bundle = pass.bundle.bind(pass);
    pass.bundle = ((label) => {
      const b = bundle(label);
      const list = pass.draws;
      list.splice(list.lastIndexOf(b), 1);
      list.splice(list.indexOf(this.marks.get(this.target ?? this.fallback)!), 0, b);
      return b;
    }) as RenderPass['bundle'];
  }

  /** draw a feature into its slot (fn makes its draws on the pass) */
  into<T>(name: N, fn: () => T): T {
    const was = this.target;
    this.target = name;
    try { return fn(); } finally { this.target = was; }
  }
}
