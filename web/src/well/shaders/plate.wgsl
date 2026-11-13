// The plate: a hundred and twenty-eight millimetres by eighty-five, eight rows by twelve columns, nine millimetres
// between centres. Everything about how a screen is laid out follows from this rectangle — one compound down each
// column, a dilution series across the rows, and nothing at all in the last row so you have something to compare
// against. The plate is laid out in millimetres, the scale you stand back from, and put into the world's micrometres
// as it's drawn: the world's origin is wherever it's floating (the chosen well's floor, or the camera when the field is
// out of sight), so `shift` is where the plate's own origin is from there, worked out on the processor in doubles.
//
// It's drawn as it photographs: clear polystyrene on a black bench under one soft light (lab.wgsl). The plastic shows
// the bench through itself and the light in itself, its rounded edges and the lips of its bores catching the panel
// overhead (plastic meeting air: the one place a highlight belongs); each well a few millimetres of pink medium that
// colours what's seen through it, its surface curving up the wall and giving back the light. The cells on a well's
// floor can't be seen by eye at all: what's on the floor seen from over the plate is the medium's colour and the bench
// under the clear bottom. Down in the medium the chosen well's floor is the painted field of cells (and the optics'
// picture of it, instrument.wgsl), giving way to the real ones as they come.
#include "./lab"

fn hueColor(h: f32) -> vec3f {
  let a = h * 6.2831853;
  return 0.5 + 0.42 * vec3f(cos(a), cos(a - 2.094), cos(a + 2.094));
}

// --------------------------------------------------------------------------------------------- the slab

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,
  @location(3) @interpolate(flat) id: u32,
  // the plate's own millimetres, which everything laid out on it is worked out in
  @location(4) mp: vec3f,
}

struct FOut { @location(0) color: vec4f, @location(1) pick: u32 }

@vertex fn vs_body(@builtin(vertex_index) vi: u32) -> VOut {
  let face = vi / 6u;
  let q = array<vec2f, 6>(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(-1,1), vec2f(1,-1), vec2f(1,1))[vi % 6u];
  let ax = face / 2u;
  let s = select(1.0, -1.0, (face & 1u) == 1u);
  var n = vec3f(0.0); var t = vec3f(0.0); var b = vec3f(0.0);
  if (ax == 0u) { n = vec3f(s, 0.0, 0.0); t = vec3f(0.0, 0.0, -s); b = vec3f(0.0, 1.0, 0.0); }
  else if (ax == 1u) { n = vec3f(0.0, s, 0.0); t = vec3f(1.0, 0.0, 0.0); b = vec3f(0.0, 0.0, -s); }
  else { n = vec3f(0.0, 0.0, s); t = vec3f(s, 0.0, 0.0); b = vec3f(0.0, 1.0, 0.0); }
  let half = vec3f(PLATE_HALF.x, P.depth * 0.5, PLATE_HALF.y);
  let p = vec3f(0.0, -P.depth * 0.5, 0.0) + (n + t * q.x + b * q.y) * half;
  var o: VOut;
  o.mp = p; o.wp = toWorld(p); o.n = n; o.uv = q; o.id = 0u;
  o.pos = frame.viewProj * vec4f(o.wp, 1.0);
  return o;
}

/** Fresnel for a surface in air (or water) from the cosine to the eye */
fn schlick(f0: f32, c: f32) -> f32 { return f0 + (1.0 - f0) * pow(1.0 - sat(c), 5.0); }

@fragment fn fs_body(i: VOut) -> FOut {
  var o: FOut;
  let mp = i.mp;
  let R = P.bore * 0.5;
  let top = i.n.y > 0.5;
  // the ninety-six bores are holes in the top face, not paint on it
  var dw = 99.0;
  var wc = vec2f(0.0);
  if (top) {
    wc = nearestWell(mp.xz);
    dw = distance(mp.xz, wc);
    if (dw < R) { discard; }
  }
  let rd = unit(i.wp - frame.camPos);
  // the moulding's edges are rounded (a millimetre): the normal of a rounded box, which bends over that last
  // millimetre, so the edges and corners catch the panel and the faces between them don't
  let half = vec3f(PLATE_HALF.x, P.depth * 0.5, PLATE_HALF.y);
  let q = mp - vec3f(0.0, -P.depth * 0.5, 0.0);
  var n = unit(q - clamp(q, -(half - 1.0), half - 1.0));
  // and so are the bores' lips, half a millimetre over into the hole
  if (top) {
    let lip = 1.0 - smoothstep(R, R + 0.55, dw);
    n = unit(mix(n, vec3f((wc - mp.xz).x, 0.0, (wc - mp.xz).y) / max(dw, 1e-3), lip * 0.75));
  }
  let c = dot(n, -rd);
  let F = schlick(0.052, c);
  let refl = roomSeen(mp, reflect(rd, n), 0.12) + panelGloss(mp, reflect(rd, n), 60.0);
  // what's seen through it: the bench under the plate (in the plate's own light), from the top through two faces of
  // clear plastic and the moulding's web; from a side, the inside of the moulding and the wells' pink beyond it
  var behind: vec3f;
  if (top) {
    let pb = mp + rd * ((BENCH_Y - mp.y) / min(rd.y, -0.05));
    behind = benchColor(pb, rd) * 0.62;
  } else {
    behind = labSeen(mp, rd) * 0.35 + panelLight(mp) * 0.012 * vec3f(1.0, 0.45, 0.55);
  }
  // (polystyrene isn't milky, but a moulding scatters a little of the light in it)
  var col = refl * F + behind * (1.0 - F) + panelLight(mp) * 0.0035;
  col = air(col, i.wp);
  o.color = vec4f(safe(col * G.dim), 1.0);
  o.pick = (19u << 20u);
  return o;
}

// --------------------------------------------------------------------------------------------- the wells

const SEG = 28u;
/** how high it climbs the wall (mm) over how wide a band */
const CLIMB = 0.75;
const CLIMB_W = 0.55;

/** the meniscus's height over its middle at a distance r (mm) from the well's axis, and its slope */
fn menH(r: f32) -> f32 { return CLIMB * exp(-(P.bore * 0.5 - r) / CLIMB_W); }
fn menSlope(r: f32) -> f32 { return menH(r) / CLIMB_W; }

@vertex fn vs_well(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let c = wellCentre(ii);
  let R = P.bore * 0.5;
  let top = 0.0;
  let bottom = -P.depth * 0.80;
  let liquid = bottom + (top - bottom) * P.fill;
  var p = vec3f(0.0);
  var n = vec3f(0.0, 1.0, 0.0);
  var uv = vec2f(0.0);

  let wallVerts = SEG * 6u;
  let discVerts = SEG * 3u;
  let quad = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1));
  if (vi < wallVerts) {
    // the bore's wall
    let k = vi / 6u;
    let pick = quad[vi % 6u];
    let a = mix(f32(k), f32(k + 1u), pick.x) / f32(SEG) * 6.2831853;
    let y = mix(bottom, top, pick.y);
    p = vec3f(c.x + cos(a) * R, y, c.y + sin(a) * R);
    n = vec3f(-cos(a), 0.0, -sin(a));
    uv = vec2f(pick.x, pick.y);
  } else if (vi < wallVerts + discVerts) {
    // the floor of the well, where the cells are (all the way to the wall: no gap at its foot to see through)
    let k = (vi - wallVerts) / 3u;
    let j = (vi - wallVerts) % 3u;
    let a0 = f32(k) / f32(SEG) * 6.2831853;
    let a1 = f32(k + 1u) / f32(SEG) * 6.2831853;
    if (j == 0u) { p = vec3f(c.x, bottom, c.y); }
    else if (j == 1u) { p = vec3f(c.x + cos(a0) * R, bottom, c.y + sin(a0) * R); }
    else { p = vec3f(c.x + cos(a1) * R, bottom, c.y + sin(a1) * R); }
    uv = vec2f(0.0, 0.0);
    n = vec3f(0.0, 1.0, 0.0);
  } else {
    // the meniscus: the top of the medium, curving up the wall, in rings (a fan in the middle, quads out to the wall)
    let m = vi - wallVerts - discVerts;
    let k = (m / 30u) % SEG;
    let j = m % 30u;
    // (its rings, as fractions of the bore's radius)
    var rings = array<f32, 6>(0.0, 0.45, 0.7, 0.85, 0.94, 1.0);
    var ring = 0u; var pick = vec2f(0.0);
    if (j < 3u) { pick = array<vec2f, 3>(vec2f(0.0, 0.0), vec2f(0.0, 1.0), vec2f(1.0, 1.0))[j]; }
    else { ring = 1u + (j - 3u) / 6u; pick = quad[(j - 3u) % 6u]; }
    let rr = select(rings[ring] + (rings[min(ring + 1u, 5u)] - rings[ring]) * pick.y, rings[1] * pick.y, ring == 0u) * R * 0.999;
    let a = mix(f32(k), f32(k + 1u), pick.x) / f32(SEG) * 6.2831853;
    p = vec3f(c.x + cos(a) * rr, liquid + menH(rr), c.y + sin(a) * rr);
    uv = vec2f(0.0, 1.0);
    n = vec3f(0.0, 1.0, 0.0);
  }

  // the chosen well's floor stands a little proud of the field's collagen under it, and while its picture is still laid
  // over the cells, above them too (a few tens of micrometres: nothing, from where that can be seen)
  if (i32(ii) == i32(P.chosen) && vi >= wallVerts && vi < wallVerts + discVerts) { p.y += P.lift / P.unit; }
  var o: VOut;
  o.mp = p; o.wp = toWorld(p); o.n = n; o.uv = uv; o.id = ii;
  o.pos = frame.viewProj * vec4f(o.wp, 1.0);
  return o;
}

/** the painted field's look and its optics: the colour of the modelled view, and what the instrument reads (optical
 *  path through it, haematoxylin, PAS: instrument.wgsl) */
struct Painted { col: vec3f, optic: vec3f }

/** the chosen well's floor as the real cells look from a few millimetres up (field.wgsl), painted: the same cells at
 *  their own size, the feeders' lawn round the hepatocytes' islands in the co-culture, the pillows laid over the
 *  collagen as they are — so the cells that take over from the picture are the colour it was, and read the same in the
 *  instrument. `q` is the point from the well's middle (µm), `g` the same in cells and `fw` its change across a pixel
 *  (worked out before any branch: where a cell is under a few pixels, its average) */
fn paintedField(q: vec2f, g: vec2f, fw: f32, wp: vec3f, live: f32) -> Painted {
  let gi = floor(g);
  var f1 = 9.0; var f2 = 9.0; var id = gi;
  for (var yy = -1; yy <= 1; yy++) {
    for (var xx = -1; xx <= 1; xx++) {
      let o2 = gi + vec2f(f32(xx), f32(yy));
      // (jittered a third of a cell either way, as world/field.ts lays the sites)
      let pt = o2 + 0.5 + (vec2f(hash21(o2), hash21(o2 + 19.1)) - 0.5) * 0.66;
      let d = length(pt - g);
      if (d < f1) { f2 = f1; f1 = d; id = o2; } else if (d < f2) { f2 = d; }
    }
  }
  // the islands: a field over about three cells, hepatocytes in them, feeders between (the co-culture's only)
  let isl = noise3(vec3f(id / 3.1, 1.7)) * 0.65 + noise3(vec3f(id / 1.6, 4.2)) * 0.35;
  let hep = G.feeders < 0.5 || (isl - 0.34) * 2.6 > 0.08;
  let up = vec3f(0.0, 1.0, 0.0);
  let cs = max(G.cellSize, 1.0);
  // the pillow's height: none in the groove (the micrometre either side of the border), rising to its apex
  let border = (f2 - f1) * cs * 0.5;
  let t = sat((border - 1.0) / (0.45 * cs));
  // (a cell's mean radius is about 0.55 of the grid's pitch, as world/field.ts's Voronoi cells come out)
  let hmax = select(0.55 * cs * 0.17, 0.55 * cs * 0.86 / max(G.spread, 0.5), hep) * mix(0.3, 1.0, live);
  let h = select(0.0, hmax * (0.13 + 0.87 * pow(sin(t * 1.5708), 0.68)), border > 1.0);
  // a nucleus in the middle (a nucleolus in it)
  let nr = 0.17 * cs;
  let fr = f1 * cs;
  let chordN = 2.0 * sqrt(max(nr * nr - fr * fr, 0.0)) * select(0.0, 1.0, hep);
  let nl = distance(g, id + 0.5 + vec2f(0.05, -0.04)) * cs;
  let chordNl = 2.0 * sqrt(max(1.1 - nl * nl, 0.0)) * select(0.0, 1.0, hep);
  let glyc = 1.0 - sat(G.atpLoss * 1.3 + G.swell * 0.7);
  var opt = vec3f(0.035 * h - 0.008 * chordN + 0.05 * chordNl, 0.12 * chordN + 0.2 * chordNl, select(0.012, 0.06 * glyc, hep) * h);
  // the modelled view's colour: the light through the pillow on the dim collagen
  var base = select(C_FEEDER, C_CYTO, hep);
  base = mix(base, C_DEAD, (1.0 - live) * 0.6);
  let floorLit = C_FLOOR * 0.1;
  let slant = 1.0 / max(abs(unit(frame.camPos - wp).y), 0.35);
  var cell = through(base, h * slant, 8.0, up, vec3f(0.34, 0.31, 0.29));
  cell = mix(cell, through(C_NUC, chordN, 6.0, up, vec3f(0.26, 0.24, 0.24)), sat(chordN / 3.0) * 0.6);
  let sharp = mix(floorLit, cell, select(0.0, 0.85, h > 0.0));
  // (the average of all that, for a cell under a few pixels: no shimmer)
  let hepShare = select(1.0, 0.72, G.feeders > 0.5);
  let mb = mix(C_FEEDER, C_CYTO, hepShare);
  let mean = mix(floorLit, through(mix(mb, C_DEAD, (1.0 - live) * 0.6), 6.0, 8.0, up, vec3f(0.30, 0.27, 0.25)), 0.8);
  let meanOpt = vec3f(0.035 * 0.6 * hmax, 0.12 * nr * 0.2, select(0.012, 0.06 * glyc, hep) * hmax * 0.6);
  let k = smoothstep(0.25, 0.6, fw);
  var o: Painted;
  o.col = mix(sharp, mean, k);
  // in fluorescence: the nuclei's Hoechst, a mitochondrial dye's glow through the cytoplasm, the canalicular dye in
  // the grooves (field.wgsl, organelles.wgsl, stage.wgsl, as the real cells show them)
  let fl = vec3f(0.22, 0.38, 1.0) * G.stain.x * sat(2.0 * sqrt(max(nr * nr - fr * fr, 0.0)) / 2.0) * select(0.45, 0.8, hep)
    + vec3f(1.0, 0.54, 0.24) * G.stain.y * (1.0 - G.depol) * sat(h / max(hmax, 0.1)) * 0.12 * select(0.0, 1.0, hep)
    + vec3f(0.3, 1.0, 0.76) * G.stain2.x * select(0.0, 0.25, border < 1.0 && hep)
    + vec3f(0.025, 0.03, 0.05) * sat(h);
  o.col = mix(o.col, mix(fl, vec3f(0.04, 0.07, 0.18) * G.stain.x + vec3f(0.06, 0.03, 0.01) * G.stain.y, k), G.mode);
  o.optic = mix(opt, meanOpt, k);
  return o;
}

struct WOut { @location(0) color: vec4f, @location(1) pick: u32, @location(2) optic: vec4f }

/** what's left of the light along a path through the medium, from where it is to the eye (or to its surface, the eye
 *  being over it), and the medium's own glow on that path */
fn mediumPath(mp: vec3f, rd: vec3f, surface: f32) -> f32 {
  let e = toPlate(frame.camPos);
  if (e.y < surface) { return distance(e, mp); }
  return max(surface - mp.y, 0.0) / max(-rd.y, 0.08);
}

@fragment fn fs_well(i: VOut) -> WOut {
  var o: WOut;
  let w = wells[i.id];
  let c = wellCentre(i.id);
  let R = P.bore * 0.5;
  // (the painted field's cells and their size on the screen, here where every fragment still runs)
  let fq = (i.mp.xz - c) * P.unit;
  let fg = fq / max(G.cellSize, 1.0);
  let ffw = length(fwidth(fg));
  let rd = unit(i.wp - frame.camPos);
  let hot = w.v.w;
  let liquid = -P.depth * 0.80 * (1.0 - P.fill);
  let r = distance(i.mp.xz, c);
  let surface = liquid + menH(min(r, R));
  let chosen = i32(i.id) == i32(P.chosen);
  let E = panelLight(i.mp);

  var col: vec3f;
  var alpha = 1.0;
  var optic = vec4f(0.0);
  if (i.uv.y > 0.99 && i.n.y > 0.5) {
    // the medium's surface, curving up the wall: it gives back the room (the panel, a bright crescent where it climbs
    // the wall), a few percent face on, nearly all of it at a grazing angle; under it, what's seen through it is
    // dimmed by as much. A tremor in it (the bench is never quite still), seen only close to
    let rv = (i.mp.xz - c) / max(r, 1e-4);
    var n = unit(vec3f(-rv.x * menSlope(r), 1.0, -rv.y * menSlope(r)));
    let near = 1.0 - smoothstep(0.5, 6.0, distance(toPlate(frame.camPos), i.mp));
    if (near > 0.0) {
      let tw = vec2f(noise3(vec3f(i.mp.xz * 0.9, frame.time * 0.35)), noise3(vec3f(i.mp.xz * 0.9 + 7.3, frame.time * 0.35))) - 0.5;
      n = unit(n + vec3f(tw.x, 0.0, tw.y) * 0.035 * near);
    }
    let cs = dot(n, -rd);
    if (cs > 0.0) {
      let F = schlick(0.02, cs);
      // (close to, the panel's image in it goes soft: the eye's too near the surface to hold it in focus)
      col = (roomSeen(i.mp, reflect(rd, n), 0.35 + 0.6 * near) + panelGloss(i.mp, reflect(rd, n), 40.0)) * F;
      alpha = F;
    } else {
      // from under it: the room through Snell's window, the medium's pink by total internal reflection outside it
      let ci = -cs;
      let tir = 1.0 - 1.77 * (1.0 - ci * ci) < 0.0;
      col = select(roomSeen(i.mp, refract(rd, -n, 1.33), 0.0) * 0.9, MEDIUM_GLOW * E * 0.04, tir) * select(0.9, 0.85, tir);
      alpha = select(0.9, 0.85, tir);
    }
    // (col is already the light it gives back, premultiplied: the light through it is dimmed by alpha)
    o.color = vec4f(safe(col * G.dim), alpha);
    o.pick = (18u << 20u) | (i.id & 0xfffffu);
    o.optic = vec4f(0.0);
    return o;
  } else if (i.n.y > 0.5) {
    // the floor: clear plastic, the cells on it as good as invisible by eye; the bench under it in the light that came
    // down through the medium (lab.wgsl throughPlate), a faint haze where the sheet scatters, the medium's own glow
    let pb = vec3f(i.mp.x, BENCH_Y, i.mp.z);
    var flo = benchColor(pb, rd) * 0.8;
    let live = w.v.x;
    // (the sheet of cells scatters a little: a living sheet more than a well of dead ones, in the readout's colour)
    flo += E * 0.006 * mix(vec3f(0.9, 0.85, 0.8), w.col.rgb, 0.25) * (0.4 + 0.6 * live);
    col = flo;
    if (chosen) {
      // down in the medium the chosen well's floor is the painted field of cells (the modelled view), and what the
      // instrument reads of it
      let pf = paintedField(fq, fg, ffw, i.wp, live);
      col = mix(col, pf.col, G.under);
      optic = vec4f(pf.optic, 0.0);
    }
  } else {
    // the bore: clear plastic, giving back the panel at a grazing angle, its neighbours' pink and the dark through it,
    // darker deeper down
    let n = unit(i.n);
    let F = schlick(0.052, dot(n, -rd));
    let depthIn = sat(i.uv.y);
    col = roomSeen(i.mp, reflect(rd, n), 0.15) * F + E * (0.006 + 0.018 * depthIn) * vec3f(0.85, 0.5, 0.58) * (1.0 - F);
    // the hovered well's lip lit in the page's accent (and the chosen one's, faintly)
    col += vec3f(0.35, 0.38, 0.95) * select(0.02, 0.25, hot > 0.9) * smoothstep(0.82, 1.0, i.uv.y);
  }
  // under the surface: the medium's colour along the way to the eye (or to its surface), and its glow
  if (i.mp.y < surface + 1e-3) {
    let path = mediumPath(i.mp, rd, surface);
    let T = exp(-MEDIUM_SIGMA * path);
    col = col * T + MEDIUM_GLOW * E * 0.010 * (1.0 - T) * mix(1.0, 0.0, G.under * select(0.0, 1.0, chosen));
  }
  col = mix(col, col * vec3f(0.5, 0.75, 1.0) + vec3f(0.0, 0.003, 0.008), G.mode * 0.8);
  if (chosen && i.n.y > 0.5) {
    // over the field of real cells the picture of them gives way as you come down to them; past the field's edge it
    // goes on being the floor of the well
    let f = abs(i.mp.xz - c) * P.unit;
    let band = mix(14.0, P.fieldHalf * 0.5, P.soft);
    let edge = smoothstep(P.fieldHalf - band, P.fieldHalf, mix(max(f.x, f.y), length(f), P.soft));
    alpha = mix(max(P.veil, 1.0 - G.under), 1.0, edge);
    if (alpha < 0.002) { discard; }
  }
  col = air(col, i.wp);
  o.color = vec4f(safe(col * G.dim) * alpha, alpha);
  o.pick = (18u << 20u) | (i.id & 0xfffffu);
  // (laid over the real cells' optics by alpha: the custom blend embed.ts gives it, the instrument's sum fading too)
  o.optic = vec4f(optic.rgb * alpha, select(0.0, alpha, chosen && i.n.y > 0.5));
  return o;
}
