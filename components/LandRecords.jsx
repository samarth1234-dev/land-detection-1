import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { Icons } from './Icons.jsx';
import { fetchOwnedParcels } from '../services/landClaimService.js';

if (!L.Icon.Default.prototype._rootLandRecordIconFix) {
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
  });
  L.Icon.Default.prototype._rootLandRecordIconFix = true;
}

const formatDateTime = (value) => {
  if (!value) return 'NA';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'NA' : date.toLocaleString();
};

const formatCoord = (coord) => {
  if (!Array.isArray(coord) || coord.length < 2) return 'NA';
  return `${Number(coord[0]).toFixed(5)}, ${Number(coord[1]).toFixed(5)}`;
};

const shortHash = (hash = '') => {
  if (!hash) return 'NA';
  if (hash.length < 16) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
};

export const LandRecords = ({ role = 'USER' }) => {
  const isEmployee = role === 'EMPLOYEE';
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeParcelId, setActiveParcelId] = useState('');

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const polygonLayerRef = useRef(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      setError('');
      try {
        const payload = await fetchOwnedParcels(isEmployee ? 'global' : 'mine');
        if (!active) return;
        setItems(Array.isArray(payload.items) ? payload.items : []);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load land registry.');
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [isEmployee]);

  useEffect(() => {
    if (!items.length) {
      setActiveParcelId('');
      return;
    }
    if (!activeParcelId || !items.some((item) => item.id === activeParcelId)) {
      setActiveParcelId(items[0].id);
    }
  }, [items, activeParcelId]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current).setView([22.9734, 78.6569], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    polygonLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.remove();
      mapRef.current = null;
      polygonLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !polygonLayerRef.current) return;
    polygonLayerRef.current.clearLayers();

    const overlays = [];
    let activeLayer = null;
    items.forEach((item) => {
      if (!Array.isArray(item.polygon) || item.polygon.length < 3) return;
      const isActive = item.id === activeParcelId;
      const layer = L.polygon(item.polygon, {
        color: isActive ? '#0f7db6' : '#64748b',
        weight: isActive ? 3 : 1.8,
        fillColor: isActive ? '#0f7db6' : '#94a3b8',
        fillOpacity: isActive ? 0.28 : 0.14,
      })
        .bindPopup(
          `<strong>PID:</strong> ${item.pid}<br/><strong>Area:</strong> ${Number(item.areaSqM || 0).toFixed(2)} sq.m`
        )
        .addTo(polygonLayerRef.current);
      overlays.push(layer);
      if (isActive) activeLayer = layer;
    });

    if (activeLayer) {
      mapRef.current.fitBounds(activeLayer.getBounds(), { padding: [24, 24], maxZoom: 16 });
      activeLayer.openPopup();
      return;
    }
    if (overlays.length) {
      mapRef.current.fitBounds(L.featureGroup(overlays).getBounds(), { padding: [24, 24] });
    }
  }, [items, activeParcelId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const text = [
        item.pid,
        item.owner?.name,
        item.owner?.email,
        item.status,
        item.ledgerBlock?.hash,
        formatCoord(item.centroid),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return text.includes(q);
    });
  }, [items, query]);

  const activeParcel = useMemo(
    () => items.find((item) => item.id === activeParcelId) || null,
    [items, activeParcelId]
  );

  return (
    <div className="space-y-6 p-6">
      <section className="panel-surface rounded-2xl p-6 shadow-[0_14px_32px_rgba(15,23,42,0.08)]">
        <p className="inline-flex items-center gap-2 rounded-full border border-earth-200 bg-earth-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-earth-700">
          <Icons.Database className="h-3.5 w-3.5" />
          Registry
        </p>
        <h2 className="mt-3 font-display text-2xl font-bold text-slate-900">
          {isEmployee ? 'National Land Registry Ledger' : 'My Approved Land Registry'}
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          PID-linked ownership entries with polygon centroid and blockchain assignment hash.
        </p>
      </section>

      {error && (
        <section className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </section>
      )}

      <section className="panel-surface rounded-2xl p-5">
        <h3 className="font-display text-lg font-bold text-slate-900">Registry Polygon Viewer</h3>
        <p className="mt-1 text-xs text-slate-500">Click any registry row to focus its polygon on the map.</p>
        <div ref={mapContainerRef} className="mt-3 h-[360px] w-full overflow-hidden rounded-lg border border-slate-200" />
        {activeParcel && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-white/85 px-3 py-2 text-xs text-slate-600">
            <p className="font-semibold text-slate-800">Active PID: {activeParcel.pid}</p>
            <p className="mt-1">Centroid: {formatCoord(activeParcel.centroid)}</p>
            <p className="mt-1">Area: {Number(activeParcel.areaSqM || 0).toFixed(2)} sq.m</p>
          </div>
        )}
      </section>

      <section className="panel-surface rounded-2xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-slate-600">
              Total parcels: <span className="font-semibold text-slate-900">{items.length}</span>
            </p>
            <div className="relative md:w-80">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search PID, owner, status"
                className="w-full rounded-lg border border-slate-300 py-2 pl-10 pr-3 text-sm text-slate-700 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
              <Icons.Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-slate-100/80 text-xs uppercase tracking-[0.06em] text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">PID</th>
                {isEmployee && <th className="px-5 py-3 font-semibold">Owner</th>}
                <th className="px-5 py-3 font-semibold">Centroid</th>
                <th className="px-5 py-3 font-semibold">Area (sq.m)</th>
                <th className="px-5 py-3 font-semibold">Vertices</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Assigned At</th>
                <th className="px-5 py-3 font-semibold">Ledger Block</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={isEmployee ? 8 : 7} className="px-5 py-10 text-center text-slate-500">
                    Loading registry...
                  </td>
                </tr>
              ) : filtered.length ? (
                filtered.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => setActiveParcelId(item.id)}
                    className={`cursor-pointer border-t border-slate-100 transition ${
                      activeParcelId === item.id ? 'bg-blue-50/70' : 'bg-white/85 hover:bg-white'
                    }`}
                  >
                    <td className="px-5 py-4 font-semibold text-slate-900">{item.pid}</td>
                    {isEmployee && (
                      <td className="px-5 py-4 text-slate-700">
                        {item.owner?.name || 'Unknown'}
                        {item.owner?.email ? <span className="block text-xs text-slate-500">{item.owner.email}</span> : null}
                      </td>
                    )}
                    <td className="px-5 py-4 font-mono text-xs text-slate-700">{formatCoord(item.centroid)}</td>
                    <td className="px-5 py-4 text-slate-700">{Number(item.areaSqM || 0).toFixed(2)}</td>
                    <td className="px-5 py-4 text-slate-700">{Array.isArray(item.polygon) ? item.polygon.length : 0}</td>
                    <td className="px-5 py-4 text-slate-700">{item.status || 'ACTIVE'}</td>
                    <td className="px-5 py-4 text-slate-600">{formatDateTime(item.createdAt)}</td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-500" title={item.ledgerBlock?.hash || ''}>
                      {shortHash(item.ledgerBlock?.hash)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={isEmployee ? 8 : 7} className="px-5 py-10 text-center text-slate-500">
                    No parcel records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
