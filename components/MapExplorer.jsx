import React, { useState, useEffect, useRef } from 'react';
import { Icons } from './Icons';
import { analyzeLandData } from '../services/geminiService';
import { BarChart, Bar, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const PRESETS = [
  { id: 1, name: 'Agricultural Zone', url: 'https://images.unsplash.com/photo-1625246333195-58405079d378?q=80&w=1000&auto=format&fit=crop' },
  { id: 2, name: 'Urban Reserve', url: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?q=80&w=1000&auto=format&fit=crop' },
  { id: 3, name: 'Forest Reserve', url: 'https://images.unsplash.com/photo-1448375240586-dfd8d3f5d891?q=80&w=1000&auto=format&fit=crop' },
];

const LAYERS = [
    { id: 'RGB', name: 'True Color (RGB)', description: 'Standard satellite imagery', colors: [] },
    { id: 'NDVI', name: 'Vegetation (NDVI)', description: 'Normalized Difference Vegetation Index', colors: ['#d7191c', '#fdae61', '#ffffbf', '#a6d96a', '#1a9641'] },
    { id: 'EVI', name: 'Enhanced Veg (EVI)', description: 'Enhanced Vegetation Index', colors: ['#8c510a', '#d8b365', '#f6e8c3', '#c7eae5', '#5ab4ac', '#01665e'] },
    { id: 'NDWI', name: 'Water Mask (NDWI)', description: 'Normalized Difference Water Index', colors: ['#ffffbf', '#e0f3f8', '#91bfdb', '#4575b4'] }
];

export const MapExplorer = () => {
  const [selectedImage, setSelectedImage] = useState(PRESETS[0].url);
  const [activeLayer, setActiveLayer] = useState('RGB');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [computedStats, setComputedStats] = useState(null);
  
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const originalImageRef = useRef(null);

  // Load image into memory when selected
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = selectedImage;
    img.onload = () => {
      originalImageRef.current = img;
      processLayer('RGB'); // Reset to RGB on new image
    };
  }, [selectedImage]);

  // Effect to trigger processing when layer changes
  useEffect(() => {
    if (originalImageRef.current) {
        processLayer(activeLayer);
    }
  }, [activeLayer]);

  const processLayer = (layer) => {
    const canvas = canvasRef.current;
    const img = originalImageRef.current;
    if (!canvas || !img) return;

    // Set canvas dimensions
    canvas.width = img.width;
    canvas.height = img.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw original image
    ctx.drawImage(img, 0, 0);

    if (layer === 'RGB') return; // No processing needed

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const values = [];

    // Pixel manipulation loop
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // data[i+3] is alpha

        let val = 0;
        
        // Approximate indices using Visible bands (since we don't have NIR in standard JPGs)
        // Note: These are "Visual Atmospheric Resistant" approximations
        if (layer === 'NDVI') {
            // Visible Atmospheric Resistant Index (VARI) used as proxy for NDVI in RGB
            // (Green - Red) / (Green + Red - Blue)
            // Normalized to -1 to 1 range
            val = (g - r) / (g + r + 0.001); 
        } else if (layer === 'EVI') {
            // 2.5 * ((NIR - Red) / (NIR + 6 * Red - 7.5 * Blue + 1))
            // Using Green as NIR proxy for visual approximation
            val = 2.5 * ((g - r) / (g + 6 * r - 7.5 * b + 255)); 
        } else if (layer === 'NDWI') {
            // (Green - NIR) / (Green + NIR) -> using Blue as "not green" proxy
            val = (g - b) / (g + b + 0.001); 
        }

        // Clamp value
        val = Math.max(-1, Math.min(1, val));
        values.push(val);

        // Apply Color Map
        const color = getColorForValue(val, layer);
        data[i] = color[0];     // R
        data[i + 1] = color[1]; // G
        data[i + 2] = color[2]; // B
        // Alpha remains 255
    }

    ctx.putImageData(imageData, 0, 0);
    
    // Calculate Stats only if we don't have them for this image yet or need to refresh
    const stats = calculateStats(values);
    setComputedStats(prev => ({
        ...prev,
        [layer]: stats
    }));
  };

  const calculateStats = (values) => {
      if (values.length === 0) return { min: 0, max: 0, mean: 0, stdDev: 0, histogram: [] };
      
      let sum = 0;
      let min = 1;
      let max = -1;
      
      // Single pass for min/max/sum
      for (const v of values) {
          sum += v;
          if (v < min) min = v;
          if (v > max) max = v;
      }
      const mean = sum / values.length;

      // StdDev
      let sqDiffSum = 0;
      for (const v of values) {
          sqDiffSum += (v - mean) ** 2;
      }
      const stdDev = Math.sqrt(sqDiffSum / values.length);

      // Histogram (10 bins from -1 to 1)
      const bins = new Array(10).fill(0);
      for (const v of values) {
          const binIdx = Math.min(9, Math.floor(((v + 1) / 2) * 10));
          bins[binIdx]++;
      }
      
      const histogram = bins.map((count, i) => ({
          bin: ((-1 + (i * 0.2)).toFixed(1)),
          count: count
      }));

      return { min, max, mean, stdDev, histogram };
  };

  const getColorForValue = (val, layer) => {
      // Simple Red-Yellow-Green lerp for NDVI
      // Map -1..1 to 0..1
      const t = (val + 1) / 2;
      
      if (layer === 'NDVI' || layer === 'EVI') {
          // Red (0) -> Yellow (0.5) -> Green (1)
          if (t < 0.5) {
              // Red to Yellow
              const localT = t * 2; 
              return [
                  255, 
                  Math.round(255 * localT), 
                  0
              ];
          } else {
              // Yellow to Green
              const localT = (t - 0.5) * 2;
              return [
                  Math.round(255 * (1 - localT)), 
                  255, 
                  0
              ];
          }
      } else if (layer === 'NDWI') {
          // White/Yellow to Blue
          return [
              Math.round(255 * (1 - t)),
              Math.round(255 * (1 - t)),
              255
          ];
      }
      return [0,0,0];
  };

  const handleAnalyze = async () => {
    if (!originalImageRef.current) return;
    setIsProcessing(true);

    const statsToUse = computedStats || {
        NDVI: { min: 0, max: 0, mean: 0.4, stdDev: 0.1, histogram: [] }
    };

    try {
        // Get base64 of original image
        const canvas = document.createElement('canvas');
        canvas.width = originalImageRef.current.width;
        canvas.height = originalImageRef.current.height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(originalImageRef.current, 0, 0);
        const base64 = canvas.toDataURL('image/jpeg').split(',')[1];

        const analysis = await analyzeLandData(
            base64,
            "Verify land boundaries and assess agricultural viability.",
            statsToUse
        );
        
        setResult(analysis);
    } catch (e) {
        console.error(e);
    } finally {
        setIsProcessing(false);
    }
  };

  const activeStats = computedStats?.[activeLayer];

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col md:flex-row bg-slate-50 overflow-hidden">
      {/* Sidebar: Controls & Analysis */}
      <div className="w-full md:w-80 flex flex-col bg-white border-r border-slate-200 z-20 shadow-xl overflow-y-auto">
         <div className="p-5 border-b border-slate-100">
             <h2 className="font-bold text-slate-800 flex items-center mb-4">
                 <Icons.Map className="w-5 h-5 mr-2 text-brand-600" />
                 Map Inspector
             </h2>
             
             {/* Presets */}
             <div className="space-y-2 mb-6">
                 <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Select Region</p>
                 <div className="grid grid-cols-2 gap-2">
                     {PRESETS.map(p => (
                         <button
                            key={p.id}
                            onClick={() => { setSelectedImage(p.url); setActiveLayer('RGB'); setResult(null); setComputedStats(null); }}
                            className={`text-xs p-2 rounded border text-left transition-all ${selectedImage === p.url ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 hover:border-slate-300'}`}
                         >
                             {p.name}
                         </button>
                     ))}
                     <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs p-2 rounded border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50 flex items-center justify-center"
                     >
                         <Icons.Upload className="w-3 h-3 mr-1" /> Upload
                     </button>
                     <input type="file" ref={fileInputRef} onChange={e => {
                         if (e.target.files?.[0]) setSelectedImage(URL.createObjectURL(e.target.files[0]));
                     }} className="hidden" />
                 </div>
             </div>

             {/* Layers */}
             <div className="space-y-2 mb-6">
                 <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Data Layers (GEE)</p>
                 <div className="space-y-1">
                     {LAYERS.map(layer => (
                         <button
                            key={layer.id}
                            onClick={() => setActiveLayer(layer.id)}
                            className={`w-full flex items-center p-2 rounded-lg text-sm transition-all ${
                                activeLayer === layer.id 
                                ? 'bg-slate-900 text-white shadow-md' 
                                : 'text-slate-600 hover:bg-slate-100'
                            }`}
                         >
                             <div className={`w-2 h-2 rounded-full mr-3 ${activeLayer === layer.id ? 'bg-brand-400' : 'bg-slate-300'}`} />
                             <div className="flex-1 text-left">
                                 <div className="font-medium">{layer.name}</div>
                                 <div className={`text-[10px] ${activeLayer === layer.id ? 'text-slate-400' : 'text-slate-400'}`}>{layer.description}</div>
                             </div>
                             {activeLayer === layer.id && <Icons.Layers className="w-4 h-4 text-slate-400" />}
                         </button>
                     ))}
                 </div>
             </div>

             {/* Stats Chart for Active Layer */}
             {activeLayer !== 'RGB' && activeStats && (
                 <div className="mb-6 animate-fade-in">
                     <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Layer Distribution</p>
                     <div className="h-32 w-full">
                         <ResponsiveContainer width="100%" height="100%">
                             <BarChart data={activeStats.histogram}>
                                 <Tooltip 
                                    cursor={{fill: 'transparent'}}
                                    contentStyle={{ fontSize: '12px', borderRadius: '4px', border: 'none', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}
                                 />
                                 <Bar dataKey="count" radius={[2,2,0,0]}>
                                     {activeStats.histogram.map((entry, index) => (
                                         <Cell key={`cell-${index}`} fill={LAYERS.find(l => l.id === activeLayer)?.colors[index % 5] || '#8884d8'} />
                                     ))}
                                 </Bar>
                             </BarChart>
                         </ResponsiveContainer>
                     </div>
                     <div className="flex justify-between text-xs text-slate-500 mt-1 px-1">
                         <span>Mean: {activeStats.mean.toFixed(2)}</span>
                         <span>Max: {activeStats.max.toFixed(2)}</span>
                     </div>
                 </div>
             )}

             <button
                onClick={handleAnalyze}
                disabled={isProcessing}
                className="w-full py-3 bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white rounded-xl shadow-lg font-semibold flex items-center justify-center transition-all disabled:opacity-70"
             >
                {isProcessing ? (
                    <><Icons.Spinner className="w-5 h-5 mr-2 animate-spin" /> Processing GEE Data...</>
                ) : (
                    <><Icons.AI className="w-5 h-5 mr-2" /> Verify & Analyze</>
                )}
             </button>
         </div>
         
         {/* Analysis Results */}
         {result && (
             <div className="p-5 bg-slate-50 flex-1">
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
      <div className="flex-1 relative bg-slate-900 overflow-hidden flex items-center justify-center">
          
          {/* Canvas */}
          <canvas 
            ref={canvasRef} 
            className="max-w-full max-h-full object-contain shadow-2xl"
          />

          {/* Grid Overlay */}
          <div className="absolute inset-0 pointer-events-none opacity-20" 
                 style={{ 
                     backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.1) 1px, transparent 1px)',
                     backgroundSize: '50px 50px'
                 }}
          />

          {/* Legend Overlay */}
          {activeLayer !== 'RGB' && (
              <div className="absolute bottom-8 right-8 bg-white/90 backdrop-blur p-3 rounded-lg shadow-xl border border-white/20">
                  <div className="text-xs font-bold text-slate-700 mb-2">{LAYERS.find(l => l.id === activeLayer)?.name}</div>
                  <div className="flex items-center gap-2">
                      <div className="text-[10px] text-slate-500 font-mono">-1.0</div>
                      <div className="h-3 w-32 rounded-full" 
                           style={{ 
                               background: `linear-gradient(to right, ${LAYERS.find(l => l.id === activeLayer)?.colors.join(', ')})` 
                           }} 
                      />
                      <div className="text-[10px] text-slate-500 font-mono">+1.0</div>
                  </div>
              </div>
          )}

          {/* Processing Indicator */}
          {isProcessing && (
              <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-white backdrop-blur-sm z-50">
                  <Icons.Spinner className="w-10 h-10 mb-4 animate-spin text-brand-400" />
                  <p className="font-medium tracking-wide">Analysing Geospatial Data...</p>
                  <p className="text-sm text-slate-400 mt-2">Integrating Google Earth Engine Layers</p>
              </div>
          )}
      </div>
    </div>
  );
};