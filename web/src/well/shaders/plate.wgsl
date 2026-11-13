// The plate: a hundred and twenty-eight millimetres by eighty-five, eight rows by twelve columns, nine millimetres
// between centres. Everything about how a screen is laid out follows from this rectangle — one compound down each
// column, a dilution series across the rows, and nothing at all in the last row so you have something to compare
// against. The plate is laid out in millimetres, the scale you stand back from, and put into the world's micrometres
// as it's drawn: the world's origin is wherever it's floating (the chosen well's floor, or the camera when the field is
// out of sight), so `shift` is where the plate's own origin is from there, worked out on the processor in doubles.
#include "./common"

struct Well {
  // viability 0..1, the compound's hue, the dose as a fraction of the series' top, 1 if it is the well you are over
  v: vec4f,
  // the dominant lesion's colour
  col: vec4f,
}
@group(1) @binding(3) var<storage, read> wells: array<Well>;

struct PlateU {
  rows: f32, cols: f32, pitch: f32, bore: f32,
  depth: f32, fill: f32, hover: f32, chosen: f32,
  originX: f32, originZ: f32, lift: f32, spare: f32,
  // the plate's origin in the world's floating frame (µm), and micrometres to the millimetre
  shift: vec3f, unit: f32,
  // the chosen well's floor over the field of cells: how much of the plate's picture of it is still laid over the real
  // cells (1 far off, 0 close in), and half the field's width (µm)
  // and how soft the field's edge is (0 down among the cells: a square, as the field is; 1 from a few millimetres off:
  // a wide round fade, so the field reads as a patch of the sheet rather than a tile laid on it)
  veil: f32, fieldHalf: f32, soft: f32, spare2: f32,
}
@group(1) @binding(4) var<uniform> P: PlateU;

fn wellCentre(i: u32) -> vec2f {
  let r = f32(i / u32(P.cols));
  let c = f32(i % u32(P.cols));
  return vec2f(P.originX + c * P.pitch, P.originZ + r * P.pitch);
}

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

/** the plate's millimetres into the world's frame */
fn toWorld(p: vec3f) -> vec3f { return p * P.unit + P.shift; }

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
  let half = vec3f(63.9, P.depth * 0.5, 42.75);
  let p = vec3f(0.0, -P.depth * 0.5, 0.0) + (n + t * q.x + b * q.y) * half;
  var o: VOut;
  o.mp = p; o.wp = toWorld(p); o.n = n; o.uv = q; o.id = 0u;
  o.pos = frame.viewProj * vec4f(o.wp, 1.0);
  return o;
}

@fragment fn fs_body(i: VOut) -> FOut {
  var o: FOut;
  let n = unit(i.n);
  // the ninety-six bores are holes in the top face, not paint on it
  if (n.y > 0.5) {
    let g = vec2f((i.mp.x - P.originX) / P.pitch, (i.mp.z - P.originZ) / P.pitch);
    let near = clamp(round(g), vec2f(0.0), vec2f(P.cols - 1.0, P.rows - 1.0));
    let d = distance(i.mp.xz, vec2f(P.originX + near.x * P.pitch, P.originZ + near.y * P.pitch));
    if (d < P.bore * 0.5) { discard; }
  }
  let V = unit(frame.camPos - i.wp);
  let fres = pow(1.0 - sat(dot(n, V)), 3.0);
  var col = vec3f(0.56, 0.56, 0.60) * (0.46 + 0.6 * sat(dot(n, unit(G.sun))));
  if (n.y < 0.5) { col *= 0.72; }
  col += vec3f(1.0) * fres * 0.55;
  // a dark lip where the top face meets a bore
  if (n.y > 0.5) {
    let g2 = vec2f((i.mp.x - P.originX) / P.pitch, (i.mp.z - P.originZ) / P.pitch);
    let near2 = clamp(round(g2), vec2f(0.0), vec2f(P.cols - 1.0, P.rows - 1.0));
    let d2 = distance(i.mp.xz, vec2f(P.originX + near2.x * P.pitch, P.originZ + near2.y * P.pitch));
    col *= 0.45 + 0.55 * smoothstep(P.bore * 0.5, P.bore * 0.72, d2);
  }
  // (down in the medium the plastic goes into the same haze as the cells; up in the air, G.fogK is 0)
  col = air(col, i.wp);
  o.color = vec4f(safe(col * G.dim), 1.0);
  o.pick = (19u << 20u);
  return o;
}

// --------------------------------------------------------------------------------------------- the wells

const SEG = 28u;

@vertex fn vs_well(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let w = wells[ii];
  let c = wellCentre(ii);
  let R = P.bore * 0.5;
  let top = 0.0;
  let bottom = -P.depth * 0.80;
  var p = vec3f(0.0);
  var n = vec3f(0.0, 1.0, 0.0);
  var uv = vec2f(0.0);

  let wallVerts = SEG * 6u;
  let discVerts = SEG * 3u;
  if (vi < wallVerts) {
    // the bore's wall
    let k = vi / 6u;
    let j = vi % 6u;
    let a0 = f32(k) / f32(SEG) * 6.2831853;
    let a1 = f32(k + 1u) / f32(SEG) * 6.2831853;
    let pick = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[j];
    let a = mix(a0, a1, pick.x);
    let y = mix(bottom, top, pick.y);
    p = vec3f(c.x + cos(a) * R, y, c.y + sin(a) * R);
    n = vec3f(-cos(a), 0.0, -sin(a));
    uv = vec2f(pick.x, pick.y);
  } else if (vi < wallVerts + discVerts) {
    // the floor of the well, where the cells are
    let k = (vi - wallVerts) / 3u;
    let j = (vi - wallVerts) % 3u;
    let a0 = f32(k) / f32(SEG) * 6.2831853;
    let a1 = f32(k + 1u) / f32(SEG) * 6.2831853;
    let r = R * 0.985;
    if (j == 0u) { p = vec3f(c.x, bottom, c.y); uv = vec2f(0.0, 0.0); }
    else if (j == 1u) { p = vec3f(c.x + cos(a0) * r, bottom, c.y + sin(a0) * r); uv = vec2f(1.0, 0.0); }
    else { p = vec3f(c.x + cos(a1) * r, bottom, c.y + sin(a1) * r); uv = vec2f(1.0, 0.0); }
    n = vec3f(0.0, 1.0, 0.0);
  } else {
    // the meniscus: the top of the medium, a little below the rim
    let k = (vi - wallVerts - discVerts) / 3u;
    let j = (vi - wallVerts - discVerts) % 3u;
    let a0 = f32(k) / f32(SEG) * 6.2831853;
    let a1 = f32(k + 1u) / f32(SEG) * 6.2831853;
    let r = R * 0.99;
    let y = bottom + (top - bottom) * P.fill;
    if (j == 0u) { p = vec3f(c.x, y + 0.14, c.y); uv = vec2f(0.0, 1.0); }
    else if (j == 1u) { p = vec3f(c.x + cos(a0) * r, y, c.y + sin(a0) * r); uv = vec2f(1.0, 1.0); }
    else { p = vec3f(c.x + cos(a1) * r, y, c.y + sin(a1) * r); uv = vec2f(1.0, 1.0); }
    n = vec3f(0.0, 1.0, 0.0);
  }

  // the chosen well's floor stands a little proud of the field's collagen under it, and while its picture is still laid
  // over the cells, above them too (a few tens of micrometres: nothing, from where that can be seen)
  if (i32(ii) == i32(P.chosen) && n.y > 0.5 && vi >= wallVerts && vi < wallVerts + discVerts) { p.y += P.lift / P.unit; }
  var o: VOut;
  o.mp = p; o.wp = toWorld(p); o.n = n; o.uv = uv; o.id = ii;
  o.pos = frame.viewProj * vec4f(o.wp, 1.0);
  return o;
}

/** the chosen well's floor as the real cells look from a few millimetres up (field.wgsl), painted: the same cells at
 *  their own size with their rims and their nuclei glowing through, the feeders' lawn round the hepatocytes' islands in
 *  the co-culture, the pillows laid over the collagen as they are — so the cells that take over from the picture are
 *  the colour it was. `q` is the point from the well's middle (µm), `g` the same in cells and `fw` its change across a
 *  pixel (worked out before any branch: where a cell is under a few pixels, its average) */
fn paintedField(q: vec2f, g: vec2f, fw: f32, wp: vec3f, live: f32) -> vec3f {
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
  let t = sat((f2 - f1) / 0.55);
  let rim = pow(1.0 - t, 5.0);
  var base = select(C_FEEDER, C_CYTO, hep);
  base = mix(base, select(C_FEEDER * 1.35, C_CYTO_HI, hep), t * 0.32);
  base = mix(base, C_RIM, rim * select(0.45, 0.85, hep));
  base = mix(base, C_DEAD, (1.0 - live) * 0.6);
  var cell = lit(base, up, wp, 0.35, 0.03 + rim * 1.7);
  // (a nucleus glowing through the pillow)
  cell = mix(cell, lit(C_NUC, up, wp, 0.2, 0.3), (1.0 - smoothstep(0.16, 0.24, f1)) * select(0.25, 0.45, hep));
  let floorLit = lit(C_FLOOR, up, wp, 0.0, 0.02);
  let sharp = mix(floorLit, cell, 0.74);
  // (the average of all that, for a cell under a few pixels: no shimmer)
  let hepShare = select(1.0, 0.72, G.feeders > 0.5);
  var mb = mix(C_FEEDER * 1.1, mix(C_CYTO, C_CYTO_HI, 0.16), hepShare);
  mb = mix(mb, C_RIM, 0.1);
  mb = mix(mb, C_DEAD, (1.0 - live) * 0.6);
  let mean = mix(floorLit, mix(lit(mb, up, wp, 0.35, 0.12), lit(C_NUC, up, wp, 0.2, 0.3), 0.05), 0.74);
  return mix(sharp, mean, smoothstep(0.25, 0.6, fw));
}

@fragment fn fs_well(i: VOut) -> FOut {
  var o: FOut;
  let w = wells[i.id];
  let c = wellCentre(i.id);
  // (the painted field's cells and their size on the screen, here where every fragment still runs)
  let fq = (i.mp.xz - c) * P.unit;
  let fg = fq / max(G.cellSize, 1.0);
  let ffw = length(fwidth(fg));
  let n = unit(i.n);
  let V = unit(frame.camPos - i.wp);
  let fres = pow(1.0 - sat(dot(n, V)), 2.4);
  let hot = w.v.w;

  var col: vec3f;
  var alpha = 1.0;
  if (i.uv.y > 0.99 && n.y > 0.5) {
    // the medium's surface: a film of liquid with the well's colour under it
    col = mix(vec3f(0.92, 0.94, 0.98), w.col.rgb, 0.45) * 0.42 + vec3f(1.0) * fres * 0.8;
    alpha = 0.14 + 0.5 * fres;
  } else if (n.y > 0.5) {
    // the monolayer, seen from above: the cells as a texture, their colour the state of the well
    let q = (i.mp.xz - c) / (P.bore * 0.5);
    let d = length(q);
    var cellTex = 0.0;
    // a quick Voronoi so the floor of the well reads as cells rather than paint
    let g = (i.mp.xz - c) * 9.0;
    let gi = floor(g);
    var best = 9.0;
    for (var yy = -1; yy <= 1; yy++) {
      for (var xx = -1; xx <= 1; xx++) {
        let o2 = vec2f(f32(xx), f32(yy));
        let pt = gi + o2 + vec2f(hash21(gi + o2), hash21(gi + o2 + 19.1));
        best = min(best, length(pt - g));
      }
    }
    cellTex = smoothstep(0.08, 0.42, best);
    let live = w.v.x;
    var cc = mix(w.col.rgb, hueColor(w.v.y) * 0.6 + C_CYTO * 0.6, 0.25);
    cc = mix(C_DEAD * 0.7, cc, live * 0.75 + 0.25);
    col = cc * (0.52 + 0.72 * cellTex) * (0.42 + 0.78 * live);
    col += C_RIM * (1.0 - cellTex) * 0.3 * live;
    col *= 1.0 - smoothstep(0.84, 1.0, d) * 0.45;
    // (the chosen well's, close enough to see its cells: the field's own look, which the real cells keep to)
    if (i32(i.id) == i32(P.chosen)) {
      let near = 1.0 - smoothstep(6000.0, 30000.0, distance(frame.camPos, i.wp));
      if (near > 0.0) { col = mix(col, paintedField(fq, fg, ffw, i.wp, live), near); }
    }
    col += col * hot * 0.75;
    if (i32(i.id) == i32(P.chosen)) {
      // over the field of real cells the picture of them gives way as you come down to them; past the field's edge it
      // goes on being the floor of the well
      let f = abs(i.mp.xz - c) * P.unit;
      let band = mix(14.0, P.fieldHalf * 0.5, P.soft);
      let edge = smoothstep(P.fieldHalf - band, P.fieldHalf, mix(max(f.x, f.y), length(f), P.soft));
      alpha = mix(P.veil, 1.0, edge);
      if (alpha < 0.002) { discard; }
    }
  } else {
    // the bore
    col = vec3f(0.70, 0.70, 0.75) * (0.16 + 0.62 * i.uv.y) + vec3f(1.0) * fres * 0.28;
    col += w.col.rgb * (1.0 - i.uv.y) * 0.5 * w.v.x;
    col = mix(col, col * 1.35 + w.col.rgb * 0.4, hot);
  }
  col = mix(col, col * vec3f(0.5, 0.75, 1.0) + vec3f(0.0, 0.05, 0.12), G.mode * 0.8);
  col = air(col, i.wp);
  o.color = vec4f(safe(col * G.dim) * alpha, alpha);
  o.pick = (18u << 20u) | (i.id & 0xfffffu);
  return o;
}
