// The cell's frame after its scene: ambient occlusion with a radius proportional to depth (so contact shadows read the
// same at ten microns and at ten nanometres), the haze of the crowded cytoplasm (its reach follows the zoom), the depth
// of field; then laid into the one film every picture of the dive goes through (the cosmos's: cosmos/film.ts CELL_FILM,
// its bloom and its grade).
#include "world.wgsl"
#include "../src/cosmos/shaders/tissue.wgsl"
#include "weft/fullscreen"

struct Post {
  aoRadius: f32,      // @range(0, 0.3) fraction of the depth
  aoStrength: f32,    // @range(0, 2)
  dofMax: f32,        // @range(0, 30) widest blur, pixels at 1080 lines
  dofRange: f32,      // @range(0.02, 1) how far from the focus (fraction of its distance) blur reaches full
  lay: f32,           // the frame's weight laid into the film's (1 alone; less under the cosmos's as the two hand over)
  pad0: f32, pad1: f32, pad2: f32,
}
@group(2) @binding(8) var<uniform> P: Post;
@group(2) @binding(0) var depthTex: texture_depth_2d;
@group(2) @binding(1) var nrmTex: texture_2d<f32>;
@group(2) @binding(2) var hdrTex: texture_2d<f32>;
@group(2) @binding(3) var aoTex: texture_2d<f32>;
@group(2) @binding(5) var srcTex: texture_2d<f32>;
@group(2) @binding(6) var idTex: texture_2d<u32>;

@group(2) @binding(9) var accumTex: texture_2d<f32>;
@group(2) @binding(10) var revealTex: texture_2d<f32>;
@group(2) @binding(11) var dofTex: texture_2d<f32>;
@group(2) @binding(12) var glassDepthTex: texture_depth_2d;
@group(2) @binding(13) var thinAccumTex: texture_2d<f32>;
@group(2) @binding(14) var thinRevealTex: texture_2d<f32>;

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
  if (d <= 0.0) { return vec4f(1.0, 1.0, 0.0, 0.0); }
  let p = viewPos(in.uv, d);
  let n = unOctNormal(textureLoad(nrmTex, px, 0).xy);
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
  // (and, soft by nature, so here at half the size: the haze's light along the ray to this point, hazeLight, and the
  // crowd's occlusion and shadow at it, world.wgsl crowdLight)
  let wp = worldFromDepth(in.uv, d);
  let cr = crowdLight(wp, normalize((frame.invView * vec4f(n, 0.0)).xyz));
  return vec4f(ao, hazeLight(wp), cr.occl, cr.shad);
}

// ---------------------------------------------------------------- composite: light × occlusion, haze, background
fn background(uv: vec2f) -> vec3f {
  let r = viewRay(uv);
  // a soft gradient with the key light's side warmer, and a faint speckle of far particles
  let k = dot(r, normalize(G.keyDir)) * 0.5 + 0.5;
  var c = G.bgColor * (0.65 + 0.7 * k * k);
  let sp = cellular8(r * 180.0, 1.0);
  c += G.fogColor * 0.35 * smoothstep(0.08, 0.0, sp.d1) * step(0.8, sp.id.x);
  // (a film's, while the haze is thick: the haze itself, so no darker gaps between the things it has all but hidden)
  c = mix(c, G.fogColor, G.hazeBg);
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
  let z0 = linearDepth(d);
  if (d <= 0.0) {
    var bg = background(in.uv);
    if (V.look > 0.5) { bg = illustratedFog(); }
    return vec4f(clean(glassOver(bg * (1.0 - 0.7 * G.spot), px, z0)), 1.0);
  }
  var c = textureLoad(hdrTex, px, 0).rgb;
  // occlusion: a depth-aware blur of the half-resolution term
  let ad = vec2f(textureDimensions(aoTex));
  var ao = 0.0; var hz = 0.0; var cr = vec2f(0.0); var wsum = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let q = in.uv + vec2f(f32(x), f32(y)) * 1.5 / ad;
      let a4 = textureSampleLevel(aoTex, samp_linear, q, 0.0);
      let a = a4.r;
      let zq = linearDepth(textureLoad(depthTex, vec2i(clamp(q, vec2f(0.0), vec2f(0.999)) * dims), 0));
      let w = exp(-abs(zq - z0) / (z0 * 0.05));
      ao += a * w; hz += a4.g * w; cr += a4.ba * w; wsum += w;
    }
  }
  ao = ao / max(wsum, 1e-4);
  hz = hz / max(wsum, 1e-4);
  cr = cr / max(wsum, 1e-4);
  // the crowd's occlusion and its shadow from the key (world.wgsl crowdLight): the key is most of a surface's light
  // where it reaches, the water's light the rest; in the illustrative look the occlusion alone
  // (deep in a crowd it goes properly dark, but by the multi-bounce fit: toward the crowd's own colour, never grey)
  if (V.look > 0.5) { c *= multiBounce(1.0 - 0.7 * cr.x, c); } else { c *= (1.0 - 0.6 * cr.y) * multiBounce(1.0 - 0.75 * cr.x, c); }
  // (tinted by what it's on, never grey: light that bounces about in a crease takes the colour of its walls — Jimenez
  // et al.'s multi-bounce fit, the albedo guessed from the pixel's own hue)
  let aoK = mix(1.0, ao, P.aoStrength * (1.0 - G.fluo * 0.8));
  c *= multiBounce(aoK, c);
  // haze over distance
  let wp = worldFromDepth(in.uv, d);
  let f = fogAmount(length(wp - frame.camPos));
  if (V.look > 0.5) {
    c = mix(c, illustratedFog(), f * 0.45);
  } else { c = mix(c, G.fogColor * hz, f * 0.85); }
  // the hovered and the chosen organelle: a soft lift
  let id = textureLoad(idTex, px, 0).r;
  if (id != 0u && (id == G.hover || id == G.selected)) { c *= 1.0 + G.highlight * select(0.18, 0.32, id == G.selected); }
  // the spotlight (world.wgsl): what the guide points at breathes and is outlined warm; everything else dims
  let lit = G.spot > 0.001 && spotlit(id);
  if (G.spot > 0.001 && !lit) { c = mix(c, vec3f(dot(c, vec3f(0.3, 0.59, 0.11))), 0.5 * G.spot) * (1.0 - 0.7 * G.spot); }
  var out = glassOver(c, px, z0);
  if (lit) {
    let pulse = 0.8 + 0.3 * sin(frame.time * 3.6);
    let hi = vec2i(dims) - 1;
    let edge = select(0.0, 1.0, !spotlit(textureLoad(idTex, clamp(px + vec2i(2, 0), vec2i(0), hi), 0).r) || !spotlit(textureLoad(idTex, clamp(px - vec2i(2, 0), vec2i(0), hi), 0).r)
      || !spotlit(textureLoad(idTex, clamp(px + vec2i(0, 2), vec2i(0), hi), 0).r) || !spotlit(textureLoad(idTex, clamp(px - vec2i(0, 2), vec2i(0), hi), 0).r));
    out = mix(out, c * (1.6 * pulse) + vec3f(0.03, 0.02, 0.01) * pulse, G.spot * 0.85);
    out = mix(out, vec3f(1.0, 0.7, 0.54) * (1.2 + 0.4 * pulse), edge * G.spot * 0.9);
  }
  return vec4f(clean(out), 1.0);
}

// ---------------------------------------------------------------- the illustrative look (renderer.ts look)
// Flat colour and occlusion (world.wgsl illustrated), fog to a pale ground of the compartment's own hue, and ink: a
// line where the depth jumps, on the far side of the edge, thicker for a bigger jump, and a thinner one where one
// thing meets another at about the same depth (Goodsell; Mol*'s illustrative style)
fn illustratedFog() -> vec3f {
  let f = G.fogColor + vec3f(1e-4);
  return f / luma(f) * 0.03;
}
fn inked(c: vec3f, px: vec2i, z0: f32, id: u32, fog: f32) -> vec3f {
  let dims = vec2i(textureDimensions(depthTex)) - 1;
  var near = 0.0; var wide = 0.0; var seam = 0.0;
  let offs = array<vec2i, 4>(vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1));
  for (var i = 0; i < 4; i++) {
    let q1 = clamp(px + offs[i], vec2i(0), dims);
    let d1 = textureLoad(depthTex, q1, 0);
    let z1 = select(1e30, linearDepth(d1), d1 > 0.0);
    near = max(near, (z0 - z1) / z1);
    if (abs(z0 - z1) < z0 * 0.03 && textureLoad(idTex, q1, 0).r != id) { seam = 1.0; }
    let q2 = clamp(px + offs[i] * 2, vec2i(0), dims);
    let d2 = textureLoad(depthTex, q2, 0);
    let z2 = select(1e30, linearDepth(d2), d2 > 0.0);
    wide = max(wide, (z0 - z2) / z2);
  }
  let line = max(smoothstep(0.025, 0.08, near), smoothstep(0.25, 0.8, wide));
  let ink = max(line, seam * 0.5);
  // (the ink fades with the haze, as the paint does, so the far crowd isn't a scribble)
  return mix(c, c * 0.06 + vec3f(0.002), clamp(ink * 1.3, 0.0, 1.0) * (1.0 - 0.8 * fog));
}

// the haze's light along the ray to a point: brighter where the key light reaches the water between things, dimmer in
// the crowd's shadow and where it's thick (a few taps of the crowd's volume, world.wgsl crowdAt). Thin and uneven: the
// haze keeps most of its own colour, so it never flattens the picture
fn hazeLight(wp: vec3f) -> f32 {
  if (V.on <= 0.0) { return 1.0; }
  let l = normalize(G.keyDir);
  let ro = frame.camPos;
  let span = min(length(wp - ro), V.voxel * V.n * 0.75);
  let rd = normalize(wp - ro);
  var lit = 0.0;
  for (var i = 0; i < 4; i++) {
    let q = ro + rd * (span * (f32(i) + 0.5) / 4.0);
    let sh = crowdAt(q + l * (3.0 * V.voxel), 1.8) * 1.6 + crowdAt(q + l * (8.0 * V.voxel), 2.6) * 2.4;
    let here = crowdAt(q, 1.5);
    lit += exp(-sh * 1.6) * (1.0 - 0.5 * clamp(here * 2.0, 0.0, 1.0));
  }
  return mix(1.0, 0.5 + 0.5 * lit / 4.0, V.on);
}

fn multiBounce(ao: f32, c: vec3f) -> vec3f {
  let alb = clamp(c / max(max(c.r, max(c.g, c.b)), 1e-4), vec3f(0.0), vec3f(1.0)) * 0.6;
  let a = 2.0404 * alb - 0.3324;
  let b = -4.7951 * alb + 0.6417;
  let k = 2.7552 * alb + 0.6903;
  return max(vec3f(ao), ((ao * a + b) * ao + k) * ao);
}

// one pixel's stray NaN or infinity would spread through the bloom chain and the lens blur into a black block: it
// goes black on its own instead (a value whose exponent bits are all set isn't a finite number)
fn clean(c: vec3f) -> vec3f {
  return select(vec3f(0.0), c, all((bitcast<vec3u>(c) & vec3u(0x7f800000u)) != vec3u(0x7f800000u)));
}

// the glass layers over what's behind them (weighted blended OIT resolve). The membranes are drawn at half the render's size
// (soft by nature: renderer.ts glass): the four half-size texels round this pixel, each weighted bilinearly and by how
// near the depth it was drawn against (the nearest of its four: fs_halfdepth) is to this pixel's — so along a
// silhouette the layers come from this pixel's own side of it
fn glassOver(c: vec3f, px: vec2i, z0: f32) -> vec3f {
  let hd = vec2i(textureDimensions(revealTex));
  let q = (vec2f(px) + 0.5) * vec2f(hd) / vec2f(textureDimensions(depthTex)) - 0.5;
  let i0 = vec2i(floor(q));
  let f = q - floor(q);
  var acc = vec4f(0.0); var rev = 0.0; var wsum = 0.0; var clear = true;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let t = clamp(i0 + o, vec2i(0), hd - 1);
    let r = textureLoad(revealTex, t, 0).r;
    clear = clear && r >= 0.999;
    let bw = select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1);
    let zh = linearDepth(textureLoad(glassDepthTex, t, 0));
    let w = bw * (exp(-abs(zh - z0) / (z0 * 0.05)) + 1e-4);
    acc += textureLoad(accumTex, t, 0) * w; rev += r * w; wsum += w;
  }
  // (the thin lines' own layers, at the full size: their sums added in, their reveal multiplied)
  let ta = textureLoad(thinAccumTex, px, 0);
  let tr = textureLoad(thinRevealTex, px, 0).r;
  if (clear && tr >= 0.999) { return c; }
  acc = acc / wsum + ta; rev = rev / wsum * tr;
  let avg = acc.rgb / clamp(acc.a, 1e-4, 5e4);
  return c * rev + avg * (1.0 - rev);
}

// the scene's depth at half its size for the glass to be drawn against: the nearest of each four
@fragment fn fs_halfdepth(in: FullscreenOut) -> @builtin(frag_depth) f32 {
  let ld = vec2i(textureDimensions(depthTex)) - 1;
  let p = vec2i(in.pos.xy) * 2;
  var d = 0.0;
  for (var k = 0; k < 4; k++) { d = max(d, textureLoad(depthTex, min(p + vec2i(k & 1, k >> 1), ld), 0)); }
  return d;
}

// ---------------------------------------------------------------- bloom: down a mip chain, back up with a tent
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

// ---------------------------------------------------------------- laid into the film
// The frame as the film takes it: a whisper of lateral chromatic aberration toward the corners, the blurred image where
// this pixel's circle of confusion is wide — weighted by P.lay, premultiplied, so it lies under the cosmos's own frame
// while the two hand over (the film's own HDR, its bloom and grade after: cosmos/renderer.ts)
@fragment fn fs_lay(in: FullscreenOut) -> @location(0) vec4f {
  let dc = in.uv - 0.5;
  let ca = dc * dot(dc, dc) * 0.006;
  var c = vec3f(
    textureSampleLevel(srcTex, samp_linear, in.uv - ca, 0.0).r,
    textureSampleLevel(srcTex, samp_linear, in.uv, 0.0).g,
    textureSampleLevel(srcTex, samp_linear, in.uv + ca, 0.0).b);
  if (G.dof > 0.0) {
    let dims = vec2f(textureDimensions(depthTex));
    let k = abs(coc(textureLoad(depthTex, vec2i(in.uv * dims), 0)));
    c = mix(c, textureSampleLevel(dofTex, samp_linear, in.uv, 0.0).rgb, smoothstep(0.6, 2.5, k));
  }
  // (the illustrative look's ink, after the depth of field: a line stays a line however soft what's behind it is)
  if (V.look > 0.5) {
    let px = vec2i(in.uv * vec2f(textureDimensions(depthTex)));
    let d = textureLoad(depthTex, px, 0);
    let z0 = select(1e30, linearDepth(d), d > 0.0);
    let f = select(1.0, fogAmount(length(worldFromDepth(in.uv, d) - frame.camPos)), d > 0.0);
    c = inked(c, px, z0, textureLoad(idTex, px, 0).r, f);
  }
  return vec4f(clean(c) * P.lay, P.lay);
}
