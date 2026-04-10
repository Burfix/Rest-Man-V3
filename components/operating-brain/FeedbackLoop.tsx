/**
 * FeedbackLoop — Closes the loop between brain decisions and operational outcomes.
 *
 * Includes addiction mechanics: momentum, score progress bar, sparkline with
 * best/worst highlights, best shift this week, and consequence escalation.
 */

"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

type DayStat = {
  stat_date: string;
  total_created: number;
  total_completed: number;
  total_revenue_delta: number | null;
};

type PerfData = {
  today: {
    pending: number;
    in_progress: number;
    completed: number;
    total: number;
    completion_rate_pct: number;
  };
  last_7_days: {
    avg_resolution_minutes: number | null;
    avg_actions_per_day: number | null;
    daily_stats: DayStat[];
  };
};

export type FeedbackLoopProps = {
  score:         number;
  grade:         string;
  nextGrade:     string | null;
  ptsToNextGrade: number;
  tradingTrend:  "improving" | "stable" | "declining";
  gmTier:        string;
  gmName:        string;
};

const GRADE_THRESHOLDS: Record<string, number> = { D: 50, C: 65, B: 80, A: 90, F: 0 };
const PREV_THRESHOLD: Record<string, number>   = { A: 90, B: 80, C: 65, D: 50, F: 0 };

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function shortDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return DOW[d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1] ?? iso.slice(5);
}

export default function FeedbackLoop({
  score,
  grade,
  nextGrade,
  ptsToNextGrade,
  tradingTrend,
  gmTier,
  gmName,
}: FeedbackLoopProps) {
  const [data, setData] = useState<PerfData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/actions/performance")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  // ── Score progress bar ───────────────────────────────────────────────────
  const prevThreshold = grade === "A" ? 90 : (GRADE_THRESHOLDS[grade] ?? 0);
  const nextThreshold = nextGrade ? (GRADE_THRESHOLDS[nextGrade] ?? 100) : 100;
  const progressRange = nextThreshold - prevThreshold;
  const progressFill  = progressRange > 0
    ? Math.round(Math.min(100, Math.max(0, (score - prevThreshold) / progressRange * 100)))
    : 100;

  // ── Momentum indicators ──────────────────────────────────────────────────
  const trendLabel  = tradingTrend === "improving" ? "↑ Improving" : tradingTrend === "declining" ? "↓ Declining" : "→ Stable";
  const trendColor  = tradingTrend === "improving" ? "text-emerald-400" : tradingTrend === "declining" ? "text-red-400" : "text-stone-500 dark:text-stone-400";

  // ── At Risk escalation ───────────────────────────────────────────────────
  const isAtRisk = gmTier === "At Risk";

  if (loading) {
    return (
      <div className="rounded-xl border border-stone-200 dark:border-stone-800/40 bg-stone-50 dark:bg-stone-900/50 px-5 py-6 animate-pulse">
        <div className="h-3 w-24 bg-stone-100 dark:bg-stone-800 rounded mb-4" />
        <div className="h-12 bg-stone-100 dark:bg-stone-800/50 rounded" />
      </div>
    );
  }

  const today = data?.today;
  const last7 = data?.last_7_days;

  const totalRevRecovered = last7?.daily_stats.reduce((s, d) => s + (d.total_revenue_delta ?? 0), 0) ?? 0;
  const totalCompleted7d  = last7?.daily_stats.reduce((s, d) => s + (d.total_completed ?? 0), 0) ?? 0;

  // ── Sparkline analysis ───────────────────────────────────────────────────
  const sparkData = last7 ? [...last7.daily_stats].reverse() : [];
  const completedValues = sparkData.map((d) => d.total_completed);
  const maxVal = Math.max(1, ...completedValues);
  const minVal = Math.min(...completedValues);
  const maxIdx = completedValues.indexOf(maxVal);
  const minIdx = completedValues.findLastIndex((v) => v === minVal && v < maxVal);

  // Best shift this week
  const bestDay = sparkData[maxIdx];
  const bestDayLabel = bestDay ? shortDate(bestDay.stat_date) : null;

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800/40 bg-stone-50 dark:bg-stone-900/50 px-5 py-4 space-y-4">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium">
        Performance Momentum
      </h2>

      {/* ── Momentum row ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-black font-mono text-stone-900 dark:text-stone-100">{score}</span>
          <span className="text-base font-black font-mono text-amber-400">{grade}</span>
        </div>
        <span className={cn("text-[11px] font-mono font-semibold", trendColor)}>
          {trendLabel}
        </span>
        {isAtRisk && (
          <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-red-400 border border-red-900/50 bg-red-950/20 px-1.5 py-0.5">
            AT RISK
          </span>
        )}
      </div>

      {/* ── Progress bar to next grade ── */}
      {nextGrade && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-stone-500 uppercase tracking-wider">
              {ptsToNextGrade} pts to Grade {nextGrade}
            </span>
            <span className="text-[10px] font-mono text-stone-600">
              {progressFill}%
            </span>
          </div>
          <div className="h-2 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-700"
              style={{ width: `${progressFill}%` }}
            />
          </div>
          <p className="text-[10px] text-stone-600 font-mono">
            {grade === "D" ? (
              <span>Complete duties (+14) + any small win (+1)</span>
            ) : grade === "C" ? (
              <span>Resolve compliance or maintenance to reach Grade {nextGrade}</span>
            ) : (
              <span>Close revenue gap and maintain labour target for Grade {nextGrade}</span>
            )}
          </p>
        </div>
      )}

      {/* ── Today's task metrics ── */}
      {today && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={cn(
              "text-lg font-black font-mono",
              today.completion_rate_pct >= 60 ? "text-emerald-400" :
              today.completion_rate_pct >= 30 ? "text-amber-400" : "text-red-400",
            )}>
              {today.completion_rate_pct}%
            </span>
            <p className="text-[10px] text-stone-500 uppercase tracking-wider mt-0.5">Completion Today</p>
            <p className="text-[10px] text-stone-600">{today.completed} of {today.total}</p>
          </div>
          <div>
            <span className={cn(
              "text-lg font-black font-mono",
              totalRevRecovered > 0 ? "text-emerald-400" : totalRevRecovered < 0 ? "text-red-400" : "text-stone-600 dark:text-stone-300",
            )}>
              {totalRevRecovered !== 0
                ? `R${Math.abs(totalRevRecovered).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`
                : "—"}
            </span>
            <p className="text-[10px] text-stone-500 uppercase tracking-wider mt-0.5">Revenue Impact</p>
            <p className="text-[10px] text-stone-600">{totalRevRecovered > 0 ? "recovered" : totalRevRecovered < 0 ? "lost" : "neutral"} 7d</p>
          </div>
        </div>
      )}

      {/* ── 7-day sparkline ── */}
      {sparkData.length > 0 && (
        <div className="space-y-1">
          <span className="text-[9px] uppercase tracking-wider text-stone-600 font-medium">Last 7 Days</span>
          <div className="flex items-end gap-1 h-10">
            {sparkData.map((d, i) => {
              const hPct  = (d.total_completed / maxVal) * 100;
              const isBest  = i === maxIdx && maxVal > 0;
              const isWorst = i === minIdx && d.total_completed < maxVal;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <div
                    className={cn(
                      "w-full rounded-t-sm transition-all",
                      isBest  ? "bg-emerald-500/70" :
                      isWorst && d.total_completed === 0 ? "bg-red-500/50" :
                      "bg-stone-600/50",
                    )}
                    style={{ height: `${Math.max(hPct, 6)}%` }}
                    title={`${shortDate(d.stat_date)}: ${d.total_completed} completed`}
                  />
                  <span className="text-[8px] text-stone-700">{shortDate(d.stat_date)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Best shift this week ── */}
      {bestDay && bestDay.total_completed > 0 && (
        <div className="border-t border-stone-200 dark:border-stone-800/40 pt-3">
          <span className="text-[9px] uppercase tracking-wider text-stone-600 font-medium block mb-0.5">
            Best Shift This Week
          </span>
          <p className="text-[10px] font-mono text-stone-500 dark:text-stone-400">
            <span className="text-emerald-400 font-bold">{bestDayLabel}</span>
            {" · "}{bestDay.total_completed} actions completed
            {gmName && gmName !== "Unknown" && (
              <span className="text-stone-600"> · {gmName}</span>
            )}
          </p>
        </div>
      )}

      {/* ── Consequence if ignored ── */}
      {isAtRisk && (
        <div className={cn(
          "border-t border-stone-200 dark:border-stone-800/40 pt-3",
        )}>
          <p className={cn(
            "text-[10px] font-mono leading-snug",
            "text-red-400",
          )}>
            3 consecutive Grade D days triggers Head Office review.
          </p>
        </div>
      )}
      {!isAtRisk && grade === "D" && (
        <div className="border-t border-stone-200 dark:border-stone-800/40 pt-3">
          <p className="text-[10px] font-mono text-amber-500 leading-snug">
            Sustained Grade D performance leads to Head Office escalation.
          </p>
        </div>
      )}
    </div>
  );
}
