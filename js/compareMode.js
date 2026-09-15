// ---------------------------------------------------------------------------
// Swipe compare mode
// ---------------------------------------------------------------------------

import { POLY_LAYERS, STREAM_LAYERS, STREAM_LEGEND_ORDER } from './config.js';
import { state } from './state.js';
import { escapeHtml } from './helpers.js';
import { addStreamLayers, applyStreamLayerVisibility, applyAllStreamVisibility } from './streams.js';
import { addPolygonLayer } from './polygons.js';
import { buildBaseStyle, applyBasemapChoice, currentBasemapChoice } from './basemap.js';

/**
 * Build one Left/Right/Off radio row per STREAM_LAYERS entry into #stream-side-controls.
 *
 * A future third layer (e.g. 3DHP) needs no changes here — it's driven entirely by the config.
 */
export function renderStreamSideControls() {
  const container = document.getElementById('stream-side-controls');
  STREAM_LEGEND_ORDER.map((key) => STREAM_LAYERS.find((entry) => entry.key === key)).forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'side-row';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'side-row-label';
    labelSpan.innerHTML =
      `<span class="swatch" style="background:${entry.paint['line-color']}"></span>` +
      escapeHtml(entry.label);
    row.appendChild(labelSpan);

    const options = document.createElement('span');
    options.className = 'side-options';
    [['left', 'L'], ['right', 'R'], ['off', 'Off']].forEach(([side, text]) => {
      const optLabel = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `stream-side-${entry.key}`;
      radio.value = side;
      radio.checked = state.streamSide[entry.key] === side;
      radio.addEventListener('change', () => {
        state.streamSide[entry.key] = side;
        applyStreamLayerVisibility(entry);
      });
      optLabel.appendChild(radio);
      optLabel.appendChild(document.createTextNode(text));
      options.appendChild(optLabel);
    });
    row.appendChild(options);
    container.appendChild(row);
  });
}

/**
 * Lazily create the compare "after" map (and its source/layers) on first use, then return
 * the same cached ready-promise on every subsequent call for the rest of the session —
 * so toggling compare mode just shows/hides and resizes it, rather than re-fetching
 * pmtiles/geojson every time.
 *
 * @returns {Promise<void>} Resolves once the after-map is loaded and its layers are added.
 */
export function ensureAfterMap() {
  if (state.afterMapReadyPromise) return state.afterMapReadyPromise;
  state.afterMapReadyPromise = new Promise((resolve) => {
    state.mapAfter = new maplibregl.Map({
      container: 'map-after',
      center: state.map.getCenter(),
      zoom: state.map.getZoom(),
      bearing: state.map.getBearing(),
      pitch: state.map.getPitch(),
      style: buildBaseStyle(),
      attributionControl: false,
    });
    state.mapAfter.on('load', () => {
      addStreamLayers(state.mapAfter);
      applyBasemapChoice(state.mapAfter, currentBasemapChoice());
      state.polygonLayersReadyPromise.then(() => {
        Object.entries(POLY_LAYERS).forEach(([key, cfg]) => {
          addPolygonLayer(state.mapAfter, key, cfg, state.polyData[key], key === state.activeLayerKey);
        });
        resolve();
      });
    });
  });
  return state.afterMapReadyPromise;
}

/**
 * Toggle swipe-compare mode on/off: shows/hides the after-map, and (re)creates the
 * maplibre-gl-compare slider control that pairs it with the primary map.
 */
export function toggleCompareMode() {
  state.compareActive = !state.compareActive;
  document.getElementById('map-after').hidden = !state.compareActive;
  document.getElementById('compare-slider').hidden = !state.compareActive;
  document.getElementById('stream-checkbox-controls').hidden = state.compareActive;
  document.getElementById('stream-side-controls').hidden = !state.compareActive;
  document.getElementById('compare-toggle-btn').textContent =
    state.compareActive ? 'Exit swipe compare' : 'Enable swipe compare';

  if (!state.compareActive) {
    if (state.compareControl) {
      state.compareControl.remove(); // resets the CSS clip Compare applied to the primary map
      state.compareControl = null;
    }
    applyAllStreamVisibility();
    return;
  }

  ensureAfterMap().then(() => {
    // The primary map stays fully interactive while compare mode is off, so the after-map
    // (frozen since it was last hidden) needs an explicit resync before re-pairing them —
    // otherwise the two views visibly jump into alignment on the next drag instead of
    // matching immediately.
    state.mapAfter.jumpTo({
      center: state.map.getCenter(),
      zoom: state.map.getZoom(),
      bearing: state.map.getBearing(),
      pitch: state.map.getPitch(),
    });
    // A ResizeObserver on a hidden container won't have tracked any window resize that
    // happened while compare mode was off, so both maps get an explicit resize here.
    state.map.resize();
    state.mapAfter.resize();
    state.compareControl = new maplibregl.Compare(state.map, state.mapAfter, '#compare-slider', {
      orientation: 'vertical',
      mousemove: false,
    });
    applyAllStreamVisibility();
  });
}
