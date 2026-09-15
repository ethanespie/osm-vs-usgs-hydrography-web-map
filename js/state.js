// ---------------------------------------------------------------------------
// Shared mutable state
// ---------------------------------------------------------------------------
//
// A single exported object, rather than individually exported `let` bindings, since ES module
// imports are read-only views of the exporting module's bindings — another module can't
// reassign an imported `let`, only mutate an imported object's properties. Every other module
// imports `{ state }` and reads/writes its properties directly (e.g. `state.map`,
// `state.compareActive = true`), same as sharing one dict/namespace across Python modules.

import { STREAM_LAYERS } from './config.js';

export const state = {
  map: null,
  mapAfter: null,
  compareControl: null,
  compareActive: false,
  afterMapReadyPromise: null,
  polygonLayersReadyPromise: null,
  currentBasemap: 'street',
  streamSide: {}, // key -> 'left' | 'right' | 'off', for compare mode
  polyData: {}, // key -> parsed FeatureCollection
  statsData: null, // hydrography_stats.json contents, once loaded
  activeLayerKey: 'counties',
  selectedFeatureId: null, // id (idProp value) of the selected feature in the active layer
  currentStreamPopup: null,
};

STREAM_LAYERS.forEach((entry) => {
  state.streamSide[entry.key] = entry.defaultSide;
});
