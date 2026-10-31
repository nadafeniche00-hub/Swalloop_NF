import { evaluate } from '../src/core/engine.js';
import { registry } from '../src/core/registry.js';
import '../src/packs/index.js';
const run = (preset, over = {}) => {
  const p = registry.templates[preset]();
  for (const [id, v] of Object.entries(over)) Object.assign(p.nodes.find((n) => n.id === id).data.params, v);
  const t0 = performance.now();
  const r = evaluate(p.nodes, p.edges, registry);
  const ms = performance.now() - t0;
  const t = r.results.get('end').outputs.result;
  const F = t.floors;
  const m = r.results.get('metrics').outputs;
  const mid = F[Math.floor(F.length / 2)];
  return { ms: ms.toFixed(0), base: `${F[0].w.toFixed(0)}x${F[0].d.toFixed(0)}`, top: `${F.at(-1).w.toFixed(0)}x${F.at(-1).d.toFixed(0)}`,
    rotBase: (F[0].rot * 180 / Math.PI).toFixed(0), rotTop: (F.at(-1).rot * 180 / Math.PI).toFixed(0),
    roundTop: F.at(-1).round.toFixed(2), gfa: Math.round(m.gfa), steel_m3: Math.round(m.material), momentMNm: Math.round(m.moment) };
};
console.log('--- wind speed (Manhattan)');
for (const v of [0, 20, 40, 60]) console.log(v, JSON.stringify(run('Manhattan block', { wind: { speed: v } })));
console.log('--- sun weight');
for (const w of [0, 0.7, 2]) console.log(w, JSON.stringify(run('Manhattan block', { stream: { sunWeight: w } })));
console.log('--- context');
console.log('Manhattan', JSON.stringify(run('Manhattan block')));
console.log('Dubai    ', JSON.stringify(run('Dubai plots')));
console.log('--- cost (ms) for one full evaluation');
console.log('150 floors x 150 it ', run('Manhattan block', { tower: { floors: 150 } }).ms);
console.log('60 floors x 1000 it ', run('Manhattan block', { end: { iterations: 1000 } }).ms);
