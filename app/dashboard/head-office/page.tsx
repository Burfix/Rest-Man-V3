/**
 * Head Office Control Tower
 *
 * Multi-store executive dashboard. Aggregates data from all active sites
 * and presents group-level metrics, store risk map, leaderboard,
 * 7-day trend analysis and action oversight in a single screen.
 *
 * Layout (top-to-bottom):
 *   1. GroupScoreHeader  — group avg score + 5 KPI tiles
 *   2. StoreRiskGrid     — per-store risk map (responsive grid)
 *   3. Bottom row:
 *        StoreLeaderboard   (1/3)    — ranked store list
 *        GroupTrendsPanel   (2/3)    — 7-day sparklines (3 metrics)
 *   4. ActionOversightPanel (full) — per-store action tracking table
 */

import {
  getStoreSummaries,
  computeGroupMetrics,
  buildLeaderboard,
  getGroupTrends,
  getGroupActionStats,
} from "@/services/ops/headOffice";

import GroupScoreHeader      from "@/components/dashboard/head-office/GroupScoreHeader";
import StoreRiskGrid         from "@/components/dashboard/head-office/StoreRiskGrid";
import StoreLeaderboard      from "@/components/dashboard/head-office/StoreLeaderboard";
import GroupTrendsPanel      from "@/components/dashboard/head-office/GroupTrendsPanel";
import ActionOversightPanel  from "@/components/dashboard/head-office/ActionOversightPanel";

export const dynamic   = "force-dynamic";
export const revalidate = 0;

// ── Settle helper ────────────────────────────────────────────────────────────

function settled<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function HeadOfficePage() {
  const [summariesResult, trendsResult, actionStatsResult] = await Promise.allSettled([
    getStoreSummaries(),
    getGroupTrends(7),
    getGroupActionStats(),
  ]);

  const summaries   = settled(summariesResult,   []);
  const trends      = settled(trendsResult,      { revenue: [], labour: [], risk_score: [] });
  const actionStats = settled(actionStatsResult, []);

  const metrics     = computeGroupMetrics(summaries);
  const leaderboard = buildLeaderboard(summaries);

  return (
    <div className="space-y-6">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-stone-900 dark:text-stone-100 leading-tight">
            Head Office Control Tower
          </h1>
          <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
            Group performance across {metrics.store_count} store{metrics.store_count !== 1 ? "s" : ""}
            {" "}· Live
          </p>
        </div>

        <span className="shrink-0 rounded-full border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-1 text-[11px] font-semibold text-stone-500 dark:text-stone-400">
          🏢 Executive View
        </span>
      </div>

      {/* ── 1. Group score header ── */}
      <GroupScoreHeader metrics={metrics} storeCount={metrics.store_count} />

      {/* ── 2. Store risk map (full width) ── */}
      <StoreRiskGrid stores={summaries} />

      {/* ── 3. Leaderboard + Trends ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_2fr]">
        <StoreLeaderboard entries={leaderboard} />
        <GroupTrendsPanel trends={trends} />
      </div>

      {/* ── 4. Action oversight (full width) ── */}
      <ActionOversightPanel stats={actionStats} />

    </div>
  );
}
