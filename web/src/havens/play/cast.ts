// Who you are (app.cast): Katara, Aang or Iroh, each worn by the player's one body (hero/cast.ts wear: their mesh, their
// rig, their gait). K goes round them — Katara, Aang, Iroh — as does the panel's "who (K)". Their bodies stream in after
// the start (Katara's first: she's who you begin as, unless the address asks for another); one not yet in is waited for,
// and one that failed to load is passed by.
import type { Kit } from '@ericrius1/weft';
import { HeroMesh, type Who } from '../hero/hero';
import type { CastPlayer } from '../hero/cast';
import { notice } from '../ui/notice';

export const ORDER: Who[] = ['katara', 'aang', 'iroh'];
/** the cast as the panel shows them: a name, what they do */
export const CAST: Record<Who, { name: string; blurb: string }> = {
  katara: { name: 'Katara', blurb: 'Waterbender · run, jump and fly' },
  aang: { name: 'Aang', blurb: 'Airbender · Shift rides the air scooter, double-press Space to glide, a click sends a gust' },
  iroh: { name: 'Iroh', blurb: 'Firebender · an easy stroll, a click throws fire, hold it for a flame' },
};

export class Cast {
  /** each body's load (started once asked for), and the ones that failed */
  private loads = new Map<Who, Promise<HeroMesh | null>>();
  private failed = new Set<Who>();
  /** waiting for a body to come in, to be them */
  private pending: Who | null = null;
  /** told of each body as it comes in (to draw it: main.ts) */
  onBody: ((who: Who, mesh: HeroMesh) => void) | null = null;
  /** told when who you are changes */
  onChange: ((who: Who) => void) | null = null;

  constructor(private kit: Kit, private player: CastPlayer) {
    player.onK = () => this.next();
  }

  /** the body's mesh, loading it if it isn't yet (null: it couldn't be had) */
  load(who: Who): Promise<HeroMesh | null> {
    let p = this.loads.get(who);
    if (!p) {
      p = HeroMesh.load(this.kit, who).then((m) => {
        if (!m) { this.failed.add(who); return null; }
        if (who !== 'katara') this.player.addBody(who, m);
        this.onBody?.(who, m);
        return m;
      });
      this.loads.set(who, p);
    }
    return p;
  }

  /** every body in (or given up on) */
  all(): Promise<void> { return Promise.all(ORDER.map((w) => this.load(w))).then(() => {}); }

  /** who you are now (or are about to be, their body coming in) */
  get choice(): Who { return this.pending ?? this.player.who; }

  /** be them: at once if their body's in, else as soon as it is */
  async select(who: Who) {
    if (who === this.choice) return;
    this.pending = who;
    const m = await this.load(who);
    if (this.pending !== who) return;
    this.pending = null;
    if (!m || !this.player.wear(who)) { notice(`${CAST[who].name} isn't here (their body didn't load)`); return; }
    notice(`<b>${CAST[who].name}</b> · ${CAST[who].blurb}`, 3.5);
    this.onChange?.(who);
  }

  /** K: the next of them round, past any whose body failed */
  next() {
    let i = ORDER.indexOf(this.choice);
    for (let k = 0; k < ORDER.length; k++) {
      i = (i + 1) % ORDER.length;
      if (!this.failed.has(ORDER[i])) { void this.select(ORDER[i]); return; }
    }
  }
}
