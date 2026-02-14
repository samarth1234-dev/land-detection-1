import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

import { Icons } from './Icons';
import {
  createDispute,
  fetchDisputes,
  fetchDisputeSummary,
  updateDisputeStatus,
  verifyDisputeLedger,
} from '../services/disputeService.js';

if (!L.Icon.Default.prototype._rootIconFix) {
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
  });
  L.Icon.Default.prototype._rootIconFix = true;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_REVIEW', label: 'In Review' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'REJECTED', label: 'Rejected' },
];

const DISPUTE_TYPE_OPTIONS = [
  { value: 'BOUNDARY', label: 'Boundary mismatch' },
  { value: 'OWNERSHIP', label: 'Ownership claim' },
  { value: 'ENCROACHMENT', label: 'Encroachment' },
  { value: 'LAND_USE_VIOLATION', label: 'Land-use violation' },
  { value: 'DOCUMENT_FRAUD', label: 'Document mismatch/fraud' },
  { value: 'ACCESS_RIGHT', label: 'Access right conflict' },
];

const PRIORITY_OPTIONS = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
];

const defaultForm = {
  parcelRef: '',
  disputeType: 'BOUNDARY',
  priority: 'MEDIUM',
  coordsText: '',
  description: '',
  evidenceText: '',
};

const DEFAULT_MAP_CENTER = [28.6139, 77.209];
const NOMINATIM_URL = '/nominatim/search';

const statusClasses = {
  OPEN: 'border-amber-200 bg-amber-50 text-amber-700',
  IN_REVIEW: 'border-sky-200 bg-sky-50 text-sky-700',
  RESOLVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  REJECTED: 'border-rose-200 bg-rose-50 text-rose-700',
};

const priorityClasses = {
  LOW: 'border-slate-200 bg-slate-50 text-slate-700',
  MEDIUM: 'border-blue-200 bg-blue-50 text-blue-700',
  HIGH: 'border-orange-200 bg-orange-50 text-orange-700',
  CRITICAL: 'border-rose-200 bg-rose-50 text-rose-700',
};

const formatDateTime = (value) => {
  if (!value) return 'NA';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'NA' : date.toLocaleString();
};

const shortHash = (hash = '') => {
  if (!hash) return 'NA';
  if (hash.length < 16) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
};

const statusLabel = (status) => {
  if (status === 'IN_REVIEW') return 'In Review';
  return status ? `${status[0]}${status.slice(1).toLowerCase()}` : 'Unknown';
};

const parseCoords = (coordsText) => {
  const trimmed = String(coordsText || '').trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
};

const formatCoordPair = (coords, precision = 5) => {
  if (!Array.isArray(coords) || coords.length < 2) return 'NA';
  const lat = Number(coords[0]);
  const lng = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'NA';
  return `${lat.toFixed(precision)}, ${lng.toFixed(precision)}`;
};

const toEvidenceArray = (value) =>
  String(value || '')
    .split(/\r?\n|,/g)
    .map((item) => item.trim())
    .filter(Boolean);

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

const boundsSummary = (selectionBounds) => {
  if (!selectionBounds?.northWest || !selectionBounds?.southEast) return 'NA';
  return `NW ${formatCoordPair(selectionBounds.northWest, 4)} | SE ${formatCoordPair(selectionBounds.southEast, 4)}`;
};

export const LandDisputes = () => {
  const [summary, setSummary] = useState({
    total: 0,
    open: 0,
    in_review: 0,
    resolved: 0,
    rejected: 0,
    urgent_open: 0,
  });
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(defaultForm);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState('');
  const [verifyingId, setVerifyingId] = useState('');
  const [ledgerChecks, setLedgerChecks] = useState({});
  const [isLocating, setIsLocating] = useState(false);
  const [locationQuery, setLocationQuery] = useState('');
  const [locationError, setLocationError] = useState('');
  const [selectionStart, setSelectionStart] = useState(null);
  const [selectionEnd, setSelectionEnd] = useState(null);
  const [selectionBounds, setSelectionBounds] = useState(null);

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const selectionRectRef = useRef(null);
  const selectionStartRef = useRef(null);
  const selectionEndRef = useRef(null);

  const clearSelectionOverlay = () => {
    if (selectionRectRef.current) {
      selectionRectRef.current.remove();
      selectionRectRef.current = null;
    }
  };

  const clearSelection = (clearCoords = false) => {
    selectionStartRef.current = null;
    selectionEndRef.current = null;
    setSelectionStart(null);
    setSelectionEnd(null);
    setSelectionBounds(null);
    clearSelectionOverlay();
    if (clearCoords) {
      setForm((prev) => ({ ...prev, coordsText: '' }));
    }
  };

  const flyToCoords = (coords) => {
    if (!mapInstanceRef.current || !Array.isArray(coords)) return;
    mapInstanceRef.current.flyTo(coords, 14, { duration: 0.9 });
  };

  const handleMapClick = (event) => {
    if (!event?.latlng) return;

    const point = [
      Number(event.latlng.lat.toFixed(6)),
      Number(event.latlng.lng.toFixed(6)),
    ];

    setFormError('');
    setFormSuccess('');

    if (!selectionStartRef.current || selectionEndRef.current) {
      clearSelectionOverlay();
      selectionStartRef.current = point;
      selectionEndRef.current = null;
      setSelectionStart(point);
      setSelectionEnd(null);
      setSelectionBounds(null);
      return;
    }

    selectionEndRef.current = point;
    setSelectionEnd(point);

    const bounds = L.latLngBounds(
      L.latLng(selectionStartRef.current[0], selectionStartRef.current[1]),
      L.latLng(point[0], point[1])
    );
    const payload = toBoundsPayload(bounds);
    setSelectionBounds(payload);

    clearSelectionOverlay();
    if (mapInstanceRef.current) {
      selectionRectRef.current = L.rectangle(bounds, {
        color: '#ef4444',
        weight: 2,
        fillColor: '#f97316',
        fillOpacity: 0.15,
      }).addTo(mapInstanceRef.current);
    }

    setForm((prev) => ({
      ...prev,
      coordsText: `${payload.center[0]}, ${payload.center[1]}`,
    }));
  };

  const handleLocationSearch = async (event) => {
    if (event?.preventDefault) event.preventDefault();
    setLocationError('');

    const query = String(locationQuery || '').trim();
    if (!query) return;

    const directCoords = parseCoords(query);
    if (directCoords) {
      flyToCoords(directCoords);
      return;
    }

    setIsLocating(true);
    try {
      const response = await fetch(
        `${NOMINATIM_URL}?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(query)}`
      );
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Search failed (${response.status})`);
      }
      const results = await response.json();
      if (!Array.isArray(results) || !results.length) {
        setLocationError('Location not found.');
        return;
      }

      const match = results[0];
      const lat = Number(match.lat);
      const lng = Number(match.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        setLocationError('Search returned invalid coordinates.');
        return;
      }
      flyToCoords([lat, lng]);
    } catch (searchError) {
      setLocationError(searchError instanceof Error ? searchError.message : 'Search failed.');
    } finally {
      setIsLocating(false);
    }
  };

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current).setView(DEFAULT_MAP_CENTER, 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    map.on('click', handleMapClick);
    mapInstanceRef.current = map;

    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.off('click', handleMapClick);
      map.remove();
      mapInstanceRef.current = null;
      clearSelectionOverlay();
    };
  }, []);

  const loadData = async (nextStatusFilter = statusFilter) => {
    setIsLoading(true);
    setError('');
    try {
      const [summaryPayload, disputesPayload] = await Promise.all([
        fetchDisputeSummary(),
        fetchDisputes(nextStatusFilter),
      ]);
      setSummary({
        total: Number(summaryPayload.total || 0),
        open: Number(summaryPayload.open || 0),
        in_review: Number(summaryPayload.in_review || 0),
        resolved: Number(summaryPayload.resolved || 0),
        rejected: Number(summaryPayload.rejected || 0),
        urgent_open: Number(summaryPayload.urgent_open || 0),
      });
      setItems(Array.isArray(disputesPayload.items) ? disputesPayload.items : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load disputes.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData(statusFilter);
  }, [statusFilter]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const haystack = [
        item.parcelRef,
        item.disputeType,
        item.description,
        item.status,
        item.priority,
        item.reporter?.name,
        item.reporter?.email,
        item.ledgerBlock?.hash,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, searchQuery]);

  const handleFormChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFormError('');
    setFormSuccess('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!form.parcelRef.trim()) {
      setFormError('Parcel reference is required.');
      return;
    }
    if (!form.description.trim() || form.description.trim().length < 15) {
      setFormError('Description must be at least 15 characters.');
      return;
    }

    const typedCoords = form.coordsText.trim() ? parseCoords(form.coordsText) : null;
    if (form.coordsText.trim() && !typedCoords) {
      setFormError('Coordinates must be in "lat, lng" format.');
      return;
    }

    const coordsToSend = typedCoords || selectionBounds?.center || null;

    setIsSubmitting(true);
    try {
      await createDispute({
        parcelRef: form.parcelRef.trim(),
        disputeType: form.disputeType,
        priority: form.priority,
        coords: coordsToSend,
        selectionBounds,
        description: form.description.trim(),
        evidenceUrls: toEvidenceArray(form.evidenceText),
      });

      setForm(defaultForm);
      clearSelection(true);
      setLocationQuery('');
      setLocationError('');
      setFormSuccess('Dispute filed and added to tamper-evident ledger.');
      await loadData(statusFilter);
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : 'Failed to create dispute.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusUpdate = async (dispute, nextStatus) => {
    setError('');
    setFormSuccess('');
    const note =
      nextStatus === 'RESOLVED'
        ? window.prompt('Optional resolution note:', dispute.resolutionNote || '') || ''
        : '';

    setUpdatingId(dispute.id);
    try {
      const payload = await updateDisputeStatus({
        disputeId: dispute.id,
        status: nextStatus,
        note,
      });

      const updated = payload?.item;
      if (updated) {
        setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        await loadData(statusFilter);
      }
      await loadData(statusFilter);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Failed to update dispute.');
    } finally {
      setUpdatingId('');
    }
  };

  const handleVerifyLedger = async (disputeId) => {
    setError('');
    setVerifyingId(disputeId);
    try {
      const result = await verifyDisputeLedger(disputeId);
      setLedgerChecks((prev) => ({ ...prev, [disputeId]: result }));
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Failed to verify dispute ledger.');
    } finally {
      setVerifyingId('');
    }
  };

  const summaryCards = [
    { title: 'Total disputes', value: summary.total, tone: 'text-slate-900' },
    { title: 'Open', value: summary.open, tone: 'text-amber-700' },
    { title: 'In review', value: summary.in_review, tone: 'text-sky-700' },
    { title: 'Urgent open', value: summary.urgent_open, tone: 'text-rose-700' },
  ];

  const selectionStatus = selectionStart && !selectionEnd
    ? 'Corner A selected. Click opposite corner to complete land selection.'
    : selectionBounds
      ? 'Land parcel selected. Center coordinate will be used in dispute.'
      : 'Click on map to select Corner A of disputed land.';

  return (
    <div className="space-y-6 p-6">
      <section className="panel-surface rounded-2xl p-6 shadow-[0_14px_32px_rgba(15,23,42,0.08)]">
        <p className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-rose-700">
          <Icons.Gavel className="h-3.5 w-3.5" />
          Dispute Workflow
        </p>
        <h2 className="mt-3 font-display text-2xl font-bold text-slate-900">Land Dispute Management</h2>
        <p className="mt-2 text-sm text-slate-600">
          File disputes, mark disputed parcel directly on map, and keep blockchain-auditable status updates.
        </p>
      </section>

      {error && (
        <section className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </section>
      )}

      {formSuccess && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {formSuccess}
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <article key={card.title} className="panel-surface rounded-xl p-4">
            <p className="text-xs uppercase tracking-[0.08em] text-slate-500">{card.title}</p>
            <p className={`mt-2 text-xl font-bold ${card.tone}`}>{isLoading ? '...' : card.value}</p>
          </article>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_1fr]">
        <article className="panel-surface rounded-2xl p-5">
          <h3 className="font-display text-lg font-bold text-slate-900">File New Dispute</h3>
          <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Parcel Ref</label>
              <input
                value={form.parcelRef}
                onChange={(event) => handleFormChange('parcelRef', event.target.value)}
                placeholder="e.g. Khasra-22/17 or Parcel-ID"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Type</label>
                <select
                  value={form.disputeType}
                  onChange={(event) => handleFormChange('disputeType', event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                >
                  {DISPUTE_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Priority</label>
                <select
                  value={form.priority}
                  onChange={(event) => handleFormChange('priority', event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                >
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Select Land on Map (2 clicks)</p>
              <div className="mt-2 flex gap-2">
                <input
                  value={locationQuery}
                  onChange={(event) => setLocationQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void handleLocationSearch(event);
                    }
                  }}
                  placeholder="Search place or lat,lng"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
                <button
                  type="button"
                  onClick={() => {
                    void handleLocationSearch();
                  }}
                  disabled={isLocating}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {isLocating ? 'Finding...' : 'Go'}
                </button>
              </div>
              {locationError && (
                <p className="mt-1 text-[11px] text-rose-600">{locationError}</p>
              )}

              <div ref={mapContainerRef} className="mt-2 h-56 w-full overflow-hidden rounded-lg border border-slate-200" />

              <p className="mt-2 text-[11px] text-slate-600">{selectionStatus}</p>
              <p className="mt-1 text-[11px] text-slate-500">Point A: {formatCoordPair(selectionStart)}</p>
              <p className="text-[11px] text-slate-500">Point B: {formatCoordPair(selectionEnd)}</p>
              <p className="text-[11px] text-slate-500">Selected area: {boundsSummary(selectionBounds)}</p>

              <button
                type="button"
                onClick={() => clearSelection(true)}
                className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                Clear Map Selection
              </button>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Center Coordinates (optional override)</label>
              <input
                value={form.coordsText}
                onChange={(event) => handleFormChange('coordsText', event.target.value)}
                placeholder="lat, lng (auto-filled from map selection)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Description</label>
              <textarea
                rows={4}
                value={form.description}
                onChange={(event) => handleFormChange('description', event.target.value)}
                placeholder="Describe ownership conflict, mismatch, encroachment, or evidence."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Evidence URLs (optional)</label>
              <textarea
                rows={3}
                value={form.evidenceText}
                onChange={(event) => handleFormChange('evidenceText', event.target.value)}
                placeholder="One URL per line"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </div>

            {formError && (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{formError}</p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {isSubmitting ? <Icons.Spinner className="h-4 w-4 animate-spin" /> : <Icons.Gavel className="h-4 w-4" />}
              {isSubmitting ? 'Submitting...' : 'Submit Dispute'}
            </button>
          </form>
        </article>

        <article className="panel-surface rounded-2xl">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-slate-600">
                Showing <span className="font-semibold text-slate-900">{filteredItems.length}</span> records
              </div>
              <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row">
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <div className="relative md:w-72">
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search parcel, type, description, hash"
                    className="w-full rounded-lg border border-slate-300 py-2 pl-10 pr-3 text-sm text-slate-700 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                  <Icons.Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                </div>
              </div>
            </div>
          </div>

          <div className="max-h-[690px] overflow-y-auto p-5">
            {isLoading ? (
              <p className="py-8 text-center text-sm text-slate-500">Loading disputes...</p>
            ) : filteredItems.length ? (
              <div className="space-y-3">
                {filteredItems.map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 bg-white/90 p-4">
                    {ledgerChecks[item.id] && (
                      <div
                        className={`mb-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                          ledgerChecks[item.id].valid
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-rose-200 bg-rose-50 text-rose-700'
                        }`}
                      >
                        Ledger check: {ledgerChecks[item.id].valid ? 'valid' : 'issue'} | events: {ledgerChecks[item.id].eventCount} | snapshot: {ledgerChecks[item.id].snapshotMatch ? 'match' : 'mismatch'}
                      </div>
                    )}

                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{item.parcelRef}</p>
                        <p className="text-xs text-slate-500">
                          {item.disputeType.replaceAll('_', ' ')} • Created {formatDateTime(item.createdAt)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClasses[item.status] || statusClasses.OPEN}`}>
                          {statusLabel(item.status)}
                        </span>
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${priorityClasses[item.priority] || priorityClasses.MEDIUM}`}>
                          {item.priority}
                        </span>
                      </div>
                    </div>

                    <p className="mt-2 text-sm text-slate-700">{item.description}</p>

                    <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-500 sm:grid-cols-2">
                      <p>Coords: {formatCoordPair(item.coords)}</p>
                      <p>Updated: {formatDateTime(item.updatedAt)}</p>
                      <p>Evidence count: {Array.isArray(item.evidenceUrls) ? item.evidenceUrls.length : 0}</p>
                      <p className="font-mono" title={item.ledgerBlock?.hash || ''}>Block: {shortHash(item.ledgerBlock?.hash)}</p>
                    </div>
                    {item.reporter && (
                      <p className="mt-1 text-xs text-slate-500">
                        Reporter: {item.reporter.name} ({item.reporter.email || 'no-email'})
                      </p>
                    )}
                    <p className="mt-1 font-mono text-xs text-slate-500" title={item.snapshotHash || ''}>
                      Snapshot: {shortHash(item.snapshotHash)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Area: {boundsSummary(item.selectionBounds)}</p>

                    {item.resolutionNote && (
                      <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700">
                        Resolution note: {item.resolutionNote}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={verifyingId === item.id}
                        onClick={() => {
                          void handleVerifyLedger(item.id);
                        }}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                      >
                        {verifyingId === item.id ? 'Verifying...' : 'Verify Ledger'}
                      </button>
                      {item.status !== 'IN_REVIEW' && (
                        <button
                          type="button"
                          disabled={updatingId === item.id}
                          onClick={() => handleStatusUpdate(item, 'IN_REVIEW')}
                          className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-100 disabled:opacity-60"
                        >
                          Mark In Review
                        </button>
                      )}
                      {item.status !== 'RESOLVED' && (
                        <button
                          type="button"
                          disabled={updatingId === item.id}
                          onClick={() => handleStatusUpdate(item, 'RESOLVED')}
                          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
                        >
                          Resolve
                        </button>
                      )}
                      {item.status !== 'REJECTED' && (
                        <button
                          type="button"
                          disabled={updatingId === item.id}
                          onClick={() => handleStatusUpdate(item, 'REJECTED')}
                          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                        >
                          Reject
                        </button>
                      )}
                      {item.status !== 'OPEN' && (
                        <button
                          type="button"
                          disabled={updatingId === item.id}
                          onClick={() => handleStatusUpdate(item, 'OPEN')}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                        >
                          Re-open
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center">
                <p className="font-semibold text-slate-700">No disputes found</p>
                <p className="mt-1 text-xs text-slate-500">Submit a new case or change your filters.</p>
              </div>
            )}
          </div>
        </article>
      </section>
    </div>
  );
};
