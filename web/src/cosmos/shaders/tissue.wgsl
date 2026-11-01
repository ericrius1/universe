// The tissue at the bottom of the dive (tissue.ts: the same lattice, the same hash): a sheet of cells ~20 µm across in
// the plane y = 0, painted where it's seen from afar — by the cosmos on Lyra's cornea, by the cell's world beyond its
// own nearest cells. tissueMasks gives the nearest cell's look at a point of the plane (nm), each side colouring it in
// its own light: x inside a cell (its body, faint), y its membrane's rim, z its nucleus, w the nucleus's rim.
const TISSUE_SP = 21000.0;
const TISSUE_NEAR = 48000.0;   // (tissue.ts TISSUE.near)

fn tH32(x: u32) -> u32 {
  let v = x * 747796405u + 2891336453u;
  let w = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u;
  return (w >> 22u) ^ w;
}
fn tRand(i: i32, j: i32, k: u32) -> f32 { return f32(tH32(bitcast<u32>(i) ^ tH32(bitcast<u32>(j) ^ tH32(k)))) / 4294967296.0; }

struct TCell { at: vec3f, s: f32, nuc: vec3f }
fn tissueCell(i: i32, j: i32) -> TCell {
  var c: TCell;
  var x = (f32(i) + 0.5 * f32(j & 1)) * TISSUE_SP;
  var z = f32(j) * TISSUE_SP * 0.8660254;
  let centre = i == 0 && j == 0;
  if (!centre) { x += (tRand(i, j, 0u) - 0.5) * 0.12 * TISSUE_SP; z += (tRand(i, j, 1u) - 0.5) * 0.12 * TISSUE_SP; }
  c.at = vec3f(x, select(-1800.0 + 3000.0 * tRand(i, j, 3u), 0.0, centre), z);
  c.s = 0.8 + 0.2 * tRand(i, j, 2u);
  let a = tRand(i, j, 4u) * 6.2831853; let cz = tRand(i, j, 5u) * 2.0 - 1.0; let r = sqrt(1.0 - cz * cz);
  c.nuc = vec3f(cos(a) * r, cz, sin(a) * r) * 1500.0;
  return c;
}

// at a point of the plane (nm), a pixel `px` nm across there: the nearest cell's masks; cells whose middles are within
// `skip` of the centre left out (the cell world's own)
fn tissueMasks(p: vec2f, px: f32, skip: f32) -> vec4f {
  let j0 = i32(round(p.y / (TISSUE_SP * 0.8660254)));
  var best = 9.0; var m = vec4f(0.0);
  for (var jj = j0 - 1; jj <= j0 + 1; jj++) {
    let i0 = i32(round(p.x / TISSUE_SP - 0.5 * f32(jj & 1)));
    for (var ii = i0 - 1; ii <= i0 + 1; ii++) {
      let c = tissueCell(ii, jj);
      if (length(c.at.xz) < skip) { continue; }
      let R = vec2f(8800.0, 8600.0) * c.s;
      let r = length((p - c.at.xz) / R);
      if (r >= best) { continue; }
      best = r;
      let aa = px / R.x;
      let inside = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
      // (the membrane seen edge-on round its rim: brighter there, as glass is)
      let rim = inside * smoothstep(0.6, 0.98, r);
      let nr = length((p - c.at.xz - c.nuc.xz) / (vec2f(3000.0, 2900.0) * c.s));
      let na = px / (3000.0 * c.s);
      let nuc = (1.0 - smoothstep(1.0 - na, 1.0 + na, nr)) * inside;
      m = vec4f(inside, rim, nuc, nuc * smoothstep(0.55, 0.95, nr));
    }
  }
  return m;
}
