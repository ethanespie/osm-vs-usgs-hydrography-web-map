// ---------------------------------------------------------------------------
// Entry point: map setup, top-level event wiring, and orchestration between
// streams.js and polygons.js (the one map click handler needs both).
// ---------------------------------------------------------------------------

import { POLY_LAYERS } from './config.js';
import { state } from './state.js';
import { buildBaseStyle, BasemapControl } from './basemap.js';
import { addStreamLayers, wireStreamInteractivity, showStreamPopup } from './streams.js';
import { loadAllPolygonLayers, loadStats, clearSelectedFeature, selectPolygonFeature } from './polygons.js';
import { renderStreamSideControls, toggleCompareMode } from './compareMode.js';

const pmtilesProtocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);

state.map = new maplibregl.Map({
  container: 'map',
  center: [-121.0, 47.4],
  zoom: 6.4,
  style: buildBaseStyle(),
});

// showCompass: false drops the reset-bearing-to-north button; kept the zoom in/out buttons.
state.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
state.map.addControl(new BasemapControl(), 'top-right');

state.map.on('load', () => {
  addStreamLayers(state.map);
  wireStreamInteractivity();
  loadAllPolygonLayers();
  loadStats();
});

renderStreamSideControls();
document.getElementById('compare-toggle-btn').addEventListener('click', toggleCompareMode);

// Single click handler for the whole map: streams take priority over the polygon underneath
// them (so clicking a stream never also selects/zooms to the county or HUC it crosses), and
// clicking empty polygon area clears the current highlight.
const STREAM_CLICK_TOLERANCE_PX = 2;

state.map.on('click', (e) => {
  const streamLayers = ['osm-streams-line', 'nhd-streams-line'].filter((id) => state.map.getLayer(id));
  // Query a small box instead of the exact pixel so a click near where an OSM and NHD stream
  // run alongside each other reliably picks up both, not just whichever is nearer the cursor.
  const t = STREAM_CLICK_TOLERANCE_PX;
  const box = [
    [e.point.x - t, e.point.y - t],
    [e.point.x + t, e.point.y + t],
  ];
  const streamFeatures = streamLayers.length
    ? state.map.queryRenderedFeatures(box, { layers: streamLayers })
    : [];
  if (streamFeatures.length > 0) {
    showStreamPopup(e, streamFeatures);
    return;
  }

  const cfg = POLY_LAYERS[state.activeLayerKey];
  if (!state.map.getLayer(cfg.fillLayer)) return;
  const hit = state.map.queryRenderedFeatures(e.point, { layers: [cfg.fillLayer] });
  if (hit.length === 0) {
    clearSelectedFeature();
    return;
  }

  // Features from queryRenderedFeatures can have geometry clipped to internal
  // GeoJSON-source tile boundaries; use the untouched feature from polyData so
  // bboxOfGeometry always sees the full polygon.
  const clickedId = String(hit[0].properties[cfg.idProp]);
  const feature = state.polyData[state.activeLayerKey].features.find(
    (f) => String(f.properties[cfg.idProp]) === clickedId
  );
  selectPolygonFeature(state.activeLayerKey, cfg, feature || hit[0]);
});

// ---------------------------------------------------------------------------
// About modal
// ---------------------------------------------------------------------------

const aboutModal = document.getElementById('about-modal');
document.getElementById('about-btn').addEventListener('click', () => {
  aboutModal.hidden = false;
});
document.getElementById('about-close').addEventListener('click', () => {
  aboutModal.hidden = true;
});
aboutModal.addEventListener('click', (e) => {
  if (e.target === aboutModal) aboutModal.hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!aboutModal.hidden) {
    aboutModal.hidden = true;
  } else if (state.currentStreamPopup) {
    state.currentStreamPopup.remove();
  }
});
