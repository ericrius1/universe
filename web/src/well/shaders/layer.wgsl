// The world laid into a host's frame: its scene's light, exposed as its own film would expose it, over what the host
// already has there by how much of the world is showing. Its scene is cleared to nothing rather than to its air when it
// is hosted, so where nothing of it was drawn the host's own picture shows through.
#include "./common"
#include "weft/fullscreen"

@group(1) @binding(11) var src: texture_2d<f32>;

struct LayerU { shows: f32, spare0: f32, spare1: f32, spare2: f32 }
@group(1) @binding(12) var<uniform> L: LayerU;

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let c = textureLoad(src, vec2i(i.pos.xy), 0);
  // (premultiplied: the cells' light already carries how much of each cell is there)
  return vec4f(safe(c.rgb * G.exposure), sat(c.a)) * sat(L.shows);
}
