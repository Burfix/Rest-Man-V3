"use client";

/**
 * components/system-health/IncidentPerformancePanel.tsx
 *
 * Incident performance intelligence panel.
 * Fetches /api/incidents/performance and renders:
 *   - Summary stats (compliance rate, MTTR, active count, escalations)
 *   - 7-day executive summary card
 *   - SLA breach trend (14-day sparkbar chart)
 *   - Active incident aging heatmap
 *   - Repeat offenders table
 *   - Ack latency by site
 *   - MTTR weekly trend
 *   - Operator workload
 *
 * Tabs: Overview | Trends | Details
 * Polls every 5 minutes.
 */

import { useCallback, useEffect, useState } from "react";
import { cn }                               from "@/lib/utils";
import type {
  SlaBreachPoint,
  MttrTrendPoint,
  AckLatencyEntry,
  RepeatOffender,
  AgingBucket,
  OperatorWorkload,
  EscalationTrendPoint,
  WeeklySummary,
  PerformanceMetrics,
} from "@/lib/incidents/analytics";

// ── Response type ─────────────────────────────────────────────────────────────

interface PerformanceResponse extends PerformanceMetrics {
  ok:          boolean;
  generatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60)    return `${Math.round(minutes)}m`;
  if (minutes < 1440)  return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", { month: "short", day: "numeric" });
}

function complianceColor(rate: number): string {
  if (rate >= 90) return "text-emerald-600 dark:text-emerald-400";
  if (rate >= 70) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function complianceBarColor(rate: number): string {
  if (rate >= 90) return "bg-emerald-400";
  if (rate >= 70) return "bg-amber-400";
  return "bg-red-400";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatPill({
  label,
  value,
  sub,
  highlight,
}: {
  label:     string;
  value:     string | number;
  sub?:      string;
  highlight?: "good" | "warn" | "bad" | "neutral";
}) {
  const styles = {
    good:    "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400",
    warn:    "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400",
    bad:     "bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400",
    neutral: "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300",
  };
  return (
    <div className={cn("rounded-lg px-3 py-2.5 text-center", styles[highlight ?? "neutral"])}>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs font-medium opacity-75">{label}</div>
      {sub && <div className="text-[10px] opacity-50 mt-0.5">{sub}</div>}
    </div>
  );
}

function SectionHeading({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {children}
      </h3>
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0 text-[10px] font-bold text-zinc-500">
          {count}
        </span>
      )}
    </div>
  );
}

// ── Breach sparkbar chart ─────────────────────────────────────────────────────

function BreachTrendChart({ points }: { points: SlaBreachPoint[] }) {
  // Show last 14 points for visual clarity
  const visible = points.slice(-14);
  const maxTotal = Math.max(1, ...visible.map(p => p.total));

  return (
    <div>
      <SectionHeading>SLA breach trend — last {visible.length} days</SectionHeading>
      <div className="flex items-end gap-px h-12" aria-label="SLA breach trend">
        {visible.map(point => {
          const barH = point.total === 0
            ? 4
            : Math.max(8, Math.round((point.total / maxTotal) * 100));
          const breachPct = point.total === 0 ? 0 : point.uniqueBreached / point.total;
          const color = breachPct === 0
            ? "bg-emerald-400"
            : breachPct < 0.3
            ? "bg-amber-400"
            : "bg-red-400";
          return (
            <div
              key={point.date}
              className="group flex-1 flex flex-col justify-end cursor-default"
              title={`${formatDateShort(point.date)}: ${point.complianceRate}% compliant · ${point.total} incidents`}
            >
              <div
                className={cn("rounded-sm transition-opacity group-hover:opacity-80", color, point.total === 0 ? "opacity-20" : "")}
                style={{ height: `${barH}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-zinc-400">{visible[0] ? formatDateShort(visible[0].date) : ""}</span>
        <span className="text-[10px] text-zinc-400">{visible[visible.length - 1] ? formatDateShort(visible[visible.length - 1].date) : ""}</span>
      </div>
      <div className="flex items-center gap-3 mt-1.5">
        <span className="flex items-center gap-1 text-[10px] text-zinc-400"><span className="inline-block w-2 h-2 rounded-sm bg-emerald-400" /> 100% compliant</span>
        <span className="flex items-center gap-1 text-[10px] text-zinc-400"><span className="inline-block w-2 h-2 rounded-sm bg-amber-400" /> some breaches</span>
        <span className="flex items-center gap-1 text-[10px] text-zinc-400"><span className="inline-block w-2 h-2 rounded-sm bg-red-400" /> &gt;30% breached</span>
      </div>
    </div>
  );
}

// ── MTTR trend bars ───────────────────────────────────────────────────────────

function MttrTrendChart({ points }: { points: MttrTrendPoint[] }) {
  if (points.length === 0) return null;
  const maxMttr = Math.max(1, ...points.map(p => p.avgMttrMinutes));

  return (
    <div>
      <SectionHeading>MTTR trend — weekly</SectionHeading>
      <div className="space-y-1.5">
        {points.map(p => (
          <div key={p.weekStart} className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-400 w-16 flex-shrink-0">
              {formatDateShort(p.weekStart)}
            </span>
            <div className="flex-1 bg-zinc-100 dark:bg-zinc-800 rounded-full h-1.5">
              <div
                className="bg-indigo-400 h-1.5 rounded-full transition-all"
                style={{ width: `${Math.round((p.avgMttrMinutes / maxMttr) * 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-zinc-500 tabular-nums w-10 text-right">
              {formatDuration(p.avgMttrMinutes)}
            </span>
            <span className="text-[10px] text-zinc-400 w-8 tabular-nums">×{p.resolvedCount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Aging heatmap ─────────────────────────────────────────────────────────────

function AgingHeatmap({ buckets }: { buckets: AgingBucket[] }) {
  const active = buckets.filter(b => b.total > 0);
  if (active.length === 0) {
    return (
      <div>
        <SectionHeading>Active incident aging</SectionHeading>
        <p className="text-xs text-zinc-400">No active incidents.</p>
      </div>
    );
  }

  return (
    <div>
      <SectionHeading>Active incident aging</SectionHeading>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <th className="py-1.5 text-left font-medium text-zinc-400 pr-4">Age</th>
              <th className="py-1.5 text-center font-medium text-red-400 px-3">Crit</th>
              <th className="py-1.5 text-center font-medium text-amber-400 px-3">Warn</th>
              <th className="py-1.5 text-center font-medium text-blue-400 px-3">Info</th>
              <th className="py-1.5 text-center font-medium text-zinc-400 px-3">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800/50">
            {buckets.map(b => (
              <tr key={b.label} className={cn(b.total === 0 ? "opacity-30" : "")}>
                <td className="py-1.5 text-zinc-600 dark:text-zinc-300 pr-4 font-medium">{b.label}</td>
                <td className={cn("py-1.5 text-center tabular-nums px-3", b.critical > 0 && "text-red-600 dark:text-red-400 font-semibold bg-red-50 dark:bg-red-950/20 rounded")}>
                  {b.critical || "—"}
                </td>
                <td className={cn("py-1.5 text-center tabular-nums px-3", b.warning > 0 && "text-amber-600 dark:text-amber-400 font-semibold bg-amber-50 dark:bg-amber-950/20 rounded")}>
                  {b.warning || "—"}
                </td>
                <td className="py-1.5 text-center tabular-nums px-3 text-zinc-500">
                  {b.info || "—"}
                </td>
                <td className="py-1.5 text-center tabular-nums px-3 font-semibold text-zinc-700 dark:text-zinc-300">
                  {b.total || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Repeat offenders ──────────────────────────────────────────────────────────

function RepeatOffendersTable({ offenders }: { offenders: RepeatOffender[] }) {
  if (offenders.length === 0) return null;

  return (
    <div>
      <SectionHeading count={offenders.length}>Repeat offenders</SectionHeading>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <th className="py-1.5 text-left font-medium text-zinc-400 pr-3">Source</th>
              <th className="py-1.5 text-center font-medium text-zinc-400 px-3">Fires</th>
              <th className="py-1.5 text-center font-medium text-red-400 px-3">Critical</th>
              <th className="py-1.5 text-left font-medium text-zinc-400 px-3">Avg interval</th>
              <th className="py-1.5 text-left font-medium text-zinc-400 pl-3">Last seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800/50">
            {offenders.slice(0, 10).map(o => (
              <tr key={o.source}>
                <td className="py-1.5 pr-3 font-mono text-zinc-700 dark:text-zinc-300 max-w-[140px] truncate">
                  {o.source}
                </td>
                <td className="py-1.5 text-center tabular-nums px-3 font-semibold text-zinc-700 dark:text-zinc-300">
                  {o.incidentCount}
                </td>
                <td className={cn(
                  "py-1.5 text-center tabular-nums px-3",
                  o.criticalCount > 0 && "text-red-600 dark:text-red-400 font-semibold",
                )}>
                  {o.criticalCount || "—"}
                </td>
                <td className="py-1.5 px-3 text-zinc-500">
                  {o.avgIntervalHours !== null ? `${o.avgIntervalHours}h` : "—"}
                </td>
                <td className="py-1.5 pl-3 text-zinc-400">
                  {formatDateShort(o.lastSeenAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Ack latency by site ───────────────────────────────────────────────────────

function AckLatencyTable({ entries }: { entries: AckLatencyEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <div>
      <SectionHeading count={entries.length}>Acknowledgement latency by site</SectionHeading>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <th className="py-1.5 text-left font-medium text-zinc-400 pr-3">Site</th>
              <th className="py-1.5 text-center font-medium text-zinc-400 px-3">Avg ack</th>
              <th className="py-1.5 text-center font-medium text-zinc-400 px-3">p50</th>
              <th className="py-1.5 text-center font-medium text-zinc-400 px-3">p90</th>
              <th className="py-1.5 text-center font-medium text-zinc-400 pl-3">Count</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800/50">
            {entries.map(e => (
              <tr key={e.siteId}>
                <td className="py-1.5 pr-3 text-zinc-700 dark:text-zinc-300 max-w-[120px] truncate font-medium">
                  {e.siteName}
                </td>
                <td className="py-1.5 text-center tabular-nums px-3 font-semibold text-zinc-700 dark:text-zinc-300">
                  {formatDuration(e.avgAckMinutes)}
                </td>
                <td className="py-1.5 text-center tabular-nums px-3 text-zinc-500">
                  {formatDuration(e.p50AckMinutes)}
                </td>
                <td className="py-1.5 text-center tabular-nums px-3 text-zinc-500">
                  {formatDuration(e.p90AckMinutes)}
                </td>
                <td className="py-1.5 text-center tabular-nums pl-3 text-zinc-400">
                  {e.incidentCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Operator workload ─────────────────────────────────────────────────────────

function WorkloadTable({ operators }: { operators: OperatorWorkload[] }) {
  if (operators.length === 0) return null;

  function idShort(id: string) {
    return `…${id.slice(-8)}`;
  }

  return (
    <div>
      <SectionHeading count={operators.length}>Operator workload</SectionHeading>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <th className="py-1.5 text-left font-medium text-zinc-400 pr-3">Operator</th>
              <th className="py-1.5 text-center font-medium text-zinc-400 px-3">Open</th>
              <th className="py-1.5 text-center font-medium text-zinc-400 px-3">Resolved</th>
              <th className="py-1.5 text-center font-medium text-zinc-400 px-3">Avg MTTR</th>
              <th className="py-1.5 text-center font-medium text-amber-400 pl-3">Escalated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800/50">
            {operators.map(op => (
              <tr key={op.userId}>
                <td className="py-1.5 pr-3 font-mono text-zinc-500 text-[10px]">
                  {idShort(op.userId)}
                </td>
                <td className={cn(
                  "py-1.5 text-center tabular-nums px-3 font-semibold",
                  op.openCount > 3 ? "text-amber-600 dark:text-amber-400" : "text-zinc-700 dark:text-zinc-300",
                )}>
                  {op.openCount}
                </td>
                <td className="py-1.5 text-center tabular-nums px-3 text-zinc-500">
                  {op.resolvedCount}
                </td>
                <td className="py-1.5 text-center tabular-nums px-3 text-zinc-500">
                  {formatDuration(op.avgMttrMinutes)}
                </td>
                <td className={cn(
                  "py-1.5 text-center tabular-nums pl-3",
                  op.escalatedCount > 0 ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-zinc-400",
                )}>
                  {op.escalatedCount || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Escalation trend mini chart ───────────────────────────────────────────────

function EscalationTrendChart({ points }: { points: EscalationTrendPoint[] }) {
  const visible  = points.slice(-14);
  const hasAny   = visible.some(p => p.elevatedCount > 0 || p.urgentCount > 0);
  if (!hasAny) return null;

  const maxEsc = Math.max(1, ...visible.map(p => p.elevatedCount + p.urgentCount));

  return (
    <div>
      <SectionHeading>Escalation trend — last {visible.length} days</SectionHeading>
      <div className="flex items-end gap-px h-8" aria-label="Escalation trend">
        {visible.map(point => {
          const escTotal = point.elevatedCount + point.urgentCount;
          const barH     = escTotal === 0 ? 0 : Math.max(6, Math.round((escTotal / maxEsc) * 100));
          const color    = point.urgentCount > 0 ? "bg-red-400" : "bg-amber-400";
          return (
            <div
              key={point.date}
              className="group flex-1 flex flex-col justify-end cursor-default"
              title={`${formatDateShort(point.date)}: ${point.elevatedCount} elevated, ${point.urgentCount} urgent`}
            >
              {escTotal > 0 ? (
                <div
                  className={cn("rounded-sm transition-opacity group-hover:opacity-80", color)}
                  style={{ height: `${barH}%` }}
                />
              ) : (
                <div className="h-0.5 rounded-sm bg-zinc-100 dark:bg-zinc-800" />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 mt-1.5">
        <span className="flex items-center gap-1 text-[10px] text-zinc-400"><span className="inline-block w-2 h-2 rounded-sm bg-amber-400" /> elevated</span>
        <span className="flex items-center gap-1 text-[10px] text-zinc-400"><span className="inline-block w-2 h-2 rounded-sm bg-red-400" /> urgent</span>
      </div>
    </div>
  );
}

// ── Weekly summary card ───────────────────────────────────────────────────────

function WeeklySummaryCard({ s }: { s: WeeklySummary }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          7-day summary
        </span>
        <span className="text-[10px] text-zinc-400">
          {formatDateShort(s.periodStart)} – {formatDateShort(s.periodEnd)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="text-center">
          <div className={cn("text-lg font-bold tabular-nums", complianceColor(s.slaComplianceRate))}>
            {s.slaComplianceRate}%
          </div>
          <div className="text-[10px] text-zinc-400">SLA compliance</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold tabular-nums text-zinc-700 dark:text-zinc-300">
            {formatDuration(s.avgMttrMinutes)}
          </div>
          <div className="text-[10px] text-zinc-400">avg MTTR</div>
        </div>
        <div className="text-center">
          <div className={cn(
            "text-lg font-bold tabular-nums",
            s.totalIncidents === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-700 dark:text-zinc-300",
          )}>
            {s.totalIncidents}
          </div>
          <div className="text-[10px] text-zinc-400">incidents</div>
        </div>
      </div>

      {/* Call-outs */}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {s.resolvedCount < s.totalIncidents && (
          <span className="rounded-full border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/30 px-2 py-0 text-[10px] font-medium text-amber-700 dark:text-amber-400">
            {s.openCount} open
          </span>
        )}
        {s.criticalOpenCount > 0 && (
          <span className="rounded-full border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/30 px-2 py-0 text-[10px] font-medium text-red-700 dark:text-red-400">
            {s.criticalOpenCount} critical open
          </span>
        )}
        {s.escalatedCount > 0 && (
          <span className="rounded-full border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-2 py-0 text-[10px] font-medium text-zinc-600 dark:text-zinc-400">
            {s.escalatedCount} escalated
          </span>
        )}
        {s.worstSource && (
          <span className="rounded-full border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-2 py-0 text-[10px] font-medium text-zinc-600 dark:text-zinc-400 font-mono">
            top: {s.worstSource.source} ×{s.worstSource.incidentCount}
          </span>
        )}
        {s.slaBreachDetails.uniqueBreachedCount > 0 && (
          <span className="rounded-full border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/30 px-2 py-0 text-[10px] font-medium text-red-700 dark:text-red-400">
            {s.slaBreachDetails.uniqueBreachedCount} SLA breach{s.slaBreachDetails.uniqueBreachedCount !== 1 ? "es" : ""}
          </span>
        )}
        {s.totalIncidents === 0 && (
          <span className="rounded-full border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
            No incidents this week
          </span>
        )}
      </div>
    </div>
  );
}

// ── Tab type ──────────────────────────────────────────────────────────────────

type Tab = "overview" | "trends" | "details";

// ── Main panel ────────────────────────────────────────────────────────────────

export default function IncidentPerformancePanel() {
  const [data,       setData]       = useState<PerformanceResponse | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [tab,        setTab]        = useState<Tab>("overview");

  const fetch_ = useCallback(() => {
    fetch("/api/incidents/performance?days=30")
      .then(r => {
        if (r.status === 403) { setData(null); setLoading(false); return null; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PerformanceResponse>;
      })
      .then(d => {
        if (!d) return;
        setData(d);
        setLastFetched(new Date());
        setLoading(false);
        setError(null);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 403 — no access; render nothing
  if (!loading && !error && !data) return null;

  // Compute summary pills
  const w = data?.weeklySummary;
  const totalActive  = data ? data.agingBuckets.reduce((s, b) => s + b.total, 0) : 0;
  const totalEscalated = w?.escalatedCount ?? 0;
  const compRate     = w?.slaComplianceRate ?? 100;

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Incident Performance
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            30-day SLA compliance, MTTR, and response intelligence.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastFetched && (
            <span className="text-[11px] text-zinc-400">
              {lastFetched.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={fetch_}
            className="rounded px-2 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Body */}
      {loading && !data ? (
        <div className="px-6 py-8 animate-pulse space-y-4">
          <div className="grid grid-cols-4 gap-3">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-14 rounded-lg bg-zinc-100 dark:bg-zinc-800" />
            ))}
          </div>
          <div className="h-20 rounded-lg bg-zinc-50 dark:bg-zinc-800/50" />
          <div className="h-12 rounded bg-zinc-100 dark:bg-zinc-800" />
        </div>
      ) : error ? (
        <div className="px-6 py-6 text-center">
          <p className="text-xs text-red-500">{error}</p>
        </div>
      ) : data ? (
        <div className="px-6 py-5 space-y-5">
          {/* Summary pills */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatPill
              label="SLA compliance"
              value={`${compRate}%`}
              sub="7-day"
              highlight={compRate >= 90 ? "good" : compRate >= 70 ? "warn" : "bad"}
            />
            <StatPill
              label="Avg MTTR"
              value={formatDuration(w?.avgMttrMinutes ?? null)}
              sub="7-day"
              highlight="neutral"
            />
            <StatPill
              label="Active incidents"
              value={totalActive}
              highlight={totalActive > 0 ? "warn" : "good"}
            />
            <StatPill
              label="Escalated"
              value={totalEscalated}
              sub="7-day"
              highlight={totalEscalated > 0 ? "warn" : "neutral"}
            />
          </div>

          {/* Weekly summary card */}
          {w && <WeeklySummaryCard s={w} />}

          {/* Tabs */}
          <div>
            <div className="flex gap-1 border-b border-zinc-100 dark:border-zinc-800 mb-5">
              {(["overview", "trends", "details"] as Tab[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium capitalize border-b-2 -mb-px transition-colors",
                    tab === t
                      ? "border-zinc-800 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100"
                      : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Overview tab */}
            {tab === "overview" && (
              <div className="space-y-6">
                <BreachTrendChart points={data.breachTrend} />
                <RepeatOffendersTable offenders={data.repeatOffenders} />
                <AckLatencyTable entries={data.ackLatencyBySite} />
              </div>
            )}

            {/* Trends tab */}
            {tab === "trends" && (
              <div className="space-y-6">
                <MttrTrendChart points={data.mttrTrend} />
                <EscalationTrendChart points={data.escalationTrend} />
                {data.mttrTrend.length === 0 && data.escalationTrend.every(p => p.elevatedCount === 0 && p.urgentCount === 0) && (
                  <p className="text-xs text-zinc-400">No resolved incidents in the period — trend data will appear once incidents are closed.</p>
                )}
              </div>
            )}

            {/* Details tab */}
            {tab === "details" && (
              <div className="space-y-6">
                <AgingHeatmap buckets={data.agingBuckets} />
                <WorkloadTable operators={data.operatorWorkload} />
                {data.operatorWorkload.length === 0 && (
                  <p className="text-xs text-zinc-400 mt-2">No incidents have been assigned to operators yet.</p>
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
