// Evaluation engine.
//
// The canvas is a DAG (no wire may point backwards), exactly like Grasshopper.
// Loops are the deliberate loophole (the swallow's way home): a Loop End re-evaluates everything that
// sits between itself and its paired Loop Start, N times, and the value that
// arrives at Loop End becomes the next output of Loop Start. The wire back is
// never drawn; the feedback goes through memory.

export const MAX_ITERATIONS = 5000;
export const MAX_FRAMES = 200;

// Would a wire source -> target close a cycle?
export function wouldCycle(edges, source, target) {
  if (source === target) return true;
  const incoming = new Map();
  for (const e of edges) {
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target).push(e.source);
  }
  const seen = new Set();
  const stack = [source];
  while (stack.length) {
    const id = stack.pop();
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const s of incoming.get(id) || []) stack.push(s);
  }
  return false;
}

const thin = (frames) => {
  if (frames.length <= MAX_FRAMES) return frames;
  const stride = (frames.length - 1) / (MAX_FRAMES - 1);
  return Array.from({ length: MAX_FRAMES }, (_, i) => frames[Math.round(i * stride)]);
};

// Pair every Loop End with the nearest unclaimed Loop Start upstream.
// Inner loops are paired first so nested loops resolve correctly.
export function pairLoops(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sources = new Map();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    if (!sources.has(e.target)) sources.set(e.target, []);
    sources.get(e.target).push(e.source);
  }
  const ancestors = (id) => {
    const seen = new Map([[id, 0]]);
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift();
      for (const s of sources.get(cur) || []) {
        if (!seen.has(s)) {
          seen.set(s, seen.get(cur) + 1);
          queue.push(s);
        }
      }
    }
    return seen;
  };
  const pairs = new Map();
  const claimed = new Set();
  nodes
    .filter((n) => n.data.type === 'loopEnd')
    .map((n) => ({ n, anc: ancestors(n.id) }))
    .sort((a, b) => a.anc.size - b.anc.size)
    .forEach(({ n, anc }) => {
      const candidates = [...anc.entries()]
        .filter(([id]) => byId.get(id).data.type === 'loopStart' && !claimed.has(id))
        .sort((a, b) => a[1] - b[1]);
      if (candidates.length) {
        pairs.set(n.id, candidates[0][0]);
        claimed.add(candidates[0][0]);
      }
    });
  return pairs;
}

export function evaluate(nodes, edges, registry) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map(); // nodeId -> Map(targetHandle -> edge)
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    if (!incoming.has(e.target)) incoming.set(e.target, new Map());
    incoming.get(e.target).set(e.targetHandle, e);
  }
  const upstream = (id) => [...(incoming.get(id)?.values() || [])].map((e) => e.source);

  // Does `id` (transitively) read from `startId`?
  const depMemo = new Map();
  const dependsOn = (id, startId) => {
    if (id === startId) return true;
    const key = `${id}|${startId}`;
    if (depMemo.has(key)) return depMemo.get(key);
    depMemo.set(key, false); // guards against cycles in malformed input
    const r = upstream(id).some((s) => dependsOn(s, startId));
    depMemo.set(key, r);
    return r;
  };

  const pairs = pairLoops(nodes, edges);

  const root = { memo: new Map() };

  const gather = (node, scope, skip = []) => {
    const def = registry.nodeTypes[node.data.type];
    const wires = incoming.get(node.id) || new Map();
    const inputs = {};
    const params = { ...node.data.params };
    for (const port of def.inputs) {
      if (skip.includes(port.id)) continue;
      const e = wires.get(port.id);
      if (!e) {
        if (!port.optional) return { error: `Missing input "${port.label}"` };
        continue;
      }
      const r = evalNode(e.source, scope);
      if (r.error) return { error: 'Upstream error' };
      inputs[port.id] = r.outputs[e.sourceHandle];
    }
    for (const p of def.params) {
      const e = wires.get(p.id);
      if (!e || p.select) continue;
      const r = evalNode(e.source, scope);
      if (r.error) return { error: 'Upstream error' };
      params[p.id] = r.outputs[e.sourceHandle];
    }
    return { inputs, params };
  };

  // Loop kinds (see the Loop End node): Repeat, While, Fold, For each.
  // The optional Condition is evaluated inside the loop body's scope at the
  // start of each iteration, so it sees the current state.
  const runLoop = (node, scope) => {
    const startId = pairs.get(node.id);
    if (!startId) return { error: 'No Loop Start upstream' };
    const g = gather(node, scope, ['result', 'condition', 'items']);
    if (g.error) return { error: g.error };
    const wires = incoming.get(node.id) || new Map();
    const resultWire = wires.get('result');
    if (!resultWire) return { error: 'Missing input "Result"' };
    const condWire = wires.get('condition');
    const kind = g.params.kind ?? 'Repeat';
    const perItem = kind === 'Fold' || kind === 'For each';
    const mapping = kind === 'For each';

    let items = null;
    if (perItem) {
      const itemsWire = wires.get('items');
      if (!itemsWire) return { error: `"${kind}" needs a list on Items` };
      const r = evalNode(itemsWire.source, scope);
      if (r.error) return { error: 'Upstream error' };
      items = r.outputs[itemsWire.sourceHandle];
      if (!Array.isArray(items)) return { error: 'Items must be a list' };
    }
    if (!mapping && !incoming.get(startId)?.has('initial')) {
      return { error: 'Loop Start needs an Initial value' };
    }
    let state;
    if (!mapping) {
      const init = evalNode(startId, scope);
      if (init.error) return { error: 'Upstream error' };
      state = init.outputs.state;
    }

    const limit = perItem
      ? Math.min(items.length, MAX_ITERATIONS)
      : Math.min(MAX_ITERATIONS, Math.max(0, Math.floor(g.params.iterations)));
    const tol = perItem ? 0 : g.params.tolerance;
    const results = []; // For each: the collected body results
    const stride = Math.max(1, Math.ceil(limit / MAX_FRAMES));
    const history = [mapping ? [] : state];
    let delta = Infinity;
    let done = 0;

    for (let i = 0; i < limit; i++) {
      const child = {
        start: startId,
        startOut: { state, index: i, item: items ? items[i] : undefined },
        memo: new Map(),
        parent: scope,
      };
      if (condWire) {
        const c = evalNode(condWire.source, child);
        if (c.error) return { error: 'Error in the condition' };
        const flag = Boolean(c.outputs[condWire.sourceHandle]);
        if (kind === 'While' ? !flag : flag) break;
      }
      const r = evalNode(resultWire.source, child);
      if (r.error) return { error: 'Error inside the loop body' };
      const next = r.outputs[resultWire.sourceHandle];
      done++;
      if (mapping) {
        results.push(next);
        if (done % stride === 0 || i === limit - 1) history.push(results.slice());
        continue;
      }
      delta = registry.distance(state, next);
      state = next;
      history.push(state);
      if (tol > 0 && delta <= tol) break;
    }
    return {
      outputs: {
        result: mapping ? results : state,
        history: { frames: thin(history), count: done, max: limit },
        count: done,
        delta: Number.isFinite(delta) ? delta : 0,
      },
      inputs: g.inputs,
    };
  };

  function evalNode(id, ctx) {
    // The owning scope is the innermost loop whose Start this node depends on.
    let scope = ctx;
    while (scope.start && !dependsOn(id, scope.start) && scope.parent) scope = scope.parent;

    if (scope.memo.has(id)) return scope.memo.get(id);
    if (scope.start === id) return { outputs: scope.startOut, inputs: {} };

    const node = byId.get(id);
    const def = registry.nodeTypes[node.data.type];
    let result;
    try {
      if (node.data.type === 'loopEnd') {
        result = runLoop(node, scope);
      } else {
        const g = gather(node, scope);
        result = g.error
          ? { error: g.error }
          : { outputs: def.compute(g.inputs, g.params), inputs: g.inputs, params: g.params };
      }
    } catch (err) {
      result = { error: err.message };
    }
    scope.memo.set(id, result);
    return result;
  }

  const results = new Map();
  for (const n of nodes) results.set(n.id, evalNode(n.id, root));
  return { results, pairs };
}
