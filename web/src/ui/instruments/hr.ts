// The Hertzsprung–Russell diagram, from the catalogue the sky is drawn from (data/sky/stars6.bin and stars8.bin, their
// layout in stars.json): every star by its colour (B−V) and its true brightness, the absolute magnitude from its V and
// its distance (M = V + 5 − 5 log10 d). Stars whose distance is only a bound, or whose colour was estimated, are left
// out. The Sun marked, the main sequence and the giants named, a few stars of the story found on it.
import { INK, type Make } from './index';

/** the stars named on it, and which side of their dot the name goes (x, y in px) */
const NAMED: [number, string, number, number][] = [[32349, 'Sirius', -8, 4], [27989, 'Betelgeuse', -8, -6], [91262, 'Vega', 8, 10], [69673, 'Arcturus', 8, 12], [24436, 'Rigel', 8, 12], [102098, 'Deneb', 8, -4], [80763, 'Antares', -8, 14]];
const BV0 = -0.4, BV1 = 2.1, M0 = -9, M1 = 16;

const make: Make = async (p, ctx) => {
  const files = await Promise.all(['stars6.bin', 'stars8.bin'].map((f) => fetch(`${ctx.base}data/sky/${f}`).then((r) => { if (!r.ok) throw new Error(f); return r.arrayBuffer(); })));
  // (bv, M) pairs, and the named stars' places
  const pts: number[] = [];
  const named = new Map<number, [number, number]>();
  for (const buf of files) {
    const f = new Float32Array(buf), u = new Uint32Array(buf), n = buf.byteLength / 24;
    for (let i = 0; i < n; i++) {
      const o = i * 6, flags = u[o + 5];
      if (flags & 0xc0000000) continue;
      const d = Math.hypot(f[o], f[o + 1], f[o + 2]);
      if (!(d > 0)) continue;
      const M = f[o + 3] + 5 - 5 * Math.log10(d), bv = f[o + 4];
      pts.push(bv, M);
      const hip = flags & 0xffffff;
      for (const [h] of NAMED) if (h === hip) named.set(h, [bv, M]);
    }
  }
  const count = pts.length / 2;
  p.out.innerHTML = `${count.toLocaleString('en')} stars of the Hipparcos catalogue to V 8, each where its own colour and distance put it.`;

  return {
    draw() {
      const g = p.g, W = p.w, H = p.h;
      p.clear();
      const L = 34, R = 10, T = 12, B = 30;
      const X = (bv: number) => L + ((bv - BV0) / (BV1 - BV0)) * (W - L - R);
      const Y = (M: number) => T + ((M - M0) / (M1 - M0)) * (H - T - B);
      // axes
      g.strokeStyle = INK.line; g.lineWidth = 1;
      g.beginPath(); g.moveTo(L, T); g.lineTo(L, H - B); g.lineTo(W - R, H - B); g.stroke();
      for (let M = -5; M <= 15; M += 5) { p.text(String(M), L - 6, Y(M) + 3, { align: 'right', size: 9.5, font: 'mono', color: INK.faint }); g.beginPath(); g.moveTo(L - 3, Y(M)); g.lineTo(L, Y(M)); g.stroke(); }
      for (const bv of [0, 0.5, 1, 1.5, 2]) { p.text(String(bv), X(bv), H - B + 13, { align: 'center', size: 9.5, font: 'mono', color: INK.faint }); }
      p.text('blue  ← colour, B−V →  red', (L + W - R) / 2, H - 4, { align: 'center', size: 10, color: INK.dim });
      g.save(); g.translate(10, (T + H - B) / 2); g.rotate(-Math.PI / 2); p.text('brighter ↑   absolute magnitude', 0, 0, { align: 'center', size: 10, color: INK.dim }); g.restore();
      // the stars: each a faint dot in its own colour, so where they crowd it builds up
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < count; i++) {
        const bv = pts[i * 2], M = pts[i * 2 + 1];
        if (bv < BV0 || bv > BV1 || M < M0 || M > M1) continue;
        const t = Math.max(0, Math.min(1, (bv + 0.3) / 2));
        const r = Math.round(150 + 105 * Math.min(1, t * 1.6)), gg = Math.round(170 + 60 * (1 - Math.abs(t - 0.45) * 1.6)), b = Math.round(255 - 150 * t);
        g.fillStyle = `rgba(${r},${gg},${b},0.16)`;
        g.fillRect(X(bv) - 0.6, Y(M) - 0.6, 1.2, 1.2);
      }
      g.globalCompositeOperation = 'source-over';
      // the regions, named
      p.text('Main sequence', X(-0.33), Y(7.2), { size: 11, color: INK.ink, weight: 600 });
      p.text('where a star spends', X(-0.33), Y(7.2) + 13, { size: 9.5, color: INK.dim });
      p.text('most of its life', X(-0.33), Y(7.2) + 25, { size: 9.5, color: INK.dim });
      p.text('Giants', X(1.45), Y(3.2), { size: 11, color: INK.ink, weight: 600 });
      p.text('Supergiants', X(0.55), Y(-7.6), { size: 11, color: INK.ink, weight: 600 });
      // the named stars, and the Sun
      const dot = (bv: number, M: number, name: string, dx: number, dy: number, c = INK.accent) => {
        g.strokeStyle = c; g.lineWidth = 1.2;
        g.beginPath(); g.arc(X(bv), Y(M), 4.5, 0, Math.PI * 2); g.stroke();
        p.text(name, X(bv) + dx, Y(M) + dy, { size: 10, color: c, align: dx > 0 ? 'left' : 'right', weight: 600 });
      };
      for (const [h, n, dx, dy] of NAMED) { const s = named.get(h); if (s) dot(s[0], s[1], n, dx, dy, INK.ink); }
      dot(0.65, 4.83, 'The Sun', 8, 14);
    },
  };
};
export default make;
