import React, { useEffect, useMemo, useState } from 'react';
import { Icons } from './Icons';
import { verifyAuthChain } from '../services/authService.js';
import { fetchAgricultureHistory } from '../services/agriInsightsService.js';
import { fetchDisputeSummary } from '../services/disputeService.js';
import { fetchGovernanceAnalytics } from '../services/analyticsService.js';

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

export const Dashboard = ({ role = 'USER' }) => {
  const isEmployee = role === 'EMPLOYEE';
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
  const [governance, setGovernance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const requests = [verifyAuthChain(), fetchAgricultureHistory(), fetchDisputeSummary()];
        if (isEmployee) {
          requests.push(fetchGovernanceAnalytics());
        }
        const [chainResult, historyResult, disputeResult, governanceResult] = await Promise.all(requests);

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
        setGovernance(isEmployee ? governanceResult || null : null);
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
  }, [isEmployee]);

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
          {isEmployee ? 'Governance Overview' : 'Citizen Overview'}
        </p>
        <h2 className="mt-3 font-display text-2xl font-bold text-slate-900">
          {isEmployee ? 'Government Operations Dashboard' : 'My Land Intelligence Dashboard'}
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          {isEmployee
            ? 'Global metrics across users, disputes, vegetation trends, and blockchain-backed audit integrity.'
            : 'My records, dispute activity, and latest agricultural recommendations for selected parcels.'}
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
          <p className="text-xs uppercase tracking-[0.08em] text-slate-500">{isEmployee ? 'Average NDVI (Global)' : 'Average NDVI'}</p>
          <p className="mt-2 text-xl font-bold text-slate-900">
            {loading ? '...' : metrics.totalInsights ? metrics.ndviAvg.toFixed(3) : 'NA'}
          </p>
          <p className="mt-1 text-xs text-slate-500">{isEmployee ? 'Across all users' : 'Across my saved insights'}</p>
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

      {isEmployee && governance && (
        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <article className="panel-surface rounded-2xl p-5">
            <h3 className="font-display text-lg font-bold text-slate-900">User Mix</h3>
            <div className="mt-3 space-y-1 text-sm text-slate-700">
              <p>Total users: <span className="font-semibold">{governance.users?.total ?? 0}</span></p>
              <p>Citizens: <span className="font-semibold">{governance.users?.citizens ?? 0}</span></p>
              <p>Employees: <span className="font-semibold">{governance.users?.employees ?? 0}</span></p>
            </div>
          </article>

          <article className="panel-surface rounded-2xl p-5">
            <h3 className="font-display text-lg font-bold text-slate-900">Climate Averages</h3>
            <div className="mt-3 space-y-1 text-sm text-slate-700">
              <p>Rainfall (7d): <span className="font-semibold">{Number(governance.insights?.avgRainfall7d || 0).toFixed(1)} mm</span></p>
              <p>Avg max temp: <span className="font-semibold">{Number(governance.insights?.avgMaxTemp || 0).toFixed(1)} C</span></p>
              <p>Avg min temp: <span className="font-semibold">{Number(governance.insights?.avgMinTemp || 0).toFixed(1)} C</span></p>
              <p>Dispute resolution: <span className="font-semibold">{Number(governance.disputes?.avgResolutionHours || 0).toFixed(1)} hrs</span></p>
            </div>
          </article>

          <article className="panel-surface rounded-2xl p-5">
            <h3 className="font-display text-lg font-bold text-slate-900">Top Crops (Global)</h3>
            <div className="mt-3 space-y-1 text-sm text-slate-700">
              {(governance.topCrops || []).length ? (
                governance.topCrops.map((crop) => (
                  <p key={crop.name}>
                    {crop.name}: <span className="font-semibold">{crop.count}</span>
                  </p>
                ))
              ) : (
                <p>No crop distribution data yet.</p>
              )}
            </div>
          </article>
        </section>
      )}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <article className="panel-surface rounded-2xl p-5">
          <h3 className="font-display text-lg font-bold text-slate-900">{isEmployee ? 'Employee Workflow' : 'How To Use ROOT'}</h3>
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-slate-200 bg-white/80 px-3 py-3 text-sm text-slate-700">
              <p className="font-semibold">{isEmployee ? '1. Monitor citizen and dispute trends' : '1. Search and select parcel on map'}</p>
              <p className="mt-1 text-xs text-slate-500">
                {isEmployee ? 'Review global metrics and high-risk dispute queues.' : 'Use Geo-Explorer, click two diagonal points to define area.'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white/80 px-3 py-3 text-sm text-slate-700">
              <p className="font-semibold">{isEmployee ? '2. Validate blockchain-linked records' : '2. Review NDVI + crop recommendation'}</p>
              <p className="mt-1 text-xs text-slate-500">
                {isEmployee ? 'Verify dispute snapshots and record integrity across users.' : 'System computes NDVI, irrigation need, and risk signals.'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white/80 px-3 py-3 text-sm text-slate-700">
              <p className="font-semibold">{isEmployee ? '3. Resolve or escalate disputes' : '3. Validate blockchain record'}</p>
              <p className="mt-1 text-xs text-slate-500">
                {isEmployee ? 'Use dispute status workflow and governance evidence trail.' : 'Each event is written as a hash-linked block.'}
              </p>
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
