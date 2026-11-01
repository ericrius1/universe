// The Front Range round the meadow outside Boulder (metres; x east, y up, z south; the meadow at the origin): the
// plains rising gently west to the foothills, the Flatirons — a few great slabs of red sandstone tilted up against
// Green Mountain — and the Indian Peaks beyond, on a curved Earth; the land's colours. Shared by the meadow's level
// (c_ground.wgsl) and the Earth's (c_earth.wgsl), so the Earth seen from orbit and the meadow seen from 50 km agree.
// (after cosmos.wgsl)

const EARTH_M = 6371000.0;

fn ridged(p: vec3f, o: i32) -> f32 { return 1.0 - abs(fbm(p, o) * 2.0); }

// where the foothills begin (x) along the front: wandering a little here, and a few kilometres over a hundred
fn frontX(z: f32) -> f32 {
  return -2600.0 + 380.0 * sin(z / 2100.0) + 120.0 * vnoise(vec3f(0.0, 0.0, z / 900.0))
    + 7000.0 * (vnoise(vec3f(0.0, 5.0, z / 32000.0)) - vnoise(vec3f(0.0, 5.0, 0.0)))
    + 60000.0 * (vnoise(vec3f(0.0, 8.0, z / 300000.0)) - vnoise(vec3f(0.0, 8.0, 0.0)));
}

// the Flatirons: z centre, half-width at the toe, toe west of the front, length up the dip (m)
const SLABS = array<vec4f, 7>(
  vec4f(-4350.0, 560.0, 260.0, 1250.0), vec4f(-3330.0, 430.0, 330.0, 1000.0), vec4f(-2450.0, 520.0, 220.0, 1200.0),
  vec4f(-1650.0, 300.0, 400.0, 750.0), vec4f(-950.0, 420.0, 280.0, 1050.0), vec4f(150.0, 260.0, 450.0, 620.0),
  vec4f(1200.0, 330.0, 330.0, 760.0),
);
// the foothills' smooth rise west of the front (m above the plains), `xr` metres west of it
fn hillMean(xr: f32) -> f32 { return 800.0 * ss(-100.0, 2600.0, xr); }

// the Flatirons at (x, z): (the height of a slab's face, how much of a slab is here 0..1). Each is a tilted plate,
// its face dipping east steeper than the hill it leans on, narrowing to a ragged point near the top
fn flatirons(x: f32, z: f32, x0: f32, oc: i32) -> vec2f {
  if (z < -5000.0 || z > 1600.0) { return vec2f(0.0); }
  let xr = x0 - x;            // metres west of the front
  if (xr < 150.0 || xr > 1800.0) { return vec2f(0.0); }
  var best = vec2f(0.0);
  for (var i = 0; i < 7; i++) {
    let s = SLABS[i];
    let fi = f32(i);
    // up the dip, 0 at the toe and 1 at the top (a weathered, uneven top)
    let top = s.w * (0.92 + 0.1 * vnoise(vec3f(z / 80.0, fi * 3.1, 0.0)) + 0.05 * vnoise(vec3f(z / 25.0, fi, 1.0)));
    let u = (xr - s.z) / top;
    if (u < -0.03 || u > 1.0) { continue; }
    // leaning a little to one side as it rises, its edges notched
    let lean = (fract(sin(fi * 12.9) * 43758.5) - 0.5) * 0.6;
    let dz = z - s.x - lean * s.y * u;
    let wHalf = s.y * pow(max(1.0 - u, 0.0), 1.15) * (0.85 + 0.3 * vnoise(vec3f(xr / 110.0, fi * 5.0, 2.0)));
    let side = ss(wHalf, wHalf - 30.0, abs(dz));
    let toe = ss(-0.03, 0.03, u);
    let k = side * toe;
    if (k <= 0.0) { continue; }
    // the face: a plane from the toe, 33° up the dip, grooved along it
    let toeH = hillMean(s.z);
    var h = toeH + (xr - s.z) * 0.66 + 5.0 * fbm(vec3f(x / 45.0, 0.0, z / 16.0), max(oc - 3, 1));
    // (the hill's own height where the plate thins out at its edges)
    h = mix(hillMean(xr), h, k);
    if (k > best.y) { best = vec2f(h, k); }
  }
  return best;
}

// the land's height and how much of it is a Flatiron at (x, z); `lod` drops octaves with distance
fn front(x: f32, z: f32, lod: f32) -> vec2f {
  let q = vec3f(x, 0.0, z);
  let oc = i32(clamp(7.0 - lod, 2.0, 7.0));
  // the plains: a gentle swell, rising westward to the hills; flat round the meadow where the hand lies
  let r0 = length(vec2f(x, z));
  var h = (fbm(q / 260.0, max(oc - 2, 2)) * 3.0 + fbm(q / 3200.0 + 4.0, 3) * 18.0 - max(x, -12000.0) * 0.012) * ss(25.0, 400.0, r0);
  let curve = (x * x + z * z) / (2.0 * EARTH_M);
  // the foothills and the Flatirons (only west of where they begin)
  let x0 = frontX(z);
  if (x > x0 + 100.0) { return vec2f(h - curve, 0.0); }
  let m = ss(x0 + 100.0, x0 - 2600.0, x);
  // (hillMean is m * 800)
  // ridges and the canyons between them
  let hills = m * (560.0 + 480.0 * ridged(q / 1500.0, oc));
  let slab = flatirons(x, z, x0, oc);
  // the slabs lean on the hill (standing proud of its smooth mean, not its ridges)
  h += select(hills, max(hills, mix(hills, slab.x, ss(0.0, 0.3, slab.y))), slab.y > 0.0);
  // the high peaks, 10–25 km west of the front, valleys running down between them
  let xr = x0 - x;
  if (xr > 6500.0) {
    let far = ss(6500.0, 21000.0, xr);
    h += far * (450.0 + 900.0 * ridged(q / 5200.0 + 2.0, max(oc - 1, 2)) - 450.0 * (1.0 - ridged(q / 17000.0 + 7.0, 3)));
  }
  // the Earth curves away
  return vec2f(h - curve, slab.y);
}
fn terrain(x: f32, z: f32, lod: f32) -> f32 { return front(x, z, lod).x; }

fn terrainNormal(x: f32, z: f32, e: f32, lod: f32) -> vec3f {
  let h0 = terrain(x, z, lod);
  return normalize(vec3f(h0 - terrain(x + e, z, lod), e, h0 - terrain(x, z + e, lod)));
}

fn meadow(p: vec3f, dist: f32) -> vec3f {
  let q = vec3f(p.x, 0.0, p.z);
  let patchy = fbm(q / 18.0, 4) * 0.5 + 0.5;
  var c = mix(vec3f(0.09, 0.12, 0.04), vec3f(0.28, 0.25, 0.1), ss(0.35, 0.75, patchy));
  c *= 0.8 + 0.4 * fbm(q * 3.0, 3) * ss(60.0, 5.0, dist);
  return c;
}

// the plains east of the foothills: farm parcels and the roads between them; Boulder's grid to the north. `px` the
// size of a pixel there (m): what's smaller than a few fades to its average
fn plains(p: vec3f, dist: f32, px: f32) -> vec3f {
  let sz = vec2f(420.0, 310.0);
  let cell = floor(p.xz / sz);
  let h = hash3i(vec3i(i32(cell.x), i32(cell.y), 77));
  let avg = vec3f(0.2, 0.19, 0.085);
  var c = mix(vec3f(0.3, 0.25, 0.11), vec3f(0.1, 0.15, 0.05), h.x);
  c = mix(c, vec3f(0.2, 0.14, 0.08), step(0.82, h.y));
  // furrows and texture within a parcel
  c *= 0.85 + 0.25 * vnoise(vec3f(p.x / 40.0 * select(1.0, 6.0, h.z > 0.5), 0.0, p.z / 40.0 * select(6.0, 1.0, h.z > 0.5)));
  let f = fract(p.xz / sz) * sz;
  let road = min(min(f.x, sz.x - f.x), min(f.y, sz.y - f.y));
  c = mix(c, vec3f(0.24, 0.23, 0.22), ss(5.0, 2.5, road + dist * 0.0004) * ss(40.0, 10.0, px));
  c = mix(c, avg * (0.85 + 0.3 * vnoise(vec3f(p.x / 3000.0, 1.0, p.z / 3000.0))), ss(120.0, 400.0, px));
  // irrigated green and dry brown over kilometres, and the reservoirs
  let big = fbm(vec3f(p.x / 9000.0, 3.0, p.z / 9000.0), 3);
  c *= mix(vec3f(1.15, 1.0, 0.85), vec3f(0.7, 0.95, 0.75), ss(-0.2, 0.3, big));
  let lake = ss(0.9, 0.93, vnoise(vec3f(p.x / 1300.0, 9.0, p.z / 1300.0)) + 0.2 * vnoise(vec3f(p.x / 9000.0, 2.0, p.z / 9000.0))) * ss(3000.0, 5000.0, length(p.xz));
  c = mix(c, vec3f(0.015, 0.03, 0.045), lake);
  // the town: a street grid, roofs, trees
  let tw = p.xz + 2200.0 * vec2f(fbm(vec3f(p.xz / 2600.0, 1.0), 3), fbm(vec3f(p.xz / 2600.0, 4.0), 3));
  let town = ss(-1500.0, -2300.0, tw.y) * ss(-2300.0, -1400.0, tw.x) * ss(3200.0, 2400.0, tw.x) * ss(-9000.0, -8000.0, tw.y);
  if (town > 0.0) {
    let bs = 95.0;
    let b = fract(p.xz / bs) * bs;
    let street = min(min(b.x, bs - b.x), min(b.y, bs - b.y));
    let lot = hash3i(vec3i(i32(floor(p.x / 32.0)), i32(floor(p.z / 28.0)), 5));
    var t = mix(vec3f(0.36, 0.3, 0.27), vec3f(0.42, 0.42, 0.44), lot.x);
    t = mix(t, vec3f(0.06, 0.1, 0.04), step(0.55, lot.y) * 0.85);
    t = mix(t, vec3f(0.2, 0.2, 0.21), ss(7.0, 4.0, street));
    t = mix(t, vec3f(0.15, 0.16, 0.12), ss(30.0, 90.0, px));
    c = mix(c, t, town);
  }
  return c;
}

// the land's colour at p (n its normal, dist from the eye, px a pixel's size there, all metres)
fn landColor(p: vec3f, n: vec3f, dist: f32, px: f32) -> vec3f {
  let slope = 1.0 - n.y;
  // the forest, the treeline and the snow go by the land's broad height above the plains (not the curved Earth's
  // tangent plane), the same however finely the land's drawn
  let fr = front(p.x, p.z, 5.0);
  let hy = fr.x + (p.x * p.x + p.z * p.z) / (2.0 * EARTH_M);
  // the meadow round the hand and at the foot of the hills, parcels beyond
  let x0 = frontX(p.z);
  var c = mix(meadow(p, dist), plains(p, dist, px), ss(220.0, 600.0, length(p.xz)) * ss(x0 + 600.0, x0 + 1400.0, p.x));
  // ponderosa and spruce on the foothills (dark conifer green, thinning to grassy clearings) up to the treeline,
  // tundra and scree above it, snow on the highest and in the north-facing hollows
  let tree = ss(2150.0, 1850.0, hy + 180.0 * fbm(p / 900.0, 3));
  let forest = ss(65.0, 245.0, hy) * ss(0.8, 0.4, slope) * tree;
  c = mix(c, vec3f(0.15, 0.135, 0.1) * (0.8 + 0.4 * fbm(p / 150.0, 3)), ss(1850.0, 2150.0, hy) * (1.0 - tree));
  let clear = ss(0.15, 0.45, fbm(p / 300.0 + 11.0, 3)) * ss(2600.0, 1900.0, hy) * 0.6;
  var trees = vec3f(0.03, 0.048, 0.016) * (0.7 + 0.6 * vnoise(p / 25.0));
  trees = mix(trees, vec3f(0.13, 0.12, 0.06), clear * ss(30.0, 300.0, px) * 0.5 + clear * 0.4);
  c = mix(c, trees, forest);
  // (the trees reach up the slabs' toes and ragged edges)
  let fl = ss(0.5, 0.8, fr.y + 0.25 * fbm(p / 35.0, 3));
  let rock = max(ss(0.42, 0.7, slope), fl);
  // the sandstone: rust red, darker in its grooves and streaked with lichen
  let sand = mix(vec3f(0.25, 0.125, 0.075), vec3f(0.14, 0.125, 0.1), ss(0.1, 0.5, fbm(vec3f(p.x / 60.0, p.y / 20.0, p.z / 9.0), 3)))
    * (0.75 + 0.35 * fbm(vec3f(p.x / 30.0, p.y / 8.0, p.z / 14.0), 3));
  c = mix(c, mix(vec3f(0.17, 0.15, 0.12), sand, fl), rock);
  c = mix(c, vec3f(0.9, 0.92, 0.95), ss(2350.0, 2600.0, hy + 250.0 * fbm(p / 400.0, 3) - 300.0 * n.z) * ss(0.7, 0.4, slope));
  return c;
}
