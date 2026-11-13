// The plate's layout and the bench it stands on, for whatever draws them or shows them through itself: the plate's own
// draws (plate.wgsl) and the room behind everything (stage.wgsl). In the plate's millimetres: x along its columns, z down
// its rows, y up from the middle of its top face, the bench 11.2 mm under that.
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

/** the plate's footprint, half its width and depth (mm) */
const PLATE_HALF = vec2f(63.9, 42.75);
/** the culture medium's absorption per millimetre (phenol red at pH 7.4 in DMEM: it takes the green, some blue) */
const MEDIUM_SIGMA = vec3f(0.07, 0.46, 0.25);
/** a little of the light that goes into the medium comes back out of it (serum, the walls), its colour */
const MEDIUM_GLOW = vec3f(0.55, 0.16, 0.22);

fn wellCentre(i: u32) -> vec2f {
  let r = f32(i / u32(P.cols));
  let c = f32(i % u32(P.cols));
  return vec2f(P.originX + c * P.pitch, P.originZ + r * P.pitch);
}
/** the nearest well's centre to a point of the plate (mm) */
fn nearestWell(xz: vec2f) -> vec2f {
  let g = vec2f((xz.x - P.originX) / P.pitch, (xz.y - P.originZ) / P.pitch);
  let n = clamp(round(g), vec2f(0.0), vec2f(P.cols - 1.0, P.rows - 1.0));
  return vec2f(P.originX + n.x * P.pitch, P.originZ + n.y * P.pitch);
}

/** the plate's millimetres into the world's frame, and back */
fn toWorld(p: vec3f) -> vec3f { return p * P.unit + P.shift; }
fn toPlate(w: vec3f) -> vec3f { return (w - P.shift) / P.unit; }

/** the light from the panel at a point under or near the plate, having come through it: clear polystyrene takes a
 *  quarter, its skirt's walls throw a darker line, a well's medium throws its pink and its curved walls a bright ring */
fn throughPlate(p: vec3f) -> vec3f {
  let L = unit(panelCentre() - p);
  let up = max(0.0 - p.y, 0.0);
  let q = p.xz + L.xz * (up / max(L.y, 0.2));
  let d = sdRect(q, PLATE_HALF);
  let pen = 0.5 + 0.1 * up;
  let inside = 1.0 - smoothstep(-pen, pen, d);
  if (inside < 0.001) { return vec3f(1.0); }
  var T = vec3f(0.76) * (1.0 - 0.55 * (1.0 - smoothstep(0.0, 1.6 + pen, abs(d))));
  let dw = distance(q, nearestWell(q));
  let R = P.bore * 0.5;
  let inWell = 1.0 - smoothstep(R - 0.25 - pen * 0.3, R + 0.25 + pen * 0.3, dw);
  T *= mix(vec3f(1.0), mix(vec3f(1.0), exp(-MEDIUM_SIGMA * 3.2), 0.45), inWell);
  // (the light the bore's curved wall bends inward, as a faint ring just inside its shadow)
  T += vec3f(0.10, 0.06, 0.06) * exp(-pow((dw - R * 0.9) / (0.18 + pen * 0.2), 2.0)) * inWell;
  return mix(vec3f(1.0), T, inside);
}

/** the bench at a point (y = BENCH_Y) seen along rd: black resin, a faint mottle, lit by the panel through or round the
 *  plate, darker in against the plate's foot, and its satin top giving back a blurred panel at a low angle */
fn benchColor(p: vec3f, rd: vec3f) -> vec3f {
  let mott = noise3(vec3f(p.xz * 0.35, 1.0)) * 0.6 + noise3(vec3f(p.xz * 0.04, 2.0)) * 0.4;
  let alb = vec3f(0.034, 0.035, 0.038) * (0.85 + 0.3 * mott);
  let d = sdRect(p.xz, PLATE_HALF);
  let ao = mix(0.35, 1.0, smoothstep(-1.0, 7.0, d));
  var c = alb * panelLight(p) * throughPlate(p) * ao;
  let v = -rd;
  let fres = 0.04 + 0.96 * pow(1.0 - max(v.y, 0.0), 5.0);
  c += roomSeen(p, reflect(rd, vec3f(0.0, 1.0, 0.0)), 1.0) * fres * 0.22 * mix(0.4, 1.0, smoothstep(-2.0, 10.0, d));
  return c;
}

/** what's seen along a ray from a point in the plate's millimetres, past everything the plate draws: the bench, or the
 *  room over it */
fn labSeen(e: vec3f, rd: vec3f) -> vec3f {
  if (rd.y < -1e-4 && e.y > BENCH_Y) {
    let p = e + rd * ((BENCH_Y - e.y) / rd.y);
    let far = smoothstep(1400.0, 3200.0, length(p.xz));
    return mix(benchColor(p, rd), roomSeen(e, rd, 0.0) * 0.6, far);
  }
  return roomSeen(e, rd, 0.0);
}
