// Written by tools/figure-pose.mjs: lyra lying in the meadow as tapered capsules (the ground frame, m), for their
// shadow on the grass and the blades they press flat (the figure itself is the town's mesh: figure.wgsl).
const FIG_LO = vec3f(-0.18230, -0.01010, -0.52650);
const FIG_HI = vec3f(1.56453, 0.28837, 0.46259);
const FIG_N = 18;
const FIG_CAPS = array<vec4f, 36>(
  vec4f(0.02770, 0.10990, -0.03195, 0.09500), vec4f(-0.09230, 0.09990, -0.03195, 0.09000),
  vec4f(0.13201, 0.10776, -0.03195, 0.05500), vec4f(0.04268, 0.11585, -0.03195, 0.05500),
  vec4f(0.49837, 0.12395, -0.03195, 0.12500), vec4f(0.20201, 0.10990, -0.03195, 0.12000),
  vec4f(0.18666, 0.10573, 0.12188, 0.06000), vec4f(0.18666, 0.10573, -0.18578, 0.06000),
  vec4f(0.60464, 0.11990, -0.03195, 0.12500), vec4f(0.49837, 0.12395, -0.03195, 0.12500),
  vec4f(0.64512, 0.11990, -0.03195, 0.12000), vec4f(0.60464, 0.11990, -0.03195, 0.12000),
  vec4f(0.18666, 0.10573, -0.18578, 0.04800), vec4f(0.42331, 0.08752, -0.32241, 0.04000),
  vec4f(0.42331, 0.08752, -0.32241, 0.04000), vec4f(0.63015, 0.11585, -0.44183, 0.03200),
  vec4f(0.63015, 0.11585, -0.44183, 0.03500), vec4f(0.73869, 0.12605, -0.50450, 0.02200),
  vec4f(0.64512, 0.11990, -0.11798, 0.08000), vec4f(1.05500, 0.13205, -0.13721, 0.05800),
  vec4f(1.05500, 0.13205, -0.13721, 0.05600), vec4f(1.46488, 0.10573, -0.15340, 0.04500),
  vec4f(1.46488, 0.10573, -0.15340, 0.04800), vec4f(1.51953, 0.24337, -0.15745, 0.04500),
  vec4f(0.18666, 0.10573, 0.12188, 0.04800), vec4f(0.42331, 0.08752, 0.25851, 0.04000),
  vec4f(0.42331, 0.08752, 0.25851, 0.04000), vec4f(0.63015, 0.11585, 0.37793, 0.03200),
  vec4f(0.63015, 0.11585, 0.37793, 0.03500), vec4f(0.73869, 0.12605, 0.44059, 0.02200),
  vec4f(0.64512, 0.11990, 0.05407, 0.08000), vec4f(1.05500, 0.13205, 0.07330, 0.05800),
  vec4f(1.05500, 0.13205, 0.07330, 0.05600), vec4f(1.46488, 0.10573, 0.08949, 0.04500),
  vec4f(1.46488, 0.10573, 0.08949, 0.04800), vec4f(1.51953, 0.24337, 0.09354, 0.04500),
);
fn figCap(p: vec3f, a: vec4f, b: vec4f) -> f32 {
  let pa = p - a.xyz; let ba = b.xyz - a.xyz;
  let k = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * k) - mix(a.w, b.w, k);
}
// their distance (roughly)
fn figSdf(p: vec3f) -> f32 {
  var d = 1e9;
  for (var i = 0; i < FIG_N; i++) { d = min(d, figCap(p, FIG_CAPS[i * 2], FIG_CAPS[i * 2 + 1])); }
  return d;
}
// their outline on the grass (x, z)
fn figPrint(q: vec2f) -> f32 {
  var d = 1e9;
  for (var i = 0; i < FIG_N; i++) {
    let a = FIG_CAPS[i * 2]; let b = FIG_CAPS[i * 2 + 1];
    d = min(d, figCap(vec3f(q.x, 0.0, q.y), vec4f(a.x, 0.0, a.z, a.w), vec4f(b.x, 0.0, b.z, b.w)));
  }
  return d;
}
// where a ray enters and leaves the box round them
fn figSpan(ro: vec3f, rd: vec3f) -> vec2f {
  let inv = 1.0 / select(rd, vec3f(1e-9), abs(rd) < vec3f(1e-9));
  let a = (FIG_LO - ro) * inv; let b = (FIG_HI - ro) * inv;
  let t0 = max(max(min(a.x, b.x), min(a.y, b.y)), min(a.z, b.z));
  let t1 = min(min(max(a.x, b.x), max(a.y, b.y)), max(a.z, b.z));
  return vec2f(max(t0, 0.0), t1);
}
