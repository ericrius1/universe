// (the scene drawn with MSAA: its depth multisampled, sample 0 read; motionblur1.wgsl without, util/tier.ts msaa)
@group(2) @binding(2) var depth: texture_depth_multisampled_2d;
#include "./motionblur.body.wgsl"
