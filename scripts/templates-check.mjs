// Evaluates every registered template headless and prints what its Loop End produced.
import { evaluate } from '../src/core/engine.js';
import { registry } from '../src/core/registry.js';
import '../src/packs/index.js';

for (const name of Object.keys(registry.templates)) {
  const p = registry.templates[name]();
  const r = evaluate(p.nodes, p.edges, registry);
  const errs = [...r.results].filter(([, v]) => v.error).map(([k, v]) => `${k}: ${v.error}`);
  const end = r.results.get('end')?.outputs;
  const result = !end ? '-' : typeof end.result === 'number' ? end.result.toPrecision(7) : Array.isArray(end.result) ? JSON.stringify(end.result) : 'tower';
  console.log(name.padEnd(44), `iterations=${String(end?.count).padStart(3)}/${end?.history.max}`, `result=${result}`, errs.length ? errs : '');
}
