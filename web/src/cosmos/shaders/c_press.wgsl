// The table of the grass they press (figpress.wgsl), made once.
#include "cosmos.wgsl"
#include "figpress.wgsl"

@group(2) @binding(1) var outTex: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8) fn press(@builtin(global_invocation_id) id: vec3u) {
  if (any(vec2i(id.xy) >= PRESS_N)) { return; }
  textureStore(outTex, id.xy, vec4f(pressOf(vec2f(vec2i(id.xy) + PRESS_G0)), 0.0, 0.0, 1.0));
}
