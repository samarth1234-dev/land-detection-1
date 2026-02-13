import React from 'react';
import { Icons } from './Icons';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

const verificationTrend = [
  { month: 'Jan', verified: 340, flagged: 42 },
  { month: 'Feb', verified: 382, flagged: 39 },
  { month: 'Mar', verified: 410, flagged: 35 },
  { month: 'Apr', verified: 448, flagged: 31 },
  { month: 'May', verified: 476, flagged: 25 },
  { month: 'Jun', verified: 512, flagged: 19 },
];

const suitabilityByZone = [
  { zone: 'North Belt', score: 78 },
  { zone: 'Central Plains', score: 92 },
  { zone: 'River Delta', score: 74 },
  { zone: 'Dry Fringe', score: 56 },
  { zone: 'Upland', score: 64 },
];

const kpis = [
  {
    label: 'Land Monitored',
    value: '1,240 Ha',
    change: '+8.4%',
    note: 'since last cycle',
    icon: Icons.Map,
    tone: 'from-brand-500/30 to-brand-700/10 text-brand-700'
  },
  {
    label: 'Verified Parcels',
    value: '892',
    change: '+36',
    note: 'last 7 days',
    icon: Icons.Verified,
    tone: 'from-emerald-500/30 to-emerald-700/10 text-emerald-700'
  },
  {
    label: 'Risk Alerts',
    value: '14',
    change: '-3',
    note: 'resolved today',
    icon: Icons.Alert,
    tone: 'from-amber-500/30 to-amber-700/10 text-amber-700'
  },
  {
    label: 'AI Review Queue',
    value: '45',
    change: '+5',
    note: 'requires approval',
    icon: Icons.AI,
    tone: 'from-slate-500/30 to-slate-700/10 text-slate-700'
  },
];

const recentVerifications = [
  { id: 'P-9021', location: 'Sacramento Valley, CA', time: '2 min ago', hash: '0x7f...3a2b', status: 'Verified' },
  { id: 'P-9022', location: 'Napa County, CA', time: '15 min ago', hash: '0x8e...9c1d', status: 'Pending' },
  { id: 'P-9023', location: 'Central Coast, CA', time: '1 hr ago', hash: '0x1a...4f5e', status: 'Verified' },
  { id: 'P-9024', location: 'Merced Basin, CA', time: '3 hr ago', hash: '0x5d...7a91', status: 'Verified' },
];

const activityFeed = [
  { title: 'Boundary drift detected', detail: 'Parcel P-1088 shifted by 3.1m from baseline geometry.', severity: 'Medium' },
  { title: 'High cloud cover warning', detail: 'Acquisition quality below 35% threshold for 2 parcels.', severity: 'Low' },
  { title: 'Land-use transition observed', detail: 'Vegetation signature reduced over 19.4 Ha in Central Plains.', severity: 'High' },
];

const chartTooltip = {
  backgroundColor: '#fff',
  borderRadius: '10px',
  border: '1px solid #dbe4dc',
  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)'
};

export const Dashboard = () => {
  return (
    <div className="space-y-6 p-6 animate-fade-in">
      <section className="panel-surface rounded-2xl p-6 shadow-[0_20px_45px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-brand-700">
              <Icons.Sparkles className="h-3.5 w-3.5" />
              Land Intelligence
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold text-slate-900">Executive Dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Unified monitoring for parcel verification, NDVI health, and blockchain-backed compliance activity.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-earth-100 bg-earth-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Today checks</p>
              <p className="mt-1 text-xl font-bold text-slate-900">128</p>
            </div>
            <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Latency</p>
              <p className="mt-1 text-xl font-bold text-slate-900">1.8s</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map((item) => (
          <article key={item.label} className="panel-surface rounded-2xl p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">{item.label}</p>
                <p className="mt-2 text-3xl font-bold text-slate-900">{item.value}</p>
              </div>
              <span className={`grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br ${item.tone}`}>
                <item.icon className="h-5 w-5" />
              </span>
            </div>
            <div className="mt-4 flex items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                <Icons.TrendUp className="h-3.5 w-3.5" />
                {item.change}
              </span>
              <span className="text-slate-500">{item.note}</span>
            </div>
          </article>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <article className="panel-surface rounded-2xl p-6 xl:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="font-display text-xl font-bold text-slate-900">Verification Throughput</h3>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Last 6 months</p>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={verificationTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dbe4dc" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} />
                <Tooltip contentStyle={chartTooltip} />
                <Line type="monotone" dataKey="verified" stroke="#0f7db6" strokeWidth={3} dot={{ r: 4, fill: '#0f7db6' }} />
                <Line type="monotone" dataKey="flagged" stroke="#c67b1f" strokeWidth={3} dot={{ r: 4, fill: '#c67b1f' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel-surface rounded-2xl p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-xl font-bold text-slate-900">Risk Monitor</h3>
            <Icons.Activity className="h-5 w-5 text-rose-500" />
          </div>
          <div className="space-y-3">
            {activityFeed.map((event) => (
              <div key={event.title} className="rounded-xl border border-slate-200 bg-white/80 p-3">
                <p className="text-sm font-semibold text-slate-900">{event.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{event.detail}</p>
                <span
                  className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    event.severity === 'High'
                      ? 'bg-rose-100 text-rose-700'
                      : event.severity === 'Medium'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-sky-100 text-sky-700'
                  }`}
                >
                  {event.severity} severity
                </span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <article className="panel-surface rounded-2xl p-6 xl:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="font-display text-xl font-bold text-slate-900">Agricultural Suitability by Zone</h3>
            <span className="rounded-full bg-earth-100 px-3 py-1 text-xs font-semibold text-earth-700">NDVI Weighted</span>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={suitabilityByZone}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dbe4dc" />
                <XAxis dataKey="zone" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={chartTooltip} />
                <Bar dataKey="score" fill="#6d8f45" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel-surface rounded-2xl p-6">
          <h3 className="font-display text-xl font-bold text-slate-900">Ops Snapshot</h3>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white/80 px-3 py-2">
              <span className="text-slate-600">Average cloud cover</span>
              <span className="font-semibold text-slate-900">12.4%</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white/80 px-3 py-2">
              <span className="text-slate-600">Boundary disputes</span>
              <span className="font-semibold text-slate-900">3 open</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white/80 px-3 py-2">
              <span className="text-slate-600">Chain finality</span>
              <span className="font-semibold text-slate-900">99.98%</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white/80 px-3 py-2">
              <span className="text-slate-600">Avg review SLA</span>
              <span className="font-semibold text-slate-900">2h 19m</span>
            </div>
          </div>
        </article>
      </section>

      <section className="panel-surface overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h3 className="font-display text-lg font-bold text-slate-900">Recent Blockchain Verifications</h3>
          <button className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
            <Icons.Download className="h-3.5 w-3.5" />
            Export
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100/80 text-xs uppercase tracking-[0.06em] text-slate-500">
              <tr>
                <th className="px-6 py-3 font-semibold">Parcel ID</th>
                <th className="px-6 py-3 font-semibold">Location</th>
                <th className="px-6 py-3 font-semibold">Timestamp</th>
                <th className="px-6 py-3 font-semibold">Block Hash</th>
                <th className="px-6 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {recentVerifications.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 bg-white/85 hover:bg-white">
                  <td className="px-6 py-4 font-semibold text-slate-900">{row.id}</td>
                  <td className="px-6 py-4 text-slate-600">{row.location}</td>
                  <td className="px-6 py-4 text-slate-500">{row.time}</td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-500">{row.hash}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        row.status === 'Verified'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
