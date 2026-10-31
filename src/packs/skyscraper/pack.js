// The skyscraper template: a tower reshaped by wind, structure and sun.
import { SKYSCRAPER_NODES } from './nodes.js';
import { isTower, towerDistance } from './distance.js';
import { TEMPLATE_FILES } from './templates.js';

export default {
  id: 'skyscraper',
  nodeTypes: SKYSCRAPER_NODES,
  categories: [
    { name: 'Site', color: '#d6a45a', order: 20 },
    { name: 'Physics', color: '#b58be0', order: 30 },
  ],
  dataTypes: [{ name: 'tower', is: isTower, distance: towerDistance }],
  templateFiles: TEMPLATE_FILES,
};
