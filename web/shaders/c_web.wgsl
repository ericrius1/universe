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
  let h = sphereHit(ro, rd, vec3f(0.0), R);
  if (h.y < 0.0) { return vec4f(0.0); }
  // the front and the back of the shell (from inside, only the back)
  var c = vec3f(0.0);
  var a = 0.0;
  for (var k = 0; k < 2; k++) {
    let t = select(h.x, h.y, k == 1);
    if (t < 0.0) { continue; }
    let n = normalize(ro + rd * t);
    let v = cmb(n);
    let warm = vec3f(1.0, 0.42, 0.12);
    let cool = vec3f(0.12, 0.35, 1.0);
    // a thin shell: brighter edge-on
    let edge = 1.0 / max(abs(dot(n, rd)), 0.25);
    let col = mix(cool, warm, ss(-0.3, 0.3, v)) * (0.25 + 0.75 * abs(v) * 2.0) * edge;
    let w = select(0.3, 0.55, k == 0);
    c += col * w;
  }
  // from far outside it, a little brighter; as the view comes inside, it fades to a faint wall
  let fade = ss(R * 0.02, R * 0.6, L.scale);
  return vec4f(c * 0.05 * fade * L.weight, a * fade * L.weight);
}

// The web seen whole: walls and filaments of galaxies round empty voids, as the faces between the cells of a cellular
// noise at two sizes (130 and 38 Mpc), marched through the sphere of the observable universe. Near enough to tell
// galaxies apart, the points take over (Web.ts). L.c: gain, steps.
fn webDensity(p: vec3f) -> vec2f {
  let a = cellular(p / 130.0, 0.95);
  let wall = exp(-(a.d2 - a.d1) * 30.0);
  let b = cellular(p / 38.0 + 7.3, 0.95);
  let fine = exp(-(b.d2 - b.d1) * 26.0);
  // clusters where the fine web's walls meet the coarse one's
  let knot = wall * fine;
  // (voids empty: below a floor, nothing)
  return vec2f(max(wall * (0.35 + 0.65 * fine) + knot * 2.5 - 0.22, 0.0), knot);
}

@fragment fn fs_vol(in: FullscreenOut) -> @location(0) vec4f {
  let rd = rayDir(in.uv);
  let ro = L.eye + L.origin;
  let R = L.b.x;
  let h = sphereHit(ro, rd, vec3f(0.0), R);
  if (h.y < 0.0) { return vec4f(0.0); }
  let t0 = max(h.x, 0.0);
  // (no further than a few view distances: beyond, every ray averages to the same grey)
  let t1 = min(h.y, t0 + 6.0 * L.scale);
  let steps = i32(L.c.y);
  let jit = ign(in.pos.xy);
  var col = vec3f(0.0);
  var tPrev = t0;
  for (var i = 0; i < steps; i++) {
    let u = (f32(i) + jit) / f32(steps);
    let t = t0 + (t1 - t0) * u * u;
    let dt = t - tPrev;
    tPrev = t;
    let p = ro + rd * t;
    let d = webDensity(p);
    let c = mix(vec3f(0.55, 0.68, 1.0), vec3f(1.0, 0.78, 0.5), clamp(d.y * 3.0, 0.0, 1.0));
    // (what's about the view's distance away counts most: from inside, the walls round you, not all 14 Gpc at once)
    let q = t / (2.5 * L.scale);
    col += c * d.x * dt / (1.0 + q * q);
  }
  col /= L.scale;
  // (a hollow round us: our own neighbourhood is drawn as galaxies)
  return vec4f(col * L.c.x * L.weight, 0.0);
}
