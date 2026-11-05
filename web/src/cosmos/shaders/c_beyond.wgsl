// Beyond the observable universe (levels/beyond.ts): what the keepers' world looks like from wherever the camera is, laid
// over their bodies (drawn first as meshes, c_keepers.wgsl: their light and how far away they are, per pixel). Nothing
// here marches: the marbles, our universe's among them, are spheres solved exactly — glass that reflects their sky and
// bends what's inside and behind them — with their insides layered (a disc galaxy through the middle, a shell of nebula
// round it, each a texture or a few noise taps at its own depth, so they part as the view turns); the threads of light
// are segments whose glow is found in closed form; the sky is a texture on the inside of a sphere round their world, a
// second, sparser one inside it for depth, and the sea of cloud they stand in is a plane.
//
// The camera can be inside their world (the cosmos's view at the top of the zoom: everything covered) or outside it
// (the cell's view, where their world is the jewel: covered only where its sky shows, the cell's light through the
// gaps). Out: light premultiplied by how much covers, for whoever lays it in.
#include "weft/fullscreen"
#include "noise.wgsl"

// a phone's: no colour split in the refraction, fewer layers in the marbles, the thread's coils coarser (beyond.ts)
override HI: bool = true;

#include "c_bview.wgsl"
@group(2) @binding(1) var keepCol: texture_2d<f32>;
@group(2) @binding(2) var keepDist: texture_2d<f32>;
@group(2) @binding(3) var uniTex: texture_2d<f32>;
@group(2) @binding(4) var skyTex: texture_2d<f32>;
@group(2) @binding(5) var wispTex: texture_2d<f32>;
@group(2) @binding(6) var galTex: texture_2d<f32>;
@group(2) @binding(7) var<storage, read> marbles: array<vec4f>;
@group(2) @binding(8) var<storage, read> chunks: array<vec4f>;
@group(2) @binding(9) var<storage, read> segs: array<vec4f>;

const FAR = 1e9;

// ---------------------------------------------------------------- their sky
// the shell's light in a direction from their world's middle (its inside; from outside it's the same, the far side's
// seen through the near): the painted nebula, a little brighter where its gold web runs
fn skyAt(n: vec3f) -> vec3f {
  let c = textureSampleLevel(skyTex, samp_repeat, equirect(n), 0.0).rgb;
  return c * (0.35 + 0.65 * c) * V.skyTop.w * 1.6;
}
fn wispAt(n: vec3f) -> vec3f {
  return textureSampleLevel(wispTex, samp_repeat, equirect(n) + vec2f(0.37, 0.0), 0.0).rgb * V.skyTop.w * 0.9;
}
// what lights a surface from the sky round it (no texture lookups: the ambient's two halves and the two lights)
fn ambient(n: vec3f) -> vec3f { return mix(V.skyLow.rgb, V.skyTop.rgb, n.y * 0.5 + 0.5); }

// what a glass surface sees in a direction: the sky (a blurrier lookup) and the lights as glints
fn env(d: vec3f, p: vec3f) -> vec3f {
  let n = normalize(d);
  var c = textureSampleLevel(skyTex, samp_repeat, equirect(n), 3.0).rgb * V.skyTop.w * 1.4;
  c += V.keyColor.rgb * pow(max(dot(n, V.key.xyz), 0.0), 900.0) * 60.0;
  c += V.rimColor.rgb * pow(max(dot(n, V.rim.xyz), 0.0), 400.0) * 25.0;
  // (the two marbles that light their world, as glints)
  let toO = V.orb.xyz - p;
  c += V.orbLight.rgb * pow(max(dot(n, normalize(toO)), 0.0), 3000.0) * 40.0 * ss(400.0, 20.0, length(toO));
  let toB = V.orbB.xyz - p;
  c += V.orbBLight.rgb * pow(max(dot(n, normalize(toB)), 0.0), 3000.0) * 40.0 * ss(400.0, 20.0, length(toB));
  return c;
}

// ---------------------------------------------------------------- the marbles
struct Hit { t: f32, id: i32 }
fn marbleHit(ro: vec3f, rd: vec3f, tMax: f32) -> Hit {
  var h: Hit; h.t = tMax; h.id = -1;
  for (var i = 0u; i < V.counts.x; i++) {
    let m = marbles[i * 3u];
    if (m.w <= 0.0) { continue; }
    let s = sphere(ro, rd, m.xyz, m.w);
    if (s.x > 0.0 && s.x < h.t) { h.t = s.x; h.id = i32(i); }
  }
  return h;
}

// a universe inside a marble, seen along a ray already bent into it: a disc galaxy through its middle (the galaxy
// texture, turned on the marble's own axis) and round it a shell of nebula at 0.72 of its radius, met on the way in and
// on the way out — layers at their own depths, so turning the marble parts them
fn inside(ro: vec3f, rd: vec3f, c: vec3f, r: f32, axis: vec3f, spin: f32, hueA: vec3f, hueB: vec3f, kind: f32) -> vec3f {
  var col = vec3f(0.0);
  // the nebula shell (its far side first, then its near side)
  let s = sphere(ro, rd, c, r * 0.72);
  if (s.y > 0.0) {
    for (var k = 0; k < 2; k++) {
      let t = select(s.x, s.y, k == 0);
      if (t < 0.0) { continue; }
      let q = turnAbout(normalize(ro + rd * t - c), axis, spin);
      let f = fbm(q * 2.6 + vec3f(kind * 7.1), select(2, 4, HI));
      let neb = mix(hueA, hueB, ss(-0.3, 0.4, f)) * pow(max(f + 0.35, 0.0), 2.2) * 2.2;
      col += neb * select(0.55, 0.32, k == 1);
    }
  }
  // the galaxy's disc, across the middle
  let dn = dot(rd, axis);
  if (abs(dn) > 1e-3) {
    let t = dot(c - ro, axis) / dn;
    if (t > 0.0) {
      let q = ro + rd * t - c;
      let e1 = normalize(cross(axis, select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(axis.x) > 0.8)));
      let e2 = cross(axis, e1);
      var uv = vec2f(dot(q, e1), dot(q, e2)) / (r * 0.78);
      let a = spin * 0.7; let ca = cos(a); let sa = sin(a);
      uv = vec2f(uv.x * ca - uv.y * sa, uv.x * sa + uv.y * ca);
      if (dot(uv, uv) < 1.0) {
        let g = textureSampleLevel(galTex, samp_linear, uv * 0.5 + 0.5, 0.0).rgb;
        // (tinted toward the marble's own colours, its core kept white-hot)
        let gl = g;
        col += mix(gl * 0.6 + gl * hueA * 1.4, gl * 2.0, ss(0.3, 0.9, lum(g))) * 3.2 * (1.0 - kind * 0.5);
      }
    }
  }
  return col;
}

// a marble's glass: the sky and the lights in it, a universe inside, the world behind bent through it
fn marbleShade(i: u32, ro: vec3f, rd: vec3f, t: f32, behind: vec3f) -> vec3f {
  let m = marbles[i * 3u]; let a = marbles[i * 3u + 1u]; let k = marbles[i * 3u + 2u];
  let p = ro + rd * t;
  let n = normalize(p - m.xyz);
  let F = fresnel(-dot(rd, n));
  let refl = env(reflect(rd, n), p);
  let rr = refract(rd, n, 1.0 / 1.5);
  let hueA = vec3f(k.x, k.y, k.z);
  let hueB = hueA.zxy * 0.8 + 0.2;
  var col = inside(p, rr, m.xyz, m.w, a.xyz, a.w, hueA, hueB, fract(k.w));
  // the glass's own: a faint tint of the light it holds and, round its rim, the inside of its far side
  let thru = sphere(p + rr * 1e-3, rr, m.xyz, m.w).y;
  let out = refract(rr, -normalize(p + rr * thru - m.xyz), 1.5);
  let rimDark = ss(0.0, 0.5, -dot(rd, n));
  col += behind * 0.15 + env(select(out, rr, dot(out, out) < 0.5), p) * 0.18 * rimDark;
  // (the glow of the universe it holds, k.w's whole part how bright)
  col *= 1.0 + floor(k.w) * 0.25;
  return refl * F + col * (1.0 - F);
}

// our universe's marble: the cosmos's own picture of it bent through the glass (by colour, on a desktop) as the light
// it holds, the sky in its face
fn orbShade(ro: vec3f, rd: vec3f, t: f32) -> vec3f {
  let c = V.orb.xyz; let r = V.orb.w;
  // (the universe inside is two-thirds of the glass across: levels/beyond.ts GLASS)
  let ru = r / 1.5;
  let p = ro + rd * t;
  let n = normalize(p - c);
  let F = fresnel(-dot(rd, n));
  let refl = env(reflect(rd, n), p);
  let axis = normalize(c - V.eye);
  var inner = vec3f(0.0); var behind = vec3f(0.0); var cover = 0.0;
  let iors = select(vec3f(1.33), vec3f(1.32, 1.33, 1.345), HI);
  for (var ch = 0; ch < select(1, 3, HI); ch++) {
    let rr = refract(rd, n, 1.0 / iors[ch]);
    // the universe, where the bent ray goes through it (where it meets the plane through the middle facing the camera:
    // that point of the cosmos's own picture of it)
    let q = p + rr * max(dot(c - p, axis) / max(dot(rr, axis), 0.05), 0.0);
    let s = textureSampleLevel(uniTex, samp_linear, uvOf(q), 0.0).rgb;
    let cp = c - p; let tca = dot(cp, rr);
    let miss = sqrt(max(dot(cp, cp) - tca * tca, 0.0));
    let cv = 1.0 - ss(ru * 0.92, ru * 1.04, miss);
    // and round it, clear glass: their world behind, bent through the ball and out the far side (upside down)
    let t2 = sphere(p + rr * 1e-3, rr, c, r).y;
    let p2 = p + rr * max(t2, 0.0);
    let n2 = normalize(p2 - c);
    var o = refract(rr, -n2, iors[ch]);
    if (dot(o, o) < 0.5) { o = reflect(rr, -n2); }
    let kq = textureSampleLevel(keepCol, samp_linear, clamp(uvOf(p2 + o * 40.0), vec2f(0.001), vec2f(0.999)), 0.0);
    let bk = kq.rgb + skyAt(o) * (1.0 - kq.a);
    if (HI) { inner[ch] = s[ch]; behind[ch] = bk[ch]; cover += cv / 3.0; } else { inner = s; behind = bk; cover = cv; }
  }
  // (without the cosmos's picture — the jewel's view, when it isn't drawn — a glow in its colours)
  if (V.cloud.z < 0.5) { inner = V.orbLight.rgb * 0.05 * (0.6 + 0.4 * fbm(n * 3.0, 3)); }
  // (the universe with its own contrast — its darks the dark between the galaxies — and its colour: the shell's near
  // and far sides overlap through the glass, warm over cool, greying each other)
  let u = inner * 30.0;
  var uc = u * u / (u + 0.03);
  let ul = lum(uc);
  uc = max(vec3f(0.0), ul + (uc - ul) * 2.1);
  // (and its own light, from deep inside: the glow of everything there is)
  let core = V.orbLight.rgb * pow(max(-dot(rd, n), 0.0), 3.0) * 0.1 * cover;
  // the glass: a hard glint of the sky's brightest, its rim catching the light round it, a faint tint
  let rf = reflect(rd, n);
  let glint = pow(max(dot(rf, V.key.xyz), 0.0), 2200.0) * 90.0 + pow(max(dot(rf, V.rim.xyz), 0.0), 600.0) * 18.0;
  let rim = pow(1.0 - max(-dot(rd, n), 0.0), 4.0);
  let thru = uc * 1.15 * cover + behind * (1.0 - cover) * vec3f(0.85, 0.88, 1.0) + core;
  return refl * F * 0.45 + vec3f(glint) + V.rimColor.rgb * rim * 0.2 + thru * (1.0 - F);
}

// ---------------------------------------------------------------- the threads
// the glow of every segment the ray passes near (closed form: the closest the ray comes to each), dimmed where
// something opaque is nearer; their light (rgb), and in a chunk's c1.z its colour
// the glow of a light at c in thin air along the ray up to tMax: ∫ k / (d² + a²) dt, in closed form
fn aura(ro: vec3f, rd: vec3f, tMax: f32, c: vec3f, a: f32) -> f32 {
  let tc = dot(c - ro, rd);
  let d2 = max(dot(c - ro, c - ro) - tc * tc, 0.0);
  let h = sqrt(d2 + a * a);
  return (atan((tMax - tc) / h) - atan(-tc / h)) / h;
}

fn threads(ro: vec3f, rd: vec3f, tMax: f32) -> vec3f {
  var col = vec3f(0.0);
  for (var c = 0u; c < V.counts.y; c++) {
    let b = chunks[c * 2u];
    // (the ray's closest to the chunk's bound)
    let oc = b.xyz - ro;
    let tb = dot(oc, rd);
    let d2 = dot(oc, oc) - tb * tb;
    let reach = b.w;
    if (d2 > reach * reach || tb + reach < 0.0 || tb - reach > tMax) { continue; }
    let info = chunks[c * 2u + 1u];
    let first = u32(info.x); let n = u32(info.y);
    var acc = 0.0;
    for (var s = first; s < first + n; s++) {
      let A = segs[s * 2u]; let B = segs[s * 2u + 1u];
      let ba = B.xyz - A.xyz; let oa = ro - A.xyz;
      let d1 = dot(rd, ba); let dd = dot(ba, ba);
      let e = dot(rd, oa); let f = dot(ba, oa);
      let den = dd - d1 * d1;
      var u = select(0.0, clamp((f - d1 * e) / max(den, 1e-9), 0.0, 1.0), dd > 1e-9);
      let t = max(d1 * u - e, 0.0);
      if (t > tMax) { continue; }
      let w = oa + rd * t - ba * u;
      let dist2 = dot(w, w);
      // (never finer than a pixel: thinner, it shimmers; its light kept)
      let wpx = max(B.w, t * V.pxAngle * 0.7);
      acc += A.w * (B.w / wpx) * wpx * wpx / (dist2 + wpx * wpx);
    }
    let hue = info.z;
    let tint = select(select(vec3f(1.0, 0.78, 0.45), vec3f(0.55, 0.95, 1.0), hue > 0.5), vec3f(1.0, 0.55, 0.95), hue > 1.5);
    col += tint * acc;
  }
  return col;
}

// ---------------------------------------------------------------- the cloud sea
fn clouds(p: vec3f, rd: vec3f) -> vec3f {
  // (cells, as everything is from far enough: the tops of the clouds bunched like a sheet of cells)
  let q = p.xz * 0.012;
  let cl = cellular(vec3f(q, V.time * 0.01), 0.9);
  let rim = ss(0.0, 0.35, cl.d2 - cl.d1);
  let f = fbm(vec3f(p.xz * 0.02, V.time * 0.02), 4) * 0.5 + 0.5;
  let shade = mix(0.55, 1.0, rim) * mix(0.7, 1.15, f);
  var c = mix(V.skyLow.rgb, V.skyTop.rgb, 0.4) * shade * 0.55;
  // (the marbles' light on the cloud tops below them)
  let dO = length(V.orb.xyz - p); let dB = length(V.orbB.xyz - p);
  c += (V.orbLight.rgb / (1.0 + dO * dO / (V.orbLight.w * V.orbLight.w)) + V.orbBLight.rgb / (1.0 + dB * dB / (V.orbBLight.w * V.orbBLight.w))) * 0.25 * rim;
  return c;
}

// the haze over the cloud sea, thickest low down, between two points on a ray (in closed form for an exponential
// fall-off with height): how much of the light it takes
fn haze(ro: vec3f, rd: vec3f, t: f32) -> f32 {
  let H = V.cloud.y;
  let y0 = ro.y - V.cloud.x;
  let dy = rd.y;
  let k = 0.0004;
  var amt: f32;
  if (abs(dy) < 1e-4) { amt = k * exp(-y0 / H) * t; }
  else { amt = k * H * (exp(-y0 / H) - exp(-(y0 + dy * t) / H)) / dy; }
  return 1.0 - exp(-max(amt, 0.0) - t * 0.00005);
}

@fragment fn fs(in: FullscreenOut) -> @location(0) vec4f {
  let ro = V.eye;
  let rd = rayDir(in.uv);
  let C = V.world.xyz; let R = V.world.w;
  // their world's sphere: from outside, where the ray goes in and out; from inside, where it leaves
  let ws = sphere(ro, rd, C, R);
  if (ws.y < 0.0) { return vec4f(0.0); }
  let tIn = max(ws.x, 0.0);
  let tOut = ws.y;

  // the keepers (drawn before): their light and, from the inverse of their distance, how far
  let kc = textureSampleLevel(keepCol, samp_linear, in.uv, 0.0);
  let kd = textureSampleLevel(keepDist, samp_linear, in.uv, 0.0);
  let tK = select(FAR, kd.y / max(kd.x, 1e-9), kd.y > 0.02);

  // the spheres solved: our universe, the others, the cloud sea
  let so = sphere(ro, rd, V.orb.xyz, V.orb.w);
  let tO = select(FAR, so.x, so.x > 0.0);
  let mh = marbleHit(ro, rd, min(tOut, FAR));
  var tC = FAR;
  if (rd.y < 0.0 && ro.y > V.cloud.x) { tC = (V.cloud.x - ro.y) / rd.y; }
  if (tC > tOut) { tC = FAR; }
  let tA = min(min(tO, mh.t), tC);

  // behind it all: their sky (from inside, the shell's far side; from outside, both sides, the near one fainter, its
  // rim brighter, as a thin glowing layer seen edge-on is), the sparser layer inside it, and what's past it
  let nb = normalize(ro + rd * tOut - C);
  var sky = skyAt(nb);
  var alpha = 1.0;
  // (how far out of it the camera is: inside, the sky covers all; leaving it, its dark gaps open by degrees, not in a
  // frame)
  let away = ss(R * 0.96, R * 1.18, length(ro - C));
  if (ws.x > 0.0) {
    let nf = normalize(ro + rd * tIn - C);
    let edge = 1.0 - abs(dot(nf, rd));
    sky += skyAt(nf) * (0.28 + 1.4 * edge * edge * edge) * away;
  }
  // (seen from outside, the sky's dark gaps let the outside through: as clear as the nebula is thin)
  let open = clamp(lum(sky) * 9.0 + 0.18, 0.0, 1.0);
  alpha = mix(1.0, open, away);
  sky += V.outside.rgb * (1.0 - open) * (1.0 - away);
  // (the inner layer of wisps, met wherever it's crossed before anything opaque)
  let wl = sphere(ro, rd, C, R * 0.62);
  var wisp = vec3f(0.0);
  for (var k = 0; k < 2; k++) {
    let t = select(wl.x, wl.y, k == 1);
    if (t > 0.0 && t < min(tA, tK)) { wisp += wispAt(normalize(ro + rd * t - C)); }
  }

  // back to front, premultiplied: the sky (as much of it as covers), the clouds, then whatever's nearest — a marble, our
  // universe or a keeper (their edges' coverage over what's behind them)
  var acc = vec4f(sky * alpha, alpha);
  if (tC < FAR) { acc = mix(vec4f(clouds(ro + rd * tC, rd), 1.0), acc, ss(0.75, 1.0, tC / tOut)); }
  var back = acc;
  if (tO < tC && tO <= mh.t) { back = vec4f(orbShade(ro, rd, tO), 1.0); }
  else if (mh.id >= 0 && mh.t < tC) {
    // (behind a marble: the keepers bent through it if they're there, else what was behind)
    let behind = select(acc.rgb, kc.rgb + acc.rgb * (1.0 - kc.a), tK > mh.t && tK < FAR);
    back = vec4f(marbleShade(u32(mh.id), ro, rd, mh.t, behind), 1.0);
  }
  if (tK < tA) { acc = vec4f(kc.rgb + back.rgb * (1.0 - kc.a), kc.a + back.a * (1.0 - kc.a)); } else { acc = back; }
  let tHit = min(min(tA, tK), tOut);
  acc = vec4f(acc.rgb + wisp, acc.a);
  // the haze over the clouds (as much as covers), then the threads in front of what's behind them
  let hz = haze(ro + rd * tIn, rd, tHit - tIn) * mix(1.0, 0.6, away);
  acc = vec4f(mix(acc.rgb, mix(V.skyLow.rgb, V.skyTop.rgb, 0.4) * 0.8 * acc.a, hz), acc.a);
  acc = vec4f(acc.rgb + threads(ro, rd, tHit), acc.a);
  // (the two marbles' auras: their light caught in the air round them)
  let au = V.orbLight.rgb * aura(ro, rd, min(tHit, tO), V.orb.xyz, V.orb.w * 0.8) * 0.007 + V.orbBLight.rgb * aura(ro, rd, tHit, V.orbB.xyz, V.orbB.w * 0.8) * 0.006;
  acc = vec4f(acc.rgb + au * V.orb.w, acc.a);
  return acc * V.view.w;
}
