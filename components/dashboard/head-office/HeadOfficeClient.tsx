"use client";

/**
 * HeadOfficeClient
 *
 * Client wrapper for the Head Office Control Tower.
 * Fetches /api/head-office/summary on mount, manages loading state,
 * maps the response to the shapes expected by all panel components.
 */

import { useEffect, useState } from "react";
import GlobalAlertBar       from "./GlobalAlertBar";
import GroupScoreHeader     from "./GroupScoreHeader";
import StoreRiskGrid        from "./StoreRiskGrid";
import AccountabilityPanel  from "./AccountabilityPanel";
import ActionOversightPanel from "./ActionOversightPanel";
import StoreLeaderboard     from "./StoreLeaderboard";
import GroupTrendsPanel     from "./GroupTrendsPanel";

import type {
  StoreSummary,
  GroupMetrics,
  StoreLeaderboardEntry,
  StoreActionStats,
  GroupCriticalAction,
  GroupTrends,
  RiskLevel,
} from "@/services/ops/headOffice";
import type { ScoreGrade } from "@/services/ops/operatingScore";

// ── API response types ────────────────────────────────────────────────────────

type StoreRow = {
  id:                   string;
  name:                 string;
  site_type:            string;
  score:                number | null;
  grade:                string;
  tasks_today:          number;
  completed_today:      number;
  open_maintenance:     number;
  critical_maintenance: number;
};

type AccountabilityRow = {
  id:             string;
  name:           string;
  avg_score:      number | null;
  grade:          string;
  total_actions:  number;
  done:           number;
  completion_pct: number | null;
  overdue:        number;
};

type ActionRow = {
  id:             string;
  name:           string;
  total:          number;
  done:           number;
  late:           number;
  completion_pct: number | null;
};

type OpsTrendRow = {
  date:      string;
  site:      string;
  avg_score: number;
};

type SummaryResponse = {
  stores:         StoreRow[];
  accountability: AccountabilityRow[];
  actions:        ActionRow[];
  opsTrend:       OpsTrendRow[];
};

// ── Mapping helpers ───────────────────────────────────────────────────────────

function gradeToScoreGrade(g: string): ScoreGrade {
  if (g === "A" || g === "B" || g === "C" || g === "D" || g === "F") return g as ScoreGrade;
  return "F";
}

function scoreToRisk(score: number | null): RiskLevel {
  if (score === null) return "yellow";
  if (score < 50)     return "red";
  if (score < 65)     return "yellow";
  return "green";
}

/** Map stores[] → StoreSummary[] for StoreRiskGrid, StoreLeaderboard */
function mapStoresToSummaries(stores: StoreRow[]): StoreSummary[] {
  return stores.map((s) => ({
    site_id:               s.id,
    name:                  s.name,
    city:                  "",
    operating_score:       s.score,
    score_grade:           gradeToScoreGrade(s.grade),
    sales_net_vat:         null,
    revenue_target:        null,
    revenue_gap_pct:       null,
    labour_pct:            null,
    compliance_score:      null,
    maintenance_score:     s.open_maintenance === 0 ? 100 : s.critical_maintenance > 0 ? 0 : 50,
    risk_level:            scoreToRisk(s.score),
    actions_total:         s.tasks_today,
    actions_completed:     s.completed_today,
    actions_overdue:       0,
    actions_completion_pct:
      s.tasks_today > 0
        ? Math.round((s.completed_today / s.tasks_today) * 100)
        : null,
    snapshot_date: null,
  }));
}

/** Map accountability[] → StoreSummary[] for AccountabilityPanel */
function mapAccountabilityToSummaries(acc: AccountabilityRow[]): StoreSummary[] {
  return acc.map((a) => ({
    site_id:               a.id,
    name:                  a.name,
    city:                  "",
    operating_score:       a.avg_score,
    score_grade:           gradeToScoreGrade(a.grade),
    sales_net_vat:         null,
    revenue_target:        null,
    revenue_gap_pct:       null,
    labour_pct:            null,
    compliance_score:      null,
    maintenance_score:     null,
    risk_level:            scoreToRisk(a.avg_score),
    actions_total:         a.total_actions,
    actions_completed:     a.done,
    actions_overdue:       a.overdue,
    actions_completion_pct: a.completion_pct,
    snapshot_date:         null,
  }));
}

/** Map actions[] → StoreActionStats[] for ActionOversightPanel */
function mapActions(rows: ActionRow[]): StoreActionStats[] {
  return rows.map((r) => ({
    site_id:        r.id,
    name:           r.name,
    total:          r.total,
    completed:      r.done,
    open:           r.total - r.done,
    overdue:        r.late,
    completion_pct: r.completion_pct,
  }));
}

/** Map opsTrend[] → GroupTrends (only risk_score populated; revenue/labour stay empty) */
function mapOpsTrend(rows: OpsTrendRow[]): GroupTrends {
  const bysite = new Map<string, { date: string; value: number }[]>();
  for (const row of rows) {
    if (!bysite.has(row.site)) bysite.set(row.site, []);
    bysite.get(row.site)!.push({ date: row.date, value: row.avg_score });
  }

  const risk_score: { site_id: string; name: string; points: { date: string; value: number }[] }[] = [];
  bysite.forEach((points, name) => {
    risk_score.push({ site_id: name, name, points });
  });

  return { revenue: [], labour: [], risk_score };
}

/** Compute GroupMetrics from stores */
function computeMetrics(stores: StoreSummary[]): GroupMetrics {
  const withScore  = stores.filter((s) => s.operating_score !== null);
  const n          = stores.length;
  const red        = stores.filter((s) => s.risk_level === "red").length;
  const yellow     = stores.filter((s) => s.risk_level === "yellow").length;
  const green      = n - red - yellow;
  const avgScore   = withScore.length > 0
    ? Math.round(withScore.reduce((s, x) => s + (x.operating_score ?? 0), 0) / withScore.length)
    : null;
  const ta         = stores.reduce((s, x) => s + x.actions_total,     0);
  const tc         = stores.reduce((s, x) => s + x.actions_completed, 0);
  const to         = stores.reduce((s, x) => s + x.actions_overdue,   0);

  return {
    store_count:            n,
    total_revenue:          null,
    total_revenue_target:   null,
    group_revenue_gap_pct:  null,
    avg_operating_score:    avgScore,
    avg_labour_pct:         null,
    compliance_risk_count:  0,
    maintenance_risk_count: stores.filter((s) => (s.maintenance_score ?? 100) < 25).length,
    red_stores:    red,
    yellow_stores: yellow,
    green_stores:  green,
    total_actions_open:      ta - tc,
    total_actions_overdue:   to,
    total_actions_completed: tc,
    group_completion_pct:    ta > 0 ? Math.round((tc / ta) * 100) : null,
    avg_food_cost_pct:       null,
    food_cost_risk_count:    0,
  };
}

/** Build leaderboard from store summaries */
function buildLeaderboard(summaries: StoreSummary[]): StoreLeaderboardEntry[] {
  const sorted = [...summaries].sort((a, b) => {
    const as_ = a.operating_score ?? -1;
    const bs_ = b.operating_score ?? -1;
    return bs_ - as_;
  });
  const n    = sorted.length;
  const topN = Math.min(3, Math.ceil(n / 2));
  const botN = Math.min(3, Math.floor(n / 2));
  return sorted.map((s, i): StoreLeaderboardEntry => ({
    ...s,
    rank:      i + 1,
    is_top:    i < topN,
    is_bottom: i >= n - botN && i >= topN,
  }));
}

/** Derive critical actions from stores */
function deriveCriticalActions(stores: StoreSummary[]): GroupCriticalAction[] {
  const out: GroupCriticalAction[] = [];
  for (const s of stores) {
    // maintenance_score: 0 = we mapped critical_maintenance > 0 in the store summary
    if ((s.maintenance_score ?? 100) === 0) {
      out.push({
        site_id:   s.site_id,
        site_name: s.name,
        category:  "maintenance",
        severity:  "critical",
        message:   "Critical maintenance — service disruption risk",
      });
    }
    if (s.actions_overdue > 3) {
      out.push({
        site_id:   s.site_id,
        site_name: s.name,
        category:  "actions",
        severity:  "critical",
        message:   `${s.actions_overdue} overdue actions — escalation needed`,
      });
    } else if (s.actions_overdue > 0) {
      out.push({
        site_id:   s.site_id,
        site_name: s.name,
        category:  "actions",
        severity:  "urgent",
        message:   `${s.actions_overdue} overdue action${s.actions_overdue > 1 ? "s" : ""} not completed`,
      });
    }
  }
  return out.sort((a, b) => (a.severity === "critical" ? 0 : 1) - (b.severity === "critical" ? 0 : 1));
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden animate-pulse">
      <div className="h-11 bg-stone-100 dark:bg-stone-800" />
      <div className="p-4 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-8 bg-stone-100 dark:bg-stone-800 rounded" />
        ))}
      </div>
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-6 animate-pulse">
      <div className="flex gap-6">
        <div className="h-20 w-20 rounded-full bg-stone-100 dark:bg-stone-800" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 bg-stone-100 dark:bg-stone-800 rounded" />
          <div className="grid grid-cols-5 gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-14 bg-stone-100 dark:bg-stone-800 rounded" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-40 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-100 dark:bg-stone-800"
        />
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function HeadOfficeClient() {
  const [data, setData]     = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/head-office/summary")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: SummaryResponse) => { setData(d); setLoading(false); })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, []);

  const computedAt = new Date().toISOString();

  // ── Derived panel data ──────────────────────────────────────────────────
  const storeSummaries   = data ? mapStoresToSummaries(data.stores)               : [];
  const accSummaries     = data ? mapAccountabilityToSummaries(data.accountability) : [];
  const actionStats      = data ? mapActions(data.actions)                         : [];
  const trends           = data ? mapOpsTrend(data.opsTrend)                       : { revenue: [], labour: [], risk_score: [] };
  const metrics          = computeMetrics(storeSummaries);
  const leaderboard      = buildLeaderboard(storeSummaries);
  const criticalActions  = deriveCriticalActions(accSummaries);
  const labourTrend      = "flat" as const;  // labour data not in new endpoint

  // ── Loading ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-12 rounded-xl bg-stone-200 dark:bg-stone-800 animate-pulse" />
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="h-6 w-64 bg-stone-200 dark:bg-stone-800 rounded animate-pulse" />
            <div className="h-4 w-48 bg-stone-100 dark:bg-stone-700 rounded animate-pulse" />
          </div>
        </div>
        <HeaderSkeleton />
        <GridSkeleton />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <PanelSkeleton rows={4} />
          <PanelSkeleton rows={4} />
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_2fr]">
          <PanelSkeleton rows={4} />
          <PanelSkeleton rows={5} />
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 p-6">
        <p className="text-sm font-semibold text-red-700 dark:text-red-400">
          Failed to load Head Office data
        </p>
        <p className="text-xs text-red-600 dark:text-red-500 mt-1 font-mono">{error}</p>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* 0. Global alert bar */}
      <GlobalAlertBar metrics={metrics} computedAt={computedAt} />

      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-stone-900 dark:text-stone-100 leading-tight">
            Head Office Control Tower
          </h1>
          <p className="text-xs text-stone-500 dark:text-stone-500 mt-0.5">
            Group performance across {metrics.store_count} store{metrics.store_count !== 1 ? "s" : ""}
            {" "}· Real-time
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-1 text-[11px] font-semibold text-stone-500 dark:text-stone-400">
          🏢 Executive View
        </span>
      </div>

      {/* 1. Group score header */}
      <GroupScoreHeader
        metrics={metrics}
        storeCount={metrics.store_count}
        labourTrend={labourTrend}
      />

      {/* 2. Store risk map */}
      <StoreRiskGrid stores={storeSummaries} />

      {/* 3. Accountability + Action Oversight */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <AccountabilityPanel stores={accSummaries} />
        <ActionOversightPanel stats={actionStats} criticalActions={criticalActions} />
      </div>

      {/* 4. Leaderboard + Trends */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_2fr]">
        <StoreLeaderboard entries={leaderboard} />
        <GroupTrendsPanel trends={trends} />
      </div>

    </div>
  );
}
