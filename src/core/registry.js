// The registry: what node types, data types and templates exist.
//
// The engine knows nothing about any domain. A pack (see packs/) adds its own
// node types, categories, data types and example graphs through registerPack().
//
//   pack = {
//     id, nodeTypes, categories: [{ name, color, order }],
//     dataTypes: [{ name, is(value), distance(a, b) }],   // optional
//     templates: { 'Name': () => ({ nodes, edges }) },    // optional, built in code
//     templateFiles: [graphFile, ...],                    // optional, see graphFile.js
//   }
import { CORE_CATEGORIES, CORE_NODES } from './nodes.js';
import { fileToGraph } from './graphFile.js';

const nodeTypes = { ...CORE_NODES };
const dataTypes = [];
const categoryMap = new Map(CORE_CATEGORIES.map((c) => [c.name, c]));
const templates = {};
const templateInfo = {}; // name -> { description, group, featured, pack }
const packs = new Set();

// How much did a loop state change? Numbers, lists and records are compared
// recursively; a data type from a pack can supply its own distance instead.
function distance(a, b) {
  for (const t of dataTypes) if (t.is(a) && t.is(b)) return t.distance(a, b);
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b);
  if (a === b) return 0;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return Infinity;
    return a.reduce((m, v, i) => Math.max(m, distance(v, b[i])), 0);
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    let m = 0;
    for (const k of keys) m = Math.max(m, distance(a[k], b[k]));
    return m;
  }
  return Infinity;
}

export function registerPack(pack) {
  if (packs.has(pack.id)) return; // safe against hot reloads
  for (const id of Object.keys(pack.nodeTypes)) {
    if (nodeTypes[id]) throw new Error(`Pack "${pack.id}": node type "${id}" already exists`);
  }
  Object.assign(nodeTypes, pack.nodeTypes);
  for (const c of pack.categories || []) categoryMap.set(c.name, c);
  dataTypes.push(...(pack.dataTypes || []));
  Object.assign(templates, pack.templates || {});
  // Template files: the template is data. Each call builds a fresh graph.
  for (const file of pack.templateFiles || []) {
    if (templates[file.name]) throw new Error(`Pack "${pack.id}": template "${file.name}" already exists`);
    templates[file.name] = () => {
      const g = fileToGraph(file, registry);
      return { nodes: g.nodes, edges: g.edges };
    };
    templateInfo[file.name] = {
      description: file.description ?? '',
      group: file.group ?? pack.id,
      featured: Boolean(file.featured),
      pack: pack.id,
    };
  }
  for (const id of Object.keys(pack.nodeTypes)) nodeTypes[id].pack = pack.id;
  packs.add(pack.id);
}

export const registry = {
  nodeTypes,
  dataTypes,
  templates,
  templateInfo,
  distance,
  registerPack,
  get categories() {
    return [...categoryMap.values()].sort((a, b) => a.order - b.order);
  },
  categoryColor: (name) => categoryMap.get(name)?.color ?? '#8fa0a6',
  defaultParams: (type) =>
    Object.fromEntries(nodeTypes[type].params.map((p) => [p.id, p.default])),
  portType: (type, handleId) => {
    const def = nodeTypes[type];
    const port =
      def.inputs.find((i) => i.id === handleId) || def.outputs.find((o) => o.id === handleId);
    if (port) return port.type;
    return def.params.some((p) => p.id === handleId && !p.select) ? 'number' : 'any';
  },
};
