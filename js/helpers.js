// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Pure functions with no dependency on shared state.

/**
 * Compute a GeoJSON geometry's bounding box by recursively walking its coordinates array
 * to whatever nesting depth its geometry type uses (e.g. 2 for Polygon, 3 for MultiPolygon).
 *
 * @param {object} geometry A GeoJSON geometry object.
 * @returns {[[number, number], [number, number]]} [[minX, minY], [maxX, maxY]].
 */
export function bboxOfGeometry(geometry) {
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
export function ringCentroid(ring) {
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
export function polygonCentroid(geometry) {
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
export function polygonCentroids(geojson, nameProp) {
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
export function formatMiles(miles) {
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
export function formatRatio(osmMiles, nhdMiles) {
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
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
