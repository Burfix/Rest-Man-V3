"use client";

/**
 * ReliabilityTrendCard
 *
 * 14-day reliability history for the site-level System Health page.
 *
 * Shows:
 *   - Trend score headline (weighted 14-day average)
 *   - Per-day bar chart (overall score, CSS-only — no charting dependency)
 *   - Per-feed mini-legend (Rev · Lab · Inv success rates for the latest day)
 *
 * Data: GET /api/system-health/reliability-trend
 */

import { useEffect, useState } from "react";
import { cn }                  from "@/lib/utils";
import type { ReliabilityTrend, DailyReliability } from "@/lib/reliability/trend";

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(score: number, hasData: boolean): string {
  if (!hasData) return "bg-stone-100 dark:bg-stone-800";
  if (score >= 90) return "bg-emerald-500";
  if (score >= 75) return "bg-sky-500";
  if (score >= 60) return "bg-amber-500";
  return "bg-red-500";
}

function scoreTextColor(score: number): string {
  if (score >= 90) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 75) return "text-sky-600 dark:text-sky-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function shortDate(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00Z");
  return d.toLocaleDateString("en-ZA", { month: "short", day: "numeric" });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DayBar({ day, maxScore }: { day: DailyReliability; maxScore: number }) {
  const heightPct = maxScore > 0 ? (day.overall / maxScore) * 100 : 0;
  return (
    <div className="flex flex-col items-center gap-1" title={`${shortDate(day.date)}: ${day.hasData ? `${day.overall}%` : "No data"}`}>
      <div className="relative flex h-16 w-full items-end justify-center">
        <div
          className={cn(
            "w-full rounded-t transition-all",
            day.hasData ? scoreColor(day.overall, true) : "bg-stone-100 dark:bg-stone-800",
          )}
          style={{ height: day.hasData ? `${Math.max(heightPct, 4)}%` : "4%" }}
        />
      </div>
      <span className="text-[9px] tabular-nums text-stone-400 leading-none">
        {shortDate(day.date).split(" ")[1]}
      </span>
    </div>
  );
}

function FeedStat({ label, rate, runs }: { label: string; rate: number; runs: number }) {
  const color =
    runs === 0    ? "text-stone-400" :
    rate >= 90    ? "text-emerald-600 dark:text-emerald-400" :
    rate >= 60    ? "text-amber-600 dark:text-amber-400" :
    "text-red-600 dark:text-red-400";

  return (
    <div className="flex flex-col items-center">
      <span className="text-[10px] text-stone-400">{label}</span>
      <span className={cn("text-sm font-semibold tabular-nums", color)}>
        {runs === 0 ? "—" : `${rate}%`}
      </span>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3 p-4">
      <div className="h-6 w-24 rounded bg-stone-100 dark:bg-stone-800" />
      <div className="flex items-end gap-1 h-16">
        {Array.from({ length: 14 }, (_, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-stone-100 dark:bg-stone-800"
            style={{ height: `${30 + Math.random() * 60}%` }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ReliabilityTrendCard() {
  const [trend, setTrend]   = useState<ReliabilityTrend | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/system-health/reliability-trend?days=14")
      .then((r) => r.json())
      .then((d: ReliabilityTrend) => { setTrend(d); setLoading(false); })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, []);

  // Most-recent day with data for feed stats
  const latestDay = trend?.days.find((d) => d.hasData) ?? null;
  // Bar chart: oldest → newest (reverse array for visual left-to-right)
  const barsLeft  = trend ? [...trend.days].reverse() : [];
  const maxScore  = barsLeft.reduce((m, d) => (d.hasData ? Math.max(m, d.overall) : m), 1);

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="border-b border-zinc-200 dark:border-zinc-800 px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Reliability Trend
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              14-day sync success rate by feed
            </p>
          </div>
          {trend && (
            <div className="text-right">
              <p className={cn("text-2xl font-bold tabular-nums", scoreTextColor(trend.trendScore))}>
                {trend.trendScore}
              </p>
              <p className="text-[10px] text-zinc-400">avg score</p>
            </div>
          )}
        </div>
      </div>

      {loading && <Skeleton />}

      {!loading && error && (
        <p className="px-5 py-4 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {!loading && trend && (
        <div className="p-4 space-y-4">
          {/* Bar chart */}
          <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${barsLeft.length}, 1fr)` }}>
            {barsLeft.map((day) => (
              <DayBar key={day.date} day={day} maxScore={maxScore} />
            ))}
          </div>

          {/* Feed stats for latest active day */}
          {latestDay && (
            <div className="flex items-center justify-around border-t border-zinc-100 dark:border-zinc-800 pt-3">
              {latestDay.feeds.map((f) => (
                <FeedStat
                  key={f.feedType}
                  label={f.feedType === "sales" ? "Rev" : f.feedType === "labour" ? "Lab" : "Inv"}
                  rate={f.successRate}
                  runs={f.totalRuns}
                />
              ))}
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-stone-400">Active days</span>
                <span className="text-sm font-semibold text-stone-700 dark:text-stone-300">
                  {trend.activeDays}
                </span>
              </div>
            </div>
          )}

          {!latestDay && (
            <p className="text-center text-xs text-zinc-400 py-2">
              No sync history in the last 14 days.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
