import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

import { Icons } from './Icons.jsx';
import { fetchLandClaims, reviewLandClaim, submitLandClaim } from '../services/landClaimService.js';
import { searchLocation } from '../services/ndviService.js';

if (!L.Icon.Default.prototype._rootLandClaimIconFix) {
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
  });
  L.Icon.Default.prototype._rootLandClaimIconFix = true;
}

const DEFAULT_MAP_CENTER = [28.6139, 77.209];

const formatDateTime = (value) => {
  if (!value) return 'NA';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'NA' : date.toLocaleString();
};

const formatCoord = (coord) => {
  if (!Array.isArray(coord) || coord.length < 2) return 'NA';
  return `${Number(coord[0]).toFixed(5)}, ${Number(coord[1]).toFixed(5)}`;
};

const polygonAreaSqM = (polygon) => {
  if (!Array.isArray(polygon) || polygon.length < 3) return 0;
  const lat0 = polygon.reduce((sum, point) => sum + Number(point[0] || 0), 0) / polygon.length;
  const cosLat = Math.cos((lat0 * Math.PI) / 180) || 1e-6;
  const local = polygon.map((point) => ({
    x: Number(point[1]) * 111320 * cosLat,
    y: Number(point[0]) * 110540,
  }));
  let area2 = 0;
  for (let i = 0; i < local.length; i += 1) {
    const a = local[i];
    const b = local[(i + 1) % local.length];
    area2 += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area2) / 2;
};

const toStatusTone = (status) => {
  switch (status) {
    case 'APPROVED':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'REJECTED':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    case 'FLAGGED':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    default:
      return 'border-sky-200 bg-sky-50 text-sky-700';
  }
};

const statusLabel = (status) => {
  if (!status) return 'Unknown';
  return status[0] + status.slice(1).toLowerCase();
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

export const LandClaims = ({ role = 'USER' }) => {
  const isEmployee = role === 'EMPLOYEE';
  const [claims, setClaims] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [reviewingId, setReviewingId] = useState('');

  const [pid, setPid] = useState('');
  const [claimNote, setClaimNote] = useState('');
  const [polygon, setPolygon] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [locationQuery, setLocationQuery] = useState('');
  const [locationError, setLocationError] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const [activeClaimId, setActiveClaimId] = useState('');

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const polygonRef = useRef(null);
  const markersLayerRef = useRef(null);
  const vertexMarkersRef = useRef([]);
  const claimPreviewLayerRef = useRef(null);

  const loadClaims = async () => {
    setIsLoading(true);
    setError('');
    try {
      const payload = await fetchLandClaims({
        scope: isEmployee ? 'global' : 'mine',
        status: statusFilter || undefined,
      });
      setClaims(Array.isArray(payload.items) ? payload.items : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load claims.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadClaims();
  }, [isEmployee, statusFilter]);

  useEffect(() => {
    if (isEmployee || !mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current).setView(DEFAULT_MAP_CENTER, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    claimPreviewLayerRef.current = L.layerGroup().addTo(map);

    const handleClick = (event) => {
      const point = [Number(event.latlng.lat.toFixed(6)), Number(event.latlng.lng.toFixed(6))];
      setPolygon((prev) => [...prev, point]);
      setError('');
      setSuccess('');
    };
    map.on('click', handleClick);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.off('click', handleClick);
      map.remove();
      mapRef.current = null;
      polygonRef.current = null;
      markersLayerRef.current = null;
      claimPreviewLayerRef.current = null;
      vertexMarkersRef.current = [];
    };
  }, [isEmployee]);

  useEffect(() => {
    if (isEmployee || !mapRef.current || !markersLayerRef.current) return;
    vertexMarkersRef.current.forEach((marker) => marker.remove());
    vertexMarkersRef.current = [];
    markersLayerRef.current.clearLayers();
    if (polygonRef.current) {
      polygonRef.current.remove();
      polygonRef.current = null;
    }

    polygon.forEach((point, index) => {
      const marker = L.marker(point, { draggable: true })
        .bindTooltip(`${index + 1}`, { direction: 'top', offset: [0, -8] })
        .addTo(markersLayerRef.current);

      marker.on('dragend', (event) => {
        const latlng = event.target.getLatLng();
        const nextPoint = [Number(latlng.lat.toFixed(6)), Number(latlng.lng.toFixed(6))];
        setPolygon((prev) => prev.map((item, itemIdx) => (itemIdx === index ? nextPoint : item)));
      });

      marker.on('dblclick', () => {
        setPolygon((prev) => prev.filter((_, itemIdx) => itemIdx !== index));
      });

      vertexMarkersRef.current.push(marker);
    });

    if (polygon.length >= 3) {
      polygonRef.current = L.polygon(polygon, {
        color: '#16a34a',
        weight: 2,
        fillColor: '#22c55e',
        fillOpacity: 0.2,
      }).addTo(mapRef.current);
      mapRef.current.fitBounds(polygonRef.current.getBounds(), { padding: [14, 14] });
    }
  }, [polygon, isEmployee]);

  useEffect(() => {
    if (!activeClaimId || claims.some((claim) => claim.id === activeClaimId)) return;
    setActiveClaimId('');
    if (claimPreviewLayerRef.current) {
      claimPreviewLayerRef.current.clearLayers();
    }
  }, [claims, activeClaimId]);

  const areaSqM = useMemo(() => Number(polygonAreaSqM(polygon).toFixed(2)), [polygon]);

  const activeClaim = useMemo(
    () => claims.find((claim) => claim.id === activeClaimId) || null,
    [claims, activeClaimId]
  );

  const focusClaimOnMap = (claim) => {
    if (
      isEmployee
      || !mapRef.current
      || !claimPreviewLayerRef.current
      || !Array.isArray(claim?.polygon)
      || claim.polygon.length < 3
    ) {
      return;
    }

    claimPreviewLayerRef.current.clearLayers();
    const previewLayer = L.polygon(claim.polygon, {
      color: '#0f7db6',
      weight: 3,
      fillColor: '#38bdf8',
      fillOpacity: 0.24,
      dashArray: '6 4',
    })
      .bindPopup(`<strong>PID:</strong> ${claim.pid}<br/><strong>Area:</strong> ${Number(claim.areaSqM || 0).toFixed(2)} sq.m`)
      .addTo(claimPreviewLayerRef.current);

    setActiveClaimId(claim.id);
    mapRef.current.fitBounds(previewLayer.getBounds(), { padding: [18, 18], maxZoom: 16 });
    previewLayer.openPopup();
    mapContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleSearchLocation = async (event) => {
    event?.preventDefault?.();
    setLocationError('');
    const query = String(locationQuery || '').trim();
    if (!query) return;

    const directCoords = parseLatLngQuery(query);
    if (directCoords && mapRef.current) {
      mapRef.current.flyTo(directCoords, 14, { duration: 0.8 });
      return;
    }

    setIsLocating(true);
    try {
      const payload = await searchLocation(query);
      const items = Array.isArray(payload?.items) ? payload.items : [];
      if (!items.length) {
        throw new Error('Location not found.');
      }
      const lat = Number(items[0].coords?.[0]);
      const lng = Number(items[0].coords?.[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error('Location coordinates invalid.');
      }
      if (mapRef.current) {
        mapRef.current.flyTo([lat, lng], 14, { duration: 0.8 });
      }
    } catch (searchError) {
      setLocationError(searchError instanceof Error ? searchError.message : 'Search failed.');
    } finally {
      setIsLocating(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!pid.trim()) {
      setError('PID is required.');
      return;
    }
    if (!claimNote.trim() || claimNote.trim().length < 12) {
      setError('Claim note must be at least 12 characters.');
      return;
    }
    if (polygon.length < 3) {
      setError('Select at least 3 points on map to define polygon.');
      return;
    }

    setIsSubmitting(true);
    try {
      await submitLandClaim({
        pid: pid.trim(),
        claimNote: claimNote.trim(),
        polygon,
      });
      setPid('');
      setClaimNote('');
      setPolygon([]);
      setLocationQuery('');
      setSuccess('Land claim query submitted to government review queue.');
      await loadClaims();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to submit claim.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReview = async (claim, action) => {
    setError('');
    setSuccess('');
    const verifiedPid = action === 'APPROVE'
      ? window.prompt(`Type exact PID to approve claim (${claim.pid}):`, claim.pid || '') || ''
      : '';
    if (action === 'APPROVE' && !verifiedPid) return;
    const reviewNote = window.prompt('Optional review note:', '') || '';

    setReviewingId(claim.id);
    try {
      await reviewLandClaim({
        claimId: claim.id,
        action,
        verifiedPid,
        reviewNote,
      });
      setSuccess(`Claim ${action === 'APPROVE' ? 'approved' : 'rejected'} successfully.`);
      await loadClaims();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Failed to review claim.');
    } finally {
      setReviewingId('');
    }
  };

  return (
    <div className="space-y-6 p-6">
      <section className="panel-surface rounded-2xl p-6 shadow-[0_14px_32px_rgba(15,23,42,0.08)]">
        <p className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-blue-700">
          <Icons.Database className="h-3.5 w-3.5" />
          Land Claim Queue
        </p>
        <h2 className="mt-3 font-display text-2xl font-bold text-slate-900">
          {isEmployee ? 'Government Land Claim Review' : 'Submit Land Claim Query'}
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          {isEmployee
            ? 'Review PID-based claim requests, detect overlaps, and approve land assignment.'
            : 'Submit PID + polygon query. Land is assigned only after government verification.'}
        </p>
      </section>

      {(error || success) && (
        <section className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {error || success}
        </section>
      )}

      {!isEmployee && (
        <section className="panel-surface rounded-2xl p-5">
          <h3 className="font-display text-lg font-bold text-slate-900">New Claim Query</h3>
          <form className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[420px_1fr]" onSubmit={handleSubmit}>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">PID</label>
                <input
                  value={pid}
                  onChange={(event) => setPid(event.target.value)}
                  placeholder="Enter purchase PID"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Claim Note</label>
                <textarea
                  rows={4}
                  value={claimNote}
                  onChange={(event) => setClaimNote(event.target.value)}
                  placeholder="Describe purchase details and supporting context."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>
              <div className="rounded-lg border border-slate-200 bg-white/80 p-3 text-xs text-slate-600">
                <p>Points selected: <span className="font-semibold text-slate-800">{polygon.length}</span></p>
                <p className="mt-1">Estimated area: <span className="font-semibold text-slate-800">{areaSqM.toFixed(2)} sq.m</span></p>
                <p className="mt-1">Click map to add vertices. Drag markers to move points. Double-click marker to remove.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPolygon((prev) => prev.slice(0, -1))}
                  disabled={!polygon.length}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                >
                  Undo Last Point
                </button>
                <button
                  type="button"
                  onClick={() => setPolygon([])}
                  disabled={!polygon.length}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                >
                  Clear Polygon
                </button>
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                {isSubmitting ? <Icons.Spinner className="h-4 w-4 animate-spin" /> : <Icons.Upload className="h-4 w-4" />}
                {isSubmitting ? 'Submitting...' : 'Submit Claim Query'}
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white/70 p-3">
              <div className="mb-2 flex gap-2">
                <input
                  value={locationQuery}
                  onChange={(event) => setLocationQuery(event.target.value)}
                  placeholder="Search location or lat,lng"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
                <button
                  type="button"
                  onClick={handleSearchLocation}
                  disabled={isLocating}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {isLocating ? 'Finding...' : 'Go'}
                </button>
              </div>
              {locationError && <p className="mb-2 text-xs text-rose-600">{locationError}</p>}
              <div ref={mapContainerRef} className="h-[420px] w-full overflow-hidden rounded-lg border border-slate-200" />
              {activeClaim && (
                <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2 text-xs text-blue-800">
                  Highlighted claim PID: <span className="font-semibold">{activeClaim.pid}</span>
                </div>
              )}
            </div>
          </form>
        </section>
      )}

      <section className="panel-surface rounded-2xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h3 className="font-display text-lg font-bold text-slate-900">
              {isEmployee ? 'Claim Review Queue' : 'My Claim Requests'}
            </h3>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="FLAGGED">Flagged</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>
        </div>
        <div className="max-h-[680px] space-y-3 overflow-y-auto p-5">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-slate-500">Loading claims...</p>
          ) : claims.length ? (
            claims.map((claim) => (
              <article key={claim.id} className="rounded-xl border border-slate-200 bg-white/90 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      PID:
                      {' '}
                      {!isEmployee && Array.isArray(claim.polygon) && claim.polygon.length >= 3 ? (
                        <button
                          type="button"
                          onClick={() => focusClaimOnMap(claim)}
                          className="font-semibold text-brand-700 underline decoration-dotted underline-offset-2 hover:text-brand-600"
                          title="Show this claim polygon on map"
                        >
                          {claim.pid}
                        </button>
                      ) : (
                        <span>{claim.pid}</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">Submitted: {formatDateTime(claim.createdAt)}</p>
                  </div>
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${toStatusTone(claim.status)}`}>
                    {statusLabel(claim.status)}
                  </span>
                </div>

                <p className="mt-2 text-sm text-slate-700">{claim.claimNote}</p>
                <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-500 sm:grid-cols-2">
                  <p>Centroid: {formatCoord(claim.centroid)}</p>
                  <p>Area: {Number(claim.areaSqM || 0).toFixed(2)} sq.m</p>
                  <p>Vertices: {Array.isArray(claim.polygon) ? claim.polygon.length : 0}</p>
                  <p>Updated: {formatDateTime(claim.updatedAt)}</p>
                </div>

                {claim.claimant && isEmployee && (
                  <p className="mt-2 text-xs text-slate-500">
                    Claimant: {claim.claimant.name} ({claim.claimant.email || 'no email'})
                  </p>
                )}

                {Array.isArray(claim.overlapFlags) && claim.overlapFlags.length > 0 && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <p className="font-semibold">Flagged overlap detected</p>
                    {claim.overlapFlags.slice(0, 4).map((flag) => (
                      <p key={`${flag.type}-${flag.targetId}`} className="mt-1">
                        {flag.type === 'ACTIVE_PARCEL_OVERLAP'
                          ? 'Overlaps registered parcel'
                          : flag.type === 'GOV_BOUNDARY_OVERLAP'
                            ? 'Overlaps government boundary dataset'
                            : 'Overlaps pending claim'}:
                        {' '}
                        {flag.pid ? `PID ${flag.pid}` : flag.boundaryCode || 'Reference boundary'}
                        {flag.ownerName ? ` (owner: ${flag.ownerName})` : ''}
                        {flag.claimantName ? ` (claimant: ${flag.claimantName})` : ''}
                        {flag.boundaryName ? ` (${flag.boundaryName})` : ''}
                      </p>
                    ))}
                  </div>
                )}

                {claim.reviewNote && (
                  <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">
                    Review note: {claim.reviewNote}
                  </p>
                )}

                {isEmployee && ['PENDING', 'FLAGGED'].includes(claim.status) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={reviewingId === claim.id}
                      onClick={() => {
                        void handleReview(claim, 'APPROVE');
                      }}
                      className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
                    >
                      Approve by PID Match
                    </button>
                    <button
                      type="button"
                      disabled={reviewingId === claim.id}
                      onClick={() => {
                        void handleReview(claim, 'REJECT');
                      }}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </article>
            ))
          ) : (
            <div className="py-8 text-center">
              <p className="font-semibold text-slate-700">No claims found</p>
              <p className="mt-1 text-xs text-slate-500">Submit a new claim query or adjust filters.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
