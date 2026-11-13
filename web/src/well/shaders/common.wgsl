// What every pass shares: the frame (weft's), the state of the well (the lesion axes, the register, the hour), the
// per-cell table, the light, and the small tools — hashes, the soft translucent lighting the whole place is shaded
// with, and the air it fades into.
#include "weft/frame"

struct World {
  // the lesion axes, exactly as data/compounds.ts computes them. 0 = nothing, 1 = as far as that axis goes.
  gsh: f32, depol: f32, swell: f32, frag: f32, ros: f32, atpLoss: f32,
  lipid: f32, micro: f32, pld: f32, erStress: f32, constrict: f32, effluxLoss: f32,
  caspase: f32, condense: f32, karyolysis: f32, oncosis: f32, leak: f32, dna: f32, lyso: f32,
  // 0 = the bright register (a white field, everything lit), 1 = fluorescence (a dark field, only the stains)
  mode: f32,
  fogK: f32, exposure: f32, white: f32, hour: f32,
  // which stains are on: hoechst, tmrm, bodipy, lipidtox-phospholipidosis
  stain: vec4f,
  // cdf, cellrox, pi, spare
  stain2: vec4f,
  sun: vec3f, spread: f32,
  // the cell you are inside: centre xyz, its radius; w <= 0 when you are not in one
  focus: vec4f,
  tint: vec3f, feeders: f32,
  cellSize: f32, canalPhase: f32, detail: f32, dim: f32,
  // half the width of the square field of cells about the chosen well's centre (µm): the collagen under them
  fieldHalf: f32,
  // the eye's height over the well's floor and the meniscus's (µm), and 1 once the eye is down in the medium
  eyeAlt: f32, meniscus: f32, under: f32,
  // the instrument (instrument.wgsl): how much of the picture is the simulated instrument's (0 the modelled view), which
  // (0 phase contrast, 1 brightfield), the blur its optics put in (σ, render pixels), and how near the eye is to
  // passing through the medium's surface (1 at it)
  optics: vec4f,
}
@group(0) @binding(1) var<uniform> G: World;

// one per cell of the monolayer: xyz its centre (y its apex height), w its mean radius; then hepatocyte, how deep
// inside an island it sits, its seed, and how exposed it happens to be
struct CellG { c: vec4f, k: vec4f }
@group(1) @binding(9) var<storage, read> cells: array<CellG>;

const PI = 3.14159265;

fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
/** normalize, but a zero-length vector points up instead of becoming NaN — one NaN fragment is enough to poison
 *  whole blocks of the picture once the bloom blur has spread it across a mip */
fn unit(v: vec3f) -> vec3f {
  let l2 = dot(v, v);
  return select(vec3f(0.0, 1.0, 0.0), v * inverseSqrt(max(l2, 1e-20)), l2 > 1e-18);
}
/** keep a colour finite and in range, so nothing downstream can be handed a NaN or an infinity */
fn safe(c: vec3f) -> vec3f { return clamp(c, vec3f(0.0), vec3f(60.0)); }
fn sat3(v: vec3f) -> vec3f { return clamp(v, vec3f(0.0), vec3f(1.0)); }
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

fn hash11(p: f32) -> f32 { var x = fract(p * 0.1031); x *= x + 33.33; x *= x + x; return fract(x); }
fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn hash31(p: vec3f) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
fn noise3(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = mix(mix(mix(hash31(i + vec3f(0,0,0)), hash31(i + vec3f(1,0,0)), u.x),
                  mix(hash31(i + vec3f(0,1,0)), hash31(i + vec3f(1,1,0)), u.x), u.y),
              mix(mix(hash31(i + vec3f(0,0,1)), hash31(i + vec3f(1,0,1)), u.x),
                  mix(hash31(i + vec3f(0,1,1)), hash31(i + vec3f(1,1,1)), u.x), u.y), u.z);
  return a;
}
fn fbm3(p: vec3f) -> f32 {
  return noise3(p) * 0.55 + noise3(p * 2.03) * 0.28 + noise3(p * 4.11) * 0.17;
}

// ---------------------------------------------------------------------------------------- the palette

// Held back: each colour's chroma is about half the old register's (the cells were the colours of a poster on white),
// since below 200 nm a colour is a choice and on a dark ground a little of it carries far. Linear RGB.
const C_CYTO = vec3f(0.560, 0.250, 0.130);
const C_CYTO_HI = vec3f(0.660, 0.380, 0.240);
const C_RIM = vec3f(0.700, 0.620, 0.400);
const C_NUC = vec3f(0.250, 0.200, 0.420);
const C_NUCLEOLUS = vec3f(0.150, 0.100, 0.300);
const C_MITO = vec3f(0.600, 0.200, 0.100);
const C_MITO_OFF = vec3f(0.330, 0.290, 0.280);
const C_ER = vec3f(0.620, 0.360, 0.200);
const C_GOLGI = vec3f(0.540, 0.250, 0.380);
const C_LYSO = vec3f(0.360, 0.220, 0.500);
const C_LAMELLAR = vec3f(0.520, 0.470, 0.680);
const C_PEROX = vec3f(0.190, 0.420, 0.330);
const C_LIPID = vec3f(0.720, 0.580, 0.250);
const C_GLYC = vec3f(0.560, 0.390, 0.260);
const C_BILE = vec3f(0.120, 0.560, 0.330);
const C_BILE_OFF = vec3f(0.420, 0.340, 0.130);
const C_FEEDER = vec3f(0.230, 0.290, 0.460);
const C_FLOOR = vec3f(0.300, 0.280, 0.260);
const C_HARM = vec3f(0.460, 0.110, 0.090);
const C_DEAD = vec3f(0.300, 0.285, 0.310);
const C_DNA = vec3f(0.120, 0.560, 0.520);

/** the medium round the cells in the modelled view: never white and never black, a dim warm grey with the culture
 *  medium's pink held far back in it, lighter toward the light over the well, darker toward the floor and inside a cell
 *  (the cytosol's, warmer), and uneven — a slow drift of thicker and thinner haze rather than one flat colour.
 *  Nothing at all in fluorescence */
fn mediumColor(wp: vec3f, rd: vec3f) -> vec3f {
  let up = sat(rd.y * 0.5 + 0.5);
  var c = mix(vec3f(0.030, 0.024, 0.027), vec3f(0.085, 0.072, 0.078), up);
  // (inside a cell: the cytosol's own haze, warmer and denser)
  c = mix(c, vec3f(0.062, 0.042, 0.032) * (0.7 + 0.6 * up), sat(G.focus.w));
  // (two slow waves, not a noise: this runs for every fragment of everything down in the medium)
  let q = wp * 0.011 + vec3f(0.0, frame.time * 0.03, 0.0);
  let drift = 0.5 + 0.25 * sin(q.x + 1.7 * sin(q.z * 0.7 + q.y)) + 0.25 * sin(q.z * 1.3 - q.y * 0.6 + 2.1);
  c *= 0.78 + 0.44 * drift;
  return mix(c, vec3f(0.004, 0.005, 0.010), G.mode);
}

/** (the old name, kept for what still asks for it: the haze's colour seen straight ahead) */
fn airColor() -> vec3f { return mediumColor(frame.camPos, frame.camFwd); }

fn air(c: vec3f, wp: vec3f) -> vec3f {
  let d = distance(wp, frame.camPos);
  let f = 1.0 - exp(-d * G.fogK);
  if (f < 0.002) { return c; }
  let rd = (wp - frame.camPos) / max(d, 1e-4);
  return mix(c, mediumColor(wp, rd), f * (1.0 - G.mode * 0.88));
}

/** how much of the light from above is left at a point in a cell, having come down through the crowd over it (a cell's
 *  contents are dense enough that the floor of a cell is in its own shade): from its depth under the cell's roof,
 *  per channel (the crowd takes the blue first) */
fn crowdLight(depth: f32) -> vec3f {
  return exp(-vec3f(0.045, 0.060, 0.080) * max(depth, 0.0));
}

/** a body seen by the light that comes through it (the modelled view's one shading): what's left of the light after
 *  the path through it, absorbed per channel so that `base` is its colour where it is `thick` micrometres thick — thin
 *  edges pale and light, thick middles deep — shaded a little by its form toward the light, never a white highlight.
 *  Under water a protein or a lipid reflects a fifth of a percent: there's nothing to glint */
fn through(base: vec3f, chord: f32, thick: f32, n: vec3f, light: vec3f) -> vec3f {
  let sigma = -log(clamp(base, vec3f(0.02), vec3f(1.0))) / max(thick, 0.05);
  let T = exp(-sigma * max(chord, 0.0));
  let L = unit(G.sun);
  let wrap = sat((dot(n, L) + 0.8) / 1.8);
  return light * T * (0.42 + 0.58 * wrap);
}

/** the modelled view's soft lighting, for things with no path through them worth the name (a surface): a key from
 *  above wrapped round as if it came through the thing, a sky from over the well, a rim in the thing's own colour.
 *  No white specular: `gloss` is a soft sheen in its own colour, at most. Fluorescence: only the dye */
fn lit(base: vec3f, n: vec3f, wp: vec3f, gloss: f32, emis: f32) -> vec3f {
  let L = unit(G.sun);
  let V = unit(frame.camPos - wp);
  let ndl = dot(n, L);
  let wrap = sat((ndl + 0.72) / 1.72);
  let fres = pow(1.0 - sat(dot(n, V)), 2.6);
  var c = base * (0.10 + 0.62 * wrap + 0.16 * sat(n.y * 0.5 + 0.5));
  c += base * fres * 0.18;
  c += base * pow(1.0 - sat(dot(n, V)), 1.4) * 0.08 * gloss;
  c += base * emis;
  // in the fluorescence register nothing is lit — a thing is only as bright as the dye in it
  return mix(c, base * (0.25 + emis * 2.4), G.mode);
}

// ---------------------------------------------------------------------------------------- the lab

// The room round the plate, in the plate's millimetres (x along its columns, z down its rows, y up from the middle of
// its top face, the bench 11.2 mm under that): a dim lab, one soft light overhead (a frosted panel a metre over the
// bench, along G.sun), a black resin bench. Shared by the room behind everything (stage.wgsl) and the plate's clear
// plastic and liquid (plate.wgsl), which show it through themselves and in themselves.
const BENCH_Y = -11.2;
const PANEL_H = 1050.0;
/** the panel's light (HDR), its half size (mm) */
const PANEL_L = vec3f(15.0, 14.6, 13.8);
const PANEL_HALF = vec2f(450.0, 260.0);
/** where it is: nearly overhead, a little off toward the room (its light on the cells is G.sun's, from the same side) */
const PANEL_DIR = vec3f(0.12, 1.0, 0.16);
/** the room's own light, everywhere */
const ROOM_AMB = vec3f(0.020, 0.021, 0.024);

fn panelCentre() -> vec3f { let s = unit(PANEL_DIR); return s * (PANEL_H / s.y) + vec3f(0.0, BENCH_Y, 0.0); }

/** the panel's light off a glossy surface whose reflected ray is R: a broad lobe round its mirror image, for a surface
 *  not quite a mirror (moulded plastic, a trembling liquid) — its edges and curves catch the light from more angles */
fn panelGloss(p: vec3f, R: vec3f, sharp: f32) -> vec3f {
  return PANEL_L * 0.08 * pow(max(dot(R, unit(panelCentre() - p)), 0.0), sharp);
}

/** the room seen along a direction from a point: the panel (soft-edged, a frosted diffuser), dim walls and ceiling;
 *  `soft` blurs it, for a satin surface that gives it back */
fn roomSeen(p: vec3f, rd: vec3f, soft: f32) -> vec3f {
  let pc = panelCentre();
  var c = mix(vec3f(0.006, 0.006, 0.007), vec3f(0.022, 0.022, 0.025), smoothstep(-0.3, 0.7, rd.y));
  if (rd.y > 1e-3) {
    let t = (pc.y - p.y) / rd.y;
    let q = (p + rd * t - pc).xz;
    let e = max(abs(q.x) / PANEL_HALF.x, abs(q.y) / PANEL_HALF.y);
    c += PANEL_L * (1.0 - smoothstep(0.82 - 0.4 * soft, 1.05 + 1.6 * soft, e)) * (1.0 - 0.6 * soft);
    // (the ceiling round it, lit by it a little)
    c += vec3f(0.05, 0.05, 0.055) * exp(-length(q) / 900.0) * smoothstep(1.0, 1.4, e);
  }
  return c;
}

/** the light falling on a point of the bench (or anything on it) from the panel: a pool under it, falling off */
fn panelLight(p: vec3f) -> vec3f {
  let pc = panelCentre();
  let d = pc - p;
  let h = max(d.y, 1.0);
  let k = h * h / dot(d, d);
  return PANEL_L * 0.075 * k * k + ROOM_AMB;
}

fn sdRect(p: vec2f, h: vec2f) -> f32 { let d = abs(p) - h; return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0); }

// ---------------------------------------------------------------------------------------- per cell

/** where this cell stands in the queue: 0 goes first, 1 last. How the queue is drawn is itself a readout. Necrosis
 *  spreads — a cell that bursts spills onto its neighbours — so it goes in patches, and the queue follows a smooth
 *  field over the monolayer. Apoptosis does not spill, so its dying cells are scattered singles among healthy ones,
 *  and the queue is each cell's own throw of the dice. */
fn cellRank(ci: u32) -> f32 {
  let c = cells[ci];
  let patchy = sat(G.oncosis + G.leak * 0.7 + G.karyolysis);
  let lone = sat(G.caspase + G.condense);
  let w = patchy / max(1e-4, patchy + lone);
  let spatial = sat((fbm3(vec3f(c.c.xz * 0.022, 3.1)) - 0.5) * 2.4 + 0.5);
  let single = hash11(f32(ci) * 1.37 + 0.11);
  return clamp(mix(single, spatial, w), 0.0, 1.0);
}

/** how hard this particular cell has been hit, centred on 1 */
fn cellFate(ci: u32) -> f32 { return 0.6 + 0.8 * cellRank(ci); }

/** 1 while the cell is whole, 0 once it has let go of the plate. The share of cells at 0 is the share the viability
 *  reading would miss, so what you see on the floor of the well is the number on the readout. */
fn cellAlive(ci: u32) -> f32 {
  let killed = sat(G.leak + 0.5 * G.caspase + 0.55 * G.oncosis);
  return smoothstep(killed - 0.1, killed + 0.1, cellRank(ci));
}

/** the canaliculus's own rhythm: it squeezes shut and opens again every twenty or thirty minutes, and a lesion
 *  that constricts it stops the rhythm dead and leaves it narrow */
fn canalTone(ci: u32) -> f32 {
  let phase = G.canalPhase + hash11(f32(ci) * 0.77) * 6.283;
  let pulse = 0.5 + 0.5 * sin(phase);
  let open = mix(0.78 + 0.26 * pulse, 0.30, sat(G.constrict * cellFate(ci)));
  return open;
}
