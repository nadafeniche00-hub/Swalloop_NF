// Template files and the graph file format.
//   node scripts/test-templates.mjs
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluate } from '../src/core/engine.js';
import { fileToGraph, graphToFile, FORMAT, VERSION } from '../src/core/graphFile.js';
import { registry } from '../src/core/registry.js';
import '../src/packs/index.js';

let failed = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log('ok  ', name);
  } catch (e) {
    failed++;
    console.log('FAIL', name, '\n    ', e.message);
  }
};

const dir = fileURLToPath(new URL('../templates/', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.swalloop.json'));
const read = (f) => JSON.parse(readFileSync(dir + f, 'utf8'));
const base = () => read('loops-newton.swalloop.json');

test('the templates folder has files and each one is a registered template', () => {
  assert.ok(files.length >= 10, `only ${files.length} files`);
  const registered = new Set(Object.keys(registry.templateInfo));
  for (const f of files) assert.ok(registered.has(read(f).name), `${f} is not registered by any pack`);
  assert.equal(registered.size, files.length, 'a registered template has no file');
});

test('every file loads with no skipped wires and every node of every file evaluates', () => {
  for (const f of files) {
    const g = fileToGraph(read(f), registry);
    assert.deepEqual(g.problems, [], `${f}: ${g.problems[0]}`);
    const r = evaluate(g.nodes, g.edges, registry);
    for (const [id, res] of r.results) assert.ok(!res.error, `${f}: node "${id}": ${res.error}`);
  }
});

test('files carry no stale parameters (every param exists on its node type, except adopted snapshots)', () => {
  for (const f of files) {
    for (const n of read(f).nodes) {
      const known = new Set(registry.nodeTypes[n.type].params.map((p) => p.id));
      for (const k of Object.keys(n.params)) assert.ok(known.has(k) || k === 'snapshot', `${f}: ${n.id}.${k}`);
    }
  }
});

test('exactly one template is featured, and it is the tower case', () => {
  const featured = Object.entries(registry.templateInfo).filter(([, i]) => i.featured);
  assert.equal(featured.length, 1);
  assert.equal(featured[0][0], 'Manhattan block');
});

test('save then open is lossless: ids, types, params and wires survive a round trip', () => {
  for (const f of files) {
    const file = read(f);
    const g = fileToGraph(file, registry);
    const back = graphToFile({ nodes: g.nodes, edges: g.edges }, { name: file.name, description: file.description, group: file.group, featured: file.featured });
    assert.deepEqual(back.nodes.map((n) => [n.id, n.type, n.params]), file.nodes.map((n) => [n.id, n.type, n.params]), f);
    assert.deepEqual(back.edges, file.edges, f);
  }
});

test('a round-tripped template evaluates to the same numbers as the original', () => {
  const file = read('skyscraper-manhattan.swalloop.json');
  const a = fileToGraph(file, registry);
  const b = fileToGraph(JSON.parse(JSON.stringify(graphToFile({ nodes: a.nodes, edges: a.edges }, file))), registry);
  const m = (g) => evaluate(g.nodes, g.edges, registry).results.get('metrics').outputs;
  assert.deepEqual(m(a), m(b));
});

test('a file written before a parameter existed still opens (defaults fill the gap)', () => {
  const file = read('skyscraper-manhattan.swalloop.json');
  delete file.nodes.find((n) => n.id === 'stream').params.smooth;
  delete file.nodes.find((n) => n.id === 'stream').params.search;
  const g = fileToGraph(file, registry);
  const p = g.nodes.find((n) => n.id === 'stream').data.params;
  assert.equal(p.smooth, 0);
  assert.equal(p.search, 'Grid');
});

test('a wrong format, a newer version and a missing list are refused with a clear message', () => {
  assert.throws(() => fileToGraph({ format: 'something-else' }, registry), /Not a Swalloop graph file/);
  assert.throws(() => fileToGraph({ ...base(), version: VERSION + 1 }, registry), /version/);
  assert.throws(() => fileToGraph({ format: FORMAT, version: 1, nodes: [] }, registry), /nodes" and "edges"/);
  assert.throws(() => fileToGraph(null, registry), /Not a Swalloop graph file/);
});

test('an unknown node type is refused and names the type', () => {
  const file = base();
  file.nodes.push({ id: 'zz', type: 'teleporter', params: {} });
  assert.throws(() => fileToGraph(file, registry), /Unknown node type: teleporter/);
});

test('duplicate node ids are refused', () => {
  const file = base();
  file.nodes.push({ ...file.nodes[0] });
  assert.throws(() => fileToGraph(file, registry), /Duplicate node id/);
});

test('a wire to a missing node or port is skipped and reported, not fatal', () => {
  const file = base();
  file.edges.push({ from: 'nope.x', to: 'start.initial' });
  file.edges.push({ from: 'x0.value', to: 'start.nonsense' });
  file.edges.push({ from: 'x0.nonsense', to: 'start.initial' });
  const g = fileToGraph(file, registry);
  assert.equal(g.problems.length, 3);
  assert.equal(g.edges.length, base().edges.length);
});

test('a wire into a numeric parameter is accepted; into a select parameter it is not', () => {
  const file = base();
  file.edges.push({ from: 'x0.value', to: 'step.a' }); // a is a number param
  assert.equal(fileToGraph(file, registry).problems.length, 0);
  const sky = read('skyscraper-manhattan.swalloop.json');
  sky.edges.push({ from: 'tower.tower', to: 'tower.source' }); // source is a select
  assert.ok(fileToGraph(sky, registry).problems.length >= 1);
});

test('every node type knows which pack it came from', () => {
  assert.equal(registry.nodeTypes.tower.pack, 'skyscraper');
  assert.equal(registry.nodeTypes.newton.pack, 'math');
  assert.equal(registry.nodeTypes.loopStart.pack, undefined); // core
});

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
