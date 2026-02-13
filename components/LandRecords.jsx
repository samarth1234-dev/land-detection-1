import React, { useMemo, useState } from 'react';
import { Icons } from './Icons';

const MOCK_RECORDS = [
  { id: 'T-882190', owner: 'Green Valley Farms', location: '34.05N, 118.24W', size: '45.2 Ha', verified: true, date: '2023-10-12' },
  { id: 'T-882191', owner: 'Urban Dev Corp', location: '34.01N, 118.29W', size: '12.5 Ha', verified: true, date: '2023-10-15' },
  { id: 'T-882192', owner: 'Private Holding', location: '34.12N, 118.35W', size: '2.1 Ha', verified: false, date: '2023-11-01' },
  { id: 'T-882193', owner: 'State Reserve', location: '34.45N, 118.10W', size: '120.0 Ha', verified: true, date: '2023-11-05' },
  { id: 'T-882194', owner: 'AgriTech Industries', location: '35.01N, 119.50W', size: '67.8 Ha', verified: true, date: '2023-11-12' },
  { id: 'T-882195', owner: 'Northridge Orchards', location: '35.20N, 119.77W', size: '31.6 Ha', verified: false, date: '2023-11-16' },
];

const FILTERS = [
  { key: 'ALL', label: 'All records' },
  { key: 'VERIFIED', label: 'Verified' },
  { key: 'PENDING', label: 'Pending' },
];

export const LandRecords = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL');

  const filteredRecords = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return MOCK_RECORDS.filter((record) => {
      const matchesQuery =
        !q ||
        record.owner.toLowerCase().includes(q) ||
        record.id.toLowerCase().includes(q) ||
        record.location.toLowerCase().includes(q);

      const matchesFilter =
        activeFilter === 'ALL' ||
        (activeFilter === 'VERIFIED' && record.verified) ||
        (activeFilter === 'PENDING' && !record.verified);

      return matchesQuery && matchesFilter;
    });
  }, [searchTerm, activeFilter]);

  const verifiedCount = MOCK_RECORDS.filter((record) => record.verified).length;
  const pendingCount = MOCK_RECORDS.length - verifiedCount;
  const verifiedPct = Math.round((verifiedCount / MOCK_RECORDS.length) * 100);

  return (
    <div className="space-y-6 p-6">
      <header className="panel-surface rounded-2xl p-6 shadow-[0_16px_35px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-earth-200 bg-earth-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-earth-700">
              <Icons.Database className="h-3.5 w-3.5" />
              Registry ledger
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold text-slate-900">Land Registry Ledger</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Immutable blockchain records of verified land parcels and ownership snapshots.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
              <Icons.Filter className="h-4 w-4" />
              Filters
            </button>
            <button className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
              <Icons.Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Total records</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{MOCK_RECORDS.length}</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.08em] text-emerald-700">Verified</p>
            <p className="mt-1 text-2xl font-bold text-emerald-800">{verifiedCount}</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.08em] text-amber-700">Pending</p>
            <p className="mt-1 text-2xl font-bold text-amber-800">{pendingCount}</p>
          </div>
        </div>
      </header>

      <section className="panel-surface overflow-hidden rounded-2xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:w-96">
              <input
                type="text"
                placeholder="Search by owner, ID, or coordinates"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-700 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
              <Icons.Search className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
            </div>

            <div className="flex flex-wrap gap-2">
              {FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  onClick={() => setActiveFilter(filter.key)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    activeFilter === filter.key
                      ? 'border-brand-400 bg-brand-50 text-brand-700'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead className="bg-slate-100/80 text-xs uppercase tracking-[0.06em] text-slate-500">
              <tr>
                <th className="px-6 py-3 font-semibold">Transaction ID</th>
                <th className="px-6 py-3 font-semibold">Owner</th>
                <th className="px-6 py-3 font-semibold">Coordinates</th>
                <th className="px-6 py-3 font-semibold">Size</th>
                <th className="px-6 py-3 font-semibold">Date</th>
                <th className="px-6 py-3 font-semibold">Verification</th>
                <th className="px-6 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length > 0 ? (
                filteredRecords.map((record) => (
                  <tr key={record.id} className="border-t border-slate-100 bg-white/85 hover:bg-white">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Icons.Database className="h-4 w-4 text-brand-500" />
                        <span className="font-mono text-sm text-slate-700">{record.id}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-semibold text-slate-900">{record.owner}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">{record.location}</td>
                    <td className="px-6 py-4 text-slate-700">{record.size}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">{record.date}</td>
                    <td className="px-6 py-4">
                      {record.verified ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                          <Icons.Verified className="mr-1 h-3.5 w-3.5" />
                          Verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                          <Icons.Clock className="mr-1 h-3.5 w-3.5" />
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 transition hover:text-brand-600">
                        View cert
                        <Icons.TrendUp className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <p className="text-sm font-semibold text-slate-700">No records found</p>
                    <p className="mt-1 text-xs text-slate-500">Try changing search text or filter.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/80 px-6 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Showing <strong>{filteredRecords.length}</strong> record(s) • <strong>{verifiedPct}%</strong> verified
          </span>
          <div className="flex gap-2">
            <button className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
              Previous
            </button>
            <button className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
