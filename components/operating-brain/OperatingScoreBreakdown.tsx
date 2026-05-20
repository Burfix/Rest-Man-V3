/**
 * OperatingScoreBreakdown — Score visible but secondary.
 *
 * Shows the total score + top 3 reasons why the score is what it is.
 * Supports the narrative, doesn't lead it.
 */

"use client";

import { cn } from "@/lib/utils";
import type { EvaluateOperationsOutput } from "@/services/decision-engine";

type Props = {
  breakdown: EvaluateOperationsOutput["operatingScoreBreakdown"];
};

export default function OperatingScoreBreakdown({ breakdown }: Props) {
  const totalScore = breakdown.reduce((s, b) => s + b.score, 0);
  const maxScore = breakdown.reduce((s, b) => s + b.maxScore, 0);
  const pct = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

  const tone =
    pct >= 80 ? "text-emerald-400" : pct >= 60 ? "text-amber-400" : "text-red-400";
  const barTone =
    pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        Operating Score
      </h2>
      <div className="rounded-xl border border-stone-200 dark:border-stone-800/40 bg-stone-50 dark:bg-stone-900/50 p-4">
        {/* Score headline */}
        <div className="flex items-baseline gap-2 mb-3">
          <span className={cn("text-2xl font-bold font-mono", tone)}>
            {totalScore}
          </span>
          <span className="text-xs text-stone-500">/ {maxScore}</span>
        </div>

        {/* Component bars */}
        <div className="space-y-2.5">
          {breakdown.map((b) => {
            const fillPct =
              b.maxScore > 0 ? (b.score / b.maxScore) * 100 : 0;
            const itemTone =
              fillPct >= 80
                ? "bg-emerald-500"
                : fillPct >= 50
                  ? "bg-amber-500"
                  : "bg-red-500";
            return (
              <div key={b.label}>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-stone-500 dark:text-stone-400">{b.label}</span>
                  <span className="text-stone-500 font-mono">
                    {b.score}/{b.maxScore}
                  </span>
                </div>
                <div className="h-1 w-full rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", itemTone)}
                    style={{ width: `${fillPct}%` }}
                  />
                </div>
                <p className="text-[10px] text-stone-600 mt-0.5">{b.reason}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
