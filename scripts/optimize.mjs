// Explores how to get the most out of the loop on the tower template:
//   1. how many passes are worth running
//   2. what each limit costs
//   3. which settings change the end result and which only change speed
//   4. the trade-off front (no single "score" is trusted)
//   5. whether smoothing repairs what a limit breaks
//   6. whether the picks hold across different contexts
//   node scripts/optimize.mjs
import { evaluate } from '../src/core/engine.js';
import { registry } from '../src/core/registry.js';
import '../src/packs/index.js';

const deg = (r) => (r * 180) / Math.PI;

function run(over = {}, template = 'Manhattan block') {
  const p = registry.templates[template]();
  for (const [id, v] of Object.entries(over)) Object.assign(p.nodes.find((n) => n.id === id).data.params, v);
  const t0 = performance.now();
  const r = evaluate(p.nodes, p.edges, registry);
  const ms = performance.now() - t0;
  const end = r.results.get('end').outputs;
  const m = r.results.get('metrics').outputs;
  const F = end.result.floors;
  const rough = (k) => F.slice(1, -1).reduce((s, f, i) => s + Math.abs(F[i][k] - 2 * f[k] + F[i + 2][k]), 0);
  const sunAz = ((over.stream?.sunAz ?? 150) * Math.PI) / 180;
  const sun = { x: Math.sin(sunAz), y: Math.cos(sunAz) };
  return {
    ms, iters: end.count,
    gfa: m.gfa, steel: m.material, moment: m.moment, util: m.util,
    minD: Math.min(...F.map((f) => f.d)),
    twist: deg(F.at(-1).rot - F[0].rot),
    // roughness of the loft along the height (rotation in degrees + half the width jitter in metres)
    jag: deg(rough('rot')) + rough('w') / 2,
    // wind overturning moment per m2 of floor area: lower = the wind costs less per usable m2
    mPerA: (m.moment * 1000) / m.gfa,
    // how squarely the longer facade faces the sun on average, as Orient scores it (1 = square on)
    face: F.reduce((s, f) => {
      const n = f.w >= f.d ? { x: -Math.sin(f.rot), y: Math.cos(f.rot) } : { x: Math.cos(f.rot), y: Math.sin(f.rot) };
      return s + Math.abs(n.x * sun.x + n.y * sun.y);
    }, 0) / F.length,
  };
}
const f = (v, d = 0) => (typeof v === 'number' ? v.toFixed(d) : String(v));
const row = (label, r) =>
  console.log(
    label.padEnd(30),
    `${f(r.iters).padStart(4)} it ${f(r.ms).padStart(4)} ms | GFA ${f(r.gfa).padStart(6)} moment ${f(r.moment).padStart(5)} m/A ${f(r.mPerA, 1).padStart(5)} | minD ${f(r.minD, 1).padStart(5)} twist ${f(r.twist).padStart(4)} jag ${f(r.jag).padStart(4)} face ${f(r.face, 2)} util ${f(r.util, 2)}`,
  );
const CONV = { end: { tolerance: 0.002, iterations: 600 } };
const pct = (a, b) => `${((a / b - 1) * 100).toFixed(0)}%`;

console.log('\n=== 1. Passes: how many are worth running (Manhattan, defaults) ===');
const full = run({ end: { tolerance: 0, iterations: 600 } });
row('600 passes (reference)', full);
for (const [tol, it] of [[0.05, 600], [0.01, 600], [0.002, 600], [0.0005, 600], [0, 150], [0, 60], [0, 30]]) {
  const r = run({ end: { tolerance: tol, iterations: it } });
  row(`tol ${tol} / max ${it}`, r);
  console.log(' '.repeat(30), `moment/GFA off by ${(Math.abs(r.mPerA / full.mPerA - 1) * 100).toFixed(2)}% vs reference`);
}

console.log('\n=== 2. What each limit costs (vs no limits, converged) ===');
const base = run(CONV);
row('no limits', base);
const price = (label, over) => {
  const r = run({ ...CONV, ...over });
  row(label, r);
  console.log(' '.repeat(30), `floor area ${pct(r.gfa, base.gfa)}  moment ${pct(r.moment, base.moment)}  moment per m2 ${pct(r.mPerA, base.mPerA)}  jag ${pct(r.jag, base.jag)}`);
};
price('min depth 20', { stream: { minD: 20 } });
price('min depth 24', { stream: { minD: 24 } });
price('min width 40', { stream: { minW: 40 } });
price('min radius 4', { stream: { minRadius: 4 } });
price('max twist 20', { stream: { maxTwist: 20 } });
price('max twist 45', { stream: { maxTwist: 45 } });
price('max step 2 deg/pass', { stream: { maxStep: 2 } });
price('smooth 0.5', { stream: { smooth: 0.5 } });
price('smooth 0.9', { stream: { smooth: 0.9 } });

console.log('\n=== 3. Which settings change the END RESULT, and which only change speed ===');
console.log('(tolerance 0.002, up to 600 passes; "passes" = how long the loop needed)');
for (const rate of [0.1, 0.2, 0.4, 0.7])
  for (const relax of [0.15, 0.3, 0.7]) {
    const r = run({ ...CONV, stream: { rate }, struct: { relax } });
    console.log(`rate ${rate} relax ${relax}: ${String(r.iters).padStart(3)} passes, moment/GFA ${r.mPerA.toFixed(2)}, GFA ${f(r.gfa)}, jag ${f(r.jag)}`);
  }

console.log('\n=== 4. Trade-off sweep (Manhattan, converged) ===');
const grid = [];
for (const aspect of [1.2, 1.8, 2.6, 3.4, 4])
  for (const sunWeight of [0, 0.35, 0.7, 1.5])
    for (const smooth of [0, 0.5])
      grid.push({ aspect, sunWeight, smooth, ...run({ ...CONV, stream: { aspect, sunWeight, smooth } }) });
console.log(`defaults: GFA ${f(base.gfa)}, moment/GFA ${base.mPerA.toFixed(1)}, facade-to-sun ${base.face.toFixed(2)}, jag ${f(base.jag)}, ${base.iters} passes`);
const dominates = (b, a) =>
  b.mPerA <= a.mPerA && b.gfa >= a.gfa && b.face >= a.face && b.jag <= a.jag &&
  (b.mPerA < a.mPerA || b.gfa > a.gfa || b.face > a.face || b.jag < a.jag);
const front = grid.filter((a) => !grid.some((b) => b !== a && dominates(b, a)));
console.log(`Pareto front (${front.length} of ${grid.length}) on moment/GFA, GFA, facade-to-sun, smoothness:`);
for (const g of front.sort((a, b) => a.mPerA - b.mPerA))
  console.log(
    `  aspect ${g.aspect} sunW ${g.sunWeight} smooth ${g.smooth} | moment/GFA ${g.mPerA.toFixed(1)} (${pct(g.mPerA, base.mPerA)}) GFA ${f(g.gfa)} (${pct(g.gfa, base.gfa)}) face ${g.face.toFixed(2)} jag ${f(g.jag)}`,
  );

// A single pick must not hinge on one weighting: rank under several and see what keeps winning.
const weightings = {
  'wind first': { mPerA: 0.55, gfa: 0.1, face: 0.1, jag: 0.25 },
  balanced: { mPerA: 0.35, gfa: 0.25, face: 0.2, jag: 0.2 },
  'area first': { mPerA: 0.2, gfa: 0.45, face: 0.15, jag: 0.2 },
  'sun first': { mPerA: 0.2, gfa: 0.15, face: 0.45, jag: 0.2 },
};
const span = (k) => {
  const v = grid.map((g) => g[k]);
  return [Math.min(...v), Math.max(...v)];
};
const score = (g, w) => {
  const n = (k, inv) => {
    const [lo, hi] = span(k);
    const x = hi === lo ? 0 : (g[k] - lo) / (hi - lo);
    return inv ? 1 - x : x;
  };
  return w.mPerA * n('mPerA', true) + w.gfa * n('gfa', false) + w.face * n('face', false) + w.jag * n('jag', true);
};
console.log('\nbest per weighting:');
for (const [name, w] of Object.entries(weightings)) {
  const g = grid.map((x) => ({ x, s: score(x, w) })).sort((a, b) => b.s - a.s)[0].x;
  console.log(
    `  ${name.padEnd(11)} aspect ${g.aspect} sunW ${g.sunWeight} smooth ${g.smooth} | moment/GFA ${g.mPerA.toFixed(1)} GFA ${f(g.gfa)} face ${g.face.toFixed(2)} jag ${f(g.jag)}`,
  );
}

console.log('\n=== 5. Limits + smoothing: does smoothing repair what a limit breaks? ===');
const lim = (label, over) => row(label, run({ ...CONV, ...over }));
lim('minD 24', { stream: { minD: 24 } });
lim('minD 24 + smooth 0.5', { stream: { minD: 24, smooth: 0.5 } });
lim('minD 24 + smooth 0.8', { stream: { minD: 24, smooth: 0.8 } });
lim('twist 20', { stream: { maxTwist: 20 } });
lim('twist 20 + smooth 0.5', { stream: { maxTwist: 20, smooth: 0.5 } });
lim('twist 20 + aspect 2.6', { stream: { maxTwist: 20, aspect: 2.6 } });

console.log('\n=== 6. Robustness: the same settings across different contexts ===');
const picks = {
  defaults: {},
  'smooth 0.5': { smooth: 0.5 },
  'smooth 0.5 + aspect 2.6': { smooth: 0.5, aspect: 2.6 },
  'smooth 0.5 + aspect 2.6 + sunW 0.35': { smooth: 0.5, aspect: 2.6, sunWeight: 0.35 },
};
for (const [tpl, seed] of [['Manhattan block', 3], ['Manhattan block', 7], ['Manhattan block', 19], ['Dubai plots', 11], ['Dubai plots', 5]]) {
  console.log(`${tpl}, seed ${seed}:`);
  for (const [name, stream] of Object.entries(picks)) {
    const r = run({ ...CONV, ctx: { seed }, stream }, tpl);
    console.log(
      `   ${name.padEnd(36)} moment/GFA ${r.mPerA.toFixed(1).padStart(5)} GFA ${f(r.gfa).padStart(6)} face ${r.face.toFixed(2)} jag ${f(r.jag).padStart(4)} util ${r.util.toFixed(2)} ${String(r.iters).padStart(3)} passes`,
    );
  }
}
