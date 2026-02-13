import React, { useEffect, useMemo, useState } from 'react';
import { Icons } from './Icons';
import { verifyAuthChain } from '../services/authService.js';
import { fetchAgricultureHistory } from '../services/agriInsightsService.js';
import { fetchDisputeSummary } from '../services/disputeService.js';

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

export const Dashboard = () => {
  const [chain, setChain] = useState({ valid: null, totalBlocks: 0, lastHash: null });
  const [insights, setInsights] = useState([]);
  const [disputeSummary, setDisputeSummary] = useState({
    total: 0,
    open: 0,
    in_review: 0,
    resolved: 0,
    rejected: 0,
    urgent_open: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [chainResult, historyResult, disputeResult] = await Promise.all([
          verifyAuthChain(),
          fetchAgricultureHistory(),
          fetchDisputeSummary(),
        ]);

        if (!active) return;
        setChain({
          valid: chainResult.valid,
          totalBlocks: chainResult.totalBlocks || 0,
          lastHash: chainResult.lastHash || null,
        });
        setInsights(Array.isArray(historyResult.items) ? historyResult.items : []);
        setDisputeSummary({
          total: Number(disputeResult.total || 0),
          open: Number(disputeResult.open || 0),
          in_review: Number(disputeResult.in_review || 0),
          resolved: Number(disputeResult.resolved || 0),
          rejected: Number(disputeResult.rejected || 0),
          urgent_open: Number(disputeResult.urgent_open || 0),
        });
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'Unable to load dashboard data.');
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, []);

  const metrics = useMemo(() => {
    const totalInsights = insights.length;
    const ndviAvg = totalInsights
      ? insights.reduce((acc, item) => acc + Number(item?.ndvi?.mean || 0), 0) / totalInsights
      : 0;
    const latest = insights[0] || null;
    const highRisk = insights.filter((item) =>
      Array.isArray(item.risks) && item.risks.some((risk) => typeof risk === 'string' && risk !== 'No major short-term agricultural risk detected')
    ).length;

    return {
      totalInsights,
      ndviAvg,
      latest,
      highRisk,
    };
  }, [insights]);

  return (
    <div className="space-y-6 p-6">
      <section className="panel-surface rounded-2xl p-6 shadow-[0_14px_36px_rgba(15,23,42,0.08)]">
        <p className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-brand-700">
          <Icons.Sparkles className="h-3.5 w-3.5" />
          ROOT Overview
        </p>
        <h2 className="mt-3 font-display text-2xl font-bold text-slate-900">Project Health Dashboard</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Essential status for chain integrity, generated insights, and latest agricultural recommendations.
        </p>
      </section>

      {error && (
        <section className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <article className="panel-surface rounded-xl p-4">
          <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Chain status</p>
          <p className={`mt-2 text-xl font-bold ${chain.valid ? 'text-emerald-700' : 'text-rose-700'}`}>
            {loading ? 'Loading...' : chain.valid ? 'Valid' : 'Issue'}
          </p>
          <p className="mt-1 text-xs text-slate-500">Total blocks: {chain.totalBlocks}</p>
        </article>

        <article className="panel-surface rounded-xl p-4">
          <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Insights generated</p>
          <p className="mt-2 text-xl font-bold text-slate-900">{loading ? '...' : metrics.totalInsights}</p>
          <p className="mt-1 text-xs text-slate-500">Stored in PostgreSQL</p>
        </article>

        <article className="panel-surface rounded-xl p-4">
          <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Average NDVI</p>
          <p className="mt-2 text-xl font-bold text-slate-900">
            {loading ? '...' : metrics.totalInsights ? metrics.ndviAvg.toFixed(3) : 'NA'}
          </p>
          <p className="mt-1 text-xs text-slate-500">Across all saved insights</p>
        </article>

        <article className="panel-surface rounded-xl p-4">
          <p className="text-xs uppercase tracking-[0.08em] text-slate-500">High-risk insights</p>
          <p className="mt-2 text-xl font-bold text-amber-700">{loading ? '...' : metrics.highRisk}</p>
          <p className="mt-1 text-xs text-slate-500">Need closer review</p>
        </article>

        <article className="panel-surface rounded-xl p-4">
          <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Open disputes</p>
          <p className="mt-2 text-xl font-bold text-rose-700">{loading ? '...' : disputeSummary.open}</p>
          <p className="mt-1 text-xs text-slate-500">Urgent: {loading ? '...' : disputeSummary.urgent_open}</p>
        </article>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <article className="panel-surface rounded-2xl p-5">
          <h3 className="font-display text-lg font-bold text-slate-900">How To Use ROOT</h3>
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-slate-200 bg-white/80 px-3 py-3 text-sm text-slate-700">
              <p className="font-semibold">1. Search and select parcel on map</p>
              <p className="mt-1 text-xs text-slate-500">Use Geo-Explorer, click two diagonal points to define area.</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white/80 px-3 py-3 text-sm text-slate-700">
              <p className="font-semibold">2. Review NDVI + crop recommendation</p>
              <p className="mt-1 text-xs text-slate-500">System computes NDVI, irrigation need, and risk signals.</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white/80 px-3 py-3 text-sm text-slate-700">
              <p className="font-semibold">3. Validate blockchain record</p>
              <p className="mt-1 text-xs text-slate-500">Each event is written as a hash-linked block.</p>
            </div>
          </div>
        </article>

        <article className="panel-surface rounded-2xl p-5">
          <h3 className="font-display text-lg font-bold text-slate-900">Latest Insight Snapshot</h3>
          {loading ? (
            <p className="mt-4 text-sm text-slate-500">Loading...</p>
          ) : metrics.latest ? (
            <div className="mt-4 space-y-2 text-sm">
              <p className="text-slate-700">
                <span className="font-semibold">Coords:</span> {formatCoords(metrics.latest.coords)}
              </p>
              <p className="text-slate-700">
                <span className="font-semibold">Top crop:</span> {metrics.latest.recommendedCrops?.[0]?.name || 'NA'}
              </p>
              <p className="text-slate-700">
                <span className="font-semibold">Irrigation:</span> {metrics.latest.irrigation || 'NA'}
              </p>
              <p className="text-slate-700">
                <span className="font-semibold">Generated:</span> {formatDateTime(metrics.latest.createdAt)}
              </p>
              <p className="text-xs text-slate-500 break-all">
                Block hash: {metrics.latest.ledgerBlock?.hash || chain.lastHash || 'NA'}
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">No insight data yet. Generate first result from Geo-Explorer.</p>
          )}
        </article>
      </section>
    </div>
  );
};
