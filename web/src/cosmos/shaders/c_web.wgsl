// The edge of the observable universe: the cosmic microwave background, the light of the last-scattering surface
// 14 billion parsecs away, as a thin glowing shell with its anisotropies (a warm and cool mottle of a few sizes),
// seen from outside it as a sphere at the top of the zoom and as a faint wall from within. L.b.x: its radius (Mpc).
#include "cosmos.wgsl"
#include "weft/fullscreen"

fn cmb(n: vec3f) -> f32 {
  // Planck's sky: fine mottle on every scale down to a degree or so
  return fbm(n * 9.0, 4) * 0.45 + fbm(n * 34.0 + 4.0, 4) * 0.35 + vnoise(n * 120.0) * 0.2;
}

@fragment fn fs_cmb(in: FullscreenOut) -> @location(0) vec4f {
  let rd = rayDir(in.uv);
  let ro = L.eye + L.origin;
  let R = L.b.x;
  // a shell of light (thin: a few per cent of its radius): each side glows by the length of it the ray crosses, so it
  // is faint face-on and bright round its rim, and the far side shows through the near one
  let Ri = R * 0.975;
  let b = dot(ro, rd);
  let imp2 = max(dot(ro, ro) - b * b, 0.0);
  let side = (sqrt(max(R * R - imp2, 0.0)) - sqrt(max(Ri * Ri - imp2, 0.0))) / (R - Ri);
  // (and a soft halo just outside it)
  let halo = exp(-max(sqrt(imp2) - R, 0.0) / (R * 0.025)) * select(0.0, 0.5, imp2 > R * R && b < 0.0);
  let h = sphereHit(ro, rd, vec3f(0.0), R);
  var c = vec3f(0.0);
  let warm = vec3f(1.0, 0.42, 0.12);
  let cool = vec3f(0.12, 0.35, 1.0);
  if (h.y > 0.0) {
    // the front and the back of the shell (from inside, only the back)
    for (var k = 0; k < 2; k++) {
      let t = select(h.x, h.y, k == 1);
      if (t < 0.0) { continue; }
      let n = normalize(ro + rd * t);
      let v = cmb(n);
      let col = mix(cool, warm, ss(-0.3, 0.3, v)) * (0.35 + 1.3 * abs(v));
      c += col * side * select(0.4, 0.6, k == 0);
    }
  }
  c += mix(cool, warm, 0.45) * halo * 2.0;
  // from far outside it, a little brighter; as the view comes inside, it fades to a faint wall
  let fade = ss(R * 0.02, R * 0.6, L.scale);
  return vec4f(c * 0.016 * fade * L.weight, 0.0);
}

// The web seen whole: filaments of galaxies where the walls between the cells of a cellular noise at two sizes (130
// and 38 Mpc) cross, knotted into clusters where they meet, round black voids; marched through the sphere of the
// observable universe. Near enough to tell galaxies apart, the points take over (Web.ts). L.c: gain, steps.
// distances to the nearest three jittered points of a cellular noise: a Voronoi cell's face where the first two are
// nearly equal, its edge where all three are
fn cell3(p: vec3f) -> vec3f {
  let i = vec3i(floor(p));
  var d = vec3f(9.0);
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let g = i + vec3i(x, y, z);
        let e = length(p - (vec3f(g) + 0.5 + (hash3i(g) - 0.5) * 0.95));
        if (e < d.x) { d = vec3f(e, d.x, d.y); } else if (e < d.y) { d = vec3f(d.x, e, d.y); } else if (e < d.z) { d.z = e; }
      }
    }
  }
  return d;
}

// (x: how much, y: how much of it is a cluster's hot gold rather than a filament's blue; `soft` >= 1 widens it, as
// dimly, where the march's steps are too long to find something so thin)
fn webDensity(p: vec3f, soft: f32) -> vec2f {
  let a = cell3(p / 130.0);
  let wall = exp(-(a.y - a.x) * 40.0 / soft);
  // (deep in a void there's nothing to find at the finer size: skip it)
  if (wall < 0.05) { return vec2f(0.0); }
  // the great filaments along the big cells' edges; finer ones over their walls; clusters where they cross
  let big = exp(-(a.z - a.x) * 95.0 / soft);
  let b = cell3(p / 38.0 + 7.3);
  let fine = exp(-(b.z - b.x) * 70.0 / soft) * wall;
  let knot = big * exp(-(b.z - b.x) * 25.0 / soft);
  return vec2f(max(big * 2.0 + fine * 1.1 + knot * 14.0 + wall * 0.01 - 0.03, 0.0) / pow(soft, 1.5), ss(0.06, 0.3, knot));
}

@fragment fn fs_vol(in: FullscreenOut) -> @location(0) vec4f {
  let rd = rayDir(in.uv);
  let ro = L.eye + L.origin;
  let R = L.b.x;
  let h = sphereHit(ro, rd, vec3f(0.0), R);
  if (h.y < 0.0) { return vec4f(0.0); }
  let t0 = max(h.x, 0.0);
  // (no further than a few view distances: beyond, every ray averages to the same grey)
  let t1 = min(h.y, t0 + 3.0 * L.scale);
  let steps = i32(L.c.y);
  let jit = ign(in.pos.xy);
  var col = vec3f(0.0);
  var tPrev = t0;
  // (a slow drift of the filaments' hue across the sky)
  let fil = mix(vec3f(0.42, 0.55, 1.0), vec3f(0.62, 0.5, 0.95), vnoise((ro + rd * L.scale) / 900.0) * 0.5 + 0.5);
  for (var i = 0; i < steps; i++) {
    let u = (f32(i) + jit) / f32(steps);
    let t = t0 + (t1 - t0) * u * u;
    let dt = t - tPrev;
    tPrev = t;
    let p = ro + rd * t;
    let d = webDensity(p, clamp(dt / 6.0, 1.0, 3.0));
    if (d.x <= 0.0) { continue; }
    // filaments cool blue-violet, clusters hot gold
    let c = mix(fil, vec3f(1.0, 0.62, 0.28) * 1.4, d.y);
    // (what's about the view's distance away counts most: from inside, the walls round you, not all 14 Gpc at once)
    let q = t / (1.3 * L.scale);
    col += c * d.x * dt / (1.0 + q * q * q * q);
  }
  col *= L.c.x / L.scale;
  // (the faint sum of everything far behind kept down, so the voids stay black and the filaments stand out)
  col = col * col / (col + vec3f(0.05));
  // (a hollow round us: our own neighbourhood is drawn as galaxies)
  return vec4f(col * L.weight, 0.0);
}
