// Golden outputs: what the JS engine computes. The C# port (dotnet/) must reproduce these
// numbers; its test project compares against them.
//   node scripts/dump-golden.mjs
//
// 1. one file per template in /templates              -> dotnet/golden/<template>.golden.json
// 2. a few "cases": a template with parameter overrides, so paths the templates do not use
//    (limits, twist cap, refined search, the Structure clamp, an adopted snapshot) are compared too
//                                                       -> dotnet/golden/case-<name>.golden.json
//    and dotnet/golden/cases.json with the case definitions the C# tests read.
//
// Each golden file is { name, nodes: { id: { error?, outputs } } }. History records are summarised
// (count, max, number of frames, whether the last frame equals the result) because their frames
// repeat the same tower many times over.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluate } from '../src/core/engine.js';
import { fileToGraph } from '../src/core/graphFile.js';
import { registry } from '../src/core/registry.js';
import '../src/packs/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const outDir = root + 'dotnet/golden/';
mkdirSync(outDir, { recursive: true });

const norm = (v) => {
  if (v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v); // Infinity, NaN
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]));
  return v;
};

function dump(g) {
  const r = evaluate(g.nodes, g.edges, registry);
  const nodes = {};
  for (const [id, res] of r.results) {
    if (res.error) {
      nodes[id] = { error: res.error };
      continue;
    }
    const outputs = {};
    for (const [port, v] of Object.entries(res.outputs ?? {})) {
      if (port === 'history' && v && Array.isArray(v.frames)) {
        const last = v.frames[v.frames.length - 1];
        outputs[port] = {
          count: v.count,
          max: v.max,
          frames: v.frames.length,
          lastEqualsResult: JSON.stringify(norm(last)) === JSON.stringify(norm(res.outputs.result)),
        };
      } else outputs[port] = norm(v);
    }
    nodes[id] = { outputs };
  }
  return { nodes, results: r.results };
}

const readTemplate = (name) => JSON.parse(readFileSync(root + `templates/${name}.swalloop.json`, 'utf8'));

// ---- 1. templates ----------------------------------------------------------------------
const templates = readdirSync(root + 'templates').filter((n) => n.endsWith('.swalloop.json'));
for (const f of templates) {
  const file = JSON.parse(readFileSync(root + 'templates/' + f, 'utf8'));
  const { nodes } = dump(fileToGraph(file, registry));
  writeFileSync(outDir + f.replace('.swalloop.json', '.golden.json'), JSON.stringify({ name: file.name, nodes }));
}

// ---- 2. cases --------------------------------------------------------------------------
// The adopted snapshot is made the way the editor makes it: Tower's adopt() on a real loop result.
const manhattan = dump(fileToGraph(readTemplate('skyscraper-manhattan'), registry));
const adoptedParams = registry.nodeTypes.tower.adopt(manhattan.results.get('end').outputs.result);

const CASES = [
  { name: 'limits-size', template: 'skyscraper-manhattan', over: { stream: { minW: 38, minD: 24, minRadius: 6 } } },
  { name: 'limits-rotation', template: 'skyscraper-manhattan', over: { stream: { maxStep: 3, maxTwist: 20 } } },
  { name: 'structure-keeps-limits', template: 'skyscraper-manhattan', over: { stream: { minW: 30, minD: 30 }, struct: { maxPlate: 25, minPlate: 10 } } },
  { name: 'smooth-refined-dubai', template: 'skyscraper-dubai', over: { stream: { smooth: 0.5, search: 'Refined', aspect: 2.6 }, end: { tolerance: 0.01 } } },
  { name: 'smooth-grid', template: 'skyscraper-manhattan', over: { stream: { smooth: 0.8 }, end: { tolerance: 0.01, iterations: 60 } } },
  { name: 'adopted-start', template: 'skyscraper-manhattan', over: { tower: adoptedParams } },
  { name: 'twisted-start', template: 'skyscraper-manhattan', over: { tower: { twist: 60, floors: 33 } } },
  { name: 'wind-from-east', template: 'skyscraper-dubai', over: { wind: { from: 90, speed: 25 }, sun: { azimuth: 220, altitude: 20 } } },
  // the analysis pack: the other branch of each node
  { name: 'fourier-periodic-step', template: 'analysis-fourier-loft', over: { prof: { quantity: 'Rotation (deg)' }, four: { keep: 8, edge: 'Periodic' }, fc: { keep: 10 }, out: { floor: 12 } } },
  { name: 'integrate-trapezoid', template: 'analysis-log-wind', over: { rough: { value: 0.1 }, shear: { method: 'Trapezoid' }, mom: { method: 'Trapezoid' } } },
  { name: 'matrix-growing', template: 'analysis-matrix-twist', over: { turn: { value: -7 }, shrink: { value: 1.01 }, base: { n: 5, aspect: 0.7, rotate: 15 } } },
  { name: 'tower-log-open-terrain', template: 'analysis-tower-log-wind', over: { rough: { value: 0.05 } } },
  { name: 'splat-coarse-grid', template: 'analysis-splat-shelter', over: { add: { n: 20, extent: 150, gain: 0.5 }, comp: { n: 20, extent: 150 }, spl: { hRef: 60 } } },
];

for (const c of CASES) {
  const file = readTemplate(c.template);
  const g = fileToGraph(file, registry);
  for (const [id, params] of Object.entries(c.over)) Object.assign(g.nodes.find((n) => n.id === id).data.params, params);
  const { nodes } = dump(g);
  writeFileSync(outDir + `case-${c.name}.golden.json`, JSON.stringify({ name: c.name, nodes }));
}
writeFileSync(outDir + 'cases.json', JSON.stringify(CASES));

console.log(`wrote ${templates.length} template golden files and ${CASES.length} cases to dotnet/golden/`);
