// The oldest light's scale: a piece of Planck's map itself (data/cmb/smica_4k.webp, the 2015 SMICA map: one byte a
// pixel, ±500 µK about the mean, smica.json), a patch of sky 24 degrees by 14 well away from the galaxy's plane,
// coloured as the view colours it (c_web.wgsl's warm and cool), the full Moon drawn on it at its true size (0.52°), and
// the scale: what the colours mean in degrees above absolute zero.
import { INK, type Make } from './index';

// the patch: galactic longitude and latitude of its middle, its size (degrees)
const L0 = 240, B0 = -55, WD = 24, HD = 14;
const T0 = 2.72548;   // the mean (Fixsen 2009)
const MOON = 0.52;

const make: Make = async (p, ctx) => {
  const img = new Image();
  img.decoding = 'async';
  img.src = `${ctx.base}data/cmb/smica_4k.webp`;
  await img.decode();
  // (plate carrée: u = (180 − l) / 360, v = (90 − b) / 180; l grows to the left)
  const S = img.width / 360;
  const sw = Math.round(WD * S), sh = Math.round(HD * S);
  const sx = Math.round(((180 - (L0 + WD / 2) + 720) % 360) * S), sy = Math.round((90 - (B0 + HD / 2)) * S);
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const g0 = c.getContext('2d', { willReadFrequently: true })!;
  g0.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const px = g0.getImageData(0, 0, sw, sh);
  const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // (the view's warm and cool, c_web.wgsl's, darkest at the mean so the patches read)
  const colour = (v: number) => {
    const k = ss(-0.4, 0.4, v), b = 0.18 + 0.82 * Math.min(1, Math.abs(v) * 2.2);
    return [0.12 + 0.88 * k, 0.35 + 0.07 * k, 1 - 0.88 * k].map((x) => Math.round(255 * Math.pow(Math.min(1, x * b), 1 / 2.2)));
  };
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < px.data.length; i += 4) {
    const T = ((px.data[i] - 127.5) / 127.5) * 500;
    lo = Math.min(lo, T); hi = Math.max(hi, T);
    const col = colour(T / 500);
    px.data[i] = col[0]; px.data[i + 1] = col[1]; px.data[i + 2] = col[2]; px.data[i + 3] = 255;
  }
  g0.putImageData(px, 0, 0);
  p.out.innerHTML = `This patch runs from <b>${Math.round(lo)}</b> to <b>+${Math.round(hi)}</b> millionths of a degree about ${T0} K: the warmest spot in it is ${(T0 + hi * 1e-6).toFixed(5)} K, the coolest ${(T0 + lo * 1e-6).toFixed(5)} K. A patch is nearly two full Moons across.`;
  return {
    draw() {
      const g = p.g, W = p.w, H = p.h, B = 40;
      p.clear();
      const k = Math.min(W / WD, (H - B - 6) / HD), mw = WD * k, mh = HD * k;
      g.save(); g.translate((W - mw) / 2, 0);
      g.imageSmoothingEnabled = true;
      g.drawImage(c, 0, 0, mw, mh);
      // the full Moon to scale
      const mx = mw * 0.78, my = mh * 0.3;
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 3.5;
      g.beginPath(); g.arc(mx, my, (MOON / 2) * k, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 1.6;
      g.beginPath(); g.arc(mx, my, (MOON / 2) * k, 0, Math.PI * 2); g.stroke();
      p.text('the full Moon', mx, my + (MOON / 2) * k + 13, { align: 'center', size: 10, color: INK.ink, weight: 600 });
      // a degree
      g.strokeStyle = INK.ink; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(10, mh - 10); g.lineTo(10 + k, mh - 10); g.stroke();
      p.text('1°', 10 + k / 2, mh - 15, { align: 'center', size: 10, color: INK.ink, weight: 600 });
      g.restore();
      // the colour scale
      const y = mh + 10, x0 = 34, x1 = W - 34;
      for (let i = 0; i <= 100; i++) {
        const col = colour((i / 100) * 2 - 1);
        g.fillStyle = `rgb(${col.join(',')})`;
        g.fillRect(x0 + ((x1 - x0) * i) / 101, y, (x1 - x0) / 100 + 1, 8);
      }
      p.text('−500 µK', x0, y + 22, { align: 'center', size: 9.5, font: 'mono', color: INK.dim });
      p.text(`${T0} K`, (x0 + x1) / 2, y + 22, { align: 'center', size: 9.5, font: 'mono', color: INK.ink });
      p.text('+500 µK', x1, y + 22, { align: 'center', size: 9.5, font: 'mono', color: INK.dim });
    },
  };
};
export default make;
