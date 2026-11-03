// (the scene drawn with MSAA: its depth multisampled, sample 0 read; smudge1.wgsl without, util/tier.ts msaa)
@group(2) @binding(2) var depth: texture_depth_multisampled_2d;
#include "./smudge.body.wgsl"
