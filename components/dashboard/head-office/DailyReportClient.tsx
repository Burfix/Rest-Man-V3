"use client";

/**
 * DailyReportClient — Head Office Daily Accountability Report
 *
 * Two-layer report positioned as a Head Office accountability tool:
 *   Layer 1: Executive Overview (summary cards, risk distribution, narrative)
 *   Layer 2: Store Accountability Tracking (per-store duties, scores, SLA)
 *
 * Seven tabs:
 *   1. Executive Summary
 *   2. Store Comparison
 *   3. Daily Duties Tracker
 *   4. Labour & Turnover
 *   5. Maintenance & Compliance
 *   6. Guest Experience
 *   7. Risks & Escalations
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface TaskData {
  action: string;
  status: string;
  priority: string;
  department: string;
  due_time: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_minutes: number | null;
  started_by: string | null;
  start_comment: string | null;
  completion_comment: string | null;
  blocker_reason: string | null;
  escalated_to: string | null;
  evidence_urls: string[];
  sla: string | null;
  sla_met: boolean | null;
}

interface StoreSummary {
  total: number;
  completed: number;
  in_progress: number;
  blocked: number;
  escalated: number;
  missed: number;
  not_started: number;
  overdue: number;
  completion_pct: number;
  avg_duration: number | null;
  blocker_reasons: string[];
}

interface StoreFinancials {
  sales_net_vat: number | null;
  revenue_target: number | null;
  revenue_gap_pct: number | null;
  labour_pct: number | null;
  target_labour_pct: number;
  operating_score: number | null;
  score_grade: string | null;
}

interface MaintenanceIssue {
  title: string;
  priority: string;
  status: string;
  impact: string | null;
  reported: string;
}

interface ComplianceOverdueItem {
  name: string;
  category: string;
  due: string;
  critical: boolean;
}

interface NegativeReview {
  platform: string;
  rating: number;
  reviewer: string;
  text: string;
  date: string;
}

interface StoreData {
  store: string;
  siteId: string;
  city: string;
  tasks: TaskData[];
  summary: StoreSummary;
  financials: StoreFinancials;
  maintenance: {
    open_count: number;
    urgent_count: number;
    issues: MaintenanceIssue[];
  };
  compliance: {
    total: number;
    expired: number;
    due_soon: number;
    overdue_items: ComplianceOverdueItem[];
  };
  reviews: {
    total_7d: number;
    negative_count: number;
    flagged_count: number;
    avg_rating: number | null;
    negative_unanswered: NegativeReview[];
  };
  actions: {
    open_count: number;
    overdue_count: number;
  };
  riskLevel: "green" | "yellow" | "red";
}

interface GroupSummary {
  date: string;
  stores_reporting: number;
  total_tasks: number;
  completed: number;
  in_progress: number;
  blocked: number;
  escalated: number;
  missed: number;
  not_started: number;
  completion_pct: number;
  total_revenue: number | null;
  total_target: number | null;
  revenue_vs_target_pct: number | null;
  avg_labour_pct: number | null;
  stores_green: number;
  stores_yellow: number;
  stores_red: number;
  open_maintenance: number;
  overdue_compliance: number;
  negative_reviews_unanswered: number;
  total_overdue_actions: number;
}

interface DailyReport {
  date: string;
  groupSummary: GroupSummary;
  stores: StoreData[];
  narrative: string;
  generatedAt: string;
}

type TabId = "executive" | "comparison" | "duties" | "labour" | "maintenance" | "guest" | "risks";

const TABS: { id: TabId; label: string }[] = [
  { id: "executive", label: "Executive Summary" },
  { id: "comparison", label: "Store Comparison" },
  { id: "duties", label: "Daily Duties Tracker" },
  { id: "labour", label: "Labour & Turnover" },
  { id: "maintenance", label: "Maintenance & Compliance" },
  { id: "guest", label: "Guest Experience" },
  { id: "risks", label: "Risks & Escalations" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtZAR(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `R${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `R${Math.round(n / 1_000).toLocaleString()}k`;
  return `R${Math.round(n).toLocaleString()}`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function riskBadge(level: "green" | "yellow" | "red") {
  const map = {
    green: { bg: "bg-emerald-950/60 text-emerald-300 border-emerald-800/40", label: "On Track" },
    yellow: { bg: "bg-amber-950/60 text-amber-300 border-amber-800/40", label: "Attention" },
    red: { bg: "bg-red-950/60 text-red-300 border-red-800/40", label: "At Risk" },
  };
  return map[level];
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "completed": return "bg-emerald-950/60 text-emerald-300 border-emerald-800/40";
    case "started": case "in_progress": return "bg-blue-950/60 text-blue-300 border-blue-800/40";
    case "blocked": case "delayed": return "bg-red-950/60 text-red-300 border-red-800/40";
    case "escalated": return "bg-amber-950/60 text-amber-300 border-amber-800/40";
    case "missed": return "bg-red-950/80 text-red-200 border-red-800/50";
    default: return "bg-stone-800 text-stone-400 border-stone-700";
  }
}

function pctColor(pct: number, thresholds: [number, number] = [70, 90]): string {
  if (pct >= thresholds[1]) return "text-emerald-400";
  if (pct >= thresholds[0]) return "text-amber-400";
  return "text-red-400";
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function DailyReportClient() {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("executive");

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/daily-ops", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to generate report");
      setReport(data as DailyReport);
    } catch (e: any) {
      setError(e.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleExportJSON = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `daily-ops-report-${report.date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Loading / Error ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="animate-spin h-8 w-8 border-2 border-stone-400 border-t-transparent rounded-full" />
        <p className="ml-3 text-sm text-stone-400">Generating daily accountability report…</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3">
        <p className="text-sm text-red-400">{error ?? "No report data"}</p>
        <button onClick={fetchReport} className="text-xs bg-stone-800 hover:bg-stone-700 text-white px-4 py-2 rounded-lg transition-colors">
          Retry
        </button>
      </div>
    );
  }

  const g = report.groupSummary;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-stone-100">Head Office Daily Report — {report.date}</h1>
          <p className="text-xs text-stone-400 mt-0.5">
            {g.stores_reporting} store{g.stores_reporting !== 1 ? "s" : ""} ·
            Generated {new Date(report.generatedAt).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchReport} className="text-xs bg-stone-800 hover:bg-stone-700 text-stone-200 px-3 py-1.5 rounded-lg transition-colors">
            Refresh
          </button>
          <button onClick={handleExportJSON} className="text-xs bg-stone-800 hover:bg-stone-700 text-stone-200 px-3 py-1.5 rounded-lg transition-colors">
            Export
          </button>
        </div>
      </div>

      {/* Executive Summary Cards — always visible */}
      <ExecutiveCards g={g} />

      {/* Tab Navigation */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-stone-800 pb-px">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "whitespace-nowrap px-3 py-2 text-xs font-semibold transition-colors rounded-t-lg",
              activeTab === tab.id
                ? "bg-stone-800 text-stone-100 border-b-2 border-stone-100"
                : "text-stone-500 hover:text-stone-300 hover:bg-stone-800/40"
            )}
          >
            {tab.label}
            {tab.id === "risks" && g.stores_red > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center h-4 w-4 text-[9px] font-bold bg-red-600 text-white rounded-full">
                {g.stores_red}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === "executive" && <ExecutiveTab report={report} />}
        {activeTab === "comparison" && <StoreComparisonTab stores={report.stores} />}
        {activeTab === "duties" && <DailyDutiesTab stores={report.stores} />}
        {activeTab === "labour" && <LabourTurnoverTab stores={report.stores} g={g} />}
        {activeTab === "maintenance" && <MaintenanceComplianceTab stores={report.stores} />}
        {activeTab === "guest" && <GuestExperienceTab stores={report.stores} />}
        {activeTab === "risks" && <RisksEscalationsTab stores={report.stores} />}
      </div>
    </div>
  );
}

// ── Executive Summary Cards ──────────────────────────────────────────────────

function ExecutiveCards({ g }: { g: GroupSummary }) {
  return (
    <section className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-10 gap-2">
      <Tile label="Turnover" value={fmtZAR(g.total_revenue)} sub={g.total_target ? `Target: ${fmtZAR(g.total_target)}` : undefined} />
      <Tile label="vs Target" value={g.revenue_vs_target_pct != null ? `${g.revenue_vs_target_pct}%` : "—"} valueClass={g.revenue_vs_target_pct != null ? (g.revenue_vs_target_pct >= 100 ? "text-emerald-400" : g.revenue_vs_target_pct >= 90 ? "text-amber-400" : "text-red-400") : ""} />
      <Tile label="Labour %" value={g.avg_labour_pct != null ? `${g.avg_labour_pct}%` : "—"} valueClass={g.avg_labour_pct != null ? (g.avg_labour_pct <= 30 ? "text-emerald-400" : g.avg_labour_pct <= 35 ? "text-amber-400" : "text-red-400") : ""} />
      <Tile label="On Track" value={String(g.stores_green)} valueClass="text-emerald-400" />
      <Tile label="At Risk" value={String(g.stores_red)} valueClass={g.stores_red > 0 ? "text-red-400" : "text-stone-500"} />
      <Tile label="Maintenance" value={String(g.open_maintenance)} valueClass={g.open_maintenance > 0 ? "text-amber-400" : ""} sub="open issues" />
      <Tile label="Compliance" value={String(g.overdue_compliance)} valueClass={g.overdue_compliance > 0 ? "text-red-400" : ""} sub="overdue" />
      <Tile label="Reviews" value={String(g.negative_reviews_unanswered)} valueClass={g.negative_reviews_unanswered > 0 ? "text-red-400" : ""} sub="negative (7d)" />
      <Tile label="Actions" value={String(g.total_overdue_actions)} valueClass={g.total_overdue_actions > 0 ? "text-red-400" : ""} sub="overdue" />
      <Tile label="Duties" value={`${g.completion_pct}%`} valueClass={pctColor(g.completion_pct)} sub={`${g.completed}/${g.total_tasks}`} />
    </section>
  );
}

// ── Tab 1: Executive Summary ─────────────────────────────────────────────────

function ExecutiveTab({ report }: { report: DailyReport }) {
  const g = report.groupSummary;
  const sortedStores = [...report.stores].sort((a, b) => {
    const order = { red: 0, yellow: 1, green: 2 };
    return order[a.riskLevel] - order[b.riskLevel];
  });

  return (
    <div className="space-y-6">
      {/* Store Status Grid */}
      <Section title="Store Status">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {sortedStores.map((store) => (
            <StoreStatusCard key={store.siteId} store={store} />
          ))}
        </div>
      </Section>

      {/* AI Narrative */}
      {report.narrative && (
        <Section title="Operations Director Summary">
          <div className="prose prose-invert prose-sm max-w-none text-stone-300 leading-relaxed whitespace-pre-wrap">
            {report.narrative}
          </div>
        </Section>
      )}
    </div>
  );
}

function StoreStatusCard({ store }: { store: StoreData }) {
  const risk = riskBadge(store.riskLevel);
  const s = store.summary;
  const f = store.financials;

  return (
    <div className={cn("rounded-lg border overflow-hidden", store.riskLevel === "red" ? "border-red-700" : store.riskLevel === "yellow" ? "border-amber-800" : "border-stone-800")}>
      {/* Header */}
      <div className={cn("flex items-center justify-between px-3 py-2", store.riskLevel === "red" ? "bg-red-950/40" : store.riskLevel === "yellow" ? "bg-amber-950/20" : "bg-emerald-950/20")}>
        <div>
          <span className="text-xs font-bold text-stone-100">{store.store}</span>
          <span className="ml-2 text-[10px] text-stone-500">{store.city}</span>
        </div>
        <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border", risk.bg)}>{risk.label}</span>
      </div>
      {/* Body */}
      <div className="p-3 space-y-2 bg-stone-900/50">
        {/* Completion bar */}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-stone-400">Duties</span>
          <span className={cn("font-bold", pctColor(s.completion_pct))}>{s.completion_pct}% ({s.completed}/{s.total})</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-stone-800 overflow-hidden">
          <div className={cn("h-1.5 rounded-full transition-all", s.completion_pct >= 90 ? "bg-emerald-500" : s.completion_pct >= 70 ? "bg-amber-400" : "bg-red-500")} style={{ width: `${s.completion_pct}%` }} />
        </div>
        {/* Quick metrics */}
        <div className="grid grid-cols-3 gap-2 text-[10px]">
          <div>
            <span className="text-stone-500">Blocked</span>
            <div className={cn("font-bold", s.blocked > 0 ? "text-red-400" : "text-stone-600")}>{s.blocked}</div>
          </div>
          <div>
            <span className="text-stone-500">Overdue</span>
            <div className={cn("font-bold", s.overdue > 0 ? "text-red-400" : "text-stone-600")}>{s.overdue}</div>
          </div>
          <div>
            <span className="text-stone-500">Missed</span>
            <div className={cn("font-bold", s.missed > 0 ? "text-red-500" : "text-stone-600")}>{s.missed}</div>
          </div>
        </div>
        {/* Financial row */}
        <div className="flex items-center justify-between text-[10px] border-t border-stone-800 pt-2">
          <div>
            <span className="text-stone-500">Revenue</span>
            <div className="text-stone-300 font-medium">{fmtZAR(f.sales_net_vat)}</div>
          </div>
          <div className="text-right">
            <span className="text-stone-500">Labour</span>
            <div className={cn("font-bold", f.labour_pct != null ? (f.labour_pct <= f.target_labour_pct ? "text-emerald-400" : f.labour_pct <= f.target_labour_pct + 5 ? "text-amber-400" : "text-red-400") : "text-stone-600")}>
              {f.labour_pct != null ? `${f.labour_pct}%` : "—"}
            </div>
          </div>
          <div className="text-right">
            <span className="text-stone-500">Score</span>
            <div className="text-stone-200 font-bold">{f.operating_score ?? "—"}{f.score_grade ? ` ${f.score_grade}` : ""}</div>
          </div>
        </div>
        {/* Issue flags */}
        <div className="flex flex-wrap gap-1.5">
          {store.maintenance.urgent_count > 0 && <MiniFlag label={`${store.maintenance.urgent_count} urgent maint.`} color="red" />}
          {store.compliance.expired > 0 && <MiniFlag label={`${store.compliance.expired} expired compliance`} color="red" />}
          {store.reviews.negative_count > 0 && <MiniFlag label={`${store.reviews.negative_count} neg. reviews`} color="amber" />}
          {store.actions.overdue_count > 0 && <MiniFlag label={`${store.actions.overdue_count} overdue actions`} color="amber" />}
        </div>
      </div>
    </div>
  );
}

function MiniFlag({ label, color }: { label: string; color: "red" | "amber" | "blue" }) {
  const cls = color === "red" ? "bg-red-950/60 text-red-300 border-red-800/40" : color === "amber" ? "bg-amber-950/60 text-amber-300 border-amber-800/40" : "bg-blue-950/60 text-blue-300 border-blue-800/40";
  return <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded border", cls)}>{label}</span>;
}

// ── Tab 2: Store Comparison ──────────────────────────────────────────────────

function StoreComparisonTab({ stores }: { stores: StoreData[] }) {
  const [sortBy, setSortBy] = useState<"completion" | "revenue" | "labour" | "risk">("completion");

  const sorted = useMemo(() => {
    const copy = [...stores];
    switch (sortBy) {
      case "completion": return copy.sort((a, b) => a.summary.completion_pct - b.summary.completion_pct);
      case "revenue": return copy.sort((a, b) => (a.financials.sales_net_vat ?? 0) - (b.financials.sales_net_vat ?? 0));
      case "labour": return copy.sort((a, b) => (b.financials.labour_pct ?? 0) - (a.financials.labour_pct ?? 0));
      case "risk": {
        const order = { red: 0, yellow: 1, green: 2 };
        return copy.sort((a, b) => order[a.riskLevel] - order[b.riskLevel]);
      }
    }
  }, [stores, sortBy]);

  return (
    <Section title="Store Comparison">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[10px] text-stone-500 uppercase tracking-wider">Sort by:</span>
        {(["completion", "revenue", "labour", "risk"] as const).map((key) => (
          <button key={key} onClick={() => setSortBy(key)} className={cn("text-[10px] px-2 py-1 rounded-md transition-colors", sortBy === key ? "bg-stone-700 text-stone-100" : "text-stone-500 hover:text-stone-300")}>
            {key === "completion" ? "Duties %" : key === "revenue" ? "Revenue" : key === "labour" ? "Labour %" : "Risk"}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-stone-800/50 text-stone-500">
              <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Store</th>
              <th className="px-3 py-2 text-center font-semibold text-[10px] uppercase tracking-wide">Risk</th>
              <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Duties %</th>
              <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Completed</th>
              <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Blocked</th>
              <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Overdue</th>
              <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Revenue</th>
              <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">vs Target</th>
              <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Labour %</th>
              <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Score</th>
              <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Maintenance</th>
              <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Compliance</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((store) => {
              const risk = riskBadge(store.riskLevel);
              const f = store.financials;
              return (
                <tr key={store.siteId} className={cn("border-b border-stone-800/30", store.riskLevel === "red" ? "bg-red-950/10" : "")}>
                  <td className="px-3 py-2.5 font-medium text-stone-200">{store.store}</td>
                  <td className="px-3 py-2.5 text-center"><span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border", risk.bg)}>{risk.label}</span></td>
                  <td className={cn("px-3 py-2.5 text-right font-bold", pctColor(store.summary.completion_pct))}>{store.summary.completion_pct}%</td>
                  <td className="px-3 py-2.5 text-right text-stone-400">{store.summary.completed}/{store.summary.total}</td>
                  <td className={cn("px-3 py-2.5 text-right font-medium", store.summary.blocked > 0 ? "text-red-400" : "text-stone-600")}>{store.summary.blocked}</td>
                  <td className={cn("px-3 py-2.5 text-right font-medium", store.summary.overdue > 0 ? "text-red-400" : "text-stone-600")}>{store.summary.overdue}</td>
                  <td className="px-3 py-2.5 text-right text-stone-300">{fmtZAR(f.sales_net_vat)}</td>
                  <td className={cn("px-3 py-2.5 text-right font-medium", f.revenue_gap_pct != null ? (f.revenue_gap_pct <= 0 ? "text-emerald-400" : f.revenue_gap_pct <= 10 ? "text-amber-400" : "text-red-400") : "text-stone-600")}>
                    {f.revenue_gap_pct != null ? (f.revenue_gap_pct <= 0 ? `+${Math.abs(f.revenue_gap_pct).toFixed(1)}%` : `-${f.revenue_gap_pct.toFixed(1)}%`) : "—"}
                  </td>
                  <td className={cn("px-3 py-2.5 text-right font-medium", f.labour_pct != null ? (f.labour_pct <= f.target_labour_pct ? "text-emerald-400" : f.labour_pct <= f.target_labour_pct + 5 ? "text-amber-400" : "text-red-400") : "text-stone-600")}>
                    {f.labour_pct != null ? `${f.labour_pct}%` : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right text-stone-300 font-bold">{f.operating_score ?? "—"}</td>
                  <td className={cn("px-3 py-2.5 text-right font-medium", store.maintenance.open_count > 0 ? "text-amber-400" : "text-stone-600")}>{store.maintenance.open_count}</td>
                  <td className={cn("px-3 py-2.5 text-right font-medium", store.compliance.expired > 0 ? "text-red-400" : "text-stone-600")}>{store.compliance.expired}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ── Tab 3: Daily Duties Tracker ──────────────────────────────────────────────

function DailyDutiesTab({ stores }: { stores: StoreData[] }) {
  const [filterStore, setFilterStore] = useState<string>("all");
  const [filterDuty, setFilterDuty] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [sortField, setSortField] = useState<"store" | "status" | "overdue" | "blocked">("store");

  // Flatten all tasks with store context
  const allRows = useMemo(() => {
    const rows: (TaskData & { storeName: string; siteId: string })[] = [];
    for (const store of stores) {
      for (const task of store.tasks) {
        rows.push({ ...task, storeName: store.store, siteId: store.siteId });
      }
    }
    return rows;
  }, [stores]);

  const dutyNames = useMemo(() => Array.from(new Set(allRows.map((r) => r.action))).sort(), [allRows]);
  const storeNames = useMemo(() => stores.map((s) => s.store).sort(), [stores]);

  const filtered = useMemo(() => {
    let rows = allRows;
    if (filterStore !== "all") rows = rows.filter((r) => r.storeName === filterStore);
    if (filterDuty !== "all") rows = rows.filter((r) => r.action === filterDuty);
    if (filterStatus !== "all") rows = rows.filter((r) => r.status === filterStatus);

    switch (sortField) {
      case "overdue": return [...rows].sort((a, b) => (a.sla_met === false ? 0 : 1) - (b.sla_met === false ? 0 : 1));
      case "blocked": return [...rows].sort((a, b) => (["blocked", "delayed"].includes(a.status) ? 0 : 1) - (["blocked", "delayed"].includes(b.status) ? 0 : 1));
      case "status": return [...rows].sort((a, b) => {
        const order: Record<string, number> = { missed: 0, blocked: 1, delayed: 1, escalated: 2, not_started: 3, started: 4, in_progress: 4, completed: 5 };
        return (order[a.status] ?? 6) - (order[b.status] ?? 6);
      });
      default: return [...rows].sort((a, b) => a.storeName.localeCompare(b.storeName));
    }
  }, [allRows, filterStore, filterDuty, filterStatus, sortField]);

  return (
    <Section title="Daily Duties Tracker — All Stores">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <FilterSelect label="Store" value={filterStore} onChange={setFilterStore} options={[{ value: "all", label: "All Stores" }, ...storeNames.map((n) => ({ value: n, label: n }))]} />
        <FilterSelect label="Duty" value={filterDuty} onChange={setFilterDuty} options={[{ value: "all", label: "All Duties" }, ...dutyNames.map((n) => ({ value: n, label: n }))]} />
        <FilterSelect label="Status" value={filterStatus} onChange={setFilterStatus} options={[
          { value: "all", label: "All Statuses" },
          { value: "completed", label: "Completed" },
          { value: "started", label: "In Progress" },
          { value: "blocked", label: "Blocked" },
          { value: "escalated", label: "Escalated" },
          { value: "missed", label: "Missed" },
          { value: "not_started", label: "Not Started" },
        ]} />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-stone-500">Sort:</span>
          {(["store", "status", "overdue", "blocked"] as const).map((key) => (
            <button key={key} onClick={() => setSortField(key)} className={cn("text-[10px] px-2 py-1 rounded-md transition-colors", sortField === key ? "bg-stone-700 text-stone-100" : "text-stone-500 hover:text-stone-300")}>
              {key === "store" ? "Store" : key === "status" ? "Status" : key === "overdue" ? "SLA" : "Blocked"}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-stone-800/50 text-stone-500">
              <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Store</th>
              <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Duty</th>
              <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Manager</th>
              <th className="px-3 py-2 text-center font-semibold text-[10px] uppercase tracking-wide">Status</th>
              <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Started</th>
              <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Completed</th>
              <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Duration</th>
              <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Comments</th>
              <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Blocker</th>
              <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Escalated To</th>
              <th className="px-3 py-2 text-center font-semibold text-[10px] uppercase tracking-wide">SLA</th>
              <th className="px-3 py-2 text-center font-semibold text-[10px] uppercase tracking-wide">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <tr key={`${row.siteId}-${row.action}-${i}`} className={cn("border-b border-stone-800/30", row.status === "blocked" || row.status === "missed" ? "bg-red-950/10" : "")}>
                <td className="px-3 py-2 text-stone-300 font-medium">{row.storeName}</td>
                <td className="px-3 py-2 text-stone-200">{row.action}</td>
                <td className="px-3 py-2 text-stone-400">{row.started_by ?? "—"}</td>
                <td className="px-3 py-2 text-center">
                  <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border", statusBadgeClass(row.status))}>
                    {row.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-3 py-2 text-stone-400">{fmtTime(row.started_at)}</td>
                <td className="px-3 py-2 text-stone-400">{fmtTime(row.completed_at)}</td>
                <td className="px-3 py-2 text-right text-stone-400">{row.duration_minutes != null ? `${row.duration_minutes}m` : "—"}</td>
                <td className="px-3 py-2 text-stone-500 max-w-[160px] truncate">{row.start_comment || row.completion_comment || "—"}</td>
                <td className="px-3 py-2 text-red-400 max-w-[140px] truncate">{row.blocker_reason || "—"}</td>
                <td className="px-3 py-2 text-amber-400">{row.escalated_to || "—"}</td>
                <td className="px-3 py-2 text-center">
                  {row.sla_met === true ? <span className="text-emerald-400 font-bold">Met</span> :
                   row.sla_met === false ? <span className="text-red-400 font-bold">Missed</span> :
                   <span className="text-stone-600">—</span>}
                </td>
                <td className="px-3 py-2 text-center text-stone-500">
                  {row.evidence_urls.length > 0 ? <span className="text-blue-400">{row.evidence_urls.length} file{row.evidence_urls.length !== 1 ? "s" : ""}</span> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-8 text-center text-sm text-stone-500">No duties match the selected filters.</div>
        )}
      </div>
      <div className="mt-3 text-[10px] text-stone-500">{filtered.length} of {allRows.length} duties shown</div>
    </Section>
  );
}

// ── Tab 4: Labour & Turnover ─────────────────────────────────────────────────

function LabourTurnoverTab({ stores, g }: { stores: StoreData[]; g: GroupSummary }) {
  const sorted = [...stores].sort((a, b) => (b.financials.labour_pct ?? 0) - (a.financials.labour_pct ?? 0));

  return (
    <div className="space-y-6">
      {/* Group totals */}
      <Section title="Group Labour & Revenue Summary">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile label="Total Turnover" value={fmtZAR(g.total_revenue)} />
          <Tile label="Revenue Target" value={fmtZAR(g.total_target)} />
          <Tile label="vs Target" value={g.revenue_vs_target_pct != null ? `${g.revenue_vs_target_pct}%` : "—"} valueClass={g.revenue_vs_target_pct != null ? (g.revenue_vs_target_pct >= 100 ? "text-emerald-400" : "text-amber-400") : ""} />
          <Tile label="Avg Labour %" value={g.avg_labour_pct != null ? `${g.avg_labour_pct}%` : "—"} valueClass={g.avg_labour_pct != null ? (g.avg_labour_pct <= 30 ? "text-emerald-400" : g.avg_labour_pct <= 35 ? "text-amber-400" : "text-red-400") : ""} />
        </div>
      </Section>

      {/* Per-store breakdown */}
      <Section title="Store Labour & Revenue Breakdown">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-stone-800/50 text-stone-500">
                <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Store</th>
                <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Revenue</th>
                <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Target</th>
                <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Gap</th>
                <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Labour %</th>
                <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Target Labour</th>
                <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Score</th>
                <th className="px-3 py-2 text-center font-semibold text-[10px] uppercase tracking-wide">Grade</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((store) => {
                const f = store.financials;
                return (
                  <tr key={store.siteId} className="border-b border-stone-800/30">
                    <td className="px-3 py-2.5 font-medium text-stone-200">{store.store}</td>
                    <td className="px-3 py-2.5 text-right text-stone-300">{fmtZAR(f.sales_net_vat)}</td>
                    <td className="px-3 py-2.5 text-right text-stone-500">{fmtZAR(f.revenue_target)}</td>
                    <td className={cn("px-3 py-2.5 text-right font-medium", f.revenue_gap_pct != null ? (f.revenue_gap_pct <= 0 ? "text-emerald-400" : "text-red-400") : "text-stone-600")}>
                      {f.revenue_gap_pct != null ? (f.revenue_gap_pct <= 0 ? `+${Math.abs(f.revenue_gap_pct).toFixed(1)}%` : `-${f.revenue_gap_pct.toFixed(1)}%`) : "—"}
                    </td>
                    <td className={cn("px-3 py-2.5 text-right font-bold", f.labour_pct != null ? (f.labour_pct <= f.target_labour_pct ? "text-emerald-400" : f.labour_pct <= f.target_labour_pct + 5 ? "text-amber-400" : "text-red-400") : "text-stone-600")}>
                      {f.labour_pct != null ? `${f.labour_pct}%` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-stone-500">{f.target_labour_pct}%</td>
                    <td className="px-3 py-2.5 text-right text-stone-200 font-bold">{f.operating_score ?? "—"}</td>
                    <td className={cn("px-3 py-2.5 text-center font-black", f.score_grade ? {
                      "text-emerald-400": f.score_grade === "A",
                      "text-lime-400": f.score_grade === "B",
                      "text-amber-400": f.score_grade === "C",
                      "text-orange-400": f.score_grade === "D",
                      "text-red-400": f.score_grade === "F",
                    }[f.score_grade] ?? "" : "text-stone-600")}>
                      {f.score_grade ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

// ── Tab 5: Maintenance & Compliance ──────────────────────────────────────────

function MaintenanceComplianceTab({ stores }: { stores: StoreData[] }) {
  const totalMaint = stores.reduce((s, st) => s + st.maintenance.open_count, 0);
  const totalUrgent = stores.reduce((s, st) => s + st.maintenance.urgent_count, 0);
  const totalExpired = stores.reduce((s, st) => s + st.compliance.expired, 0);
  const totalDueSoon = stores.reduce((s, st) => s + st.compliance.due_soon, 0);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Open Maintenance" value={String(totalMaint)} valueClass={totalMaint > 0 ? "text-amber-400" : ""} />
        <Tile label="Urgent / High" value={String(totalUrgent)} valueClass={totalUrgent > 0 ? "text-red-400" : ""} />
        <Tile label="Expired Compliance" value={String(totalExpired)} valueClass={totalExpired > 0 ? "text-red-400" : ""} />
        <Tile label="Due in 30 Days" value={String(totalDueSoon)} valueClass={totalDueSoon > 0 ? "text-amber-400" : ""} />
      </section>

      {/* Maintenance by store */}
      <Section title="Open Maintenance Issues">
        {stores.filter((s) => s.maintenance.open_count > 0).length === 0 ? (
          <p className="text-sm text-stone-500">No open maintenance issues.</p>
        ) : (
          <div className="space-y-3">
            {stores.filter((s) => s.maintenance.open_count > 0).map((store) => (
              <div key={store.siteId} className="rounded-lg border border-stone-800 overflow-hidden">
                <div className="px-3 py-2 bg-stone-800/40 flex items-center justify-between">
                  <span className="text-xs font-bold text-stone-200">{store.store}</span>
                  <span className="text-[10px] text-stone-400">{store.maintenance.open_count} issue{store.maintenance.open_count !== 1 ? "s" : ""}</span>
                </div>
                <div className="divide-y divide-stone-800/30">
                  {store.maintenance.issues.map((issue, i) => (
                    <div key={i} className="px-3 py-2 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className={cn("h-2 w-2 rounded-full", issue.priority === "urgent" ? "bg-red-500" : issue.priority === "high" ? "bg-amber-400" : "bg-stone-500")} />
                        <span className="text-stone-300">{issue.title}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px]">
                        <span className={cn("uppercase font-bold", issue.priority === "urgent" ? "text-red-400" : issue.priority === "high" ? "text-amber-400" : "text-stone-500")}>{issue.priority}</span>
                        <span className="text-stone-500">{issue.status}</span>
                        {issue.impact && <span className="text-stone-600">{issue.impact}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Overdue compliance */}
      <Section title="Overdue Compliance Items">
        {stores.filter((s) => s.compliance.expired > 0).length === 0 ? (
          <p className="text-sm text-stone-500">No overdue compliance items.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-stone-800/50 text-stone-500">
                  <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Store</th>
                  <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Item</th>
                  <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Category</th>
                  <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Expired Since</th>
                  <th className="px-3 py-2 text-center font-semibold text-[10px] uppercase tracking-wide">Critical</th>
                </tr>
              </thead>
              <tbody>
                {stores.flatMap((store) =>
                  store.compliance.overdue_items.map((item, i) => (
                    <tr key={`${store.siteId}-${i}`} className={cn("border-b border-stone-800/30", item.critical ? "bg-red-950/10" : "")}>
                      <td className="px-3 py-2 text-stone-300 font-medium">{store.store}</td>
                      <td className="px-3 py-2 text-stone-200">{item.name}</td>
                      <td className="px-3 py-2 text-stone-400">{item.category}</td>
                      <td className="px-3 py-2 text-red-400">{item.due}</td>
                      <td className="px-3 py-2 text-center">{item.critical ? <span className="text-red-400 font-bold">Yes</span> : <span className="text-stone-600">No</span>}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Tab 6: Guest Experience ──────────────────────────────────────────────────

function GuestExperienceTab({ stores }: { stores: StoreData[] }) {
  const totalNegative = stores.reduce((s, st) => s + st.reviews.negative_count, 0);
  const totalReviews = stores.reduce((s, st) => s + st.reviews.total_7d, 0);
  const storesWithRatings = stores.filter((s) => s.reviews.avg_rating != null);
  const avgRating = storesWithRatings.length > 0
    ? Math.round((storesWithRatings.reduce((s, st) => s + (st.reviews.avg_rating ?? 0), 0) / storesWithRatings.length) * 10) / 10
    : null;

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Total Reviews (7d)" value={String(totalReviews)} />
        <Tile label="Avg Rating" value={avgRating != null ? `${avgRating}/5` : "—"} valueClass={avgRating != null ? (avgRating >= 4 ? "text-emerald-400" : avgRating >= 3 ? "text-amber-400" : "text-red-400") : ""} />
        <Tile label="Negative" value={String(totalNegative)} valueClass={totalNegative > 0 ? "text-red-400" : ""} />
        <Tile label="Flagged" value={String(stores.reduce((s, st) => s + st.reviews.flagged_count, 0))} valueClass="text-amber-400" />
      </section>

      {/* Per-store review summary */}
      <Section title="Store Review Performance (7 days)">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-stone-800/50 text-stone-500">
                <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Store</th>
                <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Reviews</th>
                <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Avg Rating</th>
                <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Negative</th>
                <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Flagged</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((store) => (
                <tr key={store.siteId} className="border-b border-stone-800/30">
                  <td className="px-3 py-2.5 font-medium text-stone-200">{store.store}</td>
                  <td className="px-3 py-2.5 text-right text-stone-400">{store.reviews.total_7d}</td>
                  <td className={cn("px-3 py-2.5 text-right font-bold", store.reviews.avg_rating != null ? (store.reviews.avg_rating >= 4 ? "text-emerald-400" : store.reviews.avg_rating >= 3 ? "text-amber-400" : "text-red-400") : "text-stone-600")}>
                    {store.reviews.avg_rating ?? "—"}
                  </td>
                  <td className={cn("px-3 py-2.5 text-right font-medium", store.reviews.negative_count > 0 ? "text-red-400" : "text-stone-600")}>{store.reviews.negative_count}</td>
                  <td className={cn("px-3 py-2.5 text-right font-medium", store.reviews.flagged_count > 0 ? "text-amber-400" : "text-stone-600")}>{store.reviews.flagged_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Negative reviews needing attention */}
      <Section title="Negative Reviews Requiring Response">
        {stores.flatMap((s) => s.reviews.negative_unanswered).length === 0 ? (
          <p className="text-sm text-stone-500">No negative reviews in the last 7 days.</p>
        ) : (
          <div className="space-y-3">
            {stores.filter((s) => s.reviews.negative_unanswered.length > 0).map((store) => (
              <div key={store.siteId}>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-2">{store.store}</h3>
                <div className="space-y-2">
                  {store.reviews.negative_unanswered.map((rev, i) => (
                    <div key={i} className="rounded-lg border border-stone-800 p-3 bg-red-950/10">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-stone-300 font-medium">{rev.reviewer}</span>
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="text-stone-500">{rev.platform}</span>
                          <span className="text-red-400 font-bold">{rev.rating}/5</span>
                          <span className="text-stone-600">{rev.date}</span>
                        </div>
                      </div>
                      <p className="text-xs text-stone-400 line-clamp-2">{rev.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Tab 7: Risks & Escalations ───────────────────────────────────────────────

function RisksEscalationsTab({ stores }: { stores: StoreData[] }) {
  const redStores = stores.filter((s) => s.riskLevel === "red");
  const yellowStores = stores.filter((s) => s.riskLevel === "yellow");
  const escalatedTasks = stores.flatMap((s) => s.tasks.filter((t) => t.status === "escalated").map((t) => ({ ...t, storeName: s.store })));
  const blockedTasks = stores.flatMap((s) => s.tasks.filter((t) => ["blocked", "delayed"].includes(t.status)).map((t) => ({ ...t, storeName: s.store })));

  return (
    <div className="space-y-6">
      {/* Risk summary */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Red Stores" value={String(redStores.length)} valueClass={redStores.length > 0 ? "text-red-400" : ""} />
        <Tile label="Yellow Stores" value={String(yellowStores.length)} valueClass={yellowStores.length > 0 ? "text-amber-400" : ""} />
        <Tile label="Escalated Duties" value={String(escalatedTasks.length)} valueClass={escalatedTasks.length > 0 ? "text-amber-400" : ""} />
        <Tile label="Blocked Duties" value={String(blockedTasks.length)} valueClass={blockedTasks.length > 0 ? "text-red-400" : ""} />
      </section>

      {/* Red stores detail */}
      {redStores.length > 0 && (
        <Section title="Stores Requiring Intervention">
          <div className="space-y-3">
            {redStores.map((store) => (
              <div key={store.siteId} className="rounded-lg border border-red-800/50 bg-red-950/20 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-red-300">{store.store}</h3>
                    <p className="text-[10px] text-stone-400">{store.city}</p>
                  </div>
                  <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded border bg-red-950/60 text-red-300 border-red-800/40">At Risk</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
                  <div>
                    <span className="text-stone-500 text-[10px]">Duties Complete</span>
                    <div className={cn("font-bold", pctColor(store.summary.completion_pct))}>{store.summary.completion_pct}%</div>
                  </div>
                  <div>
                    <span className="text-stone-500 text-[10px]">Blocked</span>
                    <div className="text-red-400 font-bold">{store.summary.blocked}</div>
                  </div>
                  <div>
                    <span className="text-stone-500 text-[10px]">Missed</span>
                    <div className="text-red-500 font-bold">{store.summary.missed}</div>
                  </div>
                  <div>
                    <span className="text-stone-500 text-[10px]">Overdue</span>
                    <div className="text-red-400 font-bold">{store.summary.overdue}</div>
                  </div>
                </div>
                {/* Incomplete tasks */}
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Incomplete Duties:</span>
                  {store.tasks.filter((t) => t.status !== "completed").map((t, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-stone-800/20">
                      <div className="flex items-center gap-2">
                        <span className={cn("text-[9px] font-bold uppercase px-1 py-0.5 rounded border", statusBadgeClass(t.status))}>{t.status.replace(/_/g, " ")}</span>
                        <span className="text-stone-300">{t.action}</span>
                      </div>
                      <div className="text-[10px] text-stone-500">
                        {t.blocker_reason && <span className="text-red-400 mr-2">Blocked: {t.blocker_reason}</span>}
                        {t.started_by && <span>by {t.started_by}</span>}
                      </div>
                    </div>
                  ))}
                </div>
                {/* Blocker themes */}
                {store.summary.blocker_reasons.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-stone-800/30">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Blocker Themes:</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {store.summary.blocker_reasons.map((reason, i) => (
                        <span key={i} className="text-[9px] bg-red-950/40 text-red-300 border border-red-800/30 px-1.5 py-0.5 rounded">{reason}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Yellow stores summary */}
      {yellowStores.length > 0 && (
        <Section title="Stores Needing Attention">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-stone-800/50 text-stone-500">
                  <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Store</th>
                  <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Duties %</th>
                  <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Blocked</th>
                  <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wide">Overdue</th>
                  <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Issues</th>
                </tr>
              </thead>
              <tbody>
                {yellowStores.map((store) => (
                  <tr key={store.siteId} className="border-b border-stone-800/30 bg-amber-950/5">
                    <td className="px-3 py-2.5 font-medium text-stone-200">{store.store}</td>
                    <td className={cn("px-3 py-2.5 text-right font-bold", pctColor(store.summary.completion_pct))}>{store.summary.completion_pct}%</td>
                    <td className={cn("px-3 py-2.5 text-right", store.summary.blocked > 0 ? "text-red-400" : "text-stone-600")}>{store.summary.blocked}</td>
                    <td className={cn("px-3 py-2.5 text-right", store.summary.overdue > 0 ? "text-red-400" : "text-stone-600")}>{store.summary.overdue}</td>
                    <td className="px-3 py-2.5 text-stone-400 text-[10px]">
                      {[
                        store.maintenance.open_count > 0 && `${store.maintenance.open_count} maint.`,
                        store.compliance.expired > 0 && `${store.compliance.expired} compliance`,
                        store.reviews.negative_count > 0 && `${store.reviews.negative_count} neg. reviews`,
                      ].filter(Boolean).join(" · ") || "Minor delays"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Escalated tasks */}
      {escalatedTasks.length > 0 && (
        <Section title="Escalated Duties">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-stone-800/50 text-stone-500">
                  <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Store</th>
                  <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Duty</th>
                  <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Escalated To</th>
                  <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Manager</th>
                  <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide">Reason</th>
                </tr>
              </thead>
              <tbody>
                {escalatedTasks.map((t, i) => (
                  <tr key={i} className="border-b border-stone-800/30">
                    <td className="px-3 py-2 text-stone-300 font-medium">{t.storeName}</td>
                    <td className="px-3 py-2 text-stone-200">{t.action}</td>
                    <td className="px-3 py-2 text-amber-400">{t.escalated_to || "—"}</td>
                    <td className="px-3 py-2 text-stone-400">{t.started_by || "—"}</td>
                    <td className="px-3 py-2 text-stone-500 max-w-[200px] truncate">{t.blocker_reason || t.start_comment || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* All good scenario */}
      {redStores.length === 0 && yellowStores.length === 0 && escalatedTasks.length === 0 && blockedTasks.length === 0 && (
        <Section title="Status">
          <div className="py-8 text-center">
            <p className="text-emerald-400 font-bold text-sm">All stores operating within acceptable parameters.</p>
            <p className="text-xs text-stone-500 mt-1">No intervention required today.</p>
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Shared Subcomponents ─────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-stone-800 bg-stone-900 overflow-hidden">
      <div className="border-b border-stone-800 px-5 py-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-stone-300">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Tile({ label, value, valueClass, sub }: { label: string; value: string; valueClass?: string; sub?: string }) {
  return (
    <div className="bg-stone-800/60 rounded-lg px-3 py-2.5">
      <div className="text-[10px] text-stone-400">{label}</div>
      <div className={cn("text-lg font-bold text-stone-100 mt-0.5 leading-tight", valueClass)}>{value}</div>
      {sub && <div className="text-[9px] text-stone-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-stone-500">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-[11px] bg-stone-800 text-stone-300 border border-stone-700 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-stone-600"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
