import { evaluate } from '../src/core/engine.js';
import { registry } from '../src/core/registry.js';
import '../src/packs/index.js';
const p = registry.templates[process.argv[3] || 'Manhattan block']();
const over = JSON.parse(process.argv[2] || '{}');
for (const [id, v] of Object.entries(over)) Object.assign(p.nodes.find(n => n.id === id).data.params, v);
const r = evaluate(p.nodes, p.edges, registry);
const end = r.results.get('end');
if (end.error) { console.log('ERR', end.error); process.exit(); }
const t = end.outputs.result;
console.log('iters', end.outputs.count, 'delta', end.outputs.delta.toFixed(4));
for (const i of [0, 10, 20, 30, 40, 50, 59]) { const f = t.floors[i]; console.log(i, 'round', f.round.toFixed(2), 'w', f.w.toFixed(1), 'd', f.d.toFixed(1), 'rot', (f.rot*180/Math.PI).toFixed(0), 'util', f.util.toFixed(2), 'shield', f.wind.toFixed(2)); }
const m = r.results.get('metrics').outputs; console.log(m);
