/**
 * WhatToDoNow — Execution-first action queue replacing "Priority Actions".
 *
 * Shows the top 3 things the GM should do RIGHT NOW.
 * Each item: problem → action → expected impact → optional CTA.
 */

"use client";

import { cn } from "@/lib/utils";
import type { OperatingDecision } from "@/services/decision-engine";

type Props = {
  decisions: OperatingDecision[];
};

const SEV_DOT: Record<OperatingDecision["severity"], string> = {
  critical: "bg-red-400 animate-pulse",
  high: "bg-orange-400",
  medium: "bg-amber-400",
  low: "bg-stone-500",
};

const IMPACT_STYLES: Record<string, string> = {
  revenue_protected: "text-emerald-400",
  cost_saved: "text-blue-400",
  service_risk: "text-red-400",
  compliance_risk: "text-rose-400",
};

export default function WhatToDoNow({ decisions }: Props) {
  if (decisions.length === 0) {
    return (
      <div className="rounded-xl border border-stone-200 dark:border-stone-800/40 bg-stone-50 dark:bg-stone-900/50 px-5 py-6 text-center">
        <p className="text-sm text-emerald-400 font-medium">Nothing urgent — you&apos;re on track</p>
        <p className="text-xs text-stone-500 mt-1">Check back before next service period</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        What To Do Now
      </h2>
      <div className="space-y-2">
        {decisions.map((d, i) => (
          <div
            key={d.id}
            className="rounded-lg border border-stone-200 dark:border-stone-800/40 bg-stone-50 dark:bg-stone-900/50 px-4 py-3.5"
          >
            <div className="flex items-start gap-3">
              {/* Number + severity dot */}
              <div className="flex flex-col items-center gap-1 pt-0.5">
                <span className="text-lg font-bold text-stone-600">{i + 1}</span>
                <span className={cn("h-2 w-2 rounded-full", SEV_DOT[d.severity])} />
              </div>

              <div className="flex-1 min-w-0">
                {/* Problem */}
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100 leading-snug">
                  {d.title}
                </h3>

                {/* Action */}
                <p className="mt-1.5 text-xs text-stone-600 dark:text-stone-300 font-medium">
                  → {d.action}
                </p>

                {/* Impact + Due */}
                <div className="mt-2 flex items-center flex-wrap gap-3 text-[11px]">
                  {d.impact && (
                    <span className={cn("font-medium", IMPACT_STYLES[d.impact.type] ?? "text-stone-500 dark:text-stone-400")}>
                      {d.impact.label}
                    </span>
                  )}
                  {d.due && (
                    <span className="text-stone-500 font-mono">
                      Due: {d.due}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
