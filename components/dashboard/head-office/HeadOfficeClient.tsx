"use client";

/**
 * HeadOfficeClient — Command Center
 *
 * Fetches from three endpoints in parallel:
 *   /api/head-office/summary   → ops scores, tasks, accountability, trend
 *   /api/head-office/sites     → revenue, MICROS health, compliance per site
 *   /api/head-office/risk-flags → urgency flags
 *
 * Layout (addictive, mission-critical):
 *   1. Urgency banner (green / amber / red)
 *   2. Group KPI strip — Revenue · Ops Score · Task Completion · Active Alerts
 *   3. Store Mission Cards (hero full-width for 1 store, grid for 2+)
 *   4. Ops Engine — pending tasks + accountability 2-col
 *   5. Ops Reliability Center (existing)
 *   6. Risk Radar + System Health
 *   7. Group Trends + Leaderboard
 */

import { useEffect, useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import RiskRadarPanel, { type RiskFlagRow } from "./RiskRadarPanel";
import SystemHealthPanel       from "./SystemHealthPanel";
import OpsCenterPanel          from "./OpsCenterPanel";
import GroupTrendsPanel        from "./GroupTrendsPanel";
import StoreLeaderboard        from "./StoreLeaderboard";
import type {
  StoreSummary,
  GroupTrends,
  StoreLeaderboardEntry,
} from "@/services/ops/headOffice";
import type { ScoreGrade }     from "@/services/ops/operatingScore";
import type { SiteCardData }   from "@/app/api/head-office/sites/route";

// ── API response types ────────────────────────────────────────────────────────

type StoreRow = {
  id: string;
  name: string;
  site_type: string;
  deployment_stage: "live" | "partial" | "pending";
  has_pos_connection: boolean;
  score: number | null;
  grade: string;
  tasks_today: number;
  completed_today: number;
  open_maintenance: number;
  critical_maintenance: number;
};

type AccountabilityRow = {
  id: string;
  name: string;
  avg_score: number | null;
  grade: string;
  total_actions: number;
  done: number;
  completion_pct: number | null;
  overdue: number;
};

type OpsTrendRow = { date: string; site: string; avg_score: number };

type SummaryResponse = {
  stores: StoreRow[];
  accountability: AccountabilityRow[];
  actions: { id: string; name: string; total: number; done: number; late: number; completion_pct: number | null }[];
  opsTrend: OpsTrendRow[];
};

type SitesResponse = { sites: SiteCardData[]; asOf: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function gradeToScoreGrade(g: string): ScoreGrade {
  if (g === "A" || g === "B" || g === "C" || g === "D" || g === "F") return g as ScoreGrade;
  return "F";
}

function scoreToRisk(score: number | null): "red" | "yellow" | "green" {
  if (score === null) return "yellow";
  if (score < 50) return "red";
  if (score < 65) return "yellow";
  return "green";
}

function fmtCurrency(v: number | null): string {
  if (v == null) return "—";
  return `R${Math.round(v).toLocaleString("en-ZA")}`;
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${Math.round(v)}%`;
}

function staleBadge(staleMin: number | null): string {
  if (staleMin == null) return "";
  if (staleMin < 20) return "";
  if (staleMin < 60) return `${staleMin}m stale`;
  return `${(staleMin / 60).toFixed(1)}h stale`;
}

function mapOpsTrend(rows: OpsTrendRow[]): GroupTrends {
  const bysite = new Map<string, { date: string; value: number }[]>();
  for (const row of rows) {
    if (!bysite.has(row.site)) bysite.set(row.site, []);
    bysite.get(row.site)!.push({ date: row.date, value: row.avg_score });
  }
  const risk_score: { site_id: string; name: string; points: { date: string; value: number }[] }[] = [];
  bysite.forEach((points, name) => { risk_score.push({ site_id: name, name, points }); });
  return { revenue: [], labour: [], risk_score };
}

function buildLeaderboard(summaries: StoreSummary[]): StoreLeaderboardEntry[] {
  const sorted = [...summaries].sort((a, b) => (b.operating_score ?? -1) - (a.operating_score ?? -1));
  const n = sorted.length;
  const topN = Math.min(3, Math.ceil(n / 2));
  const botN = Math.min(3, Math.floor(n / 2));
  return sorted.map((s, i) => ({
    ...s,
    rank: i + 1,
    is_top: i < topN,
    is_bottom: i >= n - botN && i >= topN,
  }));
}

// ── Micro components ──────────────────────────────────────────────────────────

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", color)}>
      {children}
    </span>
  );
}

function KpiTile({
  label, value, sub, accent,
}: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-5 py-4 flex flex-col gap-1">
      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-500">{label}</p>
      <p className={cn("text-2xl font-black tabular-nums leading-none", accent ?? "text-stone-900 dark:text-stone-100")}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-stone-400 dark:text-stone-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Store Mission Card ────────────────────────────────────────────────────────

function StoreMissionCard({
  store,
  card,
}: {
  store: StoreRow;
  card: SiteCardData | null;
}) {
  const revenue   = card?.revenueTodayNet ?? null;
  const covers    = card?.guestCount ?? null;
  const stale     = card?.microsDataAgeMin ?? null;
  const staleText = staleBadge(stale);
  const compScore = card?.complianceScore ?? null;
  const taskPct   = store.tasks_today > 0
    ? Math.round((store.completed_today / store.tasks_today) * 100)
    : null;

  // Health colour
  const health = card?.healthGrade ?? "unknown";
  const healthBorder =
    health === "healthy" ? "border-l-emerald-500"
    : health === "warning" ? "border-l-amber-500"
    : health === "critical" ? "border-l-red-500"
    : "border-l-stone-300 dark:border-l-stone-700";

  const scoreColor =
    store.score === null ? "text-stone-400"
    : store.score >= 75 ? "text-emerald-500"
    : store.score >= 50 ? "text-amber-500"
    : "text-red-500";

  return (
    <div className={cn(
      "rounded-xl border-l-4 border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden",
      healthBorder,
    )}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-3">
        <div>
          <h2 className="text-base font-black text-stone-900 dark:text-stone-100 leading-tight">
            {store.name}
          </h2>
          <p className="text-[11px] text-stone-400 mt-0.5 uppercase tracking-widest">
            {store.site_type}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {staleText ? (
            <Pill color="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
              🔴 {staleText}
            </Pill>
          ) : (
            <Pill color="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
              ⚡ Live
            </Pill>
          )}
          {store.score !== null && (
            <span className={cn("text-3xl font-black tabular-nums leading-none", scoreColor)}>
              {store.score}
            </span>
          )}
        </div>
      </div>

      {/* Revenue bar */}
      {revenue !== null && (
        <div className="px-6 pb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wide">
              Revenue Today
            </span>
            <span className="text-lg font-black text-stone-900 dark:text-stone-100 tabular-nums">
              {fmtCurrency(revenue)}
            </span>
          </div>
          <div className="h-2 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-700 ease-out",
                revenue > 25_000 ? "bg-emerald-500"
                : revenue > 15_000 ? "bg-amber-500"
                : "bg-red-500",
              )}
              style={{ width: `${Math.min(100, Math.round((revenue / 30_000) * 100))}%` }}
            />
          </div>
          {covers !== null && (
            <p className="text-[10px] text-stone-400 mt-1">
              {covers} covers · {fmtCurrency(covers > 0 ? revenue / covers : null)} avg spend
            </p>
          )}
        </div>
      )}

      {/* KPI bar */}
      <div className="grid grid-cols-3 divide-x divide-stone-100 dark:divide-stone-800 border-t border-stone-100 dark:border-stone-800">
        {/* Ops task completion */}
        <div className="px-5 py-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-500">Tasks</p>
          <p className={cn(
            "text-xl font-black tabular-nums leading-none mt-1",
            taskPct === null ? "text-stone-400"
            : taskPct >= 80 ? "text-emerald-500"
            : taskPct >= 50 ? "text-amber-500"
            : "text-red-500",
          )}>
            {taskPct !== null ? `${taskPct}%` : "—"}
          </p>
          <p className="text-[10px] text-stone-400 mt-0.5">
            {store.completed_today}/{store.tasks_today} done
          </p>
        </div>

        {/* Compliance */}
        <div className="px-5 py-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-500">Compliance</p>
          <p className={cn(
            "text-xl font-black tabular-nums leading-none mt-1",
            compScore === null ? "text-stone-400"
            : compScore >= 80 ? "text-emerald-500"
            : compScore >= 60 ? "text-amber-500"
            : "text-red-500",
          )}>
            {fmtPct(compScore)}
          </p>
          {(card?.complianceOverdue ?? 0) > 0 && (
            <p className="text-[10px] text-red-500 mt-0.5">{card!.complianceOverdue} overdue</p>
          )}
        </div>

        {/* Maintenance */}
        <div className="px-5 py-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-500">Maintenance</p>
          <p className={cn(
            "text-xl font-black tabular-nums leading-none mt-1",
            store.critical_maintenance > 0 ? "text-red-500"
            : store.open_maintenance > 0 ? "text-amber-500"
            : "text-emerald-500",
          )}>
            {store.open_maintenance === 0 ? "Clear" : `${store.open_maintenance} open`}
          </p>
          {store.critical_maintenance > 0 && (
            <p className="text-[10px] text-red-500 mt-0.5">{store.critical_maintenance} critical</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Accountability row ────────────────────────────────────────────────────────

function AccountabilityCard({ stores }: { stores: AccountabilityRow[] }) {
  if (stores.length === 0) return null;

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between">
        <h3 className="text-[11px] font-black uppercase tracking-widest text-stone-500 dark:text-stone-400">
          7-Day Accountability
        </h3>
      </div>
      <div className="divide-y divide-stone-50 dark:divide-stone-800/60">
        {stores.map((s) => {
          const pct = s.completion_pct ?? 0;
          const scoreColor =
            s.avg_score === null ? "text-stone-400"
            : s.avg_score >= 75 ? "text-emerald-500"
            : s.avg_score >= 50 ? "text-amber-500"
            : "text-red-500";

          return (
            <div key={s.id} className="px-5 py-3.5 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-stone-900 dark:text-stone-100 truncate">{s.name}</p>
                <div className="flex items-center gap-3 mt-1.5">
                  <div className="flex-1 h-1.5 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        pct >= 80 ? "bg-emerald-500"
                        : pct >= 50 ? "bg-amber-500"
                        : "bg-red-400",
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-stone-400 tabular-nums shrink-0">
                    {s.done}/{s.total_actions} tasks
                  </span>
                  {s.overdue > 0 && (
                    <span className="text-[10px] text-red-500 font-bold shrink-0">
                      {s.overdue} late
                    </span>
                  )}
                </div>
              </div>
              <span className={cn("text-2xl font-black tabular-nums leading-none", scoreColor)}>
                {s.avg_score !== null ? s.avg_score : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-11 rounded-xl bg-stone-100 dark:bg-stone-800" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[0,1,2,3].map(i => (
          <div key={i} className="h-20 rounded-xl bg-stone-100 dark:bg-stone-800" />
        ))}
      </div>
      <div className="h-52 rounded-xl bg-stone-100 dark:bg-stone-800" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="h-48 rounded-xl bg-stone-100 dark:bg-stone-800" />
        <div className="h-48 rounded-xl bg-stone-100 dark:bg-stone-800" />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function HeadOfficeClient() {
  const [summary, setSummary]     = useState<SummaryResponse | null>(null);
  const [sites, setSites]         = useState<SiteCardData[]>([]);
  const [riskFlags, setRiskFlags] = useState<RiskFlagRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch("/api/head-office/summary").then(r => { if (!r.ok) throw new Error(`Summary: HTTP ${r.status}`); return r.json() as Promise<SummaryResponse>; }),
      fetch("/api/head-office/sites").then(r => r.ok ? (r.json() as Promise<SitesResponse>) : Promise.resolve({ sites: [], asOf: "" } as SitesResponse)),
      fetch("/api/head-office/risk-flags").then(r => r.ok ? r.json() : { data: [] }),
    ])
      .then(([sum, siteRes, flagRes]) => {
        setSummary(sum);
        setSites(siteRes.sites ?? []);
        setRiskFlags(Array.isArray(flagRes.data) ? flagRes.data : []);
        setLastUpdated(new Date());
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived data ──────────────────────────────────────────────────────────
  const stores = summary?.stores ?? [];
  const accountability = summary?.accountability ?? [];
  const opsTrend = useMemo(() => mapOpsTrend(summary?.opsTrend ?? []), [summary]);

  // Site card map: siteId → SiteCardData (for revenue + MICROS)
  const siteCardMap = useMemo(() => {
    const m = new Map<string, SiteCardData>();
    for (const c of sites) m.set(c.siteId, c);
    return m;
  }, [sites]);

  // Group KPIs
  const totalRevenue = sites.reduce((s, c) => s + (c.revenueTodayNet ?? 0), 0);
  const revenueStores = sites.filter(c => c.revenueTodayNet != null).length;
  const avgOpsScore = stores.length > 0
    ? Math.round(stores.filter(s => s.score !== null).reduce((a, s) => a + (s.score ?? 0), 0) / Math.max(1, stores.filter(s => s.score !== null).length))
    : null;
  const totalTasks = stores.reduce((a, s) => a + s.tasks_today, 0);
  const doneTasks  = stores.reduce((a, s) => a + s.completed_today, 0);
  const taskPctGroup = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : null;
  const criticalFlags = riskFlags.filter(f => f.severity === "critical").length;
  const warningFlags  = riskFlags.filter(f => f.severity === "warning").length;
  const totalAlerts   = criticalFlags + warningFlags;

  // Leaderboard
  const storeSummaries: StoreSummary[] = stores.map(s => ({
    site_id: s.id,
    name: s.name,
    city: "",
    operating_score: s.score,
    score_grade: gradeToScoreGrade(s.grade),
    sales_net_vat: siteCardMap.get(s.id)?.revenueTodayNet ?? null,
    revenue_target: null,
    revenue_gap_pct: null,
    labour_pct: null,
    compliance_score: siteCardMap.get(s.id)?.complianceScore ?? null,
    maintenance_score: s.open_maintenance === 0 ? 100 : s.critical_maintenance > 0 ? 0 : 50,
    risk_level: scoreToRisk(s.score),
    actions_total: s.tasks_today,
    actions_completed: s.completed_today,
    actions_overdue: 0,
    actions_completion_pct: s.tasks_today > 0 ? Math.round((s.completed_today / s.tasks_today) * 100) : null,
    snapshot_date: null,
    deployment_stage: s.deployment_stage,
  }));
  const leaderboard = buildLeaderboard(storeSummaries);

  // ── Loading / error ───────────────────────────────────────────────────────
  if (loading) return <LoadingSkeleton />;

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 p-6">
        <p className="text-sm font-semibold text-red-700 dark:text-red-400">Failed to load Head Office data</p>
        <p className="text-xs text-red-600 dark:text-red-500 mt-1 font-mono">{error}</p>
        <button onClick={load} className="mt-3 text-xs font-bold text-red-600 underline hover:text-red-700">
          Retry
        </button>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── 1. Urgency banner ──────────────────────────────────────────────── */}
      <div className={cn(
        "rounded-xl border px-5 py-3.5 flex items-center justify-between gap-4",
        criticalFlags > 0
          ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
          : warningFlags > 0
            ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
            : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800",
      )}>
        <div className="flex items-center gap-3">
          <span className="text-xl">
            {criticalFlags > 0 ? "🔥" : warningFlags > 0 ? "⚠️" : "✅"}
          </span>
          <p className={cn(
            "text-sm font-bold",
            criticalFlags > 0 ? "text-red-800 dark:text-red-300"
            : warningFlags > 0 ? "text-amber-800 dark:text-amber-300"
            : "text-emerald-800 dark:text-emerald-300",
          )}>
            {criticalFlags > 0
              ? `${criticalFlags} store${criticalFlags !== 1 ? "s" : ""} at critical risk — action required now`
              : warningFlags > 0
                ? `${warningFlags} alert${warningFlags !== 1 ? "s" : ""} need attention today`
                : `All ${stores.length} store${stores.length !== 1 ? "s" : ""} operating within targets`
            }
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {lastUpdated && (
            <p className="text-[11px] text-stone-400 hidden sm:block">
              Updated {lastUpdated.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
          <button
            onClick={load}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors",
              criticalFlags > 0
                ? "border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/20"
                : "border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800",
            )}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* ── 2. Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-stone-900 dark:text-stone-100 leading-tight">
            Command Tower
          </h1>
          <p className="text-xs text-stone-500 dark:text-stone-500 mt-0.5">
            {stores.length} store{stores.length !== 1 ? "s" : ""} · Real-time group view
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-1 text-[11px] font-semibold text-stone-500 dark:text-stone-400">
          🏢 Head Office
        </span>
      </div>

      {/* ── 3. Group KPI strip ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiTile
          label="Revenue Today"
          value={revenueStores > 0 ? fmtCurrency(totalRevenue) : "—"}
          sub={revenueStores > 0 ? `${revenueStores} store${revenueStores !== 1 ? "s" : ""} reporting` : "Awaiting sync"}
          accent={totalRevenue > 50_000 ? "text-emerald-500" : totalRevenue > 25_000 ? "text-amber-500" : undefined}
        />
        <KpiTile
          label="Ops Score"
          value={avgOpsScore !== null ? String(avgOpsScore) : "—"}
          sub="Yesterday's avg"
          accent={avgOpsScore === null ? undefined : avgOpsScore >= 75 ? "text-emerald-500" : avgOpsScore >= 50 ? "text-amber-500" : "text-red-500"}
        />
        <KpiTile
          label="Tasks Today"
          value={taskPctGroup !== null ? `${taskPctGroup}%` : "—"}
          sub={totalTasks > 0 ? `${doneTasks}/${totalTasks} completed` : "No tasks logged"}
          accent={taskPctGroup === null ? undefined : taskPctGroup >= 80 ? "text-emerald-500" : taskPctGroup >= 50 ? "text-amber-500" : "text-red-500"}
        />
        <KpiTile
          label="Active Alerts"
          value={totalAlerts === 0 ? "Clear" : String(totalAlerts)}
          sub={criticalFlags > 0 ? `${criticalFlags} critical` : warningFlags > 0 ? `${warningFlags} warning` : "No alerts"}
          accent={criticalFlags > 0 ? "text-red-500" : warningFlags > 0 ? "text-amber-500" : "text-emerald-500"}
        />
      </div>

      {/* ── 4. Store Mission Cards ──────────────────────────────────────────── */}
      {stores.length === 0 ? (
        <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/50 px-6 py-10 text-center">
          <p className="text-sm font-semibold text-stone-500">No stores found for your organisation.</p>
          <p className="text-xs text-stone-400 mt-1">Contact your administrator to assign stores to your account.</p>
        </div>
      ) : (
        <div className={cn(
          "grid gap-4",
          stores.length === 1 ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2",
        )}>
          {stores.map(store => (
            <StoreMissionCard
              key={store.id}
              store={store}
              card={siteCardMap.get(store.id) ?? null}
            />
          ))}
        </div>
      )}

      {/* ── 5. Accountability ──────────────────────────────────────────────── */}
      {accountability.length > 0 && (
        <AccountabilityCard stores={accountability} />
      )}

      {/* ── 6. Ops Reliability Center ──────────────────────────────────────── */}
      <OpsCenterPanel />

      {/* ── 7. Risk Radar + System Health ─────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <RiskRadarPanel flags={riskFlags} />
        <SystemHealthPanel />
      </div>

      {/* ── 8. Leaderboard + Trends (meaningful with 2+ stores) ───────────── */}
      {stores.length > 1 && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_2fr]">
          <StoreLeaderboard entries={leaderboard} />
          <GroupTrendsPanel trends={opsTrend} />
        </div>
      )}

    </div>
  );
}
