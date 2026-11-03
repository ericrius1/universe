// The newer post effects' settings (post/fx.ts fills them), shared by their passes and the final pass, and where the
// key light (sun or moon) falls on the screen.
struct FXU {
  rays: vec4f,      // x shafts' strength, y their length (uv), z decay per step, w the air's scale (m)
  flare: vec4f,     // x the lens's ghosts and halo, y the light's glare (glow, starburst), z an anamorphic streak, w -
  lens: vec4f,      // x chromatic aberration, y sharpening, z film grain, w halation
  grade: vec4f,     // x the time-of-day grade's strength, y bloom's normaliser (1 / the levels' summed weights), z -, w -
  dof: vec4f,       // x on, y focus (m; 0: autofocus on the middle of the frame), z aperture (blur px at 1080 lines), w the largest blur (px)
  ao: vec4f,        // x strength, y radius (m), z fade start (m), w fade end (m)
  misc: vec4f,      // x frame counter, yzw -
}
@group(2) @binding(10) var<uniform> FX: FXU;

// the key light's place on the screen: uv, and how far in front of the camera it is (z: 1 straight ahead .. <0 behind)
fn keyOnScreen() -> vec3f {
  let c = frame.viewProj * vec4f(world.sunDir, 0.0);
  let w = max(abs(c.w), 1e-6);
  return vec3f(c.x / w * 0.5 + 0.5, 0.5 - c.y / w * 0.5, dot(world.sunDir, frame.camFwd));
}

// the key light's colour at the camera, the clouds left out (its measured visibility stands for them)
fn keyColour() -> vec3f {
  return transmittanceToSpace(altitudeKm(frame.camPos), world.sunDir.y) * world.haze.w * keyTint();
}
