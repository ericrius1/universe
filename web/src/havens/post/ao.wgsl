// Ambient occlusion: GTAO (Jimenez et al. 2016, after XeGTAO; ported from waterbending's), at half resolution from the
// scene's distances, applied to the opaque scene before the clouds go over it:
//   prep      half-res view distance (the full-res pixel 2i's first sample) and two coarser mips (the nearest of four)
//   ao        two slices of three steps each side, normals from the depth; out: visibility, how much of the pixel's
//             light it applies to (its ambient share against the key light reaching it — sunlit grass keeps its sun —
//             faded with distance) and the irradiance it's lit by (for the multi-bounce albedo guess)
//   blur      a 4x4 depth-aware denoise and the multi-bounce colour: bright surfaces lose less in their creases
//   apply     full res, a depth-aware upsample multiplied into the scene (blend: multiply)
#include "./../world/world.wgsl"
#include "./fxu.wgsl"
#include "weft/fullscreen"

@group(2) @binding(11) var sceneZ: texture_2d<f32>;
@group(2) @binding(12) var zHalf: texture_2d<f32>;
@group(2) @binding(13) var texA: texture_2d<f32>;
@group(2) @binding(16) var hdrTex: texture_2d<f32>;

// (the sky's distance as a half-float target holds it: scenez.wgsl)
const SKY_Z = 6e4;
const AO_SLICES = 2;
const AO_STEPS = 3;

fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn luminance(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
fn bayer4(p: vec2i) -> f32 {
  var m = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return m[(p.y & 3) * 4 + (p.x & 3)];
}
fn fastAcos(x: f32) -> f32 {
  let a = abs(x);
  let r = (-0.156583 * a + PI * 0.5) * sqrt(max(1.0 - a, 0.0));
  return select(r, PI - r, x < 0.0);
}
fn fullZ(p: vec2i) -> f32 {
  let dim = vec2i(textureDimensions(sceneZ));
  return textureLoad(sceneZ, clamp(p, vec2i(0), dim - 1), 0).x;
}
// view space (x right, y up, z the distance ahead) of a full-res pixel position
fn viewPosAt(px: vec2f, z: f32) -> vec3f {
  let ndc = vec2f(px.x * frame.invRes.x * 2.0 - 1.0, 1.0 - px.y * frame.invRes.y * 2.0);
  return vec3f(ndc.x * z / frame.proj[0][0], ndc.y * z / frame.proj[1][1], z);
}
fn viewToWorld(v: vec3f) -> vec3f { return frame.camRight * v.x + frame.camUp * v.y + frame.camFwd * v.z; }

// ------------------------------------------------------------------ prep
@fragment fn prep(i: FullscreenOut) -> @location(0) vec4f {
  return vec4f(fullZ(vec2i(i.pos.xy) * 2), 0.0, 0.0, 1.0);
}
@fragment fn zdown(i: FullscreenOut) -> @location(0) vec4f {
  let p = vec2i(i.pos.xy) * 2;
  let m = vec2i(textureDimensions(texA)) - 1;
  let a = textureLoad(texA, min(p, m), 0).r;
  let b = textureLoad(texA, min(p + vec2i(1, 0), m), 0).r;
  let c = textureLoad(texA, min(p + vec2i(0, 1), m), 0).r;
  let d = textureLoad(texA, min(p + vec2i(1, 1), m), 0).r;
  return vec4f(min(min(a, b), min(c, d)), 0.0, 0.0, 1.0);
}

// ------------------------------------------------------------------ ao
@fragment fn ao(i: FullscreenOut) -> @location(0) vec4f {
  let hp = vec2i(i.pos.xy);
  let fp = hp * 2;
  let zc0 = fullZ(fp);
  if (zc0 >= SKY_Z) { return vec4f(1.0, 0.0, 1.0, 1.0); }
  let pxc = vec2f(fp) + 0.5;
  let P = viewPosAt(pxc, zc0);
  // the normal from the full-res neighbours (on each axis the side with the smaller depth step: no smearing over edges)
  let Pl = viewPosAt(pxc - vec2f(1.0, 0.0), fullZ(fp - vec2i(1, 0)));
  let Pr = viewPosAt(pxc + vec2f(1.0, 0.0), fullZ(fp + vec2i(1, 0)));
  let Pu = viewPosAt(pxc - vec2f(0.0, 1.0), fullZ(fp - vec2i(0, 1)));
  let Pd = viewPosAt(pxc + vec2f(0.0, 1.0), fullZ(fp + vec2i(0, 1)));
  let dxv = select(P - Pl, Pr - P, abs(Pr.z - P.z) < abs(Pl.z - P.z));
  let dyv = select(P - Pu, Pd - P, abs(Pd.z - P.z) < abs(Pu.z - P.z));
  var N = normalize(cross(dyv, dxv));
  if (dot(N, P) > 0.0) { N = -N; }
  let V = normalize(-P);
  let z = P.z;
  // the radius in the world (a little larger further out: tree bases and boulders in the middle distance), in px
  let R = FX.ao.y * (1.0 + z * 0.02);
  let pxPerM = frame.proj[1][1] * 0.5 * frame.res.y / z;
  let rWant = R * pxPerM;
  let rPx = min(rWant, 90.0 * frame.res.y / 1080.0);
  let Reff = R * rPx / max(rWant, 1e-4);
  var vis = 1.0;
  if (rPx > 3.0) {
    let falloffRange = 0.6 * Reff;
    let falloffMul = -1.0 / falloffRange;
    let falloffAdd = (Reff - falloffRange) / falloffRange + 1.0;
    let sliceNoise = (bayer4(hp) + 0.5) / 16.0;
    let stepNoise = fract(ign(vec2f(hp)) + sliceNoise * 0.618);
    // taps on the half-res distances (further ones on the coarser mips), each placed at the full-res pixel it stands for
    let pk = vec2f(2.0 * frame.invRes.x / frame.proj[0][0], -2.0 * frame.invRes.y / frame.proj[1][1]);
    let pb = vec2f(-1.0 / frame.proj[0][0], 1.0 / frame.proj[1][1]);
    let dim0 = vec2i(textureDimensions(zHalf));
    var acc = 0.0;
    for (var s = 0; s < AO_SLICES; s++) {
      let phi = (f32(s) + sliceNoise) * PI / f32(AO_SLICES);
      let cp = cos(phi); let sp = sin(phi);
      let omega = vec2f(cp, -sp);
      let dirV = vec3f(cp, sp, 0.0);
      let orthoDir = dirV - dot(dirV, V) * V;
      let axis = normalize(cross(orthoDir, V));
      let projN = N - axis * dot(N, axis);
      let projLen = length(projN);
      let signN = sign(dot(orthoDir, projN));
      let cosN = sat(dot(projN, V) / max(projLen, 1e-4));
      let n = signN * fastAcos(cosN);
      let low0 = cos(n + PI * 0.5);
      let low1 = cos(n - PI * 0.5);
      var hc0 = low0; var hc1 = low1;
      for (var j = 0; j < AO_STEPS; j++) {
        var t = (f32(j) + stepNoise) / f32(AO_STEPS);
        t = t * t;
        let ol = 2.5 + t * (rPx - 2.5);
        let off = omega * ol;
        let mip = u32(clamp(log2(ol) - 3.3, 0.0, 2.0));
        let sz = f32(1u << mip);
        let qm = max((dim0 >> vec2u(mip)) - 1, vec2i(0));
        let q0 = clamp(vec2i(floor((pxc + off) * (0.5 / sz))), vec2i(0), qm);
        let q1 = clamp(vec2i(floor((pxc - off) * (0.5 / sz))), vec2i(0), qm);
        let z0 = textureLoad(zHalf, q0, mip).r;
        let z1 = textureLoad(zHalf, q1, mip).r;
        let d0 = vec3f((vec2f(q0) * (2.0 * sz) + (sz - 0.5)) * pk * z0 + pb * z0, z0) - P;
        let d1 = vec3f((vec2f(q1) * (2.0 * sz) + (sz - 0.5)) * pk * z1 + pb * z1, z1) - P;
        let il0 = inverseSqrt(dot(d0, d0)); let il1 = inverseSqrt(dot(d1, d1));
        let w0 = sat(falloffMul / il0 + falloffAdd);
        let w1 = sat(falloffMul / il1 + falloffAdd);
        hc0 = max(hc0, mix(low0, dot(d0, V) * il0, w0));
        hc1 = max(hc1, mix(low1, dot(d1, V) * il1, w1));
      }
      let pl = mix(projLen, 1.0, 0.05);
      var h0 = -fastAcos(hc1);
      var h1 = fastAcos(hc0);
      h0 = n + clamp(h0 - n, -PI * 0.5, PI * 0.5);
      h1 = n + clamp(h1 - n, -PI * 0.5, PI * 0.5);
      let sn = sin(n);
      acc += pl * ((cosN + 2.0 * h0 * sn - cos(2.0 * h0 - n)) + (cosN + 2.0 * h1 * sn - cos(2.0 * h1 - n))) * 0.25;
    }
    vis = sat(acc / f32(AO_SLICES));
  }
  // how much of this pixel's light is ambient (what the occlusion dims): its sky light against the key light on it
  let Nw = viewToWorld(N);
  let wp = frame.camPos + viewToWorld(P);
  let nl = max(dot(Nw, world.sunDir), 0.0);
  var sun = 0.0;
  if (nl > 0.0) { sun = sunShadowFast(wp + Nw * 0.05, Nw); }
  let direct = luminance(sunLight(wp)) * nl * sun / PI;
  let amb = luminance(skyAmbient(Nw)) + 1e-7;
  let share = amb / (amb + direct);
  let fade = 1.0 - smoothstep(FX.ao.z, FX.ao.w, z);
  return vec4f(vis, (share + 0.15 * (1.0 - share)) * fade * FX.ao.x, amb + direct, 1.0);
}

// ------------------------------------------------------------------ blur + multi-bounce
@fragment fn blur(i: FullscreenOut) -> @location(0) vec4f {
  let hp = vec2i(i.pos.xy);
  let zc = textureLoad(zHalf, hp, 0).r;
  if (zc >= SKY_Z * 0.5) { return vec4f(1.0); }
  let dim = vec2i(textureDimensions(zHalf)) - 1;
  var s = vec3f(0.0); var ws = 0.0;
  let tol = 1.0 / (zc * 0.04 + 0.03);
  for (var y = -2; y < 2; y++) {
    for (var x = -2; x < 2; x++) {
      let q = clamp(hp + vec2i(x, y), vec2i(0), dim);
      let zq = textureLoad(zHalf, q, 0).r;
      let a = textureLoad(texA, q, 0).xyz;
      let w = max(0.0, 1.0 - abs(zq - zc) * tol) + 1e-4 * f32(x == 0 && y == 0);
      s += a * w; ws += w;
    }
  }
  let a = s / ws;
  let vis = a.x;
  // multi-bounce (Jimenez 2016): the albedo guessed from the lit colour over the light it was lit with
  let c = textureSampleLevel(hdrTex, samp_linear, i.uv, 0.0).rgb;
  let alb = clamp(c / max(a.z, 1e-7), vec3f(0.0), vec3f(0.9));
  let ka = 2.0404 * alb - 0.3324;
  let kb = -4.7951 * alb + 0.6417;
  let kc = 2.7552 * alb + 0.6903;
  let mb = max(vec3f(vis), ((vis * ka + kb) * vis + kc) * vis);
  return vec4f(vec3f(1.0) - (vec3f(1.0) - mb) * a.y, 1.0);
}

// ------------------------------------------------------------------ apply
@fragment fn apply(i: FullscreenOut) -> @location(0) vec4f {
  let p = vec2i(i.pos.xy);
  let z = fullZ(p);
  if (z >= SKY_Z) { return vec4f(1.0); }
  // the four nearest half-res texels (each taken from full-res pixel 2i), bilinear times depth similarity
  let t = vec2f(p) * 0.5;
  let b = vec2i(floor(t));
  let f = t - vec2f(b);
  let dim = vec2i(textureDimensions(zHalf)) - 1;
  var s = vec3f(0.0); var ws = 0.0;
  let tol = 1.0 / (z * 0.03 + 0.02);
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1u);
    let q = clamp(b + o, vec2i(0), dim);
    let bw = select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1);
    let w = (bw + 1e-3) * max(1e-3, 1.0 - abs(textureLoad(zHalf, q, 0).r - z) * tol);
    s += textureLoad(texA, q, 0).rgb * w; ws += w;
  }
  return vec4f(s / ws, 1.0);
}
