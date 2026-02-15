import React, { useEffect, useRef, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

import { Icons } from './Icons';
import { analyzeLandData } from '../services/geminiService';
import { fetchAgricultureInsights } from '../services/agriInsightsService.js';
import { fetchCurrentNdvi, fetchNdviTimeline, searchLocation } from '../services/ndviService.js';

if (!L.Icon.Default.prototype._rootMapExplorerIconFix) {
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
  });
  L.Icon.Default.prototype._rootMapExplorerIconFix = true;
}

const DEFAULT_LOCATION = {
  name: 'Default Location',
  coords: [22.8706, 88.3770],
};

const MAP_LAYERS = [
  {
    id: 'OSM',
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  {
    id: 'SAT',
    name: 'Satellite (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution:
      'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
  },
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const formatCoord = (coords) => {
  if (!coords || !Array.isArray(coords) || coords.length < 2) return 'NA';
  return `${Number(coords[0]).toFixed(5)}, ${Number(coords[1]).toFixed(5)}`;
};

const formatDate = (isoValue) => {
  if (!isoValue) return 'NA';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return isoValue;
  return date.toLocaleDateString();
};

const parseLatLngQuery = (value) => {
  const match = String(value || '').trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
};

const toBoundsPayload = (bounds) => {
  const nw = bounds.getNorthWest();
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const se = bounds.getSouthEast();
  const center = bounds.getCenter();

  return {
    northWest: [Number(nw.lat.toFixed(6)), Number(nw.lng.toFixed(6))],
    northEast: [Number(ne.lat.toFixed(6)), Number(ne.lng.toFixed(6))],
    southWest: [Number(sw.lat.toFixed(6)), Number(sw.lng.toFixed(6))],
    southEast: [Number(se.lat.toFixed(6)), Number(se.lng.toFixed(6))],
    center: [Number(center.lat.toFixed(6)), Number(center.lng.toFixed(6))],
  };
};

const classifyLandByNdvi = (stats) => {
  if (!stats?.histogram?.length) return null;

  const total = stats.histogram.reduce((acc, entry) => acc + Number(entry.count || 0), 0) || 1;
  const high = stats.histogram
    .filter((entry) => Number(entry.bin) >= 0.45)
    .reduce((acc, entry) => acc + Number(entry.count || 0), 0);
  const moderate = stats.histogram
    .filter((entry) => Number(entry.bin) >= 0.2 && Number(entry.bin) < 0.45)
    .reduce((acc, entry) => acc + Number(entry.count || 0), 0);
  const negative = stats.histogram
    .filter((entry) => Number(entry.bin) < 0)
    .reduce((acc, entry) => acc + Number(entry.count || 0), 0);

  const highPct = (high / total) * 100;
  const moderatePct = (moderate / total) * 100;
  const negativePct = (negative / total) * 100;

  if (stats.mean >= 0.45 && highPct >= 30) {
    return {
      label: 'Forest / Dense Vegetation',
      confidence: Math.min(95, Math.round(60 + highPct * 0.7)),
      reason: 'High NDVI and strong dense-green share indicate forest or dense vegetation.',
    };
  }

  if (stats.mean >= 0.25 && highPct + moderatePct >= 45) {
    return {
      label: 'Agriculture / Cropland',
      confidence: Math.min(92, Math.round(55 + (highPct + moderatePct) * 0.5)),
      reason: 'Moderate-to-high NDVI values indicate active crop cover.',
    };
  }

  if (stats.mean >= 0.1) {
    return {
      label: 'Grassland / Shrubland',
      confidence: 74,
      reason: 'Medium NDVI suggests sparse-to-moderate vegetation.',
    };
  }

  if (stats.mean < 0 && negativePct > 55) {
    return {
      label: 'Water / Wet Surface',
      confidence: 80,
      reason: 'Negative NDVI dominance indicates water or saturated surface.',
    };
  }

  return {
    label: 'Barren / Built-up',
    confidence: 72,
    reason: 'Low NDVI response suggests bare soil, dry land, or built-up surface.',
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

const toTimelineChartData = (timeline = []) =>
  timeline.map((item) => ({
    year: String(item.year || ''),
    mean: item.status === 'OK' ? Number(item.mean) : null,
    status: item.status,
  }));

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
  const [agriInsights, setAgriInsights] = useState(null);
  const [agriError, setAgriError] = useState('');
  const [analysisImageBase64, setAnalysisImageBase64] = useState('');
  const [timeline, setTimeline] = useState([]);
  const [timelineError, setTimelineError] = useState('');

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
    setAgriInsights(null);
    setAgriError('');
    setAnalysisImageBase64('');
    setTimeline([]);
    setTimelineError('');
    clearSelectionRectangle();
  };

  const processSelectionNdvi = async (selectionBounds) => {
    setIsProcessing(true);
    setComputedStats(null);
    setLandClassification(null);
    setNdviSource(null);
    setNdviError('');
    setAgriInsights(null);
    setAgriError('');
    setAnalysisImageBase64('');
    setTimeline([]);
    setTimelineError('');

    try {
      const currentPayload = await fetchCurrentNdvi({ selectionBounds, daysBack: 180 });
      const stats = currentPayload?.stats || null;
      if (!stats) {
        throw new Error('No NDVI stats returned.');
      }

      setComputedStats(stats);
      setLandClassification(classifyLandByNdvi(stats));
      setNdviSource(currentPayload?.source || null);
      setAnalysisImageBase64(createAnalysisPlaceholderImage(Number(stats.mean || 0)));

      try {
        const timelinePayload = await fetchNdviTimeline({ selectionBounds, years: 5 });
        setTimeline(Array.isArray(timelinePayload?.timeline) ? timelinePayload.timeline : []);
      } catch (timelineLoadError) {
        setTimeline([]);
        setTimelineError(
          timelineLoadError instanceof Error
            ? timelineLoadError.message
            : 'Could not load NDVI timeline.'
        );
      }

      try {
        const insights = await fetchAgricultureInsights({
          coords: selectionBounds.center,
          ndviStats: stats,
        });
        setAgriInsights(insights);
        setAgriError('');
      } catch (insightError) {
        setAgriInsights(null);
        setAgriError(
          insightError instanceof Error
            ? insightError.message
            : 'Failed to generate agricultural insights.'
        );
      }
    } catch (error) {
      setComputedStats(null);
      setLandClassification({
        label: 'Unavailable',
        confidence: 0,
        reason: 'True NDVI could not be computed for this area right now.',
      });
      setNdviSource(null);
      setTimeline([]);
      setNdviError(error instanceof Error ? error.message : 'Unknown NDVI error');
      setAgriInsights(null);
      setAgriError('');
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
      setAgriInsights(null);
      setAgriError('');
      setAnalysisImageBase64('');
      setTimeline([]);
      setTimelineError('');
      clearSelectionRectangle();
      return;
    }

    const start = selectionStartRef.current;
    const end = clickedPoint;

    updateSelectionEnd(end);
    const bounds = L.latLngBounds(L.latLng(start[0], start[1]), L.latLng(end[0], end[1]));

    const payload = toBoundsPayload(bounds);
    setSelectedBounds(payload);
    clearSelectionRectangle();
    if (mapInstanceRef.current) {
      selectionRectRef.current = L.rectangle(bounds, {
        color: '#22c55e',
        weight: 2,
        fillColor: '#22c55e',
        fillOpacity: 0.14,
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
      const directCoords = parseLatLngQuery(query);
      if (directCoords) {
        setActiveLocation({ name: 'Custom Coordinates', coords: directCoords });
        resetSelectionState();
        if (mapInstanceRef.current) {
          mapInstanceRef.current.flyTo(directCoords, 13, { duration: 1.2 });
        }
        return;
      }

      const payload = await searchLocation(query);
      if (!Array.isArray(payload?.items) || !payload.items.length) {
        setSearchError('No matching location found.');
        return;
      }

      const match = payload.items[0];
      const coords = [Number(match.coords[0]), Number(match.coords[1])];
      const label = (match.name || query).split(',').slice(0, 2).join(',').trim();

      setActiveLocation({ name: label || query, coords });
      resetSelectionState();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.flyTo(coords, 13, { duration: 1.2 });
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Search failed. Try another location.');
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current).setView(activeLocation.coords, 13);
    const layerConfig = MAP_LAYERS.find((layer) => layer.id === activeBaseLayer) || MAP_LAYERS[1];
    tileLayerRef.current = L.tileLayer(layerConfig.url, {
      attribution: layerConfig.attribution,
      maxZoom: 19,
    }).addTo(map);

    mapInstanceRef.current = map;
    setTimeout(() => map.invalidateSize(), 120);

    map.on('click', handleMapClick);

    return () => {
      map.off('click', handleMapClick);
      map.remove();
      mapInstanceRef.current = null;
      tileLayerRef.current = null;
      selectionRectRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!tileLayerRef.current) return;
    const layerConfig = MAP_LAYERS.find((layer) => layer.id === activeBaseLayer);
    if (!layerConfig) return;
    tileLayerRef.current.setUrl(layerConfig.url);
    tileLayerRef.current.options.attribution = layerConfig.attribution;
  }, [activeBaseLayer]);

  const handleAnalyze = async () => {
    if (!computedStats) return;
    setIsProcessing(true);

    const statsToUse = {
      NDVI: computedStats,
      AGRI_WEATHER: agriInsights?.weather || null,
      NDVI_TIMELINE: timeline || [],
    };

    const sourceText = ndviSource
      ? `Source: ${ndviSource.provider}, scene ${ndviSource.sceneId}, acquired ${formatDate(ndviSource.acquiredAt)}, cloud cover ${Number(ndviSource.cloudCover || 0).toFixed(1)}%.`
      : 'Source: NDVI dataset metadata unavailable.';

    const agriText = agriInsights
      ? `Agriculture summary: ${agriInsights.summary}. Top crop: ${agriInsights.recommendedCrops?.[0]?.name || 'NA'}. Irrigation: ${agriInsights.irrigation}.`
      : '';

    const timelineText = Array.isArray(timeline) && timeline.length
      ? `Historical NDVI timeline includes ${timeline.filter((item) => item.status === 'OK').length} valid yearly observations.`
      : '';

    const locationPrompt = selectedBounds
      ? `Analyze land for selected parcel with corners NW ${formatCoord(selectedBounds.northWest)} and SE ${formatCoord(selectedBounds.southEast)}. ${sourceText} ${agriText} ${timelineText}`
      : `Analyze land parcel located at ${activeLocation.coords.join(', ')}. ${sourceText} ${agriText} ${timelineText}`;

    try {
      const base64 = analysisImageBase64 || createAnalysisPlaceholderImage(Number(computedStats.mean || 0));
      const analysis = await analyzeLandData(base64, locationPrompt, statsToUse);
      setResult(analysis);
    } catch (_error) {
      // Keep UX non-blocking for this optional AI step.
    } finally {
      setIsProcessing(false);
    }
  };

  const activeCoords = selectedBounds?.center || activeLocation.coords;
  const selectionStatus = selectionStart && !selectionEnd
    ? 'Corner A selected. Click opposite corner to complete diagonal.'
    : selectedBounds
      ? 'Area selected. Current NDVI and historical timeline computed.'
      : 'Click map to select first corner of area.';

  const timelineChartData = toTimelineChartData(timeline);

  return (
    <div className="h-full min-h-[620px] flex flex-col md:flex-row bg-slate-50/60 overflow-hidden">
      <div className="w-full md:w-80 flex flex-col bg-white border-r border-slate-200 z-20 shadow-xl overflow-y-auto shrink-0">
        <div className="p-5 border-b border-slate-100">
          <h2 className="font-bold text-slate-800 flex items-center mb-4">
            <Icons.Map className="w-5 h-5 mr-2 text-brand-600" />
            Geo-Explorer
          </h2>

          <form onSubmit={handleLocationSearch} className="mb-5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Search Location</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Enter city, village, or coordinates"
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
            <p className="text-xs font-semibold text-brand-700 mb-1">Area Selection</p>
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

          <div className="mb-5">
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
            <div className="mb-5 p-3 rounded-lg border border-sky-100 bg-sky-50/70">
              <p className="text-xs font-semibold text-sky-800">NDVI Source</p>
              <p className="text-[11px] text-slate-700 mt-1">{ndviSource.provider}</p>
              <p className="text-[11px] text-slate-600 mt-1">Scene: {ndviSource.sceneId}</p>
              <p className="text-[11px] text-slate-600">Date: {formatDate(ndviSource.acquiredAt)}</p>
              <p className="text-[11px] text-slate-600">Cloud Cover: {Number(ndviSource.cloudCover || 0).toFixed(1)}%</p>
            </div>
          )}

          {ndviError && (
            <div className="mb-5 p-3 rounded-lg border border-rose-100 bg-rose-50/70">
              <p className="text-xs font-semibold text-rose-800">NDVI Error</p>
              <p className="text-[11px] text-rose-700 mt-1 break-words">{ndviError}</p>
            </div>
          )}

          {landClassification && (
            <div className="mb-5 p-3 rounded-lg border border-emerald-100 bg-emerald-50/60">
              <p className="text-xs font-semibold text-emerald-800">Land Type</p>
              <p className="text-sm font-semibold text-slate-800 mt-1">{landClassification.label}</p>
              <p className="text-[11px] text-slate-600 mt-1">{landClassification.reason}</p>
              {landClassification.confidence > 0 && (
                <p className="text-[11px] text-slate-500 mt-1">Confidence: {landClassification.confidence}%</p>
              )}
            </div>
          )}

          {computedStats && (
            <div className="mb-5 rounded-lg border border-slate-200 bg-white/80 p-3 text-xs text-slate-600">
              <p>Mean NDVI: <span className="font-semibold text-slate-800">{Number(computedStats.mean || 0).toFixed(3)}</span></p>
              <p className="mt-1">Min / Max: {Number(computedStats.min || 0).toFixed(3)} / {Number(computedStats.max || 0).toFixed(3)}</p>
              <p className="mt-1">Std Dev: {Number(computedStats.stdDev || 0).toFixed(3)}</p>
            </div>
          )}

          {selectedBounds && (
            <div className="mb-6 animate-fade-in">
              <div className="flex justify-between items-center mb-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Historical NDVI Timeline</p>
                <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded text-slate-600">Yearly</span>
              </div>
              {timelineChartData.length ? (
                <div className="h-36 w-full rounded-lg border border-slate-200 bg-white/80 p-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={timelineChartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.28)" />
                      <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                      <YAxis domain={[-1, 1]} tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value, _name, item) => {
                          if (value === null || value === undefined) {
                            return ['Unavailable', `Status: ${item?.payload?.status || 'UNKNOWN'}`];
                          }
                          return [Number(value).toFixed(3), 'Mean NDVI'];
                        }}
                        labelFormatter={(label) => `Year ${label}`}
                      />
                      <Line
                        type="monotone"
                        dataKey="mean"
                        stroke="#0f7db6"
                        strokeWidth={2.5}
                        dot={{ r: 3, strokeWidth: 2 }}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                  Timeline will appear after NDVI loads for selected region.
                </p>
              )}
              {timelineError && <p className="mt-2 text-[11px] text-amber-700">{timelineError}</p>}
            </div>
          )}

          {agriInsights && (
            <div className="mb-5 p-3 rounded-lg border border-lime-100 bg-lime-50/60">
              <p className="text-xs font-semibold text-lime-800">Agricultural Insights</p>
              <p className="text-[11px] text-slate-700 mt-1">{agriInsights.summary}</p>
              <p className="text-[11px] text-slate-700 mt-2">
                Weather (7d): Rain {agriInsights.weather?.rainfall7d ?? 'NA'} mm, Max Temp {agriInsights.weather?.maxTempAvg ?? 'NA'} C
              </p>
              <p className="text-[11px] text-slate-700 mt-1">Irrigation: {agriInsights.irrigation}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(agriInsights.recommendedCrops || []).map((crop) => (
                  <span
                    key={crop.name}
                    className="inline-flex items-center rounded-full border border-lime-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-lime-800"
                  >
                    {crop.name} ({crop.suitability}%)
                  </span>
                ))}
              </div>
            </div>
          )}

          {agriError && (
            <div className="mb-5 p-3 rounded-lg border border-amber-100 bg-amber-50/70">
              <p className="text-xs font-semibold text-amber-800">Agricultural Insights Error</p>
              <p className="text-[11px] text-amber-700 mt-1 break-words">{agriError}</p>
            </div>
          )}

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
            <span className="text-xs text-slate-600">{selectedBounds ? 'Selected Area' : activeLocation.name}</span>
            <span className="text-[10px] text-slate-400 font-mono">
              {activeCoords[0].toFixed(2)}, {activeCoords[1].toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
