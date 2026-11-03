// HDR to the screen: bloom (and the glow on what's bright: gold in the sun, lanterns, fire, the moon), exposure, night
// vision (the cool mesopic shift: by night the dim land goes blue-violet while a lantern keeps its warmth), AgX
// (Sobotka's filmic view, Benjamin Wrensch's polynomial fit), the Seven Havens' grade (fx.wgsl fxGrade: the warm-cool
// split, the reds' and golds' richness, by the time of day), vignette and dithering. (The cast's display lock —
// hero.wgsl, aang's air and glider — runs the bloom's share, the exposure, the warmth, AgX, its look and the contrast
// backwards: those stay as they are; the grade after them falls on the cast as on everything.)
#include "./../world/world.wgsl"
#include "./fx.wgsl"
#include "weft/fullscreen"

struct Post {
  ev: vec4f,        // x exposure bias (stops), y bloom strength, z vignette, w grain
  grade: vec4f,     // x saturation, y contrast, z warmth, w agx look (0 base, 1 punchy)
  look: vec4f,      // x the glow on what's bright, y the brightness on the screen it glows from, z night vision, w the warm-cool split
  look2: vec4f,     // x the reds' and golds' richness, yzw -
}
@group(2) @binding(0) var<uniform> P: Post;
@group(2) @binding(1) var hdr: texture_2d<f32>;
@group(2) @binding(2) var bloom: texture_2d<f32>;

fn agxContrast(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

fn agx(c: vec3f) -> vec3f {
  let m = mat3x3f(vec3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051),
                  vec3f(0.0784335999999992, 0.878468636469772, 0.0784336),
                  vec3f(0.0792237451477643, 0.0791661274605434, 0.879142973793104));
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var v = m * c;
  v = clamp(log2(max(v, vec3f(1e-10))), vec3f(minEv), vec3f(maxEv));
  v = (v - minEv) / (maxEv - minEv);
  return agxContrast(v);
}

fn agxEotf(c: vec3f) -> vec3f {
  let m = mat3x3f(vec3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438),
                  vec3f(-0.0980208811401368, 1.15190312990417, -0.0980434501171241),
                  vec3f(-0.0990297440797205, -0.0989611768448433, 1.15107367264116));
  return m * c;   // already display-encoded (sRGB-ish power)
}

fn agxLook(c: vec3f) -> vec3f {
  let lw = vec3f(0.2126, 0.7152, 0.0722);
  let l = dot(c, lw);
  let punchy = P.grade.w;
  let slope = vec3f(1.0);
  let power = mix(vec3f(1.0), vec3f(1.35), punchy);
  let sat = mix(1.0, 1.4, punchy) * P.grade.x;
  let o = pow(c * slope, power);
  let lo = dot(o, lw);
  return lo + sat * (o - lo);
}

// the night's colour as the rods see it: blue-violet (its luminance 1)
const NIGHT_HUE = vec3f(0.74, 0.92, 2.36);

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  var c = fxScene(i.uv);
  let b = textureSampleLevel(bloom, samp_linear, i.uv, 0.0).rgb * FX.grade.y;
  c = mix(c, b, P.ev.y);
  // the glow: the bloom of what's brighter on the screen than the knee, added (its own colour: gold glows gold)
  let toScreen = world.exposure * exp2(P.ev.x);
  c += max(b - vec3f(P.look.y / max(toScreen, 1e-9)), vec3f(0.0)) * P.look.x;
  // halation (film's red glow round highlights; little of it by night, when the moon's halo is cool), and the light in
  // the air and the lens
  c += b * vec3f(1.0, 0.32, 0.1) * FX.lens.w * P.ev.y * (1.0 - 0.75 * world.sunTrue.w) + fxLight(i.uv);
  c *= toScreen;
  // night vision: as the light fails the rods take over, the land's colour draining to a cool blue-violet
  // (mesopic: what's bright enough — a lantern, the fire — keeps its colour; the sky is painted as the eye takes it
  // already, the aurora and the moon in it)
  let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  let land = textureLoad(fxSceneZ, vec2i(i.uv * vec2f(textureDimensions(fxSceneZ))), 0).x < 6e4;
  // (it comes on as the twilight fails, from the sun 8 degrees down: the dusk keeps its warmth on the land)
  let scot = smoothstep(-0.139, -0.276, world.sunTrue.y) * P.look.z * (1.0 - smoothstep(0.03, 0.4, lum)) * select(0.0, 1.0, land);
  c = mix(c, lum * NIGHT_HUE, scot);
  // warmth (white balance shift) before the curve
  c *= vec3f(1.0 + P.grade.z * 0.08, 1.0, 1.0 - P.grade.z * 0.08);
  var d = agx(c);
  d = agxLook(d);
  d = agxEotf(d);
  // contrast around mid grey
  d = mix(vec3f(0.5), d, P.grade.y);
  d = fxGrade(d);
  // vignette
  let q = i.uv - 0.5;
  d *= 1.0 - P.ev.z * dot(q, q) * 1.6;
  // dither to hide banding in the sky (a fixed pattern: noise that changes every frame costs video encoders dearly)
  let n = hash12(floor(i.uv * vec2f(frame.res)) + 0.5) - 0.5;
  d += n / 255.0 * (1.0 + P.ev.w * 6.0);
  d = fxGrain(d, i.pos.xy);
  return vec4f(clamp(d, vec3f(0.0), vec3f(1.0)), 1.0);
}
