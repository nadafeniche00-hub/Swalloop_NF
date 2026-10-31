// Analysis: integrals, logarithms, Fourier, Gaussian splatting and linear algebra, as nodes.
// Plain JS (no React), so the headless scripts and the tests can load it; the views live in Views.jsx.
import { ANALYSIS_NODES } from './nodes.js';
import logWind from '../../../templates/analysis-log-wind.swalloop.json' with { type: 'json' };
import towerLogWind from '../../../templates/analysis-tower-log-wind.swalloop.json' with { type: 'json' };
import fourierLoft from '../../../templates/analysis-fourier-loft.swalloop.json' with { type: 'json' };
import splatShelter from '../../../templates/analysis-splat-shelter.swalloop.json' with { type: 'json' };
import matrixTwist from '../../../templates/analysis-matrix-twist.swalloop.json' with { type: 'json' };

export default {
  id: 'analysis',
  nodeTypes: ANALYSIS_NODES,
  categories: [{ name: 'Analysis', color: '#6fc2a8', order: 35 }],
  templateFiles: [logWind, towerLogWind, fourierLoft, splatShelter, matrixTwist],
};
