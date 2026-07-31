# WA Hydrography: OSM vs. USGS NHD

> **Work in progress.** This README/repo/website are still a WIP.
> Updates coming soon, including among other things, the addition of another layer for the USGS 3DHP data for Washington.


**Live site:** https://osm-vs-nhd-hydrography.s3.us-west-2.amazonaws.com/index.html

An interactive web map comparing how OpenStreetMap (OSM) and the USGS National
Hydrography Dataset (NHD) each map rivers, streams, and canals across Washington
State. Pick a county or watershed to see stream mileage from both datasets side by
side, or use swipe-compare to see the two networks overlaid directly on the map.

This was  my final project for my graduate-level course _Open Web Mapping_ at Penn State
University.

## Features

- OSM waterways and NHD flowlines as toggleable layers over a street or satellite
  basemap
- Three selectable boundary layers: counties, HUC-8 watersheds, HUC-10 watersheds
- Click a boundary (or pick one from a sidebar list) to see precomputed OSM vs. NHD
  stream mileage for that area
- Swipe/compare mode for comparing the two layers side by side
- Click an individual stream segment for some basic attributes

## Tech stack

- [MapLibre GL JS](https://maplibre.org/) for the map
- [PMTiles](https://protomaps.com/docs/pmtiles) for the stream layers (single-file
  vector tiles, served over plain HTTP range requests: no tile server needed)
- Fully static site: HTML/CSS/vanilla JS, no build step, no backend

## Repo contents

- [`index.html`](index.html), [`app.js`](app.js), [`style.css`](style.css): the site
- `data/`: the small data files the site loads directly: boundary polygons
  (GeoJSON) and precomputed stream-mileage stats (JSON). The stream layers
  themselves (`osm_waterways.pmtiles`, `nhd_flowlines.pmtiles`) are too large for
  this repo.
- [`scripts/serve.py`](scripts/serve.py): a small dev-only local server (adds HTTP
  Range support, which PMTiles needs, on top of Python's built-in static file
  server)
- `scripts/process_new_input_data.py`: the data-prep pipeline that turns raw
  OSM/NHD source data into everything in `data/`, plus the mileage stats. **(Coming
  soon)**


## Running locally

```
python scripts/serve.py
```

then open `http://127.0.0.1:8766`.

## Data sources & attribution

- Streams/waterways: [OpenStreetMap](https://www.openstreetmap.org/copyright)
  contributors, and the
  [USGS National Hydrography Dataset](https://www.usgs.gov/national-hydrography/access-national-hydrography-products)
- Boundaries: OSM (counties) and USGS Watershed Boundary Dataset (HUC-8/HUC-10)
- Street basemap: [CARTO](https://carto.com/attributions) / OpenStreetMap
- Satellite basemap: [USGS National Map](https://www.usgs.gov/programs/national-geospatial-program/national-map)
