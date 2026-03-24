/**
 * ShiftSummaryBanner — Top summary for the Actions page.
 *
 * Shows: key risks, today's score, urgent actions count,
 * and a consequence statement for inaction.
 */

"use client";

import { cn } from "@/lib/utils";
import type { EvaluateOperationsOutput } from "@/services/decision-engine";

type Props = {
  commandBar: EvaluateOperationsOutput["operatingCommandBar"];
  totalActions: number;
  urgentCount: number;
  overdueCount: number;
};

export default function ShiftSummaryBanner({
  commandBar,
  totalActions,
  urgentCount,
  overdueCount,
}: Props) {
  const hasCritical = commandBar.status === "critical";

  return (
    <div
      className={cn(
        "rounded-xl border px-5 py-4",
        hasCritical
          ? "bg-red-950/40 border-red-800/30"
          : urgentCount > 0
            ? "bg-amber-950/40 border-amber-800/30"
            : "bg-stone-900/50 border-stone-800/40",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-stone-100">
            {urgentCount > 0
              ? `${urgentCount} urgent action${urgentCount !== 1 ? "s" : ""} need attention`
              : "Shift actions on track"}
          </h2>
          {overdueCount > 0 && (
            <p className="text-xs text-red-400 mt-0.5">
              {overdueCount} overdue — complete before end of shift
            </p>
          )}
          {commandBar.revenueAtRisk != null && commandBar.revenueAtRisk > 0 && (
            <p className="text-xs text-amber-400 mt-0.5">
              R{commandBar.revenueAtRisk.toLocaleString("en-ZA")} at risk if not addressed
            </p>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-stone-500">
          <span>{totalActions} total actions</span>
          {commandBar.timeToPeakLabel && (
            <span className="text-stone-400 font-medium">{commandBar.timeToPeakLabel}</span>
          )}
        </div>
      </div>
    </div>
  );
}
