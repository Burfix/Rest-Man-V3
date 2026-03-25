/**
 * FeedbackLoop — Shows what actions were taken, revenue recovered,
 * and the performance trend over time. Closes the loop between
 * decisions and outcomes.
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

export default function FeedbackLoop() {
  const [data, setData] = useState<PerfData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/actions/performance")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 px-5 py-6 animate-pulse">
        <div className="h-3 w-24 bg-stone-800 rounded mb-4" />
        <div className="h-12 bg-stone-800/50 rounded" />
      </div>
    );
  }

  if (!data) return null;

  const { today, last_7_days } = data;
  const totalRevRecovered = last_7_days.daily_stats.reduce(
    (s, d) => s + (d.total_revenue_delta ?? 0),
    0,
  );
  const totalCompleted7d = last_7_days.daily_stats.reduce(
    (s, d) => s + (d.total_completed ?? 0),
    0,
  );

  const metrics = [
    {
      label: "Completed Today",
      value: `${today.completed}`,
      sub: `of ${today.total} total`,
      tone: today.completion_rate_pct >= 60 ? "emerald" : today.completion_rate_pct >= 30 ? "amber" : "red",
    },
    {
      label: "Completion Rate",
      value: `${today.completion_rate_pct}%`,
      sub: "today",
      tone: today.completion_rate_pct >= 60 ? "emerald" : today.completion_rate_pct >= 30 ? "amber" : "red",
    },
    {
      label: "Revenue Impact",
      value: totalRevRecovered !== 0
        ? `R${Math.abs(totalRevRecovered).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`
        : "—",
      sub: totalRevRecovered > 0 ? "recovered (7d)" : totalRevRecovered < 0 ? "lost (7d)" : "7d",
      tone: totalRevRecovered > 0 ? "emerald" : totalRevRecovered < 0 ? "red" : "stone",
    },
    {
      label: "Actions (7d)",
      value: `${totalCompleted7d}`,
      sub: last_7_days.avg_resolution_minutes != null
        ? `avg ${last_7_days.avg_resolution_minutes}m`
        : "no data",
      tone: "stone",
    },
  ];

  const toneColor: Record<string, { value: string; bar: string }> = {
    emerald: { value: "text-emerald-400", bar: "bg-emerald-500" },
    amber: { value: "text-amber-400", bar: "bg-amber-500" },
    red: { value: "text-red-400", bar: "bg-red-500" },
    stone: { value: "text-stone-300", bar: "bg-stone-600" },
  };

  // Sparkline from daily stats (last 7 days)
  const sparkData = [...last_7_days.daily_stats].reverse();
  const maxCompleted = Math.max(1, ...sparkData.map((d) => d.total_completed));

  return (
    <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 px-5 py-4">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium mb-3">
        Feedback Loop
      </h2>

      {/* Metric chips */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.map((m) => {
          const tc = toneColor[m.tone] ?? toneColor.stone;
          return (
            <div key={m.label} className="text-center">
              <span className={cn("text-lg font-black font-mono", tc.value)}>
                {m.value}
              </span>
              <p className="text-[10px] text-stone-500 uppercase tracking-wider mt-0.5">
                {m.label}
              </p>
              <p className="text-[10px] text-stone-600">{m.sub}</p>
            </div>
          );
        })}
      </div>

      {/* 7-day sparkline */}
      {sparkData.length > 0 && (
        <div className="mt-4 flex items-end gap-1 h-8">
          {sparkData.map((d, i) => {
            const hPct = (d.total_completed / maxCompleted) * 100;
            return (
              <div
                key={i}
                className="flex-1 bg-emerald-500/30 rounded-t-sm transition-all"
                style={{ height: `${Math.max(hPct, 6)}%` }}
                title={`${d.stat_date}: ${d.total_completed} completed`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
