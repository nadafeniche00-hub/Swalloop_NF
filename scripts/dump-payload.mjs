// Writes a sample export payload so the FreeCAD script can be tested without the app.
import { writeFileSync } from 'node:fs';
import { evaluate } from '../src/core/engine.js';
import { registry } from '../src/core/registry.js';
import '../src/packs/index.js';
const p = registry.templates['Manhattan block']();
const r = evaluate(p.nodes, p.edges, registry);
const v = r.results.get('view').inputs;
writeFileSync(process.argv[2], JSON.stringify({ tower: v.tower, context: v.context }));
