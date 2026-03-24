/**
 * ServicePulse — Merged forecast vs actual + peak readiness.
 *
 * One intelligent card showing:
 * - Revenue pacing (actual vs target)
 * - Peak window & countdown
 * - Insights (plain English, consequence-aware)
 *
 * When live data is unavailable, shows forecast-only mode.
 */

"use client";

import { cn } from "@/lib/utils";

type Props = {
  actual: number;
  target: number;
  variancePercent: number;
  covers: number;
  avgSpend: number;
  peakWindow?: string | null;
  timeToPeakMinutes?: number | null;
  forecastCovers?: number | null;
  insights: string[];
  isLive: boolean;
};

export default function ServicePulse({
  actual,
  target,
  variancePercent,
  covers,
  avgSpend,
  peakWindow,
  timeToPeakMinutes,
  forecastCovers,
  insights,
  isLive,
}: Props) {
  const isAhead = variancePercent >= 0;
  const pacePercent = target > 0 ? Math.min((actual / target) * 100, 100) : 0;

  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        Service Pulse
      </h2>
      <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 p-4">
        {/* Pace bar */}
        <div className="flex items-end justify-between mb-2">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-stone-500">
              {isLive ? "Live" : "Forecast"} Revenue
            </span>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-xl font-bold text-stone-100 font-mono">
                R{actual.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}
              </span>
              <span className="text-xs text-stone-500">
                / R{target.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}
              </span>
            </div>
          </div>
          <span
            className={cn(
              "text-sm font-bold",
              isAhead ? "text-emerald-400" : "text-red-400",
            )}
          >
            {isAhead ? "+" : ""}{variancePercent.toFixed(1)}%
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 w-full rounded-full bg-stone-800 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-700",
              isAhead ? "bg-emerald-500" : "bg-amber-500",
            )}
            style={{ width: `${pacePercent}%` }}
          />
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 mt-3 text-xs text-stone-400">
          <span>{covers} covers</span>
          <span>R{avgSpend.toFixed(0)} avg</span>
          {forecastCovers != null && (
            <span>{forecastCovers} forecast covers</span>
          )}
          {!isLive && (
            <span className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] text-stone-500 font-medium">
              Forecast mode
            </span>
          )}
        </div>

        {/* Peak window */}
        {(peakWindow || timeToPeakMinutes != null) && (
          <div className="flex items-center gap-3 mt-3 text-xs">
            {peakWindow && (
              <span className="text-stone-400">
                Peak: <span className="text-stone-200 font-medium">{peakWindow}</span>
              </span>
            )}
            {timeToPeakMinutes != null && (
              <span
                className={cn(
                  "font-medium",
                  timeToPeakMinutes <= 30
                    ? "text-red-400"
                    : timeToPeakMinutes <= 60
                      ? "text-amber-400"
                      : "text-stone-400",
                )}
              >
                {timeToPeakMinutes <= 0
                  ? "Peak now"
                  : `${timeToPeakMinutes}m to peak`}
              </span>
            )}
          </div>
        )}

        {/* Insights */}
        {insights.length > 0 && (
          <div className="mt-3 space-y-1 border-t border-stone-800/40 pt-3">
            {insights.map((insight, i) => (
              <p key={i} className="text-xs text-stone-300 flex items-start gap-1.5">
                <span className="text-stone-600 shrink-0">→</span>
                {insight}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
