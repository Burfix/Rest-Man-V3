"use client";

/**
 * OpsCenterPanel
 *
 * Head Office NOC — Operational Reliability Map
 *
 * Shows per-site reliability grade (A–D), active alert counts, and feed health
 * derived from micros_sync_runs history + v_site_health_summary.
 *
 * Data: GET /api/head-office/ops-center
 * Refreshes every 5 minutes automatically.
 */

import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { OpsCenterPayload, SiteOpsRow } from "@/app/api/head-office/ops-center/route";

// ── Grade palette ─────────────────────────────────────────────────────────────

const GRADE_STYLE: Record<string, { badge: string; text: string }> = {
  A: { badge: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800", text: "text-emerald-600" },
  B: { badge: "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800", text: "text-sky-600" },
  C: { badge: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800", text: "text-amber-600" },
  D: { badge: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800", text: "text-red-600" },
};

const HEALTH_ROW: Record<string, string> = {
  critical: "border-l-2 border-l-red-500",
  warning:  "border-l-2 border-l-amber-400",
  healthy:  "border-l-2 border-l-emerald-400",
  unknown:  "border-l-2 border-l-stone-300 dark:border-l-stone-600",
};

const FEED_LABEL: Record<string, string> = {
  sales:     "Rev",
  labour:    "Lab",
  inventory: "Inv",
};

// ── Feed mini-badge ───────────────────────────────────────────────────────────

function FeedDot({
  score,
  consecutiveFailures,
  label,
}: {
  score: number;
  consecutiveFailures: number;
  label: string;
}) {
  const color =
    consecutiveFailures >= 3 ? "bg-red-500"     :
    score >= 80             ? "bg-emerald-500"  :
    score >= 60             ? "bg-amber-400"    :
    score >= 40             ? "bg-orange-500"   :
    "bg-red-500";

  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-mono text-stone-500 dark:text-stone-400"
      title={`${label}: score ${score}, ${consecutiveFailures} consecutive failures`}
    >
      <span className={cn("inline-block h-1.5 w-1.5 rounded-full", color)} />
      {label}
    </span>
  );
}

// ── Score bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 90 ? "bg-emerald-500" :
    score >= 75 ? "bg-sky-500"     :
    score >= 60 ? "bg-amber-500"   :
    "bg-red-500";
  return (
    <div className="h-1 w-16 rounded-full bg-stone-200 dark:bg-stone-700">
      <div
        className={cn("h-1 rounded-full transition-all", color)}
        style={{ width: `${Math.min(score, 100)}%` }}
      />
    </div>
  );
}

// ── Group summary cards ───────────────────────────────────────────────────────

function GroupSummary({ payload }: { payload: OpsCenterPayload }) {
  const { group } = payload;
  const { gradeCounts, totalAlerts, criticalSites, avgReliability } = group;

  const reliabilityColor =
    avgReliability >= 90 ? "text-emerald-600 dark:text-emerald-400" :
    avgReliability >= 75 ? "text-sky-600 dark:text-sky-400"         :
    avgReliability >= 60 ? "text-amber-600 dark:text-amber-400"     :
    "text-red-600 dark:text-red-400";

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 p-4 border-b border-stone-100 dark:border-stone-800">
      <div className="rounded-lg bg-stone-50 dark:bg-stone-800/60 p-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Avg Reliability</p>
        <p className={cn("text-xl font-bold tabular-nums mt-0.5", reliabilityColor)}>{avgReliability}</p>
        <ScoreBar score={avgReliability} />
      </div>
      <div className="rounded-lg bg-stone-50 dark:bg-stone-800/60 p-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Grade Split</p>
        <div className="mt-1 flex items-center gap-1 flex-wrap">
          {(["A", "B", "C", "D"] as const).map((g) =>
            gradeCounts[g] > 0 ? (
              <span
                key={g}
                className={cn("rounded px-1.5 py-0.5 text-xs font-bold", GRADE_STYLE[g].badge)}
              >
                {g}×{gradeCounts[g]}
              </span>
            ) : null,
          )}
          {Object.values(gradeCounts).every((v) => v === 0) && (
            <span className="text-xs text-stone-400">No data</span>
          )}
        </div>
      </div>
      <div className="rounded-lg bg-stone-50 dark:bg-stone-800/60 p-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Critical Sites</p>
        <p className={cn("text-xl font-bold tabular-nums mt-0.5", criticalSites > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
          {criticalSites}
        </p>
        <p className="text-[10px] text-stone-400 mt-0.5">of {payload.sites.length} sites</p>
      </div>
      <div className="rounded-lg bg-stone-50 dark:bg-stone-800/60 p-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Active Alerts</p>
        <div className="mt-1 flex items-center gap-2">
          {totalAlerts.critical > 0 && (
            <span className="text-sm font-bold text-red-600 dark:text-red-400">
              🔴 {totalAlerts.critical}
            </span>
          )}
          {totalAlerts.warning > 0 && (
            <span className="text-sm font-bold text-amber-600 dark:text-amber-400">
              ⚠️ {totalAlerts.warning}
            </span>
          )}
          {totalAlerts.critical === 0 && totalAlerts.warning === 0 && (
            <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">All clear</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Site row ──────────────────────────────────────────────────────────────────

function SiteRow({ site }: { site: SiteOpsRow }) {
  const grade = GRADE_STYLE[site.reliabilityGrade] ?? GRADE_STYLE.D;
  const rowBorder = HEALTH_ROW[site.health] ?? HEALTH_ROW.unknown;

  return (
    <div className={cn("flex items-center gap-3 px-4 py-3 hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors", rowBorder)}>
      {/* Grade badge */}
      <span className={cn("flex-shrink-0 rounded px-2 py-0.5 text-xs font-bold tabular-nums w-8 text-center", grade.badge)}>
        {site.reliabilityGrade}
      </span>

      {/* Site name */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-stone-800 dark:text-stone-200 truncate">
          {site.siteName}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <ScoreBar score={site.reliabilityScore} />
          <span className="text-[10px] font-mono text-stone-400">{site.reliabilityScore}</span>
        </div>
      </div>

      {/* Feed dots */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {site.feeds.length > 0
          ? site.feeds.map((f) => (
              <FeedDot
                key={f.feedType}
                score={f.score}
                consecutiveFailures={f.consecutiveFailures}
                label={FEED_LABEL[f.feedType] ?? f.feedType}
              />
            ))
          : <span className="text-[10px] text-stone-400">No feed data</span>
        }
      </div>

      {/* Alert indicators */}
      <div className="flex-shrink-0 w-24 text-right">
        {site.alerts.critical > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
            🔴 {site.alerts.topMessage ?? `${site.alerts.critical} critical`}
          </span>
        ) : site.alerts.warning > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
            ⚠️ {site.alerts.topMessage ?? `${site.alerts.warning} warnings`}
          </span>
        ) : (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Healthy</span>
        )}
      </div>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="animate-pulse space-y-2 p-4">
      <div className="grid grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 rounded-lg bg-stone-100 dark:bg-stone-800" />
        ))}
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-10 rounded bg-stone-100 dark:bg-stone-800" />
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export default function OpsCenterPanel() {
  const [payload, setPayload] = useState<OpsCenterPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetch_ = useCallback(() => {
    fetch("/api/head-office/ops-center")
      .then((r) => r.json())
      .then((d: OpsCenterPayload) => {
        setPayload(d.ok ? d : null);
        setError(d.ok ? null : "Failed to load ops data");
        setLoading(false);
        setLastFetched(new Date());
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetch_();
    const interval = setInterval(fetch_, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetch_]);

  // Sort: critical first, then by reliability score ascending (worst first)
  const HEALTH_ORDER: Record<string, number> = { critical: 0, warning: 1, unknown: 2, healthy: 3 };
  const sorted = payload
    ? [...payload.sites].sort((a, b) => {
        const healthDiff = (HEALTH_ORDER[a.health] ?? 4) - (HEALTH_ORDER[b.health] ?? 4);
        if (healthDiff !== 0) return healthDiff;
        return a.reliabilityScore - b.reliabilityScore;
      })
    : [];

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60">
        <div className="flex items-center gap-2">
          <span className="text-base">🛰️</span>
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">
            Ops Reliability Center
          </h3>
        </div>
        <div className="flex items-center gap-3">
          {lastFetched && (
            <span className="text-[10px] text-stone-400">
              Updated {lastFetched.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={fetch_}
            className="text-xs text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && <Skeleton />}

      {!loading && error && (
        <div className="p-4 text-sm text-red-600 dark:text-red-400">{error}</div>
      )}

      {!loading && payload && (
        <>
          <GroupSummary payload={payload} />
          <div className="divide-y divide-stone-100 dark:divide-stone-800">
            {sorted.length === 0 ? (
              <p className="px-5 py-4 text-sm text-stone-400">No sites found.</p>
            ) : (
              sorted.map((site) => <SiteRow key={site.siteId} site={site} />)
            )}
          </div>
        </>
      )}
    </div>
  );
}
