// Kepler's third law, from the orbits the view draws: each planet's year against its distance from the Sun on log
// axes — the planets' from the JPL elements the solar system is placed with (cosmos/frames.ts PLANETS: the semi-major
// axis, and the year from the rate of the mean longitude), the dwarf planets' and Ceres's from data/orbits/orbits.json
// (JPL's small-body database). On log axes "the square of the year goes as the cube of the distance" is a straight
// line of slope 3/2.
import { PLANETS } from '../../cosmos/frames';
import { INK, logTicks, fmtNum, type Make } from './index';

const make: Make = async (p, ctx) => {
  const pts: { name: string; a: number; P: number; dwarf: boolean }[] = PLANETS.map((q) => ({ name: q.name, a: q.el[0], P: 36000 / q.d[3], dwarf: false }));
  try {
    const j = await fetch(`${ctx.base}data/orbits/orbits.json`).then((r) => r.json()) as { smallBodies: { items: { name: string; a_AU: number; period_days: number }[] } };
    for (const b of j.smallBodies.items) if (b.a_AU && b.period_days) pts.push({ name: b.name, a: b.a_AU, P: b.period_days / 365.25, dwarf: true });
  } catch { /* the planets alone */ }
  // how far each falls from the line, at worst
  const worst = Math.max(...pts.map((q) => Math.abs(q.P / q.a ** 1.5 - 1)));
  p.out.textContent = `Every one of the ${pts.length} lies on the line to within ${(worst * 100).toFixed(1)}%: a year in years is the distance in AU to the power 3/2.`;
  const A0 = 0.25, A1 = 120, P0 = 0.1, P1 = 1500;
  return {
    draw() {
      const g = p.g, W = p.w, H = p.h, L = 40, R = 12, T = 10, B = 30;
      p.clear();
      const X = (a: number) => L + (Math.log10(a / A0) / Math.log10(A1 / A0)) * (W - L - R);
      const Y = (P: number) => H - B - (Math.log10(P / P0) / Math.log10(P1 / P0)) * (H - T - B);
      g.strokeStyle = INK.line; g.lineWidth = 1;
      for (const a of logTicks(A0, A1)) { g.beginPath(); g.moveTo(X(a), T); g.lineTo(X(a), H - B); g.stroke(); p.text(`${fmtNum(a)}`, X(a), H - B + 13, { align: 'center', size: 9.5, font: 'mono', color: INK.faint }); }
      for (const P of logTicks(P0, P1)) { g.beginPath(); g.moveTo(L, Y(P)); g.lineTo(W - R, Y(P)); g.stroke(); p.text(`${fmtNum(P)}`, L - 5, Y(P) + 3, { align: 'right', size: 9.5, font: 'mono', color: INK.faint }); }
      p.text('distance from the Sun (AU)', (L + W - R) / 2, H - 4, { align: 'center', size: 10 });
      g.save(); g.translate(11, (T + H - B) / 2); g.rotate(-Math.PI / 2); p.text('one year (Earth years)', 0, 0, { align: 'center', size: 10 }); g.restore();
      // the line: P = a^(3/2)
      g.strokeStyle = 'rgba(179,166,255,0.7)'; g.lineWidth = 1.4; g.setLineDash([5, 4]);
      g.beginPath(); g.moveTo(X(A0), Y(A0 ** 1.5)); g.lineTo(X(A1), Y(A1 ** 1.5)); g.stroke(); g.setLineDash([]);
      p.text('slope 3/2', X(0.5), Y(0.5 ** 1.5) - 8, { size: 10, color: INK.violet });
      for (const q of pts) {
        const x = X(q.a), y = Y(q.P);
        g.fillStyle = q.dwarf ? INK.dim : INK.accent;
        g.beginPath(); g.arc(x, y, q.dwarf ? 2.6 : 3.6, 0, Math.PI * 2); g.fill();
        // (names alternate sides, so the outer crowd doesn't overlap)
        const left = q.dwarf && q.a > 40 && q.name !== 'Eris';
        p.text(q.name, x + (left ? -7 : 7), y + (q.dwarf ? 11 : -5), { size: 10, color: q.dwarf ? INK.dim : INK.ink, align: left ? 'right' : 'left' });
      }
    },
  };
};
export default make;
