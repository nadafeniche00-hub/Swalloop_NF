// The skyscraper case is data, not code: four graph files in /templates
// (format described in docs/graph-format.md). The same files open from
// "Open file..." in the app, and are what another host would read.
import manhattan from '../../../templates/skyscraper-manhattan.swalloop.json' with { type: 'json' };
import dubai from '../../../templates/skyscraper-dubai.swalloop.json' with { type: 'json' };
import manhattanTuned from '../../../templates/skyscraper-manhattan-tuned.swalloop.json' with { type: 'json' };
import dubaiTuned from '../../../templates/skyscraper-dubai-tuned.swalloop.json' with { type: 'json' };

export const TEMPLATE_FILES = [manhattan, dubai, manhattanTuned, dubaiTuned];
