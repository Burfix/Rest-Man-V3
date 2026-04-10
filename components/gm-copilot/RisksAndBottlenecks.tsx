/**
 * RisksAndBottlenecks — Concise ranked display of current operational risks.
 *
 * Shows service risk, stock bottlenecks, labour pressure, maintenance blockers.
 */

"use client";

import { cn } from "@/lib/utils";
import type { EvaluateOperationsOutput, BusinessStatusTone } from "@/services/decision-engine";

type Props = {
  businessStatus: EvaluateOperationsOutput["businessStatus"];
};

const TONE_STYLES: Record<BusinessStatusTone, string> = {
  positive: "text-emerald-400",
  warning: "text-amber-400",
  critical: "text-red-400",
  neutral: "text-stone-500 dark:text-stone-400",
};

const RISK_ICON: Record<string, string> = {
  revenue: "📉",
  labour: "⏱️",
  inventory: "📦",
  maintenance: "🔧",
  compliance: "📋",
};

type StatusKey = keyof EvaluateOperationsOutput["businessStatus"];

export default function RisksAndBottlenecks({ businessStatus }: Props) {
  // Filter to only show items with warning or critical tone
  const risks = (Object.keys(businessStatus) as StatusKey[])
    .filter((k) => businessStatus[k].tone === "warning" || businessStatus[k].tone === "critical")
    .sort((a, b) => {
      const w: Record<BusinessStatusTone, number> = { critical: 3, warning: 2, positive: 1, neutral: 0 };
      return w[businessStatus[b].tone] - w[businessStatus[a].tone];
    });

  if (risks.length === 0) {
    return (
      <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 px-5 py-4 text-center">
        <p className="text-sm text-emerald-400 font-medium">No active risks</p>
        <p className="text-xs text-stone-500 mt-0.5">All operational areas healthy</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        Risks &amp; Bottlenecks
      </h2>
      <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 divide-y divide-stone-800/40">
        {risks.map((key) => {
          const item = businessStatus[key];
          return (
            <div key={key} className="flex items-start gap-3 px-4 py-3">
              <span className="text-sm mt-0.5">{RISK_ICON[key]}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-stone-500 font-medium">
                    {key}
                  </span>
                  <span className={cn("text-xs font-semibold", TONE_STYLES[item.tone])}>
                    {item.label}
                  </span>
                </div>
                <p className="text-[11px] text-stone-500 mt-0.5">{item.supportingText}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
