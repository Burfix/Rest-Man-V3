/**
 * TodayBrief — Narrative card for GM Co-Pilot.
 *
 * Answers: Are we ahead or behind? What's the peak? What are the risks?
 * Plain-English summary at top, 3–4 supporting stats max.
 */

"use client";

import { cn } from "@/lib/utils";
import type { EvaluateOperationsOutput } from "@/services/decision-engine";

type Props = {
  commandBar: EvaluateOperationsOutput["operatingCommandBar"];
  businessStatus: EvaluateOperationsOutput["businessStatus"];
  servicePulseInsights: string[];
  peakWindow?: string | null;
  forecastSales?: number | null;
  forecastCovers?: number | null;
};

export default function TodayBrief({
  commandBar,
  businessStatus,
  servicePulseInsights,
  peakWindow,
  forecastSales,
  forecastCovers,
}: Props) {
  const revTone = businessStatus.revenue.tone;
  const headline =
    revTone === "positive"
      ? "You're ahead of target today"
      : revTone === "warning"
        ? "Slightly behind — recoverable with a strong service"
        : "Revenue significantly behind — action needed now";

  return (
    <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🧭</span>
        <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium">
          Today&apos;s Brief
        </h2>
      </div>

      {/* Headline narrative */}
      <p
        className={cn(
          "text-base font-semibold leading-snug",
          revTone === "positive"
            ? "text-emerald-400"
            : revTone === "warning"
              ? "text-amber-400"
              : "text-red-400",
        )}
      >
        {headline}
      </p>

      {/* Supporting text */}
      <p className="mt-2 text-sm text-stone-400 leading-relaxed">
        {businessStatus.revenue.supportingText}.{" "}
        {peakWindow ? `Peak window is ${peakWindow}.` : ""}{" "}
        {commandBar.issueCount > 0
          ? `${commandBar.issueCount} issue${commandBar.issueCount !== 1 ? "s" : ""} need attention.`
          : "No critical issues."}
      </p>

      {/* Key stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        {forecastSales != null && (
          <Stat
            label="Forecast"
            value={`R${forecastSales.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`}
          />
        )}
        {forecastCovers != null && (
          <Stat label="Exp. Covers" value={String(forecastCovers)} />
        )}
        {peakWindow && <Stat label="Peak" value={peakWindow} />}
        <Stat
          label="Status"
          value={
            commandBar.status === "healthy"
              ? "On track"
              : commandBar.status === "needs_attention"
                ? "Needs attention"
                : "Critical"
          }
        />
      </div>

      {/* Insights */}
      {servicePulseInsights.length > 0 && (
        <div className="mt-4 space-y-1 border-t border-stone-800/40 pt-3">
          {servicePulseInsights.slice(0, 3).map((insight, i) => (
            <p
              key={i}
              className="text-xs text-stone-300 flex items-start gap-1.5"
            >
              <span className="text-stone-600 shrink-0">→</span>
              {insight}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-stone-800/40 px-3 py-2">
      <span className="text-[10px] uppercase tracking-wider text-stone-500">
        {label}
      </span>
      <p className="text-sm font-semibold text-stone-100 mt-0.5 truncate">
        {value}
      </p>
    </div>
  );
}
