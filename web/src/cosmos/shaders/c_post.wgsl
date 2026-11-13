// The film of the whole dive: bloom from a mip chain, and the film (loom/film: the exposure, AgX and its look, the grade,
// the vignette and the grain) to the screen — the cosmos's frame, a host's laid into it (the cell's), or both as the two
// hand over. (Its alpha lays it over a frame already on the screen, for a host that grades its own.)
#include "weft/frame"
#include "weft/fullscreen"
#include "noise.wgsl"
#include "loom/film"

@group(2) @binding(0) var<uniform> F: FilmU;
@group(2) @binding(1) var srcTex: texture_2d<f32>;
@group(2) @binding(2) var bloomTex: texture_2d<f32>;
// going up, the wider level's weight (the film's bloomWeight); from the scene, x of `first`: the taps' groups averaged
// weighted by their brightness (1: Jimenez's — an even field kept as it is, Seven Havens'), or the average compressed (0:
// the cosmos's); w how much only what's bright is kept, its soft knee from y to z (the cell's)
struct Lvl { texel: vec2f, mip: f32, weight: f32, first: vec4f }
@group(2) @binding(3) var<uniform> B: Lvl;

fn karis(c: vec3f) -> f32 { return 1.0 / (1.0 + dot(c, vec3f(0.2126, 0.7152, 0.0722)) * 0.25); }

// 13-tap downsample (Jimenez), the first level's taps weighted against fireflies
@fragment fn fs_down(in: FullscreenOut) -> @location(0) vec4f {
  let t = B.texel;
  let uv = in.uv;
  let s = textureSampleLevel(srcTex, samp_linear, uv, 0.0).rgb;
  let a = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(-2.0, -2.0), 0.0).rgb;
  let b = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(0.0, -2.0), 0.0).rgb;
  let c = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(2.0, -2.0), 0.0).rgb;
  let d = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(-2.0, 0.0), 0.0).rgb;
  let f = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(2.0, 0.0), 0.0).rgb;
  let g = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(-2.0, 2.0), 0.0).rgb;
  let h = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(0.0, 2.0), 0.0).rgb;
  let i = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(2.0, 2.0), 0.0).rgb;
  let j = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(-1.0, -1.0), 0.0).rgb;
  let k = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(1.0, -1.0), 0.0).rgb;
  let l = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(-1.0, 1.0), 0.0).rgb;
  let m = textureSampleLevel(srcTex, samp_linear, uv + t * vec2f(1.0, 1.0), 0.0).rgb;
  var o = s * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  if (B.mip < 0.5) {
    let g0 = (a + b + d + s) * 0.25; let g1 = (b + c + s + f) * 0.25; let g2 = (d + s + g + h) * 0.25; let g3 = (s + f + h + i) * 0.25;
    let g4 = (j + k + l + m) * 0.25;
    let w0 = karis(g0) * 0.125; let w1 = karis(g1) * 0.125; let w2 = karis(g2) * 0.125; let w3 = karis(g3) * 0.125; let w4 = karis(g4) * 0.5;
    let even = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
    o = mix(o / (1.0 + dot(o, vec3f(0.2126, 0.7152, 0.0722)) * 0.25), even, B.first.x);
    if (B.first.w > 0.0) { o *= mix(1.0, smoothstep(B.first.y, B.first.z, max(o.r, max(o.g, o.b))), B.first.w); }
  }
  return vec4f(o, 1.0);
}
@fragment fn fs_up(in: FullscreenOut) -> @location(0) vec4f {
  let t = B.texel;
  var o = textureSampleLevel(srcTex, samp_linear, in.uv, 0.0).rgb * 4.0;
  o += (textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(-t.x, 0.0), 0.0).rgb + textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(t.x, 0.0), 0.0).rgb
      + textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(0.0, -t.y), 0.0).rgb + textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(0.0, t.y), 0.0).rgb) * 2.0;
  o += textureSampleLevel(srcTex, samp_linear, in.uv - t, 0.0).rgb + textureSampleLevel(srcTex, samp_linear, in.uv + t, 0.0).rgb
     + textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(t.x, -t.y), 0.0).rgb + textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(-t.x, t.y), 0.0).rgb;
  return vec4f(o / 16.0 * B.weight, 1.0);
}

// the meter (renderer.ts): the camera's exposure, from the frame's light (the scene's, before the exposure: no loop)
// in the bloom's smallest level. What it meters is what's lit: the log-average of the pixels brighter than the sky
// ever is, weighted to the middle (where the zoom's target is, and the body it's about), and how much of the frame they
// cover. When a sunlit body covers a good part of it the exposure comes down to hold that body's light to a key, so it
// keeps its colour (and the stars go out with it, as they would); a bright speck covers too little to count. When
// something dark covers the middle (the Moon's night side) it comes up, for earthshine. Eased in time by the share
// `rate` this frame keeps (the blend: 1 on a film or a dome, so their frames are the same however they're reached).
// M.a: x rate, y the meter's say (the zoom's keyframe), z the key a lit body's light is held to, w the most it comes
// down (stops); M.b: x the light a pixel needs to count as lit, y the share of the frame (weighted) where it counts in
// full, z the middle's light under which it's dark, w the most it goes up (stops: renderer.ts gives it only while the
// body in focus shows the camera its night side, never for an empty patch of sky)
struct MeterU { a: vec4f, b: vec4f }
@group(2) @binding(4) var<uniform> M: MeterU;
@group(2) @binding(5) var meterTex: texture_2d<f32>;

@fragment fn fs_meter(in: FullscreenOut) -> @location(0) vec4f {
  let n = vec2i(textureDimensions(srcTex));
  let m = min(n, vec2i(64));
  var lit = 0.0; var litW = 0.0; var wsum = 0.0; var mid = 0.0; var midW = 0.0;
  for (var y = 0; y < m.y; y++) {
    for (var x = 0; x < m.x; x++) {
      let p = (vec2f(f32(x), f32(y)) + 0.5) / vec2f(m);
      let c = textureLoad(srcTex, vec2i(p * vec2f(n)), 0).rgb;
      // (the bloom's first level keeps its light compressed, l / (1 + l / 4): undone)
      let yc = dot(c, vec3f(0.2126, 0.7152, 0.0722));
      let l = yc / max(1.0 - yc * 0.25, 0.02);
      let q = (p - 0.5) * vec2f(f32(n.x) / f32(n.y), 1.0);
      let r2 = dot(q, q);
      let w = exp(-r2 / (2.0 * 0.3 * 0.3));
      wsum += w;
      if (l > M.b.x) { lit += w * log2(l); litW += w; }
      let wm = exp(-r2 / (2.0 * 0.1 * 0.1));
      mid += wm * l; midW += wm;
    }
  }
  let cover = litW / max(wsum, 1e-6);
  let key = exp2(lit / max(litW, 1e-6));
  let down = clamp(log2(key / M.a.z), 0.0, M.a.w) * smoothstep(0.02, M.b.y, cover);
  let dark = mid / max(midW, 1e-6);
  let up = M.b.w * (1.0 - smoothstep(0.0, M.b.z, dark));
  let stops = (up - down) * M.a.y;
  return vec4f(stops, cover, dark, M.a.x);
}

// the upscaler's sharpening, here rather than in a pass of its own at the canvas's size (main.ts: Taau's sharpen off):
// where what comes in is bigger than the render — the upscaler's output — each pixel's edges restored by its local
// contrast as weft's taau.wgsl sharpen does it (AMD's CAS in spirit, its 0.35)
fn tmS(c: vec3f) -> vec3f { return c / (1.0 + dot(c, vec3f(0.2126, 0.7152, 0.0722))); }
fn sharpened(px: vec2i) -> vec3f {
  let ld = vec2i(textureDimensions(srcTex)) - 1;
  let e = textureLoad(srcTex, clamp(px, vec2i(0), ld), 0).rgb;
  let b = textureLoad(srcTex, clamp(px + vec2i(0, -1), vec2i(0), ld), 0).rgb;
  let d = textureLoad(srcTex, clamp(px + vec2i(-1, 0), vec2i(0), ld), 0).rgb;
  let f = textureLoad(srcTex, clamp(px + vec2i(1, 0), vec2i(0), ld), 0).rgb;
  let h = textureLoad(srcTex, clamp(px + vec2i(0, 1), vec2i(0), ld), 0).rgb;
  let te = tmS(e); let tb = tmS(b); let td = tmS(d); let tf = tmS(f); let th = tmS(h);
  let mn = min(te, min(min(tb, td), min(tf, th)));
  let mx = max(te, max(max(tb, td), max(tf, th)));
  let amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3f(1e-4)), vec3f(0.0), vec3f(1.0)));
  let w = amp * (-1.0 / mix(8.0, 5.0, 0.35));
  let r = (tb * w + td * w + tf * w + th * w + te) / (1.0 + 4.0 * w);
  let o = clamp(r, vec3f(0.0), vec3f(0.999));
  return o / max(1.0 - dot(o, vec3f(0.2126, 0.7152, 0.0722)), 1e-3);
}

@fragment fn fs_final(in: FullscreenOut) -> @location(0) vec4f {
  if (F.out.z > 0.5 && length(in.uv - 0.5) > 0.5) { return vec4f(0.0, 0.0, 0.0, F.out.x); }
  var c = textureSampleLevel(srcTex, samp_linear, in.uv, 0.0).rgb;
  if (F.out.z < 0.5 && any(vec2f(textureDimensions(srcTex)) > frame.res + 0.5)) { c = sharpened(vec2i(in.pos.xy)); }
  var b = textureSampleLevel(bloomTex, samp_linear, in.uv, 0.0).rgb;
  // (the camera's exposure: the meter's stops)
  let e = exp2(textureLoad(meterTex, vec2i(0, 0), 0).r);
  c *= e; b *= e;
  let px = vec2u(in.pos.xy);
  let d = filmFinish(F, filmCurve(F, c, b), in.uv, in.pos.xy, frame.aspect, hash3u(vec3u(px, 7u)).x, hash3u(vec3u(px, frame.frame)).x);
  return vec4f(d, F.out.x);
}
