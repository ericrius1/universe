# The look: recipes and sources

What two research passes found (12 November 2026), condensed for whoever builds the look. `docs/next.md` has the rules
in a line each; this has how, what it costs, and where it comes from. Costs are the researchers' estimates for a
fanless Apple GPU at about 2500×1500: check each against `tools/bench.mjs`.

## The cell and the well

**Why it reads as plastic.** A diffuse layer under a glossy white highlight is the textbook "plastic" material. A
dielectric in air reflects 2–5% at normal incidence; protein or lipid (n ≈ 1.45) against cytosol (n ≈ 1.33) reflects
about 0.2%. So the GGX lobe, the pow-420 clear-coat and the rim mixed toward white all say "a solid thing in air".
The constant fill and bounce never come out of the geometry, nothing is shadowed, and every bead of a kind is one
saturated colour. Molecules have no colour and below 200 nm "realistic" light has no meaning: the colour is a choice,
so make it a restrained one.

In order of what they buy for what they cost:

1. **The shading's constants** (free). F0 about 0.005–0.02, roughness 0.35–0.6, the clear-coat gone, specular
   multiplied by occlusion, the rim tinted by the material or gone, each instance's albedo ±5–10% in lightness and hue,
   chroma capped.
2. **A coarse density volume** (0.5–1.5 ms). Each frame splat the instances the GPU already made into a 64³–128³
   texture round the focus (an atomic add in compute), with mips. Per pixel: three to six cone taps round the normal
   for occlusion, four to eight toward the key light for a soft shadow. Works alike for impostors and meshes. Keep the
   screen-space pass for contact detail; expect light leaks at the volume's resolution.
   Grottel et al. 2012, "Object-Space Ambient Occlusion for Molecular Dynamics":
   https://ieeexplore.ieee.org/document/6183593 · Borland, opacity from occlusion (for glass membranes):
   https://www.cs.unc.edu/~taylorr/Comp715/papers/AOOM_WSCG20111.pdf
3. **Occlusion with colour** (about what the 12-tap pass costs now). Jimenez et al.'s multi-bounce fit (a cubic in
   occlusion and albedo) and a bent normal from the same horizon search, used to look up the ambient light.
   https://www.activision.com/cdn/research/Practical_Real_Time_Strategies_for_Accurate_Indirect_Occlusion_NEW%20VERSION_COLOR.pdf
   · code: https://github.com/GameTechDev/XeGTAO
4. **Ambient from two or three bands** of spherical harmonics or a hemisphere, by the bent normal, in place of the
   constant fill and bounce (free).
5. **The path through a body** (free). A sphere impostor's chord is 2√(r² − b²) at impact parameter b; a capsule's is
   analytic too. exp(−σ · chord) per channel. The light's side by a short trace through the density volume. A sheen
   lobe ("Charlie", Estevez & Kulla 2017) in place of GGX for close-ups gives a velvet, micrograph feel. Skip
   screen-space subsurface scattering: the bodies are a few pixels across.
   https://www.ea.com/frostbite/news/approximating-translucency-for-a-fast-cheap-and-convincing-subsurface-scattering-look
6. **An illustrative mode among the molecules** (0.2–0.4 ms). Flat colour and occlusion, light ignored; a line where
   depth jumps, thicker for a bigger jump; a thinner line where the object changes; fog to the background. cellVIEW
   and Mol*'s Mesoscale Explorer both choose this for crowded scenes, and at 200,000 beads it reads better than
   realistic light. https://molstar.org/viewer-docs/tips/illustrative-style/ ·
   https://vcg.isti.cnr.it/Publications/2006/TCM06 · https://ccsb.scripps.edu/illustrate
7. **Light in the water** (0.7–1.5 ms). A froxel grid of single scattering with its shadow from the density volume;
   keep it thin and uneven or it flattens everything. A few thousand slow out-of-focus sprites ("marine snow") are
   nearly free and sell depth.
8. **The lens.** A half-resolution gather for the depth of field (Jimenez, Call of Duty: Advanced Warfare) in place
   of 40 taps. An NA 1.4 objective holds about 0.4 µm in focus. Keep the grain. Chromatic aberration and halation are
   overused, and halation has no basis in a microscope.
9. **Motion.** GFP diffuses at about 25 µm²/s in cytoplasm, which in real time is nearly a micron a frame: slow time
   by 10⁴–10⁶ among the molecules, aim for a step of a few percent of a bead a frame, and use a walk with memory
   (Ornstein–Uhlenbeck), never white noise.

Avoid: voxel cone-traced GI, screen-space reflections, ray-marched contact shadows on top of the volume, and many
separate full-screen passes (each spills tile memory on an Apple GPU: merge them).

### Instrument looks

From depth, normal, the analytic thickness t and an id; each id given a refractive excess Δn, a stain density and a
fluorophore amount. Each is a mode, labelled as simulated.

- **Brightfield.** exp(−Σ stain · t) per channel on white, a slight defocus.
- **Phase contrast** (the natural look for cells in a dish). Optical path OPD = Δn · t; I = 1 − a · (OPD − blur(OPD)),
  the blur a few microns wide: one high-pass gives both the bright halo and the shade-off inside large bodies.
- **DIC.** I = bias + k · ∂OPD/∂s along the shear: two taps, a one-sided relief.
- **Fluorescence.** Emission = fluorophore · t on black, blurred by distance from the focal plane; for confocal also
  weighted by exp(−(Δz/σ)²). Shot noise. Two or three channel colours.
- **TEM thin section.** The scene clipped to a 70 nm slab, I = exp(−Σ stain · t in the slab), grey, a thin bright
  fringe.
- **SEM.** I ∝ sec(θ) plus an edge boost from the depth gradient plus a little toward the detector. Grey, scan
  noise, no depth of field.

Nobody seems to have switched the instrument with the scale in real time from a cell to a protein. Do it as a mode or
a cross-fade, never the only look: the electron looks are grey and slab-bound and break the zoom's continuity.

### What to look at

Goodsell's landscapes (flat watercolour, outlines, true crowding, no highlights):
https://pdb101.rcsb.org/sci-art/goodsell-gallery · Ingersoll & McGill's Cellular Landscape (soft occlusion, palettes by
compartment): https://gaelmcgill.artstation.com/projects/Pm0JL1 · Drew Berry (dark grounds, colour for mood, constant
jostling) · Iwasa's HIV life cycle (soft light, held-back palette) · Journey to the Microcosmos (real brightfield,
phase and DIC: shallow focus, halos, drifting debris) · a hepatocyte in TEM, CIL:37188 (glycogen rosettes, dense rough
ER) · the Human Protein Atlas's confocal images (black grounds, punctate texture).

## Space

1. **A star is a flux.** F = 10^(−0.4(m − m_ref)) × exposure through one shared point-spread function: a Moffat core
   (β about 2.5–4) with a faint r⁻² aureole, one texture tap. Saturation does the "size from brightness". Colour from
   B−V (Ballesteros 2012: https://arxiv.org/abs/1201.1809), held back a little. Don't stack a per-star glow on top of
   the bloom: that counts the light twice.
2. **Glare and spikes.** Glare as a half-resolution convolution of the HDR buffer (Spencer et al. 1995). Spikes only
   in "telescope" moments (Hubble's four, Webb's six and two).
3. **Exposure.** Brightness in physical units, a keyframe of exposure for each level and a small log-average
   auto-exposure easing between them: stars go out when the Sun or the Earth fills the frame and come back after.
4. **Galaxies from outside.** An atlas of real images tinted by type for the far ones. For ours, a volume built from
   the face-on map (colour and dust), dust as absorption only, pink knots as a sparse sprite layer; cross-faded into
   the panorama about a kiloparsec from the Sun (as OpenSpace and Gaia Sky do).
5. **The cosmic web.** Brightness the log of density, colour by density (warm where dense, cool in the threads),
   additive, no shadowing: march a low-resolution log-density volume built from the real survey through a 1D colour
   table, with the galaxies themselves as small point-spread sprites so knots resolve into points close up.
6. **The microwave background.** From inside, an emissive sky: first the uniform glow of 3,000 K, then redshifted
   toward nothing, then the false-colour map faded in as "what the instrument sees" with a legend (±300–500 µK about a
   mean of 2.725 K). No limb darkening, no highlight, no hard edge.
7. **The Earth and the planets.** Hillaire's 2020 atmosphere tables (https://sebh.github.io/publications/egsr2020.pdf),
   a glint on the sea masked by land, the cloud map looked up again along the Sun's direction for its shadow, night
   lights × a smoothstep 6–10° wide across the terminator, limb darkening on the gas giants, rings from a 1D radial
   texture with the planet's shadow on them, theirs on it, and a forward-scattering phase (g about 0.5–0.7).
8. **The camera.** A grain floor under 1–2% in the shadows (it turns flat black into dark), a trace of halation round
   the very bright, stars drawn out along the motion in a fast flight with their flux conserved. No lens-flare ghosts,
   no rainbow stars, no warp tunnel.

Data notes that changed the plan: the HYG star database is CC BY-SA (share-alike: not used; Hipparcos or XHIP from
CDS instead); d3-celestial's constellation lines are sky coordinates, not star numbers (match them to the catalogue);
ESA's ready-made Planck pictures are share-alike or ESA-licensed (render our own from the SMICA map); 2MRS gives
redshifts, not distances (distance ≈ cz/H0, so clusters are stretched along the line of sight); Voyager 1 is one
light-day from Earth on 18 November 2026 (173.14 AU), and its distance from the Earth swings ±0.8 AU a year with the
Earth's orbit.
