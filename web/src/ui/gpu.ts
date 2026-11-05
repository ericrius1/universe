// How much GPU a computer has, the same guess in every project on ericlevin.dev (Boulder's util/profiles.ts and Seven
// Havens' util/tier.ts make it too, as their M1 Air profile). A light one is a base Apple M1 or M2 (a MacBook Air's, a
// 13" MacBook Pro's, a Mac mini's: half an M1 Pro's GPU, and a tile GPU, as a phone's is, that pays dearly for MSAA
// and for every full-screen pass), graphics on the processor (an Intel Mac's, a laptop's), or, where Safari names no
// chip, a Mac on a 13.3" 2560x1600 screen at any of its scalings (an M1's, or an Intel one's before it). A project
// draws a lighter picture there: fewer pixels and its dearest effects off, a phone's economies on a computer's
// interface. Never a phone's question: each project knows its own phone. ?gpu=light or ?gpu=full says which.
// Self-contained so each project carries a copy: the canonical one is PortfolioII/src/shared/gpu.ts.

/** the GPU's name as the browser gives it (Chrome: the Apple chip or the card, through ANGLE; Safari: "Apple GPU") */
export function rendererName(): string {
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

let light: boolean | null = null;

/** a light computer's GPU (asked once, then remembered for the page) */
export function lightGpu(): boolean {
  if (light !== null) return light;
  const asked = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('gpu');
  if (asked === 'light' || asked === 'full') return (light = asked === 'light');
  const r = rendererName();
  // (the base chips: their Pro, Max and Ultra have two to eight times the GPU)
  if (/Apple M[12](?!\s*(?:Pro|Max|Ultra))\b/i.test(r)) return (light = true);
  if (/Intel(?!.*\bArc\b)|Radeon(?:\(TM\))? Graphics|Vega \d+ Graphics/i.test(r)) return (light = true);
  if (/Apple M\d/i.test(r) || typeof screen === 'undefined') return (light = false);
  const mac = /Macintosh|Mac OS X/.test(navigator.userAgent) && navigator.maxTouchPoints < 2;
  return (light = mac && devicePixelRatio >= 2 && screen.width <= 1680 && Math.abs(screen.width / screen.height - 1.6) < 0.01);
}
