// The monolayer's cells. The mesh is built on the processor (world/field.ts) — a pillow per cell over its Voronoi
// footprint, with a skirt dropping into the groove between neighbours — and every vertex carries its cell's index,
// so the whole field is one draw and each cell still has a life of its own.
//
// Two draws over the same mesh: the skirt, solid, in the groove where you would point at a membrane; and the
// pillow, translucent, so the nucleus and the mitochondria glow through it the way they do in a stained well.
#include "./common"
#include "weft/mesh"

@group(1) @binding(1) var<storage, read> verts: array<MeshVertex>;

/** 0 the pillow (translucent, over the organelles), 1 the skirt (solid, in the groove) */
override SKIRT: bool = false;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) t: f32,
  @location(3) @interpolate(flat) ci: u32,
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let v = verts[vi];
  let ci = v.mat;
  let c = cells[ci];
  var o: VOut;
  o.ci = ci;
  let isSkirt = meshUV(v).y > 0.5;
  if (isSkirt != SKIRT) { o.pos = vec4f(0.0, 0.0, 0.0, 0.0); return o; }

  var p = meshPos(v);
  var n = meshNormal(v);
  let fate = cellFate(ci);
  let apo = sat(G.caspase * fate);
  let onc = sat(G.oncosis * fate);
  let gone = 1.0 - cellAlive(ci);

  // an apoptotic cell lets go of the plate and balls up; a necrotic one swells where it stands; a cell that has
  // lysed leaves a flat husk behind
  let rel = vec3f(p.x - c.c.x, 0.0, p.z - c.c.z);
  let pull = (1.0 + 0.1 * onc) * (1.0 - 0.1 * gone);
  let rise = (1.0 + 0.45 * onc) * (1.0 - 0.72 * gone);
  p = vec3f(c.c.x + rel.x * pull, p.y * rise, c.c.z + rel.z * pull);
  if (apo > 0.01) {
    let R = c.c.w * 0.52;
    let centre = vec3f(c.c.x, R * 0.94, c.c.z);
    let ball = centre + unit(p - centre + vec3f(0.0, 1e-4, 0.0)) * R;
    p = mix(p, ball, apo * 0.9);
    n = unit(mix(n, unit(p - centre), apo * 0.9));
  }
  n = unit(vec3f(n.x / max(pull, 0.3), n.y / max(rise, 0.3), n.z / max(pull, 0.3)));

  o.wp = p;
  o.n = n;
  o.t = meshUV(v).x;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  return o;
}

struct FOut {
  @location(0) color: vec4f,
  @location(1) pick: u32,
  // what the instrument reads here (instrument.wgsl): the optical path through the cell (Δn · thickness, µm), its
  // haematoxylin and its PAS; added up over everything along the way
  @location(2) optic: vec4f,
}

@fragment fn fs(i: VOut) -> FOut {
  var out: FOut;
  let c = cells[i.ci];
  let hep = c.k.x > 0.5;
  let fate = cellFate(i.ci);
  let alive = cellAlive(i.ci);
  let n = unit(i.n);

  // the junctional rim: a bright edge where this cell meets the next, which is most of what a stained monolayer
  // looks like from above
  let rim = pow(1.0 - sat(i.t), 5.0);
  var base = select(C_FEEDER, C_CYTO, hep);
  base = mix(base, select(C_FEEDER * 1.35, C_CYTO_HI, hep), sat(i.t) * 0.32);
  base = mix(base, C_RIM, rim * select(0.2, 0.35, hep));

  // what the cell is carrying shows through its own body
  base = mix(base, C_LIPID * 0.9, sat(G.lipid * fate) * 0.3);
  base = mix(base, C_LAMELLAR, sat(G.pld * fate) * 0.18);
  base = mix(base, C_HARM, sat((G.leak * 0.8 + G.karyolysis * 0.5) * fate) * 0.5);
  base = mix(base, C_DEAD, (1.0 - alive) * 0.75);
  // glutathione: a cell with its account drawn down loses its warmth
  base = mix(base, base * vec3f(0.86, 0.9, 0.95), sat(G.gsh * fate) * 0.35);

  let V = unit(frame.camPos - i.wp);
  let fres = pow(1.0 - sat(dot(n, V)), 2.2);
  // the light through the cell: its height over the floor is its thickness straight down, and the path along the eye's
  // ray through it longer by the slant (thin at the junctions, deep in the middle)
  let thick = max(i.wp.y, 0.0);
  let chord = thick / max(abs(V.y), 0.35);
  var col = through(base, chord, select(2.0, 8.0, hep), n, vec3f(0.34, 0.31, 0.29));

  var alpha = 1.0;
  if (!SKIRT) {
    // translucent, and more so face-on than at the edge; the cell you are standing inside almost vanishes
    // from above, the sheet reads as a sheet; down among the cells their walls go to glass so you can see in
    let over = sat((frame.camPos.y - c.c.y * 1.6) / max(2.0, c.c.y));
    alpha = mix(mix(0.40, 0.88, fres), mix(0.70, 0.96, fres), over);
    let inside = select(0.0, 1.0, G.focus.w > 0.0 && distance(i.wp.xz, G.focus.xz) < G.focus.w);
    alpha = mix(alpha, 0.08 + 0.26 * fres, inside);
    alpha *= mix(0.82, 1.0, alive);
  } else {
    col *= 0.38;
  }

  // fluorescence: a membrane is dark unless something in it is stained
  let chan = C_RIM * 0.6 * G.stain2.x * canalTone(i.ci) * rim
    + vec3f(1.0, 0.2, 0.3) * G.stain2.z * sat(G.leak * fate) * 0.7;
  col = mix(col, chan, G.mode);
  alpha = mix(alpha, alpha * (0.04 + 2.6 * luma(chan)), G.mode);

  col = air(col, i.wp);
  out.color = vec4f(safe(col * G.dim) * alpha, alpha);
  out.pick = select(0u, (15u << 20u) | (i.ci & 0xfffffu), SKIRT);
  // the optics (the roof only: the skirt is behind it): the cytoplasm (n about 1.37 against the medium's 1.335) through
  // the cell's height, grainy with what's in it; a hepatocyte's glycogen for the PAS. A cell that has let go is a husk
  let glyc = 1.0 - sat((G.atpLoss * 1.3 + G.swell * 0.7) * fate);
  // (the grain only while the instrument's showing: it's a noise for every fragment of the sheet)
  var grain = 0.0;
  if (G.optics.x > 0.001) { grain = noise3(i.wp * 0.9 + vec3f(f32(i.ci) * 7.1)) - 0.5; }
  let dn = 0.035 * (1.0 + 0.35 * grain) * mix(0.4, 1.0, alive) * (1.0 + 0.4 * sat(G.oncosis * fate));
  out.optic = vec4f(dn * thick, 0.0, select(0.012, 0.06 * glyc, hep) * thick * alive, 0.0);
  return out;
}
