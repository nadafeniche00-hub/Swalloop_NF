// Swalloop graph files: a whole canvas as plain JSON.
//
// A template is just one of these files; the tower case is an instance, not code.
// The format is deliberately small and free of editor details so another host
// (a Grasshopper plugin, a headless runner) can read the same files.
// See docs/graph-format.md.
//
//   {
//     "format": "swalloop-graph", "version": 1,
//     "name": "...", "description": "...", "group": "...", "featured": false,
//     "nodes": [{ "id": "end", "type": "loopEnd", "position": { "x": 0, "y": 0 }, "params": { ... } }],
//     "edges": [{ "from": "tower.tower", "to": "start.initial" }]       // "node.port"
//   }
//
// Plain JS and no registry import (it is passed in), so headless scripts and
// the registry itself can use it without a cycle.

export const FORMAT = 'swalloop-graph';
export const VERSION = 1;

const round = (v) => Math.round(v * 10) / 10;
const splitRef = (ref) => {
  const i = String(ref).lastIndexOf('.');
  return i < 0 ? [String(ref), ''] : [ref.slice(0, i), ref.slice(i + 1)];
};

// Editor graph (React Flow shape) -> file object.
export function graphToFile(graph, meta = {}) {
  const { nodes, edges } = graph;
  return {
    format: FORMAT,
    version: VERSION,
    name: meta.name ?? 'Untitled',
    description: meta.description ?? '',
    ...(meta.group ? { group: meta.group } : {}),
    ...(meta.featured ? { featured: true } : {}),
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.type,
      position: { x: round(n.position?.x ?? 0), y: round(n.position?.y ?? 0) },
      params: { ...n.data.params },
    })),
    edges: edges.map((e) => ({ from: `${e.source}.${e.sourceHandle}`, to: `${e.target}.${e.targetHandle}` })),
  };
}

// File object -> editor graph. Throws Error with a readable message when the file
// cannot be used at all; smaller issues are returned as `problems` and skipped.
export function fileToGraph(file, registry) {
  if (!file || typeof file !== 'object' || file.format !== FORMAT) {
    throw new Error(`Not a Swalloop graph file (expected format "${FORMAT}").`);
  }
  if (typeof file.version !== 'number' || file.version > VERSION) {
    throw new Error(`This file is version ${file.version}; this app reads up to version ${VERSION}.`);
  }
  if (!Array.isArray(file.nodes) || !Array.isArray(file.edges)) {
    throw new Error('The file needs "nodes" and "edges" lists.');
  }

  const unknown = [...new Set(file.nodes.map((n) => n.type).filter((t) => !registry.nodeTypes[t]))];
  if (unknown.length) {
    throw new Error(`Unknown node type${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. A pack may be missing.`);
  }
  const ids = new Set();
  for (const n of file.nodes) {
    if (typeof n.id !== 'string' || !n.id) throw new Error('Every node needs a string "id".');
    if (ids.has(n.id)) throw new Error(`Duplicate node id "${n.id}".`);
    ids.add(n.id);
  }

  const problems = [];
  const nodes = file.nodes.map((n, i) => ({
    id: n.id,
    type: 'op',
    position: { x: n.position?.x ?? 60 + (i % 6) * 40, y: n.position?.y ?? 60 + Math.floor(i / 6) * 40 },
    // defaults first, so a file written before a parameter existed still loads
    data: { type: n.type, params: { ...registry.defaultParams(n.type), ...(n.params || {}) } },
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const edges = [];
  for (const e of file.edges) {
    const [source, sourceHandle] = splitRef(e.from);
    const [target, targetHandle] = splitRef(e.to);
    const s = byId.get(source);
    const t = byId.get(target);
    if (!s || !t) {
      problems.push(`Wire ${e.from} -> ${e.to}: unknown node.`);
      continue;
    }
    const sd = registry.nodeTypes[s.data.type];
    const td = registry.nodeTypes[t.data.type];
    if (!sd.outputs.some((o) => o.id === sourceHandle)) {
      problems.push(`Wire ${e.from} -> ${e.to}: "${source}" has no output "${sourceHandle}".`);
      continue;
    }
    const takes = td.inputs.some((p) => p.id === targetHandle) || td.params.some((p) => p.id === targetHandle && !p.select);
    if (!takes) {
      problems.push(`Wire ${e.from} -> ${e.to}: "${target}" has no input "${targetHandle}".`);
      continue;
    }
    edges.push({ id: `${source}.${sourceHandle}-${target}.${targetHandle}`, source, sourceHandle, target, targetHandle });
  }

  return {
    nodes,
    edges,
    problems,
    meta: {
      name: file.name ?? 'Untitled',
      description: file.description ?? '',
      group: file.group ?? '',
      featured: Boolean(file.featured),
    },
  };
}
