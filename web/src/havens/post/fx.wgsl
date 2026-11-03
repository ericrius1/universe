// The newer effects in the final pass (post.wgsl includes this; post/fx.ts drives them):
//   fxScene   the scene through the lens (a phone's edges blended first: fxEdgeAA): chromatic aberration (red out, blue in, toward the frame's edge), contrast-
//             adaptive sharpening (AMD's CAS, on the exposed, compressed luminance), the depth of field over it
//   fxLight   light added in the air and the lens (scene radiance, before the exposure): crepuscular shafts; round the
//             sun or moon a glow, a diffraction starburst and an optional anamorphic streak; the lens's ghosts strung
//             along the line from the light through the centre and a faint halo ring — each by how much of the
//             light's disc is in clear sky (rays.wgsl measures it)
//   fxGrade   the Seven Havens' grade by the time of day in display space: the warm-cool split (shadows toward
//             lavender and violet — indigo by night — highlights toward warm gold: a little always, most at golden
//             hour), the dusk's magenta-violet, the reds' and golds' richness (their chroma raised, never past the
//             gamut's edge), a little punch at noon and under cloud (post.wgsl's P.look: the split, the richness)
//   fxGrain   film grain: luminance only, strongest in the mids, a new pattern every frame
#include "./fxu.wgsl"

@group(2) @binding(11) var fxSceneZ: texture_2d<f32>;
@group(2) @binding(15) var<storage, read> fxRead: array<f32, 4>;
@group(2) @binding(17) var fxShafts: texture_2d<f32>;
@group(2) @binding(19) var fxDof: texture_2d<f32>;

fn fxLuma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

fn fxCoc(z: f32) -> f32 {
  let focus = select(fxRead[1], FX.dof.y, FX.dof.y > 0.0);
  return min(FX.dof.z * abs(1.0 - focus / max(z, 0.05)), FX.dof.w) * frame.res.y / 1080.0;
}

// a phone's antialiasing (it renders without MSAA: on a tile GPU the post chain's multisampled depth halved boulder's
// frame rate): FXAA's edge blend (Lottes) on the scene, by its exposed, compressed luminance — the four diagonal
// neighbours find an edge and its direction, two or four taps along it blend it, and a blend that overshoots the
// neighbourhood's range keeps the nearer two. The final pass's EDGE_AA (post.ts); nothing changes without it.
fn fxEdgeLuma(c: vec3f) -> f32 { let l = fxLuma(c) * world.exposure; return l / (1.0 + l); }
fn fxEdgeAA(uv: vec2f, g: vec3f) -> vec3f {
  let t = 1.0 / vec2f(textureDimensions(hdr));
  let nw = fxEdgeLuma(textureSampleLevel(hdr, samp_linear, uv + vec2f(-t.x, -t.y), 0.0).rgb);
  let ne = fxEdgeLuma(textureSampleLevel(hdr, samp_linear, uv + vec2f(t.x, -t.y), 0.0).rgb);
  let sw = fxEdgeLuma(textureSampleLevel(hdr, samp_linear, uv + vec2f(-t.x, t.y), 0.0).rgb);
  let se = fxEdgeLuma(textureSampleLevel(hdr, samp_linear, uv + vec2f(t.x, t.y), 0.0).rgb);
  let m = fxEdgeLuma(g);
  let lo = min(m, min(min(nw, ne), min(sw, se)));
  let hi = max(m, max(max(nw, ne), max(sw, se)));
  if (hi - lo < max(0.03, hi * 0.12)) { return g; }
  var dir = vec2f(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
  let reduce = max((nw + ne + sw + se) * 0.03125, 1.0 / 128.0);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), vec2f(-8.0), vec2f(8.0)) * t;
  let a = 0.5 * (textureSampleLevel(hdr, samp_linear, uv + dir * (1.0 / 3.0 - 0.5), 0.0).rgb + textureSampleLevel(hdr, samp_linear, uv + dir * (2.0 / 3.0 - 0.5), 0.0).rgb);
  let b = a * 0.5 + 0.25 * (textureSampleLevel(hdr, samp_linear, uv - dir * 0.5, 0.0).rgb + textureSampleLevel(hdr, samp_linear, uv + dir * 0.5, 0.0).rgb);
  let lb = fxEdgeLuma(b);
  return select(b, a, lb < lo || lb > hi);
}

fn fxScene(uv: vec2f, edgeAA: bool) -> vec3f {
  var g = textureSampleLevel(hdr, samp_linear, uv, 0.0).rgb;
  if (edgeAA) { g = fxEdgeAA(uv, g); }
  var c = g;
  if (FX.lens.x > 0.0) {
    let q = uv - 0.5;
    let ca = q * (0.25 + dot(q, q) * 2.0) * FX.lens.x * 0.006;
    c = vec3f(textureSampleLevel(hdr, samp_linear, uv + ca, 0.0).r, g.g, textureSampleLevel(hdr, samp_linear, uv - ca, 0.0).b);
  }
  if (FX.lens.y > 0.0) {
    let t = 1.0 / vec2f(textureDimensions(hdr));
    let e = world.exposure;
    let k = vec4f(fxLuma(textureSampleLevel(hdr, samp_linear, uv + vec2f(0.0, -t.y), 0.0).rgb), fxLuma(textureSampleLevel(hdr, samp_linear, uv + vec2f(0.0, t.y), 0.0).rgb),
                  fxLuma(textureSampleLevel(hdr, samp_linear, uv + vec2f(-t.x, 0.0), 0.0).rgb), fxLuma(textureSampleLevel(hdr, samp_linear, uv + vec2f(t.x, 0.0), 0.0).rgb)) * e;
    let n = k / (1.0 + k);
    let l0 = fxLuma(g) * e;
    let c0 = l0 / (1.0 + l0);
    let mn = min(c0, min(min(n.x, n.y), min(n.z, n.w)));
    let mx = max(c0, max(max(n.x, n.y), max(n.z, n.w)));
    let amp = sqrt(saturate(min(mn, 1.0 - mx) / max(mx, 1e-4)));
    let w = -amp / mix(8.0, 5.0, saturate(FX.lens.y));
    let s = clamp((c0 + w * (n.x + n.y + n.z + n.w)) / (1.0 + 4.0 * w), 0.0, 0.999);
    c *= clamp((s / (1.0 - s)) / max(l0, 1e-6), 0.6, 1.6);
  }
  if (FX.dof.x > 0.5) {
    let z = textureLoad(fxSceneZ, vec2i(uv * vec2f(textureDimensions(fxSceneZ))), 0).x;
    let d = textureSampleLevel(fxDof, samp_linear, uv, 0.0);
    c = mix(c, d.rgb, smoothstep(0.6, 1.8, max(fxCoc(min(z, 1e6)), d.a)));
  }
  return c;
}

fn fxLight(uv: vec2f) -> vec3f {
  let s = keyOnScreen();
  if (s.z <= 0.0) { return vec3f(0.0); }
  let K = keyColour();
  let vis = fxRead[0];
  var L = vec3f(0.0);
  let rd = viewRay(uv);
  let mu = dot(rd, world.sunDir);
  if (FX.rays.x > 0.0) {
    let sh = textureSampleLevel(fxShafts, samp_linear, uv, 0.0).r;
    let z = textureLoad(fxSceneZ, vec2i(uv * vec2f(textureDimensions(fxSceneZ))), 0).x / max(dot(rd, frame.camFwd), 1e-4);
    // (air in front of a near thing glows less than the long view; over the sky only a little: it has the sun's glow)
    let air = select(1.0 - exp(-z / FX.rays.w), 0.12, z >= 6e4);
    let g = 0.76;
    let phase = pow((1.0 - g) * (1.0 - g) / (1.0 + g * g - 2.0 * g * mu), 1.5);
    // (moonlight barely makes shafts)
    L += K * sh * sh * air * phase * FX.rays.x * 0.4 * smoothstep(0.0, 0.3, s.z) * mix(1.0, 0.2, world.moon.z);
  }
  if ((FX.flare.y > 0.0 || FX.flare.z > 0.0) && vis > 0.001) {
    let d = (uv - s.xy) * vec2f(frame.aspect, 1.0);
    let r = length(d);
    let a = atan2(d.y, d.x);
    let glow = exp(-r * 30.0) * 0.22 + exp(-r * 7.0) * 0.02;
    // six blades' diffraction spikes, a finer second set, flickering a little along their length
    let star = (pow(abs(cos(a * 3.0 + 0.35)), 120.0) * 0.35 + pow(abs(cos(a * 8.0 + 1.1)), 300.0) * 0.12) * exp(-r * 14.0) * (0.85 + 0.15 * sin(r * 160.0));
    let streak = exp(-abs(d.y) * 240.0) * exp(-abs(d.x) * 2.2) * FX.flare.z;
    // (the moon's light a soft halo: little of the lens's starburst)
    L += K * vis * ((glow + star * mix(1.0, 0.15, world.moon.z)) * FX.flare.y + streak * vec3f(0.75, 0.88, 1.15)) * smoothstep(0.0, 0.2, s.z);
  }
  if (FX.flare.x > 0.0 && vis > 0.001) {
    // ghosts: soft discs, brighter at the rim, each its coating's colour, at fixed places along the line
    let axis = vec2f(0.5) - s.xy;
    var gsum = vec3f(0.0);
    var at = array<f32, 6>(0.35, 0.62, 0.9, 1.25, 1.55, 1.9);
    var sizes = array<f32, 6>(0.025, 0.06, 0.018, 0.09, 0.035, 0.14);
    for (var k = 0; k < 6; k++) {
      let fk = f32(k);
      let t = at[k];
      let size = sizes[k];
      let p = s.xy + axis * 2.0 * t;
      let dd = length((uv - p) * vec2f(frame.aspect, 1.0)) / size;
      let disc = smoothstep(1.0, 0.82, dd) * (0.45 + 0.55 * smoothstep(0.3, 0.95, dd));
      let tint = 0.6 + 0.4 * cos(6.2831 * (fk * 0.27 + 0.1 + vec3f(0.0, 0.33, 0.67)));
      gsum += tint * disc * (0.6 + 0.4 * fract(fk * 0.618)) / (1.0 + size * 30.0);
    }
    // the halo: a thin ring round the light, red outside, blue in
    let hr = length((uv - s.xy) * vec2f(frame.aspect, 1.0));
    let ring = vec3f(exp(-pow((hr - 0.305) / 0.012, 2.0)), exp(-pow((hr - 0.3) / 0.012, 2.0)), exp(-pow((hr - 0.295) / 0.012, 2.0))) * 0.06;
    // (strongest when the light is in the frame, gone as it leaves)
    let inFrame = 1.0 - smoothstep(0.45, 0.75, max(abs(s.x - 0.5), abs(s.y - 0.5)));
    L += K * vis * (gsum + ring) * FX.flare.x * 0.025 * inFrame * smoothstep(0.2, 0.5, s.z);
  }
  return L;
}

fn fxGrade(d0: vec3f) -> vec3f {
  let k = FX.grade.x;
  if (k <= 0.0) { return d0; }
  let alt = degrees(asin(clamp(world.sunTrue.y, -1.0, 1.0)));
  let golden = smoothstep(-3.0, 2.0, alt) * (1.0 - smoothstep(8.0, 18.0, alt));
  let dusk = smoothstep(-13.0, -5.0, alt) * (1.0 - smoothstep(-3.0, 1.0, alt));
  let noon = smoothstep(25.0, 50.0, alt);
  let night = world.sunTrue.w;
  let cover = cloudSky.dome.x * smoothstep(-4.0, 4.0, alt);
  var d = d0;
  let l = fxLuma(d);
  let shK = 1.0 - smoothstep(0.02, 0.5, l);
  let hiK = smoothstep(0.4, 0.95, l);
  // the split: shadows toward lavender (indigo by night), highlights toward warm gold (the lavender all blue, none of it
  // red: on the red stone a red lean in the shade reads crimson)
  let cool = mix(vec3f(0.002, -0.004, 0.028), vec3f(0.0, -0.004, 0.034), night);
  let warm = vec3f(0.024, 0.008, -0.026);
  d += (cool * shK * (1.0 + 0.6 * golden + 0.5 * dusk) + warm * hiK * (1.0 + 1.6 * golden) * (1.0 - 0.6 * night)) * P.look.w * k;
  // the dusk's magenta-violet over everything
  d += vec3f(0.006, -0.008, 0.018) * dusk * k;
  d = (d - 0.45) * (1.0 + (0.04 * noon + 0.06 * cover) * k) + 0.45;
  d = fxRicher(d, P.look2.x * k * (1.0 + 0.5 * golden));
  return d * vec3f(1.0 - 0.015 * cover * k, 1.0, 1.0 + 0.02 * cover * k);
}

// the reds', oranges' and golds' chroma raised by s (0 none) about their luminance, pushed no further than the gamut's
// edge (no channel past 0 or 1)
fn fxRicher(d: vec3f, s: f32) -> vec3f {
  let mx = max(d.r, max(d.g, d.b));
  let ch = mx - min(d.r, min(d.g, d.b));
  if (s <= 0.0 || ch < 1e-4) { return d; }
  // the hue (0..1 from red): all of it from red to gold, easing out toward yellow and, quickly, toward crimson (a red
  // leaning blue is the shade's: made richer it reads magenta)
  var h = ((d.r - d.g) / ch + 4.0) / 6.0;
  if (mx == d.r) { h = fract((d.g - d.b) / ch / 6.0); } else if (mx == d.g) { h = ((d.b - d.r) / ch + 2.0) / 6.0; }
  let w = select(smoothstep(0.965, 0.995, h), 1.0 - smoothstep(0.12, 0.18, h), h < 0.5);
  let l = fxLuma(d);
  let up = (vec3f(1.0) - l) / max(d - l, vec3f(1e-5));
  let dn = l / max(l - d, vec3f(1e-5));
  let edge = min(min(select(dn.x, up.x, d.x > l), select(dn.y, up.y, d.y > l)), select(dn.z, up.z, d.z > l));
  return l + (d - l) * min(1.0 + s * w, max(edge, 1.0));
}

fn fxGrain(d: vec3f, px: vec2f) -> vec3f {
  if (FX.lens.z <= 0.0) { return d; }
  // (triangular noise: two hashes)
  let f = fract(FX.misc.x * 0.6180339) * 917.0;
  let n = hash12(px + f) + hash12(px * 1.37 + f * 1.7 + 31.0) - 1.0;
  let l = fxLuma(d);
  return d + n * FX.lens.z * (0.15 + 3.0 * l * (1.0 - l));
}
