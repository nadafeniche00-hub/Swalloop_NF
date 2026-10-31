// Writes the five analysis templates into /templates. Each graph is built here, in code, then run
// through the real loader (fileToGraph) and the engine so a template that does not load or does not
// evaluate is refused before it is written.
//   node scripts/make-analysis-templates.mjs
//
// The templates are plain data afterwards; edit them in the app and save, or re-run this script.
// Bootstrap: src/packs/analysis/pack.js imports the five files, so they must exist before this script
// can load the packs. On a fresh clone they do. If you deleted them, seed each with
// {"format":"swalloop-graph","version":1,"name":"x","nodes":[],"edges":[]} and run this again.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluate } from '../src/core/engine.js';
import { fileToGraph, graphToFile } from '../src/core/graphFile.js';
import { registry } from '../src/core/registry.js';
import '../src/packs/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const GROUP = 'Analysis and vision';

const node = (id, type, x, y, params = {}) => ({
  id,
  type: 'op',
  position: { x, y },
  data: { type, params: { ...registry.defaultParams(type), ...params } },
});
const wire = (source, sourceHandle, target, targetHandle) => ({
  id: `${source}.${sourceHandle}-${target}.${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});

// The Manhattan loop from the skyscraper template, reused by two of the analysis templates.
function manhattanCore() {
  const nodes = [
    node('ctx', 'context', 0, 420, { style: 'Manhattan' }),
    node('tower', 'tower', 0, 0),
    node('start', 'loopStart', 300, 0),
    node('wind', 'wind', 540, 0),
    node('stream', 'orient', 800, 0),
    node('struct', 'structure', 1050, 0),
    node('end', 'loopEnd', 1330, 0, { tolerance: 0.01, iterations: 150 }),
  ];
  const edges = [
    wire('tower', 'tower', 'start', 'initial'),
    wire('start', 'state', 'wind', 'tower'),
    wire('ctx', 'context', 'wind', 'context'),
    wire('wind', 'tower', 'stream', 'tower'),
    wire('stream', 'tower', 'struct', 'tower'),
    wire('struct', 'tower', 'end', 'result'),
  ];
  return { nodes, edges };
}

const TEMPLATES = {};

// 1. Logarithms and integrals on a wind profile --------------------------------------------------
TEMPLATES['analysis-log-wind'] = {
  name: 'Log wind profile',
  description:
    'The logarithmic wind profile for a terrain roughness, turned into a pressure profile and integrated: base shear and overturning moment per metre of width, and the power-law exponent that matches this terrain.',
  nodes: [
    node('z', 'range', 0, 0, { count: 30, start: 10, step: 10 }),
    node('rough', 'number', 0, 200, { value: 1, min: 0.01, max: 3 }),
    node('vref', 'number', 0, 330, { value: 40, min: 10, max: 60 }),
    node('log', 'logWind', 280, 0),
    node('sq', 'listMath', 560, 0, { op: '×' }),
    node('q', 'listMath', 820, 0, { op: '×', s: 0.0006125 }),
    node('shear', 'integrate', 1080, 0, { method: 'Simpson', weight: 'f' }),
    node('mom', 'integrate', 1080, 230, { method: 'Simpson', weight: 'x·f' }),
    node('speeds', 'inspect', 560, 260),
    node('pressure', 'inspect', 820, 260),
    node('r1', 'readout', 1360, 0),
    node('r2', 'readout', 1360, 110),
    node('r3', 'readout', 1360, 220),
  ],
  edges: [
    wire('z', 'list', 'log', 'z'),
    wire('rough', 'value', 'log', 'z0'),
    wire('vref', 'value', 'log', 'vRef'),
    wire('log', 'speed', 'sq', 'a'),
    wire('log', 'speed', 'sq', 'b'),
    wire('sq', 'result', 'q', 'a'),
    wire('q', 'result', 'shear', 'y'),
    wire('z', 'list', 'shear', 'x'),
    wire('q', 'result', 'mom', 'y'),
    wire('z', 'list', 'mom', 'x'),
    wire('log', 'speed', 'speeds', 'value'),
    wire('q', 'result', 'pressure', 'value'),
    wire('log', 'alpha', 'r1', 'value'),
    wire('shear', 'integral', 'r2', 'value'),
    wire('mom', 'integral', 'r3', 'value'),
  ],
};

// 2. The tower, with the wind exponent taken from the roughness ------------------------------------
{
  const c = manhattanCore();
  TEMPLATES['analysis-tower-log-wind'] = {
    name: 'Tower in log-law wind',
    description:
      'The Manhattan loop with its wind exponent computed from the logarithmic profile of the terrain roughness, instead of typed in. Change the roughness and the whole form follows.',
    nodes: [
      ...c.nodes,
      node('z', 'range', 540, 330, { count: 30, start: 10, step: 10 }),
      node('rough', 'number', 540, 520, { value: 1, min: 0.01, max: 3 }),
      node('log', 'logWind', 800, 330),
      node('sun', 'sun', 1590, 0),
      node('metrics', 'metrics', 1590, 330),
      node('view', 'viewer', 1860, 0),
      node('r1', 'readout', 1860, 330),
      node('r2', 'readout', 1860, 440),
      node('r3', 'readout', 2080, 330),
    ],
    edges: [
      ...c.edges,
      wire('z', 'list', 'log', 'z'),
      wire('rough', 'value', 'log', 'z0'),
      wire('log', 'alpha', 'wind', 'alpha'),
      wire('end', 'result', 'sun', 'tower'),
      wire('ctx', 'context', 'sun', 'context'),
      wire('sun', 'tower', 'view', 'tower'),
      wire('ctx', 'context', 'view', 'context'),
      wire('end', 'history', 'view', 'history'),
      wire('end', 'result', 'metrics', 'tower'),
      wire('log', 'alpha', 'r1', 'value'),
      wire('metrics', 'moment', 'r2', 'value'),
      wire('metrics', 'gfa', 'r3', 'value'),
    ],
  };
}

// 3. Fourier: the loft profile and the outline of one floor ------------------------------------------
{
  const c = manhattanCore();
  TEMPLATES['analysis-fourier-loft'] = {
    name: 'Fourier: simplify the loft',
    description:
      'Low-pass the result of the loop two ways: the floor-by-floor width profile (four harmonics describe the whole taper, which is what a panel layout needs) and the outline of the top floor (fewer harmonics, a simpler outline to build). Try Rotation in the Floor profile node: it has a step where the optimiser flips orientation, and a low-pass rings there (the Gibbs effect).',
    nodes: [
      ...c.nodes,
      node('prof', 'profile', 1590, 0, { quantity: 'Width' }),
      node('four', 'fourier', 1860, 0, { keep: 4, edge: 'Mirror' }),
      node('both', 'pack', 2130, 0),
      node('loft', 'inspect', 2400, 0),
      node('out', 'outline', 1590, 330, { floor: 999 }),
      node('fc', 'fourierCurve', 1860, 330, { keep: 3 }),
      node('rings', 'pack', 2130, 330),
      node('outlines', 'inspect', 2400, 330),
      node('r1', 'readout', 2130, 120),
      node('r2', 'readout', 2130, 450),
      node('r3', 'readout', 2400, 450),
    ],
    edges: [
      ...c.edges,
      wire('end', 'result', 'prof', 'tower'),
      wire('prof', 'values', 'four', 'signal'),
      wire('prof', 'values', 'both', 'a'),
      wire('four', 'smooth', 'both', 'b'),
      wire('both', 'list', 'loft', 'value'),
      wire('four', 'retained', 'r1', 'value'),
      wire('end', 'result', 'out', 'tower'),
      wire('out', 'points', 'fc', 'points'),
      wire('out', 'points', 'rings', 'a'),
      wire('fc', 'smooth', 'rings', 'b'),
      wire('rings', 'list', 'outlines', 'value'),
      wire('fc', 'deviation', 'r2', 'value'),
      wire('fc', 'areaKept', 'r3', 'value'),
    ],
  };
}

// 4. Gaussian splats: a shelter map of the context -------------------------------------------------------
TEMPLATES['analysis-splat-shelter'] = {
  name: 'Gaussian splats: shelter map',
  description:
    'Every neighbouring building becomes a 2D Gaussian splat. Added up they are a density map of where the block is tall (shelter and shade); composited front to back by height they are the splat render of the block, the same blending rule as 3D Gaussian splatting.',
  nodes: [
    node('ctx', 'context', 0, 0, { style: 'Manhattan', ring: 3 }),
    node('spl', 'splats', 280, 0, { hRef: 150 }),
    node('add', 'splatField', 560, 0, { n: 56, extent: 260, mode: 'Additive' }),
    node('comp', 'splatField', 560, 260, { n: 56, extent: 260, mode: 'Composite', gain: 1 }),
    node('shelter', 'inspect', 840, 0),
    node('render', 'inspect', 840, 260),
    node('r1', 'readout', 840, 520),
    node('r2', 'readout', 1060, 520),
  ],
  edges: [
    wire('ctx', 'context', 'spl', 'context'),
    wire('spl', 'splats', 'add', 'splats'),
    wire('spl', 'splats', 'comp', 'splats'),
    wire('add', 'field', 'shelter', 'value'),
    wire('comp', 'field', 'render', 'value'),
    wire('add', 'max', 'r1', 'value'),
    wire('comp', 'max', 'r2', 'value'),
  ],
};

// 5. Linear algebra: a twisting, tapering tower from matrix powers ---------------------------------------
TEMPLATES['analysis-matrix-twist'] = {
  name: 'Matrix powers: twisting tower',
  description:
    'One 3x3 matrix (turn a little, shrink a little) applied floor after floor: floor i is the base outline times M to the power i. A For each loop builds every outline; the principal axes of the top outline read back the twist.',
  nodes: [
    node('base', 'polygon', 0, 0, { n: 6, radius: 24, aspect: 1.6, rotate: 0 }),
    node('turn', 'number', 0, 260, { value: 3, min: -10, max: 10 }),
    node('shrink', 'number', 0, 390, { value: 0.985, min: 0.9, max: 1.02 }),
    node('m', 'affine', 280, 260),
    node('floors', 'range', 280, 520, { count: 30, start: 0, step: 1 }),
    node('start', 'loopStart', 560, 0),
    node('mp', 'matpow', 820, 0),
    node('ap', 'applyMatrix', 1080, 0),
    node('end', 'loopEnd', 1340, 0, { kind: 'For each' }),
    node('view', 'inspect', 1620, 0),
    node('top', 'matpow', 820, 330, { k: 29 }),
    node('topPts', 'applyMatrix', 1080, 330),
    node('axes', 'pca', 1340, 330),
    node('r1', 'readout', 1620, 330),
    node('r2', 'readout', 1620, 440),
  ],
  edges: [
    wire('turn', 'value', 'm', 'rotate'),
    wire('shrink', 'value', 'm', 'sx'),
    wire('shrink', 'value', 'm', 'sy'),
    wire('m', 'matrix', 'mp', 'm'),
    wire('start', 'item', 'mp', 'k'),
    wire('mp', 'matrix', 'ap', 'm'),
    wire('base', 'points', 'ap', 'points'),
    wire('ap', 'points', 'end', 'result'),
    wire('floors', 'list', 'end', 'items'),
    wire('end', 'result', 'view', 'value'),
    wire('m', 'matrix', 'top', 'm'),
    wire('top', 'matrix', 'topPts', 'm'),
    wire('base', 'points', 'topPts', 'points'),
    wire('topPts', 'points', 'axes', 'points'),
    wire('axes', 'angle', 'r1', 'value'),
    wire('axes', 'aspect', 'r2', 'value'),
  ],
};

for (const [file, t] of Object.entries(TEMPLATES)) {
  const out = graphToFile({ nodes: t.nodes, edges: t.edges }, { name: t.name, description: t.description, group: GROUP });
  const g = fileToGraph(out, registry); // must load with no skipped wires...
  if (g.problems.length) throw new Error(`${file}: ${g.problems[0]}`);
  const r = evaluate(g.nodes, g.edges, registry); // ...and every node must evaluate
  for (const [id, res] of r.results) if (res.error) throw new Error(`${file}: node ${id}: ${res.error}`);
  writeFileSync(`${root}templates/${file}.swalloop.json`, JSON.stringify(out, null, 2) + '\n');
  console.log(file.padEnd(28), `${out.nodes.length} nodes, ${out.edges.length} wires`);
}
