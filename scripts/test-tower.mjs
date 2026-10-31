// Tower pack tests: Orient limits and the Adopt round-trip, on the real Manhattan template.
//   node scripts/test-tower.mjs
import assert from 'node:assert/strict';
import { evaluate } from '../src/core/engine.js';
import { registry } from '../src/core/registry.js';
import { cornerRadius } from '../src/packs/skyscraper/geometry.js';
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

// Evaluate the Manhattan template with parameter overrides per node id.
function run(over = {}, template = 'Manhattan block') {
  const p = registry.templates[template]();
  for (const [id, v] of Object.entries(over)) Object.assign(p.nodes.find((n) => n.id === id).data.params, v);
  const r = evaluate(p.nodes, p.edges, registry);
  const end = r.results.get('end');
  assert.ok(!end.error, end.error);
  return { r, p, end: end.outputs, floors: end.outputs.result.floors };
}
const deg = (r) => (r * 180) / Math.PI;
const roughness = (F, key) => F.slice(1, -1).reduce((s, f, i) => s + Math.abs(F[i][key] - 2 * f[key] + F[i + 2][key]), 0);
const EPS = 1e-9;

test('limits at their defaults are a no-op (explicit "off" values give identical output)', () => {
  const a = run();
  const b = run({ stream: { minW: 0, minD: 0, minRadius: 0, maxStep: 90, maxTwist: 0, smooth: 0 } });
  assert.deepEqual(a.floors, b.floors);
});

test('min width and min depth hold on every floor after the whole loop', () => {
  const { floors } = run({ stream: { minW: 38, minD: 24 } });
  for (const f of floors) {
    assert.ok(f.w >= 38 - EPS, `w ${f.w}`);
    assert.ok(f.d >= 24 - EPS, `d ${f.d}`);
  }
});

test('without limits the same loop does go below those sizes (so the limit is doing the work)', () => {
  const { floors } = run();
  assert.ok(Math.min(...floors.map((f) => f.d)) < 24, 'expected a floor under 24 m depth');
});

test('Structure respects the size limits even when it wants smaller plates', () => {
  const { floors } = run({ stream: { minW: 30, minD: 30 }, struct: { maxPlate: 25, minPlate: 10 } });
  for (const f of floors) assert.ok(f.w >= 30 - EPS && f.d >= 30 - EPS);
});

test('min corner radius holds (radius = roundness x half the shorter side)', () => {
  const { floors } = run({ stream: { minRadius: 6 } });
  for (const f of floors) assert.ok(cornerRadius(f) >= 6 - 1e-6 || f.round >= 1 - EPS, `radius ${cornerRadius(f)}`);
});

test('max twist from base: no floor is turned further than the limit from floor 0', () => {
  const { floors } = run({ stream: { maxTwist: 20 } });
  for (const f of floors) assert.ok(Math.abs(deg(f.rot - floors[0].rot)) <= 20 + 1e-6, `${deg(f.rot - floors[0].rot)}`);
});

test('max twist: initial twist larger than the limit is pulled back in', () => {
  const { floors } = run({ tower: { twist: 90 }, stream: { maxTwist: 15 } });
  assert.ok(Math.abs(deg(floors.at(-1).rot - floors[0].rot)) <= 15 + 1e-6);
});

test('max rotation per pass: a single Orient pass never turns a floor more than the limit', () => {
  const p = registry.templates['Manhattan block']();
  // Loop of one pass: Max iter. = 1, so the result is exactly one Orient step from the initial tower.
  p.nodes.find((n) => n.id === 'end').data.params.iterations = 1;
  p.nodes.find((n) => n.id === 'stream').data.params.maxStep = 3;
  p.nodes.find((n) => n.id === 'tower').data.params.twist = 0;
  const res = evaluate(p.nodes, p.edges, registry).results.get('end').outputs.result.floors;
  for (const f of res) assert.ok(Math.abs(deg(f.rot)) <= 3 + 1e-6, `${deg(f.rot)}`);
});

test('smoothing makes the loft smoother (second differences of rotation and width drop)', () => {
  const rough = run({ stream: { rate: 0.5 } }).floors;
  const smooth = run({ stream: { rate: 0.5, smooth: 0.8 } }).floors;
  assert.ok(roughness(smooth, 'rot') < roughness(rough, 'rot'), 'rotation not smoother');
  assert.ok(roughness(smooth, 'w') <= roughness(rough, 'w') + 1e-6, 'width not smoother');
});

test('limits and smoothing together still converge and stay within every limit', () => {
  const { floors, end } = run({ stream: { minW: 30, minD: 22, minRadius: 3, maxStep: 4, maxTwist: 40, smooth: 0.5 } });
  assert.ok(end.count > 0);
  for (const f of floors) {
    assert.ok(f.w >= 30 - EPS && f.d >= 22 - EPS);
    assert.ok(Math.abs(deg(f.rot - floors[0].rot)) <= 40 + 1e-6);
  }
});

test('evaluation is deterministic', () => {
  assert.deepEqual(run().floors, run().floors);
});

test('Adopt: the tower node outputs the stored floors, and switching back restores the sliders', () => {
  const { p, floors } = run();
  const def = registry.nodeTypes.tower;
  const tower = p.nodes.find((n) => n.id === 'tower');
  const initial = def.compute({}, tower.data.params).tower;
  const patch = def.adopt({ h: 5, floors });
  assert.equal(patch.source, 'Adopted');
  const adopted = def.compute({}, { ...tower.data.params, ...patch }).tower;
  assert.equal(adopted.floors.length, floors.length);
  adopted.floors.forEach((f, i) => {
    assert.equal(f.w, floors[i].w);
    assert.equal(f.rot, floors[i].rot);
    assert.equal(f.util, 0); // derived values are recomputed by the loop, not carried over
  });
  const back = def.compute({}, { ...tower.data.params, ...patch, source: 'Initial' }).tower;
  assert.deepEqual(back.floors, initial.floors);
});

test('Adopt: running the loop again from the adopted tower continues (already close to a fixed point)', () => {
  const first = run();
  const patch = registry.nodeTypes.tower.adopt({ h: 5, floors: first.floors });
  const second = run({ tower: patch });
  // The first run moved the tower a long way; the second starts at the result and barely moves.
  const move = (a, b) => Math.max(...a.map((f, i) => Math.abs(f.w - b[i].w) + Math.abs(f.d - b[i].d)));
  const initial = registry.nodeTypes.tower.compute({}, registry.defaultParams('tower')).tower.floors;
  assert.ok(move(second.floors, first.floors) < move(first.floors, initial), 'second run moved as far as the first');
});

test('Adopt: a Source of Adopted with no snapshot falls back to the sliders', () => {
  const def = registry.nodeTypes.tower;
  const p = { ...registry.defaultParams('tower'), source: 'Adopted' };
  assert.equal(def.compute({}, p).tower.floors.length, p.floors);
});

test('tuned templates settle quickly and keep every floor within the structure limit', () => {
  for (const name of ['Manhattan block (tuned)', 'Dubai plots (tuned)']) {
    const p = registry.templates[name]();
    const r = evaluate(p.nodes, p.edges, registry);
    const end = r.results.get('end');
    assert.ok(!end.error, end.error);
    assert.ok(end.outputs.count < 80, `${name}: ${end.outputs.count} passes`);
    const util = r.results.get('metrics').outputs.util;
    assert.ok(util < 1.15, `${name}: util ${util}`);
  }
});

test('the plain templates are untouched by the tuned ones (separate parameter objects)', () => {
  registry.templates['Manhattan block (tuned)']();
  const b = registry.templates['Manhattan block']().nodes.find((n) => n.id === 'stream').data.params;
  assert.equal(b.aspect, 1.8);
  assert.equal(b.search, 'Grid');
  assert.equal(b.smooth, 0);
});

test('Refined search settles a smoothed loop that Grid search keeps hovering on', () => {
  const grid = run({ end: { tolerance: 0.01, iterations: 300 }, stream: { smooth: 0.5, search: 'Grid' } });
  const refined = run({ end: { tolerance: 0.01, iterations: 300 }, stream: { smooth: 0.5, search: 'Refined' } });
  assert.ok(refined.end.count < 300, `refined ran ${refined.end.count} passes`);
  assert.ok(grid.end.count >= 300, `grid stopped at ${grid.end.count}: no longer documents why Refined exists`);
});

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
