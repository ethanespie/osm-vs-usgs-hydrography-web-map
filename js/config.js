// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// CARTO now requires a free API key on basemap tile requests (unauthenticated
// requests get a watermark). Get one at https://carto.com/basemaps/apikey/
// (email only, key arrives instantly, 5M tile requests/month free tier).
export const CARTO_API_KEY = 'cb1_3jlo_1_678dae8dd5b52e205ebc3f9f';

export const POLY_LAYERS = {
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

export const STATS_URL = 'data/hydrography_stats.json';

// Each entry drives: the stream source/layer setup on every map, the normal-mode checkbox,
// and (in compare mode) a Left/Right/Off radio row. Adding a future layer (e.g. 3DHP) is a
// matter of appending one entry here plus its key to STREAM_LEGEND_ORDER below.
// Array order here is paint order only (MapLibre draws later-added layers on top), so NHD is
// listed first to keep OSM drawing on top where the two overlap, matching the original layer
// order — it does NOT drive legend/control display order; see STREAM_LEGEND_ORDER for that.
export const STREAM_LAYERS = [
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

// Display order for the stream legend/controls — independent of STREAM_LAYERS' paint order.
// Matches the hardcoded OSM/NHD row order in index.html's normal-mode checkbox legend.
export const STREAM_LEGEND_ORDER = ['osm', 'nhd'];
