// The cloud decks (stratus, stratocumulus, altocumulus, altostratus, cirrus, the chinook's wave deck), composited over
// the finished scene: per pixel, where the view ray crosses each deck's slab — clipped by the scene at each of the
// pixel's four depth samples, so a ridge cuts cleanly across a cloud and a hillside fades into a deck it climbs into —
// the deck's density from the baked noise, and its light:
//   diffuse     the key light (sun or moon, reddened by the air at the cloud's height, cut off by the earth's shadow
//               after sunset) through a two-stream slab, delta-scaled (g 0.85): seen from below what comes through,
//               from above what the top sends back; darker where the deck thickens toward the light (the cells' relief)
//   single      forward scattering where the deck is thin: silver edges, a bright aureole round a sun behind cirrus,
//               a 22-degree halo in cirrostratus
//   ambient     the clear sky above, the ground's bounce below, the cities' light on low bases at night
// then the air in front (aerial perspective). Decks are drawn in two halves round the puffs (FRONT): the ones beyond
// them first. Alpha keeps the scene's own (1) times what the clouds let through, for the passes after (the shafts,
// the sun's glare).
#include "./cloudlayer.wgsl"
#include "weft/fullscreen"

@group(2) @binding(2) var sceneZ: texture_2d<f32>;   // the four depth samples' distances (post/scenez.wgsl)

override FRONT: f32 = 0.0;


struct Hit { col: vec3f, a: f32, t: f32 }

fn shadeLayer(k: i32, ro: vec3f, rd: vec3f, z: vec4f) -> Hit {
  var o: Hit;
  o.a = 0.0;
  let l = CL.L[k];
  var span = slabSpan(k, ro, rd);
  // (a deck the eye is in — fog — begins past the house's walls when the eye is indoors)
  if (span.x <= 0.0) { span.x = CL.misc.z; }
  // (out to 600 km)
  if (span.y <= span.x || span.x > 6.0e5) { return o; }
  // (the drawn part: up to the scene at its farthest sample, or the whole slab)
  let zFar = max(max(z.x, z.y), max(z.z, z.w));
  if (zFar <= span.x) { return o; }
  // (from inside a deck — fog — what's seen is the deck round the eye: its light and density there, alike for every
  // far ray)
  let inDeck = ro.y > l.a.x && ro.y < l.a.x + l.a.y;
  let tm = select(0.5 * (span.x + min(span.y, zFar)), min(0.5 * (span.x + min(span.y, zFar)), span.x + 150.0), inDeck);
  let p = ro + rd * tm;
  // (the pixel's footprint on the deck: across the view, and along it, stretched by how edge-on the deck is seen
  // there — against the shell's own up, which tilts toward the camera with the earth's curve)
  let px = tm * CL.misc.y;
  let hd = normalize(rd.xz + vec2f(1e-6, 0.0));
  let up = normalize(vec3f(p.x - ro.x, p.y + EARTH_M, p.z - ro.z));
  let gx = vec2f(-hd.y, hd.x) * px;
  let gy = hd * (px / max(abs(dot(rd, up)), 0.02));
  let dens = layerDensityG(k, p.xz, gx, gy, true);
  if (dens <= 0.002) { return o; }
  let sigma = dens * l.a.w / max(l.a.y, 1.0);
  // opacity along the view, per depth sample
  let s4 = clamp(min(vec4f(span.y), z) - span.x, vec4f(0.0), vec4f(span.y - span.x));
  let a4 = 1.0 - exp(-sigma * s4);
  var a = dot(a4, vec4f(0.25));
  // (thinning into the haze toward the horizon, where a deck's far edge would turn to a hard line)
  let dh = max(abs(l.a.x - ro.y), 50.0);
  let tH = sqrt(2.0 * EARTH_M * dh + dh * dh);
  a *= 1.0 - smoothstep(0.45, 1.0, tm / (tH + 20000.0));
  if (a <= 0.002) { return o; }

  let L = world.sunDir;
  let over = decksOver(p, k);
  let S = keyAt(p) * over.y;
  let tauV = dens * l.a.w;
  let aV = max(1.0 - exp(-tauV), 1e-3);
  let muS = max(L.y, 0.03);
  let R = 0.113 * tauV / (1.0 + 0.113 * tauV);
  let direct = exp(-0.28 * tauV / muS);
  let below = ro.y < l.a.x + l.a.y * 0.5;
  let diff = select(R, max(1.0 - R - direct, 0.0), below) * muS / PI * l.d.z;
  // (relief: the deck thicker toward the light shades the side away from it)
  let toL = normalize(L.xz + vec2f(1e-5, 0.0));
  let ds = layerDensityG(k, p.xz + toL * l.b.x * mix(0.012, 0.035, l.b.y), gx, gy, false);
  let relief = exp(-max(ds - dens, 0.0) * mix(1.5, 3.5, l.b.y)) * (0.8 + 0.4 * smoothstep(0.0, 0.25, dens - ds));
  let mu = dot(rd, L);
  let phase = 0.7 * hg(mu, 0.8) + 0.3 * hg(mu, 0.3);
  // (under another deck the light is diffuse: no silver)
  let single = phase * exp(-tauV * 0.45) * over.x / max(over.y, 1e-3);
  // (the 22-degree halo, red on the inside)
  let th = acos(clamp(mu, -1.0, 1.0));
  let halo = vec3f(exp(-pow((th - 0.3820) / 0.010, 2.0)), exp(-pow((th - 0.3845) / 0.011, 2.0)), exp(-pow((th - 0.3880) / 0.013, 2.0))) * l.b.w * 0.05 * exp(-tauV);
  let clearUp = max(vec3f(0.0), skyIrradiance[0].rgb + skyIrradiance[1].rgb) * world.haze.z;
  let ground = 0.18 * (S * muS / PI * (1.0 - R) + clearUp);
  let amb = select(clearUp * (0.35 + 0.65 * R), clearUp * (1.0 - R) * 0.8 + ground * R, below);
  // the city's orange light on low bases at night (strongest toward it: world.glow)
  let hz = normalize(rd.xz + vec2f(1e-5, 0.0));
  let toward = mix(1.0, 0.4 + 0.6 * max(dot(hz, world.glow.xz), 0.0), world.glow.y);
  let hk = l.a.x / 1200.0;
  let city = vec3f(1.0, 0.6, 0.34) * CL.misc.x * world.sunTrue.w * toward / (1.0 + hk * hk) * select(0.2, 1.0, below) * select(1.0, 0.3, inDeck);
  // (each term the light per unit of opacity: a thin cloud gives it times its opacity)
  // (painted: what the top sends back and the silver bright, what comes through to the belly and the sky's light
  // lavender: cloudlayer.wgsl cloudPaint)
  let body = S * diff / aV * relief;
  let col = cloudPaint(select(body, vec3f(0.0), below) + S * (single + halo), select(vec3f(0.0), body, below) + amb * mix(1.0, relief, 0.5)) + city + flashGlow(p);
  let ap = aerial(p);
  o.col = (col * ap.a + ap.rgb) * a;
  o.a = a;
  o.t = span.x;
  return o;
}

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let rd = viewRay(i.uv);
  let ro = frame.camPos;
  let z = textureLoad(sceneZ, vec2i(i.pos.xy), 0) / max(dot(rd, frame.camFwd), 1e-4);
  var hits: array<Hit, 4>;
  var n = 0;
  for (var k = 0; k < 4; k++) {
    if (!layerOn(k) || CL.L[k].d.x != FRONT) { continue; }
    let h = shadeLayer(k, ro, rd, z);
    if (h.a > 0.002) { hits[n] = h; n++; }
  }
  if (n == 0) { discard; }
  // nearest first
  for (var a = 1; a < n; a++) {
    var b = a;
    while (b > 0 && hits[b - 1].t > hits[b].t) { let t = hits[b]; hits[b] = hits[b - 1]; hits[b - 1] = t; b--; }
  }
  var C = vec3f(0.0);
  var T = 1.0;
  for (var k = 0; k < n; k++) { C += T * hits[k].col; T *= 1.0 - hits[k].a; }
  return vec4f(C, 1.0 - T);
}

// ------------------------------------------------------------------ the decks in the cloud shadow map
// each texel is a ray along the key light: where it crosses each deck, the deck's direct transmittance; alpha the
// lowest deck's top that has any cloud there (what's in a deck — a hillside in a stratus, the ground in fog — is
// under it)
@fragment fn fsShadow(i: FullscreenOut) -> @location(0) vec4f {
  let L = world.sunDir;
  if (L.y <= 0.01) { return vec4f(1.0, 1.0, 1.0, 6e4); }
  let ext = cloudSky.map.x;
  let A = cloudSky.e1.xyz * (cloudSky.e1.w + (i.uv.x - 0.5) * ext) + cloudSky.e2.xyz * (cloudSky.e2.w + (0.5 - i.uv.y) * ext);
  var t = 1.0;
  var low = 6e4;
  for (var k = 0; k < 4; k++) {
    if (!layerOn(k)) { continue; }
    let l = CL.L[k];
    let mid = l.a.x + l.a.y * 0.5;
    let q = A + L * ((mid - A.y) / L.y);
    // (blurred by the sun's disc seen from the ground — half a degree over the slant up to the deck, from the site's
    // level: a low sun's cloud shadows are soft-edged and glide, never switch)
    let pen = max(mid, 1.0) / L.y * 0.0093;
    let d = layerDensity(k, q.xz, clamp(log2(pen * 512.0 / l.b.x), 1.0, 7.0), true);
    if (d > 0.01) {
      t *= exp(-0.28 * d * l.a.w / L.y);
      low = min(low, l.a.x + l.a.y);
    }
  }
  return vec4f(t, t, t, low);
}
