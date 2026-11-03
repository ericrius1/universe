// (the scene's depth multisampled, sample 0 read: without MSAA (a phone) post.ts hands it a stand-in and smudge never runs)
@group(2) @binding(2) var depth: texture_depth_multisampled_2d;
#include "./smudge.body.wgsl"
