// The analysis pack against closed-form answers: integrals, logarithms, Fourier, splats, matrices, PCA.
// These check the maths itself, not that two engines agree (that is dotnet/ and scripts/dump-golden.mjs).
//   node scripts/test-analysis.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluate } from '../src/core/engine.js';
import { fileToGraph } from '../src/core/graphFile.js';
import { registry } from '../src/core/registry.js';
import '../src/packs/index.js';

let failed = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log('ok  ', name);
  } catch (e) {
    failed++;
    console.log('FAIL', name, '\n    ', e.message);
  }
};
const near = (a, b, tol = 1e-9, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b} (tol ${tol})`);

// Run one node type on its own: compute(inputs, params-with-defaults).
const node = (type, inputs = {}, params = {}) =>
  registry.nodeTypes[type].compute(inputs, { ...registry.defaultParams(type), ...params });

const root = fileURLToPath(new URL('../', import.meta.url));
const runTemplate = (name, over = {}) => {
  const g = fileToGraph(JSON.parse(readFileSync(`${root}templates/${name}.swalloop.json`, 'utf8')), registry);
  for (const [id, p] of Object.entries(over)) Object.assign(g.nodes.find((n) => n.id === id).data.params, p);
  return evaluate(g.nodes, g.edges, registry).results;
};

// ---- integrals ---------------------------------------------------------------------------
const grid = (n, a, b) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

test('Simpson integrates x^2 on [0,1] exactly; the trapezoid overshoots by (b-a) h^2 f2 / 12 (f2 = 2)', () => {
  const x = grid(11, 0, 1);
  const y = x.map((v) => v * v);
  near(node('integrate', { y, x }, { method: 'Simpson' }).integral, 1 / 3, 1e-14, 'simpson');
  const t = node('integrate', { y, x }, { method: 'Trapezoid' }).integral;
  near(t, 1 / 3 + (1 * 0.01 * 2) / 12, 1e-14, 'trapezoid'); // f'' = 2, h = 0.1
});

test('Simpson with an even number of samples closes the last interval with a trapezoid', () => {
  const x = grid(10, 0, 9); // 9 intervals
  const y = x.map(() => 2);
  near(node('integrate', { y, x }, { method: 'Simpson' }).integral, 18, 1e-12);
});

test('integrate: the running integral ends at the trapezoid total and starts at 0', () => {
  const y = [1, 2, 3, 4];
  const r = node('integrate', { y }, { dx: 2, method: 'Trapezoid' });
  assert.equal(r.cumulative[0], 0);
  near(r.cumulative[3], r.integral, 1e-12);
  near(r.integral, 2 * (0.5 * 1 + 2 + 3 + 0.5 * 4), 1e-12);
});

test('integrate with weight x·f gives the first moment: integral of x dx on [0,4] is 8', () => {
  const x = grid(5, 0, 4);
  near(node('integrate', { y: x.map(() => 1), x }, { weight: 'x·f', method: 'Simpson' }).integral, 8, 1e-12);
});

test('integrate rejects an x list of a different length', () => {
  assert.throws(() => node('integrate', { y: [1, 2, 3], x: [0, 1] }), /differ in length/);
});

// ---- logarithms ---------------------------------------------------------------------------
test('log wind: the speed at the reference height is the reference speed, and zero at the roughness length', () => {
  const r = node('logWind', { z: [1, 10, 100] }, { vRef: 30, zRef: 10, z0: 1 });
  near(r.speed[1], 30, 1e-12);
  near(r.speed[0], 0, 1e-12);
  near(r.speed[2], 60, 1e-12); // ln(100)/ln(10) = 2
});

test('log wind: the fitted power-law exponent rises with roughness, in the textbook range', () => {
  const z = grid(30, 10, 300);
  const a = (z0) => node('logWind', { z }, { z0 }).alpha;
  assert.ok(a(0.03) < a(0.3) && a(0.3) < a(1) && a(1) < a(2));
  assert.ok(a(0.03) > 0.12 && a(0.03) < 0.16, `open terrain alpha ${a(0.03)}`);
  assert.ok(a(1) > 0.25 && a(1) < 0.32, `city alpha ${a(1)}`);
});

test('log wind: a profile that is already a power law is not what it fits (alpha is a fit, not an identity)', () => {
  const z = grid(30, 10, 300);
  const r = node('logWind', { z }, { z0: 1 });
  const fitted = z.map((zi) => 40 * Math.pow(zi / 10, r.alpha));
  const worst = Math.max(...z.map((_, i) => Math.abs(fitted[i] - r.speed[i]) / r.speed[i]));
  assert.ok(worst < 0.1, `power law within 10 percent of the log law over 10-300 m, worst ${worst}`);
  assert.ok(worst > 1e-4, 'it should not be exact');
});

// ---- Fourier ---------------------------------------------------------------------------------
test('fourier: one cosine is exactly one harmonic', () => {
  const N = 32;
  const sig = Array.from({ length: N }, (_, i) => 5 + 3 * Math.cos((2 * Math.PI * i) / N));
  const r = node('fourier', { signal: sig }, { keep: 1, edge: 'Periodic' });
  sig.forEach((v, i) => near(r.smooth[i], v, 1e-10, `sample ${i}`));
  near(r.amplitudes[0], 5, 1e-10, 'mean');
  near(r.amplitudes[1], 3, 1e-10, 'amplitude of harmonic 1');
  near(r.retained, 1, 1e-12, 'energy');
});

test('fourier: keeping no harmonics leaves the mean', () => {
  const r = node('fourier', { signal: [1, 5, 2, 8, 4] }, { keep: 0, edge: 'Periodic' });
  r.smooth.forEach((v) => near(v, 4, 1e-12));
});

test('fourier: mirrored ends follow a ramp better than periodic ones (no wrap-around jump)', () => {
  const ramp = grid(40, 0, 39);
  const err = (edge) => {
    const s = node('fourier', { signal: ramp }, { keep: 6, edge }).smooth;
    return Math.abs(s[0] - ramp[0]) + Math.abs(s[39] - ramp[39]);
  };
  assert.ok(err('Mirror') < err('Periodic') / 3, `mirror ${err('Mirror')} periodic ${err('Periodic')}`);
});

test('fourier curve: an ellipse is exactly one harmonic (x + iy has frequencies +1 and -1)', () => {
  const N = 64;
  const pts = Array.from({ length: N }, (_, i) => {
    const t = (2 * Math.PI * i) / N;
    return [10 * Math.cos(t) + 3, 4 * Math.sin(t) - 2];
  });
  const r = node('fourierCurve', { points: pts }, { keep: 1 });
  near(r.deviation, 0, 1e-10, 'deviation');
  near(r.areaKept, 1, 1e-10, 'area');
});

test('fourier curve: keeping nothing collapses the outline onto its centre', () => {
  const pts = [[0, 0], [10, 0], [10, 4], [0, 4]];
  const r = node('fourierCurve', { points: pts }, { keep: 0 });
  r.smooth.forEach((q) => { near(q[0], 5, 1e-12); near(q[1], 2, 1e-12); });
});

test('fourier curve: a square needs many harmonics, a few round it off and shrink it', () => {
  const pts = [];
  const side = 16;
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * 4;
    const s = Math.floor(t);
    const f = (t - s) * 20 - 10;
    pts.push([[f, -10], [10, f], [-f, 10], [-10, -f]][s]);
  }
  const few = node('fourierCurve', { points: pts }, { keep: 3 });
  const many = node('fourierCurve', { points: pts }, { keep: 20 });
  assert.ok(few.deviation > many.deviation && few.areaKept < 1 && many.deviation < 0.5 && side > 0);
});

// ---- Gaussian splats -----------------------------------------------------------------------
const splat = (o = {}) => ({ x: 0, y: 0, sx: 20, sy: 20, rot: 0, opacity: 1, depth: 0, value: 1, ...o });

test('splat field: one splat peaks at its centre with its value and is symmetric', () => {
  const f = node('splatField', { splats: [splat({ value: 7 })] }, { n: 11, extent: 110 }).field.values;
  near(f[5][5], 7, 1e-12);
  near(f[5][4], f[5][6], 1e-12);
  near(f[4][5], f[6][5], 1e-12);
  assert.ok(f[5][5] > f[5][6] && f[5][6] > f[5][7]);
});

test('splat field: a Gaussian is e^-0.5 at one sigma', () => {
  const f = node('splatField', { splats: [splat()] }, { n: 11, extent: 110 }).field.values;
  near(f[5][6], Math.exp(-0.5), 1e-12); // one cell (20 m) = one sigma
});

test('splat field: an anisotropic, rotated splat is elongated along its rotation', () => {
  const s = splat({ sx: 40, sy: 10, rot: Math.PI / 2 }); // long axis along y
  const f = node('splatField', { splats: [s] }, { n: 11, extent: 110 }).field.values;
  assert.ok(f[7][5] > f[5][7] * 10, 'far along y should hold far more than far along x');
});

test('splat field: additive sums, composite lets the front splat hide the back one', () => {
  const front = splat({ value: 10, depth: -1, opacity: 1 });
  const back = splat({ value: 100, depth: 1, opacity: 1 });
  const add = node('splatField', { splats: [back, front] }, { n: 11, extent: 110, mode: 'Additive' }).field.values[5][5];
  const comp = node('splatField', { splats: [back, front] }, { n: 11, extent: 110, mode: 'Composite' }).field.values[5][5];
  near(add, 110, 1e-12);
  near(comp, 0.99 * 10 + 0.01 * 0.99 * 100, 1e-12); // C = a1 v1 + (1 - a1) a2 v2, alpha capped at 0.99
});

test('splat field: composite does not depend on the order of the list', () => {
  const a = splat({ value: 3, depth: 5, x: 20 });
  const b = splat({ value: 9, depth: -2, x: -20, opacity: 0.6 });
  const c = splat({ value: 5, depth: 1, y: 20, opacity: 0.8 });
  const g = (list) => node('splatField', { splats: list }, { n: 9, extent: 90, mode: 'Composite' }).field.values;
  assert.deepEqual(g([a, b, c]), g([c, a, b]));
});

// ---- linear algebra ----------------------------------------------------------------------------
const applyTo = (m, pts) => node('applyMatrix', { m, points: pts }).points;

test('affine: a quarter turn maps (1,0) to (0,1); a pivot stays where it is', () => {
  const r = node('affine', {}, { rotate: 90 }).matrix;
  const p = applyTo(r, [[1, 0]])[0];
  near(p[0], 0, 1e-12);
  near(p[1], 1, 1e-12);
  const q = applyTo(node('affine', {}, { rotate: 33, px: 10, py: -4 }).matrix, [[10, -4]])[0];
  near(q[0], 10, 1e-12);
  near(q[1], -4, 1e-12);
});

test('affine: scale, then rotate, then move (T R S order)', () => {
  const m = node('affine', {}, { rotate: 90, sx: 2, sy: 3, tx: 5 }).matrix;
  const p = applyTo(m, [[1, 1]])[0]; // scale -> (2,3), turn -> (-3,2), move -> (2,2)
  near(p[0], 2, 1e-12);
  near(p[1], 2, 1e-12);
});

test('matrix power: R(10 deg) to the 9th is R(90 deg); the 0th power is the identity', () => {
  const r10 = node('affine', {}, { rotate: 10 }).matrix;
  const r90 = node('affine', {}, { rotate: 90 }).matrix;
  const p9 = node('matpow', { m: r10 }, { k: 9 }).matrix;
  p9.forEach((row, i) => row.forEach((v, j) => near(v, r90[i][j], 1e-12, `[${i}][${j}]`)));
  const p0 = node('matpow', { m: r10 }, { k: 0 }).matrix;
  assert.deepEqual(p0, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
});

test('matrix product: associative, identity is neutral, and a size mismatch is refused', () => {
  const A = node('affine', {}, { rotate: 20, tx: 3 }).matrix;
  const B = node('affine', {}, { sx: 2, ty: -1 }).matrix;
  const C = node('affine', {}, { rotate: -50, sy: 0.5 }).matrix;
  const left = node('matmul', { a: node('matmul', { a: A, b: B }).matrix, b: C }).matrix;
  const right = node('matmul', { a: A, b: node('matmul', { a: B, b: C }).matrix }).matrix;
  left.forEach((row, i) => row.forEach((v, j) => near(v, right[i][j], 1e-12)));
  assert.throws(() => node('matmul', { a: [[1, 2, 3]], b: [[1, 2]] }), /Cannot multiply/);
});

test('polygon: n points on the circle, the first on the x axis', () => {
  const pts = node('polygon', {}, { n: 5, radius: 3 }).points;
  assert.equal(pts.length, 5);
  near(pts[0][0], 3, 1e-12);
  pts.forEach((q) => near(Math.hypot(...q), 3, 1e-12));
});

test('pca: the main axis of a diagonal line is 45 degrees and the elongation is infinite', () => {
  const r = node('pca', { points: [[0, 0], [1, 1], [2, 2], [3, 3]] });
  near(r.angle, 45, 1e-9);
  near(r.minor, 0, 1e-12);
  assert.equal(r.aspect, Infinity);
  near(r.cx, 1.5, 1e-12);
});

test('pca: a 20 x 10 rectangle has spreads 10 and 5, aspect 2, axis along x; turned 30 degrees it reads 30', () => {
  const rect = [[-10, -5], [10, -5], [10, 5], [-10, 5]];
  const r = node('pca', { points: rect });
  near(r.angle, 0, 1e-9);
  near(r.major, 10, 1e-12);
  near(r.minor, 5, 1e-12);
  near(r.aspect, 2, 1e-12);
  const turned = applyTo(node('affine', {}, { rotate: 30 }).matrix, rect);
  near(node('pca', { points: turned }).angle, 30, 1e-9);
});

test('list math: element-wise with a list or a scalar, and a length mismatch is refused', () => {
  assert.deepEqual(node('listMath', { a: [1, 2, 3], b: [4, 5, 6] }, { op: '+' }).result, [5, 7, 9]);
  assert.deepEqual(node('listMath', { a: [1, 2, 3] }, { op: '×', s: 10 }).result, [10, 20, 30]);
  assert.throws(() => node('listMath', { a: [1, 2], b: [1] }), /differ in length/);
});

test('collect: gathers what is wired, in order, and skips what is not', () => {
  assert.deepEqual(node('pack', { a: 1, c: 3 }).list, [1, 3]);
});

// ---- the tower adapters and the real-life checks -----------------------------------------------
test('adapters: floor profile, floor outline and context splats have the right shapes', () => {
  const r = runTemplate('analysis-fourier-loft');
  const prof = r.get('prof').outputs;
  assert.equal(prof.values.length, 60);
  assert.equal(prof.z.length, 60);
  near(prof.z[0], 2, 1e-12); // first mid-height: floor height 4
  assert.equal(r.get('out').outputs.points.length, 64);
  const s = runTemplate('analysis-splat-shelter').get('spl').outputs.splats;
  assert.equal(s.length, 48); // 7 x 7 blocks around the site
  assert.ok(s.every((q) => q.opacity > 0 && q.opacity <= 1 && q.depth < 0));
});

test('the base shear and base moment of the tower are integrals of the wind load profile', () => {
  const g = fileToGraph(JSON.parse(readFileSync(`${root}templates/skyscraper-manhattan.swalloop.json`, 'utf8')), registry);
  const r = evaluate(g.nodes, g.edges, registry).results;
  const tower = r.get('end').outputs.result;
  const prof = node('profile', { tower }, { quantity: 'Wind load' });
  const h = tower.h;
  const perMetre = node('listMath', { a: prof.values }, { op: '÷', s: h }).result; // kN per metre of height
  const shear = node('integrate', { y: perMetre, x: prof.z }, { method: 'Simpson' }).integral;
  const moment = node('integrate', { y: perMetre, x: prof.z }, { method: 'Simpson', weight: 'x·f' }).integral;
  const sumF = tower.floors.reduce((s, f) => s + f.windF, 0);
  const sumM = tower.floors.reduce((s, f) => s + f.windF * (f.z + h / 2), 0);
  // the integral runs between the first and the last mid-height, so it misses half a floor at each end
  near(shear / sumF, 1, 0.03, 'base shear ratio');
  near(moment / sumM, 1, 0.03, 'base moment ratio');
});

test('terrain roughness drives the tower: rougher terrain, larger exponent, larger base moment', () => {
  const moment = (z0) => runTemplate('analysis-tower-log-wind', { rough: { value: z0 } }).get('metrics').outputs.moment;
  assert.ok(moment(0.1) < moment(1) && moment(1) < moment(2));
});

test('the matrix-twist template: the top outline is the base turned 29 x 3 degrees and shrunk 0.985^29', () => {
  const r = runTemplate('analysis-matrix-twist');
  const outlines = r.get('end').outputs.result;
  assert.equal(outlines.length, 30);
  near(Math.hypot(...outlines[29][0]) / Math.hypot(...outlines[0][0]), Math.pow(0.985, 29), 1e-12);
  near(r.get('axes').outputs.angle, ((90 + 87 + 90) % 180) - 90, 1e-9); // 177 degrees wrapped into (-90, 90]
  near(r.get('axes').outputs.aspect, 1.6, 1e-9);
});

test('the analysis templates need only the pack they use (they load with a registry that has all packs)', () => {
  for (const name of ['analysis-log-wind', 'analysis-tower-log-wind', 'analysis-fourier-loft', 'analysis-splat-shelter', 'analysis-matrix-twist']) {
    const r = runTemplate(name);
    for (const [id, res] of r) assert.ok(!res.error, `${name}: ${id}: ${res.error}`);
  }
});

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
