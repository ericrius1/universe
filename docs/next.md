# Universe, the next level: what we're building and how we work

Shared notes for everyone working on the `next` branch (several agents at once, each in its own worktree). Read this
first, then your own brief.

## Where it's going

1. **Windows.** Any stretch of the zoom can be opened by itself: the solar system, the cell, a well of liver cells.
   A window loads only what it shows (its code, its data, its GPU targets), so it starts fast and runs on smaller
   devices, and it can be handed to someone as one educational piece. From any window the zoom can be let out to the
   whole universe, which loads the rest behind it. The whole universe is just the widest window.
2. **Fast.** 60 frames a second on a fanless MacBook Air at every place, at a sharper picture than today's.
3. **Not plastic.** Light and materials that look like the thing, not like CG (below).
4. **Something to learn at every scale**, with a scientific bent: named things you can tap, a guide in chapters, real
   data, and instruments (plots and readouts driven by the same data the view draws).
5. **Hepatocyte comes in** as a realm and a window of its own: a plate of liver cells at its true scale, forked off the
   Earth at a lab bench, joining the dive again at the molecules.

## The look

What "not plastic" means here. These are rules, with the reason for each.

In the cell and the well:
- **Nothing glints underwater.** Protein and lipid against cytosol reflect about 0.2% at normal incidence (in air
  it's 4%). A sharp white highlight says "a solid thing in air". No white specular, no clear-coat, no white rim.
  Highlights belong only where something meets air: the meniscus, the plate's plastic, the tear film on an eye.
- **Light comes through things.** For a sphere or a capsule drawn as an impostor the path through it is known exactly
  (a sphere's chord is 2√(r² − b²)), so absorb along it per colour channel: thin edges light, thick middles deep. A
  thin shell is seen at its silhouette, where the path through it is long, and hardly at all face on.
- **The crowd shadows itself.** Occlusion and soft shadow from a coarse density volume round the focus (the GPU
  already holds every instance), the haze lit by the same shadow, so depth goes dark and light falls between things.
  Screen-space occlusion stays for contact detail and is tinted by what it's on, never grey.
- **Colour held back.** Chroma capped, each copy of a molecule a little different, palettes by compartment, and black
  is never zero.
- **Depth from the lens and the water.** Haze that varies, slow out-of-focus particles, shallow focus with a clean
  bokeh, grain. Chromatic aberration only as a trace; no halation.
- **Motion that's alive.** A correlated random walk, never per-frame noise.
- **Instrument looks are modes, and say so.** Phase contrast and fluorescence for cells in a dish, a stained thin
  section below what light can resolve. Labelled as simulated.

In space:
- **A star is a flux.** Magnitude to flux, times one exposure, through one shared point-spread function (a tight core
  with faint wide wings). Bright stars look big because their wings cross the noise floor, not because their quads
  are scaled. Colour from B−V, held back a little. Spikes only where a telescope is the story.
- **Black is never empty.** The real Milky Way behind the catalogue's stars, and a grain floor.
- **One exposure that eases with the zoom**, so the stars go out when the Sun or the Earth fills the frame.
- **Real data before noise**, wherever it exists.
- **Emitters are light, not lit balls.** The microwave background and the cosmic web add their light; brightness is
  the log of density.

## Speed: budgets and how to measure

The machine is a MacBook Air (Apple M5, no fan). Its window is about 1710×1000 CSS pixels at a pixel ratio of 2, so the
page's canvas is 2565×1500. Numbers are GPU milliseconds a frame; 16.7 is 60 a second.

Where `main` stands (perf/air-main.json), render scale held at 1:

| | ms | | ms |
|---|---|---|---|
| the web, seen whole | 99.7 | cell: ATP synthase | 86.3 |
| entering the Milky Way's disc | 122.4 | cell: nuclear pore | 75.1 |
| the cosmic web | 70.2 | cell: Golgi | 71.3 |
| the observable universe | 37.0 | cell: rough ER | 68.6 |
| our marble | 23.1 | cell: nucleus | 60.1 |
| gardens, 3 km | 20.0 | cell: DNA, membrane, microtubules, mitochondrion | 53–56 |
| the Milky Way | 16.2 | cell: the cell, tissue | 44, 38 |
| everything else above the cell | 5–12 | | |

What owns those frames (from switching parts off): the web's march is 97–99% of its frames; the galaxy's march is all
of the disc's; in the cell the see-through membranes are 18–24 ms wherever they show, and close up it's one membrane
or a wall of beads filling the screen. The count of molecules, the depth of field and the occlusion pass are not
levers. Everything heavy scales with pixels. With `?taau&scale=0.5` (weft's upscaler, already wired in, off by
default) the cell is 22–33 ms: sharp, but the passes at the canvas's size cost about 10 ms by themselves.

Budgets for this round: above the cell, 12 ms at scale 1 everywhere. In the cell, 16.7 ms at the settings the page
picks for this machine, and never over 22.

Tools (run from `web/`, against a built page; `PORT` says which):

```bash
npx tsc --noEmit                                   # must pass
npx vite build --outDir /tmp/<yours> --emptyOutDir # not `npm run build`: its pre-hook moves the engine's version
npx vite preview --outDir /tmp/<yours> --port <your port> --host 127.0.0.1 --strictPort &
PORT=<your port> BASE=perf/air-main.json node tools/bench.mjs          # every place, against the baseline
PORT=<your port> ONLY="web,cell:dna" PARTS=1 node tools/bench.mjs     # some places, and what owns them
PORT=<your port> node tools/shots.mjs /tmp/<yours>-shots               # a picture of every place and sheet.jpg
```

**One GPU job at a time.** Two pages timing at once time each other, and this laptop is shared by every agent. `bench`
and `shots` take a lock and wait their turn; don't time anything by another route, and don't leave a page running
while you wait. A headless Chrome with a GPU is kept running on CDP port 9740 for everyone: don't start another or
stop it. Light frames read 5–12 ms from run to run and heavy ones move by a quarter as the laptop warms, so compare
within one run and re-run before believing a small difference. Look at pictures with the Read tool: a number can't
tell you a frame went black.

## Rules of the road

- Work only inside your own worktree, on your own branch. Commit there as you go (plain messages that say what
  changed and why). Don't push, merge, rebase onto others or touch another worktree.
- Stay in the files your brief gives you. If you have to change something outside them, keep it to a few lines and
  list it in your report: someone else is editing that file.
- `web/src/havens` is a copy of another project (tools/havens-sync.mjs). Don't edit it.
- No new dependencies. weft (`@ericrius1/weft`, in node_modules) is the kit; read its README and types before
  inventing something it has.
- Write like the file you're in. Comments here are sentences that say what a thing is and why, in plain words; keep
  that voice, and keep the film, the dome (`?dome`) and the phone paths working.
- A change isn't done until it's typechecked, timed against the baseline and looked at in pictures, on the default
  page and with `?phone`.
- End with a report: what changed and where, bench lines before and after, where the pictures are, and what's
  unfinished or risky. Say plainly what you didn't get to.
