// Tonight's Moon, from the page's own ephemeris (cosmos/frames.ts: the Earth on its JPL elements, the Moon on a mean
// orbit), for the moment the view is placed at: how far round it is from the Sun as the Earth sees it, so how much of
// its face is lit and whether it's waxing or waning, drawn as it would look and from above (the Sun off to the left),
// and the light-time to it and to the Sun. A mean orbit leaves the Moon's place up to about six degrees out: the
// phase is right to within about half a day.
import { PLANETS, planetPos, moonPos, AU } from '../../cosmos/frames';
import { INK, type Make } from './index';

const NAMES: [number, string][] = [[0.03, 'New moon'], [0.35, 'crescent'], [0.65, 'quarter'], [0.97, 'gibbous'], [1.01, 'Full moon']];

const make: Make = async (p, ctx) => {
  const L = ctx.cosmos.ladder, d = L.day;
  const earth = planetPos(PLANETS[2], d, [0, 0, 0]), moon = moonPos(d, [0, 0, 0]);
  const sun = [-earth[0], -earth[1], -earth[2]];
  const len = (v: ArrayLike<number>) => Math.hypot(v[0], v[1], v[2]);
  const cosE = (moon[0] * sun[0] + moon[1] * sun[1] + moon[2] * sun[2]) / (len(moon) * len(sun));
  const E = Math.acos(Math.max(-1, Math.min(1, cosE)));
  const lit = (1 - cosE) / 2;
  // (ecliptic longitudes: the frame's x, −z)
  const lon = (v: ArrayLike<number>) => Math.atan2(-v[2], v[0]);
  let dl = lon(moon) - lon(sun);
  while (dl < 0) dl += Math.PI * 2;
  const waxing = dl < Math.PI;
  const kind = NAMES.find(([t]) => lit <= t)![1];
  const name = kind === 'New moon' || kind === 'Full moon' ? kind : kind === 'quarter' ? (waxing ? 'First quarter' : 'Last quarter') : `${waxing ? 'Waxing' : 'Waning'} ${kind}`;
  const moonS = len(moon) / 299792.458, sunS = (len(earth) * AU) / 299792458;
  const when = new Date(Date.UTC(2000, 0, 1, 12) + d * 86400000);
  p.out.innerHTML = `<b>${name}</b>, ${Math.round(lit * 100)}% lit, ${Math.round((E * 180) / Math.PI)}° from the Sun in our sky (${when.toUTCString().slice(5, 22)} UTC, the moment the view shows). Its light takes <b>${moonS.toFixed(2)} s</b> to reach us; the Sun's, <b>${Math.floor(sunS / 60)} min ${Math.round(sunS % 60)} s</b>.`;
  return {
    draw() {
      const g = p.g, W = p.w, H = p.h;
      p.clear();
      // the Moon as it looks (waxing lit on the right, as from the north)
      const r = Math.min(H * 0.36, W * 0.2), cx = W * 0.27, cy = H * 0.46, side = waxing ? 1 : -1;
      const grad = g.createRadialGradient(cx - r * 0.2, cy - r * 0.25, r * 0.1, cx, cy, r);
      g.fillStyle = 'rgba(244,237,230,0.06)';
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      grad.addColorStop(0, '#f1ebe2'); grad.addColorStop(1, '#a9a196');
      g.fillStyle = grad;
      g.beginPath();
      for (let i = 0; i <= 48; i++) { const t = -Math.PI / 2 + (i / 48) * Math.PI; g.lineTo(cx + side * r * Math.cos(t), cy + r * Math.sin(t)); }
      for (let i = 48; i >= 0; i--) { const t = -Math.PI / 2 + (i / 48) * Math.PI; g.lineTo(cx + side * r * Math.cos(t) * cosE, cy + r * Math.sin(t)); }
      g.fill();
      g.strokeStyle = INK.line; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      p.text('as it looks', cx, cy + r + 18, { align: 'center', size: 10, color: INK.dim });
      // from above: the Earth, the Moon's orbit, the Sun's light from the left
      const ox = W * 0.72, oy = cy, R = Math.min(H * 0.34, W * 0.19);
      g.strokeStyle = INK.line; g.setLineDash([3, 4]); g.beginPath(); g.arc(ox, oy, R, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      for (let k = -1; k <= 1; k++) { g.strokeStyle = 'rgba(255,179,138,0.45)'; g.beginPath(); g.moveTo(ox - R - 46, oy + k * 16); g.lineTo(ox - R - 18, oy + k * 16); g.stroke(); }
      p.text('sunlight', ox - R - 32, oy - 26, { align: 'center', size: 10, color: INK.accent });
      g.fillStyle = '#5b86d6'; g.beginPath(); g.arc(ox, oy, 6, 0, Math.PI * 2); g.fill();
      // (the Moon's angle round the Earth from the Sun's direction, counter-clockwise from above the north)
      const a = Math.PI + (waxing ? -E : E);
      const mx = ox + R * Math.cos(a), my = oy + R * Math.sin(a);
      g.fillStyle = '#d9d2c7'; g.beginPath(); g.arc(mx, my, 4.5, 0, Math.PI * 2); g.fill();
      p.text('from above', ox, cy + r + 18, { align: 'center', size: 10, color: INK.dim });
    },
  };
};
export default make;
