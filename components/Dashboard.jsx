import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

import { Icons } from './Icons.jsx';
import { fetchLandClaims, fetchLandSummary, fetchOwnedParcels } from '../services/landClaimService.js';

if (!L.Icon.Default.prototype._rootDashboardMapIconFix) {
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
  });
  L.Icon.Default.prototype._rootDashboardMapIconFix = true;
}

const DEFAULT_MAP_CENTER = [22.9734, 78.6569];

const formatCoord = (coord) => {
  if (!Array.isArray(coord) || coord.length < 2) return 'NA';
  return `${Number(coord[0]).toFixed(5)}, ${Number(coord[1]).toFixed(5)}`;
};

const formatSqM = (value) => `${Number(value || 0).toFixed(2)} sq.m`;

const colorFromId = (id) => {
  const value = String(id || 'seed');
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 72%, 45%)`;
};

export const Dashboard = ({ role = 'USER' }) => {
  const isEmployee = role === 'EMPLOYEE';
  const [parcels, setParcels] = useState([]);
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const parcelsLayerRef = useRef(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      setError('');
      try {
        if (isEmployee) {
          const [parcelPayload, claimPayload, summaryPayload] = await Promise.all([
            fetchOwnedParcels('global'),
            fetchLandClaims({ scope: 'global', status: 'PENDING,FLAGGED' }),
            fetchLandSummary(),
          ]);
          if (!active) return;
          setParcels(Array.isArray(parcelPayload.items) ? parcelPayload.items : []);
          setClaims(Array.isArray(claimPayload.items) ? claimPayload.items : []);
          setSummary(summaryPayload || null);
        } else {
          const parcelPayload = await fetchOwnedParcels('mine');
          if (!active) return;
          setParcels(Array.isArray(parcelPayload.items) ? parcelPayload.items : []);
          setSummary(null);
        }
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load dashboard.');
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
    if (!isEmployee || !mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current).setView(DEFAULT_MAP_CENTER, 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    parcelsLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.remove();
      mapRef.current = null;
      parcelsLayerRef.current = null;
    };
  }, [isEmployee]);

  useEffect(() => {
    if (!isEmployee || !mapRef.current || !parcelsLayerRef.current) return;
    parcelsLayerRef.current.clearLayers();

    const polygons = [];
    for (const parcel of parcels) {
      if (!Array.isArray(parcel.polygon) || parcel.polygon.length < 3) continue;
      const color = colorFromId(parcel.owner?.id || parcel.id);
      const polygon = L.polygon(parcel.polygon, {
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.25,
      })
        .bindPopup(
          `<strong>PID:</strong> ${parcel.pid}<br/><strong>Owner:</strong> ${parcel.owner?.name || 'Unknown'}<br/><strong>Area:</strong> ${formatSqM(parcel.areaSqM)}`
        )
        .addTo(parcelsLayerRef.current);
      polygons.push(polygon);
    }

    if (polygons.length) {
      const group = L.featureGroup(polygons);
      mapRef.current.fitBounds(group.getBounds(), { padding: [20, 20] });
    }
  }, [isEmployee, parcels]);

  if (isLoading) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="panel-surface rounded-2xl px-6 py-5 text-center">
          <Icons.Spinner className="mx-auto h-6 w-6 animate-spin text-brand-600" />
          <p className="mt-3 text-sm text-slate-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {error && (
        <section className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </section>
      )}

      {!isEmployee ? (
        <>
          <section className="panel-surface rounded-2xl p-6 shadow-[0_14px_32px_rgba(15,23,42,0.08)]">
            <h2 className="font-display text-2xl font-bold text-slate-900">My Registered Land</h2>
            <p className="mt-2 text-sm text-slate-600">Your approved parcels, PID, coordinates, and owned area.</p>
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <article className="panel-surface rounded-xl p-4">
              <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Owned parcels</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{parcels.length}</p>
            </article>
            <article className="panel-surface rounded-xl p-4">
              <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Total owned area</p>
              <p className="mt-2 text-lg font-bold text-slate-900">{formatSqM(parcels.reduce((sum, item) => sum + Number(item.areaSqM || 0), 0))}</p>
            </article>
            <article className="panel-surface rounded-xl p-4">
              <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Last update</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">
                {parcels[0]?.updatedAt ? new Date(parcels[0].updatedAt).toLocaleString() : 'NA'}
              </p>
            </article>
          </section>

          <section className="panel-surface rounded-2xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="font-display text-lg font-bold text-slate-900">Parcel Ownership List</h3>
            </div>
            <div className="space-y-3 p-5">
              {parcels.length ? (
                parcels.map((parcel) => (
                  <article key={parcel.id} className="rounded-xl border border-slate-200 bg-white/90 p-4">
                    <p className="text-sm font-semibold text-slate-900">PID: {parcel.pid}</p>
                    <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-600 sm:grid-cols-2">
                      <p>Centroid: {formatCoord(parcel.centroid)}</p>
                      <p>Area: {formatSqM(parcel.areaSqM)}</p>
                      <p>Vertices: {Array.isArray(parcel.polygon) ? parcel.polygon.length : 0}</p>
                      <p>Status: {parcel.status}</p>
                    </div>
                  </article>
                ))
              ) : (
                <p className="py-6 text-center text-sm text-slate-500">
                  No land assigned yet. Submit a claim query from the Land Claims page.
                </p>
              )}
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="panel-surface rounded-2xl p-6 shadow-[0_14px_32px_rgba(15,23,42,0.08)]">
            <h2 className="font-display text-2xl font-bold text-slate-900">Government Land Governance Dashboard</h2>
            <p className="mt-2 text-sm text-slate-600">
              Complete map of registered property boundaries, ownership, and PID-based claim queue.
            </p>
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <article className="panel-surface rounded-xl p-4">
              <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Registered parcels</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary?.parcels?.total ?? parcels.length}</p>
            </article>
            <article className="panel-surface rounded-xl p-4">
              <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Total allocated area</p>
              <p className="mt-2 text-lg font-bold text-slate-900">{formatSqM(summary?.parcels?.totalAreaSqM || 0)}</p>
            </article>
            <article className="panel-surface rounded-xl p-4">
              <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Pending claims</p>
              <p className="mt-2 text-2xl font-bold text-sky-700">{summary?.claims?.pending ?? 0}</p>
            </article>
            <article className="panel-surface rounded-xl p-4">
              <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Flagged overlaps</p>
              <p className="mt-2 text-2xl font-bold text-amber-700">{summary?.claims?.flagged ?? 0}</p>
            </article>
          </section>

          <section className="panel-surface rounded-2xl p-5">
            <h3 className="font-display text-lg font-bold text-slate-900">National Parcel Boundary Map</h3>
            <p className="mt-1 text-xs text-slate-500">Each polygon shows PID, owner, and assigned area.</p>
            <div ref={mapContainerRef} className="mt-3 h-[520px] w-full overflow-hidden rounded-lg border border-slate-200" />
          </section>

          <section className="panel-surface rounded-2xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="font-display text-lg font-bold text-slate-900">Ownership Allocation</h3>
            </div>
            <div className="space-y-2 p-5">
              {(summary?.ownership || []).length ? (
                summary.ownership.map((item) => (
                  <div key={item.owner.id} className="rounded-lg border border-slate-200 bg-white/85 px-3 py-2.5 text-sm">
                    <p className="font-semibold text-slate-900">{item.owner.name}</p>
                    <p className="text-xs text-slate-500">{item.owner.email || 'no-email'}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      Parcels: {item.parcelCount} | Area: {formatSqM(item.areaSqM)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="py-4 text-sm text-slate-500">No approved parcel ownership data yet.</p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
};
