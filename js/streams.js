// ---------------------------------------------------------------------------
// Stream layers (PMTiles vector sources)
// ---------------------------------------------------------------------------

import { STREAM_LAYERS } from './config.js';
import { state } from './state.js';
import { escapeHtml } from './helpers.js';

/**
 * Add the OSM/NHD vector sources and line layers (from STREAM_LAYERS) to a map.
 *
 * Pure source/layer setup with no interactivity, so it can be called for both the
 * primary map and the compare "after" map.
 *
 * @param {maplibregl.Map} targetMap
 */
export function addStreamLayers(targetMap) {
  STREAM_LAYERS.forEach((entry) => {
    targetMap.addSource(entry.sourceId, { type: 'vector', url: entry.url });
    targetMap.addLayer({
      id: entry.layerId,
      type: 'line',
      source: entry.sourceId,
      'source-layer': entry.sourceLayerName,
      paint: entry.paint,
    });
  });
}

/** Wire up stream-layer checkbox listeners and hover cursor. Primary map only, called once. */
export function wireStreamInteractivity() {
  STREAM_LAYERS.forEach((entry) => {
    document.getElementById(entry.checkboxId).addEventListener('change', () => {
      applyStreamLayerVisibility(entry);
    });
    state.map.on('mouseenter', entry.layerId, () => (state.map.getCanvas().style.cursor = 'pointer'));
    state.map.on('mouseleave', entry.layerId, () => (state.map.getCanvas().style.cursor = ''));
  });
}

/**
 * Show or hide a layer on a map.
 *
 * Safe to call with `targetMap === null` (e.g. before the compare "after" map has been
 * created) or a layer that doesn't exist yet — both are silently no-ops.
 *
 * @param {maplibregl.Map|null} targetMap
 * @param {string} layerId
 * @param {boolean} visible
 */
export function setLayerVisibility(targetMap, layerId, visible) {
  if (!targetMap || !targetMap.getLayer(layerId)) return;
  targetMap.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
}

/**
 * Apply one STREAM_LAYERS entry's current visibility to the map(s).
 *
 * In normal mode, drives the primary map from the layer's checkbox. In compare mode,
 * drives both maps from the layer's left/right/off side assignment instead.
 *
 * @param {object} entry A STREAM_LAYERS entry.
 */
export function applyStreamLayerVisibility(entry) {
  if (state.compareActive) {
    setLayerVisibility(state.map, entry.layerId, state.streamSide[entry.key] === 'left');
    setLayerVisibility(state.mapAfter, entry.layerId, state.streamSide[entry.key] === 'right');
  } else {
    const checked = document.getElementById(entry.checkboxId).checked;
    setLayerVisibility(state.map, entry.layerId, checked);
  }
}

/** Re-apply visibility for every entry in STREAM_LAYERS (see applyStreamLayerVisibility). */
export function applyAllStreamVisibility() {
  STREAM_LAYERS.forEach(applyStreamLayerVisibility);
}

/**
 * Render one source's feature properties as an HTML popup section.
 *
 * Combined by showStreamPopup() when a click hits both an OSM and a coincident NHD
 * stream, so the two don't open as separate overlapping popups.
 *
 * @param {object} p Feature properties.
 * @param {'osm'|'nhd'} source
 * @returns {string} HTML for the popup section.
 */
function streamSectionHtml(p, source) {
  if (source === 'osm') {
    return `
      <div class="popup-section">
        <h3>${escapeHtml(p.name || '(unnamed)')}</h3>
        <table>
          <tr><td>Type</td><td>${escapeHtml(p.fclass || '')}</td></tr>
          <tr><td>Source</td><td>OSM</td></tr>
        </table>
      </div>`;
  }
  return `
      <div class="popup-section">
        <h3>${escapeHtml(p.gnis_name || '(unnamed)')}</h3>
        <table>
          <tr><td>Type</td><td>${escapeHtml(p.fcode_description || '')}</td></tr>
          <tr><td>Length</td><td>${p.lengthkm != null ? p.lengthkm.toFixed(2) + ' km' : ''}</td></tr>
          <tr><td>Source</td><td>NHD</td></tr>
        </table>
      </div>`;
}

/**
 * Show a popup for the stream(s) clicked at e.lngLat.
 *
 * `features` may include an OSM stream, an NHD stream, or both (when they're coincident
 * at the click point) — rendered as one popup with a divider rather than two stacked popups.
 *
 * @param {maplibregl.MapMouseEvent} e
 * @param {maplibregl.MapGeoJSONFeature[]} features
 */
export function showStreamPopup(e, features) {
  const osmFeature = features.find((f) => f.layer.id === 'osm-streams-line');
  const nhdFeature = features.find((f) => f.layer.id === 'nhd-streams-line');

  const sections = [];
  if (osmFeature) sections.push(streamSectionHtml(osmFeature.properties, 'osm'));
  if (nhdFeature) sections.push(streamSectionHtml(nhdFeature.properties, 'nhd'));

  if (state.currentStreamPopup) state.currentStreamPopup.remove();
  state.currentStreamPopup = new maplibregl.Popup({ maxWidth: '260px' })
    .setLngLat(e.lngLat)
    .setHTML(sections.join('<hr class="popup-divider">'))
    .addTo(state.map);
  state.currentStreamPopup.on('close', () => {
    state.currentStreamPopup = null;
  });
}
