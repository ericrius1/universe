// The instrument: the well's cells as a microscope would show them, from what the scene's draws wrote into the optics
// target (field.wgsl, organelles.wgsl, stage.wgsl, plate.wgsl): at each pixel the optical path difference through it
// (Δn · thickness, µm: the roof's in red, kept by the brightest, plus what's added along the way in alpha), its
// haematoxylin and its PAS (stain · thickness). Each look is a
// simulation, and the page says so.
//
//   Phase contrast (the natural look for living cells in a dish: what anyone at the bench sees down an inverted
//   microscope). I = I0 · exp(−a · (OPD − blur(OPD))), the blur a couple of micrometres wide (never under a few
//   pixels: a lower power objective has a lower aperture, so its halo is wider in the sample). One high-pass gives
//   both of phase contrast's signatures: the bright halo round each cell (and bright lines in the grooves between
//   them, and the canaliculi brightest of all, a lumen less dense than the cells round it), and the shade-off inside a
//   large body. Thick is dark, nuclei paler than the cytoplasm round them, nucleoli dark dots.
//   Brightfield with a stain (fixed cells: PAS for glycogen, haematoxylin for nuclei). I = I0 · exp(−Σ σ · stain · t)
//   per channel on a white field, a little out of focus, and the faint edges an unstained thing has.
//
// The blur is done at a quarter of the frame (fs_down, then fs_blur across and down); the look is laid in where the
// world's picture is finished (layer.wgsl for a host, post.wgsl on its own page: instrumentLook).
#include "./common"
#include "weft/fullscreen"

@group(1) @binding(13) var opt: texture_2d<f32>;
@group(1) @binding(14) var optb: texture_2d<f32>;
@group(1) @binding(15) var bsrc: texture_2d<f32>;

/** blur across (1) or down (0) */
override ACROSS: bool = true;

/** a quarter of the frame: the mean of the 4×4 block under each of its pixels (four filtered taps) */
@fragment fn fs_down(i: FullscreenOut) -> @location(0) vec4f {
  let d = frame.invRes;
  var s = textureSampleLevel(bsrc, samp_linear, i.uv + vec2f(-d.x, -d.y), 0.0);
  s += textureSampleLevel(bsrc, samp_linear, i.uv + vec2f(d.x, -d.y), 0.0);
  s += textureSampleLevel(bsrc, samp_linear, i.uv + vec2f(-d.x, d.y), 0.0);
  s += textureSampleLevel(bsrc, samp_linear, i.uv + vec2f(d.x, d.y), 0.0);
  return s * 0.25;
}

/** a gaussian of σ G.optics.z render pixels (a quarter of that here), thirteen taps */
@fragment fn fs_blur(i: FullscreenOut) -> @location(0) vec4f {
  let texel = 1.0 / vec2f(textureDimensions(bsrc));
  let sq = max(G.optics.z * 0.25, 0.3);
  let stp = max(1.0, sq / 2.2);
  let dir = select(vec2f(0.0, texel.y), vec2f(texel.x, 0.0), ACROSS);
  var acc = vec4f(0.0); var wsum = 0.0;
  for (var k = -6; k <= 6; k++) {
    let x = f32(k) * stp;
    let w = exp(-0.5 * x * x / (sq * sq));
    acc += textureSampleLevel(bsrc, samp_linear, i.uv + dir * x, 0.0) * w;
    wsum += w;
  }
  return acc / wsum;
}

/** the haematoxylin's and the PAS's absorption per unit of stain · thickness, per channel */
const SIGMA_HEMA = vec3f(1.5, 1.9, 0.7);
const SIGMA_PAS = vec3f(0.45, 2.6, 1.0);

/** the instrument's picture at a pixel (display-referred light, before the host's film) */
fn instrumentAt(px: vec2i, uv: vec2f) -> vec3f {
  // (the path is in two parts: the roofs', the first one along the way (the brightest written: a far roof seen
  // through a near one isn't counted twice), in red; what's added inside or between them, in alpha)
  let o4 = textureLoad(opt, px, 0);
  let b4 = textureSampleLevel(optb, samp_linear, uv, 0.0);
  let o = vec3f(o4.r + o4.a, o4.gb);
  let b = vec3f(b4.r + b4.a, b4.gb);
  let hp = o.r - b.r;
  // (the field of view's own light: a little brighter in the middle, as a microscope's field is)
  let d = length((uv - 0.5) * vec2f(frame.aspect, 1.0));
  let field = 1.0 - 0.22 * d * d;
  // phase contrast: a neutral grey ground, a halogen lamp's warmth through a green-ish filter, held back
  // (most of the picture is the high-pass; a little of the path itself comes through, as the annulus lets it)
  let phase = vec3f(0.27, 0.285, 0.265) * field * exp(-3.0 * (hp + 0.45 * o.r));
  // brightfield: a white field through the stains, a little out of focus, with an unstained thing's faint edges
  let st = mix(o.gb, b.gb, 0.35);
  let bright = vec3f(0.82, 0.80, 0.74) * field * exp(-(SIGMA_HEMA * st.x + SIGMA_PAS * st.y)) * exp(-0.6 * hp);
  var c = mix(phase, bright, G.optics.y);
  // the camera's noise (a microscope camera's, finer than the film's grain)
  c *= 1.0 + (hash21(vec2f(px) + fract(frame.time * 13.1) * 97.0) - 0.5) * 0.05;
  return c;
}

/** the world's finished picture with the instrument's laid in by how much it shows (G.optics.x), and the passage
 *  through the medium's surface (G.optics.w): the view swimming as the surface's bend sweeps over it, and a flash of the
 *  light from overhead that the surface scatters. `scene` reads the world's picture at a uv */
fn surfaceWarp(uv: vec2f) -> vec2f {
  let k = G.optics.w;
  if (k < 0.002) { return uv; }
  let t = frame.time * 0.6;
  let p = vec3f(uv * vec2f(frame.aspect, 1.0) * 3.0, t);
  let w = vec2f(noise3(p), noise3(p + vec3f(5.2, 1.3, 0.0))) - 0.5;
  // (and the bend of the surface itself: a lens over the middle of the view, as the curved surface passes)
  let lens = (uv - 0.5) * (1.0 - 0.06 * k);
  return 0.5 + lens + w * 0.035 * k;
}
