// What every level above the cell shares: its view (each level in its own units, relative to its own floating origin:
// the zoom's target rounded to float32, so nothing here is ever a big number), rays and a projection for sprites.
#include "weft/frame"
#include "noise.wgsl"

struct Lv {
  origin: vec3f, weight: f32,     // the level's floating origin (its units) and how much of it shows (0..1)
  eye: vec3f, scale: f32,         // the eye relative to the origin; the view distance, in the level's units
  fwd: vec3f, tanHalf: f32,       // the camera's basis in the level's axes; tan(fovY / 2)
  right: vec3f, aspect: f32,
  up: vec3f, time: f32,           // time (s, wrapped)
  sun: vec3f, exposure: f32,      // toward the Sun (unit, the level's axes)
  sunPos: vec3f, pxAngle: f32,    // the Sun relative to the origin; radians per pixel
  a: vec4f, b: vec4f, c: vec4f, d: vec4f,   // the level's own
  view: vec4f,                    // xy 1 / the target's size (px); z 1: a dome's fisheye; w its sweet spot's elevation
  march: vec4f,                   // x where a march's steps start this frame (renderer.ts marchJitter, 0..1)
}
@group(2) @binding(0) var<uniform> L: Lv;

const PI = 3.14159265;

// smoothstep for either order of edges (WGSL leaves low > high undefined, and Metal makes it NaN)
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }

// a stable per-pixel dither for marches (interleaved gradient noise)
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
// a march's dither: the pixel's, moved on each frame the view holds still (the volume's history averages them)
fn marchDither(p: vec2f) -> f32 { return fract(ign(p) + L.march.x); }

// a float texture (unfilterable) read bilinearly at a uv (clamped to its edge)
fn bilinear(t: texture_2d<f32>, uv: vec2f) -> f32 {
  let d = vec2f(textureDimensions(t));
  let q = clamp(uv, vec2f(0.0), vec2f(1.0)) * d - 0.5;
  let i = vec2i(floor(q));
  let f = q - floor(q);
  let m = vec2i(d) - 1;
  let a = textureLoad(t, clamp(i, vec2i(0), m), 0).r;
  let b = textureLoad(t, clamp(i + vec2i(1, 0), vec2i(0), m), 0).r;
  let c = textureLoad(t, clamp(i + vec2i(0, 1), vec2i(0), m), 0).r;
  let e = textureLoad(t, clamp(i + vec2i(1, 1), vec2i(0), m), 0).r;
  return mix(mix(a, b, f.x), mix(c, e, f.x), f.y);
}

fn ndcOf(uv: vec2f) -> vec2f { return vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0); }
// ---- a planetarium's dome: a domemaster, the 180° equidistant fisheye (the zenith at the centre, the front at the
// bottom rim). The camera looks at the dome's sweet spot, `elevation` above the front horizon; the viewer faces +z.
fn domeBasis() -> mat3x3f {
  let e = L.view.w;
  // (columns: the viewer's right, up and forward in the dome's axes)
  return mat3x3f(vec3f(-1.0, 0.0, 0.0), vec3f(0.0, cos(e), -sin(e)), vec3f(0.0, sin(e), cos(e)));
}
fn isDome() -> bool { return L.view.z > 0.5; }

// the view ray through a screen uv (level axes)
fn rayDir(uv: vec2f) -> vec3f {
  if (isDome()) {
    let q = (uv - 0.5) * 2.0;
    let r = max(length(q), 1e-6);
    // (past the rim, the rim's own direction: nothing there is seen, and the bloom has nothing new to spread)
    let th = min(r, 1.0) * 0.5 * PI;
    let d = vec3f(sin(th) * q.x / r, cos(th), sin(th) * q.y / r);
    let k = transpose(domeBasis()) * d;      // (right, up, forward) components
    return normalize(L.right * k.x + L.up * k.y + L.fwd * k.z);
  }
  let n = ndcOf(uv);
  return normalize(L.fwd + L.right * (n.x * L.tanHalf * L.aspect) + L.up * (n.y * L.tanHalf));
}
// a point relative to the eye to clip space (no depth: the levels paint in order)
fn clipOf(rel: vec3f) -> vec4f {
  if (isDome()) {
    let n = normalize(rel);
    let d = domeBasis() * vec3f(dot(n, L.right), dot(n, L.up), dot(n, L.fwd));
    let off = acos(clamp(d.y, -1.0, 1.0));
    // (below the dome's rim: nothing)
    if (off > 0.52 * PI) { return vec4f(0.0, 0.0, 0.0, -1.0); }
    let uv = vec2f(0.5) + d.xz * (off / PI) / max(length(d.xz), 1e-6);
    return vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
  }
  let z = dot(rel, L.fwd);
  return vec4f(dot(rel, L.right) / (L.tanHalf * L.aspect), dot(rel, L.up) / L.tanHalf, 0.0, z);
}
// the corner of a screen-aligned quad of `rpx` pixels round a clip position
fn quadCorner(c: vec4f, corner: vec2f, rpx: f32) -> vec4f {
  return vec4f(c.xy + corner * rpx * 2.0 * L.view.xy * c.w, c.z, c.w);
}
const CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

fn sphereHit(ro: vec3f, rd: vec3f, c: vec3f, r: f32) -> vec2f {
  let oc = ro - c;
  let b = dot(oc, rd);
  let h = b * b - (dot(oc, oc) - r * r);
  if (h < 0.0) { return vec2f(-1.0); }
  let s = sqrt(h);
  return vec2f(-b - s, -b + s);
}

// a star's colour from its temperature (K), roughly a black body's in linear sRGB, normalised
fn blackbody(t: f32) -> vec3f {
  let x = clamp(t, 1500.0, 40000.0) / 100.0;
  var r = 1.0; var g = 1.0; var b = 1.0;
  if (x <= 66.0) {
    g = clamp(0.39 * log(x) - 0.634, 0.0, 1.0);
    b = select(clamp(0.543 * log(x - 10.0) - 1.196, 0.0, 1.0), 0.0, x <= 19.0);
  } else {
    r = clamp(1.293 * pow(x - 60.0, -0.1332), 0.0, 1.0);
    g = clamp(1.13 * pow(x - 60.0, -0.0755), 0.0, 1.0);
  }
  let c = pow(vec3f(r, g, b), vec3f(2.2));
  return c / max(max(c.r, c.g), c.b);
}
