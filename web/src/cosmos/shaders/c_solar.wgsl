// The solar system (AU, relative to the level's origin): the Sun — limb-darkened, granulated, in its corona, and a
// point of light when it's smaller than a pixel — the planets as ray-traced spheres on screen-facing quads (lit by the
// Sun; Jupiter's and Saturn's bands, Saturn's rings), never smaller than a dot you can find, and their orbits.
// L.a: sun gain, planet gain, orbit alpha, the Earth's share (the Earth's own level takes over close up).
#include "cosmos.wgsl"
#include "weft/fullscreen"

const SUN_R = 0.00465047;   // AU

struct Planet { pos: vec3f, r: f32, color: vec3f, kind: f32 }
@group(2) @binding(1) var<storage, read> planets: array<Planet>;
@group(2) @binding(2) var<storage, read> orbit: array<vec4f>;   // absolute AU; w: the planet's index

// ---------------------------------------------------------------- the Sun
@fragment fn fs_sun(in: FullscreenOut) -> @location(0) vec4f {
  let rd = rayDir(in.uv);
  let c = L.sunPos - L.eye;
  let d = length(c);
  let cosA = dot(rd, c / d);
  let ang = acos(clamp(cosA, -1.0, 1.0));
  let rAng = SUN_R / d;                       // its angular radius
  let px = max(rAng / L.pxAngle, 1.0);         // in pixels (never less than one)
  var col = vec3f(0.0);
  var a = 0.0;
  let warm = vec3f(1.0, 0.86, 0.66);
  if (ang < rAng) {
    // the photosphere: darker toward the limb, granules, a few spots
    let h = sphereHit(L.eye, rd, L.sunPos, SUN_R);
    let n = normalize(L.eye + rd * h.x - L.sunPos);
    let mu = max(dot(n, -rd), 0.0);
    let limb = 0.4 + 0.6 * pow(mu, 0.55);
    let gran = 0.9 + 0.1 * cellular(n * 160.0 + L.time * 0.02, 1.0).d1;
    let spots = 1.0 - 0.6 * ss(0.62, 0.7, fbm(n * 5.0 + 1.3, 3) * 0.5 + 0.5);
    col = warm * limb * gran * spots * 40.0;
    a = 1.0;
  }
  // the corona and the glare round it: in the Sun's own radii, so it grows as you come near
  let x = ang / max(rAng, L.pxAngle);
  let corona = exp(-max(x - 1.0, 0.0) * 1.6) * 3.0 + 0.6 / (1.0 + x * x * 0.4);
  col += warm * corona * select(1.0, 0.0, ang < rAng);
  // a star's point of light, when the disc is a pixel or less
  let pt = exp(-pow(ang / (L.pxAngle * 1.2), 2.0)) * 50.0 * (1.0 - ss(1.0, 3.0, px));
  col += warm * pt;
  return vec4f(col * L.a.x * L.weight, a * L.weight);
}

// ---------------------------------------------------------------- the planets
struct POut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) idx: u32,
  @location(1) uv: vec2f,
  @location(2) dotPx: f32,
}

@vertex fn vs_planet(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> POut {
  var out: POut;
  out.pos = vec4f(0.0, 0.0, -2.0, 1.0);
  let p = planets[ii];
  if (p.r <= 0.0) { return out; }
  let rel = p.pos - L.eye;
  let c = clipOf(rel);
  if (c.w <= p.r) { return out; }
  let d = length(rel);
  // its radius on screen, the rings' reach for Saturn
  let reach = select(1.0, 2.35, p.kind > 1.5 && p.kind < 2.5);
  let rpx = p.r * reach / (d * L.pxAngle);
  let quad = max(rpx * 1.15, 12.0);
  let k = CORNERS[vi % 6u];
  out.pos = quadCorner(c, k, quad);
  out.idx = ii;
  out.uv = k * quad;
  out.dotPx = rpx / reach;
  return out;
}

fn jupiterBands(n: vec3f, s: f32) -> f32 {
  return 0.5 + 0.5 * sin(n.y * 22.0 * s + fbm(n * 4.0, 3) * 2.5);
}

@fragment fn fs_planet(in: POut) -> @location(0) vec4f {
  let p = planets[in.idx];
  let sunDir = normalize(L.sunPos - p.pos);
  let px = in.dotPx;
  // too small to see as a disc: a soft dot of its colour, lit by its phase
  if (px < 1.5) {
    let r = length(in.uv);
    if (r > 12.0) { discard; }
    let i = exp(-r * r / 3.0) * 1.2 + exp(-r * r / 14.0) * 0.12 * (1.0 - r / 12.0);
    let toEye = normalize(L.eye - p.pos);
    let phase = 0.5 + 0.5 * dot(toEye, sunDir);
    return vec4f(p.color * i * (0.3 + 0.7 * phase) * L.a.y * L.weight, 0.0);
  }
  let rd = rayDir(in.pos.xy * L.view.xy);
  let h = sphereHit(L.eye, rd, p.pos, p.r);
  var col = vec3f(0.0);
  var a = 0.0;
  var tRing = -1.0;
  if (p.kind > 1.5 && p.kind < 2.5) {
    // Saturn's rings: in its equator, tilted 26.7°
    let rn = vec3f(0.0, 0.893, 0.45);
    let t = dot(p.pos - L.eye, rn) / dot(rd, rn);
    let q = L.eye + rd * t - p.pos;
    let rr = length(q) / p.r;
    if (t > 0.0 && rr > 1.24 && rr < 2.27) {
      let band = 0.55 + 0.45 * sin(rr * 60.0) * sin(rr * 13.0);
      let gap = 1.0 - ss(0.0, 0.02, 0.025 - abs(rr - 1.95));
      // the planet's shadow on the rings
      let sh = sphereHit(L.eye + rd * t, sunDir, p.pos, p.r);
      let lit = select(1.0, 0.15, sh.x > 0.0);
      let ra = clamp(band * gap * 0.85, 0.0, 1.0);
      tRing = t;
      col = vec3f(0.85, 0.78, 0.62) * band * lit * (0.4 + 0.6 * abs(dot(sunDir, rn)));
      a = ra;
    }
  }
  if (h.x > 0.0 && (tRing < 0.0 || h.x < tRing || a < 0.99)) {
    let n = normalize(L.eye + rd * h.x - p.pos);
    let lam = max(dot(n, sunDir), 0.0);
    var alb = p.color;
    if (p.kind > 0.5 && p.kind < 2.5) {
      alb = mix(alb * 0.75, alb * 1.15, jupiterBands(n, select(1.0, 0.7, p.kind > 1.5)));
      // the Great Red Spot
      if (p.kind < 1.5) { alb = mix(alb, vec3f(0.75, 0.38, 0.25), exp(-dot(n - normalize(vec3f(0.6, -0.36, 0.7)), n - normalize(vec3f(0.6, -0.36, 0.7))) * 220.0)); }
    } else if (p.kind > 2.5) {
      // rocky: mottled
      alb *= 0.75 + 0.5 * fbm(n * 6.0 + f32(in.idx), 4);
    }
    let atm = pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * select(0.0, 0.5, p.kind < 2.5 || in.idx == 1u) * lam;
    let planet = alb * (lam * 1.4 + 0.015) + p.color * atm;
    if (tRing < 0.0 || h.x < tRing) {
      col = mix(planet, col, select(0.0, a, tRing > 0.0 && tRing < h.x));
      a = 1.0;
    } else {
      col = mix(planet, col, a);
      a = 1.0;
    }
  }
  if (a <= 0.0) { discard; }
  // fade in from the dot
  let k = ss(1.5, 3.0, px);
  return vec4f(col * L.a.y * L.weight * k, a * L.weight * k);
}

// ---------------------------------------------------------------- the orbits
struct OOut { @builtin(position) pos: vec4f, @location(0) a: f32 }
@vertex fn vs_orbit(@builtin(vertex_index) vi: u32) -> OOut {
  var out: OOut;
  let seg = vi / 2u;
  let o = orbit[seg + (vi % 2u)];
  // (a strip per planet: the segment that would join two planets' orbits isn't drawn)
  if (orbit[seg].w != orbit[seg + 1u].w) { out.pos = vec4f(0.0, 0.0, -2.0, 1.0); return out; }
  let rel = (o.xyz - L.origin) - L.eye;
  out.pos = clipOf(rel);
  // fainter as they recede, and where the camera is close to the plane
  out.a = L.a.z * L.weight;
  return out;
}
@fragment fn fs_orbit(in: OOut) -> @location(0) vec4f {
  return vec4f(vec3f(0.45, 0.6, 1.0) * in.a, 0.0);
}
