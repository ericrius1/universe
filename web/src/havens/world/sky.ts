// The sky's show (app.sky): the hooks a shot or a script uses — a clear night with a strong aurora, an aurora preset
// by name, a substorm on cue — and the aurora itself.
//   app.sky.showcase()                     clear sky, the 'showcase' aurora (high, vivid, surging every minute or two)
//   app.sky.showcase({ weather: 'cirrus', aurora: 'overhead curtains' })   any sky kind, any preset or settings
//   app.sky.showcase(false)                back to what was set before
// A showcase also starts the aurora's and the clouds' clocks afresh, so a shot comes out the same each time.
//   app.sky.preset('havens storm')         an aurora preset (world/clock.ts AURORA_PRESETS)
//   app.sky.surge()                        a substorm now (the arcs flare within a second or two, fade over minutes)
import type { Aurora } from './aurora';
import type { Clouds } from './clouds';
import { AURORA_PRESETS, type AuroraSettings } from './clock';

export interface ShowcaseOptions {
  /** the clouds: a kind from world/weather.ts, 'auto' for the day's own (default 'clear') */
  weather?: string;
  /** an AURORA_PRESETS name or settings (default 'showcase') */
  aurora?: string | Partial<AuroraSettings>;
}

export class Sky {
  private saved: { weather: string; aurora: AuroraSettings } | null = null;

  constructor(readonly aurora: Aurora, private clouds: Clouds) {}

  /** a clear night with a strong aurora (or the given sky and aurora); false puts back what was set before */
  showcase(on: boolean | ShowcaseOptions = true) {
    const A = this.aurora.settings;
    if (on === false) {
      if (!this.saved) return;
      this.clouds.settings.weather = this.saved.weather;
      Object.assign(A, this.saved.aurora);
      this.saved = null;
      return;
    }
    const o = on === true ? {} : on;
    if (!this.saved) this.saved = { weather: this.clouds.settings.weather, aurora: copy(A) };
    this.clouds.settings.weather = o.weather ?? 'clear';
    this.preset(typeof o.aurora === 'string' && !AURORA_PRESETS[o.aurora] ? 'showcase' : o.aurora ?? 'showcase');
    this.aurora.restart();
    this.clouds.resync();
  }

  /** an aurora preset by name, or settings */
  preset(p: string | Partial<AuroraSettings>) {
    const s = typeof p === 'string' ? AURORA_PRESETS[p] : p;
    if (!s) console.warn(`aurora: no preset '${p}' (${Object.keys(AURORA_PRESETS).join(', ')})`);
    else Object.assign(this.aurora.settings, copy(s));
  }

  /** a substorm now */
  surge(size = 1) { this.aurora.surgeNow(size); }
}

/** settings with their colours copied (a preset's colours stay its own when the panel edits them) */
function copy<T extends Partial<AuroraSettings>>(s: T): T {
  const o: Partial<AuroraSettings> = { ...s };
  for (const k of ['teal', 'green', 'violet', 'crown', 'hem'] as const) if (s[k]) o[k] = { ...s[k]! };
  return o as T;
}
