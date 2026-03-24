/**
 * TopDecisions — Top 3 decisions for the shift/day.
 *
 * Format: decision + why it matters + expected impact.
 * Concise, ranked, action-oriented.
 */

"use client";

import { cn } from "@/lib/utils";
import type { OperatingDecision } from "@/services/decision-engine";

type Props = {
  decisions: OperatingDecision[];
};

const SEV_DOT: Record<string, string> = {
  critical: "bg-red-400 animate-pulse",
  high: "bg-orange-400",
  medium: "bg-amber-400",
  low: "bg-stone-500",
};

export default function TopDecisions({ decisions }: Props) {
  if (decisions.length === 0) return null;

  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        Top Decisions
      </h2>
      <div className="space-y-2">
        {decisions.slice(0, 3).map((d, i) => (
          <div
            key={d.id}
            className="rounded-lg border border-stone-800/40 bg-stone-900/50 px-4 py-3.5"
          >
            <div className="flex items-start gap-3">
              <span className={cn("h-2.5 w-2.5 rounded-full mt-1 shrink-0", SEV_DOT[d.severity])} />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-stone-100">
                  {d.title}
                </h3>
                <p className="text-xs text-stone-400 mt-1 leading-relaxed">
                  {d.explanation}
                </p>
                {d.impact && (
                  <p className="text-[11px] text-emerald-400 font-medium mt-1.5">
                    {d.impact.label}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
