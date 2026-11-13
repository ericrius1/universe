// The things that are not cells: the air you are flying through, the collagen the cells are standing on, and the
// bile canaliculi running in the grooves between them.
#include "./common"
#include "weft/fullscreen"
#include "weft/mesh"

// ------------------------------------------------------------------------------------------------- the air

struct SkyOut { @location(0) color: vec4f, @location(1) pick: u32 }

@fragment fn fs_sky(i: FullscreenOut) -> SkyOut {
  var o: SkyOut;
  let d = length(i.uv - vec2f(0.5, 0.46)) * 1.5;
  var c = airColor();
  // in the bright register the field falls off very slightly toward the corners, the way a lit sample does
  c *= mix(1.03 - 0.1 * d * d, 1.0, G.mode);
  c = mix(c, c + vec3f(0.012, 0.006, 0.0), smoothstep(0.2, 1.0, i.uv.y) * (1.0 - G.mode));
  o.color = vec4f(c * G.dim, 1.0);
  o.pick = 0u;
  return o;
}

// ------------------------------------------------------------------------------------------------- the floor

struct FloorOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
}

@vertex fn vs_floor(@builtin(vertex_index) vi: u32) -> FloorOut {
  let q = array<vec2f, 6>(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(-1,1), vec2f(1,-1), vec2f(1,1))[vi];
  // (the collagen under the field and no further: past the field's edge the well's floor is the plate's picture of it)
  let R = G.fieldHalf;
  var o: FloorOut;
  o.wp = vec3f(q.x * R, -0.02, q.y * R);
  o.pos = frame.viewProj * vec4f(o.wp, 1.0);
  return o;
}

struct FOut { @location(0) color: vec4f, @location(1) pick: u32 }

@fragment fn fs_floor(i: FloorOut) -> FOut {
  var o: FOut;
  // collagen I: fine fibres, laid every which way, the only thing a hepatocyte will attach to
  let p = i.wp.xz;
  var fib = 0.0;
  for (var k = 0; k < 3; k++) {
    let a = 0.9 + f32(k) * 1.7;
    let dir = vec2f(cos(a), sin(a));
    fib += (0.5 + 0.5 * sin(dot(p, dir) * 2.6 + fbm3(vec3f(p * 0.03, f32(k))) * 9.0)) / 3.0;
  }
  let grain = fbm3(vec3f(p * 0.22, 5.0));
  var base = C_FLOOR * (0.93 + 0.1 * fib + 0.07 * grain);
  var col = lit(base, vec3f(0.0, 1.0, 0.0), i.wp, 0.0, 0.02);
  col = air(col, i.wp);
  col = mix(col, vec3f(0.01, 0.012, 0.02), G.mode);
  o.color = vec4f(safe(col * G.dim), 1.0);
  o.pick = (17u << 20u);
  return o;
}

// ------------------------------------------------------------------------------------------- the canaliculi

@group(1) @binding(2) var<storage, read> cverts: array<MeshVertex>;

struct CanalOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,
  @location(3) @interpolate(flat) ci: u32,
}

@vertex fn vs_canal(@builtin(vertex_index) vi: u32) -> CanalOut {
  let v = cverts[vi];
  let ci = v.mat;
  var o: CanalOut;
  o.ci = ci;
  let n = meshNormal(v);
  // the lumen squeezes shut and opens again on its own — unless something has stopped it
  let tone = canalTone(ci);
  let p = meshPos(v) + n * 0.46 * (tone - 1.0);
  o.wp = p;
  o.n = n;
  o.uv = meshUV(v);
  o.pos = frame.viewProj * vec4f(p, 1.0);
  return o;
}

@fragment fn fs_canal(i: CanalOut) -> FOut {
  var o: FOut;
  let fate = cellFate(i.ci);
  let loss = sat(G.effluxLoss * fate);
  let n = unit(i.n);
  // the dye travelling down the lumen: what a canalicular efflux assay actually watches
  let flow = 0.5 + 0.5 * sin(i.uv.x * 7.0 - frame.time * 1.6 + f32(i.ci) * 0.7);
  var base = mix(C_BILE, C_BILE_OFF, loss);
  base *= 0.7 + 0.75 * flow * (1.0 - loss * 0.8);
  let emis = (1.3 - 1.1 * loss) * (0.6 + 0.7 * flow);
  var col = lit(base, n, i.wp, 0.6, emis);
  col = mix(col, C_HARM, sat(G.leak * fate) * 0.4);
  col = air(col, i.wp);
  let chan = vec3f(0.3, 1.0, 0.76) * G.stain2.x * (1.0 - loss) * (0.5 + 0.9 * flow) * 2.0;
  col = mix(col, chan, G.mode);
  o.color = vec4f(safe(col * G.dim), 1.0);
  o.pick = (13u << 20u) | (i.ci & 0xfffffu);
  return o;
}
