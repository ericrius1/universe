# Universe

From the edge of the observable universe to a single molecule, in one continuous zoom on WebGPU: the cosmic web and
the cosmic microwave background, the Milky Way, the Sun's neighbours, the solar system on its real orbits, the Earth,
a meadow below the Flatirons outside Boulder with a hand lying in the grass, the skin of that hand down to its dead and
living cells, and then into a living human cell and its molecules (the Cell project, which this grew from). About 35
powers of ten.

## How it holds together across 35 orders of magnitude

- **A ladder of frames** (`web/src/cosmos/frames.ts`): megaparsecs, kiloparsecs, parsecs, AU, kilometres, metres,
  millimetres, and the cell's nanometres. Each frame sits in its parent at a position and a rotation, worked out in
  doubles; nothing ever holds a number much bigger than a few thousand of its own units.
- **Floating origins everywhere.** The GPU never does arithmetic on a big number: each level draws relative to the
  zoom's target in its own frame, rounded to float32, and every shader rebases an absolute position the moment it loads
  it; motion is added after (`web/src/engine/origin.ts`). The cell's molecules used to shake at nanometre zoom from
  exactly this (`?noorigin` brings the old maths back for comparison).
- **One nested target** (Powers of Ten): the dive always ends on the back of the hand; at each body's own scale the
  camera eases onto it (the galaxy's centre, the Sun, the Earth's centre) and back off as it passes.
- **Levels cross-fade by zoom** (`web/src/cosmos/renderer.ts`), coarsest first, each laying its light over what's behind
  with its coverage: a daytime sky hides the stars, a night one doesn't.
- **The hand-over to the cell**: zooming in past ~150 µm gives the camera to the cell's world (and out past it, back);
  the skin's living layer and the tissue's haze are matched so the two dissolve into each other.

URL: `?s=<log10 metres>` starts at a zoom (27 is the whole observable universe, -3.7 the skin's cells) · `?utc=<hours>`
the time of day (default mid-morning in Boulder) · `?now` the real moment · `?place=<cell place>` starts in the cell ·
`?noorigin` the old float32 maths.

## The cell (from Cell)
A human cell from the outside in, in real time on WebGPU: from a sheet of tissue down through the nucleus, the
mitochondria and the membranes to single molecules — DNA wound on nucleosomes, ribosomes, ATP synthase spinning,
kinesin walking a microtubule — in one continuous world measured in nanometres, eight orders of magnitude deep.
Every protein is a real structure from the Protein Data Bank. Then become one of them.

Live: https://ericlevin.dev/cell/

```
pipeline/   PDB structures → coarse-grained bead models (Python: numpy, scipy)  → web/public/data/mol
web/        the app: TypeScript + WGSL on weft (the WebGPU kit, @ericrius1/weft on npm), `math` for the CPU side
film/       rendered films (not in git)
```

## How it works

- **One world, one unit.** Organelles are analytic shapes (star-shaped blobs, capsules, bent discs with noisy
  surfaces) in `world/layout.ts`; the same signed distances run on the GPU (`shaders/world.wgsl`), so meshes built on
  the CPU and molecules placed by the GPU agree to the nanometre.
- **The molecular field** (`world/field.ts`, `shaders/field.wgsl`) is generated every frame round the point you look
  at, from a ladder of chunk sizes: coarse levels' molecules stay as finer ones arrive, so the crowd thickens
  continuously as you zoom until it's as dense as a real cytoplasm. Each candidate asks where it is: near a membrane it
  becomes that membrane's protein (receptors, pumps, ATP synthase, nuclear pores, ER ribosomes), set into the surface;
  elsewhere one of its compartment's soluble molecules. Filaments get their lattices (tubulin's 13 protofilaments,
  actin's double helix, nucleosomes and linker DNA).
- **Drawing**: molecules as ray-traced sphere impostors at three levels of detail (one indirect draw per type and
  level), filaments as ray-traced capsules or sub-pixel hairlines, membranes as glass (weighted blended transparency)
  from afar and solid with lipid heads up close, and a wedge that cuts the cell open with true cross-sections.
- **Film**: ambient occlusion with a depth-proportional radius, scale-adaptive haze, macro depth of field, bloom, an
  AgX-style grade.
- **Time** slows as you zoom: real time at the scale of the cell, a hundredth among the molecules.

## Run

```bash
cd web && npm install && npm run dev          # http://127.0.0.1:5750
python -I pipeline/beads.py                   # (re)build the molecules from the PDB
node web/tools/keepchrome.mjs                 # a headless GPU Chrome for the tools (CDP 9740)
node web/tools/shoot.mjs out.png "place=dna"  # a frame (UI=1 adds the interface)
```

weft comes from npm. To work on the kit alongside the app, clone it beside this repo (../weft) and run with
`WEFT_LOCAL=1 npm run dev`: its source is compiled in and hot-reloads. Publish it and bump the version here when done.

## Film and deploy

```bash
cd web && npx vite build --outDir ../scratch/filmbuild && npx vite preview --outDir ../scratch/filmbuild --port 5741
PORT=5741 node tools/film.mjs trailer 1920 1080   # film/trailer/cell-trailer.mp4 (frames + the score, rendered offline)
bash web/tools/deploy.sh ../PortfolioII           # built for /cell/ into the homepage's public/cell/
```

URL: `?place=<tissue|cell|nucleus|pore|dna|mito|atp|er|golgi|mt|membrane>` · `?nocut` · `?q=0.5` (lighter) ·
`?debug` (weft's overlay: passes, GPU timings, textures).

Structures (RCSB PDB): 1KX5 nucleosome, 4UG0 human 80S ribosome, 6ZPO ATP synthase, 5FLM RNA polymerase II, 1JFF
tubulin, 1J6Z actin, 1EHZ tRNA, 1U8F GAPDH, 4R3O proteasome, 1CLL calmodulin, 1EMA GFP, 1UBQ ubiquitin, 1HKB
hexokinase, 1FHA ferritin, 1CTS citrate synthase, 1AO6 albumin, 1IGT IgG, 1HRC cytochrome c, 3SN6 β2AR–Gs, 4HYT
Na⁺/K⁺-ATPase, 4PYP GLUT1, 3EMN VDAC, 5LDW complex I, 1OCC cytochrome c oxidase, 6VXX spike.
