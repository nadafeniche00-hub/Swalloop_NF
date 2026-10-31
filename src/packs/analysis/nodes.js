// The analysis pack: general numerical tools that spatial and computational design keeps reaching for.
// None of them knows about towers; the skyscraper pack supplies adapters (floor profile, floor outline,
// context splats) that turn a tower into the plain lists, point lists and splats used here.
//
// Value shapes
//   list      [number, ...]
//   points    [[x, y], ...]
//   matrix    [[...], ...]            rows of numbers (3x3 for plane transforms)
//   splats    [{ x, y, sx, sy, rot, opacity, depth, value }, ...]   a 2D Gaussian splat is a position, a
//             spread (sx, sy), a rotation (radians), an opacity, a depth for ordering and a value
//   grid      { kind: 'grid', n, extent, values: [[...], ...] }     values[row][col], row = y, col = x
//
// Real uses, one per family
//   integrate   base shear and overturning moment from a wind pressure profile
//   logWind     the logarithmic wind profile, and the power-law exponent that matches it
//   fourier     smooth a floor-by-floor profile; fourierCurve low-passes a closed outline
//   splatField  a density or shelter map from neighbours; alpha-composited front to back like 3D Gaussian splatting
//   affine, matmul, matpow, applyMatrix   a twisting, tapering tower from matrix powers
//   pca         the main axis and elongation of a point cloud or outline

import { num, select } from '../../core/define.js';
import { OPS } from '../../core/nodes.js';
import { affine, dft, integrate, lowpass, matmul, matpow } from './numeric.js';

const LIST = (id, label, extra = {}) => ({ id, label, type: 'list', ...extra });
const POINTS = (id, label, extra = {}) => ({ id, label, type: 'points', ...extra });
const MATRIX = (id, label, extra = {}) => ({ id, label, type: 'matrix', ...extra });
const rad = (deg) => (deg * Math.PI) / 180;
const zeros = (n) => new Array(n).fill(0);

function areaOf(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

export const ANALYSIS_NODES = {
  // Element-wise arithmetic on lists: a (op) b, or a (op) s when there is no b.
  listMath: {
    title: 'List math',
    category: 'Analysis',
    inputs: [LIST('a', 'A'), LIST('b', 'B', { optional: true })],
    outputs: [LIST('result', 'Result')],
    params: [select('op', 'Op', '×', Object.keys(OPS)), num('s', 'S (when no B)', 1, { step: 0.1 })],
    compute: ({ a, b }, p) => {
      if (b && b.length !== a.length) throw new Error(`Lists differ in length (${a.length} and ${b.length})`);
      const f = OPS[p.op];
      return { result: a.map((v, i) => f(v, b ? b[i] : p.s)) };
    },
  },

  // Gathers up to four values into one list, so they can be compared in one view.
  pack: {
    title: 'Collect',
    category: 'Analysis',
    inputs: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, label: id.toUpperCase(), type: 'any', optional: i > 0 })),
    outputs: [{ id: 'list', label: 'List', type: 'list' }],
    params: [],
    compute: (inputs) => ({ list: ['a', 'b', 'c', 'd'].filter((k) => inputs[k] !== undefined).map((k) => inputs[k]) }),
  },

  // Integral of y(x): trapezoid or composite Simpson. x is a list or evenly spaced from x0 by dx.
  // "x·f" weights the samples by x, the first moment: overturning moment from a load profile.
  integrate: {
    title: 'Integrate',
    category: 'Analysis',
    inputs: [LIST('y', 'y'), LIST('x', 'x', { optional: true })],
    outputs: [
      { id: 'integral', label: 'Integral', type: 'number' },
      LIST('cumulative', 'Running'),
    ],
    params: [
      select('method', 'Method', 'Trapezoid', ['Trapezoid', 'Simpson']),
      select('weight', 'Integrand', 'f', ['f', 'x·f']),
      num('x0', 'x start', 0, { step: 1 }),
      num('dx', 'dx (no x)', 1, { step: 0.5 }),
    ],
    compute: ({ y, x }, p) => {
      const xs = x ?? y.map((_, i) => p.x0 + i * p.dx);
      if (xs.length !== y.length) throw new Error(`x and y differ in length (${xs.length} and ${y.length})`);
      const ys = p.weight === 'x·f' ? y.map((v, i) => v * xs[i]) : y;
      const r = integrate(xs, ys, p.method);
      return { integral: r.integral, cumulative: r.cumulative };
    },
  },

  // Logarithmic wind profile  u(z) = vRef · ln(z / z0) / ln(zRef / z0)  and the power-law exponent alpha
  // that fits it best in log-log space (through the reference point), the number a power-law wind model asks for.
  logWind: {
    title: 'Log wind profile',
    category: 'Analysis',
    inputs: [LIST('z', 'Heights (m)')],
    outputs: [LIST('speed', 'Speed (m/s)'), { id: 'alpha', label: 'Power-law exponent', type: 'number' }],
    params: [
      num('vRef', 'Speed at ref. (m/s)', 40, { step: 1, min: 0 }),
      num('zRef', 'Ref. height (m)', 10, { step: 1, min: 1 }),
      num('z0', 'Roughness z0 (m)', 1, { step: 0.05, min: 0.001 }),
    ],
    compute: ({ z }, p) => {
      const denom = Math.log(p.zRef / p.z0);
      const speed = z.map((zi) => (p.vRef * Math.log(Math.max(zi, p.z0) / p.z0)) / denom);
      let sxy = 0;
      let sxx = 0;
      z.forEach((zi, i) => {
        if (!(zi > p.z0) || !(speed[i] > 0)) return;
        const x = Math.log(zi / p.zRef);
        const y = Math.log(speed[i] / p.vRef);
        sxy += x * y;
        sxx += x * x;
      });
      return { speed, alpha: sxx > 0 ? sxy / sxx : 0 };
    },
  },

  // Low-pass a signal with the discrete Fourier transform. Periodic treats the list as one period (a ring
  // of values); Mirror reflects it first, which is what a profile along a height needs (no wrap-around).
  fourier: {
    title: 'Fourier smooth',
    category: 'Analysis',
    inputs: [LIST('signal', 'Signal')],
    outputs: [
      LIST('smooth', 'Smoothed'),
      LIST('amplitudes', 'Amplitudes'),
      { id: 'retained', label: 'Energy kept', type: 'number' },
    ],
    params: [
      num('keep', 'Harmonics kept', 3, { step: 1, min: 0, max: 64 }),
      select('edge', 'Ends', 'Mirror', ['Mirror', 'Periodic']),
    ],
    compute: ({ signal }, p) => {
      const n = signal.length;
      const keep = Math.max(0, Math.floor(p.keep));
      const ext = p.edge === 'Mirror' ? signal.concat(signal.slice().reverse()) : signal;
      const m = ext.length;
      if (m === 0) return { smooth: [], amplitudes: [], retained: 1 };
      const F = dft(ext, zeros(m), -1);
      const lp = lowpass(F.re, F.im, keep);
      const inv = dft(lp.re, lp.im, +1);
      const smooth = [];
      for (let i = 0; i < n; i++) smooth.push(inv.re[i] / m);
      const amplitudes = [];
      for (let k = 0; k <= Math.floor(m / 2); k++) {
        const mag = Math.sqrt(F.re[k] * F.re[k] + F.im[k] * F.im[k]);
        amplitudes.push(k === 0 ? F.re[0] / m : m % 2 === 0 && k === m / 2 ? mag / m : (2 * mag) / m);
      }
      return { smooth, amplitudes, retained: lp.retained };
    },
  },

  // Fourier descriptors of a closed outline: the points are one complex sequence x + iy, low-passed, so
  // fewer harmonics give a simpler, rounder outline that is cheaper to build. Reports how far it moved.
  fourierCurve: {
    title: 'Fourier outline',
    category: 'Analysis',
    inputs: [POINTS('points', 'Outline')],
    outputs: [
      POINTS('smooth', 'Simplified'),
      { id: 'deviation', label: 'Max deviation (m)', type: 'number' },
      { id: 'areaKept', label: 'Area kept', type: 'number' },
      { id: 'retained', label: 'Energy kept', type: 'number' },
    ],
    params: [num('keep', 'Harmonics kept', 4, { step: 1, min: 0, max: 32 })],
    compute: ({ points }, p) => {
      const n = points.length;
      const keep = Math.max(0, Math.floor(p.keep));
      const F = dft(points.map((q) => q[0]), points.map((q) => q[1]), -1);
      const lp = lowpass(F.re, F.im, keep);
      const inv = dft(lp.re, lp.im, +1);
      const smooth = [];
      let deviation = 0;
      for (let i = 0; i < n; i++) {
        const q = [inv.re[i] / n, inv.im[i] / n];
        smooth.push(q);
        const dx = q[0] - points[i][0];
        const dy = q[1] - points[i][1];
        deviation = Math.max(deviation, Math.sqrt(dx * dx + dy * dy));
      }
      const a0 = areaOf(points);
      return { smooth, deviation, areaKept: a0 > 0 ? areaOf(smooth) / a0 : 1, retained: lp.retained };
    },
  },

  // Splats a list of Gaussians onto an n x n grid centred on the origin. Additive sums value · exp(-q/2),
  // a density or shelter map. Composite blends front to back by depth like 3D Gaussian splatting:
  // C += T · a · value, T *= 1 - a, with a = opacity · exp(-q/2). q is the squared Mahalanobis distance.
  splatField: {
    title: 'Gaussian splat field',
    category: 'Analysis',
    inputs: [{ id: 'splats', label: 'Splats', type: 'splats' }],
    outputs: [
      { id: 'field', label: 'Field', type: 'grid' },
      { id: 'max', label: 'Max', type: 'number' },
      { id: 'total', label: 'Total', type: 'number' },
    ],
    params: [
      num('n', 'Grid size', 48, { step: 4, min: 4, max: 160 }),
      num('extent', 'Half extent (m)', 300, { step: 10, min: 1 }),
      select('mode', 'Blend', 'Additive', ['Additive', 'Composite']),
      num('gain', 'Gain', 1, { step: 0.1 }),
    ],
    compute: ({ splats }, p) => {
      const n = Math.max(1, Math.floor(p.n));
      const cell = (2 * p.extent) / n;
      const composite = p.mode === 'Composite';
      const ordered = composite ? splats.map((s, i) => [s, i]).sort((a, b) => a[0].depth - b[0].depth || a[1] - b[1]).map((e) => e[0]) : splats;
      const trig = ordered.map((s) => ({ c: Math.cos(s.rot), s: Math.sin(s.rot) }));
      const values = [];
      let max = -Infinity;
      let total = 0;
      for (let j = 0; j < n; j++) {
        const row = new Array(n);
        const y = -p.extent + (j + 0.5) * cell;
        for (let i = 0; i < n; i++) {
          const x = -p.extent + (i + 0.5) * cell;
          let acc = 0;
          let trans = 1;
          for (let k = 0; k < ordered.length; k++) {
            const s = ordered[k];
            const dx = x - s.x;
            const dy = y - s.y;
            const u = dx * trig[k].c + dy * trig[k].s;
            const w = -dx * trig[k].s + dy * trig[k].c;
            const g = Math.exp(-0.5 * ((u / s.sx) * (u / s.sx) + (w / s.sy) * (w / s.sy)));
            if (composite) {
              const a = Math.min(0.99, s.opacity * g);
              acc += trans * a * s.value;
              trans *= 1 - a;
            } else acc += s.value * g;
          }
          const v = p.gain * acc;
          row[i] = v;
          if (v > max) max = v;
          total += v;
        }
        values.push(row);
      }
      return { field: { kind: 'grid', n, extent: p.extent, values }, max: max === -Infinity ? 0 : max, total };
    },
  },

  affine: {
    title: 'Affine matrix',
    category: 'Analysis',
    inputs: [],
    outputs: [MATRIX('matrix', 'Matrix')],
    params: [
      num('rotate', 'Rotate (deg)', 0, { step: 1 }),
      num('sx', 'Scale x', 1, { step: 0.01 }),
      num('sy', 'Scale y', 1, { step: 0.01 }),
      num('tx', 'Move x', 0, { step: 1 }),
      num('ty', 'Move y', 0, { step: 1 }),
      num('px', 'Pivot x', 0, { step: 1 }),
      num('py', 'Pivot y', 0, { step: 1 }),
    ],
    compute: (_i, p) => ({ matrix: affine(p) }),
  },

  matmul: {
    title: 'Matrix product',
    category: 'Analysis',
    inputs: [MATRIX('a', 'A'), MATRIX('b', 'B')],
    outputs: [MATRIX('matrix', 'A × B')],
    params: [],
    compute: ({ a, b }) => ({ matrix: matmul(a, b) }),
  },

  matpow: {
    title: 'Matrix power',
    category: 'Analysis',
    inputs: [MATRIX('m', 'M')],
    outputs: [MATRIX('matrix', 'M ^ k')],
    params: [num('k', 'k', 1, { step: 1, min: 0 })],
    compute: ({ m }, p) => ({ matrix: matpow(m, p.k) }),
  },

  applyMatrix: {
    title: 'Apply matrix',
    category: 'Analysis',
    inputs: [MATRIX('m', 'Matrix'), POINTS('points', 'Points')],
    outputs: [POINTS('points', 'Points')],
    params: [],
    compute: ({ m, points }) => ({
      points: points.map(([x, y]) => {
        const w = m[2][0] * x + m[2][1] * y + m[2][2];
        return [(m[0][0] * x + m[0][1] * y + m[0][2]) / w, (m[1][0] * x + m[1][1] * y + m[1][2]) / w];
      }),
    }),
  },

  // A regular polygon, optionally stretched: a base outline to transform.
  polygon: {
    title: 'Polygon',
    category: 'Analysis',
    inputs: [],
    outputs: [POINTS('points', 'Points')],
    params: [
      num('n', 'Sides', 6, { step: 1, min: 3, max: 256 }),
      num('radius', 'Radius (m)', 20, { step: 1, min: 0 }),
      num('aspect', 'Aspect (y/x)', 1, { step: 0.05, min: 0.05 }),
      num('rotate', 'Rotate (deg)', 0, { step: 5 }),
    ],
    compute: (_i, p) => {
      const n = Math.max(3, Math.floor(p.n));
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n + rad(p.rotate);
        pts.push([p.radius * Math.cos(a), p.radius * p.aspect * Math.sin(a)]);
      }
      return { points: pts };
    },
  },

  // Principal axes of a point set from its 2x2 covariance: the direction of greatest spread and how elongated it is.
  pca: {
    title: 'Principal axes',
    category: 'Analysis',
    inputs: [POINTS('points', 'Points')],
    outputs: [
      { id: 'angle', label: 'Main axis (deg)', type: 'number' },
      { id: 'major', label: 'Spread along (m)', type: 'number' },
      { id: 'minor', label: 'Spread across (m)', type: 'number' },
      { id: 'aspect', label: 'Elongation', type: 'number' },
      { id: 'cx', label: 'Centre x', type: 'number' },
      { id: 'cy', label: 'Centre y', type: 'number' },
    ],
    params: [],
    compute: ({ points }) => {
      const n = points.length;
      let cx = 0;
      let cy = 0;
      for (const q of points) {
        cx += q[0];
        cy += q[1];
      }
      cx /= n;
      cy /= n;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (const q of points) {
        const dx = q[0] - cx;
        const dy = q[1] - cy;
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
      }
      sxx /= n;
      syy /= n;
      sxy /= n;
      const mid = (sxx + syy) / 2;
      const rr = Math.sqrt(((sxx - syy) / 2) * ((sxx - syy) / 2) + sxy * sxy);
      const l1 = mid + rr;
      const l2 = Math.max(0, mid - rr);
      const major = Math.sqrt(l1);
      const minor = Math.sqrt(l2);
      return {
        angle: (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI,
        major,
        minor,
        aspect: minor > 0 ? major / minor : Infinity,
        cx,
        cy,
      };
    },
  },
};
