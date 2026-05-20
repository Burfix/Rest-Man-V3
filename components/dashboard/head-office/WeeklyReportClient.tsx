"use client";

/**
 * WeeklyReportClient
 *
 * Full weekly performance report viewer.
 * Triggered from the Head Office reports page.
 * Fetches data on-mount and renders:
 *   - Executive summary tiles
 *   - Store ranking table
 *   - GM performance table
 *   - Impact summary
 *   - Service insights
 *   - Interventions list
 *   - Next week focus
 *   - Export JSON + send email controls
 */

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import type {
  WeeklyReport,
  TrendDirection,
  StoreWeeklyRank,
  GMWeeklyPerformance,
  InterventionItem,
  FocusItem,
} from "@/types/weekly-report";

// ── Helpers ────────────────────────────────────────────────────────────────────

const CURRENCY = "R";

function money(v: number | null): string {
  if (v == null) return "—";
  return `${CURRENCY}${Math.abs(v).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

function pct(v: number | null): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}

function arrow(t: TrendDirection): string {
  if (t === "up") return "↑";
  if (t === "down") return "↓";
  return "→";
}

function trendCls(t: TrendDirection, inverseIsGood = false): string {
  if (t === "up") return inverseIsGood ? "text-red-500" : "text-emerald-500";
  if (t === "down") return inverseIsGood ? "text-emerald-500" : "text-red-500";
  return "text-stone-500 dark:text-stone-400";
}

function gradeCls(grade: string | null): string {
  if (!grade) return "text-stone-500 dark:text-stone-400";
  if (grade === "A") return "text-emerald-500";
  if (grade === "B") return "text-blue-500";
  if (grade === "C") return "text-amber-500";
  if (grade === "D") return "text-orange-500";
  return "text-red-500";
}

function gradeFromScore(s: number | null): string {
  if (s == null) return "—";
  if (s >= 85) return "A";
  if (s >= 70) return "B";
  if (s >= 55) return "C";
  if (s >= 40) return "D";
  return "F";
}

function severityCls(sev: string): string {
  if (sev === "critical") return "bg-red-950/60 border-red-900/50";
  if (sev === "high") return "bg-amber-950/40 border-amber-900/40";
  return "bg-stone-100 dark:bg-stone-800/50 border-stone-300 dark:border-stone-700/40";
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function WeeklyReportClient() {
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [emailField, setEmailField] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/weekly", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to generate report");
      setReport(data.report);
    } catch (e: any) {
      setError(e.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const handleSendEmail = async () => {
    if (!emailField.trim() || !report) return;
    setSending(true);
    try {
      const recipients = emailField.split(",").map((e) => e.trim()).filter(Boolean);
      const res = await fetch("/api/reports/weekly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendEmail: true, recipients }),
      });
      const data = await res.json();
      if (data.emailSent) setEmailSent(true);
    } catch { /* ignore */ } finally {
      setSending(false);
    }
  };

  const handleExportJSON = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `weekly-report-W${report.weekRange.weekNumber}-${report.weekRange.year}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Loading / Error states ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="animate-spin h-8 w-8 border-2 border-stone-400 border-t-transparent rounded-full" />
        <p className="ml-3 text-sm text-stone-500 dark:text-stone-400">Generating weekly report…</p>
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

  const s = report.summary;
  const { storeRanking, gmPerformance, impactSummary, serviceInsights, interventionList, nextWeekFocus } = report;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-stone-900 dark:text-stone-100">
            📊 Weekly Report — W{report.weekRange.weekNumber}/{report.weekRange.year}
          </h1>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
            {report.weekRange.start} → {report.weekRange.end}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchReport} className="text-xs bg-stone-100 dark:bg-stone-800 hover:bg-stone-700 text-stone-700 dark:text-stone-200 px-3 py-1.5 rounded-lg transition-colors">
            ↻ Refresh
          </button>
          <button onClick={handleExportJSON} className="text-xs bg-stone-100 dark:bg-stone-800 hover:bg-stone-700 text-stone-700 dark:text-stone-200 px-3 py-1.5 rounded-lg transition-colors">
            ⬇ Export JSON
          </button>
        </div>
      </div>

      {/* Executive Summary */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile label="Revenue" value={money(s.totalRevenue)} sub={`Target: ${money(s.totalRevenueTarget)}`} trend={s.revenueTrend} />
        <Tile label="Execution" value={`${s.avgExecutionScore ?? "—"}`} sub={`Grade ${s.executionGrade ?? "—"}`} trend={s.executionTrend} valueClass={gradeCls(s.executionGrade)} />
        <Tile label="Completion" value={pct(s.completionRate)} sub={`${s.actionsCompleted}/${s.actionsAssigned}`} />
        <Tile label="Revenue Gap" value={pct(s.revenueGapPct)} valueClass={(s.revenueGapPct ?? 0) > 10 ? "text-red-500" : ""} />
        <Tile label="Overdue" value={String(s.actionsOverdue)} valueClass={s.actionsOverdue > 3 ? "text-red-500" : ""} />
        <Tile label="Escalated" value={String(s.actionsEscalated)} valueClass={s.actionsEscalated > 2 ? "text-amber-500" : ""} />
      </section>

      {/* Store Ranking */}
      <Section title="Store Ranking">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-stone-300 dark:border-stone-700/50 text-stone-500 dark:text-stone-400">
                <Th>#</Th><Th>Store</Th><Th right>Score</Th><Th right>Revenue</Th><Th right>Gap%</Th><Th right>Done%</Th><Th center>Trend</Th>
              </tr>
            </thead>
            <tbody>
              {storeRanking.map((store) => (
                <tr key={store.siteId} className={cn("border-b border-stone-200 dark:border-stone-800/50", store.rank <= 3 && "bg-emerald-950/20", store.avgExecutionScore != null && store.avgExecutionScore < 45 && "bg-red-950/20")}>
                  <Td className="font-bold text-stone-500 dark:text-stone-400">{store.rank}</Td>
                  <Td className="font-medium text-stone-700 dark:text-stone-200">{store.storeName}</Td>
                  <Td right className={cn("font-bold", gradeCls(gradeFromScore(store.avgExecutionScore)))}>{store.avgExecutionScore ?? "—"}</Td>
                  <Td right>{money(store.totalRevenue)}</Td>
                  <Td right className={(store.revenueGapPct ?? 0) > 15 ? "text-red-400" : ""}>{pct(store.revenueGapPct)}</Td>
                  <Td right>{pct(store.completionRate)}</Td>
                  <Td center className={trendCls(store.trend)}>{arrow(store.trend)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* GM Performance */}
      <Section title="GM Performance">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-stone-300 dark:border-stone-700/50 text-stone-500 dark:text-stone-400">
                <Th>GM</Th><Th>Store</Th><Th right>Score</Th><Th right>Δ</Th><Th right>Done%</Th><Th right>Overdue</Th><Th right>Escalations</Th><Th right>Impact</Th>
              </tr>
            </thead>
            <tbody>
              {gmPerformance.map((gm) => (
                <tr key={gm.siteId} className="border-b border-stone-200 dark:border-stone-800/50">
                  <Td className="text-stone-700 dark:text-stone-200">{gm.gmName ?? "—"}</Td>
                  <Td className="text-stone-500 dark:text-stone-400">{gm.storeName}</Td>
                  <Td right className={cn("font-bold", gradeCls(gradeFromScore(gm.executionScore)))}>{gm.executionScore ?? "—"}</Td>
                  <Td right className={cn((gm.scoreDelta ?? 0) > 0 ? "text-emerald-500" : (gm.scoreDelta ?? 0) < 0 ? "text-red-500" : "text-stone-500 dark:text-stone-400")}>
                    {gm.scoreDelta != null ? `${gm.scoreDelta > 0 ? "+" : ""}${gm.scoreDelta}` : "—"}
                  </Td>
                  <Td right>{pct(gm.completionRate)}</Td>
                  <Td right className={gm.overdueActions > 2 ? "text-red-500" : ""}>{gm.overdueActions}</Td>
                  <Td right className={gm.escalations > 1 ? "text-amber-500" : ""}>{gm.escalations}</Td>
                  <Td right className="text-emerald-400">{money(gm.impactGenerated)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Impact Summary */}
      {impactSummary.actionsWithImpact > 0 && (
        <Section title="Impact Generated">
          <div className="flex items-baseline gap-3 mb-4">
            <span className="text-2xl font-extrabold text-emerald-400">{money(impactSummary.totalImpact)}</span>
            <span className="text-xs text-stone-500 dark:text-stone-400">from {impactSummary.actionsWithImpact} measured action{impactSummary.actionsWithImpact !== 1 ? "s" : ""}</span>
          </div>
          {impactSummary.byCategory.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {impactSummary.byCategory.map((c) => (
                <span key={c.category} className="bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 text-[11px] px-2.5 py-1 rounded-md">
                  {c.category}: {money(c.totalImpact)} ({c.count})
                </span>
              ))}
            </div>
          )}
          {impactSummary.byStore.length > 0 && (
            <div className="mt-3">
              <h4 className="text-[11px] font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wide mb-2">By Store</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {impactSummary.byStore.map((s) => (
                  <div key={s.siteId} className="bg-stone-100 dark:bg-stone-800/50 rounded-lg px-3 py-2">
                    <div className="text-xs font-medium text-stone-700 dark:text-stone-200">{s.storeName}</div>
                    <div className="text-sm font-bold text-emerald-400">{money(s.totalImpact)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Service Insights */}
      <Section title="Service Insights">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile label="Avg Spend" value={money(serviceInsights.avgSpend)} sub={`Prev: ${money(serviceInsights.avgSpendPrevWeek)}`} trend={serviceInsights.avgSpendTrend} />
          <Tile label="Covers" value={String(serviceInsights.totalCovers ?? "—")} sub={`Prev: ${serviceInsights.coversPrevWeek ?? "—"}`} />
          <Tile label="Avg Rating" value={serviceInsights.avgRating?.toFixed(1) ?? "—"} sub={`Prev: ${serviceInsights.ratingPrevWeek?.toFixed(1) ?? "—"}`} trend={serviceInsights.ratingTrend} />
          {serviceInsights.topPerformingStore && (
            <Tile label="Top Rated" value={serviceInsights.topPerformingStore} valueClass="text-xs text-emerald-400" />
          )}
        </div>
      </Section>

      {/* Interventions */}
      {interventionList.length > 0 && (
        <Section title="⚠ Interventions Required">
          <div className="space-y-2">
            {interventionList.map((item, i) => (
              <div key={i} className={cn("rounded-lg border px-4 py-3", severityCls(item.severity))}>
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">{item.store}</span>
                    <span className="mx-1.5 text-stone-600">—</span>
                    <span className="text-xs text-stone-600 dark:text-stone-300">{item.issue}</span>
                  </div>
                  <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded",
                    item.severity === "critical" ? "bg-red-900/60 text-red-300" :
                    item.severity === "high" ? "bg-amber-900/50 text-amber-300" :
                    "bg-stone-700 text-stone-600 dark:text-stone-300"
                  )}>{item.severity}</span>
                </div>
                <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-1">→ {item.recommendation}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Next Week Focus */}
      {nextWeekFocus.length > 0 && (
        <Section title="🎯 Next Week Focus">
          <div className="space-y-2">
            {nextWeekFocus.map((f, i) => (
              <div key={i} className="flex items-start gap-3 py-2 border-b border-stone-200 dark:border-stone-800/50 last:border-0">
                <span className="text-xs font-semibold text-stone-700 dark:text-stone-200 min-w-[100px]">{f.area}</span>
                <span className="text-xs text-stone-500 dark:text-stone-400">{f.description}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Email + Export Controls */}
      <Section title="Deliver Report">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
          <div className="flex-1 w-full">
            <label className="text-[11px] text-stone-500 dark:text-stone-400 mb-1 block">Recipients (comma-separated emails)</label>
            <input
              type="text"
              value={emailField}
              onChange={(e) => setEmailField(e.target.value)}
              placeholder="exec@restaurant.com, gm@restaurant.com"
              className="w-full bg-stone-100 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-700 dark:text-stone-200 placeholder:text-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-600"
            />
          </div>
          <button
            onClick={handleSendEmail}
            disabled={sending || !emailField.trim()}
            className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:bg-stone-700 disabled:text-stone-500 text-white px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
          >
            {sending ? "Sending…" : emailSent ? "✓ Sent" : "📧 Send Email"}
          </button>
        </div>
      </Section>

    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">
      <div className="border-b border-stone-200 dark:border-stone-800 px-5 py-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-stone-600 dark:text-stone-300">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Tile({ label, value, sub, trend, valueClass }: { label: string; value: string; sub?: string; trend?: TrendDirection; valueClass?: string }) {
  return (
    <div className="bg-stone-100 dark:bg-stone-800/60 rounded-lg px-3.5 py-3">
      <div className="text-[11px] text-stone-500 dark:text-stone-400">{label}</div>
      <div className={cn("text-lg font-bold text-stone-900 dark:text-stone-100 mt-0.5", valueClass)}>{value}</div>
      {(sub || trend) && (
        <div className="flex items-center gap-1 mt-0.5">
          {trend && <span className={cn("text-[11px] font-medium", trendCls(trend))}>{arrow(trend)}</span>}
          {sub && <span className="text-[10px] text-stone-500">{sub}</span>}
        </div>
      )}
    </div>
  );
}

function Th({ children, right, center }: { children: React.ReactNode; right?: boolean; center?: boolean }) {
  return (
    <th className={cn("px-3 py-2 font-semibold text-[11px] uppercase tracking-wide",
      right && "text-right",
      center && "text-center",
      !right && !center && "text-left"
    )}>{children}</th>
  );
}

function Td({ children, right, center, className }: { children: React.ReactNode; right?: boolean; center?: boolean; className?: string }) {
  return (
    <td className={cn("px-3 py-2",
      right && "text-right",
      center && "text-center",
      !right && !center && "text-left",
      className
    )}>{children}</td>
  );
}
