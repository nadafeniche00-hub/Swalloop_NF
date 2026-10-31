// Domain-free nodes: they work on whatever data flows through them.
//
// Loop Start / Loop End are executed by the engine (see engine.js); their
// compute() only runs when they are evaluated outside of a loop.
//
// Numeric params double as inputs: wire a number into a param and it overrides
// the widget. That is how Math / Compare take their operands.
import { num, select } from './define.js';

export const LOOP_KINDS = ['Repeat', 'While', 'Fold', 'For each'];
const counted = (p) => p.kind === 'Repeat' || p.kind === 'While' || p.kind === undefined;

export const OPS = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '×': (a, b) => a * b,
  '÷': (a, b) => a / b,
  '|a-b|': (a, b) => Math.abs(a - b),
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};
const COMPARE = {
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

export const CORE_NODES = {
  // Shows whatever flows in: a chart for numbers and lists, a tree for records,
  // and a pack's own view (e.g. the 3D tower) for its data types.
  inspect: {
    title: 'Inspector',
    category: 'Output',
    inputs: [
      { id: 'value', label: 'Value', type: 'any' },
      { id: 'history', label: 'History', type: 'history', optional: true },
    ],
    outputs: [],
    params: [],
    compute: () => ({}),
  },

  number: {
    title: 'Number',
    category: 'Input',
    inputs: [],
    outputs: [{ id: 'value', label: 'Value', type: 'number' }],
    params: [
      num('value', 'Value', 5, { slider: true }),
      num('min', 'Min', 0, { step: 1 }),
      num('max', 'Max', 10, { step: 1 }),
    ],
    compute: (_i, p) => ({ value: p.value }),
  },

  range: {
    title: 'Range',
    category: 'Utility',
    inputs: [],
    outputs: [{ id: 'list', label: 'List', type: 'list' }],
    params: [
      num('count', 'Count', 10, { step: 1, min: 0, max: 5000 }),
      num('start', 'Start', 1, { step: 1 }),
      num('step', 'Step', 1, { step: 1 }),
    ],
    compute: (_i, p) => ({
      list: Array.from({ length: Math.max(0, Math.floor(p.count)) }, (_, i) => p.start + i * p.step),
    }),
  },

  math: {
    title: 'Math',
    category: 'Utility',
    inputs: [],
    outputs: [{ id: 'result', label: 'Result', type: 'number' }],
    params: [
      select('op', 'Op', '+', Object.keys(OPS)),
      num('a', 'A', 0, { step: 1 }),
      num('b', 'B', 0, { step: 1 }),
    ],
    compute: (_i, p) => ({ result: OPS[p.op](p.a, p.b) }),
  },

  compare: {
    title: 'Compare',
    category: 'Utility',
    inputs: [],
    outputs: [{ id: 'result', label: 'True?', type: 'boolean' }],
    params: [
      select('op', 'Test', '<', Object.keys(COMPARE)),
      num('a', 'A', 0, { step: 1 }),
      num('b', 'B', 1, { step: 1 }),
    ],
    compute: (_i, p) => ({ result: COMPARE[p.op](p.a, p.b) }),
  },

  logic: {
    title: 'Logic',
    category: 'Utility',
    inputs: [
      { id: 'a', label: 'A', type: 'boolean' },
      { id: 'b', label: 'B', type: 'boolean', optional: true },
    ],
    outputs: [{ id: 'result', label: 'Result', type: 'boolean' }],
    params: [select('op', 'Op', 'and', ['and', 'or', 'not'])],
    compute: ({ a, b }, p) => ({
      result: p.op === 'not' ? !a : p.op === 'or' ? Boolean(a || b) : Boolean(a && b),
    }),
  },

  loopStart: {
    title: 'Take off · Loop Start',
    category: 'Migration',
    inputs: [{ id: 'initial', label: 'Initial', type: 'any', optional: true }],
    outputs: [
      { id: 'state', label: 'State', type: 'any' },
      { id: 'index', label: 'Index', type: 'number' },
      { id: 'item', label: 'Item', type: 'any' },
    ],
    params: [],
    compute: ({ initial }) => ({ state: initial, index: 0, item: undefined }),
  },

  // Kinds:
  //   Repeat    run the body up to Max iter. times; stop early when the change is below
  //             Tolerance or Condition is true
  //   While     run while Condition is true (at most Max iter. times)
  //   Fold      walk Items, carrying the state through each one; result = final state
  //   For each  run the body once per item, independently; result = list of body results
  // Condition is checked at the start of every iteration, on the current state.
  loopEnd: {
    title: 'Return · Loop End',
    category: 'Migration',
    inputs: [
      { id: 'result', label: 'Result', type: 'any' },
      { id: 'condition', label: 'Condition', type: 'boolean', optional: true },
      { id: 'items', label: 'Items', type: 'list', optional: true },
    ],
    outputs: [
      { id: 'result', label: 'Result', type: 'any' },
      { id: 'history', label: 'History', type: 'history' },
      { id: 'count', label: 'Iterations', type: 'number' },
      { id: 'delta', label: 'Last change', type: 'number' },
    ],
    params: [
      select('kind', 'Kind', 'Repeat', LOOP_KINDS),
      num('iterations', 'Max iter.', 150, { step: 10, min: 0, max: 5000, visible: counted }),
      num('tolerance', 'Tolerance', 0.002, { step: 0.001, min: 0, visible: counted }),
    ],
    describe: (p) =>
      ({
        Repeat: 'Repeats up to Max iter. times; stops early when the change is under Tolerance, or Condition is true.',
        While: 'Runs while Condition is true (at most Max iter. times).',
        Fold: 'Walks Items, carrying the state through each one. Result is the final state.',
        'For each': 'Runs the body once per item. Result is the list of body results.',
      })[p.kind] ?? '',
    compute: () => ({}),
  },

  readout: {
    title: 'Readout',
    category: 'Output',
    inputs: [{ id: 'value', label: 'Value', type: 'number' }],
    outputs: [],
    params: [],
    compute: () => ({}),
  },
};

export const CORE_CATEGORIES = [
  { name: 'Input', color: '#6aa5d6', order: 10 },
  { name: 'Utility', color: '#c9b36a', order: 15 },
  { name: 'Migration', color: '#e0824f', order: 40 },
  { name: 'Output', color: '#e07a7a', order: 50 },
];
