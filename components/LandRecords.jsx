import React, { useEffect, useMemo, useState } from 'react';
import { Icons } from './Icons';
import { fetchAgricultureHistory } from '../services/agriInsightsService.js';

const formatDateTime = (value) => {
  if (!value) return 'NA';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'NA';
  return date.toLocaleString();
};

const formatCoords = (coords = []) => {
  if (!Array.isArray(coords) || coords.length < 2) return 'NA';
  return `${Number(coords[0]).toFixed(4)}, ${Number(coords[1]).toFixed(4)}`;
};

const shortHash = (hash = '') => {
  if (!hash || hash.length < 14) return hash || 'NA';
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
};

export const LandRecords = () => {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let active = true;

    const load = async () => {
      setIsLoading(true);
      setError('');
      try {
        const payload = await fetchAgricultureHistory();
        if (!active) return;
        setItems(Array.isArray(payload.items) ? payload.items : []);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load records.');
      } finally {
        if (active) setIsLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;

    return items.filter((item) => {
      const topCrop = item.recommendedCrops?.[0]?.name || '';
      const risk = Array.isArray(item.risks) ? item.risks.join(' ') : '';
      const summary = item.summary || '';
      const coords = formatCoords(item.coords);
      const hash = item.ledgerBlock?.hash || '';

      return [topCrop, risk, summary, coords, hash].some((value) => String(value).toLowerCase().includes(q));
    });
  }, [items, query]);

  return (
    <div className="space-y-6 p-6">
      <section className="panel-surface rounded-2xl p-6 shadow-[0_14px_32px_rgba(15,23,42,0.08)]">
        <p className="inline-flex items-center gap-2 rounded-full border border-earth-200 bg-earth-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-earth-700">
          <Icons.Database className="h-3.5 w-3.5" />
          Records
        </p>
        <h2 className="mt-3 font-display text-2xl font-bold text-slate-900">Agriculture Insight Ledger</h2>
        <p className="mt-2 text-sm text-slate-600">
          Saved PostgreSQL records with linked blockchain block hashes for each generated insight.
        </p>
      </section>

      <section className="panel-surface rounded-2xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-slate-600">
              Total records: <span className="font-semibold text-slate-900">{items.length}</span>
            </div>
            <div className="relative w-full md:w-96">
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search crop, risk, summary, coords, hash"
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-3 text-sm text-slate-700 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
              <Icons.Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            </div>
          </div>
        </div>

        {error && (
          <div className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-700">{error}</div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-slate-100/80 text-xs uppercase tracking-[0.06em] text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Date</th>
                <th className="px-5 py-3 font-semibold">Coordinates</th>
                <th className="px-5 py-3 font-semibold">NDVI</th>
                <th className="px-5 py-3 font-semibold">Top Crop</th>
                <th className="px-5 py-3 font-semibold">Irrigation</th>
                <th className="px-5 py-3 font-semibold">Primary Risk</th>
                <th className="px-5 py-3 font-semibold">Block Hash</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-slate-500">
                    Loading records...
                  </td>
                </tr>
              ) : filtered.length ? (
                filtered.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100 bg-white/85 hover:bg-white">
                    <td className="px-5 py-4 text-slate-600">{formatDateTime(item.createdAt)}</td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-700">{formatCoords(item.coords)}</td>
                    <td className="px-5 py-4 text-slate-700">{Number(item?.ndvi?.mean || 0).toFixed(3)}</td>
                    <td className="px-5 py-4 text-slate-700">{item.recommendedCrops?.[0]?.name || 'NA'}</td>
                    <td className="px-5 py-4 text-slate-700">{item.irrigation || 'NA'}</td>
                    <td className="px-5 py-4 text-amber-700">{item.risks?.[0] || 'NA'}</td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-500" title={item.ledgerBlock?.hash || ''}>
                      {shortHash(item.ledgerBlock?.hash)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center">
                    <p className="font-semibold text-slate-700">No matching records</p>
                    <p className="mt-1 text-xs text-slate-500">Generate new insights from Geo-Explorer to populate this ledger.</p>
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
