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

// Coordinates for presets
const PRESETS = [
  { 
    id: 1, 
    name: 'Agricultural Zone', 
    url: 'https://images.unsplash.com/photo-1625246333195-58405079d378?q=80&w=1000&auto=format&fit=crop',
    coords: [36.7378, -119.7871], // Central Valley, CA
    bounds: [[36.72, -119.80], [36.75, -119.77]]
  },
  { 
    id: 2, 
    name: 'Urban Reserve', 
    url: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?q=80&w=1000&auto=format&fit=crop',
    coords: [34.0522, -118.2437], // Los Angeles, CA
    // Bounds removed to prevent overlay image from blocking map view
  },
  { 
    id: 3, 
    name: 'Forest Reserve', 
    url: 'https://images.unsplash.com/photo-1448375240586-dfd8d3f5d891?q=80&w=1000&auto=format&fit=crop',
    coords: [44.0521, -121.3153], // Bend, OR
    bounds: [[44.04, -121.33], [44.06, -121.30]]
  },
];

const MAP_LAYERS = [
  { id: 'OSM', name: 'OpenStreetMap', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap contributors' },
  { id: 'SAT', name: 'Satellite (Esri)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community' }
];

// Stats layer simulation configuration (just for color mapping in charts, not map visual)
const STAT_LAYERS = [
    { id: 'RGB', name: 'Standard', colors: ['#8884d8', '#83a6ed', '#8dd1e1', '#82ca9d', '#a4de6c'] },
    { id: 'NDVI', name: 'Vegetation Index', colors: ['#d7191c', '#fdae61', '#ffffbf', '#a6d96a', '#1a9641'] },
];

export const MapExplorer = () => {
  const [selectedPreset, setSelectedPreset] = useState(PRESETS[0]);
  const [activeBaseLayer, setActiveBaseLayer] = useState('SAT');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [computedStats, setComputedStats] = useState(null);
  const [lastClickCoords, setLastClickCoords] = useState(null);
  
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const overlayRef = useRef(null);
  const fileInputRef = useRef(null);
  const processedImageRef = useRef(null); // Keeps track of the image for analysis (hidden canvas)

  const getTileUrlForLatLng = (latlng) => {
      const map = mapInstanceRef.current;
      const tileLayer = tileLayerRef.current;
      if (!map || !tileLayer) return null;
      const zoom = map.getZoom();
      const tileSize = tileLayer.getTileSize();
      const point = map.project(latlng, zoom);
      const x = Math.floor(point.x / tileSize.x);
      const y = Math.floor(point.y / tileSize.y);
      return tileLayer.getTileUrl({ x, y, z: zoom });
  };

  const handleMapClick = (event) => {
      if (!event?.latlng) return;
      const { lat, lng } = event.latlng;
      setLastClickCoords([lat, lng]);
      setResult(null);

      const tileUrl = getTileUrlForLatLng(event.latlng);
      if (tileUrl) {
          processImageStats(tileUrl);
      }
  };

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current).setView(selectedPreset.coords, 13);
    
    // Add default layer
    const layerConfig = MAP_LAYERS.find(l => l.id === activeBaseLayer) || MAP_LAYERS[1];
    tileLayerRef.current = L.tileLayer(layerConfig.url, {
      attribution: layerConfig.attribution,
      maxZoom: 19
    }).addTo(map);

    mapInstanceRef.current = map;

    // Force a resize calculation after mount to ensure tiles load correctly
    setTimeout(() => {
        map.invalidateSize();
    }, 100);

    // Initial preset load
    loadPreset(PRESETS[0], map);
    map.on('click', handleMapClick);

    return () => {
      map.off('click', handleMapClick);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Handle Base Layer Change
  useEffect(() => {
      if (!mapInstanceRef.current || !tileLayerRef.current) return;
      
      const layerConfig = MAP_LAYERS.find(l => l.id === activeBaseLayer);
      if (layerConfig) {
          tileLayerRef.current.setUrl(layerConfig.url);
      }
  }, [activeBaseLayer]);

  const loadPreset = (preset, map = mapInstanceRef.current) => {
      if (!map) return;
      
      setSelectedPreset(preset);
      setResult(null);
      setComputedStats(null);

      // Fly to location
      map.flyTo(preset.coords, 14, { duration: 1.5 });

      // Remove existing overlay
      if (overlayRef.current) {
          overlayRef.current.remove();
          overlayRef.current = null;
      }

      // Add new overlay if bounds exist
      if (preset.bounds) {
           overlayRef.current = L.imageOverlay(preset.url, preset.bounds, {
               opacity: 0.9,
               interactive: true
           }).addTo(map);
      }

      // Process image stats in background if URL exists (even if not shown on map)
      if (preset.url) {
          processImageStats(preset.url);
      }
  };

  const handleFileUpload = (e) => {
      if (e.target.files?.[0]) {
          const file = e.target.files[0];
          const url = URL.createObjectURL(file);
          const newPreset = {
              id: 999,
              name: 'Uploaded Parcel',
              url: url,
              coords: [34.05, -118.25], // Default to LA if no geo
              bounds: [[34.04, -118.26], [34.06, -118.22]]
          };
          // Try to get user location for better UX?
          // For now just load it
          loadPreset(newPreset);
      }
  };

  // Hidden image processing for stats (similar to previous canvas logic)
  const processImageStats = (imageUrl) => {
      if (!imageUrl) return;
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.src = imageUrl;
      img.onload = () => {
          processedImageRef.current = img;
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          try {
              ctx.drawImage(img, 0, 0);
              
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const data = imageData.data;
              
              // Calculate NDVI-like stats from RGB
              const values = [];
              for (let i = 0; i < data.length; i += 4) {
                 const r = data[i];
                 const g = data[i + 1];
                 // Simple synthetic NDVI: (G-R)/(G+R)
                 const val = (g - r) / (g + r + 0.001); 
                 values.push(Math.max(-1, Math.min(1, val)));
              }
              
              const stats = calculateStats(values);
              setComputedStats(stats);
          } catch (error) {
              console.warn('NDVI calculation failed (tile CORS or canvas issue).', error);
              setComputedStats(null);
          }
      };
      img.onerror = () => {
          console.warn('Failed to load imagery tile for NDVI calculation.');
          setComputedStats(null);
      };
  };

  const calculateStats = (values) => {
      if (values.length === 0) return { min: 0, max: 0, mean: 0, stdDev: 0, histogram: [] };
      let sum = 0;
      for (const v of values) sum += v;
      const mean = sum / values.length;
      
      const bins = new Array(10).fill(0);
      for (const v of values) {
          const binIdx = Math.min(9, Math.floor(((v + 1) / 2) * 10));
          bins[binIdx]++;
      }
      
      const histogram = bins.map((count, i) => ({
          bin: ((-1 + (i * 0.2)).toFixed(1)),
          count: count
      }));
      
      return { mean, histogram, max: 1, min: -1 }; // simplified
  };

  const handleAnalyze = async () => {
    if (!processedImageRef.current) return;
    setIsProcessing(true);

    const statsToUse = { NDVI: computedStats || { min: 0, max: 0, mean: 0.4, stdDev: 0.1, histogram: [] } };
    const coordsForPrompt = lastClickCoords || selectedPreset.coords;

    try {
        const canvas = document.createElement('canvas');
        canvas.width = processedImageRef.current.width;
        canvas.height = processedImageRef.current.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(processedImageRef.current, 0, 0);
        const base64 = canvas.toDataURL('image/jpeg').split(',')[1];

        const analysis = await analyzeLandData(
            base64,
            `Analyze the land parcel located at ${coordsForPrompt.join(', ')}.`,
            statsToUse
        );
        
        setResult(analysis);
    } catch (e) {
        console.error(e);
    } finally {
        setIsProcessing(false);
    }
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col md:flex-row bg-slate-50 overflow-hidden">
      {/* Sidebar: Controls & Analysis */}
      <div className="w-full md:w-80 flex flex-col bg-white border-r border-slate-200 z-20 shadow-xl overflow-y-auto shrink-0">
         <div className="p-5 border-b border-slate-100">
             <h2 className="font-bold text-slate-800 flex items-center mb-4">
                 <Icons.Map className="w-5 h-5 mr-2 text-brand-600" />
                 Map Inspector
             </h2>
             <p className="text-xs text-slate-500 mb-4">
                 Tip: click on the map to auto-calculate NDVI for that spot.
             </p>
             
             {/* Base Layers */}
             <div className="mb-6">
                 <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Base Map</p>
                 <div className="flex bg-slate-100 p-1 rounded-lg">
                     {MAP_LAYERS.map(layer => (
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

             {/* Presets */}
             <div className="space-y-2 mb-6">
                 <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Jump to Region</p>
                 <div className="grid grid-cols-2 gap-2">
                     {PRESETS.map(p => (
                         <button
                            key={p.id}
                            onClick={() => loadPreset(p)}
                            className={`text-xs p-2 rounded border text-left transition-all ${selectedPreset.id === p.id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 hover:border-slate-300'}`}
                         >
                             {p.name}
                         </button>
                     ))}
                     <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs p-2 rounded border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50 flex items-center justify-center"
                     >
                         <Icons.Upload className="w-3 h-3 mr-1" /> Overlay
                     </button>
                     <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                 </div>
             </div>

             {/* Stats Chart */}
             {computedStats && (
                 <div className="mb-6 animate-fade-in">
                     <div className="flex justify-between items-center mb-2">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Vegetation Distribution</p>
                        <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded text-slate-600">Simulated NDVI</span>
                     </div>
                     <div className="h-32 w-full">
                         <ResponsiveContainer width="100%" height="100%">
                             <BarChart data={computedStats.histogram}>
                                 <Tooltip 
                                    cursor={{fill: 'transparent'}}
                                    contentStyle={{ fontSize: '12px', borderRadius: '4px', border: 'none', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}
                                 />
                                 <Bar dataKey="count" radius={[2,2,0,0]}>
                                     {computedStats.histogram.map((entry, index) => (
                                         <Cell key={`cell-${index}`} fill={STAT_LAYERS[1].colors[index % 5]} />
                                     ))}
                                 </Bar>
                             </BarChart>
                         </ResponsiveContainer>
                     </div>
                 </div>
             )}

             <button
                onClick={handleAnalyze}
                disabled={isProcessing || !computedStats}
                className="w-full py-3 bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white rounded-xl shadow-lg font-semibold flex items-center justify-center transition-all disabled:opacity-70 disabled:grayscale"
             >
                {isProcessing ? (
                    <><Icons.Spinner className="w-5 h-5 mr-2 animate-spin" /> Analyzing Region...</>
                ) : (
                    <><Icons.AI className="w-5 h-5 mr-2" /> AI Verification</>
                )}
             </button>
         </div>
         
         {/* Analysis Results */}
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
                         {result.risks.map((r,i) => (
                             <span key={i} className="text-xs px-2 py-1 bg-amber-50 text-amber-700 border border-amber-100 rounded flex items-center">
                                 <Icons.Alert className="w-3 h-3 mr-1" /> {r}
                             </span>
                         ))}
                     </div>
                 </div>
             </div>
         )}
      </div>

      {/* Main Map Canvas Area */}
      <div className="flex-1 relative bg-slate-900 overflow-hidden">
          <div id="map-container" ref={mapContainerRef} className="w-full h-full" />

          {/* Map Overlay Controls/Legend */}
          <div className="absolute bottom-6 left-6 z-[400] bg-white/90 backdrop-blur p-3 rounded-lg shadow-xl border border-white/20">
              <div className="text-xs font-bold text-slate-700 mb-2">Active Region</div>
              <div className="flex items-center gap-2">
                   <Icons.Map className="w-4 h-4 text-brand-600" />
                   <span className="text-xs text-slate-600">{lastClickCoords ? 'Custom Location' : selectedPreset.name}</span>
                   <span className="text-[10px] text-slate-400 font-mono">
                       {(lastClickCoords?.[0] ?? selectedPreset.coords[0]).toFixed(2)}, {(lastClickCoords?.[1] ?? selectedPreset.coords[1]).toFixed(2)}
                   </span>
              </div>
          </div>
      </div>
    </div>
  );
};
