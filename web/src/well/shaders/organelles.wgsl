// The organelles. Each instance is a shape the fragment shader intersects by hand — a sphere, a capsule along an
// axis, or a flattened ellipsoid — drawn as one camera-facing quad. So a mitochondrion has no polygons to show you
// however close you get, and the lesions are applied here rather than on the processor: swelling, rounding,
// breaking apart, filling with whorls, going dark. Move the hour dial and the whole cell changes for nothing.
#include "./common"

struct Org { p: vec4f, a: vec4f, k: vec4f }
@group(1) @binding(0) var<storage, read> orgs: array<Org>;

const K_MITO = 0u; const K_LYSO = 1u; const K_PEROX = 2u; const K_LIPID = 3u; const K_GLYC = 4u;
const K_NUC = 5u; const K_NUCLEOLUS = 6u; const K_FOCI = 7u; const K_BLEB = 8u; const K_GOLGI = 9u;
const K_ERTUBE = 10u; const K_ERSHEET = 11u;

struct Shape {
  c: vec3f,      // centre
  r: f32,        // radius
  ax: vec3f,     // axis, unit
  len: f32,      // half length along the axis (0 = a sphere)
  sheet: f32,    // 1 = a flattened ellipsoid rather than a capsule
  vis: f32,      // 0..1, how much of it is there at all
  kind: u32,
  cell: u32,
  seed: f32,
}

fn shapeOf(o: Org) -> Shape {
  var s: Shape;
  s.kind = u32(o.k.x);
  s.cell = u32(o.k.y);
  s.seed = o.k.z;
  let ord = o.k.w;
  let fate = cellFate(s.cell);
  let alive = cellAlive(s.cell);
  s.c = o.p.xyz;
  s.r = o.p.w;
  s.ax = unit(o.a.xyz + vec3f(0.0, 1e-5, 0.0));
  s.len = o.a.w;
  s.sheet = 0.0;
  s.vis = 1.0;

  let swell = sat(G.swell * fate);
  let frag = sat(G.frag * fate);
  let er = sat(G.erStress * fate);
  let drift = vec3f(hash11(s.seed), hash11(s.seed + 7.1), hash11(s.seed + 13.3)) - 0.5;

  switch s.kind {
    case 0u: {   // a mitochondrion: it rounds up and clears as it swells, and the network breaks into dots
      s.r *= 1.0 + 0.62 * swell;
      s.len *= (1.0 - 0.72 * swell) * (1.0 - 0.78 * frag);
      s.c += drift * frag * 1.4;
    }
    case 1u: {   // a lysosome: it swells as something weak and basic piles up in it
      s.r *= 1.0 + 0.55 * sat(G.lyso * fate) + 0.75 * sat(G.pld * fate);
    }
    case 3u: {   // a lipid droplet: they appear in order, small and many or few and large
      let n = sat(G.lipid * fate);
      s.vis = sat((n - ord) * 7.0);
      s.r *= mix(1.45, 0.58, sat(G.micro)) * (0.55 + 0.75 * n);
    }
    case 4u: {   // glycogen: the first thing a cell in trouble spends
      s.vis = 1.0 - sat((G.atpLoss * 1.3 + swell * 0.7) * fate);
    }
    case 5u: {   // the nucleus: it shrinks and hardens in apoptosis, swells and goes pale in necrosis
      s.r *= 1.0 - 0.2 * sat(G.condense * fate) + 0.3 * sat(G.karyolysis * fate) + 0.1 * sat(G.dna);
    }
    case 7u: {   // γH2AX foci: one per break
      s.vis = sat((sat(G.dna * fate) - ord) * 6.0);
    }
    case 8u: {   // blebs: the apoptotic ones boil and pinch off, the necrotic ones just grow
      let apo = sat(G.caspase * fate);
      let onc = sat(G.oncosis * fate);
      let n = max(apo, onc);
      s.vis = sat((n - ord) * 5.0) * alive;
      let boil = 0.5 + 0.5 * sin(frame.time * 2.4 + s.seed);
      s.r *= (0.6 + 1.7 * onc) * mix(1.0, 0.55 + 0.9 * boil, apo);
    }
    case 9u: {   // the Golgi, scattering as the traffic through it stalls
      s.sheet = 1.0;
      s.c += drift * er * 3.4;
      s.r *= 1.0 - 0.35 * er;
    }
    case 10u: {  // ER tubules, dilating
      s.r *= 1.0 + 1.9 * er;
    }
    case 11u: {  // ER sheets: the cisternae round out and the ribosomes come off
      s.sheet = 1.0;
      s.len *= 1.0 + 5.5 * er;
      s.r *= 1.0 + 0.2 * er;
    }
    default: {}
  }
  // everything in a cell that has let go of the plate shrinks away with it
  // what is left inside a cell that has lysed is debris: still there, dim, and smaller
  if (s.kind != 8u) { s.vis *= mix(0.42, 1.0, alive); s.r *= mix(0.74, 1.0, alive); }
  return s;
}

fn bound(s: Shape) -> f32 {
  if (s.sheet > 0.5) { return s.r * 1.08 + s.len; }
  return s.r + s.len;
}

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) id: u32,
  @location(1) @interpolate(flat) vis: f32,
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let s = shapeOf(orgs[ii]);
  var o: VOut;
  o.id = ii;
  o.vis = s.vis;
  if (s.vis < 0.01) { o.pos = vec4f(0.0, 0.0, 0.0, 0.0); return o; }
  let q = array<vec2f, 6>(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(-1,1), vec2f(1,-1), vec2f(1,1))[vi];
  let b = bound(s) * 1.12;
  let p = s.c + (frame.camRight * q.x + frame.camUp * q.y) * b;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  return o;
}

/** where a ray meets a shape, and the length of its path through it (its chord) */
struct Hit { t: f32, n: vec3f, local: vec3f, ok: bool, chord: f32 }

fn hitSphere(ro: vec3f, rd: vec3f, c: vec3f, r: f32) -> Hit {
  var h: Hit; h.ok = false;
  let oc = ro - c;
  let b = dot(oc, rd);
  let cq = dot(oc, oc) - r * r;
  let disc = b * b - cq;
  if (disc < 0.0) { return h; }
  let t = -b - sqrt(disc);
  if (t < 0.0) { return h; }
  h.t = t; h.local = ro + rd * t - c; h.n = h.local / max(r, 1e-6); h.ok = true; h.chord = 2.0 * sqrt(disc);
  return h;
}

fn hitCapsule(ro: vec3f, rd: vec3f, c: vec3f, ax: vec3f, len: f32, r: f32) -> Hit {
  // the cylinder body, then the caps — in the capsule's own frame so the maths stays short
  var h: Hit; h.ok = false;
  let o = ro - c;
  let od = dot(o, ax);
  let rdd = dot(rd, ax);
  let oPerp = o - ax * od;
  let rPerp = rd - ax * rdd;
  let a = dot(rPerp, rPerp);
  var best = 1e30; var n = vec3f(0.0); var chord = 0.0;
  if (a > 1e-9) {
    let b = dot(oPerp, rPerp);
    let cq = dot(oPerp, oPerp) - r * r;
    let disc = b * b - a * cq;
    if (disc >= 0.0) {
      let t = (-b - sqrt(disc)) / a;
      let y = od + rdd * t;
      if (t > 0.0 && abs(y) <= len) { best = t; n = unit(oPerp + rPerp * t); chord = 2.0 * sqrt(disc) / a; }
    }
  }
  for (var k = 0; k < 2; k++) {
    let sgn = select(-1.0, 1.0, k == 1);
    let cc = c + ax * (len * sgn);
    let hs = hitSphere(ro, rd, cc, r);
    if (hs.ok && hs.t < best) { best = hs.t; n = hs.n; chord = hs.chord; }
  }
  if (best > 1e29) { return h; }
  h.t = best; h.n = n; h.local = ro + rd * best - c; h.ok = true;
  // (along the body's length the cylinder's chord runs on past where it ends: no longer than the capsule)
  h.chord = min(chord, 2.0 * (len + r));
  return h;
}

/** a flattened ellipsoid: radius r across, len thick, the short axis along `ax` */
fn hitSheet(ro: vec3f, rd: vec3f, c: vec3f, ax: vec3f, len: f32, r: f32) -> Hit {
  var h: Hit; h.ok = false;
  // build a frame and squash the ray along the short axis
  var t0 = vec3f(1.0, 0.0, 0.0);
  if (abs(ax.x) > 0.8) { t0 = vec3f(0.0, 1.0, 0.0); }
  let u = unit(cross(ax, t0));
  let v = cross(ax, u);
  let o = ro - c;
  let ol = vec3f(dot(o, u), dot(o, ax) * (r / max(len, 1e-4)), dot(o, v));
  let dl = vec3f(dot(rd, u), dot(rd, ax) * (r / max(len, 1e-4)), dot(rd, v));
  let A = dot(dl, dl);
  let B = dot(ol, dl);
  let C = dot(ol, ol) - r * r;
  let disc = B * B - A * C;
  if (disc < 0.0 || A < 1e-9) { return h; }
  let t = (-B - sqrt(disc)) / A;
  if (t < 0.0) { return h; }
  let pl = ol + dl * t;
  let nl = unit(vec3f(pl.x, pl.y * (r / max(len, 1e-4)), pl.z));
  h.t = t;
  h.n = unit(u * nl.x + ax * nl.y + v * nl.z);
  h.local = ro + rd * t - c;
  h.ok = true;
  h.chord = 2.0 * sqrt(disc) / A;
  return h;
}

struct FOut {
  @location(0) color: vec4f,
  @location(1) pick: u32,
  // what the instrument reads (instrument.wgsl): a nucleus's and a nucleolus's optical path over the cytoplasm they
  // stand in for, and their haematoxylin (the nuclei's draw only)
  @location(2) optic: vec4f,
  @builtin(frag_depth) depth: f32,
}

@fragment fn fs(i: VOut) -> FOut {
  var out: FOut;
  let s = shapeOf(orgs[i.id]);
  let uv = i.pos.xy * frame.invRes;
  let ro = frame.camPos;
  let rd = viewRay(uv);

  var h: Hit;
  if (s.sheet > 0.5) { h = hitSheet(ro, rd, s.c, s.ax, s.len, s.r); }
  else if (s.len > 1e-4) { h = hitCapsule(ro, rd, s.c, s.ax, s.len, s.r); }
  else { h = hitSphere(ro, rd, s.c, s.r); }
  if (!h.ok) { discard; }

  let wp = ro + rd * h.t;
  let cp = frame.viewProj * vec4f(wp, 1.0);
  out.depth = cp.z / cp.w;

  let fate = cellFate(s.cell);
  var base = vec3f(0.6);
  var emis = 0.0;
  var gloss = 0.5;
  var alpha = 1.0;
  var chan = vec3f(0.0);        // what the stains would show here

  switch s.kind {
    case 0u: {
      let depol = sat(G.depol * fate);
      base = mix(C_MITO, C_MITO_OFF, depol);
      // the cristae: stacked ridges across the rod, rarefying as the matrix clears
      let along = dot(h.local, s.ax);
      let rib = 0.5 + 0.5 * sin(along * 26.0 + s.seed);
      let crista = rib * (1.0 - sat(G.swell * fate)) * (1.0 - depol * 0.55);
      base *= 0.86 + 0.22 * crista;
      emis = (1.0 - depol) * 0.24;
      chan = vec3f(1.0, 0.54, 0.24) * (1.0 - depol) * (0.5 + 0.8 * crista) * G.stain.y;
      chan += vec3f(1.0, 0.88, 0.3) * sat(G.ros * fate) * 0.8 * G.stain2.y;
    }
    case 1u: {
      let pld = sat(G.pld * fate);
      base = mix(C_LYSO, C_LAMELLAR, pld);
      // lamellar bodies: concentric whorls of membrane the cell cannot digest
      let rings = 0.5 + 0.5 * sin(length(h.local) * (34.0 / max(s.r, 0.2)) + s.seed);
      base *= 1.0 + pld * (rings * 1.1 - 0.35);
      emis = 0.10 + 0.4 * pld;
      chan = vec3f(1.0, 0.36, 0.8) * pld * (0.55 + 0.7 * rings) * G.stain.w;
    }
    case 2u: { base = C_PEROX; emis = 0.05; }
    case 3u: {
      base = C_LIPID; emis = 0.18; gloss = 1.0;
      chan = vec3f(0.55, 1.0, 0.42) * G.stain.z * (0.6 + 0.6 * sat(G.lipid));
    }
    case 4u: { base = C_GLYC; emis = 0.02; gloss = 0.2; }
    case 5u: {
      let cond = sat(G.condense * fate);
      let karyo = sat(G.karyolysis * fate);
      base = C_NUC;
      // chromatin: even and fine when the genome is being read, lumpy and hard against the envelope in apoptosis,
      // washed out and featureless in necrosis
      let p = h.local / max(s.r, 0.5);
      var tex = fbm3(p * 3.4 + s.seed);
      tex = mix(tex, smoothstep(0.42, 0.78, fbm3(p * 2.1 + s.seed)) , cond);
      base *= 0.72 + 0.62 * tex * (1.0 - karyo * 0.75);
      base = mix(base, base * 0.7 + vec3f(0.22, 0.2, 0.24), karyo);
      emis = 0.16 + 0.5 * cond - 0.1 * karyo;
      gloss = 0.3;
      chan = vec3f(0.22, 0.38, 1.0) * G.stain.x * (0.3 + 0.75 * tex) * (1.0 + 1.3 * cond) * (1.0 - 0.55 * karyo);
      chan += vec3f(1.0, 0.2, 0.3) * G.stain2.z * sat(G.leak * fate) * 1.4;
    }
    case 6u: { base = C_NUCLEOLUS; emis = 0.22; chan = vec3f(0.22, 0.38, 1.0) * G.stain.x * 0.9; }
    case 7u: {
      base = C_DNA; emis = 1.6; gloss = 0.0;
      chan = C_DNA * 2.2;
    }
    case 8u: {
      base = mix(C_CYTO_HI, C_DEAD, sat(G.leak * fate) * 0.7);
      emis = 0.18; gloss = 0.8; alpha = 0.85;
      chan = vec3f(1.0, 0.2, 0.3) * G.stain2.z * sat(G.leak * fate);
    }
    case 9u: { base = C_GOLGI; emis = 0.12; }
    case 10u: { base = C_ER; emis = 0.07; }
    case 11u: {
      base = C_ER;
      // ribosomes on the rough ER: a stipple that smooths away as they come off under stress
      let st = hash21(floor(h.local.xz * 26.0 + s.seed));
      base *= 0.86 + 0.4 * step(0.62, st) * (1.0 - sat(G.erStress * fate));
      emis = 0.07;
    }
    default: {}
  }

  // the modelled view: the light that comes through the body along its exact chord (thin edges pale, thick middles
  // deep), the light itself what's left of it under the crowd over this point of the cell (its depth under the roof)
  let cl = cells[s.cell];
  let tr = max(0.0, 1.0 - distance(wp.xz, cl.c.xz) / max(cl.c.w, 1.0));
  let roof = cl.c.y * (0.13 + 0.87 * pow(sin(tr * 1.5708), 0.68));
  let light = vec3f(0.24, 0.22, 0.21) * crowdLight(roof - wp.y);
  var col = through(base, h.chord, max(s.r * 1.6, 0.15), h.n, light) + base * emis * 0.12;
  col = mix(col, base * (0.25 + emis * 2.4), G.mode);

  // injury bleeds a desaturated red through everything in the cell
  col = mix(col, mix(col, C_HARM, 0.55), sat((G.leak + G.karyolysis * 0.6) * fate) * 0.75);
  col = air(col, wp);
  // in the fluorescence register a thing is only its dye
  col = mix(col, chan * 1.15, G.mode);
  out.color = vec4f(safe(col * G.dim), alpha * i.vis);
  out.pick = ((s.kind + 1u) << 20u) | (s.cell & 0xfffffu);
  // (a nucleolus is inside its nucleus, so behind it in depth: its path is found here, where nucleiOnly put it)
  var opt = vec2f(0.0);
  if (s.kind == K_NUC) {
    let a = cl.k.z * 6.283;
    let nc = s.c + vec3f(cos(a) * s.r * 0.3, s.r * 0.12, sin(a) * s.r * 0.3);
    let oc = ro - nc;
    let b = dot(oc, rd);
    let nl = 2.0 * sqrt(max(b * b - (dot(oc, oc) - pow(s.r * 0.27, 2.0)), 0.0));
    opt = vec2f(-0.008 * h.chord + 0.05 * nl, 0.12 * h.chord + 0.2 * nl);
  }
  // (the haematoxylin with the rest, by the brightest; the path in alpha, added: instrument.wgsl)
  out.optic = vec4f(0.0, opt.y, 0.0, opt.x) * i.vis;
  return out;
}
