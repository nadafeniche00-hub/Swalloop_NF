// Criteria the Viewer can colour the tower by.
//
// value(floor, facadeNormal, ctx) returns the quantity in its own unit.
// range is the default colour range, or 'auto' to span the tower's own values.
// The Viewer node can override the range with Manual min / max.
//   ctx = { up, sun }: unit vectors (plan) toward the wind source and the sun

import { plateArea } from './geometry.js';

const dot = (n, v) => (v ? n.x * v.x + n.y * v.y : 0);
const wrapDeg = (r) => {
  const d = (r * 180) / Math.PI;
  return ((((d + 90) % 180) + 180) % 180) - 90; // outlines repeat every 180 deg
};

export const METRICS = {
  Utilisation: { unit: '', range: [0, 1.1], value: (f) => f.util },
  Height: { unit: ' m', range: 'auto', value: (f) => f.z },
  'Wind load': { unit: ' kN', range: 'auto', value: (f) => f.windF },
  'Wind exposure': { unit: '', range: [0.3, 1], value: (f) => f.wind },
  'Sun exposure': { unit: '', range: [0, 1], value: (f) => f.sun },
  'Plate area': { unit: ' m2', range: 'auto', value: (f) => plateArea(f) },
  Rotation: { unit: ' deg', range: 'auto', value: (f) => wrapDeg(f.rot) },
  Roundness: { unit: '', range: [0, 1], value: (f) => f.round },
  Aspect: { unit: '', range: 'auto', value: (f) => Math.max(f.w, f.d) / Math.min(f.w, f.d) },
  'Facade wind': {
    unit: ' (-1 leeward, +1 windward)',
    range: [-1, 1],
    value: (f, n, ctx) => dot(n, ctx.up) * f.wind,
  },
  'Facade sun': {
    unit: ' (-1 away, +1 facing the sun)',
    range: [-1, 1],
    value: (f, n, ctx) => dot(n, ctx.sun) * f.sun,
  },
};

export const METRIC_NAMES = ['None', ...Object.keys(METRICS)];
export const CMAP_NAMES = ['Turbo', 'Viridis', 'Inferno', 'Cool-warm'];
