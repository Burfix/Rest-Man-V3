"use client";

/**
 * components/system-health/IncidentSlaPanel.tsx
 *
 * Lightweight SLA coordination panel. Fetches /api/incidents/sla-summary
 * and shows:
 *   — Summary stats (open, unassigned, ack-breached, avg MTTR)
 *   — Needs acknowledgement queue
 *   — SLA breached queue
 *   — Assigned to me queue
 *
 * Polls every 2 minutes. Shows a manual refresh button.
 * Gracefully hides empty queues.
 */

import { useCallback, useEffect, useState } from "react";
import { cn }                               from "@/lib/utils";

// ── Types (mirrors SlaSummaryResponse) ────────────────────────────────────────

interface IncidentSlaRow {
  id:                    string;
  siteId:                string | null;
  source:                string;
  severity:              "info" | "warning" | "critical";
  summary:               string;
  status:                string;
  escalationLevel:       "normal" | "elevated" | "urgent";
  createdAt:             string;
  acknowledgedAt:        string | null;
  resolvedAt:            string | null;
  assignedTo:            string | null;
  ageMinutes:            number;
  ackBreached:           boolean;
  resolutionBreached:    boolean;
  slaStatus:             "within_sla" | "ack_breached" | "resolution_breached" | "resolved";
  recommendedEscalation: "normal" | "elevated" | "urgent";
}

interface SlaSummary {
  openCount:               number;
  unassignedCount:         number;
  ackBreachedCount:        number;
  resolutionBreachedCount: number;
  urgentCount:             number;
  avgTimeToAckMinutes:     number | null;
  avgMttrMinutes:          number | null;
}

interface SlaSummaryResponse {
  ok:          boolean;
  generatedAt: string;
  summary:     SlaSummary;
  queues: {
    needsAck:    IncidentSlaRow[];
    breached:    IncidentSlaRow[];
    assignedToMe: IncidentSlaRow[];
    unresolved:  IncidentSlaRow[];
  };
  mttrBySite:   Array<{ siteId: string; siteName: string; avgMttrMinutes: number; resolvedCount: number }>;
  mttrBySource: Array<{ source: string; avgMttrMinutes: number; resolvedCount: number }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAge(minutes: number): string {
  if (minutes < 60)  return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

function formatDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  return formatAge(minutes);
}

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  warning:  "bg-amber-500",
  info:     "bg-blue-400",
};

const ESCALATION_BADGE: Record<string, string> = {
  elevated: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800/60",
  urgent:   "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-red-200 dark:border-red-800/60",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StatPill({
  label,
  value,
  variant = "neutral",
}: {
  label: string;
  value: string | number;
  variant?: "neutral" | "warn" | "critical" | "ok";
}) {
  const styles = {
    neutral:  "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300",
    warn:     "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
    critical: "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400",
    ok:       "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400",
  };
  return (
    <div className={cn("rounded-lg px-3 py-2 text-center", styles[variant])}>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs font-medium opacity-75">{label}</div>
    </div>
  );
}

function QueueRow({ row }: { row: IncidentSlaRow }) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span
        className={cn(
          "flex-shrink-0 h-1.5 w-1.5 rounded-full",
          SEVERITY_DOT[row.severity] ?? "bg-zinc-400",
        )}
      />
      <span className="flex-1 min-w-0 text-xs text-zinc-700 dark:text-zinc-300 truncate">
        {row.summary}
      </span>
      <span className="flex-shrink-0 text-xs text-zinc-400 tabular-nums">
        {formatAge(row.ageMinutes)}
      </span>
      {row.escalationLevel !== "normal" && (
        <span
          className={cn(
            "flex-shrink-0 rounded-full border px-1.5 py-0 text-[10px] font-semibold",
            ESCALATION_BADGE[row.escalationLevel],
          )}
        >
          {row.escalationLevel}
        </span>
      )}
    </div>
  );
}

function QueueSection({
  title,
  rows,
  emptyText,
  accentClass = "",
}: {
  title:      string;
  rows:       IncidentSlaRow[];
  emptyText:  string;
  accentClass?: string;
}) {
  return (
    <div>
      <div className={cn("flex items-center gap-2 mb-1.5")}>
        <h3 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wide">
          {title}
        </h3>
        {rows.length > 0 && (
          <span
            className={cn(
              "rounded-full px-1.5 py-0 text-[10px] font-bold",
              accentClass || "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400",
            )}
          >
            {rows.length}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-zinc-400 pl-0.5">{emptyText}</p>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map(r => <QueueRow key={r.id} row={r} />)}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function IncidentSlaPanel() {
  const [data, setData]       = useState<SlaSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetch_ = useCallback(() => {
    setLoading(prev => { if (!data) return true; return prev; }); // only show spinner on first load
    fetch("/api/incidents/sla-summary")
      .then(r => {
        if (r.status === 403) { setError(null); setData(null); setLoading(false); return null; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SlaSummaryResponse>;
      })
      .then(d => {
        if (!d) return;
        setData(d);
        setLastFetched(new Date());
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, [data]);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, 2 * 60 * 1000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 403 (no access) — render nothing
  if (!loading && !error && !data) return null;

  const s = data?.summary;

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Incident SLA
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Active queues and response metrics.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastFetched && (
            <span className="text-[11px] text-zinc-400">
              Updated {lastFetched.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
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

      {/* Content */}
      {loading && !data ? (
        <div className="px-6 py-8 space-y-3 animate-pulse">
          <div className="grid grid-cols-4 gap-3">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-14 rounded-lg bg-zinc-100 dark:bg-zinc-800" />
            ))}
          </div>
          <div className="space-y-2 pt-4">
            <div className="h-3 w-24 rounded bg-zinc-100 dark:bg-zinc-800" />
            {[0, 1, 2].map(i => <div key={i} className="h-7 rounded bg-zinc-50 dark:bg-zinc-800/60" />)}
          </div>
        </div>
      ) : error ? (
        <div className="px-6 py-6 text-center">
          <p className="text-xs text-red-500">{error}</p>
        </div>
      ) : s ? (
        <div className="px-6 py-5 space-y-6">
          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatPill
              label="Open"
              value={s.openCount}
              variant={s.openCount > 0 ? "warn" : "ok"}
            />
            <StatPill
              label="Ack breached"
              value={s.ackBreachedCount}
              variant={s.ackBreachedCount > 0 ? "critical" : "ok"}
            />
            <StatPill
              label="Avg ack"
              value={formatDuration(s.avgTimeToAckMinutes)}
              variant="neutral"
            />
            <StatPill
              label="Avg MTTR"
              value={formatDuration(s.avgMttrMinutes)}
              variant="neutral"
            />
          </div>

          {/* Secondary stats row */}
          {(s.urgentCount > 0 || s.unassignedCount > 0 || s.resolutionBreachedCount > 0) && (
            <div className="flex flex-wrap gap-2">
              {s.urgentCount > 0 && (
                <span className="rounded-full border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:text-red-400">
                  {s.urgentCount} urgent
                </span>
              )}
              {s.resolutionBreachedCount > 0 && (
                <span className="rounded-full border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:text-red-400">
                  {s.resolutionBreachedCount} resolve SLA breached
                </span>
              )}
              {s.unassignedCount > 0 && (
                <span className="rounded-full border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  {s.unassignedCount} unassigned
                </span>
              )}
            </div>
          )}

          {/* All clear state */}
          {s.openCount === 0 && (
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/60 px-4 py-3">
              <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                All incidents resolved — no active SLA obligations.
              </p>
            </div>
          )}

          {/* Queues */}
          {s.openCount > 0 && data && (
            <div className="space-y-5">
              {data.queues.needsAck.length > 0 && (
                <QueueSection
                  title="Needs acknowledgement"
                  rows={data.queues.needsAck}
                  emptyText="No unacknowledged incidents."
                  accentClass="bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400"
                />
              )}
              {data.queues.breached.length > 0 && (
                <QueueSection
                  title="SLA breached"
                  rows={data.queues.breached}
                  emptyText="No SLA breaches."
                  accentClass="bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400"
                />
              )}
              {data.queues.assignedToMe.length > 0 && (
                <QueueSection
                  title="Assigned to me"
                  rows={data.queues.assignedToMe}
                  emptyText="Nothing assigned to you."
                />
              )}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
