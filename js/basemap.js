// ---------------------------------------------------------------------------
// Basemap (CARTO street / USGS satellite)
// ---------------------------------------------------------------------------

import { CARTO_API_KEY } from './config.js';
import { state } from './state.js';
import { setLayerVisibility } from './streams.js';

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
export function buildBaseStyle() {
  return {
    version: 8,
    sources: {
      'basemap-street': {
        type: 'raster',
        tiles: [
          `https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`,
          `https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`,
          `https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`,
          `https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`,
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
 * Apply a basemap choice ("street" or "satellite") to a map by flipping layout visibility
 * between the 'basemap-street' and 'basemap-satellite' layers.
 *
 * Safe to call with `targetMap === null` (e.g. before the compare "after" map exists).
 *
 * @param {maplibregl.Map|null} targetMap
 * @param {'street'|'satellite'} choice
 */
export function applyBasemapChoice(targetMap, choice) {
  setLayerVisibility(targetMap, 'basemap-street', choice === 'street');
  setLayerVisibility(targetMap, 'basemap-satellite', choice === 'satellite');
}

/**
 * Corner control with one button per basemap choice, styled to match MapLibre's own
 * NavigationControl so it reads as part of the same top-right control cluster instead of
 * living in the sidebar.
 */
export class BasemapControl {
  onAdd() {
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group basemap-ctrl';
    this._streetBtn = this._makeButton('🗺️', 'Street map (CartoCDN / OSM)', 'street');
    this._satelliteBtn = this._makeButton('🛰️', 'Satellite imagery (USGS)', 'satellite');
    this._container.append(this._streetBtn, this._satelliteBtn);
    this._updateActiveButton();
    return this._container;
  }

  onRemove() {
    this._container.remove();
  }

  _makeButton(icon, title, choice) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.textContent = icon;
    btn.addEventListener('click', () => {
      state.currentBasemap = choice;
      applyBasemapChoice(state.map, choice);
      applyBasemapChoice(state.mapAfter, choice);
      this._updateActiveButton();
    });
    return btn;
  }

  _updateActiveButton() {
    this._streetBtn.classList.toggle('active', state.currentBasemap === 'street');
    this._satelliteBtn.classList.toggle('active', state.currentBasemap === 'satellite');
  }
}

/** @returns {'street'|'satellite'} The currently selected basemap choice. */
export function currentBasemapChoice() {
  return state.currentBasemap;
}
