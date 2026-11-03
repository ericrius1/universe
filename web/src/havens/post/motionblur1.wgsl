// motionblur.body.wgsl for the scene drawn without MSAA (util/tier.ts msaa): its depth one sample a pixel
@group(2) @binding(2) var depth: texture_depth_2d;
#include "./motionblur.body.wgsl"
