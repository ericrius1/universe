# audio

`score.ts`: the cell's generative score, pure Web Audio, no samples. One engine drives the live score and the film's
offline soundtrack (seeded, so a film renders identically every time).

## Wiring (main.ts)

```ts
import { Score } from './audio/score';

const score = new Score();
// browsers start audio only from a gesture
const wake = () => score.start();
addEventListener('pointerdown', wake, { once: true });
addEventListener('keydown', wake, { once: true });

// every frame (App.frame): camera distance to its focus in nm, and the compartment the eye is in
score.update(dt, controls.scale, compartmentName);   // 'outside' | 'cytosol' | 'nucleus' | 'mito' | 'er' | 'golgi'

// one-shots
score.event('click');          // picking something
score.event('fly');            // a flight between places starts
score.event('arrive');         // …and lands
score.event('atp');            // ATP synthase made an ATP
score.event('step');           // a kinesin step
score.event('good'); score.event('bad');   // game answers
score.event('pop');            // a vesicle fuses
score.event('win');            // a level done
score.setMuted(true);          // a mute button (fades, then suspends the context)
```

- `update()` does nothing until `start()`; it's cheap (control decisions every 50 ms).
- Crossing a power of ten rings a low bell by itself (`score.autoTicks = false` to turn that off and call
  `score.event('zoomTick')` yourself).
- `'hover'` is a faint blip: call it when the hovered thing changes, not every frame.
- `strength` (second argument, 0–2) scales any one-shot.

## The film's soundtrack

```ts
const wav = await Score.renderFilm(60, [
  { t: 0, scale: 90000, compartment: 'outside' },
  { t: 14, scale: 9000, compartment: 'cytosol', event: 'arrive' },
  { t: 30, scale: 120, compartment: 'nucleus' },
  // …
]);   // a Blob: 48 kHz 16-bit stereo WAV, peak −1.5 dBFS, swelling in over 4.5 s and fading over the last 4.5 s
```

Scale is interpolated log-linearly between cues; a cue's compartment holds until the next; its event rings at its
time. ~9 s to render a minute.
