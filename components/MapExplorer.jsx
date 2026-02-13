import React, { useState, useEffect, useRef } from 'react';
import { Icons } from './Icons';
import { analyzeLandData } from '../services/geminiService';
import { BarChart, Bar, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// Fix Leaflet icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const EARTH_SEARCH_URL = '/earth-search/search';
const TITILER_STATS_URL = '/titiler/stac/statistics';
const NOMINATIM_URL = '/nominatim/search';

const DEFAULT_LOCATION = {
  name: 'Default Location',
  coords: [36.7378, -119.7871]
};

const MAP_LAYERS = [
  { id: 'OSM', name: 'OpenStreetMap', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap contributors' },
  { id: 'SAT', name: 'Satellite (Esri)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community' }
];

const STAT_COLORS = ['#d7191c', '#fdae61', '#ffffbf', '#a6d96a', '#1a9641'];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatCoord = (coords) => {
  if (!coords) return 'NA';
  return `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`;
};

const formatDate = (isoValue) => {
  if (!isoValue) return 'NA';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return isoValue;
  return date.toLocaleDateString();
};

const extractErrorText = async (response) => {
  try {
    const payload = await response.json();
    if (payload?.detail) {
      return typeof payload.detail === 'string' ? payload.detail : JSON.stringify(payload.detail);
    }
    return JSON.stringify(payload);
  } catch (_) {
    try {
      return await response.text();
    } catch (__ ) {
      return 'Unknown API error';
    }
  }
};

const getDateRange = (daysBack = 120) => {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - daysBack);
  return `${start.toISOString()}/${end.toISOString()}`;
};

const buildSelectionFeature = (selectionBounds) => {
  const nw = selectionBounds.northWest;
  const ne = selectionBounds.northEast;
  const sw = selectionBounds.southWest;
  const se = selectionBounds.southEast;

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [nw[1], nw[0]],
        [ne[1], ne[0]],
        [se[1], se[0]],
        [sw[1], sw[0]],
        [nw[1], nw[0]]
      ]]
    }
  };
};

const buildBbox = (selectionBounds) => {
  const lats = [
    selectionBounds.northWest[0],
    selectionBounds.northEast[0],
    selectionBounds.southWest[0],
    selectionBounds.southEast[0]
  ];
  const lngs = [
    selectionBounds.northWest[1],
    selectionBounds.northEast[1],
    selectionBounds.southWest[1],
    selectionBounds.southEast[1]
  ];

  return [
    Math.min(...lngs),
    Math.min(...lats),
    Math.max(...lngs),
    Math.max(...lats)
  ];
};

const fallbackHistogram = (mean) => {
  const buckets = new Array(10).fill(0);
  const idx = clamp(Math.floor(((mean + 1) / 2) * 10), 0, 9);
  buckets[idx] = 1;
  return buckets.map((count, i) => ({
    bin: (-1 + i * 0.2).toFixed(2),
    count
  }));
};

const histogramFromTitiler = (rawHistogram, min, max, mean) => {
  if (
    rawHistogram &&
    typeof rawHistogram === 'object' &&
    !Array.isArray(rawHistogram) &&
    Array.isArray(rawHistogram.bins) &&
    Array.isArray(rawHistogram.counts)
  ) {
    const edges = rawHistogram.bins;
    const counts = rawHistogram.counts;
    if (counts.length > 0) {
      return counts.map((count, idx) => {
        const hasEdgePairs = edges.length === counts.length + 1;
        const center = hasEdgePairs
          ? (toNumber(edges[idx]) + toNumber(edges[idx + 1])) / 2
          : min + ((idx + 0.5) * (max - min)) / counts.length;

        return {
          bin: clamp(center, -1, 1).toFixed(2),
          count: toNumber(count)
        };
      });
    }
  }

  if (
    Array.isArray(rawHistogram) &&
    rawHistogram.length === 2 &&
    Array.isArray(rawHistogram[0]) &&
    Array.isArray(rawHistogram[1])
  ) {
    const edges = rawHistogram[0];
    const counts = rawHistogram[1];
    if (counts.length > 0) {
      return counts.map((count, idx) => {
        const hasEdgePairs = edges.length === counts.length + 1;
        const center = hasEdgePairs
          ? (toNumber(edges[idx]) + toNumber(edges[idx + 1])) / 2
          : min + ((idx + 0.5) * (max - min)) / counts.length;

        return {
          bin: clamp(center, -1, 1).toFixed(2),
          count: toNumber(count)
        };
      });
    }
  }

  return fallbackHistogram(mean);
};

const parseTitilerStats = (payload) => {
  const candidates = [];
  const pushCandidate = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;

    if (
      Number.isFinite(toNumber(value.mean, NaN)) ||
      Number.isFinite(toNumber(value.min, NaN)) ||
      Number.isFinite(toNumber(value.max, NaN))
    ) {
      candidates.push(value);
    }
  };

  const walk = (node, depth = 0) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) {
      node.forEach((value) => walk(value, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;

    pushCandidate(node);
    Object.values(node).forEach((value) => walk(value, depth + 1));
  };

  walk(payload, 0);

  const stat = candidates
    .sort((a, b) => {
      const aScore =
        Number.isFinite(toNumber(a.min, NaN)) +
        Number.isFinite(toNumber(a.max, NaN)) +
        Number.isFinite(toNumber(a.mean, NaN)) +
        (a.histogram ? 1 : 0);
      const bScore =
        Number.isFinite(toNumber(b.min, NaN)) +
        Number.isFinite(toNumber(b.max, NaN)) +
        Number.isFinite(toNumber(b.mean, NaN)) +
        (b.histogram ? 1 : 0);
      return bScore - aScore;
    })[0];

  if (!stat) {
    throw new Error('Could not parse NDVI statistics response.');
  }

  const min = clamp(toNumber(stat.min, -1), -1, 1);
  const max = clamp(toNumber(stat.max, 1), -1, 1);
  const mean = clamp(toNumber(stat.mean, 0), -1, 1);
  const stdDev = toNumber(stat.std, toNumber(stat.stdev, toNumber(stat.stdDev, 0)));
  const histogram = histogramFromTitiler(stat.histogram, min, max, mean);

  return { min, max, mean, stdDev, histogram };
};

const selectAssetPair = (assets = {}) => {
  const keys = Object.keys(assets);
  const redCandidates = ['red', 'B04', 'b04', 'red-jp2'];
  const nirCandidates = ['nir', 'nir08', 'B08', 'b08', 'nir08-jp2', 'nir-jp2'];

  const red = redCandidates.find((key) => keys.includes(key));
  const nir = nirCandidates.find((key) => keys.includes(key));

  if (!red || !nir) return null;
  return { red, nir };
};

const classifyLandByNdvi = (stats) => {
  if (!stats?.histogram?.length) return null;

  const total = stats.histogram.reduce((acc, entry) => acc + toNumber(entry.count), 0) || 1;
  const high = stats.histogram
    .filter((entry) => toNumber(entry.bin) >= 0.45)
    .reduce((acc, entry) => acc + toNumber(entry.count), 0);
  const moderate = stats.histogram
    .filter((entry) => toNumber(entry.bin) >= 0.2 && toNumber(entry.bin) < 0.45)
    .reduce((acc, entry) => acc + toNumber(entry.count), 0);
  const negative = stats.histogram
    .filter((entry) => toNumber(entry.bin) < 0)
    .reduce((acc, entry) => acc + toNumber(entry.count), 0);

  const highPct = (high / total) * 100;
  const moderatePct = (moderate / total) * 100;
  const negativePct = (negative / total) * 100;

  if (stats.mean >= 0.45 && highPct >= 30) {
    return {
      label: 'Forest / Dense Vegetation',
      confidence: Math.min(95, Math.round(60 + highPct * 0.7)),
      reason: 'High true NDVI and strong dense-green share indicate forest or dense vegetation.'
    };
  }

  if (stats.mean >= 0.25 && (highPct + moderatePct) >= 45) {
    return {
      label: 'Agriculture / Cropland',
      confidence: Math.min(92, Math.round(55 + (highPct + moderatePct) * 0.5)),
      reason: 'Moderate-to-high true NDVI is typical of active crop cover.'
    };
  }

  if (stats.mean >= 0.1) {
    return {
      label: 'Grassland / Shrubland',
      confidence: 74,
      reason: 'Medium NDVI indicates sparse-to-moderate vegetation.'
    };
  }

  if (stats.mean < 0 && negativePct > 55) {
    return {
      label: 'Water / Wet Surface',
      confidence: 80,
      reason: 'Negative NDVI dominant share indicates water or saturated surfaces.'
    };
  }

  return {
    label: 'Barren / Built-up',
    confidence: 72,
    reason: 'Low NDVI response suggests bare soil, dry land, or built-up surfaces.'
  };
};

const createAnalysisPlaceholderImage = (meanNdvi) => {
  const t = clamp((meanNdvi + 1) / 2, 0, 1);
  const red = Math.round(255 * (1 - t));
  const green = Math.round(255 * t);

  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = `rgb(${red}, ${green}, 40)`;
  ctx.fillRect(0, 0, 32, 32);
  return canvas.toDataURL('image/jpeg').split(',')[1];
};

export const MapExplorer = () => {
  const [activeLocation, setActiveLocation] = useState(DEFAULT_LOCATION);
  const [activeBaseLayer, setActiveBaseLayer] = useState('SAT');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchError, setSearchError] = useState('');
  const [result, setResult] = useState(null);
  const [computedStats, setComputedStats] = useState(null);
  const [selectionStart, setSelectionStart] = useState(null);
  const [selectionEnd, setSelectionEnd] = useState(null);
  const [selectedBounds, setSelectedBounds] = useState(null);
  const [landClassification, setLandClassification] = useState(null);
  const [ndviSource, setNdviSource] = useState(null);
  const [ndviError, setNdviError] = useState('');
  const [analysisImageBase64, setAnalysisImageBase64] = useState('');

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const selectionRectRef = useRef(null);
  const selectionStartRef = useRef(null);
  const selectionEndRef = useRef(null);

  const updateSelectionStart = (coords) => {
    selectionStartRef.current = coords;
    setSelectionStart(coords);
  };

  const updateSelectionEnd = (coords) => {
    selectionEndRef.current = coords;
    setSelectionEnd(coords);
  };

  const clearSelectionRectangle = () => {
    if (selectionRectRef.current) {
      selectionRectRef.current.remove();
      selectionRectRef.current = null;
    }
  };

  const resetSelectionState = () => {
    updateSelectionStart(null);
    updateSelectionEnd(null);
    setSelectedBounds(null);
    setComputedStats(null);
    setLandClassification(null);
    setNdviSource(null);
    setNdviError('');
    setAnalysisImageBase64('');
    clearSelectionRectangle();
  };

  const toBoundsPayload = (bounds) => {
    const nw = bounds.getNorthWest();
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const se = bounds.getSouthEast();
    const center = bounds.getCenter();

    return {
      northWest: [nw.lat, nw.lng],
      northEast: [ne.lat, ne.lng],
      southWest: [sw.lat, sw.lng],
      southEast: [se.lat, se.lng],
      center: [center.lat, center.lng]
    };
  };

  const fetchEarthSearchItem = async (selectionBounds) => {
    const geometry = buildSelectionFeature(selectionBounds).geometry;
    const response = await fetch(EARTH_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: ['sentinel-2-l2a', 'sentinel-2-c1-l2a'],
        intersects: geometry,
        datetime: getDateRange(180),
        limit: 25
      })
    });

    if (!response.ok) {
      const detail = await extractErrorText(response);
      throw new Error(`Sentinel scene search failed: ${detail}`);
    }

    const searchPayload = await response.json();
    const features = Array.isArray(searchPayload?.features) ? searchPayload.features : [];
    if (!features.length) {
      throw new Error('No Sentinel-2 scene found for selected area and date range.');
    }

    const ranked = [...features]
      .map((item) => ({ item, cloud: toNumber(item?.properties?.['eo:cloud_cover'], 999) }))
      .sort((a, b) => a.cloud - b.cloud);

    const withBands = ranked.find(({ item }) => selectAssetPair(item.assets));
    if (!withBands) {
      throw new Error('No Sentinel scene with usable red and NIR bands was found.');
    }

    const item = withBands.item;
    const pair = selectAssetPair(item.assets);

    const itemUrl =
      item.links?.find((link) => link.rel === 'self')?.href ||
      `https://earth-search.aws.element84.com/v1/collections/${item.collection}/items/${item.id}`;

    return {
      id: item.id,
      itemUrl,
      datetime: item.properties?.datetime || null,
      cloudCover: toNumber(item.properties?.['eo:cloud_cover'], 0),
      redAsset: pair.red,
      nirAsset: pair.nir
    };
  };

  const fetchTrueNdviStats = async (selectionBounds) => {
    const scene = await fetchEarthSearchItem(selectionBounds);
    const geometry = buildSelectionFeature(selectionBounds);

    const params = new URLSearchParams();
    params.set('url', scene.itemUrl);
    params.append('assets', scene.redAsset);
    params.append('assets', scene.nirAsset);
    // Use positional band names (b1, b2) to avoid parser issues with asset key names.
    // Asset order is red first, nir second.
    params.set('asset_as_band', 'false');
    params.set('expression', '(b2-b1)/(b2+b1)');

    const response = await fetch(`${TITILER_STATS_URL}?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geometry)
    });

    if (!response.ok) {
      const detail = await extractErrorText(response);
      throw new Error(`NDVI statistics request failed: ${detail}`);
    }

    const payload = await response.json();
    let stats;
    try {
      stats = parseTitilerStats(payload);
    } catch (error) {
      const snippet = JSON.stringify(payload)?.slice(0, 320) || 'empty response';
      throw new Error(`Could not parse NDVI statistics response. Payload: ${snippet}`);
    }

    return {
      stats,
      source: {
        provider: 'Sentinel-2 L2A (Earth Search + TiTiler)',
        sceneId: scene.id,
        acquiredAt: scene.datetime,
        cloudCover: scene.cloudCover,
        redAsset: scene.redAsset,
        nirAsset: scene.nirAsset
      }
    };
  };

  const processSelectionNdvi = async (selectionBounds) => {
    setIsProcessing(true);
    setComputedStats(null);
    setLandClassification(null);
    setNdviSource(null);
    setNdviError('');
    setAnalysisImageBase64('');

    try {
      const { stats, source } = await fetchTrueNdviStats(selectionBounds);
      setComputedStats(stats);
      setLandClassification(classifyLandByNdvi(stats));
      setNdviSource(source);
      setAnalysisImageBase64(createAnalysisPlaceholderImage(stats.mean));
    } catch (error) {
      console.warn('True NDVI processing failed.', error);
      const hint =
        error instanceof TypeError && error.message === 'Failed to fetch'
          ? 'Network or proxy error. Ensure internet is available and restart Vite dev server.'
          : null;
      setComputedStats(null);
      setLandClassification({
        label: 'Unavailable',
        confidence: 0,
        reason: 'True NDVI could not be computed for this area right now.'
      });
      setNdviSource(null);
      setNdviError(hint || (error instanceof Error ? error.message : 'Unknown NDVI error'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMapClick = (event) => {
    if (!event?.latlng || isProcessing) return;

    const clickedPoint = [event.latlng.lat, event.latlng.lng];
    setResult(null);

    if (!selectionStartRef.current || selectionEndRef.current) {
      updateSelectionStart(clickedPoint);
      updateSelectionEnd(null);
      setSelectedBounds(null);
      setComputedStats(null);
      setLandClassification(null);
      setNdviSource(null);
      setNdviError('');
      setAnalysisImageBase64('');
      clearSelectionRectangle();
      return;
    }

    const start = selectionStartRef.current;
    const end = clickedPoint;

    updateSelectionEnd(end);
    const bounds = L.latLngBounds(
      L.latLng(start[0], start[1]),
      L.latLng(end[0], end[1])
    );

    const payload = toBoundsPayload(bounds);
    setSelectedBounds(payload);
    clearSelectionRectangle();
    if (mapInstanceRef.current) {
      selectionRectRef.current = L.rectangle(bounds, {
        color: '#22c55e',
        weight: 2,
        fillColor: '#22c55e',
        fillOpacity: 0.15
      }).addTo(mapInstanceRef.current);
    }

    void processSelectionNdvi(payload);
  };

  const handleLocationSearch = async (event) => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) {
      setSearchError('Enter a location to search.');
      return;
    }

    setIsSearching(true);
    setSearchError('');
    setResult(null);

    try {
      const coordMatch = query.match(
        /^\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)\\s*$/
      );
      if (coordMatch) {
        const coords = [parseFloat(coordMatch[1]), parseFloat(coordMatch[2])];
        if (Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
          setActiveLocation({ name: 'Custom Coordinates', coords });
          resetSelectionState();
          if (mapInstanceRef.current) {
            mapInstanceRef.current.flyTo(coords, 13, { duration: 1.2 });
          }
          return;
        }
      }

      const response = await fetch(
        `${NOMINATIM_URL}?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(query)}`
      );
      if (!response.ok) {
        const message = await response.text();
        throw new Error(`Location lookup failed (${response.status}): ${message || 'Unknown error'}`);
      }

      const results = await response.json();
      if (!results.length) {
        setSearchError('No matching location found.');
        return;
      }

      const match = results[0];
      const coords = [parseFloat(match.lat), parseFloat(match.lon)];
      const label = (match.display_name || query).split(',').slice(0, 2).join(',').trim();

      setActiveLocation({ name: label || query, coords });
      resetSelectionState();

      if (mapInstanceRef.current) {
        mapInstanceRef.current.flyTo(coords, 13, { duration: 1.2 });
      }
    } catch (error) {
      console.error(error);
      setSearchError(error instanceof Error ? error.message : 'Search failed. Try another location.');
    } finally {
      setIsSearching(false);
    }
  };

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current).setView(activeLocation.coords, 13);
    const layerConfig = MAP_LAYERS.find((layer) => layer.id === activeBaseLayer) || MAP_LAYERS[1];
    tileLayerRef.current = L.tileLayer(layerConfig.url, {
      attribution: layerConfig.attribution,
      maxZoom: 19
    }).addTo(map);

    mapInstanceRef.current = map;

    setTimeout(() => {
      map.invalidateSize();
    }, 100);

    map.on('click', handleMapClick);

    return () => {
      map.off('click', handleMapClick);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!tileLayerRef.current) return;
    const layerConfig = MAP_LAYERS.find((layer) => layer.id === activeBaseLayer);
    if (layerConfig) {
      tileLayerRef.current.setUrl(layerConfig.url);
    }
  }, [activeBaseLayer]);

  const handleAnalyze = async () => {
    if (!computedStats) return;
    setIsProcessing(true);

    const statsToUse = { NDVI: computedStats };
    const sourceText = ndviSource
      ? `Source: ${ndviSource.provider}, scene ${ndviSource.sceneId}, acquired ${formatDate(ndviSource.acquiredAt)}, cloud cover ${ndviSource.cloudCover.toFixed(1)}%.`
      : 'Source: NDVI dataset metadata unavailable.';

    const locationPrompt = selectedBounds
      ? `Analyze land for selected parcel with corners NW ${formatCoord(selectedBounds.northWest)} and SE ${formatCoord(selectedBounds.southEast)}. ${sourceText}`
      : `Analyze land parcel located at ${activeLocation.coords.join(', ')}. ${sourceText}`;

    try {
      const base64 = analysisImageBase64 || createAnalysisPlaceholderImage(computedStats.mean);
      const analysis = await analyzeLandData(base64, locationPrompt, statsToUse);
      setResult(analysis);
    } catch (error) {
      console.error(error);
    } finally {
      setIsProcessing(false);
    }
  };

  const activeCoords = selectedBounds?.center || activeLocation.coords;
  const selectionStatus = selectionStart && !selectionEnd
    ? 'Corner A selected. Click opposite corner to complete diagonal.'
    : selectedBounds
      ? 'Area selected. True NDVI calculated for selected rectangle.'
      : 'Click map to select first corner of area.';

  return (
    <div className="h-full min-h-[620px] flex flex-col md:flex-row bg-slate-50/60 overflow-hidden">
      <div className="w-full md:w-80 flex flex-col bg-white border-r border-slate-200 z-20 shadow-xl overflow-y-auto shrink-0">
        <div className="p-5 border-b border-slate-100">
          <h2 className="font-bold text-slate-800 flex items-center mb-4">
            <Icons.Map className="w-5 h-5 mr-2 text-brand-600" />
            Map Inspector
          </h2>

          <form onSubmit={handleLocationSearch} className="mb-5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Search Location</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Enter city, village, or address"
                className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <button
                type="submit"
                disabled={isSearching}
                className="px-3 py-2 text-xs rounded-md bg-slate-900 text-white disabled:opacity-60"
              >
                {isSearching ? 'Finding...' : 'Search'}
              </button>
            </div>
            {searchError && <p className="mt-2 text-[11px] text-rose-600">{searchError}</p>}
            <p className="mt-2 text-[11px] text-slate-500">Selected: {activeLocation.name}</p>
          </form>

          <div className="mb-5 p-3 rounded-lg border border-brand-100 bg-brand-50/50">
            <p className="text-xs font-semibold text-brand-700 mb-1">Area Selection (2 clicks)</p>
            <p className="text-[11px] text-slate-600 mb-2">{selectionStatus}</p>
            <p className="text-[11px] text-slate-600">Point A: {formatCoord(selectionStart)}</p>
            <p className="text-[11px] text-slate-600">Point B: {formatCoord(selectionEnd)}</p>
            {selectedBounds && (
              <p className="text-[11px] text-slate-600 mt-1">
                Diagonal NW-SE: {formatCoord(selectedBounds.northWest)} to {formatCoord(selectedBounds.southEast)}
              </p>
            )}
            <button
              type="button"
              onClick={resetSelectionState}
              className="mt-3 w-full py-2 text-xs rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100 transition-all"
            >
              Clear Selection
            </button>
          </div>

          <div className="mb-6">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Base Map</p>
            <div className="flex bg-slate-100 p-1 rounded-lg">
              {MAP_LAYERS.map((layer) => (
                <button
                  key={layer.id}
                  onClick={() => setActiveBaseLayer(layer.id)}
                  className={`flex-1 py-1 px-3 text-xs font-medium rounded-md transition-all ${
                    activeBaseLayer === layer.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {layer.name.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>

          {ndviSource && (
            <div className="mb-6 p-3 rounded-lg border border-sky-100 bg-sky-50/70">
              <p className="text-xs font-semibold text-sky-800">NDVI Source</p>
              <p className="text-[11px] text-slate-700 mt-1">{ndviSource.provider}</p>
              <p className="text-[11px] text-slate-600 mt-1">Scene: {ndviSource.sceneId}</p>
              <p className="text-[11px] text-slate-600">Date: {formatDate(ndviSource.acquiredAt)}</p>
              <p className="text-[11px] text-slate-600">Cloud Cover: {ndviSource.cloudCover.toFixed(1)}%</p>
              <p className="text-[11px] text-slate-600">Bands: Red={ndviSource.redAsset}, NIR={ndviSource.nirAsset}</p>
            </div>
          )}

          {ndviError && (
            <div className="mb-6 p-3 rounded-lg border border-rose-100 bg-rose-50/70">
              <p className="text-xs font-semibold text-rose-800">NDVI Error</p>
              <p className="text-[11px] text-rose-700 mt-1 break-words">{ndviError}</p>
            </div>
          )}

          {landClassification && (
            <div className="mb-6 p-3 rounded-lg border border-emerald-100 bg-emerald-50/60">
              <p className="text-xs font-semibold text-emerald-800">Land Type</p>
              <p className="text-sm font-semibold text-slate-800 mt-1">{landClassification.label}</p>
              <p className="text-[11px] text-slate-600 mt-1">{landClassification.reason}</p>
              {landClassification.confidence > 0 && (
                <p className="text-[11px] text-slate-500 mt-1">Confidence: {landClassification.confidence}%</p>
              )}
            </div>
          )}

          {computedStats && (
            <div className="mb-6 animate-fade-in">
              <div className="flex justify-between items-center mb-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">True NDVI Distribution</p>
                <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded text-slate-600">B08/B04</span>
              </div>
              <div className="h-32 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={computedStats.histogram}>
                    <Tooltip
                      cursor={{ fill: 'transparent' }}
                      contentStyle={{ fontSize: '12px', borderRadius: '4px', border: 'none', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}
                    />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      {computedStats.histogram.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={STAT_COLORS[index % 5]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2 text-[11px] text-slate-600">
                <span>Mean: {computedStats.mean.toFixed(3)}</span>
                <span>StdDev: {computedStats.stdDev.toFixed(3)}</span>
              </div>
            </div>
          )}

          <button
            onClick={handleAnalyze}
            disabled={isProcessing || !computedStats}
            className="w-full py-3 bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white rounded-xl shadow-lg font-semibold flex items-center justify-center transition-all disabled:opacity-70 disabled:grayscale"
          >
            {isProcessing ? (
              <><Icons.Spinner className="w-5 h-5 mr-2 animate-spin" /> Processing NDVI...</>
            ) : (
              <><Icons.AI className="w-5 h-5 mr-2" /> AI Verification</>
            )}
          </button>
        </div>

        {result && (
          <div className="p-5 bg-slate-50 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-800">Verification Report</h3>
              <div className="px-2 py-1 bg-emerald-100 text-emerald-800 text-xs font-bold rounded uppercase">Verified</div>
            </div>

            <div className="mb-4 text-sm text-slate-600 bg-white p-3 rounded-lg border border-slate-200 shadow-sm leading-relaxed">
              {result.summary}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-white p-3 rounded border border-slate-200">
                <div className="text-xs text-slate-500">Land Use</div>
                <div className="font-semibold text-slate-800">{result.landUse}</div>
              </div>
              <div className="bg-white p-3 rounded border border-slate-200">
                <div className="text-xs text-slate-500">Score</div>
                <div className="font-semibold text-brand-600">{result.suitabilityScore}/100</div>
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500 mb-2">Identified Risks</div>
              <div className="flex flex-wrap gap-2">
                {result.risks.map((risk, idx) => (
                  <span key={idx} className="text-xs px-2 py-1 bg-amber-50 text-amber-700 border border-amber-100 rounded flex items-center">
                    <Icons.Alert className="w-3 h-3 mr-1" /> {risk}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 relative bg-slate-900 overflow-hidden">
        <div id="map-container" ref={mapContainerRef} className="w-full h-full" />
        <div className="absolute bottom-6 left-6 z-[400] bg-white/90 backdrop-blur p-3 rounded-lg shadow-xl border border-white/20">
          <div className="text-xs font-bold text-slate-700 mb-2">Active Region</div>
          <div className="flex items-center gap-2">
            <Icons.Map className="w-4 h-4 text-brand-600" />
            <span className="text-xs text-slate-600">
              {selectedBounds ? 'Selected Area' : activeLocation.name}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {activeCoords[0].toFixed(2)}, {activeCoords[1].toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
