// The rooms' light as the cast's shader asks for it (hero/hero.wgsl): boulder lit its characters indoors by its house's
// probes and lamps (a shared group 3 of voxels and probes); Seven Havens has no lit rooms, so every point is outdoors.
// The same four functions with no bindings (weft's own shaders use group 3, so none is shared there): roomOf says 0,
// outdoors, everywhere, and the hero's room branches fall to the sky's light.
#include "./../world/world.wgsl"

fn roomOf(p: vec3f, n: vec3f) -> u32 { return 0u; }
fn indoorAmbient(p: vec3f, n: vec3f, room: u32) -> vec3f { return vec3f(0.0); }
fn lampIrradiance(p: vec3f, n: vec3f, room: u32, jit: f32) -> vec3f { return vec3f(0.0); }
fn roomReflection(p: vec3f, r: vec3f, rough: f32) -> vec4f { return vec4f(0.0); }
