// How high: the view's distance from the ground as it comes down (the cosmos's camera: cosmos/controls.ts, log10 of
// metres), on a ruler of powers of ten against things that fly there or stand that tall — the GPS satellites at
// 20,200 km, the space station at about 410, the edge of space at 100 (the Kármán line), an airliner at 11, Everest's
// top at 8,849 m, a tall building at 830 (the Burj Khalifa). Redrawn only when the height has moved.
import { INK, fmtNum, type Make } from './index';

const MARKS: [number, string][] = [
  [20200e3, 'GPS satellites'], [410e3, 'The space station'], [100e3, 'The edge of space'], [11e3, 'An airliner'], [8849, 'Everest\'s top'],
  [828, 'The tallest building'], [1.7, 'A person'],
];
const TOP = 8, BOT = 0;   // the ruler's ends, log10 m (100,000 km to 1 m)

const fmt = (m: number) => (m >= 1e3 ? `${fmtNum(m / 1e3)} km` : `${fmtNum(m)} m`);

const make: Make = async (p, ctx) => {
  let shown = NaN;
  const height = () => { const l = ctx.logS(); return l === null ? null : Math.pow(10, l); };
  const say = (h: number | null) => {
    if (h === null) { p.out.textContent = 'The view is in the cell: far below the ground.'; return; }
    const near = MARKS.find(([m]) => m <= h * 1.05);
    p.out.innerHTML = `The view is <b>${fmt(h)}</b> from the ground${near && h < 4e7 ? `: ${h > near[0] * 1.3 ? 'above' : 'about as high as'} ${near[1].toLowerCase()}` : ''}.`;
  };
  const view = {
    draw() {
      const g = p.g, W = p.w, H = p.h, T = 12, B = 12, x0 = 64;
      p.clear();
      const Y = (m: number) => T + ((TOP - Math.log10(Math.max(m, 1))) / (TOP - BOT)) * (H - T - B);
      g.strokeStyle = INK.line; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x0, T); g.lineTo(x0, H - B); g.stroke();
      for (let e = BOT; e <= TOP; e++) {
        g.beginPath(); g.moveTo(x0 - 4, Y(10 ** e)); g.lineTo(x0, Y(10 ** e)); g.stroke();
        p.text(fmt(10 ** e), x0 - 8, Y(10 ** e) + 3, { align: 'right', size: 9.5, font: 'mono', color: INK.faint });
      }
      for (const [m, n] of MARKS) {
        const y = Y(m);
        g.strokeStyle = 'rgba(179,166,255,0.55)'; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + 16, y); g.stroke();
        p.text(`${n} · ${fmt(m)}`, x0 + 22, y + 3.5, { size: 10.5, color: INK.ink });
      }
      const h = height();
      shown = h ?? -1;
      say(h);
      if (h === null) return;
      const y = Y(Math.min(Math.max(h, 1), 10 ** TOP));
      g.fillStyle = INK.accent;
      g.beginPath(); g.moveTo(x0 - 1, y); g.lineTo(x0 - 10, y - 5); g.lineTo(x0 - 10, y + 5); g.closePath(); g.fill();
      g.strokeStyle = INK.accent; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x0, y); g.lineTo(W - 8, y); g.stroke();
      p.text('the view', W - 8, y - 4, { align: 'right', size: 10, color: INK.accent, weight: 600 });
    },
    tick() {
      const h = height() ?? -1;
      if (Math.abs(Math.log10(Math.max(h, 1e-9)) - Math.log10(Math.max(shown, 1e-9))) > 0.004) view.draw();
    },
  };
  return view;
};
export default make;
