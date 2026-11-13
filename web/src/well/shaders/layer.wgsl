// The world laid into a host's frame: its scene's light, exposed as its own film would expose it, over what the host
// already has there by how much of the world is showing; with the instrument's picture laid in where it's the look
// (instrument.wgsl), and the passage through the medium's surface. Its scene is cleared to nothing rather than to its
// room when it is hosted and not drawing the room, so where nothing of it was drawn the host's own picture shows through.
#include "./instrument"

@group(1) @binding(11) var src: texture_2d<f32>;

struct LayerU { shows: f32, spare0: f32, spare1: f32, spare2: f32 }
@group(1) @binding(12) var<uniform> L: LayerU;

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let uv = surfaceWarp(i.uv);
  let px = vec2i(clamp(uv, vec2f(0.0), vec2f(0.9999)) * frame.res);
  let c = select(textureLoad(src, vec2i(i.pos.xy), 0), textureSampleLevel(src, samp_linear, uv, 0.0), G.optics.w > 0.002);
  // (premultiplied: the cells' light already carries how much of each cell is there)
  var rgb = safe(c.rgb * G.exposure);
  var a = sat(c.a);
  let w = G.optics.x;
  if (w > 0.001) { rgb = mix(rgb, instrumentAt(px, uv), w); a = mix(a, 1.0, w); }
  // (the light over the well scattered by the surface as it's passed)
  rgb += vec3f(0.30, 0.27, 0.27) * G.optics.w * G.optics.w * a;
  return vec4f(rgb, a) * sat(L.shows);
}
