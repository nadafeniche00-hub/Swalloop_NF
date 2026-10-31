// Views (React only; the packs themselves stay plain JS so headless scripts can load them).
//   VIEWS      node type -> component that renders that node's inputs in the right-hand pane
//   data views registered below: data type -> component the Inspector uses for it
import Inspector from '../core/Inspector.jsx';
import { registerDataView } from '../core/dataViews.js';
import Viewport3D from './skyscraper/Viewport3D.jsx';
import { isTower } from './skyscraper/distance.js';
import './analysis/Views.jsx'; // registers the grid, series and outline views

const TOWER_DEFAULTS = { color: 'Utilisation', cmap: 'Turbo', range: 'Auto', min: 0, max: 1, reverse: 'No' };

// A tower dropped on a plain Inspector gets the 3D view with default colouring.
function TowerData({ value, history }) {
  return <Viewport3D inputs={{ tower: value, history }} params={TOWER_DEFAULTS} />;
}
registerDataView({ name: 'tower', is: isTower, Component: TowerData });

export const VIEWS = { inspect: Inspector, viewer: Viewport3D };
