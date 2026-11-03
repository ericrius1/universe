// The renderer's construction-time knobs, read once as things are built (shadows.ts, clouds.ts, main.ts, post.ts,
// fx.ts, textures.ts, arch.ts, flora.ts, the fluid): the device's profile, as boulder picks them (its
// util/profiles.ts: the same names, the same guess at the device), with the knobs Seven Havens has. A phone draws
// without MSAA (on a tile GPU the post chain's read of a multisampled depth buffer has it written out every frame:
// boulder ran 11-15 fps with it, 30 without; the final pass blends edges instead, post.ts EDGE_AA), ambient occlusion,
// shafts, the contour smudge or motion blur, its shadows smaller and fewer, the buildings' textures at 512 px and the
// flora's levels nearer, at 30 fps and a lower resolution held to its frame budget (util/autores.ts); and no backdrop
// blur on the interface (WebKit blurs what's under every blurred element each frame: 13 ms of boulder's 55 ms frame on
// the 16e). A desktop GPU draws all of it. ?profile=iphone16|m1pro16|m5air|rtx5090 picks one (phone and desktop too:
// the iPhone's and the M5's); ?msaa=0|4 the scene's samples.

export type ProfileName = 'iphone16' | 'm1pro16' | 'm5air' | 'rtx5090';

export interface Profile {
  label: string;
  /** a phone: the phone-only economies on (prints' reach, post's edge AA, clouds' cadence) and the touch controls'
   *  defaults */
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
  /** an image's largest side kept on the GPU (px); the buildings' material textures (px a side) */
  maxImage: number;
  archTexPx: number;
  /** the buildings' pieces culled on the GPU (arch/cull.ts: their draws indirect, in render bundles, behind the
   *  occluders' pyramid) rather than on the CPU. Never in WebKit (Safari, every browser on an iPhone): at the gardens
   *  an iPhone 16e drew a frame in 86-137 ms with it, 27 ms culled on the CPU */
  gpuCull: boolean;
  /** the flora's levels' distances, scaled (flora.ts settings.quality); the cascades it casts into */
  floraReach: number;
  floraShadows: number;
  /** the canvas's device pixels a CSS pixel at most; the render's share of them to begin with and at least; the GPU's
   *  frame budget (ms) the resolution is held to (util/autores.ts; 0: fixed); the frame rate held (0: every animation
   *  frame) */
  maxPixelRatio: number;
  startScale: number;
  minScale: number;
  budget: number;
  frameCap: number;
}

export const PROFILES: Record<ProfileName, Profile> = {
  iphone16: {
    label: 'iPhone 16', phone: true, msaa: 1,
    shadowPx: 1024, terrainShadowPx: 512, cascades: 3, staggerFarCascades: true, terrainEvery: 12, cloudEvery: 3,
    bloomLevels: 4, smudge: false, ao: false, rays: false, motionBlur: false,
    sceneDepthFormat: 'rgba16float', temporalUpscale: false, maxImage: 2048, archTexPx: 512, gpuCull: false,
    floraReach: 0.5, floraShadows: 1,
    maxPixelRatio: 2, startScale: 0.7, minScale: 0.45, budget: 24, frameCap: 30,
  },
  m1pro16: {
    label: 'M1 Pro · 16 GB', phone: false, msaa: 4,
    shadowPx: 1024, terrainShadowPx: 1024, cascades: 4, staggerFarCascades: true, terrainEvery: 8, cloudEvery: 2,
    bloomLevels: 5, smudge: true, ao: true, rays: true, motionBlur: true,
    sceneDepthFormat: 'rgba16float', temporalUpscale: false, maxImage: 4096, archTexPx: 1024, gpuCull: true,
    floraReach: 0.75, floraShadows: 2,
    maxPixelRatio: 1.5, startScale: 0.8, minScale: 0.5, budget: 14, frameCap: 0,
  },
  m5air: {
    label: 'M5 Air', phone: false, msaa: 4,
    shadowPx: 1280, terrainShadowPx: 1024, cascades: 4, staggerFarCascades: true, terrainEvery: 6, cloudEvery: 2,
    bloomLevels: 5, smudge: true, ao: true, rays: true, motionBlur: true,
    sceneDepthFormat: 'rgba16float', temporalUpscale: false, maxImage: 4096, archTexPx: 1024, gpuCull: true,
    floraReach: 0.85, floraShadows: 2,
    maxPixelRatio: 1.5, startScale: 0.9, minScale: 0.5, budget: 14, frameCap: 0,
  },
  // (what Seven Havens drew everywhere before it had profiles)
  rtx5090: {
    label: 'RTX 5090 · Maximum', phone: false, msaa: 4,
    shadowPx: 2048, terrainShadowPx: 1024, cascades: 4, staggerFarCascades: false, terrainEvery: 1, cloudEvery: 1,
    bloomLevels: 6, smudge: true, ao: true, rays: true, motionBlur: true,
    sceneDepthFormat: 'rgba16float', temporalUpscale: false, maxImage: 8192, archTexPx: 1024, gpuCull: true,
    floraReach: 1, floraShadows: 2,
    maxPixelRatio: 1.5, startScale: 1, minScale: 1, budget: 0, frameCap: 0,
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

/** a phone (or a tablet), by its user agent, or by a coarse pointer on a small screen (in a worker: by its user agent
 *  alone) */
export function looksLikePhone() {
  if (typeof navigator === 'undefined') return false;
  if (/iPhone|iPod|iPad|Android/i.test(navigator.userAgent)) return true;
  if (typeof screen === 'undefined' || typeof matchMedia === 'undefined') return false;
  return Math.min(screen.width, screen.height) < 600 && matchMedia('(pointer: coarse)').matches;
}

/** the nearest profile to this device (boulder's detectProfile): a phone by its browser and screen, a desktop GPU by
 *  its name, an unknown one the middle */
export function detectProfile(): { name: ProfileName; renderer: string; reason: string } {
  const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  const asked = params.get('profile') ?? params.get('tier');
  if (asked && asked in PROFILES) return { name: asked as ProfileName, renderer: '', reason: '?profile' };
  if (asked === 'phone') return { name: 'iphone16', renderer: '', reason: '?profile=phone' };
  if (asked === 'desktop' || asked === 'full') return { name: 'm5air', renderer: '', reason: '?profile=desktop' };
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (looksLikePhone()) return { name: 'iphone16', renderer: '', reason: 'mobile browser and compact coarse-pointer screen' };
  const renderer = rendererName();
  if (/RTX\s*(?:5090|4090|5080|4080)\b/i.test(renderer)) return { name: 'rtx5090', renderer, reason: 'a high-end NVIDIA card' };
  if (/Apple M[2-9]\b/i.test(renderer)) return { name: 'm5air', renderer, reason: 'Apple M2 or later' };
  if (/Apple/i.test(renderer) || /Macintosh|Mac OS X/i.test(ua)) return { name: 'm1pro16', renderer, reason: 'Apple, M1 or the chip unnamed' };
  const nav = typeof navigator === 'undefined' ? null : (navigator as Navigator & { deviceMemory?: number });
  const memory = nav?.deviceMemory ?? 0, cores = nav?.hardwareConcurrency ?? 0;
  if ((memory && memory <= 8) || (cores && cores <= 8)) return { name: 'm1pro16', renderer, reason: 'little browser memory or few cores' };
  return { name: 'm5air', renderer, reason: 'an unknown desktop GPU' };
}

/** WebKit (Safari, and every browser on an iPhone or iPad: Chrome's there is CriOS, without Chrome's own token) */
export const webkit = typeof navigator !== 'undefined' && /AppleWebKit/.test(navigator.userAgent) && !/Chrome\/|Chromium|Edg\//.test(navigator.userAgent);

export const detected = detectProfile();
export const tier: Profile = { ...PROFILES[detected.name] };
{
  const msaa = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('msaa');
  if (msaa === '0' || msaa === '4') tier.msaa = msaa === '4' ? 4 : 1;
  if (webkit) tier.gpuCull = false;
}

if (tier.phone && typeof document !== 'undefined') {
  document.documentElement.classList.add('tier-phone');
  const st = document.createElement('style');
  st.textContent = 'html.tier-phone *, html.tier-phone *::before, html.tier-phone *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }';
  document.head.appendChild(st);
}
