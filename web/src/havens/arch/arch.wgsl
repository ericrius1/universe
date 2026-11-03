// The builders' architecture (arch.ts draws it: the city, the temple and its gardens): each part one mesh in world
// metres cut into pieces on a lattice (chunks.ts), every vertex with its material, tint, ambient, glow and the night's
// light baked into it (bake.ts). Lit as every lit thing in the world is (world.wgsl): the key light and its shadow, the
// sky's light (darker in the builder's creases), the warm canyon floor's bounce, the key's highlight and the sky's
// reflection on what's smooth (gold, glaze, glass), the dynamic lamps (Iroh's fire), the air between. Painted, never
// inked: each material's texture at its real size (or fitted whole to each face: the lavender panels, the teal
// friezes), striped cloth, glazing bars on every pane, a slow hand-painted wander in every colour, and shade leaning
// violet (the bible's first rule). The tiles (zellige: a field of stars and crosses, a band of interlaced stars, a
// border of diamonds and chevrons) and the lattice doors are drawn here from a few numbers, crisp close to and their
// mean colour far off; so are the cut of the stone and the wear of the years (the painted detail: the textures' light
// and dark as relief, cut blocks' joints, grime low on the walls, streaks, dust, the plaster's dado, patches and
// cracks), faded away before they could shimmer. At night the lights the builders placed pool on the streets and walls
// round every lantern and window, the windows, doorways and lanterns themselves glow, and the braziers, once lit, flicker. Under the Haven, in the caverns
// (world.wgsl underground()), neither the sun nor the sky: the caverns' dim teal light all round, their crystals' lamps
// lit day and night, and the crystals and the green water glowing on their own (cavernGlow). Inside the walk-in room
// (room/) the light is an inside's: the sky only as much as its door and window let in, warmed by its walls, and the
// key only where it comes through them (the window's lattice drawn across the floor in sunlight).
#include "./../world/world.wgsl"

struct MatU {
  base: vec4f,   // rgb its colour (linear), w its roughness
  tex: vec4f,    // x its texture's layer (-1 none), y the texture's size on the surface (m), z its own colours (1) or the
                 // base colour with its detail (0), w how strongly the texture shows
  look: vec4f,   // x metalness, y a dielectric's reflectance, z the painted wander, w the uv mapping (0 by the metre,
                 // 1 a panel per face, 2 a frieze band, 3 striped cloth, 4 a window pane, 5 a tile field, 6 a tile band,
                 // 7 a tile border, 8 a lattice door, 9 cut blocks)
  glow: vec4f,   // rgb the light it gives when it glows (linear), w how much of its own colour shows in that light
  paint: vec4f,  // its painted detail (below): x the texture's relief, y a cut block's length (m), z the wear it
                 // takes, w the plaster's marks
}
struct ArchU {
  mats: array<MatU, 29>,
  night: vec4f,  // x the lamps' light on screen per candela at 1 m, y the exposure it's held at (darker nights: no
                 // brighter on screen), z the glows' strength, w the lights on (-1: by the sun)
  look: vec4f,   // x the shade's lean to violet, y the painted wander, z a debug view (0 none, 1 the pieces, 2 the night's
                 // light alone, 3 the albedo, 4 the normals, 6 the painted detail alone, 7 the height over the ground),
                 // w the canyon floor's bounce
  pal: array<vec4f, 30>,   // the tiles' palettes (materials.ts PALETTES), five colours each (linear): the ground, two
                           // field colours, the ink of the lines, the gold
  // the walk-in room (room/room.ts), lit inside as an inside: [0] its inside's middle (world) and w the cosine of its yaw
  // (ArchBuilder's), [1] half its size (x across, y up, z deep: 0 where there's none) and w the yaw's sine, [2] its
  // window in its -x wall (the middle's z
  // and y, from the inside's middle; half its width and height), [3] its door in its +z wall (the same: x and y, half
  // width and height), [4] x the walls' thickness, y the window lattice's pitch (along its diagonals), z its bars' half
  // width, w the sky let in (a fraction of the open sky's light), [5] its lantern (from the inside's middle) and w the
  // light it fills the room with off its walls (candela's worth: its first fire's, flickering with it)
  room: array<vec4f, 6>,
  // the painted detail's strengths (below; arch.ts settings): x all of it (0: none, the look without it), y the
  // textures' relief, z the cut blocks', w drawn in full (1; the phone's 0: no relief, none of the finest marks);
  // and the wear's: x the grime, y the streaks, z the dust and the sun's fading, w the plaster's marks
  paint: vec4f,
  wear: vec4f,
}
struct Chunk { o: vec4f }   // a piece's lattice: xyz its origin (world m), w its step (m)

@group(2) @binding(0) var<storage, read> chunks: array<Chunk>;
@group(2) @binding(1) var<uniform> AU: ArchU;
@group(2) @binding(2) var matTex: texture_2d_array<f32>;
@group(2) @binding(3) var<storage, read> fires: array<vec4f>;   // per fire: rgb its colour, w how lit (0 out .. 1)

const LUMA = vec3f(0.2126, 0.7152, 0.0722);
// the shade's light: lavender, at unit luminance; and the violet a colour is glazed toward in the shade (blue over red:
// the red plaster in shade goes maroon to violet, never crimson)
const VIOLET = vec3f(1.04, 0.9, 1.58);
const GLAZE = vec3f(0.96, 0.96, 1.42);
// chunks.ts RGBM_RANGE
const RGBM_RANGE = 4096.0;

struct VIn {
  @builtin(instance_index) piece: u32,
  @location(0) q: vec4u,        // the lattice position; w the material | the glow << 8
  @location(1) oct: vec2f,      // the normal, octahedral
  @location(2) uv: vec2f,
  @location(3) tint: vec4f,     // rgb the tint / 2, a the ambient
  @location(4) night: vec4f,    // the night's light, RGBM
  @location(5) fire: u32,       // the nearest fire's index (0xffff none) | the fires' strength (a half, its sign set on
                                // the fire's own body) << 16
}
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) p: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,
  @location(3) @interpolate(perspective, centroid) tint: vec4f,
  // rgb the baked lamps' light now (irradiance: on, held, flickering), a how far its glow is on (the night's; a fire's
  // body: its fire). Taken at the centroid of the samples a triangle covers: the light falls off steeply across the
  // refined triangles round a lamp, and read at the centre of a pixel the triangle only grazes it would be carried on
  // past the triangle's edge, below zero
  @location(4) @interpolate(perspective, centroid) lamp: vec4f,
  @location(5) @interpolate(flat) id: vec4u,      // the material, the glow (0..255; a tile's or a lattice's palette), the piece
}

fn latticePos(piece: u32, q: vec3u) -> vec3f {
  let c = chunks[piece].o;
  return c.xyz + vec3f(q) * c.w;
}

fn octNormal(e: vec2f) -> vec3f {
  var n = vec3f(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
  let t = max(-n.z, 0.0);
  n.x += select(t, -t, n.x >= 0.0);
  n.y += select(t, -t, n.y >= 0.0);
  return normalize(n);
}

// the lights on: from as the sun nears the horizon at dusk till it's back over it at dawn
fn lightsOn() -> f32 {
  if (AU.night.w >= 0.0) { return AU.night.w; }
  return smoothstep(0.06, -0.08, world.sunTrue.y);
}

// a lamp's light (authored on screen) in the scene: held at the night's exposure, so a moonlit night's lanterns read as a
// dark night's do, and dusk's (a brighter scene, the eye less open) are fainter
fn held() -> f32 {
  let e = max(world.exposure, 1e-6);
  return min(e, AU.night.y) / (AU.night.y * e);
}

// arch.ts ARCH_LAMP: a world.lamps entry that is one of the parts' own lights, its light in the bake already
const ARCH_LAMP = 9.5;

// the dynamic lamps on a surface (world.wgsl outdoorLamps) but the parts' own: a held or thrown flame, a grotto's glow.
// The parts' lights nearest her are in world.lamps for the cast's sake (arch.ts lampsNear); summed here too, every pool
// within 14 m of her came out twice as bright, lit through the walls and stall cloths the bake stops it at, and halved
// at once as she walked on and a lamp fell out of the nearest eight
fn liveLamps(p: vec3f, n: vec3f) -> vec3f {
  var e = vec3f(0.0);
  for (var i = 0u; i < 8u; i++) {
    let a = world.lamps[i * 2u];
    let b = world.lamps[i * 2u + 1u];
    if (a.w <= 0.0 || b.w > ARCH_LAMP) { continue; }
    let d = a.xyz - p;
    let d2 = max(dot(d, d), 0.04);
    let l = d * inverseSqrt(d2);
    var face = 1.0;
    var cosT = saturate(dot(n, l));
    if (b.w < 8.0) {
      let ax = vec3f(cos(b.w), 0.0, sin(b.w));
      face = smoothstep(-0.35, 0.15, dot(-l, ax));
      cosT = max(cosT, 0.45 * saturate(dot(n, ax)) * exp(-d2 * 0.6));
    }
    let win = saturate(1.0 - d2 / 196.0);
    e += b.rgb * a.w * face * cosT * win * win / d2;
  }
  return e;
}

// ---- the walk-in room: its frame, its inside, the key through its openings
fn roomLocal(p: vec3f) -> vec3f {
  let d = p - AU.room[0].xyz;
  let c = AU.room[0].w;
  let s = AU.room[1].w;
  return vec3f(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
}
fn roomDir(v: vec3f) -> vec3f {
  let c = AU.room[0].w;
  let s = AU.room[1].w;
  return vec3f(c * v.x - s * v.z, v.y, s * v.x + c * v.z);
}
fn roomWorld(q: vec3f) -> vec3f {
  let c = AU.room[0].w;
  let s = AU.room[1].w;
  return AU.room[0].xyz + vec3f(c * q.x + s * q.z, q.y, -s * q.x + c * q.z);
}
/** a point (local) inside the room: within its walls, floor and ceiling (a hair past each, for their own faces) */
fn inRoom(q: vec3f) -> bool {
  return AU.room[1].x > 0.0 && all(abs(q) <= AU.room[1].xyz + vec3f(0.02));
}
/** how much of a rectangle (half sizes h) covers a point d from its middle, eased over e at its edges */
fn rectCover(d: vec2f, h: vec2f, e: f32) -> f32 {
  let k = h - abs(d);
  return saturate(min(k.x, k.y) / max(e, 1e-4) + 0.5);
}
/** the key light from local direction l reaching a point q inside: through the window (its reveal cuts a grazing
 *  beam; its lattice throws a diamond net) and through the door; the outside of each opening's own sun or shade with
 *  it (the temple's shadow, the evening's). Soft as a drawing's edge, softer the farther the floor is from the sill */
fn roomKey(q: vec3f, l: vec3f) -> f32 {
  let h = AU.room[1].xyz;
  let T = AU.room[4].x;
  var k = 0.0;
  if (l.x < -0.02) {
    let w = AU.room[2];
    let tIn = (-h.x - q.x) / l.x;
    let a = q + l * tIn;
    let b = q + l * (tIn + T / -l.x);
    let pen = 0.008 + 0.012 * tIn;
    let open = rectCover(vec2f(a.z - w.x, a.y - w.y), w.zw, pen) * rectCover(vec2f(b.z - w.x, b.y - w.y), w.zw, pen);
    if (open > 0.0) {
      let m = (a + b) * 0.5;
      let P = AU.room[4].y;
      let u = m.z - w.x;
      let v = m.y - w.y;
      let da = abs(fract((u + v) / P + 0.5) - 0.5) * P * 0.70711;
      let db = abs(fract((u - v) / P + 0.5) - 0.5) * P * 0.70711;
      let bars = 1.0 - smoothstep(AU.room[4].z - pen, AU.room[4].z + pen, min(da, db));
      let wn = roomWorld(b) + roomWorldDir(vec3f(-0.25, 0.0, 0.0));
      k = open * (1.0 - bars) * sunShadowFast(wn, roomWorldDir(vec3f(-1.0, 0.0, 0.0)));
    }
  }
  if (l.z > 0.02) {
    let d = AU.room[3];
    let tIn = (h.z - q.z) / l.z;
    let a = q + l * tIn;
    let b = q + l * (tIn + T / l.z);
    let pen = 0.008 + 0.012 * tIn;
    let open = rectCover(vec2f(a.x - d.x, a.y - d.y), d.zw, pen) * rectCover(vec2f(b.x - d.x, b.y - d.y), d.zw, pen);
    if (open > 0.0) {
      let wn = roomWorld(b) + roomWorldDir(vec3f(0.0, 0.0, 0.25));
      k = max(k, open * sunShadowFast(wn, roomWorldDir(vec3f(0.0, 0.0, 1.0))));
    }
  }
  return k;
}
fn roomWorldDir(v: vec3f) -> vec3f {
  let c = AU.room[0].w;
  let s = AU.room[1].w;
  return vec3f(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}
/** the light inside the room besides the key (irradiance over pi, as skyAmbient): the sky's through the door and the
 *  window — most near them, a little everywhere — the sun's off the floor where it falls through the window (most round
 *  that patch), and the lantern's off the walls (most near it), all of it warmed by the red walls it comes round */
fn roomAmbient(q: vec3f, n: vec3f, l: vec3f, sunE: vec3f) -> vec3f {
  let h = AU.room[1].xyz;
  let sky = dot(skyAmbient(vec3f(0.0, 1.0, 0.0)), LUMA);
  let w = AU.room[2];
  let d = AU.room[3];
  // (how near the openings, and facing them: the sky's light comes in through them and falls away into the room)
  let toWin = vec3f(-h.x, w.y, w.x) - q;
  let toDoor = vec3f(d.x, d.y, h.z) - q;
  let fw = exp(-dot(toWin, toWin) / 3.0) * (0.55 + 0.45 * saturate(dot(n, normalize(toWin))));
  let fd = exp(-dot(toDoor, toDoor) / 5.0) * (0.55 + 0.45 * saturate(dot(n, normalize(toDoor))));
  let skyIn = sky * AU.room[4].w * (0.3 + 1.6 * fw + 1.8 * fd);
  // the sun let in through the window: where its patch falls (the window's middle carried down along it to the floor,
  // kept in the room), bounced back off it — strongest round it and on what faces it, a little everywhere
  var sunIn = 0.0;
  if (l.x < -0.02 && l.y > 0.0) {
    let wc = vec3f(-h.x, w.y, w.x);
    let spot = clamp(wc - l * ((wc.y + h.y) / l.y), -h + vec3f(0.3), h - vec3f(0.3));
    let toP = spot - q;
    let near = 1.0 / (1.0 + dot(toP, toP) * 0.3);
    let facing = 0.45 + 0.55 * saturate(dot(n, normalize(toP + vec3f(0.0, 0.3, 0.0))));
    sunIn = dot(sunE, LUMA) * 0.05 * saturate(-l.x) * (0.25 + near * facing);
  }
  // (the door's sun, when it's in the south: a little, round the threshold)
  sunIn += dot(sunE, LUMA) * 0.025 * saturate(l.z) * step(0.0, l.y) * (0.3 + fd);
  // the lantern's light off the walls round it (its own direct light is the bake's), flickering with its flame
  let lp = AU.room[5];
  let toL = lp.xyz - q;
  let t = world.site.z;
  let flick = 0.72 + 0.28 * noise2(vec2f(t * 6.5, 0.0)) + 0.08 * sin(t * 23.0);
  let fill = lp.w * flick * AU.night.x * held() * (0.5 + 0.5 * saturate(dot(n, normalize(toL)))) / (1.0 + dot(toL, toL) * 0.55) / PI;
  // (more of it from below, off the floor, than from the ceiling; less of it where two of the room's faces meet — along
  // the floor at the walls' feet, up the corners, under the ceiling — as a painter darkens a room's edges)
  let up = 0.8 + 0.2 * -n.y;
  let near3 = exp(-max(h - abs(q), vec3f(0.0)) * 2.2);
  let occ = 1.0 - 0.42 * saturate(near3.x * near3.y + near3.y * near3.z + near3.x * near3.z);
  return ((skyIn + sunIn * up) * vec3f(1.0, 0.84, 0.72) + fill * vec3f(1.0, 0.9, 0.7)) * occ;
}

// The scene's eye, for positions taken relative to it (arch.ts eye()): a float's 24 bits hold a world position only to
// half a millimetre 4 km out, and the view-projection's translation as coarsely, so a wall a metre off would shimmer by
// a pixel as the eye moved there. The eye is snapped to the pieces' lattice (chunks.ts STEP, 1/512 m) as every piece's
// origin is, so the origin less it, plus the lattice offset, is exact in floats however it's summed (every term a
// whole number of steps under 32 km); the last fraction of a step is in the view-projection's translation.
struct ArchEye {
  at: vec4f,          // xyz the eye on the lattice (world m)
  viewProj: mat4x4f,  // the scene's view-projection from there
}
@group(2) @binding(7) var<uniform> AE: ArchEye;

fn eyePos(piece: u32, q: vec3u) -> vec3f {
  let c = chunks[piece].o;
  return (c.xyz - AE.at.xyz) + vec3f(q) * c.w;
}

// the GPU cull's verdict on a piece (cull.wgsl: the top byte of its draw's first instance, in the debug view's draws)
// as a tint: drawn as it is, hidden by the occluders red, out of the view blue
fn cullTint(verdict: u32) -> vec3f {
  if (verdict == 2u) { return vec3f(2.4, 0.28, 0.22); }
  if (verdict == 3u) { return vec3f(0.3, 0.55, 2.0); }
  return vec3f(1.0);
}

@vertex fn vs(v: VIn) -> VOut {
  // (the piece: its draw's first instance, whose top byte is the GPU cull's verdict in the debug view's draws)
  let piece = v.piece & 0xffffffu;
  let p = latticePos(piece, v.q.xyz);
  var o: VOut;
  o.pos = AE.viewProj * vec4f(eyePos(piece, v.q.xyz), 1.0);
  o.p = p;
  o.n = octNormal(v.oct);
  o.uv = v.uv;
  o.tint = vec4f(v.tint.rgb * (255.0 / 128.0), v.tint.a);
  if (i32(AU.look.z) == 5) { o.tint = vec4f(o.tint.rgb * cullTint(v.piece >> 24u), o.tint.a); }
  // the baked lamps: the night's when they're on (underground always: the caverns' crystals); the fires as lit,
  // flickering together
  let under = underground(p);
  let on = mix(lightsOn(), 1.0, under);
  var lamp = v.night.rgb * (v.night.a * v.night.a * RGBM_RANGE) * on;
  var gate = on;
  let fi = v.fire & 0xffffu;
  if (fi != 0xffffu) {
    let f = fires[fi];
    let t = world.site.z;
    let flick = 0.72 + 0.28 * noise2(vec2f(t * 6.5, f32(fi) * 7.31)) + 0.08 * sin(t * 23.0 + f32(fi));
    lamp += f.rgb * f.w * unpack2x16float(v.fire & 0x7fffffffu).y * flick;
    if ((v.fire >> 31u) == 1u) { gate = f.w * flick; }
  }
  // (underground they're held as the night holds them, whatever the hour: no daylight there for the eye to be set by)
  o.lamp = vec4f(lamp * AU.night.x * mix(held(), 1.0 / max(world.exposure, 1e-6), under), gate);
  o.id = vec4u(v.q.w & 0xffu, v.q.w >> 8u, piece, 0u);
  return o;
}

// depth alone: the sun's cascades, and the GPU cull's occluders (the scene's camera)
@vertex fn vsShadow(@builtin(instance_index) piece: u32, @location(0) q: vec4u) -> @builtin(position) vec4f {
  return frame.viewProj * vec4f(latticePos(piece & 0xffffffu, q.xyz), 1.0);
}
// (and nothing to colour, for the GPU cull's render bundles: WebKit rejects a pipeline with no fragment stage in one)
@fragment fn fsDepth() {}

// ==== the parts' instances (arch/instances.ts) ==================================================================
// The small parts that repeat by the thousand (lanterns, merlons, balusters, brackets, grilles, finials), each
// prototype's vertices uploaded once in its own frame and drawn instanced: an instance is a place, a yaw (ArchBuilder's:
// local x toward world (cos, -sin)), a scale, a tint, and the night's light where it stands — the lamps round its
// anchor summed on the CPU from the bake's light grid (bake.ts), as a colour and the way most of it comes from (its
// length how much it comes from that way rather than all round). The visible ones' indices are listed per view
// (instances.ts culls them by cell and picks each one's detail), the draw's first instance its run's start in that
// list. Shaded by fs as the parts' own vertices are; nothing here touches the stages above.
struct PartInst {
  p: vec4f,   // xyz its place (world), w its yaw
  k: vec4u,   // x its scale (f32 bits), y its tint (rgb ×128, unorm8), z the night's light (RGBM), w the way it comes
              // from (snorm8 xyz: its length how much of it does)
}
@group(2) @binding(16) var<storage, read> partInsts: array<PartInst>;
@group(2) @binding(17) var<storage, read> partVis: array<u32>;

struct PartIn {
  @builtin(instance_index) slot: u32,
  @location(0) p: vec3f,       // the prototype's own frame (m)
  @location(1) oct: vec2f,     // the normal, octahedral
  @location(2) uv: vec2f,
  @location(3) tint: vec4f,    // rgb the tint / 2, a the ambient
  @location(4) id: u32,        // the material | the glow << 8
}

fn partTurn(I: PartInst, q: vec3f) -> vec3f {
  let c = cos(I.p.w);
  let s = sin(I.p.w);
  return vec3f(c * q.x + s * q.z, q.y, -s * q.x + c * q.z);
}

@vertex fn vsInst(v: PartIn) -> VOut {
  let k = partVis[v.slot];
  let I = partInsts[k];
  let p = I.p.xyz + partTurn(I, v.p * bitcast<f32>(I.k.x));
  var o: VOut;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.p = p;
  o.n = normalize(partTurn(I, octNormal(v.oct)));
  o.uv = v.uv;
  o.tint = vec4f(v.tint.rgb * (255.0 / 128.0) * unpack4x8unorm(I.k.y).rgb * (255.0 / 128.0), v.tint.a);
  // the night's light at its anchor, turned to the surface: from its way, and a little all round
  let L = unpack4x8unorm(I.k.z);
  let dir = unpack4x8snorm(I.k.w).xyz;
  let face = saturate(dot(o.n, dir) + (1.0 - length(dir)) * 0.5);
  let under = underground(p);
  let on = mix(lightsOn(), 1.0, under);
  let lamp = L.rgb * (L.a * L.a * RGBM_RANGE) * face * on;
  o.lamp = vec4f(lamp * AU.night.x * mix(held(), 1.0 / max(world.exposure, 1e-6), under), on);
  o.id = vec4u(v.id & 0xffu, (v.id >> 8u) & 0xffu, k, 0u);
  return o;
}

@vertex fn vsInstShadow(@builtin(instance_index) slot: u32, @location(0) q: vec3f) -> @builtin(position) vec4f {
  let I = partInsts[partVis[slot]];
  return frame.viewProj * vec4f(I.p.xyz + partTurn(I, q * bitcast<f32>(I.k.x)), 1.0);
}
// ==== end of the parts' instances ===============================================================================

// the slow wander a painter's colour has: a broad drift of value and warmth over tens of metres, a smaller one over a
// few (each material its own)
fn wander(p: vec3f, k: f32, seed: f32) -> vec3f {
  if (k <= 0.0) { return vec3f(1.0); }
  let q = p.xz + vec2f(p.y * 0.61, -p.y * 0.37);
  let a = fbm2(q * 0.035 + vec2f(seed * 17.3, seed * 5.1), 3) - 0.44;
  let b = noise2(q * 0.27 + vec2f(seed * 3.3, 11.0)) - 0.5;
  let val = 1.0 + (a * 0.3 + b * 0.12) * k;
  return val * vec3f(1.0 + a * 0.12 * k, 1.0, 1.0 - a * 0.16 * k);
}

// awnings' and banners' cloth: stripes across u, the tint's colour and a cream (a teal on cream cloth), the weave in it
fn clothOf(uv: vec2f, tint: vec3f, fw: f32, base: vec3f) -> vec3f {
  let hi = max(tint.r, max(tint.g, tint.b));
  let sat = (hi - min(tint.r, min(tint.g, tint.b))) / max(hi, 1e-3);
  let alt = mix(vec3f(0.035, 0.26, 0.24), vec3f(0.8, 0.71, 0.52), smoothstep(0.18, 0.42, sat));
  let x = uv.x / 0.6;
  let e = max(fw / 0.6, 1e-4);
  let s = smoothstep(0.25 - e, 0.25 + e, abs(fract(x) - 0.5));
  let weave = 0.92 + 0.08 * noise2(uv * vec2f(43.0, 7.0));
  return mix(base * tint, alt, s) * weave;
}

// a window pane (uv 0..1 over it): x its glazing bars (a cross: one upright, one transom above the middle), y the
// light of the room behind it, brightest low in the middle
fn paneOf(uv: vec2f, fw: vec2f) -> vec2f {
  let ex = max(fw, vec2f(1e-4));
  let up = 1.0 - smoothstep(0.035 - ex.x, 0.035 + ex.x, abs(uv.x - 0.5));
  let across = 1.0 - smoothstep(0.03 - ex.y, 0.03 + ex.y, abs(uv.y - 0.64));
  let rim = 1.0 - smoothstep(0.0, 0.05 + ex.x, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  let fall = (0.7 + 0.45 * (1.0 - uv.y)) * (1.0 - 0.35 * smoothstep(0.2, 0.5, abs(uv.x - 0.5)));
  return vec2f(max(max(up, across), rim * 0.8), fall);
}

// ---- the tiles and the lattice doors. Each drawn in its face's fitted uv (chunks.ts: whole tiles, motifs or lattice
// columns per face) from a palette the vertex's glow byte picks. Every edge is softened over the pixel's footprint
// (`aa`, in the pattern's units), a line thinner than a pixel fades instead of flickering, and past a few pixels a tile
// the whole pattern gives way to its mean colour (the share of each colour in it, measured: the weights below), so a
// far wall of tiles neither shimmers nor changes its tone as it recedes.

const PALS = 6u;
fn palC(p: u32, k: u32) -> vec3f { return AU.pal[min(p, PALS - 1u) * 5u + k].rgb; }
// (a pattern's colours in its palette's terms, mixed by their shares in the pattern: its mean)
fn palMix(p: u32, w: vec4f, wInk: f32) -> vec3f {
  return palC(p, 0u) * w.x + palC(p, 1u) * w.y + palC(p, 2u) * w.z + palC(p, 4u) * w.w + palC(p, 3u) * wInk;
}

// a line's coverage at distance d from its middle (half width w); thinner than the footprint it fades, keeping its share
fn lineAA(d: f32, w: f32, aa: f32) -> f32 { return saturate((w - d) / aa + 0.5) * saturate(2.0 * w / aa); }
// a region's coverage from its signed distance (negative inside)
fn fillAA(sd: f32, aa: f32) -> f32 { return saturate(0.5 - sd / aa); }

// an eight-point star of radius r at the origin (two squares, one on its point, one on its side): its signed distance
fn star8(q: vec2f, r: f32) -> f32 {
  let a = abs(q);
  return min((a.x + a.y - r) * 0.70710678, max(a.x, a.y) - r * 0.70710678);
}

// a tile pattern's colour, how much of it is grout or ink (rougher), and the piece it's on (each glazed a little askew)
struct Tiled { c: vec3f, grout: f32, piece: vec2f }

// the star-and-cross field: an eight-point star on every whole-tile point (the two field colours by turns), the crosses
// between them in the ground colour with a small diamond at each heart, a gold rosette in each star, ink where the
// pieces meet
fn starField(t: vec2f, aa: f32, p: u32) -> Tiled {
  let ci = round(t);
  let q = t - ci;
  let sd = star8(q, 0.5);
  let alt = ((i32(ci.x) + i32(ci.y)) & 1) == 1;
  let starC = select(palC(p, 1u), palC(p, 2u), alt);
  let x = fract(t) - 0.5;
  let inStar = fillAA(sd, aa);
  var c = mix(palC(p, 0u), starC, inStar);
  c = mix(c, select(palC(p, 2u), palC(p, 1u), alt), fillAA((abs(x.x) + abs(x.y) - 0.1) * 0.70710678, aa) * (1.0 - inStar));
  let ros = star8(q, 0.17);
  c = mix(c, palC(p, 4u), fillAA(ros, aa));
  let ink = max(lineAA(abs(sd), 0.02, aa), lineAA(abs(ros), 0.011, aa));
  c = mix(c, palC(p, 3u), ink);
  return Tiled(c, ink, select(floor(t) + 0.5, ci, sd < 0.0));
}

// the band of interlaced stars: along x a star on each whole motif, its two squares a gold strap passing over and under
// itself by turns at their eight crossings, inked at its edges; the star's field and a cream heart inside, the band's
// ground (the second field colour) round it, a cream diamond where two motifs meet, cream edges inked
fn starBand(t: vec2f, aa: f32, p: u32) -> Tiled {
  let ci = floor(t) + 0.5;
  let q = t - ci;
  let a = abs(q);
  let R = 0.37;
  let dA = (a.x + a.y - R) * 0.70710678;
  let dB = max(a.x, a.y) - R * 0.70710678;
  var c = mix(palC(p, 2u), palC(p, 1u), fillAA(min(dA, dB), aa));
  c = mix(c, palC(p, 0u), fillAA(star8(q, 0.12), aa));
  // where two motifs meet: a cream diamond, inked
  let dd = (0.5 - a.x + a.y - 0.13) * 0.70710678;
  c = mix(c, palC(p, 0u), fillAA(dd, aa));
  var ink = lineAA(abs(dd), 0.01, aa);
  // the band's edges
  let ed = a.y - 0.445;
  c = mix(c, palC(p, 0u), fillAA(-ed, aa));
  ink = max(ink, lineAA(abs(ed), 0.011, aa));
  c = mix(c, palC(p, 3u), ink);
  // the strap: the square under first, then the one over it here
  let rw = 0.04;
  let aTop = (q.x * q.y > 0.0) == (a.x > a.y);
  let dU = select(dA, dB, aTop);
  let dO = select(dB, dA, aTop);
  let gold = palC(p, 4u);
  let inkC = palC(p, 3u);
  c = mix(c, gold, lineAA(abs(dU), rw, aa));
  let eU = lineAA(abs(abs(dU) - rw), 0.01, aa);
  c = mix(c, inkC, eU);
  let oO = lineAA(abs(dO), rw, aa);
  c = mix(c, gold, oO);
  let eO = lineAA(abs(abs(dO) - rw), 0.01, aa);
  c = mix(c, inkC, eO);
  return Tiled(c, max(ink, max(eU * (1.0 - oO), eO)), ci);
}

// the border of diamonds and chevrons: a row of diamonds along x touching point to point (the first field colour, a
// gold diamond inside with a cream heart), the triangles between them and the edges in the ground colour with nested
// chevrons in the second, the edges a strap of the second, inked
fn chevronBorder(t: vec2f, aa: f32, p: u32) -> Tiled {
  let ci = floor(t) + 0.5;
  let q = t - ci;
  let a = abs(q);
  let E = 0.4;
  // (distance to the diamond |x|/0.5 + |y|/E = 1 and its nested copies, in the band's units)
  let k = 1.0 / sqrt(4.0 + 1.0 / (E * E));
  let dm = (a.x * 2.0 + a.y / E - 1.0) * k;
  let din = (a.x * 2.0 + a.y / E - 0.5) * k;
  let dh = (a.x * 2.0 + a.y / E - 0.16) * k;
  var c = palC(p, 0u);
  // the chevrons in the triangles: the diamond's outline again, twice, farther out
  let chev = max(lineAA(abs(dm - 0.06), 0.017, aa), lineAA(abs(dm - 0.115), 0.017, aa)) * fillAA(a.y - 0.43, aa);
  c = mix(c, palC(p, 2u), chev);
  c = mix(c, palC(p, 1u), fillAA(dm, aa));
  c = mix(c, palC(p, 4u), fillAA(din, aa));
  c = mix(c, palC(p, 0u), fillAA(dh, aa));
  // the edge straps
  let ed = a.y - 0.445;
  c = mix(c, palC(p, 2u), fillAA(-ed, aa));
  let ink = max(max(lineAA(abs(dm), 0.016, aa), lineAA(abs(din), 0.01, aa)), lineAA(abs(ed), 0.011, aa));
  c = mix(c, palC(p, 3u), ink);
  return Tiled(c, ink, ci + select(vec2f(0.0), vec2f(0.0, 0.37), dm > 0.0));
}

// the shares of each colour in each pattern (ground, field 1, field 2, gold; ink), measured over a whole repeat (a port
// of the patterns with hard edges, sampled finely)
const W_FIELD = vec4f(0.33, 0.23, 0.23, 0.056);
const W_FIELD_INK = 0.155;
const W_BAND = vec4f(0.146, 0.115, 0.379, 0.183);
const W_BAND_INK = 0.177;
const W_BORDER = vec4f(0.299, 0.247, 0.227, 0.077);
const W_BORDER_INK = 0.15;

// a lattice door's column (m, about: chunks.ts fits it to each door), its gold's height over the wood (m)
const LATTICE_PITCH = 0.3;
const LATTICE_DEPTH = 0.028;
const W_LATTICE = 0.49;

// a lattice door's gold at q (in columns: a bar on every whole x, the leaves meeting at x 0, the boss at y 0; the
// diamonds twice as tall as a column is wide): x how much of it covers the wood there (its strokes widened by `grow`),
// y its height (a bar's crown 1, the boss proud of it), z the dark gap where the leaves meet. Bars up its full height;
// straps on the diagonals making a diamond between each pair of bars and a half each side of them; inside every diamond
// a smaller one (a chevron either side of a bar where the bar splits it) and a stud in each whole one; the boss a
// diamond over the meeting with a groove round its middle
fn latticeAt(q: vec2f, aa: f32, grow: f32) -> vec3f {
  let S = 2.0;
  let kN = 0.89442719;
  let bd = abs(q.x - round(q.x));
  let bw = 0.085 + grow;
  var cov = lineAA(bd, bw, aa);
  var h = cov * sqrt(saturate(1.0 - bd * bd / (bw * bw)));
  let a1 = q.x + q.y / S;
  let a2 = q.x - q.y / S;
  let dg = min(abs(a1 - round(a1)), abs(a2 - round(a2))) * kN;
  let gw = 0.05 + grow;
  let cg = lineAA(dg, gw, aa);
  cov = max(cov, cg);
  h = max(h, cg * 0.8 * sqrt(saturate(1.0 - dg * dg / (gw * gw))));
  let cc = vec2f((floor(a1) + floor(a2) + 1.0) * 0.5, S * (floor(a1) - floor(a2)) * 0.5);
  let r = abs(q - cc);
  let dr = r.x + r.y / S;
  let iw = 0.032 + grow;
  let di = abs(dr - 0.27) * kN;
  let ci = lineAA(di, iw, aa);
  cov = max(cov, ci);
  h = max(h, ci * 0.6 * sqrt(saturate(1.0 - di * di / (iw * iw))));
  let whole = abs(fract(cc.x) - 0.5) < 0.25;
  let cs = select(0.0, fillAA((dr - 0.075 - grow) * kN, aa), whole);
  cov = max(cov, cs);
  h = max(h, cs * (0.9 - 4.0 * dr));
  // the boss
  let bq = abs(q);
  let bk = bq.x / 0.6 + bq.y / 0.95;
  let cb = fillAA((bk - 1.0) * 0.5 - grow, aa);
  let groove = 1.0 - smoothstep(0.0, 0.07, abs(bk - 0.62));
  h = max(h, cb * (1.25 + 0.35 * (1.0 - bk) - 0.4 * groove));
  cov = max(cov, cb);
  let gap = fillAA(bq.x - 0.016, aa) * (1.0 - cb);
  return vec3f(cov * (1.0 - gap), h * (1.0 - gap), gap);
}

// what a smooth surface sees in a direction: the sky over the horizon, the warm canyon floor in the light under it
fn envOf(r: vec3f, sunE: vec3f) -> vec3f {
  let sky = skyRadiance(normalize(vec3f(r.x, max(r.y, 0.02), r.z)));
  let ground = vec3f(0.42, 0.21, 0.12) * (sunE * max(world.sunDir.y, 0.0) / PI + skyAmbient(vec3f(0.0, 1.0, 0.0)));
  return mix(ground, sky, smoothstep(-0.15, 0.05, r.y));
}

fn pieceColour(k: u32) -> vec3f {
  let h = hashU(k * 2654435761u + 17u);
  return vec3f(f32(h & 255u), f32((h >> 8u) & 255u), f32((h >> 16u) & 255u)) / 255.0 * 0.8 + 0.1;
}

// the caverns' glows (caverns/crystals.ts, caverns/build.ts), as on-screen colours over the exposure (the same by day as
// by night): a crystal lit from within — each facet a band of emerald, mint or near-white by how it faces the light
// inside the cluster and the eye, brighter toward its tip (the ambient byte: 0 its root .. 1 its apex), its hue from the
// tint — and the green water: the waterfall's sheet in streaks falling, its pool in rings spreading from the fall
const CAVE_DEEP = vec3f(0.02, 0.2, 0.12);
const CAVE_EMERALD = vec3f(0.02, 0.5, 0.2);
const CAVE_MINT = vec3f(0.28, 1.0, 0.6);
const CAVE_WHITE = vec3f(0.86, 1.0, 0.9);
fn cavernGlow(i: VOut, p: vec3f, n: vec3f, v: vec3f, fw: vec2f) -> vec3f {
  let ex = 1.0 / max(world.exposure, 1e-6);
  let k = f32(i.id.y) / 255.0;
  let t = world.site.z;
  if (i.id.x == 25u) {
    let along = i.tint.a;
    let hue = saturate((i.tint.r - 0.86) / 0.14);
    // (the light inside: from over the eye's shoulder, so the facets toward her read bright and the far ones deep)
    let L = normalize(vec3f(0.35, 0.85, 0.25) + v * 0.5);
    let f = dot(n, L);
    let rim = 1.0 - saturate(dot(n, v));
    // (the body's colour: emerald low on the shard, mint toward its tip, by its hue; three bands by facet, a near-white
    // top band only up toward the tips)
    let body = mix(CAVE_EMERALD, CAVE_MINT, smoothstep(0.1, 0.95, along) * (0.5 + 0.5 * hue));
    var col = mix(CAVE_DEEP * 1.3, CAVE_EMERALD * 0.75, step(-0.25, f));
    col = mix(col, body * 1.15, step(0.3, f));
    col = mix(col, CAVE_WHITE * 1.5, step(0.84, f) * smoothstep(0.4, 0.85, along));
    // deeper at the root, a slow breath through the cluster, a mint rim where a facet turns away
    let breath = 0.9 + 0.1 * sin(t * 0.8 + p.x * 0.3 + p.z * 0.2);
    col = col * (0.55 + 0.45 * along) * breath + CAVE_MINT * smoothstep(0.6, 0.95, rim) * 0.25 * (0.4 + 0.6 * along);
    // the shaft's edges caught in light: a fine near-white line down each (its uv.x runs 0..1 across a face), stronger
    // up the shard
    let ex2 = min(i.uv.x, 1.0 - i.uv.x) / max(fw.x, 1e-4);
    col = mix(col, CAVE_WHITE * 1.3, (1.0 - smoothstep(0.6, 1.6, ex2)) * (0.25 + 0.6 * along) * step(i.uv.x, 1.001));
    return col * (0.35 + 0.9 * k) * ex;
  }
  // the water: down a sheet (its uv: metres across and up it), or over the pool (metres from where the fall lands)
  if (abs(n.y) < 0.6) {
    let fall = i.uv.y + t * 3.2;
    let a = noise2(vec2f(i.uv.x * 2.6, fall * 0.35));
    let b = noise2(vec2f(i.uv.x * 6.5 + 3.7, fall * 0.9));
    let streak = smoothstep(0.42, 0.78, a * 0.6 + b * 0.4);
    var col = mix(CAVE_EMERALD * 0.8, CAVE_MINT, streak);
    col = mix(col, CAVE_WHITE, smoothstep(0.72, 0.92, b) * 0.7);
    // (foam where it lands: the sheet's foot whitens)
    col = mix(col, CAVE_WHITE, smoothstep(1.4, 0.0, i.uv.y) * 0.65);
    return col * (0.6 + 0.9 * k) * ex;
  }
  // (the pool's uv is metres from where the fall lands, plus 12: caverns/build.ts keeps it whole that way)
  let q = i.uv - vec2f(12.0);
  let r = length(q);
  let ring = 0.5 + 0.5 * sin(r * 3.2 - t * 2.6 + noise2(q * 0.7) * 2.0);
  let rings = smoothstep(0.82, 0.98, ring) * exp(-r * 0.16);
  let ripple = noise2(q * 1.6 + vec2f(t * 0.3, -t * 0.2));
  // (dark green away from the fall, brighter toward it; the rings mint)
  var col = mix(CAVE_DEEP * 1.4, CAVE_EMERALD, saturate(0.12 + 0.3 * ripple + 0.7 * exp(-r * 0.28)));
  col = mix(col, CAVE_MINT, rings * 0.75);
  col = mix(col, CAVE_WHITE, smoothstep(2.2, 0.4, r) * 0.6);
  return col * (0.5 + 0.8 * k) * ex;
}

// ---- the painted detail: the cut of the stone and what the years leave on it, painted into the light as the show's
// backgrounds are (soft washes and clean lines, never a photograph's grit), at no cost in geometry and so with nothing
// to z-fight. Per material (materials.ts relief, blocks, wear, plaster: MatU.paint) under the settings' strengths
// (ArchU.paint, ArchU.wear):
//   relief   the painted texture's own light and dark taken for its height — the ashlar's and the paving's joints
//            sunk, the plaster's trowelled hollows, the wood's grain, the strata's ledges — its slope read a mip
//            softer than it's drawn, so a joint is a soft bevel (its lip lit in the sun, a shadow under it), never a
//            crack
//   blocks   cut stone (the BLOCKS map: copings, cornices, frames, a column's drums): a fine joint between whole
//            blocks, each a shade lighter or darker, warmer or cooler than the next, its arrises softly rounded and
//            worn pale
//   wear     grime and warmth gathered low on the walls (deepest at the foot, its top a soft uneven edge) and in the
//            builders' creases (the ambient byte), a few streaks washed down the walls from under their ledges, dust
//            settled on whatever faces up, the sun's fading high on the walls (most on those facing south, into it)
//   plaster  the plaster's own: a darker dado along the foot of the wall, the trowel's long soft strokes, patches
//            where it was made good, a few hairline cracks
// What's finer than a pixel fades over the pixel's footprint to its share (a joint to a faint line, then nothing; the
// cracks and the trowel's strokes gone; the grime's edges softened), so nothing shimmers far off, with MSAA or
// without. The phone (ArchU.paint.w 0) keeps the washes, the patches and the joints and skips the relief (a read of
// the texture more), the joints' bevels, the streaks, the trowel's strokes and the cracks.

// the grime (a multiplier: darker and warmer — maroon on the red plaster, never grey), a streak's, the dust (the
// desert's sand, linear), the dado's
const GRIME = vec3f(0.7, 0.6, 0.56);
const STREAK = vec3f(0.72, 0.63, 0.6);
const DUST = vec3f(0.7, 0.42, 0.18);
const DADO = vec3f(0.84, 0.8, 0.84);
// the relief's depth at 1 (m of height for the texture's light from its mean to nothing): a cut joint a centimetre or
// two deep
const RELIEF_DEPTH = 0.018;
// the caverns' floors over the land's carve under them (caverns/plan.ts CARVE_DEPTH: the lowest floor less 0.8, the
// grotto 1.5 under the halls): the ground their grime is painted from
const CAVE_CARVE = 2.3;

// the world's gradient of each of a surface's uv (per unit of uv) from the screen's derivatives: the cotangent frame,
// exact on a flat triangle whichever way its uv run; nothing where it's seen edge on
struct UvFrame { gu: vec3f, gv: vec3f }
fn uvFrame(n: vec3f, dpx: vec3f, dpy: vec3f, duvx: vec2f, duvy: vec2f) -> UvFrame {
  let r1 = cross(dpy, n);
  let r2 = cross(n, dpx);
  let det = dot(dpx, r1);
  if (abs(det) < 1e-14) { return UvFrame(vec3f(0.0), vec3f(0.0)); }
  return UvFrame((r1 * duvx.x + r2 * duvy.x) / det, (r1 * duvx.y + r2 * duvy.y) / det);
}

// the ground under a point (m): the finest of the terrain's levels holding it, read once (they agree within a few
// centimetres where they hand over); in the caverns their floor, CAVE_CARVE over the carve dug under them
fn groundUnder(p: vec3f, under: f32) -> f32 {
  var i = 0;
  for (; i < TERRAIN_LEVELS - 1; i++) {
    if (levelE(i, p.xz) < 0.85) { break; }
  }
  return heightAtLevel(i, p.xz) + CAVE_CARVE * under;
}

fn sdSeg(q: vec2f, a: vec2f, b: vec2f) -> f32 {
  let qa = q - a;
  let ba = b - a;
  return length(qa - ba * saturate(dot(qa, ba) / max(dot(ba, ba), 1e-8)));
}

// the painted texture's light and dark as a height: its gradient in the world (per m), from how that light changes
// across the pixel (fx, fy: its screen derivatives) and the surface's own (the cotangent frame's rows, as uvFrame's).
// The light is read two mips softer than it's drawn, so a joint is a soft bevel and the stone's own grain stays paint,
// not grit (three taps a texel apart came out the same and cost three reads; at the drawn mip, gritty)
fn reliefGrad(n: vec3f, dpx: vec3f, dpy: vec3f, fx: f32, fy: f32) -> vec3f {
  let r1 = cross(dpy, n);
  let r2 = cross(n, dpx);
  let det = dot(dpx, r1);
  if (abs(det) < 1e-14) { return vec3f(0.0); }
  return (r1 * fx + r2 * fy) / det;
}

// a colour's multiplier and the height's gradient (world) it leaves
struct Painted { c: vec3f, g: vec3f }

// cut blocks (the BLOCKS map: uv x in blocks along the face, y 0..1 across it): a fine dark joint between them, each
// block its own tone (gone as the blocks shrink to a few pixels), the joints' arrises rounded and the long edges worn
// pale (a soft fall of the height a couple of centimetres in from each)
fn blocksOf(uv: vec2f, F: UvFrame, fpm: f32, full: bool, k: f32) -> Painted {
  let lu = max(length(F.gu), 1e-4);
  let lv = max(length(F.gv), 1e-4);
  let len = 1.0 / lu;
  let jd = uv.x - round(uv.x);
  let dm = abs(jd) * len;
  // (y outside 0..1: uv not fitted the BLOCKS way, as chunks.ts fits them; no long edges then, only the joints)
  let ey = select(1e3, min(uv.y, 1.0 - uv.y) / lv, uv.y > -0.01 && uv.y < 1.01);
  let aa = max(fpm, 1e-4);
  let hb = hash22(vec2f(floor(uv.x) * 1.37, 7.7)) - 0.5;
  let tone = k * (1.0 - smoothstep(len * 0.08, len * 0.3, fpm));
  var c = (1.0 + hb.x * 0.12 * tone) * vec3f(1.0 + hb.y * 0.06 * tone, 1.0, 1.0 - hb.y * 0.06 * tone);
  c *= 1.0 - 0.42 * lineAA(dm, 0.0035, aa) * k;
  let near = 1.0 - smoothstep(0.012, 0.05, fpm);
  let worn = (1.0 - smoothstep(0.0, 0.035 + aa, ey)) + 0.6 * (1.0 - smoothstep(0.004, 0.03 + aa, dm));
  c *= 1.0 + 0.07 * saturate(worn) * near * k;
  var g = vec3f(0.0);
  if (full && near > 0.0) {
    // (the height falls over 2.5 cm to the joint and to the long edges: smoothstep's slope, 4 mm deep)
    let b = 0.025;
    let tj = saturate(dm / b);
    let te = saturate(ey / b);
    let sj = 0.004 * 6.0 * tj * (1.0 - tj) / b;
    let se = 0.004 * 6.0 * te * (1.0 - te) / b;
    g = F.gu * (sj * len * sign(jd)) + F.gv * (se / lv * select(-1.0, 1.0, uv.y < 0.5));
    g *= k * (1.0 - smoothstep(b * 0.3, b * 1.2, fpm));
  }
  return Painted(c, g);
}

// the plaster's own marks on a wall: s along it and y up it (world m), hg its height over the ground
fn plasterOf(c0: vec3f, s: f32, y: f32, hg: f32, wall: f32, fpm: f32, k: f32, full: bool, seed: f32, edge: f32) -> vec3f {
  var c = c0;
  let aa = max(fpm, 0.004);
  // the dado: the wall's foot a shade darker to a little over a metre (over the plinth most walls stand on), its top
  // a soft wavering edge, as a painter washes it
  let top = 1.3 + 0.25 * (edge - 0.5);
  c *= mix(vec3f(1.0), DADO, (1.0 - smoothstep(top - 0.25 - aa, top + aa, hg)) * wall * k);
  // patches made good: a soft-edged blob a shade lighter (fresh) or darker (old) than the wall, its lip a fine line
  // darker under it. One at most in a cell, kept inside it; gone before they're a few pixels across
  let PC = vec2f(3.0, 2.4);
  let cell = floor(vec2f(s, y) / PC);
  let h1 = hash22(cell + vec2f(seed * 2.7, 19.1));
  let pf = (1.0 - smoothstep(0.12, 0.3, fpm)) * k * wall;
  if (h1.x < 0.22 && pf > 0.0) {
    let h2 = hash22(cell * 2.31 + vec2f(5.3, seed));
    let r = vec2f(0.3 + 0.45 * h1.y, 0.25 + 0.35 * fract(h1.x * 31.7));
    let d = vec2f(s, y) - (cell + 0.3 + 0.4 * h2) * PC;
    let sd = (length(d / r) - 1.0 + 0.28 * (noise2(d * 2.6 + h2 * 9.0) - 0.5)) * min(r.x, r.y);
    c *= mix(1.0, mix(0.94, 1.05, fract(h1.y * 7.3)), fillAA(sd, aa) * 0.9 * pf);
    c *= 1.0 - 0.07 * lineAA(abs(sd), 0.005, aa) * (0.4 + 0.6 * saturate(-d.y / r.y)) * pf;
  }
  if (!full) { return c; }
  // the trowel's long soft strokes, laid two ways across each other (a metre long, a hand wide); close to only
  let tf = (1.0 - smoothstep(0.02, 0.08, fpm)) * k * wall;
  if (tf > 0.0) {
    let q = vec2f(s, y);
    let a = noise2(vec2f(dot(q, vec2f(0.82, 0.57)) * 0.9, dot(q, vec2f(-0.57, 0.82)) * 3.4) + vec2f(seed * 5.0, 0.0));
    let b = noise2(vec2f(dot(q, vec2f(0.82, -0.57)) * 0.9, dot(q, vec2f(0.57, 0.82)) * 3.4) + vec2f(0.0, seed * 3.0));
    c *= 1.0 + (a + b - 1.0) * 0.06 * tf;
  }
  // a few hairline cracks: a short wandering line down from a point, in one cell in six; gone past a centimetre a pixel
  let cf = (1.0 - smoothstep(0.006, 0.02, fpm)) * k * wall;
  if (cf > 0.0) {
    let CC = vec2f(3.0, 2.6);
    let cc = floor(vec2f(s, y) / CC);
    let h3 = hash22(cc + vec2f(seed * 4.3, 41.0));
    if (h3.x < 0.16) {
      var a = (cc + vec2f(0.35, 0.55) + vec2f(0.3, 0.2) * hash22(cc * 1.9 + 7.0)) * CC;
      var dir = normalize(vec2f(h3.y - 0.5, -1.0));
      var d = 1e9;
      for (var j = 0; j < 4; j++) {
        let hj = hash22(cc * 3.1 + vec2f(f32(j) * 5.7, 2.0));
        dir = normalize(dir + vec2f(hj.x - 0.5, (hj.y - 0.5) * 0.4) * 0.9);
        let b = a + dir * (0.08 + 0.14 * hj.y);
        d = min(d, sdSeg(vec2f(s, y), a, b));
        a = b;
      }
      c *= 1.0 - 0.45 * lineAA(d, 0.0011, aa) * cf;
    }
  }
  return c;
}

// the years' wear: s along the surface and y up it (world m), hg its height over the ground, n its normal, ao the
// builders' ambient
fn wearOf(c0: vec3f, p: vec3f, s: f32, hg: f32, n: vec3f, wall: f32, ao: f32, fpm: f32, k: f32, full: bool, seed: f32,
          edge: f32, drift: f32) -> vec3f {
  var c = c0;
  let aa = max(fpm, 0.01);
  let up = smoothstep(0.5, 0.9, n.y);
  // grime and warmth low on the wall (a splash at the very foot), its top a soft uneven edge; and in the creases
  var gr = (1.0 - ao) * 0.45;
  if (wall > 0.0 && AU.wear.x > 0.0) {
    let reach = 1.6 + 1.0 * edge;
    gr += (pow(saturate(1.0 - hg / reach), 1.7) * 0.7 + (1.0 - smoothstep(0.0, 0.2 + aa, hg)) * 0.3) * wall;
  }
  c *= mix(vec3f(1.0), GRIME, saturate(gr) * k * AU.wear.x);
  // streaks washed down the wall from under its ledges and sills: one at most in a cell (along it and up it), from a
  // soft head down a metre or four, a soft wash a hand or two wide, widening and fading as it runs, broken here and
  // there, wandering a little; the cell it's in and the one over it (whose streak runs down into it). Gone before they're
  // thinner than a pixel
  let sf = (1.0 - smoothstep(0.04, 0.16, fpm)) * wall * k * AU.wear.y;
  if (full && sf > 0.0) {
    let SC = vec2f(1.6, 4.0);
    var st = 0.0;
    for (var j = 0; j < 2; j++) {
      let cell = floor(vec2f(s, p.y) / SC) + vec2f(0.0, f32(j));
      let h1 = hash22(cell + vec2f(seed * 1.31, 0.7));
      if (h1.x < 0.35) {
        let h2 = hash22(cell * 1.73 + vec2f(4.1, seed));
        let t = ((cell.y + 0.5 + 0.45 * h2.y) * SC.y - p.y) / (1.5 + 3.0 * h1.y);
        if (t > -0.05 && t < 1.0) {
          let w = (0.05 + 0.12 * fract(h1.x * 17.3)) * (1.0 + 0.8 * saturate(t));
          let wob = (noise2(vec2f(p.y * 1.6, cell.x * 3.3)) - 0.5) * 0.08;
          let ax = abs(s - (cell.x + 0.2 + 0.6 * h2.x) * SC.x - wob);
          let breaks = 0.55 + 0.45 * noise2(vec2f(p.y * 2.3, cell.x * 7.1 + seed));
          st = max(st, (1.0 - smoothstep(0.0, w + aa, ax)) * smoothstep(-0.05, 0.08, t) * pow(1.0 - saturate(t), 1.3) * breaks);
        }
      }
    }
    c *= mix(vec3f(1.0), STREAK, st * sf);
  }
  // dust settled on what faces up, thicker in its hollows (where the texture's darker); the sun's fading high on the walls (most on those facing south,
  // into it) and on the tops: paler, a little of the colour gone
  let dz = k * AU.wear.z;
  if (up > 0.0 && dz > 0.0) { c = mix(c, DUST, up * drift * 0.25 * dz); }
  let fade = (smoothstep(2.5, 12.0, hg) * wall * (0.5 + 0.5 * saturate(n.z)) + up * 0.5) * 0.09 * dz;
  c = mix(c, mix(vec3f(dot(c, LUMA)), c, 0.55) * 1.1, fade);
  return c;
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let mat = AU.mats[min(i.id.x, 28u)];
  let p = i.p;
  let toCam = frame.camPos - p;
  let dist = length(toCam);
  let v = toCam / max(dist, 1e-4);
  var n = normalize(i.n);
  let ng = n;
  // the texture: by the metre, or a whole panel or frieze per uv unit (cut blocks: the block's length per uv unit
  // along, half that across); the picture upright
  let map = i32(mat.look.w);
  let layer = i32(mat.tex.x);
  var ts = select(vec2f(1.0 / max(mat.tex.y, 1e-3)), vec2f(1.0), map == 1 || map == 2);
  if (map == 9) { ts = vec2f(1.0, 0.5) * mat.paint.y / max(mat.tex.y, 1e-3); }
  ts.y = -ts.y;
  let tuv = i.uv * ts;
  let texel = textureSample(matTex, samp_repeat, tuv, max(layer, 0)).rgb;
  let mean = textureSampleLevel(matTex, samp_repeat, vec2f(0.5), max(layer, 0), 12.0).rgb;
  let fw = fwidth(i.uv);
  // (the painted detail's derivatives: the surface's footprint and its uv's lay in the world, how fast its normal turns
  // — taken here, ahead of every branch, where derivatives may be taken)
  let dpx = dpdx(p);
  let dpy = dpdy(p);
  let duvx = dpdx(i.uv);
  let duvy = dpdy(i.uv);
  let dn = fwidth(i.n);
  // (and the texture's light two mips softer than it's drawn, and how it changes across the pixel: the relief's
  // slope, reliefGrad. Only with the relief on: on the phone, or with it off, the read's skipped)
  var dhx = 0.0;
  var dhy = 0.0;
  if (AU.paint.x > 0.0 && AU.paint.y > 0.0 && AU.paint.w > 0.5) {
    let hb = dot(textureSampleBias(matTex, samp_repeat, tuv, max(layer, 0), 2.0).rgb, LUMA);
    dhx = dpdxFine(hb);
    dhy = dpdyFine(hb);
  }
  // the caverns' crystals and their glowing water: their own light, nothing else
  if (i.id.x == 25u || i.id.x == 26u) { return vec4f(cavernGlow(i, p, n, v, fw), 1.0); }
  let under = underground(p);

  // its colour: the texture's own, or the base colour with the texture's light and dark; the builder's tint; the wander
  var albedo = mat.base.rgb;
  if (layer >= 0) {
    let own = mix(mean, texel, mat.tex.w) * mat.base.rgb;
    let detail = mix(1.0, dot(texel, LUMA) / max(dot(mean, LUMA), 1e-4), mat.tex.w);
    albedo = mix(mat.base.rgb * detail, own, mat.tex.z);
  }
  if (map == 3) { albedo = clothOf(i.uv, i.tint.rgb, fw.x, mat.base.rgb); } else { albedo *= i.tint.rgb; }
  // a window's pane: its glazing bars (a cross, cream-painted wood), the light inside falling off toward its top and
  // its sides (x the bars, y the light's fall)
  var pane = vec2f(0.0, 1.0);
  if (map == 4 && i.uv.x > -0.5) {
    pane = paneOf(i.uv, fw);
    albedo = mix(albedo, vec3f(0.42, 0.34, 0.24), pane.x);
  }
  // the tiles and the lattice doors: the pattern's colour (its mean far off); each glazed piece tilted a little askew,
  // the grout and the ink rough; the lattice's gold metal, its bars rounded, its shadow on the wood
  var rough = max(mat.base.w, 0.05);
  var metal = mat.look.x;
  var latShade = 1.0;
  if (map >= 5 && map <= 8) {
    let pal = i.id.y;
    let fp = max(fw.x, fw.y);
    let aa = max(fp, 1e-4);
    let far = smoothstep(0.07, 0.3, fp);
    let up = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.y) > 0.9);
    let T = normalize(cross(up, n));
    let B = cross(n, T);
    if (map == 8) {
      let L = latticeAt(i.uv, aa, 0.0);
      // (its bars' and straps' round, by the height's slope: near only, gone before it could sparkle)
      if (fp < 0.12) {
        let e = 0.03;
        let hx = latticeAt(i.uv + vec2f(e, 0.0), aa, 0.0).y;
        let hy = latticeAt(i.uv + vec2f(0.0, e), aa, 0.0).y;
        let bump = 0.5 * (LATTICE_DEPTH / LATTICE_PITCH) * (1.0 - smoothstep(0.03, 0.12, fp)) / e;
        var g = vec2f(hx - L.y, hy - L.y) * bump;
        g = g * min(1.0, 0.75 / max(length(g), 1e-4));
        n = normalize(n - T * g.x - B * g.y);
      }
      // the sun's shadow of the gold on the wood a little away from it, softened (where the sun reaches the door)
      let l = world.sunDir;
      let ln = dot(l, n);
      var sh = 0.0;
      if (ln > 0.0 && far < 1.0 && L.x < 1.0) {
        var off = vec2f(dot(l, T), dot(l, B)) / max(ln, 0.08) * (LATTICE_DEPTH / LATTICE_PITCH);
        off = off * min(1.0, 0.6 / max(length(off), 1e-4));
        sh = latticeAt(i.uv + off, aa + 0.05, 0.015).x * (1.0 - L.x) * (1.0 - far);
      }
      let wood = albedo * (1.0 - 0.22 * sh) * (1.0 - 0.75 * L.z);
      let gold = palC(pal, 4u) * 1.15;
      let cov = mix(L.x, W_LATTICE, far);
      albedo = mix(mix(wood, albedo, far), gold, cov);
      metal = mix(0.0, 0.7, cov);
      rough = mix(rough, 0.34, cov);
      latShade = 1.0 - 0.85 * sh;
    } else {
      var t: Tiled;
      var mean: vec3f;
      if (map == 5) { t = starField(i.uv, aa, pal); mean = palMix(pal, W_FIELD, W_FIELD_INK); }
      else if (map == 6) { t = starBand(i.uv, aa, pal); mean = palMix(pal, W_BAND, W_BAND_INK); }
      else { t = chevronBorder(i.uv, aa, pal); mean = palMix(pal, W_BORDER, W_BORDER_INK); }
      albedo = mix(t.c, mean, far) * i.tint.rgb;
      rough = mix(mix(rough, 0.75, t.grout), mix(rough, 0.75, 0.15), far);
      // (a tiled floor or step walked smooth but not glassy: it shouldn't mirror the sky at a glance along a street)
      if (n.y > 0.7) { rough = max(rough, 0.5); }
      let tilt = (hash22(t.piece * 1.618 + vec2f(f32(pal) * 7.1, 3.3)) - 0.5) * 0.14 * (1.0 - smoothstep(0.02, 0.07, fp));
      n = normalize(n + T * tilt.x + B * tilt.y);
    }
  }
  let ao = i.tint.a;

  // the painted detail (above): the texture's relief, the cut blocks, the plaster's marks, the years' wear
  // (none inside the walk-in room: an inside is kept), and the normal tilted by the relief
  let mp = mat.paint;
  let before = albedo;
  var hg = 1e4;
  if (AU.paint.x > 0.0 && any(mp > vec4f(0.0))) {
    let pk = AU.paint.x;
    let full = AU.paint.w > 0.5;
    let fpm = max(length(dpx), length(dpy));
    var g = vec3f(0.0);
    if (full && mp.x > 0.0 && AU.paint.y > 0.0 && layer >= 0 && (map <= 2 || map == 9)) {
      // (faded as the texture's texels shrink past several to a pixel: its mips' own slopes are all that's left)
      let tdx = duvx * ts;
      let tdy = duvy * ts;
      let tpp = max(length(tdx), length(tdy)) * f32(textureDimensions(matTex).x);
      let rf = 1.0 - smoothstep(8.0, 24.0, tpp);
      if (rf > 0.0) {
        g += reliefGrad(ng, dpx, dpy, dhx, dhy) / max(dot(mean, LUMA), 1e-3) * (mp.x * AU.paint.y * RELIEF_DEPTH * rf * pk);
      }
    }
    // (a cut block's joints on its faces, not its top: a top's uv run the world's way, not its own)
    if (map == 9 && mp.y > 0.0 && AU.paint.z > 0.0 && abs(ng.y) < 0.8) {
      let b = blocksOf(i.uv, uvFrame(ng, dpx, dpy, duvx, duvy), fpm, full, AU.paint.z * pk * (1.0 - smoothstep(0.5, 0.8, abs(ng.y))));
      albedo *= b.c;
      g += b.g;
    }
    if ((mp.z > 0.0 || mp.w > 0.0) && !inRoom(roomLocal(p))) {
      // along the surface (m): across the world along a flat face's horizontal, so a pattern runs on unbroken from one
      // face of a wall to the next in its plane; a curved face's own uv where they're metres (round a column)
      let ax = vec2f(ng.z, -ng.x);
      let sw = dot(p.xz, ax) / max(length(ax), 1e-3);
      let s = select(sw, i.uv.x, length(dn) > 1e-5 && map == 0);
      // (a wall's, not a floor's or a top's; its washes gone by the time a metre is a pixel or so, far over the town)
      let wall = (1.0 - smoothstep(0.5, 0.8, abs(ng.y))) * (1.0 - smoothstep(0.4, 0.8, fpm));
      let seed = f32(i.id.x) * 0.618;
      // (the ground under it only for a wall: what's low on a wall is all it's wanted for)
      // (one soft wavering along the wall for the dado's edge and the grime's reach; the dust's drifts from the
      // texture's own light, deeper in its darker hollows)
      var edge = 0.5;
      if (wall > 0.0) {
        hg = p.y - groundUnder(p, under);
        edge = noise2(vec2f(s * 0.8, seed * 3.1));
      }
      let drift = saturate(0.8 + 0.6 * (1.0 - dot(texel, LUMA) / max(dot(mean, LUMA), 1e-3)));
      if (mp.w > 0.0 && AU.wear.w > 0.0 && wall > 0.0) {
        albedo = plasterOf(albedo, s, p.y, hg, wall, fpm, mp.w * AU.wear.w * pk, full, seed, edge);
      }
      if (mp.z > 0.0) { albedo = wearOf(albedo, p, s, hg, ng, wall, ao, fpm, mp.z * pk, full, seed, edge, drift); }
    }
    n = normalize(n - g * min(1.0, 0.6 / max(length(g), 1e-4)));
  }
  albedo = clamp(albedo * wander(p, mat.look.z * AU.look.y, f32(i.id.x)), vec3f(0.0), vec3f(0.92));

  // the key light and its shadow (inside the room: only where it comes through its window or its door)
  let l = world.sunDir;
  let ndl = dot(n, l);
  let rq = roomLocal(p);
  let inside = inRoom(rq);
  var vis = 0.0;
  if (ndl > 0.0 && dot(ng, l) > 0.0 && under < 0.999) {
    if (inside) { vis = roomKey(rq, roomDir(l)); } else { vis = sunShadow(p, ng) * latShade * (1.0 - under); }
  }
  let sunE = sunLight(p);
  let key = sunE * vis;
  let lit = saturate(ndl) * vis;
  // the shade (what the key misses, by day, and the creases): the sky's light in it turns lavender at its own
  // brightness and the colour it falls on is glazed toward violet at its own value (maroon-violet on the red stone,
  // lavender on the cream: never a grey), and the sunlit canyon floor bounces its warm stone up into whatever faces
  // down or sideways
  let day = saturate(world.sunTrue.y * 5.0 + 0.25) * (1.0 - under);
  // (inside, the shade leans only a little violet: the room's red walls warm what light there is)
  let lean = AU.look.x * select(1.0, 0.3, inside);
  let shade = saturate(1.0 - smoothstep(0.0, 0.35, lit) + (1.0 - ao) * 0.5) * day;
  var skyE = mix(skyAmbient(n), caveAmbient(n), under);
  if (inside) { skyE = roomAmbient(rq, roomDir(n), roomDir(l), sunE); }
  let sky = mix(skyE, dot(skyE, LUMA) * VIOLET, shade * lean) * mix(0.25, 1.0, ao);
  let bounce = sunE * max(l.y, 0.0) * vec3f(0.5, 0.25, 0.15) * (0.5 - 0.5 * n.y) * AU.look.w / PI * (1.0 - under) * select(1.0, 0.0, inside);
  let f0 = mix(vec3f(mat.look.y), albedo, metal);
  let lamp = max(i.lamp.rgb, vec3f(0.0));
  let live = liveLamps(p, n);
  let lightE = key * saturate(ndl) * mix(1.0, ao, 0.35) / PI + live / PI + lamp / PI;
  let shaded = mix(albedo, dot(albedo, LUMA) * GLAZE, 0.4 * shade * lean);
  var c = (albedo * lightE + shaded * (sky + bounce * mix(0.4, 1.0, ao))) * (1.0 - metal);
  // (a metal's lamps: gold leaf is rough enough that the lamps' light round it comes back off it in its own colour)
  c += f0 * (lamp + live) / PI * metal;
  // the key's highlight; the sky's reflection on what's smooth (metal shows it in its own colour: gold stays gold under
  // a teal sky)
  c += key * ggx(n, v, l, rough, f0);
  if (rough < 0.75) {
    let nv = saturate(dot(n, v));
    var env = mix(envOf(reflect(-v, n), sunE), caveAmbient(reflect(-v, n)) * PI, under);
    // (inside, what a glaze or the brass sees is the room: its warm walls in the light let in)
    if (inside) { env = roomAmbient(rq, roomDir(reflect(-v, n)), roomDir(l), sunE) * PI; }
    env = mix(env, vec3f(dot(env, LUMA)), metal);
    let F = f0 + (max(vec3f(1.0 - rough), f0) - f0) * pow(1.0 - nv, 5.0);
    c += env * F * (1.0 - rough) * mix(0.3, 1.0, ao) * (1.0 - pane.x);
  }
  // its own glow at night: a window's warm light, a doorway's, a lantern's paper lit through (a brazier's coals while
  // it burns)
  let g = select(f32(i.id.y) / 255.0, 0.0, map >= 5 && map <= 8);
  if (g > 0.0) {
    let own = mix(i.tint.rgb, albedo * 2.2, mat.glow.w);
    c += mat.glow.rgb * own * g * i.lamp.a * AU.night.z * mix(held(), 1.0 / max(world.exposure, 1e-6), under) * pane.y * (1.0 - pane.x);
  }

  let dbg = i32(AU.look.z);
  let ex = max(world.exposure, 1e-6);
  if (dbg == 1) { return vec4f(pieceColour(i.id.z) * (0.45 + 0.55 * saturate(dot(n, normalize(vec3f(0.3, 1.0, 0.4))))) * 0.6 / ex, 1.0); }
  if (dbg == 2) { c = vec3f(0.5) * (lamp / PI + vec3f(0.02 / ex)); }
  if (dbg == 3) { return vec4f(albedo * 0.7 / ex, 1.0); }
  if (dbg == 4) { return vec4f((n * 0.5 + 0.5) * 0.6 / ex, 1.0); }
  // (the painted detail alone: what it did to the colour, over a grey, lit from above by the normal it tilted; and the
  // height over the ground it's painted by, a band a metre, red under the dado's metre)
  if (dbg == 6) {
    let r = select(vec3f(1.0), (albedo / max(before * wander(p, mat.look.z * AU.look.y, f32(i.id.x)), vec3f(1e-4))), any(before > vec3f(0.0)));
    return vec4f(min(r, vec3f(2.0)) * 0.5 * (0.35 + 0.65 * saturate(dot(n, normalize(vec3f(0.3, 1.0, 0.4))))) * 0.6 / ex, 1.0);
  }
  if (dbg == 7) {
    let band = 0.6 + 0.4 * step(0.5, fract(hg));
    let hc = select(select(vec3f(0.25, 0.35, 0.8), vec3f(0.9, 0.3, 0.2), hg < 1.0), vec3f(0.3), hg > 1e3);
    return vec4f(hc * band * 0.6 / ex, 1.0);
  }

  c = mix(wetLook(c, p, n, v, vis, dist, 0.0), c, under);
  return vec4f(applyAerial(c, p), 1.0);
}
