// The film: ambient occlusion with a radius proportional to depth (so contact shadows read the same at ten microns and
// at ten nanometres), the haze of the crowded cytoplasm (its reach follows the zoom), bloom from a mip chain, and the
// grade — an AgX-style curve, a vignette, a touch of grain.
#include "world.wgsl"
#include "../src/cosmos/shaders/tissue.wgsl"
#include "weft/fullscreen"

struct Post {
  aoRadius: f32,      // @range(0, 0.3) fraction of the depth
  aoStrength: f32,    // @range(0, 2)
  bloom: f32,         // @range(0, 1)
  bloomRadius: f32,   // @range(0.2, 1.5)
  vignette: f32,      // @range(0, 1)
  grain: f32,         // @range(0, 0.1)
  saturation: f32,    // @range(0, 2)
  contrast: f32,      // @range(0.5, 1.5)
  dofMax: f32,        // @range(0, 30) widest blur, pixels at 1080 lines
  dofRange: f32,      // @range(0.02, 1) how far from the focus (fraction of its distance) blur reaches full
  pad0: f32, pad1: f32,
}
@group(2) @binding(8) var<uniform> P: Post;
@group(2) @binding(0) var depthTex: texture_depth_2d;
@group(2) @binding(1) var nrmTex: texture_2d<f32>;
@group(2) @binding(2) var hdrTex: texture_2d<f32>;
@group(2) @binding(3) var aoTex: texture_2d<f32>;
@group(2) @binding(4) var bloomTex: texture_2d<f32>;
@group(2) @binding(5) var srcTex: texture_2d<f32>;
@group(2) @binding(6) var idTex: texture_2d<u32>;

struct Lvl { texel: vec2f, mip: f32, last: f32 }
@group(2) @binding(7) var<uniform> L: Lvl;
@group(2) @binding(9) var accumTex: texture_2d<f32>;
@group(2) @binding(10) var revealTex: texture_2d<f32>;
@group(2) @binding(11) var dofTex: texture_2d<f32>;

fn viewPos(uv: vec2f, d: f32) -> vec3f {
  let ndc = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, d, 1.0);
  let v = frame.invProj * ndc;
  return v.xyz / v.w;
}

// ---------------------------------------------------------------- ambient occlusion (half resolution)
@fragment fn fs_ao(in: FullscreenOut) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(depthTex));
  let px = vec2i(in.uv * dims);
  let d = textureLoad(depthTex, px, 0);
  if (d <= 0.0) { return vec4f(1.0); }
  let p = viewPos(in.uv, d);
  let n = normalize(textureLoad(nrmTex, px, 0).xyz);
  let rad = -p.z * P.aoRadius;
  // a rotated spiral of samples in the hemisphere round the normal, the rotation from interleaved gradient noise
  let ign = fract(52.9829189 * fract(dot(in.uv * dims, vec2f(0.06711056, 0.00583715))) + f32(frame.frame % 8u) * 0.618);
  var occ = 0.0;
  let N = 12;
  for (var i = 0; i < N; i++) {
    let fi = (f32(i) + 0.5) / f32(N);
    let a = (f32(i) * 2.399963 + ign * 6.2831853);
    let r = sqrt(fi) * rad;
    // a point on a disc round the normal, lifted into the hemisphere
    let t = normalize(cross(n, select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(n.x) > 0.9)));
    let b = cross(n, t);
    let s = p + (t * cos(a) + b * sin(a)) * r + n * (rad * 0.25 * (1.0 - fi));
    let c = frame.proj * vec4f(s, 1.0);
    let suv = vec2f(c.x / c.w * 0.5 + 0.5, 0.5 - c.y / c.w * 0.5);
    if (any(suv < vec2f(0.0)) || any(suv > vec2f(1.0))) { continue; }
    let sd = textureLoad(depthTex, vec2i(suv * dims), 0);
    let sp = viewPos(suv, sd);
    let dz = sp.z - s.z;
    // occluded when the surface there is in front of the sample, by no more than the radius
    occ += select(0.0, 1.0, dz > rad * 0.02) * (1.0 - smoothstep(rad * 0.6, rad * 1.6, abs(dz)));
  }
  let ao = 1.0 - occ / f32(N);
  return vec4f(ao, ao, ao, 1.0);
}

// ---------------------------------------------------------------- composite: light × occlusion, haze, background
fn background(uv: vec2f) -> vec3f {
  let r = viewRay(uv);
  // a soft gradient with the key light's side warmer, and a faint speckle of far particles
  let k = dot(r, normalize(G.keyDir)) * 0.5 + 0.5;
  var c = G.bgColor * (0.65 + 0.7 * k * k);
  let sp = cellular(r * 180.0, 1.0);
  c += G.fogColor * 0.35 * smoothstep(0.08, 0.0, sp.d1) * step(0.8, sp.id.x);
  // the tissue's sheet going on beyond the cells round this one (cosmos/tissue.ts: the cosmos paints the same sheet on
  // Lyra's cornea, so coming in from there it's all one), in the haze, while the view takes in the tissue
  let far = smoothstep(12000.0, 30000.0, G.scale);
  let cam = frame.camPos + G.origin;
  if (far > 0.0 && r.y < -1e-4 && cam.y > 0.0) {
    let t = -cam.y / r.y;
    let m = tissueMasks((cam + r * t).xz, t * G.pxAngle, TISSUE_NEAR);
    var s = c;
    s = mix(s, TISSUE_BODY, m.x * 0.5);
    s += TISSUE_RIM * m.y;
    s = mix(s, TISSUE_NUC, m.z * 0.7);
    s += TISSUE_NRIM * m.w;
    c = mix(c, mix(s, G.fogColor, fogAmount(t)), far);
  }
  return c;
}
// (the sheet's colours in this world's light: as its own cells show from afar)
const TISSUE_BODY = vec3f(0.055, 0.036, 0.042);
const TISSUE_RIM = vec3f(0.07, 0.048, 0.05);
const TISSUE_NUC = vec3f(0.03, 0.03, 0.075);
const TISSUE_NRIM = vec3f(0.02, 0.025, 0.06);

@fragment fn fs_composite(in: FullscreenOut) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(depthTex));
  let px = vec2i(in.uv * dims);
  let d = textureLoad(depthTex, px, 0);
  if (d <= 0.0) { return vec4f(clean(glassOver(background(in.uv), px)), 1.0); }
  var c = textureLoad(hdrTex, px, 0).rgb;
  // occlusion: a depth-aware blur of the half-resolution term
  let ad = vec2f(textureDimensions(aoTex));
  let z0 = linearDepth(d);
  var ao = 0.0; var wsum = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let q = in.uv + vec2f(f32(x), f32(y)) * 1.5 / ad;
      let a = textureSampleLevel(aoTex, samp_linear, q, 0.0).r;
      let zq = linearDepth(textureLoad(depthTex, vec2i(clamp(q, vec2f(0.0), vec2f(0.999)) * dims), 0));
      let w = exp(-abs(zq - z0) / (z0 * 0.05));
      ao += a * w; wsum += w;
    }
  }
  ao = ao / max(wsum, 1e-4);
  c *= mix(1.0, ao, P.aoStrength * (1.0 - G.fluo * 0.8));
  // haze over distance
  let wp = worldFromDepth(in.uv, d);
  let f = fogAmount(length(wp - frame.camPos));
  c = mix(c, G.fogColor, f);
  // the hovered and the chosen organelle: a soft lift
  let id = textureLoad(idTex, px, 0).r;
  if (id != 0u && (id == G.hover || id == G.selected)) { c *= 1.0 + G.highlight * select(0.18, 0.32, id == G.selected); }
  return vec4f(clean(glassOver(c, px)), 1.0);
}

// one pixel's stray NaN or infinity would spread through the bloom chain and the lens blur into a black block: it
// goes black on its own instead (a value whose exponent bits are all set isn't a finite number)
fn clean(c: vec3f) -> vec3f {
  return select(vec3f(0.0), c, all((bitcast<vec3u>(c) & vec3u(0x7f800000u)) != vec3u(0x7f800000u)));
}

// the glass layers over what's behind them (weighted blended OIT resolve)
fn glassOver(c: vec3f, px: vec2i) -> vec3f {
  let acc = textureLoad(accumTex, px, 0);
  let rev = textureLoad(revealTex, px, 0).r;
  if (rev >= 0.999) { return c; }
  let avg = acc.rgb / clamp(acc.a, 1e-4, 5e4);
  return c * rev + avg * (1.0 - rev);
}

// ---------------------------------------------------------------- bloom: down a mip chain, back up with a tent
@fragment fn fs_down(in: FullscreenOut) -> @location(0) vec4f {
  let t = L.texel;
  var c = textureSampleLevel(srcTex, samp_linear, in.uv, 0.0).rgb * 0.5;
  c += textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(-t.x, -t.y), 0.0).rgb * 0.125;
  c += textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(t.x, -t.y), 0.0).rgb * 0.125;
  c += textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(-t.x, t.y), 0.0).rgb * 0.125;
  c += textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(t.x, t.y), 0.0).rgb * 0.125;
  if (L.mip < 0.5) {
    // the first step keeps only what's bright (soft knee)
    let l = max(c.r, max(c.g, c.b));
    c *= smoothstep(1.1, 3.2, l);
  }
  return vec4f(c, 1.0);
}
@fragment fn fs_up(in: FullscreenOut) -> @location(0) vec4f {
  let t = L.texel * P.bloomRadius;
  var c = vec3f(0.0);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let w = (2.0 - abs(f32(x))) * (2.0 - abs(f32(y))) / 16.0;
      c += textureSampleLevel(srcTex, samp_linear, in.uv + vec2f(f32(x), f32(y)) * t, 0.0).rgb * w;
    }
  }
  return vec4f(c, 1.0);
}

// ---------------------------------------------------------------- depth of field
// circle of confusion in pixels (signed: negative nearer than the focus), from the ratio of distances, so a macro
// lens's look holds at every zoom
fn coc(d: f32) -> f32 {
  let z = select(1e12, linearDepth(d), d > 0.0);
  let f = G.scale;
  let k = clamp((z - f) / (z * P.dofRange), -1.0, 1.0);
  return k * P.dofMax * G.dof * frame.res.y / 1080.0;
}
// half resolution: colour with its circle of confusion in alpha
@fragment fn fs_dofdown(in: FullscreenOut) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(depthTex));
  let c = textureSampleLevel(srcTex, samp_linear, in.uv, 0.0).rgb;
  // the nearest depth of the four texels (so a sharp near edge isn't eaten)
  var d = 0.0;
  for (var i = 0; i < 4; i++) {
    let o = vec2f(f32(i & 1), f32(i >> 1)) - 0.5;
    d = max(d, textureLoad(depthTex, vec2i(in.uv * dims + o), 0));
  }
  return vec4f(c, coc(d));
}
// a gather over a golden-angle disc: a sample counts where its own blur reaches this pixel; far samples can't spill
// over a nearer, sharper centre
@fragment fn fs_dof(in: FullscreenOut) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(srcTex));
  let center = textureSampleLevel(srcTex, samp_linear, in.uv, 0.0);
  let c0 = center.a * 0.5;            // (half resolution: half the pixels)
  let R = P.dofMax * G.dof * frame.res.y / 1080.0 * 0.5;
  if (R < 0.5) { return vec4f(center.rgb, 1.0); }
  var acc = vec3f(0.0); var wsum = 0.0;
  let N = 40;
  for (var i = 0; i < N; i++) {
    let fi = f32(i) + 0.5;
    let r = sqrt(fi / f32(N)) * R;
    let a = fi * 2.399963;
    let uv = in.uv + vec2f(cos(a), sin(a)) * r / dims;
    let s = textureSampleLevel(srcTex, samp_linear, uv, 0.0);
    let cs = s.a * 0.5;
    var w = clamp(abs(cs) - r + 1.0, 0.0, 1.0);
    if (cs > 0.0) { w = min(w, clamp(max(c0, 0.0) - r + 1.5, 0.0, 1.0)); }
    acc += s.rgb * w; wsum += w;
  }
  let own = clamp(1.0 - abs(c0), 0.0, 1.0) + 1e-3;
  return vec4f((acc + center.rgb * own) / (wsum + own), 1.0);
}

// ---------------------------------------------------------------- the grade
fn agx(c0: vec3f) -> vec3f {
  // AgX-style: a log encode in a slightly desaturating basis, a sigmoid, back out
  let m = mat3x3f(vec3f(0.842, 0.0423, 0.0424), vec3f(0.0784, 0.878, 0.0784), vec3f(0.0792, 0.0792, 0.879));
  let mi = mat3x3f(vec3f(1.197, -0.0528, -0.0529), vec3f(-0.098, 1.152, -0.098), vec3f(-0.099, -0.099, 1.152));
  var c = m * max(c0, vec3f(1e-10));
  c = clamp(log2(c), vec3f(-12.47), vec3f(4.03));
  c = (c + 12.47) / 16.5;
  let x2 = c * c; let x4 = x2 * x2;
  c = 15.5 * x4 * x2 - 40.14 * x4 * c + 31.96 * x4 - 6.868 * x2 * c + 0.4298 * x2 + 0.1191 * c - 0.00232;
  return clamp(mi * c, vec3f(0.0), vec3f(1.0));
}

@fragment fn fs_final(in: FullscreenOut) -> @location(0) vec4f {
  // a whisper of lateral chromatic aberration toward the corners
  let dc = in.uv - 0.5;
  let ca = dc * dot(dc, dc) * 0.006;
  var c = vec3f(
    textureSampleLevel(srcTex, samp_linear, in.uv - ca, 0.0).r,
    textureSampleLevel(srcTex, samp_linear, in.uv, 0.0).g,
    textureSampleLevel(srcTex, samp_linear, in.uv + ca, 0.0).b);
  // depth of field: the blurred image where this pixel's circle of confusion is wide
  if (G.dof > 0.0) {
    let dims = vec2f(textureDimensions(depthTex));
    let k = abs(coc(textureLoad(depthTex, vec2i(in.uv * dims), 0)));
    c = mix(c, textureSampleLevel(dofTex, samp_linear, in.uv, 0.0).rgb, smoothstep(0.6, 2.5, k));
  }
  c += textureSampleLevel(bloomTex, samp_linear, in.uv, 0.0).rgb * P.bloom;
  c *= G.exposure;
  var g = agx(c);
  let l = dot(g, vec3f(0.2126, 0.7152, 0.0722));
  g = mix(vec3f(l), g, P.saturation);
  g = clamp((g - 0.5) * P.contrast + 0.5, vec3f(0.0), vec3f(1.0));
  let vig = 1.0 - P.vignette * smoothstep(0.25, 0.95, length(dc * vec2f(frame.aspect, 1.0)) / max(frame.aspect, 1.0) * 1.5);
  g *= vig;
  let n = hash3u(vec3u(vec2u(in.pos.xy), frame.frame)).x - 0.5;
  g += n * P.grain;
  // (the swapchain is non-sRGB on most platforms: encode)
  return vec4f(pow(max(g, vec3f(0.0)), vec3f(1.0 / 2.2)), 1.0);
}
