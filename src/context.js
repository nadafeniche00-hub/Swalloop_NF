import { createContext } from 'react';

const anyType = () => 'any';

// Evaluation results, wiring and resolved port types, shared with every node on the canvas.
export const EvalContext = createContext({
  results: new Map(),
  wired: new Map(),
  pairs: new Map(),
  types: { inType: anyType, outType: anyType },
});
