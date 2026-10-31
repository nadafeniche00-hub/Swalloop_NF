// Plain numerical routines for the analysis pack: no registry, no React, nothing domain-specific.
// The C# port (dotnet/Swalloop.Core/Packs/AnalysisNodes.cs) repeats these algorithms operation for
// operation, so the two engines agree to rounding; change one and the golden files tell you.

const TWO_PI = Math.PI * 2;

// Discrete Fourier transform of a complex sequence, O(n^2). sign = -1 forward, +1 inverse (unscaled).
// The angle uses (k * t) mod n so large indices do not lose precision.
export function dft(re, im, sign) {
  const n = re.length;
  const outRe = new Array(n);
  const outIm = new Array(n);
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      const a = (sign * TWO_PI * ((k * t) % n)) / n;
      const c = Math.cos(a);
      const s = Math.sin(a);
      sr += re[t] * c - im[t] * s;
      si += re[t] * s + im[t] * c;
    }
    outRe[k] = sr;
    outIm[k] = si;
  }
  return { re: outRe, im: outIm };
}

// Frequency index of coefficient k as seen from zero: 0, 1, 2, ..., n/2, ..., 2, 1.
export const harmonic = (k, n) => Math.min(k, n - k);

// Keeps the harmonics up to `keep` (both signs) and returns the energy share kept, DC excluded.
export function lowpass(re, im, keep) {
  const n = re.length;
  const outRe = new Array(n);
  const outIm = new Array(n);
  let total = 0;
  let kept = 0;
  for (let k = 0; k < n; k++) {
    const e = re[k] * re[k] + im[k] * im[k];
    const pass = harmonic(k, n) <= keep;
    if (k > 0) {
      total += e;
      if (pass) kept += e;
    }
    outRe[k] = pass ? re[k] : 0;
    outIm[k] = pass ? im[k] : 0;
  }
  return { re: outRe, im: outIm, retained: total > 0 ? kept / total : 1 };
}

// Product of two matrices given as arrays of rows. Sums run k = 0, 1, 2, ... so the order is fixed.
export function matmul(a, b) {
  const m = a.length;
  const k = a[0].length;
  if (b.length !== k) throw new Error(`Cannot multiply a ${m}x${k} matrix by a ${b.length}x${b[0].length} matrix`);
  const n = b[0].length;
  const out = [];
  for (let i = 0; i < m; i++) {
    const row = new Array(n);
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let t = 0; t < k; t++) s += a[i][t] * b[t][j];
      row[j] = s;
    }
    out.push(row);
  }
  return out;
}

export const identity = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

// Integer power by repeated squaring.
export function matpow(m, k) {
  let e = Math.max(0, Math.floor(k));
  let result = identity(m.length);
  let base = m;
  while (e > 0) {
    if (e % 2 === 1) result = matmul(result, base);
    e = Math.floor(e / 2);
    if (e > 0) base = matmul(base, base);
  }
  return result;
}

const rad = (deg) => (deg * Math.PI) / 180;

// 3x3 homogeneous matrix: T(t) · T(p) · R · S · T(-p). Rotation in degrees about the pivot p.
export function affine({ rotate, sx, sy, tx, ty, px, py }) {
  const c = Math.cos(rad(rotate));
  const s = Math.sin(rad(rotate));
  const T = (x, y) => [[1, 0, x], [0, 1, y], [0, 0, 1]];
  const R = [[c, -s, 0], [s, c, 0], [0, 0, 1]];
  const S = [[sx, 0, 0], [0, sy, 0], [0, 0, 1]];
  let m = T(tx, ty);
  m = matmul(m, T(px, py));
  m = matmul(m, R);
  m = matmul(m, S);
  return matmul(m, T(-px, -py));
}

// Trapezoid or composite Simpson over samples (xs, ys). `cumulative` is always the running trapezoid.
// Simpson takes the samples two intervals at a time and is exact for quadratics on a uniform grid;
// an odd interval left over is closed with one trapezoid.
export function integrate(xs, ys, method) {
  const n = ys.length;
  const cumulative = new Array(n).fill(0);
  let trap = 0;
  for (let i = 0; i + 1 < n; i++) {
    trap += 0.5 * (ys[i] + ys[i + 1]) * (xs[i + 1] - xs[i]);
    cumulative[i + 1] = trap;
  }
  if (method !== 'Simpson' || n < 3) return { integral: trap, cumulative };
  let total = 0;
  let i = 0;
  for (; i + 2 < n; i += 2) {
    const h = (xs[i + 2] - xs[i]) / 2;
    total += (h / 3) * (ys[i] + 4 * ys[i + 1] + ys[i + 2]);
  }
  if (i + 1 < n) total += 0.5 * (ys[i] + ys[i + 1]) * (xs[i + 1] - xs[i]);
  return { integral: total, cumulative };
}
