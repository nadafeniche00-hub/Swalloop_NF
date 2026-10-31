// Prints a compact fingerprint of both templates; used to check that a change leaves results untouched.
//   node scripts/snapshot.mjs > before.json
import { evaluate } from '../src/core/engine.js';
import { registry } from '../src/core/registry.js';
import '../src/packs/index.js';
const out = {};
for (const name of Object.keys(registry.templates)) {
  const p = registry.templates[name]();
  if (!p.nodes.some((n) => n.id === 'metrics')) continue; // tower templates only
  const r = evaluate(p.nodes, p.edges, registry);
  const end = r.results.get('end').outputs;
  const m = r.results.get('metrics').outputs;
  const F = end.result.floors;
  out[name] = {
    count: end.count,
    metrics: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, +v.toFixed(6)])),
    floors: F.filter((_, i) => i % 7 === 0).map((f) => [f.w, f.d, f.rot, f.round, f.util].map((v) => +v.toFixed(6))),
  };
}
console.log(JSON.stringify(out, null, 1));
