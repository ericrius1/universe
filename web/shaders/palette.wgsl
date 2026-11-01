// Colours and materials of the cell, after scientific illustration and medical animation: each organelle its own hue,
// the light inside it (sss) deeper and warmer than its surface, membranes wet and glassy. And the fluorescence-
// microscope look the same shapes take under a confocal: dyes on a black field (DAPI, MitoTracker, ER-Tracker,
// LysoTracker; tubulin and phalloidin for the filaments, in filament.wgsl).
struct Material { albedo: vec3f, sss: vec3f, rough: f32, wrap: f32, trans: f32, rim: f32, glass: f32, glow: f32 }

fn mat(albedo: vec3f, sss: vec3f, rough: f32, wrap: f32, trans: f32, rim: f32, glass: f32) -> Material {
  var m: Material;
  m.albedo = srgb(albedo); m.sss = srgb(sss); m.rough = rough; m.wrap = wrap; m.trans = trans; m.rim = rim; m.glass = glass; m.glow = 0.0;
  return m;
}

fn material(kind: u32, interior: bool) -> Material {
  var m: Material;
  switch kind {
    case 0u: { m = mat(vec3f(0.98, 0.74, 0.64), vec3f(0.92, 0.55, 0.45), 0.32, 0.6, 0.45, 1.0, 0.55); }    // plasma membrane
    case 1u: { m = mat(vec3f(0.50, 0.44, 0.95), vec3f(0.36, 0.20, 0.80), 0.35, 0.5, 0.7, 0.9, 0.62); }    // nuclear envelope
    case 2u: { m = mat(vec3f(0.62, 0.26, 0.70), vec3f(0.45, 0.10, 0.45), 0.6, 0.4, 0.3, 0.4, 1.0); }      // nucleolus
    case 3u: { m = mat(vec3f(1.0, 0.45, 0.28), vec3f(0.85, 0.12, 0.06), 0.38, 0.5, 0.8, 0.9, 0.5); }      // mitochondrion
    case 4u: { m = mat(vec3f(1.0, 0.66, 0.30), vec3f(0.9, 0.32, 0.08), 0.45, 0.5, 0.6, 0.6, 1.0); }       // crista
    case 5u: { m = mat(vec3f(0.30, 0.80, 0.78), vec3f(0.05, 0.42, 0.50), 0.4, 0.55, 0.7, 0.7, 1.0); }     // endoplasmic reticulum
    case 6u: { m = mat(vec3f(1.0, 0.80, 0.42), vec3f(0.85, 0.42, 0.10), 0.4, 0.55, 0.7, 0.7, 1.0); }      // Golgi
    case 7u: { m = mat(vec3f(0.95, 0.36, 0.62), vec3f(0.6, 0.06, 0.32), 0.3, 0.5, 0.8, 1.0, 0.6); }       // lysosome
    case 8u: { m = mat(vec3f(0.70, 0.90, 0.40), vec3f(0.25, 0.55, 0.08), 0.3, 0.5, 0.8, 1.0, 0.6); }      // peroxisome
    case 9u: { m = mat(vec3f(0.45, 0.75, 1.0), vec3f(0.10, 0.35, 0.75), 0.3, 0.5, 0.8, 1.0, 0.55); }      // endosome
    case 10u: { m = mat(vec3f(1.0, 0.90, 0.70), vec3f(0.85, 0.55, 0.25), 0.25, 0.5, 0.9, 1.1, 0.45); }    // vesicle
    case 11u: { m = mat(vec3f(1.0, 0.93, 0.74), vec3f(0.95, 0.70, 0.30), 0.12, 0.6, 1.0, 1.0, 1.0); }     // lipid droplet
    case 12u: { m = mat(vec3f(0.95, 0.74, 0.66), vec3f(0.88, 0.58, 0.50), 0.35, 0.7, 0.35, 1.2, 0.4); }   // a neighbouring cell
    case 13u: { m = mat(vec3f(0.45, 0.38, 0.85), vec3f(0.30, 0.15, 0.65), 0.4, 0.5, 0.6, 0.8, 0.85); }
    default: { m = mat(vec3f(0.6), vec3f(0.4), 0.5, 0.4, 0.3, 0.5, 1.0); }
  }
  if (kind == 7u || kind == 11u) { m.glow = 0.05; }
  if (interior) {
    // the inside of a compartment: its wall seen from within, dimmer and deeper
    m.albedo = m.sss * 0.55;
    m.rim *= 0.35;
    m.trans *= 0.4;
  }
  return m;
}

fn surfOf(m: Material) -> Surf {
  var s: Surf;
  s.albedo = m.albedo; s.sss = m.sss; s.rough = m.rough; s.wrap = m.wrap; s.trans = m.trans; s.rim = m.rim;
  return s;
}

// the dye each organelle takes under the microscope (black if none)
fn dye(kind: u32) -> vec3f {
  switch kind {
    case 1u, 2u, 13u: { return vec3f(0.15, 0.35, 1.6); }    // DAPI (nucleus)
    case 3u, 4u: { return vec3f(1.6, 0.18, 0.12); }         // MitoTracker
    case 5u: { return vec3f(0.1, 1.1, 1.2); }               // ER-Tracker
    case 6u: { return vec3f(1.3, 0.9, 0.1); }               // Golgi (GalT-YFP)
    case 7u: { return vec3f(1.4, 0.2, 1.1); }               // LysoTracker
    default: { return vec3f(0.0); }
  }
}
fn fluoro(c: vec3f, kind: u32, n: vec3f, v: vec3f) -> vec3f {
  if (G.fluo <= 0.0) { return c; }
  // dyes glow from the whole volume: brighter where the eye looks through more of it (the edges)
  let thick = 0.35 + 0.65 * pow(clamp(1.0 - abs(dot(n, v)), 0.0, 1.0), 1.5);
  let f = dye(kind) * thick * 0.9;
  return mix(c, f, G.fluo);
}
