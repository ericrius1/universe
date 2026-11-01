# Cell

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
cd web && npm install && npm run dev          # http://127.0.0.1:5740
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
