// The aurora (world/aurora.ts): curtains of light 95-400 km up, each a ribbon — a long strip following a folded line
// across the sky along the magnetic east-west, standing on its sharp lower edge and rising along the field lines (the
// earth's curve included, so a far arc sits low on the northern horizon). The ribbons are drawn straight into the
// scene where the sky shows (additive, behind everything: `vs`), and the same ribbons into a small dome map of the sky
// (`vsDome`, polar, the zenith in the middle) that reflections and the light on the ground read (world.wgsl).
// Each fragment: the emission at its altitude, in the show's colours (world/clock.ts) — a teal hem going green up the
// body, violet above it, a magenta crown at the top, the hem flaring pink in a surge — striped with field-aligned rays
// that slide along the curtain and flicker, in patches that pulse, times the path through a thin sheet (brightest where
// it folds edge-on to the eye), through the air in front. By day (AU.teal.w) the veil: its rays smoothed away, its
// sheets soft. The CPU sets each curtain's place, brightness and motion (the substorms' surges included).
#include "./world.wgsl"

struct Curtain {
  a: vec4f,   // x distance north of the site (km), y brightness, z seed, w the surge's share
  b: vec4f,   // x fold amplitude, y fold wave speed (summed into p.y), z ray speed (km/s, into p.x), w lower edge (km)
  p: vec4f,   // how far its motions have gone (summed on the CPU): x rays slid (km), y folds' time, z fine rays' time, w flicker's time
}
struct AuroraU {
  frame: vec4f,     // xy magnetic east in the world's xz, zw magnetic north
  clock: vec4f,     // x the aurora's clock (s), y surge (0 quiet .. 1 a substorm's peak), z expansion, w brightness
  shape: vec4f,     // x height scale, y rays (0 smooth .. ), z folds, w sheet thickness (the edge-on brightening's cap)
  teal: vec4f,      // rgb the hem's colour; w how much it's the day's veil (0 night .. 1 day)
  green: vec4f,     // rgb the body's colour; w the arcs' half-length (km)
  violet: vec4f,    // rgb the band above the body
  crown: vec4f,     // rgb the crown at the top
  hem: vec4f,       // rgb the hem's flare in a surge
  curtains: array<Curtain, 6>,
}
@group(2) @binding(0) var<uniform> AU: AuroraU;

// columns per ribbon, ribbons per curtain (a fainter second sheet behind each)
const COLS = 1024u;
const LAYERS = 2u;
const R_EARTH = 6360.0;
// the oval's radius of curvature (km)
const OVAL = 2600.0;

struct RibbonOut {
  @builtin(position) pos: vec4f,
  @location(0) along: f32,                         // km along the arc (from the site)
  @location(1) alt: f32,                           // km above sea level
  @location(2) rel: vec3f,                         // from the camera (km, world axes)
  @location(3) nrm: vec3f,                         // the sheet's horizontal normal
  @location(4) @interpolate(flat) k: u32,          // the curtain
  @location(5) @interpolate(flat) layer: f32,      // 0 the front sheet, 1 the one behind
  @location(6) ends: f32,                          // how much of the arc is left here (it fades toward its ends)
  @location(7) broad: f32,                         // how squarely the arc (its line, not its folds) faces the camera
  @location(8) @interpolate(flat) dome: f32,       // 1 drawn into the dome map, 0 into the scene
}

fn h11(x: f32) -> f32 { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
// value noise along a line (smooth, 0..1)
fn vn(x: f32) -> f32 {
  let i = floor(x);
  let f = fract(x);
  return mix(h11(i), h11(i + 1.0), f * f * (3.0 - 2.0 * f));
}

// the curtain's line: how far north of its mean place it runs at a point along the arc (km): long meanders, folds,
// and the small curls that wind up in a surge, all travelling along it
fn fold(c: Curtain, a: f32, layer: f32) -> f32 {
  let t = c.p.y;
  let s = c.a.z * 37.0 + layer * 1.3;
  var y = sin(a * 0.0041 + s + t * 0.011) * 30.0 + sin(a * 0.0113 - s * 1.7 - t * 0.027) * 15.0;
  // (drapery: rounded waves whose phase and size wander along the arc, never a random zigzag)
  let ph = 6.2832 * vn(a * 0.0043 + s * 2.3);
  y += sin(a * 0.105 + s * 3.1 + t * 0.22 + ph) * 10.0 * (0.4 + 0.9 * vn(a * 0.011 + s)) + sin(a * 0.047 - s + t * 0.1) * 7.0;
  y += sin(a * 0.31 + s * 5.3 - t * 0.68 + 2.0 * ph) * 3.5 * (0.35 + AU.clock.z) * vn(a * 0.023 - s);
  return y * c.b.x;
}

// a point of a ribbon: its place from the camera (km) and the sheet's normal there
struct RibbonPoint { rel: vec3f, nrm: vec3f, along: f32, alt: f32, ends: f32, broad: f32 }

fn ribbonPoint(vi: u32, ii: u32) -> RibbonPoint {
  let k = ii / LAYERS;
  let layer = f32(ii % LAYERS);
  let c = AU.curtains[k];
  let east = vec3f(AU.frame.x, 0.0, AU.frame.y);
  let north = vec3f(AU.frame.z, 0.0, AU.frame.w);
  // the camera's place along and across the arcs (km from the site)
  let camA = dot(frame.camPos.xz, AU.frame.xy) * 0.001;
  let camN = dot(frame.camPos.xz, AU.frame.zw) * 0.001;
  // the columns: dense where the arc passes the camera, sparse far off where it's small
  let u = f32(vi / 2u) / f32(COLS - 1u) * 2.0 - 1.0;
  // (each arc bends round its own radius — but never so tightly that it turns edge-on to the camera less than 1300 km
  // off: a near arc runs from horizon to horizon, and wherever an arc does turn it's low on the horizon, never a wall
  // of curtain standing in mid-sky; it runs on past the turn, its far side sinking below the horizon)
  let cN = max(c.a.x + 40.0 - camN, 40.0);
  let oval = max(OVAL * (0.75 + 0.5 * fract(c.a.z * 7.31)), 1300.0 * 1300.0 / (2.0 * cN));
  let half = max(AU.green.w, 1.7 * sqrt(2.0 * oval * cN));
  let a = camA + half * sign(u) * pow(abs(u), 1.6);
  // (the arcs follow the oval round the magnetic pole: they bend poleward off to the east and west, and sink; far off
  // along the arc its folds flatten out — seen from near its end every fold would turn edge-on and stand as a cut-out
  // edge, stepping down to the horizon — so it narrows away smoothly)
  let flat = mix(0.25, 1.0, smoothstep(600.0, 120.0, abs(a - camA)));
  let n = c.a.x + layer * 7.0 + fold(c, a, layer) * flat + a * a / (2.0 * oval);
  let slope = (fold(c, a + 0.5, layer) - fold(c, a - 0.5, layer)) * flat + a / oval;
  // (the strip starts well under the lower edge, where the softened edge's foot fades in)
  let base = c.b.w - 12.0;
  let top = c.b.w + 300.0 * AU.shape.x;
  let alt = select(base, top, (vi & 1u) == 1u);
  // on the earth's sphere (the camera's local frame: y up), lifted along the vertical
  let camR = R_EARTH + altitudeKm(frame.camPos);
  let g = normalize(vec3f(0.0, R_EARTH, 0.0) + east * (a - camA) + north * (n - camN));
  var p: RibbonPoint;
  p.rel = g * (R_EARTH + alt) - vec3f(0.0, camR, 0.0);
  p.nrm = normalize(north - east * slope);
  p.along = a;
  p.alt = alt;
  // (its far ends fade, below the horizon; and an arc north of the camera fades out over the last 12 degrees before
  // the point where it turns edge-on — seen from there all of its far side crowds into those degrees)
  let da = max(abs(a - camA), 1.0);
  let turnAt = atan(2.0 * cN / sqrt(2.0 * oval * cN));
  let above = atan2(max(n - camN, 0.0), da);
  p.ends = smoothstep(half, 0.7 * half, da) * mix(1.0, smoothstep(turnAt, turnAt + 0.21, above), smoothstep(0.0, 80.0, c.a.x - camN));
  p.broad = abs(dot(normalize(north - east * (a / oval)), normalize(vec3f(p.rel.x, 0.0, p.rel.z) + vec3f(1e-5, 0.0, 0.0))));
  return p;
}

fn ribbonOut(p: RibbonPoint, ii: u32, pos: vec4f, dome: f32) -> RibbonOut {
  var o: RibbonOut;
  o.pos = pos;
  o.dome = dome;
  o.along = p.along;
  o.alt = p.alt;
  o.rel = p.rel;
  o.nrm = p.nrm;
  o.k = ii / LAYERS;
  o.layer = f32(ii % LAYERS);
  o.ends = p.ends;
  o.broad = p.broad;
  return o;
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> RibbonOut {
  let p = ribbonPoint(vi, ii);
  // (at the far plane: only where nothing else was drawn)
  let clip = frame.viewProj * vec4f(frame.camPos + p.rel * 1000.0, 1.0);
  return ribbonOut(p, ii, vec4f(clip.xy, 0.0, clip.w), 0.0);
}

// the dome map: the zenith in the middle, the horizon round the edge (world.wgsl's auroraDomeUv)
@vertex fn vsDome(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> RibbonOut {
  let p = ribbonPoint(vi, ii);
  let d = normalize(p.rel);
  let r = acos(clamp(d.y, -1.0, 1.0)) / (PI * 0.5);
  let q = normalize(vec2f(d.x, d.z) + vec2f(1e-6, 0.0)) * r;
  return ribbonOut(p, ii, vec4f(q.x, -q.y, 0.0, 1.0), 1.0);
}

// the rays along an arc: field-aligned streaks, each in its own cell of the line (a few km), at its own place in it,
// its own width and its own brightness, which wanders over a few seconds; widened to at least a pixel (fw: km per
// pixel) with their light kept, so far off they blend into a glow instead of shimmering
fn rayComb(x: f32, cell: f32, t: f32, seed: f32, fw: f32) -> f32 {
  let ci = floor(x / cell);
  var sum = 0.0;
  for (var j = -1; j <= 1; j++) {
    let c = ci + f32(j);
    let h = h11(c * 1.37 + seed);
    let centre = (c + 0.15 + 0.7 * h) * cell;
    let w = cell * (0.08 + 0.22 * h11(c * 2.71 + seed * 1.9));
    let ww = max(w, fw * 0.8);
    let tt = t * (0.25 + 0.5 * h) + h * 9.0;
    let amp = mix(h11(c * 3.1 + floor(tt) + seed), h11(c * 3.1 + floor(tt) + 1.0 + seed), smoothstep(0.0, 1.0, fract(tt)));
    let d = (x - centre) / ww;
    sum += amp * amp * exp(-d * d) * (w / ww);
  }
  return sum;
}

@fragment fn fs(i: RibbonOut) -> @location(0) vec4f {
  let c = AU.curtains[i.k];
  let t = AU.clock.x;
  let surge = AU.clock.y * c.a.w;
  let H = AU.shape.x;
  let s = c.a.z * 91.7 + i.layer * 17.0;
  let fw = max(fwidth(i.along), 1e-4);
  // (a tall sheet seen along its arc, toward the point on the horizon the arcs run to, keeps only its lower part, and
  // so does an arc toward where it fades out: the tops' envelope slants down to the hem there instead of the curtain
  // stopping at a straight edge)
  let topK = mix(0.12, 1.0, smoothstep(0.02, 0.5, i.broad)) * mix(0.12, 1.0, smoothstep(0.05, 0.9, i.ends));
  // (nothing to add where the arc has faded out, under its softened edge or over its top)
  let x0 = i.alt - c.b.w;
  if (i.ends < 0.002 || x0 < -9.0 || x0 > 300.0 * H * topK) { return vec4f(0.0); }
  // the rays slide along the arc (faster in a surge): fine ones and broader ones, gathered in bundles that come and
  // go, over a glow that's always there (a veil with streaks in it, not a comb)
  let ax = i.along - c.p.x;
  let fine = rayComb(ax, 4.0, c.p.z, s, fw);
  let wide = rayComb(ax * 0.35 + 50.0, 4.0, t * 0.4, s + 3.0, fw * 0.35);
  let bundles = smoothstep(0.1, 0.8, vn(ax * 0.018 + s));
  let R = (fine * 0.9 + wide * 1.1) * (0.4 + 0.9 * bundles);
  // (rays seen along the arc far off would crowd into a barcode of stripes: there they're softer; the day's veil has
  // none)
  let dayK = AU.teal.w;
  let m = mix(1.0, 0.6 + 2.0 * R, AU.shape.y * mix(0.35, 1.0, smoothstep(0.05, 0.6, i.broad)) * (1.0 - 0.85 * dayK));
  // emission by altitude: the sharp lower edge and the body's glow above it — tall, the show's broad ribbons — the rays
  // streaming higher (ragged, some further than others), violet above, a diffuse magenta crown at the top, all gone
  // before the ribbon ends
  let base = c.b.w;
  let x = max(i.alt - base, 0.0);
  // (a far arc's hem is softer: its few km would be a hard line under a pixel there; the day's veil has no hard hem)
  let soft = min(1.0 + length(i.rel) * 0.003, 3.0) * (1.0 + 8.0 * dayK);
  let edge = smoothstep(base - 1.8 * soft, base + 0.6, i.alt);
  let topH = (55.0 + 100.0 * wide * (0.5 + bundles)) * H;
  // (the body comes up over a few km above the sharp edge, so the edge reads as the curtain's hem, not a glowing line)
  let rise = 1.0 - exp(-(x + 0.3) / ((0.8 + 6.0 * dayK) * H));
  // (brightest in its lowest few km, the more so in a surge: the substorm's light is in the hem)
  let hem = 1.0 + (2.0 + 1.5 * surge) * exp(-x / (1.8 * H)) * (1.0 - 0.8 * dayK);
  let sheet = 0.85 * rise * exp(-x / (45.0 * H)) * hem;
  let streamer = rise * exp(-x / max(topH, 1.0));
  let cap = smoothstep(300.0 * H * topK, 200.0 * H * topK, x);
  let green = edge * (sheet * (0.55 + 0.45 * m) + streamer * m * 0.55 * AU.shape.y);
  let vz = (x - (135.0 + 30.0 * bundles) * H) / (45.0 * H);
  let violet = edge * exp(-vz * vz) * (0.3 + 0.7 * streamer * m) * 0.13;
  // (the crown's glow high up is diffuse: barely striated, and less of a sheet — its folds don't flare; against the
  // day's teal sky it's the veil's magenta edge)
  let crown = smoothstep(110.0 * H, 175.0 * H, x) * exp(-max(x - 175.0 * H, 0.0) / (60.0 * H)) * (0.09 + 0.16 * surge) * (0.85 + 0.15 * m) * (1.0 + 1.5 * dayK);
  // (the hem's flare: under the body as it comes up, in strong surges)
  let pink = edge * exp(-x / (3.0 * soft)) * (0.015 + 0.12 * surge * surge) * (0.7 + 0.3 * m);
  // the path through the sheet: face on it's thin, edge on (a fold, or an arc seen along its length) it's long —
  // capped by the sheet's thickness, and more the farther it is (a far arc's sheet is broken up by its rays and folds,
  // so an arc seen end-on far off glows instead of standing up as a wall); the diffuse violet and red glow less of a
  // sheet still
  let v = normalize(i.rel);
  let nv = dot(normalize(i.nrm), v);
  let dist = length(i.rel);
  let th = mix(max(AU.shape.w, 0.12), 0.45, dayK);
  let eps2 = th * th + dist * dist / 1.5e6;
  let path = 1.0 / sqrt(nv * nv + eps2);
  // (the body teal at its hem, green higher up)
  let body = mix(AU.teal.rgb, AU.green.rgb, smoothstep(1.0, 40.0 * H, x));
  let col = (body * green + AU.hem.rgb * pink) * path + AU.violet.rgb * violet * pow(path, 0.6) * 1.6 + AU.crown.rgb * crown * pow(path, 0.35) * 2.4;
  // patches along the arc that drift and swell, waves of brightness running along it in a surge, a slow flicker
  // (and the arc isn't whole: it breaks into stretches hundreds of kilometres long, with gaps between)
  // (seen along the arc, toward where the arcs run to the horizon, hundreds of km of it crowd into a few degrees: there
  // what changes along it — the stretches and gaps, the waves, the pulsing patches — evens out, or each change would
  // stand as a vertical edge)
  let broadside = smoothstep(0.05, 0.6, i.broad);
  let patches = mix(0.55, (0.3 + 0.7 * smoothstep(0.2, 0.8, vn(i.along * 0.0065 + s + t * 0.005))) * smoothstep(0.22, 0.5, vn(i.along * 0.0021 + s * 3.0 + t * 0.0015)), broadside);
  let wave = 1.0 + broadside * surge * 0.8 * pow(max(sin(i.along * 0.018 - t * 1.1 - c.p.y * 0.3 + s), 0.0), 4.0);
  // pulsating patches (each tens of km, fading in and out at its ends, blinking on a cycle of its own, 2-10 s) and, in
  // a surge, flaming: waves of light running up the green rays a couple of times a second
  let pc = floor(i.along / 45.0);
  let pf = fract(i.along / 45.0);
  let pp = h11(pc * 3.7 + s);
  let pulse = 1.0 + broadside * (0.12 + 0.3 * surge) * smoothstep(0.35, 1.0, sin(t * (0.6 + 2.5 * pp) + pp * 6.2832)) * step(0.55, h11(pc + s * 1.3)) * smoothstep(0.0, 0.3, pf) * smoothstep(1.0, 0.7, pf);
  let flame = 1.0 + 0.7 * surge * pow(max(sin(x * 0.16 - t * 9.0 + 6.2832 * vn(ax / 12.0 + s)), 0.0), 6.0) * smoothstep(5.0, 30.0, x) * smoothstep(130.0 * H, 70.0 * H, x);
  let flick = 0.85 + 0.15 * vn(i.along * 0.021 + c.p.w + s * 0.3);
  // the air in front: a low arc reddens and dims toward the horizon
  // (from up among the curtains or over them there's no air in front)
  let camAlt = altitudeKm(frame.camPos);
  let tr = mix(transmittanceToSpace(camAlt, v.y), vec3f(1.0), smoothstep(60.0, 100.0, camAlt));
  // (and seen along it, beyond the nearest hundred km, the arc thins away: toward the point on the horizon the arcs run
  // to, their tall rayed sheets crowd into a narrow wedge whose straight edge would stand as a bright slab)
  let thin = mix(1.0, 0.2, (1.0 - broadside) * smoothstep(100.0, 600.0, dist));
  let b = c.a.y * (1.0 - 0.5 * i.layer) * AU.clock.w * thin;
  // (by day the curtains themselves only hint at their folds: the veil is mostly their glow, the dome map blurred in
  // the sky behind them — sky.wgsl)
  let veil = mix(1.0, 0.12, dayK * (1.0 - i.dome));
  return vec4f(col * cap * patches * wave * flick * pulse * flame * i.ends * tr * b * veil, 0.0);
}
