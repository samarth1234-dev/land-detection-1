import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

import { Icons } from './Icons.jsx';
import {
  createLandBoundary,
  fetchLandBoundaries,
  fetchLandClaims,
  fetchLandSummary,
  fetchOwnedParcels,
  removeLandBoundary,
  updateLandBoundary,
} from '../services/landClaimService.js';

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

const parsePolygonText = (value) => {
  try {
    const parsed = JSON.parse(String(value || '').trim());
    if (!Array.isArray(parsed) || parsed.length < 3) return null;
    const polygon = parsed
      .map((point) => {
        if (!Array.isArray(point) || point.length < 2) return null;
        const lat = Number(point[0]);
        const lng = Number(point[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
      })
      .filter(Boolean);
    return polygon.length >= 3 ? polygon : null;
  } catch (_error) {
    return null;
  }
};

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
  const [claims, setClaims] = useState([]);
  const [boundaries, setBoundaries] = useState([]);
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [boundaryForm, setBoundaryForm] = useState({
    code: '',
    name: '',
    location: 'Chandannagar, Kolkata, West Bengal',
    polygonText: '',
  });
  const [isSavingBoundary, setIsSavingBoundary] = useState(false);

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
          const [parcelPayload, claimPayload, summaryPayload, boundaryPayload] = await Promise.all([
            fetchOwnedParcels('global'),
            fetchLandClaims({ scope: 'global', status: 'PENDING,FLAGGED' }),
            fetchLandSummary(),
            fetchLandBoundaries({ includeRemoved: true }),
          ]);
          if (!active) return;
          setParcels(Array.isArray(parcelPayload.items) ? parcelPayload.items : []);
          setClaims(Array.isArray(claimPayload.items) ? claimPayload.items : []);
          setBoundaries(Array.isArray(boundaryPayload.items) ? boundaryPayload.items : []);
          setSummary(summaryPayload || null);
        } else {
          const parcelPayload = await fetchOwnedParcels('mine');
          if (!active) return;
          setParcels(Array.isArray(parcelPayload.items) ? parcelPayload.items : []);
          setClaims([]);
          setBoundaries([]);
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

    const overlays = [];
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
      overlays.push(polygon);
    }

    for (const boundary of boundaries) {
      if (!Array.isArray(boundary.polygon) || boundary.polygon.length < 3) continue;
      const color = boundary.status === 'REMOVED' ? '#94a3b8' : '#f97316';
      const polygon = L.polygon(boundary.polygon, {
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: boundary.status === 'REMOVED' ? 0.05 : 0.1,
        dashArray: '6,6',
      })
        .bindPopup(
          `<strong>Boundary:</strong> ${boundary.name}<br/><strong>Code:</strong> ${boundary.code}<br/><strong>Status:</strong> ${boundary.status}<br/><strong>Area:</strong> ${formatSqM(boundary.areaSqM)}`
        )
        .addTo(parcelsLayerRef.current);
      overlays.push(polygon);
    }

    if (overlays.length) {
      const group = L.featureGroup(overlays);
      mapRef.current.fitBounds(group.getBounds(), { padding: [20, 20] });
    }
  }, [isEmployee, parcels, boundaries]);

  const reloadEmployeeData = async () => {
    const [parcelPayload, claimPayload, summaryPayload, boundaryPayload] = await Promise.all([
      fetchOwnedParcels('global'),
      fetchLandClaims({ scope: 'global', status: 'PENDING,FLAGGED' }),
      fetchLandSummary(),
      fetchLandBoundaries({ includeRemoved: true }),
    ]);
    setParcels(Array.isArray(parcelPayload.items) ? parcelPayload.items : []);
    setClaims(Array.isArray(claimPayload.items) ? claimPayload.items : []);
    setSummary(summaryPayload || null);
    setBoundaries(Array.isArray(boundaryPayload.items) ? boundaryPayload.items : []);
  };

  const handleCreateBoundary = async (event) => {
    event.preventDefault();
    setError('');
    setActionMessage('');

    const polygon = parsePolygonText(boundaryForm.polygonText);
    if (!polygon) {
      setError('Boundary polygon must be a JSON array of [lat,lng] points with at least 3 vertices.');
      return;
    }
    if (!boundaryForm.name.trim() || !boundaryForm.location.trim()) {
      setError('Boundary name and location are required.');
      return;
    }

    setIsSavingBoundary(true);
    try {
      await createLandBoundary({
        code: boundaryForm.code.trim(),
        name: boundaryForm.name.trim(),
        location: boundaryForm.location.trim(),
        polygon,
      });
      await reloadEmployeeData();
      setActionMessage('Boundary dataset entry created successfully.');
      setBoundaryForm({
        code: '',
        name: '',
        location: 'Chandannagar, Kolkata, West Bengal',
        polygonText: '',
      });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create boundary.');
    } finally {
      setIsSavingBoundary(false);
    }
  };

  const handleBoundaryEdit = async (boundary) => {
    const nextName = window.prompt('Boundary name', boundary.name || '') || '';
    if (!nextName.trim()) return;
    const nextLocation = window.prompt('Boundary location', boundary.location || '') || '';
    if (!nextLocation.trim()) return;
    const nextPolygonText = window.prompt(
      'Boundary polygon JSON [[lat,lng], ...]',
      JSON.stringify(boundary.polygon || [])
    );
    if (!nextPolygonText) return;

    const polygon = parsePolygonText(nextPolygonText);
    if (!polygon) {
      setError('Invalid polygon JSON. Edit cancelled.');
      return;
    }

    try {
      await updateLandBoundary({
        boundaryId: boundary.id,
        code: boundary.code,
        name: nextName.trim(),
        location: nextLocation.trim(),
        polygon,
        status: boundary.status,
      });
      await reloadEmployeeData();
      setActionMessage(`Boundary ${boundary.code} updated.`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Failed to update boundary.');
    }
  };

  const handleBoundaryToggle = async (boundary) => {
    try {
      if (boundary.status === 'REMOVED') {
        await updateLandBoundary({
          boundaryId: boundary.id,
          code: boundary.code,
          name: boundary.name,
          location: boundary.location,
          polygon: boundary.polygon,
          status: 'ACTIVE',
        });
        setActionMessage(`Boundary ${boundary.code} restored.`);
      } else {
        await removeLandBoundary({ boundaryId: boundary.id });
        setActionMessage(`Boundary ${boundary.code} removed.`);
      }
      await reloadEmployeeData();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Failed to update boundary status.');
    }
  };

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
      {actionMessage && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {actionMessage}
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

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <article className="panel-surface rounded-xl p-4">
              <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Registered parcels</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary?.parcels?.total ?? parcels.length}</p>
            </article>
            <article className="panel-surface rounded-xl p-4">
              <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Total allocated area</p>
              <p className="mt-2 text-lg font-bold text-slate-900">{formatSqM(summary?.parcels?.totalAreaSqM || 0)}</p>
            </article>
            <article className="panel-surface rounded-xl p-4">
              <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Active boundaries</p>
              <p className="mt-2 text-2xl font-bold text-orange-700">{summary?.boundaries?.active ?? boundaries.filter((item) => item.status === 'ACTIVE').length}</p>
            </article>
            <article className="panel-surface rounded-xl p-4">
              <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Boundary area</p>
              <p className="mt-2 text-lg font-bold text-slate-900">{formatSqM(summary?.boundaries?.totalActiveAreaSqM || 0)}</p>
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
            <p className="mt-1 text-xs text-slate-500">Solid polygons = assigned parcels. Dashed orange polygons = government boundary dataset.</p>
            <div ref={mapContainerRef} className="mt-3 h-[520px] w-full overflow-hidden rounded-lg border border-slate-200" />
          </section>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="panel-surface rounded-2xl">
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
            </div>

            <div className="panel-surface rounded-2xl">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="font-display text-lg font-bold text-slate-900">Claim Alerts</h3>
              </div>
              <div className="space-y-2 p-5">
                {claims.length ? (
                  claims.map((claim) => (
                    <div key={claim.id} className="rounded-lg border border-slate-200 bg-white/85 px-3 py-2.5 text-sm">
                      <p className="font-semibold text-slate-900">
                        {claim.pid} <span className="text-xs font-medium text-slate-500">({claim.status})</span>
                      </p>
                      <p className="mt-1 text-xs text-slate-600">Claimant: {claim.claimant?.name || 'Unknown'}</p>
                      <p className="text-xs text-slate-600">Area: {formatSqM(claim.areaSqM)}</p>
                      {claim.overlapFlags?.length ? (
                        <p className="mt-1 text-xs text-amber-700">Overlap flags: {claim.overlapFlags.length}</p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="py-4 text-sm text-slate-500">No pending or flagged claims.</p>
                )}
              </div>
            </div>
          </section>

          <section className="panel-surface rounded-2xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="font-display text-lg font-bold text-slate-900">Boundary Dataset Management</h3>
              <p className="mt-1 text-xs text-slate-500">
                Chandannagar preset boundaries are loaded by default. Only government employees can create, edit, remove, or restore boundary records.
              </p>
            </div>
            <div className="space-y-4 p-5">
              <form onSubmit={handleCreateBoundary} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white/80 p-4 xl:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Code (optional)</label>
                  <input
                    value={boundaryForm.code}
                    onChange={(event) => setBoundaryForm((prev) => ({ ...prev, code: event.target.value }))}
                    placeholder="Example: CHN-WB-PB-004"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Boundary name</label>
                  <input
                    value={boundaryForm.name}
                    onChange={(event) => setBoundaryForm((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="Boundary name"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                </div>
                <div className="xl:col-span-2">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Location</label>
                  <input
                    value={boundaryForm.location}
                    onChange={(event) => setBoundaryForm((prev) => ({ ...prev, location: event.target.value }))}
                    placeholder="Chandannagar, Kolkata, West Bengal"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                </div>
                <div className="xl:col-span-2">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Polygon JSON</label>
                  <textarea
                    rows={3}
                    value={boundaryForm.polygonText}
                    onChange={(event) => setBoundaryForm((prev) => ({ ...prev, polygonText: event.target.value }))}
                    placeholder='[[22.86852,88.36371],[22.86842,88.36606],[22.86639,88.36598]]'
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">Use [lat,lng] coordinate pairs. At least 3 points required.</p>
                </div>
                <div className="xl:col-span-2">
                  <button
                    type="submit"
                    disabled={isSavingBoundary}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                  >
                    {isSavingBoundary ? <Icons.Spinner className="h-4 w-4 animate-spin" /> : <Icons.Upload className="h-4 w-4" />}
                    {isSavingBoundary ? 'Saving...' : 'Add Boundary'}
                  </button>
                </div>
              </form>

              <div className="space-y-2">
                {boundaries.length ? (
                  boundaries.map((boundary) => (
                    <div key={boundary.id} className="rounded-xl border border-slate-200 bg-white/85 px-3 py-2.5 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold text-slate-900">{boundary.name}</p>
                          <p className="text-xs text-slate-500">{boundary.code} • {boundary.location}</p>
                        </div>
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${boundary.status === 'ACTIVE' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-slate-100 text-slate-600'}`}>
                          {boundary.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">
                        Area: {formatSqM(boundary.areaSqM)} | Vertices: {Array.isArray(boundary.polygon) ? boundary.polygon.length : 0}
                        {boundary.isPreset ? ' | Preset' : ''}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void handleBoundaryEdit(boundary);
                          }}
                          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void handleBoundaryToggle(boundary);
                          }}
                          className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${boundary.status === 'REMOVED' ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100'}`}
                        >
                          {boundary.status === 'REMOVED' ? 'Restore' : 'Remove'}
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="py-4 text-sm text-slate-500">No boundary records available.</p>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
};
