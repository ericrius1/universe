// Motes: a few thousand specks adrift in the water between the eye and what it looks at — debris, the odd vesicle too
// small to tell — soft discs out of focus, slow, faint. Nearly free, and they give the water a depth of its own (the
// "marine snow" of docs/look.md). Space is tiled at two sizes round the zoom (tiles about S wide, S the camera's
// distance, at the powers of two below and above it, cross-faded as the zoom moves between them, as the crowd's levels
// are), each tile holding the same few specks at hashed spots, so they stay put in the world as the view turns.
// Drawn into the thin layers (renderer.ts thin: weighted blended, at the full size, against the scene's depth).
#include "world.wgsl"

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) a: f32,
  @location(2) @interpolate(flat) dist: f32,
}
struct OitOut { @location(0) accum: vec4f, @location(1) reveal: vec4f }

const PER_TILE: u32 = 4u;
const SIDE: u32 = 9u;          // tiles a side round the focus, at each of the two sizes
const PER_LEVEL: u32 = SIDE * SIDE * SIDE * PER_TILE;

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var out: VOut;
  out.pos = vec4f(0.0, 0.0, -2.0, 1.0);
  let m = vi / 6u;
  let lev = m / PER_LEVEL;
  let k = m % PER_LEVEL;
  let ti = k / PER_TILE;
  // the two tile sizes either side of the zoom, and how much each shows
  let lf = log2(max(G.scale, 1.0) * 0.75);
  let L = floor(lf) + f32(lev);
  let C = exp2(L);
  let wL = select(1.0 - fract(lf), fract(lf), lev == 1u);
  if (wL < 0.01) { return out; }
  let fa = absP(G.focus);
  let t0 = floor(fa / C) - f32(SIDE / 2u);
  let tile = t0 + vec3f(f32(ti % SIDE), f32((ti / SIDE) % SIDE), f32(ti / (SIDE * SIDE)));
  let h = hash3i(vec3i(tile) + vec3i(i32(k % PER_TILE) * 7919, i32(L) * 131, 17));
  let h2 = hash3i(vec3i(tile) * 3 + vec3i(i32(k % PER_TILE), i32(L), 29));
  // (adrift: a slow wander of a few percent of a tile a second, real time)
  let tt = frame.time * 0.05;
  let drift = vec3f(sin(tt + h2.x * 6.28), sin(tt * 0.8 + h2.y * 6.28), cos(tt * 0.9 + h2.z * 6.28)) * 0.08;
  let c = (tile + h + drift) * C - G.origin;
  let toEye = frame.camPos - c;
  let dist = length(toEye);
  // a speck the size a few hundredths of its tile, faint, gone close to the lens and far into the haze
  let r = C * mix(0.006, 0.02, h2.x);
  let near = smoothstep(G.scale * 0.15, G.scale * 0.4, dist);
  let far = exp(-dist / (G.fogDist * 0.9));
  out.a = wL * near * far * mix(0.05, 0.16, h2.y) * (1.0 - G.fluo);
  if (out.a < 0.003 || isCut(c)) { return out; }
  let corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi % 6u];
  // (out of focus by how far from the focus's distance it lies: a speck far off the plane a wider, fainter disc)
  let defocus = 1.0 + 2.5 * abs(dist - G.scale) / max(dist, 1.0) * G.dof;
  // (no wider on screen than ~40 px: a speck by the lens is gone, not a blot over the frame)
  if (r * defocus / max(dist * G.pxAngle, 1e-9) > 40.0) { return out; }
  let rr = r * defocus;
  let right = normalize(cross(frame.camUp, toEye / dist));
  let up = cross(toEye / dist, right);
  let p = c + (right * corner.x + up * corner.y) * rr;
  out.a /= defocus * defocus;
  out.uv = corner;
  out.dist = dist;
  out.pos = frame.viewProj * vec4f(p, 1.0);
  return out;
}

@fragment fn fs(in: VOut) -> OitOut {
  let q = dot(in.uv, in.uv);
  if (q >= 1.0) { discard; }
  let a = in.a * exp(-q * 3.0);
  // the water's own colour, lifted: a speck lit by the light the haze has
  let col = G.fogColor * 4.0 + vec3f(0.012, 0.011, 0.01);
  let zn = in.dist / max(G.scale, 1.0);
  let w = clamp(10.0 / (1e-5 + pow(zn / 4.0, 3.0)), 1e-2, 3e3) * a;
  var out: OitOut;
  out.accum = vec4f(col * a, a) * w;
  out.reveal = vec4f(a);
  return out;
}
