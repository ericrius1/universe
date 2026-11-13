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
  fieldHalf: f32, spare0: f32, spare1: f32, spare2: f32,
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

const C_CYTO = vec3f(0.723, 0.171, 0.051);   // #dd7340
const C_CYTO_HI = vec3f(0.888, 0.386, 0.181);   // #f2a776
const C_RIM = vec3f(1.000, 0.871, 0.392);   // #fff0a8
const C_NUC = vec3f(0.202, 0.122, 0.644);   // #7c62d2
const C_NUCLEOLUS = vec3f(0.102, 0.050, 0.456);   // #5a3fb4
const C_MITO = vec3f(0.807, 0.093, 0.023);   // #e8562a
const C_MITO_OFF = vec3f(0.342, 0.275, 0.262);   // #9e8f8c
const C_ER = vec3f(0.863, 0.323, 0.091);   // #ef9a55
const C_GOLGI = vec3f(0.723, 0.159, 0.371);   // #dd6fa4
const C_LYSO = vec3f(0.366, 0.114, 0.658);   // #a35fd4
const C_LAMELLAR = vec3f(0.571, 0.456, 0.855);   // #c7b4ee
const C_PEROX = vec3f(0.050, 0.479, 0.309);   // #3fb897
const C_LIPID = vec3f(0.922, 0.624, 0.045);   // #f6cf3c
const C_GLYC = vec3f(0.716, 0.371, 0.162);   // #dca470
const C_BILE = vec3f(0.014, 0.694, 0.254);   // #1fd98a
const C_BILE_OFF = vec3f(0.479, 0.323, 0.023);   // #b89a2a
const C_FEEDER = vec3f(0.114, 0.216, 0.624);   // #5f80cf
const C_FLOOR = vec3f(0.776, 0.716, 0.658);   // #e4dcd4
const C_HARM = vec3f(0.539, 0.023, 0.016);   // #c22a22
const C_DEAD = vec3f(0.270, 0.242, 0.296);   // #8e8794
const C_DNA = vec3f(0.016, 0.687, 0.624);   // #22d8cf

/** the air: near-white in the bright register, nothing at all in fluorescence */
fn airColor() -> vec3f {
  let warm = vec3f(1.02, 0.985, 0.955);
  return mix(warm, vec3f(0.004, 0.006, 0.014), G.mode);
}

fn air(c: vec3f, wp: vec3f) -> vec3f {
  let d = distance(wp, frame.camPos);
  let f = 1.0 - exp(-d * G.fogK);
  return mix(c, airColor(), f * (1.0 - G.mode * 0.88));
}

/** soft lighting: a key from above, a wide wrap as if the light came through the thing itself, a rim at the edge */
fn lit(base: vec3f, n: vec3f, wp: vec3f, gloss: f32, emis: f32) -> vec3f {
  let L = unit(G.sun);
  let V = unit(frame.camPos - wp);
  let ndl = dot(n, L);
  let wrap = sat((ndl + 0.72) / 1.72);
  let fres = pow(1.0 - sat(dot(n, V)), 2.6);
  var c = base * (0.24 + 0.74 * wrap);
  c += base * fres * 0.42;
  let h = unit(L + V);
  c += vec3f(1.0) * pow(max(dot(n, h), 0.0), 48.0) * 0.14 * gloss;
  c += base * emis;
  // in the fluorescence register nothing is lit — a thing is only as bright as the dye in it
  return mix(c, base * (0.25 + emis * 2.4), G.mode);
}

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
