/**
 * ControlBar — Top bar replacing the old OperatingCommandBar.
 *
 * Three data points: Revenue Risk | Time Pressure | Score
 * Strips away noise. Forces awareness. Creates urgency.
 */

"use client";

import { cn } from "@/lib/utils";

type Props = {
  revenueAtRisk: number;
  variancePercent: number;
  timePressure: string;
  score: number;
  status: "healthy" | "needs_attention" | "critical";
  servicePeriod: string;
};

export default function ControlBar({
  revenueAtRisk,
  variancePercent,
  timePressure,
  score,
  status,
  servicePeriod,
}: Props) {
  const isNegative = variancePercent < 0;
  const scorePct = Math.round(score);

  const scoreTone =
    scorePct >= 70 ? "text-emerald-400" : scorePct >= 55 ? "text-amber-400" : "text-red-400";
  const scoreBg =
    scorePct >= 70 ? "bg-emerald-500/10" : scorePct >= 55 ? "bg-amber-500/10" : "bg-red-500/10";

  const statusBorder =
    status === "critical"
      ? "border-red-800/50"
      : status === "needs_attention"
        ? "border-amber-800/40"
        : "border-stone-800/40";

  const statusDot =
    status === "critical"
      ? "bg-red-400 animate-pulse"
      : status === "needs_attention"
        ? "bg-amber-400"
        : "bg-emerald-400";

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-xl border px-5 py-3 bg-stone-950/80",
        statusBorder,
      )}
    >
      {/* Left: Status + Service Period */}
      <div className="flex items-center gap-3 shrink-0">
        <span className={cn("h-2.5 w-2.5 rounded-full", statusDot)} />
        <span className="text-xs font-semibold text-stone-300 uppercase tracking-wider">
          {servicePeriod}
        </span>
      </div>

      {/* Center: Three Key Metrics */}
      <div className="flex items-center gap-6">
        {/* Revenue Risk */}
        <div className="flex flex-col items-center">
          <span className="text-[9px] uppercase tracking-widest text-stone-600 font-medium">
            Revenue Risk
          </span>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span
              className={cn(
                "text-lg font-bold font-mono",
                revenueAtRisk > 0 ? "text-red-400" : "text-emerald-400",
              )}
            >
              {revenueAtRisk > 0
                ? `R${revenueAtRisk.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`
                : "R0"}
            </span>
            <span
              className={cn(
                "text-[11px] font-semibold",
                isNegative ? "text-red-400" : "text-emerald-400",
              )}
            >
              {isNegative ? "" : "+"}{variancePercent.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Divider */}
        <div className="h-8 w-px bg-stone-800/60" />

        {/* Time Pressure */}
        <div className="flex flex-col items-center">
          <span className="text-[9px] uppercase tracking-widest text-stone-600 font-medium">
            Time Pressure
          </span>
          <span className="text-sm font-bold text-stone-200 mt-0.5">
            {timePressure}
          </span>
        </div>

        {/* Divider */}
        <div className="h-8 w-px bg-stone-800/60" />

        {/* Score */}
        <div className="flex flex-col items-center">
          <span className="text-[9px] uppercase tracking-widest text-stone-600 font-medium">
            Operating Score
          </span>
          <span className={cn("text-lg font-black font-mono mt-0.5", scoreTone)}>
            {score}
            <span className="text-stone-600 text-xs font-normal">/100</span>
          </span>
        </div>
      </div>

      {/* Right: Score badge */}
      <div className={cn("rounded-lg px-3 py-1.5 shrink-0", scoreBg)}>
        <span className={cn("text-xs font-bold", scoreTone)}>
          {scorePct >= 85 ? "A" : scorePct >= 70 ? "B" : scorePct >= 55 ? "C" : scorePct >= 40 ? "D" : "F"}
        </span>
      </div>
    </div>
  );
}
