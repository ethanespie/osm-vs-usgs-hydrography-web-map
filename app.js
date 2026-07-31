// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const POLY_LAYERS = {
  counties: {
    file: 'data/osm_counties.geojson',
    idProp: 'osm_id',
    nameProp: 'name',
    sourceId: 'counties-src',
    labelSourceId: 'counties-label-src',
    fillLayer: 'counties-fill',
    lineLayer: 'counties-outline',
    labelLayer: 'counties-label',
    labelMinZoom: 0,
    picklistId: 'picklist-counties',
    radioId: 'poly-counties',
  },
  huc8: {
    file: 'data/nhd_huc_08_watersheds.geojson',
    idProp: 'huc8',
    nameProp: 'name',
    sourceId: 'huc8-src',
    labelSourceId: 'huc8-label-src',
    fillLayer: 'huc8-fill',
    lineLayer: 'huc8-outline',
    labelLayer: 'huc8-label',
    labelMinZoom: 6,
    picklistId: 'picklist-huc8',
    radioId: 'poly-huc8',
  },
  huc10: {
    file: 'data/nhd_huc_10_watersheds.geojson',
    idProp: 'huc10',
    nameProp: 'name',
    sourceId: 'huc10-src',
    labelSourceId: 'huc10-label-src',
    fillLayer: 'huc10-fill',
    lineLayer: 'huc10-outline',
    labelLayer: 'huc10-label',
    labelMinZoom: 8,
    picklistId: 'picklist-huc10',
    radioId: 'poly-huc10',
  },
};

const STATS_URL = 'data/hydrography_stats.json';

// Each entry drives: the stream source/layer setup on every map, the normal-mode checkbox,
// and (in compare mode) a Left/Right/Off radio row. Adding a future layer (e.g. 3DHP) is a
// matter of appending one entry here plus its key to STREAM_LEGEND_ORDER below.
// Array order here is paint order only (MapLibre draws later-added layers on top), so NHD is
// listed first to keep OSM drawing on top where the two overlap, matching the original layer
// order — it does NOT drive legend/control display order; see STREAM_LEGEND_ORDER for that.
const STREAM_LAYERS = [
  {
    key: 'nhd',
    sourceId: 'nhd-streams',
    layerId: 'nhd-streams-line',
    sourceLayerName: 'nhd_flowlines',
    url: 'pmtiles://data/nhd_flowlines.pmtiles',
    paint: {
      'line-color': '#71e9e5',
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.5, 12, 3.75, 16, 7.5],
    },
    checkboxId: 'toggle-nhd-streams',
    label: 'NHD flowlines',
    defaultSide: 'right',
  },
  {
    key: 'osm',
    sourceId: 'osm-streams',
    layerId: 'osm-streams-line',
    sourceLayerName: 'osm_waterways',
    url: 'pmtiles://data/osm_waterways.pmtiles',
    paint: {
      'line-color': '#3420d1',
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 12, 1.5, 16, 3],
    },
    checkboxId: 'toggle-osm-streams',
    label: 'OSM waterways',
    defaultSide: 'left',
  },
];

const streamSide = {}; // key -> 'left' | 'right' | 'off', for compare mode
STREAM_LAYERS.forEach((entry) => {
  streamSide[entry.key] = entry.defaultSide;
});

// Display order for the stream legend/controls — independent of STREAM_LAYERS' paint order.
// Matches the hardcoded OSM/NHD row order in index.html's normal-mode checkbox legend.
const STREAM_LEGEND_ORDER = ['osm', 'nhd'];

const polyData = {}; // key -> parsed FeatureCollection
let statsData = null; // hydrography_stats.json contents, once loaded

let activeLayerKey = 'counties';
let selectedFeatureId = null; // id (idProp value) of the selected feature in the active layer

// ---------------------------------------------------------------------------
// Map setup
// ---------------------------------------------------------------------------

const pmtilesProtocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);

/**
 * Build a MapLibre style object with both basemap options (CARTO Voyager street map and
 * USGS satellite imagery), toggled via the "Basemap" radio buttons in the sidebar.
 *
 * Both raster layers are included so switching basemaps is a cheap layout-visibility flip
 * (see applyBasemapChoice()) rather than a full map.setStyle(), which would tear down and
 * re-fetch every runtime-added layer (streams, polygons).
 *
 * Returns a fresh object on every call — MapLibre attaches internal bookkeeping to the
 * style object it's given, so the primary map and the compare "after" map can't share one.
 *
 * @returns {object} A MapLibre GL style spec.
 */
function buildBaseStyle() {
  return {
    version: 8,
    sources: {
      'basemap-street': {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          'https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
        ],
        // one alternative to the above: "light_all" instead of "rastertiles/voyager"
        // (monochrome; no colors for highways, parks, etc)
        tileSize: 256,
        attribution:
          '&copy; <a href="https://carto.com/attributions">CARTO</a> ' +
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
      'basemap-satellite': {
        type: 'raster',
        // ArcGIS tile services use a {z}/{y}/{x} path order (row before column).
        tiles: [
          'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        attribution: 'Imagery courtesy of the U.S. Geological Survey, The National Map',
      },
    },
    layers: [
      { id: 'basemap-street', type: 'raster', source: 'basemap-street' },
      {
        id: 'basemap-satellite',
        type: 'raster',
        source: 'basemap-satellite',
        layout: { visibility: 'none' },
      },
    ],
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  };
}

/**
 * Apply the sidebar's basemap radio choice ("street" or "satellite") to a map by flipping
 * layout visibility between the 'basemap-street' and 'basemap-satellite' layers.
 *
 * Safe to call with `targetMap === null` (e.g. before the compare "after" map exists).
 *
 * @param {maplibregl.Map|null} targetMap
 * @param {'street'|'satellite'} choice
 */
function applyBasemapChoice(targetMap, choice) {
  setLayerVisibility(targetMap, 'basemap-street', choice === 'street');
  setLayerVisibility(targetMap, 'basemap-satellite', choice === 'satellite');
}

const map = new maplibregl.Map({
  container: 'map',
  center: [-121.0, 47.4],
  zoom: 6.4,
  style: buildBaseStyle(),
});

// showCompass: false drops the reset-bearing-to-north button; kept the zoom in/out buttons.
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

// Compare-mode state — the second map/control are created lazily on first toggle-in and then
// kept alive for the session (see ensureAfterMap/toggleCompareMode) rather than being torn down
// and recreated on every toggle, so pmtiles/geojson aren't re-fetched each time.
let mapAfter = null;
let compareControl = null;
let compareActive = false;
let afterMapReadyPromise = null;
let polygonLayersReadyPromise = null;

map.on('load', () => {
  addStreamLayers(map);
  wireStreamInteractivity();
  wireBasemapControl();
  loadAllPolygonLayers();
  loadStats();
});

/** Wire up the "Basemap" street/satellite radio buttons. Applies to both maps in compare mode. */
function wireBasemapControl() {
  document.querySelectorAll('input[name="basemap-choice"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      applyBasemapChoice(map, radio.value);
      applyBasemapChoice(mapAfter, radio.value);
    });
  });
}

/** @returns {'street'|'satellite'} The currently selected basemap radio value. */
function currentBasemapChoice() {
  return document.querySelector('input[name="basemap-choice"]:checked').value;
}

/**
 * Fetch the precomputed stream-mileage stats JSON into the module-level `statsData`.
 * On failure, `statsData` is left as `null` and stat lookups fall back to "Stats not available".
 */
function loadStats() {
  return fetch(STATS_URL)
    .then((res) => res.json())
    .then((data) => {
      statsData = data;
    })
    .catch((err) => {
      console.error(`Failed to load ${STATS_URL}`, err);
      statsData = null;
    });
}

// ---------------------------------------------------------------------------
// Stream layers (PMTiles vector sources)
// ---------------------------------------------------------------------------

/**
 * Add the OSM/NHD vector sources and line layers (from STREAM_LAYERS) to a map.
 *
 * Pure source/layer setup with no interactivity, so it can be called for both the
 * primary map and the compare "after" map.
 *
 * @param {maplibregl.Map} targetMap
 */
function addStreamLayers(targetMap) {
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
function wireStreamInteractivity() {
  STREAM_LAYERS.forEach((entry) => {
    document.getElementById(entry.checkboxId).addEventListener('change', () => {
      applyStreamLayerVisibility(entry);
    });
    map.on('mouseenter', entry.layerId, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', entry.layerId, () => (map.getCanvas().style.cursor = ''));
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
function setLayerVisibility(targetMap, layerId, visible) {
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
function applyStreamLayerVisibility(entry) {
  if (compareActive) {
    setLayerVisibility(map, entry.layerId, streamSide[entry.key] === 'left');
    setLayerVisibility(mapAfter, entry.layerId, streamSide[entry.key] === 'right');
  } else {
    const checked = document.getElementById(entry.checkboxId).checked;
    setLayerVisibility(map, entry.layerId, checked);
  }
}

/** Re-apply visibility for every entry in STREAM_LAYERS (see applyStreamLayerVisibility). */
function applyAllStreamVisibility() {
  STREAM_LAYERS.forEach(applyStreamLayerVisibility);
}

// ---------------------------------------------------------------------------
// Swipe compare mode
// ---------------------------------------------------------------------------

/**
 * Build one Left/Right/Off radio row per STREAM_LAYERS entry into #stream-side-controls.
 *
 * A future third layer (e.g. 3DHP) needs no changes here — it's driven entirely by the config.
 */
function renderStreamSideControls() {
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
      radio.checked = streamSide[entry.key] === side;
      radio.addEventListener('change', () => {
        streamSide[entry.key] = side;
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
function ensureAfterMap() {
  if (afterMapReadyPromise) return afterMapReadyPromise;
  afterMapReadyPromise = new Promise((resolve) => {
    mapAfter = new maplibregl.Map({
      container: 'map-after',
      center: map.getCenter(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      style: buildBaseStyle(),
      attributionControl: false,
    });
    mapAfter.on('load', () => {
      addStreamLayers(mapAfter);
      applyBasemapChoice(mapAfter, currentBasemapChoice());
      polygonLayersReadyPromise.then(() => {
        Object.entries(POLY_LAYERS).forEach(([key, cfg]) => {
          addPolygonLayer(mapAfter, key, cfg, polyData[key], key === activeLayerKey);
        });
        resolve();
      });
    });
  });
  return afterMapReadyPromise;
}

/**
 * Toggle swipe-compare mode on/off: shows/hides the after-map, and (re)creates the
 * maplibre-gl-compare slider control that pairs it with the primary map.
 */
function toggleCompareMode() {
  compareActive = !compareActive;
  document.getElementById('map-after').hidden = !compareActive;
  document.getElementById('compare-slider').hidden = !compareActive;
  document.getElementById('stream-checkbox-controls').hidden = compareActive;
  document.getElementById('stream-side-controls').hidden = !compareActive;
  document.getElementById('compare-toggle-btn').textContent =
    compareActive ? 'Exit swipe compare' : 'Enable swipe compare';

  if (!compareActive) {
    if (compareControl) {
      compareControl.remove(); // resets the CSS clip Compare applied to the primary map
      compareControl = null;
    }
    applyAllStreamVisibility();
    return;
  }

  ensureAfterMap().then(() => {
    // The primary map stays fully interactive while compare mode is off, so the after-map
    // (frozen since it was last hidden) needs an explicit resync before re-pairing them —
    // otherwise the two views visibly jump into alignment on the next drag instead of
    // matching immediately.
    mapAfter.jumpTo({
      center: map.getCenter(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    });
    // A ResizeObserver on a hidden container won't have tracked any window resize that
    // happened while compare mode was off, so both maps get an explicit resize here.
    map.resize();
    mapAfter.resize();
    compareControl = new maplibregl.Compare(map, mapAfter, '#compare-slider', {
      orientation: 'vertical',
      mousemove: false,
    });
    applyAllStreamVisibility();
  });
}

renderStreamSideControls();
document.getElementById('compare-toggle-btn').addEventListener('click', toggleCompareMode);

let currentStreamPopup = null;

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
function showStreamPopup(e, features) {
  const osmFeature = features.find((f) => f.layer.id === 'osm-streams-line');
  const nhdFeature = features.find((f) => f.layer.id === 'nhd-streams-line');

  const sections = [];
  if (osmFeature) sections.push(streamSectionHtml(osmFeature.properties, 'osm'));
  if (nhdFeature) sections.push(streamSectionHtml(nhdFeature.properties, 'nhd'));

  if (currentStreamPopup) currentStreamPopup.remove();
  currentStreamPopup = new maplibregl.Popup({ maxWidth: '260px' })
    .setLngLat(e.lngLat)
    .setHTML(sections.join('<hr class="popup-divider">'))
    .addTo(map);
  currentStreamPopup.on('close', () => {
    currentStreamPopup = null;
  });
}

// ---------------------------------------------------------------------------
// Polygon layers (GeoJSON sources: counties, HUC-8, HUC-10)
// ---------------------------------------------------------------------------

/**
 * Fetch every POLY_LAYERS GeoJSON file, add each as a layer on the primary map, and wire
 * up its interactivity, picklist, and radio button. Also sets `polygonLayersReadyPromise`,
 * which ensureAfterMap() awaits before mirroring the layers onto the compare "after" map.
 */
function loadAllPolygonLayers() {
  const fetches = Object.entries(POLY_LAYERS).map(([key, cfg]) =>
    fetch(cfg.file)
      .then((res) => res.json())
      .then((geojson) => {
        polyData[key] = geojson;
        addPolygonLayer(map, key, cfg, geojson, key === activeLayerKey);
        wirePolygonInteractivity(cfg);
        populatePicklist(key, cfg, geojson);
      })
      .catch((err) => console.error(`Failed to load ${cfg.file}`, err))
  );
  polygonLayersReadyPromise = Promise.all(fetches);

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
function addPolygonLayer(targetMap, key, cfg, geojson, visible) {
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
  map.on('mouseenter', cfg.fillLayer, () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', cfg.fillLayer, () => (map.getCanvas().style.cursor = ''));
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
function setActivePolygonLayer(activeKey) {
  clearSelectedFeature();
  activeLayerKey = activeKey;
  Object.entries(POLY_LAYERS).forEach(([key, cfg]) => {
    const visible = key === activeKey;
    [map, mapAfter].forEach((targetMap) => {
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
function clearSelectedFeature() {
  if (selectedFeatureId == null) return;
  const cfg = POLY_LAYERS[activeLayerKey];
  map.setFeatureState({ source: cfg.sourceId, id: selectedFeatureId }, { selected: false });
  selectedFeatureId = null;
}

// Single click handler for the whole map: streams take priority over the polygon underneath
// them (so clicking a stream never also selects/zooms to the county or HUC it crosses), and
// clicking empty polygon area clears the current highlight.
const STREAM_CLICK_TOLERANCE_PX = 2;

map.on('click', (e) => {
  const streamLayers = ['osm-streams-line', 'nhd-streams-line'].filter((id) => map.getLayer(id));
  // Query a small box instead of the exact pixel so a click near where an OSM and NHD stream
  // run alongside each other reliably picks up both, not just whichever is nearer the cursor.
  const t = STREAM_CLICK_TOLERANCE_PX;
  const box = [
    [e.point.x - t, e.point.y - t],
    [e.point.x + t, e.point.y + t],
  ];
  const streamFeatures = streamLayers.length
    ? map.queryRenderedFeatures(box, { layers: streamLayers })
    : [];
  if (streamFeatures.length > 0) {
    showStreamPopup(e, streamFeatures);
    return;
  }

  const cfg = POLY_LAYERS[activeLayerKey];
  if (!map.getLayer(cfg.fillLayer)) return;
  const hit = map.queryRenderedFeatures(e.point, { layers: [cfg.fillLayer] });
  if (hit.length === 0) {
    clearSelectedFeature();
    return;
  }

  // Features from queryRenderedFeatures can have geometry clipped to internal
  // GeoJSON-source tile boundaries; use the untouched feature from polyData so
  // bboxOfGeometry always sees the full polygon.
  const clickedId = String(hit[0].properties[cfg.idProp]);
  const feature = polyData[activeLayerKey].features.find(
    (f) => String(f.properties[cfg.idProp]) === clickedId
  );
  selectPolygonFeature(activeLayerKey, cfg, feature || hit[0]);
});

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
function selectPolygonFeature(key, cfg, feature, opts = {}) {
  clearSelectedFeature();
  selectedFeatureId = feature.properties[cfg.idProp];
  map.setFeatureState({ source: cfg.sourceId, id: selectedFeatureId }, { selected: true });

  const bbox = bboxOfGeometry(feature.geometry);
  // Left padding accounts for the sidebar panel, which sits on top of the map — otherwise an
  // east-west-oblong polygon can end up with its left edge fit right underneath it.
  const panelRight = document.getElementById('panel').getBoundingClientRect().right;
  map.fitBounds(bbox, {
    padding: { top: 60, bottom: 60, left: panelRight + 20, right: 60 },
    maxZoom: 12,
    duration: 800,
  });

  const name = feature.properties[cfg.nameProp] || '(unnamed)';
  document.getElementById('info-placeholder').hidden = true;
  document.getElementById('info-content').hidden = false;
  document.getElementById('info-name').textContent = name;

  const id = String(feature.properties[cfg.idProp]);
  const stats = statsData && statsData[key] && statsData[key][id];
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
  } else if (currentStreamPopup) {
    currentStreamPopup.remove();
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a GeoJSON geometry's bounding box by recursively walking its coordinates array
 * to whatever nesting depth its geometry type uses (e.g. 2 for Polygon, 3 for MultiPolygon).
 *
 * @param {object} geometry A GeoJSON geometry object.
 * @returns {[[number, number], [number, number]]} [[minX, minY], [maxX, maxY]].
 */
function bboxOfGeometry(geometry) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  function visit(coords, depth) {
    if (depth === 0) {
      const [x, y] = coords;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    } else {
      coords.forEach((c) => visit(c, depth - 1));
    }
  }

  const depthByType = {
    Point: 0,
    MultiPoint: 1,
    LineString: 1,
    MultiLineString: 2,
    Polygon: 2,
    MultiPolygon: 3,
  };

  visit(geometry.coordinates, depthByType[geometry.type]);
  return [[minX, minY], [maxX, maxY]];
}

/**
 * Compute a linear ring's area-weighted centroid, via the standard polygon-centroid formula.
 *
 * @param {[number, number][]} ring Closed ring of [x, y] coordinate pairs.
 * @returns {{area: number, x: number, y: number}|null} Null for a degenerate (zero-area) ring.
 */
function ringCentroid(ring) {
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area *= 0.5;
  if (area === 0) return null;
  return { area: Math.abs(area), x: cx / (6 * area), y: cy / (6 * area) };
}

/**
 * Find the centroid of a Polygon/MultiPolygon's largest ring, used as a single stable
 * label anchor per feature (see addPolygonLayer's note on why labels use this instead of
 * the polygon source directly).
 *
 * @param {object} geometry A GeoJSON Polygon or MultiPolygon geometry.
 * @returns {[number, number]|null} [x, y], or null if no ring has any area.
 */
function polygonCentroid(geometry) {
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  let best = null;
  for (const poly of polygons) {
    const c = ringCentroid(poly[0]);
    if (c && (!best || c.area > best.area)) best = c;
  }
  return best ? [best.x, best.y] : null;
}

/**
 * Build a Point FeatureCollection (one feature per input polygon, at its centroid) for labeling.
 * Polygons with no computable centroid are silently skipped. Each output point keeps the
 * source polygon's full `properties`, so the label layer's `text-field` can read `nameProp`
 * off it — but note `nameProp` itself is unused in this function body.
 *
 * @param {object} geojson A Polygon/MultiPolygon FeatureCollection.
 * @param {string} nameProp Unused inside this function; addPolygonLayer's call site passes
 *   cfg.nameProp anyway, but this function ignores it and copies all of `properties` through.
 * @returns {object} A Point FeatureCollection.
 */
function polygonCentroids(geojson, nameProp) {
  const features = [];
  for (const f of geojson.features) {
    const coords = polygonCentroid(f.geometry);
    if (!coords) continue;
    features.push({
      type: 'Feature',
      properties: f.properties,
      geometry: { type: 'Point', coordinates: coords },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Format a mile count for display, e.g. 12.34 -> "12.3 mi".
 * @param {number} miles
 * @returns {string}
 */
function formatMiles(miles) {
  return miles.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' mi';
}

/**
 * Format OSM mileage as a percentage of NHD mileage, e.g. osmMiles/nhdMiles = 0.61 -> "61.0%"
 * (guards NHD-mileage-of-zero, which shouldn't occur in practice but would otherwise divide
 * by zero).
 * @param {number} osmMiles
 * @param {number} nhdMiles
 * @returns {string}
 */
function formatRatio(osmMiles, nhdMiles) {
  if (!nhdMiles) return 'N/A';
  return (osmMiles / nhdMiles * 100).toFixed(1) + '%';
}

/**
 * Escape a string for safe insertion into innerHTML, via the DOM's own textContent -> innerHTML
 * round-trip (avoids hand-rolling entity escaping). `null`/`undefined` become `''`; any other
 * non-string value is coerced with `String()` first.
 * @param {*} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
