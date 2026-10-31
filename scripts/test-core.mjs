// Core engine tests with no tower in sight: a made-up pack proves the loop is domain-free.
//   node scripts/test-core.mjs
import assert from 'node:assert/strict';
import { evaluate, pairLoops, wouldCycle } from '../src/core/engine.js';
import { compatible, resolveTypes } from '../src/core/types.js';
import { registry } from '../src/core/registry.js';
import { num } from '../src/core/define.js';

registry.registerPack({
  id: 'test-math',
  categories: [{ name: 'Math', color: '#fff', order: 25 }],
  nodeTypes: {
    // Newton step for sqrt(a): x -> (x + a/x) / 2
    newton: {
      title: 'Newton', category: 'Math',
      inputs: [{ id: 'x', label: 'x', type: 'number' }], outputs: [{ id: 'x', label: 'x', type: 'number' }],
      params: [num('a', 'a', 2)],
      compute: ({ x }, p) => ({ x: (x + p.a / x) / 2 }),
    },
    // Moves a record {pos: [..], note} toward zero; the `note` string never changes
    shrink: {
      title: 'Shrink', category: 'Math',
      inputs: [{ id: 's', label: 's', type: 'any' }], outputs: [{ id: 's', label: 's', type: 'any' }],
      params: [num('k', 'k', 0.5)],
      compute: ({ s }, p) => ({ s: { ...s, pos: s.pos.map((v) => v * p.k) } }),
    },
    record: {
      title: 'Record', category: 'Math', inputs: [], outputs: [{ id: 's', label: 's', type: 'any' }], params: [],
      compute: () => ({ s: { pos: [8, -4, 2], note: 'hello' } }),
    },
    label: {
      title: 'Label', category: 'Math', inputs: [], outputs: [{ id: 't', label: 't', type: 'text' }], params: [],
      compute: () => ({ t: 'abc' }),
    },
    inc: {
      title: 'Inc', category: 'Math',
      inputs: [{ id: 'x', label: 'x', type: 'number' }], outputs: [{ id: 'x', label: 'x', type: 'number' }], params: [],
      compute: ({ x }) => ({ x: x + 1 }),
    },
  },
});

const node = (id, type, params = {}) => ({ id, data: { type, params: { ...registry.defaultParams(type), ...params } } });
const wire = (source, sourceHandle, target, targetHandle) => ({ source, sourceHandle, target, targetHandle });
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

test('numbers: Newton loop converges to sqrt(2) and stops early on tolerance', () => {
  const nodes = [node('n', 'number', { value: 1 }), node('s', 'loopStart'), node('f', 'newton'), node('e', 'loopEnd', { iterations: 100, tolerance: 1e-12 })];
  const edges = [wire('n', 'value', 's', 'initial'), wire('s', 'state', 'f', 'x'), wire('f', 'x', 'e', 'result')];
  const { results } = evaluate(nodes, edges, registry);
  const out = results.get('e').outputs;
  assert.ok(Math.abs(out.result - Math.SQRT2) < 1e-9, out.result);
  assert.ok(out.count < 10, `stopped at ${out.count}`);
});

test('records: generic distance handles objects, arrays and unchanged strings', () => {
  const nodes = [node('r', 'record'), node('s', 'loopStart'), node('f', 'shrink'), node('e', 'loopEnd', { iterations: 200, tolerance: 1e-6 })];
  const edges = [wire('r', 's', 's', 'initial'), wire('s', 'state', 'f', 's'), wire('f', 's', 'e', 'result')];
  const out = evaluate(nodes, edges, registry).results.get('e').outputs;
  assert.equal(out.result.note, 'hello');
  assert.ok(out.result.pos.every((v) => Math.abs(v) < 1e-5));
  assert.ok(out.count < 200);
});

test('tolerance 0 runs to the maximum', () => {
  const nodes = [node('n', 'number', { value: 1 }), node('s', 'loopStart'), node('f', 'newton'), node('e', 'loopEnd', { iterations: 30, tolerance: 0 })];
  const edges = [wire('n', 'value', 's', 'initial'), wire('s', 'state', 'f', 'x'), wire('f', 'x', 'e', 'result')];
  assert.equal(evaluate(nodes, edges, registry).results.get('e').outputs.count, 30);
});

test('history holds every state; index counts from zero', () => {
  const nodes = [node('n', 'number', { value: 0 }), node('s', 'loopStart'), node('f', 'inc'), node('e', 'loopEnd', { iterations: 5, tolerance: 0 })];
  const edges = [wire('n', 'value', 's', 'initial'), wire('s', 'state', 'f', 'x'), wire('f', 'x', 'e', 'result')];
  const out = evaluate(nodes, edges, registry).results.get('e').outputs;
  assert.deepEqual(out.history.frames, [0, 1, 2, 3, 4, 5]);
  assert.equal(out.history.count, 5);
  assert.equal(out.history.max, 5);
});

test('nested loops: inner loop runs inside every outer iteration', () => {
  // outer: 3 iterations of { inner: 4 x inc }  => 0 + 3*4 = 12
  const nodes = [
    node('n', 'number', { value: 0 }), node('so', 'loopStart'), node('si', 'loopStart'), node('f', 'inc'),
    node('ei', 'loopEnd', { iterations: 4, tolerance: 0 }), node('eo', 'loopEnd', { iterations: 3, tolerance: 0 }),
  ];
  const edges = [
    wire('n', 'value', 'so', 'initial'), wire('so', 'state', 'si', 'initial'), wire('si', 'state', 'f', 'x'),
    wire('f', 'x', 'ei', 'result'), wire('ei', 'result', 'eo', 'result'),
  ];
  const { results, pairs } = evaluate(nodes, edges, registry);
  assert.equal(pairs.get('ei'), 'si');
  assert.equal(pairs.get('eo'), 'so');
  assert.equal(results.get('eo').outputs.result, 12);
});

test('errors: Loop End without a Loop Start, and a missing input', () => {
  const lone = evaluate([node('n', 'number'), node('e', 'loopEnd')], [wire('n', 'value', 'e', 'result')], registry);
  assert.match(lone.results.get('e').error, /No Loop Start/);
  const open = evaluate([node('f', 'newton')], [], registry);
  assert.match(open.results.get('f').error, /Missing input/);
});

test('a plain backward wire is refused, a forward one is not', () => {
  const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }];
  assert.equal(wouldCycle(edges, 'c', 'a'), true);
  assert.equal(wouldCycle(edges, 'a', 'c'), false);
});

test('types: Loop Start/End take the type of what feeds Initial', () => {
  const nodes = [node('n', 'number'), node('s', 'loopStart'), node('f', 'newton'), node('e', 'loopEnd')];
  const edges = [wire('n', 'value', 's', 'initial'), wire('s', 'state', 'f', 'x'), wire('f', 'x', 'e', 'result')];
  const t = resolveTypes(nodes, edges, registry);
  assert.equal(t.outType('s', 'state'), 'number');
  assert.equal(t.inType('e', 'result'), 'number');
  assert.equal(t.outType('e', 'result'), 'number');
  assert.ok(edges.every((e) => t.edgeOk(e)));
  // an unwired Initial leaves the loop untyped
  assert.equal(resolveTypes(nodes, [], registry).outType('s', 'state'), 'any');
});

test('types: a text value cannot enter a number loop, and rewiring Initial flags old wires', () => {
  const nodes = [node('n', 'number'), node('l', 'label'), node('s', 'loopStart'), node('f', 'newton'), node('e', 'loopEnd')];
  const base = [wire('n', 'value', 's', 'initial'), wire('s', 'state', 'f', 'x'), wire('f', 'x', 'e', 'result')];
  const t = resolveTypes(nodes, base, registry);
  assert.equal(compatible(t.outType('l', 't'), t.inType('e', 'result')), false);
  // switch Initial to the text node: the number wires downstream are now mismatches
  const rewired = [wire('l', 't', 's', 'initial'), ...base.slice(1)];
  const t2 = resolveTypes(nodes, rewired, registry);
  assert.equal(t2.outType('s', 'state'), 'text');
  assert.equal(t2.edgeOk(base[1]), false); // text into a number input
  assert.equal(t2.edgeOk(base[2]), false); // number result into a text loop end
});

test('types: nested loops keep their own types; pairLoops is exported', () => {
  const nodes = [node('n', 'number'), node('so', 'loopStart'), node('si', 'loopStart'), node('f', 'inc'), node('ei', 'loopEnd'), node('eo', 'loopEnd')];
  const edges = [wire('n', 'value', 'so', 'initial'), wire('so', 'state', 'si', 'initial'), wire('si', 'state', 'f', 'x'), wire('f', 'x', 'ei', 'result'), wire('ei', 'result', 'eo', 'result')];
  const t = resolveTypes(nodes, edges, registry);
  assert.deepEqual([...pairLoops(nodes, edges)], [['ei', 'si'], ['eo', 'so']]);
  assert.equal(t.outType('eo', 'result'), 'number');
});

test('inspector node exists in core and takes any type', () => {
  assert.equal(registry.portType('inspect', 'value'), 'any');
  assert.equal(registry.nodeTypes.inspect.category, 'Output');
});

// ---- loop kinds and the Condition input (core nodes only) ----
const run = (nodes, edges, id = 'e') => evaluate(nodes, edges, registry).results.get(id);

test('Condition (Repeat): stops when true, checked on the current state before each pass', () => {
  // x doubles from 1; stop once x >= 100  => states 1,2,4,...,128 : 7 passes
  const nodes = [node('n', 'number', { value: 1 }), node('s', 'loopStart'), node('d', 'math', { op: '×', b: 2 }),
    node('c', 'compare', { op: '>=', b: 100 }), node('e', 'loopEnd', { iterations: 50, tolerance: 0 })];
  const edges = [wire('n', 'value', 's', 'initial'), wire('s', 'state', 'd', 'a'), wire('d', 'result', 'e', 'result'),
    wire('s', 'state', 'c', 'a'), wire('c', 'result', 'e', 'condition')];
  const out = run(nodes, edges).outputs;
  assert.equal(out.result, 128);
  assert.equal(out.count, 7);
});

test('Condition already true at the start: zero passes, result is the initial value', () => {
  const nodes = [node('n', 'number', { value: 500 }), node('s', 'loopStart'), node('d', 'math', { op: '×', b: 2 }),
    node('c', 'compare', { op: '>=', b: 100 }), node('e', 'loopEnd', { iterations: 50, tolerance: 0 })];
  const edges = [wire('n', 'value', 's', 'initial'), wire('s', 'state', 'd', 'a'), wire('d', 'result', 'e', 'result'),
    wire('s', 'state', 'c', 'a'), wire('c', 'result', 'e', 'condition')];
  const out = run(nodes, edges).outputs;
  assert.equal(out.count, 0);
  assert.equal(out.result, 500);
});

test('While: runs as long as the condition holds, and respects Max iter.', () => {
  const mk = (iterations) => {
    const nodes = [node('n', 'number', { value: 1 }), node('s', 'loopStart'), node('d', 'math', { op: '×', b: 2 }),
      node('c', 'compare', { op: '<', b: 1000 }), node('e', 'loopEnd', { kind: 'While', iterations, tolerance: 0 })];
    const edges = [wire('n', 'value', 's', 'initial'), wire('s', 'state', 'd', 'a'), wire('d', 'result', 'e', 'result'),
      wire('s', 'state', 'c', 'a'), wire('c', 'result', 'e', 'condition')];
    return run(nodes, edges).outputs;
  };
  assert.deepEqual([mk(100).result, mk(100).count], [1024, 10]);
  assert.deepEqual([mk(4).result, mk(4).count], [16, 4]);
});

test('Fold: threads the state through the items (running sum 1..10 = 55)', () => {
  const nodes = [node('r', 'range', { count: 10, start: 1, step: 1 }), node('n', 'number', { value: 0 }), node('s', 'loopStart'),
    node('a', 'math', { op: '+' }), node('e', 'loopEnd', { kind: 'Fold' })];
  const edges = [wire('n', 'value', 's', 'initial'), wire('s', 'state', 'a', 'a'), wire('s', 'item', 'a', 'b'),
    wire('a', 'result', 'e', 'result'), wire('r', 'list', 'e', 'items')];
  const out = run(nodes, edges).outputs;
  assert.equal(out.result, 55);
  assert.equal(out.count, 10);
  assert.deepEqual(out.history.frames, [0, 1, 3, 6, 10, 15, 21, 28, 36, 45, 55]); // running totals
});

test('For each: one independent result per item, collected as a list', () => {
  const nodes = [node('r', 'range', { count: 5, start: 1, step: 1 }), node('s', 'loopStart'),
    node('q', 'math', { op: '×' }), node('e', 'loopEnd', { kind: 'For each' })];
  const edges = [wire('s', 'item', 'q', 'a'), wire('s', 'item', 'q', 'b'), wire('q', 'result', 'e', 'result'), wire('r', 'list', 'e', 'items')];
  const out = run(nodes, edges).outputs;
  assert.deepEqual(out.result, [1, 4, 9, 16, 25]);
  assert.deepEqual(out.history.frames.at(-1), [1, 4, 9, 16, 25]);
  assert.deepEqual(out.history.frames[0], []);
});

test('loop kind errors are explicit', () => {
  const noItems = run([node('n', 'number'), node('s', 'loopStart'), node('e', 'loopEnd', { kind: 'Fold' })],
    [wire('n', 'value', 's', 'initial'), wire('s', 'state', 'e', 'result')]);
  assert.match(noItems.error, /needs a list/);
  const noInitial = run([node('s', 'loopStart'), node('d', 'math'), node('e', 'loopEnd')], [wire('s', 'state', 'd', 'a'), wire('d', 'result', 'e', 'result')]);
  assert.match(noInitial.error, /needs an Initial/);
  const badItems = run([node('n', 'number'), node('s', 'loopStart'), node('e', 'loopEnd', { kind: 'Fold' })],
    [wire('n', 'value', 's', 'initial'), wire('s', 'state', 'e', 'result'), wire('n', 'value', 'e', 'items')]);
  assert.match(badItems.error, /must be a list/);
});

test('nested: a Fold inside a Repeat', () => {
  // outer Repeat 3x: state -> (sum of 1..4 added to state) => 0 + 3*10 = 30
  const nodes = [node('r', 'range', { count: 4, start: 1, step: 1 }), node('n', 'number', { value: 0 }),
    node('so', 'loopStart'), node('si', 'loopStart'), node('a', 'math', { op: '+' }),
    node('ei', 'loopEnd', { kind: 'Fold' }), node('eo', 'loopEnd', { iterations: 3, tolerance: 0 })];
  const edges = [wire('n', 'value', 'so', 'initial'), wire('so', 'state', 'si', 'initial'),
    wire('si', 'state', 'a', 'a'), wire('si', 'item', 'a', 'b'), wire('a', 'result', 'ei', 'result'),
    wire('r', 'list', 'ei', 'items'), wire('ei', 'result', 'eo', 'result')];
  assert.equal(run(nodes, edges, 'eo').outputs.result, 30);
});

test('types: For each returns a list, Condition and Items have their own types', () => {
  const nodes = [node('r', 'range'), node('s', 'loopStart'), node('q', 'math'), node('e', 'loopEnd', { kind: 'For each' }), node('c', 'compare')];
  const edges = [wire('s', 'item', 'q', 'a'), wire('q', 'result', 'e', 'result'), wire('r', 'list', 'e', 'items'), wire('c', 'result', 'e', 'condition')];
  const t = resolveTypes(nodes, edges, registry);
  assert.equal(t.outType('e', 'result'), 'list');
  assert.ok(edges.every((e) => t.edgeOk(e)));
  assert.equal(t.edgeOk(wire('q', 'result', 'e', 'condition')), false); // a number is not a boolean
  assert.equal(t.edgeOk(wire('c', 'result', 'e', 'items')), false); // a boolean is not a list
});

console.log(`\n${passed} passed`);
