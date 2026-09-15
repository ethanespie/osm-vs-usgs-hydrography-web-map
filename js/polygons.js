// ---------------------------------------------------------------------------
// Polygon layers (GeoJSON sources: counties, HUC-8, HUC-10)
// ---------------------------------------------------------------------------

import { POLY_LAYERS, STATS_URL } from './config.js';
import { state } from './state.js';
import { setLayerVisibility } from './streams.js';
import { bboxOfGeometry, polygonCentroids, formatMiles, formatRatio } from './helpers.js';

/**
 * Fetch the precomputed stream-mileage stats JSON into `state.statsData`.
 * On failure, `state.statsData` is left as `null` and stat lookups fall back to
 * "Stats not available".
 */
export function loadStats() {
  return fetch(STATS_URL)
    .then((res) => res.json())
    .then((data) => {
      state.statsData = data;
    })
    .catch((err) => {
      console.error(`Failed to load ${STATS_URL}`, err);
      state.statsData = null;
    });
}

/**
 * Fetch every POLY_LAYERS GeoJSON file, add each as a layer on the primary map, and wire
 * up its interactivity, picklist, and radio button. Also sets `state.polygonLayersReadyPromise`,
 * which ensureAfterMap() awaits before mirroring the layers onto the compare "after" map.
 */
export function loadAllPolygonLayers() {
  const fetches = Object.entries(POLY_LAYERS).map(([key, cfg]) =>
    fetch(cfg.file)
      .then((res) => res.json())
      .then((geojson) => {
        state.polyData[key] = geojson;
        addPolygonLayer(state.map, key, cfg, geojson, key === state.activeLayerKey);
        wirePolygonInteractivity(cfg);
        populatePicklist(key, cfg, geojson);
      })
      .catch((err) => console.error(`Failed to load ${cfg.file}`, err))
  );
  state.polygonLayersReadyPromise = Promise.all(fetches);

  // Radio buttons: only one polygon layer visible at a time (counties default)
  Object.entries(POLY_LAYERS).forEach(([key, cfg]) => {
    document.getElementById(cfg.radioId).addEventListener('change', () => setActivePolygonLayer(key));
  });
}

/**
 * Add one boundary layer to a map: a GeoJSON source with fill and outline layers, plus a
 * second, centroid-point source and symbol layer for labels.
 *
 * Pure source/layer setup with no interactivity, so it can be called for both the
 * primary map and the compare "after" map.
 *
 * @param {maplibregl.Map} targetMap
 * @param {string} key POLY_LAYERS key, e.g. "counties".
 * @param {object} cfg The POLY_LAYERS entry for `key`.
 * @param {object} geojson The layer's FeatureCollection.
 * @param {boolean} visible Whether this layer should start visible.
 */
export function addPolygonLayer(targetMap, key, cfg, geojson, visible) {
  targetMap.addSource(cfg.sourceId, { type: 'geojson', data: geojson, promoteId: cfg.idProp });

  targetMap.addLayer({
    id: cfg.fillLayer,
    type: 'fill',
    source: cfg.sourceId,
    layout: { visibility: visible ? 'visible' : 'none' },
    paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.04 },
  });

  targetMap.addLayer({
    id: cfg.lineLayer,
    type: 'line',
    source: cfg.sourceId,
    layout: { visibility: visible ? 'visible' : 'none' },
    paint: {
      'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#991b1b', '#dc2626'],
      'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 4, 1.5],
    },
  });

  // Label from a dedicated point-per-feature source rather than the polygon source directly.
  // Large polygons get split into pieces by the internal GeoJSON tiler, and symbol placement
  // would otherwise anchor one label per piece, producing duplicate labels for the same feature.
  targetMap.addSource(cfg.labelSourceId, { type: 'geojson', data: polygonCentroids(geojson, cfg.nameProp) });

  targetMap.addLayer({
    id: cfg.labelLayer,
    type: 'symbol',
    source: cfg.labelSourceId,
    minzoom: cfg.labelMinZoom,
    layout: {
      visibility: visible ? 'visible' : 'none',
      'text-field': ['get', cfg.nameProp],
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
    },
    paint: {
      'text-color': '#dc2626',
      'text-halo-color': '#ffffff',
      'text-halo-width': 3,
    },
  });
}

/** Wire up the hover cursor for one boundary layer. Primary map only, called once per layer. */
function wirePolygonInteractivity(cfg) {
  state.map.on('mouseenter', cfg.fillLayer, () => (state.map.getCanvas().style.cursor = 'pointer'));
  state.map.on('mouseleave', cfg.fillLayer, () => (state.map.getCanvas().style.cursor = ''));
}

/**
 * Switch which POLY_LAYERS layer is visible/active, clearing any current selection first.
 *
 * Also mirrors the active boundary layer to the compare "after" map (a no-op via
 * setLayerVisibility's null guard until that map exists), so switching counties/HUC-8/HUC-10
 * on the primary map keeps both sides' context layer in sync with no extra call sites.
 *
 * @param {string} activeKey POLY_LAYERS key to activate, e.g. "huc8".
 */
export function setActivePolygonLayer(activeKey) {
  clearSelectedFeature();
  state.activeLayerKey = activeKey;
  Object.entries(POLY_LAYERS).forEach(([key, cfg]) => {
    const visible = key === activeKey;
    [state.map, state.mapAfter].forEach((targetMap) => {
      setLayerVisibility(targetMap, cfg.fillLayer, visible);
      setLayerVisibility(targetMap, cfg.lineLayer, visible);
      setLayerVisibility(targetMap, cfg.labelLayer, visible);
    });
    if (key !== activeKey) {
      document.getElementById(cfg.picklistId).value = '';
    }
  });
}

/** Clear the highlighted border on the currently selected feature, if any. */
export function clearSelectedFeature() {
  if (state.selectedFeatureId == null) return;
  const cfg = POLY_LAYERS[state.activeLayerKey];
  state.map.setFeatureState({ source: cfg.sourceId, id: state.selectedFeatureId }, { selected: false });
  state.selectedFeatureId = null;
}

/**
 * Fill a boundary layer's <select> picklist with its features (sorted by name) and wire
 * up selecting an option to activate that layer and select the chosen feature.
 *
 * @param {string} key POLY_LAYERS key, e.g. "counties".
 * @param {object} cfg The POLY_LAYERS entry for `key`.
 * @param {object} geojson The layer's FeatureCollection.
 */
function populatePicklist(key, cfg, geojson) {
  const select = document.getElementById(cfg.picklistId);
  const features = [...geojson.features].sort((a, b) =>
    String(a.properties[cfg.nameProp]).localeCompare(String(b.properties[cfg.nameProp]))
  );

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = `Select a ${key === 'counties' ? 'county' : key.toUpperCase()}…`;
  select.appendChild(placeholder);

  features.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = String(f.properties[cfg.idProp]);
    opt.textContent = f.properties[cfg.nameProp];
    select.appendChild(opt);
  });

  select.addEventListener('change', () => {
    if (!select.value) return;
    const feature = geojson.features.find((f) => String(f.properties[cfg.idProp]) === select.value);
    if (!feature) return;

    // Switch to this polygon type and select it, same as clicking on the map.
    document.getElementById(cfg.radioId).checked = true;
    setActivePolygonLayer(key);
    selectPolygonFeature(key, cfg, feature, { skipPicklistSync: true });
  });
}

/**
 * Select a boundary feature: highlight it, fit the map to its bounds, and populate the
 * sidebar's stats panel. Shared handler for both map clicks and picklist selection.
 *
 * @param {string} key POLY_LAYERS key, e.g. "counties".
 * @param {object} cfg The POLY_LAYERS entry for `key`.
 * @param {object} feature The GeoJSON feature being selected.
 * @param {{skipPicklistSync?: boolean}} [opts] Set skipPicklistSync when the picklist's
 *   value already matches the selection (i.e. the call came from the picklist itself).
 */
export function selectPolygonFeature(key, cfg, feature, opts = {}) {
  clearSelectedFeature();
  state.selectedFeatureId = feature.properties[cfg.idProp];
  state.map.setFeatureState({ source: cfg.sourceId, id: state.selectedFeatureId }, { selected: true });

  const bbox = bboxOfGeometry(feature.geometry);
  // Left padding accounts for the sidebar panel, which sits on top of the map — otherwise an
  // east-west-oblong polygon can end up with its left edge fit right underneath it.
  const panelRight = document.getElementById('panel').getBoundingClientRect().right;
  state.map.fitBounds(bbox, {
    padding: { top: 60, bottom: 60, left: panelRight + 20, right: 60 },
    maxZoom: 12,
    duration: 800,
  });

  const name = feature.properties[cfg.nameProp] || '(unnamed)';
  document.getElementById('info-placeholder').hidden = true;
  document.getElementById('info-content').hidden = false;
  document.getElementById('info-name').textContent = name;

  const id = String(feature.properties[cfg.idProp]);
  const stats = state.statsData && state.statsData[key] && state.statsData[key][id];
  document.getElementById('info-osm-miles').textContent = stats
    ? formatMiles(stats.osm.total_miles)
    : 'Stats not available';
  document.getElementById('info-nhd-miles').textContent = stats
    ? formatMiles(stats.nhd.total_miles)
    : 'Stats not available';
  document.getElementById('info-ratio').textContent = stats
    ? formatRatio(stats.osm.total_miles, stats.nhd.total_miles)
    : '–';
  renderCategoryBreakdown('osm', stats && stats.osm.by_category);
  renderCategoryBreakdown('nhd', stats && stats.nhd.by_category);

  if (!opts.skipPicklistSync) {
    const select = document.getElementById(cfg.picklistId);
    select.value = String(feature.properties[cfg.idProp]);
  }
}

/**
 * Fill in one source's "by category" breakdown table (e.g. stream/river/canal miles),
 * sorted largest-first. Hides the whole group when no stats are available for the
 * selected feature.
 *
 * @param {'osm'|'nhd'} source
 * @param {Object<string, number>|undefined} byCategory Category name -> miles.
 */
function renderCategoryBreakdown(source, byCategory) {
  const group = document.getElementById(`info-${source}-breakdown-group`);
  const table = document.getElementById(`info-${source}-breakdown`);
  table.innerHTML = '';
  group.hidden = !byCategory;
  if (!byCategory) return;

  Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .forEach(([category, miles]) => {
      const tr = document.createElement('tr');
      const tdCategory = document.createElement('td');
      tdCategory.textContent = category.charAt(0).toUpperCase() + category.slice(1);
      const tdMiles = document.createElement('td');
      tdMiles.textContent = formatMiles(miles);
      tr.append(tdCategory, tdMiles);
      table.appendChild(tr);
    });
}
