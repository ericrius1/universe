// The solar system (AU). Everything here is placed relative to the camera (worked out in doubles: levels/solar.ts), so a
// planet close up keeps its precision wherever the camera has gone; only the orbits are relative to the level's origin.
//   the Sun     a light: its disc darkened toward the limb as the photosphere is, far brighter than anything it lights
//               (the bloom makes its glare), a faint corona, and a point of light when it's smaller than a pixel
//   the bodies  ray-traced on screen-facing quads, never smaller than a dot you can find: Mercury, Mars, Jupiter and
//               Saturn from their maps, turned as the IAU has them; Venus, Uranus and Neptune by a simple model of their
//               cloud-tops (no honest map of them exists: see each below); the giants squashed at their poles and
//               darkened toward their limbs; Saturn's rings from the measured optical depth along their radius, lit on
//               either face, shadowed by the planet and shadowing it; the Moon, the dwarf planets, Halley's comet and the
//               Voyagers as dots
//   the orbits  the planets', the dwarf planets', Halley's, and the Voyagers' paths out since their last flybys
// L.a: sun gain, planet gain, orbit alpha, -.
#include "cosmos.wgsl"
#include "weft/fullscreen"

const SUN_R = 0.00465047;   // AU

struct Body {
  pos: vec3f, r: f32,          // its centre from the camera (AU); equatorial radius (AU; 0: not drawn)
  color: vec3f, kind: f32,     // its colour as a dot; what it is (K_*)
  pole: vec3f, flat: f32,      // its north pole (unit); its flattening
  mer: vec3f, layer: f32,      // its prime meridian (unit); its map's layer (-1: none)
}
@group(2) @binding(1) var<storage, read> bodies: array<Body>;
@group(2) @binding(2) var<storage, read> orbit: array<vec4f>;   // absolute AU; w: its orbit's index
@group(2) @binding(3) var maps: texture_2d_array<f32>;          // Mercury, Mars, Jupiter, Saturn (sRGB)
@group(2) @binding(4) var ringTau: texture_2d<f32>;              // Saturn's rings' normal optical depth, 72,000–142,500 km

const K_ROCK = 0.0;      // Mercury, Mars: a map
const K_VENUS = 1.0;
const K_EARTH = 2.0;     // a stand-in until the Earth's own level has its maps
const K_GIANT = 3.0;     // Jupiter: a map
const K_SATURN = 4.0;    // and its rings
const K_ICE = 5.0;       // Uranus, Neptune
const K_MOON = 6.0;
const K_SMALL = 7.0;     // dwarf planets, a comet
const K_CRAFT = 8.0;     // a spacecraft

const RING_IN = 72000.0;
const RING_OUT = 142500.0;
const SATURN_EQ = 60268.0;

// ---------------------------------------------------------------- the Sun
@fragment fn fs_sun(in: FullscreenOut) -> @location(0) vec4f {
  let rd = rayDir(in.uv);
  let c = L.sunPos;
  let d = length(c);
  let cosA = dot(rd, c / d);
  let ang = acos(clamp(cosA, -1.0, 1.0));
  let rAng = SUN_R / d;                        // its angular radius
  let px = max(rAng / L.pxAngle, 1.0);         // in pixels (never less than one)
  var col = vec3f(0.0);
  var a = 0.0;
  let warm = vec3f(1.0, 0.86, 0.66);
  if (ang < rAng) {
    // the photosphere, darker and redder toward the limb (I(μ) = 1 − u(1 − μ), u larger in the blue: Neckel & Labs)
    let s = sin(ang) / sin(rAng);
    let mu = sqrt(max(1.0 - s * s, 0.0));
    let limb = vec3f(1.0) - vec3f(0.48, 0.6, 0.72) * (1.0 - mu);
    col = warm * limb * 40.0;
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

// ---------------------------------------------------------------- the bodies
struct POut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) idx: u32,
  @location(1) uv: vec2f,
  @location(2) dotPx: f32,
}

@vertex fn vs_planet(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> POut {
  var out: POut;
  out.pos = vec4f(0.0, 0.0, -2.0, 1.0);
  let p = bodies[ii];
  if (p.r <= 0.0) { return out; }
  let c = clipOf(p.pos);
  if (c.w <= p.r * 2.5) { return out; }
  let d = length(p.pos);
  // its radius on screen, the rings' reach for Saturn
  let reach = select(1.0, 2.42, p.kind == K_SATURN);
  let rpx = p.r * reach / (d * L.pxAngle);
  let quad = max(rpx * 1.15, 12.0);
  let k = CORNERS[vi % 6u];
  out.pos = quadCorner(c, k, quad);
  out.idx = ii;
  out.uv = k * quad;
  out.dotPx = rpx / reach;
  return out;
}

// a ray against a body squashed along its pole: (near, far) along the ray, or -1
fn bodyHit(ro: vec3f, rd: vec3f, b: Body) -> vec2f {
  // (stretched along the pole until it's a sphere of its equatorial radius)
  let s = 1.0 / (1.0 - b.flat);
  let o = ro + b.pole * (dot(ro, b.pole) * (s - 1.0));
  let d = rd + b.pole * (dot(rd, b.pole) * (s - 1.0));
  let A = dot(d, d);
  let B = dot(o, d);
  let C = dot(o, o) - b.r * b.r;
  let h = B * B - A * C;
  if (h < 0.0) { return vec2f(-1.0); }
  let q = sqrt(h);
  return vec2f((-B - q) / A, (-B + q) / A);
}
fn bodyNormal(q: vec3f, b: Body) -> vec3f {
  let s = 1.0 / (1.0 - b.flat);
  return normalize(q + b.pole * (dot(q, b.pole) * (s * s - 1.0)));
}

// Henyey–Greenstein, normalised over the sphere; c the cosine of the angle the light turns through (1: straight on)
fn hg(g: f32, c: f32) -> f32 { return (1.0 - g * g) / (4.0 * PI * pow(max(1.0 + g * g - 2.0 * g * c, 1e-4), 1.5)); }

// the rings' optical depth at a radius (km), at a mip for a footprint (km)
fn tauAt(rKm: f32, foot: f32) -> f32 {
  let u = (rKm - RING_IN) / (RING_OUT - RING_IN);
  if (u <= 0.0 || u >= 1.0) { return 0.0; }
  let lod = log2(max(foot / 10.0, 1.0));
  return textureSampleLevel(ringTau, samp_linear, vec2f(u, 0.5), lod).r;
}
// the rings' colour by region (no public-domain colour profile was assembled, data/planets/planets.json: a guess from
// Cassini's pictures — the C ring and the Cassini division grey and dark, the B ring the warmest, the A ring between)
fn ringAlbedo(rKm: f32) -> vec3f {
  let c = vec3f(0.30, 0.29, 0.27);
  let b = vec3f(0.62, 0.53, 0.42);
  let a = vec3f(0.52, 0.47, 0.40);
  var col = mix(c, b, ss(91000.0, 93500.0, rKm));
  col = mix(col, vec3f(0.34, 0.32, 0.30), ss(117000.0, 118000.0, rKm) * (1.0 - ss(121500.0, 122500.0, rKm)));
  col = mix(col, a, ss(121500.0, 122500.0, rKm));
  return col;
}

// the cloud-tops of the planets no honest map exists of: a simple model, not data
//   Venus: a featureless pale yellow in visible light (its famous Y-shaped markings are in ultraviolet), faint bands
//   Uranus: pale cyan from methane, nearly featureless; its north polar cap brighter (the pole now turned to the Sun)
//   Neptune: a deeper blue, a few faint bands
fn modelAlbedo(b: Body, lat: f32, elon: f32) -> vec3f {
  let sl = sin(lat);
  if (b.kind == K_VENUS) { return vec3f(0.93, 0.86, 0.68) * (0.97 + 0.03 * sin(lat * 9.0 + elon * 0.5)); }
  if (b.color.r > 0.5) {
    // (Uranus)
    let cap = ss(0.55, 0.85, sl);
    return mix(vec3f(0.62, 0.82, 0.86) * (0.97 + 0.03 * sin(lat * 14.0)), vec3f(0.78, 0.9, 0.92), cap);
  }
  return vec3f(0.33, 0.47, 0.82) * (0.93 + 0.07 * sin(lat * 11.0) + 0.04 * sin(lat * 27.0));
}

@fragment fn fs_planet(in: POut) -> @location(0) vec4f {
  let p = bodies[in.idx];
  let sunDir = normalize(L.sunPos - p.pos);
  let px = in.dotPx;
  let dotK = select(1.0, select(0.35, 0.22, p.kind == K_CRAFT), p.kind >= K_SMALL);
  // too small to see as a disc: a soft dot of its colour, lit by its phase
  if (px < 1.5 || p.kind >= K_SMALL) {
    let r = length(in.uv);
    if (r > 12.0) { discard; }
    let i = exp(-r * r / 3.0) * 1.2 + exp(-r * r / 14.0) * 0.12 * (1.0 - r / 12.0);
    let toEye = normalize(-p.pos);
    let phase = select(0.5 + 0.5 * dot(toEye, sunDir), 1.0, p.kind == K_CRAFT);
    return vec4f(p.color * i * (0.3 + 0.7 * phase) * dotK * L.a.y * L.weight, 0.0);
  }
  let rd = rayDir(in.pos.xy * L.view.xy);
  // (from the body's centre: the camera is at -pos)
  let ro = -p.pos;
  let h = bodyHit(ro, rd, p);
  var col = vec3f(0.0);
  var a = 0.0;
  var tRing = -1.0;
  var ringT = 1.0;
  let pole = p.pole;
  let rKmPer = SATURN_EQ / p.r;   // km per AU about Saturn
  if (p.kind == K_SATURN) {
    // its rings, in its equator
    let t = -dot(ro, pole) / dot(rd, pole);
    let q = ro + rd * t;
    let rr = length(q) * rKmPer;
    if (t > 0.0 && rr > RING_IN && rr < RING_OUT) {
      let mu = max(abs(dot(rd, pole)), 1e-3);
      let mu0 = max(abs(dot(sunDir, pole)), 1e-3);
      let foot = t * L.pxAngle * rKmPer / mu;
      let tau = tauAt(rr, foot);
      // the planet's shadow on them
      let sh = bodyHit(q, sunDir, p);
      let lit = select(1.0, 0.0, sh.y > 0.0);
      // the light the ring's particles send back on the side the Sun lights, or let through to the other: single
      // scattering through a slab (Chandrasekhar), its phase two-lobed — the particles mostly back-scatter, the dust among
      // them throws light forward, so they brighten with the Sun behind them
      let cosT = dot(-sunDir, -rd);
      let ph = 0.75 * hg(-0.3, cosT) + 0.25 * hg(0.65, cosT);
      let sameSide = dot(sunDir, pole) * dot(-rd, pole) > 0.0;
      var I = 0.0;
      if (sameSide) { I = mu0 / (mu0 + mu) * (1.0 - exp(-tau * (1.0 / mu0 + 1.0 / mu))); }
      else if (abs(mu0 - mu) > 1e-3) { I = mu0 / (mu0 - mu) * (exp(-tau / mu0) - exp(-tau / mu)); }
      else { I = tau / mu * exp(-tau / mu); }
      tRing = t;
      ringT = exp(-tau / mu);
      // (π: the planets here are lit at albedo × μ0, a Lambertian's radiance times π, and so are the rings)
      // (the denser rings' particles brighter: the B ring outshines the C ring and the Cassini division even where the
      // slab is opaque either way)
      col = ringAlbedo(rr) * (0.45 + 0.55 * ss(0.05, 1.8, tau)) * ph * max(I, 0.0) * lit * PI * 1.4;
      a = 1.0 - ringT;
    }
  }
  if (h.x > 0.0) {
    let q = ro + rd * h.x;
    let n = bodyNormal(q, p);
    let mu0 = dot(n, sunDir);
    let mu = max(dot(n, -rd), 1e-3);
    // where on the body: its latitude (the normal's: planetographic) and east longitude from its prime meridian
    let east = cross(pole, p.mer);
    let lat = asin(clamp(dot(n, pole), -1.0, 1.0));
    let qd = normalize(q);
    let elon = atan2(dot(qd, east), dot(qd, p.mer));
    var alb = p.color;
    // its map: each map's own longitude at its left edge (planets.json), at the mip a pixel's footprint asks for
    if (p.layer >= 0.0) {
      let uoff = select(0.5, 0.0, p.kind == K_SATURN);
      // (Jupiter's map is in planetocentric latitude)
      let la = select(lat, asin(clamp(dot(qd, pole), -1.0, 1.0)), p.kind == K_GIANT);
      let uv = vec2f(fract(elon / (2.0 * PI) + uoff), 0.5 - la / PI);
      let foot = h.x * L.pxAngle / max(mu, 0.15);
      let lod = log2(max(foot / (2.0 * PI * p.r / 2048.0), 1.0));
      alb = textureSampleLevel(maps, samp_repeat, uv, i32(p.layer), lod).rgb;
      // (the Viking mosaic's colourised dark regions lean blue: held to the grey-brown Mars shows)
      if (in.idx == 3u) { alb = vec3f(alb.r, alb.g, min(alb.b, alb.g * 0.9)); }
      // (Mercury's map is enhanced colour: held back toward the grey it looks to the eye)
      if (in.idx == 1u) { alb = mix(vec3f(dot(alb, vec3f(0.2126, 0.7152, 0.0722))), alb, 0.25) * 0.9; }
    } else if (p.kind == K_VENUS || p.kind == K_ICE) {
      alb = modelAlbedo(p, lat, elon);
    } else if (p.kind == K_EARTH) {
      alb = mix(vec3f(0.05, 0.1, 0.22), vec3f(0.7), ss(0.55, 0.75, fbm(n * 6.0, 3) * 0.5 + 0.5));
    } else if (p.kind == K_MOON) {
      alb = vec3f(0.12) * (0.8 + 0.4 * fbm(n * 5.0 + 3.0, 3));
    }
    // how it sends the light back: the rocky bodies after Lommel–Seeliger (no limb darkening, as the full Moon has
    // none), the clouds of the giants after Minnaert with k > 1 (darker toward the limb), Venus's flatter
    var shade = 0.0;
    if (mu0 > 0.0) {
      if (p.kind == K_ROCK || p.kind == K_MOON) { shade = 2.0 * mu0 / (mu0 + mu) * mix(0.5, 1.0, mu0); }
      else if (p.kind == K_GIANT || p.kind == K_SATURN) { shade = pow(mu0, 1.1) * pow(mu, 0.1); }
      else if (p.kind == K_ICE) { shade = pow(mu0, 1.25) * pow(mu, 0.25); }
      else if (p.kind == K_VENUS) { shade = pow(mu0, 0.75) * pow(mu, -0.25); }
      else { shade = mu0; }
    }
    // the rings' shadow on Saturn: its light through them, along the Sun's way to it
    var sunT = 1.0;
    if (p.kind == K_SATURN) {
      let ts = -dot(q, pole) / dot(sunDir, pole);
      if (ts > 0.0) {
        let rs = length(q + sunDir * ts) * rKmPer;
        let mu0r = max(abs(dot(sunDir, pole)), 1e-3);
        sunT = exp(-tauAt(rs, 200.0) / mu0r);
      }
    }
    // (a little haze over the limbs of the bodies with air)
    let haze = select(0.0, 0.08, p.kind == K_VENUS || (p.kind >= K_GIANT && p.kind <= K_ICE)) * pow(1.0 - mu, 4.0) * ss(-0.15, 0.3, mu0);
    let planet = alb * shade * sunT * 1.4 + p.color * haze;
    if (tRing > 0.0 && tRing < h.x) { col = col + planet * ringT; }
    else { col = planet; }
    a = 1.0;
  }
  if (a <= 0.0) { discard; }
  // fade in from the dot
  let k = ss(1.5, 3.0, px);
  return vec4f(col * L.a.y * L.weight * k, a * L.weight * k);
}

// ---------------------------------------------------------------- the orbits
struct OOut { @builtin(position) pos: vec4f, @location(0) col: vec3f }
@vertex fn vs_orbit(@builtin(vertex_index) vi: u32) -> OOut {
  var out: OOut;
  let seg = vi / 2u;
  let o = orbit[seg + (vi % 2u)];
  // (a strip per body: the segment that would join two of them isn't drawn)
  if (orbit[seg].w != orbit[seg + 1u].w) { out.pos = vec4f(0.0, 0.0, -2.0, 1.0); return out; }
  let rel = (o.xyz - L.origin) - L.eye;
  out.pos = clipOf(rel);
  // the planets' in blue, the dwarf planets' fainter and greyer, Halley's warm, the Voyagers' paths white
  let k = o.w;
  var c = vec3f(0.45, 0.6, 1.0);
  if (k >= 8.0) { c = vec3f(0.5, 0.52, 0.6) * 0.45; }
  if (k >= 14.0) { c = vec3f(0.9, 0.62, 0.4) * 0.6; }
  if (k >= 15.0) { c = vec3f(0.7, 0.7, 0.7) * 0.5; }
  out.col = c * L.a.z * L.weight;
  return out;
}
@fragment fn fs_orbit(in: OOut) -> @location(0) vec4f {
  return vec4f(in.col, 0.0);
}
