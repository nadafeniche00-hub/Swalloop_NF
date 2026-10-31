// A tiny second pack: proof that the loop does not care what it iterates.
// Two classic iterations, shown with the generic Inspector (no tower anywhere).
import { num } from '../../core/define.js';
import newton from '../../../templates/loops-newton.swalloop.json' with { type: 'json' };
import logistic from '../../../templates/loops-logistic.swalloop.json' with { type: 'json' };
import stopCondition from '../../../templates/loops-stop-condition.swalloop.json' with { type: 'json' };
import whileLoop from '../../../templates/loops-while.swalloop.json' with { type: 'json' };
import fold from '../../../templates/loops-fold.swalloop.json' with { type: 'json' };
import forEach from '../../../templates/loops-for-each.swalloop.json' with { type: 'json' };

const nodeTypes = {
  newton: {
    title: 'Newton step',
    category: 'Math',
    inputs: [{ id: 'x', label: 'x', type: 'number' }],
    outputs: [{ id: 'x', label: 'x', type: 'number' }],
    params: [num('a', 'sqrt of', 2, { step: 0.5 })],
    compute: ({ x }, p) => ({ x: (x + p.a / x) / 2 }),
  },
  logistic: {
    title: 'Logistic map',
    category: 'Math',
    inputs: [{ id: 'x', label: 'x', type: 'number' }],
    outputs: [{ id: 'x', label: 'x', type: 'number' }],
    params: [num('r', 'r', 3.7, { step: 0.05, min: 0, max: 4 })],
    compute: ({ x }, p) => ({ x: p.r * x * (1 - x) }),
  },
};


// The demos are graph files in /templates. The last four use only core nodes
// (Math, Compare, Range): they show the loop kinds themselves.
const templateFiles = [newton, logistic, stopCondition, whileLoop, fold, forEach];

export default {
  id: 'math',
  nodeTypes,
  categories: [{ name: 'Math', color: '#d6c25a', order: 25 }],
  templateFiles,
};
