/**
 * MobileShiftReview — End-of-shift summary for mobile.
 *
 * Service score, revenue recovered, actions completed,
 * carry-forward items, recovery status.
 */

"use client";

import { cn } from "@/lib/utils";

type Props = {
  shiftType: string;
  serviceScore: number;
  serviceGrade: string;
  revenueRecovered: number;
  actionsCompleted: number;
  actionsTotal: number;
  carryForwardActions: number;
  isRecoveryShift: boolean;
  shiftSummary: string;
};

function rands(v: number): string {
  return `R${Math.abs(v).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

const GRADE_COLOR: Record<string, string> = {
  A: "text-emerald-400",
  B: "text-blue-400",
  C: "text-amber-400",
  D: "text-orange-400",
  F: "text-red-400",
};

export default function MobileShiftReview({
  shiftType,
  serviceScore,
  serviceGrade,
  revenueRecovered,
  actionsCompleted,
  actionsTotal,
  carryForwardActions,
  isRecoveryShift,
  shiftSummary,
}: Props) {
  const completionPct = actionsTotal > 0 ? Math.round((actionsCompleted / actionsTotal) * 100) : 100;

  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        Shift Review
      </h2>
      <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 p-4 space-y-4">
        {/* Score row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-stone-500 capitalize">
              {shiftType} Shift
            </span>
            {isRecoveryShift && (
              <span className="text-[10px] text-emerald-400 bg-emerald-950/30 border border-emerald-800/30 rounded-full px-2 py-0.5">
                Recovery
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className={cn("text-xl font-bold font-mono", GRADE_COLOR[serviceGrade] ?? "text-stone-300")}>
              {serviceScore}
            </span>
            <span className={cn("text-xs font-bold", GRADE_COLOR[serviceGrade] ?? "text-stone-400")}>
              {serviceGrade}
            </span>
          </div>
        </div>

        {/* Summary */}
        <p className="text-sm text-stone-300 leading-relaxed">{shiftSummary}</p>

        {/* Metrics grid */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-stone-800/30 border border-stone-700/30 px-3 py-2 text-center">
            <span className="text-[10px] uppercase tracking-wider text-stone-500 block">Recovered</span>
            <span className={cn(
              "text-sm font-bold font-mono",
              revenueRecovered > 0 ? "text-emerald-400" : "text-stone-500",
            )}>
              {revenueRecovered > 0 ? rands(revenueRecovered) : "—"}
            </span>
          </div>
          <div className="rounded-lg bg-stone-800/30 border border-stone-700/30 px-3 py-2 text-center">
            <span className="text-[10px] uppercase tracking-wider text-stone-500 block">Actions</span>
            <span className={cn(
              "text-sm font-bold font-mono",
              completionPct >= 80 ? "text-emerald-400" : completionPct >= 50 ? "text-amber-400" : "text-red-400",
            )}>
              {actionsCompleted}/{actionsTotal}
            </span>
          </div>
          <div className="rounded-lg bg-stone-800/30 border border-stone-700/30 px-3 py-2 text-center">
            <span className="text-[10px] uppercase tracking-wider text-stone-500 block">Carry Fwd</span>
            <span className={cn(
              "text-sm font-bold font-mono",
              carryForwardActions === 0 ? "text-emerald-400" : carryForwardActions <= 2 ? "text-amber-400" : "text-red-400",
            )}>
              {carryForwardActions}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
