// The Milky Way as a volume (kiloparsecs, its centre at the frame's origin), made from a face-on map of it (NASA/JPL-
// Caltech/R. Hurt's, an artist's concept built on Spitzer's survey: levels/galaxy.ts): the map's colour is the light,
// laid out of the plane in a layer thicker round the bulge, and its dust (the map's own dark lanes) absorbs only, in a
// thinner layer. Marched through its slab, the steps gathered where the ray crosses the plane; from the Sun's place in
// it the same march draws the band of the Milky Way across the sky, until the band is the real one: the sky's picture
// (NASA's Deep Star Maps), with the march's steps falling away as it takes over. L.a: emission gain, dust gain, steps,
// how far inside the disc; L.b.x the diffuse dust that follows the light (per unit of it); L.d: x the map's share (0 till it's in, fading up as it comes), y the band's gain, z 1 once
// the sky's picture is in, w the fraction of the frame's resolution it's drawn at.
#include "cosmos.wgsl"
#include "weft/fullscreen"

// the sky (levels/galaxy.ts, havens/sky/milkyway.webp): celestial J2000 plate carrée, right ascension 0 at the centre
// increasing to the left, declination +90° at the top, each channel stored as its cube root
@group(2) @binding(3) var milkyTex: texture_2d<f32>;
// the face-on map (sRGB colour) with its dust in alpha (0 clear, 1 the darkest lane), seen from the north galactic pole:
// the centre in the middle, the Sun below it (+v), l = 90° to the left (−u)
@group(2) @binding(5) var faceTex: texture_2d<f32>;

// the map's width (kpc): 39.25 as drawn, scaled by 8.2 / 7.65 so its Sun lands where the ladder's is (galaxymap.ts)
const MAP_W = 42.05;
// the dust's layer (kpc, an exponential's scale height)
const DUST_H = 0.09;

struct Gal { glow: vec3f, dust: f32 }

// the light's scale height (kpc): a thin disc, swelling round the bar and bulge (as galaxymap.ts scaleHeight)
fn scaleHeight(r: f32) -> f32 { return 0.2 + 0.55 * exp(-(r * r) / (2.4 * 2.4)); }

fn galaxy(p: vec3f, lod: f32) -> Gal {
  var g: Gal;
  let m = textureSampleLevel(faceTex, samp_linear, vec2f(0.5 - p.z / MAP_W, 0.5 + p.x / MAP_W), lod);
  let h = scaleHeight(length(p.xz));
  let z = abs(p.y);
  // (each normalised through the layer, so face on the light is the map's and the dust's its own)
  g.glow = m.rgb * (exp(-z / h) / (2.0 * h));
  g.dust = (m.a + L.b.x * dot(m.rgb, vec3f(0.3, 0.5, 0.2))) * (exp(-z / DUST_H) / (2.0 * DUST_H));
  return g;
}

// the Milky Way as the Sun sees it: a band along the galactic plane, broad and warm toward the centre (in
// Sagittarius, along −x, where it swells round the bulge), knotted into star clouds, split by dark lanes of dust (the
// Great Rift), its edges fading softly into the sky
fn milkyWay(rd: vec3f) -> vec3f {
  let b = asin(clamp(rd.y, -1.0, 1.0));
  let l = atan2(rd.z, -rd.x);                       // 0 toward the centre
  let toC = 0.5 + 0.5 * cos(l);                     // 1 toward the centre, 0 away
  let width = 0.07 + 0.09 * toC * toC;
  // a bright core across the plane, and wide soft wings fading off it (no edge to it)
  let band = exp(-pow(abs(b) / width, 1.4)) * 0.75 + exp(-pow(abs(b) / (width + 0.22), 1.2)) * 0.25 * (0.6 + 0.4 * toC);
  // the bulge round Sagittarius: brighter, and a broad glow round it
  let bulge = exp(-(l * l + b * b * 4.0) / 0.12) * 2.2 + exp(-(l * l + b * b * 5.0) / 0.5) * 0.25;
  let dir = vec3f(cos(l), sin(l), b * 3.0);
  // (the star clouds knot the core; the wings stay smooth)
  let clouds = 0.55 + (0.9 * max(fbm(dir * 6.0, 5), -0.3) + 0.5 * max(fbm(dir * 22.0 + 3.0, 4), -0.2)) * ss(2.6, 0.8, abs(b) / width);
  // the dust: thin dark lanes hugging the plane, strongest toward the centre
  let lane = exp(-pow((b - 0.012 * sin(l * 3.0) - 0.02 * fbm(dir * 9.0, 3)) / (0.018 + 0.03 * toC), 2.0));
  let rift = clamp(lane * (0.5 + 0.8 * max(fbm(dir * 14.0 + 7.0, 4) + 0.3, 0.0)) * (0.35 + 0.65 * toC), 0.0, 0.95);
  let c = mix(vec3f(0.7, 0.75, 0.95), vec3f(1.0, 0.82, 0.62), min(toC * 0.8 + bulge * 0.2, 1.0));
  return c * (band * clouds + bulge) * (1.0 - rift) + vec3f(0.02, 0.022, 0.03) * band;
}

// the galaxy's axes (−x toward the centre, y the north galactic pole, z toward l = 90°) in equatorial ones (J2000:
// x toward right ascension 0, z the north celestial pole): the centre, l = 90° and the pole, as the IAU's matrix has them
const GAL_C = vec3f(-0.0548755604, -0.8734370902, -0.4838350155);
const GAL_L90 = vec3f(0.4941094279, -0.4448296300, 0.7469822445);
const GAL_NP = vec3f(-0.8676661490, -0.1980763734, 0.4559837762);
// the picture's light against the band it replaces
const SKY_GAIN = 2.2;

// the real Milky Way in the direction rd (the galaxy's axes): one tap of the sky's picture
fn skyPicture(rd: vec3f) -> vec3f {
  let e = -rd.x * GAL_C + rd.z * GAL_L90 + rd.y * GAL_NP;
  let ra = atan2(e.y, e.x);
  let dec = asin(clamp(e.z, -1.0, 1.0));
  let uv = vec2f(fract(0.5 - ra / (2.0 * PI)), 0.5 - dec / PI);
  // (its level from a pixel's size on the sky, the march's pixel being 1 / L.d.w of the frame's: no seam where it wraps)
  let lod = max(log2(L.pxAngle / max(L.d.w, 0.1) * 4096.0 / (2.0 * PI)), 0.0);
  let c = textureSampleLevel(milkyTex, samp_repeat, uv, lod).rgb;
  return c * c * c * SKY_GAIN;
}

// the band: the picture once it's in, the drawn one till then
fn band(rd: vec3f) -> vec3f {
  if (L.d.z > 0.5) { return skyPicture(rd); }
  return milkyWay(rd);
}

@fragment fn fs(in: FullscreenOut) -> @location(0) vec4f {
  let rd = rayDir(in.uv);
  let ro = L.eye + L.origin;
  // from inside the disc, near the Sun, the sky's band (L.a.w: how far inside)
  if (L.a.w >= 0.999) { return vec4f(band(rd) * L.d.y * L.weight, 0.0); }
  // the slab |y| < 2.2 within r < 22 (a cylinder)
  var t0 = 0.0; var t1 = 1e9;
  if (abs(rd.y) > 1e-6) {
    let ta = (2.2 - ro.y) / rd.y; let tb = (-2.2 - ro.y) / rd.y;
    t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb));
  } else if (abs(ro.y) > 2.2) { return vec4f(0.0); }
  let a = dot(rd.xz, rd.xz);
  let b = dot(ro.xz, rd.xz);
  let c = dot(ro.xz, ro.xz) - 22.0 * 22.0;
  let h = b * b - a * c;
  if (h < 0.0) { return vec4f(0.0); }
  let sh = sqrt(h);
  t0 = max(t0, (-b - sh) / max(a, 1e-9)); t1 = min(t1, (-b + sh) / max(a, 1e-9));
  if (t1 <= t0) { return vec4f(0.0); }
  let steps = i32(L.a.z);
  let jit = marchDither(in.pos.xy);
  var T = 1.0;
  var col = vec3f(0.0);
  // (no map yet: nothing but the band)
  if (L.d.x > 0.0) {
    let span = t1 - t0;
    // the steps gathered toward where the ray crosses the plane (from inside the disc that's the eye), each side's
    // share of them its share of the span, closer together near the plane
    var tm = t0;
    if (abs(rd.y) > 1e-5) { tm = clamp(-ro.y / rd.y, t0, t1); }
    let fa = (tm - t0) / max(span, 1e-6);
    // (the map's level from a step's footprint: a pixel of the march at that distance against a texel)
    let texel = MAP_W / f32(textureDimensions(faceTex).x);
    let foot = L.pxAngle / max(L.d.w, 0.1) / texel;
    var tPrev = t0;
    for (var i = 0; i < steps; i++) {
      let u = (f32(i) + jit) / f32(steps);
      var t: f32;
      if (u < fa) { let k = (fa - u) / fa; t = tm - (tm - t0) * k * k; }
      else { let k = (u - fa) / max(1.0 - fa, 1e-6); t = tm + (t1 - tm) * k * k; }
      let dt = t - tPrev;
      tPrev = t;
      let g = galaxy(ro + rd * t, log2(max(t * foot, 1.0)));
      let tau = g.dust * L.a.y * dt;
      col += T * g.glow * L.a.x * dt * exp(-tau * 0.5);
      T *= exp(-tau);
      if (T < 0.01) { break; }
    }
    col *= L.d.x;
    T = mix(1.0, T, L.d.x);
  }
  col = mix(col, band(rd) * L.d.y, L.a.w);
  return vec4f(col * L.weight, mix(1.0 - T, 0.0, L.a.w) * L.weight);
}
