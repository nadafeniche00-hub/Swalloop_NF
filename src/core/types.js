// Port types, with Loop Start / Loop End made polymorphic.
//
// Most ports have a fixed type from their node definition. A loop is generic:
// Loop Start's `state` takes the type of whatever is wired into `Initial`, and
// the paired Loop End must receive, and returns, that same type.

import { pairLoops } from './engine.js';

export const compatible = (a, b) => a === 'any' || b === 'any' || a === b;

export function resolveTypes(nodes, edges, registry) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map(); // nodeId -> Map(targetHandle -> edge)
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    if (!incoming.has(e.target)) incoming.set(e.target, new Map());
    incoming.get(e.target).set(e.targetHandle, e);
  }
  const pairs = pairLoops(nodes, edges);

  const typeOfNode = (id) => byId.get(id)?.data.type;

  function outType(id, handle, depth = 0) {
    if (depth > 64) return 'any'; // malformed graph
    const type = typeOfNode(id);
    if (!type) return 'any';
    if (type === 'loopStart' && handle === 'state') {
      const e = incoming.get(id)?.get('initial');
      return e ? outType(e.source, e.sourceHandle, depth + 1) : 'any';
    }
    if (type === 'loopEnd' && handle === 'result') {
      if (byId.get(id).data.params?.kind === 'For each') return 'list'; // one result per item
      const start = pairs.get(id);
      return start ? outType(start, 'state', depth + 1) : 'any';
    }
    return registry.portType(type, handle);
  }

  function inType(id, handle) {
    const type = typeOfNode(id);
    if (!type) return 'any';
    if (type === 'loopEnd' && handle === 'result') {
      if (byId.get(id).data.params?.kind === 'For each') return 'any'; // the body may produce anything
      const start = pairs.get(id);
      return start ? outType(start, 'state') : 'any';
    }
    return registry.portType(type, handle);
  }

  return {
    pairs,
    inType,
    outType,
    edgeOk: (e) => compatible(outType(e.source, e.sourceHandle), inType(e.target, e.targetHandle)),
  };
}
