// How far, how long ago: for one galaxy of the 2MASS Redshift Survey (data/galaxies/2mrs.bin), the speed its redshift
// says it's going away (2mrs.json: its distance is that speed over H0 = 70 km/s per Mpc, so the speed is back out of it
// exactly), that distance, how long its light has been on its way (in a flat universe of 30% matter and 70% dark energy,
// H0 = 70: the time the light took, integrated over the redshift), and what was happening on Earth when it set out.
// Behind it, how many of the survey's galaxies lie at each distance. A galaxy can be chosen on that strip or at random;
// tapping one in the view comes when the galaxies there can be told apart (levels/web.ts).
import { INK, fmtNum, type Make } from './index';

const H0 = 70, C = 299792.458, OM = 0.3, OL = 0.7;
const MLY_PER_MPC = 3.26156;
/** the time light from redshift z has travelled (millions of years) */
function lookback(z: number) {
  const n = 200, hub = 977.79 / H0;  // 1/H0 in Gyr
  let s = 0;
  for (let i = 0; i < n; i++) { const x = ((i + 0.5) / n) * z; s += 1 / ((1 + x) * Math.sqrt(OM * (1 + x) ** 3 + OL)); }
  return (s * (z / n)) * hub * 1000;
}
/** what was going on on the Earth so many million years ago (the International Chronostratigraphic Chart, 2023) */
const EARTH: [number, string][] = [
  [0.3, 'People like us were already living in Africa.'],
  [2.6, 'Early humans were making the first stone tools. The ice ages had begun.'],
  [7, 'Our ancestors and the chimpanzees\' had not long parted ways.'],
  [66, 'The dinosaurs were gone, and mammals were spreading over the land.'],
  [230, 'Dinosaurs walked the Earth.'],
  [252, 'Life was coming back from the worst extinction there has been.'],
  [359, 'Swamp forests were laying down the world\'s coal. The first reptiles were walking.'],
  [419, 'Fish ruled the seas, and the first of them were crawling onto land.'],
  [539, 'The seas were filling with animals. The first plants were reaching the shore.'],
  [1e9, 'There were no animals yet bigger than a speck. Life was cells, mats and seaweeds.'],
];
const then = (myr: number) => EARTH.find(([t]) => myr <= t)![1];

const make: Make = async (p, ctx) => {
  const buf = await fetch(`${ctx.base}data/galaxies/2mrs.bin`).then((r) => { if (!r.ok) throw new Error('2mrs'); return r.arrayBuffer(); });
  const f = new Float32Array(buf), u = new Uint32Array(buf), n = buf.byteLength / 20;
  // each galaxy's distance (Mpc), redshift distances only (flags 1 and 2: a measured distance, or put at 1 Mpc)
  const D: number[] = [];
  for (let i = 0; i < n; i++) { if ((u[i * 5 + 4] >> 8) & 3) continue; D.push(Math.hypot(f[i * 5], f[i * 5 + 1], f[i * 5 + 2])); }
  const sorted = Float64Array.from(D).sort();
  const DMAX = Math.min(320, sorted[Math.floor(sorted.length * 0.995)] * 1.05);
  const BINS = 80, hist = new Array<number>(BINS).fill(0);
  for (const d of D) { const b = Math.floor((d / DMAX) * BINS); if (b >= 0 && b < BINS) hist[b]++; }
  const top = Math.max(...hist);
  let pick = D[Math.floor(D.length * 0.37)];
  const choose = (d: number) => { pick = d; readout(); view.draw(); };
  const random = () => choose(D[Math.floor(Math.random() * D.length)]);
  const readout = () => {
    const v = H0 * pick, z = v / C, t = lookback(z);
    p.out.innerHTML = `Its light is stretched ${(z * 100).toFixed(2)}% toward the red: going away at <b>${fmtNum(v)} km/s</b>, so about <b>${fmtNum(pick * MLY_PER_MPC)} million light-years</b> off. That light set out <b>${fmtNum(t)} million years ago</b>. ${then(t)}`;
  };
  p.button('Another galaxy', random);
  let L = 12, R = 12, W = 0;
  p.canvas.addEventListener('click', (e) => {
    const r = p.canvas.getBoundingClientRect();
    const d = ((e.clientX - r.left - L) / (W - L - R)) * DMAX;
    if (d <= 0 || d > DMAX) return;
    // (the galaxy nearest that distance)
    let lo = 0, hi = sorted.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < d) lo = m + 1; else hi = m; }
    choose(sorted[lo]);
  });
  p.canvas.style.cursor = 'pointer';
  const view = {
    draw() {
      const g = p.g, H = p.h, T = 22, B = 40;
      W = p.w; L = 12; R = 12;
      p.clear();
      const X = (d: number) => L + (d / DMAX) * (W - L - R);
      p.text(`${D.length.toLocaleString('en')} galaxies by their distance`, L, 12, { size: 10, color: INK.faint });
      const bw = (W - L - R) / BINS;
      g.fillStyle = 'rgba(179,166,255,0.45)';
      hist.forEach((c, i) => { const hh = (c / top) * (H - T - B); g.fillRect(L + i * bw + 0.5, H - B - hh, Math.max(1, bw - 1), hh); });
      g.strokeStyle = INK.line; g.beginPath(); g.moveTo(L, H - B); g.lineTo(W - R, H - B); g.stroke();
      for (let d = 0; d <= DMAX; d += 100) {
        p.text(`${fmtNum(d * MLY_PER_MPC)} Mly`, X(d), H - B + 13, { align: d === 0 ? 'left' : 'center', size: 9.5, font: 'mono', color: INK.faint });
        p.text(`${fmtNum(lookback((H0 * d) / C))} Myr ago`, X(d), H - B + 26, { align: d === 0 ? 'left' : 'center', size: 9.5, font: 'mono', color: INK.faint });
      }
      // (the Virgo Cluster's crowd, the first peak, and the chosen one)
      p.text('Virgo', X(16), H - B - (hist[Math.floor((16 / DMAX) * BINS)] / top) * (H - T - B) - 4, { align: 'center', size: 9.5, color: INK.dim });
      g.strokeStyle = INK.accent; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(X(pick), T - 4); g.lineTo(X(pick), H - B); g.stroke();
      g.fillStyle = INK.accent; g.beginPath(); g.arc(X(pick), T - 4, 3.5, 0, Math.PI * 2); g.fill();
    },
  };
  readout();
  return view;
};
export default make;
