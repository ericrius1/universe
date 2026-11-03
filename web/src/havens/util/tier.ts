// The renderer's construction-time knobs, read once as things are built (shadows.ts, clouds.ts, main.ts, post.ts,
// fx.ts, textures.ts): the device's profile, as boulder picks them (its util/profiles.ts: the same names, the same
// guess at the device), with the knobs Seven Havens has. A phone draws without MSAA, ambient occlusion, shafts, the
// contour smudge or motion blur, its shadows smaller and fewer and the flora's levels nearer, at a lower resolution
// held to its frame budget (AutoResolution); a desktop GPU draws all of it. ?profile=iphone16|m1pro16|m5air|rtx5090
// picks one.

export type ProfileName = 'iphone16' | 'm1pro16' | 'm5air' | 'rtx5090';

export interface Profile {
  label: string;
  /** a phone: the phone-only economies on (prints' reach, post's edge AA, clouds' cadence) */
  phone: boolean;
  /** the scene's samples a pixel: 4 (MSAA, resolved) or 1 */
  msaa: 1 | 4;
  /** the sun's shadow map (px a side), the cascades used of shadows.ts CASCADES; the heightfield's shadow (px) */
  shadowPx: number;
  terrainShadowPx: number;
  cascades: number;
  /** the two far cascades drawn on alternate frames */
  staggerFarCascades: boolean;
  /** a heightfield shadow level redrawn at most every this many frames; the clouds' shadow map likewise */
  terrainEvery: number;
  cloudEvery: number;
  /** bloom's levels, and the contour smudge pass (post.ts) */
  bloomLevels: number;
  smudge: boolean;
  /** the post chain's effects that cost a pass or more each: ambient occlusion, crepuscular shafts, motion blur */
  ao: boolean;
  rays: boolean;
  motionBlur: boolean;
  /** the scene's view distances for the post chain and the clouds (rgba32float holds vistas past 60 km as geometry) */
  sceneDepthFormat: 'rgba16float' | 'rgba32float';
  /** the temporal upscaler in the post chain */
  temporalUpscale: boolean;
  /** an image's largest side kept on the GPU (px) */
  maxImage: number;
  /** the flora's levels' distances, scaled (flora.ts settings.quality); the cascades it casts into */
  floraReach: number;
  floraShadows: number;
  /** the canvas's device pixels a CSS pixel at most; the render's share of them to begin with and at least; the GPU's
   *  frame budget (ms) AutoResolution holds them to (0: fixed) */
  maxPixelRatio: number;
  startScale: number;
  minScale: number;
  budget: number;
}

export const PROFILES: Record<ProfileName, Profile> = {
  iphone16: {
    label: 'iPhone 16', phone: true, msaa: 1,
    shadowPx: 1024, terrainShadowPx: 512, cascades: 3, staggerFarCascades: true, terrainEvery: 12, cloudEvery: 3,
    bloomLevels: 4, smudge: false, ao: false, rays: false, motionBlur: false,
    sceneDepthFormat: 'rgba16float', temporalUpscale: false, maxImage: 2048,
    floraReach: 0.5, floraShadows: 1,
    maxPixelRatio: 2, startScale: 0.7, minScale: 0.45, budget: 24,
  },
  m1pro16: {
    label: 'M1 Pro · 16 GB', phone: false, msaa: 4,
    shadowPx: 1024, terrainShadowPx: 1024, cascades: 4, staggerFarCascades: true, terrainEvery: 8, cloudEvery: 2,
    bloomLevels: 5, smudge: true, ao: true, rays: true, motionBlur: true,
    sceneDepthFormat: 'rgba16float', temporalUpscale: false, maxImage: 4096,
    floraReach: 0.75, floraShadows: 2,
    maxPixelRatio: 1.5, startScale: 0.8, minScale: 0.5, budget: 14,
  },
  m5air: {
    label: 'M5 Air', phone: false, msaa: 4,
    shadowPx: 1280, terrainShadowPx: 1024, cascades: 4, staggerFarCascades: true, terrainEvery: 6, cloudEvery: 2,
    bloomLevels: 5, smudge: true, ao: true, rays: true, motionBlur: true,
    sceneDepthFormat: 'rgba16float', temporalUpscale: false, maxImage: 4096,
    floraReach: 0.85, floraShadows: 2,
    maxPixelRatio: 1.5, startScale: 0.9, minScale: 0.5, budget: 14,
  },
  // (what Seven Havens drew everywhere before it had profiles)
  rtx5090: {
    label: 'RTX 5090 · Maximum', phone: false, msaa: 4,
    shadowPx: 2048, terrainShadowPx: 1024, cascades: 4, staggerFarCascades: false, terrainEvery: 1, cloudEvery: 1,
    bloomLevels: 6, smudge: true, ao: true, rays: true, motionBlur: true,
    sceneDepthFormat: 'rgba16float', temporalUpscale: false, maxImage: 8192,
    floraReach: 1, floraShadows: 2,
    maxPixelRatio: 1.5, startScale: 1, minScale: 1, budget: 0,
  },
};

/** a best-effort renderer name: Chrome gives the Apple chip or the NVIDIA board through ANGLE (boulder's) */
function rendererName() {
  if (typeof document === 'undefined') return '';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '') : String(gl.getParameter(gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return r;
  } catch { return ''; }
}

/** the nearest profile to this device (boulder's detectProfile): a phone by its browser and screen, a desktop GPU by
 *  its name, an unknown one the middle */
export function detectProfile(): { name: ProfileName; renderer: string; reason: string } {
  const asked = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('profile');
  if (asked && asked in PROFILES) return { name: asked as ProfileName, renderer: '', reason: '?profile' };
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const phone = /iPhone|iPod|iPad|Android/i.test(ua)
    || (typeof screen !== 'undefined' && typeof matchMedia !== 'undefined' && Math.min(screen.width, screen.height) < 600 && matchMedia('(pointer: coarse)').matches);
  if (phone) return { name: 'iphone16', renderer: '', reason: 'mobile browser and compact coarse-pointer screen' };
  const renderer = rendererName();
  if (/RTX\s*(?:5090|4090|5080|4080)\b/i.test(renderer)) return { name: 'rtx5090', renderer, reason: 'a high-end NVIDIA card' };
  if (/Apple M[2-9]\b/i.test(renderer)) return { name: 'm5air', renderer, reason: 'Apple M2 or later' };
  if (/Apple/i.test(renderer) || /Macintosh|Mac OS X/i.test(ua)) return { name: 'm1pro16', renderer, reason: 'Apple, M1 or the chip unnamed' };
  const nav = typeof navigator === 'undefined' ? null : (navigator as Navigator & { deviceMemory?: number });
  const memory = nav?.deviceMemory ?? 0, cores = nav?.hardwareConcurrency ?? 0;
  if ((memory && memory <= 8) || (cores && cores <= 8)) return { name: 'm1pro16', renderer, reason: 'little browser memory or few cores' };
  return { name: 'm5air', renderer, reason: 'an unknown desktop GPU' };
}

export const detected = detectProfile();
export const tier: Profile = { ...PROFILES[detected.name] };
