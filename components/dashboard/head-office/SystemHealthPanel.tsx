"use client";

/**
 * SystemHealthPanel
 *
 * Shows per-store data freshness, last sync time, and warning counts.
 * Data comes from GET /api/head-office/system-health (v_site_health_summary).
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SystemHealthStore = {
  site_id: string;
  store_name: string;
  store_code: string;
  health: "healthy" | "warning" | "critical" | "unknown";
  integration_status: string;
  last_sync_at: string | null;
  stale_minutes: number | null;
  last_sales_date: string | null;
  recent_errors: number;
  failed_runs: number;
};

export type SystemHealthSummary = {
  total: number;
  healthy: number;
  warning: number;
  critical: number;
  unknown: number;
  stale_count: number;
  with_errors: number;
  last_sync_at: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return "Waiting for data";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)    return "just now";
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtDate(d: string | null): string {
  if (!d) return "Waiting for data";
  return d;
}

// ── Health palette ────────────────────────────────────────────────────────────

const HEALTH_STYLE: Record<string, { dot: string; text: string }> = {
  healthy:  { dot: "bg-emerald-500",           text: "text-emerald-600 dark:text-emerald-400" },
  warning:  { dot: "bg-amber-400",             text: "text-amber-600 dark:text-amber-400" },
  critical: { dot: "bg-red-500 animate-ping",  text: "text-red-600 dark:text-red-400" },
  unknown:  { dot: "bg-stone-400",             text: "text-stone-500 dark:text-stone-400" },
};

const HEALTH_LABEL: Record<string, string> = {
  healthy:  "Operating Normally",
  warning:  "Action Required",
  critical: "Critical",
  unknown:  "Waiting for data",
};

// ── Loading skeleton ──────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3 p-4">
      <div className="grid grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 rounded-lg bg-stone-100 dark:bg-stone-800" />
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-8 rounded bg-stone-100 dark:bg-stone-800" />
      ))}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SystemHealthPanel() {
  const [stores, setStores]     = useState<SystemHealthStore[]>([]);
  const [summary, setSummary]   = useState<SystemHealthSummary | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/head-office/system-health")
      .then((r) => r.json())
      .then((d: { data: SystemHealthStore[]; summary: SystemHealthSummary; error: string | null }) => {
        setStores(Array.isArray(d.data) ? d.data : []);
        setSummary(d.summary ?? null);
        setLoading(false);
      })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, []);

  // Sort: critical first
  const HEALTH_ORDER: Record<string, number> = { critical: 0, warning: 1, unknown: 2, healthy: 3 };
  const sorted = [...stores].sort(
    (a, b) => (HEALTH_ORDER[a.health] ?? 4) - (HEALTH_ORDER[b.health] ?? 4),
  );

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60">
        <div className="flex items-center gap-2">
          <span className="text-base">💓</span>
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">System Health</h3>
        </div>
        {summary && (
          <span className="text-[10px] text-stone-500 dark:text-stone-400">
            Last sync: {timeAgo(summary.last_sync_at)}
          </span>
        )}
      </div>

      {/* Exec summary strip: Data Freshness / Last Sync / Stores with Errors */}
      {summary && (
        <div className="grid grid-cols-3 gap-px bg-stone-100 dark:bg-stone-800 border-b border-stone-100 dark:border-stone-800">
          <div className="bg-white dark:bg-stone-900 px-4 py-2.5 flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full shrink-0", summary.stale_count === 0 ? "bg-emerald-500" : "bg-amber-400")} />
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-stone-400">Data Freshness</p>
              <p className={cn("text-xs font-bold", summary.stale_count === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
                {summary.stale_count === 0 ? "GOOD" : "STALE"}
              </p>
            </div>
          </div>
          <div className="bg-white dark:bg-stone-900 px-4 py-2.5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-stone-400">Last Sync</p>
            <p className="text-xs font-semibold text-stone-700 dark:text-stone-300 tabular-nums">
              {timeAgo(summary.last_sync_at)}
            </p>
          </div>
          <div className="bg-white dark:bg-stone-900 px-4 py-2.5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-stone-400">Stores with Errors</p>
            <p className={cn("text-xs font-bold tabular-nums", summary.with_errors > 0 ? "text-red-600 dark:text-red-400" : "text-stone-600 dark:text-stone-400")}>
              {summary.with_errors > 0 ? summary.with_errors : "None"}
            </p>
          </div>
        </div>
      )}

      {/* Summary strip */}
      {summary && (
        <div className="grid grid-cols-4 gap-px bg-stone-100 dark:bg-stone-800 border-b border-stone-200 dark:border-stone-800">
          {[
            { label: "Healthy",  value: summary.healthy,  color: "text-emerald-600 dark:text-emerald-400", bg: "bg-white dark:bg-stone-900" },
            { label: "Warning",  value: summary.warning,  color: "text-amber-600 dark:text-amber-400",    bg: "bg-white dark:bg-stone-900" },
            { label: "Critical", value: summary.critical, color: "text-red-600 dark:text-red-400",        bg: "bg-white dark:bg-stone-900" },
            { label: "Errors",   value: summary.with_errors, color: "text-orange-600 dark:text-orange-400", bg: "bg-white dark:bg-stone-900" },
          ].map((s) => (
            <div key={s.label} className={cn("flex flex-col items-center justify-center py-3", s.bg)}>
              <span className={cn("text-xl font-black tabular-nums leading-none", s.color)}>
                {s.value}
              </span>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-stone-500 mt-0.5">
                {s.label}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Body */}
      <div>
        {loading && <Skeleton />}

        {!loading && error && (
          <p className="px-5 py-4 text-xs text-red-500 font-mono">{error}</p>
        )}

        {!loading && !error && sorted.length === 0 && (
          <p className="px-5 py-6 text-center text-sm text-stone-500">No store health data available</p>
        )}

        {!loading && !error && sorted.length > 0 && (
          <div className="divide-y divide-stone-100 dark:divide-stone-800">
            {/* Header row */}
            <div className="grid grid-cols-12 gap-2 px-5 py-2 text-[9px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-600 bg-stone-50 dark:bg-stone-900/40">
              <div className="col-span-4">Store</div>
              <div className="col-span-2">Health</div>
              <div className="col-span-3">Last Sync</div>
              <div className="col-span-3">Last Sales</div>
            </div>

            {sorted.map((s) => {
              const style = HEALTH_STYLE[s.health] ?? HEALTH_STYLE.unknown;
              return (
                <div
                  key={s.site_id}
                  className="grid grid-cols-12 gap-2 px-5 py-2.5 items-center hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors"
                >
                  {/* Store name */}
                  <div className="col-span-4">
                    <p className="text-xs font-medium text-stone-700 dark:text-stone-200 truncate">
                      {s.store_name}
                    </p>
                    {s.recent_errors > 0 && (
                      <p className="text-[10px] text-red-500 font-mono">
                        {s.recent_errors} error{s.recent_errors > 1 ? "s" : ""}
                      </p>
                    )}
                  </div>

                  {/* Health indicator */}
                  <div className="col-span-2 flex items-center gap-1.5">
                    <span className="relative">
                      <span className={cn("h-2 w-2 rounded-full block", style.dot)} />
                    </span>
                    <span className={cn("text-[10px] font-semibold", style.text)}>
                      {HEALTH_LABEL[s.health] ?? s.health}
                    </span>
                  </div>

                  {/* Last sync */}
                  <div className="col-span-3 text-[11px] text-stone-500 dark:text-stone-400 tabular-nums">
                    {s.last_sync_at ? timeAgo(s.last_sync_at) : "Waiting for data"}
                    {s.stale_minutes !== null && s.stale_minutes > 120 && (
                      <div className="text-[10px] text-amber-500 font-medium">
                        {Math.floor(s.stale_minutes / 60)}h stale
                      </div>
                    )}
                  </div>

                  {/* Last sales date */}
                  <div className="col-span-3 text-[11px] text-stone-500 dark:text-stone-400">
                    {fmtDate(s.last_sales_date)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
