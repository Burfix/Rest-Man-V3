"use client";

/**
 * RiskRadarPanel
 *
 * Shows top 10 store risk signals from GET /api/head-office/risk-flags.
 * Data comes from v_risk_flags (migration 067), which is derived entirely
 * from contract-layer views — no raw table queries.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RiskFlagRow = {
  site_id: string;
  store_name: string;
  org_id: string | null;
  issue_type: string;
  issue: string;
  severity: "critical" | "warning" | "info";
  metric_value: number | null;
  metric_label: string | null;
};

// ── Severity palette ──────────────────────────────────────────────────────────

const SEV_STYLE: Record<string, { badge: string; row: string; icon: string }> = {
  critical: {
    badge: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800",
    row:   "border-l-2 border-l-red-500",
    icon:  "🔴",
  },
  warning: {
    badge: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800",
    row:   "border-l-2 border-l-amber-400",
    icon:  "🟡",
  },
  info: {
    badge: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800",
    row:   "border-l-2 border-l-blue-400",
    icon:  "🔵",
  },
};

const ISSUE_TYPE_LABEL: Record<string, string> = {
  stale_sync:      "Stale sync",
  sync_errors:     "Sync errors",
  no_revenue_data: "Revenue Missing",
  failed_runs:     "Failed runs",
};

// ── Loading skeleton ──────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden animate-pulse">
      <div className="h-11 bg-stone-100 dark:bg-stone-800" />
      <div className="p-4 space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 bg-stone-100 dark:bg-stone-800 rounded" />
        ))}
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  /** If provided, the parent already fetched the data. Otherwise the
   *  component fetches independently. */
  flags?: RiskFlagRow[];
}

export default function RiskRadarPanel({ flags: propFlags }: Props) {
  const [flags, setFlags]     = useState<RiskFlagRow[] | null>(propFlags ?? null);
  const [loading, setLoading] = useState(!propFlags);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (propFlags !== undefined) return; // parent controls the data
    fetch("/api/head-office/risk-flags")
      .then((r) => r.json())
      .then((d: { data: RiskFlagRow[]; error: string | null }) => {
        setFlags(Array.isArray(d.data) ? d.data : []);
        setLoading(false);
      })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, [propFlags]);

  const criticalCount = (flags ?? []).filter((f) => f.severity === "critical").length;
  const warningCount  = (flags ?? []).filter((f) => f.severity === "warning").length;

  const severityGroups = flags
    ? [
        { key: "critical", label: "Critical", headerCls: "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400" },
        { key: "warning",  label: "Warning",  headerCls: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400" },
        { key: "info",     label: "Info",     headerCls: "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400" },
      ]
        .map((g) => ({ ...g, items: flags.filter((f) => f.severity === g.key) }))
        .filter((g) => g.items.length > 0)
    : [];

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60">
        <div className="flex items-center gap-2">
          <span className="text-base">🎯</span>
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Risk Radar</h3>
          {!loading && flags !== null && (
            <span className="text-[10px] text-stone-500 dark:text-stone-400">
              Top {flags.length} of all stores
            </span>
          )}
        </div>
        {!loading && flags !== null && flags.length > 0 && (
          <div className="flex items-center gap-2">
            {criticalCount > 0 && (
              <span className="rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 px-2 py-0.5 text-[10px] font-bold">
                {criticalCount} critical
              </span>
            )}
            {warningCount > 0 && (
              <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-2 py-0.5 text-[10px] font-bold">
                {warningCount} warning
              </span>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-0">
        {loading && <Skeleton />}

        {!loading && error && (
          <p className="px-5 py-4 text-xs text-red-500 font-mono">{error}</p>
        )}

        {!loading && !error && flags !== null && flags.length === 0 && (
          <div className="px-5 py-8 text-center">
            <p className="text-2xl mb-1">✅</p>
            <p className="text-sm font-medium text-stone-600 dark:text-stone-400">
              All stores operating normally
            </p>
            <p className="text-[11px] text-stone-500 mt-0.5">No active risk signals detected</p>
          </div>
        )}

        {!loading && !error && flags !== null && flags.length > 0 && (
          <div className="divide-y divide-stone-100 dark:divide-stone-800">
            {severityGroups.map((group) => (
              <div key={group.key}>
                {/* Severity group header */}
                <div className={cn("px-5 py-1 text-[9px] font-bold uppercase tracking-widest", group.headerCls)}>
                  {group.label}
                </div>
                {group.items.map((flag) => {
                  const style = SEV_STYLE[flag.severity] ?? SEV_STYLE.info;
                  return (
                    <div
                      key={`${flag.site_id}-${flag.issue_type}`}
                      className={cn("flex items-start gap-3 px-5 py-3 hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors", style.row)}
                    >
                      {/* Main info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 truncate">
                            {flag.store_name}
                          </span>
                          <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide", style.badge)}>
                            {ISSUE_TYPE_LABEL[flag.issue_type] ?? flag.issue_type}
                          </span>
                        </div>
                        <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 leading-snug">
                          {flag.issue}
                        </p>
                        {flag.metric_value !== null && flag.metric_label && (
                          <p className={cn(
                            "text-[10px] mt-0.5 font-mono font-semibold",
                            flag.issue_type === "no_revenue_data"
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-stone-600 dark:text-stone-500"
                          )}>
                            {flag.metric_value} {flag.metric_label}
                          </p>
                        )}
                        {flag.issue_type === "no_revenue_data" && flag.metric_value === null && (
                          <p className="text-[10px] mt-0.5 text-amber-600 dark:text-amber-400 font-semibold">
                            Revenue missing — no data recorded
                          </p>
                        )}
                      </div>

                      {/* Severity icon */}
                      <span className="shrink-0 text-sm mt-0.5">{style.icon}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
