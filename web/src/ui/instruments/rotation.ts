// The Milky Way's rotation curve: how fast stars go round the centre at each distance from it. Measured: Eilers, Hogg,
// Rix & Ness 2019 (ApJ 871, 120), from about 23,000 red giants with APOGEE spectra and Gaia parallaxes: 229 km/s at the
// Sun, falling 1.7 km/s each kiloparsec out, from 5 to 25 kpc (drawn as their straight-line fit, with its few-percent
// systematic band). Against it, what the stars and gas we can see would give by themselves: a model, not a
// measurement — a stellar disc of 4.1e10 Suns (scale length 2.5 kpc), a gas disc of 1.2e10 (7 kpc) and a bulge of
// 1.5e10 (Hernquist, 0.7 kpc), masses after Bland-Hawthorn & Gerhard 2016 (ARA&A 54, 529), an exponential disc's
// speed as Freeman 1970 gives it. The gap between the two is what dark matter is for.
import { INK, type Make } from './index';

const G = 4.30091e-6;  // kpc (km/s)² per solar mass
const R0 = 8.122;      // the Sun's distance from the centre in Eilers et al. (kpc, GRAVITY 2018)

// modified Bessel functions (Abramowitz & Stegun 9.8.1–9.8.8)
function I0(x: number) { const t = x / 3.75; if (x <= 3.75) { const y = t * t; return 1 + y * (3.5156229 + y * (3.0899424 + y * (1.2067492 + y * (0.2659732 + y * (0.0360768 + y * 0.0045813))))); } const y = 1 / t; return Math.exp(x) / Math.sqrt(x) * (0.39894228 + y * (0.01328592 + y * (0.00225319 + y * (-0.00157565 + y * (0.00916281 + y * (-0.02057706 + y * (0.02635537 + y * (-0.01647633 + y * 0.00392377)))))))); }
function I1(x: number) { const t = x / 3.75; if (x <= 3.75) { const y = t * t; return x * (0.5 + y * (0.87890594 + y * (0.51498869 + y * (0.15084934 + y * (0.02658733 + y * (0.00301532 + y * 0.00032411)))))); } const y = 1 / t; return Math.exp(x) / Math.sqrt(x) * (0.39894228 + y * (-0.03988024 + y * (-0.00362018 + y * (0.00163801 + y * (-0.01031555 + y * (0.02282967 + y * (-0.02895312 + y * (0.01787654 - y * 0.00420059)))))))); }
function K0(x: number) { if (x <= 2) { const y = x * x / 4; return -Math.log(x / 2) * I0(x) + (-0.57721566 + y * (0.4227842 + y * (0.23069756 + y * (0.0348859 + y * (0.00262698 + y * (0.0001075 + y * 0.0000074)))))); } const y = 2 / x; return Math.exp(-x) / Math.sqrt(x) * (1.25331414 + y * (-0.07832358 + y * (0.02189568 + y * (-0.01062446 + y * (0.00587872 + y * (-0.0025154 + y * 0.00053208)))))); }
function K1(x: number) { if (x <= 2) { const y = x * x / 4; return Math.log(x / 2) * I1(x) + (1 / x) * (1 + y * (0.15443144 + y * (-0.67278579 + y * (-0.18156897 + y * (-0.01919402 + y * (-0.00110404 - y * 0.00004686)))))); } const y = 2 / x; return Math.exp(-x) / Math.sqrt(x) * (1.25331414 + y * (0.23498619 + y * (-0.0365562 + y * (0.01504268 + y * (-0.00780353 + y * (0.00325614 - y * 0.00068245)))))); }

const disc = (R: number, M: number, Rd: number) => { const y = R / (2 * Rd); return 4 * Math.PI * G * (M / (2 * Math.PI * Rd * Rd)) * Rd * y * y * (I0(y) * K0(y) - I1(y) * K1(y)); };
const bulge = (R: number, M: number, a: number) => G * M * R / ((R + a) * (R + a));
const visible = (R: number) => Math.sqrt(disc(R, 4.1e10, 2.5) + disc(R, 1.2e10, 7) + bulge(R, 1.5e10, 0.7));
const measured = (R: number) => 229 - 1.7 * (R - R0);

const make: Make = async (p) => {
  const vSun = visible(R0);
  p.out.innerHTML = `At the Sun: <b>229 km/s</b> measured; the stars and gas we see would hold only about <b>${Math.round(vSun)}</b>. At 25 kpc it's ${Math.round(measured(25))} against ${Math.round(visible(25))}: the light runs out long before the speed does.`;
  return {
    draw() {
      const g = p.g, W = p.w, H = p.h, L = 36, Rm = 12, T = 12, B = 30;
      p.clear();
      const X = (R: number) => L + (R / 26) * (W - L - Rm);
      const Y = (v: number) => H - B - (v / 300) * (H - T - B);
      g.strokeStyle = INK.line; g.lineWidth = 1;
      for (let v = 0; v <= 300; v += 100) { g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(W - Rm, Y(v)); g.stroke(); p.text(String(v), L - 5, Y(v) + 3, { align: 'right', size: 9.5, font: 'mono', color: INK.faint }); }
      for (let R = 0; R <= 25; R += 5) p.text(String(R), X(R), H - B + 13, { align: 'center', size: 9.5, font: 'mono', color: INK.faint });
      p.text('distance from the centre (kpc; 1 kpc = 3,260 ly)', (L + W - Rm) / 2, H - 4, { align: 'center', size: 10 });
      g.save(); g.translate(10, (T + H - B) / 2); g.rotate(-Math.PI / 2); p.text('orbital speed (km/s)', 0, 0, { align: 'center', size: 10 }); g.restore();
      // the measured curve, with its systematic band (about 3%)
      g.fillStyle = 'rgba(255,179,138,0.16)';
      g.beginPath();
      for (let R = 5; R <= 25.001; R += 0.5) g.lineTo(X(R), Y(measured(R) * 1.03));
      for (let R = 25; R >= 4.999; R -= 0.5) g.lineTo(X(R), Y(measured(R) * 0.97));
      g.fill();
      g.strokeStyle = INK.accent; g.lineWidth = 2;
      g.beginPath(); g.moveTo(X(5), Y(measured(5))); g.lineTo(X(25), Y(measured(25))); g.stroke();
      p.text('measured (Eilers et al. 2019)', X(13), Y(measured(13)) - 10, { size: 10.5, color: INK.accent, weight: 600 });
      // the visible matter alone
      g.strokeStyle = INK.violet; g.lineWidth = 1.6; g.setLineDash([5, 4]);
      g.beginPath();
      for (let R = 0.2; R <= 25.001; R += 0.2) g.lineTo(X(R), Y(visible(R)));
      g.stroke(); g.setLineDash([]);
      p.text('stars and gas alone (a model)', X(13.5), Y(visible(13.5)) + 16, { size: 10.5, color: INK.violet, weight: 600 });
      // the Sun
      g.strokeStyle = INK.ink; g.lineWidth = 1;
      g.beginPath(); g.moveTo(X(R0), Y(0)); g.lineTo(X(R0), Y(measured(R0))); g.setLineDash([2, 3]); g.stroke(); g.setLineDash([]);
      g.fillStyle = INK.ink; g.beginPath(); g.arc(X(R0), Y(measured(R0)), 3.5, 0, Math.PI * 2); g.fill();
      p.text('the Sun', X(R0) + 6, Y(measured(R0)) - 7, { size: 10, color: INK.ink });
    },
  };
};
export default make;
